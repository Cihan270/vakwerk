// Supabase: inloggen met een mailcode en sync tussen apparaten, zonder externe packages.
// De app blijft lokaal werken (IndexedDB); dit synchroniseert op de achtergrond zodra er internet is.
// Per object geldt: de laatste wijziging wint (changed_at). `meta` (instellingen per apparaat) gaat niet mee.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { localStore as idb, onWrite, STORE_NAMES, RUNTIME } from './db.js';
import { confirmDialog } from './util.js';

const BASE = SUPABASE_URL.replace(/\/+$/, '');
const TABLE = 'vakwerk_items', BUCKET = 'vakwerk', STATE = 'syncstate';
const BLOB_STORES = new Set(['recordings', 'assets']);
const SYNCED = STORE_NAMES.filter(s => s !== 'meta');
const LS_KEY = 'vakwerk-cloud';
const PAGE_ROWS = 200, BATCH_BYTES = 1_500_000, SEQ_OVERLAP = 200;

let saved = {};
try { saved = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch {}
const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(saved)); } catch {} };

const status = { state: 'idle', message: '', failed: 0 };
let changeHandler = () => {};

export const isConfigured = () => !!(BASE && SUPABASE_KEY) && !RUNTIME.sandbox;
export const isSignedIn = () => isConfigured() && !!saved.session;
export const cloudStatus = () => ({ ...status, email: saved.session?.user?.email || '', lastSync: saved.lastSync || 0 });

class CloudError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
async function fail(res) {
  let msg = '';
  try { const j = await res.json(); msg = j.msg || j.message || j.error_description || j.error || ''; } catch {}
  return new CloudError(msg || `Fout ${res.status}`, res.status);
}

// ---------- Inloggen ----------
async function authPost(path, body) {
  const res = await fetch(`${BASE}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await fail(res);
  return res.status === 204 ? null : res.json();
}
function setSession(s) {
  saved.session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user: { id: s.user.id, email: s.user.email } } : null;
  persist();
}
export function sendCode(email) { return authPost('otp', { email, create_user: true }); }

// Na een geldige code: dit apparaat aan het account koppelen. beforeFirstLink(hasLocal) kan nog een back-up aanbieden.
export async function verifyCode(email, token, { beforeFirstLink } = {}) {
  const s = await authPost('verify', { type: 'email', email, token });
  if (saved.lastUser && saved.lastUser !== s.user.id) {
    const ok = await confirmDialog('Op dit apparaat staat data van een ander account. Die wordt hier gewist voordat je inlogt. In dat andere account blijft alles bewaard.', { ok: 'Wissen en inloggen' });
    if (!ok) return false;
    for (const store of SYNCED) await idb.clear(store);
    await idb.clear(STATE);
    saved.cursor = 0;
  }
  if (!saved.lastUser) await beforeFirstLink?.(await hasLocalData());
  setSession(s);
  saved.lastUser = s.user.id;
  persist();
  await markAllLocal();
  await syncNow();
  return true;
}
export async function signOut() {
  const token = saved.session?.access_token;
  setSession(null);
  saved.cursor = 0;
  saved.lastSync = 0;
  persist();
  await idb.clear(STATE); // bij opnieuw inloggen wordt alles weer samengevoegd
  if (token) fetch(`${BASE}/auth/v1/logout`, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } }).catch(() => {});
  status.state = 'idle';
  status.message = '';
}

let refreshing = null;
function refreshSession() {
  if (refreshing) return refreshing;
  refreshing = authPost('token?grant_type=refresh_token', { refresh_token: saved.session.refresh_token })
    .then(s => setSession(s))
    .catch(e => { if (e.status === 400 || e.status === 401) { setSession(null); saved.cursor = 0; persist(); } throw e; })
    .finally(() => { refreshing = null; });
  return refreshing;
}
async function accessToken() {
  if (!saved.session) throw new CloudError('Niet ingelogd', 401);
  if (saved.session.expires_at * 1000 - 60_000 < Date.now()) await refreshSession();
  return saved.session.access_token;
}
async function call(path, { method = 'GET', headers = {}, body } = {}, retried = false) {
  const res = await fetch(`${BASE}${path}`, { method, body, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${await accessToken()}`, ...headers } });
  if (res.status === 401 && !retried) { await refreshSession(); return call(path, { method, headers, body }, true); }
  if (!res.ok) throw await fail(res);
  return res;
}

// ---------- Wat er lokaal veranderd is ----------
const keyOf = (store, rid) => `${store}/${rid}`;
async function hasLocalData() {
  for (const store of SYNCED) if ((await idb.keys(store)).length) return true;
  return false;
}
async function markWrite(store, ids) {
  if (!isSignedIn() || !SYNCED.includes(store) || !ids.length) return;
  const now = Date.now();
  const rows = await Promise.all(ids.map(async rid => {
    const st = await idb.get(STATE, keyOf(store, rid));
    return { id: keyOf(store, rid), store, rid, t: Math.max(now, (st?.t || 0) + 1), dirty: 1 };
  }));
  await idb.putMany(STATE, rows);
  syncSoon();
}
// Eerste keer inloggen: alles wat al op dit apparaat staat gaat mee. Heeft een object geen tijd, dan wint het account.
async function markAllLocal() {
  for (const store of SYNCED) {
    const rows = [];
    for (const o of await idb.all(store)) {
      const key = keyOf(store, o.id);
      if (await idb.get(STATE, key)) continue;
      rows.push({ id: key, store, rid: o.id, t: Number(o.updated) || Number(o.created) || 1, dirty: 1 });
    }
    if (rows.length) await idb.putMany(STATE, rows);
  }
}

