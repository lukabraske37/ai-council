/**
 * PerplexityProvider — DOM driver for perplexity.ai
 *
 * Perplexity uses a React-controlled textarea for input.
 * Multi-fallback selectors for resilience across updates.
 */
'use strict';

const BaseProvider = require('./base-provider');

class PerplexityProvider extends BaseProvider {
  constructor() {
    super({
      id      : 'perplexity',
      label   : 'Perplexity',
      url     : 'https://perplexity.ai',
      timeout : 90000,
      pollMs  : 600,
    });

    this.SELECTORS = {
      input  : [
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="Search"]',
        'textarea[data-testid="search-input"]',
        'textarea',
      ],
      send   : [
        'button[aria-label="Submit"]',
        'button[data-testid="submit-button"]',
        'button[type="submit"]',
      ],
      output : [
        '.prose',
        '[data-testid="answer"]',
        '.answer-content',
        '[class*="Answer"] .prose',
      ],
    };
  }

  async injectPrompt(wc, text) {
    const result = await this._exec(wc, `
      (function() {
        const ta =
          document.querySelector('textarea[placeholder*="Ask"]')        ||
          document.querySelector('textarea[placeholder*="Search"]')     ||
          document.querySelector('textarea[data-testid="search-input"]')||
          document.querySelector('textarea');
        if (!ta) return false;

        ta.focus();
        // React native setter to properly trigger synthetic events
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
    if (!result) throw new Error('Perplexity: could not find textarea');
  }

  async sendPrompt(wc) {
    await this._exec(wc, `
      (function() {
        const btn =
          document.querySelector('button[aria-label="Submit"]')          ||
          document.querySelector('button[data-testid="submit-button"]')  ||
          document.querySelector('button[type="submit"]');
        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
        // Enter key fallback
        const ta = document.querySelector('textarea');
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
        const selectors = [
          '.prose',
          '[data-testid="answer"] .prose',
          '[class*="Answer"] .prose',
          '.answer-content',
          '.markdown-content',
          '[class*="answer"]',
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length) {
            // Combine all answer blocks if multiple
            const texts = Array.from(els).map(el =>
              (el.innerText || el.textContent || '').trim()
            ).filter(t => t.length > 30);
            if (texts.length) return texts[texts.length - 1];
          }
        }
        return '';
      })()
    `);
  }

  async isStreaming(wc) {
    const r = await this._exec(wc, `
      !!(
        document.querySelector('[data-state="loading"]') ||
        document.querySelector('.searching')             ||
        document.querySelector('[class*="animate-pulse"]') ||
        document.querySelector('[aria-label*="Stop"]')
      )
    `);
    return !!r;
  }
}

module.exports = PerplexityProvider;
