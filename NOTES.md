# AI Council v6 — Fixed Files

## Šta je promenjeno

### Bug fixevi (postojeći fajlovi)

| Fajl | Bug | Fix |
|------|-----|-----|
| `chatgpt-provider.js` | `injectPrompt` koristio `execCommand` i na `<textarea>` (gde ne radi) | Dodata grana: textarea → React native setter, contenteditable → execCommand |
| `chatgpt-provider.js` | Fallback Enter keydown bez `shiftKey: false` → moglo da ubaci newline | Dodat `shiftKey: false` eksplicitno |
| `shared-memory.js` | `e.response.length` puca ako je `response` null/undefined u starim entries | Promenjeno u `(e.response \|\| '').length` |
| `flashcard-generator.js` | `_waitForResponse` vraćao stari odgovor ako streaming nije detektovan | Dodat snapshot pre slanja, pa se poredi posle — ako je isti, znači slanje nije prošlo |

### Novi fajlovi (engine.js ih require-uje, ali nisu bili u zipu)

| Fajl | Šta radi |
|------|----------|
| `parallel-executor.js` | Pokreće taskove paralelno sa concurrency limitom, stagger-om, retry-jem i timeout-om |
| `response-collector.js` | Skuplja rezultate i parcijalne odgovore tokom orchestration-a |
| `session-store.js` | Čuva istoriju sesija u `~/.ai-council/history.jsonl` |
| `provider-registry.js` | Registry svih AI drajvera, route-uje po tipu taska |

---

## Gde staviti fajlove

```
tvoj-projekat/
├── main.js
├── renderer/
│   ├── app.js
│   └── index.html
└── src/
    ├── orchestration/
    │   ├── engine.js                ← ovaj zip
    │   ├── ranking-engine.js        ← ovaj zip
    │   ├── parallel-executor.js     ← ovaj zip (NOVO)
    │   └── response-collector.js   ← ovaj zip (NOVO)
    ├── providers/
    │   ├── base-provider.js         ← ovaj zip
    │   ├── chatgpt-provider.js      ← ovaj zip (FIXED)
    │   ├── claude-provider.js       ← ovaj zip
    │   └── provider-registry.js    ← ovaj zip (NOVO)
    ├── memory/
    │   ├── shared-memory.js         ← ovaj zip (FIXED)
    │   └── session-store.js         ← ovaj zip (NOVO)
    └── learning/
        └── flashcard-generator.js   ← ovaj zip (FIXED)
```

---

## Testiranje — korak po korak

### Korak 1: Dependency check
Pokreni aplikaciju i otvori DevTools (Ctrl+Shift+I) u main prozoru ili u nekom BrowserView.

U konzoli main procesa provjeri da nema grešaka tipa `Cannot find module`. Ako ima:
- Provjeri da su svi fajlovi iz ovog zipa u ispravnim direktorijumima (gore)

### Korak 2: Provider self-test (selektori)
U DevTools konzoli main procesa, nakon što se aplikacija pokrene i učita sve AI panele, pokreni:

```js
// Zameni engine sa tvojom instancom ako je globalna
engine.runBootSelfTest(['chatgpt', 'claude'], 0).then(() => console.log('selfTest done'));
```

Očekivani output:
```
[ENGINE] runBootSelfTest: chatgpt, claude
✓ ChatGPT: selectors OK (100%)   ← ili procenat + lista missing
✓ Claude: selectors OK (100%)
[ENGINE] runBootSelfTest complete
```

Ako je procenat nizak (npr. 50%), AI sajt je promenio DOM. Otvori DevTools za taj BrowserView i ručno provjeri:
- ChatGPT: `document.getElementById('prompt-textarea')` treba da vrati element
- Claude: `document.querySelector('.ProseMirror[contenteditable="true"]')` treba da vrati element

### Korak 3: Broadcast test sa jednim AI-em
Pošalji kratak prompt samo jednom AI-u:

```js
engine.run({
  task: 'Say "hello" and nothing else.',
  providers: ['chatgpt'],  // ili ['claude']
  mode: 'broadcast',
  slot: 0,
}).then(r => console.log('result:', JSON.stringify(r.ranked, null, 2)));
```

Očekivani flow u konzoli:
1. `📡 Broadcasting to 1 provider(s)…`
2. `📡 Connecting to chatgpt…`
3. `✓ ChatGPT: N chars in X.Xs`
4. `✅ Done — 1/1 succeeded in X.Xs`

Ako `text` u rezultatu je prazan (`""`) ali `success: true`:
→ `extractResponse` ne pronalazi odgovor u DOM-u. Otvori DevTools za ChatGPT BrowserView i ručno provjeri selektor:
```js
document.querySelectorAll('[data-message-author-role="assistant"] .markdown')
```

### Korak 4: Shared memory test
Pošalji prompt dvama AI-jevima i provjeri da drugi dobije context od prvog:

```js
engine.run({
  task: 'Name one programming language and explain it in one sentence.',
  providers: ['chatgpt', 'claude'],
  mode: 'broadcast',
  slot: 0,
}).then(r => {
  console.log('Shared memory summary:', engine.getSharedMemorySummary());
  console.log('Ranked:', r.ranked.map(x => `${x.provider}: ${x.score}`));
});
```

Provjeri `~/.ai-council/shared-memory.jsonl` — treba da ima 2 entries.

### Korak 5: Flashcard test
Nakon što imaš odgovor vidljiv na ekranu u nekom AI panelu:

```js
engine.makeFlashcards('claude', 0, '', { count: 3, deck: 'Test' })
  .then(cards => console.log('Cards:', JSON.stringify(cards, null, 2)));
```

Očekivani output: array od 3 objekta `{ question, answer, deck }`.
Provjeri `~/.ai-council/flashcards.jsonl` — treba da ima 3 nove linije.

### Korak 6: Tournament test
```js
engine.run({
  task: 'What is the best sorting algorithm for nearly-sorted data?',
  providers: ['chatgpt', 'claude'],
  mode: 'tournament',
  taskType: 'code',
  slot: 0,
}).then(r => console.log('Tournament result:', r.ranked.length, 'responses'));
```

---

## Česti problemi

**Problem**: `Provider not ready (page not loaded)`
**Rješenje**: AI panel nije završio učitavanje. Sačekaj da se sajt potpuno učita pre pokretanja.

**Problem**: `could not find ProseMirror editor` / `could not find input element`
**Rješenje**: AI sajt je promenio DOM. Otvori DevTools za taj panel i traži novi selektor za textarea/input.

**Problem**: Flashcard generator vraća `[]`
**Rješenje**: Najvjerovatnije AI nije vratio čisti JSON (vratio je objašnjenje + JSON). Provjeri konzolu za warning `No JSON array found`. Pokušaj sa `count: 3` umjesto više — manji prompt, čistiji odgovor.

**Problem**: Shared memory prefix ne stize do drugog AI-a
**Rješenje**: U broadcast modu, taskovi su staggered 700ms. Ako su oba AI-a podjednako brza, context neće biti spreman na vreme. Ovo je limitacija broadcast-a — koristiti debate ili recursive mode za bolji cross-AI context.
