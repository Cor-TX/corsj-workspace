/**
 * @corsj/core — 通用量纲 schema 与单位表（唯一权威）。
 *
 * 验收校验一律以本文件定义的量纲与单位为准；A 层只产出带量纲的数据，
 * 不做阈值判定；B 层依据本表对 AcceptanceSpec 阈值与验证器输出做量纲一致性校验。
 */

/** 基本量纲索引。 */
export const BASE_DIMENSIONS = ['L', 'M', 'T', 'I', 'Θ', 'N', 'J'] as const;
export type BaseDimension = (typeof BASE_DIMENSIONS)[number];

/** 量纲向量：各基本量纲的整数幂（长度与 BASE_DIMENSIONS 一致，默认全 0）。 */
export type DimensionVector = number[];

/** 空量纲（无量纲）。 */
export const DIMENSIONLESS: DimensionVector = [0, 0, 0, 0, 0, 0, 0];

function dims(partial: Partial<Record<BaseDimension, number>>): DimensionVector {
  const byName: Record<BaseDimension, number> = { L: 0, M: 0, T: 0, I: 0, 'Θ': 0, N: 0, J: 0 };
  for (const k of Object.keys(partial) as BaseDimension[]) byName[k] = partial[k] ?? 0;
  return BASE_DIMENSIONS.map((k) => byName[k]);
}

/** 常用量纲的构造器。 */
export const DIM = {
  dimensionless: DIMENSIONLESS,
  length: dims({ L: 1 }),
  area: dims({ L: 2 }),
  volume: dims({ L: 3 }),
  mass: dims({ M: 1 }),
  density: dims({ L: -3, M: 1 }),
  time: dims({ T: 1 }),
  frequency: dims({ T: -1 }),
  velocity: dims({ L: 1, T: -1 }),
  acceleration: dims({ L: 1, T: -2 }),
  force: dims({ L: 1, M: 1, T: -2 }),
  moment: dims({ L: 2, M: 1, T: -2 }),
  pressure: dims({ L: -1, M: 1, T: -2 }),
  stress: dims({ L: -1, M: 1, T: -2 }),
  energy: dims({ L: 2, M: 1, T: -2 }),
  power: dims({ L: 2, M: 1, T: -3 }),
  temperature: dims({ 'Θ': 1 }),
  thermal_conductivity: dims({ L: 1, M: 1, T: -3, 'Θ': -1 }),
  heat_flux: dims({ M: 1, T: -3 }),
  current: dims({ I: 1 }),
  voltage: dims({ L: 2, M: 1, T: -3, I: -1 }),
  resistance: dims({ L: 2, M: 1, T: -3, I: -2 }),
  capacitance: dims({ L: -2, M: -1, T: 4, I: 2 }),
  inductance: dims({ L: 2, M: 1, T: -2, I: -2 }),
  charge: dims({ I: 1, T: 1 }),
  power_flux_density: dims({ M: 1, T: -3 }),
  data_rate: dims({ T: -1 }), // bit/s —— 量纲上按频率处理
  angle: DIMENSIONLESS,
  strain: DIMENSIONLESS,
  decibel: DIMENSIONLESS,
  count: DIMENSIONLESS,
} as const;
export type DimName = keyof typeof DIM;

/** 量纲代数。 */
export function mulDim(a: DimensionVector, b: DimensionVector): DimensionVector {
  return a.map((x, i) => x + b[i]);
}
export function divDim(a: DimensionVector, b: DimensionVector): DimensionVector {
  return a.map((x, i) => x - b[i]);
}
export function powDim(a: DimensionVector, p: number): DimensionVector {
  return a.map((x) => x * p);
}
export function sameDim(a: DimensionVector, b: DimensionVector): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
export function dimToString(v: DimensionVector): string {
  const parts: string[] = [];
  BASE_DIMENSIONS.forEach((k, i) => {
    const e = v[i];
    if (e === 0) return;
    parts.push(e === 1 ? k : `${k}^${e}`);
  });
  return parts.length ? parts.join('·') : '1';
}

/** SI 前缀。 */
export const SI_PREFIXES: Record<string, number> = {
  '': 1, m: 1e-3, u: 1e-6, µ: 1e-6, n: 1e-9, p: 1e-12, k: 1e3, M: 1e6, G: 1e9, T: 1e12, mili: 1e-3,
};

export interface UnitDef {
  /** 单位符号，如 mm、MPa、kW。 */
  symbol: string;
  quantity: DimName;
  /** 换算到 SI 基准单位（如 m、Pa、W、K）的因子。 */
  toSI: number;
  /** SI 基准单位符号。 */
  siBase: string;
  /** 是否允许出现负值（如温度差、位移允许负，质量不允许）。 */
  allowNegative?: boolean;
}

/**
 * 单位表：验收校验的唯一权威。核心命令产出的所有物理量
 * 必须使用本表中的单位（或带 SI 前缀的变体）。
 */
