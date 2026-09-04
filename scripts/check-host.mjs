/**
 * FRONTIÈRE D'HÔTE — aucun fichier de `src/` n'importe Obsidian.
 *
 * Même rôle que la section pureté de check-scheduler.mjs, avec une propriété
 * de plus : le noyau de l'ordonnanceur est DÉJÀ pur, alors que `src/` ne le
 * sera qu'à la fin du chantier. La liste RESTANTS nomme ce qui n'est pas
 * encore migré — et l'assertion 2 ci-dessous interdit qu'elle moisisse.
 *
 *     npm run check:host
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, posix, sep } from "node:path";

const IMPORTE_OBSIDIAN = /(?:from\s*|require\s*\(\s*)["']obsidian["']/;

/**
 * Fichiers de `src/` qui importent ENCORE Obsidian, avec la tranche qui les
 * libère. Cette liste ne peut que RÉTRÉCIR : un fichier qui y figure sans
 * importer Obsidian fait échouer le contrôle (assertion 2), ce qui force à
 * l'en retirer au lieu de le laisser couvrir une régression future.
 */
const RESTANTS = [
	// Tableau de bord — tranches 2 et 3.
	"src/dashboard.ts",
	"src/dashboard/ai-client.ts",
	"src/dashboard/ai-providers.ts",
	"src/dashboard/ai-usage.ts",
	"src/dashboard/ai.ts",
	"src/dashboard/collapsible.ts",
	"src/dashboard/detail-exam.ts",
	"src/dashboard/detail-form-bridge.ts",
	"src/dashboard/detail-io.ts",
	"src/dashboard/detail-question.ts",
	"src/dashboard/detail.ts",
	"src/dashboard/file-sources.ts",
	"src/dashboard/folder-create.ts",
	"src/dashboard/home.ts",
	"src/dashboard/icon-picker.ts",
	"src/dashboard/mention-picker.ts",
	"src/dashboard/module-card.ts",
	"src/dashboard/module-edit.ts",
	"src/dashboard/nav.ts",
	"src/dashboard/prompt-paths.ts",
	"src/dashboard/quiz-card.ts",
	"src/dashboard/quiz-menu.ts",
	"src/dashboard/quiz-open.ts",
	"src/dashboard/quizzes-render.ts",
	"src/dashboard/quizzes.ts",
	"src/dashboard/review-store.ts",
	"src/dashboard/scanner.ts",
	"src/dashboard/share.ts",
	"src/dashboard/stats-store.ts",
	"src/dashboard/ui-select.ts",
	"src/dashboard/usage-modal.ts",
	"src/dashboard/voice-input.ts",
	"src/dashboard/voice-install.ts",
	"src/types/dashboard-ctx.ts",
	// Éditeur — tranche 3.
	"src/editor.ts",
	"src/editor/editor-form.ts",
	"src/editor/modals.ts",
	"src/editor/question-preview.ts",
	"src/editor/utils.ts",
	"src/types/editor-ctx.ts",
	// Moteur — tranche 1, tâche 6.
	"src/engine/mathjax.ts",
	// Divers du greffon — tranche 4.
	"src/hotkey-format.ts",
	"src/modal-base.ts",
	"src/quiz-source-ref.ts",
];

function fichiersTs(racine) {
	const trouves = [];
	if (!existsSync(racine)) return trouves;
	for (const nom of readdirSync(racine)) {
		const chemin = join(racine, nom);
		if (statSync(chemin).isDirectory()) trouves.push(...fichiersTs(chemin));
		else if (nom.endsWith(".ts") || nom.endsWith(".tsx")) trouves.push(chemin.split(sep).join(posix.sep));
	}
	return trouves;
}

const attendus = new Set(RESTANTS);
let echecs = 0;
const rate = (msg) => { console.error("ÉCHEC  " + msg); echecs++; };

// 1. Aucune NOUVELLE dépendance dans la zone partagée.
const importeurs = new Set();
for (const f of fichiersTs("src")) {
	if (IMPORTE_OBSIDIAN.test(readFileSync(f, "utf8"))) importeurs.add(f);
}
for (const f of importeurs) {
	if (!attendus.has(f)) rate(`${f} importe « obsidian » : le code partagé passe par src/host/.`);
}

// 2. LE CLIQUET : une entrée qui n'importe plus rien doit être retirée, sinon
//    la liste devient un tapis sous lequel on balaie.
for (const f of attendus) {
	if (!existsSync(f)) rate(`RESTANTS contient ${f}, qui n'existe pas : retirez l'entrée.`);
	else if (!importeurs.has(f)) rate(`${f} n'importe plus « obsidian » : retirez-le de RESTANTS.`);
}

// 3. L'app Windows n'a jamais rien à faire d'Obsidian.
for (const f of fichiersTs("apps/windows/src")) {
	if (IMPORTE_OBSIDIAN.test(readFileSync(f, "utf8"))) rate(`${f} importe « obsidian » : ce n'est pas son hôte.`);
}

if (echecs) {
	console.error(`\nFrontière d'hôte : ${echecs} problème(s)`);
	// exitCode, jamais exit() — cohérent avec les autres scripts du dépôt.
	process.exitCode = 1;
} else {
	console.log(`Frontière d'hôte : ${importeurs.size} fichier(s) encore lié(s) à Obsidian, tous déclarés.`);
}
