// Import van studiepakketten (samenvattingen die Claude uit Canvas maakt) en back-ups.
import { db, STORE_NAMES, deleteSubject } from './db.js';
import { esc, uid, isoDay, modal, confirmDialog, toast, saveFile, SUBJECT_COLORS } from './util.js';
import { newSrs } from './srs.js';

const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const slug = s => norm(s).slice(0, 40) || uid();

export function findSubject(subjects, name) {
  const n = norm(name);
  if (!n) return null;
  return subjects.find(s => norm(s.name) === n || (s.aliases || []).some(a => norm(a) === n))
    || subjects.find(s => n.includes(norm(s.name)) || norm(s.name).includes(n) && norm(s.name).length > 3)
    || null;
}

export async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { toast('Dit bestand kan ik niet lezen (geen geldige JSON)'); return null; }
  if (data?.type === 'vakwerk-backup') return restoreBackup(data);
  if (data?.type === 'vakwerk-pakket' || Array.isArray(data?.items)) return importPack(data);
  toast('Onbekend bestand — verwacht een Vakwerk-pakket of back-up');
  return null;
}

export async function importPack(data) {
  const items = (data.items || []).filter(i => i && i.subject);
  const plan = (data.plan || []).filter(p => p && p.date && p.title);
  if (!items.length && !plan.length) { toast('Er staat niets in dit pakket'); return null; }
  let subjects = await db.all('subjects');

  // Vakken die het pakket zelf beschrijft (naam, kleur, Canvas-namen): aanmaken of aanvullen zonder te vragen
  for (const def of data.subjects || []) {
    if (!def?.name) continue;
    const ex = findSubject(subjects, def.name) || (def.aliases || []).map(a => findSubject(subjects, a)).find(Boolean);
    if (ex) {
      const aliases = [...new Set([...(ex.aliases || []), ...(def.aliases || [])])];
      if (aliases.length !== (ex.aliases || []).length) { ex.aliases = aliases; await db.put('subjects', ex); }
      continue;
    }
    const s = { id: uid('v'), name: def.name, color: def.color || SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length], aliases: def.aliases || [], created: Date.now(), order: subjects.length };
    await db.put('subjects', s);
    subjects.push(s);
  }

  // Vakken die nog niet bestaan: laat de gebruiker koppelen of aanmaken
  const names = [...items.map(i => i.subject), ...plan.map(p => p.subject).filter(Boolean)];
  const unknown = [...new Set(names)].filter(n => !findSubject(subjects, n));
  const mapping = {};
  if (unknown.length) {
    const r = await modal({
      title: 'Nieuwe vakken in dit pakket',
      body: `<p class="muted">Bij welk vak horen deze? Ik onthoud de koppeling voor de volgende keer.</p>
        ${unknown.map((n, i) => `<label class="field"><span>${esc(n)}</span>
          <select name="m${i}"><option value="__new">+ Nieuw vak "${esc(n)}"</option>${subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>`).join('')}`,
      actions: [{ label: 'Annuleer', value: null }, { label: 'Importeer', value: 'ok', primary: true }],
    });
    if (r.action !== 'ok') return null;
    for (let i = 0; i < unknown.length; i++) {
      const v = r.data['m' + i];
      if (v === '__new') {
        const s = { id: uid('v'), name: unknown[i], color: SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length], aliases: [], created: Date.now(), order: subjects.length };
        await db.put('subjects', s);
        subjects.push(s);
        mapping[unknown[i]] = s.id;
      } else {
        const s = subjects.find(x => x.id === v);
        s.aliases = [...new Set([...(s.aliases || []), unknown[i]])];
        await db.put('subjects', s);
        mapping[unknown[i]] = s.id;
      }
    }
  }

  // Planning vervangen: niet-afgevinkte studieblokken van een vak vanaf een datum weghalen (ook als ze al zijn doorgeschoven).
  // Afgevinkte blokken, colleges en tentamens blijven staan.
  let replaced = 0;
  for (const r of data.replacePlan || []) {
    const sid = r?.subject && findSubject(subjects, r.subject)?.id;
    if (!sid) continue;
    const from = r.from || isoDay();
    const old = (await db.by('plan', 'subjectId', sid)).filter(p => p.kind === 'study' && !p.done && (p.date >= from || (p.movedFrom || '') >= from));
    if (!old.length) continue;
    if (!await confirmDialog(`Dit pakket vervangt je planning voor ${r.subject}: ${old.length} niet-afgevinkte studieblok${old.length === 1 ? '' : 'ken'} vanaf ${from.slice(8, 10)}-${from.slice(5, 7)} ${old.length === 1 ? 'wordt' : 'worden'} vervangen door de nieuwe. Afgevinkte blokken, colleges en het tentamen blijven staan.`, { ok: 'Vervangen', danger: false, title: 'Planning vervangen' })) return null;
    await db.delMany('plan', old.map(p => p.id));
    replaced += old.length;
  }

  // Eerst alles in één keer lezen, daarna alles in één keer wegschrijven (snel, ook in de artifact-database)
  const byId = async s => new Map((await db.all(s)).map(x => [x.id, x]));
  const [exSum, exCards, exTasks, exPlan] = await Promise.all(['summaries', 'cards', 'assignments', 'plan'].map(byId));
  const out = { summaries: [], cards: [], assignments: [], plan: [] };
  const count = { summaries: 0, terms: 0, questions: 0, assignments: 0, plan: 0 };
  const now = Date.now();
  let deckIndex = 0;
  for (const it of items) {
    const subjectId = mapping[it.subject] || findSubject(subjects, it.subject).id;
    const key = it.id || `${slug(it.subject)}-${it.date || isoDay()}-${slug(it.title)}`;
    const terms = (it.terms || []).map(t => ({ term: t.term ?? t.begrip ?? t.front ?? '', definition: t.definition ?? t.uitleg ?? t.back ?? '' })).filter(t => t.term);
    const questions = (it.questions || []).map(q => ({ question: q.question ?? q.vraag ?? q.q ?? '', answer: q.answer ?? q.antwoord ?? q.a ?? '' })).filter(q => q.question);

    // Set flitskaarten (`deck`, zonder samenvatting): alleen kaarten, gegroepeerd onder de naam van de set
    if (it.deck && !it.summary) {
      const order = it.order ?? deckIndex++;
      const cards = [
        ...terms.map(t => ({ id: `pk:${key}:t:${slug(t.term)}`, front: t.term, back: t.definition, kind: 'begrip' })),
        ...questions.map((q, i) => ({ id: `pk:${key}:q:${i}`, front: q.question, back: q.answer, kind: 'vraag' })),
      ];
      cards.forEach((c, pos) => {
        const ex = exCards.get(c.id);
        // pos: volgorde binnen de set (zo leer je samenhangende begrippen in dezelfde ronde); last: 'foute kaarten' blijven bewaard
        out.cards.push({ ...c, subjectId, summaryId: null, deck: it.deck, deckOrder: order, pos, srs: ex?.srs || { ...newSrs(), due: now }, ...(ex?.last ? { last: ex.last } : {}), created: ex?.created || now });
      });
      count.terms += terms.length;
      count.questions += questions.length;
      count.decks = (count.decks || 0) + 1;
    } else if (it.summary || terms.length || questions.length) {
      const id = 'pk:' + key;
      const old = exSum.get(id);
      out.summaries.push({
        id, subjectId, title: it.title || 'Samenvatting', date: it.date || isoDay(), lecture: it.lecture || '',
        markdown: it.summary || '', terms, questions, sources: it.sources || [], source: 'claude',
        created: old?.created || now, updated: now, read: old?.read && old.markdown === (it.summary || '') ? true : false,
      });
      count.summaries++;
      const cards = [
        ...terms.map(t => ({ id: `pk:${key}:t:${slug(t.term)}`, front: t.term, back: t.definition, kind: 'begrip' })),
        ...questions.map((q, i) => ({ id: `pk:${key}:q:${i}`, front: q.question, back: q.answer, kind: 'vraag' })),
      ];
      for (const c of cards) {
        const ex = exCards.get(c.id);
        out.cards.push({ ...c, subjectId, summaryId: id, srs: ex?.srs || { ...newSrs(), due: now }, created: ex?.created || now });
      }
      count.terms += terms.length;
      count.questions += questions.length;
    }
    for (const a of it.assignments || []) {
      if (!a.title) continue;
      const id = 'pk:' + (a.id || `${key}:${slug(a.title)}`);
      const ex = exTasks.get(id);
      out.assignments.push({
        id, subjectId, title: a.title, due: a.due || '', notes: a.notes || a.description || '', url: a.url || '',
        done: ex?.done || false, source: 'claude', created: ex?.created || now,
      });
      count.assignments++;
    }
  }
  // Studieplanning: blokken per dag (ochtend/middag/avond), colleges en tentamens. Afgevinkte blokken blijven afgevinkt.
  for (const p of plan) {
    const subjectId = p.subject ? (mapping[p.subject] || findSubject(subjects, p.subject)?.id || null) : null;
    const id = 'pk:' + (p.id || `${p.date}-${p.slot ?? 0}-${slug(p.title)}`);
    const ex = exPlan.get(id);
    // Al doorgeschoven? Dan blijft de nieuwe plek staan.
    const keepPos = ex?.movedFrom;
    out.plan.push({
      id, subjectId, date: keepPos ? ex.date : p.date, slot: keepPos ? ex.slot : Math.min(2, Math.max(0, +p.slot || 0)), kind: p.kind || 'study',
      title: p.title, details: p.details || '', important: p.important || '', done: ex?.done || false, source: 'claude',
      ...(keepPos ? { movedFrom: ex.movedFrom } : {}), ...(ex?.keep ? { keep: true } : {}),
    });
    count.plan++;
  }
  for (const [s, arr] of Object.entries(out)) if (arr.length) await db.putMany(s, arr);
  if (data.planNotes) await db.put('meta', { id: 'planNotes', value: { title: data.planTitle || 'Planning', notes: data.planNotes } });

  const parts = [
    count.plan && `planning met ${count.plan} blokken${replaced ? ` (${replaced} oude vervangen)` : ''}`,
    count.summaries && `${count.summaries} samenvatting${count.summaries > 1 ? 'en' : ''}`,
    count.decks && `${count.decks} set${count.decks > 1 ? 's' : ''} flitskaarten`,
    count.terms && `${count.terms} begrippen`,
    count.questions && `${count.questions} oefenvragen`,
    count.assignments && `${count.assignments} opdracht${count.assignments > 1 ? 'en' : ''}`,
  ].filter(Boolean);
  toast(`Geïmporteerd: ${parts.join(', ') || 'niets nieuws'}`);
  return count;
}

