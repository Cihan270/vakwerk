// Inkt: lijnen tekenen, papier, hit-tests en vormherkenning.
// Coördinaten zijn in pagina-eenheden: een pagina is 1000 breed en 1414 hoog (A4).
// Een lijn (stroke) = { id, tool: 'pen'|'hl', c: kleur, w: dikte, p: [x,y,druk, x,y,druk, ...], b: [minX,minY,maxX,maxY], r?: opname-id, t?: ms in opname }

export const PAGE_W = 1000;
export const PAGE_H = 1414;
export const PAPERS = [
  { id: 'blank', label: 'Blanco' },
  { id: 'lined', label: 'Lijntjes' },
  { id: 'grid', label: 'Ruitjes' },
  { id: 'dots', label: 'Puntjes' },
  { id: 'cornell', label: 'Cornell' },
];
const LINE = 36, GRID = 32, TOP = 110, MARGIN = 90, CORNELL_X = 280, CORNELL_Y = 1160;

export function bbox(p) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1];
    if (x < a) a = x; if (x > c) c = x;
    if (y < b) b = y; if (y > d) d = y;
  }
  return [a, b, c, d];
}

const pf = pr => Math.min(1.5, Math.max(0.35, 0.3 + 1.25 * pr));

// ---------- Tekenen ----------
function drawPen(ctx, s) {
  const p = s.p, n = p.length / 3;
  ctx.strokeStyle = ctx.fillStyle = s.c;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], Math.max(0.6, s.w * pf(p[2]) / 1.6), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (n === 2) {
    ctx.lineWidth = s.w * pf((p[2] + p[5]) / 2);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[3], p[4]); ctx.stroke();
    return;
  }
  // Quadratische curves tussen middelpunten; nieuwe path alleen als de dikte merkbaar verandert.
  let x0 = p[0], y0 = p[1];
  let bucket = -1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let i = 1; i < n - 1; i++) {
    const xi = p[i * 3], yi = p[i * 3 + 1], xn = p[i * 3 + 3], yn = p[i * 3 + 4];
    const mx = (xi + xn) / 2, my = (yi + yn) / 2;
    const w = s.w * pf(p[i * 3 + 2]);
    const bk = Math.round(w * 6);
    if (bk !== bucket) {
      if (bucket !== -1) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(x0, y0); }
      bucket = bk;
      ctx.lineWidth = w;
    }
    ctx.quadraticCurveTo(xi, yi, mx, my);
    x0 = mx; y0 = my;
  }
  ctx.lineTo(p[p.length - 3], p[p.length - 2]);
  ctx.stroke();
}

function drawHighlighter(ctx, s) {
  const p = s.p, n = p.length / 3;
  ctx.save();
  ctx.globalAlpha *= 0.38;
  ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = s.c;
  ctx.lineWidth = s.w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (n === 1) ctx.lineTo(p[0] + 0.1, p[1]);
  for (let i = 1; i < n - 1; i++) {
    const xi = p[i * 3], yi = p[i * 3 + 1];
    ctx.quadraticCurveTo(xi, yi, (xi + p[i * 3 + 3]) / 2, (yi + p[i * 3 + 4]) / 2);
  }
  if (n > 1) ctx.lineTo(p[p.length - 3], p[p.length - 2]);
  ctx.stroke();
  ctx.restore();
}

export function drawStroke(ctx, s, alpha = 1) {
  ctx.globalAlpha = alpha;
  if (s.tool === 'hl') drawHighlighter(ctx, s); else drawPen(ctx, s);
  ctx.globalAlpha = 1;
}

// fade: { rec, t } → lijnen uit opname `rec` die na tijd `t` (ms) geschreven zijn worden vaag getekend
// cull: [x0,y0,x1,y1] → lijnen buiten dit gebied worden overgeslagen (canvas-modus)
export function drawStrokes(ctx, strokes, { fade, skip, cull } = {}) {
  const a = s => (fade && s.r === fade.rec && s.t > fade.t) ? 0.16 : 1;
  const vis = s => !skip?.has(s.id) && (!cull || !(s.b[2] + s.w < cull[0] || s.b[0] - s.w > cull[2] || s.b[3] + s.w < cull[1] || s.b[1] - s.w > cull[3]));
  for (const s of strokes) if (s.tool === 'hl' && vis(s)) drawStroke(ctx, s, a(s));
  for (const s of strokes) if (s.tool !== 'hl' && vis(s)) drawStroke(ctx, s, a(s));
}

