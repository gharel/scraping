/**
 * Vue « Annonces » : synthèse, filtres (catégories, statut, source, type), liste des annonces.
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { formatDate, plural, prettyTitle, relativeTime, untilTime } from '../format.js';
import { applyFilters, countBy, DEFAULT_FILTERS, sortItems } from '../model.js';
import { KIND_LABELS } from '../shared/config.js';
import { badge, button, callout, categoryBadge, emptyState, iconButton, pageHead, segmented, select, selectControl } from '../ui.js';

const PAGE_SIZE = 40;

function deadlineInfo(item) {
  if (!item.deadline) return null;
  const when = formatDate(item.deadline, { short: true });
  if (item.closed) return { tone: 'muted', text: `Clôturée le ${when}`, chip: null };
  const days = item.days;
  const chip = days <= 0 ? 'Aujourd’hui' : days === 1 ? 'Demain' : `J-${days}`;
  const tone = days <= 2 ? 'danger' : days <= 7 ? 'warning' : 'neutral';
  return { tone, text: `Date limite : ${when}`, chip };
}

function changeNote(item) {
  const change = item.deadlineChange;
  if (!change?.from || !change?.to) return null;
  const later = Date.parse(change.to) > Date.parse(change.from);
  return h('p', { class: 'ao-change' }, icon('history', { size: 14 }), `${later ? 'Date limite reportée' : 'Date limite avancée'} (auparavant : ${formatDate(change.from)})`);
}

function renderCard(item, ctx, categoriesById) {
  const categories = item.categories.map((id) => categoriesById.get(id)).filter(Boolean);
  const main = categories[0];
  const deadline = deadlineInfo(item);
  const title = prettyTitle(item.title);

  const badges = [
    ...categories.map((category) => categoryBadge(category)),
    item.kind && item.kind !== 'consultation' ? badge(KIND_LABELS[item.kind] || item.kind, 'neutral') : null,
    item.isNew ? badge('Nouveau', 'new', { solid: true }) : null,
    item.gone && !item.closed ? badge('Retirée du site', 'danger') : null,
  ].filter(Boolean);

  const meta = [
    item.reference ? `Réf. ${item.reference}` : null,
    item.procedure || null,
    item.nature ? `${item.nature}${item.lots ? ` · ${item.lots} lots` : ''}` : item.lots ? `${item.lots} lots` : null,
    item.location && item.location.toLowerCase() !== (item.buyerLocation || '').toLowerCase() ? item.location : null,
    item.publishedAt ? `Publiée le ${formatDate(item.publishedAt, { time: false, short: true })}` : null,
  ].filter(Boolean);

  const star = iconButton('star', item.starred ? 'Ne plus suivre cette annonce' : 'Suivre cette annonce', {
    pressed: item.starred,
    className: `star-btn${item.starred ? ' is-starred' : ''}`,
    onClick: () => ctx.toggleStar(item.id),
  });

  const buyerLine = item.buyer
    ? h('p', { class: 'ao-buyer' }, icon('building', { size: 16 }), h('span', null, item.buyer, item.buyerLocation ? h('span', { class: 'ao-buyer-place' }, ` · ${item.buyerLocation}`) : null))
    : null;

  const footLeft = deadline
    ? h('div', { class: `ao-deadline ao-deadline--${deadline.tone}` }, icon('clock', { size: 16 }), h('span', { class: 'ao-deadline-text' }, deadline.text), deadline.chip ? h('span', { class: 'ao-countdown' }, deadline.chip) : null)
    : h('div', { class: 'ao-deadline ao-deadline--muted' }, icon('calendar', { size: 16 }), h('span', { class: 'ao-deadline-text' }, item.publishedAt ? `Publiée le ${formatDate(item.publishedAt, { time: false })}` : `Repérée ${relativeTime(item.firstSeen)}`));

  return h(
    'li',
    { class: 'ao-item' },
    h(
      'article',
      { class: `ao-card${item.open ? '' : ' is-closed'}`, style: { '--bar': main ? `var(--cat-${main.color})` : 'var(--border-strong)' } },
      h('div', { class: 'ao-bar', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'ao-body' },
        h('div', { class: 'ao-top' }, h('div', { class: 'ao-badges' }, badges.length ? badges : h('span', { class: 'ao-source-hint' }, item.source?.name || '')), star),
        h('h3', { class: 'ao-title' }, item.url ? h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer' }, title) : title),
        buyerLine,
        meta.length ? h('ul', { class: 'ao-meta' }, meta.map((entry) => h('li', null, entry))) : null,
        item.summary
          ? h(
              'details',
              { class: 'ao-details', open: ctx.state.openDetails.has(item.id), onToggle: (event) => ctx.toggleDetails(item.id, event.currentTarget.open) },
              h('summary', null, item.kind === 'modification' ? 'Voir les changements' : 'Lire le résumé'),
              h('p', { class: 'ao-summary' }, item.summary),
            )
          : null,
        changeNote(item),
        h(
          'div',
          { class: 'ao-foot' },
          footLeft,
          h('div', { class: 'ao-actions' }, h('span', { class: 'ao-source' }, item.source?.name || 'Source retirée'), item.url ? button('Voir l’annonce', { variant: 'secondary', size: 'sm', href: item.url, external: true, iconAfter: 'external' }) : null),
        ),
      ),
    ),
  );
}

function statTile(label, value, hint, active, onClick, tone) {
  return h(
    'button',
    { class: `stat${active ? ' is-active' : ''}${tone ? ` stat--${tone}` : ''}`, type: 'button', 'aria-pressed': String(active), onClick },
    h('span', { class: 'stat-value' }, value.toLocaleString('fr-FR')),
    h('span', { class: 'stat-label' }, label),
    h('span', { class: 'stat-hint' }, hint),
  );
}

function runAction(ctx) {
  const { backend } = ctx.state;
  if (backend.kind === 'lecture') {
    return backend.actionsUrl ? button('Lancer sur GitHub', { variant: 'secondary', href: backend.actionsUrl, external: true, iconName: 'refresh' }) : null;
  }
  return button('Vérifier maintenant', { variant: 'secondary', iconName: 'refresh', className: 'js-run', onClick: (event) => ctx.runNow(event.currentTarget) });
}

export function lastCheckText(state) {
  const updated = state.status?.updatedAt || state.status?.lastRun?.finishedAt;
  const sources = state.config.sources.filter((source) => source.enabled).length;
  const parts = [updated ? `Dernière vérification ${relativeTime(updated)}` : 'Aucune vérification pour le moment', plural(sources, 'source surveillée', 'sources surveillées')];
  if (state.local?.running) parts.push('vérification en cours…');
  else if (state.local?.nextRunAt) parts.push(`prochaine ${untilTime(state.local.nextRunAt)}`);
  return parts.join(' · ');
}

export function renderAnnonces(ctx) {
  const { state } = ctx;
  const filters = state.filters;
  const all = state.enriched;
  const categoriesById = new Map(state.config.categories.map((category) => [category.id, category]));

  const filtered = sortItems(applyFilters(all, filters), filters.sort);
  const forCategories = applyFilters(all, filters, { ignore: ['category'] });
  const categoryCounts = countBy(forCategories, 'categories');
  const uncategorized = forCategories.filter((item) => item.categories.length === 0).length;
  const forSources = applyFilters(all, filters, { ignore: ['source'] });
  const sourceCounts = countBy(forSources, 'sourceId');
  const forKinds = applyFilters(all, filters, { ignore: ['kind'] });
  const kindCounts = countBy(forKinds, 'kind');

  const openItems = all.filter((item) => item.open);
  const stats = {
    open: openItems.length,
    fresh: all.filter((item) => item.isNew).length,
    soon: openItems.filter((item) => item.days != null && item.days <= 7).length,
    starred: all.filter((item) => item.starred).length,
  };

  const errors = state.config.sources.filter((source) => source.enabled && state.status?.sources?.[source.id]?.ok === false);
  const updatedAt = Date.parse(state.status?.updatedAt || '') || 0;
  const stale = state.backend.kind !== 'local' && updatedAt && Date.now() - updatedAt > 12 * 3600000;

  const notices = [
    errors.length
      ? callout('warning', 'warning', `${plural(errors.length, 'source n’a', 'sources n’ont')} pas pu être vérifiée${errors.length > 1 ? 's' : ''} au dernier passage`, h('p', null, errors.map((source) => source.name).join(', '), ' · ', h('a', { href: '#sources' }, 'Voir le détail')))
      : null,
    stale ? callout('info', 'info', 'La veille automatique semble à l’arrêt', h('p', null, `Aucune vérification depuis ${relativeTime(state.status.updatedAt).replace('il y a ', '')}. Vérifiez l’onglet Actions du dépôt GitHub.`)) : null,
  ].filter(Boolean);

  const setQuick = (value) => ctx.setFilters({ quick: filters.quick === value ? null : value, status: value === 'starred' ? 'all' : filters.status === 'all' && filters.quick === 'starred' ? 'open' : filters.status });

  const tiles = h(
    'div',
    { class: 'stats', role: 'group', 'aria-label': 'Raccourcis' },
    statTile('En cours', stats.open, 'annonces ouvertes', !filters.quick && filters.status === 'open', () => ctx.setFilters({ quick: null, status: 'open' })),
    statTile('Nouvelles', stats.fresh, 'depuis votre dernière visite', filters.quick === 'new', () => setQuick('new'), 'new'),
    statTile('Clôture proche', stats.soon, 'dans les 7 jours', filters.quick === 'soon', () => setQuick('soon'), 'soon'),
    statTile('Suivies', stats.starred, 'sur cet appareil', filters.quick === 'starred', () => setQuick('starred')),
  );

  /* ── Filtres ── */
  const search = h('input', {
    class: 'input search-input',
    type: 'search',
    id: 'search',
    placeholder: 'Mot-clé, acheteur, réf.',
    value: filters.query,
    'aria-label': 'Rechercher dans les annonces',
    autocomplete: 'off',
    onInput: (event) => ctx.setFilters({ query: event.target.value }, { debounce: true }),
  });

  const chip = (id, label, count, color) =>
    h(
      'button',
      { class: `chip${filters.category === id ? ' is-active' : ''}`, type: 'button', 'aria-pressed': String(filters.category === id), onClick: () => ctx.setFilters({ category: filters.category === id && id !== 'all' ? 'all' : id }), style: color ? { '--cat': `var(--cat-${color})` } : null },
      color ? h('span', { class: 'chip-dot', 'aria-hidden': 'true' }) : null,
      h('span', { class: 'chip-label' }, label),
      h('span', { class: 'chip-count' }, count.toLocaleString('fr-FR')),
    );

  const chips = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Catégories' },
    chip('all', 'Toutes', forCategories.length),
    state.config.categories.map((category) => chip(category.id, category.name, categoryCounts.get(category.id) || 0, category.color)),
    state.config.categories.length ? chip('none', 'Non classées', uncategorized) : null,
  );

  const sourceSelect = select(
    [{ value: 'all', label: 'Toutes les sources' }, ...state.config.sources.map((source) => ({ value: source.id, label: `${source.name} (${sourceCounts.get(source.id) || 0})` }))],
    { value: filters.source, id: 'filter-source', onChange: (event) => ctx.setFilters({ source: event.target.value }) },
  );
  const kinds = Object.keys(KIND_LABELS).filter((kind) => kindCounts.has(kind) || filters.kind === kind);
  const kindSelect = select(
    [{ value: 'all', label: 'Tous les types' }, ...kinds.map((kind) => ({ value: kind, label: `${KIND_LABELS[kind]} (${kindCounts.get(kind) || 0})` }))],
    { value: filters.kind, id: 'filter-kind', onChange: (event) => ctx.setFilters({ kind: event.target.value }) },
  );

  const activeExtra = ['status', 'source', 'kind'].filter((key) => filters[key] !== DEFAULT_FILTERS[key]).length;
  const anyActive = Object.keys(DEFAULT_FILTERS).some((key) => key !== 'sort' && filters[key] !== DEFAULT_FILTERS[key]);

  const aside = h(
    'aside',
    { class: `filters${state.filtersOpen ? ' is-open' : ''}`, 'aria-label': 'Filtres' },
    h('div', { class: 'filter-group' }, h('label', { class: 'filter-title', for: 'search' }, 'Rechercher'), h('div', { class: 'search' }, icon('search', { size: 18, className: 'search-icon' }), search)),
    h('div', { class: 'filter-group' }, h('p', { class: 'filter-title' }, 'Catégories'), chips),
    h(
      'button',
      { class: 'filters-toggle', type: 'button', 'aria-expanded': String(Boolean(state.filtersOpen)), 'aria-controls': 'filters-extra', onClick: () => ctx.toggleFilters() },
      icon('filter', { size: 18 }),
      h('span', null, state.filtersOpen ? 'Masquer les filtres' : 'Plus de filtres'),
      activeExtra ? h('span', { class: 'filters-toggle-count' }, String(activeExtra)) : null,
    ),
    h(
      'div',
      { class: 'filters-extra', id: 'filters-extra' },
      h(
        'div',
        { class: 'filter-group' },
        h('p', { class: 'filter-title' }, 'Statut'),
        segmented({
          name: 'statut',
          label: 'Statut des annonces',
          value: filters.status,
          options: [
            { value: 'open', label: 'En cours' },
            { value: 'all', label: 'Toutes' },
            { value: 'closed', label: 'Archivées' },
          ],
          onChange: (value) => ctx.setFilters({ status: value }),
        }),
      ),
      h('div', { class: 'filter-group' }, h('label', { class: 'filter-title', for: 'filter-source' }, 'Source'), sourceSelect),
      h('div', { class: 'filter-group' }, h('label', { class: 'filter-title', for: 'filter-kind' }, 'Type d’annonce'), kindSelect),
    ),
    anyActive ? button('Réinitialiser les filtres', { variant: 'ghost', size: 'sm', iconName: 'x', className: 'filters-reset', onClick: () => ctx.resetFilters() }) : null,
  );

  /* ── Résultats ── */
  const visible = filtered.slice(0, state.visibleCount || PAGE_SIZE);
  const sortSelect = select(
    [
      { value: 'recent', label: 'Plus récentes' },
      { value: 'deadline', label: 'Date limite la plus proche' },
    ],
    { value: filters.sort, id: 'sort', 'aria-label': 'Trier les annonces', onChange: (event) => ctx.setFilters({ sort: event.target.value }, { keepPage: true }) },
  );
  selectControl(sortSelect).setAttribute('aria-label', 'Trier les annonces');

  let list;
  if (!all.length) {
    list = emptyState(
      'inbox',
      state.loading ? 'Chargement des annonces…' : 'Aucune annonce pour le moment',
      state.loading ? null : 'La première vérification des sources n’a pas encore eu lieu.',
      state.loading ? null : runAction(ctx),
    );
  } else if (!filtered.length) {
    list = emptyState('search', 'Aucune annonce ne correspond', 'Élargissez la recherche ou réinitialisez les filtres.', button('Réinitialiser les filtres', { variant: 'secondary', onClick: () => ctx.resetFilters() }));
  } else {
    list = h(
      'div',
      null,
      h('ul', { class: 'ao-list' }, visible.map((item) => renderCard(item, ctx, categoriesById))),
      filtered.length > visible.length
        ? h('div', { class: 'more' }, button(`Afficher ${Math.min(PAGE_SIZE, filtered.length - visible.length)} annonces de plus`, { variant: 'secondary', onClick: () => ctx.showMore(PAGE_SIZE) }), h('p', { class: 'more-hint' }, `${visible.length} sur ${filtered.length}`))
        : null,
    );
  }

  const results = h(
    'section',
    { class: 'results', 'aria-label': 'Résultats' },
    h('div', { class: 'results-bar' }, h('p', { class: 'results-count', 'aria-live': 'polite' }, plural(filtered.length, 'annonce')), h('div', { class: 'results-sort' }, sortSelect)),
    list,
  );

  return h(
    'div',
    { class: 'view' },
    pageHead('Annonces', lastCheckText(state), runAction(ctx), all.length ? button('Exporter', { variant: 'ghost', iconName: 'download', className: 'hide-mobile', onClick: () => ctx.exportCsv(filtered), title: 'Exporter les annonces affichées (CSV)' }) : null),
    notices.length ? h('div', { class: 'notices' }, notices) : null,
    tiles,
    h('div', { class: 'feed-layout' }, aside, results),
  );
}
