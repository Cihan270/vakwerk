// Inhaalplanning: studieblokken die niet zijn afgevinkt schuiven door naar de eerstvolgende
// momenten vóór het tentamen van dat vak. De volgorde per vak blijft gelijk (stof bouwt op),
// en als er een blok bij moet komen, wordt een "Vrij"-blok gebruikt — de avond/dag vóór een
// tentamen pas als laatste redmiddel.
import { db, getSetting, setSetting } from './db.js';
import { isoDay, parseDay, toast } from './util.js';

const SLOTS_PER_DAY = 3;
const key = (date, slot) => `${date}|${slot}`;
const byKey = (a, b) => a.date.localeCompare(b.date) || a.slot - b.slot;
export const addDays = (iso, n) => { const d = parseDay(iso); d.setDate(d.getDate() + n); return isoDay(d); };

// plan: alle planningsitems. today: 'YYYY-MM-DD'.
// force: ids die óók door moeten schuiven (handmatig "schuif door"), start: vanaf welke dag er geschoven mag worden.
// Geeft null als er niets te doen is, anders { items (gewijzigde items), removed (ids van opgeofferde vrij-blokken), moved, overflow, count }.
export function reschedule(plan, today, { force = new Set(), start = today } = {}) {
  const items = plan.map(p => ({ ...p }));
  const isStudy = p => p.kind === 'study';
  const overdueAll = items.filter(p => isStudy(p) && !p.done && ((p.date < today && !p.keep) || force.has(p.id)));
  if (!overdueAll.length) return null;
  const overdueIds = new Set(overdueAll.map(p => p.id));
  const startKey = key(start, 0);

  // Eerste (nog komende) tentamen per vak = deadline
  const exams = {};
  for (const p of items) {
    if (p.kind !== 'exam' || !p.subjectId || p.date < today) continue;
    const k = key(p.date, p.slot);
    if (!exams[p.subjectId] || k < exams[p.subjectId]) exams[p.subjectId] = k;
  }
  const examDays = new Set(items.filter(p => p.kind === 'exam').map(p => p.date));
  // 0 = gewone dag, 1 = tentamendag (na het tentamen), 2 = dag vóór een tentamen (rust is dan belangrijk)
  const nearExam = d => examDays.has(addDays(d, 1)) ? 2 : examDays.has(d) ? 1 : 0;
  const lastDate = items.reduce((m, p) => (p.date > m ? p.date : m), today);

  // Wie zit waar
  const occ = new Map();
  const at = k => { if (!occ.has(k)) occ.set(k, []); return occ.get(k); };
  for (const p of items) at(key(p.date, p.slot)).push(p);
  const remove = (arr, p) => { const i = arr.indexOf(p); if (i >= 0) arr.splice(i, 1); };

  const removed = new Set(), changed = new Set();
  let overflow = 0;
  const subjects = [...new Set(overdueAll.map(p => p.subjectId))]
    .sort((a, b) => (exams[a] || '~').localeCompare(exams[b] || '~'));

  for (const sid of subjects) {
    const deadline = exams[sid] || key(addDays(lastDate, 14), SLOTS_PER_DAY);
    const overdue = overdueAll.filter(p => p.subjectId === sid).sort(byKey);
    const future = items.filter(p => isStudy(p) && p.subjectId === sid && !p.done && !overdueIds.has(p.id) && !removed.has(p.id)
      && key(p.date, p.slot) >= startKey && key(p.date, p.slot) < deadline).sort(byKey);
    const chain = [...overdue, ...future];
    const own = future.map(p => [p.date, p.slot]);
    const ownKeys = new Set(own.map(([d, s]) => key(d, s)));
    for (const p of chain) remove(at(key(p.date, p.slot)), p);

    // Extra plekken zoeken: leeg of "vrij" (eerst gewone dagen, dan rond een tentamen)
    const need = overdue.length;
    const cands = [];
    const endDate = deadline.slice(0, 10);
    for (let d = start; d <= endDate; d = addDays(d, 1)) {
      for (let s = 0; s < SLOTS_PER_DAY; s++) {
        const k = key(d, s);
        if (k >= deadline || ownKeys.has(k)) continue;
        const here = at(k);
        if (here.some(p => p.kind !== 'rest')) continue;
        cands.push({ d, s, tier: nearExam(d), rest: here.slice() });
      }
    }
    cands.sort((a, b) => a.tier - b.tier || a.d.localeCompare(b.d) || a.s - b.s);
    const picked = cands.slice(0, need);
    for (const c of picked) for (const r of c.rest) { removed.add(r.id); remove(at(key(c.d, c.s)), r); }

    const slots = [...own, ...picked.map(c => [c.d, c.s])].sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
    chain.forEach((p, i) => {
      let [d, s] = slots[Math.min(i, slots.length - 1)] || [start, 0];
      if (i >= slots.length) overflow++; // past niet meer: wordt op het laatste moment erbij gezet
      if (p.date !== d || p.slot !== s) {
        p.movedFrom = p.movedFrom || p.date;
        p.date = d;
        p.slot = s;
        changed.add(p);
      }
      at(key(d, s)).push(p);
    });
  }
  const moved = [...changed].length;
  return { items: [...changed].filter(p => !removed.has(p.id)), removed: [...removed], moved, overflow, count: overdueAll.length };
}

