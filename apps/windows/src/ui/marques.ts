/* ══════════════════════════════════════════════════════════
   LES LOGOS DE MARQUE

   Séparés de Lucide, et ce n'est pas un rangement : Lucide est une
   bibliothèque d'icônes d'INTERFACE (dossier, flèche, croix), dessinées pour
   se ressembler entre elles. Un logo de marque obéit à l'inverse — il doit
   rester reconnaissable, dans son tracé et sa couleur, parce que c'est
   précisément ce qu'il transporte comme information : « ceci est un vault
   Obsidian », et non « ceci est un dossier ».

   Y mêler un logo reviendrait à le redessiner au trait de Lucide, où il
   cesserait d'être identifiable.

   Source : Simple Icons (SVG sous CC0). La MARQUE reste celle d'Obsidian ;
   l'usage est ici descriptif — désigner les vaults de l'utilisateur — ce qui
   est exactement ce à quoi un logo sert.
══════════════════════════════════════════════════════════ */

/** Tracé officiel du logo Obsidian, sur une grille 24×24. */
const OBSIDIAN_PATH =
	"M19.355 18.538a68.967 68.959 0 0 0 1.858-2.954.81.81 0 0 0-.062-.9c-.516-.685-1.504-2.075-2.042-3.362-.553-1.321-.636-3.375-.64-4.377a1.707 1.707 0 0 0-.358-1.05l-3.198-4.064a3.744 3.744 0 0 1-.076.543c-.106.503-.307 1.004-.536 1.5-.134.29-.29.6-.446.914l-.31.626c-.516 1.068-.997 2.227-1.132 3.59-.124 1.26.046 2.73.815 4.481.128.011.257.025.386.044a6.363 6.363 0 0 1 3.326 1.505c.916.79 1.744 1.922 2.415 3.5zM8.199 22.569c.073.012.146.02.22.02.78.024 2.095.092 3.16.29.87.16 2.593.64 4.01 1.055 1.083.316 2.198-.548 2.355-1.664.114-.814.33-1.735.725-2.58l-.01.005c-.67-1.87-1.522-3.078-2.416-3.849a5.295 5.295 0 0 0-2.778-1.257c-1.54-.216-2.952.19-3.84.45.532 2.218.368 4.829-1.425 7.531zM5.533 9.938c-.023.1-.056.197-.098.29L2.82 16.059a1.602 1.602 0 0 0 .313 1.772l4.116 4.24c2.103-3.101 1.796-6.02.836-8.3-.728-1.73-1.832-3.081-2.55-3.831zM9.32 14.01c.615-.183 1.606-.465 2.745-.534-.683-1.725-.848-3.233-.716-4.577.154-1.552.7-2.847 1.235-3.95.113-.235.223-.454.328-.664.149-.297.288-.577.419-.86.217-.47.379-.885.46-1.27.08-.38.08-.72-.014-1.043-.095-.325-.297-.675-.68-1.06a1.6 1.6 0 0 0-1.475.36l-4.95 4.452a1.602 1.602 0 0 0-.513.952l-.427 2.83c.672.59 2.328 2.316 3.335 4.711.09.21.175.43.253.653z";

/**
 * Pose le logo Obsidian dans l'élément, en remplaçant son contenu.
 *
 * `currentColor` et non la couleur de marque en dur : c'est le CSS qui décide,
 * lui seul sachant sur quel fond le logo se pose. Le violet officiel vit donc
 * dans `shell.css`, à côté des autres choix de couleur, et pas ici.
 */
export function poserLogoObsidian(el: HTMLElement | null): void {
	if (!el) return;
	el.replaceChildren();
	const NS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("xmlns", NS);
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("width", "24");
	svg.setAttribute("height", "24");
	// `fill` et non `stroke` : un logo est une forme PLEINE, là où les
	// icônes Lucide sont des traits. Les dimensionner pareil ne suffit pas à
	// les faire cohabiter — c'est leur nature qui diffère.
	svg.setAttribute("fill", "currentColor");
	svg.setAttribute("class", "svg-icon nq-logo-obsidian");
	const chemin = document.createElementNS(NS, "path");
	chemin.setAttribute("d", OBSIDIAN_PATH);
	svg.appendChild(chemin);
	el.appendChild(svg);
}
