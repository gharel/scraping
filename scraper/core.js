/**
 * Cœur de la veille : interroge chaque source, fusionne les annonces avec l'historique,
 * met à jour l'état des sources et renvoie les nouveautés.
 */
import { getAdapter } from './adapters/index.js';
import { createHttpClient } from './lib/http.js';
import { RELAY_VERSION, relayItems, relayProblem } from './lib/relais.js';
import { loadStore } from './lib/store.js';
import { cleanText, oneLine } from './lib/text.js';

const LIMITS = {
  title: 400,
  summary: 2500,
  reference: 120,
  buyer: 200,
  buyerLocation: 120,
  location: 200,
  nature: 80,
  procedure: 200,
  procedureCode: 20,
  status: 80,
};
const TRACKED_FIELDS = ['deadline', 'title'];
const MAX_ITEMS_PER_SOURCE = 400;
// Où tourne la vérification : sur les serveurs de GitHub (veille en ligne) ou sur ce PC.
const RUNNER = process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'local';

export function sanitizeItem(raw) {
  const out = { kind: raw.kind || 'annonce' };
  for (const [field, max] of Object.entries(LIMITS)) {
    const value = field === 'summary' ? cleanText(raw[field]) : oneLine(raw[field]);
    if (value) out[field] = value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }
  if (raw.url) out.url = raw.url;
  if (raw.publishedAt) out.publishedAt = raw.publishedAt;
  if (raw.deadline) out.deadline = raw.deadline;
  if (Number.isInteger(raw.lots) && raw.lots > 1) out.lots = raw.lots;
  if (Array.isArray(raw.tags) && raw.tags.length) out.tags = raw.tags.slice(0, 10).map((tag) => oneLine(tag).slice(0, 60));
  return out;
}

/**
 * Fusionne les annonces lues sur une source avec les annonces connues.
 * - nouvelle annonce : firstSeen = maintenant (marquée « seed » lors du tout premier passage) ;
 * - annonce connue : champs mis à jour, changements de date limite ou de titre historisés ;
 * - annonce disparue d'une liste : marquée « gone ».
 */
