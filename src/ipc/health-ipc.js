/**
 * health-ipc.js — IPC handlers for provider health monitoring.
 *
 * IPC Channels:
 *   health-get-all         (R→M, invoke) Get all cached health statuses
 *   health-check-now       (R→M, invoke) Force check a specific provider
 *   health-status          (M→R, send)   Push health event when status changes
 *
 * Call registerHealthIPC(ipcMain, healthMonitor, mainWindow) in main.js
 * after healthMonitor is created.
 */

/**
 * @param {Electron.IpcMain}  ipcMain
 * @param {HealthMonitor}     healthMonitor
 * @param {Electron.BrowserWindow} mainWindow
 */
function registerHealthIPC(ipcMain, healthMonitor, mainWindow) {

  // ── Get all current statuses ──────────────────────────────────────────────
  ipcMain.handle('health-get-all', () => {
    return healthMonitor.getAll();
  });

  // ── Force-check a specific provider ──────────────────────────────────────
  ipcMain.handle('health-check-now', async (event, providerId) => {
    const status = await healthMonitor.checkNow(providerId);
    return status;
  });
}

/**
 * Called by HealthMonitor when a status changes.
 * Forwards the event to the renderer.
 *
 * @param {Electron.BrowserWindow} mainWindow
 * @param {HealthStatus} status
 */
function emitHealthToRenderer(mainWindow, status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('health-status', status);
}

module.exports = { registerHealthIPC, emitHealthToRenderer };
