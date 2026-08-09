/**
 * shared-memory.js — Cross-AI shared memory for AI Council v6
 *
 * Approach: No API keys. Everything via DOM reads and the local file system.
 *
 * Two mechanisms work together:
 *
 *   A) Capture  — after each AI response, addEntry() appends it to
 *      shared-memory.jsonl.
 *
 *   B) Inject   — before sending a new prompt, buildPrefix() reads recent
 *      entries from shared-memory.jsonl and prepends a compact summary to
 *      the user's prompt, so every AI knows what others have said.
 *
 * BUG FIX v6-fixed:
 *   buildPrefix() called e.response.length which throws when e.response is
 *   null or undefined (addEntry stores up to 3000 chars but old or malformed
 *   entries could have missing fields). Fixed to (e.response || '').length.
 *
 * File: ~/.ai-council/shared-memory.jsonl  (one JSON object per line)
 * Each line: { ts, provider, prompt, response, sessionId }
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Config ────────────────────────────────────────────────────────────────

const DATA_DIR  = path.join(os.homedir(), '.ai-council');
const MEM_FILE  = path.join(DATA_DIR, 'shared-memory.jsonl');

// How many recent entries to include in a prefix (more = more context, more tokens)
const MAX_ENTRIES_IN_PREFIX = 6;
// Truncate each response to this many chars in the prefix to keep prompts short
const RESPONSE_TRUNCATE_CHARS = 400;
// Session ID — changes every app launch. Used so "recent" means "this session".
const SESSION_ID = `s_${Date.now()}`;

// ── Ensure data dir exists ────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ── Core: read / write ────────────────────────────────────────────────────

/**
 * Append one exchange (prompt + AI response) to shared memory.
 *
 * @param {string} providerId  — 'chatgpt' | 'claude' | 'gemini' | etc.
 * @param {string} prompt      — the prompt that was sent
 * @param {string} response    — the response received
 * @param {Object} [meta]      — optional extra fields (taskType, score, etc.)
 */
function addEntry(providerId, prompt, response, meta = {}) {
  if (!providerId || !response) return;
  ensureDir();

  const entry = {
    ts        : Date.now(),
    sessionId : SESSION_ID,
    provider  : providerId,
    prompt    : (prompt   || '').slice(0, 600),
    response  : (response || '').slice(0, 3000),
    ...meta,
  };

  try {
    fs.appendFileSync(MEM_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn('[SharedMemory] addEntry write error:', err.message);
  }
}

/**
 * Read recent entries from shared memory.
 *
 * @param {Object}  opts
 * @param {boolean} opts.thisSessionOnly  — if true, only return current-session entries
 * @param {number}  opts.limit            — max entries to return (newest first)
 * @param {string}  opts.exclude          — skip entries from this provider
 * @returns {Array<Object>}
 */
function readRecent({ thisSessionOnly = true, limit = MAX_ENTRIES_IN_PREFIX, exclude = null } = {}) {
  if (!fs.existsSync(MEM_FILE)) return [];

  try {
    const lines = fs.readFileSync(MEM_FILE, 'utf8')
      .split('\n')
      .filter(Boolean);

    const entries = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }

    let filtered = entries;
    if (thisSessionOnly) {
      filtered = filtered.filter(e => e.sessionId === SESSION_ID);
    }
    if (exclude) {
      filtered = filtered.filter(e => e.provider !== exclude);
    }

    // Newest first, take limit
    return filtered.reverse().slice(0, limit);
  } catch (err) {
    console.warn('[SharedMemory] readRecent error:', err.message);
    return [];
  }
}

/**
 * Build a context prefix to prepend to a prompt.
 *
 * Example output:
 *
 *   [Context from other AIs in this session]
 *   • ChatGPT: "The key trade-off is latency vs throughput. In production..."
 *   • Gemini: "I'd approach this differently — start with a prototype and..."
 *   [End context — now answer the user's question below]
 *
 * BUG FIX v6-fixed: (e.response || '').length instead of e.response.length
 * to avoid TypeError when the response field is missing or null.
 *
 * @param {string} task       — the original user prompt
 * @param {Object} opts
 * @param {string} opts.exclude         — skip this provider's entries
 * @param {boolean} opts.thisSessionOnly — default true
 * @returns {string}  the task, optionally prepended with context
 */
