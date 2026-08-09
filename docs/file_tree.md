# AI Council v6 — File Tree

```
ai-council6/
├── main.js                          ← Electron main: BrowserWindow, BrowserViews, IPC wiring
├── preload.js                       ← Context bridge (window.api) for renderer
├── package.json
├── launch.vbs                       ← Windows launcher
├── create-shortcut.bat
│
├── renderer/
│   ├── index.html                   ← Main window HTML shell
│   ├── app.js                       ← Main renderer: layout, tabs, AI panel management
│   ├── agent.js                     ← Agent panel UI: templates, auto mode, export, diff, history
│   ├── style.css                    ← All styles incl. health, streaming, history, diff, export
│   └── popup.html                   ← Popup window HTML
│
└── src/
    ├── providers/
    │   ├── base-provider.js         ← Abstract base: run(), waitForComplete(onPartial), selfTest()
    │   ├── provider-registry.js     ← Singleton registry + capability routing
    │   ├── providers.js             ← Registers all 6 drivers
    │   ├── claude-provider.js       ← Claude driver (ProseMirror injection)
    │   ├── chatgpt-provider.js      ← ChatGPT driver (React input)
    │   └── health-monitor.js        ← 8s health polling per provider
    │
    ├── orchestration/
    │   ├── engine.js                ← State machine (6 modes incl. 'auto'), _autoPickMode(), runBootSelfTest()
    │   ├── parallel-executor.js     ← Concurrency=3, stagger, retry+backoff
    │   ├── response-collector.js    ← Deduplication (Jaccard trigram), timing stats
    │   └── ranking-engine.js        ← Score: length, structure, confidence, speed, code, citations
    │
    ├── memory/
    │   └── session-store.js         ← In-process history (last 20), getSummaries(), replay  [Phase 3]
    │
    ├── export/                                                                               [Phase 4 NEW]
    │   └── exporter.js              ← toMarkdown(), toJson(), toHtml() export converters
    │
    └── ipc/
        ├── orchestration-ipc.js     ← orchestrate, cancel, get-providers, partial/selftest routing
        ├── health-ipc.js            ← health-get-all, health-check-now, health-status push
        ├── memory-ipc.js            ← memory-get-history, get-entry, clear, remove, size  [Phase 3]
        └── export-ipc.js            ← export-formats, export-results (save dialog + fs)   [Phase 4 NEW]
```

## IPC Channel Map

| Channel               | Direction | Handler              | Purpose                              |
|-----------------------|-----------|----------------------|--------------------------------------|
| orchestrate           | R→M       | orchestration-ipc    | Start orchestration run              |
| orchestrate-cancel    | R→M       | orchestration-ipc    | Cancel running run                   |
| orchestrate-progress  | M→R       | orchestration-ipc    | Progress events (routing, executing…)|
| orchestrate-result    | M→R       | orchestration-ipc    | Final ranked results                 |
| partial-response      | M→R       | orchestration-ipc    | Live partial text during streaming   |
| provider-selftest     | M→R       | orchestration-ipc    | Self-test coverage per provider      |
| get-providers         | R→M       | orchestration-ipc    | List registered providers            |
| health-get-all        | R→M       | health-ipc           | All current health statuses          |
| health-check-now      | R→M       | health-ipc           | Force immediate check for one prov.  |
| health-status         | M→R       | health-ipc           | Push on status change                |
| memory-get-history    | R→M       | memory-ipc           | List task summaries (last 20)        |
| memory-get-entry      | R→M       | memory-ipc           | Full entry by id (for replay)        |
| memory-clear          | R→M       | memory-ipc           | Wipe all history                     |
| memory-remove         | R→M       | memory-ipc           | Delete single entry                  |
| memory-size           | R→M       | memory-ipc           | Count of stored entries              |
| export-formats        | R→M       | export-ipc           | List supported export formats        |
| export-results        | R→M       | export-ipc           | Save dialog + write file to disk     |
