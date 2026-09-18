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
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { setLanguage, t } from "../../../src/i18n";
import { PRODUCT_NAME } from "../../../src/branding";
import { langueDepuisLocale, NOM_EXECUTABLE, resoudrePaquet, URL_LATEST_YML, type LangueInstallateur, type PaquetInstallable } from "./noyau";
import {
	CANAUX_INSTALLATEUR,
	type ChargeTravailleur,
	type CodeErreurInstallateur,
	type EtatInstallateur,
	type MessageTravailleur,
} from "./protocole";
import { executerTravailleur } from "./worker";

const DRAPEAU_TRAVAILLEUR = "--neo-quiz-installer-worker";
const USER_AGENT = "Neo-Quiz-Installer";

let fenetre: BrowserWindow | null = null;
let paquetCourant: PaquetInstallable | null = null;
let socketTravailleur: Socket | null = null;
let serveurTube: Server | null = null;
let processusElevation: ReturnType<typeof spawn> | null = null;
let installationActive = false;
let fermetureAutorisee = false;
/** La langue de l'installeur : celle de Windows (`detecterLangue`). Lue par
    `main-ui.ts` pour ouvrir les pages légales dans la même langue. */
let langue: LangueInstallateur = "en";
/** Le dossier d'installation que le rendu affiche, tenu à jour par le
    principal : c'est LUI qui compose le chemin de l'exécutable à ouvrir. */
let dossierCourant = "";

export function langueInstallateur(): LangueInstallateur {
	return langue;
}

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
			case "installation":
				return v.pourcent === null || (typeof v.pourcent === "number" && Number.isFinite(v.pourcent))
					? { type: "installation", pourcent: v.pourcent } : null;
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
	/* `%LOCALAPPDATA%\Programs` (et non plus `Program Files`, 2026-09-18) :
	   c'est l'emplacement d'une installation PAR UTILISATEUR, le seul où écrire
	   ne demande pas l'élévation — ni maintenant, ni à chaque mise à jour. Même
	   dossier que VS Code et Discord. La raison complète est dans
	   `electron-builder.config.mjs`, `nsis.perMachine`.

	   La variable d'environnement est préférée au littéral pour respecter un
	   profil déplacé ; le repli reste le chemin conventionnel, et non
	   `Program Files`, qui ramènerait l'UAC par la porte de derrière. */
	const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? "C:\\Users\\Default", "AppData", "Local");
	return join(local, "Programs", PRODUCT_NAME);
}

/** Neo Quiz est-il DÉJÀ installé dans ce dossier ?

    LE BOOTSTRAPPER NE SERT QU'À LA PREMIÈRE INSTALLATION. Les mises à jour
    arrivent par electron-updater, depuis l'application elle-même, qui se
    ferme avant d'installer. Lancé PAR-DESSUS une installation existante, NSIS
    échoue dans `un.atomicRMDir` d'electron-builder — un `Rename` refusé, puis
    `un.restoreFiles` qui remet tout, puis `Abort` (code 2) — et l'utilisateur
    ne lit qu'« Échec de désinstallation des anciens fichiers d'application ».
    Vu à l'écran le 2026-09-16, y compris avec le bootstrapper PUBLIÉ : le
    défaut est antérieur à toute mesure de progression. Le dire AVANT le clic
    vaut mieux que de le laisser échouer après l'UAC et le téléchargement.

    LIMITE ASSUMÉE : on regarde le DOSSIER, pas le registre. Une installation
    déplacée ailleurs ne serait pas vue ici — NSIS, lui, la retrouverait par le
    registre et échouerait comme avant. Lire le registre demanderait `reg.exe`
    ou un module natif pour un cas qui ne s'est jamais produit. */
async function installationPresente(dossier: string): Promise<boolean> {
	try {
		await access(join(dossier, NOM_EXECUTABLE));
		return true;
	} catch {
		return false;
	}
}

function dossierValide(dossier: string): boolean {
	if (!isAbsolute(dossier)) return false;
	const normalise = resolve(dossier);
	return parse(normalise).root !== normalise;
}

