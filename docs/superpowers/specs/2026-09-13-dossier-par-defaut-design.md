# Tranche 9 — un seul dossier par défaut, `C:\Neo Quiz`

**Date** : 2026-09-13
**Statut** : spec, sur quatre demandes d'Ahmed du jour (« un seul dossier où
stocker les quiz par défaut, le reste en bas », « le dossier Generated doit
toujours rester dans C:\Neo Quiz », « on déplace » pour le menu ⋯, « le nom
du modèle qui a généré le quiz et en quel effort »).
**Point de départ** : la tranche 8 livrée (`4d30404`).

## 1. Ce que ça change pour l'utilisateur

1. **Au premier lancement, il n'y a plus d'écran « Choisissez un dossier »** :
   l'application crée `C:\Neo Quiz` et s'ouvre dessus. Tout le monde n'a pas
   Obsidian ; on n'a rien à choisir pour commencer.
2. **`C:\Neo Quiz` est LE dossier de quiz** : « Nouveau quiz » y crée ses
   notes, et les quiz générés vont TOUJOURS dans `C:\Neo Quiz\Generated`, même
   quand la note jointe par « @ » vient d'un vault.
3. **Les autres emplacements** (vaults Obsidian détectés, dossiers ajoutés à
   la main) sont listés EN BAS de la page Réglages, sous le dossier par
   défaut, comme des emplacements supplémentaires. Ils se lisent, se
   révisent, s'éditent comme avant ; ils ne sont pas au même niveau.
4. **Le menu ⋯ d'un module** (un dossier de quiz dans « Mes quiz ») gagne
   « Déplacer vers… », qui propose les emplacements ouverts (le dossier par
   défaut, chaque vault). Le dossier et ses notes sont DÉPLACÉS pour de bon
   (ils quittent l'ancien emplacement), et l'historique de révision suit.
5. **La page d'un quiz généré** montre qui l'a généré : une troisième tuile
   dans la rangée des stats, le modèle en valeur (`claude-opus-5`,
   `gpt-5-codex`, `qwen3:8b`) et l'effort en libellé (`high`, `medium`…).

## 2. Les décisions

### 2.1 `C:\Neo Quiz` : fixe, créé par le principal, jamais retiré

- Le chemin est une constante du principal (`electron/dossier-defaut.ts`,
  `DOSSIER_DEFAUT = "C:/Neo Quiz"` ; sous Linux `~/Neo Quiz`, parce que `C:`
  n'existe pas et que l'AppImage doit démarrer). Créé par `mkdir -p` au
  démarrage, AVANT `perimetreInitial`, et autorisé au périmètre comme un
  dossier de quiz.
- Il est la racine `id: "Neo Quiz"` du contrat, toujours PREMIÈRE dans
  `roots()` : c'est ce qui fait que `roots[0]` (le repli actuel de
  `saveGeneratedQuiz`) tombe dessus. Il ne peut pas être retiré des Réglages
  (pas de croix), pas déplacé, pas renommé. `MAX_DOSSIERS` (10) compte les
  emplacements supplémentaires, lui en plus.
- Un utilisateur qui avait déjà des dossiers ouverts (Ahmed) les garde : ils
  passent en emplacements supplémentaires au premier lancement de cette
  version, sans migration de réglage (la liste `folders` reste la même, le
  défaut est simplement AJOUTÉ devant à la lecture).
