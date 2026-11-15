/**
 * corsj-app — 渲染器逻辑（A/B/C 三区联动工作台）。
 * 仅通过 window.corsj（preload 白名单）与主进程通信；浏览器脚本，无 ES module 导入。
 */
const corsj = (window as any).corsj as {
  sysinfo(): Promise<Record<string, unknown>>;
  listCommands(): Promise<{ capability_id: string; embedded_level: string; core: boolean; description?: string }[]>;
  runStream(opts: unknown): Promise<unknown>;
  loadView(p: string): Promise<ViewResult>;
  importEop(p: string): Promise<ViewResult>;
  exportFormat(opts: unknown): Promise<unknown>;
  listArtifacts(p: string): Promise<ViewResult>;
  onEvent(cb: (ev: any) => void): () => void;
  modelProvider: { get(): Promise<unknown>; set(cfg: unknown): Promise<unknown> };
};

interface ViewResult {
  groups: { object_type: string; nodes: { id: string; object_type: string; title?: string; payloads: { path: string; role?: string; media_type: string }[] }[] }[];
  evidence: unknown[];
  fingerprint: string;
  integrity: { ok: boolean; errors?: string[] };
  payload_count: number;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
let unsubscribe: (() => void) | null = null;
let currentPackagePath = '';
let roundCount = 0;
const maxRounds = 10;

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c] ?? c));
}

function badge(text: string, cls: string): string {
  return '<span class="badge ' + cls + '">' + escapeHtml(text) + '</span>';
}

async function init(): Promise<void> {
  const sys = await corsj.sysinfo();
  $('#sys-meta').textContent =
    'core ' + sys.core_version + ' · 命令 ' + sys.commands_total + ' · 注册表 ' + (sys.registry_ok ? '正常' : '异常') + ' · 模型供应商 ' + (sys.model_provider_configured ? '已配置' : '未配置');
  const cmds = await corsj.listCommands();
  const list = $('#cmdlist');
  list.innerHTML = '';
  for (const c of cmds) {
    const div = document.createElement('div');
    div.className = 'cmd';
    div.innerHTML = '<span class="lvl">' + c.embedded_level + (c.core ? ' ·核心' : ' ·扩展') + '</span>' +
      '<span class="id">' + escapeHtml(c.capability_id) + '</span>';
    div.title = c.description ?? '';
    list.append(div);
  }
  unsubscribe = corsj.onEvent(handleEvent);
}

function handleEvent(ev: any): void {
  if (!ev || !ev.type) return;
  if (ev.type === 'phase') {
    appendTimeline(ev.state, ev.reason + (ev.errors && ev.errors.length ? '（' + ev.errors.length + ' 错误）' : ''), ev.errors && ev.errors.length ? 'err' : 'ok');
    setRunState('阶段：' + ev.state);
  } else if (ev.type === 'round') {
    roundCount += 1;
    renderProgress(ev.round?.verdict?.decision === 'delivered' ? 'DELIVERED' : 'RUNNING', roundCount, maxRounds);
    const r = ev.round;
    if (r) {
      appendTimeline('第 ' + r.round + ' 轮门禁', r.verdict?.code ?? '', r.verdict?.decision === 'delivered' ? 'ok' : 'warn');
      renderGate(r.verdict);
      renderDegradation(r.degradation ?? []);
    }
  } else if (ev.type === 'done') {
    setRunState('完成：' + ev.state);
    renderProgress(ev.state, roundCount, maxRounds);
    currentPackagePath = ev.package_path ?? '';
    if (ev.view) renderView(ev.view);
    if (ev.state === 'DELIVERED') appendTimeline('交付', '包 ' + currentPackagePath, 'ok');
  }
}

function appendTimeline(title: string, detail: string, cls: string): void {
  const tl = $('#timeline');
  const ph = document.createElement('div');
  ph.className = 'phase ' + cls;
  ph.innerHTML = '<div class="ph-title">' + escapeHtml(title) + badge(cls === 'ok' ? '通过' : cls === 'err' ? '失败' : '进行', cls) + '</div>' +
    '<div class="ph-detail">' + escapeHtml(detail) + '</div>';
  tl.append(ph);
  tl.scrollTop = tl.scrollHeight;
}

function setRunState(text: string): void { $('#run-state').textContent = text; }

function renderProgress(state: string, round: number, max: number): void {
  const pct = max > 0 ? Math.min(100, Math.round((round / max) * 100)) : 0;
  $('#progress-fill').style.width = pct + '%';
  $('#progress-text').textContent = state + ' · 轮次 ' + round + '/' + max + ' · ' + pct + '%';
}

function renderGate(verdict: any): void {
  const g = $('#gate-verdict');
  if (!verdict) return;
  const ok = verdict.decision === 'delivered';
  g.innerHTML = '<div class="g-decision" style="color:var(--' + (ok ? 'ok' : 'err') + ')">' +
    (ok ? '已交付 DELIVERED' : '未交付 ' + (verdict.decision ?? '-')) + '</div>' +
    '<div class="g-detail">' + escapeHtml(verdict.message ?? '') + '</div>';
}

function renderDegradation(list: any[]): void {
  const box = $('#degradation');
  box.innerHTML = '';
  if (!list || list.length === 0) { box.innerHTML = '<span class="dim">无降级项</span>'; return; }
  for (const d of list) {
    const row = document.createElement('div');
    row.className = 'deg';
    row.innerHTML = '<span class="oid">' + escapeHtml(d.command ?? '?') + '</span> ' + escapeHtml(d.reason ?? '');
    box.append(row);
  }
}

