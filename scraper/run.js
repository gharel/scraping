#!/usr/bin/env node
/**
 * Lance un passage de veille.
 *   npm run scrape                      toutes les sources actives, données dans data/
 *   npm run scrape -- --only id1,id2    seulement certaines sources
 *   npm run scrape -- --data dossier    autre dossier de données
 *   npm run scrape -- --alert alerte    écrit alerte.json si des nouveautés méritent un e-mail
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildAlert } from './alerts.js';
import { runVeille } from './core.js';
import { DEFAULT_CONFIG_FILE, ROOT_DIR, readConfig } from './lib/config-file.js';
import { sourceProblems } from '../site/assets/js/shared/config.js';

function parseArgs(argv) {
  const args = { data: path.join(ROOT_DIR, 'data'), config: DEFAULT_CONFIG_FILE, only: null, alert: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--data') args.data = path.resolve(next());
    else if (arg === '--config') args.config = path.resolve(next());
    else if (arg === '--only') args.only = next().split(',').map((id) => id.trim()).filter(Boolean);
    else if (arg === '--alert') args.alert = path.resolve(next());
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

  if (args.alert) {
    const appUrl = config.settings.appUrl || process.env.VIGIE_APP_URL || '';
    const alert = buildAlert({ added: result.added, config, appUrl });
    if (alert) {
      await writeFile(args.alert, JSON.stringify(alert, null, 2), 'utf8');
      console.log(`Alerte préparée : ${alert.title}`);
    }
  }
}

main().catch((error) => {
  console.error(`Échec de la veille : ${error.message}`);
  process.exit(1);
});
