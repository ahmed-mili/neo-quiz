/* ══════════════════════════════════════════════════════════
   LES CANAUX — UN GESTIONNAIRE PAR MÉTHODE DU PONT

   Tâche 3 de la migration Tauri → Electron, ronde de correction 1. Ce module
   enregistre les `ipcMain.handle` du pont (`./pont.ts`) et tient l'état du
   DISQUE vu par le processus principal (racines déclarées, index, surveillant).
   `main.ts` ne garde que la fenêtre et son cycle de vie : les deux
   responsabilités ne partagent rien d'autre que `deps.envoyer`, par lequel le
   surveillant pousse ses événements vers le rendu.

   LA RÈGLE QUI GOUVERNE CE FICHIER : aucun chemin venu du rendu n'atteint une
   primitive sans passer par `perimetre.borner` (`./perimetre.ts`). Tous les
   canaux `fichiers.*`, plus `systeme.ouvrir`, y passent ; `demarrer` FILTRE
   ses racines contre le périmètre au lieu de le définir ; et les deux clés des
   réglages qui donnent un DROIT au principal sont GARDÉES à l'écriture :
   `folders`, qui nourrit le périmètre au prochain démarrage, et `ai`
   (`garde-ia.ts`), dont l'hôte d'`aiOllamaUrl` entre dans la liste du réseau
   et dont `aiMentionExtraFolders` désigne des dossiers lus par les canaux.
   `ouvrir` refuse EN PLUS les extensions exécutables
   (`EXTENSIONS_EXECUTABLES`, `ressources.ts`) : le périmètre borne l'écriture
   et la lecture, pas l'exécution, et `write` puis `ouvrir` d'un `.bat` les
   composerait.

   ET LA MÊME RÈGLE POUR LES URL : les canaux `reseau.*` passent par
   `fetchBorne` (`./reseau.ts`), qui refuse tout hôte hors de sa liste. Le
   rendu ne définit ni les chemins qu'il lit, ni les hôtes qu'il joint.

   AUCUN `ipcMain.on` : tout est `ipcMain.handle`. Un canal sans réponse ne
   peut pas être attendu, et l'appelant ne saurait jamais si son écriture a
   réussi.
══════════════════════════════════════════════════════════ */

import { dialog, ipcMain, net, shell } from "electron";
import type { BrowserWindow } from "electron";
import * as path from "node:path";
import { LOG_PREFIX } from "../../../src/branding";
import { creerFichiers, stat, statEntree } from "./fichiers";
import { absoluDepuisContrat, contratDepuisAbsolu, creerIndex, renameDirVersAbsolu } from "./index-fichiers";
import type { EvenementSurveillant, Index } from "./index-fichiers";
import { listerRacine, normaliser } from "./parcours";
import { t } from "../../../src/i18n";
import { cheminCliPourLancement, validerReglagesIa } from "./garde-ia";
import { CLE_DOSSIERS, CLE_DOSSIER_LEGACY, cheminsDeDossiers } from "./perimetre";
import type { Perimetre } from "./perimetre";
import { demarrerOllama, erreurCli, estOutilAutorise, lireCache, ollamaInstalle, run } from "./process";
import type { MiseAJour } from "./mise-a-jour";
import { CANAUX, CLE_REGLAGES_IA, CLE_REGLAGES_ZOOM } from "./pont";
import type { EtatFenetre, EvenementDisque, RequeteCli, RequeteReseau, ResultatCli } from "./pont";
import type { Reglages } from "./reglages";
import { autoriserHote, fetchBorne } from "./reseau";
import { extensionRefusee } from "./ressources";
import { vaultsObsidian } from "./vaults";

