# Tranche 9 — les épreuves à l'écran

À cocher par Ahmed, en développement (`npm run app:dev`) ou installé.

## A. Le dossier par défaut

- [ ] Premier lancement (bac à sable ou `%APPDATA%\Neo Quiz` vidé) : aucun
      écran « Choisissez un dossier », `C:\Neo Quiz` est créé, l'accueil est
      vide mais normal.
- [ ] Réglages : « Dossier de quiz » = `C:\Neo Quiz` en haut, SANS croix ;
      « Emplacements supplémentaires » en dessous avec les vaults Obsidian
      détectés proposés en un clic, et « Ajouter un dossier ».
- [ ] Sur le poste d'Ahmed : les deux vaults déjà ouverts sont dans
      « Emplacements supplémentaires », rien n'a été perdu.
- [ ] « Nouveau quiz » (Mes quiz) crée la note dans `C:\Neo Quiz`.

## B. `Generated` dans le défaut

- [ ] Générer avec une note `@` d'un vault : le quiz est écrit dans
      `C:\Neo Quiz\Generated\`, pas dans le vault ; sa page s'ouvre.
- [ ] Pendant la génération, l'étincelle « Générer » du rail respire et
      tourne, y compris depuis une autre page ; elle s'arrête à la fin, à
      l'annulation, et au changement de vue.

## C. Le modèle et l'effort

- [ ] La page du quiz généré (Claude, effort `high`) montre une troisième
      tuile : `claude-opus-5` / `HIGH` ; l'infobulle dit « Généré par… ».
- [ ] Un quiz généré par Ollama : le modèle / `OLLAMA`.
- [ ] Un quiz écrit à la main : pas de tuile. Dans Obsidian, la même tuile
      sur le quiz généré (le greffon lit le même frontmatter).
- [ ] La note commence par `---` / `neo-quiz:` ; l'éditer dans la page ne
      casse pas le frontmatter (le bloc seul est réécrit).

## D. Déplacer un module

- [ ] Mes quiz, ⋯ d'un module d'un vault : « Déplacer vers… » propose
      `Neo Quiz` (et les autres vaults), pas le vault courant ; confirmation.
- [ ] Après confirmation : le module apparaît dans `C:\Neo Quiz\<nom>`,
      disparaît du vault ; ses quiz sont dans « Mes quiz » ; « À réviser »
      compte toujours ses questions dues ; `C:\Neo Quiz\.neo-quiz\
      review-log.jsonl` contient les lignes transposées.
- [ ] Le remettre dans le vault : idem en sens inverse.
- [ ] Un module dont le nom existe déjà à la cible : Notice « existe déjà »,
      rien ne bouge.
- [ ] Sans emplacement supplémentaire ouvert (seul le défaut) : pas d'entrée
      « Déplacer vers… ».
