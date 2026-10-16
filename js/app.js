// Router en opstarten.
import { requestPersistence } from './db.js';
import { toast, closePopovers } from './util.js';
import { dashboard, subjectView, summaryView, practiceView, settingsView, planningView } from './views.js';
import { openEditor } from './editor.js';
import { catchUp } from './planner.js';

const app = document.getElementById('app');
let cleanup = null;
let seq = 0;

async function route() {
  const my = ++seq;
  closePopovers();
  if (cleanup) { const c = cleanup; cleanup = null; await c(); }
  if (my !== seq) return;
  const [path, query] = (location.hash.replace(/^#/, '') || '/').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  app.onclick = null;
  document.body.classList.toggle('in-editor', parts[0] === 'notitie');
  window.scrollTo(0, 0);
  try {
    // Wat gisteren niet af kwam, schuift door voordat het dashboard/de planning getoond wordt
    if ([undefined, 'planning', 'vak'].includes(parts[0])) await catchUp().catch(e => console.warn('inhalen mislukt', e));
    if (my !== seq) return;
    switch (parts[0]) {
      case undefined: await dashboard(app); break;
      case 'vak': await subjectView(app, parts[1], parts[2]); break;
      case 'notitie': cleanup = await openEditor(app, parts[1], { onExit: () => { cleanup = null; history.length > 1 ? history.back() : (location.hash = '#/'); } }); break;
      case 'samenvatting': await summaryView(app, parts[1], parts[2]); break;
      case 'oefenen': cleanup = await practiceView(app, parts[1], query === 'alles'); break;
      case 'instellingen': await settingsView(app); break;
      case 'planning': await planningView(app, parts[1] || null); break;
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

// Offline: service worker
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Er is een nieuwe versie van Vakwerk', { action: 'Vernieuwen', onAction: () => w.postMessage('skipWaiting') });
        }
      });
    });
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
