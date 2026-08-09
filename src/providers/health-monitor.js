/**
 * HealthMonitor — Monitors provider readiness in real time.
 *
 * For each open BrowserView, periodically checks:
 *   1. Page loaded (readyState === 'complete')
 *   2. Logged in (no login-wall selectors visible)
 *   3. Input ready (provider's input selector is present in DOM)
 *   4. Not currently responding (no active generation in progress)
 *
 * Emits health events via callback so the renderer can show
 *   🟢 ready / 🟡 loading / 🔴 not-ready / ⚫ offline
 *
 * Usage (in main.js):
 *   const monitor = new HealthMonitor(getView, onHealthEvent);
 *   monitor.start();   // begin polling
 *   monitor.stop();    // stop
 *   monitor.checkNow('chatgpt');  // force immediate check
 */

// Per-provider login wall and input selectors
// These are checked in executeJavaScript — keep them simple and stable.
const PROVIDER_CHECKS = {
  chatgpt: {
    loginSelectors : ['[href*="/auth/login"]', 'button[data-testid="login-button"]'],
    inputSelectors : ['#prompt-textarea', 'div[contenteditable="true"]'],
    busySelectors  : ['button[aria-label="Stop streaming"]', '[data-testid="stop-button"]'],
  },
  claude: {
    loginSelectors : ['[href*="/login"]', 'button[data-testid*="login"]', 'a[href*="login"]'],
    inputSelectors : ['.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]'],
    busySelectors  : ['button[aria-label="Stop"]', '.streaming-cursor', '.animate-blink'],
  },
  gemini: {
    loginSelectors : ['[href*="accounts.google.com"]', '#identifierId'],
    inputSelectors : ['rich-textarea .ql-editor', 'p.textarea[contenteditable="true"]'],
    busySelectors  : ['.loading-indicator', '[aria-label*="Generating"]'],
  },
  grok: {
    loginSelectors : ['[href*="/i/flow/login"]', 'a[href*="login"]'],
    inputSelectors : ['textarea', 'div[contenteditable="true"]'],
    busySelectors  : ['[aria-busy="true"]', '.streaming'],
  },
  perplexity: {
    loginSelectors : ['[href*="/login"]', 'button[data-testid*="login"]'],
    inputSelectors : ['textarea[placeholder]', 'textarea'],
    busySelectors  : ['.animate-pulse', '[data-state="loading"]'],
  },
  copilot: {
    loginSelectors : ['[href*="login.microsoftonline"]', '#mectrl_main_trigger'],
    inputSelectors : ['#userInput', 'textarea', '[contenteditable="true"]'],
    busySelectors  : ['.stopButton', '.generating', '[aria-label*="stop"]'],
  },
};

// How often to poll each provider (ms)
const POLL_INTERVAL_MS = 8000;

