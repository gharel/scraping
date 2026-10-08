/**
 * Portails Atexo MPE (marchespublics.nc et la plupart des plateformes françaises de marchés publics).
 * La liste des consultations est paginée par « postback » PRADO : on renvoie le formulaire de la page
 * avec l'état caché (PRADO_PAGESTATE) et la cible du bouton « page suivante ».
 */
import * as cheerio from 'cheerio';
import { absoluteUrl, cleanText, oneLine } from '../lib/text.js';
import { fromParts } from '../lib/dates.js';

const RESULT = 'ctl0$CONTENU_PAGE$resultSearch';
const NEXT_PAGE_TARGET = `${RESULT}$PagerTop$ctl2`;
const PAGE_SIZE_FIELD = `${RESULT}$listePageSizeTop`;
const SEARCH = 'ctl0$CONTENU_PAGE$AdvancedSearch';
// Territoires du Pacifique placés en tête de la liste des lieux d'exécution.
const PACIFIC = /\(98[678]\)|cal[ée]donie|polyn[ée]sie|wallis|futuna|vanuatu/i;

/** Lieux d'exécution : liste complète et version courte pour l'affichage. */
function summarizePlaces(text) {
  const places = oneLine(text)
    .split(/\s*,\s*/)
    .filter(Boolean);
  const ordered = [...places.filter((place) => PACIFIC.test(place)), ...places.filter((place) => !PACIFIC.test(place))];
  const unique = [...new Set(ordered)];
  return { count: unique.length, label: unique.length > 3 ? `${unique.slice(0, 3).join(', ')} +${unique.length - 3}` : unique.join(', ') };
}

function kindFromUrl(url) {
  if (/AvisAttribution/i.test(url)) return 'attribution';
  if (/AvisInformation/i.test(url)) return 'information';
  return 'consultation';
}

function formState($) {
  const form = $('form').filter((_, el) => $(el).find('input[name="PRADO_PAGESTATE"]').length > 0).first();
  if (!form.length) return null;
  const fields = new URLSearchParams();
  form.find('input').each((_, el) => {
    const input = $(el);
    const name = input.attr('name');
    if (!name) return;
    const type = (input.attr('type') || 'text').toLowerCase();
    if (['submit', 'button', 'image', 'reset', 'file'].includes(type)) return;
    if ((type === 'checkbox' || type === 'radio') && input.attr('checked') === undefined) return;
    fields.append(name, input.attr('value') ?? '');
  });
  form.find('select').each((_, el) => {
    const select = $(el);
    const name = select.attr('name');
    if (!name) return;
    const option = select.find('option[selected]').first();
    fields.append(name, (option.length ? option : select.find('option').first()).attr('value') ?? '');
  });
  form.find('textarea').each((_, el) => {
    const name = $(el).attr('name');
    if (name) fields.append(name, $(el).text());
  });
  return { action: form.attr('action') || '', fields };
}

function pagination($) {
  const total = Number($(`[id$="resultSearch_nombreElement"]`).first().text().trim()) || 0;
  const pages = Number($(`[id$="resultSearch_nombrePageTop"]`).first().text().trim()) || 1;
  const current = Number($(`[id$="resultSearch_numPageTop"]`).first().attr('value')) || 1;
  return { total, pages, current };
}

function dateBlock(block) {
  if (!block || !block.length) return { day: '', month: '', year: '' };
  return {
    day: block.find('.day').first().text().trim(),
    month: block.find('.month').first().text().trim(),
    year: block.find('.year').first().text().trim(),
  };
}

function splitBuyer(text) {
  const value = oneLine(text);
  const match = value.match(/^(.*)\(([^()]*)\)\s*$/);
  if (!match) return { buyer: value, buyerLocation: '' };
  const location = match[2].replace(/^\d{5}\s*-\s*/, '').trim();
  return { buyer: match[1].trim(), buyerLocation: location };
}

