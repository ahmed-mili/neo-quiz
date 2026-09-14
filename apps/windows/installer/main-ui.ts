import { access, statfs } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { CANAUX_INSTALLATEUR, type InfosDisqueInstallateur } from "./protocole";
import "./main";

const URL_COMMENTAIRES = "https://github.com/ahmed-mili/neo-quiz/issues/new";
const LARGEUR_FENETRE = 920;
const HAUTEUR_FENETRE = 684;

/* Le processus principal historique garde toute la logique sensible
   d'installation. Cette couche n'ajoute que les besoins de présentation du
   mockup afin de ne pas mêler l'habillage de la fenêtre à l'élévation UAC. */

async function ancetreExistant(dossier: string): Promise<string> {
	let courant = resolve(dossier);
	for (;;) {
		try {
			await access(courant);
			return courant;
		} catch {
			const parent = dirname(courant);
			if (parent === courant) throw new Error("aucun ancêtre accessible");
			courant = parent;
		}
	}
}

async function infosDisque(dossier: string): Promise<InfosDisqueInstallateur> {
	const base = await ancetreExistant(dossier);
	const stats = await statfs(base);
	return {
		espaceDisponible: Math.max(0, stats.bavail * stats.bsize),
		espaceTotal: Math.max(0, stats.blocks * stats.bsize),
	};
}

ipcMain.handle(CANAUX_INSTALLATEUR.espaceDisque, async (_event, dossier: unknown) => {
	if (typeof dossier !== "string") throw new Error("dossier invalide");
	return await infosDisque(dossier);
});

ipcMain.on(CANAUX_INSTALLATEUR.reduire, event => {
	const fenetre = BrowserWindow.fromWebContents(event.sender);
	if (fenetre && !fenetre.isDestroyed()) fenetre.minimize();
});

ipcMain.on(CANAUX_INSTALLATEUR.commentaires, () => {
	void shell.openExternal(URL_COMMENTAIRES);
});

void app.whenReady().then(() => {
	/* La référence fournie correspond à ce rapport largeur/hauteur. Le principal
	   historique reste inchangé ; on recale uniquement la fenêtre visible après
	   sa création afin que les coordonnées CSS gardent la même géométrie. */
	const fenetre = BrowserWindow.getAllWindows()[0];
	if (!fenetre || fenetre.isDestroyed()) return;
	fenetre.setMaximumSize(LARGEUR_FENETRE, HAUTEUR_FENETRE);
	fenetre.setMinimumSize(LARGEUR_FENETRE, HAUTEUR_FENETRE);
	fenetre.setSize(LARGEUR_FENETRE, HAUTEUR_FENETRE);
	fenetre.center();
});
