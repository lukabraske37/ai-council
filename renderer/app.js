// =============================================================================
// app.js — Renderer logika za AI Council
//
// Ovaj fajl kontroliše UI toolbara (gornja traka).
// Komunikacija sa Electron main procesom ide kroz window.api (definisano u preload.js).
//
// ARHITEKTURA:
//   main.js         — Electron main proces, kreira prozore i BrowserView panele
//   preload.js      — Izlaže window.api bridge između renderera i main procesa
//   app.js (ovaj)   — UI logika: presets, pane builder, modal
//   popup.html      — Mini toolbar za popup prozore (back/forward/close)
// =============================================================================


// =============================================================================
// GLOBALNI STATE
// =============================================================================

let AIS          = [];   // Lista svih dostupnih AI servisa (dolazi iz main.js)
let state        = null; // Korisnički state (presets, lastPanes) — čuva se na disku
let paneCount    = 3;    // Koliko panela je trenutno prikazano (1–5)
let currentPanes = [];   // Koji AI i koji nalog je u svakom panelu
let activePreset = null; // ID aktivnog preseta (ili null ako je custom)


// =============================================================================
// BOOT — inicijalizacija kad Electron učita prozor
// =============================================================================

// main.js šalje 'init' event sa sačuvanim state-om i listom AI-eva
window.api.onInit((savedState, ais) => {
  AIS          = ais;
  state        = savedState;
  currentPanes = state.lastPanes || [];
  paneCount    = currentPanes.length || 3;

  setupTitlebar();     // Poveži dugmiće prozora (minimize/maximize/close)
  renderPresets();     // Prikaži preset dugmiće (Research, Writing, Mixed...)
  renderPaneBuilder(); // Prikaži kontrole za izbor AI-eva i naloga
  applyPanes();        // Učitaj panele u Electron BrowserView-ove

  // Initialize Agent panel (defined in agent.js)
  if (window._initAgent) window._initAgent(ais);
});

// Kad se prozor maximize/unmaximize, promeni ikonu dugmeta
window.api.onWinState(s => {
  document.getElementById('btn-max').textContent = s === 'max' ? '❐' : '⬜';
});


// =============================================================================
// TITLEBAR — dugmići za upravljanje prozorom (minimize / maximize / close)
// =============================================================================

function setupTitlebar() {
  document.getElementById('btn-min').onclick   = () => window.api.minimize();
  document.getElementById('btn-max').onclick   = () => window.api.maximize();
  document.getElementById('btn-close').onclick = () => window.api.close();
}


// =============================================================================
// PRESETS — brzi izbor predefinisanih kombinacija panela
//
// Preset je named lista panela, npr:
//   { id: 'research', name: 'Research', panes: [{aiId:'perplexity', slot:0}, ...] }
//
// Korisnik može da doda/uredi/briše presets kroz modal (⚙ dugme).
// =============================================================================

function renderPresets() {
  const container = document.getElementById('preset-btns');
  container.innerHTML = '';

  state.presets.forEach(preset => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn' + (activePreset === preset.id ? ' active' : '');
    btn.textContent = preset.name;

    btn.onclick = () => {
      // Aktiviraj preset: postavi panele i prikaži ih
      activePreset = preset.id;
      paneCount    = preset.panes.length;
      currentPanes = preset.panes.map(p => ({ ...p })); // kopija, ne referenca

      renderPresets();
      renderPaneBuilder();
      applyPanes();
    };

    container.appendChild(btn);
  });
}


// =============================================================================
// PANE BUILDER — kontrole za ručno podešavanje panela
//
// Sastoji se od:
//   1. Brojevi (1–5) za izbor koliko panela prikazati
//   2. Za svaki panel: dropdown za AI servis + dropdown za nalog
//
// NAPOMENA: Back/Forward navigacija je SAMO u popup prozoru (popup.html),
//           ne i ovde u glavnom toolbaru.
// =============================================================================

