# Les contrôles du dépôt — pourquoi chacun existe

**Date** : 2026-09-05

Ce document porte le DÉTAIL que `CLAUDE.md` ne peut plus tenir sans dépasser sa
taille cible. Sa règle d'hygiène le dit elle-même : « Ne jamais dupliquer ce que
d'autres fichiers exposent déjà. Pointer, pas dupliquer. »

Chaque entrée dit **le défaut réel que le contrôle empêche**. C'est cette raison,
pas la description du script, qui décide si on a le droit de le contourner — la
réponse étant toujours non.


- `npm run check` — typecheck (`tsc --noEmit`). Toujours lancer après une modif TS.
- `npm run check:host` — **le cliquet de la frontière d'hôte** : aucun fichier de `src/`
  n'importe Obsidian hors d'une liste `RESTANTS` qui ne peut que RÉTRÉCIR (une entrée
  qui n'importe plus rien fait échouer le contrôle, sinon la liste devient un tapis).
  Il annonce le nombre de fichiers encore liés — **8** aujourd'hui. Il couvre les
  trois formes (`from`, `require`, `import()` différé) et toutes les extensions TS ;
  chacune de ces mailles a été une échappatoire vérifiée. Il est dans la CI : lancé à
  la main, c'est la discipline et non le contrôle qui tiendrait la frontière.
  Sa limite : les **extensions DOM** d'Obsidian (`createEl`, `empty`, `setText`…) ne
  sont trahies par aucun `import`. Le seul filet contre elles est
  `npx tsc --noEmit -p apps/windows/tsconfig.json`, d'où la règle qu'aucun fichier
  atteint par ce typecheck ne doit tirer `obsidian.d.ts` — un simple `import type`
  suffisait à le neutraliser.
  Sa SIXIÈME assertion (revue finale de la migration Electron, I2) garde l'autre
  frontière du même dépôt : **le rendu de l'application (`apps/windows/src/`)
  n'importe jamais un module qui tire Node** — `node:*`, `chokidar`, `electron`,
  ni un module de `apps/windows/electron/` hors de la liste `SANS_NODE`
  (`catalogue`, `ressources`, `pont`), dont chaque entrée est elle-même vérifiée
  sans import Node. Le défaut qu'elle empêche ne rougissait NULLE PART : Vite
  EXTERNALISE `node:fs` avec un avertissement et `check:app` reste vert, donc un
  `import { readFile } from "node:fs"` dans `host/fs.ts` ne se découvrait qu'à
  l'exécution (`readFile` indéfini) ; et `perimetre.ts` ou `fichiers.ts`
  importés du rendu recréaient, côté Chromium, l'accès disque total que le pont
  existe pour retirer — `sandbox: true` ne protège que de ce qui est réellement
  chargé. `import type` reste admis (effacé à la compilation) ; `import { type X,
  Y }` compte comme un vrai import. Éprouvée par quatre cassures (`node:fs`
  statique, `perimetre` réel, `import("chokidar")` dynamique, `node:fs` ajouté à
  `ressources.ts`), chacune rouge sous son libellé propre.
- `npm run check:dashboard-dom` — le trou que `check:host` ne peut pas fermer seul :
  il ne regarde les extensions DOM d'un fichier QUE tant que ce fichier reste hors
  de `RESTANTS`. Rien n'empêche qu'une tranche future remette
  `import { setIcon } from "obsidian"` dans une page du tableau de bord « pour
  aller vite » et l'ajoute du même geste à `RESTANTS` — ses extensions DOM
  redeviendraient alors invisibles au contrôle, sans qu'aucun message ne le
  signale. Ce script nomme, indépendamment de `RESTANTS`, les pages libérées
  POUR DE BON par la tranche 2.5 : sa liste ne peut que grandir, jamais rétrécir,
  et un retour d'obsidian dans l'une d'elles y échoue directement, sans dépendre
  de l'état de l'autre liste. La tranche 5 (tâche 6) y fait entrer la page
  « Générer » (`src/dashboard/ai.ts`) et les deux modules qu'elle a fait naître
  ou libérer (`usage-format.ts`, `hotkey-format.ts`) : c'est le fichier le plus
  exposé du lot — **92 extensions DOM y ont été converties d'un coup** vers
  `ajouter` (`src/dom.ts`), et un seul `import { setIcon } from "obsidian"`
  remis « pour aller vite » les rendrait toutes invisibles à `check:host`.
- `npm run check:theme` — exhaustivité du thème de l'app (`apps/windows/src/theme/
  host-vars.css`) : le greffon hérite des variables CSS d'Obsidian, l'app doit les
  définir. Une oubliée ne produit AUCUNE erreur — un texte invisible sur un fond de la
  même couleur. Symétrique, comme le cliquet : une variable devenue morte dans le thème
  doit en être retirée. Dans la CI aussi.
- `npm run check:obsidian-host` et `check:windows-host` — les deux implémentations du
  contrat `src/host/types.ts`, chargées avec une fausse `App` / un faux index.
  Tranche 5, tâche 6 : `fs.readBinary` (les octets d'un fichier du CONTRAT — la
  pièce jointe d'une génération ; le vault pour un fichier indexé, l'adaptateur
  sinon, et un `Uint8Array`, jamais l'`ArrayBuffer` nu), `platform.isWindows`
  (LU séparément d'`isMacOS`, jamais déduit de lui : la commande d'installation
  d'un CLI est différente sur les TROIS systèmes, et « pas un Mac » aurait donné
  du PowerShell à un Linux) et le membre OPTIONNEL `HostPdf` — que l'hôte
  Obsidian PORTE (pdf.js embarqué, une section par page, dans l'ordre) et que
  celui de l'application n'a PAS, ce qu'une assertion STATIQUE garde
  (`index.ts` importe MathLive, donc ne se charge pas ici) : sans cette absence,
  la page « Générer » accepterait un PDF dans la fenêtre et en joindrait le
  texte vide au lieu de le refuser (`ai.error.pdfUnsupportedInApp`). Depuis la
  tâche 2 du chantier « greffon lecteur » (2026-09-13), `check:obsidian-host`
  ne couvre plus `pdf` : son seul consommateur (la page « Générer ») est parti
  avec le tableau de bord, et le greffon lecteur ne fournit plus ce membre
  optionnel. Une
  méthode d'hôte qui rend `null` en silence rendrait les images, le bouton ressource ou
  la sauvegarde inertes sans un mot. Chaque cas neuf doit être éprouvé par DISCRIMINANCE
  (casser la règle, voir rougir, restaurer) : un cas qui passe au vert quoi qu'on fasse
  ne prouve rien — c'est arrivé deux fois ici. `check:windows-host` couvre en plus les
  RACINES du dossier composite : `local()` et `contrat()` doivent se composer en
  identité (aller-retour sans perte), et une résolution de lien par nom ne doit jamais
  franchir la racine de la note qui cite — sans cette borne, une image du dossier A
  se servirait, en silence, à une note du dossier B.
  **`createObsidianHost` reçoit un troisième paramètre, `envHote` (défaut
  `process.env`)** : la couture d'environnement du ruling 9. Sans elle, le groupe
  « les CLI » n'atteint pas sa propre entrée sur une machine avec l'installateur
  officiel de Codex — `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe` existe
  pour de vrai, et `buildChildEnv` l'ajoute TOUJOURS au PATH tant que
  `LOCALAPPDATA` pointe dessus. Muter `process.env.PATH` pour poser un faux
  `codex.cmd` en TÊTE ne suffit pas : `spawn` direct ne résout qu'un `.exe` et
  saute le faux, le repli `cmd.exe` retrouve le VRAI `codex.exe` plus loin dans
  le PATH, et trois cas reçoivent la réponse du VRAI CLI (`error: a value is
  required for '--profile ...'`) au lieu de celle du faux — MACHINE-DÉPENDANT :
  vert sur une machine sans Codex installé, rouge sur celle d'Ahmed. Le
  contrôle construit désormais un environnement dédié (`envTest`, muté en
  place) où `PATH` ne contient QUE le dossier du faux CLI et où `APPDATA` /
  `LOCALAPPDATA` / `CODEX_INSTALL_DIR` sont ABSENTS, pour que `buildChildEnv`
  ne réintroduise aucun chemin réel derrière.
  **Le groupe « réseau » de `check:obsidian-host` tient les DEUX VOIES de
  `net.fetchJson`**, et c'est l'HÔTE de l'URL qui tranche, jamais l'appelant :
  `fetch` pour la boucle locale, `requestUrl` partout ailleurs. Le défaut qu'il
  empêche est invisible à l'écran : `requestUrl` n'accepte AUCUN `signal`, donc
  faire passer Ollama par lui — ce qu'a fait le premier jet de la tranche 5,
  tâche 4 — retire l'annulation. Un clic sur Stop rendait la main à l'écran
  mais laissait le modèle inférer ; relancer aussitôt faisait tourner DEUX
  inférences concurrentes sur le même modèle local. Le cas branche un faux
  `fetch` qui ne répond QUE sur son `signal` : un `requestUrl`, qui l'ignore, ne
  pourrait pas finir. Et le nom d'hôte est ANALYSÉ par `URL`, jamais cherché en
  sous-chaîne — `https://localhost.evil.com/` contient « localhost ».
- **LE TROU DU HARNAIS : `sanitizeQuizHtml` n'est éprouvable par AUCUN contrôle
  du dépôt.** `linkedom` (le DOM des scripts) ne tient pas la sémantique d'un
  `<template>` : son `.content` est une fragment SÉPARÉE du `innerHTML` qu'il
  resérialise, donc toutes les retouches du sanitizer s'y perdent et il rend son
  entrée TELLE QUELLE. Mesuré deux fois, indépendamment : `<script>`,
  `onerror=` et `javascript:` y survivent tous les trois. **Un cas écrit sur
  `sanitizeQuizHtml` avec ce DOM est VERT quoi qu'on casse** — le piège que
  `CLAUDE.md` nomme (« un cas vert quoi qu'on fasse ne prouve rien »), ici posé
  par l'outillage et non par l'auteur. La fenêtre et Obsidian, eux, ont de vrais
  `<template>` : le sanitizer y fonctionne, et c'est le relevé À L'ÉCRAN qui en
  répond. Ce qui garde les quatre portes reste donc la LECTURE du code.
  Corollaire, pour que personne ne s'y trompe : les deux cas « le schéma des
  ressources » de `check:windows-host` prouvent exactement que la chaîne `app:`
  FIGURE sur la ligne d'`isSafeQuizUrl` (`src/engine/sanitizer.ts`) et sur celle
  des préfixes déjà résolus (`src/engine/cards.ts`) — rien de plus. Ils
  resteraient verts si `cards.ts` cessait d'appeler le sanitizer, ou si la liste
  blanche cessait d'être consultée.
- `npm run check:math-render` — la segmentation LaTeX partagée (`$$…$$` testé avant
  `$…$`, l'heuristique qui épargne « 5$ et 3$ ») : le code qu'aucun hôte ne réécrira,
  puisque c'est lui qui décide ce qui EST une formule. Il tourne sur un faux `HostMath`,
  ce qui prouve du même coup que plus rien n'appelle Obsidian — le bouchon de
  `load-src.mjs` jetterait bruyamment.
- `npm run check:text-search` — la RECHERCHE FLOUE partagée (`src/text-search.ts`,
  tranche 5, tâche 5), qui remplace `prepareFuzzySearch` d'Obsidian dans le
  sélecteur « @ » (`dashboard/file-sources.ts`, `searchAll`). Le défaut qu'il
  empêche : un ordre de résultats qui diverge de celui qu'Obsidian montrait —
  « td » qui mettrait `std.md` devant `Cours/TD3.md` (bonus de début de mot),
  `no-te.md` devant `Cours/notes.md` (coût de rupture), ou `Cache/h.md` devant
  `Cours/ch1.md` (un glouton qui saisit le premier « c » ; c'est ce défaut, vu
  rouge, qui a fait passer l'alignement en programmation dynamique). Ses cas
  sont des ORDRES observés sur le vrai `prepareFuzzySearch` (Obsidian 1.12.7,
  vault Efrei, scores cités en commentaire), jamais ses valeurs : c'est ce que le
  module promet. Chaque cas a rougi sous sa rupture (retirer le bonus, retirer
  la rupture, comparer la casse, glouton). Un score `null` y devient `NaN` avant
  toute comparaison : un cas qui mourrait sur `null.score` masquerait tous les
  suivants — c'est arrivé lors de sa preuve de discriminance.
- `npm run check:app` — build Vite (rendu) + typecheck du processus principal Electron
  (`tsconfig.electron.json`) de l'application Windows. C'est le contrôle qui attrape
  une rupture du code PARTAGÉ vue depuis l'autre hôte, là où `npm run check` ne voit
  que le greffon.
- `npm run check:electron-index` — le surveillant chokidar débouncé et l'index du
  processus principal Electron (`apps/windows/electron/index-fichiers.ts`), sur un
  vrai dossier temporaire (`fs.mkdtemp`), chaque cas avec sa propre sous-racine vide —
  sinon le parcours initial de chokidar (`ignoreInitial: false`) ressurgit les
  fichiers d'un cas précédent comme autant de faux événements. Il empêche, entre
  autres, qu'un renommage rapide (rename hors chokidar, ou deux événements bruts que
  rien ne recolle) fasse perdre l'historique d'une note au surveillant.
- `npm run check:md` et `npm run check:export` — deux jeux de cas ciblés,
  sur les deux logiques qu'une relecture n'arrive pas à juger : le rendu markdown des
  champs texte (`renderInlineText`, `stripInlineMarkdown`) et l'écriture d'un bloc
  quiz-blocks (`exportAll`). Ils chargent le CODE RÉEL via esbuild
  (`scripts/lib/load-src.mjs`), jamais une réplique. Ils existent parce que ces
  deux-là ont déjà régressé plusieurs fois en silence : `3*4*5` rendu en italique, un
  objet imbriqué écrit `[object Object]` (bloc illisible, sauvegarde refusée sans un
  mot). **Pas de framework de test au-delà** ; ne pas en ajouter pour du code qu'une
  lecture suffit à juger.
- `npm run check:quiz-io` — le CÂBLAGE de l'écriture d'un bloc
  (`src/dashboard/detail-io.ts`), qui n'avait rien entre les deux contrôles
  ci-dessus : `check:export` juge la FORME du bloc produit, `audit-vaults.mjs`
  l'aller-retour sur de vrais vaults, et personne ne regardait le geste qui
  pose ce bloc DANS la note. Les quatre défauts qu'il empêche sont tous
  arrivés, tous silencieux, et deux d'entre eux ont régressé la nuit même de
  leur correction (revue codex 2026-07-31) : un bloc écrit en LF dans une note
  CRLF, dont chaque frappe apparaît ensuite comme une réécriture entière dans
  un diff ou une synchro ; un témoin de compare-and-swap mémorisé sous une
  autre forme que ce qui a été écrit, qui fait passer la PREMIÈRE frappe et
  perd la SECONDE sans un mot ; une clôture réécrite en forme canonique, qui
  efface un ` ```quiz-blocks data-owner=alice ` ou l'indentation d'un bloc en
  liste, là où le compare-and-swap ne peut pas s'en apercevoir puisqu'il ne
  compare que le JSON5 ; et le pire, qui ne lève rien et n'affiche rien : un
  remplacement par CHAÎNE au lieu de par FONCTION, où `$1`, `$&` et
  l'apostrophe inversée sont des motifs SPÉCIAUX — un quiz de maths plein de
  `$…$` réinjecte alors la source du bloc à l'intérieur de lui-même. Il éprouve
  aussi le REJEU du rappel de `fs.process`, que le contrat autorise et dont
  dépend le drapeau `ecrit` remis à faux en tête : sans lui, la page annonce un
  succès sur une note qu'elle n'a pas écrite. Le compare-and-swap sur le BLOC
  est la seule garantie à la bonne granularité — le `mtime` parle de toute la
  NOTE, et deux pages ouvertes pouvaient le franchir toutes les deux.
- `npm run check:scheduler` — le noyau de l'ORDONNANCEUR (`src/scheduler/`) : horizon
  de rétention, journal, état dérivé, plan du jour. Sa première section vérifie
  MÉCANIQUEMENT la pureté du noyau (aucun `from "obsidian"`, `document`, `window`,
  `Date.now()`, `new Date()`, `Math.random()`) : c'est ce contrôle qui garantit que le
  même module tournera à l'identique dans les futures applications PC et Android. Le
  casser, c'est perdre la seule partie du code qu'on ne réécrira pas.
- `npm run check:review-store` — l'adaptateur de l'ordonnanceur (`src/review/
  review-store.ts`), éprouvé sur un faux HÔTE plutôt que sur une fausse `App`
  Obsidian depuis que l'application Windows écrit le même journal. Il couvre
  désormais le ROUTAGE entre plusieurs journaux, un par dossier. Le cas qui compte :
  la clé écrite sur disque est LOCALE (`Cours/ch1.md::q1`), jamais préfixée par le
  dossier. Une clé préfixée passerait tous les autres contrôles — le plan lui-même
  proposait un cas qui restait vert avec une clé préfixée — et rendrait l'historique
  de l'application invisible depuis Obsidian, sans qu'aucun message ne le dise.
- `npm run check:engine-review`, `check:module-edit` — les deux autres câblages de
  l'ordonnanceur : l'enregistrement des réponses par le moteur, la date d'examen par
  module.
- `npm run check:review-log` — l'emplacement et la MIGRATION du journal. Il éprouve
  ce qu'aucun disque ne produit sur commande : une écriture qui prétend réussir sans
  rien écrire. Sans la relecture qu'il garde, l'ancien journal serait rangé et les
  révisions n'existeraient plus nulle part — c'est exactement le bug que le code
  fourni verbatim par le plan contenait (une relecture de confirmation qui LEVAIT au
  lieu de dégrader proprement en `confirmed: false`).
- `npm run check:folders` — la conversion du réglage `folder` → `folders` et
  l'unicité des identifiants de dossier. Sans la première, une mise à jour renvoie
  l'utilisateur à l'écran « Choisissez un dossier » alors que son dossier est
  toujours là ; sans la seconde, deux dossiers homonymes confondent leurs chemins et
  l'historique de l'un compte pour l'autre.
- `npm run check:rename-match` — l'appariement des renommages que le surveillant ne
  sait pas nommer lui-même. Les deux défauts qu'il empêche ne sont pas symétriques :
  un appariement manqué coûte l'historique d'une note (au moins visible : elle
  reprend à zéro) ; un appariement FAUX transporte l'historique d'une note vers une
  autre, et ne se voit jamais. C'est ce second défaut, plus fin, qui a été trouvé ici
  a posteriori : une clé de signature non injective (`ids.join(" ")`) faisait
  collisionner `["ip","masque"]` et `["ip masque"]`.
- `npm run check:electron-fs` — les primitives de fichiers du processus principal
  Electron (`apps/windows/electron/fichiers.ts`, tâche 1 de la migration
  Tauri → Electron). Onze cas, pas huit : le brief de la tâche citait `stat`, absent
  du contrat `HostFs` (`src/host/types.ts`), et omettait `list`, `remove`, `rename`,
  qui y sont — le contrat fait autorité sur le plan. Il empêche, entre autres,
  qu'un `append` non atomique perde un ajout concurrent au journal de révision,
  qu'un `trash` supprime au lieu de déplacer, et qu'un homonyme déjà dans la
  corbeille soit écrasé plutôt que numéroté. Tourne sur un vrai dossier temporaire
  (`fs.mkdtemp`), retiré dans un `finally`.
  Depuis la tranche 5 (tâche 5), il éprouve aussi `listerDossier`, `statEntree`
  et `readBinary`, les primitives derrière `HostFs.listDir` et `HostFs.externe`
  (le sélecteur « @ » : sous-dossiers du vault, racines externes) : un
  `listerDossier` sans type ne saurait plus dire dans quoi descendre, un
  `statEntree` qui rendrait `null` pour un dossier — comme `stat` le fait exprès
  — laisserait l'index d'une racine externe périmé à jamais, un `readBinary` qui
  rendrait un `Buffer` nu emporterait le pool de Node dans l'IPC. Leur BORNAGE
  (« hors périmètre → refus nommé ») n'est pas ici : c'est `perimetre.borner`,
  que `canaux.ts` applique à chaque canal et que `check:electron-reglages`
  éprouve ; côté rendu, `check:windows-host` (groupe « listDir, listFiles et
  racines externes ») prouve que ce refus devient `[]`/`null` pour `list`/`stat`
  et remonte pour `read`/`readBinary`.
- `npm run check:electron-reglages` — les trois modules du processus principal que
  la fenêtre ne peut pas éprouver à sa place : `reglages.ts`, `vaults.ts`,
  `perimetre.ts` (tâche 3, ronde de correction 1). Il empêche des défauts qui
  échouent EN SILENCE : un fichier de réglages réécrit à partir d'une table VIDE
  parce qu'une lecture a transitoirement échoué (un `EBUSY` d'antivirus, puis le
  premier `ecrire`, et TOUS les dossiers de l'utilisateur perdus sans message —
  c'était le code de la première version) ; un JSON corrompu ÉCRASÉ au lieu d'être
  mis de côté ; deux écritures concurrentes qui se renomment l'une l'autre ; un
  `.tmp` laissé comme résultat final. Et le PÉRIMÈTRE, la règle la plus importante
  du pont Electron : un chemin hors des dossiers ouverts, un `..` qui en sort, une
  jonction posée dedans et pointant dehors, une racine de corbeille inconnue — sans
  lui, chaque canal `fichiers.*` est un accès disque total depuis la fenêtre, qui
  rend du HTML qui n'est pas toujours celui de l'utilisateur. Le cas du `..` est
  CONCATÉNÉ, jamais composé par `path.join` : `join` replie déjà les `..` et le cas
  était vert quoi qu'on casse.
  Depuis le 2026-09-17, le périmètre a DEUX listes : les racines (lecture et
  écriture) et les fichiers admis par le dialogue natif (lecture et ouverture
  seulement, `autoriserFichier`/`bornerEcriture`). Le cas « un fichier admis ne
  s'écrit pas » est ce qui empêche « choisis-moi ce fichier » de devenir
  « écris dedans ».
  Et le dossier de RÉGLAGES (`userData`) reste HORS périmètre au démarrage : il
  porte `settings.json`, dont la clé `folders` nourrit le périmètre à la session
  suivante — l'y admettre laisserait le pont réécrire ce fichier en brut et
  obtenir tout le disque de façon persistante (Ruling 12).
  Deux cas de la revue finale de la migration : **le périmètre borne l'écriture
  et la lecture, pas l'EXÉCUTION** (I1) — `systeme.ouvrir` passe par
  `shell.openPath`, et pour un `.bat` « l'application par défaut » est le fichier,
  donc `write` puis `ouvrir`, deux appels bornés, composaient une exécution (et
  sans XSS : `engine/resources.ts` ouvre par NOM un fichier livré avec le dossier
  d'un quiz partagé). Le prédicat `extensionRefusee` vit dans `ressources.ts`,
  sans Node ni Electron, pour être éprouvé ici (liste noire, casse ignorée,
  dernier point du nom) ; `canaux.ts` l'applique et LOGGE le refus. Et **une clé
  de réglage `__proto__`** (M6) n'écrivait aucune propriété propre mais
  remplaçait le prototype de la table : refusée avec sa cause, et la table
  reste intacte après le refus.
  Depuis la tranche 5 (tâche 5, ruling 14), un groupe STATIQUE : **chaque
  gestionnaire `ipcMain.handle(CANAUX.<x>, …)` de `canaux.ts` dont le canal est
  `neo:fichiers/*` contient `perimetre.borner(` OU `perimetre.bornerEcriture(`**
  (les deux portes du périmètre depuis le 2026-09-17 — ce test ne distingue pas
  laquelle, seulement qu'AU MOINS UNE borne le canal ; c'est le groupe
  COMPORTEMENTAL « périmètre » qui prouve laquelle pour chaque canal), la liste
  des canaux DÉRIVÉE de `CANAUX` (`pont.ts`), jamais recopiée. `canaux.ts` tire Electron et ne se
  charge dans aucun script : jusque-là, la borne de chaque canal n'était prouvée
  par personne, et trois canaux nés d'un coup (`listerDossier`, `statEntree`,
  `readBinary`) auraient pu arriver sans elle — un accès disque total depuis la
  fenêtre, sans qu'aucun contrôle ne rougisse. Le corps d'un gestionnaire est
  délimité par ses parenthèses équilibrées, pas par une regex de ligne. Éprouvé
  : `listerDossier` sans `borner` → rouge, nommé.
  Depuis la tranche 5 (tâche 6, ruling R-B), **la garde de la clé `ai`**
  (`apps/windows/electron/garde-ia.ts`, pur — ni `electron` ni `node:*`, chargé
  tel quel). Le défaut qu'elle empêche : la clé `ai` est la première que le
  RENDU écrit et que le PRINCIPAL relit pour élargir ce qu'il accepte — l'hôte
  d'`aiOllamaUrl` entre dans la liste du réseau (`reseau.ts`), et
  `aiMentionExtraFolders` désigne des dossiers que les canaux `fichiers.*`
  liront. Sans garde, un rendu compromis obtenait un hôte Internet au prochain
  lancement. Les cas : `hoteEstPrive` (boucle locale, RFC 1918 aux bornes
  exactes — 172.15 et 172.32 sont publics —, `.local`) ; `validerReglagesIa` :
  une valeur qui n'est pas un objet, une URL illisible / non-chaîne / hors
  `http(s)` (`file://127.0.0.1/…` porte un hôte DE LA LISTE, la même moitié que
  `hoteAutorise`) sont REFUSÉES avec leur cause ; un hôte de la liste ou du
  réseau local passe et est À ADMETTRE aussitôt (pas au prochain lancement) ;
  un hôte Internet hors liste demande CONFIRMATION, par son nom en minuscules ;
  un dossier hors périmètre dans `aiMentionExtraFolders` est refusé et nommé,
  et prime sur une URL valide (rien n'est admis quand une moitié est refusée).
  **Depuis la tâche 7, la même garde couvre `cheminClaude`/`cheminCodex`** — le
  champ qui donne le droit le plus fort de toute la clé, puisque le principal
  LANCERA ce qu'il désigne. Trois conditions qui ne se remplacent pas : ABSOLU
  (un chemin relatif serait résolu contre le dossier courant du principal, que
  l'utilisateur ne connaît pas), EXISTANT (dit à l'ÉCRITURE, là où on peut
  encore corriger, plutôt qu'à la prochaine génération sous la forme « CLI
  introuvable »), et d'une EXTENSION LANÇABLE — une liste BLANCHE
  (`exe`, `com`, `cmd`, `bat`, `sh`, plus le fichier sans extension d'Unix),
  à l'inverse de la liste noire d'`EXTENSIONS_EXECUTABLES` qui garde `ouvrir` :
  là-bas il faut accepter tout ce qu'un quiz livre et n'exclure que ce qui
  s'exécute, ici un CLI est une chose très précise. Le cas le plus dangereux
  est celui que l'existence ne filtre PAS : un `.js` qui existe pour de bon —
  la séquence « écris un `.js` dans un dossier ouvert, puis désigne-le comme
  CLI », que le refus d'extension et lui seul empêche ; le pont refuse déjà de
  l'OUVRIR, l'admettre ici rouvrirait la même porte par l'autre bout. Le
  prédicat d'existence est INJECTÉ, comme celui du périmètre. **Et le chemin
  doit être HORS DU PÉRIMÈTRE (revue finale, C1) — c'est la condition qui tient
  tout le reste** : `fichiers.write("<racine>/x.cmd")` passe `borner` (le
  périmètre borne l'ÉCRITURE, et l'extension n'est jugée qu'à l'OUVERTURE),
  puis ce chemin dans `cheminClaude` passait absolu + extension + existence, et
  la génération suivante lançait ce que la fenêtre venait d'écrire, dans le
  processus principal. Un CLI légitime vit dans `Program Files`, `~/.local/bin`,
  `%APPDATA%
pm` — jamais dans un dossier de quiz : refuser le périmètre (qui
  couvre aussi `aiMentionExtraFolders`, admis seulement s'ils y sont déjà) ne
  coûte aucun chemin valide. **Et le verdict est REJOUÉ AU LANCEMENT**
  (`cheminCliPourLancement`, pur, appelé par `cheminCliRegle` dans `canaux.ts`
  avec le périmètre et le disque d'AUJOURD'HUI) : le périmètre grandit après
  l'écriture — l'utilisateur ouvre plus tard le dossier qui contient le `.cmd` —
  et un chemin admis hier peut être dedans aujourd'hui ; refusé, nommé, RIEN
  n'est lancé, pas même un repli. Le rejeu côté `canaux.ts` est tenu par une
  assertion STATIQUE dans `check:electron-process` (le corps de `cheminCliRegle`
  contient `cheminCliPourLancement(`, `perimetre.contient(`, `statEntree(`).
  Puis, STATIQUE comme la borne des canaux : `reglagesEcrire` appelle
  `garderReglagesIa(` AVANT `.ecrire(`, et celle-ci passe par le verdict pur
  et admet par `autoriserHote(verdict.…)`. Le dialogue natif lui-même
  (`dialog.showMessageBox`, traduit par le principal sur `app.getLocale()`)
  n'est pas chargé — `canaux.ts` tire Electron. Éprouvé par rupture, chacune ne
  rougissant que son cas : plage 172.16/12 retirée ; 172.32 admis ; protocole
  non vérifié ; `confirmer` remplacé par `ok` ; périmètre non consulté ;
  `garderReglagesIa` déplacée APRÈS `.ecrire(`.
- `npm run check:ai-providers` — les FOURNISSEURS IA (`src/dashboard/
  ai-providers.ts`), que AUCUN script ne chargeait avant la tranche 5 (tâche 6)
  alors que ce module décide de ce que la page « Générer » propose ET affiche
  comme statut, et qu'il est passé tout entier par le contrat d'hôte
  (`net.fetchJson`, `process.lireCache`). Ce qu'il empêche, et qui échouerait EN
  SILENCE : (a) un catalogue cloud qui retomberait sur son repli embarqué sans
  jamais consulter l'hôte — une liste périmée indistinguable d'une liste à jour,
  quand la règle du dépôt est « jamais de modèle codé en dur » (mémoire
  `ollama-latest-version-only`) ; (b) un `/api/tags` qui répond **200 avec du
  HTML** (portail captif, proxy, n'importe quel service qui occupe le port)
  pris pour un serveur Ollama : l'ancien `resp.json()` levait et tombait dans le
  `catch`, mais le contrat rend le corps BRUT, et un `JSON.parse` oublié
  donnerait « joignable, 0 modèle » — l'utilisateur chercherait où sont passés
  ses modèles ; (c) `refreshCliCaches` qui ne remplirait plus l'instantané que
  les deux lecteurs SYNCHRONES (`getCodexModels`, `isFableOffered`) lisent :
  ils rendraient le repli embarqué pour toujours, sans erreur. Le premier cas du
  groupe vérifie EXPRÈS que ces lecteurs rendent le repli AVANT tout
  rafraîchissement, pour que le suivant ne soit pas vert par construction.
  Aussi : l'URL du réglage est normalisée avant composition (« …:11434//api/tags »
  sinon), `/api/version` est best-effort (son échec ne coûte qu'un numéro), et
  le badge de Fable suit le forfait PASSÉ — le module ne lit plus le trousseau
  lui-même, c'est ce qui l'a détaché d'`ai-usage.ts` donc d'Obsidian. Éprouvé
  par rupture, chacune ne rougissant que son cas.
- `npm run check:electron-reseau` — la PORTE RÉSEAU du processus principal
  (`apps/windows/electron/reseau.ts`, tâche 2 de la génération IA dans
  l'application). Le défaut qu'il empêche : **un rendu compromis fait de
  l'application un RELAIS vers n'importe où.** La fenêtre rend du HTML qui n'est
  pas toujours celui de l'utilisateur (un quiz PARTAGÉ porte les `explainHtml`
  de son auteur), et le canal `reseau.fetch` du pont est, par construction,
  « fais cette requête à ma place » — sans liste d'hôtes, exfiltrer une note
  vers un serveur tiers tiendrait en un appel, et le périmètre des chemins n'y
  verrait rien. C'est la même règle que `perimetre.borner`, appliquée aux URL :
  la liste (`localhost`, `127.0.0.1`, `ollama.com`, `api.anthropic.com`) vit
  dans le principal, et le seul ajout possible est l'hôte d'`aiOllamaUrl`, lu
  des RÉGLAGES par `main.ts` au démarrage (`autoriserHote`), comme `folders`
  nourrit le périmètre. La liste est PILOTÉE PAR LES
  RÉGLAGES, et c'est pourquoi la clé `ai` est GARDÉE à l'écriture comme
  `folders` l'est (`reglagesEcrire` → `garderReglagesIa`, tranche 5, tâche 6 ;
  le verdict pur vit dans `garde-ia.ts` et son groupe dans
  `check:electron-reglages`) : sans elle, un rendu compromis y écrivait
  `{ aiOllamaUrl: "https://attaquant.example" }` et obtenait cet hôte AU
  PROCHAIN LANCEMENT. Deux autres résiduels sont admis et nommés dans `reseau.ts` : `net.fetch` SUIT les
  redirections d'un hôte de la liste vers n'importe où (un 307/308 renvoie le
  corps du POST ; qui contrôle la réponse d'un hôte listé tient déjà ce corps,
  et `redirect: "manual"` casserait le catalogue d'`ollama.com`), et
  `localhost` est admis sur tous les ports (le plan l'exige : Ollama en change
  d'une installation à l'autre). Le PROTOCOLE est vérifié aussi,
  pas seulement l'hôte : `net.fetch` d'Electron sert `file:` (c'est ce que
  `main.ts` en fait pour les images), et `new URL("file://127.0.0.1/C:/x")`
  garde l'hôte « 127.0.0.1 », qui est DANS la liste — sans cette moitié, la
  porte réseau serait une porte disque hors du périmètre. Il éprouve ensuite
  les deux promesses de `HostNet` que `requestUrl` ne tenait pas par défaut :
  un statut d'erreur est RENDU avec son corps (Ollama y met son diagnostic,
  « model not found », et le greffon le perdait), et une annulation rend `null`
  sans lever ni journaliser une panne. Sur le module RÉEL contre un serveur
  `http` local sur un port libre : `reseau.ts` reçoit son transport en
  paramètre (`net.fetch` dans l'application, le `fetch` de Node ici) exprès
  pour que le contrôle n'ait rien à doubler. Le serveur écoute sur l'adresse
  non spécifiée (double pile) : Node résout « localhost » en IPv6 d'abord, et
  un serveur lié à `127.0.0.1` seul rendrait le cas « localhost est accepté »
  rouge pour une raison étrangère à la liste. Le refus est NOMMÉ
  (`console.warn`, « hôte hors liste ») et le cas le lit : un `null` muet
  ressemble à une panne réseau et fait chercher ailleurs. Côté rendu,
  `check:windows-host` garde le passe-plat (`apps/windows/src/host/net.ts`) :
  la requête traverse SANS `signal` (un `AbortSignal` ne se clone pas, `invoke`
  rejetterait), un identifiant distinct par requête, l'abandon relayé par
  `reseau.annuler` sous ce même identifiant et pendant la requête seulement.
- `npm run check:electron-process` — les FICHIERS DES CLI dans le processus
  principal (`apps/windows/electron/process.ts`, tâche 3 de la génération IA
  dans l'application). Le défaut qu'il empêche : **la page « Générer » propose
  une liste de modèles PLAUSIBLE mais périmée, sans un seul message.** Tout ce
  que l'application sait des modèles de Codex et du CLI Claude vient de deux
  fichiers à des chemins que seul le principal connaît
  (`$CODEX_HOME/models_cache.json` ou `~/.codex/models_cache.json`,
  `~/.claude.json`). Une clé décalée, un `$CODEX_HOME` ignoré — c'est
  l'override que le CLI Codex honore lui-même, donc lire ailleurs, c'est lire
  le cache d'une AUTRE installation que celle qui répond — ou un fichier absent
  qui LÈVE au lieu de rendre `null` : dans les trois cas, le code partagé
  retombe sur son repli embarqué, qui ressemble à une vraie liste. Un modèle du
  repli retiré du compte donne ensuite un 404 au CLI, et on cherche le défaut du
  côté du CLI. Le contrôle éprouve le module RÉEL sur un FAUX dossier personnel
  (`USERPROFILE`/`HOME` sont des paramètres de `lireCache` et `cheminCache`
  exprès : `os.homedir()` ne suit pas `HOME` sous Windows, et un contrôle qui
  lirait les vrais fichiers de la machine dépendrait de ce qu'ils contiennent),
  avec un `$CODEX_HOME` séparé dont le contenu DIFFÈRE de celui du dossier
  personnel — sans quoi « honore CODEX_HOME » passerait par hasard. Il couvre
  aussi les deux façons de n'avoir pas de cache (absent, JSON invalide), les
  emplacements d'installation d'Ollama système par système — la SECONDE sonde,
  celle qui distingue « serveur arrêté » de « non installé » quand le binaire
  n'est pas sur le PATH d'une application de bureau.
  **Depuis la tâche 7, il porte le groupe « lancer un CLI », sur de VRAIS
  process** — la capacité la plus dangereuse du pont. Cinq propriétés, dont
  aucune ne se voit à l'écran quand elle casse. (a) La LISTE BLANCHE de noms
  (`OUTILS`, la même que `CLI_AUTORISES` sous Obsidian, `ollama` compris : le
  même code partagé appelle les deux hôtes, et un outil accepté d'un côté et
  refusé de l'autre ferait dépendre le sort d'un appel de l'hôte qui
  l'exécute) ; c'est elle, et non le périmètre des chemins, qui rend impossible
  « écris `x.bat` dans un dossier ouvert » + « lance-le », une séquence dont
  chaque moitié est dans les règles. (b) L'ORDRE des deux sources de
  l'exécutable : le réglage `cheminClaude`/`cheminCodex` d'abord, le `PATH`
  étendu ensuite. Inversé, le réglage ne servirait à rien — or on ne le remplit
  QUE parce que la recherche automatique échoue ou trouve la mauvaise
  installation ; et un réglage fautif est rendu TEL QUEL, sans repli sur le
  `PATH`, sinon l'application lancerait en silence une AUTRE installation que
  celle que l'utilisateur a désignée. (c) La CITATION des arguments sur le
  repli `cmd.exe` — le chemin PAR DÉFAUT d'une installation npm, et le seul où
  un interpréteur voit nos arguments : le cas témoin (`a" & echo PWN & "b` +
  un fichier sur disque) est ce qui distingue « bien cité » de « cmd a exécuté
  la charge ». (d) L'ARBRE tué à l'annulation (`taskkill /T /F`, ou le GROUPE
  hors Windows, ce qui suppose `detached: true`) : `claude` et `codex`
  spawnent des enfants, et un `kill` sur le seul parent laisse la génération
  tourner APRÈS le clic sur Stop, avec un process orphelin dans le Gestionnaire
  des tâches. Le cas le prouve par un PETIT-ENFANT qui écrit un fichier 1,5 s
  après sa naissance — l'annulation part dès que le parent a confirmé l'avoir
  lancé, jamais après un délai fixe, et le fichier ne doit jamais exister.
  (e) Le VERROU par outil (`occupe`), relâché sur TOUTES les issues : une fuite
  rend le fournisseur définitivement inutilisable jusqu'au redémarrage, sans
  qu'aucun message ne dise pourquoi — d'où un cas qui rejoue un appel normal
  APRÈS un rejet et après un CLI sorti non nul. S'y ajoutent le `stdin` écrit
  en entier puis FERMÉ (un `claude -p` dont l'entrée reste ouverte attend
  indéfiniment), les flux SÉPARÉS avec le code de sortie, `introuvable` et
  `timeout` NOMMÉS, et le refus d'un signal DÉJÀ abandonné **avant** le
  `spawn` : mesuré, un process lancé puis tué a le temps d'écrire son fichier.
  **Et `run` ne se règle qu'une fois l'arbre MORT (ruling 15, revue de la
  tâche 7)** : un abandon ou un délai dépassé notent un MOTIF et demandent la
  mort, c'est le `close` de l'enfant qui rejette — sinon `run` se réglait avant
  que le système ait tué quoi que ce soit, le verrou était relâché et le
  dossier des pièces jointes effacé pendant qu'un petit-enfant les lisait
  encore. Le cas regarde AU MOMENT du règlement (`process.kill(pid, 0)`
  échoue), pas 2,5 s plus tard. Un FILET rejette quand même après
  `delaiGardeMs` si `close` ne vient pas (un `taskkill` qui échoue, un zombie),
  et le dit : un `run` qui pend est un bouton Stop qui ne rend jamais la main.
  Les deux sont des COUTURES (`tuer`, `delaiGardeMs`), injectées par le
  contrôle — même patron qu'`env`. Mêmes deux cas dans `check:obsidian-host`
  (4e paramètre de `createObsidianHost`, `CouturesCli`). Enfin, CHAQUE cas de
  ce script a un délai de garde (30 s) : un `run` qui n'aboutit jamais rougit
  avec son libellé au lieu de figer la commande — ce qui masquait tous les cas
  suivants, la mort en route que `check:lesson` a déjà payée.
  Deux cas de la revue finale : un CLI qui SORT SANS LIRE son entrée (un prompt
  de 4 Mo sur un `stdin` que l'enfant a déjà fermé) ne tue pas le processus —
  l'`EOF`/`EPIPE` arrive de façon asynchrone sur le flux, et sans écouteur
  `error` sur `stdin` c'est une exception non rattrapée qui emporte le
  processus PRINCIPAL entier, mesuré (sous la rupture, ce cas ne rougit pas : il
  tue le contrôle, ce qui est le défaut lui-même) ; et `ollamaInstalle` cherche
  `ollama` dans le `PATH` ÉTENDU par `resoudreExecutable`/`lancer`, comme `run`
  et comme le greffon — un `spawn("ollama")` nu sur le `PATH` du système disait
  « non installé » dans l'application seulement.
  L'environnement est DÉDIÉ (`APPDATA`, `LOCALAPPDATA`, `CODEX_INSTALL_DIR`
  ABSENTS) : sans quoi le `PATH` étendu réintroduit le VRAI Codex de la machine
  derrière le faux, et le cas lit la réponse du vrai CLI — défaut vécu, ronde 2
  de la tâche 4. Un dernier groupe est STATIQUE, sur la source de `canaux.ts`
  (que nul harnais ne charge, il tire `electron`) : le canal `process.run` juge
  le NOM avant de lancer, et lit le chemin de l'exécutable dans le magasin du
  PRINCIPAL — jamais dans l'appel IPC, faute de quoi la liste de noms ne
  séparerait plus rien. Côté greffon, les mêmes règles sont
  gardées par `check:obsidian-host` (groupe « les CLI ») sur le code qui a
  quitté `src/dashboard/ai-providers.ts` ; côté rendu, `check:windows-host`
  garde le passe-plat : le NOM de l'outil traverse le pont, jamais un chemin.
  **Depuis la tâche 4, il garde aussi les PIÈCES JOINTES** (`avecFichiers`), et
  `check:obsidian-host` les mêmes cas sur l'hôte Obsidian. Le défaut qu'ils
  empêchent est triple. D'abord : `callClaude` glissait les CHEMINS ABSOLUS des
  images dans le prompt (« First read these images… ») et `callCodex` dans ses
  arguments (`-i`, `-o`) ; le rendu n'a ni disque ni chemins, donc le code
  partagé n'envoie plus que des JETONS. Une substitution faite dans les
  arguments mais PAS dans le `stdin` ne rougit à aucun typecheck : Claude
  recevrait « lis - <jeton> », répondrait de la prose, et l'écran dirait « le
  modèle a répondu du texte au lieu d'un quiz ». Ensuite : le dossier
  temporaire doit être effacé en `finally`, sur les DEUX issues qui ne sont pas
  un succès (un CLI qui sort en erreur, un appel rejeté avant tout lancement) —
  un dossier qui survit laisse les images de l'utilisateur dans `%TEMP%` à
  chaque génération, et aucun écran ne le montre jamais. Le contenu du fichier
  est lu DEPUIS l'enfant (ou depuis l'exécutant, côté Électron) : c'est le seul
  moment où il existe encore. Enfin — et c'est la ronde 1 de la revue — **les
  jetons portent un MARQUEUR tiré au sort par appel**
  (`{{nq-<marqueur>:fichier:1}}`) : `stdin` est un texte ENTIÈREMENT écrit par
  l'utilisateur (sa demande, le contenu de ses notes), et une forme fixe
  (`{{home}}`) collisionnait avec toute note citant Handlebars, Jinja ou
  Mustache — le chemin absolu de la machine partait au modèle, libre de le
  recopier dans le quiz réécrit dans une note ; et un `{{fichier:1}}` cité sans
  image jointe faisait REFUSER l'appel, tuant la génération sur un diagnostic
  interne en français dans une interface anglaise. Le cas « un prompt qui cite
  `{{home}}` ou `{{fichier:1}}` ressort INTACT » est le seul filet contre le
  retour à une forme fixe. Un jeton qui ne désigne rien REFUSE au lieu de
  s'effacer, des deux côtés : rendu vide, il donnerait `-o ""` au CLI, un appel
  faux et MUET. **Et des pièces jointes SANS marqueur sont refusées** (tâche 7,
  dans les deux hôtes) : c'est la combinaison la plus traître des trois, parce
  qu'elle produit un appel qui RÉUSSIT. Sans marqueur rien n'est substitué —
  les images seraient écrites, aucun jeton ne pourrait les désigner, le CLI
  partirait sans savoir qu'elles existent, et l'utilisateur recevrait un quiz
  qui IGNORE sa fiche, sans un mot.
  Le script porte enfin un second groupe, **« Jetons de pièces jointes (code
  partagé) »**, sur `src/host/jetons.ts` : la moitié PURE (composer un jeton,
  le substituer, réduire un nom de fichier) est partagée par les deux hôtes
  depuis la ronde 1 — dupliquée, elle avait divergé en une tranche. La tâche 7
  a partagé de la même façon la moitié pure de la LIGNE DE COMMANDE
  (`src/host/cli-args.ts` : `citerPourCmd`, `ligneCmd`, le refus d'un retour à
  la ligne, les extensions de `PATHEXT`) — recopiée dans le principal, la règle
  de citation durcie à la tâche 3 aurait eu deux versions pour un même appel du
  code partagé, dont une seule éprouvée par le témoin de l'injection. Elle n'a
  pas de groupe à elle : elle est éprouvée là où elle SERT, par le cas témoin
  des deux hôtes. Il y tient
  la FORME des jetons, l'unicité du marqueur, le refus d'un marqueur non
  hexadécimal (qui composerait une expression régulière depuis une chaîne
  étrangère) et le fait qu'un chemin contenant `$&` ou `$1` est posé tel quel —
  la réécriture « naturelle » en remplacements par CHAÎNE le corromprait.
  Depuis le chantier « utilisable par n'importe qui » (2026-09-17), il garde
  aussi la RECETTE d'installation de chaque CLI (`scriptInstallation`) :
  l'URL officielle, l'étape de connexion, le rechargement du PATH, et
  l'encodage `-EncodedCommand` : le base64 ne contient que `[A-Za-z0-9+/=]`,
  donc il ne peut refermer ni l'apostrophe de `-ArgumentList` ni le guillemet
  de `-Command` (`argumentsTerminal`). Le canal `processus.installer` est la
  seule capacité du pont qui ouvre une fenêtre : il ne reçoit qu'un nom, jugé
  par `estOutilAutorise`, et une confirmation native du principal précède le
  lancement.
- `npm run check:package` — l'EMPAQUETAGE : la configuration résolue
  d'electron-builder, et le paquet local s'il existe. Défauts empêchés côté
  configuration : depuis que l'application a sa propre version
  (`apps/windows/package.json`, indépendante du greffon, 2026-09-13), un
  lockfile désynchronisé de cette version, `appId` ou
  `executableName` changés « par cohérence » (le premier est la clé de
  registre par laquelle NSIS retrouve l'installation à remplacer),
  `deleteAppDataOnUninstall` à vrai, `node_modules`/sourcemaps dans l'asar —
  et, depuis la préparation de la signature SignPath, `extraMetadata.author.name`
  (`Publisher` de la désinstallation, lu par winget) et
  `signtoolOptions.publisherName` figé à `null` tant que le CN du certificat
  n'est pas connu (une valeur fausse fait refuser chaque mise à jour). Côté
  paquet : depuis que le pipeline recalcule `latest.yml` et le blockmap après
  signature (`scripts/update-info-after-signing.mjs`), le script vérifie en
  plus que l'exe nommé par `latest.yml` existe dans `dist-installer/` et que
  son sha512 (calculé en flux, `node:crypto`) et sa taille sur disque
  correspondent EXACTEMENT à ceux de `latest.yml`, et que le `.blockmap`
  existe — c'est le seul contrôle qui rougit si l'exe a été remplacé (par sa
  version signée, ou par erreur) sans repasser par ce script. Il vérifie
  aussi que `app-update.yml`, embarqué dans le paquet, pointe le fournisseur
  `github` sur `ahmed-mili/neo-quiz` — sans quoi electron-updater n'aurait
  aucun flux à lire une fois installé.
- `npm --prefix apps/windows run typecheck:electron` — le typecheck du PROCESSUS
  PRINCIPAL Electron (`apps/windows/tsconfig.electron.json`), lancé par
  `npm run build` de ce dossier, donc par `npm run check:app`. Il referme un trou
  que les rapports des tâches 1 et 2 de la migration ont signalé chacun leur tour :
  AUCUN `tsconfig` du dépôt ne couvrait `apps/windows/electron/` — ni celui de la
  racine (`src/` + `apps/obsidian/`), ni celui de l'application (son `src/` seul).
  Trois fichiers déjà écrits n'étaient donc typés par aucun `npm run check*`, et
  `check:electron-fs`/`check:electron-index` les chargent par esbuild, qui ne
  vérifie AUCUN type. Une configuration SÉPARÉE de celle du rendu, et pas une
  entrée de plus dans la sienne : le rendu tourne dans Chromium et le principal
  dans Node, les mélanger laisserait le rendu appeler `node:fs` sans rougir.
- `npm run check:lesson` — la boucle d'apprentissage (rôles `pre`/`read`/`recall`/`test`,
  tranches, auto-évaluation). **Il doit aller jusqu'au bout** : ce script MEURT sur une
  exception au lieu d'échouer proprement, et une mort en cours de route masque en
  silence tous les groupes qui suivent (c'est arrivé, onze groupes cachés).
- `npm run report:multiblock` — ne vérifie rien, MESURE deux limites connues de
  l'ordonnanceur (notes à plusieurs blocs, notes quiz `source:`) pour qu'elles restent
  visibles au lieu de se redécouvrir. Sort toujours en 0.
- `npm run check:scanner` — charge le vrai `createScanner` et protège l'alignement des
  identifiants avec l'éditeur, les métadonnées légères et les suppressions du cache sur
  bloc absent, invalide ou vide. Il existe parce qu'une clé décalée perdrait l'historique
  de révision et qu'un autosave transitoirement invalide ne doit ni garder une ancienne
  entrée ni polluer la console.
- `npm run check:markers` — passe chaque champ TEXTE de chaque quiz des vaults par la
  vraie fonction de rendu et cherche le markdown qui n'a PAS été traduit (8570 champs
  au 2026-07-31, zéro fuite). Il éprouve la GRAMMAIRE, pas le CÂBLAGE : un champ que
  le moteur affiche sans appeler le rendu du tout y passe pour sain — c'est ce qui
  était arrivé au libellé d'emplacement d'un classement. Le seul filet contre ça est
  de lire le DOM RENDU dans Obsidian ; la commande est dans l'en-tête du script.
- `node scripts/audit-vaults.mjs "<vault>" […]` — **avant une release**, ou après
  toute retouche de `convertParsedToInternal` / `exportAll` : fait l'aller-retour
  lecture → écriture → lecture sur TOUS les quiz de vrais vaults (39 quiz, 756
  questions au 2026-09-04). Deux garanties, pas une :
  1. le bloc réécrit **se relit** — sinon la sauvegarde échoue EN SILENCE chez
     l'utilisateur (la page refuse d'écrire un JSON5 invalide, et le travail reste
     en mémoire jusqu'à la fermeture d'Obsidian) ;
  2. **aucun champ ne disparaît**, comparé un à un. C'est ce deuxième contrôle qui
     a trouvé le pire défaut de la refonte : `textVariant: 'command'` n'était pas
     reconnu par l'éditeur, et éditer un quiz Cisco effaçait ses 23 invites de
     terminal. Les équivalences admises (`prompt` → `promptHtml`, `answer` fondu
     dans `acceptedAnswers`…) sont **justifiées une par une** dans le script ;
     n'y ajouter une exclusion qu'après avoir prouvé qu'il n'y a rien à perdre.
  Aucun fichier n'est modifié.
- Ces scripts appellent `process.exitCode`, **jamais `process.exit()`** : la pile doit
  se dérouler pour que `withSrcModule` retire son dossier temporaire.
- `npm run dev` — esbuild en watch : rebuild + redéploiement à chaque save (JS et CSS).
- `npm run build` — build production → `dist/` + déploiement dans les vaults.
- **Release** : bumper la version dans `src/assets/manifest.json`, créer un tag
  `git tag vX.Y.Z`, `git push` du tag → le workflow `release.yml` build et publie.
  (Ne pas utiliser `npm run release` : il pointe vers un `scripts\release.bat` absent.)

Vérification d'un changement = `npm run check`, plus `check:md` / `check:export` /
`check:markers` si le rendu ou l'écriture sont touchés, **puis** test manuel dans
Obsidian.
