// Slides (PDF) importeren: elke PDF-pagina wordt een afbeelding op een eigen notitiepagina.
// Liggende slides staan bovenaan met lijntjes eronder om aantekeningen te maken; staande pagina's vullen de hele pagina.
// pdf.js wordt alleen bij het importeren geladen (internet nodig); daarna staat alles als afbeelding op de iPad.
import { db } from './db.js';
import { uid, toast, esc } from './util.js';
import { PAGE_W, PAGE_H, drawPaper } from './ink.js';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const RENDER_W = 1800; // pixels breed per slide: scherp genoeg om op in te zoomen, klein genoeg voor de iPad

let libP = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  libP ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS + 'pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; resolve(window.pdfjsLib); };
    s.onerror = () => { libP = null; s.remove(); reject(new Error('pdf.js niet geladen')); };
    document.head.append(s);
  });
  return libP;
}

function progress(title) {
  const el = document.createElement('div');
  el.className = 'import-progress';
  el.innerHTML = `<div class="ip-card"><b>${esc(title)}</b><span class="ip-txt">PDF openen…</span><div class="ip-bar"><i></i></div></div>`;
  document.body.append(el);
  return {
    set(i, n) { el.querySelector('.ip-txt').textContent = `Slide ${i} van ${n}`; el.querySelector('.ip-bar i').style.width = `${i / n * 100}%`; },
    done() { el.remove(); },
  };
}

export async function importPdf(subjectId, file) {
  const title = file.name.replace(/\.pdf$/i, '').trim() || 'Slides';
  const prog = progress(title);
  try {
    let lib;
    try { lib = await loadPdfJs(); } catch { toast('Voor het importeren van slides is internet nodig'); return null; }
    let pdf;
    try { pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; }
    catch { toast('Dit PDF-bestand kan ik niet openen'); return null; }

    const now = Date.now();
    const nb = { id: uid('n'), subjectId, kind: 'note', layout: 'pages', paper: 'lined', source: 'pdf', title, created: now, updated: now, pageCount: pdf.numPages };
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      prog.set(i, pdf.numPages);
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(RENDER_W / base.width, 2400 / base.height) });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
      const asset = { id: uid('a'), notebookId: nb.id, blob, w: c.width, h: c.height, created: now };
      await db.put('assets', asset);

      const ratio = c.height / c.width;
      let box;
      if (ratio < 1) box = { x: 0, y: 0, w: PAGE_W, h: Math.round(PAGE_W * ratio) };
      else {
        const k = Math.min(PAGE_W / c.width, PAGE_H / c.height), w = c.width * k, h = c.height * k;
        box = { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, w, h };
      }
      const pg = { id: uid('p'), notebookId: nb.id, index: i - 1, paper: ratio < 1 ? 'lined' : 'blank', strokes: [], images: [{ id: uid('i'), asset: asset.id, lock: true, ...box }] };
      pages.push(pg);
      if (i === 1) {
        const t = document.createElement('canvas'), k = 240 / PAGE_W;
        t.width = 240; t.height = Math.round(PAGE_H * k);
        const tc = t.getContext('2d');
        tc.setTransform(k, 0, 0, k, 0, 0);
        drawPaper(tc, pg.paper);
        tc.drawImage(c, box.x, box.y, box.w, box.h);
        nb.thumb = t.toDataURL('image/jpeg', 0.75);
      }
      c.width = c.height = 0;
      page.cleanup();
    }
    await db.putMany('pages', pages);
    await db.put('notebooks', nb);
    pdf.destroy();
    toast(`${pages.length} slide${pages.length === 1 ? '' : 's'} geïmporteerd — schrijf er met je Pencil op`);
    return nb;
  } finally {
    prog.done();
  }
}
