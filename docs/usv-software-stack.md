# 无人船（USV）设计全栈软件清单

> 来源：联网搜索（web_search / multi_search，2026-11-15）。覆盖总体、水动力、结构、电气、能源、控制、螺旋桨、制造各环节。
> 「是否已内置于 corsj」列：✅=corsj 已有等价 L1 纯 TS 内核；⚠️=仅简化/部分实现；❌=未内置。
> 「缺口优先级」：P0=阻断设计链；P1=限制设计质量上限；P2=增强/认证级。

| 类别 | 软件/工具 | 用途 | 开源/商业 | 是否已内置于 corsj | 缺口优先级 |
| --- | --- | --- | --- | --- | --- |
| 总体/几何建模 | FreeCAD（Ship Workbench） | 参数化三维船体建模、曲面放样、封端 | 开源（LGPL） | ⚠️ 仅 box/cylinder 基元（geometry.generate），无参数化曲面/放样 | P1 |
| 水动力 CFD | OpenFOAM | 船舶阻力、耐波性、流场 CFD 求解 | 开源（GPL-3.0） | ⚠️ 仅 ITTC 1957 摩擦阻力 + Froude 波阻近似（fluid.internal_flow） | P2 |
| 水动力势流 | Capytaine | 线性势流 BEM，波浪与浮体频域水动力 | 开源（Python，GPL） | ❌ 未内置 | P2 |
| 结构 FEA | CalculiX | 船舶结构强度、疲劳、屈曲有限元 | 开源（GPL） | ⚠️ 仅 L1 线弹性静力（fea.static），网格上限 12/轴，无模态/屈曲/疲劳 | P1 |
| 螺旋桨设计 | OpenProp | 螺旋桨设计、分析、匹配（B-series） | 免费（MATLAB） | ⚠️ 仅 B-series 简化回归（propeller.design），非完整图谱 | P2 |
| 电气设计 | KiCad | 原理图、PCB 设计、制造文件 | 开源（GPL） | ⚠️ 仅网表级 ERC/DRC/BOM（eda.*），无真实 KiCad 文件级 | P2 |
| 能源/系统仿真 | OpenModelica | Modelica 系统级能源/动力仿真 | 开源（OSMC-PL） | ⚠️ 仅集总参数能量闭合（energy.closure_sim） | P2 |
| 控制/导航 | Marine Systems Simulator (MSS) | 船舶/USV/AUV 动力学、水动力模型、GNC 算法 | 开源（MATLAB） | ⚠️ 仅单自由度运动仿真（motion.sim） | P2 |
| 开源参考设计 | aqualinkorg/asv | 开源自主水面艇参考设计（硬件/电子/软件） | 开源 | ❌ 未内置（仅作参考） | 参考 |
| 制造 | FreeCAD + KiCad 输出 | 制造文件（STEP/Gerber/钻孔） | 开源 | ⚠️ 仅标准格式派生导出（export.standard_format / eda.manufacturing_export） | P2 |

## 结论

corsj 当前以**纯 TypeScript L1 内核**覆盖了设计闭环的关键环节（几何/结构/电气/能源/运动/流体/螺旋桨/制造），可在无外部工程软件的干净环境跑通七步闭环。上表 P1（FreeCAD 曲面、CalculiX 结构认证）与 P2（OpenFOAM CFD、Capytaine、OpenProp 完整图谱、KiCad 文件级、OpenModelica、MSS）为后续增强方向，需按需接入对应开源求解器或保留简化经验实现。