/** Ce que les canaux demandent à `main.ts`. */
export interface DependancesCanaux {
	perimetre: Perimetre;
	/** Les réglages, ou une erreur NOMMÉE si l'application n'est pas prête :
	    un `null` silencieux ferait repartir l'utilisateur de l'écran de choix
	    sans que rien ne dise pourquoi. */
	reglagesOuErreur(): Reglages;
	/** Pousse une charge vers la fenêtre (`webContents.send`), si elle existe. */
	envoyer(canal: string, charge: unknown): void;
	/** La fenêtre, pour y RATTACHER un dialogue natif (modal de la fenêtre,
	    pas de l'application) ; `null` avant qu'elle existe ou après sa
	    destruction — le dialogue s'ouvre alors seul. */
	fenetreCourante(): BrowserWindow | null;
	fermeture: { armer(): void; terminee(): void };
	miseAJour: MiseAJour;
	/** Ferme la fenêtre par le chemin de fermeture existant (écritures
	    différées vidées) ; `main.ts` lance `quitAndInstall` une fois tout
	    fermé. */
	fermerPourInstaller(): void;
	/** La fenêtre sans cadre : ordres et lecture d'état, implémentés par
	    `main.ts` sur l'instance `BrowserWindow`. Le NOM de `commande` est déjà
	    jugé par `enregistrerCanaux` (union fermée) avant d'arriver ici. */
	fenetre: {
		reduire(): void;
		agrandirOuRestaurer(): void;
		fermer(): void;
		pleinEcran(): void;
		etat(): EtatFenetre;
		commande(nom: string): void;
		zoom(f: number): void;
		recharger(): void;
		outilsDev(): void;
	};
}

/** L'état du disque tenu par ce processus — voir `enregistrerCanaux`. */
interface EtatDisque {
	/** Les racines déclarées par `demarrer`, filtrées et normalisées. */
	racinesAbs: string[];
	index: Index | null;
	arreterSurveillance: (() => void) | null;
}

const fichiers = creerFichiers();

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
 * `rename` (de FICHIER) ne peut pas arriver (l'index n'émet que
 * `create`/`modify`/`delete` depuis chokidar) — le `null` est là pour que le
 * jour où il en émettrait un, ce soit un silence visible à la lecture plutôt
 * qu'un `abs` indéfini poussé dans la fenêtre.
 *
 * `renameDir` (tâche 5), lui, ARRIVE bel et bien — l'index l'émet une fois la
 * paire `unlinkDir`/`addDir` appariée (voir `EvenementRenommageDossier`,
 * `index-fichiers.ts`) — et il porte DEUX chemins du contrat à retraduire.
 * La traduction elle-même (`renameDirVersAbsolu`) est PURE et vit dans
 * `index-fichiers.ts`, pas ici : ce fichier importe `electron`, et aucun
 * harnais de contrôle ne peut le charger (`check-electron-index.mjs` charge
 * `index-fichiers.ts` directement) — une fonction pure prisonnière d'ici
 * resterait éprouvée seulement à la main.
 */
