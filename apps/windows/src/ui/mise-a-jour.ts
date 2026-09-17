/* ══════════════════════════════════════════════════════════
   LA MISE À JOUR, VUE DU RENDU

   Un seul abonnement au pont, un état courant, et UN endroit qui le montre :
   le rail, où un bouton apparaît quand une version est prête à installer.
   Les Réglages en montraient un second — l'état complet, « Vérifier
   maintenant », l'interrupteur automatique — ; la section est partie le
   2026-09-17 avec le réglage lui-même (la mise à jour est toujours active) et
   le bouton de vérification, que le menu d'application porte déjà.

   Ce module n'importe rien qui tire Node : `EtatMiseAJour` est un type,
   `pont()` lit `window.neo` à l'appel.
══════════════════════════════════════════════════════════ */

import type { EtatMiseAJour } from "../../electron/pont";
import { pont } from "../host/pont";
import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";

let etat: EtatMiseAJour = { phase: "inactif" };
const abonnes = new Set<(etat: EtatMiseAJour) => void>();
let desabonnerPont: (() => void) | null = null;
let pousse = false;

/** Un seul abonnement au pont pour toute la fenêtre, posé au premier appel. */
function garantirAbonnement(): void {
	if (desabonnerPont) return;
	desabonnerPont = pont().miseAJour.surEtat(e => {
		pousse = true;
		etat = e;
		for (const a of abonnes) a(etat);
	});
	// La lecture initiale rattrape l'état d'AVANT l'abonnement ; si un état a
	// été poussé pendant l'aller-retour, il est plus récent que cette réponse
	// et gagne, sinon une mise à jour prête disparaîtrait jusqu'au prochain événement.
	void pont().miseAJour.etat().then(e => {
		if (!pousse) {
			etat = e;
			for (const a of abonnes) a(etat);
		}
	});
}

function abonner(rappel: (etat: EtatMiseAJour) => void): () => void {
	garantirAbonnement();
	abonnes.add(rappel);
	rappel(etat);
	return () => { abonnes.delete(rappel); };
}

/** Le bouton du rail : n'existe que lorsque la mise à jour est PRÊTE. Un
    badge pendant le téléchargement n'aurait rien à cliquer. */
export function monterBoutonRail(navEl: HTMLElement): () => void {
	const footer = navEl.querySelector<HTMLElement>(".qbd-nav-footer");
	if (!footer) return () => {};
	let bouton: HTMLButtonElement | null = null;
	return abonner(e => {
		if (e.phase === "prete" && !bouton) {
			bouton = document.createElement("button");
			bouton.type = "button";
			bouton.className = "qbd-nav-item nq-maj-bouton";
			currentHost().ui.setIcon(ajouter(bouton, "span", "qbd-nav-icon"), "refresh-cw");
			ajouter(bouton, "span", "qbd-nav-label", t("app.update.restart"));
			bouton.addEventListener("click", () => { void pont().miseAJour.installer(); });
			footer.prepend(bouton);
		} else if (e.phase !== "prete" && bouton) {
			bouton.remove();
			bouton = null;
		}
	});
}
