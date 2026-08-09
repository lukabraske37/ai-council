/**
 * engine.js — AI Council v6 — OrchestrationEngine
 *
 * Phase 5 full-integration additions:
 *   - DEBUG flag + dbg() throughout every method
 *   - _executeProvider() emits provider-status events with real timing
 *   - _modeBroadcast() properly waits for ALL parallel tasks
 *   - Cancellation checked after every async boundary
 *   - Error recovery: failed provider → error result, not throw
 *   - runBootSelfTest() robust with timeout per provider
 *   - _autoPickMode() logs decision reason
 *   - All modes (broadcast/tournament/specialized/recursive/debate) debugged
 *
 * Phase 6 integrations:
 *   - SharedMemory: every successful response is saved and fed as context
 *     to other providers in the same broadcast (buildPrefix per provider)
 *   - FlashcardGenerator: auto-generate or on-demand via makeFlashcards()
 */
const providerRegistry   = require('../providers/provider-registry');
const rankingEngine      = require('./ranking-engine');
const ResponseCollector  = require('./response-collector');
const ParallelExecutor   = require('./parallel-executor');
const sessionStore       = require('../memory/session-store');
// [CHANGE 1] Shared memory + flashcard dependencies
const sharedMemory       = require('../memory/shared-memory');
const FlashcardGenerator = require('../learning/flashcard-generator');

const DEBUG = true;
function dbg(...args) { if (DEBUG) console.log('[ENGINE]', ...args); }

const STATE = {
  IDLE       : 'idle',
  ROUTING    : 'routing',
  EXECUTING  : 'executing',
  COLLECTING : 'collecting',
  RANKING    : 'ranking',
  REFINING   : 'refining',
  DONE       : 'done',
  CANCELLED  : 'cancelled',
  ERROR      : 'error',
};

class OrchestrationEngine {
  constructor(getView, onProgress) {
    this._getView    = getView;
    this._onProgress = onProgress || (() => {});
    this._state      = STATE.IDLE;
    this._cancelled  = false;
    this._collector  = new ResponseCollector();
    this._executor   = new ParallelExecutor({
      concurrency  : 3,
      staggerMs    : 700,
      retries      : 1,
      retryDelayMs : 3000,
      timeoutMs    : 130000,
    });
    // [CHANGE 2] FlashcardGenerator instance — same getView used by providers
    this._flashcards = new FlashcardGenerator(this._getView);
    dbg('Engine created');
  }

