/**
 * Accès réservé : un mot de passe est demandé avant d'afficher la veille (le même que les
 * mini-jeux et le quiz Skazy Formation).
 *
 * Le mot de passe n'apparaît nulle part : le code ne garde que son empreinte PBKDF2-SHA-256
 * (sel aléatoire, 600 000 itérations). Une fois le bon mot de passe saisi, ce navigateur s'en
 * souvient jusqu'à « Verrouiller l'accès » (Réglages).
 *
 * Chaque mot de passe incorrect bloque la saisie, de plus en plus longtemps : 5 minutes, 1 heure,
 * 24 heures, 1 semaine, 1 mois, puis définitivement. Le bon mot de passe remet le compte à zéro.
 *
 * Limite : le site est statique et public. C'est une porte d'entrée dissuasive, pas un coffre :
 * les données restent téléchargeables par qui connaît leur adresse. Le blocage est gardé dans ce
 * navigateur : il freine les essais à la main, pas qui efface son stockage.
 */
import { clear, h } from './dom.js';
import { icon } from './icons.js';
import * as prefs from './prefs.js';

const SEL = '284ebb77d9526d1b91143afc658a187b';
/** Empreinte, pas le mot de passe : la publier ne le révèle pas. */
export const EMPREINTE = '24c2ef4b388d8d476dec140c6fa2602781626e9a94d31dbf50436e994f0e0be7';
const ITERATIONS = 600_000;
const ACCESS_KEY = 'acces';
const FAILURES_KEY = 'acces-echecs';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Blocage après le 1er, le 2e… mot de passe incorrect ; au-delà, il est définitif. Espaces insécables : « 5 minutes » ne se coupe pas. */
const BLOCKS = [
  { ms: 5 * MINUTE, label: '5 minutes' },
  { ms: HOUR, label: '1 heure' },
  { ms: DAY, label: '24 heures' },
  { ms: 7 * DAY, label: '1 semaine' },
  { ms: 30 * DAY, label: '1 mois' },
];
/** Plus grand délai accepté par setTimeout (environ 24 jours) : au-delà, il part tout de suite. */
const MAX_DELAY = 2 ** 31 - 1;

const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g) || [], (pair) => parseInt(pair, 16));
const bytesToHex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Empreinte hexadécimale d'un mot de passe (Web Crypto : https ou localhost uniquement). */
export async function fingerprint(password, salt = SEL, iterations = ITERATIONS) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Chiffrement indisponible');
  const key = await subtle.importKey('raw', new TextEncoder().encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(salt), iterations }, key, 256);
  return bytesToHex(bits);
}

export const isUnlocked = () => prefs.read(ACCESS_KEY) === EMPREINTE;

/** Oublie le mot de passe sur ce navigateur : il sera redemandé. */
export function lock() {
  prefs.write(ACCESS_KEY, null);
}

/** Échecs enregistrés, nettoyés : { count, last } (date du dernier, en ms), null sinon. */
export function parseFailures(value) {
  const count = value?.count;
  const last = value?.last;
  return Number.isInteger(count) && count >= 1 && Number.isFinite(last) ? { count, last } : null;
}

/** Échecs après un nouveau mot de passe incorrect. */
export const addFailure = (failures, now) => ({ count: (failures?.count || 0) + 1, last: now });

/** Fin du blocage en ms : 0 sans échec, Infinity quand il est définitif. */
export function blockedUntil(failures) {
  if (!failures) return 0;
  const block = BLOCKS[failures.count - 1];
  return block ? failures.last + block.ms : Infinity;
}

/**
 * « jusqu’à 14 h 38 » le jour même, « jusqu’au vendredi 16 octobre à 14 h 38 » sinon, à l'heure de
 * cet appareil. La minute est arrondie au-dessus : à l'heure affichée, la saisie est rouverte.
 */