// ---------- Papier ----------
export function paperCss(paper, scale) {
  const L = LINE * scale, G = GRID * scale, line = '#cfd9e8', dot = '#b7c0cd';
  const hLines = `repeating-linear-gradient(to bottom, transparent 0, transparent ${L - 1}px, ${line} ${L - 1}px, ${line} ${L}px)`;
  switch (paper) {
    case 'lined':
      return {
        backgroundImage: `linear-gradient(90deg, transparent ${MARGIN * scale}px, #f2c4c4 ${MARGIN * scale}px, #f2c4c4 ${MARGIN * scale + 1}px, transparent ${MARGIN * scale + 1}px), ${hLines}`,
        backgroundPosition: `0 0, 0 ${TOP * scale}px`, backgroundSize: '100% 100%, 100% ' + L + 'px', backgroundRepeat: 'no-repeat, repeat-y',
      };
    case 'grid':
      return {
        backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${G - 1}px, #dde4ee ${G - 1}px, #dde4ee ${G}px), repeating-linear-gradient(to bottom, transparent 0, transparent ${G - 1}px, #dde4ee ${G - 1}px, #dde4ee ${G}px)`,
        backgroundPosition: '0 0, 0 0', backgroundSize: 'auto', backgroundRepeat: 'repeat',
      };
    case 'dots':
      return {
        backgroundImage: `radial-gradient(circle, ${dot} ${Math.max(0.8, 1.6 * scale)}px, transparent ${Math.max(1.2, 2.2 * scale)}px)`,
        backgroundPosition: `${G / 2}px ${G / 2}px`, backgroundSize: `${G}px ${G}px`, backgroundRepeat: 'repeat',
      };
    case 'cornell':
      return {
        backgroundImage: `linear-gradient(90deg, transparent ${CORNELL_X * scale}px, #e7a9a9 ${CORNELL_X * scale}px, #e7a9a9 ${CORNELL_X * scale + 1.5}px, transparent ${CORNELL_X * scale + 1.5}px), linear-gradient(to bottom, transparent ${CORNELL_Y * scale}px, #e7a9a9 ${CORNELL_Y * scale}px, #e7a9a9 ${CORNELL_Y * scale + 1.5}px, transparent ${CORNELL_Y * scale + 1.5}px), ${hLines}`,
        backgroundPosition: `0 0, 0 0, 0 ${TOP * scale}px`, backgroundSize: `100% ${CORNELL_Y * scale}px, 100% 100%, 100% ${L}px`, backgroundRepeat: 'no-repeat, no-repeat, repeat-y',
      };
    default:
      return { backgroundImage: 'none', backgroundPosition: '', backgroundSize: '', backgroundRepeat: '' };
  }
}

// ---------- Oneindig canvas (Freeform-stijl) ----------
export const BOARD_PAPERS = PAPERS.filter(p => p.id !== 'cornell');

