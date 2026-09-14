/* ══════════════════════════════════════════════════════════
   LES GLYPHES DE FENÊTRE — partagés par l'application et le bootstrapper

   Module PUR (DOM seulement, aucun import) : la barre de titre de l'app
   (`barre-titre.ts`) et la fenêtre d'installation (`apps/windows/installer/
   renderer-reference.ts`) dessinent les mêmes boutons réduire/fermer, et une
   copie divergerait sans un mot.
══════════════════════════════════════════════════════════ */
/* LES GLYPHES DE NEO CALENDAR, REPRIS TRAIT POUR TRAIT (`apps/windows/src/
   assets/toolbar/*.svg` de neo-calendar, 2026-09-13) : ce ne sont pas des
   icônes Lucide — `minus`, `square` et `x` n'ont ni le même trait, ni les
   mêmes bouts ronds, ni la même part de leur boîte, et Ahmed les a vus
   différer à l'écran. Construits par le DOM (`createElementNS`), jamais en
   `innerHTML` : la règle des quatre portes vaut aussi pour un SVG constant.
   Tailles de la référence (`.nc-desktop-window-control > .nc-toolbar-icon`,
   24 px, qui l'emporte sur les 16 px de la règle générique) : 24 px pour
   réduire, fermer et le chevron, 20 px pour agrandir ; « restaurer » seul reste le `copy` de
   Lucide à 16 px, comme chez Neo Calendar. */
const GLYPHES = {
	minimize: { boite: "0 0 20 20", taille: 24, trait: 1.5, chemins: ["M6.25 10H13.75"] },
	maximize: { boite: "0 0 24 24", taille: 20, trait: 1.75, rect: { x: 6.3, y: 6.3, w: 11.4, h: 11.4, rx: 1.5 } },
	close: { boite: "0 0 24 24", taille: 24, trait: 1.75, chemins: ["M8 8L16 16M16 8L8 16"] },
	"chevron-down": { boite: "0 0 24 24", taille: 24, trait: 1.75, chemins: ["M7.8 9.6L12 13.8L16.2 9.6"], joint: true },
} as const;

export function poserGlyphe(el: HTMLElement, nom: keyof typeof GLYPHES): void {
	const g = GLYPHES[nom];
	const NS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", g.boite);
	svg.setAttribute("width", String(g.taille));
	svg.setAttribute("height", String(g.taille));
	svg.setAttribute("fill", "none");
	svg.setAttribute("aria-hidden", "true");
	const trait = (n: Element): void => {
		n.setAttribute("stroke", "currentColor");
		n.setAttribute("stroke-width", String(g.trait));
		n.setAttribute("stroke-linecap", "round");
		if ("joint" in g && g.joint) n.setAttribute("stroke-linejoin", "round");
	};
	if ("rect" in g) {
		const r = document.createElementNS(NS, "rect");
		r.setAttribute("x", String(g.rect.x)); r.setAttribute("y", String(g.rect.y));
		r.setAttribute("width", String(g.rect.w)); r.setAttribute("height", String(g.rect.h));
		r.setAttribute("rx", String(g.rect.rx));
		trait(r); svg.appendChild(r);
	} else {
		for (const d of g.chemins) {
			const c = document.createElementNS(NS, "path");
			c.setAttribute("d", d); trait(c); svg.appendChild(c);
		}
	}
	el.replaceChildren(svg);
}
