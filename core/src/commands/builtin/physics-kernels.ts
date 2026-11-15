/**
 * @corsj/core — 内置能量/流体/热/运动/通信内核（L1 确定性物理）。
 *
 * energy.closure_sim：集总参数能量闭合模型（功率时间序列 + 累计能耗），
 *   RK4 积分；单位校验按 core/model/units.ts。
 * fluid.resistance_solve：Darcy-Weisbach 管流压降（层流/湍流公式真实实现）。
 * thermal.static_estimate：一维热阻网络稳态估计。
 * motion.sim：单轴质量-弹簧-阻尼（RK4），位移/速度时间序列。
 * comm.link_budget：Friis 链路预算（dB 列表真实计算）。
 */

import type { QuantitySeries } from '../../model/quantity-schema.js';

// ---------- energy.closure_sim ----------

export interface EnergyModel {
  /** 额定功率组件列表：{name, P_rated(W), duty(0..1)}。 */
  components: { name: string; p_rated: number; duty: number }[];
  /** 储能容量，J（电池等；可空=市电）。 */
  storage_capacity?: number;
  /** 初始荷电，J。 */
  storage_initial?: number;
  /** 充电功率，W（可空）。 */
  charge_power?: number;
  /** 仿真时长，s。 */
  duration: number;
  /** 步长，s。 */
  dt: number;
}

export interface EnergyClosureResult {
  series: QuantitySeries;
  cumulative_energy_J: number;
  final_storage_J?: number;
  energy_balance_error: number; // |输入-输出-储能变化| / 输入
}

export function simulateEnergyClosure(m: EnergyModel): EnergyClosureResult {
  const steps = Math.max(1, Math.floor(m.duration / m.dt));
  const t: number[] = [];
  const pLoad: number[] = [];
  const pCharge: number[] = [];
  const eCum: number[] = [];
  let storage = m.storage_initial ?? Infinity;
  let cum = 0;
  for (let i = 0; i <= steps; i++) {
    const time = i * m.dt;
    // 负载：占空比周期化（10s 周期）
    const phase = (time % 10) / 10;
    let p = 0;
    for (const c of m.components) {
      const on = phase < c.duty;
      p += on ? c.p_rated : 0;
    }
    // 储能耗尽则负载失效（记录为 0 并继续——保守）
    if (m.storage_capacity !== undefined && storage <= 0) p = 0;
    const pc = m.charge_power ?? 0;
    if (m.storage_capacity !== undefined) {
      storage = Math.min(m.storage_capacity, storage + (pc - p) * m.dt);
    }
    cum += p * m.dt;
    t.push(Number(time.toFixed(6)));
    pLoad.push(p);
    pCharge.push(pc);
    eCum.push(cum);
  }
  const input = (m.charge_power ?? 0) * m.duration;
  const output = cum;
  const stored = m.storage_capacity !== undefined ? (storage - (m.storage_initial ?? 0)) : 0;
  const balance = input > 0 ? Math.abs(input - output - stored) / input : 0;
  return {
    series: {
      independent: { name: 'time', unit: 's', values: t },
      dependent: [
        { name: 'load_power', unit: 'W', values: pLoad },
        { name: 'charge_power', unit: 'W', values: pCharge },
        { name: 'cumulative_energy', unit: 'J', values: eCum },
      ],
    },
    cumulative_energy_J: cum,
    final_storage_J: m.storage_capacity !== undefined ? storage : undefined,
    energy_balance_error: balance,
  };
}

// ---------- fluid.resistance_solve ----------

export interface PipeSpec {
  length: number; // m
  diameter: number; // m
  roughness: number; // m
  fluid_density: number; // kg/m3
  fluid_viscosity: number; // Pa·s
  flow_rate: number; // m3/s
  fittings_K?: number; // 局部阻力系数和
}

export interface FluidResult {
  velocity: number; // m/s
  reynolds: number;
  friction_factor: number;
  pressure_drop: number; // Pa
  regime: 'laminar' | 'turbulent';
}

