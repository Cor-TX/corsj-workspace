/**
 * @corsj/dsh — DSH 模型持久化（.jsonl.zstd）。
 *
 * 落盘位置：<userData>/dsh/sessions/<sessionId>.jsonl.zstd
 * 格式：JSONL（每行一条记录），整体 zstd 压缩。首行固定为 header 记录，
 * 携带 content fingerprint（对后续记录的规范化 JSON 取 SHA256）。
 *
 * 启动校验：读取时重算指纹并与 header 比对；不一致按 env_error 处理
 * （读取失败 / 指纹不匹配均抛 PersistenceFingerprintError，由宿主归类为 env_error）。
 *
 * 本模块不读取 DSH 用户配置，不持有任何 API key。
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

/** 持久化指纹校验失败（宿主归类为 env_error）。 */
export class PersistenceFingerprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceFingerprintError';
  }
}

/** 规范化字符串化（键排序，指纹可复现）；由宿主注入 core 的 stableStringify。 */
export type StableStringify = (x: unknown) => string;

interface HeaderRecord {
  type: 'header';
  session_id: string;
  core_version: string;
  fingerprint: string;
  record_count: number;
  created_at: string;
  updated_at: string;
}

export interface SessionStoreOptions {
  /** 会话根目录（如 <userData>/dsh/sessions）。 */
  sessionsDir: string;
  /** 规范化字符串化（core stableStringify）。 */
  stringify: StableStringify;
}

/** 会话持久化存储：读写 .jsonl.zstd，启动校验指纹。 */
export class SessionStore {
  private readonly dir: string;
  private readonly stringify: StableStringify;

  constructor(opts: SessionStoreOptions) {
    this.dir = opts.sessionsDir;
    this.stringify = opts.stringify;
  }

  /** 会话文件路径。 */
  filePath(sessionId: string): string {
    return join(this.dir, sessionId + '.jsonl.zstd');
  }

  /** 确保目录存在。 */
  async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  /** 列出已有会话 id（不含扩展名）。 */
  async listSessions(): Promise<string[]> {
    try {
      const entries = await readdir(this.dir);
      return entries
        .filter((f) => f.endsWith('.jsonl.zstd'))
        .map((f) => f.slice(0, -'.jsonl.zstd'.length))
        .sort();
    } catch {
      return [];
    }
  }

  /** 计算记录指纹（对记录数组的规范化 JSON 取 SHA256）。 */
  private fingerprint(records: unknown[]): string {
    return createHash('sha256').update(this.stringify(records)).digest('hex');
  }

  /** 原子写会话：先写临时文件再 rename，避免半写。 */
  async save(sessionId: string, coreVersion: string, records: unknown[]): Promise<{ path: string; fingerprint: string }> {
    await this.ensureDir();
    const header: HeaderRecord = {
      type: 'header',
      session_id: sessionId,
      core_version: coreVersion,
      fingerprint: this.fingerprint(records),
      record_count: records.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const lines = [JSON.stringify(header), ...records.map((r) => JSON.stringify(r))];
    const jsonl = lines.join('\n') + '\n';
    const compressed = zstdCompressSync(Buffer.from(jsonl, 'utf8'));
    const finalPath = this.filePath(sessionId);
    const tmpPath = finalPath + '.tmp';
    await writeFile(tmpPath, compressed);
    await rename(tmpPath, finalPath);
    return { path: finalPath, fingerprint: header.fingerprint };
  }

  /**
   * 读取会话并校验指纹。
   * @returns 记录数组（不含 header）；指纹不一致或读取失败抛 PersistenceFingerprintError。
   */
  async load(sessionId: string): Promise<{ records: unknown[]; fingerprint: string; core_version: string }> {
    const path = this.filePath(sessionId);
    let compressed: Buffer;
    try {
      compressed = await readFile(path);
    } catch (err) {
      throw new PersistenceFingerprintError('会话文件不可读: ' + sessionId + ' (' + String(err) + ')');
    }
    let jsonl: string;
    try {
      jsonl = zstdDecompressSync(compressed).toString('utf8');
    } catch (err) {
      throw new PersistenceFingerprintError('会话文件不是合法 zstd: ' + sessionId + ' (' + String(err) + ')');
    }
    const lines = jsonl.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) throw new PersistenceFingerprintError('会话文件为空: ' + sessionId);
    let header: HeaderRecord;
    try {
      header = JSON.parse(lines[0]) as HeaderRecord;
    } catch (err) {
      throw new PersistenceFingerprintError('会话 header 非法: ' + sessionId + ' (' + String(err) + ')');
    }
    if (header.type !== 'header') throw new PersistenceFingerprintError('会话首行不是 header: ' + sessionId);
    const records = lines.slice(1).map((l) => JSON.parse(l));
    const actual = this.fingerprint(records);
    if (actual !== header.fingerprint) {
      throw new PersistenceFingerprintError(
        '会话指纹不一致: ' + sessionId + ' (expected ' + header.fingerprint + ', actual ' + actual + ')',
      );
    }
    return { records, fingerprint: header.fingerprint, core_version: header.core_version };
  }

  /** 删除会话（自检 / 清理用）。 */
  async remove(sessionId: string): Promise<void> {
    try {
      await unlink(this.filePath(sessionId));
    } catch {
      // 不存在则忽略
    }
  }
}
