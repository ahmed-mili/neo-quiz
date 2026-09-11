/* ══════════════════════════════════════════════════════════
   L'INDEX EN MÉMOIRE ET LE SURVEILLANT DÉBOUNCÉ, CÔTÉ PROCESSUS PRINCIPAL

   Tâche 2 de la migration Tauri → Electron
   (docs/superpowers/plans/2026-09-11-migration-electron.md). Consomme
   `creerFichiers()` et `stat()` de `./fichiers` (tâche 1), et les deux
   fonctions PURES de `./catalogue` (tâche 2 — voir l'en-tête de ce module
   pour pourquoi elles n'y sont pas restées à l'intérieur de CE fichier-ci).

   POURQUOI CHOKIDAR : `fs.watch` récursif est notoirement inégal sous Windows
   (doublons, événements manquants). Chokidar est la bibliothèque que
   l'écosystème emploie pour ça depuis dix ans.

   RÈGLE DE CHEMINS : ce module ne connaît PAS `CarteRacines` (qui vit côté
   rendu, dans `apps/windows/src/host/roots.ts`, et ne bouge pas). Il reçoit
   une simple liste de racines ABSOLUES et fabrique lui-même des chemins de la
   forme CONTRAT que `horsCatalogue`/`evenementDeRenommage` attendent : le
   PREMIER segment est l'INDICE de la racine dans le tableau reçu (« 0 »,
   « 1 »…), jamais un chemin réel — ces deux fonctions ne regardent que la
   FORME du premier segment (un identifiant, quel qu'il soit), jamais son
   contenu. La tâche 3 (pont IPC) choisira ce que le rendu voit réellement
   passer ; ce n'est pas à cette tâche de l'anticiper.
══════════════════════════════════════════════════════════ */

import { watch } from "chokidar";
import * as path from "node:path";
import type { HostFile, HostFileEvent } from "../../../src/host/types";
import { horsCatalogue } from "./catalogue";
import { creerFichiers, stat } from "./fichiers";

/** L'index en mémoire, plus la surveillance qui le tient à jour. */
export interface Index {
	all(): HostFile[];
	get(chemin: string): HostFile | null;
	apply(ev: HostFileEvent): void;
	/**
	 * Enveloppe `fichiers.write` puis RECALE l'entrée sur ce que le disque dit
	 * MAINTENANT, sans attendre le surveillant — c'est la promesse du contrat
	 * (`src/host/types.ts`, « LA FRAÎCHEUR APRÈS UNE ÉCRITURE ») : au retour
	 * de `write`, `get(chemin)` doit rendre le `mtime` NEUF. Sans ce recalage,
	 * l'index n'apprendrait le changement que du surveillant, débouncé —
	 * exactement le défaut mesuré côté Tauri (6000 vs 1000, voir
	 * `apps/windows/src/host/fs.ts`) qui produisait une Notice « modifié
	 * dehors » mensongère après chaque sauvegarde. `fichiers.ts` ne connaît
	 * pas l'index : c'est forcément CE module, qui connaît les deux, qui fait
	 * le lien — deux voies possibles, celle-ci (l'index enveloppe l'écriture)
	 * plutôt qu'un recalage optimiste avant même que l'écriture ait réussi.
	 */
	write(chemin: string, donnees: string): Promise<void>;
	/**
	 * Démarre la surveillance de TOUTES les racines et abonne `onEvenement`.
	 * `delayMs` est le délai de stabilité de chokidar (`awaitWriteFinish`) :
	 * un éditeur écrit souvent une note en plusieurs passes rapprochées, et
	 * sans délai chaque passe repeindrait sa propre notification. Rend une
	 * fonction qui ARRÊTE VRAIMENT l'écoute (ferme le watcher chokidar) :
	 * sinon chaque remontage de fenêtre fuit un observateur.
	 */
	surveiller(onEvenement: (ev: HostFileEvent) => void, delayMs?: number): () => void;
}

