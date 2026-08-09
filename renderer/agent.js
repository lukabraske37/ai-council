/**
 * agent.js — AI Council v6 — Agent Panel
 *
 * Phase 6 additions:
 *   - Prompt chaining: "⬆ Use as Input" on every result card
 *   - _chainDepth counter + chain-depth badge in run header
 *   - Settings panel (⚙️ button): per-provider selector editor
 *   - configTestSelector: live querySelector test in open BrowserView
 *   - configSetSelectors: save user overrides to userData/provider-config.json
 *   - configResetProvider: one-click reset to defaults
 *   - Boot self-test results shown automatically in progress log
 *   - History panel shows chain depth badge
 *   - All Phase 5 features preserved (templates, diff, export, preflight)
 */

const _agentDebug = true;
function _dbg(...a) { if (_agentDebug) console.log('[AGENT]', ...a); }

// ─── STATE ───────────────────────────────────────────────────────────────────
let _agentOpen         = false;
let _settingsOpen      = false;
let _running           = false;
let _selectedProviders = [];
let _healthStatus      = {};
let _streamingCards    = {};
let _historyOpen       = false;
let _lastRanked        = [];
let _lastOpts          = {};
let _openProviderIds   = [];   // Which provider panels are currently open
let _chainDepth        = 0;    // Phase 6: prompt chaining depth

// ─── TASK TEMPLATES ──────────────────────────────────────────────────────────
const TEMPLATES = [
  { id: '',           label: '— Select template —',  task: '',                                                                                                                                              mode: null,         taskType: null },
  { id: 'code-review',label: '🔍 Code Review',        task: 'Review the following code for bugs, security issues, and improvement opportunities:\n\n[PASTE CODE HERE]',                                       mode: 'tournament', taskType: 'code' },
  { id: 'blog-post',  label: '✍️ Blog Post',           task: 'Write a compelling 500-word blog post about: [TOPIC]\n\nTone: professional but conversational. Include an engaging intro, 3 main points, and a call-to-action conclusion.', mode: 'broadcast',  taskType: 'creative' },
  { id: 'swot',       label: '📊 SWOT Analysis',      task: 'Perform a detailed SWOT analysis (Strengths, Weaknesses, Opportunities, Threats) for: [COMPANY / PRODUCT / IDEA]',                             mode: 'specialized',taskType: 'analysis' },
  { id: 'debate',     label: '⚔️ Debate Topic',       task: 'Debate the following proposition — provide strong arguments for BOTH sides:\n\n[PROPOSITION]',                                                  mode: 'debate',     taskType: 'analysis' },
  { id: 'research',   label: '🔬 Research Brief',     task: 'Research and summarize the current state of: [TOPIC]\n\nInclude: key facts, recent developments, main viewpoints, and open questions.',          mode: 'broadcast',  taskType: 'factual' },
];

// ─── INIT ────────────────────────────────────────────────────────────────────
function initAgent(ais) {
  _dbg('initAgent — registering IPC listeners');

  const btn = document.getElementById('btn-agent');
  if (btn) btn.onclick = toggleAgentPanel;

  // Register all IPC listeners
  window.api.onOrchestrationProgress(handleProgress);
  window.api.onOrchestrationResult(handleResult);
  window.api.onPartialResponse(handlePartialResponse);
  window.api.onHealthStatus(handleHealthStatus);
  if (window.api.onProviderSelfTest) window.api.onProviderSelfTest(handleSelfTest);
  if (window.api.onViewsLoaded)      window.api.onViewsLoaded(handleViewsLoaded);

  renderAgentPanel(ais);

  // Initial health status fetch
  setTimeout(async () => {
    try {
      const statuses = await window.api.healthGetAll();
      _dbg('Initial health statuses:', statuses?.length);
      (statuses || []).forEach(s => { _healthStatus[s.id] = s; });
      refreshHealthChips();
    } catch(e) { _dbg('healthGetAll error:', e.message); }
  }, 2000);

  // Initial open-views fetch
  setTimeout(async () => {
    try {
      _openProviderIds = await window.api.listOpenViews() || [];
      _dbg('Open views on init:', _openProviderIds);
      refreshPreflightHints();
    } catch(e) { _dbg('listOpenViews error:', e.message); }
  }, 1500);
}

function handleViewsLoaded(data) {
  _dbg('handleViewsLoaded:', data.openIds);
  _openProviderIds = data.openIds || [];
  refreshPreflightHints();
}

function toggleAgentPanel() {
  _agentOpen = !_agentOpen;
  const panel = document.getElementById('agent-panel');
  const btn   = document.getElementById('btn-agent');
  if (!panel) return;
  panel.classList.toggle('hidden', !_agentOpen);
  if (btn) btn.classList.toggle('active', _agentOpen);
  _dbg('Panel toggled:', _agentOpen ? 'open' : 'closed');
  // Tell main process to resize BrowserViews so they don't cover this panel
  if (window.api?.agentPanelState) window.api.agentPanelState(_agentOpen);
}

