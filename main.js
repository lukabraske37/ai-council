/**
 * main.js — AI Council v6 — Electron Main Process
 *
 * Phase 6 changes:
 *   - runBootSelfTest() wired: called automatically after load-panes completes
 *   - Persistent history: sessionStore.init(userData) called on boot
 *   - Persistent config: providerConfig.init(userData) called on boot
 *   - registerConfigIPC() registered with getView access
 *   - registerMemoryIPC() receives userDataPath for file path IPC
 */
const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');
const { registerOrchestrationIPC }  = require('./src/ipc/orchestration-ipc');
const { registerHealthIPC, emitHealthToRenderer } = require('./src/ipc/health-ipc');
const { registerMemoryIPC }         = require('./src/ipc/memory-ipc');
const { registerExportIPC }         = require('./src/ipc/export-ipc');
const { registerConfigIPC }         = require('./src/ipc/config-ipc');
const HealthMonitor = require('./src/providers/health-monitor');
const sessionStore  = require('./src/memory/session-store');
const providerConfig = require('./src/config/provider-config');

const DEBUG = true;
function dbg(...args) { if (DEBUG) console.log('[MAIN]', ...args); }

let _healthMonitor = null;
let _engineRef     = null; // set by orchestration-ipc for boot self-test

// ─── AI LIST ────────────────────────────────────────────────────────────────
const AIS = [
  { id: 'chatgpt',    label: 'ChatGPT',    url: 'https://chatgpt.com' },
  { id: 'claude',     label: 'Claude',     url: 'https://claude.ai' },
  { id: 'gemini',     label: 'Gemini',     url: 'https://gemini.google.com' },
  { id: 'grok',       label: 'Grok',       url: 'https://grok.com' },
  { id: 'perplexity', label: 'Perplexity', url: 'https://perplexity.ai' },
  { id: 'copilot',    label: 'Copilot',    url: 'https://copilot.microsoft.com' },
];

// ─── STATE ON DISK ─────────────────────────────────────────────────────────
const stateFile = () => path.join(app.getPath('userData'), 'state.json');

const DEFAULT_STATE = {
  lastPanes: [
    { aiId: 'chatgpt', slot: 0 },
    { aiId: 'claude',  slot: 0 },
    { aiId: 'gemini',  slot: 0 },
  ],
  presets: [
    { id: 'research', name: 'Research', panes: [{ aiId: 'perplexity', slot: 0 }, { aiId: 'perplexity', slot: 1 }, { aiId: 'perplexity', slot: 2 }] },
    { id: 'writing',  name: 'Writing',  panes: [{ aiId: 'claude',     slot: 0 }, { aiId: 'claude',     slot: 1 }, { aiId: 'claude',     slot: 2 }] },
    { id: 'mixed',    name: 'Mixed',    panes: [{ aiId: 'claude',     slot: 0 }, { aiId: 'chatgpt',    slot: 0 }, { aiId: 'gemini',     slot: 0 }] },
    { id: 'council',  name: 'Council',  panes: [{ aiId: 'chatgpt',    slot: 0 }, { aiId: 'claude',     slot: 0 }, { aiId: 'gemini',     slot: 0 }, { aiId: 'grok', slot: 0 }] },
  ],
  agentDefaults: {
    mode      : 'broadcast',
    taskType  : 'default',
    providers : [],
  },
};

function loadState()  { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return structuredClone(DEFAULT_STATE); } }
function saveState(s) { fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2), 'utf8'); }

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const TOP_H        = 84;
const POPUP_TB_H   = 36;
const AGENT_PANEL_W = 460;

// ─── STATE ───────────────────────────────────────────────────────────────────
let win            = null;
let views          = [];
let agentPanelOpen = false;
let viewMap    = new Map();   // "aiId:slot" -> BrowserView
let popupViews = new Map();

// VIEW LOOKUP for OrchestrationEngine + ConfigIPC
function getView(aiId, slot = 0) {
  const view = viewMap.get(`${aiId}:${slot}`) || null;
  dbg(`getView(${aiId}, ${slot}) →`, view ? 'found' : 'null');
  return view;
}

// List all currently open provider IDs (for pre-flight check)
function listOpenProviderIds() {
  const ids = [];
  viewMap.forEach((view, key) => {
    const [aiId] = key.split(':');
    if (!ids.includes(aiId)) ids.push(aiId);
  });
  return ids;
}

