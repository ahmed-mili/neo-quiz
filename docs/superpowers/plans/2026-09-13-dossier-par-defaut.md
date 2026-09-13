# Tranche 9, un seul dossier par défaut : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `C:\Neo Quiz` est le dossier de quiz par défaut, fixe, créé au premier lancement, où vont « Nouveau quiz » et `Generated` ; les autres emplacements sont listés en bas des Réglages ; un module se déplace d'un emplacement à l'autre par son menu ⋯, historique compris ; la page d'un quiz généré montre le modèle et l'effort.

**Architecture:** Quatre chantiers. (1) Le principal crée et autorise `C:\Neo Quiz` ; le rendu le place en première racine (`id: "Neo Quiz"`), les Réglages le montrent sans croix et listent les autres en bas ; l'écran « aucun dossier » disparaît. (2) Le contrat gagne `HostPaths.defaultRoot()` ; `saveGeneratedQuiz` l'utilise. (3) `HostFs.rename` est déclaré valable sur un dossier (Node : `fs.rename` puis repli copie + suppression sur `EXDEV` ; Obsidian : `adapter.rename` marche déjà) ; « Déplacer vers… » dans le menu d'un module ; `review-store` transpose les lignes du journal source vers le journal cible (fonction pure). (4) Frontmatter `neo-quiz:` écrit par `saveGeneratedQuiz`, lu par un module pur `src/quiz-frontmatter.ts`, porté par `QuizIndexEntry.generated`, affiché par `renderStats`.

**Tech Stack:** Electron (principal : `node:fs`), code partagé TypeScript, scripts de contrôle Node (`withSrcModule`, `makeReporter`).

**Spec:** `docs/superpowers/specs/2026-09-13-dossier-par-defaut-design.md`

## Global Constraints

- **Aucune chaîne visible en dur** : `t("<domaine>.<clé>")`, EN de référence, FR typé. Les clés du frontmatter (`neo-quiz`, `provider`, `model`, `effort`, `generatedAt`) et le nom `Generated` sont des DONNÉES persistées : jamais traduits.
- **Commentaires en français**, le POURQUOI. Aucun artefact d'encodage. Pas d'emoji, pas d'em-dash.
- **Le contrat s'élargit d'UN membre** (`HostPaths.defaultRoot(): HostRoot`) et d'une PRÉCISION sur `HostFs.rename` (accepte un dossier) : les deux hôtes (`apps/obsidian/host.ts`, `apps/windows/src/host/index.ts`) ET les trois faux hôtes (`scripts/check-lesson.mjs`, `scripts/check-obsidian-host.mjs`, `scripts/check-windows-host.mjs`) les reçoivent, sinon `check:lesson` meurt en route et masque les groupes suivants.
- `npm run check:host` reste à **6** ; `src/` n'importe rien d'Obsidian ni de Node de plus.
- **Le journal de révision reste en ajout seul** : transposer = AJOUTER des lignes au journal cible ; le journal source n'est jamais réécrit.
- **Le périmètre** : `C:\Neo Quiz` entre au périmètre par le même `autoriser` que les dossiers de quiz ; aucun canal neuf ne prend un chemin.
- **Immuables** : `PLUGIN_ID`, `QUIZ_BLOCK_LANGUAGE`, `appId`, `executableName`, la règle d'identité des questions (`quiz-ids.ts`).
- Scripts de contrôle : `process.exitCode`, discriminance ; juger sur le code de sortie.
- Aucun agent ne lance l'application. Commits sur `main`, sans push par les implémenteurs.

---

### Task 1: Le dossier par défaut, du principal aux Réglages