// Achtergrond die meeschuift en meeschaalt met de weergave { x, y, z }.
// Bij ver uitzoomen worden de lijnen 4× zo ruim, zodat het niet één grijze vlek wordt.
export function boardBg(paper, view) {
  if (!paper || paper === 'blank') return { backgroundImage: 'none', backgroundPosition: '', backgroundSize: '', backgroundRepeat: '' };
  let S = (paper === 'lined' ? LINE : GRID) * view.z;
  while (S < 12) S *= 4;
  const ox = ((-view.x * view.z) % S + S) % S, oy = ((-view.y * view.z) % S + S) % S;
  const line = '#d5dde9';
  if (paper === 'lined') return {
    backgroundImage: `linear-gradient(to bottom, transparent ${S - 1}px, ${line} ${S - 1}px)`,
    backgroundSize: `100% ${S}px`, backgroundPosition: `0 ${oy}px`, backgroundRepeat: 'repeat',
  };
  if (paper === 'grid') return {
    backgroundImage: `linear-gradient(to right, transparent ${S - 1}px, #e1e7ef ${S - 1}px), linear-gradient(to bottom, transparent ${S - 1}px, #e1e7ef ${S - 1}px)`,
    backgroundSize: `${S}px ${S}px`, backgroundPosition: `${ox}px ${oy}px`, backgroundRepeat: 'repeat',
  };
  return {
    backgroundImage: 'radial-gradient(circle, #b7c0cd 1.3px, transparent 1.8px)',
    backgroundSize: `${S}px ${S}px`, backgroundPosition: `${ox - S / 2}px ${oy - S / 2}px`, backgroundRepeat: 'repeat',
  };
}

export function contentBounds(strokes) {
  return strokes.length ? unionBox(strokes) : null;
}

// Tekent alle inkt passend in een vak van w×h pixels (thumbnail / export van een canvas)
export function renderFit(strokes, w, h, pad = 0.06, bg = '#fff') {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const b = contentBounds(strokes);
  if (!b) return c;
  const bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
  const k = Math.min(w * (1 - 2 * pad) / bw, h * (1 - 2 * pad) / bh, 2.5);
  ctx.setTransform(k, 0, 0, k, (w - bw * k) / 2 - b[0] * k, (h - bh * k) / 2 - b[1] * k);
  drawStrokes(ctx, strokes);
  return c;
}

// Papier tekenen op canvas (voor thumbnails), in pagina-eenheden
export function drawPaper(ctx, paper) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.lineWidth = 2;
  if (paper === 'lined' || paper === 'cornell') {
    ctx.strokeStyle = '#cfd9e8';
    for (let y = TOP + LINE; y < PAGE_H; y += LINE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke(); }
    ctx.strokeStyle = paper === 'cornell' ? '#e7a9a9' : '#f2c4c4';
    const x = paper === 'cornell' ? CORNELL_X : MARGIN;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, paper === 'cornell' ? CORNELL_Y : PAGE_H); ctx.stroke();
    if (paper === 'cornell') { ctx.beginPath(); ctx.moveTo(0, CORNELL_Y); ctx.lineTo(PAGE_W, CORNELL_Y); ctx.stroke(); }
  } else if (paper === 'grid') {
    ctx.strokeStyle = '#dde4ee';
    for (let x = GRID; x < PAGE_W; x += GRID) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PAGE_H); ctx.stroke(); }
    for (let y = GRID; y < PAGE_H; y += GRID) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke(); }
  } else if (paper === 'dots') {
    ctx.fillStyle = '#b7c0cd';
    for (let x = GRID / 2; x < PAGE_W; x += GRID) for (let y = GRID / 2; y < PAGE_H; y += GRID) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
}

export function thumbnail(page, width = 240) {
  const c = document.createElement('canvas');
  const k = width / PAGE_W;
  c.width = width;
  c.height = Math.round(PAGE_H * k);
  const ctx = c.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawPaper(ctx, page.paper);
  drawStrokes(ctx, page.strokes || []);
  return c.toDataURL('image/jpeg', 0.75);
}

// ---------- Geometrie ----------
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return x * x + y * y;
}

export function strokeHit(s, x, y, r) {
  const rr = r + s.w / 2;
  const b = s.b;
  if (x < b[0] - rr || x > b[2] + rr || y < b[1] - rr || y > b[3] + rr) return false;
  const p = s.p, n = p.length / 3, r2 = rr * rr;
  if (n === 1) return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= r2;
  for (let i = 0; i < n - 1; i++) if (segDist2(x, y, p[i * 3], p[i * 3 + 1], p[i * 3 + 3], p[i * 3 + 4]) <= r2) return true;
  return false;
}

