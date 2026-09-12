# Tranche 6 — l'installeur : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un installeur NSIS et une AppImage produits par la CI à chaque tag, non signés (décision écrite), versionnés depuis le manifeste, dont le premier lancement, la mise à jour par-dessus et la désinstallation sont éprouvés par Ahmed sur une machine propre (Windows Sandbox).

**Architecture:** Rien de neuf dans le code partagé. Quatre chantiers indépendants : (1) la configuration d'empaquetage et son contrôle mécanique, (2) une ligne « À propos » qui affiche la version dans la page Réglages de l'application, (3) la chaîne CI/release, (4) le banc d'essai (fichier Windows Sandbox, vault d'essai, liste d'épreuves, README).

**Tech Stack:** electron-builder 26 (`apps/windows/electron-builder.config.mjs`), NSIS, AppImage, GitHub Actions (`ubuntu-latest`, `windows-latest`), Windows Sandbox (`.wsb`), Vite (import JSON), scripts de contrôle Node (`scripts/lib/load-src.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-13-installeur-design.md`

## Global Constraints

- **Aucune chaîne visible en dur** : `t("<domaine>.<clé>")`, anglais de référence dans `src/i18n/en/*.ts`, français typé dans `src/i18n/fr/*.ts` (une clé manquante = erreur de compilation).
- **Commentaires en français**, qui disent le POURQUOI. Aucun artefact d'encodage (`Ã`, `â€`). Pas d'emoji, pas d'em-dash dans les fichiers de ce plan.
- **Le rendu (`apps/windows/src/`) n'importe jamais un module qui tire Node** ; importer un JSON de `src/assets/` est permis.
- `npm run check:host` doit annoncer **6** fichiers, ni plus ni moins.
- Scripts de contrôle : `process.exitCode`, jamais `process.exit()` ; un cas neuf s'éprouve par DISCRIMINANCE (casser la règle, voir rougir, restaurer, et le dire dans le rapport).
- **Juger un script sur son CODE DE SORTIE**, jamais sur la fin de sa sortie.
- **Trois valeurs immuables** : `appId: "com.ahmed.neoquiz"`, `executableName: "neo-quiz"`, `nsis.deleteAppDataOnUninstall: false`. Ne jamais les « harmoniser ».
- **Pas de guess** sur une option electron-builder : la lire dans `apps/windows/node_modules/app-builder-lib/out/**/*.d.ts` avant de l'écrire.
- Aucun agent ne lance l'installeur, ne pilote l'application ni Obsidian. Ahmed teste à l'écran ; chaque tâche se termine par la liste de ce qu'il doit vérifier, quand il y a quelque chose.
- Commits sur `main`, sans push par les implémenteurs (le contrôleur pousse et observe la CI).

---

### Task 1: L'empaquetage et son contrôle (`check:package`)

**Files:**
- Modify: `apps/windows/electron-builder.config.mjs`
- Create: `scripts/check-package.mjs`
- Modify: `package.json` (racine) — ligne `"check:package"` dans `scripts`
- Modify: `CLAUDE.md` — une ligne `check:package` dans « Commandes », et `appId` / `executableName` dans « Conventions & pièges »

**Interfaces:**
- Consumes: rien.
- Produces: la fonction par défaut de `electron-builder.config.mjs` rend un objet avec `appId`, `productName`, `executableName`, `extraMetadata.version`, `files`, `win.artifactName`, `linux.artifactName`, `linux.desktop.entry`, `nsis.deleteAppDataOnUninstall`. `npm run check:package` (utilisé par la Task 3 dans la CI).

- [ ] **Step 1: Écrire le contrôle, qui doit rougir**

Créer `scripts/check-package.mjs` :

```js
/**
 * L'EMPAQUETAGE — la configuration résolue d'electron-builder, et le paquet
 * s'il existe.
 *
 * Ce que ce script empêche, et qu'une relecture ne voit pas :
 *   - une version qui diverge du manifeste (deux numéros, l'un jamais suivi) ;
 *   - un `appId` ou un `executableName` changé « par cohérence » : le premier
 *     est la clé de registre par laquelle NSIS retrouve l'installation à
 *     remplacer (le changer fait de chaque mise à jour une seconde
 *     installation), le second est le nom du binaire dans l'AppImage — et un
 *     caractère interdit dedans (`@`) a fait échouer chaque run CI Linux
 *     jusqu'au 2026-09-12 ;
 *   - `deleteAppDataOnUninstall` passé à vrai : la mise à jour désinstalle
 *     l'ancienne version, et perdrait les réglages avec elle ;
 *   - `node_modules` et les sourcemaps dans l'asar (3 659 fichiers de poids
 *     mort au 2026-09-12 : `chokidar` est bundlé par esbuild, `lucide` par Vite).
 *
 *     npm run check:package
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { makeReporter } from "./lib/load-src.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const appWindows = `${racine}apps/windows/`;

const r = makeReporter("Empaquetage — configuration résolue");

const { default: configurer } = await import(pathToFileURL(`${appWindows}electron-builder.config.mjs`).href);
const config = await configurer();
const manifeste = JSON.parse(await readFile(`${racine}src/assets/manifest.json`, "utf8"));

r.check("la version est celle du manifeste", config.extraMetadata?.version, manifeste.version);
r.check("appId est immuable", config.appId, "com.ahmed.neoquiz");
r.check("executableName est immuable et sûr pour un chemin",
	[config.executableName, /^[a-z0-9.-]+$/.test(config.executableName ?? "")], ["neo-quiz", true]);
r.check("les artefacts ont un nom sans espace",
	[config.win?.artifactName, config.linux?.artifactName],
	["neo-quiz-setup-${version}.${ext}", "neo-quiz-${version}.${ext}"]);
r.check("la fenêtre Linux est associée à son entrée .desktop",
	[config.linux?.desktop?.entry?.Name, config.linux?.desktop?.entry?.StartupWMClass],
	["Neo Quiz", "neo-quiz"]);
r.check("files exclut node_modules et les sourcemaps",
	[config.files.includes("!node_modules/**"), config.files.includes("!dist-electron/**/*.map")],
	[true, true]);
r.check("la désinstallation garde les données", config.nsis?.deleteAppDataOnUninstall, false);
r.done();

/* LE PAQUET, s'il a été construit (`npm run pack:win` laisse `win-unpacked/`).
   `@electron/asar` est une dépendance transitive d'electron-builder : on la
   résout depuis `apps/windows`, sans l'ajouter aux dépendances. */
const asar = `${appWindows}dist-installer/win-unpacked/resources/app.asar`;
if (existsSync(asar)) {
	const p = makeReporter("Empaquetage — contenu de app.asar");
	const require = createRequire(`${appWindows}package.json`);
	const { listPackage } = require("@electron/asar");
	const chemins = listPackage(asar).map(c => c.replace(/\\/g, "/"));
	p.check("aucun node_modules dans l'asar", chemins.filter(c => c.includes("/node_modules/")).length, 0);
	p.check("aucune sourcemap dans l'asar", chemins.filter(c => c.endsWith(".map")).length, 0);
	p.check("les deux sorties sont là",
		[chemins.includes("/dist-electron/main.cjs"), chemins.includes("/dist-electron/preload.cjs"), chemins.includes("/dist/index.html")],
		[true, true, true]);
	p.done();
} else {
	console.log("Empaquetage — contenu de app.asar : aucun paquet local (npm run pack:win), groupe sauté");
}
```

Vérifier avant d'écrire que `@electron/asar` exporte bien `listPackage` (lire `apps/windows/node_modules/@electron/asar/lib/asar.d.ts` ou `lib/asar.js`) ; si le nom diffère, prendre celui qui existe, et le noter dans le rapport.

Ajouter dans `package.json` (racine), après `"check:electron-process"` :

```json
    "check:package": "node scripts/check-package.mjs",
```

- [ ] **Step 2: Le lancer, il doit rougir**

Run: `npm run check:package ; echo "exit=$LASTEXITCODE"`
Expected: code 1 ; échecs sur `executableName`, artefacts, `.desktop`, `files`, `deleteAppDataOnUninstall` ; et, le paquet local du 2026-09-12 existant encore, échec sur « aucun node_modules dans l'asar ».

- [ ] **Step 3: Corriger la configuration**

Dans `apps/windows/electron-builder.config.mjs`, remplacer l'objet rendu par :

```js
	return {
		/* IMMUABLE, comme `PLUGIN_ID` : c'est la clé de registre par laquelle
		   l'installeur NSIS retrouve une installation existante pour la
		   remplacer. Changé, chaque mise à jour deviendrait une seconde
		   installation à côté de la première — deux raccourcis, deux entrées
		   dans « Applications ». `npm run check:package` le fige. */
		appId: "com.ahmed.neoquiz",
		productName: "Neo Quiz",
		/* IMMUABLE aussi. Sans lui, electron-builder dérive le nom du binaire
		   du `name` de package.json (`@neo-quiz/windows`) et REFUSE le `@` :
		   c'est ce qui a fait échouer chaque run CI Linux jusqu'au
		   2026-09-12. Sous Linux, c'est le nom du binaire dans l'AppImage et
		   de l'entrée `.desktop`. */
		executableName: "neo-quiz",
		// Injecte la version du manifeste sans toucher a package.json : c'est
		// cette valeur qu'electron-builder utilise pour le nom du fichier
		// produit et les metadonnees de l'installeur.
		extraMetadata: {
			version: await lireVersionDuManifeste(),
		},
		directories: {
			// `output` evite que l'installeur atterrisse dans `dist/`, deja pris
			// par le rendu Vite : electron-builder l'ecraserait sinon a chaque
			// paquet.
			output: "dist-installer",
		},
		/* Les DEUX sorties et rien d'autre. Le principal est bundlé par esbuild
		   (`chokidar` compris — raison 2 de l'en-tête de `construire.mjs`), le
		   rendu par Vite (`lucide` compris) : rien dans le paquet n'appelle
		   `require` vers `node_modules`. Sans l'exclusion, electron-builder y
		   copiait 3 659 fichiers de dépendances de production, et les
		   sourcemaps du principal avec. Si cette affirmation devenait fausse,
		   l'application ne démarrerait pas : l'épreuve « premier lancement sur
		   machine propre » l'attraperait. */
		files: ["dist/**/*", "dist-electron/**/*", "!dist-electron/**/*.map", "package.json", "!node_modules/**"],
		win: {
			target: "nsis",
			icon: "icons/icon.ico",
			// Sans espace : un nom qu'on `curl` sans guillemets depuis la release.
			artifactName: "neo-quiz-setup-${version}.${ext}",
		},
		linux: {
			target: "AppImage",
			icon: "icons/icon.png",
			category: "Education",
			artifactName: "neo-quiz-${version}.${ext}",
			/* `StartupWMClass` = `executableName` : c'est ainsi qu'un bureau
			   Linux relie la fenêtre à son entrée `.desktop` (avertissement
			   `WM_CLASS` du journal CI). */
			desktop: { entry: { Name: "Neo Quiz", StartupWMClass: "neo-quiz" } },
		},
		nsis: {
			oneClick: false,
			allowToChangeInstallationDirectory: true,
			/* La valeur par défaut, ÉCRITE pour qu'une lecture future ne la
			   « nettoie » pas : la mise à jour désinstalle l'ancienne version
			   avant d'installer la neuve, et `userData`
			   (`%APPDATA%\Neo Quiz\settings.json`, les dossiers ouverts) ne
			   survit que parce que ceci est faux. */
			deleteAppDataOnUninstall: false,
		},
	};
```

Vérifier dans `apps/windows/node_modules/app-builder-lib/out/options/linuxOptions.d.ts` que `desktop.entry` est bien la forme attendue (`LinuxDesktopFile.entry`), et dans `PlatformSpecificBuildOptions.d.ts` que `executableName` et `artifactName` y sont.

- [ ] **Step 4: Relancer le contrôle**

Run: `npm run check:package ; echo "exit=$LASTEXITCODE"`
Expected: le groupe « configuration résolue » passe ; le groupe « asar » ROUGIT encore sur `node_modules` (le paquet local est celui d'avant). Code 1.

- [ ] **Step 5: Reconstruire le paquet local et relancer**

Run: `npm --prefix apps/windows run pack:win ; echo "exit=$LASTEXITCODE"` (deux à quatre minutes ; NE PAS lancer l'installeur produit)
Expected: code 0 ; `apps/windows/dist-installer/neo-quiz-setup-2.5.0-beta.exe` existe (le nom a changé).
Run: `npm run check:package ; echo "exit=$LASTEXITCODE"`
Expected: code 0, les deux groupes passent.

- [ ] **Step 6: Discriminance**

Mettre temporairement `executableName: "neo quiz@"` dans la config, lancer `npm run check:package`, relever le libellé rouge exact (`ÉCHEC  executableName est immuable et sûr pour un chemin`), restaurer. Idem une fois avec `deleteAppDataOnUninstall: true`. Noter les deux libellés dans le rapport.

- [ ] **Step 7: `check:app` et `check:host` inchangés**

Run: `npm run check:app ; echo "exit=$LASTEXITCODE"` → 0.
Run: `npm run check:host ; echo "exit=$LASTEXITCODE"` → 0, « 6 fichier(s) ».

- [ ] **Step 8: CLAUDE.md**

Dans « Commandes », après la ligne `check:electron-process`, ajouter :

```
- `npm run check:package` — la configuration RÉSOLUE d'electron-builder (version
  = manifeste, `appId` et `executableName` immuables, `files` sans
  `node_modules` ni sourcemaps, `deleteAppDataOnUninstall` faux) et, si un
  `win-unpacked/` existe, le contenu de l'asar. `appId` est la clé par laquelle
  NSIS retrouve l'installation à remplacer ; `executableName` dérivé de
  `@neo-quiz/windows` a fait échouer chaque run CI Linux jusqu'au 2026-09-12.
```

Dans « Conventions & pièges », après le paragraphe sur `PLUGIN_ID` / `QUIZ_BLOCK_LANGUAGE`, ajouter :

```
- **Deux autres valeurs immuables, côté application** : `appId =
  "com.ahmed.neoquiz"` et `executableName = "neo-quiz"`
  (`apps/windows/electron-builder.config.mjs`). Le premier est la clé de
  registre de l'installation NSIS (changé, chaque mise à jour installe une
  seconde copie), le second le nom du binaire Linux. `check:package` les fige.
```

- [ ] **Step 9: Commit**

```bash
git add apps/windows/electron-builder.config.mjs scripts/check-package.mjs package.json CLAUDE.md
git commit -m "feat(app): l'empaquetage nomme son binaire, exclut node_modules, et check:package le fige"
```

---

### Task 2: La version à l'écran (« À propos »)

**Files:**
- Modify: `apps/windows/src/ui/settings.ts` (juste avant le `return () => { root.replaceChildren(); };` final)
- Modify: `src/i18n/en/settings.ts`, `src/i18n/fr/settings.ts`

**Interfaces:**
- Consumes: `src/assets/manifest.json` (`version`, `helpUrl`), `t()`, `ajouter()`, `PRODUCT_NAME` de `src/branding.ts`.
- Produces: rien pour les autres tâches ; la ligne « Neo Quiz {version} » que la liste d'épreuves de la Task 4 fait lire à Ahmed.

- [ ] **Step 1: Les clés i18n**

Dans `src/i18n/en/settings.ts`, après `"settings.ai.cliPath.placeholder"` (ou la dernière clé `settings.ai.*`), ajouter :

```ts
	/* ── À propos (application seulement) ── */
	"settings.about.title": "About",
	"settings.about.version": "{product} {version}",
	"settings.about.repo": "Source code and releases on GitHub",
```

Dans `src/i18n/fr/settings.ts`, au même endroit :

```ts
	/* ── À propos (application seulement) ── */
	"settings.about.title": "À propos",
	"settings.about.version": "{product} {version}",
	"settings.about.repo": "Code source et versions sur GitHub",
```

- [ ] **Step 2: Vérifier que le typage attrape une clé manquante**

Commenter temporairement la ligne FR `settings.about.repo`, lancer `npm run check` : il doit rougir sur `FR_SETTINGS`. Restaurer. Le dire dans le rapport.

- [ ] **Step 3: La section dans la page Réglages**

Dans `apps/windows/src/ui/settings.ts`, ajouter en tête de fichier :

```ts
import manifeste from "../../../../src/assets/manifest.json";
import { PRODUCT_NAME } from "../../../../src/branding";
```

et, juste avant le `return () => { root.replaceChildren(); };` final :

```ts
	/* ── À propos ──
	   LA VERSION VIENT DU MANIFESTE, importé en JSON et inliné par Vite : une
	   seule source (`src/assets/manifest.json`, cf. CLAUDE.md « Release »),
	   la même que l'installeur lit pour son numéro. Pas `app.getVersion()`
	   par le pont : il lit le `package.json` du paquet, qui porte `0.0.0` en
	   développement — cette ligne dirait alors deux choses selon qu'on est
	   installé ou non. C'est cette ligne qu'on lit pour prouver qu'une mise à
	   jour a remplacé l'ancienne version (épreuves de la tranche 6). */
	const apropos = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(apropos, "h3", "nq-reglages-titre", t("settings.about.title"));
	ajouter(apropos, "p", "nq-reglages-aide",
		t("settings.about.version", { product: PRODUCT_NAME, version: manifeste.version }));
	const depot = ajouter(apropos, "a", "nq-reglages-lien", t("settings.about.repo"));
	depot.href = manifeste.helpUrl;
	// `_blank` : le principal remet toute ouverture `https?:` au navigateur
	// (`setWindowOpenHandler`, `main.ts`) — même geste que les liens de la
	// page « Générer ».
	depot.target = "_blank";
	depot.rel = "noopener";
```

Vérifier que `t()` accepte bien un second argument de substitutions `{product, version}` (lire la signature dans `src/i18n.ts`) et que `ajouter` accepte `"a"` avec un texte (lire `src/dom.ts`). `nq-reglages-lien` n'existe pas encore : l'ajouter dans `apps/windows/src/assets/shell.css` (le fichier où vivent les `nq-reglages-*`), à côté de `.nq-reglages-aide` :

```css
.nq-reglages-lien { color: var(--text-accent); font-size: var(--font-ui-small); }
.nq-reglages-lien:hover { text-decoration: underline; }
```

en vérifiant d'abord que `--text-accent` et `--font-ui-small` sont définies dans `host-vars.css` (`npm run check:theme` le dira sinon).

- [ ] **Step 4: Contrôles**

Run: `npm run check ; echo "exit=$LASTEXITCODE"` → 0.
Run: `npm run check:app ; echo "exit=$LASTEXITCODE"` → 0.
Run: `npm run check:host ; echo "exit=$LASTEXITCODE"` → 0, « 6 fichier(s) ».
Run: `npm run check:theme ; echo "exit=$LASTEXITCODE"` → 0.
Run: `npm run check:windows-host ; echo "exit=$LASTEXITCODE"` → 0.

- [ ] **Step 5: Commit**

```bash
git add apps/windows/src/ui/settings.ts src/i18n/en/settings.ts src/i18n/fr/settings.ts apps/windows/src/assets/shell.css
git commit -m "feat(app): la page Reglages affiche la version, lue du manifeste"
```

**À vérifier à l'écran par Ahmed (livré avec la tâche)** : `npm run app:dev`, page Réglages, en bas : « Neo Quiz 2.5.0-beta » et un lien qui ouvre le dépôt dans le navigateur, pas dans la fenêtre.

---

### Task 3: La chaîne de publication (CI et release)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `npm run check:package` (Task 1), `node scripts/set-version.mjs <version>` (existe : accepte un numéro exact, n'écrit que `src/assets/manifest.json`), les artefacts `neo-quiz-setup-${version}.exe` et `neo-quiz-${version}.AppImage` (Task 1).
- Produces: sur tag `v*`, une release avec cinq fichiers ; sur `workflow_dispatch`, trois artefacts de workflow sans release.

- [ ] **Step 1: `ci.yml` — réparer le job Linux, ajouter le job Windows**

Remplacer le job `app-linux-package` (tout le bloc, commentaire compris) par :

```yaml
  # Le paquet Linux de l'application : AppImage exige un runner Linux, ce
  # que le poste de développement (Windows) ne peut pas fournir. Job séparé du
  # greffon : une casse ici ne bloque pas la publication du greffon Obsidian.
  #
  # DEUX `npm ci`, DANS CET ORDRE (Ruling 22). Le code partagé qu'`apps/windows`
  # compile importe des paquets déclarés uniquement dans le `package.json` de
  # la RACINE (`mathlive`, `json5`) : un `npm ci` limité à `apps/windows`
  # laisse ces imports introuvables (125 erreurs `tsc` sans le premier
  # `npm ci`, 0 avec, mesuré dans un worktree sans `node_modules` racine).
  #
  # Plus de `continue-on-error` : il masquait un job qui n'a JAMAIS été vert
  # (chaque run échouait sur `executableName` dérivé de `@neo-quiz/windows`,
  # réparé par `executableName: "neo-quiz"` dans la config, tranche 6).
  app-linux-package:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v7

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies (racine)
        run: npm ci

      - name: Install dependencies (apps/windows)
        run: npm ci
        working-directory: apps/windows

      - name: Build and package (AppImage)
        run: npm run pack:linux
        working-directory: apps/windows

      - name: Package config and contents
        run: npm run check:package

      - name: Check package artifact
        run: ls -lh dist-installer/*.AppImage
        working-directory: apps/windows

      - name: Upload AppImage
        uses: actions/upload-artifact@v4
        with:
          name: neo-quiz-linux-appimage
          path: apps/windows/dist-installer/*.AppImage
          if-no-files-found: error

  # Le paquet Windows, symétrique. Il attrape ce que Linux ne voit pas : NSIS,
  # `rcedit` sur l'exécutable, les chemins Windows. Dépôt public, minutes
  # gratuites. `check:package` y lit AUSSI l'asar de `win-unpacked/`, que seul
  # `pack:win` produit.
  app-windows-package:
    runs-on: windows-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v7

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies (racine)
        run: npm ci

      - name: Install dependencies (apps/windows)
        run: npm ci
        working-directory: apps/windows

      - name: Build and package (NSIS)
        run: npm run pack:win
        working-directory: apps/windows

      - name: Package config and contents
        run: npm run check:package

      - name: Upload installer
        uses: actions/upload-artifact@v4
        with:
          name: neo-quiz-windows-setup
          path: apps/windows/dist-installer/*.exe
          if-no-files-found: error
```

- [ ] **Step 2: `release.yml` — trois jobs et le mode répétition**

Remplacer le fichier entier par :

```yaml
name: Release Neo Quiz

# Deux déclencheurs, une seule chaîne :
#   - un tag `v*` PUBLIE : release GitHub avec le greffon (main.js, styles.css,
#     manifest.json), l'installeur Windows et l'AppImage ;
#   - `workflow_dispatch` RÉPÈTE sans publier : mêmes jobs, mêmes builds, mais
#     les fichiers sont déposés en artefacts de workflow et aucune release
#     n'est créée. C'est ainsi qu'on éprouve cette chaîne sur un dépôt public
#     sans laisser une release de test derrière soi.
on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: "Version à répéter (sans le v), écrite dans le manifeste le temps du build"
        required: true
        default: "0.0.0-repetition"

jobs:
  plugin:
    runs-on: ubuntu-latest

    permissions:
      contents: write

    outputs:
      version: ${{ steps.version.outputs.version }}
      tag: ${{ steps.version.outputs.tag }}

    steps:
      - name: Checkout
        uses: actions/checkout@v7

      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      # Sur tag : la version vient du tag. En répétition : de l'entrée saisie.
      - name: Resolve version
        id: version
        shell: bash
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            echo "version=${{ github.event.inputs.version }}" >> "$GITHUB_OUTPUT"
            echo "tag=v${{ github.event.inputs.version }}" >> "$GITHUB_OUTPUT"
          else
            tag="${GITHUB_REF#refs/tags/}"
            echo "tag=$tag" >> "$GITHUB_OUTPUT"
            echo "version=${tag#v}" >> "$GITHUB_OUTPUT"
          fi

      # UNE SEULE façon d'écrire la version : le script du dépôt, jamais un
      # `node -e` inline qui divergerait de lui.
      - name: Update manifest version
        run: node scripts/set-version.mjs "${{ steps.version.outputs.version }}"

      - name: Type check
        run: npm run check

      # Le build passe par esbuild.config.mjs : une config esbuild dupliquée ici
      # diverge en silence (les loaders de fontes MathLive y ont manqué).
      # Hors Windows, aucun vault n'est détecté : la sortie reste dans dist/.
      - name: Build
        run: npm run build

      - name: Collect release files
        run: |
          mkdir -p release
          cp dist/main.js dist/styles.css release/
          cp src/assets/manifest.json release/manifest.json
          ls -lh release/

      - name: Upload plugin (répétition)
        if: github.event_name == 'workflow_dispatch'
        uses: actions/upload-artifact@v4
        with:
          name: neo-quiz-plugin
          path: release/*
          if-no-files-found: error

      - name: Create Release
        if: github.event_name != 'workflow_dispatch'
        uses: softprops/action-gh-release@v2
        with:
          name: "${{ steps.version.outputs.tag }}"
          body: "Release ${{ steps.version.outputs.tag }}"
          # Pré-version dès que le tag porte un suffixe semver (v2.0.0-beta,
          # -rc.1, -alpha…) : c'est la définition même de semver, donc une
          # future v2.1.0 sans suffixe sortira en release normale sans qu'on
          # ait à repasser ici.
          prerelease: ${{ contains(steps.version.outputs.tag, '-') }}
          files: |
            release/main.js
            release/manifest.json
            release/styles.css

  # L'application, deux paquets, deux runners. `needs: plugin` pour deux
  # raisons : la release existe déjà quand ils y attachent leurs fichiers, et
  # un greffon qui ne compile pas n'a pas à produire d'installeur. Un échec
  # de l'un des deux n'annule ni l'autre ni la release du greffon.
  app-windows:
    needs: plugin
    runs-on: windows-latest
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@v7
      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 20
      - name: Install dependencies (racine)
        run: npm ci
      - name: Install dependencies (apps/windows)
        run: npm ci
        working-directory: apps/windows
      - name: Update manifest version
        run: node scripts/set-version.mjs "${{ needs.plugin.outputs.version }}"
      - name: Build and package (NSIS)
        run: npm run pack:win
        working-directory: apps/windows
      - name: Package config and contents
        run: npm run check:package
      - name: Upload installer (répétition)
        if: github.event_name == 'workflow_dispatch'
        uses: actions/upload-artifact@v4
        with:
          name: neo-quiz-windows-setup
          path: apps/windows/dist-installer/*.exe
          if-no-files-found: error
      # Le `.blockmap` n'est PAS attaché : il ne sert qu'à electron-updater,
      # qui n'est pas branché (spec, §2.5).
      - name: Attach installer to release
        if: github.event_name != 'workflow_dispatch'
        uses: softprops/action-gh-release@v2
        with:
          tag_name: "${{ needs.plugin.outputs.tag }}"
          files: apps/windows/dist-installer/*.exe

  app-linux:
    needs: plugin
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@v7
      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 20
      - name: Install dependencies (racine)
        run: npm ci
      - name: Install dependencies (apps/windows)
        run: npm ci
        working-directory: apps/windows
      - name: Update manifest version
        run: node scripts/set-version.mjs "${{ needs.plugin.outputs.version }}"
      - name: Build and package (AppImage)
        run: npm run pack:linux
        working-directory: apps/windows
      - name: Package config and contents
        run: npm run check:package
      - name: Upload AppImage (répétition)
        if: github.event_name == 'workflow_dispatch'
        uses: actions/upload-artifact@v4
        with:
          name: neo-quiz-linux-appimage
          path: apps/windows/dist-installer/*.AppImage
          if-no-files-found: error
      - name: Attach AppImage to release
        if: github.event_name != 'workflow_dispatch'
        uses: softprops/action-gh-release@v2
        with:
          tag_name: "${{ needs.plugin.outputs.tag }}"
          files: apps/windows/dist-installer/*.AppImage
```

Avant d'écrire : vérifier dans `scripts/set-version.mjs` que l'appel avec un numéro exact (`node scripts/set-version.mjs 2.5.1-beta`) écrit bien le manifeste et sort en 0 sans rien demander (le lancer sur une copie, ou lire `main()`), et qu'un numéro comme `0.0.0-repetition` est accepté par sa validation semver ; sinon prendre `0.0.0-beta` comme défaut de l'entrée.

- [ ] **Step 3: Valider la syntaxe des deux workflows en local**

Run: `node -e "const y=require('js-yaml')" 2>$null` — si `js-yaml` n'est pas disponible, lire les deux fichiers une fois de plus en vérifiant l'indentation ; sinon : `node -e "const y=require('js-yaml');for(const f of ['.github/workflows/ci.yml','.github/workflows/release.yml'])y.load(require('fs').readFileSync(f,'utf8'));console.log('ok')"`.
Expected: `ok` ou aucune erreur de lecture.

- [ ] **Step 4: Commit (sans push : le contrôleur pousse et observe)**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: l'AppImage et l'installeur NSIS a chaque push, publies a chaque tag, repetables sans release"
```

**Ce que le contrôleur fait ensuite** (pas l'implémenteur) : `git push origin main`, `gh run watch` sur le run CI ; si `app-linux-package` ou `app-windows-package` est rouge, lire le journal, corriger, recommiter. Puis `gh workflow run release.yml -f version=0.0.0-repetition` et vérifier que les trois artefacts sont déposés et qu'AUCUNE release n'apparaît (`gh release list`).

---

### Task 4: Le banc d'essai, les épreuves, le README

**Files:**
- Create: `apps/windows/sandbox/neo-quiz.wsb`
- Create: `apps/windows/sandbox/vault/Cybersécurité.md`, `apps/windows/sandbox/vault/Réseaux.md`
- Modify: `.gitignore`
- Create: `docs/superpowers/notes/2026-09-13-tranche-6-epreuves-ecran.md`
- Modify: `README.md` (section « Installation »)

**Interfaces:**
- Consumes: le nom des artefacts (Task 1), la ligne « À propos » (Task 2).
- Produces: la liste qu'Ahmed coche.

- [ ] **Step 1: Le fichier Windows Sandbox**

Créer `apps/windows/sandbox/neo-quiz.wsb` :

```xml
<!--
  LA MACHINE PROPRE : Windows Sandbox (Windows 11 Pro, hyperviseur actif).
  Sans Node, sans Ollama, sans CLI, sans %APPDATA%\Neo Quiz, jetée à la
  fermeture : c'est la définition de « machine propre », reproductible à
  chaque essai. Activation unique, en administrateur puis redémarrage :
    Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM
  Puis double-clic sur ce fichier.

  Les chemins d'hôte sont ABSOLUS parce que le format .wsb n'admet ni
  variable ni chemin relatif ; ils sont ceux du poste d'Ahmed.
-->
<Configuration>
  <Networking>Enable</Networking>
  <MappedFolders>
    <!-- Les installeurs, en lecture seule : le bac à sable ne peut rien y écrire. -->
    <MappedFolder>
      <HostFolder>C:\dev\neo-quiz\apps\windows\dist-installer</HostFolder>
      <SandboxFolder>C:\Users\WDAGUtilityAccount\Desktop\installeur</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <!-- Le vault d'essai, en lecture-écriture : le journal de révision
         (.neo-quiz/) et les quiz générés (Generated/) s'y écrivent, et
         restent lisibles depuis le poste après la fermeture du bac à sable. -->
    <MappedFolder>
      <HostFolder>C:\dev\neo-quiz\apps\windows\sandbox\vault</HostFolder>
      <SandboxFolder>C:\Users\WDAGUtilityAccount\Desktop\vault</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
</Configuration>
```

- [ ] **Step 2: Le vault d'essai**

Créer `apps/windows/sandbox/vault/Cybersécurité.md` avec, sous un titre `# Cybersécurité`, un bloc ` ```quiz-blocks ` contenant les questions `demo-1` à `demo-3` de `demo-template.md` (copier le JSON5 tel quel, en fermant le tableau). Créer `apps/windows/sandbox/vault/Réseaux.md` avec un bloc de deux questions `single` écrites à la main, dont une avec du LaTeX dans l'énoncé (`Quelle est la valeur de $2^{10}$ ?`, options `1000`, `1024`, `2048`, `correctIndex: 1`) et une `text` (`Quel port TCP sert HTTPS ?`, `answer: '443'`). Relire `src/types/quiz.ts` pour la forme exacte d'une question `text` avant d'écrire.

Ajouter à `.gitignore`, après le bloc `apps/windows/src-tauri/` :

```
# Le vault d'essai du bac à sable (apps/windows/sandbox/neo-quiz.wsb) est
# commité avec ses deux notes ; ce que l'application y écrit pendant une
# épreuve ne l'est pas.
apps/windows/sandbox/vault/.neo-quiz/
apps/windows/sandbox/vault/Generated/
apps/windows/sandbox/vault/.trash/
```

Vérifier que les deux blocs se LISENT, sans piloter l'application : un script jetable dans le scratchpad (pas dans le dépôt), sur le modèle de `scripts/check-export.mjs` ligne 212 :

```js
import { withSrcModule } from "C:/dev/neo-quiz/scripts/lib/load-src.mjs";
import { readFileSync } from "node:fs";
await withSrcModule("src/quiz-utils.ts", ({ parseQuizSource, QUIZ_BLOCK_RE }) => {
	for (const f of ["Cybersécurité.md", "Réseaux.md"]) {
		const md = readFileSync(`C:/dev/neo-quiz/apps/windows/sandbox/vault/${f}`, "utf8");
		const m = md.match(QUIZ_BLOCK_RE);
		console.log(f, m ? parseQuizSource(m[1] ?? m[0]).length + " questions" : "AUCUN BLOC");
	}
});
```

Lire `QUIZ_BLOCK_RE` dans `src/quiz-utils.ts` pour savoir quel groupe capture le corps du bloc. Attendu : `3 questions` et `2 questions`. Le supprimer après.

- [ ] **Step 3: La liste d'épreuves**

Créer `docs/superpowers/notes/2026-09-13-tranche-6-epreuves-ecran.md` :

```markdown
# Tranche 6 — les épreuves à l'écran

À cocher par Ahmed. Rien ici ne se vérifie par un script : c'est de
l'installation, du clic, du moment. Chaque ligne dit ce qu'on regarde et ce
qui compte comme échec.

## Avant de commencer (une fois)

- [ ] Activer Windows Sandbox, en administrateur, puis redémarrer :
      `Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM`
- [ ] `npm --prefix apps/windows run pack:win` : `apps/windows/dist-installer/`
      contient `neo-quiz-setup-2.5.0-beta.exe`
- [ ] Pour l'épreuve de mise à jour, un SECOND installeur d'une version
      supérieure : `node scripts/set-version.mjs 2.5.1-beta`, `pack:win`,
      puis `git checkout src/assets/manifest.json` (le bump n'est PAS commité).
      Les deux `.exe` cohabitent dans `dist-installer/`.

## A. L'installation

- [ ] Double-clic sur `apps/windows/sandbox/neo-quiz.wsb` : le bac à sable
      s'ouvre avec `installeur` et `vault` sur son bureau.
- [ ] Lancer `neo-quiz-setup-2.5.0-beta.exe`. SmartScreen s'affiche
      (« Windows a protégé votre ordinateur ») : « Informations
      complémentaires », « Exécuter quand même ». C'est attendu, non signé
      (spec §2.1). ÉCHEC si l'installeur ne démarre pas du tout après ça.
- [ ] L'assistant propose un dossier ; en changer (par exemple
      `C:\NeoQuizTest`). L'installation se termine, un raccourci « Neo Quiz »
      est sur le bureau et dans le menu Démarrer.

## B. Le premier lancement, sans rien

- [ ] Lancer Neo Quiz. La fenêtre s'ouvre sur l'écran « aucun dossier », la
      liste des vaults Obsidian est ABSENTE (pas d'Obsidian dans le bac à
      sable). ÉCHEC : écran blanc, erreur au démarrage.
- [ ] Réglages, en bas : « Neo Quiz 2.5.0-beta ». Le lien ouvre le dépôt
      dans Edge, pas dans la fenêtre.
- [ ] Page « Générer » : les trois fournisseurs sont détectés ABSENTS
      (Claude et Codex « non installé » avec leur commande d'installation
      pour Windows, Ollama « hors ligne »). Aucune Notice d'erreur qui
      revient en boucle.

## C. Un dossier, une révision

- [ ] Réglages, « Ajouter un dossier », choisir `Desktop\vault`. Accueil : les
      deux quiz (Cybersécurité, Réseaux) apparaissent.
- [ ] Ouvrir Réseaux, « Start », répondre aux deux questions (le LaTeX
      $2^{10}$ est rendu). Retour : la carte « À réviser » a bougé.
- [ ] Sur le poste, `apps/windows/sandbox/vault/.neo-quiz/review-log.jsonl`
      existe et contient les lignes de cette révision.

## D. Une génération Ollama (une des deux voies)

- [ ] Voie 1 : installer Ollama DANS le bac à sable (ollama.com/download,
      réseau actif), `ollama pull` d'un petit modèle. Voie 2 : sur le poste,
      Ollama lancé avec `OLLAMA_HOST=0.0.0.0`, et dans le bac à sable
      Réglages, `aiOllamaUrl` = `http://<IP LAN du poste>:11434` — une
      adresse RFC 1918 est admise SANS confirmation native (garde de la clé
      `ai`) ; ÉCHEC si une confirmation s'affiche.
- [ ] Générer, fournisseur Ollama, demande courte avec `@Réseaux.md`. Le
      quiz s'enregistre dans `vault/Generated/` et sa page s'ouvre sur
      « Lancer ».

## E. La mise à jour par-dessus

- [ ] Fermer Neo Quiz. Relancer `neo-quiz-setup-2.5.0-beta.exe` (LA MÊME
      version) par-dessus : l'assistant réinstalle sans erreur. Relancer :
      le dossier `vault` est toujours ouvert, « À propos » inchangé.
- [ ] Fermer. Lancer `neo-quiz-setup-2.5.1-beta.exe`. Relancer : « Neo Quiz
      2.5.1-beta », le dossier `vault` est toujours ouvert, la date d'examen
      ou l'URL Ollama saisie plus haut est toujours là. Un SEUL raccourci
      sur le bureau, une SEULE entrée « Neo Quiz » dans Paramètres,
      Applications. ÉCHEC : deux entrées, réglages perdus.

## F. La désinstallation

- [ ] Paramètres, Applications, Neo Quiz, Désinstaller. Le dossier
      d'installation est vide ; `vault/` et `vault/.neo-quiz/` sont intacts
      sur le poste.

## G. L'AppImage, sous WSL

- [ ] Une fois : `wsl --install` (Ubuntu), redémarrer.
- [ ] Télécharger l'artefact `neo-quiz-linux-appimage` du dernier run CI
      (`gh run download --name neo-quiz-linux-appimage`), le copier dans
      WSL (`/home/<user>/`), `chmod +x neo-quiz-2.5.0-beta.AppImage`.
- [ ] `./neo-quiz-2.5.0-beta.AppImage`. Sans FUSE, relancer avec
      `--appimage-extract-and-run`. Si Chromium refuse son bac à sable SUID
      (AppArmor d'Ubuntu 24.04), ajouter `--no-sandbox`. La fenêtre s'ouvre
      (WSLg). Ouvrir un dossier (`/mnt/c/dev/neo-quiz/apps/windows/sandbox/vault`) :
      les deux quiz apparaissent.
```

- [ ] **Step 4: Le README**

Dans `README.md`, après le paragraphe « BRAT will notify you whenever a new version is available and update with one click. » et avant le `---` qui suit, ajouter :

```markdown
### Desktop app (Windows, Linux)

The desktop app reads the same quiz folders and the same review log as the plugin, and generates quizzes with the same local AI tools.

1. Download the latest release from the [releases page](https://github.com/ahmed-mili/neo-quiz/releases): `neo-quiz-setup-<version>.exe` on Windows, `neo-quiz-<version>.AppImage` on Linux.
2. **Windows:** the installer is not code-signed, so SmartScreen shows "Windows protected your PC" on first run. Click **More info**, then **Run anyway**. Pick an install folder; the app is per-user and needs no admin rights.
3. **Linux:** `chmod +x neo-quiz-<version>.AppImage` and run it. Without FUSE, run it with `--appimage-extract-and-run`.

**Updating:** download the new installer and run it over the existing installation. Your folders and settings live in `%APPDATA%\Neo Quiz` and are kept; the review log lives in your quiz folder (`.neo-quiz/`) and is never touched. The version you are running is shown at the bottom of **Settings**.

**Uninstalling** removes the app only. Your quiz folders and their review log stay where they are.
```

- [ ] **Step 5: Contrôles**

Run: `npm run check ; echo "exit=$LASTEXITCODE"` → 0 (rien de TS ne bouge, mais c'est le contrôle minimal).
Run: `git status --short` : aucun fichier sous `apps/windows/sandbox/vault/.neo-quiz/` ni `Generated/` n'apparaît (rien n'y a été écrit, mais le `.gitignore` est là).

- [ ] **Step 6: Commit**

```bash
git add apps/windows/sandbox .gitignore docs/superpowers/notes/2026-09-13-tranche-6-epreuves-ecran.md README.md
git commit -m "docs(app): le banc d'essai Windows Sandbox, les epreuves de l'installeur, le README"
```

---

### Task 5: Les deux installeurs pour les épreuves (contrôleur)

Pas d'implémenteur : le contrôleur exécute, sur le poste.

- [ ] `npm --prefix apps/windows run pack:win` → `dist-installer/neo-quiz-setup-2.5.0-beta.exe`.
- [ ] `node scripts/set-version.mjs 2.5.1-beta`, `npm --prefix apps/windows run pack:win`, puis `git checkout src/assets/manifest.json` → `neo-quiz-setup-2.5.1-beta.exe` à côté. Vérifier `git status` propre.
- [ ] `npm run check:package` → 0.
- [ ] Ne PAS lancer les installeurs.
- [ ] Remettre à Ahmed la liste d'épreuves (`docs/superpowers/notes/2026-09-13-tranche-6-epreuves-ecran.md`) et l'état de la CI.
