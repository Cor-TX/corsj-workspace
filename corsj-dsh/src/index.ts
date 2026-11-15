/**
 * @corsj/dsh 鈥?DSH/Cordis bundle 鎻掍欢锛堥樁娈典簩瀹屾暣瀹炵幇锛屽涓讳晶锛夈€? *
 * 浜や粯闈細
 * - cordis 鎻掍欢鍏ュ彛 apply(ctx, config)锛氳閰?IPC 鐧藉悕鍗曘€乧ore 妗ユ帴銆佹ā鍨嬫寔涔呭寲锛? * - dshActions锛歰penCommandPanel / runCommand / getOverlayContent / getModel锛? * - 鍛戒护杞彂锛氭覆鏌撳櫒缁?ipcRenderer.invoke 鈫?鏈涓?ipcMain.handle 鈫?@cor-tx/core锛? *   娓叉煋鍣ㄦ棤鐩存帴 Node 鏉冮檺锛岀姝㈢洿鎺?import @cor-tx/core銆? *
 * 涓嶅彲鍗忓晢鐨勭害鏉燂細
 * - 缁濅笉璇诲彇 DSH 鐢ㄦ埛閰嶇疆锛堟ā鍨?key / 浼氳瘽鍐呭锛夛紱鏈枃浠朵笉 import 浠讳綍瀹夸富閰嶇疆 API锛? * - 闂ㄧ鐘舵€佸彧璇诲睍绀猴細浜や粯缁撹鍙兘鏉ヨ嚜 core 鐨?delivery_gate.submit锛? * - 妯″瀷璋冪敤浜ょ粰 DSH 鍏ㄥ眬妯″瀷锛氭湰鎻掍欢涓嶆寔鏈夈€佷笉杞彂銆佷笉钀界洏浠讳綍 API key銆? */
import { join } from 'node:path';
import { loadCoreCommands, loadCoreRoot } from './core-loader.js';
import { IPC_CHANNELS, createHostIpcBridge, type HostIpcBridge } from './ipc.js';
import { PersistenceFingerprintError, SessionStore } from './persistence.js';
import {
  bridgeExecute,
  createBridgeSession,
  registerCoreCommands,
  DSH_EXPOSED_CORE_COMMANDS,
  type CoreCommandRegistration,
  type DshCommandDescriptor,
} from './commands-bridge.js';
import {
  asArray,
  asRecord,
  getDshModel,
  num,
  recordRun,
  resetModel,
  str,
  type DshModel,
} from './model-state.js';
import {
  renderOverlayDocument,
  type OverlayClarification,
  type OverlayDegradation,
  type OverlayDocument,
  type OverlayGate,
  type OverlayRoundSummary,
  type OverlayThreshold,
  type OverlayTimelineEntry,
  type OverlayValidatorOutcome,
  type OverlayView,
} from './overlay.js';
import { INVARIANTS, type CoreCapability, type BridgeSession, type BridgedResult } from './types.js';

// ---------------------------------------------------------------------------
// 鏄犲皠宸ュ叿锛堢函鏄犲皠锛屼笉鍋氬垽瀹氾級
// ---------------------------------------------------------------------------

function optionalStr(v: unknown): string | undefined {
  return v === null || v === undefined || v === '' ? undefined : str(v);
}

function mapThreshold(v: unknown): OverlayThreshold {
  const t = asRecord(v);
  const out: OverlayThreshold = {
    field: str(t.field),
    op: str(t.op),
    expected: str(t.expected),
    actual: str(t.actual),
    passed: t.passed === true,
  };
  const note = optionalStr(t.note);
  if (note !== undefined) out.note = note;
  return out;
}

function mapValidator(v: unknown): OverlayValidatorOutcome {
  const o = asRecord(v);
  return {
    validator_id: str(o.validator_id),
    command: str(o.command),
    strength: o.strength === 'REQUIRED' ? 'REQUIRED' : 'optional',
    passed: o.passed === true,
    degraded: o.degraded === true,
    evidence_present: o.evidence_present === true,
    detail: str(o.detail),
    thresholds: asArray(o.thresholds).map(mapThreshold),
  };
}

function mapDegradation(v: unknown): OverlayDegradation {
  const d = asRecord(v);
  return {
    id: str(d.id),
    command: str(d.command),
    kind: str(d.kind),
    reason: str(d.reason),
    affected_validators: asArray(d.affected_validators).map((x) => str(x)),
    at: str(d.at),
  };
}

