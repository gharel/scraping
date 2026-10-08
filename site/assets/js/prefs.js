/**
 * Préférences propres à cet appareil (thème, filtres, annonces suivies, jeton GitHub).
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

function writeSession(key, value) {
  try {
    window.sessionStorage.setItem(PREFIX + key, value);
  } catch {
    /* ignoré */
  }
}

/**
 * Date de référence des « nouveautés » : la visite précédente.
 * Elle reste stable pendant toute la session pour ne pas effacer les badges au rechargement.
 */
export function noveltyReference(now = new Date()) {
  let since = readSession('since');
  if (!since) {
    since = read('lastVisit') || new Date(now.getTime() - 3 * 86400000).toISOString();
    writeSession('since', since);
  }
  write('lastVisit', now.toISOString());
  return since;
}

export function resetNovelty(now = new Date()) {
  const iso = now.toISOString();
  writeSession('since', iso);
  write('lastVisit', iso);
  return iso;
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
