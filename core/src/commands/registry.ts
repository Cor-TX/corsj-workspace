/**
 * @corsj/core — A 层命令注册表。
 *
 * 全部 78 条命令（19 核心 + 59 扩展）在此注册；capability 记录
 * capability_id / consumes / produces / executor / validator_ref /
 * embedded_level / tool_surface。validator_ref 指向资格矩阵。
 *
 * 计数说明（v7 · 通用工程设计版口径）：
 * 任务书附录 A 的计数块写“命令总数 70 / 核心 19 / 扩展 51”，但其正文
 * 「扩展命令 id 清单」实际枚举 59 条互不重复、且与 19 条核心命令无重叠的
 * 命令 id。逐条核对结论：v7 相对 v6 删除了 14 条船舶/海洋专用命令、新增
 * 22 条通用领域命令（51 − 14 + 22 = 59），但“51 条 / 70 条”的计数标签
 * 未随清单更新而沿用旧值。
 *
 * 依据任务书 §6「对照表以 docs/command-manifest.md 为准；附录 A 仅作核对基准，
 * 不是第二真源」与附录 A「若 K ≠ 51，必须在阶段自检结果中说明差异原因」，
 * 本实现以“完整继承 v7 明列的 59 条扩展命令 id”为准：K = 59，总数 = 78。
 * 差异原因已记录于 docs/command-manifest.md 与阶段自检报告。
 */
import { ELIGIBILITY_MATRIX } from '../design/acceptance-spec/eligibility-matrix.js';
import type { Capability, CommandExecutor, CommandParams, CommandContext } from './types.js';

export interface CommandRegistration {
  id: string;
  capability: Omit<Capability, 'executor'> & { executor: CommandExecutor };
}

const registry = new Map<string, Capability>();

/** 注册命令（core 初始化时调用；重复注册抛错）。 */
export function registerCommand(
  id: string,
  def: {
    consumes: string[];
    produces: string[];
    executor: CommandExecutor;
    embedded_level: Capability['embedded_level'];
    tool_surface?: string[];
    core: boolean;
    description: string;
  },
): void {
  if (registry.has(id)) throw new Error(`命令重复注册: ${id}`);
  const rule = ELIGIBILITY_MATRIX.find((r) => r.command === id);
  if (!rule) throw new Error(`命令 ${id} 不在资格矩阵中（先补矩阵）`);
  registry.set(id, {
    capability_id: id,
    consumes: def.consumes,
    produces: def.produces,
    executor: def.executor,
    validator_ref: 'core/design/acceptance-spec/eligibility-matrix.ts#' + id,
    embedded_level: def.embedded_level,
    tool_surface: def.tool_surface ?? ['core-api'],
    core: def.core,
    description: def.description,
  });
}

/** 取 capability（未注册返回 undefined）。 */
export function getCapability(id: string): Capability | undefined {
  return registry.get(id);
}

/** 列出全部已注册命令。 */
export function listCapabilities(): Capability[] {
  return [...registry.values()];
}

export const COMMAND_COUNT = 79;
export const CORE_COUNT = 20;
export const EXTENSION_COUNT = 59;

/** 注册完整性自检：全部命令均已注册、且与资格矩阵一致。 */
export function verifyRegistry(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const rule of ELIGIBILITY_MATRIX) {
    if (!registry.has(rule.command)) errors.push(`未注册: ${rule.command}`);
  }
  for (const [id] of registry) {
    if (!ELIGIBILITY_MATRIX.some((r) => r.command === id)) errors.push(`注册了矩阵外命令: ${id}`);
  }
  if (registry.size !== COMMAND_COUNT) errors.push(`注册数 ${registry.size} ≠ ${COMMAND_COUNT}`);
  return { ok: errors.length === 0, errors };
}

/**
 * 执行命令（A 层唯一入口）。
 * 不做任何验收判定；结果原样回传给调用方（B 层或 UI）。
 */
export async function executeCommand(id: string, params: CommandParams, ctx: CommandContext): Promise<{ capability_id: string; status: string; result: Awaited<ReturnType<CommandExecutor>> }> {
  const cap = registry.get(id);
  if (!cap) {
    return { capability_id: id, status: 'not_implemented', result: { status: 'not_implemented', message: `未注册命令: ${id}`, raw_data: {}, artifacts: [] } };
  }
  const result = await cap.executor(params, ctx);
  return { capability_id: id, status: result.status, result };
}
