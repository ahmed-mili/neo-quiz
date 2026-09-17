/**
 * LE FOND D'ÉCRAN — deux noyaux purs, aucun `pont()`, aucun DOM.
 *
 * 1. `fond-pur.ts` : `estImageDeFond` (quelles extensions comptent comme une
 *    image de fond) et `suivante` (l'ordre trié, cyclique, et le repli sur la
 *    première image quand la courante a disparu du disque).
 * 2. `fonds-catalogue.ts` : les photos LIVRÉES avec l'application. Ce que ce
 *    groupe empêche est invisible à la lecture — un identifiant qui ne
 *    correspond à aucun fichier donne une case grise dans la liste, sans une
 *    erreur ; un fichier qu'aucune entrée ne cite pèse dans l'installeur sans
 *    jamais s'afficher ; et une catégorie qui déborde son plafond fait grossir
 *    l'installeur d'un rayon qu'on ne parcourt plus.
 *
 *     npm run check:fond
 */
import { readdirSync } from "node:fs";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/ui/fond-pur.ts", ({ estImageDeFond, suivante }) => {
	const r = makeReporter("Fond d'écran — noyau pur");

	r.check("a.jpg : vrai", estImageDeFond("a.jpg"), true);
	r.check("B.JPEG : vrai, casse ignorée", estImageDeFond("B.JPEG"), true);
	r.check("c.png : vrai", estImageDeFond("c.png"), true);
	r.check("d.webp : vrai", estImageDeFond("d.webp"), true);
	r.check("e.avif : vrai", estImageDeFond("e.avif"), true);
	r.check("f.gif : vrai", estImageDeFond("f.gif"), true);
	r.check("g.svg : faux", estImageDeFond("g.svg"), false);
	r.check("h.txt : faux", estImageDeFond("h.txt"), false);
	r.check("i (sans extension) : faux", estImageDeFond("i"), false);
	r.check(".jpg (nom vide) : faux", estImageDeFond(".jpg"), false);

	const liste = ["b.png", "a.jpg", "c.webp"];
	r.check("suivante : ordre trié", suivante(liste, "a.jpg"), "b.png");
	r.check("suivante : cyclique, revient à la première", suivante(liste, "c.webp"), "a.jpg");
	r.check("suivante : courante disparue, première de la liste", suivante(liste, "zz.jpg"), "a.jpg");
	r.check("suivante : liste vide, rien", suivante([], undefined), undefined);

	r.done();
});

await withSrcModule("apps/windows/src/ui/fonds-catalogue.ts", ({
	FONDS_EMBARQUES, CATEGORIES_FOND, MAX_PAR_CATEGORIE, fondsParCategorie, fondEmbarque,
}) => {
	const r = makeReporter("Fond d'écran — catalogue embarqué");

	/* LE PLAFOND PAR CATÉGORIE. Chaque photo coûte environ 800 ko dans
	   l'installeur ET dans chaque mise à jour complète ; un rayon de dix
	   montagnes ne se choisit pas mieux qu'un de cinq. */
	const trop = fondsParCategorie()
		.filter(g => g.fonds.length > MAX_PAR_CATEGORIE)
		.map(g => g.categorie + " (" + g.fonds.length + ")");
	r.check("aucune catégorie ne dépasse le plafond", trop, []);

	/* LES DEUX SENS DE LA CORRESPONDANCE AVEC LE DISQUE. Une entrée sans
	   fichier donne une vignette grise que rien n'explique ; un fichier sans
	   entrée voyage dans l'installeur sans jamais s'afficher. */
	const surDisque = new Set(
		readdirSync("apps/windows/public/fonds")
			.filter(f => f.endsWith(".jpg"))
			.map(f => f.slice(0, -4)),
	);
	const vignettes = new Set(
		readdirSync("apps/windows/public/fonds/vignettes")
			.filter(f => f.endsWith(".jpg"))
			.map(f => f.slice(0, -4)),
	);
	const cites = new Set(FONDS_EMBARQUES.map(f => f.id));
	r.check("chaque fond du catalogue a son image", FONDS_EMBARQUES.filter(f => !surDisque.has(f.id)).map(f => f.id), []);
	r.check("chaque fond du catalogue a sa vignette", FONDS_EMBARQUES.filter(f => !vignettes.has(f.id)).map(f => f.id), []);
	r.check("aucune image n'est livrée sans être au catalogue", [...surDisque].filter(id => !cites.has(id)), []);
	r.check("aucune vignette n'est livrée sans être au catalogue", [...vignettes].filter(id => !cites.has(id)), []);

	/* Un identifiant en double donnerait deux lignes qui se cochent ensemble,
	   et `fondEmbarque` n'en rendrait jamais que la première. */
	r.check("les identifiants sont uniques", cites.size, FONDS_EMBARQUES.length);
	/* Une catégorie hors liste ferait disparaître ses photos de la liste :
	   `fondsParCategorie` ne parcourt que `CATEGORIES_FOND`. */
	r.check("toutes les catégories sont déclarées",
		FONDS_EMBARQUES.filter(f => !CATEGORIES_FOND.includes(f.categorie)).map(f => f.id), []);
	r.check("le groupement ne perd aucune photo",
		fondsParCategorie().reduce((n, g) => n + g.fonds.length, 0), FONDS_EMBARQUES.length);
	/* Le crédit voyage avec l'image : la licence d'Unsplash demande de citer
	   l'auteur, et une ligne d'option sans crédit ne le dit à personne. */
	r.check("chaque photo cite son auteur",
		FONDS_EMBARQUES.filter(f => !f.auteur || !f.auteur.trim()).map(f => f.id), []);
	r.check("un identifiant inconnu ne rend rien", fondEmbarque("n-existe-pas"), undefined);

	r.done();
});
