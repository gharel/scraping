/**
 * Construction du DOM sans innerHTML : tout texte issu des sites surveillés est inséré comme texte.
 */
export function safeUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('#') || url.startsWith('./') || url.startsWith('/')) return url;
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

export function append(element, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

export function h(tag, props, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key === 'style') for (const [prop, val] of Object.entries(value)) element.style.setProperty(prop, val);
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'href' || key === 'src') {
      const url = safeUrl(value);
      if (url) element.setAttribute(key, url);
    } else if (key === 'value' && 'value' in element) element.value = value;
    else if (key === 'checked' || key === 'selected' || key === 'disabled' || key === 'open' || key === 'hidden') element[key] = Boolean(value);
    else if (value === true) element.setAttribute(key, '');
    else element.setAttribute(key, String(value));
  }
  return append(element, children);
}

export function clear(element) {
  while (element.firstChild) element.firstChild.remove();
  return element;
}

let uid = 0;
export const nextId = (prefix = 'id') => `${prefix}-${(uid += 1)}`;
