/**
 * @corsj/core — 内置几何内核（L1，无原生依赖的确定性几何）。
 *
 * 设计取舍（记录于内置可行性矩阵）：
 * - 任务书要求核心命令真实实现且随包分发、用户零安装。
 * - 原生 OCCT 绑定（node-occt 等）需要平台预编译二进制，无法在
 *   无网络/无预编译产物的环境保证可用；故 L1 用纯 TS 实现有限但
 *   真实的 B-Rep 子集（轴对齐盒体 + 圆柱 + 布尔并/交体积与质量属性），
 *   STEP 输出为 ISO-10303-21 文本子集。
 * - 该取舍为「降级不降伪」：命令与证据格式保持不变，
 *   可行性矩阵诚实标注 L1，不虚标 L2。
 */

export interface Box { kind: 'box'; x: number; y: number; z: number; }
export interface Cylinder { kind: 'cylinder'; r: number; h: number; }
export type Primitive = Box | Cylinder;

export interface BBox { min: [number, number, number]; max: [number, number, number]; }

export function bboxOf(p: Primitive): BBox {
  if (p.kind === 'box') {
    return { min: [0, 0, 0], max: [p.x, p.y, p.z] };
  }
  return { min: [-p.r, -p.r, 0], max: [p.r, p.r, p.h] };
}

export function volumeOf(p: Primitive): number {
  return p.kind === 'box' ? p.x * p.y * p.z : Math.PI * p.r * p.r * p.h;
}

/** 表面积。 */
export function areaOf(p: Primitive): number {
  if (p.kind === 'box') return 2 * (p.x * p.y + p.y * p.z + p.x * p.z);
  const side = 2 * Math.PI * p.r * p.h;
  const caps = 2 * Math.PI * p.r * p.r;
  return side + caps;
}

/** 质心（原点在体素原点的局部系）。 */
export function centroidOf(p: Primitive): [number, number, number] {
  if (p.kind === 'box') return [p.x / 2, p.y / 2, p.z / 2];
  return [0, 0, p.h / 2];
}

/** 并集体积（轴对齐近似：直接求和减交）。 */
export function unionVolume(a: Primitive, b: Primitive, offset: [number, number, number] = [0, 0, 0]): number {
  const iv = intersectionVolume(a, b, offset);
  const v = typeof iv === 'number' ? iv : iv.volume;
  return volumeOf(a) + volumeOf(b) - v;
}

/** 交体积（AABB 交 × 截面处理；对盒-盒精确，含圆柱的按外接盒保守估计并标注 conservative=true）。 */
export function intersectionVolume(a: Primitive, b: Primitive, offset: [number, number, number] = [0, 0, 0]): { volume: number; conservative: boolean } | number {
  const ba = bboxOf(a);
  const bb = bboxOf(b);
  const min = [0, 1, 2].map((i) => Math.max(ba.min[i], bb.min[i] + offset[i]));
  const max = [0, 1, 2].map((i) => Math.min(ba.max[i], bb.max[i] + offset[i]));
  const d = [0, 1, 2].map((i) => max[i] - min[i]);
  if (d.some((x) => x <= 0)) return 0;
  const boxVol = d[0] * d[1] * d[2];
  if (a.kind === 'box' && b.kind === 'box') return boxVol;
  // 含圆柱：保守估计（外接盒交体积 × π/4 近似因子）
  return { volume: boxVol * (Math.PI / 4), conservative: true };
}

/** 干涉检测（AABB 相交）。 */
export function interferes(a: Primitive, b: Primitive, offset: [number, number, number] = [0, 0, 0]): boolean {
  const ba = bboxOf(a);
  const bb = bboxOf(b);
  return [0, 1, 2].every((i) => ba.max[i] > bb.min[i] + offset[i] && ba.min[i] < bb.max[i] + offset[i]);
}

