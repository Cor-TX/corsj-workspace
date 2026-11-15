/**
 * @corsj/core — UI 契约（区域 A / B / C）。
 *
 * 契约只描述数据形状；corsj-app 与 corsj-dsh 各自独立实现渲染。
 *
 * 硬约束：
 * - UI 只提供「软引导」：可以提示、建议、高亮，但不得硬阻断流程，
 *   不得替代 B 层门禁，不得自行宣布交付成功。
 * - 交付结论只能来自 delivery_gate.submit 的 verdict。
 */
import type { DesignState } from '../design/state-machine.js';
import type { AcceptanceSpec, ClarificationRequest } from '../design/acceptance-spec/schema.js';
import type { GateVerdict } from '../design/delivery-gate.js';
import type { DegradationRecord } from '../design/degradation.js';
import type { EopView } from '../model/viewer.js';

/** UI 不能阻断交付（编译期常量，供两端断言）。 */
export const UI_CANNOT_BLOCK_DELIVERY = true as const;
/** 交付结论的唯一来源。 */
export const DELIVERY_AUTHORITY = 'delivery_gate.submit' as const;

export type UiRegionId = 'A' | 'B' | 'C';

/** 对话条目（AI 思考/回答）。 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  at: string;
  /** 是否仍在生成。 */
  streaming?: boolean;
}

/** 模型设置（corsj-app 自有数据层，与 DSH 全局模型配置隔离）。 */
export interface ModelSettings {
  provider_id: string;
  model_id: string;
  /** 仅在应用内保存；不得读写 DSH 配置。 */
  base_url?: string;
  temperature?: number;
  /** 是否已配置可用凭证（值本身不进入快照）。 */
  credential_present: boolean;
}

/** 区域 A：目标输入 + 思考/回答 + 模型设置。 */
export interface RegionA {
  goal: {
    text: string;
    submitted: boolean;
    /** 软引导：仅提示还缺什么，不禁用提交。 */
    hints: string[];
  };
  messages: ChatMessage[];
  model_settings: ModelSettings;
  /** 结构化补充请求（REQUIRED 缺阈值时由 B 层产生）。 */
  clarifications: ClarificationRequest[];
}

/** 区域 B 事件流条目（headless 模式）。 */
export interface RegionBEvent {
  id: string;
  phase: string;
  command?: string;
  status?: string;
  message: string;
  at: string;
  raw?: Record<string, unknown>;
}

/** 区域 B：实时观察（GUI iframe 或 headless 事件流，二选一）。 */
export interface RegionB {
  mode: 'gui' | 'events';
  /** mode=gui 时的内嵌地址（可空：无 GUI 内核时为服务端视图）。 */
  iframe_url?: string;
  events: RegionBEvent[];
  /** 包浏览视图（.eop 对象树）。 */
  view?: EopView;
}

/** 区域 C：进度 / 目标 / 门禁面板。 */
export interface RegionC {
  state: DesignState;
  round: number;
  max_rounds: number;
  goal_summary: string;
  requirements: { id: string; text: string; category: string; mandatory: boolean }[];
  validators: { id: string; command: string; strength: 'REQUIRED' | 'optional'; thresholds: number }[];
  /** 门禁结论（仅来自 delivery_gate.submit）。 */
  gate?: {
    decision: GateVerdict['decision'];
    code: string;
    branch?: GateVerdict['branch'];
    message: string;
    signature: string;
    required_total: number;
    required_passed: number;
    required_failed: number;
    cannot_verify: number;
  };
  degradation: DegradationRecord[];
  /** 软引导提示（不影响门禁）。 */
  hints: string[];
  /** UI 是否被允许宣布交付成功（永远 false）。 */
  ui_may_declare_delivered: false;
}

/** 整体快照：一次推送渲染三区。 */
export interface UiSnapshot {
  region_a: RegionA;
  region_b: RegionB;
  region_c: RegionC;
  /** 快照时间。 */
  at: string;
  /** 软约束声明。 */
  soft_only: true;
  delivery_authority: typeof DELIVERY_AUTHORITY;
}

/** 构建区域 C（从 spec + 门禁结论）。 */
export function buildRegionC(input: {
  state: DesignState;
  round: number;
  max_rounds: number;
  goal_summary: string;
  spec?: AcceptanceSpec;
  verdict?: GateVerdict;
  degradation: DegradationRecord[];
  hints?: string[];
}): RegionC {
  return {
    state: input.state,
    round: input.round,
    max_rounds: input.max_rounds,
    goal_summary: input.goal_summary,
    requirements: (input.spec?.requirements ?? []).map((r) => ({ id: r.id, text: r.text, category: r.category, mandatory: r.mandatory })),
    validators: (input.spec?.validators ?? []).map((v) => ({ id: v.id, command: v.command, strength: v.strength, thresholds: v.thresholds.length })),
    gate: input.verdict
      ? {
          decision: input.verdict.decision,
          code: input.verdict.code,
          branch: input.verdict.branch,
          message: input.verdict.message,
          signature: input.verdict.signature,
          required_total: input.verdict.summary.required_total,
          required_passed: input.verdict.summary.required_passed,
          required_failed: input.verdict.summary.required_failed,
          cannot_verify: input.verdict.summary.cannot_verify,
        }
      : undefined,
    degradation: input.degradation,
    hints: input.hints ?? [],
    ui_may_declare_delivered: false,
  };
}
