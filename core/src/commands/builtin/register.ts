/**
 * @corsj/core — 命令注册总入口。
 *
 * 一次性把 79 条命令装进注册表：
 * - 核心 20 条：import 三个实现文件即自注册（模块顶层 registerCommand）。
 * - 扩展 59 条：显式调用 registerExtensionCommands()。
 *
 * 用法（core 侧）： `import { ensureCommandsRegistered } from './commands/builtin/register.js';`
 * 职责幂等：重复调用不会重复注册。
 */
import { listCapabilities, verifyRegistry, COMMAND_COUNT, CORE_COUNT, EXTENSION_COUNT } from '../registry.js';
import { registerExtensionCommands } from './extension-commands.js';

// 副作用导入：三个核心命令实现文件在模块顶层注册。
import '../core-commands-1.js';
import '../core-commands-2.js';
import '../core-commands-3.js';

let bootstrapped = false;

/** 注册扩展命令骨架（幂等）。 */
function bootstrapExtensions(): void {
  if (bootstrapped) return;
  // 仅当扩展尚未注册时注册，避免重复注册异常。
  const existing = new Set(listCapabilities().map((c) => c.capability_id));
  if (existing.size < COMMAND_COUNT) registerExtensionCommands();
  bootstrapped = true;
}

/**
 * 确保全部 79 条命令已注册，并返回注册完整性自检结果。
 * 首次调用会注册扩展骨架；后续调用直接复用。
 */
export function ensureCommandsRegistered(): { ok: boolean; errors: string[]; counts: { total: number; core: number; extension: number } } {
  bootstrapExtensions();
  const check = verifyRegistry();
  return {
    ok: check.ok,
    errors: check.errors,
    counts: { total: COMMAND_COUNT, core: CORE_COUNT, extension: EXTENSION_COUNT },
  };
}
