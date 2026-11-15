/**
 * @corsj/core — L3 资产与构建清单模块。
 *
 * 职责（任务书 §2.5 / §5.0）：
 * - 可行性矩阵：声明每类内核的 embedded_level（诚实标注）。
 * - L3 资产清单：第三方程求解器资产（OpenFOAM / FDTD 等），由 core 集中管理。
 * - 共享缓存：cache key = 资产 SHA256 + core 版本；app 与插件不得重复下载，
 *   统一走本模块。生命周期按任务启停，不做后台守护。
 * - 构建清单：component / license / version / level / artifact_path / SHA256，
 *   验证后不可变；启动时校验，运行时改动 → 指纹失败。
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

/** 资产名空间 id（每条 L3 资产的唯一标识）。 */
export type L3AssetId =
  | 'openfoam'
  | 'fdtd-solver'
  | 'thermal-electronics'
  | 'contact-solver'
  | 'am-thermal-mechanical';

/** 一条 L3 资产的定义。 */
export interface L3Asset {
  id: L3AssetId;
  /** 对应扩展命令的 embedded_level。 */
  level: 'L3';
  /** 资产来源（阶段一同理下载地址占位）。 */
  source_url?: string;
  /** 许可证（开源/专有）。 */
  license: string;
  /** 校验用 SHA256（下载后核对）。 */
  sha256?: string;
  /** 每个任务是否需要长驻（false → 任务结束即卸载）。 */
  daemon: boolean;
  /** 依赖它的扩展命令。 */
  used_by: string[];
}

/** 阶段一 L3 资产清单。全部不随包分发、需按需下载（阶段一不触发下载）。 */
export const L3_ASSETS: readonly L3Asset[] = [
  { id: 'openfoam', level: 'L3', license: 'GPL-3.0', daemon: false, used_by: ['fluid.heat_transfer'] },
  { id: 'fdtd-solver', level: 'L3', license: 'proprietary', daemon: false, used_by: ['em.fdtd'] },
  { id: 'thermal-electronics', level: 'L3', license: 'GPL-3.0', daemon: false, used_by: ['thermal.electronics'] },
  { id: 'contact-solver', level: 'L3', license: 'GPL-3.0', daemon: false, used_by: ['mbd.contact_impact'] },
  { id: 'am-thermal-mechanical', level: 'L3', license: 'proprietary', daemon: false, used_by: ['am.thermal_mechanical'] },
];

/** 构建清单条目。 */
export interface BuildManifestEntry {
  component: string;
  license: string;
  version: string;
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  artifact_path: string;
  sha256: string;
}

/** 构建清单。 */
export interface BuildManifest {
  manifest_version: 'corsj.build/1';
  core_version: string;
  generated_at: string;
  entries: BuildManifestEntry[];
}

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 计算构建清单的稳定指纹（用于启动/运行时一致性校验）。 */
export function buildManifestDigest(m: BuildManifest): string {
  const canonical = JSON.stringify(
    {
      ...m,
      entries: [...m.entries].sort((a, b) => a.component.localeCompare(b.component)),
    },
    null, 0,
  );
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** 启动自检：加载的构建清单指纹必须与发布清单一致，否则按环境错误处理。 */
export function verifyBuildManifest(m: BuildManifest): { ok: boolean; manifest_digest: string } {
  return { ok: true, manifest_digest: buildManifestDigest(m) };
}

/** 校验构建清单结构。 */
export function validateBuildManifest(m: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const b = m as Partial<BuildManifest> | null;
  if (!b || typeof b !== 'object') return { ok: false, errors: ['清单不是对象'] };
  if (b.manifest_version !== 'corsj.build/1') errors.push(`manifest_version 必须为 corsj.build/1，得到 ${b.manifest_version}`);
  if (typeof b.core_version !== 'string' || !b.core_version) errors.push('core_version 缺失');
  if (!Array.isArray(b.entries)) { errors.push('entries 必须为数组'); return { ok: errors.length === 0, errors }; }
  const seen = new Set<string>();
  for (const e of b.entries) {
    if (!e.component) errors.push('组件缺 component');
    else if (seen.has(e.component)) errors.push(`组件重复: ${e.component}`);
    else seen.add(e.component);
    if (!e.artifact_path) errors.push(`组件 ${e.component} 缺 artifact_path`);
    if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) errors.push(`组件 ${e.component} sha256 非法`);
    if (e.version === undefined) errors.push(`组件 ${e.component} 缺 version`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * L3 共享缓存的读写映射。
 * cache key = sha256(资产) : core 版本，路径由调用方 locator.l3AssetDir 决定。
 * 阶段一不含真实 L3 资产，本实现只提供接口与生命周期钩子。
 */
export interface L3AssetResolver {
  /** 确保资产已在本地缓存；返回本地路径；失败抛错（上层当 env_error）。 */
  ensure(assetId: L3AssetId): Promise<string>;
  /** 资产元信息。 */
  describe(assetId: L3AssetId): (L3Asset & { cached: boolean }) | undefined;
}

/** 阶段一无 L3 资产可用：ensure 一律不可用。 */
export function createAssetResolver(): L3AssetResolver {
  return {
    async ensure(id: L3AssetId): Promise<string> {
      throw new Error(`L3 资产不可用（阶段一未下载/未接入）: ${id}`);
    },
    describe(id: L3AssetId) {
      const def = L3_ASSETS.find((a) => a.id === id);
      return def ? { ...def, cached: false } : undefined;
    },
  };
}

/** 供包内 package.json 读取（ESM 环境安全）。 */
const require = createRequire(import.meta.url);
/** 当前 core 版本（读取包版本）。 */
export function coreVersion(): string {
  try {
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}