import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseResults } from '../scraper/adapters/atexo.js';
import { parseList } from '../scraper/adapters/liste.js';
import { extractPage } from '../scraper/adapters/page.js';
import { parseFeed } from '../scraper/adapters/rss.js';
import { mergeSourceItems, pruneItems } from '../scraper/core.js';
import { findDeadline, fromParts, parseDate } from '../scraper/lib/dates.js';
import { guessKind, guessReference } from '../scraper/lib/text.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('dates : formats rencontrés sur les sites surveillés', () => {
  assert.equal(fromParts('30', 'Oct.', '2026', '16:00'), '2026-10-30T16:00:00+11:00');
  assert.equal(fromParts('16', 'Sept.', '2026'), '2026-09-16T00:00:00+11:00');
  assert.equal(fromParts('7', 'Juil.', '2027', '16:30'), '2027-07-07T16:30:00+11:00');
  assert.equal(fromParts('3', 'Févr.', '2026'), '2026-02-03T00:00:00+11:00');
  assert.equal(parseDate('30/10/2026 à 16h30'), '2026-10-30T16:30:00+11:00');
  assert.equal(parseDate('5 octobre 2026'), '2026-10-05T00:00:00+11:00');
  assert.equal(parseDate('Wed, 07 Oct 2026 01:57:53 +0000'), '2026-10-07T01:57:53.000Z');
  assert.equal(parseDate('2026-10-18T12:00:00Z'), '2026-10-18T12:00:00.000Z');
  assert.equal(parseDate('2026-10-18'), '2026-10-18T00:00:00+11:00');
  assert.equal(parseDate('26 March 2026'), '2026-03-26T00:00:00+11:00');
  assert.equal(parseDate('n’importe quoi'), null);
  assert.equal(findDeadline('Date limite de remise des offres : 06/11/2026 à 15h30.'), '2026-11-06T15:30:00+11:00');
});

test('texte : référence et nature devinées depuis un titre', () => {
  assert.equal(guessReference('Avis d’appel d’offre n° DAEM-AO-12-26 – Exploitation'), 'DAEM-AO-12-26');
  assert.equal(guessKind('Avis d’attribution de marché public DAEM'), 'attribution');
  assert.equal(guessKind('Appel public a concurrence n° APCDERES-2809'), 'consultation');
  assert.equal(guessKind('Appel à projet – Précarité menstruelle'), 'appel-a-projets');
  assert.equal(guessKind('La mairie lance deux appels d’offres'), 'consultation');
});

test('atexo : lecture des consultations de marchespublics.nc', () => {
  const page = parseResults(fixture('atexo-liste.html'), 'https://portail.marchespublics.nc/?page=Entreprise.EntrepriseAdvancedSearch&AllCons');
  assert.equal(page.total, 48);
  assert.equal(page.items.length, 2);
  assert.ok(page.form?.fields.has('PRADO_PAGESTATE'));
  const ifap = page.items.find((item) => item.key === 'f6m-3406');
  assert.ok(ifap, 'consultation 3406 trouvée');
  assert.equal(ifap.reference, '26_EFO03');
  assert.match(ifap.title, /^Assistance à maîtrise d’ouvrage/);
  assert.equal(ifap.buyer, 'Institut de Formation à l\'Administration Publique');
  assert.equal(ifap.buyerLocation, 'Nouméa');
  assert.equal(ifap.nature, 'Services');
  assert.equal(ifap.procedureCode, 'AUT');
  assert.equal(ifap.deadline, '2026-10-30T16:00:00+11:00');
  assert.equal(ifap.publishedAt, '2026-09-16T00:00:00+11:00');
  assert.equal(ifap.url, 'https://portail.marchespublics.nc/entreprise/consultation/3406?orgAcronyme=f6m');
  const noumea = page.items.find((item) => item.key === 's3d-3457');
  assert.equal(noumea.lots, 16);
});

test('rss : flux RSS 2.0 et Atom', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Avis</title>
    <item><title>Avis d&#8217;appel d&#8217;offre n° DAEM-AO-12-26 &#8211; Aérogare</title><link>https://exemple.nc/ao/12</link>
    <guid>https://exemple.nc/?p=1</guid><pubDate>Tue, 29 Sep 2026 13:00:40 +0000</pubDate>
    <content:encoded><![CDATA[<p>Date limite de remise des offres : 30/10/2026 à 15h00</p>]]></content:encoded></item></channel></rss>`;
  const [item] = parseFeed(rss, 'https://exemple.nc/feed/');
  assert.equal(item.title, 'Avis d’appel d’offre n° DAEM-AO-12-26 – Aérogare');
  assert.equal(item.reference, 'DAEM-AO-12-26');
  assert.equal(item.kind, 'consultation');
  assert.equal(item.deadline, '2026-10-30T15:00:00+11:00');
  assert.equal(item.publishedAt, '2026-09-29T13:00:40.000Z');

  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>X</title>
    <entry><title>Nouvelle formation</title><link rel="alternate" href="/a/1"/><id>urn:1</id><updated>2026-10-01T08:00:00Z</updated><summary>Résumé</summary></entry></feed>`;
  const [entry] = parseFeed(atom, 'https://exemple.nc/atom.xml');
  assert.equal(entry.url, 'https://exemple.nc/a/1');
  assert.equal(entry.summary, 'Résumé');
  assert.throws(() => parseFeed('<html><body>Pas un flux</body></html>', 'https://exemple.nc'), /flux RSS/);
});

