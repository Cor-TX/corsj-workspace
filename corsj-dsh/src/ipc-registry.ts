/**
 * @corsj/dsh — 进程内 IPC 回环注册表（无 Electron 时的自检 / 回环通道）。
 *
 * 仅在没有 Electron ipcMain/ipcRenderer 时使用；通道名与白名单语义与
 * ipc.ts 的 Electron 路径完全一致。
 */
import type { IpcHandler } from './ipc.js';
import type { JsonValue } from './json.js';

const handlers = new Map<string, IpcHandler>();

/** 注册通道（供 HostIpcBridge 的非 Electron 分支调用）。 */
export function register(channel: string, fn: IpcHandler): void {
  if (handlers.has(channel)) throw new Error('IPC 通道重复注册: ' + channel);
  handlers.set(channel, fn);
}

/** 派发一次调用。 */
export async function dispatch(channel: string, payload?: JsonValue): Promise<unknown> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error('IPC 通道未注册: ' + channel);
  return fn(payload ?? null);
}

/** 已注册通道（诊断用）。 */
export function channels(): string[] {
  return Array.from(handlers.keys());
}
