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
const WALLET_MODES = ['percent', 'fixed', 'rest'];

/* Sparplan-Käufe pro Monat je Intervall */
const INTERVAL_BUYS = {
  daily: 365 / 12,
  weekly: 52 / 12,
  monthly: 1,
};

const SATS_PER_BTC = 100_000_000;

/* Unterhalb dieser UTXO-Größe wird das Zusammenlegen später teuer. */
const MIN_UTXO_SATS = 3_000_000;

/* Ab diesem Bestand lohnt sich der Aufwand für Multisig. */
const MULTISIG_THRESHOLD = 100_000;

const PALETTE = [
  'var(--c-risiko)',
  'var(--c-fix)',
  'var(--c-lifestyle)',
  'var(--c-urlaub)',
  'var(--c-invest)',
  'var(--c-steuer)',
  'var(--c-spende)',
];

const WALLET_PALETTE = [
  'var(--c-hot)',
  'var(--c-cold)',
  'var(--c-coldpp)',
  'var(--c-multisig)',
];

const DEFAULT_DATA = {
  income: 3000,
  buckets: [
    { id: '6rshdhj', name: 'Fixkosten', note: 'Miete, Versicherungen, Abos', mode: 'linked', value: 0, color: 'var(--c-fix)' },
    { id: 'pnm45j3', name: 'Risikorücklage', note: 'Notgroschen (Zugang erschwert)', mode: 'percent', value: 10, color: 'var(--c-risiko)' },
    { id: '03tbe8u', name: 'Lifestyle', note: 'Einkaufen, Spaß · N26', mode: 'percent', value: 20, color: 'var(--c-lifestyle)' },
    { id: 'nmovvh1', name: 'Urlaub', note: 'Reisekasse', mode: 'percent', value: 5, color: 'var(--c-urlaub)' },
    { id: 'qr0ws1l', name: 'Investment', note: 'ETF / Sparplan', mode: 'percent', value: 15, color: 'var(--c-invest)' },
    { id: '1r2sdei', name: 'Steuerrücklage', note: 'für Nachzahlungen', mode: 'percent', value: 0, color: 'var(--c-steuer)' },
    { id: 'k7xd2pv', name: 'Spendenkonto', note: 'Spenden / Geben', mode: 'percent', value: 0, color: 'var(--c-spende)' },
  ],
  fixedCosts: [
    { id: 'slbhko3', name: 'Miete / Wohnen', amount: 900, freq: 'monthly' },
    { id: 'ljl2b3p', name: 'Netflix / Streaming', amount: 13.99, freq: 'monthly' },
    { id: '4cna1mu', name: 'Handyvertrag', amount: 25, freq: 'monthly' },
    { id: 'gpitw4b', name: 'Haftpflichtversicherung', amount: 80, freq: 'yearly' },
    { id: 'y8t8a8x', name: 'KFZ-Versicherung', amount: 600, freq: 'yearly' },
    { id: 'ebgp242', name: 'Strom', amount: 210, freq: 'quarterly' },
  ],
  bitcoin: {
    /* Sparrate: entweder aus einem Konto des Privatmodells oder manuell */
    source: 'qr0ws1l',
    rate: 100,
    interval: 'monthly',
    price: 100000,
    targetSats: 5_000_000,
    holdings: 10000,
    wallets: [
      { id: 'w1hotxx', name: 'Hot Wallet', note: 'Alltag, kleine Beträge – wie die Brieftasche', mode: 'fixed', value: 200, color: 'var(--c-hot)' },
      { id: 'w2coldx', name: 'Cold Wallet', note: 'Hardware-Wallet, Ziel des Sparplans', mode: 'percent', value: 20, color: 'var(--c-cold)' },
      { id: 'w3coldp', name: 'Cold + Passphrase', note: 'konsolidierte UTXOs, langfristig', mode: 'rest', value: 0, color: 'var(--c-coldpp)' },
      { id: 'w4multi', name: 'Multisig', note: 'optional, erst bei großen Beständen', mode: 'percent', value: 0, color: 'var(--c-multisig)' },
    ],
  },
};

/* Leerer Zustand: alles weg, nichts vorbelegt. */
const EMPTY_DATA = {
  income: 0,
  buckets: [],
  fixedCosts: [],
  bitcoin: {
    source: 'manual',
    rate: 0,
    interval: 'monthly',
    price: 0,
    targetSats: 5_000_000,
    holdings: 0,
    wallets: [],
  },
};

/* ---------- Hilfsfunktionen ---------- */

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const pct = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const ints = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const btcFmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 8, maximumFractionDigits: 8 });

const fmtEUR = (n) => eur.format(n || 0);
const fmtPct = (n) => `${pct.format(n || 0)} %`;
const fmtSats = (n) => `${ints.format(Math.round(n || 0))} sats`;
const fmtBTC = (n) => `${btcFmt.format(n || 0)} BTC`;

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
    buckets: buckets
      .map((b, i) => ({
        id: b?.id || newId(),
        name: String(b?.name ?? ''),
        note: String(b?.note ?? ''),
        mode: MODES.includes(b?.mode) ? b.mode : 'percent',
        value: Math.max(0, parseNum(b?.value)),
        color: b?.color || PALETTE[i % PALETTE.length],
      }))
      /* Das Fixkostenkonto steht vorn: Es trägt die Fixkostenliste und ist der
         Posten, an dem sich alles andere ausrichtet. Sort ist stabil, die
         übrige Reihenfolge bleibt also erhalten. */
      .sort((a, b) => (a.mode === 'linked' ? 0 : 1) - (b.mode === 'linked' ? 0 : 1)),
    fixedCosts: fixedCosts.map((f) => ({
      id: f?.id || newId(),
      name: String(f?.name ?? ''),
      amount: Math.max(0, parseNum(f?.amount)),
      freq: FREQ_FACTOR[f?.freq] ? f.freq : 'monthly',
    })),
    bitcoin: normalizeBitcoin(data.bitcoin),
  };
}

