// Bara: de AI-capybara. Knop rechtsonder (in een notitie linksonder), paneel met vraag, antwoord en acties.
// De notitie-editor geeft via setBaraContext door wat er op het scherm staat.
import { db } from './db.js';
import { $, esc, uid, icon, toast, isoDay, closePopovers } from './util.js';
import { markdown } from './markdown.js';
import { newSrs, isDue } from './srs.js';
import { isConfigured, isSignedIn, cloudFetch } from './cloud.js';

const IMG = 'img/bara.webp';
let editorCtx = null;
export function setBaraContext(ctx) { editorCtx = ctx; }

let fab, panel;
let chat = [];           // { role, images?, text, shown?, error? } in volgorde
let attached = [];       // plaatjes die met de volgende vraag meegaan { label, blob, url }
let streaming = null;    // AbortController van de lopende vraag

const blobToBase64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });
const stripCards = s => s.replace(/<kaarten>[\s\S]*?(<\/kaarten>|$)/, '').trim();
function parseCards(s) {
  const m = s.match(/<kaarten>([\s\S]*?)<\/kaarten>/);
  if (!m) return [];
  try { return JSON.parse(m[1]).filter(c => c?.front && c?.back); } catch { return []; }
}
function clearAttached() { attached.forEach(a => URL.revokeObjectURL(a.url)); attached = []; }
const addAttached = (label, blob) => attached.push({ label, blob, url: URL.createObjectURL(blob) });

