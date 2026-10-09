import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { test } from 'node:test';
import { addFailure, blockedUntil, blockMessage, EMPREINTE, fingerprint, parseFailures } from '../site/assets/js/access.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Jeudi 8 octobre 2026, 14 h 32 min 20 s (heure locale)
const t0 = new Date(2026, 9, 8, 14, 32, 20).getTime();
const after = (n) => {
  let failures = null;
  for (let i = 0; i < n; i += 1) failures = addFailure(failures, t0);
  return failures;
};
// Message avec des espaces ordinaires, plus lisible dans les attentes.
const message = (failures, now) => blockMessage(failures, now).replaceAll('\xa0', ' ');

test('accès : empreinte PBKDF2 identique à celle de Node, seule l’empreinte est publiée', async () => {
  const salt = '00112233445566778899aabbccddeeff';
  const expected = pbkdf2Sync('Été-2026'.normalize('NFC'), Buffer.from(salt, 'hex'), 1000, 32, 'sha256').toString('hex');
  assert.equal(await fingerprint('Été-2026', salt, 1000), expected);
  assert.match(EMPREINTE, /^[0-9a-f]{64}$/);
});

test('accès : chaque échec bloque 5 minutes, 1 heure, 24 heures, 1 semaine, 1 mois, puis définitivement', () => {
  assert.equal(blockedUntil(null), 0);
  assert.equal(blockMessage(null, t0), '');
  [5 * MINUTE, HOUR, DAY, 7 * DAY, 30 * DAY].forEach((ms, i) => assert.equal(blockedUntil(after(i + 1)), t0 + ms));
  assert.equal(blockedUntil(after(6)), Infinity);
  assert.equal(blockedUntil(after(9)), Infinity);
  assert.deepEqual(addFailure({ count: 2, last: t0 }, t0 + DAY), { count: 3, last: t0 + DAY });
});

test('accès : le message dit jusqu’à quand, minute arrondie au-dessus', () => {
  assert.equal(message(after(1), t0), 'Mot de passe incorrect : accès bloqué 5 minutes, jusqu’à 14 h 38.');
  assert.equal(message(after(2), t0), 'Mot de passe incorrect : accès bloqué 1 heure, jusqu’à 15 h 33.');
  assert.equal(message(after(3), t0), 'Mot de passe incorrect : accès bloqué 24 heures, jusqu’au vendredi 9 octobre à 14 h 33.');
  assert.equal(message(after(4), t0), 'Mot de passe incorrect : accès bloqué 1 semaine, jusqu’au jeudi 15 octobre à 14 h 33.');
  assert.equal(
    message(after(5), t0),
    'Mot de passe incorrect : accès bloqué 1 mois, jusqu’au samedi 7 novembre à 14 h 33. Au prochain échec, il sera bloqué définitivement.',
  );
  assert.equal(message(after(6), t0), 'Trop de mots de passe incorrects : l’accès est bloqué définitivement sur ce navigateur.');
  assert.ok(blockMessage(after(1), t0).includes('5\xa0minutes, jusqu’à\xa014\xa0h\xa038'), 'la durée et l’heure ne se coupent pas en fin de ligne');
  const december = new Date(2026, 11, 20, 9, 0).getTime();
  assert.match(message({ count: 5, last: december }, december), /jusqu’au mardi 19 janvier 2027 à 9 h 00\./);
  assert.equal(blockMessage(after(1), t0 + 5 * MINUTE), '', 'plus de message une fois le blocage fini');
});

test('accès : des échecs enregistrés invalides sont ignorés', () => {
  assert.deepEqual(parseFailures({ count: 2, last: t0 }), { count: 2, last: t0 });
  for (const value of [null, true, 'x', { count: 0, last: t0 }, { count: 1.5, last: t0 }, { count: 1 }]) assert.equal(parseFailures(value), null);
});