/* Ältere Exporte kennen den Bitcoin-Teil noch nicht – dann greifen die Vorgaben. */
function normalizeBitcoin(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const fallback = DEFAULT_DATA.bitcoin;
  /* Eine leere Liste ist eine Aussage – nur wenn gar keine da ist, greifen die
     Vorgaben (etwa bei Exporten aus einer älteren Fassung). */
  const wallets = Array.isArray(src.wallets) ? src.wallets : fallback.wallets;

  return {
    source: src.source === 'manual' || typeof src.source === 'string' ? src.source : fallback.source,
    rate: Math.max(0, parseNum(src.rate ?? fallback.rate)),
    interval: INTERVAL_BUYS[src.interval] ? src.interval : fallback.interval,
    price: Math.max(0, parseNum(src.price ?? fallback.price)),
    targetSats: Math.max(0, parseNum(src.targetSats ?? fallback.targetSats)),
    holdings: Math.max(0, parseNum(src.holdings ?? fallback.holdings)),
    wallets: wallets.map((w, i) => ({
      id: w?.id || newId(),
      name: String(w?.name ?? ''),
      note: String(w?.note ?? ''),
      mode: WALLET_MODES.includes(w?.mode) ? w.mode : 'percent',
      value: Math.max(0, parseNum(w?.value)),
      color: w?.color || WALLET_PALETTE[i % WALLET_PALETTE.length],
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
  const item = tplBucket.content.firstElementChild.cloneNode(true);
  const row = $('.row.bucket', item);
  item.dataset.id = bucket.id;
  row.dataset.id = bucket.id;
  $('[data-role="swatch"]', row).style.setProperty('--swatch', bucket.color);
  $('[data-field="name"]', row).value = bucket.name;
  $('[data-field="note"]', row).value = bucket.note;
  $('[data-field="mode"]', row).value = bucket.mode;
  applyMode(row, bucket);
  return item;
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
  renderBitcoinRows();
}

/* ---------- Fixkosten als Untermenü im Konto ---------- */

/* Der Fixkosten-Block ist ein einziger Knoten, der zwischen dem Konto im Modus
   „Fixkosten" und der Ersatzkarte hin- und herwandert. So bleiben Zustand und
   Ereignisbindungen erhalten – ein Neuaufbau würde beides verlieren. */

const FIXED_OPEN_KEY = 'kontenmodell.fixkosten-offen';

const fixedBlock = $('#fixed-block');
const fixedFallback = $('#fixed-fallback');
const fixedHost = $('#fixed-host');

let fixedOpen = false;
try {
  fixedOpen = localStorage.getItem(FIXED_OPEN_KEY) === '1';
} catch { /* ohne Speicher startet der Bereich zugeklappt */ }

/** Sucht die Zeile, in der der Fixkosten-Block hängen soll. */
function subPanelOf(bucketId) {
  for (const item of bucketRows.children) {
    if (item.dataset.id === bucketId) return $('[data-role="sub"]', item);
  }
  return null;
}

function placeFixedBlock() {
  const linked = state.buckets.find((b) => b.mode === 'linked');
  const host = (linked && subPanelOf(linked.id)) || null;

  /* Nur umhängen, wenn es wirklich nötig ist – ein Verschieben im DOM würde
     sonst bei jeder Eingabe den Fokus aus dem Feld reißen. */
  if (host) {
    if (fixedBlock.parentElement !== host) host.appendChild(fixedBlock);
    fixedFallback.hidden = true;
  } else {
    if (fixedBlock.parentElement !== fixedHost) fixedHost.appendChild(fixedBlock);
    fixedFallback.hidden = false;
  }

  for (const item of bucketRows.children) {
    const sub = $('[data-role="sub"]', item);
    $('.sub-toggle', item).hidden = sub !== host;
  }

  applyFixedOpen();
}

function applyFixedOpen() {
  for (const item of bucketRows.children) {
    const sub = $('[data-role="sub"]', item);
    const toggle = $('.sub-toggle', item);
    const offen = sub.contains(fixedBlock) && fixedOpen;

    sub.hidden = !offen;
    toggle.setAttribute('aria-expanded', String(offen));
    toggle.classList.toggle('open', offen);
    $('[data-role="sub-state"]', toggle).textContent = offen ? 'ausblenden' : 'anzeigen';
  }
}

function toggleFixed() {
  fixedOpen = !fixedOpen;
  try {
    localStorage.setItem(FIXED_OPEN_KEY, fixedOpen ? '1' : '0');
  } catch { /* ohne Speicher bleibt es bei dieser Sitzung */ }
  applyFixedOpen();
}

/* ---------- Berechnete Werte aktualisieren ---------- */

const bar = $('#bar');
const warning = $('[data-role="warning"]');

function refresh() {
  const result = compute();

  for (const row of bucketRows.querySelectorAll('.row.bucket')) {
    const amount = result.amounts.get(row.dataset.id) ?? 0;
    $('[data-role="monthly"]', row).textContent = fmtEUR(amount);
    $('[data-role="share"]', row).textContent =
      result.income > 0 ? fmtPct((amount / result.income) * 100) : '–';
    $('[data-role="yearly"]', row).textContent = fmtEUR(amount * 12);
  }

  const positionen = state.fixedCosts.length;
  for (const label of bucketRows.querySelectorAll('[data-role="sub-label"]')) {
    label.textContent =
      `${positionen} ${positionen === 1 ? 'Position' : 'Positionen'} · ${fmtEUR(result.fixedMonthly)} pro Monat`;
  }
  placeFixedBlock();

  for (const row of fixedRows.children) {
    const item = fixedById(row.dataset.id);
    $('[data-role="monthly"]', row).textContent = item ? fmtEUR(monthlyOf(item)) : '–';
  }

  $('[data-role="total-allocated"]').textContent = fmtEUR(result.allocated);
  $('[data-role="total-fixed"]').textContent = fmtEUR(result.fixedMonthly);
  $('[data-role="fixed-rate"]').textContent = fmtPct(result.fixedRate);
  $('[data-role="bucket-count"]').textContent = String(state.buckets.length);

  const over = result.rest < -0.005;
  const restLabel = $('[data-role="rest-label"]');
  const restValue = $('[data-role="total-rest"]');
  restLabel.textContent = over ? 'Überzogen' : 'Rest auf Hausbank';
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

/** Zeichnet einen gestapelten Balken aus { amount, color, label, faded }. */
function paintBar(el, parts, scale, over) {
  const segments = [];

  if (scale > 0) {
    for (const part of parts) {
      if (part.amount <= 0.005) continue;
      const seg = document.createElement('span');
      seg.style.width = `${(part.amount / scale) * 100}%`;
      seg.style.background = part.color;
      if (part.faded) seg.style.opacity = '.35';
      seg.title = `${part.label}: ${fmtEUR(part.amount)}`;
      segments.push(seg);
    }
  }

  el.replaceChildren(...segments);
  el.classList.toggle('over', Boolean(over));
}

/** Die Aufteilung als Liste – Grundlage für Balken, Torte und Geldfluss. */
function distributionParts(result) {
  const parts = state.buckets.map((b) => ({
    amount: result.amounts.get(b.id) ?? 0,
    color: b.color,
    label: b.name || 'Konto',
  }));

  parts.push({
    amount: result.rest,
    color: 'var(--c-rest)',
    label: 'Rest auf Hausbank',
    faded: true,
  });

  return parts;
}

function renderBar(result, over) {
  const parts = distributionParts(result);
  const scale = Math.max(result.income, result.allocated);

  paintBar(bar, parts, scale, over);
  renderDonut(parts, scale);
  renderFlow(result, over);
  if (walletRows.children.length) refreshBitcoin();
}

/* ---------- Torte ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const DONUT_R = 52;
const DONUT_C = 2 * Math.PI * DONUT_R;

const donutRing = $('[data-role="donut-ring"]');

/** Ein Ringabschnitt: sichtbarer Strich der Länge „anteil", davor „versatz". */
function donutSegment(part, anteil, versatz) {
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '60');
  circle.setAttribute('cy', '60');
  circle.setAttribute('r', String(DONUT_R));
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke-width', '15');
  circle.setAttribute('stroke-dasharray', `${anteil * DONUT_C} ${DONUT_C}`);
  circle.setAttribute('stroke-dashoffset', String(-versatz * DONUT_C));

  /* Über style, damit var(--c-…) sicher aufgelöst wird. */
  circle.style.stroke = part.color;
  if (part.faded) circle.style.opacity = '.35';

  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = part.amount > 0 ? `${part.label}: ${fmtEUR(part.amount)}` : part.label;
  circle.appendChild(title);

  return circle;
}

function renderDonut(parts, scale) {
  const segments = [];
  let versatz = 0;

  if (scale > 0) {
    for (const part of parts) {
      if (part.amount <= 0.005) continue;
      const anteil = Math.min(1, part.amount / scale);
      segments.push(donutSegment(part, anteil, versatz));
      versatz += anteil;
    }
  }

  if (!segments.length) {
    segments.push(donutSegment({ color: 'var(--surface-2)', label: 'noch nichts verteilt' }, 1, 0));
  }

  donutRing.replaceChildren(...segments);
  $('[data-role="donut-total"]').textContent = fmtEUR(scale);
}

/* ---------- Geldfluss ---------- */

/* Ab so vielen Konten wird die Fächer-Darstellung zu eng – dann untereinander. */
const FLOW_MAX_COLUMNS = 7;

const flowRoot = $('[data-role="moneyflow"]');
const flowTargets = $('[data-role="mf-targets"]');
const flowFan = $('.mf-fan');
const flowEmpty = $('[data-role="mf-empty"]');

function flowCard(bucket, amount, income) {
  const el = document.createElement('div');
  el.className = 'mf-target';
  el.style.setProperty('--tint', bucket.color);

  const name = document.createElement('span');
  name.className = 'mf-name';
  name.textContent = bucket.name || 'Konto';

  const value = document.createElement('strong');
  value.className = 'mf-amount';
  value.textContent = fmtEUR(amount);

  const share = document.createElement('span');
  share.className = 'mf-share';
  share.textContent = income > 0 ? fmtPct((amount / income) * 100) : '–';

  el.append(name, value, share);
  return el;
}

function renderFlow(result, over) {
  $('[data-role="mf-income"]').textContent = fmtEUR(result.income);
  $('[data-role="mf-hub-amount"]').textContent = fmtEUR(result.income);

  const note = $('[data-role="mf-hub-note"]');
  note.textContent = over
    ? `${fmtEUR(Math.abs(result.rest))} mehr verteilt als da ist`
    : `Puffer bleibt hier: ${fmtEUR(Math.max(0, result.rest))}`;
  note.classList.toggle('over', over);

  const cards = state.buckets.map((b) =>
    flowCard(b, result.amounts.get(b.id) ?? 0, result.income));

  flowTargets.replaceChildren(...cards);
  flowTargets.style.setProperty('--cols', String(Math.max(1, cards.length)));
  flowRoot.classList.toggle('stacked', cards.length > FLOW_MAX_COLUMNS);
  flowRoot.classList.toggle('empty', cards.length === 0);
  flowEmpty.hidden = cards.length > 0;

  measureRail();
}

/* Die Querlinie soll genau von der Mitte der ersten bis zur Mitte der letzten
   Karte laufen – das hängt an der tatsächlichen Breite, also wird gemessen. */
function measureRail() {
  const first = flowTargets.firstElementChild;
  const last = flowTargets.lastElementChild;
  if (!first || !last) return;

  const box = flowTargets.getBoundingClientRect();
  if (!box.width) return; /* Panel ausgeblendet – später erneut messen */

  const a = first.getBoundingClientRect();
  const b = last.getBoundingClientRect();
  flowFan.style.setProperty('--rail-left', `${a.left + a.width / 2 - box.left}px`);
  flowFan.style.setProperty('--rail-right', `${box.right - (b.left + b.width / 2)}px`);
}

if ('ResizeObserver' in window) {
  new ResizeObserver(measureRail).observe(flowTargets);
}

/* ============================ Bitcoin-Modell ============================ */

const walletRows = $('#wallet-rows');
const tplWallet = $('#tpl-wallet');
const btcBar = $('#btc-bar');

const btc = () => state.bitcoin;
const walletById = (id) => btc().wallets.find((w) => w.id === id);

/** Monatliche Sparrate: entweder aus einem Konto des Privatmodells oder manuell. */
function savingsRate() {
  const linked = bucketById(btc().source);
  if (!linked) return btc().rate;
  return compute().amounts.get(linked.id) ?? 0;
}

function computeBitcoin() {
  const cfg = btc();
  const rate = savingsRate();
  const buysPerMonth = INTERVAL_BUYS[cfg.interval] ?? 1;
  const perBuy = rate / buysPerMonth;
  const satsPerBuy = cfg.price > 0 ? (perBuy / cfg.price) * SATS_PER_BTC : 0;

  const buysToTarget = satsPerBuy > 0 ? Math.ceil(cfg.targetSats / satsPerBuy) : Infinity;
  const monthsToTarget = Number.isFinite(buysToTarget) ? buysToTarget / buysPerMonth : Infinity;

  /* Aufteilung des Bestands auf die Wallets – wie im Privatmodell, ohne "Fixkosten". */
  const amounts = new Map();
  let assigned = 0;

  for (const w of cfg.wallets) {
    if (w.mode === 'rest') continue;
    const amount = w.mode === 'percent' ? (cfg.holdings * w.value) / 100 : w.value;
    amounts.set(w.id, amount);
    assigned += amount;
  }

  const restWallets = cfg.wallets.filter((w) => w.mode === 'rest');
  if (restWallets.length) {
    const share = Math.max(0, cfg.holdings - assigned) / restWallets.length;
    for (const w of restWallets) {
      amounts.set(w.id, share);
      assigned += share;
    }
  }

  return {
    rate,
    perBuy,
    satsPerBuy,
    buysPerMonth,
    buysToTarget,
    monthsToTarget,
    targetEur: (cfg.targetSats / SATS_PER_BTC) * cfg.price,
    holdingsBtc: cfg.price > 0 ? cfg.holdings / cfg.price : 0,
    amounts,
    assigned,
    rest: cfg.holdings - assigned,
  };
}

function applyWalletMode(row, wallet) {
  const input = $('[data-field="value"]', row);
  const unit = $('[data-role="value-unit"]', row);
  const derived = wallet.mode === 'rest';

  input.disabled = derived;
  input.value = derived ? '' : plain.format(wallet.value);
  input.placeholder = derived ? 'Rest' : '';
  unit.textContent = wallet.mode === 'percent' ? '%' : wallet.mode === 'fixed' ? '€' : '';
}

function buildWalletRow(wallet) {
  const row = tplWallet.content.firstElementChild.cloneNode(true);
  row.dataset.id = wallet.id;
  $('[data-role="swatch"]', row).style.setProperty('--swatch', wallet.color);
  $('[data-field="name"]', row).value = wallet.name;
  $('[data-field="note"]', row).value = wallet.note;
  $('[data-field="mode"]', row).value = wallet.mode;
  applyWalletMode(row, wallet);
  return row;
}

/** Auswahlliste für die Herkunft der Sparrate neu aufbauen. */
function renderSourceOptions() {
  const select = $('#btc-source');
  const options = state.buckets.map((b) => {
    const option = document.createElement('option');
    option.value = b.id;
    option.textContent = `aus „${b.name || 'Konto'}“`;
    return option;
  });

  const manual = document.createElement('option');
  manual.value = 'manual';
  manual.textContent = 'manuell';
  options.push(manual);

  select.replaceChildren(...options);
  select.value = bucketById(btc().source) ? btc().source : 'manual';
  if (select.value === 'manual') btc().source = 'manual';
}

function renderBitcoinRows() {
  walletRows.replaceChildren(...btc().wallets.map(buildWalletRow));
  renderSourceOptions();

  const cfg = btc();
  $('#btc-interval').value = cfg.interval;
  $('#btc-price').value = plain.format(cfg.price);
  $('#btc-target').value = ints.format(cfg.targetSats);
  $('#btc-holdings').value = plain.format(cfg.holdings);
  refreshBitcoin();
}

function refreshBitcoin() {
  const cfg = btc();
  const result = computeBitcoin();
  const linked = Boolean(bucketById(cfg.source));

  const rateInput = $('#btc-rate');
  rateInput.disabled = linked;
  if (linked || document.activeElement !== rateInput) {
    rateInput.value = plain.format(linked ? result.rate : cfg.rate);
  }

  $('[data-role="btc-per-buy"]').textContent = fmtEUR(result.perBuy);
  $('[data-role="btc-sats-buy"]').textContent = fmtSats(result.satsPerBuy);
  $('[data-role="btc-target-eur"]').textContent = fmtEUR(result.targetEur);
  $('[data-role="btc-buys"]').textContent =
    Number.isFinite(result.buysToTarget) ? ints.format(result.buysToTarget) : '–';
  $('[data-role="btc-months"]').textContent =
    Number.isFinite(result.monthsToTarget) ? `${pct.format(result.monthsToTarget)} Monate` : '–';
  $('[data-role="btc-holdings-btc"]').textContent = fmtBTC(result.holdingsBtc);

  $('[data-role="btc-utxo-hint"]').textContent = utxoHint(result);

  for (const row of walletRows.children) {
    const amount = result.amounts.get(row.dataset.id) ?? 0;
    $('[data-role="amount"]', row).textContent = fmtEUR(amount);
    $('[data-role="share"]', row).textContent =
      cfg.holdings > 0 ? fmtPct((amount / cfg.holdings) * 100) : '–';
  }

  const over = result.rest < -0.005;
  const walletWarning = $('[data-role="btc-wallet-warning"]');
  walletWarning.hidden = !over;
  walletWarning.className = 'hint warn';
  if (over) {
    walletWarning.textContent =
      `Die Wallets fassen ${fmtEUR(Math.abs(result.rest))} mehr, als der Bestand hergibt.`;
  }

  $('[data-role="btc-multisig-hint"]').textContent =
    cfg.holdings >= MULTISIG_THRESHOLD
      ? `Ab etwa ${fmtEUR(MULTISIG_THRESHOLD)} lohnt es sich, Multisig zu prüfen – mit dem Aufwand, den die Einrichtung und die Nachlassplanung mit sich bringen.`
      : `Unter etwa ${fmtEUR(MULTISIG_THRESHOLD)} ist Multisig meist mehr Aufwand als Nutzen; Cold Wallet mit Passphrase reicht.`;

  const parts = cfg.wallets.map((w) => ({
    amount: result.amounts.get(w.id) ?? 0,
    color: w.color,
    label: w.name || 'Wallet',
  }));
  parts.push({ amount: result.rest, color: 'var(--c-rest)', label: 'nicht zugeteilt', faded: true });

  paintBar(btcBar, parts, Math.max(cfg.holdings, result.assigned), over);
}

function utxoHint(result) {
  if (!(result.satsPerBuy > 0)) {
    return 'Trage Sparrate und Bitcoin-Kurs ein, um die UTXO-Größe abzuschätzen.';
  }
  if (result.satsPerBuy >= btc().targetSats) {
    return 'Jeder einzelne Kauf erreicht bereits die Zielgröße – die UTXOs müssen später nicht zusammengelegt werden.';
  }

  const months = pct.format(result.monthsToTarget);
  const small = result.satsPerBuy < MIN_UTXO_SATS;
  const base =
    `Ein Kauf liefert ${fmtSats(result.satsPerBuy)}. Nach ${ints.format(result.buysToTarget)} Käufen ` +
    `(rund ${months} Monate) ist die Zielgröße erreicht – dann konsolidiert in die Passphrase-Wallet schicken.`;

  return small
    ? `${base} Einzeln bleiben die Beträge unter ${fmtSats(MIN_UTXO_SATS)}, was das spätere Ausgeben teuer macht.`
    : base;
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
  if (field === 'name') renderSourceOptions();
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

/* ---------- Ereignisse im Bitcoin-Tab ---------- */

/* Zahlenfeld → Feld im Bitcoin-Zustand */
const BTC_INPUTS = {
  'btc-rate': 'rate',
  'btc-price': 'price',
  'btc-target': 'targetSats',
  'btc-holdings': 'holdings',
};

for (const [id, key] of Object.entries(BTC_INPUTS)) {
  const input = $(`#${id}`);
  input.addEventListener('input', () => {
    btc()[key] = Math.max(0, parseNum(input.value));
    save();
    refreshBitcoin();
  });
  input.addEventListener('blur', () => {
    const value = btc()[key];
    input.value = key === 'targetSats' ? ints.format(value) : plain.format(value);
  });
}

$('#btc-source').addEventListener('change', (event) => {
  btc().source = event.target.value;
  save();
  refreshBitcoin();
});

$('#btc-interval').addEventListener('change', (event) => {
  btc().interval = INTERVAL_BUYS[event.target.value] ? event.target.value : 'monthly';
  save();
  refreshBitcoin();
});

walletRows.addEventListener('input', (event) => {
  const field = event.target.dataset.field;
  const wallet = walletById(event.target.closest('.wallet')?.dataset.id);
  if (!field || !wallet) return;

  if (field === 'value') wallet.value = Math.max(0, parseNum(event.target.value));
  else wallet[field] = event.target.value;

  save();
  if (field === 'value') refreshBitcoin();
});

walletRows.addEventListener('change', (event) => {
  if (event.target.dataset.field !== 'mode') return;
  const row = event.target.closest('.wallet');
  const wallet = walletById(row?.dataset.id);
  if (!wallet) return;

  wallet.mode = WALLET_MODES.includes(event.target.value) ? event.target.value : 'percent';
  applyWalletMode(row, wallet);
  save();
  refreshBitcoin();
});

/* ---------- Tabs ---------- */

const TAB_KEY = 'kontenmodell.tab';
const TABS = ['privat', 'bitcoin', 'hilfe'];

function showTab(name) {
  const target = TABS.includes(name) ? name : 'privat';

  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === target));
  }
  for (const panel of document.querySelectorAll('.panel')) {
    panel.hidden = panel.dataset.panel !== target;
  }

  /* Im ausgeblendeten Panel ist nichts messbar – jetzt schon. */
  if (target === 'privat') measureRail();

  try {
    localStorage.setItem(TAB_KEY, target);
  } catch { /* ohne Speicher läuft die Seite trotzdem */ }
}

document.querySelector('.tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) showTab(tab.dataset.tab);
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
    if (!darfLoeschen('Konto', bucketById(id))) return;
    state.buckets = state.buckets.filter((b) => b.id !== id);
    save();
    renderRows();
  }

  if (action === 'add-wallet') {
    btc().wallets.push({
      id: newId(),
      name: '',
      note: '',
      mode: 'percent',
      value: 0,
      color: WALLET_PALETTE[btc().wallets.length % WALLET_PALETTE.length],
    });
    save();
    renderBitcoinRows();
    const last = walletRows.lastElementChild;
    if (last) $('[data-field="name"]', last).focus();
  }

  if (action === 'remove-wallet') {
    const id = event.target.closest('.wallet')?.dataset.id;
    if (!darfLoeschen('Wallet', walletById(id))) return;
    btc().wallets = btc().wallets.filter((w) => w.id !== id);
    save();
    renderBitcoinRows();
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
    if (!darfLoeschen('Position', fixedById(id))) return;
    state.fixedCosts = state.fixedCosts.filter((f) => f.id !== id);
    save();
    renderRows();
  }

  if (action === 'toggle-fixed') toggleFixed();
  if (action === 'print') printReport();
  if (action === 'csv') exportCsv();

  if (action === 'goto-help') {
    showTab('hilfe');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (action === 'export') exportJson();
  if (action === 'import') $('#import-file').click();

  if (action === 'backup-create') {
    setBackupMode('pin');
    backupDialog.showModal();
    backupSecret.focus();
  }
  if (action === 'backup-save') saveBackup();

  if (action === 'backup-restore') {
    resetRestoreDialog();
    restoreDialog.showModal();
  }
  if (action === 'explain-backup') $('#dlg-datenhilfe').showModal();
  if (action === 'pick-backup') $('#restore-file').click();
  if (action === 'restore-apply') restoreBackup();
  if (action === 'close-dialog') event.target.closest('dialog')?.close();

  if (action === 'install-app') installApp();
  if (action === 'install-dismiss') dismissInstall();

  if (action === 'clear-all') clearAll();
  if (action === 'check-update') checkForUpdate();
  if (action === 'apply-update') applyUpdate();
  if (action === 'update-dismiss') updateBanner.hidden = true;

  if (action === 'reset') {
    if (!confirm('Konten, Fixkosten und Bitcoin-Modell auf die Standardwerte zurücksetzen?')) return;
    state = normalize(DEFAULT_DATA);
    incomeInput.value = plain.format(state.income);
    save();
    renderRows();
    toast('Standardwerte wiederhergestellt.');
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

/* ============================ Verschlüsseltes Backup ============================
 *
 * Schlüsselableitung: PBKDF2-SHA256, 200.000 Runden, fester App-Salt.
 * Verschlüsselung:    AES-GCM-256 mit zufälligem 96-Bit-IV je Datei.
 *
 * Derselbe PIN erzeugt reproduzierbar denselben Schlüssel – die Datei lässt
 * sich also auf jedem Gerät wieder öffnen. Der Salt darf öffentlich sein, er
 * muss nur gleich bleiben. Gespeichert wird der PIN nirgends.
 */

const BACKUP_MAGIC = 'KM-BACKUP-1';
const BACKUP_VERSION = 1;
const APP_SALT = 'kontenmodell-backup-2026-v1';
const PBKDF2_ITERATIONS = 200_000;
const IV_BYTES = 12;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(secret) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: textEncoder.encode(APP_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Zählt nur Positionen – Beträge stehen ausschließlich im verschlüsselten Teil. */
const summarize = (data) => ({
  bucketCount: data.buckets.length,
  fixedCostCount: data.fixedCosts.length,
  walletCount: data.bitcoin.wallets.length,
});

async function createBackup(secret, mode, data) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(JSON.stringify(data)),
  );

  return {
    magic: BACKUP_MAGIC,
    v: BACKUP_VERSION,
    mode,
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    lastModified: new Date().toISOString(),
    summary: summarize(data),
  };
}

async function decryptBackup(secret, file) {
  const key = await deriveKey(secret);
  let plain;

  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(file.iv) },
      key,
      fromBase64(file.ciphertext),
    );
  } catch {
    throw new Error(`Falscher ${file.mode === 'password' ? 'Passwort' : 'PIN'} oder beschädigte Datei.`);
  }

  try {
    return JSON.parse(textDecoder.decode(plain));
  } catch {
    throw new Error('Die entschlüsselten Daten sind unlesbar.');
  }
}

