import { currentLang, setLanguage, t } from "../../../src/i18n";
import type { CodeErreurInstallateur, EtatInstallateur, InfosInitialesInstallateur } from "./protocole";

/* La fenêtre est reconstruite depuis l'état plutôt que mutée par étapes : un
   refus UAC, une annulation puis une seconde tentative repassent ainsi par le
   même rendu que le premier essai et ne laissent pas de bouton ou de texte
   périmé à l'écran. */

let infos: InfosInitialesInstallateur | null = null;
let etat: EtatInstallateur = { phase: "pret" };
let chargement = true;

function ajouter<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	classe?: string,
	texte?: string,
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (classe) element.className = classe;
	if (texte !== undefined) element.textContent = texte;
	parent.appendChild(element);
	return element;
}

function formatOctets(octets: number): string {
	const langue = currentLang() === "fr" ? "fr-FR" : "en-US";
	const giga = octets >= 1_000_000_000;
	return new Intl.NumberFormat(langue, {
		style: "unit",
		unit: giga ? "gigabyte" : "megabyte",
		unitDisplay: "short",
		maximumFractionDigits: 1,
	}).format(octets / (giga ? 1_000_000_000 : 1_000_000));
}

function libelleErreur(code: CodeErreurInstallateur): string {
	switch (code) {
		case "release": return t("installer.error.release");
		case "network": return t("installer.error.network");
		case "elevation": return t("installer.error.elevation");
		case "integrity": return t("installer.error.integrity");
		case "installation": return t("installer.error.installation");
		case "launch": return t("installer.error.launch");
		default: return t("installer.error.generic");
	}
}

function rendreBarreTitre(parent: HTMLElement): void {
	const barre = ajouter(parent, "div", "nqi-titlebar");
	const marque = ajouter(barre, "div", "nqi-titlebar-brand");
	const icone = ajouter(marque, "img", "nqi-titlebar-icon");
	icone.src = "./icon.png";
	icone.alt = t("installer.logoAlt");
	ajouter(marque, "span", "nqi-titlebar-text", t("installer.windowTitle"));
	const fermer = ajouter(barre, "button", "nqi-close");
	fermer.type = "button";
	fermer.title = t("installer.close");
	fermer.setAttribute("aria-label", t("installer.close"));
	fermer.disabled = etat.phase === "elevation" || etat.phase === "installation" || etat.phase === "verification";
	fermer.addEventListener("click", () => window.neoInstaller.fermer());
	ajouter(fermer, "span", "nqi-close-glyph").setAttribute("aria-hidden", "true");
}

function rendreHero(parent: HTMLElement): void {
	const hero = ajouter(parent, "section", "nqi-hero");
	ajouter(hero, "div", "nqi-glow").setAttribute("aria-hidden", "true");
	const scene = ajouter(hero, "div", "nqi-scene");
	const carteArriere = ajouter(scene, "div", "nqi-card nqi-card-back");
	carteArriere.setAttribute("aria-hidden", "true");
	const carteAvant = ajouter(scene, "div", "nqi-card nqi-card-front");
	carteAvant.setAttribute("aria-hidden", "true");
	for (let i = 0; i < 4; i++) ajouter(carteAvant, "span", "nqi-card-line");
	const logo = ajouter(scene, "img", "nqi-hero-icon");
	logo.src = "./icon.png";
	logo.alt = t("installer.logoAlt");
	ajouter(hero, "p", "nqi-hero-copy", t("installer.hero"));
}

function rendreMetrique(parent: HTMLElement, libelle: string, valeur: string): void {
	const bloc = ajouter(parent, "div", "nqi-metric");
	ajouter(bloc, "span", "nqi-metric-label", libelle);
	ajouter(bloc, "strong", "nqi-metric-value", valeur);
}

function rendreProgression(parent: HTMLElement, pourcent: number | null): void {
	const piste = ajouter(parent, "div", `nqi-progress${pourcent === null ? " is-indeterminate" : ""}`);
	const barre = ajouter(piste, "div", "nqi-progress-bar");
	if (pourcent !== null) barre.style.width = `${Math.max(0, Math.min(100, pourcent))}%`;
}

