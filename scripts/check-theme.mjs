/**
 * EXHAUSTIVITÉ DU THÈME de l'application.
 *
 * Le greffon hérite des variables CSS d'Obsidian (--background-primary,
 * --text-normal…) ; l'app doit les définir elle-même. Une variable oubliée ne
 * produit AUCUNE erreur : elle rend un texte invisible sur un fond de la même
 * couleur, ou fait disparaître une bordure. On ne le voit qu'en plissant les
 * yeux sur un écran sombre — donc on le mesure.
 *
 * Le contrôle est symétrique, comme le cliquet de check-host : une variable
 * définie dans le thème mais plus référencée nulle part doit être retirée,
 * sinon le fichier accumule du mort qu'on n'ose plus toucher.
 *
 *     npm run check:theme
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep, posix } from "node:path";

const THEME = "apps/windows/src/theme/host-vars.css";

/** Les `.ts` de `src/`, pour y trouver les variables posées à l'exécution. */
function fichiersTs(racine) {
	const trouves = [];
	for (const nom of readdirSync(racine)) {
		const chemin = join(racine, nom);
		if (statSync(chemin).isDirectory()) trouves.push(...fichiersTs(chemin));
		else if (nom.endsWith(".ts")) trouves.push(chemin.split(sep).join(posix.sep));
	}
	return trouves;
}

function fichiersCss(racine) {
	const trouves = [];
	for (const nom of readdirSync(racine)) {
		const chemin = join(racine, nom);
		if (statSync(chemin).isDirectory()) trouves.push(...fichiersCss(chemin));
		else if (nom.endsWith(".css")) trouves.push(chemin.split(sep).join(posix.sep));
	}
	return trouves;
}

/* Une DÉCLARATION de propriété personnalisée : en début de ligne, ou après une
   accolade ouvrante / un point-virgule. Le début de ligne seul ne suffit pas —
   les six paliers d'effort sont déclarés en règles d'une seule ligne
   (`.qbd-effort-option--low { --qbd-effort-color: …; }`, ui-select.css:502-508)
   et seraient vus à tort comme « manquants ». Exiger du thème une valeur
   GLOBALE pour eux serait faux : elle figerait les six paliers à la même
   couleur. Les deux ancres écartent les sélecteurs BEM (`.btn--primary:hover`),
   dont le `--primary` n'est précédé ni de `{` ni de `;` ni du début de ligne. */
const DECLARATION = /(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/gim;

const referencees = new Set();
const definies = new Set();
for (const f of fichiersCss("src/assets/css")) {
	const css = readFileSync(f, "utf8");
	for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) referencees.add(m[1]);
	for (const m of css.matchAll(DECLARATION)) definies.add(m[1]);
}

/* TROIS catégories, pas deux. Une variable référencée sans être définie dans
   l'arbre CSS n'est pas forcément héritée d'Obsidian : certaines sont posées
   À L'EXÉCUTION par le JavaScript, sur un élément précis
   (`el.style.setProperty("--mod-color", …)`). Exiger du thème qu'il les
   définisse serait FAUX — leur valeur est propre à chaque élément, et une
   valeur globale les figerait toutes à la même.
   Mesuré le 2026-09-04 : six sont dans ce cas (`--mod-color`, `--qbd-p`,
   `--qbd-drift`, `--qbd-card-delay`, `--qbd-donut-mastered-end`,
   `--qbd-donut-review-end`). On les détecte, on ne les code pas en dur : une
   septième apparaîtra un jour. */
const posesParJs = new Set();
for (const f of fichiersTs("src")) {
	for (const m of readFileSync(f, "utf8").matchAll(/setProperty\(\s*["'`](--[a-z0-9-]+)/gi)) {
		posesParJs.add(m[1]);
	}
}

/* Ce qu'Obsidian fournissait : référencé par l'arbre partagé, défini nulle
   part dedans, et pas posé par le JS. Une variable AVEC valeur de repli
   compte quand même — un repli est un dernier recours, pas une couleur
   choisie. */
const attendues = [...referencees]
	.filter(v => !definies.has(v) && !posesParJs.has(v))
	.sort();

const theme = readFileSync(THEME, "utf8");
const fournies = new Set([...theme.matchAll(DECLARATION)].map(m => m[1]));

const manquantes = attendues.filter(v => !fournies.has(v));
const inutiles = [...fournies].filter(v => !attendues.includes(v)).sort();

let echecs = 0;
if (manquantes.length) {
	console.error("ÉCHEC  variables héritées d'Obsidian non définies par le thème de l'app :");
	for (const v of manquantes) console.error("       " + v);
	echecs++;
}
if (inutiles.length) {
	console.error("ÉCHEC  variables définies par le thème mais référencées nulle part :");
	for (const v of inutiles) console.error("       " + v);
	echecs++;
}

if (echecs) {
	// exitCode, jamais exit() — cohérent avec les autres scripts du dépôt.
	process.exitCode = 1;
} else {
	console.log(`Thème de l'app : ${attendues.length}/${attendues.length} variables héritées définies.`);
}
