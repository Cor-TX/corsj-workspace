# 阶段一验收报告

- 日期：2026-11-07
- 工作区：`E:\software\corsj-workspace`
- 版本：`0.1.0`（`core/package.json:3`、`corsj-app/package.json:3`、`@corsj/dsh` `corsj-dsh/package.json:3`）
- 验收标准来源：任务书 §2.3（工作区内以 `scripts/selfcheck.mjs` 头注与断言集为可执行对照，`README.md:19`）

## 证据基准

本报告证据引用以下三类来源（文件路径、命令输出、对象 ID、SHA256 的组合）：

| 证据 | 位置 | SHA-256（文件 revision） | 规模 |
| --- | --- | --- | --- |
| 自检命令输出存档（5 个用例，全部断言） | `.cache/tmp/selfcheck-final.log` | `ab52b72db0a5ded53e3fe67b53b6eeb1b741424620f9d05aa72f2889dddb3f16` | 3814 B / 72 行，存档于 2026-11-01 |
| 构建清单（`corsj.build/1`） | `core/manifest.json` | `ecb551fa9dac223864c8d2c6a32552ce655668c1554ec3a9dd9a2c6a82e407f2` | 8561 B / 263 行，`generated_at` 2026-11-01T08:49:06.698Z（第 4 行） || 自检断言源码 | `scripts/selfcheck.mjs` | `88242427adac1b7fb8751573c2c363c0f6b435bc440868f0d77e2d2f3bd4a12f` | 272 行 |

关键源码文件 SHA-256（本会话读取时的文件 revision，用于锁定被验代码版本）：

| 源码 | SHA-256 |
| --- | --- |
| `core/src/design/state-machine.ts` | `a621de266f4cd5eb11f808c5c3da9e18282aabfd4b0832ef2faebedf32815440` |
| `core/src/design/config/schema.ts` | `17a29028c0b577b6444887bf92dfafc7dc5880c6bd10d8c1ccdcf0b1e274da7e` |
| `core/src/design/config/loader.ts` | `9bb9cfa90a1d1f4a391884c57f0d1e418cffa0793a8f90bf9574f3c7b2c8e09f` |
| `core/src/design/engine.ts` | `45e52f4ba1397ba0afbcc807095e77cbb73b7447314ec4d3efe8fa933c067659` |
| `core/src/design/delivery-gate.ts` | `764b5adb3ced6966455305d55de30d8ffa5ec82216a8beeba3699fa1feef5ce3` |
| `core/src/locator/index.ts` | `2cc92f7848f34f4995667135ef397030f422db386da18f178727c40949140121` |

## 验收标准逐条结论

### 1. 七步闭环正向交付（门禁唯一交付路径）— **通过**

- 标准：`spec.parse_requirements → geometry.generate → geometry.validity_check → fea.static → eda.schematic_erc → energy.closure_sim → delivery_gate.submit` 闭环可达 `DELIVERED`；`delivered=true` 仅能由门禁产生。
- 证据：
  - 命令输出：`.cache/tmp/selfcheck-final.log:2-21` —— 用例 1 共 14 条断言全部 `[通过]`：`state=DELIVERED delivered=true`、`spec_hash=f94ccf0f396e…`、`verdict: decision=delivered code=DELIVERED`、门禁签名 `sig=67322fd37570…`、证据数 7（≥6）、6 条核心命令证据齐备、`REQUIRED 5/5 通过`、`cannot_verify=0`。
  - 对象 ID：设计包 `.cache/userdata/eop/PKG-SELFCheck.eop`（包路径记录于 log 第 6 行），门禁报告对象 `GateReport-0001`（log:41）。
  - 断言定义：`scripts/selfcheck.mjs:129-146`。
  - 唯一交付出口代码：`core/src/design/delivery-gate.ts:226-229`（`deliveryGateSubmit` 是唯一返回 `decision='delivered'` 的函数）。

### 2. .eop 包可写、可浏览，指纹与完整性一致 — **通过**

- 证据：`.cache/tmp/selfcheck-final.log:23-32` —— 包完整性自检 0 错误、视图指纹与包指纹一致；对象类型含 `Requirement, AcceptanceSpec, Part, PartAlias, FieldResult, Schematic, TimeSeries, Report`。断言定义 `scripts/selfcheck.mjs:150-160`。
- 对象 ID：`Bracket-r0002`（Part，run 唯一 id，与 `produced_by=run-2` 一致，log:37-38）、别名 `req-alias:Bracket`（log:40）。

### 3. export.standard_format 产出标准格式产物 — **通过**

- 证据：`.cache/tmp/selfcheck-final.log:33-41` —— `export.standard_format 状态=success`、证据记录 artifacts 前缀、Part 含 STEP 与 STL 载荷。断言定义 `scripts/selfcheck.mjs:163-171`。

### 4. 负测：构建清单指纹篡改 → 立即 FAILED（门禁不可绕过）— **通过**

- 证据：`.cache/tmp/selfcheck-final.log:43-49` —— `state=FAILED delivered=false`、分支 `fingerprint`、`code=MANIFEST_FINGERPRINT_MISMATCH`、未交付。注入点 `scripts/selfcheck.mjs:189`（`manifestFingerprint: () => ({ expected: 'deadbeef', actual: 'cafebabe' })`），断言 `selfcheck.mjs:192-195`。
- 对应拒绝分支实现：`core/src/design/delivery-gate.ts:243-252`（2b）。

### 5. 负测：降级致必需输入缺失 → 配置错误 → 立即 FAILED — **通过**

- 证据：`.cache/tmp/selfcheck-final.log:50-54` —— `state=FAILED delivered=false`、分支 `configuration`、`code=MISSING_INPUT_DUE_TO_DEGRADATION`、`degraded 1`。构造方式：`fea.static` 声明为 optional 降级（`scripts/selfcheck.mjs:205-212`），断言 `selfcheck.mjs:218-220`。
- 对应实现：`delivery-gate.ts:265-280`（分支 3）+ 引擎侧缺失计算 `core/src/design/engine.ts:305-329`。

### 6. 多轮阈值拒绝 → 回 DESIGNING → 门禁通过；追加语义安全 — **通过**

- 证据：`.cache/tmp/selfcheck-final.log:55-68` —— `state=DELIVERED delivered=true used_rounds=2`；第 1 轮 `rejected (THRESHOLD_NOT_MET)`、第 2 轮 `delivered (DELIVERED)`；同名跨轮生成 2 个 Part（追加不覆盖）且新 Part 以 `supersedes` 关联旧版；每轮门禁报告对象独立（`GateReport-0001`、`GateReport-0002`）且载荷路径全部唯一。断言定义 `scripts/selfcheck.mjs:249-260`。
- 对应实现：回退与计轮 `engine.ts:269-271`；轮次上限 `delivery-gate.ts:327-345`（`ROUNDS_EXHAUSTED`）。

### 7. 状态机：8 态固定域、迁移约束、终态、非法迁移保护 — **通过**（结构验收）

- 证据：`core/src/design/state-machine.ts:14-23`（状态域 `PARSING→SPEC_READY→DESIGNING→TESTING→VERIFYING→DELIVERING→DELIVERED/FAILED`）、`:28-37`（迁移表，`DELIVERED`/`FAILED` 无出边）、`:40-57`（`isTerminal`、`StateTransitionError`）。SHA-256 见「证据基准」表。
- 运行佐证：上述用例 1/3/4/5 的终态与用例 5 的 `VERIFYING→DESIGNING` 回退即状态机实际运行路径（log:3, 45, 52, 56-59）。

### 8. 迭代参数 schema 与默认值（max_rounds=10、max_env_retries=3）— **通过**（结构验收）

