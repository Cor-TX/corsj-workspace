/**
 * @corsj/dsh — 阶段二自检（Node 级，无 Electron）。
 *
 * 覆盖：
 * 1. 宿主 IPC 白名单通道注册；
 * 2. 客户端经 IPC 调宿主（loopback）完成 A 层命令面与 B 层七步闭环；
 * 3. shell.overlay 内容渲染（摘要卡片 / 最近命令 / 版本）；
 * 4. DSH 模型 .jsonl.zstd 持久化与指纹校验（含篡改负例）；
 * 5. 门禁命令经命令面被拒（不可绕过）；
 * 6. 不变量（不持 API key、渲染器不 import core）。
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');

const { apply, dshActions, dshPlugin, INVARIANTS } = await import(pathToFileURL(join(dist, 'index.js')).href);
const { createClientIpcBridge, IPC_CHANNELS } = await import(pathToFileURL(join(dist, 'ipc.js')).href);
const { SessionStore, PersistenceFingerprintError } = await import(pathToFileURL(join(dist, 'persistence.js')).href);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log((ok ? '[通过] ' : '[失败] ') + name + (detail ? ' — ' + detail : ''));
}

const sessionsDir = join(here, '..', '.cache', 'dsh-selfcheck-sessions');
rmSync(sessionsDir, { recursive: true, force: true });

// 1. 装配宿主
await apply({}, { sessionsDir, sessionId: 'selfcheck', validateOnStart: false });

// 2. 客户端 IPC 桥（loopback）
const client = await createClientIpcBridge();
check('客户端 IPC 桥创建', client !== undefined);
check('宿主使用进程内回环（无 Electron）', client.electron === false);

// 3. sysinfo
const sys = await client.invoke(IPC_CHANNELS.sysinfo);
check('sysinfo 返回 core 版本', typeof sys.core_version === 'string' && sys.core_version.length > 0, sys.core_version);
check('sysinfo 注册表正常', sys.registry_ok === true, JSON.stringify(sys.counts));
check('sysinfo 不变量', sys.invariants.holds_model_api_key === false && sys.invariants.ui_may_declare_delivered === false);

// 4. 命令面
const cmds = await client.invoke(IPC_CHANNELS.listCommands);
check('命令面暴露 20 条核心命令', cmds.commands.length === 20, 'count=' + cmds.commands.length);
check('命令面不含门禁命令', cmds.surface.gate_exposed === false);

// 5. openCommandPanel
const panel = await client.invoke(IPC_CHANNELS.openPanel, {});
check('openCommandPanel 槽位绑定', panel.slot === 'sidebar.footer.action' && panel.action === 'openCommandPanel');
check('openCommandPanel 核心命令 20 条', panel.core_commands.length === 20, 'count=' + panel.core_commands.length);

// 6. 门禁命令经命令面被拒
const gateRefused = await client.invoke(IPC_CHANNELS.runCommand, { mode: 'command', command: 'delivery_gate.submit', params: {} });
check('门禁命令经命令面被拒（refused）', gateRefused.receipt?.status === 'refused', gateRefused.receipt?.status);

// 7. B 层七步闭环
const plan = [{
  design: [
    { command: 'geometry.generate', params: { primitive: { kind: 'box', x: 100, y: 50, z: 20 }, name: 'Bracket', unit: 'mm' } },
  ],
  validation: [
    { command: 'geometry.validity_check', params: { object_id: 'Bracket' } },
    { command: 'fea.static', params: { size_m: [0.1, 0.05, 0.02], divisions: [4, 4, 3], material: { E: 70e9, nu: 0.33 }, load: { face: 'z1', pressure: 1.5e6 }, constraint: { face: 'z0', fix: [true, true, true] } } },
    { command: 'eda.schematic_erc', params: { netlist: demoNetlist() } },
    { command: 'energy.closure_sim', params: { model: demoEnergy() } },
    { command: 'export.standard_format', params: { object_id: 'Bracket', format: 'json' } },
  ],
  optional: [],
}];
const goalText = '设计一个电子设备结构支架：外形为 100×50×20mm 的长方体零件，材料 7075 铝，承受顶面 1.5MPa 压力，许用应力不超过 200 MPa。电路板原理图必须通过 ERC 检查且零错误。整机功耗 12W，配 33Wh 电池，能量闭合仿真相对误差不超过 1%。';
const loopRes = await client.invoke(IPC_CHANNELS.runCommand, {
  mode: 'loop',
  goalText,
  plan,
  devRoot: join(here, '..', '..'),
  authorization: { by: 'dsh-corsj-selfcheck', at: new Date().toISOString(), note: '自检授权' },
});
check('七步闭环到达 DELIVERED', loopRes.loop?.state === 'DELIVERED' && loopRes.loop?.delivered === true, loopRes.loop?.state);
check('闭环门禁 verdict 为 delivered', loopRes.loop?.verdict?.decision === 'delivered', loopRes.loop?.verdict?.code);
check('闭环 REQUIRED 全通过', loopRes.loop?.required_passed === loopRes.loop?.required_total && loopRes.loop?.required_total > 0, loopRes.loop?.required_passed + '/' + loopRes.loop?.required_total);
check('闭环产出交付包', typeof loopRes.loop?.package_path === 'string' && loopRes.loop.package_path.length > 0, loopRes.loop?.package_path);
check('闭环包指纹存在', typeof loopRes.loop?.package_fingerprint === 'string' && loopRes.loop.package_fingerprint.length === 64);

// 8. overlay 内容
const overlay = await client.invoke(IPC_CHANNELS.getOverlay, {});
check('overlay 槽位绑定', overlay.slot === 'shell.overlay' && overlay.action === 'getOverlayContent');
check('overlay 渲染 HTML', typeof overlay.html === 'string' && overlay.html.includes('<!doctype html>'));
check('overlay 含版本信息', overlay.html.includes(sys.core_version), sys.core_version);
check('overlay 含最近命令', overlay.html.includes('最近命令'));
check('overlay 含摘要卡片', overlay.html.includes('A · 目标 / 命令面') && overlay.html.includes('C · 门禁 / 降级'));
check('overlay 不宣布交付（UI 判定）', overlay.ui_may_declare_delivered === false);
check('overlay 门禁不可调用', overlay.gate_callable === false);

// 9. 持久化指纹
const { stableStringify } = await import('@corsj/core');
const storeA = new SessionStore({ sessionsDir, stringify: stableStringify });
const storeB = new SessionStore({ sessionsDir, stringify: (x) => JSON.stringify(x) });
const recs = [{ type: 'model', at: new Date().toISOString(), model: { core_version: '0.1.0' } }];
const saved = await storeA.save('fp-test', '0.1.0', recs);
check('持久化写入 .jsonl.zstd', saved.path.endsWith('.jsonl.zstd'), saved.path);
const loaded = await storeA.load('fp-test');
check('持久化读取 + 指纹一致', loaded.fingerprint === saved.fingerprint, loaded.fingerprint);
let tampered = false;
try {
  await storeB.load('fp-test');
} catch (err) {
  tampered = err instanceof PersistenceFingerprintError;
}
check('持久化指纹篡改可检出（env_error）', tampered);

// 10. 渲染器不 import core（检测真实 import 语句，注释提及不算）
const clientSrc = await import('node:fs').then((f) => f.readFileSync(join(dist, 'client.js'), 'utf8'));
const coreImportPattern = /(from\s+['"]@corsj\/core['"]|import\s*\(\s*['"]@corsj\/core['"]|require\s*\(\s*['"]@corsj\/core['"])/;
check('渲染器（client.js）不 import @corsj/core', !coreImportPattern.test(clientSrc));

// 汇总
const failed = results.filter((r) => !r.ok);
console.log('');
console.log('自检结果：' + (failed.length === 0 ? '全部通过' : '存在失败 ' + failed.length + ' 项'));
if (failed.length > 0) {
  for (const f of failed) console.log('  失败：' + f.name + ' — ' + f.detail);
  process.exit(1);
}

function demoNetlist() {
  return {
    components: [
      { ref: 'U1', value: 'MCU', footprint: 'TQFP-32', pins: { VDD: { type: 'power_in', name: 'VDD' }, VSS: { type: 'power_in', name: 'VSS' }, OUT: { type: 'output' } } },
      { ref: 'R1', value: '10k', footprint: '0603', pins: { '1': { type: 'passive' }, '2': { type: 'passive' } } },
    ],
    nets: [
      { name: 'VCC', nodes: [{ ref: 'U1', pin: 'VDD' }, { ref: 'R1', pin: '1' }] },
      { name: 'GND', nodes: [{ ref: 'U1', pin: 'VSS' }] },
      { name: 'OUT', nodes: [{ ref: 'U1', pin: 'OUT' }, { ref: 'R1', pin: '2' }] },
    ],
  };
}
function demoEnergy() {
  return {
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
  };
}
