/**
 * Liste d'annonces décrite par des sélecteurs CSS.
 * Chaque champ accepte « sélecteur » (texte de l'élément) ou « sélecteur@attribut ».
 * Un sélecteur vide (« @href ») désigne l'élément de la liste lui-même.
 */
import * as cheerio from 'cheerio';
import { absoluteUrl, cleanText, guessKind, guessReference, hash, oneLine } from '../lib/text.js';
import { findDeadline, parseDate } from '../lib/dates.js';

const FIELDS = ['title', 'url', 'reference', 'summary', 'buyer', 'location', 'nature', 'status', 'publishedAt', 'deadline'];

export function splitSpec(spec) {
  const value = String(spec || '').trim();
  const at = value.lastIndexOf('@');
  if (at >= 0 && /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(value.slice(at + 1))) {
    return { selector: value.slice(0, at).trim(), attr: value.slice(at + 1) };
  }
  return { selector: value, attr: '' };
}

function pick($, element, spec) {
  if (!spec) return '';
  const { selector, attr } = splitSpec(spec);
  let node;
  try {
    node = selector ? $(element).find(selector).first() : $(element);
  } catch {
    throw new Error(`Sélecteur CSS invalide : ${selector}`);
  }
  if (!node.length) return '';
  if (attr) return node.attr(attr) ?? '';
  const clone = node.clone();
  clone.find('br').replaceWith('\n');
  return clone.text();
}

export function parseList(html, pageUrl, options = {}) {
  const $ = cheerio.load(html);
  const fields = options.fields || {};
  if (!options.item) throw new Error('Le sélecteur des annonces (« item ») est obligatoire');
  if (!fields.title) throw new Error('Le sélecteur du titre est obligatoire');
  let elements;
  try {
    elements = $(options.item);
  } catch {
    throw new Error(`Sélecteur CSS invalide : ${options.item}`);
  }
  const items = [];
  elements.each((_, element) => {
    const raw = Object.fromEntries(FIELDS.map((field) => [field, pick($, element, fields[field])]));
    const title = oneLine(raw.title);
    if (!title) return;
    const url = absoluteUrl(raw.url || $(element).find('a[href]').first().attr('href'), pageUrl);
    const summary = cleanText(raw.summary);
    const reference = oneLine(raw.reference) || guessReference(title);
    items.push({
      key: hash(url && url !== pageUrl ? url : reference || title),
      kind: options.kind || guessKind(title),
      title,
      url: url || pageUrl,
      reference,
      summary,
      buyer: oneLine(raw.buyer),
      location: oneLine(raw.location),
      nature: oneLine(raw.nature),
      status: oneLine(raw.status),
      publishedAt: parseDate(raw.publishedAt),
      deadline: parseDate(raw.deadline) || findDeadline(`${title}\n${summary}`),
    });
  });
  return items;
}

export default {
  id: 'liste',
  listing: true,
  async fetch(source, { http }) {
    const response = await http.get(source.url);
    const items = parseList(response.text, response.url, source.options || {});
    if (!items.length) {
      throw new Error('Aucune annonce trouvée avec ces sélecteurs : la page a peut-être changé de structure');
    }
    return { items, meta: { total: items.length } };
  },
};
