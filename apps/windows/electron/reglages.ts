/* ══════════════════════════════════════════════════════════
   LES RÉGLAGES DE L'APPLICATION — UN JSON, ÉCRIT D'UN SEUL COUP

   Tâche 3 de la migration Tauri → Electron. Remplace
   `@tauri-apps/plugin-store` : les dossiers ouverts, les dates d'examen et les
   réglages de page vivaient dans un magasin Tauri, qui n'existe plus.

   QUATRE DIFFÉRENCES ASSUMÉES AVEC LE MAGASIN TAURI, et chacune répare quelque
   chose :

   1. PAS de `save()`. Le magasin Tauri écrivait de façon DÉBOUNCÉE et exigeait
      un `save()` explicite ; `host/folder.ts` en appelait un après chaque
      `set`, et l'oublier perdait le réglage sans un mot. Ici chaque écriture
      touche le disque avant de rendre la main.
   2. ÉCRITURE ATOMIQUE : fichier temporaire, `fsync`, puis `rename`. Une
      coupure au milieu d'un `writeFile` laisserait un JSON tronqué — donc
      illisible, donc TOUS les dossiers de l'utilisateur oubliés au prochain
      démarrage. Le `fsync` est ce qui fait du `rename` une vraie promesse : sans
      lui, le renommage peut être journalisé AVANT que les octets du temporaire
      aient atteint le disque, et la coupure laisse un fichier vide sous le bon
      nom. Le `rename` de Node remplace la destination sous Windows comme sous
      POSIX (c'est l'inverse de `HostFs.rename`, qui refuse d'écraser exprès :
      là-bas la destination est une sauvegarde, ici la version précédente du
      même fichier). Le nom du temporaire porte le PID : deux instances de
      l'application écrivant le même `.tmp` renommeraient chacune le contenu de
      l'autre, et la seconde échouerait en `ENOENT`.
   3. LES ÉCRITURES SONT MISES EN FILE. Deux `ecrire` concurrents (la page
      Réglages enregistre les dossiers et une date d'examen coup sur coup)
      viseraient le même fichier temporaire et l'un écraserait le contenu que
      l'autre est en train de renommer. La file coûte trois lignes ; la course
      coûterait un fichier de réglages vide.
   4. UNE LECTURE IMPOSSIBLE N'EST JAMAIS PRISE POUR UN FICHIER VIDE. La
      première version de ce module avalait TOUTE exception de lecture et
      rendait `{}`, mis en cache pour la vie du processus : un `EBUSY` d'un
      antivirus au démarrage, puis le premier `ecrire`, et l'utilisateur perdait
      tous ses dossiers sans un mot. Désormais seul `ENOENT` (le fichier
      n'existe pas encore) vaut `{}` ; un JSON ILLISIBLE est d'abord MIS DE CÔTÉ
      (`settings.json.corrompu-<date>`) avant qu'on reparte de vide ; toute
      autre erreur REJETTE, sans rien mettre en cache, et l'écriture qui suivrait
      rejette aussi — rien n'est écrasé.

   Ce module n'importe PAS Electron : il reçoit le chemin de son fichier. C'est
   `main.ts` qui sait le composer (`app.getPath("userData")`), et c'est ce qui
   permet de l'éprouver sur un dossier temporaire
   (`scripts/check-electron-reglages.mjs`).
══════════════════════════════════════════════════════════ */

import * as fs from "node:fs/promises";

export interface Reglages {
	lire(cle: string): Promise<unknown>;
	ecrire(cle: string, valeur: unknown): Promise<void>;
	supprimer(cle: string): Promise<void>;
}

/** Le contenu du fichier. `{}` SEULEMENT s'il n'existe pas ; un JSON
    illisible est mis de côté puis vaut `{}` ; toute autre erreur (droits,
    verrou, dossier à la place du fichier) REJETTE — voir l'en-tête, point 4. */
