/* ══════════════════════════════════════════════════════════
   LA SECTION « COMPTES » DES RÉGLAGES

   Quatre lignes, `claude`, `codex`, `agy`, `ollama`, dans cet ordre fixe.
   L'état vient de DEUX sources assemblées : `host.process.etatComptes()` pour
   les trois premières (un seul appel, groupé côté principal), et
   `checkOllamaCompte()` (`src/dashboard/ai-providers.ts`) pour la quatrième —
   Ollama n'a pas de fichier de jetons que le principal pourrait lire comme les
   trois autres, seul son serveur local sait répondre. `ollamaInstalle()` du
   même contrat dit si le binaire existe, séparément de la connexion : sans
   lui la ligne Ollama ne pourrait jamais proposer « Installer ».

   MÊME PATRON QUE `fond.ts` (`monterReglagesFond`) : une fonction qui monte
   la section, dessine un premier état (ici : un squelette), puis redessine
   après chaque lecture ou action. Aucun abonnement au pont : rien ne pousse
   de changement depuis le principal, une action redessine elle-même après
   avoir agi.
══════════════════════════════════════════════════════════ */

import type { CliTool, EtatCompte } from "../../../../src/host/types";
import { currentHost, requireHost } from "../../../../src/host/current";
import { t, currentLang } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { openConfirmModal } from "../../../../src/editor/modals";
import { checkOllamaCompte, setBrandLogo } from "../../../../src/dashboard/ai-providers";
import { pont } from "../host/pont";
import { CLE_REGLAGES_IA } from "../../electron/pont";
import { LOG_PREFIX } from "../../../../src/branding";
import type { UsageRead, UsageReadError, UsageRow } from "../../../../src/dashboard/usage-format";
import { usageRowLabel, formatResetMoment, formatAge, formatDuration } from "../../../../src/dashboard/usage-format";

/** L'ordre d'affichage, fixé par le cahier des charges — jamais celui que
    rendrait `etatComptes()` (qui ne connaît pas Ollama). */
const ORDRE: CliTool[] = ["claude", "codex", "agy", "ollama"];

/** Le logo de MARQUE par outil, posé par `setBrandLogo` (`ai-providers.ts`),
    même patron que le sélecteur de fournisseur de la page « Générer »
    (`ai.ts`, `buildProviderControl`) : `qbd-provider-logo qbd-provider-logo--<nom>`
    puis `setBrandLogo(el, nom)`. Ce ne sont pas des icônes Lucide — le
    catalogue Lucide n'a aucun logo de marque, et les poser à la main ici
    aurait divergé du sélecteur qui affiche déjà ces mêmes logos. */
const LOGOS: Record<CliTool, string> = {
	claude: "claude",
	codex: "openai",
	agy: "antigravity",
	ollama: "ollama",
};

/** L'adresse du serveur Ollama telle qu'enregistrée par la page « Générer »
    (mêmes réglages IA, clé `CLE_REGLAGES_IA`). `undefined` fait retomber
    `checkOllamaCompte` sur son défaut local. */
async function lireAiOllamaUrl(): Promise<string | undefined> {
	const brut = await pont().reglages.lire(CLE_REGLAGES_IA);
	const url = brut && typeof brut === "object" ? (brut as { aiOllamaUrl?: unknown }).aiOllamaUrl : undefined;
	return typeof url === "string" ? url : undefined;
}

/** Le nom affiché, traduit — jamais le nom brut de `PROVIDERS`
    (`ai-providers.ts`), qui dit « Claude » quand cette ligne doit dire
    « Claude Code » : c'est le compte du CLI, pas celui du fournisseur. */
function nomOutil(outil: CliTool): string {
	switch (outil) {
		case "claude": return t("app.comptes.claude");
		case "codex": return t("app.comptes.codex");
		case "agy": return t("app.comptes.agy");
		case "ollama": return t("app.comptes.ollama");
	}
}

