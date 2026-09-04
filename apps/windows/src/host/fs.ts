/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — SYSTÈME DE FICHIERS, INDEX, SURVEILLANCE

   Obsidian tient son propre index du vault ; un dossier nu n'en a pas. Ce
   module le construit au démarrage et le maintient par le surveillant, pour
   que `listMarkdown`, `findByName` et `getFile` restent SYNCHRONES — le
   scanner et le sanitizer les appellent en plein rendu, où une promesse
   obligerait à rendre tout le rendu asynchrone.

   RÈGLE QUI GOUVERNE CE FICHIER : les chemins du contrat sont RELATIFS à la
   racine du dossier, séparateurs `/`, jamais absolus. La conversion
   relatif ↔ absolu vit ICI et nulle part ailleurs. Un chemin absolu qui
   fuirait dans le code partagé casserait les clés du journal de révision, qui
   doivent être identiques sous les trois hôtes — et le défaut ne se verrait
   qu'à la tranche 2, quand l'historique de révision ne se retrouverait plus.
══════════════════════════════════════════════════════════ */

import { exists, mkdir, readDir, readTextFile, stat, watch, writeTextFile } from "@tauri-apps/plugin-fs";
import type { WatchEvent } from "@tauri-apps/plugin-fs";
import { LOG_PREFIX } from "../../../../src/branding";
import type { HostFile, HostFileEvent, HostFs, HostWatcher } from "../../../../src/host/types";

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

/** Le chemin ABSOLU d'un chemin du contrat. Seule sortie autorisée d'un chemin
    absolu hors de ce module : `links.ts` s'en sert pour `convertFileSrc`. */
export function cheminAbsolu(racine: string, relatif: string): string {
	const rel = normaliser(relatif).replace(/^\/+/, "");
	const base = normaliser(racine);
	return rel ? `${base}/${rel}` : base;
}

/** Le chemin du contrat d'un chemin absolu, ou `null` s'il est HORS de la
    racine. La comparaison ignore la casse : Windows la ignore aussi, et un
    surveillant qui rendrait « C:\\Users… » là où la racine dit « c:\\users… »
    ferait tomber tous les évènements dans le vide, sans un mot. */