export function mergeSourceItems(allItems, source, rawItems, { now, firstRun = false, listing = true }) {
  const nowIso = now.toISOString();
  const byId = new Map(allItems.map((item) => [item.id, item]));
  const seen = new Set();
  const added = [];
  const updated = [];

  for (const raw of rawItems) {
    if (!raw?.key) continue;
    const id = `${source.id}:${raw.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const fields = sanitizeItem(raw);
    const current = byId.get(id);
    if (!current) {
      const item = { id, sourceId: source.id, ...fields, firstSeen: nowIso, lastSeen: nowIso };
      if (firstRun) item.seed = true;
      byId.set(id, item);
      added.push(item);
      continue;
    }
    const changes = TRACKED_FIELDS.filter((field) => fields[field] && current[field] && fields[field] !== current[field]).map((field) => ({
      at: nowIso,
      field,
      from: current[field],
      to: fields[field],
    }));
    for (const key of Object.keys(LIMITS)) if (!(key in fields)) delete current[key];
    Object.assign(current, fields);
    // « lastSeen » n'avance qu'une fois par jour : les données ne changent pas à chaque passage.
    if (!current.lastSeen || current.lastSeen.slice(0, 10) !== nowIso.slice(0, 10)) current.lastSeen = nowIso;
    delete current.gone;
    delete current.goneAt;
    if (changes.length) {
      current.updatedAt = nowIso;
      current.history = [...(current.history || []), ...changes].slice(-10);
      updated.push(current);
    }
  }

  if (listing) {
    for (const item of byId.values()) {
      if (item.sourceId === source.id && !seen.has(item.id) && !item.gone) {
        item.gone = true;
        item.goneAt = nowIso;
      }
    }
  }
  return { items: [...byId.values()], added, updated };
}

const sortDate = (item) => Date.parse(item.publishedAt || item.firstSeen) || 0;

/** Supprime les annonces trop anciennes et celles des sources retirées de la configuration. */
export function pruneItems(items, { now, retentionDays, sourceIds }) {
  const limit = now.getTime() - retentionDays * 86400000;
  const kept = items.filter((item) => sourceIds.has(item.sourceId) && (Date.parse(item.lastSeen) || 0) >= limit);
  kept.sort((a, b) => sortDate(b) - sortDate(a) || (Date.parse(b.firstSeen) || 0) - (Date.parse(a.firstSeen) || 0));
  const perSource = new Map();
  return kept.filter((item) => {
    const count = (perSource.get(item.sourceId) || 0) + 1;
    perSource.set(item.sourceId, count);
    return count <= MAX_ITEMS_PER_SOURCE;
  });
}

/**
 * Relevé d'une source à publier pour la veille en ligne : ses annonces actuelles (non retirées),
 * avec la même clé que lors d'une lecture directe, et la date de la dernière lecture réussie.
 */
export function buildRelay({ source, items, status }) {
  const prefix = `${source.id}:`;
  const list = items
    .filter((item) => item.sourceId === source.id && !item.gone && String(item.id).startsWith(prefix))
    .map((item) => ({ key: item.id.slice(prefix.length), ...sanitizeItem(item) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    version: RELAY_VERSION,
    sourceId: source.id,
    url: source.url,
    at: status.lastSuccess,
    listing: Boolean(status.listing),
    total: status.total ?? list.length,
    items: list,
  };
}

/** Relais publié par le PC pour cette source, s'il est récent et correspond à la même adresse. */
async function freshRelay(store, source, now, log) {
  let relay;
  try {
    relay = await store.readRelay(source.id);
  } catch (error) {
    log(`  relais illisible : ${error.message}`);
    return null;
  }
  if (!relay) return null;
  const problem = relayProblem(relay, source, now);
  if (problem) {
    log(`  relais ignoré : ${problem}`);
    return null;
  }
  return { ...relay, items: relayItems(relay) };
}

export async function runVeille({ config, dataDir, only = null, log = () => {}, now = () => new Date(), runner = RUNNER, http = createHttpClient() }) {
  const store = await loadStore(dataDir);
  const startedAt = now();
  const status = store.status;
  const seeded = { ...store.seeded };
  let items = store.items;
  const added = [];
  const updated = [];
  const report = [];

  // Fusionne les annonces lues (ou relayées) d'une source et renvoie ses vraies nouveautés.
  const integrate = (source, rawItems, { runAt, listing }) => {
    // Premier passage (ou adresse modifiée) : les annonces déjà en ligne ne sont pas des nouveautés.
    const firstRun = seeded[source.id] !== source.url;
    // Adresse modifiée : les annonces de l'ancienne adresse sont remplacées, pas marquées « retirées ».
    if (seeded[source.id] && firstRun) items = items.filter((item) => item.sourceId !== source.id);
    const merged = mergeSourceItems(items, source, rawItems, { now: runAt, firstRun, listing });
    seeded[source.id] = source.url;
    items = merged.items;
    const fresh = merged.added.filter((item) => !item.seed);
    added.push(...fresh);
    updated.push(...merged.updated);
    return { fresh, firstRun };
  };

  for (const source of config.sources.filter((entry) => entry.invalid)) {
    status.sources[source.id] = {
      ...(status.sources[source.id] || {}),
      url: source.url,
      type: source.type,
      ok: false,
      error: `Configuration à corriger : ${source.invalid}`,
    };
  }
  const sources = config.sources.filter((source) => !source.invalid && (only ? only.includes(source.id) : source.enabled));
  for (const source of sources) {
    const began = Date.now();
    const runAt = now();
    const previous = status.sources[source.id] || {};
    try {
      const adapter = getAdapter(source.type);
      const snapshot = adapter.listing ? null : await store.readSnapshot(source.id);
      const result = await adapter.fetch(source, { http, log, now: runAt, snapshot });
      // Une page en mode « liens » se comporte comme une liste : un lien disparu = annonce retirée.
      const listing = Boolean(result.listing ?? adapter.listing);
      const { fresh, firstRun } = integrate(source, result.items, { runAt, listing });
      if (result.snapshot) await store.writeSnapshot(source.id, result.snapshot);
      status.sources[source.id] = {
        url: source.url,
        type: source.type,
        ok: true,
        error: null,
        lastRun: runAt.toISOString(),
        lastSuccess: runAt.toISOString(),
        found: result.items.length,
        total: result.meta?.total ?? result.items.length,
        added: fresh.length,
        firstCheck: Boolean(firstRun || result.meta?.firstCheck),
        durationMs: Date.now() - began,
        failures: 0,
        listing,
        where: runner,
      };
      report.push({ source, ok: true, found: result.items.length, added: fresh.length });
      log(`✓ ${source.name} : ${result.items.length} élément(s) lu(s), ${fresh.length} nouveauté(s)${firstRun ? ' (premier passage)' : ''}`);
    } catch (error) {
      const message = oneLine(error?.message || String(error)).slice(0, 300);
      // Site que GitHub n'atteint pas : on reprend le relevé récent publié par Vigie sur le PC.
      const relay = error?.network && runner === 'github' ? await freshRelay(store, source, runAt, log) : null;
      if (relay) {
        const { fresh, firstRun } = integrate(source, relay.items, { runAt, listing: Boolean(relay.listing) });
        status.sources[source.id] = {
          url: source.url,
          type: source.type,
          ok: true,
          error: null,
          lastRun: runAt.toISOString(),
          lastSuccess: relay.at,
          found: relay.items.length,
          total: relay.total ?? relay.items.length,
          added: fresh.length,
          firstCheck: firstRun,
          durationMs: Date.now() - began,
          failures: 0,
          listing: Boolean(relay.listing),
          network: true,
          where: runner,
          via: 'relais',
          relayAt: relay.at,
          directError: message,
        };
        report.push({ source, ok: true, found: relay.items.length, added: fresh.length, relayed: true });
        log(`↪ ${source.name} : injoignable depuis GitHub, ${relay.items.length} élément(s) relayé(s) par le PC (relevé du ${relay.at}), ${fresh.length} nouveauté(s)`);
        continue;
      }
      const { via, directError, ...rest } = previous;
      status.sources[source.id] = {
        ...rest,
        url: source.url,
        type: source.type,
        ok: false,
        error: message,
        // Site injoignable (filtrage, panne) plutôt que source à corriger.
        network: Boolean(error?.network),
        lastRun: runAt.toISOString(),
        durationMs: Date.now() - began,
        failures: (previous.failures || 0) + 1,
        where: runner,
      };
      report.push({ source, ok: false, error: message });
      log(`✗ ${source.name} : ${message}`);
    }
  }

  const finishedAt = now();
  const sourceIds = new Set(config.sources.map((source) => source.id));
  items = pruneItems(items, { now: finishedAt, retentionDays: config.settings.retentionDays, sourceIds });
  for (const id of Object.keys(status.sources)) if (!sourceIds.has(id)) delete status.sources[id];
  for (const id of Object.keys(seeded)) if (!sourceIds.has(id)) delete seeded[id];
  await store.cleanSnapshots(sourceIds);

  const errors = report.filter((entry) => !entry.ok).length;
  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    checked: report.length,
    errors,
    added: added.length,
    partial: Boolean(only),
  };
  status.lastRun = summary;
  status.runs = [...status.runs, { at: summary.startedAt, checked: summary.checked, added: summary.added, errors }].slice(-60);
  status.updatedAt = summary.finishedAt;

  await store.save({ items, seeded, status });
  return { added, updated, report, summary, items, status };
}

/** Teste une source sans rien enregistrer (aperçu dans l'interface locale). */
export async function previewSource(source, { log = () => {} } = {}) {
  const adapter = getAdapter(source.type);
  const http = createHttpClient({ retries: 0, timeoutMs: 30000 });
  const result = await adapter.fetch(source, { http, log, now: new Date(), snapshot: null });
  const snapshot = result.snapshot;
  return {
    type: source.type,
    listing: Boolean(result.listing ?? adapter.listing),
    found: result.items.length,
    total: result.meta?.total ?? result.items.length,
    items: result.items.slice(0, 6).map(sanitizeItem),
    sample: snapshot ? snapshot.lines.slice(0, 8) : [],
    lines: snapshot?.lines.length ?? null,
  };
}
