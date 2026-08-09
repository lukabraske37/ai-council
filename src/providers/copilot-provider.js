/**
 * CopilotProvider — DOM driver for copilot.microsoft.com
 *
 * Microsoft Copilot's UI uses both custom web components and
 * standard elements. Multi-fallback approach for resilience.
 */
'use strict';

const BaseProvider = require('./base-provider');

class CopilotProvider extends BaseProvider {
  constructor() {
    super({
      id      : 'copilot',
      label   : 'Copilot',
      url     : 'https://copilot.microsoft.com',
      timeout : 120000,
      pollMs  : 700,
    });

    this.SELECTORS = {
      input  : [
        '#userInput',
        'textarea[aria-label*="message"]',
        'textarea[placeholder*="Ask"]',
        '[contenteditable="true"][aria-label*="message"]',
        '[contenteditable="true"]',
      ],
      send   : [
        'button#submitButton',
        'button[aria-label="Submit message"]',
        'button[aria-label*="Submit"]',
        'button[aria-label*="Send"]',
      ],
      output : [
        '.cib-message-content',
        '.ac-container',
        '[class*="bot-message"]',
        '[data-author="bot"] .message-content',
      ],
    };
  }

  async injectPrompt(wc, text) {
    // Try #userInput (textarea) first
    let result = await this._exec(wc, `
      (function() {
        const el =
          document.querySelector('#userInput')                              ||
          document.querySelector('textarea[aria-label*="message"]')        ||
          document.querySelector('textarea[placeholder*="Ask"]')           ||
          document.querySelector('textarea');

        if (el && el.tagName === 'TEXTAREA') {
          el.focus();
          const proto  = window.HTMLTextAreaElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value');
          if (setter && setter.set) {
            setter.set.call(el, ${JSON.stringify(text)});
          } else {
            el.value = ${JSON.stringify(text)};
          }
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      })()
    `);

    // Fallback to contenteditable
    if (!result) {
      result = await this._exec(wc, `
        (function() {
          const el =
            document.querySelector('[contenteditable="true"][aria-label*="message"]') ||
            document.querySelector('[contenteditable="true"]');
          if (!el) return false;
          el.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, ${JSON.stringify(text)});
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
          return true;
        })()
      `);
    }

    if (!result) throw new Error('Copilot: could not find input element');
  }

  async sendPrompt(wc) {
    await this._exec(wc, `
      (function() {
        const btn =
          document.querySelector('button#submitButton')              ||
          document.querySelector('button[aria-label="Submit message"]') ||
          document.querySelector('button[aria-label*="Submit"]')    ||
          document.querySelector('button[aria-label*="Send"]');

        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
        // Enter fallback
        const el =
          document.querySelector('#userInput') ||
          document.querySelector('[contenteditable="true"]') ||
          document.querySelector('textarea');
        if (el) {
          el.dispatchEvent(new KeyboardEvent('keydown', {
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
          '.cib-message-content',
          '.ac-container',
          '[class*="bot-message"]',
          '[data-author="bot"] .message-content',
          '[class*="ResponseMessage"]',
          '[class*="assistant-message"]',
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
        document.querySelector('.cib-typing-indicator') ||
        document.querySelector('[class*="typing"]')     ||
        document.querySelector('[class*="generating"]') ||
        document.querySelector('[aria-label*="Stop"]')  ||
        document.querySelector('.stopButton')
      )
    `);
    return !!r;
  }
}

module.exports = CopilotProvider;