class HealthMonitor {
  /**
   * @param {Function} getView      — fn(aiId, slot) → BrowserView|null
   * @param {Function} onHealthEvent — fn({ id, status, details }) → void
   */
  constructor(getView, onHealthEvent) {
    this._getView  = getView;
    this._emit     = onHealthEvent || (() => {});
    this._timers   = new Map();  // providerId → intervalId
    this._cache    = new Map();  // providerId → last HealthStatus
    this._running  = false;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Start polling all known providers. */
  start() {
    if (this._running) return;
    this._running = true;
    for (const id of Object.keys(PROVIDER_CHECKS)) {
      this._startPolling(id);
    }
  }

  /** Stop all polling. */
  stop() {
    this._running = false;
    for (const [, timer] of this._timers) {
      clearInterval(timer);
    }
    this._timers.clear();
  }

  /** Force an immediate health check for a specific provider. */
  async checkNow(providerId) {
    const status = await this._check(providerId);
    this._cache.set(providerId, status);
    this._emit(status);
    return status;
  }

  /** Get last cached health status for a provider. */
  getCached(providerId) {
    return this._cache.get(providerId) || { id: providerId, status: 'unknown' };
  }

  /** Get all cached statuses. */
  getAll() {
    return Object.keys(PROVIDER_CHECKS).map(id => this.getCached(id));
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _startPolling(providerId) {
    // Initial check immediately
    this._check(providerId).then(status => {
      this._cache.set(providerId, status);
      this._emit(status);
    });

    // Periodic polling
    const timer = setInterval(async () => {
      if (!this._running) return;
      const status = await this._check(providerId);
      const prev   = this._cache.get(providerId);

      // Only emit if status changed
      if (!prev || prev.status !== status.status || prev.inputReady !== status.inputReady) {
        this._cache.set(providerId, status);
        this._emit(status);
      } else {
        this._cache.set(providerId, status);
      }
    }, POLL_INTERVAL_MS);

    this._timers.set(providerId, timer);
  }

  /**
   * Run full health check for a provider.
   * @param {string} providerId
   * @returns {Promise<HealthStatus>}
   */
  async _check(providerId) {
    const view = this._getView(providerId, 0);

    if (!view || !view.webContents || view.webContents.isDestroyed()) {
      return this._buildStatus(providerId, 'offline', { reason: 'No BrowserView open' });
    }

    const wc = view.webContents;

    // 1. Loading?
    if (wc.isLoading()) {
      return this._buildStatus(providerId, 'loading', { reason: 'Page loading...' });
    }

    const checks = PROVIDER_CHECKS[providerId];
    if (!checks) {
      return this._buildStatus(providerId, 'unknown', { reason: 'No checks defined' });
    }

    try {
      const result = await wc.executeJavaScript(`
        (function() {
          // Check login wall
          const loginSels = ${JSON.stringify(checks.loginSelectors)};
          const loginVisible = loginSels.some(sel => {
            try {
              const el = document.querySelector(sel);
              return el && el.offsetParent !== null;
            } catch { return false; }
          });

          // Check input ready
          const inputSels = ${JSON.stringify(checks.inputSelectors)};
          const inputReady = inputSels.some(sel => {
            try { return !!document.querySelector(sel); }
            catch { return false; }
          });

          // Check if busy
          const busySels = ${JSON.stringify(checks.busySelectors)};
          const isBusy = busySels.some(sel => {
            try { return !!document.querySelector(sel); }
            catch { return false; }
          });

          return {
            loginVisible,
            inputReady,
            isBusy,
            title : document.title,
            url   : location.href,
          };
        })()
      `);

      if (result.loginVisible) {
        return this._buildStatus(providerId, 'not-logged-in', {
          reason : 'Login page detected',
          url    : result.url,
          title  : result.title,
        });
      }

      if (!result.inputReady) {
        return this._buildStatus(providerId, 'not-ready', {
          reason : 'Input not found in DOM',
          url    : result.url,
          title  : result.title,
        });
      }

      if (result.isBusy) {
        return this._buildStatus(providerId, 'busy', {
          reason : 'Currently generating a response',
          url    : result.url,
          title  : result.title,
        });
      }

      return this._buildStatus(providerId, 'ready', {
        url   : result.url,
        title : result.title,
      });

    } catch (err) {
      return this._buildStatus(providerId, 'error', {
        reason : `JS execution failed: ${err.message}`,
      });
    }
  }

  _buildStatus(id, status, details = {}) {
    return {
      id,
      status,    // 'ready' | 'busy' | 'loading' | 'not-logged-in' | 'not-ready' | 'offline' | 'error' | 'unknown'
      details,
      checkedAt  : Date.now(),
    };
  }
}

// Status → emoji/color mapping for the renderer
HealthMonitor.STATUS_ICON = {
  'ready'        : '🟢',
  'busy'         : '🟡',
  'loading'      : '🟡',
  'not-logged-in': '🔴',
  'not-ready'    : '🔴',
  'offline'      : '⚫',
  'error'        : '🔴',
  'unknown'      : '⚫',
};

HealthMonitor.STATUS_COLOR = {
  'ready'        : '#22c55e',
  'busy'         : '#f59e0b',
  'loading'      : '#f59e0b',
  'not-logged-in': '#ef4444',
  'not-ready'    : '#ef4444',
  'offline'      : '#6b7280',
  'error'        : '#ef4444',
  'unknown'      : '#6b7280',
};

/**
 * @typedef {object} HealthStatus
 * @property {string} id
 * @property {string} status
 * @property {object} details
 * @property {number} checkedAt
 */

module.exports = HealthMonitor;
