# Passation tranche 2 → tranche 3

**Date** : 2026-09-05
**Pour qui** : l'agent qui écrira et exécutera le plan de la tranche 3, dans
une autre session, sans accès à celle-ci. Ce document est tout ce qu'il aura
en plus du dépôt lui-même — il ne recopie pas les rapports de tâche
(`.superpowers/sdd/2026-09-05-app-windows-tranche-2/task-*-report.md`), mais
il en synthétise ce qui compte pour la suite.

---

## Ce que la tranche 2 a livré

Commits `588aa27`..`d70d95c` (19 commits ; `588aa27`, le plan lui-même, est
exclu de la plage).

- Le journal de révision vit désormais à `<racine>/.neo-quiz/review-log.jsonl`
  sous les deux hôtes (vault Obsidian ou dossier nu), avec migration
  automatique de l'ancien emplacement et l'ancien fichier conservé intact.
- L'app Windows ouvre jusqu'à dix dossiers de quiz, chacun avec son propre
  journal, réunis en un catalogue et un plan du jour uniques.
- L'ordonnanceur tourne côté app : la carte « À réviser » ferme la boucle
  moteur → journal → ordonnanceur → écran, avec une date d'examen par module.
- Les renommages (note ou dossier) faits hors de l'app sont appariés sur une
  preuve (signature des identifiants de question), jamais sur une
  ressemblance de chemin.
- Le cliquet de frontière d'hôte descend de 42 à 41 : `review-store.ts`
  quitte `dashboard/` pour `src/review/` — voir plus bas, ce n'est pas un
  détail cosmétique.

---

## Ce que l'exécution a appris, et qui change la tranche 3

La section « Ce que la tranche 2 laisse ouvert » du plan
(`docs/superpowers/plans/2026-09-05-app-windows-tranche-2.md`, fin de
fichier) a été écrite AVANT l'exécution. Elle reste vraie sur presque tout
point ; voici ce qu'il faut corriger ou préciser, vérifié dans le code
réel plutôt que supposé :

- **`review-store.ts` n'est plus jetable, et `src/review/` survivra au
  chantier 4.** Ce n'était pas garanti avant exécution (la spec de
  l'ordonnanceur le rangeait dans `dashboard/`, « le dossier que le chantier 4
  supprime ») ; le plan a renversé ce choix à l'écriture (décision D6), et
  l'exécution l'a confirmé : `src/review/` contient aujourd'hui `log-file.ts`,
  `migration.ts`, `paths.ts`, `rename-match.ts`, `review-store.ts`, et plus
  rien de ce nom n'existe sous `dashboard/`. **La tranche 3 ne doit pas
  déplacer ce dossier ni le fusionner avec quoi que ce soit qui vivra sous
  `dashboard/`** — le chantier 4 (réduire le greffon) devra le contourner, pas
  le prendre avec lui.
- **Le cliquet est à 41**, vérifié (`npm run check:host`). Le détail par zone
  a légèrement changé de ce que la clôture du plan annonçait : ce n'est pas
  « cinq modules du greffon » mais **trois** (`src/hotkey-format.ts`,
  `src/modal-base.ts`, `src/quiz-source-ref.ts`) ; le reste se répartit en 32
  fichiers de tableau de bord (dont `src/dashboard.ts` et
  `src/types/dashboard-ctx.ts`) et 6 fichiers d'éditeur. Beaucoup de fichiers
  de `dashboard/` sont DÉJÀ libres d'Obsidian avant même cette tranche
  (`scanner.ts`, `zip.ts`, `effort-canvas.ts`, `quiz-mastery.ts`,
  `quiz-modules.ts`, `quiz-recent.ts`, `color-picker.ts`, `detail-slide.ts`,
  `icon-suggest.ts`, `module-color.ts`, `view-enter.ts`) — ne pas supposer que
  « tout le tableau de bord » reste à faire.
- **La clé de journal reste locale (`<chemin local>::<id>`), et
  `apps/windows/src/host/roots.ts` en est le SEUL gardien** : les fonctions
  `local()` (retire le préfixe de racine) et `contrat()` (le remet), lignes
  ~81-92 de ce fichier, sont l'unique endroit qui convertit entre chemin du
  contrat et clé de journal. Toute tâche de la tranche 3 qui touche à la
  résolution de chemin doit passer par ces deux fonctions — jamais recomposer
  un chemin local à la main, c'est exactement le défaut qui a coûté la
  régression critique de résolution de liens de la tâche 6 (défauts 4 et 5,
  voir « Un avertissement sur le plan lui-même » plus bas).
