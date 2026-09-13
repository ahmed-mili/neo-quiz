# Tranche 8 — les épreuves à l'écran

À cocher par Ahmed, dans l'application en développement (`npm run app:dev`)
ou installée. Chaque ligne dit ce qu'on regarde et ce qui compte comme échec.

## A. La barre de titre (déjà retouchée en direct le 2026-09-13)

- [ ] Plus de barre native ni de menu « File Edit View Window » ; une barre
      de 45 px entièrement transparente, le fond d'écran passe derrière.
- [ ] Les trois contrôles à droite ont les glyphes de Neo Calendar (trait
      réduire, carré arrondi, croix) ; au survol le glyphe passe du gris au
      blanc, SANS fond. ÉCHEC : un fond sous la croix.
- [ ] Glisser la fenêtre par la surface vide ; double clic agrandit, second
      double clic restaure ; le bouton du milieu bascule carré / « copy ».
- [ ] Redimensionner par les huit bords et coins.
- [ ] Cliquer sur une autre fenêtre : les glyphes s'atténuent ; revenir : ils
      reviennent.
- [ ] La croix ferme la fenêtre, y compris juste après une frappe dans
      l'éditeur (la frappe est dans la note à la réouverture).

## B. Le menu d'application

- [ ] Le chevron ouvre « Neo Quiz / Édition / Affichage » ; survoler chaque
      entrée ouvre son sous-menu à droite ; Échap ferme tout ; clic dehors
      ferme ; cliquer sur une autre fenêtre ferme.
- [ ] « Neo Quiz > » : la version (ligne grise, pas cliquable), « Vérifier
      les mises à jour… » (ouvre les Réglages, la ligne d'état passe en
      « ignorée » en dev), « Réglages… » ouvre les Réglages ; `Ctrl+,` aussi.
- [ ] « Édition > » dans un champ de l'éditeur : Couper, Copier, Coller, Tout
      sélectionner agissent ; Annuler / Rétablir aussi.
- [ ] « Affichage > Échelle de l'interface » : 120 % agrandit tout, la coche
      suit ; fermer et relancer : toujours 120 % ; revenir à 100 %.
- [ ] `Ctrl+R` recharge ; `F11` plein écran et retour ; `Ctrl+Alt+I` ouvre
      les outils de développement.
- [ ] Clavier dans le menu : flèches Haut / Bas, Droite ouvre, Gauche ferme
      le niveau, Entrée active.

## C. Rouvrir là où on s'était arrêté

- [ ] Ouvrir un quiz, aller à la question 3, fermer par la croix, relancer :
      le même quiz, sur la question 3.
- [ ] Revenir à « Mes quiz », fermer, relancer : « Mes quiz ».
- [ ] Réglages > Général, décocher « Rouvrir là où on s'était arrêté »,
      fermer, relancer : l'accueil. Recocher.
- [ ] Ouvrir un quiz, fermer, supprimer sa note sur le disque, relancer :
      l'accueil, aucune erreur.

## D. Le fond d'écran

- [ ] Réglages > Fond d'écran > Choisir un dossier (avec des JPG / PNG) : la
      grille de vignettes se remplit, le fond change, la première est marquée.
- [ ] Cliquer une vignette : le fond change, la marque suit.
- [ ] « Fond suivant » : bouton des Réglages, entrée du menu Affichage, et
      `Ctrl+Shift+B` (hors champ de saisie) ; cyclique après la dernière.
- [ ] Fermer et relancer : le fond choisi est là.
- [ ] Supprimer l'image courante sur le disque, relancer : Notice « L'image
      du fond a disparu… », la première du dossier prend sa place.
- [ ] Vider le dossier (ou le renommer), relancer : Notice, fond embarqué.
- [ ] « Retirer » : fond embarqué, grille vide.
