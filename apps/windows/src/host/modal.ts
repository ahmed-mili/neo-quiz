/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — LES MODALES

   Obsidian fournissait `Modal` ; la fenêtre de l'application n'a rien. La
   structure DOM reproduite ici est CELLE D'OBSIDIAN, nom de classe par nom de
   classe, parce que le CSS PARTAGÉ la cible : `modal-anim.css` anime
   `.modal.qbd-anim-modal` et `.modal-container … .modal-bg`, et les modales du
   greffon calent leur largeur sur `.qbd-medit-modal`, `.qbd-create-modal`,
   `.qbd-share-modal`. Inventer d'autres noms ici obligerait à dédoubler tout
   ce CSS.

   Ce module n'importe AUCUN CSS : l'apparence vit dans
   `apps/windows/src/assets/modal.css`, importé par `main.ts`. Même raison que
   `ui.ts` — le harnais de `npm run check:windows-host` charge les modules
   d'hôte avec esbuild, et un import de CSS y tire les fontes MathLive, pour
   lesquelles aucun chargeur n'est configuré : le module deviendrait
   inchargeable, donc invérifiable.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../../../../src/dom";
import { t } from "../../../../src/i18n";
import type { HostModalHandle, HostModals, HostModalSpec } from "../../../../src/host/types";
import { poserIcone } from "./ui";

/** Le filet de sécurité de la disparition, en ms. MÊME valeur que
    `src/modal-base.ts`, et pour la même raison : une animation coupée ou un
    onglet masqué ne déclenche jamais `animationend`, et le panneau ne se
    détacherait plus jamais. Doit rester ≥ la durée de `qbd-modal-out`
    (0,16 s, `components/modal-anim.css`). */
const SORTIE_MS = 240;

/** Numérote les titres pour que `aria-labelledby` désigne le BON : deux
    modales peuvent être ouvertes en même temps (une confirmation par-dessus
    un formulaire), et un identifiant fixe les ferait toutes pointer sur le
    premier titre posé. */
let compteurTitres = 0;

function ouvrir(spec: HostModalSpec): HostModalHandle {
	/* Mémorisé AVANT tout attachement : une fois le panneau posé, le focus a
	   déjà pu bouger, et on ne saurait plus à quoi le rendre. Test de canard
	   plutôt qu'`instanceof HTMLElement` : le harnais de vérification n'a pas
	   ce global, et une exception ici empêcherait toute modale de s'ouvrir. */
	const actif = document.activeElement as HTMLElement | null;
	const rendreFocusA = actif && typeof actif.focus === "function" ? actif : null;

	const conteneur = document.body.appendChild(document.createElement("div"));
	conteneur.className = "modal-container";
	const fond = ajouter(conteneur, "div", "modal-bg");
	/* `qbd-anim-modal` DÈS la création : c'est cette classe qui porte
	   l'animation d'entrée du CSS partagé, et l'ajouter plus tard la ferait
	   rejouer après coup. `spec.className` par-dessus, jamais à la place. */
	const panneau = ajouter(conteneur, "div", "modal qbd-anim-modal");
	if (spec.className) panneau.classList.add(spec.className);
	panneau.setAttribute("role", "dialog");
	panneau.setAttribute("aria-modal", "true");

	const fermeture = ajouter(panneau, "button", "modal-close-button");
	fermeture.type = "button";
	/* Un bouton dont le seul contenu est une icône n'a AUCUN nom accessible.
	   `engine.hint.close` existe déjà et vaut exactement « Close » / « Fermer »
	   — cette tranche ne crée aucune clé. `t()` est appelé ICI, à l'ouverture,
	   et non dans une constante de module : sinon le libellé serait figé à la
	   langue du démarrage. */
	fermeture.setAttribute("aria-label", t("engine.hint.close"));
	poserIcone(fermeture, "x");

	const titre = ajouter(panneau, "div", "modal-title", spec.title);
	titre.id = `nq-modal-title-${++compteurTitres}`;
	panneau.setAttribute("aria-labelledby", titre.id);
	const corps = ajouter(panneau, "div", "modal-content");

	/* DEUX gardes, pas une. `ferme` empêche Échap et le clic sur le fond de
	   lancer deux disparitions (ils peuvent tomber quasi ensemble — même
	   constat que `src/modal-base.ts`) ; `detache` empêche `animationend` et
	   le filet de sécurité de détacher deux fois, donc d'appeler `onClose`
	   deux fois. */
	let ferme = false;
	let detache = false;

	function surTouche(e: KeyboardEvent): void {
		if (e.key === "Escape") {
			e.preventDefault();
			fermer();
		}
	}

	function detacher(): void {
		if (detache) return;
		detache = true;
		/* L'écouteur part AVEC le panneau : sans ça, chaque modale ouverte
		   laisserait derrière elle un Échap qui ne ferme plus rien. */
		document.removeEventListener("keydown", surTouche);
		conteneur.remove();
		rendreFocusA?.focus();
		/* APRÈS le détachement, comme sous Obsidian (`Modal.close()` détache
		   puis appelle `onClose()`) : `module-edit.ts` y écrit ses changements
		   sur le disque, et le faire pendant l'animation rendrait l'écriture
		   concurrente d'un rendu. Le corps est vidé APRÈS, pas avant :
		   l'appelant a le droit d'y relire un champ une dernière fois. */
		spec.onClose?.();
		corps.replaceChildren();
	}

	function fermer(): void {
		if (ferme) return;
		ferme = true;
		/* `prefers-reduced-motion` : détachement immédiat, sans animation —
		   sinon on attendrait 240 ms un `animationend` que le CSS partagé
		   vient justement de désactiver. */
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			detacher();
			return;
		}
		panneau.classList.add("qbd-closing");
		conteneur.classList.add("qbd-closing"); // le fond .modal-bg suit
		panneau.addEventListener("animationend", (e: AnimationEvent) => {
			if (e.target === panneau) detacher();
		});
		window.setTimeout(detacher, SORTIE_MS);
	}

	document.addEventListener("keydown", surTouche);
	fond.addEventListener("click", () => fermer());
	fermeture.addEventListener("click", () => fermer());

	const poignee: HostModalHandle = {
		panelEl: panneau,
		contentEl: corps,
		setTitle: (texte) => { titre.textContent = texte; },
		close: fermer,
	};
	/* Le contenu est construit APRÈS attachement : un appelant qui mesure un
	   élément (le sélecteur d'icônes lit un `getBoundingClientRect`) ne
	   mesurerait que des zéros sur un panneau détaché. */
	spec.onOpen(poignee);
	return poignee;
}

export function createWindowsModals(): HostModals {
	return { open: ouvrir };
}
