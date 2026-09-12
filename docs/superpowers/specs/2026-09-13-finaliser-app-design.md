# Tranche 8 — finaliser l'application

**Date** : 2026-09-13
**Statut** : spec, écrite de nuit sur trois demandes d'Ahmed (la capture
« Le style de neo calendar à copier », et les deux idées « Rouvrir là où on
s'était arrêté » et « Un fond d'écran, comme le plugin Vault Background »
déplacées dans cette tranche à sa demande). Décisions prises par Claude,
chacune avec sa raison, à contester au réveil.
**Point de départ** : la tranche 7 (mise à jour automatique) livrée.

## 1. Les trois chantiers

1. **La barre de titre dans le style de Neo Calendar.** Plus de barre native
   ni de menu « File Edit View Window » : une seule ligne de 45 px en verre,
   posée par-dessus le fond d'écran, avec à gauche un chevron qui ouvre le
   menu d'application (« Neo Quiz > », « Édition > », « Affichage > »), à
   droite réduire / agrandir / fermer. La surface vide déplace la fenêtre,
   un double clic l'agrandit, les glyphes s'atténuent quand la fenêtre n'a
   pas le focus.
2. **Rouvrir là où on s'était arrêté.** Relancer l'application ramène au
   même quiz et à la même question, comme les onglets d'un navigateur. Un
   réglage l'active (défaut : activé).
3. **Un fond d'écran, comme Vault Background.** Un dossier d'images choisi
   dans les réglages, un sélecteur avec aperçu, une commande « fond
   suivant », et une image disparue signalée plutôt que laissée morte.

## 2. Les décisions

### 2.1 Barre de titre : `frame: false`, tout en HTML, pas d'overlay Windows

- `titleBarStyle: "hidden"` + `titleBarOverlay` laisserait Windows dessiner
  ses propres boutons (couleur unie, hauteur fixe de 32 px, pas d'atténuation
  au défocus) : ce n'est pas la capture. Neo Calendar dessine ses trois
  contrôles lui-même (`decorations: false` côté Tauri). Ici : `frame: false`,
  `Menu.setApplicationMenu(null)` (retire aussi les accélérateurs natifs :
  ceux du menu d'application les remplacent), et trois boutons HTML qui
  demandent au principal `reduire`, `agrandirOuRestaurer`, `fermer`.
- **Le glissement est natif** : `-webkit-app-region: drag` sur la barre et
  `no-drag` sur chaque bouton, entrée et menu. C'est ce qu'Electron fournit et
  c'est plus fiable que le `startDragging` de Tauri (pas de course à la
  première frame). Le double clic sur la surface vide agrandit : Electron ne le
  fait pas seul sur une région `drag`, c'est un écouteur `dblclick` sur la
  barre qui appelle `agrandirOuRestaurer`.
- **Le redimensionnement** : `frame: false` garde les bords redimensionnables
  sous Windows (`thickFrame` par défaut). Rien à faire. À vérifier à l'écran
  (épreuve) : les huit bords et coins.
- **L'état « agrandie » et le focus** sont poussés par le principal
  (`maximize`, `unmaximize`, `focus`, `blur` de `BrowserWindow`) sur un canal
  `fenetreEtat` : le rendu bascule l'icône agrandir/restaurer et pose
  `data-focused` sur la coquille. Le rendu ne les devine jamais depuis
  `window.innerWidth`.
- **La disposition** : la barre est absolue, en haut, sur toute la largeur ;
  le contenu (`#neo-quiz-root`) reçoit `padding-top: 45px`. Le rail du
  tableau de bord commence donc SOUS la barre, et la partie gauche de la barre
  (largeur du rail, 220 px) prend la teinte du rail comme dans Neo Calendar
  (dégradé à deux teintes). Le bloc « brand » du rail (logo, nom) reste où il
  est : la barre ne porte aucun titre, c'est le style de la référence.
- **Le menu d'application** reprend `DesktopAppMenu` sans React : un arbre
  déclaratif (`buildMenu()` relu à chaque ouverture pour suivre la langue),
  une cascade de panneaux positionnés en `fixed` et portalés au `<body>`
  (comme `ui-select.ts`), survol qui ouvre le sous-menu, clavier (flèches,
  Entrée, Échap), fermeture au clic dehors et à la perte de focus de la
  fenêtre. Contenu :
  - **Neo Quiz** : la version (ligne inerte, `manifest.version`), « Vérifier
    les mises à jour… » (`pont().miseAJour.verifier()` puis navigation vers
    Réglages pour voir l'état), « Réglages… » `Ctrl+,`.
  - **Édition** : Annuler `Ctrl+Z`, Rétablir `Ctrl+Y`, séparateur, Couper
    `Ctrl+X`, Copier `Ctrl+C`, Coller `Ctrl+V`, Tout sélectionner `Ctrl+A`.
    Ces six actions passent par `webContents` du principal (`undo`, `redo`,
    `cut`, `copy`, `paste`, `selectAll`) sur un canal `edition`, parce que
    `document.execCommand` est déprécié et que le presse-papiers sandboxé ne
    colle pas sans geste utilisateur. Pas de « Coller sans mise en forme »,
    « Supprimer », « Dupliquer » : ce sont des actions de calendrier.
  - **Affichage** : « Échelle de l'interface » (sous-menu 80 % à 150 % par
    pas de 10, coche sur le courant ; `webContents.setZoomFactor`, persistée
    dans les réglages sous `zoom`), séparateur, « Recharger » `Ctrl+R`,
    « Plein écran » `F11`, « Outils de développement » `Ctrl+Alt+I`. Pas
    d'« espacement des heures » : calendrier.
