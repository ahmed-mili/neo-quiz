/* ══════════════════════════════════════════════════════════
   LES LOGOS DE MARQUE — hors Lucide, et c'est la seule exception

   La règle du dépôt est « Lucide, jamais autre chose » pour les icônes
   d'INTERFACE. Un logo de marque n'en est pas une : Lucide n'en fournit
   aucun, et un glyphe générique choisi à sa place ne dirait pas de quelle
   marque il s'agit — c'est tout ce qu'un logo a à dire.

   Le tracé vient de Simple Icons (CC0), copié tel quel et JAMAIS redessiné :
   un logo approché est un logo faux.

   POSÉ PAR `createElementNS`, ET PAS PAR `innerHTML`. Le dépôt n'ouvre que
   quatre portes pour du HTML (`engine/sanitizer.ts`) ; une cinquième ouverte
   « parce que c'est une constante » resterait une porte, et la prochaine
   chaîne qui y passerait ne serait plus une constante.
══════════════════════════════════════════════════════════ */

const NS_SVG = "http://www.w3.org/2000/svg";

/** Obsidian — simple-icons/icons/obsidian.svg, relevé le 2026-09-17. */
const TRACE_OBSIDIAN = "M19.355 18.538a68.967 68.959 0 0 0 1.858-2.954.81.81 0 0 0-.062-.9c-.516-.685-1.504-2.075-2.042-3.362-.553-1.321-.636-3.375-.64-4.377a1.707 1.707 0 0 0-.358-1.05l-3.198-4.064a3.744 3.744 0 0 1-.076.543c-.106.503-.307 1.004-.536 1.5-.134.29-.29.6-.446.914l-.31.626c-.516 1.068-.997 2.227-1.132 3.59-.124 1.26.046 2.73.815 4.481.128.011.257.025.386.044a6.363 6.363 0 0 1 3.326 1.505c.916.79 1.744 1.922 2.415 3.5zM8.199 22.569c.073.012.146.02.22.02.78.024 2.095.092 3.16.29.87.16 2.593.64 4.01 1.055 1.083.316 2.198-.548 2.355-1.664.114-.814.33-1.735.725-2.58l-.01.005c-.67-1.87-1.522-3.078-2.416-3.849a5.295 5.295 0 0 0-2.778-1.257c-1.54-.216-2.952.19-3.84.45.532 2.218.368 4.829-1.425 7.531zM5.533 9.938c-.023.1-.056.197-.098.29L2.82 16.059a1.602 1.602 0 0 0 .313 1.772l4.116 4.24c2.103-3.101 1.796-6.02.836-8.3-.728-1.73-1.832-3.081-2.55-3.831zM9.32 14.01c.615-.183 1.606-.465 2.745-.534-.683-1.725-.848-3.233-.716-4.577.154-1.552.7-2.847 1.235-3.95.113-.235.223-.454.328-.664.149-.297.288-.577.419-.86.217-.47.379-.885.46-1.27.08-.38.08-.72-.014-1.043-.095-.325-.297-.675-.68-1.06a1.6 1.6 0 0 0-1.475.36l-4.95 4.452a1.602 1.602 0 0 0-.513.952l-.427 2.83c.672.59 2.328 2.316 3.335 4.711.09.21.175.43.253.653z";

/**
 * Le logo Obsidian dans `parent`, à la couleur du texte courant.
 *
 * `fill` et non `stroke` : un logo de marque est une forme pleine, là où une
 * icône Lucide est un trait. Le `<title>` est ce qu'une aide technique lit —
 * sans lui, la pastille ne serait qu'un dessin muet à côté d'un nom de
 * dossier, et rien ne dirait pourquoi ce dossier-là en porte une.
 */
export function poserLogoObsidian(parent: Element, titre: string): SVGSVGElement {
	const svg = parent.appendChild(document.createElementNS(NS_SVG, "svg"));
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "currentColor");
	svg.setAttribute("role", "img");
	const t = svg.appendChild(document.createElementNS(NS_SVG, "title"));
	t.textContent = titre;
	const path = svg.appendChild(document.createElementNS(NS_SVG, "path"));
	path.setAttribute("d", TRACE_OBSIDIAN);
	return svg;
}
