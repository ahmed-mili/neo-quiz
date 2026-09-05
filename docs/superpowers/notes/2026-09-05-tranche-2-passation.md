# Passation tranche 2 → tranche 3

**Date** : 2026-09-05
**Pour qui** : l'agent qui écrira et exécutera le plan de la tranche 3, dans
une autre session, sans accès à celle-ci. Ce document est tout ce qu'il aura
en plus du dépôt lui-même — il ne recopie pas les rapports de tâche
(`.superpowers/sdd/2026-09-05-app-windows-tranche-2/task-*-report.md`), mais
il en synthétise ce qui compte pour la suite.

---

## Ce que la tranche 2 a livré

Commits `9b09031`..`876544b` (18 commits ; `588aa27`, le plan lui-même, est
exclu).

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
  un chemin local à la main, c'est exactement le défaut qui a coûté le
  « défaut CRITIQUE » de la tâche 6 (voir plus bas).
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

## Les 11 décisions du contrôleur (rulings)

Cinq engagent l'exécution seulement (choix de modèle, réaction à une panne
d'API, absence de re-revue) : le worktree isolé demandé par le skill a été
refusé (contrainte du dépôt : commits directs sur `main`, jamais de branche) ;
les épreuves à l'écran de chaque tâche ont été systématiquement reportées à
cette note plutôt que faites par un subagent (aucun n'a d'affichage) ; un tour
sans diff n'a pas reçu de re-revue scopée (rien à re-réviser) ; après une
panne d'API sur un implémenteur, le modèle par défaut est descendu à sonnet
partout sauf la revue finale (opus) ; après une seconde panne touchant opus
ET sonnet, la leçon retenue est de chercher, après toute interruption en
cours d'épreuve de discriminance, TOUT le diff non commité (pas seulement la
garde nommée dans le dernier message) pour des marqueurs « temporaire »,
« discriminance », « debug » ou des valeurs en dur court-circuitant un calcul
— une perturbation de test oubliée serait sinon commitée et passerait pour du
code voulu.

Six engagent le CODE, et la tranche 3 doit les connaître :

1. **Tâche 3, brief non suivi** : « Modifier `src/review/paths.ts` » était un
   reliquat du brief — la tâche 3 ne fait que le LIRE (créé en tâche 2).
   Coût si cette lecture est fausse : un fichier touché sans raison qu'une
   revue de tâche aurait de toute façon attrapé — sans conséquence réelle,
   mentionné pour mémoire de méthode plus que pour son contenu.
2. **Tâches 2 et 3, portée des faux hôtes de test** : `check-scanner.mjs` et
   `check-math-render.mjs` fabriquent des hôtes PARTIELS en JS non typé ;
   l'ajout d'`onRenameDir` au contrat ne les casse pas, donc ils n'ont pas été
   complétés. **Coût si la tranche 3 leur fait appeler une méthode
   manquante** : le script mourra sur un `TypeError` au lieu d'échouer
   proprement — compléter le faux hôte AVANT d'ajouter l'appel, pas après
   avoir vu l'échec.
3. **Tâche 2, correction incluse dans le tour de correction** : un
   commentaire de `paths.resultsDir` devenu faux à cause de cette même tâche
   a été corrigé dans le même tour, alors que la règle générale est de
   différer les mineurs. Raison : l'inexactitude était INTRODUITE par la
   tâche, dans un fichier qu'elle rouvrait, et le coût était d'une ligne.
   Retenir le principe : une inexactitude qu'on vient soi-même de créer entre
   dans la correction, un défaut préexistant qu'on découvre en passant n'y
   entre pas.
4. **Tâche 3, concurrence de la migration** : la migration est idempotente
   EN SÉQUENCE, pas en concurrence — deux hôtes qui migrent la même seconde
   écrivent deux fois les mêmes lignes. Aucun verrou n'a été ajouté (nouveau
   mode de panne pour un cas rare) ; à la place, `createLogFile.load()`
   dédoublonne les lignes identiques au chargement, sur la même clé que
   l'absorption Syncthing. **Coût si cette décision est fausse** : deux
   révisions réellement identiques à la milliseconde près seraient fondues en
   une — jugé impossible en pratique. **Pour la tranche 3** : si l'éditeur de
   l'app introduit une autre écriture concurrente sur le même journal, ce
   dédoublonnage au chargement est le filet existant à réutiliser, pas un
   nouveau verrou à inventer.
