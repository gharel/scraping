/**
 * Relais vers la version en ligne, depuis Vigie lancé sur le PC.
 *
 * Quelques sites refusent les serveurs de GitHub qui assurent la veille en ligne. Après chaque
 * vérification, Vigie publie dans le dépôt les annonces de ces sites (data/relais/<id>.json),
 * en un seul commit, avec le jeton GitHub que vous avez collé dans Réglages.
 *
 * Le jeton est enregistré dans local-data/relais.json (dossier ignoré par git). Il n'est jamais
 * renvoyé à l'interface, ni écrit dans le journal.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildRelay } from '../scraper/core.js';
import { ROOT_DIR } from '../scraper/lib/config-file.js';
import { RELAY_DIR, RELAY_MAX_AGE_MS, RELAY_REFRESH_MS, needsRelay, relayFileName } from '../scraper/lib/relais.js';
import { loadStore } from '../scraper/lib/store.js';

export const SETTINGS_FILE = path.join(ROOT_DIR, 'local-data', 'relais.json');
const REPOSITORY_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const TOKEN_RE = /^[A-Za-z0-9_]{20,255}$/;

export class RelayError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'RelayError';
    this.status = status;
  }
}

/** Dépôt GitHub d'origine de ce dossier (« propriétaire/dépôt »), d'après la configuration git. */
export function detectRepository() {
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

/* ── Réglages enregistrés sur le PC ───────────────────────────────── */

export async function readSettings(file = SETTINGS_FILE) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

async function writeSettings(settings, file = SETTINGS_FILE) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
}

