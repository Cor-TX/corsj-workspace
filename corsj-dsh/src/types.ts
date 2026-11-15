/**
 * @corsj/dsh — 共享类型面（宿主与客户端共用；不含任何密钥 / 会话内容）。
 *
 * 纪律：
 * - 本文件只声明数据形状，不复制 @corsj/core 的领域逻辑；
 * - 交付结论唯一权威是 core 的 delivery_gate.submit，本包任何类型都不表达交付判定；
 * - 不持有任何模型 API key。
 */
import type { OverlayView } from './overlay.js';

/** core capability（只读展示用）。 */
export interface CoreCapability {
  capability_id: string;
  consumes: string[];
  produces: string[];
  embedded_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  tool_surface: string[];
  core: boolean;
  description: string;
}

/** core 产物（桥接层剥离二进制载荷后的元数据）。 */
export interface CoreArtifactMeta {
  path: string;
  media_type: string;
  role?: string;
  bytes: number;
  sha256: string;
}

/** core 命令回执（A 层）。 */
export interface CoreCommandResult {
  status: string;
  message: string;
  raw_data: Record<string, unknown>;
  artifacts: CoreArtifactMeta[];
}

/** core 命令回执（A 层，含 capability id）。 */
export interface CoreCommandReceipt {
  capability_id: string;
  status: string;
  result: CoreCommandResult;
}

/** A 层命令上下文（core commands/types.ts 的 CommandContext 形状）。 */
export interface CoreCommandContext {
  pkg: unknown;
  run: number;
  scratchDir: string;
  assets: unknown;
  signal?: AbortSignal;
}

/** @corsj/core 根出口（B 层闭环 / locator / 包模型）。 */
export interface CoreRootApi {
  CORE_VERSION: string;
  GATE_COMMAND_ID: string;
  runDesignLoop(opts: Record<string, unknown>): Promise<Record<string, unknown>>;
  createLocator(opts: Record<string, unknown>): CoreLocator;
  createUnavailableAssetResolver(): unknown;
  EopPackage: { create(id: string, title: string, coreVersion: string): unknown };
  stableStringify(x: unknown): string;
}

/** @corsj/core/commands 出口（A 层注册表）。 */
export interface CoreCommandsApi {
  executeCommand(id: string, params: Record<string, unknown>, ctx: CoreCommandContext): Promise<CoreCommandReceipt>;
  listCapabilities(): CoreCapability[];
  verifyRegistry(): { ok: boolean; errors: string[] };
  ensureCommandsRegistered(): { ok: boolean; errors: string[]; counts: { total: number; core: number; extension: number } };
  COMMAND_COUNT: number;
  CORE_COUNT: number;
  EXTENSION_COUNT: number;
}

/** 定位器（core locator 形状，只读使用）。 */
export interface CoreLocator {
  userDataRoot(): string;
  configDir(): string;
  cacheRoot(): string;
  eopDir(): string;
  logDir(): string;
  installRoots(): string[];
  assertWritable(path: string): void;
  isWritable(path: string): boolean;
}

/** 不可协商的约束（编译期常量，供宿主与自检断言）。 */
export const INVARIANTS = {
  gate_authority: 'delivery_gate.submit',
  ui_may_declare_delivered: false,
  bridge_exposes_gate_command: false,
  reads_dsh_user_config: false,
  holds_model_api_key: false,
  model_calls: 'delegated-to-dsh-global-model',
  renderer_imports_core: false,
} as const;

/** 桥接后的状态取值域。 */
export type BridgedStatus = 'success' | 'design_error' | 'env_error' | 'not_implemented' | 'refused';

/** 桥接回执：透传 A 层结果；verdict 恒为 null（桥接层不产生交付结论）。 */
export interface BridgedResult {
  capability_id: string;
  status: BridgedStatus;
  message: string;
  raw_data: Record<string, unknown>;
  artifacts: CoreArtifactMeta[];
  run: number;
  at: string;
  layer: 'A';
  verdict: null;
}

/** 桥接会话：一次 DSH 会话内共享的包 / 工作区 / 资产解析器。 */
export interface BridgeSession {
  packageId: string;
  core_version: string;
  run: number;
  scratchDir: string;
  pkg: unknown;
  assets: unknown;
}

/** DSH 只读模型（不含密钥 / 会话内容）。 */
export interface DshModel {
  core_version: string;
  registry_ok: boolean;
  registry_errors: string[];
  /** 持久化指纹校验状态（启动时校验 .jsonl.zstd）。 */
  persistence_ok: boolean;
  persistence_errors: string[];
  counts: { total: number; core: number; extension: number };
  commands: Record<string, { status: string; at: string; run?: number }>;
  recent: Array<{ command: string; status: string; at: string }>;
  last_loop?: {
    state: string;
    delivered: boolean;
    used_rounds: number;
    max_rounds: number;
    verdict_decision?: string;
    verdict_code?: string;
    required_passed: number;
    required_total: number;
    degraded_count: number;
    package_path?: string;
    package_fingerprint?: string;
    at: string;
  };
  overlay_view?: OverlayView;
}
