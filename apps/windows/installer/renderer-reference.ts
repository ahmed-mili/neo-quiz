import { currentLang, setLanguage, t } from "../../../src/i18n";
/* Les MÊMES icônes que l'application : ses glyphes de fenêtre et Lucide via
   `poserIcone`, pour que l'installeur ne dessine rien que l'app ne dessine. */
import { poserIcone } from "../src/host/ui";
import { poserGlyphe } from "../src/ui/glyphes-fenetre";
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
	poserGlyphe(reduire, "minimize");

	const fermer = ajouter(controles, "button", "nqi-window-button nqi-close");
	fermer.type = "button";
	fermer.title = t("installer.close");
	fermer.setAttribute("aria-label", t("installer.close"));
	fermer.disabled = etat.phase === "elevation" || etat.phase === "installation" || etat.phase === "verification";
	fermer.addEventListener("click", () => window.neoInstaller.fermer());
	poserGlyphe(fermer, "close");
}

/* Le décor est une IMAGE (`fond.png`, posée par le CSS de `.nqi-hero`), plus
   les anneaux dessinés en CSS : ils restent dans `style.css` pour comparaison,
   mais ne sont plus montés. */
function rendreHero(parent: HTMLElement): void {
	ajouter(parent, "section", "nqi-hero").setAttribute("aria-hidden", "true");
}

function rendreProgression(parent: HTMLElement, pourcent: number | null): void {
	const piste = ajouter(parent, "div", `nqi-progress${pourcent === null ? " is-indeterminate" : ""}`);
	const barre = ajouter(piste, "div", "nqi-progress-bar");
	if (pourcent !== null) barre.style.width = `${Math.max(0, Math.min(100, pourcent))}%`;
}

function rendreBoutonInstallation(parent: HTMLElement): void {
	const bouton = ajouter(parent, "button", "nqi-primary");
	bouton.type = "button";
	const bouclier = ajouter(bouton, "img", "nqi-primary-shield");
	bouclier.src = "./uac-shield.png";
	bouclier.alt = "";
	bouclier.setAttribute("aria-hidden", "true");
	ajouter(bouton, "span", undefined, t("installer.install"));
	bouton.addEventListener("click", lancerInstallation);
}

function rendreAction(parent: HTMLElement): void {
	if (chargement) {
		ajouter(parent, "p", "nqi-status", t("installer.preparing"));
		rendreProgression(parent, null);
		return;
	}
	if (etat.phase === "erreur") {
		/* Le refus UAC a son propre dialogue bloquant : afficher en plus le
		   bouton de nouvelle tentative derrière lui créerait deux actions
		   concurrentes pour le même état. */
		if (etat.code === "elevation") return;
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
		rendreBoutonInstallation(parent);
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
	ligne.appendChild(document.createTextNode(t("installer.legal.components")));
}

function rendreEmplacement(parent: HTMLElement): void {
	if (!infos) return;
	const emplacement = ajouter(parent, "section", "nqi-location");
	const entete = ajouter(emplacement, "div", "nqi-location-head");
	ajouter(entete, "div", "nqi-location-label", t("installer.location.label"));
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
	ajouter(entete, "div", "nqi-location-space", detail);
	const chemin = ajouter(emplacement, "div", "nqi-path", infos.dossier);
	chemin.title = infos.dossier;
}

function rendreErreurElevation(parent: HTMLElement): void {
	if (etat.phase !== "erreur" || etat.code !== "elevation") return;
	const voile = ajouter(parent, "div", "nqi-elevation-overlay");
	const dialogue = ajouter(voile, "section", "nqi-elevation-dialog");
	dialogue.setAttribute("role", "alertdialog");
	dialogue.setAttribute("aria-modal", "true");
	const titre = ajouter(dialogue, "h2", "nqi-elevation-title", t("installer.elevationDialog.title"));
	titre.id = "nqi-elevation-title";
	dialogue.setAttribute("aria-labelledby", titre.id);
	const message = ajouter(dialogue, "p", "nqi-elevation-copy", t("installer.elevationDialog.body"));
	message.id = "nqi-elevation-copy";
	dialogue.setAttribute("aria-describedby", message.id);
	const annuler = ajouter(dialogue, "button", "nqi-elevation-cancel", t("installer.cancel"));
	annuler.type = "button";
	annuler.autofocus = true;
	annuler.addEventListener("click", () => window.neoInstaller.fermer());
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
	const iconeCommentaires = ajouter(commentaires, "span", "nqi-feedback-icon");
	poserIcone(iconeCommentaires, "message-square-warning");
	ajouter(commentaires, "span", undefined, t("installer.feedback"));
	commentaires.addEventListener("click", () => window.neoInstaller.commentaires());

	const actions = ajouter(panneau, "div", "nqi-actions");
	rendreAction(actions);
	rendreErreurElevation(root);
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

/* La langue vient du PRINCIPAL par l'URL (`main.ts`, `loadFile` avec
   `query.lang`) : nom du fichier téléchargé, référent du navigateur, ou
   locale système — jamais `navigator.language` seul, qui ignorerait la page
   du site d'où l'exe vient. « auto » seulement si l'URL n'en dit rien. */
const langueUrl = new URLSearchParams(window.location.search).get("lang");
setLanguage(langueUrl === "fr" || langueUrl === "en" ? langueUrl : "auto");
window.neoInstaller.surEtat(nouvelEtat => {
	etat = nouvelEtat.phase === "annule" ? { phase: "pret" } : nouvelEtat;
	rendre();
});
void initialiser();
