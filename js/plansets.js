// Planning ↔ flitskaarten: welk studieblok hoort bij welke set? En: blok automatisch afvinken als je die set beheerst.
// Een blok kan zelf een set kiezen (p.deck = naam van de set, '-' = geen); anders zoekt de app er een:
// eerst op sessienummer ("slides sessie 3" ↔ "Sessie 3 · …", "sessie 5 & 6" ↔ "Sessie 5–6 · …"), dan op woorden.
import { db } from './db.js';
import { isoDay } from './util.js';
import { deckSets, isKnown } from './srs.js';

export const DONE_AT = 0.8; // vanaf 80% 'goed' telt een set als beheerst

const SESSION_RE = /\b(?:sessie|session|lecture|college|les)\s*(\d+)(?:\s*(?:[+&,–-]|en|and)\s*(\d+))*/gi;
function sessionNumbers(text) {
  const out = new Set();
  for (const m of String(text).matchAll(SESSION_RE)) for (const n of m[0].match(/\d+/g)) out.add(+n);
  return out;
}
function setRange(label) {
  const m = String(label).match(/\b(?:sessie|session|lecture)\s*(\d+)(?:\s*[–-]\s*(\d+))?/i);
  if (!m) return null;
  const a = +m[1], b = +(m[2] || m[1]);
  return new Set(Array.from({ length: b - a + 1 }, (_, i) => a + i));
}
// Woorden als stam van 6 letters, zonder streepjes: "post-fordisme" ≈ "post-Fordism", "platformeconomie" ≈ "Platform economy"
const stems = text => new Set(String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/-/g, '')
  .split(/[^a-z]+/).filter(w => w.length >= 5).map(w => w.slice(0, 6)));

// Alle sets van een vak met hun voortgang
export function subjectSets(cards, summaries, subjectId) {
  const own = cards.filter(c => c.subjectId === subjectId);
  return deckSets(own, summaries.filter(s => s.subjectId === subjectId)).map(s => {
    const known = s.cards.filter(isKnown).length;
    return { key: s.key, label: s.label, total: s.cards.length, known, pct: s.cards.length ? known / s.cards.length : 0 };
  });
}

// De set bij één blok (of null)
export function setForBlock(p, sets) {
  if (p.kind !== 'study' || !p.subjectId || !sets.length || p.deck === '-') return null;
  if (p.deck) return sets.find(s => s.label === p.deck) || null;
  const text = `${p.title} ${p.details || ''}`;
  const nums = sessionNumbers(text);
  if (nums.size) {
    let best = null, bestScore = 0;
    for (const s of sets) {
      const r = setRange(s.label);
      const score = r ? [...nums].filter(n => r.has(n)).length : 0;
      if (score > bestScore) { best = s; bestScore = score; }
    }
    if (best) return best;
  }
  // Op woorden: alleen woorden die in hooguit 2 sets voorkomen tellen mee
  const df = new Map();
  for (const s of sets) for (const w of stems(s.label)) df.set(w, (df.get(w) || 0) + 1);
  const words = stems(text);
  let best = null, bestScore = 0;
  for (const s of sets) {
    const score = [...stems(s.label)].filter(w => words.has(w) && df.get(w) <= 2).length;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}

// Koppelingen voor alle blokken: Map planId → set
export function planLinks(D) {
  const bySubject = new Map();
  const links = new Map();
  for (const p of D.plan) {
    if (p.kind !== 'study' || !p.subjectId) continue;
    if (!bySubject.has(p.subjectId)) bySubject.set(p.subjectId, subjectSets(D.cards, D.summaries, p.subjectId));
    const s = setForBlock(p, bySubject.get(p.subjectId));
    if (s) links.set(p.id, s);
  }
  return links;
}

// Studieblokken van vandaag of eerder waarvan je de set beheerst: afvinken. Geeft het aantal terug.
export async function autoDone() {
  const [plan, cards, summaries] = await Promise.all(['plan', 'cards', 'summaries'].map(s => db.all(s)));
  const today = isoDay();
  const links = planLinks({ plan: plan.filter(p => !p.done && p.date <= today), cards, summaries });
  const done = [];
  for (const p of plan) {
    const s = links.get(p.id);
    if (s && s.total && s.pct >= DONE_AT) done.push({ ...p, done: true, autoDone: true });
  }
  if (done.length) await db.putMany('plan', done);
  return done.length;
}
