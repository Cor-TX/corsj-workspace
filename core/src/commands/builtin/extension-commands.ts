/**
 * @corsj/core — 59 条扩展命令的适配器骨架。
 *
 * 阶段一：骨架命令返回 `not_implemented`（A 层语义：只回传状态与证据，不做判定）。
 * 迭代升级：fluid.internal_flow 已用内置纯 TS 内核（ITTC 1957）实现，
 *   通过可选 executor 字段接入；其余仍为骨架。命令 id、capability 字段、资格约束不变。
 *
 * 扩展命令默认 optional，且 allowed_strengths 仅 ['optional']：
 * - 不得绑定 REQUIRED 验证器；
 * - 不得成为门禁必要条件；
 * - 执行期间不得被提升为 REQUIRED；
 * - REQUIRED 核心命令不得依赖扩展命令的产出。
 *
 * 计数口径：v7 任务书附录 A 的计数块沿用 v6 的“51 条”标签，但清单正文实际
 * 枚举 59 条互不重复且与核心命令无重叠的 id（51 − 14 船舶专用 + 22 通用
 * 领域 = 59）。按 §6「附录 A 仅作核对基准，不是第二真源」及附录 A
 * 「若 K ≠ 51，必须在阶段自检结果中说明差异原因」，本文件完整继承 59 条。
 * 差异原因见 docs/command-manifest.md。
 */
import { registerCommand, getCapability } from '../registry.js';
import { notImplemented, ok, designError, envError, type CommandExecutor, type CommandContext, type CommandParams } from '../types.js';
import { solveHullResistance, type HullFlowInput } from './physics-kernels.js';
import { artPrefix } from '../core-commands-1.js';

interface ExtensionMeta {
  /** 命令 id（必须与资格矩阵一致）。 */
  id: string;
  /** 预期接入的 embedded_level（L1=纯 TS 已实现；L3 者需要外部求解器资产）。 */
  level: 'L1' | 'L3' | 'L4';
  /** 可选真实执行器（已实现的扩展命令使用；缺省为 not_implemented 骨架）。 */
  executor?: CommandExecutor;
  /** 依赖的底层工具（阶段二接入目标）。 */
  tool: string;
  /** 消耗物描述。 */
  consumes: string[];
  /** 产出物描述。 */
  produces: string[];
}

/**
 * 59 条扩展命令元数据。顺序与 v7 任务书附录 A 明列清单一致。
 * L3（需要可下载的第三方求解器资产）：6 条；其余 L4（阶段一/二均不实现）。
 */
