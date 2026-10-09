// Applique le thème choisi avant l'affichage pour éviter un flash de couleurs.
// Choix commun à tous les outils Skazy Formation (theme.js) : « light » ou « dark » en JSON sous
// « skazy-outils:theme » ; sans clé, la page suit le système (bloc @media de tokens.css).
(function () {
  try {
    var theme = JSON.parse(window.localStorage.getItem('skazy-outils:theme'));
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  } catch (error) {
    /* stockage indisponible ou valeur illisible : thème du système */
  }
})();