function renderPaneBuilder() {
  const container = document.getElementById('pane-builder');
  container.innerHTML = '';

  // --- Deo 1: Dugmići za broj panela (1 / 2 / 3 / 4 / 5) ---
  const countRow = el('div', 'count-btns');

  [1, 2, 3, 4, 5].forEach(n => {
    const btn = el('button', 'count-btn' + (paneCount === n ? ' active' : ''));
    btn.textContent = n;
    btn.onclick = () => {
      paneCount = n;
      // Ako nema dovoljno panes-a, dodaj default
      while (currentPanes.length < n) {
        currentPanes.push({ aiId: AIS[0].id, slot: 0 });
      }
      activePreset = null; // Deaktiviraj preset jer je korisnik menjao ručno
      renderPresets();
      renderPaneBuilder();
    };
    countRow.appendChild(btn);
  });

  container.appendChild(countRow);

  // --- Deo 2: Dropdowni za svaki panel ---
  const selectsRow = el('div', 'pane-selects');

  for (let i = 0; i < paneCount; i++) {
    const pane  = currentPanes[i] || { aiId: AIS[0].id, slot: 0 };
    const group = el('div', 'pane-group');

    // Redni broj panela (prikazuje se korisniku kao "1", "2"...)
    const num = el('span', 'pane-num');
    num.textContent = i + 1;

    // Izbor AI servisa (ChatGPT, Claude, Gemini, Grok, Perplexity, Copilot)
    const aiSelect = makeSelect(
      AIS.map(a => ({ value: a.id, label: a.label })),
      pane.aiId,
      'sel-ai'
    );

    // Izbor naloga (Nalog 1 do Nalog 10)
    // Svaki nalog = posebna Electron particija = odvojena browser sesija / kolačići
    const slotSelect = makeSelect(
      Array.from({ length: 10 }, (_, s) => ({ value: s, label: `Nalog ${s + 1}` })),
      pane.slot || 0,
      'sel-slot'
    );

    // Kad korisnik promeni AI ili nalog, ažuriraj currentPanes
    const onSelectChange = () => {
      currentPanes[i] = { aiId: aiSelect.value, slot: +slotSelect.value };
      activePreset = null;
      renderPresets(); // Osvezi preset dugmiće (deaktiviraj aktivni)
    };
    aiSelect.onchange   = onSelectChange;
    slotSelect.onchange = onSelectChange;

    group.appendChild(num);
    group.appendChild(aiSelect);
    group.appendChild(slotSelect);
    selectsRow.appendChild(group);
  }

  container.appendChild(selectsRow);

  // Apply dugme — primeni trenutne panele
  document.getElementById('btn-apply').onclick = applyPanes;

  // Settings dugme — otvori modal za editovanje preseta
  document.getElementById('btn-edit').onclick = openModal;
}

// Šalje listu panela u main.js koji kreira BrowserView-ove i prikazuje ih
async function applyPanes() {
  const panes = currentPanes.slice(0, paneCount);
  await window.api.loadPanes(panes);

  // Sačuvaj poslednje panele na disk (za sledeće pokretanje)
  state.lastPanes = panes;
  window.api.saveState(state);
}


// =============================================================================
// MODAL — popup prozor za editovanje preseta (otvara se ⚙ dugmetom)
// =============================================================================

function openModal() {
  document.getElementById('overlay').classList.remove('hidden');
  renderModal();

  // Zatvori modal klikom na X ili na tamnu pozadinu
  document.getElementById('modal-x').onclick = closeModal;
  document.getElementById('overlay').onclick = e => {
    if (e.target.id === 'overlay') closeModal();
  };
}

function closeModal() {
  document.getElementById('overlay').classList.add('hidden');
}

