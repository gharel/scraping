/**
 * Configuration de la veille : valeurs par défaut, normalisation et validation.
 * Module partagé entre le moteur (Node.js) et l'interface (navigateur) : aucune dépendance.
 */

export const SOURCE_TYPES = {
  atexo: {
    label: 'Portail de marchés publics (Atexo)',
    short: 'Portail Atexo',
    hint: 'marchespublics.nc et les plateformes Atexo : toutes les consultations listées, avec dates limites.',
  },
  rss: {
    label: 'Flux RSS ou Atom',
    short: 'Flux RSS',
    hint: 'Adresse d’un flux d’actualités ou d’avis (souvent /feed ou /rss).',
  },
  page: {
    label: 'Page web',
    short: 'Page web',
    hint: 'Signale les modifications du contenu ou les nouveaux liens d’une page.',
  },
  liste: {
    label: 'Liste d’annonces (sélecteurs CSS)',
    short: 'Liste CSS',
    hint: 'Usage avancé : décrivez la liste d’annonces avec des sélecteurs CSS.',
  },
};

export const CATEGORY_COLOR_COUNT = 8;

/** Natures d'annonces reconnues. */
export const ITEM_KINDS = ['consultation', 'attribution', 'information', 'appel-a-projets', 'annonce', 'modification'];

export const KIND_LABELS = {
  consultation: 'Consultation',
  attribution: 'Attribution',
  information: 'Avis d’information',
  'appel-a-projets': 'Appel à projets',
  annonce: 'Annonce',
  modification: 'Page modifiée',
};