function versDisque(racinesAbs: string[], ev: EvenementSurveillant): EvenementDisque | null {
	if (ev.kind === "rename") return null;
	if (ev.kind === "renameDir") {
		const paire = renameDirVersAbsolu(racinesAbs, ev);
		return paire ? { kind: "renameDir", fromAbs: paire.fromAbs, toAbs: paire.toAbs } : null;
	}
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
async function ecrireTexte(etat: EtatDisque, abs: string, contenu: string): Promise<void> {
	const contrat = etat.index ? contratDepuisAbsolu(etat.racinesAbs, normaliser(abs)) : null;
	if (etat.index && contrat) await etat.index.write(contrat, contenu);
	else await fichiers.write(abs, contenu);
}

/* ─────────── les canaux ─────────── */

/**
 * Le réglage « chemin de l'exécutable » de CET outil, lu dans le magasin du
 * PRINCIPAL — jamais pris de l'appel IPC — ET REJUGÉ AU LANCEMENT (ruling 16).
 *
 * C'est la moitié qui fait que la liste blanche de noms tient : si le rendu
 * pouvait envoyer un chemin, elle ne séparerait plus rien. Mais la lire ne
 * suffit pas : la garde à l'ÉCRITURE (`garde-ia.ts`) a jugé ce chemin contre le
 * périmètre D'ALORS, et le périmètre grandit — l'utilisateur ouvre plus tard le
 * dossier qui contient un `x.cmd` écrit par la fenêtre, et le chemin admis hier
 * est dedans aujourd'hui. Le verdict est donc REJOUÉ ici, avec `perimetre.contient`
 * et `statEntree` d'aujourd'hui (`cheminCliPourLancement`, pur, éprouvé par
 * `check:electron-reglages`) ; un refus est NOMMÉ (`refuse`), journalisé, et
 * rien n'est lancé — ni ce chemin, ni un repli sur le `PATH`.
 *
 * `undefined` quand rien n'est réglé, ou quand l'outil n'a pas de réglage
 * (Ollama : cherché à ses emplacements officiels). `run` retombe alors sur le
 * `PATH` étendu.
 */
async function cheminCliRegle(reglages: Reglages, tool: string, perimetre: Perimetre): Promise<string | undefined> {
	const verdict = await cheminCliPourLancement(
		await reglages.lire(CLE_REGLAGES_IA),
		tool,
		async chemin => (await statEntree(chemin))?.isFile === true,
		chemin => perimetre.contient(chemin),
	);
	if ("refus" in verdict) {
		console.warn(LOG_PREFIX, "CLI", tool, "refusé :", verdict.refus);
		throw erreurCli("refuse", verdict.refus);
	}
	return verdict.chemin;
}

/** REJETTE si un des dossiers de la valeur n'est pas déjà dans le périmètre. */
async function verifierDossiers(perimetre: Perimetre, valeur: unknown): Promise<void> {
	for (const chemin of cheminsDeDossiers(valeur)) {
		if (!(await perimetre.contient(chemin))) {
			throw new Error("dossier hors périmètre, refusé dans les réglages : " + chemin);
		}
	}
}

export function enregistrerCanaux(deps: DependancesCanaux): void {
	const { perimetre, reglagesOuErreur } = deps;
	/* L'état du DISQUE vu par ce processus : les racines déclarées, l'index et
	   son surveillant. Il vit ici, pas dans `main.ts` : la fenêtre n'a pas à le
	   connaître, elle ne fait que recevoir ce que `deps.envoyer` lui pousse. */
	const etat: EtatDisque = { racinesAbs: [], index: null, arreterSurveillance: null };

	ipcMain.handle(CANAUX.demarrer, async (_e, racines: unknown) => {
		/* Un second appel REMPLACE : le rendu recharge la page quand les racines
		   changent, et laisser vivre l'ancien surveillant ferait pousser dans la
		   fenêtre des événements portant les indices de l'ancienne liste. */
		etat.arreterSurveillance?.();
		etat.arreterSurveillance = null;
		/* FILTRÉES contre le périmètre, jamais prises pour argent comptant :
		   cet argument vient du rendu, et `demarrer(["C:/"])` ferait sinon du
		   surveillant et de l'index une lecture de tout le disque. Une racine
		   refusée est NOMMÉE dans la console plutôt qu'ignorée en silence. */
		const gardees: string[] = [];
		for (const r of Array.isArray(racines) ? racines : []) {
			if (typeof r === "string" && (await perimetre.contient(r))) gardees.push(normaliser(r));
			else console.warn(LOG_PREFIX, "racine hors périmètre, ignorée:", r);
		}
		etat.racinesAbs = gardees;
		etat.index = creerIndex(gardees);
	});

	/* CHAQUE canal `fichiers.*` passe par `borner` — la seule porte vers une
	   primitive. Un chemin hors périmètre REJETTE avec sa cause ; la primitive
	   ne voit jamais la chaîne brute du rendu. */
	ipcMain.handle(CANAUX.read, async (_e, abs: unknown) => fichiers.read(await perimetre.borner(abs)));
	ipcMain.handle(CANAUX.readCached, async (_e, abs: unknown) => fichiers.readCached(await perimetre.borner(abs)));

	ipcMain.handle(CANAUX.write, async (_e, abs: unknown, contenu: string) => {
		const a = await perimetre.borner(abs);
		await ecrireTexte(etat, a, String(contenu));
		return await fraicheur(a);
	});

	ipcMain.handle(CANAUX.lirePourEcriture, async (_e, abs: unknown) => {
		const a = await perimetre.borner(abs);
		// `read` et non `readCached` : c'est la moitié LECTURE d'un
		// lire-modifier-écrire, elle doit voir le disque tel qu'il est.
		const contenu = await fichiers.read(a);
		const { mtime } = await fraicheur(a);
		return { contenu, mtime };
	});

	/* La seconde moitié de `process` — voir « `process`, EN DEUX TEMPS » dans
	   `pont.ts`. La comparaison porte sur le CONTENU : un `mtime` dont la
	   granularité vaut plusieurs millisecondes ne distinguerait pas deux
	   écritures rapprochées. `null` n'est pas une erreur, c'est la réponse
	   « le fichier a changé, rejoue ton rappel ». */
	ipcMain.handle(CANAUX.ecrireSiInchange, async (_e, abs: unknown, lu: string, contenu: string) => {
		const a = await perimetre.borner(abs);
		const actuel = await fichiers.read(a);
		if (actuel !== lu) return null;
		await ecrireTexte(etat, a, String(contenu));
		return await fraicheur(a);
	});

	ipcMain.handle(CANAUX.writeBinary, async (_e, abs: unknown, data: Uint8Array) => {
		const a = await perimetre.borner(abs);
		await fichiers.writeBinary(a, data);
		return await fraicheur(a);
	});

	ipcMain.handle(CANAUX.append, async (_e, abs: unknown, contenu: string) => {
		const a = await perimetre.borner(abs);
		await fichiers.append(a, String(contenu));
		return await fraicheur(a);
	});

	ipcMain.handle(CANAUX.exists, async (_e, abs: unknown) => fichiers.exists(await perimetre.borner(abs)));
	ipcMain.handle(CANAUX.mkdirs, async (_e, abs: unknown) => fichiers.mkdirs(await perimetre.borner(abs)));
	/* `racine` doit ÊTRE une racine autorisée, pas seulement y tomber : c'est
	   d'elle que `trash` déduit `<racine>/.trash/<relatif>`, et une racine
	   quelconque ferait de `path.relative` un `../../…` — un déplacement vers
	   n'importe où. Et `abs` doit tomber SOUS cette racine-là. */
	ipcMain.handle(CANAUX.trash, async (_e, abs: unknown, racine: unknown) => {
		const a = await perimetre.borner(abs);
		if (typeof racine !== "string" || !(await perimetre.estRacine(racine))) {
			throw new Error("trash : racine inconnue : " + String(racine));
		}
		const r = normaliser(path.resolve(racine));
		if (contratDepuisAbsolu([r], a) === null) throw new Error("trash : " + a + " n'est pas sous " + r);
		await fichiers.trash(a, r);
	});
	/* NORMALISÉE : `fichiers.list` compose ses chemins avec `path.join`, donc
	   avec des `\` sous Windows. Tout ce qui franchit le pont doit avoir la même
	   forme, sinon le miroir du rendu tiendrait deux clés pour un seul fichier. */
	ipcMain.handle(CANAUX.list, async (_e, dossier: unknown) =>
		(await fichiers.list(await perimetre.borner(dossier))).map(normaliser));
	ipcMain.handle(CANAUX.remove, async (_e, abs: unknown) => fichiers.remove(await perimetre.borner(abs)));
	ipcMain.handle(CANAUX.rename, async (_e, de: unknown, vers: unknown) =>
		fichiers.rename(await perimetre.borner(de), await perimetre.borner(vers)));
	ipcMain.handle(CANAUX.stat, async (_e, abs: unknown) => stat(await perimetre.borner(abs)));
	/* Les trois canaux des RACINES EXTERNES du sélecteur « @ » (`HostFs.externe`,
	   `src/host/types.ts`), BORNÉS comme tous les autres : c'est le périmètre,
	   et lui seul, qui autorise cette interface côté application — une racine
	   externe qui n'est pas un dossier ouvert rejette ici, nommée par `borner`,
	   et le rendu en fait `[]`/`null`. `listerDossier` rend des NOMS, jamais
	   des chemins : le rendu recompose, contrat ou absolu (règle de l'en-tête
	   de `pont.ts`). */
	ipcMain.handle(CANAUX.statEntree, async (_e, abs: unknown) => statEntree(await perimetre.borner(abs)));
	ipcMain.handle(CANAUX.listerDossier, async (_e, dossier: unknown) =>
		fichiers.listerDossier(await perimetre.borner(dossier)));
	ipcMain.handle(CANAUX.readBinary, async (_e, abs: unknown) => fichiers.readBinary(await perimetre.borner(abs)));
	ipcMain.handle(CANAUX.liste, async (_e, racine: unknown) => listerRacine(await perimetre.borner(racine)));

	ipcMain.handle(CANAUX.surveiller, () => {
		/* La cause est NOMMÉE : un surveillant qui ne démarre pas en silence
		   donnerait une fenêtre où rien ne se met plus à jour, sans erreur. */
		if (!etat.index) throw new Error("surveiller() avant demarrer() : aucune racine déclarée");
		if (etat.arreterSurveillance) return; // déjà monté : un second watcher serait redondant.
		etat.arreterSurveillance = etat.index.surveiller(ev => {
			const disque = versDisque(etat.racinesAbs, ev);
			if (disque) deps.envoyer(CANAUX.evenement, disque);
		});
	});

	ipcMain.handle(CANAUX.choisirDossier, async () => {
		const choix = await dialog.showOpenDialog({ properties: ["openDirectory"] });
		// Annulation : la réponse « non », pas une erreur.
		if (choix.canceled || choix.filePaths.length === 0) return null;
		// Le dossier que l'UTILISATEUR vient de désigner entre au périmètre :
		// c'est l'une des trois portes (avec les réglages et les vaults).
		await perimetre.autoriser(choix.filePaths[0]);
		return normaliser(choix.filePaths[0]);
	});

	ipcMain.handle(CANAUX.reglagesLire, (_e, cle: string) => reglagesOuErreur().lire(String(cle)));
	ipcMain.handle(CANAUX.reglagesEcrire, async (_e, cle: string, valeur: unknown) => {
		/* La clé des DOSSIERS est GARDÉE : elle nourrit le périmètre au prochain
		   démarrage, donc un rendu qui y écrirait `{ path: "C:/" }` obtiendrait
		   tout le disque à la session suivante. Chaque chemin doit déjà être
		   dans le périmètre — venu du sélecteur ou des vaults d'Obsidian. */
		if (cle === CLE_DOSSIERS || cle === CLE_DOSSIER_LEGACY) await verifierDossiers(perimetre, valeur);
		/* La clé `ai` est GARDÉE de la même façon, AVANT l'écriture, et pour la
		   même raison : l'hôte d'`aiOllamaUrl` entre dans la liste du réseau
		   (`main.ts` l'y admet au démarrage) et `aiMentionExtraFolders` désigne
		   des dossiers que les canaux `fichiers.*` liront. Le verdict est pur
		   (`garde-ia.ts`, éprouvé par `check:electron-reglages`) ; ici ne
		   restent que la porte NATIVE et l'admission. */
		if (cle === CLE_REGLAGES_IA) await garderReglagesIa(valeur);
		await reglagesOuErreur().ecrire(String(cle), valeur);
	});

	/** Refuse (rejet nommé, rien d'écrit), demande à l'utilisateur, ou admet
	    l'hôte d'Ollama dans la liste du réseau — AUSSITÔT, pas au prochain
	    lancement : un NAS déclaré dans les réglages doit répondre dans la
	    session où on l'a déclaré. */
	async function garderReglagesIa(valeur: unknown): Promise<void> {
		/* DEUX prédicats, et ils ne se confondent pas : le PÉRIMÈTRE juge les
		   dossiers que le sélecteur « @ » lira, l'EXISTENCE juge le chemin d'un
		   exécutable — lequel vit précisément HORS du périmètre (un CLI est dans
		   `Program Files`, pas dans un dossier de quiz). Le borner serait refuser
		   d'avance tout chemin valide ; ce qui le tient, c'est la liste blanche
		   d'extensions et le fait que l'utilisateur, et lui seul, le saisit. */
		const verdict = await validerReglagesIa(
			valeur,
			chemin => perimetre.contient(chemin),
			async chemin => (await statEntree(chemin))?.isFile === true,
		);
		if ("refus" in verdict) throw new Error(verdict.refus);
		if ("confirmer" in verdict) {
			/* Une porte NATIVE, comme `choisirDossier` : la question est rédigée
			   et traduite ICI, sur la langue posée par `main.ts` — un rendu
			   compromis ne peut ni la formuler ni y répondre. `cancelId` = refus :
			   fermer la boîte, c'est dire non. */
			const options = {
				type: "question" as const,
				title: t("app.aiHost.title"),
				message: t("app.aiHost.message", { host: verdict.confirmer }),
				detail: t("app.aiHost.detail"),
				buttons: [t("app.aiHost.allow"), t("app.aiHost.deny")],
				defaultId: 1,
				cancelId: 1,
			};
			const parent = deps.fenetreCourante();
			const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
			if (response !== 0) {
				console.warn(LOG_PREFIX, "hôte Ollama refusé par l'utilisateur:", verdict.confirmer);
				throw new Error("hôte refusé par l'utilisateur, réglages IA non écrits : " + verdict.confirmer);
			}
			autoriserHote(verdict.confirmer);
			return;
		}
		if (verdict.admettre) autoriserHote(verdict.admettre);
	}
	ipcMain.handle(CANAUX.reglagesSupprimer, (_e, cle: string) => reglagesOuErreur().supprimer(String(cle)));

	ipcMain.handle(CANAUX.ouvrir, async (_e, abs: unknown) => {
		/* BORNÉ comme une lecture : `shell.openPath` lance l'application par
		   défaut du système, et hors périmètre ce serait « exécuter n'importe
		   quoi ». Il rend une CHAÎNE : vide en cas de succès, le message du
		   système sinon. `HostShell.openExternal` attend un booléen dont
		   `engine/resources.ts` se sert pour prévenir l'utilisateur. */
		const a = await perimetre.borner(abs);
		/* ET REFUSÉ SUR L'EXTENSION, même dans le périmètre : pour un `.bat`
		   ou un `.exe`, « l'application par défaut » est le fichier lui-même,
		   et `write` puis `ouvrir` — deux appels bornés — composeraient une
		   exécution (revue finale, I1 ; la liste et son POURQUOI sont sur
		   `EXTENSIONS_EXECUTABLES`, `ressources.ts`). Le refus est NOMMÉ dans
		   la console et rendu `false` : l'utilisateur voit la Notice « ouverture
		   impossible » de `engine/resources.ts`, jamais un bouton mort. */
		if (extensionRefusee(a)) {
			console.warn(LOG_PREFIX, "ouverture refusée, extension exécutable:", a);
			return false;
		}
		const erreur = await shell.openPath(path.normalize(a));
		if (erreur) console.warn(LOG_PREFIX, "ouverture impossible:", a, erreur);
		return !erreur;
	});

	ipcMain.handle(CANAUX.vaultsObsidian, async () => {
		/* Les vaults qu'Obsidian déclare LUI-MÊME entrent au périmètre : l'écran
		   d'accueil les propose d'un clic, sans passer par le sélecteur natif,
		   et `addFolder` les écrit ensuite sous `folders` — ce que la garde
		   ci-dessus refuserait sinon. */
		const vaults = await vaultsObsidian();
		for (const v of vaults) await perimetre.autoriser(v.chemin);
		return vaults;
	});

	/* ─── le réseau ───

	   Un `AbortController` par requête EN VOL, sous l'identifiant que le rendu a
	   choisi : le `signal` ne traverse pas l'IPC (voir `Pont.reseau`). L'entrée
	   est retirée dans un `finally`, quelle que soit l'issue — sans quoi la
	   table grandirait d'une entrée par requête pour la vie du processus.
	   Et retirée SEULEMENT si c'est encore la sienne : le compteur du rendu
	   repart à 1 après un `location.reload()` (`choisirDossier`) alors qu'une
	   requête de l'ancienne page peut être encore en vol. Le `set` de la
	   nouvelle requête ÉCRASE alors l'entrée de l'ancienne — c'est admis, on ne
	   peut plus annuler une requête dont la page est morte — mais le `finally`
	   de l'ancienne ne doit pas emporter l'entrée de la NOUVELLE, qui
	   deviendrait inannulable. Annuler un identifiant inconnu ne fait rien :
	   la requête est déjà finie, c'est la réponse « trop tard », pas une
	   erreur. (Revue de la tâche 2, correction 1.) */
	const enVol = new Map<number, AbortController>();

	ipcMain.handle(CANAUX.reseauFetch, async (_e, req: unknown, requeteId: unknown) => {
		/* La requête vient du RENDU : elle est RECOMPOSÉE champ par champ, jamais
		   passée telle quelle au transport. Une propriété inattendue (`mode`,
		   `credentials`, `redirect`…) glissée dans l'objet reçu n'atteint donc
		   pas `net.fetch` ; et l'hôte est jugé par `fetchBorne`, pas ici. */
		const r = (req && typeof req === "object" ? req : {}) as Partial<RequeteReseau>;
		const url = typeof r.url === "string" ? r.url : "";
		const method = r.method === "POST" ? "POST" : "GET";
		const headers: Record<string, string> = {};
		/* `!Array.isArray` : `typeof [] === "object"`, et `Object.entries` d'un
		   tableau donnerait des en-têtes nommés « 0 », « 1 ». */
		if (r.headers && typeof r.headers === "object" && !Array.isArray(r.headers)) {
			for (const [k, v] of Object.entries(r.headers)) if (typeof v === "string") headers[k] = v;
		}
		const body = typeof r.body === "string" ? r.body : undefined;
		const id = typeof requeteId === "number" ? requeteId : NaN;
		const controleur = new AbortController();
		if (!Number.isNaN(id)) enVol.set(id, controleur);
		try {
			/* `net.fetch` d'Electron, jamais le `fetch` de Node : c'est la pile
			   réseau de Chromium — proxy du système, magasin de certificats —
			   celle que l'utilisateur a déjà configurée pour tout le reste. */
			return await fetchBorne(
				{ url, method, headers, body, signal: controleur.signal },
				(u, init) => net.fetch(u, init),
			);
		} finally {
			if (enVol.get(id) === controleur) enVol.delete(id);
		}
	});
	ipcMain.handle(CANAUX.reseauAnnuler, (_e, requeteId: unknown) => {
		if (typeof requeteId === "number") enVol.get(requeteId)?.abort();
	});

	/* ─── les CLI et leurs fichiers ───

	   MÊME RÈGLE QUE LES CHEMINS ET LES URL, appliquée aux NOMS D'OUTILS : le
	   rendu n'envoie qu'un nom, et ce nom est jugé ici. Les chemins, eux, sont
	   FIXES et connus du seul principal (`./process.ts`) — c'est ce qui fait
	   que ce canal n'a pas besoin de `perimetre.borner` : il n'y a aucun
	   chemin venu du rendu à borner. Un `tool` hors liste serait précisément
	   la faille inverse : « lis-moi ce fichier-là » déguisé en nom d'outil.
	   Le refus est NOMMÉ dans la console ET rejeté (`name === "refuse"`) : un
	   `null` muet passerait pour « pas de cache », et on chercherait le défaut
	   du côté du CLI. */
	ipcMain.handle(CANAUX.processusLireCache, async (_e, tool: unknown) => {
		if (tool !== "claude" && tool !== "codex") {
			console.warn(LOG_PREFIX, "cache refusé, outil hors liste:", tool);
			throw erreurCli("refuse", "outil hors liste : " + String(tool));
		}
		return lireCache(tool);
	});
	ipcMain.handle(CANAUX.processusOllamaInstalle, () => ollamaInstalle());
	ipcMain.handle(CANAUX.processusDemarrerOllama, () => demarrerOllama());

	/* ─── LANCER UN CLI ───

	   La capacité la plus dangereuse du pont, et elle tient sur trois règles
	   qui ne se remplacent pas :

	   1. LE NOM EST JUGÉ AVANT TOUT ce qui suit — avant de lire un réglage,
	      avant de toucher au disque, avant le moindre `spawn`. C'est la liste
	      blanche d'`OUTILS` (`process.ts`, la même que l'hôte Obsidian), et
	      c'est elle qui rend impossible « écris `x.bat` dans un dossier ouvert,
	      puis lance-le » — une séquence que le périmètre des chemins, qui ne
	      borne que la lecture et l'écriture, ne voit pas.
	   2. LE CHEMIN DE L'EXÉCUTABLE VIENT DU MAGASIN DU PRINCIPAL, jamais de cet
	      appel : un chemin envoyé par le rendu annulerait la règle 1 d'un trait.
	      Le réglage lui-même est gardé À L'ÉCRITURE (`garde-ia.ts`).
	   3. L'APPEL EST RECOMPOSÉ CHAMP PAR CHAMP, comme `reseau.fetch` : une
	      propriété inattendue glissée dans l'objet reçu n'atteint pas `run`.

	   L'ENVELOPPE (`ResultatCli`, `pont.ts`) et non un rejet : l'IPC perd le
	   `name` d'une erreur, et tout le contrat de `run` tient dans ce nom. */
	const cliEnVol = new Map<number, AbortController>();

	ipcMain.handle(CANAUX.processusRun, async (_e, spec: unknown, requeteId: unknown): Promise<ResultatCli> => {
		const s = (spec && typeof spec === "object" ? spec : {}) as Partial<RequeteCli>;
		if (!estOutilAutorise(s.tool)) {
			console.warn(LOG_PREFIX, "CLI refusé, outil hors liste:", s.tool);
			return { ok: false, nom: "refuse", message: "outil hors liste : " + String(s.tool) };
		}
		const tool = s.tool;
		const args = Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === "string") : [];
		const fichiers = Array.isArray(s.fichiers)
			? s.fichiers
				.filter((f): f is { nom: string; base64: string } =>
					!!f && typeof f === "object" && typeof f.nom === "string" && typeof f.base64 === "string")
				.map(f => ({ nom: f.nom, base64: f.base64 }))
			: undefined;
		const id = typeof requeteId === "number" ? requeteId : NaN;
		const controleur = new AbortController();
		if (!Number.isNaN(id)) cliEnVol.set(id, controleur);
		try {
			const res = await run({
				tool,
				args,
				stdin: typeof s.stdin === "string" ? s.stdin : "",
				timeoutMs: typeof s.timeoutMs === "number" ? s.timeoutMs : undefined,
				marqueur: typeof s.marqueur === "string" ? s.marqueur : undefined,
				fichiers,
				sortieFichier: typeof s.sortieFichier === "string" ? s.sortieFichier : undefined,
				signal: controleur.signal,
			}, { cheminRegle: await cheminCliRegle(reglagesOuErreur(), tool, perimetre) });
			return { ok: true, stdout: res.stdout, stderr: res.stderr, code: res.code, sortie: res.sortie };
		} catch (e) {
			/* Le NOM survit, c'est tout l'objet de l'enveloppe. « erreur » est le
			   défaut d'une exception qui n'en porterait pas — jamais un nom du
			   contrat choisi au hasard, qui mentirait sur la cause. */
			const nom = e instanceof Error && e.name ? e.name : "erreur";
			const message = e instanceof Error ? e.message : String(e);
			console.warn(LOG_PREFIX, "CLI", tool, "en échec:", nom, message);
			return { ok: false, nom, message };
		} finally {
			/* Retirée SEULEMENT si c'est encore la sienne : le compteur du rendu
			   repart à 1 après un `location.reload()`, et le `finally` d'un appel
			   de l'ancienne page ne doit pas emporter l'entrée de la nouvelle —
			   qui deviendrait inannulable. Même raison qu'au réseau. */
			if (cliEnVol.get(id) === controleur) cliEnVol.delete(id);
		}
	});
	ipcMain.handle(CANAUX.processusAnnuler, (_e, requeteId: unknown) => {
		if (typeof requeteId === "number") cliEnVol.get(requeteId)?.abort();
	});

	ipcMain.handle(CANAUX.armerFermeture, () => deps.fermeture.armer());
	ipcMain.handle(CANAUX.fermetureTerminee, () => deps.fermeture.terminee());

	/* ─── LA FENÊTRE SANS CADRE ───
	   Le rendu dessine la barre ; le principal exécute. Rien ne traverse
	   qu'un ordre sans argument, ou un nom d'une union fermée, ou un nombre
	   borné ici : aucun chemin, aucune URL. */
	ipcMain.handle(CANAUX.fenetreReduire, () => deps.fenetre.reduire());
	ipcMain.handle(CANAUX.fenetreAgrandir, () => deps.fenetre.agrandirOuRestaurer());
	ipcMain.handle(CANAUX.fenetreFermer, () => deps.fenetre.fermer());
	ipcMain.handle(CANAUX.fenetrePleinEcran, () => deps.fenetre.pleinEcran());
	ipcMain.handle(CANAUX.fenetreEtatLire, () => deps.fenetre.etat());
	const COMMANDES = new Set(["undo", "redo", "cut", "copy", "paste", "selectAll"]);
	ipcMain.handle(CANAUX.editionCommande, (_e, nom: unknown) => {
		if (typeof nom !== "string" || !COMMANDES.has(nom)) throw new Error(`commande d'édition refusée : ${String(nom)}`);
		deps.fenetre.commande(nom);
	});
	ipcMain.handle(CANAUX.affichageZoom, async (_e, facteur: unknown) => {
		const f = typeof facteur === "number" && Number.isFinite(facteur) ? Math.min(1.5, Math.max(0.8, facteur)) : 1;
		deps.fenetre.zoom(f);
		await deps.reglagesOuErreur().ecrire(CLE_REGLAGES_ZOOM, f);
	});
	ipcMain.handle(CANAUX.affichageRecharger, () => deps.fenetre.recharger());
	ipcMain.handle(CANAUX.affichageOutilsDev, () => deps.fenetre.outilsDev());

	/* ─── LA MISE À JOUR ───
	   Rien de ce qui traverse n'est un chemin ni une URL : le rendu demande,
	   le principal décide avec son `app-update.yml`. `installer` ferme la
	   fenêtre par le chemin de la croix (écritures différées vidées) ; c'est
	   `main.ts` qui, tout fermé, lance `quitAndInstall`. */
	ipcMain.handle(CANAUX.miseAJourEtatLire, () => deps.miseAJour.etat());
	ipcMain.handle(CANAUX.miseAJourVerifier, () => deps.miseAJour.verifier());
	ipcMain.handle(CANAUX.miseAJourInstaller, () => {
		if (deps.miseAJour.armerInstallation()) deps.fermerPourInstaller();
	});
	ipcMain.handle(CANAUX.miseAJourReglage, (_e, auto: unknown) => deps.miseAJour.reglerAuto(auto === true));
}
