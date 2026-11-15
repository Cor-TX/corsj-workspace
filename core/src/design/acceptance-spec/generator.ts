/**
 * @corsj/core — AcceptanceSpec 生成器（B 层）。
 *
 * 唯一职责：把「目标原文 + 结构化需求」变成可冻结的验收依据。
 *
 * 铁律（任务书 §2.1）：
 * - REQUIRED 验证项缺阈值时，B 层不得自行假设，必须回 PARSING 并给出结构化补充请求。
 * - 用户明确授权的保守默认值才可写入，且必须逐条记录授权（谁/何时/依据）。
 * - 阈值只来自用户目标、用户补充或已授权默认值；参数（轮次/重试）不得影响阈值。
 * - 阈值量纲必须与验证器输出量纲一致，否则 spec 生成失败。
 */
import type {
  AcceptanceSpec, ClarificationRequest, RequirementItem, Threshold, ThresholdOp, ValidatorSpec,
} from './schema.js';
import { validateAcceptanceSpec } from './schema.js';
import { DIM, findUnit, type DimName } from '../../model/units.js';
import { canBeRequired, validateStrengthGrant } from './eligibility-matrix.js';

/** 目标解析结果（来自 A 层 spec.parse_requirements 的 raw_data）。 */
export interface ParsedRequirements {
  requirements: { id: string; text: string; category: string; mandatory: boolean; suggested_commands: string[] }[];
  quantities: { raw: string; value: number; unit: string }[];
  detected_domains: string[];
}

/** 指标提取规则：把自然语言里的指标映射到某命令 raw_data 的字段。 */
export interface MetricRule {
  id: string;
  command: string;
  /** raw_data 中的字段路径（点路径）。 */
  field: string;
  /** 期望量纲。 */
  dim: DimName;
  /** 指标关键词。 */
  keywords: RegExp;
  kind: 'numeric' | 'count' | 'boolean';
  /** 绝对温度：degC 目标需换算为 K。 */
  absolute?: boolean;
  description: string;
  /** 已授权时可用的保守默认值。 */
  conservative?: { value: number; unit: string };
}

