import { ajouter } from "../dom";
import { currentHost } from "../host/current";
import { Q_TYPES, _setIcon } from "./utils";
import type { QuestionTypeKey } from "./utils";
import { t } from "../i18n";

/* `ParsedQuizItem` a DÉMÉNAGÉ dans `src/types/quiz.ts` : `dashboard/scanner.ts`
   l'importait d'ici, et ce module importait alors Obsidian — le seul
   `import type` suffisait à tirer `obsidian.d.ts` dans le typecheck de
   l'application Windows, qui devenait aveugle aux extensions DOM d'Obsidian
   (`createEl`, `empty`, `setText`…), la seule dépendance à l'hôte qu'aucun
   `import` ne trahit et que `check:host` ne peut donc pas voir. Le déménagement
   tient toujours après la conversion de ce fichier : la ré-exportation ne
   coûte rien et ne casse aucun appelant. */
export type { ParsedQuizItem } from "../types/quiz";

/**
 * Convert HTML to plain text using the DOM, preserving inner text of
 * structural elements like <pre>, <code>, <br> instead of stripping them.
 * This avoids data loss that a regex (/<[^>]+>/g) would cause.
 */
function _htmlToText(html: string): string {
	/* `<template>` et non `<div>` : son document propriétaire est INERTE. Un
	   `<img src=x onerror=…>` venu du HTML d'un quiz partagé se chargeait dans
	   un `<div>` détaché — et déclenchait son gestionnaire — alors qu'on ne
	   voulait qu'en extraire du texte. */
	const temp = document.createElement("template");
	temp.innerHTML = html;
	const racine = temp.content;
	// Convert <br> to newlines before extracting text
	racine.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
	// Convert block-level boundaries to newlines for readability
	racine.querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6").forEach(el => {
		el.insertAdjacentText("beforeend", "\n");
	});
	return racine.textContent || "";
}

/* ════════════════════════════════════════════════════════
   CONFIRM MODAL

   NI `className` NI `title` dans la spec, et c'est délibéré des deux côtés :

   — le PANNEAU n'a jamais porté de classe ; c'est pour ces deux modales que
     `apps/windows/src/assets/modal.css` porte son plancher `min-width`. Lui
     en poser une « pour faire propre » changerait leur largeur ;
   — le titre est un `<h2>` DANS le corps, ciblé par `.qb-confirm-title` et
     `.qb-type-modal h2` (editor-ui-components.css). Le passer en `spec.title`
     l'enverrait dans le `titleEl` de l'hôte, hors du corps — donc hors de
     portée de son CSS.
   ════════════════════════════════════════════════════════ */

/**
 * Le rappel reçoit `confirmed`, et il est appelé À LA FERMETURE — jamais au
 * clic. C'est ce que faisait `onClose()` avant la conversion, et la différence
 * se voit : l'animation de sortie dure jusqu'à 240 ms (`src/modal-base.ts`), et
 * repeindre la liste pendant que le panneau s'efface montrerait la suppression
 * derrière la modale encore à l'écran.
 */
export function openConfirmModal(
	title: string,
	message: string,
	confirmText: string,
	cancelText: string,
	callback: (confirmed: boolean) => void,
): void {
	let confirmed = false;
	currentHost().modals.open({
		onOpen: (m) => {
			const c = m.contentEl;
			c.classList.add("qb-confirm-modal");

			// t() est déjà résolu par l'appelant (au clic, donc au rendu) : ces
			// quatre libellés arrivent en paramètres, jamais d'une constante.
			ajouter(c, "h2", "qb-confirm-title", title);
			ajouter(c, "p", "qb-confirm-message", message);

			const btnRow = ajouter(c, "div", "qb-confirm-buttons");

			const cancelBtn = ajouter(btnRow, "button", "qb-btn", cancelText);
			cancelBtn.addEventListener("click", () => {
				confirmed = false;
				m.close();
			});

			const confirmBtn = ajouter(btnRow, "button", "qb-btn qb-btn-danger", confirmText);
			confirmBtn.addEventListener("click", () => {
				confirmed = true;
				m.close();
			});
		},
		/* Pas de `contentEl.empty()` ici : l'hôte vide le corps lui-même après
		   la disparition (le contrat de `HostModalHandle` le promet). */
		onClose: () => callback(confirmed),
	});
}

/* ════════════════════════════════════════════════════════
   TYPE PICKER MODAL
   ════════════════════════════════════════════════════════ */
export function openTypePickerModal(onPick: (key: QuestionTypeKey) => void): void {
	currentHost().modals.open({
		onOpen: (m) => {
			const c = m.contentEl;
			c.classList.add("qb-type-modal");
			// t() AU RENDU (à l'ouverture de la modale), jamais dans une constante
			// de haut niveau : une chaîne figée au chargement ignorerait un
			// changement de langue.
			ajouter(c, "h2", undefined, t("editor.typeModal.title"));
			ajouter(c, "p", "qb-type-modal-sub", t("editor.typeModal.subtitle"));

			const grid = ajouter(c, "div", "qb-type-grid");
			// `qt` et non `t` : la variable de boucle masquerait la fonction t().
			// label/desc sont des getters (utils.ts) — lus ici, donc au rendu.
			for (const qt of Q_TYPES) {
				const card = ajouter(grid, "div", "qb-type-card");
				const cardIcon = ajouter(card, "div", "qb-type-card-icon"); _setIcon(cardIcon, qt.lucide);
				const text = ajouter(card, "div");
				ajouter(text, "div", "qb-type-card-name", qt.label);
				ajouter(text, "div", "qb-type-card-desc", qt.desc);
				card.addEventListener("click", () => { onPick(qt.key); m.close(); });
			}
		},
	});
}

export { _htmlToText };
