/* ══════════════════════════════════════════════════════════
   LES PRIMITIVES DE FICHIERS DU PROCESSUS PRINCIPAL ELECTRON

   Tâche 1 de la migration Tauri → Electron
   (docs/superpowers/plans/2026-09-11-migration-electron.md). Ce module ne
   CONSOMME rien : ni Electron, ni fenêtre, ni IPC, ni le reste du dépôt — que
   `node:fs/promises` et `node:path`. C'est ce qui permet à son contrôle de
   tourner sur un vrai dossier temporaire, sans aucun double.

   Les méthodes portent les mêmes NOMS et la même SÉMANTIQUE que `HostFs`
   (`src/host/types.ts`), à une différence près, volontaire : les chemins
   reçus ici sont des chemins ABSOLUS du disque, jamais des chemins du
   contrat. La conversion contrat ↔ absolu reste côté rendu, dans
   `apps/windows/src/host/roots.ts` (`CarteRacines`), qui ne bouge pas — et
   que ce module n'importe pas non plus : `roots.ts` vit dans l'arbre bundlé
   par Vite pour la fenêtre, `fichiers.ts` dans celui du processus principal.
   Les faire dépendre l'un de l'autre brouillerait la frontière que les
   tâches suivantes (2 et 3) posent explicitement.

   ÉCART AU BRIEF DE LA TÂCHE, tranché en pré-vol (ruling 1 du journal de
   migration) : le brief cite `stat`, absent du contrat `HostFs`, et omet
   `list`, `remove` et `rename`, qui y sont. Ce fichier suit le CONTRAT, qui
   fait autorité sur le plan : les onze méthodes ci-dessous sont `read`,
   `readCached`, `write`, `process`, `writeBinary`, `append`, `exists`,
   `mkdirs`, `trash`, `list`, `remove`, `rename`. `stat` reste une primitive
   INTERNE (l'index de la tâche 2 en aura besoin pour les `mtime`), jamais
   présentée comme une méthode du contrat.
══════════════════════════════════════════════════════════ */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Les primitives de fichiers du processus principal. Onze méthodes du
    contrat, plus `readBinary` et `listerDossier` (tranche 5, tâche 5 — les
    racines externes du sélecteur « @ », `HostFs.externe`), plus `stat` et
    `statEntree` — internes, voir plus haut et plus bas. */
export interface PrimitivesFichiers {
	/** Lit un fichier texte. Rejette si absent ou illisible. */
	read(chemin: string): Promise<string>;
	/** Lit des OCTETS. Rejette si absent ou illisible. Sert
	    `HostFs.externe.readBinary` (les images jointes hors vault). */
	readBinary(chemin: string): Promise<Uint8Array>;
	/** Pas de cache ici — voir le commentaire sur `readCached` ci-dessous. */
	readCached(chemin: string): Promise<string>;
	/** CRÉE OU REMPLACE, sans jamais rejeter parce que la cible existe déjà. */
	write(chemin: string, donnees: string): Promise<void>;
	/** Lecture-modification-écriture : le rappel reçoit le contenu ACTUEL du
	    fichier et rend ce qui doit être écrit. Le rappel peut être REJOUÉ —
	    `detail-io.ts` (côté rendu) en dépend pour son compare-and-swap. */
	process(chemin: string, muter: (contenu: string) => string): Promise<void>;
	/** Écrit des OCTETS. Il faut écrire la VUE reçue, jamais son tampon
	    sous-jacent (`data.buffer`) : une vue partielle sur un tampon partagé
	    (image collée depuis un plus grand buffer) verrait sinon tout le
	    tampon écrit à sa place. */
	writeBinary(chemin: string, donnees: Uint8Array): Promise<void>;
	/** Ajoute SANS relire tout le fichier : c'est l'atomicité de l'ajout qui
	    protège le journal de révision d'une fermeture au mauvais moment. */
	append(chemin: string, donnees: string): Promise<void>;
	exists(chemin: string): Promise<boolean>;
	/** Crée le dossier et ses parents ; ne rejette pas s'il existe déjà. */
	mkdirs(chemin: string): Promise<void>;
	/** Déplace vers `<racine>/.trash/<chemin relatif à la racine>` — ne
	    SUPPRIME jamais. `racine` est un paramètre explicite (et non déduit du
	    chemin) : ce module ne connaît pas la notion de racines multiples,
	    c'est `CarteRacines` côté rendu qui la porte ; voir le pont de la
	    tâche 3 (`Pont.fichiers.trash(abs, racine)`), dont ceci reprend la
	    forme. Un homonyme déjà présent dans la corbeille est NUMÉROTÉ, jamais
	    écrasé — la corbeille est l'endroit où rien ne disparaît. */
	trash(chemin: string, racine: string): Promise<void>;
	/** Les FICHIERS d'un dossier, sans descendre dans les sous-dossiers. Un
	    dossier absent rend `[]` : ce n'est pas une erreur. */
	list(dossier: string): Promise<string[]>;
	/** TOUTES les entrées d'un dossier, fichiers ET sous-dossiers, avec leur
	    type, sans descendre. Le NOM seul, jamais un chemin : c'est le rendu qui
	    recompose `dossier + "/" + nom` (contrat ou absolu, il est seul à le
	    savoir — voir l'en-tête de `pont.ts`). Un dossier absent rend `[]`. Un
	    lien symbolique n'est ni fichier ni dossier ici (`isDirectory()` est
	    faux sur un `Dirent` de lien) : il n'est pas descendu, comme dans
	    `parcours.ts`. Sert `HostFs.listDir` et `HostFs.externe.list`. */
	listerDossier(dossier: string): Promise<Array<{ name: string; isFolder: boolean }>>;
	/** Retire un fichier. Ne rejette PAS si le fichier est déjà absent. */
	remove(chemin: string): Promise<void>;
	/** Renomme. REJETTE si la destination existe déjà — la migration du
	    journal de révision s'en sert pour ne jamais écraser une sauvegarde. */
	rename(de: string, vers: string): Promise<void>;
}

