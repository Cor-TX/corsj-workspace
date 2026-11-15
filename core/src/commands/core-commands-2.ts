/**
 * @corsj/core — 核心命令实现（第二批：eda / energy / motion / comm / arrangement）。
 *
 * A 层纪律：只执行、产出证据；不做验收判定。
 */
import { registerCommand } from './registry.js';
import { ok, designError, envError, type CommandContext, type CommandParams } from './types.js';
import { artPrefix } from './core-commands-1.js';
import {
  runErc, runPcbDrc, extractBom, manufacturingOutputs,
  type Netlist, type PcbDesign,
} from './builtin/eda-kernel.js';
import {
  simulateEnergyClosure, solvePipeResistance, solveThermalStatic,
  simulateMotion, computeLinkBudget,
  type EnergyModel, type PipeSpec, type ThermalNetwork, type MotionParams, type LinkBudgetParams,
} from './builtin/physics-kernels.js';
import { bboxOf, volumeOf, centroidOf, type Primitive } from './builtin/geometry-kernel.js';

const MT = {
  json: 'application/json', csv: 'text/csv', md: 'text/markdown', text: 'text/plain',
  kicadSch: 'application/x-kicad-schematic', kicadPcb: 'application/x-kicad-pcb',
  gbr: 'application/x-gerber', drl: 'application/x-excellon', step: 'application/step',
};
const enc = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// eda.schematic_erc
// ---------------------------------------------------------------------------

registerCommand('eda.schematic_erc', {
  consumes: ['netlist JSON'],
  produces: ['ERC report JSON', 'Schematic object'],
  embedded_level: 'L1',
  core: true,
  description: '原理图电气规则检查（ERC）：悬空输入/多驱动/电源短路/未连接引脚',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const netlist = params['netlist'] as Netlist | undefined;
    if (!netlist || !Array.isArray(netlist.components) || !Array.isArray(netlist.nets)) {
      return designError('netlist 非法：需要 {components:[...], nets:[...]}');
    }
    const { findings, exit_code } = runErc(netlist);
    const prefix = artPrefix(ctx.run, 'eda.schematic_erc');
    const report = {
      tool: 'corsj-L1-erc',
      exit_code,
      total: findings.length,
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
      findings,
      consistency: exit_code === (findings.length > 0 ? 1 : 0) ? 'consistent' : 'inconsistent',
    };
    ctx.pkg.addObject(
      {
        id: `Schematic-${String(ctx.run).padStart(4, '0')}`,
        object_type: 'Schematic',
        title: `原理图 ERC（${findings.length} 项发现）`,
        produced_by: `run-${ctx.run}`,
        relations: [],
        payloads: [],
        attributes: { exit_code, findings_count: findings.length, errors: report.errors, warnings: report.warnings },
      },
      [{ path: `${prefix}/${report.exit_code === 0 ? 'erc' : 'erc'}-report.json`, data: enc(JSON.stringify(report, null, 2)), media_type: MT.json, role: 'erc-report' }],
    );
    return ok(`ERC 完成：${report.errors} 错误 / ${report.warnings} 警告，退出码 ${exit_code}`, {
      exit_code,
      findings_count: findings.length,
      errors: report.errors,
      warnings: report.warnings,
      report_file: `${prefix}/erc-report.json`,
      consistency: report.consistency,
    }, [
      { path: `${prefix}/erc-report.json`, data: enc(JSON.stringify(report, null, 2)), media_type: MT.json, role: 'erc-report' },
    ]);
  },
});

// ---------------------------------------------------------------------------
// eda.pcb_drc
// ---------------------------------------------------------------------------

