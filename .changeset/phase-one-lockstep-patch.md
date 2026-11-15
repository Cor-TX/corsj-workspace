---
'@corsj/core': patch
'corsj-app': patch
'@corsj/dsh': patch
---

阶段一收尾 patch：三个包统一同组发布（locked 版本）。

- **@corsj/core**：新增 B 层迭代参数子系统——`core/src/design/config/schema.ts`（`IterationParams` / `IterationConfig` / `DEFAULT_ITERATION_PARAMS`（max_rounds=10、max_env_retries=3）/ `validateIterationConfig` / `classify` 归类规则）与 `core/src/design/config/loader.ts`（运行期 `<userData>/corsj/config/iteration.json`、开发期 `.cache/config/iteration.json`，缺省时使用默认迭代参数并以 `used_default_iteration_params` 记入最终报告）；交付门禁三类拒绝分支（fingerprint / configuration / threshold）与 `docs/iteration-params.md`、`docs/phase1-report.md` 文档。
- **corsj-app**：跟随核心版本号（locked 版本锁定，与 @corsj/core 同步 patch bump）；Electron 主进程配置根 `<userData>/corsj/` 与运行期迭代配置路径保持一致。
- **@corsj/dsh**：跟随核心版本号（locked 版本锁定，与 @corsj/core 同步 patch bump）。

> 版本锁定说明：三个包必须**同号发布**（版本号完全一致，如 `0.1.1`）。App 与 DSH 插件各自打包内嵌同一份 `@corsj/core` 构建产物，版本不一致会导致 `.eop` 包内 `core_version`、构建清单指纹与门禁校验对不上。因此执行 `changeset version` 后，须运行 `node scripts/version-sync.mjs` 把 `CORE_VERSION` 常量同步为 `core/package.json` 的新版本，再统一构建、统一发版。
