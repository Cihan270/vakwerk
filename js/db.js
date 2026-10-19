// Opslag. Op de iPad (GitHub-versie): lokaal in IndexedDB. Als claude.ai-artifact: in de database van
// het artifact, zodat alles tussen je apparaten synchroniseert en Claude er direct in kan schrijven.

const DB_NAME = 'vakwerk';
const VERSION = 3; // v2: studieplanning, v3: afbeeldingen en slides
const STORES = {
  subjects: [],
  slots: ['subjectId'],
  notebooks: ['subjectId'],
  pages: ['notebookId'],
  recordings: ['notebookId'],
  assets: ['notebookId'], // afbeeldingen en slides (blob) bij een notitie
  summaries: ['subjectId'],
  assignments: ['subjectId'],
  cards: ['subjectId'],
  plan: ['subjectId', 'date'], // studieblokken, colleges en tentamens per dag
  meta: [],
};
export const STORE_NAMES = Object.keys(STORES);

// sandbox: draait in de claude.ai-viewer (geen microfoon, geen service worker)
// artifact: gebruikt de artifact-database
export const RUNTIME = { sandbox: typeof window !== 'undefined' && typeof window.claude?.use === 'function', artifact: false };

// ---------- IndexedDB ----------
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [name, indexes] of Object.entries(STORES)) {
        if (d.objectStoreNames.contains(name)) continue;
        const s = d.createObjectStore(name, { keyPath: 'id' });
        indexes.forEach(ix => s.createIndex(ix, ix));
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
async function run(stores, mode, fn) {
  const d = await open();
  const t = d.transaction(stores, mode);
  fn(t);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}
const idb = {
  async get(store, id) { const d = await open(); return wrap(d.transaction(store).objectStore(store).get(id)); },
  async all(store) { const d = await open(); return wrap(d.transaction(store).objectStore(store).getAll()); },
  async by(store, index, value) { const d = await open(); return wrap(d.transaction(store).objectStore(store).index(index).getAll(value)); },
  put(store, obj) { return run([store], 'readwrite', t => { t.objectStore(store).put(obj); }).then(() => obj); },
  putMany(store, arr) { return run([store], 'readwrite', t => { const s = t.objectStore(store); arr.forEach(o => s.put(o)); }); },
  del(store, id) { return run([store], 'readwrite', t => { t.objectStore(store).delete(id); }); },
  delMany(store, ids) { return run([store], 'readwrite', t => { const s = t.objectStore(store); ids.forEach(id => s.delete(id)); }); },
  clear(store) { return run([store], 'readwrite', t => { t.objectStore(store).clear(); }); },
};

// ---------- Artifact-database ----------
// Elk object is een document `<store>/<id>`. Inkt van een pagina gaat in stukken (`inkchunks/<pagina>~<n>`),
// omdat één document hooguit 256 KiB mag zijn. Opnames (audio) kan een artifact niet maken, die store blijft leeg.
const CHUNK_BYTES = 180_000;
const BLOB_STORES = new Set(['recordings', 'assets']);
const clean = o => JSON.parse(JSON.stringify(o));
async function pool(items, fn, n = 6) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
// De database begrenst hoeveel je tegelijk/per seconde schrijft: bij 'druk' rustig opnieuw proberen (tot ~30 s)
async function retry(fn) {
  for (let a = 0; ; a++) {
    try { return await fn(); }
    catch (e) {
      if (a >= 6 || !['unavailable', 'resource_exhausted'].includes(e?.code)) { console.warn('db', e?.code, e?.message); throw e; }
      await new Promise(r => setTimeout(r, 500 * 2 ** a + Math.random() * 400));
    }
  }
}

function artifactBackend(store) {
  const written = new Map(); // laatst geschreven inhoud per inkt-stuk → ongewijzigde stukken overslaan
  const meta = new Map();    // instellingen worden vaak gelezen: per sessie onthouden
  const list = async (coll, where) => {
    let q = store.collection(coll);
    if (where) q = q.where(where[0], '==', where[1]);
    const snap = await retry(() => q.limit(1000).get());
    return snap.docs.map(d => ({ ...d.data() }));
  };
  const hydrate = async page => {
    if (!page) return page;
    if (!page.chunks) return { ...page, strokes: page.strokes || [] };
    const cs = (await list('inkchunks', ['pageId', page.id])).sort((a, b) => a.k - b.k);
    cs.forEach(c => written.set(`${page.id}~${c.k}`, JSON.stringify(c.strokes)));
    const { chunks, ...rest } = page;
    return { ...rest, strokes: cs.flatMap(c => c.strokes) };
  };
  async function putPage(p) {
    const { strokes = [], ...rest } = clean(p);
    const groups = [];
    let cur = [], size = 0;
    for (const s of strokes) {
      const len = JSON.stringify(s).length;
      if (cur.length && size + len > CHUNK_BYTES) { groups.push(cur); cur = []; size = 0; }
      cur.push(s); size += len;
    }
    if (cur.length) groups.push(cur);
    await pool(groups.map((g, k) => [g, k]), async ([g, k]) => {
      const key = `${p.id}~${k}`, json = JSON.stringify(g);
      if (written.get(key) === json) return;
      await retry(() => store.collection('inkchunks').doc(key).set({ pageId: p.id, k, strokes: g }));
      written.set(key, json);
    }, 2);
    const prev = await retry(() => store.collection('pages').doc(p.id).get());
    const oldCount = prev.exists ? (prev.data().chunks || 0) : 0;
    await retry(() => store.collection('pages').doc(p.id).set({ ...rest, chunks: groups.length }));
    for (let k = groups.length; k < oldCount; k++) {
      await retry(() => store.collection('inkchunks').doc(`${p.id}~${k}`).delete());
      written.delete(`${p.id}~${k}`);
    }
  }
  async function delPage(id) {
    const prev = await retry(() => store.collection('pages').doc(id).get());
    const n = prev.exists ? (prev.data().chunks || 0) : 0;
    for (let k = 0; k < n; k++) { await retry(() => store.collection('inkchunks').doc(`${id}~${k}`).delete()); written.delete(`${id}~${k}`); }
    await retry(() => store.collection('pages').doc(id).delete());
  }
  const api = {
    async get(s, id) {
      if (BLOB_STORES.has(s)) return undefined;
      if (s === 'meta' && meta.has(id)) return meta.get(id);
      const snap = await retry(() => store.collection(s).doc(id).get());
      let v = snap.exists ? { ...snap.data() } : undefined;
      if (s === 'pages') v = await hydrate(v);
      if (s === 'meta') meta.set(id, v);
      return v;
    },
    async all(s) {
      if (BLOB_STORES.has(s)) return [];
      const rows = await list(s);
      return s === 'pages' ? Promise.all(rows.map(hydrate)) : rows;
    },
    async by(s, index, value) {
      if (BLOB_STORES.has(s)) return [];
      const rows = await list(s, [index, value]);
      return s === 'pages' ? Promise.all(rows.map(hydrate)) : rows;
    },
    async put(s, obj) {
      if (BLOB_STORES.has(s)) return obj;
      if (s === 'pages') { await putPage(obj); return obj; }
      await retry(() => store.collection(s).doc(obj.id).set(clean(obj)));
      if (s === 'meta') meta.set(obj.id, clean(obj));
      return obj;
    },
    async putMany(s, arr) { await pool(arr, o => api.put(s, o), 2); },
    async del(s, id) {
      if (BLOB_STORES.has(s)) return;
      if (s === 'pages') return delPage(id);
      await retry(() => store.collection(s).doc(id).delete());
      if (s === 'meta') meta.delete(id);
    },
    async delMany(s, ids) { await pool(ids, id => api.del(s, id), 2); },
    async clear(s) {
      if (BLOB_STORES.has(s)) return;
      const rows = await list(s);
      await pool(rows.map(r => r.id), id => api.del(s, id), 2);
    },
    raw: store,
  };
  return api;
}

// ---------- Keuze van de opslag ----------
let backendP;
function backend() {
  if (backendP) return backendP;
  backendP = (async () => {
    if (RUNTIME.sandbox) {
      try {
        const store = await Promise.race([window.claude.use('db'), new Promise(r => setTimeout(() => r(null), 12000))]);
        if (store) { RUNTIME.artifact = true; return artifactBackend(store); }
      } catch {}
    }
    return idb;
  })();
  return backendP;
}
export const ready = () => backend();
export async function rawStore() { const b = await backend(); return b.raw || null; }

export const db = Object.fromEntries(['get', 'all', 'by', 'put', 'putMany', 'del', 'delMany', 'clear']
  .map(m => [m, async (...a) => (await backend())[m](...a)]));

export async function getSetting(key, def) {
  const r = await db.get('meta', key);
  return r ? r.value : def;
}
export function setSetting(key, value) { return db.put('meta', { id: key, value }); }

// Verwijdert een notitieboek inclusief pagina's en opnames
export async function deleteNotebook(id) {
  const [pages, recs, assets] = await Promise.all([db.by('pages', 'notebookId', id), db.by('recordings', 'notebookId', id), db.by('assets', 'notebookId', id)]);
  await db.delMany('pages', pages.map(p => p.id));
  await db.delMany('recordings', recs.map(r => r.id));
  await db.delMany('assets', assets.map(a => a.id));
  await db.del('notebooks', id);
}

// Verwijdert een vak met alles wat erbij hoort
export async function deleteSubject(id) {
  const notebooks = await db.by('notebooks', 'subjectId', id);
  for (const n of notebooks) await deleteNotebook(n.id);
  for (const store of ['slots', 'summaries', 'assignments', 'cards', 'plan']) {
    const items = await db.by(store, 'subjectId', id);
    await db.delMany(store, items.map(i => i.id));
  }
  await db.del('subjects', id);
}

export async function requestPersistence() {
  if (RUNTIME.sandbox) return false;
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
