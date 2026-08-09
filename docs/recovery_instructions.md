# AI Council v6 — Recovery Instructions

## Last safe checkpoint
`ai-council6-phase5-FINAL.zip` — Phase 5 Full Integration (2026-05-23)

## To resume work

1. Extract ZIP to working directory
2. Read `docs/current_state.json` — continuation_prompt at bottom
3. Read `docs/progress.md` — known issues section
4. Continue from `next_steps` in current_state.json

## Key architecture facts

### How Agent button works (end-to-end)

```
renderer/agent.js: runOrchestration()
  → window.api.orchestrate(opts)          [preload.js bridge]
  → ipcRenderer.invoke('orchestrate', opts)
  → main.js → orchestration-ipc.js: ipcMain.handle('orchestrate')
  → new OrchestrationEngine(getView, onProgress)
  → engine.run(opts)
     → providerRegistry.routeByCapability(taskType) if no providers specified
     → filters to providers with open BrowserViews via getView()
     → ParallelExecutor.run(tasks, onProgress, isCancelled)
        → driver.run(webContents, task, onPartial)
           → driver.injectPrompt(wc, text)
           → driver.sendPrompt(wc)
           → driver.waitForComplete(wc, onPartial)  [polls isStreaming() every 500ms]
           → driver.extractResponse(wc)
     → rankingEngine.rank(results, taskType)
     → sessionStore.add(...)
  → mainWindow.webContents.send('orchestrate-result', { ranked, state, durationMs })
  → renderer: handleResult(res) → renderResults(ranked)
```

### IPC flow for streaming

```
engine._executeProvider → onPartial(text)
  → engine._emit('partial-response', { id, label, text })
  → onProgress(evt) in orchestration-ipc.js
  → mainWindow.webContents.send('partial-response', evt)
  → preload.js: ipcRenderer.on('partial-response') → cb(evt)
  → agent.js: handlePartialResponse(evt) → updates streaming card
```

### File map

```
main.js                          Electron main — BrowserWindow, BrowserViews, IPC registration
preload.js                       Context bridge — window.api
renderer/index.html              Main window HTML
renderer/app.js                  Toolbar/preset UI
renderer/agent.js                Agent panel UI — ALL orchestration UI logic
renderer/style.css               All styles
src/orchestration/engine.js      OrchestrationEngine — state machine, 5 modes
src/orchestration/parallel-executor.js  Concurrency-controlled parallel runner
src/orchestration/ranking-engine.js     Scoring + ranking
src/orchestration/response-collector.js Streaming buffer + deduplication
src/ipc/orchestration-ipc.js     IPC handlers for orchestration
src/ipc/health-ipc.js            IPC for health monitoring
src/ipc/memory-ipc.js            IPC for session history
src/ipc/export-ipc.js            IPC for MD/JSON/HTML export
src/providers/provider-registry.js  Singleton registry of all 6 drivers
src/providers/base-provider.js   Abstract provider — run(), waitForComplete(), selfTest()
src/providers/chatgpt-provider.js   ChatGPT DOM driver
src/providers/claude-provider.js    Claude DOM driver
src/providers/providers.js          Gemini/Grok/Perplexity/Copilot drivers
src/providers/health-monitor.js     8s polling health checker
src/memory/session-store.js     In-process last-20-task store
src/export/exporter.js          MD/JSON/HTML export formatter
```

## Next priorities

1. **Wire boot self-test** in main.js:
   ```js
   // After views-loaded event fires, call:
   const engine = new OrchestrationEngine(getView, onProgress);
   engine.runBootSelfTest(openIds);
   ```

2. **Update DOM selectors** — run app, open DevTools in each BrowserView, verify:
   - ChatGPT: `#prompt-textarea` (ProseMirror contenteditable)
   - Claude: `.ProseMirror[contenteditable='true']`
   - Gemini: `rich-textarea .ql-editor`

3. **Persistent history** — in session-store.js add():
   ```js
   const file = path.join(app.getPath('userData'), 'history.jsonl');
   fs.appendFileSync(file, JSON.stringify(entry) + '\n');
   ```

4. **Test end-to-end**: Open ChatGPT panel → click Agent → type task → ⚡ Orchestrate
