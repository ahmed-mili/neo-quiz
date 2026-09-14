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
	let diviseur = 1_000_000;
	let unite = "megabyte";
	if (octets >= 1_000_000_000_000) {
		diviseur = 1_000_000_000_000;
		unite = "terabyte";
	} else if (octets >= 1_000_000_000) {
		diviseur = 1_000_000_000;
		unite = "gigabyte";
	}
	return new Intl.NumberFormat(langue, {
		style: "unit",
		unit: unite,
		unitDisplay: "short",
		maximumFractionDigits: 1,
	}).format(octets / diviseur);
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

	const controles = ajouter(barre, "div", "nqi-window-controls");
	const reduire = ajouter(controles, "button", "nqi-window-button nqi-minimize");
	reduire.type = "button";
	reduire.title = t("installer.minimize");
	reduire.setAttribute("aria-label", t("installer.minimize"));
	reduire.addEventListener("click", () => window.neoInstaller.reduire());
	ajouter(reduire, "span", "nqi-minimize-glyph").setAttribute("aria-hidden", "true");

	const fermer = ajouter(controles, "button", "nqi-window-button nqi-close");
	fermer.type = "button";
	fermer.title = t("installer.close");
	fermer.setAttribute("aria-label", t("installer.close"));
	fermer.disabled = etat.phase === "elevation" || etat.phase === "installation" || etat.phase === "verification";
	fermer.addEventListener("click", () => window.neoInstaller.fermer());
	ajouter(fermer, "span", "nqi-close-glyph").setAttribute("aria-hidden", "true");
}

function rendreArt(parent: HTMLElement): void {
	const art = ajouter(parent, "div", "nqi-art");
	art.setAttribute("aria-hidden", "true");
	for (let i = 0; i < 5; i++) ajouter(art, "span", `nqi-orbit nqi-orbit-${i + 1}`);
}

function rendreProgression(parent: HTMLElement, pourcent: number | null): void {
	const piste = ajouter(parent, "div", `nqi-progress${pourcent === null ? " is-indeterminate" : ""}`);
	const barre = ajouter(piste, "div", "nqi-progress-bar");
	if (pourcent !== null) barre.style.width = `${Math.max(0, Math.min(100, pourcent))}%`;
}

function rendreBoutonInstaller(parent: HTMLElement): void {
	const bouton = ajouter(parent, "button", "nqi-primary");
	bouton.type = "button";
	const bouclier = ajouter(bouton, "span", "nqi-shield");
	bouclier.setAttribute("aria-hidden", "true");
	ajouter(bouton, "span", "nqi-primary-label", t("installer.install"));
	bouton.addEventListener("click", lancerInstallation);
}

function rendreAction(parent: HTMLElement): void {
	if (chargement) {
		const bloc = ajouter(parent, "div", "nqi-action-stack");
		ajouter(bloc, "p", "nqi-status", t("installer.preparing"));
		rendreProgression(bloc, null);
		return;
	}

	if (etat.phase === "erreur") {
		const bloc = ajouter(parent, "div", "nqi-action-stack");
		ajouter(bloc, "p", "nqi-error", libelleErreur(etat.code));
		const bouton = ajouter(bloc, "button", "nqi-secondary", t("installer.retry"));
		bouton.type = "button";
		bouton.addEventListener("click", () => {
			if (infos) lancerInstallation();
			else void initialiser();
		});
		return;
	}

	if (!infos) return;
	if (etat.phase === "pret" || etat.phase === "annule") {
		rendreBoutonInstaller(parent);
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
	const bloc = ajouter(parent, "div", "nqi-action-stack");
	ajouter(bloc, "p", "nqi-status", statut);
	rendreProgression(bloc, pourcent);
	if (etat.phase === "telechargement") {
		const annuler = ajouter(bloc, "button", "nqi-secondary", t("installer.cancel"));
		annuler.type = "button";
		annuler.addEventListener("click", () => { void window.neoInstaller.annuler(); });
	}
}

function rendreLegal(parent: HTMLElement): void {
	const legal = ajouter(parent, "div", "nqi-legal");
	const ligne = ajouter(legal, "p", "nqi-legal-copy");
	ligne.appendChild(document.createTextNode(t("installer.legal.beforeTerms")));
	ajouter(ligne, "span", "nqi-legal-link", t("installer.legal.terms"));
	ligne.appendChild(document.createTextNode(t("installer.legal.between")));
	ajouter(ligne, "span", "nqi-legal-link", t("installer.legal.privacy"));
	ligne.appendChild(document.createTextNode(t("installer.legal.afterPrivacy")));
	ajouter(legal, "p", "nqi-legal-copy", t("installer.legal.components"));
}

function rendre(): void {
	document.documentElement.lang = currentLang();
	document.title = t("installer.windowTitle");
	const root = document.getElementById("app");
	if (!root) return;
	root.replaceChildren();

	const cadre = ajouter(root, "div", "nqi-frame");
	rendreBarreTitre(cadre);
	const contenu = ajouter(cadre, "main", "nqi-shell");
	rendreArt(contenu);

	const intro = ajouter(contenu, "section", "nqi-intro");
	ajouter(intro, "h1", "nqi-title", t("installer.title"));
	ajouter(intro, "p", "nqi-hero-copy", t("installer.hero"));

	if (infos) {
		const emplacement = ajouter(contenu, "section", "nqi-location");
		ajouter(emplacement, "div", "nqi-location-label", t("installer.location.label"));
		ajouter(emplacement, "div", "nqi-location-space", t("installer.location.space", {
			available: formatOctets(infos.espaceDisponible),
			total: formatOctets(infos.espaceTotal),
			required: formatOctets(infos.tailleTelechargement),
		}));
		const chemin = ajouter(emplacement, "div", "nqi-path", infos.dossier);
		chemin.title = infos.dossier;
	}

	rendreLegal(contenu);
	const pied = ajouter(contenu, "footer", "nqi-footer");
	const commentaires = ajouter(pied, "button", "nqi-feedback");
	commentaires.type = "button";
	ajouter(commentaires, "span", "nqi-feedback-icon").setAttribute("aria-hidden", "true");
	ajouter(commentaires, "span", undefined, t("installer.feedback"));
	commentaires.addEventListener("click", () => window.neoInstaller.commentaires());

	const actions = ajouter(pied, "div", "nqi-actions");
	rendreAction(actions);
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
