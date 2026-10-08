# Vigie — veille des appels d’offres

Vigie surveille automatiquement les appels d’offres publiés en Nouvelle-Calédonie et toutes les pages web que vous lui confiez. Les nouveautés sont classées par catégories, signalées dans l’interface et, si vous le souhaitez, envoyées par e-mail.

**Version en ligne : <https://gharel.github.io/scraping/>**

| Bureau | Mobile (thème sombre) |
| --- | --- |
| ![Vigie sur ordinateur](docs/apercu-bureau.png) | ![Vigie sur mobile](docs/apercu-mobile.png) |

Interface conçue avec le design system **Skazy Formation** (Claude Design) : police Georama, vert `#50967c`, boutons pill, cartes à barre de couleur. Responsive, thème clair et sombre.

## Ce que fait Vigie

- **Surveille** marchespublics.nc et d’autres sources toutes les 2 heures (en ligne) ou toutes les heures (sur votre PC).
- **Lit les consultations en détail** : acheteur, référence, procédure, nature, nombre de lots, date limite.
- **Classe** chaque annonce dans vos catégories grâce à des mots-clés (Formation, Numérique & IA…), avec filtres.
- **Signale** les nouveautés depuis votre dernière visite, les clôtures proches (compte à rebours J-n) et les reports de date limite.
- **Alerte par e-mail** via un ticket GitHub quand une nouvelle annonce entre dans vos catégories.
- **Exporte** les annonces affichées en CSV (Excel).

## Sources surveillées par défaut