// ─── PANEL RENDER ────────────────────────────────────────────────────────────
function renderAgentPanel(ais) {
  const panel = document.getElementById('agent-panel');
  if (!panel) return;

  panel.innerHTML = `
    <div class="agent-header">
      <span class="agent-title">🤖 Agent Mode</span>
      <div class="agent-header-btns">
        <button class="agent-history-btn" id="agent-history-btn" title="Task history">🕒</button>
        <button class="agent-settings-btn" id="agent-settings-btn" title="Provider selector settings">⚙️</button>
        <button class="agent-close" id="agent-close-btn">✕</button>
      </div>
    </div>

    <!-- Pre-flight warning banner -->
    <div id="agent-preflight" class="preflight-banner hidden"></div>

    <!-- Chain depth indicator (Phase 6) -->
    <div id="chain-depth-bar" class="chain-depth-bar hidden">
      <span class="chain-icon">⛓</span>
      <span id="chain-depth-label">Chain depth: 0</span>
      <button id="chain-reset-btn" class="chain-reset-btn" title="Start fresh (reset chain)">✕ Reset chain</button>
    </div>

    <div class="agent-config">
      <!-- Templates -->
      <div class="agent-row">
        <label>Template</label>
        <select id="agent-template">
          ${TEMPLATES.map(t => `<option value="${t.id}">${escHtml(t.label)}</option>`).join('')}
        </select>
      </div>

      <div class="agent-row">
        <label>Task type</label>
        <select id="agent-tasktype">
          <option value="default">Auto-detect</option>
          <option value="code">Code</option>
          <option value="creative">Creative</option>
          <option value="factual">Factual / Research</option>
          <option value="analysis">Analysis</option>
          <option value="search">Search</option>
        </select>
      </div>

      <div class="agent-row">
        <label>Mode</label>
        <select id="agent-mode">
          <option value="auto">🤖 Auto (AI picks)</option>
          <option value="broadcast">⚡ Broadcast (parallel)</option>
          <option value="tournament">🏆 Tournament (refine top 2)</option>
          <option value="specialized">🎯 Specialized (auto-route)</option>
          <option value="recursive">🔄 Recursive (refine loop)</option>
          <option value="debate">⚔️ Debate (A critiques B)</option>
        </select>
      </div>

      <div class="agent-row">
        <label>Providers</label>
        <div id="agent-providers" class="provider-chips">
          ${(ais || []).map(ai => `
            <button class="chip" data-id="${ai.id}" title="${ai.label}">
              <span class="health-dot" id="health-dot-${ai.id}" title="Checking...">⚫</span>
              <span class="chip-label">${ai.label}</span>
              <span class="open-indicator" id="open-ind-${ai.id}" title="Panel open">●</span>
            </button>
          `).join('')}
        </div>
        <small id="provider-hint">None selected = auto-route based on open panels</small>
      </div>
    </div>

    <div class="agent-input-row">
      <textarea id="agent-task" placeholder="Describe your task… (Shift+Enter for newline, Enter to run)" rows="3"></textarea>
      <div class="agent-btns">
        <button id="agent-run-btn" class="agent-run">⚡ Orchestrate</button>
        <button id="agent-cancel-btn" class="agent-cancel hidden">🛑 Cancel</button>
      </div>
    </div>

    <!-- Live status row during execution -->
    <div id="agent-status-row" class="agent-status-row hidden">
      <div id="agent-provider-status-chips" class="provider-status-chips"></div>
    </div>

    <div id="agent-progress" class="agent-progress hidden">
      <div class="progress-header">
        <span id="progress-title">Progress</span>
        <button id="progress-clear-btn" class="progress-clear">Clear</button>
      </div>
      <div class="progress-log" id="progress-log"></div>
    </div>

    <div id="agent-results" class="agent-results hidden"></div>
  `;

  // ── Provider chip selection ───────────────────────────────────────────
  panel.querySelectorAll('.chip').forEach(chip => {
    chip.onclick = () => {
      chip.classList.toggle('selected');
      const id = chip.dataset.id;
      if (chip.classList.contains('selected')) {
        if (!_selectedProviders.includes(id)) _selectedProviders.push(id);
      } else {
        _selectedProviders = _selectedProviders.filter(p => p !== id);
      }
      _dbg('Selected providers:', _selectedProviders);
      refreshPreflightHints();
    };
  });

  // ── Buttons ──────────────────────────────────────────────────────────
  document.getElementById('agent-close-btn').onclick    = toggleAgentPanel;
  document.getElementById('agent-run-btn').onclick      = runOrchestration;
  document.getElementById('agent-cancel-btn').onclick   = cancelOrchestration;
  document.getElementById('agent-history-btn').onclick  = toggleHistoryPanel;
  document.getElementById('agent-settings-btn').onclick = toggleSettingsPanel;
  document.getElementById('progress-clear-btn').onclick = clearProgress;
  document.getElementById('chain-reset-btn').onclick    = resetChain;

  // ── Template picker ──────────────────────────────────────────────────
  document.getElementById('agent-template').onchange = function () {
    const tpl = TEMPLATES.find(t => t.id === this.value);
    if (!tpl || !tpl.id) return;
    document.getElementById('agent-task').value = tpl.task;
    if (tpl.mode)     { const el = document.getElementById('agent-mode');     if (el) el.value = tpl.mode; }
    if (tpl.taskType) { const el = document.getElementById('agent-tasktype'); if (el) el.value = tpl.taskType; }
    this.value = '';
    refreshPreflightHints();
  };

  // ── Keyboard shortcut ─────────────────────────────────────────────────
  document.getElementById('agent-task').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!_running) runOrchestration();
    }
  });

  refreshPreflightHints();
}

// ─── PRE-FLIGHT CHECK ────────────────────────────────────────────────────────
function refreshPreflightHints() {
  const banner  = document.getElementById('agent-preflight');
  if (!banner) return;
  const targets = _selectedProviders.length > 0 ? _selectedProviders : [];

  if (_openProviderIds.length === 0) {
    banner.classList.remove('hidden');
    banner.className = 'preflight-banner preflight-warn';
    banner.innerHTML = `
      <span class="preflight-icon">⚠️</span>
      <span>No AI panels are open. Open at least one panel (e.g. ChatGPT, Claude) to use Agent mode.</span>
    `;
    return;
  }

  if (targets.length > 0) {
    const missing = targets.filter(id => !_openProviderIds.includes(id));
    if (missing.length > 0) {
      banner.classList.remove('hidden');
      banner.className = 'preflight-banner preflight-warn';
      banner.innerHTML = `
        <span class="preflight-icon">⚠️</span>
        <span>${missing.join(', ')} panel(s) not open.</span>
        <button class="preflight-open-btn" id="preflight-open-btn">Open panels</button>
      `;
      document.getElementById('preflight-open-btn')?.addEventListener('click', async () => {
        for (const id of missing) {
          try { await window.api.openProviderView(id); } catch(e) { _dbg('openProviderView error:', e); }
        }
      });
      return;
    }
  }

  banner.classList.add('hidden');
  banner.innerHTML = '';

  // Update open-indicator dots
  document.querySelectorAll('.chip').forEach(chip => {
    const id  = chip.dataset.id;
    const ind = document.getElementById(`open-ind-${id}`);
    if (ind) {
      const isOpen = _openProviderIds.includes(id);
      ind.classList.toggle('open-ind-on', isOpen);
      ind.classList.toggle('open-ind-off', !isOpen);
      ind.title = isOpen ? 'Panel open ✓' : 'Panel not open';
    }
  });
}

