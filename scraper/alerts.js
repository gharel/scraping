/**
 * Récapitulatif quotidien par e-mail.
 * Chaque passage met en file les nouvelles annonces de vos catégories (data/alert-queue.json) ;
 * le premier passage à partir de l'heure choisie (17 h par défaut, heure de Nouméa) prépare
 * un seul e-mail HTML qui les regroupe, envoyé ensuite par scripts/send-digest.js.
 */
import { categorize, compileCategories } from '../site/assets/js/shared/categorize.js';

/** Couleurs des catégories (site/assets/css/tokens.css, thème clair). */
const CATEGORY_COLORS = {
  1: ['#50967c', '#e8f5f0', '#356b56'],
  2: ['#5699c5', '#ddeef8', '#2f6690'],
  3: ['#a07bd4', '#ede5f9', '#6f4ca6'],
  4: ['#e3764c', '#fbe9e0', '#a8441f'],
  5: ['#e78da5', '#fce8ee', '#a33f58'],
  6: ['#eacb60', '#fdf6da', '#7a5d0a'],
  7: ['#5daba0', '#dcf0ee', '#2c6e66'],
  8: ['#6c757d', '#f1f3f5', '#495057'],
};
const OTHER_COLOR = CATEGORY_COLORS[8];

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || ''));

/* ── Dates (heure locale de la veille) ───────────────────────────── */

/** Jour local au format AAAA-MM-JJ. */
export function localDay(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function localHour(date, timezone) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(date));
}

function hasTime(iso) {
  return !/T00:00:00(\.000)?(Z|\+11:00)$/.test(iso || '');
}

function formatDate(iso, timezone, { withTime = hasTime(iso), weekday = false } = {}) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  const options = { timeZone: timezone, day: 'numeric', month: 'long', year: 'numeric' };
  if (weekday) options.weekday = 'long';
  if (withTime) Object.assign(options, { hour: '2-digit', minute: '2-digit' });
  return new Intl.DateTimeFormat('fr-FR', options).format(date).replace(':', ' h ');
}

/** Jours restants avant la date limite, en jours calendaires locaux. */
function daysLeft(iso, now, timezone) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return null;
  const day = (value) => Date.parse(`${localDay(value, timezone)}T00:00:00Z`);
  return Math.round((day(date) - day(now)) / 86_400_000);
}

/* ── Sélection et regroupement ───────────────────────────────────── */

/** Annonces qui méritent une alerte, avec leurs catégories, selon les règles de la veille. */
export function selectRelevant(items, config) {
  const compiled = compileCategories(config.categories, config.settings.excludeKeywords);
  const sources = new Map(config.sources.map((source) => [source.id, source]));
  const entries = items.map((item) => ({ item, categories: categorize(item, compiled, sources.get(item.sourceId)?.categories || []) }));
  return config.settings.alertOnlyMatching && config.categories.length ? entries.filter((entry) => entry.categories.length) : entries;
}

/** Regroupe par première catégorie, dans l'ordre des catégories ; les annonces non classées à la fin. */
function groupEntries(entries, config) {
  const order = new Map(config.categories.map((category, index) => [category.id, index]));
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.categories[0] || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a ? order.get(a) ?? 999 : 1000) - (b ? order.get(b) ?? 999 : 1000))
    .map(([id, list]) => ({ category: config.categories.find((category) => category.id === id) || null, entries: list }));
}

/* ── File d'attente ──────────────────────────────────────────────── */

export function normalizeQueue(raw) {
  const items = Array.isArray(raw?.items) ? raw.items.filter((entry) => entry && typeof entry.id === 'string') : [];
  return { lastDigest: typeof raw?.lastDigest === 'string' ? raw.lastDigest : null, items };
}

/** Ajoute à la file les nouvelles annonces pertinentes (sans doublon). */
export function enqueue(queue, added, config, now = new Date()) {
  const next = normalizeQueue(queue);
  if (!added?.length || !config.settings.githubAlerts) return next;
  const known = new Set(next.items.map((entry) => entry.id));
  for (const { item } of selectRelevant(added, config)) {
    if (known.has(item.id)) continue;
    known.add(item.id);
    next.items.push({ id: item.id, queuedAt: now.toISOString() });
  }
  return next;
}

/** Le récapitulatif part au premier passage à partir de l'heure choisie, une fois par jour. */
export function isDigestDue(queue, now, settings, { force = false } = {}) {
  if (!settings.githubAlerts) return false;
  if (force) return true;
  const today = localDay(now, settings.timezone);
  if (queue.lastDigest === today) return false;
  return localHour(now, settings.timezone) >= settings.digestHour;
}

