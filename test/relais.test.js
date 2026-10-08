import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildRelay, runVeille } from '../scraper/core.js';
import { HttpError } from '../scraper/lib/http.js';
import { needsRelay, relayProblem } from '../scraper/lib/relais.js';
import { commitFiles, connect, disconnect, planRelays, publicState, publishRelays, readSettings } from '../server/relais.js';
import { outOfReach, relayed } from '../site/assets/js/model.js';

const SOURCE = { id: 'wallis-futuna', name: 'Wallis-et-Futuna', url: 'https://www.wallis-et-futuna.gouv.fr/avis', type: 'page', region: 'wf', enabled: true, categories: [], options: { detect: 'liens' } };
const CONFIG = { settings: { retentionDays: 180 }, categories: [], sources: [SOURCE] };
const NOW = new Date('2026-10-09T06:00:00.000Z');
const HOUR = 3600000;

// Les serveurs de GitHub n'atteignent pas le site : chaque requête échoue sur le réseau.
const blockedHttp = {
  get: async () => {
    throw new HttpError('Impossible de joindre www.wallis-et-futuna.gouv.fr (UND_ERR_SOCKET)', { network: true });
  },
  post: async () => {
    throw new HttpError('Impossible de joindre www.wallis-et-futuna.gouv.fr (UND_ERR_SOCKET)', { network: true });
  },
};

const known = (key, extra = {}) => ({
  id: `${SOURCE.id}:${key}`,
  sourceId: SOURCE.id,
  kind: 'consultation',
  title: `Avis ${key}`,
  url: `https://www.wallis-et-futuna.gouv.fr/${key}.pdf`,
  firstSeen: '2026-10-08T09:37:47.143Z',
  lastSeen: '2026-10-08T09:37:47.143Z',
  ...extra,
});

const relayOf = (at, keys, extra = {}) => ({
  version: 1,
  sourceId: SOURCE.id,
  url: SOURCE.url,
  at: at.toISOString(),
  listing: true,
  total: keys.length,
  items: keys.map((key) => ({ key, kind: 'consultation', title: `Avis ${key}`, url: `https://www.wallis-et-futuna.gouv.fr/${key}.pdf` })),
  ...extra,
});

async function dataDir({ items = [], seeded = { [SOURCE.id]: SOURCE.url }, relay = null, status = { sources: {}, runs: [] } }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vigie-relais-'));
  await writeFile(path.join(dir, 'items.json'), JSON.stringify({ version: 1, seeded, items }));
  await writeFile(path.join(dir, 'status.json'), JSON.stringify(status));
  if (relay) {
    await mkdir(path.join(dir, 'relais'), { recursive: true });
    await writeFile(path.join(dir, 'relais', `${SOURCE.id}.json`), JSON.stringify(relay));
  }
  return dir;
}

const run = (dir, runner = 'github') => runVeille({ config: structuredClone(CONFIG), dataDir: dir, runner, http: blockedHttp, now: () => NOW });

test('relais : les annonces relevées sur le PC sont fusionnées, sans fausses nouveautés', async (t) => {
  const dir = await dataDir({ items: [known('a', { seed: true }), known('c')], relay: relayOf(new Date(NOW - HOUR), ['a', 'b']) });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await run(dir);

  assert.deepEqual(result.added.map((item) => item.id), [`${SOURCE.id}:b`], 'seule l’annonce inconnue en ligne est une nouveauté');
  const byId = new Map(result.items.map((item) => [item.id, item]));
  assert.equal(result.items.filter((item) => item.sourceId === SOURCE.id).length, 3, 'même clé : pas de doublon');
  assert.equal(byId.get(`${SOURCE.id}:a`).seed, true, 'l’annonce de départ reste « seed »');
  assert.equal(byId.get(`${SOURCE.id}:a`).firstSeen, '2026-10-08T09:37:47.143Z');
  assert.equal(byId.get(`${SOURCE.id}:b`).firstSeen, NOW.toISOString());
  assert.equal(byId.get(`${SOURCE.id}:c`).gone, true, 'absente du relevé d’une liste : retirée, comme lors d’une lecture directe');

  const status = result.status.sources[SOURCE.id];
  assert.equal(status.ok, true);
  assert.equal(status.via, 'relais');
  assert.equal(status.relayAt, new Date(NOW - HOUR).toISOString());
  assert.equal(status.lastSuccess, status.relayAt, 'dernier succès = date du relevé sur le PC');
  assert.match(status.directError, /UND_ERR_SOCKET/);
  assert.ok(relayed(status) && !outOfReach(status));
  assert.ok(needsRelay(status), 'le PC continue de relayer cette source');

  // Le même relevé repris au passage suivant ne crée aucune nouveauté.
  const again = await run(dir);
  assert.equal(again.added.length, 0);
  const saved = JSON.parse(await readFile(path.join(dir, 'items.json'), 'utf8'));
  assert.equal(saved.items.filter((item) => item.sourceId === SOURCE.id).length, 3);
});

