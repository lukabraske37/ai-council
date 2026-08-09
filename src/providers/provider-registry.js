/**
 * provider-registry.js — Registry of all AI provider drivers.
 *
 * Manages provider instances and routes tasks to the right providers
 * based on task type (code, creative, factual, analysis, search).
 */

'use strict';

const ChatGPTProvider    = require('./chatgpt-provider');
const ClaudeProvider     = require('./claude-provider');
const GeminiProvider     = require('./gemini-provider');
const GrokProvider       = require('./grok-provider');
const PerplexityProvider = require('./perplexity-provider');
const CopilotProvider    = require('./copilot-provider');

// ── Provider instances ────────────────────────────────────────────────────

const PROVIDERS = {
  chatgpt    : new ChatGPTProvider(),
  claude     : new ClaudeProvider(),
  gemini     : new GeminiProvider(),
  grok       : new GrokProvider(),
  perplexity : new PerplexityProvider(),
  copilot    : new CopilotProvider(),
};

// ── Capability routing ────────────────────────────────────────────────────

const ROUTES = {
  code     : ['chatgpt', 'claude', 'gemini'],
  creative : ['claude', 'chatgpt', 'gemini'],
  factual  : ['perplexity', 'gemini', 'grok'],
  analysis : ['claude', 'chatgpt', 'gemini'],
  search   : ['perplexity', 'grok', 'copilot'],
  default  : ['chatgpt', 'claude', 'gemini', 'grok', 'perplexity', 'copilot'],
};

// ── Public API ────────────────────────────────────────────────────────────

function get(id)              { return PROVIDERS[id] || null; }
function getAll()             { return { ...PROVIDERS }; }
function getIds()             { return Object.keys(PROVIDERS); }
function register(id, p)      { PROVIDERS[id] = p; }
function unregister(id)       { delete PROVIDERS[id]; }

function routeByCapability(taskType) {
  const route = ROUTES[taskType] || ROUTES.default;
  return route.filter(id => !!PROVIDERS[id]);
}

module.exports = { get, getAll, getIds, routeByCapability, register, unregister };