function mapGate(v: unknown): OverlayGate | undefined {
  const g = asRecord(v);
  const decision: 'delivered' | 'rejected' | undefined =
    g.decision === 'delivered' ? 'delivered' : g.decision === 'rejected' ? 'rejected' : undefined;
  if (decision === undefined) return undefined;
  const s = asRecord(g.summary);
  return {
    decision,
    code: str(g.code),
    branch: optionalStr(g.branch),
    message: str(g.message),
    signature: str(g.signature),
    generated_at: str(g.generated_at),
    summary: {
      required_total: num(s.required_total),
      required_passed: num(s.required_passed),
      required_failed: num(s.required_failed),
      optional_total: num(s.optional_total),
      optional_passed: num(s.optional_passed),
      degraded_count: num(s.degraded_count),
      cannot_verify: num(s.cannot_verify),
    },
  };
}

function currentCoreInfo(): Pick<OverlayView['region_a'], 'core_version' | 'registry_ok' | 'registry_errors' | 'counts'> {
  const m = getDshModel();
  return {
    core_version: m.core_version,
    registry_ok: m.registry_ok,
    registry_errors: m.registry_errors,
    counts: m.counts,
  };
}

/** 灏氭湭杩愯闂幆鏃剁殑绌鸿鍥撅紙浠嶅睍绀哄懡浠ら潰涓庢敞鍐岃〃鐘舵€侊級銆?*/
function emptyOverlayView(): OverlayView {
  return {
    generated_at: new Date().toISOString(),
    gate_authority: INVARIANTS.gate_authority,
    ui_may_declare_delivered: false,
    region_a: { goal_summary: '', clarifications: [], ...currentCoreInfo() },
    region_b: { state: 'IDLE', round: 0, max_rounds: 0, env_retries: 0, timeline: [], rounds: [], recent: [] },
    region_c: { delivered: false, required: [], optional: [], degradation: [] },
  };
}

/** LoopResult 鈫?OverlayView锛堝敮涓€浜や粯缁撹鍙栬嚜 verdict锛夈€?*/
function viewFromLoop(res: unknown): OverlayView {
  const r = asRecord(res);
  const spec = asRecord(r.spec);
  const verdict = asRecord(r.verdict);
  const gate = mapGate(r.verdict);
  const perValidator = asArray(verdict.per_validator).map(mapValidator);

  const timeline: OverlayTimelineEntry[] = asArray(r.timeline).map((t) => {
    const e = asRecord(t);
    return { from: str(e.from), to: str(e.to), at: str(e.at), reason: str(e.reason) };
  });

  const rounds: OverlayRoundSummary[] = asArray(r.rounds).map((x) => {
    const rr = asRecord(x);
    const rv = asRecord(rr.verdict);
    return {
      round: num(rr.round),
      design: asArray(rr.design).length,
      validation: asArray(rr.validation).length,
      decision: optionalStr(rv.decision),
      code: optionalStr(rv.code),
      degraded: asArray(rr.degradation).length,
    };
  });

  const clarifications: OverlayClarification[] = asArray(r.clarifications).map((c) => {
    const q = asRecord(c);
    return { id: str(q.id), validator_id: str(q.validator_id), question: str(q.question), status: str(q.status) };
  });

  return {
    generated_at: new Date().toISOString(),
    gate_authority: INVARIANTS.gate_authority,
    ui_may_declare_delivered: false,
    region_a: { goal_summary: str(spec.goal_text), clarifications, ...currentCoreInfo() },
    region_b: {
      state: str(r.state, 'UNKNOWN'),
      round: num(r.used_rounds),
      max_rounds: num(r.max_rounds),
      env_retries: num(r.env_retries),
      timeline,
      rounds,
      recent: [...getDshModel().recent],
    },
    region_c: {
      delivered: r.delivered === true,
      gate,
      required: perValidator.filter((v) => v.strength === 'REQUIRED'),
      optional: perValidator.filter((v) => v.strength === 'optional'),
      degradation: asArray(r.degradation).map(mapDegradation),
      package_path: optionalStr(r.package_path),
      package_fingerprint: optionalStr(r.package_fingerprint),
    },
  };
}

// ---------------------------------------------------------------------------
// 娉ㄥ唽琛ㄥ埛鏂?// ---------------------------------------------------------------------------