/** Vrai si le chemin existe sur le disque (fichier ou dossier). */
async function existeSurDisque(chemin: string): Promise<boolean> {
	try {
		await fs.access(chemin);
		return true;
	} catch {
		return false;
	}
}

/**
 * Coupe un chemin en base + EXTENSION, le point cherché dans le DERNIER
 * SEGMENT seulement — même règle que `couperExtension` de `roots.ts` (côté
 * rendu), reprise ici en local plutôt qu'importée : voir le commentaire
 * d'en-tête sur la frontière principal/rendu. Un point de TÊTE de nom n'est
 * pas une extension (« .gitignore »).
 */
function couperExtension(chemin: string): { base: string; ext: string } {
	const nomFichier = path.basename(chemin);
	const point = nomFichier.lastIndexOf(".");
	if (point <= 0) return { base: chemin, ext: "" };
	const coupe = chemin.length - (nomFichier.length - point);
	return { base: chemin.slice(0, coupe), ext: chemin.slice(coupe) };
}

/**
 * Le premier chemin LIBRE de la forme `base`, `base-2`, `base-3`… + `ext`.
 * NE RÉSERVE RIEN : un appel concurrent peut encore retrouver le même nom
 * libre. Ici, un seul appelant (`trash`) l'utilise et la course entre deux
 * mises à la corbeille du même chemin ne peut de toute façon pas se produire
 * (la seconde ne retrouve plus sa source, déjà déplacée par la première).
 */
async function cheminLibre(base: string, ext: string): Promise<string> {
	for (let n = 1; n <= 50; n++) {
		const candidat = n === 1 ? base + ext : `${base}-${n}${ext}`;
		if (!(await existeSurDisque(candidat))) return candidat;
	}
	throw new Error("aucun nom de fichier libre après 50 essais : " + base + ext);
}

/** Crée un dossier et ses parents ; ne rejette pas s'il existe déjà — une
    course entre deux écritures ne doit pas faire échouer l'une d'elles. */
async function creerDossiers(chemin: string): Promise<void> {
	try {
		await fs.mkdir(chemin, { recursive: true });
	} catch (e) {
		if (!(await existeSurDisque(chemin))) throw e;
	}
}

/** La date de modification d'un fichier, ou `null` s'il est absent ou si le
    chemin désigne un dossier. Primitive INTERNE — voir l'en-tête : la tâche 2
    (l'index) en aura besoin pour les `mtime`, mais elle n'est présentée à
    personne comme une méthode du contrat `HostFs`. */
