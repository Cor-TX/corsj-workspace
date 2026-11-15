/**
 * @corsj/core — B 层设计会话引擎。
 *
 * 职责：
 * - 驱动状态机 PARSING → … → DELIVERED / FAILED。
 * - 调用 A 层命令、采集证据、写 .eop、留降级记录。
 * - 在 VERIFYING / DELIVERING 阶段调用门禁（唯一交付路径）。
 * - 环境错误（env_error）按 max_env_retries 重试；不计入设计轮次。
 *
 * 不属于本引擎：目标语义理解（由 A 层 spec.parse_requirements 提供结构）、
 * 阈值判定（只在 delivery-gate.ts 中）、UI 渲染。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { EopPackage, stableStringify } from '../model/eop.js';
import type { EvidenceRecord, ObjectRecord } from '../model/eop-types.js';
import { createLocator, type CorsjLocator } from '../locator/index.js';
import { executeCommand } from '../commands/registry.js';
import { ensureCommandsRegistered } from '../commands/builtin/register.js';
import type { CommandContext, CommandParams, CommandResult, L3AssetResolver } from '../commands/types.js';
import { DEFAULT_ITERATION_CONFIG, type IterationConfig } from './config/schema.js';
import { generateAcceptanceSpec, type AuthorizationRecord, type ParsedRequirements } from './acceptance-spec/generator.js';
import { freezeSpec, validateAcceptanceSpec, type AcceptanceSpec, type ClarificationRequest } from './acceptance-spec/schema.js';
import { DesignStateMachine, type DesignState } from './state-machine.js';
import { degradationRecord, freezeDegradation, type DegradationRecord } from './degradation.js';
import {
  deliveryGateSubmit, renderGateReport, specHash, GATE_COMMAND_ID,
  type GateVerdict, type ValidatorEvidence,
} from './delivery-gate.js';

/** 一轮设计计划（由上层/规划者给出；引擎不生成设计内容）。 */
export interface RoundPlan {
  /** 设计动作。 */
  design: { command: string; params: CommandParams }[];
  /** 验证动作（显式声明，保证证据可复现）。 */
  validation: { command: string; params: CommandParams }[];
  /** 本轮声明为 optional 且跳过的能力 → 降级记录。 */
  optional?: { command: string; reason: string; affects?: string[] }[];
}

/** 单次命令执行记录。 */
export interface ExecutionRecord {
  command: string;
  run: number;
  status: CommandResult['status'];
  message: string;
  evidence_id: string;
  artifact_paths: string[];
  raw_data: Record<string, unknown>;
}

/** 一轮迭代的结果。 */
export interface RoundRecord {
  round: number;
  design: ExecutionRecord[];
  validation: ExecutionRecord[];
  verdict: GateVerdict;
  degradation: DegradationRecord[];
}

export interface LoopOptions {
  goalText: string;
  /** 设计计划（按轮次；不足时复用最后一轮）。 */
  plan: RoundPlan[];
  /** 迭代参数（仅控制循环，不影响阈值）。 */
  config?: IterationConfig;
  /** 定位器（默认 dev 模式）。 */
  locator?: CorsjLocator;
  /** dev 模式工作区根。 */
  devRoot?: string;
  /** 运行期用户数据根（Electron userData）。 */
  userDataRoot?: string;
  /** 打包后的安装目录白名单。 */
  installDirs?: string[];
  coreVersion: string;
  packageId?: string;
  packageTitle?: string;
  /** 用户对保守默认值的显式授权。 */
  authorization?: AuthorizationRecord;
  /** L3 资产解析（阶段一无 L3 资产）。 */
  assets?: L3AssetResolver;
  signal?: AbortSignal;
  /** 构建清单指纹提供者（默认 expected=actual）。 */
  manifestFingerprint?: () => { expected: string; actual: string };
  /** 时间注入口（自检可复现）。 */
  now?: () => string;
}

export interface LoopResult {
  state: DesignState;
  timeline: readonly { from: DesignState; to: DesignState; at: string; reason: string }[];
  spec?: AcceptanceSpec;
  spec_hash?: string;
  spec_object_id?: string;
  clarifications: ClarificationRequest[];
  errors: string[];
  rounds: RoundRecord[];
  verdict?: GateVerdict;
  gate_report_markdown?: string;
  gate_report_json?: Record<string, unknown>;
  evidence: readonly EvidenceRecord[];
  objects: readonly ObjectRecord[];
  degradation: DegradationRecord[];
  package_bytes: Uint8Array;
  package_path?: string;
  package_fingerprint: string;
  delivered: boolean;
  used_rounds: number;
  env_retries: number;
  max_rounds: number;
  max_env_retries: number;
  /** 是否使用了默认迭代参数（缺失配置文件时）。 */
  used_default_iteration_params: boolean;
}