// Precies gummen: haalt punten weg rond (x,y) en splitst de lijn. Geeft null als er niets geraakt is.
export function eraseFromStroke(s, x, y, r, makeId) {
  if (!strokeHit(s, x, y, r)) return null;
  const rr = (r + s.w / 2) ** 2, p = s.p, pieces = [];
  let cur = [];
  for (let i = 0; i < p.length; i += 3) {
    if ((p[i] - x) ** 2 + (p[i + 1] - y) ** 2 <= rr) { if (cur.length) pieces.push(cur); cur = []; }
    else cur.push(p[i], p[i + 1], p[i + 2]);
  }
  if (cur.length) pieces.push(cur);
  if (pieces.length === 1 && pieces[0].length === p.length) return null;
  return pieces.map(pp => ({ ...s, id: makeId(), p: pp, b: bbox(pp) }));
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Lijnen die (grotendeels) binnen een lasso-polygoon vallen
export function strokesInPoly(strokes, poly, minFrac = 0.5) {
  const pb = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < poly.length; i += 2) {
    pb[0] = Math.min(pb[0], poly[i]); pb[1] = Math.min(pb[1], poly[i + 1]);
    pb[2] = Math.max(pb[2], poly[i]); pb[3] = Math.max(pb[3], poly[i + 1]);
  }
  return strokes.filter(s => {
    if (s.b[2] < pb[0] || s.b[0] > pb[2] || s.b[3] < pb[1] || s.b[1] > pb[3]) return false;
    let inn = 0, tot = 0;
    for (let i = 0; i < s.p.length; i += 3) { tot++; if (pointInPoly(s.p[i], s.p[i + 1], poly)) inn++; }
    return inn / tot >= minFrac;
  });
}

export function translateStroke(s, dx, dy, id) {
  const p = s.p.slice();
  for (let i = 0; i < p.length; i += 3) { p[i] += dx; p[i + 1] += dy; }
  return { ...s, id, p, b: [s.b[0] + dx, s.b[1] + dy, s.b[2] + dx, s.b[3] + dy] };
}

export function unionBox(strokes) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of strokes) {
    const h = s.w / 2;
    b[0] = Math.min(b[0], s.b[0] - h); b[1] = Math.min(b[1], s.b[1] - h);
    b[2] = Math.max(b[2], s.b[2] + h); b[3] = Math.max(b[3], s.b[3] + h);
  }
  return b;
}

function pathLength(p) {
  let L = 0;
  for (let i = 3; i < p.length; i += 3) L += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2]);
  return L;
}

// "Strak schrijven": strijkt trillingen glad (meerdere passes van een klein gemiddelde-filter).
// Begin- en eindpunt blijven staan zodat letters op hun plek blijven.
export const SMOOTH_LEVELS = [{ v: 0, label: 'Uit' }, { v: 1, label: 'Licht' }, { v: 2, label: 'Middel' }, { v: 3, label: 'Sterk' }];
export function smoothPoints(p, level) {
  const passes = [0, 3, 8, 18][level] || 0;
  const n = p.length / 3;
  if (!passes || n < 4) return p;
  let a = p.slice();
  for (let k = 0; k < passes; k++) {
    const b = a.slice();
    for (let i = 1; i < n - 1; i++) {
      const j = i * 3;
      b[j] = a[j - 3] * 0.25 + a[j] * 0.5 + a[j + 3] * 0.25;
      b[j + 1] = a[j - 2] * 0.25 + a[j + 1] * 0.5 + a[j + 4] * 0.25;
      if (k < 4) b[j + 2] = a[j - 1] * 0.25 + a[j + 2] * 0.5 + a[j + 5] * 0.25;
    }
    a = b;
  }
  for (let i = 0; i < a.length; i++) a[i] = Math.round(a[i] * (i % 3 === 2 ? 100 : 10)) / (i % 3 === 2 ? 100 : 10);
  return a;
}

