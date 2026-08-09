<div align="center">

<br/>

# ⚡ AI Council

**Multi-model orchestration platform — pita 6 AI-a odjednom, poredi i rangiraj odgovore, sve iz jedne desktop app.**

[![Version](https://img.shields.io/badge/version-6.0.0-5b6ef5?style=flat-square)](https://github.com/lukabraske37/ai-council/releases)
[![Electron](https://img.shields.io/badge/Electron-29-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white)](https://github.com/lukabraske37/ai-council/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/status-beta-orange?style=flat-square)]()

<br/>

> Stop tab-switching. Let them compete.

<br/>

</div>

---

## 🧠 Šta je AI Council?

AI Council je **desktop aplikacija** koja otvara više AI servisa istovremeno, rame uz rame — i sad ide korak dalje: **Agent Mode** može isti prompt da pošalje svim otvorenim AI-evima paralelno, sakupi odgovore, i rangira ih po kvalitetu.

Umesto da skačeš između tabova i sam poredi odgovore — Council to radi za tebe.

```
┌──────────────────┬──────────────────┬──────────────────┐
│   ChatGPT        │   Claude         │   Gemini         │
│                  │                  │                  │
│  [web prikaz]    │  [web prikaz]    │  [web prikaz]    │
│                  │                  │                  │
└──────────────────┴──────────────────┴──────────────────┘
     🤖 Agent: "objasni X" → paralelno pita sve → rangira odgovore
```

---

## ✨ Funkcije

### Multi-pane browser
- **1–5 panela** — prilagodi koliko AI-eva vidiš odjednom
- **Presets** — sačuvaj omiljene kombinacije (Research, Writing, Mixed...)
- **Više naloga** — otvori isti AI u dva panela sa različitim nalozima
- **Custom titlebar** — elegantno frameless prozor, tamna tema
- **Popup prozori** — linkovi se otvaraju u mini prozorima sa back/forward navigacijom
- **State persistence** — pamti tvoje poslednje panele i presets između sesija

### 🤖 Agent Mode (novo u v6)
- **Orchestration engine** — pošalje jedan task svim otvorenim provajderima paralelno (concurrency 3, stagger 700ms)
- **5 modova**: `broadcast`, `tournament`, `specialized`, `recursive`, `debate`
- **Live streaming kartice** — vidiš odgovore kako pristižu, provider po provider
- **Ranking engine** — boduje odgovore po dužini, strukturi, brzini i istorijskom učinku provajdera
- **Deduplikacija** — Jaccard sličnost uklanja skoro-identične odgovore
- **Diff prikaz** — poredi top 2 odgovora reč po reč
- **Export** — snimi rezultate kao MD / JSON / HTML
- **Shared memory + history panel** — poslednjih 20 taskova, replay i brisanje
- **Health monitor** — detektuje login-wall i nedostupne provajdere

### Podržani AI servisi

| Servis | URL |
|--------|-----|
| ChatGPT | chatgpt.com |
| Claude | claude.ai |
| Gemini | gemini.google.com |
| Grok | grok.com |
| Perplexity | perplexity.ai |
| Microsoft Copilot | copilot.microsoft.com |

---

## 🚀 Instalacija (development)

### Preduslovi
- [Node.js](https://nodejs.org/) v18+
- npm

### Pokretanje
```bash
# Kloniraj repo
git clone https://github.com/lukabraske37/ai-council.git
cd ai-council

# Instaliraj zavisnosti
npm install

# Pokreni aplikaciju
npm start
```

### Build (Windows .exe installer)
```bash
npm run build
# Installer se pojavljuje u /dist folderu
```

---

## 📁 Struktura projekta

```
ai-council/
├── main.js                          # Electron main — prozori, BrowserView paneli, IPC
├── preload.js                       # Context bridge (renderer ↔ main)
├── package.json
│
├── src/
│   ├── orchestration/
│   │   ├── engine.js                # OrchestrationEngine (state machine)
│   │   ├── parallel-executor.js     # Concurrency + stagger + retry
│   │   ├── response-collector.js    # Sakuplja i normalizuje odgovore
│   │   └── ranking-engine.js        # Boduje i rangira odgovore
│   │
│   ├── providers/                   # DOM drajveri za svaki AI servis
│   │   ├── base-provider.js         # Apstraktna bazna klasa
│   │   ├── chatgpt-provider.js
│   │   ├── claude-provider.js
│   │   ├── gemini-provider.js
│   │   ├── grok-provider.js
│   │   ├── perplexity-provider.js
│   │   ├── copilot-provider.js
│   │   ├── provider-registry.js     # Registry + factory
│   │   └── health-monitor.js        # Login-wall / dostupnost detekcija
│   │
│   ├── memory/
│   │   ├── session-store.js         # Istorija taskova (poslednjih 20)
│   │   └── shared-memory.js
│   │
│   ├── export/
│   │   └── exporter.js              # MD / JSON / HTML export
│   │
│   ├── learning/
│   │   └── flashcard-generator.js
│   │
│   ├── config/
│   │   └── provider-config.js
│   │
│   └── ipc/                         # IPC handler registracija po domenu
│       ├── orchestration-ipc.js
│       ├── memory-ipc.js
│       ├── export-ipc.js
│       ├── config-ipc.js
│       └── health-ipc.js
│
├── renderer/
│   ├── index.html                   # Glavni UI
│   ├── app.js                       # Toolbar, presets, pane builder
│   ├── agent.js                     # Agent panel UI (orchestration, rezultati)
│   ├── popup.html                   # Mini toolbar za popup prozore
│   └── style.css
│
└── docs/                            # Arhitektura, progres, poznati problemi
```

---

## 🛠️ Kako funkcioniše

AI Council koristi Electron **BrowserView** za svaki panel — pravi browser, ne iframe. To znači:

- Potpuna kompatibilnost sa svim AI sajtovima, bez API ključeva (koristi tvoju već ulogovanu sesiju)
- Lokalni storage i kolačići odvojeni po nalogu
- Nema problema sa Content Security Policy

Za Agent Mode, `OrchestrationEngine` u main procesu koristi `webContents.executeJavaScript()` da injektuje prompt, klikne send i izvuče odgovor direktno iz DOM-a svakog otvorenog panela — paralelno, sa retry i backoff logikom. Detalji u [docs/architecture.md](docs/architecture.md).

Komunikacija između UI-ja i panela ide kroz **IPC** (ipcMain/ipcRenderer), zaštićena `contextIsolation`-om.

> ⚠️ DOM selektori za svaki provajder zavise od trenutnog izgleda njihovih web sajtova i mogu da se pokvare kad AI servis promeni UI — vidi [docs/next_steps.md](docs/next_steps.md#known-issues-to-watch) za poznata ograničenja.

---

## 📋 Changelog

Pogledaj [CHANGELOG.md](CHANGELOG.md) za istoriju verzija.

---

## 🗺️ Roadmap

- [ ] Plugin arhitektura (custom provajderi/modovi kroz `userData/plugins/`)
- [ ] Perzistentna istorija preko sesija (`userData/history.json`)
- [ ] Provider config UI — izmena selektora bez editovanja koda
- [ ] Prompt chaining ("Use as input" na bilo kom rezultatu)
- [ ] macOS podrška
- [ ] Keyboard shortcuts
- [ ] Više AI servisa (Mistral, DeepSeek...)

---

## 📄 Licenca

MIT — koristi slobodno, ali ♥ ako staviš credit.

---

<div align="center">

Napravljeno sa ⚡ i previše otvorenih tabova

</div>
