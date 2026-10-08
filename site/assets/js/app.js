/**
 * Vigie — interface web.
 * État de l'application, navigation par onglets, thème, synchronisation des données.
 */
import { clear, h } from './dom.js';
import { icon } from './icons.js';
import { plural, relativeTime, setTimeZone } from './format.js';
import * as prefs from './prefs.js';
import { connectGitHub, createBackend, detectLocal, disconnectGitHub, loadData } from './data.js';
import { DEFAULT_FILTERS, enrichItems, outOfReach, toCsv } from './model.js';
import { normalizeConfig } from './shared/config.js';
import { setBusy, toast } from './ui.js';
import { renderAnnonces } from './views/annonces.js';
import { renderCategories } from './views/categories.js';
import { renderReglages } from './views/reglages.js';
import { renderSources } from './views/sources.js';

const ROUTES = {
  annonces: { title: 'Annonces', render: renderAnnonces },
  sources: { title: 'Sources', render: renderSources },
  categories: { title: 'Catégories', render: renderCategories },
  reglages: { title: 'Réglages', render: renderReglages },
};
const PERSISTED_FILTERS = ['category', 'status', 'region', 'source', 'kind', 'sort'];
// Clé versionnée : les filtres enregistrés avant le filtre « Mes catégories » sont ignorés.
const FILTERS_KEY = 'filters.v2';
const PAGE_SIZE = 40;

const state = {
  loading: true,
  route: 'annonces',
  config: normalizeConfig({}),
  items: [],
  status: { sources: {}, runs: [] },
  deploy: null,
  local: null,
  backend: createBackend({ local: null, deploy: null }),
  since: prefs.noveltyReference(),
  filters: { ...DEFAULT_FILTERS, ...pick(prefs.read(FILTERS_KEY, {}), PERSISTED_FILTERS) },
  filtersOpen: false,
  visibleCount: PAGE_SIZE,
  openDetails: new Set(),
  enriched: [],
  running: false,
};

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source && source[key] != null) out[key] = source[key];
  return out;
}

function recompute() {
  state.enriched = enrichItems({ items: state.items, config: state.config, since: state.since, starred: prefs.starred() });
}

/* ── Rendu ────────────────────────────────────────────────────────── */

const view = () => document.getElementById('view');
let renderTimer = null;

function render() {
  clearTimeout(renderTimer);
  const container = view();
  if (!container) return;
  const active = document.activeElement;
  const focusId = active && container.contains(active) ? active.id : null;
  const selection = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;

  const route = ROUTES[state.route] || ROUTES.annonces;
  clear(container).append(route.render(ctx));

  if (focusId) {
    const target = document.getElementById(focusId);
    if (target) {
      target.focus({ preventScroll: true });
      if (selection && typeof target.setSelectionRange === 'function') {
        try {
          target.setSelectionRange(...selection);
        } catch {
          /* type de champ sans sélection */
        }
      }
    }
  }
  updateChrome();
}

function scheduleRender(delay = 160) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, delay);
}

