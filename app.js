/* Kontenmodell – Aufteilung des Nettoeinkommens auf Konten ("Buckets").
   Alles läuft im Browser, gespeichert wird in localStorage. */

'use strict';

const STORAGE_KEY = 'kontenmodell.v1';

/* Umrechnung eines Turnus auf einen Monatswert */
const FREQ_FACTOR = {
  monthly: 1,
  quarterly: 1 / 3,
  halfyearly: 1 / 6,
  yearly: 1 / 12,
};

const MODES = ['percent', 'fixed', 'linked', 'rest'];

const PALETTE = [
  'var(--c-risiko)',
  'var(--c-fix)',
  'var(--c-lifestyle)',
  'var(--c-urlaub)',
  'var(--c-invest)',
  'var(--c-steuer)',
];

const DEFAULT_DATA = {
  income: 3000,
  buckets: [
    { id: 'pnm45j3', name: 'Risikorücklage', note: 'Notgroschen (Zugang erschwert)', mode: 'percent', value: 10, color: 'var(--c-risiko)' },
    { id: '6rshdhj', name: 'Fixkosten', note: 'Miete, Versicherungen, Abos', mode: 'linked', value: 0, color: 'var(--c-fix)' },
    { id: '03tbe8u', name: 'Lifestyle', note: 'Einkaufen, Spaß · N26', mode: 'percent', value: 20, color: 'var(--c-lifestyle)' },
    { id: 'nmovvh1', name: 'Urlaub', note: 'Reisekasse', mode: 'percent', value: 5, color: 'var(--c-urlaub)' },
    { id: 'qr0ws1l', name: 'Investment', note: 'ETF / Sparplan', mode: 'percent', value: 15, color: 'var(--c-invest)' },
    { id: '1r2sdei', name: 'Steuerrücklage', note: 'für Nachzahlungen', mode: 'percent', value: 0, color: 'var(--c-steuer)' },
  ],
  fixedCosts: [
    { id: 'slbhko3', name: 'Miete / Wohnen', amount: 900, freq: 'monthly' },
    { id: 'ljl2b3p', name: 'Netflix / Streaming', amount: 13.99, freq: 'monthly' },
    { id: '4cna1mu', name: 'Handyvertrag', amount: 25, freq: 'monthly' },
    { id: 'gpitw4b', name: 'Haftpflichtversicherung', amount: 80, freq: 'yearly' },
    { id: 'y8t8a8x', name: 'KFZ-Versicherung', amount: 600, freq: 'yearly' },
    { id: 'ebgp242', name: 'Strom', amount: 210, freq: 'quarterly' },
  ],
};

/* ---------- Hilfsfunktionen ---------- */

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const pct = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const fmtEUR = (n) => eur.format(n || 0);
const fmtPct = (n) => `${pct.format(n || 0)} %`;

/** Akzeptiert "1.234,56", "1234.56", "13,99 €" … */
function parseNum(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  let s = String(raw ?? '').trim().replace(/[€\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const newId = () => Math.random().toString(36).slice(2, 9);

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- Zustand ---------- */

function normalize(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const buckets = Array.isArray(data.buckets) ? data.buckets : [];
  const fixedCosts = Array.isArray(data.fixedCosts) ? data.fixedCosts : [];

  return {
    income: Math.max(0, parseNum(data.income)),
    buckets: buckets.map((b, i) => ({
      id: b?.id || newId(),
      name: String(b?.name ?? ''),
      note: String(b?.note ?? ''),
      mode: MODES.includes(b?.mode) ? b.mode : 'percent',
      value: Math.max(0, parseNum(b?.value)),
      color: b?.color || PALETTE[i % PALETTE.length],
    })),
    fixedCosts: fixedCosts.map((f) => ({
      id: f?.id || newId(),
      name: String(f?.name ?? ''),
      amount: Math.max(0, parseNum(f?.amount)),
      freq: FREQ_FACTOR[f?.freq] ? f.freq : 'monthly',
    })),
  };
}

function load() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return normalize(JSON.parse(stored));
  } catch (err) {
    console.warn('Gespeicherte Daten konnten nicht gelesen werden:', err);
  }
  return normalize(DEFAULT_DATA);
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Speichern fehlgeschlagen:', err);
    }
  }, 200);
}

let state = load();

const bucketById = (id) => state.buckets.find((b) => b.id === id);
const fixedById = (id) => state.fixedCosts.find((f) => f.id === id);

/* ---------- Berechnung ---------- */

const monthlyOf = (item) => item.amount * (FREQ_FACTOR[item.freq] ?? 1);