/** L'état de la ligne Ollama, assemblé depuis deux appels que `EtatCompte`
    ne distingue pas ailleurs : `ollamaInstalle()` (le binaire existe-t-il ?)
    et `checkOllamaCompte()` (le serveur répond-il, connecté ?). Rend aussi
    `signinUrl` (quand le démon répond 401 avec une adresse de connexion) :
    c'est elle que le bouton « Se connecter » ouvrira, Ollama n'ayant pas de
    CLI de connexion (voir `surClicAction`). */
async function etatOllama(): Promise<{ etat: EtatCompte; signinUrl: string | null }> {
	const proc = requireHost("process");
	const [installe, compte] = await Promise.all([
		proc.ollamaInstalle(),
		lireAiOllamaUrl().then(checkOllamaCompte),
	]);
	return {
		etat: {
			outil: "ollama",
			installe,
			connecte: compte.connecte,
			// Ollama ne publie pas d'adresse de compte, seulement un forfait.
			email: null,
			plan: compte.connecte ? compte.plan : null,
		},
		signinUrl: compte.connecte ? null : compte.signinUrl,
	};
}

/** Les quatre lignes, dans l'ORDRE fixe — les deux sources partent en
    parallèle, et on attend les DEUX avant de dessiner : celle qui répond la
    première (Ollama, sous la seconde) ne doit pas faire sauter la liste
    pendant que la plus lente (`etatComptes()`, ~1 s à cause d'Antigravity)
    arrive encore. */
async function lireEtats(): Promise<{ etats: EtatCompte[]; ollamaSigninUrl: string | null }> {
	const [trois, ollama] = await Promise.all([
		requireHost("process").etatComptes(),
		etatOllama(),
	]);
	const parOutil = new Map(trois.map(e => [e.outil, e] as const));
	const etats = ORDRE.map(outil => {
		if (outil === "ollama") return ollama.etat;
		return parOutil.get(outil) ?? { outil, installe: false, connecte: false, email: null, plan: null };
	});
	return { etats, ollamaSigninUrl: ollama.signinUrl };
}

/** L'action que le bouton d'une ligne déclenche : c'est `installe` qui
    tranche la première branche, jamais `connecte` seul — un outil absent de
    la machine et un outil présent mais déconnecté ne peuvent pas partager le
    même bouton. */
function actionDe(etat: EtatCompte): "installer" | "connecter" | "deconnecter" {
	if (!etat.installe) return "installer";
	return etat.connecte ? "deconnecter" : "connecter";
}

/* ── Le popover d'usage (survol / focus d'une ligne Claude ou Codex) ──
   `usageCompte` n'accepte que ces deux outils — le compilateur refuse déjà
   Antigravity et Ollama à l'appel, ce module n'a pas besoin de le revérifier
   lui-même au-delà de ce type. */
type OutilAvecUsage = "claude" | "codex";

const DELAI_OUVERTURE_MS = 250;
const DELAI_FERMETURE_MS = 150;
/** Le résultat d'une lecture est gardé 60 s par outil : Claude coûte un
    aller-retour réseau, Codex une lecture de fichier — aucun des deux
    n'a besoin d'être relu à chaque survol de la même minute. */
const USAGE_CACHE_MS = 60_000;
const USAGE_SEUIL_AVERTISSEMENT = 80;
const USAGE_SEUIL_CRITIQUE = 95;

interface EntreeUsage { at: number; resultat: UsageRead; }

const usageCache = new Map<OutilAvecUsage, EntreeUsage>();
const usageEnCours = new Map<OutilAvecUsage, Promise<EntreeUsage>>();

/** Lecture de l'usage, gardée en cache. NE REJETTE JAMAIS : une exception du
    pont (Claude) ou de la lecture disque (Codex) devient une erreur
    `unavailable`, exactement comme le reste de ce module transforme les
    rejets du pont en un état affichable plutôt qu'en rejection non gérée. */
