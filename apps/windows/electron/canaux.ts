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
   ses racines contre le périmètre au lieu de le définir ; et la clé `folders`
   des réglages est GARDÉE à l'écriture, parce qu'elle nourrit le périmètre au
   prochain démarrage. `ouvrir` refuse EN PLUS les extensions exécutables
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
import * as path from "node:path";
import { LOG_PREFIX } from "../../../src/branding";
import { creerFichiers, stat } from "./fichiers";
import { absoluDepuisContrat, contratDepuisAbsolu, creerIndex, renameDirVersAbsolu } from "./index-fichiers";
import type { EvenementSurveillant, Index } from "./index-fichiers";
import { listerRacine, normaliser } from "./parcours";
import { CLE_DOSSIERS, CLE_DOSSIER_LEGACY, cheminsDeDossiers } from "./perimetre";
import type { Perimetre } from "./perimetre";
import { CANAUX } from "./pont";
import type { EvenementDisque, RequeteReseau } from "./pont";
import type { Reglages } from "./reglages";
import { fetchBorne } from "./reseau";
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
	fermeture: { armer(): void; terminee(): void };
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
		await reglagesOuErreur().ecrire(String(cle), valeur);
	});
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
	   table grandirait d'une entrée par requête pour la vie du processus, et
	   un identifiant réutilisé par un rendu rechargé annulerait la requête
	   morte d'un autre. Annuler un identifiant inconnu ne fait rien : la
	   requête est déjà finie, c'est la réponse « trop tard », pas une erreur. */
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
		if (r.headers && typeof r.headers === "object") {
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
			if (!Number.isNaN(id)) enVol.delete(id);
		}
	});
	ipcMain.handle(CANAUX.reseauAnnuler, (_e, requeteId: unknown) => {
		if (typeof requeteId === "number") enVol.get(requeteId)?.abort();
	});

	ipcMain.handle(CANAUX.armerFermeture, () => deps.fermeture.armer());
	ipcMain.handle(CANAUX.fermetureTerminee, () => deps.fermeture.terminee());
}
