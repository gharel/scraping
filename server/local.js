#!/usr/bin/env node
/**
 * Vigie en local : interface web + vérifications automatiques depuis votre ordinateur.
 *   npm start                      http://localhost:4700, vérification toutes les N minutes
 *   npm start -- --port 5000       autre port
 *   npm start -- --no-open         sans ouvrir le navigateur
 *   npm start -- --data dossier    autre dossier de données (par défaut : local-data/)
 */
import { spawn } from 'node:child_process';
import { cp, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { previewSource, runVeille } from '../scraper/core.js';
import { DEFAULT_CONFIG_FILE, ROOT_DIR, readConfig, writeConfig } from '../scraper/lib/config-file.js';
import { normalizeSource, sourceProblems } from '../site/assets/js/shared/config.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const SITE_DIR = path.join(ROOT_DIR, 'site');
const DATA_DIR = path.resolve(option('data', path.join(ROOT_DIR, 'local-data')));
const START_PORT = Number(option('port', process.env.PORT || 4700));
const OPEN_BROWSER = !args.includes('--no-open');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const state = {
  running: false,
  timer: null,
  nextRunAt: null,
  lastRunStartedAt: null,
  lastRunFinishedAt: null,
  lastResult: null,
  intervalMinutes: 60,
};

const log = (message) => console.log(`[${new Date().toLocaleTimeString('fr-FR')}] ${message}`);

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Au premier lancement, reprend l'historique publié (data/) pour ne pas repartir de zéro. */
async function prepareDataDir() {
  if (await exists(path.join(DATA_DIR, 'items.json'))) return;
  const published = path.join(ROOT_DIR, 'data');
  if (path.resolve(published) !== DATA_DIR && (await exists(path.join(published, 'items.json')))) {
    await cp(published, DATA_DIR, { recursive: true, filter: (source) => !source.endsWith('deploy.json') });
    log(`Historique repris depuis data/ vers ${path.relative(ROOT_DIR, DATA_DIR) || DATA_DIR}`);
  }
}

async function runOnce(only = null) {
  if (state.running) return false;
  state.running = true;
  state.lastRunStartedAt = new Date().toISOString();
  try {
    const { config, errors } = await readConfig();
    const categoryIds = new Set(config.categories.map((category) => category.id));
    for (const source of config.sources) {
      const problems = sourceProblems(source, categoryIds);
      if (problems.length) source.invalid = problems.join(' ; ');
    }
    if (errors.length) log(`Configuration : ${errors.length} point(s) à corriger`);
    log(only ? `Vérification de ${only.join(', ')}…` : 'Vérification de toutes les sources…');
    const result = await runVeille({ config, dataDir: DATA_DIR, only, log: (line) => log(`  ${line}`) });
    state.lastResult = { added: result.summary.added, errors: result.summary.errors, checked: result.summary.checked };
    log(`Terminé : ${result.summary.added} nouveauté(s), ${result.summary.errors} erreur(s).`);
    if (result.added.length) {
      for (const item of result.added.slice(0, 10)) log(`  + ${item.title}`);
    }
  } catch (error) {
    state.lastResult = { added: 0, errors: 1, checked: 0, error: error.message };
    log(`Échec de la vérification : ${error.message}`);
  } finally {
    state.running = false;
    state.lastRunFinishedAt = new Date().toISOString();
  }
  return true;
}

async function schedule() {
  clearTimeout(state.timer);
  try {
    const { config } = await readConfig();
    state.intervalMinutes = config.settings.localIntervalMinutes;
  } catch {
    /* configuration illisible : on garde l'intervalle précédent */
  }
  const delay = state.intervalMinutes * 60000;
  state.nextRunAt = new Date(Date.now() + delay).toISOString();
  state.timer = setTimeout(async () => {
    await runOnce();
    schedule();
  }, delay);
}

async function readBody(request, limit = 512 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Requête trop volumineuse'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('JSON invalide'), { status: 400 });
  }
}

function send(response, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  response.writeHead(status, {
    'Content-Type': isJson ? TYPES['.json'] : headers['Content-Type'] || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers,
  });
  response.end(isJson ? JSON.stringify(body) : body);
}

async function serveFile(response, root, relative) {
  const file = path.resolve(root, `.${path.sep}${relative}`);
  if (!file.startsWith(root + path.sep) && file !== root) return send(response, 403, 'Accès refusé');
  try {
    const info = await stat(file);
    const target = info.isDirectory() ? path.join(file, 'index.html') : file;
    const content = await readFile(target);
    send(response, 200, content, { 'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream' });
  } catch {
    send(response, 404, 'Introuvable');
  }
}