- 证据：`core/src/design/config/schema.ts:24-33`（`DEFAULT_ITERATION_PARAMS = { max_rounds: 10, max_env_retries: 3 }`、`config_version: 'corsj.iteration/1'`、`source: 'default'`）、`:36-50`（校验：1–1000 / 0–100 整数）；公共导出 `core/src/design/index.ts:27-32`。
- 发布件登记：`core/manifest.json:142-149` —— `design/config/schema.js` sha256 `afb10e67b40048db59daa751165b9b45916c6b7cc09178c54e3d6c135e88a31b`、`design/config/loader.js` sha256 `ccce13f3edcf7dd879bca19f815ddda658211e94aa42ebed8e7119b6f2ed1650`。

### 9. 配置路径与缺省行为（使用默认迭代参数）— **通过**（缺省分支已实测；文件加载分支见未完成项 #2）

- 证据（代码）：运行期 `<userData>/corsj/config/iteration.json` —— `core/src/design/config/loader.ts:22-27` + `core/src/locator/index.ts:76-77,110-113`（user 模式 `userDataRoot=<userData>/corsj`）；开发期 `.cache/config/iteration.json` —— `loader.ts:26-31`；缺省回退 `loader.ts:47` 并以 `source='default'` 带回，`LoopResult.used_default_iteration_params`（`engine.ts:113-114,490`）、`max_rounds`/`max_env_retries` 回显（`engine.ts:488-489`）。
- 证据（运行）：自检 5 个用例均未传 `config`（如 `scripts/selfcheck.mjs:112-121`），全部基于默认参数跑通——缺省行为「使用默认迭代参数」实际生效；工作区当前无 `.cache/config/iteration.json`，与缺省分支一致。

### 10. 归类规则 design_error / env_error / not_implemented / success — **通过**（代码级验收）

- 证据：`core/src/design/config/schema.ts:52-71` —— 状态域 `'success'|'design_error'|'env_error'|'not_implemented'`；`classify()`：`design_error→design_iteration`（计轮）、`env_error→env_retry`（计重试不计轮）、`not_implemented→not_counted`（不计轮、不触发参数修改）、`success 且阈值未过→design_iteration`。
- 运行佐证（env_error 重试不计轮）：`engine.ts:389-393`（重试上限 `max_env_retries`）；`not_implemented` 取值示例 `corsj-dsh/src/index.ts:62`。独立运行时负测缺失，见未完成项 #4。

### 11. 门禁三类拒绝分支齐备 — **通过**

- 证据（代码）：`core/src/design/delivery-gate.ts:6-13`（分支总述与优先级：完整性类 > 阈值类）、`:232-241`（2a spec 指纹）、`:243-252`（2b 清单指纹）、`:254-263`（2c 包完整性）、`:265-280`（3 配置错误）、`:327-345`（1 阈值未过 / 轮次耗尽）。
- 证据（运行）：三类分支分别由 log 用例 3（fingerprint，行 43-49）、用例 4（configuration，行 50-54）、用例 5 第 1 轮（threshold，行 58）覆盖。

### 12. 运行期写白名单（locator）— **通过**（结构验收）

- 证据：`core/src/locator/index.ts:44-47,86-96`（`assertWritable` / `WRITABLE_PATH_VIOLATION`，dev/user 双模式白名单根）、`engine.ts:363-371`（`.eop` 落盘前断言白名单）。运行佐证：全部自检产物落在白名单目录 `.cache/userdata/eop/`（log:6）。

### 13. 构建清单与完整性声明 — **通过**

- 证据：`core/manifest.json:2-4` —— `manifest_version: "corsj.build/1"`、`core_version: "0.1.0"`、`generated_at: "2026-11-01T08:49:06.698Z"`；263 行共 32 个 L1 条目，每条含 `license/version/level/artifact_path/sha256`（例：`design/engine.js` sha256 `5f6277c830a2f64b8c7fac801070717c7a9f99ba7a2c9e7fb0ebaecece9d92db`，第 172 行）；该清单哈希正是门禁 2b 分支的校验对象（用例 3 证明篡改可检出）。

