import { currentLang, setLanguage, t } from "../../../src/i18n";
import type {
	CodeErreurInstallateur,
	EtatInstallateur,
	InfosDisqueInstallateur,
	InfosInitialesInstallateur,
} from "./protocole";

/* Cette vue suit la maquette d'installation, mais reste reconstruite depuis
   l'état pour qu'un refus UAC ou une nouvelle tentative ne laisse aucun état
   visuel périmé. */
let infos: InfosInitialesInstallateur | null = null;
let disque: InfosDisqueInstallateur | null = null;
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

function rendreHero(parent: HTMLElement): void {
	const hero = ajouter(parent, "section", "nqi-hero");
	ajouter(hero, "div", "nqi-glow").setAttribute("aria-hidden", "true");
	const scene = ajouter(hero, "div", "nqi-scene");
	ajouter(scene, "div", "nqi-card nqi-card-back").setAttribute("aria-hidden", "true");
	ajouter(scene, "div", "nqi-card nqi-card-front").setAttribute("aria-hidden", "true");
	ajouter(hero, "p", "nqi-hero-copy", t("installer.hero"));
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
		const bouton = ajouter(parent, "button", "nqi-primary nqi-primary-plain", t("installer.retry"));
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
		case "elevation": statut = t("installer.status.elevation"); break;
		case "telechargement":
			pourcent = etat.total > 0 ? Math.round((etat.recus / etat.total) * 100) : 0;
			statut = t("installer.status.downloading", { percent: pourcent });
			break;
		case "verification": statut = t("installer.status.verifying"); break;
		case "installation": statut = t("installer.status.installing"); break;
		default: statut = t("installer.preparing");
	}
	ajouter(parent, "p", "nqi-status", statut);
	rendreProgression(parent, pourcent);
	if (etat.phase === "telechargement") {
		const annuler = ajouter(parent, "button", "nqi-secondary", t("installer.cancel"));
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

function rendreEmplacement(parent: HTMLElement): void {
	if (!infos) return;
	const emplacement = ajouter(parent, "section", "nqi-location");
	ajouter(emplacement, "div", "nqi-location-label", t("installer.location.label"));
	const detail = disque
		? t("installer.location.space", {
			available: formatOctets(disque.espaceDisponible),
			total: formatOctets(disque.espaceTotal),
			download: formatOctets(infos.tailleTelechargement),
		})
		: t("installer.location.spaceFallback", {
			available: formatOctets(infos.espaceDisponible),
			download: formatOctets(infos.tailleTelechargement),
		});
	ajouter(emplacement, "div", "nqi-location-space", detail);
	const chemin = ajouter(emplacement, "div", "nqi-path", infos.dossier);
	chemin.title = infos.dossier;
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
	rendreEmplacement(panneau);
	rendreLegal(panneau);

	const commentaires = ajouter(panneau, "button", "nqi-feedback");
	commentaires.type = "button";
	ajouter(commentaires, "span", "nqi-feedback-icon").setAttribute("aria-hidden", "true");
	ajouter(commentaires, "span", undefined, t("installer.feedback"));
	commentaires.addEventListener("click", () => window.neoInstaller.commentaires());

	const actions = ajouter(panneau, "div", "nqi-actions");
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
	infos = null;
	disque = null;
	rendre();
	try {
		infos = await window.neoInstaller.initialiser();
		try {
			disque = await window.neoInstaller.espaceDisque(infos.dossier);
		} catch {
			disque = null;
		}
		etat = { phase: "pret" };
	} catch {
		infos = null;
		disque = null;
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