/** 阶段一没有 L3 资产：任何 ensure 都按 env_error 处理。 */
export function createUnavailableAssetResolver(): L3AssetResolver {
  return {
    async ensure(assetId: string): Promise<string> {
      throw new Error(`L3 资产不可用（阶段一无 L3 资产）: ${assetId}`);
    },
    describe(assetId: string) {
      return { id: assetId, level: 'L3' as const };
    },
  };
}

function sha256Hex(s: string | Uint8Array): string {
  return createHash('sha256').update(s).digest('hex');
}

/** 设计会话：可逐步驱动（UI 用）或一次性跑完（自检/App 用）。 */
export class DesignSession {
  readonly machine = new DesignStateMachine();
  private pkg: EopPackage;
  private run = 0;
  private spec?: AcceptanceSpec;
  private specObjectId?: string;
  private specHashAtFreeze?: string;
  private readonly degradation: DegradationRecord[] = [];
  private readonly rounds: RoundRecord[] = [];
  private readonly evidence: ValidatorEvidence[] = [];
  private readonly executions: ExecutionRecord[] = [];
  private usedRounds = 0;
  private envRetries = 0;
  /** 已落报告对象的轮数（每轮一次，避免同轮重复）。 */
  private lastReportRound = 0;
  private readonly config: IterationConfig;
  private readonly scratchDir: string;
  private readonly locator: CorsjLocator;
  private readonly assets: L3AssetResolver;
  private readonly coreVersion: string;

  constructor(private readonly opts: LoopOptions) {
    ensureCommandsRegistered();
    this.config = opts.config ?? DEFAULT_ITERATION_CONFIG;
    this.coreVersion = opts.coreVersion;
    this.locator = opts.locator ?? createLocator(
      opts.userDataRoot
        ? { mode: 'user', userDataRoot: opts.userDataRoot, installDirs: opts.installDirs }
        : { mode: 'dev', devRoot: opts.devRoot },
    );
    this.scratchDir = join(this.locator.cacheRoot(), 'scratch');
    this.assets = opts.assets ?? createUnavailableAssetResolver();
    const pkgId = opts.packageId ?? `PKG-${Date.now().toString(36).toUpperCase()}`;
    this.pkg = EopPackage.create(pkgId, opts.packageTitle ?? 'corsj 设计包', this.coreVersion);
  }

  get state(): DesignState { return this.machine.state; }
  get package(): EopPackage { return this.pkg; }

  /** PARSING：解析目标 → 生成 AcceptanceSpec → 冻结。失败留在 PARSING。 */
  async parseAndSpec(): Promise<{ state: DesignState; spec?: AcceptanceSpec; clarifications: ClarificationRequest[]; errors: string[] }> {
    const parsedRun = await this.exec('spec.parse_requirements', { goal_text: this.opts.goalText });
    if (parsedRun.status !== 'success') {
      return { state: this.machine.state, clarifications: [], errors: [`目标解析失败：${parsedRun.message}`] };
    }
    const parsed = parsedRun.raw_data as unknown as ParsedRequirements;
    const generated = generateAcceptanceSpec({
      goalText: this.opts.goalText,
      parsed,
      iteration: {
        max_rounds: this.config.params.max_rounds,
        max_env_retries: this.config.params.max_env_retries,
        used_rounds: 0,
      },
      authorization: this.opts.authorization,
      createdAt: this.now(),
    });
    if (!generated.ready) {
      // 留在 PARSING，返回结构化补充请求
      return { state: this.machine.state, spec: generated.spec, clarifications: generated.clarifications, errors: generated.errors };
    }
    // 冻结 + 校验 + 落包
    const spec = generated.spec;
    spec.state = 'frozen';
    const schema = validateAcceptanceSpec(spec);
    if (!schema.ok) return { state: this.machine.state, spec, clarifications: [], errors: schema.errors };

    // 需求对象
    let reqSeq = 0;
    for (const r of spec.requirements) {
      reqSeq += 1;
      this.pkg.addObject(
        {
          id: r.id,
          object_type: 'Requirement',
          title: r.text.slice(0, 80),
          produced_by: 'run-0001',
          relations: [],
          payloads: [],
          attributes: { category: r.category, mandatory: r.mandatory, validator_ids: r.validator_ids },
        },
        [],
      );
    }
    // AcceptanceSpec 对象
    const specObjectId = `AcceptanceSpec-0001`;
    this.pkg.addObject(
      {
        id: specObjectId,
        object_type: 'AcceptanceSpec',
        title: `验收规格 ${spec.spec_id}`,
        produced_by: 'run-0001',
        relations: spec.requirements.map((r) => ({ type: 'validates' as const, target: r.id })),
        payloads: [],
        attributes: { spec_id: spec.spec_id, validators: spec.validators.length, frozen: true },
      },
      [{ path: `design/acceptance-spec.json`, data: new TextEncoder().encode(JSON.stringify(spec, null, 2)), media_type: 'application/json', role: 'acceptance-spec' }],
    );
    this.spec = spec;
    this.specObjectId = specObjectId;
    this.specHashAtFreeze = specHash(spec);
    this.machine.transition('SPEC_READY', `验收规格已冻结（${spec.validators.length} 个验证项，0 个未决补充请求）`);
    return { state: this.machine.state, spec, clarifications: [], errors: [] };
  }

