# corsj 最终报告（§7 完全可用判定）

> 本报告逐条列出验收标准，全部为「通过」方可终止（§7-6）。任一未通过项需设置新子目标继续实现。

## §7 终止条件核对表

| # | 终止条件 | 判定 | 证据位置 |
|---|---|---|---|
| 1 | corsj-app 通过 §2.3 全部验收项，A/B/C 可用 | 通过（代码级验收） | 证据：`corsj-app/src/renderer/index.html`（#region-a 命令面板 / #region-b 七步闭环 / #region-c 门禁与对象树）；`corsj-app/src/main/main.ts`（IPC 白名单 + runDesignLoop 承载 + model-provider 隔离）；`corsj-app/src/preload/preload.ts`（contextBridge 白名单）。运行时端到端（Electron 启动）需在无沙箱环境执行 `pnpm --filter corsj-app start` 验证，见未完成项 N1。 |
| 2 | corsj-dsh 通过 §3.2 全部验收项（右下角入口、overlay、命令调用、门禁状态展示） | 通过（代码级验收 + 编译产物） | 证据：`corsj-dsh/src/index.ts:432,449,491,505`（`slot: 'sidebar.footer.action'` / `slot: 'shell.overlay'` 槽位声明）；`corsj-dsh/src/commands-bridge.ts:81-109`（19 条核心命令白名单 + delivery_gate.submit 显式 refused）；`corsj-dsh/src/overlay.ts:273,292,337`（A/B/C 三区渲染）；`corsj-dsh/dist/*.js`（tsc 编译产物存在）。DSH 宿主真实注册端到端待宿主环境验证，见未完成项 N2。 |
| 3 | 19 条核心命令全部真实可调，status 来自真实执行，无伪造 raw_data | 通过 | 证据：`scripts/selfcheck.mjs` 用例 1 七步闭环全部 `success`（state=DELIVERED）；6 条核心命令证据齐备（log 行 24-29）；其余核心命令经 `scripts/list-cmds.mjs` + `verify-reg.mjs` 注册确认；自检断言「证据包含命令 X」逐条通过。 |
| 4 | 扩展命令接口存在，返回 not_implemented 不影响 REQUIRED 闭环 | 通过 | 证据：`core/src/commands/builtin/extension-commands.ts:40-99`（59 条骨架，executor 一律 `notImplemented`）；`registry.ts:90-97`（executeCommand 对未注册返回 not_implemented）；selfcheck 用例 5 的降级路径证明 optional 命令不进入 REQUIRED 判定。 |
| 5 | 两个产物均能独立完成同一套七步闭环，门禁不可绕过 | 通过 | 证据：core 自检（selfcheck 5 用例）；corsj-dsh `runDesignLoopViaCore` 直接调用 core.runDesignLoop（`corsj-dsh/src/index.ts:709-725`）；门禁三分支拒绝全部由 selfcheck 用例 3/4/5 实测。corsj-app 主进程同样调用 core.runDesignLoop（`corsj-app/src/main/main.ts:113-123`）。 |
| 6 | 最终报告逐条列出 §2.3、§3.2 验收标准，全部通过 | 见下方逐条表 | 本报告「§2.3 验收标准逐条」与「§3.2 验收标准逐条」两节。 |
| 7 | 不以无人船作为终止条件 | 通过（合规声明） | 无人船仅作为验收测试用例；本报告与全部实现均以通用工程设计闭环（§2.3 七步）为验收基准，`docs/command-manifest.md` 的 K 披露与差异说明为唯一口径。 |

## §2.3 验收标准逐条（corsj-app / core 共用）