async function refreshRegistry(): Promise<{
  ok: boolean;
  errors: string[];
  counts: { total: number; core: number; extension: number };
  capabilities: CoreCapability[];
}> {
  const commands = await loadCoreCommands();
  const root = await loadCoreRoot();
  const reg = commands.ensureCommandsRegistered();
  const capabilities = commands.listCapabilities();
  const m = getDshModel();
  m.core_version = root.CORE_VERSION;
  m.registry_ok = reg.ok;
  m.registry_errors = reg.errors;
  m.counts = reg.counts;
  return { ok: reg.ok, errors: reg.errors, counts: reg.counts, capabilities };
}

// ---------------------------------------------------------------------------
// dshAction 1/4锛歡etModel
// ---------------------------------------------------------------------------

/** 鍙妯″瀷蹇収锛堝惈鎸佷箙鍖栫姸鎬侊級銆?*/
export function getModel(): Readonly<DshModel> {
  return getDshModel();
}

// ---------------------------------------------------------------------------
// dshAction 2/4锛歰penCommandPanel 鈥斺€?sidebar.footer.action
// ---------------------------------------------------------------------------

export interface CommandPanelCommand {
  id: string;
  description: string;
  embedded_level: string;
  core: boolean;
  consumes: string[];
  produces: string[];
}

export interface CommandPanelPayload {
  ok: boolean;
  action: 'openCommandPanel';
  slot: 'sidebar.footer.action';
  opens: 'command-panel';
  at: string;
  core_version: string;
  registry: { ok: boolean; errors: string[]; counts: { total: number; core: number; extension: number } };
  core_commands: CommandPanelCommand[];
  extension_commands: CommandPanelCommand[];
  surface: CoreCommandRegistration['surface'];
  gate: {
    authority: string;
    ui_may_declare_delivered: false;
    callable_from_panel: false;
    last_verdict: DshModel['last_loop'] | null;
  };
  overlay: { action: 'getOverlayContent'; slot: 'shell.overlay' };
  invariants: typeof INVARIANTS;
}

export interface OpenCommandPanelArgs {
  includeExtensions?: boolean;
}

/** sidebar.footer.action 澶勭悊鍣細杩斿洖 A 鍖哄懡浠ら潰鏉挎暟鎹紙鍙锛屼笉鎵ц浠讳綍鍛戒护锛夈€?*/
export async function openCommandPanel(args: OpenCommandPanelArgs = {}): Promise<CommandPanelPayload> {
  const reg = await refreshRegistry();
  const registration = await registerCoreCommands();
  const coreIds = new Set(DSH_EXPOSED_CORE_COMMANDS);

  const core_commands: CommandPanelCommand[] = registration.commands.map((d: DshCommandDescriptor) => ({
    id: d.id,
    description: d.description,
    embedded_level: d.embedded_level,
    core: true,
    consumes: d.consumes,
    produces: d.produces,
  }));

  const extension_commands: CommandPanelCommand[] =
    args.includeExtensions === false
      ? []
      : reg.capabilities
          .filter((c) => !c.core || !coreIds.has(c.capability_id))
          .filter((c) => !c.core)
          .map((c) => ({
            id: c.capability_id,
            description: c.description,
            embedded_level: c.embedded_level,
            core: false,
            consumes: c.consumes,
            produces: c.produces,
          }));

  return {
    ok: registration.ok,
    action: 'openCommandPanel',
    slot: 'sidebar.footer.action',
    opens: 'command-panel',
    at: new Date().toISOString(),
    core_version: getDshModel().core_version,
    registry: { ok: reg.ok, errors: reg.errors, counts: reg.counts },
    core_commands,
    extension_commands,
    surface: registration.surface,
    gate: {
      authority: INVARIANTS.gate_authority,
      ui_may_declare_delivered: false,
      callable_from_panel: false,
      last_verdict: getDshModel().last_loop ?? null,
    },
    overlay: { action: 'getOverlayContent', slot: 'shell.overlay' },
    invariants: INVARIANTS,
  };
}

// ---------------------------------------------------------------------------
// dshAction 3/4锛歳unCommand 鈥斺€?A 灞?executeCommand / B 灞?runDesignLoop
// ---------------------------------------------------------------------------

export type RunCommandMode = 'command' | 'loop';

