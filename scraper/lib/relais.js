/**
 * Relais : quelques sites refusent les serveurs de GitHub qui assurent la veille en ligne.
 * Vigie, lancé sur le PC, publie leurs annonces dans data/relais/<id>.json ; la veille en ligne
 * les reprend comme si elle les avait lues, tant que le relevé est récent.
 */
export const RELAY_VERSION = 1;
export const RELAY_DIR = 'relais';
/** Au-delà, le relevé du PC n'est plus considéré comme l'état du site. */
export const RELAY_MAX_AGE_MS = 6 * 3600000;
/** Sans changement, le PC republie son relevé au plus toutes les 3 heures (pour qu'il reste récent). */
export const RELAY_REFRESH_MS = 3 * 3600000;
export const RELAY_MAX_ITEMS = 400;

export const relayFileName = (sourceId) => `${String(sourceId).replace(/[^a-z0-9-]/gi, '_')}.json`;

/** État en ligne d'une source que GitHub n'atteint pas (directement ou via un relais). */
export function needsRelay(status) {
  return Boolean(status && status.network && status.where === 'github');
}

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || ''));

/** Raison pour laquelle un relais est refusé, ou null s'il est utilisable. */
export function relayProblem(relay, source, now) {
  if (!relay || typeof relay !== 'object') return 'relais absent';
  if (relay.version !== RELAY_VERSION) return 'format de relais inconnu';
  if (relay.sourceId !== source.id || relay.url !== source.url) return 'relevé d’une autre adresse';
  if (!Array.isArray(relay.items)) return 'relevé sans annonces';
  const at = Date.parse(relay.at);
  if (!Number.isFinite(at)) return 'date du relevé absente';
  const age = now.getTime() - at;
  if (age > RELAY_MAX_AGE_MS) return `relevé trop ancien (${Math.round(age / 3600000)} h)`;
  if (age < -10 * 60000) return 'date du relevé dans le futur';
  return null;
}

/** Annonces du relais, prêtes à fusionner (clé obligatoire, liens web uniquement). */
export function relayItems(relay) {
  return relay.items
    .filter((item) => item && typeof item === 'object' && typeof item.key === 'string' && item.key)
    .slice(0, RELAY_MAX_ITEMS)
    .map((item) => (item.url && !isHttpUrl(item.url) ? { ...item, url: undefined } : item));
}
