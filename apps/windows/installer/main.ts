/* ══════════════════════════════════════════════════════════
   PROCESSUS PRINCIPAL DU BOOTSTRAPPER

   La fenêtre est volontairement NON élevée : l'UAC n'apparaît qu'après le
   clic sur Installer. Le même portable est alors relancé avec `runas` dans un
   mode travailleur sans fenêtre. Le processus initial garde l'UI et lance
   l'application finale, afin que Neo Quiz démarre avec les droits ordinaires
   de l'utilisateur et non ceux du travailleur administrateur.
══════════════════════════════════════════════════════════ */

import { randomBytes, randomUUID } from "node:crypto";
import { access, statfs } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { spawn } from "node:child_process";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { setLanguage, t } from "../../../src/i18n";
import { PRODUCT_NAME } from "../../../src/branding";
import { resoudrePaquet, type PaquetInstallable, type ReleaseGithub } from "./noyau";
import {
	CANAUX_INSTALLATEUR,
	type ChargeTravailleur,
	type CodeErreurInstallateur,
	type EtatInstallateur,
	type MessageTravailleur,
} from "./protocole";
import { executerTravailleur } from "./worker";

const DRAPEAU_TRAVAILLEUR = "--neo-quiz-installer-worker";
const API_RELEASE = "https://api.github.com/repos/ahmed-mili/neo-quiz/releases/latest";
const USER_AGENT = "Neo-Quiz-Installer";

let fenetre: BrowserWindow | null = null;
let paquetCourant: PaquetInstallable | null = null;
let socketTravailleur: Socket | null = null;
let serveurTube: Server | null = null;
let installationActive = false;
let installationCritique = false;
let fermetureAutorisee = false;

function argumentsTravailleur(): { tube: string; charge: string } | null {
	const index = process.argv.indexOf(DRAPEAU_TRAVAILLEUR);
	if (index < 0) return null;
	const tube = process.argv[index + 1];
	const charge = process.argv[index + 2];
	return tube && charge ? { tube, charge } : null;
}

function envoyerEtat(etat: EtatInstallateur): void {
	if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send(CANAUX_INSTALLATEUR.etat, etat);
}

function codeErreur(value: unknown): CodeErreurInstallateur {
	return value === "network" || value === "elevation" || value === "integrity" ||
		value === "installation" || value === "release" || value === "launch"
		? value : "generic";
}

function decoderMessage(ligne: string): MessageTravailleur | null {
	try {
		const value: unknown = JSON.parse(ligne);
		if (!value || typeof value !== "object") return null;
		const v = value as Record<string, unknown>;
		switch (v.type) {
			case "auth":
				return typeof v.secret === "string" ? { type: "auth", secret: v.secret } : null;
			case "telechargement":
				return typeof v.recus === "number" && typeof v.total === "number"
					? { type: "telechargement", recus: v.recus, total: v.total } : null;
			case "verification": return { type: "verification" };
			case "installation": return { type: "installation" };
			case "termine": return typeof v.executable === "string" ? { type: "termine", executable: v.executable } : null;
			case "annule": return { type: "annule" };
			case "erreur": return { type: "erreur", code: codeErreur(v.code) };
			default: return null;
		}
	} catch {
		return null;
	}
}

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

async function espaceDisponible(dossier: string): Promise<number> {
	const base = await ancetreExistant(dossier);
	const stats = await statfs(base);
	return Math.max(0, stats.bavail * stats.bsize);
}

function dossierDefaut(): string {
	/* Une installation machine doit partir du dossier système destiné aux
	   programmes. Les variables Windows sont préférées au littéral pour
	   respecter une installation déplacée de Program Files. */
	const programmes = process.env.ProgramW6432 ?? process.env.ProgramFiles ?? "C:\\Program Files";
	return join(programmes, PRODUCT_NAME);
}

function dossierValide(dossier: string): boolean {
	if (!isAbsolute(dossier)) return false;
	const normalise = resolve(dossier);
	return parse(normalise).root !== normalise;
}

async function chargerPaquet(): Promise<PaquetInstallable> {
	const reponse = await fetch(API_RELEASE, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": USER_AGENT,
		},
	});
	if (!reponse.ok) throw new Error("release indisponible");
	const json: unknown = await reponse.json();
	let paquet: PaquetInstallable | null = null;
	try {
		paquet = resoudrePaquet(json as ReleaseGithub);
	} catch {
		paquet = null;
	}
	if (!paquet) throw new Error("release invalide");
	return paquet;
}

