/* ══════════════════════════════════════════════════════════
   LA MISE À JOUR, VUE DU RENDU

   Un seul abonnement au pont, un état courant, et deux endroits qui le
   montrent : le rail (un bouton, seulement quand il y a quelque chose à
   cliquer) et la section « À propos » des Réglages (l'état complet, le
   bouton « Vérifier maintenant », l'interrupteur). Deux surfaces, une
   source : chacune redessine depuis le MÊME état, elles ne peuvent pas se
   contredire.

   Ce module n'importe rien qui tire Node : `EtatMiseAJour` est un type,
   `pont()` lit `window.neo` à l'appel.
══════════════════════════════════════════════════════════ */

import type { EtatMiseAJour } from "../../electron/pont";
import { pont } from "../host/pont";
import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";

let etat: EtatMiseAJour = { phase: "inactif", auto: true };
const abonnes = new Set<(etat: EtatMiseAJour) => void>();
let desabonnerPont: (() => void) | null = null;

/** Un seul abonnement au pont pour toute la fenêtre, posé au premier appel. */
function garantirAbonnement(): void {
	if (desabonnerPont) return;
	desabonnerPont = pont().miseAJour.surEtat(e => {
		etat = e;
		for (const a of abonnes) a(etat);
	});
	void pont().miseAJour.etat().then(e => {
		etat = e;
		for (const a of abonnes) a(etat);
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

function ligneEtat(e: EtatMiseAJour): string {
	switch (e.phase) {
		case "inactif": return t("app.update.state.inactif");
		case "verification": return t("app.update.state.verification");
		case "a-jour": return t("app.update.state.aJour");
		case "telechargement": return t("app.update.state.telechargement", { version: e.version ?? "", pourcent: e.pourcent ?? 0 });
		case "prete": return t("app.update.state.prete", { version: e.version ?? "" });
		case "erreur": return t("app.update.state.erreur");
	}
}

/** L'état complet dans « À propos » : la ligne, le bouton d'installation
    quand elle est prête, « Vérifier maintenant », l'interrupteur. */
export function monterEtatApropos(section: HTMLElement): () => void {
	const bloc = ajouter(section, "div", "nq-maj-bloc");
	const ligne = ajouter(bloc, "p", "nq-reglages-aide");
	const actions = ajouter(bloc, "div", "nq-reglages-actions");
	const installer = ajouter(actions, "button", "nq-maj-installer", t("app.update.restart"));
	installer.type = "button";
	installer.addEventListener("click", () => { void pont().miseAJour.installer(); });
	const verifier = ajouter(actions, "button", "nq-maj-verifier", t("app.update.checkNow"));
	verifier.type = "button";
	verifier.addEventListener("click", () => { void pont().miseAJour.verifier(); });
	const ligneAuto = ajouter(bloc, "label", "nq-maj-auto");
	const auto = ajouter(ligneAuto, "input");
	auto.type = "checkbox";
	ajouter(ligneAuto, "span", undefined, t("app.update.auto"));
	ajouter(bloc, "p", "nq-reglages-aide", t("app.update.autoHint"));
	auto.addEventListener("change", () => { void pont().miseAJour.reglerAuto(auto.checked); });
	return abonner(e => {
		ligne.textContent = ligneEtat(e);
		installer.hidden = e.phase !== "prete";
		verifier.disabled = e.phase === "verification" || e.phase === "telechargement";
		auto.checked = e.auto;
	});
}
