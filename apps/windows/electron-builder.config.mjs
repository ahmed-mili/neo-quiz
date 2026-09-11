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
		appId: "com.ahmed.neoquiz",
		productName: "Neo Quiz",
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
		files: ["dist/**/*", "dist-electron/**/*", "package.json"],
		win: {
			target: "nsis",
			icon: "icons/icon.ico",
		},
		linux: {
			target: "AppImage",
			icon: "icons/icon.png",
			category: "Education",
		},
		nsis: {
			oneClick: false,
			allowToChangeInstallationDirectory: true,
		},
	};
}