async function apply(plan, res, label) {
  await setSetting('planUndo', { at: Date.now(), date: isoDay(), label, moved: res.moved, items: plan });
  if (res.removed.length) await db.delMany('plan', res.removed);
  if (res.items.length) await db.putMany('plan', res.items);
}

// Wordt bij het openen van de app aangeroepen: alles van vorige dagen dat niet af is, schuift door.
export async function catchUp() {
  if (!(await getSetting('autoShift', true))) return null;
  const plan = await db.all('plan');
  const res = reschedule(plan, isoDay());
  if (!res || !res.moved) return null;
  await apply(plan, res, 'auto');
  const n = res.count;
  toast(`${n} blok${n > 1 ? 'ken' : ''} die nog niet af ${n > 1 ? 'waren' : 'was'} doorgeschoven${res.overflow ? ` — let op: ${res.overflow} past niet meer vóór het tentamen` : ''}`, {
    action: 'Bekijk', onAction: () => { location.hash = '#/planning'; },
  });
  return res;
}

// "Niet gelukt — schuif door": één blok (en de rest van dat vak) opschuiven vanaf morgen
export async function shiftBlock(id) {
  const plan = await db.all('plan');
  const p = plan.find(x => x.id === id);
  if (!p) return null;
  const today = isoDay();
  const start = addDays(p.date > today ? p.date : today, 1);
  const res = reschedule(plan, today, { force: new Set([id]), start });
  if (!res || !res.moved) { toast('Er is geen ruimte meer om dit blok door te schuiven'); return null; }
  await apply(plan, res, 'manual');
  toast(`Doorgeschoven${res.moved > 1 ? ` (${res.moved} blokken verplaatst)` : ''}${res.overflow ? ' — past net niet meer, staat er nu extra bij' : ''}`);
  return res;
}

// "Deze dag lukt niet": alle studieblokken van die dag die nog niet af zijn, schuiven door (vanaf de dag erna)
export async function shiftDay(date) {
  const plan = await db.all('plan');
  const ids = plan.filter(p => p.date === date && p.kind === 'study' && !p.done).map(p => p.id);
  if (!ids.length) return null;
  const today = isoDay();
  const res = reschedule(plan, today, { force: new Set(ids), start: addDays(date > today ? date : today, 1) });
  if (!res || !res.moved) { toast('Er is geen ruimte meer om deze dag door te schuiven'); return null; }
  await apply(plan, res, 'manual');
  toast(`${ids.length} blok${ids.length > 1 ? 'ken' : ''} doorgeschoven${res.overflow ? ' — past net niet meer, staat er nu extra bij' : ''}`);
  return res;
}

export async function undoShift() {
  const u = await getSetting('planUndo', null);
  if (!u) return false;
  const current = await db.all('plan');
  const today = isoDay();
  await db.clear('plan');
  // Wat je bewust terugzet, schuift niet opnieuw automatisch door
  await db.putMany('plan', u.items.map(p => (p.kind === 'study' && !p.done && p.date < today ? { ...p, keep: true } : p))
    .concat(current.filter(c => !u.items.some(o => o.id === c.id))));
  await setSetting('planUndo', null);
  toast('Verschuiving ongedaan gemaakt');
  return true;
}