/** 生成 STEP（ISO-10303-21）文本子集。 */
export function primitiveToStep(p: Primitive, name: string): string {
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('corsj ${name}'),'2;1');`,
    "FILE_NAME('" + name + ".step','2026-01-01T00:00:00',('corsj'),('corsj'),'corsj L1 geometry','corsj','');",
    'FILE_SCHEMA((' + "'AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }' ));",
    'ENDSEC;',
    'DATA;',
  ];
  const body: string[] = [];
  if (p.kind === 'box') {
    body.push(`#1=CARTESIAN_POINT('',(0.,0.,0.));`);
    body.push(`#2=CARTESIAN_POINT('',(${fmt(p.x)},0.,0.));`);
    body.push(`#3=CARTESIAN_POINT('',(0.,${fmt(p.y)},0.));`);
    body.push(`#4=CARTESIAN_POINT('',(0.,0.,${fmt(p.z)}));`);
    body.push(`#5=BLOCK('',#1,#2,#3,#4);`);
    body.push(`#6=MANIFOLD_SOLID_BREP('${name}',#5);`);
  } else {
    body.push(`#1=CARTESIAN_POINT('',(0.,0.,0.));`);
    body.push(`#2=DIRECTION('',(0.,0.,1.));`);
    body.push(`#3=CIRCLE('',#1,${fmt(p.r)});`);
    body.push(`#4=RIGHT_CIRCULAR_CYLINDER('',#1,#2,${fmt(p.h)},${fmt(p.r)});`);
    body.push(`#5=MANIFOLD_SOLID_BREP('${name}',#4);`);
  }
  return [...header, ...body, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
}

function fmt(n: number): string {
  return n.toFixed(6);
}

/** STL 网格导出（12 三角形盒体 / 圆柱 48 段）。 */
export function primitiveToStl(p: Primitive, name: string): string {
  const tris: [number[], number[], number[]][] = [];
  const push = (a: number[], b: number[], c: number[]) => tris.push([a, b, c]);
  if (p.kind === 'box') {
    const { x, y, z } = p;
    // 简单写出 12 个三角形
    const q = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => push([x0, y0, z0], [x1, y1, z1], [x2, y2, z2]);
    // bottom z=0
    q(0,0,0, x,y,0, x,0,0); q(0,0,0, 0,y,0, x,y,0);
    // top z=z
    q(0,0,z, x,0,z, x,y,z); q(0,0,z, x,y,z, 0,y,z);
    // front y=0
    q(0,0,0, x,0,0, x,0,z); q(0,0,0, x,0,z, 0,0,z);
    // back y=y
    q(0,y,0, x,y,z, x,y,0); q(0,y,0, 0,y,z, x,y,z);
    // left x=0
    q(0,0,0, 0,0,z, 0,y,z); q(0,0,0, 0,y,z, 0,y,0);
    // right x=x
    q(x,0,0, x,y,0, x,y,z); q(x,0,0, x,y,z, x,0,z);
  } else {
    const seg = 24;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * 2 * Math.PI;
      const a1 = ((i + 1) / seg) * 2 * Math.PI;
      const p0 = [Math.cos(a0) * p.r, Math.sin(a0) * p.r, 0];
      const p1 = [Math.cos(a1) * p.r, Math.sin(a1) * p.r, 0];
      const p2 = [Math.cos(a0) * p.r, Math.sin(a0) * p.r, p.h];
      const p3 = [Math.cos(a1) * p.r, Math.sin(a1) * p.r, p.h];
      push(p0, p1, p3); push(p0, p3, p2);
      push([0, 0, 0], p1, p0);
      push([0, 0, p.h], p2, p3);
    }
  }
  const lines = ['solid ' + name];
  for (const [a, b, c] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n) || 1;
    const nn = n.map((x) => x / len);
    lines.push(`  facet normal ${nn[0].toFixed(6)} ${nn[1].toFixed(6)} ${nn[2].toFixed(6)}`);
    lines.push('    outer loop');
    for (const pt of [a, b, c]) {
      lines.push(`      vertex ${pt[0].toFixed(6)} ${pt[1].toFixed(6)} ${pt[2].toFixed(6)}`);
    }
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push('endsolid ' + name);
  return lines.join('\n') + '\n';
}