// ---------- Bestanden ----------
const filePath = (store, rid) => `${saved.session.user.id}/${store}/${encodeURIComponent(rid)}`;
const fileUrl = path => `/storage/v1/object/${BUCKET}/${path}`;
async function upload(store, rid, blob) {
  const path = filePath(store, rid);
  await call(fileUrl(path), { method: 'POST', body: blob, headers: { 'x-upsert': 'true', 'Content-Type': blob.type || 'application/octet-stream' } });
  return path;
}

// ---------- Ophalen ----------
async function pull() {
  let changed = false;
  let from = Math.max(0, (saved.cursor || 0) - SEQ_OVERLAP); // overlap: een trage schrijver kan een lager nummer hebben
  for (;;) {
    const res = await call(`/rest/v1/${TABLE}?select=store,id,data,file,deleted,changed_at,seq&seq=gt.${from}&order=seq.asc&limit=${PAGE_ROWS}`);
    const rows = await res.json();
    for (const r of rows) if (await applyRow(r)) changed = true;
    if (rows.length) {
      from = rows[rows.length - 1].seq;
      saved.cursor = Math.max(saved.cursor || 0, from);
      persist();
    }
    if (rows.length < PAGE_ROWS) return changed;
  }
}
async function applyRow(r) {
  if (!SYNCED.includes(r.store)) return false;
  const key = keyOf(r.store, r.id);
  const st = await idb.get(STATE, key);
  // Eigen of oudere wijziging overslaan. Gelijke tijd met een lokale wijziging: het account wint.
  if (st && (r.changed_at < st.t || (r.changed_at === st.t && !st.dirty))) return false;
  if (r.deleted) await idb.del(r.store, r.id);
  else if (BLOB_STORES.has(r.store)) {
    let blob;
    try { blob = await (await call(fileUrl(r.file))).blob(); }
    catch (e) {
      if (e.status !== 400 && e.status !== 404) throw e; // niet gevonden: overslaan, anders blijft de sync hier steken
      status.failed++;
      return false;
    }
    await idb.put(r.store, { ...r.data, blob });
  } else await idb.put(r.store, r.data);
  await idb.put(STATE, { id: key, store: r.store, rid: r.id, t: r.changed_at, dirty: 0 });
  return true;
}

// ---------- Versturen ----------
const cleanJson = o => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'string' ? v.replaceAll('\0', '') : v))); // Postgres weigert \0
async function buildRow(st) {
  const obj = await idb.get(st.store, st.rid);
  const row = { user_id: saved.session.user.id, store: st.store, id: st.rid, data: null, file: null, deleted: !obj, changed_at: st.t };
  if (!obj) {
    if (BLOB_STORES.has(st.store)) await call(fileUrl(filePath(st.store, st.rid)), { method: 'DELETE' }).catch(() => {});
    return row;
  }
  if (BLOB_STORES.has(st.store)) {
    const { blob, ...rest } = obj;
    row.file = await upload(st.store, st.rid, blob);
    row.data = cleanJson(rest);
  } else row.data = cleanJson(obj);
  return row;
}
async function upsert(batch) {
  try {
    await call(`/rest/v1/${TABLE}?on_conflict=user_id,store,id`, {
      method: 'POST',
      body: JSON.stringify(batch.map(b => b.row)),
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  } catch (e) {
    if (!e.status || e.status === 401 || e.status === 404) throw e;
    if (batch.length > 1) { for (const b of batch) await upsert([b]); return; } // zoek de rij die niet lukt, de rest mag door
    status.failed++;
    console.warn('sync', batch[0].st.id, e.message);
    return;
  }
  for (const { st } of batch) {
    const now = await idb.get(STATE, st.id);
    if (now?.t === st.t) await idb.put(STATE, { ...now, dirty: 0 }); // intussen opnieuw gewijzigd? Dan blijft hij staan voor de volgende keer
  }
}
async function push() {
  let batch = [], size = 0;
  for (const st of await idb.by(STATE, 'dirty', 1)) {
    let row;
    try { row = await buildRow(st); }
    catch (e) {
      if (!e.status || e.status === 401) throw e;
      status.failed++; // bijvoorbeeld een opname die groter is dan Supabase toestaat
      console.warn('sync', st.id, e.message);
      continue;
    }
    const len = JSON.stringify(row).length;
    if (batch.length && size + len > BATCH_BYTES) { await upsert(batch); batch = []; size = 0; }
    batch.push({ row, st });
    size += len;
  }
  if (batch.length) await upsert(batch);
}

// ---------- Sync ----------
let running = null, again = false, timer = 0;
export function syncNow() {
  if (!isSignedIn()) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    status.state = 'syncing';
    status.message = '';
    status.failed = 0;
    let changed = false;
    try {
      changed = await pull();
      await push();
      saved.lastSync = Date.now();
      persist();
      status.state = 'idle';
    } catch (e) {
      status.state = !saved.session ? 'login' : e.status ? 'error' : 'offline';
      status.message = e.status === 404 ? 'De database is nog niet ingesteld: voer supabase/schema.sql uit.' : e.message;
      if (e.status) console.warn('sync', e.status, e.message);
    }
    if (changed) changeHandler();
  })().finally(() => {
    running = null;
    if (again) { again = false; syncSoon(500); }
  });
  return running;
}
function syncSoon(ms = 4000) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

export function initCloud({ onRemoteChange } = {}) {
  if (!isConfigured()) return;
  changeHandler = onRemoteChange || changeHandler;
  onWrite(markWrite);
  document.addEventListener('visibilitychange', syncNow);
  window.addEventListener('online', syncNow);
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60_000);
  syncNow();
}
