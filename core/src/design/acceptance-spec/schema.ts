/**
 * @corsj/core — AcceptanceSpec schema（唯一 schema 源）。
 *
 * 规则（任务书 §2.1）：
 * - 生成主体：B 层。A 层不得生成；命令实现里不得硬编码。
 * - 存储位置：作为 .eop 对象包中的对象（object_type = AcceptanceSpec），
 *   通过 validates 关系关联设计对象。
 * - 进入执行阶段后只读：类型层面（DeepReadonly）+ 状态机层面双重强制。
 * - REQUIRED 验证项缺阈值时 B 层不得自行假设，必须回 PARSING 提出结构化补充请求。
 *   用户明确授权的保守默认值必须由 AcceptanceSpec 显式记录。
 */
import type { Quantity } from '../../model/quantity-schema.js';
import type { ObjectType } from '../../model/eop-types.js';

/** 验证器强度。核心命令默认 REQUIRED；optional 仅由资格矩阵或本 spec 显式授予。 */
export type ValidatorStrength = 'REQUIRED' | 'optional';

/** 阈值比较方向。 */
export type ThresholdOp = '<=' | '>=' | '<' | '>' | '==' | 'exists' | 'within';

/** 单条阈值。 */
export interface Threshold {
  op: ThresholdOp;
  /** 数值比较时的目标量（op=exists 时省略；within 时为 target..tolerance）。 */
  target?: Quantity;
  /** within 容差。 */
  tolerance?: Quantity;
  /** 阈值来源说明（用户目标 / 用户补充 / 用户授权的保守默认值）。 */
  source: 'user_goal' | 'user_supplement' | 'conservative_default_authorized';
  /** 授权记录：source=conservative_default_authorized 时必须给出（谁、何时、依据）。 */
  authorization?: { by: string; at: string; note: string };
  /** 取验证器输出中的哪个字段（点路径，如 max_von_mises.value）。 */
  field: string;
}

/** 一条验证项：绑定命令、从其 artifacts 中提取证据并判定阈值。 */
export interface ValidatorSpec {
  /** 验证项 id，如 val-fea-static-1。 */
  id: string;
  /** 绑定的 A 层命令 id。 */
  command: string;
  strength: ValidatorStrength;
  description: string;
  /** 绑定的设计对象 id（如 Part-0001）；空表示对整个包生效。 */
  target_object?: string;
  thresholds: Threshold[];
  /** 通过判定所需的最低证据形式。 */
  requires_evidence: boolean;
}

/** 目标解析产出的结构化需求条目。 */
export interface RequirementItem {
  id: string;
  /** 原文片段。 */
  text: string;
  category: string;
  /** 映射到的验证项 id（可空——尚未映射）。 */
  validator_ids: string[];
  /** 是否为硬约束。 */
  mandatory: boolean;
}

/** 结构化补充请求（REQUIRED 缺阈值时 B 层向用户提出）。 */
export interface ClarificationRequest {
  id: string;
  /** 涉及的验证项。 */
  validator_id: string;
  question: string;
  /** 期望的量纲/单位提示（来自 units.ts）。 */
  expected_unit?: string;
  /** 可选的保守默认值建议（需用户授权才可写入 spec）。 */
  suggested_conservative_default?: Quantity;
  status: 'open' | 'answered' | 'authorized_default';
  answer?: string;
}

/** AcceptanceSpec —— B 层唯一验收依据。 */
export interface AcceptanceSpec {
  spec_version: 'corsj.acceptance/1';
  spec_id: string;
  /** 用户目标原文。 */
  goal_text: string;
  created_at: string;
  /** 状态：draft（可改）→ frozen（执行阶段，只读）。 */
  state: 'draft' | 'frozen';
  requirements: RequirementItem[];
  validators: ValidatorSpec[];
  /** 未决补充请求（空数组才能 SPEC_READY）。 */
  open_clarifications: ClarificationRequest[];
  /** 迭代轮次记录（B 层写，供门禁核对）。 */
  iteration_budget: { max_rounds: number; max_env_retries: number; used_rounds: number };
}

/** 执行阶段使用的只读视图类型。 */
export type FrozenAcceptanceSpec = DeepReadonly<AcceptanceSpec>;
export type DeepReadonly<T> = T extends (infer R)[]
  ? readonly DeepReadonly<R>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** 类型层面冻结：进入执行阶段后 B 层只能拿到 FrozenAcceptanceSpec。 */
export function freezeSpec(spec: AcceptanceSpec): FrozenAcceptanceSpec {
  return spec as unknown as FrozenAcceptanceSpec;
}

/** AcceptanceSpec 对象在 .eop 中的 object_type。 */
export const ACCEPTANCE_SPEC_OBJECT_TYPE: ObjectType = 'AcceptanceSpec';

/** schema 级校验（B 层生成后必须通过）。 */
export function validateAcceptanceSpec(spec: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const s = spec as Partial<AcceptanceSpec> | null;
  if (!s || typeof s !== 'object') return { ok: false, errors: ['spec 不是对象'] };
  if (s.spec_version !== 'corsj.acceptance/1') errors.push('spec_version 必须为 corsj.acceptance/1');
  if (!Array.isArray(s.validators)) { errors.push('validators 必须为数组'); return { ok: false, errors }; }
  const vIds = new Set<string>();
  for (const v of s.validators) {
    if (!v.id) errors.push('验证项缺 id');
    else if (vIds.has(v.id)) errors.push(`验证项 id 重复: ${v.id}`);
    else vIds.add(v.id);
    if (!v.command) errors.push(`验证项 ${v.id} 缺 command`);
    if (!Array.isArray(v.thresholds)) errors.push(`验证项 ${v.id} thresholds 缺失`);
    for (const t of v.thresholds ?? []) {
      if (!t.field) errors.push(`验证项 ${v.id} 阈值缺 field`);
      if (!t.source) errors.push(`验证项 ${v.id} 阈值缺 source`);
      if (t.source === 'conservative_default_authorized' && !t.authorization) {
        errors.push(`验证项 ${v.id}: 保守默认值必须记录授权`);
      }
      if ((t.op === '<=' || t.op === '>=' || t.op === '<' || t.op === '>' || t.op === '==' || t.op === 'within') && !t.target) {
        errors.push(`验证项 ${v.id}: op=${t.op} 需要 target`);
      }
    }
    if (v.strength === 'REQUIRED' && (v.thresholds?.length ?? 0) === 0 && !v.requires_evidence) {
      errors.push(`验证项 ${v.id}: REQUIRED 但无阈值且不要求证据`);
    }
  }
  return { ok: errors.length === 0, errors };
}