// ---------- Back-up ----------
const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
const dataUrlToBlob = async u => (await fetch(u)).blob();

export async function exportBackup() {
  const out = { type: 'vakwerk-backup', version: 1, created: new Date().toISOString(), stores: {} };
  for (const s of STORE_NAMES) {
    let items = await db.all(s);
    if (s === 'recordings' || s === 'assets') items = await Promise.all(items.map(async r => ({ ...r, blob: await blobToDataUrl(r.blob) })));
    out.stores[s] = items;
  }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  return saveFile(blob, `vakwerk-backup-${isoDay()}.json`);
}

export async function restoreBackup(data) {
  const n = data.stores?.subjects?.length || 0;
  if (!await confirmDialog(`Back-up van ${data.created?.slice(0, 10) || '?'} met ${n} vakken terugzetten? Alles wat nu in de app staat wordt vervangen.`, { ok: 'Terugzetten', title: 'Back-up terugzetten' })) return null;
  for (const s of STORE_NAMES) {
    await db.clear(s);
    let items = data.stores?.[s] || [];
    if (s === 'recordings' || s === 'assets') items = await Promise.all(items.map(async r => ({ ...r, blob: await dataUrlToBlob(r.blob) })));
    if (items.length) await db.putMany(s, items);
  }
  toast('Back-up teruggezet');
  return { restored: true };
}