  /** DESIGNING → TESTING：执行一轮计划。 */
  async runRound(plan: RoundPlan): Promise<RoundRecord> {
    if (this.machine.state === 'SPEC_READY') this.machine.transition('DESIGNING', '进入设计阶段');
    if (this.machine.state !== 'DESIGNING') throw new Error(`当前状态 ${this.machine.state} 不可执行设计轮次`);

    const design: ExecutionRecord[] = [];
    for (const step of plan.design) design.push(await this.exec(step.command, step.params));
    for (const opt of plan.optional ?? []) {
      this.degradation.push(degradationRecord({
        command: opt.command,
        kind: 'skipped_optional',
        reason: opt.reason,
        affected_validators: opt.affects ?? [],
        at: this.now(),
        seq: this.degradation.length + 1,
      }));
    }
    this.machine.transition('TESTING', `设计动作完成（${design.length} 条命令）`);

    const validation: ExecutionRecord[] = [];
    for (const step of plan.validation) validation.push(await this.exec(step.command, step.params));
    this.machine.transition('VERIFYING', `验证动作完成（${validation.length} 条命令）`);

    const verdict = this.submitGate();
    const round: RoundRecord = { round: this.usedRounds + 1, design, validation, verdict, degradation: [...this.degradation] };
    this.rounds.push(round);

    if (verdict.decision === 'delivered') {
      this.machine.transition('DELIVERING', '门禁全部通过，进入交付');
      this.machine.transition('DELIVERED', verdict.message);
    } else if (verdict.counts_round) {
      this.usedRounds += 1;
      this.machine.transition('DESIGNING', `门禁拒绝（${verdict.code}），计一轮，回到设计阶段`);
    } else {
      this.machine.transition('FAILED', `门禁拒绝（${verdict.code}，分支 ${verdict.branch}），立即失败`);
    }
    return round;
  }

  /** VERIFYING/DELIVERING：调用门禁（不迁移状态）。 */
  submitGate(): GateVerdict {
    if (!this.spec || !this.specHashAtFreeze) throw new Error('尚未生成 AcceptanceSpec');
    const fp = this.pkg.fingerprint();
    const manifest = this.opts.manifestFingerprint?.() ?? { expected: fp, actual: fp };
    return deliveryGateSubmit({
      spec: freezeSpec(this.spec),
      spec_hash_at_freeze: this.specHashAtFreeze,
      spec_hash_now: specHash(this.spec),
      evidence: this.evidence,
      degradation: freezeDegradation(this.degradation),
      package_fingerprint_at_verify: fp,
      package_fingerprint_now: this.pkg.fingerprint(),
      package_integrity_ok: this.pkg.verifyPayloadIntegrity().ok,
      manifest_sha256_expected: manifest.expected,
      manifest_sha256_actual: manifest.actual,
      iterations: {
        max_rounds: this.config.params.max_rounds,
        used_rounds: this.usedRounds,
        max_env_retries: this.config.params.max_env_retries,
        env_retries: this.envRetries,
      },
      missing_input_due_to_degradation: this.computeMissingInputs(),
      now: this.now(),
    });
  }

