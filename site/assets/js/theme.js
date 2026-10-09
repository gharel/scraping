/**
 * Thème commun à tous les outils Skazy Formation : celui du système, clair ou sombre.
 * Les outils partagent l'origine https://gharel.github.io, donc le même stockage : un choix fait
 * dans l'un vaut pour tous. Clé sans le préfixe « vigie. » : « light » ou « dark » en JSON, clé
 * absente pour suivre le système. theme-init.js la lit avant l'affichage (la CSP interdit le
 * script en ligne).
 */
export const THEME_KEY = 'skazy-outils:theme';

/** Ordre du bouton du bandeau : système → clair → sombre → système. */
export const THEMES = ['system', 'light', 'dark'];

/** Icône du thème actuel (bouton du bandeau et Réglages). */
export const THEME_ICONS = { system: 'contrast', light: 'sun', dark: 'moon' };

// Espace insécable avant les deux-points.
const NAMES = {
  system: 'Thème : celui du système',
  light: 'Thème : clair',
  dark: 'Thème : sombre',
};

/** Valeur lue dans le stockage : tout ce qui n'est pas « light » ou « dark » suit le système. */
export const normalizeTheme = (value) => (value === 'light' || value === 'dark' ? value : 'system');

export const nextTheme = (theme) => THEMES[(THEMES.indexOf(normalizeTheme(theme)) + 1) % THEMES.length];

/** Nom accessible et infobulle du bouton : le thème actuel, puis l'action. */
export const themeLabel = (theme) => `${NAMES[normalizeTheme(theme)]}. Changer de thème`;
