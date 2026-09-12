/* ══════════════════════════════════════════════════════════
   LA MISE À JOUR AUTOMATIQUE — le câblage d'electron-updater

   Tout vit ici, dans le PRINCIPAL : le rendu ne voit qu'un état poussé par
   le pont (`CANAUX.miseAJourEtat`) et donne trois ordres. Le flux est
   `resources/app-update.yml`, écrit par electron-builder (clé `publish` de
   la config) : les releases GitHub du dépôt, et rien d'autre.

   QUAND ON VÉRIFIE : au démarrage (après la fenêtre, jamais avant : une
   erreur réseau au boot ne doit rien retarder), au retour du focus avec un
   garde de quinze minutes, et toutes les quatre heures. Hors ligne est un
   état NORMAL : l'erreur est journalisée, jamais affichée en Notice.

   COMMENT ON INSTALLE : par le chemin de FERMETURE existant. `installer()`
   arme un drapeau puis ferme la fenêtre ; `main.ts` fait vider les
   écritures différées du rendu comme pour une croix, et quand tout est
   fermé, c'est `quitAndInstall(true, true)` — silencieux, relance forcée —
   qui remplace `app.quit()`. Une frappe en attente ne se perd pas dans une
   mise à jour. Sans clic, `autoInstallOnAppQuit` installe à la prochaine
   fermeture (sans relance).

   EN DÉVELOPPEMENT (`app.isPackaged === false`) : rien, dit une fois.
   electron-updater n'a pas d'`app-update.yml` à lire hors d'un paquet.
══════════════════════════════════════════════════════════ */

import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { LOG_PREFIX } from "../../../src/branding";
import { ETAT_INITIAL, transition } from "./mise-a-jour-etat";
import type { EtatMiseAJour, EvenementMiseAJour } from "./mise-a-jour-etat";
import type { Reglages } from "./reglages";
import { CLE_REGLAGES_MAJ } from "./pont";

const GARDE_FOCUS_MS = 15 * 60 * 1000;
const PERIODE_MS = 4 * 60 * 60 * 1000;

export interface MiseAJour {
	etat(): EtatMiseAJour;
	/** Au démarrage, APRÈS la fenêtre : pose le réglage lu du disque sans le
	    réécrire, arme le minuteur, et lance la première vérification si le
	    réglage est vrai. */
	initialiser(auto: boolean): void;
	verifier(): Promise<void>;
	/** Vrai si une mise à jour prête a été armée pour l'installation : c'est
	    à l'appelant de fermer la fenêtre, puis d'appeler `installerArmee()`
	    quand tout est fermé. */
	armerInstallation(): boolean;
	installationArmee(): boolean;
	/** `quitAndInstall` : ne revient pas si tout va bien. */
	installerArmee(): void;
	reglerAuto(auto: boolean): Promise<void>;
	surFocus(): void;
	arreter(): void;
}

export function creerMiseAJour(deps: {
	reglages: Reglages;
	envoyer(etat: EtatMiseAJour): void;
}): MiseAJour {
	let etat: EtatMiseAJour = ETAT_INITIAL;
	let armee = false;
	let derniereVerification = 0;
	let minuteur: NodeJS.Timeout | null = null;

	const appliquer = (ev: EvenementMiseAJour): void => {
		etat = transition(etat, ev);
		deps.envoyer(etat);
	};

	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.allowPrerelease = false;
	autoUpdater.logger = {
		info: (m: unknown) => console.log(LOG_PREFIX, "mise à jour:", m),
		warn: (m: unknown) => console.warn(LOG_PREFIX, "mise à jour:", m),
		error: (m: unknown) => console.error(LOG_PREFIX, "mise à jour:", m),
		debug: () => {},
	};
	autoUpdater.on("checking-for-update", () => appliquer({ type: "checking-for-update" }));
	autoUpdater.on("update-available", info => appliquer({ type: "update-available", version: info.version }));
	autoUpdater.on("update-not-available", () => appliquer({ type: "update-not-available" }));
	autoUpdater.on("download-progress", p => appliquer({ type: "download-progress", percent: p.percent }));
	autoUpdater.on("update-downloaded", info => appliquer({ type: "update-downloaded", version: info.version }));
	// Le type de l'événement est `(error: Error, message?: string) => void` :
	// `error` n'est jamais absent, contrairement à ce qu'un `catch` laisserait
	// penser.
	autoUpdater.on("error", error => appliquer({ type: "error", message: error.message }));

	async function verifier(): Promise<void> {
		if (!app.isPackaged) {
			console.log(LOG_PREFIX, "mise à jour: ignorée hors d'un paquet (app.isPackaged faux)");
			return;
		}
		derniereVerification = Date.now();
		try {
			await autoUpdater.checkForUpdates();
		} catch (e) {
			// Déjà traduit en état par l'événement `error` ; ici seulement pour
			// qu'une promesse rejetée ne remonte pas en « unhandled ».
			console.warn(LOG_PREFIX, "mise à jour: vérification impossible:", e);
		}
	}

	function armerMinuteur(): void {
		if (minuteur) clearInterval(minuteur);
		minuteur = etat.auto ? setInterval(() => { void verifier(); }, PERIODE_MS) : null;
	}

	return {
		etat: () => etat,
		initialiser(auto) {
			etat = { ...etat, auto };
			armerMinuteur();
			if (auto) void verifier();
		},
		verifier,
		armerInstallation() {
			if (etat.phase !== "prete") return false;
			armee = true;
			return true;
		},
		installationArmee: () => armee,
		installerArmee() {
			autoUpdater.quitAndInstall(true, true);
		},
		async reglerAuto(auto) {
			await deps.reglages.ecrire(CLE_REGLAGES_MAJ, { auto });
			appliquer({ type: "reglage", auto });
			armerMinuteur();
			if (auto) void verifier();
		},
		surFocus() {
			if (!etat.auto || Date.now() - derniereVerification < GARDE_FOCUS_MS) return;
			void verifier();
		},
		arreter() {
			if (minuteur) clearInterval(minuteur);
			minuteur = null;
		},
	};
}

/** Le réglage persisté, ou vrai : la mise à jour automatique est le défaut. */
export async function lireReglageAuto(reglages: Reglages): Promise<boolean> {
	const v = await reglages.lire(CLE_REGLAGES_MAJ);
	return !(v && typeof v === "object" && (v as { auto?: unknown }).auto === false);
}