const isBackupFile = (value) =>
  Boolean(value) &&
  typeof value === 'object' &&
  value.magic === BACKUP_MAGIC &&
  typeof value.iv === 'string' &&
  typeof value.ciphertext === 'string';

/** Erkennt sowohl verschlüsselte Backups als auch den einfachen JSON-Export. */
async function parseAnyBackup(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }

  if (isBackupFile(parsed)) return { kind: 'encrypted', file: parsed };

  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.buckets)) {
    const data = normalize(parsed);
    return {
      kind: 'plain',
      data,
      summary: summarize(data),
      lastModified: null,
    };
  }

  throw new Error('Diese Datei sieht nicht nach einem Kontenmodell-Backup aus.');
}

/** Dateiname im Stil Kontenmodell_20260730_1830_MESZ_AES256.json */
function backupFilename(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}`;

  let zone = 'LOCAL';
  try {
    const parts = new Intl.DateTimeFormat('de-DE', { timeZoneName: 'short' }).formatToParts(d);
    const found = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (found) zone = found.replace(/[^A-Za-z]/g, '');
  } catch { /* Fallback bleibt LOCAL */ }

  return `Kontenmodell_${day}_${time}_${zone}_AES256.json`;
}

function downloadJson(content, filename) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/* ---------- Dialog „Backup einrichten" ---------- */

const backupDialog = $('#dlg-backup');
const backupSecret = $('#backup-secret');
const backupConfirm = $('#backup-confirm');
const backupError = $('[data-role="backup-error"]');

let backupMode = 'pin';

const secretRules = {
  pin: { test: (v) => /^\d{4,}$/.test(v), label: 'PIN (mindestens 4 Ziffern)', hint: 'Der PIN muss aus mindestens 4 Ziffern bestehen.' },
  password: { test: (v) => v.length >= 8, label: 'Passwort (mindestens 8 Zeichen)', hint: 'Das Passwort muss mindestens 8 Zeichen haben.' },
};

function setBackupMode(mode) {
  backupMode = secretRules[mode] ? mode : 'pin';

  for (const option of backupDialog.querySelectorAll('.choice-option')) {
    option.setAttribute('aria-pressed', String(option.dataset.mode === backupMode));
  }

  $('[data-role="secret-label"]', backupDialog).textContent = secretRules[backupMode].label;
  backupSecret.placeholder = backupMode === 'pin' ? 'z. B. 1234' : 'z. B. ein-langes-passwort-2026';
  for (const input of [backupSecret, backupConfirm]) {
    input.inputMode = backupMode === 'pin' ? 'numeric' : 'text';
    input.value = '';
  }
  backupError.hidden = true;
}

backupDialog.addEventListener('click', (event) => {
  const mode = event.target.closest('.choice-option')?.dataset.mode;
  if (mode) setBackupMode(mode);
});

async function saveBackup() {
  const secret = backupSecret.value;
  const rule = secretRules[backupMode];

  const problem =
    !rule.test(secret) ? rule.hint :
    secret !== backupConfirm.value ? 'Die beiden Eingaben stimmen nicht überein.' :
    null;

  if (problem) {
    backupError.textContent = problem;
    backupError.hidden = false;
    return;
  }

  backupError.hidden = true;
  const button = $('[data-action="backup-save"]', backupDialog);
  button.disabled = true;
  button.textContent = 'Verschlüssele …';

  try {
    const file = await createBackup(secret, backupMode, state);
    downloadJson(file, backupFilename(file.lastModified));
    backupSecret.value = '';
    backupConfirm.value = '';
    backupDialog.close();
  } catch (err) {
    backupError.textContent = 'Das Backup konnte nicht erstellt werden.';
    backupError.hidden = false;
    console.warn(err);
  } finally {
    button.disabled = false;
    button.textContent = 'Backup-Datei speichern';
  }
}

/* ---------- Dialog „Backup laden" ---------- */

const restoreDialog = $('#dlg-restore');
const restoreSecret = $('#restore-secret');
const restoreError = $('[data-role="restore-error"]');
const restoreApply = $('[data-action="restore-apply"]', restoreDialog);

let pendingBackup = null;

function resetRestoreDialog() {
  pendingBackup = null;
  restoreSecret.value = '';
  restoreError.hidden = true;
  restoreApply.disabled = true;
  $('[data-role="restore-filename"]').textContent = 'Datei auswählen';
  $('[data-role="restore-compare"]').hidden = true;
  $('[data-role="restore-age"]').hidden = true;
  $('[data-role="restore-secret-field"]').hidden = true;
}

function describeContent(summary) {
  return `${summary.bucketCount} Konten · ${summary.fixedCostCount} Fixkosten · ${summary.walletCount} Wallets`;
}

async function pickBackupFile(file) {
  resetRestoreDialog();
  $('[data-role="restore-filename"]').textContent = file.name;

  try {
    pendingBackup = await parseAnyBackup(file);
  } catch (err) {
    restoreError.textContent = err.message;
    restoreError.hidden = false;
    return;
  }

  const encrypted = pendingBackup.kind === 'encrypted';
  const summary = encrypted ? pendingBackup.file.summary : pendingBackup.summary;
  const stamp = encrypted ? pendingBackup.file.lastModified : pendingBackup.lastModified;

  $('[data-role="restore-date"]').textContent = stamp
    ? new Date(stamp).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
    : 'unbekannt';
  $('[data-role="restore-content"]').textContent = summary ? describeContent(summary) : 'unbekannt';
  $('[data-role="restore-encrypted"]').textContent = encrypted
    ? `ja – ${pendingBackup.file.mode === 'password' ? 'Passwort' : 'PIN'} nötig`
    : 'nein (einfacher JSON-Export)';
  $('[data-role="restore-compare"]').hidden = false;

  const age = $('[data-role="restore-age"]');
  age.textContent = 'Beim Wiederherstellen wird der aktuelle Stand vollständig ersetzt.';
  age.hidden = false;

  const field = $('[data-role="restore-secret-field"]');
  field.hidden = !encrypted;
  if (encrypted) {
    const isPin = pendingBackup.file.mode !== 'password';
    $('[data-role="restore-secret-label"]').textContent = isPin ? 'PIN' : 'Passwort';
    restoreSecret.inputMode = isPin ? 'numeric' : 'text';
    restoreSecret.focus();
  }

  restoreApply.disabled = false;
}

function applyRestoredData(data) {
  state = normalize(data);
  incomeInput.value = plain.format(state.income);
  save();
  renderRows();
}

async function restoreBackup() {
  if (!pendingBackup) return;

  restoreError.hidden = true;
  restoreApply.disabled = true;
  restoreApply.textContent = 'Entschlüssele …';

  try {
    const data =
      pendingBackup.kind === 'encrypted'
        ? await decryptBackup(restoreSecret.value, pendingBackup.file)
        : pendingBackup.data;

    applyRestoredData(data);
    resetRestoreDialog();
    restoreDialog.close();
  } catch (err) {
    restoreError.textContent = err.message;
    restoreError.hidden = false;
    restoreApply.disabled = false;
  } finally {
    restoreApply.textContent = 'Wiederherstellen';
  }
}

$('#restore-file').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) pickBackupFile(file);
});

restoreSecret.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') restoreBackup();
});

/* ---------- Kurze Rückmeldung ---------- */

const toastEl = $('#toast');
let toastTimer = null;

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
}

/* ---------- Einzelne Zeilen löschen ---------- */

/** Eine gerade angelegte, noch leere Zeile fragt nicht nach – da geht nichts verloren. */
const istLeer = (item) =>
  !String(item.name ?? '').trim() &&
  !String(item.note ?? '').trim() &&
  !(item.value || item.amount);

function darfLoeschen(art, item) {
  if (!item || istLeer(item)) return true;
  const name = String(item.name ?? '').trim();
  return confirm(name ? `${art} „${name}" wirklich löschen?` : `${art} wirklich löschen?`);
}

