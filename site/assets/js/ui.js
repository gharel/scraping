/**
 * Composants d'interface (boutons pill, badges, champs, dialogues, notifications)
 * conformes au design system Skazy Formation.
 */
import { clear, h, nextId } from './dom.js';
import { icon } from './icons.js';

export function button(label, options = {}) {
  const { variant = 'primary', size = 'md', iconName, iconAfter, onClick, type = 'button', href, external, disabled, ariaLabel, className = '', title } = options;
  const classes = `btn btn--${variant} btn--${size}${label ? '' : ' btn--icon'}${className ? ` ${className}` : ''}`;
  const content = [iconName ? icon(iconName, { size: size === 'sm' ? 16 : 18 }) : null, label ? h('span', null, label) : null, iconAfter ? icon(iconAfter, { size: 16 }) : null];
  if (href) {
    return h(
      'a',
      { class: classes, href, target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null, 'aria-label': ariaLabel, title },
      content,
    );
  }
  return h('button', { class: classes, type, onClick, disabled, 'aria-label': ariaLabel, title }, content);
}

export function iconButton(iconName, label, options = {}) {
  const { onClick, pressed, className = '', size = 20 } = options;
  return h(
    'button',
    {
      class: `icon-btn${className ? ` ${className}` : ''}`,
      type: 'button',
      'aria-label': label,
      title: label,
      'aria-pressed': pressed == null ? null : String(Boolean(pressed)),
      onClick,
    },
    icon(iconName, { size }),
  );
}

export function badge(text, tone = 'neutral', options = {}) {
  return h('span', { class: `badge badge--${tone}${options.solid ? ' badge--solid' : ''}`, title: options.title }, options.iconName ? icon(options.iconName, { size: 12 }) : null, text);
}

export function categoryBadge(category) {
  return h('span', { class: 'badge badge--cat', style: { '--cat': `var(--cat-${category.color})`, '--cat-soft': `var(--cat-${category.color}-soft)`, '--cat-text': `var(--cat-${category.color}-text)` } }, category.name);
}

export function callout(tone, iconName, title, ...body) {
  return h('div', { class: `callout callout--${tone}`, role: tone === 'danger' ? 'alert' : null }, icon(iconName, { size: 20, className: 'callout-icon' }), h('div', { class: 'callout-body' }, title ? h('p', { class: 'callout-title' }, title) : null, ...body));
}

export function emptyState(iconName, title, text, ...actions) {
  return h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, icon(iconName, { size: 28 })), h('h3', { class: 'empty-title' }, title), text ? h('p', { class: 'empty-text' }, text) : null, actions.length ? h('div', { class: 'empty-actions' }, actions) : null);
}

export function pageHead(title, subtitle, ...actions) {
  return h('div', { class: 'page-head' }, h('div', { class: 'page-head-text' }, h('h1', { class: 'page-title' }, title), subtitle ? h('p', { class: 'page-subtitle' }, subtitle) : null), actions.filter(Boolean).length ? h('div', { class: 'page-actions' }, actions) : null);
}

/* ── Champs de formulaire ─────────────────────────────────────────── */

export function field({ label, hint, required, control, id = control.id || nextId('f'), optional }) {
  control.id = id;
  const hintId = hint ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  if (required) control.required = true;
  return h(
    'div',
    { class: 'field' },
    h('label', { class: 'field-label', for: id }, label, required ? h('span', { class: 'field-required', 'aria-hidden': 'true' }, ' *') : null, optional ? h('span', { class: 'field-optional' }, ' (facultatif)') : null),
    control,
    hint ? h('p', { class: 'field-hint', id: hintId }, hint) : null,
  );
}

