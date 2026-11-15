# 迭代循环参数与状态机说明

适用范围：`@corsj/core` B 层设计循环（阶段一）。迭代参数**只影响循环控制，不参与验收判定**；AcceptanceSpec 的阈值不由本配置覆盖（任务书附录 B，见 `core/src/design/config/schema.ts:4-5`）。

## 0. 代码位置一览

| 内容 | 位置 |
| --- | --- |
| 状态机（状态域 / 迁移表 / 非法迁移） | `core/src/design/state-machine.ts` |
| 迭代参数 schema 与默认值、归类规则 | `core/src/design/config/schema.ts` |
| 配置文件加载（路径解析 / 缺省行为） | `core/src/design/config/loader.ts` |
| 循环驱动（计轮 / env_error 重试 / used_default 标记） | `core/src/design/engine.ts` |
| 交付门禁（三类拒绝分支） | `core/src/design/delivery-gate.ts` |
| 公共导出 | `core/src/design/index.ts:27-32`（`DEFAULT_ITERATION_CONFIG`、`DEFAULT_ITERATION_PARAMS`、`IterationConfig`、`IterationParams`、`ITERATION_CONFIG_FILENAME`、`loadIterationConfig`） |

构建产物指纹（`core/manifest.json`，`corsj.build/1`）：

- `design/config/schema.js` sha256 `afb10e67b40048db59daa751165b9b45916c6b7cc09178c54e3d6c135e88a31b`
- `design/config/loader.js` sha256 `ccce13f3edcf7dd879bca19f815ddda658211e94aa42ebed8e7119b6f2ed1650`
- `design/state-machine.js` sha256 `588e49870b064d88cc17292f8f0a07810d16c4ecc541e0d89ad9275cde7da027`
- `design/delivery-gate.js` sha256 `f291b37c8ee36bc66cf947e9349721485b18ca6b35e2970cfac5c98b3b397161`

## 1. 状态机

状态域固定 8 态（`state-machine.ts:14-23`，任务书 §2.2）：

```
PARSING → SPEC_READY → DESIGNING → TESTING → VERIFYING → DELIVERING → DELIVERED
                                                                  ↘ FAILED（任一环节不可恢复错误）
```

允许的迁移表（`state-machine.ts:28-37`）：

| 当前状态 | 允许迁移 |
| --- | --- |
| PARSING | PARSING（原地重试）、SPEC_READY、FAILED |
| SPEC_READY | DESIGNING、FAILED |
| DESIGNING | TESTING、FAILED |
| TESTING | VERIFYING、FAILED |
| VERIFYING | DELIVERING、DESIGNING（门禁拒绝且计一轮）、FAILED |
| DELIVERING | DELIVERED、DESIGNING（保留回退边）、FAILED |
| DELIVERED | （终态，无出边） |
| FAILED | （终态，无出边） |

不可绕过约束（`state-machine.ts:7-11`）：

1. 只有 `DELIVERED` 是交付成功态，且只能由门禁命令 `delivery_gate.submit` 触发——`deliveryGateSubmit` 是全库唯一返回 `decision='delivered'` 的函数（`delivery-gate.ts:226-229`）。
2. `FAILED` 为终态；任一环节的不可恢复错误直接进入。
3. VERIFYING 判定失败 → 回 DESIGNING 并计一轮（受 `max_rounds` 限制，`engine.ts:269-271`、`delivery-gate.ts:327-345`）。
4. `env_error` 不计入轮次，但受 `max_env_retries` 限制（`engine.ts:389-393`）。
5. 非法迁移抛 `StateTransitionError`（`state-machine.ts:49-57`），实例带完整迁移历史 `timeline`（`state-machine.ts:68-79`）。

引擎实际驱动路径：VERIFYING 提交门禁后，放行则 `VERIFYING → DELIVERING → DELIVERED`（`engine.ts:266-268`），计轮拒绝则 `VERIFYING → DESIGNING`，其余拒绝 `→ FAILED`（`engine.ts:269-274`）。

## 2. 迭代参数 schema 与默认值

schema 位置：**`core/src/design/config/schema.ts`**（发布件 `core/dist/design/config/schema.js`，已登记构建清单）。

```ts
interface IterationParams {
  max_rounds: number;      // 轮数上限（design_error / 阈值未过的设计迭代计数）。默认 10。
  max_env_retries: number; // 环境异常重试上限（env_error 连续重试）。默认 3。
}

interface IterationConfig {
  config_version: 'corsj.iteration/1';
  params: IterationParams;
  source: 'file' | 'default';  // 记录该配置是文件加载还是缺省默认
  loaded_from?: string;        // source=file 时的文件路径
}
```

默认值（`schema.ts:24-33`）：

```ts
DEFAULT_ITERATION_PARAMS = { max_rounds: 10, max_env_retries: 3 }
DEFAULT_ITERATION_CONFIG  = { config_version: 'corsj.iteration/1', params: DEFAULT_ITERATION_PARAMS, source: 'default' }
```

校验规则（`schema.ts:36-50`，`validateIterationConfig`）：

- `config_version` 必须为字符串 `corsj.iteration/1`；
- `params.max_rounds` 必须为 1–1000 的整数；
- `params.max_env_retries` 必须为 0–100 的整数；
- 其余任何形状都判无效。

## 3. 配置文件路径与加载

文件名固定 `iteration.json`（`ITERATION_CONFIG_FILENAME`，`loader.ts:18`）。示例：

```json
{
  "config_version": "corsj.iteration/1",
  "params": { "max_rounds": 10, "max_env_retries": 3 }
}
```

路径解析（`loader.ts:20-31`，`core/src/locator/index.ts:76-77,100-113`）：

