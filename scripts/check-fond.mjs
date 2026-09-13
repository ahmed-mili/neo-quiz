/**
 * LE FOND D'ÉCRAN — le noyau pur (`apps/windows/src/ui/fond-pur.ts`) :
 * `estImageDeFond` (quelles extensions comptent comme une image de fond) et
 * `suivante` (l'ordre trié, cyclique, et le repli sur la première image
 * quand la courante a disparu du disque). Aucun `pont()`, aucun DOM.
 *
 *     npm run check:fond
 */
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
