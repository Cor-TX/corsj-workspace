/**
 * @corsj/core — 交付门禁（B 层唯一交付出口）。
 *
 * 只有 `delivery_gate.submit` 可以产生 `delivered`。
 *
 * 拒绝分支（任务书 §2.4）：
 * 1) 阈值/验证不通过            → 回 DESIGNING，计一轮。
 * 2) 指纹/证据问题              → 立即 FAILED（终态）。
 * 3) 因降级导致必需输入缺失      → 配置错误 → 立即 FAILED（终态）。
 *
 * 优先级：完整性类问题（指纹/证据/配置）优先于阈值类问题——
 * 因为判定基础本身不可信时，任何「通过」都无意义。
 */
import { createHash } from 'node:crypto';
import { stableStringify } from '../model/eop.js';
import { findUnit } from '../model/units.js';
import { type FrozenAcceptanceSpec, type Threshold, type ThresholdOp } from './acceptance-spec/schema.js';
import { type DegradationRecord, type FrozenDegradation } from './degradation.js';

/** 门禁命令 id（唯一交付路径）。 */
export const GATE_COMMAND_ID = 'delivery_gate.submit';

/** A 层命令执行回执（门禁输入）。 */
export interface ValidatorEvidence {
  validator_id: string;
  command: string;
  run: number;
  status: 'success' | 'design_error' | 'env_error' | 'not_implemented';
  raw_data: Record<string, unknown>;
  /** .eop 中的证据记录 id。 */
  evidence_ref?: string;
  artifact_paths: string[];
  /** 证据载荷哈希（引擎采集时计算）。 */
  digest?: string;
}

/** 构建清单条目（任务书 §2.5）。 */
export interface BuildManifestEntry {
  component: string;
  license: string;
  version: string;
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  artifact_path: string;
  sha256: string;
}

/** 构建清单（验证后不可变）。 */
export interface BuildManifest {
  manifest_version: 'corsj.build/1';
  core_version: string;
  generated_at: string;
  entries: BuildManifestEntry[];
}

/** 单个验证项的门禁判定结果。 */
export interface ValidatorOutcome {
  validator_id: string;
  command: string;
  strength: 'REQUIRED' | 'optional';
  /** 是否满足全部阈值。 */
  passed: boolean;
  /** 是否因降级无法验证。 */
  degraded: boolean;
  /** 是否存在证据。 */
  evidence_present: boolean;
  thresholds: {
    field: string;
    op: ThresholdOp;
    expected: string;
    actual: string;
    passed: boolean;
    note?: string;
  }[];
  detail: string;
}

export type GateBranch = 'threshold' | 'fingerprint' | 'configuration';

export interface GateVerdict {
  decision: 'delivered' | 'rejected';
  next_state: 'DELIVERED' | 'DESIGNING' | 'FAILED';
  branch?: GateBranch;
  code: string;
  message: string;
  per_validator: ValidatorOutcome[];
  degradation: readonly Readonly<DegradationRecord>[];
  degradation_digest: string;
  summary: {
    required_total: number;
    required_passed: number;
    required_failed: number;
    optional_total: number;
    optional_passed: number;
    degraded_count: number;
    cannot_verify: number;
  };
  /** 本次拒绝是否计入一轮迭代。 */
  counts_round: boolean;
  /** 报告签名（SHA256）。 */
  signature: string;
  generated_at: string;
}

export interface GateInput {
  spec: FrozenAcceptanceSpec;
  /** 冻结时记录的 spec 哈希。 */
  spec_hash_at_freeze: string;
  /** 门禁时刻重算的 spec 哈希。 */
  spec_hash_now: string;
  evidence: ValidatorEvidence[];
  degradation: FrozenDegradation;
  /** 验证阶段记录的包指纹。 */
  package_fingerprint_at_verify: string;
  /** 门禁时刻重算的包指纹。 */
  package_fingerprint_now: string;
  /** 包内载荷哈希自检结果。 */
  package_integrity_ok: boolean;
  /** 发布清单（.eop 中登记）的哈希。 */
  manifest_sha256_expected: string;
  /** 运行时读到的清单哈希（被篡改则不等）。 */
  manifest_sha256_actual: string;
  iterations: { max_rounds: number; used_rounds: number; max_env_retries: number; env_retries: number };
  /** 必需输入是否因降级而缺失（配置错误分支）。 */
  missing_input_due_to_degradation?: { validator_id: string; command: string; input: string }[];
  now?: string;
}

