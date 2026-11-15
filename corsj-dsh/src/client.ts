/**
 * @corsj/dsh — DSH 客户端半（渲染器侧）。
 *
 * 对齐 DSH 官方 UI 插件规范：./client 通过 __ModuleLoader__.load 注册懒加载工厂
 * （id = 包名 dsh-corsj），工厂返回 { inject, apply }。
 *
 * Slot 路线（sidebar.footer.action / shell.overlay / conversation.session）经搜索与
 * 宿主源码验证均不可行：sidebar.footer.action 为宿主自有渲染器、忽略自定义组件；
 * shell.overlay 为 root 级会盖住整页；conversation.session 为 single 槽位，第三方
 * 无法接管。故彻底放弃 ctx.slots，改用纯 DOM 自挂载：
 * - 右下角悬浮球（z-index 低于侧边栏，不遮导航），仅负责触发切换；
 * - 点击后在当前会话容器内渲染工作台面板（进度条 / 目标面板 / 日志区），
 *   不使用全屏遮罩，侧边栏与顶部栏不受影响。
 * 渲染器无直接 Node 权限；命令调用经 IPC 白名单通道转发到宿主。
 */
interface ModuleLoaderLike {
  load(opts: { id: string; factory(require: (id: string) => unknown): unknown }): void;
}

const loader = (globalThis as { __ModuleLoader__?: ModuleLoaderLike }).__ModuleLoader__;

