/**
 * @corsj/core — 资格矩阵。
 *
 * 决定每条命令在 AcceptanceSpec 中可被标 REQUIRED 还是 optional：
 * - 核心命令默认 REQUIRED（embedded_level ≤ L3 且不在 L4 依赖链中）。
 * - optional 仅由本矩阵或 AcceptanceSpec 显式授予；不得绑定 REQUIRED 验证器。
 * - L4 组件不得出现在任何 REQUIRED 验证器依赖链中。
 * - REQUIRED 核心命令的必需输入不得依赖 optional 产出。
 *
 * embedded_level 诚实标注（阶段一实际实现情况）：
 * - L0：纯 Node/TypeScript 脚本逻辑，无数值内核。
 * - L1：内置纯 TypeScript 数值/几何内核（无原生二进制依赖）。
 * - L2：需随包分发原生二进制内核（如 OCCT / CalculiX / KiCad CLI）——阶段一尚未接入。
 * - L3：需下载安装的第三方求解器资产（如 OpenFOAM / FDTD）——阶段一尚未接入。
 * - L4：研究级能力（如 PALACE-RF / 全波 FDTD 优化）——阶段一、阶段二均不实现。
 *
 * 阶段一诚实声明：20 条核心命令中，3 条为 L0，17 条为 L1。
 * 没有任何核心命令依赖 L2/L3 资产，因此阶段一可以在无外部工程软件的
 * 干净 Windows 上完整跑通七步闭环。
 */
import type { ValidatorStrength } from './schema.js';

export interface EligibilityRule {
  command: string;
  /** 默认强度：核心命令 REQUIRED，扩展命令 optional。 */
  default_strength: ValidatorStrength;
  /** 允许的强度集合。 */
  allowed_strengths: ValidatorStrength[];
  /** embedded_level。 */
  embedded_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  /** 是否核心命令。 */
  core: boolean;
  /** REQUIRED 资格的条件说明。 */
  required_condition: string;
  /** 禁止 REQUIRED 的原因（L4 或依赖链含 L4 时）。 */
  disallow_required_reason?: string;
}

