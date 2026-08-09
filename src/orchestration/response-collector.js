/**
 * response-collector.js — Accumulates provider results during orchestration.
 *
 * Used by OrchestrationEngine to collect partial and final responses
 * across multiple providers. Simple in-memory store; cleared between runs.
 */

'use strict';

class ResponseCollector {
  constructor() {
    this._results  = [];
    this._partials = {};
  }

  /** Clear all stored results (call at the start of each run). */
  clear() {
    this._results  = [];
    this._partials = {};
  }

  /**
   * Add a completed result.
   * @param {{ provider, label, text, success, timeMs, error? }} result
   */
  add(result) {
    this._results.push(result);
  }

  /**
   * Update the latest partial text for a provider (streaming intermediate).
   * @param {string} providerId
   * @param {string} text
   */
  updatePartial(providerId, text) {
    this._partials[providerId] = text;
  }

  /** Get all completed results. */
  getAll() {
    return [...this._results];
  }

  /** Get the latest partial text for a provider (or '' if none). */
  getPartial(providerId) {
    return this._partials[providerId] || '';
  }

  /** Number of completed results collected. */
  get count() {
    return this._results.length;
  }
}

module.exports = ResponseCollector;
