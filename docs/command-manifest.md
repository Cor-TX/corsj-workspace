# 命令清单对照表（command manifest）

- **版本**：v1.2（2026-07-11 首次登记，2026-11-07 随阶段一实现核对更新，2026-11-07 随阶段二 corsj-dsh 增补 DSH 专列，2026-11-15 随 P0 能力补齐新增 propeller.design 核心命令、fluid.internal_flow 升级为 L1 已实现扩展命令）
- **数据来源**：
  - 核心：`core/src/commands/core-commands-1.ts`（5 条）、`core-commands-2.ts`（9 条）、`core-commands-3.ts`（6 条）中的 **20 条 `registerCommand` 调用**；
  - 扩展：`core/src/commands/builtin/extension-commands.ts` 的 `EXTENSION_COMMAND_META`，共 **59 条**（6 条 L3 + 53 条 L4）。
- **唯一真源声明**：命令清单与 K 计数以本文件（`docs/command-manifest.md`）为**唯一真源**；源码为清单的实现载体。二者不一致时，先在本文件登记核对结论，再修复源码。
- **快速核对**：`node scripts/list-cmds.mjs` 应输出 `TOTAL 79`（20 core + 59 ext）。

---

## K 披露节

**K = 59**（扩展命令条数）。

v7 任务书附录 A 的计数块沿用 v6 的「**51 条**」标签，但其清单**正文实际枚举 59 条**互不重复、且与 19 条核心命令无重叠的命令 id，按：

> 51 − 14 船舶专用 + 22 通用领域 = **59**

差异处置依据任务书 §6「附录 A 仅作核对基准，不是第二真源」及附录 A「若 K ≠ 51，必须在阶段自检结果中说明差异原因」：本实现**完整继承 59 条**扩展命令 id（见 `core/src/commands/builtin/extension-commands.ts` 头注释与 `core/src/commands/registry.ts`、`core/src/design/acceptance-spec/eligibility-matrix.ts` 的同源说明），差异原因以本节为准登记。**docs 为唯一真源。**

### 计数汇总

| 口径 | 数量 | 明细 |
| --- | --- | --- |
| 核心命令（`registerCommand`） | 20 | L0×3（spec.parse_requirements、comm.link_budget、report.generate）；L1×17 |
| 扩展命令（`EXTENSION_COMMAND_META`） | **K = 59** | L1×1；L3×5；L4×53 |
| 合计 | 79 | L0×3 + L1×17 + L1×1 + L3×5 + L4×53 |

---

## 一、总对照表（79 条）

阶段一列取值：`是`＝已实现并注册执行器；`否（not_implemented）`＝阶段一仅注册骨架、执行返回 not_implemented；`不实现（L4）`＝L4 级命令阶段一/二均不实现（仅登记元数据）。
阶段二复用列取值：`是`＝阶段二继续沿用该命令承担其闭环角色；`否`＝阶段二不复用；`不适用`＝无独立闭环角色的辅助能力（见 §二判定依据）。
DSH 专列取值（corsj-dsh）：`是`＝经主进程 IPC 白名单暴露到 DSH 命令面并可调用；`否`＝DSH 不暴露（扩展命令保持 core 内 not_implemented 骨架）；`不实现（L4）`＝L4 级命令在 DSH 侧同样不实现（仅登记元数据，不得进入任何 REQUIRED 验证器依赖链）。

### 1.1 核心命令（20 条，源码登记顺序）

| 命令 id | 核心/扩展 | embedded_level | 阶段一是否实现 | 阶段二是否复用 | DSH 是否暴露 |
| --- | --- | --- | --- | --- | --- |
| spec.parse_requirements | 核心 | L0 | 是 | 是 | 是 |
| geometry.generate | 核心 | L1 | 是 | 是 | 是 |
| geometry.format_convert | 核心 | L1 | 是 | 不适用 | 是 |
| geometry.validity_check | 核心 | L1 | 是 | 是 | 是 |
| fea.static | 核心 | L1 | 是 | 是 | 是 |
| eda.schematic_erc | 核心 | L1 | 是 | 是 | 是 |
| eda.pcb_drc | 核心 | L1 | 是 | 是 | 是 |
| eda.manufacturing_export | 核心 | L1 | 是 | 是 | 是 |
| bom.generate | 核心 | L1 | 是 | 是 | 是 |
| energy.closure_sim | 核心 | L1 | 是 | 是 | 是 |
| motion.sim | 核心 | L1 | 是 | 是 | 是 |
| comm.link_budget | 核心 | L0 | 是 | 是 | 是 |
| arrangement.mass_cg | 核心 | L1 | 是 | 是 | 是 |
| arrangement.interference | 核心 | L1 | 是 | 是 | 是 |
| fluid.resistance_solve | 核心 | L1 | 是 | 是 | 是 |
| thermal.static_estimate | 核心 | L1 | 是 | 是 | 是 |
| manufacturing.package | 核心 | L1 | 是 | 是 | 是 |
| report.generate | 核心 | L0 | 是 | 是 | 是 |
| export.standard_format | 核心 | L1 | 是 | 是 | 是 |
| propeller.design | 核心 | L1 | 是 | 是 | 是 |

