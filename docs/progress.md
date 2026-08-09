# AI Council v6 — Progress Log

## Phase 5 — Full Integration (2026-05-23)

### What changed

| File | Change |
|------|--------|
| `main.js` | `list-open-views` + `open-provider-view` IPC, `views-loaded` push event, debug logging |
| `src/ipc/orchestration-ipc.js` | Returns `{ engineRef }`, debug on all events, routes ALL event types |
| `preload.js` | `listOpenViews()`, `openProviderView()`, `onViewsLoaded()`, debug |
| `src/orchestration/engine.js` | Provider availability filter, clear error if no panels, full debug |
| `renderer/agent.js` | Pre-flight check, open-indicator dots, status chips, Phase4 preserved |
| `renderer/style.css` | Phase 5 additions: preflight, status chips, timestamps, no-results |

### Agent Mode full workflow (implemented)

```
User clicks ⚡ Orchestrate
  → Pre-flight: listOpenViews() query
  → Block if 0 panels open (clear warning + "Open panels" button)
  → window.api.orchestrate(opts) → IPC → orchestration-ipc.js
  → OrchestrationEngine.run()
     → Filters providers to those with open BrowserViews
     → Emits routing event → renderer progress log
     → ParallelExecutor (concurrency=3, stagger=700ms)
        → Each provider: injectPrompt → sendPrompt → waitForComplete
        → partial-response events → streaming cards (live text)
        → provider-status events → status chips (running/done/error)
     → ResponseCollector → deduplication
     → RankingEngine.rank() → scored results
  → orchestrate-result → renderResults()
     → Score bars, copy buttons, diff view, export menu
  → sessionStore.add() → history panel
```

### Debug logging

All files have `DEBUG=true` + `dbg()` calls. Console output:
- `[MAIN]` — Electron main process events
- `[ORCH-IPC]` — IPC handler events
- `[ENGINE]` — Orchestration state machine
- `[AGENT]` — Renderer agent UI events
- `[PRELOAD]` — Context bridge calls

### Known issues (for next session)

1. DOM selectors need testing with real Electron — may be stale after AI site updates
2. `runBootSelfTest()` not wired to `views-loaded` yet
3. Persistent history (userData/history.jsonl) not implemented
4. `openProviderView` relayout shifts existing panes slightly

---

## Phase 4 complete (2026-05-22)

- Export system (MD/JSON/HTML via save dialog)
- Auto mode with heuristic mode+provider selection
- Diff panel (word-level, top-2 side-by-side)
- Task templates (5 presets)
- Self-test coverage badges in progress log

## Phase 3 complete

- Session store (in-process, last 20 tasks)
- Memory IPC (get/remove/clear/size)
- Streaming cards (live partial response per provider)
- History panel (replay, delete)

## Phase 2 complete

- ParallelExecutor (concurrency=3, stagger=700ms, retry+backoff)
- HealthMonitor (8s polling, login wall detection)
- ResponseCollector (Jaccard deduplication)
- Health dots on provider chips

## Phase 1 complete

- OrchestrationEngine (5 modes: broadcast/tournament/specialized/recursive/debate)
- Provider abstraction (6 drivers: ChatGPT, Claude, Gemini, Grok, Perplexity, Copilot)
- IPC layer + preload bridge
- Agent UI panel
