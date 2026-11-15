/**
 * @corsj/core — 内置 FEA 内核（L1，无原生依赖的确定性线弹性求解）。
 *
 * 设计取舍（记录于内置可行性矩阵）：
 * - 真实实现：3D 8 节点六面体线性单元 + 约束缩减 + 高斯消元直接求解。
 * - 网格由盒体/圆柱的规则划分生成（L1）；CalculiX+Gmsh 的 L2 升级
 *   路径保留（可行性矩阵标注），当前不虚标。
 * - 输出：最大 von Mises 应力、最大位移、反力 —— 与 fea.static 证据格式一致。
 * - 求解器正常退出（无发散）；奇异系统（约束不足）显式 env_error。
 */

export interface Material {
  /** 弹性模量，Pa。 */
  E: number;
  /** 泊松比。 */
  nu: number;
  /** 密度，kg/m3（可空——静力不需要）。 */
  density?: number;
  /** 屈服强度，Pa（供报告，不在 A 层判定）。 */
  yield_strength?: number;
}

export interface FeaLoad {
  /** 加载面：'x0'|'x1'|'y0'|'y1'|'z0'|'z1'。 */
  face: string;
  /** 面压力，Pa（指向体外法向的反方向，即压）。 */
  pressure: number;
}

export interface FeaConstraint {
  face: string;
  /** 固定自由度掩码 [x,y,z] true=固定。 */
  fix: [boolean, boolean, boolean];
}

export interface FeaMesh {
  nodes: [number, number, number][];
  elements: number[][]; // 8 节点六面体
}

/** 结构定义：外接盒 + 挖孔（圆柱孔，轴向 z，位于原点）。 */
export interface StructureSpec {
  /** 包围盒尺寸，m。 */
  size: [number, number, number];
  /** 单轴网格划分数。 */
  divisions: [number, number, number];
  /** z 向通孔（可选）：{center:[x,y], r}。 */
  hole?: { center: [number, number]; r: number };
}

/** 生成规则六面体网格，挖孔处删单元。 */
export function buildMesh(spec: StructureSpec): FeaMesh {
  const [nx, ny, nz] = spec.divisions;
  const [lx, ly, lz] = spec.size;
  const nodes: [number, number, number][] = [];
  const nid = new Map<string, number>();
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        nid.set(`${i},${j},${k}`, nodes.length);
        nodes.push([(i / nx) * lx, (j / ny) * ly, (k / nz) * lz]);
      }
    }
  }
  const elements: number[][] = [];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (spec.hole) {
          const cx = ((i + 0.5) / nx) * lx;
          const cy = ((j + 0.5) / ny) * ly;
          const dx = cx - spec.hole.center[0];
          const dy = cy - spec.hole.center[1];
          if (Math.hypot(dx, dy) < spec.hole.r) continue; // 挖孔：跳过该柱
        }
        const n = (ii: number, jj: number, kk: number) => nid.get(`${ii},${jj},${kk}`);
        elements.push([
          n(i, j, k)!, n(i + 1, j, k)!, n(i + 1, j + 1, k)!, n(i, j + 1, k)!,
          n(i, j, k + 1)!, n(i + 1, j, k + 1)!, n(i + 1, j + 1, k + 1)!, n(i, j + 1, k + 1)!,
        ]);
      }
    }
  }
  return { nodes, elements };
}

interface Vec3 { x: number; y: number; z: number }

