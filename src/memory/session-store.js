/**
 * session-store.js — Persists orchestration sessions to history.jsonl
 *
 * Each entry records a completed orchestration run:
 *   { ts, task, mode, taskType, providers, ranked, durationMs }
 *
 * File: ~/.ai-council/history.jsonl
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DATA_DIR   = path.join(os.homedir(), '.ai-council');
const STORE_FILE = path.join(DATA_DIR, 'history.jsonl');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function init() {
  ensureDir();
  console.log('[SessionStore] initialized at', STORE_FILE);
}

function add(entry) {
  ensureDir();
  try {
    const record = {
      ts : Date.now(),
      ...entry,
      ranked: (entry.ranked || []).map(r => ({
        provider : r.provider,
        label    : r.label,
        score    : r.score,
        success  : r.success,
        timeMs   : r.timeMs,
      })),
    };
    fs.appendFileSync(STORE_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    console.warn('[SessionStore] add error:', err.message);
  }
}

function getLast(n = 20) {
  if (!fs.existsSync(STORE_FILE)) return [];
  try {
    const lines = fs.readFileSync(STORE_FILE, 'utf8').split('\n').filter(Boolean);
    return lines
      .slice(-n)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .reverse();
  } catch (err) {
    console.warn('[SessionStore] getLast error:', err.message);
    return [];
  }
}

function getSummary() {
  const all = getLast(500);
  if (!all.length) return '(no sessions stored)';
  const counts = {};
  for (const s of all) {
    counts[s.mode] = (counts[s.mode] || 0) + 1;
  }
  const parts = Object.entries(counts).map(([m, n]) => `${m}×${n}`).join(', ');
  return `${all.length} session(s): ${parts}`;
}

module.exports = {
  init,
  add,
  getLast,
  getSummary,
  STORE_FILE,
  DATA_DIR,
};