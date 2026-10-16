// Spaced repetition (vereenvoudigde SM-2): kaarten die je moeilijk vindt komen vaker terug.

const DAY = 864e5;
export const GRADES = [
  { key: 0, label: 'Opnieuw', cls: 'again' },
  { key: 1, label: 'Moeilijk', cls: 'hard' },
  { key: 2, label: 'Goed', cls: 'good' },
  { key: 3, label: 'Makkelijk', cls: 'easy' },
];

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