| 场景 | 路径 | 说明 |
| --- | --- | --- |
| 运行期默认（user 模式） | `<userData>/corsj/config/iteration.json` | locator user 模式 `userDataRoot = <Electron userData>/corsj`（`locator/index.ts:110-113`），`configPath('iteration.json') = <userDataRoot>/config/iteration.json`（`locator/index.ts:76-77`）；App 侧同值根 `corsjConfigRoot()`（`corsj-app/src/main/main.ts:28-30`） |
| 开发期默认（dev 模式） | `<工作区根>/.cache/config/iteration.json` | `loader.ts:26-27` 显式拼接；无 `devWorkspaceRoot` 参数时用对称路径 `<locator.userDataRoot()>/../config/iteration.json`（即 `.cache/userdata/../config`，`loader.ts:28-31`） |

加载优先级（`loadIterationConfig`，`loader.ts:22-47`）：

1. 运行期路径存在 → 读取并校验，`source='file'`、`loaded_from=<路径>`；
2. 否则开发期路径存在 → 同上；
3. 都不存在 → 返回 `DEFAULT_ITERATION_CONFIG`（缺省行为）。

**缺省行为：使用默认迭代参数**（`loader.ts:6-8`、`loader.ts:47`）。`source='default'` 会一路带回，最终报告必须记录「使用默认迭代参数」：`LoopResult.used_default_iteration_params`（`engine.ts:113-114`，取值 `opts.config === undefined`，`engine.ts:490`），同时 `LoopResult.max_rounds` / `max_env_retries` 回显生效值（`engine.ts:111-112,488-489`）。引擎构造兜底：`opts.config ?? DEFAULT_ITERATION_CONFIG`（`engine.ts:157`）。

无效配置不回退默认：文件存在但校验失败或 JSON 解析失败 → 抛 `ITERATION_CONFIG_INVALID: <路径>: <原因>`（`loader.ts:37-45`），硬失败优于静默降级。

现状说明：当前工作区 `.cache/config/` 尚未创建，开发期两处候选路径均不存在，**缺省分支实际生效**（自检未传 `config`，`used_default_iteration_params=true`）。

## 4. 运行结果归类规则

A 层命令结果状态域（任务书 §2.1，`schema.ts:52-53`）：`'success' | 'design_error' | 'env_error' | 'not_implemented'`。

归类函数 `classify(status, thresholdsPassed)`（`schema.ts:64-71`，规则源自附录 B）：

| status | thresholdsPassed | FailureClass | 计数语义 |
| --- | --- | --- | --- |
| `design_error` | 任意 | `design_iteration` | 设计不合格迭代，**计一轮** |
| `env_error` | 任意 | `env_retry` | 环境异常重试/阻塞，**计重试、不计轮数**（上限 `max_env_retries`，连续重试由引擎执行，`engine.ts:389-393`） |
| `not_implemented` | 任意 | `not_counted` | **不计轮数、不触发参数修改** |
| `success` | `false`（阈值未过） | `design_iteration` | 设计不合格迭代，**计一轮** |
| `success` | `true` | `passed` | 通过 |
| `success` | `null`（无阈值可判） | `not_counted` | 不计 |

## 5. 门禁三类拒绝分支

门禁是唯一交付出口，优先级：**完整性类问题（指纹/证据/配置）优先于阈值类问题**——判定基础不可信时，任何「通过」都无意义（`delivery-gate.ts:11-12`）。

| # | 分支 | code | next_state | counts_round | 触发条件 | 位置 |
| --- | --- | --- | --- | --- | --- | --- |
| 2a | fingerprint | `SPEC_FINGERPRINT_MISMATCH` | FAILED | 否 | AcceptanceSpec 冻结后哈希变化 | `delivery-gate.ts:232-241` |
| 2b | fingerprint | `MANIFEST_FINGERPRINT_MISMATCH` | FAILED | 否 | 构建清单 expected ≠ actual（运行期被改） | `delivery-gate.ts:243-252` |
| 2c | fingerprint | `EVIDENCE_FINGERPRINT_MISMATCH` | FAILED | 否 | 包指纹变化或载荷哈希完整性失败 | `delivery-gate.ts:254-263` |
| 3 | configuration | `MISSING_INPUT_DUE_TO_DEGRADATION` | FAILED | 否 | 降级导致 REQUIRED 验证项必需输入缺失（配置错误） | `delivery-gate.ts:265-280`、引擎侧 `engine.ts:305-329` |
| 1 | threshold | `THRESHOLD_NOT_MET` | DESIGNING | **是** | REQUIRED 判定失败且剩余轮数 > 0 | `delivery-gate.ts:327-345` |
| 1 | threshold | `ROUNDS_EXHAUSTED` | FAILED | 否 | REQUIRED 失败且 `max_rounds - used_rounds ≤ 0` | `delivery-gate.ts:327-345` |
| — | 放行 | `DELIVERED` | DELIVERED | 否 | 全部 REQUIRED 通过（optional/降级不计为通过） | `delivery-gate.ts:347-358` |

判定顺序即上表顺序：spec 指纹 → 清单指纹 → 包完整性 → 配置 → 逐项阈值 → 放行。三类拒绝分支均有自检负测/正测覆盖（`.cache/tmp/selfcheck-final.log` 用例 1/3/4/5）。

## 6. 参数与验收判定的边界

- `max_rounds` 只决定「回 DESIGNING 重试多少次后判 `ROUNDS_EXHAUSTED`」；`max_env_retries` 只决定「单条命令 env_error 连续重试多少次后放弃」。
- 两者都不会修改、覆盖或放宽 AcceptanceSpec 的任何阈值（`schema.ts:4-5`）；门禁阈值判定只在 B 层 `delivery-gate.ts` 中执行。
