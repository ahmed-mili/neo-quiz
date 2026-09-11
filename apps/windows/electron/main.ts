/* ══════════════════════════════════════════════════════════
   LE PROCESSUS PRINCIPAL — LA FENÊTRE, ET LE SEUL CÔTÉ QUI TOUCHE LE DISQUE

   Tâche 3 de la migration Tauri → Electron
   (docs/superpowers/plans/2026-09-11-migration-electron.md). Ce fichier ouvre
   la fenêtre, branche les primitives des tâches 1 et 2, et enregistre un
   gestionnaire par méthode du pont (`./pont.ts`).

   LES TROIS DRAPEAUX DE LA FENÊTRE NE SE NÉGOCIENT PAS —
   `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Neo Quiz
   rend du HTML qui n'est PAS toujours celui de l'utilisateur : un quiz PARTAGÉ
   arrive avec les `explainHtml` de son auteur, et ce HTML est traité par notre
   propre chaîne de rendu (`CLAUDE.md`, « Texte et HTML d'un quiz : quatre
   portes »). Avec `nodeIntegration`, une seule porte oubliée donnerait à ce
   HTML un `require("child_process")` — l'accès complet à la machine. Les trois
   sont écrits EXPLICITEMENT même quand ils sont déjà le défaut d'Electron :
   un défaut peut changer d'une version majeure à l'autre sans rien casser de
   visible, et personne ne relit une ligne absente.

   AUCUN `ipcMain.on` : tout est `ipcMain.handle`. Un canal sans réponse ne
   peut pas être attendu, et l'appelant ne saurait jamais si son écriture a
   réussi. Le seul sens principal → rendu est `webContents.send` du surveillant
   (`CANAUX.evenement`) et l'appel de fermeture, auquel le rendu RÉPOND par un
   `invoke`.
══════════════════════════════════════════════════════════ */

import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import * as path from "node:path";
import { LOG_PREFIX, PRODUCT_NAME } from "../../../src/branding";
import type { HostFileEvent } from "../../../src/host/types";
import { creerFichiers, stat } from "./fichiers";
import { absoluDepuisContrat, contratDepuisAbsolu, creerIndex } from "./index-fichiers";
import type { Index } from "./index-fichiers";
import { listerRacine, normaliser } from "./parcours";
import { CANAUX } from "./pont";
import type { EvenementDisque } from "./pont";
import { creerReglages } from "./reglages";
import type { Reglages } from "./reglages";
import { vaultsObsidian } from "./vaults";

/** Le serveur de développement de Vite. Le port vient de `vite.config.ts`
    (`strictPort: true`) : s'il change là-bas, il change ici. */
const URL_DEV = process.env.NEO_DEV_SERVER ?? "http://localhost:1421";

/** Les mêmes dimensions que la fenêtre Tauri (`src-tauri/tauri.conf.json`) :
    ce n'est pas une application neuve, c'est la même qui change de coquille. */
const FENETRE = { width: 1280, height: 840, minWidth: 900, minHeight: 600 };

/**
 * Le délai après lequel la fenêtre se ferme MÊME SI le rendu n'a pas répondu.
 *
 * Sans lui, un rendu figé (ou déjà mort) rendrait la fenêtre INFERMABLE —
 * exactement le piège documenté côté Tauri, où un `destroy()` refusé par les
 * permissions empêchait toute fermeture après l'ajout d'un écouteur. C'est la
 * tâche 5 (« la fermeture qui attend l'écriture ») qui fixera sa valeur
 * définitive au regard des trois écrivains différés ; ici il n'est qu'un
 * garde-fou.
 */
const DELAI_GARDE_FERMETURE_MS = 3000;

/* ─────────── état du processus ─────────── */

const fichiers = creerFichiers();
let fenetre: BrowserWindow | null = null;
let reglages: Reglages | null = null;
/** Les racines déclarées par `demarrer`, normalisées. */
let racinesAbs: string[] = [];
let index: Index | null = null;
let arreterSurveillance: (() => void) | null = null;
let fermetureArmee = false;
let fermetureEnCours = false;
let gardeFermeture: NodeJS.Timeout | null = null;

/* ─────────── ce qui franchit le pont ─────────── */

/**
 * L'événement du surveillant, retraduit en chemin ABSOLU.
 *
 * L'index porte une convention INTERNE (« 0/Cours/ch1.md », l'indice de la
 * racine en tête) qui ne franchit JAMAIS le pont : les chemins du CONTRAT sont
 * les clés du journal de révision, et `src/host/types.ts` avertit qu'un second
 * endroit qui les recomposerait ferait diverger deux historiques sans que
 * personne ne le voie. Le rendu, qui tient `CarteRacines`, est ce seul endroit.
 *
 * `rename` ne peut pas arriver (l'index n'émet que `create`/`modify`/`delete`
 * depuis chokidar) — le `null` est là pour que le jour où il en émettrait un,
 * ce soit un silence visible à la lecture plutôt qu'un `abs` indéfini poussé
 * dans la fenêtre.
 */
function versDisque(ev: HostFileEvent): EvenementDisque | null {
	if (ev.kind === "rename") return null;
	const contrat = ev.kind === "delete" ? ev.path : ev.file.path;
	const absolu = absoluDepuisContrat(racinesAbs, contrat);
	if (!absolu) return null;
	const abs = normaliser(absolu);
	return ev.kind === "delete" ? { kind: "delete", abs } : { kind: ev.kind, abs, mtime: ev.file.mtime };
}

/** Le `mtime` que l'écriture vient de produire — voir « LES QUATRE ÉCRITURES
    RENDENT LE `mtime` NEUF » dans `pont.ts`. Un `stat` qui échoue rend 0 plutôt
    que de faire échouer une écriture qui, elle, a réussi : la refuser après
    coup serait mentir dans l'autre sens. */
async function fraicheur(abs: string): Promise<{ mtime: number }> {
	const info = await stat(abs);
	return { mtime: info ? info.mtime : 0 };
}

/**
 * Écrit un fichier TEXTE, par l'index quand le chemin tombe sous une racine.
 *
 * POURQUOI PASSER PAR L'INDEX, alors que le `mtime` rendu à la fenêtre vient
 * d'un `stat` et pas de lui : l'index du principal sert de garde au
 * surveillant (`surSuppression` n'annonce la disparition que d'un fichier
 * qu'il connaît). Une note créée puis mise à la corbeille dans la même fenêtre
 * de débounce n'y serait jamais entrée, sa suppression serait donc AVALÉE, et
 * le miroir du rendu — qui, lui, l'a apprise par le `mtime` rendu ici —
 * garderait un quiz fantôme que plus rien ne peut retirer.
 *
 * `writeBinary` et `append` ne passent pas par là : l'index n'a pas de variante
 * binaire, et le seul appelant d'`append` (le journal de révision) écrit sous
 * `.neo-quiz/`, hors catalogue par construction.
 */
async function ecrireTexte(abs: string, contenu: string): Promise<void> {
	const contrat = index ? contratDepuisAbsolu(racinesAbs, normaliser(abs)) : null;
	if (index && contrat) await index.write(contrat, contenu);
	else await fichiers.write(abs, contenu);
}

/* ─────────── les canaux ─────────── */

/** Les réglages, ou une erreur NOMMÉE : un `null` silencieux ferait repartir
    l'utilisateur de l'écran de choix sans que rien ne dise pourquoi. */
function reglagesOuErreur(): Reglages {
	if (!reglages) throw new Error("réglages non initialisés : l'application n'est pas prête");
	return reglages;
}

function enregistrerCanaux(): void {
	ipcMain.handle(CANAUX.demarrer, async (_e, racines: string[]) => {
		/* Un second appel REMPLACE : le rendu recharge la page quand les racines
		   changent, et laisser vivre l'ancien surveillant ferait pousser dans la
		   fenêtre des événements portant les indices de l'ancienne liste. */
		arreterSurveillance?.();
		arreterSurveillance = null;
		racinesAbs = (Array.isArray(racines) ? racines : []).map(normaliser);
		index = creerIndex(racinesAbs);
	});

	ipcMain.handle(CANAUX.read, (_e, abs: string) => fichiers.read(abs));
	ipcMain.handle(CANAUX.readCached, (_e, abs: string) => fichiers.readCached(abs));

	ipcMain.handle(CANAUX.write, async (_e, abs: string, contenu: string) => {
		await ecrireTexte(abs, contenu);
		return await fraicheur(abs);
	});

	ipcMain.handle(CANAUX.lirePourEcriture, async (_e, abs: string) => {
		// `read` et non `readCached` : c'est la moitié LECTURE d'un
		// lire-modifier-écrire, elle doit voir le disque tel qu'il est.
		const contenu = await fichiers.read(abs);
		const { mtime } = await fraicheur(abs);
		return { contenu, mtime };
	});

	/* La seconde moitié de `process` — voir « `process`, EN DEUX TEMPS » dans
	   `pont.ts`. La comparaison porte sur le CONTENU : un `mtime` dont la
	   granularité vaut plusieurs millisecondes ne distinguerait pas deux
	   écritures rapprochées. `null` n'est pas une erreur, c'est la réponse
	   « le fichier a changé, rejoue ton rappel ». */
	ipcMain.handle(CANAUX.ecrireSiInchange, async (_e, abs: string, lu: string, contenu: string) => {
		const actuel = await fichiers.read(abs);
		if (actuel !== lu) return null;
		await ecrireTexte(abs, contenu);
		return await fraicheur(abs);
	});

	ipcMain.handle(CANAUX.writeBinary, async (_e, abs: string, data: Uint8Array) => {
		await fichiers.writeBinary(abs, data);
		return await fraicheur(abs);
	});

	ipcMain.handle(CANAUX.append, async (_e, abs: string, contenu: string) => {
		await fichiers.append(abs, contenu);
		return await fraicheur(abs);
	});

	ipcMain.handle(CANAUX.exists, (_e, abs: string) => fichiers.exists(abs));
	ipcMain.handle(CANAUX.mkdirs, (_e, abs: string) => fichiers.mkdirs(abs));
	ipcMain.handle(CANAUX.trash, (_e, abs: string, racine: string) => fichiers.trash(abs, racine));
	/* NORMALISÉE : `fichiers.list` compose ses chemins avec `path.join`, donc
	   avec des `\` sous Windows. Tout ce qui franchit le pont doit avoir la même
	   forme, sinon le miroir du rendu tiendrait deux clés pour un seul fichier. */
	ipcMain.handle(CANAUX.list, async (_e, dossier: string) =>
		(await fichiers.list(dossier)).map(normaliser));
	ipcMain.handle(CANAUX.remove, (_e, abs: string) => fichiers.remove(abs));
	ipcMain.handle(CANAUX.rename, (_e, de: string, vers: string) => fichiers.rename(de, vers));
	ipcMain.handle(CANAUX.stat, (_e, abs: string) => stat(abs));
	ipcMain.handle(CANAUX.liste, (_e, racine: string) => listerRacine(racine));

	ipcMain.handle(CANAUX.surveiller, () => {
		/* La cause est NOMMÉE : un surveillant qui ne démarre pas en silence
		   donnerait une fenêtre où rien ne se met plus à jour, sans erreur. */
		if (!index) throw new Error("surveiller() avant demarrer() : aucune racine déclarée");
		if (arreterSurveillance) return; // déjà monté : un second watcher serait redondant.
		arreterSurveillance = index.surveiller(ev => {
			const disque = versDisque(ev);
			if (!disque || !fenetre || fenetre.isDestroyed()) return;
			fenetre.webContents.send(CANAUX.evenement, disque);
		});
	});

	ipcMain.handle(CANAUX.choisirDossier, async () => {
		const choix = await dialog.showOpenDialog({ properties: ["openDirectory"] });
		// Annulation : la réponse « non », pas une erreur.
		if (choix.canceled || choix.filePaths.length === 0) return null;
		return normaliser(choix.filePaths[0]);
	});

	ipcMain.handle(CANAUX.reglagesLire, (_e, cle: string) => reglagesOuErreur().lire(cle));
	ipcMain.handle(CANAUX.reglagesEcrire, (_e, cle: string, valeur: unknown) => reglagesOuErreur().ecrire(cle, valeur));
	ipcMain.handle(CANAUX.reglagesSupprimer, (_e, cle: string) => reglagesOuErreur().supprimer(cle));

	ipcMain.handle(CANAUX.ouvrir, async (_e, abs: string) => {
		/* `shell.openPath` rend une CHAÎNE : vide en cas de succès, le message
		   du système sinon. `HostShell.openExternal` attend un booléen dont
		   `engine/resources.ts` se sert pour prévenir l'utilisateur. */
		const erreur = await shell.openPath(path.normalize(abs));
		if (erreur) console.warn(LOG_PREFIX, "ouverture impossible:", abs, erreur);
		return !erreur;
	});

	ipcMain.handle(CANAUX.vaultsObsidian, () => vaultsObsidian());

	ipcMain.handle(CANAUX.armerFermeture, () => {
		fermetureArmee = true;
	});
	ipcMain.handle(CANAUX.fermetureTerminee, () => {
		terminerFermeture();
	});
}

/* ─────────── la fermeture ─────────── */

/** Ferme pour de bon : annule le garde-fou et détruit la fenêtre. Idempotente
    — le rendu peut répondre alors que le délai vient d'expirer. */
function terminerFermeture(): void {
	if (gardeFermeture) {
		clearTimeout(gardeFermeture);
		gardeFermeture = null;
	}
	if (fenetre && !fenetre.isDestroyed()) fenetre.destroy();
}

/* ─────────── la fenêtre ─────────── */

/** Charge le rendu, en réessayant tant que le serveur de développement n'écoute
    pas encore : `npm run dev` lance Vite et Electron EN PARALLÈLE, et Electron
    est souvent prêt le premier. Sans réessai, la fenêtre s'ouvrirait une fois
    sur deux sur une page d'erreur, selon la machine. */
async function charger(cible: BrowserWindow): Promise<void> {
	const fichierRendu = path.join(__dirname, "..", "dist", "index.html");
	if (app.isPackaged) {
		await cible.loadFile(fichierRendu);
		return;
	}
	for (let essai = 0; essai < 40; essai++) {
		try {
			await cible.loadURL(URL_DEV);
			return;
		} catch {
			await new Promise(r => setTimeout(r, 250));
		}
	}
	/* Pas de serveur de développement : on retombe sur le rendu construit,
	   s'il existe. Un `npm run build` suivi d'`electron .` passe par là. */
	await cible.loadFile(fichierRendu);
}

function creerFenetre(): void {
	fenetre = new BrowserWindow({
		...FENETRE,
		title: PRODUCT_NAME,
		/* La fenêtre n'apparaît qu'une fois peinte : sans ça, on voit d'abord un
		   rectangle blanc, puis le thème sombre — un clignotement à chaque
		   lancement. */
		show: false,
		backgroundColor: "#1e1e1e",
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			// LES TROIS DRAPEAUX — voir l'en-tête de ce fichier.
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	fenetre.once("ready-to-show", () => fenetre?.show());

	/* Un quiz PARTAGÉ peut contenir un lien : qu'il ouvre une seconde fenêtre
	   Electron n'a aucun sens ici, et une fenêtre ouverte par la page hériterait
	   de préférences que nous n'aurions pas choisies. Refus systématique. */
	fenetre.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

	/* MESURÉ SUR ELECTRON 44, et la tâche 5 doit le savoir : cet événement est
	   émis par le chemin UTILISATEUR (la croix, Alt+F4, la barre des tâches —
	   un WM_CLOSE), mais PAS par un `window.close()` appelé depuis le rendu, qui
	   détruit la fenêtre sans passer par ici. Ce n'est pas gênant — l'application
	   n'appelle jamais `window.close()`, elle recharge (`location.reload()`) —
	   mais un rappel de fermeture éprouvé avec `window.close()` passerait pour
	   cassé alors qu'il ne l'est pas. Vérifié deux fois : un rappel qui ne
	   résout jamais fait fermer au délai de garde (3,1 s), un rappel de 600 ms
	   fait fermer à 0,7 s. */
	fenetre.on("close", e => {
		/* Tant que le rendu n'a armé aucun rappel, la fermeture est immédiate :
		   intercepter sans personne pour répondre donnerait une fenêtre qui ne
		   se ferme plus — le piège exact rencontré côté Tauri. */
		if (!fermetureArmee || fermetureEnCours) return;
		fermetureEnCours = true;
		e.preventDefault();
		gardeFermeture = setTimeout(terminerFermeture, DELAI_GARDE_FERMETURE_MS);
		fenetre?.webContents.send(CANAUX.fermeture);
	});

	fenetre.on("closed", () => {
		fenetre = null;
	});

	void charger(fenetre).catch(e => console.error(LOG_PREFIX, "chargement du rendu impossible:", e));
}

/* ─────────── le démarrage ─────────── */

/* Le nom de l'application, POSÉ AVANT `getPath("userData")` : sans lui,
   Electron reprend le `name` de `package.json` — « @neo-quiz/windows », dont
   la barre oblique ferait du dossier de données un sous-dossier fantôme. */
app.setName(PRODUCT_NAME);

void app.whenReady().then(() => {
	reglages = creerReglages(path.join(app.getPath("userData"), "settings.json"));
	enregistrerCanaux();
	creerFenetre();
});

/* Une seule fenêtre, et Windows pour seule plateforme à cette tranche : sa
   fermeture est la fin de l'application. */
app.on("window-all-closed", () => app.quit());
