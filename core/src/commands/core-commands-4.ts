/**
 * @corsj/core — 核心命令实现（第四批：propeller.design）。
 */
import { registerCommand } from './registry.js';
import { ok, designError, type CommandContext, type CommandParams } from './types.js';
import { artPrefix } from './core-commands-1.js';
import { matchPropeller, type PropellerMatchInput } from './builtin/propeller-kernel.js';

const MT = { json: 'application/json' };
const enc = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// propeller.design
// ---------------------------------------------------------------------------
registerCommand('propeller.design', {
  consumes: ['thrust_N, speed_m_s, propeller_count, water_density_kg_m3, max_diameter_m, max_rpm'],
  produces: ['propeller match JSON', '匹配结果表'],
  embedded_level: 'L1',
  core: true,
  description: '螺旋桨匹配设计（L1）：B-series 经验图谱拟合，按推力需求求解桨径/转速/功率',
  executor: async (params: CommandParams, ctx: CommandContext) => {
    const thrust = params['thrust_N'];
    const speed = params['speed_m_s'];
    if (!Number.isFinite(thrust as number) || (thrust as number) <= 0) {
      return designError('thrust_N 非法（需 > 0）');
    }
    if (!Number.isFinite(speed as number) || (speed as number) < 0) {
      return designError('speed_m_s 非法（需 ≥ 0）');
    }
    const count = params['propeller_count'];
    if (count !== undefined && (!Number.isInteger(count as number) || (count as number) < 1)) {
      return designError('propeller_count 非法（需 ≥ 1 的整数）');
    }
    const density = params['water_density_kg_m3'];
    if (density !== undefined && (!Number.isFinite(density as number) || (density as number) <= 0)) {
      return designError('water_density_kg_m3 非法');
    }
    const maxD = params['max_diameter_m'];
    if (maxD !== undefined && (!Number.isFinite(maxD as number) || (maxD as number) <= 0)) {
      return designError('max_diameter_m 非法');
    }
    const maxRpm = params['max_rpm'];
    if (maxRpm !== undefined && (!Number.isFinite(maxRpm as number) || (maxRpm as number) <= 0)) {
      return designError('max_rpm 非法');
    }

    let res: ReturnType<typeof matchPropeller>;
    try {
      res = matchPropeller({
        thrust_N: thrust as number,
        speed_m_s: speed as number,
        propeller_count: count as number | undefined,
        water_density_kg_m3: density as number | undefined,
        max_diameter_m: maxD as number | undefined,
        max_rpm: maxRpm as number | undefined,
      });
    } catch (e) {
      return designError(String((e as Error).message));
    }

    const prefix = artPrefix(ctx.run, 'propeller.design');
    const result = {
      ...res,
      input: {
        thrust_N: thrust,
        speed_m_s: speed,
        propeller_count: res.propeller_count,
        water_density_kg_m3: res.water_density_kg_m3,
        max_diameter_m: maxD ?? null,
        max_rpm: maxRpm ?? null,
      },
    };
    return ok(
      `螺旋桨匹配完成：D=${res.diameter_m.toFixed(3)}m，n=${res.rotation_speed_rpm.toFixed(0)}rpm，P=${res.power_W.toFixed(1)}W，η=${res.efficiency.toFixed(3)}`,
      {
        diameter_m: res.diameter_m,
        rotation_speed_rps: res.rotation_speed_rps,
        rotation_speed_rpm: res.rotation_speed_rpm,
        power_W: res.power_W,
        efficiency: res.efficiency,
        thrust_per_propeller_N: res.thrust_per_propeller_N,
        advance_ratio: res.advance_ratio,
        kt: res.kt,
        kq: res.kq,
        propeller_count: res.propeller_count,
        result_file: `${prefix}/propeller-result.json`,
      },
      [{ path: `${prefix}/propeller-result.json`, data: enc(JSON.stringify(result, null, 2)), media_type: MT.json, role: 'propeller-result' }],
    );
  },
});
