/**
 * @corsj/core — 迭代循环参数配置 schema。
 *
 * 参数只影响循环控制，不参与验收判定；AcceptanceSpec 的阈值
 * 不由本配置覆盖（任务书附录 B）。
 */

export interface IterationParams {
  /** 轮数上限（design_error / 阈值未过的设计迭代计数）。默认 10。 */
  max_rounds: number;
  /** 环境异常重试上限（env_error 连续重试）。默认 3。 */
  max_env_retries: number;
}

export interface IterationConfig {
  config_version: 'corsj.iteration/1';
  params: IterationParams;
  /** 记录该配置是文件加载还是缺省默认。 */
  source: 'file' | 'default';
  /** 文件路径（source=file 时）。 */
  loaded_from?: string;
}

export const DEFAULT_ITERATION_PARAMS: IterationParams = {
  max_rounds: 10,
  max_env_retries: 3,
};

export const DEFAULT_ITERATION_CONFIG: IterationConfig = {
  config_version: 'corsj.iteration/1',
  params: DEFAULT_ITERATION_PARAMS,
  source: 'default',
};

/** 配置 schema 校验。 */
export function validateIterationConfig(x: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const c = x as Partial<IterationConfig> | null;
  if (!c || typeof c !== 'object') return { ok: false, errors: ['配置不是对象'] };
  if (c.config_version !== 'corsj.iteration/1') errors.push('config_version 必须为 corsj.iteration/1');
  const p = c.params as IterationParams | undefined;
  if (!p || typeof p !== 'object') { errors.push('params 缺失'); return { ok: false, errors }; }
  if (typeof p.max_rounds !== 'number' || !Number.isInteger(p.max_rounds) || p.max_rounds < 1 || p.max_rounds > 1000) {
    errors.push('params.max_rounds 必须为 1–1000 的整数');
  }
  if (typeof p.max_env_retries !== 'number' || !Number.isInteger(p.max_env_retries) || p.max_env_retries < 0 || p.max_env_retries > 100) {
    errors.push('params.max_env_retries 必须为 0–100 的整数');
  }
  return { ok: errors.length === 0, errors };
}

/** A 层命令结果状态（任务书 §2.1 的取值域）。 */
export type CommandStatus = 'success' | 'design_error' | 'env_error' | 'not_implemented';

/**
 * 归类规则（附录 B）：
 * - design_error → 设计不合格迭代（计轮数）；
 * - env_error → 环境异常重试/阻塞（计重试，不计轮数）；
 * - not_implemented → 不计轮数、不触发参数修改；
 * - success 但阈值未过 → 设计不合格迭代（计轮数）。
 */
export type FailureClass = 'design_iteration' | 'env_retry' | 'not_counted' | 'passed';

export function classify(status: CommandStatus, thresholdsPassed: boolean | null): FailureClass {
  switch (status) {
    case 'not_implemented': return 'not_counted';
    case 'env_error': return 'env_retry';
    case 'design_error': return 'design_iteration';
    case 'success': return thresholdsPassed === false ? 'design_iteration' : thresholdsPassed === true ? 'passed' : 'not_counted';
  }
}
