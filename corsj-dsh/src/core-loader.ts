/**
 * @corsj/dsh �?@cor-tx/core 加载器（仅宿主侧）�? *
 * 渲染器（客户端）不得 import 本模块，也不得直�?import @cor-tx/core�? * 渲染器只能经 IPC 白名单通道调用宿主，由宿主在本模块加载 core 并执行�? *
 * core �?ESM 包；本插件同�?ESM（package.json "type": "module"）�? * 通过 createRequire 解析子路径，再经 pathToFileURL 动�?import()�? */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { CoreRootApi, CoreCommandsApi } from './types.js';

const nodeRequire = createRequire(import.meta.url);
const coreCache: { root?: CoreRootApi; commands?: CoreCommandsApi } = {};

async function importSpecifier<T>(specifier: string): Promise<T> {
  const resolved = nodeRequire.resolve(specifier);
  return (await import(pathToFileURL(resolved).href)) as T;
}

/** 加载 @cor-tx/core 根出口（幂等）�?*/
export async function loadCoreRoot(): Promise<CoreRootApi> {
  if (!coreCache.root) coreCache.root = await importSpecifier<CoreRootApi>('@cor-tx/core');
  return coreCache.root;
}

/** 加载 @cor-tx/core/commands（幂等；A 层注册表在这里，不在根出口）�?*/
export async function loadCoreCommands(): Promise<CoreCommandsApi> {
  if (!coreCache.commands) coreCache.commands = await importSpecifier<CoreCommandsApi>('@cor-tx/core/commands');
  return coreCache.commands;
}

/** 重置缓存（自检用）�?*/
export function resetCoreCache(): void {
  coreCache.root = undefined;
  coreCache.commands = undefined;
}