// ─── ORCHESTRATION ───────────────────────────────────────────────────────────
async function runOrchestration() {
  const task     = document.getElementById('agent-task')?.value?.trim();
  const mode     = document.getElementById('agent-mode')?.value || 'broadcast';
  const taskType = document.getElementById('agent-tasktype')?.value || 'default';

  if (!task) { document.getElementById('agent-task')?.focus(); return; }

  if (_openProviderIds.length === 0) {
    logProgress({ type: 'error', message: '❌ No AI panels open.' });
    document.getElementById('agent-preflight')?.classList.remove('hidden');
    return;
  }

  _dbg('runOrchestration:', { task: task.slice(0,60), mode, taskType, chain: _chainDepth });

  _running        = true;
  _lastRanked     = [];
  _lastOpts       = { task, mode, taskType };
  _streamingCards = {};

  setRunningState(true);
  clearProgress();
  clearResults();
  clearProviderStatusChips();

  const chainMsg = _chainDepth > 0 ? ` (chain depth: ${_chainDepth})` : '';
  logProgress({ type: 'start', message: `🚀 Starting ${mode} orchestration…${chainMsg}` });

  const willUse = _selectedProviders.length > 0 ? _selectedProviders : _openProviderIds;
  logProgress({ type: 'routing', message: `Will attempt: ${willUse.join(', ')}` });

  try {
    await window.api.orchestrate({
      task,
      providers  : [..._selectedProviders],
      mode,
      taskType,
      slot       : 0,
      chainDepth : _chainDepth,
    });
  } catch(err) {
    _dbg('orchestrate() threw:', err);
    logProgress({ type: 'error', message: `❌ IPC error: ${err.message}` });
    _running = false;
    setRunningState(false);
  }
}

async function cancelOrchestration() {
  _dbg('cancelOrchestration');
  try { await window.api.orchestrateCancel(); } catch(e) { _dbg('cancel error:', e); }
  _running = false;
  setRunningState(false);
  logProgress({ type: 'cancelled', message: '🛑 Cancelled by user.' });
}

// ─── IPC CALLBACKS ───────────────────────────────────────────────────────────
function handleProgress(evt) {
  _dbg('progress:', evt.type, evt.message?.slice(0,80));
  logProgress(evt);

  if (evt.type === 'provider-status' && evt.id) {
    updateProviderStatusChip(evt.id, evt.status, evt.message);
  }

  if (evt.auto && evt.picked) {
    const container = document.getElementById('agent-results');
    if (container) {
      container.classList.remove('hidden');
      if (!document.getElementById('auto-reasoning')) {
        const banner = document.createElement('div');
        banner.id = 'auto-reasoning';
        banner.className = 'auto-reasoning-banner';
        banner.innerHTML = `
          <div class="auto-reasoning-title">🤖 Auto-pick reasoning</div>
          <div>${escHtml(evt.picked.reasoning)}</div>
          <div class="auto-reasoning-detail">→ Mode: <strong>${escHtml(evt.picked.mode)}</strong> · Providers: <strong>${escHtml(evt.picked.providers.join(', '))}</strong></div>
        `;
        container.insertBefore(banner, container.firstChild);
      }
    }
  }
}

function handlePartialResponse(evt) {
  const { id, label, text } = evt;
  _dbg('partial:', id, text?.length, 'chars');

  const container = document.getElementById('agent-results');
  if (container) container.classList.remove('hidden');

  let card = _streamingCards[id];

  if (!card) {
    if (container && !document.getElementById('results-list')) {
      const existing = document.getElementById('auto-reasoning');
      const html = `
        <div class="results-header"><span class="results-title">⟳ Live responses…</span></div>
        <div class="results-list" id="results-list"></div>
      `;
      if (existing) existing.insertAdjacentHTML('afterend', html);
      else container.innerHTML = html;
    }

    card = document.createElement('div');
    card.className = 'result-card streaming';
    card.dataset.providerId = id;
    card.innerHTML = `
      <div class="result-meta">
        <span class="result-label">${escHtml(label || id)}</span>
        <span class="stream-indicator">⟳ streaming…</span>
        <span class="stream-len" id="stream-len-${escHtml(id)}">0 chars</span>
      </div>
      <div class="result-text streaming-text" id="stream-text-${escHtml(id)}"></div>
    `;

    const list = document.getElementById('results-list');
    if (list) list.appendChild(card);
    _streamingCards[id] = card;
  }

  const textEl = document.getElementById(`stream-text-${id}`);
  const lenEl  = document.getElementById(`stream-len-${id}`);
  if (textEl) {
    const preview = text.length > 1000 ? text.slice(0, 1000) + '…' : text;
    textEl.textContent = preview;
    textEl.scrollTop = textEl.scrollHeight;
  }
  if (lenEl) lenEl.textContent = `${text.length} chars`;
}

function handleResult(res) {
  _dbg('handleResult: state=', res.state, 'ranked=', res.ranked?.length, 'error=', res.error);
  _running = false;
  _streamingCards = {};
  setRunningState(false);
  hideProviderStatusChips();

  if (res.state === 'cancelled') {
    logProgress({ type: 'cancelled', message: '🛑 Orchestration cancelled.' });
    return;
  }

  if (res.error) {
    logProgress({ type: 'error', message: `❌ Error: ${res.error}` });
    return;
  }

  _lastRanked = res.ranked || res.results || [];

  if (res.durationMs) {
    logProgress({ type: 'done', message: `✅ Complete in ${(res.durationMs / 1000).toFixed(1)}s — rendering results…` });
  }

  renderResults(_lastRanked);
}

function handleSelfTest(evt) {
  _dbg('selftest:', evt.id, evt.ok, evt.coverage + '%');
  logProgress({ ...evt, type: 'provider-selftest' });
}

// ─── PROVIDER STATUS CHIPS ───────────────────────────────────────────────────
function updateProviderStatusChip(id, status, message) {
  const row = document.getElementById('agent-status-row');
  if (row) row.classList.remove('hidden');

  const container = document.getElementById('agent-provider-status-chips');
  if (!container) return;

  let chip = document.getElementById(`psc-${id}`);
  if (!chip) {
    chip = document.createElement('div');
    chip.id = `psc-${id}`;
    chip.className = 'provider-status-chip';
    container.appendChild(chip);
  }

  const icons = { running: '⟳', done: '✓', error: '✗', retrying: '↻', 'no-view': '⊘' };
  chip.className = `provider-status-chip psc-${status}`;
  chip.innerHTML = `<span class="psc-icon">${icons[status] || '•'}</span><span class="psc-id">${escHtml(id)}</span>`;
  chip.title = message || '';
}

function clearProviderStatusChips() {
  const container = document.getElementById('agent-provider-status-chips');
  if (container) container.innerHTML = '';
  document.getElementById('agent-status-row')?.classList.add('hidden');
}