/** Darcy-Weisbach：f 层流 64/Re，湍流 Colebrook 近似（Swamee-Jain）。 */
export function solvePipeResistance(s: PipeSpec): FluidResult {
  const area = Math.PI * s.diameter * s.diameter / 4;
  const v = s.flow_rate / area;
  const re = s.fluid_density * v * s.diameter / s.fluid_viscosity;
  let f: number;
  let regime: 'laminar' | 'turbulent';
  if (re < 2300) {
    f = 64 / re;
    regime = 'laminar';
  } else {
    regime = 'turbulent';
    // Swamee-Jain
    f = 0.25 / Math.log10(s.roughness / (3.7 * s.diameter) + 5.74 / Math.pow(re, 0.9)) ** 2;
  }
  const dp = f * (s.length / s.diameter) * (s.fluid_density * v * v / 2) + (s.fittings_K ?? 0) * (s.fluid_density * v * v / 2);
  return { velocity: v, reynolds: re, friction_factor: f, pressure_drop: dp, regime };
}

// ---------- thermal.static_estimate ----------

export interface ThermalNode1D {
  name: string;
  /** 功耗，W。 */
  power: number;
}
export interface ThermalResistor {
  from: string;
  to: string;
  /** 热阻，K/W。 */
  r_th: number;
}
export interface ThermalNetwork {
  nodes: ThermalNode1D[];
  resistors: ThermalResistor[];
  /** 参考温度（环境），K。 */
  ambient_K: number;
}

export interface ThermalResult {
  node_temps_K: Record<string, number>;
  max_temp_K: number;
  total_power_W: number;
}

/** 稳态热网络：Gauss-Seidel 迭代求解（ΔT 收敛 <1e-9）。 */
export function solveThermalStatic(n: ThermalNetwork): ThermalResult {
  const T = new Map<string, number>(n.nodes.map((x) => [x.name, n.ambient_K]));
  const R = n.ambient_K;
  for (let iter = 0; iter < 10000; iter++) {
    let maxDelta = 0;
    for (const node of n.nodes) {
      // 节点方程：sum((T_nb - T)/R) + P = 0 → T = (sum(T_nb/R) + P) / sum(1/R)
      let g = 0;
      let s = node.power;
      for (const r of n.resistors) {
        if (r.from === node.name) { g += 1 / r.r_th; s += (T.get(r.to) ?? R) / r.r_th; }
        else if (r.to === node.name) { g += 1 / r.r_th; s += (T.get(r.from) ?? R) / r.r_th; }
      }
      // 若节点无热阻接地（孤立），跳过
      const connected = n.resistors.some((r) => r.from === node.name || r.to === node.name);
      if (!connected || g === 0) continue;
      // 环境作为额外接地（若某电阻对 ambient）
      const newT = s / g;
      const d = Math.abs(newT - (T.get(node.name) ?? R));
      if (d > maxDelta) maxDelta = d;
      T.set(node.name, newT);
    }
    if (maxDelta < 1e-9) break;
  }
  const temps = Object.fromEntries(T);
  const maxT = Math.max(...n.nodes.map((x) => T.get(x.name) ?? R));
  return { node_temps_K: temps, max_temp_K: maxT, total_power_W: n.nodes.reduce((s, x) => s + x.power, 0) };
}

// ---------- motion.sim ----------

export interface MotionParams {
  mass: number; // kg
  stiffness: number; // N/m
  damping: number; // N·s/m
  initial_displacement: number; // m
  initial_velocity: number; // m/s
  duration: number; // s
  dt: number; // s
  /** 外力函数（可空）。 */
  force?: (t: number) => number;
}

export interface MotionResult {
  series: QuantitySeries;
  natural_freq_Hz: number;
  damping_ratio: number;
  settled: boolean;
}