**Files:**
- Create: `apps/windows/electron/dossier-defaut.ts` (pur : `cheminDossierDefaut(plateforme, home)`, `DOSSIER_DEFAUT_NOM = "Neo Quiz"`)
- Modify: `apps/windows/electron/main.ts` (créer + autoriser avant `perimetreInitial`), `apps/windows/electron/perimetre.ts` (`perimetreInitial` reçoit `dossierDefaut` et l'autorise en premier)
- Modify: `apps/windows/electron/pont.ts` (`systeme.dossierDefaut(): Promise<string>` + canal `systemeDossierDefaut`), `preload.ts`, `canaux.ts`
- Modify: `apps/windows/src/host/folder.ts` (`savedFolders()` : le défaut AJOUTÉ devant, `id: "Neo Quiz"`, `name: "Neo Quiz"`, `parDefaut: true` ; `removeFolder` refuse le défaut ; `MAX_DOSSIERS` compte les supplémentaires)
- Modify: `apps/windows/src/main.ts` (plus de `mountSansDossier` : le démarrage ouvre toujours au moins le défaut ; la détection des vaults au premier lancement passe dans les Réglages)
- Modify: `apps/windows/src/ui/settings.ts` (section « Dossier de quiz » = le défaut, sans croix, chemin affiché ; section « Emplacements supplémentaires » en dessous = la liste actuelle + les vaults Obsidian détectés non encore ouverts, proposés en un clic)
- Modify: `scripts/check-folders.mjs` (le défaut devant, jamais retiré), `scripts/check-electron-reglages.mjs` (le défaut est autorisé au périmètre même sans réglage ; `cheminDossierDefaut` : `win32` → `C:/Neo Quiz`, `linux` → `<home>/Neo Quiz`)
- Modify: `scripts/check-windows-host.mjs` (faux `systeme.dossierDefaut`)
- Modify: `src/i18n/en/app.ts`, `src/i18n/fr/app.ts` (`app.settings.defaultFolder`, `app.settings.defaultFolderHint`, `app.settings.extraFolders`, `app.settings.extraFoldersHint` ; réutiliser `review.settings.addFolder` / `removeFolder` existants)

**Interfaces:**
- Produces : `HostRoot` de `roots()[0]` est TOUJOURS le défaut (`id: "Neo Quiz"`). `pont().systeme.dossierDefaut()` rend le chemin absolu avec `/`.

- [ ] **Step 1 : Le pur et ses cas (rougit d'abord)** : `cheminDossierDefaut("win32", "C:/Users/x")` = `"C:/Neo Quiz"` ; `cheminDossierDefaut("linux", "/home/x")` = `"/home/x/Neo Quiz"` ; dans `check-electron-reglages.mjs`.
- [ ] **Step 2 : Le principal** : au démarrage, `const defaut = cheminDossierDefaut(process.platform, os.homedir())`, `await fs.mkdir(defaut, { recursive: true })`, puis `perimetreInitial({ dossierDonnees, reglages, dossierDefaut: defaut })` qui l'autorise EN PREMIER (commentaire : il est là même sans réglage, c'est ce qui rend le premier lancement possible). Canal `systemeDossierDefaut` sans argument.
- [ ] **Step 3 : Le rendu** : `savedFolders()` lit `dossierDefaut()` et le place devant (`parDefaut: true`) sans l'écrire dans `folders` ; `removeFolder` ignore le défaut ; `main.ts` : plus de branche `mountSansDossier` (garder la fonction si un autre chemin l'appelle, sinon la supprimer avec son CSS `nq-accueil`) ; les vaults détectés sont proposés dans les Réglages.
- [ ] **Step 4 : Réglages** : deux sections ; le défaut sans croix ; hint : « Neo Quiz crée ses quiz ici. Ce dossier ne peut pas être retiré. » / EN équivalent.
- [ ] **Step 5 : Contrôles** : `check:app`, `check:host` (6), `check:folders`, `check:electron-reglages`, `check:windows-host`, `check:theme`. Commit : `feat(app): C:/Neo Quiz est le dossier de quiz par defaut, cree au lancement, les autres emplacements en bas`.

**À vérifier à l'écran (Ahmed)** : premier lancement (bac à sable) : pas d'écran de choix, `C:\Neo Quiz` créé, accueil vide ; Réglages : le défaut en haut sans croix, les vaults détectés en bas ; « Nouveau quiz » crée dans `C:\Neo Quiz`.

---

### Task 2: `defaultRoot` et `Generated` toujours dans le défaut

