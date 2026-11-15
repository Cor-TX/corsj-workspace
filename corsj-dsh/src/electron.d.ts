/**
 * @corsj/dsh — Electron 最小类型声明（动态 import，避免将 electron 作为构建期依赖）。
 */
declare module 'electron' {
  export const ipcMain: {
    handle(channel: string, fn: (...args: unknown[]) => unknown): void;
  };
  export const ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  };
  export const app: {
    getPath(name: string): string;
  };
}