function rendreAction(parent: HTMLElement): void {
	if (chargement) {
		ajouter(parent, "p", "nqi-status", t("installer.preparing"));
		rendreProgression(parent, null);
		return;
	}

	if (etat.phase === "erreur") {
		ajouter(parent, "p", "nqi-error", libelleErreur(etat.code));
		const bouton = ajouter(parent, "button", "nqi-primary", t("installer.retry"));
		bouton.type = "button";
		bouton.addEventListener("click", () => {
			if (infos) lancerInstallation();
			else void initialiser();
		});
		return;
	}

	if (!infos) return;
	if (etat.phase === "pret" || etat.phase === "annule") {
		const bouton = ajouter(parent, "button", "nqi-primary", t("installer.install"));
		bouton.type = "button";
		bouton.addEventListener("click", lancerInstallation);
		return;
	}

	let statut: string;
	let pourcent: number | null = null;
	switch (etat.phase) {
		case "elevation":
			statut = t("installer.status.elevation");
			break;
		case "telechargement": {
			pourcent = etat.total > 0 ? Math.round((etat.recus / etat.total) * 100) : 0;
			statut = t("installer.status.downloading", { percent: pourcent });
			break;
		}
		case "verification":
			statut = t("installer.status.verifying");
			break;
		case "installation":
			statut = t("installer.status.installing");
			break;
		default:
			statut = t("installer.preparing");
	}
	ajouter(parent, "p", "nqi-status", statut);
	rendreProgression(parent, pourcent);
	if (etat.phase === "telechargement") {
		const annuler = ajouter(parent, "button", "nqi-secondary", t("installer.cancel"));
		annuler.type = "button";
		annuler.addEventListener("click", () => { void window.neoInstaller.annuler(); });
	}
}

function rendre(): void {
	document.documentElement.lang = currentLang();
	document.title = t("installer.windowTitle");
	const root = document.getElementById("app");
	if (!root) return;
	root.replaceChildren();
	rendreBarreTitre(root);

	const contenu = ajouter(root, "main", "nqi-shell");
	rendreHero(contenu);
	const panneau = ajouter(contenu, "section", "nqi-panel");
	ajouter(panneau, "h1", "nqi-title", t("installer.title"));
	if (infos) ajouter(panneau, "p", "nqi-version", t("installer.version", { version: infos.version }));

	if (infos) {
		const emplacement = ajouter(panneau, "div", "nqi-location");
		const ligne = ajouter(emplacement, "div", "nqi-location-head");
		ajouter(ligne, "span", "nqi-location-label", t("installer.location.label"));
		const modifier = ajouter(ligne, "button", "nqi-link", t("installer.location.change"));
		modifier.type = "button";
		modifier.disabled = etat.phase !== "pret" && etat.phase !== "annule" && etat.phase !== "erreur";
		modifier.addEventListener("click", () => { void choisirDossier(); });
		const chemin = ajouter(emplacement, "div", "nqi-path", infos.dossier);
		chemin.title = infos.dossier;

		const metriques = ajouter(panneau, "div", "nqi-metrics");
		rendreMetrique(metriques, t("installer.downloadSize"), formatOctets(infos.tailleTelechargement));
		rendreMetrique(metriques, t("installer.availableSpace"), formatOctets(infos.espaceDisponible));
	}

	const actions = ajouter(panneau, "div", "nqi-actions");
	rendreAction(actions);
}

async function choisirDossier(): Promise<void> {
	if (!infos) return;
	try {
		const choix = await window.neoInstaller.choisirDossier(infos.dossier);
		if (!choix) return;
		infos = { ...infos, dossier: choix.dossier, espaceDisponible: choix.espaceDisponible };
		rendre();
	} catch {
		etat = { phase: "erreur", code: "generic" };
		rendre();
	}
}

function lancerInstallation(): void {
	if (!infos) return;
	etat = { phase: "elevation" };
	rendre();
	void window.neoInstaller.installer(infos.dossier).catch(() => {
		etat = { phase: "erreur", code: "generic" };
		rendre();
	});
}

async function initialiser(): Promise<void> {
	chargement = true;
	etat = { phase: "pret" };
	rendre();
	try {
		infos = await window.neoInstaller.initialiser();
		etat = { phase: "pret" };
	} catch {
		infos = null;
		etat = { phase: "erreur", code: "release" };
	} finally {
		chargement = false;
		rendre();
	}
}

setLanguage("auto");
window.neoInstaller.surEtat(nouvelEtat => {
	etat = nouvelEtat.phase === "annule" ? { phase: "pret" } : nouvelEtat;
	rendre();
});
void initialiser();
