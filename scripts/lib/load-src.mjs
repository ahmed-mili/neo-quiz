/**
 * Charge un module `src/**.ts` dans Node, hors d'Obsidian.
 *
 * Les scripts de vérification doivent éprouver le CODE RÉEL : une réplique
 * finirait par diverger de l'originale et validerait le vide. esbuild bundle
 * le module demandé ; `obsidian`, qui n'existe qu'à l'intérieur de
 * l'application, est remplacé par un module bouchon.
 *
 * DEUX RÉGIMES DANS CE BOUCHON, et il faut savoir lequel on touche :
 * — la plupart des symboles JETTENT (`nope`). Ils ne sont appelés par aucune
 *   des fonctions vérifiées, et si l'un l'était un jour, l'échec serait
 *   bruyant plutôt que silencieux ;
 * — `Modal` et `getIconIds` sont des DOUBLES DE COMPORTEMENT, parce que
 *   `HostModals` et `HostUi.iconNames` (apps/obsidian/host.ts) passent par
 *   eux pour de bon. Ils rendent donc une valeur au lieu de jeter, et un cas
 *   qui les traverse ne prouve QUE ce que le double reproduit fidèlement.
 *   Écrire un cas neuf sur ces deux-là, c'est d'abord lire le double
 *   ci-dessous et vérifier qu'il dit encore la vérité sur Obsidian — un
 *   double approximatif rend vert sans rien garder.
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
	/* `Modal` n'est plus une coquille vide : `HostModals` (apps/obsidian/host.ts)
	   passe par lui, et l'ORDRE de ses deux moments — attacher PUIS `onOpen`,
	   détacher PUIS `onClose` — est exactement ce que le contrat promet et ce
	   dont l'écriture différée de `module-edit.ts` dépend. Le double reproduit
	   donc le comportement RÉEL d'Obsidian, comme la fausse `App` de
	   check-obsidian-host.mjs reproduit celui de l'adaptateur ; sans ça, le cas
	   « onClose après le détachement » resterait vert quoi qu'on casse.
	   `document` n'est touché qu'à la CONSTRUCTION : un script qui ne construit
	   aucune modale n'a rien à installer. */
	"export const Modal = class {",
	"	constructor(app) {",
	"		this.app = app;",
	"		this.containerEl = document.createElement('div');",
	"		this.containerEl.className = 'modal-container';",
	"		this.modalEl = this.containerEl.appendChild(document.createElement('div'));",
	"		this.modalEl.className = 'modal';",
	"		this.titleEl = this.modalEl.appendChild(document.createElement('div'));",
	"		this.titleEl.className = 'modal-title';",
	"		this.contentEl = this.modalEl.appendChild(document.createElement('div'));",
	"		this.contentEl.className = 'modal-content';",
	"	}",
	"	open() { document.body.appendChild(this.containerEl); this.onOpen(); }",
	"	close() { this.containerEl.remove(); this.onClose(); }",
	"	onOpen() {}",
	"	onClose() {}",
	"};",
	"export const FuzzySuggestModal = class {};",
	"export const setIcon = () => nope('setIcon');",
	/* Rend une LISTE au lieu de jeter, depuis que `HostUi.iconNames()` la
	   consomme pour de bon. Les identifiants portent le préfixe « lucide- »,
	   comme ceux d'Obsidian : c'est ce préfixe que l'hôte doit retirer, et une
	   liste déjà nue rendrait le cas qui le vérifie vert par construction. */
	"export const getIconIds = () => ['lucide-chevron-down', 'lucide-search', 'lucide-x'];",
	"export const Platform = {};",
	"export const requestUrl = () => nope('requestUrl');",
	"export const MarkdownRenderer = {};",
	"export const loadPdfJs = () => nope('loadPdfJs');",
	"export const loadMathJax = () => nope('loadMathJax');",
	"export const renderMath = () => nope('renderMath');",
	"export const finishRenderMath = () => nope('finishRenderMath');",
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
		const stubPlugin = {
			name: "obsidian-stub",
			setup(b) {
				b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
				b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: OBSIDIAN_STUB, loader: "js" }));
			},
		};
		let sorties;
		if (entries.length > 1) {
			/* UN SEUL build, avec `splitting` : un module importé par plusieurs
			   entrées (ex. `src/host/current.ts`, dont l'état d'hôte installé est
			   un singleton) devient un chunk PARTAGÉ, chargé une seule fois — donc
			   une seule instance de son état module-scope. Un build par entrée (la
			   forme utilisée quand une seule est demandée) donnerait à chaque
			   entrée sa propre copie, et un hôte installé depuis l'une resterait
			   invisible de l'autre. */
			const outdir = join(dir, "out");
			await build({
				entryPoints: entries,
				bundle: true,
				splitting: true,
				format: "esm",
				platform: "node",
				outdir,
				// `outbase` fixé à "src" : sans lui, esbuild le déduit du plus
				// petit ancêtre commun des entrées demandées (parfois
				// "src/editor/" au lieu de "src/"), et le chemin de sortie
				// recalculé ci-dessous ne correspondrait plus au fichier réel.
				outbase: "src",
				logLevel: "warning",
				plugins: [stubPlugin],
			});
			// `outbase: "src"` fixe la racine : "src/host/current.ts" devient
			// toujours "<outdir>/host/current.js", quelles que soient les entrées.
			sorties = entries.map((e) => join(outdir, e.replace(/^src\//, "").replace(/\.tsx?$/, ".js")));
		} else {
			// Une seule entrée : `outdir` déduirait le nom du chemin source, ce
			// qui suffit ici (pas de risque de collision à une seule sortie).
			const outfile = join(dir, "module0.mjs");
			await build({
				entryPoints: [entries[0]],
				bundle: true,
				format: "esm",
				platform: "node",
				outfile,
				logLevel: "warning",
				plugins: [stubPlugin],
			});
			sorties = [outfile];
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
