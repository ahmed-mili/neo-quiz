/**
 * « On ne doit JAMAIS voir de caractères non rendus » — vérifié sur de VRAIS
 * quiz, pas sur des cas inventés.
 *
 *     node scripts/check-render-markers.mjs "C:/obsidian-vaults/Personal" "C:/obsidian-vaults/Efrei"
 *
 * Chaque champ TEXTE que l'apprenant lit (énoncé, options, items de classement,
 * lignes d'appariement, gabarit de trous, indice, explication, leçon, support)
 * passe par la vraie fonction de rendu du moteur (engine/sanitizer.ts
 * renderInlineText — importée, jamais répliquée). On retire ensuite du HTML
 * produit ce qui est LITTÉRAL par nature (contenu de <code>, formules LaTeX),
 * puis on cherche ce qui reste de markdown non traduit.
 *
 * Un champ porteur d'une variante `*Html` n'est PAS compté : le moteur affiche
 * alors le HTML pré-rendu et ignore le texte (engine/cards.ts).
 *
 * CE QUE CE SCRIPT NE VOIT PAS — et comment le voir. Il éprouve la GRAMMAIRE,
 * pas le CÂBLAGE : un champ que le moteur affiche sans appeler le rendu du
 * tout passe ici pour sain. C'est exactement ce qui était arrivé au libellé
 * d'emplacement d'un classement (`quiz-slot-label`, interpolé brut). Le seul
 * filet contre ça est de lire le DOM RENDU, dans Obsidian :
 *
 *     obsidian eval vault=<nom> code="(()=>{ \
 *       const host=leaf.view.containerEl.querySelector('.quiz-blocks-host'); \
 *       return [...host.querySelectorAll('.quiz-track-item')].map(it=>{ \
 *         const c=it.cloneNode(true); \
 *         c.querySelectorAll('code,pre,mjx-container,.MathJax').forEach(n=>n.remove()); \
 *         return c.innerText; }).filter(t=>/\*[^\n]*\*/.test(t)); })()"
 *
 * sur une note qui charge chaque type de question de markdown. Les deux
 * vérifications sont complémentaires : celle-ci sur 8546 champs réels, celle-là
 * sur tous les chemins d'affichage.
 *
 * Aucun fichier n'est modifié.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import JSON5 from "json5";
import { withSrcModule } from "./lib/load-src.mjs";

const racines = process.argv.slice(2);
if (racines.length === 0) {
	console.error("Usage : node scripts/check-render-markers.mjs <chemin-de-vault> […]");
	process.exit(2);
}

function walk(dir, out) {
	let entries;
	try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
	for (const e of entries) {
		// `_to_delete` est le bac à sable : on y écrit exprès des quiz tordus
		// (étoiles littérales, pièges de rendu) qui n'ont pas à peser sur un
		// audit censé parler des VRAIS quiz d'Ahmed.
		if (e.name.startsWith(".") || e.name === "_to_delete") continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (e.name.endsWith(".md")) out.push(p);
	}
	return out;
}

/* Ce qui, dans le HTML rendu, est littéral par CONTRAT et n'a donc pas à être
   traduit : le contenu d'un <code> (``a ` b`` garde son accent grave) et une
   formule LaTeX (MathJax lit la source telle quelle, `*` compris). */
function retirerLitteraux(html) {
	return html
		.replace(/<code>[\s\S]*?<\/code>/g, "")
		.replace(/\$\$[\s\S]*?\$\$/g, "")
		.replace(/\$[^$\n]+\$/g, "");
}

/* Les motifs cherchés dans ce qu'il RESTE. Chacun est un markdown qu'un
   modèle produit spontanément et que l'apprenant ne doit pas lire tel quel.

   Un délimiteur SURVIVANT n'est pas forcément un rendu manqué — le plus
   souvent c'est une étoile littérale, et la laisser est le comportement
   JUSTE : `arp -d *`, `GRANT … ON glpi.*`, `3*4*5`, `C:\Users\*\AppData`
   (les 6 seules occurrences des deux vaults sont de cette nature).

   Ce qui trahit vraiment un champ passé À CÔTÉ du rendu, c'est un
   délimiteur qui aurait PU ouvrir une emphase — même règle de flanc que le
   moteur : ni lettre, ni chiffre, ni antislash devant, du non-espace
   derrière — suivi d'un autre délimiteur sur la même ligne. Le rendu, lui,
   n'en laisse jamais passer un pareil. */
