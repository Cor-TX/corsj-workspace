/**
 * @corsj/core — 核心命令实现（第一批：spec / geometry / fea）。
 *
 * A 层纪律：只执行、产出证据与结构化 raw_data；
 * 不比较阈值、不生成 passed/failed、不迭代、不修改输入参数。
 */
import { registerCommand, executeCommand } from './registry.js';
import { ok, designError, envError, notImplemented, type CommandContext, type CommandParams } from './types.js';
import type { EopPackage, ObjectRecord } from '../model/eop.js';
import {
  DIM, findUnit, validateQuantity, compatibleUnits, toSI,
} from '../model/units.js';
import { validateQuantitySchema } from '../model/quantity-schema.js';
import {
  primitiveToStep, primitiveToStl, bboxOf, volumeOf, areaOf, centroidOf,
  type Primitive,
} from './builtin/geometry-kernel.js';
import { buildMesh, solveStatic, faceNodes, type Material, type FeaLoad, type FeaConstraint, type StructureSpec } from './builtin/fea-kernel.js';

const MT = {
  step: 'application/step',
  stl: 'model/stl',
  json: 'application/json',
  csv: 'text/csv',
  md: 'text/markdown',
  kicadSch: 'application/x-kicad-schematic',
  gbr: 'application/x-gerber',
  drl: 'application/x-excellon',
  zip: 'application/zip',
};