export async function stat(chemin: string): Promise<{ mtime: number } | null> {
	try {
		const info = await fs.stat(chemin);
		if (info.isDirectory()) return null;
		return { mtime: info.mtimeMs };
	} catch {
		return null;
	}
}

/** Fichier ou dossier, avec sa date : ce que `HostFs.externe.stat` demande.
    DISTINCTE de `stat` ci-dessus, qui rend `null` pour un dossier et dont
    `fraicheur` (canaux.ts) et `parcours.ts` dépendent : l'index d'une racine
    externe s'invalide sur le `mtime` de la RACINE, qui est un dossier. */
export async function statEntree(chemin: string): Promise<{ isFile: boolean; mtimeMs: number } | null> {
	try {
		const info = await fs.stat(chemin);
		return { isFile: info.isFile(), mtimeMs: info.mtimeMs };
	} catch {
		return null;
	}
}

/** Construit les primitives de fichiers du processus principal. */
export function creerFichiers(): PrimitivesFichiers {
	return {
		async read(chemin) {
			return await fs.readFile(chemin, "utf-8");
		},
		/* `new Uint8Array(buffer)` et non le `Buffer` de Node : un `Buffer` peut
		   être une VUE sur un tampon partagé plus grand (le pool de Node pour
		   les petits fichiers), et le clonage structuré de l'IPC emporterait
		   tout le tampon avec lui. La copie coûte la taille du fichier, une
		   fois. */
		async readBinary(chemin) {
			return new Uint8Array(await fs.readFile(chemin));
		},
		/* PAS de cache : un processus unique, sans autre écrivain que lui-même,
		   n'a rien à gagner à en inventer un — même raison que l'hôte Windows
		   actuel (`apps/windows/src/host/fs.ts`). */
		async readCached(chemin) {
			return await fs.readFile(chemin, "utf-8");
		},
		async write(chemin, donnees) {
			await fs.writeFile(chemin, donnees, "utf-8");
		},
		async process(chemin, muter) {
			const contenu = await fs.readFile(chemin, "utf-8");
			await fs.writeFile(chemin, muter(contenu), "utf-8");
		},
		async writeBinary(chemin, donnees) {
			await fs.writeFile(chemin, donnees);
		},
		/* `flag: "a"` : l'ajout est porté par le système de fichiers lui-même,
		   jamais un lire-puis-réécrire qui perdrait l'atomicité. */
		async append(chemin, donnees) {
			await fs.appendFile(chemin, donnees, { encoding: "utf-8" });
		},
		exists: existeSurDisque,
		mkdirs: creerDossiers,
		async trash(chemin, racine) {
			const relatif = path.relative(racine, chemin).split(path.sep).join("/");
			const vise = path.join(racine, ".trash", relatif).split(path.sep).join("/");
			const { base, ext } = couperExtension(vise);
			const cible = await cheminLibre(base, ext);
			await creerDossiers(path.dirname(cible));
			await fs.rename(chemin, cible);
		},
		async list(dossier) {
			try {
				const entrees = await fs.readdir(dossier, { withFileTypes: true });
				return entrees.filter(e => e.isFile()).map(e => path.join(dossier, e.name));
			} catch {
				// Dossier absent (ou illisible) : le contrat demande `[]`, pas une
				// exception.
				return [];
			}
		},
		async listerDossier(dossier) {
			try {
				const entrees = await fs.readdir(dossier, { withFileTypes: true });
				return entrees.map(e => ({ name: e.name, isFolder: e.isDirectory() }));
			} catch {
				// Absent ou illisible : `[]`, comme `list`.
				return [];
			}
		},
		async remove(chemin) {
			try {
				await fs.unlink(chemin);
			} catch (e) {
				if (await existeSurDisque(chemin)) throw e;
			}
		},
		/* Pas d'écrasement : `fs.rename` de Node remplace la destination en
		   silence si elle existe, et la migration du journal s'appuie sur le
		   contraire (voir `apps/windows/src/host/fs.ts`, même remarque) —
		   écraser une sauvegarde `review-log.jsonl.migrated` déjà là la
		   détruirait. */
		async rename(de, vers) {
			if (await existeSurDisque(vers)) throw new Error(`${vers} existe déjà`);
			await fs.rename(de, vers);
		},
	};
}