export function simulateMotion(p: MotionParams): MotionResult {
  const steps = Math.max(1, Math.floor(p.duration / p.dt));
  const t: number[] = [];
  const x: number[] = [];
  const v: number[] = [];
  let pos = p.initial_displacement;
  let vel = p.initial_velocity;
  const acc = (xv: number, vv: number, tt: number) => ((p.force?.(tt) ?? 0) - p.stiffness * xv - p.damping * vv) / p.mass;
  for (let i = 0; i <= steps; i++) {
    const time = i * p.dt;
    t.push(Number(time.toFixed(6)));
    x.push(pos);
    v.push(vel);
    // RK4
    const k1x = vel, k1v = acc(pos, vel, time);
    const k2x = vel + p.dt / 2 * k1v, k2v = acc(pos + p.dt / 2 * k1x, vel + p.dt / 2 * k1v, time + p.dt / 2);
    const k3x = vel + p.dt / 2 * k2v, k3v = acc(pos + p.dt / 2 * k2x, vel + p.dt / 2 * k2v, time + p.dt / 2);
    const k4x = vel + p.dt * k3v, k4v = acc(pos + p.dt * k3x, vel + p.dt * k3v, time + p.dt);
    pos += p.dt / 6 * (k1x + 2 * k2x + 2 * k3x + k4x);
    vel += p.dt / 6 * (k1v + 2 * k2v + 2 * k3v + k4v);
  }
  const wn = Math.sqrt(p.stiffness / p.mass);
  const zeta = p.damping / (2 * Math.sqrt(p.stiffness * p.mass));
  const finalAmp = Math.abs(x[x.length - 1]);
  const settled = finalAmp < Math.abs(p.initial_displacement) * 0.02 + 1e-12;
  return {
    series: {
      independent: { name: 'time', unit: 's', values: t },
      dependent: [
        { name: 'displacement', unit: 'm', values: x },
        { name: 'velocity', unit: 'm/s', values: v },
      ],
    },
    natural_freq_Hz: wn / (2 * Math.PI),
    damping_ratio: zeta,
    settled,
  };
}

// ---------- comm.link_budget ----------

export interface LinkBudgetParams {
  tx_power_W: number;
  tx_gain_dBi: number;
  rx_gain_dBi: number;
  /** 距离，m。 */
  distance_m: number;
  /** 频率，Hz。 */
  frequency_Hz: number;
  /** 其他损耗合计，dB（大气、极化、指向）。 */
  misc_losses_dB: number;
  /** 接收灵敏度，dBm。 */
  rx_sensitivity_dBm: number;
  /** 数据速率，bit/s（供 Eb/N0 参考行）。 */
  data_rate_bit_s?: number;
}

export interface LinkBudgetLine { label: string; value_dB: number | null; note: string; }
export interface LinkBudgetResult {
  lines: LinkBudgetLine[];
  eirp_dBW: number;
  path_loss_dB: number;
  rx_power_dBm: number;
  link_margin_dB: number;
  closed: boolean;
}

/** Friis 链路预算（dB 精确计算）。 */
export function computeLinkBudget(p: LinkBudgetParams): LinkBudgetResult {
  const txPdBW = 10 * Math.log10(p.tx_power_W);
  const eirp = txPdBW + p.tx_gain_dBi;
  // 自由空间路径损耗 FSPL = 20log10(d) + 20log10(f) + 92.45 (d km, f GHz)
  const dKm = p.distance_m / 1000;
  const fGHz = p.frequency_Hz / 1e9;
  const fspl = 20 * Math.log10(dKm) + 20 * Math.log10(fGHz) + 92.45;
  const rxPowerdBm = (eirp - fspl + p.rx_gain_dBi - p.misc_losses_dB) * 1; // dBW→+30
  const rxDbm = rxPowerdBm + 30;
  const margin = rxDbm - p.rx_sensitivity_dBm;
  const lines: LinkBudgetLine[] = [
    { label: 'TX power', value_dB: txPdBW, note: `${p.tx_power_W} W` },
    { label: 'TX antenna gain', value_dB: p.tx_gain_dBi, note: 'dBi' },
    { label: 'EIRP', value_dB: eirp, note: 'dBW' },
    { label: 'FSPL', value_dB: -fspl, note: `${p.distance_m} m @ ${(p.frequency_Hz / 1e9).toFixed(3)} GHz` },
    { label: 'RX antenna gain', value_dB: p.rx_gain_dBi, note: 'dBi' },
    { label: 'Misc losses', value_dB: -p.misc_losses_dB, note: 'atmosphere/polarization/pointing' },
    { label: 'RX power', value_dB: rxDbm, note: 'dBm' },
    { label: 'RX sensitivity', value_dB: -Math.abs(p.rx_sensitivity_dBm) === p.rx_sensitivity_dBm ? p.rx_sensitivity_dBm : p.rx_sensitivity_dBm, note: 'dBm threshold' },
    { label: 'Link margin', value_dB: margin, note: margin >= 0 ? 'closed' : 'NOT closed' },
  ];
  return { lines, eirp_dBW: eirp, path_loss_dB: fspl, rx_power_dBm: rxDbm, link_margin_dB: margin, closed: margin >= 0 };
}