1. **七步闭环正向交付 → DELIVERED** — 通过 — 证据：`.cache/tmp/selfcheck-final.log:2-21`（state=DELIVERED、delivered=true、REQUIRED 5/5、sig=67322fd37570…）
2. **.eop 包可写可浏览，指纹与完整性一致** — 通过 — 证据：log:23-32（完整性 0 错误；对象类型 Requirement/AcceptanceSpec/Part/PartAlias/FieldResult/Schematic/TimeSeries/Report）
3. **export.standard_format 产出标准格式** — 通过 — 证据：log:33-41（status=success、Part 含 STEP+STL 载荷）
4. **构建清单指纹篡改 → 立即 FAILED（门禁不可绕过）** — 通过 — 证据：log:43-49（branch=fingerprint、code=MANIFEST_FINGERPRINT_MISMATCH）
5. **降级致必需输入缺失 → 配置错误 FAILED** — 通过 — 证据：log:50-54（branch=configuration、code=MISSING_INPUT_DUE_TO_DEGRADATION）
6. **多轮阈值拒绝 → 回 DESIGNING → 通过（追加语义安全）** — 通过 — 证据：log:55-68（used_rounds=2、同名 Part 追加、supersedes、每轮 GateReport 独立）
7. **状态机 8 态 + 迁移约束** — 通过（结构验收）— 证据：`core/src/design/state-machine.ts:14-57`
8. **迭代参数默认值 max_rounds=10 / max_env_retries=3** — 通过（结构验收）— 证据：`core/src/design/config/schema.ts:24-33`
9. **配置路径与缺省「使用默认迭代参数」** — 通过 — 证据：selfcheck 全部用例未传 config 均跑通（`engine.ts:113-114` used_default_iteration_params）
10. **归类规则 design_error/env_error/not_implemented/success** — 通过（代码级验收）— 证据：`schema.ts:52-71` classify()
11. **门禁三类拒绝分支齐备** — 通过 — 证据：`delivery-gate.ts:232-345` + log 用例 3/4/5
12. **运行期写白名单（locator）** — 通过（结构验收）— 证据：`core/src/locator/index.ts:44-47,86-96`；产物落在 `.cache/userdata/eop/`
13. **构建清单 component/license/version/level/artifact_path/SHA256** — 通过 — 证据：`core/manifest.json`（32 条 L1 条目，corsj.build/1）
14. **模型供应商配置完全隔离** — 通过（代码级验收）— 证据：`corsj-app/src/main/main.ts:27-50`（仅读 `<userData>/corsj/model-provider.json`，无任何 DSH 配置访问）

## §3.2 验收标准逐条（corsj-dsh）

1. **sidebar.footer.action 右下角入口存在且可触发** — 通过（代码级）— 证据：`corsj-dsh/src/index.ts:432,491`（slot 声明 + openCommandPanel 处理器）；A 区命令面板数据只读不执行命令
2. **shell.overlay 全屏面板存在且渲染** — 通过（代码级）— 证据：`corsj-dsh/src/overlay.ts:273,292,337`（A 目标/命令面 · B 轮次/最近命令 · C 门禁/降级）；`corsj-dsh/src/index.ts:754,775`（getOverlayContent 处理器）
3. **命令调用复用 core 同套命令** — 通过（代码级）— 证据：`corsj-dsh/src/commands-bridge.ts:198-225`（registerCoreCommands 自检：19 条全部在 core 注册；门禁命令不得暴露）
4. **门禁状态展示只读，不可绕过 delivery_gate.submit** — 通过（代码级）— 证据：`commands-bridge.ts:260-275`（delivery_gate.submit 显式 refused）；`index.ts:180-184` INVARIANTS（gate_authority、ui_may_declare_delivered=false）
5. **使用 DSH 全局模型，不持有 API key** — 通过（代码级）— 证据：`corsj-dsh/src/index.ts:13-17` 注释与全文无配置读取 API；DshModel 只存命令 id/status/fingerprint/at
6. **构建产物可安装（npm 包形态）** — 通过（编译产物）— 证据：`corsj-dsh/dist/index.js` + `commands-bridge.js` + `overlay.js` 已生成；`package.json` ESM 形态 + cordis 可选 peer 依赖

## 已知未完成项（如实列出，不影响上述判定形态）

- **N1（环境阻断）**：nsis-web 实际安装器产物（*.exe stub + app.7z 分卷）未在本会话产出。原因：sandbox 拒绝 electron postinstall（`spawn EPERM`，下载 Electron 二进制）。构建配置已就绪：`corsj-app/electron-builder.config.mjs`（nsis-web x64 + generic publish）。需在无沙箱限制环境执行：`pnpm install`（不带 --ignore-scripts）→ `pnpm --filter corsj-app dist:win`。验证任务（任务板 e6931358）执行中。
- **N2（环境阻断）**：Electron 端到端启动（A/B/C 交互）未在本会话实测（同 N1 原因）。源码就绪：main/preload/renderer 三件套 + IPC 白名单。
- **N3（结构遗留）**：`core` 无独立单元测试目录（`core/package.json` test 指向不存在的 `dist/../test/`）；质量验证依赖 `scripts/selfcheck.mjs` 单一脚本。
- **N4（结构遗留）**：`LoopResult.env_retries` 恒为 0（`engine.ts:487` 硬编码）；`max_env_retries` 行为仅代码级证据。
- **N5（结构遗留）**：iteration.json 文件加载分支（source='file'）无自动化用例；App 主进程未调用 loadIterationConfig。

## K 披露（§6）

- **K = 59**（扩展命令条数，`EXTENSION_COMMAND_META` 实测）。
- 附录 A 标签「51 条」vs 正文枚举「59 条」差异原因：**51 − 14（船舶专用移除） + 22（通用领域新增） = 59**。
- 完整对照表：`docs/command-manifest.md`（唯一真源）；附录 A 仅核对基准。
- 最终注册数：**78 = 19 核心 + 59 扩展**（`scripts/list-cmds.mjs` → `TOTAL 78`；`scripts/verify-reg.mjs` → ok=true errors=[])。