- **Le mineur différé de la tâche 8 sur `setExamDate` (« une date effacée est
  retirée, pas gardée vide ») a été RÉSOLU en tâche 10**, pas laissé ouvert :
  extrait en fonction pure `appliquerExamDate`, couvert par 3 cas neufs. Ne
  pas le reporter à la tranche 3, c'est fait.
- **Les limites d'API (opus ET sonnet, tour à tour) ont interrompu deux
  implémenteurs et une revue** pendant cette tranche. La tranche 3, si elle
  suit le même mode d'exécution (contrôleur + subagents dispatchés), doit
  s'y attendre et prévoir un modèle de repli — voir Ruling 9 ci-dessous pour
  la réponse qui a marché ici.
- **Ce qui n'a PAS changé, toujours vrai** : `statsSink` reste débranché côté
  app (confirmé : `apps/windows/src/ui/quiz-page.ts` le documente en
  commentaire — les cartes de quiz n'ont ni `--fresh` ni `--progress` ni
  `--mastered`, c'est un système différent du journal et il viendra avec la
  page de détail) ; le module d'un quiz reste le dossier parent côté app
  contre la note « Dashboard » côté greffon ; un déplacement entre racines
  perd l'historique (deux journaux, fusionner romprait l'ajout seul) ; le
  journal n'est pas compacté ; les deux limites du scanner
  (`report:multiblock`) sont inchangées ; le thème clair et l'empaquetage
  signé restent hors périmètre.
- **Deux fichiers d'hôte ont grossi encore pendant cette tranche**, et la
  tranche 3 (qui ÉCRIT des blocs, donc touche la couche fs) va probablement
  les rouvrir : `apps/obsidian/host.ts` est à 457 lignes, `apps/windows/src/
  host/fs.ts` à 466 (cible ~350 pour les deux). Ce n'est pas bloquant, mais
  un bon moment pour envisager un découpage plutôt que d'ajouter une
  cinquième responsabilité au même fichier.

---

## Les décisions du contrôleur (rulings)

Douze rulings sont numérotés dans le journal d'exécution (`progress.md`) : le
`Ruling (setup)` et les Rulings 1 à 11 (le dernier, sur cette tâche 12 même,
n'existait pas encore à l'écriture de la première version de cette note).
S'y ajoute une décision non numérotée (tâche 7, `quizCount`) — treize
décisions au total ci-dessous.

Six n'engagent que l'exécution (choix de modèle, réaction à une panne d'API,
absence de re-revue), résumées en un paragraphe : le worktree isolé demandé
par le skill a été refusé, contrainte du dépôt (`Ruling` de mise en place) ;
les épreuves à l'écran de la tâche 1 ont été reportées à cette note plutôt
que faites par un subagent, aucun n'ayant d'affichage (`Ruling 1`), règle
étendue explicitement à toutes les tâches suivantes du plan (`Ruling 4`) ; un
tour sans diff n'a pas reçu de re-revue scopée, rien n'y ayant changé
(`Ruling 7`) ; après une panne d'API sur un implémenteur, le modèle par
défaut est descendu à sonnet partout sauf la revue finale, réservée à opus
(`Ruling 9`) ; après une seconde panne touchant opus ET sonnet, la leçon
retenue est de chercher, après toute interruption en cours d'épreuve de
discriminance, TOUT le diff non commité — pas seulement la garde nommée dans
le dernier message — pour des marqueurs « temporaire », « discriminance »,
« debug » ou des valeurs en dur court-circuitant un calcul, qu'une
perturbation de test oubliée serait sinon commitée et passerait pour du code
voulu (`Ruling 8`).

Sept engagent le CODE ou la DOCUMENTATION que la tranche 3 va lire, et sont
détaillées :

1. **Ruling 2, tâche 3, brief non suivi** : « Modifier `src/review/paths.ts` »
   était un reliquat du brief — la tâche 3 ne fait que le LIRE (créé en
   tâche 2). Coût si cette lecture est fausse : un fichier touché sans raison
   qu'une revue de tâche aurait de toute façon attrapé — sans conséquence
   réelle, mentionné pour mémoire de méthode plus que pour son contenu.
