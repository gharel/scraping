/**
 * Surveillance d'une page web quelconque.
 *  - mode « liens » : chaque lien de la zone surveillée est une annonce (avis, dossier PDF…).
 *    Le titre vient du lien ou, s'il est générique (« Télécharger »), du texte qui l'entoure.
 *    Les liens apparus depuis le passage précédent sont des nouveautés ; ceux qui disparaissent sont retirés.
 *  - mode « texte » : signale chaque modification du contenu (zone choisie ou page entière),
 *    à partir de l'état précédent conservé dans data/snapshots/<source>.json.
 */
import * as cheerio from 'cheerio';
import { absoluteUrl, guessKind, guessReference, hash, oneLine, truncate } from '../lib/text.js';
import { findDeadline, findPublished, parseDate } from '../lib/dates.js';

const BLOCKS = 'p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, tr, table, section, article, header, footer, dd, dt, blockquote, pre, td, th, figcaption';
const NOISE = 'script, style, noscript, template, svg, iframe, canvas, link, meta, [hidden], [aria-hidden="true"]';
const CONTEXT = 'li, tr, article, dd, td, p, h1, h2, h3, h4, h5, section, div, .views-row, .item';
const GENERIC_LINK =
  /^(t[ée]l[ée]charger.*|voir( plus| le d[ée]tail| l['’]avis| l['’]annonce| l['’]offre| le document)?|lire( la suite)?|en savoir plus|plus d'infos?|cliqu(ez|er) ici\.?|ici\.?|pdf|docx?|consulter.*|acc[ée]der.*|d[ée]tails?|fichiers?.*|documents?|lien|download|read more|more|view|ouvrir|avis|dce|dossier de consultation)$/i;
// Mention de fichier des sites de l'État : « PDF - 0,32 Mb - 07/07/2026 » (la date est celle de la publication).
const FILE_META = /\b(?:PDF|DOCX?|XLSX?|ZIP|ODT|ODS)\s*[-–]\s*[\d.,]+\s*[KMG]?[bBoO]\b(?:\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{4}))?/;
// Lien qui ne nomme que le type de document (« l'avis d'appel d'offre ») : le nom du fichier est plus parlant.
const DOCUMENT_ONLY = /^(l['’]\s*|le |la |les )?(avis|r[èe]glement|cahier|dossier|annexe|cc[a-z]{0,2}p|cdc|rc|dce|bordereau|bpu|dqe|lettre)\b/i;
const HEADINGS = 'h1, h2, h3, h4, h5, h6';
// Intertitre d'un avis : « Avis de marché : Entretien des espaces verts… » (le type, puis l'objet).
const NOTICE_HEADING = /^(avis|appels?|consultation|march[ée]s?|aapc|aao|mapa|rfq|rfp|rft|eoi|request|tender|invitation)\b[^:–—]{0,80}?\s*[:–—]\s*(\S.{9,})$/iu;

function toList(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map((part) => part.trim())
    .filter(Boolean);
}

function toRegExp(value, label) {
  if (!value) return null;
  try {
    return new RegExp(value, 'i');
  } catch {
    throw new Error(`Filtre « ${label} » invalide : ${value}`);
  }
}

function fileLabel(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    return oneLine(
      name
        .replace(/\.[a-z0-9]{2,5}$/i, '')
        .replace(/[-_+]+/g, ' ')
        // Numéros de classement en tête (« 1138 00 AAO MOE… ») et apostrophes perdues (« dappel doffres »).
        .replace(/^(?:\d{1,4}\s+)+(?=\p{L})/u, '')
        .replace(/\b([dl])(?=(?:appels?|offres?|attributions?|avis|ouvrages?)\b)/gi, '$1’'),
    );
  } catch {
    return '';
  }
}

/** Texte d'un nœud avec une espace entre éléments (évite « 16/11/202607/10/2026 »). */
function spacedText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.data;
  if (!node.children) return '';
  return node.children.map(spacedText).join(' ');
}

/** Texte du bloc qui entoure le lien (ligne de tableau, élément de liste, paragraphe…). */
function contextOf($, link) {
  let node = $(link).parent();
  for (let depth = 0; depth < 7 && node.length && !node.is('body, main'); depth += 1) {
    if (node.is(CONTEXT)) {
      const text = oneLine(spacedText(node[0]));
      if (text.length > 700) break;
      if (text.length >= 20) return text;
    }
    node = node.parent();
  }
  // Bloc d'avis : titre placé juste avant le bloc du lien.
  const heading = $(link).closest(CONTEXT).prevAll('h2, h3, h4, h5, strong, p').first();
  return heading.length ? oneLine(heading.text()).slice(0, 300) : '';
}

/**
 * Avis rédigé sous un intertitre (« Avis de marché : … », paragraphes, puis lien de téléchargement) :
 * renvoie l'intertitre et le texte qui le suit jusqu'au lien.
 */
function sectionOf($, link, zone) {
  let node = $(link);
  for (let depth = 0; depth < 4 && node.length && !node.is(zone) && !node.is('body, main'); depth += 1) {
    const between = [];
    let sibling = node.prev();
    for (let count = 0; sibling.length && count < 15; count += 1, sibling = sibling.prev()) {
      const text = oneLine(spacedText(sibling[0]));
      if (sibling.is(HEADINGS) && text.length >= 6) {
        const match = text.match(NOTICE_HEADING);
        return match ? { heading: text, object: match[2], text: [text, ...between].join(' ').slice(0, 900) } : null;
      }
      if (text) between.unshift(text);
    }
    node = node.parent();
  }
  return null;
}

/** Date lisible dans l'adresse d'un document : « /2026/09/ », « /2026-10/ », « …-08-10-2026-… ». */
function dateFromUrl(url) {
  const path = (() => {
    try {
      return decodeURIComponent(new URL(url).pathname);
    } catch {
      return '';
    }
  })();
  const day = path.match(/(?:^|[^\d])(\d{2})-(\d{2})-(20\d{2})(?:[^\d]|$)/);
  if (day) return parseDate(`${day[1]}/${day[2]}/${day[3]}`);
  const month = path.match(/(?:^|[^\d])(20\d{2})[/-](0[1-9]|1[0-2])(?:[/-]|$)/);
  return month ? parseDate(`${month[1]}-${month[2]}-01`) : null;
}

/** Année antérieure citée dans le titre (« marchés FER 2022 et 2023 ») : l'avis n'est pas récent. */
function pastYear(text, now) {
  const years = (String(text).match(/(?:^|[^\d])(20\d{2})(?=[^\d]|$)/g) || []).map((match) => Number(match.replace(/\D/g, '')));
  const latest = Math.max(0, ...years);
  // Prudence : seule une année d'au moins deux ans d'écart compte (« Audit des comptes 2025 » peut être actuel).
  return latest && latest < now.getFullYear() - 1 ? parseDate(`${latest}-01-01`) : null;
}

function cleanTitle(text) {
  return oneLine(text)
    .replace(new RegExp(FILE_META.source, 'g'), ' ')
    .replace(/_+/g, ' ')
    .replace(/^(file|fichier|document|pdf|t[ée]l[ée]charger)\s+/i, '')
    // Les dates qui suivent l'objet (« - Date de remise de l'offre 16/11/2026… ») ne font pas partie du titre.
    .replace(/\s+[-–—]?\s*(date (de remise|limite)|remise des offres|jusqu['’]au|cl[ôo]ture)\b.*$/i, '')
    .replace(/\b(t[ée]l[ée]charger|lire la suite|en savoir plus|voir le d[ée]tail|voir l['’]annonce|fichiers constituants le pr[ée]sent avis)\b\s*[>›»]?/gi, ' ')
    .replace(/\(\s*(pdf|docx?|xlsx?|zip)[^)]*\)/gi, ' ')
    .replace(/\(\s*[\d.,]+\s*[kmg]?o\s*\)/gi, ' ')
    .replace(/\s*:?\s*cliqu(ez|er) ici\.?\s*$/i, '')
    .replace(/\.(pdf|docx?|xlsx?|odt|zip)$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
    .trim();
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

  const match = toRegExp(options.match, 'liens à garder');
  const exclude = toRegExp(options.exclude, 'liens à écarter');
  const page = pageUrl.split('#')[0];
  const byUrl = new Map();
  const sections = new Set();
  zone.find('a[href]').each((_, a) => {
    const url = absoluteUrl($(a).attr('href'), pageUrl);
    if (!url || url.split('#')[0] === page) return;
    const own = oneLine($(a).text() || $(a).attr('title') || $(a).attr('aria-label') || '').replace(/\s*[>›»→]+$/, '');
    let context = contextOf($, a);
    // Nom de fichier technique (« 07532d ca9aaa50de… ») : inutilisable comme titre.
    const hashLike = (value) => /^[0-9a-f]{6,}([\s_-]+[0-9a-f]{6,})+$/i.test(value);
    const label = hashLike(fileLabel(url)) ? '' : fileLabel(url);
    const generic = own.length < 6 || GENERIC_LINK.test(own) || own.toLowerCase() === label.toLowerCase() || hashLike(own);
    const documentOnly = own.length < 40 && DOCUMENT_ONLY.test(own) && label.length >= 12;
    // Lien seul dans son bloc (« Télécharger Avis de marché PDF - 0,24 Mb ») : l'avis est rédigé au-dessus.
    const alone = cleanTitle(context).length <= cleanTitle(own).length + 5;
    const section = (generic || documentOnly) && alone ? sectionOf($, a, zone) : null;
    if (section) context = `${section.text} ${context}`.trim();
    const object = section ? cleanTitle(section.object) : '';
    const title = (object && object[0].toUpperCase() + object.slice(1)) || cleanTitle(documentOnly ? label : generic ? context.slice(0, 220) || label || own : own) || url;
    const haystack = `${title} ${own} ${url}`;
    if (match && !match.test(haystack)) return;
    if (exclude && exclude.test(haystack)) return;
    // Un avis par intertitre : ses autres pièces (cahier des charges, note…) ne sont pas des annonces de plus.
    if (section && sections.has(section.heading)) return;
    if (section) sections.add(section.heading);
    const entry = { url, text: own, title, context, kind: section ? guessKind(section.heading) : '' };
    const previous = byUrl.get(url);
    if (!previous || (previous.title.length < title.length && !GENERIC_LINK.test(title))) byUrl.set(url, entry);
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
  return { lines: lines.slice(0, 3000), links: [...byUrl.values()].slice(0, 400) };
}

/**
 * Lit le texte utile (sélecteur « details ») des pages de détail pas encore connues,
 * un bloc par ligne. Le cache, gardé dans l'état de la source, ne conserve que les
 * annonces encore listées ; il repart de zéro si le sélecteur change.
 */
async function readDetails(links, options, snapshot, http) {
  if (!options.details) return {};
  const cache = snapshot?.detailsKey === hash(options.details) ? snapshot.details || {} : {};
  const max = Number(options.detailsMax) || 8;
  const result = {};
  let fetched = 0;
  for (const link of links) {
    const key = hash(link.url);
    if (cache[key] != null) {
      result[key] = cache[key];
      continue;
    }
    if (fetched >= max) continue;
    fetched += 1;
    try {
      const response = await http.get(link.url);
      const $ = cheerio.load(response.text);
      $(NOISE).remove();
      const blocks = $(options.details).map((_, el) => oneLine(spacedText(el))).get();
      result[key] = blocks.filter(Boolean).join('\n').slice(0, 1200);
    } catch {
      // Page de détail indisponible : nouvel essai au prochain passage.
    }
  }
  return result;
}

// « N° de consultation : 2026/S2999 » en tête de fiche : la référence est lue à part.
const REFERENCE_PREFIX = /^n\s*[°º]\s*(de\s+)?(consultation|march[ée]|dossier)\s*:?\s*\S+\s*/i;

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

    if (mode === 'liens') {
      // Pages de détail (option « details ») : lues une seule fois par annonce, quelques-unes par passage.
      const details = await readDetails(page.links, options, snapshot, http);
      // Chaque lien est une annonce : premier passage = état initial, puis nouveautés et retraits.
      const noticeType = /^(AVIS|APPEL|CONSULTATION|MARCH[ÉE]|AAPC|AAO|AO|RFQ|RFT|RFP|EOI|DCE)\b/u;
      const items = page.links.map((link) => {
        const detail = details[hash(link.url)] || '';
        // « ACHETEUR EN MAJUSCULES - Objet de l'annonce » : l'acheteur est séparé du titre
        // (sauf si le préfixe est le type d'avis : « AVIS D'APPEL D'OFFRES - … »).
        const split = link.title.match(/^([A-ZÀ-ÝŒ0-9'’ .,()&/]{4,90}?)\s+[-–—]\s+(.{10,})$/u);
        // Un code en tête (« 26 STS19 CONS ») n'est pas un acheteur.
        let buyer = split && /[A-ZÀ-Ý]{3}/u.test(split[1]) && !/^\d/.test(split[1]) && !noticeType.test(split[1]) ? split[1].trim() : '';
        let title = buyer ? split[2].trim() : link.title;
        // L'objet lu sur la page de détail (premier bloc parlant) remplace un lien qui ne nomme que l'acheteur.
        const detailTitle = options.detailsTitle
          ? detail.split('\n').map((block) => cleanTitle(block.replace(REFERENCE_PREFIX, ''))).find((block) => block.length >= 6)
          : '';
        if (detailTitle) {
          if (!buyer && link.title.length <= 90 && !noticeType.test(link.title.toUpperCase())) buyer = link.title;
          title = truncate(detailTitle, 300);
        }
        const detailText = oneLine(detail);
        const summary = detailText && detailText !== title ? detailText : link.context && link.context !== title ? truncate(link.context, 600) : '';
        const text = `${title}\n${link.context}\n${detail}`;
        return {
          key: hash(link.url),
          kind: options.kind || (link.kind !== 'annonce' && link.kind) || guessKind(`${title} ${link.url}`),
          title,
          buyer,
          url: link.url,
          reference: guessReference(text),
          summary,
          publishedAt: findPublished(text) || parseDate(text.match(FILE_META)?.[1]) || dateFromUrl(link.url) || pastYear(`${title} ${link.url}`, now),
          deadline: findDeadline(text),
        };
      });
      // « Garder » : liste des derniers avis, où une annonce qui sort de la liste n'est pas retirée.
      const nextSnapshot = options.details ? { detailsKey: hash(options.details), details } : undefined;
      return { items, listing: !options.keep, snapshot: nextSnapshot, meta: { total: items.length } };
    }

    const contentHash = hash(page.lines.join('\n'));
    // Changer la zone surveillée repart d'un nouvel état de référence, sans fausse alerte.
    const optionsKey = hash(JSON.stringify([source.url, options.selector || '', options.ignore || [], mode]));
    // Pas d'horodatage ici : le fichier ne change que si la page change (pas de commit inutile).
    const nextSnapshot = { hash: contentHash, optionsKey, mode, lines: page.lines };
    const comparable = Boolean(snapshot && snapshot.optionsKey === optionsKey);
    const items = [];
    if (comparable && snapshot.hash !== contentHash) {
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
    return { items, snapshot: nextSnapshot, meta: { total: page.lines.length, firstCheck: !comparable } };
  },
};
