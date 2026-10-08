#!/usr/bin/env node
/**
 * Prépare le dossier _site publié sur GitHub Pages :
 * interface (site/), données (data/) et configuration (config/veille.json).
 */
import { execSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../scraper/lib/config-file.js';

const OUT = path.join(ROOT_DIR, '_site');

function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const remote = execSync('git config --get remote.origin.url', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
    const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (match) return match[1];
  } catch {
    /* pas de dépôt git */
  }
  return '';
}

await rm(OUT, { recursive: true, force: true });
await cp(path.join(ROOT_DIR, 'site'), OUT, { recursive: true });
await mkdir(path.join(OUT, 'data'), { recursive: true });
await mkdir(path.join(OUT, 'config'), { recursive: true });
for (const file of ['items.json', 'status.json']) {
  const source = path.join(ROOT_DIR, 'data', file);
  if (existsSync(source)) await cp(source, path.join(OUT, 'data', file));
}
await cp(path.join(ROOT_DIR, 'config', 'veille.json'), path.join(OUT, 'config', 'veille.json'));

const deploy = {
  repository: repository(),
  branch: process.env.GITHUB_REF_NAME || 'main',
  workflow: 'veille.yml',
  schedule: 'toutes les 2 heures, via GitHub Actions.',
  builtAt: new Date().toISOString(),
};
await writeFile(path.join(OUT, 'data', 'deploy.json'), `${JSON.stringify(deploy, null, 2)}\n`);
await writeFile(path.join(OUT, '.nojekyll'), '');
console.log(`Site prêt dans _site/ (${deploy.repository || 'dépôt inconnu'})`);
