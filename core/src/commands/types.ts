/**
 * @corsj/core — A 层命令执行器公共类型。
 *
 * A 层职责边界（任务书 §2.1）：
 * - 输入参数/对象引用 → 执行 → 回传 artifacts + raw_data + status。
 * - 只执行并产出证据：不做验收判定、不比较阈值、不生成 passed/failed、
 *   不迭代、不决定下一步、不重试、不修改输入参数。
 * - status 取值域固定四类。
 */
import type { EopPackage } from '../model/eop.js';

export type CommandStatus = 'success' | 'design_error' | 'env_error' | 'not_implemented';

/** 产物：内存二进制 + 包内登记路径。 */
export interface Artifact {
  /** 包内路径（POSIX），如 artifacts/0002-geometry.generate/model.step。 */
  path: string;
  data: Uint8Array;
  media_type: string;
  role?: string;
}

/** 命令执行结果（A 层唯一返回形态）。 */
export interface CommandResult {
  status: CommandStatus;
  /** 人类可读摘要。 */
  message: string;
  /** 结构化原始数据（无判定语义）。 */
  raw_data: Record<string, unknown>;
  /** 产物列表（登记进包的 artifacts/ 前缀下）。 */
  artifacts: Artifact[];
}

/** 命令执行上下文：A 层可访问包（读对象/写产物），但拿不到 AcceptanceSpec 阈值。 */
export interface CommandContext {
  /** 当前对象包（追加式；命令只能 addEvidence/addObject，不能改已登记内容）。 */
  pkg: EopPackage;
  /** 本次运行序号（1 起）。 */
  run: number;
  /** 工作目录（命令私有临时区；locator 白名单内）。 */
  scratchDir: string;
  /** L3 资产解析（按需启停；env_error 处理失败）。 */
  assets: L3AssetResolver;
  /** 信号：任务取消时中止。 */
  signal?: AbortSignal;
}

/** L3 资产解析接口（core assets 模块实现）。 */
export interface L3AssetResolver {
  /** 确保资产在共享缓存中；返回本地路径。失败按 env_error。 */
  ensure(assetId: string): Promise<string>;
  /** 资产元信息。 */
  describe(assetId: string): { id: string; level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4'; sha256?: string } | undefined;
}

/** 命令入参（各命令自定义 schema；A 层只透传，不修改）。 */
export type CommandParams = Record<string, unknown>;

/** 执行器函数签名。 */
export type CommandExecutor = (params: CommandParams, ctx: CommandContext) => Promise<CommandResult>;

/** capability 记录（每条命令注册一条）。 */
export interface Capability {
  capability_id: string;
  /** 消耗的对象类型/参数说明。 */
  consumes: string[];
  /** 产出的对象类型/产物说明。 */
  produces: string[];
  executor: CommandExecutor;
  /** 指向 core/design/acceptance-spec/eligibility-matrix.ts 的资格矩阵条目。 */
  validator_ref: string;
  embedded_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  /** 工具面：core-api / mcp / http。 */
  tool_surface: string[];
  /** 核心/扩展。 */
  core: boolean;
  description: string;
}

/** 参数校验错误 → design_error 的便捷构造。 */
export function designError(message: string, raw: Record<string, unknown> = {}): CommandResult {
  return { status: 'design_error', message, raw_data: raw, artifacts: [] };
}

/** 环境错误便捷构造。 */
export function envError(message: string, raw: Record<string, unknown> = {}): CommandResult {
  return { status: 'env_error', message, raw_data: raw, artifacts: [] };
}

/** not_implemented 便捷构造（扩展命令骨架）。 */
export function notImplemented(command: string): CommandResult {
  return {
    status: 'not_implemented',
    message: `命令 ${command} 为【扩展】命令：适配器骨架已注册，底层未接入（阶段一按任务书返回 not_implemented）`,
    raw_data: { command, implemented: false },
    artifacts: [],
  };
}

/** success 便捷构造。 */
export function ok(message: string, rawData: Record<string, unknown>, artifacts: Artifact[]): CommandResult {
  return { status: 'success', message, raw_data: rawData, artifacts };
}