  // ── Slot-agnostic view lookup ──────────────────────────────────────────
  // FIX: Engine previously only checked slot 0. Users with Nalog 2/3/4
  // (slot 1/2/3) were invisible to the engine → "No provider panels" error.
  // This helper scans all slots (0–9) and returns { view, slot } for the
  // first open panel found for a given provider.
  _findView(providerId) {
    for (let s = 0; s <= 9; s++) {
      const view = this._getView(providerId, s);
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        return { view, slot: s };
      }
    }
    return null;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async run(opts) {
    const {
      task,
      providers : requestedProviders = [],
      mode      = 'broadcast',
      taskType  = 'default',
      slot      = 0,
      options   = {},
    } = opts;

    dbg(`run() — mode=${mode}, taskType=${taskType}, providers=[${requestedProviders.join(',')}]`);
    dbg('task preview:', (task || '').slice(0, 80));

    this._cancelled = false;
    this._collector.clear();
    this._runStart    = Date.now();
    // [CHANGE 5] Store taskType so _executeProvider can tag memory entries
    this._lastTaskType = taskType;
    this._setState(STATE.ROUTING);

    try {
      // ── Resolve provider list ────────────────────────────────────────
      let providerIds = requestedProviders.length > 0
        ? requestedProviders
        : providerRegistry.routeByCapability(taskType);

      dbg('Initial provider list:', providerIds);

      // Filter out providers with no open view.
      // FIX: use _findView() so any slot (Nalog 1–10) is detected, not just slot 0.
      const available = providerIds.filter(id => {
        const found = this._findView(id);
        if (!found) dbg(`Provider ${id} has no open view (checked all slots) — skipping`);
        return !!found;
      });

      dbg('Available (has open view):', available);

      if (available.length === 0) {
        this._emit('provider-status', {
          id     : 'system',
          status : 'error',
          message: `❌ No provider panels are open. Open at least one AI panel (ChatGPT, Claude, etc.) before running Agent mode.`,
        });
        this._setState(STATE.ERROR);
        return { results: [], ranked: [], state: STATE.ERROR };
      }

      providerIds = available;

      this._emit('routing', {
        message    : `Routing to: ${providerIds.join(', ')} (${providerIds.length} providers)`,
        providerIds,
      });

      // ── Auto mode ────────────────────────────────────────────────────
      let resolvedMode = mode;
      if (mode === 'auto') {
        const picked = this._autoPickMode(task, taskType, providerIds);
        resolvedMode = picked.mode;
        dbg('Auto-pick:', picked);
        this._emit('routing', {
          message : `🤖 Auto-pick: mode="${picked.mode}", providers=[${picked.providers.join(', ')}] — ${picked.reasoning}`,
          auto    : true,
          picked,
        });
        if (!requestedProviders.length && picked.providers.length) {
          const autoPicked = picked.providers.filter(id => providerIds.includes(id));
          if (autoPicked.length) providerIds.splice(0, providerIds.length, ...autoPicked);
        }
      }

      // ── Execute mode ─────────────────────────────────────────────────
      dbg(`Executing mode=${resolvedMode} with providers=[${providerIds.join(',')}]`);
      let results;

      switch (resolvedMode) {
        case 'tournament'  : results = await this._modeTournament(task, providerIds, slot, taskType, options); break;
        case 'specialized' : results = await this._modeSpecialized(task, taskType, slot, options); break;
        case 'recursive'   : results = await this._modeRecursive(task, providerIds, slot, taskType, options); break;
        case 'debate'      : results = await this._modeDebate(task, providerIds, slot, taskType, options); break;
        default            : results = await this._modeBroadcast(task, providerIds, slot); break;
      }

      if (this._cancelled) {
        dbg('Cancelled after execution');
        this._setState(STATE.CANCELLED);
        return { results: [], ranked: [], state: STATE.CANCELLED };
      }

      // ── Rank ─────────────────────────────────────────────────────────
      this._setState(STATE.RANKING);
      this._emit('ranking', { message: 'Ranking responses...' });
      const ranked = rankingEngine.rank(results, taskType);
      dbg('Ranked:', ranked.map(r => `${r.provider}:${r.score}`).join(', '));

      // [CHANGE 6] Auto-generate flashcards if requested via options
      if (options.generateFlashcards && ranked.length) {
        const winner = ranked.find(r => r.success && r.text);
        if (winner) {
          // Non-blocking — don't hold up the response
          this._flashcards.generateFromText(
            winner.provider,
            slot,
            winner.text,
            {
              count : options.flashcardCount || 5,
              deck  : options.flashcardDeck  || task.slice(0, 40),
            }
          ).then(cards => {
            if (cards.length) {
              this._emit('flashcards-ready', {
                count    : cards.length,
                deck     : options.flashcardDeck || task.slice(0, 40),
                provider : winner.provider,
                cards,
                message  : `🃏 Generated ${cards.length} flashcards from ${winner.provider}'s response`,
              });
            }
          }).catch(err => dbg('flashcard generation error:', err.message));
        }
      }

      // ── Session memory ────────────────────────────────────────────────
      sessionStore.add({
        task,
        mode       : resolvedMode,
        taskType,
        providers  : providerIds,
        ranked,
        durationMs : Date.now() - (this._runStart || Date.now()),
      });

      this._setState(STATE.DONE);
      const successCount = ranked.filter(r => r.success).length;
      this._emit('done', {
        message     : `✅ Done — ${successCount}/${ranked.length} succeeded in ${((Date.now() - this._runStart) / 1000).toFixed(1)}s`,
        resultCount : ranked.length,
        successCount,
        sharedMemory: sharedMemory.getSessionSummary(),
      });

      return { results, ranked, state: STATE.DONE };

    } catch (err) {
      dbg('run() error:', err.message, err.stack);
      this._setState(STATE.ERROR);
      this._emit('error', { message: `Engine error: ${err.message}` });
      throw err;
    }
  }

