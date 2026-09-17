/*
 * LE CHANGELOG, LU ET ÉCRIT PAR LA MACHINE.
 *
 * `git ship` ne prend plus de niveau à la main pour l'application : il lit la
 * section `## [Unreleased]` de `CHANGELOG.md` et en DÉDUIT le niveau —
 * `Breaking` → major, sinon `Added` ou `Changed` → minor, sinon `Fixed` →
 * patch — puis renomme la section en `## [X.Y.Z] - date` dans le commit
 * « Version X.Y.Z ». `release.yml` extrait ce bloc comme notes de la release.
 * C'est ce qui rend le numéro STRICT : il ne peut pas dire moins que ce que le
 * fichier annonce, et une version sans une ligne ne se livre pas.
 *
 *     node scripts/changelog.mjs extract 1.2.0
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FICHIER = "CHANGELOG.md";
export const SECTIONS = ["Breaking", "Added", "Changed", "Fixed"];
const TITRE_UNRELEASED = "## [Unreleased]";
const RANGS = { major: 3, minor: 2, patch: 1 };

/** Le texte entre un titre `## …` et le suivant (ou la fin). `null` si absent. */
function bloc(texte, titre) {
	const debut = texte.indexOf(titre + "\n");
	if (debut < 0 && !texte.endsWith(titre)) return null;
	const apresTitre = debut < 0 ? texte.length : debut + titre.length + 1;
	const suivant = texte.indexOf("\n## ", apresTitre);
	return { debut, fin: suivant < 0 ? texte.length : suivant + 1, corps: texte.slice(apresTitre, suivant < 0 ? texte.length : suivant + 1) };
}

export function lireUnreleased(texte) {
	const b = bloc(texte, TITRE_UNRELEASED);
	if (!b) return null;
	const sections = Object.fromEntries(SECTIONS.map(s => [s, []]));
	let courante = null;
	for (const ligne of b.corps.split("\n")) {
		const titre = ligne.match(/^### (\w+)\s*$/);
		if (titre) { courante = SECTIONS.includes(titre[1]) ? titre[1] : null; continue; }
		const entree = ligne.match(/^- (.+)$/);
		if (entree && courante) sections[courante].push(entree[1].trim());
	}
	return { sections };
}

export function deduireNiveau(sections) {
	if (sections.Breaking.length) return "major";
	if (sections.Added.length || sections.Changed.length) return "minor";
	if (sections.Fixed.length) return "patch";
	return null;
}

export function rang(niveau) {
	return RANGS[niveau] ?? 0;
}

export function niveauEntre(courante, demandee) {
	const a = courante.split("-")[0].split(".").map(Number);
	const b = demandee.split("-")[0].split(".").map(Number);
	if (b[0] > a[0]) return "major";
	if (b[0] < a[0]) return null;
	if (b[1] > a[1]) return "minor";
	if (b[1] < a[1]) return null;
	return b[2] > a[2] ? "patch" : null;
}

export function figer(texte, version, dateIso) {
	const b = bloc(texte, TITRE_UNRELEASED);
	if (!b) throw new Error(FICHIER + " : aucune section « " + TITRE_UNRELEASED + " ».");
	const corps = b.corps.replace(/^\n+/, "").replace(/\n+$/, "\n");
	const nouveau = TITRE_UNRELEASED + "\n\n## [" + version + "] - " + dateIso + "\n\n" + corps;
	return texte.slice(0, b.debut) + nouveau + (b.fin < texte.length ? "\n" : "") + texte.slice(b.fin);
}

export function extraire(texte, version) {
	const titre = texte.match(new RegExp("^## \\[" + version.replace(/\./g, "\\.") + "\\] - \\d{4}-\\d{2}-\\d{2}\\s*$", "m"));
	if (!titre) throw new Error(FICHIER + " : aucune section pour la version " + version + ".");
	const b = bloc(texte, titre[0].trimEnd());
	return b.corps.trim();
}

/* ── ligne de commande ── */
const lanceDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (lanceDirect) {
	const [commande, version] = process.argv.slice(2);
	if (commande !== "extract" || !version) {
		console.error("Usage : node scripts/changelog.mjs extract <version>");
		process.exitCode = 1;
	} else {
		const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
		try {
			process.stdout.write(extraire(await readFile(path.join(racine, FICHIER), "utf8"), version) + "\n");
		} catch (e) {
			console.error(e.message);
			process.exitCode = 1;
		}
	}
}
