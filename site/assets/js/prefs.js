/**
 * Préférences propres à cet appareil (thème, filtres, annonces suivies et lues, jeton GitHub).
 * Tout est protégé : en navigation privée, le stockage peut être indisponible.
 */
const PREFIX = 'vigie.';

export function read(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    if (value == null) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : la préférence ne sera pas conservée */
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