  cancel() {
    dbg('cancel() called');
    this._cancelled = true;
    this._setState(STATE.CANCELLED);
    this._emit('cancelled', { message: '🛑 Orchestration cancelled by user' });
  }

  get state() { return this._state; }

  // ── Modes ──────────────────────────────────────────────────────────────

  async _modeBroadcast(task, providerIds, slot) {
    this._setState(STATE.EXECUTING);
    dbg(`_modeBroadcast: ${providerIds.length} providers`);

    this._emit('executing', {
      message     : `⚡ Broadcasting to ${providerIds.length} provider(s) in parallel…`,
      providerIds,
    });

    // [CHANGE 4] Each provider gets the task prefixed with context from OTHER
    // providers that have already responded in this session. exclude: id so
    // each AI doesn't see its own previous answers in the context header.
    const tasks = providerIds.map(id => ({
      id,
      fn : () => {
        const taskWithContext = sharedMemory.buildPrefix(task, { exclude: id });
        return this._executeProvider(id, slot, taskWithContext);
      },
    }));

    const execResults = await this._executor.run(
      tasks,
      (evt) => {
        if (evt.status === 'started') {
          this._emit('provider-status', { id: evt.id, status: 'running', message: `📡 Connecting to ${evt.id}…` });
        } else if (evt.status === 'retrying') {
          this._emit('provider-status', { id: evt.id, status: 'retrying', message: `🔄 Retrying ${evt.id} (attempt ${evt.attempt + 1})…` });
        } else if (evt.status === 'failed') {
          this._emit('provider-status', { id: evt.id, status: 'error', message: `✗ ${evt.id}: ${evt.error}` });
        }
      },
      () => this._cancelled
    );

    this._setState(STATE.COLLECTING);
    this._emit('collecting', { message: `📥 Collecting ${execResults.length} responses…` });

    return execResults.map(er => er.result || {
      provider : er.id,
      label    : er.id,
      text     : '',
      success  : false,
      error    : er.error || 'Executor task failed',
      timeMs   : 0,
    });
  }

  async _modeTournament(task, providerIds, slot, taskType, options) {
    dbg('_modeTournament start');
    const round1  = await this._modeBroadcast(task, providerIds, slot);
    const ranked1 = rankingEngine.rank(round1, taskType);
    const top2    = ranked1.slice(0, 2).filter(r => r.success && r.text);

    if (top2.length < 2 || this._cancelled) {
      dbg('Tournament: not enough successful results for round 2');
      return round1;
    }

    this._setState(STATE.REFINING);
    this._emit('refining', {
      message   : `🏆 Tournament round 2: refining top ${top2.length}…`,
      providers : top2.map(r => r.provider),
    });

    const refineTasks = top2.map((result, i) => {
      const other  = top2[1 - i];
      const prompt = `Original task: "${task}"\n\nAnother AI responded:\n${other.text}\n\nNow improve upon or synthesize the best elements into your answer:`;
      return { id: `${result.provider}-refined`, fn: () => this._executeProvider(result.provider, slot, prompt) };
    });

    const refineExec = await this._executor.run(refineTasks, null, () => this._cancelled);
    const round2 = refineExec.map(er => er.result
      ? { ...er.result, label: (er.result.label || er.id) + ' (refined)', refined: true }
      : { provider: er.id, label: er.id + ' (refined)', text: '', success: false, error: er.error, timeMs: 0 }
    );

    return [
      ...round2,
      ...round1.filter(r => !top2.find(t => t.provider === r.provider)),
    ];
  }

  async _modeSpecialized(task, taskType, slot, options) {
    this._setState(STATE.EXECUTING);
    const subtasks = this._decomposeTask(task, taskType);
    dbg('_modeSpecialized:', subtasks.map(s => s.providerId).join(', '));

    this._emit('executing', {
      message  : `🎯 Running ${subtasks.length} specialized subtasks…`,
      subtasks : subtasks.map(s => ({ type: s.type, provider: s.providerId })),
    });

    const tasks = subtasks.map(s => ({
      id : `${s.providerId}-${s.type}`,
      fn : () => this._executeProvider(s.providerId, slot, s.prompt),
    }));

    const execResults = await this._executor.run(tasks, null, () => this._cancelled);
    return execResults.map((er, i) => ({
      ...(er.result || { provider: subtasks[i].providerId, label: subtasks[i].providerId, text: '', success: false, error: er.error, timeMs: 0 }),
      subtask: subtasks[i].type,
    }));
  }

