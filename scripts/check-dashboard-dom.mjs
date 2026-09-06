/**
 * LES PAGES DU TABLEAU DE BORD NE REVIENNENT PAS EN ARRIÈRE.
 *
 * `check:host` attrape déjà les extensions DOM d'Obsidian (assertion 4) —
 * mais SEULEMENT dans les fichiers qui n'importent plus Obsidian. Un
 * `import { setIcon } from "obsidian"` remis « pour aller vite » en tranche 3
 * ferait rentrer un de ces fichiers dans `RESTANTS`, et ses extensions DOM
 * redeviendraient invisibles au contrôle — pas rejetées, simplement plus
 * regardées.
 *
 * `LIBERES` nomme ce qui est libéré POUR DE BON : les huit modules d'interface
 * portés en tranche 2.5 (rail, accueil, page « Mes quiz », cartes, sections
 * repliables, magasin de stats) et les trois modules purs qu'ils ont fait
 * naître en cours de route (`module-map-note.ts`, tâche 2 ; `folder-archive.ts`
 * et `module-icons.ts`, tâche 6, extraits pour que l'app puisse importer ces
 * pages sans tirer `ui-select.ts`/`icon-picker.ts`). Contrairement à
 * `RESTANTS`, cette liste ne peut que GRANDIR : un fichier qui y figure sans
 * plus être libre (import d'Obsidian retrouvé, extension DOM réintroduite)
 * fait échouer le contrôle au lieu d'en sortir en silence.
 *
 *     npm run check:dashboard-dom
 */
import { readFileSync, existsSync } from "node:fs";

/* Les mêmes trois formes que check-host.mjs : une seule échappatoire à la
   fois suffit à faire fuir Obsidian dans le bundle de l'application. */
const IMPORTE_OBSIDIAN = /(?:from\s*|require\s*\(\s*|(?<![.\w$])import\s*\(\s*)["']obsidian["']/;

/* Les extensions posées par Obsidian sur `HTMLElement`, qu'aucun `import` ne
   trahit — le même motif que check-host.mjs, assertion 4. */
const EXTENSIONS_DOM = /\.(createEl|createDiv|createSpan|empty|setText|addClass|removeClass|toggleClass|detach|appendText|setAttr)\s*\(/;

const LIBERES = [
	"src/dashboard/collapsible.ts",
	"src/dashboard/quiz-card.ts",
	"src/dashboard/module-card.ts",
	"src/dashboard/nav.ts",
	"src/dashboard/home.ts",
	"src/dashboard/quizzes.ts",
	"src/dashboard/quizzes-render.ts",
	"src/dashboard/stats-store.ts",
	"src/dashboard/module-map-note.ts",
	"src/dashboard/folder-archive.ts",
	"src/dashboard/module-icons.ts",
	"src/dashboard/ui-select.ts",
	"src/dashboard/icon-picker.ts",
];

/** Retire les commentaires : une extension CITÉE en commentaire (par exemple
    pour expliquer pourquoi on ne l'emploie plus) n'est pas un appel. */
function codeNu(src) {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "");
}

let echecs = 0;
const rate = (msg) => { console.error("ÉCHEC  " + msg); echecs++; };

for (const f of LIBERES) {
	if (!existsSync(f)) {
		rate(`${f} n'existe pas : retirez l'entrée de LIBERES.`);
		continue;
	}
	const source = readFileSync(f, "utf8");
	if (IMPORTE_OBSIDIAN.test(source)) {
		rate(`${f} réimporte « obsidian » : cette page est censée en être libérée pour de bon.`);
	}
	const m = codeNu(source).match(EXTENSIONS_DOM);
	if (m) {
		rate(`${f} emploie « ${m[1]} », une extension DOM d'Obsidian : passez par « ajouter » (src/dom.ts).`);
	}
}

if (echecs) {
	console.error(`\nFrontière du tableau de bord : ${echecs} problème(s)`);
	// exitCode, jamais exit() — la pile doit se dérouler proprement.
	process.exitCode = 1;
} else {
	console.log(`Frontière du tableau de bord : ${LIBERES.length} fichier(s) libéré(s), toujours libres.`);
}