/* ---------- Alles löschen ---------- */

function clearAll() {
  if (!confirm(
    'Alles löschen?\n\nKonten, Fixkosten und Wallets werden vollständig geleert – ' +
    'du startest mit einer leeren App.\n\nHast du vorher ein Backup gespeichert?',
  )) return;

  if (!confirm('Wirklich löschen? Das lässt sich nicht rückgängig machen.')) return;

  state = normalize(EMPTY_DATA);
  incomeInput.value = '';

  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('kontenmodell.')) localStorage.removeItem(key);
    }
  } catch { /* ohne Speicher bleibt nur der Zustand im Fenster */ }

  save();
  renderRows();
  toast('🧹 Alles gelöscht – lege neue Konten an oder lade ein Backup.');
}

/* ============================ App installieren ============================ */

const INSTALL_KEY = 'kontenmodell.install-dismissed';
const INSTALL_PAUSE = 7 * 24 * 60 * 60 * 1000;

const installBanner = $('#install-banner');
let installPrompt = null;

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function recentlyDismissed() {
  try {
    const stamp = Number(localStorage.getItem(INSTALL_KEY));
    return Boolean(stamp) && Date.now() - stamp < INSTALL_PAUSE;
  } catch {
    return false;
  }
}

function setupInstallPrompt() {
  if (isInstalled() || recentlyDismissed()) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    installBanner.hidden = false;
  });

  /* iOS kennt beforeinstallprompt nicht – dort hilft nur die Anleitung. */
  if (isIos()) setTimeout(() => { installBanner.hidden = false; }, 3000);

  window.addEventListener('appinstalled', () => { installBanner.hidden = true; });
}

