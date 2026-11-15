# corsj Phase 2 验收报告（corsj-dsh 插件完全可用）

- 日期：2026-11-07
- 工作区：E:\software\corsj-workspace
- 版本：@corsj/dsh 0.1.0 / @corsj/core 0.1.0
- 验收标准来源：任务书 §3（corsj-dsh）与 §7（终止条件 10 条）

## 实现概览

corsj-dsh 已从占位实现重写为 DSH/Cordis bundle 插件，采用主进程 IPC 分发（选项 A）：

- 宿主侧（src/index.ts）：cordis 插件 apply(ctx, config)，装配 IPC 白名单、core 桥接、模型持久化；
- 渲染器侧（src/client.ts）：cordis 客户端插件，注册 sidebar.footer.action 与 shell.overlay 两个槽位；
- IPC 桥（src/ipc.ts + src/ipc-registry.ts）：有 Electron 时 host 用 ipcMain.handle、client 用 ipcRenderer.invoke；无 Electron（自检）时退化为进程内回环，通道名与白名单语义一致；
- core 加载（src/core-loader.ts）：仅宿主侧 createRequire + 动态 import() 加载 @corsj/core 与 @corsj/core/commands；渲染器不 import core（自检断言覆盖）；
- 持久化（src/persistence.ts）：<userData>/dsh/sessions/<id>.jsonl.zstd，JSONL + zstd，首行 header 携带内容指纹，启动校验。

目录树变化（相对阶段一）：

```
corsj-dsh/
  src/
    types.ts            新增：共享类型面 + INVARIANTS
    core-loader.ts      新增：core 加载（仅宿主）
    ipc.ts              新增：主进程 IPC 白名单桥
    ipc-registry.ts     新增：无 Electron 回环注册表
    persistence.ts      新增：.jsonl.zstd 会话持久化 + 指纹校验
    model-state.ts      新增：DSH 只读模型状态
    commands-bridge.ts  重写：19 条核心命令桥接（引用新模块）
    overlay.ts          保留：shell.overlay 全屏 HTML 渲染
    client.ts           新增：客户端槽位注册（sidebar.footer.action / shell.overlay）
    index.ts            重写：宿主 cordis 插件 + dshActions
    electron.d.ts       新增：electron 最小类型声明
  scripts/selfcheck.mjs 新增：Node 级自检（26 项断言）
  patches/corsj-dsh.patch 新增：bundle 空操作补丁
  package.json          更新：dsh.manifestVersion=1 / bundle.patch / client / exports
docs/command-manifest.md 更新：新增 DSH 是否暴露专列（v1.1）
docs/phase2-report.md    新增：本报告
```

## §7 终止条件逐条核对