export function input(props = {}) {
  return h('input', { class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', ...props });
}

export function textarea(props = {}) {
  return h('textarea', { class: 'input textarea', rows: 4, ...props });
}

export function select(options, props = {}) {
  const element = h(
    'select',
    { class: 'input select', ...props },
    options.map((option) => h('option', { value: option.value, selected: option.value === props.value }, option.label)),
  );
  if (props.value != null) element.value = props.value;
  return h('div', { class: 'select-wrap' }, element, icon('chevronDown', { size: 16, className: 'select-chevron' }));
}

export function selectControl(wrap) {
  return wrap.querySelector('select');
}

export function toggle({ label, description, checked, onChange, id = nextId('t'), disabled }) {
  const control = h('input', { type: 'checkbox', class: 'switch-input', id, checked, disabled, role: 'switch', onChange: (event) => onChange?.(event.target.checked, event) });
  return h(
    'div',
    { class: 'switch-row' },
    h('div', { class: 'switch-text' }, h('label', { class: 'switch-label', for: id }, label), description ? h('p', { class: 'switch-description' }, description) : null),
    h('span', { class: 'switch' }, control, h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' }))),
  );
}

export function segmented({ name, label, options, value, onChange }) {
  return h(
    'fieldset',
    { class: 'segmented' },
    h('legend', { class: 'sr-only' }, label),
    options.map((option) => {
      const id = nextId(name);
      return h(
        'span',
        { class: 'segmented-item' },
        h('input', { type: 'radio', name, id, value: option.value, checked: option.value === value, onChange: () => onChange(option.value) }),
        h('label', { for: id }, option.iconName ? icon(option.iconName, { size: 16 }) : null, h('span', null, option.label)),
      );
    }),
  );
}

/* ── Notifications ────────────────────────────────────────────────── */

/**
 * Notification éphémère. `action` ajoute un bouton (ex. « Annuler ») ;
 * `key` remplace la notification précédente de même nature au lieu de les empiler.
 */
export function toast(message, tone = 'success', { timeout = 5000, action, key } = {}) {
  const region = document.getElementById('toasts');
  if (!region) return;
  if (key) for (const previous of region.querySelectorAll(`[data-key="${key}"]`)) previous.remove();
  const iconName = tone === 'error' ? 'alert' : tone === 'info' ? 'info' : 'checkCircle';
  const element = h('div', { class: `toast toast--${tone}`, role: tone === 'error' ? 'alert' : 'status', 'data-key': key }, icon(iconName, { size: 20 }), h('p', { class: 'toast-text' }, message));
  if (action) {
    const run = () => {
      element.remove();
      action.onClick();
    };
    element.append(h('button', { class: 'toast-action', type: 'button', onClick: run }, action.label));
  }
  const close = iconButton('x', 'Fermer la notification', { onClick: () => element.remove(), size: 16 });
  element.append(close);
  region.append(element);
  if (timeout) setTimeout(() => element.remove(), tone === 'error' ? timeout * 2 : timeout);
}

/* ── Dialogue (fenêtre modale, feuille sur mobile) ────────────────── */

export function openDialog({ title, description, body, actions = [], onClose, size = 'md' }) {
  const dialog = document.getElementById('dialog');
  clear(dialog);
  dialog.className = `dialog dialog--${size}`;
  const titleId = nextId('dlg');
  dialog.setAttribute('aria-labelledby', titleId);
  const close = () => {
    if (dialog.open) dialog.close();
  };
  dialog.append(
    h(
      'div',
      { class: 'dialog-panel' },
      h('header', { class: 'dialog-head' }, h('div', { class: 'dialog-head-text' }, h('h2', { class: 'dialog-title', id: titleId }, title), description ? h('p', { class: 'dialog-description' }, description) : null), iconButton('x', 'Fermer', { onClick: close })),
      h('div', { class: 'dialog-body' }, body),
      actions.length ? h('footer', { class: 'dialog-foot' }, actions) : null,
    ),
  );
  dialog.onclose = () => {
    onClose?.();
  };
  dialog.onclick = (event) => {
    if (event.target === dialog) close();
  };
  dialog.showModal();
  const first = dialog.querySelector('.dialog-body input:not([type="hidden"]):not([disabled]), .dialog-body textarea, .dialog-body select');
  if (first && window.matchMedia('(min-width: 768px)').matches) first.focus();
  return { close, element: dialog };
}

export function closeDialog() {
  const dialog = document.getElementById('dialog');
  if (dialog?.open) dialog.close();
}

export function setBusy(buttonElement, busy, busyLabel) {
  if (!buttonElement) return;
  buttonElement.disabled = busy;
  buttonElement.classList.toggle('is-busy', busy);
  const span = buttonElement.querySelector('span');
  if (span) {
    if (busy) {
      span.dataset.label = span.textContent;
      if (busyLabel) span.textContent = busyLabel;
    } else if (span.dataset.label) span.textContent = span.dataset.label;
  }
}
