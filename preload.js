/**
 * preload.js — Context bridge for AI Council v6
 *
 * Phase 6 additions:
 *   - configGetAll()           fetch all provider selector configs
 *   - configGetProvider(id)    fetch single provider config
 *   - configSetSelectors()     save selector overrides
 *   - configResetProvider(id)  reset provider to defaults
 *   - configResetAll()         reset everything
 *   - configTestSelector()     live querySelector test in BrowserView
 */
const { contextBridge, ipcRenderer } = require('electron');

const DEBUG = true;
function dbg(...args) { if (DEBUG) console.log('[PRELOAD]', ...args); }

contextBridge.exposeInMainWorld('api', {

  // ── Main window ────────────────────────────────────────────────────────
  loadPanes  : (panes) => { dbg('loadPanes', panes.length); return ipcRenderer.invoke('load-panes', panes); },
  saveState  : (state) => ipcRenderer.invoke('save-state', state),
  getAis     : ()      => ipcRenderer.invoke('get-ais'),
  minimize   : ()      => ipcRenderer.invoke('win-minimize'),
  maximize   : ()      => ipcRenderer.invoke('win-maximize'),
  close      : ()      => ipcRenderer.invoke('win-close'),
  agentPanelState : (open) => ipcRenderer.send('agent-panel-state', open),
  onInit     : (cb)    => ipcRenderer.on('init',      (_, state, ais) => cb(state, ais)),
  onWinState : (cb)    => ipcRenderer.on('win-state', (_, s)          => cb(s)),

  // ── View management (Phase 5) ──────────────────────────────────────────
  listOpenViews    : ()       => { dbg('listOpenViews'); return ipcRenderer.invoke('list-open-views'); },
  openProviderView : (aiId)   => { dbg('openProviderView', aiId); return ipcRenderer.invoke('open-provider-view', aiId); },
  onViewsLoaded    : (cb)     => ipcRenderer.on('views-loaded', (_, data) => { dbg('views-loaded', data.openIds); cb(data); }),
  offViewsLoaded   : ()       => ipcRenderer.removeAllListeners('views-loaded'),

  // ── Orchestration ──────────────────────────────────────────────────────
  orchestrate       : (opts) => { dbg('orchestrate', opts.mode, opts.providers); return ipcRenderer.invoke('orchestrate', opts); },
  orchestrateCancel : ()     => { dbg('orchestrateCancel'); return ipcRenderer.invoke('orchestrate-cancel'); },
  getProviders      : ()     => ipcRenderer.invoke('get-providers'),

  // Streaming events main → renderer
  onOrchestrationProgress  : (cb) => ipcRenderer.on('orchestrate-progress', (_, evt) => cb(evt)),
  onOrchestrationResult    : (cb) => ipcRenderer.on('orchestrate-result',   (_, res) => cb(res)),
  offOrchestrationProgress : ()   => ipcRenderer.removeAllListeners('orchestrate-progress'),
  offOrchestrationResult   : ()   => ipcRenderer.removeAllListeners('orchestrate-result'),

  // Live partial text during streaming
  onPartialResponse  : (cb) => ipcRenderer.on('partial-response', (_, evt) => cb(evt)),
  offPartialResponse : ()   => ipcRenderer.removeAllListeners('partial-response'),

  // Provider self-test events
  onProviderSelfTest  : (cb) => ipcRenderer.on('provider-selftest', (_, evt) => cb(evt)),
  offProviderSelfTest : ()   => ipcRenderer.removeAllListeners('provider-selftest'),

  // ── Health monitoring ──────────────────────────────────────────────────
  healthGetAll   : ()           => ipcRenderer.invoke('health-get-all'),
  healthCheckNow : (providerId) => ipcRenderer.invoke('health-check-now', providerId),
  onHealthStatus  : (cb) => ipcRenderer.on('health-status', (_, status) => cb(status)),
  offHealthStatus : ()   => ipcRenderer.removeAllListeners('health-status'),

  // ── Session memory ─────────────────────────────────────────────────────
  memoryGetHistory : (n)   => ipcRenderer.invoke('memory-get-history', n),
  memoryGetEntry   : (id)  => ipcRenderer.invoke('memory-get-entry', id),
  memoryClear      : ()    => ipcRenderer.invoke('memory-clear'),
  memoryRemove     : (id)  => ipcRenderer.invoke('memory-remove', id),
  memorySize       : ()    => ipcRenderer.invoke('memory-size'),

  // ── Export system ──────────────────────────────────────────────────────
  exportFormats : ()     => ipcRenderer.invoke('export-formats'),
  exportResults : (opts) => ipcRenderer.invoke('export-results', opts),

  // ── Provider config (Phase 6) ──────────────────────────────────────────
  configGetAll         : ()                        => { dbg('configGetAll'); return ipcRenderer.invoke('config-get-all'); },
  configGetProvider    : (providerId)              => ipcRenderer.invoke('config-get-provider', providerId),
  configSetSelectors   : (providerId, changes)     => { dbg('configSet', providerId); return ipcRenderer.invoke('config-set-selectors', { providerId, changes }); },
  configResetProvider  : (providerId)              => ipcRenderer.invoke('config-reset-provider', providerId),
  configResetAll       : ()                        => ipcRenderer.invoke('config-reset-all'),
  configTestSelector   : (providerId, selector)    => { dbg('configTest', providerId, selector.slice(0, 40)); return ipcRenderer.invoke('config-test-selector', { providerId, selector }); },

  // ── Popup window ───────────────────────────────────────────────────────
  popupBack     : () => ipcRenderer.invoke('popup-nav', 'back'),
  popupForward  : () => ipcRenderer.invoke('popup-nav', 'forward'),
  popupClose    : () => ipcRenderer.invoke('popup-nav', 'close'),
  popupMin      : () => ipcRenderer.invoke('popup-nav', 'minimize'),
  popupMax      : () => ipcRenderer.invoke('popup-nav', 'maximize'),
  onPopupTitle  : (cb) => ipcRenderer.on('popup-title', (_, t) => cb(t)),
});
