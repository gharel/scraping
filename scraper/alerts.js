/**
 * Alerte de nouveautés : un ticket GitHub (issue) par passage, qui déclenche un e-mail de GitHub.
 */
import { categorize, compileCategories } from '../site/assets/js/shared/categorize.js';

const escapeMd = (value) => String(value || '').replace(/([\\`*_[\]<>|#])/g, '\\$1');

function formatDate(iso, timezone, withTime) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const options = { timeZone: timezone, day: 'numeric', month: 'long', year: 'numeric' };
  if (withTime) Object.assign(options, { hour: '2-digit', minute: '2-digit' });
  return new Intl.DateTimeFormat('fr-FR', options).format(date).replace(':', ' h ');
}

function hasTime(iso) {
  return !/T00:00:00(\.000)?(Z|\+11:00)$/.test(iso || '');
}

export function buildAlert({ added, config, appUrl = '' }) {
  if (!added?.length || !config.settings.githubAlerts) return null;
  const compiled = compileCategories(config.categories, config.settings.excludeKeywords);
  const sources = new Map(config.sources.map((source) => [source.id, source]));
  const categoryNames = new Map(config.categories.map((category) => [category.id, category.name]));
  const timezone = config.settings.timezone;

  const entries = added.map((item) => ({ item, categories: categorize(item, compiled, sources.get(item.sourceId)?.categories || []) }));
  const relevant = config.settings.alertOnlyMatching && config.categories.length ? entries.filter((entry) => entry.categories.length) : entries;
  if (!relevant.length) return null;

  const groups = new Map();
  for (const entry of relevant) {
    const key = entry.categories[0] || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const ordered = [...groups.keys()].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return config.categories.findIndex((c) => c.id === a) - config.categories.findIndex((c) => c.id === b);
  });

  const count = relevant.length;
  const names = ordered.filter(Boolean).map((id) => categoryNames.get(id));
  const title = `${count} nouvelle${count > 1 ? 's' : ''} annonce${count > 1 ? 's' : ''}${names.length ? ` : ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}` : ''}`;

  const lines = [];
  for (const key of ordered) {
    lines.push(`### ${key ? escapeMd(categoryNames.get(key)) : 'Autres annonces'}`, '');
    for (const { item, categories } of groups.get(key)) {
      const source = sources.get(item.sourceId);
      const link = item.url ? `[${escapeMd(item.title)}](${item.url})` : escapeMd(item.title);
      lines.push(`- **${link}**`);
      const details = [
        item.buyer && escapeMd(item.buyer),
        item.reference && `Réf. ${escapeMd(item.reference)}`,
        source && escapeMd(source.name),
      ].filter(Boolean);
      if (details.length) lines.push(`  ${details.join(' · ')}`);
      if (item.deadline) lines.push(`  ⏳ Date limite : **${formatDate(item.deadline, timezone, hasTime(item.deadline))}**`);
      const others = categories.slice(1).map((id) => categoryNames.get(id)).filter(Boolean);
      if (others.length) lines.push(`  Aussi dans : ${others.map(escapeMd).join(', ')}`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push(
    `${appUrl ? `[Ouvrir Vigie](${appUrl}) · ` : ''}Alerte envoyée automatiquement par la veille. Pour ne plus la recevoir, désactivez « Alertes par e-mail » dans les réglages de Vigie.`,
  );
  return { title: `Vigie · ${title}`, body: lines.join('\n') };
}
