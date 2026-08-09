/**
 * GeminiProvider — DOM driver for gemini.google.com
 * Uses Quill editor (.ql-editor) with Angular change detection.
 */
const BaseProvider = require('./base-provider');

class GeminiProvider extends BaseProvider {
  constructor() {
    super({ id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com', timeout: 120000 });
  }

  async injectPrompt(wc, text) {
    const result = await this._exec(wc, `
      (function() {
        // Gemini uses .ql-editor (Quill) or a rich textarea
        const editor = document.querySelector(
          'rich-textarea .ql-editor, ' +
          '.input-area-container [contenteditable="true"], ' +
          'p.textarea[contenteditable="true"]'
        );
        if (!editor) return false;
        editor.focus();
        editor.innerHTML = '<p>' + ${JSON.stringify(text)}.replace(/</g,'&lt;') + '</p>';
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return true;
      })()
    `);
    if (!result) throw new Error('Gemini: could not find input');
  }

  async sendPrompt(wc) {
    const result = await this._exec(wc, `
      (function() {
        const btn = document.querySelector(
          'button[aria-label="Send message"], ' +
          'button.send-button, mat-icon[data-mat-icon-name="send"]'
        );
        const sendEl = btn || btn?.closest('button');
        if (sendEl) { sendEl.click(); return true; }
        const editor = document.querySelector('[contenteditable="true"]');
        if (editor) {
          editor.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', keyCode:13, bubbles:true }));
          return true;
        }
        return false;
      })()
    `);
  }

  async extractResponse(wc) {
    return await this._exec(wc, `
      (function() {
        const els = document.querySelectorAll(
          '.model-response-text, .response-content, ' +
          'model-response .markdown, .Trstsf'
        );
        if (!els.length) return '';
        return els[els.length - 1].innerText || '';
      })()
    `);
  }

  async isStreaming(wc) {
    const r = await this._exec(wc, `
      (function() {
        return !!(document.querySelector('.loading-indicator, .generating-indicator, [aria-label*="Generating"]'));
      })()
    `);
    return !!r;
  }
}


/**
 * GrokProvider — DOM driver for grok.com (x.ai)
 */
class GrokProvider extends BaseProvider {
  constructor() {
    super({ id: 'grok', label: 'Grok', url: 'https://grok.com', timeout: 120000 });
  }

  async injectPrompt(wc, text) {
    const result = await this._exec(wc, this._reactSetValue('textarea', text));
    if (!result) {
      // Try contenteditable fallback
      await this._exec(wc, this._contenteditableSet('[contenteditable="true"]', text));
    }
  }

  async sendPrompt(wc) {
    await this._exec(wc, `
      (function() {
        const btn = document.querySelector(
          'button[type="submit"], button[aria-label*="Send"], button[data-testid*="send"]'
        );
        if (btn && !btn.disabled) { btn.click(); return true; }
        const ta = document.querySelector('textarea');
        if (ta) {
          ta.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', keyCode:13, bubbles:true }));
        }
      })()
    `);
  }

  async extractResponse(wc) {
    return await this._exec(wc, `
      (function() {
        const els = document.querySelectorAll('.response-content, .message-content, [class*="message"]:not([class*="user"])');
        const responses = Array.from(els).filter(el =>
          !el.closest('[data-role="user"]') && !el.closest('.user-message')
        );
        if (!responses.length) return '';
        return responses[responses.length - 1].innerText || '';
      })()
    `);
  }

  async isStreaming(wc) {
    const r = await this._exec(wc, `
      !!(document.querySelector('.streaming, .loading, [aria-busy="true"]'))
    `);
    return !!r;
  }
}


/**
 * PerplexityProvider — DOM driver for perplexity.ai
 */
class PerplexityProvider extends BaseProvider {
  constructor() {
    super({ id: 'perplexity', label: 'Perplexity', url: 'https://perplexity.ai', timeout: 90000 });
  }

  async injectPrompt(wc, text) {
    // Perplexity uses a textarea
    let ok = await this._exec(wc, this._reactSetValue('textarea[placeholder]', text));
    if (!ok) ok = await this._exec(wc, this._reactSetValue('textarea', text));
    if (!ok) throw new Error('Perplexity: could not find textarea');
  }

  async sendPrompt(wc) {
    await this._exec(wc, `
      (function() {
        const btn = document.querySelector('button[aria-label*="Submit"], button[type="submit"]');
        if (btn && !btn.disabled) { btn.click(); return; }
        const ta = document.querySelector('textarea');
        if (ta) ta.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', keyCode:13, bubbles:true }));
      })()
    `);
  }

  async extractResponse(wc) {
    return await this._exec(wc, `
      (function() {
        // Perplexity answer section
        const els = document.querySelectorAll('.prose, [class*="answer"], .markdown-content');
        if (!els.length) return '';
        return els[els.length - 1].innerText || '';
      })()
    `);
  }

  async isStreaming(wc) {
    const r = await this._exec(wc, `
      !!(document.querySelector('.animate-pulse, [data-state="loading"], .searching'))
    `);
    return !!r;
  }
}


/**
 * CopilotProvider — DOM driver for copilot.microsoft.com
 */
class CopilotProvider extends BaseProvider {
  constructor() {
    super({ id: 'copilot', label: 'Copilot', url: 'https://copilot.microsoft.com', timeout: 120000 });
  }

  async injectPrompt(wc, text) {
    let ok = await this._exec(wc, this._reactSetValue('#userInput, textarea[name="q"]', text));
    if (!ok) {
      ok = await this._exec(wc, this._contenteditableSet('[contenteditable="true"]', text));
    }
    if (!ok) throw new Error('Copilot: could not find input');
  }

  async sendPrompt(wc) {
    await this._exec(wc, `
      (function() {
        const btn = document.querySelector(
          'button[aria-label*="Submit"], button#sendButton, ' +
          'button[data-testid="submit"]'
        );
        if (btn && !btn.disabled) { btn.click(); return; }
        const el = document.querySelector('[contenteditable="true"], textarea');
        if (el) el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', keyCode:13, bubbles:true }));
      })()
    `);
  }

  async extractResponse(wc) {
    return await this._exec(wc, `
      (function() {
        const els = document.querySelectorAll(
          '.response-message, [class*="bot-message"], .ac-container'
        );
        if (!els.length) return '';
        return els[els.length - 1].innerText || '';
      })()
    `);
  }

  async isStreaming(wc) {
    const r = await this._exec(wc, `
      !!(document.querySelector('[aria-label*="stop"], .stopButton, .generating'))
    `);
    return !!r;
  }
}

module.exports = { GeminiProvider, GrokProvider, PerplexityProvider, CopilotProvider };
