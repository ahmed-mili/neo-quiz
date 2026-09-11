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

import { BrowserWindow, app, net, protocol, shell } from "electron";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { LOG_PREFIX, PRODUCT_NAME } from "../../../src/branding";
import { enregistrerCanaux } from "./canaux";
import { perimetreInitial } from "./perimetre";
import type { Perimetre } from "./perimetre";
import { CANAUX, CLE_REGLAGES_IA } from "./pont";
import { creerReglages } from "./reglages";
import type { Reglages } from "./reglages";
import { autoriserHote } from "./reseau";
import { SCHEMA_RESSOURCES, resoudreRessource } from "./ressources";

/** Le serveur de développement de Vite. Le port vient de `vite.config.ts`
    (`strictPort: true`) : s'il change là-bas, il change ici. */
const URL_DEV = process.env.NEO_DEV_SERVER ?? "http://localhost:1421";

/** Les mêmes dimensions que l'ancienne fenêtre Tauri (`tauri.conf.json`,
    retiré tâche 7) : ce n'est pas une application neuve, c'est la même qui
    change de coquille. */
const FENETRE = { width: 1280, height: 840, minWidth: 900, minHeight: 600 };

/**
 * Le délai après lequel la fenêtre se ferme MÊME SI le rendu n'a pas répondu.
 *
 * Sans lui, un rendu figé (ou déjà mort) rendrait la fenêtre INFERMABLE —
 * exactement le piège documenté côté Tauri, où un `destroy()` refusé par les
 * permissions empêchait toute fermeture après l'ajout d'un écouteur.
 *
 * VALEUR FIXÉE PAR MESURE (tâche 6), pas choisie à vue comme les 3000 ms de
 * la tâche 3. Les trois écrivains différés de l'application ont des débounces
 * de 500 ms (`src/review/log-file.ts`), 500 ms (`src/dashboard/stats-store.ts`)
 * et 600 ms (`src/dashboard/detail.ts`) — mais AUCUN des trois ne gate cette
 * attente : `flushSave()`/`dispose()` de la page d'un quiz ANNULENT leur
 * minuterie et lancent l'écriture SUR-LE-CHAMP (voir leur commentaire dans
 * `detail.ts`). Le débounce n'est donc jamais ce qu'on attend ici ; ce qu'on
 * attend, c'est l'IPC (un aller-retour `invoke`) plus l'écriture disque
 * elle-même. Mesuré de bout en bout, sur un WM_CLOSE réel (`PostMessage`
 * WM_CLOSE, pas `window.close()` — voir plus bas pourquoi), frappe tapée puis
 * fenêtre fermée AUSSITÔT (moins de 40 ms après la frappe) : la fenêtre a fini
 * de se fermer 72 à 116 ms après le WM_CLOSE, note relue avec la frappe dedans
 * — et l'écart interne entre l'appel de fermeture et la réponse du rendu
 * n'était que de 4 ms. Rien en attente : 70 ms, un temps équivalent — la
 * croix ne paie donc jamais ce délai dans le cas courant.
 *
 * Le garde-fou n'a donc PAS à couvrir un débounce ni même une écriture lente
 * ordinaire (déjà sous 120 ms mesurés) : il protège contre le cas
 * PATHOLOGIQUE — un rendu figé, un disque réseau ou synchronisé
 * (OneDrive, antivirus) qui traîne, un vault distant. 1500 ms donne plus de
 * DIX FOIS la marge du cas mesuré (120 ms) tout en restant sous la seconde et
 * demie où l'utilisateur perçoit un blocage — ni les 2000 ms du brief ni les
 * 3000 ms de la tâche 3, choisis sans mesure l'un et l'autre. Le principe qui
 * tranche si ce délai se révèle encore trop court sur un vault lent : mieux
 * vaut perdre la dernière frappe que refuser de fermer.
 */
const DELAI_GARDE_FERMETURE_MS = 1500;

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

/** Le nombre de tentatives de connexion au serveur de développement, et
    l'intervalle entre deux : Tâche 6, nommés à la revue de la tâche 3 (deux
    littéraux nus, « dix secondes d'attente silencieuse avant le repli »). Le
    produit des deux (10 s) est le temps qu'Electron laisse à Vite pour
    démarrer avant de retomber sur `dist/index.html` — en pratique celui-ci
    n'existe pas encore en développement (`npm run dev` ne le construit pas),
    et la fenêtre s'ouvre alors sur une page blanche : un mode DÉGRADÉ,
    propre au développement, jamais rencontré depuis un paquet installé
    (`app.isPackaged` court-circuite cette boucle plus haut). */
