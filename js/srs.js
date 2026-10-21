// Spaced repetition (vereenvoudigde SM-2): kaarten die je moeilijk vindt komen vaker terug.

const DAY = 864e5;
export const GRADES = [
  { key: 0, label: 'Opnieuw', cls: 'again' },
  { key: 1, label: 'Moeilijk', cls: 'hard' },
  { key: 2, label: 'Goed', cls: 'good' },
  { key: 3, label: 'Makkelijk', cls: 'easy' },
];

// Echt willekeurig door elkaar (Fisher-Yates), zodat je nooit twee keer dezelfde volgorde krijgt
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Laatste beoordeling van een kaart (0 = Opnieuw … 3 = Makkelijk), ook bij oefenen per set.
// Oudere kaarten zonder `last`: afleiden uit de herhaalgegevens.
export function lastGrade(c) {
  if (c.last) return c.last.g;
  if (c.srs?.reps > 0) return 2;
  if (c.srs?.lapses > 0) return 0;
  return null;
}
// Een kaart is 'fout' als de laatste keer Opnieuw/Moeilijk was, in welke richting dan ook
const weakDir = c => Object.values(c.dirs || {}).some(d => d.g <= 1);
export const isWeak = c => { const g = lastGrade(c); return (g !== null && g <= 1) || weakDir(c); };  // Opnieuw of Moeilijk
export const isKnown = c => { const g = lastGrade(c); return g !== null && g >= 2 && !weakDir(c); }; // Goed of Makkelijk

// ---------- Slim oefenen: per richting bijhouden hoe goed je een kaart kent ----------
// n = begrip → uitleg, r = uitleg → begrip. m = beheersing (0–1), weegt recente beurten zwaarder.
export function recordDir(c, dir, g) {
  const d = { seen: 0, wrong: 0, m: 0, ...(c.dirs?.[dir] || {}) };
  const score = g >= 2 ? 1 : g === 1 ? 0.4 : 0;
  d.m = d.seen ? d.m * 0.5 + score * 0.5 : score;
  d.seen++;
  if (g <= 1) d.wrong++;
  d.g = g;
  d.t = Date.now();
  c.dirs = { ...(c.dirs || {}), [dir]: d };
}
export const mastery = (c, dir) => (c.dirs?.[dir]?.seen ? c.dirs[dir].m : null); // null = nog nooit gevraagd

// Hoe zwak is een kaart (0 = beheerst … 1 = zwak)? De zwakste richting telt.
export function weakness(c) {
  const dirs = c.kind === 'vraag' ? ['n'] : ['n', 'r'];
  return Math.max(...dirs.map(d => 1 - (mastery(c, d) ?? 0.3)));
}

// Welke richting vraag je nu? Nieuw: eerst begrip → uitleg; kent je die, dan ook omgekeerd;
// daarna steeds de richting die je het slechtst kent (ongeveer gelijk: willekeurig).
export function smartDir(c) {
  if (c.kind === 'vraag') return 'n';
  const n = mastery(c, 'n'), r = mastery(c, 'r');
  if (n === null) return 'n';
  if (r === null) return n >= 0.6 ? 'r' : 'n';
  if (Math.abs(n - r) < 0.15) return Math.random() < 0.5 ? 'n' : 'r';
  return n < r ? 'n' : 'r';
}

// Husselen, maar zwakke kaarten eerder: willekeur genoeg dat de volgorde elke keer anders is
export function weightedShuffle(cards) {
  return cards.map(c => [weakness(c) + Math.random() * 0.35, c]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
}

// Sets: kaarten uit een pakket met `deck` (bijv. per college), anders per samenvatting, anders 'Eigen kaarten'
export function deckKey(c) { return c.deck ? 'd:' + c.deck : c.summaryId ? 's:' + c.summaryId : 'eigen'; }
export function deckSets(cards, summaries = []) {
  const sums = new Map(summaries.map(s => [s.id, s]));
  const sets = new Map();
  for (const c of cards) {
    const key = deckKey(c);
    if (!sets.has(key)) {
      const sum = sums.get(c.summaryId);
      sets.set(key, { key, label: c.deck || sum?.title || 'Eigen kaarten', order: c.deckOrder ?? (sum ? 1000 : 2000), date: sum?.date || '', cards: [] });
    }
    sets.get(key).cards.push(c);
  }
  return [...sets.values()].sort((a, b) => a.order - b.order || a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

export function startOfDay(t = Date.now()) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function newSrs() { return { due: 0, ivl: 0, ease: 2.5, reps: 0, lapses: 0 }; }
export function isDue(card, now = Date.now()) { return (card.srs?.due ?? 0) <= now; }
export function isNew(card) { return !card.srs || card.srs.reps === 0 && card.srs.lapses === 0; }

export function schedule(srs = newSrs(), grade, now = Date.now()) {
  const s = { ...newSrs(), ...srs };
  if (grade === 0) {
    s.lapses++;
    s.reps = 0;
    s.ivl = 0;
    s.ease = Math.max(1.3, s.ease - 0.2);
    s.due = now + 10 * 60e3;
    return s;
  }
  if (grade === 1) { s.ivl = s.reps === 0 ? 1 : Math.max(1, Math.round(s.ivl * 1.2)); s.ease = Math.max(1.3, s.ease - 0.15); }
  if (grade === 2) { s.ivl = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.round(Math.max(s.ivl, 1) * s.ease); }
  if (grade === 3) { s.ivl = s.reps === 0 ? 4 : Math.round(Math.max(s.ivl, 1) * s.ease * 1.3); s.ease += 0.15; }
  s.reps++;
  s.due = startOfDay(now) + s.ivl * DAY + 4 * 3600e3;
  return s;
}

export function intervalLabel(srs, grade) {
  if (grade === 0) return '10 min';
  const d = schedule(srs, grade).ivl;
  if (d < 7) return `${d} d`;
  if (d < 30) return `${Math.round(d / 7)} w`;
  if (d < 365) return `${Math.round(d / 30)} mnd`;
  return `${(d / 365).toFixed(1)} jr`;
}