2. **Ruling 3, tâches 2 et 3, portée des faux hôtes de test** :
   `check-scanner.mjs` et `check-math-render.mjs` fabriquent des hôtes
   PARTIELS en JS non typé ; l'ajout d'`onRenameDir` au contrat ne les casse
   pas, donc ils n'ont pas été complétés. **Coût si la tranche 3 leur fait
   appeler une méthode manquante** : le script mourra sur un `TypeError` au
   lieu d'échouer proprement — compléter le faux hôte AVANT d'ajouter
   l'appel, pas après avoir vu l'échec.
3. **Ruling 5, tâche 2, correction incluse dans le tour de correction** : un
   commentaire de `paths.resultsDir` devenu faux à cause de cette même tâche
   a été corrigé dans le même tour, alors que la règle générale est de
   différer les mineurs. Raison : l'inexactitude était INTRODUITE par la
   tâche, dans un fichier qu'elle rouvrait, et le coût était d'une ligne.
   Retenir le principe : une inexactitude qu'on vient soi-même de créer entre
   dans la correction, un défaut préexistant qu'on découvre en passant n'y
   entre pas.
4. **Ruling 6, tâche 3, concurrence de la migration** : la migration est
   idempotente EN SÉQUENCE, pas en concurrence — deux hôtes qui migrent la
   même seconde écrivent deux fois les mêmes lignes. Aucun verrou n'a été
   ajouté (nouveau mode de panne pour un cas rare) ; à la place,
   `createLogFile.load()` dédoublonne les lignes identiques au chargement,
   sur la même clé que l'absorption Syncthing. **Coût si cette décision est
   fausse** : deux révisions réellement identiques à la milliseconde près
   seraient fondues en une — jugé impossible en pratique. **Pour la
   tranche 3** : si l'éditeur de l'app introduit une autre écriture
   concurrente sur le même journal, ce dédoublonnage au chargement est le
   filet existant à réutiliser, pas un nouveau verrou à inventer.
5. **Ruling 10, tâche 10, corrigé plutôt que différé** : le contrôleur a fait
   CORRIGER l'absence de `color-scheme: dark` au lieu de la différer, alors
   que la revue de tâche jugeait le report défendable. Raison : le correctif
   tient en une ligne, le risque est réel et non théorique (l'icône du
   sélecteur de date devient invisible sur fond sombre), et il n'est
   constatable qu'à l'écran — le différer aurait fait dépendre une ligne de
   CSS d'un aller-retour avec Ahmed. Portée élargie à la racine du document
   plutôt qu'au seul champ, parce que la spec §8 ne prévoit que le thème
   sombre pour l'app : tout futur contrôle natif en hérite. **Coût si cette
   décision est fausse** : une déclaration à retirer le jour où un thème
   clair arrive — coût nul aujourd'hui.
6. **Ruling 11, tâche 12, une cible du brief était fausse** : le brief de
   cette tâche 12 imposait de garder `CLAUDE.md` sous 200 lignes, en invoquant
   une section « Hygiène » du fichier qui l'autoriserait à tailler ailleurs.
   Vérifié : cette cible et cette section n'existent que dans le CLAUDE.md
   GLOBAL (`~/.claude/CLAUDE.md`) ; celui du projet n'en a jamais eu, et
   était déjà à 295 lignes avant cette tâche. **Coût si cette décision (ne
   pas tailler) est fausse** : un `CLAUDE.md` projet plus long que souhaité,
   qu'une revue future taillera. **Directement utile à la tranche 3**, qui
   retouchera probablement `CLAUDE.md` : sans ce ruling, le prochain agent
   croirait devoir le faire tenir sous 200 lignes.
7. **Décision non numérotée, tâche 7, `review.settings.quizCount`** : la clé
   i18n est orpheline (posée d'avance par le plan, avant que rien ne
   l'appelle). Décision : la GARDER quand même à la tâche 7 (le type force sa
   présence dans les deux dictionnaires, une tâche suivante pouvait la
   consommer) ; la tâche 11 a ensuite confirmé qu'elle n'a AUCUN appelant
   dans tout le dépôt. **Tranchée à la vague de correction finale** : balayée
   contre les 749 clés des six domaines, elle en restait l'unique orpheline —
   retirée des deux dictionnaires (`en`/`fr`).