test('liste : annonces décrites par sélecteurs CSS', () => {
  const html = `<table><tbody>
    <tr><td>RFQ26-1</td><td><a href="/t/1">Training workshop</a><p><time datetime="2026-10-01T00:00:00Z">1 Oct</time><br><time datetime="2026-10-20T12:00:00Z">20 Oct</time></p></td></tr>
    <tr><td>RFQ26-2</td><td><a href="/t/2">Supply of tablets</a><p><time datetime="2026-10-02T00:00:00Z">2 Oct</time><br><time datetime="2026-10-25T12:00:00Z">25 Oct</time></p></td></tr>
  </tbody></table>`;
  const items = parseList(html, 'https://exemple.org/procurement', {
    item: 'table tbody tr',
    fields: { title: 'td:nth-child(2) > a', url: 'td:nth-child(2) > a@href', reference: 'td:nth-child(1)', publishedAt: 'time:nth-of-type(1)@datetime', deadline: 'time:nth-of-type(2)@datetime' },
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://exemple.org/t/1');
  assert.equal(items[0].reference, 'RFQ26-1');
  assert.equal(items[0].deadline, '2026-10-20T12:00:00.000Z');
});

test('page : extraction du texte et des liens de la zone surveillée', () => {
  const html = `<html><body><nav><a href="/menu">Menu</a></nav><main><h1>Avis</h1><p>Avis n°1 <a href="/doc/1.pdf">Télécharger</a></p><script>var x=1</script></main></body></html>`;
  const page = extractPage(html, 'https://exemple.nc/avis', {});
  assert.deepEqual(page.lines, ['Avis', 'Avis n°1 Télécharger']);
  assert.deepEqual(page.links.map((link) => link.url), ['https://exemple.nc/doc/1.pdf']);
});

test('page en mode liens : chaque avis listé devient une annonce lisible', async () => {
  const { default: page } = await import('../scraper/adapters/page.js');
  const html = `<html><body><main><ul>
    <li><span>PORT AUTONOME DE PAPEETE - AAPC2026/25 Retrait d'épaves à Motu Uta - Date de remise de l'offre</span><span>16/11/2026</span><span>07/10/2026</span><a href="LexpolAfficheAnnonceMP.php?t=1">Voir l'annonce ></a></li>
    <li><span>AVIS D'APPEL D'OFFRES - Entretien des espaces verts</span> <a href="/files/2026-10/aao.pdf">Télécharger</a></li>
    <li><a href="/contenu/telechargement/1/2/file/Avis_de_publicite_2026_SOLIMPRESS.pdf"></a><span>Avis de publicité_2026_SOLIMPRESS PDF - 0,12 Mb - 03/08/2026</span></li>
    <li><a href="/menu">Accueil</a></li>
  </ul></main></body></html>`;
  const http = { get: async () => ({ url: 'https://exemple.pf/avis', text: html }) };
  const result = await page.fetch({ name: 'Test', url: 'https://exemple.pf/avis', options: { detect: 'liens', match: 'Lexpol|files|telechargement', keep: true } }, { http, now: new Date('2026-10-08T00:00:00Z') });
  assert.equal(result.listing, false, 'liste des derniers avis : pas de retrait');
  assert.equal(result.items.length, 3);
  const [lexpol, montDore, hc] = result.items;
  assert.equal(lexpol.buyer, 'PORT AUTONOME DE PAPEETE');
  assert.equal(lexpol.title, "AAPC2026/25 Retrait d'épaves à Motu Uta");
  assert.equal(lexpol.deadline, '2026-11-16T00:00:00+11:00');
  assert.equal(montDore.buyer, '', 'le type d’avis n’est pas un acheteur');
  assert.equal(montDore.publishedAt, '2026-10-01T00:00:00+11:00', 'date tirée de l’adresse du fichier');
  assert.equal(hc.title, 'Avis de publicité 2026 SOLIMPRESS');
  assert.equal(hc.publishedAt, '2026-08-03T00:00:00+11:00');
});

test('page en mode liens : avis rédigé sous un intertitre, une annonce par avis', async () => {
  const { default: page } = await import('../scraper/adapters/page.js');
  const html = `<html><body><div id="main"><div class="lead">
    <h2>AVIS D'APPEL PUBLIC A LA CONCURRENCE</h2>
    <h5>Avis de marché : renouvellement des goodies - Wallis et Futuna Tourisme</h5>
    <p>L'administration supérieure lance le marché public suivant :</p>
    <p>Référence : 2026-E-PA-57-SBL</p>
    <p>Date limite de réception des offres : lundi 19 octobre 2026 à 17h00 (heure de Wallis).</p>
    <div><a href="/contenu/telechargement/1/2/file/Avis%20de%20march%C3%A9.pdf"><span>Télécharger</span> <span>Avis de marché</span> <span>PDF - 0,24 Mb - 01/10/2026</span></a></div>
    <div><a href="/contenu/telechargement/1/3/file/CDC.pdf"><span>Télécharger</span> <span>CDC goodies</span> <span>PDF - 0,91 Mb - 30/09/2026</span></a></div>
    <h5>Avis de marché : MOE - CET Vailepo</h5>
    <p>Mission de maîtrise d'œuvre.</p>
    <div><a href="/contenu/telechargement/4/5/file/1138-00-Avis-dappel-doffres.pdf"><span>Télécharger</span> <span>Avis</span> <span>PDF - 0,18 Mb - 10/09/2026</span></a></div>
  </div></div></body></html>`;
  const http = { get: async () => ({ url: 'https://exemple.wf/avis', text: html }) };
  const result = await page.fetch({ name: 'WF', url: 'https://exemple.wf/avis', options: { detect: 'liens', selector: '#main', match: 'telechargement' } }, { http, now: new Date('2026-10-08T00:00:00Z') });
  assert.equal(result.items.length, 2, 'le cahier des charges du même avis n’est pas une annonce de plus');
  const [goodies, moe] = result.items;
  assert.equal(goodies.title, 'Renouvellement des goodies - Wallis et Futuna Tourisme');
  assert.equal(goodies.kind, 'consultation');
  assert.equal(goodies.reference, '2026-E-PA-57-SBL');
  assert.equal(goodies.deadline, '2026-10-19T17:00:00+11:00');
  assert.equal(goodies.publishedAt, '2026-10-01T00:00:00+11:00');
  assert.equal(moe.title, 'MOE - CET Vailepo');
});

test('page en mode liens : renvois vers d’autres sites et pages de rubrique écartés', async () => {
  const { default: page } = await import('../scraper/adapters/page.js');
  const html = `<html><body><div class="contenu">
    <div class="article"><div class="vignette"><a href="https://www.ville.nc/realisation-des-repas/"><img src="/repas.jpg" alt=""></a></div>
      <div class="texte"><h4><a href="https://www.ville.nc/realisation-des-repas/">Réalisation des repas dans les écoles</a></h4>
      <p>Le Maire informe les entreprises qu’il lance deux appels d’offres ouverts pour les repas scolaires.</p></div></div>
    <ul><li><a href="https://portail.marchespublics.nc/?page=Entreprise.EntrepriseDetailsConsultation&refConsultation=123">Fourniture de matériel informatique</a></li></ul>
    <p>Remarque : ce texte est adapté de celui présentant les conditions d’attribution des marchés publics sur le <a href="https://www.province-nord.nc/affaires-administratives-finances-budget/marches-publics">site internet de la province Nord de Nouvelle-Calédonie.</a></p>
    <p>Les règles sont détaillées dans le <a href="https://www.province-nord.nc/guide-des-marches-publics">guide de la province</a>.</p>
    <p>Toutes les consultations sur <a href="https://www.marchespublics.nc/">marchespublics.nc</a> et les <a href="https://www.ville.nc/les-marches-publics/?page=2">avis précédents</a>.</p>
  </div></body></html>`;
  const http = { get: async () => ({ url: 'https://www.ville.nc/marches', text: html }) };
  const source = { name: 'Ville', url: 'https://www.ville.nc/marches', options: { detect: 'liens', match: 'march|appel|avis|consultation' } };
  const { items } = await page.fetch(source, { http, now: new Date('2026-10-08T00:00:00Z') });
  assert.deepEqual(
    items.map((item) => item.title),
    ['Réalisation des repas dans les écoles', 'Fourniture de matériel informatique'],
    'ni la page « marchés publics » d’un autre site, ni un renvoi glissé dans une phrase, ni une page d’accueil ou paginée',
  );
  const [repas] = items;
  assert.equal(repas.kind, 'consultation', 'nature lue dans le texte de l’article');
  assert.match(repas.summary, /lance deux appels d’offres/, 'résumé tiré de la vignette, titre tiré du lien de l’intertitre');
});

test('page en mode liens : objet lu sur la fiche de détail, une seule fois', async () => {
  const { default: page } = await import('../scraper/adapters/page.js');
  const list = `<html><body><main><div class="annonces">
    <article><a href="/annonce/1">PROVINCE NORD DEFIJ - Direction de l'Enseignement, de la Formation</a><p>Publié le 07/10/2026</p></article>
    <article><a href="/annonce/2">Ville du Mont-Dore</a><p>Publié le 07/10/2026</p></article>
    <article><a href="/annonce/3">VILLE DE NOUMEA - Service des marchés</a><p>Publié le 08/10/2026</p></article>
  </div></main></body></html>`;
  const fiches = {
    'https://legales.exemple.nc/annonce/1': '<h3 class="objet">N° de Consultation : 2026/S2986</h3><p class="texte">Révision 200h du navire Sphyraena</p>',
    'https://legales.exemple.nc/annonce/2': '<h3 class="avis">AVIS</h3><p class="texte">Fourniture de matériel informatique</p>',
    'https://legales.exemple.nc/annonce/3': '<h3 class="objet">TÉLÉSURVEILLANCE DES ÉDIFICES COMMUNAUX</h3>',
  };
  const asked = [];
  const http = {
    get: async (url) => {
      asked.push(url);
      return { url, text: fiches[url] || list };
    },
  };
  const source = { name: 'LNC', url: 'https://legales.exemple.nc/appels', options: { detect: 'liens', match: '/annonce/', keep: true, details: 'h3.objet, p.texte', detailsTitle: true } };
  const now = new Date('2026-10-08T00:00:00Z');
  const first = await page.fetch(source, { http, now });
  const [defij, montDore, noumea] = first.items;
  assert.equal(defij.buyer, 'PROVINCE NORD DEFIJ');
  assert.equal(defij.title, 'Révision 200h du navire Sphyraena', 'le bloc qui ne porte que le numéro est sauté');
  assert.equal(defij.reference, '2026/S2986');
  assert.equal(montDore.buyer, 'Ville du Mont-Dore', 'le lien ne nommait que l’acheteur');
  assert.equal(montDore.title, 'Fourniture de matériel informatique');
  assert.equal(noumea.title, 'TÉLÉSURVEILLANCE DES ÉDIFICES COMMUNAUX');
  assert.equal(noumea.reference, '', '« NOUMEA » n’est pas une référence');
  assert.equal(asked.length, 4);

  asked.length = 0;
  const second = await page.fetch(source, { http, now, snapshot: first.snapshot });
  assert.deepEqual(asked, ['https://legales.exemple.nc/appels'], 'fiches déjà lues : pas de nouvelle requête');
  assert.equal(second.items[1].title, 'Fourniture de matériel informatique');
  asked.length = 0;
  await page.fetch({ ...source, options: { ...source.options, details: 'p.texte' } }, { http, now, snapshot: first.snapshot });
  assert.equal(asked.length, 4, 'un autre sélecteur relit les fiches');
});

test('fusion : premier passage, nouveautés, changements de date limite, disparitions', () => {
  const source = { id: 'mp' };
  const t1 = new Date('2026-10-01T00:00:00Z');
  const first = mergeSourceItems([], source, [{ key: 'a', title: 'A', deadline: '2026-10-30T16:00:00+11:00' }], { now: t1, firstRun: true });
  assert.equal(first.added.length, 1);
  assert.equal(first.items[0].seed, true);

  const t2 = new Date('2026-10-02T00:00:00Z');
  const second = mergeSourceItems(first.items, source, [{ key: 'a', title: 'A', deadline: '2026-11-06T16:00:00+11:00' }, { key: 'b', title: 'B' }], { now: t2 });
  assert.equal(second.added.length, 1);
  assert.equal(second.added[0].seed, undefined);
  assert.equal(second.updated.length, 1);
  const a = second.items.find((item) => item.id === 'mp:a');
  assert.equal(a.history[0].from, '2026-10-30T16:00:00+11:00');
  assert.equal(a.lastSeen, t2.toISOString());

  const t3 = new Date('2026-10-02T06:00:00Z');
  const third = mergeSourceItems(second.items, source, [{ key: 'b', title: 'B' }], { now: t3, listing: true });
  const gone = third.items.find((item) => item.id === 'mp:a');
  assert.equal(gone.gone, true);
  const b = third.items.find((item) => item.id === 'mp:b');
  assert.equal(b.lastSeen, t2.toISOString(), 'lastSeen ne change pas dans la même journée');

  const kept = pruneItems(third.items, { now: new Date('2027-06-01T00:00:00Z'), retentionDays: 180, sourceIds: new Set(['mp']) });
  assert.equal(kept.length, 0);
});