  async _modeRecursive(task, providerIds, slot, taskType, options) {
    const maxIterations = options.maxIterations || 3;
    const qualityTarget = options.qualityTarget || 75;
    dbg(`_modeRecursive: maxIter=${maxIterations}, qualityTarget=${qualityTarget}`);

    let currentPrompt = task;
    let bestResults   = [];
    let bestScore     = -1;

    for (let iter = 0; iter < maxIterations; iter++) {
      if (this._cancelled) break;

      this._emit('executing', { message: `🔄 Recursive iteration ${iter + 1}/${maxIterations}…` });
      const results  = await this._modeBroadcast(currentPrompt, providerIds, slot);
      const ranked   = rankingEngine.rank(results, taskType);
      const best     = ranked.find(r => r.success && r.text);
      const iterScore = best?.score ?? 0;

      dbg(`Recursive iter ${iter + 1}: best score=${iterScore}`);

      if (iterScore > bestScore || bestResults.length === 0) {
        bestScore   = iterScore;
        bestResults = results;
        dbg(`Recursive: new best at iter ${iter + 1} with score=${iterScore}`);
      }

      if (!best || iterScore >= qualityTarget || this._cancelled) {
        dbg(`Recursive stopping: score=${iterScore}, target=${qualityTarget}`);
        break;
      }

      this._setState(STATE.REFINING);
      this._emit('refining', {
        message : `🔁 Quality ${iterScore}/${qualityTarget} — refining (iteration ${iter + 2})…`,
        score   : iterScore,
        target  : qualityTarget,
      });
      currentPrompt = `Original task: "${task}"\n\nPrevious best response (score ${iterScore}/100):\n${best.text}\n\nRefine and significantly improve this response:`;
    }

    return bestResults;
  }

  async _modeDebate(task, providerIds, slot, taskType, options) {
    dbg('_modeDebate:', providerIds.slice(0, 2).join(' vs '));
    if (providerIds.length < 2) return this._modeBroadcast(task, providerIds, slot);

    const [idA, idB] = providerIds;
    this._setState(STATE.EXECUTING);
    this._emit('executing', { message: `⚔️ Debate: ${idA} responds, ${idB} critiques…` });

    const responseA = await this._executeProvider(idA, slot, task);
    if (!responseA.success || this._cancelled) return [responseA];

    const critiquePrompt = `Task: "${task}"\n\nResponse to critique:\n${responseA.text}\n\nProvide critical analysis and an improved answer:`;
    const critiqueB = await this._executeProvider(idB, slot, critiquePrompt);

    if (critiqueB.success && !this._cancelled) {
      this._setState(STATE.REFINING);
      this._emit('refining', { message: `⚔️ ${idA} synthesizing final answer…` });
      const synPrompt   = `Task: "${task}"\n\nYour initial response:\n${responseA.text}\n\nCritique from another AI:\n${critiqueB.text}\n\nSynthesize a final, improved answer incorporating the critique:`;
      const synthesized = await this._executeProvider(idA, slot, synPrompt);
      return [
        { ...synthesized, label: (synthesized.label || idA) + ' (synthesized)', round: 'final' },
        { ...critiqueB,   label: (critiqueB.label   || idB) + ' (critique)',    round: 'critique' },
        { ...responseA,   label: (responseA.label   || idA) + ' (initial)',     round: 'initial' },
      ];
    }

    return [responseA, critiqueB];
  }

  // ── Provider Execution ──────────────────────────────────────────────────

