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

/* Le point d'entrée `main-ui.ts` enveloppe le principal historique sans le
   recopier : on conserve ainsi la logique d'installation existante tout en
   ajoutant les commandes propres à la fenêtre de référence. */
await build({
	entryPoints: {
		main: join(ici, "main-ui.ts"),
		preload: join(ici, "preload.ts"),
	},
	outdir: sortie,
	outExtension: { ".js": ".cjs" },
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node22",
	external: ["electron"],
	logLevel: "info",
});

/* Le rendu de référence reste un paquet navigateur distinct : aucun builtin
   Node ne doit pouvoir être résolu ici, et l'ancien rendu reste disponible
   dans le dépôt pour faciliter une comparaison visuelle pendant la revue. */
await build({
	entryPoints: [join(ici, "renderer-reference.ts")],
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
	copyFile(join(ici, "style-details.css"), join(sortie, "style-details.css")),
	copyFile(join(windows, "icons", "icon.png"), join(sortie, "icon.png")),
]);
