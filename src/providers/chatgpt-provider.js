/**
 * ChatGPTProvider — DOM driver for chatgpt.com
 *
 * FIXES vs original:
 *   - injectPrompt(): removed `el.innerHTML = ''` which destroyed React's
 *     internal fiber state for the contenteditable. Now uses
 *     focus → selectAll → insertText only.
 *   - injectPrompt() [BUG FIX v6-fixed]: added branch for real <textarea>
 *     elements. ChatGPT currently uses <div contenteditable>, but older
 *     versions used a <textarea>. execCommand('insertText') only works on
 *     contenteditable — on a <textarea> it silently fails. The textarea branch
 *     uses the React native setter (HTMLTextAreaElement.prototype.value) which
 *     correctly triggers React's synthetic event system.
 *   - sendPrompt() [BUG FIX v6-fixed]: KeyboardEvent fallback now explicitly
 *     sets shiftKey: false so Enter submits instead of inserting a newline.
 *   - isStreaming(): "Stop streaming" aria-label was renamed to
 *     "Stop generating" by OpenAI. Updated + added data-testid fallback.
 *   - extractResponse(): added article[data-testid^="conversation-turn"]
 *     selector which is the current stable wrapper in ChatGPT's DOM.
 *   - SELECTORS defined so selfTest() provides real coverage data.
 */
const BaseProvider = require('./base-provider');

class ChatGPTProvider extends BaseProvider {
  constructor() {
    super({
      id      : 'chatgpt',
      label   : 'ChatGPT',
      url     : 'https://chatgpt.com',
      timeout : 120000,
      pollMs  : 600,
    });

    // Used by selfTest() in base-provider
    this.SELECTORS = {
      input  : ['#prompt-textarea', 'div[contenteditable="true"]'],
      send   : ['button[data-testid="send-button"]'],
      output : ['[data-message-author-role="assistant"]'],
    };
  }

  async injectPrompt(wc, text) {
    // BUG FIX: Original code set el.innerHTML = '' before execCommand.
    // That nukes React's internal virtual DOM and breaks the editor.
    //
    // BUG FIX v6-fixed: execCommand('insertText') only works on contenteditable
    // elements. If ChatGPT ever uses a real <textarea> again, execCommand
    // silently does nothing. We now detect the tag and use the React native
    // setter for textarea, execCommand for contenteditable.
    const result = await this._exec(wc, `
      (function() {
        const el = document.getElementById('prompt-textarea') ||
                   document.querySelector('div[contenteditable="true"]');
        if (!el) return false;
        el.focus();

        if (el.tagName === 'TEXTAREA') {
          // React-controlled <textarea>: bypass synthetic events via native setter
          const proto  = window.HTMLTextAreaElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value');
          if (setter && setter.set) {
            setter.set.call(el, ${JSON.stringify(text)});
          } else {
            el.value = ${JSON.stringify(text)};
          }
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          // contenteditable <div> (current ChatGPT DOM)
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, ${JSON.stringify(text)});
          el.dispatchEvent(new InputEvent('input', {
            bubbles   : true,
            cancelable: true,
            inputType : 'insertText',
            data      : ${JSON.stringify(text)},
          }));
        }
        return true;
      })()
    `);
    if (!result) throw new Error('ChatGPT: could not find input element');
  }

  async sendPrompt(wc) {
    const result = await this._exec(wc, `
      (function() {
        const sendBtn =
          document.querySelector('button[data-testid="send-button"]') ||
          document.querySelector('button[aria-label="Send message"]') ||
          document.querySelector('button[aria-label*="Send"]');
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
          return true;
        }
        // Fallback: simulate Enter on the contenteditable.
        // BUG FIX v6-fixed: explicitly set shiftKey: false — Shift+Enter
        // inserts a newline in ChatGPT, plain Enter submits.
        const el = document.getElementById('prompt-textarea') ||
                   document.querySelector('div[contenteditable="true"]');
        if (el) {
          el.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            bubbles: true, cancelable: true,
            shiftKey: false, ctrlKey: false, altKey: false,
          }));
          el.dispatchEvent(new KeyboardEvent('keyup', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            bubbles: true, cancelable: true,
            shiftKey: false,
          }));
          return true;
        }
        return false;
      })()
    `);
    if (!result) throw new Error('ChatGPT: could not click send button');
  }

  async extractResponse(wc) {
    return await this._exec(wc, `
      (function() {
        // Primary: role-based selector (most stable across ChatGPT updates)
        let messages = document.querySelectorAll(
          '[data-message-author-role="assistant"] .markdown'
        );
        // Fallback 1: conversation-turn articles
        if (!messages.length) {
          messages = document.querySelectorAll(
            'article[data-testid^="conversation-turn-"] .markdown'
          );
        }
        // Fallback 2: agent-turn class (older ChatGPT)
        if (!messages.length) {
          messages = document.querySelectorAll('.agent-turn .markdown');
        }
        // Fallback 3: bare assistant role container
        if (!messages.length) {
          messages = document.querySelectorAll('[data-message-author-role="assistant"]');
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
        // OpenAI renamed the aria-label from "Stop streaming" to
        // "Stop generating" — check both for forward/backward compat.
        const stopBtn =
          document.querySelector('button[aria-label="Stop generating"]') ||
          document.querySelector('button[aria-label="Stop streaming"]')  ||
          document.querySelector('[data-testid="stop-button"]');
        if (stopBtn) return true;
        // Loading indicator fallback
        return !!(document.querySelector('.result-streaming') ||
                  document.querySelector('[data-testid="loading-indicator"]'));
      })()
    `);
    return !!result;
  }
}

module.exports = ChatGPTProvider;
