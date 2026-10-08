/**
 * Vue « Réglages » : thème, connexion GitHub, alertes, fréquence, données de l'appareil.
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { plural } from '../format.js';
import * as prefs from '../prefs.js';
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

function tokenUrl(repository) {
  const [owner, repo] = String(repository || '').split('/');
  const params = new URLSearchParams({
    name: `Vigie (${repo || 'veille'})`,
    description: 'Modifier la veille Vigie depuis la version en ligne',
    target_name: owner || '',
    expires_in: '366',
    contents: 'write',
    actions: 'write',
  });
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
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
          value: prefs.read('theme', 'auto'),
          options: [
            { value: 'auto', label: 'Automatique', iconName: 'monitor' },
            { value: 'light', label: 'Clair', iconName: 'sun' },
            { value: 'dark', label: 'Sombre', iconName: 'moon' },
          ],
          onChange: (value) => ctx.setTheme(value),
        }),
      ),
      githubSection(ctx),
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
