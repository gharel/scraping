/**
 * Données dérivées : catégories, statut, nouveautés, filtres, tri et export.
 */
import { categorize, compileCategories, normalizeText } from './shared/categorize.js';
import { itemRegions, KIND_LABELS, REGIONS } from './shared/config.js';
import { daysUntil, formatDate } from './format.js';

/** Par défaut : uniquement les annonces classées dans au moins une de vos catégories. */
export const DEFAULT_FILTERS = { category: 'mine', status: 'open', region: 'all', source: 'all', kind: 'all', sort: 'recent', query: '', quick: null };

/** Une annonce sans date limite est considérée comme en cours pendant 45 jours. */
const ARCHIVE_AFTER_MS = 45 * 86400000;
const STATUS_CLOSED = /expir|cl[ôo]tur|termin[ée]|ferm[ée]|closed|annul|infructu|sans suite/i;

/**
 * Source que la veille en ligne n'atteint pas (site qui filtre les serveurs de GitHub),
 * alors qu'elle reste lisible depuis un PC : ce n'est pas une source à corriger.
 */
export function outOfReach(status) {
  return Boolean(status && status.ok === false && status.network && status.where === 'github');
}

/** Source que la veille en ligne n'atteint pas, mise à jour grâce au relevé publié par Vigie sur le PC. */
export function relayed(status) {
  return Boolean(status && status.ok === true && status.via === 'relais' && status.relayAt);
}

export function enrichItems({ items, config, since, starred, now = new Date() }) {
  const compiled = compileCategories(config.categories, config.settings.excludeKeywords);
  const sources = new Map(config.sources.map((source) => [source.id, source]));
  const sinceMs = Date.parse(since) || 0;
  return items.map((item) => {
    const source = sources.get(item.sourceId);
    // Date limite sans heure (« 06/11/2026 ») : l'annonce reste ouverte jusqu'au soir.
    const dateOnly = /T00:00:00(\.000)?(Z|[+-]\d{2}:\d{2})$/.test(item.deadline || '');
    const deadlineMs = item.deadline ? Date.parse(item.deadline) + (dateOnly ? 86399999 : 0) : Number.NaN;
    // Date limite passée, ou statut de la source qui l'indique (« Expirée », « Clôturée », « Closed »).
    const closed = (Number.isFinite(deadlineMs) && deadlineMs < now.getTime()) || STATUS_CLOSED.test(item.status || '');
    const sortDate = Date.parse(item.publishedAt || item.firstSeen) || 0;
    const archived = !Number.isFinite(deadlineMs) && now.getTime() - sortDate > ARCHIVE_AFTER_MS;
    const deadlineChange = (item.history || []).filter((entry) => entry.field === 'deadline').pop() || null;
    return {
      ...item,
      source,
      categories: categorize(item, compiled, source?.categories || []),
      regions: itemRegions(item, source),
      closed,
      archived,
      open: !closed && !archived && !item.gone,
      days: Number.isFinite(deadlineMs) ? daysUntil(item.deadline, now) : null,
      isNew: !item.seed && (Date.parse(item.firstSeen) || 0) > sinceMs,
      starred: starred.has(item.id),
      sortDate,
      deadlineMs,
      deadlineChange,
      searchText: normalizeText([item.title, item.summary, item.buyer, item.buyerLocation, item.reference, item.location, item.nature, item.procedure, source?.name].filter(Boolean).join(' ')),
    };
  });
}

export function applyFilters(items, filters, { ignore = [] } = {}) {
  const terms = ignore.includes('query') ? [] : normalizeText(filters.query).split(' ').filter(Boolean);
  // Les annonces suivies restent visibles quels que soient la catégorie et le statut.
  const starredView = filters.quick === 'starred' && !ignore.includes('quick');
  return items.filter((item) => {
    if (!ignore.includes('status') && !starredView) {
      if (filters.status === 'open' && !item.open) return false;
      if (filters.status === 'closed' && item.open) return false;
    }
    if (!ignore.includes('category') && !starredView && filters.category !== 'all') {
      if (filters.category === 'mine') {
        if (item.categories.length === 0) return false;
      } else if (filters.category === 'none' ? item.categories.length > 0 : !item.categories.includes(filters.category)) return false;
    }
    if (!ignore.includes('region') && filters.region && filters.region !== 'all' && !item.regions.includes(filters.region)) return false;
    if (!ignore.includes('source') && filters.source !== 'all' && item.sourceId !== filters.source) return false;
    if (!ignore.includes('kind') && filters.kind !== 'all' && item.kind !== filters.kind) return false;
    if (!ignore.includes('quick') && filters.quick) {
      if (filters.quick === 'new' && !item.isNew) return false;
      if (filters.quick === 'soon' && !(item.open && item.days != null && item.days <= 7)) return false;
      if (filters.quick === 'starred' && !item.starred) return false;
    }
    return terms.every((term) => item.searchText.includes(term));
  });
}

const deadlineRank = (item) => (item.open ? (Number.isFinite(item.deadlineMs) ? 0 : 1) : 2);

export function sortItems(items, sort) {
  const list = [...items];
  if (sort === 'deadline') {
    list.sort((a, b) => deadlineRank(a) - deadlineRank(b) || (a.deadlineMs || 0) - (b.deadlineMs || 0) || b.sortDate - a.sortDate);
  } else {
    list.sort((a, b) => b.sortDate - a.sortDate || (Date.parse(b.firstSeen) || 0) - (Date.parse(a.firstSeen) || 0));
  }
  return list;
}

export function countBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    const values = Array.isArray(item[key]) ? item[key] : [item[key]];
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

export function statusLabel(item) {
  if (item.gone && !item.closed) return 'Retirée du site';
  if (item.closed) return 'Clôturée';
  if (item.archived) return 'Archivée';
  return 'En cours';
}

export function toCsv(items, config) {
  const categoryNames = new Map(config.categories.map((category) => [category.id, category.name]));
  const header = ['Titre', 'Acheteur', 'Référence', 'Catégories', 'Territoire', 'Source', 'Type', 'Nature', 'Procédure', 'Lieu', 'Publiée le', 'Date limite', 'Statut', 'Lien'];
  const escape = (value) => {
    const text = String(value ?? '').replace(/\r?\n/g, ' ');
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = items.map((item) => [
    item.title,
    item.buyer,
    item.reference,
    item.categories.map((id) => categoryNames.get(id)).filter(Boolean).join(', '),
    (item.regions || []).map((id) => REGIONS[id]?.label).filter(Boolean).join(', '),
    item.source?.name,
    KIND_LABELS[item.kind] || '',
    item.nature,
    item.procedure,
    item.location || item.buyerLocation,
    item.publishedAt ? formatDate(item.publishedAt, { time: false }) : '',
    item.deadline ? formatDate(item.deadline) : '',
    statusLabel(item),
    item.url,
  ]);
  return `﻿${[header, ...rows].map((row) => row.map(escape).join(';')).join('\r\n')}\r\n`;
}
