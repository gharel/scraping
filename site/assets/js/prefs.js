/**
 * Préférences propres à cet appareil (filtres, annonces suivies et lues), sous le
 * préfixe « vigie. ». Le thème, commun à tous les outils Skazy Formation, a sa propre clé (theme.js).
 * Tout est protégé : en navigation privée, le stockage peut être indisponible.
 */
const PREFIX = 'vigie.';

/** Valeur d'une clé complète, sans le préfixe (ex. le thème commun aux outils Skazy Formation). */
export function readShared(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Enregistre une clé complète, sans le préfixe ; `null` la retire. */
export function writeShared(key, value) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : la préférence ne sera pas conservée */
  }
}

export const read = (key, fallback = null) => readShared(PREFIX + key, fallback);

export const write = (key, value) => writeShared(PREFIX + key, value);

/**
 * Secret (jeton GitHub) gardé dans le sessionStorage de cet onglet seulement, effacé à sa fermeture.
 * Le localStorage de gharel.github.io est partagé par tous les sites Pages du compte : une faille
 * sur l'un d'eux suffirait à y lire un jeton. Une ancienne copie en localStorage est déplacée ici.
 */
export function readSecret(key) {
  const legacy = read(key);
  if (legacy != null) {
    write(key, null);
    writeSecret(key, legacy);
  }
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Enregistre un secret pour cet onglet ; `null` le retire (et toute ancienne copie en localStorage). */
export function writeSecret(key, value) {
  write(key, null);
  try {
    if (value == null) window.sessionStorage.removeItem(PREFIX + key);
    else window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : le secret ne sera pas conservé */
  }
}

function readSession(key) {
  try {
    return window.sessionStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

/**
 * Lecture des nouveautés : une annonce reste « Nouvelle » jusqu'à ce que vous la marquiez comme lue.
 * `before` : tout ce qui a été repéré avant cette date est lu (« Tout marquer comme lu ») ;
 * `ids` : annonces plus récentes déjà marquées comme lues, une à une.
 */
export function readState(now = new Date()) {
  let before = read('readBefore');
  if (!before) {
    // Avant ce réglage, les nouveautés s'effaçaient à chaque visite : on repart de la visite précédente.
    before = readSession('since') || read('lastVisit') || new Date(now.getTime() - 3 * 86400000).toISOString();
    write('readBefore', before);
    write('lastVisit', null);
  }
  return { before, ids: new Set(read('readIds', [])) };
}

export function saveReadState({ before, ids }) {
  write('readBefore', before);
  write('readIds', ids.size ? [...ids] : null);
}

export function starred() {
  return new Set(read('starred', []));
}

export function toggleStar(id) {
  const set = starred();
  if (set.has(id)) set.delete(id);
  else set.add(id);
  write('starred', [...set]);
  return set.has(id);
}
