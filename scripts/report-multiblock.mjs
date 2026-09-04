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
 *      contient pas. Le planificateur itère sur le CATALOGUE et jamais sur
 *      les événements, donc cette clé ne fabrique aucune échéance — mais
 *      elle n'est PAS sans effet : `spentToday` (plan.ts) compte TOUS les
 *      événements du jour, au catalogue ou non. Répondre aux questions
 *      invisibles consomme donc des places du budget quotidien et fait
 *      rétrécir « À réviser ». C'est défendable (du temps passé reste du
 *      temps passé, spec §7.1), mais ce n'est pas neutre.
 *
 * Et une COLLISION est possible, pas seulement une disparition : la clé n'a
 * pas de discriminant de bloc, et les identifiants se répètent d'un bloc à
 * l'autre (`q1..qn` est ce que l'éditeur écrit faute de titre exploitable).
 * Aucune collision aujourd'hui — ce script la mesure — mais rien ne
 * l'empêche demain, et un historique fusionné ne se démêlerait pas après
 * coup. Le discriminant de bloc a donc une date de péremption liée à
 * l'usage, pas à l'envie.
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
	const collisions = [];
	const refs = [];

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
			for (const b of blocs) {
				if (/source\s*:/.test(b[1]) && /mode\s*:\s*['"]quiz['"]/.test(b[1])) {
					refs.push(relative(racine, p));
					break;
				}
			}
			if (blocs.length <= 1) continue;
			multi++;
			blocsCaches += blocs.length - 1;
			/* Compter les questions sans parser le JSON5 : une entrée d'objet
			   au premier niveau commence par `{`. Approximation assumée — le
			   chiffre sert d'ordre de grandeur, pas de contrat. */
			let q = 0;
			for (const b of blocs.slice(1)) q += (b[1].match(/^\s*\{/gm) || []).length;
			questionsCachees += q;
			/* Collision d'identifiants entre le bloc INDEXÉ (le premier) et les
			   suivants : c'est le seul cas où deux questions distinctes
			   partagent une clé et fusionnent leur historique. Lecture par
			   regex plutôt que par JSON5 — on ne cherche qu'un ordre de
			   grandeur, et un bloc invalide ne doit pas faire tomber le rapport. */
			const ids = (b) => new Set([...b.matchAll(/^\s*id:\s*['"]([^'"]+)['"]/gm)].map(m => m[1]));
			const premiers = ids(blocs[0][1]);
			const suivants = new Set();
			for (const b of blocs.slice(1)) for (const id of ids(b[1])) suivants.add(id);
			const communs = [...suivants].filter(id => premiers.has(id));
			if (communs.length) collisions.push(`${relative(racine, p)} — ids partagés : ${communs.join(", ")}`);
			details.push(`  ${relative(racine, p)} — ${blocs.length} blocs, ~${q} questions hors catalogue`);
		}
	};

	for (const v of vaults) {
		try { statSync(v); } catch { console.error(`vault introuvable : ${v}`); continue; }
		parcourir(v, v);
	}

	/* ── Notes quiz `source:` ──
	   Une note dont le bloc se réduit à `[{ mode:"quiz", source:"[[…]]" }]`
	   emprunte ses questions à une AUTRE note (la leçon). Le moteur y écrit
	   sous le chemin de l'HÔTE (`plugin.ts`, `mdCtx.sourcePath`), alors que
	   l'hôte sort du scan avec zéro question et n'entre donc dans aucun
	   catalogue. Toutes les réponses données là sont orphelines — et les
	   questions de la leçon, elles bien au catalogue, restent « neuves » à
	   vie. Même famille que la limite ci-dessus, autre cause. */
	console.log(`Notes à blocs multiples — ${notes} note(s) avec quiz examinée(s)`);
	if (multi === 0) {
		console.log("  aucune note à plusieurs blocs : la limite ne mord nulle part aujourd'hui");
	} else {
		for (const d of details) console.log(d);
		console.log(`\n  ${multi} note(s) concernée(s) | ${blocsCaches} bloc(s) invisibles au scanner | ~${questionsCachees} question(s) non planifiables`);
		console.log("  Ces questions ne remontent jamais dans « À réviser ». Y répondre écrit");
		console.log("  une clé absente du catalogue : aucune échéance fabriquée, mais le budget");
		console.log("  du jour est consommé quand même (`spentToday` compte tous les événements).");
		if (collisions.length === 0) {
			console.log("  Aucune collision d'identifiant entre le bloc 1 et les suivants : mesuré.");
		} else {
			console.log(`
  /!\ ${collisions.length} note(s) ou un bloc 2+ REUTILISE un id du bloc 1 :`);
			for (const c of collisions) console.log(`    ${c}`);
			console.log("  Les reponses des blocs suivants s'imputent alors a une question du");
			console.log("  premier, et cet historique-la ne se demelera pas apres coup.");
		}
	}

	console.log("");
	console.log(`Notes quiz « source: » — ${refs.length} note(s)`);
	if (refs.length === 0) {
		console.log("  aucune : la limite ne mord nulle part aujourd'hui");
	} else {
		for (const r of refs) console.log(`  ${r}`);
		console.log("  Ces notes journalisent sous LEUR chemin, absent du catalogue :");
		console.log("  réponses orphelines, budget du jour consommé, et les questions de la");
		console.log("  leçon d'origine restent « neuves » quoi qu'on fasse.");
	}
}