  async _executeProvider(providerId, slot, task) {
    const driver = providerRegistry.get(providerId);
    if (!driver) {
      dbg(`_executeProvider: no driver for ${providerId}`);
      return { provider: providerId, label: providerId, text: '', success: false, error: 'Provider not registered', timeMs: 0 };
    }

    // FIX: use _findView() so any open slot (Nalog 1–10) is accepted.
    const found = this._findView(providerId);
    const view  = found ? found.view : null;
    const resolvedSlot = found ? found.slot : slot;
    if (!view || !view.webContents) {
      dbg(`_executeProvider: no BrowserView for ${providerId}:${slot}`);
      this._emit('provider-status', {
        id      : providerId,
        status  : 'error',
        message : `❌ ${driver.label}: panel not open. Open the ${driver.label} tab first.`,
      });
      return {
        provider : providerId,
        label    : driver.label,
        text     : '',
        success  : false,
        error    : `${driver.label} panel not open. Open it in a panel first.`,
        timeMs   : 0,
      };
    }

    dbg(`_executeProvider: ${providerId} — starting`);
    const startMs = Date.now();

    this._emit('provider-status', {
      id      : providerId,
      status  : 'running',
      message : `📡 Sending to ${driver.label}…`,
    });

    const onPartial = (text) => {
      this._emit('partial-response', {
        id      : providerId,
        label   : driver.label,
        text,
        partial : true,
      });
    };

    try {
      const result  = await driver.run(view.webContents, task, onPartial);
      const elapsed = Date.now() - startMs;
      dbg(`_executeProvider: ${providerId} done in ${elapsed}ms — success=${result.success} len=${result.text?.length}`);

      // [CHANGE 3] Save successful responses to shared memory so other
      // providers can receive them as context via buildPrefix()
      if (result.success && result.text) {
        sharedMemory.addEntry(providerId, task, result.text, {
          taskType : this._lastTaskType || 'default',
          timeMs   : elapsed,
        });
        dbg(`SharedMemory: saved ${result.text.length} chars from ${providerId}`);
      }

      this._emit('provider-status', {
        id      : providerId,
        status  : result.success ? 'done' : 'error',
        message : result.success
          ? `✓ ${driver.label}: ${result.text.length} chars in ${(elapsed / 1000).toFixed(1)}s`
          : `✗ ${driver.label}: ${result.error}`,
      });

      return result;
    } catch (err) {
      const elapsed = Date.now() - startMs;
      dbg(`_executeProvider: ${providerId} threw after ${elapsed}ms:`, err.message);
      this._emit('provider-status', {
        id      : providerId,
        status  : 'error',
        message : `✗ ${driver.label}: ${err.message}`,
      });
      return {
        provider : providerId,
        label    : driver.label,
        text     : '',
        success  : false,
        error    : err.message,
        timeMs   : elapsed,
      };
    }
  }

  // ── Auto mode ──────────────────────────────────────────────────────────

  _autoPickMode(task, taskType, availableProviders) {
    const t = (task || '').toLowerCase();

    const isDebate      = /compar|vs\b|versus|pros.+cons|for.+against|debate|argue/.test(t);
    const isTournament  = /best|\btop\b|optimal|which.+(is|are)|rank|choose/.test(t);
    const isRecursive   = /refine|improve|iterate|perfect|keep.+trying|get.+better/.test(t);
    const isSpecialized = /step.+by.+step|breakdown|analyze.+and|multiple.+aspect/.test(t);

    let mode      = 'broadcast';
    let reasoning = 'Default broadcast — no strong signal for another mode.';

    if (isDebate)           { mode = 'debate';      reasoning = 'Detected comparison/debate keywords → debate mode.'; }
    else if (isTournament)  { mode = 'tournament';  reasoning = 'Detected "best/rank/choose" → tournament mode.'; }
    else if (isRecursive)   { mode = 'recursive';   reasoning = 'Detected refinement intent → recursive loop.'; }
    else if (isSpecialized) { mode = 'specialized'; reasoning = 'Detected multi-aspect request → specialized routing.'; }

    dbg(`_autoPickMode: mode=${mode} — ${reasoning}`);

    const routeMap = {
      code     : ['chatgpt', 'claude', 'gemini'],
      creative : ['claude', 'chatgpt', 'gemini'],
      factual  : ['perplexity', 'gemini', 'grok'],
      analysis : ['claude', 'chatgpt', 'gemini'],
      search   : ['perplexity', 'grok', 'copilot'],
      default  : ['chatgpt', 'claude', 'gemini', 'grok'],
    };

    const preferred = routeMap[taskType] || routeMap.default;
    const providers = preferred
      .filter(id => availableProviders.includes(id))
      .slice(0, mode === 'debate' ? 2 : 4);

    if (!providers.length) providers.push(...availableProviders.slice(0, 3));

    return { mode, providers, reasoning };
  }

