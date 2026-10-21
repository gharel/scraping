#!/usr/bin/env node
/**
 * Lance un passage de veille.
 *   npm run scrape                      toutes les sources actives, données dans data/
 *   npm run scrape -- --only id1,id2    seulement certaines sources
 *   npm run scrape -- --data dossier    autre dossier de données
 *   npm run scrape -- --digest recap.json
 *       met en file les nouveautés de vos catégories et, à l'heure du récapitulatif quotidien,
 *       écrit recap.json (envoyé ensuite par scripts/send-digest.js).
 *       VIGIE_NOW=2026-10-21T17:05:00+11:00 simule l'heure, VIGIE_FORCE_DIGEST=1 force le récapitulatif.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDigest, buildTestDigest, enqueue, isDigestDue, localDay } from './alerts.js';
import { runVeille } from './core.js';
import { DEFAULT_CONFIG_FILE, ROOT_DIR, readConfig } from './lib/config-file.js';
import { readQueue, writeQueue } from './lib/store.js';
import { sourceProblems } from '../site/assets/js/shared/config.js';

function parseArgs(argv) {
  const args = { data: path.join(ROOT_DIR, 'data'), config: DEFAULT_CONFIG_FILE, only: null, digest: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--data') args.data = path.resolve(next());
    else if (arg === '--config') args.config = path.resolve(next());
    else if (arg === '--only') args.only = next().split(',').map((id) => id.trim()).filter(Boolean);
    else if (arg === '--digest') args.digest = path.resolve(next());
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { config, errors } = await readConfig(args.config);
  if (errors.length) {
    console.warn('Configuration : points à corriger');
    errors.forEach((error) => console.warn(`  - ${error}`));
  }
  // Une source mal configurée est mise de côté : les autres continuent d'être surveillées.
  const categoryIds = new Set(config.categories.map((category) => category.id));
  for (const source of config.sources) {
    const problems = sourceProblems(source, categoryIds);
    if (problems.length) source.invalid = problems.join(' ; ');
  }

  console.log(`Vigie · ${new Date().toLocaleString('fr-FR', { timeZone: config.settings.timezone })}`);
  const result = await runVeille({ config, dataDir: args.data, only: args.only, log: (line) => console.log(line) });
  const { summary } = result;
  console.log(
    `Terminé en ${(summary.durationMs / 1000).toFixed(1)} s : ${summary.checked} source(s), ${summary.added} nouveauté(s), ${summary.errors} erreur(s).`,
  );

  if (args.digest) {
    const now = process.env.VIGIE_NOW ? new Date(process.env.VIGIE_NOW) : new Date();
    const appUrl = config.settings.appUrl || process.env.VIGIE_APP_URL || '';
    let queue = enqueue(await readQueue(args.data), result.added, config, now);
    if (queue.items.length) console.log(`Récapitulatif : ${queue.items.length} annonce(s) en attente.`);
    const force = process.env.VIGIE_FORCE_DIGEST === '1';
    if (isDigestDue(queue, now, config.settings, { force })) {
      let digest = buildDigest({ queue, items: result.items, config, appUrl, now });
      // Envoi forcé sans annonce en attente : e-mail de test, pour vérifier la réception.
      if (!digest.subject && force) digest = buildTestDigest({ items: result.items, config, appUrl, now });
      if (digest.subject) {
        await writeFile(args.digest, JSON.stringify(digest, null, 2), 'utf8');
        console.log(`Récapitulatif prêt : ${digest.subject}`);
      } else {
        // Rien à signaler aujourd'hui : pas d'e-mail, la journée est close.
        const done = new Set(digest.ids);
        queue = { lastDigest: localDay(now, config.settings.timezone), items: queue.items.filter((entry) => !done.has(entry.id)) };
        console.log('Récapitulatif : aucune annonce à signaler aujourd’hui.');
      }
    }
    await writeQueue(args.data, queue);
  }
}

main().catch((error) => {
  console.error(`Échec de la veille : ${error.message}`);
  process.exit(1);
});