test('relais : premier passage d’une source, les annonces relayées ne sont pas des nouveautés', async (t) => {
  const dir = await dataDir({ seeded: {}, relay: relayOf(new Date(NOW - HOUR), ['a', 'b']) });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await run(dir);
  assert.equal(result.added.length, 0);
  assert.ok(result.items.every((item) => item.seed), 'annonces marquées « seed »');
  assert.equal(result.status.sources[SOURCE.id].firstCheck, true);
});

test('relais : un relevé périmé est refusé, la source reste hors de portée', async (t) => {
  const previous = { [SOURCE.id]: { ok: true, via: 'relais', relayAt: new Date(NOW - 7 * HOUR).toISOString(), lastSuccess: new Date(NOW - 7 * HOUR).toISOString(), network: true, where: 'github' } };
  const dir = await dataDir({ items: [known('a')], relay: relayOf(new Date(NOW - 7 * HOUR), ['a', 'b']), status: { sources: previous, runs: [] } });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logs = [];
  const result = await runVeille({ config: structuredClone(CONFIG), dataDir: dir, runner: 'github', http: blockedHttp, now: () => NOW, log: (line) => logs.push(line) });

  assert.equal(result.added.length, 0);
  assert.deepEqual(result.items.map((item) => item.id), [`${SOURCE.id}:a`], 'aucune annonce du relevé périmé');
  assert.equal(result.items[0].gone, undefined, 'rien n’est retiré sans lecture');
  const status = result.status.sources[SOURCE.id];
  assert.equal(status.ok, false);
  assert.equal(status.via, undefined);
  assert.ok(outOfReach(status) && !relayed(status));
  assert.equal(status.relayAt, previous[SOURCE.id].relayAt, 'date du dernier relais conservée pour l’interface');
  assert.ok(logs.some((line) => /relevé trop ancien \(7 h\)/.test(line)));
});

test('relais : refusé s’il vient d’une autre adresse, d’un autre format ou du futur ; ignoré sur le PC', async (t) => {
  assert.equal(relayProblem(relayOf(new Date(NOW - HOUR), ['a']), SOURCE, NOW), null);
  assert.match(relayProblem(relayOf(new Date(NOW - HOUR), ['a'], { url: 'https://ancienne.adresse/' }), SOURCE, NOW), /autre adresse/);
  assert.match(relayProblem(relayOf(new Date(NOW - HOUR), ['a'], { version: 2 }), SOURCE, NOW), /format/);
  assert.match(relayProblem(relayOf(new Date(NOW.getTime() + HOUR), ['a']), SOURCE, NOW), /futur/);
  assert.match(relayProblem(relayOf(new Date(NOW - 6 * HOUR - 60000), ['a']), SOURCE, NOW), /trop ancien/);

  // Sur le PC, un site injoignable l'est vraiment : le relais ne sert qu'à la veille en ligne.
  const dir = await dataDir({ relay: relayOf(new Date(NOW - HOUR), ['a']) });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await run(dir, 'local');
  assert.equal(result.items.length, 0);
  assert.equal(result.status.sources[SOURCE.id].where, 'local');
});