function hideProviderStatusChips() {
  setTimeout(() => document.getElementById('agent-status-row')?.classList.add('hidden'), 3000);
}

// ─── PROGRESS LOG ────────────────────────────────────────────────────────────
function logProgress(evt) {
  const log = document.getElementById('progress-log');
  if (!log) return;
  document.getElementById('agent-progress')?.classList.remove('hidden');

  const icons = {
    start              : '🚀',
    routing            : '🗺️',
    executing          : '⚡',
    collecting         : '📥',
    ranking            : '🏆',
    refining           : '🔄',
    done               : '✅',
    error              : '❌',
    cancelled          : '🛑',
    'provider-status'  : '📡',
    'provider-selftest': '🔬',
  };

  const icon          = icons[evt.type] || '•';
  const providerBadge = evt.id ? `<span class="badge">${escHtml(evt.id)}</span> ` : '';
  const statusClass   = evt.status === 'error' ? 'log-error' : (evt.status === 'done' || evt.type === 'done') ? 'log-ok' : '';
  const coverageHtml  = evt.coverage != null
    ? `<span class="coverage-badge ${evt.ok ? 'ok' : 'warn'}">${evt.coverage}%</span>`
    : '';
  const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const entry = document.createElement('div');
  entry.className = `log-entry ${statusClass}`;
  entry.innerHTML = `
    <span class="log-ts">${ts}</span>
    <span class="log-icon">${icon}</span>
    ${providerBadge}${coverageHtml}
    <span class="log-msg">${escHtml(evt.message || '')}</span>
  `;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function clearProgress() {
  const log = document.getElementById('progress-log');
  if (log) log.innerHTML = '';
  document.getElementById('agent-progress')?.classList.add('hidden');
}

// ─── RESULTS RENDER ──────────────────────────────────────────────────────────
function renderResults(ranked) {
  const container = document.getElementById('agent-results');
  if (!container) return;

  const reasoningEl   = document.getElementById('auto-reasoning');
  const reasoningHtml = reasoningEl ? reasoningEl.outerHTML : '';

  container.classList.remove('hidden');

  if (!ranked.length) {
    container.innerHTML = reasoningHtml + `
      <div class="no-results">
        <div class="no-results-icon">😶</div>
        <div>No responses collected.</div>
        <div class="no-results-hint">Make sure your AI panels are open and logged in.</div>
      </div>
    `;
    return;
  }

  const successCount = ranked.filter(r => r.success && r.text).length;

  container.innerHTML = reasoningHtml + `
    <div class="results-header">
      <span class="results-title">
        Results — ${successCount}/${ranked.length} succeeded
        ${_chainDepth > 0 ? `<span class="chain-depth-badge">⛓ Chain ${_chainDepth}</span>` : ''}
      </span>
      <div class="results-actions">
        <button class="copy-best-btn" id="copy-best" title="Copy best response">📋 Copy Best</button>
        ${successCount >= 2 ? '<button class="diff-btn" id="diff-btn" title="Compare top 2">⇄ Diff</button>' : ''}
        <div class="export-dropdown" id="export-dropdown-wrap">
          <button class="export-btn" id="export-menu-btn">⬇ Export</button>
          <div class="export-menu hidden" id="export-menu">
            <button data-fmt="md">📄 Markdown</button>
            <button data-fmt="html">🌐 HTML</button>
            <button data-fmt="json">{ } JSON</button>
          </div>
        </div>
      </div>
    </div>
    <div class="results-list" id="results-list"></div>
    <div id="diff-panel" class="diff-panel hidden"></div>
  `;

  const list = document.getElementById('results-list');

  ranked.forEach((result, i) => {
    const card = document.createElement('div');
    card.className = `result-card ${i === 0 ? 'best' : ''} ${result.success ? '' : 'failed'}`;

    const scoreBar      = result.score != null
      ? `<div class="score-bar-wrap"><div class="score-bar" style="width:${result.score}%"></div></div>`
      : '';
    const breakdownHtml = result.breakdown
      ? Object.entries(result.breakdown).map(([k, v]) =>
          `<span class="bd-item" title="${k}">${k[0].toUpperCase()}: ${v}</span>`
        ).join('')
      : '';
    const timeStr    = result.timeMs  ? `${(result.timeMs / 1000).toFixed(1)}s` : '';
    const errorStr   = result.error   ? `<div class="result-error">⚠️ ${escHtml(result.error)}</div>` : '';
    const textHtml   = result.text
      ? `<div class="result-text">${escHtml(result.text.slice(0, 1000))}${result.text.length > 1000 ? '…' : ''}</div>`
      : '';
    const subtaskBadge = result.subtask
      ? `<span class="subtask-badge">${escHtml(result.subtask)}</span>` : '';
    const roundBadge   = result.round
      ? `<span class="round-badge round-${result.round}">${escHtml(result.round)}</span>` : '';

    // Phase 6: chain button — only on successful results with text
    const chainBtn = result.success && result.text
      ? `<button class="chain-btn" data-idx="${i}" title="Use this response as input for another run">⬆ Use as Input</button>`
      : '';

    card.innerHTML = `
      <div class="result-meta">
        <span class="result-rank">#${result.rank || i + 1}</span>
        <span class="result-label">${escHtml(result.label || result.provider)}</span>
        ${result.score != null ? `<span class="result-score">${result.score}/100</span>` : ''}
        ${timeStr ? `<span class="result-time">${timeStr}</span>` : ''}
        ${subtaskBadge}${roundBadge}
      </div>
      ${scoreBar}
      ${breakdownHtml ? `<div class="breakdown">${breakdownHtml}</div>` : ''}
      ${errorStr}
      ${textHtml}
      <div class="result-card-actions">
        ${result.success && result.text ? `<button class="copy-btn" data-idx="${i}">📋 Copy</button>` : ''}
        ${chainBtn}
      </div>
    `;
    list.appendChild(card);
  });

  // ── Wire up buttons ──────────────────────────────────────────────────
  document.getElementById('copy-best')?.addEventListener('click', () => {
    const best = ranked.find(r => r.success && r.text);
    if (best) { copyToClipboard(best.text); showToast('✅ Best response copied!'); }
  });

  list.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      if (ranked[idx]?.text) { copyToClipboard(ranked[idx].text); showToast('✅ Copied!'); }
    });
  });

  // Phase 6: chain buttons
  list.querySelectorAll('.chain-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx    = parseInt(btn.dataset.idx);
      const result = ranked[idx];
      if (result?.text) chainFromResult(result);
    });
  });

  document.getElementById('diff-btn')?.addEventListener('click', () => toggleDiffPanel(ranked));

  document.getElementById('export-menu-btn')?.addEventListener('click', () => {
    document.getElementById('export-menu')?.classList.toggle('hidden');
  });

  document.getElementById('export-menu')?.querySelectorAll('[data-fmt]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('export-menu')?.classList.add('hidden');
      doExport(btn.dataset.fmt, ranked);
    });
  });

  document.addEventListener('click', function closeMenu(e) {
    const wrap = document.getElementById('export-dropdown-wrap');
    if (wrap && !wrap.contains(e.target)) {
      document.getElementById('export-menu')?.classList.add('hidden');
      document.removeEventListener('click', closeMenu);
    }
  });
}

