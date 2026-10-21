// Begrippen-check bij typen: welke kernbegrippen uit het modelantwoord staan ook in jouw antwoord?
// Kernbegrippen = andere begrippen van hetzelfde vak die in het modelantwoord voorkomen, plus afkortingen
// (SER, HRM) en korte 'begrippen tussen aanhalingstekens'. Namen en jaartallen tellen als bonus, niet in de score.

const STOP = new Set(('the a an of and or to in on for with by from at as is are be its it their this that these those not no into than then via vs per ' +
  'why how what which who when de het een en of van in op voor met door bij als is zijn niet').split(' '));
const ABBR_SKIP = new Set(['I', 'II', 'III', 'IV', 'VI', 'OK', 'US', 'UK', 'EU', 'NL', 'HQ', 'BOTH', 'NOT', 'OR', 'AND', 'IS', 'Q',
  'CORE', 'PERIPHERY', 'THINK', 'EXECUTE', 'OWN', 'HOW', 'WHAT', 'NEW', 'OLD', 'ALL', 'ONLY']);
// "Contingency theory" mag ook als "contingency", "Mechanistic organization" als "mechanistic"
const GENERIC_TAIL = new Set(['organization', 'organizations', 'organisation', 'organisations', 'theory', 'school']);
const NAME_SKIP = new Set(['E', 'Eg', 'Example', 'Examples', 'Advantage', 'Advantages', 'Disadvantage', 'Disadvantages', 'Benefit', 'Risk',
  'Core', 'Main', 'Note', 'Lesson', 'Result', 'Answer', 'Answers', 'Strength', 'Limitation', 'Focus', 'Change', 'Continuity', 'Break',
  'Outside', 'Sample', 'Fordism', 'Fordist', 'Taylorist', 'Weberian', 'Marxists', 'Moon']);
const WORD_RE = /[A-Za-zÀ-ÿ0-9]+(?:['’][A-Za-z]+)?/g;
// Na deze tekens begint een zin of opsomming: een hoofdletter is daar geen naam
const SENTENCE_START = /(^|[.:;!?→+−–\-)\n]\s*|\d\)\s*)$/;

