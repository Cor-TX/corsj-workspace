#!/usr/bin/env node
/**
 * 版本同步脚本：把 CORE_VERSION 常量与各包构建产物中的版本统一。
 *
 * 用法：node scripts/version-sync.mjs
 * 会把 core/dist/index.js|d.ts 中的 0.1.0 占位版本刷新为 core/package.json 的 version，
 * 并把 CORE_VERSION 常量同步为同一版本。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const corePkg = JSON.parse(readFileSync(resolve(root, 'core/package.json'), 'utf8'));
const version = corePkg.version;

let changed = false;

// 同步 core/dist/index.js 与 .d.ts 中的 CORE_VERSION
for (const rel of [
  'core/dist/index.js',
  'core/dist/index.d.ts',
]) {
  const p = resolve(root, rel);
  if (!existsSync(p)) continue;
  let s = readFileSync(p, 'utf8');
  const before = s;
  s = s.replace(/(CORE_VERSION\s*=\s*)'[^']*'/g, `$1'${version}'`);
  s = s.replace(/(CORE_VERSION:\s*)'[^']*'/g, `$1'${version}'`);
  if (s !== before) {
    writeFileSync(p, s);
    changed = true;
    console.log(`synced ${rel} → ${version}`);
  }
}

if (!changed) console.log(`version already ${version}; nothing to sync`);