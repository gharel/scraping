// Applique le thème choisi avant l'affichage pour éviter un flash de couleurs.
(function () {
  try {
    var theme = JSON.parse(window.localStorage.getItem('vigie.theme') || '"auto"');
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  } catch (error) {
    /* stockage indisponible */
  }
})();