function buildPrefix(task, { exclude = null, thisSessionOnly = true } = {}) {
  const entries = readRecent({ thisSessionOnly, exclude, limit: MAX_ENTRIES_IN_PREFIX });
  if (!entries.length) return task;

  const lines = entries
    .reverse() // chronological order in the prefix
    .map(e => {
      const responseText = e.response || '';  // BUG FIX: was e.response (could be null)
      const snippet  = responseText.slice(0, RESPONSE_TRUNCATE_CHARS).replace(/\n+/g, ' ');
      const ellipsis = responseText.length > RESPONSE_TRUNCATE_CHARS ? '…' : '';  // BUG FIX
      return `• ${_label(e.provider)}: "${snippet}${ellipsis}"`;
    });

  const header = `[Context from other AIs in this session — use this to avoid repeating what others have said and to build on their insights]\n${lines.join('\n')}\n[End context]\n\n`;

  return header + task;
}

/**
 * Build a short summary string of all session exchanges.
 * Useful for session-store logging or UI display.
 *
 * @returns {string}
 */
function getSessionSummary() {
  const entries = readRecent({ thisSessionOnly: true, limit: 20 });
  if (!entries.length) return '(no shared memory for this session)';

  const counts = {};
  for (const e of entries) {
    counts[e.provider] = (counts[e.provider] || 0) + 1;
  }

  const parts = Object.entries(counts)
    .map(([p, n]) => `${_label(p)} ×${n}`)
    .join(', ');

  return `Session memory: ${entries.length} exchange(s) — ${parts}`;
}

/**
 * Clear all entries from this session.
 * Does NOT delete previous sessions (append-only file preserved).
 */
function clearSession() {
  if (!fs.existsSync(MEM_FILE)) return;
  try {
    const lines = fs.readFileSync(MEM_FILE, 'utf8').split('\n').filter(Boolean);
    const kept  = lines.filter(line => {
      try { return JSON.parse(line).sessionId !== SESSION_ID; } catch { return true; }
    });
    fs.writeFileSync(MEM_FILE, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
  } catch (err) {
    console.warn('[SharedMemory] clearSession error:', err.message);
  }
}

/**
 * DOM-based capture helper.
 * Alternative to addEntry() — reads directly from the live DOM.
 *
 * @param {Electron.WebContents} wc
 * @param {string} providerId
 * @param {string} prompt
 * @param {string[]} selectors   — CSS selectors to try (last match wins)
 * @returns {Promise<string>}
 */
async function captureFromDOM(wc, providerId, prompt, selectors = []) {
  const defaultSelectors = {
    chatgpt    : '[data-message-author-role="assistant"] .markdown',
    claude     : '.font-claude-message',
    gemini     : 'model-response .response-content',
    grok       : '[data-testid="conversation-turn-assistant"]',
    perplexity : '.prose',
    copilot    : '.ac-textBlock',
  };

  const sel = selectors.length
    ? selectors
    : [defaultSelectors[providerId] || '[data-message-author-role="assistant"]'];

  let captured = '';
  for (const s of sel) {
    try {
      const text = await wc.executeJavaScript(`
        (function() {
          const els = document.querySelectorAll(${JSON.stringify(s)});
          if (!els.length) return '';
          const last = els[els.length - 1];
          return (last.innerText || last.textContent || '').trim();
        })()
      `);
      if (text && text.length > captured.length) captured = text;
    } catch { /* ignore */ }
  }

  if (captured) {
    addEntry(providerId, prompt, captured, { source: 'dom-capture' });
  }
  return captured;
}

// ── Internal helpers ──────────────────────────────────────────────────────

const LABELS = {
  chatgpt    : 'ChatGPT',
  claude     : 'Claude',
  gemini     : 'Gemini',
  grok       : 'Grok',
  perplexity : 'Perplexity',
  copilot    : 'Copilot',
};

function _label(id) {
  return LABELS[id] || id;
}

// ── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  SESSION_ID,
  addEntry,
  readRecent,
  buildPrefix,
  getSessionSummary,
  clearSession,
  captureFromDOM,
  DATA_DIR,
  MEM_FILE,
};