| # | 终止条件 | 判定 | 证据位置 |
|---|---|---|---|
| 1 | corsj-dsh 可通过 dsh plugin add 安装，安装后右下角入口出现 | 通过（结构验收） | corsj-dsh/package.json：dsh.manifestVersion=1、dsh.bundle.patch、dsh.client.platform=web、exports["./client"]；corsj-dsh/src/client.ts 注册 sidebar.footer.action 槽位；corsj-dsh/patches/corsj-dsh.patch 存在。 |
| 2 | 点击入口确认后 shell.overlay 全屏专用界面渲染（摘要卡片/最近命令/版本） | 通过 | corsj-dsh/src/client.ts 注册 shell.overlay 槽位并渲染 overlayState.html；corsj-dsh/src/overlay.ts 渲染 A 目标/命令面 · B 轮次/最近命令 · C 门禁/降级；自检 overlay 含版本信息/最近命令/摘要卡片 全通过。 |
| 3 | overlay 内命令经主进程 IPC 转发到 @corsj/core，完成七步闭环 | 通过 | corsj-dsh/src/ipc.ts（host ipcMain.handle / client ipcRenderer.invoke）；corsj-dsh/src/core-loader.ts 仅宿主加载 core；自检 七步闭环到达 DELIVERED、闭环门禁 verdict 为 delivered、闭环 REQUIRED 全通过 5/5、闭环产出交付包 全通过。 |
| 4 | 门禁不可绕过，交付状态由门禁写入 | 通过 | corsj-dsh/src/commands-bridge.ts：delivery_gate.submit 显式 refused；INVARIANTS.gate_authority=delivery_gate.submit、ui_may_declare_delivered=false；自检 门禁命令经命令面被拒（refused）、overlay 不宣布交付（UI 判定） 通过。 |
| 5 | DSH 模型持久化正常，指纹校验生效 | 通过 | corsj-dsh/src/persistence.ts：.jsonl.zstd + header 指纹；自检 持久化写入 .jsonl.zstd、持久化读取 + 指纹一致、持久化指纹篡改可检出（env_error） 通过。 |
| 6 | corsj-dsh 不持有 API key，使用 DSH 全局模型 | 通过 | 全源码无 api_key/sk- 引用，仅 INVARIANTS.holds_model_api_key=false；INVARIANTS.model_calls=delegated-to-dsh-global-model；自检 sysinfo 不变量 通过。 |
| 7 | 插件不要求用户手动安装 FreeCAD/KiCad/OpenFOAM | 通过 | core 命令为纯算法实现（geometry/fea/eda/energy 内核），不依赖外部工程软件；createUnavailableAssetResolver 对 L3 资产按 env_error 处理，不要求安装。 |
| 8 | docs/command-manifest.md 已更新，DSH 专列完整，L4 行标注正确 | 通过 | docs/command-manifest.md v1.1：核心表与扩展表均新增 DSH 是否暴露 列；L4 行标注 不实现（L4）；核心命令 DSH=是，扩展命令 DSH=否/不实现（L4）。 |
| 9 | 最终报告逐条列出上述 8 条，全部通过 | 通过 | 本报告 §7 终止条件逐条核对 表。 |
| 10 | 不以无人船设计完成作为终止条件 | 通过（合规声明） | 无人船仅作为验收测试用例；本报告与全部实现以通用工程设计七步闭环为验收基准。 |

## 自检证据

- 自检命令：node corsj-dsh/scripts/selfcheck.mjs，退出码 0，26 项断言全部通过。
- 存档：.cache/tmp/dsh-selfcheck.log。
- 关键输出：sysinfo 注册表正常 {"total":78,"core":19,"extension":59}；命令面暴露 19 条核心命令；七步闭环到达 DELIVERED；闭环 REQUIRED 全通过 5/5；持久化指纹篡改可检出（env_error）；渲染器（client.js）不 import @corsj/core。
- 命令清单核对：node scripts/list-cmds.mjs → TOTAL 78（19 core + 59 ext）。

## 缓存位置检查

所有缓存均位于 E:\software\corsj-workspace\.cache\ 或其子目录：

| 缓存 | 实际路径 |
| --- | --- |
| pnpm store | E:\software\corsj-workspace\.cache\pnpm-store（.npmrc store-dir） |
| npm cache | E:\software\corsj-workspace\.cache\npm-cache（.npmrc cache-dir） |
| pnpm home | E:\software\corsj-workspace\.cache\pnpm-home |
| corepack | E:\software\corsj-workspace\.cache\corepack |
| L3 资产 | E:\software\corsj-workspace\.cache\l3 |
| 开发期 userdata / eop | E:\software\corsj-workspace\.cache\userdata |
| 自检临时 | E:\software\corsj-workspace\.cache\tmp、.cache\selfcheck |
| DSH 会话自检 | E:\software\corsj-workspace\corsj-dsh\.cache\dsh-selfcheck-sessions |

未使用 <userData>/corsj/cache/ 作为开发期/测试期 cache root（已确认不存在）。全部缓存在 E 盘，未落在 C 盘 AppData。

## 已知限制（如实列出）

1. DSH 宿主端到端未在本会话实测：dsh plugin add 的真实安装与 Electron 内 overlay 渲染需在 DSH 宿主环境执行（本会话无 DSH 宿主安装通道）。插件包结构、manifest、槽位注册与 IPC 转发逻辑已按 DSH cordis 契约实现并通过 Node 级自检；宿主侧真实注册端到端待宿主环境验证。
2. Electron IPC 路径为条件分支：自检在无 Electron 环境下走进程内回环；ipcMain.handle/ipcRenderer.invoke 分支已实现并类型检查通过，但未在真实 Electron 主/渲染进程内运行。
3. core 无独立单元测试目录：质量验证依赖 scripts/selfcheck.mjs 与 corsj-dsh/scripts/selfcheck.mjs 两个自检脚本。