/** 指标规则表（B 层知识，不进入 A 层）。 */
export const METRIC_RULES: readonly MetricRule[] = [
  { id: 'stress', command: 'fea.static', field: 'max_von_mises', dim: 'stress', keywords: /应力|强度|屈服|安全系数|承载力/, kind: 'numeric', description: '最大 von Mises 应力', conservative: { value: 100, unit: 'MPa' } },
  { id: 'displacement', command: 'fea.static', field: 'max_displacement', dim: 'length', keywords: /位移|变形|挠度|下沉|形变/, kind: 'numeric', description: '最大位移', conservative: { value: 1, unit: 'mm' } },
  { id: 'volume', command: 'geometry.generate', field: 'volume', dim: 'volume', keywords: /体积|容积|用料量/, kind: 'numeric', description: '几何体积', conservative: { value: 0.01, unit: 'm3' } },
  { id: 'mass', command: 'arrangement.mass_cg', field: 'total_mass', dim: 'mass', keywords: /质量|重量|总重|自重/, kind: 'numeric', description: '总质量', conservative: { value: 2, unit: 'kg' } },
  { id: 'interference', command: 'arrangement.interference', field: 'conflict_count', dim: 'count', keywords: /干涉|重叠|碰撞|间隙不足/, kind: 'count', description: '干涉处数', conservative: { value: 0, unit: 'count' } },
  { id: 'erc', command: 'eda.schematic_erc', field: 'errors', dim: 'count', keywords: /ERC|电气规则|原理图检查|原理图错误/, kind: 'count', description: 'ERC 错误数', conservative: { value: 0, unit: 'count' } },
  { id: 'drc', command: 'eda.pcb_drc', field: 'findings_count', dim: 'count', keywords: /DRC|设计规则|PCB 检查|布线规则/, kind: 'count', description: 'DRC 发现数', conservative: { value: 0, unit: 'count' } },
  { id: 'energy_balance', command: 'energy.closure_sim', field: 'energy_balance_error', dim: 'dimensionless', keywords: /能量平衡|能量闭合|能量误差|能量守恒/, kind: 'numeric', description: '能量平衡相对误差', conservative: { value: 1, unit: '%' } },
  { id: 'natural_freq', command: 'motion.sim', field: 'natural_freq_Hz', dim: 'frequency', keywords: /固有频率|共振频率|一阶频率/, kind: 'numeric', description: '一阶固有频率', conservative: { value: 50, unit: 'Hz' } },
  { id: 'motion_disp', command: 'motion.sim', field: 'max_displacement_m', dim: 'length', keywords: /振幅|振动位移|响应位移/, kind: 'numeric', description: '振动最大位移', conservative: { value: 1, unit: 'mm' } },
  { id: 'link_margin', command: 'comm.link_budget', field: 'link_margin_dB', dim: 'decibel', keywords: /链路余量|链路裕度|余量/, kind: 'numeric', description: '链路余量', conservative: { value: 3, unit: 'dB' } },
  { id: 'pressure_drop', command: 'fluid.resistance_solve', field: 'pressure_drop_Pa', dim: 'pressure', keywords: /压降|压力损失|流阻|阻力损失/, kind: 'numeric', description: '管路压降', conservative: { value: 50, unit: 'kPa' } },
  { id: 'temperature', command: 'thermal.static_estimate', field: 'max_temp_K', dim: 'temperature', keywords: /温度|结温|最高温|温升/, kind: 'numeric', absolute: true, description: '最高温度', conservative: { value: 85, unit: 'degC' } },
  { id: 'validity', command: 'geometry.validity_check', field: 'validity', dim: 'dimensionless', keywords: /拓扑有效|几何有效|模型有效|有效性/, kind: 'boolean', description: '几何拓扑有效性', conservative: { value: 1, unit: '1' } },
  { id: 'propeller_power', command: 'propeller.design', field: 'power_W', dim: 'power', keywords: /螺旋桨|推进|推力|航速|转速|功率匹配/, kind: 'numeric', description: '螺旋桨所需功率', conservative: { value: 500, unit: 'W' } },
  { id: 'propeller_diameter', command: 'propeller.design', field: 'diameter_m', dim: 'length', keywords: /螺旋桨|推进|桨径|螺旋桨直径/, kind: 'numeric', description: '螺旋桨直径', conservative: { value: 0.5, unit: 'm' } },
  { id: 'hull_resistance', command: 'fluid.internal_flow', field: 'total_resistance_N', dim: 'force', keywords: /船体|水动力|阻力|巡航|航速/, kind: 'numeric', description: '船体总阻力', conservative: { value: 100, unit: 'N' } },
  { id: 'hull_power', command: 'fluid.internal_flow', field: 'required_power_W', dim: 'power', keywords: /船体|水动力|阻力|巡航|航速/, kind: 'numeric', description: '船体所需推进功率', conservative: { value: 500, unit: 'W' } },
];

/** 需求类别 → 必做验证命令（至少一条）。 */
const CATEGORY_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  '几何/结构': ['geometry.generate', 'geometry.validity_check'],
  '结构强度': ['fea.static'],
  '电子设计': ['eda.schematic_erc'],
  '能源': ['energy.closure_sim'],
  '运动': ['motion.sim'],
  '通信': ['comm.link_budget'],
  '流体': ['fluid.resistance_solve'],
  '推进': ['propeller.design'],
  '水动力': ['fluid.internal_flow'],
  '热': ['thermal.static_estimate'],
  '布置': ['arrangement.mass_cg', 'arrangement.interference'],
  '制造': ['manufacturing.package'],
  '物料': ['bom.generate'],
  '通用': [],
};

