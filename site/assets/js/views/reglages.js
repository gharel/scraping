/**
 * Vue « Réglages » : thème, connexion GitHub, alertes, fréquence, données de l'appareil.
 */
import { lock } from '../access.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { plural, relativeTime } from '../format.js';
import * as prefs from '../prefs.js';
import { THEME_ICONS } from '../theme.js';
import { button, callout, field, input, pageHead, segmented, setBusy, toast, toggle } from '../ui.js';

function section(title, description, ...content) {
  return h('section', { class: 'settings-card' }, h('header', { class: 'settings-head' }, h('h2', null, title), description ? h('p', null, description) : null), h('div', { class: 'settings-body' }, content));
}

function codeLine(text) {
  const copy = button('', {
    variant: 'ghost',
    size: 'sm',
    iconName: 'copy',
    ariaLabel: 'Copier la commande',
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast('Commande copiée.', 'success', { timeout: 2500 });
      } catch {
        toast('Copie impossible : sélectionnez la commande à la main.', 'info');
      }
    },
  });
  return h('div', { class: 'code-line' }, h('code', null, text), copy);
}

function tokenUrl(repository, { relay = false } = {}) {
  const [owner, repo] = String(repository || '').split('/');
  const params = new URLSearchParams({
    name: relay ? `Vigie relais (${repo || 'veille'})` : `Vigie (${repo || 'veille'})`,
    description: relay ? 'Publier depuis le PC les annonces des sites que GitHub ne peut pas lire' : 'Modifier la veille Vigie depuis la version en ligne',
    target_name: owner || '',
    expires_in: '366',
    contents: 'write',
    ...(relay ? {} : { actions: 'write' }),
  });
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}

const RELAY_INTRO = 'Quelques sites refusent les serveurs de GitHub qui assurent la veille en ligne. Avec le relais, Vigie publie leurs annonces sur la version en ligne après chaque vérification faite sur ce PC.';

