#!/usr/bin/env node
/**
 * 阶段一自检：真实跑通七步设计闭环并验证门禁。
 *
 * 七步：spec.parse_requirements → geometry.generate → geometry.validity_check
 *       → fea.static → eda.schematic_erc → energy.closure_sim → delivery_gate.submit
 *
 * 断言：
 * 1) 闭环可达 DELIVERED（门禁唯一交付路径）；
 * 2) 包可写 .eop 且指纹/完整自检一致；
 * 3) export.standard_format 产出一个标准格式古董(artifact)；
 * 4) 负测（门禁不可绕过）：破坏指纹/降级必需输入 → 立即 FAILED，不产出 delivered。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDesignLoop } from '../core/dist/design/index.js';
import { loadView } from '../core/dist/model/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const selfRoot = resolve(here, '..', '.cache', 'selfcheck');

const out = (s) => { process.stdout.write(s + '\n'); };

function fmtVerdict(v) {
  if (!v) return '无';
  return `decision=${v.decision} code=${v.code} branch=${v.branch ?? '-'} summary={req ${v.summary.required_passed}/${v.summary.required_total}, optional ${v.summary.optional_passed}/${v.summary.optional_total}, degraded ${v.summary.degraded_count}} sig=${v.signature.slice(0, 12)}…`;
}

/** 七步闭环目标文本：触发 几何/结构、结构强度、电子设计、能源 四域。 */
const GOAL = `设计一个电子设备结构支架：外形为 100×50×20mm 的长方体零件，材料 7075 铝，承受顶面 1.5MPa 压力，许用应力不超过 200 MPa。电路板原理图必须通过 ERC 检查且零错误。整机功耗 12W，配 33Wh 电池，能量闭合仿真相对误差不超过 1%。`;

const PLAN = [{
  design: [
    {
      command: 'geometry.generate',
      params: {
        primitive: { kind: 'box', x: 100, y: 50, z: 20 },
        name: 'Bracket',
        unit: 'mm',
      },
    },
  ],
  validation: [
    { command: 'geometry.validity_check', params: { object_id: 'Bracket' } },
    {
      command: 'fea.static',
      params: {
        size_m: [0.1, 0.05, 0.02],
        divisions: [4, 4, 3],
        material: { E: 70e9, nu: 0.33 },
        load: { face: 'z1', pressure: 1.5e6 },
        constraint: { face: 'z0', fix: [true, true, true] },
      },
    },
    {
      command: 'eda.schematic_erc',
      params: {
        netlist: {
          components: [
            {
              ref: 'U1', value: 'MCU', footprint: 'TQFP-32',
              pins: { VDD: { type: 'power_in', name: 'VDD' }, VSS: { type: 'power_in', name: 'VSS' }, OUT: { type: 'output' } },
            },
            {
              ref: 'R1', value: '10k', footprint: '0603',
              pins: { '1': { type: 'passive' }, '2': { type: 'passive' } },
            },
          ],
          nets: [
            { name: 'VCC', nodes: [{ ref: 'U1', pin: 'VDD' }, { ref: 'R1', pin: '1' }] },
            { name: 'GND', nodes: [{ ref: 'U1', pin: 'VSS' }] },
            { name: 'OUT', nodes: [{ ref: 'U1', pin: 'OUT' }, { ref: 'R1', pin: '2' }] },
          ],
        },
      },
    },
    {
      command: 'energy.closure_sim',
      params: {
        model: {
          components: [
            { name: 'MCU', p_rated: 2, duty: 1 },
            { name: 'Radio', p_rated: 5, duty: 0.6 },
            { name: 'Sensor', p_rated: 1, duty: 0.5 },
          ],
          storage_capacity: 33 * 3600,
          storage_initial: 33 * 3600,
          charge_power: 0,
          duration: 1800,
          dt: 60,
        },
      },
    },
    { command: 'export.standard_format', params: { object_id: 'Bracket', format: 'json' } },
  ],
  optional: [],
}];

