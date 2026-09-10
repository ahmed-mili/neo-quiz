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

/* Les TROIS formes de dépendance, pas seulement les deux statiques :
   `from "obsidian"`, `require("obsidian")` ET `import("obsidian")`. La
   dernière a été oubliée au premier jet alors que le dépôt avait déjà
   l'idiome du chargement différé (`require("./dashboard/quiz-open")`) — un
   `const o = await import("obsidian")` passait donc au vert. */
const IMPORTE_OBSIDIAN = /(?:from\s*|require\s*\(\s*|(?<![.\w$])import\s*\(\s*)["']obsidian["']/;

/* `.mts` et `.cts` comptent : un fichier qui ne finit pas par `.ts` n'était
   pas collecté, donc jamais examiné — une échappatoire d'un caractère. */
const EXTENSIONS_TS = [".ts", ".tsx", ".mts", ".cts"];

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
	"src/dashboard/file-sources.ts",
	"src/dashboard/mention-picker.ts",
	"src/dashboard/prompt-paths.ts",
	"src/dashboard/share.ts",
	"src/dashboard/usage-modal.ts",
	"src/dashboard/voice-input.ts",
	"src/dashboard/voice-install.ts",
	"src/types/dashboard-ctx.ts",
	// Divers du greffon — tranche 4.
	"src/hotkey-format.ts",
	"src/modal-base.ts",
];

function fichiersTs(racine) {
	const trouves = [];
	if (!existsSync(racine)) return trouves;
	for (const nom of readdirSync(racine)) {
		const chemin = join(racine, nom);
		/* `node_modules`, `dist` et les artefacts Rust ne sont pas du code du
		   dépôt : les balayer ferait échouer le contrôle sur les typages
		   d'Obsidian eux-mêmes. */
		if (nom === "node_modules" || nom === "dist" || nom === "target" || nom === "gen") continue;
		if (statSync(chemin).isDirectory()) trouves.push(...fichiersTs(chemin));
		else if (EXTENSIONS_TS.some(e => nom.endsWith(e))) trouves.push(chemin.split(sep).join(posix.sep));
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

/* 3. L'app Windows n'a jamais rien à faire d'Obsidian.
      On balaie TOUT `apps/windows`, pas seulement son `src/` : la config Vite,
      `tauri.conf` ou un script racine sont des `.ts` du même projet, et un
      fichier posé juste à côté de `src/` échappait au contrôle. */
for (const f of fichiersTs("apps/windows")) {
	if (IMPORTE_OBSIDIAN.test(readFileSync(f, "utf8"))) rate(`${f} importe « obsidian » : ce n'est pas son hôte.`);
}

/* 4. LES EXTENSIONS DOM D'OBSIDIAN — le trou que les trois assertions
      précédentes ne pouvaient pas voir.

      Obsidian pose sur `HTMLElement` des méthodes bien pratiques
      (`createDiv`, `createEl`, `empty`, `setText`…) qui n'existent nulle part
      ailleurs. C'est une dépendance à Obsidian qu'AUCUN `import` ne trahit :
      elle est partie une fois dans le bundle de l'application, via
      `renderParagraph` de `quiz-utils.ts`, et y aurait planté si on l'avait
      atteinte.

      La règle se passe d'une seconde liste : un fichier qui importe encore
      Obsidian est DÉJÀ déclaré dans RESTANTS, et ses extensions DOM partiront
      avec lui. Ce sont les AUTRES qu'on interdit — et le jour où une tranche
      future retire un fichier de RESTANTS, ses extensions DOM deviennent une
      erreur du même coup. Le cliquet se referme tout seul.

      `src/dom.ts` fournit le remplaçant (`ajouter`), en DOM standard. */
const EXTENSIONS_DOM = /\.(createEl|createDiv|createSpan|empty|setText|addClass|removeClass|toggleClass|detach|appendText|setAttr)\s*\(/;

/** Retire les COMMENTAIRES : une extension CITÉE dans un commentaire
    (« DOM standard, PAS `container.createEl()` ») n'est pas un appel. */
function codeNu(src) {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "");
}

for (const f of fichiersTs("src")) {
	if (importeurs.has(f)) continue; // déjà déclaré : il partira avec son import
	const m = codeNu(readFileSync(f, "utf8")).match(EXTENSIONS_DOM);
	if (m) rate(`${f} emploie « ${m[1]} », une extension DOM d'Obsidian absente des autres hôtes : passez par « ajouter » (src/dom.ts).`);
}

/* 5. LE SENS DES DÉPENDANCES. `src/` est le code partagé : il ne connaît pas
      ses hôtes. La tranche 3 a déplacé `editor.ts` et `quiz-open.ts` vers
      `apps/obsidian/` parce qu'ils ne décrivaient qu'un onglet — et
      `src/dashboard.ts`, qui est lui-même un `ItemView` en instance de départ,
      les importe désormais de là. C'est la SEULE exception, et elle est
      nommée : sans cette assertion, « juste un import depuis apps/ » serait la
      façon la plus rapide de contourner tout le reste du contrôle, sans
      qu'aucune des quatre assertions précédentes ne s'en aperçoive. */
const IMPORTE_APPS = /(?:from\s*|require\s*\(\s*|(?<![.\w$])import\s*\(\s*)["'][^"']*\bapps\//;
const EXCEPTIONS_APPS = new Set(["src/dashboard.ts"]);
for (const f of fichiersTs("src")) {
	if (EXCEPTIONS_APPS.has(f)) continue;
	if (IMPORTE_APPS.test(codeNu(readFileSync(f, "utf8")))) {
		rate(`${f} importe depuis apps/ : le code partagé ne connaît pas ses hôtes.`);
	}
}

if (echecs) {
	console.error(`\nFrontière d'hôte : ${echecs} problème(s)`);
	// exitCode, jamais exit() — cohérent avec les autres scripts du dépôt.
	process.exitCode = 1;
} else {
	console.log(`Frontière d'hôte : ${importeurs.size} fichier(s) encore lié(s) à Obsidian, tous déclarés.`);
}