- **Les raccourcis** sont posés par le rendu (`keydown` sur `document`, hors
  champs de saisie pour `Ctrl+,` et `F11` ; les raccourcis d'édition sont
  natifs dans les champs et n'ont pas besoin d'être interceptés) et affichés
  dans le menu comme libellés. Pas de `globalShortcut` : il capturerait les
  touches hors de l'application.
- **Réglages** vit dans le menu ET reste dans le pied du rail : Neo Calendar
  a une roue dentée dans la barre en plus du menu ; ici le rail l'a déjà, on
  ne le duplique pas dans la barre.

### 2.2 Rouvrir là où on s'était arrêté : l'endroit, pas le contenu

- Persisté par le rendu dans les réglages sous `derniereVue` :
  `{ vue: DashboardViewName, quiz?: string (chemin du contrat), question?:
  number }`, écrit à chaque navigation et à chaque changement de question
  (débouncé à 500 ms, comme les réglages de pages). Au lancement, si le
  réglage `reprendre` (défaut `true`) est vrai et que la note existe encore
  dans le catalogue, l'application rouvre cette vue ; sinon l'accueil, sans
  message (une note supprimée n'est pas une erreur).
- La question courante : `activeIdx` de `src/dashboard/detail.ts` bouge dans
  `goToQuestion` et nulle part ailleurs. La page reçoit une nouvelle entrée
  facultative de sa `QuizPageSpec` : `initialQuestion?: number` (appliquée
  au premier rendu de la clé, bornée) et `onQuestionChange?(index: number)`
  (appelée par `goToQuestion`). Deux membres optionnels : le greffon ne les
  passe pas et ne change pas. C'est le seul point du code partagé que la
  tranche touche.
- Ce n'est PAS la garantie de la tâche 10 (la dernière frappe n'est pas
  perdue) : celle-ci porte sur l'endroit, pas sur le contenu.

### 2.3 Fond d'écran : à côté des réglages de l'application, par machine

- Le réglage `fond` : `{ dossier: string (absolu), image: string (nom de
  fichier) }`. Le DOSSIER est choisi par le sélecteur natif (`choisirDossier`,
  déjà borné) et entre dans le périmètre comme un dossier de quiz : c'est la
  seule façon de le servir par `app:` sans ouvrir le disque. Le fond vit
  dans les réglages de l'application (par machine), pas à côté des quiz : un
  vault partagé entre deux postes n'a pas à imposer son paysage, et le fond
  n'est pas un contenu.
- Formats : `jpg`, `jpeg`, `png`, `webp`, `avif`, `gif` (liste dans un module
  pur, éprouvée).
- La page Réglages gagne une section « Fond d'écran » : le dossier (bouton
  choisir, chemin, retirer), une grille de vignettes (`app:` URL, 96 px,
  bordure sur la courante), et « Fond suivant » (aussi dans le menu Affichage
  et par `Ctrl+Shift+B`). Le fond courant est posé par le rendu comme
  `background-image` inline sur `body` par-dessus la règle CSS actuelle ; sans
  réglage, le `wallpaper.jpg` embarqué reste.
- **Une image disparue** : au lancement et à chaque « suivant », le rendu
  liste le dossier (`listerDossier`) ; si l'image persistée n'y est plus, il
  passe à la première du dossier et affiche une Notice (« L'image du fond a
  disparu, la première du dossier est utilisée ») ; si le dossier est vide ou
  absent, retour au fond embarqué et Notice. Jamais un fond mort en silence.

### 2.4 Ce que la tranche ne fait pas

- Pas de thème clair (la spec de l'app n'a que le sombre).
- Pas de barre de recherche ni de bouton « créer » dans la barre (la
  capture de Neo Calendar en a ; Neo Quiz a « Mes quiz » et « Nouveau quiz »
  dans les pages).
- Pas de restauration de la position ni de la taille de fenêtre : c'est
  une autre idée, et Electron ne la fournit pas seul.

## 3. Les épreuves (Ahmed)

`docs/superpowers/notes/2026-09-13-tranche-8-epreuves-ecran.md` : la barre
(glisser, double clic, les trois boutons, redimensionner par les huit bords,
défocus qui atténue), le menu (chaque entrée, chaque raccourci, Échap, clic
dehors, la version affichée), rouvrir (fermer sur la question 3 d'un quiz,
relancer, y être ; couper le réglage, relancer, accueil), le fond (choisir un
dossier, la grille, suivant, supprimer l'image courante sur le disque, relancer,
la Notice).

## 4. Contraintes reprises

Aucune chaîne visible en dur ; commentaires en français avec le pourquoi ;
`check:host` reste à 6 ; le rendu n'importe rien qui tire Node ; aucun chemin
venu du rendu n'atteint le disque hors périmètre (le dossier du fond y entre
par `choisirDossier`, et `listerDossier` est déjà borné) ; les deux membres
neufs de `QuizPageSpec` sont optionnels et le greffon compile sans les voir.