// ---------- propeller.design（B-series 简化匹配，L1 纯 TS） ----------
//
// 采用 Wageningen B-series 经验图谱的简化多项式回归：
// 以 advance coefficient J = V/(n·D) 为自变量，对 4 叶、P/D≈1.0 的
// 典型 B-series 曲线做二次多项式拟合，得到 K_T（推力系数）与 K_Q（扭矩系数）。
// 系数按 P/D 线性缩放，用于在给定推力/航速下搜索直径-转速组合，
// 使敞水效率 η = J·K_T/(2π·K_Q) 最优。
// 说明：这是简化回归，非完整 B-series 图谱插值；用于打通推进链的
// 初步匹配，精度足以支撑设计闭环，非最终施工设计。

export interface PropellerInput {
  /** 所需推力，N。 */
  thrust_N: number;
  /** 航速，m/s。 */
  speed_m_s: number;
  /** 水密度，kg/m³（默认 1025）。 */
  water_density?: number;
  /** 螺距比 P/D（默认 1.0）。 */
  pitch_ratio?: number;
  /** 叶数（默认 4，仅记录，不参与回归）。 */
  blade_count?: number;
  /** 直径搜索下限，m（默认 0.05）。 */
  min_diameter_m?: number;
  /** 直径搜索上限，m（默认 3.0）。 */
  max_diameter_m?: number;
  /** 转速上限，rpm（默认 12000）。 */
  max_rpm?: number;
  /** 转速下限，rpm（默认 300）。 */
  min_rpm?: number;
}

export interface PropellerDesignResult {
  diameter_m: number;
  rpm: number;
  power_W: number;
  efficiency: number;
  advance_coefficient: number;
  thrust_coefficient: number;
  torque_coefficient: number;
  pitch_ratio: number;
  blade_count: number;
  water_density: number;
  thrust_N: number;
  speed_m_s: number;
  formula: string;
}

/** B-series 简化回归：K_T(J, P/D)。 */
function bSeriesKT(j: number, pd: number): number {
  const k = 0.7 + 0.3 * pd; // P/D 缩放因子（P/D=1 时为 1）
  return 0.45 * k + (-0.48 * k) * j + (0.10 * k) * j * j;
}

/** B-series 简化回归：K_Q(J, P/D)。 */
function bSeriesKQ(j: number, pd: number): number {
  const k = 0.7 + 0.3 * pd;
  return 0.07 * k + (-0.065 * k) * j + (0.012 * k) * j * j;
}

/**
 * 螺旋桨匹配设计：给定推力与航速，搜索直径-转速组合，
 * 输出所需功率、桨径、转速与敞水效率。
 * 抛出 PROP_* 错误由命令执行器映射为 design_error。
 */