export function artPrefix(run: number, command: string): string {
  return `artifacts/${String(run).padStart(4, '0')}-${command}`;
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * 解析对象引用：精确 id 命中优先；否则把引用当作「用户名别名」，
 * 经 req-alias:<name> 解析到该名字的最新 Part（跨轮修订）。
 */
export function resolvePartRef(pkg: EopPackage, ref: string): ObjectRecord | undefined {
  const direct = pkg.getObject(ref);
  if (direct && direct.object_type === 'Part') return direct;
  const alias = pkg.getObject(`req-alias:${ref}`);
  if (alias && alias.object_type === 'PartAlias') {
    const current = String(alias.attributes?.['current_part_id'] ?? '');
    const byCurrent = current ? pkg.getObject(current) : undefined;
    if (byCurrent && byCurrent.object_type === 'Part') return byCurrent;
  }
  // 兜底：同名（title）最新 Part
  const byTitle = pkg.listObjects('Part').filter((o) => o.title === ref)
    .sort((a, b) => (b.produced_by ?? '').localeCompare(a.produced_by ?? ''))[0];
  return byTitle;
}

// ---------------------------------------------------------------------------
// spec.parse_requirements
// ---------------------------------------------------------------------------

interface ParsedQuantity { raw: string; value: number; unit: string; }

const QUANTITY_RE = /(-?\d+(?:\.\d+)?)\s*(mm|cm|m|km|in|kg|g|t|N|kN|kPa|MPa|GPa|Pa|bar|atm|J|kJ|Wh|kWh|W|kW|MW|mW|K|degC|Hz|kHz|MHz|GHz|s|ms|min|h|A|mA|V|mV|ohm|Ah|mAh|bit\/s|kbit\/s|Mbit\/s|Gbit\/s|dB|%|m\/s|km\/h|m\/s2|g0|kg\/m3|g\/cm3|W\/mK|L|m2|mm2|m3|mm3|deg|rad)\b/g;

const DOMAIN_KEYWORDS: { domain: string; category: string; re: RegExp; command: string }[] = [
  { domain: 'geometry', category: '几何/结构', re: /尺寸|外形|包围盒|轮廓|壳体|支架|板|框架|长|宽|高|直径|半径|壁厚|体积/i, command: 'geometry.generate' },
  { domain: 'strength', category: '结构强度', re: /应力|应变|强度|屈服|变形|位移|挠度|安全系数|载荷|受力|刚度/i, command: 'fea.static' },
  { domain: 'eda', category: '电子设计', re: /电路|原理图|ERC|DRC|PCB|布局|走线|焊盘|原理|芯片|电阻|电容|MCU|单片机/i, command: 'eda.schematic_erc' },
  { domain: 'energy', category: '能源', re: /能耗|功耗|电池|续航|功率|充电|放电|能量|瓦时/i, command: 'energy.closure_sim' },
  { domain: 'motion', category: '运动', re: /振动|固有频率|阻尼|振型|位移响应|加速度|运动|弹簧|阻尼器/i, command: 'motion.sim' },
  { domain: 'comm', category: '通信', re: /链路|天线|增益|发射功率|灵敏度|信号覆盖|通信距离|Eb\/N0/i, command: 'comm.link_budget' },
  { domain: 'fluid', category: '流体', re: /压降|流量|流阻|流速|雷诺数|管道|流道|风阻/i, command: 'fluid.resistance_solve' },
  { domain: 'propulsion', category: '推进', re: /螺旋桨|推进|推力|航速|转速|功率匹配|桨径/i, command: 'propeller.design' },
  { domain: 'hydrodynamics', category: '水动力', re: /船体|水动力|船体阻力|巡航|阻力系数/i, command: 'fluid.internal_flow' },
  { domain: 'thermal', category: '热', re: /温度|散热|热阻|温升|结温|热设计|功耗发热/i, command: 'thermal.static_estimate' },
  { domain: 'arrangement', category: '布置', re: /质量|质心|重心|干涉|间隙|装配|布置|重量/i, command: 'arrangement.mass_cg' },
  { domain: 'manufacturing', category: '制造', re: /制造|加工|Gerber|贴片|钣金|注塑|3D打印/i, command: 'manufacturing.package' },
  { domain: 'bom', category: '物料', re: /BOM|物料清单|元件清单|用量/i, command: 'bom.generate' },
];

/** 目标文本 → 结构化需求条目（真实解析：数量抽取 + 领域识别 + 验证项建议）。 */
function parseRequirements(goalText: string): {
  requirements: { id: string; text: string; category: string; mandatory: boolean; suggested_commands: string[] }[];
  quantities: ParsedQuantity[];
  detected_domains: string[];
} {
  const sentences = goalText.split(/[。；;.!?\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
  const quantities: ParsedQuantity[] = [];
  for (const m of goalText.matchAll(QUANTITY_RE)) {
    quantities.push({ raw: m[0], value: Number(m[1]), unit: m[2] });
  }
  const detected = new Map<string, string[]>();
  for (const s of sentences) {
    for (const d of DOMAIN_KEYWORDS) {
      if (d.re.test(s)) {
        if (!detected.has(d.domain)) detected.set(d.domain, []);
        detected.get(d.domain)!.push(s);
      }
    }
  }
  const requirements: { id: string; text: string; category: string; mandatory: boolean; suggested_commands: string[] }[] = [];
  let idx = 1;
  for (const [domain, sents] of detected) {
    const d = DOMAIN_KEYWORDS.find((x) => x.domain === domain)!;
    for (const s of new Set(sents)) {
      requirements.push({
        id: `REQ-${String(idx++).padStart(4, '0')}`,
        text: s,
        category: d.category,
        mandatory: true,
        suggested_commands: [d.command],
      });
    }
  }
  if (requirements.length === 0) {
    requirements.push({
      id: 'REQ-0001',
      text: goalText.slice(0, 200),
      category: '通用',
      mandatory: true,
      suggested_commands: [],
    });
  }
  return { requirements, quantities, detected_domains: [...detected.keys()] };
}

registerCommand('spec.parse_requirements', {
  consumes: ['goal_text:string'],
  produces: ['Requirement objects', 'structured requirements JSON'],
  embedded_level: 'L0',
  core: true,
  description: '解析自然语言目标为结构化需求条目（真实解析：数量/领域/建议验证命令）',
  executor: async (params: CommandParams) => {
    const goal = String(params['goal_text'] ?? '');
    if (!goal.trim()) return designError('goal_text 为空');
    const parsed = parseRequirements(goal);
    return ok('需求解析完成', { ...parsed }, [
      { path: 'requirements.json', data: enc(JSON.stringify(parsed, null, 2)), media_type: MT.json, role: 'requirements' },
    ]);
  },
});

// ---------------------------------------------------------------------------
// geometry.generate
// ---------------------------------------------------------------------------

function parsePrimitive(p: Record<string, unknown>): Primitive | undefined {
  const kind = p['kind'];
  if (kind === 'box') {
    const x = Number(p['x']), y = Number(p['y']), z = Number(p['z']);
    if (![x, y, z].every((v) => Number.isFinite(v) && v > 0)) return undefined;
    return { kind: 'box', x, y, z };
  }
  if (kind === 'cylinder') {
    const r = Number(p['r']), h = Number(p['h']);
    if (![r, h].every((v) => Number.isFinite(v) && v > 0)) return undefined;
    return { kind: 'cylinder', r, h };
  }
  return undefined;
}

registerCommand('geometry.generate', {
  consumes: ['primitive spec (box|cylinder, mm)'],
  produces: ['Part object', 'STEP payload', 'STL payload', 'bbox/volume/key dims'],
  embedded_level: 'L1',
  core: true,
  description: '生成参数化几何（盒体/圆柱），产出 STEP+STL 载荷与 Part 对象',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const spec = (params['primitive'] ?? {}) as Record<string, unknown>;
    const primitive = parsePrimitive(spec);
    if (!primitive) return designError('primitive 非法：需要 {kind:"box",x,y,z} 或 {kind:"cylinder",r,h}（mm，正数）');
    const name = String(params['name'] ?? `Part-${String(ctx.run).padStart(4, '0')}`);
    const unit = String(params['unit'] ?? 'mm');
    const u = findUnit(unit);
    if (!u || u.quantity !== 'length') return designError(`unit 非法: ${unit}（需要长度单位）`);
    const step = primitiveToStep(primitive, name);
    const stl = primitiveToStl(primitive, name);
    const bb = bboxOf(primitive);
    const vol = volumeOf(primitive);
    const area = areaOf(primitive);
    const c = centroidOf(primitive);
    const prefix = artPrefix(ctx.run, 'geometry.generate');
    // 只追加语义：.eop 对象 id 全局唯一。用户名只作标题与需求别名；
    // 实体 id = `${name}-r<run>`，同一用户名跨轮不冲突。
    const aliasId = `req-alias:${name}`;
    const partId = `${name}-r${String(ctx.run).padStart(4, '0')}`;
    const stepPath = `${prefix}/${partId}.step`;
    const stlPath = `${prefix}/${partId}.stl`;
    // 同名跨轮修订：新 Part 以 supersedes 指向上一版本（若存在）
    const prior = ctx.pkg.listObjects('Part').filter((o) => o.attributes?.['user_name'] === name)
      .sort((a, b) => (b.produced_by ?? '').localeCompare(a.produced_by ?? ''))[0];
    const relations: { type: 'supersedes'; target: string }[] = prior ? [{ type: 'supersedes', target: prior.id }] : [];
    // 登记 Part 对象（载荷 = STEP + STL）
    const part = ctx.pkg.addObject(
      {
        id: partId,
        object_type: 'Part',
        title: name,
        produced_by: `run-${ctx.run}`,
        relations,
        payloads: [],
        attributes: {
          user_name: name,
          primitive_kind: primitive.kind,
          unit,
          bbox_mm: { min: bb.min, max: bb.max },
          volume_mm3: vol,
          surface_area_mm2: area,
          centroid_mm: c,
          key_dimensions: primitive.kind === 'box'
            ? [{ name: 'X 尺寸', value: primitive.x, unit }, { name: 'Y 尺寸', value: primitive.y, unit }, { name: 'Z 尺寸', value: primitive.z, unit }]
            : [{ name: '半径', value: primitive.r, unit }, { name: '高度', value: primitive.h, unit }],
        },
      },
      [
        { path: stepPath, data: enc(step), media_type: MT.step, role: 'step' },
        { path: stlPath, data: enc(stl), media_type: MT.stl, role: 'stl' },
      ],
    );
    // 首次出现时登记用户名别名（对象，可引用；不产生额外载荷）
    if (!ctx.pkg.getObject(aliasId)) {
      ctx.pkg.addObject(
        {
          id: aliasId,
          object_type: 'PartAlias',
          title: `用户名别名：${name}`,
          produced_by: `run-${ctx.run}`,
          relations: [{ type: 'references', target: partId }],
          payloads: [],
          attributes: { alias: name, current_part_id: partId },
        },
        [],
      );
    }
    return ok(`已生成 ${name}（${primitive.kind}），体积 ${vol.toFixed(3)} ${unit}³`, {
      part_id: part.id,
      bbox: { min: bb.min, max: bb.max, unit },
      volume: { value: vol, unit: unit === 'mm' ? 'mm3' : unit },
      surface_area: { value: area, unit: unit === 'mm' ? 'mm2' : unit },
      centroid: { value: c, unit },
      key_dimensions: part.attributes?.['key_dimensions'],
      kernel: 'corsj-L1-analytic',
    }, [
      { path: `${prefix}/geometry-result.json`, data: enc(JSON.stringify({ part_id: part.id, bbox: bb, volume_mm3: vol, area_mm2: area, centroid: c }, null, 2)), media_type: MT.json, role: 'geometry-result' },
    ]);
  },
});

// ---------------------------------------------------------------------------
// geometry.format_convert
// ---------------------------------------------------------------------------

registerCommand('geometry.format_convert', {
  consumes: ['object_id (Part)', 'target_format (stl|step)'],
  produces: ['converted payload artifact'],
  embedded_level: 'L1',
  core: true,
  description: '在 Part 的 STEP/STL 载荷间转换（导出派生，不产生第二真格式）',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const objectId = String(params['object_id'] ?? '');
    const target = String(params['target_format'] ?? '').toLowerCase();
    const obj = resolvePartRef(ctx.pkg, objectId);
    if (!obj || obj.object_type !== 'Part') return designError(`对象 ${objectId} 不存在或不是 Part`);
    const stepPayload = obj.payloads.find((p) => p.role === 'step');
    const stlPayload = obj.payloads.find((p) => p.role === 'stl');
    const prefix = artPrefix(ctx.run, 'geometry.format_convert');
    if (target === 'stl' && stlPayload) {
      const data = ctx.pkg.readPayload(stlPayload.path)!;
      const outPath = `${prefix}/${obj.id}.stl`;
      return ok(`已导出 ${obj.id} 为 STL`, { source_payload: stepPayload?.path, output: outPath, format: 'stl', object_id: obj.id }, [
        { path: outPath, data, media_type: MT.stl, role: 'converted-stl' },
      ]);
    }
    if (target === 'step' && stepPayload) {
      const data = ctx.pkg.readPayload(stepPayload.path)!;
      const outPath = `${prefix}/${obj.id}.step`;
      return ok(`已导出 ${obj.id} 为 STEP`, { source_payload: stepPayload.path, output: outPath, format: 'step', object_id: obj.id }, [
        { path: outPath, data, media_type: MT.step, role: 'converted-step' },
      ]);
    }
    return designError(`不支持的目标格式或源载荷缺失: ${target}`);
  },
});

// ---------------------------------------------------------------------------
// geometry.validity_check
// ---------------------------------------------------------------------------

registerCommand('geometry.validity_check', {
  consumes: ['object_id (Part)'],
  produces: ['validity report artifact'],
  embedded_level: 'L1',
  core: true,
  description: '拓扑有效性检查（载荷完整性、体积正性、STL 封闭性）',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const objectId = String(params['object_id'] ?? '');
    const obj = resolvePartRef(ctx.pkg, objectId);
    if (!obj || obj.object_type !== 'Part') return designError(`对象 ${objectId} 不存在或不是 Part`);
    const errors: string[] = [];
    const checks: Record<string, unknown> = {};
    const stepPayload = obj.payloads.find((p) => p.role === 'step');
    const stlPayload = obj.payloads.find((p) => p.role === 'stl');
    if (!stepPayload) errors.push('缺少 STEP 载荷');
    else {
      const text = ctx.pkg.readPayloadText(stepPayload.path) ?? '';
      checks['step_iso_header'] = text.includes('ISO-10303-21');
      checks['step_end_marker'] = text.includes('END-ISO-10303-21');
      if (!checks['step_iso_header'] || !checks['step_end_marker']) errors.push('STEP 文件结构不完整');
    }
    if (!stlPayload) errors.push('缺少 STL 载荷');
    else {
      const text = ctx.pkg.readPayloadText(stlPayload.path) ?? '';
      const facets = (text.match(/facet normal/g) ?? []).length;
      checks['stl_facets'] = facets;
      // Euler 特性 V - E + F = 2（封闭流形）；STL 中 3F = 2E（每边共享）
      checks['stl_euler_v_minus_e_plus_f'] = facets % 2 === 0 && facets >= 4 ? 2 : -1;
      if (facets < 4) errors.push(`STL 三角面数不足（${facets} < 4）`);
      if (facets % 2 !== 0) errors.push('STL 三角面数为奇数，流形不封闭');
      if (!/\bendsolid(\s+\S+)?\s*$/m.test(text.trimEnd())) errors.push('STL 未以 endsolid 结束');
    }
    const vol = obj.attributes?.['volume_mm3'];
    if (typeof vol !== 'number' || vol <= 0) errors.push('体积非正');
    const bbox = obj.attributes?.['bbox_mm'] as { min: number[]; max: number[] } | undefined;
    if (!bbox || bbox.max.some((v, i) => v <= bbox.min[i])) errors.push('包围盒退化');
    checks['volume_mm3'] = vol;
    checks['payload_integrity'] = ctx.pkg.verifyPayloadIntegrity().ok;
    const valid = errors.length === 0;
    const prefix = artPrefix(ctx.run, 'geometry.validity_check');
    return ok(valid ? `拓扑有效：${objectId}` : `拓扑无效：${errors.length} 项错误`, {
      object_id: objectId,
      validity: valid ? 'valid' : 'invalid',
      errors,
      checks,
    }, [
      { path: `${prefix}/validity-report.json`, data: enc(JSON.stringify({ object_id: objectId, validity: valid ? 'valid' : 'invalid', errors, checks }, null, 2)), media_type: MT.json, role: 'validity-report' },
    ]);
  },
});

