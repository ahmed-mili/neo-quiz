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
	"export const requestUrl = () => nope('requestUrl');",
	"export const MarkdownRenderer = {};",
	"export const loadPdfJs = () => nope('loadPdfJs');",
].join("\n");

/**
 * @param {string | string[]} entry un module source ("src/editor/export.ts"),
 *   ou plusieurs — le rappel reçoit alors un module par entrée, dans l'ordre.
 * @param {(...mods: Record<string, unknown>[]) => Promise<void> | void} run
 */
export async function withSrcModule(entry, run) {
	const entries = Array.isArray(entry) ? entry : [entry];
	const dir = mkdtempSync(join(tmpdir(), "quiz-check-"));
	try {
		const sorties = entries.map((_, i) => join(dir, "module" + i + ".mjs"));
		// Un build par entrée : `outdir` déduirait les noms des chemins source,
		// et deux modules homonymes se marcheraient dessus.
		for (let i = 0; i < entries.length; i++) {
			await build({
				entryPoints: [entries[i]],
				bundle: true,
				format: "esm",
				platform: "node",
				outfile: sorties[i],
				logLevel: "warning",
				plugins: [{
					name: "obsidian-stub",
					setup(b) {
						b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
						b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: OBSIDIAN_STUB, loader: "js" }));
					},
				}],
			});
		}
		const mods = [];
		for (const s of sorties) mods.push(await import(pathToFileURL(s).href));
		await run(...mods);
	} finally {
		/* Ce `finally` ne s'exécute QUE si le rappel laisse la pile se dérouler.
		   Un `process.exit()` dedans le saute, et chaque exécution laissait un
		   dossier `quiz-check-*` dans le répertoire temporaire (revue codex
		   2026-07-31, treize retrouvés). D'où `process.exitCode` — jamais
		   `process.exit` — dans les scripts qui appellent cette fonction. */
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
				// `exitCode` et non `exit()` : la pile doit se dérouler pour que le
				// dossier temporaire soit nettoyé. Les jeux de cas suivants
				// s'exécutent quand même — voir TOUS les échecs vaut mieux que
				// s'arrêter au premier.
				process.exitCode = 1;
				return;
			}
			console.log(titre + " : " + total + "/" + total + " cas passent");
		},
	};
}