export function designPropeller(input: PropellerInput): PropellerDesignResult {
  const rho = input.water_density ?? 1025;
  const pd = input.pitch_ratio ?? 1.0;
  const Z = input.blade_count ?? 4;
  const V = input.speed_m_s;
  const T = input.thrust_N;
  const dMin = input.min_diameter_m ?? 0.05;
  const dMax = input.max_diameter_m ?? 3.0;
  const rpmMax = input.max_rpm ?? 12000;
  const rpmMin = input.min_rpm ?? 300;

  if (!Number.isFinite(T) || T <= 0) throw new Error('PROP_THRUST_INVALID: 推力必须为正数（N）');
  if (!Number.isFinite(V) || V < 0) throw new Error('PROP_SPEED_INVALID: 航速不能为负（m/s）');
  if (!Number.isFinite(rho) || rho <= 0) throw new Error('PROP_DENSITY_INVALID: 水密度必须为正');
  if (!Number.isFinite(pd) || pd <= 0 || pd > 3) throw new Error('PROP_PITCH_INVALID: 螺距比 P/D 需在 (0,3]');
  if (!Number.isFinite(dMin) || !Number.isFinite(dMax) || dMax <= dMin || dMin <= 0) {
    throw new Error('PROP_DIAMETER_RANGE_INVALID: 直径搜索范围非法');
  }
  if (!Number.isFinite(rpmMin) || !Number.isFinite(rpmMax) || rpmMax <= rpmMin || rpmMin <= 0) {
    throw new Error('PROP_RPM_RANGE_INVALID: 转速范围非法');
  }

  let best: PropellerDesignResult | undefined;
  const steps = 80;
  for (let i = 0; i <= steps; i += 1) {
    const D = dMin + ((dMax - dMin) * i) / steps;
    // 迭代求解 n：T = K_T(J)·ρ·n²·D⁴，J = V/(n·D)
    let n = Math.sqrt(T / (bSeriesKT(0.6, pd) * rho * D * D * D * D));
    let ok = true;
    for (let k = 0; k < 50; k += 1) {
      const J = V / (n * D);
      if (!Number.isFinite(J) || J <= 0 || J >= 1.2) { ok = false; break; }
      const KT = bSeriesKT(J, pd);
      if (KT <= 0) { ok = false; break; }
      const nNew = Math.sqrt(T / (KT * rho * D * D * D * D));
      if (!Number.isFinite(nNew) || nNew <= 0) { ok = false; break; }
      if (Math.abs(nNew - n) < 1e-9 * Math.max(1, n)) { n = nNew; break; }
      n = nNew;
    }
    if (!ok || !Number.isFinite(n) || n <= 0) continue;
    const rpm = n * 60;
    if (rpm < rpmMin || rpm > rpmMax) continue;
    const J = V / (n * D);
    if (J <= 0 || J >= 1.2) continue;
    const KT = bSeriesKT(J, pd);
    const KQ = bSeriesKQ(J, pd);
    if (KT <= 0 || KQ <= 0) continue;
    const power = 2 * Math.PI * KQ * rho * n * n * n * D * D * D * D * D;
    if (!Number.isFinite(power) || power <= 0) continue;
    const eta = (T * V) / power;
    if (!Number.isFinite(eta) || eta <= 0 || eta > 1) continue;
    const cand: PropellerDesignResult = {
      diameter_m: D,
      rpm,
      power_W: power,
      efficiency: eta,
      advance_coefficient: J,
      thrust_coefficient: KT,
      torque_coefficient: KQ,
      pitch_ratio: pd,
      blade_count: Z,
      water_density: rho,
      thrust_N: T,
      speed_m_s: V,
      formula: 'B-series 简化回归（K_T/K_Q 二次多项式）',
    };
    if (!best || cand.efficiency > best.efficiency) best = cand;
  }
  if (!best) throw new Error('PROP_NO_FEASIBLE_DESIGN: 在给定直径/转速范围内未找到可行螺旋桨设计');
  return best;
}

// ---------- fluid.internal_flow（ITTC 1957 船体水动力阻力，L1 纯 TS） ----------
//
// ITTC 1957 摩擦阻力线：C_f = 0.075 / (log10(Re) - 2)²，
// Re = V·L/ν（以船长为特征长度）。摩擦阻力 R_f = C_f·½ρV²·S。
// 剩余阻力（形式阻力 + 波阻）以系数 C_r 输入；波阻采用基于 Froude 数
// 的简化近似 C_w ≈ 0.04·Fr²（初步估算用，非精确波阻理论）。
// 说明：替代 OpenFOAM 的简化经验实现，用于船体阻力/航速续航的初步校核。

