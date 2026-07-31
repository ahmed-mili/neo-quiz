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
		return {
			set innerHTML(v) { html = String(v); },
			get textContent() { return html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""); },
			querySelectorAll() { return []; },
		};
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

await withSrcModule("src/editor/convert.ts", async (convert) => {
	await withSrcModule("src/editor/export.ts", (exp) => {
		let quiz = 0, questions = 0, casses = 0, divergents = 0;

		for (const f of fichiers) {
			const contenu = readFileSync(f, "utf8");
			const m = contenu.match(/```quiz-blocks\r?\n([\s\S]*?)\r?\n```/);
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
		process.exit(casses || divergents ? 1 : 0);
	});
});
