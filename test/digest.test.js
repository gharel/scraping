import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDigest, buildTestDigest, enqueue, isDigestDue, localDay } from '../scraper/alerts.js';
import { normalizeConfig } from '../site/assets/js/shared/config.js';

const config = normalizeConfig({
  settings: { appUrl: 'https://exemple.test/vigie/', excludeKeywords: ['travaux'] },
  categories: [
    { id: 'formation', name: 'Formation', color: 1, keywords: ['formation*'] },
    { id: 'ia', name: 'Intelligence artificielle', color: 4, keywords: ['IA', 'intelligence artificielle'] },
  ],
  sources: [{ id: 'src', name: 'Marchés publics NC', url: 'https://exemple.test/', type: 'rss' }],
});

const item = (id, title, extra = {}) => ({ id, sourceId: 'src', title, url: `https://exemple.test/${id}`, ...extra });
const at = (iso) => new Date(iso);

test('récapitulatif : envoi au premier passage à partir de 17 h, une fois par jour', () => {
  const settings = config.settings;
  assert.equal(settings.digestHour, 17);
  const empty = { lastDigest: null, items: [] };
  assert.equal(isDigestDue(empty, at('2026-10-21T16:00:00+11:00'), settings), false);
  assert.equal(isDigestDue(empty, at('2026-10-21T17:00:00+11:00'), settings), true);
  // Passage retardé : 17 h 40 à Nouméa (06:40 UTC).
  assert.equal(isDigestDue(empty, at('2026-10-21T06:40:00Z'), settings), true);
  const sent = { lastDigest: '2026-10-21', items: [] };
  assert.equal(isDigestDue(sent, at('2026-10-21T19:00:00+11:00'), settings), false);
  assert.equal(isDigestDue(sent, at('2026-10-22T09:00:00+11:00'), settings), false);
  assert.equal(isDigestDue(sent, at('2026-10-22T17:00:00+11:00'), settings), true);
  assert.equal(isDigestDue(sent, at('2026-10-21T19:00:00+11:00'), settings, { force: true }), true);
  assert.equal(isDigestDue(empty, at('2026-10-21T17:00:00+11:00'), { ...settings, githubAlerts: false }), false);
  // 23 h UTC le 21 = 10 h le 22 à Nouméa.
  assert.equal(localDay(at('2026-10-21T23:00:00Z'), 'Pacific/Noumea'), '2026-10-22');
});

test('récapitulatif : mise en file des seules nouveautés pertinentes, sans doublon', () => {
  const now = at('2026-10-21T11:00:00+11:00');
  const added = [
    item('a', 'Formation bureautique pour les agents'),
    item('b', 'Fourniture de mobilier'),
    item('c', 'Travaux de formation des sols'),
  ];
  let queue = enqueue({ lastDigest: '2026-10-20', items: [] }, added, config, now);
  assert.deepEqual(queue.items.map((entry) => entry.id), ['a']);
  assert.equal(queue.lastDigest, '2026-10-20');
  queue = enqueue(queue, [item('a', 'Formation bureautique pour les agents'), item('d', 'Outil d’IA générative')], config, now);
  assert.deepEqual(queue.items.map((entry) => entry.id), ['a', 'd']);
  assert.deepEqual(enqueue(queue, added, { ...config, settings: { ...config.settings, githubAlerts: false } }, now).items.length, 2);
});

test('récapitulatif : e-mail HTML regroupé par catégorie, infos relues et refiltrées', () => {
  const now = at('2026-10-21T17:00:00+11:00');
  const items = [
    item('a', 'Formation <IA> & bureautique', { buyer: 'Province Sud', reference: 'AO-12', deadline: '2026-10-24T16:00:00+11:00' }),
    item('d', 'Outil d’IA générative'),
    item('e', 'Formation aux travaux en hauteur'),
  ];
  const queue = { lastDigest: '2026-10-20', items: ['a', 'd', 'e', 'disparue'].map((id) => ({ id, queuedAt: now.toISOString() })) };
  const digest = buildDigest({ queue, items, config, appUrl: config.settings.appUrl, now });
  assert.equal(digest.date, '2026-10-21');
  assert.deepEqual(digest.ids, ['a', 'd', 'e', 'disparue']);
  assert.equal(digest.subject, 'Vigie · 2 nouvelles annonces : Formation, Intelligence artificielle');
  assert.match(digest.html, /Formation &lt;IA&gt; &amp; bureautique/);
  assert.doesNotMatch(digest.html, /<IA>/);
  assert.doesNotMatch(digest.html, /travaux en hauteur/);
  assert.match(digest.html, /Province Sud · Réf\. AO-12 · Marchés publics NC/);
  assert.match(digest.html, /24 octobre 2026 à 16 h 00/);
  assert.match(digest.html, /\(dans 3 jours\)/);
  assert.match(digest.html, /Aussi dans/);
  assert.match(digest.html, /href="https:\/\/exemple\.test\/vigie\/"/);
  assert.ok(digest.html.indexOf('Formation &lt;IA&gt;') < digest.html.indexOf('Outil d’IA'));
  assert.match(digest.text, /== Formation ==/);
  assert.match(digest.text, /https:\/\/exemple\.test\/a/);
});

test('récapitulatif : rien à signaler', () => {
  const now = at('2026-10-21T17:00:00+11:00');
  const digest = buildDigest({ queue: { items: [{ id: 'x' }] }, items: [item('x', 'Travaux de formation des sols')], config, now });
  assert.equal(digest.subject, null);
  assert.deepEqual(digest.ids, ['x']);
});

test('récapitulatif : e-mail de test sans toucher à la file', () => {
  const now = at('2026-10-21T21:00:00+11:00');
  const items = [
    item('r', 'Formation Excel', { firstSeen: '2026-10-19T00:00:00Z' }),
    item('v', 'Formation ancienne', { firstSeen: '2026-10-01T00:00:00Z' }),
    item('s', 'Formation déjà en ligne', { firstSeen: '2026-10-20T00:00:00Z', seed: true }),
  ];
  const digest = buildTestDigest({ items, config, now });
  assert.equal(digest.test, true);
  assert.deepEqual(digest.ids, []);
  assert.equal(digest.subject, 'Vigie · E-mail de test : 1 annonce des 7 derniers jours');
  assert.match(digest.html, /Formation Excel/);
  assert.doesNotMatch(digest.html, /ancienne|déjà en ligne/);
  assert.equal(buildTestDigest({ items: [], config, now }).subject, 'Vigie · E-mail de test : l’envoi fonctionne');
});
