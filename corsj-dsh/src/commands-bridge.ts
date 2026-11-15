/**
 * @corsj/dsh — DSH 命令桥接（20 条核心命令，宿主侧）。
 *
 * 纪律（任务书 §2.1 / §3）：
 * - 复用 core 同一实现：一律经 @corsj/core/commands 的 executeCommand；
 *   桥接层不复制逻辑、不修改入参、不附加判定；
 * - A 层语义：只回传 status / message / raw_data / artifacts，不比较阈值、
 *   不生成 passed/failed、不迭代、不重试（重试属于 B 层引擎）；
 * - 交付门禁 delivery_gate.submit 不在此暴露：交付结论只能由 B 层
 *   runDesignLoop 内部的 delivery_gate.submit 产生，桥接层显式拒绝该命令；
 * - 不持有任何 API key：本文件不读取任何模型配置，模型调用交给 DSH 全局模型；
 * - 二进制产物不外传：artifacts 只回传路径 / 媒体类型 / 字节数 / sha256。
 */
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCoreCommands, loadCoreRoot } from './core-loader.js';
import {
  asArray,
  asRecord,
  num,
  str,
  recordRun,
  type CoreCapability,
  type CoreCommandContext,
  type CoreCommandsApi,
  type BridgeSession,
  type BridgedResult,
  type BridgedStatus,
} from './model-state.js';

/** DSH 命令面暴露范围：核心 20 条。不含 delivery_gate.submit。 */
export const DSH_EXPOSED_CORE_COMMANDS: readonly string[] = [
  'spec.parse_requirements',
  'geometry.generate',
  'geometry.format_convert',
  'geometry.validity_check',
  'fea.static',
  'eda.schematic_erc',
  'eda.pcb_drc',
  'eda.manufacturing_export',
  'bom.generate',
  'energy.closure_sim',
  'motion.sim',
  'comm.link_budget',
  'arrangement.mass_cg',
  'arrangement.interference',
  'fluid.resistance_solve',
  'propeller.design',
  'thermal.static_estimate',
  'manufacturing.package',
  'report.generate',
  'export.standard_format',
];

/** 硬约束：门禁命令不得出现在 DSH 命令面。 */
export const BRIDGE_EXPOSES_GATE_COMMAND = false;

/** DSH 命令面描述符。 */
export interface DshCommandDescriptor {
  id: string;
  description: string;
  embedded_level: string;
  core: true;
  consumes: string[];
  produces: string[];
  layer: 'A';
  requires_context: true;
}

/** 注册结果 + 与 core 注册表的交叉核对。 */
export interface CoreCommandRegistration {
  ok: boolean;
  commands: DshCommandDescriptor[];
  counts: { total: number; core: number; extension: number };
  surface: {
    exposed: number;
    core_total: number;
    missing: string[];
    extra: string[];
    gate_exposed: false;
  };
  errors: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : String(err);
}

function toDescriptor(c: CoreCapability): DshCommandDescriptor {
  return {
    id: c.capability_id,
    description: c.description,
    embedded_level: c.embedded_level,
    core: true,
    consumes: Array.isArray(c.consumes) ? c.consumes : [],
    produces: Array.isArray(c.produces) ? c.produces : [],
    layer: 'A',
    requires_context: true,
  };
}

function refused(commandId: string, message: string, run: number): BridgedResult {
  return {
    capability_id: commandId,
    status: 'refused',
    message,
    raw_data: {},
    artifacts: [],
    run,
    at: nowIso(),
    layer: 'A',
    verdict: null,
  };
}

/** 剥离二进制载荷，保留可 JSON 序列化的产物元数据。 */
function stripArtifacts(list: unknown): BridgedResult['artifacts'] {
  return asArray(list).map((raw) => {
    const a = asRecord(raw);
    const data = a.data;
    const isBytes = data instanceof Uint8Array;
    return {
      path: str(a.path),
      media_type: str(a.media_type),
      role: a.role === undefined || a.role === null ? undefined : str(a.role),
      bytes: isBytes ? data.byteLength : 0,
      sha256: isBytes ? createHash('sha256').update(data).digest('hex') : '',
    };
  });
}

/**
 * 注册 20 条核心命令到 DSH 命令面，并与 core 注册表交叉核对：
 * 声明暴露集 ⊆ core 核心命令集，且不得包含门禁命令。
 */