/** 核心 19 条。阶段一全部由内置纯 TS 内核实现，故均为 L0/L1。 */
const CORE_COMMANDS: EligibilityRule[] = [
  { command: 'spec.parse_requirements', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED'], embedded_level: 'L0', core: true, required_condition: '纯脚本解析，始终可执行' },
  { command: 'geometry.generate', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 几何内核（L1）：基元建模、体积/面积/质心' },
  { command: 'geometry.format_convert', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 几何内核（L1）：STEP/STL 子集读写' },
  { command: 'geometry.validity_check', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 几何内核（L1）：结构有效性事实检查（不判定通过/失败）' },
  { command: 'fea.static', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 有限元内核（L1）：8 节点六面体线弹性静力求解' },
  { command: 'eda.schematic_erc', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 电气规则检查内核（L1）' },
  { command: 'eda.pcb_drc', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS PCB 设计规则检查内核（L1）' },
  { command: 'eda.manufacturing_export', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 制造输出清单生成（L1）' },
  { command: 'bom.generate', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS BOM 归组内核（L1）' },
  { command: 'energy.closure_sim', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 能量闭合仿真（L1）' },
  { command: 'motion.sim', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 质量-弹簧-阻尼 RK4 仿真（L1）' },
  { command: 'comm.link_budget', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED'], embedded_level: 'L0', core: true, required_condition: '纯脚本链路预算（Friis）' },
  { command: 'arrangement.mass_cg', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 质量属性/质心计算（L1）' },
  { command: 'arrangement.interference', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 干涉检查（L1）：盒-盒精确，圆柱保守' },
  { command: 'manufacturing.package', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 制造包组装（L1）' },
  { command: 'report.generate', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED'], embedded_level: 'L0', core: true, required_condition: '纯脚本报告生成' },
  { command: 'export.standard_format', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '基于包载荷的标准格式导出（L1）' },
  { command: 'fluid.resistance_solve', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 管路阻力求解（L1）：Darcy–Weisbach + Swamee–Jain' },
  { command: 'thermal.static_estimate', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 一维热阻网络求解（L1）' },
  { command: 'propeller.design', default_strength: 'REQUIRED', allowed_strengths: ['REQUIRED', 'optional'], embedded_level: 'L1', core: true, required_condition: '内置纯 TS 螺旋桨匹配内核（L1）：B-series 简化回归' },
];

/**
 * 59 条扩展命令 id（顺序与 v7 任务书附录 A「扩展命令 id 清单」一致）。
 *
 * 计数口径：v7 任务书附录 A 的计数块沿用了 v6 的“51 条 / 70 条”标签，
 * 但其清单正文实际枚举 59 条互不重复、且不与 19 条核心命令重叠的命令 id
 * （51 − 14 条船舶专用 + 22 条通用领域 = 59）。按 §6「附录 A 仅作核对基准」
 * 与附录 A「若 K ≠ 51，必须在阶段自检结果中说明差异原因」，此处完整继承
 * 59 条；差异原因见 docs/command-manifest.md。
 */
const EXTENSION_COMMANDS: string[] = [
  'spec.rule_check', 'geometry.parametric_surface', 'geometry.lines_fairing', 'assembly.constraint_check',
  'fluid.internal_flow', 'fluid.heat_transfer', 'thermal.electronics', 'thermal.system_balance',
  'fea.buckling', 'fea.modal', 'fea.fatigue', 'fea.thermal_stress',
  'composite.layup', 'connections.strength', 'collision.damage', 'mbd.dynamics', 'mbd.contact_impact',
  'topology.optimize', 'mdo.optimize', 'eda.signal_integrity', 'eda.power_integrity', 'eda.emc_emi',
  'harness.design', 'power_distribution.protection', 'spice.circuit_sim', 'battery.pack_design', 'battery.ecm_sim',
  'generation.hybrid', 'chemical.process', 'gnc.dynamics_model', 'gnc.guidance_law', 'gnc.control_law',
  'nav.sensor_fusion', 'perception.sensor_sim', 'fault_diagnosis', 'control.python_sim',
  'antenna.layout', 'antenna.simple_design', 'optics.raytrace', 'optics.differentiable',
  'em.fdtd', 'em.fem_low_freq', 'em.palace_rf', 'payload.integration', 'payload.data_budget',
  'arrangement.power_budget', 'arrangement.interface_check', 'maintainability.review', 'ergonomics.review',
  'docs.techdraw', 'assembly.process', 'test_plan.generate', 'version.manage', 'plm.bom_manage',
  'am.thermal_mechanical', 'am.support_generation', 'cam.path_generate', 'bim.ifc_process', 'sysml.architecture',
];

/** 已用内置纯 TS 内核实现的扩展命令（L1，无需外部求解器资产）。 */
export const L1_EXTENSION_COMMANDS: readonly string[] = [
  'fluid.internal_flow',
];

/** 需要下载安装第三方求解器资产的扩展命令（L3，共 6 条）。 */
export const L3_EXTENSION_COMMANDS: readonly string[] = [
  'fluid.heat_transfer', 'thermal.electronics',
  'mbd.contact_impact', 'em.fdtd', 'am.thermal_mechanical',
];

const EXT: EligibilityRule[] = EXTENSION_COMMANDS.map((c) => ({
  command: c,
  default_strength: 'optional',
  allowed_strengths: ['optional'],
  embedded_level: L1_EXTENSION_COMMANDS.includes(c) ? 'L1' : L3_EXTENSION_COMMANDS.includes(c) ? 'L3' : 'L4',
  core: false,
  required_condition: L1_EXTENSION_COMMANDS.includes(c) ? '已用内置纯 TS 内核实现（L1），但扩展命令仍不得 REQUIRED' : '不得 REQUIRED（扩展命令，底层未接入）',
  disallow_required_reason: '扩展命令不得作为门禁必要条件（L1 已实现者仅可 optional 验证）',
}));

/** 全矩阵：78 条（19 核心 + 59 扩展）。计数口径说明见 EXTENSION_COMMANDS。 */
export const ELIGIBILITY_MATRIX: readonly EligibilityRule[] = [...CORE_COMMANDS, ...EXT];

const byCommand = new Map(ELIGIBILITY_MATRIX.map((r) => [r.command, r]));

/** 查询命令资格。 */
export function eligibilityOf(command: string): EligibilityRule | undefined {
  return byCommand.get(command);
}

/** 该命令能否在 AcceptanceSpec 中标 REQUIRED。 */
export function canBeRequired(command: string): boolean {
  return byCommand.get(command)?.allowed_strengths.includes('REQUIRED') ?? false;
}

/**
 * 校验一个 spec 的强度授予是否合法（B 层生成 spec 后、冻结前调用）。
 * 额外约束：L4 命令绝不允许 REQUIRED（无论矩阵如何演化）。
 */
export function validateStrengthGrant(validators: { command: string; strength: 'REQUIRED' | 'optional' }[]): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const v of validators) {
    const rule = byCommand.get(v.command);
    if (!rule) { errors.push(`未知命令: ${v.command}`); continue; }
    if (v.strength === 'REQUIRED' && rule.embedded_level === 'L4') {
      errors.push(`命令 ${v.command} 为 L4，不得进入任何 REQUIRED 验证器依赖链`);
      continue;
    }
    if (!rule.allowed_strengths.includes(v.strength)) {
      errors.push(`命令 ${v.command} 不允许 ${v.strength}（${rule.disallow_required_reason ?? rule.required_condition}）`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** L4 命令清单（自查用：不得出现在 REQUIRED 依赖链）。 */
export function l4Commands(): string[] {
  return ELIGIBILITY_MATRIX.filter((r) => r.embedded_level === 'L4').map((r) => r.command);
}

/** 核心命令清单。 */
export function coreCommands(): string[] {
  return ELIGIBILITY_MATRIX.filter((r) => r.core).map((r) => r.command);
}

/** 扩展命令清单。 */
export function extensionCommands(): string[] {
  return ELIGIBILITY_MATRIX.filter((r) => !r.core).map((r) => r.command);
}