/** 8 节点六面体线性单元刚度阵（2x2x2 高斯积分）。 */
function elementStiffness(nodes: [number, number, number][], E: number, nu: number): number[][] {
  const lambda = E * nu / ((1 + nu) * (1 - 2 * nu));
  const mu = E / (2 * (1 + nu));
  const D = [
    [lambda + 2 * mu, lambda, lambda, 0, 0, 0],
    [lambda, lambda + 2 * mu, lambda, 0, 0, 0],
    [lambda, lambda, lambda + 2 * mu, 0, 0, 0],
    [0, 0, 0, mu, 0, 0],
    [0, 0, 0, 0, mu, 0],
    [0, 0, 0, 0, 0, mu],
  ];
  const gauss = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  const ke = Array.from({ length: 24 }, () => new Array<number>(24).fill(0));
  for (const g of gauss) {
    for (const h of gauss) {
      for (const t of gauss) {
        const xi = g, eta = h, zeta = t;
        // 形函数导数 dN/d(xi,eta,zeta)
        const signs = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
        const dN: number[][] = signs.map(([a, b, c]) => [
          a * (1 + b * eta) * (1 + c * zeta) / 8,
          b * (1 + a * xi) * (1 + c * zeta) / 8,
          c * (1 + a * xi) * (1 + b * eta) / 8,
        ]);
        // J
        const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let n = 0; n < 8; n++) {
          const p = nodes[n];
          for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
              J[r][c] += dN[n][r] * p[c];
            }
          }
        }
        const detJ = det3(J);
        if (detJ <= 0) throw new Error('FEA_MESH_INVERTED: 单元雅可比为负');
        const Jinv = inv3(J);
        // dN/dx
        const dNx: number[][] = dN.map((row) => [
          Jinv[0][0] * row[0] + Jinv[1][0] * row[1] + Jinv[2][0] * row[2],
          Jinv[0][1] * row[0] + Jinv[1][1] * row[1] + Jinv[2][1] * row[2],
          Jinv[0][2] * row[0] + Jinv[1][2] * row[1] + Jinv[2][2] * row[2],
        ]);
        // B 矩阵 6x24
        const B: number[][] = Array.from({ length: 6 }, () => new Array<number>(24).fill(0));
        for (let n = 0; n < 8; n++) {
          const b0 = n * 3;
          B[0][b0] = dNx[n][0];
          B[1][b0 + 1] = dNx[n][1];
          B[2][b0 + 2] = dNx[n][2];
          B[3][b0] = dNx[n][1]; B[3][b0 + 1] = dNx[n][0];
          B[4][b0 + 1] = dNx[n][2]; B[4][b0 + 2] = dNx[n][1];
          B[5][b0] = dNx[n][2]; B[5][b0 + 2] = dNx[n][0];
        }
        // ke += B^T D B w detJ
        const w = 1; // 每个高斯点权重 1（2 点积分 → 体积/8 已含在 detJ 中按积分点平均）
        for (let i = 0; i < 24; i++) {
          for (let j = 0; j < 24; j++) {
            let s = 0;
            for (let r = 0; r < 6; r++) {
              let dB = 0;
              for (let c = 0; c < 6; c++) dB += D[r][c] * B[c][j];
              s += B[r][i] * dB;
            }
            ke[i][j] += s * w * detJ;
          }
        }
      }
    }
  }
  return ke;
}

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}
function inv3(m: number[][]): number[][] {
  const d = det3(m);
  const c = (a: number, b: number) => m[a][b];
  return [
    [(c(1,1)*c(2,2)-c(1,2)*c(2,1))/d, (c(0,2)*c(2,1)-c(0,1)*c(2,2))/d, (c(0,1)*c(1,2)-c(0,2)*c(1,1))/d],
    [(c(1,2)*c(2,0)-c(1,0)*c(2,2))/d, (c(0,0)*c(2,2)-c(0,2)*c(2,0))/d, (c(0,2)*c(1,0)-c(0,0)*c(1,2))/d],
    [(c(1,0)*c(2,1)-c(1,1)*c(2,0))/d, (c(0,1)*c(2,0)-c(0,0)*c(2,1))/d, (c(0,0)*c(1,1)-c(0,1)*c(1,0))/d],
  ];
}

/** 面上的节点集合。 */
export function faceNodes(mesh: FeaMesh, face: string, size: [number, number, number]): number[] {
  const [lx, ly, lz] = size;
  const eps = Math.max(lx, ly, lz) * 1e-9;
  const out: number[] = [];
  mesh.nodes.forEach((p, i) => {
    const on =
      (face === 'x0' && Math.abs(p[0]) < eps) || (face === 'x1' && Math.abs(p[0] - lx) < eps) ||
      (face === 'y0' && Math.abs(p[1]) < eps) || (face === 'y1' && Math.abs(p[1] - ly) < eps) ||
      (face === 'z0' && Math.abs(p[2]) < eps) || (face === 'z1' && Math.abs(p[2] - lz) < eps);
    if (on) out.push(i);
  });
  return out;
}

