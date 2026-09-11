/* ══════════════════════════════════════════════════════════
   LES RÉGLAGES DE L'APPLICATION — UN JSON, ÉCRIT D'UN SEUL COUP

   Tâche 3 de la migration Tauri → Electron. Remplace
   `@tauri-apps/plugin-store` : les dossiers ouverts, les dates d'examen et les
   réglages de page vivaient dans un magasin Tauri, qui n'existe plus.

   TROIS DIFFÉRENCES ASSUMÉES AVEC LE MAGASIN TAURI, et chacune répare quelque
   chose :

   1. PAS de `save()`. Le magasin Tauri écrivait de façon DÉBOUNCÉE et exigeait
      un `save()` explicite ; `host/folder.ts` en appelait un après chaque
      `set`, et l'oublier perdait le réglage sans un mot. Ici chaque écriture
      touche le disque avant de rendre la main.
   2. ÉCRITURE ATOMIQUE : fichier temporaire, puis `rename`. Une coupure de
      courant au milieu d'un `writeFile` laisserait un JSON tronqué — donc
      illisible, donc TOUS les dossiers de l'utilisateur oubliés au prochain
      démarrage. Le `rename` de Node remplace la destination sous Windows comme
      sous POSIX (c'est l'inverse de `HostFs.rename`, qui refuse d'écraser
      exprès : là-bas la destination est une sauvegarde, ici c'est la version
      précédente du même fichier).
   3. LES ÉCRITURES SONT MISES EN FILE. Deux `ecrire` concurrents (la page
      Réglages enregistre les dossiers et une date d'examen coup sur coup)
      viseraient le même fichier temporaire et l'un écraserait le contenu que
      l'autre est en train de renommer. La file coûte trois lignes ; la course
      coûterait un fichier de réglages vide.

   Ce module n'importe PAS Electron : il reçoit le chemin de son fichier. C'est
   `main.ts` qui sait le composer (`app.getPath("userData")`), et c'est ce qui
   permet d'éprouver ce module sur un dossier temporaire sans lancer une
   fenêtre.
══════════════════════════════════════════════════════════ */

import * as fs from "node:fs/promises";

export interface Reglages {
	lire(cle: string): Promise<unknown>;
	ecrire(cle: string, valeur: unknown): Promise<void>;
	supprimer(cle: string): Promise<void>;
}

/** Le contenu du fichier, ou `{}` s'il est absent, vide ou illisible.
    ILLISIBLE N'EST PAS FATAL : un JSON corrompu par une coupure fait repartir
    l'utilisateur de l'écran de choix, ce qui est désagréable, alors qu'une
    exception ici empêcherait l'application de démarrer du tout. */
async function lireTout(fichier: string): Promise<Record<string, unknown>> {
	try {
		const texte = await fs.readFile(fichier, "utf-8");
		const brut: unknown = JSON.parse(texte);
		return brut && typeof brut === "object" && !Array.isArray(brut)
			? (brut as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/** Les réglages persistés dans `fichier` (un chemin ABSOLU). */
export function creerReglages(fichier: string): Reglages {
	/* La table est chargée UNE fois puis tenue en mémoire : le plan de
	   révision est recalculé à chaque réponse jouée et relit les dates
	   d'examen, un aller-retour disque par calcul serait payé pour rien
	   (même raison que `chargerExamDates` côté rendu). Ce processus est le
	   seul écrivain de ce fichier. */
	let table: Record<string, unknown> | null = null;
	/* La file : chaque écriture s'enchaîne sur la précédente, réussie ou non
	   (`catch` avalé côté file, l'erreur reste rendue à SON appelant). */
	let file: Promise<unknown> = Promise.resolve();

	async function charger(): Promise<Record<string, unknown>> {
		if (!table) table = await lireTout(fichier);
		return table;
	}

	async function ecrireDisque(): Promise<void> {
		const temporaire = `${fichier}.tmp`;
		await fs.writeFile(temporaire, JSON.stringify(table ?? {}, null, "\t"), "utf-8");
		await fs.rename(temporaire, fichier);
	}

	/** Enchaîne une modification sur la file, et rend SON résultat. */
	function enfiler(modifier: () => void): Promise<void> {
		const suivant = file.then(async () => {
			await charger();
			modifier();
			await ecrireDisque();
		});
		file = suivant.catch(() => {});
		return suivant;
	}

	return {
		async lire(cle) {
			return (await charger())[cle];
		},
		async ecrire(cle, valeur) {
			return await enfiler(() => {
				/* `table` est chargée par `enfiler` avant l'appel : l'assertion
				   n'est pas un pari, c'est l'ordre de la file. */
				(table as Record<string, unknown>)[cle] = valeur;
			});
		},
		async supprimer(cle) {
			return await enfiler(() => {
				delete (table as Record<string, unknown>)[cle];
			});
		},
	};
}