/**
 * 只要求「交付了证据」的命令：这些能力本身不做数值判定
 * （包、报告、格式导出），其 REQUIRED 阈值用 op='exists'。
 */
const EVIDENCE_ONLY_COMMANDS = new Set([
  'bom.generate', 'manufacturing.package', 'report.generate',
  'export.standard_format', 'geometry.format_convert', 'eda.manufacturing_export',
]);

interface QtyMatch { value: number; unit: string; index: number }

const QTY_RE = /(-?\d+(?:\.\d+)?)\s*(mm2|mm3|cm3|cm2|m3|m2|mm|cm|km|m|kg|g|t|MPa|kPa|GPa|Pa|mbar|bar|Nm|N|kN|kJ|kWh|Wh|J|kW|MW|mW|W|degC|°C|K|MHz|kHz|GHz|Hz|ms|min|h|s|mA|A|mAh|Ah|mV|kV|V|dB|%|m\/s|km\/h|bit\/s|kbit\/s|Mbit\/s|Gbit\/s|mm\/s|1|count)/g;

function findQuantities(text: string): QtyMatch[] {
  const out: QtyMatch[] = [];
  for (const m of text.matchAll(QTY_RE)) {
    out.push({ value: Number(m[1]), unit: m[2] === '°C' ? 'degC' : m[2], index: m.index ?? 0 });
  }
  return out;
}

function sameDimAs(unit: string, dim: DimName): boolean {
  const u = findUnit(unit);
  if (!u) return false;
  const got = DIM[u.quantity];
  const want = DIM[dim];
  return got !== undefined && got.every((x, i) => x === want[i]);
}

/** 从子句里判定比较方向。 */
function detectOp(clause: string): ThresholdOp | undefined {
  if (/不超过|不大于|小于等于|不高于|低于|小于|最多|上限|控制在|≤|<=|＜|</.test(clause)) return '<=';
  if (/不低于|不小于|大于等于|不少于|至少|最少|下限|以上|≥|>=|＞|>/.test(clause)) return '>=';
  if (/等于|恰好|==|＝/.test(clause)) return '==';
  if (/±|公差|范围内/.test(clause)) return 'within';
  return undefined;
}

/** 零缺陷表述判定（"无干涉" / "零错误" / "不存在违规"）。 */
function hasZeroTolerance(clause: string): boolean {
  return /无[^。；,，]{0,12}(干涉|错误|违规|重叠|冲突)|零[^。；,，]{0,8}(错误|干涉|违规)|没有[^。；,，]{0,12}(干涉|错误|违规)|不允许[^。；,，]{0,12}(干涉|错误|违规)|不得[^。；,，]{0,12}(干涉|违规)/.test(clause);
}

/** 布尔有效表述。 */
function detectBoolean(clause: string): number | undefined {
  if (/无效|不合格|不通过/.test(clause)) return 0;
  if (/有效|合格|通过|无错误/.test(clause)) return 1;
  return undefined;
}

export interface AuthorizationRecord {
  by: string;
  at: string;
  note: string;
}

export interface GenerateSpecInput {
  goalText: string;
  parsed: ParsedRequirements;
  iteration: { max_rounds: number; max_env_retries: number; used_rounds: number };
  /** 用户显式授权的保守默认值记录；未提供则缺失阈值一律回 PARSING。 */
  authorization?: AuthorizationRecord;
  /** spec id（用于 .eop 对象 id）。 */
  specId?: string;
  /** 创建时间（可注入以便自检可复现）。 */
  createdAt?: string;
}

export interface GenerateSpecResult {
  /** 已生成（可能仍带未决补充请求）的 spec。 */
  spec: AcceptanceSpec;
  /** 本次生成新增的补充请求。 */
  clarifications: ClarificationRequest[];
  /** 是否可直接冻结（无未决请求）。 */
  ready: boolean;
  errors: string[];
}

