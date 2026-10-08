/**
 * Lecture et écriture des données de la veille (fichiers JSON).
 *   items.json      toutes les annonces connues
 *   status.json     état de chaque source et historique des passages
 *   snapshots/      dernier état des pages surveillées
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Fichier illisible : ${file} (${error.message})`);
  }
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

const safeName = (id) => String(id).replace(/[^a-z0-9-]/gi, '_');

export async function loadStore(dataDir) {
  const itemsFile = path.join(dataDir, 'items.json');
  const statusFile = path.join(dataDir, 'status.json');
  const snapshotsDir = path.join(dataDir, 'snapshots');
  const itemsData = await readJson(itemsFile, { items: [] });
  const status = await readJson(statusFile, { sources: {}, runs: [] });
  status.sources ??= {};
  status.runs ??= [];

  return {
    items: Array.isArray(itemsData.items) ? itemsData.items : [],
    // Sources déjà initialisées (id → adresse) : leurs annonces suivantes sont de vraies nouveautés.
    seeded: itemsData.seeded && typeof itemsData.seeded === 'object' ? itemsData.seeded : {},
    status,
    async readSnapshot(sourceId) {
      return readJson(path.join(snapshotsDir, `${safeName(sourceId)}.json`), null);
    },
    async writeSnapshot(sourceId, snapshot) {
      await writeJson(path.join(snapshotsDir, `${safeName(sourceId)}.json`), snapshot);
    },
    async cleanSnapshots(keepIds) {
      const keep = new Set([...keepIds].map((id) => `${safeName(id)}.json`));
      let files = [];
      try {
        files = await readdir(snapshotsDir);
      } catch {
        return;
      }
      await Promise.all(files.filter((file) => file.endsWith('.json') && !keep.has(file)).map((file) => rm(path.join(snapshotsDir, file), { force: true })));
    },
    /**
     * items.json ne contient aucun horodatage de passage : il ne change que si les annonces changent
     * (ou une fois par jour au plus), ce qui évite un commit à chaque vérification.
     * status.json, lui, est réécrit à chaque passage.
     */
    async save({ items, seeded, status: nextStatus }) {
      await writeJson(itemsFile, { version: 1, seeded, items });
      await writeJson(statusFile, nextStatus);
    },
  };
}