registerCommand('eda.pcb_drc', {
  consumes: ['pcb design JSON'],
  produces: ['DRC report JSON', 'PCB object'],
  embedded_level: 'L1',
  core: true,
  description: 'PCB 设计规则检查（DRC）：重叠/线宽/间距/未布线',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const design = params['pcb'] as PcbDesign | undefined;
    if (!design || !Array.isArray(design.placements) || !design.rules) return designError('pcb 非法：需要 {placements:[...], rules:{...}}');
    const { findings, exit_code } = runPcbDrc(design);
    const prefix = artPrefix(ctx.run, 'eda.pcb_drc');
    const report = { tool: 'corsj-L1-drc', exit_code, total: findings.length, findings };
    ctx.pkg.addObject(
      {
        id: `PCB-${String(ctx.run).padStart(4, '0')}`,
        object_type: 'PCB',
        title: `PCB DRC（${findings.length} 项发现）`,
        produced_by: `run-${ctx.run}`,
        relations: [],
        payloads: [],
        attributes: { exit_code, findings_count: findings.length },
      },
      [{ path: `${prefix}/drc-report.json`, data: enc(JSON.stringify(report, null, 2)), media_type: MT.json, role: 'drc-report' }],
    );
    return ok(`DRC 完成：${findings.length} 项发现，退出码 ${exit_code}`, {
      exit_code, findings_count: findings.length, report_file: `${prefix}/drc-report.json`,
    }, [
      { path: `${prefix}/drc-report.json`, data: enc(JSON.stringify(report, null, 2)), media_type: MT.json, role: 'drc-report' },
    ]);
  },
});

// ---------------------------------------------------------------------------
// eda.manufacturing_export
// ---------------------------------------------------------------------------

registerCommand('eda.manufacturing_export', {
  consumes: ['pcb design JSON'],
  produces: ['Gerber/Drill/PnP artifacts', 'Manufacturing object'],
  embedded_level: 'L1',
  core: true,
  description: '导出制造文件（Gerber/Excellon 钻孔/贴片坐标）',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const design = params['pcb'] as PcbDesign | undefined;
    if (!design || !Array.isArray(design.placements)) return designError('pcb 非法');
    const outputs = manufacturingOutputs(design);
    const prefix = artPrefix(ctx.run, 'eda.manufacturing_export');
    const artifacts = outputs.map((o) => ({
      path: `${prefix}/${o.filename}`,
      data: enc(o.content),
      media_type: o.role.endsWith('drill') ? MT.drl : o.role.endsWith('pnp') ? MT.csv : MT.gbr,
      role: o.role,
    }));
    ctx.pkg.addObject(
      {
        id: `Manufacturing-${String(ctx.run).padStart(4, '0')}`,
        object_type: 'Manufacturing',
        title: 'EDA 制造文件集',
        produced_by: `run-${ctx.run}`,
        relations: [],
        payloads: [],
        attributes: { files: outputs.map((o) => o.filename) },
      },
      artifacts.map((a) => ({ path: a.path, data: a.data, media_type: a.media_type, role: a.role })),
    );
    return ok(`已导出 ${outputs.length} 个制造文件`, { files: outputs.map((o) => ({ filename: o.filename, role: o.role, path: `${prefix}/${o.filename}` })) }, artifacts);
  },
});

// ---------------------------------------------------------------------------
// bom.generate
// ---------------------------------------------------------------------------

registerCommand('bom.generate', {
  consumes: ['netlist JSON'],
  produces: ['BOM CSV', 'Table object'],
  embedded_level: 'L1',
  core: true,
  description: '从网表生成物料清单（BOM）',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const netlist = params['netlist'] as Netlist | undefined;
    if (!netlist || !Array.isArray(netlist.components)) return designError('netlist 非法');
    const lines = extractBom(netlist);
    const csv = ['value,footprint,qty,refdes'].concat(
      lines.map((l) => `${csvEscape(l.value)},${csvEscape(l.footprint)},${l.qty},"${l.refdes.join(' ')}"`),
    ).join('\n') + '\n';
    const prefix = artPrefix(ctx.run, 'bom.generate');
    ctx.pkg.addObject(
      {
        id: `BOM-${String(ctx.run).padStart(4, '0')}`,
        object_type: 'Table',
        title: `BOM（${lines.length} 行）`,
        produced_by: `run-${ctx.run}`,
        relations: [],
        payloads: [],
        attributes: { rows: lines.length, total_qty: lines.reduce((s, l) => s + l.qty, 0) },
      },
      [{ path: `${prefix}/bom.csv`, data: enc(csv), media_type: MT.csv, role: 'bom' }],
    );
    return ok(`BOM 生成完成：${lines.length} 行，共 ${lines.reduce((s, l) => s + l.qty, 0)} 件`, {
      rows: lines.length,
      total_qty: lines.reduce((s, l) => s + l.qty, 0),
      lines,
      bom_file: `${prefix}/bom.csv`,
    }, [{ path: `${prefix}/bom.csv`, data: enc(csv), media_type: MT.csv, role: 'bom' }]);
  },
});

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