function sha256Text(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** spec 的稳定哈希（冻结/门禁两侧同算法）。 */
export function specHash(spec: unknown): string {
  return sha256Text(stableStringify(spec));
}

/** 按点路径取值（支持数组下标）。 */
export function resolvePath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(seg);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
      continue;
    }
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** 把验证器实际取值换算为 SI 数值（Quantity 带单位时换算；bool 归一到 0/1）。 */
export function actualToNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    if (v === 'valid' || v === 'true' || v === 'pass') return 1;
    if (v === 'invalid' || v === 'false' || v === 'fail') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (v && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'number' && typeof (v as { unit?: unknown }).unit === 'string') {
    const q = v as { value: number; unit: string };
    if (q.unit === 'degC') return q.value + 273.15;
    const u = findUnit(q.unit);
    if (!u) return undefined;
    return q.value * u.toSI;
  }
  return undefined;
}

/** 阈值目标换算为 SI。 */
export function targetToNumber(t: Threshold): number | undefined {
  if (!t.target) return undefined;
  if (t.target.unit === 'degC') return t.target.value + 273.15;
  const u = findUnit(t.target.unit);
  if (!u) return undefined;
  return t.target.value * u.toSI;
}

function fmt(n: number | undefined, unit: string): string {
  if (n === undefined) return 'n/a';
  if (n !== 0 && (Math.abs(n) < 1e-4 || Math.abs(n) >= 1e6)) return `${n.toExponential(4)} ${unit}`;
  return `${n.toPrecision(6)} ${unit}`;
}

/** 单条阈值比对（仅 B 层执行）。 */
export function evaluateThreshold(t: Threshold, raw: Record<string, unknown>): { passed: boolean; expected: string; actual: string; note?: string } {
  const actualRaw = resolvePath(raw, t.field);
  if (t.op === 'exists') {
    const okExists = actualRaw !== undefined && actualRaw !== null;
    return { passed: okExists, expected: '存在', actual: okExists ? '存在' : '缺失', note: okExists ? undefined : `字段 ${t.field} 缺失` };
  }
  const actual = actualToNumber(actualRaw);
  const target = targetToNumber(t);
  const unit = t.target?.unit ?? '1';
  if (actual === undefined) return { passed: false, expected: `${t.op} ${fmt(target, unit)}`, actual: '缺失或非数值', note: `字段 ${t.field} 无法解析为数值` };
  if (target === undefined) return { passed: false, expected: `${t.op} n/a`, actual: fmt(actual, unit), note: `阈值目标缺失（field=${t.field}）` };
  let passed = false;
  switch (t.op) {
    case '<=': passed = actual <= target; break;
    case '>=': passed = actual >= target; break;
    case '<': passed = actual < target; break;
    case '>': passed = actual > target; break;
    case '==': passed = Math.abs(actual - target) <= Math.abs(target) * 1e-9 + 1e-12; break;
    case 'within': {
      const tol = t.tolerance ? (findUnit(t.tolerance.unit)?.toSI ?? 1) * t.tolerance.value : 0;
      passed = Math.abs(actual - target) <= tol;
      break;
    }
    default: passed = false;
  }
  return { passed, expected: `${t.op} ${fmt(target, unit)}`, actual: fmt(actual, unit) };
}

function makeVerdict(input: GateInput, base: Omit<GateVerdict, 'signature' | 'generated_at'>): GateVerdict {
  const generated_at = input.now ?? new Date().toISOString();
  const body = { ...base, generated_at };
  const signature = sha256Text(stableStringify(body));
  return { ...body, signature, generated_at };
}

/**
 * 交付门禁提交。唯一能返回 decision='delivered' 的函数。
 * 纯函数：不写包、不参加 IO；调用方（引擎）据 next_state 迁移状态。
 */