function nettoyerSession(): void {
	socketTravailleur?.destroy();
	socketTravailleur = null;
	if (serveurTube) {
		try { serveurTube.close(); } catch { /* déjà fermé */ }
	}
	serveurTube = null;
	installationActive = false;
	installationCritique = false;
}

async function traiterMessage(message: MessageTravailleur): Promise<void> {
	switch (message.type) {
		case "auth":
			return;
		case "telechargement":
			envoyerEtat({ phase: "telechargement", recus: message.recus, total: message.total });
			return;
		case "verification":
			envoyerEtat({ phase: "verification" });
			return;
		case "installation":
			installationCritique = true;
			envoyerEtat({ phase: "installation" });
			return;
		case "annule":
			nettoyerSession();
			envoyerEtat({ phase: "annule" });
			return;
		case "erreur":
			nettoyerSession();
			envoyerEtat({ phase: "erreur", code: message.code });
			return;
		case "termine": {
			if (!isAbsolute(message.executable)) {
				nettoyerSession();
				envoyerEtat({ phase: "erreur", code: "installation" });
				return;
			}
			const erreur = await shell.openPath(message.executable);
			if (erreur) {
				nettoyerSession();
				envoyerEtat({ phase: "erreur", code: "launch" });
				return;
			}
			nettoyerSession();
			fermetureAutorisee = true;
			app.quit();
			return;
		}
	}
}

async function ecouterTravailleur(nomTube: string, secret: string): Promise<void> {
	const serveur = createServer(socket => {
		if (socketTravailleur) {
			socket.destroy();
			return;
		}
		socket.setEncoding("utf8");
		let reste = "";
		let authentifie = false;
		socket.on("data", morceau => {
			reste += morceau;
			for (;;) {
				const fin = reste.indexOf("\n");
				if (fin < 0) break;
				const ligne = reste.slice(0, fin);
				reste = reste.slice(fin + 1);
				const message = decoderMessage(ligne);
				if (!message) continue;
				if (!authentifie) {
					if (message.type !== "auth" || message.secret !== secret) {
						socket.destroy();
						return;
					}
					authentifie = true;
					socketTravailleur = socket;
					continue;
				}
				void traiterMessage(message);
			}
		});
		socket.on("close", () => {
			if (socketTravailleur === socket) socketTravailleur = null;
		});
	});
	serveurTube = serveur;
	await new Promise<void>((resolvePromise, reject) => {
		const surErreur = (erreur: Error): void => reject(erreur);
		serveur.once("error", surErreur);
		serveur.listen(nomTube, () => {
			serveur.off("error", surErreur);
			resolvePromise();
		});
	});
}

function executablePortable(): string | null {
	/* `process.execPath` pointe l'exe EXTRAIT dans `%TEMP%`. L'élever ferait
	   afficher à l'UAC la signature de ce fichier interne, pas celle du
	   portable téléchargé. electron-builder fournit le chemin du portable
	   d'origine précisément via cette variable. */
	const chemin = process.env.PORTABLE_EXECUTABLE_FILE;
	return chemin && isAbsolute(chemin) ? chemin : null;
}

async function lancerTravailleurEleve(nomTube: string, charge: string): Promise<number> {
	const executable = executablePortable();
	if (!executable) return -1;
	const script = [
		"$ErrorActionPreference='Stop'",
		"$a=@('--neo-quiz-installer-worker',$env:NQ_INSTALLER_PIPE,$env:NQ_INSTALLER_PAYLOAD)",
		"try { $p=Start-Process -FilePath $env:NQ_INSTALLER_EXE -ArgumentList $a -Verb RunAs -PassThru -Wait; exit $p.ExitCode } catch { exit 1223 }",
	].join("; ");
	return await new Promise<number>(resolvePromise => {
		const enfant = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
			windowsHide: true,
			stdio: "ignore",
			env: {
				...process.env,
				NQ_INSTALLER_EXE: executable,
				NQ_INSTALLER_PIPE: nomTube,
				NQ_INSTALLER_PAYLOAD: charge,
			},
		});
		enfant.once("error", () => resolvePromise(-1));
		enfant.once("exit", code => resolvePromise(code ?? -1));
	});
}