/** Ce que l'interface peut afficher : tout sauf le jeton. */
export function publicState(settings, { running = false, config = null } = {}) {
  const names = new Map((config?.sources || []).map((source) => [source.id, source.name]));
  return {
    configured: Boolean(settings.token && settings.repository),
    repository: settings.repository || detectRepository() || '',
    branch: settings.branch || 'main',
    connectedAt: settings.connectedAt || null,
    publishedAt: settings.publishedAt || null,
    running,
    last: settings.last || null,
    sources: Object.entries(settings.published || {})
      .map(([id, entry]) => ({ id, name: names.get(id) || id, at: entry.at, found: entry.found ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  };
}

/* ── API GitHub ───────────────────────────────────────────────────── */

function explain(status, data, repository) {
  const message = String(data?.message || '');
  if (status === 401) return 'GitHub refuse ce jeton : il est expiré, révoqué ou mal copié.';
  if (status === 403 && /rate limit/i.test(message)) return 'Trop de requêtes vers GitHub pour le moment. Vigie réessaiera au prochain passage.';
  if (status === 403) return `Ce jeton n’a pas le droit d’écrire dans ${repository} : accordez l’autorisation « Contents » en lecture et écriture sur ce dépôt.`;
  if (status === 404) return `Dépôt introuvable : vérifiez que le jeton donne bien accès à ${repository}.`;
  if (status === 409) return `Le dépôt ${repository} est vide ou indisponible.`;
  if (status === 422) return `GitHub a refusé la demande${message ? ` : ${message}` : ''}.`;
  return `Erreur GitHub ${status}${message ? ` : ${message}` : ''}.`;
}

export function createGitHubApi({ token, repository, fetchImpl = fetch }) {
  const base = `https://api.github.com/repos/${repository}`;
  return async function call(route, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetchImpl(base + route, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Vigie-relais',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new RelayError('Impossible de joindre GitHub depuis ce PC. Vérifiez la connexion internet.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new RelayError(explain(response.status, data, repository), response.status);
    return data;
  };
}

const refPath = (branch) => `/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`;

/**
 * Écrit plusieurs fichiers en un seul commit (API Git de GitHub).
 * Si la veille en ligne pousse entre-temps, on repart de la nouvelle tête de branche.
 */
export async function commitFiles(call, { branch, files, message }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ref = await call(refPath(branch));
    const head = ref.object.sha;
    const parent = await call(`/git/commits/${head}`);
    const tree = await call('/git/trees', {
      method: 'POST',
      body: { base_tree: parent.tree.sha, tree: files.map((file) => ({ path: file.path, mode: '100644', type: 'blob', content: file.content })) },
    });
    if (tree.sha === parent.tree.sha) return null;
    const commit = await call('/git/commits', { method: 'POST', body: { message, tree: tree.sha, parents: [head] } });
    try {
      await call(refPath(branch), { method: 'PATCH', body: { sha: commit.sha, force: false } });
      return commit.sha;
    } catch (error) {
      // 422 : la branche a avancé (commit de la veille en ligne) ; on recommence sur la nouvelle tête.
      if (error.status !== 422 || attempt === 2) throw error;
    }
  }
  return null;
}

/* ── Connexion ────────────────────────────────────────────────────── */

export async function connect({ token, repository, branch, fetchImpl, file = SETTINGS_FILE }) {
  const cleanToken = String(token || '').trim();
  const repo = String(repository || '').trim() || detectRepository();
  if (!TOKEN_RE.test(cleanToken)) throw new RelayError('Ce jeton ne ressemble pas à un jeton GitHub : copiez-le en entier (il commence par github_pat_ ou ghp_).', 400);
  if (!REPOSITORY_RE.test(repo)) throw new RelayError('Dépôt GitHub inconnu : indiquez-le sous la forme propriétaire/dépôt.', 400);
  const call = createGitHubApi({ token: cleanToken, repository: repo, fetchImpl });
  const info = await call('');
  // Vérifie le droit d'écriture sans rien modifier : un contenu isolé (blob) n'apparaît dans aucun commit.
  await call('/git/blobs', { method: 'POST', body: { content: 'Vigie : vérification du jeton du relais', encoding: 'utf-8' } });
  const previous = await readSettings(file);
  const fullName = info.full_name || repo;
  // Le même dépôt garde l'historique des relevés publiés ; un autre dépôt repart de zéro.
  const sameRepository = previous.repository === fullName;
  const settings = {
    token: cleanToken,
    repository: fullName,
    branch: branch || info.default_branch || 'main',
    connectedAt: new Date().toISOString(),
    published: sameRepository ? previous.published || {} : {},
    publishedAt: sameRepository ? previous.publishedAt || null : null,
    last: null,
  };
  await writeSettings(settings, file);
  return settings;
}

export async function disconnect(file = SETTINGS_FILE) {
  const previous = await readSettings(file);
  await writeSettings({ repository: previous.repository || '', branch: previous.branch || 'main', published: {}, publishedAt: null, last: null }, file);
}

/* ── Publication ──────────────────────────────────────────────────── */

const digest = (relay) => createHash('sha256').update(JSON.stringify([relay.url, relay.listing, relay.total, relay.items])).digest('hex').slice(0, 20);

function appUrlFor(config, repository) {
  if (config.settings.appUrl) return config.settings.appUrl.endsWith('/') ? config.settings.appUrl : `${config.settings.appUrl}/`;
  const [owner, repo] = repository.split('/');
  return `https://${owner.toLowerCase()}.github.io/${repo}/`;
}

/** État des sources sur la version en ligne (data/status.json publié avec le site). */
export async function fetchOnlineStatus(url, fetchImpl = fetch) {
  const response = await fetchImpl(`${url}data/status.json?t=${Date.now()}`, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Vigie-relais' } });
  if (!response.ok) throw new Error(`réponse ${response.status}`);
  const status = await response.json();
  return status?.sources && typeof status.sources === 'object' ? status : { sources: {} };
}

/**
 * Relevés à publier : sources lues avec succès sur ce PC que la veille en ligne n'atteint pas.
 * Un relevé est republié s'il a changé, ou s'il a plus de 3 heures (pour qu'il reste récent en ligne).
 */
export function planRelays({ config, items, localStatus, onlineStatus, published = {}, now = new Date(), force = false }) {
  const plan = [];
  for (const source of config.sources) {
    if (!source.enabled) continue;
    const local = localStatus.sources?.[source.id];
    const online = onlineStatus ? onlineStatus.sources?.[source.id] : null;
    // Version en ligne injoignable : on continue de relayer les sources déjà relayées.
    const wanted = onlineStatus ? needsRelay(online) : Boolean(published[source.id]);
    if (!wanted || !local?.ok || !local.lastSuccess || typeof local.listing !== 'boolean') continue;
    if (local.url && local.url !== source.url) continue;
    const at = Date.parse(local.lastSuccess);
    if (!Number.isFinite(at) || now.getTime() - at > RELAY_MAX_AGE_MS) continue;
    const relay = buildRelay({ source, items, status: local });
    const hash = digest(relay);
    const previous = published[source.id];
    const previousAt = Date.parse(previous?.at) || 0;
    const due = !previous || previous.hash !== hash || (relay.at !== previous.at && (force || at - previousAt >= RELAY_REFRESH_MS));
    if (due) plan.push({ source, relay, hash });
  }
  return plan;
}

function commitMessage(plan) {
  const names = plan.map((entry) => entry.source.name);
  const list = names.length > 3 ? `${names.slice(0, 3).join(', ')}…` : names.join(', ');
  return `Relais : annonces lues depuis le PC (${list})`;
}

/**
 * Publie les relevés dus. Ne lève pas d'erreur : le résultat est enregistré dans settings.last.
 * Renvoie { published: [ids], skipped, error } ou null si le relais n'est pas activé.
 */
export async function publishRelays({ config, dataDir, force = false, log = () => {}, fetchImpl = fetch, file = SETTINGS_FILE, now = () => new Date() }) {
  const settings = await readSettings(file);
  if (!settings.token || !settings.repository) return null;
  const startedAt = now();
  const outcome = { at: startedAt.toISOString(), ok: true, published: [], error: null, online: true };
  try {
    let onlineStatus = null;
    try {
      onlineStatus = await fetchOnlineStatus(appUrlFor(config, settings.repository), fetchImpl);
    } catch (error) {
      outcome.online = false;
      log(`Relais : état de la version en ligne indisponible (${error.message}), sources déjà relayées seulement`);
    }
    const store = await loadStore(dataDir);
    const plan = planRelays({ config, items: store.items, localStatus: store.status, onlineStatus, published: settings.published || {}, now: startedAt, force });
    if (plan.length) {
      const call = createGitHubApi({ token: settings.token, repository: settings.repository, fetchImpl });
      const files = plan.map(({ relay }) => ({ path: `data/${RELAY_DIR}/${relayFileName(relay.sourceId)}`, content: `${JSON.stringify(relay, null, 2)}\n` }));
      const sha = await commitFiles(call, { branch: settings.branch || 'main', files, message: commitMessage(plan) });
      settings.published = { ...(settings.published || {}) };
      for (const { relay, hash } of plan) settings.published[relay.sourceId] = { at: relay.at, hash, found: relay.items.length };
      outcome.published = plan.map(({ relay }) => relay.sourceId);
      outcome.commit = sha;
      settings.publishedAt = outcome.at;
      log(`Relais : ${plan.length} source(s) publiée(s) pour la version en ligne (${plan.map((entry) => entry.source.name).join(', ')})`);
    }
  } catch (error) {
    outcome.ok = false;
    outcome.error = error instanceof RelayError ? error.message : `Publication impossible : ${error.message}`;
    log(`Relais : ${outcome.error}`);
  }
  settings.last = outcome;
  await writeSettings(settings, file);
  return outcome;
}