  /** 降级导致的必需输入缺失（配置错误分支）。 */
  private computeMissingInputs(): { validator_id: string; command: string; input: string }[] {
    const out: { validator_id: string; command: string; input: string }[] = [];
    if (!this.spec) return out;
    const degraded = new Map(this.degradation.map((d) => [d.command, d]));
    for (const v of this.spec.validators) {
      const d = degraded.get(v.command);
      if (!d) continue;
      const produced = new Set<string>();
      for (const e of this.executions) {
        if (e.status === 'success') produced.add(e.command);
      }
      // 被降级的命令若为 REQUIRED 验证项且本轮没有成功产出 → 必需输入缺失
      if (v.strength === 'REQUIRED' && !produced.has(v.command)) {
        out.push({ validator_id: v.id, command: v.command, input: `${v.command} 的产出证据` });
      }
      for (const affected of d.affected_validators) {
        const target = this.spec.validators.find((x) => x.id === affected);
        if (target?.strength === 'REQUIRED' && !produced.has(target.command)) {
          out.push({ validator_id: affected, command: d.command, input: `降级命令 ${d.command} 应提供的输入` });
        }
      }
    }
    return out;
  }

  /** 生成门禁报告并落包（每轮唯一对象 id 与载荷路径；只追加语义不冲突）。 */
  async writeGateReport(): Promise<{ markdown: string; json: Record<string, unknown> }> {
    const last = this.rounds[this.rounds.length - 1];
    const verdict = last?.verdict ?? this.submitGate();
    const report = renderGateReport(verdict, this.spec?.spec_id ?? 'unknown');
    // 序号：对象 id 用轮次（跨轮唯一），载荷路径用全局 run 号（跨轮唯一）；
    // 同一轮重复调用只落一次报告对象。
    const roundNo = Math.max(this.lastReportRound + 1, this.rounds.length, 1);
    this.lastReportRound = roundNo;
    const runNo = Math.max(this.run, 1);
    const oid = `GateReport-${String(roundNo).padStart(4, '0')}`;
    const mdPath = `design/gate-report-r${String(runNo).padStart(4, '0')}-${String(roundNo).padStart(2, '0')}.md`;
    const jsonPath = `design/gate-report-r${String(runNo).padStart(4, '0')}-${String(roundNo).padStart(2, '0')}.json`;
    this.pkg.addObject(
      {
        id: oid,
        object_type: 'Report',
        title: `交付门禁报告（${verdict.decision}）`,
        produced_by: `run-${String(runNo).padStart(4, '0')}`,
        relations: this.specObjectId ? [{ type: 'references', target: this.specObjectId }] : [],
        payloads: [],
        attributes: { decision: verdict.decision, code: verdict.code, signature: verdict.signature, degradation_digest: verdict.degradation_digest },
      },
      [
        { path: mdPath, data: new TextEncoder().encode(report.markdown), media_type: 'text/markdown', role: 'gate-report' },
        { path: jsonPath, data: new TextEncoder().encode(JSON.stringify(report.json, null, 2)), media_type: 'application/json', role: 'gate-report-json' },
      ],
    );
    return report;
  }

  /** 写出 .eop 到 locator 白名单目录。 */
  async persist(filename?: string): Promise<{ bytes: Uint8Array; path: string }> {
    const bytes = this.pkg.toBytes();
    const dir = this.locator.eopDir();
    this.locator.assertWritable(join(dir, filename ?? `${this.pkg.manifest.id}.eop`));
    await mkdir(dir, { recursive: true });
    const path = join(dir, filename ?? `${this.pkg.manifest.id}.eop`);
    await writeFile(path, bytes);
    return { bytes, path };
  }

  private now(): string {
    return this.opts.now?.() ?? new Date().toISOString();
  }