| Source | Type | Contenu |
| --- | --- | --- |
| [Marchés publics NC](https://portail.marchespublics.nc/?page=Entreprise.EntrepriseAdvancedSearch&AllCons) | Portail Atexo | Toutes les consultations en cours (Gouvernement, provinces, communes, établissements publics) |
| [Province Sud · commande publique](https://www.province-sud.nc/aops/) | Flux RSS | Avis d’appel d’offres et d’attribution |
| [Province Sud · appels à projets](https://www.province-sud.nc/aaps/) | Flux RSS | Appels à projets |
| [CAFAT · marchés](https://www.cafat.nc/nos-marches/) | Flux RSS | Marchés de la CAFAT |
| [Communauté du Pacifique (CPS)](https://www.spc.int/procurement) | Liste CSS | Appels d’offres ouverts de la CPS (siège à Nouméa) |
| [Marchés publics NC · informations](https://marchespublics.nc/accueil) | Page web | Changements des informations de la plateforme |

La plateforme de la Province Nord renvoie vers marchespublics.nc : ses consultations y sont déjà couvertes.

## Utiliser Vigie

- **Annonces** : les tuiles du haut filtrent en un clic (en cours, nouvelles, clôture proche, suivies). Les puces de catégories, la recherche, le statut, la source et le type affinent la liste. L’étoile « suit » une annonce sur l’appareil.
- **Sources** : état de chaque vérification (à jour, erreur, en pause), ajout et modification.
- **Catégories** : mots-clés de classement, avec aperçu en direct des annonces trouvées.
- **Réglages** : thème, connexion GitHub, alertes, fréquence, export.

### Modifier la veille depuis la version en ligne

La version en ligne est en consultation seule tant que vous n’avez pas connecté GitHub sur l’appareil :

1. Dans **Réglages**, cliquez sur « Créer le jeton sur GitHub ».
2. Choisissez le dépôt `gharel/scraping` uniquement, avec les autorisations **Contents** et **Actions** en lecture et écriture.
3. Collez le jeton dans Vigie. Il reste stocké dans ce navigateur uniquement.

Chaque modification crée un commit sur `config/veille.json` ; la veille relance alors une vérification et republie le site en 1 à 2 minutes. Le bouton « Vérifier maintenant » déclenche une vérification immédiate.

Sans jeton, vous pouvez aussi modifier [config/veille.json](config/veille.json) directement sur GitHub.

### Recevoir les alertes par e-mail

À chaque passage, s’il y a de nouvelles annonces dans vos catégories, Vigie ouvre un ticket (issue) étiqueté `veille` sur le dépôt. GitHub vous l’envoie par e-mail si vous suivez le dépôt (bouton **Watch** > *All Activity*, ou *Custom* > *Issues*). Les alertes se désactivent dans **Réglages**.

## Lancer Vigie sur votre PC

Prérequis : [Node.js](https://nodejs.org) 20 ou plus récent.

```bash
git clone https://github.com/gharel/scraping.git vigie
cd vigie
npm install
npm start
```

L’interface s’ouvre sur <http://localhost:4700>. En local, vous pouvez **tester une source** avant de l’ajouter, et les modifications sont enregistrées directement dans `config/veille.json` (à pousser sur GitHub pour les partager avec la version en ligne). Les données locales sont rangées dans `local-data/`, séparées des données publiées.

Sous Windows :

- `scripts\windows\demarrer-vigie.cmd` lance Vigie d’un double-clic ;
- `scripts\windows\installer-demarrage.ps1` le lance automatiquement à chaque ouverture de session (tâche planifiée « Vigie ») ;
- `scripts\windows\desinstaller-demarrage.ps1` retire ce démarrage automatique.

## Ajouter une source

| Type | Pour quoi | Ce qu’il faut fournir |
| --- | --- | --- |
| `atexo` | marchespublics.nc et les plateformes Atexo | L’adresse de la liste des consultations (recherche avancée) |
| `rss` | Flux RSS ou Atom | L’adresse du flux (souvent `/feed/`) |
| `page` | N’importe quelle page web | Mode `texte` (modifications) ou `liens` (nouveaux liens, PDF) ; zone CSS facultative |
| `liste` | Liste d’annonces sans flux | Sélecteurs CSS de l’annonce et de ses champs (`selecteur@attribut` pour lire un attribut) |

Exemple dans `config/veille.json` :

```json
{
  "id": "ma-source",
  "name": "Mon acheteur",
  "url": "https://exemple.nc/appels-d-offres/",
  "type": "page",
  "enabled": true,
  "categories": [],
  "options": { "detect": "liens", "selector": "main" }
}
```

Les pages construites entièrement en JavaScript ne sont pas lisibles : préférez alors leur flux RSS s’il existe.

## Catégories et mots-clés

- Les accents et les majuscules sont ignorés.
- Un mot-clé trouve le mot entier : « audit » ne trouve pas « auditorium ».
- Une étoile finale inclut les variantes : `format*` trouve formation, formateur, formations…
- Une source peut imposer des catégories à toutes ses annonces.

## Fonctionnement

```
GitHub Actions (toutes les 2 h)
  └─ npm run scrape     lit les sources, met à jour data/items.json et data/status.json
  └─ commit             seulement si les annonces ont changé
  └─ alerte             ticket GitHub si nouveautés dans vos catégories
  └─ npm run build      assemble _site/ (interface + données + configuration)
  └─ GitHub Pages       publie https://gharel.github.io/scraping/
```

| Dossier | Contenu |
| --- | --- |
| `config/veille.json` | Sources, catégories et réglages |
| `data/` | Annonces connues, état des sources, état des pages surveillées |
| `scraper/` | Moteur de veille (Node.js) : lecteurs Atexo, RSS, liste CSS, page web |
| `server/` | Serveur local (`npm start`) : interface, API et vérifications planifiées |
| `site/` | Interface web (HTML, CSS, JavaScript sans compilation) |
| `scripts/` | Publication du site, icônes, démarrage automatique sous Windows |
| `test/` | Tests automatisés (`npm test`) |

Commandes utiles :

```bash
npm test                            # tests
npm run scrape                      # une vérification complète (données dans data/)
npm run scrape -- --only cafat-marches
npm run build                       # prépare _site/ pour GitHub Pages
```

## Bon usage

Vigie consulte des pages publiques, à faible fréquence, avec une pause entre deux requêtes. Gardez des intervalles raisonnables et respectez les conditions d’utilisation des sites surveillés.
