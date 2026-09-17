# Utilisable par n'importe qui : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quelqu'un qui installe Neo Quiz sans connaître Claude Code ni un terminal génère son premier quiz : l'accueil ne parle plus de `quiz-blocks`, un fournisseur absent s'installe d'un clic depuis l'application, et la version qui livre tout ça (`desktop-v1.2.0`) est la première d'un système SemVer strict porté par `CHANGELOG.md`.

**Architecture:** Sept points d'une même spec, dans une seule version. Le système de versions (CHANGELOG + `git ship` qui en déduit le niveau) vient en premier parce que chaque tâche suivante y écrit sa ligne. L'installation en un clic suit le patron du pont : le rendu n'envoie qu'un NOM d'outil, le principal juge (liste blanche), confirme (dialogue natif), et lance une recette FIXE dans un terminal visible. L'aperçu d'une note reprend les snippets du vault d'où elle vient, portés par `@scope` au seul aperçu. Le sélecteur natif de fichiers admet ce qu'il rend au périmètre en lecture seule.

**Tech Stack:** TypeScript strict, Electron 44 (Chromium avec `@scope`), esbuild, Node 22, scripts de contrôle Node (`withSrcModule` + `makeReporter`, ou `node:test` pour les scripts de livraison), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-utilisable-par-nimporte-qui-design.md`

## Global Constraints

- **Aucune chaîne visible en dur** : `t("<domaine>.<clé>")`, anglais de référence `src/i18n/en/*.ts`, français typé `src/i18n/fr/*.ts` (une clé oubliée en `fr` est une erreur de compilation). Les noms de marque (Claude Code, Codex CLI, Ollama, PowerShell) ne se traduisent pas.
- **Commentaires en français**, le POURQUOI. Pas d'emoji, pas d'em-dash dans le code ni les commits. `CHANGELOG.md` est en **anglais seul**.
- **`t()` au rendu**, jamais dans une constante de module.
- **Le rendu (`apps/windows/src/`) n'importe jamais un module qui tire Node** ; `npm run check:host` reste vert. `src/` n'importe rien d'Obsidian ni d'`apps/`.
- **Le rendu n'envoie jamais un chemin d'exécutable ni une commande** sur un canal `processus.*` : un NOM d'outil de la liste `OUTILS` (`apps/windows/electron/process.ts`), jugé par `estOutilAutorise` AVANT tout.
- **Le périmètre des dossiers ne change pas** ; un fichier admis par le sélecteur natif l'est en LECTURE et OUVERTURE seulement (`borner`), jamais en écriture (`bornerEcriture`).
- **Immuables** : `PLUGIN_ID`, `QUIZ_BLOCK_LANGUAGE`, `appId`, `executableName`, les clés du format quiz.
- Scripts de contrôle : `process.exitCode`, jamais `process.exit()` ; chaque cas neuf s'éprouve par DISCRIMINANCE (casser la règle, voir rougir, restaurer) ; juger sur le CODE DE SORTIE.
- Dropdowns : `ui-select.ts` seulement ; icônes : `host.ui.setIcon` (Lucide) ; jamais d'emoji.
- Aucun agent ne pilote la souris, le clavier ni le premier plan du PC d'Ahmed. La sonde de la tâche 3 ouvre UNE fenêtre PowerShell, et seulement après qu'Ahmed a dit oui.
- Commits sur `main`, sans push par les implémenteurs. Chaque tâche ajoute sa ligne sous `## [Unreleased]` de `CHANGELOG.md` (tâches 5 à 11) dans son propre commit.
- Après chaque tâche TS : `npm run check` ; si `apps/windows` bouge : `npm run check:app` ; si un contrôle bouge : le lancer et lire son code de sortie.

---

### Task 1: `CHANGELOG.md` et son lecteur pur

**Files:**
- Create: `CHANGELOG.md`
- Create: `scripts/changelog.mjs`
- Create: `scripts/changelog.test.mjs`
- Modify: `package.json` (scripts `test`, `check:changelog`)
- Modify: `.github/workflows/ci.yml` (une étape `check:changelog` après `check:installer`)

**Interfaces:**
- Produces (lus par la tâche 2 et par `release.yml`) :
  - `lireUnreleased(texte: string): { sections: Record<"Breaking"|"Added"|"Changed"|"Fixed", string[]> } | null` — `null` si aucune section `## [Unreleased]`.
  - `deduireNiveau(sections): "major" | "minor" | "patch" | null` — `null` quand les quatre listes sont vides.
  - `niveauEntre(courante: string, demandee: string): "major" | "minor" | "patch" | null` — le niveau qu'un saut de version représente ; `null` si `demandee` n'est pas strictement supérieure.
  - `rang(niveau): number` — `major` 3, `minor` 2, `patch` 1.
  - `figer(texte: string, version: string, dateIso: string): string` — renomme `## [Unreleased]` en `## [X.Y.Z] - AAAA-MM-JJ` et rouvre `## [Unreleased]` vide au-dessus ; le reste du fichier est conservé octet pour octet.
  - `extraire(texte: string, version: string): string` — le corps de `## [X.Y.Z] - …` (sans son titre), lève si absent.
  - CLI : `node scripts/changelog.mjs extract 1.2.0` écrit ce corps sur stdout (code 1 et message si absent).

- [ ] **Step 1: Écrire `CHANGELOG.md` avec l'historique rétroactif**

Le format est Keep a Changelog, à la lettre : `## [Unreleased]`, puis `## [X.Y.Z] - AAAA-MM-JJ`, sous-titres `### Breaking` / `### Added` / `### Changed` / `### Fixed` dans cet ordre, seulement ceux qui ont une entrée. Une entrée = une ligne `- …`, orientée utilisateur, sans nom de fichier ni SHA.

```markdown
# Changelog

All notable changes to the Neo Quiz desktop app are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the version numbers follow [Semantic Versioning](https://semver.org/):
a **major** version breaks something you rely on (quiz format, review log,
settings location), a **minor** version adds or changes something you can
see, a **patch** version only fixes what a previous version already promised.

`git ship` reads the `[Unreleased]` section to pick the next number, and
refuses to ship when it is empty. Each GitHub release carries its section as
release notes.

## [Unreleased]

## [1.1.0] - 2026-09-17

### Added
- Thirty-five built-in wallpapers, five per theme, with a picker in Settings; a folder of your own images still works.
- "Open an existing folder" when creating a folder: pick any folder you already have, an Obsidian vault folder for instance.
- A destination folder for generated quizzes, chosen in the generation options.
- A folder page lists its documents, links and notes below its quizzes; "Create with AI" from a folder attaches them for you.
- PDF attachments: their text is extracted and their first page shown on the card; a click opens a preview.
- A rendered preview of attached notes (headings, lists, callouts, tables, code).
- Folder cards show their path, and the folder can be opened or its path copied from the card menu.

### Changed
- The "Generated" folder is a staging area, not a subject: no progress panel, a sparkles icon.
- The AI provider menu shows a dot only when something is wrong (server stopped, not installed).
- Attachments in the composer are cards, like on claude.ai.
- Two play modes, Learn and Exam; "Practice" is gone.

### Fixed
- Creating a new quiz inside a nested folder failed.
- Folder cards no longer jump on hover, and their glow no longer switches off.
- Two neighbouring folder cards no longer get different widths.

## [1.0.3] - 2026-09-16

### Added
- Linux packages: AppImage (x86_64 and ARM64) and a .deb, with automatic updates for both.

### Fixed
- The installer shows real progress instead of an idle bar that jumps to 99 %.
- Running the installer over an existing installation now says "Neo Quiz is already installed" and offers to open it.
- The installer window no longer flickers while downloading.

Version 1.0.2 was withdrawn the same day; its changes are part of 1.0.3.

## [1.0.1] - 2026-09-15

### Added
- A Language setting (auto, English, French) in Settings › General.

### Changed
- The installer is redesigned after Google Play Games: one window, one button, the install location and the disk space on one line.
- The installer reads the release manifest directly and no longer depends on the GitHub API rate limit.

### Fixed
- The application window stays hidden until it is ready to be shown.

## [1.0.0] - 2026-09-13

### Added
- The Neo Quiz desktop app, independent from the Obsidian plugin: read, review, edit and generate quizzes from the folders you open, with automatic updates.
```

- [ ] **Step 2: Écrire les tests (`node:test`), qui échouent**

```js
// scripts/changelog.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { lireUnreleased, deduireNiveau, niveauEntre, rang, figer, extraire } from "./changelog.mjs";

const EXEMPLE = `# Changelog

Intro.

## [Unreleased]

### Added
- One-click install of Claude Code.

### Fixed
- Provider dots line up.

## [1.1.0] - 2026-09-17

### Added
- Wallpapers.
`;

test("lireUnreleased rend les quatre listes, vides ou non", () => {
	assert.deepEqual(lireUnreleased(EXEMPLE), {
		sections: {
			Breaking: [],
			Added: ["One-click install of Claude Code."],
			Changed: [],
			Fixed: ["Provider dots line up."],
		},
	});
});

test("lireUnreleased rend null sans section Unreleased", () => {
	assert.equal(lireUnreleased("# Changelog\n\n## [1.0.0] - 2026-09-13\n"), null);
});

test("deduireNiveau : Breaking gagne, puis Added/Changed, puis Fixed, sinon null", () => {
	const vide = { Breaking: [], Added: [], Changed: [], Fixed: [] };
	assert.equal(deduireNiveau({ ...vide, Breaking: ["x"], Fixed: ["y"] }), "major");
	assert.equal(deduireNiveau({ ...vide, Changed: ["x"] }), "minor");
	assert.equal(deduireNiveau({ ...vide, Added: ["x"], Fixed: ["y"] }), "minor");
	assert.equal(deduireNiveau({ ...vide, Fixed: ["y"] }), "patch");
	assert.equal(deduireNiveau(vide), null);
});

test("niveauEntre lit le saut, et refuse un recul", () => {
	assert.equal(niveauEntre("1.1.0", "2.0.0"), "major");
	assert.equal(niveauEntre("1.1.0", "1.2.0"), "minor");
	assert.equal(niveauEntre("1.1.0", "1.1.1"), "patch");
	assert.equal(niveauEntre("1.1.0", "1.1.0"), null);
	assert.equal(niveauEntre("1.1.0", "1.0.9"), null);
});

test("rang ordonne les niveaux", () => {
	assert.ok(rang("major") > rang("minor") && rang("minor") > rang("patch"));
});

test("figer renomme Unreleased, rouvre une section vide, garde le reste", () => {
	const fige = figer(EXEMPLE, "1.2.0", "2026-09-20");
	assert.ok(fige.includes("## [Unreleased]\n\n## [1.2.0] - 2026-09-20\n\n### Added\n- One-click install of Claude Code."));
	assert.ok(fige.endsWith("## [1.1.0] - 2026-09-17\n\n### Added\n- Wallpapers.\n"));
	assert.equal(fige.indexOf("## [Unreleased]"), fige.lastIndexOf("## [Unreleased]"));
});

test("extraire rend le corps d'une version, sans son titre", () => {
	assert.equal(extraire(EXEMPLE, "1.1.0"), "### Added\n- Wallpapers.");
	assert.throws(() => extraire(EXEMPLE, "9.9.9"), /9\.9\.9/);
});
```

- [ ] **Step 3: Lancer le test, le voir échouer**

Run: `node --test scripts/changelog.test.mjs`
Expected: échec « Cannot find module './changelog.mjs' ».

- [ ] **Step 4: Écrire `scripts/changelog.mjs`**

```js
/*
 * LE CHANGELOG, LU ET ÉCRIT PAR LA MACHINE.
 *
 * `git ship` ne prend plus de niveau à la main pour l'application : il lit la
 * section `## [Unreleased]` de `CHANGELOG.md` et en DÉDUIT le niveau —
 * `Breaking` → major, sinon `Added` ou `Changed` → minor, sinon `Fixed` →
 * patch — puis renomme la section en `## [X.Y.Z] - date` dans le commit
 * « Version X.Y.Z ». `release.yml` extrait ce bloc comme notes de la release.
 * C'est ce qui rend le numéro STRICT : il ne peut pas dire moins que ce que le
 * fichier annonce, et une version sans une ligne ne se livre pas.
 *
 *     node scripts/changelog.mjs extract 1.2.0
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FICHIER = "CHANGELOG.md";
export const SECTIONS = ["Breaking", "Added", "Changed", "Fixed"];
const TITRE_UNRELEASED = "## [Unreleased]";
const RANGS = { major: 3, minor: 2, patch: 1 };

/** Le texte entre un titre `## …` et le suivant (ou la fin). `null` si absent. */
function bloc(texte, titre) {
	const debut = texte.indexOf(titre + "\n");
	if (debut < 0 && !texte.endsWith(titre)) return null;
	const apresTitre = debut < 0 ? texte.length : debut + titre.length + 1;
	const suivant = texte.indexOf("\n## ", apresTitre);
	return { debut, fin: suivant < 0 ? texte.length : suivant + 1, corps: texte.slice(apresTitre, suivant < 0 ? texte.length : suivant + 1) };
}

