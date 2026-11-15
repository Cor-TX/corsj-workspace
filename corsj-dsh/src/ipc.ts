/**
 * @corsj/dsh — 主进程 IPC 分发桥（选项 A）。
 *
 * 架构：渲染器无直接 Node 权限，仅通过白名单通道（本模块的 client 面）
 * 调用宿主；宿主在本模块的 host 面注册 ipcMain.handle，转发到 @corsj/core。
 *
 * - 有 Electron 时：host 用 ipcMain.handle，client 用 ipcRenderer.invoke；
 * - 无 Electron（Node 自检）：退化为进程内 Map 分发，保持同一套通道与白名单语义。
 * 两条路径的通道名、参数与返回值完全一致，自检可覆盖真实转发逻辑。
 */
import type { JsonValue } from './json.js';

/** IPC 通道名（白名单，唯一来源）。 */
export const IPC_CHANNELS = {
  sysinfo: 'dsh-corsj:sysinfo',
  listCommands: 'dsh-corsj:list-commands',
  openPanel: 'dsh-corsj:open-panel',
  runCommand: 'dsh-corsj:run-command',
  getOverlay: 'dsh-corsj:get-overlay',
  modelGet: 'dsh-corsj:model-get',
} as const;

/** 宿主侧处理器签名（返回值须为 JSON 可序列化）。 */
export type IpcHandler = (payload: JsonValue) => Promise<unknown> | unknown;

interface ElectronLike {
  ipcMain?: { handle(channel: string, fn: (...args: unknown[]) => unknown): void };
  ipcRenderer?: { invoke(channel: string, ...args: unknown[]): Promise<unknown> };
}

async function loadElectron(): Promise<ElectronLike | undefined> {
  try {
    return (await import('electron')) as ElectronLike;
  } catch {
    return undefined;
  }
}

/** 宿主侧桥：注册白名单通道处理器。 */
export interface HostIpcBridge {
  handle(channel: string, fn: IpcHandler): void;
  channels(): string[];
  readonly electron: boolean;
}

/** 客户端侧桥：经白名单通道调用宿主。 */
export interface ClientIpcBridge {
  invoke<T = JsonValue>(channel: string, payload?: JsonValue): Promise<T>;
  readonly electron: boolean;
}

/** 创建宿主侧桥。 */
export async function createHostIpcBridge(): Promise<HostIpcBridge> {
  const electron = await loadElectron();
  const inProcess = new Map<string, IpcHandler>();
  if (electron && electron.ipcMain) {
    return {
      electron: true,
      channels: () => Array.from(inProcess.keys()),
      handle(channel, fn) {
        if (inProcess.has(channel)) throw new Error('IPC 通道重复注册: ' + channel);
        inProcess.set(channel, fn);
        electron.ipcMain!.handle(channel, (_e: unknown, payload: unknown) => fn(payload as JsonValue));
      },
    };
  }
  // 无 Electron：注册到进程内回环，供 client 侧 dispatch。
  const registry = await import('./ipc-registry.js');
  return {
    electron: false,
    channels: () => Array.from(inProcess.keys()),
    handle(channel, fn) {
      if (inProcess.has(channel)) throw new Error('IPC 通道重复注册: ' + channel);
      inProcess.set(channel, fn);
      registry.register(channel, fn);
    },
  };
}

/** 创建客户端侧桥（渲染器侧）。 */
export async function createClientIpcBridge(): Promise<ClientIpcBridge> {
  const electron = await loadElectron();
  if (electron && electron.ipcRenderer) {
    return {
      electron: true,
      invoke<T>(channel: string, payload?: JsonValue) {
        return electron.ipcRenderer!.invoke(channel, payload) as Promise<T>;
      },
    };
  }
  const registry = await import('./ipc-registry.js');
  return {
    electron: false,
    invoke<T>(channel: string, payload?: JsonValue) {
      return registry.dispatch(channel, payload) as Promise<T>;
    },
  };
}
