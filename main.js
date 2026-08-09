const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');

// ─── AI LISTA ──────────────────────────────────────────────────────────────
// Dodaj/ukloni AI-eve ovde. id mora biti jedinstven, bez razmaka.
const AIS = [
  { id: 'chatgpt',    label: 'ChatGPT',    url: 'https://chatgpt.com' },
  { id: 'claude',     label: 'Claude',     url: 'https://claude.ai' },
  { id: 'gemini',     label: 'Gemini',     url: 'https://gemini.google.com' },
  { id: 'grok',       label: 'Grok',       url: 'https://grok.com' },
  { id: 'perplexity', label: 'Perplexity', url: 'https://perplexity.ai' },
  { id: 'copilot',    label: 'Copilot',    url: 'https://copilot.microsoft.com' },
];

// ─── STATE NA DISKU ────────────────────────────────────────────────────────
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
  ],
};

function loadState()  { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return structuredClone(DEFAULT_STATE); } }
function saveState(s) { fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2), 'utf8'); }

// ─── KONSTANTE ─────────────────────────────────────────────────────────────
const TOP_H      = 84;  // titlebar (32) + toolbar (52)
const POPUP_TB_H = 36;  // visina popup mini-toolbara

// ─── STATE ─────────────────────────────────────────────────────────────────
let win        = null;
let views      = [];
let popupViews = new Map(); // popup windowId -> BrowserView

// ─── GLAVNI PROZOR ─────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 800, minHeight: 500,
    frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('resize',     relayout);
  win.on('maximize',   () => { relayout(); win.webContents.send('win-state', 'max'); });
  win.on('unmaximize', () => { relayout(); win.webContents.send('win-state', 'normal'); });
  win.webContents.on('did-finish-load', () => win.webContents.send('init', loadState(), AIS));
}

// ─── POPUP PROZOR (kad sajt otvori link u novi tab) ────────────────────────
function createPopup(url) {
  const popup = new BrowserWindow({
    width: 1100, height: 750, minWidth: 400, minHeight: 300,
    frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  const view = new BrowserView({ webPreferences: { contextIsolation: true, nodeIntegration: false } });
  popup.addBrowserView(view);
  popupViews.set(popup.id, view);

  const resize = () => { const [w, h] = popup.getContentSize(); view.setBounds({ x: 0, y: POPUP_TB_H, width: w, height: h - POPUP_TB_H }); };
  popup.on('resize', resize);
  popup.webContents.on('did-finish-load', () => { resize(); view.webContents.loadURL(url); });
  view.webContents.on('page-title-updated', (_, t) => { if (!popup.isDestroyed()) popup.webContents.send('popup-title', t); });
  view.webContents.setWindowOpenHandler(({ url: u }) => { createPopup(u); return { action: 'deny' }; });
  popup.on('closed', () => popupViews.delete(popup.id));
  popup.loadFile(path.join(__dirname, 'renderer', 'popup.html'));
}

// ─── LAYOUT ────────────────────────────────────────────────────────────────
function paneBounds(i, total) {
  const [w, h] = win.getContentSize();
  const pw = Math.floor(w / total);
  return { x: i * pw, y: TOP_H, width: i === total - 1 ? w - i * pw : pw, height: h - TOP_H };
}
function relayout() { views.filter(Boolean).forEach((v, i, a) => v.setBounds(paneBounds(i, a.length))); }
function clearViews() { views.forEach(v => v && win.removeBrowserView(v)); views = []; }

// ─── IPC ───────────────────────────────────────────────────────────────────
ipcMain.handle('load-panes', (_, panes) => {
  clearViews();
  panes.forEach(({ aiId, slot }, i) => {
    const ai = AIS.find(a => a.id === aiId);
    if (!ai) return;
    const view = new BrowserView({ webPreferences: { partition: `persist:${aiId}_${slot}`, contextIsolation: true, nodeIntegration: false } });
    view.webContents.setWindowOpenHandler(({ url }) => { createPopup(url); return { action: 'deny' }; });
    win.addBrowserView(view);
    view.setBounds(paneBounds(i, panes.length));
    view.webContents.loadURL(ai.url);
    views[i] = view;
  });
});


// Navigacija — popup (identifikuje se po pošiljaocu)
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

// State i window kontrole
ipcMain.handle('save-state',   (_, s) => saveState(s));
ipcMain.handle('get-ais',      ()     => AIS);
ipcMain.handle('win-minimize', ()     => win.minimize());
ipcMain.handle('win-maximize', ()     => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.handle('win-close',    ()     => win.close());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