/* ── E-mail ──────────────────────────────────────────────────────── */

function plural(count, singular, pluralForm = `${singular}s`) {
  return count > 1 ? pluralForm : singular;
}

function pill(text, [, soft, ink]) {
  return `<span style="display:inline-block;margin:0 4px 4px 0;padding:2px 8px;border-radius:999px;background:${soft};color:${ink};font-size:12px;line-height:18px;font-weight:600;">${escapeHtml(text)}</span>`;
}

function deadlineHtml(item, now, timezone) {
  if (!item.deadline) return '';
  const left = daysLeft(item.deadline, now, timezone);
  const urgent = left != null && left >= 0 && left <= 7;
  const when = left == null || left < 0 ? '' : left === 0 ? ' (aujourd’hui)' : left === 1 ? ' (demain)' : ` (dans ${left} jours)`;
  const color = urgent ? '#a8441f' : '#4a4a4a';
  return `<p class="${urgent ? 'v-urgent' : 'v-text'}" style="margin:6px 0 0;font-size:14px;line-height:20px;color:${color};">Date limite : <strong>${escapeHtml(formatDate(item.deadline, timezone))}</strong>${escapeHtml(when)}</p>`;
}

function itemHtml({ item, categories }, { accent, sources, categoryById, now, timezone }) {
  const source = sources.get(item.sourceId);
  const title = escapeHtml(item.title || 'Annonce sans titre');
  const heading = isHttpUrl(item.url)
    ? `<a href="${escapeHtml(item.url)}" class="v-link" style="color:#2f5f4c;text-decoration:none;">${title}</a>`
    : title;
  const details = [item.buyer, item.reference && `Réf. ${item.reference}`, source?.name].filter(Boolean).map(escapeHtml).join(' · ');
  const others = categories
    .slice(1)
    .map((id) => categoryById.get(id))
    .filter(Boolean)
    .map((category) => pill(category.name, CATEGORY_COLORS[category.color] || OTHER_COLOR))
    .join('');
  return `
<tr><td style="padding:0 0 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="v-item" style="background:#ffffff;border:1px solid #e3e7e5;border-left:4px solid ${accent};border-radius:8px;">
    <tr><td style="padding:14px 16px;">
      <p class="v-strong" style="margin:0;font-size:16px;line-height:22px;font-weight:700;color:#2f2f2f;">${heading}</p>
      ${details ? `<p class="v-muted" style="margin:4px 0 0;font-size:13px;line-height:19px;color:#6c757d;">${details}</p>` : ''}
      ${deadlineHtml(item, now, timezone)}
      ${others ? `<p style="margin:8px 0 0;font-size:12px;line-height:18px;"><span class="v-muted" style="color:#6c757d;margin-right:4px;">Aussi dans</span>${others}</p>` : ''}
    </td></tr>
  </table>
</td></tr>`;
}

