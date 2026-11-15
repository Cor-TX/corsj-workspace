/**
 * @corsj/core — .eop 对象包：manifest 为唯一权威的 schema。
 *
 * 真格式规则（任务书 §2.1）：
 * - .eop 是唯一真格式；manifest 是包内唯一权威索引。
 * - STEP / IGES / STL / .kicad_sch / .msh / .frd / CSV / JSON 等标准格式
 *   只能作为 .eop 的对象载荷（payload），不得成为第二真格式。
 * - 对象只追加不删除；废弃用 supersedes 关系表达。
 */
import type { Quantity } from './quantity-schema.js';

/** 对象类型域。 */
export const OBJECT_TYPES = [
  'Requirement',      // 结构化需求条目
  'AcceptanceSpec',   // 验收规格（B 层生成，只读）
  'Part',             // 几何零件（载荷 STEP/IGES/STL）
  'PartAlias',        // 用户名别名（引用当前最新 Part，支持同名跨轮修订）
  'Assembly',         // 装配体
  'Schematic',        // 电路原理图（载荷 .kicad_sch）
  'PCB',              // PCB 版图（载荷 .kicad_pcb）
  'Mesh',             // 网格（载荷 .msh）
  'FieldResult',      // 仿真场结果（载荷 .frd / .vtk）
  'TimeSeries',       // 时间序列结果（CSV/JSON 载荷）
  'Table',            // 表格（BOM 等，CSV 载荷）
  'Report',           // 报告（Markdown/PDF 载荷）
  'Evidence',         // 证据记录（JSON 载荷，指向 artifacts）
  'Manufacturing',    // 制造包（载荷 Gerber/钻孔/贴片）
  'Manifest',         // 内部保留：包清单本身
] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

/** 对象间关系类型。 */
export const RELATION_TYPES = [
  'validates',    // AcceptanceSpec → 被验证对象
  'supersedes',   // 废弃关系（只追加语义下的“删除”）
  'derived_from', // 派生（如 Mesh derived_from Part）
  'references',   // 一般引用（证据 → 命令运行等）
  'contains',     // 装配包含
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export interface Relation {
  type: RelationType;
  /** 目标对象 id。 */
  target: string;
}

/** 载荷条目：包内文件 + 元数据。 */
export interface Payload {
  /** 包内相对路径，POSIX 分隔。 */
  path: string;
  media_type: string;
  /** SHA256（hex）。 */
  sha256: string;
  size: number;
  /** 该载荷扮演的角色（如 step、report-json、erc-report）。 */
  role?: string;
}

/** manifest 中的对象记录。 */
export interface ObjectRecord {
  /** 包内唯一 id，如 Part-0007。 */
  id: string;
  object_type: ObjectType;
  /** 对象标题/说明。 */
  title?: string;
  /** 创建时间（ISO 8601，UTC）。 */
  created_at: string;
  /** 生成该对象的命令运行 id（可追溯）。 */
  produced_by?: string;
  /** 依赖/关联。 */
  relations: Relation[];
  /** 载荷列表。 */
  payloads: Payload[];
  /** 领域扩展属性（如几何包围盒、ERC 统计）。 */
  attributes?: Record<string, unknown>;
}

/** .eop 包 manifest —— 唯一权威。 */
export interface EopManifest {
  schema: 'corsj.eop/1';
  /** 包 id。 */
  id: string;
  /** 包标题。 */
  title: string;
  created_at: string;
  updated_at: string;
  /** 创建该包的 core 版本。 */
  core_version: string;
  /** 对象列表（追加序）。 */
  objects: ObjectRecord[];
  /** 证据目录：命令运行 → artifacts 索引。 */
  evidence: EvidenceRecord[];
}

/** 证据记录：A 层命令运行的可寻址回执。 */
export interface EvidenceRecord {
  /** 证据 id（evidence_ref 引用它），如 ev-0003。 */
  id: string;
  /** 产生该证据的命令 id。 */
  command: string;
  /** 命令运行序号。 */
  run: number;
  created_at: string;
  status: 'success' | 'design_error' | 'env_error' | 'not_implemented';
  /** artifacts 在包内的路径前缀，如 artifacts/0003-fea.static/。 */
  artifacts_prefix: string;
  /** 结构化结果 JSON 的包内路径。 */
  result_json: string;
  /** 摘要（命令自定义）。 */
  summary?: Record<string, unknown>;
}

/** .eop 文件头（zip 内首个条目）。 */
export const EOP_MANIFEST_ENTRY = 'manifest.json';
export const EOP_SCHEMA = 'corsj.eop/1';
export const EOP_EXTENSION = '.eop';
