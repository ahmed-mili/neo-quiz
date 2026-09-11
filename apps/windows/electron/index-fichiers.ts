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
import { dossierHorsCatalogue, evenementDeRenommageDossier, horsCatalogue } from "./catalogue";
import { creerFichiers, stat } from "./fichiers";
/* `normaliser` vient de `./parcours`, la copie du PRINCIPAL : ce module en
   gardait une deuxième, octet pour octet, sans qu'aucune frontière ne le
   justifie (les deux tirent `node:fs` ; revue finale, M3). Deux copies d'une
   même règle dans un même processus finissent par diverger, et la divergence
   ferait tomber les événements du surveillant dans le vide. */
import { normaliser } from "./parcours";

/**
 * Ce qu'un renommage de DOSSIER, apparié, doit pousser vers le rendu — tâche
 * 5. `from`/`to` sont des chemins du CONTRAT (l'indice de racine en tête,
 * comme le reste de ce module) : c'est `canaux.ts` qui les retraduit en
 * absolu avant de franchir le pont, exactement comme il le fait déjà pour
 * `create`/`modify`/`delete`.
 */
export interface EvenementRenommageDossier {
	kind: "renameDir";
	from: string;
	to: string;
}

/** Ce que `surveiller` peut pousser : un événement de FICHIER (`HostFileEvent`,
    jamais `rename` — voir sa doc), ou un renommage de DOSSIER apparié. */
export type EvenementSurveillant = HostFileEvent | EvenementRenommageDossier;

/** La fenêtre d'appariement d'un renommage de dossier : le temps qu'on laisse
    à un `addDir` pour rejoindre l'`unlinkDir` qui vient de le précéder (ou
    l'inverse — l'ordre entre les deux n'est pas garanti). Fixe et distincte de
    `delayMs` (la stabilisation des ÉCRITURES de fichier, `awaitWriteFinish`) :
    les deux mesurent des choses différentes, et coupler la seconde à zéro
    (comme le fait le cas « delayMs à 0 » du contrôle) ne doit pas désactiver
    l'appariement des dossiers. */
const FENETRE_RENOMMAGE_DOSSIER_MS = 300;

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
	 * fonction qui ARRÊTE VRAIMENT l'écoute (ferme le watcher chokidar, et
	 * annule la minuterie d'appariement des dossiers avec lui — tâche 5) :
	 * sinon chaque remontage de fenêtre fuit un observateur.
	 *
	 * `onEvenement` peut aussi recevoir un renommage de DOSSIER apparié — voir
	 * `EvenementRenommageDossier` : il est PORTÉ, jamais deviné (tâche 5,
	 * `evenementDeRenommageDossier`).
	 */
	surveiller(onEvenement: (ev: EvenementSurveillant) => void, delayMs?: number): () => void;
}

/** Le `HostFile` d'un chemin déjà au format contrat (indice de racine en
    tête). Même découpe que `toHostFile` de l'hôte du rendu : un point de TÊTE
    de nom n'est pas une extension (« .gitignore »). */
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

/**
 * Le chemin ABSOLU disque d'un chemin du contrat (indice de racine en tête),
 * ou `null` si cet indice ne désigne aucune racine connue. L'exact symétrique
 * de `contratDepuisAbsolu` ci-dessus.
 *
 * EXPORTÉE, en dehors de `creerIndex`, pour la même raison que sa jumelle mais
 * avec un appelant de plus : le pont de la tâche 3 (`main.ts`) ne fait jamais
 * franchir l'IPC à la convention INTERNE de ce module (« 0/Cours/ch1.md ») —
 * il retraduit en absolu chaque événement qu'il émet, parce que les chemins du
 * CONTRAT sont les clés du journal de révision et que `src/host/types.ts`
 * interdit qu'un second endroit les recompose. Sans cet export, cette règle
 * serait RECOPIÉE là-bas, et deux copies d'une même règle ont déjà divergé une
 * fois dans ce dépôt.
 */
export function absoluDepuisContrat(racinesAbs: string[], cheminContrat: string): string | null {
	const barre = cheminContrat.indexOf("/");
	const idStr = barre === -1 ? cheminContrat : cheminContrat.slice(0, barre);
	const i = Number(idStr);
	if (!Number.isInteger(i) || i < 0 || i >= racinesAbs.length) return null;
	const relatif = barre === -1 ? "" : cheminContrat.slice(barre + 1);
	return relatif ? path.join(racinesAbs[i], relatif) : racinesAbs[i];
}