function clearResults() {
  const c = document.getElementById('agent-results');
  if (c) { c.innerHTML = ''; c.classList.add('hidden'); }
}

// ─── PHASE 6: PROMPT CHAINING ─────────────────────────────────────────────────
function chainFromResult(result) {
  _dbg('chainFromResult:', result.provider, 'text len:', result.text?.length);

  _chainDepth += 1;

  // Populate task textarea with result text
  const taskEl = document.getElementById('agent-task');
  if (taskEl) {
    taskEl.value = result.text;
    taskEl.focus();
    taskEl.scrollTop = 0;
  }

  // Auto-switch to recursive mode for chaining
  const modeEl = document.getElementById('agent-mode');
  if (modeEl && modeEl.value === 'broadcast') modeEl.value = 'recursive';

  // Show chain depth bar
  updateChainDepthBar();

  showToast(`⛓ Chained! Depth: ${_chainDepth} — edit the text and run again`);
  _dbg('Chain depth now:', _chainDepth);
}

function resetChain() {
  _dbg('resetChain');
  _chainDepth = 0;
  updateChainDepthBar();
  const taskEl = document.getElementById('agent-task');
  if (taskEl) { taskEl.value = ''; taskEl.focus(); }
  showToast('✅ Chain reset — fresh start');
}

function updateChainDepthBar() {
  const bar   = document.getElementById('chain-depth-bar');
  const label = document.getElementById('chain-depth-label');
  if (!bar || !label) return;
  if (_chainDepth > 0) {
    bar.classList.remove('hidden');
    label.textContent = `Chain depth: ${_chainDepth}`;
  } else {
    bar.classList.add('hidden');
  }
}

// ─── PHASE 6: SETTINGS PANEL (selector editor) ───────────────────────────────
function toggleSettingsPanel() {
  _settingsOpen = !_settingsOpen;
  const btn = document.getElementById('agent-settings-btn');
  if (btn) btn.classList.toggle('active', _settingsOpen);

  if (_settingsOpen) renderSettingsPanel();
  else               document.getElementById('agent-settings-panel')?.remove();
}

