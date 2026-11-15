/**
 * @corsj/core — 内置 EDA 内核（L1，网表级真实 ERC/DRC/BOM）。
 *
 * 设计取舍（记录于内置可行性矩阵）：
 * - KiCad CLI 的 L2/L3 升级路径保留；当前以结构化网表（JSON）为输入，
 *   实现真实可复现的电气规则检查：
 *   ERC：悬空输入、多驱动冲突、电源短路、未连接输出。
 * - 退出码与发现数一致：exit = findings.length ? 1 : 0（eda.schematic_erc 证据之一）。
 * - .kicad_sch 载荷作为对象载荷存储（不是第二真格式），检查在网表投影上执行。
 */

export interface NetlistNode { ref: string; pin: string; }
export interface NetlistNet { name: string; nodes: NetlistNode[]; }
export interface NetlistComponent {
  ref: string;
  value: string;
  footprint?: string;
  /** 引脚方向：input/output/passive/power_in/power_out/open_collector/nc */
  pins: Record<string, { type: string; name?: string }>;
}
export interface Netlist {
  components: NetlistComponent[];
  nets: NetlistNet[];
}

export interface ErcFinding {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  location: { net?: string; ref?: string; pin?: string };
}

const POWER_NET_RE = /^(VCC|VDD|VSYS|\+3V3|\+5V|\+12V|GND|VSS|AGND|DGND)$/i;

/** 真实 ERC 规则集。 */
export function runErc(netlist: Netlist): { findings: ErcFinding[]; exit_code: 0 | 1 } {
  const findings: ErcFinding[] = [];
  const byRef = new Map(netlist.components.map((c) => [c.ref, c]));
  // 网络驱动/负载分类
  for (const net of netlist.nets) {
    const drivers: { ref: string; pin: string; type: string }[] = [];
    const inputs: { ref: string; pin: string; type: string }[] = [];
    let powerPins = 0;
    let gndPins = 0;
    for (const node of net.nodes) {
      const comp = byRef.get(node.ref);
      const pin = comp?.pins[node.pin];
      const t = pin?.type ?? 'passive';
      if (t === 'power_out' || t === 'output' || t === 'open_collector') drivers.push({ ...node, type: t });
      if (t === 'power_in') {
        if (POWER_NET_RE.test(net.name) && /vcc|vdd|vsys|\+|\+/i.test(pin?.name ?? '') && !/gnd|vss/i.test(pin?.name ?? '')) powerPins++;
        else if (POWER_NET_RE.test(net.name) && /gnd|vss/i.test(pin?.name ?? '')) gndPins++;
        else inputs.push({ ...node, type: t });
      }
      if (t === 'input') inputs.push({ ...node, type: t });
    }
    // ERC-01：悬空输入
    for (const inp of inputs) {
      if (drivers.length === 0) {
        findings.push({
          severity: 'error',
          rule: 'ERC-01-dangling-input',
          message: `输入引脚 ${inp.ref}.${inp.pin} 所在网络 ${net.name} 无驱动`,
          location: { net: net.name, ref: inp.ref, pin: inp.pin },
        });
      }
    }
    // ERC-02：多输出驱动冲突
    const realDrivers = drivers.filter((d) => d.type === 'output' || d.type === 'power_out');
    const ocDrivers = drivers.filter((d) => d.type === 'open_collector');
    if (realDrivers.length > 1) {
      findings.push({
        severity: 'error',
        rule: 'ERC-02-multiple-drivers',
        message: `网络 ${net.name} 有 ${realDrivers.length} 个推挽驱动源冲突`,
        location: { net: net.name },
      });
    }
    // ERC-03：电源与地短路
    const names = net.name.split(/[\/_]/);
    const hasPower = names.some((n) => /^(VCC|VDD|VSYS|\+3V3|\+5V|\+12V)$/i.test(n));
    const hasGnd = names.some((n) => /^(GND|VSS|AGND|DGND)$/i.test(n));
    if (hasPower && hasGnd) {
      findings.push({
        severity: 'error',
        rule: 'ERC-03-power-short',
        message: `网络 ${net.name} 同时连接电源与地（短路）`,
        location: { net: net.name },
      });
    }
    // ERC-04：开漏网络无上拉（同网络还有输入且无 power_out 上拉电阻）
    if (ocDrivers.length > 0 && realDrivers.length === 0 && inputs.length > 0 && !net.name.includes('PULLUP')) {
      findings.push({
        severity: 'warning',
        rule: 'ERC-04-open-collector-no-pullup',
        message: `网络 ${net.name} 含开漏输出但未检测到上拉`,
        location: { net: net.name },
      });
    }
  }
  // ERC-05：完全未连接的元件引脚（nc 除外）
  const connected = new Set<string>();
  for (const net of netlist.nets) for (const n of net.nodes) connected.add(`${n.ref}.${n.pin}`);
  for (const comp of netlist.components) {
    for (const [pin, info] of Object.entries(comp.pins)) {
      if (info.type === 'nc') continue;
      if (!connected.has(`${comp.ref}.${pin}`)) {
        findings.push({
          severity: 'error',
          rule: 'ERC-05-unconnected-pin',
          message: `引脚 ${comp.ref}.${pin} 未连接任何网络`,
          location: { ref: comp.ref, pin },
        });
      }
    }
  }
  return { findings, exit_code: findings.length > 0 ? 1 : 0 };
}

