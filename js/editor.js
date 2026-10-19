// Notitie-editor: Apple Pencil-invoer, palm rejection, gebaren, lasso, audio-opname en zoom.
import { db, getSetting, setSetting, RUNTIME } from './db.js';
import { $, $$, esc, uid, icon, debounce, toast, popover, closePopovers, confirmDialog, menu, fmtDuration, fmtDate, saveFile, PEN_COLORS, HL_COLORS } from './util.js';
import {
  PAGE_W, PAGE_H, PAPERS, bbox, drawStroke, drawStrokes, drawPaper, paperCss, thumbnail, strokeHit, eraseFromStroke,
  strokesInPoly, translateStroke, unionBox, isScribble, scribbleTargets, recognize, shapePoints, smoothPoints, SMOOTH_LEVELS,
  BOARD_PAPERS, boardBg, renderFit, contentBounds,
} from './ink.js';

const ZOOM_MIN = 0.1, ZOOM_MAX = 5; // canvas-modus: 10% – 500%

const MAX_PIXELS = 5.5e6;          // max pixels per canvas (geheugenlimiet iPad Safari)
const WIDTHS = { pen: [1.6, 2.6, 4.2], hl: [14, 22, 32], eraser: [10, 20, 40] };
const DEFAULTS = {
  tool: 'pen',
  pen: { c: PEN_COLORS[0], w: 2.6 },
  hl: { c: HL_COLORS[0], w: 22 },
  eraser: { w: 20, mode: 'stroke' },
  fingerDraw: false,
  scribble: true,
  hold: true,
  smooth: 1,
};
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

