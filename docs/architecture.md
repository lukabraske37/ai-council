# AI Council — Architecture Overview
## v6.0.0 — Multi-Model Orchestration Platform

---

## 1. HIGH-LEVEL ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ELECTRON MAIN PROCESS                        │
│                                                                       │
│  ┌──────────────┐    ┌─────────────────────────────────────────────┐ │
│  │   main.js    │    │           OrchestrationEngine               │ │
│  │              │◄──►│                                             │ │
│  │  - Window    │    │  ┌──────────┐  ┌──────────┐  ┌──────────┐  │ │
│  │  - BrowserV  │    │  │ Router   │  │Collector │  │ Ranker   │  │ │
│  │  - IPC hand. │    │  └────┬─────┘  └────┬─────┘  └────┬─────┘  │ │
│  └──────┬───────┘    │       │              │              │        │ │
│         │            │  ┌────▼─────────────▼──────────────▼─────┐  │ │
│         │            │  │           ProviderRegistry              │  │ │
│         │            │  │   ChatGPT │ Claude │ Gemini │ Grok...  │  │ │
│         │            │  └────────────────────────────────────────┘  │ │
│         │            └─────────────────────────────────────────────┘ │
│         │                            │                                │
│         │                   executeJavaScript()                       │
│         │                            │                                │
│  ┌──────▼────────────────────────────▼────────────────────────────┐  │
│  │                     BrowserView Layer                           │  │
│  │   [ChatGPT BV] [Claude BV] [Gemini BV] [Grok BV] ...          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────────────┘
                       │  IPC (ipcMain / ipcRenderer)
┌──────────────────────▼──────────────────────────────────────────────┐
│                      RENDERER PROCESS                                │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                      app.js (UI Logic)                          │ │
│  │                                                                 │ │
│  │  Toolbar:  [Presets] [Pane Builder] [Apply] [⚙] [🤖 Agent]    │ │
│  │                                                                 │ │
│  │  Agent Panel:                                                   │ │
│  │    [Task Input] ──► [Orchestrate] ──► [Results + Ranking]       │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. ORCHESTRATION ENGINE — State Machine

```
IDLE
  │
  ▼ (user clicks "Orchestrate" with task)
ROUTING
  │  - Analyze task type (creative / factual / code / analysis)
  │  - Select best providers for this task
  │  - Determine parallel vs sequential strategy
  ▼
EXECUTING (parallel)
  │  - Each selected provider:
  │    1. Find/create BrowserView for that provider
  │    2. executeJavaScript → inject prompt into textarea
  │    3. executeJavaScript → click send button
  │    4. Poll for response completion
  │    5. executeJavaScript → extract response text
  ▼
COLLECTING
  │  - Gather all responses
  │  - Normalize format
  │  - Record timing/metadata
  ▼
RANKING
  │  - Score each response:
  │    * Length & depth (weighted by task type)
  │    * Structure (headers, code blocks, lists)
  │    * Confidence markers
  │    * Response time
  │    * Historical provider performance
  ▼
REFINING (optional recursive loop)
  │  - Feed top responses back as context
  │  - Ask providers to critique/improve
  │  - Re-rank
  ▼
DONE
  │  - Stream results to renderer
  │  - Show ranked list with scores
  │  - Allow user to "Apply best" or pick manually
```

---

## 3. PROVIDER DRIVER INTERFACE

Each AI provider has a driver that implements:

```javascript
class BaseProvider {
  async injectPrompt(webContents, text)  // Inject text into AI textarea
  async sendPrompt(webContents)          // Click send button
  async extractResponse(webContents)     // Extract latest response
  async isReady(webContents)             // Check if AI is ready for input
  async waitForComplete(webContents)     // Wait for streaming to finish
}
```

DOM selectors are provider-specific:
- **ChatGPT**: `#prompt-textarea`, `.message-content:last-child`
- **Claude**: `[contenteditable]` in ProseMirror, `.font-claude-message:last-child`
- **Gemini**: `.ql-editor`, `.model-response-text:last-child`
- **Grok**: `textarea[placeholder]`, `.response-content:last-child`
- **Perplexity**: `textarea`, `.prose:last-child`
- **Copilot**: `#userInput`, `.response-message:last-child`

---

## 4. IPC CHANNEL MAP

| Channel | Direction | Payload | Description |
|---------|-----------|---------|-------------|
| `orchestrate` | R→M | `{task, providers, mode}` | Start orchestration |
| `orchestrate-progress` | M→R | `{step, provider, status}` | Progress update |
| `orchestrate-result` | M→R | `{results[], ranked[]}` | Final results |
| `orchestrate-cancel` | R→M | `{}` | Cancel in progress |
| `provider-status` | M→R | `{id, ready}` | Provider readiness |
| `load-panes` | R→M | `[{aiId, slot}]` | Load BrowserViews |
| `save-state` | R→M | `state` | Persist state |
| `init` | M→R | `{state, ais}` | Boot data |

---

## 5. FILE STRUCTURE

```
ai-council5/
├── main.js                          # Electron main — window, BV, IPC
├── preload.js                       # Context bridge (renderer ↔ main)
├── package.json
│
├── src/
│   ├── orchestration/
│   │   ├── engine.js                # OrchestrationEngine (state machine)
│   │   ├── response-collector.js    # Collects + normalizes responses
│   │   └── ranking-engine.js        # Scores and ranks responses
│   │
│   ├── providers/
│   │   ├── base-provider.js         # Abstract base class
│   │   ├── chatgpt-provider.js      # ChatGPT DOM driver
│   │   ├── claude-provider.js       # Claude DOM driver
│   │   ├── gemini-provider.js       # Gemini DOM driver
│   │   ├── grok-provider.js         # Grok DOM driver
│   │   ├── perplexity-provider.js   # Perplexity DOM driver
│   │   ├── copilot-provider.js      # Copilot DOM driver
│   │   └── provider-registry.js     # Registry + factory
│   │
│   └── ipc/
│       └── orchestration-ipc.js     # IPC handler registration
│
├── renderer/
│   ├── index.html                   # Main window HTML
│   ├── app.js                       # UI logic (presets, panes, agent)
│   ├── agent.js                     # Agent panel UI
│   └── style.css                    # Styles
│
└── docs/
    ├── architecture.md              # This file
    ├── progress.md                  # What's done
    ├── next_steps.md                # What comes next
    ├── current_state.json           # Machine-readable state
    ├── file_tree.md                 # Full file tree
    ├── session_log.md               # Session history
    └── recovery_instructions.md    # How to continue after interruption
```

---

## 6. KEY DESIGN DECISIONS

### Why BrowserView injection instead of APIs?
- User is already logged in — no API keys required
- Works with free tiers and paid accounts alike
- Models in web UI may differ from API models
- Preserves conversation history per-account

### Why main process for orchestration?
- Direct access to `BrowserView.webContents`
- `executeJavaScript()` only available in main process context
- No security issues with passing webContents handles

### Why not Puppeteer/Selenium?
- Heavy dependencies, separate browser instances
- Can't share Electron's existing BrowserViews
- Electron's native `executeJavaScript()` is cleaner and faster

---

## 7. AGENT MODES

| Mode | Description |
|------|-------------|
| **Broadcast** | Send same prompt to all selected providers in parallel |
| **Tournament** | Broadcast → rank → refine top 2 → final rank |
| **Specialized** | Route subtasks to best provider by capability |
| **Recursive** | Loop: refine until quality threshold met |
| **Debate** | Provider A critiques Provider B's response and vice versa |