**Files:**
- Modify: `src/host/types.ts` (`HostPaths.defaultRoot(): HostRoot`), `apps/obsidian/host.ts` (la seule racine), `apps/windows/src/host/index.ts` (`carte.hostRoots()[0]`), les trois faux hôtes
- Modify: `src/dashboard/ai.ts` (`saveGeneratedQuiz` : `const root = host.paths.defaultRoot()` ; retirer la recherche par note `@` et le champ `viaMention` s'il n'a plus d'autre lecteur)
- Modify: `scripts/check-obsidian-host.mjs`, `check-windows-host.mjs` (un cas : `defaultRoot()` est `roots()[0]`)

- [ ] Contrat + hôtes + faux hôtes ; `ai.ts` ; contrôles `check`, `check:app`, `check:host` (6), `check:lesson` (jusqu'au bout), `check:obsidian-host`, `check:windows-host`. Commit : `feat(ai): le quiz genere va toujours dans Generated du dossier par defaut`.

---

### Task 3: « Déplacer vers… » et l'historique qui suit

**Files:**
- Modify: `src/host/types.ts` (`rename` : « ou un DOSSIER, avec tout son contenu ; rejette si la destination existe »), `apps/windows/electron/fichiers.ts` (`rename` : `fs.rename`, et sur `EXDEV` copie récursive `fs.cp(de, vers, { recursive: true })` puis `fs.rm(de, { recursive: true })`), `scripts/check-electron-fs.mjs` (un dossier avec deux fichiers déplacé ; destination existante refusée)
- Create: `src/review/transpose.ts` (pur : `transposerLignes(lignes: ReviewEvent[], fromDir: string, toDir: string): ReviewEvent[]` : les `answer` dont `q` commence par `fromDir + "/"` réécrites avec `toDir`, les `rename` dont `from` ou `to` y commencent idem, le reste ignoré) ; `scripts/check-review-store.mjs` (cas : préfixe exact, pas `Cours2` pour `Cours`, `rename` transposé, lignes hors dossier ignorées)
- Modify: `src/review/review-store.ts` (`moved(fromDir, toDir): Promise<void>` : lit le journal source (chargé), transpose, `append` au journal cible, puis `renamed` interne ? non : les deux journaux sont distincts, rien d'autre) ; `src/types/*` si `ReviewStore` est typé ailleurs
- Modify: `src/dashboard/quiz-menu.ts` (`buildModuleCardMenu` : entrée « Déplacer vers… » quand `host.paths.roots().length > 1`, sous-menu des racines sauf la courante ; action : confirmation (`host.ui.confirm` s'il existe, sinon une modale existante) puis `host.fs.rename(from, to)`, `reviewStore.moved(fromLocal, toLocal)`, `scanner` rescanne (le watcher le fera), Notice de succès ; si `rename` rejette : Notice « existe déjà »)
- Modify: `src/i18n/en/dashboard.ts`, `fr` (`dashboard.quizzes.menuMove`, `dashboard.quizzes.moveConfirm` (« Move “{name}” to {target}? Obsidian links to these notes are not rewritten. »), `dashboard.quizzes.moved`, `dashboard.quizzes.moveExists`)

- [ ] Contrôles : `check`, `check:app`, `check:host` (6), `check:electron-fs`, `check:review-store`, `check:engine-review`, `check:module-edit`, `check:lesson`, `check:dashboard-dom`. Commit : `feat(dashboard): Deplacer vers... un module change d'emplacement, l'historique suit`.

**À vérifier à l'écran (Ahmed)** : déplacer un module d'un vault vers `C:\Neo Quiz` : il apparaît là, disparaît du vault, « À réviser » le compte toujours ; le remettre ; un homonyme à la cible : Notice.

---

### Task 4: Le modèle et l'effort sur la page du quiz

**Files:**
- Create: `src/quiz-frontmatter.ts` (pur : `lireFrontmatterNeoQuiz(content): { provider, model, effort?, generatedAt } | null` ; `ecrireFrontmatterNeoQuiz(meta): string` ; `retirerFrontmatter(content): string` si le scanner en a besoin pour trouver le bloc) ; `scripts/check-scanner.mjs` (cas : note sans frontmatter → null ; avec → les cinq champs ; `effort` absent → undefined ; un `---` au milieu du texte n'est pas un frontmatter)
- Modify: `src/dashboard/ai.ts` (`saveGeneratedQuiz` écrit `ecrireFrontmatterNeoQuiz({ provider: settings().aiProvider, model: settings().aiModel, effort: provider !== "ollama" ? settings().aiEffort : undefined, generatedAt: new Date().toISOString() }) + exportAllWithFence(...) + "\n"`)
- Modify: `src/dashboard/scanner.ts` (`QuizIndexEntry.generated?`, posé dans `scanVault` ET `scanFile`)
- Modify: `src/dashboard/detail.ts` (`renderStats` : la tuile `qbd-qz-stat--generated` ; valeur `model`, libellé `effort ?? provider` ; classe CSS existante réutilisée)
- Modify: `src/i18n/en/dashboard.ts`, `fr` (`dashboard.detail.generatedBy` pour l'infobulle : « Generated by {model} ({effort}) »)

- [ ] Contrôles : `check`, `check:app`, `check:host` (6), `check:scanner`, `check:quiz-io`, `check:export`, `check:markers`, `check:lesson`. Commit : `feat(dashboard): la page d'un quiz genere montre le modele et l'effort`.

**À vérifier à l'écran (Ahmed)** : générer avec Claude en `high` : la note commence par le frontmatter, la page montre `claude-opus-5` / `HIGH` ; avec Ollama : le modèle / `OLLAMA` ; un quiz écrit à la main : pas de tuile ; dans Obsidian, la même tuile.

---

### Task 5: Les épreuves (contrôleur)

- [ ] `docs/superpowers/notes/2026-09-13-tranche-9-epreuves-ecran.md`, commit, push, CI.
