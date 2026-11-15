/**
 * @corsj/dsh — DSH 只读模型状态（宿主侧）。
 *
 * 只存命令 id / status / 时间戳 / 指纹等摘要，不存 parameters、返回值、
 * 会话内容与任何密钥。模型调用交给 DSH 全局模型，本模块不持有 API key。
 */
import type { DshModel, BridgeSession, BridgedResult, BridgedStatus, CoreCapability, CoreCommandContext, CoreCommandsApi } from './types.js';
import type { OverlayView } from './overlay.js';

/** 小工具：对象化。 */
export function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** 小工具：数组化。 */
export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** 小工具：字符串化。 */
export function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

/** 小工具：数值化。 */
export function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 最近命令环形缓冲上限。 */
export const RECENT_LIMIT = 20;

const model: DshModel = {
  core_version: '',
  registry_ok: false,
  registry_errors: [],
  persistence_ok: false,
  persistence_errors: [],
  counts: { total: 0, core: 0, extension: 0 },
  commands: {},
  recent: [],
};

/** 记录一次命令执行（只存状态摘要，不存 parameters / 返回值）。 */
export function recordRun(command: string, status: string, run?: number): void {
  const at = new Date().toISOString();
  const entry: { status: string; at: string; run?: number } = { status, at };
  if (run !== undefined) entry.run = run;
  model.commands[command] = entry;
  model.recent.unshift({ command, status, at });
  if (model.recent.length > RECENT_LIMIT) model.recent.length = RECENT_LIMIT;
}

/** 模型可变引用（宿主内部使用；对外经 getModel() 暴露只读快照）。 */
export function getDshModel(): DshModel {
  return model;
}

/** 重置模型（自检用）。 */
export function resetModel(): void {
  model.core_version = '';
  model.registry_ok = false;
  model.registry_errors = [];
  model.persistence_ok = false;
  model.persistence_errors = [];
  model.counts = { total: 0, core: 0, extension: 0 };
  model.commands = {};
  model.recent = [];
  model.last_loop = undefined;
  model.overlay_view = undefined;
}

export type { DshModel, BridgeSession, BridgedResult, BridgedStatus, CoreCapability, CoreCommandContext, CoreCommandsApi, OverlayView };
