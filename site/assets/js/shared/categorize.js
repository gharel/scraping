/**
 * Classement des annonces par catégories, à partir de mots-clés.
 * Module partagé entre le moteur (alertes) et l'interface (filtres).
 *
 * Règles des mots-clés :
 *  - insensibles aux accents et aux majuscules ;
 *  - mot ou expression entière : « audit » ne trouve pas « auditorium » ;
 *  - une étoile finale élargit aux variantes : « format* » trouve formation, formateur, formations… ;
 *  - un sigle écrit en majuscules (« IA », « ERP ») ne trouve que ce sigle en majuscules.
 * Le classement porte sur l'objet de l'annonce (titre, résumé, référence, nature), pas sur l'acheteur.
 */

/** Retire les accents et uniformise apostrophes et espaces, sans changer la casse. */
export function foldText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')
    .replace(/\s+/g, ' ');
}

export function normalizeText(value) {
  return foldText(value).toLowerCase();
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ACRONYM = /^[A-Z0-9]{2,6}$/;

export function keywordPattern(keyword) {
  const raw = foldText(keyword).trim();
  if (!raw) return null;
  const prefix = raw.endsWith('*');
  const word = raw.replace(/\*+$/, '').trim();
  if (word.length < 2) return null;
  // Sigle en majuscules : recherche sensible à la casse (« IA » ne trouve pas « Ia » ni « ia »).
  if (ACRONYM.test(word) && /[A-Z]/.test(word)) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegExp(word)}${prefix ? '' : '(?![A-Za-z0-9])'}`);
    re.caseSensitive = true;
    return re;
  }
  const body = escapeRegExp(word.toLowerCase()).replace(/ /g, '\\s+').replace(/'/g, "['\\s]?");
  return new RegExp(`(?:^|[^a-z0-9])${body}${prefix ? '' : '(?![a-z0-9])'}`);
}

const compileKeywords = (keywords = []) => keywords.map((keyword) => ({ keyword, re: keywordPattern(keyword) })).filter((entry) => entry.re);

/**
 * Prépare les catégories. Les mots-clés exclus (ex. « travaux ») écartent une annonce
 * de toutes les catégories par mots-clés, ce qui évite les faux positifs.
 */
export function compileCategories(categories = [], excludeKeywords = []) {
  const compiled = categories.map((category) => ({
    id: category.id,
    name: category.name,
    color: category.color,
    patterns: compileKeywords(category.keywords),
  }));
  compiled.exclusions = compileKeywords(excludeKeywords);
  return compiled;
}

/** Textes de l'annonce utilisés pour le classement : en minuscules et avec la casse d'origine. */
export function itemTexts(item) {
  const cased = foldText([item.title, item.summary, item.reference, item.nature, item.procedure, (item.tags || []).join(' ')].filter(Boolean).join(' \n '));
  return { cased, lower: cased.toLowerCase() };
}

export function itemText(item) {
  return itemTexts(item).lower;
}

const matches = (entry, texts) => entry.re.test(entry.re.caseSensitive ? texts.cased : texts.lower);

/** Mots-clés exclus présents dans l'annonce (liste vide si aucun). */
export function exclusionMatches(item, compiled) {
  const texts = itemTexts(item);
  return (compiled.exclusions || []).filter((entry) => matches(entry, texts)).map((entry) => entry.keyword);
}

/**
 * Renvoie les identifiants des catégories d'une annonce : celles imposées par sa source,
 * puis celles dont au moins un mot-clé apparaît dans l'annonce.
 */
export function categorize(item, compiled, forced = []) {
  const result = new Set(forced);
  const texts = itemTexts(item);
  if ((compiled.exclusions || []).some((entry) => matches(entry, texts))) return [...result];
  for (const category of compiled) {
    if (result.has(category.id)) continue;
    if (category.patterns.some((entry) => matches(entry, texts))) result.add(category.id);
  }
  return [...result];
}

/** Mots-clés d'une catégorie trouvés dans l'annonce (pour expliquer un classement). */
export function matchedKeywords(item, compiledCategory) {
  const texts = itemTexts(item);
  return compiledCategory.patterns.filter((entry) => matches(entry, texts)).map((entry) => entry.keyword);
}
