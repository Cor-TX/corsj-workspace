/**
 * @corsj-core — .eop 对象包读写器。
 *
 * 物理格式：zip 容器（deflate），首个条目固定为 manifest.json。
 * manifest 是唯一权威：对象与证据都必须登记进 manifest 才算存在。
 * 只追加语义：已登记对象不可移除；废弃用 supersedes 表达。
 */
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import {
  EOP_MANIFEST_ENTRY, EOP_SCHEMA,
  type EopManifest, type EvidenceRecord, type ObjectRecord, type Payload,
} from './eop-types.js';

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function nowISO(): string {
  return new Date().toISOString();
}

/** 新建空 manifest。 */
export function createManifest(id: string, title: string, coreVersion: string): EopManifest {
  const t = nowISO();
  return { schema: EOP_SCHEMA, id, title, created_at: t, updated_at: t, core_version: coreVersion, objects: [], evidence: [] };
}

/** manifest 结构校验（读写时都要过）。 */
export function validateManifest(m: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof m !== 'object' || m === null) return { ok: false, errors: ['manifest 不是对象'] };
  const mm = m as Partial<EopManifest>;
  if (mm.schema !== EOP_SCHEMA) errors.push(`schema 必须为 ${EOP_SCHEMA}`);
  if (typeof mm.id !== 'string' || !mm.id) errors.push('id 缺失');
  if (!Array.isArray(mm.objects)) errors.push('objects 必须为数组');
  if (!Array.isArray(mm.evidence)) errors.push('evidence 必须为数组');
  const ids = new Set<string>();
  for (const o of mm.objects ?? []) {
    if (!o.id) errors.push('对象缺 id');
    else {
      if (ids.has(o.id)) errors.push(`对象 id 重复: ${o.id}`);
      ids.add(o.id);
    }
    if (!Array.isArray(o.relations)) errors.push(`对象 ${o.id} relations 缺失`);
    if (!Array.isArray(o.payloads)) errors.push(`对象 ${o.id} payloads 缺失`);
    for (const r of o.relations ?? []) {
      if (!RELATION_TYPES_SET.has(r.type)) errors.push(`对象 ${o.id} 关系类型非法: ${String(r.type)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

const RELATION_TYPES_SET = new Set(['validates', 'supersedes', 'derived_from', 'references', 'contains']);

/** .eop 包对象：读、追加、写出。 */
export class EopPackage {
  private entries = new Map<string, Uint8Array>();
  private mf: EopManifest;
  private appendOnlyIndex = 0; // 已冻结的 manifest.objects 长度（历史不可变）

  private constructor(manifest: EopManifest, entries: Map<string, Uint8Array>) {
    this.mf = manifest;
    this.entries = entries;
    this.appendOnlyIndex = manifest.objects.length;
  }

  /** 从 zip 字节读取。 */
  static read(data: Uint8Array): EopPackage {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(data);
    } catch (e) {
      throw new Error(`EOP_READ_FAILED: 不是有效的 .eop（zip）容器: ${(e as Error).message}`);
    }
    const raw = files[EOP_MANIFEST_ENTRY];
    if (!raw) throw new Error('EOP_READ_FAILED: 缺少 manifest.json');
    let manifest: EopManifest;
    try {
      manifest = JSON.parse(strFromU8(raw)) as EopManifest;
    } catch (e) {
      throw new Error(`EOP_READ_FAILED: manifest.json 不是合法 JSON: ${(e as Error).message}`);
    }
    const v = validateManifest(manifest);
    if (!v.ok) throw new Error(`EOP_READ_FAILED: manifest 校验失败: ${v.errors.join('; ')}`);
    return new EopPackage(manifest, new Map(Object.entries(files)));
  }

  /** 新建空包。 */
  static create(id: string, title: string, coreVersion: string): EopPackage {
    return new EopPackage(createManifest(id, title, coreVersion), new Map());
  }

  /** manifest 只读视图。 */
  get manifest(): Readonly<EopManifest> {
    return this.mf;
  }

  /** 按 id 取对象记录。 */
  getObject(id: string): ObjectRecord | undefined {
    return this.mf.objects.find((o) => o.id === id);
  }

  /** 列对象（可按类型过滤）。 */
  listObjects(type?: ObjectRecord['object_type']): ObjectRecord[] {
    return type ? this.mf.objects.filter((o) => o.object_type === type) : [...this.mf.objects];
  }

  /** 列全部证据记录。 */
  listEvidence(): EvidenceRecord[] {
    return [...this.mf.evidence];
  }

  /** 取证据记录。 */
  getEvidence(id: string): EvidenceRecord | undefined {
    return this.mf.evidence.find((e) => e.id === id);
  }

  /** 读载荷字节。 */
  readPayload(path: string): Uint8Array | undefined {
    return this.entries.get(path);
  }

  /** 读载荷文本。 */
  readPayloadText(path: string): string | undefined {
    const b = this.readPayload(path);
    return b === undefined ? undefined : strFromU8(b);
  }

  /** 读 JSON 载荷。 */
  readPayloadJson<T = unknown>(path: string): T | undefined {
    const t = this.readPayloadText(path);
    if (t === undefined) return undefined;
    return JSON.parse(t) as T;
  }

  /**
   * 追加对象（唯一写入口）。只追加：不允许覆盖已有 id。
   * 载荷文件写入后登记进 manifest 才算存在。
   */
  addObject(rec: Omit<ObjectRecord, 'created_at'>, payloads: { path: string; data: Uint8Array; media_type: string; role?: string }[]): ObjectRecord {
    if (this.getObject(rec.id)) throw new Error(`EOP_APPEND_ONLY: 对象已存在，不可覆盖: ${rec.id}`);
    const payloadRecords: Payload[] = payloads.map((p) => {
      const normPath = p.path.replaceAll('\\', '/').replace(/^\//, '');
      if (normPath === EOP_MANIFEST_ENTRY) throw new Error('载荷不得占用 manifest.json');
      const data = p.data;
      const existing = this.entries.get(normPath);
      if (existing && sha256(existing) !== sha256(data)) {
        throw new Error(`EOP_APPEND_ONLY: 载荷已存在且内容不同: ${normPath}`);
      }
      this.entries.set(normPath, data);
      return { path: normPath, media_type: p.media_type, sha256: sha256(data), size: data.byteLength, role: p.role };
    });
    const full: ObjectRecord = { ...rec, created_at: nowISO(), payloads: payloadRecords };
    this.mf.objects.push(full);
    this.mf.updated_at = nowISO();
    return full;
  }

  /**
   * 追加证据记录（A 层命令运行回执）。返回 evidence_ref。
   */
  addEvidence(ev: Omit<EvidenceRecord, 'created_at'>, artifacts: { path: string; data: Uint8Array }[]): EvidenceRecord {
    if (this.getEvidence(ev.id)) throw new Error(`EOP_APPEND_ONLY: 证据已存在: ${ev.id}`);
    for (const a of artifacts) {
      const normPath = a.path.replaceAll('\\', '/').replace(/^\//, '');
      this.entries.set(normPath, a.data);
    }
    const full: EvidenceRecord = { ...ev, created_at: nowISO() };
    this.mf.evidence.push(full);
    this.mf.updated_at = nowISO();
    return full;
  }

  /** 校验包内所有载荷哈希与 manifest 一致。 */
  verifyPayloadIntegrity(): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const o of this.mf.objects) {
      for (const p of o.payloads) {
        const b = this.entries.get(p.path);
        if (!b) { errors.push(`${o.id}: 载荷缺失 ${p.path}`); continue; }
        if (sha256(b) !== p.sha256) errors.push(`${o.id}: 载荷哈希不一致 ${p.path}`);
      }
    }
    for (const e of this.mf.evidence) {
      const b = this.entries.get(e.result_json);
      if (!b) errors.push(`证据 ${e.id}: result_json 缺失 ${e.result_json}`);
    }
    return { ok: errors.length === 0, errors };
  }

  /**
   * 计算包指纹（交付门禁用）：对 manifest 的规范化 JSON 取 SHA256。
   * 任何对 objects/evidence 的修改都会改变指纹 —— 门禁据此发现篡改。
   */
  fingerprint(): string {
    const norm = stableStringify(this.mf);
    return sha256(new TextEncoder().encode(norm));
  }

  /** 读取时快照的指纹（用于检测读后篡改）。 */
  baselineFingerprint(): string {
    return this.fingerprint();
  }

  /** 写出 zip 字节。 */
  toBytes(): Uint8Array {
    const files: Record<string, Uint8Array> = {};
    for (const [k, v] of this.entries) files[k] = v;
    files[EOP_MANIFEST_ENTRY] = strToU8(JSON.stringify(this.mf, null, 2));
    return zipSync(files, { level: 6 });
  }

  /** 列出全部条目路径。 */
  listEntries(): string[] {
    return [...this.entries.keys()].sort();
  }
}

/** 稳定字符串化（键排序，指纹可复现）。 */
export function stableStringify(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`;
  const obj = x as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** 保存 .eop 到文件（Node 环境）。 */
export async function saveEop(pkg: EopPackage, filePath: string): Promise<void> {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, pkg.toBytes());
}

/** 从文件加载 .eop（Node 环境）。 */
export async function loadEop(filePath: string): Promise<EopPackage> {
  const { readFile } = await import('node:fs/promises');
  return EopPackage.read(new Uint8Array(await readFile(filePath)));
}

export type { ObjectRecord };
