import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { categorize, compileCategories, keywordPattern, normalizeText } from '../site/assets/js/shared/categorize.js';
import { guessSourceType, normalizeConfig, parseKeywords, uniqueId, validateConfig } from '../site/assets/js/shared/config.js';
import { prettyTitle } from '../site/assets/js/format.js';

test('mots-clés : accents, mots entiers, variantes et apostrophes', () => {
  const match = (keyword, text) => keywordPattern(keyword).test(normalizeText(text));
  assert.ok(match('formation*', 'Plan de FORMATIONS 2026'));
  assert.ok(!match('formation*', 'Système d’information'));
  assert.ok(match('audit', 'Audit de sécurité'));
  assert.ok(!match('audit', 'Rénovation de l’auditorium'));
  assert.ok(match('IA', 'Usage de l’IA générative'));
  assert.ok(!match('IA', 'Fourniture de matériel via un marché'));
  assert.ok(match('pédagogi*', 'ingénierie PEDAGOGIQUE'));
  assert.ok(match("assistance à maîtrise d'ouvrage", 'Assistance à maîtrise d’ouvrage pour le LMS'));
  assert.equal(keywordPattern('a'), null);
});

test('catégories : classement d’une annonce', () => {
  const compiled = compileCategories([
    { id: 'formation', keywords: ['formation*', 'LMS'] },
    { id: 'btp', keywords: ['travaux'] },
  ]);
  const item = { title: 'Assistance à maîtrise d’ouvrage pour l’évolution du LMS', buyer: 'IFAP' };
  assert.deepEqual(categorize(item, compiled), ['formation']);
  assert.deepEqual(categorize(item, compiled, ['btp']), ['btp', 'formation']);
});

test('configuration : la configuration livrée est valide', () => {
  const raw = JSON.parse(readFileSync(new URL('../config/veille.json', import.meta.url), 'utf8'));
  const config = normalizeConfig(raw);
  assert.deepEqual(validateConfig(config), []);
  assert.ok(config.sources.length >= 1);
  assert.equal(config.sources[0].type, 'atexo');
});

test('configuration : erreurs détectées et aides à la saisie', () => {
  const config = normalizeConfig({ categories: [{ id: 'x', name: 'X' }], sources: [{ id: 's', name: 'S', url: 'ftp://exemple', categories: ['inconnue'] }] });
  const errors = validateConfig(config);
  assert.ok(errors.some((error) => error.includes('http')));
  assert.ok(errors.some((error) => error.includes('catégorie inconnue')));
  assert.equal(guessSourceType('https://portail.marchespublics.nc/?page=Entreprise.EntrepriseAdvancedSearch&AllCons'), 'atexo');
  assert.equal(guessSourceType('https://www.province-sud.nc/aops/feed/'), 'rss');
  assert.equal(guessSourceType('https://www.cafat.nc/nos-marches/'), 'page');
  assert.deepEqual(parseKeywords('formation*\n e-learning ,LMS;lms'), ['formation*', 'e-learning', 'LMS']);
  assert.equal(uniqueId('Marchés publics', ['marches-publics']), 'marches-publics-2');
});

test('titres en capitales rendus lisibles', () => {
  assert.equal(prettyTitle('TÉLÉSURVEILLANCE, SURVEILLANCE ET GARDIENNAGE DES ÉDIFICES DE NOUMEA'), 'Télésurveillance, surveillance et gardiennage des édifices de Nouméa');
  assert.equal(prettyTitle('LOT 13 - CLIMATISATION CFO-CFA'), 'Lot 13 - climatisation CFO-CFA');
  assert.equal(prettyTitle('Titre déjà correct'), 'Titre déjà correct');
});
