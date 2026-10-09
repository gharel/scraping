import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import * as cheerio from 'cheerio';
import * as prefs from '../site/assets/js/prefs.js';
import { THEME_ICONS, THEME_KEY, THEMES, nextTheme, normalizeTheme, themeLabel } from '../site/assets/js/theme.js';

const read = (path) => readFileSync(new URL(`../site/${path}`, import.meta.url), 'utf8');
const $ = cheerio.load(read('index.html'));

/** Stockage en mémoire, ou qui échoue (navigation privée, stockage bloqué). */
function memoryStorage(initial = {}, { broken = false } = {}) {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (broken) throw new Error('SecurityError');
  };
  return {
    data,
    getItem: (key) => (guard(), data.has(key) ? data.get(key) : null),
    setItem: (key, value) => (guard(), data.set(key, String(value))),
    removeItem: (key) => (guard(), data.delete(key)),
  };
}

test('thème : clé commune à tous les outils Skazy Formation, sans le préfixe « vigie. »', () => {
  assert.equal(THEME_KEY, 'skazy-outils:theme');
  for (const file of ['assets/js/app.js', 'assets/js/theme-init.js', 'assets/js/views/reglages.js']) {
    assert.doesNotMatch(read(file), /vigie\.theme|prefs\.(read|write)\('theme'/, `${file} : l’ancienne clé n’est plus lue ni écrite`);
  }
});

test('thème : système → clair → sombre → système', () => {
  assert.deepEqual(THEMES, ['system', 'light', 'dark']);
  assert.equal(nextTheme('system'), 'light');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'system');
  assert.equal(nextTheme('auto'), 'light', 'valeur inconnue : thème du système');
  for (const value of [null, undefined, 'auto', '', 'sombre', 42, { theme: 'dark' }]) assert.equal(normalizeTheme(value), 'system');
});

test('thème : le bouton annonce le thème actuel, avec une espace insécable avant les deux-points', () => {
  assert.equal(themeLabel('system'), 'Thème : celui du système. Changer de thème');
  assert.equal(themeLabel('light'), 'Thème : clair. Changer de thème');
  assert.equal(themeLabel('dark'), 'Thème : sombre. Changer de thème');
  assert.deepEqual(THEME_ICONS, { system: 'contrast', light: 'sun', dark: 'moon' });
  const icons = read('assets/js/icons.js');
  assert.ok(icons.includes(`contrast: '<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/>'`), 'demi-cercle de style Lucide');
  // Libellé statique : état de départ, celui du système.
  const button = $('#theme-toggle');
  assert.equal(button.attr('aria-label'), themeLabel('system'));
  assert.equal(button.attr('title'), themeLabel('system'));
});

test('thème : Réglages propose Système, Clair et Sombre avec les icônes du bouton', () => {
  const reglages = read('assets/js/views/reglages.js');
  assert.match(reglages, /value: 'system', label: 'Système', iconName: THEME_ICONS\.system/);
  assert.match(reglages, /value: 'light', label: 'Clair', iconName: THEME_ICONS\.light/);
  assert.match(reglages, /value: 'dark', label: 'Sombre', iconName: THEME_ICONS\.dark/);
  assert.doesNotMatch(reglages, /Automatique/);
});

test('thème : choix relu quand un autre onglet ou outil le change, et au retour arrière', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /addEventListener\('storage', \(event\) => \{\s*if \(event\.key === THEME_KEY \|\| event\.key === null\)/);
  assert.match(app, /addEventListener\('pageshow', \(event\) => \{\s*if \(event\.persisted\)/);
});

test('thème : la clé commune est écrite en JSON, retirée pour suivre le système, sans casser la page', () => {
  const storage = memoryStorage({ 'vigie.theme': '"dark"' });
  globalThis.window = { localStorage: storage };
  try {
    prefs.writeShared(THEME_KEY, 'light');
    assert.equal(storage.data.get('skazy-outils:theme'), '"light"');
    assert.equal(prefs.readShared(THEME_KEY), 'light');
    prefs.writeShared(THEME_KEY, 'dark');
    assert.equal(storage.data.get('skazy-outils:theme'), '"dark"');
    prefs.writeShared(THEME_KEY, null);
    assert.equal(storage.data.has('skazy-outils:theme'), false, '« système » : clé retirée');
    assert.equal(normalizeTheme(prefs.readShared(THEME_KEY)), 'system');
    assert.equal(storage.data.get('vigie.theme'), '"dark"', 'ancienne clé ignorée, sans migration');
    storage.data.set(THEME_KEY, 'dark');
    assert.equal(normalizeTheme(prefs.readShared(THEME_KEY)), 'system', 'valeur illisible : thème du système');
    // Les préférences de Vigie gardent leur préfixe.
    prefs.write('notify', true);
    assert.equal(storage.data.get('vigie.notify'), 'true');
    assert.equal(prefs.read('notify'), true);

    globalThis.window = { localStorage: memoryStorage({}, { broken: true }) };
    assert.doesNotThrow(() => prefs.writeShared(THEME_KEY, 'dark'));
    assert.equal(prefs.readShared(THEME_KEY), null);
  } finally {
    delete globalThis.window;
  }
});

test('thème : theme-init.js applique le choix commun avant l’affichage', () => {
  const source = read('assets/js/theme-init.js');
  const run = (initial, options) => {
    const attributes = new Map();
    const documentElement = { setAttribute: (name, value) => attributes.set(name, value) };
    vm.runInNewContext(source, { window: { localStorage: memoryStorage(initial, options) }, document: { documentElement } });
    return attributes.get('data-theme') ?? null;
  };
  assert.equal(run({ 'skazy-outils:theme': '"light"' }), 'light');
  assert.equal(run({ 'skazy-outils:theme': '"dark"' }), 'dark');
  assert.equal(run({}), null, 'sans clé : le système décide (bloc @media)');
  assert.equal(run({ 'skazy-outils:theme': '"system"' }), null);
  assert.equal(run({ 'skazy-outils:theme': 'dark' }), null, 'valeur illisible');
  assert.equal(run({ 'vigie.theme': '"dark"' }), null, 'ancienne clé ignorée');
  assert.equal(run({ 'skazy-outils:theme': '"dark"' }, { broken: true }), null, 'stockage indisponible');
  // Script externe, chargé avant les styles de l'application : la CSP interdit le script en ligne.
  const script = $('head script[src="assets/js/theme-init.js"]');
  assert.equal(script.length, 1);
  assert.equal(script.attr('type'), undefined, 'script classique, exécuté avant le premier rendu');
});

test('thème : clair explicite en « only light », mode nuit de Brave (Dark Reader) verrouillé', () => {
  const tokens = read('assets/css/tokens.css');
  assert.match(tokens, /:root\[data-theme='light'\]\s*\{\s*color-scheme: only light;\s*\}/);
  assert.match(tokens, /:root\[data-theme='dark'\]\s*\{[^}]*color-scheme: dark;/);
  assert.match(tokens, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)/);
  const colorScheme = $('head meta[name="color-scheme"]');
  assert.equal(colorScheme.attr('content'), 'light dark');
  const lock = $('head meta[name="darkreader-lock"]');
  assert.equal(lock.length, 1);
  assert.equal(colorScheme.nextAll('meta').first().is(lock), true, 'juste après color-scheme');
});
