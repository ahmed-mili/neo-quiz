# Greffon réduit au lecteur — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le greffon Obsidian ne fait plus que jouer un bloc `quiz-blocks` dans une note ; tout le reste sort, l'application Windows le fait déjà.

**Architecture:** Retrait descendant en trois commits verts : (1) ce que `plugin.ts` enregistre et les fichiers qui en deviennent orphelins ; (2) l'hôte Obsidian réduit au contrat consommé, les types et l'i18n nettoyés ; (3) le CSS scindé, le manifeste, le README, les tags nus et la version 1.0.0.

**Tech Stack:** TypeScript strict, esbuild (greffon), Vite/Electron (app, doit rester vert), scripts `check:*` en Node.

**Spec:** `docs/superpowers/specs/2026-09-13-greffon-lecteur-design.md`

## Global Constraints

- Ne rien supprimer de `src/` que l'app atteint : la liste exacte des suppressions est dans la spec, rien de plus. `npm run check:app` vert à chaque commit.
- `RESTANTS` et `EXCEPTIONS_APPS` (`scripts/check-host.mjs`) ne rétrécissent que dans le commit du retrait correspondant ; `check-dashboard-dom.mjs` inchangé.
- `PLUGIN_ID`, `QUIZ_BLOCK_LANGUAGE`, clés du format, journal de révision : jamais touchés. Réglages persistés inutiles : ignorés, aucun `delete`.
- Aucun `t("...")` orphelin : retirer les clés mortes dans `src/i18n/en/*.ts` ET `src/i18n/fr/*.ts` (le typage `Record<keyof typeof EN_X, string>` force la paire).
- Aucun tag, aucune release, aucune suppression de tag par un agent. La version du manifeste ne change qu'à la tâche 3, et par `set-version`.
- Commentaires en français. Juger chaque script `check:*` sur son CODE DE SORTIE.
- Contrôles à chaque tâche : `npm run check && npm run check:host && npm run check:dashboard-dom && npm run check:app && npm run check:obsidian-host`.

---

### Task 1: `plugin.ts` ne joue plus que le bloc

**Files:**
- Modify: `apps/obsidian/plugin.ts` (1 469 lignes → ~350)
- Delete: `src/dashboard.ts`, `src/dashboard/share.ts`, `src/dashboard/ai-usage.ts`, `src/dashboard/usage-modal.ts`, `src/modal-base.ts`, `src/quiz-from-lesson.ts`, `apps/obsidian/editor.ts`, `apps/obsidian/quiz-open.ts`, `scripts/check-lesson.mjs`
- Modify: `package.json` (retirer `check:lesson`), `scripts/check-host.mjs` (`RESTANTS`, `EXCEPTIONS_APPS`), `.github/workflows/*.yml` si `check:lesson` y est appelé, `CLAUDE.md` (ligne `check:lesson`)

**Interfaces:**
- Produces: `QuizBlocksSettings = { language: LangSetting; enableCodeHighlighting: boolean; quizStats: Record<string, QuizStatRecord> }` ; `DEFAULT_SETTINGS` à trois clés ; `loadSettings()` = `Object.assign({}, DEFAULT_SETTINGS, await this.loadData())` sans migration ni `delete` (les vieilles clés restent dans `data.json`, ignorées).

- [ ] **Step 1 : lire** `apps/obsidian/plugin.ts` en entier et `src/dashboard/stats-store.ts` (interface `StatsStoreHost`), `src/review/review-store.ts` (`ReviewStoreDeps`).

- [ ] **Step 2 : réécrire `onload`.** Garder dans l'ordre : `installHost(createObsidianHost(...))`, `loadSettings`, `applyLanguage` (garder `setLanguage`/`langSetting`, retirer le ré-étiquetage du ruban), `_statsStore` + relais du `rename`, `_reviewStore` construit ainsi :

```ts
this._reviewStore = createReviewStore({
	fs: currentHost().fs,
	watcher: currentHost().watcher,
	paths: currentHost().paths,
	/* Le lecteur n'appelle jamais `plan()` : il n'a besoin ni du catalogue
	   (le scanner est parti avec le tableau de bord) ni des horizons
	   d'examen. Le journal reste écrit au même endroit, lu par l'app. */
	catalogue: () => [],
	horizons: () => ({}),
	now: () => Date.now(),
	dayStart: /* inchangé */,
});
```

