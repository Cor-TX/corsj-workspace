/**
 * @corsj/core — 核心命令实现（第三批：manufacturing / report / export / fluid / thermal）。
 */
import { registerCommand } from './registry.js';
import { ok, designError, envError, type CommandContext, type CommandParams } from './types.js';
import { artPrefix, resolvePartRef } from './core-commands-1.js';
import { createHash } from 'node:crypto';
import { solvePipeResistance, solveThermalStatic, designPropeller, type PipeSpec, type ThermalNetwork, type PropellerInput } from './builtin/physics-kernels.js';
import { findUnit } from '../model/units.js';

const MT = { json: 'application/json', csv: 'text/csv', md: 'text/markdown', text: 'text/plain', zip: 'application/zip' };
const enc = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// fluid.resistance_solve
// ---------------------------------------------------------------------------

registerCommand('fluid.resistance_solve', {
  consumes: ['pipe spec (length, diameter, roughness, density, viscosity, flow)'],
  produces: ['fluid result JSON', 'pressure-drop table'],
  embedded_level: 'L1',
  core: true,
  description: '管流阻力求解（Darcy-Weisbach，含层流/湍流判定与 Colebrook 近似）',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const s = params['pipe'] as Partial<PipeSpec> | undefined;
    if (!s) return designError('pipe 非法');
    const need: (keyof PipeSpec)[] = ['length', 'diameter', 'roughness', 'fluid_density', 'fluid_viscosity', 'flow_rate'];
    for (const k of need) {
      if (!Number.isFinite(s[k] as number)) return designError(`pipe.${k} 非法（需数值）`);
    }
    if ((s.length as number) <= 0 || (s.diameter as number) <= 0) return designError('pipe.length/diameter 必须为正');
    if ((s.flow_rate as number) <= 0) return designError('pipe.flow_rate 必须为正');
    if ((s.fluid_viscosity as number) <= 0 || (s.fluid_density as number) <= 0) return designError('流体物性非法');
    const res = solvePipeResistance(s as PipeSpec);
    const prefix = artPrefix(ctx.run, 'fluid.resistance_solve');
    const result = {
      pipe: s,
      velocity: { value: res.velocity, unit: 'm/s' },
      reynolds: { value: res.reynolds, unit: '1' },
      friction_factor: { value: res.friction_factor, unit: '1' },
      pressure_drop: { value: res.pressure_drop, unit: 'Pa' },
      pressure_drop_kPa: { value: res.pressure_drop / 1000, unit: 'kPa' },
      regime: res.regime,
      formula: res.regime === 'laminar' ? 'f=64/Re' : 'Swamee-Jain',
    };
    return ok(`流阻求解完成：Re=${res.reynolds.toExponential(3)}（${res.regime}），Δp=${(res.pressure_drop / 1000).toFixed(3)} kPa`, {
      velocity_m_s: res.velocity,
      reynolds: res.reynolds,
      friction_factor: res.friction_factor,
      pressure_drop_Pa: res.pressure_drop,
      regime: res.regime,
      result_file: `${prefix}/fluid-result.json`,
    }, [{ path: `${prefix}/fluid-result.json`, data: enc(JSON.stringify(result, null, 2)), media_type: MT.json, role: 'fluid-result' }]);
  },
});

// ---------------------------------------------------------------------------
// thermal.static_estimate
// ---------------------------------------------------------------------------