async function installApp() {
  if (isIos() || !installPrompt) {
    $('[data-role="install-title"]').textContent = 'Auf dem iPhone hinzufügen';
    $('[data-role="install-text"]').hidden = true;
    $('[data-role="install-steps"]').hidden = false;
    $('[data-action="install-app"]').hidden = true;
    return;
  }

  await installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  installPrompt = null;
  if (choice.outcome === 'accepted') installBanner.hidden = true;
}

function dismissInstall() {
  installBanner.hidden = true;
  try {
    localStorage.setItem(INSTALL_KEY, String(Date.now()));
  } catch { /* ohne Speicher erscheint der Hinweis beim nächsten Mal wieder */ }
}

/* ============================ Neue Version laden ============================
 *
 * Der Service Worker installiert eine neue Fassung, aktiviert sie aber erst auf
 * Zuruf. Ein Tippen auf das Icon oben links sucht sofort nach einer neuen
 * Fassung; wartet schon eine, erscheint der Hinweis von selbst.
 */

const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;

const updateBanner = $('#update-banner');
const updateBadge = $('[data-role="update-badge"]');
const updateStatus = $('[data-role="update-status"]');

let statusTimer = null;

/** Kurzer Zustand am Icon. Ohne "bleibt" verschwindet er nach ein paar Sekunden. */
function setUpdateStatus(text, { tone = '', bleibt = false } = {}) {
  clearTimeout(statusTimer);

  if (!text) {
    updateStatus.hidden = true;
    return;
  }

  updateStatus.textContent = text;
  updateStatus.className = `brand-status ${tone}`.trim();
  updateStatus.hidden = false;

  if (!bleibt) statusTimer = setTimeout(() => { updateStatus.hidden = true; }, 5000);
}

