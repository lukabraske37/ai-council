/**
 * GeminiProvider — DOM driver for gemini.google.com
 *
 * Robust multi-fallback selectors for Gemini's Angular + Quill editor.
 * If selectors break after a Gemini update, edit via ⚙️ Settings in the app.
 */
'use strict';

const BaseProvider = require('./base-provider');

class GeminiProvider extends BaseProvider {
  constructor() {
    super({
      id      : 'gemini',
      label   : 'Gemini',
      url     : 'https://gemini.google.com',
      timeout : 120000,
      pollMs  : 600,
    });

    this.SELECTORS = {
      input  : [
        'div.ql-editor[contenteditable="true"]',
        'rich-textarea .ql-editor',
        '.input-area [contenteditable="true"]',
        'p.textarea[contenteditable="true"]',
      ],
      send   : [
        'button[aria-label="Send message"]',
        'button.send-button',
        'button[jsname="Qx7uuf"]',
        'button[data-tooltip="Send message"]',
      ],
      output : [
        '.model-response-text',
        '.response-content-markdown',
        'model-response .markdown',
        '.Trstsf',
      ],
    };
  }

  async injectPrompt(wc, text) {
    const result = await this._exec(wc, `
      (function() {
        const editor =
          document.querySelector('div.ql-editor[contenteditable="true"]') ||
          document.querySelector('rich-textarea .ql-editor')              ||
          document.querySelector('.input-area [contenteditable="true"]')  ||
          document.querySelector('p.textarea[contenteditable="true"]')    ||
          document.querySelector('[contenteditable="true"]');
        if (!editor) return false;

        editor.focus();
        // Quill: selectAll → insertText is the correct pattern
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, ${JSON.stringify(text)});

        // Fire Angular input detection
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
    if (!result) throw new Error('Gemini: could not find editor element');
  }

  async sendPrompt(wc) {
    await this._exec(wc, `
      (function() {
        const btn =
          document.querySelector('button[aria-label="Send message"]') ||
          document.querySelector('button.send-button')                ||
          document.querySelector('button[jsname="Qx7uuf"]')           ||
          document.querySelector('button[data-tooltip="Send message"]');

        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }

        // Fallback: Enter on the editor
        const editor =
          document.querySelector('div.ql-editor[contenteditable="true"]') ||
          document.querySelector('[contenteditable="true"]');
        if (editor) {
          editor.dispatchEvent(new KeyboardEvent('keydown', {
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
          '.model-response-text',
          '.response-content-markdown',
          'model-response .markdown-main-panel',
          'model-response [class*="markdown"]',
          '.Trstsf',
          'message-content .markdown',
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length) {
            return (els[els.length - 1].innerText || els[els.length - 1].textContent || '').trim();
          }
        }
        return '';
      })()
    `);
  }

  async isStreaming(wc) {
    const r = await this._exec(wc, `
      !!(
        document.querySelector('button[aria-label="Stop response"]') ||
        document.querySelector('button[aria-label="Stop streaming"]') ||
        document.querySelector('.stop-button:not([disabled])') ||
        document.querySelector('.loading-indicator') ||
        document.querySelector('[aria-label*="Generating"]')
      )
    `);
    return !!r;
  }
}

module.exports = GeminiProvider;
