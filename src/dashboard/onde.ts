/* ══════════════════════════════════════════════════════════
   L'ONDE SOUS LE DOIGT

   Un cercle nait AU POINT DE CLIC et s'etale jusqu'a couvrir le bouton. Le
   ripple d'Android, choisi a l'ecran le 2026-09-20 parmi huit effets (avec
   l'enfoncement elastique du CSS, variante « Vif »). C'est le seul effet de
   la liste qui dit OU l'on a appuye, et la seule raison pour laquelle il
   demande du JavaScript : le point de depart n'existe pas en CSS.

   PAS DE NETTOYAGE A PREVOIR : l'ecouteur vit sur le bouton et meurt avec
   lui, et chaque cercle se retire lui-meme a la fin de son animation. Rien
   a desabonner, donc rien a oublier.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";

/** Pose l'onde sur un bouton. Le cercle est dimensionne pour couvrir le
    bouton DEPUIS LE POINT D'APPUI (le coin le plus eloigne donne le rayon),
    sinon un clic pres d'un bord laisserait un croissant sans peinture. */
export function poserOnde(bouton: HTMLElement): void {
	bouton.addEventListener("pointerdown", (e: PointerEvent) => {
		const r = bouton.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return;
		const x = e.clientX - r.left;
		const y = e.clientY - r.top;
		const rayon = Math.max(
			Math.hypot(x, y),
			Math.hypot(r.width - x, y),
			Math.hypot(x, r.height - y),
			Math.hypot(r.width - x, r.height - y)
		);
		const onde = ajouter(bouton, "span", "qbd-onde");
		onde.style.width = onde.style.height = rayon * 2 + "px";
		onde.style.left = (x - rayon) + "px";
		onde.style.top = (y - rayon) + "px";
		onde.addEventListener("animationend", () => onde.remove());
	});
}
