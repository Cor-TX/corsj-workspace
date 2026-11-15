/**
 * @corsj/core — 螺旋桨匹配内核（L1，纯 TypeScript）。
 *
 * 基于 B-series 经验图谱的简化匹配算法（OpenProp 未接入时的替代实现）：
 * - 3 叶 B 系列桨的推力系数 Kt(J) 与扭矩系数 Kq(J) 用二次多项式拟合
 *   （J 为进速系数，J = V / (n·D)，有效区间 J ∈ [0, 0.7]）；
 * - 在桨径网格上对转速做二分求解，使总推力满足需求（T = n_prop · Kt · ρ · n² · D⁴）；
 * - 在所有可行解中选取轴功率最小者（P = n_prop · Kq · ρ · n³ · D⁵）。
 *
 * 用途：根据推力需求计算所需转速、桨径与功率。
 */

export interface PropellerMatchInput {
  /** 所需总推力（N），> 0。 */
  thrust_N: number;
  /** 艇速（m/s），≥ 0（0 为系柱工况）。 */
  speed_m_s: number;
  /** 螺旋桨数量，默认 1，≥ 1 整数。 */
  propeller_count?: number;
  /** 水密度（kg/m³），默认 1000。 */
  water_density_kg_m3?: number;
  /** 最大允许桨径（m），默认 0.5。 */
  max_diameter_m?: number;
  /** 最大允许转速（rpm），可选。 */
  max_rpm?: number;
}

export interface PropellerMatchResult {
  diameter_m: number;
  rotation_speed_rps: number;
  rotation_speed_rpm: number;
  power_W: number;
  efficiency: number;
  thrust_per_propeller_N: number;
  advance_ratio: number;
  kt: number;
  kq: number;
  propeller_count: number;
  water_density_kg_m3: number;
  formula: string;
}

/** B3 系列 3 叶桨经验拟合（J ∈ [0, 0.7]）。 */
function ktOf(j: number): number {
  return 0.5 - 0.95 * j + 0.35 * j * j;
}

function kqOf(j: number): number {
  return 0.05 - 0.04 * j + 0.01 * j * j;
}

const J_MAX = 0.7;

/** 螺旋桨匹配：返回功率最小的可行解。 */
export function matchPropeller(input: PropellerMatchInput): PropellerMatchResult {
  const thrust = input.thrust_N;
  const speed = input.speed_m_s;
  const count = Math.max(1, Math.round(input.propeller_count ?? 1));
  const rho = input.water_density_kg_m3 ?? 1000;
  const maxD = input.max_diameter_m ?? 0.5;
  const maxRpm = input.max_rpm;

  let best: PropellerMatchResult | undefined;
  // 桨径网格：20mm ~ max_diameter，步长 5mm
  for (let dMm = 20; dMm <= maxD * 1000 + 1e-9; dMm += 5) {
    const d = dMm / 1000;
    // 二分求转速 n（rps）：f(n) = count·Kt(J)·ρ·n²·D⁴ − thrust，f 关于 n 单调增
    const lo = speed > 0 ? speed / (2 * J_MAX * d) : 1e-9;
    const hi = maxRpm !== undefined ? maxRpm / 60 : 50;
    const jHi = speed > 0 ? Math.min(speed / (hi * d), J_MAX) : 0;
    const fHi = count * ktOf(jHi) * rho * hi * hi * d * d * d * d - thrust;
    if (fHi < 0) continue; // 该直径下最大转速仍推力不足
    let a = lo;
    let b = hi;
    for (let iter = 0; iter < 80; iter++) {
      const mid = (a + b) / 2;
      const j = speed > 0 ? Math.min(speed / (mid * d), J_MAX) : 0;
      const f = count * ktOf(j) * rho * mid * mid * d * d * d * d - thrust;
      if (f >= 0) b = mid;
      else a = mid;
    }
    const n = (a + b) / 2;
    const j = speed > 0 ? Math.min(speed / (n * d), J_MAX) : 0;
    const kt = ktOf(j);
    const kq = kqOf(j);
    const power = count * kq * rho * n * n * n * d * d * d * d * d;
    const efficiency = speed > 0 ? (thrust * speed) / power : 0;
    const candidate: PropellerMatchResult = {
      diameter_m: d,
      rotation_speed_rps: n,
      rotation_speed_rpm: n * 60,
      power_W: power,
      efficiency,
      thrust_per_propeller_N: thrust / count,
      advance_ratio: j,
      kt,
      kq,
      propeller_count: count,
      water_density_kg_m3: rho,
      formula: 'B-series 3-blade empirical fit (L1)',
    };
    if (!best || candidate.power_W < best.power_W) best = candidate;
  }
  if (!best) {
    throw new Error('PROPELLER_NO_FEASIBLE: 在给定约束内无满足推力需求的螺旋桨解');
  }
  return best;
}
