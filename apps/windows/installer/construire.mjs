/*
 * LE BOOTSTRAPPER A SA PROPRE SORTIE.
 *
 * Il ne peut pas partager `dist/` (rendu de l'application) ni
 * `dist-electron/` (principal de l'application) : electron-builder doit
 * pouvoir empaqueter l'un sans ramasser l'autre. On garde toutefois le MÊME
 * Electron et le MÊME esbuild déjà verrouillés par `apps/windows/package.json`,
 * donc aucune seconde chaîne d'outils n'est introduite.
 */
import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ici = fileURLToPath(new URL(".", import.meta.url));
const windows = fileURLToPath(new URL("../", import.meta.url));
const sortie = join(windows, "dist-bootstrapper");

await rm(sortie, { recursive: true, force: true });
await mkdir(sortie, { recursive: true });

/* Principal + préchargement restent CommonJS pour la même raison que
   `electron/construire.mjs` : un préchargement sandboxé ne charge pas un
   module ES, alors que le package Windows est `type: module`. */
await build({
	entryPoints: [join(ici, "main.ts"), join(ici, "preload.ts")],
	outdir: sortie,
	outExtension: { ".js": ".cjs" },
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node22",
	external: ["electron"],
	logLevel: "info",
});

/* Le rendu est un paquet navigateur distinct : aucun builtin Node ne doit
   pouvoir être résolu ici. Cette séparation rend une importation accidentelle
   de `node:fs` bruyante au build au lieu de l'externaliser silencieusement. */
await build({
	entryPoints: [join(ici, "renderer.ts")],
	outfile: join(sortie, "renderer.js"),
	bundle: true,
	platform: "browser",
	format: "esm",
	target: "chrome130",
	logLevel: "info",
});

await Promise.all([
	copyFile(join(ici, "index.html"), join(sortie, "index.html")),
	copyFile(join(ici, "style.css"), join(sortie, "style.css")),
	copyFile(join(windows, "icons", "icon.png"), join(sortie, "icon.png")),
]);
