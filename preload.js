const { contextBridge, ipcRenderer } = require('electron');

// Jedan preload za oba prozora (main i popup).
// contextBridge.exposeInMainWorld sigurno izlaže API renderer-u
// bez davanja direktnog pristupa Node.js/Electron modulu.
contextBridge.exposeInMainWorld('api', {

  // ── Glavni prozor ──────────────────────────────────────────────────────────

  // Učitava panele (prima listu {aiId, slot} objekata)
  loadPanes:  (panes) => ipcRenderer.invoke('load-panes', panes),

  // Čuva korisnički state na disk (presets, lastPanes)
  saveState:  (state) => ipcRenderer.invoke('save-state', state),

  // Window kontrole
  minimize:   () => ipcRenderer.invoke('win-minimize'),
  maximize:   () => ipcRenderer.invoke('win-maximize'),
  close:      () => ipcRenderer.invoke('win-close'),

  // Inicijalizacioni event (main.js šalje state i listu AI-eva)
  onInit:     (cb) => ipcRenderer.on('init', (_, state, ais) => cb(state, ais)),

  // Event kad se prozor maximize/unmaximize (za promenu ikone dugmeta)
  onWinState: (cb) => ipcRenderer.on('win-state', (_, s) => cb(s)),

  // ── Popup prozor ───────────────────────────────────────────────────────────
  // Popup je poseban BrowserWindow koji se otvara kad AI sajt otvori link.
  // Ima sopstveni mini-toolbar sa back/forward/close dugmićima.

  popupBack:    () => ipcRenderer.invoke('popup-nav', 'back'),
  popupForward: () => ipcRenderer.invoke('popup-nav', 'forward'),
  popupClose:   () => ipcRenderer.invoke('popup-nav', 'close'),
  popupMin:     () => ipcRenderer.invoke('popup-nav', 'minimize'),
  popupMax:     () => ipcRenderer.invoke('popup-nav', 'maximize'),

  // Event kad se promeni naslov stranice u popup-u
  onPopupTitle: (cb) => ipcRenderer.on('popup-title', (_, t) => cb(t)),

});