const lower = s => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
function core(w) {
  w = lower(w).replace(/['’]s$/, '');
  if (w.length > 4) for (const suf of ['ing', 'ed', 'es', 's', 'e', 'y']) if (w.endsWith(suf)) return w.slice(0, -suf.length);
  return w;
}
// Twee woorden zijn hetzelfde begrip als het ene (zonder uitgang) begint met het andere: rule ≈ rules, output ≈ outputs.
// Korte woorden (SER, fit) moeten precies gelijk zijn, en het lengteverschil blijft klein (standard ≠ standardization).
export function sameWord(a, b) {
  const x = core(a), y = core(b);
  if (x === y) return true;
  const short = Math.min(a.length, b.length), long = Math.max(a.length, b.length);
  if (Math.min(x.length, y.length) <= 3 || long - short > 4 || short / long < 0.75) return false; // through ≠ throughput
  return x.startsWith(y) || y.startsWith(x);
}

function words(text) {
  const out = [];
  for (const m of String(text).matchAll(WORD_RE)) out.push({ w: m[0], i: m.index, end: m.index + m[0].length });
  return out;
}
const sig = phrase => words(phrase).map(t => t.w).filter(w => !STOP.has(lower(w)));

// Alternatieven van een kaartvoorkant: "Fordism / mass production" → ['Fordism', 'mass production'],
// "Standard employment relationship (SER)" → ['Standard employment relationship', 'SER']
export function alternatives(front) {
  let f = String(front).replace(/^Q:\s*/i, '');
  const alts = [];
  f = f.replace(/\(([^)]*)\)/g, (m, inner) => { if (/^[A-Z]{2,6}$/.test(inner.trim())) alts.push(inner.trim()); return ' '; });
  f = f.split(':')[0];
  for (const part of f.split(/\s+(?:\/|&|vs\.?|↔|–|-)\s+/i)) {
    const p = part.replace(/\s+/g, ' ').trim();
    const ws = sig(p);
    if (ws.length >= 1 && ws.length <= 4) alts.push(p);
    if (ws.length >= 2 && GENERIC_TAIL.has(lower(ws[ws.length - 1]))) alts.push(ws.slice(0, -1).join(' '));
  }
  return [...new Set(alts)];
}

// Woordenlijst van een vak: alle begrippen (voorkanten), zonder begrippen die in bijna elk antwoord staan ('organization')
export function buildVocab(cards) {
  const backs = cards.map(c => words(c.back).map(t => core(t.w)));
  const df = phrase => {
    const ws = sig(phrase).map(core);
    return backs.filter(b => ws.every(w => b.some(x => x === w || (Math.min(x.length, w.length) > 3 && (x.startsWith(w) || w.startsWith(x)))))).length;
  };
  const max = Math.max(3, cards.length * 0.15);
  const vocab = [];
  const seen = new Set();
  for (const c of cards) {
    if (c.kind === 'vraag' || /^(Q:|HOW TO)/i.test(c.front) || /\?\s*$/.test(c.front)) continue;
    const alts = alternatives(c.front).filter(a => sig(a).length > 1 || df(a) <= max);
    if (!alts.length) continue;
    const key = alts.map(lower).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    vocab.push({ label: alts[0], alts, front: c.front });
  }
  return vocab;
}

// Waar staat een begrip in een tekst? Woorden in dezelfde volgorde, met hooguit 2 kleine woorden ertussen ("division of labour").
function spansOf(text, alt) {
  const tw = words(text);
  const need = sig(alt);
  if (!need.length) return [];
  const out = [];
  for (let i = 0; i < tw.length; i++) {
    if (!sameWord(need[0], tw[i].w) || (need[0].length <= 3 && /^[A-Z]+$/.test(need[0]) && tw[i].w !== need[0] && tw[i].w.toUpperCase() !== need[0])) continue;
    let j = i, k = 1, ok = true;
    while (k < need.length) {
      let skip = 0, found = false;
      while (++j < tw.length && skip <= 2) {
        if (sameWord(need[k], tw[j].w)) { found = true; break; }
        if (!STOP.has(lower(tw[j].w))) break;
        skip++;
      }
      if (!found) { ok = false; break; }
      k++;
    }
    if (ok) out.push({ start: tw[i].i, end: tw[j].end });
  }
  return out;
}

// Staat het begrip in jouw (getypte) antwoord? Losser dan in het modelantwoord: alle woorden ergens in je tekst.
function inAnswer(typedWords, alt) {
  const need = sig(alt);
  return need.length > 0 && need.every(n => typedWords.some(w => sameWord(n, w)));
}

// De kernbegrippen van één kaart
export function keyTermsFor(card, vocab) {
  const text = card.back || '';
  const own = new Set(alternatives(card.front).map(lower));
  const found = [];
  for (const v of vocab) {
    if (v.front === card.front || v.alts.some(a => own.has(lower(a)))) continue;
    const alt = v.alts.find(a => spansOf(text, a).length);
    if (alt) found.push({ label: alt, alts: v.alts, pos: spansOf(text, alt)[0].start });
  }
  // Afkortingen en 'begrippen tussen aanhalingstekens'
  for (const m of text.matchAll(/\b([A-Z]{2,6})s?\b/g)) {
    if (ABBR_SKIP.has(m[1]) || own.has(lower(m[1]))) continue;
    found.push({ label: m[1], alts: [m[1]], pos: m.index });
  }
  for (const m of text.matchAll(/['‘"“]([^'’"”]{3,40})['’"”]/g)) {
    const n = sig(m[1]).length;
    if (n >= 1 && n <= 4 && !/[.!?]/.test(m[1])) found.push({ label: m[1].trim(), alts: [m[1].trim()], pos: m.index });
  }
  // Dubbel of deel van een langer begrip ("Output" naast "Output control") eruit
  const terms = [];
  for (const t of found.sort((a, b) => sig(b.label).length - sig(a.label).length)) {
    const ws = sig(t.label);
    const dup = terms.some(u => lower(u.label) === lower(t.label) || ws.every(w => sig(u.label).some(x => sameWord(w, x))));
    if (!dup) terms.push(t);
  }
  terms.sort((a, b) => a.pos - b.pos);

  // Bonus: namen en jaartallen
  const termWords = terms.flatMap(t => t.alts.flatMap(sig));
  const bonus = [];
  for (const t of words(text)) {
    const isYear = /^(1[6-9]\d\d|20\d\d)$/.test(t.w);
    const isName = /^[A-Z][a-zà-ÿ]{2,}$/.test(t.w) && !NAME_SKIP.has(t.w) && !SENTENCE_START.test(text.slice(Math.max(0, t.i - 4), t.i))
      && !termWords.some(w => sameWord(w, t.w)) && !own.has(lower(t.w));
    if ((isYear || isName) && !bonus.some(b => b.label === t.w)) bonus.push({ label: t.w, alts: [t.w] });
  }
  return { terms: terms.slice(0, 14), bonus: bonus.slice(0, 6) };
}

// Vergelijk een getypt antwoord met de kernbegrippen. Geeft ook een advies (0 = Opnieuw … 2 = Goed).
export function checkAnswer(typed, { terms, bonus }) {
  const tw = words(typed).map(t => t.w);
  const mark = list => list.map(t => ({ ...t, hit: t.alts.some(a => inAnswer(tw, a)) }));
  const T = mark(terms), B = mark(bonus);
  const hits = T.filter(t => t.hit).length;
  const ratio = T.length ? hits / T.length : null;
  const advice = !tw.length ? 0 : ratio === null ? null : ratio >= 0.8 ? 2 : ratio >= 0.5 ? 1 : 0;
  return { terms: T, bonus: B, hits, total: T.length, ratio, advice };
}

// Omgekeerd (uitleg → begrip): heb je het juiste begrip genoemd?
export function checkTerm(typed, front) {
  const tw = words(typed).map(t => t.w);
  const alts = alternatives(front);
  return (alts.length ? alts : [front]).some(a => inAnswer(tw, a));
}

// Posities van begrippen in een stuk tekst, voor het markeren (hit = jij had hem ook)
export function findSpans(text, list) {
  const spans = [];
  for (const t of list) for (const a of t.alts) for (const s of spansOf(text, a)) spans.push({ ...s, hit: t.hit });
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  return spans.filter((s, i) => !spans.slice(0, i).some(p => s.start < p.end && p.start < s.end));
}

// Woorden in jouw antwoord die bij een gevonden begrip horen
export function answerSpans(typed, checked) {
  const hitWords = checked.terms.concat(checked.bonus).filter(t => t.hit).flatMap(t => t.alts.flatMap(sig));
  return words(typed).filter(t => !STOP.has(lower(t.w)) && hitWords.some(w => sameWord(w, t.w))).map(t => ({ start: t.i, end: t.end, hit: true }));
}