async function renderSettingsPanel() {
  document.getElementById('agent-settings-panel')?.remove();

  const panel = document.getElementById('agent-panel');
  if (!panel) return;

  // Loading state
  const container = document.createElement('div');
  container.id = 'agent-settings-panel';
  container.className = 'settings-panel';
  container.innerHTML = `
    <div class="settings-header">
      <span>⚙️ Provider Selector Config</span>
      <button class="agent-close" id="settings-close-btn">✕</button>
    </div>
    <div class="settings-body">
      <div class="settings-loading">Loading config…</div>
    </div>
  `;
  panel.insertBefore(container, panel.firstChild);
  document.getElementById('settings-close-btn').onclick = toggleSettingsPanel;

  // Load config
  let configs = [];
  try { configs = await window.api.configGetAll(); } catch(e) { _dbg('configGetAll error:', e); }

  const SELECTOR_LABELS = { input: 'Input / Editor', send: 'Send Button', response: 'Response Text', stream: 'Streaming Indicator' };
  const SELECTOR_KEYS   = ['input', 'send', 'response', 'stream'];

  const body = container.querySelector('.settings-body');
  body.innerHTML = `
    <p class="settings-help">
      Edit CSS selectors used to interact with each provider's web UI.<br>
      Click <strong>Test</strong> to verify a selector in the live panel. <strong>Save</strong> to persist.
      Requires open panel to test.
    </p>
    <div class="settings-providers" id="settings-providers"></div>
    <div class="settings-footer">
      <button class="settings-reset-all-btn" id="settings-reset-all">↩ Reset All to Defaults</button>
    </div>
  `;

  const providersEl = body.querySelector('#settings-providers');

  configs.forEach(cfg => {
    const provEl = document.createElement('div');
    provEl.className = `settings-provider ${cfg._hasOverride ? 'has-override' : ''}`;
    provEl.dataset.providerId = cfg.id;

    const rows = SELECTOR_KEYS.map(key => `
      <tr class="sel-row" data-key="${key}">
        <td class="sel-label">${SELECTOR_LABELS[key] || key}</td>
        <td class="sel-input-cell">
          <input
            type="text"
            class="sel-input"
            id="sel-${cfg.id}-${key}"
            value="${escHtml(cfg[key] || '')}"
            placeholder="CSS selector…"
          />
        </td>
        <td class="sel-actions">
          <button class="sel-test-btn" data-provider="${cfg.id}" data-key="${key}" title="Test selector in live panel">Test</button>
          <span class="sel-test-result" id="sel-result-${cfg.id}-${key}"></span>
        </td>
      </tr>
    `).join('');

    const isOpen = _openProviderIds.includes(cfg.id);
    provEl.innerHTML = `
      <div class="settings-provider-header">
        <span class="settings-provider-name">${escHtml(cfg.id)}</span>
        ${cfg._hasOverride ? '<span class="override-badge">modified</span>' : ''}
        <span class="settings-panel-status ${isOpen ? 'panel-open' : 'panel-closed'}">${isOpen ? '● panel open' : '○ panel closed'}</span>
        <button class="sel-save-btn" data-provider="${cfg.id}">💾 Save</button>
        ${cfg._hasOverride ? `<button class="sel-reset-btn" data-provider="${cfg.id}">↩ Reset</button>` : ''}
      </div>
      <table class="sel-table"><tbody>${rows}</tbody></table>
    `;
    providersEl.appendChild(provEl);
  });

  // ── Wire test buttons ────────────────────────────────────────────────
  body.querySelectorAll('.sel-test-btn').forEach(btn => {
    btn.onclick = async () => {
      const providerId = btn.dataset.provider;
      const key        = btn.dataset.key;
      const inputEl    = document.getElementById(`sel-${providerId}-${key}`);
      const resultEl   = document.getElementById(`sel-result-${providerId}-${key}`);
      const selector   = inputEl?.value?.trim();

      if (!selector) { if (resultEl) resultEl.textContent = '(empty)'; return; }
      if (resultEl)  { resultEl.textContent = '…'; resultEl.className = 'sel-test-result testing'; }
      btn.disabled = true;

      try {
        const res = await window.api.configTestSelector(providerId, selector);
        _dbg('test result:', res);
        if (resultEl) {
          if (res.error) {
            resultEl.textContent  = `⚠ ${res.error}`;
            resultEl.className    = 'sel-test-result fail';
          } else if (res.found) {
            resultEl.textContent  = `✓ ${res.count} match${res.count > 1 ? 'es' : ''} <${res.tag}> "${res.text.slice(0,30)}${res.text.length > 30 ? '…' : ''}"`;
            resultEl.className    = 'sel-test-result pass';
          } else {
            resultEl.textContent  = '✗ No match found';
            resultEl.className    = 'sel-test-result fail';
          }
        }
      } catch(e) {
        if (resultEl) { resultEl.textContent = `Error: ${e.message}`; resultEl.className = 'sel-test-result fail'; }
      } finally {
        btn.disabled = false;
      }
    };
  });

  // ── Wire save buttons ────────────────────────────────────────────────
  body.querySelectorAll('.sel-save-btn').forEach(btn => {
    btn.onclick = async () => {
      const providerId = btn.dataset.provider;
      const changes    = {};
      ['input', 'send', 'response', 'stream'].forEach(key => {
        const inputEl = document.getElementById(`sel-${providerId}-${key}`);
        if (inputEl) changes[key] = inputEl.value.trim() || null;
      });
      btn.disabled = true;
      try {
        await window.api.configSetSelectors(providerId, changes);
        showToast(`✅ Saved selectors for ${providerId}`);
        // Refresh the panel to show override badge
        renderSettingsPanel();
      } catch(e) {
        showToast(`❌ Save failed: ${e.message}`);
        btn.disabled = false;
      }
    };
  });

  // ── Wire reset buttons ───────────────────────────────────────────────
  body.querySelectorAll('.sel-reset-btn').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(`Reset all selectors for "${btn.dataset.provider}" to defaults?`)) return;
      btn.disabled = true;
      try {
        await window.api.configResetProvider(btn.dataset.provider);
        showToast(`↩ Reset ${btn.dataset.provider} to defaults`);
        renderSettingsPanel();
      } catch(e) {
        showToast(`❌ Reset failed: ${e.message}`);
        btn.disabled = false;
      }
    };
  });

  // ── Wire global reset ────────────────────────────────────────────────
  document.getElementById('settings-reset-all').onclick = async () => {
    if (!confirm('Reset ALL provider selectors to defaults?')) return;
    try {
      await window.api.configResetAll();
      showToast('↩ All selectors reset to defaults');
      renderSettingsPanel();
    } catch(e) {
      showToast(`❌ Reset failed: ${e.message}`);
    }
  };
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────
async function doExport(format, ranked) {
  if (!ranked?.length) return;
  _dbg('doExport:', format);
  try {
    const res = await window.api.exportResults({
      format,
      task      : _lastOpts.task || '',
      mode      : _lastOpts.mode || 'broadcast',
      taskType  : _lastOpts.taskType || 'default',
      ranked,
      durationMs: null,
    });
    if (res?.ok)             showToast(`✅ Exported: ${res.filePath.split(/[/\\]/).pop()}`);
    else if (!res?.canceled) showToast(`❌ Export failed: ${res?.error || 'unknown'}`);
  } catch(err) {
    showToast(`❌ Export error: ${err.message}`);
  }
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'export-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ─── DIFF VIEW ───────────────────────────────────────────────────────────────
function toggleDiffPanel(ranked) {
  const panel = document.getElementById('diff-panel');
  const btn   = document.getElementById('diff-btn');
  if (!panel) return;

  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    btn?.classList.remove('active');
    return;
  }

  const top2 = ranked.filter(r => r.success && r.text).slice(0, 2);
  if (top2.length < 2) return;

  panel.classList.remove('hidden');
  btn?.classList.add('active');

  const [a, b] = top2;
  panel.innerHTML = `
    <div class="diff-header">
      <span class="diff-label-a">#1 ${escHtml(a.label || a.provider)}</span>
      <span class="diff-vs">vs</span>
      <span class="diff-label-b">#2 ${escHtml(b.label || b.provider)}</span>
      <button id="diff-close" class="agent-close" style="margin-left:auto">✕</button>
    </div>
    <div class="diff-body">
      <div class="diff-col" id="diff-col-a"></div>
      <div class="diff-col" id="diff-col-b"></div>
    </div>
  `;

  document.getElementById('diff-close').onclick = () => toggleDiffPanel(ranked);
  const { aHtml, bHtml } = wordDiff(a.text, b.text);
  document.getElementById('diff-col-a').innerHTML = aHtml;
  document.getElementById('diff-col-b').innerHTML = bHtml;
}

function wordDiff(textA, textB) {
  const tokenize = t => t.split(/(\s+|[.,!?;:()\[\]{}])/);
  const tokA = tokenize(textA);
  const tokB = tokenize(textB);
  const setA = new Set(tokA);
  const setB = new Set(tokB);
  const render = (tokens, other) => tokens.map(tok => {
    if (/^\s+$/.test(tok)) return escHtml(tok);
    return other.has(tok)
      ? `<span class="diff-match">${escHtml(tok)}</span>`
      : `<span class="diff-unique">${escHtml(tok)}</span>`;
  }).join('');
  return { aHtml: render(tokA, setB), bHtml: render(tokB, setA) };
}

// ─── HEALTH MONITORING ───────────────────────────────────────────────────────
const HEALTH_ICONS = {
  'ready'        : '🟢',
  'busy'         : '🟡',
  'loading'      : '🟡',
  'not-logged-in': '🔴',
  'not-ready'    : '🔴',
  'offline'      : '⚫',
  'error'        : '🔴',
  'unknown'      : '⚫',
};

function handleHealthStatus(status) {
  _healthStatus[status.id] = status;
  const dot = document.getElementById(`health-dot-${status.id}`);
  if (!dot) return;
  dot.textContent = HEALTH_ICONS[status.status] || '⚫';
  dot.title       = `${status.id}: ${status.details?.reason || status.status}`;
  const chip = dot.closest('.chip');
  if (chip) {
    const unavail = ['offline', 'not-logged-in', 'not-ready', 'error'].includes(status.status);
    chip.classList.toggle('chip-unavailable', unavail);
  }
}

