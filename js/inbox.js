// Inbox: Claude zet samenvattingen, planning en deadlines klaar in een versleuteld bestand
// (inbox/<id>.json naast de app). De sleutel staat alleen in je persoonlijke koppel-link en
// op dit apparaat. De app haalt de inbox op bij het openen en importeert alleen als er iets veranderd is.
import { getSetting, setSetting, RUNTIME, ready, rawStore } from './db.js';
import { importPack } from './pack.js';
import { toast } from './util.js';

const MIN_INTERVAL = 5 * 60e3; // niet vaker dan eens per 5 minuten

const b64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function hash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

// { v: 1, alg: 'AES-GCM', iv, data } → JSON-pakket. Zonder sleutel: het bestand moet al een pakket zijn.
async function decrypt(text, keyB64) {
  const wrap = JSON.parse(text);
  if (!wrap.alg) return wrap;
  if (!keyB64) throw new Error('geen sleutel');
  const key = await crypto.subtle.importKey('raw', b64(keyB64), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(wrap.iv) }, key, b64(wrap.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

export function validInboxUrl(url) {
  if (/^inbox\/[\w-]+\.json$/.test(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ['gist.githubusercontent.com', 'raw.githubusercontent.com', 'cihan270.github.io'].includes(u.hostname);
  } catch { return false; }
}

// Als artifact: Claude zet pakketten als document in de collectie `inbox` ({ pack: "<json>", created }).
// De app importeert wat nog niet geïmporteerd is en zet er `imported: true` bij.
async function checkArtifactInbox() {
  const store = await rawStore();
  if (!store) return null;
  let snap;
  try { snap = await store.collection('inbox').limit(100).get(); } catch { return null; }
  const todo = snap.docs.map(d => ({ docId: d.id, ...d.data() })).filter(d => !d.imported && d.pack)
    .sort((a, b) => String(a.created || '').localeCompare(String(b.created || '')));
  let last = null;
  for (const d of todo) {
    let pack;
    try { pack = typeof d.pack === 'string' ? JSON.parse(d.pack) : d.pack; } catch { continue; }
    toast('Nieuwe gegevens van Claude worden geladen…', { ms: 2500 });
    const res = await importPack(pack);
    if (!res) continue;
    try { await store.collection('inbox').doc(d.docId).update({ imported: true, importedAt: new Date().toISOString() }); } catch {}
    await setSetting('inboxImportedAt', Date.now());
    last = res;
  }
  return last;
}

// force: ook ophalen als het net al gebeurd is (knop "Nu ophalen")
export async function checkInbox({ force = false } = {}) {
  await ready();
  if (RUNTIME.artifact) return checkArtifactInbox();
  if (RUNTIME.sandbox) return null; // in de viewer kan de app GitHub niet bereiken
  const url = await getSetting('inboxUrl', '');
  if (!url || !navigator.onLine) return null;
  const last = await getSetting('inboxCheckedAt', 0);
  if (!force && Date.now() - last < MIN_INTERVAL) return null;
  await setSetting('inboxCheckedAt', Date.now());
  let text;
  try {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    text = await r.text();
  } catch {
    if (force) toast('Inbox niet bereikbaar — check je internet');
    return null;
  }
  const h = await hash(text);
  if (!force && h === await getSetting('inboxHash', '')) return null;
  let data;
  try { data = await decrypt(text, await getSetting('inboxKey', '')); }
  catch { if (force) toast('De inbox kon niet worden geopend — vraag Claude om een nieuwe koppel-link'); return null; }
  const res = await importPack(data);
  if (res) {
    await setSetting('inboxHash', h);
    await setSetting('inboxImportedAt', Date.now());
  }
  return res;
}

// Koppel-link: …/#/koppel?bron=inbox/<id>.json&sleutel=<key>  (alles na # verlaat je iPad nooit)
export async function connectInbox(input, key = '') {
  let url = String(input || '').trim();
  const m = url.match(/[#?&]bron=([^&]+)/);
  if (m) {
    const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    url = q.get('bron') || '';
    key = q.get('sleutel') || key;
  }
  if (!validInboxUrl(url)) { toast('Dit is geen geldige inbox-link'); return null; }
  await setSetting('inboxUrl', url);
  await setSetting('inboxKey', key);
  await setSetting('inboxHash', '');
  toast('Inbox gekoppeld — ophalen…');
  return checkInbox({ force: true });
}

export async function disconnectInbox() {
  await setSetting('inboxUrl', '');
  await setSetting('inboxKey', '');
  await setSetting('inboxHash', '');
  toast('Inbox ontkoppeld');
}