async function lireUsageAvecAge(outil: OutilAvecUsage): Promise<EntreeUsage> {
	const cache = usageCache.get(outil);
	if (cache && Date.now() - cache.at < USAGE_CACHE_MS) return cache;
	const enCours = usageEnCours.get(outil);
	if (enCours) return enCours;
	const promesse = requireHost("process").usageCompte(outil)
		.catch((e): UsageRead => {
			console.warn(LOG_PREFIX, "lecture d'usage impossible:", e);
			return { rows: [], error: { kind: "unavailable" } };
		})
		.then((resultat): EntreeUsage => {
			const entree = { at: Date.now(), resultat };
			usageCache.set(outil, entree);
			usageEnCours.delete(outil);
			return entree;
		});
	usageEnCours.set(outil, promesse);
	return promesse;
}

function classeSeuil(pct: number): string {
	if (pct >= USAGE_SEUIL_CRITIQUE) return " is-critical";
	if (pct >= USAGE_SEUIL_AVERTISSEMENT) return " is-warning";
	return "";
}

/** Une jauge : réutilise `.qbd-ai-usage-gauge-bar`/`-fill` (dashboard-ai.css,
    posées mais jusqu'ici jamais consommées) plutôt que d'en redéfinir une —
    même barre que celle que l'écran d'usage du greffon aurait affichée. */
function poserLigneUsage(pop: HTMLElement, row: UsageRow): void {
	const ligneUsage = ajouter(pop, "div", "nq-usage-row");
	const info = ajouter(ligneUsage, "div", "nq-usage-row-info");
	ajouter(info, "div", "nq-usage-row-label", usageRowLabel(row));
	const reset = formatResetMoment(row.resetsAt, currentLang());
	if (reset) ajouter(info, "div", "nq-usage-row-reset", t("app.comptes.usage.resetsAt", { moment: reset }));
	ajouter(ligneUsage, "span", "nq-usage-row-pct", t("ai.usage.usedPercent", { n: Math.round(row.usedPercent) }));
	const barre = ajouter(ligneUsage, "div", "qbd-ai-usage-gauge-bar");
	const remplissage = ajouter(barre, "div", "qbd-ai-usage-gauge-fill" + classeSeuil(row.usedPercent));
	remplissage.style.width = Math.max(0, Math.min(100, row.usedPercent)) + "%";
}

/** Les QUATRE cas d'échec (`UsageReadError.kind`), chacun sa phrase — un
    popover qui resterait vide sur un échec serait indiscernable d'un bug. */
function poserErreurUsage(pop: HTMLElement, erreur: UsageReadError): void {
	const message = erreur.kind === "rate-limited"
		? (erreur.retryAfterSec != null
			? t("app.comptes.usage.errorRateLimitedDelay", { delai: formatDuration(erreur.retryAfterSec * 1000) })
			: t("app.comptes.usage.errorRateLimited"))
		: erreur.kind === "unauthenticated" ? t("app.comptes.usage.errorUnauthenticated")
			: erreur.kind === "jamais-lance" ? t("app.comptes.usage.errorNeverRun")
				: t("app.comptes.usage.errorUnavailable");
	ajouter(pop, "p", "nq-usage-error", message);
}

/** Affiché DÈS l'ouverture, avant que `usageCompte` ait répondu — sans ça, le
    popover apparaît vide puis se remplit d'un coup, ce qui saute à l'œil. */
function poserUsagePopoverChargement(pop: HTMLElement, outil: OutilAvecUsage): void {
	ajouter(pop, "div", "nq-usage-titre", nomOutil(outil));
	for (let i = 0; i < 2; i++) {
		const ligneUsage = ajouter(pop, "div", "nq-usage-row");
		const info = ajouter(ligneUsage, "div", "nq-usage-row-info");
		ajouter(info, "div", "nq-usage-row-label", t("app.comptes.loading"));
		const barre = ajouter(ligneUsage, "div", "qbd-ai-usage-gauge-bar");
		ajouter(barre, "div", "qbd-ai-usage-gauge-fill nq-usage-fill--attente");
	}
}

