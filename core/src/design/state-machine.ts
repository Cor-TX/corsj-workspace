/**
 * @corsj/core — B 层状态机。
 *
 * 状态域（任务书 §2.2 固定）：
 *   PARSING → SPEC_READY → DESIGNING → TESTING → VERIFYING → DELIVERING → DELIVERED / FAILED
 *
 * 不可绕过约束：
 * - 只有 `DELIVERED` 是交付成功态，且只能由 `delivery_gate.submit` 触发。
 * - `FAILED` 为终态；任一环节的不可恢复错误直接进入。
 * - VERIFYING 判定失败 → 回 DESIGNING 并计一轮（受 max_rounds 限制）。
 * - env_error 不计入轮次，但受 max_env_retries 限制。
 */

export const DESIGN_STATES = [
  'PARSING',
  'SPEC_READY',
  'DESIGNING',
  'TESTING',
  'VERIFYING',
  'DELIVERING',
  'DELIVERED',
  'FAILED',
] as const;

export type DesignState = (typeof DESIGN_STATES)[number];

/** 允许的状态迁移表。 */
export const ALLOWED_TRANSITIONS: Readonly<Record<DesignState, readonly DesignState[]>> = {
  PARSING: ['PARSING', 'SPEC_READY', 'FAILED'],
  SPEC_READY: ['DESIGNING', 'FAILED'],
  DESIGNING: ['TESTING', 'FAILED'],
  TESTING: ['VERIFYING', 'FAILED'],
  VERIFYING: ['DELIVERING', 'DESIGNING', 'FAILED'],
  DELIVERING: ['DELIVERED', 'DESIGNING', 'FAILED'],
  DELIVERED: [],
  FAILED: [],
};

/** 终态。 */
export function isTerminal(s: DesignState): boolean {
  return s === 'DELIVERED' || s === 'FAILED';
}

/** 迁移是否合法。 */
export function canTransition(from: DesignState, to: DesignState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class StateTransitionError extends Error {
  constructor(
    public readonly from: DesignState,
    public readonly to: DesignState,
  ) {
    super(`STATE_TRANSITION_ILLEGAL: ${from} → ${to} 不允许`);
    this.name = 'StateTransitionError';
  }
}

/** 状态机实例：记录迁移历史，非法迁移抛错。 */
export class DesignStateMachine {
  private current: DesignState = 'PARSING';
  private readonly history: { from: DesignState; to: DesignState; at: string; reason: string }[] = [];

  get state(): DesignState {
    return this.current;
  }

  get timeline(): readonly { from: DesignState; to: DesignState; at: string; reason: string }[] {
    return this.history;
  }

  /** 执行迁移；非法即抛 StateTransitionError。 */
  transition(to: DesignState, reason: string): DesignState {
    if (!canTransition(this.current, to)) throw new StateTransitionError(this.current, to);
    const from = this.current;
    this.current = to;
    this.history.push({ from, to, at: new Date().toISOString(), reason });
    return this.current;
  }

  /** 尝试迁移（不抛错，返回是否成功）。 */
  tryTransition(to: DesignState, reason: string): boolean {
    if (!canTransition(this.current, to)) return false;
    this.transition(to, reason);
    return true;
  }
}
