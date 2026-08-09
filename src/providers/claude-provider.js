/**
 * ClaudeProvider — DOM driver for claude.ai
 *
 * FIXES vs original:
 *   - injectPrompt(): original code set editor.innerHTML = '<p></p>' before
 *     the selectAll/delete sequence. Setting innerHTML directly destroys
 *     ProseMirror's internal node tree and leaves the editor in a broken state.
 *     Fix: focus → selectAll → insertText only (no innerHTML assignment).
 *   - extractResponse(): selectors '.claude-message-content' and
 *     '[data-testid="assistant-message"]' are not present in claude.ai's
 *     current DOM. Primary selector is now '.font-claude-message', with a
   *     Fix: added prose/class-variant fallbacks that survive streaming completion.
 *   - isStreaming(): added '[data-is-streaming="true"]' which Claude sets on
 *     the streaming response container — more reliable than the stop button alone.
 *   - sendPrompt(): Claude's send button aria-label is "Send Message" (capital
 *     S and M). Added a JS-side case-insensitive scan as final fallback.
 *   - SELECTORS defined so selfTest() provides real coverage data.
 *   - extractResponse() [BUG FIX v6-final+1]: fallback 'div[class*="prose"]' changed
 *     to 'div.prose:not([contenteditable])'. The substring match 'class*=prose'
 *     also matched 'div.ProseMirror' (the user's input box, which sits at the
 *     BOTTOM of the DOM). Since extractResponse takes the LAST match, it was
 *     returning the user's own typed text instead of Claude's response.
 */
const BaseProvider = require('./base-provider');

class ClaudeProvider extends BaseProvider {
  constructor() {
    super({
      id      : 'claude',
      label   : 'Claude',
      url     : 'https://claude.ai',
      timeout : 120000,
      pollMs  : 700,
    });

    this.SELECTORS = {
      input  : ['.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]'],
      send   : ['button[aria-label="Send message"]'],  // FIX: lowercase 'm' — claude.ai uses "Send message"
      output : ['.font-claude-message'],
    };
  }

  async injectPrompt(wc, text) {
    // FIX: Original code assigned to editor.innerHTML = '<p></p>' before
    // calling execCommand. That destroys ProseMirror's internal node
    // representation and can leave the editor non-functional.
    //
    // Correct pattern for ProseMirror / any contenteditable:
    //   focus → selectAll (marks all content as selected) → insertText
    //   (execCommand replaces the selection with the new text).
    const result = await this._exec(wc, `
      (function() {
        const editor =
          document.querySelector('.ProseMirror[contenteditable="true"]') ||
          document.querySelector('div[contenteditable="true"][data-placeholder]') ||
          document.querySelector('fieldset div[contenteditable="true"]') ||
          document.querySelector('div[contenteditable="true"]');
        if (!editor) return false;
        editor.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, ${JSON.stringify(text)});
        editor.dispatchEvent(new InputEvent('input', {
          bubbles   : true,
          cancelable: true,
          inputType : 'insertText',
          data      : ${JSON.stringify(text)},
        }));
        return true;
      })()
    `);
    if (!result) throw new Error('Claude: could not find ProseMirror editor');
  }

  async sendPrompt(wc) {
    const result = await this._exec(wc, `
      (function() {
        // Try named buttons first (exact label, then partial)
        const btn =
          document.querySelector('button[aria-label="Send message"]') ||  // FIX: lowercase 'm'
          document.querySelector('button[aria-label="Send Message"]') ||  // backward compat
          document.querySelector('button[data-testid="send-button"]') ||
          document.querySelector('button[aria-label*="Send"]');
        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
        // Case-insensitive scan of all buttons for anything send-like
        const allBtns = [...document.querySelectorAll('button')];
        const sendBtn = allBtns.find(b => {
          const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
          return label.includes('send') && !b.disabled;
        });
        if (sendBtn) {
          sendBtn.click();
          return true;
        }
        // Final fallback: Enter on the editor
        const editor = document.querySelector('div[contenteditable="true"]');
        if (editor) {
          editor.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            bubbles: true, cancelable: true,
          }));
          editor.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            bubbles: true, cancelable: true,
          }));
          return true;
        }
        return false;
      })()
    `);
    if (!result) throw new Error('Claude: could not click send button');
  }

  async extractResponse(wc) {
    return await this._exec(wc, `
      (function() {
        // Primary: .font-claude-message — Claude's current response class
        let messages = document.querySelectorAll('.font-claude-message');

        // Fallback 1: Tailwind prose containers used for assistant message bodies.
        // BUG FIX: 'div[class*="prose"]' was a substring match that also hits
        // 'div.ProseMirror' (the user input editor, at the BOTTOM of the DOM),
        // causing extractResponse() to return the user's own text.
        // Fix: exact class token match + exclude contenteditable (input) elements.
        // NOTE: Do NOT use [data-is-streaming] here — removed when streaming ends.
        if (!messages.length) {
          messages = document.querySelectorAll('div.prose:not([contenteditable])');
        }

        // Fallback 2: assistant-turn containers
        if (!messages.length) {
          messages = document.querySelectorAll('[data-message-author-role="assistant"]');
        }

        // Fallback 3: generic claude-message class variants
        if (!messages.length) {
          messages = document.querySelectorAll('[class*="claude-message"]');
        }

        if (!messages.length) return '';
        const last = messages[messages.length - 1];
        return (last.innerText || last.textContent || '').trim();
      })()
    `);
  }

  async isStreaming(wc) {
    const result = await this._exec(wc, `
      (function() {
        // FIX: Added data-is-streaming="true" — Claude sets this attribute on
        // the active response container during generation. More reliable than
        // button detection because the stop button can be hidden mid-stream.
        if (document.querySelector('[data-is-streaming="true"]')) return true;

        const stopBtn =
          document.querySelector('button[aria-label="Stop"]') ||
          document.querySelector('button[data-testid="stop-button"]');
        if (stopBtn) return true;

        // Streaming cursor indicators
        return !!(
          document.querySelector('.streaming-cursor') ||
          document.querySelector('.animate-blink')
        );
      })()
    `);
    return !!result;
  }
}

module.exports = ClaudeProvider;