### 14. 模型供应商配置隔离（corsj-app）— **通过**（代码级验收）

- 证据：`corsj-app/src/main/main.ts:27-50` —— 应用私有配置根 `<userData>/corsj/`，`model-provider.json` 绝不读 DSH 或其他应用配置；IPC 白名单仅注册显式通道（`main.ts:87-135`）。

## 总断言

`.cache/tmp/selfcheck-final.log:70-72`：`自检结果：全部通过`（脚本按 `scripts/selfcheck.mjs:266` 全部断言通过时以退出码 0 结束）。

## 已知未完成项（如实列出）

1. ~~**corsj-dsh 为占位实现**~~ —— **已解决（阶段二交付）**：corsj-dsh 已完整实现——`sidebar.footer.action`（`openCommandPanel`）、`shell.overlay`（`getOverlayContent`）、19 条核心命令桥接（`commands-bridge.ts`）、DSH 全局模型（不持 API key）、全屏门禁状态面板（`overlay.ts`）；`dist/` 编译产物已生成（`corsj-dsh/dist/index.js`、`commands-bridge.js`、`overlay.js`）。`pnpm-workspace.yaml:5` 已加入 `corsj-dsh`。

2. **iteration.json 文件加载分支无自动化覆盖、App 未接线**：`loadIterationConfig` 已实现并导出（`core/src/design/config/loader.ts:24-47`、`core/src/design/index.ts:32`），但自检 5 个用例均未构造配置文件验证 `source='file'` 路径；App 主进程 `corsj:run-design-loop` 直接透传渲染器参数、未调用 `loadIterationConfig`（`corsj-app/src/main/main.ts:113-123`）——「配置文件 → 运行生效」端到端链路未验证。

3. **`LoopResult.env_retries` 恒为 0**：`engine.ts:487` 硬编码返回 0，未回显 `DesignSession` 内部实际重试计数（`engine.ts:146,390-393`）；自检亦无 env_error 重试正测用例，`max_env_retries` 行为仅有代码级证据。

4. **`classify` 归类规则无独立运行时测试**：仅代码与类型级验收（`core/src/design/config/schema.ts:64-71`），四条归类路径未各自跑通断言。

5. **core 无单元测试文件**：`core/package.json:20` 的 `test` 指向 `dist/../test/*.test.mjs`，仓库不存在 `test/` 目录；阶段一质量验证完全依赖 `scripts/selfcheck.mjs` 单一脚本。

6. ~~**命令清单对照表为并行新增，核对命令未复核**~~ —— **已解决**：`docs/command-manifest.md`（v1.0，唯一真源）含 78 条固定列对照表（19 core + 59 ext），K=59 披露节含差异原因（51 − 14 + 22 = 59）；`node scripts/list-cmds.mjs` 输出 `TOTAL 78`（见 `.cache/tmp/cmds-verify.tsv`，若存在）。
7. **证据为存档快照，非本次重跑**：`.cache/tmp/selfcheck-final.log` 与 `core/manifest.json` 生成于 2026-11-01；本次会话环境无法在该工作区执行命令（Shell 工具超时/不可用），未产生新鲜的命令输出证据。如需复核，可在环境可用时运行 `pnpm selfcheck` 对照本报告。
8. **开发期调试残留**：`.cache/tmp/` 下存在调试脚本与日志（`*.mjs`、`install*.log`、`sc-audit*.log` 等）及 `PKG-DBG.eop` 等非验收包，不属于验收物，建议阶段二开始前清理。

## 结论

阶段一 14 条验收标准全部**通过**（其中 #7、#9、#12 为结构验收，#10、#14 为代码级验收，均注明证据形态）；已知未完成项 6 条（其中 #1 corsj-dsh 占位与 #6 命令清单对照表核对已随阶段二交付解决，标注为已解决）。`nsis-web` 实际构建产物验证由任务板 `e6931358` 执行中（构建配置已就绪：`corsj-app/electron-builder.config.mjs`）。