/** Le `latest.yml` de la release courante, par la redirection
    `releases/latest/download/` de github.com — la même lecture que
    l'auto-updater de l'application, et SANS le quota de 60 requêtes par heure
    et par IP de l'API REST (voir `URL_LATEST_YML`). `fetch` suit lui-même les
    deux redirections (release, puis stockage des assets). */
async function chargerPaquet(): Promise<PaquetInstallable> {
	const reponse = await fetch(URL_LATEST_YML, {
		headers: { "User-Agent": USER_AGENT },
	});
	if (!reponse.ok) throw new Error("release indisponible");
	const paquet = resoudrePaquet(await reponse.text());
	if (!paquet) throw new Error("release invalide");
	return paquet;
}

function nettoyerSession(): void {
	const elevation = processusElevation;
	processusElevation = null;
	if (elevation && !elevation.killed) {
		try { elevation.kill(); } catch { /* déjà terminé */ }
	}
	socketTravailleur?.destroy();
	socketTravailleur = null;
	if (serveurTube) {
		try { serveurTube.close(); } catch { /* déjà fermé */ }
	}
	serveurTube = null;
	installationActive = false;
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
			envoyerEtat({ phase: "installation", pourcent: message.pourcent });
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
			/* L'installation est finie mais le bootstrapper RESTE à l'écran : le
			   rendu remplace la progression par un spinner pendant que Neo Quiz
			   s'initialise caché. Il ne disparaît qu'une fois la vraie fenêtre de
			   l'application devenue visible, donc réellement prête. */
			envoyerEtat({ phase: "demarrage" });
			const lancee = await lancerApplicationEtAttendre(message.executable);
			if (!lancee) {
				nettoyerSession();
				envoyerEtat({ phase: "erreur", code: "launch" });
				return;
			}
			nettoyerSession();
			fermetureAutorisee = true;
			fenetre?.close();
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

/** La langue de l'installeur : celle de Windows, comme l'application en
    mode « auto » (`electron/main.ts`). `app.getLocale()` n'est fiable
    qu'après `ready` — d'où l'appel depuis `whenReady`. Rien n'est écrit
    dans les réglages de l'application : elle fera la même déduction. */
function detecterLangue(): void {
	langue = langueDepuisLocale(app.getLocale());
}

/** L'application garde maintenant sa vraie fenêtre CACHÉE jusqu'au signal
    explicite `fenetre.prete()` envoyé après l'initialisation du rendu. Attendre
    une fenêtre Win32 VISIBLE revient donc exactement à attendre que Neo Quiz
    soit configuré et utilisable, pas seulement que Chromium ait peint du HTML. */
async function attendreFenetreApplication(pid: number): Promise<boolean> {
	const script = [
		"$ErrorActionPreference='Stop'",
		"Add-Type -Namespace NeoQuiz -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(System.IntPtr hWnd);'",
		"$p=[System.Diagnostics.Process]::GetProcessById([int]$env:NQ_APP_PID)",
		"$limite=[DateTime]::UtcNow.AddSeconds(30)",
		"while([DateTime]::UtcNow -lt $limite){$p.Refresh();if($p.HasExited){exit 3};$h=$p.MainWindowHandle;if($h -ne [IntPtr]::Zero -and [NeoQuiz.Native]::IsWindowVisible($h)){exit 0};Start-Sleep -Milliseconds 100}",
		"exit 2",
	].join("; ");
	return await new Promise<boolean>(resolvePromise => {
		const veille = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
			windowsHide: true,
			stdio: "ignore",
			env: { ...process.env, NQ_APP_PID: String(pid) },
		});
		veille.once("error", () => resolvePromise(false));
		veille.once("exit", code => resolvePromise(code === 0));
	});
}

/** Lance depuis le processus NON ÉLEVÉ, puis garde le bootstrapper à l'écran
    tant que Neo Quiz n'a pas rendu sa vraie fenêtre visible. Ce geste remplace
    `shell.openPath` précisément parce qu'il faut suivre le PID lancé. */