  /** 执行一条 A 层命令：带 env_error 重试与证据采集。 */
  private async exec(command: string, params: CommandParams): Promise<ExecutionRecord> {
    const ctx: CommandContext = {
      pkg: this.pkg,
      run: this.run + 1,
      scratchDir: this.scratchDir,
      assets: this.assets,
      signal: this.opts.signal,
    };
    this.run += 1;
    const runNo = this.run;
    let result = await executeCommand(command, params, ctx);
    // env_error：B 层重试（不计轮次），上限 max_env_retries
    while (result.status === 'env_error' && this.envRetries < this.config.params.max_env_retries) {
      this.envRetries += 1;
      result = await executeCommand(command, params, { ...ctx, run: runNo });
    }
    const evidenceId = `ev-${String(runNo).padStart(4, '0')}`;
    const resultPath = `evidence/${evidenceId}/result.json`;
    const payload = new TextEncoder().encode(JSON.stringify({
      capability_id: result.capability_id,
      run: runNo,
      status: result.status,
      message: result.result.message,
      raw_data: result.result.raw_data,
      artifacts: result.result.artifacts.map((a) => ({ path: a.path, media_type: a.media_type, role: a.role })),
    }, null, 2));
    this.pkg.addEvidence(
      {
        id: evidenceId,
        command,
        run: runNo,
        status: result.status as EvidenceRecord['status'],
        artifacts_prefix: `evidence/${evidenceId}/`,
        result_json: resultPath,
        summary: { message: result.result.message, artifact_count: result.result.artifacts.length },
      },
      [{ path: resultPath, data: payload }],
    );
    const record: ExecutionRecord = {
      command,
      run: runNo,
      status: result.status as CommandResult['status'],
      message: result.result.message,
      evidence_id: evidenceId,
      artifact_paths: result.result.artifacts.map((a) => a.path),
      raw_data: result.result.raw_data,
    };
    this.executions.push(record);
    this.evidence.push({
      validator_id: `val-${command.replaceAll('.', '-')}`,
      command,
      run: runNo,
      status: result.status as ValidatorEvidence['status'],
      raw_data: result.result.raw_data,
      evidence_ref: evidenceId,
      artifact_paths: record.artifact_paths,
      digest: sha256Hex(stableStringify(result.result.raw_data)),
    });
    return record;
  }
}

/** 一次性跑完整闭环（自检 / App / 插件共用）。 */
export async function runDesignLoop(opts: LoopOptions): Promise<LoopResult> {
  const session = new DesignSession(opts);
  const parsed = await session.parseAndSpec();
  const rounds: RoundRecord[] = [];
  let verdict: GateVerdict | undefined;
  let gateReportMarkdown: string | undefined;
  let gateReportJson: Record<string, unknown> | undefined;

  if (parsed.errors.length === 0 && parsed.clarifications.length === 0) {
    const cfg = opts.config ?? DEFAULT_ITERATION_CONFIG;
    for (let i = 0; i < cfg.params.max_rounds; i += 1) {
      const plan = opts.plan[Math.min(i, opts.plan.length - 1)];
      if (!plan) break;
      const round = await session.runRound(plan);
      rounds.push(round);
      verdict = round.verdict;
      // 每轮门禁结论即时落报告（对象 id / 载荷路径逐轮唯一，只追加）
      const rep = await session.writeGateReport();
      gateReportMarkdown = rep.markdown;
      gateReportJson = rep.json;
      if (session.state === 'DELIVERED' || session.state === 'FAILED') break;
    }
    verdict = verdict ?? session.submitGate();
  }

  const persisted = await session.persist();
  return {
    state: session.state,
    timeline: session.machine.timeline,
    spec: parsed.spec,
    spec_hash: parsed.spec ? specHash(parsed.spec) : undefined,
    spec_object_id: 'AcceptanceSpec-0001',
    clarifications: parsed.clarifications,
    errors: parsed.errors,
    rounds,
    verdict,
    gate_report_markdown: gateReportMarkdown,
    gate_report_json: gateReportJson,
    evidence: session.package.manifest.evidence,
    objects: session.package.manifest.objects,
    degradation: rounds[rounds.length - 1]?.degradation ?? [],
    package_bytes: persisted.bytes,
    package_path: persisted.path,
    package_fingerprint: session.package.fingerprint(),
    delivered: session.state === 'DELIVERED',
    used_rounds: rounds.length,
    env_retries: 0,
    max_rounds: (opts.config ?? DEFAULT_ITERATION_CONFIG).params.max_rounds,
    max_env_retries: (opts.config ?? DEFAULT_ITERATION_CONFIG).params.max_env_retries,
    used_default_iteration_params: opts.config === undefined,
  };
}

export { GATE_COMMAND_ID };