---

## Les 26 constats mineurs différés, groupés par thème

Source : `.superpowers/sdd/2026-09-05-app-windows-tranche-2/mineurs-differes.txt`
(liste brute) ; regroupés ici par zone de code, avec un avis sur l'urgence
pour la tranche 3 (qui touche `src/editor/`, l'écriture des blocs, la
création et la suppression de quiz — donc surtout la couche fs des deux
hôtes, et un peu moins le journal lui-même).

**Journal et migration (`src/review/*.ts`) — 7 constats. À surveiller si la
tranche 3 touche l'écriture, sinon peuvent attendre :**
- `absorbed` rend 0 quand la relecture échoue après un append réussi : le
  journal de démarrage dira « 0 absorbée » alors que les lignes sont sur le
  disque (`migration.ts`).
- La clé de dédoublonnage est la re-sérialisation canonique : un champ
  inconnu (un `role` non reconnu) est retiré de la ligne réécrite ; l'ancien
  survit sous `.migrated`, rien n'est irrécupérable (`migration.ts`).
- Aucun diagnostic sur le chemin d'échec du renommage pendant la migration
  (catch sans liaison, `MigrationResult` sans champ de cause) — toujours
  ouvert, vérifié : aucun champ `cause` n'existe dans `MigrationResult`
  (`migration.ts`).
- `plan()` reconstruit tout le journal par `{...l}` à chaque appel, y compris
  sous Obsidian où les deux conversions sont l'identité — surcoût mesurable
  seulement si `plan()` est appelé plus souvent (`review-store.ts`).
- `dossierJournal` (log-file) et `dossierDe` (migration) traitent différemment
  un chemin sans « / » — cas de bord (fichier à la racine) à surveiller si la
  tranche 3 permet de créer un quiz directement à la racine d'un dossier.
- `mkdirs` appelé à chaque flush (toutes les 500 ms en session), un `exists`
  par segment sous Obsidian — performance, pas correction (`log-file.ts`).
- `estConflit` garde `"review-log.sync-conflict-"` en dur alors que
  `REVIEW_LOG_NAME` existe désormais — cosmétique (`log-file.ts`).

**Permissions Tauri (`apps/windows/src-tauri/capabilities/default.json`) — 1
constat, tranché à la vague de correction finale :**
- `fs:allow-unwatch` était inerte : la commande n'est dans le
  `generate_handler!` d'aucun plugin (vérifié contre `tauri-plugin-fs`
  2.5.2), le JS ferme un abonnement par `plugin:resources|close`. La
  permission venait du brief de la tâche 1, jamais exercée par le code —
  **retirée**. Les six autres permissions du fichier sont toutes réellement
  appelées.

**Hôte Windows, dossiers composites (`apps/windows/src/host/*.ts`) — 6
constats. Pertinents pour la tranche 3, qui va réécrire dans ces fichiers :**
- `hostRoots()` reconstruit tout à chaque appel alors que `rootOf` l'appelle à
  chaque conversion de clé — surcoût qui grandira avec plus d'écritures
  (`roots.ts`).
- Un quiz à la racine d'un dossier affiche l'identifiant de racine comme
  « dossier parent » — cosmétique, visible si la tranche 3 affiche ce libellé
  ailleurs (`roots.ts` / affichage des modules).
- Message d'erreur développeur en français qui peut remonter à l'écran via
  `t("app.error.startup")` — à vérifier si la tranche 3 déclenche ce chemin
  d'erreur plus souvent.
- `apps/windows/src/host/fs.ts` à 466 lignes désormais (cible ~350) — la
  tranche 3 y ajoutera l'écriture de blocs : bon moment pour scinder plutôt
  que d'ajouter une fonction de plus.
- La garde `exists(to)` de `rename` rejette aussi un renommage de CASSE seule
  (`Foo.md` → `foo.md`) sur un système insensible à la casse. Hérité du
  patron Windows, sans effet sur la migration ; à corriger seulement si un
  usage l'expose.
- `let creerCarteRacines` est partagé entre les groupes du script de test —
  si le premier groupe jette, les suivants meurent sur `TypeError` :
  fragilité du script de contrôle, pas du produit.

