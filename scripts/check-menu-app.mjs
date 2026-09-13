/**
 * LE MENU D'APPLICATION — l'arbre pur (`apps/windows/src/ui/menu-app-arbre.ts`).
 * Ce qu'il empêche : une entrée sans identifiant (le clic ne saurait quoi
 * faire), deux identifiants égaux, une échelle hors des bornes du principal,
 * et une coche posée sur un autre palier que le zoom courant.
 *     npm run check:menu-app
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/ui/menu-app-arbre.ts", ({ buildMenu, PALIERS_ZOOM }) => {
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
	r.done();
});