function compute() {
  const income = state.income;
  const fixedMonthly = state.fixedCosts.reduce((sum, f) => sum + monthlyOf(f), 0);

  const amounts = new Map();
  let assigned = 0;

  for (const b of state.buckets) {
    if (b.mode === 'rest') continue;
    let amount = 0;
    if (b.mode === 'percent') amount = (income * b.value) / 100;
    else if (b.mode === 'fixed') amount = b.value;
    else if (b.mode === 'linked') amount = fixedMonthly;
    amounts.set(b.id, amount);
    assigned += amount;
  }

  /* Rest-Konten teilen sich, was nach allen anderen Konten übrig bleibt. */
  const restBuckets = state.buckets.filter((b) => b.mode === 'rest');
  const leftover = income - assigned;
  if (restBuckets.length) {
    const share = Math.max(0, leftover) / restBuckets.length;
    for (const b of restBuckets) {
      amounts.set(b.id, share);
      assigned += share;
    }
  }

  return {
    income,
    fixedMonthly,
    amounts,
    allocated: assigned,
    rest: income - assigned,
    fixedRate: income > 0 ? (fixedMonthly / income) * 100 : 0,
  };
}

/* ---------- Zeilen aufbauen ---------- */

const bucketRows = $('#bucket-rows');
const fixedRows = $('#fixed-rows');
const tplBucket = $('#tpl-bucket');
const tplFixed = $('#tpl-fixed');

function applyMode(row, bucket) {
  const input = $('[data-field="value"]', row);
  const unit = $('[data-role="value-unit"]', row);
  const derived = bucket.mode === 'linked' || bucket.mode === 'rest';

  input.disabled = derived;
  input.value = derived ? '' : plain.format(bucket.value);
  unit.textContent = bucket.mode === 'percent' ? '%' : bucket.mode === 'fixed' ? '€' : '';
  input.placeholder = bucket.mode === 'linked' ? 'auto' : bucket.mode === 'rest' ? 'Rest' : '';
}

function buildBucketRow(bucket) {
  const row = tplBucket.content.firstElementChild.cloneNode(true);
  row.dataset.id = bucket.id;
  $('[data-role="swatch"]', row).style.setProperty('--swatch', bucket.color);
  $('[data-field="name"]', row).value = bucket.name;
  $('[data-field="note"]', row).value = bucket.note;
  $('[data-field="mode"]', row).value = bucket.mode;
  applyMode(row, bucket);
  return row;
}

function buildFixedRow(item) {
  const row = tplFixed.content.firstElementChild.cloneNode(true);
  row.dataset.id = item.id;
  $('[data-field="name"]', row).value = item.name;
  $('[data-field="amount"]', row).value = plain.format(item.amount);
  $('[data-field="freq"]', row).value = item.freq;
  return row;
}

function renderRows() {
  bucketRows.replaceChildren(...state.buckets.map(buildBucketRow));
  fixedRows.replaceChildren(...state.fixedCosts.map(buildFixedRow));
  refresh();
}

/* ---------- Berechnete Werte aktualisieren ---------- */

const bar = $('#bar');
const warning = $('[data-role="warning"]');

function refresh() {
  const result = compute();

  for (const row of bucketRows.children) {
    const amount = result.amounts.get(row.dataset.id) ?? 0;
    $('[data-role="monthly"]', row).textContent = fmtEUR(amount);
    $('[data-role="yearly"]', row).textContent = fmtEUR(amount * 12);
  }

  for (const row of fixedRows.children) {
    const item = fixedById(row.dataset.id);
    $('[data-role="monthly"]', row).textContent = item ? fmtEUR(monthlyOf(item)) : '–';
  }

  $('[data-role="total-allocated"]').textContent = fmtEUR(result.allocated);
  $('[data-role="total-fixed"]').textContent = fmtEUR(result.fixedMonthly);
  $('[data-role="fixed-rate"]').textContent = fmtPct(result.fixedRate);

  const over = result.rest < -0.005;
  const restLabel = $('[data-role="rest-label"]');
  const restValue = $('[data-role="total-rest"]');
  restLabel.textContent = over ? 'Überzogen' : 'Nicht zugeteilt';
  restValue.textContent = fmtEUR(Math.abs(result.rest));
  restValue.classList.toggle('negative', over);
  restValue.classList.toggle('positive', !over && result.rest > 0.005);

  warning.hidden = !over;
  warning.className = 'hint warn';
  if (over) {
    warning.textContent = `Die Konten fordern ${fmtEUR(Math.abs(result.rest))} mehr, als das Einkommen hergibt.`;
  }

  renderBar(result, over);
}

