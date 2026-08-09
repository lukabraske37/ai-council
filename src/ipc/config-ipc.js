/**
 * config-ipc.js — IPC handlers for provider selector config (Phase 6)
 *
 * IPC Channels (Renderer → Main):
 *   config-get-all          → all providers with merged default+override selectors
 *   config-get-provider     → single provider config
 *   config-set-selectors    → save overrides for a provider
 *   config-reset-provider   → clear overrides for a provider
 *   config-reset-all        → clear all overrides
 *   config-test-selector    → run querySelector in a live BrowserView
 *
 * config-test-selector returns:
 *   { found: boolean, count: number, tag: string, text: string, error?: string }
 */
const providerConfig = require('../config/provider-config');

const DEBUG = true;
function dbg(...args) { if (DEBUG) console.log('[CONFIG-IPC]', ...args); }

/**
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getView — fn(aiId, slot) → BrowserView|null
 */
function registerConfigIPC(ipcMain, getView) {

  ipcMain.handle('config-get-all', () => {
    const result = providerConfig.getAllProviders();
    dbg('config-get-all →', result.length, 'providers');
    return result;
  });

  ipcMain.handle('config-get-provider', (_, providerId) => {
    const result = providerConfig.getProvider(providerId);
    dbg('config-get-provider:', providerId);
    return result;
  });

  ipcMain.handle('config-set-selectors', (_, { providerId, changes }) => {
    dbg('config-set-selectors:', providerId, changes);
    providerConfig.setSelectors(providerId, changes);
    return { ok: true, config: providerConfig.getProvider(providerId) };
  });

  ipcMain.handle('config-reset-provider', (_, providerId) => {
    dbg('config-reset-provider:', providerId);
    providerConfig.resetProvider(providerId);
    return { ok: true, config: providerConfig.getProvider(providerId) };
  });

  ipcMain.handle('config-reset-all', () => {
    dbg('config-reset-all');
    providerConfig.resetAll();
    return { ok: true };
  });

  /**
   * Test a CSS selector in a live BrowserView.
   * Returns match count, tag, first 80 chars of text content.
   */
  ipcMain.handle('config-test-selector', async (_, { providerId, selector, slot = 0 }) => {
    dbg(`config-test-selector: ${providerId} → "${selector}"`);

    if (!selector?.trim()) {
      return { found: false, count: 0, tag: '', text: '', error: 'Empty selector' };
    }

    const view = getView(providerId, slot);
    if (!view?.webContents) {
      return { found: false, count: 0, tag: '', text: '', error: `No open panel for "${providerId}"` };
    }

    try {
      const result = await view.webContents.executeJavaScript(`
        (function() {
          try {
            const sel = ${JSON.stringify(selector)};
            const all = document.querySelectorAll(sel);
            if (!all.length) return { found: false, count: 0, tag: '', text: '', error: null };
            const el = all[0];
            return {
              found : true,
              count : all.length,
              tag   : el.tagName.toLowerCase(),
              text  : (el.innerText || el.textContent || el.value || '').slice(0, 80).trim(),
              error : null,
            };
          } catch(e) {
            return { found: false, count: 0, tag: '', text: '', error: e.message };
          }
        })()
      `);
      dbg('test result:', result);
      return result;
    } catch (err) {
      dbg('executeJavaScript error:', err.message);
      return { found: false, count: 0, tag: '', text: '', error: err.message };
    }
  });
}

module.exports = { registerConfigIPC };
