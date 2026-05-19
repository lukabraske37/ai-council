<div align="center">

<br/>

# ⚡ AI Council

**Multi-pane AI browser — open ChatGPT, Claude, Gemini, Grok and more side by side.**

[![Version](https://img.shields.io/badge/version-5.0.0--beta-5b6ef5?style=flat-square)](https://github.com/yourusername/ai-council/releases)
[![Electron](https://img.shields.io/badge/Electron-29-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white)](https://github.com/yourusername/ai-council/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/status-beta-orange?style=flat-square)]()

<br/>

> Stop tab-switching. See everything at once.

<br/>

</div>

---

## 🧠 Šta je AI Council?

AI Council je **desktop aplikacija** koja ti daje jedan prozor sa više AI servisa otvorenih istovremeno, rame uz rame.

Umesto da skačeš između tabova i kopiraš odgovore tamo-vamo — vidiš sve odjednom i poređuješ u realnom vremenu.

```
┌──────────────────┬──────────────────┬──────────────────┐
│   ChatGPT        │   Claude         │   Gemini         │
│                  │                  │                  │
│  [web prikaz]    │  [web prikaz]    │  [web prikaz]    │
│                  │                  │                  │
└──────────────────┴──────────────────┴──────────────────┘
          postavi 1 do 5 panela — ti biraj
```

---

## ✨ Funkcije

- **1–5 panela** — prilagodi koliko AI-eva vidiš odjednom
- **Presets** — sačuvaj omiljene kombinacije (Research, Writing, Mixed...)
- **Više naloga** — otvori isti AI u dva panela sa različitim nalozima
- **Custom titlebar** — elegantno frameless prozor, tamna tema
- **Popup prozori** — linkovi se otvaraju u mini prozorima sa back/forward navigacijom
- **State persistence** — pamti tvoje poslednje panele i presets između sesija
- **Podržani AI servisi:**

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
git clone https://github.com/yourusername/ai-council.git
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
├── main.js              # Electron main proces — prozori, BrowserView paneli
├── preload.js           # IPC bridge između main i renderer procesa
├── ai-config.js         # Lista AI servisa i konfiguracija
├── package.json
├── renderer/
   ├── index.html       # Glavni UI
   ├── app.js           # Renderer logika (toolbar, presets, pane builder)
   ├── popup.html       # Mini toolbar za popup prozore
   └── style.css        # Tamna tema, CSS varijable
```

---

## 🛠️ Kako funkcioniše

AI Council koristi Electron **BrowserView** — svaki panel je zapravo pravi browser, ne iframe. To znači:

- Potpuna kompatibilnost sa svim AI sajtovima
- Lokalni storage i kolačići odvojeni po nalogu
- Nema problema sa Content Security Policy

Komunikacija između UI-ja i panela ide kroz **IPC** (ipcMain/ipcRenderer), zaštićena `contextIsolation`-om.

---

## 📋 Changelog

Pogledaj [CHANGELOG.md](CHANGELOG.md) za istoriju verzija.

---

## 🗺️ Roadmap

- [ ] macOS podrška
- [ ] Drag & drop promena redosleda panela
- [ ] Keyboard shortcuts
- [ ] Sync state u cloud
- [ ] Više AI servisa (Mistral, DeepSeek...)

---

## 📄 Licenca

MIT — koristi slobodno, ali ♥ ako staviš credit.

---

<div align="center">

Napravljeno sa ⚡ i previše otvorenih tabova

</div>
