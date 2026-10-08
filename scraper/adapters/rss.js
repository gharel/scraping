/**
 * Flux RSS 2.0 et Atom.
 */
import * as cheerio from 'cheerio';
import { absoluteUrl, cleanText, guessKind, guessReference, hash, oneLine } from '../lib/text.js';
import { findDeadline, parseDate } from '../lib/dates.js';

function childText($, node, names) {
  for (const name of names) {
    const child = node.children().filter((_, el) => el.tagName?.toLowerCase() === name).first();
    if (child.length && child.text().trim()) return child.text();
  }
  return '';
}

function htmlToText(value) {
  if (!value) return '';
  if (!/[<&]/.test(value)) return cleanText(value);
  const $ = cheerio.load(value);
  $('br').replaceWith('\n');
  $('p, div, li, h1, h2, h3, h4, tr').each((_, el) => {
    $(el).append('\n');
  });
  return cleanText($.root().text());
}

export function parseFeed(xml, feedUrl, options = {}) {
  const $ = cheerio.load(xml, { xml: true });
  const entries = $('item').length ? $('item') : $('entry');
  const rootName = ($.root().children().filter((_, el) => el.type === 'tag').first()[0]?.tagName || '').toLowerCase();
  if (!entries.length && !['rss', 'feed', 'rdf:rdf'].includes(rootName)) {
    throw new Error("Ce n'est pas un flux RSS ou Atom valide");
  }
  const items = [];
  entries.each((_, element) => {
    const node = $(element);
    const title = oneLine(htmlToText(childText($, node, ['title'])));
    let link = oneLine(childText($, node, ['link']));
    if (!link) {
      const atomLink =
        node.children('link[rel="alternate"]').first().attr('href') || node.children('link').first().attr('href');
      link = atomLink || '';
    }
    const url = absoluteUrl(link, feedUrl);
    const guid = oneLine(childText($, node, ['guid', 'id']));
    const summary = htmlToText(childText($, node, ['description', 'summary', 'content:encoded', 'content']));
    const dateText = childText($, node, ['pubdate', 'published', 'updated', 'dc:date']);
    const categories = node
      .children()
      .filter((__, el) => el.tagName?.toLowerCase() === 'category')
      .map((__, el) => oneLine($(el).text() || $(el).attr('term') || ''))
      .get()
      .filter(Boolean);
    if (!title && !url) return;
    const fullText = `${title}\n${summary}`;
    items.push({
      key: hash(guid || url || title),
      kind: options.kind || guessKind(`${title} ${url}`),
      title: title || url,
      url,
      reference: guessReference(title),
      summary,
      tags: categories,
      publishedAt: parseDate(dateText),
      deadline: findDeadline(fullText),
    });
  });
  return items;
}

export default {
  id: 'rss',
  // Un flux ne montre que les derniers articles : une annonce qui en sort n'est pas « retirée ».
  listing: false,
  async fetch(source, { http }) {
    const response = await http.get(source.url);
    const items = parseFeed(response.text, response.url, source.options || {});
    return { items, meta: { total: items.length } };
  },
};
