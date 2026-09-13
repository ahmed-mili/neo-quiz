# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vue d'ensemble

Plugin Obsidian qui transforme des blocs de code ` ```quiz-blocks ` (tableau JSON5)
en quiz interactifs : rendu avec transitions, éditeur visuel, mode examen, génération
IA. 100 % TypeScript strict (ESM). **Commentaires en français** ; **UI traduite**
(anglais par défaut, cf. « Langue » ci-dessous) — le plugin vise la liste
communautaire d'Obsidian.

## Langue (i18n)

- **Jamais de chaîne visible en dur** dans le code : tout passe par `t("<domaine>.<clé>")`
  de `src/i18n.ts`. L'**anglais** (`src/i18n/en/*.ts`) est le dictionnaire de
  RÉFÉRENCE ; le français (`src/i18n/fr/*.ts`) est typé `Record<keyof typeof EN_X, string>`
  → une traduction oubliée est une **erreur de compilation**, pas un texte anglais
  qui fuit dans l'UI française.
- Un dictionnaire **par domaine** (`settings`, `ai`, `dashboard`, `editor`, `engine`,
  `plugin`), agrégé dans `src/i18n/{en,fr}.ts`. Nouveau domaine = un import de plus.
- Réglage `language` : `auto` (défaut) | `en` | `fr`. `auto` lit **`window.i18next.language`**
  (la langue d'OBSIDIAN, pas celle de l'OS ; API interne absente d'`obsidian.d.ts` →
  repli sur `<html lang>` puis l'anglais).
- **PIÈGE** : `t()` doit être appelé **AU RENDU**. Une chaîne traduite dans une
  constante top-level est figée à la langue du démarrage et ignore le changement de
  langue → transformer la constante en fonction (c'est pourquoi `TUTORIALS` est une
  fonction, pas un objet).
- **Ne JAMAIS traduire** : les clés du format quiz (`title`, `prompt`, `options`,
  `correctIndex`, `answer`, `learn`…), les types (`single`/`multiple`/`text`/
  `ordering`/`matching`), `mode: "exam"` — ce sont des **données persistées** dans les
  notes ; les traduire casserait tous les quiz du vault. Ni les `id:` de commandes
  (les hotkeys de l'utilisateur y sont attachées), ni les logs, ni les classes CSS.
- **Langue des quiz générés ≠ langue de l'UI** : le prompt système impose au modèle de
  répondre dans la langue de la DEMANDE de l'utilisateur.

## Commandes

Le DÉTAIL — le défaut réel que chaque contrôle empêche — vit dans
`docs/superpowers/notes/controles.md`. Le lire avant d'en contourner un.

- `npm run check` — typecheck. Toujours après une modif TS.
- `npm run check:host` — **le cliquet de la frontière d'hôte**, SIX assertions :
  aucun fichier de `src/` n'importe Obsidian hors de la liste `RESTANTS`, laquelle
  ne peut que RÉTRÉCIR ; rien sous `apps/windows/` ; aucun fichier déjà libéré
  n'emploie les **extensions DOM** d'Obsidian (`createEl`, `empty`, `setText`…),
  qu'aucun `import` ne trahit — passer par `ajouter` de `src/dom.ts` ; **aucun
  fichier de `src/` n'importe depuis `apps/`** (le code partagé ne connaît pas ses
  hôtes), sauf les fichiers nommés dans `EXCEPTIONS_APPS` — `src/dashboard.ts`,
  la seule ; la liste est un CLIQUET comme
  `RESTANTS` : une entrée qui n'importe plus rien d'`apps/` fait échouer le
  contrôle au lieu de couvrir la violation suivante ; et **le rendu de l'app (`apps/windows/src/`) n'importe
  jamais un module qui tire Node** — `node:*`, `chokidar`, `electron`, ni un
  module de `apps/windows/electron/` hors de `SANS_NODE` (`catalogue`,
  `ressources`, `pont`, eux-mêmes vérifiés purs). Vite EXTERNALISE `node:fs` avec un
  simple avertissement et `check:app` reste vert : sans cette assertion, un
  `import { readFile } from "node:fs"` dans le rendu ne rougissait nulle part, et
  `perimetre.ts` importé du rendu recréait côté Chromium l'accès disque total que
  le pont existe pour retirer. Il annonce le nombre de fichiers encore liés
  (**6** — la tranche 5 a libéré la page « Générer » et `hotkey-format.ts` ;
  les deux derniers de `src/dashboard/` sont `ai-usage.ts` et `usage-modal.ts`,
  l'ÉCRAN D'USAGE, qui reste au greffon par décision et non par reste). Dans la
  CI : lancé à la main, ce serait la discipline et non le contrôle qui
  tiendrait la frontière.
- `npm run check:dashboard-dom` — **le cliquet ne suffit pas seul** : `check:host`
  ne protège un fichier de ses extensions DOM que TANT QU'il reste hors de
  `RESTANTS`. Rien n'empêche qu'une tranche future y remette
  `import { setIcon } from "obsidian"` « pour aller vite » et le fasse RENTRER
  dans `RESTANTS` — ses extensions DOM redeviendraient alors invisibles, sans
  qu'aucun contrôle ne le dise. Ce script nomme, en dehors de `RESTANTS`, les
  pages du tableau de bord portées en tranche 2.5 : sa liste ne peut que
  GRANDIR, jamais rétrécir.
- `npm run check:theme` — le thème de l'app définit toutes les variables CSS
  qu'Obsidian fournissait. Une oubliée ne produit AUCUNE erreur : un texte
  invisible sur un fond de la même couleur. Symétrique et dans la CI.
- `npm run check:obsidian-host`, `check:windows-host` — les deux implémentations du
  contrat `src/host/types.ts`. Tout cas neuf s'éprouve par DISCRIMINANCE : casser
  la règle, voir rougir, restaurer. Un cas vert quoi qu'on fasse ne prouve rien.
- `npm run check:app` — typecheck + build de l'app, RENDU ET PROCESSUS PRINCIPAL
  Electron (deux `tsconfig` séparés, deux sorties : `dist/` et `dist-electron/`).
  Il attrape une rupture du code PARTAGÉ vue depuis l'autre hôte, là où
  `npm run check` ne voit que le greffon — et depuis la tranche Electron, c'est
  le SEUL contrôle qui type `apps/windows/electron/` (`tsconfig.electron.json`).
  Aucun fichier qu'il atteint ne doit tirer `obsidian.d.ts` : un `import type`
  suffisait à neutraliser ce filet.
- `npm run check:electron-fs` — les primitives de fichiers du processus principal
  Electron (`apps/windows/electron/fichiers.ts`), sur un vrai dossier temporaire.
  Empêche entre autres qu'un `append` non atomique perde un ajout concurrent au
  journal de révision, ou qu'un `trash` supprime au lieu de déplacer.
- `npm run check:electron-index` — le surveillant chokidar débouncé et l'index du
  processus principal (`apps/windows/electron/index-fichiers.ts`). Empêche qu'un
  renommage rapide, hors des événements que chokidar sait nommer lui-même, fasse
  perdre l'historique d'une note.
- `npm run check:electron-reglages` — les réglages, les vaults Obsidian déclarés et
  le PÉRIMÈTRE de sécurité du pont Electron (`reglages.ts`, `vaults.ts`,
  `perimetre.ts`, plus les prédicats purs de `ressources.ts`). Le périmètre est la
  règle la plus importante du pont : sans lui, chaque canal `fichiers.*` est un
  accès disque total depuis la fenêtre. Et il ne borne que l'écriture et la
  lecture, pas l'EXÉCUTION : `systeme.ouvrir` refuse en plus les extensions
  exécutables (`EXTENSIONS_EXECUTABLES`), sans quoi `write` puis `ouvrir` d'un
  `.bat` — deux appels bornés — le contournaient. La clé `ai` des réglages est
  GARDÉE de la même façon (`garde-ia.ts`) : l'hôte d'`aiOllamaUrl` entre dans la
  liste du réseau, et `cheminClaude`/`cheminCodex` désignent un exécutable que le
  principal LANCERA — absolu, existant, extension lançable (un `.js` qui existe
  pour de bon est refusé : ce serait « écris-le puis lance-le »).
- `npm run check:electron-process` — les fichiers de cache des CLI ET le
  LANCEMENT d'un CLI (`apps/windows/electron/process.ts`), sur de vrais process.
  C'est la capacité la plus dangereuse du pont : la liste blanche de NOMS
  (jamais un chemin venu du rendu), l'ordre réglage-puis-`PATH`, la citation des
  arguments sur le repli `cmd.exe`, l'ARBRE tué à l'annulation (un `kill` sur le
  seul parent laisse la génération tourner après le clic sur Stop), et le verrou
  par outil relâché sur TOUTES les issues.
- `npm run check:package` — la configuration RÉSOLUE d'electron-builder (version
  = manifeste, `appId` et `executableName` immuables, `files` sans
  `node_modules` ni sourcemaps, `deleteAppDataOnUninstall` faux) et, si un
  `win-unpacked/` existe, le contenu de l'asar. `appId` est la clé par laquelle
  NSIS retrouve l'installation à remplacer ; `executableName` dérivé de
  `@neo-quiz/windows` a fait échouer chaque run CI Linux jusqu'au 2026-09-12.
- `npm run check:updater` — le noyau pur de la mise à jour automatique
  (`apps/windows/electron/mise-a-jour-etat.ts`) : une erreur après « prête »
  ne retire pas le paquet téléchargé, couper le réglage oublie une
  vérification en cours mais garde « prête ». Le câblage electron-updater
  (`mise-a-jour.ts`) ne s'éprouve qu'installé, sur deux releases.
- `npm run check:menu-app` — l'arbre pur du menu d'application (identifiants
  uniques, paliers d'échelle bornés comme le principal, coche sur le zoom
  courant).
- `npm run check:reprise` — le noyau pur de « rouvrir là où on s'était arrêté »
  (`apps/windows/src/ui/reprise.ts`, `lireDerniereVue`) : une valeur brute
  antérieure ou trafiquée (vue inconnue, quiz manquant sur `detail`, question
  négative ou non entière) retombe sur `null` plutôt que de faire planter le
  démarrage.
- `npm run check:fond` — le noyau pur du fond d'écran
  (`apps/windows/src/ui/fond-pur.ts`) : quelles extensions comptent comme une
  image de fond, et l'ordre trié cyclique de « l'image suivante » — avec son
  repli sur la première quand la courante a disparu du disque.
- `npm run check:math-render` — la segmentation LaTeX partagée (`$$…$$` avant `$…$`).
- `npm run check:ai-providers` — les FOURNISSEURS IA : le catalogue cloud vient
  de `net.fetchJson` (jamais codé en dur), un `/api/tags` qui répond 200 SANS
  JSON (portail captif, proxy) vaut hors ligne et non « Ollama joignable, 0
  modèle », et `refreshCliCaches` remplit bien l'instantané que les deux
  lecteurs SYNCHRONES (`getCodexModels`, `isFableOffered`) lisent — sans quoi le
  menu resterait à jamais sur son repli embarqué, sans une erreur.
- `npm run check:md`, `check:export` — rendu markdown des champs texte, écriture
  d'un bloc. Ils chargent le CODE RÉEL, jamais une réplique. **Pas de framework de
  test au-delà** ; ne pas en ajouter pour du code qu'une lecture suffit à juger.
- `npm run check:scheduler` — le noyau de l'ordonnanceur, dont la pureté est
  vérifiée MÉCANIQUEMENT. Le casser, c'est perdre la seule partie du code qu'on ne
  réécrira pas.
- `npm run check:review-store`, `check:engine-review`, `check:module-edit` — les
  trois câblages de l'ordonnanceur.
- `npm run check:quiz-io` — **le CÂBLAGE de l'écriture d'un bloc**, le seul
  chemin par lequel la page réécrit une note. Entre `check:export` (la FORME du
  bloc produit) et `audit-vaults.mjs` (l'aller-retour sur de vrais vaults), il n'y
  avait RIEN : ni le compare-and-swap sur le bloc, ni la préservation des fins de
  ligne, ni celle des clôtures, ni le remplacement par FONCTION qui protège un
  quiz contenant `$1$`. Les quatre sont des correctifs de bugs réels, et deux
  avaient régressé la nuit même où ils furent écrits.
- `npm run check:review-log` — l'emplacement et la migration du journal de révision.
- `npm run check:folders` — la conversion `folder` → `folders`, et l'unicité des
  identifiants de dossier.
- `npm run check:rename-match` — l'appariement d'un renommage entre deux hôtes,
  sur preuve et non sur ressemblance.
- `npm run check:lesson` — la boucle d'apprentissage. **Il doit aller jusqu'au
  bout** : il MEURT sur une exception au lieu d'échouer proprement, et une mort en
  route masque en silence tous les groupes suivants (onze cachés, une fois).
- `npm run check:scanner` — le catalogue. Une clé décalée perdrait l'historique de
  révision.
- `npm run check:markers` — le markdown non rendu dans les vrais vaults. Il éprouve
  la GRAMMAIRE, pas le CÂBLAGE : un champ affiché sans appeler le rendu du tout y
  passe pour sain. Le seul filet contre ça est de lire le DOM RENDU.
- `npm run report:multiblock` — ne vérifie rien, MESURE deux limites connues. Sort
  toujours en 0.
- `node scripts/audit-vaults.mjs "<vault>" […]` — **avant une release**, ou après
  toute retouche de `convertParsedToInternal` / `exportAll`. Aller-retour lecture →
  écriture → lecture sur de vrais vaults : le bloc réécrit se relit, et aucun champ
  ne disparaît. Aucun fichier n'est modifié.
- Ces scripts appellent `process.exitCode`, **jamais `process.exit()`** : la pile
  doit se dérouler pour que `withSrcModule` retire son dossier temporaire.
- **Juger un script sur son CODE DE SORTIE, jamais sur la fin de sa sortie** : un
  groupe vert peut suivre trois groupes rouges. C'est ainsi qu'un défaut est passé.
- `npm run dev` / `npm run build` — greffon, watch ou production (déploie dans les
  vaults). `npm run app:dev` / `app:build` — l'application Windows.
- **Release** : bumper `src/assets/manifest.json`, `git tag vX.Y.Z`, pousser le tag →
  `release.yml` publie. (Pas `npm run release` : il pointe vers un fichier absent.)

Vérification d'un changement = `npm run check`, plus `check:md` / `check:export` /
`check:markers` si le rendu ou l'écriture sont touchés, **`check:quiz-io` dès que
`dashboard/detail-io.ts` bouge** (c'est le seul chemin qui réécrit une note),
`check:app` si le code partagé bouge, **puis** test manuel dans Obsidian.

## Build & déploiement (`esbuild.config.mjs`)

- **Un plugin = 3 fichiers** : `dist/main.js`, `dist/styles.css`, et
  `src/assets/manifest.json`.
- **Déploiement auto** : le build copie ces fichiers dans chaque
  `C:\obsidian-vaults\*\.obsidian\plugins\quiz-blocks` déjà existant. Override par la
  variable d'env `VAULT_PLUGIN_DIR`. Si aucun vault n'est détecté, la sortie reste
  dans `dist/` — **pas de fallback `["."]`** (n'écrit jamais les artefacts dans le repo).
- **CSS** : bundlé depuis `src/assets/css/index.css` (arbre de `@import`). Les fontes
  MathLive (~300 Ko) sont inlinées en data-URI via le loader esbuild → pas de CDN.
- **main.js** : format `cjs`, `target es2020`, `external: ["obsidian", "electron"]`.

## Boucle de dev (appliquer une modif dans Obsidian)

`build` **déploie** `main.js` (« Reload without saving » ne suffit pas toujours) :
- CSS → désactiver/réactiver le plugin.
- Vue JS (dashboard, onglet d'un quiz) → refermer/rouvrir la vue.
- Sûr → redémarrage complet d'Obsidian, ou recharger via le CLI Obsidian
  (`obsidian plugin:reload id=quiz-blocks`).

## Structure du dépôt : un code partagé, plusieurs hôtes

- `src/` — **le code partagé**, qui ne connaît AUCUN hôte. Il demande à son
  environnement ce dont il a besoin via le contrat `src/host/types.ts` (`HostFs`,
  `HostLinks`, `HostWatcher`, `HostUi`, `HostMath`, `HostShell`, `HostPlatform`,
  `HostPaths`), obtenu par `currentHost()` (`src/host/current.ts`). Même patron que
  `src/review/review-store.ts` pour l'ordonnanceur, généralisé — et **mécanique** :
  `npm run check:host` refuse toute nouvelle dépendance à Obsidian ici.
- **`src/review/`** est le journal de révision, **partagé par les deux hôtes** : ce
  n'est plus l'adaptateur jetable du tableau de bord, et le chantier 4 ne
  l'emporte pas avec lui (voir le point suivant : ce n'est plus le seul rescapé).
- **`src/dashboard/` n'est plus, lui non plus, entièrement supprimable au
  chantier 4.** La tranche 2.5 y a laissé survivre du code PARTAGÉ : ses sept
  modules d'interface portés (rail, accueil, page « Mes quiz », cartes, sections
  repliables), `stats-store.ts`, `scanner.ts`, et les trois modules purs nés du
  portage (`module-map-note.ts`, `folder-archive.ts`, `module-icons.ts`) —
  `npm run check:dashboard-dom` les protège d'un retour en arrière. Ceci
  **contredit** la spec de l'ordonnanceur (`docs/superpowers/specs/
  2026-09-02-scheduler-design.md`, §3 : « l'adaptateur vit dans `dashboard/`
  **par choix** : c'est le dossier que le chantier 4 supprime ») — cette phrase
  ne visait que l'adaptateur (déjà sorti vers `src/review/`), mais elle laissait
  entendre que le RESTE de `dashboard/` disparaîtrait avec lui lors du chantier 4.
  Ce n'est plus vrai : le chantier 4 devra CONTOURNER une partie de `dashboard/`,
  pas la prendre en bloc. Les deux affirmations ne sont pas mises à jour l'une
  dans l'autre ; celle-ci, la plus récente, l'emporte.
- `apps/obsidian/` — le greffon. `main.ts` → `plugin.ts` (`InteractiveQuizPlugin
  extends Plugin`) et `host.ts`, la seule implémentation du contrat qui a le droit
  d'importer Obsidian, et **le seul endroit du dépôt où un `TFile` devient un
  `HostFile`** (une conversion recopiée à la main diverge en silence).
- `apps/windows/` — l'application Windows (Electron + Vite). Elle consomme `src/` **par
  chemin relatif**, sans jamais copier un fichier : une copie divergerait sans un mot.
  Son thème est `src/theme/host-vars.css`. **L'hôte est SCINDÉ en deux, depuis la
  tâche 4 de la migration Tauri → Electron** : `apps/windows/src/host/*.ts` implémente
  le contrat côté RENDU (Chromium, sans Node) ; `apps/windows/electron/*.ts`
  (`main.ts` la fenêtre, `canaux.ts` les gestionnaires IPC — là où `borner`
  s'applique —, `pont.ts`, `preload.ts`, `fichiers.ts`, `perimetre.ts`,
  `reglages.ts`, `vaults.ts`, `index-fichiers.ts`, `parcours.ts`, `catalogue.ts`,
  `ressources.ts`) est le processus PRINCIPAL, seul endroit du
  dépôt qui touche le disque directement et qui tient le PÉRIMÈTRE de sécurité (un
  chemin hors des dossiers ouverts, un `..`, une jonction qui pointe dehors). Le
  rendu ne parle au principal que par `window.neo`, le pont IPC typé posé par
  `preload.ts` — **le rendu ne doit JAMAIS importer un module qui tire Node**
  (`node:fs`, `chokidar`…) : ce serait recréer, côté Chromium, l'accès disque total
  que le périmètre existe pour retirer côté principal. Seuls `catalogue.ts`,
  `ressources.ts` et `pont.ts` (sans Node) sont importables du rendu ; `npm run
  check:host` le tient mécaniquement (assertion 6, liste `SANS_NODE`).
- Une troisième application Android viendra ; elle n'aura à écrire qu'un hôte.

## Architecture (le point important)

Point d'entrée du greffon : `apps/obsidian/main.ts` → `apps/obsidian/plugin.ts`
(`InteractiveQuizPlugin extends Plugin`).
`plugin.ts` porte le `SettingTab`, les settings persistés + leurs migrations, installe
l'hôte (`installHost` en tête d'`onload`, `uninstallHost` en fin d'`onunload`), et
enregistre : le processeur de bloc `quiz-blocks` (→ moteur), la vue dashboard, la vue
onglet d'un quiz (`quiz-blocks-builder`).

Les **deux sous-systèmes d'INTERFACE** suivent le **même pattern** : une factory
`createXHandlers(ctx)` par module, et un **god-object `ctx` typé**, assemblé en
plusieurs passes puis injecté dans toutes les factories (référence croisée). Le param
d'appel externe est nommé `context`, le god-object interne `ctx` — jamais confondus
(ni avec le `MarkdownPostProcessorContext` d'Obsidian).

1. **Moteur de rendu** — `src/engine.ts` + `src/engine/*.ts` (17 modules).
   `renderInteractiveQuiz(context)` construit le `ctx` (type `EngineCtx`, la plus
   grosse interface du projet), instancie les 17 factories, puis les greffe et
   **aplatit ~55 méthodes** sur `ctx` via `Object.assign`. Le type
   `src/types/engine-ctx.ts` est documenté par **plages de lignes** de `engine.ts`.
   - **Distinction critique SNAPSHOT vs ACCESSOR** : les flags `__quiz*` sont copiés
     **par valeur** (figés à l'assemblage) ; l'état **vivant** se lit via des accessors
     de closure (`isDestroyed()`, `currentAsyncEpoch()`, `getSlideGeneration()`).
   - Rendu = une piste transformée en `translateX` ; hauteur synchronisée par
     `ResizeObserver` + « warming » (préchauffage des slides voisines).
   - Le cycle de vie est lié au `MarkdownRenderChild` : `destroyQuiz()` en `onunload`
     retire listeners/observers/timers (sans ça, chaque re-render fuit une instance).

2. **Dashboard** — `src/dashboard.ts` + `src/dashboard/*.ts`. `ItemView` 2 colonnes
   (Accueil / Mes quiz / Détail / Générer). Ici le `ctx` (`DashboardCtx`) est **petit** :
   les 5 handlers (`nav`, `home`, `quizzes`, `detail`, `ai`) sont greffés sur la **vue**
   (`this`), pas sur `ctx`. `types/dashboard-ctx.ts` scinde donc `DashboardCtx` (le
   littéral) et `DashboardView` (l'hôte `this`).

**La page « quiz » est UNIQUE** (`dashboard/detail.ts`, `createQuizPage(deps)`) :
questions à gauche, question courante à droite, bouton « Editor » qui bascule
consultation ⇄ édition **sur place**. Décrite par une `QuizPageSpec` (titre,
`load()`, `save?()`, retour, bouton principal), elle sert **trois hôtes** : la vue
détail du dashboard, la page « Générer » (brouillon sans note jusqu'à son
enregistrement automatique, `QuizDraft.file === null`) et l'onglet
`quiz-blocks-builder` (`src/editor.ts`).
L'**éditeur en trois colonnes a été supprimé** le 2026-07-31 (« pas assez
intuitif ») : il ne reste de `src/editor/` que ce que la page consomme —
`editor-form.ts` (les champs par type, atteints via `dashboard/detail-form-bridge.ts`),
`convert.ts`, `export.ts`, `question-preview.ts`, `utils.ts`, `modals.ts`.
`types/editor-ctx.ts` ne décrit donc plus qu'un contrat étroit (7 champs) — **ne pas
l'élargir**, c'est cette étroitesse qui rend le formulaire réutilisable.

**Données partagées** : `dashboard/scanner.ts` (index des quiz du vault, avec
`onChange`) et `dashboard/stats-store.ts` (stats + accès aux settings). Types métier
des questions : `src/types/quiz.ts` (variantes `single` / `multiple` / `text` /
`ordering` / `matching`, + `ExamOptions`). Parsing JSON5 : `src/quiz-utils.ts`
(`parseQuizSource`, `extractExamOptions`).

## Ordonnanceur de révision (`src/scheduler/`) — le code qu'on ne jettera pas

Troisième sous-système, et le seul qui ne suit PAS le patron `ctx` : c'est un **noyau
pur**. Étant donné l'historique des réponses et un horizon de rétention, il décide
quelles questions sont dues aujourd'hui et dans quel ordre les poser.

**La règle qui gouverne tout** : `src/scheduler/` ne connaît ni Obsidian, ni écran, ni
horloge, ni calendrier, ni locale. `now` et `dayStart` sont des ENTRÉES. La feuille de
route (`docs/superpowers/specs/2026-09-02-roadmap-produit.md`) fait de ce module la
seule partie réutilisée telle quelle par les futures applications PC et Android : toute
dépendance introduite ici se paiera deux fois. `npm run check:scheduler` le vérifie
mécaniquement ; la preuve complémentaire, qui couvre les imports transitifs, est
`npx esbuild src/scheduler/index.ts --bundle --platform=neutral` sans avertissement.
**L'unité portable est `src/scheduler/` PLUS `src/types/quiz.ts`** (importé pour
`QUESTION_ROLES`), pas le dossier seul.

- **L'état n'est jamais persisté, il est DÉRIVÉ** d'un journal JSONL en ajout seul
  (`<racine>/.neo-quiz/review-log.jsonl`, partagé par les deux hôtes depuis la
  tranche 2 — voir `src/review/paths.ts`). Changer un paramètre rejoue tout
  l'historique ; rien à migrer, rien à désynchroniser. Le format se paie en
  propriétés gratuites : tolérance à la troncature, deux fenêtres qui écrivent
  sans se corrompre.
- **Une seule règle d'identité** (`src/quiz-ids.ts`, `assignQuestionIds` /
  `idsForRawItems`), partagée par le scanner, l'éditeur et le moteur. Une clé qui diverge
  d'un lecteur à l'autre rend une question éternellement neuve : elle revient tous les
  jours sans jamais pouvoir sortir de « À réviser ». Ne jamais recomposer une clé depuis
  `q.id`.
- **`src/review/review-store.ts`** absorbe tout ce qui est spécifique à un hôte
  (octets, fuseau, événements de renommage, dates saisies) pour que le noyau n'en
  voie rien — voir « Structure du dépôt » ci-dessus pour son statut de fichier
  partagé, plus jetable depuis la tranche 2.
- **Limites connues et mesurées**, pas des oublis : `npm run report:multiblock`. Le
  scanner n'indexe que le PREMIER bloc d'une note, et une note quiz `source:` journalise
  sous son propre chemin, absent du catalogue. Corriger l'une ou l'autre change le format
  de clé, donc l'historique déjà écrit — décision de conception, pas correctif.

## Génération IA (`dashboard/ai*.ts`)

Via **CLIs locaux, jamais de clé API** : Claude Code CLI (abonnement), Codex CLI
(ChatGPT), Ollama (local + cloud). `ai-client.ts` passe par le CONTRAT
(`host.process.run` pour les CLI, `host.net.fetchJson` pour Ollama) ; c'est
l'hôte qui lance et qui tue l'arbre de processus. Les **modèles sont lus
dynamiquement** (cache des CLIs, catalogue `ollama.com`), **jamais codés en dur** — voir
mémoire projet `codex-models-dynamic` et `ollama-latest-version-only`.

**La page « Générer » sert les DEUX hôtes** depuis la tranche 5 (tâche 6) :
`createAiHandlers(deps: AiPageDeps)` ne reçoit plus ni `plugin` ni `app` — les
réglages arrivent par un `AiSettingsHost` (`dashboard/ai-settings-host.ts`, dont
`aiSettingsDefaults()` est la SEULE liste de défauts, lue par le greffon comme
par l'app), et trois membres sont OPTIONNELS parce que l'application ne les a
pas : `openFiles` (pas d'onglets), `usage` (l'écran d'usage reste au greffon —
`ai-usage.ts` lit le trousseau du CLI et `usage-modal.ts` est une `Modal`) et
`renderCodeBlock` (sans lui, un `<pre><code>` nu). **Le texte d'un PDF joint est
un membre OPTIONNEL du contrat** (`HostPdf`) : le greffon le sert par le pdf.js
embarqué d'Obsidian, l'application ne l'a pas et REFUSE le PDF
(`ai.error.pdfUnsupportedInApp`) plutôt que d'en joindre le vide.

**La clé `ai` des réglages de l'application est GARDÉE dans le processus
principal** (`electron/garde-ia.ts` pour le verdict pur, `canaux.ts` pour la
porte native) : `aiOllamaUrl` doit être en `http(s)`, un hôte hors de la liste
du réseau et hors réseau local demande une confirmation NATIVE, et
`aiMentionExtraFolders` doit déjà être au périmètre. Sans elle, un rendu
compromis obtenait un hôte Internet dans la liste au lancement suivant.

Le CLI est lancé **sans aucun outil** : le modèle ne peut ouvrir aucun fichier. C'est
le PLUGIN qui lit les sources — `dashboard/prompt-paths.ts` résout les chemins écrits
dans le composer (vault, chemin absolu, racine externe configurée) et
`startGeneration` les attache via les mêmes fonctions que le picker « @ ». Un chemin
introuvable ou ambigu est signalé par une Notice, jamais ignoré en silence.

## Composants UI (règles)

- **Dropdowns** : `dashboard/ui-select.ts` est le **seul** dropdown autorisé (portalé au
  `<body>`) — jamais de `<select>` natif.
- **Icônes** : Lucide via `host.ui.setIcon()` — `setIcon()` d'Obsidian sous le
  greffon, les données de la bibliothèque `lucide` dans l'app. Jamais d'emoji.
- **Maths** : LaTeX `$...$` partout, rendu MathJax natif (`engine/mathjax.ts`) + éditeur
  MathLive (`engine/math-input.ts`).
- La dictée a été retirée le 2026-09-11 ; ses réglages persistés sont ignorés,
  pas effacés.

## Texte et HTML d'un quiz : quatre portes, jamais une cinquième

Tout ce qu'un quiz affiche passe par `src/engine/sanitizer.ts`. Le choix se fait sur
la NATURE de la destination, pas sur la confiance qu'on accorde à la donnée :

| Destination | Fonction |
|---|---|
| du texte, dans du HTML (énoncés, options, libellés) | `renderInlineText` — échappe, puis rend le markdown inline |
| du texte, dans un ATTRIBUT ou un composant sans HTML (`placeholder`, `aria-label`, vignette) | `stripInlineMarkdown` — même grammaire, marqueurs RETIRÉS ; sa sortie est du texte, à ré-échapper |
| un champ `*Html` pré-rendu (`promptHtml`, `explainHtml`, `learnHtml`, `passageHtml`, `optionHtml`) | `sanitizeQuizHtml` — liste blanche de balises/attributs |
| du texte + des images `![[…]]` | `renderTextWithEmbeds` / `replaceObsidianEmbedsInHtml` (qui assainit déjà) |

**Une cinquième porte existe, et c'est la seule** : `apps/windows/src/host/math.ts`
pose en `innerHTML` la sortie de `convertLatexToMarkup` (MathLive) sans l'assainir.
Ce n'est PAS un oubli — la justification est écrite sur place : ce HTML est fabriqué
par MathLive à partir de LaTeX, qui est analysé et jamais exécuté ; l'assainir
découperait les balises que MathLive vient de composer. Aucune autre exception : tout
autre HTML de l'app repasse par les quatre portes ci-dessus.

Deux règles qui ont chacune coûté un bug :

- **Le HTML d'un quiz n'est pas forcément celui de l'utilisateur** : un quiz PARTAGÉ
  arrive avec les `explainHtml` de son auteur, et le bloc est traité par ce plugin,
  donc hors de portée du filtre d'Obsidian. Une interpolation brute y exécute du code
  avec les droits d'Obsidian. C'est arrivé aux six chemins `*Html` à la fois, et au
  libellé d'emplacement d'un classement (`quiz-slot-label`).
- **Pour lire du HTML sans l'exécuter, `<template>`, jamais un `<div>` détaché** : un
  `<img src=x onerror=…>` se charge dans un `<div>` même hors de l'arbre affiché. Le
  contenu d'un `<template>` a un document propriétaire inerte.

La liste blanche vit au niveau du MODULE (hors de `createSanitizer`) parce que
l'aperçu de l'éditeur l'appelle aussi. Deux surfaces qui affichent le même
`explainHtml` ne peuvent pas en avoir chacune la sienne.

`style` n'est pas supprimé mais RÉDUIT à une liste blanche de propriétés : l'attribut
entier aurait décoloré 594 fragments des quiz d'Ahmed. Mesurer avant de trancher.

## Conventions & pièges

- **Le PRODUIT s'appelle « Neo Quiz », le FORMAT s'appelle `quiz-blocks`.** Le nom
  affiché vit dans `src/branding.ts` (`PRODUCT_NAME`, `LOG_PREFIX`) — seule source,
  il était en dur à sept endroits avant. Deux valeurs ne le suivent JAMAIS, et les
  renommer « par cohérence » détruirait des données :
  `PLUGIN_ID = "quiz-blocks"` est le dossier de `.obsidian/plugins/`, où vivent les
  réglages (le journal de révision, lui, a déménagé depuis la tranche 2 vers
  `<racine>/.neo-quiz/`, partagé avec l'app — voir plus haut) ;
  `QUIZ_BLOCK_LANGUAGE = "quiz-blocks"` est écrit dans **chaque note du
  vault**. C'est le rapport entre Obsidian et `.md`.

- **Deux autres valeurs immuables, côté application** : `appId =
  "com.ahmed.neoquiz"` et `executableName = "neo-quiz"`
  (`apps/windows/electron-builder.config.mjs`). Le premier est la clé de
  registre de l'installation NSIS (changé, chaque mise à jour installe une
  seconde copie), le second le nom du binaire Linux. `check:package` les fige.

- **`manifest.json` vit dans `src/assets/`, pas à la racine** (inhabituel pour un plugin
  Obsidian). La version **réelle** est celle de `src/assets/manifest.json`, bumpée par
  `release.yml` depuis le tag git. La version de `package.json` est statique et ignorée.
- Modules visés < ~350 lignes (exceptions assumées : `ui-select`, `ai`, `engine`, `plugin`).
- Docs de conception (workflow superpowers) : `docs/superpowers/{specs,plans}/`.