function refreshHealthChips() {
  Object.values(_healthStatus).forEach(handleHealthStatus);
}

// ─── RUNNING STATE ───────────────────────────────────────────────────────────
function setRunningState(running) {
  const runBtn    = document.getElementById('agent-run-btn');
  const cancelBtn = document.getElementById('agent-cancel-btn');
  if (runBtn)    runBtn.classList.toggle('hidden', running);
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !running);
  if (runBtn)    runBtn.textContent = running ? '⟳ Running…' : '⚡ Orchestrate';
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── HISTORY PANEL ───────────────────────────────────────────────────────────
async function toggleHistoryPanel() {
  _historyOpen = !_historyOpen;
  document.getElementById('agent-history-btn')?.classList.toggle('active', _historyOpen);
  if (_historyOpen) await renderHistoryPanel();
  else              document.getElementById('agent-history-panel')?.remove();
}

async function renderHistoryPanel() {
  document.getElementById('agent-history-panel')?.remove();
  const panel = document.getElementById('agent-panel');
  if (!panel) return;

  let summaries = [];
  try { summaries = await window.api.memoryGetHistory(20); } catch { summaries = []; }

  const container = document.createElement('div');
  container.id = 'agent-history-panel';
  container.className = 'history-panel';

  if (!summaries.length) {
    container.innerHTML = `
      <div class="history-header">
        <span>🕒 Task History</span>
        <button id="history-close-btn" class="agent-close">✕</button>
      </div>
      <div class="history-empty">No tasks in this session yet.</div>
    `;
  } else {
    const rows = summaries.map(s => {
      const time       = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dur        = s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : '';
      const score      = s.topScore != null ? `${s.topScore}/100` : '';
      const chainBadge = s.chainDepth > 0 ? `<span class="chain-depth-badge">⛓${s.chainDepth}</span>` : '';
      return `
        <div class="history-row" data-id="${escHtml(s.id)}">
          <div class="history-meta">
            <span class="history-time">${time}</span>
            <span class="history-mode">${escHtml(s.mode)}</span>
            ${dur   ? `<span class="history-dur">${dur}</span>`       : ''}
            ${score ? `<span class="history-score">${score}</span>`   : ''}
            <span class="history-count">${s.successCount}/${s.totalCount} ✓</span>
            ${chainBadge}
          </div>
          <div class="history-task">${escHtml(s.task)}</div>
          ${s.topLabel ? `<div class="history-best">Best: ${escHtml(s.topLabel)}</div>` : ''}
          <div class="history-actions">
            <button class="history-replay-btn" data-id="${escHtml(s.id)}">↩ Replay</button>
            <button class="history-delete-btn" data-id="${escHtml(s.id)}">🗑</button>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="history-header">
        <span>🕒 History (${summaries.length})</span>
        <button class="history-clear-all" id="history-clear-btn">Clear all</button>
        <button id="history-close-btn" class="agent-close">✕</button>
      </div>
      <div class="history-list">${rows}</div>
    `;
  }

  panel.insertBefore(container, panel.firstChild);

  document.getElementById('history-close-btn')?.addEventListener('click', toggleHistoryPanel);
  document.getElementById('history-clear-btn')?.addEventListener('click', async () => {
    await window.api.memoryClear();
    await renderHistoryPanel();
  });

  container.querySelectorAll('.history-replay-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const entry = await window.api.memoryGetEntry(btn.dataset.id);
      if (!entry) return;
      const taskInput = document.getElementById('agent-task');
      if (taskInput) taskInput.value = entry.task;
      const modeEl = document.getElementById('agent-mode');
      if (modeEl && entry.mode) modeEl.value = entry.mode;
      const typeEl = document.getElementById('agent-tasktype');
      if (typeEl && entry.taskType) typeEl.value = entry.taskType;
      // Restore chain depth if any
      if (entry.chainDepth > 0) {
        _chainDepth = entry.chainDepth;
        updateChainDepthBar();
      }
      toggleHistoryPanel();
    });
  });

  container.querySelectorAll('.history-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.api.memoryRemove(btn.dataset.id);
      btn.closest('.history-row')?.remove();
    });
  });
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────
window._initAgent = initAgent;

// ─── REFINE WORKFLOW (Clipboard + Instruction) ────────────────────────────────
// Dodata funkcija za "uzmi tekst + daj instrukciju" flow.
// Korisnik može da:
//   1. Klikne "📋 Refine" dugme da pejstuje tekst iz clipboarda
//   2. Upiše instrukciju (npr. "make it better")
//   3. Pokrene orchestration sa kombinovanim promptom

