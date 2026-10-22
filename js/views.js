// Schermen: dashboard, vak, samenvatting, oefenen, instellingen en zoeken.
import { db, getSetting, setSetting, deleteNotebook, deleteSubject, RUNTIME } from './db.js';
import {
  $, $$, esc, uid, icon, toast, modal, confirmDialog, menu, pickFile, closePopovers,
  isoDay, weekday, minutes, fmtDate, fmtLongDate, fmtDue, greeting, weekNumber, DAYS, DAYS_SHORT, SUBJECT_COLORS,
  parseDay, MONTHS, MONTHS_SHORT, APP_VERSION,
} from './util.js';
import { markdown, plainText } from './markdown.js';
import { GRADES, schedule, isDue, isNew, intervalLabel, newSrs, shuffle, deckKey, deckSets, isWeak, isKnown, recordDir, smartDir, weightedShuffle } from './srs.js';
import { buildVocab, keyTermsFor, checkAnswer, checkTerm, findSpans, answerSpans } from './keyterms.js';
import { importFile, exportBackup, seedDemo, removeDemo, wipeAll, isDemoSubject } from './pack.js';
import { PAPERS, drawStroke } from './ink.js';
import { shiftBlock, shiftDay, undoShift } from './planner.js';
import { enablePlanMove } from './planmove.js';
import { planLinks, subjectSets, setForBlock } from './plansets.js';
import { importPdf } from './pdf.js';
import { connectInbox, checkInbox, disconnectInbox } from './inbox.js';

const KINDS = ['Hoorcollege', 'Werkcollege', 'Practicum', 'Tutorial', 'Zelfstudie', 'Tentamen', 'Overig'];
const go = h => { location.hash = h; };

async function loadAll() {
  const [subjects, slots, notebooks, summaries, assignments, cards, plan] = await Promise.all(
    ['subjects', 'slots', 'notebooks', 'summaries', 'assignments', 'cards', 'plan'].map(s => db.all(s)));
  subjects.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  const sub = Object.fromEntries(subjects.map(s => [s.id, s]));
  plan.sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
  return { subjects, slots, notebooks, summaries, assignments, cards, plan, sub };
}

// ---------- Studieplanning ----------
const SLOTS = ['Ochtend', 'Middag', 'Avond'];
const PLAN_KINDS = [
  { id: 'study', label: 'Studeren' }, { id: 'class', label: 'College' }, { id: 'exam', label: 'Tentamen' }, { id: 'rest', label: 'Vrij' },
];
const kindLabel = k => PLAN_KINDS.find(x => x.id === k)?.label || '';
const daysUntil = iso => Math.round((parseDay(iso) - parseDay(isoDay())) / 864e5);

function planBlock(p, s, set = null) {
  const checkable = p.kind === 'study';
  const color = p.kind === 'exam' ? 'var(--danger)' : p.kind === 'rest' ? 'var(--muted)' : (s?.color || 'var(--accent)');
  const tag = p.kind === 'study' ? (s?.name || '') : kindLabel(p.kind);
  return `<div class="pblk k-${p.kind} ${p.done ? 'done' : ''}" style="--c:${color}" data-pid="${p.id}">
    ${checkable ? `<button class="check ${p.done ? 'on' : ''}" data-pdone="${p.id}" aria-label="Afvinken">${p.done ? icon('check', 14) : ''}</button>`
      : `<span class="pk-ic">${icon(p.kind === 'exam' ? 'flag' : p.kind === 'class' ? 'calendar' : 'clock', 16)}</span>`}
    <button class="pblk-body" data-plan="${p.id}">
      <span class="pslot">${SLOTS[p.slot] || ''}${tag ? ' · ' + esc(tag) : ''}${p.movedFrom && !p.done ? ` <em class="moved" title="Oorspronkelijk ${esc(fmtDate(p.movedFrom))}">↻ doorgeschoven</em>` : ''}</span>
      <b>${esc(p.title)}</b>
      ${p.details ? `<small>${esc(p.details)}</small>` : ''}
      ${p.important ? `<small class="imp"><i>★</i> Belangrijk: ${esc(p.important)}</small>` : ''}
    </button>
    ${set ? `<button class="pset" data-pset="${esc(p.subjectId)}" data-set="${esc(set.key)}">${icon('cards', 14)} Oefen: <b>${esc(set.label.split(' · ')[0])}</b> <span>${Math.round(set.pct * 100)}% goed</span>${p.autoDone ? ' · vanzelf afgevinkt' : ''}</button>` : ''}
  </div>`;
}

function examCards(D) {
  const today = isoDay();
  const exams = D.plan.filter(p => p.kind === 'exam' && p.date >= today);
  if (!exams.length) return '';
  return `<div class="exam-strip">${exams.map(e => {
    const s = D.sub[e.subjectId];
    const blocks = D.plan.filter(p => p.kind === 'study' && p.subjectId && p.subjectId === e.subjectId);
    const done = blocks.filter(p => p.done).length;
    // Achter = niet af en oorspronkelijk gepland vóór vandaag (automatisch doorgeschoven)
    const behind = blocks.filter(p => !p.done && p.movedFrom && p.movedFrom < today).length;
    const n = daysUntil(e.date);
    const pct = blocks.length ? Math.round(done / blocks.length * 100) : 0;
    return `<button class="exam-card" style="--c:${s?.color || 'var(--danger)'}" data-planfilter="${e.subjectId || ''}">
      <span class="exam-when">${n === 0 ? 'Vandaag' : n === 1 ? 'Morgen' : `Nog ${n} dagen`}</span>
      <b>${esc(s?.name || e.title)}</b>
      <small>${fmtDate(e.date)}${(() => { const tm = e.title.match(/\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}/); return tm ? ' · ' + tm[0] : ''; })()}${e.details ? ' · ' + esc(e.details) : ''}</small>
      ${blocks.length ? `<span class="bar"><i style="width:${pct}%"></i></span><small>${done} van ${blocks.length} blokken af</small>
        <small class="${behind ? 'behind' : 'ontrack'}">${behind ? `⚠ ${behind} blok${behind === 1 ? '' : 'ken'} achter` : '✓ Op schema'}</small>` : ''}
    </button>`;
  }).join('')}</div>`;
}

function planDays(D, { subjectId = null, from = null } = {}) {
  const today = isoDay();
  let list = D.plan.filter(p => !subjectId || p.subjectId === subjectId || (p.kind === 'exam' && p.subjectId === subjectId));
  if (from) list = list.filter(p => p.date >= from);
  if (!list.length) return '<p class="empty">Nog geen planning.</p>';
  const links = D.cards ? planLinks(D) : new Map();
  const byDate = new Map();
  for (const p of list) { if (!byDate.has(p.date)) byDate.set(p.date, []); byDate.get(p.date).push(p); }
  let html = '', curWeek = '';
  for (const [date, items] of byDate) {
    const d = parseDay(date);
    const mon = new Date(d); mon.setDate(d.getDate() - (weekday(d) - 1));
    const wk = isoDay(mon);
    if (wk !== curWeek) { curWeek = wk; html += `<h3 class="week-title">Week van ${mon.getDate()} ${MONTHS[mon.getMonth()]}</h3>`; }
    // Elk dagdeel is een vakje (data-date/data-slot): daar kun je een blok naartoe slepen of tikken
    const cells = [0, 1, 2].map(slot => {
      const blocks = items.filter(p => p.slot === slot).map(p => planBlock(p, D.sub[p.subjectId], links.get(p.id))).join('');
      return `<div class="pcell ${blocks ? '' : 'is-empty'}" data-date="${date}" data-slot="${slot}">${blocks || `<div class="pblk empty-slot" data-label="${SLOTS[slot]}"></div>`}</div>`;
    });
    const canShift = date >= today && items.some(p => p.kind === 'study' && !p.done);
    html += `<div class="pday ${date < today ? 'past' : ''} ${date === today ? 'is-today' : ''}" ${date === today ? 'id="vandaag"' : ''}>
      <div class="pdate"><b>${d.getDate()}</b><small>${DAYS_SHORT[weekday(d) - 1]} ${MONTHS_SHORT[d.getMonth()]}</small>${date === today ? '<span class="tag now-tag">Vandaag</span>' : ''}
        ${canShift ? `<button class="shift-day" data-shiftday="${date}" title="Deze dag lukt niet: alle studieblokken doorschuiven">↻ Lukt niet</button>` : ''}</div>
      <div class="pblocks ${subjectId ? 'stack' : ''}">${cells.join('')}</div>
    </div>`;
  }
  return html;
}

async function togglePlan(id) {
  const p = await db.get('plan', id);
  p.done = !p.done;
  await db.put('plan', p);
}