### 1.2 扩展命令（59 条，`EXTENSION_COMMAND_META` 登记顺序）

阶段一全部仅注册骨架，执行器返回 `not_implemented`，且默认 `optional`、`allowed_strengths` 仅 `['optional']`（不得绑定 REQUIRED 验证器、不得成为门禁必要条件）。

| 命令 id | 核心/扩展 | embedded_level | 阶段一是否实现 | 阶段二是否复用 | DSH 是否暴露 |
| --- | --- | --- | --- | --- | --- |
| spec.rule_check | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| geometry.parametric_surface | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| geometry.lines_fairing | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| assembly.constraint_check | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| fluid.internal_flow | 扩展 | L1 | 是（ITTC 1957 纯 TS 实现） | 否 | 否 |
| fluid.heat_transfer | 扩展 | L3 | 否（not_implemented） | 否 | 否 |
| thermal.electronics | 扩展 | L3 | 否（not_implemented） | 否 | 否 |
| thermal.system_balance | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| fea.buckling | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| fea.modal | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| fea.fatigue | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| fea.thermal_stress | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| composite.layup | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| connections.strength | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| collision.damage | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| mbd.dynamics | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| mbd.contact_impact | 扩展 | L3 | 否（not_implemented） | 否 | 否 |
| topology.optimize | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| mdo.optimize | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| eda.signal_integrity | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| eda.power_integrity | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| eda.emc_emi | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| harness.design | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| power_distribution.protection | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| spice.circuit_sim | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| battery.pack_design | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| battery.ecm_sim | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| generation.hybrid | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| chemical.process | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| gnc.dynamics_model | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| gnc.guidance_law | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| gnc.control_law | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| nav.sensor_fusion | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| perception.sensor_sim | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| fault_diagnosis | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| control.python_sim | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| antenna.layout | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| antenna.simple_design | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| optics.raytrace | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| optics.differentiable | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| em.fdtd | 扩展 | L3 | 否（not_implemented） | 否 | 否 |
| em.fem_low_freq | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| em.palace_rf | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| payload.integration | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| payload.data_budget | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| arrangement.power_budget | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| arrangement.interface_check | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| maintainability.review | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| ergonomics.review | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| docs.techdraw | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| assembly.process | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| test_plan.generate | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| version.manage | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| plm.bom_manage | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| am.thermal_mechanical | 扩展 | L3 | 否（not_implemented） | 否 | 否 |
| am.support_generation | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| cam.path_generate | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| bim.ifc_process | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |
| sysml.architecture | 扩展 | L4 | 不实现（L4） | 否 | 不实现（L4） |

---

## 二、核心命令阶段二复用判定依据（按闭环角色）

七步设计闭环主链（见 `scripts/selfcheck.mjs`）：`spec.parse_requirements → geometry.generate → geometry.validity_check → fea.static → eda.schematic_erc → energy.closure_sim → delivery_gate.submit`。第 7 步交付门禁属 B 层设计循环（`core/src/design/`），不在这 19 条命令内。

判定准则：命令在闭环中承担**需求入口 / 设计生成 / 验证检查 / 交付导出**之一 → 复用「是」；仅为载荷派生辅助、无独立闭环角色 → 「不适用」；阶段二计划改由其他机制承担 → 「否」（当前无）。

| 命令 id | 闭环角色 | 阶段二复用 |
| --- | --- | --- |
| spec.parse_requirements | 需求入口（闭环第 1 步：目标文本 → 结构化需求 + 验证建议） | 是 |
| geometry.generate | 设计生成（闭环第 2 步：参数化几何 → Part 对象） | 是 |
| geometry.validity_check | 验证检查（闭环第 3 步：拓扑有效性） | 是 |
| fea.static | 验证检查（闭环第 4 步：结构强度） | 是 |
| eda.schematic_erc | 验证检查（闭环第 5 步：电气规则） | 是 |
| energy.closure_sim | 验证检查（闭环第 6 步：能量闭合） | 是 |
| eda.pcb_drc | 验证检查（可选用验证项：PCB 设计规则） | 是 |
| motion.sim | 验证检查（可选用验证项：动力学仿真） | 是 |
| comm.link_budget | 验证检查（可选用验证项：链路余量） | 是 |
| arrangement.mass_cg | 验证检查（可选用验证项：质量/质心） | 是 |
| arrangement.interference | 验证检查（可选用验证项：干涉/间隙） | 是 |
| fluid.resistance_solve | 验证检查（可选用验证项：流阻/压降） | 是 |
| thermal.static_estimate | 验证检查（可选用验证项：稳态温度） | 是 |
| eda.manufacturing_export | 交付导出（Gerber/钻孔/贴片制造文件） | 是 |
| bom.generate | 交付导出（物料清单） | 是 |
| manufacturing.package | 交付导出（制造包清单，附 SHA256） | 是 |
| report.generate | 交付导出（Markdown 设计报告） | 是 |
| export.standard_format | 交付导出（标准格式派生文件，自检断言 3） | 是 |
| geometry.format_convert | 载荷派生辅助（STEP↔STL 转换，不产生第二真格式，不在闭环主链） | 不适用 |