// ─── MAIN WINDOW ─────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 800, minHeight: 500,
    frame: false,
    webPreferences: {
      preload         : path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration : false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('resize',     relayout);
  win.on('maximize',   () => { relayout(); win.webContents.send('win-state', 'max'); });
  win.on('unmaximize', () => { relayout(); win.webContents.send('win-state', 'normal'); });
  win.webContents.on('did-finish-load', () => {
    dbg('Main window loaded, sending init state');
    win.webContents.send('init', loadState(), AIS);
  });

  const { engineRef } = registerOrchestrationIPC(ipcMain, getView, win);
  _engineRef = engineRef;

  // ── Health Monitor ──────────────────────────────────────────────────
  _healthMonitor = new HealthMonitor(getView, (status) => {
    dbg('Health update:', status.id, status.status);
    emitHealthToRenderer(win, status);
  });
  registerHealthIPC(ipcMain, _healthMonitor, win);
  registerMemoryIPC(ipcMain);
  registerExportIPC(ipcMain, win);
  registerConfigIPC(ipcMain, getView);   // Phase 6: selector config IPC

  setTimeout(() => {
    dbg('Starting health monitor');
    _healthMonitor.start();
  }, 5000);
}

// ─── POPUP WINDOW ─────────────────────────────────────────────────────────────
function createPopup(url) {
  const popup = new BrowserWindow({
    width: 1100, height: 750, minWidth: 400, minHeight: 300,
    frame: false,
    webPreferences: {
      preload         : path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration : false,
    },
  });
  const view = new BrowserView({ webPreferences: { contextIsolation: true, nodeIntegration: false } });
  popup.addBrowserView(view);
  popupViews.set(popup.id, view);

  const resize = () => {
    const [w, h] = popup.getContentSize();
    view.setBounds({ x: 0, y: POPUP_TB_H, width: w, height: h - POPUP_TB_H });
  };
  popup.on('resize', resize);
  popup.webContents.on('did-finish-load', () => { resize(); view.webContents.loadURL(url); });
  view.webContents.on('page-title-updated', (_, t) => {
    if (!popup.isDestroyed()) popup.webContents.send('popup-title', t);
  });
  view.webContents.setWindowOpenHandler(({ url: u }) => { createPopup(u); return { action: 'deny' }; });
  popup.on('closed', () => popupViews.delete(popup.id));
  popup.loadFile(path.join(__dirname, 'renderer', 'popup.html'));
}

// ─── LAYOUT ──────────────────────────────────────────────────────────────────
function paneBounds(i, total) {
  const [w, h] = win.getContentSize();
  const usableW = agentPanelOpen ? w - AGENT_PANEL_W : w;
  const pw = Math.floor(usableW / total);
  return { x: i * pw, y: TOP_H, width: i === total - 1 ? usableW - i * pw : pw, height: h - TOP_H };
}
function relayout() {
  views.filter(Boolean).forEach((v, i, a) => v.setBounds(paneBounds(i, a.length)));
}
function clearViews() {
  views.forEach(v => v && win.removeBrowserView(v));
  views = [];
  viewMap.clear();
  dbg('Cleared all views');
}

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('load-panes', async (_, panes) => {
  dbg('load-panes:', panes.map(p => `${p.aiId}:${p.slot}`).join(', '));
  clearViews();
  const loadPromises = [];

  panes.forEach(({ aiId, slot }, i) => {
    const ai = AIS.find(a => a.id === aiId);
    if (!ai) { dbg('Unknown AI id:', aiId); return; }

    const view = new BrowserView({
      webPreferences: {
        partition       : `persist:${aiId}_${slot}`,
        contextIsolation: true,
        nodeIntegration : false,
      },
    });
    view.webContents.setWindowOpenHandler(({ url }) => { createPopup(url); return { action: 'deny' }; });
    win.addBrowserView(view);
    view.setBounds(paneBounds(i, panes.length));

    const key = `${aiId}:${slot}`;
    viewMap.set(key, view);
    views[i] = view;

    // Track when each view loads
    const p = new Promise(resolve => {
      view.webContents.once('did-finish-load', () => {
        dbg(`Panel loaded: ${key}`);
        resolve(aiId);
      });
      view.webContents.once('did-fail-load', (_, code, desc) => {
        dbg(`Panel load failed: ${key} — ${desc}`);
        resolve(null);
      });
      setTimeout(() => resolve(aiId), 15000);
    });
    loadPromises.push(p);
    view.webContents.loadURL(ai.url);
  });

  // After all panels load: notify renderer + run boot self-test
  Promise.all(loadPromises).then(loadedIds => {
    const openIds = loadedIds.filter(Boolean);
    dbg('All panels loaded:', openIds.join(', '));

    if (win && !win.isDestroyed()) {
      win.webContents.send('views-loaded', { openIds });
    }

    // ── Phase 6: Auto-run boot self-test ────────────────────────────
    if (_engineRef?.current) {
      dbg('Running boot self-test for:', openIds.join(', '));
      _engineRef.current.runBootSelfTest(openIds).catch(err => {
        dbg('Boot self-test error:', err.message);
      });
    } else {
      dbg('engineRef not ready yet for boot self-test — will retry on next views-loaded');
    }
  });
});

