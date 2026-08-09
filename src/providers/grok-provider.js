/**
 * GrokProvider — DOM driver for grok.com
 *
 * Grok uses a React-controlled textarea. Multi-fallback selectors.
 * If selectors break, edit via ⚙️ Settings in the app.
 */
'use strict';

const BaseProvider = require('./base-provider');

class GrokProvider extends BaseProvider {
  constructor() {
    super({
      id      : 'grok',
      label   : 'Grok',
      url     : 'https://grok.com',
      timeout : 120000,
      pollMs  : 600,
    });

    this.SELECTORS = {
      input  : [
        'textarea[data-testid="chat-input"]',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="Grok"]',
        'textarea',
      ],
      send   : [
        'button[aria-label="Send message"]',
        'button[type="submit"]',
        'button[data-testid="send-button"]',
      ],
      output : [
        '[data-message-role="assistant"] .message-content',
        '.message-bubble .prose',
        '[class*="AssistantMessage"] .prose',
        '.response-content',
      ],
    };
  }

  async injectPrompt(wc, text) {
    // Try React textarea setter first
    let result = await this._exec(wc, `
      (function() {
        const ta =
          document.querySelector('textarea[data-testid="chat-input"]') ||
          document.querySelector('textarea[placeholder*="Ask"]')       ||
          document.querySelector('textarea[placeholder*="Grok"]')      ||
          document.querySelector('textarea');
        if (!ta) return false;

        ta.focus();
        const proto  = window.HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value');
        if (setter && setter.set) {
          setter.set.call(ta, ${JSON.stringify(text)});
        } else {
          ta.value = ${JSON.stringify(text)};
        }
        ta.dispatchEvent(new Event('input',  { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);

    // Fallback to contenteditable
    if (!result) {
      result = await this._exec(wc, this._contenteditableSet('[contenteditable="true"]', text));
    }
    if (!result) throw new Error('Grok: could not find input element');
  }

  async sendPrompt(wc) {
    await this._exec(wc, `
      (function() {
        const btn =
          document.querySelector('button[aria-label="Send message"]') ||
          document.querySelector('button[data-testid="send-button"]') ||
          document.querySelector('button[type="submit"]');
        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
        // Enter key fallback
        const ta =
          document.querySelector('textarea[data-testid="chat-input"]') ||
          document.querySelector('textarea');
        if (ta) {
          ta.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            bubbles: true, cancelable: true, shiftKey: false,
          }));
          return true;
        }
        return false;
      })()
    `);
  }

  async extractResponse(wc) {
    return await this._exec(wc, `
      (function() {
        // Try specific assistant role selectors first
        const selectors = [
          '[data-message-role="assistant"] .message-content',
          '[class*="AssistantMessage"] .prose',
          '[class*="assistant"] .prose',
          '.message-bubble .prose',
          '[class*="message-bubble"]:last-child',
          '.response-content',
          '[class*="message"]:not([class*="user"]):not([class*="User"])',
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length) {
            const last = els[els.length - 1];
            const txt = (last.innerText || last.textContent || '').trim();
            if (txt.length > 20) return txt;
          }
        }
        return '';
      })()
    `);
  }

  async isStreaming(wc) {
    const r = await this._exec(wc, `
      !!(
        document.querySelector('button[aria-label="Stop"]') ||
        document.querySelector('button[aria-label*="Stop"]') ||
        document.querySelector('[class*="streaming"]') ||
        document.querySelector('[class*="thinking"]') ||
        document.querySelector('[aria-busy="true"]') ||
        document.querySelector('.loading')
      )
    `);
    return !!r;
  }
}

module.exports = GrokProvider;
