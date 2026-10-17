// Router en opstarten.
import { requestPersistence, RUNTIME } from './db.js';
import { toast, closePopovers } from './util.js';
import { dashboard, subjectView, summaryView, practiceView, settingsView, planningView } from './views.js';
import { openEditor } from './editor.js';
import { catchUp } from './planner.js';
import { checkInbox, connectInbox } from './inbox.js';

const app = document.getElementById('app');
let cleanup = null;
let seq = 0;
let backHash = '#/'; // waar 'terug' uit een notitie naartoe gaat (geen history.back: in een artifact kan dat de claude.ai-pagina verlaten)

async function route() {
  const my = ++seq;
  closePopovers();
  if (cleanup) { const c = cleanup; cleanup = null; await c(); }
  if (my !== seq) return;
  const [path, query] = (location.hash.replace(/^#/, '') || '/').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  app.onclick = null;
  if (parts[0] !== 'notitie') backHash = location.hash || '#/';
  document.body.classList.toggle('in-editor', parts[0] === 'notitie');
  window.scrollTo(0, 0);
  try {
    // Wat gisteren niet af kwam, schuift door voordat het dashboard/de planning getoond wordt
    if ([undefined, 'planning', 'vak'].includes(parts[0])) await catchUp().catch(e => console.warn('inhalen mislukt', e));
    if (my !== seq) return;
    switch (parts[0]) {
      case undefined: await dashboard(app); break;
      case 'vak': await subjectView(app, parts[1], parts[2]); break;
      case 'notitie': cleanup = await openEditor(app, parts[1], { onExit: () => { cleanup = null; location.hash = backHash; } }); break;
      case 'samenvatting': await summaryView(app, parts[1], parts[2]); break;
      case 'oefenen': cleanup = await practiceView(app, parts[1], query === 'alles'); break;
      case 'instellingen': await settingsView(app); break;
      case 'planning': await planningView(app, parts[1] || null); break;
      case 'koppel': { // #/koppel?bron=<inbox-link> — eenmalig de inbox van Claude koppelen
        const q = new URLSearchParams(query || '');
        app.innerHTML = '<div class="view"><p class="empty">Inbox koppelen…</p></div>';
        if (q.get('bron')) await connectInbox(q.get('bron'), q.get('sleutel') || '');
        location.replace('#/');
        break;
      }
      default: location.hash = '#/';
    }
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="view"><p class="empty">Er ging iets mis: ${String(err.message || err)}</p><p class="center"><a class="btn" href="#/">Naar dashboard</a></p></div>`;
  }
}

window.addEventListener('hashchange', route);
// iOS: voorkom dat de hele app inzoomt met knijpen (de editor heeft eigen zoom)
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

route();
requestPersistence();

// Inbox van Claude: bij openen en bij terugkomen in de app kijken of er iets nieuws is
const pullInbox = () => checkInbox().then(r => { if (r && !document.body.classList.contains('in-editor')) route(); }).catch(() => {});
if (!location.hash.startsWith('#/koppel')) pullInbox();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullInbox(); });

// Offline: service worker
// Alleen op de echte site (GitHub Pages); lokaal en in een claude.ai-artifact werkt een service worker niet
if ('serviceWorker' in navigator && !RUNTIME.sandbox && location.hostname.endsWith('github.io')) {
  navigator.serviceWorker.register('./sw.js').catch(() => null).then(reg => {
    if (!reg) return;
    // Elke keer dat je de app weer opent: kijken of er een nieuwe versie is
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  });
  // Nieuwe versie actief → herladen, behalve midden in een notitie (dan pas als je hem sluit)
  let reloaded = false, pending = false;
  const reloadNow = () => { if (!reloaded) { reloaded = true; location.reload(); } };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!document.body.classList.contains('in-editor')) return reloadNow();
    pending = true;
    toast('Nieuwe versie van Vakwerk klaar — wordt geladen zodra je deze notitie sluit');
  });
  window.addEventListener('hashchange', () => { if (pending && !location.hash.startsWith('#/notitie')) reloadNow(); });
}
