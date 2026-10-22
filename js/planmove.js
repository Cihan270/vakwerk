// Planning: een blok ingedrukt houden = selecteren. Daarna slepen naar een andere dag/dagdeel, op een dagdeel tikken
// om hem daarheen te zetten, of verwijderen. Alles met 'ongedaan maken' in plaats van een bevestigingsvraag.
import { db } from './db.js';
import { toast, isoDay, fmtDate } from './util.js';

const HOLD_MS = 450; // zo lang ingedrukt houden
const SLOP = 10;     // zoveel pixels bewegen tijdens het vasthouden = je wilt scrollen
const EDGE = 90;     // zo dicht bij de rand scrolt de lijst mee tijdens het slepen

export function enablePlanMove(root, { onChange, slots }) {
  root._planMove?.(); // opnieuw getekend: oude luisteraars eerst weg
  let timer = null, press = null, drag = null, sel = null, suppressClick = false, raf = 0;

  const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest('.pcell');
  const clearOver = () => root.querySelectorAll('.pcell.drop-over').forEach(c => c.classList.remove('drop-over'));
  const markOver = c => { clearOver(); if (c) c.classList.add('drop-over'); if (drag) drag.over = c; };

  function select(el) {
    unselect();
    sel = el;
    el.classList.add('selected');
    document.body.classList.add('plan-moving');
    const bar = document.createElement('div');
    bar.className = 'move-bar';
    bar.innerHTML = `<span>Sleep het blok, of tik op een dagdeel</span>
      <button class="btn small danger" data-mv="del">Verwijder</button><button class="btn small primary" data-mv="done">Klaar</button>`;
    bar.onclick = e => {
      const a = e.target.closest('[data-mv]')?.dataset.mv;
      if (a === 'del') remove();
      if (a === 'done') unselect();
    };
    document.body.append(bar);
  }
  function unselect() {
    sel?.classList.remove('selected');
    sel = null;
    document.body.classList.remove('plan-moving');
    document.querySelectorAll('.move-bar').forEach(b => b.remove());
    clearOver();
  }

  // Oude 'ongedaan maken'-meldingen weg: die zouden een verouderde toestand terugzetten
  const clearToasts = () => document.querySelectorAll('#toasts .toast').forEach(t => t.remove());

  async function move(id, date, slot) {
    const p = await db.get('plan', id);
    unselect();
    if (!p || (p.date === date && p.slot === slot)) return;
    const before = { ...p };
    const moved = { ...p, date, slot, pinned: true }; // pinned: een nieuwe import laat deze plek staan
    delete moved.movedFrom; // zelf verplaatst = bewust gepland, telt niet als 'achter'
    if (date < isoDay()) moved.keep = true; else delete moved.keep; // naar het verleden: niet automatisch terugschuiven
    await db.put('plan', moved);
    onChange();
    clearToasts();
    toast(`Verplaatst naar ${fmtDate(date)} · ${slots[slot].toLowerCase()}`, { action: 'Ongedaan', onAction: async () => { await db.put('plan', before); onChange(); } });
  }
  async function remove() {
    const id = sel?.dataset.pid;
    if (!id) return;
    const p = await db.get('plan', id);
    unselect();
    await db.del('plan', id);
    onChange();
    clearToasts();
    toast('Blok verwijderd', { action: 'Ongedaan', onAction: async () => { await db.put('plan', p); onChange(); } });
  }

  function autoScroll() {
    if (!drag?.ghost || !drag.vy) { raf = 0; return; }
    scrollBy(0, drag.vy);
    markOver(cellAt(drag.x, drag.y));
    raf = requestAnimationFrame(autoScroll);
  }

  const onDown = e => {
    const blk = e.target.closest('.pblk[data-pid]');
    if (!blk || e.button > 0 || e.target.closest('[data-pdone], [data-pset], [data-shiftday]')) return;
    press = { x: e.clientX, y: e.clientY, blk };
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!press) return;
      select(blk);
      suppressClick = true; // het loslaten na ingedrukt houden opent geen bewerkvenster
      navigator.vibrate?.(15);
      const r = blk.getBoundingClientRect();
      drag = { blk, dx: press.x - r.left, dy: press.y - r.top, w: r.width, x: press.x, y: press.y, ghost: null, over: null, vy: 0 };
    }, HOLD_MS);
  };
  const onMove = e => {
    if (!press) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) { clearTimeout(timer); press = null; }
      return;
    }
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
      const g = drag.blk.cloneNode(true);
      g.classList.add('plan-ghost');
      g.style.width = drag.w + 'px';
      document.body.append(g);
      drag.ghost = g;
      drag.blk.classList.add('dragging');
    }
    drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px)`;
    markOver(cellAt(e.clientX, e.clientY));
    const y = e.clientY;
    drag.vy = y < EDGE ? -Math.ceil((EDGE - y) / 6) : y > innerHeight - EDGE ? Math.ceil((y - innerHeight + EDGE) / 6) : 0;
    if (drag.vy && !raf) raf = requestAnimationFrame(autoScroll);
  };
  const onUp = () => {
    clearTimeout(timer);
    if (drag?.ghost) {
      const { ghost, over, blk } = drag;
      ghost.remove();
      blk.classList.remove('dragging');
      drag = null;
      if (over) move(blk.dataset.pid, over.dataset.date, +over.dataset.slot);
      else clearOver(); // ernaast losgelaten: blijft geselecteerd
    }
    drag = null;
    press = null;
    if (suppressClick) setTimeout(() => { suppressClick = false; }, 350);
  };
  // Geselecteerd: tik op een dagdeel = daarheen; tik ergens anders = selectie weg
  const onClick = e => {
    if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); return; }
    if (!sel) return;
    e.stopPropagation();
    e.preventDefault();
    const c = e.target.closest('.pcell');
    if (c && !e.target.closest('.pblk.selected')) move(sel.dataset.pid, c.dataset.date, +c.dataset.slot);
    else unselect();
  };
  const onTouchMove = e => { if (drag) e.preventDefault(); }; // tijdens het slepen niet scrollen (iPad)
  const onMenu = e => { if (e.target.closest('.pblk[data-pid]')) e.preventDefault(); };
  const onKey = e => { if (sel && e.key === 'Escape') unselect(); if (sel && (e.key === 'Delete' || e.key === 'Backspace')) remove(); };

  root.addEventListener('pointerdown', onDown);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
  root.addEventListener('click', onClick, true);
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  root.addEventListener('contextmenu', onMenu);
  document.addEventListener('keydown', onKey);
  const cleanup = () => {
    clearTimeout(timer);
    unselect();
    drag?.ghost?.remove();
    root.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    root.removeEventListener('click', onClick, true);
    root.removeEventListener('touchmove', onTouchMove);
    root.removeEventListener('contextmenu', onMenu);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', cleanup);
    root._planMove = null;
  };
  window.addEventListener('hashchange', cleanup); // weg uit de planning: opruimen
  root._planMove = cleanup;
}
