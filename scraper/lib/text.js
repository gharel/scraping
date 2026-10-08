import { createHash } from 'node:crypto';

/** Nettoie un texte en conservant les sauts de ligne significatifs. */
export function cleanText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/ | /g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Nettoie un texte et le ramène sur une seule ligne. */
export function oneLine(value) {
  return cleanText(value).replace(/\s*\n\s*/g, ' ');
}

export function hash(value, length = 16) {
  return createHash('sha1').update(String(value)).digest('hex').slice(0, length);
}

export function slugify(value) {
  return (
    oneLine(value)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'source'
  );
}

/** Résout une URL relative ; renvoie '' si l'URL n'est pas en http(s). */
export function absoluteUrl(href, base) {
  if (!href) return '';
  try {
    const url = new URL(String(href).trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function truncate(value, max) {
  const text = oneLine(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/** Extrait une référence du type « n° DAEM-AO-12-26 » d'un titre d'avis. */
export function guessReference(text) {
  const match = oneLine(text).match(/\bn\s*[°ºo]\s*([A-Z0-9][A-Z0-9_./-]{2,})/i);
  return match ? match[1].replace(/[.-]+$/, '') : '';
}

/** Devine la nature d'une annonce à partir de son titre. */
export function guessKind(text) {
  const normalized = oneLine(text).toLowerCase();
  if (/\battribution|\battribu[ée]s?\b|\bawarded\b/.test(normalized)) return 'attribution';
  if (/appel (public )?(a|à) concurrence|appel d.offres?|avis d.appel|consultation|\brfp\b|\brfq\b|\beoi\b|request for (proposal|quotation|tender)|tender/.test(normalized)) return 'consultation';
  if (/appel (a|à) projets?|appel (a|à) candidatures?/.test(normalized)) return 'appel-a-projets';
  return 'annonce';
}
