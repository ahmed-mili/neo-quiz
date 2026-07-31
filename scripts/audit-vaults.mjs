/**
 * Aller-retour LECTURE → ÉCRITURE sur tous les quiz de vrais vaults.
 *
 * À lancer AVANT une release, ou après toute retouche de la chaîne
 * `convertParsedToInternal` / `exportAll` :
 *
 *     node scripts/audit-vaults.mjs "C:/obsidian-vaults/Personal" "C:/obsidian-vaults/Efrei"
 *
 * Chaque bloc quiz-blocks est converti comme la page le fait, réexporté, puis
 * relu. Un bloc qui ne se relit pas est une sauvegarde qui ÉCHOUERA EN SILENCE
 * chez l'utilisateur : la page refuse d'écrire un JSON5 invalide (garde de
 * detail-io.ts), et le travail reste en mémoire jusqu'à la fermeture
 * d'Obsidian. C'est précisément ce qu'aucun test unitaire ne voit venir — il
 * faut de VRAIS quiz, avec leurs champs personnalisés et leurs bizarreries.
 *
 * Aucun fichier n'est modifié : tout se passe en mémoire.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import JSON5 from "json5";
import { withSrcModule } from "./lib/load-src.mjs";

const racines = process.argv.slice(2);
if (racines.length === 0) {
	console.error("Usage : node scripts/audit-vaults.mjs <chemin-de-vault> [autre-vault…]");
	process.exit(2);
}

/* `_htmlToText` (editor/modals.ts) passe par le DOM. Hors navigateur, un
   bouchon suffit : cet audit vérifie la VALIDITÉ du bloc réécrit, pas la
   finesse de la conversion HTML → texte. */
globalThis.document = {
	createElement() {
		let html = "";
		const noeud = {
			set innerHTML(v) { html = String(v); },
			get textContent() { return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""); },
			querySelectorAll() { return []; },
		};
		/* `<template>` : le code réel lit `tpl.content` (document propriétaire
		   INERTE — c'est ce qui empêche un `<img onerror>` de s'exécuter). Le
		   bouchon n'a pas de vrai DOM ; se renvoyer lui-même suffit pour ce que
		   cet audit vérifie, à savoir la VALIDITÉ du bloc réécrit. */
		Object.defineProperty(noeud, "content", { get() { return noeud; } });
		return noeud;
	},
};

function walk(dir, out) {
	let entries;
	try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
	for (const e of entries) {
		if (e.name.startsWith(".")) continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (e.name.endsWith(".md")) out.push(p);
	}
	return out;
}

const fichiers = racines.flatMap(r => walk(r, []));
console.log(fichiers.length + " notes examinées dans " + racines.length + " vault(s)");

/* `QUIZ_BLOCK_RE` du plugin, jamais une copie : une regex recopiée ici était
   PLUS STRICTE que l'originale (fence sans attribut, fermante non indentée) et
   sautait en silence des blocs que le plugin, lui, charge — un audit vert ne
   disait alors rien de ces quiz-là (revue codex 2026-07-31). */
