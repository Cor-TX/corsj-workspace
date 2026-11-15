# corsj-workspace

corsj 通用工程设计系统工作区。

- `core/` — 共享核心 `@corsj/core`（对象模型 / A 层命令 / B 层设计循环与门禁 / locator / ui-contract / 内置清单）
- `corsj-app/` — 独立软件 corsj（Electron）：A/B/C 三区 UI、nsis-web 安装器、模型供应商完全隔离
- `corsj-dsh/` — DSH 插件 dsh-corsj：sidebar.footer.action 入口 + shell.overlay 全屏 + 复用 core 同套命令
- `docs/` — 命令清单对照表、迭代参数说明、阶段一验收报告
- `scripts/` — 自检与发布辅助脚本
- `.changeset/` — 版本锁定变更集

## 开发

```bash
pnpm install
pnpm build          # 构建 core、corsj-app、dsh-corsj（corsj-dsh 目录）
pnpm selfcheck      # 运行阶段一七步闭环自检（含门禁负例）
pnpm --filter corsj-app dist:win   # electron-builder nsis-web 安装器
```

阶段验收说明见 `docs/`；阶段一验收标准：任务书 §2.3；终止条件：§7 全部七条。
