#!/usr/bin/env node
/**
 * 构建清单生成器：扫描 core/dist 产物，产出 core/manifest.json（发布清单）。
 *
 * 用法：node core/scripts/gen-manifest.mjs
 * 产物：core/manifest.json —— manifest_version=corsj.build/1 的构建清单。
 * 启动时校验 artifact_path 的 SHA256 是否与清单一致；不一致按 env_error，
 * 运行时清单被改 → 指纹不一致 → 门禁立即 FAILED。
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..'); // core/
const workspace = resolve(root, '..');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** 递归收集构建产物文件。 */
function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const dist = join(root, 'dist');
const files = walk(dist).filter((p) => {
  const rel = relative(dist, p).replace(/\\/g, '/');
  return rel.endsWith('.js') && !rel.endsWith('.map') && !rel.endsWith('.d.ts');
});

const coreVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '0.0.0';

const entryFor = (p) => {
  const rel = relative(dist, p).replace(/\\/g, '/');
  const buf = readFileSync(p);
  // 构建产物 level：core 的 JS 内核/流程均为 L1（纯 TS）；L3 会以独立二进制条目出现。
  return {
    component: rel,
    license: 'MIT',
    version: coreVersion,
    level: 'L1',
    artifact_path: rel,
    sha256: sha256(buf),
  };
};

const manifest = {
  manifest_version: 'corsj.build/1',
  core_version: coreVersion,
  generated_at: new Date().toISOString(),
  entries: files.map(entryFor),
};

writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
console.log(`wrote core/manifest.json: ${manifest.entries.length} entries, digest=${digest}`);
void workspace;