/** 需要数值阈值的命令：其 REQUIRED 验证项必须有至少一条阈值。 */
function requiresThreshold(command: string): boolean {
  return !EVIDENCE_ONLY_COMMANDS.has(command);
}

function clauseBlocks(goalText: string): string[] {
  // 句读切分；ASCII 句点若处于数字之间（小数点）不是分隔符
  return goalText
    .split(/[。；;!?\n]+|(?<!\d)\.(?!\d)/)
    .flatMap((s) => s.split(/[，,、]/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 便利输出：把已知量纲换算为 SI（degC 绝对温度单独处理）。 */
export function thresholdToSI(t: Threshold): number | undefined {
  if (t.op === 'exists') return undefined;
  if (!t.target) return undefined;
  const u = findUnit(t.target.unit);
  if (!u) return undefined;
  if (t.target.unit === 'degC') return t.target.value + 273.15;
  return t.target.value * u.toSI;
}

/** 生成 AcceptanceSpec。 */
export function generateAcceptanceSpec(input: GenerateSpecInput): GenerateSpecResult {
  const { goalText, parsed, iteration } = input;
  const blocks = clauseBlocks(goalText);
  const errors: string[] = [];
  const clarifications: ClarificationRequest[] = [];

  // 1. 需求条目（沿用 A 层解析结果，附加验证项映射）
  const requirements: RequirementItem[] = parsed.requirements.map((r) => ({
    id: r.id,
    text: r.text,
    category: r.category,
    validator_ids: [],
    mandatory: r.mandatory,
  }));

  // 2. 候选命令集合：需求类别映射 + 已匹配指标的所属命令
  const candidateCommands = new Set<string>();
  for (const r of requirements) {
    for (const c of CATEGORY_COMMANDS[r.category] ?? []) candidateCommands.add(c);
  }

  // 3. 指标匹配
  const matched = new Map<string, { rule: MetricRule; threshold: Threshold }[]>();
  for (const rule of METRIC_RULES) {
    for (const block of blocks) {
      if (!rule.keywords.test(block)) continue;
      candidateCommands.add(rule.command);
      const qs = findQuantities(block).filter((q) => sameDimAs(q.unit, rule.dim));
      if (rule.kind === 'boolean') {
        const b = detectBoolean(block);
        if (b === undefined) continue;
        push(matched, rule.command, {
          rule,
          threshold: { op: '==', target: { value: b, unit: '1' }, source: 'user_goal', field: rule.field },
        });
        continue;
      }
      if (rule.kind === 'count' && qs.length === 0) {
        if (!hasZeroTolerance(block)) continue;
        push(matched, rule.command, {
          rule,
          threshold: { op: '==', target: { value: 0, unit: 'count' }, source: 'user_goal', field: rule.field },
        });
        continue;
      }
      if (qs.length === 0) continue;
      const op = detectOp(block);
      if (!op) continue;
      if (op === 'within') continue; // ± 公差需补充请求确认中心值
      // 取离关键词最近的数量（同 block 内索引最小差）
      const kw = block.search(rule.keywords);
      const q = qs.slice().sort((a, b) => Math.abs(a.index - kw) - Math.abs(b.index - kw))[0]!;
      push(matched, rule.command, {
        rule,
        threshold: { op, target: { value: q.value, unit: q.unit }, source: 'user_goal', field: rule.field },
      });
      break; // 每个 rule 每个 block 只取一条
    }
  }

  // 4. 组装验证项
  const validators: ValidatorSpec[] = [];
  const cmdList = [...candidateCommands].sort();
  let idx = 1;
  for (const command of cmdList) {
    if (!canBeRequired(command)) continue; // 扩展命令不得 REQUIRED
    const hits = matched.get(command) ?? [];
    const thresholds: Threshold[] = hits.map((h) => h.threshold);
    const strength = 'REQUIRED' as const;
    if (requiresThreshold(command) && thresholds.length === 0) {
      const rule = METRIC_RULES.find((r) => r.command === command);
      if (input.authorization && rule?.conservative) {
        thresholds.push({
          op: rule.kind === 'count' || rule.kind === 'boolean' ? '==' : '<=',
          target: { value: rule.conservative.value, unit: rule.conservative.unit },
          source: 'conservative_default_authorized',
          authorization: input.authorization,
          field: rule.field,
        });
      } else {
        const cid = `CLR-${String(clarifications.length + 1).padStart(3, '0')}`;
        clarifications.push({
          id: cid,
          validator_id: `val-${command.replaceAll('.', '-')}`,
          question: buildQuestion(command, rule),
          expected_unit: rule?.conservative?.unit,
          suggested_conservative_default: rule?.conservative,
          status: 'open',
        });
        continue;
      }
    }
    if (thresholds.length === 0 && EVIDENCE_ONLY_COMMANDS.has(command)) {
      thresholds.push({ op: 'exists', source: 'user_goal', field: 'result_file' });
    }
    validators.push({
      id: `val-${command.replaceAll('.', '-')}`,
      command,
      strength,
      description: hits.length
        ? hits.map((h) => h.rule.description).join('；')
        : EVIDENCE_ONLY_COMMANDS.has(command) ? '要求产出可核验证据（存在性）' : '要求产出可核验证据',
      thresholds,
      requires_evidence: true,
    });
    idx += 1;
  }

  void idx;

  // 5. 需求 → 验证项反向映射
  for (const r of requirements) {
    const cmds = CATEGORY_COMMANDS[r.category] ?? [];
    r.validator_ids = validators
      .filter((v) => cmds.includes(v.command) || parsed.requirements.find((x) => x.id === r.id)?.suggested_commands.includes(v.command))
      .map((v) => v.id);
  }

  const spec: AcceptanceSpec = {
    spec_version: 'corsj.acceptance/1',
    spec_id: input.specId ?? `AS-${String(Date.now()).slice(-8)}`,
    goal_text: goalText,
    created_at: input.createdAt ?? new Date().toISOString(),
    state: 'draft',
    requirements,
    validators,
    open_clarifications: clarifications,
    iteration_budget: { ...iteration },
  };

  // 6. 自检：schema + 强度授予 + 量纲一致性
  const schema = validateAcceptanceSpec(spec);
  if (!schema.ok) errors.push(...schema.errors);
  const grant = validateStrengthGrant(spec.validators.map((v) => ({ command: v.command, strength: v.strength })));
  if (!grant.ok) errors.push(...grant.errors);
  for (const v of spec.validators) {
    for (const t of v.thresholds) {
      if (t.op === 'exists') continue;
      const rule = METRIC_RULES.find((r) => r.command === v.command && r.field === t.field);
      if (!rule || !t.target) continue;
      if (!sameDimAs(t.target.unit, rule.dim)) {
        errors.push(`验证项 ${v.id}: 阈值单位 ${t.target.unit} 与指标 ${rule.id} 量纲不一致`);
      }
    }
  }
  if (validators.length === 0) errors.push('未生成任何验证项（目标中无可验收指标）');

  return { spec, clarifications, ready: clarifications.length === 0 && errors.length === 0, errors };
}

function push<T>(m: Map<string, T[]>, k: string, v: T): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

function buildQuestion(command: string, rule: MetricRule | undefined): string {
  if (!rule) return `目标中识别到需要「${command}」验收的需求，但未给出可判定的阈值。请补充该指标的数值与单位（例如「不超过 200 MPa」），或明确授权使用保守默认值。`;
  return `目标中涉及「${rule.description}」，但未给出带比较方向的数值阈值。请补充形如「${rule.description}${rule.kind === 'count' ? '不超过 0 处' : `不超过 100 ${rule.conservative?.unit ?? ''}`}」的要求，或明确授权使用保守默认值（${rule.conservative?.value} ${rule.conservative?.unit}）。`;
}