export function cheminRelatif(racine: string, absolu: string): string | null {
	const base = normaliser(racine);
	const abs = normaliser(absolu);
	if (abs.toLowerCase() === base.toLowerCase()) return "";
	if (!abs.toLowerCase().startsWith(base.toLowerCase() + "/")) return null;
	return abs.slice(base.length + 1);
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
 * `.obsidian` et `.neo-quiz` (les résultats, cf. `paths.resultsDir`) tombent
 * sous la même règle ; ils restent LISIBLES par chemin, ils ne sont
 * simplement pas au catalogue.
 */
function dossierIgnore(nom: string): boolean {
	return nom.startsWith(".") || nom === "node_modules";
}

/** Concurrence des `stat` du démarrage : un aller-retour IPC par fichier, donc
    on en tient plusieurs en vol sans pour autant en lancer mille d'un coup. */
const LOTS_STAT = 24;

async function parcourir(racine: string, relatif: string, sortie: string[]): Promise<void> {
	let entrees;
	try {
		// Pas de `baseDir` : la racine est un chemin ABSOLU choisi par
		// l'utilisateur, pas un dossier standard de l'application.
		entrees = await readDir(cheminAbsolu(racine, relatif));
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
 * Construit l'index du dossier.
 *
 * `DirEntry` ne porte AUCUN chemin (Tauri 2) et `readDir` n'a pas d'option
 * récursive : les chemins sont composés en descendant, la récursion est à
 * notre charge.
 *
 * `stat` n'est appelé que sur les `.md`. C'est un aller-retour IPC par
 * fichier, et seul le catalogue de quiz se sert de `mtime` (tri « récents »,
 * `dashboard/quiz-recent.ts`) : le payer pour chaque image d'un dossier de
 * cours serait une dépense sans acheteur. Les autres fichiers gardent
 * `mtime: 0`, ce que le contrat autorise.
 */
export async function createWindowsIndex(racine: string): Promise<WindowsIndex> {
	const chemins: string[] = [];
	await parcourir(racine, "", chemins);

	const fichiers: HostFile[] = chemins.map(c => toHostFile(c));
	const aDater = fichiers.filter(f => f.extension === "md");
	for (let i = 0; i < aDater.length; i += LOTS_STAT) {
		await Promise.all(aDater.slice(i, i + LOTS_STAT).map(async f => {
			try {
				const info = await stat(cheminAbsolu(racine, f.path));
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

export function createWindowsFs(racine: string, index: WindowsIndex): HostFs {
	const abs = (chemin: string): string => cheminAbsolu(racine, chemin);

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
		},
		async exists(path) {
			return await exists(abs(path));
		},
		/* `recursive: true` crée le dossier ET ses parents. Le contrat exige de
		   ne pas rejeter quand il existe déjà : on ne re-jette que si le dossier
		   n'est toujours pas là après l'échec — sinon une course entre deux
		   écritures de résultats ferait échouer un export parfaitement valide. */
		async mkdirs(path) {
			try {
				await mkdir(abs(path), { recursive: true });
			} catch (e) {
				if (!(await exists(abs(path)))) throw e;
			}
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

/**
 * Surveille le dossier et tient l'index à jour.
 *
 * `watch` (débouncé) et non `watchImmediate` : un éditeur écrit souvent une
 * note en plusieurs passes (fichier temporaire, remplacement, métadonnées), et
 * la version immédiate ferait alors trois `stat` et trois notifications pour
 * une seule sauvegarde. Le délai est le prix d'une seule notification juste.
 *
 * LIMITE MESURÉE, pas un oubli : plugin-fs signale un renommage par
 * `modify: { kind: "rename", mode: "from" | "to" | "both" }`. Seul `both`
 * porte les deux chemins d'un coup et permet d'émettre un vrai `rename` ;
 * quand le système n'envoie que `from` puis `to`, rien ne relie les deux
 * évènements et on émet `delete` puis `create` plutôt que d'inventer un
 * appariement faux. Le journal de révision perdra la clé dans ce cas — c'est
 * la tranche 2, qui le branchera, qui décidera quoi en faire.
 */
export function createWindowsWatcher(racine: string, index: WindowsIndex): HostWatcher {
	const abonnes = new Set<(ev: HostFileEvent) => void>();

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
		const rel = cheminRelatif(racine, absolu);
		if (rel === null || rel === "") return;
		if (rel.split("/").slice(0, -1).some(dossierIgnore)) return;

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
			const avant = cheminRelatif(racine, ev.paths[0]);
			const apres = cheminRelatif(racine, ev.paths[1]);
			if (avant && apres) {
				let mtime = 0;
				try {
					const info = await stat(ev.paths[1]);
					if (info.isDirectory) return; // un dossier renommé : rien à indexer
					mtime = info.mtime ? info.mtime.getTime() : 0;
				} catch (e) {
					// Déjà reparti : on retombe sur la réconciliation ci-dessous.
					await reconcilier(ev.paths[0]);
					await reconcilier(ev.paths[1]);
					return;
				}
				diffuser({ kind: "rename", file: toHostFile(apres, mtime), oldPath: avant });
				return;
			}
		}
		for (const p of ev.paths) await reconcilier(p);
	}

	/* Le surveillant démarre TOUT DE SUITE, pas au premier abonnement, et ne
	   s'arrête jamais : l'index doit rester juste même quand personne n'écoute,
	   sinon la première vue montée après une modification afficherait un
	   catalogue périmé. Il vit aussi longtemps que la fenêtre. */
	void watch(racine, ev => void traiter(ev), { recursive: true, delayMs: 300 })
		.catch(e => console.warn(LOG_PREFIX, "surveillance du dossier impossible:", e));

	return {
		onChange(cb) {
			abonnes.add(cb);
			return () => {
				abonnes.delete(cb);
			};
		},
	};
}