- L'écran « aucun dossier » disparaît de l'application ; `mountSansDossier`
  et la liste des vaults au premier lancement deviennent une section des
  Réglages (« Emplacements supplémentaires », avec les vaults Obsidian
  détectés proposés en un clic, comme aujourd'hui).

### 2.2 `Generated` va toujours dans le dossier par défaut

`saveGeneratedQuiz` (`src/dashboard/ai.ts`) choisit aujourd'hui la racine de
la première note jointe par « @ », sinon `roots[0]`. La règle devient : **la
racine par défaut de l'hôte**, toujours. Le contrat gagne
`HostPaths.defaultRoot(): HostRoot` (sous Obsidian : la seule racine ; dans
l'app : `C:\Neo Quiz`). C'est le seul ajout au contrat de la tranche, et il
est trivial pour les deux hôtes et les trois faux hôtes des scripts.
`aiOutputFolder` (« Generated ») reste relatif à cette racine.

### 2.3 « Déplacer vers… » : un déplacement de dossier, pas une copie

- Le contrat gagne `HostFs.renameDir(from, to): Promise<void>` ? NON :
  `HostFs.rename` « renomme (ou déplace) un fichier » et le principal le fait
  par `fs.rename` de Node, qui déplace aussi un DOSSIER sur le même volume.
  Entre deux volumes (`C:` → `D:`), `fs.rename` échoue (`EXDEV`) : le
  principal retombe alors sur copie récursive puis suppression, dans
  `fichiers.ts`, éprouvé par `check:electron-fs` sur un dossier temporaire.
  Le contrat dit désormais explicitement que `rename` accepte un dossier ;
  l'hôte Obsidian le fait par `vault.rename` sur un `TFolder` (il sait déjà).
- Le module choisi est un DOSSIER du catalogue (`quiz-modules.ts`, un groupe
  par dossier). « Déplacer vers… » ouvre un sélecteur (`ui-select.ts`,
  `openActionMenu` ou un sous-menu) listant les racines ouvertes SAUF celle
  du dossier ; le dossier arrive à la racine de la cible, avec le même nom ;
  s'il existe déjà là-bas, Notice et rien ne bouge (le contrat de `rename`
  refuse d'écraser).
- **L'historique suit.** Aujourd'hui `review-store.ts` ignore un déplacement
  entre racines (« l'historique reste attaché à l'ancien dossier, ce qui est
  au moins vrai »). La tranche le complète : après le `rename`, le store
  REPORTE les lignes du journal source dont `q` commence par
  `<localFrom>/` vers le journal cible, réécrites avec `<localTo>/`, en
  ajout seul (le journal source garde ses lignes : le format est en ajout
  seul, et une ligne orpheline ne coûte rien). Fonction pure
  `transposerLignes(lignes, from, to)` dans `src/review/`, éprouvée par
  `check:review-store`. Déclenchée par l'action de menu, pas par le watcher
  (qui ne sait pas qu'il s'agit d'un déplacement voulu).
- Ce que ça ne fait pas : réécrire les wikilinks entrants (même limite que
  « Renommer », déjà refusée pour cette raison ; on le dit dans la Notice de
  confirmation : « Les liens Obsidian vers ces notes ne sont pas réécrits »).

### 2.4 Le modèle et l'effort : un frontmatter, lu par le scanner

- L'application (et le greffon, même code) écrit en tête de la note générée :

  ```
  ---
  neo-quiz:
    provider: claude-code
    model: claude-opus-5
    effort: high
    generatedAt: 2026-09-13T09:40:12Z
  ---
  ```

  Clés NON traduites (données persistées). `effort` absent pour Ollama (pas
  de notion d'effort) ; la tuile affiche alors le modèle seul.
- `scanner.ts` lit le frontmatter s'il existe (un `---` en première ligne,
  bloc YAML minimal : on n'embarque pas un parseur YAML, on lit les cinq
  clés par regex ligne à ligne, module pur `src/quiz-frontmatter.ts` éprouvé
  par `check:scanner`) et pose `QuizIndexEntry.generated?: { provider, model,
  effort?, generatedAt }`.
- `detail.ts`, `renderStats` : une tuile de plus quand `spec.stats?.generated`
  existe : valeur = `model`, libellé = `effort` ou, sans effort, le nom du
  fournisseur. Partagé : le greffon la montre aussi.
- Le bloc quiz lui-même ne change pas ; `check:quiz-io` (compare-and-swap
  sur le bloc) ignore le frontmatter comme il ignore le reste de la note.

### 2.5 Ce que la tranche ne fait pas

- Pas de déplacement d'une note seule (le menu d'un quiz garde Éditer et
  Supprimer).
- Pas de choix du dossier par défaut : il est fixe, c'est le point.
- Pas de fusion d'historiques si le dossier cible a déjà des lignes pour les
  mêmes chemins (impossible : `rename` refuse une cible existante).

## 3. Épreuves (Ahmed)

Premier lancement sur le bac à sable : `C:\Neo Quiz` créé, l'accueil s'ouvre
sans écran de choix ; Réglages : le défaut en haut sans croix, les vaults
détectés proposés en bas ; « Nouveau quiz » dans le défaut ; Générer avec une
note `@` d'un vault : le quiz est dans `C:\Neo Quiz\Generated`, sa page
montre la tuile modèle / effort ; « Déplacer vers… » un module d'un vault vers
le défaut : il apparaît là, disparaît du vault, sa progression (« À réviser »)
suit ; le déplacer en retour ; un module dont le nom existe déjà à la cible :
Notice, rien ne bouge.

## 4. Contraintes reprises

Aucune chaîne visible en dur ; commentaires en français avec le pourquoi ;
`check:host` reste à 6 ; le contrat s'élargit d'UN membre (`defaultRoot`) plus
une précision sur `rename` : les deux hôtes ET les trois faux hôtes des
scripts (`check-lesson.mjs`, `check-obsidian-host.mjs`,
`check-windows-host.mjs`) le reçoivent ; le journal reste en ajout seul.