async function handleApi(request, response, pathname, port) {
  if (request.headers['x-vigie'] !== '1') return send(response, 403, { error: 'En-tête X-Vigie manquant' });
  if (pathname === '/api/status' && request.method === 'GET') {
    return send(response, 200, {
      mode: 'local',
      running: state.running,
      intervalMinutes: state.intervalMinutes,
      nextRunAt: state.running ? null : state.nextRunAt,
      lastRunStartedAt: state.lastRunStartedAt,
      lastRunFinishedAt: state.lastRunFinishedAt,
      lastResult: state.lastResult,
      dataDir: path.relative(ROOT_DIR, DATA_DIR) || DATA_DIR,
      port,
    });
  }
  if (pathname === '/api/run' && request.method === 'POST') {
    const body = await readBody(request);
    if (state.running) return send(response, 409, { error: 'Une vérification est déjà en cours' });
    const only = Array.isArray(body.only) && body.only.length ? body.only.map(String) : null;
    runOnce(only).then(() => {
      if (!only) schedule();
    });
    return send(response, 202, { started: true });
  }
  if (pathname === '/api/config' && request.method === 'GET') {
    const { config } = await readConfig();
    return send(response, 200, config);
  }
  if (pathname === '/api/config' && request.method === 'PUT') {
    const body = await readBody(request);
    try {
      const config = await writeConfig(body, DEFAULT_CONFIG_FILE);
      log('Configuration enregistrée');
      schedule();
      return send(response, 200, { config });
    } catch (error) {
      return send(response, 400, { error: error.validation ? error.validation[0] : error.message });
    }
  }
  if (pathname === '/api/test-source' && request.method === 'POST') {
    const source = normalizeSource(await readBody(request));
    const { config } = await readConfig();
    const problems = sourceProblems(source, new Set(config.categories.map((category) => category.id)));
    if (problems.length) return send(response, 400, { error: `À corriger : ${problems.join(' ; ')}` });
    try {
      return send(response, 200, await previewSource(source));
    } catch (error) {
      return send(response, 422, { error: error.message });
    }
  }
  return send(response, 404, { error: 'Route inconnue' });
}

function createApp(port) {
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  return createServer(async (request, response) => {
    try {
      // Protection contre le « DNS rebinding » : seules les adresses locales sont acceptées.
      if (!allowedHosts.has(String(request.headers.host || '').toLowerCase())) return send(response, 403, 'Hôte non autorisé');
      const { pathname } = new URL(request.url, `http://${request.headers.host}`);
      const decoded = decodeURIComponent(pathname);
      if (decoded.startsWith('/api/')) return await handleApi(request, response, decoded, port);
      if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, 'Méthode non autorisée');
      if (decoded.startsWith('/data/')) return await serveFile(response, DATA_DIR, decoded.slice('/data/'.length));
      if (decoded === '/config/veille.json') return await serveFile(response, path.dirname(DEFAULT_CONFIG_FILE), 'veille.json');
      return await serveFile(response, SITE_DIR, decoded === '/' ? 'index.html' : decoded.slice(1));
    } catch (error) {
      send(response, error.status || 500, { error: error.message || 'Erreur interne' });
    }
  });
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const commandArgs = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(command, commandArgs, { detached: true, stdio: 'ignore', windowsVerbatimArguments: process.platform === 'win32' }).unref();
  } catch {
    /* pas de navigateur disponible */
  }
}

async function listen(port, attempt = 0) {
  const server = createApp(port);
  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' && attempt < 10) resolve(listen(port + 1, attempt + 1));
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, port }));
  });
}

async function main() {
  await prepareDataDir();
  const { port } = await listen(START_PORT);
  const url = `http://localhost:${port}/`;
  log(`Vigie est lancé : ${url}`);
  log(`Données : ${DATA_DIR}`);
  log('Arrêt : Ctrl+C');
  if (OPEN_BROWSER) openBrowser(url);

  // Première vérification si la dernière date de plus d'un intervalle.
  const { config } = await readConfig();
  state.intervalMinutes = config.settings.localIntervalMinutes;
  let lastUpdate = 0;
  try {
    lastUpdate = Date.parse(JSON.parse(await readFile(path.join(DATA_DIR, 'status.json'), 'utf8')).updatedAt) || 0;
  } catch {
    lastUpdate = 0;
  }
  if (Date.now() - lastUpdate > state.intervalMinutes * 60000) {
    await runOnce();
  } else {
    state.lastRunFinishedAt = new Date(lastUpdate).toISOString();
  }
  schedule();
}

main().catch((error) => {
  console.error(`Impossible de lancer Vigie : ${error.message}`);
  process.exit(1);
});
