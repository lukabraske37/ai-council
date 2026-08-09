/**
 * orchestration-ipc.js — IPC handlers for orchestration (Phase 5)
 *
 * Phase 5 changes:
 *   - Returns { engineRef } so main.js can call runBootSelfTest()
 *   - Comprehensive debug logging on every event
 *   - Routes ALL engine event types to renderer (provider-status now forwarded)
 *   - Better error messages when orchestration fails
 *   - Timeout info forwarded to renderer
 *
 * IPC Channels (Renderer → Main):
 *   orchestrate           Start a new run
 *   orchestrate-cancel    Cancel current run
 *   get-providers         List registered providers
 *
 * IPC Channels (Main → Renderer):
 *   orchestrate-progress  Routing / executing / ranking events
 *   orchestrate-result    Final ranked results
 *   partial-response      Live streaming text per provider
 *   provider-selftest     Boot self-test coverage events
 */
const OrchestrationEngine = require('../orchestration/engine');
const providerRegistry    = require('../providers/provider-registry');

const DEBUG = true;
function dbg(...args) { if (DEBUG) console.log('[ORCH-IPC]', ...args); }

let _engine = null; // Active engine instance

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getView — fn(aiId, slot) → BrowserView|null
 * @param {Electron.BrowserWindow} mainWindow
 * @returns {{ engineRef: { current: OrchestrationEngine|null } }}
 */
function registerOrchestrationIPC(ipcMain, getView, mainWindow) {

  // Shared reference so main.js can call runBootSelfTest
  const engineRef = { current: null };

  // ── Start orchestration ─────────────────────────────────────────────────
  ipcMain.handle('orchestrate', async (event, opts) => {
    dbg('orchestrate called with:', JSON.stringify({
      task: (opts.task || '').slice(0, 80),
      mode: opts.mode,
      taskType: opts.taskType,
      providers: opts.providers,
    }));

    // Cancel any running orchestration
    if (_engine && _engine.state !== 'done' && _engine.state !== 'cancelled') {
      dbg('Cancelling previous engine (state:', _engine.state, ')');
      _engine.cancel();
    }

    // Progress callback → forward to renderer
    const onProgress = (evt) => {
      if (mainWindow.isDestroyed()) return;

      dbg(`engine event [${evt.type}]:`, evt.message || evt.status || '');

      if (evt.type === 'partial-response') {
        // Live streaming text — its own channel
        mainWindow.webContents.send('partial-response', evt);
      } else if (evt.type === 'provider-selftest') {
        // Boot self-test coverage
        mainWindow.webContents.send('provider-selftest', evt);
      } else {
        // Everything else: routing, executing, collecting, ranking,
        // provider-status, done, error, cancelled, refining
        mainWindow.webContents.send('orchestrate-progress', evt);
      }
    };

    _engine = new OrchestrationEngine(getView, onProgress);
    engineRef.current = _engine;

    try {
      dbg('Starting engine.run()');
      const startMs = Date.now();
      const { results, ranked, state } = await _engine.run(opts);
      const durationMs = Date.now() - startMs;

      dbg(`engine.run() done in ${durationMs}ms — state=${state}, ranked=${ranked.length}`);

      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('orchestrate-result', {
          results,
          ranked,
          state,
          durationMs,
        });
      }
      return { success: true, resultCount: ranked.length, durationMs };

    } catch (err) {
      dbg('engine.run() threw:', err.message);
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('orchestrate-result', {
          results  : [],
          ranked   : [],
          state    : 'error',
          error    : err.message,
          durationMs: 0,
        });
      }
      return { success: false, error: err.message };
    }
  });

  // ── Cancel ──────────────────────────────────────────────────────────────
  ipcMain.handle('orchestrate-cancel', () => {
    dbg('orchestrate-cancel received');
    if (_engine) {
      _engine.cancel();
      dbg('Engine cancelled');
    } else {
      dbg('No active engine to cancel');
    }
  });

  // ── Provider list ────────────────────────────────────────────────────────
  ipcMain.handle('get-providers', () => {
    const list = providerRegistry.all().map(p => ({
      id    : p.id,
      label : p.label,
      url   : p.url,
    }));
    dbg('get-providers →', list.map(p => p.id).join(', '));
    return list;
  });

  return { engineRef };
}

module.exports = { registerOrchestrationIPC };