export const EXTENSION_COMMAND_META: readonly ExtensionMeta[] = [
  { id: 'spec.rule_check', level: 'L4', tool: 'rule-engine', consumes: ['requirements', 'rule set'], produces: ['rule check findings'] },
  { id: 'geometry.parametric_surface', level: 'L4', tool: 'opencascade-surface', consumes: ['surface parameters'], produces: ['NURBS surface'] },
  { id: 'geometry.lines_fairing', level: 'L4', tool: 'opencascade-fairing', consumes: ['wireframe curves'], produces: ['faired curves'] },
  { id: 'assembly.constraint_check', level: 'L4', tool: 'assembly-solver', consumes: ['assembly'], produces: ['constraint findings'] },
  { id: 'fluid.internal_flow', level: 'L1', tool: 'ittc-1957-analytic', consumes: ['hull geometry (length, wetted area)', 'speed', 'water properties'], produces: ['hull resistance solution', 'required propulsion power'],
  executor: async (params: CommandParams, ctx: CommandContext) => {
    try {
      const hull = params['hull'] as Partial<HullFlowInput> | undefined;
      if (!hull) return designError('hull 非法：需要 {length_m, speed_m_s}');
      const need: (keyof HullFlowInput)[] = ['length_m', 'speed_m_s'];
      for (const k of need) {
        if (!Number.isFinite(hull[k] as number)) return designError(`hull.${k} 非法（需数值）`);
      }
      const res = solveHullResistance(hull as HullFlowInput);
      const prefix = artPrefix(ctx.run, 'fluid.internal_flow');
      const result = {
        hull,
        reynolds: { value: res.reynolds, unit: '1' },
        friction_coefficient: { value: res.friction_coefficient, unit: '1' },
        residual_coefficient: { value: res.residual_coefficient, unit: '1' },
        wave_coefficient: { value: res.wave_coefficient, unit: '1' },
        wetted_area: { value: res.wetted_area_m2, unit: 'm2' },
        friction_resistance: { value: res.friction_resistance_N, unit: 'N' },
        residual_resistance: { value: res.residual_resistance_N, unit: 'N' },
        wave_resistance: { value: res.wave_resistance_N, unit: 'N' },
        total_resistance: { value: res.total_resistance_N, unit: 'N' },
        total_resistance_kN: { value: res.total_resistance_N / 1000, unit: 'kN' },
        effective_power: { value: res.effective_power_W, unit: 'W' },
        required_power: { value: res.required_power_W, unit: 'W' },
        required_power_kW: { value: res.required_power_W / 1000, unit: 'kW' },
        froude_number: { value: res.froude_number, unit: '1' },
        formula: res.formula,
      };
      const msg = '船体水动力阻力求解完成：Re=' + res.reynolds.toExponential(3) + '，R_t=' + (res.total_resistance_N / 1000).toFixed(4) + ' kN，需功率 ' + (res.required_power_W / 1000).toFixed(4) + ' kW';
      return ok(msg, {
        reynolds: res.reynolds,
        friction_coefficient: res.friction_coefficient,
        total_resistance_N: res.total_resistance_N,
        total_resistance_kN: res.total_resistance_N / 1000,
        effective_power_W: res.effective_power_W,
        required_power_W: res.required_power_W,
        required_power_kW: res.required_power_W / 1000,
        froude_number: res.froude_number,
        wetted_area_m2: res.wetted_area_m2,
        result_file: prefix + '/hull-flow-result.json',
      }, [{ path: prefix + '/hull-flow-result.json', data: new TextEncoder().encode(JSON.stringify(result, null, 2)), media_type: 'application/json', role: 'hull-flow-result' }]);
    } catch (e) {
      const err = (e as Error).message;
      if (err.startsWith('HULL_')) return designError(err);
      return envError('船体水动力求解环境异常: ' + err);
    }
  },  },
  { id: 'fluid.heat_transfer', level: 'L3', tool: 'openfoam', consumes: ['flow domain', 'thermal boundary'], produces: ['heat transfer solution'] },
  { id: 'thermal.electronics', level: 'L3', tool: 'thermal-electronics-solver', consumes: ['electronic assembly', 'power map'], produces: ['electronic thermal solution'] },
  { id: 'thermal.system_balance', level: 'L4', tool: 'system-balance-solver', consumes: ['system thermal model'], produces: ['system balance solution'] },
  { id: 'fea.buckling', level: 'L4', tool: 'eigenvalue-solver', consumes: ['structure', 'boundary conditions'], produces: ['buckling modes'] },
  { id: 'fea.modal', level: 'L4', tool: 'eigenvalue-solver', consumes: ['structure', 'boundary conditions'], produces: ['modal frequencies'] },
  { id: 'fea.fatigue', level: 'L4', tool: 'fatigue-solver', consumes: ['stress tensor history', 'material S-N'], produces: ['fatigue life'] },
  { id: 'fea.thermal_stress', level: 'L4', tool: 'coupled-thermo-mechanical', consumes: ['temperature field', 'structure'], produces: ['thermal stress result'] },
  { id: 'composite.layup', level: 'L4', tool: 'composite-solver', consumes: ['layup definition'], produces: ['composite properties'] },
  { id: 'connections.strength', level: 'L4', tool: 'connection-solver', consumes: ['joint definition', 'loads'], produces: ['joint strength result'] },
  { id: 'collision.damage', level: 'L4', tool: 'damage-model', consumes: ['impact scenario'], produces: ['damage result'] },
  { id: 'mbd.dynamics', level: 'L4', tool: 'multibody-solver', consumes: ['rigid body system'], produces: ['multibody trajectory'] },
  { id: 'mbd.contact_impact', level: 'L3', tool: 'contact-solver', consumes: ['contact pair', 'impact velocity'], produces: ['contact impact result'] },
  { id: 'topology.optimize', level: 'L4', tool: 'topology-optimizer', consumes: ['design domain', 'loads', 'constraints'], produces: ['optimized field'] },
  { id: 'mdo.optimize', level: 'L4', tool: 'mdo-optimizer', consumes: ['multi-disciplinary model'], produces: ['Pareto front'] },
  { id: 'eda.signal_integrity', level: 'L4', tool: 'si-solver', consumes: ['pcb', 'net constraints'], produces: ['SI report'] },
  { id: 'eda.power_integrity', level: 'L4', tool: 'pi-solver', consumes: ['pcb', 'power net'], produces: ['PI report'] },
  { id: 'eda.emc_emi', level: 'L4', tool: 'emc-solver', consumes: ['pcb', 'emission limits'], produces: ['EMC/EMI report'] },
  { id: 'harness.design', level: 'L4', tool: 'harness-router', consumes: ['connectivity requirements'], produces: ['harness layout'] },
  { id: 'power_distribution.protection', level: 'L4', tool: 'protection-solver', consumes: ['load tree'], produces: ['protection coordination'] },
  { id: 'spice.circuit_sim', level: 'L4', tool: 'ngspice', consumes: ['netlist'], produces: ['circuit waveforms'] },
  { id: 'battery.pack_design', level: 'L4', tool: 'pack-designer', consumes: ['cell data', 'pack constraints'], produces: ['pack design'] },
  { id: 'battery.ecm_sim', level: 'L4', tool: 'ecm-solver', consumes: ['ECM parameters', 'drive cycle'], produces: ['ECM response'] },
  { id: 'generation.hybrid', level: 'L4', tool: 'power-system-solver', consumes: ['generation mix', 'load profile'], produces: ['hybrid generation plan'] },
  { id: 'chemical.process', level: 'L4', tool: 'process-simulator', consumes: ['process flowsheet'], produces: ['process results'] },
  { id: 'gnc.dynamics_model', level: 'L4', tool: 'gnc-model', consumes: ['vehicle parameters'], produces: ['dynamics model'] },
  { id: 'gnc.guidance_law', level: 'L4', tool: 'guidance-law', consumes: ['state vector', 'waypoints'], produces: ['guidance commands'] },
  { id: 'gnc.control_law', level: 'L4', tool: 'control-law', consumes: ['state vector', 'guidance commands'], produces: ['control commands'] },
  { id: 'nav.sensor_fusion', level: 'L4', tool: 'fusion-filter', consumes: ['sensor streams'], produces: ['fused state estimate'] },
  { id: 'perception.sensor_sim', level: 'L4', tool: 'sensor-simulator', consumes: ['scene', 'sensor model'], produces: ['sensor observations'] },
  { id: 'fault_diagnosis', level: 'L4', tool: 'fault-diagnosis', consumes: ['telemetry', 'fault model'], produces: ['diagnosis result'] },
  { id: 'control.python_sim', level: 'L4', tool: 'python-control', consumes: ['control model'], produces: ['control simulation'] },
  { id: 'antenna.layout', level: 'L4', tool: 'antenna-optimizer', consumes: ['constraints', 'frequency'], produces: ['antenna layout'] },
  { id: 'antenna.simple_design', level: 'L4', tool: 'antenna-analytic', consumes: ['frequency', 'constraints'], produces: ['antenna parameters'] },
  { id: 'optics.raytrace', level: 'L4', tool: 'raytracer', consumes: ['optical scene'], produces: ['ray trace result'] },
  { id: 'optics.differentiable', level: 'L4', tool: 'differentiable-optics', consumes: ['optical scene', 'gradients'], produces: ['optimized optical design'] },
  { id: 'em.fdtd', level: 'L3', tool: 'fdtd-solver', consumes: ['EM domain', 'excitation'], produces: ['EM field result'] },
  { id: 'em.fem_low_freq', level: 'L4', tool: 'em-fem-solver', consumes: ['EM domain'], produces: ['EM field result'] },
  { id: 'em.palace_rf', level: 'L4', tool: 'palace-rf', consumes: ['cavity model', 'RF ports'], produces: ['RF mode result'] },
  { id: 'payload.integration', level: 'L4', tool: 'payload-integration', consumes: ['payload requirements', 'bus definition'], produces: ['integration report'] },
  { id: 'payload.data_budget', level: 'L4', tool: 'data-budget', consumes: ['data products', 'link budget'], produces: ['data budget report'] },
  { id: 'arrangement.power_budget', level: 'L4', tool: 'power-budget', consumes: ['load list'], produces: ['power budget report'] },
  { id: 'arrangement.interface_check', level: 'L4', tool: 'interface-checker', consumes: ['interface definitions'], produces: ['interface report'] },
  { id: 'maintainability.review', level: 'L4', tool: 'maintainability-review', consumes: ['design description'], produces: ['review findings'] },
  { id: 'ergonomics.review', level: 'L4', tool: 'ergonomics-review', consumes: ['design description', 'human factors'], produces: ['review findings'] },
  { id: 'docs.techdraw', level: 'L4', tool: 'techdraw', consumes: ['model'], produces: ['technical drawing'] },
  { id: 'assembly.process', level: 'L4', tool: 'process-planner', consumes: ['assembly structure'], produces: ['assembly process plan'] },
  { id: 'test_plan.generate', level: 'L4', tool: 'test-planner', consumes: ['acceptance spec'], produces: ['test plan'] },
  { id: 'version.manage', level: 'L4', tool: 'version-manager', consumes: ['version history'], produces: ['version report'] },
  { id: 'plm.bom_manage', level: 'L4', tool: 'plm-bom', consumes: ['product structure'], produces: ['managed BOM'] },
  { id: 'am.thermal_mechanical', level: 'L3', tool: 'am-simulator', consumes: ['build parameters'], produces: ['AM thermal-mechanical result'] },
  { id: 'am.support_generation', level: 'L4', tool: 'support-generator', consumes: ['part geometry', 'process constraints'], produces: ['support structure'] },
  { id: 'cam.path_generate', level: 'L4', tool: 'cam-solver', consumes: ['part geometry', 'machine definition'], produces: ['toolpath'] },
  { id: 'bim.ifc_process', level: 'L4', tool: 'ifc-processor', consumes: ['IFC model'], produces: ['processed BIM model'] },
  { id: 'sysml.architecture', level: 'L4', tool: 'sysml-engine', consumes: ['system requirements'], produces: ['architecture model'] },
];

/** 注册全部 51 条扩展命令骨架（幂等：已注册的跳过）。 */
export function registerExtensionCommands(): void {
  for (const m of EXTENSION_COMMAND_META) {
    if (getCapability(m.id)) continue;
    registerCommand(m.id, {
      consumes: m.consumes,
      produces: m.produces,
      embedded_level: m.level,
      core: false,
      description: `扩展命令 ${m.id}（阶段一骨架；目标底层 ${m.tool}，阶段二接入）`,
      tool_surface: ['core-api', 'mcp', 'http'],
      executor: m.executor ?? (async () => notImplemented(m.id)),
    });
  }
}

/** 扩展命令 id 清单（自检/文档用）。 */
export function extensionCommandIds(): string[] {
  return EXTENSION_COMMAND_META.map((m) => m.id);
}
