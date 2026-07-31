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
	(convert, exp, { QUIZ_BLOCK_RE }) => {
		let quiz = 0, questions = 0, casses = 0, divergents = 0;

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
			for (const item of parsed) {
				if (convert.isModeConfig(item)) { examOptions = convert.readModeConfig(item); continue; }
				qs.push(convert.convertParsedToInternal(item));
			}
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
			}
		}

		console.log("\nquiz : " + quiz + " | questions : " + questions
			+ " | blocs illisibles : " + casses + " | comptes divergents : " + divergents);
		// `exitCode` et non `exit()` : la pile doit se dérouler pour que
		// `withSrcModule` retire son dossier temporaire.
		if (casses || divergents) process.exitCode = 1;
	});
