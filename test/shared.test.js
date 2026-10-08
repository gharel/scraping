import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { categorize, compileCategories, foldText, keywordPattern, normalizeText } from '../site/assets/js/shared/categorize.js';
import { guessSourceType, normalizeConfig, parseKeywords, uniqueId, validateConfig } from '../site/assets/js/shared/config.js';
import { prettyTitle } from '../site/assets/js/format.js';

test('mots-clés : accents, mots entiers, variantes et apostrophes', () => {
  const match = (keyword, text) => {
    const re = keywordPattern(keyword);
    return re.test(re.caseSensitive ? foldText(text) : normalizeText(text));
  };
  assert.ok(!match('IA', 'aides individuelles à l’habitat de Ia province Sud'), 'un sigle ne trouve que les majuscules');
  assert.ok(match('LMS', 'évolution du LMS de l’IFAP'));
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

test('exclusions : une annonce de travaux n’entre dans aucune catégorie', () => {
  const compiled = compileCategories([{ id: 'numerique', keywords: ['numérique*'] }], ['travaux', 'BTP']);
  assert.deepEqual(categorize({ title: 'Travaux d’aménagement numérique du quartier' }, compiled), []);
  assert.deepEqual(categorize({ title: 'Transformation numérique des services' }, compiled), ['numerique']);
  assert.deepEqual(categorize({ title: 'Travaux', nature: 'Travaux' }, compiled, ['numerique']), ['numerique'], 'une catégorie imposée par la source reste appliquée');
});

test('filtres : « Mes catégories » ne garde que les annonces classées', async () => {
  const { applyFilters, DEFAULT_FILTERS } = await import('../site/assets/js/model.js');
  const items = [
    { id: 'a', open: true, categories: ['formation'], searchText: 'a' },
    { id: 'b', open: true, categories: [], searchText: 'b' },
    { id: 'c', open: true, categories: [], starred: true, searchText: 'c' },
  ];
  assert.equal(DEFAULT_FILTERS.category, 'mine');
  assert.deepEqual(applyFilters(items, DEFAULT_FILTERS).map((item) => item.id), ['a']);
  assert.deepEqual(applyFilters(items, { ...DEFAULT_FILTERS, category: 'all' }).map((item) => item.id), ['a', 'b', 'c']);
  assert.deepEqual(applyFilters(items, { ...DEFAULT_FILTERS, quick: 'starred' }).map((item) => item.id), ['c'], 'les annonces suivies restent visibles');
});

test('statut : une annonce « Expirée » n’est plus en cours', async () => {
  const { enrichItems } = await import('../site/assets/js/model.js');
  const config = normalizeConfig({ categories: [], sources: [{ id: 's', name: 'S', url: 'https://exemple.nc' }] });
  const now = new Date('2026-10-08T00:00:00Z');
  const base = { sourceId: 's', title: 'Consultation', publishedAt: '2026-10-01T00:00:00+11:00', firstSeen: now.toISOString() };
  const [expired, open] = enrichItems({ items: [{ ...base, id: 's:a', status: 'Expirée' }, { ...base, id: 's:b', status: 'Ouvert' }], config, since: null, starred: new Set(), now });
  assert.equal(expired.open, false);
  assert.equal(open.open, true);
  const lastDay = new Date('2026-11-06T05:00:00+11:00');
  const [dayOnly, withTime] = enrichItems({
    items: [{ ...base, id: 's:c', deadline: '2026-11-06T00:00:00+11:00' }, { ...base, id: 's:d', deadline: '2026-11-06T04:00:00+11:00' }],
    config, since: null, starred: new Set(), now: lastDay,
  });
  assert.equal(dayOnly.open, true, 'date sans heure : ouverte toute la journée');
  assert.equal(dayOnly.days, 0);
  assert.equal(withTime.open, false);
});

test('territoires : source locale ou source régionale reconnue par le lieu', async () => {
  const { itemRegions } = await import('../site/assets/js/shared/config.js');
  assert.deepEqual(itemRegions({ title: 'Marché' }, { region: 'pf' }), ['pf']);
  assert.deepEqual(itemRegions({ title: 'Marché' }, {}), ['nc'], 'Nouvelle-Calédonie par défaut');
  assert.deepEqual(itemRegions({ location: '(988) Nouvelle-Calédonie, (987) Polynésie Française' }, { region: 'pacifique' }), ['nc', 'pf']);
  assert.deepEqual(itemRegions({ location: 'Fiji and New Caledonia' }, { region: 'pacifique' }), ['nc']);
  assert.deepEqual(itemRegions({ location: 'Tuvalu' }, { region: 'pacifique' }), ['pacifique']);
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
