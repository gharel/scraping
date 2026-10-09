/**
 * Bouton « Remonter en haut », sur toutes les vues : il apparaît une fois que l'on a défilé de
 * plus d'un écran (1,2 × la hauteur de la fenêtre) et ramène en haut de la page, puis place le
 * focus sur le titre de la vue.
 */

/** Seuil d'apparition du bouton. */
export const backToTopVisible = (scrollY, viewportHeight) => scrollY >= viewportHeight * 1.2;

/**
 * Branche le bouton ; `target` renvoie l'élément qui reçoit le focus en haut de page.
 * Renvoie la fonction de mise à jour (à rappeler si la page change de hauteur).
 */
export function initBackToTop(button, target) {
  if (!button) return () => {};
  const update = () => button.classList.toggle('is-visible', backToTopVisible(window.scrollY, window.innerHeight));
  button.addEventListener('click', () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    // Cible focalisable par script seulement : pas d'anneau au clic de souris (:focus-visible).
    const element = target();
    if (!element) return;
    if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
    element.focus({ preventScroll: true });
  });
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
  return update;
}