// ---------- Context ----------
function currentSubjectId() {
  if (editorCtx?.subjectId) return editorCtx.subjectId;
  const m = location.hash.match(/^#\/(?:vak|oefenen)\/([^/?]+)/);
  return m && m[1] !== 'all' ? decodeURIComponent(m[1]) : null;
}
async function contextText() {
  const today = isoDay();
  const [subjects, plan, tasks, cards] = await Promise.all(['subjects', 'plan', 'assignments', 'cards'].map(s => db.all(s)));
  const sub = Object.fromEntries(subjects.map(s => [s.id, s.name]));
  const planLine = p => `${p.date} ${sub[p.subjectId] || ''}: ${p.title}${p.details ? ` (${p.details})` : ''}${p.done ? ' [af]' : ''}`;
  const lines = [`Vandaag is ${today}.`, `Vakken: ${subjects.map(s => s.name).join(', ') || 'geen'}.`];
  const todayPlan = plan.filter(p => p.date === today && p.kind !== 'rest');
  lines.push(todayPlan.length ? `Planning vandaag:\n${todayPlan.map(planLine).join('\n')}` : 'Vandaag staat er niets gepland.');
  const exams = plan.filter(p => p.kind === 'exam' && p.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  if (exams.length) lines.push(`Komende tentamens:\n${exams.map(planLine).join('\n')}`);
  const open = tasks.filter(t => !t.done).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 10);
  if (open.length) lines.push(`Open opdrachten:\n${open.map(t => `${t.due || 'geen datum'} ${sub[t.subjectId] || ''}: ${t.title}`).join('\n')}`);
  const dueBy = {};
  cards.filter(c => isDue(c)).forEach(c => { dueBy[c.subjectId] = (dueBy[c.subjectId] || 0) + 1; });
  const dueLine = Object.entries(dueBy).map(([id, n]) => `${sub[id] || '?'}: ${n}`).join(', ');
  if (dueLine) lines.push(`Flitskaarten om te herhalen: ${dueLine}.`);
  const sid = currentSubjectId();
  if (sid) {
    lines.push(`De student is nu bezig met het vak ${sub[sid] || 'onbekend'}.`);
    const sums = (await db.by('summaries', 'subjectId', sid)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const LIMIT = 20000;
    let text = sums.map(s => `## ${s.title}\n${s.markdown || ''}`).join('\n\n');
    if (text.trim()) {
      const cut = text.length > LIMIT;
      if (cut) text = text.slice(0, LIMIT);
      lines.push(`Samenvattingen van dit vak (studiemateriaal${cut ? ', alleen de nieuwste, ingekort' : ''}):\n${text}`);
    }
  }
  if (editorCtx) lines.push(`Open notitie: "${editorCtx.title}".${editorCtx.typedText ? ` Getypte tekst erin: ${editorCtx.typedText().slice(0, 4000)}` : ''}`);
  return lines.join('\n\n');
}

// ---------- Vragen ----------
function friendlyError(e) {
  if (!e.status) return 'Bara heeft internet nodig. Probeer het zo nog eens.';
  if (e.status === 401) return 'Log opnieuw in via Instellingen om Bara te gebruiken.';
  if (e.status === 403) return 'Bara staat nog niet aan voor dit account.';
  if (e.status === 404) return 'De server van Bara is nog niet geïnstalleerd.';
  if (e.status === 413) return 'Deze vraag is te groot. Selecteer een kleiner stuk.';
  return 'Dat lukte niet. Probeer het zo nog eens.';
}
async function toApiMessages() {
  const out = [];
  for (const m of chat) {
    if (m.error) continue;
    if (m.role === 'assistant') { if (m.text) out.push({ role: 'assistant', content: m.text }); continue; }
    const content = [];
    for (const im of m.images || []) {
      content.push({ type: 'text', text: `${im.label}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: im.blob.type, data: await blobToBase64(im.blob) } });
    }
    content.push({ type: 'text', text: m.text });
    out.push({ role: 'user', content });
  }
  return out;
}
export async function ask(question, { images = [], shown = question } = {}) {
  if (streaming || !isSignedIn()) return;
  const imgs = [...attached.map(a => ({ label: a.label, blob: a.blob, url: a.url })), ...images];
  attached = [];
  const first = !chat.length;
  const text = first ? `Context uit de app (geen vraag):\n${await contextText()}\n\nVraag van de student:\n${question}` : question;
  chat.push({ role: 'user', text, shown, images: imgs });
  const messages = await toApiMessages();
  const answer = { role: 'assistant', text: '' };
  chat.push(answer);
  const ctl = streaming = new AbortController();
  render();
  try {
    const res = await cloudFetch('/functions/v1/bara', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }), signal: ctl.signal });
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop();
      for (const line of parts) {
        if (!line.trim()) continue;
        const o = JSON.parse(line);
        if (o.reset) answer.text = '';
        if (o.t) answer.text += o.t;
        if (o.stop === 'refusal') { answer.error = 'Hier kan ik je niet mee helpen. Probeer het anders te vragen.'; }
        if (o.stop === 'max_tokens') answer.cut = true;
        if (o.error) answer.error = o.error === 'druk' ? 'Het is even druk. Probeer het zo nog eens.' : 'Dat lukte niet. Probeer het zo nog eens.';
      }
      renderAnswer();
    }
    if (!answer.text && !answer.error) answer.error = 'Ik kreeg geen antwoord. Probeer het nog eens.';
  } catch (e) {
    if (e.name === 'AbortError') { if (!answer.text) chat.splice(chat.indexOf(answer), 1); }
    else answer.error = friendlyError(e);
  } finally {
    streaming = null;
    if (panel.isConnected) render();
  }
}

// ---------- Acties op een antwoord ----------
async function addCards(list, subjectId) {
  const now = Date.now();
  await db.putMany('cards', list.map((c, i) => ({ id: uid('c'), kind: 'eigen', subjectId, front: String(c.front).trim(), back: String(c.back).trim(), srs: { ...newSrs(), due: now }, created: now + i })));
}
async function onAction(a, i) {
  const m = chat[i];
  if (a === 'page') {
    // Regels behouden, alleen de Markdown-tekens eruit
    await editorCtx?.insertAnswer(stripCards(m.text).replace(/^#{1,6}\s*/gm, '').replace(/\*\*|==|`/g, '').replace(/^\s*[-*]\s+/gm, '• '));
    return;
  }
  const sid = currentSubjectId();
  if (a === 'cards') {
    const list = parseCards(m.text);
    await addCards(list, sid);
    m.added = true;
    toast(list.length === 1 ? '1 flitskaart toegevoegd' : `${list.length} flitskaarten toegevoegd`);
    render();
  }
  if (a === 'card') {
    const q = chat[i - 1]?.shown || 'Vraag aan Bara';
    await addCards([{ front: q, back: stripCards(m.text) }], sid);
    m.added = true;
    toast('Flitskaart toegevoegd');
    render();
  }
}

// ---------- Paneel ----------
function examples() {
  const list = [];
  const inNote = !!editorCtx;
  if (inNote) list.push(['doc', 'Vat deze notitie samen', 'summary']);
  if (currentSubjectId()) list.push(['cards', 'Maak flitskaarten', 'cards']);
  list.push(['book', 'Leg dit begrip uit', 'explain'], ['calendar', 'Wat moet ik vandaag leren?', 'today']);
  return list;
}
function messageHtml(m, i) {
  if (m.role === 'user') return `<div class="b-msg me">${(m.images || []).map(im => `<img src="${im.url || (im.url = URL.createObjectURL(im.blob))}" alt="${esc(im.label)}">`).join('')}<p>${esc(m.shown)}</p></div>`;
  if (m.error) return `<div class="b-msg bot error">${m.text ? `<div class="md">${markdown(stripCards(m.text))}</div>` : ''}<p>${esc(m.error)}</p></div>`;
  const busy = streaming && i === chat.length - 1;
  if (!m.text) return `<div class="b-msg bot"><p class="b-typing">Bara denkt na…</p></div>`;
  const cards = !busy ? parseCards(m.text) : [];
  const sid = currentSubjectId();
  const acts = busy ? '' : `<div class="b-acts">
    ${cards.length && sid && !m.added ? `<button class="btn small primary" data-b="cards" data-i="${i}">Voeg ${cards.length === 1 ? '1 kaart' : `${cards.length} kaarten`} toe</button>` : ''}
    ${editorCtx ? `<button class="btn small" data-b="page" data-i="${i}">Zet op pagina</button>` : ''}
    ${!cards.length && sid && !m.added ? `<button class="btn small" data-b="card" data-i="${i}">Maak flitskaart</button>` : ''}
  </div>`;
  return `<div class="b-msg bot" data-answer="${i}"><div class="md">${markdown(stripCards(m.text))}</div>${m.cut ? '<p class="muted small">Antwoord is afgekapt, vraag gerust door.</p>' : ''}${acts}</div>`;
}
function bodyHtml() {
  if (!isConfigured()) return `<div class="b-bubble">Ik ben er bijna. Eerst moet de koppeling met je account klaar zijn.</div>`;
  if (!isSignedIn()) return `<div class="b-bubble">Hoi, ik ben <b>Bara</b>. Log eerst even in, dan kan ik je helpen.</div><a class="btn primary block" href="#/instellingen">Naar Instellingen</a>`;
  const chips = attached.length ? `<div class="b-attached"><img src="${attached[0].url}" alt=""><span>Ik kijk mee met je ${attached.length > 1 || attached[0].label !== 'Handschrift' ? 'selectie' : 'vraag'}</span><button class="icon-btn small" data-b="unattach" aria-label="Weghalen">${icon('x', 16)}</button></div>` : '';
  const input = `${chips}<div class="b-ask">
      <form class="b-input"><textarea rows="1" placeholder="Typ je vraag…" aria-label="Typ je vraag"></textarea><button class="b-send" aria-label="Verstuur" ${streaming ? 'disabled' : ''}>${icon('send', 18)}</button></form>
      <span class="b-or">of</span>
      <button class="btn b-pencil" data-b="pencil">${icon('pen', 18)} Schrijf met Pencil</button>
    </div>`;
  if (chat.length) return `<div class="b-chat">${chat.map(messageHtml).join('')}</div>${input}`;
  return `<div class="b-bubble">Hoi, ik ben <b>Bara</b>.<br>Waar kan ik je mee helpen?</div>${input}
    <div class="b-label">Voorbeelden</div>
    <div class="b-examples">${examples().map(([ic, label, k]) => `<button data-ex="${k}">${icon(ic, 18)}<span>${label}</span></button>`).join('')}</div>`;
}
function render() {
  if (!panel?.isConnected) return;
  const typed = $('.b-input textarea', panel)?.value || '';
  $('.b-body', panel).innerHTML = bodyHtml();
  $('.b-new', panel).hidden = !chat.length;
  const ta = $('.b-input textarea', panel);
  if (ta) ta.value = typed;
  const c = $('.b-chat', panel);
  if (c) c.scrollTop = c.scrollHeight;
}
let raf = 0;
function renderAnswer() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const c = panel && $('.b-chat', panel);
    if (!c) return;
    const i = chat.length - 1;
    const el = c.lastElementChild;
    const atEnd = c.scrollHeight - c.scrollTop - c.clientHeight < 60;
    if (el) el.outerHTML = messageHtml(chat[i], i);
    if (atEnd) c.scrollTop = c.scrollHeight;
  });
}
function closePanel() {
  clearAttached(); // de selectie van daarnet is straks niet meer actueel
  streaming?.abort();
  panel?.remove();
  fab?.classList.remove('open');
}
export async function openBara({ withSelection = true } = {}) {
  closePopovers();
  if (!panel) buildPanel();
  document.body.append(panel);
  fab.classList.add('open');
  if (withSelection && editorCtx) {
    const shots = await editorCtx.selectionShots();
    if (shots) { clearAttached(); shots.forEach(s => addAttached(s.label, s.blob)); }
  }
  render();
  if (!navigator.maxTouchPoints) $('.b-input textarea', panel)?.focus();
}
function sendTyped() {
  const ta = $('.b-input textarea', panel);
  const q = ta?.value.trim();
  if (!q) return;
  ta.value = '';
  ask(q);
}
async function runExample(k) {
  if (!isSignedIn()) return;
  const noteShots = async () => {
    const r = await editorCtx.pageShots(6);
    r.shots.forEach(s => addAttached(s.label, s.blob));
    if (r.total > r.shots.length) toast(`Bara leest de eerste ${r.shots.length} van de ${r.total} pagina's`);
    return r;
  };
  if (k === 'today') return ask('Wat moet ik vandaag leren? Geef een korte, concrete volgorde op basis van mijn planning, deadlines en tentamens.');
  if (k === 'summary') { const r = await noteShots(); return ask(`Vat deze notitie samen in de belangrijkste punten.${r.total > r.shots.length ? ` Je ziet de eerste ${r.shots.length} van de ${r.total} pagina's; zeg dat er ook bij.` : ''}`); }
  if (k === 'cards') {
    if (editorCtx && !attached.length) await noteShots();
    return ask(editorCtx ? 'Maak flitskaarten van deze notitie.' : 'Maak flitskaarten van de samenvattingen van dit vak.');
  }
  if (k === 'explain') {
    if (attached.length) return ask('Leg dit begrip uit.');
    const ta = $('.b-input textarea', panel);
    ta.value = 'Leg uit wat dit betekent: ';
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}
function openPencilPad() {
  const body = $('.b-body', panel);
  body.innerHTML = `<p class="b-label">Schrijf je vraag op</p>
    <div class="b-pad"><canvas></canvas></div>
    <div class="b-acts"><button class="btn small ghost" data-p="back">Terug</button><button class="btn small" data-p="clear">Wissen</button><button class="btn small primary" data-p="send">Verstuur</button></div>`;
  const cv = $('canvas', body), r = cv.getBoundingClientRect(), k = window.devicePixelRatio || 1;
  cv.width = r.width * k; cv.height = r.height * k;
  const ctx = cv.getContext('2d');
  const reset = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.setTransform(k, 0, 0, k, 0, 0); ctx.lineWidth = 2.4; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; };
  reset();
  let drawing = null, used = false, penSeen = false;
  const pos = e => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  cv.onpointerdown = e => {
    if (e.pointerType === 'pen') penSeen = true;
    if (e.pointerType === 'touch' && penSeen) return; // handpalm
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch {}
    drawing = e.pointerId;
    used = true;
    const [x, y] = pos(e);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 0.01); ctx.stroke();
  };
  cv.onpointermove = e => { if (e.pointerId !== drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); };
  cv.onpointerup = cv.onpointercancel = e => { if (e.pointerId === drawing) drawing = null; };
  body.onclick = async e => {
    const a = e.target.closest('[data-p]')?.dataset.p;
    if (!a) return;
    if (a === 'clear') { reset(); used = false; }
    if (a === 'back') { body.onclick = null; render(); }
    if (a === 'send') {
      if (!used) return toast('Schrijf eerst je vraag op');
      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.9));
      body.onclick = null;
      ask('Mijn vraag staat handgeschreven in het plaatje "Handgeschreven vraag".', { images: [{ label: 'Handgeschreven vraag', blob }], shown: 'Handgeschreven vraag' });
    }
  };
}
function buildPanel() {
  panel = document.createElement('section');
  panel.className = 'bara-panel';
  panel.setAttribute('aria-label', 'Bara');
  panel.innerHTML = `<div class="b-grab"></div>
    <header class="b-head"><img src="${IMG}" alt=""><h2>Bara</h2>
      <button class="link b-new" hidden>Nieuw gesprek</button>
      <button class="icon-btn small b-close" aria-label="Sluiten">${icon('x', 20)}</button></header>
    <div class="b-body"></div>`;
  panel.addEventListener('submit', e => { e.preventDefault(); sendTyped(); });
  panel.addEventListener('keydown', e => {
    e.stopPropagation(); // sneltoetsen van de editor niet tijdens het typen
    if (e.key === 'Escape') closePanel();
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.b-input textarea')) { e.preventDefault(); sendTyped(); }
  });
  panel.addEventListener('click', e => {
    if (e.target.closest('.b-close')) return closePanel();
    if (e.target.closest('.b-new')) { streaming?.abort(); chat = []; clearAttached(); return render(); }
    const ex = e.target.closest('[data-ex]');
    if (ex) return runExample(ex.dataset.ex);
    const b = e.target.closest('[data-b]');
    if (!b) return;
    if (b.dataset.b === 'unattach') { clearAttached(); return render(); }
    if (b.dataset.b === 'pencil') return openPencilPad();
    onAction(b.dataset.b, +b.dataset.i);
  });
}

export function mountBara() {
  fab = document.createElement('button');
  fab.className = 'bara-fab';
  fab.setAttribute('aria-label', 'Vraag het Bara');
  fab.innerHTML = `<img src="${IMG}" alt="">`;
  fab.addEventListener('click', () => (panel?.isConnected ? closePanel() : openBara()));
  document.body.append(fab);
  const sync = () => {
    fab.hidden = location.hash.startsWith('#/oefenen') || location.hash.startsWith('#/koppel');
    if (fab.hidden) closePanel();
  };
  window.addEventListener('hashchange', sync);
  sync();
}
