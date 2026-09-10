/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — SYSTÈME DE FICHIERS, INDEX, SURVEILLANCE

   Obsidian tient son propre index du vault ; un dossier nu n'en a pas. Ce
   module le construit au démarrage et le maintient par le surveillant, pour
   que `listMarkdown`, `findByName` et `getFile` restent SYNCHRONES — le
   scanner et le sanitizer les appellent en plein rendu, où une promesse
   obligerait à rendre tout le rendu asynchrone.

   RÈGLE QUI GOUVERNE CE FICHIER : les chemins du contrat sont ceux de
   `CarteRacines` (`./roots.ts`) — un premier segment qui nomme la racine,
   puis un chemin `/` relatif à elle — jamais des chemins absolus. La
   conversion chemin du contrat ↔ chemin absolu disque vit dans `roots.ts` et
   NULLE PART ailleurs : ce fichier ne fait que la CONSOMMER (`carte.absolu`,
   `carte.depuisAbsolu`), jamais la recomposer à la main. Un chemin absolu qui
   fuirait dans le code partagé casserait les clés du journal de révision, qui
   doivent être identiques sous les trois hôtes — et le défaut ne se verrait
   qu'à la tranche 2, quand l'historique de révision ne se retrouverait plus.
══════════════════════════════════════════════════════════ */

