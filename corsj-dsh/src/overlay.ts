/**
 * @corsj/dsh — shell.overlay 全屏面板渲染（阶段二）。
 *
 * 职责边界（与 @corsj/core 的 ui-contract 同源）：
 * - 只读展示：A 区（目标 / 命令面）· B 区（迭代轮次 / 最近命令）· C 区（门禁 / 降级）；
 * - 门禁结论直接取自 B 层回传的 verdict，唯一权威仍是 core 的 delivery_gate.submit；
 *   本文件不做任何判定、不生成 passed/failed、不重算阈值、不阻断流程；
 * - UI 不能宣布交付：ui_may_declare_delivered 恒为 false；
 * - 输出自包含（内联 CSS、无外部资源、无脚本），可在 DSH overlay 沙箱内直接渲染。
 */

/** 单条阈值比对结果（只读展示；判定由 B 层完成）。 */
export interface OverlayThreshold {
  field: string;
  op: string;
  expected: string;
  actual: string;
  passed: boolean;
  note?: string;
}

/** 单个验证项的门禁结果（来自 verdict.per_validator）。 */
export interface OverlayValidatorOutcome {
  validator_id: string;
  command: string;
  strength: 'REQUIRED' | 'optional';
  passed: boolean;
  degraded: boolean;
  evidence_present: boolean;
  detail: string;
  thresholds: OverlayThreshold[];
}

/** 降级记录（core design/degradation）。 */
export interface OverlayDegradation {
  id: string;
  command: string;
  kind: string;
  reason: string;
  affected_validators: string[];
  at: string;
}

/** 门禁判定计数汇总。 */
export interface OverlayGateSummary {
  required_total: number;
  required_passed: number;
  required_failed: number;
  optional_total: number;
  optional_passed: number;
  degraded_count: number;
  cannot_verify: number;
}

/** 门禁 verdict（唯一交付权威：delivery_gate.submit）。 */
export interface OverlayGate {
  decision: 'delivered' | 'rejected';
  code: string;
  branch?: string;
  message: string;
  signature: string;
  generated_at: string;
  summary: OverlayGateSummary;
}

/** 结构化补充请求（REQUIRED 缺阈值时由 B 层产生）。 */
export interface OverlayClarification {
  id: string;
  validator_id: string;
  question: string;
  status: string;
}

/** A 区：目标 + 命令面 + 补充请求。 */
export interface OverlayRegionA {
  goal_summary: string;
  core_version: string;
  registry_ok: boolean;
  registry_errors: string[];
  counts: { total: number; core: number; extension: number };
  clarifications: OverlayClarification[];
}

/** 状态迁移时间线条目。 */
export interface OverlayTimelineEntry {
  from: string;
  to: string;
  at: string;
  reason: string;
}

/** 单轮迭代摘要。 */
export interface OverlayRoundSummary {
  round: number;
  design: number;
  validation: number;
  decision?: string;
  code?: string;
  degraded: number;
}

/** 最近命令条目。 */
export interface OverlayRecentEntry {
  command: string;
  status: string;
  at: string;
}

/** B 区：迭代观察（状态 / 轮次 / 最近命令）。 */
export interface OverlayRegionB {
  state: string;
  round: number;
  max_rounds: number;
  env_retries: number;
  timeline: OverlayTimelineEntry[];
  rounds: OverlayRoundSummary[];
  recent: OverlayRecentEntry[];
}

/** C 区：门禁 + 降级（只读）。 */
export interface OverlayRegionC {
  delivered: boolean;
  gate?: OverlayGate;
  required: OverlayValidatorOutcome[];
  optional: OverlayValidatorOutcome[];
  degradation: OverlayDegradation[];
  package_path?: string;
  package_fingerprint?: string;
}

/** shell.overlay 一次渲染所需的完整视图。 */
export interface OverlayView {
  generated_at: string;
  gate_authority: string;
  ui_may_declare_delivered: false;
  region_a: OverlayRegionA;
  region_b: OverlayRegionB;
  region_c: OverlayRegionC;
}

