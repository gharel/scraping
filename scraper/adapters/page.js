/**
 * Surveillance d'une page web quelconque.
 *  - mode « texte » : signale chaque modification du contenu (zone choisie ou page entière) ;
 *  - mode « liens » : signale chaque nouveau lien apparu (annonces, documents PDF…).
 * L'état précédent de la page est conservé dans data/snapshots/<source>.json.
 */
import * as cheerio from 'cheerio';
import { absoluteUrl, guessKind, guessReference, hash, oneLine, truncate } from '../lib/text.js';

const BLOCKS = 'p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, tr, table, section, article, header, footer, dd, dt, blockquote, pre, td, th, figcaption';
const NOISE = 'script, style, noscript, template, svg, iframe, canvas, link, meta, [hidden], [aria-hidden="true"]';

function toList(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map((part) => part.trim())
    .filter(Boolean);
}

export function extractPage(html, pageUrl, options = {}) {
  const $ = cheerio.load(html);
  $(NOISE).remove();
  for (const selector of toList(options.ignore)) {
    try {
      $(selector).remove();
    } catch {
      throw new Error(`Sélecteur à ignorer invalide : ${selector}`);
    }
  }

  let zone;
  if (options.selector) {
    let candidates;
    try {
      candidates = $(options.selector);
    } catch {
      throw new Error(`Sélecteur CSS invalide : ${options.selector}`);
    }
    // Premier élément correspondant qui contient du texte (les ancres vides sont ignorées).
    zone = candidates.filter((_, el) => $(el).text().trim().length > 0).first();
    if (!zone.length) zone = candidates.first();
    if (!zone.length) throw new Error(`La zone « ${options.selector} » est introuvable sur la page`);
  } else {
    zone = $('main').length ? $('main') : $('body');
    if (!$('main').length) zone.find('header, footer, nav').remove();
  }

  const links = [];
  const seen = new Set();
  zone.find('a[href]').each((_, a) => {
    const url = absoluteUrl($(a).attr('href'), pageUrl);
    if (!url || seen.has(url) || url.split('#')[0] === pageUrl.split('#')[0]) return;
    seen.add(url);
    links.push({ url, text: oneLine($(a).text() || $(a).attr('title') || '') });
  });

  zone.find('br').replaceWith('\n');
  zone.find(BLOCKS).each((_, el) => {
    $(el).append('\n');
  });
  const lines = [];
  for (const raw of zone.text().split('\n')) {
    const line = oneLine(raw);
    if (line && line !== lines[lines.length - 1]) lines.push(line);
  }
  return { lines: lines.slice(0, 3000), links: links.slice(0, 1500) };
}

function describeChanges(before, after) {
  const previous = new Set(before);
  const current = new Set(after);
  const added = after.filter((line) => !previous.has(line));
  const removed = before.filter((line) => !current.has(line));
  const parts = [];
  if (added.length) parts.push(`Ajouté :\n${added.slice(0, 8).map((line) => `• ${truncate(line, 220)}`).join('\n')}${added.length > 8 ? `\n… et ${added.length - 8} autre(s) ligne(s)` : ''}`);
  if (removed.length) parts.push(`Retiré :\n${removed.slice(0, 5).map((line) => `• ${truncate(line, 220)}`).join('\n')}${removed.length > 5 ? `\n… et ${removed.length - 5} autre(s) ligne(s)` : ''}`);
  return { added, removed, summary: parts.join('\n\n') };
}

export default {
  id: 'page',
  listing: false,
  async fetch(source, { http, snapshot, now }) {
    const options = source.options || {};
    const mode = options.detect === 'liens' ? 'liens' : 'texte';
    const response = await http.get(source.url);
    const page = extractPage(response.text, response.url, options);
    if (!page.lines.length && !page.links.length) throw new Error('La page est vide ou son contenu est chargé par JavaScript');

    const contentHash = hash(page.lines.join('\n'));
    // Changer la zone surveillée ou le mode repart d'un nouvel état de référence, sans fausse alerte.
    const optionsKey = hash(JSON.stringify([source.url, options.selector || '', options.ignore || [], mode]));
    // Pas d'horodatage ici : le fichier ne change que si la page change (pas de commit inutile).
    const nextSnapshot = { hash: contentHash, optionsKey, mode, lines: page.lines, links: page.links };
    const comparable = Boolean(snapshot && snapshot.optionsKey === optionsKey);
    const items = [];

    if (comparable) {
      if (mode === 'liens') {
        const known = new Set((snapshot.links || []).map((link) => link.url));
        for (const link of page.links) {
          if (known.has(link.url)) continue;
          const title = link.text || decodeURIComponent(new URL(link.url).pathname.split('/').pop() || link.url);
          items.push({
            key: hash(link.url),
            kind: guessKind(title),
            title,
            url: link.url,
            reference: guessReference(title),
            summary: `Nouveau lien repéré sur ${source.name}`,
            publishedAt: now.toISOString(),
          });
        }
      } else if (snapshot.hash !== contentHash) {
        const changes = describeChanges(snapshot.lines || [], page.lines);
        if (changes.added.length || changes.removed.length) {
          items.push({
            key: `modif-${contentHash}`,
            kind: 'modification',
            title: `${source.name} : la page a changé`,
            url: response.url,
            summary: changes.summary,
            publishedAt: now.toISOString(),
          });
        }
      }
    }

    return { items, snapshot: nextSnapshot, meta: { total: mode === 'liens' ? page.links.length : page.lines.length, firstCheck: !comparable } };
  },
};
