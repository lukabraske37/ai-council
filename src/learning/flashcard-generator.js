/**
 * flashcard-generator.js — Learning tool for AI Council v6
 *
 * How it works (no API keys needed):
 *
 *   1. You pass it a webContents and a conversation text
 *      (or let it read the last response directly from the DOM).
 *
 *   2. It injects a special meta-prompt into the SAME open AI panel asking
 *      the AI to return JSON flashcard pairs (Q&A) based on the content.
 *
 *   3. It waits for the response, parses the JSON, and appends the cards
 *      to ~/.ai-council/flashcards.jsonl.
 *
 * BUG FIX v6-fixed (_waitForResponse):
 *   The original code waited for streaming to stop and then extracted the
 *   last response — but if the send silently failed (button not found,
 *   streaming undetected), it returned the PREVIOUS response text which is
 *   not JSON, causing _parseJSON to fail with a confusing warning.
 *
 *   Fix: snapshot the current last response BEFORE sending the meta-prompt.
 *   After streaming stops, compare: if the text is unchanged, the send
 *   failed — return '' so the caller gets an empty result and logs a warning,
 *   rather than silently returning stale text.
 *
 * Output format (flashcards.jsonl):
 *   { ts, sessionId, provider, sourcePrompt, question, answer, deck }
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DATA_DIR       = path.join(os.homedir(), '.ai-council');
const FLASHCARD_FILE = path.join(DATA_DIR, 'flashcards.jsonl');
const SESSION_ID_REF = require('../memory/shared-memory').SESSION_ID;

// How long to wait for the AI to produce flashcard JSON (ms)
const FLASHCARD_TIMEOUT_MS = 60000;
const FLASHCARD_POLL_MS    = 800;

// ── Meta-prompt template ──────────────────────────────────────────────────

function buildFlashcardPrompt(sourceText, opts = {}) {
  const count   = opts.count   || 5;
  const deck    = opts.deck    || 'General';
  const snippet = sourceText.slice(0, 2500);

  return (
    `Based on the following content, generate exactly ${count} flashcard question-answer pairs for active recall studying.\n\n` +
    `CONTENT:\n"""\n${snippet}\n"""\n\n` +
    `Return ONLY a raw JSON array (no markdown, no code fences, no explanation) in this exact format:\n` +
    `[{"q":"<question>","a":"<answer>"},{"q":"...","a":"..."}]\n\n` +
    `Rules:\n` +
    `- Questions should test understanding, not just facts\n` +
    `- Answers should be 1–3 sentences\n` +
    `- Deck name: "${deck}"\n` +
    `- Output must be valid JSON and nothing else`
  );
}

// ── FlashcardGenerator class ──────────────────────────────────────────────

class FlashcardGenerator {
  /**
   * @param {Function} getView  — same getView(providerId, slot) used in engine.js
   *                              returns an Electron BrowserView
   */
  constructor(getView) {
    this._getView = getView;
    this._ensureDir();
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Generate flashcards from an explicit source text.
   * Injects a meta-prompt into the specified provider's open panel.
   *
   * @param {string} providerId
   * @param {number} slot
   * @param {string} sourceText   — the content to make cards from
   * @param {Object} opts         — { count, deck }
   * @returns {Promise<Array>}    — array of { question, answer, deck }
   */
  async generateFromText(providerId, slot, sourceText, opts = {}) {
    if (!sourceText || sourceText.length < 50) {
      console.warn('[Flashcards] Source text too short — skipping');
      return [];
    }

    const view = this._getView(providerId, slot);
    if (!view?.webContents) {
      console.warn(`[Flashcards] No open panel for ${providerId}`);
      return [];
    }

    const metaPrompt = buildFlashcardPrompt(sourceText, opts);
    console.log(`[Flashcards] Injecting meta-prompt into ${providerId} panel…`);

    // BUG FIX: snapshot before sending so _waitForResponse can detect a new reply
    const snapshotBefore = await this._extractLastResponse(view.webContents, providerId).catch(() => '');

    const sent = await this._sendMetaPrompt(view.webContents, providerId, metaPrompt);
    if (!sent) {
      console.warn(`[Flashcards] Failed to inject prompt into ${providerId}`);
      return [];
    }

    // Wait for the response and parse JSON (pass snapshot to detect stale replies)
    const responseText = await this._waitForResponse(view.webContents, providerId, snapshotBefore);
    if (!responseText) return [];

    const cards = this._parseJSON(responseText);
    if (!cards.length) {
      console.warn('[Flashcards] No cards parsed from response:', responseText.slice(0, 200));
      return [];
    }

    // Save and return
    const saved = cards.map(c => ({
      question : c.q || c.question || '',
      answer   : c.a || c.answer   || '',
      deck     : opts.deck || 'General',
    })).filter(c => c.question && c.answer);

    this._saveCards(providerId, opts.sourcePrompt || '(from session)', saved, opts.deck || 'General');
    console.log(`[Flashcards] Saved ${saved.length} cards from ${providerId}`);
    return saved;
  }

  /**
   * Generate flashcards by reading whatever is on screen in the AI panel
   * (the last assistant response) and using it as the source text.
   *
   * @param {string} providerId
   * @param {number} slot
   * @param {string} originalPrompt  — the user's original question (for metadata)
   * @param {Object} opts            — { count, deck }
   * @returns {Promise<Array>}
   */
  async generateFromDOM(providerId, slot, originalPrompt = '', opts = {}) {
    const view = this._getView(providerId, slot);
    if (!view?.webContents) {
      console.warn(`[Flashcards] No open panel for ${providerId}`);
      return [];
    }

    const sourceText = await this._extractLastResponse(view.webContents, providerId);
    if (!sourceText) {
      console.warn(`[Flashcards] No response text found in ${providerId} DOM`);
      return [];
    }

    return this.generateFromText(providerId, slot, sourceText, {
      ...opts,
      sourcePrompt: originalPrompt,
    });
  }

  /**
   * Generate flashcards from multiple providers at once.
   * Each provider's last on-screen response becomes the source.
   *
   * @param {Array<{providerId, slot}>} targets
   * @param {string} originalPrompt
   * @param {Object} opts
   * @returns {Promise<Array>}
   */
  async generateFromAll(targets, originalPrompt = '', opts = {}) {
    const allCards = [];
    for (const { providerId, slot } of targets) {
      try {
        const cards = await this.generateFromDOM(providerId, slot, originalPrompt, {
          ...opts,
          deck: opts.deck || `${_label(providerId)} — ${new Date().toLocaleDateString()}`,
        });
        allCards.push(...cards);
      } catch (err) {
        console.warn(`[Flashcards] Error from ${providerId}:`, err.message);
      }
    }
    return allCards;
  }

  /**
   * Return all saved flashcards.
   * @param {Object} opts — { deck, limit }
   * @returns {Array}
   */
  getSaved({ deck = null, limit = 200 } = {}) {
    if (!fs.existsSync(FLASHCARD_FILE)) return [];
    try {
      const lines = fs.readFileSync(FLASHCARD_FILE, 'utf8').split('\n').filter(Boolean);
      let cards = [];
      for (const line of lines) {
        try { cards.push(JSON.parse(line)); } catch { /* skip */ }
      }
      if (deck) cards = cards.filter(c => c.deck === deck);
      return cards.reverse().slice(0, limit);
    } catch (err) {
      console.warn('[Flashcards] getSaved error:', err.message);
      return [];
    }
  }

  /**
   * Get all unique deck names.
   * @returns {string[]}
   */
  getDecks() {
    const cards = this.getSaved({ limit: 2000 });
    return [...new Set(cards.map(c => c.deck).filter(Boolean))];
  }

  // ── DOM helpers ───────────────────────────────────────────────────────

  async _sendMetaPrompt(wc, providerId, text) {
    const escaped = JSON.stringify(text);

    const injected = await wc.executeJavaScript(`
      (function() {
        const editor =
          document.querySelector('#prompt-textarea') ||
          document.querySelector('.ProseMirror[contenteditable="true"]') ||
          document.querySelector('div[contenteditable="true"]') ||
          document.querySelector('textarea');
        if (!editor) return false;
        editor.focus();
        if (editor.tagName === 'TEXTAREA') {
          const proto  = window.HTMLTextAreaElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value');
          if (setter && setter.set) setter.set.call(editor, ${escaped});
          else editor.value = ${escaped};
          editor.dispatchEvent(new Event('input',  { bubbles: true }));
          editor.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, ${escaped});
          editor.dispatchEvent(new InputEvent('input', {
            bubbles: true, cancelable: true,
            inputType: 'insertText', data: ${escaped},
          }));
        }
        return true;
      })()
    `).catch(() => false);

    if (!injected) return false;

    await _sleep(400);

    const sent = await wc.executeJavaScript(`
      (function() {
        const btn =
          document.querySelector('button[data-testid="send-button"]') ||
          document.querySelector('button[aria-label="Send message"]') ||
          document.querySelector('button[aria-label="Send Message"]') ||
          document.querySelector('button[aria-label*="Send"]');
        if (btn && !btn.disabled) { btn.click(); return true; }
        const editor = document.querySelector('[contenteditable="true"]') ||
                       document.querySelector('#prompt-textarea');
        if (editor) {
          editor.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13,
            bubbles: true, shiftKey: false,
          }));
          return true;
        }
        return false;
      })()
    `).catch(() => false);

    return !!sent;
  }

  /**
   * Wait for a NEW response to appear (different from snapshotBefore).
   *
   * BUG FIX v6-fixed: Original code just waited for streaming to stop and
   * returned whatever _extractLastResponse returned — which could be the
   * PREVIOUS (pre-flashcard) response if the send silently failed.
   *
   * Now takes a snapshotBefore and verifies the DOM changed before returning.
   *
   * @param {Electron.WebContents} wc
   * @param {string} providerId
   * @param {string} snapshotBefore  — text of last response before meta-prompt was sent
   * @returns {Promise<string>}
   */
  async _waitForResponse(wc, providerId, snapshotBefore = '') {
    const deadline = Date.now() + FLASHCARD_TIMEOUT_MS;

    // Phase 1: wait for streaming to START (up to 6s)
    const startDeadline = Date.now() + 6000;
    let startedStreaming = false;
    while (Date.now() < startDeadline) {
      const streaming = await this._isStreaming(wc).catch(() => false);
      if (streaming) { startedStreaming = true; break; }
      await _sleep(300);
    }

    if (!startedStreaming) {
      console.warn('[Flashcards] Streaming did not start — checking if response appeared anyway');
    }

    // Phase 2: wait for streaming to FINISH
    while (Date.now() < deadline) {
      const streaming = await this._isStreaming(wc).catch(() => false);
      if (!streaming) break;
      await _sleep(FLASHCARD_POLL_MS);
    }

    // Buffer for DOM to settle after streaming stops
    await _sleep(600);

    // Phase 3: compare with snapshot — verify a new response appeared
    const newResponse = await this._extractLastResponse(wc, providerId);

    if (!newResponse) {
      console.warn('[Flashcards] No response text found in DOM');
      return '';
    }

    if (newResponse === snapshotBefore) {
      console.warn('[Flashcards] Response unchanged after meta-prompt — send may have failed');
      return '';
    }

    return newResponse;
  }

  async _isStreaming(wc) {
    return wc.executeJavaScript(`
      !!(
        document.querySelector('[data-is-streaming="true"]') ||
        document.querySelector('button[aria-label="Stop generating"]') ||
        document.querySelector('button[aria-label="Stop streaming"]') ||
        document.querySelector('button[aria-label="Stop"]') ||
        document.querySelector('[data-testid="stop-button"]') ||
        document.querySelector('.result-streaming') ||
        document.querySelector('.streaming-cursor') ||
        document.querySelector('.animate-blink')
      )
    `).catch(() => false);
  }

  async _extractLastResponse(wc, providerId) {
    const selectors = {
      chatgpt    : ['[data-message-author-role="assistant"] .markdown', '.agent-turn .markdown'],
      // BUG FIX: was 'div[class*="prose"]' — substring match catches div.ProseMirror
      // (the input editor at the bottom of the DOM). Exact token + :not([contenteditable]).
      claude     : ['.font-claude-message', 'div.prose:not([contenteditable])', '[data-message-author-role="assistant"]'],
      gemini     : ['model-response .response-content', '.model-response-text'],
      grok       : ['[data-testid="conversation-turn-assistant"]', '.response-content'],
      perplexity : ['.prose', '[data-testid="answer-text"]'],
      copilot    : ['.ac-textBlock', '.response-message'],
    };

    const providerSels = selectors[providerId] || ['[data-message-author-role="assistant"]', '.response'];

    // Priority order — first selector that returns non-empty text wins.
    for (const sel of providerSels) {
      try {
        const text = await wc.executeJavaScript(`
          (function() {
            const els = document.querySelectorAll(${JSON.stringify(sel)});
            if (!els.length) return '';
            return (els[els.length-1].innerText || els[els.length-1].textContent || '').trim();
          })()
        `);
        if (text && text.length > 0) return text;
      } catch { /* try next */ }
    }
    return '';
  }

  // ── JSON parsing ──────────────────────────────────────────────────────

  _parseJSON(text) {
    if (!text) return [];

    let clean = text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    const start = clean.indexOf('[');
    const end   = clean.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) {
      console.warn('[Flashcards] No JSON array found in response');
      return [];
    }

    try {
      const parsed = JSON.parse(clean.slice(start, end + 1));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(item => (item.q || item.question) && (item.a || item.answer));
    } catch (err) {
      console.warn('[Flashcards] JSON parse error:', err.message);
      return [];
    }
  }

  // ── Persistence ───────────────────────────────────────────────────────

  _saveCards(providerId, sourcePrompt, cards, deck) {
    this._ensureDir();
    const ts = Date.now();
    try {
      const lines = cards.map(c => JSON.stringify({
        ts,
        sessionId    : SESSION_ID_REF,
        provider     : providerId,
        deck,
        sourcePrompt : (sourcePrompt || '').slice(0, 200),
        question     : c.question,
        answer       : c.answer,
      }));
      fs.appendFileSync(FLASHCARD_FILE, lines.join('\n') + '\n', 'utf8');
    } catch (err) {
      console.warn('[Flashcards] _saveCards error:', err.message);
    }
  }

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

const LABELS = {
  chatgpt:'ChatGPT', claude:'Claude', gemini:'Gemini',
  grok:'Grok', perplexity:'Perplexity', copilot:'Copilot',
};
function _label(id) { return LABELS[id] || id; }
function _sleep(ms)  { return new Promise(r => setTimeout(r, ms)); }

module.exports = FlashcardGenerator;
module.exports.FLASHCARD_FILE = FLASHCARD_FILE;
module.exports.DATA_DIR       = DATA_DIR;
