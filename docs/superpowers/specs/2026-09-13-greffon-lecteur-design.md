# Le greffon réduit au lecteur (chantier 4, objectif 2)

Décisions d'Ahmed, 2026-09-13 : le greffon Obsidian ne sait plus que JOUER un
bloc `quiz-blocks` dans une note. Tout le reste vit dans l'application
Windows (1.0.0, complète). Lecture pure : aucun pont vers l'app, desktop
seulement (`isDesktopOnly: true`), la commande « quiz depuis la leçon » part
aussi. Le greffon repasse en **1.0.0** avec des tags **nus** (`1.0.0`), à la
DERNIÈRE tâche seulement.

## Ce qui reste

- `apps/obsidian/plugin.ts` : `installHost`/`uninstallHost`, le processeur
  `quiz-blocks` (avec la résolution `source:` vers une note leçon, qui est de
  la lecture), `statsStore` (clé persistée `quizStats`, sans UI),
  `reviewStore` construit avec `catalogue: () => []` et `horizons: () => ({})`
  (le moteur n'appelle que `record`/`keyOf` ; `plan()` était au tableau de
  bord), `migrateReviewLog`, l'onglet de réglages à DEUX entrées : `language`,
  `enableCodeHighlighting`.
- `apps/obsidian/host.ts` réduit à ce que le lecteur consomme : `fs`, `links`,
  `watcher`, `ui`, `math`, `shell`, `platform`, `paths`. `modals`, `net`,
  `process`, `pdf` deviennent OPTIONNELS dans `Host` (`src/host/types.ts`) ;
  l'app les fournit toujours (`check:windows-host` inchangé),
  `check:obsidian-host` perd les cas correspondants. Plus aucun `require`
  Node dans le greffon.
- `src/` partagé intact : `engine*`, `review/`, `scheduler/`, `dashboard/`
  consommé par l'app (le scanner y compris, il sort seulement du greffon),
  `quiz-source-ref.ts`, `i18n`.
- Réglages persistés inutiles : IGNORÉS, jamais effacés (chargement par
  `Object.assign`, aucun `delete`), comme la dictée. `PLUGIN_ID`,
  `QUIZ_BLOCK_LANGUAGE`, clés du format, journal de révision : immuables.

## Ce qui sort

Vues `QuizDashboardView` et `QuizBuilderView`, ruban, les quatre commandes
(`open-quiz-dashboard`, `open-quiz-builder`, `open-quiz-from-active-note`,
`create-quiz-from-lesson`), l'écran d'usage, tous les réglages IA / hotkeys /
« Mes quiz ». Fichiers supprimés : `src/dashboard.ts`, `src/dashboard/share.ts`,
`src/dashboard/ai-usage.ts`, `src/dashboard/usage-modal.ts`, `src/modal-base.ts`,
`src/quiz-from-lesson.ts`, `apps/obsidian/editor.ts`, `apps/obsidian/quiz-open.ts`,
`scripts/check-lesson.mjs` (et son script npm). `src/types/dashboard-ctx.ts`
est scindé : la part liée à `App`/`ItemView`/`Plugin` meurt, les types que
l'app importe (`AiSettings`, `DashboardPageSettings`, `DashboardShellCtx`,
`DashboardViewName`) restent, sans import d'Obsidian. Clés i18n mortes
retirées dans en ET fr (le typage force la paire).

CSS : nouvelle entrée `src/assets/css/plugin.css` (= `index.css` sans les
blocs `dashboard/` et `editor/`, ni les composants morts) pour esbuild ;
`index.css` reste l'entrée de l'app.

## Cliquets

`RESTANTS` (check:host) : 6 → 0 (vidé, la liste reste en place pour un retour
en arrière). `EXCEPTIONS_APPS` : vidé. `check-dashboard-dom` : inchangé (ne
peut que grandir). Mis à jour dans le commit de chaque retrait.

## Liste communautaire, part de code

`manifest.json` : `isDesktopOnly: true`, description « play » sans « create »,
`version: 1.0.0` (tâche finale). README du greffon (`apps/obsidian/README.md`,
court : ce que fait le lecteur, où est l'app). MathLive reste (éditeur
mathématique des réponses `text`) ; le poids du bundle est mesuré et noté.

Ce que la SOUMISSION demandera, hors code (à Ahmed) : release GitHub dont le
tag est exactement la version, avec `main.js`, `styles.css`, `manifest.json`
en assets ; PR sur `obsidianmd/obsidian-releases` (`community-plugins.json`) ;
respect des guidelines (pas de `console.log` bavard, pas de styles globaux
hors classes préfixées, `id` sans « obsidian », licence présente) ; suppression
des anciennes releases/tags `v1.1.0-beta`…`v2.6.1` pour que 1.0.0 ne suive pas
2.6.1 — demander à Ahmed avant.

## Tags nus et release (tâche finale)

`release.yml`, job `prepare` : `[0-9]*` → greffon (garder `v*` tant que les
vieux tags existent) ; le job `plugin` garde `make_latest: false`.
`scripts/set-version.mjs` et `scripts/ship.mjs --plugin` posent le tag nu,
`npm test` adapté. Aucun tag posé par un agent.

## Contrôles

Par tâche : `npm run check`, `check:host`, `check:dashboard-dom`, `check:app`,
`check:obsidian-host` ; `check:theme` quand le CSS bouge ; `npm test` à la
tâche finale. Trois lignes d'écran par tâche, dans Obsidian, par Ahmed.
