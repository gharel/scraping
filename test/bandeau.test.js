import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as cheerio from 'cheerio';
import { backToTopVisible } from '../site/assets/js/back-to-top.js';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const $ = cheerio.load(html);
const header = $('header.app-header');
// Éléments interactifs du bandeau, dans l'ordre du document.
const controls = header.find('a, button').toArray().map((element) => $(element));

test('bandeau : le nom de l’outil (pastille + « Vigie ») mène aux annonces, sans logo ni filet', () => {
  const brand = header.find('a.brand');
  assert.equal(brand.length, 1);
  assert.equal(controls[0].is(brand), true, 'le nom de l’outil ouvre le bandeau');
  assert.equal(brand.attr('href'), '#annonces');
  assert.equal(brand.attr('data-nav'), 'annonces', 'aria-current="page" sur l’accueil (updateChrome)');
  assert.equal(brand.attr('aria-label'), 'Vigie, retour aux annonces');
  assert.equal(brand.find('img.brand-tile').attr('src').split('?')[0], 'assets/img/favicon.svg');
  assert.equal(brand.find('.brand-app').text().trim(), 'Vigie');
  assert.equal(brand.find('.logo, .brand-divider, .header-divider').length, 0);
});

test('bandeau : « Les outils », un filet puis le logo, en derniers éléments', () => {
  const actions = header.find('.header-actions').children().toArray().map((element) => $(element));
  const classes = actions.map((element) => element.attr('class'));
  assert.deepEqual(classes.slice(-3), ['tools-link', 'header-divider', 'skazy-link']);
  assert.ok(classes.indexOf('tools-link') > classes.indexOf('icon-btn'), 'après le bouton de thème');
  assert.ok(classes.indexOf('icon-btn') > classes.indexOf('sync-status'));
  assert.equal(header.find('.header-actions').is(header.find('.header-inner').children().last()), true);
});

test('bandeau : le lien « Les outils » mène à https://gharel.github.io/home/, dans le même onglet', () => {
  const tools = header.find('a.tools-link');
  assert.equal(tools.attr('href'), 'https://gharel.github.io/home/');
  assert.equal(tools.attr('target'), undefined);
  assert.equal(tools.attr('title'), 'Tous les outils Skazy Formation');
  assert.equal(tools.find('.tools-text').text().trim(), 'Les outils');
  // Roue copiée dans le dépôt : la politique de sécurité n'autorise que les images locales.
  const icon = tools.find('img.tools-icon');
  assert.equal(icon.attr('src'), 'assets/img/les-outils.svg');
  assert.equal(icon.attr('alt'), '');
  const file = new URL('../site/assets/img/les-outils.svg', import.meta.url);
  assert.ok(existsSync(file));
  assert.match(readFileSync(file, 'utf8'), /^<svg[^>]+viewBox="0 0 64 64"/);
});

test('bandeau : le logo Skazy Formation est le dernier élément et mène à formation.skazy.nc', () => {
  const last = controls.at(-1);
  assert.equal(last.hasClass('skazy-link'), true);
  assert.equal(last.attr('href'), 'https://formation.skazy.nc');
  assert.equal(last.attr('target'), '_blank');
  assert.match(last.attr('rel'), /\bnoopener\b/);
  assert.equal(last.attr('aria-label'), 'Site de Skazy Formation (nouvel onglet)');
  const logo = last.find('svg.logo');
  assert.equal(logo.length, 1);
  assert.equal(logo.attr('aria-hidden'), 'true');
  assert.equal(logo.find('.logo-skazy').length + logo.find('.logo-formation').length, 2, 'bascule clair/sombre conservée');
  assert.equal(header.find('svg.logo').length, 1, 'un seul logo dans le bandeau');
});

test('remonter en haut : bouton nommé, visible après 1,2 écran de défilement', () => {
  const button = $('#back-to-top');
  assert.equal(button.is('button'), true);
  assert.equal(button.attr('type'), 'button');
  assert.equal(button.attr('aria-label'), 'Remonter en haut de la page');
  assert.equal(button.parents('header, main, .view-root').length, 0, 'hors des vues : présent sur toutes');
  assert.equal(backToTopVisible(0, 800), false);
  assert.equal(backToTopVisible(959, 800), false);
  assert.equal(backToTopVisible(960, 800), true);
  assert.equal(backToTopVisible(5000, 800), true);
});