export interface RunCommandArgs {
  mode?: RunCommandMode;
  command?: string;
  params?: Record<string, unknown>;
  goalText?: string;
  plan?: unknown;
  authorization?: unknown;
  devRoot?: string;
  userDataRoot?: string;
  installDirs?: string[];
  packageId?: string;
  packageTitle?: string;
  run?: number;
}

/** 闂幆缁撴灉鎽樿锛堜笉鍚?package_bytes锛屼繚鎸?JSON 鍙簭鍒楀寲锛夈€?*/
export interface LoopSummary {
  state: string;
  delivered: boolean;
  used_rounds: number;
  max_rounds: number;
  env_retries: number;
  verdict?: OverlayGate;
  rounds: number;
  degradation_count: number;
  required_passed: number;
  required_total: number;
  package_path?: string;
  package_fingerprint?: string;
  errors: string[];
  clarifications: number;
  gate_report_markdown?: string;
}

export interface RunCommandResult {
  ok: boolean;
  mode: RunCommandMode;
  status: string;
  message: string;
  at: string;
  receipt?: BridgedResult;
  loop?: LoopSummary;
  gate_authority: string;
  ui_may_declare_delivered: false;
}

function summarizeLoop(res: unknown): LoopSummary {
  const r = asRecord(res);
  const gate = mapGate(r.verdict);
  return {
    state: str(r.state, 'UNKNOWN'),
    delivered: r.delivered === true,
    used_rounds: num(r.used_rounds),
    max_rounds: num(r.max_rounds),
    env_retries: num(r.env_retries),
    verdict: gate,
    rounds: asArray(r.rounds).length,
    degradation_count: asArray(r.degradation).length,
    required_passed: gate?.summary.required_passed ?? 0,
    required_total: gate?.summary.required_total ?? 0,
    package_path: optionalStr(r.package_path),
    package_fingerprint: optionalStr(r.package_fingerprint),
    errors: asArray(r.errors).map((e) => str(e)),
    clarifications: asArray(r.clarifications).length,
    gate_report_markdown: optionalStr(r.gate_report_markdown),
  };
}

/** 褰撳墠妗ユ帴浼氳瘽锛堝崟鍛戒护妯″紡鍏变韩涓€涓?.eop 鍖咃級銆?*/
let bridgeSession: BridgeSession | undefined;

export function currentBridgeSession(): BridgeSession | undefined {
  return bridgeSession;
}

export function resetBridgeSession(): void {
  bridgeSession = undefined;
}

async function sessionFor(args: RunCommandArgs): Promise<BridgeSession> {
  if (!bridgeSession) {
    bridgeSession = await createBridgeSession({
      devRoot: args.devRoot,
      userDataRoot: args.userDataRoot,
      installDirs: args.installDirs,
      packageId: args.packageId,
      packageTitle: args.packageTitle,
    });
  }
  return bridgeSession;
}

function failure(mode: RunCommandMode, status: string, message: string): RunCommandResult {
  return {
    ok: false,
    mode,
    status,
    message,
    at: new Date().toISOString(),
    gate_authority: INVARIANTS.gate_authority,
    ui_may_declare_delivered: false,
  };
}

/**
 * 杩愯 core 鍛戒护锛? * - mode='command'锛欰 灞?executeCommand锛堝洖浼?status / raw_data / artifacts锛夛紱
 * - mode='loop'锛欱 灞?runDesignLoop锛堣凯浠?+ delivery_gate.submit锛屽敮涓€浜や粯鍑哄彛锛夈€? */