// ---------------------------------------------------------------------------
// energy.closure_sim
// ---------------------------------------------------------------------------

registerCommand('energy.closure_sim', {
  consumes: ['energy model (components, storage, duration)'],
  produces: ['power/energy time series CSV', 'TimeSeries object'],
  embedded_level: 'L1',
  core: true,
  description: '能量闭合仿真：负载功率时间序列 + 累计能耗 + 能量平衡误差',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const m = params['model'] as Partial<EnergyModel> | undefined;
    if (!m || !Array.isArray(m.components) || m.components.length === 0) {
      return designError('model 非法：需要 components[{name,p_rated,duty}]');
    }
    for (const c of m.components) {
      if (!Number.isFinite(c.p_rated) || c.p_rated < 0) return designError('component.p_rated 非法');
      if (!Number.isFinite(c.duty) || c.duty < 0 || c.duty > 1) return designError('component.duty 必须为 0–1');
    }
    if (!Number.isFinite(m.duration) || (m.duration as number) <= 0) return designError('model.duration 非法');
    if (!Number.isFinite(m.dt) || (m.dt as number) <= 0 || (m.dt as number) > (m.duration as number)) {
      return designError('model.dt 非法');
    }
    if (m.storage_capacity !== undefined && (!Number.isFinite(m.storage_capacity) || m.storage_capacity < 0)) {
      return designError('model.storage_capacity 非法');
    }
    const res = simulateEnergyClosure(m as EnergyModel);
    const prefix = artPrefix(ctx.run, 'energy.closure_sim');
    const csv = ['time_s,load_power_W,charge_power_W,cumulative_energy_J']
      .concat(res.series.independent.values.map((t, i) => {
        const d = res.series.dependent;
        return `${t},${d[0]!.values[i]},${d[1]!.values[i]},${d[2]!.values[i]}`;
      })).join('\n') + '\n';
    const resultJson = {
      model: m,
      cumulative_energy: { value: res.cumulative_energy_J, unit: 'J' },
      cumulative_energy_kWh: { value: res.cumulative_energy_J / 3.6e6, unit: 'kWh' },
      final_storage: res.final_storage_J !== undefined ? { value: res.final_storage_J, unit: 'J' } : undefined,
      energy_balance_error: res.energy_balance_error,
      series: res.series,
    };
    ctx.pkg.addObject(
      {
        id: `TimeSeries-${String(ctx.run).padStart(4, '0')}`,
        object_type: 'TimeSeries',
        title: '能量闭合时间序列',
        produced_by: `run-${ctx.run}`,
        relations: [],
        payloads: [],
        attributes: {
          cumulative_energy_J: res.cumulative_energy_J,
          energy_balance_error: res.energy_balance_error,
          units: ['s', 'W', 'J'],
        },
      },
      [],
    );
    return ok(`能量闭合完成：累计 ${(res.cumulative_energy_J / 3.6e6).toFixed(4)} kWh，平衡误差 ${res.energy_balance_error.toExponential(2)}`, {
      cumulative_energy: { value: res.cumulative_energy_J, unit: 'J' },
      cumulative_energy_kWh: { value: res.cumulative_energy_J / 3.6e6, unit: 'kWh' },
      energy_balance_error: res.energy_balance_error,
      points: res.series.independent.values.length,
      series_file: `${prefix}/energy-series.csv`,
      result_file: `${prefix}/energy-result.json`,
    }, [
      { path: `${prefix}/energy-series.csv`, data: enc(csv), media_type: MT.csv, role: 'energy-series' },
      { path: `${prefix}/energy-result.json`, data: enc(JSON.stringify(resultJson, null, 2)), media_type: MT.json, role: 'energy-result' },
    ]);
  },
});

// ---------------------------------------------------------------------------
// motion.sim
// ---------------------------------------------------------------------------

