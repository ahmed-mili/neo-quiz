/**
 * Vérification du RENDU MATHÉMATIQUE partagé.
 *
 * La segmentation ($$…$$ testé avant $…$, avec l'heuristique qui épargne
 * « 5$ et 3$ ») est du code qu'aucun hôte ne réécrira : c'est elle qui décide
 * ce qui EST une formule. Ce script l'éprouve avec un faux HostMath, ce qui
 * prouve du même coup que plus rien n'appelle Obsidian — le bouchon de
 * load-src.mjs jetterait bruyamment.
 *
 *     npm run check:math-render
 */
import { parseHTML, NodeFilter } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const { document } = parseHTML("<html><body></body></html>");
globalThis.document = document;
// mathifyElement parcourt les text nodes via TreeWalker : NodeFilter est une
// constante globale du navigateur, absente de Node — linkedom l'exporte à
// part (elle n'est pas accrochée au document, contrairement au reste du DOM).
globalThis.NodeFilter = NodeFilter;

await withSrcModule(["src/engine/mathjax.ts", "src/host/current.ts"], async (mj, hc) => {
	const r = makeReporter("Rendu mathématique");
	const rendus = [];
	let flushs = 0;
	let prets = 0;

	hc.installHost({
		math: {
			ready: async () => { prets++; },
			render: (latex, display) => {
				rendus.push({ latex, display });
				const el = document.createElement("span");
				el.className = display ? "faux-bloc" : "faux-inline";
				el.textContent = latex;
				return el;
			},
			flush: () => { flushs++; },
		},
	});

	const el = document.createElement("div");
	el.innerHTML = "<p>Soit $x^2$ et $$\\int_0^1 f$$ pour 5$ et 3$.</p>";
	await mj.mathifyElement(el);

	/* Les segments sont rendus dans l'ordre du texte (x^2 avant le bloc) —
	   ce qui importe ici est que « $$…$$ » soit reconnu comme UN bloc et
	   non comme deux inlines vides : sinon « $$ » se lit comme deux « $ »
	   collés et la formule est découpée en morceaux. */
	r.check("les deux segments passent par l'hôte, bloc reconnu comme bloc",
		rendus, [{ latex: "x^2", display: false }, { latex: "\\int_0^1 f", display: true }]);
	/* « 5$ et 3$ » n'est PAS une formule : le $ ouvrant doit être collé au
	   contenu. Sans l'heuristique, tout prix d'un énoncé devient du LaTeX. */
	r.check("les vrais dollars sont épargnés", rendus.length, 2);
	r.check("une seule passe finale pour tout l'élément", flushs, 1);
	r.check("l'hôte est préparé avant de rendre", prets >= 1, true);
	r.check("le DOM porte bien les éléments rendus par l'hôte",
		el.querySelectorAll(".faux-bloc, .faux-inline").length, 2);

	// hasMath ne touche pas l'hôte : c'est une reconnaissance, pas un rendu.
	r.check("hasMath reconnaît une formule", mj.hasMath("valeur $x$"), true);
	r.check("hasMath ignore un prix", mj.hasMath("5$ et 3$"), false);
	r.check("hasMath ignore un texte sans dollar", mj.hasMath("rien"), false);

	r.done();
});