export async function runCommand(args: RunCommandArgs): Promise<RunCommandResult> {
  const mode: RunCommandMode = args.mode ?? (args.goalText ? 'loop' : 'command');

  if (mode === 'command') {
    if (!args.command) {
      return failure('command', 'design_error', '缂哄皯 command锛氬崟鍛戒护妯″紡闇€瑕佹彁渚?core 鍛戒护 id');
    }
    const session = await sessionFor(args);
    const receipt = await bridgeExecute(
      args.command,
      args.params ?? {},
      session,
      args.run !== undefined ? { run: args.run } : {},
    );
    return {
      ok: receipt.status === 'success',
      mode: 'command',
      status: receipt.status,
      message: receipt.message,
      at: receipt.at,
      receipt,
      gate_authority: INVARIANTS.gate_authority,
      ui_may_declare_delivered: false,
    };
  }

  if (!args.goalText) {
    return failure('loop', 'design_error', '缂哄皯 goalText锛氶棴鐜ā寮忛渶瑕佽璁＄洰鏍囧師鏂?);
  }
  const plan = asArray(args.plan);
  if (plan.length === 0) {
    return failure(
      'loop',
      'design_error',
      '缂哄皯 plan锛欱 灞備笉鐢熸垚璁捐鍐呭锛岃鐢辫皟鐢ㄦ柟锛圖SH 鍏ㄥ眬妯″瀷锛夋彁渚涙寜杞鐨?RoundPlan[]',
    );
  }

  const res = await runDesignLoopViaCore({
    goalText: args.goalText,
    plan,
    authorization: args.authorization,
    devRoot: args.devRoot,
    userDataRoot: args.userDataRoot,
    installDirs: args.installDirs,
    packageId: args.packageId,
    packageTitle: args.packageTitle,
  });
  const loop = summarizeLoop(res);
  return {
    ok: loop.delivered,
    mode: 'loop',
    status: loop.state,
    message: loop.verdict ? loop.verdict.message : '闂幆缁撴潫浜?' + loop.state,
    at: new Date().toISOString(),
    loop,
    gate_authority: INVARIANTS.gate_authority,
    ui_may_declare_delivered: false,
  };
}

export interface RunLoopArgs {
  goalText: string;
  plan: unknown;
  authorization?: unknown;
  devRoot?: string;
  userDataRoot?: string;
  installDirs?: string[];
  packageId?: string;
  packageTitle?: string;
}

/**
 * 杩愯涓€娆′竷姝ヨ璁￠棴鐜紙B 灞傚畬鏁磋矾寰勶紱闂ㄧ鍦?loop 鍐呴儴锛屼笉鍙粫杩囷級銆? * 澶嶇敤 core 鐨?runDesignLoop锛氭湰鍑芥暟鍙仛鍙傛暟瑁呴厤涓庡彧璇昏鍥捐褰曘€? */
export async function runDesignLoopViaCore(opts: RunLoopArgs): Promise<Record<string, unknown>> {
  const root = await loadCoreRoot();
  await refreshRegistry();

  const loopOpts: Record<string, unknown> = {
    goalText: opts.goalText,
    plan: opts.plan,
    coreVersion: root.CORE_VERSION,
    packageId: opts.packageId ?? 'PKG-DSH-' + Date.now().toString(36).toUpperCase(),
  };
  if (opts.packageTitle !== undefined) loopOpts.packageTitle = opts.packageTitle;
  if (opts.authorization !== undefined) loopOpts.authorization = opts.authorization;
  if (opts.devRoot !== undefined) loopOpts.devRoot = opts.devRoot;
  if (opts.userDataRoot !== undefined) loopOpts.userDataRoot = opts.userDataRoot;
  if (opts.installDirs !== undefined) loopOpts.installDirs = opts.installDirs;

  const res = (await root.runDesignLoop(loopOpts)) as Record<string, unknown>;

  for (const raw of asArray(res.evidence)) {
    const ev = asRecord(raw);
    const command = str(ev.command ?? ev.command_id ?? ev.capability_id, 'unknown');
    recordRun(command, str(ev.status, 'unknown'), num(ev.run, 0));
  }

  const gate = mapGate(res.verdict);
  const degradation = asArray(res.degradation);
  const m = getDshModel();
  m.last_loop = {
    state: str(res.state, 'UNKNOWN'),
    delivered: res.delivered === true,
    used_rounds: num(res.used_rounds),
    max_rounds: num(res.max_rounds),
    verdict_decision: gate?.decision,
    verdict_code: gate?.code,
    required_passed: gate?.summary.required_passed ?? 0,
    required_total: gate?.summary.required_total ?? 0,
    degraded_count: degradation.length,
    package_path: optionalStr(res.package_path),
    package_fingerprint: optionalStr(res.package_fingerprint),
    at: new Date().toISOString(),
  };
  m.overlay_view = viewFromLoop(res);
  return res;
}

// ---------------------------------------------------------------------------
// dshAction 4/4锛歡etOverlayContent 鈥斺€?shell.overlay
// ---------------------------------------------------------------------------

export interface GetOverlayContentArgs {
  loopResult?: unknown;
  includeView?: boolean;
}

export interface OverlayContentPayload extends OverlayDocument {
  ok: true;
  action: 'getOverlayContent';
  slot: 'shell.overlay';
  view?: OverlayView;
  gate_callable: false;
  invariants: typeof INVARIANTS;
}

/** shell.overlay 澶勭悊鍣細杩斿洖鍏ㄥ睆鍙闈㈡澘 HTML锛堥棬绂佺姸鎬?/ REQUIRED 姹囨€?/ 杞 / 鏈€杩戝懡浠わ級銆?*/
export async function getOverlayContent(args: GetOverlayContentArgs = {}): Promise<OverlayContentPayload> {
  let view: OverlayView;
  if (args.loopResult !== undefined) {
    view = viewFromLoop(args.loopResult);
  } else {
    await refreshRegistry();
    view = getDshModel().overlay_view ?? emptyOverlayView();
  }

  view.region_a = { ...view.region_a, ...currentCoreInfo() };
  view.region_b = { ...view.region_b, recent: [...getDshModel().recent] };
  view.generated_at = new Date().toISOString();

  const doc = renderOverlayDocument(view);
  const payload: OverlayContentPayload = {
    ok: true,
    action: 'getOverlayContent',
    slot: 'shell.overlay',
    gate_callable: false,
    invariants: INVARIANTS,
    ...doc,
  };
  if (args.includeView !== false) payload.view = view;
  return payload;
}

// ---------------------------------------------------------------------------
// 鎻掍欢瑁呴厤锛欼PC 鐧藉悕鍗?+ core 妗ユ帴 + 妯″瀷鎸佷箙鍖?// ---------------------------------------------------------------------------

export interface ApplyConfig {
  /** 浼氳瘽鏍圭洰褰曪紙榛樿 <userData>/dsh/sessions锛涙棤 Electron 鏃?.cache/dsh-sessions锛夈€?*/
  sessionsDir?: string;
  /** 浼氳瘽 id锛堥粯璁?dsh-corsj-session锛夈€?*/
  sessionId?: string;
  /** 鏄惁鍦?apply 鏃舵墽琛屽惎鍔ㄦ寚绾规牎楠岋紙榛樿 true锛夈€?*/
  validateOnStart?: boolean;
}

/** 瑙ｆ瀽浼氳瘽鏍圭洰褰曪細浼樺厛 config锛屽叾娆?Electron userData锛屾渶鍚庡伐浣滃尯 .cache銆?*/
async function resolveSessionsDir(config: ApplyConfig): Promise<string> {
  if (config.sessionsDir) return config.sessionsDir;
  try {
    const electron = (await import('electron')) as { app?: { getPath(name: string): string } };
    if (electron.app && typeof electron.app.getPath === 'function') {
      return join(electron.app.getPath('userData'), 'dsh', 'sessions');
    }
  } catch {
    // 鏃?Electron
  }
  return join(process.cwd(), '.cache', 'dsh-sessions');
}

/** 浠庢寔涔呭寲璁板綍鎭㈠妯″瀷锛堝惎鍔ㄦ椂锛夈€?*/
function restoreFromRecords(records: unknown[]): void {
  for (const raw of records) {
    const rec = asRecord(raw);
    if (rec.type === 'model') {
      const m = asRecord(rec.model);
      const model = getDshModel();
      model.core_version = str(m.core_version, model.core_version);
      model.registry_ok = m.registry_ok === true;
      model.registry_errors = asArray(m.registry_errors).map((x) => str(x));
      model.counts = asRecord(m.counts) as DshModel['counts'];
      model.commands = asRecord(m.commands) as DshModel['commands'];
      model.recent = asArray(m.recent).map((x) => asRecord(x)) as DshModel['recent'];
      if (m.last_loop !== undefined) model.last_loop = m.last_loop as DshModel['last_loop'];
    }
  }
}

/** 鎸佷箙鍖栧綋鍓嶆ā鍨嬶紙瀹夸富渚э紝姣忔鍏抽敭鍔ㄤ綔鍚庤皟鐢級銆?*/
async function persistModel(store: SessionStore, sessionId: string): Promise<void> {
  const m = getDshModel();
  const records = [
    {
      type: 'model',
      at: new Date().toISOString(),
      model: {
        core_version: m.core_version,
        registry_ok: m.registry_ok,
        registry_errors: m.registry_errors,
        counts: m.counts,
        commands: m.commands,
        recent: m.recent,
        last_loop: m.last_loop,
      },
    },
  ];
  await store.save(sessionId, m.core_version, records);
}

/** cordis 鎻掍欢鍏ュ彛锛堝涓讳晶锛夈€?*/
export async function apply(ctx: unknown, config: ApplyConfig = {}): Promise<void> {
  const bridge: HostIpcBridge = await createHostIpcBridge();
  const root = await loadCoreRoot();
  const stringify = (x: unknown): string => root.stableStringify(x);
  const sessionsDir = await resolveSessionsDir(config);
  const sessionId = config.sessionId ?? 'dsh-corsj-session';
  const store = new SessionStore({ sessionsDir, stringify });

  // 鍚姩鎸囩汗鏍￠獙
  const m = getDshModel();
  m.persistence_ok = false;
  m.persistence_errors = [];
  if (config.validateOnStart !== false) {
    try {
      const sessions = await store.listSessions();
      if (sessions.length > 0) {
        const loaded = await store.load(sessions[sessions.length - 1]);
        restoreFromRecords(loaded.records);
        m.persistence_ok = true;
      } else {
        m.persistence_ok = true;
      }
    } catch (err) {
      m.persistence_ok = false;
      if (err instanceof PersistenceFingerprintError) {
        m.persistence_errors.push(err.message);
      } else {
        m.persistence_errors.push('鎸佷箙鍖栨牎楠屽紓甯? ' + String(err));
      }
    }
  }

  // 鍒锋柊娉ㄥ唽琛?  await refreshRegistry();
  await registerCoreCommands();

  // 娉ㄥ唽 IPC 鐧藉悕鍗曢€氶亾
  bridge.handle(IPC_CHANNELS.sysinfo, async () => {
    await refreshRegistry();
    return {
      core_version: getDshModel().core_version,
      registry_ok: getDshModel().registry_ok,
      registry_errors: getDshModel().registry_errors,
      counts: getDshModel().counts,
      persistence_ok: getDshModel().persistence_ok,
      persistence_errors: getDshModel().persistence_errors,
      sessions_dir: sessionsDir,
      invariants: INVARIANTS,
    };
  });

  bridge.handle(IPC_CHANNELS.listCommands, async () => {
    const reg = await registerCoreCommands();
    return { commands: reg.commands, surface: reg.surface, counts: reg.counts };
  });

  bridge.handle(IPC_CHANNELS.openPanel, async (payload) => {
    const args = asRecord(payload);
    return openCommandPanel(args as OpenCommandPanelArgs);
  });

  bridge.handle(IPC_CHANNELS.runCommand, async (payload) => {
    const args = asRecord(payload);
    const result = await runCommand(args as RunCommandArgs);
    try {
      await persistModel(store, sessionId);
    } catch (err) {
      m.persistence_ok = false;
      m.persistence_errors.push('鎸佷箙鍖栧啓鍏ュけ璐? ' + String(err));
    }
    return result;
  });

  bridge.handle(IPC_CHANNELS.getOverlay, async (payload) => {
    const args = asRecord(payload);
    return getOverlayContent(args as GetOverlayContentArgs);
  });

  bridge.handle(IPC_CHANNELS.modelGet, async () => {
    return getDshModel();
  });

  // 鏆撮湶瑁呴厤淇℃伅锛堣瘖鏂敤锛?  (ctx as { [k: string]: unknown } | undefined) && undefined;
}

// ---------------------------------------------------------------------------
// 鎻掍欢瀵煎嚭闈?// ---------------------------------------------------------------------------

/** DSH 鍔ㄤ綔闈細瀹夸富鎸夋Ы浣嶈皟鐢ㄣ€?*/
export const dshActions = {
  openCommandPanel,
  runCommand,
  getOverlayContent,
  getModel,
} as const;

/** 妲戒綅 鈫?鍔ㄤ綔鍚嶇粦瀹氥€?*/
export const dshSlots = {
  'sidebar.footer.action': 'openCommandPanel',
  'shell.overlay': 'getOverlayContent',
} as const;

export const dshPlugin = {
  name: 'dsh-corsj',
  version: '0.1.0',
  slots: dshSlots,
  actions: dshActions,
  invariants: INVARIANTS,
  apply,
} as const;

export { resetModel } from './model-state.js';
export { resetCoreCache } from './core-loader.js';

export default dshPlugin;