registerCommand('motion.sim', {
  consumes: ['motion params (mass, stiffness, damping)'],
  produces: ['displacement/velocity time series CSV'],
  embedded_level: 'L1',
  core: true,
  description: '单自由度质量-弹簧-阻尼动力学仿真（RK4）',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const p = params['params'] as Partial<MotionParams> | undefined;
    if (!p || !Number.isFinite(p.mass) || (p.mass as number) <= 0) return designError('params.mass 非法');
    if (!Number.isFinite(p.stiffness) || (p.stiffness as number) <= 0) return designError('params.stiffness 非法');
    if (p.damping === undefined || !Number.isFinite(p.damping) || (p.damping as number) < 0) return designError('params.damping 非法');
    if (!Number.isFinite(p.duration) || (p.duration as number) <= 0) return designError('params.duration 非法');
    if (!Number.isFinite(p.dt) || (p.dt as number) <= 0) return designError('params.dt 非法');
    const res = simulateMotion(p as MotionParams);
    const prefix = artPrefix(ctx.run, 'motion.sim');
    const csv = ['time_s,displacement_m,velocity_m']
      .concat(res.series.independent.values.map((t, i) => `${t},${res.series.dependent[0]!.values[i]},${res.series.dependent[1]!.values[i]}`)).join('\n') + '\n';
    return ok(`运动仿真完成：f_n=${res.natural_freq_Hz.toFixed(3)} Hz，ζ=${res.damping_ratio.toFixed(4)}`, {
      natural_freq_Hz: res.natural_freq_Hz,
      damping_ratio: res.damping_ratio,
      settled: res.settled,
      points: res.series.independent.values.length,
      max_displacement_m: Math.max(...res.series.dependent[0]!.values.map(Math.abs)),
      series_file: `${prefix}/motion-series.csv`,
    }, [{ path: `${prefix}/motion-series.csv`, data: enc(csv), media_type: MT.csv, role: 'motion-series' }]);
  },
});

// ---------------------------------------------------------------------------
// comm.link_budget
// ---------------------------------------------------------------------------

registerCommand('comm.link_budget', {
  consumes: ['link params (power, gains, distance, frequency)'],
  produces: ['link budget table (dB)'],
  embedded_level: 'L0',
  core: true,
  description: '无线链路预算（Friis）：EIRP/FSPL/接收功率/链路余量',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const p = params['params'] as Partial<LinkBudgetParams> | undefined;
    if (!p || !Number.isFinite(p.tx_power_W) || (p.tx_power_W as number) <= 0) return designError('params.tx_power_W 非法');
    if (!Number.isFinite(p.distance_m) || (p.distance_m as number) <= 0) return designError('params.distance_m 非法');
    if (!Number.isFinite(p.frequency_Hz) || (p.frequency_Hz as number) <= 0) return designError('params.frequency_Hz 非法');
    if (!Number.isFinite(p.tx_gain_dBi) || !Number.isFinite(p.rx_gain_dBi)) return designError('天线增益非法');
    if (!Number.isFinite(p.rx_sensitivity_dBm)) return designError('params.rx_sensitivity_dBm 非法');
    const res = computeLinkBudget(p as LinkBudgetParams);
    const prefix = artPrefix(ctx.run, 'comm.link_budget');
    const md = ['# Link Budget', '', '| 项 | 值 (dB) | 说明 |', '| --- | --- | --- |']
      .concat(res.lines.map((l) => `| ${l.label} | ${l.value_dB === null ? '-' : l.value_dB.toFixed(2)} | ${l.note} |`)).join('\n');
    return ok(`链路预算完成：接收 ${res.rx_power_dBm.toFixed(2)} dBm，余量 ${res.link_margin_dB.toFixed(2)} dB`, {
      eirp_dBW: res.eirp_dBW,
      path_loss_dB: res.path_loss_dB,
      rx_power_dBm: res.rx_power_dBm,
      link_margin_dB: res.link_margin_dB,
      closed: res.closed,
      lines: res.lines,
      report_file: `${prefix}/link-budget.md`,
    }, [{ path: `${prefix}/link-budget.md`, data: enc(md + '\n'), media_type: MT.md, role: 'link-budget' }]);
  },
});

// ---------------------------------------------------------------------------
// arrangement.mass_cg
// ---------------------------------------------------------------------------