registerCommand('thermal.static_estimate', {
  consumes: ['thermal network (nodes, resistors, ambient)'],
  produces: ['thermal result JSON', 'node temperature table'],
  embedded_level: 'L1',
  core: true,
  description: '稳态热网络估计（热阻网络高斯-赛德尔迭代，输出节点温度）',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const n = params['network'] as Partial<ThermalNetwork> | undefined;
    if (!n || !Array.isArray(n.nodes) || n.nodes.length === 0) return designError('network.nodes 非法');
    if (!Array.isArray(n.resistors) || n.resistors.length === 0) return designError('network.resistors 非法');
    if (!Number.isFinite(n.ambient_K) || (n.ambient_K as number) <= 0) return designError('network.ambient_K 非法（需 K）');
    const names = new Set(n.nodes.map((x) => x.name));
    for (const r of n.resistors) {
      if (!names.has(r.from) || !names.has(r.to)) return designError(`热阻引用未知节点: ${r.from} → ${r.to}`);
      if (!Number.isFinite(r.r_th) || r.r_th <= 0) return designError('热阻 r_th 非法（需 K/W > 0）');
    }
    const res = solveThermalStatic(n as ThermalNetwork);
    const prefix = artPrefix(ctx.run, 'thermal.static_estimate');
    const csv = ['node,temperature_K,temperature_C']
      .concat(Object.entries(res.node_temps_K).map(([k, v]) => `${k},${v},${(v - 273.15).toFixed(3)}`)).join('\n') + '\n';
    const result = {
      ambient_K: n.ambient_K,
      total_power_W: res.total_power_W,
      node_temps_K: res.node_temps_K,
      max_temp_K: res.max_temp_K,
      max_temp_C: res.max_temp_K - 273.15,
    };
    return ok(`热估计完成：最高 ${(res.max_temp_K - 273.15).toFixed(2)} °C`, {
      max_temp_K: res.max_temp_K,
      max_temp_C: res.max_temp_K - 273.15,
      total_power_W: res.total_power_W,
      node_temps_K: res.node_temps_K,
      result_file: `${prefix}/thermal-result.json`,
    }, [
      { path: `${prefix}/thermal-result.json`, data: enc(JSON.stringify(result, null, 2)), media_type: MT.json, role: 'thermal-result' },
      { path: `${prefix}/thermal-nodes.csv`, data: enc(csv), media_type: MT.csv, role: 'thermal-nodes' },
    ]);
  },
});

// ---------------------------------------------------------------------------
// manufacturing.package
// ---------------------------------------------------------------------------

registerCommand('manufacturing.package', {
  consumes: ['artifact refs', 'package options'],
  produces: ['manufacturing package manifest JSON'],
  embedded_level: 'L1',
  core: true,
  description: '制造包封装：将产物归档为可交付清单（附 SHA256）',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const refs = params['artifact_refs'];
    const list = Array.isArray(refs) ? refs.map(String) : (refs ? [String(refs)] : []);
    if (list.length === 0) return designError('artifact_refs 为空');
    const missing = list.filter((p) => ctx.pkg.readPayload(p) === undefined);
    if (missing.length > 0) return designError(`产物不存在: ${missing.join(', ')}`);
    const entries = list.map((p) => {
      const data = ctx.pkg.readPayload(p)!;
      return { path: p, size: data.length, sha256: sha256(data) };
    });
    const prefix = artPrefix(ctx.run, 'manufacturing.package');
    const manifest = {
      package_id: `MFG-${String(ctx.run).padStart(4, '0')}`,
      created_at: new Date().toISOString(),
      entries,
      total_size: entries.reduce((s, e) => s + e.size, 0),
    };
    ctx.pkg.addObject(
      {
        id: manifest.package_id,
        object_type: 'Manufacturing',
        title: '制造包',
        produced_by: `run-${ctx.run}`,
        relations: [],
        payloads: [],
        attributes: { entries: entries.length, total_size: manifest.total_size },
      },
      [{ path: `${prefix}/manufacturing-manifest.json`, data: enc(JSON.stringify(manifest, null, 2)), media_type: MT.json, role: 'manufacturing-manifest' }],
    );
    return ok(`制造包生成：${entries.length} 个产物，共 ${manifest.total_size} 字节`, {
      package_id: manifest.package_id,
      entries,
      manifest_file: `${prefix}/manufacturing-manifest.json`,
    }, [{ path: `${prefix}/manufacturing-manifest.json`, data: enc(JSON.stringify(manifest, null, 2)), media_type: MT.json, role: 'manufacturing-manifest' }]);
  },
});

