// Kleine hulpfuncties: DOM, datums, iconen, dialogen en meldingen.
export const APP_VERSION = 'v23'; // gelijk houden met VERSION in sw.js

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); return fn(...a); };
  return d;
}

// ---------- Datums ----------
export const DAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
export const DAYS_SHORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
export const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
export const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

const pad = n => String(n).padStart(2, '0');
export function isoDay(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function weekday(d = new Date()) { return ((d.getDay() + 6) % 7) + 1; } // 1 = maandag
export function parseDay(iso) { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
export function minutes(hhmm) { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); }
export function hhmm(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function weekNumber(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 864e5 + 1) / 7);
}
export function fmtDate(iso, { year = false } = {}) {
  if (!iso) return '';
  const d = typeof iso === 'number' ? new Date(iso) : parseDay(String(iso));
  return `${DAYS_SHORT[weekday(d) - 1]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`;
}
export function fmtLongDate(d = new Date()) {
  return `${DAYS[weekday(d) - 1]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export function fmtDue(due) {
  if (!due) return { text: 'geen deadline', cls: '' };
  const d = new Date(due);
  const today = parseDay(isoDay());
  const days = Math.round((parseDay(isoDay(d)) - today) / 864e5);
  const time = due.length > 10 ? ' ' + hhmm(d) : '';
  if (d < new Date() && days <= 0) return { text: days === 0 ? `vandaag${time} (verlopen)` : 'te laat', cls: 'late' };
  if (days === 0) return { text: `vandaag${time}`, cls: 'soon' };
  if (days === 1) return { text: `morgen${time}`, cls: 'soon' };
  if (days < 7) return { text: `${DAYS[weekday(d) - 1]}${time}`, cls: days < 3 ? 'soon' : '' };
  return { text: fmtDate(isoDay(d)), cls: '' };
}
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 6 ? 'Goedenacht' : h < 12 ? 'Goedemorgen' : h < 18 ? 'Goedemiddag' : 'Goedenavond';
}

// ---------- Kleuren ----------
export const SUBJECT_COLORS = ['#4f6bed', '#e5484d', '#12a594', '#f5a524', '#8e4ec6', '#e54d9a', '#0090ff', '#46a758', '#d6672e', '#5b6b7f'];
export const PEN_COLORS = ['#1c1d21', '#2b59c3', '#d23c3c', '#178a5a', '#7a3fc0', '#e07a12'];
export const HL_COLORS = ['#ffd84d', '#7ee08f', '#ff8fc7', '#7cc8ff', '#ffb35c'];

// ---------- Iconen (24x24, lijnstijl) ----------
const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 21h14"/>',
  pen: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  highlighter: '<path d="M9 11l-5 5v4h4l5-5"/><path d="M14 6l4 4-6 6-4-4z"/><path d="M14 6l2.5-2.5a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2L18 10"/>',
  eraser: '<path d="M7 21h10"/><path d="M5.6 15.4l8.5-8.5a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L13 18H8.2z"/><path d="M9.5 11.5l5 5"/>',
  lasso: '<path d="M7 17c-2.4-1.3-4-3.4-4-5.8C3 7.2 7 4 12 4s9 3.2 9 7.2-4 7.2-9 7.2c-1 0-2-.1-2.9-.4"/><circle cx="8" cy="18" r="2"/><path d="M8 20c0 1.5-1 2-2 2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>',
  rewind: '<path d="M11 7l-6 5 6 5zM19 7l-6 5 6 5z"/>',
  forward: '<path d="M13 7l6 5-6 5zM5 7l6 5-6 5z"/>',
  headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
  page: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  pageplus: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  cards: '<rect x="2" y="6" width="15" height="14" rx="2"/><path d="M7 3h13a2 2 0 0 1 2 2v12"/>',
  task: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8 11h6M11 8v6"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  shape: '<circle cx="8" cy="8" r="5"/><rect x="11" y="11" width="10" height="10" rx="1"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  board: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M6 14c2-3 3.5-3 5 0s3 3 5 0"/><path d="M17 8h1"/>',
  flag: '<path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  slides: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M12 17v4M8 21h8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
};
export function icon(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// ---------- Meldingen ----------
export function toast(msg, { action, onAction, ms = 3200 } = {}) {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.append(host); }
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="btn small">${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { onAction?.(); el.remove(); };
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, action ? ms * 2 : ms);
}

// ---------- Dialogen ----------
// actions: [{label, value, primary, danger}] — geeft {action, data} terug (action null bij annuleren)
export function modal({ title, body = '', actions = [{ label: 'Annuleer', value: null }, { label: 'Opslaan', value: 'ok', primary: true }], onOpen, wide = false }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <form class="modal${wide ? ' wide' : ''}" novalidate>
        ${title ? `<h2>${esc(title)}</h2>` : ''}
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          ${actions.map((a, i) => `<button type="${a.primary ? 'submit' : 'button'}" data-i="${i}" class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}">${esc(a.label)}</button>`).join('')}
        </div>
      </form>`;
    const form = wrap.querySelector('form');
    const close = (action) => {
      const data = Object.fromEntries(new FormData(form));
      $$('input[type=checkbox]', form).forEach(cb => { if (cb.name) data[cb.name] = cb.checked; });
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 200);
      resolve({ action, data, form });
    };
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      close(actions.find(a => a.primary)?.value ?? 'ok');
    });
    $$('button[type=button]', form).forEach(b => b.onclick = () => close(actions[+b.dataset.i].value));
    wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(null); });
    document.body.append(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    onOpen?.(form, close);
    const first = form.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea');
    if (first && !first.dataset.nofocus) setTimeout(() => first.focus(), 60);
  });
}

export async function confirmDialog(text, { ok = 'Verwijder', danger = true, title = 'Weet je het zeker?' } = {}) {
  const r = await modal({ title, body: `<p>${esc(text)}</p>`, actions: [{ label: 'Annuleer', value: null }, { label: ok, value: 'ok', primary: true, danger }] });
  return r.action === 'ok';
}

// Kleine zwevende menu's naast een knop
export function popover(anchor, html, { onOpen, align = 'left' } = {}) {
  closePopovers();
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.innerHTML = html;
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = align === 'right' ? r.right - pw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - pw - 8));
  let top = r.bottom + 8;
  if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 8);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  const off = e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopovers(); };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  pop._off = off;
  onOpen?.(pop);
  return pop;
}
export function closePopovers() {
  $$('.popover').forEach(p => { document.removeEventListener('pointerdown', p._off, true); p.remove(); });
}

// Menu met opties; geeft gekozen waarde terug
export function menu(anchor, items, opts) {
  return new Promise(resolve => {
    const pop = popover(anchor, `<div class="menu">${items.map((it, i) => it === '-' ? '<hr>' :
      `<button class="menu-item ${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon ? icon(it.icon, 18) : ''}<span>${esc(it.label)}</span></button>`).join('')}</div>`, opts);
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      closePopovers();
      resolve(items[+b.dataset.i].value);
    });
  });
}

// ---------- Bestanden ----------
export function pickFile(accept = '') {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.style.display = 'none';
    inp.onchange = () => { resolve(inp.files[0] || null); inp.remove(); };
    document.body.append(inp);
    inp.click();
  });
}

export async function saveFile(blob, filename) {
  // In een claude.ai-artifact: via de download-functie van de viewer (die vraagt zelf om bevestiging)
  if (typeof window.claude?.use === 'function') {
    const dl = await window.claude.use('downloads').catch(() => null);
    if (!dl) { toast('Opslaan als bestand kan hier niet'); return false; }
    try { await dl.save({ filename, data: blob }); return true; }
    catch (e) { if (e?.code !== 'declined') toast('Opslaan lukte niet'); return false; }
  }
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return true;
}