function until(end, now) {
  const date = new Date(Math.ceil(end / MINUTE) * MINUTE);
  const today = new Date(now);
  // Espaces insécables : l'heure ne se coupe pas en fin de ligne.
  const time = `à ${date.getHours()} h ${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === today.toDateString()) return `jusqu’${time}`;
  const day = date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `jusqu’au ${day} ${time}`;
}

/** Message affiché pendant le blocage, '' s'il n'y en a pas. */
export function blockMessage(failures, now) {
  const end = blockedUntil(failures);
  if (end === Infinity) return 'Trop de mots de passe incorrects : l’accès est bloqué définitivement sur ce navigateur.';
  if (end <= now) return '';
  const message = `Mot de passe incorrect : accès bloqué ${BLOCKS[failures.count - 1].label}, ${until(end, now)}.`;
  return failures.count === BLOCKS.length ? `${message} Au prochain échec, il sera bloqué définitivement.` : message;
}

/**
 * Affiche l'écran de mot de passe par-dessus la page tant que l'accès n'est pas ouvert.
 * Renvoie une promesse résolue une fois le bon mot de passe saisi (tout de suite si déjà fait).
 */
export function requireAccess() {
  if (isUnlocked()) return Promise.resolve();
  return new Promise((resolve) => {
    const others = [...document.body.children];
    for (const node of others) node.inert = true;

    const message = h('p', { class: 'gate-error', id: 'gate-error', role: 'alert' });
    const password = h('input', { class: 'input', id: 'gate-password', type: 'password', autocomplete: 'current-password', required: true, 'aria-describedby': 'gate-error' });
    const submit = h('button', { class: 'btn btn--primary btn--md', type: 'submit' }, h('span', null, 'Entrer'), icon('arrowRight', { size: 18 }));
    const form = h('form', { class: 'gate-form' }, h('label', { class: 'field-label', for: 'gate-password' }, 'Mot de passe'), h('div', { class: 'gate-row' }, password, submit), message);
    // Signature du bandeau, dans le même ordre (pastille, Vigie, filet, logo Skazy Formation),
    // décorative : le titre suffit.
    const signature = ['.brand > *', '.header-divider', '.skazy-link .logo'].flatMap((selector) => [...document.querySelectorAll(`.app-header ${selector}`)]);
    const brand = h('div', { class: 'gate-brand', 'aria-hidden': 'true' }, signature.map((node) => node.cloneNode(true)));
    const gate = h(
      'div',
      { class: 'gate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gate-title' },
      h(
        'div',
        { class: 'gate-card' },
        brand,
        h('span', { class: 'gate-icon' }, icon('lock', { size: 26 })),
        h('h1', { class: 'gate-title', id: 'gate-title' }, 'Accès réservé'),
        h('p', { class: 'gate-text' }, 'Saisissez le mot de passe de l’animateur pour ouvrir la veille.'),
        form,
      ),
    );

    // Échecs gardés en mémoire si le stockage refuse l'écriture : le blocage tient jusqu'au rechargement.
    let memoryFailures = null;
    const currentFailures = () => parseFailures(prefs.read(FAILURES_KEY)) || memoryFailures;
    let timer = null;

    /** Ferme ou rouvre la saisie selon les échecs enregistrés ; renvoie true si elle est bloquée. */
    const applyBlock = () => {
      clearTimeout(timer);
      const failures = currentFailures();
      const now = Date.now();
      const end = blockedUntil(failures);
      const blocked = end > now;
      password.disabled = blocked;
      submit.disabled = blocked;
      clear(message).append(blockMessage(failures, now));
      if (blocked && end !== Infinity) {
        // Relu à la fin du blocage, par étapes au-delà de la limite de setTimeout.
        timer = setTimeout(() => {
          if (!applyBlock()) password.focus();
        }, Math.min(end - now, MAX_DELAY));
      }
      return blocked;
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      // Un autre onglet a pu bloquer la saisie entre-temps.
      if (applyBlock() || !password.value) return;
      submit.disabled = true;
      let correct;
      try {
        correct = (await fingerprint(password.value)) === EMPREINTE;
      } catch {
        clear(message).append('Vérification impossible ici : ouvrez le site en https:// (ou sur localhost).');
        submit.disabled = false;
        return;
      }
      if (!correct) {
        const failures = addFailure(currentFailures(), Date.now());
        prefs.write(FAILURES_KEY, failures);
        if (!parseFailures(prefs.read(FAILURES_KEY))) memoryFailures = failures;
        password.value = '';
        applyBlock();
        return;
      }
      prefs.write(FAILURES_KEY, null);
      prefs.write(ACCESS_KEY, EMPREINTE);
      gate.remove();
      for (const node of others) node.inert = false;
      resolve();
    });

    document.body.append(gate);
    if (!applyBlock()) password.focus();
  });
}