let swRegistration = null;
let waitingWorker = null;

function announceUpdate(worker) {
  waitingWorker = worker;
  updateBadge.hidden = false;
  updateBanner.hidden = false;
  setUpdateStatus('Update bereit', { tone: 'ready', bleibt: true });
}

function watchRegistration(registration) {
  swRegistration = registration;

  if (registration.waiting && navigator.serviceWorker.controller) {
    announceUpdate(registration.waiting);
  }

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      /* Ein Controller bedeutet: Die App lief schon – es ist ein Update,
         keine Erstinstallation. */
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        announceUpdate(worker);
      }
    });
  });

  setInterval(() => registration.update().catch(() => {}), UPDATE_CHECK_INTERVAL);
}

/* Der Service Worker macht die App offline nutzbar – über file:// gibt es ihn
   nicht, dort bleibt es bei der normalen Seite. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .then(watchRegistration)
      .catch((err) => console.warn('Service Worker nicht registriert:', err));
  });
}

function applyUpdate() {
  if (waitingWorker) {
    /* Der Neustart passiert über controllerchange. */
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    updateBanner.hidden = true;
    setUpdateStatus('aktualisiere …', { bleibt: true });
  } else {
    location.reload();
  }
}

async function checkForUpdate() {
  if (waitingWorker) {
    applyUpdate();
    return;
  }

  if (!swRegistration) {
    setUpdateStatus('offline-Betrieb aus', { tone: 'problem' });
    toast('Updates gibt es nur, wenn die App über eine Webadresse läuft.');
    return;
  }

  setUpdateStatus('sucht …', { bleibt: true });
  try {
    await swRegistration.update();
  } catch {
    setUpdateStatus('keine Verbindung', { tone: 'problem' });
    return;
  }

  if (swRegistration.installing || swRegistration.waiting) {
    setUpdateStatus('lädt neue Version …', { tone: 'ready', bleibt: true });
  } else {
    setUpdateStatus('aktuell ✓');
  }
}