**Hôte Obsidian, réglages (`apps/obsidian/host.ts`,
`apps/windows/src/host/folder.ts`) — 3 constats. Peuvent attendre :**
- `list` d'Obsidian avale toute erreur, pas seulement l'absence de fichier :
  une erreur de droits d'accès se lit comme « aucun conflit ». Prescrit par le
  brief lui-même, pas une régression introduite.
- `apps/obsidian/host.ts` à 457 lignes (cible ~350) — même remarque que
  `fs.ts` côté Windows, moins urgente si la tranche 3 touche surtout
  `apps/windows/`.
- `store.get(CLE_DOSSIER_LEGACY)` appelé deux fois dans `savedFolders()` —
  redondance sans effet (`folder.ts`).

**Scripts de contrôle (faux hôtes JS non typés) — 3 constats. Uniquement
pertinents si la tranche 3 fait grandir le contrat d'hôte :**
- `scripts/check-obsidian-host.mjs` garde une graine morte (`existants`
  jamais réassigné).
- Le faux hôte de `scripts/check-lesson.mjs` n'a ni `fs.append/list/remove/
  rename` ni `watcher.onRenameDir` — la première tâche qui fait toucher ces
  méthodes par le moteur de leçon tuera le script (peu probable en tranche 3,
  qui touche l'éditeur, pas la leçon — mais à vérifier si un chemin partagé
  existe).
- `check-scanner.mjs` et `check-math-render.mjs` : mêmes hôtes partiels
  (ruling 3 ci-dessus).

**Bootstrap et cycle de vie (`main.ts` des deux hôtes) — 2 constats. Faible
priorité :**
- Le désabonnement rendu par `scanner.onChange` est ignoré dans `main.ts` —
  correct tant que `demarrer()` ne tourne qu'une fois ; à revoir si la
  tranche 3 introduit un redémarrage à chaud du catalogue.
- L'ordre migrer-puis-charger de `creerJournalApp` est correct à la lecture
  mais sans preuve mécanique — un test qui fige cet ordre serait bienvenu si
  la tranche 3 retouche le bootstrap.

**CSS et affichage (tableau de bord, app) — 3 constats. Basse priorité, sauf
le premier qui a déjà sa réponse dans la note d'épreuves à l'écran (point
9) :**
- `<h3 class="qbd-quizzes-node-label">` est nu, sans `margin` fixé (usage
  d'origine : un `<span>`) — écart visuel à trancher à l'écran, pas en lisant
  le CSS.
- La couleur de marque `#7c3aed` en dur à deux endroits de `shell.css`
  (tâche 7) plutôt qu'une variable locale — différé, sans risque
  fonctionnel, juste une dette de cohérence.
- `review.settings.quizCount` orpheline — retirée à la vague de correction
  finale, voir « Les décisions du contrôleur » plus haut (tâche 7).

**Divers, un seul constat sans conséquence identifiée :**
- La garde `exists(to)` insensible à la casse (déjà listé sous « Hôte
  Windows » ci-dessus).

---

## Un avertissement sur le plan lui-même

Le code que le plan de la tranche 2 dictait « verbatim » s'est révélé fautif
**neuf fois sur douze tâches** — la tâche 6 en a produit DEUX distincts, à ne
pas fondre en un seul comme la première version de cette note le faisait :

1. **Tâche 3** — un bug réel dans la migration : la relecture de confirmation
   LEVAIT une exception au lieu de dégrader proprement en
   `confirmed: false`.
2. **Tâche 3** — une ligne du TABLEAU de discriminance du plan était fausse
   (le cas 7 garde l'efficacité du renommage, il n'est pas vert quoi qu'on
   fasse — ce n'est pas le jeu de cas qui avait tort, c'est l'annonce de
   quelle assertion il devait faire rougir).
