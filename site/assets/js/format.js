/**
 * Mise en forme française : dates (heure de Nouméa par défaut), délais, titres.
 */
let timeZone = 'Pacific/Noumea';
const formatters = new Map();

export function setTimeZone(value) {
  if (!value) return;
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: value });
    timeZone = value;
    formatters.clear();
  } catch {
    /* fuseau inconnu : on garde le précédent */
  }
}

function formatter(key, options) {
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat('fr-FR', { timeZone, ...options }));
  return formatters.get(key);
}

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Composantes de la date dans le fuseau de la veille. */
function parts(date) {
  const values = {};
  for (const part of formatter('parts', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)) {
    values[part.type] = part.value;
  }
  return values;
}

export function hasTime(value) {
  const date = toDate(value);
  if (!date) return false;
  const p = parts(date);
  return !(p.hour === '00' && p.minute === '00');
}

export function formatDate(value, { time = 'auto', short = false } = {}) {
  const date = toDate(value);
  if (!date) return '';
  const showYear = parts(date).year !== parts(new Date()).year;
  const label = formatter(`d-${short}-${showYear}`, {
    day: 'numeric',
    month: short ? 'short' : 'long',
    ...(showYear || !short ? { year: 'numeric' } : {}),
  }).format(date);
  const withTime = time === true || (time === 'auto' && hasTime(date));
  if (!withTime) return label;
  const p = parts(date);
  return `${label} à ${Number(p.hour)} h ${p.minute}`;
}

/** Nombre de jours calendaires entre aujourd'hui et la date (dans le fuseau de la veille). */
export function daysUntil(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return null;
  const a = parts(now);
  const b = parts(date);
  const dayA = Date.UTC(Number(a.year), Number(a.month) - 1, Number(a.day));
  const dayB = Date.UTC(Number(b.year), Number(b.month) - 1, Number(b.day));
  return Math.round((dayB - dayA) / 86400000);
}

export function relativeTime(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return '';
  const seconds = Math.round((now - date) / 1000);
  if (seconds < 0) return formatDate(date, { short: true });
  if (seconds < 60) return 'à l’instant';
  const minutes = Math.round(seconds / 60);
  // Espace insécable : « 8 h » ne se coupe pas en fin de ligne.
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = -daysUntil(date, now);
  if (days <= 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return `le ${formatDate(date, { short: true, time: false })}`;
}

/** Délai avant une date future : « dans 12 min », « dans 2 h ». */
export function untilTime(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return '';
  const minutes = Math.round((date - now) / 60000);
  if (minutes <= 0) return 'imminente';
  if (minutes < 60) return `dans ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `dans ${hours} h`;
  return `le ${formatDate(date, { short: true })}`;
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count.toLocaleString('fr-FR')} ${count > 1 ? pluralForm : singular}`;
}

/* ── Titres en capitales → phrase lisible ─────────────────────────── */

const KEEP_UPPER = new Set(
  'AMO VRD BTP CFO CFA IA AI NC SI TIC DSP EPI PMR SIG OPT OPTNC CAFAT UNC CCI IFAP CPS SPC ICT IT RH PME TPE HT TTC UV LED GPS PC CHT CHS SLN EEC DAEM DERES DCJS DSI DITTT DASS IRD SAV CVC LMS CCTP RC DCE AAP AO AOO MAPA NDC FSM EOC PSA RFP RFQ EOI GCF ONU UE II III IV VI VII VIII IX XI XII XIII XIV XV'.split(' '),
);

const PROPER_NOUNS = {
  'nouvelle-caledonie': 'Nouvelle-Calédonie',
  caledonie: 'Calédonie',
  noumea: 'Nouméa',
  dumbea: 'Dumbéa',
  paita: 'Païta',
  'mont-dore': 'Mont-Dore',
  bourail: 'Bourail',
  kone: 'Koné',
  koumac: 'Koumac',
  lifou: 'Lifou',
  ouvea: 'Ouvéa',
  poindimie: 'Poindimié',
  houailou: 'Houaïlou',
  thio: 'Thio',
  yate: 'Yaté',
  pouembout: 'Pouembout',
  canala: 'Canala',
  'la foa': 'La Foa',
  boulouparis: 'Boulouparis',
  hienghene: 'Hienghène',
  tontouta: 'Tontouta',
  'ile des pins': 'Île des Pins',
  'province sud': 'Province Sud',
  'province nord': 'Province Nord',
  'province des iles': 'Province des Îles',
  'iles loyaute': 'Îles Loyauté',
};

const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function prettyTitle(title) {
  const text = String(title || '');
  if (/\p{Ll}/u.test(text) || text.length < 12) return text;
  let result = text
    .split(/([\s/(),;:.!?'’"«»–—-]+)/u)
    .map((token) => {
      if (!token || /^[\s/(),;:.!?'’"«»–—-]+$/u.test(token)) return token;
      if (/\d/.test(token) || KEEP_UPPER.has(fold(token))) return token;
      return token.toLocaleLowerCase('fr-FR');
    })
    .join('');
  const folded = fold(result);
  for (const [key, proper] of Object.entries(PROPER_NOUNS)) {
    const re = new RegExp(`(^|[^\\p{L}])(${key.replace(/[-\s]/g, '[-\\s]')})(?=$|[^\\p{L}])`, 'giu');
    let match;
    while ((match = re.exec(folded))) {
      const start = match.index + match[1].length;
      result = result.slice(0, start) + proper + result.slice(start + match[2].length);
    }
  }
  return result.replace(/^(\P{L}*)(\p{L})/u, (_, prefix, letter) => prefix + letter.toLocaleUpperCase('fr-FR'));
}