export function deliveryGateSubmit(input: GateInput): GateVerdict {
  const spec = input.spec;

  // ---- 分支 2a：spec 指纹（执行期被改 → 立即 FAILED） ----
  if (input.spec_hash_at_freeze !== input.spec_hash_now) {
    return makeVerdict(input, {
      decision: 'rejected', next_state: 'FAILED', branch: 'fingerprint', code: 'SPEC_FINGERPRINT_MISMATCH',
      message: 'AcceptanceSpec 在冻结后被修改：指纹不一致，判据失效，立即失败',
      per_validator: [], degradation: input.degradation.records, degradation_digest: input.degradation.digest,
      summary: { required_total: spec.validators.filter((v) => v.strength === 'REQUIRED').length, required_passed: 0, required_failed: 0, optional_total: spec.validators.filter((v) => v.strength === 'optional').length, optional_passed: 0, degraded_count: input.degradation.records.length, cannot_verify: 0 },
      counts_round: false,
    });
  }

  // ---- 分支 2b：构建清单指纹（运行时被改 → 立即 FAILED） ----
  if (input.manifest_sha256_expected !== input.manifest_sha256_actual) {
    return makeVerdict(input, {
      decision: 'rejected', next_state: 'FAILED', branch: 'fingerprint', code: 'MANIFEST_FINGERPRINT_MISMATCH',
      message: '构建清单在验证后被修改：SHA256 与发布清单不一致，立即失败',
      per_validator: [], degradation: input.degradation.records, degradation_digest: input.degradation.digest,
      summary: { required_total: spec.validators.filter((v) => v.strength === 'REQUIRED').length, required_passed: 0, required_failed: 0, optional_total: spec.validators.filter((v) => v.strength === 'optional').length, optional_passed: 0, degraded_count: input.degradation.records.length, cannot_verify: 0 },
      counts_round: false,
    });
  }

  // ---- 分支 2c：包指纹 / 载荷完整性 ----
  if (!input.package_integrity_ok || input.package_fingerprint_at_verify !== input.package_fingerprint_now) {
    return makeVerdict(input, {
      decision: 'rejected', next_state: 'FAILED', branch: 'fingerprint', code: 'EVIDENCE_FINGERPRINT_MISMATCH',
      message: '证据链完整性失败：包指纹变化或载荷哈希不一致，立即失败',
      per_validator: [], degradation: input.degradation.records, degradation_digest: input.degradation.digest,
      summary: { required_total: spec.validators.filter((v) => v.strength === 'REQUIRED').length, required_passed: 0, required_failed: 0, optional_total: spec.validators.filter((v) => v.strength === 'optional').length, optional_passed: 0, degraded_count: input.degradation.records.length, cannot_verify: 0 },
      counts_round: false,
    });
  }

  // ---- 分支 3：降级导致必需输入缺失（配置错误 → 立即 FAILED） ----
  const missing = input.missing_input_due_to_degradation ?? [];
  if (missing.length > 0) {
    const outcomes = spec.validators.map((v) => ({
      validator_id: v.id, command: v.command, strength: v.strength,
      passed: false, degraded: true, evidence_present: false, thresholds: [],
      detail: `无法验证：必需输入因降级缺失（${missing.filter((m) => m.validator_id === v.id).map((m) => m.input).join('、') || '相关降级'}）`,
    }));
    return makeVerdict(input, {
      decision: 'rejected', next_state: 'FAILED', branch: 'configuration', code: 'MISSING_INPUT_DUE_TO_DEGRADATION',
      message: `配置错误：${missing.map((m) => `${m.command} 缺少 ${m.input}`).join('；')}（源于降级），无法构成可交付配置`,
      per_validator: outcomes, degradation: input.degradation.records, degradation_digest: input.degradation.digest,
      summary: { required_total: outcomes.filter((o) => o.strength === 'REQUIRED').length, required_passed: 0, required_failed: outcomes.filter((o) => o.strength === 'REQUIRED').length, optional_total: outcomes.filter((o) => o.strength === 'optional').length, optional_passed: 0, degraded_count: input.degradation.records.length, cannot_verify: outcomes.length },
      counts_round: false,
    });
  }

  // ---- 逐验证项判定 ----
  const degradedCommands = new Set(input.degradation.records.map((r) => r.command));
  const outcomes: ValidatorOutcome[] = spec.validators.map((v) => {
    const ev = input.evidence.filter((e) => e.validator_id === v.id || e.command === v.command).sort((a, b) => b.run - a.run)[0];
    const degraded = degradedCommands.has(v.command);
    if (!ev) {
      return {
        validator_id: v.id, command: v.command, strength: v.strength,
        passed: false, degraded, evidence_present: false, thresholds: [],
        detail: degraded ? '命令已降级（未执行），该项无法验证' : '缺少证据：命令未执行或未采集回执',
      };
    }
    if (ev.status !== 'success') {
      return {
        validator_id: v.id, command: v.command, strength: v.strength,
        passed: false, degraded, evidence_present: true, thresholds: [],
        detail: `命令状态为 ${ev.status}，不构成通过证据`,
      };
    }
    const results = v.thresholds.map((t) => {
      const r = evaluateThreshold(t, ev.raw_data);
      return { field: t.field, op: t.op, expected: r.expected, actual: r.actual, passed: r.passed, note: r.note };
    });
    const passed = results.length > 0 && results.every((r) => r.passed);
    return {
      validator_id: v.id, command: v.command, strength: v.strength,
      passed, degraded, evidence_present: true, thresholds: results,
      detail: results.length === 0 ? '未声明阈值' : results.every((r) => r.passed) ? '全部阈值满足' : results.filter((r) => !r.passed).map((r) => `${r.field} 实测 ${r.actual}，要求 ${r.expected}`).join('；'),
    };
  });

  const required = outcomes.filter((o) => o.strength === 'REQUIRED');
  const optional = outcomes.filter((o) => o.strength === 'optional');
  const requiredFailed = required.filter((o) => !o.passed);
  const cannotVerify = outcomes.filter((o) => !o.evidence_present).length;
  const summary = {
    required_total: required.length,
    required_passed: required.filter((o) => o.passed).length,
    required_failed: requiredFailed.length,
    optional_total: optional.length,
    optional_passed: optional.filter((o) => o.passed).length,
    degraded_count: input.degradation.records.length,
    cannot_verify: cannotVerify,
  };

  // ---- 分支 1：阈值/验证不通过 → 回 DESIGNING，计一轮 ----
  if (requiredFailed.length > 0) {
    const roundsLeft = input.iterations.max_rounds - input.iterations.used_rounds;
    const exhausted = roundsLeft <= 0;
    return makeVerdict(input, {
      decision: 'rejected',
      next_state: exhausted ? 'FAILED' : 'DESIGNING',
      branch: 'threshold',
      code: exhausted ? 'ROUNDS_EXHAUSTED' : 'THRESHOLD_NOT_MET',
      message: exhausted
        ? `已达最大迭代轮次 ${input.iterations.max_rounds}，仍不满足：${requiredFailed.map((o) => o.validator_id).join('、')}`
        : `阈值未满足：${requiredFailed.map((o) => o.validator_id).join('、')}，回到设计阶段（剩余 ${roundsLeft} 轮）`,
      per_validator: outcomes,
      degradation: input.degradation.records,
      degradation_digest: input.degradation.digest,
      summary,
      counts_round: !exhausted,
    });
  }

  // ---- 交付 ----
  return makeVerdict(input, {
    decision: 'delivered',
    next_state: 'DELIVERED',
    code: 'DELIVERED',
    message: `全部 ${required.length} 项 REQUIRED 验证通过；降级 ${input.degradation.records.length} 项（未计为通过），交付放行`,
    per_validator: outcomes,
    degradation: input.degradation.records,
    degradation_digest: input.degradation.digest,
    summary,
    counts_round: false,
  });
}