async function lireTout(fichier: string): Promise<Record<string, unknown>> {
	let texte: string;
	try {
		texte = await fs.readFile(fichier, "utf-8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw e;
	}
	try {
		const brut: unknown = JSON.parse(texte);
		if (brut && typeof brut === "object" && !Array.isArray(brut)) return brut as Record<string, unknown>;
	} catch {
		// tombe dans la mise de côté ci-dessous
	}
	/* Illisible ou pas un objet : on le garde SOUS UN AUTRE NOM avant de
	   repartir de vide. L'utilisateur y retrouvera ses dossiers à la main ; un
	   écrasement silencieux ne lui laisserait rien. La date dans le nom :
	   deux corruptions ne doivent pas s'écraser l'une l'autre. */
	await fs.rename(fichier, `${fichier}.corrompu-${new Date().toISOString().replace(/[:.]/g, "-")}`);
	return {};
}

/** Les réglages persistés dans `fichier` (un chemin ABSOLU). */
export function creerReglages(fichier: string): Reglages {
	/* La table est chargée UNE fois puis tenue en mémoire : le plan de
	   révision est recalculé à chaque réponse jouée et relit les dates
	   d'examen, un aller-retour disque par calcul serait payé pour rien
	   (même raison que `chargerExamDates` côté rendu). Ce processus est le
	   seul écrivain de ce fichier — `app.requestSingleInstanceLock()` dans
	   `main.ts` y veille. Un chargement qui ÉCHOUE ne remplit pas `table` : le
	   prochain appel réessaie, et rien n'est écrit entre-temps. */
	let table: Record<string, unknown> | null = null;
	/* La file : chaque écriture s'enchaîne sur la précédente, réussie ou non
	   (`catch` avalé côté file, l'erreur reste rendue à SON appelant). */
	let file: Promise<unknown> = Promise.resolve();

	async function charger(): Promise<Record<string, unknown>> {
		if (!table) table = await lireTout(fichier);
		return table;
	}

	async function ecrireDisque(donnees: Record<string, unknown>): Promise<void> {
		const temporaire = `${fichier}.${process.pid}.tmp`;
		const poignee = await fs.open(temporaire, "w");
		try {
			await poignee.writeFile(JSON.stringify(donnees, null, "\t"), "utf-8");
			await poignee.sync();
		} finally {
			await poignee.close();
		}
		await fs.rename(temporaire, fichier);
	}

	/** Enchaîne une modification sur la file, et rend SON résultat. */
	function enfiler(modifier: (t: Record<string, unknown>) => void): Promise<void> {
		const suivant = file.then(async () => {
			const t = await charger();
			modifier(t);
			await ecrireDisque(t);
		});
		file = suivant.catch(() => {});
		return suivant;
	}

	return {
		async lire(cle) {
			return (await charger())[cle];
		},
		ecrire(cle, valeur) {
			refuserClePrototype(cle);
			return enfiler(t => { t[cle] = valeur; });
		},
		supprimer(cle) {
			refuserClePrototype(cle);
			return enfiler(t => { delete t[cle]; });
		},
	};
}

/**
 * REFUSE les trois clés qui n'écriraient pas dans la table mais dans sa
 * CHAÎNE DE PROTOTYPES (revue finale, M6). La clé vient du rendu, par l'IPC :
 * `ecrire("__proto__", { folders: … })` ne posait aucune propriété propre, il
 * remplaçait le prototype de `table` — et chaque `lire` d'une clé absente
 * remontait ensuite jusqu'à cette valeur. `JSON.parse` ne crée jamais ce cas
 * à la lecture (une clé « __proto__ » y devient une propriété PROPRE), c'est
 * bien l'affectation `t[cle] = valeur` qui l'ouvrait. Refuser plutôt
 * qu'`Object.create(null)` : une clé qui n'a aucun sens comme réglage mérite
 * une erreur NOMMÉE, pas une écriture silencieusement inerte. `lire` n'est
 * pas gardée : lire `__proto__` rend le prototype d'un objet ordinaire, pas
 * un secret, et l'appelant y voit une valeur absurde plutôt qu'une erreur.
 */
function refuserClePrototype(cle: string): void {
	if (cle === "__proto__" || cle === "constructor" || cle === "prototype") {
		throw new Error("clé de réglage refusée : " + cle);
	}
}
