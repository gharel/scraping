/**
 * Lecture des dates rencontrées sur les sites surveillés (français, anglais, ISO, RSS).
 * Les heures sans fuseau sont interprétées dans le fuseau de la Nouvelle-Calédonie (UTC+11, sans heure d'été).
 */
export const DEFAULT_OFFSET = '+11:00';

const pad = (n) => String(n).padStart(2, '0');

function normalizeWord(word) {
  return String(word || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

const SHORT_MONTHS = {
  jan: 1, fev: 2, feb: 2, mar: 3, avr: 4, apr: 4, mai: 5, may: 5,
  aou: 8, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function monthFromName(name) {
  const word = normalizeWord(name);
  if (!word) return null;
  if (word.startsWith('juin') || word === 'jun' || word.startsWith('june')) return 6;
  if (word.startsWith('juil') || word === 'jul' || word.startsWith('july')) return 7;
  return SHORT_MONTHS[word.slice(0, 3)] ?? null;
}

function isValid(y, m, d, hh = 0, mm = 0) {
  return y > 1990 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31 && hh >= 0 && hh < 24 && mm >= 0 && mm < 60;
}

export function toIso(y, m, d, hh = 0, mm = 0, offset = DEFAULT_OFFSET) {
  if (!isValid(y, m, d, hh, mm)) return null;
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00${offset}`;
}

function fullYear(y) {
  const n = Number(y);
  return n < 100 ? 2000 + n : n;
}

function parseTime(hours, minutes) {
  if (hours == null || hours === '') return [0, 0];
  return [Number(hours), Number(minutes || 0)];
}

/** Construit une date à partir des morceaux affichés par les portails Atexo (« 16 », « Sept. », « 2026 », « 16:00 »). */
export function fromParts(day, monthName, year, time = '', offset = DEFAULT_OFFSET) {
  const month = monthFromName(monthName);
  const timeMatch = String(time || '').match(/(\d{1,2})\s*[h:]\s*(\d{2})?/i);
  const [hh, mm] = timeMatch ? parseTime(timeMatch[1], timeMatch[2]) : [0, 0];
  if (!month) return null;
  return toIso(fullYear(year), month, Number(day), hh, mm, offset);
}

const TIME = String.raw`(?:\s*(?:à|a|at|-|,)?\s*(\d{1,2})\s*(?:h|:)\s*(\d{2})?)?`;
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const RE_NUMERIC = new RegExp(String.raw`(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})\b${TIME}`, 'i');
const RE_DAY_MONTH = new RegExp(String.raw`(\d{1,2})(?:er|st|nd|rd|th)?\s+([A-Za-zÀ-ÿ]{3,10})\.?,?\s+(\d{4})${TIME}`, 'i');
const RE_MONTH_DAY = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/;
const RE_EXPLICIT_TZ = /\d{1,2}:\d{2}(?::\d{2})?\s*(?:GMT|UTC|Z|[+-]\d{2}:?\d{2}|[ECMP][SD]T)\b/i;

/**
 * Convertit un texte de date en chaîne ISO 8601 (avec fuseau), ou null.
 */
export function parseDate(input, { offset = DEFAULT_OFFSET } = {}) {
  if (!input) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.toISOString();
  const text = String(input).replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const iso = text.match(RE_ISO);
  if (iso) {
    const [, y, m, d, hh, mm, ss, tz] = iso;
    if (tz) {
      const date = new Date(text.replace(' ', 'T'));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const base = toIso(Number(y), Number(m), Number(d), Number(hh || 0), Number(mm || 0), offset);
    return base && ss ? base.replace(':00' + offset, `:${ss}${offset}`) : base;
  }

  // Dates avec fuseau explicite (RSS « Wed, 07 Oct 2026 01:57:53 +0000 », « … GMT ») : on respecte le fuseau.
  if (RE_EXPLICIT_TZ.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const numeric = text.match(RE_NUMERIC);
  if (numeric) {
    const [, d, m, y, hh, mm] = numeric;
    const [h, min] = parseTime(hh, mm);
    const result = toIso(fullYear(y), Number(m), Number(d), h, min, offset);
    if (result) return result;
  }

  const dayMonth = text.match(RE_DAY_MONTH);
  if (dayMonth) {
    const [, d, monthName, y, hh, mm] = dayMonth;
    const month = monthFromName(monthName);
    const [h, min] = parseTime(hh, mm);
    if (month) {
      const result = toIso(Number(y), month, Number(d), h, min, offset);
      if (result) return result;
    }
  }

  const monthDay = text.match(RE_MONTH_DAY);
  if (monthDay) {
    const [, monthName, d, y] = monthDay;
    const month = monthFromName(monthName);
    if (month) return toIso(Number(y), month, Number(d), 0, 0, offset);
  }
  return null;
}

/**
 * Cherche une date limite dans un texte libre (« date limite de remise des offres : 30/10/2026 à 16h00 »).
 */
function findAfter(text, pattern, options) {
  const normalized = String(text || '').replace(/\s+/g, ' ');
  let match;
  while ((match = pattern.exec(normalized))) {
    const after = normalized.slice(match.index + match[0].length, match.index + match[0].length + 60);
    const date = parseDate(after, options);
    if (date) return date;
  }
  return null;
}

/** Date limite annoncée dans un texte libre. */
export function findDeadline(text, options) {
  return findAfter(
    text,
    /(date limite|limite de (?:remise|d[ée]p[ôo]t|r[ée]ception)|remise des (?:offres|plis|candidatures)|remise de l['’]offre|date de (?:cl[ôo]ture|remise)|cl[ôo]ture|jusqu['’]au|avant le|au plus tard(?: le)?|closing date|closes? on|deadline|due date)[^0-9]{0,40}/gi,
    options,
  );
}

/** Date de publication annoncée dans un texte libre (« publié le », « mis en ligne le »…). */
export function findPublished(text, options) {
  return (
    findAfter(text, /(publi[ée]e? le|mis[e]? en ligne le|date de publication|parution(?: du| le)?|posted on|posting date|published)[^0-9]{0,30}/gi, options) ||
    // À défaut, la date de mise à jour de la page de l'avis.
    findAfter(text, /(mis[e]? à jour le|updated on)[^0-9]{0,10}/gi, options)
  );
}
