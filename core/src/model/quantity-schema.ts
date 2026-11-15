/**
 * @corsj/core — 通用量纲化数值 schema。
 *
 * 工程数据（尺寸、应力、功率……）一律用 { value, unit } 表达，
 * 单位必须取自 core/model/units.ts 的单位表；验收校验以此为准。
 */
import { DIM, type DimName } from './units.js';

/** 带单位数值。 */
export interface Quantity {
  value: number;
  /** 单位符号，必须存在于 units.ts 单位表。 */
  unit: string;
}

/** 带单位的区间（阈值常用）。 */
export interface QuantityRange {
  min?: Quantity;
  max?: Quantity;
}

/** 带单位的时间序列（仿真输出常用）。 */
export interface QuantitySeries {
  /** 自变量（默认时间，单位 s）。 */
  independent: { name: string; unit: string; values: number[] };
  /** 因变量。 */
  dependent: { name: string; unit: string; values: number[] }[];
}

/** 关键尺寸（几何命令产出）。 */
export interface KeyDimension {
  name: string;
  quantity: Quantity;
  /** 测量位置/方向说明，如 "X 方向包围盒"。 */
  where?: string;
}

export function isQuantity(x: unknown): x is Quantity {
  return (
    typeof x === 'object' && x !== null &&
    typeof (x as Quantity).value === 'number' &&
    typeof (x as Quantity).unit === 'string'
  );
}

/** schema 校验：单位存在、数值有限、负值许可。 */
export function validateQuantitySchema(q: Quantity): string[] {
  const errors: string[] = [];
  if (typeof q.value !== 'number' || !Number.isFinite(q.value)) errors.push(`value 非法: ${String(q.value)}`);
  if (!DIM[q.unit as DimName] && !unitExists(q.unit)) errors.push(`未知单位: ${q.unit}`);
  return errors;
}

function unitExists(_symbol: string): boolean {
  // 实际查找由 units.ts 的 findUnit 完成；此处避免循环依赖，运行时通过 registry 注入。
  return unitRegistry.has(_symbol);
}

const unitRegistry = new Set<string>();

/** 运行时单位注册（由 units.ts 调用，避免循环 import）。 */
export function registerUnits(symbols: string[]): void {
  for (const s of symbols) unitRegistry.add(s);
}

export { DIM };
