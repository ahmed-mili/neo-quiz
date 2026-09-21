/* ══════════════════════════════════════════════════════════
   LE GESTE DE CONNEXION D'UN CLI — chemin unique pour deux appelants

   La carte d'erreur de la page « Générer » (`ai.ts`) et la section
   « Comptes » des réglages (`apps/windows/src/ui/comptes.ts`) ouvrent
   toutes les deux un terminal pour connecter Claude Code, Codex ou
   Antigravity. Avant ce module, seule `ai.ts` portait cette mécanique :
   la modale mesurée AVANT le terminal, les deux colonnes (navigateur à
   gauche, Neo Quiz à droite) quand la connexion en ouvre un, et les trois
   verdicts de l'hôte. Ollama n'a pas de compte à connecter par terminal
   (voir `checkOllamaCompte`, `ai-providers.ts`) : il reste du ressort de
   chaque appelant, qui ouvre directement le navigateur sur l'adresse de
   connexion du démon.

   DÉSABONNEMENT : sur `annule` et `indisponible`, ce module coupe LUI-MÊME
   les deux abonnements avant de rendre la main — un `off()` oublié laisse
   un écouteur qui vise un élément détaché, défaut déjà corrigé une fois
   dans ce chantier. Sur `lance`, les abonnements restent ACTIFS : le
   terminal peut se poser et le navigateur s'ouvrir bien après que cette
   fonction a rendu la main (l'utilisateur est encore dans le flux OAuth).
   C'est pourquoi `onDesabonner` remet leur coupe à l'appelant, qui la
   déclenchera à SA propre fin d'attente (annulation, compte détecté,
   démontage de la page) — jamais ce module, qui ne sait pas quand cette
   fin arrive. */
import { LOG_PREFIX } from "../branding";
import { ajouter, ancreApresRelayout, ancreRemontee, CLASSE_MODALE_HAUT } from "../dom";
import { currentHost, requireHost } from "../host/current";
import type { CliTool, HostModalHandle } from "../host/types";
import { t } from "../i18n";

/** Les trois outils qui ont un compte connectable par terminal — jamais
    Ollama, qui n'en a pas (voir l'en-tête du module). */
export type OutilConnectable = Exclude<CliTool, "ollama">;

export interface DemarrerConnexionCliDeps {
	/** La modale d'attente, déjà OUVERTE par l'appelant (elle a sa propre
	    UI — spinner, texte — que ce module ne dessine pas) : mesurée pour
	    ancrer le terminal, et remontée au signal `surTerminalPose`. `null`
	    si l'appelant n'en a pas (le terminal se pose alors où l'hôte veut). */
	modaleEl: HTMLElement | null;
	/** Reçoit, UNE FOIS, la fonction qui coupe les deux abonnements de
	    repositionnement — appelée seulement quand le verdict est `lance`
	    (sur `annule`/`indisponible`, ce module les a déjà coupés lui-même).
	    L'appelant la garde et la déclenche à SA propre fin d'attente. */
	onDesabonner?(desabonner: () => void): void;
}

/**
 * Lance la connexion d'un outil déjà installé : ouvre un terminal visible
 * sur `codex login` / `claude auth login` / la recette Antigravity, mesure
 * la modale d'attente pour que le terminal s'y pose, et suit l'ouverture du
 * navigateur (les deux colonnes) si la connexion en ouvre un.
 *
 * Les trois verdicts de l'hôte sont rendus tels quels, y compris le rejet
 * du pont (outil hors liste blanche, panne d'IPC) traité comme
 * `indisponible` — sans ça, un bouton désactivé resterait muet.
 */
export async function demarrerConnexionCli(tool: OutilConnectable, deps: DemarrerConnexionCliDeps): Promise<"lance" | "annule" | "indisponible"> {
	const proc = requireHost("process");
	let desabonnerPose: (() => void) | null = null;
	let desabonnerNav: (() => void) | null = null;
	let verdict: "lance" | "annule" | "indisponible";
	try {
		const modale = deps.modaleEl;
		if (modale) {
			/* La modale d'attente est mesurée REMONTÉE mais ne bouge pas encore —
			   elle remonte au signal `surTerminalPose`, quand la fenêtre du
			   terminal est en place. */
			const off = proc.surTerminalPose?.(() => {
				modale.classList.add(CLASSE_MODALE_HAUT);
				off?.();
			});
			desabonnerPose = off ?? null;
			/* LES DEUX COLONNES : le navigateur à gauche, Neo Quiz à droite —
			   la modale a rétréci, le terminal la suit. */
			desabonnerNav = proc.surNavigateurOuvert?.(() => {
				void ancreApresRelayout(modale).then(a => proc.replacerTerminal?.(a));
			}) ?? null;
		}
		verdict = await proc.connecterCli(tool, modale ? ancreRemontee(modale) : undefined);
	} catch (e) {
		console.warn(LOG_PREFIX, "connexion impossible:", e);
		verdict = "indisponible";
	}
	if (verdict !== "lance") {
		desabonnerPose?.();
		desabonnerNav?.();
		return verdict;
	}
	const desabonnerTout = (): void => { desabonnerPose?.(); desabonnerNav?.(); };
	deps.onDesabonner?.(desabonnerTout);
	return verdict;
}

/** La croix d'une modale d'attente EST l'annulation (pas de bouton Annoncer
    à part) : elle se signale comme telle au survol — rouge, et la bulle
    « Annuler » tout de suite dessous (CSS `.qbd-web-wait-close`). Partagée
    par toutes les modales de ce module et par `ai.ts` (web, chargement,
    erreur) : une seule apparence pour toutes les attentes de la page. */
export function poserCroixAnnuler(m: HostModalHandle): void {
	const croix = m.panelEl.querySelector<HTMLElement>(".modal-close-button");
	if (!croix) return;
	croix.classList.add("qbd-web-wait-close");
	/* L'infobulle au dessin de celle de Windows 11 (`data-tip`, CSS). Pas de
	   `title` : Electron en ferait une infobulle Win32 à l'ancienne,
	   impossible à styliser, qui viendrait en plus par-dessus. */
	croix.dataset.tip = t("ai.web.cancel");
	croix.setAttribute("aria-label", t("ai.web.cancel"));
}

/** La carte d'attente générique (spinner puis coche) — même classes que le
    modal d'installation, c'est la même promesse faite à l'utilisateur
    (« continuez là-bas, je regarde ici »). Sert la section « Comptes », qui
    n'a pas de carte d'erreur ni de demande à relancer contrairement à la
    page « Générer » : un seul texte de fin, « connecté ». */
export function renderCarteAttenteConnexion(parent: HTMLElement, connecte: boolean): void {
	const el = ajouter(parent, "div", "qbd-ai-preview-loading qbd-ai-login-wait");
	el.dataset.etat = connecte ? "ok" : "attente";
	if (connecte) {
		currentHost().ui.setIcon(ajouter(el, "span", "qbd-install-check"), "check");
		ajouter(el, "p", "qbd-ai-loading-title", t("ai.login.connected"));
		return;
	}
	ajouter(el, "span", "qbd-install-spinner");
	ajouter(el, "p", "qbd-ai-loading-title", t("ai.login.waiting"));
	ajouter(el, "p", "qbd-ai-login-hint", t("ai.login.hint"));
}
