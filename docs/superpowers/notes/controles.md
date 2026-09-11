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
  Il annonce le nombre de fichiers encore liés — **33** aujourd'hui. Il couvre les
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
  de l'état de l'autre liste.
- `npm run check:theme` — exhaustivité du thème de l'app (`apps/windows/src/theme/
  host-vars.css`) : le greffon hérite des variables CSS d'Obsidian, l'app doit les
  définir. Une oubliée ne produit AUCUNE erreur — un texte invisible sur un fond de la
  même couleur. Symétrique, comme le cliquet : une variable devenue morte dans le thème
  doit en être retirée. Dans la CI aussi.
- `npm run check:obsidian-host` et `check:windows-host` — les deux implémentations du
  contrat `src/host/types.ts`, chargées avec une fausse `App` / un faux index. Une
  méthode d'hôte qui rend `null` en silence rendrait les images, le bouton ressource ou
  la sauvegarde inertes sans un mot. Chaque cas neuf doit être éprouvé par DISCRIMINANCE
  (casser la règle, voir rougir, restaurer) : un cas qui passe au vert quoi qu'on fasse
  ne prouve rien — c'est arrivé deux fois ici. `check:windows-host` couvre en plus les
  RACINES du dossier composite : `local()` et `contrat()` doivent se composer en
  identité (aller-retour sans perte), et une résolution de lien par nom ne doit jamais
  franchir la racine de la note qui cite — sans cette borne, une image du dossier A
  se servirait, en silence, à une note du dossier B.
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
  nourrit le périmètre. **Le résiduel, dit tel quel** : la liste est PILOTÉE
  PAR LES RÉGLAGES, et la clé `ai` n'est pas encore GARDÉE à l'écriture comme
  `folders` l'est (`reglagesEcrire`) — un rendu compromis peut donc y écrire
  `{ aiOllamaUrl: "https://attaquant.example" }` et obtenir cet hôte AU
  PROCHAIN LANCEMENT ; la garde se construit à la tâche 6, la première qui
  écrit cette clé (http(s) obligatoire, confirmation native pour un hôte hors
  liste et hors réseau local, hôte accepté admis aussitôt). Deux autres
  résiduels sont admis et nommés dans `reseau.ts` : `net.fetch` SUIT les
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
  n'est pas sur le PATH d'une application de bureau — et le rejet NOMMÉ de
  `run` (`indisponible`) tant que la tâche 7 ne l'a pas implémenté : un
  `stdout` vide passerait pour une génération qui a tourné pour rien. La
  tâche 7 étend ce script avec les cas à vrais process (stdin écrit puis fermé,
  flux séparés, arbre tué à l'annulation). Côté greffon, les mêmes règles sont
  gardées par `check:obsidian-host` (groupe « les CLI ») sur le code qui a
  quitté `src/dashboard/ai-providers.ts` ; côté rendu, `check:windows-host`
  garde le passe-plat : le NOM de l'outil traverse le pont, jamais un chemin.
  **Depuis la tâche 4, il garde aussi les PIÈCES JOINTES** (`avecFichiers`), et
  `check:obsidian-host` les mêmes cinq cas sur l'hôte Obsidian. Le défaut
  qu'ils empêchent est double. D'abord : `callClaude` glissait les CHEMINS
  ABSOLUS des images dans le prompt (« First read these images… ») et
  `callCodex` dans ses arguments (`-i`, `-o`) ; le rendu n'a ni disque ni
  chemins, donc le code partagé n'envoie plus que des jetons
  (`{{fichier:N}}`, `{{dossier}}`, `{{sortie}}`, `{{home}}`). Une substitution
  faite dans les arguments mais PAS dans le `stdin` ne rougit à aucun
  typecheck : Claude recevrait « lis - {{fichier:1}} », répondrait de la prose,
  et l'écran dirait « le modèle a répondu du texte au lieu d'un quiz ». Ensuite :
  le dossier temporaire doit être effacé en `finally`, sur les DEUX issues qui
  ne sont pas un succès (un CLI qui sort en erreur, un appel rejeté avant tout
  lancement) — un dossier qui survit laisse les images de l'utilisateur dans
  `%TEMP%` à chaque génération, et aucun écran ne le montre jamais. Le contenu
  du fichier est lu DEPUIS l'enfant (ou depuis l'exécutant, côté Électron) :
  c'est le seul moment où il existe encore.
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
