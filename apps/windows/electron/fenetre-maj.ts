/* ══════════════════════════════════════════════════════════
   LA FENÊTRE QUI SURVIT À SA PROPRE MISE À JOUR — le câblage

   Le noyau, et le RAISONNEMENT qui le justifie, vivent dans
   `fenetre-maj-liens.ts` (sans Electron, donc éprouvable :
   `npm run check:fenetre-maj`). Ici il ne reste que ce qui touche Electron :
   lancer le processus, et montrer la fenêtre.

   DEUX PIÈGES QUI RENDRAIENT TOUT MUET SANS UNE ERREUR :

   - `--user-data-dir` PROPRE. Sans lui, le verrou d'instance unique
     (`requestSingleInstanceLock`, `main.ts`) joue entre cette fenêtre et
     l'application : soit la fenêtre quitte aussitôt, soit — bien pire — elle
     garde le verrou et c'est l'application RELANCÉE par NSIS qui quitte.
   - La fenêtre se lance AVANT l'installation. `installerArmee` ne revient pas,
     et NSIS tue aussitôt le processus de l'application : du code placé après
     ne s'exécuterait jamais.
══════════════════════════════════════════════════════════ */

import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { app, BrowserWindow } from "electron";
import { LOG_PREFIX, PRODUCT_NAME } from "../../../src/branding";
import { setLanguage, t } from "../../../src/i18n";
import {
	cheminTemoin,
	DRAPEAU_FENETRE_MAJ,
	type LangueFenetre,
	preparerReflet,
} from "./fenetre-maj-liens";

export {
	DRAPEAU_FENETRE_MAJ,
	langueDepuisArguments,
	marquerDemarrage,
	nettoyerLiensMaj,
	versionDepuisArguments,
} from "./fenetre-maj-liens";

/** Prépare le reflet puis LANCE la fenêtre, détachée de l'application qui va
    mourir. Renvoie vrai si la fenêtre a bien démarré.

    Si le reflet échoue (volume différent, temporaire inaccessible), la mise à
    jour se fait comme avant, en silence : une mise à jour sans fenêtre vaut
    mieux qu'une mise à jour empêchée. */
export async function lancerFenetreMaj(version: string, langue: LangueFenetre): Promise<boolean> {
	if (process.platform !== "win32") return false;
	const executable = app.getPath("exe");
	const exeLie = await preparerReflet(dirname(executable), basename(executable));
	if (!exeLie) return false;
	try {
		const enfant = spawn(exeLie, [
			DRAPEAU_FENETRE_MAJ,
			version,
			langue,
			/* Le profil est à cette fenêtre SEULE — voir l'en-tête. */
			`--user-data-dir=${join(dirname(exeLie), "profil")}`,
		], { detached: true, windowsHide: false, stdio: "ignore" });
		enfant.unref();
		return true;
	} catch (erreur) {
		console.error(LOG_PREFIX, "fenêtre de mise à jour non lancée:", erreur);
		await rm(dirname(exeLie), { recursive: true, force: true }).catch(() => undefined);
		return false;
	}
}

/** Au-delà, la fenêtre s'efface quoi qu'il arrive. Une mise à jour qui échoue
    ne doit pas laisser un bandeau perpétuel sur le bureau : le pire qu'on
    risque alors est une fenêtre partie trop tôt, jamais une fenêtre coincée.
    La mise à jour mesurée dure 10,5 s sur NVMe ; trois minutes couvrent un
    disque lent avec une marge que personne n'atteindra. */
const EXPIRATION_MS = 3 * 60 * 1000;
const INTERVALLE_TEMOIN_MS = 400;

/** LE PROCESSUS FENÊTRE : ouvre la fenêtre, attend le témoin de l'application
    relancée, puis rend la main. */
export async function afficherFenetreMaj(version: string, langue: LangueFenetre): Promise<void> {
	setLanguage(langue);
	const temoin = cheminTemoin();
	/* Le témoin d'un démarrage PASSÉ ne doit pas faire refermer la fenêtre
	   aussitôt : on efface avant d'ouvrir, et seul un témoin neuf compte. */
	await rm(temoin, { force: true }).catch(() => undefined);

	const fenetre = new BrowserWindow({
		width: 480,
		height: 300,
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		center: true,
		frame: false,
		/* Comme le bootstrapper : sans `thickFrame`, Windows 11 ne dessine ni
		   contour ni coins arrondis — c'est le CSS qui porte l'arrondi, et la
		   fenêtre doit donc être transparente. */
		thickFrame: false,
		transparent: true,
		show: false,
		title: PRODUCT_NAME,
		webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
	});
	fenetre.setMenuBarVisibility(false);
	/* Au-dessus du bureau que laisse l'application fermée, sans voler le focus
	   à ce que l'utilisateur fait pendant ce temps. */
	fenetre.setAlwaysOnTop(true, "normal");

	await fenetre.loadFile(join(__dirname, "maj", "index.html"));
	/* Les textes sont POSÉS après chargement : la page n'a aucun script (sa
	   politique de sécurité l'interdit), et c'est bien ainsi — elle n'affiche
	   que ce que le principal lui donne. */
	const detail = version
		? `${t("app.update.window.version", { version })} — ${t("app.update.window.detail")}`
		: t("app.update.window.detail");
	await fenetre.webContents.executeJavaScript(
		`document.getElementById("titre").textContent = ${JSON.stringify(t("app.update.window.title"))};` +
		`document.getElementById("detail").textContent = ${JSON.stringify(detail)};`,
	).catch(() => undefined);
	fenetre.show();

	const debut = Date.now();
	await new Promise<void>(termine => {
		const minuteur = setInterval(() => {
			void (async () => {
				let vu = false;
				try {
					vu = (await stat(temoin)).mtimeMs >= debut;
				} catch { /* pas encore de témoin */ }
				if (vu || Date.now() - debut > EXPIRATION_MS) {
					clearInterval(minuteur);
					termine();
				}
			})();
		}, INTERVALLE_TEMOIN_MS);
	});
	if (!fenetre.isDestroyed()) fenetre.close();
}