const TENTATIVES_SERVEUR_DEV = 40;
const INTERVALLE_TENTATIVE_MS = 250;

/** Charge le rendu, en réessayant tant que le serveur de développement n'écoute
    pas encore : `npm run dev` lance Vite et Electron EN PARALLÈLE, et Electron
    est souvent prêt le premier. Sans réessai, la fenêtre s'ouvrirait une fois
    sur deux sur une page d'erreur, selon la machine. */
async function charger(cible: BrowserWindow): Promise<void> {
	const fichierRendu = path.join(__dirname, "..", "dist", "index.html");
	/* `pathToFileURL`, jamais une concaténation : `memeOrigine` compare le
	   `pathname` de l'URL que Chromium rapporte, donc PERCENT-ENCODÉ. Un `#`
	   ou un `?` dans le dossier d'installation (« C:/Apps/Neo Quiz #2 ») aurait
	   fait de la concaténation une URL au fragment tronqué, la comparaison
	   échouait, et `location.reload()` — la navigation dont `choisirDossier`
	   dépend — était REFUSÉE comme une origine étrangère (revue finale, M1). */
	const origineFichier = pathToFileURL(fichierRendu).href;
	if (app.isPackaged) {
		origineApp = origineFichier;
		await cible.loadFile(fichierRendu);
		return;
	}
	origineApp = new URL(URL_DEV).origin;
	for (let essai = 0; essai < TENTATIVES_SERVEUR_DEV; essai++) {
		try {
			await cible.loadURL(URL_DEV);
			return;
		} catch {
			await new Promise(r => setTimeout(r, INTERVALLE_TENTATIVE_MS));
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
		/* La couleur du THÈME (`--background-primary`, `src/theme/host-vars.css`
		   : rgb(30, 30, 46)), pas une valeur recopiée : c'est ce que la fenêtre
		   montre AVANT que la page ait peint, et un ton différent ferait un
		   clignotement à chaque lancement — exactement ce que `show: false`
		   ci-dessus existe pour empêcher (différé depuis la tâche 3, M2). */
		backgroundColor: "#1e1e2e",
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
	   de préférences que nous n'aurions pas choisies. Refus systématique — mais
	   REMIS AU NAVIGATEUR quand c'est du `https?:`, comme `will-navigate`
	   ci-dessous : le sanitizer admet `<a target="_blank">`, et un refus sec
	   faisait de ce lien légitime un lien MORT, là où le même lien sans
	   `target` s'ouvrait dans le navigateur (revue finale, M7). Même filtre,
	   même geste : deux règles pour un seul lien auraient divergé. */
	fenetre.webContents.setWindowOpenHandler(({ url }) => {
		remettreAuNavigateur(url);
		return { action: "deny" };
	});

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
	/** Ouvre `url` dans le navigateur de l'utilisateur si c'est du `https?:`,
	    sinon le refus est NOMMÉ dans la console. Partagée entre la navigation
	    de premier niveau et `setWindowOpenHandler` : un seul filtre. */
	const remettreAuNavigateur = (url: string): void => {
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
	const refuserHorsOrigine = (e: Electron.Event, url: string): void => {
		if (memeOrigine(url)) return;
		e.preventDefault();
		remettreAuNavigateur(url);
	};
	fenetre.webContents.on("will-navigate", refuserHorsOrigine);
	// Une redirection ne peut suivre qu'une navigation admise ; la même règle
	// sur `will-redirect` est la ceinture, pour une ligne.
	fenetre.webContents.on("will-redirect", refuserHorsOrigine);

	/* REMISE À ZÉRO DE L'ARMEMENT — défaut laissé par la tâche 3, relevé à sa
	   revue. `choisirDossier` recharge par `location.reload()` (une navigation
	   de premier niveau ADMISE par `refuserHorsOrigine`, donc jamais annulée) :
	   le nouveau contexte de préchargement reçu par le rendu a `neo.fenetre
	   .surFermeture` non réarmé (`ecouteurFermeturePose` à faux côté rendu,
	   `src/main.ts`), mais SANS ce reset, `fermetureArmee` restait VRAI côté
	   principal — hérité de l'ancien contexte, détruit avec la page qui l'avait
	   posé. Fermer la fenêtre pendant cette fenêtre de course (entre le
	   rechargement et le prochain `armer()`) attendrait alors le délai de garde
	   ENTIER pour un rappel qui n'existe plus. `isMainFrame && !isInPlace` :
	   seule une VRAIE navigation de haut niveau compte, pas un changement de
	   hash ni une frame secondaire (il n'y en a pas ici, mais la garde coûte
	   une comparaison). */
	fenetre.webContents.on("did-start-navigation", (_e, _url, isInPlace, isMainFrame) => {
		if (isMainFrame && !isInPlace) fermetureArmee = false;
	});

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
	   cassé alors qu'il ne l'est pas. Vérifié par la tâche 3 (délai de garde
	   alors à 3000 ms) : un rappel qui ne résout jamais fait fermer au délai de
	   garde (3,1 s), un rappel de 600 ms fait fermer à 0,7 s. Rejoué par la
	   tâche 6 sur une écriture RÉELLE (voir `DELAI_GARDE_FERMETURE_MS`) : 72 à
	   116 ms du WM_CLOSE à la fenêtre détruite, frappe relue dans la note. */
	fenetre.on("close", e => {
		/* Tant que le rendu n'a armé aucun rappel, la fermeture est immédiate :
		   intercepter sans personne pour répondre donnerait une fenêtre qui ne
		   se ferme plus — le piège exact rencontré côté Tauri.

		   DÉCISION (défaut laissé par la tâche 3, relevé à sa revue) : un SECOND
		   clic sur la croix pendant que `fermetureEnCours` est vrai n'est PAS
		   intercepté ici — `preventDefault` n'est pas rappelé, et Electron
		   détruit la fenêtre par son comportement natif, abandonnant l'écriture
		   déjà lancée par le premier clic. C'est VOULU, pas oublié : le premier
		   clic a déjà déclenché le vidage des tampons ET posé un délai de garde
		   borné (`DELAI_GARDE_FERMETURE_MS`) — la seule chose qu'un second clic
		   change, c'est de raccourcir une attente déjà plafonnée. Refuser ce
		   second clic ferait de la fenêtre une chose qui ignore l'utilisateur
		   qui insiste, pour ne protéger qu'une fenêtre de quelques centaines de
		   millisecondes au plus — le même arbitrage que le délai de garde
		   lui-même (« mieux vaut perdre la dernière frappe que refuser de
		   fermer »), appliqué à l'impatience plutôt qu'à un rendu figé.

		   LA TENSION AVEC `DELAI_GARDE_FERMETURE_MS`, ET POURQUOI ELLE N'EN EST
		   PAS UNE : ce délai est la PATIENCE de l'application — combien de temps
		   ELLE attend une écriture avant de conclure que le rendu est figé ; le
		   second clic est le MOT DE LA FIN de l'utilisateur — et quand les deux
		   s'opposent (l'utilisateur clique une seconde fois AVANT l'expiration
		   du délai de garde, précisément le moment où ce second clic est le plus
		   tentant), c'est l'utilisateur qui gagne, jamais l'application. Même
		   principe que celui qui fixe `DELAI_GARDE_FERMETURE_MS` : mieux vaut
		   perdre la dernière frappe que refuser de fermer — ici appliqué à
		   l'impatience de l'utilisateur plutôt qu'à un rendu figé, mais c'est le
		   MÊME arbitrage, pas un second.

		   CE QUE ÇA COÛTE VRAIMENT (doute n°1 du rapport de tâche 6) : les
		   1500 ms de `DELAI_GARDE_FERMETURE_MS` sont mesurés sur un disque LOCAL
		   rapide (72 à 116 ms bout en bout pour une écriture réelle). Sur un
		   vault RÉSEAU ou SYNCHRONISÉ (OneDrive, antivirus qui intercepte
		   l'écriture), cette garde peut se révéler trop courte : l'écriture est
		   alors coupée en plein vol par `terminerFermeture()`, et la dernière
		   frappe est perdue — le second clic ne fait qu'avancer ce moment.
		   Ce n'est PAS un défaut caché : c'est l'arbitrage assumé par le plan de
		   migration (mieux perdre la frappe que rendre la fenêtre infermable),
		   écrit ici pour que le prochain lecteur le trouve à l'endroit où il se
		   pose, sans avoir à recouper deux commentaires séparés. */
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

/* ─────────── la liste d'hôtes du réseau ─────────── */

/**
 * L'hôte d'`aiOllamaUrl` entre dans la liste du réseau (`./reseau.ts`), lu des
 * RÉGLAGES par le principal, comme les dossiers de `folders` entrent au
 * périmètre. Un Ollama sur un NAS est un usage légitime que l'utilisateur
 * déclare dans ses réglages ; sans cette ligne, il serait refusé « hôte hors
 * liste » sans autre recours.
 * Une URL absente ou illisible n'ajoute rien, en silence : le défaut
 * (`localhost`) est déjà dans la liste.
 * À LA DIFFÉRENCE de `folders`, la clé `ai` n'est pas encore gardée à
 * l'écriture : le résiduel (un rendu compromis obtient un hôte au prochain
 * lancement) est écrit sur `autoriserHote`, et la garde vient à la tâche 6.
 */
async function admettreHoteOllama(reg: Reglages): Promise<void> {
	let ia: unknown;
	try {
		ia = await reg.lire(CLE_REGLAGES_IA);
	} catch (e) {
		console.warn(LOG_PREFIX, "réglages IA illisibles, hôte Ollama non admis:", e);
		return;
	}
	const url = ia && typeof ia === "object" ? (ia as { aiOllamaUrl?: unknown }).aiOllamaUrl : undefined;
	if (typeof url !== "string" || !url) return;
	try {
		autoriserHote(new URL(url).hostname);
	} catch {
		console.warn(LOG_PREFIX, "aiOllamaUrl illisible, hôte non admis:", url);
	}
}

/* ─────────── le protocole des ressources ─────────── */

/**
 * Sert les images qu'un quiz affiche (`HostLinks.resourceUrl`, côté rendu
 * `apps/windows/src/host/links.ts`) — le remplaçant du protocole d'asset de
 * Tauri. La forme de l'URL et sa lecture vivent dans `./ressources.ts`, partagé
 * avec le rendu ; ici il n'y a que le branchement.
 *
 * BORNÉ PAR LE MÊME PÉRIMÈTRE QUE LES CANAUX `fichiers.*` (Ruling 13), et pas
 * par une liste à lui : une seconde liste blanche finirait par diverger de la
 * première, et c'est la porte que la tâche 3 a mis deux rondes à fermer. Une
 * URL hors des dossiers ouverts reçoit 403, sans que le chemin demandé ne
 * touche jamais le disque — `resoudreRessource` rend `null` avant.
 *
 * `net.fetch` sur une URL `file:` est le chemin que la documentation d'Electron
 * donne pour un `protocol.handle` qui sert des fichiers : il pose le type MIME
 * d'après l'extension et diffuse en flux (`stream: true` ci-dessous), sans
 * charger l'image entière en mémoire. Un fichier disparu entre la résolution
 * et la lecture rejette : 404, pas une exception qui remonterait au rendu.
 */
function servirRessources(perimetre: Perimetre): void {
	protocol.handle(SCHEMA_RESSOURCES, async (requete) => {
		const chemin = await resoudreRessource(perimetre, requete.url);
		if (!chemin) return new Response(null, { status: 403 });
		try {
			return await net.fetch(pathToFileURL(chemin).href);
		} catch (e) {
			console.warn(LOG_PREFIX, "ressource illisible:", chemin, e);
			return new Response(null, { status: 404 });
		}
	});
}

/* AVANT `app.ready`, et nulle part ailleurs : Electron refuse d'enregistrer
   des privilèges après. `standard` donne à l'URL un hôte et un chemin
   analysables (sans lui, `app://neo-res/D:/…` serait un chemin OPAQUE que
   `new URL` ne découpe pas) ; `secure` évite qu'une page chargée en `https`
   (ce n'est pas le cas aujourd'hui) traite ces images comme du contenu mixte ;
   `stream` laisse `net.fetch` diffuser le fichier au lieu de le lire entier.
   Ni `supportFetchAPI` ni `bypassCSP` : le rendu ne fait que des `<img src>`,
   et une surface qu'aucun appelant ne demande est une surface de trop. */
protocol.registerSchemesAsPrivileged([
	{ scheme: SCHEMA_RESSOURCES, privileges: { standard: true, secure: true, stream: true } },
]);

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
		// Même geste que le périmètre, pour les URL : l'hôte Ollama des réglages.
		await admettreHoteOllama(reglagesOuErreur());
		// Le MÊME objet que les canaux : une racine admise par `choisirDossier`
		// ou `vaultsObsidian` devient aussitôt servable, sans second registre.
		servirRessources(perimetre);
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
