/**
 * @corsj/core — .eop 浏览模型。
 *
 * 只读视图：对象树 + 载荷列表 + 证据目录。
 * manifest 是唯一权威，视图不引入第二真格式。
 */
import { readFile } from 'node:fs/promises';
import { EopPackage } from './eop.js';
import type { EvidenceRecord, ObjectRecord, ObjectType, Relation, Payload } from './eop-types.js';

export interface ViewerPayload {
  path: string;
  media_type: string;
  role?: string;
  size: number;
  sha256: string;
}

export interface ViewerNode {
  id: string;
  object_type: ObjectType;
  title?: string;
  created_at: string;
  produced_by?: string;
  relations: Relation[];
  payloads: ViewerPayload[];
  attributes?: Record<string, unknown>;
}

export interface ViewerEvidence {
  id: string;
  command: string;
  run: number;
  status: EvidenceRecord['status'];
  created_at: string;
  result_json: string;
  artifacts_prefix: string;
  summary?: Record<string, unknown>;
}

export interface EopView {
  id: string;
  title: string;
  schema: string;
  core_version: string;
  created_at: string;
  updated_at: string;
  /** 对象树（按 object_type 分组）。 */
  groups: { object_type: ObjectType; nodes: ViewerNode[] }[];
  evidence: ViewerEvidence[];
  fingerprint: string;
  integrity: { ok: boolean; errors: string[] };
  payload_count: number;
  total_bytes: number;
}

function toPayload(p: Payload): ViewerPayload {
  return { path: p.path, media_type: p.media_type, role: p.role, size: p.size, sha256: p.sha256 };
}

function toNode(o: ObjectRecord): ViewerNode {
  return {
    id: o.id,
    object_type: o.object_type,
    title: o.title,
    created_at: o.created_at,
    produced_by: o.produced_by,
    relations: [...o.relations],
    payloads: o.payloads.map(toPayload),
    attributes: o.attributes,
  };
}

/** 从已打开的包构建视图。 */
export function buildView(pkg: EopPackage): EopView {
  const m = pkg.manifest;
  const byType = new Map<ObjectType, ViewerNode[]>();
  for (const o of m.objects) {
    const arr = byType.get(o.object_type) ?? [];
    arr.push(toNode(o));
    byType.set(o.object_type, arr);
  }
  const groups = [...byType.entries()].map(([object_type, nodes]) => ({ object_type, nodes }));
  const payloads = m.objects.flatMap((o) => o.payloads);
  return {
    id: m.id,
    title: m.title,
    schema: m.schema,
    core_version: m.core_version,
    created_at: m.created_at,
    updated_at: m.updated_at,
    groups,
    evidence: m.evidence.map((e) => ({
      id: e.id, command: e.command, run: e.run, status: e.status,
      created_at: e.created_at, result_json: e.result_json,
      artifacts_prefix: e.artifacts_prefix, summary: e.summary,
    })),
    fingerprint: pkg.fingerprint(),
    integrity: pkg.verifyPayloadIntegrity(),
    payload_count: payloads.length,
    total_bytes: payloads.reduce((s, p) => s + p.size, 0),
  };
}

/** 读取 .eop 文件并构建视图。 */
export async function loadView(filePath: string): Promise<EopView> {
  const bytes = await readFile(filePath);
  return buildView(EopPackage.read(new Uint8Array(bytes)));
}

/** 读取某对象某个角色的载荷文本（不存在返回 undefined）。 */
export function readObjectPayloadText(pkg: EopPackage, objectId: string, roleOrPath: string): string | undefined {
  const obj = pkg.getObject(objectId);
  if (!obj) return undefined;
  const p = obj.payloads.find((x) => x.role === roleOrPath) ?? obj.payloads.find((x) => x.path === roleOrPath);
  if (!p) return undefined;
  return pkg.readPayloadText(p.path);
}

/** 读取某对象某个角色的载荷字节。 */
export function readObjectPayload(pkg: EopPackage, objectId: string, roleOrPath: string): Uint8Array | undefined {
  const obj = pkg.getObject(objectId);
  if (!obj) return undefined;
  const p = obj.payloads.find((x) => x.role === roleOrPath) ?? obj.payloads.find((x) => x.path === roleOrPath);
  if (!p) return undefined;
  return pkg.readPayload(p.path);
}

/** 读取证据结果 JSON。 */
export function readEvidenceJson<T = unknown>(pkg: EopPackage, evidenceId: string): T | undefined {
  const e = pkg.getEvidence(evidenceId);
  if (!e) return undefined;
  return pkg.readPayloadJson<T>(e.result_json);
}
