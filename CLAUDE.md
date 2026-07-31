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

- `npm run check` — typecheck (`tsc --noEmit`). **C'est la seule vérification
  automatisée : il n'y a AUCun framework de test.** Toujours lancer après une modif TS.
- `npm run dev` — esbuild en watch : rebuild + redéploiement à chaque save (JS et CSS).
- `npm run build` — build production → `dist/` + déploiement dans les vaults.
- **Release** : bumper la version dans `src/assets/manifest.json`, créer un tag
  `git tag vX.Y.Z`, `git push` du tag → le workflow `release.yml` build et publie.
  (Ne pas utiliser `npm run release` : il pointe vers un `scripts\release.bat` absent.)

Vérification d'un changement = `npm run check` **puis** test manuel dans Obsidian
(pas de tests unitaires à exécuter).

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

## Architecture (le point important)

Point d'entrée : `src/main.ts` → `src/plugin.ts` (`InteractiveQuizPlugin extends Plugin`).
`plugin.ts` porte le `SettingTab`, les settings persistés + leurs migrations, et
enregistre : le processeur de bloc `quiz-blocks` (→ moteur), la vue dashboard, la vue
onglet d'un quiz (`quiz-blocks-builder`).

Les **deux sous-systèmes** suivent le **même pattern** : une factory
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
détail du dashboard, la page « Générer » (quiz encore en mémoire, `save` absent,
`QuizDraft.file === null`) et l'onglet `quiz-blocks-builder` (`src/editor.ts`).
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

## Génération IA (`dashboard/ai*.ts`)

Via **CLIs locaux, jamais de clé API** : Claude Code CLI (abonnement), Codex CLI
(ChatGPT), Ollama (local + cloud). `ai-client.ts` spawn les process (prompt en stdin,
sortie JSON ; `taskkill /T /F` sous Windows pour l'annulation). Les **modèles sont lus
dynamiquement** (cache des CLIs, catalogue `ollama.com`), **jamais codés en dur** — voir
mémoire projet `codex-models-dynamic` et `ollama-latest-version-only`.

Le CLI est lancé **sans aucun outil** : le modèle ne peut ouvrir aucun fichier. C'est
le PLUGIN qui lit les sources — `dashboard/prompt-paths.ts` résout les chemins écrits
dans le composer (vault, chemin absolu, racine externe configurée) et
`startGeneration` les attache via les mêmes fonctions que le picker « @ ». Un chemin
introuvable ou ambigu est signalé par une Notice, jamais ignoré en silence.

## Composants UI (règles)

- **Dropdowns** : `dashboard/ui-select.ts` est le **seul** dropdown autorisé (portalé au
  `<body>`) — jamais de `<select>` natif.
- **Icônes** : Lucide via `setIcon()` d'Obsidian.
- **Maths** : LaTeX `$...$` partout, rendu MathJax natif (`engine/mathjax.ts`) + éditeur
  MathLive (`engine/math-input.ts`).
- **Dictée** : `dashboard/voice-install.ts` + `dashboard/voice-input.ts` (whisper.cpp
  local, Windows, opt-in).

## Conventions & pièges

- **`manifest.json` vit dans `src/assets/`, pas à la racine** (inhabituel pour un plugin
  Obsidian). La version **réelle** est celle de `src/assets/manifest.json`, bumpée par
  `release.yml` depuis le tag git. La version de `package.json` est statique et ignorée.
- Modules visés < ~350 lignes (exceptions assumées : `ui-select`, `ai`, `engine`, `plugin`).
- Docs de conception (workflow superpowers) : `docs/superpowers/{specs,plans}/`.
