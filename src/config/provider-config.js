/**
 * provider-config.js — AI Council v6 — Persistent provider selector config
 *
 * Phase 6 — NEW
 *
 * Stores user-editable selector overrides in userData/provider-config.json.
 * The settings panel (agent.js) reads/writes through this module via IPC.
 *
 * Format:
 * {
 *   "claude":  { "input": "...", "send": "...", "response": "...", "stream": "..." },
 *   "chatgpt": { ... }
 * }
 *
 * Providers check this config (via getOverride) to load user-tuned selectors.
 */

const fs   = require('fs');
const path = require('path');

const DEBUG = true;
function dbg(...args) { if (DEBUG) console.log('[CONFIG]', ...args); }

// Default selectors for each provider — used as baseline in settings UI
const PROVIDER_DEFAULTS = {
  claude: {
    input   : '.ProseMirror[contenteditable="true"], div[contenteditable="true"][data-placeholder], div[contenteditable="true"].break-words',
    send    : 'button[aria-label="Send Message"], button[data-testid="send-button"], button[aria-label*="Send"]',
    response: '.font-claude-message, [data-testid="assistant-message"], .claude-message-content',
    stream  : 'button[aria-label="Stop"], button[data-testid="stop-button"], .streaming-cursor, .animate-blink',
  },
  chatgpt: {
    input   : '#prompt-textarea, div[contenteditable="true"][data-id="root"]',
    send    : 'button[data-testid="send-button"], button[aria-label="Send prompt"]',
    response: '[data-message-author-role="assistant"] .markdown, .message[data-role="assistant"]',
    stream  : 'button[aria-label="Stop generating"], .result-streaming',
  },
  gemini: {
    input   : 'rich-textarea .ql-editor, div[contenteditable="true"][aria-label*="message"]',
    send    : 'button[aria-label="Send message"], button.send-button',
    response: 'model-response .response-content, .response-container .markdown',
    stream  : 'button[aria-label="Stop"], .loading-indicator',
  },
  grok: {
    input   : 'textarea[placeholder*="message"], div[contenteditable="true"]',
    send    : 'button[type="submit"], button[aria-label="Send"]',
    response: '.assistant-message, [data-testid="grok-message"]',
    stream  : '.generating, .stop-btn',
  },
  perplexity: {
    input   : 'textarea[placeholder*="Ask"], textarea[name="q"]',
    send    : 'button[aria-label="Submit"], button[type="submit"]',
    response: '.prose, .answer-text, [data-testid="answer"]',
    stream  : '.generating, .streaming-answer',
  },
  copilot: {
    input   : '#userInput, textarea[aria-label*="message"], div[contenteditable="true"]',
    send    : 'button[aria-label="Submit"], button[type="submit"]',
    response: '.response-message, .ai-message-content',
    stream  : '.typing-indicator, .generating',
  },
};

const SELECTOR_KEYS   = ['input', 'send', 'response', 'stream'];
const SELECTOR_LABELS = {
  input   : 'Input / Editor',
  send    : 'Send Button',
  response: 'Response Text',
  stream  : 'Streaming Indicator',
};

class ProviderConfig {
  constructor() {
    this._overrides = {};  // providerId → { input, send, response, stream }
    this._file      = null;
  }

  // ── Init ──────────────────────────────────────────────────────────────

  /**
   * Call once from main.js with app.getPath('userData').
   * @param {string} userDataPath
   */
  init(userDataPath) {
    this._file = path.join(userDataPath, 'provider-config.json');
    dbg('Config file:', this._file);
    try {
      if (fs.existsSync(this._file)) {
        this._overrides = JSON.parse(fs.readFileSync(this._file, 'utf8'));
        dbg('Loaded overrides for:', Object.keys(this._overrides).join(', ') || '(none)');
      }
    } catch (err) {
      dbg('load error:', err.message);
      this._overrides = {};
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────

  /**
   * Get the effective selector for a provider+key.
   * Returns user override if set, else the default.
   * @param {string} providerId
   * @param {string} key  — 'input' | 'send' | 'response' | 'stream'
   * @returns {string}
   */
  getSelector(providerId, key) {
    return this._overrides[providerId]?.[key] ?? PROVIDER_DEFAULTS[providerId]?.[key] ?? '';
  }

  /**
   * Full config for a provider (merged defaults + overrides).
   * @param {string} providerId
   * @returns {{ input, send, response, stream, _hasOverride }}
   */
  getProvider(providerId) {
    const def  = PROVIDER_DEFAULTS[providerId] || {};
    const over = this._overrides[providerId]   || {};
    return {
      ...def,
      ...over,
      _hasOverride: !!this._overrides[providerId],
    };
  }

  /**
   * Full config for all providers (for settings UI).
   * @returns {{ providerId: { input, send, response, stream, _hasOverride } }[]}
   */
  getAllProviders() {
    return Object.keys(PROVIDER_DEFAULTS).map(id => ({
      id,
      ...this.getProvider(id),
    }));
  }

  /**
   * Whether a specific key has a user override.
   */
  hasOverride(providerId, key) {
    return !!(this._overrides[providerId]?.[key]);
  }

  // ── Write ─────────────────────────────────────────────────────────────

  /**
   * Save selector overrides for a provider.
   * Pass only the keys you want to change; others are untouched.
   * Pass null for a key to clear its override (revert to default).
   * @param {string} providerId
   * @param {{ [key: string]: string|null }} changes
   */
  setSelectors(providerId, changes) {
    if (!this._overrides[providerId]) this._overrides[providerId] = {};
    for (const [key, val] of Object.entries(changes)) {
      if (val === null || val === '') {
        delete this._overrides[providerId][key];
      } else {
        this._overrides[providerId][key] = val;
      }
    }
    // Clean up empty provider entry
    if (!Object.keys(this._overrides[providerId]).length) {
      delete this._overrides[providerId];
    }
    this._save();
    dbg(`setSelectors(${providerId}):`, JSON.stringify(changes));
  }

  /**
   * Reset all overrides for a provider back to defaults.
   */
  resetProvider(providerId) {
    delete this._overrides[providerId];
    this._save();
    dbg('reset:', providerId);
  }

  /**
   * Reset all overrides for all providers.
   */
  resetAll() {
    this._overrides = {};
    this._save();
    dbg('resetAll');
  }

  _save() {
    if (!this._file) return;
    try {
      fs.writeFileSync(this._file, JSON.stringify(this._overrides, null, 2), 'utf8');
    } catch (err) {
      dbg('save error:', err.message);
    }
  }

  // ── Expose constants ───────────────────────────────────────────────────
  get DEFAULTS()         { return PROVIDER_DEFAULTS; }
  get SELECTOR_KEYS()    { return SELECTOR_KEYS; }
  get SELECTOR_LABELS()  { return SELECTOR_LABELS; }
}

module.exports = new ProviderConfig();