export const UNITS: readonly UnitDef[] = [
  // 长度 / 几何
  { symbol: 'm', quantity: 'length', toSI: 1, siBase: 'm' },
  { symbol: 'mm', quantity: 'length', toSI: 1e-3, siBase: 'm' },
  { symbol: 'cm', quantity: 'length', toSI: 1e-2, siBase: 'm' },
  { symbol: 'km', quantity: 'length', toSI: 1e3, siBase: 'm' },
  { symbol: 'in', quantity: 'length', toSI: 0.0254, siBase: 'm' },
  { symbol: 'm2', quantity: 'area', toSI: 1, siBase: 'm2' },
  { symbol: 'mm2', quantity: 'area', toSI: 1e-6, siBase: 'm2' },
  { symbol: 'm3', quantity: 'volume', toSI: 1, siBase: 'm3' },
  { symbol: 'mm3', quantity: 'volume', toSI: 1e-9, siBase: 'm3' },
  { symbol: 'L', quantity: 'volume', toSI: 1e-3, siBase: 'm3' },
  { symbol: 'deg', quantity: 'angle', toSI: Math.PI / 180, siBase: 'rad' },
  { symbol: 'rad', quantity: 'angle', toSI: 1, siBase: 'rad' },
  // 质量 / 力学
  { symbol: 'kg', quantity: 'mass', toSI: 1, siBase: 'kg' },
  { symbol: 'g', quantity: 'mass', toSI: 1e-3, siBase: 'kg' },
  { symbol: 't', quantity: 'mass', toSI: 1e3, siBase: 'kg' },
  { symbol: 'N', quantity: 'force', toSI: 1, siBase: 'N' },
  { symbol: 'kN', quantity: 'force', toSI: 1e3, siBase: 'N' },
  { symbol: 'Pa', quantity: 'pressure', toSI: 1, siBase: 'Pa' },
  { symbol: 'kPa', quantity: 'pressure', toSI: 1e3, siBase: 'Pa' },
  { symbol: 'MPa', quantity: 'pressure', toSI: 1e6, siBase: 'Pa' },
  { symbol: 'GPa', quantity: 'pressure', toSI: 1e9, siBase: 'Pa' },
  { symbol: 'bar', quantity: 'pressure', toSI: 1e5, siBase: 'Pa' },
  { symbol: 'atm', quantity: 'pressure', toSI: 101325, siBase: 'Pa' },
  { symbol: 'J', quantity: 'energy', toSI: 1, siBase: 'J' },
  { symbol: 'kJ', quantity: 'energy', toSI: 1e3, siBase: 'J' },
  { symbol: 'Wh', quantity: 'energy', toSI: 3600, siBase: 'J' },
  { symbol: 'kWh', quantity: 'energy', toSI: 3.6e6, siBase: 'J' },
  { symbol: 'W', quantity: 'power', toSI: 1, siBase: 'W' },
  { symbol: 'kW', quantity: 'power', toSI: 1e3, siBase: 'W' },
  { symbol: 'MW', quantity: 'power', toSI: 1e6, siBase: 'W' },
  { symbol: 'mW', quantity: 'power', toSI: 1e-3, siBase: 'W' },
  { symbol: 'K', quantity: 'temperature', toSI: 1, siBase: 'K', allowNegative: false },
  { symbol: 'degC', quantity: 'temperature', toSI: 1, siBase: 'K', allowNegative: true },
  { symbol: 'degF', quantity: 'temperature', toSI: 5 / 9, siBase: 'K', allowNegative: true },
  { symbol: 'W/mK', quantity: 'thermal_conductivity', toSI: 1, siBase: 'W/(m·K)' },
  { symbol: 'W/m2', quantity: 'heat_flux', toSI: 1, siBase: 'W/m2' },
  { symbol: 'kg/m3', quantity: 'density', toSI: 1, siBase: 'kg/m3' },
  { symbol: 'g/cm3', quantity: 'density', toSI: 1e3, siBase: 'kg/m3' },
  { symbol: 'm/s', quantity: 'velocity', toSI: 1, siBase: 'm/s' },
  { symbol: 'mm/s', quantity: 'velocity', toSI: 1e-3, siBase: 'm/s' },
  { symbol: 'km/h', quantity: 'velocity', toSI: 1 / 3.6, siBase: 'm/s' },
  { symbol: 'm/s2', quantity: 'acceleration', toSI: 1, siBase: 'm/s2' },
  { symbol: 'g0', quantity: 'acceleration', toSI: 9.80665, siBase: 'm/s2' },
  { symbol: 'N*m', quantity: 'moment', toSI: 1, siBase: 'N·m' },
  { symbol: 'Hz', quantity: 'frequency', toSI: 1, siBase: 'Hz' },
  { symbol: 'kHz', quantity: 'frequency', toSI: 1e3, siBase: 'Hz' },
  { symbol: 'MHz', quantity: 'frequency', toSI: 1e6, siBase: 'Hz' },
  { symbol: 'GHz', quantity: 'frequency', toSI: 1e9, siBase: 'Hz' },
  { symbol: 's', quantity: 'time', toSI: 1, siBase: 's' },
  { symbol: 'ms', quantity: 'time', toSI: 1e-3, siBase: 's' },
  { symbol: 'min', quantity: 'time', toSI: 60, siBase: 's' },
  { symbol: 'h', quantity: 'time', toSI: 3600, siBase: 's' },
  // 电学
  { symbol: 'A', quantity: 'current', toSI: 1, siBase: 'A' },
  { symbol: 'mA', quantity: 'current', toSI: 1e-3, siBase: 'A' },
  { symbol: 'V', quantity: 'voltage', toSI: 1, siBase: 'V' },
  { symbol: 'mV', quantity: 'voltage', toSI: 1e-3, siBase: 'V' },
  { symbol: 'ohm', quantity: 'resistance', toSI: 1, siBase: 'Ω' },
  { symbol: 'F', quantity: 'capacitance', toSI: 1, siBase: 'F' },
  { symbol: 'uF', quantity: 'capacitance', toSI: 1e-6, siBase: 'F' },
  { symbol: 'H', quantity: 'inductance', toSI: 1, siBase: 'H' },
  { symbol: 'C', quantity: 'charge', toSI: 1, siBase: 'C' },
  { symbol: 'Ah', quantity: 'charge', toSI: 3600, siBase: 'C' },
  { symbol: 'mAh', quantity: 'charge', toSI: 3.6, siBase: 'C' },
  { symbol: 'W/m2', quantity: 'power_flux_density', toSI: 1, siBase: 'W/m2' },
  // 通信 / 数据
  { symbol: 'bit/s', quantity: 'data_rate', toSI: 1, siBase: 'bit/s' },
  { symbol: 'kbit/s', quantity: 'data_rate', toSI: 1e3, siBase: 'bit/s' },
  { symbol: 'Mbit/s', quantity: 'data_rate', toSI: 1e6, siBase: 'bit/s' },
  { symbol: 'Gbit/s', quantity: 'data_rate', toSI: 1e9, siBase: 'bit/s' },
  { symbol: 'dB', quantity: 'decibel', toSI: 1, siBase: 'dB' },
  // 无量纲
  { symbol: '1', quantity: 'dimensionless', toSI: 1, siBase: '1' },
  { symbol: '%', quantity: 'dimensionless', toSI: 0.01, siBase: '1' },
  { symbol: 'count', quantity: 'count', toSI: 1, siBase: 'count' },
];

const bySymbol = new Map(UNITS.map((u) => [u.symbol, u]));

/** 按符号查单位；支持「数值 + 前缀」组合（如 mm2 → m2 × 1e-6 不可自动展开，故仅做精确匹配与基本前缀）。 */
export function findUnit(symbol: string): UnitDef | undefined {
  return bySymbol.get(symbol);
}

/** 断言单位存在且量纲正确；验收校验用。 */
export function requireUnit(symbol: string, quantity?: DimName): UnitDef {
  const u = findUnit(symbol);
  if (!u) throw new Error(`未知单位: ${symbol}（见 core/model/units.ts 单位表）`);
  if (quantity && DIM[u.quantity] === undefined) throw new Error(`单位 ${symbol} 的量纲未定义`);
  if (quantity && u.quantity !== quantity) {
    throw new Error(`单位 ${symbol} 量纲为 ${u.quantity}，期望 ${quantity}`);
  }
  return u;
}

export interface QuantityValue {
  value: number;
  unit: string;
}

/** 把带单位的量换算为 SI 基准值。 */
export function toSI(q: QuantityValue): number {
  const u = requireUnit(q.unit);
  return q.value * u.toSI;
}

/** 校验带单位数值的合法性（有限数、单位存在、负值许可）。 */
export function validateQuantity(q: QuantityValue): { ok: boolean; error?: string } {
  if (typeof q.value !== 'number' || !Number.isFinite(q.value)) {
    return { ok: false, error: `数值非法: ${String(q.value)}` };
  }
  const u = findUnit(q.unit);
  if (!u) return { ok: false, error: `未知单位: ${q.unit}` };
  if (q.value < 0 && !u.allowNegative) {
    return { ok: false, error: `单位 ${u.symbol} 不允许负值，得到 ${q.value}` };
  }
  return { ok: true };
}

/** 两个带单位量是否同量纲（用于阈值校验）。 */
export function compatibleUnits(a: string, b: string): boolean {
  const ua = findUnit(a);
  const ub = findUnit(b);
  if (!ua || !ub) return false;
  return sameDim(DIM[ua.quantity], DIM[ub.quantity]);
}
