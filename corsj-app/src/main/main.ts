/**
 * corsj-app — Electron 主进程。
 *
 * 职责：
 * - 承载 @corsj/core 七步设计闭环（runDesignLoop / DesignSession）在主进程真实执行；
 * - 流式运行：逐轮经 webContents.send('corsj:event') 推送进度，B/C 区实时更新；
 * - 模型供应商配置完全隔离：<userData>/corsj/model-provider.json，绝不读 DSH 配置；
 * - .eop 对象包导入 / 标准格式导出（复用 core 同套 executeCommand）；
 * - IPC 白名单：渲染器只能调用这里显式注册的通道。
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { createRequire } from 'node:module';

// @corsj/core 是 ESM 包（type: module）；CJS 主进程通过 createRequire 解析路径 + 动态 import 桥接。
const nodeRequire = createRequire(__filename);
const corePath = nodeRequire.resolve('@corsj/core/dist/index.js');
const coreCache: { mod?: Record<string, any> } = {};
async function core(): Promise<Record<string, any>> {
  if (!coreCache.mod) coreCache.mod = (await import(corePath)) as unknown as Record<string, any>;
  return coreCache.mod;
}

const isDev = !app.isPackaged;

/** 应用专属配置根：<userData>/corsj —— 与 DSH/其他应用完全隔离。 */
function corsjConfigRoot(): string {
  return path.join(app.getPath('userData'), 'corsj');
}

/** 模型供应商配置文件（应用私有，不入 .eop，不出现在任何报告）。 */
function modelProviderConfigPath(): string {
  return path.join(corsjConfigRoot(), 'model-provider.json');
}

function readModelProviderConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(modelProviderConfigPath(), 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { configured: false, providers: [] };
  }
}

async function writeModelProviderConfig(cfg: Record<string, unknown>): Promise<void> {
  await fsp.mkdir(corsjConfigRoot(), { recursive: true });
  await fsp.writeFile(modelProviderConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'corsj — 通用工程设计系统',
    backgroundColor: '#10141a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// IPC 白名单（渲染器可见的完整 API 面）
// ---------------------------------------------------------------------------

const ipc = ipcMain.handle.bind(ipcMain);

/** 系统信息（A 区头）。 */
ipc('corsj:sysinfo', async () => {
  const c = await core();
  const reg = c.commands.verifyRegistry();
  return {
    core_version: c.CORE_VERSION,
    app_version: app.getVersion(),
    platform: process.platform,
    commands_total: reg.counts?.total ?? 0,
    registry_ok: reg.ok,
    registry_errors: reg.errors,
    config_root: corsjConfigRoot(),
    model_provider_configured: readModelProviderConfig().configured === true,
  };
});

/** 能力清单（A 区：命令面板）。 */
ipc('corsj:list-commands', async () => (await core()).commands.listCapabilities());

/** 一次性运行七步设计闭环（保留兼容）。 */
ipc('corsj:run-design-loop', async (_e, opts: Record<string, unknown>) => {
  const c = await core();
  const devRoot = isDev ? path.resolve(app.getAppPath(), '..') : app.getPath('userData');
  const runOpts: Record<string, unknown> = {
    ...opts,
    coreVersion: c.CORE_VERSION,
    devRoot,
    packageId: `PKG-${Date.now().toString(36).toUpperCase()}`,
  };
  return c.design.runDesignLoop(runOpts);
});

/** 流式运行七步闭环：逐轮推送 corsj:event（B/C 区实时更新）。 */
ipc('corsj:run-stream', async (_e, opts: Record<string, unknown>) => {
  const c = await core();
  const devRoot = isDev ? path.resolve(app.getAppPath(), '..') : app.getPath('userData');
  const send = (ev: unknown): void => { if (win && !win.isDestroyed()) win.webContents.send('corsj:event', ev); };
  const session = new c.design.DesignSession({
    ...opts,
    coreVersion: c.CORE_VERSION,
    devRoot,
    packageId: `PKG-${Date.now().toString(36).toUpperCase()}`,
  });
  send({ type: 'phase', state: 'PARSING', reason: '规格生成中' });
  const parsed = await session.parseAndSpec();
  send({ type: 'phase', state: parsed.state, reason: parsed.errors.length ? '规格生成失败' : '规格已生成', errors: parsed.errors, clarifications: parsed.clarifications });
  if (parsed.errors.length === 0 && parsed.clarifications.length === 0) {
    const plans = Array.isArray(opts.plan) ? (opts.plan as Record<string, unknown>[]) : [];
    for (const plan of plans) {
      const round = await session.runRound(plan);
      send({ type: 'round', round });
      if (session.state === 'DELIVERED' || session.state === 'FAILED') break;
    }
  }
  const persisted = await session.persist();
  const view = await c.model.loadView(persisted.path);
  send({ type: 'done', state: session.state, delivered: session.state === 'DELIVERED', package_path: persisted.path, package_fingerprint: session.package.fingerprint(), view });
  return { state: session.state, delivered: session.state === 'DELIVERED', package_path: persisted.path };
});

/** 读 .eop 视图（C 区浏览）。 */
ipc('corsj:load-view', async (_e, packagePath: string) => (await core()).model.loadView(String(packagePath)));

/** 导入历史 .eop 对象包并返回视图（C 区浏览）。 */
ipc('corsj:import-eop', async (_e, packagePath: string) => (await core()).model.loadView(String(packagePath)));

/** 从 .eop 导出标准格式（交付导出，复用 core 同套 executeCommand）。 */
ipc('corsj:export-format', async (_e, opts: Record<string, unknown>) => {
  const c = await core();
  const pkg = await c.model.loadEop(String(opts.package_path));
  const ctx = {
    pkg,
    run: 1,
    scratchDir: path.join(app.getPath('userData'), 'corsj', 'scratch'),
    assets: c.design.createUnavailableAssetResolver(),
  };
  return c.commands.executeCommand('export.standard_format', { object_id: String(opts.object_id ?? ''), format: String(opts.format ?? 'json') }, ctx);
});

/** 列出 .eop 内产物（B 区浏览）。 */
ipc('corsj:list-artifacts', async (_e, packagePath: string) => (await core()).model.loadView(String(packagePath)));

/** 模型供应商配置（应用私有；与 DSH 无任何读取关系）。 */
ipc('corsj:model-provider:get', async () => readModelProviderConfig());
ipc('corsj:model-provider:set', async (_e, cfg: Record<string, unknown>) => {
  await writeModelProviderConfig(cfg);
  return { ok: true, path: modelProviderConfigPath() };
});
