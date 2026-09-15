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

/* La page PRÊTE reste celle déjà validée à l'écran. Les autres phases ont leur
   propre composition : on ne déplace donc aucun élément de l'étape 2 pour
   obtenir les étapes 1, 3, 4 et 5. */
let infos: InfosInitialesInstallateur | null = null;
let disque: InfosDisqueInstallateur | null = null;
let etat: EtatInstallateur = { phase: "pret" };
let chargement = true;
let echantillonTelechargement: { recus: number; instant: number } | null = null;
let debitTelechargement: number | null = null;
let confirmationAnnulation = false;
let annulationDemandee = false;

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

function formatPourcent(pourcent: number): string {
	return new Intl.NumberFormat(currentLang() === "fr" ? "fr-FR" : "en-US", {
		maximumFractionDigits: 1,
	}).format(Math.max(0, Math.min(100, pourcent)));
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

function phaseInstallationActive(): boolean {
	return etat.phase === "elevation" || etat.phase === "telechargement" ||
		etat.phase === "verification" || etat.phase === "installation";
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
	fermer.addEventListener("click", () => {
		if (phaseInstallationActive()) ouvrirConfirmationAnnulation();
		else window.neoInstaller.fermer();
	});
	poserGlyphe(fermer, "close");
}

/* Le décor est une IMAGE (`fond.png`, posée par le CSS de `.nqi-hero`), plus
   les anneaux dessinés en CSS : ils restent dans `style.css` pour comparaison,
   mais ne sont plus montés. */
function rendreHero(parent: HTMLElement): void {
	ajouter(parent, "section", "nqi-hero").setAttribute("aria-hidden", "true");
}

function rendreProgression(parent: HTMLElement, pourcent: number | null, classe = ""): void {
	const piste = ajouter(parent, "div", `nqi-progress${pourcent === null ? " is-indeterminate" : ""}${classe ? ` ${classe}` : ""}`);
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
	if (etat.phase === "elevation") {
		ajouter(parent, "p", "nqi-status", t("installer.status.elevation"));
		rendreProgression(parent, null);
	}
}

function rendreLegal(parent: HTMLElement, classe = ""): void {
	const legal = ajouter(parent, "div", `nqi-legal${classe ? ` ${classe}` : ""}`);
	const ligne = ajouter(legal, "p", "nqi-legal-copy");
	ligne.appendChild(document.createTextNode(t("installer.legal.beforeTerms")));
	ajouter(ligne, "span", "nqi-legal-link", t("installer.legal.terms"));
	ligne.appendChild(document.createTextNode(t("installer.legal.between")));
	ajouter(ligne, "span", "nqi-legal-link", t("installer.legal.privacy"));
	ligne.appendChild(document.createTextNode(t("installer.legal.afterPrivacy")));
	ligne.appendChild(document.createTextNode(t("installer.legal.components")));
}

function rendreCommentaires(parent: HTMLElement, classe = ""): void {
	const commentaires = ajouter(parent, "button", `nqi-feedback${classe ? ` ${classe}` : ""}`);
	commentaires.type = "button";
	const iconeCommentaires = ajouter(commentaires, "span", "nqi-feedback-icon");
	poserIcone(iconeCommentaires, "message-square-warning");
	ajouter(commentaires, "span", undefined, t("installer.feedback"));
	commentaires.addEventListener("click", () => window.neoInstaller.commentaires());
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

function rendreChargement(parent: HTMLElement): void {
	const etape = ajouter(parent, "section", "nqi-loading-stage");
	etape.setAttribute("role", "status");
	etape.setAttribute("aria-label", t("installer.preparing"));
	const anneau = ajouter(etape, "div", "nqi-loading-spinner");
	anneau.setAttribute("aria-hidden", "true");
}

function detailTelechargement(recus: number, total: number): string {
	const restant = Math.max(0, total - recus);
	if (debitTelechargement && debitTelechargement > 0 && restant > 0) {
		return t("installer.status.downloadDetail", {
			downloaded: formatOctets(recus),
			total: formatOctets(total),
			seconds: Math.max(1, Math.ceil(restant / debitTelechargement)),
		});
	}
	return t("installer.status.downloadDetailNoTime", {
		downloaded: formatOctets(recus),
		total: formatOctets(total),
	});
}

function ouvrirConfirmationAnnulation(): void {
	if (!phaseInstallationActive() || annulationDemandee) return;
	confirmationAnnulation = true;
	rendre();
}

function confirmerAnnulation(): void {
	if (!phaseInstallationActive() || annulationDemandee) return;
	confirmationAnnulation = false;
	annulationDemandee = true;
	rendre();
	void window.neoInstaller.annuler().catch(() => {
		annulationDemandee = false;
		etat = { phase: "erreur", code: "generic" };
		rendre();
	});
}

function rendreConfirmationAnnulation(parent: HTMLElement): void {
	const voile = ajouter(parent, "div", "nqi-cancel-overlay");
	const dialogue = ajouter(voile, "section", "nqi-cancel-dialog");
	dialogue.setAttribute("role", "alertdialog");
	dialogue.setAttribute("aria-modal", "true");
	const titre = ajouter(dialogue, "h2", "nqi-cancel-title", t("installer.cancelDialog.title"));
	titre.id = "nqi-cancel-title";
	dialogue.setAttribute("aria-labelledby", titre.id);
	const message = ajouter(dialogue, "p", "nqi-cancel-copy", t("installer.cancelDialog.body"));
	message.id = "nqi-cancel-copy";
	dialogue.setAttribute("aria-describedby", message.id);
	const actions = ajouter(dialogue, "div", "nqi-cancel-actions");
	const non = ajouter(actions, "button", "nqi-cancel-no", t("installer.cancelDialog.no"));
	non.type = "button";
	non.autofocus = true;
	non.addEventListener("click", () => {
		confirmationAnnulation = false;
		rendre();
	});
	const oui = ajouter(actions, "button", "nqi-cancel-yes", t("installer.cancelDialog.yes"));
	oui.type = "button";
	oui.addEventListener("click", confirmerAnnulation);
}

function rendreEtapeProgression(parent: HTMLElement): void {
	const etape = ajouter(parent, "section", "nqi-progress-stage");
	ajouter(etape, "h1", "nqi-progress-title", t("installer.title"));

	let pourcent: number | null = null;
	let statut = t("installer.status.downloadingPending");
	let detail: string | null = null;
	if (annulationDemandee) {
		statut = t("installer.status.cancelling");
	} else if (etat.phase === "telechargement") {
		pourcent = etat.total > 0 ? (etat.recus / etat.total) * 100 : 0;
		statut = t("installer.status.downloading", { percent: formatPourcent(pourcent) });
		detail = detailTelechargement(etat.recus, etat.total);
	} else if (etat.phase === "verification") {
		pourcent = 100;
		statut = t("installer.status.verifying");
	} else if (etat.phase === "installation") {
		pourcent = etat.pourcent;
		statut = t("installer.status.installingProgress", { percent: formatPourcent(pourcent) });
	}

	const bloc = ajouter(etape, "div", "nqi-progress-block");
	rendreProgression(bloc, pourcent, "nqi-progress-wide");
	ajouter(bloc, "p", "nqi-progress-status", statut);
	if (detail && !annulationDemandee) ajouter(bloc, "p", "nqi-progress-detail", detail);

	rendreCommentaires(etape, "nqi-progress-feedback");
	rendreLegal(etape, "nqi-progress-legal");

	const actions = ajouter(etape, "div", "nqi-progress-actions");
	const annuler = ajouter(actions, "button", "nqi-progress-cancel", t("installer.cancel"));
	annuler.type = "button";
	annuler.disabled = annulationDemandee;
	if (!annuler.disabled) annuler.addEventListener("click", ouvrirConfirmationAnnulation);
	const installer = ajouter(actions, "button", "nqi-progress-install", t("installer.install"));
	installer.type = "button";
	installer.disabled = true;
}

function rendreDemarrage(parent: HTMLElement): void {
	const etape = ajouter(parent, "main", "nqi-launch-stage");
	etape.setAttribute("role", "status");
	etape.setAttribute("aria-label", t("installer.windowTitle"));
	const carte = ajouter(etape, "section", "nqi-launch-card");
	const marque = ajouter(carte, "div", "nqi-launch-brand");
	const icone = ajouter(marque, "img", "nqi-launch-icon");
	icone.src = "./icon.png";
	icone.alt = "";
	icone.setAttribute("aria-hidden", "true");
	ajouter(marque, "strong", "nqi-launch-name", t("installer.windowTitle"));
}

function rendre(): void {
	document.documentElement.lang = currentLang();
	document.title = t("installer.windowTitle");
	const root = document.getElementById("app");
	if (!root) return;
	root.replaceChildren();

	if (etat.phase === "demarrage") {
		rendreDemarrage(root);
		return;
	}

	rendreBarreTitre(root);
	const contenu = ajouter(root, "main", "nqi-shell");
	rendreHero(contenu);

	if (chargement) {
		rendreChargement(contenu);
		return;
	}

	if (etat.phase === "elevation" || etat.phase === "telechargement" || etat.phase === "verification" || etat.phase === "installation") {
		rendreEtapeProgression(contenu);
		if (confirmationAnnulation) rendreConfirmationAnnulation(root);
		return;
	}

	/* Étape 2 : DOM volontairement inchangé par rapport à la version validée. */
	const panneau = ajouter(contenu, "section", "nqi-panel");
	ajouter(panneau, "h1", "nqi-title", t("installer.title"));
	rendreEmplacement(panneau);
	rendreLegal(panneau);
	rendreCommentaires(panneau);
	const actions = ajouter(panneau, "div", "nqi-actions");
	rendreAction(actions);
	rendreErreurElevation(root);
}

function lancerInstallation(): void {
	if (!infos) return;
	confirmationAnnulation = false;
	annulationDemandee = false;
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
	echantillonTelechargement = null;
	debitTelechargement = null;
	confirmationAnnulation = false;
	annulationDemandee = false;
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

function mesurerDebit(nouvelEtat: EtatInstallateur): void {
	if (nouvelEtat.phase !== "telechargement") {
		echantillonTelechargement = null;
		debitTelechargement = null;
		return;
	}
	const maintenant = performance.now();
	const precedent = echantillonTelechargement;
	if (precedent && nouvelEtat.recus >= precedent.recus) {
		const duree = maintenant - precedent.instant;
		const octets = nouvelEtat.recus - precedent.recus;
		if (duree > 0 && octets > 0) {
			const instantane = (octets * 1000) / duree;
			debitTelechargement = debitTelechargement === null
				? instantane
				: debitTelechargement * 0.72 + instantane * 0.28;
		}
	}
	echantillonTelechargement = { recus: nouvelEtat.recus, instant: maintenant };
}

/* La langue vient du PRINCIPAL par l'URL (`main.ts`, `loadFile` avec
   `query.lang`) : nom du fichier téléchargé, référent du navigateur, ou
   locale système — jamais `navigator.language` seul, qui ignorerait la page
   du site d'où l'exe vient. « auto » seulement si l'URL n'en dit rien. */
const langueUrl = new URLSearchParams(window.location.search).get("lang");
setLanguage(langueUrl === "fr" || langueUrl === "en" ? langueUrl : "auto");
window.neoInstaller.surEtat(nouvelEtat => {
	mesurerDebit(nouvelEtat);
	if (nouvelEtat.phase === "annule") {
		confirmationAnnulation = false;
		annulationDemandee = false;
		etat = { phase: "pret" };
		rendre();
		window.neoInstaller.fermer();
		return;
	}
	if (nouvelEtat.phase === "erreur") {
		confirmationAnnulation = false;
		annulationDemandee = false;
	}
	etat = nouvelEtat;
	rendre();
});
void initialiser();