function renderHtml({ groups, count, dayLabel, appUrl, config, now }) {
  const timezone = config.settings.timezone;
  const sources = new Map(config.sources.map((source) => [source.id, source]));
  const categoryById = new Map(config.categories.map((category) => [category.id, category]));
  const heading = `${count} ${plural(count, 'nouvelle annonce', 'nouvelles annonces')}`;
  const preheader = groups
    .map(({ category, entries }) => `${category ? category.name : 'Autres'} (${entries.length})`)
    .join(' · ');

  const sections = groups
    .map(({ category, entries }) => {
      const colors = category ? CATEGORY_COLORS[category.color] || OTHER_COLOR : OTHER_COLOR;
      const name = category ? category.name : 'Autres annonces';
      const rows = entries.map((entry) => itemHtml(entry, { accent: colors[0], sources, categoryById, now, timezone })).join('');
      return `
<tr><td style="padding:12px 0 10px;">
  <p class="v-strong" style="margin:0;font-size:13px;line-height:18px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${colors[2]};">
    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colors[0]};margin-right:8px;vertical-align:0;"></span>${escapeHtml(name)} <span class="v-muted" style="color:#6c757d;font-weight:600;">· ${entries.length}</span>
  </p>
</td></tr>${rows}`;
    })
    .join('');

  const button = isHttpUrl(appUrl)
    ? `<tr><td align="center" style="padding:12px 0 4px;">
  <a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#3d7a62;color:#ffffff;font-size:15px;line-height:20px;font-weight:700;text-decoration:none;">Ouvrir Vigie</a>
</td></tr>`
    : '';

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(heading)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .v-body { background:#16191a !important; }
    .v-card, .v-item { background:#212526 !important; border-color:#343a3c !important; }
    .v-strong { color:#f1f3f2 !important; }
    .v-text { color:#d6dad8 !important; }
    .v-urgent { color:#f4ae92 !important; }
    .v-muted { color:#a7afab !important; }
    .v-link { color:#93d3b8 !important; }
    .v-brand { color:#6db898 !important; }
  }
  @media (max-width: 480px) {
    .v-pad { padding-left:16px !important; padding-right:16px !important; }
  }
</style>
</head>
<body class="v-body" style="margin:0;padding:0;background:#f2f5f4;font-family:Georama,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="v-body" style="background:#f2f5f4;">
<tr><td align="center" class="v-pad" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
    <tr><td style="padding:0 4px 14px;">
      <p class="v-brand" style="margin:0;font-size:14px;line-height:20px;font-weight:700;color:#3d7a62;">Vigie <span class="v-muted" style="font-weight:400;color:#6c757d;">· veille des appels d’offres</span></p>
    </td></tr>
    <tr><td class="v-card v-pad" style="background:#ffffff;border:1px solid #e3e7e5;border-radius:12px;padding:24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:0 0 4px;">
          <h1 class="v-strong" style="margin:0;font-size:24px;line-height:30px;font-weight:700;color:#2f2f2f;">${escapeHtml(heading)}</h1>
          <p class="v-muted" style="margin:6px 0 8px;font-size:14px;line-height:20px;color:#6c757d;">Dans vos catégories, repérées depuis le dernier récapitulatif · ${escapeHtml(dayLabel)}</p>
        </td></tr>
        ${sections}
        ${button}
      </table>
    </td></tr>
    <tr><td class="v-pad" style="padding:16px 8px 0;">
      <p class="v-muted" style="margin:0;font-size:12px;line-height:18px;color:#6c757d;text-align:center;">Récapitulatif envoyé chaque jour à ${config.settings.digestHour} h par la veille Vigie. Pour ne plus le recevoir, désactivez « Récapitulatif quotidien par e-mail » dans les réglages.</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

function renderText({ groups, count, dayLabel, appUrl, config }) {
  const timezone = config.settings.timezone;
  const sources = new Map(config.sources.map((source) => [source.id, source]));
  const lines = [`${count} ${plural(count, 'nouvelle annonce', 'nouvelles annonces')} dans vos catégories (${dayLabel})`, ''];
  for (const { category, entries } of groups) {
    lines.push(`== ${category ? category.name : 'Autres annonces'} ==`, '');
    for (const { item } of entries) {
      lines.push(`* ${item.title || 'Annonce sans titre'}`);
      const details = [item.buyer, item.reference && `Réf. ${item.reference}`, sources.get(item.sourceId)?.name].filter(Boolean);
      if (details.length) lines.push(`  ${details.join(' · ')}`);
      if (item.deadline) lines.push(`  Date limite : ${formatDate(item.deadline, timezone)}`);
      if (isHttpUrl(item.url)) lines.push(`  ${item.url}`);
      lines.push('');
    }
  }
  if (isHttpUrl(appUrl)) lines.push(`Ouvrir Vigie : ${appUrl}`);
  return lines.join('\n');
}

/**
 * Prépare le récapitulatif à partir de la file : les annonces sont relues dans items.json
 * (informations à jour) et refiltrées avec les règles actuelles.
 * Renvoie null s'il ne reste rien à signaler ; `ids` liste toutes les entrées traitées de la file.
 */
export function buildDigest({ queue, items, config, appUrl = '', now = new Date() }) {
  const ids = normalizeQueue(queue).items.map((entry) => entry.id);
  const byId = new Map(items.map((item) => [item.id, item]));
  const queued = ids.map((id) => byId.get(id)).filter(Boolean);
  const relevant = selectRelevant(queued, config);
  const date = localDay(now, config.settings.timezone);
  if (!relevant.length) return { date, ids, subject: null, html: null, text: null };

  const groups = groupEntries(relevant, config);
  const count = relevant.length;
  const names = groups.filter((group) => group.category).map((group) => group.category.name);
  const subject = `Vigie · ${count} ${plural(count, 'nouvelle annonce', 'nouvelles annonces')}${names.length ? ` : ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}` : ''}`;
  const dayLabel = formatDate(now.toISOString(), config.settings.timezone, { withTime: false, weekday: true });
  const view = { groups, count, dayLabel, appUrl, config, now };
  return { date, ids, subject, html: renderHtml(view), text: renderText(view) };
}