let failures = 0;
function assert(cond, msg) {
  if (cond) out(`  [通过] ${msg}`);
  else { out(`  [失败] ${msg}`); failures += 1; }
}

async function main() {
  await mkdir(selfRoot, { recursive: true });

  // ================= 自检主用例：七步闭环 → 交付 =================
  out('\n===== 用例 1：七步闭环正向交付 =====');
  const res = await runDesignLoop({
    goalText: GOAL,
    plan: PLAN,
    authorization: { by: 'phase1-selfcheck', at: new Date().toISOString(), note: '阶段一自检：若缺阈值则用保守默认值以跑通闭环，并在报告中记录' },
    coreVersion: '0.1.0',
    packageId: 'PKG-SELFCheck',
    packageTitle: 'corsj 阶段一自检设计包',
    devRoot: root,
    now: () => '2026-01-01T00:00:00.000Z',
  });

  out(`  state=${res.state}  delivered=${res.delivered}`);
  out(`  spec_hash=${res.spec_hash?.slice(0, 12)}…`);
  out(`  verdict: ${fmtVerdict(res.verdict)}`);
  out(`  package_path=${res.package_path}`);
  out(`  对象数=${res.objects?.length ?? 0}  证据数=${res.evidence?.length ?? 0}`);

  assert(res.state === 'DELIVERED', `终态为 DELIVERED（实际 ${res.state}）`);
  assert(res.delivered === true, 'delivered=true（仅门禁路径可产生）');
  assert(res.verdict?.decision === 'delivered', '门禁结论 delivered');
  assert(res.gate_report_markdown?.includes('放行'), '门禁报告含放行结论');
  assert((res.evidence?.length ?? 0) >= 6, `累计证据 >= 6（7 步除门禁，实际 ${res.evidence?.length}）`);

  // 必须至少一条 geometry.generate / fea.static / erc / energy 成功证据
  const commands = new Set(res.evidence?.map((e) => e.command));
  for (const c of ['spec.parse_requirements', 'geometry.generate', 'geometry.validity_check', 'fea.static', 'eda.schematic_erc', 'energy.closure_sim']) {
    assert(commands.has(c), `证据包含命令 ${c}`);
  }

  // 门禁报告：无降级未计通过的 REQUIRED，且必含 6 项 REQUIRED 通过
  if (res.verdict) {
    assert(res.verdict.summary.required_total >= 5, `REQUIRED 总数 >= 5（实际 ${res.verdict.summary.required_total}）`);
    assert(res.verdict.summary.required_failed === 0, 'REQUIRED 全部通过');
    assert(res.verdict.summary.cannot_verify === 0, '无可验证缺失（cannot_verify=0）');
  }

  // ================= 包可浏览：.eop 对象树 + export 产物 =================
  out('\n===== 用例 2：.eop 可浏览 + export.standard_format 产出 =====');
  const view = await loadView(res.package_path);
  assert(view.integrity.ok === true, `包完整性自检通过（${(view.integrity.errors ?? []).length} 错误）`);
  assert(view.fingerprint === res.package_fingerprint, '视图指纹与包指纹一致');
  const types = new Set(view.groups?.flatMap((g) => g.nodes.map((n) => n.object_type)));
  out(`  对象类型：${[...types].join(', ')}`);
  assert([...types].includes('Part'), '包含 Part 对象');
  assert([...types].includes('Requirement'), '包含 Requirement 对象');
  assert([...types].includes('AcceptanceSpec'), '包含 AcceptanceSpec 对象');
  assert([...types].includes('FieldResult'), '包含 FieldResult（FEA）对象');
  assert([...types].includes('TimeSeries'), '包含 TimeSeries（能量）对象');
  assert([...types].includes('Report'), '包含 Report（门禁报告）对象');

  // 找 export.standard_format 证据的产物是否已写入包
  const exp = res.evidence?.find((e) => e.command === 'export.standard_format');
  assert(!!exp && exp.status === 'success', `export.standard_format 状态=success（实际 ${exp?.status}）`);
  assert(!!exp?.artifacts_prefix, 'export 证据记录了 artifacts 前缀');

  // 对象树里应能看到 Part 载荷 = step + stl
  const partGroup = view.groups?.find((g) => g.object_type === 'Part');
  const part = partGroup?.nodes?.[0];
  assert(part?.payloads?.some((p) => p.role === 'step'), 'Part 含 STEP 载荷');
  assert(part?.payloads?.some((p) => p.role === 'stl'), 'Part 含 STL 载荷');
  // 只追加语义：实体 id = run 唯一，用户名保留在标题/别名
  const partObj = res.objects?.find((o) => o.object_type === 'Part');
  assert(!!partObj && partObj.id.startsWith('Bracket-r') && partObj.id !== 'Bracket', `Part 对象 id 为 run 唯一 id（实际 ${partObj?.id}）`);
  assert(partObj?.produced_by === `run-${Number(partObj.id.slice('Bracket-r'.length))}`, `Part id 与 produced_by 运行号一致（${partObj?.id} @ ${partObj?.produced_by}）`);  assert(partObj?.title === 'Bracket', `用户名保留在标题（实际 ${partObj?.title}）`);
  assert(res.objects?.some((o) => o.id === 'req-alias:Bracket'), '登记用户名别名 req-alias:Bracket');
  assert(res.objects?.some((o) => o.id === 'GateReport-0001'), '门禁报告对象 GateReport-0001');

  // ================= 负测 1：构建清单指纹被改 → 立即 FAILED =================
  out('\n===== 用例 3：构建清单指纹被篡改 → 立即 FAILED（门禁不可绕过） =====');
  const resBadManifest = await runDesignLoop({
    goalText: GOAL,
    plan: PLAN,
    authorization: { by: 'phase1-selfcheck', at: new Date().toISOString(), note: '自检负测' },
    coreVersion: '0.1.0',
    packageId: 'PKG-BAD-MANIFEST',
    devRoot: root,
    now: () => '2026-01-01T00:00:00.000Z',
    manifestFingerprint: () => ({ expected: 'deadbeef', actual: 'cafebabe' }), // 清单被改
  });
  out(`  state=${resBadManifest.state} delivered=${resBadManifest.delivered} verdict: ${fmtVerdict(resBadManifest.verdict)}`);
  assert(resBadManifest.state === 'FAILED', `终态 FAILED（实际 ${resBadManifest.state}）`);
  assert(resBadManifest.verdict?.branch === 'fingerprint', `分支为 fingerprint（实际 ${resBadManifest.verdict?.branch}）`);
  assert(resBadManifest.verdict?.code === 'MANIFEST_FINGERPRINT_MISMATCH', 'code=MANIFEST_FINGERPRINT_MISMATCH');
  assert(resBadManifest.delivered === false, '未交付');

  // ================= 负测 2：降级导致必需输入缺失 → 配置错误 FAILED =================
  out('\n===== 用例 4：降级致必需输入缺失 → 配置错误 → 立即 FAILED =====');
  const resDeg = await runDesignLoop({
    goalText: '设计金属外壳立方体，外形 50×50×50mm，工作应力不超过 100 MPa；原理图 ERC 必须零错误。',
    plan: [{
      design: [
        { command: 'geometry.generate', params: { primitive: { kind: 'box', x: 50, y: 50, z: 50 }, name: 'Case', unit: 'mm' } },
      ],
      // fea.static 不在 validation 中执行（模拟内核不可用 → 被降级跳过）
      validation: [
        { command: 'geometry.validity_check', params: { object_id: 'Case' } },
      ],
      optional: [
        { command: 'fea.static', reason: '自检负测：模拟 FEA 内核不可用（必然导致 REQUIRED fea.static 无成功证据）', affects: ['val-fea-static'] },
      ],
    }],
    authorization: { by: 'phase1-selfcheck', at: new Date().toISOString(), note: '自检负测：授权保守默认值以便生成 spec' },
    coreVersion: '0.1.0',
    devRoot: root,
  });
  out(`  state=${resDeg.state} delivered=${resDeg.delivered} verdict: ${fmtVerdict(resDeg.verdict)}`);
  assert(resDeg.state === 'FAILED', `终态 FAILED（实际 ${resDeg.state}）`);
  assert(resDeg.verdict?.branch === 'configuration', `分支为 configuration（实际 ${resDeg.verdict?.branch}）`);
  assert(resDeg.verdict?.code === 'MISSING_INPUT_DUE_TO_DEGRADATION', 'code=MISSING_INPUT_DUE_TO_DEGRADATION');

  // ================= 负测 3：多轮阈值拒绝 → 追加安全（无 EOP_APPEND_ONLY） =================
  out('\\n===== 用例 5：多轮阈值拒绝 → 回 DESIGNING 再设计 → 门禁通过（追加语义安全） =====');
  // 阈值 0.165 mm 位移第一轮达不到（4³ 粗网格位移 0.1694 mm），第二轮细分网格（8³ → 0.1608 mm）达到
  const goalRounds = '设计钢块，外形 100×100×100mm，最大位移不超过 0.165 mm。';
  const mkPlan = (div) => [{
    design: [{ command: 'geometry.generate', params: { primitive: { kind: 'box', x: 100, y: 100, z: 100 }, name: 'Cube', unit: 'mm' } }],
    validation: [
      { command: 'geometry.validity_check', params: { object_id: 'Cube' } },
      { command: 'fea.static', params: { size_m: [0.1, 0.1, 0.1], divisions: div, material: { E: 200e9, nu: 0.3 }, load: { face: 'z1', pressure: 200e6 }, constraint: { face: 'z0', fix: [true, true, true] } } },
    ],
    optional: [],
  }];
  const resRounds = await runDesignLoop({
    goalText: goalRounds,
    plan: [...mkPlan([4, 4, 4]), ...mkPlan([8, 8, 8])],
    authorization: { by: 'phase1-selfcheck', at: new Date().toISOString(), note: '自检：多轮回归' },
    coreVersion: '0.1.0',
    packageId: 'PKG-ROUNDS',
    devRoot: root,
    now: () => '2026-01-01T00:00:00.000Z',
  });
  out(`  state=${resRounds.state} delivered=${resRounds.delivered} used_rounds=${resRounds.used_rounds}`);
  out(`  verdict: ${fmtVerdict(resRounds.verdict)}`);
  for (let i = 0; i < resRounds.rounds.length; i += 1) {
    const r = resRounds.rounds[i];
    out(`  第 ${r.round} 轮门禁: ${r.verdict.decision}${r.verdict.code ? ` (${r.verdict.code})` : ''}`);
  }
  assert(resRounds.state === 'DELIVERED', `多轮后终态 DELIVERED（实际 ${resRounds.state}）`);
  assert(resRounds.used_rounds === 2, `计数 2 轮（实际 ${resRounds.used_rounds}）`);
  assert(resRounds.rounds[0]?.verdict.decision === 'rejected', '第 1 轮阈值不达标被拒');
  assert(resRounds.rounds[1]?.verdict.decision === 'delivered', '第 2 轮通过门禁');
  assert(resRounds.objects?.filter((o) => o.object_type === 'Part').length === 2, '同名跨轮生成 2 个 Part（追加，不覆盖）');
  assert(resRounds.objects?.some((o) => o.relations?.some?.((r) => r.type === 'supersedes')), '新 Part 以 supersedes 关联旧版');
  assert(resRounds.objects?.some((o) => o.id === 'GateReport-0002'), '每轮门禁报告对象独立（GateReport-0002）');
  // 第 1 轮报告对象与第 2 轮并存
  assert(resRounds.objects?.some((o) => o.id === 'GateReport-0001'), '每轮门禁报告对象独立（GateReport-0001）');
  // 报告载荷路径每轮唯一（不同 run）
  const gatePayloads = resRounds.objects?.filter((o) => o.id?.startsWith('GateReport')).flatMap((o) => o.payloads.map((p) => p.path)) ?? [];
  assert(new Set(gatePayloads).size === gatePayloads.length, '门禁报告载荷路径全部唯一');

  // ================= 用例 6：P0 新增能力自检（propeller.design + fluid.internal_flow） =================
  out('\n===== 用例 6：P0 新增能力（propeller.design / fluid.internal_flow） =====');
  const { executeCommand } = await import('../core/dist/commands/index.js');
  const { EopPackage } = await import('../core/dist/model/index.js');
  const { createUnavailableAssetResolver } = await import('../core/dist/design/index.js');
  const tmpPkg = EopPackage.create('PKG-P0-CHECK', 'P0 能力自检包', '0.1.0');
  const p0Ctx = { pkg: tmpPkg, run: 1, scratchDir: selfRoot, assets: createUnavailableAssetResolver() };
  const propRes = await executeCommand('propeller.design', { propeller: { thrust_N: 20, speed_m_s: 1.2, water_density: 1025, pitch_ratio: 1.0 } }, p0Ctx);
  assert(propRes.status === 'success', `propeller.design 返回 success（实际 ${propRes.status}）`);
  assert(Number.isFinite(propRes.result.raw_data.power_W) && propRes.result.raw_data.power_W > 0, 'propeller.design 输出正功率');
  assert(Number.isFinite(propRes.result.raw_data.diameter_m) && propRes.result.raw_data.diameter_m > 0, 'propeller.design 输出正桨径');
  assert(Number.isFinite(propRes.result.raw_data.rpm) && propRes.result.raw_data.rpm > 0, 'propeller.design 输出正转速');
  const hullRes = await executeCommand('fluid.internal_flow', { hull: { length_m: 1.8, speed_m_s: 1.2, beam_m: 0.6, draft_m: 0.3, water_density: 1025 } }, p0Ctx);
  assert(hullRes.status === 'success', `fluid.internal_flow 返回 success（实际 ${hullRes.status}）`);
  assert(Number.isFinite(hullRes.result.raw_data.total_resistance_N) && hullRes.result.raw_data.total_resistance_N > 0, 'fluid.internal_flow 输出正总阻力');
  assert(Number.isFinite(hullRes.result.raw_data.required_power_W) && hullRes.result.raw_data.required_power_W > 0, 'fluid.internal_flow 输出正需用功率');
  assert(Number.isFinite(hullRes.result.raw_data.reynolds) && hullRes.result.raw_data.reynolds > 0, 'fluid.internal_flow 输出正雷诺数');
  // P1：arrangement.mass_cg 支持布置偏移（报告缺口：原按基元局部系计算）
  // 10mm 盒体局部质心 X=5；两个零件同向偏移 +100 → 世界质心 X 应为 105（未加偏移则为 5）。
  const massRes = await executeCommand('arrangement.mass_cg', { parts: [
    { id: 'A', primitive: { kind: 'box', x: 10, y: 10, z: 10 }, density: 1, offset_mm: [100, 0, 0] },
    { id: 'B', primitive: { kind: 'box', x: 10, y: 10, z: 10 }, density: 1, offset_mm: [100, 0, 0] },
  ] }, p0Ctx);
  assert(massRes.status === 'success', `arrangement.mass_cg 返回 success（实际 ${massRes.status}）`);
  const cgObj = massRes.result.raw_data.center_of_gravity;
  const cgVal = cgObj && typeof cgObj === 'object' ? cgObj.value : undefined;
  assert(Array.isArray(cgVal) && Math.abs((cgVal[0] ?? 0) - 105) < 1e-6, 'mass_cg 支持 offset：世界质心 X=105（5 局部 + 100 偏移）');

  // ================= 汇总 =================
  out('\n==============================================');
  out(`自检结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
  out('==============================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  out(`自检脚本异常：${e.stack ?? e}`);
  process.exit(2);
});