3. **Tâche 4** — deux cas de test ÉCRITS DANS LE PLAN n'étaient pas
   discriminants (« le plan voit la clé préfixée », « un déplacement entre
   racines n'écrit pas de renommage ») : ils restaient verts que la règle
   soit respectée ou non.
4. **Tâche 6** — le cas de bornage donné VERBATIM par le plan restait vert
   sans le filtre qu'il prétendait garder (le « QUATRIÈME défaut » du
   journal d'exécution) : trouvé par l'implémenteur, qui en a ajouté un qui
   rougit réellement.
5. **Tâche 6** — une régression CRITIQUE de résolution de liens, distincte du
   défaut 4 et trouvée en REVUE en chargeant le code réel (pas en le
   lisant) : confirmée venir du même snippet `links.ts` donné verbatim par le
   plan. Les chemins de l'index portaient le préfixe de racine, mais pas les
   liens écrits dans les notes — l'égalité exacte tombait donc TOUJOURS, et
   une image citée depuis un sous-dossier aurait servi le mauvais fichier,
   en silence. Le cas qui aurait dû l'attraper avait été réécrit pour
   s'aligner sur le code fautif plutôt que sur la règle.
6. **Tâche 7** — une variable CSS donnée comme « déjà définie » par le
   brief (`--size-4-2`) n'existe nulle part dans le dépôt.
7. **Tâche 9** — une clé de signature non injective (`ids.join(" ")`) :
   `["ip","masque"]` et `["ip masque"]` collisionnent, ce qui aurait pu
   transporter l'historique d'une note vers une autre sans que rien ne le
   signale.
8. **Tâche 10** — un cast `as HTMLInputElement` redondant.
9. **Tâche 11** — une classe CSS de titre de PAGE (`qbd-quizzes-title`, 28px
   serif) employée pour un titre de SECTION : un second titre géant se
   serait empilé sous « Mes quiz ».

Ce compte de neuf ne porte que sur le plan des douze tâches
(`docs/superpowers/plans/2026-09-05-app-windows-tranche-2.md`). Le BRIEF de
cette tâche 12 elle-même portait un défaut du même genre — voir Ruling 11
plus haut : une cible de 200 lignes pour `CLAUDE.md` présentée comme réelle
alors qu'elle ne l'était pas. Un plan reste un argument, pas une autorité,
même pour la tâche qui referme le chantier.

**Un plan est un argument, pas une autorité.** Les épreuves de discriminance
(casser la règle qu'un cas est censé garder, voir l'assertion rougir,
restaurer) ont directement attrapé deux de ces neuf défauts (3 et 4, les cas
non discriminants des tâches 4 et 6) ; les sept autres ont été trouvés par
une lecture attentive, par l'usage direct du code fourni, ou par une revue
qui a chargé le code réel plutôt que de le survoler — notamment le défaut 5,
la régression de liens de la tâche 6, repérée en exécutant un scénario
concret plutôt qu'en lisant le diff. La tranche 3 touchera l'écriture de
fichiers — la partie la plus irréversible du produit après le journal — et
devrait appliquer la même méfiance à tout extrait de code que son propre
plan proposera verbatim.

---

## Ce que la tranche 3 devra trancher en premier

D'après la spec §7 (`docs/superpowers/specs/2026-09-04-app-windows-design.md`,
section « Tranche 3 — L'app édite ») : **la page de quiz en mode édition,
l'écriture des blocs, la création et la suppression de quiz.** Livrable :
« plus besoin d'Obsidian pour modifier un quiz. »

Trois points d'appui pour écrire ce plan :

- **`src/editor/` compte encore 6 fichiers liés à Obsidian** dans le cliquet
  (`src/editor.ts`, `src/editor/editor-form.ts`, `src/editor/modals.ts`,
  `src/editor/question-preview.ts`, `src/editor/utils.ts`,
  `src/types/editor-ctx.ts`) — c'est le bloc que cette tranche doit libérer
  en priorité, puisque « écrire un bloc » en dépend directement.
- **`node scripts/audit-vaults.mjs "<vault>" […]`** est le contrôle qui garde
  l'aller-retour lecture → écriture → lecture sur de vrais vaults (39 quiz,
  756 questions au 2026-09-04) : un bloc qui se réécrit et se relit, et
  aucun champ qui disparaît. **Il devra tourner à chaque retouche de
  `convertParsedToInternal` / `exportAll`** — et pas seulement à la fin, vu le
  passif de ces deux fonctions (`textVariant: 'command'` qui a déjà effacé 23
  invites de terminal d'un quiz Cisco lors d'une refonte précédente).
- **La couche fs des deux hôtes est déjà tendue** (457 et 466 lignes,
  section précédente) : avant d'ajouter l'écriture de blocs, envisager si ce
  découpage doit précéder ou accompagner la tranche, plutôt que d'ajouter une
  cinquième responsabilité à des fichiers déjà au-dessus de la cible.
