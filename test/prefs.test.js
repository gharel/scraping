import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

/** Stockage Web minimal pour Node. */
class MemoryStorage {
  #map = new Map();
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
}

beforeEach(() => {
  globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() };
});

const prefs = await import('../site/assets/js/prefs.js');

test('jeton : gardé dans sessionStorage, jamais dans le localStorage partagé', () => {
  prefs.writeSecret('githubToken', 'github_pat_test');
  assert.equal(window.localStorage.getItem('vigie.githubToken'), null);
  assert.equal(prefs.readSecret('githubToken'), 'github_pat_test');
  prefs.writeSecret('githubToken', null);
  assert.equal(prefs.readSecret('githubToken'), null);
});

test('jeton : une ancienne copie en localStorage est déplacée puis effacée', () => {
  window.localStorage.setItem('vigie.githubToken', JSON.stringify('ancien'));
  assert.equal(prefs.readSecret('githubToken'), 'ancien');
  assert.equal(window.localStorage.getItem('vigie.githubToken'), null);
  assert.equal(window.sessionStorage.getItem('vigie.githubToken'), JSON.stringify('ancien'));
});
