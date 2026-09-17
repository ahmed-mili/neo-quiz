/**
 * LE MENU D'APPLICATION — l'arbre pur (`apps/windows/src/ui/menu-app-arbre.ts`).
 * Ce qu'il empêche : une entrée sans identifiant (le clic ne saurait quoi
 * faire), deux identifiants égaux, une échelle hors des bornes du principal,
 * une coche posée sur un autre palier que le zoom courant, et un cran de
 * Ctrl + molette qui ne changerait rien (`palierZoomVoisin`).
 *     npm run check:menu-app
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/ui/menu-app-arbre.ts", ({ buildMenu, PALIERS_ZOOM, palierZoomVoisin }) => {
	const r = makeReporter("Menu d'application — arbre");
	const menu = buildMenu({ version: "2.5.2", zoom: 1 });
	r.check("trois sous-menus de premier niveau", menu.map(e => e.id), ["app", "edit", "view"]);
	const ids = [];
	const visiter = (entrees) => { for (const e of entrees) { ids.push(e.id); if (e.kind === "submenu") visiter(e.items); } };
	visiter(menu);
	r.check("aucun identifiant vide", ids.every(id => typeof id === "string" && id.length > 0), true);
	r.check("aucun identifiant en double", new Set(ids).size, ids.length);
	r.check("la version est la première ligne du sous-menu Neo Quiz",
		menu[0].items[0], { kind: "version", id: "version", label: "2.5.2" });
	r.check("les paliers d'échelle sont bornés comme le principal (0.8..1.5)",
		[Math.min(...PALIERS_ZOOM), Math.max(...PALIERS_ZOOM)], [0.8, 1.5]);
	const echelle = menu[2].items.find(e => e.id === "scale");
	r.check("la coche est sur le palier courant, et sur lui seul",
		echelle.items.filter(e => e.checked).map(e => e.value), [1]);
	r.check("un zoom hors palier ne coche rien",
		buildMenu({ version: "x", zoom: 1.05 })[2].items.find(e => e.id === "scale").items.filter(e => e.checked).length, 0);

	/* ─── LE PALIER VOISIN (Ctrl + molette) ───
	   Ce qu'il empêche : un cran de molette qui ne change rien parce que le
	   facteur rendu par Chromium n'est pas exactement le nombre écrit, et un
	   cran au bout de la liste qui sortirait des bornes du principal. */
	r.check("un cran vers le haut depuis 100 %", palierZoomVoisin(1, 1), 1.1);
	r.check("un cran vers le bas depuis 100 %", palierZoomVoisin(1, -1), 0.9);
	r.check("au maximum, vers le haut ne bouge plus", palierZoomVoisin(1.5, 1), 1.5);
	r.check("au minimum, vers le bas ne bouge plus", palierZoomVoisin(0.8, -1), 0.8);
	r.check("depuis une valeur entre deux paliers, on prend celui d'après", palierZoomVoisin(1.05, 1), 1.1);
	r.check("depuis une valeur entre deux paliers, on prend celui d'avant", palierZoomVoisin(1.05, -1), 1);
	/* `getZoomFactor` rend 1.0999999999999999 pour le palier 1,1 : une
	   comparaison stricte ferait rendre 1,1 lui-même, donc un cran mort. */
	r.check("le flottant d'un palier n'est pas son propre voisin", palierZoomVoisin(1.0999999999999999, 1), 1.2);
	r.check("hors bornes par le haut, on revient dans la liste", palierZoomVoisin(2, 1), 1.5);
	r.check("hors bornes par le bas, on revient dans la liste", palierZoomVoisin(0.2, -1), 0.8);
	r.check("une valeur qui n'est pas un nombre compte pour 100 %", palierZoomVoisin(Number.NaN, 1), 1.1);
	r.done();
});
