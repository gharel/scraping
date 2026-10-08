/**
 * Vue « Catégories » : classement automatique des annonces par mots-clés.
 */
import { clear, h, nextId } from '../dom.js';
import { plural, prettyTitle } from '../format.js';
import { categorize, compileCategories } from '../shared/categorize.js';
import { normalizeCategory, parseKeywords, uniqueId } from '../shared/config.js';
import { button, callout, closeDialog, emptyState, field, input, openDialog, pageHead, setBusy, textarea, toast } from '../ui.js';
import { modeNotice } from './sources.js';

export const COLOR_NAMES = ['Vert', 'Bleu', 'Violet', 'Orange', 'Rose', 'Jaune', 'Turquoise', 'Gris'];

function renderCategoryCard(category, ctx, counts) {
  const count = counts.get(category.id) || 0;
  return h(
    'li',
    null,
    h(
      'article',
      { class: 'cat-card', style: { '--cat': `var(--cat-${category.color})`, '--cat-soft': `var(--cat-${category.color}-soft)`, '--cat-text': `var(--cat-${category.color}-text)` } },
      h(
        'div',
        { class: 'cat-head' },
        h('span', { class: 'cat-dot', 'aria-hidden': 'true' }),
        h('h3', { class: 'cat-name' }, category.name),
        h('button', { class: 'cat-count', type: 'button', onClick: () => ctx.showCategory(category.id), title: 'Voir ces annonces' }, plural(count, 'annonce en cours', 'annonces en cours')),
      ),
      category.keywords.length
        ? h('ul', { class: 'keyword-list', 'aria-label': `Mots-clés de ${category.name}` }, category.keywords.map((keyword) => h('li', { class: 'keyword' }, keyword)))
        : h('p', { class: 'cat-empty' }, 'Aucun mot-clé : seules les sources associées alimentent cette catégorie.'),
      ctx.state.backend.canEdit ? h('div', { class: 'cat-actions' }, button('Modifier', { variant: 'secondary', size: 'sm', iconName: 'pencil', onClick: () => openCategoryForm(ctx, category) })) : null,
    ),
  );
}

export function renderCategories(ctx) {
  const { state } = ctx;
  const open = state.enriched.filter((item) => item.open);
  const counts = new Map();
  for (const item of open) for (const id of item.categories) counts.set(id, (counts.get(id) || 0) + 1);
  const unclassified = open.filter((item) => item.categories.length === 0).length;
  const canEdit = state.backend.canEdit;

  return h(
    'div',
    { class: 'view' },
    pageHead('Catégories', 'Vigie classe chaque annonce selon vos mots-clés', canEdit ? button('Ajouter une catégorie', { iconName: 'plus', onClick: () => openCategoryForm(ctx) }) : null),
    h(
      'div',
      { class: 'notices' },
      callout(
        'info',
        'info',
        'Comment fonctionnent les mots-clés',
        h(
          'ul',
          { class: 'tips' },
          h('li', null, 'Les accents et les majuscules sont ignorés.'),
          h('li', null, 'Un mot-clé trouve le mot entier : « audit » ne trouve pas « auditorium ».'),
          h('li', null, 'Une étoile finale inclut les variantes : « format* » trouve formation, formateur, formations…'),
          h('li', null, `Une annonce peut appartenir à plusieurs catégories. ${unclassified ? `${plural(unclassified, 'annonce en cours n’est', 'annonces en cours ne sont')} dans aucune catégorie.` : ''}`),
        ),
      ),
      canEdit ? null : modeNotice(ctx),
    ),
    state.config.categories.length
      ? h('ul', { class: 'cat-list' }, state.config.categories.map((category) => renderCategoryCard(category, ctx, counts)))
      : emptyState('tags', 'Aucune catégorie', 'Créez des catégories pour repérer en un coup d’œil les annonces qui vous concernent.', canEdit ? button('Ajouter une catégorie', { iconName: 'plus', onClick: () => openCategoryForm(ctx) }) : null),
  );
}