function renderBar(result, over) {
  const scale = Math.max(result.income, result.allocated);
  const segments = [];

  if (scale > 0) {
    for (const b of state.buckets) {
      const amount = result.amounts.get(b.id) ?? 0;
      if (amount <= 0) continue;
      const seg = document.createElement('span');
      seg.style.width = `${(amount / scale) * 100}%`;
      seg.style.background = b.color;
      seg.title = `${b.name || 'Konto'}: ${fmtEUR(amount)}`;
      segments.push(seg);
    }
    if (result.rest > 0.005) {
      const seg = document.createElement('span');
      seg.style.width = `${(result.rest / scale) * 100}%`;
      seg.style.background = 'var(--c-rest)';
      seg.style.opacity = '.35';
      seg.title = `Nicht zugeteilt: ${fmtEUR(result.rest)}`;
      segments.push(seg);
    }
  }

  bar.replaceChildren(...segments);
  bar.classList.toggle('over', over);
}

/* ---------- Ereignisse ---------- */

const incomeInput = $('#income');
incomeInput.value = plain.format(state.income);

incomeInput.addEventListener('input', () => {
  state.income = Math.max(0, parseNum(incomeInput.value));
  save();
  refresh();
});
incomeInput.addEventListener('blur', () => {
  incomeInput.value = plain.format(state.income);
});

bucketRows.addEventListener('input', (event) => {
  const field = event.target.dataset.field;
  const row = event.target.closest('.bucket');
  if (!field || !row) return;
  const bucket = bucketById(row.dataset.id);
  if (!bucket) return;

  if (field === 'value') bucket.value = Math.max(0, parseNum(event.target.value));
  else bucket[field] = event.target.value;

  save();
  if (field === 'value') refresh();
});

bucketRows.addEventListener('change', (event) => {
  if (event.target.dataset.field !== 'mode') return;
  const row = event.target.closest('.bucket');
  const bucket = bucketById(row?.dataset.id);
  if (!bucket) return;

  bucket.mode = MODES.includes(event.target.value) ? event.target.value : 'percent';
  applyMode(row, bucket);
  save();
  refresh();
});

fixedRows.addEventListener('input', (event) => {
  const field = event.target.dataset.field;
  const row = event.target.closest('.fixed-row');
  if (!field || !row) return;
  const item = fixedById(row.dataset.id);
  if (!item) return;

  if (field === 'amount') item.amount = Math.max(0, parseNum(event.target.value));
  else item[field] = event.target.value;

  save();
  if (field === 'amount') refresh();
});

fixedRows.addEventListener('change', (event) => {
  if (event.target.dataset.field !== 'freq') return;
  const item = fixedById(event.target.closest('.fixed-row')?.dataset.id);
  if (!item) return;
  item.freq = FREQ_FACTOR[event.target.value] ? event.target.value : 'monthly';
  save();
  refresh();
});

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  if (action === 'add-bucket') {
    state.buckets.push({
      id: newId(),
      name: '',
      note: '',
      mode: 'percent',
      value: 0,
      color: PALETTE[state.buckets.length % PALETTE.length],
    });
    save();
    renderRows();
    const last = bucketRows.lastElementChild;
    if (last) $('[data-field="name"]', last).focus();
  }

  if (action === 'remove-bucket') {
    const id = event.target.closest('.bucket')?.dataset.id;
    state.buckets = state.buckets.filter((b) => b.id !== id);
    save();
    renderRows();
  }

  if (action === 'add-fixed') {
    state.fixedCosts.push({ id: newId(), name: '', amount: 0, freq: 'monthly' });
    save();
    renderRows();
    const last = fixedRows.lastElementChild;
    if (last) $('[data-field="name"]', last).focus();
  }

  if (action === 'remove-fixed') {
    const id = event.target.closest('.fixed-row')?.dataset.id;
    state.fixedCosts = state.fixedCosts.filter((f) => f.id !== id);
    save();
    renderRows();
  }

  if (action === 'export') exportJson();
  if (action === 'import') $('#import-file').click();

  if (action === 'reset') {
    if (!confirm('Alle Konten und Fixkosten auf die Standardwerte zurücksetzen?')) return;
    state = normalize(DEFAULT_DATA);
    incomeInput.value = plain.format(state.income);
    save();
    renderRows();
  }
});

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kontenmodell.json';
  link.click();
  URL.revokeObjectURL(url);
}

$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    state = normalize(parsed);
    incomeInput.value = plain.format(state.income);
    save();
    renderRows();
  } catch (err) {
    alert('Die Datei konnte nicht gelesen werden – erwartet wird ein JSON-Export dieses Tools.');
    console.warn(err);
  }
});

renderRows();
