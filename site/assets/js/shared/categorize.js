/**
 * Classement des annonces par catégories, à partir de mots-clés.
 * Module partagé entre le moteur (alertes) et l'interface (filtres).
 *
 * Règles des mots-clés :
 *  - insensibles aux accents et aux majuscules ;
 *  - mot ou expression entière : « audit » ne trouve pas « auditorium » ;
 *  - une étoile finale élargit aux variantes : « format* » trouve formation, formateur, formations…
 */

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/\s+/g, ' ');
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function keywordPattern(keyword) {
  let text = normalizeText(keyword).trim();
  if (!text) return null;
  const prefix = text.endsWith('*');
  text = text.replace(/\*+$/, '').trim();
  if (text.length < 2) return null;
  const body = escapeRegExp(text).replace(/ /g, '\\s+').replace(/'/g, "['\\s]?");
  return new RegExp(`(?:^|[^a-z0-9])${body}${prefix ? '' : '(?![a-z0-9])'}`);
}

export function compileCategories(categories = []) {
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    color: category.color,
    patterns: (category.keywords || []).map((keyword) => ({ keyword, re: keywordPattern(keyword) })).filter((entry) => entry.re),
  }));
}

export function itemText(item) {
  return normalizeText(
    [item.title, item.summary, item.buyer, item.reference, item.nature, item.procedure, (item.tags || []).join(' ')]
      .filter(Boolean)
      .join(' \n '),
  );
}

/**
 * Renvoie les identifiants des catégories d'une annonce : celles imposées par sa source,
 * puis celles dont au moins un mot-clé apparaît dans l'annonce.
 */
export function categorize(item, compiled, forced = []) {
  const result = new Set(forced);
  const text = itemText(item);
  for (const category of compiled) {
    if (result.has(category.id)) continue;
    if (category.patterns.some((entry) => entry.re.test(text))) result.add(category.id);
  }
  return [...result];
}

/** Mots-clés d'une catégorie trouvés dans l'annonce (pour expliquer un classement). */
export function matchedKeywords(item, compiledCategory) {
  const text = itemText(item);
  return compiledCategory.patterns.filter((entry) => entry.re.test(text)).map((entry) => entry.keyword);
}