test('relais : relevé construit depuis les annonces du PC, publié seulement s’il le faut', () => {
  const items = [known('b', { summary: 'Résumé', history: [{ field: 'deadline' }], seed: true }), known('a'), known('z', { gone: true }), { ...known('x'), sourceId: 'autre', id: 'autre:x' }];
  const localStatus = { sources: { [SOURCE.id]: { ok: true, url: SOURCE.url, lastSuccess: new Date(NOW - 10 * 60000).toISOString(), listing: true, total: 2 } } };
  const relay = buildRelay({ source: SOURCE, items, status: localStatus.sources[SOURCE.id] });
  assert.deepEqual(relay.items.map((item) => item.key), ['a', 'b'], 'annonces actuelles de la source, triées par clé');
  assert.equal(relay.items[1].summary, 'Résumé');
  assert.ok(!('firstSeen' in relay.items[0]) && !('seed' in relay.items[1]) && !('history' in relay.items[1]), 'l’historique du PC n’est pas publié');
  assert.equal(relayProblem(relay, SOURCE, NOW), null, 'le relevé publié est accepté par la veille en ligne');

  const online = { sources: { [SOURCE.id]: { ok: false, network: true, where: 'github' } } };
  const first = planRelays({ config: CONFIG, items, localStatus, onlineStatus: online, now: NOW });
  assert.equal(first.length, 1);
  const published = { [SOURCE.id]: { at: first[0].relay.at, hash: first[0].hash } };
  assert.equal(planRelays({ config: CONFIG, items, localStatus, onlineStatus: online, published, now: NOW }).length, 0, 'relevé déjà publié');

  const later = { sources: { [SOURCE.id]: { ...localStatus.sources[SOURCE.id], lastSuccess: new Date(NOW.getTime() + HOUR).toISOString() } } };
  assert.equal(planRelays({ config: CONFIG, items, localStatus: later, onlineStatus: online, published, now: new Date(NOW.getTime() + HOUR) }).length, 0, 'sans changement, pas de commit à chaque passage');
  assert.equal(planRelays({ config: CONFIG, items, localStatus: later, onlineStatus: online, published, now: new Date(NOW.getTime() + HOUR), force: true }).length, 1, '« Publier maintenant »');
  const muchLater = { sources: { [SOURCE.id]: { ...localStatus.sources[SOURCE.id], lastSuccess: new Date(NOW.getTime() + 3 * HOUR).toISOString() } } };
  assert.equal(planRelays({ config: CONFIG, items, localStatus: muchLater, onlineStatus: online, published, now: new Date(NOW.getTime() + 3 * HOUR) }).length, 1, 'republié pour rester récent');
  const changed = [...items, known('c')];
  assert.equal(planRelays({ config: CONFIG, items: changed, localStatus, onlineStatus: online, published, now: NOW }).length, 1, 'nouvelle annonce : publiée tout de suite');

  const reachable = { sources: { [SOURCE.id]: { ok: true, where: 'github' } } };
  assert.equal(planRelays({ config: CONFIG, items, localStatus, onlineStatus: reachable, now: NOW }).length, 0, 'site lu directement en ligne : pas de relais');
  assert.equal(planRelays({ config: CONFIG, items, localStatus, onlineStatus: null, published, now: NOW, force: true }).length, 0, 'version en ligne injoignable : seulement les sources déjà relayées');
  assert.equal(planRelays({ config: CONFIG, items, localStatus, onlineStatus: null, now: NOW }).length, 0);
  const old = { sources: { [SOURCE.id]: { ...localStatus.sources[SOURCE.id], lastSuccess: new Date(NOW - 7 * HOUR).toISOString() } } };
  assert.equal(planRelays({ config: CONFIG, items, localStatus: old, onlineStatus: online, now: NOW }).length, 0, 'lecture du PC trop ancienne');
  const failed = { sources: { [SOURCE.id]: { ...localStatus.sources[SOURCE.id], ok: false } } };
  assert.equal(planRelays({ config: CONFIG, items, localStatus: failed, onlineStatus: online, now: NOW }).length, 0, 'échec sur le PC : rien à relayer');
});

test('relais : tous les relevés partent en un seul commit, même si la veille en ligne pousse entre-temps', async () => {
  const calls = [];
  let head = 'c1';
  let raced = false;
  const call = async (route, { method = 'GET', body } = {}) => {
    calls.push(`${method} ${route}`);
    if (route === '/git/refs/heads/main' && method === 'GET') return { object: { sha: head } };
    if (route.startsWith('/git/commits/')) return { tree: { sha: `tree-${route.split('/').pop()}` } };
    if (route === '/git/trees') return { sha: `new-tree-${body.tree.length}` };
    if (route === '/git/commits') return { sha: `commit-on-${body.parents[0]}` };
    if (route === '/git/refs/heads/main' && method === 'PATCH') {
      if (!raced) {
        raced = true;
        head = 'c2';
        throw Object.assign(new Error('Update is not a fast forward'), { status: 422 });
      }
      return { object: { sha: body.sha } };
    }
    throw new Error(`route inattendue ${route}`);
  };
  const files = [
    { path: 'data/relais/wallis-futuna.json', content: '{}' },
    { path: 'data/relais/mont-dore.json', content: '{}' },
  ];
  const sha = await commitFiles(call, { branch: 'main', files, message: 'Relais' });
  assert.equal(sha, 'commit-on-c2', 'reparti de la nouvelle tête de branche');
  assert.equal(calls.filter((entry) => entry === 'PATCH /git/refs/heads/main').length, 2);
  assert.equal(calls.filter((entry) => entry === 'POST /git/trees').length, 2);
});