// Crta sadržaj modala — lista preseta sa opcijama za editovanje
function renderModal() {
  const heading  = document.getElementById('modal-head').querySelector('span');
  const body     = document.getElementById('modal-body');
  body.innerHTML = '';
  heading.textContent = 'Uredi presets';

  // Za svaki preset prikaži red sa: [naziv] [paneli] [brisanje]
  state.presets.forEach((preset, presetIndex) => {
    const row       = el('div', 'm-preset');
    const nameInput = el('input', 'm-name');
    nameInput.value   = preset.name;
    nameInput.oninput = () => { preset.name = nameInput.value; };

    // Red sa panelima tog preseta
    const panesContainer = el('div', 'm-panes');

    preset.panes.forEach((pane, paneIndex) => {
      const paneRow = el('div', 'm-pane-row');
      const aiSel   = makeSelect(AIS.map(a => ({ value: a.id, label: a.label })), pane.aiId, 'sel-ai');
      const slotSel = makeSelect(
        Array.from({ length: 10 }, (_, s) => ({ value: s, label: `Nalog ${s + 1}` })),
        pane.slot || 0,
        'sel-slot'
      );

      aiSel.onchange   = () => { pane.aiId = aiSel.value; };
      slotSel.onchange = () => { pane.slot = +slotSel.value; };

      // Dugme za brisanje ovog panela iz preseta
      const removeBtn = el('button', 'm-btn del');
      removeBtn.textContent = '×';
      removeBtn.onclick = () => {
        preset.panes.splice(paneIndex, 1);
        renderModal(); // Ponovo iscrtaj modal
      };

      paneRow.appendChild(aiSel);
      paneRow.appendChild(slotSel);
      paneRow.appendChild(removeBtn);
      panesContainer.appendChild(paneRow);
    });

    // Dugme za dodavanje novog panela u preset (max 5)
    if (preset.panes.length < 5) {
      const addPaneBtn = el('button', 'm-btn add');
      addPaneBtn.textContent = '+';
      addPaneBtn.title = 'Dodaj panel';
      addPaneBtn.onclick = () => {
        preset.panes.push({ aiId: AIS[0].id, slot: 0 });
        renderModal();
      };
      panesContainer.appendChild(addPaneBtn);
    }

    // Dugme za brisanje celog preseta
    const deletePresetBtn = el('button', 'm-btn del');
    deletePresetBtn.textContent = '🗑';
    deletePresetBtn.onclick = () => {
      state.presets.splice(presetIndex, 1);
      renderModal();
    };

    row.appendChild(nameInput);
    row.appendChild(panesContainer);
    row.appendChild(deletePresetBtn);
    body.appendChild(row);
  });

  // Dugme za dodavanje novog preseta
  const addPresetBtn = el('button', 'm-add-preset');
  addPresetBtn.textContent = '+ Novi preset';
  addPresetBtn.onclick = () => {
    state.presets.push({
      id   : 'p_' + Date.now(), // Unique ID baziran na timestamp-u
      name : 'Novi',
      panes: [
        { aiId: 'claude',  slot: 0 },
        { aiId: 'chatgpt', slot: 0 },
      ],
    });
    renderModal();
  };

  // Dugme za čuvanje svih izmena na disk
  const saveBtn = el('button', 'm-save');
  saveBtn.textContent = 'Sačuvaj';
  saveBtn.onclick = () => {
    window.api.saveState(state);
    renderPresets();
    closeModal();
  };

  body.appendChild(addPresetBtn);
  body.appendChild(saveBtn);
}


// =============================================================================
// POMOĆNE FUNKCIJE
// =============================================================================

/**
 * Skraćenica za document.createElement sa opcionalnim className.
 * Primer: el('div', 'pane-group') === <div class="pane-group">
 */
function el(tag, cls) {
  const elem = document.createElement(tag);
  if (cls) elem.className = cls;
  return elem;
}

/**
 * Kreira <select> element sa listom opcija.
 * @param {Array}  options   — [{value, label}, ...]
 * @param {*}      selected  — vrednost koja treba biti selektovana
 * @param {string} cls       — CSS klasa
 */
function makeSelect(options, selected, cls) {
  const sel = el('select', cls);
  options.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value       = value;
    opt.textContent = label;
    if (String(value) === String(selected)) opt.selected = true;
    sel.appendChild(opt);
  });
  return sel;
}
