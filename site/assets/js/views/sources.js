/**
 * Vue « Sources » : sites surveillés, état de chaque vérification, ajout et modification.
 */
import { clear, h, nextId } from '../dom.js';
import { icon } from '../icons.js';
import { formatDate, plural, prettyTitle, relativeTime } from '../format.js';
import { outOfReach, relayed } from '../model.js';
import { guessSourceType, KIND_LABELS, normalizeSource, REGIONS, SOURCE_TYPES, sourceProblems, uniqueId } from '../shared/config.js';
import { badge, button, callout, categoryBadge, closeDialog, emptyState, field, input, openDialog, pageHead, segmented, select, selectControl, setBusy, toggle, toast } from '../ui.js';

const TYPE_ICONS = { atexo: 'landmark', rss: 'rss', page: 'globe', liste: 'list' };

function statusPill(source, status) {
  if (!source.enabled) return badge('En pause', 'neutral', { iconName: 'pause' });
  if (!status?.lastRun) return badge('Pas encore vérifiée', 'neutral');
  if (relayed(status)) return badge(`Relayée depuis votre PC · ${relativeTime(status.relayAt)}`, 'info', { iconName: 'laptop', title: `Relevé du ${formatDate(status.relayAt, { time: true })}` });
  if (outOfReach(status)) return badge('Hors de portée en ligne', 'warning', { iconName: 'globe' });
  if (status.ok === false) return badge('Erreur', 'danger', { iconName: 'alert' });
  return badge('À jour', 'success', { iconName: 'check' });
}

function statusMessage(status) {
  if (relayed(status)) {
    return h(
      'p',
      { class: 'source-error source-error--relay' },
      icon('laptop', { size: 16 }),
      h(
        'span',
        null,
        // Date insécable : « 8 h 03 » ne se coupe pas en fin de ligne.
        `Les serveurs de GitHub ne peuvent pas lire ce site : ses annonces ont été lues par Vigie sur votre PC (relevé du ${formatDate(status.relayAt, { time: true }).replace(/ /g, ' ')}) puis publiées ici.`,
        status.directError ? h('small', null, status.directError) : null,
      ),
    );
  }
  if (status?.ok !== false || !status.error) return null;
  if (outOfReach(status)) {
    return h(
      'p',
      { class: 'source-error source-error--reach' },
      icon('globe', { size: 16 }),
      h(
        'span',
        null,
        'Ce site ne répond pas aux serveurs de GitHub qui assurent la veille en ligne : il filtre sans doute les connexions venant de l’étranger. Il reste lisible depuis votre PC : avec le relais activé dans les réglages de Vigie en local, ses annonces sont publiées ici.',
        status.relayAt ? ` Dernier relevé relayé ${relativeTime(status.relayAt)}, trop ancien pour être repris.` : null,
        h('small', null, status.error),
      ),
    );
  }
  return h('p', { class: 'source-error' }, icon('alert', { size: 16 }), h('span', null, status.error, status.lastSuccess ? ` (dernier succès ${relativeTime(status.lastSuccess)})` : ''));
}

export function modeNotice(ctx) {
  const { backend, local, deploy } = ctx.state;
  if (backend.kind === 'local') {
    return callout('success', 'laptop', 'Mode local', h('p', null, `Vigie tourne sur cet ordinateur et vérifie les sources toutes les ${local?.intervalMinutes || ctx.state.config.settings.localIntervalMinutes} minutes. Vos modifications sont enregistrées dans config/veille.json.`));
  }
  if (backend.kind === 'github') {
    return callout('success', 'github', 'Connecté à GitHub', h('p', null, `Vos modifications sont enregistrées dans le dépôt ${deploy.repository} puis mises en ligne en 1 à 2 minutes.`));
  }
  return callout(
    'info',
    'info',
    'Consultation seule',
    h('p', null, 'Pour ajouter ou modifier des sources depuis cette page, connectez votre compte GitHub dans les réglages.'),
    h('p', { class: 'callout-actions' }, button('Connecter GitHub', { variant: 'secondary', size: 'sm', href: '#reglages', iconName: 'github' }), backend.editUrl ? button('Modifier le fichier sur GitHub', { variant: 'ghost', size: 'sm', href: backend.editUrl, external: true, iconAfter: 'external' }) : null),
  );
}