/* ============================ Kennung der Fassung ============================
 *
 * Die App wird ohne Build-Schritt ausgeliefert, es gibt also keine eingebaute
 * Versionsnummer. Stattdessen fragen wir den Server nach dem ETag von app.js –
 * der ändert sich bei jedem Deploy und taugt damit als Kennung, etwa um auf
 * einem Screenshot zu erkennen, welche Fassung läuft.
 */

async function showBuildId() {
  const el = $('[data-role="build-id"]');

  /* Ohne Server gibt es nichts zu fragen – und der Versuch landete sonst als
     Fehler in der Konsole. */
  if (location.protocol === 'file:') return;

  try {
    const res = await fetch('app.js', { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return;

    const etag = (res.headers.get('etag') || '').replace(/[^A-Za-z0-9]/g, '');
    const stand = res.headers.get('last-modified');
    const kennung = etag ? etag.slice(-7) : stand ? new Date(stand).toISOString().slice(0, 10) : '';
    if (!kennung) return;

    el.textContent = `#${kennung}`;
    el.title = [
      `Fassung: ${etag || stand}`,
      res.headers.get('x-vercel-id') && `Vercel: ${res.headers.get('x-vercel-id')}`,
    ]
      .filter(Boolean)
      .join('\n');
    el.hidden = false;
  } catch {
    /* Offline oder ohne Server – dann bleibt die Kennung eben aus. */
  }
}

/* ============================ Bericht drucken ============================
 *
 * Gedruckt wird nicht der Bildschirm, sondern ein eigenes Blatt: Eingabefelder
 * und Schaltflächen ergeben auf Papier keinen Sinn. Es wird unmittelbar vor
 * dem Druck aus dem aktuellen Stand aufgebaut.
 */

const MODE_LABEL = {
  percent: 'Prozent',
  fixed: 'Fester Betrag',
  linked: 'Fixkosten',
  rest: 'Rest',
};

const FREQ_LABEL = {
  monthly: 'monatlich',
  quarterly: 'quartalsweise',
  halfyearly: 'halbjährlich',
  yearly: 'jährlich',
};

const INTERVAL_LABEL = {
  daily: 'täglich',
  weekly: 'wöchentlich',
  monthly: 'monatlich',
};

const printSheet = $('#print-sheet');

/** Kleiner Baustein: Element mit Klasse und Text. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Tabelle aus Kopfzeile und Zeilen; Zellen mit führendem "#" werden rechtsbündig. */
function reportTable(head, rows) {
  const table = el('table', 'report-table');

  const thead = el('thead');
  const headRow = el('tr');
  for (const label of head) {
    const th = el('th', label.startsWith('#') ? 'num' : '', label.replace(/^#/, ''));
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = el('tbody');
  for (const cells of rows) {
    const tr = el('tr');
    cells.forEach((cell, i) => {
      const td = el('td', head[i].startsWith('#') ? 'num' : '');
      if (cell instanceof Node) td.appendChild(cell);
      else td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  table.append(thead, tbody);
  return table;
}

/** Kontoname mit Farbbalken – auf Papier bleibt die Zuordnung zum Balken erkennbar. */
function namePlate(bucket) {
  const wrap = el('span', 'report-name');
  const dot = el('span', 'report-dot');
  dot.style.background = bucket.color;
  wrap.append(dot, document.createTextNode(bucket.name || 'Konto'));
  return wrap;
}

/** Anteil als Zahl mit kleinem Balken dahinter – liest sich schneller als Prozente. */
function shareCell(amount, basis, color) {
  const wrap = el('span', 'report-share');
  wrap.appendChild(el('span', null, basis > 0 ? fmtPct((amount / basis) * 100) : '–'));

  const track = el('span', 'report-share-track');
  const fill = el('span', 'report-share-fill');
  fill.style.width = `${basis > 0 ? Math.min(100, Math.max(0, (amount / basis) * 100)) : 0}%`;
  fill.style.background = color;
  track.appendChild(fill);
  wrap.appendChild(track);

  return wrap;
}

function reportSection(title, note) {
  const section = el('section', 'report-section');
  section.appendChild(el('h2', null, title));
  if (note) section.appendChild(el('p', 'report-note', note));
  return section;
}

function bucketValueLabel(bucket) {
  if (bucket.mode === 'percent') return fmtPct(bucket.value);
  if (bucket.mode === 'fixed') return fmtEUR(bucket.value);
  if (bucket.mode === 'linked') return 'aus Fixkosten';
  return 'Rest';
}

function buildReport() {
  const result = compute();
  const over = result.rest < -0.005;
  const scale = Math.max(result.income, result.allocated);
  const parts = [];

  /* ---- Kopf ---- */
  const head = el('header', 'report-head');
  head.appendChild(el('h1', null, 'Kontenmodell'));
  head.appendChild(el('p', 'report-note',
    `Bericht vom ${new Date().toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' })}`));
  parts.push(head);

  /* ---- Kennzahlen ---- */
  const kennzahlen = [
    ['Monatliches Nettoeinkommen', fmtEUR(result.income)],
    ['Zugeteilt', fmtEUR(result.allocated)],
    ['Fixkosten pro Monat', fmtEUR(result.fixedMonthly)],
    [over ? 'Überzogen' : 'Rest auf Hausbank', fmtEUR(Math.abs(result.rest))],
    ['Fixkostenquote', fmtPct(result.fixedRate)],
    ['Konten', String(state.buckets.length)],
  ];

  const totals = el('dl', 'report-totals');
  for (const [label, value] of kennzahlen) {
    const box = el('div');
    box.append(el('dt', null, label), el('dd', null, value));
    totals.appendChild(box);
  }
  parts.push(totals);

  const bar = el('div', 'bar report-bar');
  paintBar(bar, distributionParts(result), scale, over);
  parts.push(bar);

  if (over) {
    parts.push(el('p', 'report-warn',
      `Die Konten fordern ${fmtEUR(Math.abs(result.rest))} mehr, als das Einkommen hergibt.`));
  }

  /* ---- Konten ---- */
  const konten = reportSection('Konten');
  konten.appendChild(reportTable(
    ['Konto', 'Zweck', 'Modus', '#Wert', '#pro Monat', '#Anteil', '#pro Jahr'],
    state.buckets.map((b) => {
      const amount = result.amounts.get(b.id) ?? 0;
      return [
        namePlate(b),
        b.note || '',
        MODE_LABEL[b.mode] ?? b.mode,
        bucketValueLabel(b),
        fmtEUR(amount),
        shareCell(amount, result.income, b.color),
        fmtEUR(amount * 12),
      ];
    }),
  ));
  parts.push(konten);

  /* ---- Fixkosten ---- */
  const fixkosten = reportSection('Fixkosten',
    'Quartals-, Halbjahres- und Jahresbeträge sind auf den Monat umgerechnet.');
  fixkosten.appendChild(reportTable(
    ['Position', '#Betrag', 'Turnus', '#pro Monat', '#pro Jahr'],
    state.fixedCosts.map((f) => [
      f.name || 'Position',
      fmtEUR(f.amount),
      FREQ_LABEL[f.freq] ?? f.freq,
      fmtEUR(monthlyOf(f)),
      fmtEUR(monthlyOf(f) * 12),
    ]),
  ));
  fixkosten.appendChild(el('p', 'report-sum',
    `Summe: ${fmtEUR(result.fixedMonthly)} pro Monat · ${fmtEUR(result.fixedMonthly * 12)} pro Jahr`));
  parts.push(fixkosten);

  /* ---- Bitcoin ---- */
  const cfg = btc();
  if (cfg.wallets.length || cfg.holdings > 0) {
    const btcResult = computeBitcoin();
    const bitcoin = reportSection('Bitcoin');

    const zahlen = el('dl', 'report-totals');
    for (const [label, value] of [
      ['Sparrate pro Monat', fmtEUR(btcResult.rate)],
      ['Intervall', INTERVAL_LABEL[cfg.interval] ?? cfg.interval],
      ['Bitcoin-Kurs', fmtEUR(cfg.price)],
      ['Pro Kauf', fmtEUR(btcResult.perBuy)],
      ['Sats pro Kauf', fmtSats(btcResult.satsPerBuy)],
      ['Ziel-UTXO', fmtSats(cfg.targetSats)],
      ['Käufe bis Zielgröße', Number.isFinite(btcResult.buysToTarget) ? ints.format(btcResult.buysToTarget) : '–'],
      ['Bestand', `${fmtEUR(cfg.holdings)} · ${fmtBTC(btcResult.holdingsBtc)}`],
    ]) {
      const box = el('div');
      box.append(el('dt', null, label), el('dd', null, value));
      zahlen.appendChild(box);
    }
    bitcoin.appendChild(zahlen);

    if (cfg.wallets.length) {
      bitcoin.appendChild(reportTable(
        ['Wallet', 'Zweck', 'Modus', '#Betrag', '#Anteil'],
        cfg.wallets.map((w) => {
          const amount = btcResult.amounts.get(w.id) ?? 0;
          return [
            namePlate(w),
            w.note || '',
            MODE_LABEL[w.mode] ?? w.mode,
            fmtEUR(amount),
            shareCell(amount, cfg.holdings, w.color),
          ];
        }),
      ));
    }
    parts.push(bitcoin);
  }

  /* ---- Fuß ---- */
  const kennung = $('[data-role="build-id"]').textContent;
  parts.push(el('footer', 'report-foot',
    ['Kontenmodell nach der Folge zum Kontenmodell von „Der Bitcoin Podcast" (Florian Bruce).',
      'Keine Finanz- oder Steuerberatung.',
      kennung && `Fassung ${kennung}`,
    ].filter(Boolean).join(' ')));

  printSheet.replaceChildren(...parts);
}

/* Auch Strg/Cmd + P soll ein gefülltes Blatt vorfinden. */
window.addEventListener('beforeprint', buildReport);

function printReport() {
  buildReport();
  window.print();
}

/* ============================ CSV für Excel ============================
 *
 * Eine rechteckige Tabelle statt mehrerer Blöcke: So lässt sich in Excel
 * filtern und pivotieren. Semikolon als Trenner, Komma als Dezimalzeichen und
 * ein BOM voran – damit deutsche Excel-Versionen Umlaute und Zahlen richtig
 * erkennen. Die Zeile „sep=;" nimmt Excel das Raten ab.
 */

const CSV_COLUMNS = [
  'Bereich', 'Bezeichnung', 'Zweck', 'Modus', 'Wert', 'Turnus',
  'Pro Monat', 'Pro Jahr', 'Anteil %',
];

/** Zahl ohne Währungszeichen, mit Komma – so rechnet Excel damit weiter. */
const csvNum = (n) => (Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',');

function csvCell(value) {
  const text = String(value ?? '');
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv() {
  const result = compute();
  const cfg = btc();
  const rows = [];

  const anteil = (amount, basis) => (basis > 0 ? csvNum((amount / basis) * 100) : '');

  /* Kennzahlen zuerst – damit die Eckdaten beim Öffnen oben stehen. */
  rows.push(['Kennzahl', 'Monatliches Nettoeinkommen', '', '', '', '', csvNum(result.income), csvNum(result.income * 12), '']);
  rows.push(['Kennzahl', 'Zugeteilt', '', '', '', '', csvNum(result.allocated), csvNum(result.allocated * 12), anteil(result.allocated, result.income)]);
  rows.push(['Kennzahl', 'Fixkosten', '', '', '', '', csvNum(result.fixedMonthly), csvNum(result.fixedMonthly * 12), csvNum(result.fixedRate)]);
  rows.push(['Kennzahl', result.rest < 0 ? 'Überzogen' : 'Rest auf Hausbank', '', '', '', '', csvNum(result.rest), csvNum(result.rest * 12), anteil(result.rest, result.income)]);

  for (const b of state.buckets) {
    const amount = result.amounts.get(b.id) ?? 0;
    rows.push([
      'Konto',
      b.name || 'Konto',
      b.note,
      MODE_LABEL[b.mode] ?? b.mode,
      b.mode === 'percent' || b.mode === 'fixed' ? csvNum(b.value) : '',
      '',
      csvNum(amount),
      csvNum(amount * 12),
      anteil(amount, result.income),
    ]);
  }

  for (const f of state.fixedCosts) {
    const monthly = monthlyOf(f);
    rows.push([
      'Fixkosten',
      f.name || 'Position',
      '',
      '',
      csvNum(f.amount),
      FREQ_LABEL[f.freq] ?? f.freq,
      csvNum(monthly),
      csvNum(monthly * 12),
      anteil(monthly, result.fixedMonthly),
    ]);
  }

  if (cfg.wallets.length) {
    const btcResult = computeBitcoin();
    for (const w of cfg.wallets) {
      const amount = btcResult.amounts.get(w.id) ?? 0;
      rows.push([
        'Wallet',
        w.name || 'Wallet',
        w.note,
        MODE_LABEL[w.mode] ?? w.mode,
        w.mode === 'percent' || w.mode === 'fixed' ? csvNum(w.value) : '',
        '',
        csvNum(amount),
        '',
        anteil(amount, cfg.holdings),
      ]);
    }
  }

  const lines = [CSV_COLUMNS, ...rows].map((cells) => cells.map(csvCell).join(';'));
  return `sep=;\r\n${lines.join('\r\n')}\r\n`;
}

function exportCsv() {
  /* ﻿: ohne BOM zeigt Excel „Risikorücklage" als „RisikorÃ¼cklage". */
  const blob = new Blob([`﻿${buildCsv()}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = backupFilename(new Date().toISOString()).replace('_AES256.json', '.csv');
  link.click();
  URL.revokeObjectURL(url);
  toast('📊 CSV gespeichert – in Excel mit Semikolon als Trenner.');
}

/* ---------- Start ---------- */

renderRows();

let startTab = 'privat';
try {
  startTab = localStorage.getItem(TAB_KEY) || 'privat';
} catch { /* ohne Speicher startet immer das Privatmodell */ }
showTab(startTab);

setupInstallPrompt();
registerServiceWorker();
showBuildId();