/**
 * Traduit un renommage de DOSSIER apparié (chemins du CONTRAT, l'indice de
 * racine en tête) en ses deux chemins ABSOLUS — ce que `canaux.ts` pousse
 * ensuite vers le pont. `null` si l'un des deux ne désigne aucune racine
 * connue (ne devrait pas arriver : `evenementDeRenommageDossier` n'a reçu que
 * des chemins déjà produits par `contratDepuisAbsolu`, mais un défaut
 * silencieux d'un côté ne doit pas fabriquer un chemin absolu inventé de
 * l'autre).
 *
 * PURE : `absoluDepuisContrat` et `normaliser`, toutes deux déjà de ce
 * module — c'est ce qui la rend éprouvable par discriminance, ICI, plutôt
 * que dans `canaux.ts`, qui importe `electron` et qu'aucun harnais ne peut
 * charger (voir `check-electron-index.mjs`, qui charge CE module).
 */
export function renameDirVersAbsolu(
	racinesAbs: string[],
	ev: EvenementRenommageDossier,
): { fromAbs: string; toAbs: string } | null {
	const fromAbs = absoluDepuisContrat(racinesAbs, ev.from);
	const toAbs = absoluDepuisContrat(racinesAbs, ev.to);
	if (!fromAbs || !toAbs) return null;
	return { fromAbs: normaliser(fromAbs), toAbs: normaliser(toAbs) };
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
		const absolu = absoluDepuisContrat(racinesAbs, cheminContrat);
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
			const absolu = absoluDepuisContrat(racinesAbs, chemin);
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

			/* ─── l'appariement d'un renommage de DOSSIER — tâche 5 ───

			   Chokidar remonte `unlinkDir` et `addDir` séparément, sans jamais
			   les lier. On les ACCUMULE dans une fenêtre fixe
			   (`FENETRE_RENOMMAGE_DOSSIER_MS`, distincte de `delayMs` — voir sa
			   doc), puis on demande à `evenementDeRenommageDossier` (PURE, dans
			   `catalogue.ts`) si la paire est CERTAINE. Rien n'est deviné ici :
			   toute la décision vit dans cette fonction, ce module ne fait que
			   lui fournir sa fenêtre. */
			let dossiersSupprimes: string[] = [];
			let dossiersCrees: string[] = [];
			let minuterieDossier: ReturnType<typeof setTimeout> | null = null;

			function planifierAppariement(): void {
				if (minuterieDossier) clearTimeout(minuterieDossier);
				minuterieDossier = setTimeout(() => {
					minuterieDossier = null;
					const supprimes = dossiersSupprimes;
					const crees = dossiersCrees;
					dossiersSupprimes = [];
					dossiersCrees = [];
					const paire = evenementDeRenommageDossier(supprimes, crees);
					if (paire) onEvenement({ kind: "renameDir", from: paire.from, to: paire.to });
				}, FENETRE_RENOMMAGE_DOSSIER_MS);
			}

			watcher.on("unlinkDir", absolu => {
				const chemin = contratDepuisAbsolu(racinesAbs, absolu);
				// FILTRÉ ICI, pas seulement dans la règle pure : un vault porte des
				// centaines de sous-dossiers `.git`/`node_modules` que le parcours
				// initial de chokidar (`ignoreInitial: false`) traverse aussi pour
				// les DOSSIERS (rien ne les en exclut, à la différence des fichiers
				// qui passent par `horsCatalogue` avant d'atteindre `onEvenement`) ;
				// les laisser entrer dans la fenêtre ajouterait des candidats
				// fantômes qui feraient échouer l'appariement d'un renommage
				// pourtant univoque ailleurs dans le vault.
				if (chemin === null || dossierHorsCatalogue(chemin)) return;
				dossiersSupprimes.push(chemin);
				planifierAppariement();
			});
			watcher.on("addDir", absolu => {
				const chemin = contratDepuisAbsolu(racinesAbs, absolu);
				if (chemin === null || dossierHorsCatalogue(chemin)) return;
				dossiersCrees.push(chemin);
				planifierAppariement();
			});

			let arretee = false;
			return () => {
				if (arretee) return;
				arretee = true;
				if (minuterieDossier) clearTimeout(minuterieDossier);
				void watcher.close();
			};
		},
	};
}