puis `migrateReviewLog` (inchangé), `addSettingTab`, `registerMarkdownCodeBlockProcessor` (bloc conservé À L'IDENTIQUE, `source:` compris), `onunload` : `destroy` des deux stores puis `uninstallHost`. Supprimer : `registerView` ×2, `addRibbonIcon`, les quatre `addCommand`, `_scanner`, `closeAllSelects`, tout import d'`ai-providers`, `ai-usage`, `ai-settings-host`, `hotkey-format`, `ui-select`, `file-sources`, `quiz-modules`, `quiz-from-lesson`, `dashboard`, `scanner`, `editor`.

- [ ] **Step 3 : réduire `QuizBlocksSettingTab`** à deux `Setting` : langue (dropdown existant `auto`/`en`/`fr`, garder la mécanique de rechargement de langue déjà en place) et `enableCodeHighlighting` (toggle). Supprimer les sections IA, hotkeys, « Mes quiz », usage.

- [ ] **Step 4 : supprimer les fichiers** de la liste, `check:lesson` de `package.json` (et de tout workflow qui l'appelle : `grep -rn check:lesson .github CLAUDE.md`). Dans `scripts/check-host.mjs` : `RESTANTS = ["src/types/dashboard-ctx.ts"]` (les cinq autres sont supprimés) ; `EXCEPTIONS_APPS = new Set()` avec un commentaire disant que `src/dashboard.ts` a disparu à la tâche 1 du lecteur.

- [ ] **Step 5 : contrôles.** `npm run check && npm run check:host && npm run check:dashboard-dom && npm run check:app && npm run check:obsidian-host` — tous à 0. Le typecheck va lister des clés i18n encore vivantes mais inutilisées : NE PAS les retirer ici (tâche 2). Si `check:app` rougit sur un import de `src/dashboard.ts` ou `quiz-open.ts` côté app, c'est que la spec s'est trompée : s'arrêter et le dire, ne pas recréer le fichier.

- [ ] **Step 6 : `npm run build`** puis commit :

```bash
git add -A
git commit -m "greffon: ne joue plus que le bloc — tableau de bord, éditeur, IA et commandes retirés (lecteur, tâche 1)"
```

Écran (Ahmed) : (1) un bloc `quiz-blocks` d'une note se joue et enregistre une réponse (`<racine>/.neo-quiz/review-log.jsonl` reçoit une ligne) ; (2) plus de ruban ni d'entrée « Neo Quiz » dans la palette ; (3) l'onglet de réglages ne montre que Langue et Coloration.

---

### Task 2: l'hôte réduit, les types et l'i18n nettoyés

**Files:**
- Modify: `apps/obsidian/host.ts` (1 411 → ~500), `src/host/types.ts`, `scripts/check-obsidian-host.mjs`, `src/types/dashboard-ctx.ts`, `scripts/check-host.mjs`, `src/i18n/en/{plugin,settings,dashboard,ai,editor}.ts` et leurs jumeaux `fr/`, `docs/superpowers/notes/controles.md` (une ligne : `check:obsidian-host` ne couvre plus `pdf`)

**Interfaces:**
- Produces: dans `src/host/types.ts`, `Host` a `modals?: HostModals; net?: HostNet; process?: HostProcess;` (en plus de `pdf?`). Les consommateurs partagés qui les lisent (`src/dashboard/ai-client.ts`, `ai-providers.ts`, `file-sources.ts`, `mention-picker.ts`, `detail*.ts`, tout ce que `npm run check` signale) passent par un accès qui échoue proprement quand absent : ajouter dans `src/host/current.ts`

```ts
/** Un membre OPTIONNEL du contrat, exigé : le greffon lecteur ne fournit
    ni `process`, ni `net`, ni `modals` ; une page qui les demande est une
    page que le greffon n'a plus. L'erreur nomme le membre. */
export function requireHost<K extends "modals" | "net" | "process" | "pdf">(k: K): NonNullable<Host[K]> {
	const v = currentHost()[k];
	if (!v) throw new Error(`host.${k} absent sur cet hôte`);
	return v;
}
```

et remplacer `currentHost().process` → `requireHost("process")` (idem `net`, `modals`) là où le typecheck l'exige. Ne PAS toucher `apps/windows/src/host/*` : l'app fournit tout.

- [ ] **Step 1 : `src/host/types.ts`** : rendre `modals`, `net`, `process` optionnels avec le commentaire ci-dessus ; ajouter `requireHost` à `src/host/current.ts` ; `npm run check` et `npm run check:app` guident les remplacements.

- [ ] **Step 2 : `apps/obsidian/host.ts`** : supprimer les implémentations `modals`, `net`, `process`, `pdf`, `fs.externe` si seul l'IA la consommait (vérifier : `grep -rn "externe" src/engine src/review apps/obsidian`), les fonctions de cache des CLI, tout `require("fs"|"os"|"path"|"child_process")`, l'import de `modal-base`, `cli-args`, `jetons`. Garder `fs`, `links`, `watcher`, `ui`, `math`, `shell`, `platform`, `paths`, et la conversion `TFile → HostFile` (seul endroit du dépôt). `grep -c "require(" apps/obsidian/host.ts` doit donner 0.

- [ ] **Step 3 : `scripts/check-obsidian-host.mjs`** : retirer le groupe PDF (lignes ~158-190), `pdf` et `fs.externe` de `attendu` si retirés, le groupe « process, octets, corbeille et pièces jointes » ne garde que `vault.process`, octets et corbeille (les pièces jointes IA partent). Lancer `npm run check:obsidian-host` : 0. DISCRIMINANCE : commenter `watcher` dans `host.ts`, relancer, voir rouge, restaurer.

- [ ] **Step 4 : `src/types/dashboard-ctx.ts`** : supprimer `DashboardCtx`, `DashboardView` et tout type qui nomme `App`/`ItemView`/`Plugin`/`TFile` ; supprimer l'import d'`obsidian`. Garder `AiSettings`, `DashboardPageSettings`, `DashboardShellCtx`, `DashboardViewName` et ce que `check:app` exige. Dans `check-host.mjs`, `RESTANTS = []` (garder le tableau et son commentaire : la liste est vide parce que la tâche 2 du lecteur a libéré le dernier fichier).

- [ ] **Step 5 : i18n.** Pour chaque clé de `src/i18n/en/plugin.ts`, `settings.ts`, `dashboard.ts`, `ai.ts`, `editor.ts` : `grep -rn "\"<domaine>.<clé>\"" src apps` ; aucune occurrence → retirer la clé en `en` et en `fr`. Un domaine entièrement mort est retiré de `src/i18n/{en,fr}.ts`. Attention : `t()` avec une clé construite dynamiquement (`t(\`ai.provider.${p}\`)`) — chercher aussi le préfixe avant de retirer.

- [ ] **Step 6 : contrôles**, `npm run build`, commit :

```bash
git add -A
git commit -m "greffon: l'hôte Obsidian sans Node, types et dictionnaires sans clé morte, cliquet vidé (lecteur, tâche 2)"
```

Écran (Ahmed) : (1) le bloc se joue toujours, LaTeX rendu dans un énoncé et dans une réponse `text` ; (2) une image `![[...]]` dans une question s'affiche ; (3) changer la langue dans les réglages change les libellés du moteur (Start, Next…).

---

### Task 3: CSS scindé, manifeste, README, tags nus, 1.0.0

**Files:**
- Create: `src/assets/css/plugin.css`, `apps/obsidian/README.md`
- Modify: `esbuild.config.mjs:52`, `src/assets/manifest.json` (description, `isDesktopOnly`), `.github/workflows/release.yml` (job `prepare`), `scripts/set-version.mjs:134`, `scripts/ship.mjs:292` et ligne 25 du commentaire, `scripts/set-version.test.mjs`, `scripts/ship.test.mjs`, `CLAUDE.md` (« Release » : tag nu du greffon)

- [ ] **Step 1 : `plugin.css`** = copie de `index.css` sans les `@import` `dashboard/*`, `editor/*`, `ui-select`, `color-picker`, `effort-slider`, `settings-code` si `grep -rn "<classe>" src/engine apps/obsidian` ne trouve rien pour leurs classes (vérifier chacun). `esbuild.config.mjs` : `entryPoints: ["src/assets/css/plugin.css"]`. `npm run check:theme` : 0 (il parcourt le dossier, pas l'entrée ; s'il exige l'entrée, l'y adapter).

- [ ] **Step 2 : manifeste** : `"description": "Play interactive quizzes written in quiz-blocks code blocks: multiple question types, exam mode, LaTeX, spaced-repetition log shared with the Neo Quiz app."`, `"isDesktopOnly": true`. Version INCHANGÉE à ce step.

- [ ] **Step 3 : `apps/obsidian/README.md`** (≤ 40 lignes, anglais) : ce que fait le lecteur, le format en trois lignes d'exemple, le lien vers l'app (`https://github.com/ahmed-mili/neo-quiz`), la note « Creating and editing quizzes lives in the Neo Quiz desktop app ».

- [ ] **Step 4 : tags nus.** `release.yml` : `on.push.tags` ajoute `'[0-9]*'` ; dans `prepare`, le `case` gagne `[0-9]*) product=plugin; version=$tag ;;` avant `v*)` (qu'on garde) ; en `workflow_dispatch`, `prefixe=""` pour le greffon. `set-version.mjs:134` : `(target === "app" ? "desktop-v" : "") + version` ; `ship.mjs:292` : `${target === "plugin" ? "" : "desktop-v"}${version}` ; adapter les deux tests qui attendent `v` + version ; `npm test` : 0. Le job `plugin` garde `make_latest: false` (ne pas toucher).

- [ ] **Step 5 : version 1.0.0** : `node scripts/set-version.mjs plugin 1.0.0` (lire l'usage dans le script ; s'il refuse une version inférieure, poser `"version": "1.0.0"` à la main dans `src/assets/manifest.json`). `npm run build` (redéploie dans les vaults). Mesurer : `ls -l dist/main.js dist/styles.css` et noter les tailles dans le message de commit.

- [ ] **Step 6 : contrôles** (+ `check:theme`, `check:package`, `npm test`), commit :

```bash
git add -A
git commit -m "greffon 1.0.0 : CSS du lecteur seul, manifeste desktop, README, tags nus (lecteur, tâche 3)"
```

Écran (Ahmed) : (1) Obsidian, Réglages → Plugins communautaires : « Neo Quiz 1.0.0 » ; (2) le bloc se joue, les styles (options, résultats, mode examen) sont intacts ; (3) `git tag` ne montre aucun tag nouveau.

Actions à Ahmed après la tâche 3 (hors agents) : supprimer les releases/tags `v1.1.0-beta`…`v2.6.1`, poser le tag `1.0.0`, puis PR sur `obsidianmd/obsidian-releases`.