function updateChrome() {
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === state.route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${ROUTES[state.route]?.title || 'Annonces'} · Vigie`;

  const sync = document.getElementById('sync-status');
  if (sync) {
    clear(sync);
    const updated = state.status?.updatedAt;
    const errors = state.config.sources.filter((source) => {
      const status = state.status?.sources?.[source.id];
      return source.enabled && status?.ok === false && !outOfReach(status);
    }).length;
    const running = state.running || state.local?.running;
    const tone = running ? 'busy' : errors ? 'warning' : updated ? 'ok' : 'idle';
    const text = running ? 'Vérification en cours…' : updated ? `Vérifié ${relativeTime(updated)}` : 'Jamais vérifié';
    sync.dataset.tone = tone;
    sync.append(h('span', { class: 'sync-dot', 'aria-hidden': 'true' }), h('span', { class: 'sync-text' }, text));
    sync.title = errors ? `${plural(errors, 'source en erreur', 'sources en erreur')}` : text;
  }

  const themeButton = document.getElementById('theme-toggle');
  if (themeButton) {
    const dark = isDark();
    clear(themeButton).append(icon(dark ? 'sun' : 'moon', { size: 20 }));
    themeButton.setAttribute('aria-label', dark ? 'Passer en thème clair' : 'Passer en thème sombre');
    themeButton.title = themeButton.getAttribute('aria-label');
  }

  const fresh = state.enriched.filter((item) => item.isNew).length;
  for (const badge of document.querySelectorAll('[data-nav-badge="annonces"]')) {
    badge.textContent = fresh ? String(fresh > 99 ? '99+' : fresh) : '';
    badge.hidden = !fresh;
    badge.title = fresh ? plural(fresh, 'nouvelle annonce', 'nouvelles annonces') : '';
  }
}

/* ── Thème ────────────────────────────────────────────────────────── */

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function isDark() {
  const theme = prefs.read('theme', 'auto');
  return theme === 'dark' || (theme === 'auto' && darkQuery.matches);
}

function applyTheme(value) {
  const root = document.documentElement;
  if (value === 'light' || value === 'dark') root.setAttribute('data-theme', value);
  else root.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', isDark() ? '#1a1a1a' : '#ffffff');
  updateChrome();
}

darkQuery.addEventListener?.('change', () => applyTheme(prefs.read('theme', 'auto')));

/* ── Données ──────────────────────────────────────────────────────── */

let knownIds = null;

function notifyNewItems() {
  const ids = new Set(state.items.map((item) => item.id));
  if (knownIds && prefs.read('notify', false) && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const fresh = state.enriched.filter((item) => !knownIds.has(item.id) && !item.seed && item.categories.length);
    if (fresh.length) {
      try {
        const notification = new Notification(`Vigie · ${plural(fresh.length, 'nouvelle annonce', 'nouvelles annonces')}`, {
          body: fresh.slice(0, 3).map((item) => `• ${item.title}`).join('\n'),
          icon: 'assets/img/icon-192.png',
          tag: 'vigie-nouveautes',
        });
        notification.onclick = () => {
          window.focus();
          ctx.setFilters({ quick: 'new' });
          navigate('annonces');
        };
      } catch {
        /* notifications indisponibles (ex. certains navigateurs mobiles) */
      }
    }
  }
  knownIds = ids;
}

async function reload({ quiet = true } = {}) {
  const local = await detectLocal();
  const data = await loadData({ local: Boolean(local) });
  state.local = local;
  state.config = data.config;
  state.items = data.items;
  state.status = data.status;
  state.deploy = data.deploy;
  state.backend = createBackend({ local, deploy: data.deploy });
  state.loading = false;
  setTimeZone(state.config.settings.timezone);
  recompute();
  notifyNewItems();
  render();
  if (!quiet && data.configMissing && !local) toast('Configuration introuvable : vérifiez que le dossier config est publié avec le site.', 'error');
}

/* Surveillance des mises à jour pendant que la page est ouverte. */
let lastStamp = null;
let pollTimer = null;
let fastPollUntil = 0;

async function poll() {
  clearTimeout(pollTimer);
  try {
    if (state.backend.kind === 'local') {
      const local = await detectLocal();
      if (local) {
        const wasRunning = state.local?.running;
        state.local = local;
        if (local.lastRunFinishedAt && local.lastRunFinishedAt !== lastStamp) {
          const first = lastStamp === null;
          lastStamp = local.lastRunFinishedAt;
          if (!first) await reload();
        } else if (wasRunning !== local.running) updateChrome();
      }
    } else if (document.visibilityState === 'visible') {
      const response = await fetch(`data/status.json?t=${Date.now()}`, { cache: 'no-store' });
      if (response.ok) {
        const status = await response.json();
        if (lastStamp && status.updatedAt && status.updatedAt !== lastStamp) {
          lastStamp = status.updatedAt;
          await reload();
          toast('Nouvelles données de veille chargées.', 'info');
        } else lastStamp = status.updatedAt || lastStamp;
      }
    }
  } catch {
    /* hors ligne : on réessaiera */
  }
  const fast = Date.now() < fastPollUntil;
  const delay = state.backend.kind === 'local' ? (state.local?.running ? 3000 : 30000) : fast ? 45000 : 300000;
  pollTimer = setTimeout(poll, delay);
}

/* ── Actions ──────────────────────────────────────────────────────── */

function navigate(route) {
  if (window.location.hash !== `#${route}`) window.location.hash = route;
  else onRoute();
}

