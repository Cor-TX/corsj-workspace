/**
 * @corsj/core — 运行期路径定位器。
 *
 * 规则（任务书 §2.1 / §5.1）：
 * - 运行期写入只允许通过本定位器解析的白名单路径：
 *   用户数据、缓存、日志、安装目录。
 * - 运行期默认 cache root：用户数据目录下 corsj/cache/。
 * - 开发期默认 cache root：corsj-workspace/.cache/。
 * - corsj-app 与 corsj-dsh 必须用同一套解析规则，不得各自建缓存。
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

export type LocatorMode = 'dev' | 'user';

export interface LocatorOptions {
  mode: LocatorMode;
  /** dev 模式的工作区根（默认向上查找 pnpm-workspace.yaml）。 */
  devRoot?: string;
  /** user 模式的用户数据根（如 Electron app.getPath('userData')）。 */
  userDataRoot?: string;
  /** 额外允许写入的安装目录（Electron 打包后的资源目录等）。 */
  installDirs?: string[];
}

export interface CorsjLocator {
  readonly mode: LocatorMode;
  /** 用户数据根。dev: <workspace>/.cache/userdata ；user: <userData>/corsj */
  userDataRoot(): string;
  /** 配置目录。<userDataRoot>/config */
  configDir(): string;
  /** 具名配置文件路径（如 iteration.json）。 */
  configPath(name: string): string;
  /** L3 共享缓存根。dev: <workspace>/.cache/l3 ；user: <userDataRoot>/cache */
  cacheRoot(): string;
  /** 按资产哈希 + core 版本寻址的 L3 资产目录。 */
  l3AssetDir(assetSha256: string): string;
  /** 日志目录。 */
  logDir(): string;
  /** 对象包默认存储目录。 */
  eopDir(): string;
  /** 安装目录白名单（只读校验基准）。 */
  installRoots(): string[];
  /** 断言路径在写白名单内；否则抛 WRITABLE_PATH_VIOLATION。 */
  assertWritable(path: string): void;
  /** 判断路径是否在写白名单内。 */
  isWritable(path: string): boolean;
}

const WRITE_VIOLATION = 'WRITABLE_PATH_VIOLATION';

function normalize(p: string): string {
  return resolve(p).toLowerCase();
}

/** 向上查找工作区根（pnpm-workspace.yaml 所在目录）。 */
export function findWorkspaceRoot(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
}

class LocatorImpl implements CorsjLocator {
  constructor(
    readonly mode: LocatorMode,
    private readonly userRoot: string,
    private readonly cacheRootPath: string,
    private readonly install: string[],
  ) {}

  userDataRoot(): string { return this.userRoot; }
  configDir(): string { return join(this.userRoot, 'config'); }
  configPath(name: string): string { return join(this.configDir(), name); }
  cacheRoot(): string { return this.cacheRootPath; }
  l3AssetDir(assetSha256: string): string {
    return join(this.cacheRootPath, 'assets', assetSha256);
  }
  logDir(): string { return join(this.userRoot, 'logs'); }
  eopDir(): string { return join(this.userRoot, 'eop'); }
  installRoots(): string[] { return [...this.install]; }

  isWritable(path: string): boolean {
    const n = normalize(path);
    const roots = [this.userRoot, this.cacheRootPath, ...this.install].map(normalize);
    return roots.some((r) => n === r || n.startsWith(r + sep.toLowerCase()) || n.startsWith(r + '/'));
  }

  assertWritable(path: string): void {
    if (!this.isWritable(path)) {
      throw new Error(`${WRITE_VIOLATION}: 路径不在 locator 白名单内: ${path}（允许根: ${[this.userRoot, this.cacheRootPath, ...this.install].join(', ')}）`);
    }
  }
}

/** 创建定位器。 */
export function createLocator(opts: LocatorOptions): CorsjLocator {
  if (opts.mode === 'dev') {
    const root = opts.devRoot ?? findWorkspaceRoot(process.cwd()) ?? process.cwd();
    const userRoot = join(root, '.cache', 'userdata');
    const cacheRoot = join(root, '.cache', 'l3');
    return new LocatorImpl('dev', userRoot, cacheRoot, [root]);
  }
  if (!opts.userDataRoot) {
    throw new Error('user 模式必须提供 userDataRoot（如 Electron app.getPath("userData")）');
  }
  // 运行期统一布局：<userData>/corsj/...
  const userRoot = join(opts.userDataRoot, 'corsj');
  const cacheRoot = join(userRoot, 'cache');
  return new LocatorImpl('user', userRoot, cacheRoot, opts.installDirs ?? []);
}