/** 渲染回执（交给 DSH overlay 的直接产物）。 */
export interface OverlayDocument {
  content_type: 'text/html; charset=utf-8';
  html: string;
  byte_length: number;
  generated_at: string;
  gate_authority: string;
  ui_may_declare_delivered: false;
}

// ---------------------------------------------------------------------------
// 渲染工具
// ---------------------------------------------------------------------------

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML 转义：overlay 内容含用户目标原文与命令回执，一律转义后再拼。 */
function esc(v: unknown): string {
  const s = typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
  return s.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** 截断长文本（目标原文可能很长），保留尾部省略号。 */
function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** 状态文本颜色类。 */
function tone(status: string): 'g' | 'r' | 'y' {
  if (status === 'success') return 'g';
  if (status === 'design_error' || status === 'env_error' || status === 'refused') return 'r';
  return 'y';
}

function badge(text: string, cls: 'ok' | 'err' | 'warn'): string {
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}

function kv(label: string, valueHtml: string): string {
  return `<div class="kv"><span class="dim">${esc(label)}</span><b>${valueHtml}</b></div>`;
}

function table(headers: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) return `<div class="empty">${esc(empty)}</div>`;
  return (
    `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
    rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') +
    '</tbody></table>'
  );
}

/** 验证项块（含阈值明细；阈值只展示，不重算）。 */
function validatorBlock(v: OverlayValidatorOutcome): string {
  const cls: 'ok' | 'err' | 'warn' = v.passed ? 'ok' : v.degraded ? 'warn' : 'err';
  const label = v.passed ? '通过' : v.degraded ? '降级' : '未通过';
  const th = v.thresholds
    .map(
      (t) =>
        `<div class="th ${t.passed ? 'g' : 'r'}">${esc(t.field)} ${esc(t.op)} ${esc(t.expected)} → 实测 ${esc(t.actual)}` +
        `${t.note ? `（${esc(t.note)}）` : ''}</div>`,
    )
    .join('');
  return (
    '<div class="val">' +
    `<div class="val-h"><code>${esc(v.validator_id)}</code>${badge(label, cls)}</div>` +
    `<div class="dim">${esc(v.command)} · 证据 ${v.evidence_present ? '有' : '无'}</div>` +
    (v.detail ? `<div class="dim">${esc(v.detail)}</div>` : '') +
    th +
    '</div>'
  );
}

const STYLE = `
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:#0d1117;color:#dce3ec;font:13px/1.55 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}
header{position:sticky;top:0;z-index:2;background:linear-gradient(180deg,#121a24,#0d1117);border-bottom:1px solid #222c3a;padding:14px 20px}
h1{margin:0;font-size:16px;color:#4da3ff;letter-spacing:.3px}
.meta{color:#8a97a8;font-size:12px;margin-top:4px}
.banner{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:14px 20px;padding:14px 18px;border-radius:10px;border:1px solid #222c3a;background:#121a24}
.decision{font-size:21px;font-weight:700}
.banner .grow{flex:1 1 auto;min-width:0}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:0 20px 24px}
@media(max-width:1100px){.grid{grid-template-columns:1fr}}
section{background:#111823;border:1px solid #222c3a;border-radius:10px;padding:14px;min-width:0}
h2{margin:0 0 10px;font-size:12px;color:#9fb2c8;text-transform:uppercase;letter-spacing:.8px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:5px 6px;border-bottom:1px solid #1d2633;text-align:left;vertical-align:top;word-break:break-word}
th{color:#8a97a8;font-weight:600}
.empty{color:#66748a;font-size:12px;padding:6px 0}
.badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;border:1px solid;white-space:nowrap}
.badge.ok{color:#4cc38a;border-color:#20573c;background:#12241b}
.badge.err{color:#e5646c;border-color:#5b2630;background:#241316}
.badge.warn{color:#e0a24c;border-color:#5a4520;background:#241f12}
.dim{color:#8a97a8}
.g{color:#4cc38a}.r{color:#e5646c}.y{color:#e0a24c}
.kv{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:3px 0;border-bottom:1px solid #1a2330}
.kv b{font-weight:600;text-align:right}
.goal{background:#0c141d;border:1px solid #1d2633;border-radius:8px;padding:8px;margin-bottom:10px;max-height:130px;overflow:auto;font-size:12px}
.val{border:1px solid #1d2633;border-radius:8px;padding:8px;margin-bottom:8px;background:#0e151f}
.val-h{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:4px}
.th{font-size:11px;font-family:ui-monospace,Consolas,monospace;margin-top:3px}
code{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#a8c7e8}
.sig{font-family:ui-monospace,Consolas,monospace;font-size:10px;color:#66748a;word-break:break-all}
.foot{padding:0 20px 22px;color:#66748a;font-size:11px}
`;

/**
 * 渲染 shell.overlay 全屏 HTML（A/B/C 三区摘要 + 门禁 verdict + 降级记录）。
 * 纯函数：不读文件、不联网、不判定。
 */
export function renderOverlayHtml(view: OverlayView): string {
  const a = view.region_a;
  const b = view.region_b;
  const c = view.region_c;
  const gate = c.gate;
  const delivered = c.delivered;

  const toneCls = delivered ? 'g' : gate ? 'r' : 'y';
  const headline = gate ? (delivered ? '已交付 DELIVERED' : '未交付 REJECTED') : '尚未运行门禁';
  const summary = gate
    ? `REQUIRED ${gate.summary.required_passed}/${gate.summary.required_total} · ` +
      `optional ${gate.summary.optional_passed}/${gate.summary.optional_total} · ` +
      `降级 ${gate.summary.degraded_count} · 无法验证 ${gate.summary.cannot_verify}`
    : '等待 B 层 delivery_gate.submit 回传结论（UI 不产生交付结论）';

  // A 区
  const clarifications = table(
    ['验证项', '问题', '状态'],
    a.clarifications.map((q) => [esc(q.validator_id), esc(clip(q.question, 160)), esc(q.status)]),
    '无未决补充请求',
  );
  const regionA =
    '<section><h2>A · 目标 / 命令面</h2>' +
    kv('core 版本', esc(a.core_version || '未加载')) +
    kv('命令面', `${a.counts.total} <span class="dim">（核心 ${a.counts.core} / 扩展 ${a.counts.extension}）</span>`) +
    kv('注册表', badge(a.registry_ok ? '正常' : '异常', a.registry_ok ? 'ok' : 'err')) +
    (a.registry_errors.length
      ? `<div class="th r">${esc(clip(a.registry_errors.slice(0, 3).join('；'), 220))}</div>`
      : '') +
    `<div class="goal">${a.goal_summary ? esc(clip(a.goal_summary, 400)) : '<span class="dim">尚未提交设计目标</span>'}</div>` +
    `<div class="dim" style="margin-bottom:6px">结构化补充请求（${a.clarifications.length}）</div>` +
    clarifications +
    '</section>';

  // B 区
  const timeline = table(
    ['阶段', '原因', '时间'],
    b.timeline.map((t) => [
      `<code>${esc(t.from)}</code> → <code>${esc(t.to)}</code>`,
      esc(clip(t.reason, 120)),
      `<span class="dim">${esc(t.at)}</span>`,
    ]),
    '暂无状态迁移',
  );
  const rounds = table(
    ['轮次', '设计/验证', '门禁', '降级'],
    b.rounds.map((r) => [
      `#${r.round}`,
      `${r.design} / ${r.validation}`,
      r.decision
        ? badge(r.decision === 'delivered' ? '通过' : '拒绝', r.decision === 'delivered' ? 'ok' : 'err') +
          (r.code ? ` <span class="dim">${esc(r.code)}</span>` : '')
        : '<span class="dim">—</span>',
      String(r.degraded),
    ]),
    '暂无轮次记录',
  );
  const recent = table(
    ['时间', '命令', '状态'],
    b.recent.map((e) => [
      `<span class="dim">${esc(e.at)}</span>`,
      `<code>${esc(e.command)}</code>`,
      `<span class="${tone(e.status)}">${esc(e.status)}</span>`,
    ]),
    '暂无执行记录',
  );
  const regionB =
    '<section><h2>B · 迭代观察</h2>' +
    kv('设计状态', `<span class="${delivered ? 'g' : 'y'}">${esc(b.state)}</span>`) +
    kv('轮次', `${b.round} / ${b.max_rounds}`) +
    kv('env_error 重试', String(b.env_retries)) +
    `<div class="dim" style="margin:8px 0 4px">状态时间线（${b.timeline.length}）</div>` +
    timeline +
    `<div class="dim" style="margin:8px 0 4px">轮次（${b.rounds.length}）</div>` +
    rounds +
    `<div class="dim" style="margin:8px 0 4px">最近命令（${b.recent.length}）</div>` +
    recent +
    '</section>';

  // C 区
  const gateBlock = gate
    ? kv('判定', badge(gate.decision === 'delivered' ? 'delivered' : 'rejected', gate.decision === 'delivered' ? 'ok' : 'err')) +
      kv('code', `<code>${esc(gate.code)}</code>`) +
      (gate.branch ? kv('分支', `<code>${esc(gate.branch)}</code>`) : '') +
      kv('生成时间', `<span class="dim">${esc(gate.generated_at)}</span>`) +
      `<div class="dim" style="margin:6px 0">${esc(gate.message)}</div>` +
      `<div class="sig">签名 ${esc(gate.signature)}</div>`
    : '<div class="empty">尚未运行门禁：无 verdict（UI 不产生交付结论）</div>';
  const degradation = table(
    ['命令', '类型', '原因', '影响验证项'],
    c.degradation.map((d) => [
      `<code>${esc(d.command)}</code>`,
      esc(d.kind),
      esc(clip(d.reason, 140)),
      d.affected_validators.length ? `<code>${esc(d.affected_validators.join(', '))}</code>` : '<span class="dim">—</span>',
    ]),
    '无降级记录',
  );
  const regionC =
    '<section><h2>C · 门禁 / 降级</h2>' +
    gateBlock +
    `<div class="dim" style="margin:10px 0 4px">REQUIRED 验证项（${c.required.length}）</div>` +
    (c.required.length ? c.required.map(validatorBlock).join('') : '<div class="empty">无 REQUIRED 验证项</div>') +
    `<div class="dim" style="margin:10px 0 4px">optional 验证项（${c.optional.length}）</div>` +
    (c.optional.length ? c.optional.map(validatorBlock).join('') : '<div class="empty">无 optional 验证项</div>') +
    `<div class="dim" style="margin:10px 0 4px">降级记录（${c.degradation.length}）</div>` +
    degradation +
    (c.package_path ? kv('交付包', `<code>${esc(c.package_path)}</code>`) : '') +
    (c.package_fingerprint ? `<div class="sig">包指纹 ${esc(c.package_fingerprint)}</div>` : '') +
    '</section>';

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>corsj 设计闭环 — DSH overlay</title>
<style>${STYLE}</style>
</head><body>
<header>
  <h1>corsj 设计闭环 · shell.overlay</h1>
  <div class="meta">core ${esc(a.core_version || '未加载')} · 注册表 ${a.registry_ok ? '正常' : '异常'} ·
  交付权威 ${esc(view.gate_authority)} · UI 可宣布交付：否 · 渲染于 ${esc(view.generated_at)}</div>
</header>
<div class="banner">
  <div class="decision ${toneCls}">${esc(headline)}</div>
  <div class="grow dim">${esc(summary)}</div>
</div>
<div class="grid">${regionA}${regionB}${regionC}</div>
<div class="foot">
  门禁状态为只读展示：交付结论只能由 core 的 delivery_gate.submit 产生，UI 与命令桥接均不能绕过。
  B 层不生成设计内容；模型推理由 DSH 全局模型承担，本插件不持有任何 API key。
</div>
</body></html>`;
}

/** 渲染并返回 overlay 文档回执（含 UTF-8 字节长度）。 */
export function renderOverlayDocument(view: OverlayView): OverlayDocument {
  const html = renderOverlayHtml(view);
  return {
    content_type: 'text/html; charset=utf-8',
    html,
    byte_length: Buffer.byteLength(html, 'utf8'),
    generated_at: view.generated_at,
    gate_authority: view.gate_authority,
    ui_may_declare_delivered: false,
  };
}