function onRoute() {
  const route = window.location.hash.replace('#', '') || 'annonces';
  const changed = route !== state.route;
  state.route = ROUTES[route] ? route : 'annonces';
  render();
  if (changed) {
    window.scrollTo({ top: 0 });
    document.querySelector('.page-title')?.setAttribute('tabindex', '-1');
    document.querySelector('.page-title')?.focus({ preventScroll: true });
  }
}

async function waitLocalRun() {
  const started = Date.now();
  while (Date.now() - started < 10 * 60000) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const local = await detectLocal();
    if (!local) break;
    state.local = local;
    updateChrome();
    if (!local.running) return local;
  }
  return state.local;
}

const ctx = {
  state,
  render,
  navigate,
  setFilters(partial, { debounce = false, keepPage = false } = {}) {
    state.filters = { ...state.filters, ...partial };
    if (!keepPage) state.visibleCount = PAGE_SIZE;
    prefs.write(FILTERS_KEY, pick(state.filters, PERSISTED_FILTERS));
    if (debounce) scheduleRender();
    else render();
  },
  resetFilters() {
    state.filters = { ...DEFAULT_FILTERS };
    state.visibleCount = PAGE_SIZE;
    prefs.write(FILTERS_KEY, null);
    render();
  },
  toggleFilters() {
    state.filtersOpen = !state.filtersOpen;
    render();
  },
  showMore(count) {
    state.visibleCount += count;
    render();
  },
  toggleDetails(id, open) {
    if (open) state.openDetails.add(id);
    else state.openDetails.delete(id);
  },
  toggleStar(id) {
    const starred = prefs.toggleStar(id);
    const item = state.enriched.find((entry) => entry.id === id);
    if (item) item.starred = starred;
    render();
    toast(starred ? 'Annonce suivie : retrouvez-la dans « Suivies ».' : 'Vous ne suivez plus cette annonce.', 'success', { timeout: 2500 });
  },
  showCategory(id) {
    state.filters = { ...state.filters, category: id, quick: null, status: 'open' };
    prefs.write(FILTERS_KEY, pick(state.filters, PERSISTED_FILTERS));
    navigate('annonces');
  },
  exportCsv(items) {
    if (!items.length) {
      toast('Aucune annonce à exporter.', 'info');
      return;
    }
    const blob = new Blob([toCsv(items, state.config)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `vigie-annonces-${new Date().toISOString().slice(0, 10)}.csv` });
    link.href = url;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`${plural(items.length, 'annonce exportée', 'annonces exportées')} (fichier CSV).`, 'success');
  },
  async runNow(buttonElement, only = null) {
    if (state.running) return;
    state.running = true;
    setBusy(buttonElement, true, 'Vérification…');
    updateChrome();
    try {
      const result = await state.backend.runNow(only);
      if (result.local) {
        const before = new Set(state.items.map((item) => item.id));
        await waitLocalRun();
        await reload();
        const added = state.items.filter((item) => !before.has(item.id) && !item.seed).length;
        const errors = state.local?.lastResult?.errors || 0;
        toast(added ? `Vérification terminée : ${plural(added, 'nouvelle annonce', 'nouvelles annonces')}.` : 'Vérification terminée : rien de nouveau.', errors ? 'info' : 'success');
        if (errors) toast(`${plural(errors, 'source n’a', 'sources n’ont')} pas pu être lue${errors > 1 ? 's' : ''}. Détails dans « Sources ».`, 'error');
      } else {
        fastPollUntil = Date.now() + 15 * 60000;
        toast('Vérification lancée sur GitHub. Les résultats s’afficheront ici dans 2 à 3 minutes.', 'info', { timeout: 8000 });
        clearTimeout(pollTimer);
        pollTimer = setTimeout(poll, 45000);
      }
    } catch (error) {
      toast(error.message || 'La vérification n’a pas pu démarrer.', 'error');
    } finally {
      state.running = false;
      setBusy(buttonElement, false);
      updateChrome();
    }
  },
  async updateConfig(mutate, message, buttonElement) {
    if (buttonElement) setBusy(buttonElement, true);
    try {
      const result = await state.backend.updateConfig(mutate, message);
      state.config = result.config;
      recompute();
      render();
      toast(result.message, 'success');
      if (state.backend.kind === 'github') {
        fastPollUntil = Date.now() + 15 * 60000;
        clearTimeout(pollTimer);
        pollTimer = setTimeout(poll, 60000);
      }
      return true;
    } catch (error) {
      toast(error.message || 'Enregistrement impossible.', 'error');
      return false;
    } finally {
      if (buttonElement) setBusy(buttonElement, false);
    }
  },
  async connect(token) {
    if (!state.deploy?.repository) return;
    try {
      await connectGitHub(state.deploy, token);
      state.backend = createBackend({ local: state.local, deploy: state.deploy });
      render();
      toast('Connecté à GitHub : vous pouvez modifier la veille depuis cet appareil.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  disconnect() {
    disconnectGitHub();
    state.backend = createBackend({ local: state.local, deploy: state.deploy });
    render();
    toast('Déconnecté de GitHub. Le jeton a été retiré de cet appareil.', 'success');
  },
  /** Relais vers la version en ligne (mode local) : connect, publish ou disconnect. */
  async relay(action, payload, buttonElement) {
    if (!state.backend.relay) return false;
    setBusy(buttonElement, true, { connect: 'Vérification…', publish: 'Publication…', disconnect: 'Désactivation…' }[action]);
    try {
      const result = await state.backend.relay(action, payload);
      if (state.local) state.local = { ...state.local, relay: result.relay };
      render();
      const { outcome } = result;
      const count = outcome?.published?.length || 0;
      if (action === 'disconnect') toast('Relais désactivé : le jeton a été retiré de ce PC.', 'success');
      else if (outcome && !outcome.ok) toast(action === 'connect' ? `Relais activé, mais la publication a échoué : ${outcome.error}` : outcome.error, 'error');
      else if (count) toast(`${plural(count, 'source publiée', 'sources publiées')} pour la version en ligne : elle les reprendra à son prochain passage.`, 'success', { timeout: 8000 });
      else toast(action === 'connect' ? 'Relais activé. Rien à publier pour l’instant : il partira après la prochaine vérification.' : 'Rien de nouveau à publier : les relevés en ligne sont à jour.', 'success', { timeout: 8000 });
      return true;
    } catch (error) {
      toast(error.message || 'Relais indisponible.', 'error');
      return false;
    } finally {
      setBusy(buttonElement, false);
    }
  },
  setTheme(value) {
    prefs.write('theme', value);
    applyTheme(value);
  },
  markAllRead() {
    state.since = prefs.resetNovelty();
    recompute();
    render();
    toast('Toutes les annonces sont marquées comme lues.', 'success');
  },
  refreshDerived() {
    recompute();
    render();
  },
};

/* ── Démarrage ────────────────────────────────────────────────────── */

document.getElementById('theme-toggle')?.addEventListener('click', () => ctx.setTheme(isDark() ? 'light' : 'dark'));
window.addEventListener('hashchange', onRoute);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') poll();
});
setInterval(updateChrome, 60000);

state.route = ROUTES[window.location.hash.replace('#', '')] ? window.location.hash.replace('#', '') : 'annonces';
applyTheme(prefs.read('theme', 'auto'));
render();
reload({ quiet: false })
  .catch(() => {
    state.loading = false;
    render();
    toast('Impossible de charger les données de veille. Vérifiez votre connexion.', 'error');
  })
  .finally(() => {
    lastStamp = state.backend.kind === 'local' ? state.local?.lastRunFinishedAt || null : state.status?.updatedAt || null;
    pollTimer = setTimeout(poll, state.backend.kind === 'local' ? 30000 : 300000);
  });