import {
	exists, mkdir, readDir, readTextFile, remove as removeFichier,
	rename as renameFichier, stat, watch, writeFile, writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { WatchEvent } from "@tauri-apps/plugin-fs";
import { LOG_PREFIX } from "../../../../src/branding";
import type { HostFile, HostFileEvent, HostFs, HostWatcher } from "../../../../src/host/types";
import { cheminLibre, couperExtension } from "./roots";
import type { CarteRacines } from "./roots";

/** L'index en mémoire du dossier. Volontairement minuscule : c'est ce qui le
    rend éprouvable hors de la fenêtre (`npm run check:windows-host`). */
export interface WindowsIndex {
	all(): HostFile[];
	get(path: string): HostFile | null;
	apply(ev: HostFileEvent): void;
}

/* ─────────── chemins ─────────── */

/** Sépare avec des `/` et retire le séparateur final. Windows accepte les deux
    séparateurs en lecture ; le contrat, lui, n'en accepte qu'un. */
function normaliser(chemin: string): string {
	return String(chemin ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Le chemin absolu D'UNE SEULE RACINE (son dossier disque + un chemin
    INTERNE à ce dossier, jamais encore préfixé). Utilisé seulement pendant
    le PARCOURS d'une racine, avant que `carte.contrat` ne pose le préfixe :
    ce n'est PAS la conversion chemin du contrat ↔ absolu, qui vit désormais
    dans `roots.ts` (`CarteRacines.absolu` / `.depuisAbsolu`) et nulle part
    ailleurs — ici, la racine à utiliser n'est jamais ambiguë, elle est
    l'unique argument reçu. */
function joindreDansRacine(racineDisque: string, relatif: string): string {
	const rel = normaliser(relatif).replace(/^\/+/, "");
	const base = normaliser(racineDisque);
	return rel ? `${base}/${rel}` : base;
}

/** Le `HostFile` d'un chemin du contrat. `mtime` vaut 0 quand l'hôte l'ignore,
    ce que le contrat autorise explicitement. */
export function toHostFile(relatif: string, mtime = 0): HostFile {
	const path = normaliser(relatif).replace(/^\/+/, "");
	const name = path.split("/").pop() || path;
	// `lastIndexOf > 0` et non `>= 0` : « .gitignore » est un nom, pas une
	// extension. Même découpe que le `TFile` d'Obsidian.
	const point = name.lastIndexOf(".");
	return {
		path,
		name,
		basename: point > 0 ? name.slice(0, point) : name,
		extension: point > 0 ? name.slice(point + 1) : "",
		mtime,
	};
}

/* ─────────── l'index, PUR ─────────── */

/**
 * L'index à partir d'une liste de fichiers. PUR : aucun appel Tauri, aucun
 * accès au disque, aucune horloge. C'est ce qui le rend éprouvable, et c'est
 * pour ça qu'il ne faut jamais y glisser une lecture « juste pour vérifier ».
 *
 * Une `Map` et pas un tableau : `get` est appelé par chemin pour chaque image
 * de chaque question, et un balayage linéaire d'un vault de milliers de
 * fichiers se paierait à chaque rendu.
 */
export function buildIndex(fichiers: HostFile[]): WindowsIndex {
	const parChemin = new Map<string, HostFile>();
	for (const f of fichiers) if (f && f.path) parChemin.set(f.path, f);

	return {
		all() {
			return [...parChemin.values()];
		},
		get(path) {
			return parChemin.get(String(path ?? "")) ?? null;
		},
		apply(ev) {
			switch (ev.kind) {
				case "create":
				case "modify":
					// La même écriture pour les deux : `set` remplace l'entrée, donc
					// une modification met la date à jour sans jamais dupliquer.
					parChemin.set(ev.file.path, ev.file);
					return;
				case "delete":
					parChemin.delete(ev.path);
					return;
				case "rename":
					/* Les DEUX opérations, dans cet ordre. Oublier le `delete`
					   laisserait au catalogue un quiz fantôme, que plus aucun fichier
					   ne peut mettre à jour ni retirer. */
					parChemin.delete(ev.oldPath);
					parChemin.set(ev.file.path, ev.file);
					return;
			}
		},
	};
}

/* ─────────── le parcours du dossier ─────────── */

/**
 * Dossiers jamais indexés.
 *
 * Tout dossier CACHÉ (nom commençant par un point) est écarté, plus
 * `node_modules`. Ce n'est pas de la coquetterie : indexer `.git` fait grimper
 * un dossier de cours de quelques centaines d'entrées à des dizaines de
 * milliers, dont pas une seule n'est un quiz — le démarrage s'allonge, la
 * mémoire monte, et `findByName` doit balayer tout ça à chaque image.
 * `.obsidian` et `.neo-quiz` (les résultats, cf. `paths.resultsDirFor`) tombent
 * sous la même règle ; ils restent LISIBLES par chemin, ils ne sont
 * simplement pas au catalogue.
 */
function dossierIgnore(nom: string): boolean {
	return nom.startsWith(".") || nom === "node_modules";
}

/**
 * Un chemin du CONTRAT que le catalogue ne doit pas connaître : il traverse un
 * dossier ignoré, ou il se réduit à la racine elle-même.
 *
 * Nommée et exportée pour être ÉPROUVABLE, et pour que le parcours du démarrage
 * et le surveillant ne puissent pas diverger : c'est exactement ce qui venait
 * d'arriver. `reconcilier` filtrait, la branche des renommages `both` non — un
 * fichier mis à la corbeille par `HostFs.trash` (un `rename` vers
 * `<racine>/.trash/…`) rentrait donc au catalogue sous son chemin de corbeille,
 * et le quiz restait dans « Mes quiz » jusqu'au redémarrage. Le premier segment
 * est l'identifiant de la racine et le dernier le NOM du fichier : ni l'un ni
 * l'autre n'est un dossier traversé.
 */
export function horsCatalogue(cheminContrat: string): boolean {
	const segments = cheminContrat.split("/");
	if (segments.length < 2) return true;
	return segments.slice(1, -1).some(dossierIgnore);
}

/**
 * Ce que le CATALOGUE doit retenir d'un renommage de fichier, une fois ses deux
 * chemins résolus dans l'espace du contrat. `null` quand il n'a rien à en
 * faire.
 *
 * Un renommage qui ENTRE dans un dossier ignoré n'est pas un renommage pour le
 * catalogue, c'est une DISPARITION ; qui en SORT, une APPARITION. Diffuser un
 * `rename` dans le premier cas insérerait le chemin de corbeille à l'index
 * (`buildIndex`, `apply` ne filtre rien) ; se contenter de ne rien diffuser y
 * laisserait l'ANCIEN chemin, donc un quiz que plus aucun fichier ne peut
 * mettre à jour — les deux moitiés sont nécessaires.
 *
 * PURE : c'est ce qui la rend éprouvable, le surveillant ne l'étant pas.
 */
export function evenementDeRenommage(
	avant: string,
	apres: string,
	file: HostFile,
): HostFileEvent | null {
	const avantAuCatalogue = !horsCatalogue(avant);
	const apresAuCatalogue = !horsCatalogue(apres);
	if (!apresAuCatalogue) return avantAuCatalogue ? { kind: "delete", path: avant } : null;
	return avantAuCatalogue
		? { kind: "rename", file, oldPath: avant }
		: { kind: "create", file };
}

/** Concurrence des `stat` du démarrage : un aller-retour IPC par fichier, donc
    on en tient plusieurs en vol sans pour autant en lancer mille d'un coup. */
const LOTS_STAT = 24;

async function parcourir(racine: string, relatif: string, sortie: string[]): Promise<void> {
	let entrees;
	try {
		// Pas de `baseDir` : la racine est un chemin ABSOLU choisi par
		// l'utilisateur, pas un dossier standard de l'application.
		entrees = await readDir(joindreDansRacine(racine, relatif));
	} catch (e) {
		// Un sous-dossier illisible (droits, disque réseau absent) ne doit pas
		// vider l'index entier : on le signale et on continue.
		console.warn(LOG_PREFIX, "lecture du dossier impossible:", relatif, e);
		return;
	}
	for (const entree of entrees) {
		// Les liens symboliques (et les jonctions Windows) sont écartés : un lien
		// vers un dossier parent ferait boucler le parcours à l'infini, et la
		// fenêtre se figerait au démarrage sans aucun message.
		if (entree.isSymlink) continue;
		const chemin = relatif ? `${relatif}/${entree.name}` : entree.name;
		if (entree.isDirectory) {
			if (dossierIgnore(entree.name)) continue;
			await parcourir(racine, chemin, sortie);
		} else if (entree.isFile) {
			sortie.push(chemin);
		}
	}
}

/**
 * Construit l'index de TOUTES les racines ouvertes.
 *
 * `DirEntry` ne porte AUCUN chemin (Tauri 2) et `readDir` n'a pas d'option
 * récursive : les chemins sont composés en descendant, la récursion est à
 * notre charge.
 *
 * Le parcours de chaque racine produit des chemins INTERNES à elle (pas
 * encore de préfixe) ; le préfixe de racine est posé ICI, une seule fois, via
 * `carte.contrat` — tout ce qui sort de l'index est déjà un chemin du
 * contrat, et plus rien en aval n'a à savoir qu'il y a plusieurs racines.
 *
 * `stat` n'est appelé que sur les `.md`, désormais via `carte.absolu` (le
 * chemin collecté porte déjà son préfixe). C'est un aller-retour IPC par
 * fichier, et seul le catalogue de quiz se sert de `mtime` (tri « récents »,
 * `dashboard/quiz-recent.ts`) : le payer pour chaque image d'un dossier de
 * cours serait une dépense sans acheteur. Les autres fichiers gardent
 * `mtime: 0`, ce que le contrat autorise.
 */
export async function createWindowsIndex(carte: CarteRacines): Promise<WindowsIndex> {
	const fichiers: HostFile[] = [];
	for (const racine of carte.toutes()) {
		const chemins: string[] = [];
		await parcourir(racine.path, "", chemins);
		for (const c of chemins) fichiers.push(toHostFile(carte.contrat(racine.id, c)));
	}

	const aDater = fichiers.filter(f => f.extension === "md");
	for (let i = 0; i < aDater.length; i += LOTS_STAT) {
		await Promise.all(aDater.slice(i, i + LOTS_STAT).map(async f => {
			try {
				const absolu = carte.absolu(f.path);
				if (!absolu) return; // chemin hors racines : ne peut pas arriver ici.
				const info = await stat(absolu);
				// FileInfo.mtime est `Date | null` ; HostFile.mtime est un nombre.
				f.mtime = info.mtime ? info.mtime.getTime() : 0;
			} catch (e) {
				// Un fichier disparu entre le parcours et le stat : sa date reste 0,
				// le surveillant le retirera. Rien à interrompre.
			}
		}));
	}
	return buildIndex(fichiers);
}

/* ─────────── le contrat HostFs ─────────── */

export function createWindowsFs(carte: CarteRacines, index: WindowsIndex): HostFs {
	const abs = (chemin: string): string => {
		const a = carte.absolu(chemin);
		/* Un chemin hors racines ne doit pas devenir un chemin absolu
		   plausible : il sortirait de la portée native et échouerait avec un
		   message incompréhensible. Mieux vaut nommer la cause. */
		if (!a) throw new Error(`chemin hors des dossiers ouverts : ${chemin}`);
		return a;
	};

	/* NOMMÉES, hors du littéral rendu ci-dessous : `trash` a besoin d'appeler
	   l'existence et la création de dossier, et `this` ne désigne rien
	   d'utilisable dans un objet rendu par une fabrique (l'appelant reçoit
	   `host.fs`, mais rien n'oblige à l'appeler comme une méthode). Même patron
	   que le `mkdirs` de `apps/obsidian/host.ts`. Les noms diffèrent de ceux du
	   contrat parce que `exists` est déjà celui de plugin-fs, importé ci-dessus :
	   deux `exists` dans la même portée, c'est une erreur de compilation — et,
	   pire, un piège si l'un des deux venait à masquer l'autre en silence. */
	async function existe(path: string): Promise<boolean> {
		return await exists(abs(path));
	}

	/**
	 * RECALE L'INDEX sur ce que le disque dit MAINTENANT.
	 *
	 * Appelée après chaque écriture réussie, et c'est la promesse du contrat
	 * (`src/host/types.ts`, « LA FRAÎCHEUR APRÈS UNE ÉCRITURE ») : au retour
	 * de `write`, `process`, `writeBinary` ou `append`, `getFile` doit rendre
	 * le `mtime` NEUF. Sans elle, l'index n'apprenait le changement que du
	 * surveillant, DÉBOUNCÉ de 300 ms — et un appelant qui relit le `mtime` de
	 * sa propre écriture obtenait celui d'AVANT. Mesuré : la même écriture
	 * rendait 6000 sous Obsidian (dont le `HostFile` est refabriqué à chaque
	 * appel depuis un `TFile` vivant) et 1000 ici. `detail-io.ts` en tirait une
	 * Notice « modifié dehors » mensongère après chaque sauvegarde.
	 *
	 * Le MÊME prédicat de catalogue que le surveillant (`horsCatalogue`) : le
	 * journal de révision (`<racine>/.neo-quiz/…`) et les résultats exportés
	 * n'ont rien à faire à l'index, et les y faire entrer par cette porte
	 * rouvrirait exactement la divergence que `horsCatalogue` a été extraite
	 * pour fermer. Un chemin ignoré coûte donc ZÉRO aller-retour natif.
	 *
	 * Un `stat` qui échoue ne fait PAS échouer l'écriture — elle a réussi, et
	 * la refuser après coup serait mentir dans l'autre sens. On le SIGNALE, et
	 * le surveillant recalera. C'est la seule fenêtre où la promesse peut ne
	 * pas être tenue, et elle est bruyante.
	 */
	async function recaler(path: string): Promise<void> {
		if (horsCatalogue(path)) return;
		try {
			const info = await stat(abs(path));
			if (info.isDirectory) return;
			const file = toHostFile(path, info.mtime ? info.mtime.getTime() : 0);
			// `create` ou `modify` : `buildIndex.apply` les traite pareil, mais
			// le nom doit rester juste — le surveillant émettra le même plus tard.
			index.apply(index.get(path) ? { kind: "modify", file } : { kind: "create", file });
		} catch (e) {
			console.warn(LOG_PREFIX, "index non recalé après écriture:", path, e);
		}
	}

	/* `recursive: true` crée le dossier ET ses parents. Le contrat exige de
	   ne pas rejeter quand il existe déjà : on ne re-jette que si le dossier
	   n'est toujours pas là après l'échec — sinon une course entre deux
	   écritures de résultats ferait échouer un export parfaitement valide. */
	async function creerDossiers(path: string): Promise<void> {
		try {
			await mkdir(abs(path), { recursive: true });
		} catch (e) {
			if (!(await exists(abs(path)))) throw e;
		}
	}

	return {
		async read(path) {
			return await readTextFile(abs(path));
		},
		/* PAS de cache : `readCached` renvoie `read`. Obsidian en a un parce
		   qu'il tient déjà le contenu de ses notes en mémoire ; ici il faudrait
		   l'inventer, avec son invalidation et ses fuites, pour un besoin que
		   personne n'a mesuré. Le contrat prévoit explicitement ce cas. */
		async readCached(path) {
			return await readTextFile(abs(path));
		},
		async write(path, data) {
			await writeTextFile(abs(path), data);
			await recaler(path);
		},
		/* Lecture puis écriture, et le contrat le dit : un processus unique
		   sans autre écrivain que lui-même. Ce n'est PAS équivalent au
		   `vault.process` d'Obsidian, et c'est pourquoi le contrat ne promet
		   l'indivisibilité qu'à l'intérieur de la fenêtre. */
		async process(path, mutate) {
			const p = abs(path);
			await writeTextFile(p, mutate(await readTextFile(p)));
			await recaler(path);
		},
		/* `writeFile` et non `writeTextFile` : ce dernier encode la chaîne qu'on
		   lui donne, et une image passée par là sortirait corrompue sans qu'aucune
		   erreur ne le dise.

		   RIEN À RETAILLER ici, contrairement à l'hôte Obsidian dont l'API prend
		   un `ArrayBuffer`, qui n'a pas d'offset : la VUE arrive entière jusqu'au
		   Rust. RELEVÉ, pas supposé, dans `tauri-2.11.5/scripts/` —
		   `process-ipc-message-fn.js` reconnaît `ArrayBuffer.isView` et passe la
		   vue TELLE QUELLE, que `ipc-protocol.js` pose en `body` d'un `fetch`
		   (un `BufferSource` n'y rend que ses propres octets) ; et sur le repli
		   `postMessage`, `Array.from(val)` itère la vue, pas son tampon. */
		async writeBinary(path, data) {
			await writeFile(abs(path), data);
			await recaler(path);
		},
		/* `<racine>/.trash/<chemin local>` : le point de tête suffit à
		   l'exclure du parcours du catalogue (`dossierIgnore`) comme du côté
		   Obsidian (`estCache`), donc un quiz mis à la corbeille disparaît du
		   tableau de bord sans qu'aucun filtre neuf n'ait à le savoir. */
		async trash(path) {
			const racine = carte.pour(path);
			if (!racine) throw new Error(`chemin hors des dossiers ouverts : ${path}`);
			/* Par `carte`, jamais à la main : c'est le SEUL endroit qui convertit
			   entre chemin du contrat et chemin local, et un préfixe recomposé
			   ici diverge en silence (passation de la tranche 2). */
			const vise = carte.contrat(racine.id, `.trash/${carte.local(path)}`);
			const { base, ext } = couperExtension(vise);
			/* Un nom LIBRE : supprimer deux fois une note du même nom (recréée
			   entre les deux) écraserait la première dans la corbeille, et la
			   corbeille est justement l'endroit où rien ne doit disparaître.
			   `cheminLibre` et non `reserveFreePath` : rien à réserver ici. Une
			   source n'a qu'UNE cible de corbeille, deux `trash` du même chemin
			   ne peuvent pas réussir tous les deux (le second ne trouve plus sa
			   source), et un `rename` qui échoue brûlerait sinon le nom pour
			   toute la session — c'est pourquoi les trois sites du dépôt qui
			   réservent vraiment appairent `releaseReservedPath` dans leur
			   `catch`. Sans réservation, rien à appairer. */
			const cible = await cheminLibre(existe, base, ext);
			const barre = cible.lastIndexOf("/");
			if (barre > 0) await creerDossiers(cible.slice(0, barre));
			await renameFichier(abs(path), abs(cible));
		},
		exists: existe,
		mkdirs: creerDossiers,
		/* `append: true` de plugin-fs, PAS une lecture suivie d'une
		   réécriture : c'est l'atomicité de l'ajout qui protège le journal
		   d'une fermeture au mauvais moment. */
		async append(path, data) {
			await writeTextFile(abs(path), data, { append: true });
			await recaler(path);
		},
		async list(dir) {
			try {
				const entrees = await readDir(abs(dir));
				return entrees
					.filter(e => e.isFile)
					.map(e => (dir ? `${normaliser(dir)}/${e.name}` : e.name));
			} catch (e) {
				// Dossier absent : le contrat demande `[]`, pas une exception.
				return [];
			}
		},
		async remove(path) {
			try {
				await removeFichier(abs(path));
			} catch (e) {
				if (await exists(abs(path))) throw e;
			}
		},
		/* Pas d'écrasement : `rename` de plugin-fs remplace la destination en
		   silence sur Windows, et la migration du journal s'appuie sur le
		   contraire — écraser un `review-log.jsonl.migrated` déjà là
		   détruirait la sauvegarde qu'on venait de créer. */
		async rename(from, to) {
			if (await exists(abs(to))) throw new Error(`${to} existe déjà`);
			await renameFichier(abs(from), abs(to));
		},
		listMarkdown() {
			return index.all().filter(f => f.extension === "md");
		},
		/* TOUS les homonymes, casse ignorée : l'appelant (`engine/resources.ts`)
		   prévient l'utilisateur quand il y en a plusieurs. N'en rendre qu'un
		   ferait disparaître l'avertissement sans que rien ne le signale. */
		findByName(name) {
			const cible = String(name ?? "").trim().toLowerCase();
			if (!cible) return [];
			return index.all().filter(f => f.name.toLowerCase() === cible);
		},
		getFile(path) {
			return index.get(path);
		},
	};
}

/* ─────────── le surveillant ─────────── */

/** Vrai si `path` est un sous-dossier STRICT de `autre` (comparaison
    insensible à la casse, comme partout ailleurs dans ce fichier). */
function estSousDossierDe(path: string, autre: string): boolean {
	const a = normaliser(path).toLowerCase();
	const b = normaliser(autre).toLowerCase();
	return a !== b && a.startsWith(b + "/");
}

/**
 * Surveille TOUTES les racines ouvertes et tient l'index à jour.
 *
 * `watch` (débouncé) et non `watchImmediate` : un éditeur écrit souvent une
 * note en plusieurs passes (fichier temporaire, remplacement, métadonnées), et
 * la version immédiate ferait alors trois `stat` et trois notifications pour
 * une seule sauvegarde. Le délai est le prix d'une seule notification juste.
 *
 * UN `watch` PAR RACINE — SAUF une racine CONTENUE dans une autre déjà
 * ouverte. `depuisAbsolu` traite exprès ce cas (« la racine la plus longue
 * gagne », `roots.ts`), donc DEUX racines peuvent partager un sous-arbre
 * disque (un dossier ouvert à l'intérieur d'un autre). `watch(..., {
 * recursive: true })` couvre déjà tout le sous-arbre de la racine
 * englobante : ouvrir un second surveillant sur la racine imbriquée ferait
 * réconcilier CHAQUE évènement de ce sous-arbre DEUX FOIS (une fois par
 * surveillant), sans jamais se tromper de racine pour autant — `depuisAbsolu`
 * retrouve toujours la bonne, quel que soit le surveillant qui a réagi — mais
 * en dépensant le double de travail, et en risquant d'émettre deux lignes de
 * renommage de dossier pour un seul renommage. Cette racine reste malgré tout
 * PLEINEMENT fonctionnelle : ses fichiers sont indexés à l'ouverture par
 * `createWindowsIndex` comme n'importe quelle autre, seul son PROPRE
 * surveillant redondant est sauté ici.
 *
 * LIMITE MESURÉE, pas un oubli : plugin-fs signale un renommage par
 * `modify: { kind: "rename", mode: "from" | "to" | "both" }`. Seul `both`
 * porte les deux chemins d'un coup et permet d'émettre un vrai `rename` ;
 * quand le système n'envoie que `from` puis `to`, rien ne relie les deux
 * évènements et on émet `delete` puis `create` plutôt que d'inventer un
 * appariement faux. Le journal de révision perdra la clé dans ce cas — c'est
 * la tranche 2, qui le branchera, qui décidera quoi en faire.
 */
export function createWindowsWatcher(carte: CarteRacines, index: WindowsIndex): HostWatcher {
	const abonnes = new Set<(ev: HostFileEvent) => void>();
	const abonnesDossier = new Set<(ev: { from: string; to: string }) => void>();

	/* L'INDEX D'ABORD, les abonnés ensuite. L'ordre compte : un abonné qui
	   interroge l'index pendant sa notification doit y voir le changement,
	   sinon il redessine une liste d'où le fichier vient de disparaître. */
	const diffuser = (ev: HostFileEvent): void => {
		index.apply(ev);
		for (const cb of [...abonnes]) {
			try {
				cb(ev);
			} catch (e) {
				console.warn(LOG_PREFIX, "surveillant: rappel en erreur:", e);
			}
		}
	};

	/** Un chemin absolu, remis en état par ce qu'en dit le disque. */
	async function reconcilier(absolu: string): Promise<void> {
		const rel = carte.depuisAbsolu(absolu);
		if (rel === null) return;
		// Un chemin qui se réduit à la racine n'est pas un fichier, et un chemin
		// qui traverse un dossier ignoré n'a rien à faire au catalogue. Le MÊME
		// prédicat que la branche des renommages ci-dessous : deux copies de
		// cette règle avaient déjà divergé une fois.
		if (horsCatalogue(rel)) return;

		let info = null;
		try {
			info = await stat(absolu);
		} catch (e) {
			info = null;
		}
		if (!info) {
			// Disparu. La garde évite d'annoncer la suppression d'un fichier qui
			// n'a jamais été au catalogue (un `.tmp` d'éditeur, par exemple).
			if (index.get(rel)) diffuser({ kind: "delete", path: rel });
			return;
		}
		if (info.isDirectory) return;
		const file = toHostFile(rel, info.mtime ? info.mtime.getTime() : 0);
		diffuser(index.get(rel) ? { kind: "modify", file } : { kind: "create", file });
	}

	async function traiter(ev: WatchEvent): Promise<void> {
		const type = ev.type;
		if (typeof type === "object" && "access" in type) return; // une lecture ne change rien
		if (
			typeof type === "object" && "modify" in type &&
			type.modify.kind === "rename" && type.modify.mode === "both" &&
			ev.paths.length === 2
		) {
			const avant = carte.depuisAbsolu(ev.paths[0]);
			const apres = carte.depuisAbsolu(ev.paths[1]);
			if (avant && apres) {
				let mtime = 0;
				try {
					const info = await stat(ev.paths[1]);
					if (info.isDirectory) {
						/* Un DOSSIER renommé. Le journal de révision déplace ses
						   clés par préfixe : une seule ligne suffit, et sans elle
						   toutes les notes du dossier perdraient leur historique
						   d'un coup.
						   L'index, lui, N'EST PAS recalé ici : ce bloc ne touche
						   qu'au journal. Ce que `ReadDirectoryChangesW` (via
						   plugin-fs) remonte ensuite pour les FICHIERS du dossier
						   déplacé n'est pas mesuré dans cette tâche (pas
						   d'affichage disponible pour l'éprouver) — l'index peut
						   donc garder des chemins PÉRIMÉS pour ces fichiers tant
						   que rien ne les recale. C'est une LIMITE non mesurée,
						   pas une garantie ; la tâche 9 (l'appariement des
						   renommages) la traite sur preuve. */
						for (const cb of [...abonnesDossier]) {
							try { cb({ from: avant, to: apres }); } catch (e) { console.warn(LOG_PREFIX, "onRenameDir: rappel en erreur:", e); }
						}
						return;
					}
					mtime = info.mtime ? info.mtime.getTime() : 0;
				} catch (e) {
					// Déjà reparti : on retombe sur la réconciliation ci-dessous.
					await reconcilier(ev.paths[0]);
					await reconcilier(ev.paths[1]);
					return;
				}
				/* PAS un `diffuser` direct : un renommage vers un dossier ignoré
				   (`HostFs.trash`, qui déplace vers `<racine>/.trash/…`) doit
				   arriver au catalogue comme une SUPPRESSION, et le retour d'un
				   dossier ignoré comme une CRÉATION. Sans cette traduction, la
				   note mise à la corbeille restait dans « Mes quiz » jusqu'au
				   redémarrage, sous son chemin de corbeille. */
				const pourCatalogue = evenementDeRenommage(avant, apres, toHostFile(apres, mtime));
				if (pourCatalogue) diffuser(pourCatalogue);
				return;
			}
		}
		for (const p of ev.paths) await reconcilier(p);
	}

	/* Le surveillant démarre TOUT DE SUITE, pas au premier abonnement, et ne
	   s'arrête jamais : l'index doit rester juste même quand personne n'écoute,
	   sinon la première vue montée après une modification afficherait un
	   catalogue périmé. Il vit aussi longtemps que la fenêtre — UNE surveillance
	   par racine, une racine illisible (droits, disque retiré) ne doit pas
	   empêcher les autres d'être suivies — SAUF une racine contenue dans une
	   autre déjà ouverte, dont le sous-arbre est déjà couvert (voir ci-dessus). */
	const toutes = carte.toutes();
	for (const racine of toutes) {
		if (toutes.some(autre => autre !== racine && estSousDossierDe(racine.path, autre.path))) continue;
		void watch(racine.path, ev => void traiter(ev), { recursive: true, delayMs: 300 })
			.catch(e => console.warn(LOG_PREFIX, "surveillance impossible:", racine.name, e));
	}

	return {
		onChange(cb) {
			abonnes.add(cb);
			return () => {
				abonnes.delete(cb);
			};
		},
		/* Quand le système n'envoie PAS `both`, aucun rappel n'est appelé :
		   l'hôte n'invente pas d'appariement. C'est la tâche 9 qui traite ce
		   cas, au niveau du catalogue et sur une PREUVE. */
		onRenameDir(cb) {
			abonnesDossier.add(cb);
			return () => { abonnesDossier.delete(cb); };
		},
	};
}