export const DEFAULT_SETTINGS = {
  timezone: 'Pacific/Noumea',
  retentionDays: 180,
  localIntervalMinutes: 60,
  githubAlerts: true,
  alertOnlyMatching: true,
  appUrl: '',
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function slugify(text) {
  return (
    String(text || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'element'
  );
}

export function uniqueId(base, existingIds) {
  const taken = new Set(existingIds);
  const root = slugify(base);
  if (!taken.has(root)) return root;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Devine le type de source le plus probable à partir de son adresse. */
export function guessSourceType(url) {
  const value = String(url || '');
  if (/EntrepriseAdvancedSearch|\/entreprise\/consultation/i.test(value)) return 'atexo';
  if (/(\/feed\/?($|\?)|[/.]rss($|[/?.])|\.xml($|\?)|atom($|[/?.]))/i.test(value)) return 'rss';
  return 'page';
}

export function parseKeywords(text) {
  const list = Array.isArray(text) ? text : String(text || '').split(/[\n,;]+/);
  const seen = new Set();
  const result = [];
  for (const raw of list) {
    const keyword = String(raw).trim().replace(/\s+/g, ' ');
    const key = keyword.toLowerCase();
    if (keyword && !seen.has(key)) {
      seen.add(key);
      result.push(keyword);
    }
  }
  return result;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function cleanOptions(type, options) {
  const source = options && typeof options === 'object' ? options : {};
  const out = {};
  if (type === 'atexo') {
    if (source.maxPages) out.maxPages = clampNumber(source.maxPages, 1, 50, 25);
  } else if (type === 'rss') {
    if (ITEM_KINDS.includes(source.kind)) out.kind = source.kind;
  } else if (type === 'page') {
    if (source.selector) out.selector = String(source.selector).trim();
    const ignore = Array.isArray(source.ignore) ? source.ignore : String(source.ignore || '').split(',');
    const cleanedIgnore = ignore.map((s) => String(s).trim()).filter(Boolean);
    if (cleanedIgnore.length) out.ignore = cleanedIgnore;
    out.detect = source.detect === 'liens' ? 'liens' : 'texte';
  } else if (type === 'liste') {
    out.item = String(source.item || '').trim();
    out.fields = {};
    for (const [key, value] of Object.entries(source.fields || {})) {
      if (value && String(value).trim()) out.fields[key] = String(value).trim();
    }
    if (ITEM_KINDS.includes(source.kind)) out.kind = source.kind;
  }
  return out;
}

export function normalizeSource(raw, index = 0) {
  const type = SOURCE_TYPES[raw?.type] ? raw.type : guessSourceType(raw?.url);
  return {
    id: String(raw?.id || '').trim() || slugify(raw?.name || `source-${index + 1}`),
    name: String(raw?.name || '').trim() || `Source ${index + 1}`,
    url: String(raw?.url || '').trim(),
    type,
    enabled: raw?.enabled !== false,
    categories: Array.isArray(raw?.categories) ? raw.categories.map(String) : [],
    options: cleanOptions(type, raw?.options),
  };
}

export function normalizeCategory(raw, index = 0) {
  return {
    id: String(raw?.id || '').trim() || slugify(raw?.name || `categorie-${index + 1}`),
    name: String(raw?.name || '').trim() || `Catégorie ${index + 1}`,
    color: clampNumber(raw?.color, 1, CATEGORY_COLOR_COUNT, (index % CATEGORY_COLOR_COUNT) + 1),
    keywords: parseKeywords(raw?.keywords || []),
  };
}

export function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const settings = { ...DEFAULT_SETTINGS, ...(input.settings || {}) };
  settings.retentionDays = clampNumber(settings.retentionDays, 7, 3650, DEFAULT_SETTINGS.retentionDays);
  settings.localIntervalMinutes = clampNumber(settings.localIntervalMinutes, 5, 1440, DEFAULT_SETTINGS.localIntervalMinutes);
  settings.githubAlerts = settings.githubAlerts !== false;
  settings.alertOnlyMatching = settings.alertOnlyMatching !== false;
  return {
    settings,
    categories: (Array.isArray(input.categories) ? input.categories : []).map(normalizeCategory),
    sources: (Array.isArray(input.sources) ? input.sources : []).map(normalizeSource),
  };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Renvoie la liste des problèmes de la configuration (vide si tout va bien). */
export function validateConfig(config) {
  const errors = [];
  const categoryIds = new Set();
  config.categories.forEach((category, index) => {
    const label = `Catégorie « ${category.name || index + 1} »`;
    if (!SLUG_RE.test(category.id)) errors.push(`${label} : identifiant invalide (${category.id})`);
    if (categoryIds.has(category.id)) errors.push(`${label} : identifiant déjà utilisé (${category.id})`);
    categoryIds.add(category.id);
    if (!category.name || category.name.length > 40) errors.push(`${label} : le nom doit faire entre 1 et 40 caractères`);
    if (category.keywords.length > 300) errors.push(`${label} : 300 mots-clés au maximum`);
    if (category.keywords.some((keyword) => keyword.length > 80)) errors.push(`${label} : un mot-clé dépasse 80 caractères`);
  });

  const sourceIds = new Set();
  config.sources.forEach((source, index) => {
    const label = `Source « ${source.name || index + 1} »`;
    if (sourceIds.has(source.id)) errors.push(`${label} : identifiant déjà utilisé (${source.id})`);
    sourceIds.add(source.id);
    for (const problem of sourceProblems(source, categoryIds)) errors.push(`${label} : ${problem}`);
  });
  return errors;
}

/** Problèmes propres à une source (sans le libellé de la source). */
export function sourceProblems(source, categoryIds = new Set()) {
  const problems = [];
  if (!SLUG_RE.test(source.id)) problems.push(`identifiant invalide (${source.id})`);
  if (!source.name || source.name.length > 80) problems.push('le nom doit faire entre 1 et 80 caractères');
  if (!isHttpUrl(source.url)) problems.push('l’adresse doit commencer par http:// ou https://');
  if (!SOURCE_TYPES[source.type]) problems.push(`type inconnu (${source.type})`);
  for (const id of source.categories) {
    if (!categoryIds.has(id)) problems.push(`catégorie inconnue (${id})`);
  }
  if (source.type === 'liste') {
    if (!source.options.item) problems.push('le sélecteur des annonces est obligatoire');
    if (!source.options.fields?.title) problems.push('le sélecteur du titre est obligatoire');
  }
  return problems;
}

/** Sérialise la configuration dans l'ordre attendu par le fichier config/veille.json. */
export function serializeConfig(config) {
  return `${JSON.stringify(
    {
      settings: config.settings,
      categories: config.categories,
      sources: config.sources,
    },
    null,
    2,
  )}\n`;
}