export async function openEditor(root, notebookId, { onExit }) {
  const nb = await db.get('notebooks', notebookId);
  if (!nb) { root.innerHTML = '<p class="empty">Deze notitie bestaat niet meer.</p>'; return () => {}; }
  const subject = await db.get('subjects', nb.subjectId);
  let pages = (await db.by('pages', 'notebookId', notebookId)).sort((a, b) => a.index - b.index);
  if (!pages.length) {
    pages = [{ id: uid('p'), notebookId, index: 0, paper: nb.paper || 'lined', strokes: [] }];
    await db.put('pages', pages[0]);
  }
  // Canvas-modus (Freeform): één oneindig vlak met vrije zoom; pagina-modus: A4-pagina's onder elkaar
  const board = nb.layout === 'board';
  if (board) pages = pages.slice(0, 1);
  const view = { x: -40, y: -40, z: 1, ...(nb.view || {}) };
  const zf = () => board ? view.z : 1; // lijndiktes blijven even dik op het scherm, hoe ver je ook zoomt
  const recordings = (await db.by('recordings', 'notebookId', notebookId)).sort((a, b) => a.created - b.created);
  const saved = await getSetting('tools', {});
  const T = { ...DEFAULTS, ...saved, pen: { ...DEFAULTS.pen, ...saved.pen }, hl: { ...DEFAULTS.hl, ...saved.hl }, eraser: { ...DEFAULTS.eraser, ...saved.eraser } };
  const saveTools = debounce(() => setSetting('tools', T), 400);

  root.innerHTML = `
  <div class="editor" style="--subject:${esc(subject?.color || '#4f6bed')}">
    <header class="ed-bar">
      <div class="ed-left">
        <button class="icon-btn" data-a="back" aria-label="Terug">${icon('back')}</button>
        <div class="ed-titlebox">
          <input class="ed-title" value="${esc(nb.title)}" spellcheck="false" aria-label="Titel">
          <span class="ed-sub">${esc(subject?.name || '')}</span>
        </div>
      </div>
      <div class="ed-tools">
        <div class="seg tools">
          <button class="tool" data-tool="pen" aria-label="Pen">${icon('pen')}</button>
          <button class="tool" data-tool="hl" aria-label="Markeerstift">${icon('highlighter')}</button>
          <button class="tool" data-tool="eraser" aria-label="Gum">${icon('eraser')}</button>
          <button class="tool" data-tool="lasso" aria-label="Lasso">${icon('lasso')}</button>
        </div>
        <div class="tool-opts"></div>
        <div class="seg">
          <button class="icon-btn" data-a="undo" aria-label="Ongedaan maken">${icon('undo')}</button>
          <button class="icon-btn" data-a="redo" aria-label="Opnieuw">${icon('redo')}</button>
        </div>
      </div>
      <div class="ed-right">
        <button class="icon-btn rec-btn" data-a="rec" aria-label="Opnemen">${icon('mic')}<span class="rec-time"></span></button>
        <button class="icon-btn" data-a="recs" aria-label="Opnames">${icon('headphones')}<span class="badge"></span></button>
        <button class="icon-btn" data-a="page" aria-label="${board ? 'Achtergrond' : 'Pagina'}">${icon(board ? 'grid' : 'pageplus')}</button>
        <button class="icon-btn" data-a="hand" aria-label="Tekenen met vinger">${icon('hand')}</button>
        <button class="icon-btn" data-a="more" aria-label="Instellingen">${icon('sliders')}</button>
      </div>
    </header>
    <div class="ed-scroll${board ? ' board' : ''}"><div class="ed-pages"></div></div>
    <div class="ed-status"><button class="pill zoom-ind" data-a="zoomreset" hidden></button><button class="pill pg-nav" data-a="pgprev" aria-label="Vorige pagina">${icon('back', 18)}</button><button class="pill pg-ind" data-a="pglist" aria-label="Naar pagina…"></button><button class="pill pg-nav pg-next" data-a="pgnext" aria-label="Volgende pagina">${icon('back', 18)}</button></div>
    <div class="ed-player" hidden>
      <button class="icon-btn" data-a="p-back" aria-label="10 seconden terug">${icon('rewind')}</button>
      <button class="icon-btn play" data-a="p-play" aria-label="Afspelen">${icon('play')}</button>
      <button class="icon-btn" data-a="p-fwd" aria-label="10 seconden vooruit">${icon('forward')}</button>
      <span class="p-time">0:00</span>
      <input type="range" class="p-range" min="0" max="1000" value="0" aria-label="Positie">
      <span class="p-dur">0:00</span>
      <button class="pill" data-a="p-speed">1×</button>
      <button class="icon-btn" data-a="p-close" aria-label="Sluiten">${icon('x')}</button>
      <div class="p-hint">Tik op je aantekeningen om te horen wat er op dat moment gezegd werd</div>
    </div>
  </div>`;

  const ed = $('.editor', root);
  const scrollEl = $('.ed-scroll', ed);
  const pagesEl = $('.ed-pages', ed);
  const optsEl = $('.tool-opts', ed);
  const live = document.createElement('canvas');
  live.className = 'ink live';

  // ---------- Layout & pagina's ----------
  let zoom = 1, pageW = 800, scale = 0.8, pageH = PAGE_H * 0.8;
  const S = new Map(); // page.id -> { el, canvas, k }
  const byId = id => pages.find(p => p.id === id);
  let fade = null; // { rec, t } tijdens terugluisteren
  let sel = null, drag = null;      // lasso-selectie en verslepen
  let rec = null, recTimer = 0;     // lopende audio-opname
  const player = { open: false, rec: null, audio: new Audio(), url: null, speed: 1 };

  function buildPageEl(pg) {
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.id = pg.id;
    S.set(pg.id, { el, canvas: null, k: 1 });
    styleEl(pg);
    return el;
  }
  function styleEl(pg) {
    const st = S.get(pg.id);
    if (board) { st.el.classList.add('board'); Object.assign(st.el.style, boardBg(pg.paper, view)); return; }
    st.el.style.width = pageW + 'px';
    st.el.style.height = pageH + 'px';
    Object.assign(st.el.style, paperCss(pg.paper, scale));
  }
  // st.k = pixels per eenheid, st.ox/oy = verschuiving in pixels (alleen in canvas-modus ≠ 0)
  function sizeCanvas(st, c) {
    if (board) {
      const cw = scrollEl.clientWidth, ch = scrollEl.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / Math.max(1, cw * ch)));
      const w = Math.round(cw * ratio), h = Math.round(ch * ratio);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      st.ratio = ratio;
      boardTf(st);
      return;
    }
    const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (pageW * pageH)));
    const w = Math.round(pageW * ratio), h = Math.round(pageH * ratio);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    st.k = w / PAGE_W;
    st.ox = st.oy = 0;
  }
  function boardTf(st) {
    st.k = st.ratio * view.z;
    st.ox = -st.k * view.x;
    st.oy = -st.k * view.y;
  }
  const setT = (ctx, st, dx = 0, dy = 0) => ctx.setTransform(st.k, 0, 0, st.k, st.ox + st.k * dx, st.oy + st.k * dy);
  // css-pixels per eenheid en verschuiving (voor de selectie-overlay)
  const cssK = () => board ? view.z : scale;
  const cssO = () => board ? [-view.x * view.z, -view.y * view.z] : [0, 0];
  function visibleRect() {
    return [view.x, view.y, view.x + scrollEl.clientWidth / view.z, view.y + scrollEl.clientHeight / view.z];
  }
  function attach(pg) {
    const st = S.get(pg.id);
    if (!st || st.canvas) return;
    const c = document.createElement('canvas');
    c.className = 'ink';
    st.el.prepend(c);
    st.canvas = c;
    sizeCanvas(st, c);
    render(pg);
  }
  function detach(pg) {
    const st = S.get(pg.id);
    if (!st?.canvas || active?.pg === pg) return;
    st.canvas.width = st.canvas.height = 0;
    st.canvas.remove();
    st.canvas = null;
  }
  function render(pg) {
    const st = S.get(pg.id);
    if (!st?.canvas) return;
    const ctx = st.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, st.canvas.width, st.canvas.height);
    setT(ctx, st);
    drawStrokes(ctx, pg.strokes, { fade, skip: drag && sel?.pg === pg ? sel.ids : null, cull: board ? visibleRect() : null });
  }
  const renderQueue = new Set();
  let renderRaf = 0;
  function renderSoon(pg) {
    renderQueue.add(pg);
    if (!renderRaf) renderRaf = requestAnimationFrame(() => { renderRaf = 0; renderQueue.forEach(render); renderQueue.clear(); });
  }

  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      const pg = byId(en.target.dataset.id);
      if (!pg) continue;
      if (en.isIntersecting) attach(pg); else detach(pg);
    }
  }, { root: scrollEl, rootMargin: '120% 0px' });

  function updateZoomInd() {
    const zi = $('.zoom-ind', ed);
    const z = board ? view.z : zoom;
    zi.hidden = !board && Math.abs(zoom - 1) < 0.01;
    zi.textContent = Math.round(z * 100) + '%';
  }
  function layout() {
    if (board) {
      const pg = pages[0], st = S.get(pg.id);
      styleEl(pg);
      if (st.canvas) { sizeCanvas(st, st.canvas); render(pg); } else attach(pg);
      if (live.parentNode) live.width = live.height = 0, live.remove();
      positionSelection();
      updateZoomInd();
      return;
    }
    const cw = scrollEl.clientWidth;
    const baseW = Math.max(280, Math.min(cw - 32, 920));
    pageW = Math.round(baseW * zoom);
    scale = pageW / PAGE_W;
    pageH = Math.round(PAGE_H * scale);
    for (const pg of pages) {
      styleEl(pg);
      const st = S.get(pg.id);
      if (st.canvas) { sizeCanvas(st, st.canvas); render(pg); }
    }
    if (live.parentNode) live.width = live.height = 0, live.remove();
    positionSelection();
    updateZoomInd();
  }

  function mountPages() {
    pagesEl.innerHTML = '';
    for (const pg of pages) { const el = buildPageEl(pg); pagesEl.append(el); if (!board) io.observe(el); }
  }
  mountPages();
  layout();

  // Canvas-modus: weergave verschuiven/zoomen (z = css-pixels per eenheid; 1 = 100%)
  const saveView = debounce(() => { nb.view = { ...view }; saveSoon(); }, 500);
  function setView(x, y, z = view.z) {
    view.z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    view.x = x;
    view.y = y;
    const pg = pages[0], st = S.get(pg.id);
    styleEl(pg);
    if (st.canvas) boardTf(st);
    renderSoon(pg);
    positionSelection();
    updateZoomInd();
    saveView();
  }
  function zoomAt(cx, cy, z) {
    const r = scrollEl.getBoundingClientRect();
    const wx = view.x + (cx - r.left) / view.z, wy = view.y + (cy - r.top) / view.z;
    const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    setView(wx - (cx - r.left) / nz, wy - (cy - r.top) / nz, nz);
  }
  function fitAll() {
    const b = contentBounds(pages[0].strokes);
    const cw = scrollEl.clientWidth, ch = scrollEl.clientHeight;
    if (!b) return setView(-40, -40, 1);
    const pad = 60;
    const z = Math.min(2, (cw - pad * 2) / Math.max(1, b[2] - b[0]), (ch - pad * 2) / Math.max(1, b[3] - b[1]));
    const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    setView((b[0] + b[2]) / 2 - cw / 2 / nz, (b[1] + b[3]) / 2 - ch / 2 / nz, nz);
  }
  if (board) {
    scrollEl.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, view.z * Math.exp(-e.deltaY * 0.01));
      else setView(view.x + e.deltaX / view.z, view.y + e.deltaY / view.z);
    }, { passive: false });
  }

  function currentPageIndex() {
    if (board) return 0;
    const mid = scrollEl.getBoundingClientRect().top + scrollEl.clientHeight / 2;
    let best = 0, bestD = Infinity;
    pages.forEach((pg, i) => {
      const r = S.get(pg.id).el.getBoundingClientRect();
      const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
  function updatePageInd() {
    const el = $('.pg-ind', ed), i = currentPageIndex();
    el.hidden = board;
    el.textContent = `${i + 1} / ${pages.length}`;
    // Vorige/volgende: ook als je alleen met de Pencil werkt of 'tekenen met vinger' aan staat (dan scrolt je vinger niet)
    $$('.pg-nav', ed).forEach(b => { b.hidden = board || pages.length < 2; });
    $('[data-a=pgprev]', ed).disabled = i === 0;
    $('[data-a=pgnext]', ed).disabled = i === pages.length - 1;
  }
  // navTo onthoudt waar je heen wilde, zodat snel twee keer tikken ook twee pagina's verder gaat
  let navTo = null;
  function goToPage(i) {
    i = Math.max(0, Math.min(pages.length - 1, i));
    const el = S.get(pages[i].id).el;
    const top = scrollEl.scrollTop + el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top - 12;
    const nav = navTo = { i, t: Date.now() };
    const y = Math.max(0, Math.min(top, scrollEl.scrollHeight - scrollEl.clientHeight));
    scrollEl.scrollTo({ top: y, behavior: 'smooth' });
    // Vangnet: als de vloeiende scroll onderbroken wordt, alsnog op de pagina uitkomen
    setTimeout(() => { if (navTo === nav && Math.abs(scrollEl.scrollTop - y) > 4) scrollEl.scrollTop = y; updatePageInd(); }, 600);
  }
  const navBase = () => navTo && Date.now() - navTo.t < 700 ? navTo.i : currentPageIndex();
  let scrollRaf = 0;
  scrollEl.addEventListener('scroll', () => { if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updatePageInd(); }); }, { passive: true });
  updatePageInd();

  // ---------- Opslaan ----------
  const dirty = new Set();
  async function flushSave() {
    const list = [...dirty];
    dirty.clear();
    if (list.length) await db.putMany('pages', list);
    nb.updated = Date.now();
    nb.pageCount = pages.length;
    await db.put('notebooks', nb);
  }
  const saveSoon = debounce(flushSave, 700);
  function save(pg) { dirty.add(pg); saveSoon(); }
  const onHide = () => { if (document.visibilityState === 'hidden') saveSoon.flush(); };
  document.addEventListener('visibilitychange', onHide);

  $('.ed-title', ed).addEventListener('change', e => { nb.title = e.target.value.trim() || 'Naamloos'; saveSoon(); });

  // ---------- Ongedaan maken ----------
  const undo = [], redo = [];
  function pushUndo(pg, before, after) {
    undo.push({ id: pg.id, before, after });
    if (undo.length > 200) undo.shift();
    redo.length = 0;
    updateUndoBtns();
  }
  function applyOp(op, which) {
    const pg = byId(op.id);
    if (!pg) return;
    clearSelection();
    pg.strokes = op[which];
    render(pg);
    save(pg);
  }
  function doUndo() { const op = undo.pop(); if (!op) return; applyOp(op, 'before'); redo.push(op); updateUndoBtns(); }
  function doRedo() { const op = redo.pop(); if (!op) return; applyOp(op, 'after'); undo.push(op); updateUndoBtns(); }
  function updateUndoBtns() {
    $('[data-a=undo]', ed).disabled = !undo.length;
    $('[data-a=redo]', ed).disabled = !redo.length;
  }
  updateUndoBtns();

  // ---------- Werkbalk ----------
  function updateToolbar() {
    $$('.tool', ed).forEach(b => b.classList.toggle('on', b.dataset.tool === T.tool));
    $('[data-a=hand]', ed).classList.toggle('on', T.fingerDraw);
    let h = '';
    if (T.tool === 'pen' || T.tool === 'hl') {
      const cols = T.tool === 'pen' ? PEN_COLORS : HL_COLORS;
      const cur = T[T.tool].c;
      const custom = !cols.includes(cur);
      h += `<div class="swatches">${cols.map(c => `<button class="sw ${c === cur ? 'on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Kleur"></button>`).join('')}
        <label class="sw custom ${custom ? 'on' : ''}" style="--c:${custom ? cur : 'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)'}" aria-label="Eigen kleur"><input type="color" value="${custom ? cur : '#333333'}"></label></div>`;
      h += `<div class="widths">${WIDTHS[T.tool].map(w => `<button class="wd ${w === T[T.tool].w ? 'on' : ''}" data-w="${w}" aria-label="Dikte"><i style="width:${T.tool === 'pen' ? 3 + w * 2.2 : 6 + w / 3}px;height:${T.tool === 'pen' ? 3 + w * 2.2 : 6 + w / 3}px;background:${T.tool === 'hl' ? T.hl.c : 'currentColor'}"></i></button>`).join('')}</div>`;
    } else if (T.tool === 'eraser') {
      h += `<div class="seg small"><button class="pill ${T.eraser.mode === 'stroke' ? 'on' : ''}" data-em="stroke">Hele lijn</button><button class="pill ${T.eraser.mode === 'precise' ? 'on' : ''}" data-em="precise">Precies</button></div>`;
      h += `<div class="widths">${WIDTHS.eraser.map(w => `<button class="wd ${w === T.eraser.w ? 'on' : ''}" data-w="${w}" aria-label="Grootte"><i class="ring" style="width:${6 + w / 2.2}px;height:${6 + w / 2.2}px"></i></button>`).join('')}</div>`;
    } else {
      h += `<span class="hint">Omcirkel inkt om te selecteren</span>`;
    }
    optsEl.innerHTML = h;
    const ci = $('input[type=color]', optsEl);
    if (ci) ci.addEventListener('input', e => { T[T.tool].c = e.target.value; saveTools(); updateToolbar(); });
  }
  updateToolbar();

  optsEl.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.c) T[T.tool].c = b.dataset.c;
    if (b.dataset.w) T[T.tool].w = +b.dataset.w;
    if (b.dataset.em) T.eraser.mode = b.dataset.em;
    saveTools();
    updateToolbar();
  });

  function setTool(t) {
    if (T.tool === t && (t === 'pen' || t === 'hl')) return;
    T.tool = t;
    if (t !== 'lasso') clearSelection();
    saveTools();
    updateToolbar();
  }

  ed.querySelector('.ed-bar').addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) return setTool(b.dataset.tool);
    switch (b.dataset.a) {
      case 'back': return exit();
      case 'undo': return doUndo();
      case 'redo': return doRedo();
      case 'hand': T.fingerDraw = !T.fingerDraw; saveTools(); updateToolbar(); toast(T.fingerDraw ? 'Tekenen met je vinger staat aan' : 'Alleen de Pencil tekent — vinger scrolt'); return;
      case 'rec': return rec ? stopRecording() : startRecording();
      case 'recs': return recMenu(b);
      case 'page': return pageMenu(b);
      case 'more': return moreMenu(b);
    }
  });
  $('.ed-status', ed).addEventListener('click', async e => {
    const nav = e.target.closest('[data-a=pgprev], [data-a=pgnext], [data-a=pglist]');
    if (nav) {
      const i = navBase();
      if (nav.dataset.a === 'pgprev') return goToPage(i - 1);
      if (nav.dataset.a === 'pgnext') return goToPage(i + 1);
      if (pages.length < 2) return;
      const v = await menu(nav, pages.map((p, k) => ({ label: `Pagina ${k + 1}${k === i ? ' (hier)' : ''}`, value: String(k), icon: 'page' })), { align: 'right' });
      if (v != null) goToPage(+v);
      return;
    }
    const zb = e.target.closest('[data-a=zoomreset]');
    if (!zb) return;
    if (board) {
      const r = scrollEl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const v = await menu(zb, [
        { label: 'Alles in beeld', value: 'fit', icon: 'zoom' },
        { label: '100%', value: 1 }, { label: '50%', value: 0.5 }, { label: '25%', value: 0.25 }, { label: '200%', value: 2 },
      ], { align: 'right' });
      if (v === 'fit') fitAll(); else if (v) zoomAt(cx, cy, v);
      return;
    }
    const i = currentPageIndex(); zoom = 1; layout(); S.get(pages[i].id).el.scrollIntoView({ block: 'start' });
  });

  // ---------- Invoer ----------
  let active = null;
  let penAt = 0;
  let holdTimer = 0, holdAnchor = null;
  let liveRaf = 0;
  let tapTouch = null;

  function toUnit(e, st) {
    const r = st.el.getBoundingClientRect();
    if (board) return [view.x + (e.clientX - r.left) / view.z, view.y + (e.clientY - r.top) / view.z];
    return [(e.clientX - r.left) / r.width * PAGE_W, (e.clientY - r.top) / r.height * PAGE_H];
  }
  function ensureLive(st) {
    if (live.parentNode !== st.el) st.el.append(live);
    if (st.canvas) { if (live.width !== st.canvas.width || live.height !== st.canvas.height) { live.width = st.canvas.width; live.height = st.canvas.height; } }
  }
  function liveSoon() { if (!liveRaf) liveRaf = requestAnimationFrame(drawLive); }
  function clearLive() { const ctx = live.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, live.width, live.height); }
  function drawLive() {
    liveRaf = 0;
    clearLive();
    const ctx = live.getContext('2d');
    if (drag && sel) {
      const st = S.get(sel.pg.id);
      setT(ctx, st, drag.dx, drag.dy);
      drawStrokes(ctx, sel.pg.strokes.filter(s => sel.ids.has(s.id)));
      return;
    }
    if (!active) return;
    const st = active.st;
    setT(ctx, st);
    if (active.tool === 'pen' || active.tool === 'hl') {
      if (active.pts.length) drawStroke(ctx, { tool: active.tool, c: T[active.tool].c, w: active.w, p: active.shape ? active.pts : smoothPoints(active.pts, T.smooth) });
    } else if (active.tool === 'lasso') {
      const p = active.pts;
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 3) i ? ctx.lineTo(p[i], p[i + 1]) : ctx.moveTo(p[i], p[i + 1]);
      ctx.setLineDash([8 / zf(), 7 / zf()]);
      ctx.lineWidth = 2 / zf();
      ctx.strokeStyle = '#4f6bed';
      ctx.stroke();
      ctx.fillStyle = 'rgba(79,107,237,.06)';
      ctx.fill();
    } else if (active.tool === 'eraser' && active.last) {
      ctx.beginPath();
      ctx.arc(active.last[0], active.last[1], T.eraser.w / 2 / zf(), 0, Math.PI * 2);
      ctx.lineWidth = 1.5 / zf();
      ctx.strokeStyle = 'rgba(30,30,40,.5)';
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.fill();
      ctx.stroke();
    }
  }

  function addPoint(x, y, pr) {
    const p = active.pts, n = p.length;
    if (n && Math.hypot(x - p[n - 3], y - p[n - 2]) < 0.45 / zf()) return;
    p.push(r1(x), r1(y), r2(pr));
  }

  function armHold(x, y) {
    clearTimeout(holdTimer);
    holdAnchor = [x, y];
    holdTimer = setTimeout(onHold, 480);
  }
  function onHold() {
    if (!active || active.tool !== 'pen' || active.shape || !T.hold) return;
    const shape = recognize(active.pts);
    if (!shape) return;
    if (shape.type !== 'line') {
      // Cirkel om bestaande inkt + vasthouden = lasso-selectie
      const inside = strokesInPoly(active.pg.strokes, shape.poly, 0.6);
      if (inside.length) {
        const pg = active.pg;
        active = null;
        clearLive();
        select(pg, inside);
        return;
      }
    }
    let pr = 0, n = 0;
    for (let i = 2; i < active.pts.length; i += 3) { pr += active.pts[i]; n++; }
    active.shape = shape;
    active.pressure = n ? pr / n : 0.5;
    active.pts = shapePoints(shape, active.pressure);
    liveSoon();
  }

  function eraseAt(x, y) {
    const pg = active.pg, r = T.eraser.w / 2 / zf();
    let changed = false;
    if (T.eraser.mode === 'stroke') {
      const keep = pg.strokes.filter(s => !strokeHit(s, x, y, r));
      if (keep.length !== pg.strokes.length) { pg.strokes = keep; changed = true; }
    } else {
      const out = [];
      for (const s of pg.strokes) {
        const res = eraseFromStroke(s, x, y, r, () => uid('s'));
        if (res === null) out.push(s); else { out.push(...res); changed = true; }
      }
      if (changed) pg.strokes = out;
    }
    if (changed) { active.changed = true; renderSoon(pg); }
  }

  function onDown(e) {
    if (e.button > 0) return;
    const type = e.pointerType;
    if (type === 'pen') penAt = Date.now();
    if (e.target.closest('.sel-box, .sel-bar')) return;
    const drawTouch = type === 'touch' && T.fingerDraw && !pinch && Date.now() - penAt > 600;
    if (type === 'touch' && !drawTouch) {
      tapTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
      return;
    }
    if (active) return;
    const pageEl = e.target.closest('.page');
    if (!pageEl) { clearSelection(); return; }
    const pg = byId(pageEl.dataset.id), st = S.get(pg.id);
    if (!st.canvas) attach(pg);
    e.preventDefault();
    try { pageEl.setPointerCapture(e.pointerId); } catch {}
    closePopovers();
    if (sel) clearSelection();
    const [x, y] = toUnit(e, st);
    active = {
      id: e.pointerId, type, pg, st, tool: T.tool, pts: [], t0: performance.now(),
      w: (T.tool === 'pen' || T.tool === 'hl') ? r2(T[T.tool].w / zf()) : 0,
      pr: type === 'pen' ? (e.pressure || 0.3) : 0.5,
      recId: rec?.id, recT: rec ? Math.round(performance.now() - rec.start) : undefined,
    };
    ensureLive(st);
    if (active.tool === 'eraser') { active.before = pg.strokes; active.last = [x, y]; eraseAt(x, y); }
    else addPoint(x, y, active.pr);
    if (active.tool === 'pen' && T.hold) armHold(x, y);
    liveSoon();
  }

  function onMove(e) {
    if (tapTouch && e.pointerId === tapTouch.id && Math.hypot(e.clientX - tapTouch.x, e.clientY - tapTouch.y) > 10) tapTouch = null;
    if (!active || e.pointerId !== active.id) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents?.() || [];
    for (const ev of evs.length ? evs : [e]) {
      const [x, y] = toUnit(ev, active.st);
      if (active.tool === 'eraser') {
        const [lx, ly] = active.last;
        const d = Math.hypot(x - lx, y - ly), step = Math.max(2, T.eraser.w * 0.35) / zf();
        for (let i = 1, n = Math.ceil(d / step); i <= n; i++) eraseAt(lx + (x - lx) * i / n, ly + (y - ly) * i / n);
        active.last = [x, y];
        continue;
      }
      if (active.shape) {
        if (active.shape.type === 'line') { active.shape.to = [x, y]; active.pts = shapePoints(active.shape, active.pressure); }
        continue;
      }
      const pr = active.type === 'pen' ? active.pr * 0.45 + (ev.pressure || 0) * 0.55 : 0.5;
      active.pr = pr;
      addPoint(x, y, pr);
      if (active.tool === 'pen' && T.hold && holdAnchor && Math.hypot(x - holdAnchor[0], y - holdAnchor[1]) > 5 / zf()) armHold(x, y);
    }
    if (active.type === 'pen') penAt = Date.now();
    liveSoon();
  }

  function onUp(e) {
    if (tapTouch && e.pointerId === tapTouch.id) {
      const t = tapTouch;
      tapTouch = null;
      if (e.type === 'pointerup' && player.open && performance.now() - t.t < 350) {
        const pageEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.page');
        if (pageEl) { const pg = byId(pageEl.dataset.id); seekAt(pg, ...toUnit(e, S.get(pg.id))); }
      }
      return;
    }
    if (!active || e.pointerId !== active.id) return;
    clearTimeout(holdTimer);
    const a = active;
    active = null;
    if (a.type === 'pen') penAt = Date.now();
    const pg = a.pg;
    if (a.tool === 'eraser') {
      if (a.changed) { pushUndo(pg, a.before, pg.strokes); save(pg); }
      clearLive();
      return;
    }
    if (a.tool === 'lasso') {
      clearLive();
      const poly = a.pts.filter((_, i) => i % 3 !== 2);
      if (poly.length >= 6) {
        const hits = strokesInPoly(pg.strokes, poly, 0.5);
        if (hits.length) select(pg, hits);
      }
      return;
    }
    if (!a.pts.length || e.type === 'pointercancel' && a.pts.length < 6) { clearLive(); return; }
    const dur = performance.now() - a.t0;
    const [bx0, by0, bx1, by1] = bbox(a.pts);
    const isTap = dur < 300 && Math.hypot(bx1 - bx0, by1 - by0) < 4 / zf();
    if (player.open && isTap && seekAt(pg, a.pts[0], a.pts[1])) { clearLive(); return; }
    if (a.tool === 'pen' && T.scribble && !a.shape && isScribble(a.pts)) {
      const targets = scribbleTargets(pg.strokes, a.pts);
      if (targets.length) {
        const ids = new Set(targets.map(s => s.id));
        const before = pg.strokes;
        pg.strokes = before.filter(s => !ids.has(s.id));
        pushUndo(pg, before, pg.strokes);
        render(pg);
        save(pg);
        clearLive();
        return;
      }
    }
    const pts = a.shape ? a.pts : smoothPoints(a.pts, T.smooth);
    const s = { id: uid('s'), tool: a.tool === 'hl' ? 'hl' : 'pen', c: T[a.tool].c, w: a.w, p: pts, b: bbox(pts) };
    if (a.recId) { s.r = a.recId; s.t = a.recT; }
    const before = pg.strokes;
    pg.strokes = [...before, s];
    pushUndo(pg, before, pg.strokes);
    if (s.tool === 'hl' || fade) render(pg);
    else if (a.st.canvas) {
      const ctx = a.st.canvas.getContext('2d');
      setT(ctx, a.st);
      drawStroke(ctx, s);
    }
    clearLive();
    save(pg);
  }

  scrollEl.addEventListener('pointerdown', onDown);
  scrollEl.addEventListener('pointermove', onMove);
  scrollEl.addEventListener('pointerup', onUp);
  scrollEl.addEventListener('pointercancel', onUp);

  // Touch: Pencil mag nooit scrollen, vingers wel (palm rejection); twee vingers = zoomen.
  let pinch = null, gesture = null;
  const isStylus = t => t.touchType === 'stylus';
  // Handpalm = aanraking vlak na de Pencil, of een groot contactvlak terwijl je aan het schrijven bent.
  // (Een gewone vingertop meldt op de iPad vaak al radiusX > 28; die moet gewoon kunnen scrollen.)
  const isPalm = t => Date.now() - penAt < 450 || ((t.radiusX || 0) > 45 && Date.now() - penAt < 3000);
  function onTouchStart(e) {
    const all = [...e.touches];
    if (all.some(isStylus)) { e.preventDefault(); return; }
    if (e.target.closest('.sel-box')) { e.preventDefault(); return; }
    if ([...e.changedTouches].some(isPalm) || active?.type === 'pen') { e.preventDefault(); return; }
    if (!gesture || e.touches.length === e.changedTouches.length) gesture = { t: performance.now(), max: 0, moved: false, pts: {} };
    gesture.max = Math.max(gesture.max, all.length);
    for (const t of e.changedTouches) gesture.pts[t.identifier] = [t.clientX, t.clientY];
    if (board) {
      // Canvas: geen native scroll; één vinger = schuiven, twee = knijp-zoom + schuiven
      e.preventDefault();
      if (all.length >= 2) {
        if (active?.type === 'touch') { active = null; clearLive(); }
        pan = null;
        startBoardPinch(all);
      } else if (!T.fingerDraw) startPan(all[0]);
      return;
    }
    if (all.length === 2) {
      e.preventDefault();
      if (active?.type === 'touch') { active = null; clearLive(); }
      startPinch(all);
    } else if (all.length === 1 && T.fingerDraw && e.target.closest('.page')) e.preventDefault();
  }
  function onTouchMove(e) {
    const all = [...e.touches];
    if (all.some(isStylus) || active?.type === 'pen') { e.preventDefault(); return; }
    if (gesture) for (const t of e.changedTouches) {
      const p0 = gesture.pts[t.identifier];
      if (p0 && Math.hypot(t.clientX - p0[0], t.clientY - p0[1]) > 12) gesture.moved = true;
    }
    if (board) {
      e.preventDefault();
      if (pinch && all.length >= 2) updateBoardPinch(all);
      else if (pan) {
        const t = all.find(x => x.identifier === pan.id);
        if (t) setView(pan.vx - (t.clientX - pan.x) / view.z, pan.vy - (t.clientY - pan.y) / view.z);
      }
      return;
    }
    if (pinch && all.length >= 2) { e.preventDefault(); updatePinch(all); }
    else if (active?.type === 'touch' || drag) e.preventDefault();
  }
  function onTouchEnd(e) {
    if (board) {
      if (pinch && e.touches.length < 2) { pinch = null; if (gesture) gesture.moved = true; }
      if (e.touches.length === 1 && !T.fingerDraw) startPan(e.touches[0]);
      if (e.touches.length === 0) pan = null;
    } else if (pinch && e.touches.length < 2) endPinch();
    if (e.touches.length === 0 && gesture) {
      const g = gesture;
      gesture = null;
      // Tik met twee vingers = ongedaan maken, drie vingers = opnieuw (zoals GoodNotes/Notability)
      if (!g.moved && performance.now() - g.t < 320) {
        if (g.max === 2) { doUndo(); toast('Ongedaan gemaakt', { ms: 900 }); }
        else if (g.max === 3) { doRedo(); toast('Opnieuw', { ms: 900 }); }
      }
    }
  }
  scrollEl.addEventListener('touchstart', onTouchStart, { passive: false });
  scrollEl.addEventListener('touchmove', onTouchMove, { passive: false });
  scrollEl.addEventListener('touchend', onTouchEnd);
  scrollEl.addEventListener('touchcancel', onTouchEnd);

  // ---------- Zoomen ----------
  function centroid(ts) { return [(ts[0].clientX + ts[1].clientX) / 2, (ts[0].clientY + ts[1].clientY) / 2]; }
  let pan = null;
  function startPan(t) { pan = { id: t.identifier, x: t.clientX, y: t.clientY, vx: view.x, vy: view.y }; }
  // Canvas: het wereldpunt onder het midden van je vingers blijft onder je vingers
  function startBoardPinch(ts) {
    const c = centroid(ts), r = scrollEl.getBoundingClientRect();
    pinch = {
      d0: Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY) || 1, z0: view.z,
      wx: view.x + (c[0] - r.left) / view.z, wy: view.y + (c[1] - r.top) / view.z,
    };
  }
  function updateBoardPinch(ts) {
    const c = centroid(ts), r = scrollEl.getBoundingClientRect();
    const d = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinch.z0 * d / pinch.d0));
    setView(pinch.wx - (c[0] - r.left) / z, pinch.wy - (c[1] - r.top) / z, z);
  }
  function startPinch(ts) {
    const c = centroid(ts);
    const d = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY) || 1;
    // ankerpunt: pagina + positie onder het midden van de vingers
    let anchor = null, best = Infinity;
    for (const pg of pages) {
      const r = S.get(pg.id).el.getBoundingClientRect();
      const dy = c[1] < r.top ? r.top - c[1] : c[1] > r.bottom ? c[1] - r.bottom : 0;
      if (dy < best) { best = dy; anchor = { pg, u: (c[0] - r.left) / r.width * PAGE_W, v: (c[1] - r.top) / r.height * PAGE_H }; }
    }
    const pr = pagesEl.getBoundingClientRect();
    pagesEl.style.transformOrigin = `${c[0] - pr.left}px ${c[1] - pr.top}px`;
    pinch = { c0: c, c, d0: d, z0: zoom, k: 1, anchor };
  }
  function updatePinch(ts) {
    const c = centroid(ts);
    const d = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
    const z = Math.min(3, Math.max(0.5, pinch.z0 * d / pinch.d0));
    pinch.k = z / pinch.z0;
    pinch.c = c;
    pagesEl.style.transform = `translate(${c[0] - pinch.c0[0]}px, ${c[1] - pinch.c0[1]}px) scale(${pinch.k})`;
  }
  function endPinch() {
    const p = pinch;
    pinch = null;
    pagesEl.style.transform = '';
    let z = p.z0 * p.k;
    if (Math.abs(z - 1) < 0.08) z = 1;
    zoom = z;
    layout();
    if (p.anchor) {
      const r = S.get(p.anchor.pg.id).el.getBoundingClientRect();
      scrollEl.scrollLeft += r.left + p.anchor.u / PAGE_W * r.width - p.c[0];
      scrollEl.scrollTop += r.top + p.anchor.v / PAGE_H * r.height - p.c[1];
    }
    if (gesture) gesture.moved = true;
  }
  const blockGesture = e => e.preventDefault();
  ed.addEventListener('gesturestart', blockGesture);
  ed.addEventListener('gesturechange', blockGesture);

  let resizeT;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (board) return layout();
      const ratio = scrollEl.scrollTop / Math.max(1, scrollEl.scrollHeight);
      layout();
      scrollEl.scrollTop = ratio * scrollEl.scrollHeight;
    }, 120);
  });
  ro.observe(scrollEl);

  // ---------- Selectie (lasso) ----------
  function select(pg, strokes) {
    clearSelection();
    sel = { pg, ids: new Set(strokes.map(s => s.id)) };
    const st = S.get(pg.id);
    const box = document.createElement('div');
    box.className = 'sel-box';
    const bar = document.createElement('div');
    bar.className = 'sel-bar';
    bar.innerHTML = `
      <button data-s="color" aria-label="Kleur">${icon('edit', 18)}<span>Kleur</span></button>
      <button data-s="dup" aria-label="Dupliceer">${icon('copy', 18)}<span>Kopie</span></button>
      <button data-s="del" class="danger" aria-label="Verwijder">${icon('trash', 18)}<span>Wis</span></button>
      <button data-s="done" aria-label="Klaar">${icon('check', 18)}</button>`;
    st.el.append(box, bar);
    sel.box = box;
    sel.bar = bar;
    positionSelection();
    box.addEventListener('pointerdown', startDrag);
    bar.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.s === 'del') selDelete();
      if (b.dataset.s === 'dup') selDuplicate();
      if (b.dataset.s === 'done') clearSelection();
      if (b.dataset.s === 'color') selColorMenu(b);
    });
  }
  function selStrokes() { return sel ? sel.pg.strokes.filter(s => sel.ids.has(s.id)) : []; }
  function positionSelection() {
    if (!sel) return;
    const list = selStrokes();
    if (!list.length) return clearSelection();
    const [x0, y0, x1, y1] = unionBox(list);
    const k = cssK(), [ox, oy] = cssO(), pad = 8 / zf();
    const L = (x0 - pad) * k + ox, Tp = (y0 - pad) * k + oy, B = (y1 + pad) * k + oy;
    Object.assign(sel.box.style, {
      left: L + 'px', top: Tp + 'px',
      width: (x1 - x0 + pad * 2) * k + 'px', height: (y1 - y0 + pad * 2) * k + 'px', transform: '',
    });
    const top = Tp - 52;
    sel.bar.style.left = Math.max(4, L) + 'px';
    sel.bar.style.top = (top < 4 ? B + 8 : top) + 'px';
  }
  function clearSelection() {
    if (!sel) return;
    sel.box.remove();
    sel.bar.remove();
    sel = null;
    drag = null;
  }
  function startDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    const st = S.get(sel.pg.id);
    try { sel.box.setPointerCapture(e.pointerId); } catch {}
    const [x, y] = toUnit(e, st);
    drag = { id: e.pointerId, x, y, dx: 0, dy: 0 };
    sel.bar.style.visibility = 'hidden';
    render(sel.pg);
    ensureLive(st);
    liveSoon();
    const move = ev => {
      if (ev.pointerId !== drag?.id) return;
      const [mx, my] = toUnit(ev, st);
      drag.dx = mx - drag.x;
      drag.dy = my - drag.y;
      sel.box.style.transform = `translate(${drag.dx * cssK()}px, ${drag.dy * cssK()}px)`;
      liveSoon();
    };
    const up = ev => {
      if (ev.pointerId !== drag?.id) return;
      sel.box.removeEventListener('pointermove', move);
      sel.box.removeEventListener('pointerup', up);
      sel.box.removeEventListener('pointercancel', up);
      const { dx, dy } = drag;
      drag = null;
      clearLive();
      sel.bar.style.visibility = '';
      if (Math.abs(dx) + Math.abs(dy) > 0.5) {
        const pg = sel.pg, before = pg.strokes, ids = new Set();
        pg.strokes = before.map(s => { if (!sel.ids.has(s.id)) return s; const n = translateStroke(s, dx, dy, uid('s')); ids.add(n.id); return n; });
        sel.ids = ids;
        pushUndo(pg, before, pg.strokes);
        save(pg);
      }
      render(sel.pg);
      positionSelection();
    };
    sel.box.addEventListener('pointermove', move);
    sel.box.addEventListener('pointerup', up);
    sel.box.addEventListener('pointercancel', up);
  }
  function selDelete() {
    const pg = sel.pg, before = pg.strokes;
    pg.strokes = before.filter(s => !sel.ids.has(s.id));
    pushUndo(pg, before, pg.strokes);
    clearSelection();
    render(pg);
    save(pg);
  }
  function selDuplicate() {
    const pg = sel.pg, before = pg.strokes;
    const copies = selStrokes().map(s => translateStroke(s, 30 / zf(), 30 / zf(), uid('s')));
    pg.strokes = [...before, ...copies];
    pushUndo(pg, before, pg.strokes);
    render(pg);
    save(pg);
    select(pg, copies);
  }
  function selColorMenu(anchor) {
    const cols = [...PEN_COLORS, ...HL_COLORS];
    const pop = popover(anchor, `<div class="swatches pop">${cols.map(c => `<button class="sw" data-c="${c}" style="--c:${c}"></button>`).join('')}</div>`);
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      closePopovers();
      const pg = sel.pg, before = pg.strokes, ids = new Set();
      pg.strokes = before.map(s => { if (!sel.ids.has(s.id)) return s; const n = { ...s, id: uid('s'), c: b.dataset.c }; ids.add(n.id); return n; });
      sel.ids = ids;
      pushUndo(pg, before, pg.strokes);
      render(pg);
      save(pg);
    });
  }

  // ---------- Pagina-menu ----------
  async function addPage(at) {
    const ref = pages[Math.min(at - 1, pages.length - 1)] || pages[0];
    const pg = { id: uid('p'), notebookId, index: 0, paper: ref?.paper || nb.paper || 'lined', strokes: [] };
    pages.splice(at, 0, pg);
    pages.forEach((p, i) => { p.index = i; });
    const el = buildPageEl(pg);
    pagesEl.insertBefore(el, pagesEl.children[at] || null);
    io.observe(el);
    await db.putMany('pages', pages);
    saveSoon();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(updatePageInd, 400);
  }
  async function deletePage(pg) {
    if (pages.length === 1) {
      if (!pg.strokes.length || await confirmDialog('Alles op deze pagina wissen?', { ok: 'Wis pagina' })) {
        const before = pg.strokes; pg.strokes = []; pushUndo(pg, before, []); render(pg); save(pg);
      }
      return;
    }
    if (pg.strokes.length && !await confirmDialog('Deze pagina verwijderen?')) return;
    const st = S.get(pg.id);
    io.unobserve(st.el);
    st.el.remove();
    S.delete(pg.id);
    pages = pages.filter(p => p !== pg);
    pages.forEach((p, i) => { p.index = i; });
    for (const stack of [undo, redo]) for (let i = stack.length - 1; i >= 0; i--) if (stack[i].id === pg.id) stack.splice(i, 1);
    updateUndoBtns();
    await db.del('pages', pg.id);
    await db.putMany('pages', pages);
    saveSoon();
    updatePageInd();
  }
  function boardMenu(anchor) {
    const pg = pages[0];
    const pop = popover(anchor, `
      <div class="menu">
        <div class="menu-label">Achtergrond</div>
        <div class="paper-pick four">${BOARD_PAPERS.map(p => `<button class="paper-opt ${p.id === pg.paper ? 'on' : ''}" data-paper="${p.id}"><i class="pp pp-${p.id}"></i><span>${p.label}</span></button>`).join('')}</div>
        <hr>
        <button class="menu-item" data-p="fit">${icon('zoom', 18)}<span>Alles in beeld</span></button>
        <button class="menu-item" data-p="export">${icon('export', 18)}<span>Delen als afbeelding</span></button>
      </div>`, { align: 'right' });
    pop.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.paper) {
        pg.paper = nb.paper = b.dataset.paper;
        styleEl(pg);
        save(pg);
        $$('.paper-opt', pop).forEach(o => o.classList.toggle('on', o === b));
        return;
      }
      closePopovers();
      if (b.dataset.p === 'fit') fitAll();
      if (b.dataset.p === 'export') exportBoard();
    });
  }
  async function exportBoard() {
    const strokes = pages[0].strokes;
    const b = contentBounds(strokes);
    if (!b) { toast('Er staat nog niets op dit canvas'); return; }
    const bw = b[2] - b[0], bh = b[3] - b[1], k = Math.min(3, 4000 / Math.max(bw, bh));
    const c = renderFit(strokes, Math.round(bw * k * 1.08) + 40, Math.round(bh * k * 1.08) + 40, 0.04);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    saveFile(blob, `${(nb.title || 'canvas').replace(/[\\/:*?"<>|]/g, '-')}.png`);
  }
  function pageMenu(anchor) {
    if (board) return boardMenu(anchor);
    const i = currentPageIndex(), pg = pages[i];
    const pop = popover(anchor, `
      <div class="menu">
        <button class="menu-item" data-p="end">${icon('pageplus', 18)}<span>Nieuwe pagina achteraan</span></button>
        <button class="menu-item" data-p="after">${icon('pageplus', 18)}<span>Pagina invoegen na ${i + 1}</span></button>
        <hr>
        <div class="menu-label">Papier van pagina ${i + 1}</div>
        <div class="paper-pick">${PAPERS.map(p => `<button class="paper-opt ${p.id === pg.paper ? 'on' : ''}" data-paper="${p.id}"><i class="pp pp-${p.id}"></i><span>${p.label}</span></button>`).join('')}</div>
        <label class="menu-check"><input type="checkbox" class="all-pages"> Op alle pagina's toepassen</label>
        <hr>
        <button class="menu-item" data-p="export">${icon('export', 18)}<span>Pagina delen als afbeelding</span></button>
        <button class="menu-item danger" data-p="del">${icon('trash', 18)}<span>Verwijder pagina ${i + 1}</span></button>
      </div>`, { align: 'right' });
    pop.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.paper) {
        const all = $('.all-pages', pop).checked;
        for (const p of all ? pages : [pg]) { p.paper = b.dataset.paper; styleEl(p); save(p); }
        if (all) nb.paper = b.dataset.paper;
        $$('.paper-opt', pop).forEach(o => o.classList.toggle('on', o === b));
        return;
      }
      closePopovers();
      if (b.dataset.p === 'end') addPage(pages.length);
      if (b.dataset.p === 'after') addPage(i + 1);
      if (b.dataset.p === 'del') deletePage(pg);
      if (b.dataset.p === 'export') exportPage(pg, i);
    });
  }
  async function exportPage(pg, i) {
    const c = document.createElement('canvas');
    const k = 2;
    c.width = PAGE_W * k;
    c.height = PAGE_H * k;
    const ctx = c.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawPaper(ctx, pg.paper);
    drawStrokes(ctx, pg.strokes);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    saveFile(blob, `${(nb.title || 'notitie').replace(/[\\/:*?"<>|]/g, '-')} - p${i + 1}.png`);
  }

  function moreMenu(anchor) {
    const row = (key, label, sub) => `<label class="menu-toggle"><span><b>${label}</b><small>${sub}</small></span><input type="checkbox" data-k="${key}" ${T[key] ? 'checked' : ''}><i class="switch"></i></label>`;
    const pop = popover(anchor, `<div class="menu wide">
      <div class="menu-label">Strak schrijven</div>
      <p class="menu-note">Strijkt trillende of hobbelige lijnen glad terwijl je schrijft</p>
      <div class="seg small smooth-pick">${SMOOTH_LEVELS.map(l => `<button class="pill ${T.smooth === l.v ? 'on' : ''}" data-sm="${l.v}">${l.label}</button>`).join('')}</div>
      <hr>
      ${row('fingerDraw', 'Tekenen met vinger', 'Uit = alleen de Pencil tekent, je vinger scrolt (palm rejection)')}
      ${row('scribble', 'Krassen om te gummen', 'Zigzag snel over inkt om het weg te halen')}
      ${row('hold', 'Vasthouden voor vormen', 'Pen stilhouden na een lijn of cirkel maakt hem strak. Cirkel om inkt + vasthouden = selecteren')}
      <hr><div class="menu-label">Gebaren</div>
      <p class="menu-note">Tik met 2 vingers = ongedaan maken · 3 vingers = opnieuw · knijp met 2 vingers = zoomen${board ? ' · sleep met 1 vinger = schuiven over het canvas' : ''}</p>
    </div>`, { align: 'right' });
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-sm]');
      if (!b) return;
      T.smooth = +b.dataset.sm;
      saveTools();
      $$('[data-sm]', pop).forEach(x => x.classList.toggle('on', x === b));
    });
    pop.addEventListener('change', e => {
      const k = e.target.dataset.k;
      if (!k) return;
      T[k] = e.target.checked;
      saveTools();
      updateToolbar();
    });
  }

  // ---------- Audio-opname ----------
  function updateRecUi() {
    const b = $('[data-a=rec]', ed);
    b.classList.toggle('recording', !!rec);
    b.innerHTML = rec ? `${icon('stop')}<span class="rec-time">${fmtDuration(performance.now() - rec.start)}</span>` : icon('mic');
    b.hidden = RUNTIME.sandbox; // een artifact krijgt geen microfoon
    const rb = $('[data-a=recs]', ed);
    rb.hidden = RUNTIME.sandbox || !recordings.length;
    $('.badge', rb).textContent = recordings.length > 1 ? recordings.length : '';
  }
  updateRecUi();
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Opnemen wordt hier niet ondersteund'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { toast('Geen toegang tot de microfoon — sta dit toe in Instellingen > Safari'); return; }
    if (player.open) player.audio.pause();
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(m => MediaRecorder.isTypeSupported?.(m)) || '';
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec = { id: uid('r'), mr, stream, chunks, start: performance.now(), mime: mr.mimeType || mime, created: Date.now() };
    mr.start(1000);
    recTimer = setInterval(updateRecUi, 500);
    updateRecUi();
    toast('Opname gestart — je aantekeningen worden gekoppeld aan het geluid');
  }
  function stopRecording() {
    if (!rec) return Promise.resolve();
    const r = rec;
    rec = null;
    clearInterval(recTimer);
    return new Promise(resolve => {
      r.mr.onstop = async () => {
        r.stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(r.chunks, { type: r.mime || 'audio/mp4' });
        const item = { id: r.id, notebookId, blob, mime: blob.type, duration: performance.now() - r.start, created: r.created, title: `Opname ${recordings.length + 1}` };
        await db.put('recordings', item);
        recordings.push(item);
        nb.hasAudio = true;
        saveSoon();
        updateRecUi();
        toast('Opname opgeslagen');
        resolve(item);
      };
      r.mr.stop();
    });
  }
  function recMenu(anchor) {
    const pop = popover(anchor, `<div class="menu wide">
      <div class="menu-label">Opnames bij deze notitie</div>
      ${recordings.map(r => `<div class="rec-row">
        <button class="menu-item" data-play="${r.id}">${icon('play', 18)}<span><b>${esc(r.title)}</b><small>${fmtDate(r.created)} · ${fmtDuration(r.duration)}</small></span></button>
        <button class="icon-btn small danger" data-del="${r.id}" aria-label="Verwijder">${icon('trash', 18)}</button>
      </div>`).join('')}
    </div>`, { align: 'right' });
    pop.addEventListener('click', async e => {
      const p = e.target.closest('[data-play]'), d = e.target.closest('[data-del]');
      if (p) { closePopovers(); openPlayer(recordings.find(r => r.id === p.dataset.play)); }
      if (d) {
        closePopovers();
        if (!await confirmDialog('Deze opname verwijderen? De inkt blijft staan.')) return;
        const i = recordings.findIndex(r => r.id === d.dataset.del);
        if (player.rec?.id === d.dataset.del) closePlayer();
        await db.del('recordings', d.dataset.del);
        recordings.splice(i, 1);
        nb.hasAudio = recordings.length > 0;
        saveSoon();
        updateRecUi();
      }
    });
  }

  // ---------- Terugluisteren (Notability-stijl) ----------
  const pl = $('.ed-player', ed);
  function recPages(id) { return pages.filter(p => p.strokes.some(s => s.r === id)); }
  function updateFade() {
    const was = fade;
    fade = player.open && player.rec ? { rec: player.rec.id, t: player.audio.ended ? Infinity : player.audio.currentTime * 1000 } : null;
    const pgs = recPages(player.rec?.id || was?.rec);
    pgs.forEach(renderSoon);
  }
  function openPlayer(r) {
    if (!r) return;
    if (player.url) URL.revokeObjectURL(player.url);
    player.rec = r;
    player.url = URL.createObjectURL(r.blob);
    player.audio.src = player.url;
    player.audio.playbackRate = player.speed;
    player.open = true;
    pl.hidden = false;
    $('.p-dur', pl).textContent = fmtDuration(r.duration);
    updateFade();
    player.audio.play().catch(() => {});
  }
  function closePlayer() {
    player.audio.pause();
    player.open = false;
    pl.hidden = true;
    const id = player.rec?.id;
    fade = null;
    if (id) recPages(id).forEach(renderSoon);
    player.rec = null;
  }
  let lastFadeAt = 0;
  player.audio.addEventListener('timeupdate', () => {
    const a = player.audio;
    const dur = isFinite(a.duration) ? a.duration * 1000 : player.rec?.duration || 1;
    $('.p-time', pl).textContent = fmtDuration(a.currentTime * 1000);
    $('.p-range', pl).value = Math.round(a.currentTime * 1000 / dur * 1000);
    if (performance.now() - lastFadeAt > 200) { lastFadeAt = performance.now(); updateFade(); }
  });
  const syncPlayBtn = () => { $('[data-a=p-play]', pl).innerHTML = icon(player.audio.paused ? 'play' : 'pause'); };
  player.audio.addEventListener('play', syncPlayBtn);
  player.audio.addEventListener('pause', syncPlayBtn);
  player.audio.addEventListener('ended', () => { syncPlayBtn(); updateFade(); });
  $('.p-range', pl).addEventListener('input', e => {
    const a = player.audio;
    const dur = isFinite(a.duration) ? a.duration : (player.rec?.duration || 0) / 1000;
    a.currentTime = e.target.value / 1000 * dur;
    updateFade();
  });
  pl.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const a = player.audio;
    if (b.dataset.a === 'p-play') a.paused ? a.play() : a.pause();
    if (b.dataset.a === 'p-back') { a.currentTime = Math.max(0, a.currentTime - 10); updateFade(); }
    if (b.dataset.a === 'p-fwd') { a.currentTime += 10; updateFade(); }
    if (b.dataset.a === 'p-close') closePlayer();
    if (b.dataset.a === 'p-speed') {
      player.speed = { 1: 1.5, 1.5: 2, 2: 0.75, 0.75: 1 }[player.speed];
      a.playbackRate = player.speed;
      b.textContent = player.speed + '×';
    }
  });
  // Tik op een lijn → spring naar het moment dat je hem schreef
  function seekAt(pg, x, y) {
    const hit = [...pg.strokes].reverse().find(s => s.r && strokeHit(s, x, y, 14 / zf()));
    if (!hit) return false;
    const r = recordings.find(rr => rr.id === hit.r);
    if (!r) return false;
    if (player.rec?.id !== r.id) openPlayer(r);
    player.audio.currentTime = Math.max(0, hit.t / 1000 - 1.5);
    player.audio.play().catch(() => {});
    updateFade();
    return true;
  }

  // ---------- Toetsenbord (handig met toetsenbord-hoes) ----------
  function onKey(e) {
    if (e.target.matches('input, textarea')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    const map = { p: 'pen', h: 'hl', e: 'eraser', l: 'lasso' };
    if (!mod && map[e.key]) setTool(map[e.key]);
    if (e.key === 'Escape') clearSelection();
    if ((e.key === 'Backspace' || e.key === 'Delete') && sel) selDelete();
  }
  document.addEventListener('keydown', onKey);

  // ---------- Afsluiten ----------
  let closed = false;
  async function teardown() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    io.disconnect();
    ro.disconnect();
    if (rec) await stopRecording();
    player.audio.pause();
    if (player.url) URL.revokeObjectURL(player.url);
    clearSelection();
    await saveSoon.flush();
    try { nb.thumb = board ? renderFit(pages[0].strokes, 240, 339, 0.08).toDataURL('image/jpeg', 0.75) : thumbnail(pages[0]); } catch {}
    if (board) nb.view = { ...view };
    nb.pageCount = pages.length;
    await db.put('notebooks', nb);
    for (const st of S.values()) if (st.canvas) st.canvas.width = st.canvas.height = 0;
  }
  async function exit() {
    await teardown();
    onExit?.();
  }
  return teardown;
}