/** 门禁报告（Markdown + 结构化 JSON）。 */
export function renderGateReport(v: GateVerdict, specId: string): { markdown: string; json: Record<string, unknown> } {
  const lines = [
    `# 交付门禁报告 · ${specId}`,
    '',
    `- 结论：**${v.decision === 'delivered' ? '放行（delivered）' : '拒绝（rejected）'}**`,
    `- 代码：\`${v.code}\``,
    `- 拒绝分支：${v.branch ?? '无'}`,
    `- 下一状态：${v.next_state}`,
    `- 计入迭代轮次：${v.counts_round ? '是' : '否'}`,
    `- 报告签名（SHA256）：\`${v.signature}\``,
    `- 降级摘要（SHA256）：\`${v.degradation_digest}\``,
    '',
    `## 摘要`,
    '',
    `| 项 | 数量 |`,
    `| --- | --- |`,
    `| REQUIRED 总数 | ${v.summary.required_total} |`,
    `| REQUIRED 通过 | ${v.summary.required_passed} |`,
    `| REQUIRED 未通过 | ${v.summary.required_failed} |`,
    `| optional 总数 | ${v.summary.optional_total} |`,
    `| optional 通过 | ${v.summary.optional_passed} |`,
    `| 降级项 | ${v.summary.degraded_count} |`,
    `| 无法验证 | ${v.summary.cannot_verify} |`,
    '',
    `## 逐项判定`,
    '',
    `| 验证项 | 命令 | 强度 | 结果 | 说明 |`,
    `| --- | --- | --- | --- | --- |`,
    ...v.per_validator.map((o) => `| ${o.validator_id} | ${o.command} | ${o.strength} | ${o.passed ? '满足' : o.degraded ? '降级-不可验证' : '不满足'} | ${o.detail.replaceAll('|', '/')} |`),
    '',
    `## 降级记录（不计为通过）`,
    '',
    v.degradation.length === 0 ? '- 无' : '',
    ...v.degradation.map((d) => `- \`${d.id}\` ${d.command}：${d.reason}（影响：${d.affected_validators.join('、') || '无'}）`),
    '',
  ];
  const markdown = lines.join('\n');
  const json = {
    spec_id: specId,
    decision: v.decision,
    code: v.code,
    branch: v.branch ?? null,
    next_state: v.next_state,
    counts_round: v.counts_round,
    signature: v.signature,
    degradation_digest: v.degradation_digest,
    summary: v.summary,
    per_validator: v.per_validator,
    degradation: v.degradation,
    generated_at: v.generated_at,
  };
  return { markdown, json };
}