if (loader) {
  loader.load({
    id: 'dsh-corsj',
    factory(require: (id: string) => unknown) {
      const CHANNEL_GET_OVERLAY = 'dsh-corsj:get-overlay';

      type IpcRendererLike = { invoke(channel: string, payload: unknown): Promise<unknown> };
      type DocLike = { createElement(tag: string): any; querySelector(sel: string): any; body: any };
      const doc = (globalThis as { document?: DocLike }).document;

      async function invoke(channel: string, payload: unknown): Promise<unknown> {
        const ipcRenderer = (globalThis as { ipcRenderer?: IpcRendererLike }).ipcRenderer;
        if (ipcRenderer && typeof ipcRenderer.invoke === 'function') return ipcRenderer.invoke(channel, payload);
        return Promise.reject(new Error('IPC 不可用：渲染器无 ipcRenderer'));
      }

      // 悬浮球 z-index 低于侧边栏（侧边栏通常 >= 2147483000），仅触发切换、不遮导航。
      const BALL_Z = '2147482000';
      const PANEL_Z = '2147482500';

      /** 定位当前会话容器；找不到则回退到视口右下角固定定位。 */
      function findSessionContainer(): any {
        if (!doc) return null;
        const candidates = ['[data-session-id]', '[data-session]', '.conversation-session',
          '.conversation', '[class*="conversation"]', '[class*="session-body"]',
          '[role="main"]', 'main'];
        for (const sel of candidates) {
          try { const el = doc.querySelector(sel); if (el) return el; } catch { /* ignore */ }
        }
        return null;
      }

      let panelEl: any = null;
      let panelHost: any = null;

      function closePanel(): void {
        if (panelEl) { panelEl.remove(); panelEl = null; }
        panelHost = null;
      }

      function el(tag: string, cls?: string, text?: string): any {
        if (!doc) return null;
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
      }

      function renderPanel(view: any): void {
        if (!doc || !doc.body) return;
        closePanel();
        panelHost = findSessionContainer() || doc.body;
        const fixed = panelHost === doc.body;

        panelEl = el('div', 'dsh-corsj-panel');
        Object.assign(panelEl.style, {
          position: fixed ? 'fixed' : 'absolute',
          right: '16px',
          bottom: fixed ? '64px' : '16px',
          width: '360px', maxHeight: '70vh', overflow: 'auto',
          zIndex: PANEL_Z, background: '#fff', color: '#1f2329',
          border: '1px solid #d0d7de', borderRadius: '10px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)', fontSize: '13px',
          boxSizing: 'border-box', padding: '12px', pointerEvents: 'auto',
        });

        const head = el('div', 'dsh-corsj-panel-head');
        Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' });
        head.appendChild(el('strong', undefined, 'corsj 工作台'));
        const closeBtn = el('button', 'dsh-corsj-panel-close', '关闭');
        Object.assign(closeBtn.style, { cursor: 'pointer', border: 'none', background: '#f3f4f6', borderRadius: '6px', padding: '2px 8px' });
        closeBtn.addEventListener('click', () => closePanel());
        head.appendChild(closeBtn);
        panelEl.appendChild(head);

        const goalBox = el('div', 'dsh-corsj-panel-goal');
        Object.assign(goalBox.style, { background: '#f6f8fa', borderRadius: '8px', padding: '8px', marginBottom: '8px' });
        goalBox.appendChild(el('div', undefined, '目标'));
        const goalText = el('div', undefined, (view && view.region_a && view.region_a.goal_summary) || '（暂无目标，请先在 DSH 中发起设计闭环）');
        Object.assign(goalText.style, { whiteSpace: 'pre-wrap', marginTop: '4px', color: '#444' });
        goalBox.appendChild(goalText);
        panelEl.appendChild(goalBox);

        const progBox = el('div', 'dsh-corsj-panel-progress');
        Object.assign(progBox.style, { marginBottom: '8px' });
        const state = (view && view.region_b && view.region_b.state) || 'IDLE';
        const round = (view && view.region_b && view.region_b.round) || 0;
        const maxRounds = (view && view.region_b && view.region_b.max_rounds) || 0;
        progBox.appendChild(el('div', undefined, '状态：' + state + '  ·  轮次：' + round + '/' + maxRounds));
        const bar = el('div');
        Object.assign(bar.style, { height: '6px', background: '#e5e7eb', borderRadius: '3px', marginTop: '4px', overflow: 'hidden' });
        const fill = el('div');
        const pct = maxRounds > 0 ? Math.min(100, Math.round((round / maxRounds) * 100)) : 0;
        Object.assign(fill.style, { width: pct + '%', height: '100%', background: '#247bbf' });
        bar.appendChild(fill);
        progBox.appendChild(bar);
        panelEl.appendChild(progBox);

        const logBox = el('div', 'dsh-corsj-panel-log');
        Object.assign(logBox.style, { background: '#0d1117', color: '#c9d1d9', borderRadius: '8px', padding: '8px', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap', maxHeight: '220px', overflow: 'auto' });
        const lines: string[] = [];
        if (view && view.region_b && Array.isArray(view.region_b.recent)) {
          for (const r of view.region_b.recent) {
            const c = r && r.command ? r.command : '?';
            const s = r && r.status ? r.status : '?';
            lines.push(c + ' -> ' + s);
          }
        }
        if (view && view.region_c && view.region_c.gate) {
          lines.push('门禁：' + (view.region_c.gate.decision || '-') + (view.region_c.gate.code ? ' (' + view.region_c.gate.code + ')' : ''));
        }
        if (lines.length === 0) lines.push('（暂无运行记录）');
        logBox.textContent = lines.join('\n');
        panelEl.appendChild(logBox);

        panelHost.appendChild(panelEl);
      }

      async function openPanel(): Promise<void> {
        if (!doc || !doc.body) return;
        if (panelEl) { closePanel(); return; }
        try {
          const res = (await invoke(CHANNEL_GET_OVERLAY, {})) as { view?: any; html?: string } | undefined;
          if (res && res.view) { renderPanel(res.view); }
          else if (res && res.html) {
            panelHost = findSessionContainer() || doc.body;
            panelEl = el('div');
            Object.assign(panelEl.style, { position: 'fixed', right: '16px', bottom: '64px', width: '360px', maxHeight: '70vh', overflow: 'auto', zIndex: PANEL_Z, background: '#fff', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)' });
            panelEl.innerHTML = res.html;
            panelHost.appendChild(panelEl);
          }
        } catch (err) {
          panelHost = findSessionContainer() || doc.body;
          panelEl = el('div', 'dsh-corsj-panel');
          Object.assign(panelEl.style, { position: 'fixed', right: '16px', bottom: '64px', width: '360px', zIndex: PANEL_Z, background: '#fff', border: '1px solid #d0d7de', borderRadius: '10px', padding: '12px', boxSizing: 'border-box' });
          panelEl.textContent = '获取工作台失败: ' + String(err);
          panelHost.appendChild(panelEl);
        }
      }

      function mount(): () => void {
        if (!doc || !doc.body) return () => {};
        const root = doc.createElement('div');
        root.className = 'dsh-corsj-root';
        Object.assign(root.style, {
          position: 'fixed', right: '16px', bottom: '16px', zIndex: BALL_Z,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px',
        });
        const ball = doc.createElement('button');
        ball.type = 'button';
        ball.className = 'dsh-corsj-ball';
        ball.title = 'corsj 工作台';
        ball.textContent = 'corsj';
        Object.assign(ball.style, {
          cursor: 'pointer', border: 'none', borderRadius: '999px',
          width: '52px', height: '52px', fontSize: '13px', fontWeight: 700, color: '#fff',
          background: '#247bbf', boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
        });
        ball.addEventListener('click', () => { void openPanel(); });
        root.appendChild(ball);
        doc.body.appendChild(root);
        return () => { root.remove(); closePanel(); };
      }

      return {
        inject: ['slots'],
        apply() {
          return mount();
        },
      };
    },
  });
}

export {};