// ---------- Gebaren ----------
// "Krassen om te gummen": snel heen-en-weer zigzaggen over bestaande inkt
export function isScribble(p) {
  const n = p.length / 3;
  if (n < 14) return false;
  const [x0, y0, x1, y1] = bbox(p);
  const w = x1 - x0, h = y1 - y0;
  const ax = w >= h ? 0 : 1;
  const extent = Math.max(w, h);
  if (extent < 25) return false;
  const thr = Math.max(8, extent * 0.35);
  let dir = 0, rev = 0, hi = p[ax], lo = p[ax];
  for (let i = 3; i < p.length; i += 3) {
    const v = p[i + ax];
    if (dir === 0) {
      if (v - lo > thr) { dir = 1; hi = v; }
      else if (hi - v > thr) { dir = -1; lo = v; }
      else { hi = Math.max(hi, v); lo = Math.min(lo, v); }
    } else if (dir === 1) {
      if (v > hi) hi = v;
      else if (hi - v > thr) { rev++; dir = -1; lo = v; }
    } else {
      if (v < lo) lo = v;
      else if (v - lo > thr) { rev++; dir = 1; hi = v; }
    }
  }
  return rev >= 4 && pathLength(p) > extent * 4;
}

// Welke lijnen dekt de kras af?
export function scribbleTargets(strokes, p) {
  const b = bbox(p), pad = 6;
  return strokes.filter(s => {
    if (s.b[2] < b[0] - pad || s.b[0] > b[2] + pad || s.b[3] < b[1] - pad || s.b[1] > b[3] + pad) return false;
    let inn = 0, tot = 0;
    for (let i = 0; i < s.p.length; i += 3) {
      tot++;
      if (s.p[i] >= b[0] - pad && s.p[i] <= b[2] + pad && s.p[i + 1] >= b[1] - pad && s.p[i + 1] <= b[3] + pad) inn++;
    }
    return inn / tot >= 0.6;
  });
}

function polyArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 3; i < p.length; j = i, i += 3) a += (p[j] + p[i]) * (p[j + 1] - p[i + 1]);
  return Math.abs(a / 2);
}

// "Vasthouden = vorm": na een lijn even stilhouden maakt er een rechte lijn, cirkel of rechthoek van
export function recognize(p) {
  const n = p.length / 3;
  if (n < 4) return null;
  const [x0, y0, x1, y1] = bbox(p);
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag < 20) return null;
  const L = pathLength(p);
  const sx = p[0], sy = p[1], ex = p[p.length - 3], ey = p[p.length - 2];
  const gap = Math.hypot(ex - sx, ey - sy);
  if (gap < Math.max(30, diag * 0.28) && L > diag * 1.8) {
    const ratio = polyArea(p) / ((x1 - x0) * (y1 - y0) || 1);
    return { type: ratio > 0.86 ? 'rect' : 'ellipse', box: [x0, y0, x1, y1], poly: p.filter((_, i) => i % 3 !== 2) };
  }
  if (gap / L > 0.82) return { type: 'line', from: [sx, sy], to: [ex, ey] };
  return null;
}

export function shapePoints(shape, pressure = 0.5) {
  const out = [];
  const push = (x, y) => out.push(+x.toFixed(1), +y.toFixed(1), pressure);
  if (shape.type === 'line') {
    const [a, b] = [shape.from, shape.to];
    for (let i = 0; i <= 24; i++) push(a[0] + (b[0] - a[0]) * i / 24, a[1] + (b[1] - a[1]) * i / 24);
  } else if (shape.type === 'ellipse') {
    const [x0, y0, x1, y1] = shape.box;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    for (let i = 0; i <= 72; i++) { const a = i / 72 * Math.PI * 2 - Math.PI / 2; push(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
  } else if (shape.type === 'rect') {
    const [x0, y0, x1, y1] = shape.box;
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    for (let k = 0; k < 4; k++) for (let i = 0; i < 12; i++) {
      const [a, b] = [pts[k], pts[k + 1]];
      push(a[0] + (b[0] - a[0]) * i / 12, a[1] + (b[1] - a[1]) * i / 12);
    }
    push(x0, y0);
  }
  return out;
}