async function demarrerInstallation(dossier: string): Promise<void> {
	if (installationActive || !paquetCourant || !dossierValide(dossier)) {
		envoyerEtat({ phase: "erreur", code: "generic" });
		return;
	}
	installationActive = true;
	installationCritique = false;
	envoyerEtat({ phase: "elevation" });

	const nomTube = `\\\\.\\pipe\\neo-quiz-installer-${randomUUID()}`;
	const secret = randomBytes(32).toString("hex");
	const charge: ChargeTravailleur = { secret, dossier: resolve(dossier), paquet: paquetCourant };
	const encodee = Buffer.from(JSON.stringify(charge), "utf8").toString("base64url");

	try {
		await ecouterTravailleur(nomTube, secret);
	} catch {
		nettoyerSession();
		envoyerEtat({ phase: "erreur", code: "generic" });
		return;
	}

	const code = await lancerTravailleurEleve(nomTube, encodee);
	/* Le travailleur envoie lui-même tout échec APRÈS authentification. Si
	   aucun socket n'a jamais été authentifié, le seul événement visible est
	   le refus ou l'échec de l'élévation Windows. */
	if (installationActive && !socketTravailleur && code !== 0) {
		nettoyerSession();
		envoyerEtat({ phase: "erreur", code: "elevation" });
	}
}

function installerCanaux(): void {
	ipcMain.handle(CANAUX_INSTALLATEUR.initialiser, async () => {
		paquetCourant = await chargerPaquet();
		const dossier = dossierDefaut();
		return {
			version: paquetCourant.version,
			tailleTelechargement: paquetCourant.taille,
			dossier,
			espaceDisponible: await espaceDisponible(dossier),
		};
	});
	ipcMain.handle(CANAUX_INSTALLATEUR.choisirDossier, async (_event, courant: unknown) => {
		if (typeof courant !== "string" || !dossierValide(courant) || !fenetre) return null;
		const choix = await dialog.showOpenDialog(fenetre, {
			title: t("installer.location.choose"),
			defaultPath: courant,
			properties: ["openDirectory", "createDirectory"],
		});
		const dossier = choix.canceled ? null : choix.filePaths[0];
		if (!dossier || !dossierValide(dossier)) return null;
		return { dossier, espaceDisponible: await espaceDisponible(dossier) };
	});
	ipcMain.handle(CANAUX_INSTALLATEUR.installer, async (_event, dossier: unknown) => {
		if (typeof dossier !== "string") {
			envoyerEtat({ phase: "erreur", code: "generic" });
			return;
		}
		await demarrerInstallation(dossier);
	});
	ipcMain.handle(CANAUX_INSTALLATEUR.annuler, async () => {
		if (!installationActive || installationCritique || !socketTravailleur) return;
		socketTravailleur.write(`${JSON.stringify({ type: "annuler" })}\n`);
	});
	ipcMain.on(CANAUX_INSTALLATEUR.fermer, () => {
		if (installationActive) return;
		fermetureAutorisee = true;
		fenetre?.close();
	});
}

function creerFenetre(): void {
	fenetre = new BrowserWindow({
		width: 920,
		height: 640,
		minWidth: 920,
		minHeight: 640,
		maxWidth: 920,
		maxHeight: 640,
		frame: false,
		/* Sans `thickFrame`, Windows 11 ne dessine plus son contour DWM d'un
		   pixel clair autour de la fenêtre (visible sur fond noir). La fenêtre
		   n'est pas redimensionnable : la bordure de saisie ne manque à rien. */
		thickFrame: false,
		/* Sans `thickFrame`, Windows 11 n'arrondit plus les coins non plus :
		   la fenêtre devient TRANSPARENTE et c'est le CSS de `#app` qui porte
		   l'arrondi (`style-window.css`). Pas de `backgroundColor` : il
		   peindrait un rectangle opaque sous les coins. */
		transparent: true,
		resizable: false,
		show: false,
		icon: join(__dirname, "icon.png"),
		title: t("installer.windowTitle"),
		webPreferences: {
			preload: join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	fenetre.setMenuBarVisibility(false);
	void fenetre.loadFile(join(__dirname, "index.html"));
	fenetre.once("ready-to-show", () => fenetre?.show());
	fenetre.on("close", evenement => {
		if (installationActive && !fermetureAutorisee) evenement.preventDefault();
	});
	fenetre.on("closed", () => { fenetre = null; });
}

const travailleur = argumentsTravailleur();
if (travailleur) {
	void app.whenReady().then(async () => {
		const code = await executerTravailleur(travailleur.tube, travailleur.charge);
		app.exit(code);
	});
} else {
	const verrou = app.requestSingleInstanceLock();
	if (!verrou) {
		app.quit();
	} else {
		app.on("second-instance", () => {
			if (!fenetre) return;
			if (fenetre.isMinimized()) fenetre.restore();
			fenetre.show();
			fenetre.focus();
		});
		void app.whenReady().then(() => {
			setLanguage(/^fr\b/i.test(app.getLocale().replace(/_/g, "-")) ? "fr" : "en");
			installerCanaux();
			creerFenetre();
		});
		app.on("window-all-closed", () => {
			if (!installationActive) app.quit();
		});
	}
}