  // ── Boot self-test ─────────────────────────────────────────────────────

  async runBootSelfTest(openProviderIds, slot = 0) {
    dbg('runBootSelfTest:', openProviderIds.join(', '));

    const SELFTEST_TIMEOUT_MS = 8000;
    const withTimeout = (promise, ms, label) => Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label}: selfTest timed out after ${ms}ms`)), ms)
      ),
    ]);

    for (const id of openProviderIds) {
      const driver = providerRegistry.get(id);
      // FIX: find whichever slot is actually open for this provider
      const found  = this._findView(id);
      const view   = found ? found.view : null;
      if (!driver || !view?.webContents) {
        dbg(`runBootSelfTest: skipping ${id} (no driver or view)`);
        continue;
      }

      try {
        const { ok, missing } = await withTimeout(
          driver.selfTest(view.webContents),
          SELFTEST_TIMEOUT_MS,
          id
        );
        const total  = Object.values(driver.SELECTORS || {}).flat().length;
        const found  = total - missing.length;
        const pct    = total ? Math.round((found / total) * 100) : 100;

        dbg(`selfTest ${id}: ok=${ok}, coverage=${pct}%`);
        this._emit('provider-selftest', {
          id,
          ok,
          coverage : pct,
          missing  : missing.slice(0, 3),
          message  : ok
            ? `✓ ${driver.label}: selectors OK (${pct}%)`
            : `⚠ ${driver.label}: ${missing.length} selector(s) missing (${pct}% coverage)`,
        });
      } catch (err) {
        dbg(`selfTest ${id} error:`, err.message);
        this._emit('provider-selftest', {
          id,
          ok      : false,
          coverage: 0,
          message : `✗ ${driver.label}: selfTest error — ${err.message}`,
        });
      }
    }
    dbg('runBootSelfTest complete');
  }

  // ── Task decomposition ──────────────────────────────────────────────────

  _decomposeTask(task, taskType) {
    const routes = providerRegistry.routeByCapability(taskType);
    return [
      { type: 'primary',     providerId: routes[0] || 'chatgpt', prompt: task },
      { type: 'alternative', providerId: routes[1] || 'claude',  prompt: task },
    ];
  }

  // ── [CHANGE 7] Public flashcard + shared memory API ───────────────────
  // Callable from renderer via IPC:
  //   engine.makeFlashcards('claude', 0, 'Explain TCP/IP', { count: 8 })
  //   engine.getFlashcards({ deck: 'Networking' })
  //   engine.getFlashcardDecks()
  //   engine.getSharedMemorySummary()
  //   engine.clearSharedMemory()

  async makeFlashcards(providerId, slot, sourcePromptOrText, opts = {}) {
    dbg(`makeFlashcards: ${providerId}, slot=${slot}`);
    // Heuristic: if the string is short it's probably a prompt, read DOM instead
    const isPrompt = sourcePromptOrText.length < 300;
    if (isPrompt) {
      return this._flashcards.generateFromDOM(providerId, slot, sourcePromptOrText, opts);
    }
    return this._flashcards.generateFromText(providerId, slot, sourcePromptOrText, opts);
  }

  async makeFlashcardsFromAll(targets, originalPrompt = '', opts = {}) {
    dbg('makeFlashcardsFromAll:', targets.map(t => t.providerId).join(', '));
    return this._flashcards.generateFromAll(targets, originalPrompt, opts);
  }

  getFlashcards(opts = {}) {
    return this._flashcards.getSaved(opts);
  }

  getFlashcardDecks() {
    return this._flashcards.getDecks();
  }

  getSharedMemorySummary() {
    return sharedMemory.getSessionSummary();
  }

  clearSharedMemory() {
    sharedMemory.clearSession();
    dbg('Shared memory cleared for this session');
  }

  // ── Internals ─────────────────────────────────────────────────────────

  _setState(state) {
    dbg(`state: ${this._state} → ${state}`);
    this._state = state;
  }

  _emit(type, data) {
    this._onProgress({ type, ...data, timestamp: Date.now() });
  }
}

module.exports = OrchestrationEngine;