/** Extrait les consultations d'une page de résultats Atexo. */
export function parseResults(html, pageUrl) {
  const $ = cheerio.load(html);
  const kind = kindFromUrl(pageUrl);
  const items = [];

  $('.item_consultation').each((_, element) => {
    const row = $(element);
    const id = row.find('input[id$="_refCons"]').attr('value') || '';
    const org = row.find('input[id$="_orgCons"]').attr('value') || '';

    const procedureNode = row.find('.cons_procedure abbr').first();
    const intitule = row.find('.objet-line').first();
    const reference = oneLine(intitule.find('.small').first().text());
    const titleNode = intitule.find('[title]').first();
    const title = oneLine(titleNode.attr('title') || titleNode.text() || intitule.text());

    const objetNode = row.find('[id$="_panelBlocObjet"]').first();
    const summary = cleanText(objetNode.find('[title]').first().attr('title') || objetNode.text().replace(/^\s*Objet\s*:\s*/i, ''));

    const buyerNode = row.find('[id$="_panelBlocDenomination"]').first();
    const { buyer, buyerLocation } = splitBuyer(buyerNode.find('[title]').first().attr('title') || buyerNode.text().replace(/^\s*Organisme\s*:\s*/i, ''));

    const lots = Number(oneLine(row.find('.lots').first().text()).match(/(\d+)\s*lot/i)?.[1]) || 0;
    const lieux = row.find('.lieux-exe').first();
    const places = summarizePlaces(lieux.find('[data-content]').first().attr('data-content') || lieux.find('span > span').first().text());

    const published = dateBlock(row.find('.cons_ref .date').first());
    const closing = row.find('.cloture-line').first();
    const closingDate = dateBlock(closing.find('.date').first());
    const closingTime = closing.find('.time').first().text().trim();

    let link = '';
    row.find('a[href]').each((__, a) => {
      const href = $(a).attr('href') || '';
      if (!link && /consultation/i.test(href) && !/echanges|messagerie|javascript:/i.test(href)) link = href;
    });
    const url =
      absoluteUrl(link, pageUrl) ||
      (id ? absoluteUrl(`/entreprise/consultation/${encodeURIComponent(id)}?orgAcronyme=${encodeURIComponent(org)}`, pageUrl) : pageUrl);

    if (!title && !reference) return;
    items.push({
      key: id ? `${org || 'org'}-${id}` : reference || title,
      kind,
      title: title || reference,
      url,
      reference,
      buyer,
      buyerLocation,
      summary,
      procedure: oneLine(procedureNode.attr('title') || ''),
      procedureCode: oneLine(procedureNode.text()),
      nature: oneLine(row.find('.cons_categorie').first().text()),
      location: places.label,
      placesCount: places.count,
      lots,
      publishedAt: fromParts(published.day, published.month, published.year),
      deadline: fromParts(closingDate.day, closingDate.month, closingDate.year, closingTime),
    });
  });

  return { items, ...pagination($), form: formState($) };
}

export default {
  id: 'atexo',
  listing: true,
  async fetch(source, { http, log }) {
    const maxPages = Number(source.options?.maxPages) || 25;
    const collected = new Map();

    let response = await http.get(source.url);
    let page = parseResults(response.text, response.url);
    if (!page.form && page.items.length === 0) {
      throw new Error("La page ne ressemble pas à une liste de consultations Atexo (aucun résultat ni formulaire trouvé)");
    }

    // Recherche avancée : lieux d'exécution (codes Atexo) et mots-clés, envoyés par le formulaire.
    const lieux = String(source.options?.lieux || '')
      .split(/[\s,;]+/)
      .filter(Boolean);
    if (lieux.length || source.options?.motsCles) {
      if (!page.form?.fields.has(`${SEARCH}$keywordSearch`)) {
        throw new Error('Formulaire de recherche avancée introuvable : utilisez l’adresse « …EntrepriseAdvancedSearch&searchAnnCons »');
      }
      const { action, fields } = page.form;
      if (lieux.length) fields.set(`${SEARCH}$idsSelectedGeoN2`, `,${lieux.join(',')},`);
      if (source.options?.motsCles) fields.set(`${SEARCH}$keywordSearch`, source.options.motsCles);
      fields.set(`${SEARCH}$lancerRecherche`, 'Lancer la recherche');
      fields.set('PRADO_POSTBACK_TARGET', `${SEARCH}$lancerRecherche`);
      fields.set('PRADO_POSTBACK_PARAMETER', '');
      const postUrl = absoluteUrl(action.replace(/&amp;/g, '&'), response.url) || response.url;
      response = await http.post(postUrl, fields.toString(), { headers: { Referer: response.url } });
      page = parseResults(response.text, source.url);
    }
    page.items.forEach((item) => collected.set(item.key, item));

    const postBack = async (target, extra = {}) => {
      const { action, fields } = page.form;
      for (const [key, value] of Object.entries(extra)) fields.set(key, value);
      fields.set('PRADO_POSTBACK_TARGET', target);
      fields.set('PRADO_POSTBACK_PARAMETER', '');
      const postUrl = absoluteUrl(action.replace(/&amp;/g, '&'), response.url) || response.url;
      response = await http.post(postUrl, fields.toString(), { headers: { Referer: response.url } });
      page = parseResults(response.text, source.url);
    };

    // Moins de pages à parcourir : 20 résultats par page quand c'est possible.
    if (page.pages > 1 && page.form?.fields.has(PAGE_SIZE_FIELD)) {
      await postBack(PAGE_SIZE_FIELD, { [PAGE_SIZE_FIELD]: '20' });
      page.items.forEach((item) => collected.set(item.key, item));
    }

    let guard = 1;
    while (page.current < page.pages && guard < maxPages && page.form) {
      const before = page.current;
      await postBack(NEXT_PAGE_TARGET);
      page.items.forEach((item) => collected.set(item.key, item));
      guard += 1;
      if (page.current <= before) break;
    }

    const total = page.total || collected.size;
    if (total && collected.size < total) log?.(`  ${source.name} : ${collected.size}/${total} consultations lues`);
    // Écarte les marchés de portée nationale (trop de lieux d'exécution).
    const maxPlaces = Number(source.options?.lieuxMax) || 0;
    const items = [...collected.values()].filter((item) => !maxPlaces || !item.placesCount || item.placesCount <= maxPlaces);
    return { items, meta: { total } };
  },
};