function _insertRefineUI() {
  // Prevent duplicate
  if (document.getElementById('refine-row')) return;

  const agentInput = document.querySelector('.agent-input-row');
  if (!agentInput) return;

  const refineRow = document.createElement('div');
  refineRow.id = 'refine-row';
  refineRow.className = 'refine-row';
  refineRow.innerHTML = `
    <div class="refine-header">
      <span class="refine-title">✂️ Refine Mode</span>
      <button class="refine-toggle" id="refine-toggle-btn" title="Paste clipboard + give instruction">📋 Paste & Instruct</button>
    </div>
    <div class="refine-body hidden" id="refine-body">
      <div class="refine-context-wrap">
        <label class="refine-label">Context (text to refine):</label>
        <textarea id="refine-context" class="refine-context" rows="4" placeholder="Paste text here, or use 📋 Paste from Clipboard below…"></textarea>
        <div class="refine-context-btns">
          <button class="refine-paste-btn" id="refine-paste-btn">📋 Paste from Clipboard</button>
          <button class="refine-clear-btn" id="refine-clear-btn">✕ Clear</button>
          <span class="refine-char-count" id="refine-char-count">0 chars</span>
        </div>
      </div>
      <div class="refine-instruction-wrap">
        <label class="refine-label">Instruction:</label>
        <div class="refine-quickbtns" id="refine-quickbtns">
          <button class="refine-quick" data-instr="Make this text better. Improve clarity, flow, and quality while preserving the meaning:">✨ Make Better</button>
          <button class="refine-quick" data-instr="Summarize the following text concisely:">📝 Summarize</button>
          <button class="refine-quick" data-instr="Fix grammar, spelling, and punctuation in the following text:">🔤 Fix Grammar</button>
          <button class="refine-quick" data-instr="Translate the following text to English:">🌐 Translate EN</button>
          <button class="refine-quick" data-instr="Make the following text more formal and professional:">👔 Make Formal</button>
          <button class="refine-quick" data-instr="Expand and elaborate on the following text with more detail:">📖 Expand</button>
        </div>
        <input type="text" id="refine-instruction" class="refine-instruction-input"
          placeholder="Or write your own instruction… (e.g. 'make it shorter')" />
      </div>
      <button class="refine-run-btn" id="refine-run-btn">⚡ Run Refinement</button>
    </div>
  `;

  // Insert before agent-input-row
  agentInput.parentNode.insertBefore(refineRow, agentInput);

  // Toggle body visibility
  document.getElementById('refine-toggle-btn').addEventListener('click', () => {
    const body = document.getElementById('refine-body');
    const btn  = document.getElementById('refine-toggle-btn');
    const hidden = body.classList.toggle('hidden');
    btn.classList.toggle('active', !hidden);
  });

  // Paste from clipboard
  document.getElementById('refine-paste-btn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const ctx  = document.getElementById('refine-context');
      if (ctx) {
        ctx.value = text;
        document.getElementById('refine-char-count').textContent = `${text.length} chars`;
      }
    } catch(e) {
      showToast('⚠️ Could not read clipboard. Try Ctrl+V directly.');
    }
  });

  // Clear context
  document.getElementById('refine-clear-btn').addEventListener('click', () => {
    const ctx = document.getElementById('refine-context');
    if (ctx) { ctx.value = ''; document.getElementById('refine-char-count').textContent = '0 chars'; }
  });

  // Character count update
  document.getElementById('refine-context').addEventListener('input', function() {
    document.getElementById('refine-char-count').textContent = `${this.value.length} chars`;
  });

  // Quick instruction buttons
  document.getElementById('refine-quickbtns').querySelectorAll('.refine-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('refine-instruction').value = btn.dataset.instr;
      // Highlight active
      document.querySelectorAll('.refine-quick').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Run refinement
  document.getElementById('refine-run-btn').addEventListener('click', () => {
    const context     = (document.getElementById('refine-context')?.value || '').trim();
    const instruction = (document.getElementById('refine-instruction')?.value || '').trim();

    if (!context)     { showToast('⚠️ Paste some text to refine first'); return; }
    if (!instruction) { showToast('⚠️ Choose or write an instruction'); return; }

    // Build combined prompt
    const combinedTask = `${instruction}\n\n---\n\n${context}`;

    // Inject into main task area and run
    const taskEl = document.getElementById('agent-task');
    if (taskEl) taskEl.value = combinedTask;

    // Auto-select broadcast mode for refinement
    const modeEl = document.getElementById('agent-mode');
    if (modeEl) modeEl.value = 'broadcast';

    // Close refine panel
    document.getElementById('refine-body')?.classList.add('hidden');
    document.getElementById('refine-toggle-btn')?.classList.remove('active');

    showToast('🚀 Running refinement…');
    runOrchestration();
  });
}

// ─── INJECT REFINE CSS ────────────────────────────────────────────────────────
function _injectRefineCSS() {
  if (document.getElementById('refine-styles')) return;
  const style = document.createElement('style');
  style.id = 'refine-styles';
  style.textContent = `
    .refine-row { margin: 6px 0; border-radius: 8px; background: var(--bg2, #1e1e2e); border: 1px solid var(--border, #333); overflow: hidden; }
    .refine-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; }
    .refine-title { font-size: 12px; color: var(--text2, #888); }
    .refine-toggle { font-size: 11px; padding: 3px 8px; border-radius: 5px; background: var(--accent, #7c3aed22); border: 1px solid var(--accent-border, #7c3aed55); color: var(--accent-text, #a78bfa); cursor: pointer; }
    .refine-toggle:hover, .refine-toggle.active { background: var(--accent, #7c3aed44); }
    .refine-body { padding: 8px 10px 10px; border-top: 1px solid var(--border, #333); }
    .refine-body.hidden { display: none; }
    .refine-label { display: block; font-size: 11px; color: var(--text2, #888); margin-bottom: 4px; }
    .refine-context { width: 100%; box-sizing: border-box; background: var(--bg, #13131f); border: 1px solid var(--border, #333); border-radius: 6px; color: var(--text, #e0e0e0); font-size: 12px; padding: 6px 8px; resize: vertical; }
    .refine-context-btns { display: flex; gap: 6px; align-items: center; margin-top: 5px; margin-bottom: 10px; }
    .refine-paste-btn, .refine-clear-btn { font-size: 11px; padding: 3px 8px; border-radius: 5px; cursor: pointer; border: 1px solid var(--border, #333); background: var(--bg2, #1e1e2e); color: var(--text, #e0e0e0); }
    .refine-paste-btn:hover { background: var(--bg3, #2a2a3e); }
    .refine-char-count { font-size: 10px; color: var(--text3, #666); margin-left: auto; }
    .refine-quickbtns { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
    .refine-quick { font-size: 11px; padding: 3px 7px; border-radius: 4px; cursor: pointer; border: 1px solid var(--border, #333); background: var(--bg, #13131f); color: var(--text2, #aaa); }
    .refine-quick:hover, .refine-quick.active { background: var(--accent, #7c3aed22); color: var(--accent-text, #a78bfa); border-color: var(--accent-border, #7c3aed55); }
    .refine-instruction-input { width: 100%; box-sizing: border-box; background: var(--bg, #13131f); border: 1px solid var(--border, #333); border-radius: 6px; color: var(--text, #e0e0e0); font-size: 12px; padding: 6px 8px; margin-bottom: 8px; }
    .refine-instruction-wrap { margin-bottom: 4px; }
    .refine-run-btn { width: 100%; padding: 7px; border-radius: 6px; background: #7c3aed; color: white; border: none; cursor: pointer; font-size: 13px; font-weight: 600; }
    .refine-run-btn:hover { background: #6d28d9; }
    .refine-context-wrap { margin-bottom: 8px; }
  `;
  document.head.appendChild(style);
}

// ─── PATCH initAgent TO ALSO INSERT REFINE UI ─────────────────────────────────
const _origInitAgent = window._initAgent;
window._initAgent = function(ais) {
  _origInitAgent(ais);
  _injectRefineCSS();
  // Insert refine UI after panel renders (small delay)
  setTimeout(_insertRefineUI, 300);
};