export function openCategoryForm(ctx, existing = null) {
  const { config } = ctx.state;
  const name = input({ value: existing?.name || '', placeholder: 'Formation', maxlength: 40 });
  const keywords = textarea({ value: (existing?.keywords || []).join('\n'), rows: 8, placeholder: 'formation*\ne-learning\ningénierie pédagogique', spellcheck: 'false' });
  let color = existing?.color || ((config.categories.length % 8) + 1);
  const preview = h('div', { class: 'preview', 'aria-live': 'polite' });
  const error = h('div', { class: 'form-error', 'aria-live': 'assertive' });

  const swatchName = nextId('color');
  const swatches = h(
    'div',
    { class: 'swatches', role: 'radiogroup', 'aria-label': 'Couleur' },
    COLOR_NAMES.map((label, index) => {
      const value = index + 1;
      const id = nextId('swatch');
      return h(
        'span',
        { class: 'swatch', style: { '--cat': `var(--cat-${value})` } },
        h('input', { type: 'radio', name: swatchName, id, value: String(value), checked: value === color, onChange: () => (color = value) }),
        h('label', { for: id, title: label }, h('span', { class: 'sr-only' }, label)),
      );
    }),
  );

  const current = () => normalizeCategory({ id: existing?.id || 'apercu', name: name.value || 'Catégorie', color, keywords: parseKeywords(keywords.value) });

  let timer;
  const updatePreview = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      clear(preview);
      const category = current();
      if (!category.keywords.length) {
        preview.append(h('p', { class: 'field-hint' }, 'Ajoutez des mots-clés pour voir les annonces correspondantes.'));
        return;
      }
      const compiled = compileCategories([category]);
      const matches = ctx.state.enriched.filter((item) => item.open && categorize(item, compiled).length);
      preview.append(
        h(
          'div',
          { class: 'preview-box' },
          h('p', { class: 'preview-title' }, matches.length ? `${plural(matches.length, 'annonce en cours correspond', 'annonces en cours correspondent')} à ces mots-clés` : 'Aucune annonce en cours ne correspond pour l’instant'),
          matches.length ? h('ul', { class: 'preview-list' }, matches.slice(0, 5).map((item) => h('li', null, prettyTitle(item.title)))) : null,
        ),
      );
    }, 200);
  };
  keywords.addEventListener('input', updatePreview);
  updatePreview();

  const save = async (event) => {
    event?.preventDefault();
    clear(error);
    const values = current();
    if (!name.value.trim()) {
      error.append(callout('danger', 'alert', null, h('p', null, 'Donnez un nom à la catégorie.')));
      return;
    }
    const duplicate = config.categories.find((category) => category.name.toLowerCase() === name.value.trim().toLowerCase() && category.id !== existing?.id);
    if (duplicate) {
      error.append(callout('danger', 'alert', null, h('p', null, `La catégorie « ${duplicate.name} » existe déjà.`)));
      return;
    }
    const category = { ...values, id: existing?.id || uniqueId(name.value, config.categories.map((entry) => entry.id)), name: name.value.trim() };
    const saveButton = document.querySelector('#dialog .js-save');
    setBusy(saveButton, true, 'Enregistrement…');
    const ok = await ctx.updateConfig((next) => {
      const index = next.categories.findIndex((entry) => entry.id === category.id);
      if (index >= 0) next.categories[index] = category;
      else next.categories.push(category);
      return next;
    }, `Vigie : ${existing ? 'modification' : 'ajout'} de la catégorie « ${category.name} »`);
    setBusy(saveButton, false);
    if (ok) closeDialog();
  };

  const remove = async (event) => {
    const target = event.currentTarget;
    if (!target.classList.contains('is-confirm')) {
      target.classList.add('is-confirm');
      target.querySelector('span').textContent = 'Confirmer la suppression';
      return;
    }
    setBusy(target, true, 'Suppression…');
    const ok = await ctx.updateConfig((next) => {
      next.categories = next.categories.filter((entry) => entry.id !== existing.id);
      for (const source of next.sources) source.categories = source.categories.filter((id) => id !== existing.id);
      return next;
    }, `Vigie : suppression de la catégorie « ${existing.name} »`);
    setBusy(target, false);
    if (ok) {
      closeDialog();
      toast(`Catégorie « ${existing.name} » supprimée.`, 'success');
    }
  };

  openDialog({
    title: existing ? `Modifier « ${existing.name} »` : 'Ajouter une catégorie',
    body: h(
      'form',
      { class: 'form', novalidate: true, onSubmit: save },
      field({ label: 'Nom', required: true, control: name }),
      h('div', { class: 'field' }, h('p', { class: 'field-label' }, 'Couleur'), swatches),
      field({ label: 'Mots-clés', control: keywords, hint: 'Un mot-clé ou une expression par ligne. Terminez par * pour inclure les variantes.' }),
      preview,
      error,
    ),
    actions: [
      existing ? button('Supprimer', { variant: 'danger-ghost', iconName: 'trash', className: 'dialog-foot-start', onClick: remove }) : null,
      button('Annuler', { variant: 'ghost', onClick: () => closeDialog() }),
      button(existing ? 'Enregistrer' : 'Ajouter la catégorie', { iconName: 'check', className: 'js-save', onClick: save }),
    ].filter(Boolean),
  });
}