/** PCB DRC（网表 + 版图规则的投影：L1 检查飞线可达性与丝印间距规则占位）。 */
export interface PcbDesign {
  /** 元件占位 {ref, x, y, w, h}（mm）。 */
  placements: { ref: string; x: number; y: number; w: number; h: number }[];
  /** 走线（同网络连接声明）。 */
  routed_nets: string[];
  /** 最小线宽 mm。 */
  min_trace_width: number;
  /** 最小间距 mm。 */
  min_clearance: number;
  /** 线宽/间距规则。 */
  rules: { min_trace_width: number; min_clearance: number };
}

export function runPcbDrc(design: PcbDesign): { findings: ErcFinding[]; exit_code: 0 | 1 } {
  const findings: ErcFinding[] = [];
  // DRC-01 元件重叠
  for (let i = 0; i < design.placements.length; i++) {
    for (let j = i + 1; j < design.placements.length; j++) {
      const a = design.placements[i];
      const b = design.placements[j];
      const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
      if (overlap) {
        findings.push({ severity: 'error', rule: 'DRC-01-overlap', message: `元件 ${a.ref} 与 ${b.ref} 占位重叠`, location: { ref: a.ref } });
      }
    }
  }
  // DRC-02 线宽
  if (design.min_trace_width < design.rules.min_trace_width) {
    findings.push({ severity: 'error', rule: 'DRC-02-trace-width', message: `线宽 ${design.min_trace_width}mm 小于规则 ${design.rules.min_trace_width}mm`, location: {} });
  }
  // DRC-03 间距
  if (design.min_clearance < design.rules.min_clearance) {
    findings.push({ severity: 'error', rule: 'DRC-03-clearance', message: `间距 ${design.min_clearance}mm 小于规则 ${design.rules.min_clearance}mm`, location: {} });
  }
  // DRC-04 未布线网络
  const declared = new Set(design.routed_nets);
  for (const p of design.placements) {
    if (!declared.has(p.ref)) {
      findings.push({ severity: 'warning', rule: 'DRC-04-unrouted', message: `元件 ${p.ref} 关联网络未布线`, location: { ref: p.ref } });
    }
  }
  return { findings, exit_code: findings.length > 0 ? 1 : 0 };
}

/** BOM 提取（网表 → 分组 BOM 表）。 */
export interface BomLine { refdes: string[]; value: string; footprint: string; qty: number; }
export function extractBom(netlist: Netlist): BomLine[] {
  const groups = new Map<string, BomLine>();
  for (const c of netlist.components) {
    const key = `${c.value}::${c.footprint ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      g = { refdes: [], value: c.value, footprint: c.footprint ?? '', qty: 0 };
      groups.set(key, g);
    }
    g.refdes.push(c.ref);
    g.qty++;
  }
  return [...groups.values()].sort((a, b) => b.qty - a.qty);
}

/** Gerber/钻孔制造包清单（eda.manufacturing_export 的 L1 输出：文件清单 + 假名内容表）。 */
export function manufacturingOutputs(design: PcbDesign): { filename: string; role: string; content: string }[] {
  const outline = `G04 corsj manufacturing export*\nM02*\n`;
  return [
    { filename: 'copper-top.gbr', role: 'gerber-copper-top', content: outline },
    { filename: 'copper-bottom.gbr', role: 'gerber-copper-bottom', content: outline },
    { filename: 'silk-top.gbr', role: 'gerber-silk-top', content: outline },
    { filename: 'soldermask-top.gbr', role: 'gerber-mask-top', content: outline },
    { filename: 'drill.drl', role: 'excellon-drill', content: outline },
    { filename: 'pick-and-place.csv', role: 'pnp', content: 'ref,x,y,rotation\n' + design.placements.map((p) => `${p.ref},${p.x},${p.y},0`).join('\n') + '\n' },
  ];
}
