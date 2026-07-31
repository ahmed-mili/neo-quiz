/**
 * Charge un module `src/**.ts` dans Node, hors d'Obsidian.
 *
 * Les scripts de vérification doivent éprouver le CODE RÉEL : une réplique
 * finirait par diverger de l'originale et validerait le vide. esbuild bundle
 * le module demandé ; `obsidian`, qui n'existe qu'à l'intérieur de
 * l'application, est remplacé par un module bouchon — aucun des symboles
 * remplacés n'est appelé par les fonctions pures qu'on vérifie, et si l'un
 * l'était un jour, l'échec serait bruyant plutôt que silencieux.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OBSIDIAN_STUB = [
	"const nope = (nom) => { throw new Error('obsidian.' + nom + \" n'existe pas hors d'Obsidian\"); };",
	"export const TFile = class {};",
	"export const Notice = class { constructor() { nope('Notice'); } };",
	"export const Modal = class {};",
	"export const FuzzySuggestModal = class {};",
	"export const setIcon = () => nope('setIcon');",
	"export const Platform = {};",
	"export const MarkdownRenderer = {};",
	"export const loadPdfJs = () => nope('loadPdfJs');",
].join("\n");

/**
 * @param {string} entry chemin du module source (ex. "src/editor/export.ts")
 * @param {(mod: Record<string, unknown>) => Promise<void> | void} run
 */
export async function withSrcModule(entry, run) {
	const dir = mkdtempSync(join(tmpdir(), "quiz-check-"));
	try {
		const outfile = join(dir, "module.mjs");
		await build({
			entryPoints: [entry],
			bundle: true,
			format: "esm",
			platform: "node",
			outfile,
			logLevel: "warning",
			plugins: [{
				name: "obsidian-stub",
				setup(b) {
					b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
					b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: OBSIDIAN_STUB, loader: "js" }));
				},
			}],
		});
		await run(await import(pathToFileURL(outfile).href));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Petit rapporteur commun : `attendu`/`obtenu` comparés en JSON. */
export function makeReporter(titre) {
	let echecs = 0;
	let total = 0;
	return {
		check(nom, obtenu, attendu) {
			total++;
			if (JSON.stringify(obtenu) === JSON.stringify(attendu)) return;
			echecs++;
			console.error("ÉCHEC  " + nom);
			console.error("       attendu : " + JSON.stringify(attendu));
			console.error("       obtenu  : " + JSON.stringify(obtenu));
		},
		done() {
			if (echecs) {
				console.error("\n" + titre + " : " + echecs + "/" + total + " cas en échec");
				process.exit(1);
			}
			console.log(titre + " : " + total + "/" + total + " cas passent");
		},
	};
}