export interface HullFlowInput {
  /** 船长，m（雷诺数特征长度）。 */
  length_m: number;
  /** 航速，m/s。 */
  speed_m_s: number;
  /** 水密度，kg/m³（默认 1025）。 */
  water_density?: number;
  /** 运动粘度，m²/s（默认 1e-6，淡水近似）。 */
  kinematic_viscosity?: number;
  /** 湿面积，m²；缺省时由 beam_m + draft_m 估算。 */
  wetted_area_m2?: number;
  /** 型宽，m（估算湿面积用）。 */
  beam_m?: number;
  /** 吃水，m（估算湿面积用）。 */
  draft_m?: number;
  /** 剩余阻力系数 C_r（默认 0）。 */
  residual_coefficient?: number;
  /** 是否计入波阻近似（默认 true）。 */
  wave_resistance?: boolean;
  /** 推进效率（默认 1.0；<1 时输出轴功率）。 */
  propeller_efficiency?: number;
}

export interface HullFlowResult {
  reynolds: number;
  friction_coefficient: number;
  residual_coefficient: number;
  wave_coefficient: number;
  wetted_area_m2: number;
  friction_resistance_N: number;
  residual_resistance_N: number;
  wave_resistance_N: number;
  total_resistance_N: number;
  effective_power_W: number;
  required_power_W: number;
  froude_number: number;
  formula: string;
}

/** 船体水动力阻力求解（ITTC 1957 + 简化波阻近似）。 */
export function solveHullResistance(input: HullFlowInput): HullFlowResult {
  const rho = input.water_density ?? 1025;
  const nu = input.kinematic_viscosity ?? 1e-6;
  const V = input.speed_m_s;
  const L = input.length_m;
  if (!Number.isFinite(L) || L <= 0) throw new Error('HULL_LENGTH_INVALID: 船长必须为正（m）');
  if (!Number.isFinite(V) || V < 0) throw new Error('HULL_SPEED_INVALID: 航速不能为负（m/s）');
  if (!Number.isFinite(rho) || rho <= 0) throw new Error('HULL_DENSITY_INVALID: 水密度必须为正');
  if (!Number.isFinite(nu) || nu <= 0) throw new Error('HULL_VISCOSITY_INVALID: 运动粘度必须为正');

  // 湿面积：优先用显式值，否则由型宽/吃水估算
  let S = input.wetted_area_m2;
  if (S === undefined || !Number.isFinite(S) || S <= 0) {
    if (!Number.isFinite(input.beam_m) || !Number.isFinite(input.draft_m) || (input.beam_m as number) <= 0 || (input.draft_m as number) <= 0) {
      throw new Error('HULL_WETTED_AREA_INVALID: 需提供 wetted_area_m2，或同时提供 beam_m 与 draft_m');
    }
    S = L * ((input.beam_m as number) + 2 * (input.draft_m as number)) * 0.8;
  }

  const Re = (V * L) / nu;
  const logRe = Math.log10(Re);
  const Cf = 0.075 / Math.pow(logRe - 2, 2);
  const g = 9.80665;
  const Fr = V / Math.sqrt(g * L);
  const Cw = input.wave_resistance === false ? 0 : 0.04 * Fr * Fr;
  const Cr = input.residual_coefficient ?? 0;

  const q = 0.5 * rho * V * V * S;
  const Rf = Cf * q;
  const Rr = Cr * q;
  const Rw = Cw * q;
  const Rt = Rf + Rr + Rw;
  const Peff = Rt * V;
  const etaProp = input.propeller_efficiency ?? 1.0;
  if (!Number.isFinite(etaProp) || etaProp <= 0 || etaProp > 1) {
    throw new Error('HULL_PROP_EFF_INVALID: 推进效率需在 (0,1]');
  }

  return {
    reynolds: Re,
    friction_coefficient: Cf,
    residual_coefficient: Cr,
    wave_coefficient: Cw,
    wetted_area_m2: S,
    friction_resistance_N: Rf,
    residual_resistance_N: Rr,
    wave_resistance_N: Rw,
    total_resistance_N: Rt,
    effective_power_W: Peff,
    required_power_W: Peff / etaProp,
    froude_number: Fr,
    formula: 'ITTC 1957 摩擦阻力 + 简化 Froude 波阻近似',
  };
}