registerCommand('arrangement.mass_cg', {
  consumes: ['parts[{id, primitive, density, mass, offset_mm?}]'],
  produces: ['mass/CG table'],
  embedded_level: 'L1',
  core: true,
  description: '布置质量与质心汇总（体积×密度求和，支持 offset_mm 布置偏移）',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const parts = params['parts'] as { id: string; primitive: Primitive; density: number; mass?: number; offset_mm?: number[] }[] | undefined;
    if (!Array.isArray(parts) || parts.length === 0) return designError('parts 非法：需要 [{id, primitive, density}]');
    let totalMass = 0;
    const mom = [0, 0, 0];
    const rows: Record<string, unknown>[] = [];
    for (const p of parts) {
      if (!p.id || !p.primitive) return designError('part 缺 id 或 primitive');
      const vol = volumeOf(p.primitive);
      const mass = p.mass ?? vol * p.density;
      if (!Number.isFinite(mass) || mass <= 0) return designError(`part ${p.id} 质量非法`);
      const c = centroidOf(p.primitive);
      const off = Array.isArray(p.offset_mm) && p.offset_mm.length === 3 && p.offset_mm.every((v) => Number.isFinite(v)) ? (p.offset_mm as number[]) : [0, 0, 0];
      const cWorld = [c[0] + off[0], c[1] + off[1], c[2] + off[2]];
      totalMass += mass;
      mom[0] += mass * cWorld[0]; mom[1] += mass * cWorld[1]; mom[2] += mass * cWorld[2];
      rows.push({ id: p.id, mass_kg: mass, centroid_mm: cWorld, centroid_local_mm: c, offset_mm: off, volume_mm3: vol });
    }
    const cg = [mom[0] / totalMass, mom[1] / totalMass, mom[2] / totalMass];
    const prefix = artPrefix(ctx.run, 'arrangement.mass_cg');
    return ok(`质量汇总：${totalMass.toFixed(4)} kg，质心 (${cg.map((v) => v.toFixed(3)).join(', ')}) mm`, {
      total_mass: { value: totalMass, unit: 'kg' },
      center_of_gravity: { value: cg, unit: 'mm' },
      parts: rows,
      report_file: `${prefix}/mass-cg.json`,
    }, [{ path: `${prefix}/mass-cg.json`, data: enc(JSON.stringify({ total_mass_kg: totalMass, center_of_gravity_mm: cg, parts: rows }, null, 2)), media_type: MT.json, role: 'mass-cg' }]);
  },
});

// ---------------------------------------------------------------------------
// arrangement.interference
// ---------------------------------------------------------------------------

registerCommand('arrangement.interference', {
  consumes: ['parts[{id, primitive, offset_mm}]'],
  produces: ['interference report JSON'],
  embedded_level: 'L1',
  core: true,
  description: '布置干涉检查（AABB 相交 + 交叠体积）',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const parts = params['parts'] as { id: string; primitive: Primitive; offset_mm?: number[] }[] | undefined;
    if (!Array.isArray(parts) || parts.length < 2) return designError('parts 非法：至少 2 个零件');
    const conflicts: Record<string, unknown>[] = [];
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i]!, b = parts[j]!;
        const ba = bboxOf(a.primitive), bb = bboxOf(b.primitive);
        const off = (b.offset_mm ?? [0, 0, 0]) as number[];
        const overlap = [0, 1, 2].every((k) => ba.max[k] > bb.min[k] + off[k]! && ba.min[k] < bb.max[k] + off[k]!);
        if (overlap) {
          const d = [0, 1, 2].map((k) => Math.min(ba.max[k], bb.max[k] + off[k]!) - Math.max(ba.min[k], bb.min[k] + off[k]!));
          conflicts.push({
            a: a.id, b: b.id,
            overlap_bbox_mm: { min: [0, 1, 2].map((k) => Math.max(ba.min[k], bb.min[k] + off[k]!)), max: [0, 1, 2].map((k) => Math.min(ba.max[k], bb.max[k] + off[k]!)) },
            overlap_extent_mm: d,
            severity: d.every((v) => v > 0.5) ? 'error' : 'warning',
          });
        }
      }
    }
    const prefix = artPrefix(ctx.run, 'arrangement.interference');
    const report = { tool: 'corsj-L1-aabb-interference', conflicts, conflict_count: conflicts.length };
    return ok(`干涉检查完成：${conflicts.length} 处干涉`, {
      conflict_count: conflicts.length,
      conflicts,
      report_file: `${prefix}/interference-report.json`,
    }, [{ path: `${prefix}/interference-report.json`, data: enc(JSON.stringify(report, null, 2)), media_type: MT.json, role: 'interference-report' }]);
  },
});