export interface StaticSolution {
  displacement_max: number; // m
  von_mises_max: number; // Pa
  reaction_sum: Vec3; // N
  converged: boolean;
  dofs: number;
}

/**
 * 求解线弹性静力问题：均匀面压 + Dirichlet 约束。
 * 用约束缩减 + 高斯消元；收敛判定：消元无零主元。
 */
export function solveStatic(
  mesh: FeaMesh, size: [number, number, number],
  mat: Material, load: FeaLoad, constraint: FeaConstraint,
): StaticSolution {
  const ndof = mesh.nodes.length * 3;
  // 用 COO → 稠密（L1 规模小：节点数 ≤ ~2000）
  const K = new Map<number, number>();
  const addK = (r: number, c: number, v: number) => K.set(r * ndof + c, (K.get(r * ndof + c) ?? 0) + v);
  for (const el of mesh.elements) {
    const en = el.map((n) => mesh.nodes[n]);
    const ke = elementStiffness(en, mat.E, mat.nu);
    for (let a = 0; a < 8; a++) {
      for (let b = 0; b < 8; b++) {
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            addK(el[a] * 3 + i, el[b] * 3 + j, ke[a * 3 + i][b * 3 + j]);
          }
        }
      }
    }
  }
  // 载荷向量：面压 → 等效节点力（面节点均摊）
  const F = new Array<number>(ndof).fill(0);
  const faceArea = faceAreaOf(mesh, load.face, size);
  const fn = faceNodes(mesh, load.face, size);
  const total = load.pressure * faceArea;
  const per = total / fn.length;
  const dir: Vec3 = load.face === 'x1' ? { x: -1, y: 0, z: 0 } : load.face === 'y1' ? { x: 0, y: -1, z: 0 } : load.face === 'z1' ? { x: 0, y: 0, z: -1 } : load.face === 'x0' ? { x: 1, y: 0, z: 0 } : load.face === 'y0' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  for (const n of fn) {
    F[n * 3] += per * dir.x;
    F[n * 3 + 1] += per * dir.y;
    F[n * 3 + 2] += per * dir.z;
  }
  // 约束
  const cn = faceNodes(mesh, constraint.face, size);
  const fixed = new Set<number>();
  for (const n of cn) {
    if (constraint.fix[0]) fixed.add(n * 3);
    if (constraint.fix[1]) fixed.add(n * 3 + 1);
    if (constraint.fix[2]) fixed.add(n * 3 + 2);
  }
  if (fixed.size < 3) throw new Error('FEA_UNDER_CONSTRAINED: 约束不足（<3 自由度），系统奇异');
  // 自由 dof 列表
  const free: number[] = [];
  for (let i = 0; i < ndof; i++) if (!fixed.has(i)) free.push(i);
  // 提取子矩阵
  const n = free.length;
  const idx = new Map(free.map((d, i) => [d, i]));
  const Kff: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const Ff = new Array<number>(n).fill(0);
  for (const [rc, v] of K) {
    const r = Math.floor(rc / ndof);
    const c = rc % ndof;
    const ri = idx.get(r);
    const ci = idx.get(c);
    if (ri !== undefined && ci !== undefined) Kff[ri][ci] += v;
  }
  for (let i = 0; i < n; i++) Ff[i] = F[free[i]];
  // 高斯消元（部分主元）
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(Kff[r][col]) > Math.abs(Kff[piv][col])) piv = r;
    if (Math.abs(Kff[piv][col]) < 1e-18) {
      throw new Error('FEA_SINGULAR: 刚度矩阵奇异（约束或网格退化）');
    }
    if (piv !== col) {
      [Kff[col], Kff[piv]] = [Kff[piv], Kff[col]];
      [Ff[col], Ff[piv]] = [Ff[piv], Ff[col]];
    }
    const d = Kff[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = Kff[r][col] / d;
      if (f === 0) continue;
      for (let c2 = col; c2 < n; c2++) Kff[r][c2] -= f * Kff[col][c2];
      Ff[r] -= f * Ff[col];
    }
  }
  // 回代
  const U = new Array<number>(ndof).fill(0);
  const uf = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = Ff[i];
    for (let j = i + 1; j < n; j++) s -= Kff[i][j] * uf[j];
    uf[i] = s / Kff[i][i];
  }
  for (let i = 0; i < n; i++) U[free[i]] = uf[i];
  // 最大位移
  let dispMax = 0;
  for (let i = 0; i < mesh.nodes.length; i++) {
    const d = Math.hypot(U[i * 3], U[i * 3 + 1], U[i * 3 + 2]);
    if (d > dispMax) dispMax = d;
  }
  // von Mises（每单元中心，由平均应变能推导：σ_mises = sqrt(3J2)），
  // L1 用节点位移差分近似应变 → 应力。这里用能量等效：σ_eq = sqrt(2 * U_elastic * E / V) 保守上界不可靠，
  // 改为直接差分：对每个单元，用 8 节点位移的极差近似应变分量。
  let vmMax = 0;
  const lambda = mat.E * mat.nu / ((1 + mat.nu) * (1 - 2 * mat.nu));
  const mu = mat.E / (2 * (1 + mat.nu));
  for (const el of mesh.elements) {
    // 单元内平均应变：节点位移差 / 特征长度
    let maxDu = [0, 0, 0];
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        const a = el[i], b = el[j];
        const du = [Math.abs(U[a * 3] - U[b * 3]), Math.abs(U[a * 3 + 1] - U[b * 3 + 1]), Math.abs(U[a * 3 + 2] - U[b * 3 + 2])];
        if (du[0] + du[1] + du[2] > maxDu[0] + maxDu[1] + maxDu[2]) maxDu = du;
      }
    }
    const h = characteristicLength(el.map((n2) => mesh.nodes[n2]));
    if (h <= 0) continue;
    // 工程应变（最大位移差 / 单元尺寸，保守）
    const ex = maxDu[0] / h, ey = maxDu[1] / h, ez = maxDu[2] / h;
    const sxx = (lambda + 2 * mu) * ex + lambda * (ey + ez);
    const syy = (lambda + 2 * mu) * ey + lambda * (ex + ez);
    const szz = (lambda + 2 * mu) * ez + lambda * (ex + ey);
    const vm = Math.sqrt(0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2));
    if (vm > vmMax) vmMax = vm;
  }
  // 反力和：R = K*U - F，只统计固定 dof（平衡校核用）
  const KU = new Array<number>(ndof).fill(0);
  for (const [rc, v] of K) {
    const r = Math.floor(rc / ndof);
    const c = rc % ndof;
    KU[r] += v * U[c];
  }
  const reaction: Vec3 = { x: 0, y: 0, z: 0 };
  for (const d of fixed) {
    const r = KU[d] - (F[d] ?? 0);
    if (d % 3 === 0) reaction.x += r;
    else if (d % 3 === 1) reaction.y += r;
    else reaction.z += r;
  }
  return {
    displacement_max: dispMax,
    von_mises_max: vmMax,
    reaction_sum: reaction,
    converged: true,
    dofs: ndof,
  };
}

function faceAreaOf(mesh: FeaMesh, face: string, size: [number, number, number]): number {
  const [lx, ly, lz] = size;
  const faceSize: [number, number] =
    face === 'x0' || face === 'x1' ? [ly, lz] :
    face === 'y0' || face === 'y1' ? [lx, lz] : [lx, ly];
  return faceSize[0] * faceSize[1];
}

function characteristicLength(nodes: [number, number, number][]): number {
  let h = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1], nodes[i][2] - nodes[j][2]);
      if (d > 1e-15 && d < h) h = d;
    }
  }
  return h === Infinity ? 0 : h;
}
