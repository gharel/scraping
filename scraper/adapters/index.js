import atexo from './atexo.js';
import liste from './liste.js';
import page from './page.js';
import rss from './rss.js';

const ADAPTERS = { atexo, rss, liste, page };

export function getAdapter(type) {
  const adapter = ADAPTERS[type];
  if (!adapter) throw new Error(`Type de source inconnu : ${type}`);
  return adapter;
}