function renderView(view: ViewResult): void {
  const tree = $('#objtree');
  tree.innerHTML = '';
  if (!view || !view.groups) { tree.innerHTML = '<span class="dim">无对象</span>'; return; }
  for (const grp of view.groups) {
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.innerHTML = escapeHtml(grp.object_type) + ' <span class="dim">(' + grp.nodes.length + ')</span>';
    det.append(sum);
    for (const n of grp.nodes) {
      const row = document.createElement('div');
      row.innerHTML = '<span class="oid">' + escapeHtml(n.id) + '</span> ' + escapeHtml(n.title ?? '');
      det.append(row);
      for (const p of n.payloads) {
        const pl = document.createElement('div');
        pl.className = 'payload';
        pl.textContent = '· ' + (p.role ?? '') + ' ' + p.path;
        det.append(pl);
      }
    }
    tree.append(det);
  }
}

async function runStream(): Promise<void> {
  const btn = $('#btn-run') as HTMLButtonElement;
  const goal = ($('#goal') as HTMLTextAreaElement).value.trim();
  if (!goal) { setRunState('请先输入设计目标'); return; }
  btn.disabled = true;
  roundCount = 0;
  $('#timeline').innerHTML = '';
  $('#gate-verdict').innerHTML = '<div class="g-decision">—</div><div class="g-detail">运行中…</div>';
  setRunState('运行中…');
  renderProgress('RUNNING', 0, maxRounds);
  try {
    await corsj.runStream({ goalText: goal, plan: defaultPlan(), authorization: { by: 'corsj-app-user', at: new Date().toISOString(), note: '用户在 corsj-app 中授权：缺失阈值使用保守默认值' } });
  } catch (err) {
    setRunState('运行失败');
    appendTimeline('异常', String((err as Error).stack ?? err), 'err');
  } finally {
    btn.disabled = false;
  }
}

async function importEop(): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.eop';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const view = await corsj.importEop(file.path);
      currentPackagePath = file.path;
      renderView(view);
      setRunState('已导入：' + file.name);
    } catch (err) {
      setRunState('导入失败：' + String(err));
    }
  };
  input.click();
}

async function exportFormat(): Promise<void> {
  if (!currentPackagePath) { setRunState('请先运行闭环或导入 .eop'); return; }
  const objectId = ($('#export-object') as HTMLInputElement).value.trim();
  const format = ($('#export-format') as HTMLSelectElement).value;
  try {
    const res = (await corsj.exportFormat({ package_path: currentPackagePath, object_id: objectId, format })) as { status?: string };
    setRunState('已导出 ' + objectId + ' → ' + format + '（' + (res?.status ?? '?') + '）');
  } catch (err) {
    setRunState('导出失败：' + String(err));
  }
}

async function showConfig(): Promise<void> {
  const cur = (await corsj.modelProvider.get()) as { configured?: boolean; providers?: { name: string; base_url: string; model: string; api_key?: string }[] };
  const curProvider = cur.providers?.[0];
  const name = prompt('供应商名称（如 deepseek / openai）：', curProvider?.name ?? '');
  if (name === null) return;
  const base = prompt('API Base URL：', curProvider?.base_url ?? 'https://api.deepseek.com');
  if (base === null) return;
  const model = prompt('模型名：', curProvider?.model ?? 'deepseek-chat');
  if (model === null) return;
  const key = prompt('API Key（仅保存在本应用配置目录，不上传、不写入 .eop）：', '');
  if (key === null) return;
  await corsj.modelProvider.set({ configured: true, updated_at: new Date().toISOString(), providers: [{ name, base_url: base, model, api_key: key || undefined }] });
  const sys = await corsj.sysinfo();
  $('#sys-meta').textContent = 'core ' + sys.core_version + ' · 命令 ' + sys.commands_total + ' · 模型供应商已配置';
}

/** 七步闭环默认计划（与 core 自检用例一致）。 */
function defaultPlan(): unknown {
  return [{
    design: [{ command: 'geometry.generate', params: { primitive: { kind: 'box', x: 100, y: 50, z: 20 }, name: 'Bracket', unit: 'mm' } }],
    validation: [
      { command: 'geometry.validity_check', params: { object_id: 'Bracket' } },
      { command: 'fea.static', params: { size_m: [0.1, 0.05, 0.02], divisions: [4, 4, 3], material: { E: 70e9, nu: 0.33 }, load: { face: 'z1', pressure: 1.5e6 }, constraint: { face: 'z0', fix: [true, true, true] } } },
      { command: 'eda.schematic_erc', params: { netlist: demoNetlist() } },
      { command: 'energy.closure_sim', params: { model: demoEnergy() } },
      { command: 'export.standard_format', params: { object_id: 'Bracket', format: 'json' } },
    ],
    optional: [],
  }];
}

function demoNetlist(): unknown {
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

function demoEnergy(): unknown {
  return {
    components: [{ name: 'MCU', p_rated: 2, duty: 1 }, { name: 'Radio', p_rated: 5, duty: 0.6 }, { name: 'Sensor', p_rated: 1, duty: 0.5 }],
    storage_capacity: 33 * 3600, storage_initial: 33 * 3600, charge_power: 0, duration: 1800, dt: 60,
  };
}

$('#btn-run').addEventListener('click', () => { void runStream(); });
$('#btn-config').addEventListener('click', () => { void showConfig(); });
$('#btn-import').addEventListener('click', () => { void importEop(); });
$('#btn-export').addEventListener('click', () => { void exportFormat(); });

void init();