async function editPlanItem(p) {
  const [subjects, cards, summaries] = await Promise.all(['subjects', 'cards', 'summaries'].map(s => db.all(s)));
  const isEdit = !!p?.id;
  const sets = p?.subjectId ? subjectSets(cards, summaries, p.subjectId) : [];
  const auto = p?.id ? setForBlock({ ...p, deck: undefined }, sets) : null;
  const r = await modal({
    title: isEdit ? 'Planningsblok' : 'Nieuw blok',
    body: `<label class="field"><span>Wat ga je doen?</span><input name="title" value="${esc(p?.title || '')}" required autocomplete="off"></label>
      <div class="field-row">
        <label class="field"><span>Datum</span><input type="date" name="date" value="${esc(p?.date || isoDay())}" required></label>
        <label class="field"><span>Dagdeel</span><select name="slot">${SLOTS.map((s, i) => `<option value="${i}" ${i === (p?.slot ?? 0) ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Vak</span><select name="subjectId"><option value="">— geen —</option>${subjects.map(s => `<option value="${s.id}" ${s.id === p?.subjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Soort</span><select name="kind">${PLAN_KINDS.map(k => `<option value="${k.id}" ${k.id === (p?.kind || 'study') ? 'selected' : ''}>${k.label}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Details</span><textarea name="details" rows="4">${esc(p?.details || '')}</textarea></label>
      ${sets.length ? `<label class="field"><span>Flitskaartset</span><select name="deck">
        <option value="" ${!p?.deck ? 'selected' : ''}>Automatisch${auto ? ` (${esc(auto.label.split(' · ')[0])})` : ' (geen gevonden)'}</option>
        ${sets.map(x => `<option value="${esc(x.label)}" ${p?.deck === x.label ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
        <option value="-" ${p?.deck === '-' ? 'selected' : ''}>Geen</option></select></label>` : ''}
      ${p?.important ? `<p class="muted small">★ Belangrijk: ${esc(p.important)}</p>` : ''}
      ${p?.movedFrom ? `<p class="muted small">↻ Doorgeschoven, oorspronkelijk gepland op ${esc(fmtDate(p.movedFrom))}</p>` : ''}`,
    actions: isEdit ? [
      { label: 'Verwijder', value: 'del', danger: true },
      ...(p.kind === 'study' && !p.done ? [{ label: 'Niet gelukt → schuif door', value: 'shift' }] : []),
      { label: 'Annuleer', value: null }, { label: 'Opslaan', value: 'ok', primary: true },
    ] : undefined,
  });
  if (r.action === 'del') { await db.del('plan', p.id); return true; }
  if (r.action === 'shift') return !!(await shiftBlock(p.id));
  if (r.action !== 'ok') return false;
  const deck = r.data.deck || undefined; // leeg = automatisch zoeken
  await db.put('plan', { done: false, important: '', source: 'eigen', ...(p || {}), id: p?.id || uid('b'), title: r.data.title.trim(), date: r.data.date, slot: +r.data.slot, subjectId: r.data.subjectId || null, kind: r.data.kind, details: r.data.details, deck });
  return true;
}

// Klikken op blokken/vinkjes, gedeeld door dashboard, planning en vak
async function handlePlanClick(t, rerender) {
  const pd = t.closest('[data-pdone]');
  if (pd) { await togglePlan(pd.dataset.pdone); rerender(); return true; }
  const ps = t.closest('[data-pset]');
  if (ps) { go(`#/oefenen/${ps.dataset.pset}?set=${encodeURIComponent(ps.dataset.set)}`); return true; }
  const sd = t.closest('[data-shiftday]');
  if (sd) {
    const day = sd.dataset.shiftday;
    if (await confirmDialog(`Alle studieblokken van ${fmtDate(day)} die nog niet af zijn doorschuiven naar de eerstvolgende vrije momenten vóór het tentamen?`, { ok: 'Doorschuiven', danger: false, title: 'Deze dag lukt niet' })) {
      if (await shiftDay(day)) rerender();
    }
    return true;
  }
  const pb = t.closest('[data-plan]');
  if (pb) { if (await editPlanItem(await db.get('plan', pb.dataset.plan))) rerender(); return true; }
  return false;
}

export async function planningView(root, subjectId = null) {
  const D = await loadAll();
  const meta = await getSetting('planNotes', null);
  const undoInfo = await getSetting('planUndo', null);
  const s = subjectId ? D.sub[subjectId] : null;
  const withPlan = D.subjects.filter(x => D.plan.some(p => p.subjectId === x.id));
  root.innerHTML = `
  <div class="view planning">
    <header class="topbar sub">
      <div class="row"><button class="icon-btn" data-a="back" aria-label="Terug">${icon('back')}</button>
        <div><h1>${esc(meta?.title || 'Planning')}</h1><p class="muted">${D.plan.filter(p => p.kind === 'study' && p.done).length} van ${D.plan.filter(p => p.kind === 'study').length} studieblokken af</p></div></div>
      <div class="actions"><button class="btn" data-a="addblock">${icon('plus', 18)} Blok</button></div>
    </header>
    <p class="muted small plan-hint">Tip: houd een blok ingedrukt om het te verslepen of te verwijderen.</p>
    ${undoInfo && undoInfo.date === isoDay() ? `<div class="shift-banner"><b>↻</b><span>${undoInfo.label === 'manual' ? 'Je hebt een blok doorgeschoven' : 'Blokken die nog niet af waren zijn doorgeschoven'} — ${undoInfo.moved} blok${undoInfo.moved === 1 ? '' : 'ken'} kregen een nieuwe plek vóór het tentamen.</span><button class="btn small" data-a="undoshift">Ongedaan maken</button></div>` : ''}
    ${examCards(D)}
    ${meta?.notes?.length ? `<details class="card plan-notes"><summary><b>Let op</b> <span class="muted">(${meta.notes.length})</span></summary><ul>${meta.notes.map(n => `<li>${markdown(n).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul></details>` : ''}
    <div class="chips filter">
      <a class="chip ${!s ? 'on' : ''}" href="#/planning">Alles</a>
      ${withPlan.map(x => `<a class="chip ${x.id === subjectId ? 'on' : ''}" style="--c:${x.color}" href="#/planning/${x.id}">${esc(x.name)}</a>`).join('')}
    </div>
    <div class="plan-list">${planDays(D, { subjectId })}</div>
  </div>`;
  const rerender = () => { const y = scrollY; planningView(root, subjectId).then(() => scrollTo(0, y)); };
  root.onclick = async e => {
    if (await handlePlanClick(e.target, rerender)) return;
    const pf = e.target.closest('[data-planfilter]');
    if (pf) return go('#/planning' + (pf.dataset.planfilter ? '/' + pf.dataset.planfilter : ''));
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'back') go('#/');
    if (a === 'addblock') { if (await editPlanItem({ subjectId })) rerender(); }
    if (a === 'undoshift') { if (await undoShift()) rerender(); }
  };
  enablePlanMove(root, { onChange: rerender, slots: SLOTS });
  const t = $('#vandaag', root);
  if (t) requestAnimationFrame(() => { t.scrollIntoView({ block: 'start' }); scrollBy(0, -12); });
}

// Vraagt eerst: notitieboek (A4-pagina's) of oneindig canvas (Freeform-stijl), plus de achtergrond
export async function newNotebook(subjectId, { kind = 'note', title } = {}) {
  const lastLayout = await getSetting('lastLayout', 'pages');
  const defPaper = await getSetting('defaultPaper', 'lined');
  const defTitle = title || `${kind === 'summary' ? 'Samenvatting' : 'Aantekeningen'} ${fmtDate(isoDay())}`;
  const r = await modal({
    title: 'Nieuwe notitie',
    body: `<label class="field"><span>Titel</span><input name="title" value="${esc(defTitle)}" required autocomplete="off" data-nofocus="1"></label>
      <div class="layout-pick">
        <label><input type="radio" name="layout" value="pages" ${lastLayout !== 'board' ? 'checked' : ''}><span>${icon('book', 30)}<b>Notitieboek</b><small>A4-pagina's onder elkaar, zoals GoodNotes</small></span></label>
        <label><input type="radio" name="layout" value="board" ${lastLayout === 'board' ? 'checked' : ''}><span>${icon('board', 30)}<b>Oneindig canvas</b><small>Vrij in- en uitzoomen, zoals Freeform</small></span></label>
      </div>
      <div class="field"><span>Achtergrond</span><div class="paper-pick inline">${PAPERS.map(p => `<label class="paper-opt"><input type="radio" name="paper" value="${p.id}" ${p.id === defPaper ? 'checked' : ''}><i class="pp pp-${p.id}"></i><span>${p.label}</span></label>`).join('')}</div></div>`,
    actions: [{ label: 'Annuleer', value: null }, { label: 'Maak notitie', value: 'ok', primary: true }],
  });
  if (r.action !== 'ok') return;
  const layout = r.data.layout === 'board' ? 'board' : 'pages';
  let paper = r.data.paper || defPaper;
  if (layout === 'board' && paper === 'cornell') paper = 'lined';
  await setSetting('lastLayout', layout);
  const nb = {
    id: uid('n'), subjectId, kind, paper, layout, created: Date.now(), updated: Date.now(), pageCount: 1,
    title: r.data.title.trim() || defTitle,
  };
  await db.put('notebooks', nb);
  await db.put('pages', { id: uid('p'), notebookId: nb.id, index: 0, paper, strokes: [] });
  go('#/notitie/' + nb.id);
}

export async function doImport() {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  const r = await importFile(f);
  if (r) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

// ---------- Rooster-hulpjes ----------
function nextOccurrences(slots, from = new Date(), count = 1) {
  const out = [];
  const nowMin = from.getHours() * 60 + from.getMinutes();
  for (let off = 0; off < 8 && out.length < count; off++) {
    const d = new Date(from); d.setDate(d.getDate() + off);
    const wd = weekday(d);
    const list = slots.filter(s => s.day === wd).sort((a, b) => minutes(a.start) - minutes(b.start));
    for (const s of list) {
      if (off === 0 && minutes(s.end) <= nowMin) continue;
      out.push({ slot: s, date: d, off, now: off === 0 && minutes(s.start) <= nowMin });
      if (out.length >= count) break;
    }
  }
  return out;
}
function whenLabel(o) {
  if (o.now) return `Nu bezig · tot ${o.slot.end}`;
  if (o.off === 0) return `Vandaag om ${o.slot.start}`;
  if (o.off === 1) return `Morgen om ${o.slot.start}`;
  return `${DAYS[weekday(o.date) - 1]} om ${o.slot.start}`;
}

// ================= DASHBOARD =================
export async function dashboard(root) {
  const D = await loadAll();
  const now = new Date();
  const name = await getSetting('name', '');
  const view = await getSetting('dashView', 'today');

  if (!D.subjects.length) {
    root.innerHTML = `
    <div class="view">
      <header class="topbar"><div><h1>${greeting(now)}${name ? ', ' + esc(name) : ''}</h1><p class="muted">${fmtLongDate(now)} · week ${weekNumber(now)}</p></div>
        <div class="actions"><button class="icon-btn" data-a="settings" aria-label="Instellingen">${icon('settings')}</button></div></header>
      <section class="welcome card">
        <div class="welcome-art">${icon('book', 44)}</div>
        <h2>Welkom bij Vakwerk</h2>
        <p>Je rooster, je vakken en al je aantekeningen op één plek. Begin met je vakken en je weekrooster. Daarna kun je per vak met de Pencil schrijven, colleges opnemen en oefenen met flashcards.</p>
        <div class="row gap">
          <button class="btn primary" data-a="addsubject">${icon('plus', 18)} Eerste vak toevoegen</button>
          <button class="btn" data-a="demo">${icon('sparkle', 18)} Probeer met voorbeelddata</button>
          <button class="btn ghost" data-a="import">${icon('import', 18)} Importeer pakket of back-up</button>
        </div>
      </section>
    </div>`;
    root.onclick = async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'settings') go('#/instellingen');
      if (a === 'addsubject') { if (await editSubject()) dashboard(root); }
      if (a === 'demo') { await seedDemo(); dashboard(root); }
      if (a === 'import') doImport();
    };
    return;
  }

  const upcoming = nextOccurrences(D.slots, now, 1)[0];
  const today = D.slots.filter(s => s.day === weekday(now)).sort((a, b) => minutes(a.start) - minutes(b.start));
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const openTasks = D.assignments.filter(a => !a.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const due = D.cards.filter(c => isDue(c));
  const dueBySub = {};
  due.forEach(c => { dueBySub[c.subjectId] = (dueBySub[c.subjectId] || 0) + 1; });
  const todayPlan = D.plan.filter(p => p.date === isoDay(now));
  const nextPlan = D.plan.find(p => p.date > isoDay(now) && p.kind !== 'rest');
  // Zonder vast weekrooster maar mét planning: de studiedag krijgt de grote plek
  const showRooster = D.slots.length > 0 || !D.plan.length;
  const roosterCard = () => `<section class="card">
        <div class="card-h"><h3>${icon('calendar', 18)} Rooster</h3>
          <div class="seg small"><button class="pill ${view === 'today' ? 'on' : ''}" data-view="today">Vandaag</button><button class="pill ${view === 'week' ? 'on' : ''}" data-view="week">Week</button></div></div>
        <div class="sched">${view === 'week' ? weekGrid(D, now) : `<div class="slots">${todayHtml}</div>`}</div>
      </section>`;
  const planCard = todayPlan.length || nextPlan ? `<section class="card">
          <div class="card-h"><h3>${icon('list', 18)} ${todayPlan.length ? 'Vandaag studeren' : 'Planning'}</h3><a class="link" href="#/planning">Hele planning →</a></div>
          ${todayPlan.length ? `<div class="pblocks stack">${(() => { const links = planLinks(D); return todayPlan.map(p => planBlock(p, D.sub[p.subjectId], links.get(p.id))).join(''); })()}</div>`
            : `<p class="empty small">Vandaag niets gepland. Volgende: <b>${fmtDate(nextPlan.date)}</b> — ${esc(nextPlan.title)}</p>`}
        </section>` : '';
  const study = [...D.summaries].sort((a, b) => (a.read - b.read) || (b.date || '').localeCompare(a.date || '') || b.updated - a.updated).slice(0, 4);

  const hero = upcoming ? (() => {
    const s = D.sub[upcoming.slot.subjectId];
    if (!s) return '';
    const sumToday = D.summaries.find(x => x.subjectId === s.id && x.date === isoDay(upcoming.date));
    return `<section class="hero" style="--c:${s.color}">
      <div class="hero-main">
        <span class="hero-when">${whenLabel(upcoming)}</span>
        <h2>${esc(s.name)}</h2>
        <p>${esc(upcoming.slot.kind || '')}${upcoming.slot.location ? ' · ' + esc(upcoming.slot.location) : ''} · ${upcoming.slot.start}–${upcoming.slot.end}</p>
      </div>
      <div class="hero-actions">
        <button class="btn white" data-note="${s.id}">${icon('pen', 18)} Nieuwe notitie</button>
        ${sumToday ? `<button class="btn white ghost" data-sum="${sumToday.id}">${icon('doc', 18)} Samenvatting</button>` : ''}
        <button class="btn white ghost" data-sub="${s.id}">Open vak</button>
      </div>
    </section>`;
  })() : '';

  const todayHtml = today.length ? today.map(sl => {
    const s = D.sub[sl.subjectId];
    if (!s) return '';
    const st = minutes(sl.end) <= nowMin ? 'past' : minutes(sl.start) <= nowMin ? 'now' : '';
    return `<button class="slot ${st}" data-sub="${s.id}" style="--c:${s.color}">
      <span class="slot-time">${sl.start}<small>${sl.end}</small></span>
      <span class="slot-bar"></span>
      <span class="slot-body"><b>${esc(s.name)}</b><small>${esc(sl.kind || '')}${sl.location ? ' · ' + esc(sl.location) : ''}</small></span>
      ${st === 'now' ? '<span class="tag now">nu</span>' : ''}
    </button>`;
  }).join('') : `<p class="empty small">Vandaag geen colleges${D.slots.length ? '' : ' — <a href="#/instellingen">rooster invullen</a>'}.</p>`;

  root.innerHTML = `
  <div class="view dash">
    <header class="topbar">
      <div><h1>${greeting(now)}${name ? ', ' + esc(name) : ''}</h1><p class="muted">${fmtLongDate(now)} · week ${weekNumber(now)}</p></div>
      <div class="actions">
        <button class="icon-btn" data-a="search" aria-label="Zoeken">${icon('search')}</button>
        <button class="btn" data-a="planning">${icon('list', 18)} Planning</button>
        <button class="btn" data-a="import">${icon('import', 18)} Importeer</button>
        <button class="icon-btn" data-a="settings" aria-label="Instellingen">${icon('settings')}</button>
      </div>
    </header>
    ${D.subjects.some(isDemoSubject) ? `<div class="demo-banner">${icon('sparkle', 18)}<span>Je kijkt naar <b>voorbeelddata</b>. Klaar met rondkijken?</span><button class="btn small" data-a="removedemo">Voorbeelddata verwijderen</button></div>` : ''}
    ${hero}
    ${examCards(D)}
    <div class="dash-grid">
      ${showRooster ? roosterCard() : planCard}
      <div class="col">
        ${showRooster ? planCard : ''}
        <section class="card">
          <div class="card-h"><h3>${icon('task', 18)} Deadlines</h3><button class="link" data-a="addtask">+ Opdracht</button></div>
          ${openTasks.length ? `<div class="tasks">${openTasks.slice(0, 6).map(t => taskRow(t, D.sub[t.subjectId], true)).join('')}</div>` : '<p class="empty small">Geen openstaande opdrachten 🎉</p>'}
        </section>
        <section class="card review ${due.length ? '' : 'quiet'}">
          <div class="card-h"><h3>${icon('cards', 18)} Herhalen</h3></div>
          ${due.length ? `<p class="big-num">${due.length}<small> kaart${due.length > 1 ? 'en' : ''} klaar om te herhalen</small></p>
            <div class="chips">${Object.entries(dueBySub).map(([id, n]) => D.sub[id] ? `<a class="chip" href="#/oefenen/${id}" style="--c:${D.sub[id].color}">${esc(D.sub[id].name)} · ${n}</a>` : '').join('')}</div>
            <button class="btn primary block" data-a="review">Start herhalen</button>`
            : `<p class="empty small">Alles herhaald voor vandaag. ${D.cards.length ? '' : 'Begrippen en oefenvragen uit je samenvattingen komen hier vanzelf.'}</p>`}
        </section>
        ${study.length ? `<section class="card">
          <div class="card-h"><h3>${icon('sparkle', 18)} Om te bestuderen</h3></div>
          <div class="study">${study.map(x => {
            const s = D.sub[x.subjectId];
            return `<button class="study-row" data-sum="${x.id}" style="--c:${s?.color || '#888'}"><span class="dot"></span><span><b>${esc(x.title)}</b><small>${esc(s?.name || '')} · ${fmtDate(x.date)}</small></span>${x.read ? '' : '<span class="tag">nieuw</span>'}</button>`;
          }).join('')}</div>
        </section>` : ''}
      </div>
    </div>
    <section class="subjects-sec">
      <div class="sec-h"><h3>Vakken</h3></div>
      <div class="subject-grid">
        ${D.subjects.map(s => {
          const nNotes = D.notebooks.filter(n => n.subjectId === s.id).length;
          const nSum = D.summaries.filter(n => n.subjectId === s.id).length;
          const nTask = D.assignments.filter(a => a.subjectId === s.id && !a.done).length;
          const nx = nextOccurrences(D.slots.filter(x => x.subjectId === s.id), now, 1)[0];
          return `<button class="subject-tile" data-sub="${s.id}" style="--c:${s.color}">
            <span class="tile-band"></span>
            <b>${esc(s.name)}</b>
            <small>${nx ? whenLabel(nx) : 'Niet in rooster'}</small>
            <span class="tile-stats">
              <span>${icon('pen', 14)} ${nNotes}</span><span>${icon('doc', 14)} ${nSum}</span>
              ${nTask ? `<span>${icon('task', 14)} ${nTask}</span>` : ''}${dueBySub[s.id] ? `<span class="hot">${icon('cards', 14)} ${dueBySub[s.id]}</span>` : ''}
            </span>
          </button>`;
        }).join('')}
        <button class="subject-tile add" data-a="addsubject">${icon('plus', 26)}<b>Vak toevoegen</b></button>
      </div>
    </section>
  </div>`;

  root.onclick = async e => {
    const t = e.target;
    if (await handlePlanClick(t, () => dashboard(root))) return;
    const pf = t.closest('[data-planfilter]');
    if (pf) return go('#/planning' + (pf.dataset.planfilter ? '/' + pf.dataset.planfilter : ''));
    const cb = t.closest('[data-done]');
    if (cb) { e.stopPropagation(); await toggleTask(cb.dataset.done); return dashboard(root); }
    const v = t.closest('[data-view]');
    if (v) { await setSetting('dashView', v.dataset.view); return dashboard(root); }
    const n = t.closest('[data-note]'); if (n) return newNotebook(n.dataset.note);
    const sm = t.closest('[data-sum]'); if (sm) return go('#/samenvatting/' + sm.dataset.sum);
    const tk = t.closest('[data-task]'); if (tk) { if (await editTask(await db.get('assignments', tk.dataset.task))) dashboard(root); return; }
    const sb = t.closest('[data-sub]'); if (sb) return go('#/vak/' + sb.dataset.sub);
    const a = t.closest('[data-a]')?.dataset.a;
    if (a === 'settings') go('#/instellingen');
    if (a === 'import') doImport();
    if (a === 'search') openSearch();
    if (a === 'planning') go('#/planning');
    if (a === 'removedemo') { if (await removeDemo()) dashboard(root); }
    if (a === 'review') go('#/oefenen/all');
    if (a === 'addsubject') { if (await editSubject()) dashboard(root); }
    if (a === 'addtask') { if (await editTask(null)) dashboard(root); }
  };
}

function weekGrid(D, now) {
  const days = [1, 2, 3, 4, 5];
  if (D.slots.some(s => s.day === 6)) days.push(6);
  if (D.slots.some(s => s.day === 7)) days.push(6, 7);
  const uniq = [...new Set(days)];
  if (!D.slots.length) return '<p class="empty small">Nog geen rooster. <a href="#/instellingen">Vul je rooster in</a>.</p>';
  const start = Math.floor(Math.min(...D.slots.map(s => minutes(s.start))) / 60) * 60;
  const end = Math.ceil(Math.max(...D.slots.map(s => minutes(s.end))) / 60) * 60;
  const PX = 0.75;
  const today = weekday(now);
  const hours = [];
  for (let m = start; m <= end; m += 60) hours.push(m);
  return `<div class="week" style="--cols:${uniq.length}">
    <div class="week-head"><span></span>${uniq.map(d => `<span class="${d === today ? 'today' : ''}">${DAYS_SHORT[d - 1]}</span>`).join('')}</div>
    <div class="week-body" style="height:${(end - start) * PX}px">
      <div class="week-hours">${hours.map(m => `<span style="top:${(m - start) * PX}px">${m / 60}:00</span>`).join('')}</div>
      ${uniq.map(d => `<div class="week-col ${d === today ? 'today' : ''}">${D.slots.filter(s => s.day === d).map(s => {
        const sub = D.sub[s.subjectId];
        if (!sub) return '';
        return `<button class="week-ev" data-sub="${sub.id}" style="--c:${sub.color};top:${(minutes(s.start) - start) * PX}px;height:${Math.max(22, (minutes(s.end) - minutes(s.start)) * PX - 2)}px"><b>${esc(sub.name)}</b><small>${s.start} ${esc(s.location || '')}</small></button>`;
      }).join('')}</div>`).join('')}
    </div>
  </div>`;
}

function taskRow(t, s, showSubject) {
  const d = fmtDue(t.due);
  return `<div class="task ${t.done ? 'done' : ''}" style="--c:${s?.color || '#888'}">
    <button class="check ${t.done ? 'on' : ''}" data-done="${t.id}" aria-label="Afvinken">${t.done ? icon('check', 16) : ''}</button>
    <button class="task-body" data-task="${t.id}"><b>${esc(t.title)}</b><small>${showSubject && s ? `<i class="dot"></i>${esc(s.name)} · ` : ''}<span class="due ${t.done ? '' : d.cls}">${d.text}</span></small></button>
    ${t.url ? `<a class="icon-btn small" href="${esc(t.url)}" target="_blank" rel="noopener" aria-label="Open in Canvas">${icon('export', 16)}</a>` : ''}
  </div>`;
}

async function toggleTask(id) {
  const t = await db.get('assignments', id);
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  await db.put('assignments', t);
  if (t.done) toast('Opdracht afgevinkt ✓');
}

// ================= VAK =================
const TABS = [
  { id: 'notities', label: 'Aantekeningen', icon: 'pen' },
  { id: 'samenvattingen', label: 'Samenvattingen', icon: 'doc' },
  { id: 'opdrachten', label: 'Opdrachten', icon: 'task' },
  { id: 'oefenen', label: 'Oefenen', icon: 'cards' },
];

export async function subjectView(root, id, tab = 'notities') {
  const s = await db.get('subjects', id);
  if (!s) return go('#/');
  const [slots, notebooks, summaries, tasks, cards, plan] = await Promise.all([
    db.by('slots', 'subjectId', id), db.by('notebooks', 'subjectId', id), db.by('summaries', 'subjectId', id),
    db.by('assignments', 'subjectId', id), db.by('cards', 'subjectId', id), db.by('plan', 'subjectId', id)]);
  plan.sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
  const nx = nextOccurrences(slots, new Date(), 1)[0];
  const exam = plan.find(p => p.kind === 'exam' && p.date >= isoDay());
  const tabs = plan.length ? [...TABS, { id: 'planning', label: 'Planning', icon: 'list' }] : TABS;
  const counts = {
    notities: notebooks.filter(n => n.kind !== 'summary').length,
    samenvattingen: summaries.length + notebooks.filter(n => n.kind === 'summary').length,
    opdrachten: tasks.filter(t => !t.done).length,
    oefenen: cards.filter(c => isDue(c)).length,
    planning: plan.filter(p => p.kind === 'study' && !p.done && p.date <= isoDay()).length,
  };
  let body = '';
  if (tab === 'notities') body = notesTab(notebooks.filter(n => n.kind !== 'summary'), 'note');
  if (tab === 'samenvattingen') body = summariesTab(summaries, notebooks.filter(n => n.kind === 'summary'));
  if (tab === 'opdrachten') body = tasksTab(tasks, s);
  if (tab === 'oefenen') body = practiceTab(cards, s, summaries, await getSetting('practiceDir', 'normal'), await getSetting('practiceMode', 'flip'), +(await getSetting('practiceChunk', 5)));
  if (tab === 'planning') {
    const done = plan.filter(p => p.kind === 'study' && p.done).length, total = plan.filter(p => p.kind === 'study').length;
    body = `<div class="row gap wrap"><span class="muted">${done} van ${total} studieblokken af</span><button class="btn small" data-a="newblock">${icon('plus', 16)} Blok</button></div>
      <div class="plan-list">${planDays({ plan, sub: { [id]: s }, cards, summaries }, { subjectId: id })}</div>`;
  }

  root.innerHTML = `
  <div class="view subject" style="--c:${s.color}">
    <header class="topbar sub">
      <div class="row">
        <button class="icon-btn" data-a="back" aria-label="Terug">${icon('back')}</button>
        <div><h1><i class="dot big"></i>${esc(s.name)}</h1>
        <p class="muted">${nx ? `Volgende: ${whenLabel(nx)} · ${esc(nx.slot.kind || '')}${nx.slot.location ? ' · ' + esc(nx.slot.location) : ''}` : exam ? '' : 'Niet in je rooster'}${exam ? `${nx ? ' · ' : ''}<span class="exam-inline">${icon('flag', 14)} Tentamen ${fmtDate(exam.date)} (${daysUntil(exam.date) === 0 ? 'vandaag' : `nog ${daysUntil(exam.date)} d`})</span>` : ''}</p></div>
      </div>
      <div class="actions">
        <button class="icon-btn" data-a="search" aria-label="Zoeken">${icon('search')}</button>
        <button class="icon-btn" data-a="more" aria-label="Meer">${icon('more')}</button>
      </div>
    </header>
    <nav class="tabs">${tabs.map(t => `<a class="tab ${t.id === tab ? 'on' : ''}" href="#/vak/${id}/${t.id}">${icon(t.icon, 18)}<span>${t.label}</span>${counts[t.id] ? `<em>${counts[t.id]}</em>` : ''}</a>`).join('')}</nav>
    <div class="tab-body">${body}</div>
  </div>`;

  const rerender = () => subjectView(root, id, tab);
  root.onclick = async e => {
    const t = e.target;
    if (await handlePlanClick(t, rerender)) return;
    if (t.closest('[data-a=newblock]')) { if (await editPlanItem({ subjectId: id })) rerender(); return; }
    const nm = t.closest('[data-nbmenu]');
    if (nm) { e.stopPropagation(); return notebookMenu(nm, nm.dataset.nbmenu, rerender); }
    const nb = t.closest('[data-nb]'); if (nb) return go('#/notitie/' + nb.dataset.nb);
    const sm = t.closest('[data-sum]'); if (sm) return go('#/samenvatting/' + sm.dataset.sum);
    const cb = t.closest('[data-done]'); if (cb) { await toggleTask(cb.dataset.done); return rerender(); }
    const tk = t.closest('[data-task]'); if (tk) { if (await editTask(await db.get('assignments', tk.dataset.task))) rerender(); return; }
    const cd = t.closest('[data-card]'); if (cd) { if (await editCard(await db.get('cards', cd.dataset.card))) rerender(); return; }
    const a = t.closest('[data-a]');
    switch (a?.dataset.a) {
      case 'back': return go('#/');
      case 'search': return openSearch();
      case 'newnote': return newNotebook(id);
      case 'importpdf': {
        const f = await pickFile('application/pdf,.pdf');
        if (!f) return;
        const nb = await importPdf(id, f);
        if (nb) go('#/notitie/' + nb.id);
        return;
      }
      case 'newhand': return newNotebook(id, { kind: 'summary' });
      case 'newtyped': { const r = await editSummary({ subjectId: id }); if (r) go('#/samenvatting/' + r.id); return; }
      case 'newtask': if (await editTask({ subjectId: id })) rerender(); return;
      case 'newcard': if (await editCard({ subjectId: id })) rerender(); return;
      case 'delcards': {
        if (!await confirmDialog(`Alle ${cards.length} flitskaarten van "${s.name}" verwijderen, ook je voortgang en eigen kaarten? Samenvattingen blijven staan. Een pakket kun je daarna opnieuw importeren.`, { ok: 'Alles verwijderen', title: 'Alle flitskaarten verwijderen' })) return;
        await db.delMany('cards', cards.map(c => c.id));
        toast(`${cards.length} flitskaarten verwijderd`);
        return rerender();
      }
      case 'review': return go('#/oefenen/' + id);
      case 'cram': return go('#/oefenen/' + id + '?alles');
      case 'set': return go(`#/oefenen/${id}?set=${encodeURIComponent(a.dataset.set)}`);
      case 'setweak': return go(`#/oefenen/${id}?fout&set=${encodeURIComponent(a.dataset.set)}`);
      case 'weak': return go(`#/oefenen/${id}?fout`);
      case 'dir': await setSetting('practiceDir', a.dataset.dir); return rerender();
      case 'mode': await setSetting('practiceMode', a.dataset.mode); return rerender();
      case 'chunk': await setSetting('practiceChunk', +a.dataset.chunk); return rerender();
      case 'more': {
        const v = await menu(a, [
          { label: 'Vak bewerken', value: 'edit', icon: 'edit' },
          { label: 'Rooster aanpassen', value: 'rooster', icon: 'calendar' },
          '-',
          { label: 'Vak verwijderen', value: 'del', icon: 'trash', danger: true },
        ], { align: 'right' });
        if (v === 'edit' && await editSubject(s)) rerender();
        if (v === 'rooster') go('#/instellingen');
        if (v === 'del' && await confirmDialog(`"${s.name}" en alle aantekeningen, samenvattingen, opdrachten en kaarten van dit vak verwijderen? Dit kan niet ongedaan worden.`)) { await deleteSubject(id); go('#/'); }
      }
    }
  };
  const filter = $('.card-filter', root);
  if (filter) filter.addEventListener('input', () => {
    const q = filter.value.toLowerCase();
    $$('.card-row', root).forEach(r => { r.hidden = q && !r.textContent.toLowerCase().includes(q); });
  });
}

function notebookCard(n) {
  return `<div class="nb-card" data-nb="${n.id}">
    <div class="nb-thumb">${n.thumb ? `<img src="${n.thumb}" alt="">` : '<div class="paper-blank"></div>'}${n.hasAudio ? `<span class="nb-audio">${icon('mic', 14)}</span>` : ''}${n.layout === 'board' ? `<span class="nb-kind">${icon('board', 13)} Canvas</span>` : n.source === 'pdf' ? `<span class="nb-kind">${icon('slides', 13)} Slides</span>` : ''}</div>
    <div class="nb-meta"><b>${esc(n.title)}</b><small>${fmtDate(n.updated || n.created)}${n.layout !== 'board' && n.pageCount > 1 ? ` · ${n.pageCount} pagina's` : ''}</small></div>
    <button class="icon-btn small nb-more" data-nbmenu="${n.id}" aria-label="Opties">${icon('more', 18)}</button>
  </div>`;
}

function notesTab(list) {
  list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return `<div class="nb-grid">
    <button class="nb-card new" data-a="newnote"><div class="nb-thumb">${icon('plus', 34)}</div><div class="nb-meta"><b>Nieuwe notitie</b><small>Schrijf met je Pencil</small></div></button>
    <button class="nb-card new" data-a="importpdf"><div class="nb-thumb">${icon('slides', 34)}</div><div class="nb-meta"><b>Slides importeren</b><small>PDF uit Bestanden of Canvas</small></div></button>
    ${list.map(notebookCard).join('')}
  </div>${list.length ? '' : '<p class="empty">Nog geen aantekeningen. Tik op "Nieuwe notitie" om te beginnen. Tip: druk op de microfoon om het college op te nemen terwijl je schrijft.</p>'}`;
}

function summariesTab(sums, hand) {
  sums.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updated - a.updated);
  return `<div class="row gap wrap">
      <button class="btn primary" data-a="newtyped">${icon('doc', 18)} Getypte samenvatting</button>
      <button class="btn" data-a="newhand">${icon('pen', 18)} Handgeschreven samenvatting</button>
    </div>
    ${sums.length ? `<div class="sum-list">${sums.map(x => `<button class="sum-card" data-sum="${x.id}">
      <div class="sum-top"><span class="tag ${x.source === 'claude' ? 'ai' : ''}">${x.source === 'claude' ? icon('sparkle', 13) + ' Uit Canvas' : 'Eigen'}</span><small>${fmtDate(x.date)}</small>${x.read ? '' : '<span class="tag">nieuw</span>'}</div>
      <b>${esc(x.title)}</b>
      <p>${esc(plainText(x.markdown).slice(0, 180))}${plainText(x.markdown).length > 180 ? '…' : ''}</p>
      <div class="sum-foot">${x.terms?.length ? `<span>${x.terms.length} begrippen</span>` : ''}${x.questions?.length ? `<span>${x.questions.length} oefenvragen</span>` : ''}${x.sources?.length ? `<span>${icon('page', 13)} ${esc(x.sources[0])}${x.sources.length > 1 ? ` +${x.sources.length - 1}` : ''}</span>` : ''}</div>
    </button>`).join('')}</div>` : ''}
    ${hand.length ? `<h3 class="sec-title">Handgeschreven</h3><div class="nb-grid">${hand.map(notebookCard).join('')}</div>` : ''}
    ${!sums.length && !hand.length ? `<p class="empty">Nog geen samenvattingen. Vraag Claude op je laptop om "de colleges van vandaag samen te vatten" en importeer het bestand via <b>Importeer</b> op het dashboard. Of schrijf er zelf een.</p>` : ''}`;
}

function tasksTab(tasks, s) {
  const open = tasks.filter(t => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const done = tasks.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  return `<div class="row gap"><button class="btn primary" data-a="newtask">${icon('plus', 18)} Nieuwe opdracht</button></div>
    <div class="tasks big">${open.map(t => taskRow(t, s)).join('') || '<p class="empty">Geen openstaande opdrachten.</p>'}</div>
    ${done.length ? `<details class="done-list"><summary>Afgerond (${done.length})</summary><div class="tasks big">${done.map(t => taskRow(t, s)).join('')}</div></details>` : ''}`;
}

const PRACTICE_DIRS = [
  { v: 'normal', label: 'Begrip → uitleg' },
  { v: 'reverse', label: 'Uitleg → begrip' },
  { v: 'mixed', label: 'Gemengd' },
  { v: 'smart', label: 'Slim' }, // past zich aan: vraagt vaker de richting en kaarten die je fout doet
];
const PRACTICE_MODES = [
  { v: 'flip', label: 'Tikken' },
  { v: 'type', label: 'Typen' },
  { v: 'ink', label: 'Schrijven' }, // met de Pencil in een inktvak; handig voor formules (geen automatische check)
];
const PRACTICE_CHUNKS = [5, 10, 0]; // kaarten per ronde; 0 = alles in één keer

// Tekst met gemarkeerde stukken (spans: { start, end, hit })
function markText(text, spans) {
  let html = '', at = 0;
  for (const s of spans) {
    html += esc(text.slice(at, s.start)) + `<mark class="${s.hit ? 'tc-hit' : 'tc-miss'}">${esc(text.slice(s.start, s.end))}</mark>`;
    at = s.end;
  }
  return (html + esc(text.slice(at))).replace(/\n/g, '<br>');
}
// Kernbegrippen in het (al opgemaakte) modelantwoord markeren: groen = jij had hem ook, oranje = gemist
function markDom(el, terms) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const spans = findSpans(n.data, terms);
    if (!spans.length) continue;
    const tpl = document.createElement('template');
    tpl.innerHTML = markText(n.data, spans);
    n.replaceWith(tpl.content);
  }
}

function practiceTab(cards, s, summaries = [], dir = 'normal', mode = 'flip', chunk = 5) {
  const due = cards.filter(c => isDue(c)).length;
  const fresh = cards.filter(isNew).length;
  const weak = cards.filter(isWeak).length;
  const sets = deckSets(cards, summaries);
  return `<div class="stats">
      <div class="stat"><b>${due}</b><small>te herhalen</small></div>
      <div class="stat"><b>${fresh}</b><small>nieuw</small></div>
      <div class="stat"><b>${cards.length}</b><small>totaal</small></div>
    </div>
    <div class="row gap wrap practice-dir"><span class="muted small">Vraag:</span>
      <div class="seg small">${PRACTICE_DIRS.map(d => `<button class="pill ${d.v === dir ? 'on' : ''}" data-a="dir" data-dir="${d.v}">${d.label}</button>`).join('')}</div>
      <span class="muted small">Antwoord:</span>
      <div class="seg small">${PRACTICE_MODES.map(m => `<button class="pill ${m.v === mode ? 'on' : ''}" data-a="mode" data-mode="${m.v}">${m.label}</button>`).join('')}</div>
      <span class="muted small">Per ronde:</span>
      <div class="seg small">${PRACTICE_CHUNKS.map(n => `<button class="pill ${n === chunk ? 'on' : ''}" data-a="chunk" data-chunk="${n}">${n || 'Alles'}</button>`).join('')}</div>
    </div>
    <div class="row gap wrap">
      <button class="btn primary" data-a="review" ${due ? '' : 'disabled'}>${icon('cards', 18)} Start herhalen</button>
      <button class="btn" data-a="cram" ${cards.length ? '' : 'disabled'}>Alles door elkaar</button>
      <button class="btn ${weak ? 'weak-btn' : ''}" data-a="weak" ${weak ? '' : 'disabled'}>Foute kaarten${weak ? ` (${weak})` : ''}</button>
      <button class="btn ghost" data-a="newcard">${icon('plus', 18)} Kaart maken</button>
      ${cards.length ? `<button class="btn ghost danger" data-a="delcards">${icon('trash', 18)} Alle kaarten verwijderen</button>` : ''}
    </div>
    ${cards.length ? `<h3 class="sec-title">Per set leren</h3>
    <div class="deck-list">${sets.map(d => {
      const known = d.cards.filter(isKnown).length, w = d.cards.filter(isWeak).length, pct = Math.round(known / d.cards.length * 100);
      return `<div class="deck-row">
        <button class="deck-main" data-a="set" data-set="${esc(d.key)}">
          <b>${esc(d.label)}</b>
          <span class="deck-bar" title="${pct}% beheerst"><i style="width:${pct}%"></i></span>
          <small>${known} van ${d.cards.length} goed${w ? ` · <span class="weak-txt">${w} fout</span>` : ''}</small>
        </button>
        ${w ? `<button class="pill deck-weak" data-a="setweak" data-set="${esc(d.key)}" aria-label="Foute kaarten van deze set oefenen">${w} fout ›</button>` : ''}
      </div>`;
    }).join('')}</div>` : ''}
    ${cards.length ? `<input class="input card-filter" type="search" placeholder="Zoek in kaarten…">
    <div class="card-list">${cards.sort((a, b) => a.front.localeCompare(b.front)).map(c => `<button class="card-row" data-card="${c.id}">
      <span class="tag ${c.kind === 'vraag' ? 'q' : c.kind === 'begrip' ? 'ai' : ''}">${c.kind === 'vraag' ? 'Vraag' : c.kind === 'begrip' ? 'Begrip' : 'Eigen'}</span>
      <b>${esc(c.front)}</b><small>${esc(plainText(c.back))}</small>
      <em>${isWeak(c) ? '<span class="weak-txt">fout</span>' : isDue(c) ? 'nu' : fmtDate(c.srs.due)}</em>
    </button>`).join('')}</div>` : '<p class="empty">Nog geen kaarten. Begrippen en oefenvragen uit geïmporteerde samenvattingen worden automatisch flashcards. Je kunt ook zelf kaarten maken.</p>'}`;
}

async function notebookMenu(anchor, id, done) {
  const n = await db.get('notebooks', id);
  const v = await menu(anchor, [
    { label: 'Hernoemen', value: 'rename', icon: 'edit' },
    { label: 'Verplaats naar ander vak', value: 'move', icon: 'book' },
    '-',
    { label: 'Verwijderen', value: 'del', icon: 'trash', danger: true },
  ], { align: 'right' });
  if (v === 'rename') {
    const r = await modal({ title: 'Hernoemen', body: `<label class="field"><span>Titel</span><input name="title" value="${esc(n.title)}" required></label>` });
    if (r.action === 'ok') { n.title = r.data.title.trim(); await db.put('notebooks', n); done(); }
  }
  if (v === 'move') {
    const subs = await db.all('subjects');
    const r = await modal({ title: 'Verplaatsen naar', body: `<label class="field"><span>Vak</span><select name="s">${subs.map(s => `<option value="${s.id}" ${s.id === n.subjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` });
    if (r.action === 'ok') { n.subjectId = r.data.s; await db.put('notebooks', n); done(); }
  }
  if (v === 'del' && await confirmDialog(`"${n.title}" verwijderen, inclusief opnames?`)) { await deleteNotebook(id); done(); }
}

// ================= Bewerk-dialogen =================
export async function editSubject(s = null) {
  const subs = await db.all('subjects');
  const color = s?.color || SUBJECT_COLORS[subs.length % SUBJECT_COLORS.length];
  const r = await modal({
    title: s ? 'Vak bewerken' : 'Nieuw vak',
    body: `<label class="field"><span>Naam</span><input name="name" value="${esc(s?.name || '')}" placeholder="bijv. Calculus 1A" required autocomplete="off"></label>
      <div class="field"><span>Kleur</span><div class="color-pick">${SUBJECT_COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><i style="--c:${c}"></i></label>`).join('')}</div></div>
      <label class="field"><span>Naam in Canvas <small>(optioneel, komma's tussen meerdere)</small></span><input name="aliases" value="${esc((s?.aliases || []).join(', '))}" placeholder="bijv. 202400123 Calculus 1A" autocomplete="off"></label>`,
  });
  if (r.action !== 'ok') return null;
  const obj = {
    ...(s || { id: uid('v'), created: Date.now(), order: subs.length }),
    name: r.data.name.trim(), color: r.data.color || color,
    aliases: r.data.aliases.split(',').map(x => x.trim()).filter(Boolean),
  };
  await db.put('subjects', obj);
  return obj;
}

async function editSlot(slot, subjects) {
  const r = await modal({
    title: slot?.id ? 'College bewerken' : 'College toevoegen',
    body: `<label class="field"><span>Vak</span><select name="subjectId">${subjects.map(s => `<option value="${s.id}" ${s.id === slot?.subjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <div class="field-row">
        <label class="field"><span>Dag</span><select name="day">${DAYS.map((d, i) => `<option value="${i + 1}" ${i + 1 === (slot?.day || 1) ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="field"><span>Begin</span><input type="time" name="start" value="${slot?.start || '08:45'}" required></label>
        <label class="field"><span>Eind</span><input type="time" name="end" value="${slot?.end || '10:30'}" required></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Soort</span><select name="kind">${KINDS.map(k => `<option ${k === (slot?.kind || 'Hoorcollege') ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <label class="field"><span>Lokaal</span><input name="location" value="${esc(slot?.location || '')}" placeholder="bijv. Horst ZH 1" autocomplete="off"></label>
      </div>`,
    actions: slot?.id ? [{ label: 'Verwijder', value: 'del', danger: true }, { label: 'Annuleer', value: null }, { label: 'Opslaan', value: 'ok', primary: true }] : undefined,
  });
  if (r.action === 'del') { await db.del('slots', slot.id); return true; }
  if (r.action !== 'ok') return false;
  if (minutes(r.data.end) <= minutes(r.data.start)) { toast('De eindtijd moet na de begintijd liggen'); return false; }
  await db.put('slots', { ...(slot || {}), id: slot?.id || uid('t'), subjectId: r.data.subjectId, day: +r.data.day, start: r.data.start, end: r.data.end, kind: r.data.kind, location: r.data.location.trim() });
  return true;
}

export async function editTask(t) {
  const subjects = await db.all('subjects');
  if (!subjects.length) { toast('Maak eerst een vak aan'); return false; }
  const isEdit = !!t?.id;
  const r = await modal({
    title: isEdit ? 'Opdracht' : 'Nieuwe opdracht',
    body: `<label class="field"><span>Titel</span><input name="title" value="${esc(t?.title || '')}" required autocomplete="off"></label>
      <div class="field-row">
        <label class="field"><span>Vak</span><select name="subjectId">${subjects.map(s => `<option value="${s.id}" ${s.id === t?.subjectId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Deadline</span><input type="datetime-local" name="due" value="${esc((t?.due || '').slice(0, 16))}"></label>
      </div>
      <label class="field"><span>Notities</span><textarea name="notes" rows="4">${esc(t?.notes || '')}</textarea></label>
      ${t?.url ? `<p><a href="${esc(t.url)}" target="_blank" rel="noopener">Open in Canvas ↗</a></p>` : ''}`,
    actions: isEdit ? [{ label: 'Verwijder', value: 'del', danger: true }, { label: 'Annuleer', value: null }, { label: 'Opslaan', value: 'ok', primary: true }] : undefined,
  });
  if (r.action === 'del') { if (await confirmDialog('Opdracht verwijderen?')) { await db.del('assignments', t.id); return true; } return false; }
  if (r.action !== 'ok') return false;
  await db.put('assignments', { done: false, created: Date.now(), source: 'eigen', ...(t || {}), id: t?.id || uid('a'), title: r.data.title.trim(), subjectId: r.data.subjectId, due: r.data.due, notes: r.data.notes });
  return true;
}

async function editCard(c) {
  const isEdit = !!c?.id;
  const r = await modal({
    title: isEdit ? 'Kaart bewerken' : 'Nieuwe kaart',
    body: `<label class="field"><span>Voorkant (vraag / begrip)</span><textarea name="front" rows="2" required>${esc(c?.front || '')}</textarea></label>
      <label class="field"><span>Achterkant (antwoord)</span><textarea name="back" rows="4" required>${esc(c?.back || '')}</textarea></label>`,
    actions: isEdit ? [{ label: 'Verwijder', value: 'del', danger: true }, { label: 'Annuleer', value: null }, { label: 'Opslaan', value: 'ok', primary: true }] : undefined,
  });
  if (r.action === 'del') { await db.del('cards', c.id); return true; }
  if (r.action !== 'ok') return false;
  await db.put('cards', { kind: 'eigen', srs: { ...newSrs(), due: Date.now() }, created: Date.now(), ...(c || {}), id: c?.id || uid('c'), front: r.data.front.trim(), back: r.data.back.trim() });
  return true;
}

async function editSummary(x) {
  const r = await modal({
    title: x.id ? 'Samenvatting bewerken' : 'Nieuwe samenvatting',
    wide: true,
    body: `<div class="field-row">
        <label class="field grow"><span>Titel</span><input name="title" value="${esc(x.title || '')}" placeholder="bijv. Week 3 — Integralen" required></label>
        <label class="field"><span>Datum</span><input type="date" name="date" value="${esc(x.date || isoDay())}"></label>
      </div>
      <label class="field"><span>Tekst <small>(Markdown: # kop, **vet**, - lijstje, ==markeren==)</small></span><textarea name="markdown" rows="16" class="mono">${esc(x.markdown || '')}</textarea></label>`,
  });
  if (r.action !== 'ok') return null;
  const obj = { source: 'eigen', terms: [], questions: [], sources: [], created: Date.now(), read: true, ...x, id: x.id || uid('s'), title: r.data.title.trim(), date: r.data.date, markdown: r.data.markdown, updated: Date.now() };
  await db.put('summaries', obj);
  return obj;
}

// ================= SAMENVATTING =================
export async function summaryView(root, id, tab = 'tekst') {
  const x = await db.get('summaries', id);
  if (!x) return go('#/');
  const s = await db.get('subjects', x.subjectId);
  if (!x.read) { x.read = true; await db.put('summaries', x); }
  const tabs = [{ id: 'tekst', label: 'Samenvatting' }];
  if (x.terms?.length) tabs.push({ id: 'begrippen', label: `Begrippen (${x.terms.length})` });
  if (x.questions?.length) tabs.push({ id: 'vragen', label: `Oefenvragen (${x.questions.length})` });
  let body = '';
  if (tab === 'tekst') body = `<article class="md">${markdown(x.markdown) || '<p class="empty">Leeg.</p>'}</article>`;
  if (tab === 'begrippen') body = `<dl class="terms">${x.terms.map(t => `<div><dt>${esc(t.term)}</dt><dd>${esc(t.definition)}</dd></div>`).join('')}</dl>`;
  if (tab === 'vragen') body = `<ol class="questions">${x.questions.map((q, i) => `<li><p class="q">${esc(q.question)}</p><button class="btn small" data-reveal="${i}">Toon antwoord</button><div class="a" hidden>${markdown(q.answer)}</div></li>`).join('')}</ol>`;

  root.innerHTML = `
  <div class="view reader" style="--c:${s?.color || '#888'}">
    <header class="topbar sub">
      <div class="row">
        <button class="icon-btn" data-a="back" aria-label="Terug">${icon('back')}</button>
        <div><h1>${esc(x.title)}</h1><p class="muted"><i class="dot"></i>${esc(s?.name || '')} · ${fmtDate(x.date, { year: true })}${x.source === 'claude' ? ' · gemaakt door Claude uit Canvas' : ''}</p></div>
      </div>
      <div class="actions">
        ${x.terms?.length || x.questions?.length ? `<button class="btn" data-a="practice">${icon('cards', 18)} Oefen</button>` : ''}
        <button class="btn" data-a="note">${icon('pen', 18)} Notitie</button>
        <button class="icon-btn" data-a="more" aria-label="Meer">${icon('more')}</button>
      </div>
    </header>
    ${tabs.length > 1 ? `<nav class="tabs">${tabs.map(t => `<a class="tab ${t.id === tab ? 'on' : ''}" href="#/samenvatting/${id}/${t.id}">${t.label}</a>`).join('')}</nav>` : ''}
    ${x.sources?.length ? `<p class="sources">${icon('page', 14)} Bron: ${x.sources.map(esc).join(', ')}</p>` : ''}
    <div class="reader-body">${body}</div>
  </div>`;

  root.onclick = async e => {
    const rv = e.target.closest('[data-reveal]');
    if (rv) { const a = rv.nextElementSibling; a.hidden = !a.hidden; rv.textContent = a.hidden ? 'Toon antwoord' : 'Verberg antwoord'; return; }
    const a = e.target.closest('[data-a]');
    switch (a?.dataset.a) {
      case 'back': return go(`#/vak/${x.subjectId}/samenvattingen`);
      case 'practice': return go(`#/oefenen/sum:${x.id}?alles`);
      case 'note': return newNotebook(x.subjectId, { kind: 'summary', title: x.title });
      case 'more': {
        const v = await menu(a, [{ label: 'Bewerken', value: 'edit', icon: 'edit' }, '-', { label: 'Verwijderen', value: 'del', icon: 'trash', danger: true }], { align: 'right' });
        if (v === 'edit' && await editSummary(x)) summaryView(root, id, tab);
        if (v === 'del' && await confirmDialog('Samenvatting verwijderen? Bijbehorende flashcards worden ook verwijderd.')) {
          const cards = (await db.by('cards', 'subjectId', x.subjectId)).filter(c => c.summaryId === x.id);
          await db.delMany('cards', cards.map(c => c.id));
          await db.del('summaries', id);
          go(`#/vak/${x.subjectId}/samenvattingen`);
        }
      }
    }
  };
}

// ================= OEFENEN =================
export async function practiceView(root, scope, query = '') {
  const q = new URLSearchParams(query || '');
  const setKey = q.get('set');
  const weakOnly = q.has('fout'); // alleen kaarten waarop je de laatste keer Opnieuw of Moeilijk tikte
  const cram = q.has('alles') || !!setKey || weakOnly; // een set leer je helemaal, niet alleen wat 'te herhalen' is
  const dir = await getSetting('practiceDir', 'normal');
  let cards;
  let title = 'Herhalen';
  let back = '#/';
  if (scope === 'all') cards = await db.all('cards');
  else if (scope.startsWith('sum:')) {
    const sid = scope.slice(4);
    const x = await db.get('summaries', sid);
    cards = (await db.all('cards')).filter(c => c.summaryId === sid);
    title = x?.title || 'Oefenen';
    back = '#/samenvatting/' + sid;
  } else {
    const s = await db.get('subjects', scope);
    cards = await db.by('cards', 'subjectId', scope);
    title = s?.name || 'Oefenen';
    back = `#/vak/${scope}/oefenen`;
    if (setKey) {
      cards = cards.filter(c => deckKey(c) === setKey);
      const set = deckSets(cards, await db.by('summaries', 'subjectId', scope))[0];
      if (set) title = set.label;
    }
  }
  if (weakOnly) { cards = cards.filter(isWeak); title = 'Foute kaarten · ' + title; }
  const subs = Object.fromEntries((await db.all('subjects')).map(s => [s.id, s]));
  // Omgekeerd: je ziet de uitleg en noemt het begrip. Oefenvragen blijven altijd vraag → antwoord.
  const revOf = new Map();
  const reversed = c => {
    if (c.kind === 'vraag' || dir === 'normal') return false;
    if (dir === 'reverse') return true;
    if (!revOf.has(c.id)) revOf.set(c.id, dir === 'smart' ? smartDir(c) === 'r' : Math.random() < 0.5);
    return revOf.get(c.id);
  };
  // Hetzelfde begrip uit twee sets maar één keer vragen als je alles door elkaar oefent
  if (cram && !setKey) {
    const seen = new Set();
    cards = cards.filter(c => { const k = c.front.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  // Herhalen: eerst de kaarten die het langst over tijd zijn; daarna altijd husselen, zodat de volgorde elke keer anders is
  let pool = (cram ? cards : cards.filter(c => isDue(c)))
    .sort((a, b) => (isNew(a) - isNew(b)) || (a.srs?.due || 0) - (b.srs?.due || 0))
    .slice(0, cram ? 300 : 60);
  // Rondes: een grote set leer je in stukjes van 5 of 10. Bij een set eerst wat je nog niet kent, en verder in de volgorde
  // van de set (samenhangende begrippen in dezelfde ronde); binnen een ronde gehusseld. ?mix = de hele set door elkaar.
  const chunk = q.has('mix') ? 0 : +(await getSetting('practiceChunk', 5));
  const status = c => isWeak(c) ? 0 : isKnown(c) ? 2 : 1;
  pool = setKey && chunk
    ? pool.sort((a, b) => status(a) - status(b) || (a.deckOrder ?? 0) - (b.deckOrder ?? 0) || (a.pos ?? 999) - (b.pos ?? 999) || a.id.localeCompare(b.id))
    : dir === 'smart' ? weightedShuffle(pool) : shuffle(pool);
  const total = pool.length;
  const rounds = chunk ? Math.max(1, Math.ceil(total / chunk)) : 1;
  let round = 0, roundCards = [], doneRound = 0, reviewing = false, finished = false, queue = [];
  const startRound = (cardsOfRound, review = false) => { roundCards = cardsOfRound; queue = dir === 'smart' ? weightedShuffle(cardsOfRound) : shuffle(cardsOfRound); doneRound = 0; reviewing = review; };
  const nextRound = () => { startRound(chunk ? pool.slice(round * chunk, (round + 1) * chunk) : pool); round++; };
  nextRound();
  let done = 0, flipped = false;
  const doneIds = new Set(), reasked = new Set();

  // Typen: eerst zelf je antwoord typen, dan het modelantwoord met een check op de kernbegrippen
  let mode = await getSetting('practiceMode', 'flip');
  let typed = '', result = null;
  const vocabOf = new Map();
  for (const sid of new Set(pool.map(c => c.subjectId))) vocabOf.set(sid, buildVocab(await db.by('cards', 'subjectId', sid)));
  const keysOf = new Map();
  const keyTerms = c => {
    if (!keysOf.has(c.id)) keysOf.set(c.id, keyTermsFor(c, vocabOf.get(c.subjectId) || []));
    return keysOf.get(c.id);
  };
  function check(c, rev) {
    result = rev ? { rev: true, ok: checkTerm(typed, c.front) } : checkAnswer(typed, keyTerms(c));
    flipped = true;
    draw();
  }

  // Casuskaarten (voorkant begint met CASE) en lange vragen: kleinere, links uitgelijnde tekst
  const isCase = c => /^CASE /.test(c.front);
  const frontCls = c => isCase(c) || c.front.length > 110 ? 'long case-front' : '';
  // Bovenaan de kaart; bij Slim ook hoe vaak deze richting al fout ging
  function kindLabel(c, s, rev) {
    const wrong = dir === 'smart' ? c.dirs?.[rev ? 'r' : 'n']?.wrong || 0 : 0;
    return `${s ? esc(s.name) + ' · ' : ''}${rev ? 'Welk begrip is dit?' : isCase(c) ? '<span class="case-tag">Casus</span> herken het begrip' : c.kind === 'vraag' ? 'Oefenvraag' : c.kind === 'begrip' ? 'Begrip' : 'Kaart'}${wrong ? ` · <span class="weak-txt">${wrong}× fout in deze richting</span>` : ''}`;
  }

  function typedView(c, s, rev) {
    const kind = kindLabel(c, s, rev);
    const prompt = rev ? `<div class="flash-front long md">${markdown(c.back)}</div>` : `<div class="flash-front ${frontCls(c)}">${esc(c.front)}</div>`;
    if (!flipped) return `
      <div class="flash typing">
        <span class="flash-kind">${kind}</span>
        ${prompt}
        <textarea class="type-answer ${rev ? 'short' : ''}" rows="${rev ? 2 : 6}" placeholder="${rev ? 'Typ of schrijf het begrip…' : 'Typ je antwoord, of schrijf met je Pencil (Krabbel)… gebruik de vakbegrippen'}" autocapitalize="sentences" spellcheck="true">${esc(typed)}</textarea>
      </div>
      <div class="grades"><button class="btn primary block" data-a="check">Controleer <small class="kbd">${/Mac|iPad|iPhone/.test(navigator.platform) ? '⌘↵' : 'Ctrl+↵'}</small></button></div>`;
    const r = result;
    let verdict;
    if (r.rev) verdict = `<div class="term-check"><b class="${r.ok ? 'ok-txt' : 'weak-txt'}">${r.ok ? '✓ Juist begrip' : '✗ Niet het gezochte begrip'}</b></div>`;
    else if (r.total) verdict = `<div class="term-check">
        <div class="tc-head"><b>Kernbegrippen: ${r.hits} van ${r.total}</b><span class="tc-bar"><i style="width:${Math.round(r.ratio * 100)}%"></i></span></div>
        <div class="tc-chips">${r.terms.map(t => `<span class="tc ${t.hit ? 'hit' : 'miss'}">${t.hit ? '✓' : '✗'} ${esc(t.label)}</span>`).join('')}</div>
        ${r.bonus.length ? `<div class="tc-chips bonus"><small class="muted">Namen & jaartallen</small>${r.bonus.map(t => `<span class="tc ${t.hit ? 'hit' : 'miss'}">${t.hit ? '✓' : '✗'} ${esc(t.label)}</span>`).join('')}</div>` : ''}
      </div>`;
    else verdict = `<div class="term-check"><small class="muted">Voor deze kaart zijn geen kernbegrippen gevonden: vergelijk zelf.</small></div>`;
    const mine = typed.trim() ? markText(typed, r.rev ? [] : answerSpans(typed, r)) : '<em class="muted">Niets ingevuld</em>';
    const model = rev ? `<div class="flash-answer">${esc(c.front)}</div>` : `<div class="md model">${markdown(c.back)}</div>`;
    const advice = r.rev ? (r.ok ? 2 : 0) : r.advice;
    return `
      <div class="flash typing flipped">
        <span class="flash-kind">${kind}</span>
        ${prompt}
        ${verdict}
        <div class="type-compare">
          <section><h4>Jouw antwoord</h4><div class="mine">${mine}</div></section>
          <section><h4>Modelantwoord</h4>${model}</section>
        </div>
      </div>
      <div class="grades">${GRADES.map(g => `<button class="grade ${g.cls} ${g.key === advice ? 'suggest' : ''}" data-g="${g.key}"><b>${g.label}</b><small>${g.key === advice ? 'advies' : cram && g.key ? '' : intervalLabel(c.srs, g.key)}</small></button>`).join('')}</div>`;
  }

  // Schrijven: antwoord met de Pencil in een inktvak, daarna naast het modelantwoord en zelf beoordelen
  let inkStrokes = [], inkImg = '', penSeen = false;
  function inkView(c, s, rev) {
    const kind = kindLabel(c, s, rev);
    const prompt = rev ? `<div class="flash-front long md">${markdown(c.back)}</div>` : `<div class="flash-front ${frontCls(c)}">${esc(c.front)}</div>`;
    if (!flipped) return `
      <div class="flash typing inking">
        <span class="flash-kind">${kind}</span>
        ${prompt}
        <div class="ink-pad ${rev ? 'short' : ''}"><canvas aria-label="Schrijf hier je antwoord"></canvas>
          <div class="ink-tools"><button class="icon-btn small" data-a="inkundo" aria-label="Ongedaan maken">${icon('undo', 18)}</button><button class="pill" data-a="inkclear">Wis</button></div>
          <span class="ink-hint">${rev ? 'Schrijf het begrip' : 'Schrijf je antwoord'} met je Pencil</span>
        </div>
      </div>
      <div class="grades"><button class="btn primary block" data-a="inkreveal">Toon antwoord</button></div>`;
    const mine = inkImg ? `<img class="ink-mine" src="${inkImg}" alt="Jouw geschreven antwoord">` : '<em class="muted">Niets geschreven</em>';
    const model = rev ? `<div class="flash-answer">${esc(c.front)}</div>` : `<div class="md model">${markdown(c.back)}</div>`;
    return `
      <div class="flash typing flipped">
        <span class="flash-kind">${kind}</span>
        ${prompt}
        <div class="type-compare">
          <section><h4>Jouw antwoord</h4><div class="mine">${mine}</div></section>
          <section><h4>Modelantwoord</h4>${model}</section>
        </div>
        <p class="muted small">Vergelijk zelf: heb je de kern en de vakbegrippen? Kies dan hoe goed het ging.</p>
      </div>
      <div class="grades">${GRADES.map(g => `<button class="grade ${g.cls}" data-g="${g.key}"><b>${g.label}</b><small>${cram && g.key ? '' : intervalLabel(c.srs, g.key)}</small></button>`).join('')}</div>`;
  }
  // Tekenen in css-pixels; zodra de Pencil gebruikt is tekent een vinger niet meer (handpalm)
  function mountPad(cv) {
    if (!cv) return;
    const pad = cv.parentElement, color = getComputedStyle(pad).color;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const size = () => { const r = pad.getBoundingClientRect(); cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; };
    const ctx = cv.getContext('2d');
    // Klaar geschreven lijnen staan in een buffer; per frame tekenen we alleen die buffer + de lijn die je nu schrijft
    const baked = document.createElement('canvas');
    const bake = () => {
      baked.width = cv.width; baked.height = cv.height;
      const b = baked.getContext('2d');
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const st of inkStrokes) drawStroke(b, st);
    };
    let cur = null, raf = 0, rect = null;
    const repaint = () => {
      raf = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(baked, 0, 0);
      if (cur) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawStroke(ctx, cur); }
    };
    const soon = () => { if (!raf) raf = requestAnimationFrame(repaint); };
    size(); bake(); repaint();
    pad.repaint = () => { bake(); repaint(); };
    // Positie van het vak één keer per lijn opvragen (niet per punt: dat remt de Pencil af)
    const pt = e => [Math.round((e.clientX - rect.left) * 10) / 10, Math.round((e.clientY - rect.top) * 10) / 10, e.pointerType === 'pen' ? Math.round((e.pressure || 0.4) * 100) / 100 : 0.5];
    // Krabbel (handschrift → tekst) en scrollen mogen de Pencil-lijn niet onderbreken:
    // touch-events van de Pencil, en elke touchmove terwijl je schrijft, worden geblokkeerd (zoals in de notitie-editor)
    const stylus = e => [...e.touches].some(t => t.touchType === 'stylus');
    const block = e => { if (stylus(e) || cur) e.preventDefault(); };
    cv.addEventListener('touchstart', block, { passive: false });
    cv.addEventListener('touchmove', block, { passive: false });
    const docBlock = e => {
      if (!cv.isConnected) return document.removeEventListener('touchmove', docBlock);
      if (cur) e.preventDefault(); // hand naast het vak: pagina niet laten scrollen, anders breekt iOS je lijn af
    };
    document.addEventListener('touchmove', docBlock, { passive: false });
    cv.addEventListener('pointerdown', e => {
      if (e.pointerType === 'pen') penSeen = true;
      else if (e.pointerType === 'touch' && penSeen) return; // handpalm of vinger na de Pencil: niet tekenen
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch {}
      rect = cv.getBoundingClientRect();
      cur = { id: e.pointerId, tool: 'pen', c: color, w: e.pointerType === 'pen' ? 2.4 : 2.6, p: pt(e) };
      pad.classList.add('used');
      soon();
    });
    cv.addEventListener('pointermove', e => {
      if (!cur || e.pointerId !== cur.id) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents?.() || [];
      for (const ev of evs.length ? evs : [e]) cur.p.push(...pt(ev));
      soon();
    });
    const end = e => {
      if (!cur || e.pointerId !== cur.id) return;
      const { id, ...st } = cur;
      cur = null;
      if (st.p.length) { inkStrokes.push(st); const b = baked.getContext('2d'); b.setTransform(dpr, 0, 0, dpr, 0, 0); drawStroke(b, st); }
      soon();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }
  // Je geschreven antwoord als plaatje bewaren voor de vergelijking (alleen het beschreven deel)
  function inkSnapshot() {
    if (!inkStrokes.length) return '';
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const st of inkStrokes) for (let i = 0; i < st.p.length; i += 3) { x0 = Math.min(x0, st.p[i]); y0 = Math.min(y0, st.p[i + 1]); x1 = Math.max(x1, st.p[i]); y1 = Math.max(y1, st.p[i + 1]); }
    const pad = 12, k = 2, w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * k); c.height = Math.ceil(h * k);
    const ctx = c.getContext('2d');
    ctx.setTransform(k, 0, 0, k, (pad - x0) * k, (pad - y0) * k);
    for (const st of inkStrokes) drawStroke(ctx, st);
    return c.toDataURL('image/png');
  }
  function inkReveal() { inkImg = inkSnapshot(); flipped = true; draw(); }

  function draw() {
    const c = queue[0];
    if (!c && rounds > 1 && !finished) {
      // Tussenscherm na een ronde: door naar de volgende, deze nog eens, of alles tot nu toe door elkaar
      const next = Math.min(chunk, total - round * chunk);
      const msg = reviewing ? `Je hebt de kaarten van ronde 1–${round} door elkaar herhaald.` : `Je kent deze ${roundCards.length} kaarten. Nog ${total - round * chunk} te gaan.`;
      root.innerHTML = `<div class="view practice"><header class="topbar sub"><div class="row"><button class="icon-btn" data-a="back">${icon('x')}</button><div><h1>${esc(title)}</h1><p class="muted">${done} / ${total}</p></div></div></header>
        <div class="progress"><i style="width:${total ? done / total * 100 : 0}%"></i></div>
        <div class="practice-done round-done"><div class="welcome-art">${icon('check', 44)}</div><h2>${reviewing ? 'Herhaling klaar' : `Ronde ${round} van ${rounds} klaar`}</h2>
        <p class="muted">${msg}</p>
        <div class="round-actions">
          ${round < rounds ? `<button class="btn primary" data-a="nextround">Volgende ${next} kaarten</button>` : ''}
          ${!reviewing ? `<button class="btn" data-a="againround">Deze ronde nog eens</button>` : ''}
          ${round >= 2 && !reviewing ? `<button class="btn" data-a="cumul">Ronde 1–${round} door elkaar</button>` : ''}
          ${round >= rounds ? `<button class="btn primary" data-a="finish">Klaar</button>` : `<button class="btn ghost" data-a="back">Stoppen</button>`}
        </div></div></div>`;
      return;
    }
    if (!c) {
      root.innerHTML = `<div class="view practice"><header class="topbar sub"><div class="row"><button class="icon-btn" data-a="back">${icon('back')}</button><h1>${esc(title)}</h1></div></header>
        <div class="practice-done"><div class="welcome-art">${icon('check', 44)}</div><h2>${total ? 'Klaar!' : 'Niets te herhalen'}</h2>
        <p class="muted">${total ? `Je hebt ${done} kaart${done === 1 ? '' : 'en'} geoefend. ${weakOnly ? 'Kaarten die je nu Goed had, staan niet meer bij je foute kaarten.' : 'Moeilijke kaarten komen binnenkort terug, makkelijke pas later.'}` : weakOnly ? 'Je hebt geen foute kaarten meer. Goed bezig!' : 'Alle kaarten zijn up-to-date. Kom later terug of kies "Alles door elkaar".'}</p>
        <div class="round-actions">${rounds > 1 && setKey ? `<button class="btn" data-a="mixall">Hele set door elkaar</button>` : ''}<button class="btn primary" data-a="back">Terug</button></div></div></div>`;
      return;
    }
    const s = subs[c.subjectId];
    const counter = rounds > 1 ? (reviewing ? `Herhaling ronde 1–${round} · ${doneRound} / ${roundCards.length}` : `Ronde ${round} van ${rounds} · ${doneRound} / ${roundCards.length}`) : `${done} / ${total}`;
    const rev = reversed(c);
    const head = `
    <div class="view practice" style="--c:${s?.color || '#888'}">
      <header class="topbar sub"><div class="row"><button class="icon-btn" data-a="back" aria-label="Stoppen">${icon('x')}</button><div><h1>${esc(title)}</h1><p class="muted">${counter}${cram && rounds === 1 ? ' · oefenmodus' : ''}</p></div></div>
        <div class="actions"><div class="seg small">${PRACTICE_MODES.map(m => `<button class="pill ${m.v === mode ? 'on' : ''}" data-a="mode" data-mode="${m.v}">${m.label}</button>`).join('')}</div></div></header>
      <div class="progress"><i style="width:${total ? done / total * 100 : 0}%"></i></div>`;
    if (mode === 'type') {
      root.innerHTML = head + typedView(c, s, rev) + '</div>';
      if (flipped && !result.rev) { const m = root.querySelector('.model'); if (m) markDom(m, result.terms.concat(result.bonus)); }
      // Alleen met een echt toetsenbord direct focussen; op de iPad zou anders het schermtoetsenbord over Krabbel heen springen
      if (!flipped && !navigator.maxTouchPoints) { const ta = root.querySelector('.type-answer'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      return;
    }
    if (mode === 'ink') {
      root.innerHTML = head + inkView(c, s, rev) + '</div>';
      if (!flipped) mountPad(root.querySelector('.ink-pad canvas'));
      return;
    }
    root.innerHTML = head + `
      <button class="flash ${flipped ? 'flipped' : ''}" data-a="flip">
        <span class="flash-kind">${kindLabel(c, s, rev)}</span>
        ${rev ? `<span class="flash-front long md">${markdown(c.back)}</span>` : `<span class="flash-front ${frontCls(c)}">${esc(c.front)}</span>`}
        ${flipped ? (rev ? `<span class="flash-back flash-answer">${esc(c.front)}</span>` : `<span class="flash-back md">${markdown(c.back)}</span>`) : '<span class="flash-hint">Tik om het antwoord te zien</span>'}
      </button>
      <div class="grades">${flipped ? GRADES.map(g => `<button class="grade ${g.cls}" data-g="${g.key}"><b>${g.label}</b><small>${cram && g.key ? '' : intervalLabel(c.srs, g.key)}</small></button>`).join('') : `<button class="btn primary block" data-a="flip">Toon antwoord</button>`}</div>
    </div>`;
  }
  async function grade(g) {
    const c = queue.shift();
    if (!cram || g === 0) c.srs = schedule(c.srs, g);
    c.last = { g, t: Date.now() }; // voor 'foute kaarten' en de voortgang per set
    recordDir(c, reversed(c) ? 'r' : 'n', g); // per richting: begrip → uitleg (n) of uitleg → begrip (r)
    await db.put('cards', c);
    revOf.delete(c.id);
    if (g === 0) queue.splice(Math.min(3 + Math.floor(Math.random() * 4), queue.length), 0, c);
    // Slim: Moeilijk komt later in deze ronde nog één keer terug (de richting wordt dan opnieuw gekozen)
    else if (g === 1 && dir === 'smart' && !reasked.has(c.id)) { reasked.add(c.id); queue.splice(Math.min(5 + Math.floor(Math.random() * 4), queue.length), 0, c); }
    else { doneIds.add(c.id); done = doneIds.size; doneRound++; } // een ronde herhalen telt niet dubbel
    flipped = false;
    typed = '';
    result = null;
    inkStrokes = []; inkImg = '';
    draw();
  }
  root.oninput = e => { if (e.target.matches('.type-answer')) typed = e.target.value; };
  root.onclick = async e => {
    const g = e.target.closest('[data-g]');
    if (g) return grade(+g.dataset.g);
    const el = e.target.closest('[data-a]');
    const a = el?.dataset.a;
    if (a === 'back') go(back);
    if (a === 'flip' && !flipped) { flipped = true; draw(); }
    if (a === 'check' && queue[0]) check(queue[0], reversed(queue[0]));
    if (a === 'inkreveal' && queue[0]) inkReveal();
    if (a === 'inkundo') { inkStrokes.pop(); root.querySelector('.ink-pad')?.repaint?.(); }
    if (a === 'inkclear') { inkStrokes = []; const p = root.querySelector('.ink-pad'); p?.classList.remove('used'); p?.repaint?.(); }
    if (a === 'nextround') { nextRound(); draw(); }
    if (a === 'againround') { startRound(roundCards); draw(); }
    if (a === 'cumul') { startRound(pool.slice(0, round * chunk), true); draw(); }
    if (a === 'finish') { finished = true; draw(); }
    if (a === 'mixall') go(`#/oefenen/${scope}?set=${encodeURIComponent(setKey)}&mix`);
    if (a === 'mode' && el.dataset.mode !== mode) {
      mode = el.dataset.mode;
      await setSetting('practiceMode', mode);
      flipped = false; result = null;
      draw();
    }
  };
  const key = e => {
    if (!root.querySelector('.practice')) return document.removeEventListener('keydown', key);
    if (!queue[0]) return;
    if (e.target.matches?.('.type-answer')) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); check(queue[0], reversed(queue[0])); }
      return;
    }
    if (e.key === ' ') { e.preventDefault(); if (!flipped) { if (mode === 'type') check(queue[0], reversed(queue[0])); else if (mode === 'ink') inkReveal(); else { flipped = true; draw(); } } }
    if (flipped && '1234'.includes(e.key)) grade(+e.key - 1);
  };
  document.addEventListener('keydown', key);
  draw();
  return () => document.removeEventListener('keydown', key);
}

// ================= INSTELLINGEN =================
export async function settingsView(root) {
  const D = await loadAll();
  const name = await getSetting('name', '');
  const paper = await getSetting('defaultPaper', 'lined');
  const autoShift = await getSetting('autoShift', true);
  const inboxUrl = await getSetting('inboxUrl', '');
  const inboxAt = await getSetting('inboxImportedAt', 0);
  let est = null, persisted = false;
  try { est = await navigator.storage?.estimate?.(); persisted = await navigator.storage?.persisted?.(); } catch {}
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const mb = b => (b / 1048576).toFixed(b > 1e8 ? 0 : 1) + ' MB';

  root.innerHTML = `
  <div class="view settings">
    <header class="topbar sub"><div class="row"><button class="icon-btn" data-a="back" aria-label="Terug">${icon('back')}</button><h1>Instellingen</h1></div></header>

    ${standalone || RUNTIME.sandbox ? '' : `<section class="card notice"><h3>📲 Zet Vakwerk op je beginscherm</h3><p>Open deze pagina in <b>Safari</b> en tik op het deel-icoon <b>⬆︎</b> en dan <b>"Zet op beginscherm"</b>. Dan werkt de app schermvullend en offline, en blijven je notities veilig bewaard.</p></section>`}

    <section class="card">
      <div class="card-h"><h3>Vakken</h3><button class="btn small" data-a="addsubject">${icon('plus', 16)} Vak</button></div>
      <div class="list">${D.subjects.map(s => `<button class="list-row" data-editsub="${s.id}"><i class="dot" style="--c:${s.color}"></i><span><b>${esc(s.name)}</b>${s.aliases?.length ? `<small>Canvas: ${esc(s.aliases.join(', '))}</small>` : ''}</span>${icon('edit', 18)}</button>`).join('') || '<p class="empty small">Nog geen vakken.</p>'}</div>
    </section>

    <section class="card">
      <div class="card-h"><h3>Weekrooster</h3><button class="btn small" data-a="addslot" ${D.subjects.length ? '' : 'disabled'}>${icon('plus', 16)} College</button></div>
      ${[1, 2, 3, 4, 5, 6, 7].map(d => {
        const list = D.slots.filter(s => s.day === d).sort((a, b) => minutes(a.start) - minutes(b.start));
        if (!list.length) return '';
        return `<div class="day-group"><h4>${DAYS[d - 1]}</h4>${list.map(sl => {
          const s = D.sub[sl.subjectId];
          return `<button class="list-row" data-slot="${sl.id}"><i class="dot" style="--c:${s?.color || '#888'}"></i><span><b>${sl.start}–${sl.end} · ${esc(s?.name || '?')}</b><small>${esc(sl.kind || '')}${sl.location ? ' · ' + esc(sl.location) : ''}</small></span>${icon('edit', 18)}</button>`;
        }).join('')}</div>`;
      }).join('') || '<p class="empty small">Nog geen colleges. Voeg per vak je vaste colleges toe.</p>'}
    </section>

    <section class="card">
      <h3>Algemeen</h3>
      <label class="field"><span>Je naam (voor de begroeting)</span><input class="input" data-set="name" value="${esc(name)}" placeholder="optioneel"></label>
      <label class="menu-toggle setting"><span><b>Automatisch inhalen</b><small>Studieblokken die je op een dag niet hebt afgevinkt, schuiven de volgende keer dat je de app opent door naar de eerstvolgende vrije momenten vóór het tentamen.</small></span><input type="checkbox" data-toggle="autoShift" ${autoShift ? 'checked' : ''}><i class="switch"></i></label>
      <div class="field"><span>Standaard papier voor nieuwe notities</span><div class="seg wrap">${PAPERS.map(p => `<button class="pill ${p.id === paper ? 'on' : ''}" data-paper="${p.id}">${p.label}</button>`).join('')}</div></div>
    </section>

    <section class="card">
      <h3>Inbox van Claude</h3>
      ${RUNTIME.artifact ? `<p class="muted">Deze versie draait als artifact op claude.ai. Alles staat in de database van het artifact: je ziet hetzelfde op je iPad en je laptop, en Claude zet nieuwe samenvattingen, planning en deadlines er direct in.${inboxAt ? ` Laatst binnengekomen: ${fmtDate(inboxAt)} ${new Date(inboxAt).toTimeString().slice(0, 5)}.` : ''}</p><div class="row gap wrap"><button class="btn primary" data-a="inboxpull">${icon('import', 18)} Nu ophalen</button></div>` : RUNTIME.sandbox ? '<p class="muted">Opslaan in het artifact lukt nu niet (ben je ingelogd?). Je gegevens staan tijdelijk alleen in deze browser.</p>' : inboxUrl
        ? `<p class="muted">Gekoppeld ✓ — alles wat Claude voor je klaarzet (samenvattingen, planning, deadlines) komt vanzelf binnen als je de app opent.${inboxAt ? ` Laatst binnengekomen: ${fmtDate(inboxAt)} ${new Date(inboxAt).toTimeString().slice(0, 5)}.` : ''}</p>
           <div class="row gap wrap"><button class="btn primary" data-a="inboxpull">${icon('import', 18)} Nu ophalen</button><button class="btn ghost" data-a="inboxoff">Ontkoppelen</button></div>`
        : `<p class="muted">Plak hier de koppel-link die Claude je gaf. Daarna komt alles vanzelf binnen, zonder importeren.</p>
           <div class="row gap wrap"><input class="input grow-input" data-inbox placeholder="Plak hier je koppel-link" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn primary" data-a="inboxon">Koppelen</button></div>`}
    </section>

    <section class="card">
      <h3>Samenvattingen uit Canvas</h3>
      <p class="muted">Vraag Claude op je laptop bijvoorbeeld: <i>"Maak de colleges van vandaag klaar."</i> Claude leest de slides in Canvas en zet een bestand <code>vakwerk-…json</code> in je <b>OneDrive › Vakwerk</b>-map. Tik hier op <b>Importeer</b> en kies dat bestand via Bestanden › OneDrive.</p>
      <button class="btn primary" data-a="import">${icon('import', 18)} Importeer pakket</button>
    </section>

    <section class="card">
      <h3>Back-up</h3>
      <p class="muted">${RUNTIME.artifact ? 'Je gegevens staan in dit artifact op claude.ai.' : 'Alles staat alleen op deze iPad.'} Maak af en toe een back-up naar Bestanden, iCloud of OneDrive, inclusief alle inkt en opnames.</p>
      <div class="row gap wrap">
        <button class="btn" data-a="backup">${icon('export', 18)} Maak back-up</button>
        <button class="btn ghost" data-a="restore">${icon('import', 18)} Zet back-up terug</button>
      </div>
      <p class="muted small">${est ? `In gebruik: ${mb(est.usage || 0)}` : ''}${persisted ? ' · opslag beschermd ✓' : ''}</p>
    </section>

    <section class="card">
      <h3>Pencil-gebaren</h3>
      <ul class="tips">
        <li><b>Krassen om te gummen.</b> Zigzag snel over een woord om het te wissen.</li>
        <li><b>Vasthouden voor vormen.</b> Teken een lijn, cirkel of rechthoek en houd de pen even stil. De vorm wordt dan strak.</li>
        <li><b>Cirkel om inkt en vasthouden</b> = selecteren. Daarna kun je verplaatsen, kopiëren of de kleur aanpassen.</li>
        <li><b>Tik met 2 vingers</b> = ongedaan maken, <b>3 vingers</b> = opnieuw.</li>
        <li><b>Knijpen met 2 vingers</b> = zoomen. Met één vinger scrol je, alleen de Pencil tekent.</li>
        <li><b>Strak schrijven</b> (⚙ in de editor) strijkt bibberige lijnen glad.</li>
        <li><b>Opnemen:</b> tijdens het opnemen onthoudt elke lijn wanneer je hem schreef. Tik er later op om terug te luisteren.</li>
      </ul>
    </section>
    <section class="card">
      <h3>Opnieuw beginnen</h3>
      <p class="muted">Haal de voorbeelddata weg, of wis alles en begin met een lege app.</p>
      <div class="row gap wrap">
        ${D.subjects.some(isDemoSubject) ? `<button class="btn" data-a="removedemo">${icon('sparkle', 18)} Voorbeelddata verwijderen</button>` : ''}
        <button class="btn danger" data-a="wipe">${icon('trash', 18)} Alles wissen</button>
      </div>
    </section>
    <p class="muted small center">Vakwerk ${APP_VERSION} · je data blijft op dit apparaat</p>
  </div>`;

  const rerender = () => settingsView(root);
  root.onclick = async e => {
    const t = e.target;
    const es = t.closest('[data-editsub]');
    if (es) {
      const s = D.sub[es.dataset.editsub];
      const v = await menu(es, [{ label: 'Bewerken', value: 'edit', icon: 'edit' }, { label: 'Verwijderen', value: 'del', icon: 'trash', danger: true }], { align: 'right' });
      if (v === 'edit' && await editSubject(s)) rerender();
      if (v === 'del' && await confirmDialog(`"${s.name}" en alles wat erbij hoort verwijderen?`)) { await deleteSubject(s.id); rerender(); }
      return;
    }
    const sl = t.closest('[data-slot]');
    if (sl) { if (await editSlot(D.slots.find(x => x.id === sl.dataset.slot), D.subjects)) rerender(); return; }
    const pp = t.closest('[data-paper]');
    if (pp) { await setSetting('defaultPaper', pp.dataset.paper); return rerender(); }
    switch (t.closest('[data-a]')?.dataset.a) {
      case 'back': return go('#/');
      case 'addsubject': if (await editSubject()) rerender(); return;
      case 'addslot': if (await editSlot(null, D.subjects)) rerender(); return;
      case 'import': return doImport();
      case 'backup': return exportBackup();
      case 'restore': return doImport();
      case 'inboxon': { const v = $('[data-inbox]', root).value.trim(); if (await connectInbox(v) !== null || await getSetting('inboxUrl', '')) rerender(); return; }
      case 'inboxpull': await checkInbox({ force: true }); rerender(); return;
      case 'inboxoff': await disconnectInbox(); rerender(); return;
      case 'removedemo': if (await removeDemo()) rerender(); return;
      case 'wipe': if (await wipeAll()) go('#/'); return;
    }
  };
  $('[data-set=name]', root).addEventListener('change', e => setSetting('name', e.target.value.trim()));
  $('[data-toggle=autoShift]', root).addEventListener('change', e => { setSetting('autoShift', e.target.checked); toast(e.target.checked ? 'Automatisch inhalen staat aan' : 'Automatisch inhalen staat uit'); });
}

// ================= ZOEKEN =================
export async function openSearch() {
  const D = await loadAll();
  const idx = [
    ...D.subjects.map(s => ({ t: 'Vak', title: s.name, text: (s.aliases || []).join(' '), href: '#/vak/' + s.id, c: s.color })),
    ...D.notebooks.map(n => ({ t: n.kind === 'summary' ? 'Handgeschreven' : 'Notitie', title: n.title, text: '', href: '#/notitie/' + n.id, c: D.sub[n.subjectId]?.color, sub: D.sub[n.subjectId]?.name })),
    ...D.summaries.map(x => ({ t: 'Samenvatting', title: x.title, text: plainText(x.markdown) + ' ' + (x.terms || []).map(t => t.term + ' ' + t.definition).join(' '), href: '#/samenvatting/' + x.id, c: D.sub[x.subjectId]?.color, sub: D.sub[x.subjectId]?.name })),
    ...D.cards.map(c => ({ t: c.kind === 'vraag' ? 'Oefenvraag' : 'Begrip', title: c.front, text: c.back, href: c.summaryId ? '#/samenvatting/' + c.summaryId + (c.kind === 'vraag' ? '/vragen' : '/begrippen') : `#/vak/${c.subjectId}/oefenen`, c: D.sub[c.subjectId]?.color, sub: D.sub[c.subjectId]?.name })),
    ...D.assignments.map(a => ({ t: 'Opdracht', title: a.title, text: a.notes || '', href: `#/vak/${a.subjectId}/opdrachten`, c: D.sub[a.subjectId]?.color, sub: D.sub[a.subjectId]?.name })),
  ];
  const p = modal({
    title: '', wide: true,
    body: `<div class="search-box">${icon('search')}<input class="search-in" type="search" placeholder="Zoek in vakken, notities, samenvattingen, begrippen…" autocomplete="off"></div><div class="search-res"><p class="empty small">Typ om te zoeken</p></div>`,
    actions: [{ label: 'Sluiten', value: null }],
    onOpen: (form, close) => {
      const inp = $('.search-in', form), res = $('.search-res', form);
      inp.addEventListener('input', () => {
        const q = inp.value.trim().toLowerCase();
        if (!q) { res.innerHTML = '<p class="empty small">Typ om te zoeken</p>'; return; }
        const hits = idx.map(it => {
          const ti = it.title.toLowerCase().indexOf(q), tx = it.text.toLowerCase().indexOf(q);
          return { it, score: ti >= 0 ? 2 : tx >= 0 ? 1 : 0, tx };
        }).filter(h => h.score).sort((a, b) => b.score - a.score).slice(0, 40);
        res.innerHTML = hits.length ? hits.map(({ it, tx }) => {
          const snip = tx >= 0 ? it.text.slice(Math.max(0, tx - 50), tx + 90) : '';
          return `<a class="search-hit" href="${it.href}" style="--c:${it.c || '#888'}"><span class="tag">${it.t}</span><span><b>${esc(it.title)}</b><small>${it.sub ? esc(it.sub) + (snip ? ' · ' : '') : ''}${esc(snip)}</small></span></a>`;
        }).join('') : '<p class="empty small">Niets gevonden</p>';
      });
      res.addEventListener('click', e => { if (e.target.closest('a')) close(null); });
    },
  });
  return p;
}
