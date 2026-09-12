// Config d'empaquetage (tache 7 de la migration Tauri -> Electron).
//
// Deux sorties existent deja avant electron-builder : `dist/` (le rendu,
// construit par Vite) et `dist-electron/` (le processus principal et le
// preload, construits par `electron/construire.mjs`, cf. sa note d'en-tete).
// Ce fichier ne fait que les EMPAQUETER dans un installeur ; il ne recompile
// rien lui-meme, d'ou `"build"` qui enchaine les deux avant `electron-builder`
// dans `apps/windows/package.json`.
//
// FORMAT JS ET NON YAML (Ruling 23, ronde de correction 1) : la version reelle
// du produit vit dans UN SEUL fichier, `src/assets/manifest.json` (voir
// `scripts/set-version.mjs` et CLAUDE.md) — `apps/windows/package.json` porte
// un `"0.0.0"` statique et jamais bumpe, exactement comme le plugin Obsidian.
// Un `electron-builder.yml` statique aurait lu ce `0.0.0` et rien ne l'aurait
// tenu a jour ; `extraMetadata.version` ci-dessous force electron-builder a
// lire le numero qui compte, sans jamais dupliquer le numero dans un second
// fichier que rien ne suit.
//
// PIEGE VERIFIE : electron-builder n'AUTO-DETECTE que les configs
// `electron-builder.{yml,yaml,json,json5,toml}` ou le champ `build` de
// `package.json` — un `.mjs` a cote n'est jamais charge tout seul (verifie
// une fois : un premier essai sans `--config` a ignore ce fichier en
// silence, empaquete avec le nom et la version par defaut de package.json,
// ET ecrit dans `dist/` au lieu de `dist-installer/`, melangeant le paquet
// avec la sortie Vite). Les scripts `pack:win` / `pack:linux` de
// `package.json` passent donc `--config electron-builder.config.mjs`
// explicitement ; ne jamais lancer `electron-builder` nu sans ce flag.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const manifestUrl = new URL("../../src/assets/manifest.json", import.meta.url);

async function lireVersionDuManifeste() {
	const brut = await readFile(fileURLToPath(manifestUrl), "utf8");
	return JSON.parse(brut).version;
}

export default async function () {
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
		/* LE FLUX DES MISES À JOUR : la dernière release GitHub de ce dépôt.
		   Cette clé fait deux choses à l'empaquetage : écrire `latest.yml` /
		   `latest-linux.yml` (version + sha512 des paquets) dans
		   `dist-installer/`, et embarquer `resources/app-update.yml` dans le
		   paquet — c'est ce fichier que lit electron-updater, jamais une URL
		   venue du rendu. Elle ne PUBLIE rien : les scripts `pack:*` passent
		   `--publish never`, parce que sous un tag et avec `GH_TOKEN`,
		   electron-builder créerait lui-même une release brouillon à côté de
		   celle de `release.yml`. */
		publish: { provider: "github", owner: "ahmed-mili", repo: "neo-quiz" },
		/* Les DEUX sorties et rien d'autre. Le principal est bundlé par esbuild
		   (`chokidar` compris — raison 2 de l'en-tête de `construire.mjs`), le
		   rendu par Vite (`lucide` compris) : rien dans le paquet n'appelle
		   `require` vers `node_modules`. Sans l'exclusion, electron-builder y
		   copiait 3 659 fichiers de dépendances de production, et les
		   sourcemaps du principal avec. Si cette affirmation devenait fausse,
		   l'application ne démarrerait pas : l'épreuve « premier lancement sur
		   machine propre » l'attraperait. */
		files: ["dist/**/*", "dist-electron/**/*", "!dist-electron/**/*.map", "!dist/**/*.map", "package.json", "!node_modules/**"],
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
}