await withSrcModule(["src/editor/convert.ts", "src/editor/export.ts", "src/quiz-utils.ts"],
	(convert, exp, { QUIZ_BLOCK_RE, findQuizModeConfigIndex }) => {
		let quiz = 0, questions = 0, casses = 0, divergents = 0, perdus = 0;

		/* Champs que l'aller-retour REMPLACE légitimement par un équivalent :
		   `prompt` devient `promptHtml` dès qu'il contient du markdown, et
		   réciproquement pour l'explication, la leçon, le support et les
		   options. Tout le reste doit survivre à l'identique — un champ qui
		   disparaît est du travail perdu chez l'utilisateur, en silence, et
		   c'est la seule chose que ni le typage ni la relecture n'attrapent. */
		const EQUIVALENTS = {
			prompt: ["prompt", "promptHtml"], promptHtml: ["prompt", "promptHtml"],
			explain: ["explain", "explainHtml"], explainHtml: ["explain", "explainHtml"],
			learn: ["learn", "learnHtml"], learnHtml: ["learn", "learnHtml"],
			passage: ["passage", "passageHtml"], passageHtml: ["passage", "passageHtml"],
			options: ["options", "optionHtml"], optionHtml: ["options", "optionHtml"],
			terminalVariant: ["terminalVariant", "textVariant"],
			textVariant: ["terminalVariant", "textVariant"],
		};
		/* Les quatre formes de réponse libre que le moteur agrège
		   (engine/terminal.ts getTextAcceptedAnswers) : l'export les fond dans
		   `acceptedAnswers`. Ce n'est une perte que si la VALEUR n'y est plus —
		   d'où la comparaison sur le contenu et non sur le nom du champ. */
		const FONDUS = ["answer", "correctText", "acceptableAnswers", "correctAnswers"];
		/** Une valeur vide n'a rien à perdre : `placeholder: ''`, `caseSensitive:
		    false`, `options: []` disparaissent sans que personne n'y perde. */
		const vide = (v) => v === "" || v === false || v === null || v === undefined
			|| (Array.isArray(v) && v.every(x => x === "" || x === null || x === undefined));

		const survit = (cle, avant, apres) => {
			if (vide(avant[cle])) return true;
			/* Un index de bonne réponse SANS options n'en désigne aucune : c'est
			   un vestige d'un squelette de QCM que la génération IA laisse sur
			   une question devenue texte à trous. Le perdre ne perd rien. */
			if ((cle === "correctIndex" || cle === "correctIndices")
				&& !apres.options && !apres.optionHtml) return true;
			if (FONDUS.includes(cle)) {
				const attendus = [].concat(avant[cle]).map(String);
				const obtenus = (apres.acceptedAnswers || []).map(String);
				return attendus.every(a => obtenus.includes(a));
			}
			return (EQUIVALENTS[cle] || [cle]).some(k => apres[k] !== undefined);
		};

		for (const f of fichiers) {
			const contenu = readFileSync(f, "utf8");
			const m = contenu.match(QUIZ_BLOCK_RE);
			if (!m) continue;
			let parsed;
			try { parsed = JSON5.parse(m[1]); } catch { continue; }   // bloc déjà cassé : pas notre affaire
			if (!Array.isArray(parsed)) continue;
			quiz++;

			const qs = [];
			let examOptions = null;
			// Par son INDEX : le critère dépend de la POSITION dans le bloc
			// (quiz-utils.ts), un test élément par élément ne peut pas le savoir.
			const configIdx = findQuizModeConfigIndex(parsed);
			parsed.forEach((item, i) => {
				if (i === configIdx) { examOptions = convert.readModeConfig(item); return; }
				qs.push(convert.convertParsedToInternal(item));
			});
			questions += qs.length;

			const source = exp.exportAll(qs, examOptions);
			let relu;
			try {
				relu = JSON5.parse(source);
			} catch (e) {
				casses++;
				console.error("ILLISIBLE  " + f + "\n           " + e.message);
				continue;
			}
			// Le mode réémet un objet de configuration ; le compte doit suivre.
			const attendu = qs.length
				+ (examOptions && (examOptions.mode === "learn" || examOptions.enabled) ? 1 : 0);
			if (relu.length !== attendu) {
				divergents++;
				console.error("COMPTE     " + f + "\n           " + relu.length + " éléments au lieu de " + attendu);
				continue;
			}

			/* CHAMP PAR CHAMP : un bloc qui se relit peut quand même avoir perdu
			   une explication ou un indice en route — et c'est la perte la plus
			   silencieuse qui soit, puisque rien n'échoue. On compare les
			   questions dans l'ordre, l'objet de mode retiré des deux côtés. */
			const entree = parsed.filter((_, i) => i !== configIdx);
			const sortie = relu.filter((_, i) => i !== findQuizModeConfigIndex(relu));
			entree.forEach((avant, i) => {
				const apres = sortie[i];
				if (!avant || typeof avant !== "object" || Array.isArray(avant) || !apres) return;
				for (const cle of Object.keys(avant)) {
					if (survit(cle, avant, apres)) continue;
					perdus++;
					console.error("PERDU      " + f + "\n           question " + (i + 1)
						+ " : le champ `" + cle + "` a disparu");
				}
			});
		}

		console.log("\nquiz : " + quiz + " | questions : " + questions
			+ " | blocs illisibles : " + casses + " | comptes divergents : " + divergents
			+ " | champs perdus : " + perdus);
		// `exitCode` et non `exit()` : la pile doit se dérouler pour que
		// `withSrcModule` retire son dossier temporaire.
		if (casses || divergents || perdus) process.exitCode = 1;
	});
