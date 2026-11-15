/**
 * @corsj/core — 迭代参数配置加载器。
 *
 * 路径解析（附录 B）：
 * - 运行期默认：<userData>/corsj/config/iteration.json（locator 解析）；
 * - 开发期默认：corsj-workspace/.cache/config/iteration.json；
 * - 缺省时用默认值（max_rounds=10, max_env_retries=3），
 *   并把 source=default 带回，最终报告须记录「使用默认迭代参数」。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CorsjLocator } from '../../locator/index.js';
import {
  DEFAULT_ITERATION_CONFIG, validateIterationConfig,
  type IterationConfig,
} from './schema.js';

export const ITERATION_CONFIG_FILENAME = 'iteration.json';

/**
 * 从 locator 解析的路径加载配置。
 * 优先级：<userData>/corsj/config/iteration.json → dev 工作区 .cache/config/iteration.json → 默认。
 */
export function loadIterationConfig(locator: CorsjLocator, devWorkspaceRoot?: string): IterationConfig {
  const candidates: string[] = [locator.configPath(ITERATION_CONFIG_FILENAME)];
  if (devWorkspaceRoot) {
    candidates.push(join(devWorkspaceRoot, '.cache', 'config', ITERATION_CONFIG_FILENAME));
  } else {
    // dev 模式 locator 的 userDataRoot 本身就在工作区 .cache 下，补一个对称路径
    candidates.push(join(locator.userDataRoot(), '..', 'config', ITERATION_CONFIG_FILENAME));
  }
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8'));
      const v = validateIterationConfig(raw);
      if (!v.ok) {
        throw new Error(`ITERATION_CONFIG_INVALID: ${p}: ${v.errors.join('; ')}`);
      }
      return { ...raw, source: 'file' as const, loaded_from: p };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith('ITERATION_CONFIG_INVALID')) throw e;
      throw new Error(`ITERATION_CONFIG_INVALID: ${p}: ${(e as Error).message}`);
    }
  }
  return { ...DEFAULT_ITERATION_CONFIG };
}