test('relais : publication depuis le PC, puis désactivation pendant une publication', async (t) => {
  const lastSuccess = new Date(Date.now() - 10 * 60000).toISOString();
  const dir = await dataDir({ items: [known('a'), known('b')], status: { sources: { [SOURCE.id]: { ok: true, url: SOURCE.url, lastSuccess, listing: true, total: 2 } }, runs: [] } });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'relais.json');
  const token = `github_pat_${'Z9'.repeat(40)}`;
  await writeFile(file, JSON.stringify({ token, repository: 'gharel/scraping', branch: 'main', published: {} }));

  const commits = [];
  let onPatch = async () => {};
  const fetchImpl = async (url, options = {}) => {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.startsWith('https://gharel.github.io/scraping/data/status.json')) return json({ sources: { [SOURCE.id]: { ok: false, network: true, where: 'github' } } });
    const route = url.replace('https://api.github.com/repos/gharel/scraping', '');
    const body = options.body ? JSON.parse(options.body) : null;
    if (route === '/git/refs/heads/main' && options.method === 'GET') return json({ object: { sha: 'head' } });
    if (route === '/git/commits/head') return json({ tree: { sha: 'base-tree' } });
    if (route === '/git/trees') {
      commits.push(body.tree);
      return json({ sha: 'new-tree' }, 201);
    }
    if (route === '/git/commits') return json({ sha: 'new-commit' }, 201);
    if (route === '/git/refs/heads/main' && options.method === 'PATCH') {
      await onPatch();
      return json({ object: { sha: body.sha } });
    }
    return json({ message: 'Not Found' }, 404);
  };

  const outcome = await publishRelays({ config: CONFIG, dataDir: dir, fetchImpl, file });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.published, [SOURCE.id]);
  assert.equal(commits.length, 1);
  assert.equal(commits[0][0].path, `data/relais/${SOURCE.id}.json`);
  const relay = JSON.parse(commits[0][0].content);
  assert.equal(relay.at, lastSuccess);
  assert.deepEqual(relay.items.map((item) => item.key), ['a', 'b']);
  const saved = await readSettings(file);
  assert.equal(saved.token, token);
  assert.equal(saved.published[SOURCE.id].at, lastSuccess);

  assert.equal((await publishRelays({ config: CONFIG, dataDir: dir, fetchImpl, file })).published.length, 0, 'relevé inchangé : pas de nouveau commit');
  assert.equal(commits.length, 1);

  // « Désactiver le relais » pendant une publication (nouvelle lecture sur le PC, « Publier maintenant ») :
  // le jeton retiré ne revient pas.
  const newer = new Date(Date.now() - 60000).toISOString();
  await writeFile(path.join(dir, 'status.json'), JSON.stringify({ sources: { [SOURCE.id]: { ok: true, url: SOURCE.url, lastSuccess: newer, listing: true, total: 2 } }, runs: [] }));
  onPatch = () => disconnect(file);
  const raced = await publishRelays({ config: CONFIG, dataDir: dir, fetchImpl, file, force: true });
  assert.deepEqual(raced.published, [SOURCE.id]);
  assert.equal(commits.length, 2);
  assert.equal((await readSettings(file)).token, undefined);
  assert.equal(await publishRelays({ config: CONFIG, dataDir: dir, fetchImpl, file, force: true }), null, 'relais désactivé : plus rien n’est publié');
});

test('relais : le jeton est vérifié, gardé sur le PC et jamais renvoyé à l’interface', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vigie-jeton-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'relais.json');
  const token = `github_pat_${'A1b2'.repeat(20)}`;
  await assert.rejects(connect({ token: 'pas-un-jeton', repository: 'gharel/scraping', file }), /ne ressemble pas/);

  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, method: options.method, auth: options.headers.Authorization });
    const body = url.endsWith('/git/blobs') ? { sha: 'blob' } : { full_name: 'gharel/scraping', default_branch: 'main' };
    return new Response(JSON.stringify(body), { status: url.endsWith('/git/blobs') ? 201 : 200 });
  };
  const settings = await connect({ token, repository: 'gharel/scraping', fetchImpl, file });
  assert.equal(settings.branch, 'main');
  assert.deepEqual(requests.map((entry) => `${entry.method} ${entry.url}`), ['GET https://api.github.com/repos/gharel/scraping', 'POST https://api.github.com/repos/gharel/scraping/git/blobs']);
  assert.ok(requests.every((entry) => entry.auth === `Bearer ${token}`));
  assert.equal((await readSettings(file)).token, token);
  const state = publicState(await readSettings(file));
  assert.equal(state.configured, true);
  assert.ok(!JSON.stringify(state).includes(token), 'le jeton ne sort pas du PC');

  const refused = async () => new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), { status: 403 });
  await assert.rejects(connect({ token, repository: 'gharel/scraping', fetchImpl: refused, file }), /Contents/);
});
