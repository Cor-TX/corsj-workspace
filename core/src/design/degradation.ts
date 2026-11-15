/**
 * @corsj/core — 降级记录。
 *
 * 规则（任务书 §2.3）：
 * - 被跳过 / 未实现的 optional 能力必须留下降级记录，进入门禁报告：
 *   命令 id、原因、受影响的验证项。
 * - 降级项不得被计为「通过」。
 * - 降级记录进入报告摘要与签名。
 * - 验证完成后不可修改（只读 + 哈希进入签名）。
 */
import { createHash } from 'node:crypto';

export type DegradationKind = 'not_implemented' | 'skipped_optional' | 'skipped_due_to_env';

export interface DegradationRecord {
  id: string;
  /** 被降级的命令 id（扩展命令或用户显式跳过的核心命令）。 */
  command: string;
  kind: DegradationKind;
  /** 人类可读原因。 */
  reason: string;
  /** 受影响的验证项 id（可为空：表示没有验证项依赖它）。 */
  affected_validators: string[];
  /** 记录时间。 */
  at: string;
}

/** 生成一条降级记录。 */
export function degradationRecord(input: {
  command: string;
  kind: DegradationKind;
  reason: string;
  affected_validators?: string[];
  at?: string;
  seq: number;
}): DegradationRecord {
  return {
    id: `DEG-${String(input.seq).padStart(4, '0')}`,
    command: input.command,
    kind: input.kind,
    reason: input.reason,
    affected_validators: input.affected_validators ?? [],
    at: input.at ?? new Date().toISOString(),
  };
}

/** 降级记录集合的稳定哈希（进入报告签名）。 */
export function degradationDigest(records: readonly DegradationRecord[]): string {
  const canonical = records
    .map((r) => [r.id, r.command, r.kind, r.reason, [...r.affected_validators].sort().join(','), r.at].join('\u0000'))
    .sort()
    .join('\u0001');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** 冻结版降级记录（验证后不可改）。 */
export interface FrozenDegradation {
  readonly records: readonly Readonly<DegradationRecord>[];
  readonly digest: string;
}

/** 冻结降级记录：返回深拷贝 + 摘要，验证后 B 层只能读。 */
export function freezeDegradation(records: readonly DegradationRecord[]): FrozenDegradation {
  const copy = records.map((r) => Object.freeze({ ...r, affected_validators: Object.freeze([...r.affected_validators]) as unknown as string[] }));
  return Object.freeze({ records: Object.freeze(copy) as unknown as readonly Readonly<DegradationRecord>[], digest: degradationDigest(records) });
}

/** 校验降级记录结构。 */
export function validateDegradation(records: readonly DegradationRecord[]): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const r of records) {
    if (!r.id) errors.push('降级记录缺 id');
    else if (ids.has(r.id)) errors.push(`降级记录 id 重复: ${r.id}`);
    else ids.add(r.id);
    if (!r.command) errors.push(`降级记录 ${r.id} 缺 command`);
    if (!r.reason) errors.push(`降级记录 ${r.id} 缺 reason`);
    if (!Array.isArray(r.affected_validators)) errors.push(`降级记录 ${r.id} affected_validators 缺失`);
  }
  return { ok: errors.length === 0, errors };
}
