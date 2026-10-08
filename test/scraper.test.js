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