function renderSourceCard(source, ctx, counts, categoriesById) {
  const status = ctx.state.status?.sources?.[source.id];
  const canEdit = ctx.state.backend.canEdit;
  const forced = source.categories.map((id) => categoriesById.get(id)).filter(Boolean);
  const stats = [
    ['Annonces', (counts.get(source.id) || 0).toLocaleString('fr-FR')],
    ['Dernière vérification', status?.lastRun ? relativeTime(status.lastRun) : 'jamais'],
    status?.durationMs ? ['Durée', `${(status.durationMs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`] : null,
  ].filter(Boolean);

  return h(
    'li',
    null,
    h(
      'article',
      { class: `source-card${source.enabled ? '' : ' is-paused'}` },
      h(
        'div',
        { class: 'source-head' },
        h('span', { class: 'source-icon', 'aria-hidden': 'true' }, icon(TYPE_ICONS[source.type] || 'globe', { size: 20 })),
        h('div', { class: 'source-title' }, h('h3', null, source.name), h('p', null, SOURCE_TYPES[source.type]?.short || source.type)),
        statusPill(source, status),
      ),
      h('a', { class: 'source-url', href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.url),
      h('dl', { class: 'source-stats' }, stats.map(([label, value]) => h('div', null, h('dt', null, label), h('dd', null, value)))),
      statusMessage(status),
      forced.length ? h('div', { class: 'source-cats' }, h('span', { class: 'source-cats-label' }, 'Toujours classée dans :'), forced.map((category) => categoryBadge(category))) : null,
      canEdit
        ? h(
            'div',
            { class: 'source-actions' },
            button('Modifier', { variant: 'secondary', size: 'sm', iconName: 'pencil', onClick: () => openSourceForm(ctx, source) }),
            button(source.enabled ? 'Mettre en pause' : 'Réactiver', {
              variant: 'ghost',
              size: 'sm',
              iconName: source.enabled ? 'pause' : 'play',
              onClick: (event) =>
                ctx.updateConfig(
                  (config) => {
                    const target = config.sources.find((entry) => entry.id === source.id);
                    if (target) target.enabled = !source.enabled;
                    return config;
                  },
                  `Vigie : ${source.enabled ? 'pause' : 'reprise'} de la source « ${source.name} »`,
                  event.currentTarget,
                ),
            }),
          )
        : null,
    ),
  );
}

export function renderSources(ctx) {
  const { state } = ctx;
  const counts = new Map();
  for (const item of state.items) counts.set(item.sourceId, (counts.get(item.sourceId) || 0) + 1);
  const categoriesById = new Map(state.config.categories.map((category) => [category.id, category]));
  const canEdit = state.backend.canEdit;
  const sources = state.config.sources;
  const enabledStatus = sources.filter((source) => source.enabled).map((source) => state.status?.sources?.[source.id]);
  const relayCount = enabledStatus.filter(relayed).length;
  const okCount = enabledStatus.filter((status) => status?.ok).length - relayCount;
  const reachCount = enabledStatus.filter(outOfReach).length;
  const activeCount = enabledStatus.length;

  return h(
    'div',
    { class: 'view' },
    pageHead(
      'Sources',
      sources.length
        ? `${plural(activeCount, 'source active', 'sources actives')} · ${okCount} à jour${relayCount ? ` · ${relayCount} relayée${relayCount > 1 ? 's' : ''} depuis votre PC` : ''}${reachCount ? ` · ${reachCount} hors de portée en ligne` : ''}`
        : 'Les sites et flux que Vigie surveille pour vous',
      canEdit ? button('Ajouter une source', { iconName: 'plus', onClick: () => openSourceForm(ctx) }) : null,
      canEdit ? button('Vérifier maintenant', { variant: 'secondary', iconName: 'refresh', onClick: (event) => ctx.runNow(event.currentTarget) }) : null,
    ),
    h('div', { class: 'notices' }, modeNotice(ctx)),
    sources.length
      ? h(
          'div',
          { class: 'source-groups' },
          Object.entries(REGIONS)
            .map(([region, info]) => [region, info, sources.filter((source) => (source.region || 'nc') === region)])
            .filter(([, , list]) => list.length)
            .map(([region, info, list]) =>
              h(
                'section',
                { class: 'source-group', 'aria-labelledby': `region-${region}` },
                h('h2', { class: 'source-group-title', id: `region-${region}` }, info.label, h('span', { class: 'source-group-count' }, plural(list.length, 'source'))),
                h('ul', { class: 'source-list' }, list.map((source) => renderSourceCard(source, ctx, counts, categoriesById))),
              ),
            ),
        )
      : emptyState('globe', 'Aucune source surveillée', 'Ajoutez l’adresse d’un portail de marchés publics, d’un flux RSS ou de n’importe quelle page web.', canEdit ? button('Ajouter une source', { iconName: 'plus', onClick: () => openSourceForm(ctx) }) : null),
  );
}

/* ── Formulaire d'ajout / modification ────────────────────────────── */

const LISTE_FIELDS = [
  ['title', 'Titre', 'td:nth-child(2) > a', true],
  ['url', 'Lien', 'a@href'],
  ['deadline', 'Date limite', 'time@datetime'],
  ['publishedAt', 'Date de publication', '.date'],
  ['reference', 'Référence', '.ref'],
  ['buyer', 'Acheteur', '.acheteur'],
  ['summary', 'Résumé', '.resume'],
  ['location', 'Lieu', '.lieu'],
  ['nature', 'Nature', '.nature'],
  ['status', 'Statut', '.statut'],
];

function typeOptions(type, options, refs) {
  if (type === 'atexo') {
    refs.lieux = input({ value: options.lieux || '', placeholder: '6489, 6472', inputmode: 'numeric' });
    refs.motsCles = input({ value: options.motsCles || '', placeholder: 'formation' });
    refs.lieuxMax = input({ type: 'number', min: '1', max: '500', value: options.lieuxMax ? String(options.lieuxMax) : '', placeholder: '20', inputmode: 'numeric' });
    return h(
      'div',
      { class: 'form-stack' },
      h('p', { class: 'form-note' }, icon('info', { size: 16 }), 'Collez l’adresse de la liste des consultations. Vigie parcourt toutes les pages de résultats et récupère acheteur, référence, procédure, lots et date limite.'),
      h(
        'div',
        { class: 'form-grid' },
        field({ label: 'Lieux d’exécution', optional: true, control: refs.lieux, hint: 'Codes Atexo, avec l’adresse de recherche avancée. État : 6489 Nouvelle-Calédonie, 6472 Polynésie, 6494 Wallis-et-Futuna, 6463 Vanuatu.' }),
        field({ label: 'Mots-clés de recherche', optional: true, control: refs.motsCles }),
        field({ label: 'Limite de lieux', optional: true, control: refs.lieuxMax, hint: 'Écarte les marchés nationaux qui citent de très nombreux lieux.' }),
      ),
    );
  }
  if (type === 'rss') {
    const kind = select(
      [{ value: '', label: 'Automatique (d’après le titre)' }, ...['consultation', 'appel-a-projets', 'attribution', 'annonce'].map((value) => ({ value, label: KIND_LABELS[value] }))],
      { value: options.kind || '' },
    );
    refs.kind = selectControl(kind);
    return field({ label: 'Type des annonces du flux', control: kind, hint: 'Utile si le flux ne publie qu’un seul type d’annonces.' });
  }
  if (type === 'page') {
    refs.detect = options.detect === 'liens' ? 'liens' : 'texte';
    refs.selector = input({ value: options.selector || '', placeholder: 'main, #contenu, .liste-avis…' });
    refs.ignore = input({ value: (options.ignore || []).join(', '), placeholder: '.date-du-jour, #bandeau-cookies' });
    refs.match = input({ value: options.match || '', placeholder: '\\.pdf|avis|consultation' });
    refs.exclude = input({ value: options.exclude || '', placeholder: 'reglement|plan-acces' });
    refs.keep = { value: Boolean(options.keep) };
    return h(
      'div',
      { class: 'form-stack' },
      h(
        'div',
        { class: 'field' },
        h('p', { class: 'field-label' }, 'Ce que Vigie doit signaler'),
        segmented({
          name: 'detect',
          label: 'Ce que Vigie doit signaler',
          value: refs.detect,
          options: [
            { value: 'liens', label: 'Chaque avis listé (liens)' },
            { value: 'texte', label: 'Les modifications du texte' },
          ],
          onChange: (value) => {
            refs.detect = value;
          },
        }),
        h('p', { class: 'field-hint' }, 'Choisissez « chaque avis listé » pour une page qui liste des avis ou des documents PDF : chaque lien devient une annonce.'),
      ),
      field({ label: 'Zone à surveiller', optional: true, control: refs.selector, hint: 'Sélecteur CSS de la partie utile de la page. Par défaut : le contenu principal.' }),
      h(
        'div',
        { class: 'form-grid' },
        field({ label: 'Liens à garder', optional: true, control: refs.match, hint: 'Expression régulière testée sur le texte et l’adresse du lien.' }),
        field({ label: 'Liens à écarter', optional: true, control: refs.exclude, hint: 'Menus, règlements permanents, plans d’accès…' }),
      ),
      field({ label: 'Éléments à ignorer', optional: true, control: refs.ignore, hint: 'Sélecteurs CSS séparés par des virgules (dates, compteurs, bandeaux) pour éviter les fausses alertes.' }),
      toggle({ label: 'Liste des derniers avis', description: 'Les annonces qui sortent de la page restent dans Vigie au lieu d’être marquées « retirées ».', checked: refs.keep.value, onChange: (value) => (refs.keep.value = value) }),
    );
  }
  refs.item = input({ value: options.item || '', placeholder: 'table tbody tr' });
  refs.fields = {};
  refs.keep = { value: Boolean(options.keep) };
  const rows = LISTE_FIELDS.map(([key, label, placeholder, required]) => {
    refs.fields[key] = input({ value: options.fields?.[key] || '', placeholder });
    return field({ label, required, optional: !required, control: refs.fields[key] });
  });
  return h(
    'div',
    { class: 'form-stack' },
    h('p', { class: 'form-note' }, icon('info', { size: 16 }), 'Chaque champ est un sélecteur CSS relatif à une annonce. Ajoutez @attribut pour lire un attribut, par exemple a@href ou time@datetime.'),
    field({ label: 'Sélecteur des annonces', required: true, control: refs.item, hint: 'Un élément par annonce.' }),
    h('div', { class: 'form-grid' }, rows),
    toggle({ label: 'Liste des derniers avis', description: 'Les annonces qui sortent de la page restent dans Vigie au lieu d’être marquées « retirées ».', checked: refs.keep.value, onChange: (value) => (refs.keep.value = value) }),
  );
}

function readOptions(type, refs) {
  if (type === 'atexo') {
    return { lieux: refs.lieux.value.trim(), motsCles: refs.motsCles.value.trim(), lieuxMax: refs.lieuxMax.value ? Number(refs.lieuxMax.value) : undefined };
  }
  if (type === 'rss') return refs.kind?.value ? { kind: refs.kind.value } : {};
  if (type === 'page') {
    return {
      detect: refs.detect,
      selector: refs.selector.value.trim(),
      ignore: refs.ignore.value.split(',').map((s) => s.trim()).filter(Boolean),
      match: refs.match.value.trim(),
      exclude: refs.exclude.value.trim(),
      keep: refs.keep.value,
    };
  }
  if (type === 'liste') {
    const fields = {};
    for (const [key, control] of Object.entries(refs.fields || {})) if (control.value.trim()) fields[key] = control.value.trim();
    return { item: refs.item.value.trim(), fields, keep: refs.keep.value };
  }
  return {};
}

function renderPreview(container, result) {
  clear(container);
  if (result.error) {
    container.append(callout('danger', 'alert', 'Le test a échoué', h('p', null, result.error)));
    return;
  }
  const lines = result.items?.length
    ? h('ul', { class: 'preview-list' }, result.items.map((item) => h('li', null, h('strong', null, prettyTitle(item.title)), item.deadline ? h('span', null, ` · date limite ${formatDate(item.deadline)}`) : null)))
    : result.sample?.length
      ? h('ul', { class: 'preview-list' }, result.sample.map((line) => h('li', null, line)))
      : null;
  const summary =
    result.type === 'page' && !result.listing
      ? `Page lue : ${plural(result.lines || 0, 'ligne')} de texte. Vigie signalera chaque modification à partir de cet état.`
      : `${plural(result.found, 'annonce trouvée', 'annonces trouvées')}${result.total && result.total !== result.found ? ` sur ${result.total}` : ''}.`;
  container.append(callout('success', 'checkCircle', 'La source fonctionne', h('p', null, summary), lines));
}

export function openSourceForm(ctx, existing = null) {
  const { config } = ctx.state;
  let type = existing?.type || 'atexo';
  let typeTouched = Boolean(existing);
  const refs = {};
  const name = input({ value: existing?.name || '', placeholder: 'Marchés publics NC', maxlength: 80 });
  const url = input({ value: existing?.url || '', type: 'url', placeholder: 'https://…', inputmode: 'url' });
  const regionSelect = select(
    Object.entries(REGIONS).map(([value, info]) => ({ value, label: info.label })),
    { value: existing?.region || 'nc' },
  );
  const optionsBox = h('div', { class: 'type-options' });
  const preview = h('div', { class: 'preview', 'aria-live': 'polite' });
  const enabled = { value: existing ? existing.enabled : true };
  const selected = new Set(existing?.categories || []);

  const renderOptions = () => {
    clear(optionsBox);
    optionsBox.append(typeOptions(type, existing?.type === type ? existing.options : {}, refs));
  };

  const typeName = nextId('type');
  const typeCards = h(
    'div',
    { class: 'type-cards', role: 'radiogroup', 'aria-label': 'Type de source' },
    Object.entries(SOURCE_TYPES).map(([value, info]) => {
      const id = nextId('type');
      return h(
        'label',
        { class: 'type-card', for: id },
        h('input', {
          type: 'radio',
          name: typeName,
          id,
          value,
          checked: value === type,
          onChange: () => {
            type = value;
            typeTouched = true;
            renderOptions();
          },
        }),
        h('span', { class: 'type-card-icon', 'aria-hidden': 'true' }, icon(TYPE_ICONS[value], { size: 20 })),
        h('span', { class: 'type-card-text' }, h('span', { class: 'type-card-title' }, info.label), h('span', { class: 'type-card-hint' }, info.hint)),
      );
    }),
  );

  url.addEventListener('input', () => {
    if (typeTouched) return;
    const guess = guessSourceType(url.value);
    if (guess !== type) {
      type = guess;
      typeCards.querySelector(`input[value="${guess}"]`).checked = true;
      renderOptions();
    }
  });

  const categoryChecks = config.categories.length
    ? h(
        'div',
        { class: 'check-chips' },
        config.categories.map((category) => {
          const id = nextId('cat');
          return h(
            'label',
            { class: 'check-chip', for: id, style: { '--cat': `var(--cat-${category.color})` } },
            h('input', { type: 'checkbox', id, checked: selected.has(category.id), onChange: (event) => (event.target.checked ? selected.add(category.id) : selected.delete(category.id)) }),
            h('span', { class: 'chip-dot', 'aria-hidden': 'true' }),
            h('span', null, category.name),
          );
        }),
      )
    : h('p', { class: 'field-hint' }, 'Aucune catégorie définie.');

  renderOptions();

  const build = () =>
    normalizeSource({
      id: existing?.id || uniqueId(name.value || url.value, config.sources.map((source) => source.id)),
      name: name.value.trim(),
      url: url.value.trim(),
      type,
      region: selectControl(regionSelect).value,
      enabled: enabled.value,
      categories: [...selected],
      // Les réglages avancés absents du formulaire (lecture des fiches, nature imposée…) sont conservés.
      options: { ...(existing?.type === type ? existing.options : {}), ...readOptions(type, refs) },
    });

  const error = h('div', { class: 'form-error', 'aria-live': 'assertive' });
  const showError = (message) => {
    clear(error);
    if (message) error.append(callout('danger', 'alert', null, h('p', null, message)));
  };

  const save = async (event) => {
    event?.preventDefault();
    const source = build();
    const problems = sourceProblems(source, new Set(config.categories.map((category) => category.id)));
    if (!source.name) problems.unshift('donnez un nom à la source');
    if (problems.length) {
      showError(`À corriger : ${problems.join(' ; ')}.`);
      return;
    }
    const duplicate = config.sources.find((entry) => entry.url === source.url && entry.id !== source.id);
    if (duplicate) {
      showError(`Cette adresse est déjà surveillée par la source « ${duplicate.name} ».`);
      return;
    }
    const saveButton = document.querySelector('#dialog .js-save');
    setBusy(saveButton, true, 'Enregistrement…');
    const ok = await ctx.updateConfig(
      (next) => {
        const index = next.sources.findIndex((entry) => entry.id === source.id);
        if (index >= 0) next.sources[index] = source;
        else next.sources.push(source);
        return next;
      },
      `Vigie : ${existing ? 'modification' : 'ajout'} de la source « ${source.name} »`,
    );
    setBusy(saveButton, false);
    if (!ok) return;
    closeDialog();
    // En local, première vérification immédiate de la source ajoutée ou modifiée.
    if (ctx.state.backend.kind === 'local' && source.enabled) ctx.runNow(null, [source.id]);
  };

  const test = async (event) => {
    const source = build();
    const problems = sourceProblems(source, new Set(config.categories.map((category) => category.id)));
    if (problems.length) {
      showError(`À corriger avant le test : ${problems.join(' ; ')}.`);
      return;
    }
    showError(null);
    setBusy(event.currentTarget, true, 'Test en cours…');
    try {
      renderPreview(preview, await ctx.state.backend.testSource(source));
    } catch (failure) {
      renderPreview(preview, { error: failure.message });
    } finally {
      setBusy(event.currentTarget, false);
    }
  };

  const remove = async (event) => {
    const target = event.currentTarget;
    if (!target.classList.contains('is-confirm')) {
      target.classList.add('is-confirm');
      target.querySelector('span').textContent = 'Confirmer la suppression';
      setTimeout(() => {
        if (target.isConnected) {
          target.classList.remove('is-confirm');
          target.querySelector('span').textContent = 'Supprimer';
        }
      }, 5000);
      return;
    }
    setBusy(target, true, 'Suppression…');
    const ok = await ctx.updateConfig((next) => {
      next.sources = next.sources.filter((entry) => entry.id !== existing.id);
      return next;
    }, `Vigie : suppression de la source « ${existing.name} »`);
    setBusy(target, false);
    if (ok) {
      closeDialog();
      toast(`Source « ${existing.name} » supprimée. Ses annonces disparaîtront au prochain passage.`, 'success');
    }
  };

  const form = h(
    'form',
    { class: 'form', novalidate: true, onSubmit: save },
    field({ label: 'Nom', required: true, control: name }),
    field({ label: 'Adresse', required: true, control: url, hint: 'Page, flux RSS ou liste de consultations à surveiller.' }),
    field({ label: 'Territoire', control: regionSelect, hint: '« Pacifique (régional) » : chaque annonce est rattachée au territoire cité dans son lieu ou son titre.' }),
    h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'Type de source'), typeCards),
    optionsBox,
    h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'Catégories imposées', h('span', { class: 'field-optional' }, ' (facultatif)')), categoryChecks, h('p', { class: 'field-hint' }, 'Toutes les annonces de cette source iront dans ces catégories, en plus du classement par mots-clés.')),
    existing ? toggle({ label: 'Source active', description: 'Une source en pause n’est plus vérifiée ; ses annonces restent visibles.', checked: enabled.value, onChange: (value) => (enabled.value = value) }) : null,
    ctx.state.backend.canTest ? h('div', { class: 'test-row' }, button('Tester la source', { variant: 'secondary', iconName: 'play', onClick: test }), h('p', { class: 'field-hint' }, 'Lit la page maintenant, sans rien enregistrer.')) : null,
    preview,
    error,
    h('button', { type: 'submit', hidden: true, tabindex: '-1', 'aria-hidden': 'true' }),
  );

  openDialog({
    title: existing ? `Modifier « ${existing.name} »` : 'Ajouter une source',
    description: existing ? null : 'Vigie vérifiera cette adresse à chaque passage et vous signalera les nouveautés.',
    body: form,
    size: 'lg',
    actions: [
      existing ? button('Supprimer', { variant: 'danger-ghost', iconName: 'trash', className: 'dialog-foot-start', onClick: remove }) : null,
      button('Annuler', { variant: 'ghost', onClick: () => closeDialog() }),
      button(existing ? 'Enregistrer' : 'Ajouter la source', { iconName: 'check', className: 'js-save', onClick: save }),
    ].filter(Boolean),
  });
}
