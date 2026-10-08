/**
 * Chargement des données et enregistrement de la configuration selon le mode :
 *  - local     : serveur Vigie lancé sur le PC (npm start), modifications immédiates ;
 *  - github    : version en ligne + jeton GitHub, modifications publiées par commit ;
 *  - lecture   : version en ligne sans jeton, consultation seule.
 */
import { normalizeConfig, serializeConfig, validateConfig } from './shared/config.js';
import { createGitHubClient } from './github.js';
import * as prefs from './prefs.js';

const CONFIG_PATH = 'config/veille.json';

async function getJson(path, fallback, api = path.startsWith('api/')) {
  try {
    const response = await fetch(`${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store', headers: api ? { 'X-Vigie': '1' } : {} });
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

export async function detectLocal() {
  // Le serveur local n'existe que sur l'ordinateur (localhost) : inutile de le chercher en ligne.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return null;
  try {
    const response = await fetch('api/status', { cache: 'no-store', headers: { 'X-Vigie': '1' } });
    if (!response.ok) return null;
    const status = await response.json();
    return status?.mode === 'local' ? status : null;
  } catch {
    return null;
  }
}

export async function loadData({ local = false } = {}) {
  const [rawConfig, itemsData, status, deploy] = await Promise.all([
    getJson(local ? 'api/config' : CONFIG_PATH, null, local),
    getJson('data/items.json', { items: [] }),
    getJson('data/status.json', { sources: {}, runs: [] }),
    // deploy.json n'existe que sur la version en ligne.
    local ? Promise.resolve(null) : getJson('data/deploy.json', null),
  ]);
  return {
    config: normalizeConfig(rawConfig || {}),
    configMissing: !rawConfig,
    items: Array.isArray(itemsData?.items) ? itemsData.items : [],
    status: status || { sources: {}, runs: [] },
    deploy,
  };
}

function checked(config) {
  const normalized = normalizeConfig(config);
  const errors = validateConfig(normalized);
  if (errors.length) throw new Error(errors[0]);
  return normalized;
}

function localBackend() {
  const headers = { 'Content-Type': 'application/json', 'X-Vigie': '1' };
  return {
    kind: 'local',
    canEdit: true,
    canTest: true,
    async updateConfig(mutate) {
      const current = normalizeConfig(await getJson('api/config', {}));
      const next = checked(mutate(structuredClone(current)));
      const response = await fetch('api/config', { method: 'PUT', headers, body: serializeConfig(next) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Enregistrement impossible');
      return { config: normalizeConfig(body.config || next), message: 'Enregistré.' };
    },
    async runNow(only) {
      const response = await fetch('api/run', { method: 'POST', headers, body: JSON.stringify({ only: only || null }) });
      const body = await response.json().catch(() => ({}));
      // 409 : une vérification tourne déjà ; on attend simplement sa fin.
      if (!response.ok && response.status !== 409) throw new Error(body.error || 'La vérification n’a pas pu démarrer');
      return { started: true, local: true };
    },
    async status() {
      return detectLocal();
    },
    async testSource(source) {
      const response = await fetch('api/test-source', { method: 'POST', headers, body: JSON.stringify(source) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Test impossible');
      return body;
    },
  };
}

function githubBackend(deploy, token) {
  const client = createGitHubClient({ token, repository: deploy.repository, branch: deploy.branch || 'main' });
  const workflow = deploy.workflow || 'veille.yml';
  return {
    kind: 'github',
    canEdit: true,
    canTest: false,
    client,
    async updateConfig(mutate, message = 'Vigie : mise à jour de la configuration') {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const file = await client.readText(CONFIG_PATH);
        const current = normalizeConfig(JSON.parse(file.text));
        const next = checked(mutate(structuredClone(current)));
        try {
          await client.writeText(CONFIG_PATH, serializeConfig(next), file.sha, message);
          return { config: next, message: 'Enregistré sur GitHub. La mise en ligne prend 1 à 2 minutes.' };
        } catch (error) {
          if (error.status !== 409 || attempt === 1) throw error;
        }
      }
      throw new Error('Enregistrement impossible');
    },
    async runNow() {
      await client.dispatch(workflow);
      return { started: true, local: false };
    },
    async status() {
      return null;
    },
  };
}

function readonlyBackend(deploy) {
  const repository = deploy?.repository;
  const branch = deploy?.branch || 'main';
  return {
    kind: 'lecture',
    canEdit: false,
    canTest: false,
    editUrl: repository ? `https://github.com/${repository}/edit/${branch}/${CONFIG_PATH}` : '',
    actionsUrl: repository ? `https://github.com/${repository}/actions/workflows/${deploy.workflow || 'veille.yml'}` : '',
    async updateConfig() {
      throw new Error('Connectez votre compte GitHub dans Réglages pour modifier la veille en ligne.');
    },
    async runNow() {
      throw new Error('Connectez votre compte GitHub dans Réglages pour lancer une vérification.');
    },
    async status() {
      return null;
    },
  };
}

export function createBackend({ local, deploy }) {
  if (local) return localBackend();
  const token = prefs.read('githubToken');
  if (token && deploy?.repository) return githubBackend(deploy, token);
  return readonlyBackend(deploy);
}

export async function connectGitHub(deploy, token) {
  const client = createGitHubClient({ token, repository: deploy.repository, branch: deploy.branch || 'main' });
  await client.check();
  prefs.write('githubToken', token);
}

export function disconnectGitHub() {
  prefs.write('githubToken', null);
}