function poserUsagePopoverContenu(pop: HTMLElement, outil: OutilAvecUsage, entree: EntreeUsage): void {
	ajouter(pop, "div", "nq-usage-titre", nomOutil(outil));
	if (entree.resultat.error) {
		poserErreurUsage(pop, entree.resultat.error);
		return;
	}
	if (!entree.resultat.rows.length) {
		// Une lecture réussie sans AUCUNE ligne n'a pas de sens pour ces deux
		// outils (ils publient toujours au moins une jauge) ; un message
		// reste plus honnête qu'un cadre nu — même principe que les quatre
		// erreurs ci-dessus.
		ajouter(pop, "p", "nq-usage-error", t("app.comptes.usage.errorUnavailable"));
		return;
	}
	for (const row of entree.resultat.rows) poserLigneUsage(pop, row);
	if (outil === "codex") {
		// Codex n'a pas d'état courant : la lecture vient du dernier fichier
		// de session écrit sur disque, une photo prise à SA dernière lecture
		// (le seul horodatage disponible ici), pas au lancement du CLI.
		ajouter(pop, "p", "nq-usage-note", t("app.comptes.usage.codexSnapshot", { age: formatAge(entree.at, Date.now()) }));
	}
}

export function monterReglagesComptes(section: HTMLElement): () => void {
	let detruit = false;
	/** L'adresse de connexion Ollama, retenue depuis le dernier redessin —
	    même rôle que `ollamaSigninUrl` dans `ai.ts` (`demarrerConnexion`) :
	    une carte affichée sans sonde préalable n'aurait pas cette adresse, et
	    le bouton la resonde une fois avant de renoncer (voir `surClicAction`). */
	let ollamaSigninUrl: string | null = null;

	const liste = ajouter(section, "div", "nq-comptes-liste");

	/** Les popovers d'usage OUVERTS — au plus un par ligne, mais une action
	    peut redessiner la liste pendant qu'un survol est en cours. Fermés
	    avant tout redessin et au démontage : un popover portalé au `<body>`
	    survit à sa ligne si personne ne le retire explicitement. */
	const popoversUsage = new Set<() => void>();
	function fermerPopoversUsage(): void {
		for (const fermer of Array.from(popoversUsage)) fermer();
	}

	/** Popover d'usage au survol ou au focus clavier d'une ligne Claude ou
	    Codex — jamais Antigravity ni Ollama : seul `outil: OutilAvecUsage`
	    (paramètre de cette fonction) rend l'appel possible, le compilateur
	    refuse déjà les deux autres à `usageCompte`. */
	function attacherPopoverUsage(ligne: HTMLElement, outil: OutilAvecUsage): void {
		let popEl: HTMLElement | null = null;
		let minuteurOuverture: number | null = null;
		let minuteurFermeture: number | null = null;
		/* Incrémenté à chaque ouverture : une lecture qui répond après que ce
		   jeton a changé (fermé puis pas rouvert, ou rouvert une seconde fois)
		   ne doit jamais toucher un popover qui n'est plus le sien. */
		let jeton = 0;

		function annulerOuverture(): void {
			if (minuteurOuverture != null) { window.clearTimeout(minuteurOuverture); minuteurOuverture = null; }
		}
		function annulerFermeture(): void {
			if (minuteurFermeture != null) { window.clearTimeout(minuteurFermeture); minuteurFermeture = null; }
		}

		function fermer(): void {
			annulerOuverture();
			annulerFermeture();
			jeton++;
			if (popEl) { popEl.remove(); popEl = null; }
			popoversUsage.delete(fermer);
		}

		function positionner(): void {
			if (!popEl) return;
			const r = ligne.getBoundingClientRect();
			// Mesuré caché : sa taille dépend du contenu qu'on vient de poser
			// (squelette ou vraies jauges), inconnue avant qu'il soit dans le DOM.
			popEl.style.visibility = "hidden";
			const pr = popEl.getBoundingClientRect();
			const left = Math.min(Math.max(8, r.left), window.innerWidth - pr.width - 8);
			let top = r.bottom + 6;
			if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
			popEl.style.left = left + "px";
			popEl.style.top = top + "px";
			popEl.style.visibility = "";
		}

		function ouvrirMaintenant(): void {
			if (popEl) return;
			annulerOuverture();
			annulerFermeture();
			const monJeton = ++jeton;
			popoversUsage.add(fermer);
			popEl = ajouter(document.body, "div", "nq-usage-popover");
			popEl.addEventListener("mouseenter", annulerFermeture);
			popEl.addEventListener("mouseleave", programmerFermeture);
			// AFFICHÉ AVANT la réponse, avec ses jauges en attente : un popover
			// qui apparaît vide puis se remplit sauterait à l'œil.
			poserUsagePopoverChargement(popEl, outil);
			positionner();
			// Pas de `.catch` : `lireUsageAvecAge` ne rejette jamais (elle
			// transforme toute exception en erreur affichable) — le `.then`
			// ci-dessous couvre sa seule issue possible.
			void lireUsageAvecAge(outil).then((entree) => {
				/* Trois façons pour cette réponse d'arriver « trop tard » : la
				   section a été démontée, ce popover a été fermé (et pas
				   rouvert), ou il a été rouvert une seconde fois depuis — dans
				   les trois cas `jeton` a changé, ne rien toucher. */
				if (detruit || monJeton !== jeton || !popEl) return;
				popEl.replaceChildren();
				poserUsagePopoverContenu(popEl, outil, entree);
				positionner();
			});
		}

		function programmerOuverture(): void {
			if (popEl || minuteurOuverture != null) return;
			annulerFermeture();
			minuteurOuverture = window.setTimeout(() => { minuteurOuverture = null; ouvrirMaintenant(); }, DELAI_OUVERTURE_MS);
		}

		function programmerFermeture(): void {
			annulerOuverture();
			if (minuteurFermeture != null) return;
			minuteurFermeture = window.setTimeout(() => { minuteurFermeture = null; fermer(); }, DELAI_FERMETURE_MS);
		}

		ligne.addEventListener("mouseenter", programmerOuverture);
		ligne.addEventListener("mouseleave", programmerFermeture);
		// `focusin`/`focusout` BUBBLENT depuis le bouton d'action (seul enfant
		// focalisable) : Tab jusqu'à la ligne ouvre le popover sans délai —
		// contrairement au survol, un geste clavier explicite n'a pas besoin
		// d'être filtré d'un passage rapide.
		ligne.addEventListener("focusin", ouvrirMaintenant);
		ligne.addEventListener("focusout", programmerFermeture);
	}

	/** Le logo et le nom, communs à la ligne SQUELETTE et à la ligne finale :
	    les deux seules choses connues sans attendre aucune lecture. */
	function poserEntete(ligne: HTMLElement, outil: CliTool): void {
		const icone = ajouter(ligne, "span", "qbd-provider-logo qbd-provider-logo--" + LOGOS[outil]);
		setBrandLogo(icone, LOGOS[outil]);
		const texte = ajouter(ligne, "div", "nq-comptes-texte");
		ajouter(texte, "span", "nq-comptes-nom", nomOutil(outil));
	}

	/** Le SQUELETTE : les quatre lignes, dans l'ordre fixe, avant toute
	    lecture — logo et nom connus tout de suite, un espace réservé à la
	    place de l'adresse et un bouton désactivé à la place de l'action. MÊME
	    STRUCTURE que `poserLigne` (mêmes classes, un bouton de même taille)
	    pour que la hauteur ne saute pas quand les vraies lignes la remplacent. */
	function poserSquelette(): void {
		fermerPopoversUsage();
		liste.replaceChildren();
		for (const outil of ORDRE) {
			const ligne = ajouter(liste, "div", "nq-comptes-ligne");
			ligne.dataset.outil = outil;
			poserEntete(ligne, outil);
			const texte = ligne.querySelector<HTMLElement>(".nq-comptes-texte")!;
			ajouter(texte, "span", "nq-comptes-email", t("app.comptes.loading"));
			const bouton = ajouter(ligne, "button", "nq-comptes-action", t("app.comptes.loading"));
			bouton.type = "button";
			bouton.disabled = true;
		}
	}

	/** Une ligne, reconstruite en entier à chaque redessin — quatre lignes ne
	    justifient pas un diff fin, et ça garde ce module au niveau de
	    `fond.ts`, qui fait le même choix pour sa rangée unique. */
	function poserLigne(etat: EtatCompte): void {
		const ligne = ajouter(liste, "div", "nq-comptes-ligne");
		ligne.dataset.outil = etat.outil;
		poserEntete(ligne, etat.outil);
		const texte = ligne.querySelector<HTMLElement>(".nq-comptes-texte")!;

		const etatTexte = !etat.installe
			? t("app.comptes.notInstalled")
			: !etat.connecte
				? t("app.comptes.notConnected")
				: (etat.email ?? t("app.comptes.connectedNoEmail"));
		ajouter(texte, "span", "nq-comptes-email", etatTexte);

		// Antigravity ne publie aucun forfait (décision du chantier) : la
		// colonne reste vide plutôt que d'inventer une valeur.
		if (etat.plan) ajouter(ligne, "span", "nq-comptes-plan", etat.plan);

		const action = actionDe(etat);
		const bouton = ajouter(ligne, "button", "nq-comptes-action", t(
			action === "installer" ? "app.comptes.install"
				: action === "connecter" ? "app.comptes.connect"
					: "app.comptes.disconnect",
		));
		bouton.type = "button";
		bouton.addEventListener("click", () => {
			void surClicAction(etat.outil, action, bouton);
		});

		// Antigravity et Ollama n'ont rien à montrer (aucun forfait lisible) :
		// l'absence de popover EST l'information, pas un oubli.
		if (etat.outil === "claude" || etat.outil === "codex") {
			attacherPopoverUsage(ligne, etat.outil);
		}
	}

	/** Redessine la section entière. NE JETTE JAMAIS : son seul appelant est
	    `void redessiner()` (montage) ou une action sans `catch` — une
	    exception non rattrapée ici deviendrait une rejection non gérée, et la
	    section resterait vide EN PERMANENCE, sans un mot. `etatComptes()` est
	    un appel IPC ; un pont qui refuse REJETTE, ce n'est pas une hypothèse
	    d'école. */
	async function redessiner(): Promise<void> {
		let resultat: { etats: EtatCompte[]; ollamaSigninUrl: string | null };
		try {
			resultat = await lireEtats();
		} catch (e) {
			console.warn(LOG_PREFIX, "lecture des comptes IA impossible:", e);
			if (detruit) return;
			fermerPopoversUsage();
			liste.replaceChildren();
			ajouter(liste, "p", "nq-comptes-erreur", t("app.comptes.loadError"));
			return;
		}
		if (detruit) return;
		ollamaSigninUrl = resultat.ollamaSigninUrl;
		fermerPopoversUsage();
		liste.replaceChildren();
		for (const etat of resultat.etats) poserLigne(etat);
	}

	/** `bouton` est le même que `surClicAction` a désactivé avant d'ouvrir la
	    confirmation : cette fonction en est désormais RESPONSABLE jusqu'au
	    bout, sur les QUATRE issues possibles (succès, échec, exception,
	    annulé — l'annulation ne passe pas par ici, elle réactive déjà dans
	    son propre rappel). Un verrou posé et relâché sur une seule branche
	    est exactement le défaut déjà corrigé ailleurs dans ce chantier
	    (`process.ts`, l'arbre de process tué sur TOUTES les issues) : ici,
	    « échec » et « exception » redessinaient déjà la ligne PARFOIS via
	    `finally` dans `surClicAction`, mais `deconnecter` a son propre
	    chemin de retour anticipé qui, lui, ne touchait jamais `bouton`. */
	async function deconnecter(outil: CliTool, bouton: HTMLButtonElement): Promise<void> {
		let verdict: "ok" | "echec" | "indisponible";
		try {
			verdict = await requireHost("process").deconnecterCli(outil);
		} catch (e) {
			console.warn(LOG_PREFIX, "déconnexion impossible:", e);
			verdict = "echec";
		}
		if (detruit) return;
		if (verdict !== "ok") {
			currentHost().ui.notice(t("app.comptes.logoutFailed", { name: nomOutil(outil) }));
			// ÉCHEC OU EXCEPTION : la ligne ne se redessine pas (rien n'a changé
			// côté compte), donc RIEN d'autre ne réactivera ce bouton — sans ce
			// réveil explicite, il reste mort jusqu'à la fermeture des réglages.
			bouton.disabled = false;
			return;
		}
		// `"ok"` : la ligne est RE-SONDÉE, jamais supposée déconnectée — le
		// redessin remplace `bouton` par un bouton neuf, actif.
		await redessiner();
	}

	async function surClicAction(
		outil: CliTool,
		action: "installer" | "connecter" | "deconnecter",
		bouton: HTMLButtonElement,
	): Promise<void> {
		if (action === "deconnecter") {
			// DÉSACTIVÉ AVANT D'OUVRIR LA CONFIRMATION, comme les deux autres
			// branches : sans ça, un double-clic rapide empile deux modales de
			// confirmation. Réactivé si l'utilisateur annule — `redessiner()`
			// (donc un bouton refait à neuf) ne suit que la confirmation.
			bouton.disabled = true;
			const name = nomOutil(outil);
			openConfirmModal(
				t("app.comptes.logoutTitle", { name }),
				t("app.comptes.logoutMessage", { name }),
				t("app.comptes.logoutConfirm"),
				t("app.comptes.cancel"),
				(confirme) => {
					if (!confirme) {
						bouton.disabled = false;
						return;
					}
					void deconnecter(outil, bouton);
				},
				t("app.comptes.logoutDetail"),
				"log-out",
			);
			return;
		}
		bouton.disabled = true;
		try {
			// OLLAMA N'A PAS DE CLI DE CONNEXION : `connecterCli("ollama")` rend
			// `indisponible` par contrat (pas de compte à connecter par terminal).
			// La vraie connexion ouvre le NAVIGATEUR sur l'adresse que le démon a
			// rendue à sa dernière sonde 401 — même chemin que `demarrerConnexion`
			// dans `dashboard/ai.ts`. Même règle de repli qu'elle : une adresse
			// absente (carte affichée sans sonde préalable) se resonde une fois
			// avant de renoncer.
			if (action === "connecter" && outil === "ollama") {
				if (!ollamaSigninUrl) {
					const compte = await checkOllamaCompte(await lireAiOllamaUrl());
					if (!compte.connecte && compte.signinUrl) ollamaSigninUrl = compte.signinUrl;
				}
				const ouvert = ollamaSigninUrl !== null && await currentHost().shell.openUrl(ollamaSigninUrl);
				if (!ouvert) currentHost().ui.notice(t("app.comptes.connectFailed", { name: nomOutil(outil) }));
				return;
			}
			const proc = requireHost("process");
			const verdict = action === "installer" ? await proc.installerCli(outil) : await proc.connecterCli(outil);
			if (verdict === "indisponible") {
				currentHost().ui.notice(t(
					action === "installer" ? "app.comptes.installFailed" : "app.comptes.connectFailed",
					{ name: nomOutil(outil) },
				));
			}
			// `"lance"` ou `"annule"` : rien à dire de plus ici, le terminal (s'il
			// est parti) fait le reste — la ligne se redessine, au pire inchangée.
		} catch (e) {
			// Un rejet du pont ou du serveur Ollama (panne réseau, IPC refusé) :
			// même message que le verdict `indisponible`, jamais une exception qui
			// remonterait jusqu'au clic et laisserait le bouton figé désactivé.
			console.warn(LOG_PREFIX, "action de compte impossible:", e);
			currentHost().ui.notice(t(
				action === "installer" ? "app.comptes.installFailed" : "app.comptes.connectFailed",
				{ name: nomOutil(outil) },
			));
		} finally {
			if (!detruit) await redessiner();
		}
	}

	poserSquelette();
	void redessiner();

	return () => { detruit = true; fermerPopoversUsage(); };
}