---

## 三、扩展命令阶段二接入目标

阶段二复用列整体为「否」的原因：59 条扩展命令在阶段一均为骨架（`not_implemented`），阶段二不直接复用其阶段一执行器，而是**按各命令登记的底层工具替换 executor** 后接入；命令 id、capability 字段与资格约束保持不变。接入目标（`tool` 字段）逐条如下；消耗/产出物定义见 `EXTENSION_COMMAND_META`。L3 命令需要可下载的第三方求解器资产，L4 命令阶段一/二均不实现。

| 命令 id | embedded_level | 阶段二接入目标（底层工具） |
| --- | --- | --- |
| spec.rule_check | L4 | rule-engine |
| geometry.parametric_surface | L4 | opencascade-surface |
| geometry.lines_fairing | L4 | opencascade-fairing |
| assembly.constraint_check | L4 | assembly-solver |
| fluid.internal_flow | L1 | ittc-1957-analytic（纯 TS，已实现） |
| fluid.heat_transfer | L3 | openfoam |
| thermal.electronics | L3 | thermal-electronics-solver |
| thermal.system_balance | L4 | system-balance-solver |
| fea.buckling | L4 | eigenvalue-solver |
| fea.modal | L4 | eigenvalue-solver |
| fea.fatigue | L4 | fatigue-solver |
| fea.thermal_stress | L4 | coupled-thermo-mechanical |
| composite.layup | L4 | composite-solver |
| connections.strength | L4 | connection-solver |
| collision.damage | L4 | damage-model |
| mbd.dynamics | L4 | multibody-solver |
| mbd.contact_impact | L3 | contact-solver |
| topology.optimize | L4 | topology-optimizer |
| mdo.optimize | L4 | mdo-optimizer |
| eda.signal_integrity | L4 | si-solver |
| eda.power_integrity | L4 | pi-solver |
| eda.emc_emi | L4 | emc-solver |
| harness.design | L4 | harness-router |
| power_distribution.protection | L4 | protection-solver |
| spice.circuit_sim | L4 | ngspice |
| battery.pack_design | L4 | pack-designer |
| battery.ecm_sim | L4 | ecm-solver |
| generation.hybrid | L4 | power-system-solver |
| chemical.process | L4 | process-simulator |
| gnc.dynamics_model | L4 | gnc-model |
| gnc.guidance_law | L4 | guidance-law |
| gnc.control_law | L4 | control-law |
| nav.sensor_fusion | L4 | fusion-filter |
| perception.sensor_sim | L4 | sensor-simulator |
| fault_diagnosis | L4 | fault-diagnosis |
| control.python_sim | L4 | python-control |
| antenna.layout | L4 | antenna-optimizer |
| antenna.simple_design | L4 | antenna-analytic |
| optics.raytrace | L4 | raytracer |
| optics.differentiable | L4 | differentiable-optics |
| em.fdtd | L3 | fdtd-solver |
| em.fem_low_freq | L4 | em-fem-solver |
| em.palace_rf | L4 | palace-rf |
| payload.integration | L4 | payload-integration |
| payload.data_budget | L4 | data-budget |
| arrangement.power_budget | L4 | power-budget |
| arrangement.interface_check | L4 | interface-checker |
| maintainability.review | L4 | maintainability-review |
| ergonomics.review | L4 | ergonomics-review |
| docs.techdraw | L4 | techdraw |
| assembly.process | L4 | process-planner |
| test_plan.generate | L4 | test-planner |
| version.manage | L4 | version-manager |
| plm.bom_manage | L4 | plm-bom |
| am.thermal_mechanical | L3 | am-simulator |
| am.support_generation | L4 | support-generator |
| cam.path_generate | L4 | cam-solver |
| bim.ifc_process | L4 | ifc-processor |
| sysml.architecture | L4 | sysml-engine |

L3（5 条）：fluid.heat_transfer、thermal.electronics、mbd.contact_impact、em.fdtd、am.thermal_mechanical。（fluid.internal_flow 已升级为 L1 纯 TS 实现，不再需要 OpenFOAM 资产。）

---

## 四、维护约定

1. 新增/修改/删除命令时，先更新本文件（唯一真源），再同步源码：核心命令改 `core-commands-1/2/3.ts`，扩展命令改 `extension-commands.ts` 的 `EXTENSION_COMMAND_META`（顺序保持与 v7 任务书附录 A 明列清单一致）。
2. `core/src/commands/builtin/register.ts` 与 `registry.ts` 中的计数注释须与本文件口径一致（核心 20、扩展 59、合计 79）。
3. 每次阶段自检（`pnpm selfcheck`）后用 `node scripts/list-cmds.mjs` 核对 `TOTAL 79`；不一致即视为真源冲突，按本文件 §K 处置。