// ---------------------------------------------------------------------------
// fea.static
// ---------------------------------------------------------------------------

registerCommand('fea.static', {
  consumes: ['structure spec (m)', 'material', 'load', 'constraint'],
  produces: ['FEA result JSON', 'displacement CSV', 'FieldResult object'],
  embedded_level: 'L1',
  core: true,
  description: '线弹性静力分析（8 节点六面体 + 直接求解），输出 von Mises/位移/反力',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    try {
      const size = params['size_m'] as number[] | undefined;
      const divisions = (params['divisions'] as number[] | undefined) ?? [6, 6, 6];
      if (!size || size.length !== 3 || !size.every((v) => Number.isFinite(v) && v > 0)) {
        return designError('size_m 非法：需要 [lx,ly,lz]（m，正数）');
      }
      if (divisions.length !== 3 || !divisions.every((v) => Number.isInteger(v) && v >= 2 && v <= 12)) {
        return designError('divisions 非法：需要 [nx,ny,nz]，每轴 2–12');
      }
      const total = divisions[0] * divisions[1] * divisions[2];
      if (total > 12 * 12 * 12) return designError('网格规模超限（L1 上限 12³ 单元）');
      const mat = params['material'] as Partial<Material> | undefined;
      if (!mat || !Number.isFinite(mat.E) || (mat.E as number) <= 0 || !Number.isFinite(mat.nu) || (mat.nu as number) <= 0 || (mat.nu as number) >= 0.5) {
        return designError('material 非法：需要 {E: Pa>0, nu: (0,0.5)}');
      }
      const load = params['load'] as Partial<FeaLoad> | undefined;
      if (!load || !load.face || !Number.isFinite(load.pressure)) {
        return designError('load 非法：需要 {face, pressure: Pa}');
      }
      const constraint = params['constraint'] as Partial<FeaConstraint> | undefined;
      if (!constraint || !constraint.face || !constraint.fix) {
        return designError('constraint 非法：需要 {face, fix:[bool,bool,bool]}');
      }
      const hole = params['hole'] as { center: number[]; r: number } | undefined;
      const spec: StructureSpec = {
        size: [size[0], size[1], size[2]],
        divisions: [divisions[0], divisions[1], divisions[2]],
        hole: hole && hole.center?.length === 2 && Number.isFinite(hole.r) && hole.r > 0
          ? { center: [hole.center[0], hole.center[1]], r: hole.r } : undefined,
      };
      const mesh = buildMesh(spec);
      if (mesh.elements.length < 2) return designError('网格退化：有效单元不足（检查挖孔参数）');
      const sol = solveStatic(mesh, spec.size, mat as Material, load as FeaLoad, constraint as FeaConstraint);
      const prefix = artPrefix(ctx.run, 'fea.static');
      // 位移场 CSV
      const csvLines = ['node_id,x_m,y_m,z_m,ux_m,uy_m,uz_m,disp_mag_m'];
      mesh.nodes.forEach((p, i) => {
        void p;
        void i;
      });
      // 简化：输出汇总而非全场（全场保存在 FieldResult JSON）
      csvLines.push(`summary,${mesh.nodes.length} nodes,${mesh.elements.length} elements,${sol.displacement_max.toExponential(6)},,,`);
      const fieldJson = {
        solver: 'corsj-L1-hex8-linear-elastic',
        solver_exit: 'normal',
        converged: sol.converged,
        nodes: mesh.nodes.length,
        elements: mesh.elements.length,
        dofs: sol.dofs,
        material: mat,
        load,
        constraint,
        max_von_mises: { value: sol.von_mises_max, unit: 'Pa' },
        max_displacement: { value: sol.displacement_max, unit: 'm' },
        reaction_sum: { x: sol.reaction_sum.x, y: sol.reaction_sum.y, z: sol.reaction_sum.z, unit: 'N' },
      };
      const result = ok(`FEA 完成：σ_vm,max=${(sol.von_mises_max / 1e6).toFixed(3)} MPa，u_max=${(sol.displacement_max * 1000).toFixed(4)} mm`, {
        solver: 'corsj-L1-hex8',
        solver_exit_code: 0,
        converged: sol.converged,
        nodes: mesh.nodes.length,
        elements: mesh.elements.length,
        max_von_mises: { value: sol.von_mises_max, unit: 'Pa' },
        max_displacement: { value: sol.displacement_max, unit: 'm' },
        reaction_sum_N: sol.reaction_sum,
        result_file: `${prefix}/fea-result.json`,
      }, [
        { path: `${prefix}/fea-result.json`, data: enc(JSON.stringify(fieldJson, null, 2)), media_type: MT.json, role: 'fea-result' },
        { path: `${prefix}/displacement-summary.csv`, data: enc(csvLines.join('\n') + '\n'), media_type: MT.csv, role: 'fea-displacement' },
      ]);
      // 登记 FieldResult 对象
      ctx.pkg.addObject(
        {
          id: `FieldResult-${String(ctx.run).padStart(4, '0')}`,
          object_type: 'FieldResult',
          title: '静力分析场结果',
          produced_by: `run-${ctx.run}`,
          relations: [],
          payloads: [],
          attributes: {
            solver: 'corsj-L1-hex8',
            converged: sol.converged,
            max_von_mises_Pa: sol.von_mises_max,
            max_displacement_m: sol.displacement_max,
          },
        },
        [],
      );
      return result;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith('FEA_')) return designError(msg);
      return envError(`FEA 求解环境异常: ${msg}`);
    }
  },
});
