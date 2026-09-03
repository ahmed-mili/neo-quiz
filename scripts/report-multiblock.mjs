/**
 * RAPPORT — notes à PLUSIEURS blocs ```quiz-blocks.
 *
 * Ce script ne vérifie rien : il MESURE une limite connue et assumée de
 * l'ordonnanceur, pour qu'elle reste visible au lieu de se redécouvrir.
 * Il sort donc toujours en 0.
 *
 * La limite : le scanner n'indexe que le PREMIER bloc d'une note
 * (`extractQuizSource`, via QUIZ_BLOCK_RE sans le drapeau `g`), alors que
 * le moteur rend CHAQUE bloc, et que la clé du journal est `chemin::id`
 * sans discriminant de bloc. Deux conséquences, mesurées ici :
 *
 *   1. les questions des blocs 2+ ne sont JAMAIS planifiables — elles
 *      n'entrent pas au catalogue, donc `deriveStates` ne les voit pas ;
 *   2. y répondre écrit dans le journal une clé que le catalogue ne
 *      contient pas : une ligne morte, qui s'accumule sans jamais être
 *      relue (le planificateur itère sur le CATALOGUE, pas sur les
 *      événements — c'est ce qui empêche toute corruption du planning).
 *
 * Corriger demanderait de décider comment identifier un bloc DANS une
 * note, ce qui change le format de clé et donc l'historique déjà écrit.
 * Décision de conception, hors du chantier 1.
 *
 *     node scripts/report-multiblock.mjs "C:/obsidian-vaults/Personal" […]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/* Le même motif que src/quiz-utils.ts, mais AVEC le drapeau `g` : ici on
   veut justement compter les blocs que le scanner ne voit pas. */
const BLOC = /```quiz-blocks[^\n]*\n([\s\S]*?)\r?\n[ \t]*```/g;

const vaults = process.argv.slice(2);
if (vaults.length === 0) {
	console.error("usage: node scripts/report-multiblock.mjs <vault> [vault…]");
	process.exitCode = 1;
} else {
	let notes = 0, multi = 0, blocsCaches = 0, questionsCachees = 0;
	const details = [];

	const parcourir = (dir, racine) => {
		let entrees;
		try { entrees = readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const e of entrees) {
			if (e.name.startsWith(".")) continue;
			const p = join(dir, e.name);
			if (e.isDirectory()) { parcourir(p, racine); continue; }
			if (!e.name.endsWith(".md")) continue;
			let texte;
			try { texte = readFileSync(p, "utf8"); } catch { continue; }
			if (!texte.includes("```quiz-blocks")) continue;
			notes++;
			BLOC.lastIndex = 0;
			const blocs = [...texte.matchAll(BLOC)];
			if (blocs.length <= 1) continue;
			multi++;
			blocsCaches += blocs.length - 1;
			/* Compter les questions sans parser le JSON5 : une entrée d'objet
			   au premier niveau commence par `{`. Approximation assumée — le
			   chiffre sert d'ordre de grandeur, pas de contrat. */
			let q = 0;
			for (const b of blocs.slice(1)) q += (b[1].match(/^\s*\{/gm) || []).length;
			questionsCachees += q;
			details.push(`  ${relative(racine, p)} — ${blocs.length} blocs, ~${q} questions hors catalogue`);
		}
	};

	for (const v of vaults) {
		try { statSync(v); } catch { console.error(`vault introuvable : ${v}`); continue; }
		parcourir(v, v);
	}

	console.log(`Notes à blocs multiples — ${notes} note(s) avec quiz examinée(s)`);
	if (multi === 0) {
		console.log("  aucune note à plusieurs blocs : la limite ne mord nulle part aujourd'hui");
	} else {
		for (const d of details) console.log(d);
		console.log(`\n  ${multi} note(s) concernée(s) | ${blocsCaches} bloc(s) invisibles au scanner | ~${questionsCachees} question(s) non planifiables`);
		console.log("  Ces questions ne remontent jamais dans « À réviser », et y répondre");
		console.log("  écrit une clé absente du catalogue (ligne morte, sans effet sur le plan).");
	}
}