export function lireUnreleased(texte) {
	const b = bloc(texte, TITRE_UNRELEASED);
	if (!b) return null;
	const sections = Object.fromEntries(SECTIONS.map(s => [s, []]));
	let courante = null;
	for (const ligne of b.corps.split("\n")) {
		const titre = ligne.match(/^### (\w+)\s*$/);
		if (titre) { courante = SECTIONS.includes(titre[1]) ? titre[1] : null; continue; }
		const entree = ligne.match(/^- (.+)$/);
		if (entree && courante) sections[courante].push(entree[1].trim());
	}
	return { sections };
}

export function deduireNiveau(sections) {
	if (sections.Breaking.length) return "major";
	if (sections.Added.length || sections.Changed.length) return "minor";
	if (sections.Fixed.length) return "patch";
	return null;
}

export function rang(niveau) {
	return RANGS[niveau] ?? 0;
}

export function niveauEntre(courante, demandee) {
	const a = courante.split("-")[0].split(".").map(Number);
	const b = demandee.split("-")[0].split(".").map(Number);
	if (b[0] > a[0]) return "major";
	if (b[0] < a[0]) return null;
	if (b[1] > a[1]) return "minor";
	if (b[1] < a[1]) return null;
	return b[2] > a[2] ? "patch" : null;
}

export function figer(texte, version, dateIso) {
	const b = bloc(texte, TITRE_UNRELEASED);
	if (!b) throw new Error(FICHIER + " : aucune section « " + TITRE_UNRELEASED + " ».");
	const corps = b.corps.replace(/^\n+/, "").replace(/\n+$/, "\n");
	const nouveau = TITRE_UNRELEASED + "\n\n## [" + version + "] - " + dateIso + "\n\n" + corps;
	return texte.slice(0, b.debut) + nouveau + (b.fin < texte.length ? "\n" : "") + texte.slice(b.fin);
}

export function extraire(texte, version) {
	const titre = texte.match(new RegExp("^## \\[" + version.replace(/\./g, "\\.") + "\\] - \\d{4}-\\d{2}-\\d{2}\\s*$", "m"));
	if (!titre) throw new Error(FICHIER + " : aucune section pour la version " + version + ".");
	const b = bloc(texte, titre[0].trimEnd());
	return b.corps.trim();
}

/* ── ligne de commande ── */
const lanceDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (lanceDirect) {
	const [commande, version] = process.argv.slice(2);
	if (commande !== "extract" || !version) {
		console.error("Usage : node scripts/changelog.mjs extract <version>");
		process.exitCode = 1;
	} else {
		const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
		try {
			process.stdout.write(extraire(await readFile(path.join(racine, FICHIER), "utf8"), version) + "\n");
		} catch (e) {
			console.error(e.message);
			process.exitCode = 1;
		}
	}
}
```

- [ ] **Step 5: Lancer le test, le voir passer**

Run: `node --test scripts/changelog.test.mjs`
Expected: 7 tests, 0 échec. Si `figer` échoue sur l'assertion `endsWith`, vérifier que `bloc` rend `fin` juste APRÈS le `\n` qui précède le titre suivant (le `+ 1`).

- [ ] **Step 6: Câbler `package.json` et la CI**

Dans `package.json` : `"check:changelog": "node --test scripts/changelog.test.mjs"` à côté des autres `check:*`, et `"test": "node --test scripts/set-version.test.mjs scripts/ship.test.mjs scripts/changelog.test.mjs"`.
Dans `.github/workflows/ci.yml`, après l'étape `npm run check:installer` (ligne ~66), une étape sur le même modèle : `- name: Changelog\n  run: npm run check:changelog`.

Run: `npm run check:changelog && node scripts/changelog.mjs extract 1.1.0 | head -3`
Expected: tests verts ; les trois premières lignes de la section 1.1.0.

- [ ] **Step 7: Commit**

```bash
git add CHANGELOG.md scripts/changelog.mjs scripts/changelog.test.mjs package.json .github/workflows/ci.yml
git commit -m "CHANGELOG.md : l'historique des versions, et son lecteur pur

Keep a Changelog, en anglais, rétroactif sur 1.0.0 à 1.1.0. Le module
déduit le niveau SemVer de la section Unreleased et sait la figer :
c'est ce que git ship lira à la tâche suivante."
```

---

### Task 2: `git ship` déduit le niveau du CHANGELOG, la release porte les notes

**Files:**
- Modify: `scripts/ship.mjs` (`readArguments`, `ship`, `checksToRun`, en-tête)
- Modify: `scripts/ship.test.mjs`
- Modify: `.github/workflows/release.yml` (job `prepare`, étape « Create Release »)
- Modify: `CLAUDE.md` (section « Release »)

**Interfaces:**
- Consumes: `lireUnreleased`, `deduireNiveau`, `niveauEntre`, `rang`, `figer`, `FICHIER` de `scripts/changelog.mjs` ; `currentVersion`, `nextVersion`, `isVersion` de `scripts/set-version.mjs`.
- Produces: `readArguments(args)` rend `request: null` pour l'app quand aucun numéro n'est donné ; `versionDepuisChangelog(texte, courante, demandee)` (exportée, pure) rend `{ version, niveau }` ou lève.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `scripts/ship.test.mjs` (importer `versionDepuisChangelog` depuis `./ship.mjs`) :

```js
const UNRELEASED_ADDED = "# C\n\n## [Unreleased]\n\n### Added\n- x\n\n## [1.1.0] - 2026-09-17\n";
const UNRELEASED_FIXED = "# C\n\n## [Unreleased]\n\n### Fixed\n- x\n\n## [1.1.0] - 2026-09-17\n";
const UNRELEASED_VIDE = "# C\n\n## [Unreleased]\n\n## [1.1.0] - 2026-09-17\n";

test("pour l'app, aucun niveau tapé : la requête est nulle, le CHANGELOG décide", () => {
	assert.deepEqual(readArguments(["Fix collapse ghost pixels"]), {
		request: null, message: "Fix collapse ghost pixels", watch: false, target: "app",
	});
});

test("pour l'app, un niveau tapé est refusé et renvoie au CHANGELOG", () => {
	assert.throws(() => readArguments(["minor", "msg"]), /CHANGELOG/);
});

test("pour le greffon, le niveau tapé reste la règle", () => {
	assert.deepEqual(readArguments(["--plugin", "minor"]), {
		request: "minor", message: undefined, watch: false, target: "plugin",
	});
});

test("le CHANGELOG déduit minor d'une entrée Added", () => {
	assert.deepEqual(versionDepuisChangelog(UNRELEASED_ADDED, "1.1.0", null), { version: "1.2.0", niveau: "minor" });
});

test("le CHANGELOG déduit patch d'une entrée Fixed seule", () => {
	assert.deepEqual(versionDepuisChangelog(UNRELEASED_FIXED, "1.1.0", null), { version: "1.1.1", niveau: "patch" });
});

test("un numéro explicite est admis s'il vaut au moins le niveau déduit", () => {
	assert.deepEqual(versionDepuisChangelog(UNRELEASED_FIXED, "1.1.0", "1.2.0"), { version: "1.2.0", niveau: "patch" });
	assert.throws(() => versionDepuisChangelog(UNRELEASED_ADDED, "1.1.0", "1.1.1"), /Added/);
});

test("une section Unreleased vide ne se livre pas", () => {
	assert.throws(() => versionDepuisChangelog(UNRELEASED_VIDE, "1.1.0", null), /Unreleased/);
});
```

Puis corriger les tests existants que le changement casse : « sans rien, la livraison répare » attend désormais `request: null` ; « le niveau précède le message » et « un niveau peut venir seul » deviennent des cas `--plugin`.

Run: `node --test scripts/ship.test.mjs`
Expected: les nouveaux tests échouent (`versionDepuisChangelog` absent, `request: "patch"`).

- [ ] **Step 2: Modifier `readArguments`**

```js
	let request = target === "plugin" ? "patch" : null;
	if (words.length > 0 && LEVELS.includes(words[0])) {
		if (target !== "plugin") {
			throw new Error(
				`Pour l'application, le niveau ne se tape plus : il se déduit de la section [Unreleased] de ${FICHIER}. ` +
					"Écris ce que la version change sous ### Added, ### Changed ou ### Fixed, puis `git ship \"Message\"`."
			);
		}
		request = words.shift();
	} else if (words.length > 0 && isVersion(words[0])) {
		request = words.shift();
	}
```

(Importer `FICHIER`, `lireUnreleased`, `deduireNiveau`, `niveauEntre`, `rang`, `figer` depuis `./changelog.mjs`, et `currentVersion`, `nextVersion` depuis `./set-version.mjs`.)

- [ ] **Step 3: Ajouter `versionDepuisChangelog` (pure, exportée)**

```js
/**
 * Le numéro de la prochaine version de l'APPLICATION, lu dans le CHANGELOG.
 * `demandee` (un numéro explicite) est admise si elle vaut AU MOINS le niveau
 * que la section annonce : livrer 1.1.1 avec une entrée « Added » serait le
 * mensonge exact que le système interdit.
 */
export function versionDepuisChangelog(texte, courante, demandee) {
	const lu = lireUnreleased(texte);
	const niveau = lu ? deduireNiveau(lu.sections) : null;
	if (!niveau) {
		throw new Error(
			`Rien dans la section [Unreleased] de ${FICHIER} : écris ce que cette version change ` +
				"(### Breaking, ### Added, ### Changed, ### Fixed) avant de la livrer."
		);
	}
	if (!demandee) return { version: nextVersion(courante, niveau), niveau };
	const saut = niveauEntre(courante, demandee);
	if (!saut || rang(saut) < rang(niveau)) {
		const remplies = sectionsNonVides(lu.sections).join(", ");
		throw new Error(
			`${demandee} ne peut pas suivre ${courante} : la section [Unreleased] contient ${remplies}, ` +
				`ce qui impose au moins un niveau ${niveau} (${nextVersion(courante, niveau)}).`
		);
	}
	return { version: demandee, niveau };
}

function sectionsNonVides(sections) {
	return Object.entries(sections).filter(([, l]) => l.length).map(([s]) => s);
}
```

- [ ] **Step 4: Câbler `ship()`**

Remplacer `const version = await resolveVersion(request, target);` par :

```js
	let version;
	let changelog = null;
	if (target === "app") {
		changelog = await readFile(path.join(repositoryRoot, FICHIER), "utf8");
		({ version } = versionDepuisChangelog(changelog, await currentVersion("app"), request));
	} else {
		version = await resolveVersion(request, target);
	}
```

Et après la boucle `setVersion` (avant `run("git", versionCommitArgs(version))`) :

```js
	if (changelog !== null) {
		const date = new Date().toISOString().slice(0, 10);
		await writeFile(path.join(repositoryRoot, FICHIER), figer(changelog, version, date), "utf8");
		console.log(`  ${FICHIER}`);
	}
```

(`readFile`, `writeFile` depuis `node:fs/promises`.) `versionCommitArgs` fait `commit -am` : `CHANGELOG.md` est suivi, il entre dans « Version X.Y.Z » sans autre geste.

Dans `checksToRun`, ajouter en tête de `checks`, après le typecheck :
`{ label: "check:changelog", command: resolveCommand("npm"), args: ["run", "check:changelog"] }` — et adapter le test « le typecheck passe toujours en premier » (il reste premier ; `check:changelog` est deuxième).

Réécrire l'en-tête de `ship.mjs` (les exemples) :

```
 *   git ship "Fix collapse ghost pixels"   le travail, puis le numéro que CHANGELOG.md impose
 *   git ship 1.2.0 "Sortie"                 un numéro explicite, s'il vaut au moins ce niveau
 *   git ship                                l'arbre est déjà propre : bump seul
 *   git ship --plugin minor                 le greffon garde le niveau tapé
```

- [ ] **Step 5: Lancer les tests**

Run: `npm test`
Expected: tout vert (set-version, ship, changelog).

- [ ] **Step 6: `release.yml` : les notes de la release**

Dans le job `prepare`, entre l'étape qui résout la version et « Create Release », ajouter :

```yaml
      # Les NOTES de la release viennent de CHANGELOG.md (tâche 2 du chantier
      # « utilisable par n'importe qui ») : une version de l'application sans
      # section dans le fichier ÉCHOUE ICI, avant qu'une release n'existe.
      # Le greffon n'a pas de changelog : corps vide.
      - name: Release notes
        shell: bash
        run: |
          if [ "${{ steps.version.outputs.product }}" = "app" ]; then
            node scripts/changelog.mjs extract "${{ steps.version.outputs.version }}" > RELEASE_NOTES.md
          else
            : > RELEASE_NOTES.md
          fi
          cat RELEASE_NOTES.md
```

Et dans « Create Release », sous `target_commitish`, ajouter `body_path: RELEASE_NOTES.md`. Lire d'abord les lignes 60 à 100 de `release.yml` pour vérifier que `prepare` fait bien un `actions/checkout` avec Node disponible (sinon ajouter `actions/setup-node@v4` comme les autres jobs).

- [ ] **Step 7: `CLAUDE.md`, section « Release »**

Remplacer la ligne `git ship [major|minor|patch|X.Y.Z] "Message"` et sa description par :

```markdown
  - `git ship "Message"` — l'application par défaut. **Le niveau ne se tape
    plus** : il se DÉDUIT de la section `## [Unreleased]` de `CHANGELOG.md`
    (`### Breaking` → major, `### Added`/`### Changed` → minor, `### Fixed`
    seul → patch ; vide → refus). Un numéro explicite `X.Y.Z` est admis s'il
    vaut au moins ce niveau. La section est figée en `## [X.Y.Z] - date` dans
    le commit « Version X.Y.Z », et `release.yml` la publie comme notes de la
    release. Chaque tâche qui change quelque chose de visible écrit sa ligne
    sous `[Unreleased]` dans son propre commit.
```

- [ ] **Step 8: Commit**

```bash
git add scripts/ship.mjs scripts/ship.test.mjs .github/workflows/release.yml CLAUDE.md
git commit -m "git ship déduit le niveau du CHANGELOG, la release porte ses notes

Pour l'application, plus de niveau tapé : Breaking → major, Added ou
Changed → minor, Fixed → patch, vide → refus. Un numéro explicite doit
valoir au moins ce niveau. release.yml extrait la section comme corps de
la release, et échoue avant de la créer si elle manque."
```

---

### Task 3: La sonde du terminal (spike, sur la vraie machine)

**Files:**
- Create (scratchpad, jetable) : `<scratchpad>/sonde-terminal.mjs`, `<scratchpad>/sonde-lanceur.mjs`
- Modify: `docs/superpowers/specs/2026-09-17-utilisable-par-nimporte-qui-design.md` (une ligne de résultat sous 3c)

**Interfaces:**
- Produces: la CONFIRMATION que `cmd.exe /c start "…" powershell.exe -NoExit -ExecutionPolicy Bypass -EncodedCommand <b64>` lancé depuis un process SANS console ouvre une fenêtre PowerShell visible qui exécute le script. Si non, la ligne de commande de repli (`wt.exe`) que la tâche 4 doit employer.

- [ ] **Step 1: DEMANDER À AHMED avant d'ouvrir une fenêtre**

Message à Ahmed : « La sonde va ouvrir UNE fenêtre PowerShell sur ton bureau (titre « Sonde Neo Quiz »), qui affiche deux lignes et reste ouverte pour que tu la voies ; tu la fermes ensuite. Je la lance quand tu me dis oui. » Ne rien lancer sans son oui.

- [ ] **Step 2: Écrire la sonde à deux étages**

`sonde-terminal.mjs` (ce que fera `lancerTerminal`) :

```js
import { spawn } from "node:child_process";
const script = [
	"Write-Host 'Sonde Neo Quiz : fenetre ouverte par cmd /c start depuis un process sans console'",
	"Write-Host ('PowerShell ' + $PSVersionTable.PSVersion)",
].join("; ");
const b64 = Buffer.from(script, "utf16le").toString("base64");
const enfant = spawn("cmd.exe",
	["/c", `start "Sonde Neo Quiz" powershell.exe -NoExit -ExecutionPolicy Bypass -EncodedCommand ${b64}`],
	{ windowsVerbatimArguments: true, windowsHide: true, stdio: "ignore" });
enfant.on("error", e => console.error("spawn a échoué :", e));
enfant.unref();
```

`sonde-lanceur.mjs` (simule le principal d'Electron lancé depuis l'explorateur : AUCUNE console) :

```js
import { spawn } from "node:child_process";
const enfant = spawn(process.execPath, [new URL("./sonde-terminal.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
	{ detached: true, stdio: "ignore", windowsHide: true });
enfant.unref();
console.log("lanceur parti, pid", enfant.pid);
```

- [ ] **Step 3: Lancer, après le oui d'Ahmed**

Run: `node "<scratchpad>/sonde-lanceur.mjs"`
Expected: Ahmed voit une fenêtre « Sonde Neo Quiz » avec les deux lignes. Lui demander : la fenêtre s'est-elle ouverte, dans Windows Terminal ou dans la console classique ?

- [ ] **Step 4: Si la fenêtre ne s'ouvre pas — le repli**

Remplacer dans `sonde-terminal.mjs` le `spawn` par `wt.exe` :
`spawn("wt.exe", ["-w", "new", "powershell.exe", "-NoExit", "-ExecutionPolicy", "Bypass", "-EncodedCommand", b64], { stdio: "ignore", windowsHide: true })`, relancer par le lanceur. Noter lequel des deux a marché.

- [ ] **Step 5: Consigner le résultat dans la spec**

Sous « **C'est le seul point incertain de ce design** » (section 3c), ajouter une ligne : « **Sondé le 2026-09-XX** : `cmd /c start` ouvre bien une fenêtre visible depuis un process sans console (Windows Terminal / console classique : <ce qu'Ahmed a vu>). » ou la variante `wt.exe` retenue. Supprimer les deux fichiers du scratchpad.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-09-17-utilisable-par-nimporte-qui-design.md
git commit -m "spec : la sonde du terminal confirme le lancement par cmd /c start"
```

---

### Task 4: Le pont sait installer un CLI (recette fixe, confirmation native, terminal visible)

**Files:**
- Modify: `apps/windows/electron/process.ts` (+ `scriptInstallation`, `encoderCommande`, `argumentsTerminal`, `lancerTerminal`)
- Modify: `apps/windows/electron/pont.ts` (`processus.installer`, `CANAUX.processusInstaller`)
- Modify: `apps/windows/electron/preload.ts`
- Modify: `apps/windows/electron/canaux.ts` (le gestionnaire)
- Modify: `apps/windows/src/host/process.ts` (`installerCli`)
- Modify: `src/host/types.ts` (`HostProcess.installerCli`)
- Modify: `src/i18n/en/app.ts`, `src/i18n/fr/app.ts`
- Modify: `scripts/check-electron-process.mjs`, `scripts/check-windows-host.mjs`
- Modify: `docs/superpowers/notes/controles.md`

**Interfaces:**
- Produces:
  - `HostProcess.installerCli(tool: CliTool): Promise<"lance" | "annule" | "indisponible">` (contrat).
  - `scriptInstallation(tool: Outil, messageFin: string): string` — le script PowerShell complet, PUR.
  - `encoderCommande(script: string): string` — base64 d'UTF-16LE.
  - `argumentsTerminal(titre: string, script: string): string[]` — `["/c", 'start "<titre>" powershell.exe -NoExit -ExecutionPolicy Bypass -EncodedCommand <b64>']`.
  - `lancerTerminal(titre: string, script: string): boolean` — `spawn("cmd.exe", …)`, `true` si le spawn est parti.
  - `CANAUX.processusInstaller = "neo:process/installer"`.
- Consumes: le résultat de la tâche 3 (si `wt.exe` a été retenu, `argumentsTerminal` rend les arguments de `wt.exe` et `lancerTerminal` le lance ; le reste ne change pas).

- [ ] **Step 1: Les cas de `check:electron-process`, qui échouent**

Dans `scripts/check-electron-process.mjs`, ajouter `scriptInstallation, encoderCommande, argumentsTerminal` à la déstructuration de `withSrcModule`, et ce groupe après le groupe `OUTILS` :

```js
	/* ── Installer un CLI : la recette est FIXE, dans ce module, jamais composée
	   depuis le rendu. Ces cas gardent l'URL officielle, l'étape de connexion,
	   l'encodage (aucune citation ne traverse `cmd`), et la forme des arguments. */
	{
		const claude = scriptInstallation("claude", "Vous pouvez fermer cette fenêtre.");
		r.check("claude : le script installe depuis claude.ai", claude.includes("irm https://claude.ai/install.ps1 | iex"), true);
		r.check("claude : le PATH de la session est rechargé avant de lancer claude",
			claude.indexOf("GetEnvironmentVariable('Path','User')") > 0 && claude.indexOf("GetEnvironmentVariable('Path','User')") < claude.lastIndexOf("\nclaude"), true);
		r.check("claude : le script finit par la connexion du compte", /\nclaude\s*$/.test(claude.replace(/\nWrite-Host[^\n]*$/, "")), true);
		const codex = scriptInstallation("codex", "x");
		r.check("codex : installe depuis chatgpt.com puis codex login", codex.includes("irm https://chatgpt.com/codex/install.ps1 | iex") && codex.includes("\ncodex login"), true);
		const ollama = scriptInstallation("ollama", "x");
		r.check("ollama : winget, paquet officiel, accords acceptés", ollama.includes("winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements"), true);
		r.check("le message de fin est cité pour PowerShell (une apostrophe est doublée)",
			scriptInstallation("ollama", "c'est fini").includes("Write-Host 'c''est fini'"), true);

		const script = "Write-Host 'é | $x'";
		const b64 = encoderCommande(script);
		r.check("encoderCommande : base64 d'UTF-16LE, aller-retour exact", Buffer.from(b64, "base64").toString("utf16le"), script);
		r.check("encoderCommande : rien d'autre que du base64", /^[A-Za-z0-9+/=]+$/.test(b64), true);

		const args = argumentsTerminal("Neo Quiz", script);
		r.check("argumentsTerminal : /c start, une fenêtre, -EncodedCommand, jamais le script en clair",
			{ c: args[0], start: args[1].startsWith('start "Neo Quiz" powershell.exe -NoExit -ExecutionPolicy Bypass -EncodedCommand '), clair: args[1].includes("Write-Host") },
			{ c: "/c", start: true, clair: false });
	}
```

Run: `npm run check:electron-process`
Expected: rouge, `scriptInstallation is not a function`.

- [ ] **Step 2: Écrire les quatre fonctions dans `process.ts`**

Après `demarrerOllama` :

```ts
/* ══════════════════════════════════════════════════════════
   INSTALLER UN CLI — UN TERMINAL VISIBLE, UNE RECETTE FIXE

   « Utilisable par n'importe qui » (spec du 2026-09-17, § 3c) : l'utilisateur
   ne sait pas ce qu'est PowerShell et ne collera pas une commande. L'app
   ouvre donc le terminal ELLE-MÊME, avec la recette OFFICIELLE de chaque
   outil, et le laisse ouvert pour qu'on voie l'installateur travailler puis
   la connexion du compte se faire au même endroit.

   LA RECETTE VIT ICI, jamais dans le rendu : `canaux.ts` ne reçoit qu'un nom
   d'outil, jugé par `estOutilAutorise` avant tout. `-EncodedCommand` porte
   le script en base64 (UTF-16LE, ce que PowerShell attend) : aucune
   apostrophe, aucun `|`, aucun `$` ne traverse `cmd.exe` en clair, donc
   aucune question de citation. `cmd /c start` garantit une NOUVELLE fenêtre
   console — Windows Terminal l'accueille s'il est le terminal par défaut.
   `detached: true` est EXCLU : libuv y pose DETACHED_PROCESS, donc pas de
   console du tout, et PowerShell interactif tournerait invisible (sondé le
   2026-09-17, tâche 3 du plan).

   LE PATH DE LA SESSION EST RECHARGÉ avant de lancer `claude`/`codex` :
   `claude install` écrit le PATH utilisateur dans le registre, et la session
   PowerShell déjà ouverte ne le voit pas (lu dans install.ps1).
══════════════════════════════════════════════════════════ */

const RECHARGER_PATH = "$env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')";

/** Une chaîne littérale PowerShell entre apostrophes (la seule forme qui
    n'interpole rien) : l'apostrophe se double. */
function citerPs(texte: string): string {
	return "'" + texte.replace(/'/g, "''") + "'";
}

export function scriptInstallation(tool: Outil, messageFin: string): string {
	const lignes: string[] = [];
	if (tool === "claude") {
		lignes.push("irm https://claude.ai/install.ps1 | iex", RECHARGER_PATH, "Write-Host " + citerPs(messageFin), "claude");
	} else if (tool === "codex") {
		lignes.push("irm https://chatgpt.com/codex/install.ps1 | iex", RECHARGER_PATH, "Write-Host " + citerPs(messageFin), "codex login");
	} else {
		lignes.push("winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements", "Write-Host " + citerPs(messageFin));
	}
	return lignes.join("\n");
}

export function encoderCommande(script: string): string {
	return Buffer.from(script, "utf16le").toString("base64");
}

export function argumentsTerminal(titre: string, script: string): string[] {
	const t = titre.replace(/"/g, "");
	return ["/c", `start "${t}" powershell.exe -NoExit -ExecutionPolicy Bypass -EncodedCommand ${encoderCommande(script)}`];
}

export function lancerTerminal(titre: string, script: string): boolean {
	if (process.platform !== "win32") return false;
	try {
		const enfant = spawn("cmd.exe", argumentsTerminal(titre, script), { windowsVerbatimArguments: true, windowsHide: true, stdio: "ignore" });
		enfant.on("error", e => { console.warn(LOG_PREFIX, "terminal d'installation non lancé:", e); });
		enfant.unref();
		return true;
	} catch (e) {
		console.warn(LOG_PREFIX, "terminal d'installation non lancé:", e);
		return false;
	}
}
```

Vérifier que `LOG_PREFIX` et `spawn` sont déjà importés dans ce fichier (ils le sont pour `run`). Si la tâche 3 a retenu `wt.exe`, `argumentsTerminal` rend `["-w", "new", "powershell.exe", "-NoExit", "-ExecutionPolicy", "Bypass", "-EncodedCommand", b64]` et `lancerTerminal` fait `spawn("wt.exe", …, { stdio: "ignore", windowsHide: true })` — et le cas « /c start » du contrôle est réécrit pour cette forme.

Run: `npm run check:electron-process`
Expected: vert. Discriminance : changer `claude.ai` en `claude.com` dans la recette → le cas rougit → restaurer.

- [ ] **Step 3: Le contrat, le pont, le preload, l'hôte du rendu**

`src/host/types.ts`, dans `HostProcess`, après `demarrerOllama` :

```ts
	/** Ouvre un terminal VISIBLE qui installe l'outil puis y connecte le
	    compte (recette fixe de l'hôte). `lance` : le terminal est parti, c'est
	    la sonde de l'appelant (`checkClaudeCode`…) qui constatera le résultat ;
	    `annule` : l'utilisateur a refusé la confirmation de l'hôte ;
	    `indisponible` : l'hôte ne sait pas ouvrir de terminal (hors Windows)
	    ou le lancement a échoué. */
	installerCli(tool: CliTool): Promise<"lance" | "annule" | "indisponible">;
```

`apps/windows/electron/pont.ts` : dans `processus`, `installer(tool: Outil): Promise<"lance" | "annule" | "indisponible">;` (importer le type `Outil` de `./process` — vérifier qu'il n'est pas déjà importé sous ce nom, et que `pont.ts` reste sans Node : `import type` seulement). Dans `CANAUX` : `processusInstaller: "neo:process/installer",`.

`apps/windows/electron/preload.ts`, dans `processus` : `installer: tool => ipcRenderer.invoke(CANAUX.processusInstaller, tool),`.

`apps/windows/src/host/process.ts`, après `demarrerOllama` :

```ts
		installerCli(tool) {
			return pont().processus.installer(tool);
		},
```

- [ ] **Step 4: Le gestionnaire dans `canaux.ts`**

Après `ipcMain.handle(CANAUX.processusDemarrerOllama, …)` :

```ts
	/* ─── INSTALLER UN CLI ───
	   Même porte que `processusRun` : le NOM est jugé avant tout, la recette
	   est celle de `process.ts`, et une confirmation NATIVE — rédigée ici, sur
	   la langue posée par `main.ts` — précède le lancement, comme pour l'hôte
	   Ollama des réglages. `cancelId` = refus : fermer la boîte, c'est dire
	   non. Hors Windows, `indisponible` sans rien lancer : le modal du rendu
	   montre alors les étapes manuelles. */
	const NOMS_OUTILS: Record<Outil, string> = { claude: "Claude Code", codex: "Codex CLI", ollama: "Ollama" };
	const SOURCES_OUTILS: Record<Outil, string> = { claude: "claude.ai/install.ps1", codex: "chatgpt.com/codex/install.ps1", ollama: "winget (Ollama.Ollama)" };
	ipcMain.handle(CANAUX.processusInstaller, async (_e, tool: unknown): Promise<"lance" | "annule" | "indisponible"> => {
		if (!estOutilAutorise(tool)) {
			console.warn(LOG_PREFIX, "installation refusée, outil hors liste:", tool);
			throw erreurCli("refuse", "outil hors liste : " + String(tool));
		}
		if (process.platform !== "win32") return "indisponible";
		const name = NOMS_OUTILS[tool];
		const options = {
			type: "question" as const,
			title: t("app.installCli.title", { name }),
			message: t("app.installCli.message", { name }),
			detail: t("app.installCli.detail", { source: SOURCES_OUTILS[tool] }),
			buttons: [t("app.installCli.run"), t("app.installCli.cancel")],
			defaultId: 0,
			cancelId: 1,
		};
		const parent = deps.fenetreCourante();
		const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
		if (response !== 0) return "annule";
		return lancerTerminal(PRODUCT_NAME + " - " + name, scriptInstallation(tool, t("app.installCli.done", { name }))) ? "lance" : "indisponible";
	});
```

Importer `lancerTerminal`, `scriptInstallation` et le type `Outil` depuis `./process`, `PRODUCT_NAME` depuis `../../../src/branding` (vérifier son nom exact dans `src/branding.ts`).

- [ ] **Step 5: Les six chaînes du principal**

`src/i18n/en/app.ts` (avant la clôture `} as const;`) :

```ts
	/* ── Installer un CLI depuis l'app : la confirmation NATIVE du principal ── */
	"app.installCli.title": "Install {name}?",
	"app.installCli.message": "Neo Quiz will open PowerShell and run the official {name} installer there.",
	"app.installCli.detail": "Source: {source}. You will see everything the installer does. Close the PowerShell window when it is finished.",
	"app.installCli.run": "Open PowerShell and install",
	"app.installCli.cancel": "Cancel",
	"app.installCli.done": "{name} is set up. You can close this window and go back to Neo Quiz.",
```

`src/i18n/fr/app.ts` :

```ts
	"app.installCli.title": "Installer {name} ?",
	"app.installCli.message": "Neo Quiz va ouvrir PowerShell et y lancer l'installation officielle de {name}.",
	"app.installCli.detail": "Source : {source}. Vous verrez tout ce que fait l'installateur. Fermez la fenêtre PowerShell quand c'est terminé.",
	"app.installCli.run": "Ouvrir PowerShell et installer",
	"app.installCli.cancel": "Annuler",
	"app.installCli.done": "{name} est installé. Vous pouvez fermer cette fenêtre et revenir dans Neo Quiz.",
```

Run: `npm run check && npm run check:app`
Expected: vert.

- [ ] **Step 6: `check:windows-host` : le membre existe et relaie le nom**

Dans `scripts/check-windows-host.mjs`, au faux pont (`installerPont`, objet `processus`, ligne ~744), ajouter `async installer(tool) { journal.push(["processus.installer", tool]); return "lance"; },`. Puis, dans le groupe qui éprouve `process.run`/`lireCache` (chercher `processus.lireCache` dans les cas), ajouter :

```js
	r.check("installerCli relaie le NOM de l'outil au canal, et rend son verdict",
		{ verdict: await hote.process.installerCli("claude"), appel: journal.find(l => l[0] === "processus.installer") },
		{ verdict: "lance", appel: ["processus.installer", "claude"] });
```

Run: `npm run check:windows-host`
Expected: vert. Discriminance : faire rendre `"annule"` par le faux pont → rougit → restaurer.

- [ ] **Step 7: `controles.md`**

Ajouter à `docs/superpowers/notes/controles.md`, dans l'entrée de `check:electron-process`, une phrase : « Depuis le chantier « utilisable par n'importe qui » (2026-09-17), il garde aussi la RECETTE d'installation de chaque CLI (`scriptInstallation`) : l'URL officielle, l'étape de connexion, le rechargement du PATH, et l'encodage `-EncodedCommand` qui fait qu'aucune citation ne traverse `cmd.exe`. Le canal `processus.installer` est la seule capacité du pont qui ouvre une fenêtre : il ne reçoit qu'un nom, jugé par `estOutilAutorise`, et une confirmation native du principal précède le lancement. »

- [ ] **Step 8: Commit**

```bash
git add apps/windows/electron/process.ts apps/windows/electron/pont.ts apps/windows/electron/preload.ts apps/windows/electron/canaux.ts apps/windows/src/host/process.ts src/host/types.ts src/i18n/en/app.ts src/i18n/fr/app.ts scripts/check-electron-process.mjs scripts/check-windows-host.mjs docs/superpowers/notes/controles.md
git commit -m "le pont sait installer un CLI dans un terminal visible

Un nom d'outil traverse, jugé par la liste blanche ; une confirmation
native du principal ; la recette officielle, fixe dans process.ts,
portée par -EncodedCommand dans une fenêtre que cmd /c start ouvre.
Le PATH de la session est rechargé avant de lancer claude ou codex
pour connecter le compte au même endroit."
```

---

### Task 5: Une option de sélecteur qui ne se sélectionne pas, et les pastilles alignées

**Files:**
- Modify: `src/dashboard/ui-select.ts:48-76` (types), `:146-168` (`renderMenuOptions`)
- Modify: `src/assets/css/dashboard/dashboard-ai.css:481-487` (`.qbd-provider-option-body`)
- Modify: `CHANGELOG.md` (une ligne `### Fixed`)

**Interfaces:**
- Produces: `SelectOption.disabled?: boolean` ; `SelectOptions.onDisabledClick?: (value: string) => void`. Une option `disabled` garde son rendu, porte `aria-disabled="true"`, et un clic ferme le menu puis appelle `onDisabledClick(value)` sans toucher la valeur ni `onChange`.

- [ ] **Step 1: Les types**

Dans `SelectOption` : `/** Visible, mais pas sélectionnable : un clic appelle `onDisabledClick` (le fournisseur absent ouvre son modal d'installation). */ disabled?: boolean;`
Dans `SelectOptions` : `/** Le clic sur une option `disabled` — le menu se ferme d'abord. */ onDisabledClick?: (value: string) => void;`

- [ ] **Step 2: `renderMenuOptions`**

Remplacer le bloc `optBtn.addEventListener("click", …)` par :

```ts
			if (o.disabled) optBtn.setAttribute("aria-disabled", "true");
			optBtn.addEventListener("click", () => {
				/* Une option désactivée n'est pas grisée (le sous-titre et la
				   pastille disent déjà l'état) mais ne prend JAMAIS la coche : le
				   menu se ferme et l'appelant décide quoi montrer. */
				if (o.disabled) {
					closeMenu();
					opts.onDisabledClick?.(o.value);
					return;
				}
				const changed = o.value !== value;
				value = o.value;
				refreshLabel();
				closeMenu();
				if (changed && opts.onChange) opts.onChange(o.value);
			});
```

Et la classe `is-active` ne se pose que si `o.value === value && !o.disabled`.

- [ ] **Step 3: Les pastilles**

Dans `dashboard-ai.css`, `.qbd-provider-option-body` : remplacer `margin-right: 14px;` par `flex: 1 1 auto;` (garder `min-width: 0`). Ajouter au commentaire au-dessus : « `flex: 1` et non une marge : la pastille et la coche ont chacune `margin-left: auto`, et deux marges automatiques se PARTAGENT l'espace libre — la pastille dépendait de la longueur du sous-titre (vu le 2026-09-17). Le corps absorbe tout, il ne reste rien à partager. »

- [ ] **Step 4: Vérifier**

Run: `npm run check && npm run check:app`
Expected: vert. Puis Ahmed : ouvrir le menu des fournisseurs dans la VM (trois absents) — trois pastilles sur une verticale.

- [ ] **Step 5: CHANGELOG**

Sous `## [Unreleased]`, créer `### Fixed` et ajouter : `- The dots in the AI provider menu line up whatever the length of the status text.`

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/ui-select.ts src/assets/css/dashboard/dashboard-ai.css CHANGELOG.md
git commit -m "une option de sélecteur peut refuser la coche, et les pastilles s'alignent

Deux margin-left: auto se partageaient l'espace libre d'une option : la
pastille dépendait de la longueur du sous-titre. Le corps prend flex: 1."
```

---

### Task 6: Le modal d'installation, et son câblage dans la page « Générer »

**Files:**
- Create: `src/dashboard/ai-install-modal.ts`
- Modify: `src/dashboard/ai.ts` (`AiPageDeps.copyText`, `installCmd` retiré, le sélecteur : `disabled` + `onDisabledClick`, les trois hints « absent », `ouvrirModalInstallation`)
- Modify: `apps/windows/src/ui/dashboard-shell.ts:398` (`copyText` passé à `createAiHandlers`)
- Modify: `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts`
- Modify: `src/assets/css/dashboard/dashboard-ai.css` (`.qbd-install-modal*`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `HostProcess.installerCli` (tâche 4), `SelectOption.disabled` / `onDisabledClick` (tâche 5), `renderCollapsibleSection(deps, parent, key, label, total, opts)` de `src/dashboard/collapsible.ts`, `requireHost("modals").open(spec)`.
- Produces:
  ```ts
  export type InstallProvider = "claude-code" | "codex" | "ollama";
  export interface InstallModalDeps {
  	provider: InstallProvider;
  	/** La sonde du fournisseur, forcée (sans TTL). */
  	probe(): Promise<{ ok: true; version?: string } | { ok: false }>;
  	/** Appelé une fois sur détection : la page écrit le fournisseur dans les réglages. */
  	onDetected(): Promise<void>;
  	/** Appelé à la fermeture, quel que soit l'état : la page rafraîchit statuts et hints. */
  	onClose(): void;
  	copyText?(texte: string): Promise<boolean>;
  	renderCodeBlock?(host: HTMLElement, code: string, lang: string): void;
  }
  export function openInstallModal(deps: InstallModalDeps): void;
  export function installCmd(provider: InstallProvider, isWindows: boolean): { code: string; lang: string };
  ```

- [ ] **Step 1: Les clés i18n (en, puis fr typé)**

`src/i18n/en/ai.ts`, après le bloc « Hints contextuels » : changer trois hints et en ajouter un —
`"ai.hint.claudeNotInstalled": "Claude Code is not installed."`, `"ai.hint.codexNotInstalled": "The Codex CLI is not installed."`, `"ai.hint.ollamaNotInstalled": "Ollama is not installed."`, `"ai.hint.installOllama": "Install Ollama"` (la clé `ai.hint.downloadOllama` disparaît). Puis un bloc neuf :

```ts
	/* ── Le modal d'un fournisseur absent (spec « utilisable par n'importe qui », § 3b) ── */
	"ai.install.title.claude-code": "Claude Code is not installed",
	"ai.install.title.codex": "The Codex CLI is not installed",
	"ai.install.title.ollama": "Ollama is not installed",
	"ai.install.what.claude-code": "Claude Code is Anthropic's command-line tool. Neo Quiz uses it with your Claude account (Pro or Max) to generate quizzes.",
	"ai.install.what.codex": "The Codex CLI is OpenAI's command-line tool, used with a ChatGPT subscription. It is not the Codex desktop app.",
	"ai.install.what.ollama": "Ollama runs free models on your own computer. No account needed.",
	"ai.install.auto": "Install automatically",
	"ai.install.autoHint": "Neo Quiz opens PowerShell and runs the official installer. You will see everything it does.",
	"ai.install.manual": "Install manually",
	"ai.install.step1": "Open PowerShell: press Windows + X, then I. (Or open the Start menu, type “PowerShell” and press Enter.)",
	"ai.install.step1Unix": "Open a terminal.",
	"ai.install.step2": "Copy this command, paste it into the window (right click) and press Enter:",
	"ai.install.step3.claude-code": "When it is done, type claude, press Enter, and follow the instructions to sign in with your Claude account.",
	"ai.install.step3.codex": "When it is done, type codex login, press Enter, and sign in with your ChatGPT account.",
	"ai.install.step3.ollama": "When it is done, Ollama starts by itself.",
	"ai.install.step4": "Come back to Neo Quiz: the installation is detected automatically.",
	"ai.install.learnMore": "Learn more",
	"ai.install.copy": "Copy the command",
	"ai.install.running": "Installing in PowerShell… Neo Quiz will detect it by itself.",
	"ai.install.detected": "{name} v{version} is installed.",
	"ai.install.detectedNoVersion": "{name} is installed.",
	"ai.install.continue": "Continue",
	"ai.install.terminalFailed": "PowerShell could not be opened. Follow the manual steps below.",
```

`src/i18n/fr/ai.ts`, les mêmes clés :

```ts
	"ai.hint.claudeNotInstalled": "Claude Code n'est pas installé.",
	"ai.hint.codexNotInstalled": "Le Codex CLI n'est pas installé.",
	"ai.hint.ollamaNotInstalled": "Ollama n'est pas installé.",
	"ai.hint.installOllama": "Installer Ollama",
	"ai.install.title.claude-code": "Claude Code n'est pas installé",
	"ai.install.title.codex": "Le Codex CLI n'est pas installé",
	"ai.install.title.ollama": "Ollama n'est pas installé",
	"ai.install.what.claude-code": "Claude Code est l'outil en ligne de commande d'Anthropic. Neo Quiz s'en sert avec votre compte Claude (Pro ou Max) pour générer des quiz.",
	"ai.install.what.codex": "Le Codex CLI est l'outil en ligne de commande d'OpenAI, utilisé avec un abonnement ChatGPT. Ce n'est pas l'application Codex.",
	"ai.install.what.ollama": "Ollama fait tourner des modèles gratuits sur votre ordinateur. Aucun compte nécessaire.",
	"ai.install.auto": "Installer automatiquement",
	"ai.install.autoHint": "Neo Quiz ouvre PowerShell et lance l'installation officielle. Vous verrez tout ce qui se passe.",
	"ai.install.manual": "Installer manuellement",
	"ai.install.step1": "Ouvrez PowerShell : appuyez sur Windows + X, puis sur I. (Ou ouvrez le menu Démarrer, tapez « PowerShell » et appuyez sur Entrée.)",
	"ai.install.step1Unix": "Ouvrez un terminal.",
	"ai.install.step2": "Copiez cette commande, collez-la dans la fenêtre (clic droit) et appuyez sur Entrée :",
	"ai.install.step3.claude-code": "Quand c'est terminé, tapez claude, appuyez sur Entrée, et suivez les instructions pour connecter votre compte Claude.",
	"ai.install.step3.codex": "Quand c'est terminé, tapez codex login, appuyez sur Entrée, et connectez votre compte ChatGPT.",
	"ai.install.step3.ollama": "Quand c'est terminé, Ollama démarre tout seul.",
	"ai.install.step4": "Revenez dans Neo Quiz : l'installation est détectée automatiquement.",
	"ai.install.learnMore": "En savoir plus",
	"ai.install.copy": "Copier la commande",
	"ai.install.running": "Installation en cours dans PowerShell… Neo Quiz la détectera tout seul.",
	"ai.install.detected": "{name} v{version} est installé.",
	"ai.install.detectedNoVersion": "{name} est installé.",
	"ai.install.continue": "Continuer",
	"ai.install.terminalFailed": "PowerShell n'a pas pu être ouvert. Suivez les étapes manuelles ci-dessous.",
```

Run: `npm run check`
Expected: rouge sur `ai.hint.downloadOllama` (encore lue par `ai.ts`) — attendu, corrigé à l'étape 4.

- [ ] **Step 2: Le module du modal**

```ts
// src/dashboard/ai-install-modal.ts
/* ══════════════════════════════════════════════════════════
   LE MODAL D'UN FOURNISSEUR ABSENT — ET L'INSTALLATION EN UN CLIC

   Spec « utilisable par n'importe qui » (2026-09-17, § 3b). L'utilisateur ne
   sait pas ce qu'est un terminal : le modal dit ce qu'est l'outil en une
   phrase, propose de l'installer AUTOMATIQUEMENT (l'hôte ouvre PowerShell
   avec la recette officielle, `HostProcess.installerCli`), et garde, repliée,
   la voie manuelle en quatre étapes pour qui la préfère — ou pour un hôte
   qui ne sait pas ouvrir de terminal.

   Trois états : `initial`, `en-cours` (le terminal est parti, la sonde du
   fournisseur tourne toutes les 3 s), `detecte` (la page a écrit le
   fournisseur dans les réglages, « Continuer » ferme). La sonde est coupée
   à la fermeture ET à la détection : jamais un minuteur orphelin.
══════════════════════════════════════════════════════════ */
import { ajouter } from "../dom";
import { currentHost, requireHost } from "../host/current";
import { t } from "../i18n";
import { renderCollapsibleSection } from "./collapsible";

export type InstallProvider = "claude-code" | "codex" | "ollama";

export interface InstallModalDeps {
	provider: InstallProvider;
	probe(): Promise<{ ok: true; version?: string } | { ok: false }>;
	onDetected(): Promise<void>;
	onClose(): void;
	copyText?(texte: string): Promise<boolean>;
	renderCodeBlock?(host: HTMLElement, code: string, lang: string): void;
}

const NOMS: Record<InstallProvider, string> = { "claude-code": "Claude Code", codex: "Codex CLI", ollama: "Ollama" };
const OUTILS: Record<InstallProvider, "claude" | "codex" | "ollama"> = { "claude-code": "claude", codex: "codex", ollama: "ollama" };
const DOCS: Record<InstallProvider, string> = {
	"claude-code": "https://code.claude.com/docs/en/setup",
	codex: "https://learn.chatgpt.com/docs/codex/cli",
	ollama: "https://ollama.com/download",
};
const SONDE_MS = 3000;

/* Commande d'installation par fournisseur, formes officielles vérifiées le
   2026-07-14 (déménagée depuis `ai.ts` : le hint ne montre plus de commande,
   seul ce modal le fait) :
   - Claude Code : installateur natif (code.claude.com/docs/en/setup) ;
   - Codex CLI : installateur officiel (learn.chatgpt.com/docs/codex/cli) ;
   - Ollama : winget (paquet officiel Ollama.Ollama) sur Windows. */
export function installCmd(provider: InstallProvider, isWindows: boolean): { code: string; lang: string } {
	if (provider === "claude-code") {
		return isWindows
			? { code: "irm https://claude.ai/install.ps1 | iex", lang: "powershell" }
			: { code: "curl -fsSL https://claude.ai/install.sh | bash", lang: "bash" };
	}
	if (provider === "codex") {
		return isWindows
			? { code: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', lang: "powershell" }
			: { code: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", lang: "bash" };
	}
	return isWindows
		? { code: "winget install --id Ollama.Ollama -e", lang: "powershell" }
		: { code: "curl -fsSL https://ollama.com/install.sh | sh", lang: "bash" };
}

export function openInstallModal(deps: InstallModalDeps): void {
	const host = currentHost();
	const name = NOMS[deps.provider];
	const win = host.platform.isWindows;
	let sonde: number | null = null;
	const couperSonde = (): void => { if (sonde !== null) { window.clearInterval(sonde); sonde = null; } };

	requireHost("modals").open({
		className: "qbd-install-modal",
		title: t(`ai.install.title.${deps.provider}`),
		onOpen: (m) => {
			const c = m.contentEl;
			m.panelEl.dataset.state = "initial";
			ajouter(c, "p", "qbd-install-what", t(`ai.install.what.${deps.provider}`));

			/* L'état « en cours » / « détecté » vit dans cette zone ; le bouton
			   automatique n'existe que là où l'hôte sait ouvrir un terminal. */
			const etat = ajouter(c, "div", "qbd-install-state");
			let manuelOuvert: (() => void) | null = null;

			if (win && host.process) {
				const auto = ajouter(c, "button", "qbd-btn--create qbd-install-auto");
				auto.type = "button";
				host.ui.setIcon(ajouter(auto, "span", "qbd-btn-icon"), "download");
				ajouter(auto, "span", undefined, t("ai.install.auto"));
				ajouter(c, "p", "qbd-install-auto-hint", t("ai.install.autoHint"));
				auto.addEventListener("click", async () => {
					auto.disabled = true;
					const verdict = await host.process!.installerCli(OUTILS[deps.provider]);
					if (verdict === "annule") { auto.disabled = false; return; }
					if (verdict === "indisponible") {
						auto.disabled = false;
						host.ui.notice(t("ai.install.terminalFailed"));
						manuelOuvert?.();
						return;
					}
					m.panelEl.dataset.state = "en-cours";
					etat.replaceChildren();
					ajouter(etat, "span", "qbd-install-spinner");
					ajouter(etat, "span", undefined, t("ai.install.running"));
					sonde = window.setInterval(() => {
						void deps.probe().then(async (res) => {
							if (!res.ok || sonde === null) return;
							couperSonde();
							await deps.onDetected();
							m.panelEl.dataset.state = "detecte";
							etat.replaceChildren();
							host.ui.setIcon(ajouter(etat, "span", "qbd-install-check"), "check");
							ajouter(etat, "span", undefined, res.version
								? t("ai.install.detected", { name, version: res.version })
								: t("ai.install.detectedNoVersion", { name }));
							const continuer = ajouter(etat, "button", "qbd-btn--create qbd-install-continue", t("ai.install.continue"));
							continuer.type = "button";
							continuer.addEventListener("click", () => m.close());
						});
					}, SONDE_MS);
				});
			}

			/* La voie manuelle : repliée sous Windows (le bouton fait le travail),
			   ouverte et seule ailleurs. `renderCollapsibleSection` veut un état de
			   repli ; ici il est local au modal, jamais persisté. */
			let ouvert = !(win && host.process);
			const corps = renderCollapsibleSection(
				{ isExpanded: () => ouvert, toggleExpanded: () => { ouvert = !ouvert; } },
				c, "install-manual", t("ai.install.manual"), 4, { defaultOpen: ouvert, rowClass: "qbd-install-manual-row" },
			);
			manuelOuvert = () => {
				if (ouvert) return;
				(c.querySelector(".qbd-install-manual-row .qbd-quizzes-node-head") as HTMLButtonElement | null)?.click();
			};
			const etapes = ajouter(corps, "ol", "qbd-install-steps");
			ajouter(etapes, "li", undefined, t(win ? "ai.install.step1" : "ai.install.step1Unix"));
			const li2 = ajouter(etapes, "li", undefined, t("ai.install.step2"));
			const cmd = installCmd(deps.provider, win);
			const bloc = ajouter(li2, "div", "qbd-install-code markdown-rendered markdown-preview-view");
			if (deps.renderCodeBlock) deps.renderCodeBlock(bloc, cmd.code, cmd.lang);
			else ajouter(ajouter(bloc, "pre"), "code", "language-" + cmd.lang, cmd.code);
			const copier = ajouter(li2, "button", "qbd-btn qbd-install-copy");
			copier.type = "button";
			const copierIcone = ajouter(copier, "span", "qbd-btn-icon qbd-btn-icon--sm");
			host.ui.setIcon(copierIcone, "copy");
			ajouter(copier, "span", undefined, t("ai.install.copy"));
			copier.addEventListener("click", async () => {
				/* Par l'hôte dès qu'il sait copier : dans la fenêtre de l'app,
				   `navigator.clipboard` est refusé par le principal et échouerait
				   en silence — c'est pourquoi `copyText` existe. */
				const ok = deps.copyText
					? await deps.copyText(cmd.code)
					: await navigator.clipboard.writeText(cmd.code).then(() => true, () => false);
				if (!ok) return;
				copierIcone.replaceChildren();
				host.ui.setIcon(copierIcone, "check");
				window.setTimeout(() => { copierIcone.replaceChildren(); host.ui.setIcon(copierIcone, "copy"); }, 1500);
			});
			ajouter(etapes, "li", undefined, t(`ai.install.step3.${deps.provider}`));
			ajouter(etapes, "li", undefined, t("ai.install.step4"));

			const lien = ajouter(c, "a", "qbd-install-learn", t("ai.install.learnMore"));
			lien.href = DOCS[deps.provider];
			lien.target = "_blank";
			lien.rel = "noopener";
		},
		onClose: () => {
			couperSonde();
			deps.onClose();
		},
	});
}
```

Vérifier dans `src/dom.ts` la signature exacte d'`ajouter` (`ajouter(parent, tag, cls?, text?)`) et dans `host/types.ts` que `HostPlatform` expose `isWindows`.

- [ ] **Step 3: Le CSS du modal** (`dashboard-ai.css`, après le bloc `.qbd-ai-preview-modal*`)

```css
/* ── Le modal d'un fournisseur absent (spec 2026-09-17, § 3b) ── */
.qbd-install-modal { width: 520px; max-width: calc(100vw - 32px); }
.qbd-install-what { margin: 0 0 14px; color: var(--text-muted); line-height: 1.5; }
.qbd-install-auto { width: 100%; justify-content: center; }
.qbd-install-auto-hint { margin: 8px 0 16px; font-size: 12px; color: var(--text-faint); line-height: 1.45; }
.qbd-install-state { display: flex; align-items: center; gap: 10px; min-height: 0; }
.qbd-install-state:not(:empty) { margin: 0 0 14px; padding: 10px 12px; border-radius: 10px; background: var(--background-modifier-hover); }
.qbd-install-modal[data-state="en-cours"] .qbd-install-auto,
.qbd-install-modal[data-state="detecte"] .qbd-install-auto,
.qbd-install-modal[data-state="detecte"] .qbd-install-auto-hint { display: none; }
.qbd-install-spinner {
	width: 14px; height: 14px; flex-shrink: 0; border-radius: 50%;
	border: 2px solid var(--text-faint); border-top-color: var(--interactive-accent);
	animation: qbd-install-spin 0.8s linear infinite;
}
@keyframes qbd-install-spin { to { transform: rotate(360deg); } }
.qbd-install-check { color: var(--color-green, #4ade80); display: inline-flex; }
.qbd-install-check svg { width: 16px; height: 16px; }
.qbd-install-continue { margin-left: auto; }
.qbd-install-steps { margin: 6px 0 0; padding-left: 20px; line-height: 1.5; }
.qbd-install-steps li { margin: 0 0 8px; }
.qbd-install-code { margin: 6px 0; }
.qbd-install-code pre { margin: 0; padding: 8px 10px; border-radius: 8px; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.qbd-install-copy { margin-top: 4px; }
.qbd-install-learn { display: inline-flex; margin-top: 12px; font-size: 12.5px; color: var(--interactive-accent); text-decoration: none; }
.qbd-install-learn:hover { text-decoration: underline; }
```

Relire `check:view-enter` : l'animation `qbd-install-spin` est infinie mais n'est PAS posée sous une classe `.qbd-*-enter`, donc hors de sa portée. `npm run check:view-enter` le confirme.

- [ ] **Step 4: Câbler `ai.ts`**

1. `AiPageDeps` : ajouter `copyText?(texte: string): Promise<boolean>;` avec le commentaire « Le presse-papiers par l'hôte (le modal d'installation copie une commande) ; dans la fenêtre de l'app, `navigator.clipboard` est refusé. »
2. Supprimer la fonction `installCmd` d'`ai.ts` (lignes ~1310-1334) et importer `openInstallModal, type InstallProvider` depuis `./ai-install-modal`.
3. Ajouter, près de `refreshProviderStatuses`, la fonction qui ouvre le modal :

```ts
	/* Le modal d'un fournisseur absent — ouvert depuis l'option du menu (qui
	   ne se sélectionne pas) comme depuis le bouton du hint. Sur détection, le
	   fournisseur devient celui des réglages ; à la fermeture, statuts et
	   hints sont relus pour que le menu dise le nouvel état. */
	function ouvrirModalInstallation(id: InstallProvider, rafraichir: () => void): void {
		const probe = id === "claude-code" ? () => aiProviders.checkClaudeCode(true)
			: id === "codex" ? () => aiProviders.checkCodex(true)
			: () => aiProviders.checkOllama(settings().aiOllamaUrl, true);
		openInstallModal({
			provider: id,
			probe: async () => {
				const res = await probe();
				return res.ok ? { ok: true, version: "version" in res ? res.version : undefined } : { ok: false };
			},
			onDetected: async () => {
				if (settings().aiProvider === id) return;
				await saveSettings({ aiProvider: id, aiModel: aiProviders.getProvider(id).defaultModel });
			},
			onClose: () => { rafraichir(); render(containerRef); },
			copyText: deps.copyText,
			renderCodeBlock: deps.renderCodeBlock,
		});
	}
```

4. Dans `buildProviderControl`, `options:` devient `aiProviders.PROVIDERS.map(p => ({ value: p.id, label: p.name, logo: p.logo, sub: p.sub, disabled: providerStatus[p.id]?.dot === "err" }))` et le sélecteur reçoit `onDisabledClick: (id) => ouvrirModalInstallation(id as InstallProvider, () => refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true }))`. Comme `providerStatus` est rempli en asynchrone, `setStatus` doit aussi remettre `disabled` à jour : après `providerStatus[id] = { dot, text };`, si `providerSelect`, appeler `providerSelect.setOptions(aiProviders.PROVIDERS.map(p => ({ …même objet…, disabled: providerStatus[p.id]?.dot === "err" })), settings().aiProvider || undefined)` — extraire cette construction dans une fonction `optionsFournisseurs()` appelée aux deux endroits. Vérifier dans `ui-select.ts` que `setOptions` conserve la valeur donnée et ne ferme pas le menu ouvert (sinon appeler `refreshMenu` après).
5. Les trois hints « absent » (dans `refreshProviderStatuses`) deviennent, pour Claude :

```ts
				setHint("claude-code", hintZone, provider, {
					type: "err", icon: "download",
					text: t("ai.hint.claudeNotInstalled"),
					action: {
						label: t("ai.hint.installClaude"), icon: "download",
						onClick: () => ouvrirModalInstallation("claude-code", () => refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true }))
					}
				});
```

Idem Codex (`ai.hint.codexNotInstalled`, `ai.hint.installCodex`) et Ollama absent (`ai.hint.ollamaNotInstalled`, `ai.hint.installOllama`) — plus de `...installCmd(...)`, plus de `window.open`. Le hint « serveur Ollama arrêté » ne change pas.

6. `apps/windows/src/ui/dashboard-shell.ts:398` : passer à `createAiHandlers` la même fonction que `copyText` du shell (`copyText: async (texte) => { try { await pont().systeme.copierTexte(texte); return true; } catch { return false; } }` — la réutiliser plutôt que la recopier : la sortir en `const copierTexte = …` au-dessus, utilisée aux deux endroits).

Run: `npm run check && npm run check:app && npm run check:host && npm run check:view-enter`
Expected: vert.

- [ ] **Step 5: À l'écran (Ahmed, VM)**

Menu des fournisseurs → clic sur Claude (absent) → le modal ; « Installer automatiquement » → la confirmation native → PowerShell ; le modal passe en « en cours » ; une fois `claude` installé, « Claude Code vX est installé » → « Continuer » → le contrôle Modèle apparaît. Puis la voie manuelle : dérouler, copier, coller.

- [ ] **Step 6: CHANGELOG**

Sous `## [Unreleased]`, `### Added` : `- Install Claude Code, the Codex CLI or Ollama from the app: a provider that is missing opens a window that explains what it is, installs it in one click (PowerShell opens with the official installer) and detects it once it is there. Manual steps stay available.` Sous `### Changed` : `- The hint under the composer no longer shows a raw command; it opens the same window.`

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/ai-install-modal.ts src/dashboard/ai.ts apps/windows/src/ui/dashboard-shell.ts src/i18n/en/ai.ts src/i18n/fr/ai.ts src/assets/css/dashboard/dashboard-ai.css CHANGELOG.md
git commit -m "un fournisseur absent s'installe d'un clic depuis l'app

L'option du menu ne se sélectionne plus : elle ouvre un modal qui dit
ce qu'est l'outil, installe par PowerShell avec la recette officielle,
sonde la détection et choisit le fournisseur quand il apparaît. La voie
manuelle en quatre étapes reste, repliée. Le hint ne montre plus de
commande brute."
```

---

### Task 7: L'accueil vide sans référence à `quiz-blocks`

**Files:**
- Modify: `src/dashboard/home.ts:387-466` (`renderOnboarding`)
- Modify: `src/dashboard/folder-create.ts:27-39` (`createOptionCard` exporté, `modal` optionnel)
- Modify: `src/i18n/en/dashboard.ts:44-55`, `src/i18n/fr/dashboard.ts` (clés retirées)
- Modify: `src/assets/css/dashboard/dashboard-home.css:200-295` (blocs retirés, un bloc ajouté)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `openNewFolderModal(ctx, map, quizzes, onDone)` de `./module-edit`, `importSharedFolder(ctx, map, quizzes, onDone)` de `./folder-create`, `ctx.openExistingFolder?(onDone)`.
- Produces: `export function createOptionCard(modal: HostModalHandle | null, parent, icon, accent, title, desc, onPick): void` — `modal` nul = rien à fermer.

- [ ] **Step 1: `createOptionCard` exporté, sans modal**

Dans `folder-create.ts`, `function createOptionCard(modal: HostModalHandle, …)` devient `export function createOptionCard(modal: HostModalHandle | null, …)` et le clic `card.addEventListener("click", () => { modal?.close(); onPick(); });`. Commentaire : « `modal` nul sur l'accueil vide (`home.ts`), où les mêmes trois cartes se rendent sur la page : rien à fermer. »

- [ ] **Step 2: `renderOnboarding`**

Remplacer tout ce qui suit le séparateur (de `// Méthode manuelle` à la fin de la fonction) par :

```ts
		/* Les trois cartes du modal « Créer un dossier », rendues sur place
		   (spec « utilisable par n'importe qui », § 1) : personne ne crée un quiz
		   à la main dans un bloc de code, et « Générer » au-dessus EST la carte
		   IA. Même composant, même CSS : aucune apparence de plus à tenir. */
		const cartes = ajouter(wrap, "div", "qbd-onboarding-cards");
		createOptionCard(null, cartes, "folder-plus", "#4573ff", t("dashboard.quizzes.createEmptyTitle"), t("dashboard.quizzes.createEmptyDesc"),
			() => openNewFolderModal(ctx, map, allQuizzes, rerender));
		if (ctx.openExistingFolder) {
			createOptionCard(null, cartes, "folder-open", "#f5a524", t("dashboard.quizzes.createOpenTitle"), t("dashboard.quizzes.createOpenDesc"),
				() => ctx.openExistingFolder!(rerender));
		}
		createOptionCard(null, cartes, "download", "#a78bfa", t("dashboard.quizzes.createImportTitle"), t("dashboard.quizzes.createImportDesc"),
			() => void importSharedFolder(ctx, map, allQuizzes, rerender));
```

`renderOnboarding(container)` est appelée depuis `render` (ligne ~110) juste après le calcul de `map` (`applyModuleOverrides(...)`, ligne ~101) et d'`allQuizzes` (`ctx.scanner.getQuizzes()`, ligne ~105) : changer sa signature en `renderOnboarding(container: HTMLElement, map: ModuleMap, allQuizzes: QuizIndexEntry[])` et l'appel en `renderOnboarding(container, map, allQuizzes)`. `rerender` est la fonction de la page (ligne ~79). Importer `createOptionCard, importSharedFolder` depuis `./folder-create` et `openNewFolderModal` depuis `./module-edit` (c'est là qu'elle vit, `folder-create.ts` l'importe aussi). Retirer l'usage de `ctx.copyText` et `CODE_SAMPLE`.

- [ ] **Step 3: Les clés et le CSS**

Supprimer dans `en/dashboard.ts` et `fr/dashboard.ts` : `dashboard.onboarding.manualTitle`, `manualDesc`, `copy`, `sampleTitle`, `samplePrompt` et leur commentaire d'avertissement. Dans `en/dashboard.ts`, `dashboard.onboarding.lead` : remplacer les deux tirets longs par des deux-points et une virgule : `"Turn your notes into interactive quizzes: multiple choice, fill in the blank, matching, to revise and test yourself."` ; en français : `"Transformez vos notes en quiz interactifs : QCM, texte à compléter, association, pour réviser et vous auto-évaluer."`.

`dashboard-home.css` : supprimer les blocs `.qbd-onboarding-manual`, `-manual-head`, `-manual-icon`, `-manual-icon svg`, `-manual-desc`, `-code-wrap`, `-code`, `-code code`, `.qbd-root .qbd-onboarding-copy`, `:hover`, `.qbd-onboarding-copy svg` (lignes ~200-295). Ajouter :

```css
/* Les trois cartes de création, à la largeur qu'avait la carte code. */
.qbd-onboarding-cards { width: 100%; max-width: 480px; }
```

Run: `npm run check && npm run check:app && npm run check:dashboard-dom && grep -rn "onboarding.manual\|onboarding.sample\|onboarding.copy" src`
Expected: vert, et le `grep` ne rend rien.

- [ ] **Step 4: À l'écran (Ahmed, VM, aucun quiz)**

Accueil : « Générer mon premier quiz », « ou », trois cartes. Aucun bloc de code.

- [ ] **Step 5: CHANGELOG**

`### Changed` : `- The welcome screen no longer shows a code block: it offers to generate a quiz, create an empty folder, open an existing folder or import a quiz.`

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/home.ts src/dashboard/folder-create.ts src/i18n/en/dashboard.ts src/i18n/fr/dashboard.ts src/assets/css/dashboard/dashboard-home.css CHANGELOG.md
git commit -m "l'accueil vide propose les trois cartes de création, plus de bloc de code"
```

---

### Task 8: « Add notes » retiré, Ctrl+E ouvre le sélecteur de fichiers, et le raccourci marche

**Files:**
- Modify: `src/dashboard/ai.ts` (menu « + » → clic direct ; `openAddNotes` retiré ; `keydown` sur le conteneur ; `dispose`)
- Modify: `src/dashboard/ai-settings-host.ts:67-71`
- Modify: `src/types/dashboard-ctx.ts:50-51` (commentaire sur `hotkeyAddNotes`)
- Modify: `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts` (`ai.add.notes` retirée, `ai.add.filesTip` ajoutée)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `eventToHotkey(e)` de `src/hotkey-format.ts`, `formatHotkey`.
- Produces: `AiHandlers.openAddNotes` disparaît de l'interface (vérifier par `grep -rn openAddNotes src apps` qu'aucun appelant ne reste).

- [ ] **Step 1: Le défaut et le réglage mort**

`ai-settings-host.ts` : `hotkeyAddFiles: { modifiers: ["Mod"], key: "e" },` — commentaire : « Ctrl+E, plus facile à atteindre que Ctrl+U (demande Ahmed, 2026-09-17). » Supprimer `hotkeyAddNotes` des défauts et du type de retour (`& { hotkeyAddFiles: Hotkey }`). Dans `dashboard-ctx.ts`, laisser `hotkeyAddNotes?: Hotkey | null;` avec le commentaire « IGNORÉ depuis le 2026-09-17 (le bouton « Add notes » n'existe plus) ; jamais effacé, comme les réglages de la dictée. »

- [ ] **Step 2: Le bouton « + »**

Dans `ai.ts`, remplacer le `addBtn.addEventListener("click", () => { openActionMenu(addBtn, [ … ]) })` par :

```ts
		// Le « + » ouvre DIRECTEMENT le sélecteur de fichiers : « Add notes »
		// a disparu (le picker « @ » fait la même chose, mieux), et un menu à
		// une seule entrée serait un détour. L'infobulle porte le raccourci.
		addBtn.title = t("ai.add.filesTip", { hotkey: formatHotkey(settings().hotkeyAddFiles) });
		addBtn.setAttribute("aria-label", addBtn.title);
		addBtn.addEventListener("click", () => openAddFiles());
```

Supprimer `openAddNotes`, `addBtnRef` (et sa déclaration), l'entrée `openAddNotes` du retour de `createAiHandlers` et de `AiHandlers`. Si `openActionMenu` n'a plus d'appelant dans `ai.ts`, retirer son import. Clés : `"ai.add.filesTip": "Add files or images ({hotkey})"` / `"Ajouter des fichiers ou des images ({hotkey})"` ; supprimer `ai.add.notes` (en + fr).

- [ ] **Step 3: Le raccourci qui marche**

Dans `render(container)`, après la construction du composer, poser UN écouteur sur le conteneur de la page (pas `document` : deux pages ne se disputent jamais la touche) et le retirer dans `dispose` :

```ts
		// Le raccourci « Ajouter des fichiers » : dans l'application, rien ne
		// le liait depuis la tâche 1 du greffon lecteur — le menu affichait un
		// raccourci mort. Posé sur le conteneur de la page, relu à chaque frappe
		// (le réglage peut changer), retiré dans `dispose`.
		if (raccourciComposer) raccourciComposer.retirer();
		const surTouche = (e: KeyboardEvent): void => {
			const hk = eventToHotkey(e);
			const voulu = settings().hotkeyAddFiles;
			if (!hk || !voulu || hk.key !== voulu.key) return;
			const a = [...(hk.modifiers || [])].sort().join("+");
			const b = [...(voulu.modifiers || [])].sort().join("+");
			if (a !== b) return;
			e.preventDefault();
			openAddFiles();
		};
		container.addEventListener("keydown", surTouche);
		raccourciComposer = { retirer: () => container.removeEventListener("keydown", surTouche) };
```

Déclarer `let raccourciComposer: { retirer(): void } | null = null;` au niveau des autres états de la page, et dans `dispose()` : `raccourciComposer?.retirer(); raccourciComposer = null;`. Importer `eventToHotkey` depuis `../hotkey-format`. Le conteneur doit pouvoir recevoir le focus clavier : le textarea du composer est dedans, `keydown` remonte jusqu'au conteneur.

Run: `npm run check && npm run check:app && grep -rn "openAddNotes\|hotkeyAddNotes\|ai.add.notes" src apps/windows/src`
Expected: vert ; le `grep` ne rend que le commentaire de `dashboard-ctx.ts`.

- [ ] **Step 4: À l'écran (Ahmed)**

« + » → dialogue de fichiers ; Ctrl+E (curseur dans le composer) → dialogue ; survol du « + » → « Ajouter des fichiers ou des images (Ctrl+E) ».

- [ ] **Step 5: CHANGELOG**

`### Changed` : `- The "+" button of the composer opens the file picker directly; "Add notes" is gone (use "@" to attach a note). The shortcut is Ctrl+E.` `### Fixed` : `- The "Add files" shortcut now works in the app.`

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/ai.ts src/dashboard/ai-settings-host.ts src/types/dashboard-ctx.ts src/i18n/en/ai.ts src/i18n/fr/ai.ts CHANGELOG.md
git commit -m "le + ouvre les fichiers, Add notes disparaît, Ctrl+E fonctionne"
```

---

### Task 9: Un fichier choisi par le dialogue natif s'ouvre depuis son aperçu

**Files:**
- Modify: `apps/windows/electron/perimetre.ts` (`autoriserFichier`, `bornerEcriture`)
- Modify: `apps/windows/electron/canaux.ts` (canaux d'écriture → `bornerEcriture` ; `CANAUX.systemeChoisirFichiers`)
- Modify: `apps/windows/electron/pont.ts`, `apps/windows/electron/preload.ts`
- Modify: `apps/windows/src/host/fs.ts` (`externe.pickFiles`), `apps/windows/src/host/index.ts` (`shell.openExternal` accepte une chaîne)
- Modify: `src/host/types.ts` (`HostFs.externe.pickFiles?`, `HostShell.openExternal(file: HostFile | string)`)
- Modify: `src/dashboard/ai.ts` (`openAddFiles`, `poserApercuPdf`)
- Modify: `scripts/check-electron-reglages.mjs`, `scripts/check-windows-host.mjs`, `scripts/check-obsidian-host.mjs` (si un cas y fige la signature d'`openExternal`)
- Modify: `docs/superpowers/notes/controles.md`, `CHANGELOG.md`

**Interfaces:**
- Produces:
  - `Perimetre.autoriserFichier(abs: string): Promise<void>` — admet UN fichier existant (résolu) en lecture/ouverture ; `Perimetre.bornerEcriture(chemin: unknown): Promise<string>` — comme `borner`, mais n'accepte que les `racines`.
  - `HostFs.externe.pickFiles?(kind: "documents" | "images" | "any"): Promise<string[]>` — chemins ABSOLUS, `[]` si annulé.
  - `HostShell.openExternal(file: HostFile | string): Promise<boolean>` — une chaîne est un chemin ABSOLU (un fichier admis).
  - `CANAUX.systemeChoisirFichiers = "neo:systeme/choisir-fichiers"` ; `Pont.systeme.choisirFichiers(kind): Promise<string[]>`.

- [ ] **Step 1: Les cas du périmètre, qui échouent**

Dans `scripts/check-electron-reglages.mjs`, dans le groupe `creerPerimetre` (après le cas `estRacine`), ajouter :

```js
		await cas(r, "un FICHIER admis se lit et s'ouvre, mais ne s'écrit pas", async () => {
			const choisi = join(ailleurs, "choisi.pdf");
			await writeFile(choisi, "%PDF", "utf-8");
			await p.autoriserFichier(choisi);
			r.check("un FICHIER admis se lit et s'ouvre, mais ne s'écrit pas",
				{
					lecture: await p.borner(choisi),
					ecriture: await aRejete(() => p.bornerEcriture(choisi)),
					voisin: await aRejete(() => p.borner(join(ailleurs, "secret.md"))),
					racineEcriture: await p.bornerEcriture(join(racine, "Cours", "n.md")),
				},
				{
					lecture: choisi.replace(/\\/g, "/"),
					ecriture: true,
					voisin: true,
					racineEcriture: join(racine, "Cours", "n.md").replace(/\\/g, "/"),
				});
		});

		await cas(r, "autoriserFichier ignore un dossier et un chemin absent", async () => {
			await p.autoriserFichier(ailleurs);
			await p.autoriserFichier(join(ailleurs, "absent.pdf"));
			r.check("autoriserFichier ignore un dossier et un chemin absent",
				{ dossier: await aRejete(() => p.borner(join(ailleurs, "secret.md"))), absent: await aRejete(() => p.borner(join(ailleurs, "absent.pdf"))) },
				{ dossier: true, absent: true });
		});
```

Run: `npm run check:electron-reglages`
Expected: rouge (`autoriserFichier is not a function`).

- [ ] **Step 2: `perimetre.ts`**

Dans l'interface `Perimetre` :

```ts
	/** Admet UN fichier existant (résolu) en LECTURE et OUVERTURE — jamais en
	    écriture. C'est ce qu'un fichier choisi dans le dialogue natif obtient :
	    l'utilisateur l'a désigné pour le joindre, pas pour qu'on l'écrase. */
	autoriserFichier(abs: string): Promise<void>;
	/** Comme `borner`, mais n'accepte que les RACINES : les canaux qui
	    écrivent, déplacent ou effacent passent par ici. */
	bornerEcriture(chemin: unknown): Promise<string>;
```

Dans `creerPerimetre` : `const fichiersLecture: string[] = [];` ; `dansPerimetre` devient `dansPerimetre(chemin, ecriture = false)` :

```ts
	async function dansPerimetre(chemin: string, ecriture = false): Promise<string | null> {
		const reel = await resoudre(chemin);
		if (reel === null) return null;
		if (contratDepuisAbsolu(racines, reel) !== null) return reel;
		if (!ecriture && fichiersLecture.some(f => f.toLowerCase() === reel.toLowerCase())) return reel;
		return null;
	}
```

Puis les deux méthodes :

```ts
		async autoriserFichier(abs) {
			const reel = await resoudre(abs);
			if (reel === null) return;
			try {
				if (!(await fs.stat(reel)).isFile()) return;
			} catch {
				return;
			}
			if (!fichiersLecture.some(f => f.toLowerCase() === reel.toLowerCase())) fichiersLecture.push(reel);
		},
		async bornerEcriture(chemin) {
			if (typeof chemin !== "string" || !chemin.trim()) {
				throw new Error("chemin invalide : " + JSON.stringify(chemin));
			}
			if ((await dansPerimetre(chemin, true)) === null) {
				throw new Error("chemin hors des dossiers ouverts (écriture) : " + chemin);
			}
			return normaliser(path.resolve(chemin));
		},
```

Mettre à jour l'en-tête du fichier : « CE QUI ALIMENTE LA LISTE » gagne « les FICHIERS choisis dans le dialogue natif (`choisirFichiers`), en lecture seule ».

Run: `npm run check:electron-reglages`
Expected: vert. Discriminance : faire ignorer `ecriture` dans `dansPerimetre` → le cas « ne s'écrit pas » rougit → restaurer.

- [ ] **Step 3: Les canaux d'écriture passent par `bornerEcriture`**

Dans `canaux.ts`, pour `write`, `writeBinary`, `append`, `process`, `mkdirs`, `trash`, `remove`, `rename` (ses DEUX arguments) : `perimetre.borner(…)` → `perimetre.bornerEcriture(…)`. Lire chaque gestionnaire (lignes ~286-364) et ne toucher qu'à ceux qui ÉCRIVENT ; `read`, `readCached`, `readBinary`, `exists`, `stat`, `statEntree`, `list`, `listerDossier`, `liste`, `ouvrir` restent sur `borner`. Le canal `trash` vérifie aussi `estRacine` : inchangé.

Ajouter le canal du dialogue, après `systemeChoisirDossierDefaut` :

```ts
	/* Le dialogue natif de FICHIERS : « Add files » du composer. Les filtres
	   sont composés ICI depuis une union fermée, jamais reçus. Chaque fichier
	   choisi est admis au périmètre en LECTURE et OUVERTURE seulement
	   (`autoriserFichier`) : c'est ce qui donne un bouton « Ouvrir » à
	   l'aperçu d'un PDF joint, sans ouvrir le disque en écriture. */
	const FILTRES: Record<string, { name: string; extensions: string[] }[]> = {
		documents: [{ name: "Documents", extensions: ["pdf", "md", "txt"] }, { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
		images: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
		any: [],
	};
	ipcMain.handle(CANAUX.systemeChoisirFichiers, async (_e, kind: unknown) => {
		const filtres = typeof kind === "string" && kind in FILTRES ? FILTRES[kind] : FILTRES.any;
		const fenetre = deps.fenetreCourante();
		const proprietes: ("openFile" | "multiSelections")[] = ["openFile", "multiSelections"];
		const choix = fenetre
			? await dialog.showOpenDialog(fenetre, { properties: proprietes, filters: filtres })
			: await dialog.showOpenDialog({ properties: proprietes, filters: filtres });
		if (choix.canceled) return [];
		const admis: string[] = [];
		for (const brut of choix.filePaths) {
			const abs = normaliser(brut);
			await perimetre.autoriserFichier(abs);
			admis.push(abs);
		}
		return admis;
	});
```

`pont.ts` : `CANAUX.systemeChoisirFichiers: "neo:systeme/choisir-fichiers"` et, dans `systeme`, `choisirFichiers(kind: "documents" | "images" | "any"): Promise<string[]>;` avec un commentaire qui renvoie au périmètre. `preload.ts` : `choisirFichiers: kind => ipcRenderer.invoke(CANAUX.systemeChoisirFichiers, kind),`.

- [ ] **Step 4: Le contrat et l'hôte du rendu**

`src/host/types.ts`, dans `HostFs.externe` :

```ts
		/** Le dialogue natif de fichiers de l'hôte, OPTIONNEL (le greffon n'en
		    a pas : la page garde son `<input type="file">`). Rend des chemins
		    ABSOLUS que l'hôte a admis en lecture et ouverture ; `[]` si annulé. */
		pickFiles?(kind: "documents" | "images" | "any"): Promise<string[]>;
```

`HostShell.openExternal` : `openExternal(file: HostFile | string): Promise<boolean>;` — doc : « Une CHAÎNE est un chemin ABSOLU : un fichier que l'hôte a admis (dialogue natif). Sous le greffon, seule la forme `HostFile` existe. »

`apps/windows/src/host/fs.ts`, dans l'objet `externe` : `pickFiles: (kind) => pont().systeme.choisirFichiers(kind),`.

`apps/windows/src/host/index.ts`, `shell.openExternal` :

```ts
		async openExternal(file) {
			const a = typeof file === "string" ? file : (file && index.get(file.path) ? carte.absolu(file.path) : null);
			if (!a) return false;
			try {
				return await pont().systeme.ouvrir(a);
			} catch (e) {
				console.warn(LOG_PREFIX, "ouverture externe refusée:", e);
				return false;
			}
		},
```

`apps/obsidian/host.ts` : `openExternal(file)` reçoit désormais `HostFile | string` ; y ajouter `if (typeof file === "string") return false;` en tête avec le commentaire « pas de racine externe sous le greffon ».

- [ ] **Step 5: La page**

`openAddFiles` :

```ts
	function openAddFiles(): void {
		/* Par le dialogue natif quand l'hôte en a un : les chemins reviennent,
		   admis en lecture, et l'aperçu d'un PDF pourra l'OUVRIR. Sans lui, le
		   `<input type="file">` du navigateur, dont le File n'a aucun chemin. */
		const natif = host.fs.externe.pickFiles;
		if (natif) {
			void natif("documents").then(async (chemins) => {
				for (const abs of chemins) await attachExternalPath(abs);
			});
			return;
		}
		if (fileInputRef && fileInputRef.isConnected) fileInputRef.click();
	}
```

`attachExternalPath` commence par `if (!host.platform.isDesktopApp) return;` : conserver. `poserApercuPdf` : la condition du bouton devient

```ts
		const fichier: HostFile | string | null = note.path
			? (note.source === "vault" ? host.fs.getFile(note.path) : note.source === "external" ? note.path : null)
			: null;
```

et le reste du bloc (`host.shell.openExternal(fichier)`) est inchangé. Mettre à jour le commentaire : « Un PDF venu d'une racine externe ou du dialogue natif a un chemin ABSOLU que l'hôte a admis ; un PDF déposé (`source: "file"`) n'en a pas et garde son aperçu sans bouton. »

- [ ] **Step 6: Les contrôles d'hôte**

`check-windows-host.mjs` : au faux pont, `systeme.choisirFichiers: async (kind) => { journal.push(["systeme.choisirFichiers", kind]); return ["C:/tmp/choisi.pdf"]; }` et un cas : `externe.pickFiles("documents")` rend `["C:/tmp/choisi.pdf"]` et journalise `["systeme.choisirFichiers", "documents"]` ; et `shell.openExternal("C:/tmp/choisi.pdf")` appelle `systeme.ouvrir` avec ce chemin tel quel. `check-obsidian-host.mjs` : un cas « `openExternal` d'une chaîne rend `false` sans appeler `openWithDefaultApp` » (lire le script pour son faux `app`).

Run: `npm run check && npm run check:app && npm run check:electron-reglages && npm run check:windows-host && npm run check:obsidian-host`
Expected: vert.

- [ ] **Step 7: `controles.md`**

Dans l'entrée `check:electron-reglages` : « Depuis le 2026-09-17, le périmètre a DEUX listes : les racines (lecture et écriture) et les fichiers admis par le dialogue natif (lecture et ouverture seulement, `autoriserFichier`/`bornerEcriture`). Le cas « un fichier admis ne s'écrit pas » est ce qui empêche « choisis-moi ce fichier » de devenir « écris dedans ». »

- [ ] **Step 8: À l'écran (Ahmed)**

« + » → un PDF de `Téléchargements` → carte → clic → aperçu avec « Ouvrir » → le lecteur PDF du système.

- [ ] **Step 9: CHANGELOG**

`### Fixed` : `- A PDF added with "Add files" can now be opened from its preview, like one attached with "@".`

- [ ] **Step 10: Commit**

```bash
git add apps/windows/electron/perimetre.ts apps/windows/electron/canaux.ts apps/windows/electron/pont.ts apps/windows/electron/preload.ts apps/windows/src/host/fs.ts apps/windows/src/host/index.ts apps/obsidian/host.ts src/host/types.ts src/dashboard/ai.ts scripts/check-electron-reglages.mjs scripts/check-windows-host.mjs scripts/check-obsidian-host.mjs docs/superpowers/notes/controles.md CHANGELOG.md
git commit -m "un fichier choisi par le dialogue natif s'ouvre depuis son aperçu

Add files passe par le dialogue du principal, qui admet chaque fichier
au périmètre en lecture et ouverture seulement (bornerEcriture pour tout
ce qui écrit). L'aperçu d'un PDF a alors son bouton Ouvrir."
```

---

### Task 10: L'aperçu d'une note, plus propre : callouts comme Obsidian, liens en texte, propriétés masquées

**Files:**
- Modify: `src/markdown-preview.ts` (callouts, liens, propriétés)
- Modify: `scripts/check-md-preview.mjs` (cas adaptés + neufs)
- Modify: `src/dashboard/ai.ts` (`ouvrirApercu` : bouton « Propriétés », icônes des callouts)
- Modify: `src/assets/css/dashboard/dashboard-ai.css` (`.callout*` dans l'aperçu, `.mdp-prop*`, `.qbd-ai-preview-meta-path`)
- Modify: `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts` (`ai.preview.props`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: `renderMarkdownPreview(texte)` rend un callout dans le DOM d'Obsidian : `<div class="callout" data-callout="<type>"><div class="callout-title"><div class="callout-icon" data-icon="<lucide>"></div><div class="callout-title-inner">…</div></div><div class="callout-content">…</div></div>` ; un lien non ouvrable (`[texte](fichier.pdf)`) rend `texte` seul ; les propriétés : `<div class="mdp-frontmatter" hidden>` avec des `.mdp-prop` où une liste YAML devient des `<span class="mdp-pill">` dans la valeur de sa clé.
- Consumes (tâche 11) : `poserIconesCallouts(corps)` exportée d'`ai.ts` ? Non — elle vit dans `ai.ts` et est appelée après `innerHTML` ; la tâche 11 l'appelle après avoir injecté les styles.

- [ ] **Step 1: Adapter les cas de `check:md-preview`, qui échouent**

Remplacer le cas « un encadré typé… » par :

```js
	r.check("un encadré prend le DOM d'Obsidian (callout, data-callout, icône, titre, contenu)",
		md("> [!cours] Cours\n> - [CM1](https://x.y/cm1.pdf)"),
		'<div class="callout" data-callout="cours"><div class="callout-title"><div class="callout-icon" data-icon="pencil"></div><div class="callout-title-inner">Cours</div></div><div class="callout-content"><ul><li><a class="mdp-link" href="https://x.y/cm1.pdf" target="_blank" rel="noopener">CM1</a></li></ul></div></div>');
	r.check("un type connu porte l'icône d'Obsidian", md("> [!warning]\n> x").includes('data-icon="alert-triangle"'), true);
	r.check("un encadré sans titre prend son type, capitalisé", md("> [!warning]\n> Attention").includes('<div class="callout-title-inner">Warning</div>'), true);
	r.check("un lien vers un fichier que l'aperçu ne peut pas ouvrir rend son TEXTE seul",
		md("[TP1 — Prise en main](TP1.pdf) · [x](../a b.md)"), "<p>TP1 — Prise en main · x</p>");
	r.check("un wikilink reste un texte (plus de crochets, pas de lien)", md("[[XTI301 - Python|le cours]]"), '<p><span class="mdp-wikilink">le cours</span></p>');
```

Et le cas des propriétés par :

```js
	r.check("les propriétés : masquées par défaut, une liste YAML en pastilles sous sa clé",
		md("---\ntitle: XTI301\ntags:\n  - efrei\n  - python\n---\n# Titre"),
		'<div class="mdp-frontmatter" hidden><div class="mdp-prop"><span class="mdp-prop-key">title</span><span class="mdp-prop-value">XTI301</span></div><div class="mdp-prop"><span class="mdp-prop-key">tags</span><span class="mdp-prop-value"><span class="mdp-pill">efrei</span><span class="mdp-pill">python</span></span></div></div><h1>Titre</h1>');
```

Run: `npm run check:md-preview`
Expected: rouge sur ces cinq cas.

- [ ] **Step 2: `markdown-preview.ts`**

Lire la fonction qui rend un callout (chercher `mdp-callout` dans le fichier) et la remplacer par :

```ts
/* Les icônes d'Obsidian par type (docs « Callouts › Supported types »). Un
   type inconnu prend `pencil`, comme là-bas ; un snippet du vault peut le
   remplacer par `--callout-icon: lucide-…`, relu par la page après le rendu. */
const ICONES_CALLOUT: Record<string, string> = {
	note: "pencil", abstract: "clipboard-list", summary: "clipboard-list", tldr: "clipboard-list",
	info: "info", todo: "check-circle-2", tip: "flame", hint: "flame", important: "flame",
	success: "check", check: "check", done: "check", question: "help-circle", help: "help-circle", faq: "help-circle",
	warning: "alert-triangle", caution: "alert-triangle", attention: "alert-triangle",
	failure: "x", fail: "x", missing: "x", danger: "zap", error: "zap", bug: "bug", example: "list", quote: "quote", cite: "quote",
};

function callout(type: string, titre: string, corpsHtml: string): string {
	const t = type.toLowerCase();
	return `<div class="callout" data-callout="${esc(t)}"><div class="callout-title"><div class="callout-icon" data-icon="${ICONES_CALLOUT[t] ?? "pencil"}"></div><div class="callout-title-inner">${titre}</div></div><div class="callout-content">${corpsHtml}</div></div>`;
}
```

(Brancher `callout(...)` là où `mdp-callout` était composé, avec le même titre — capitalisé quand absent — et le même corps.)

Les liens, dans `inline` après `LIEN_MD` :

```ts
const LIEN_AUTRE = /\[([^\]]+)\]\(([^)]+)\)/g;
	// Un lien que l'aperçu ne peut pas ouvrir (fichier relatif, chemin) rend
	// son TEXTE seul : des crochets bruts se lisent mal, et un lien qui ne
	// répond pas serait un mensonge.
	html = html.replace(LIEN_AUTRE, (_m, texteLien: string) => texteLien);
```

Les propriétés :

```ts
function proprietes(lignes: string[]): string {
	const rangees: { cle: string; valeur: string; items: string[] }[] = [];
	for (const l of lignes) {
		const kv = l.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (kv) { rangees.push({ cle: kv[1], valeur: kv[2], items: [] }); continue; }
		const item = l.match(/^\s+-\s+(.*)$/);
		if (item && rangees.length) rangees[rangees.length - 1].items.push(item[1]);
	}
	const html = rangees.map(r => {
		const valeur = r.items.length
			? r.items.map(i => `<span class="mdp-pill">${esc(i)}</span>`).join("")
			: esc(r.valeur);
		return `<div class="mdp-prop"><span class="mdp-prop-key">${esc(r.cle)}</span><span class="mdp-prop-value">${valeur}</span></div>`;
	}).join("");
	// MASQUÉES par défaut (demande Ahmed 2026-09-17) : la page pose un bouton
	// qui retire `hidden`.
	return `<div class="mdp-frontmatter" hidden>${html}</div>`;
}
```

Run: `npm run check:md-preview`
Expected: vert.

- [ ] **Step 3: La page : bouton « Propriétés », icônes, chemin**

Dans `ouvrirApercu` (`ai.ts`), après la ligne de métadonnées :

```ts
				/* Les propriétés sont masquées par défaut ; ce bouton les montre.
				   L'état n'est pas persisté : c'est un aperçu. */
				const props = corps.querySelector<HTMLElement>(".mdp-frontmatter");
				if (props) {
					const btn = ajouter(meta, "button", "qbd-ai-preview-props");
					btn.type = "button";
					host.ui.setIcon(ajouter(btn, "span", "qbd-btn-icon qbd-btn-icon--sm"), "list");
					ajouter(btn, "span", undefined, t("ai.preview.props"));
					btn.setAttribute("aria-pressed", "false");
					btn.addEventListener("click", () => {
						props.hidden = !props.hidden;
						btn.setAttribute("aria-pressed", String(!props.hidden));
					});
				}
				poserIconesCallouts(corps);
```

(Le `corps` doit être créé AVANT ce bloc : déplacer la construction de `corps` et son `innerHTML` au-dessus, ou faire le bloc après.) Et la fonction, au niveau des autres helpers de la page :

```ts
	/* Les icônes des encadrés, posées APRÈS le rendu : le HTML pur ne sait pas
	   dessiner un Lucide, et un snippet du vault (tâche 11) peut imposer le
	   sien par `--callout-icon: lucide-<nom>` — lu ici, comme Obsidian le fait. */
	function poserIconesCallouts(corps: HTMLElement): void {
		for (const el of Array.from(corps.querySelectorAll<HTMLElement>(".callout"))) {
			const icone = el.querySelector<HTMLElement>(".callout-icon");
			if (!icone) continue;
			const declare = getComputedStyle(el).getPropertyValue("--callout-icon").trim();
			const nom = declare.startsWith("lucide-") ? declare.slice(7) : (icone.dataset.icon || "pencil");
			icone.replaceChildren();
			host.ui.setIcon(icone, nom);
		}
	}
```

Clés : `"ai.preview.props": "Properties"` / `"Propriétés"`.

CSS (`dashboard-ai.css`, remplacer les règles `.mdp-callout*` par le socle d'Obsidian, limité à l'aperçu) :

```css
/* Les encadrés, au DOM et aux variables d'Obsidian (`--callout-color` en
   triplet rgb, `--callout-icon`) : c'est ce qui permet aux snippets d'un
   vault de s'appliquer tels quels (tâche 11). Couleurs des types natifs
   copiées d'app.css d'Obsidian. */
.qbd-ai-preview-md .callout { --callout-color: 8, 109, 221; margin: 1em 0; padding: 0; border-radius: 8px; background-color: rgba(var(--callout-color), 0.1); mix-blend-mode: normal; overflow: hidden; }
.qbd-ai-preview-md .callout-title { display: flex; align-items: center; gap: 6px; padding: 8px 12px; color: rgb(var(--callout-color)); font-weight: 600; }
.qbd-ai-preview-md .callout-icon { display: inline-flex; flex-shrink: 0; }
.qbd-ai-preview-md .callout-icon svg { width: 16px; height: 16px; }
.qbd-ai-preview-md .callout-content { padding: 0 12px 8px; }
.qbd-ai-preview-md .callout-content > :first-child { margin-top: 0; }
.qbd-ai-preview-md .callout[data-callout="abstract"], .qbd-ai-preview-md .callout[data-callout="summary"], .qbd-ai-preview-md .callout[data-callout="tldr"],
.qbd-ai-preview-md .callout[data-callout="tip"], .qbd-ai-preview-md .callout[data-callout="hint"], .qbd-ai-preview-md .callout[data-callout="important"] { --callout-color: 0, 191, 188; }
.qbd-ai-preview-md .callout[data-callout="success"], .qbd-ai-preview-md .callout[data-callout="check"], .qbd-ai-preview-md .callout[data-callout="done"] { --callout-color: 8, 185, 78; }
.qbd-ai-preview-md .callout[data-callout="question"], .qbd-ai-preview-md .callout[data-callout="help"], .qbd-ai-preview-md .callout[data-callout="faq"],
.qbd-ai-preview-md .callout[data-callout="warning"], .qbd-ai-preview-md .callout[data-callout="caution"], .qbd-ai-preview-md .callout[data-callout="attention"] { --callout-color: 236, 117, 0; }
.qbd-ai-preview-md .callout[data-callout="failure"], .qbd-ai-preview-md .callout[data-callout="fail"], .qbd-ai-preview-md .callout[data-callout="missing"],
.qbd-ai-preview-md .callout[data-callout="danger"], .qbd-ai-preview-md .callout[data-callout="error"], .qbd-ai-preview-md .callout[data-callout="bug"] { --callout-color: 233, 49, 71; }
.qbd-ai-preview-md .callout[data-callout="example"] { --callout-color: 120, 82, 238; }
.qbd-ai-preview-md .callout[data-callout="quote"], .qbd-ai-preview-md .callout[data-callout="cite"] { --callout-color: 158, 158, 158; }

/* Les propriétés, compactes ; les pastilles d'une liste. */
.mdp-prop { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 10px; padding: 3px 0; align-items: baseline; }
.mdp-prop-value { display: flex; flex-wrap: wrap; gap: 4px; }
.mdp-pill { padding: 1px 8px; border-radius: 999px; background: var(--background-modifier-hover); font-size: 11.5px; }
.mdp-wikilink { color: inherit; }

/* Le chemin ne déborde plus : il prend le reste de la ligne, tronqué par le
   DÉBUT pour garder le nom du fichier visible. */
.qbd-ai-preview-meta { display: flex; align-items: center; gap: 6px; min-width: 0; }
.qbd-ai-preview-meta-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; unicode-bidi: plaintext; }
.qbd-ai-preview-props { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; }
.qbd-ai-preview-props[aria-pressed="true"] { color: var(--interactive-accent); }
```

Supprimer `.mdp-prop--item` et l'ancienne règle `.mdp-wikilink { color: accent }`. Lire les règles existantes de `.qbd-ai-preview-meta` (ligne ~1319) et fusionner plutôt que dupliquer.

Run: `npm run check && npm run check:app && npm run check:md-preview && npm run check:theme`
Expected: vert.

- [ ] **Step 4: À l'écran (Ahmed)**

`TP1.md` joint → aperçu : propriétés cachées, bouton « Propriétés » les montre en pastilles ; chemin lisible tronqué par le début ; « Sujet original » sans crochets ; encadrés avec icône.

- [ ] **Step 5: CHANGELOG**

`### Changed` : `- The note preview hides properties by default (a button shows them), keeps file links readable and renders callouts like Obsidian.`

- [ ] **Step 6: Commit**

```bash
git add src/markdown-preview.ts scripts/check-md-preview.mjs src/dashboard/ai.ts src/assets/css/dashboard/dashboard-ai.css src/i18n/en/ai.ts src/i18n/fr/ai.ts CHANGELOG.md
git commit -m "l'aperçu d'une note : callouts au DOM d'Obsidian, liens en texte, propriétés masquées"
```

---

### Task 11: L'aperçu reprend les snippets du vault d'où vient la note

**Files:**
- Create: `src/vault-styles.ts` (pur : `porterSnippet`, `assemblerStyles`)
- Create: `scripts/check-vault-styles.mjs` ; Modify: `package.json` (`check:vault-styles`), `.github/workflows/ci.yml`
- Create: `apps/windows/electron/vault-styles.ts` (`stylesDuVault`)
- Modify: `apps/windows/electron/canaux.ts`, `pont.ts`, `preload.ts` (`CANAUX.vaultStyles`)
- Modify: `src/host/types.ts` (`Host.styles?`), `apps/windows/src/host/index.ts`, nouveau `apps/windows/src/host/styles.ts`
- Modify: `src/dashboard/ai.ts` (`ouvrirApercu`)
- Modify: `scripts/check-windows-host.mjs`, `scripts/check-electron-reglages.mjs` (ou un groupe dans `check-vault-styles.mjs` pour `stylesDuVault` sur un dossier temporaire)
- Modify: `docs/superpowers/notes/controles.md`, `CHANGELOG.md`

**Interfaces:**
- Produces:
  - `porterSnippet(css: string, baseUrl: string): string` — enveloppe dans `@scope (.qbd-ai-preview-md) { … }`, réécrit `body`/`html`/`:root` en tête de sélecteur en `:scope`, résout les `url(...)` relatives sur `baseUrl` (les absolues, `data:`, `http(s):` sont laissées).
  - `assemblerStyles(snippets: { css: string; baseUrl: string }[]): string`.
  - `stylesDuVault(cheminNoteAbs: string, vaults: { chemin: string }[], lire: (abs: string) => Promise<string>): Promise<{ snippets: { css: string; dossier: string }[] } | null>` — cherche le vault qui contient la note (préfixe de chemin, insensible à la casse, séparateurs `/`), lit `appearance.json` → `enabledCssSnippets`, lit chaque `.obsidian/snippets/<nom>.css` (un fichier absent est ignoré, jamais une erreur) ; `null` hors vault ou sans `appearance.json`.
  - Contrat : `Host.styles?: { forNote(path: string): Promise<string | null> }` — `path` du CONTRAT ; `null` = rien à injecter. L'app le sert par `CANAUX.vaultStyles(abs)` ; le greffon ne l'a pas.
- Consumes: `urlDeRessource(absolu)` de `apps/windows/electron/ressources.ts` (SANS_NODE, importable du rendu ET du principal), `vaultsObsidian()` de `apps/windows/electron/vaults.ts`, `poserIconesCallouts` (tâche 10).

- [ ] **Step 1: Le contrôle pur, qui échoue**

```js
// scripts/check-vault-styles.mjs
/**
 * LES STYLES D'UN VAULT DANS L'APERÇU D'UNE NOTE — la partie PURE.
 * Ce qu'il tient : un snippet n'atteint QUE l'aperçu (`@scope`), les
 * sélecteurs `body`/`:root` deviennent `:scope` au lieu de ne rien toucher,
 * les `url()` relatives se résolvent sur le dossier `snippets/` du vault, et
 * les absolues restent absolues.
 *
 *     npm run check:vault-styles
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/vault-styles.ts", async ({ porterSnippet, assemblerStyles }) => {
	const r = makeReporter("Styles d'un vault dans l'aperçu");
	const base = "app://neo-res/C:/vault/.obsidian/snippets/";

	r.check("un snippet est enveloppé dans @scope sur l'aperçu",
		porterSnippet(".callout { color: red }", base), "@scope (.qbd-ai-preview-md) {\n.callout { color: red }\n}");
	r.check("body, html et :root en tête de sélecteur deviennent :scope",
		porterSnippet("body { --x: 1 }\n:root{--y:2}\nhtml .a { b: c }\n.theme-dark body .z { k: v }", base),
		"@scope (.qbd-ai-preview-md) {\n:scope { --x: 1 }\n:scope{--y:2}\n:scope .a { b: c }\n.theme-dark :scope .z { k: v }\n}");
	r.check("une url relative se résout sur le dossier snippets, avec ses segments encodés",
		porterSnippet("@font-face { src: url(\"Tungsten Black.woff2\") }", base),
		"@scope (.qbd-ai-preview-md) {\n@font-face { src: url(\"app://neo-res/C:/vault/.obsidian/snippets/Tungsten%20Black.woff2\") }\n}");
	r.check("une url absolue, data: ou http(s): est laissée",
		porterSnippet("a{b:url(data:x)} c{d:url('https://e/f.png')} g{h:url(/i.png)}", base),
		"@scope (.qbd-ai-preview-md) {\na{b:url(data:x)} c{d:url('https://e/f.png')} g{h:url(/i.png)}\n}");
	r.check("assemblerStyles concatène, un snippet par bloc",
		assemblerStyles([{ css: ".a{}", baseUrl: base }, { css: ".b{}", baseUrl: base }]).split("@scope").length - 1, 2);
	r.done();
});
```

`package.json` : `"check:vault-styles": "node scripts/check-vault-styles.mjs"` ; `ci.yml` : une étape après `check:changelog`.

Run: `npm run check:vault-styles`
Expected: rouge (module absent).

- [ ] **Step 2: `src/vault-styles.ts`**

```ts
/* ══════════════════════════════════════════════════════════
   LES STYLES D'UN VAULT, PORTÉS À L'APERÇU D'UNE NOTE — PUR

   Spec « utilisable par n'importe qui » (2026-09-17, § 6a) : une note qui
   vient d'un vault Obsidian se montre avec les SNIPPETS de ce vault. Ils
   sont écrits pour tout Obsidian ; ici ils ne doivent atteindre QUE
   l'aperçu, d'où `@scope (.qbd-ai-preview-md)`. Le conteneur porte les
   classes `markdown-preview-view markdown-rendered theme-dark` : les préfixes
   qu'un snippet pose devant ses sélecteurs matchent la racine de la portée.
   `body`, `html` et `:root` ne peuvent pas être dans la portée : ils
   deviennent `:scope`, et rien d'autre n'est réécrit.

   Aucun DOM ici : une chaîne entre, une chaîne sort (`check:vault-styles`).
══════════════════════════════════════════════════════════ */

const RACINE_APERCU = ".qbd-ai-preview-md";
/* `body`, `html`, `:root` en TÊTE d'un sélecteur (début de ligne, après `,`
   ou après un `}`), suivis d'un espace, d'un `{`, d'une virgule, d'un `.`, d'un
   `[` ou d'un `:` — jamais au milieu d'un mot (`.bodyguard`). */
const HOTE = /(^|[,}\n]\s*)(?:body|html|:root)(?=[\s{,.\[:])/g;
const URL_RELATIVE = /url\(\s*(['"]?)(?!data:|https?:|app:|file:|\/|[A-Za-z]:)([^'")]+)\1\s*\)/g;

export function porterSnippet(css: string, baseUrl: string): string {
	const porte = css
		.replace(HOTE, (_m, avant: string) => avant + ":scope")
		.replace(URL_RELATIVE, (_m, q: string, rel: string) => `url(${q}${baseUrl}${rel.split("/").map(encodeURIComponent).join("/")}${q})`);
	return `@scope (${RACINE_APERCU}) {\n${porte}\n}`;
}

export function assemblerStyles(snippets: { css: string; baseUrl: string }[]): string {
	return snippets.map(s => porterSnippet(s.css, s.baseUrl)).join("\n\n");
}
```

Run: `npm run check:vault-styles`
Expected: vert. Si le cas `body` échoue sur `.theme-dark body .z`, c'est que `HOTE` n'admet pas un espace avant `body` en milieu de sélecteur : ajouter `\s` à la classe `[,}\n]` (le `\s*` qui suit reste).

- [ ] **Step 3: Le principal : `apps/windows/electron/vault-styles.ts` et le canal**

```ts
/* Les snippets ACTIVÉS du vault qui contient une note — lus par le principal,
   qui compose lui-même les chemins (`.obsidian/appearance.json`, puis
   `.obsidian/snippets/<nom>.css`) : le rendu n'envoie qu'un chemin de note.
   `lire` est un paramètre pour l'éprouver sur un dossier temporaire. */
import { normaliser } from "./perimetre";

export interface StylesVault { snippets: { css: string; dossier: string }[] }

export async function stylesDuVault(
	cheminNoteAbs: string,
	vaults: { chemin: string }[],
	lire: (abs: string) => Promise<string>,
): Promise<StylesVault | null> {
	const note = normaliser(cheminNoteAbs).toLowerCase();
	const vault = vaults.find(v => {
		const racine = normaliser(v.chemin).toLowerCase().replace(/\/+$/, "") + "/";
		return note.startsWith(racine);
	});
	if (!vault) return null;
	const obsidian = normaliser(vault.chemin).replace(/\/+$/, "") + "/.obsidian";
	let noms: string[];
	try {
		const json = JSON.parse(await lire(obsidian + "/appearance.json")) as { enabledCssSnippets?: unknown };
		noms = Array.isArray(json.enabledCssSnippets) ? json.enabledCssSnippets.filter((n): n is string => typeof n === "string") : [];
	} catch {
		return null;
	}
	const dossier = obsidian + "/snippets";
	const snippets: { css: string; dossier: string }[] = [];
	for (const nom of noms) {
		if (nom.includes("/") || nom.includes("\\") || nom.includes("..")) continue;
		try {
			snippets.push({ css: await lire(dossier + "/" + nom + ".css"), dossier });
		} catch {
			// Un snippet activé mais absent du disque : Obsidian l'ignore aussi.
		}
	}
	return { snippets };
}
```

Vérifier que `normaliser` est bien exporté de `perimetre.ts` (sinon de `fichiers.ts` ; l'importer d'où il vit).

`canaux.ts` :

```ts
	/* Les styles du vault d'une note (aperçu, tâche 11). Le chemin reçu est
	   BORNÉ comme une lecture ; les fichiers lus ensuite sont composés ici,
	   dans `.obsidian/` du vault déclaré qui contient la note. */
	ipcMain.handle(CANAUX.vaultStyles, async (_e, abs: unknown) => {
		const a = await perimetre.borner(abs);
		const res = await stylesDuVault(a, await vaultsObsidian(), chemin => fsp.readFile(chemin, "utf-8"));
		if (!res) return null;
		return res.snippets.map(s => ({ css: s.css, baseUrl: urlDeRessource(s.dossier) + "/" }));
	});
```

`pont.ts` : `CANAUX.vaultStyles: "neo:systeme/vault-styles"` ; dans `systeme` : `vaultStyles(abs: string): Promise<{ css: string; baseUrl: string }[] | null>;`. `preload.ts` : `vaultStyles: abs => ipcRenderer.invoke(CANAUX.vaultStyles, abs),`. Vérifier que `urlDeRessource` produit bien une URL SANS `/` final et que `fsp` est l'import `node:fs/promises` déjà présent dans `canaux.ts`.

- [ ] **Step 4: Le contrat et l'hôte du rendu**

`src/host/types.ts` :

```ts
/** Les styles du vault d'une note — OPTIONNEL : seule l'application sait
    lire `.obsidian/` d'un vault déclaré (le greffon VIT dans le vault, ses
    snippets s'appliquent déjà). `null` = rien à injecter. */
export interface HostStyles {
	/** `path` du CONTRAT. La chaîne rendue est du CSS déjà porté à l'aperçu
	    (`src/vault-styles.ts`), à poser dans un `<style>` du modal. */
	forNote(path: string): Promise<string | null>;
}
```

et dans `Host` : `styles?: HostStyles;`.

`apps/windows/src/host/styles.ts` :

```ts
import type { HostStyles } from "../../../../src/host/types";
import { assemblerStyles } from "../../../../src/vault-styles";
import type { CarteRacines } from "./roots";
import { pont } from "./pont";

export function createWindowsStyles(carte: CarteRacines): HostStyles {
	return {
		async forNote(path) {
			const abs = carte.absolu(path);
			if (!abs) return null;
			try {
				const snippets = await pont().systeme.vaultStyles(abs);
				return snippets && snippets.length ? assemblerStyles(snippets) : null;
			} catch (e) {
				console.warn("[Neo Quiz] styles du vault illisibles:", e);
				return null;
			}
		},
	};
}
```

(Le préfixe de log : utiliser `LOG_PREFIX` de `src/branding.ts` comme les autres modules de l'hôte.) `index.ts` : `styles: createWindowsStyles(carte),`.

`check-windows-host.mjs` : faux pont `systeme.vaultStyles: async (abs) => { journal.push(["systeme.vaultStyles", abs]); return [{ css: ".callout{}", baseUrl: "app://neo-res/v/.obsidian/snippets/" }]; }` ; un cas : `hote.styles.forNote("<chemin du contrat d'une note de la carte>")` rend une chaîne qui commence par `@scope (.qbd-ai-preview-md)`, et journalise l'ABSOLU ; un chemin hors racine rend `null` sans appel.

- [ ] **Step 5: La page**

Dans `ouvrirApercu`, la branche note : avant de rendre `corps`, injecter les styles, puis rendre, puis poser les icônes (elles lisent `--callout-icon`) :

```ts
				const corps = ajouter(c, "div", "qbd-ai-preview-md markdown-preview-view markdown-rendered theme-dark");
				corps.innerHTML = renderMarkdownPreview(note.content);
				void mathifyElement(corps);
				/* Les snippets du vault d'où vient la note, portés au seul aperçu
				   (`@scope`) et retirés avec le contenu à la fermeture. Les icônes des
				   encadrés se posent APRÈS : un snippet peut en imposer une. */
				const styles = note.source === "vault" && note.path && host.styles ? host.styles.forNote(note.path) : Promise.resolve(null);
				void styles.then(css => {
					if (css && m.panelEl.isConnected) {
						const style = ajouter(m.panelEl, "style");
						style.setAttribute("data-nq-vault-styles", "");
						style.textContent = css;
					}
					poserIconesCallouts(corps);
				});
```

(Retirer l'appel `poserIconesCallouts(corps)` posé à la tâche 10 juste après `innerHTML`, il vit désormais dans le `then`.) Vérifier que l'hôte vide bien `panelEl` ou retire le `<style>` à la fermeture (`apps/windows/src/host/modal.ts`, ligne ~100 : le panneau entier est détaché → le `<style>` part avec lui).

Run: `npm run check && npm run check:app && npm run check:host && npm run check:vault-styles && npm run check:windows-host`
Expected: vert.

- [ ] **Step 6: À l'écran (Ahmed)**

`TP1.md` du vault Efrei joint → aperçu → les encadrés « Sujet original » et « Mode d'emploi » avec le gabarit des snippets `base`/`efrei` ; le reste de l'app inchangé (le `@scope` tient) ; fermer, rouvrir : idem.

- [ ] **Step 7: `controles.md`, CHANGELOG**

`controles.md` : entrée `check:vault-styles` : « la portée `@scope` d'un snippet de vault dans l'aperçu : sans elle, un snippet qui restyle `body` recolorait toute l'application le temps d'un aperçu, et un `url()` relatif partait chercher la police à la racine de l'app. » CHANGELOG `### Added` : `- The note preview uses the CSS snippets of the Obsidian vault the note comes from, so callouts look like they do in Obsidian.`

- [ ] **Step 8: Commit**

```bash
git add src/vault-styles.ts scripts/check-vault-styles.mjs package.json .github/workflows/ci.yml apps/windows/electron/vault-styles.ts apps/windows/electron/canaux.ts apps/windows/electron/pont.ts apps/windows/electron/preload.ts src/host/types.ts apps/windows/src/host/styles.ts apps/windows/src/host/index.ts src/dashboard/ai.ts scripts/check-windows-host.mjs docs/superpowers/notes/controles.md CHANGELOG.md
git commit -m "l'aperçu d'une note reprend les snippets de son vault, portés par @scope"
```

---

### Task 13: La destination d'un quiz généré porte l'icône de son dossier et sa racine

Vu à l'écran par Ahmed le 2026-09-17 au soir, pendant le chantier : le menu
« Destination » du popover des options listait « Generated » DEUX fois. Ce ne
sont pas des doublons : `C:\Neo Quiz\Generated` (le défaut, 2 quiz) et
`C:\obsidian-vaults\Personal\Generated` (1 quiz) existent tous deux. La liste
a raison de montrer les deux, elle a tort de les rendre indiscernables. Et
Ahmed voudrait y voir l'icône choisie pour chaque dossier.

**Files:**
- Modify: `src/dashboard/ai.ts` (`AiPageDeps.quizFolders`, `destinationOptions`)
- Modify: `apps/windows/src/ui/dashboard-shell.ts` (`dossiersDeQuiz`)
- Modify: `src/dashboard/ui-select.ts` (`openOptionsMenu`, section Destination, ~lignes 1095-1300)
- Modify: `src/assets/css/dashboard/dashboard-ai.css` (`.qbd-opts-dd-icon`, `.qbd-opts-dd-sub`, ~ligne 1999)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `moduleIcon(m, { generated })`, `GENERATED_MODULE_ICON` de `src/dashboard/module-icons.ts` ; `moduleAccent(m, { generated })`, `GENERATED_MODULE_ACCENT` de `src/dashboard/module-color.ts` ; `ctx.generatedFolder?()` (`DashboardShellCtx`) ; `currentHost().paths.rootOf(path)` (`HostPaths`, rend `HostRoot | null`, dont `name`).
- Produces: `AiPageDeps.quizFolders?(): { path: string; name: string; icon: string; color: string; root: string }[]` ; `openOptionsMenu(..., { folders?: { value: string; label: string; icon?: string; color?: string; sub?: string }[] })`.

- [ ] **Step 1: L'hôte décrit chaque dossier**

Dans `apps/windows/src/ui/dashboard-shell.ts`, `dossiersDeQuiz()` rend pour chaque dossier, en plus de `path` et `name`, son icône, sa couleur et sa racine :

```ts
	/* L'icône, la couleur et la RACINE de chaque dossier, pour que le menu
	   « Destination » les montre : deux dossiers homonymes (« Generated » dans
	   Neo Quiz et dans Personal) étaient indiscernables (Ahmed, 2026-09-17).
	   Même règle d'icône et d'accent que la carte du dossier (`moduleIcon`,
	   `moduleAccent`) : une icône choisie l'emporte, le SAS des générés a son
	   étincelle, le reste son livre. */
	function decrire(path: string, name: string): { path: string; name: string; icon: string; color: string; root: string } {
		const overrides = ctx.settings.quizzesModuleOverrides || {};
		const ov = Object.values(overrides).find(o => o?.path === path) ?? overrides[name];
		const generated = path === ctx.generatedFolder?.();
		return {
			path, name,
			icon: moduleIcon(ov ?? {}, { generated }),
			color: moduleAccent({ folder: name, color: ov?.color }, { generated }),
			root: currentHost().paths.rootOf(path)?.name ?? "",
		};
	}
```

et `return [...vus.entries()].map(([path, name]) => decrire(path, name)).sort((a, b) => a.name.localeCompare(b.name));`. Importer `moduleIcon` et `moduleAccent` depuis `src/dashboard/module-icons` et `src/dashboard/module-color` (chemins relatifs comme les autres imports de `src/` dans ce fichier). Vérifier que `ctx` (le `DashboardShellCtx`) est en portée là où `dossiersDeQuiz` est définie ; sinon lire `ctx.settings` et `generatedFolder` par le même chemin que les fonctions voisines.

- [ ] **Step 2: La page compose les options**

Dans `src/dashboard/ai.ts`, `AiPageDeps.quizFolders?(): { path: string; name: string; icon: string; color: string; root: string }[]` (doc : « `icon`, `color`, `root` : l'apparence de la carte du dossier et le nom de sa racine, pour que deux dossiers homonymes se distinguent »). `destinationOptions()` devient :

```ts
	function destinationOptions(): { value: string; label: string; icon: string; color: string; sub: string }[] {
		const defaut = defaultDestination();
		const racine = host.paths.defaultRoot();
		const options = [{
			value: "",
			label: settings().aiOutputFolder || aiSettingsDefaults().aiOutputFolder,
			icon: GENERATED_MODULE_ICON,
			color: GENERATED_MODULE_ACCENT,
			sub: racine.name,
		}];
		const vus = new Set([defaut]);
		for (const d of deps.quizFolders?.() ?? []) {
			if (!d.path || vus.has(d.path)) continue;
			vus.add(d.path);
			options.push({ value: d.path, label: d.name || d.path, icon: d.icon, color: d.color, sub: d.root });
		}
		return options;
	}
```

Importer `GENERATED_MODULE_ICON` (`./module-icons`) et `GENERATED_MODULE_ACCENT` (`./module-color`). L'infobulle du bouton d'options (`attachHoverTip`, ~ligne 1107) affiche `choisi.label` : la laisser telle quelle.

- [ ] **Step 3: Le menu montre icône, nom et racine**

Dans `src/dashboard/ui-select.ts`, le type `folders` d'`openOptionsMenu` devient `{ value: string; label: string; icon?: string; color?: string; sub?: string }[]`. Dans la boucle `for (const f of folders)` :

```ts
			const item = ajouter(destMenu, "button", "qbd-opts-dd-item");
			item.type = "button";
			item.dataset.folder = f.value;
			ajouter(item, "span", "qbd-select-check");
			if (f.icon) {
				const ic = ajouter(item, "span", "qbd-opts-dd-icon");
				if (f.color) ic.style.setProperty("--accent", f.color);
				currentHost().ui.setIcon(ic, f.icon);
			}
			const body = ajouter(item, "span", "qbd-opts-dd-body");
			ajouter(body, "span", "qbd-opts-dd-name", f.label);
			// La RACINE en sous-titre : c'est elle qui distingue deux dossiers
			// homonymes (« Generated » de Neo Quiz et de Personal).
			if (f.sub) ajouter(body, "span", "qbd-opts-dd-sub", f.sub);
```

(le `addEventListener("click", …)` qui suit ne change pas). Et le déclencheur (`refreshDest`) montre l'icône du dossier choisi devant son nom : remplacer `destLabel.textContent = choisi.label;` par

```ts
			destLabel.replaceChildren();
			if (choisi.icon) {
				const ic = ajouter(destLabel, "span", "qbd-opts-dd-icon");
				if (choisi.color) ic.style.setProperty("--accent", choisi.color);
				currentHost().ui.setIcon(ic, choisi.icon);
			}
			ajouter(destLabel, "span", undefined, choisi.label);
```

- [ ] **Step 4: Le CSS** (`dashboard-ai.css`, après `.qbd-opts-dd-item.is-active`)

```css
/* Destination : l'icône du dossier (à sa couleur) et sa racine en sous-titre. */
.qbd-opts-dd-icon { display: inline-flex; flex-shrink: 0; color: var(--accent, var(--text-muted)); }
.qbd-opts-dd-icon svg { width: 14px; height: 14px; }
.qbd-opts-dd-label { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
.qbd-opts-dd-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; text-align: left; }
.qbd-opts-dd-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qbd-opts-dd-sub { font-size: 10.5px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

Lire les règles existantes de `.qbd-opts-dd-item` et `.qbd-opts-dd-label` (~lignes 1990-2025) : si `.qbd-opts-dd-item` n'est pas déjà en `display: flex; align-items: center; gap`, l'y mettre, sinon l'icône et le corps ne s'alignent pas.

- [ ] **Step 5: Vérifier**

Run: `npm run check && npm run check:app && npm run check:host`
Expected: vert. À l'écran (Ahmed) : Générer → options → Destination : « Generated · Neo Quiz » avec l'étincelle, « Generated · Personal », « Templates · Personal », « XTI301 - Écosystème Python · Efrei » avec son icône `braces` bleue.

- [ ] **Step 6: CHANGELOG**

`### Fixed` : `- Two destination folders with the same name (two "Generated") are told apart: each entry shows its folder icon and the root it belongs to.`

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/ai.ts apps/windows/src/ui/dashboard-shell.ts src/dashboard/ui-select.ts src/assets/css/dashboard/dashboard-ai.css CHANGELOG.md
git commit -m "la destination d'un quiz porte l'icône de son dossier et sa racine"
```

---

### Task 12: Vérification dans la VM, note du vault, livraison (contrôleur)

**Files:**
- Modify: `C:\obsidian-vaults\Personal\Projets\Neo Quiz\Objectifs & Idées.md` (callout 5 : items cochés, puis `goal-done` à la publication)
- Modify: `CHANGELOG.md` (relecture : ordre des sous-sections, une ligne par changement visible)

- [ ] **Step 1: Tous les contrôles, code de sortie lu**

Run: `npm run check && npm run check:host && npm run check:theme && npm run check:view-enter && npm run check:installer && npm run check:app && npm run check:electron-process && npm run check:electron-reglages && npm run check:windows-host && npm run check:obsidian-host && npm run check:md-preview && npm run check:vault-styles && npm run check:changelog && npm test`
Expected: tout à 0. Lire chaque code de sortie, pas la fin de la sortie.

- [ ] **Step 2: Le parcours complet dans la VM, par Ahmed**

Installer `NeoQuiz-1.1.0.exe` dans la VM (ou attendre la mise à jour), puis lancer l'app en dev depuis la branche (`npm run app:dev`) ou construire un paquet local (`npm run pack:win`) et l'installer. Parcours : accueil vide (trois cartes) → Générer → menu des fournisseurs (pastilles alignées) → Claude → modal → installation automatique → PowerShell → connexion → détecté → Continuer → Modèle visible ; « + » et Ctrl+E → PDF de Téléchargements → aperçu → Ouvrir ; une note d'un vault → aperçu aux styles du vault, propriétés masquées puis affichées.

- [ ] **Step 3: Relire `CHANGELOG.md`**

La section `[Unreleased]` porte, dans l'ordre `### Added`, `### Changed`, `### Fixed`, une ligne par changement visible des tâches 5 à 11 et 13 ; aucune ligne ne cite un fichier ni un SHA. `deduireNiveau` doit rendre `minor` : `node -e "import('./scripts/changelog.mjs').then(async m => console.log(m.deduireNiveau(m.lireUnreleased(require('fs').readFileSync('CHANGELOG.md','utf8')).sections)))"` → `minor`.

- [ ] **Step 4: La note du vault**

Dans `Objectifs & Idées.md`, callout 5 : chaque item 1 à 6 passe en `[x]` avec le SHA court de son commit ; puis, à la publication : le titre devient `> [!goal-done]- <span class="num">5.</span> \`desktop-v1.2.0\` — utilisable par quelqu'un qui ne connaît pas Claude Code — publiée le AAAA-MM-JJ`, les items « À décider au fil de l'usage » (7 à 9) déménagent dans un nouveau `> [!goal] <span class="num">6.</span> \`desktop-v1.2.1\` — version future` (numéro indicatif : c'est le CHANGELOG qui décide désormais, l'écrire dans le chapeau du callout).

- [ ] **Step 5: Livrer**

Run: `node scripts/ship.mjs` (arbre propre, aucun niveau : le CHANGELOG impose `minor` → `1.2.0`)
Expected: `Version 1.2.0 livrée.`, puis `gh run list --workflow=release.yml --limit 1` en `success`, et `gh release view desktop-v1.2.0 --json body --jq .body` qui montre la section du CHANGELOG.
