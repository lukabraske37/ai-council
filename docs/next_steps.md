# AI Council v6 — Next Steps

## Immediate (Phase 5 start)

### 1. Plugin architecture
- `userData/plugins/` directory scanned on boot
- Each plugin: `index.js` that exports `{ id, name, init(engine, registry) }`
- Plugins can register new providers, new modes, or new IPC channels
- UI: settings panel showing loaded plugins + enable/disable toggle

### 2. Persistent session history
- On each `sessionStore.add()`, also write to `userData/history.json` (append)
- On boot, load last 50 entries from file into sessionStore
- Provides cross-session replay, not just within a single app run
- Memory-IPC `memory-persist` flag to opt in

### 3. Provider config UI
- Settings panel with a table: provider | selector name | current value | test result
- Editable cells: user can fix stale selectors without editing JS
- "Test selector" button: runs querySelector on the open BrowserView
- Config saved to `userData/provider-config.json`, loaded by BaseProvider on init

### 4. Prompt chaining
- "Use as input" button on any result card
- Clicking it populates the task textarea with that result's text
- Mode auto-switches to `recursive` with 1 iteration (i.e., one refinement pass)
- Chain counter in progress log: "Chain depth: 2"

### 5. Multi-window sync
- When Agent panel produces results, post them to a shared `BroadcastChannel`
- Popup windows can listen and show results in a mini-panel
- Useful for comparing across monitors

## Known issues to watch

1. AI web UIs update their DOM — selectors in provider drivers may break silently.
   Mitigation: `runBootSelfTest()` is implemented; wire it in `main.js` after BrowserViews load.
2. Rate limiting — Gemini and Copilot are quickest to flag automation.
   Current stagger: 700ms between providers, retry ×1. May need increase.
3. Claude's ProseMirror editor class names change with deploys.
   Current: `.ProseMirror[contenteditable="true"]`. Verify periodically.
4. Grok's DOM structure varies by account type (Premium vs free).
5. Streaming partial polling adds ~N×500ms overhead (N = number of concurrent providers).
   If a provider streams for 60s, that is ~120 extractResponse() calls on that page.
   Watch for memory pressure with 5+ providers simultaneously.
6. Word diff in diff panel is set-based (not LCS). Works well for sentence-level deltas.
   If true LCS diff is needed, add `diff-match-patch` as a local vendored file.