5. **Tâche 7, une variable CSS inexistante gardée hors du système de
   variables** : `#7c3aed` (couleur de marque) reste en dur à deux endroits
   de `shell.css` plutôt qu'une variable locale — différé, sans risque
   fonctionnel, juste une dette de cohérence.
6. **Tâche 7, `review.settings.quizCount`** : la clé i18n est orpheline
   (posée d'avance par le plan, avant que rien ne l'appelle). Décision : la
   GARDER quand même à la tâche 7 (le type force sa présence dans les deux
   dictionnaires, une tâche suivante pouvait la consommer) ; la tâche 11 a
   ensuite confirmé qu'elle n'a AUCUN appelant dans tout le dépôt. **La
   tranche 3 doit trancher** : soit une tâche l'utilise enfin, soit elle est
   retirée des deux dictionnaires (`en`/`fr`) — la garder orpheline
   indéfiniment n'a pas de justification restante.

---

## Les 26 constats mineurs différés, groupés par thème

Source : `.superpowers/sdd/2026-09-05-app-windows-tranche-2/mineurs-differes.txt`
(liste brute) ; regroupés ici par zone de code, avec un avis sur l'urgence
pour la tranche 3 (qui touche `src/editor/`, l'écriture des blocs, la
création et la suppression de quiz — donc surtout la couche fs des deux
hôtes, et un peu moins le journal lui-même).

**Journal et migration (`src/review/*.ts`) — 6 constats. À surveiller si la
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
- Message d'erreur développeur et `let creerCarteRacines` partagé entre
  groupes du script de test (si le premier groupe jette, les suivants meurent
  sur `TypeError`) — fragilité du script de contrôle, pas du produit.

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
- La couleur de marque `#7c3aed` en dur à deux endroits de `shell.css` (déjà
  listé plus haut sous « rulings », répété ici pour la vue par thème).
- `review.settings.quizCount` orpheline (idem, décision à prendre en tranche
  3 — voir ruling 6).

**Divers, un seul constat sans conséquence identifiée :**
- La garde `exists(to)` insensible à la casse (déjà listé sous « Hôte
  Windows » ci-dessus).

---

## Un avertissement sur le plan lui-même

Le code que le plan de la tranche 2 dictait « verbatim » s'est révélé fautif
**huit fois sur douze tâches** :

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
4. **Tâche 6** — une régression de résolution de liens, trouvée en revue en
   chargeant le code réel (pas en le lisant) : les chemins de l'index
   portaient le préfixe de racine, mais pas les liens écrits dans les notes
   — l'égalité exacte tombait donc TOUJOURS, et une image citée depuis un
   sous-dossier aurait servi le mauvais fichier, en silence. Le cas qui
   aurait dû l'attraper avait été réécrit pour s'aligner sur le code fautif
   plutôt que sur la règle.
5. **Tâche 7** — une variable CSS donnée comme « déjà définie » par le
   brief (`--size-4-2`) n'existe nulle part dans le dépôt.
6. **Tâche 9** — une clé de signature non injective (`ids.join(" ")`) :
   `["ip","masque"]` et `["ip masque"]` collisionnent, ce qui aurait pu
   transporter l'historique d'une note vers une autre sans que rien ne le
   signale.
7. **Tâche 10** — un cast `as HTMLInputElement` redondant.
8. **Tâche 11** — une classe CSS de titre de PAGE (`qbd-quizzes-title`, 28px
   serif) employée pour un titre de SECTION : un second titre géant se
   serait empilé sous « Mes quiz ».

**Un plan est un argument, pas une autorité.** Les épreuves de discriminance
(casser la règle qu'un cas est censé garder, voir l'assertion rougir,
restaurer) sont ce qui a attrapé la moitié de ces huit défauts (3, 4 en
partie, 4, 6) ; les quatre autres ont été trouvés par une lecture attentive
ou une revue qui a chargé le code réel plutôt que de le survoler. La tranche
3 touchera l'écriture de fichiers — la partie la plus irréversible du
produit après le journal — et devrait appliquer la même méfiance à tout
extrait de code que son propre plan proposera verbatim.

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
