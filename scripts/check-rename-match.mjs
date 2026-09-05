/**
 * APPARIER LES RENOMMAGES QUE LE SURVEILLANT NE NOMME PAS.
 *
 * Ce que ce script empêche : qu'une note renommée pendant que
 * l'application tourne reparte à zéro (l'historique reste accroché à
 * l'ancien chemin), ET qu'un appariement INVENTÉ transporte l'historique
 * d'une note vers une autre. Le second défaut est pire que le premier :
 * il est faux et invisible.
 *
 *     npm run check:rename-match
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const n = (path, ids) => ({ path, ids });

await withSrcModule("src/review/rename-match.ts", async ({ apparierRenommages, signatureForte, createRenameDetector }) => {
	const r = makeReporter("Renommages — appariement par signature");

	/* Le cas nominal : une note disparaît, une autre apparaît, MÊMES
	   identifiants de questions. Ce n'est pas une ressemblance, c'est la même
	   note — les identifiants sont des slugs des énoncés (src/quiz-ids.ts). */
	r.check("mêmes identifiants ⇒ renommage",
		apparierRenommages([n("Cours/ch1.md", ["ip", "masque"])], [n("Cours/reseau.md", ["ip", "masque"])]),
		[{ from: "Cours/ch1.md", to: "Cours/reseau.md" }]);

	/* Des identifiants DIFFÉRENTS : deux évènements sans rapport. */
	r.check("identifiants différents ⇒ rien",
		apparierRenommages([n("a.md", ["ip"])], [n("b.md", ["dns"])]), []);

	/* Une signature FAIBLE (que des replis `qN`, attribués par POSITION) ne
	   distingue rien : deux quiz de deux questions sans `id:` explicite
	   auraient la même. On refuse d'inventer — la note perdra son historique,
	   ce qui est au moins vrai. */
	r.check("une signature de replis est faible", signatureForte(["q1", "q2"]), false);
	r.check("un seul identifiant explicite suffit", signatureForte(["q1", "adressage"]), true);
	r.check("signature faible ⇒ aucun appariement",
		apparierRenommages([n("a.md", ["q1", "q2"])], [n("b.md", ["q1", "q2"])]), []);

	/* AMBIGUÏTÉ : la même signature deux fois. Copier une note puis supprimer
	   l'originale produirait sinon un appariement arbitraire. */
	r.check("deux apparus de même signature ⇒ rien",
		apparierRenommages([n("a.md", ["ip"])], [n("b.md", ["ip"]), n("c.md", ["ip"])]), []);
	r.check("deux disparus de même signature ⇒ rien",
		apparierRenommages([n("a.md", ["ip"]), n("b.md", ["ip"])], [n("c.md", ["ip"])]), []);

	/* L'ORDRE des identifiants compte : deux quiz peuvent poser les mêmes
	   questions dans un ordre différent et rester deux quiz. */
	r.check("l'ordre fait partie de la signature",
		apparierRenommages([n("a.md", ["ip", "dns"])], [n("b.md", ["dns", "ip"])]), []);

	r.done();
});

await withSrcModule("src/review/rename-match.ts", async ({ createRenameDetector }) => {
	const r = makeReporter("Renommages — détecteur");
	const vus = [];
	let horloge = 1000;
	const det = createRenameDetector({
		onRename: (from, to) => vus.push([from, to]),
		now: () => horloge,
		fenetreMs: 5000,
	});

	const quiz = (path, ids) => ({ path, items: ids.map(id => ({ id })) });

	// Première observation : rien à apparier, on mémorise seulement.
	det.observer([quiz("Cours/ch1.md", ["ip", "masque"])]);
	r.check("la première observation n'apparie rien", vus.length, 0);

	/* Le surveillant a émis `delete` puis `create` : le scanner voit d'abord
	   la disparition, puis l'apparition. C'est EXACTEMENT le cas que
	   plugin-fs produit quand il ne relie pas les deux moitiés. */
	det.observer([]);
	r.check("une disparition seule n'apparie rien", vus.length, 0);
	horloge += 300;
	det.observer([quiz("Cours/reseau.md", ["ip", "masque"])]);
	r.check("l'apparition qui suit est appariée", vus, [["Cours/ch1.md", "Cours/reseau.md"]]);

	/* Hors de la fenêtre : une note supprimée il y a une heure et une note
	   créée aujourd'hui n'ont plus de raison d'être la même. */
	det.observer([]);
	horloge += 60000;
	det.observer([quiz("Autre/reseau.md", ["ip", "masque"])]);
	r.check("hors fenêtre, aucun appariement", vus.length, 1);

	r.done();
});