export async function registerCoreCommands(): Promise<CoreCommandRegistration> {
  const commands: CoreCommandsApi = await loadCoreCommands();
  const reg = commands.ensureCommandsRegistered();
  const capabilities = commands.listCapabilities();
  const coreCaps = capabilities.filter((c) => c.core);
  const coreIds = new Set(coreCaps.map((c) => c.capability_id));

  const declared = new Set(DSH_EXPOSED_CORE_COMMANDS);
  const missing = DSH_EXPOSED_CORE_COMMANDS.filter((id) => !coreIds.has(id));
  const extra = coreCaps.map((c) => c.capability_id).filter((id) => !declared.has(id));

  const root = await loadCoreRoot();
  const gateExposed = DSH_EXPOSED_CORE_COMMANDS.includes(root.GATE_COMMAND_ID);
  const errors = [...reg.errors];
  if (missing.length) errors.push('暴露集含非核心命令: ' + missing.join(', '));
  if (extra.length) errors.push('核心命令未暴露: ' + extra.join(', '));
  if (gateExposed) errors.push('门禁命令 ' + root.GATE_COMMAND_ID + ' 不得出现在 DSH 命令面');

  const byId = new Map(coreCaps.map((c) => [c.capability_id, c]));
  const ordered = DSH_EXPOSED_CORE_COMMANDS.map((id) => byId.get(id)).filter(
    (c): c is CoreCapability => c !== undefined,
  );

  return {
    ok: errors.length === 0,
    commands: ordered.map(toDescriptor),
    counts: reg.counts,
    surface: {
      exposed: DSH_EXPOSED_CORE_COMMANDS.length,
      core_total: coreCaps.length,
      missing,
      extra,
      gate_exposed: false,
    },
    errors,
  };
}

/** 建立桥接会话：定位器 → scratch 目录 → 空 EopPackage + 不可用资产解析器。 */
export async function createBridgeSession(opts: {
  devRoot?: string;
  userDataRoot?: string;
  installDirs?: string[];
  packageId?: string;
  packageTitle?: string;
} = {}): Promise<BridgeSession> {
  const root = await loadCoreRoot();
  const commands = await loadCoreCommands();
  commands.ensureCommandsRegistered();

  const locator = root.createLocator(
    opts.userDataRoot
      ? { mode: 'user', userDataRoot: opts.userDataRoot, installDirs: opts.installDirs }
      : { mode: 'dev', devRoot: opts.devRoot },
  );
  const scratchDir = join(locator.cacheRoot(), 'scratch');
  locator.assertWritable(scratchDir);
  await mkdir(scratchDir, { recursive: true });

  const packageId = opts.packageId ?? 'PKG-DSH-' + Date.now().toString(36).toUpperCase();
  const pkg = root.EopPackage.create(packageId, opts.packageTitle ?? 'corsj DSH 会话包', root.CORE_VERSION);

  return {
    packageId,
    core_version: root.CORE_VERSION,
    run: 0,
    scratchDir,
    pkg,
    assets: root.createUnavailableAssetResolver(),
  };
}

/**
 * 经桥接执行一条 core 命令（同套实现，透传 A 层回执）。
 * 不暴露的命令 / 门禁命令一律 refused，不落到 core。
 */
export async function bridgeExecute(
  commandId: string,
  params: Record<string, unknown>,
  session: BridgeSession,
  opts: { run?: number } = {},
): Promise<BridgedResult> {
  const root = await loadCoreRoot();
  const nextRun = opts.run ?? session.run + 1;

  if (commandId === root.GATE_COMMAND_ID) {
    return refused(
      commandId,
      '拒绝执行 ' + commandId + '：交付门禁不可经 DSH 命令面调用，交付结论只能来自 B 层 runDesignLoop 内部的 delivery_gate.submit',
      nextRun,
    );
  }
  if (!DSH_EXPOSED_CORE_COMMANDS.includes(commandId)) {
    return refused(
      commandId,
      '命令 ' + commandId + ' 不在 DSH 暴露面（仅 20 条核心命令；扩展命令保持 core 内 not_implemented 骨架）',
      nextRun,
    );
  }

  const commands: CoreCommandsApi = await loadCoreCommands();
  session.run = nextRun;

  const ctx: CoreCommandContext = {
    pkg: session.pkg,
    run: nextRun,
    scratchDir: session.scratchDir,
    assets: session.assets,
  };

  try {
    const out = await commands.executeCommand(commandId, params, ctx);
    const result = asRecord(out.result);
    const status = str(out.status, 'env_error') as BridgedStatus;
    const message = str(result.message);
    const rawData = asRecord(result.raw_data);
    const artifacts = stripArtifacts(result.artifacts);
    recordRun(str(out.capability_id, commandId), status, nextRun);
    return {
      capability_id: str(out.capability_id, commandId),
      status,
      message,
      raw_data: rawData,
      artifacts,
      run: nextRun,
      at: nowIso(),
      layer: 'A',
      verdict: null,
    };
  } catch (err) {
    const message = '桥接执行异常（' + commandId + '）：' + describeError(err);
    recordRun(commandId, 'env_error', nextRun);
    return {
      capability_id: commandId,
      status: 'env_error',
      message,
      raw_data: { error: message },
      artifacts: [],
      run: nextRun,
      at: nowIso(),
      layer: 'A',
      verdict: null,
    };
  }
}

/** 便捷入口：一次性执行（自动建会话），供 DSH 单命令调用使用。 */
export async function runSingleCommand(
  commandId: string,
  params: Record<string, unknown> = {},
  session?: BridgeSession,
): Promise<BridgedResult> {
  const s = session ?? (await createBridgeSession());
  return bridgeExecute(commandId, params, s);
}

/** 运行号读取（诊断用）。 */
export function sessionRun(session: BridgeSession): number {
  return num(session.run, 0);
}
