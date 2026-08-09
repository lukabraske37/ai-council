# Changelog

Sve promene između verzija su dokumentovane ovde.

---

## [6.0.0] — 24.05.2026

### Novo — Agent Mode / Orchestration Engine
- `OrchestrationEngine` — state machine (routing → executing → collecting → ranking → refining)
- 5 modova rada: `broadcast`, `tournament`, `specialized`, `recursive`, `debate`
- `ParallelExecutor` — paralelno izvršavanje sa concurrency=3, stagger 700ms, retry + backoff
- Provider drajveri za 6 servisa (ChatGPT, Claude, Gemini, Grok, Perplexity, Copilot) — injektuju prompt i izvlače odgovor direktno iz DOM-a otvorenog panela, bez API ključeva
- `ResponseCollector` — normalizacija i Jaccard deduplikacija odgovora
- `RankingEngine` — bodovanje po dužini, strukturi, brzini i istorijskom učinku provajdera
- `HealthMonitor` — detekcija login-wall-a i nedostupnih provajdera (8s polling)
- Live streaming kartice odgovora u Agent panelu, sa statusnim čipovima (running/done/error)
- Diff panel — poređenje top 2 odgovora reč po reč
- Export sistem (MD / JSON / HTML preko save dijaloga)
- `sessionStore` — istorija poslednjih 20 taskova, replay i brisanje
- Task template-i (5 gotovih preseta)
- Pre-flight provera — upozorenje ako nijedan panel nije otvoren pre orkestracije

### Poboljšano
- `preload.js` proširen sa `listOpenViews()`, `openProviderView()`, `onViewsLoaded()`
- `main.js` — nove IPC rute (`list-open-views`, `open-provider-view`, `views-loaded`)
- Debug logging na svim slojevima (main, IPC, engine, agent UI, preload)

### Poznata ograničenja
- DOM selektori provajdera zavise od trenutnog izgleda AI sajtova i mogu da se pokvare kad promene UI
- Gemini i Copilot najbrže flaguju automatizovan unos — stagger možda treba povećati
- Perzistentna istorija (`userData/history.jsonl`) između sesija još nije implementirana
- Diff panel koristi set-based poređenje reči, ne pravi LCS diff

---

## [5.0.0-beta] — 18.05.2026

### Novo
- Popup prozori sa mini toolbarom (back / forward / close)
- `popup.html` — odvojen UI za popup prozore
- `launch.vbs` i `create-shortcut.bat` — lakše pokretanje bez terminala

### Poboljšano
- Bolja stabilnost BrowserView panela
- Preciznije pozicioniranje panela pri resize-u prozora

---

## [2.0.0-alpha] — 01.05.2026

### Osnova
- Multi-pane prikaz AI servisa (1–5 panela)
- Presets sistem (Research, Writing, Mixed)
- Više naloga po AI servisu
- Custom frameless titlebar
- Persistentni state (pamti panele između sesija)
- Podržani servisi: ChatGPT, Claude, Gemini, Grok, Perplexity, Copilot
- `ai-config.js` — centralizovana konfiguracija AI servisa

---

## Format

`[VERZIJA] — DATUM`
- **Novo** — nove funkcije
- **Poboljšano** — promene postojećih funkcija  
- **Popravljeno** — bug fiksevi
- **Uklonjeno** — uklonjene funkcije
