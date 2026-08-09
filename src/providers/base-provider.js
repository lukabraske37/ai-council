/**
 * BaseProvider — Abstract base class for all AI provider drivers.
 *
 * FIXES vs original:
 *   - selfTest() and healthCheck() were defined AFTER module.exports (dead code).
 *     Moved inside the class — they are now accessible on instances.
 *   - waitForComplete() had a race condition: it polled isStreaming() starting
 *     1500ms after sendPrompt, but generation may not have started yet, causing
 *     premature "done" detection. Now waits up to 5s for streaming to START
 *     before entering the "wait for finish" loop.
 *   - SELECTORS = null default added so selfTest() degrades gracefully on
 *     providers that haven't defined selector maps yet.
 */
class BaseProvider {
  constructor(config) {
    this.id      = config.id;
    this.label   = config.label;
    this.url     = config.url;
    this.timeout = config.timeout || 90000;
    this.pollMs  = config.pollMs  || 500;

    // Subclasses should set this to an object of { role: [selector, ...] }
    // Used by selfTest() to verify DOM coverage.
    this.SELECTORS = null;
  }

  // ── Must override ────────────────────────────────────────────────────────

  async injectPrompt(wc, text) {
    throw new Error(`${this.id}: injectPrompt() not implemented`);
  }

  async sendPrompt(wc) {
    throw new Error(`${this.id}: sendPrompt() not implemented`);
  }

  async extractResponse(wc) {
    throw new Error(`${this.id}: extractResponse() not implemented`);
  }

  async isStreaming(wc) {
    throw new Error(`${this.id}: isStreaming() not implemented`);
  }

  // ── Shared helpers ───────────────────────────────────────────────────────

  async isReady(wc) {
    try {
      return await wc.executeJavaScript(
        `document.readyState === 'complete'`
      );
    } catch {
      return false;
    }
  }

  /**
   * Wait for the AI to finish generating its response.
   *
   * FIX: Two-phase approach to avoid the race condition where isStreaming()
   * returns false BEFORE generation has started (the original code only had a
   * flat 1500ms sleep, which was not enough for slow responses).
   *
   * Phase 1 — wait up to START_WAIT_MS for streaming to begin.
   * Phase 2 — once streaming is confirmed (or timeout elapsed), poll until done.
   */
  async waitForComplete(wc, onPartial = null) {
    const START_WAIT_MS = 5000;   // How long to wait for generation to start
    const deadline      = Date.now() + this.timeout;

    // ── Phase 1: wait for streaming to START ──────────────────────────────
    const startDeadline = Date.now() + START_WAIT_MS;
    while (Date.now() < startDeadline) {
      const streaming = await this.isStreaming(wc).catch(() => false);
      if (streaming) break;
      await this._sleep(300);
    }

    // ── Phase 2: wait for streaming to FINISH ─────────────────────────────
    let lastPartial = '';

    while (Date.now() < deadline) {
      const streaming = await this.isStreaming(wc).catch(() => false);

      if (onPartial) {
        try {
          const partial = await this.extractResponse(wc);
          if (partial && partial !== lastPartial) {
            lastPartial = partial;
            onPartial(partial);
          }
        } catch { /* ignore mid-stream extraction errors */ }
      }

      if (!streaming) return true;
      await this._sleep(this.pollMs);
    }

    return false; // Timed out
  }

  /**
   * Full orchestration flow for this provider.
   * Returns { provider, label, text, timeMs, success, error? }
   */
  async run(wc, prompt, onPartial = null) {
    const start = Date.now();
    try {
      const ready = await this.isReady(wc);
      if (!ready) throw new Error('Provider not ready (page not loaded)');

      await this.injectPrompt(wc, prompt);
      await this._sleep(300);
      await this.sendPrompt(wc);
      await this.waitForComplete(wc, onPartial);
      const text = await this.extractResponse(wc);

      return {
        provider : this.id,
        label    : this.label,
        text     : text || '',
        timeMs   : Date.now() - start,
        success  : true,
      };
    } catch (err) {
      return {
        provider : this.id,
        label    : this.label,
        text     : '',
        timeMs   : Date.now() - start,
        success  : false,
        error    : err.message,
      };
    }
  }

  // ── Phase 2: selfTest & healthCheck ──────────────────────────────────────
  //
  // FIX: These were originally defined AFTER `module.exports = BaseProvider`
  // and were completely inaccessible (dead code). They are now inside the class.

  /**
   * Verify that all SELECTORS for this provider exist on the current page.
   * Returns { ok: boolean, missing: string[] }.
   * Called by engine.runBootSelfTest().
   */
  async selfTest(wc) {
    if (!this.SELECTORS) return { ok: true, missing: [] };

    const selectorList = Object.values(this.SELECTORS).flat();
    const missing = [];

    for (const sel of selectorList) {
      try {
        const found = await wc.executeJavaScript(
          `!!document.querySelector(${JSON.stringify(sel)})`
        );
        if (!found) missing.push(sel);
      } catch {
        missing.push(sel);
      }
    }

    return { ok: missing.length === 0, missing };
  }

  /**
   * Quick health check — verifies the page is loaded.
   * Returns 'ready' | 'loading' | 'error'.
   */
  async healthCheck(wc) {
    try {
      const result = await wc.executeJavaScript(
        `document.readyState === 'complete' ? 'page-ok' : 'loading'`
      );
      return result === 'page-ok' ? 'ready' : 'loading';
    } catch {
      return 'error';
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /** Safe executeJavaScript — returns null on error. */
  async _exec(wc, code) {
    try {
      return await wc.executeJavaScript(code);
    } catch (err) {
      console.warn(`[${this.id}] executeJavaScript error:`, err.message);
      return null;
    }
  }

  /**
   * Inject text into a React-controlled <textarea> or <input>.
   * Uses the native input value setter to bypass React's synthetic event system.
   */
  _reactSetValue(selector, text) {
    const escaped = JSON.stringify(text);
    return `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const proto = el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value');
        if (setter && setter.set) {
          setter.set.call(el, ${escaped});
        } else {
          el.value = ${escaped};
        }
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `;
  }

  /**
   * Inject text into a contenteditable element using execCommand.
   *
   * FIX: The original helpers (and the provider implementations) set
   * innerHTML directly before calling execCommand. This destroys the
   * editor framework's (React / ProseMirror) internal state tracking.
   * Correct approach: focus → selectAll → insertText (replaces selection).
   */
  _contenteditableSet(selector, text) {
    const escaped = JSON.stringify(text);
    return `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, ${escaped});
        el.dispatchEvent(new InputEvent('input', {
          bubbles   : true,
          cancelable: true,
          inputType : 'insertText',
          data      : ${escaped},
        }));
        return true;
      })()
    `;
  }

  _clickSelector(selector) {
    return `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
      })()
    `;
  }

  _getLastText(selector) {
    return `
      (function() {
        const els = document.querySelectorAll(${JSON.stringify(selector)});
        if (!els.length) return null;
        return els[els.length - 1].innerText || els[els.length - 1].textContent || '';
      })()
    `;
  }
}

module.exports = BaseProvider;