/** Sépare avec des `/` et retire le séparateur final — même règle que l'hôte
    Tauri (`apps/windows/src/host/fs.ts`, `normaliser`) : Windows accepte les
    deux séparateurs en lecture, le contrat n'en accepte qu'un. */
function normaliser(chemin: string): string {
	return String(chemin ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Le `HostFile` d'un chemin déjà au format contrat (indice de racine en
    tête). Même découpe que `toHostFile` de l'hôte Tauri : un point de TÊTE de
    nom n'est pas une extension (« .gitignore »). */
function toHostFile(cheminContrat: string, mtime: number): HostFile {
	const p = normaliser(cheminContrat);
	const name = p.split("/").pop() || p;
	const point = name.lastIndexOf(".");
	return {
		path: p,
		name,
		basename: point > 0 ? name.slice(0, point) : name,
		extension: point > 0 ? name.slice(point + 1) : "",
		mtime,
	};
}

/**
 * Le chemin du contrat correspondant à un chemin ABSOLU du disque, ou `null`
 * s'il ne tombe sous AUCUNE des racines données — le surveillant est borné à
 * ces racines, jamais à leur dossier parent.
 *
 * EXPORTÉE, en dehors de `creerIndex`, pour être ÉPROUVÉE DIRECTEMENT : c'est
 * ce garde-fou (et lui seul) qui décide qu'un chemin hors racine ne doit rien
 * produire. Un cas qui passerait par `surveiller()` pour l'atteindre
 * n'éprouverait en réalité que la promesse de chokidar de ne surveiller que ce
 * qu'on lui donne (`watch(racinesAbs, …)`) — jamais ce garde-fou lui-même,
 * puisqu'un chemin hors racine n'atteint alors jamais cette fonction. Voir
 * `scripts/check-electron-index.mjs`, cas « contratDepuisAbsolu rend null hors
 * de toute racine », et la ronde de correction qui l'a exigé.
 */
export function contratDepuisAbsolu(racinesAbs: string[], absolu: string): string | null {
	const a = normaliser(absolu);
	for (let i = 0; i < racinesAbs.length; i++) {
		const base = normaliser(racinesAbs[i]);
		if (a.toLowerCase() === base.toLowerCase()) return String(i);
		if (a.toLowerCase().startsWith(base.toLowerCase() + "/")) {
			return `${i}/${a.slice(base.length + 1)}`;
		}
	}
	return null;
}

/** Construit l'index en mémoire pour ces racines (chemins ABSOLUS du disque).
    Démarre VIDE : c'est `surveiller()` (via le parcours initial de chokidar,
    `ignoreInitial: false`) qui le peuple — voir l'en-tête pour pourquoi ce
    module ne fait pas lui-même un parcours disque séparé. Une `Map` et pas un
    tableau : `get` est appelé par chemin, et un balayage linéaire d'un vault
    de milliers de fichiers se paierait à chaque rendu. */
export function creerIndex(racines: string[]): Index {
	const racinesAbs = racines.map(normaliser);
	const parChemin = new Map<string, HostFile>();
	const fichiers = creerFichiers();

	/** Le chemin ABSOLU disque d'un chemin du contrat, ou `null` si son indice
	    de racine ne désigne aucune racine connue. */
	function absoluDepuisContrat(cheminContrat: string): string | null {
		const barre = cheminContrat.indexOf("/");
		const idStr = barre === -1 ? cheminContrat : cheminContrat.slice(0, barre);
		const i = Number(idStr);
		if (!Number.isInteger(i) || i < 0 || i >= racinesAbs.length) return null;
		const relatif = barre === -1 ? "" : cheminContrat.slice(barre + 1);
		return relatif ? path.join(racinesAbs[i], relatif) : racinesAbs[i];
	}

	function apply(ev: HostFileEvent): void {
		switch (ev.kind) {
			case "create":
			case "modify":
				// La même écriture pour les deux : `set` remplace l'entrée, donc une
				// modification met la date à jour sans jamais dupliquer.
				parChemin.set(ev.file.path, ev.file);
				return;
			case "delete":
				parChemin.delete(ev.path);
				return;
			case "rename":
				// Les DEUX opérations, dans cet ordre — oublier le `delete` laisserait
				// un quiz fantôme, que plus aucun fichier ne peut mettre à jour.
				parChemin.delete(ev.oldPath);
				parChemin.set(ev.file.path, ev.file);
				return;
		}
	}

	/** RECALE l'entrée d'un chemin sur ce que le disque dit MAINTENANT — voir
	    la doc de `Index.write`. Un `stat` qui échoue ne fait PAS échouer
	    l'écriture qui vient de réussir : le surveillant recalera plus tard,
	    c'est la seule fenêtre où la promesse peut ne pas être tenue. */
	async function recaler(cheminContrat: string): Promise<void> {
		if (horsCatalogue(cheminContrat)) return;
		const absolu = absoluDepuisContrat(cheminContrat);
		if (!absolu) return;
		const info = await stat(absolu);
		if (!info) return;
		const file = toHostFile(cheminContrat, info.mtime);
		apply(parChemin.has(cheminContrat) ? { kind: "modify", file } : { kind: "create", file });
	}

	return {
		all() {
			return [...parChemin.values()];
		},
		get(chemin) {
			return parChemin.get(normaliser(chemin)) ?? null;
		},
		apply,
		async write(chemin, donnees) {
			const absolu = absoluDepuisContrat(chemin);
			if (!absolu) throw new Error(`chemin hors des racines surveillées : ${chemin}`);
			await fichiers.write(absolu, donnees);
			await recaler(chemin);
		},
		surveiller(onEvenement, delayMs = 300) {
			if (racinesAbs.length === 0) return () => {};

			const watcher = watch(racinesAbs, {
				ignoreInitial: false,
				// `false` et non `{ stabilityThreshold: 0, … }` : chokidar traite un
				// seuil de zéro comme « toujours instable » sur certains systèmes de
				// fichiers, alors que `false` désactive proprement l'attente — c'est
				// la rupture du cas « delayMs à 0 » du contrôle.
				awaitWriteFinish: delayMs > 0
					? { stabilityThreshold: delayMs, pollInterval: Math.min(50, delayMs) }
					: false,
			});

			/* Un `add`/`change` a besoin du `mtime` NEUF : chokidar ne le porte pas
			   lui-même dans ces événements de façon fiable sur tous les systèmes de
			   fichiers, donc on repasse par `stat` (la même primitive que
			   `recaler`) plutôt que de lui faire confiance. */
			function surFichier(kind: "create" | "modify", absolu: string): void {
				const chemin = contratDepuisAbsolu(racinesAbs, absolu);
				if (chemin === null || horsCatalogue(chemin)) return;
				void stat(absolu).then(info => {
					if (!info) return; // disparu entre l'événement et le `stat`.
					const file = toHostFile(chemin, info.mtime);
					const ev: HostFileEvent = { kind, file };
					apply(ev);
					onEvenement(ev);
				});
			}

			function surSuppression(absolu: string): void {
				const chemin = contratDepuisAbsolu(racinesAbs, absolu);
				if (chemin === null || horsCatalogue(chemin)) return;
				// Garde : ne pas annoncer la suppression d'un fichier qui n'a jamais
				// été au catalogue (un `.tmp` d'éditeur, par exemple) — même règle
				// que la réconciliation Tauri.
				if (!parChemin.has(chemin)) return;
				const ev: HostFileEvent = { kind: "delete", path: chemin };
				apply(ev);
				onEvenement(ev);
			}

			watcher.on("add", p => surFichier("create", p));
			watcher.on("change", p => surFichier("modify", p));
			watcher.on("unlink", surSuppression);

			let arretee = false;
			return () => {
				if (arretee) return;
				arretee = true;
				void watcher.close();
			};
		},
	};
}