// List open provider IDs — used by agent.js for pre-flight check
ipcMain.handle('list-open-views', () => {
  const ids = listOpenProviderIds();
  dbg('list-open-views →', ids.join(', '));
  return ids;
});

// Open a specific provider view on demand (adds to current layout)
ipcMain.handle('open-provider-view', async (_, aiId) => {
  dbg('open-provider-view:', aiId);
  const ai = AIS.find(a => a.id === aiId);
  if (!ai) return { ok: false, error: 'Unknown provider' };

  const key = `${aiId}:0`;
  if (viewMap.has(key)) {
    dbg('View already open:', key);
    return { ok: true, alreadyOpen: true };
  }

  // Add a new pane alongside existing ones
  const newTotal = views.length + 1;
  views.forEach((v, i) => v && v.setBounds(paneBounds(i, newTotal)));

  const view = new BrowserView({
    webPreferences: {
      partition       : `persist:${aiId}_0`,
      contextIsolation: true,
      nodeIntegration : false,
    },
  });
  view.webContents.setWindowOpenHandler(({ url }) => { createPopup(url); return { action: 'deny' }; });
  win.addBrowserView(view);
  view.setBounds(paneBounds(views.length, newTotal));
  viewMap.set(key, view);
  views.push(view);
  view.webContents.loadURL(ai.url);

  return new Promise(resolve => {
    view.webContents.once('did-finish-load', () => {
      dbg('On-demand panel loaded:', key);
      const openIds = listOpenProviderIds();
      if (win && !win.isDestroyed()) {
        win.webContents.send('views-loaded', { openIds });
      }
      // Run self-test for newly opened provider
      if (_engineRef?.current) {
        _engineRef.current.runBootSelfTest([aiId]).catch(err => {
          dbg('On-demand self-test error:', err.message);
        });
      }
      resolve({ ok: true });
    });
    view.webContents.once('did-fail-load', (_, code, desc) => {
      dbg('On-demand panel failed:', key, desc);
      resolve({ ok: false, error: desc });
    });
    setTimeout(() => resolve({ ok: true }), 20000);
  });
});

ipcMain.handle('popup-nav', (event, action) => {
  const pw   = BrowserWindow.fromWebContents(event.sender);
  const view = popupViews.get(pw?.id);
  if (!view) return;
  const wc = view.webContents;
  if (action === 'back'     && wc.canGoBack())    wc.goBack();
  if (action === 'forward'  && wc.canGoForward()) wc.goForward();
  if (action === 'close')    pw.close();
  if (action === 'minimize') pw.minimize();
  if (action === 'maximize') pw.isMaximized() ? pw.unmaximize() : pw.maximize();
});

ipcMain.handle('save-state',   (_, s) => { dbg('save-state'); saveState(s); });
ipcMain.handle('get-ais',      ()     => AIS);
ipcMain.handle('win-minimize', ()     => win.minimize());
ipcMain.handle('win-maximize', ()     => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.handle('win-close',    ()     => win.close());

// Agent panel open/close — resize BrowserViews to make room
ipcMain.on('agent-panel-state', (_, open) => {
  agentPanelOpen = !!open;
  dbg('agent-panel-state:', agentPanelOpen);
  relayout();
});

// ─── APP LIFECYCLE ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  dbg('App ready');
  const userData = app.getPath('userData');
  dbg('userData:', userData);

  // Phase 6: init persistent modules before window creation
  sessionStore.init(userData);
  providerConfig.init(userData);

  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