function ouvrante(delim) {
	const d = delim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp("(?:^|[^\\p{L}\\p{N}\\\\" + d + "])" + d + "(?=\\S)[^\\n]*?" + d, "u");
}

const MOTIFS = [
	["gras/italique", ouvrante("*")],
	["code inline", ouvrante("`")],
	["barré", ouvrante("~~")],
	["titre", /(^|<br>)\s*#{1,6}\s+\S/],
	["gras souligné", /(^|[^\p{L}\p{N}\\_])__(?=\S)[\s\S]*?\S__/u],
	["lien", /\[[^\]\n]+\]\([^)\n]+\)/],
];

const fichiers = racines.flatMap(r => walk(r, []));
console.log(fichiers.length + " notes examinées dans " + racines.length + " vault(s)");

await withSrcModule("src/engine/sanitizer.ts", (sanitizer) => {
	const rendre = sanitizer.renderInlineText;
	let quiz = 0, champs = 0;
	const parMotif = new Map();
	const exemples = [];

	/** Un champ texte affiché : le rendre, et signaler ce qui n'a pas été traduit. */
	const verifier = (fichier, qi, nom, valeur) => {
		if (typeof valeur !== "string" || !valeur.trim()) return;
		champs++;
		const reste = retirerLitteraux(rendre(valeur));
		for (const [libelle, motif] of MOTIFS) {
			if (!motif.test(reste)) continue;
			parMotif.set(libelle, (parMotif.get(libelle) || 0) + 1);
			if (exemples.length < 40) {
				exemples.push({ fichier, qi, nom, libelle, extrait: valeur.replace(/\s+/g, " ").slice(0, 140) });
			}
		}
	};

	/** Les champs TEXTE d'une question, dans l'ordre où l'apprenant les lit.
	    `sautSi` porte le nom du champ HTML qui prendrait le dessus. */
	const CHAMPS = [
		["title", null], ["prompt", "promptHtml"], ["passage", "passageHtml"],
		["passageTitle", null], ["hint", null], ["explain", "explainHtml"],
		["learn", "learnHtml"], ["cloze", null], ["answer", null], ["placeholder", null],
	];
	const LISTES = [
		["options", "optionHtml"], ["possibilities", null], ["orderingItems", null],
		["slots", null], ["slotLabels", null], ["rows", null], ["choices", null],
		["acceptedAnswers", null], ["acceptableAnswers", null], ["correctAnswers", null],
	];

	for (const f of fichiers) {
		const m = readFileSync(f, "utf8").match(/```quiz-blocks\r?\n([\s\S]*?)\r?\n```/);
		if (!m) continue;
		let parsed;
		try { parsed = JSON5.parse(m[1]); } catch { continue; }
		if (!Array.isArray(parsed)) continue;
		quiz++;

		parsed.forEach((q, qi) => {
			if (!q || typeof q !== "object" || Array.isArray(q)) return;
			for (const [nom, htmlPrioritaire] of CHAMPS) {
				if (htmlPrioritaire && (q[htmlPrioritaire] || q["_" + htmlPrioritaire])) continue;
				verifier(f, qi, nom, q[nom]);
			}
			for (const [nom, htmlPrioritaire] of LISTES) {
				const liste = q[nom];
				if (!Array.isArray(liste)) continue;
				const html = Array.isArray(q[htmlPrioritaire]) ? q[htmlPrioritaire] : null;
				liste.forEach((v, i) => {
					if (html && html[i]) return;
					verifier(f, qi, nom + "[" + i + "]", v);
				});
			}
		});
	}

	console.log("quiz : " + quiz + " | champs texte rendus : " + champs);
	if (parMotif.size === 0) {
		console.log("\nAucun marqueur markdown non rendu. OK");
		process.exit(0);
	}
	console.log("\nMARQUEURS NON RENDUS :");
	for (const [libelle, n] of [...parMotif].sort((a, b) => b[1] - a[1])) {
		console.log("  " + String(n).padStart(4) + "  " + libelle);
	}
	console.log("\nExemples :");
	for (const e of exemples) {
		console.log("  [" + e.libelle + "] " + e.fichier.split(/[\\/]/).pop() + " q" + e.qi + "." + e.nom);
		console.log("      " + e.extrait);
	}
	process.exit(1);
});