/** Mode local : relais des sites que la veille en ligne n'atteint pas. */
function relaySection(ctx) {
  const relay = ctx.state.local?.relay;
  if (!relay) return null;
  const repository = relay.repository || 'gharel/scraping';
  if (!relay.configured) {
    const token = input({ type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
    const repoInput = relay.repository ? null : input({ placeholder: 'propriétaire/dépôt' });
    const submit = async (event) => {
      event.preventDefault();
      const value = token.value.trim();
      if (!value) {
        toast('Collez d’abord le jeton GitHub.', 'error');
        return;
      }
      await ctx.relay('connect', { token: value, repository: repoInput ? repoInput.value.trim() : relay.repository }, event.currentTarget.querySelector('button[type="submit"]'));
    };
    return section(
      'Relais vers la version en ligne',
      RELAY_INTRO,
      h(
        'ol',
        { class: 'steps' },
        h(
          'li',
          null,
          h('p', null, h('strong', null, 'Créez un jeton d’accès'), ` limité au dépôt ${repository}, avec l’autorisation « Contents » en lecture et écriture. Le jeton créé pour la version en ligne convient aussi.`),
          button('Créer le jeton sur GitHub', { variant: 'secondary', size: 'sm', href: tokenUrl(repository, { relay: true }), external: true, iconAfter: 'external' }),
        ),
        h(
          'li',
          null,
          h('p', null, h('strong', null, 'Collez le jeton ici.'), ' Il reste sur ce PC, dans local-data/relais.json, et n’est jamais publié.'),
          h(
            'form',
            { class: 'inline-form', onSubmit: submit },
            repoInput ? field({ label: 'Dépôt GitHub', control: repoInput }) : null,
            field({ label: 'Jeton GitHub', control: token }),
            button('Activer le relais', { type: 'submit', iconName: 'cloud' }),
          ),
        ),
      ),
    );
  }
  const { last } = relay;
  return section(
    'Relais vers la version en ligne',
    RELAY_INTRO,
    callout('success', 'cloud', `Relais actif vers ${relay.repository}`, h('p', null, 'La veille en ligne reprend ces annonces à son passage suivant (toutes les 2 heures), tant que le relevé a moins de 6 heures.')),
    last && !last.ok ? callout('warning', 'warning', 'La dernière publication a échoué', h('p', null, last.error)) : null,
    h(
      'ul',
      { class: 'facts' },
      h('li', null, icon('clock', { size: 18 }), h('span', null, h('strong', null, 'Dernière publication : '), relay.running ? 'en cours…' : relay.publishedAt ? relativeTime(relay.publishedAt) : 'aucune pour l’instant, elle partira après la prochaine vérification.')),
      last?.ok && last.online === false ? h('li', null, icon('info', { size: 18 }), h('span', null, 'Version en ligne injoignable au dernier essai : seules les sources déjà relayées ont été publiées.')) : null,
    ),
    relay.sources.length
      ? h(
          'div',
          { class: 'relay-sources' },
          h('p', { class: 'relay-sources-title' }, plural(relay.sources.length, 'source relayée', 'sources relayées')),
          h(
            'ul',
            null,
            relay.sources.map((entry) =>
              h('li', null, h('span', { class: 'relay-source-name' }, entry.name), h('span', { class: 'relay-source-meta' }, [entry.at ? `relevé ${relativeTime(entry.at)}` : null, entry.found != null ? plural(entry.found, 'annonce') : null].filter(Boolean).join(' · '))),
            ),
          ),
        )
      : null,
    h(
      'div',
      { class: 'settings-actions' },
      button('Publier maintenant', { variant: 'secondary', iconName: 'refresh', onClick: (event) => ctx.relay('publish', null, event.currentTarget) }),
      button('Désactiver le relais', { variant: 'ghost', iconName: 'logout', onClick: (event) => ctx.relay('disconnect', null, event.currentTarget) }),
    ),
  );
}

function githubSection(ctx) {
  const { backend, deploy } = ctx.state;
  if (backend.kind === 'local') {
    return section('Modifier la veille', null, callout('success', 'laptop', 'Mode local', h('p', null, 'Vos modifications sont enregistrées directement dans config/veille.json sur cet ordinateur. Pour les publier en ligne, envoyez ce fichier sur GitHub (commit et push).')));
  }
  if (!deploy?.repository) {
    return section('Modifier la veille', null, callout('info', 'info', null, h('p', null, 'Les informations du dépôt GitHub sont absentes de cette version : la modification en ligne est indisponible.')));
  }
  if (backend.kind === 'github') {
    return section(
      'Modifier la veille en ligne',
      null,
      callout('success', 'github', `Connecté au dépôt ${deploy.repository}`, h('p', null, 'Vous pouvez ajouter des sources, modifier les catégories et lancer une vérification depuis cet appareil.')),
      h('div', { class: 'settings-actions' }, button('Se déconnecter', { variant: 'secondary', iconName: 'logout', onClick: () => ctx.disconnect() })),
    );
  }
  const token = input({ type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
  const connect = async (event) => {
    event.preventDefault();
    const value = token.value.trim();
    if (!value) {
      toast('Collez d’abord le jeton GitHub.', 'error');
      return;
    }
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    setBusy(submit, true, 'Vérification…');
    await ctx.connect(value);
    setBusy(submit, false);
  };
  return section(
    'Modifier la veille en ligne',
    'Sans connexion, la version en ligne est en consultation seule. Connectez GitHub une fois sur chaque appareil pour gérer les sources et les catégories.',
    h(
      'ol',
      { class: 'steps' },
      h('li', null, h('p', null, h('strong', null, 'Créez un jeton d’accès'), ` limité au dépôt ${deploy.repository}, avec les autorisations « Contents » et « Actions » en lecture et écriture.`), button('Créer le jeton sur GitHub', { variant: 'secondary', size: 'sm', href: tokenUrl(deploy.repository), external: true, iconAfter: 'external' })),
      h(
        'li',
        null,
        h('p', null, h('strong', null, 'Collez le jeton ici.'), ' Il reste uniquement dans ce navigateur.'),
        h('form', { class: 'inline-form', onSubmit: connect }, field({ label: 'Jeton GitHub', control: token }), button('Connecter', { type: 'submit', iconName: 'github' })),
      ),
    ),
  );
}

function alertsSection(ctx) {
  const { config, backend } = ctx.state;
  const canEdit = backend.canEdit;
  const notify = prefs.read('notify', false) && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const updateSetting = (key, value) =>
    ctx.updateConfig(
      (next) => {
        next.settings[key] = value;
        return next;
      },
      `Vigie : réglage des alertes (${key})`,
    );
  return section(
    'Alertes',
    null,
    toggle({
      label: 'Alertes par e-mail',
      description: 'À chaque nouveauté, Vigie ouvre un ticket sur le dépôt GitHub : GitHub vous l’envoie par e-mail si vous suivez le dépôt.',
      checked: config.settings.githubAlerts,
      disabled: !canEdit,
      onChange: (value) => updateSetting('githubAlerts', value),
    }),
    toggle({
      label: 'Seulement les annonces de vos catégories',
      description: 'Les annonces non classées n’envoient pas d’alerte.',
      checked: config.settings.alertOnlyMatching,
      disabled: !canEdit || !config.settings.githubAlerts,
      onChange: (value) => updateSetting('alertOnlyMatching', value),
    }),
    toggle({
      label: 'Notifications sur cet appareil',
      description: 'Tant que Vigie est ouvert, une notification signale les nouvelles annonces de vos catégories.',
      checked: notify,
      disabled: typeof Notification === 'undefined',
      onChange: async (value, event) => {
        if (!value) {
          prefs.write('notify', false);
          return;
        }
        const permission = await Notification.requestPermission().catch(() => 'denied');
        if (permission !== 'granted') {
          event.target.checked = false;
          toast('Les notifications sont bloquées par le navigateur pour ce site.', 'error');
          return;
        }
        prefs.write('notify', true);
        toast('Notifications activées sur cet appareil.', 'success');
      },
    }),
    canEdit ? null : h('p', { class: 'field-hint' }, 'Connectez GitHub pour modifier les alertes par e-mail.'),
  );
}

function scheduleSection(ctx) {
  const { config, backend, deploy } = ctx.state;
  const interval = input({ type: 'number', min: '5', max: '1440', step: '5', value: String(config.settings.localIntervalMinutes), inputmode: 'numeric' });
  const retention = input({ type: 'number', min: '7', max: '3650', step: '1', value: String(config.settings.retentionDays), inputmode: 'numeric' });
  const save = async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    setBusy(submit, true, 'Enregistrement…');
    await ctx.updateConfig(
      (next) => {
        next.settings.localIntervalMinutes = Number(interval.value);
        next.settings.retentionDays = Number(retention.value);
        return next;
      },
      'Vigie : réglage des vérifications',
    );
    setBusy(submit, false);
  };
  return section(
    'Vérifications automatiques',
    null,
    h(
      'ul',
      { class: 'facts' },
      h('li', null, icon('cloud', { size: 18 }), h('span', null, h('strong', null, 'En ligne : '), deploy?.schedule || 'toutes les 2 heures, via GitHub Actions.')),
      h('li', null, icon('laptop', { size: 18 }), h('span', null, h('strong', null, 'Sur votre PC : '), `toutes les ${config.settings.localIntervalMinutes} minutes tant que Vigie est lancé.`)),
    ),
    backend.canEdit
      ? h(
          'form',
          { class: 'form-grid form-grid--settings', onSubmit: save },
          field({ label: 'Intervalle sur le PC (minutes)', control: interval }),
          field({ label: 'Conservation des annonces (jours)', control: retention, hint: 'Durée de conservation des annonces disparues des sites.' }),
          h('div', { class: 'settings-actions' }, button('Enregistrer', { type: 'submit', variant: 'secondary', iconName: 'check' })),
        )
      : null,
  );
}

function deviceSection(ctx) {
  const starredCount = prefs.starred().size;
  return section(
    'Sur cet appareil',
    null,
    h(
      'div',
      { class: 'settings-actions' },
      button('Tout marquer comme lu', { variant: 'secondary', iconName: 'check', onClick: () => ctx.markAllRead() }),
      button('Exporter en CSV', { variant: 'ghost', iconName: 'download', title: 'Exporter toutes les annonces (fichier CSV)', onClick: () => ctx.exportCsv(ctx.state.enriched) }),
      starredCount
        ? button(`Ne plus suivre ${plural(starredCount, 'annonce')}`, {
            variant: 'ghost',
            iconName: 'star',
            onClick: () => {
              prefs.write('starred', []);
              ctx.refreshDerived();
              toast('Plus aucune annonce suivie.', 'success');
            },
          })
        : null,
      button('Verrouiller l’accès', {
        variant: 'ghost',
        iconName: 'lock',
        title: 'Le mot de passe sera redemandé sur cet appareil',
        onClick: () => {
          lock();
          window.location.reload();
        },
      }),
    ),
  );
}

function installSection(ctx) {
  const repository = ctx.state.deploy?.repository || 'gharel/scraping';
  return section(
    'Lancer Vigie sur votre PC',
    'Le mode local vérifie les sources depuis votre ordinateur et permet de tester une source avant de l’ajouter. Il faut Node.js 20 ou plus récent.',
    h(
      'ol',
      { class: 'steps' },
      h('li', null, h('p', null, 'Récupérez le projet :'), codeLine(`git clone https://github.com/${repository}.git vigie`)),
      h('li', null, h('p', null, 'Installez-le une fois :'), codeLine('cd vigie && npm install')),
      h('li', null, h('p', null, 'Lancez Vigie : l’interface s’ouvre sur http://localhost:4700'), codeLine('npm start')),
    ),
    h('p', { class: 'field-hint' }, 'Sous Windows, le script scripts\\windows\\installer-demarrage.ps1 lance Vigie automatiquement à l’ouverture de session.'),
    h('p', { class: 'field-hint' }, 'Activez ensuite le relais dans les réglages de Vigie sur votre PC : les sites que GitHub ne peut pas lire apparaîtront aussi sur cette version en ligne.'),
  );
}

export function renderReglages(ctx) {
  const { state } = ctx;
  const repoUrl = state.deploy?.repository ? `https://github.com/${state.deploy.repository}` : null;
  return h(
    'div',
    { class: 'view' },
    pageHead('Réglages', 'Apparence, connexion, alertes et fréquence des vérifications'),
    h(
      'div',
      { class: 'settings-grid' },
      section(
        'Apparence',
        null,
        segmented({
          name: 'theme',
          label: 'Thème',
          // Choix commun à tous les outils Skazy Formation, comme le bouton du bandeau (mêmes icônes).
          value: state.theme,
          options: [
            { value: 'system', label: 'Système', iconName: THEME_ICONS.system },
            { value: 'light', label: 'Clair', iconName: THEME_ICONS.light },
            { value: 'dark', label: 'Sombre', iconName: THEME_ICONS.dark },
          ],
          onChange: (value) => ctx.setTheme(value),
        }),
      ),
      githubSection(ctx),
      state.backend.kind === 'local' ? relaySection(ctx) : null,
      alertsSection(ctx),
      scheduleSection(ctx),
      deviceSection(ctx),
      state.backend.kind === 'local' ? null : installSection(ctx),
      section(
        'À propos',
        null,
        h('p', { class: 'about' }, 'Vigie surveille automatiquement les appels d’offres et les pages web qui vous intéressent. Interface conçue avec le design system Skazy Formation.'),
        repoUrl ? h('p', { class: 'about' }, button('Voir le dépôt sur GitHub', { variant: 'ghost', size: 'sm', href: repoUrl, external: true, iconName: 'github' })) : null,
      ),
    ),
  );
}
