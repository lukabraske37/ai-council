/**
 * memory-ipc.js — IPC handlers for session memory in AI Council v6.
 *
 * Channels exposed:
 *   memory-get-history   (invoke) → HistorySummary[]  — list of past tasks
 *   memory-get-entry     (invoke) → SessionEntry|null  — full entry by id
 *   memory-clear         (invoke) → void               — wipe all history
 *   memory-remove        (invoke) → void               — remove single entry
 *   memory-size          (invoke) → number             — entry count
 *
 * Phase 3 addition.
 */
const store = require('../memory/session-store');

/**
 * @param {Electron.IpcMain} ipcMain
 */
function registerMemoryIPC(ipcMain) {
  // List (summaries, no full text)
  ipcMain.handle('memory-get-history', (_event, n = 20) => {
    return store.getSummaries(n);
  });

  // Full entry for replay / detail view
  ipcMain.handle('memory-get-entry', (_event, id) => {
    return store.getById(id);
  });

  // Clear all
  ipcMain.handle('memory-clear', () => {
    store.clear();
    return { cleared: true };
  });

  // Remove one entry
  ipcMain.handle('memory-remove', (_event, id) => {
    store.remove(id);
    return { removed: id };
  });

  // Count
  ipcMain.handle('memory-size', () => store.size);
}

module.exports = { registerMemoryIPC };
