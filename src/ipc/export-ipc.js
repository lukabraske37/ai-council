/**
 * export-ipc.js — IPC handlers for the export system.
 *
 * Phase 4 addition.
 *
 * IPC Channels:
 *   export-results  (R→M)  Open save dialog → write file → return { ok, filePath }
 *   export-formats  (R→M)  Return list of supported formats
 */
const { dialog } = require('electron');
const fs         = require('fs');
const path       = require('path');
const exporter   = require('../export/exporter');

const FORMATS = [
  { id: 'md',   label: 'Markdown (.md)',  ext: '.md',   mime: 'text/markdown' },
  { id: 'html', label: 'HTML (.html)',    ext: '.html', mime: 'text/html'     },
  { id: 'json', label: 'JSON (.json)',    ext: '.json', mime: 'application/json' },
];

/**
 * @param {Electron.IpcMain}      ipcMain
 * @param {Electron.BrowserWindow} mainWindow   — parent for dialog sheets
 */
function registerExportIPC(ipcMain, mainWindow) {

  // ── Get supported formats ───────────────────────────────────────────────
  ipcMain.handle('export-formats', () => FORMATS);

  // ── Save results ────────────────────────────────────────────────────────
  /**
   * @param {object} opts
   * @param {string}   opts.format    — 'md' | 'html' | 'json'
   * @param {string}   opts.task
   * @param {string}   opts.mode
   * @param {string}   opts.taskType
   * @param {object[]} opts.ranked
   * @param {number}   opts.durationMs
   */
  ipcMain.handle('export-results', async (event, opts) => {
    const { format = 'md', task, mode, taskType, ranked = [], durationMs } = opts;

    const fmt = FORMATS.find(f => f.id === format) || FORMATS[0];

    // Build a safe default filename from the task text
    const safeName = (task || 'ai-council-export')
      .slice(0, 40)
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || 'export';

    const defaultPath = path.join(
      require('electron').app.getPath('documents'),
      `${safeName}${fmt.ext}`
    );

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title       : 'Export AI Council Results',
      defaultPath,
      filters     : [
        { name: fmt.label, extensions: [fmt.ext.replace('.', '')] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (canceled || !filePath) {
      return { ok: false, canceled: true };
    }

    try {
      const data   = opts;
      let content;
      switch (format) {
        case 'html': content = exporter.toHtml(data);     break;
        case 'json': content = exporter.toJson(data);     break;
        default:     content = exporter.toMarkdown(data); break;
      }
      fs.writeFileSync(filePath, content, 'utf8');
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerExportIPC };
