/* ══════════════════════════════════════════════════════════
   LE PROCESSUS PRINCIPAL — LA FENÊTRE, ET LE SEUL CÔTÉ QUI TOUCHE LE DISQUE

   Tâche 3 de la migration Tauri → Electron
   (docs/superpowers/plans/2026-09-11-migration-electron.md). Ce fichier ouvre
   la fenêtre, alimente le périmètre et branche les canaux du pont
   (`./pont.ts`, `./canaux.ts`).

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

   Les gestionnaires des canaux vivent dans `./canaux.ts` (aucun `ipcMain.on`,
   tout est `ipcMain.handle`) ; le périmètre qui borne chaque chemin dans
   `./perimetre.ts`. Le seul sens principal → rendu est `webContents.send` du
   surveillant (`CANAUX.evenement`) et l'appel de fermeture, auquel le rendu
   RÉPOND par un `invoke`.
══════════════════════════════════════════════════════════ */

import { BrowserWindow, app, shell } from "electron";
import * as path from "node:path";
import { LOG_PREFIX, PRODUCT_NAME } from "../../../src/branding";
import { enregistrerCanaux } from "./canaux";
import { normaliser } from "./parcours";
import { perimetreInitial } from "./perimetre";
import { CANAUX } from "./pont";
import { creerReglages } from "./reglages";
import type { Reglages } from "./reglages";

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

let fenetre: BrowserWindow | null = null;
let reglages: Reglages | null = null;
let fermetureArmee = false;
let fermetureEnCours = false;
let gardeFermeture: NodeJS.Timeout | null = null;

/** Les réglages, ou une erreur NOMMÉE — voir `DependancesCanaux`. */
function reglagesOuErreur(): Reglages {
	if (!reglages) throw new Error("réglages non initialisés : l'application n'est pas prête");
	return reglages;
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

/** L'origine de la page de l'application (« http://localhost:1421 » en
    développement, « file://…/dist/index.html » sinon). `file://` a une origine
    OPAQUE (« null ») : on compare alors sur le chemin du fichier chargé. */
let origineApp: string | null = null;

function memeOrigine(url: string): boolean {
	if (!origineApp) return false;
	try {
		const u = new URL(url);
		if (u.protocol === "file:") return origineApp.startsWith("file:") && u.pathname === new URL(origineApp).pathname;
		return u.origin === origineApp;
	} catch {
		return false;
	}
}

/** Charge le rendu, en réessayant tant que le serveur de développement n'écoute
    pas encore : `npm run dev` lance Vite et Electron EN PARALLÈLE, et Electron
    est souvent prêt le premier. Sans réessai, la fenêtre s'ouvrirait une fois
    sur deux sur une page d'erreur, selon la machine. */
async function charger(cible: BrowserWindow): Promise<void> {
	const fichierRendu = path.join(__dirname, "..", "dist", "index.html");
	const origineFichier = "file://" + normaliser(fichierRendu).replace(/^([A-Za-z]:)/, "/$1");
	if (app.isPackaged) {
		origineApp = origineFichier;
		await cible.loadFile(fichierRendu);
		return;
	}
	origineApp = new URL(URL_DEV).origin;
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
	origineApp = origineFichier;
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

	/* UNE NAVIGATION DE PREMIER NIVEAU DONNERAIT `window.neo` À UNE ORIGINE
	   ÉTRANGÈRE. Le sanitizer laisse passer `<a href="https://…">`
	   (`src/engine/sanitizer.ts`), un quiz partagé peut donc porter un lien ;
	   un clic ferait naviguer la fenêtre, et le préchargement est attaché au
	   `webContents`, pas à l'origine — la page de l'attaquant recevrait le
	   pont entier. Règle par ORIGINE : la nôtre (le serveur de développement
	   ou `file://`) navigue librement — c'est ce qui laisse passer le
	   `location.reload()` dont `choisirDossier` dépend, puisqu'un rechargement
	   vise l'URL de l'application ; toute autre origine est REFUSÉE ici et
	   remise au NAVIGATEUR de l'utilisateur, où un lien légitime a sa place. */
	const refuserHorsOrigine = (e: Electron.Event, url: string): void => {
		if (memeOrigine(url)) return;
		e.preventDefault();
		/* Sous `try` : `memeOrigine` rend `false` sur une URL non analysable, et
		   un `throw` ici, APRÈS le `preventDefault`, ferait sortir l'écouteur en
		   erreur pour une navigation déjà refusée. */
		let protocole = "";
		try {
			protocole = new URL(url).protocol;
		} catch {
			// URL illisible : refusée, et rien à remettre au navigateur.
		}
		if (/^https?:$/.test(protocole)) void shell.openExternal(url);
		else console.warn(LOG_PREFIX, "navigation refusée:", url);
	};
	fenetre.webContents.on("will-navigate", refuserHorsOrigine);
	// Une redirection ne peut suivre qu'une navigation admise ; la même règle
	// sur `will-redirect` est la ceinture, pour une ligne.
	fenetre.webContents.on("will-redirect", refuserHorsOrigine);

	/* Par défaut, Electron ACCORDE les permissions (micro, caméra,
	   notifications…) à toute page. Aucune fonction de l'application n'en
	   demande : refus systématique, et une origine hostile n'obtient rien. */
	fenetre.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

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

/* UNE SEULE INSTANCE. `reglages.ts` tient sa table en mémoire et réécrit le
   fichier entier à chaque changement : deux instances écraseraient chacune
   les réglages de l'autre à tour de rôle, sans un mot. La seconde instance
   s'arrête et la première reprend le premier plan. */
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (!fenetre || fenetre.isDestroyed()) return;
		if (fenetre.isMinimized()) fenetre.restore();
		fenetre.focus();
	});

	void app.whenReady().then(async () => {
		const donnees = app.getPath("userData");
		reglages = creerReglages(path.join(donnees, "settings.json"));
		/* La liste blanche des dossiers que le pont a le droit de toucher — voir
		   `perimetre.ts` : les réglages, puis le sélecteur et les vaults d'Obsidian
		   (`canaux.ts`). Le dossier de données est CRÉÉ là-dedans mais JAMAIS
		   autorisé (Ruling 12) : la raison est écrite sur `perimetreInitial`. */
		const perimetre = await perimetreInitial({ dossierDonnees: donnees, reglages: reglagesOuErreur() });
		enregistrerCanaux({
			perimetre,
			reglagesOuErreur,
			envoyer(canal, charge) {
				if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send(canal, charge);
			},
			fermeture: {
				armer() { fermetureArmee = true; },
				terminee: terminerFermeture,
			},
		});
		creerFenetre();
	});
}

/* Une seule fenêtre, et Windows pour seule plateforme à cette tranche : sa
   fermeture est la fin de l'application. */
app.on("window-all-closed", () => app.quit());
