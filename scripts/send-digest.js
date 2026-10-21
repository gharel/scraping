#!/usr/bin/env node
/**
 * Envoie le récapitulatif quotidien préparé par la veille (recap.json) via l'API Resend,
 * puis retire de la file (data/alert-queue.json) les annonces envoyées.
 *   node scripts/send-digest.js recap.json
 * Variables : RESEND_API_KEY, VIGIE_EMAIL_TO (une ou plusieurs adresses séparées par des virgules),
 * VIGIE_EMAIL_FROM (facultatif, « Vigie <onboarding@resend.dev> » par défaut).
 * En cas d'échec, la file est conservée : le passage suivant réessaie.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from '../scraper/lib/config-file.js';
import { readQueue, writeQueue } from '../scraper/lib/store.js';

const warn = (message) => console.log(process.env.GITHUB_ACTIONS ? `::warning title=Récapitulatif non envoyé::${message}` : `Attention : ${message}`);

async function main() {
  const file = path.resolve(process.argv[2] || 'recap.json');
  const dataDir = path.resolve(process.argv[3] || path.join(ROOT_DIR, 'data'));
  const digest = JSON.parse(await readFile(file, 'utf8'));
  const apiKey = process.env.RESEND_API_KEY;
  const to = String(process.env.VIGIE_EMAIL_TO || '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  if (!apiKey || !to.length) {
    warn('ajoutez les secrets RESEND_API_KEY et VIGIE_EMAIL_TO au dépôt (voir README). Les annonces restent en attente.');
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.VIGIE_EMAIL_FROM || 'Vigie <onboarding@resend.dev>',
      to,
      subject: digest.subject,
      html: digest.html,
      text: digest.text,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (!response.ok) {
    warn(`Resend a répondu ${response.status} : ${body.slice(0, 300)}`);
    return;
  }

  const sent = new Set(digest.ids);
  const queue = await readQueue(dataDir);
  await writeQueue(dataDir, { lastDigest: digest.date, items: (queue.items || []).filter((entry) => !sent.has(entry.id)) });
  console.log(`Récapitulatif envoyé : ${digest.subject}`);
}

main().catch((error) => {
  warn(error.message);
});
