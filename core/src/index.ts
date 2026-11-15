/**
 * @corsj/core — 核心包公共出口。
 *
 * 两层：
 * - A 层命令：只执行、产出证据（commands）；
 * - B 层：目标解析 → AcceptanceSpec → 迭代 → 交付门禁（design）。
 */
export * as model from './model/index.js';
export * as commands from './commands/index.js';
export * as design from './design/index.js';
export * as locator from './locator/index.js';
export * as uiContract from './ui-contract/index.js';

// 直接再导出最常用符号，方便上层一行引入。
export {
  EopPackage, stableStringify,
  type EopManifest, type EvidenceRecord, type ObjectRecord, type ObjectType, type Relation,
} from './model/index.js';
export {
  createLocator, findWorkspaceRoot, type CorsjLocator, type LocatorMode, type LocatorOptions,
} from './locator/index.js';
export {
  DesignSession, runDesignLoop, createUnavailableAssetResolver,
  type LoopOptions, type LoopResult, type RoundPlan, type RoundRecord,
} from './design/index.js';
export { GATE_COMMAND_ID } from './design/delivery-gate.js';

/** core 当前版本（与 package.json 一致，构建时由 scripts/version-sync.mjs 同步）。 */
export const CORE_VERSION = '0.1.0';