/**
 * Le viewport de la piste d'un quiz n'est JAMAIS un conteneur défilable.
 *
 * `.quiz-track-viewport` coupe la piste (les questions voisines, en
 * translateX). En `overflow: hidden`, il restait défilable PAR PROGRAMME : un
 * `focus()` ou un `scrollIntoView` dans la question qui entre le décalait
 * verticalement, et la question plus courte sortait de la zone visible — une
 * page blanche sans moyen d'y revenir (test du 2026-09-23 : 282 px après
 * Suivant puis Précédent). `overflow: clip` coupe pareil sans être défilable.
 *
 * Ce contrôle lit TOUTES les feuilles de `src/assets/css/` et exige que chaque
 * déclaration `overflow`, `overflow-x` ou `overflow-y` d'une règle qui vise
 * `.quiz-track-viewport` (hors pseudo-élément) vaille `clip`.
 *
 *     npm run check:viewport-clip
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { makeReporter } from "./lib/load-src.mjs";

const RACINE = "src/assets/css";
const feuilles = [];
(function parcourir(dossier) {
	for (const nom of readdirSync(dossier)) {
		const p = join(dossier, nom);
		if (statSync(p).isDirectory()) parcourir(p);
		else if (nom.endsWith(".css")) feuilles.push(p);
	}
})(RACINE);

/** Les règles `sélecteur { déclarations }` les plus internes (celles d'un
    `@media` comprises), commentaires retirés. */
function regles(css) {
	const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const out = [];
	for (const m of sansCommentaires.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ selecteur: m[1].trim(), corps: m[2] });
	return out;
}

/** Les déclarations `overflow*` d'une règle qui vise le viewport lui-même. */
export function violations(css) {
	const out = [];
	for (const { selecteur, corps } of regles(css)) {
		const vise = selecteur.split(",").some(s => /\.quiz-track-viewport(?![\w-])(?!::)/.test(s) && !/::/.test(s.slice(s.indexOf(".quiz-track-viewport"))));
		if (!vise) continue;
		for (const d of corps.matchAll(/(overflow(?:-x|-y)?)\s*:\s*([^;]+)/g)) {
			const valeur = d[2].replace(/!important/, "").trim();
			if (valeur !== "clip") out.push(`${selecteur} { ${d[1]}: ${d[2].trim()} }`);
		}
	}
	return out;
}

const r = makeReporter("Viewport de la piste");
r.check("le détecteur voit un `overflow: hidden` sur le viewport",
	violations(".quiz-track-viewport{ overflow-y: hidden !important; }").length, 1);
r.check("le détecteur ignore le pseudo-élément de la barre de défilement",
	violations(".quiz-track-viewport::-webkit-scrollbar{ overflow: hidden; }").length, 0);
r.check("le détecteur accepte `clip`",
	violations(".quiz-track-viewport{ overflow-x: clip !important; overflow-y: clip !important; }").length, 0);
const trouvees = feuilles.flatMap(f => violations(readFileSync(f, "utf8")).map(v => `${f} : ${v}`));
r.check("aucune règle ne rend le viewport défilable", trouvees, []);
r.done();