// ---------- Voorbeelddata ----------
const DEMO_NAMES = ['Calculus 1A', 'Programmeren 1', 'Thermodynamica'];
export const isDemoSubject = s => s.demo || DEMO_NAMES.includes(s.name);

export async function removeDemo() {
  const demo = (await db.all('subjects')).filter(isDemoSubject);
  if (!demo.length) return false;
  if (!await confirmDialog(`De voorbeeldvakken ${demo.map(s => `"${s.name}"`).join(', ')} verwijderen, met alles wat erbij hoort?`, { ok: 'Verwijder voorbeelddata', title: 'Voorbeelddata verwijderen' })) return false;
  for (const s of demo) await deleteSubject(s.id);
  toast('Voorbeelddata verwijderd');
  return true;
}

export async function wipeAll() {
  if (!await confirmDialog('Alle vakken, notities, opnames, samenvattingen, opdrachten, flashcards en je planning worden van deze iPad verwijderd. Maak eerst een back-up als je iets wilt bewaren.', { ok: 'Alles wissen', title: 'Opnieuw beginnen' })) return false;
  for (const s of STORE_NAMES) await db.clear(s);
  toast('Alles gewist — je begint opnieuw');
  return true;
}

export async function seedDemo() {
  const mk = (name, color, aliases = []) => ({ id: uid('v'), name, color, aliases, created: Date.now(), order: 0, demo: true });
  const calc = mk('Calculus 1A', SUBJECT_COLORS[0], ['Calculus 1A (202400123)']);
  const prog = mk('Programmeren 1', SUBJECT_COLORS[2]);
  const thermo = mk('Thermodynamica', SUBJECT_COLORS[3]);
  const subs = [calc, prog, thermo];
  subs.forEach((s, i) => { s.order = i; });
  await db.putMany('subjects', subs);
  const slot = (s, day, start, end, kind, location) => ({ id: uid('t'), subjectId: s.id, day, start, end, kind, location });
  await db.putMany('slots', [
    slot(calc, 1, '08:45', '10:30', 'Hoorcollege', 'Horst ZH 1'),
    slot(prog, 1, '13:45', '15:30', 'Practicum', 'Zilverling 2042'),
    slot(thermo, 2, '10:45', '12:30', 'Hoorcollege', 'Carré 2K'),
    slot(calc, 3, '10:45', '12:30', 'Werkcollege', 'Ravelijn 1231'),
    slot(prog, 4, '08:45', '10:30', 'Hoorcollege', 'Waaier 4'),
    slot(thermo, 4, '13:45', '15:30', 'Werkcollege', 'Horst W 0.123'),
    slot(calc, 5, '10:45', '12:30', 'Hoorcollege', 'Horst ZH 1'),
  ]);
  const d = new Date(); d.setDate(d.getDate() + 4); d.setHours(23, 59, 0, 0);
  const d2 = new Date(); d2.setDate(d2.getDate() + 1); d2.setHours(17, 0, 0, 0);
  const iso = x => `${isoDay(x)}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  await importPack({
    type: 'vakwerk-pakket', version: 1, items: [{
      id: 'demo-calc-lecture5', subject: 'Calculus 1A', date: isoDay(), title: 'Lecture 5 — Partiële afgeleiden',
      sources: ['Lecture 5 - Partial derivatives.pdf'],
      summary: `## Kern van dit college\nBij een functie van **meerdere variabelen** kijk je hoe de functie verandert als je **één variabele** laat variëren en de rest vasthoudt.\n\n## Partiële afgeleide\n- Notatie: \`∂f/∂x\` of \`f_x\`\n- Behandel alle andere variabelen als **constante**\n- Voorbeeld: f(x,y) = x²y + 3y → f_x = 2xy, f_y = x² + 3\n\n## Gradiënt\nDe vector van alle partiële afgeleiden: \`∇f = (f_x, f_y)\`. Wijst in de richting van de **snelste stijging**.\n\n## Raakvlak\nz − z₀ = f_x(x₀,y₀)(x − x₀) + f_y(x₀,y₀)(y − y₀)\n\n> ==Tentamentip:== bij "richtingsafgeleide" altijd eerst de richtingsvector normaliseren.`,
      terms: [
        { term: 'Partiële afgeleide', definition: 'Afgeleide naar één variabele terwijl de andere variabelen constant worden gehouden.' },
        { term: 'Gradiënt', definition: 'Vector met alle partiële afgeleiden; wijst in de richting van de snelste stijging.' },
        { term: 'Raakvlak', definition: 'Vlak dat de grafiek van f(x,y) in één punt raakt; lineaire benadering van f.' },
      ],
      questions: [
        { question: 'Bereken f_x en f_y voor f(x,y) = x³y² − 4xy.', answer: 'f_x = 3x²y² − 4y,  f_y = 2x³y − 4x' },
        { question: 'In welke richting stijgt f het snelst in een punt?', answer: 'In de richting van de gradiënt ∇f in dat punt.' },
      ],
      assignments: [{ id: 'demo-hw3', title: 'Homework 3 — Partial derivatives', due: iso(d), notes: 'Opgaven 14.3: 5, 9, 17, 23' }],
    }, {
      id: 'demo-prog-quiz', subject: 'Programmeren 1', assignments: [{ id: 'demo-quiz2', title: 'Quiz 2 (Canvas)', due: iso(d2) }],
    }],
  });
}