/** 同步 SHA256。 */
function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

// ---------------------------------------------------------------------------
// report.generate
// ---------------------------------------------------------------------------

registerCommand('report.generate', {
  consumes: ['package + gate/summary data'],
  produces: ['Markdown report'],
  embedded_level: 'L0',
  core: true,
  description: '生成工程设计报告（Markdown，含证据引用与指纹）',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const title = String(params['title'] ?? 'corsj 工程设计报告');
    const summary = params['summary'] as Record<string, unknown> | undefined;
    const fingerprint = ctx.pkg.fingerprint();
    const objects = ctx.pkg.listObjects();
    const evidence = ctx.pkg.listEvidence();
    const md = [
      `# ${title}`,
      '',
      `- 生成时间：${new Date().toISOString()}`,
      `- 包指纹（SHA256）：\`${fingerprint}\``,
      `- 对象数：${objects.length}`,
      `- 证据数：${evidence.length}`,
      '',
      '## 对象',
      '',
      '| id | 类型 | 标题 |',
      '| --- | --- | --- |',
      ...objects.map((o) => `| ${o.id} | ${o.object_type} | ${o.title ?? ''} |`),
      '',
      '## 证据',
      '',
      '| id | 命令 | 运行 | 状态 |',
      '| --- | --- | --- | --- |',
      ...evidence.map((e) => `| ${e.id} | ${e.command} | ${e.run} | ${e.status} |`),
      '',
      '## 摘要',
      '',
      '```json',
      JSON.stringify(summary ?? {}, null, 2),
      '```',
      '',
    ].join('\n');
    const prefix = artPrefix(ctx.run, 'report.generate');
    ctx.pkg.addObject(
      {
        id: `Report-${String(ctx.run).padStart(4, '0')}`,
        object_type: 'Report',
        title,
        produced_by: `run-${ctx.run}`,
        relations: [],
        payloads: [],
        attributes: { fingerprint, objects: objects.length, evidence: evidence.length },
      },
      [{ path: `${prefix}/report.md`, data: enc(md), media_type: MT.md, role: 'report' }],
    );
    return ok(`报告已生成：${title}`, {
      report_file: `${prefix}/report.md`,
      fingerprint,
      objects: objects.length,
      evidence: evidence.length,
    }, [{ path: `${prefix}/report.md`, data: enc(md), media_type: MT.md, role: 'report' }]);
  },
});

// ---------------------------------------------------------------------------
// export.standard_format
// ---------------------------------------------------------------------------

registerCommand('export.standard_format', {
  consumes: ['object_id', 'format (step|stl|csv|json|md)'],
  produces: ['standard format artifact'],
  embedded_level: 'L1',
  core: true,
  description: '导出标准格式（STEP/STL/CSV/JSON/Markdown）派生文件',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const objectId = String(params['object_id'] ?? '');
    const format = String(params['format'] ?? 'json').toLowerCase();
    const obj = resolvePartRef(ctx.pkg, objectId) ?? ctx.pkg.getObject(objectId);
    if (!obj) return designError(`对象 ${objectId} 不存在`);
    const prefix = artPrefix(ctx.run, 'export.standard_format');
    const supported = ['step', 'stl', 'csv', 'json', 'md'];
    if (!supported.includes(format)) return designError(`不支持的标准格式: ${format}（支持 ${supported.join('/')}）`);
    let data: Uint8Array;
    let media: string;
    let role: string;
    if (format === 'step' || format === 'stl') {
      const p = obj.payloads.find((x) => x.role === format);
      if (!p) return designError(`对象 ${objectId} 无 ${format} 载荷可导出`);
      data = ctx.pkg.readPayload(p.path)!;
      media = format === 'step' ? 'application/step' : 'model/stl';
      role = `export-${format}`;
    } else {
      const payload = {
        id: obj.id,
        object_type: obj.object_type,
        title: obj.title,
        attributes: obj.attributes,
        payloads: obj.payloads.map((p) => ({ path: p.path, media_type: p.media_type, sha256: p.sha256, size: p.size, role: p.role })),
      };
      if (format === 'json') { data = enc(JSON.stringify(payload, null, 2)); media = MT.json; }
      else if (format === 'csv') {
        const rows = Object.entries(obj.attributes ?? {}).map(([k, v]) => `${k},${JSON.stringify(v)}`);
        data = enc(['key,value', ...rows].join('\n') + '\n'); media = MT.csv;
      } else {
        const md = [`# ${obj.title ?? obj.id}`, '', `- 类型：${obj.object_type}`, '', '## 属性', '', '```json', JSON.stringify(obj.attributes ?? {}, null, 2), '```', ''].join('\n');
        data = enc(md); media = MT.md;
      }
      role = `export-${format}`;
    }
    const outPath = `${prefix}/${objectId}.${format}`;
    return ok(`已导出 ${objectId} → ${format}`, { object_id: objectId, format, output: outPath }, [
      { path: outPath, data, media_type: media, role },
    ]);
  },
});
// ---------------------------------------------------------------------------
// propeller.design（B-series 简化匹配，L1 纯 TS 内核）
// ---------------------------------------------------------------------------