async function lancerApplicationEtAttendre(executable: string): Promise<boolean> {
	return await new Promise<boolean>(resolvePromise => {
		const enfant = spawn(executable, [], {
			detached: true,
			windowsHide: false,
			stdio: "ignore",
		});
		let resolu = false;
		const terminer = (ok: boolean): void => {
			if (resolu) return;
			resolu = true;
			resolvePromise(ok);
		};
		enfant.once("error", () => terminer(false));
		enfant.once("spawn", () => {
			const pid = enfant.pid;
			if (!pid) {
				terminer(false);
				return;
			}
			enfant.unref();
			void attendreFenetreApplication(pid).then(terminer);
		});
	});
}

async function lancerTravailleurEleve(nomTube: string, charge: string): Promise<number> {
	/* Le conteneur portable a déjà extrait Electron pour afficher l'UI.
	   Relancer PORTABLE_EXECUTABLE_FILE après l'UAC referait cette extraction
	   (~100 Mo dans les versions actuelles) avant le premier octet téléchargé.
	   Le binaire déjà extrait contient exactement la même app packagée et reste
	   vivant tant que cette fenêtre l'est : il peut donc servir de travailleur. */
	const executable = process.execPath;
	if (!isAbsolute(executable)) return -1;
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
		processusElevation = enfant;
		const terminer = (code: number): void => {
			if (processusElevation === enfant) processusElevation = null;
			resolvePromise(code);
		};
		enfant.once("error", () => terminer(-1));
		enfant.once("exit", code => terminer(code ?? -1));
	});
}

async function demarrerInstallation(dossier: string): Promise<void> {
	if (installationActive || !paquetCourant || !dossierValide(dossier)) {
		envoyerEtat({ phase: "erreur", code: "generic" });
		return;
	}
	installationActive = true;
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
		dossierCourant = dossier;
		return {
			version: paquetCourant.version,
			tailleTelechargement: paquetCourant.taille,
			dossier,
			espaceDisponible: await espaceDisponible(dossier),
			dejaInstalle: await installationPresente(dossier),
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
		dossierCourant = dossier;
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
		if (!installationActive) return;
		if (socketTravailleur) {
			socketTravailleur.write(`${JSON.stringify({ type: "annuler" })}\n`);
			return;
		}
		/* Avant l'authentification du travailleur, l'unique processus en attente
		   est PowerShell/RunAs. Le terminer ferme cette tentative UAC sans
		   laisser l'interface coincée sur un faux état d'attente. */
		nettoyerSession();
		envoyerEtat({ phase: "annule" });
	});
	/* Le rendu ne transmet aucun chemin : le principal lance l'exécutable du
	   dossier qu'il a lui-même calculé, et seulement s'il existe. */
	ipcMain.on(CANAUX_INSTALLATEUR.ouvrirApplication, () => {
		void (async () => {
			const executable = join(dossierCourant, NOM_EXECUTABLE);
			if (!(await installationPresente(dossierCourant))) return;
			try {
				spawn(executable, [], { detached: true, windowsHide: false, stdio: "ignore" }).unref();
			} catch {
				return;
			}
			fermetureAutorisee = true;
			fenetre?.close();
		})();
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
	/* La langue passe au rendu par l'URL : lue SYNCHRONEMENT avant le premier
	   rendu, là où un canal IPC arriverait après la première peinture — et le
	   rendu a sa propre instance d'i18n, `setLanguage` d'ici ne l'atteint pas. */
	void fenetre.loadFile(join(__dirname, "index.html"), { query: { lang: langue } });
	fenetre.webContents.once("dom-ready", () => {
		if (!fenetre || fenetre.isDestroyed()) return;
		fenetre.show();
		fenetre.focus();
	});
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
			detecterLangue();
			setLanguage(langue);
			installerCanaux();
			creerFenetre();
		});
		app.on("window-all-closed", () => {
			if (!installationActive) app.quit();
		});
	}
}
