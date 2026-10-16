// Alle data staat lokaal in IndexedDB op de iPad.

const DB_NAME = 'vakwerk';
const VERSION = 1;
const STORES = {
  subjects: [],
  slots: ['subjectId'],
  notebooks: ['subjectId'],
  pages: ['notebookId'],
  recordings: ['notebookId'],
  summaries: ['subjectId'],
  assignments: ['subjectId'],
  cards: ['subjectId'],
  meta: [],
};
export const STORE_NAMES = Object.keys(STORES);

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
  const out = fn(t);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  return out instanceof Promise ? out : out;
}

export const db = {
  async get(store, id) { const d = await open(); return wrap(d.transaction(store).objectStore(store).get(id)); },
  async all(store) { const d = await open(); return wrap(d.transaction(store).objectStore(store).getAll()); },
  async by(store, index, value) { const d = await open(); return wrap(d.transaction(store).objectStore(store).index(index).getAll(value)); },
  put(store, obj) { return run([store], 'readwrite', t => { t.objectStore(store).put(obj); }).then(() => obj); },
  putMany(store, arr) { return run([store], 'readwrite', t => { const s = t.objectStore(store); arr.forEach(o => s.put(o)); }); },
  del(store, id) { return run([store], 'readwrite', t => { t.objectStore(store).delete(id); }); },
  delMany(store, ids) { return run([store], 'readwrite', t => { const s = t.objectStore(store); ids.forEach(id => s.delete(id)); }); },
  clear(store) { return run([store], 'readwrite', t => { t.objectStore(store).clear(); }); },
};

export async function getSetting(key, def) {
  const r = await db.get('meta', key);
  return r ? r.value : def;
}
export function setSetting(key, value) { return db.put('meta', { id: key, value }); }

// Verwijdert een notitieboek inclusief pagina's en opnames
export async function deleteNotebook(id) {
  const [pages, recs] = await Promise.all([db.by('pages', 'notebookId', id), db.by('recordings', 'notebookId', id)]);
  await db.delMany('pages', pages.map(p => p.id));
  await db.delMany('recordings', recs.map(r => r.id));
  await db.del('notebooks', id);
}

// Verwijdert een vak met alles wat erbij hoort
export async function deleteSubject(id) {
  const notebooks = await db.by('notebooks', 'subjectId', id);
  for (const n of notebooks) await deleteNotebook(n.id);
  for (const store of ['slots', 'summaries', 'assignments', 'cards']) {
    const items = await db.by(store, 'subjectId', id);
    await db.delMany(store, items.map(i => i.id));
  }
  await db.del('subjects', id);
}

export async function requestPersistence() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