registerCommand('propeller.design', {
  consumes: ['thrust (N)', 'speed (m/s)', 'optional water density / pitch ratio / diameter-rpm range'],
  produces: ['propeller design JSON', 'propeller parameter table'],
  embedded_level: 'L1',
  core: true,
  description: '螺旋桨设计/匹配（B-series 简化回归）：由推力与航速求解所需功率、桨径与转速',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    try {
      const input = params['propeller'] as Partial<PropellerInput> | undefined;
      if (!input) return designError('propeller 非法：需要 {thrust_N, speed_m_s}');
      const need: (keyof PropellerInput)[] = ['thrust_N', 'speed_m_s'];
      for (const k of need) {
        if (!Number.isFinite(input[k] as number)) return designError(`propeller.${k} 非法（需数值）`);
      }
      const res = designPropeller(input as PropellerInput);
      const prefix = artPrefix(ctx.run, 'propeller.design');
      const result = {
        propeller: input,
        diameter: { value: res.diameter_m, unit: 'm' },
        rpm: { value: res.rpm, unit: 'rpm' },
        power: { value: res.power_W, unit: 'W' },
        power_kW: { value: res.power_W / 1000, unit: 'kW' },
        efficiency: { value: res.efficiency, unit: '1' },
        advance_coefficient: { value: res.advance_coefficient, unit: '1' },
        thrust_coefficient: { value: res.thrust_coefficient, unit: '1' },
        torque_coefficient: { value: res.torque_coefficient, unit: '1' },
        pitch_ratio: res.pitch_ratio,
        blade_count: res.blade_count,
        water_density: { value: res.water_density, unit: 'kg/m3' },
        formula: res.formula,
      };
      const msg = '螺旋桨匹配完成：D=' + res.diameter_m.toFixed(3) + ' m，n=' + res.rpm.toFixed(0) + ' rpm，P=' + (res.power_W / 1000).toFixed(3) + ' kW，η=' + (res.efficiency * 100).toFixed(1) + '%';
      return ok(msg, {
        diameter_m: res.diameter_m,
        rpm: res.rpm,
        power_W: res.power_W,
        power_kW: res.power_W / 1000,
        efficiency: res.efficiency,
        advance_coefficient: res.advance_coefficient,
        thrust_coefficient: res.thrust_coefficient,
        torque_coefficient: res.torque_coefficient,
        pitch_ratio: res.pitch_ratio,
        blade_count: res.blade_count,
        result_file: prefix + '/propeller-result.json',
      }, [{ path: prefix + "/propeller-result.json", data: enc(JSON.stringify(result, null, 2)), media_type: MT.json, role: "propeller-result" }]);
    } catch (e) {
      const err = (e as Error).message;
      if (err.startsWith('PROP_')) return designError(err);
      return envError('螺旋桨设计环境异常: ' + err);
    }
  },
});
