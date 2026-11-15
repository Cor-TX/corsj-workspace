/**
 * corsj-app — 预加载脚本。
 * 通过 contextBridge 暴露白名单 API；渲染器无 Node 权限。
 */
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  sysinfo: () => ipcRenderer.invoke('corsj:sysinfo'),
  listCommands: () => ipcRenderer.invoke('corsj:list-commands'),
  runDesignLoop: (opts: unknown) => ipcRenderer.invoke('corsj:run-design-loop', opts),
  runStream: (opts: unknown) => ipcRenderer.invoke('corsj:run-stream', opts),
  loadView: (p: string) => ipcRenderer.invoke('corsj:load-view', p),
  importEop: (p: string) => ipcRenderer.invoke('corsj:import-eop', p),
  exportFormat: (opts: unknown) => ipcRenderer.invoke('corsj:export-format', opts),
  listArtifacts: (p: string) => ipcRenderer.invoke('corsj:list-artifacts', p),
  /** 订阅主进程流式事件；返回取消订阅函数。 */
  onEvent: (cb: (ev: unknown) => void): (() => void) => {
    const handler = (_e: unknown, ev: unknown): void => cb(ev);
    ipcRenderer.on('corsj:event', handler);
    return () => ipcRenderer.removeListener('corsj:event', handler);
  },
  modelProvider: {
    get: () => ipcRenderer.invoke('corsj:model-provider:get'),
    set: (cfg: unknown) => ipcRenderer.invoke('corsj:model-provider:set', cfg),
  },
};

contextBridge.exposeInMainWorld('corsj', api);
