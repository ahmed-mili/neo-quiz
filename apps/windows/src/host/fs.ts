/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — SYSTÈME DE FICHIERS, MIROIR DE L'INDEX, SURVEILLANCE

   Obsidian tient son propre index du vault ; un dossier nu n'en a pas. Ce
   module en tient un MIROIR en mémoire pour que `listMarkdown`, `findByName`
   et `getFile` restent SYNCHRONES — le scanner et le sanitizer les appellent
   en plein rendu, où une promesse obligerait à rendre tout le rendu
   asynchrone. Or, depuis la tâche 4 de la migration Tauri → Electron, TOUT ce
   qui touche le disque traverse l'IPC (`window.neo`, le pont typé de
   `apps/windows/electron/pont.ts`), et l'IPC est asynchrone par construction :
   aucune méthode du pont ne peut servir ces trois-là.

   D'OÙ LE MIROIR, ET COMMENT IL RESTE JUSTE. Le processus principal garde
   l'index d'AUTORITÉ (il a le surveillant et fait les écritures) ; le rendu
   tient une copie, alimentée par trois voies et seulement trois :
     1. l'HYDRATATION au démarrage — `neo.fichiers.liste(racine)`, un parcours
        du disque par racine (`createWindowsIndex`) ;
     2. les ÉVÉNEMENTS que le principal POUSSE — `neo.surveiller`, débouncés
        de 300 ms là-bas ;
     3. le `mtime` que CHAQUE ÉCRITURE du pont REND — appliqué au miroir avant
        que l'écriture ne résolve. C'est ce qui tient « LA FRAÎCHEUR APRÈS
        UNE ÉCRITURE » (`src/host/types.ts`) sans attendre le surveillant :
        sans cette voie, `detail-io.ts` relisait un `mtime` d'AVANT sa propre
        sauvegarde et affichait une Notice « modifié dehors » mensongère.
   L'ordre entre 1 et 2 compte : ON S'ABONNE AVANT D'HYDRATER. Un changement
   survenu entre les deux est alors soit déjà dans le parcours, soit reçu par
   l'abonné ; dans l'ordre inverse il serait perdu jusqu'au suivant.

   Ce n'est pas une architecture neuve : `buildIndex` et `apply` vivaient déjà
   ici sous Tauri. Seule la SOURCE des données a changé de côté.

   RÈGLE QUI GOUVERNE CE FICHIER : les chemins du contrat sont ceux de
   `CarteRacines` (`./roots.ts`) — un premier segment qui nomme la racine,
   puis un chemin `/` relatif à elle — jamais des chemins absolus. La
   conversion chemin du contrat ↔ chemin absolu disque vit dans `roots.ts` et
   NULLE PART ailleurs : ce fichier ne fait que la CONSOMMER (`carte.absolu`,
   `carte.depuisAbsolu`), jamais la recomposer à la main. Le pont, lui, ne
   parle QUE d'absolu (voir `pont.ts`) : chaque chemin est traduit ici, à la
   frontière, dans les deux sens. Un chemin absolu qui fuirait dans le code
   partagé casserait les clés du journal de révision, qui doivent être
   identiques sous les trois hôtes.

   CE QUE CE FICHIER NE FAIT JAMAIS : importer un module qui tire Node. Il
   tourne dans la fenêtre, avec `contextIsolation` et sans `nodeIntegration` ;
   `catalogue.ts` a été écrit sans import Node exprès pour être importable
   d'ici, et `pont.ts` n'est importé qu'en TYPE. `index-fichiers.ts` et
   `fichiers.ts`, qui tirent `node:fs`, restent de l'autre côté.
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../../../../src/branding";
import type { HostFile, HostFileEvent, HostFs, HostWatcher } from "../../../../src/host/types";
import type { CarteRacines } from "./roots";
import { pont } from "./pont";
import type { EvenementDisque } from "../../electron/pont";
/* `horsCatalogue` et `evenementDeRenommage` vivent dans
   `apps/windows/electron/catalogue.ts` : un module SANS AUCUNE dépendance
   Node, que le processus principal (tâche 2) et ce fichier de rendu partagent
   — voir l'en-tête de `catalogue.ts` pour le POURQUOI. Réexportées plus bas
   pour les dix-sept cas de `check-windows-host.mjs` (groupe « index »), qui
   les importent depuis CE fichier. */
import { evenementDeRenommage, horsCatalogue } from "../../electron/catalogue";

/** L'index en mémoire du dossier. Volontairement minuscule : c'est ce qui le
    rend éprouvable hors de la fenêtre (`npm run check:windows-host`). */
export interface WindowsIndex {
	all(): HostFile[];
	get(path: string): HostFile | null;
	apply(ev: HostFileEvent): void;
}

/**
 * Le MIROIR : l'index, plus les abonnés que le surveillant du principal
 * alimente. `createWindowsIndex` le construit (il s'abonne PUIS hydrate,
 * dans cet ordre — voir l'en-tête) ; `createWindowsWatcher` ne fait que
 * présenter ses abonnements sous la forme du contrat `HostWatcher`. Les deux
 * ne sont pas fusionnés : `createWindowsFs` et les liens ne veulent qu'un
 * `WindowsIndex`, et un faux index à trois méthodes leur suffit dans les
 * contrôles.
 */
export interface MiroirDisque extends WindowsIndex {
	onChange(cb: (ev: HostFileEvent) => void): () => void;
	onRenameDir(cb: (ev: { from: string; to: string }) => void): () => void;
}

/* ─────────── chemins ─────────── */

/** Sépare avec des `/` et retire le séparateur final. Windows accepte les deux
    séparateurs en lecture ; le contrat, lui, n'en accepte qu'un. */
function normaliser(chemin: string): string {
	return String(chemin ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
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
 * L'index à partir d'une liste de fichiers. PUR : aucun appel au pont, aucun
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

/* ─────────── le miroir : abonnement, puis hydratation ─────────── */

/* `horsCatalogue` et `evenementDeRenommage` : voir l'import en tête de
   fichier. Réexportées pour les dix-sept cas de `check-windows-host.mjs`
   (groupe « index »). `evenementDeRenommage` n'a plus d'appelant ICI depuis
   que le pont n'émet pas de `rename` (chokidar remonte `unlink` puis `add`) :
   elle reste la règle du catalogue, éprouvée, et l'appariement d'un
   renommage vit côté application dans `createRenameDetector`. */
export { evenementDeRenommage, horsCatalogue };

/**
 * Traduit un événement du DISQUE (chemin absolu, poussé par le principal) en
 * événement du CONTRAT, ou `null` s'il ne concerne pas le catalogue.
 *
 * `depuisAbsolu` est la SEULE conversion (voir l'en-tête) ; `horsCatalogue`
 * est le MÊME prédicat que le parcours de l'hydratation — le principal
 * filtre déjà avec lui, mais deux copies d'une règle avaient divergé une
 * fois ici (un quiz mis à la corbeille rentrait au catalogue sous son chemin
 * de corbeille), et une garde qui coûte une ligne vaut mieux qu'une confiance.
 * La garde sur `delete` évite d'annoncer la disparition d'un fichier que le
 * catalogue n'a jamais connu (un `.tmp` d'éditeur).
 */
function versContrat(carte: CarteRacines, index: WindowsIndex, ev: EvenementDisque): HostFileEvent | null {
	const rel = carte.depuisAbsolu(ev.abs);
	if (rel === null || horsCatalogue(rel)) return null;
	if (ev.kind === "delete") return index.get(rel) ? { kind: "delete", path: rel } : null;
	const file = toHostFile(rel, ev.mtime);
	return index.get(rel) ? { kind: "modify", file } : { kind: "create", file };
}

/**
 * Construit le MIROIR de toutes les racines ouvertes : déclare les racines au
 * principal (`demarrer`), S'ABONNE à son surveillant, PUIS hydrate par un
 * parcours de chaque racine. Dans cet ordre, et c'est écrit dans `pont.ts` :
 * un changement survenu pendant le parcours est reçu par l'abonné, alors que
 * l'ordre inverse le perdrait jusqu'au suivant.
 *
 * L'hydratation n'ÉCRASE PAS une entrée que l'abonné a déjà posée : un
 * événement reçu pendant le parcours porte le `mtime` d'un changement survenu
 * APRÈS l'abonnement, et le parcours a pu dater ce fichier avant. Un fichier
 * supprimé PENDANT le parcours, lui, peut rester listé (le `readdir` l'a vu,
 * le `unlink` a suivi, et sa suppression n'a rien à retirer d'un miroir
 * encore vide) : c'est une fenêtre de quelques centaines de millisecondes au
 * démarrage, la même que l'hôte Tauri avait, et le prochain événement sur ce
 * chemin la referme.
 *
 * `mtime` n'est relevé par le principal que sur les `.md` (`parcours.ts`) :
 * seul le catalogue de quiz s'en sert (tri « récents »). Les autres fichiers
 * gardent 0, ce que le contrat autorise.
 *
 * Une racine que le principal REFUSE (hors périmètre — elle n'y entre que par
 * les réglages, le sélecteur ou les vaults d'Obsidian, jamais par cet
 * argument) fait rejeter `liste` : on le SIGNALE et on continue, comme un
 * sous-dossier illisible ne vide pas l'index entier. Le surveillant, lui,
 * l'ignore déjà de son côté.
 */
export async function createWindowsIndex(carte: CarteRacines): Promise<MiroirDisque> {
	const neo = pont();
	const index = buildIndex([]);
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

	const racines = carte.toutes();
	await neo.demarrer(racines.map(r => r.path));
	/* Jamais désabonné : le miroir doit rester juste tant que la fenêtre vit,
	   même quand personne n'écoute, sinon la première vue montée après une
	   modification afficherait un catalogue périmé. Le désabonnement rendu
	   par `surveiller` ne servirait qu'à un rechargement, qui repart de zéro. */
	await neo.surveiller(ev => {
		const traduit = versContrat(carte, index, ev);
		if (traduit) diffuser(traduit);
	});

	for (const racine of racines) {
		let entrees;
		try {
			entrees = await neo.fichiers.liste(racine.path);
		} catch (e) {
			console.warn(LOG_PREFIX, "parcours de la racine impossible:", racine.name, e);
			continue;
		}
		for (const entree of entrees) {
			const rel = carte.depuisAbsolu(entree.chemin);
			if (rel === null || horsCatalogue(rel) || index.get(rel)) continue;
			index.apply({ kind: "create", file: toHostFile(rel, entree.mtime) });
		}
	}

	return {
		all: index.all,
		get: index.get,
		apply: index.apply,
		onChange(cb) {
			abonnes.add(cb);
			return () => {
				abonnes.delete(cb);
			};
		},
		/* JAMAIS appelé à cette tranche, et ce n'est pas un oubli : le pont
		   n'émet pas de renommage (chokidar remonte `unlink` puis `add`, sans
		   les apparier), et le contrat dit ce qu'un hôte fait alors — « il ne
		   DEVINE pas ». L'appariement d'un renommage de FICHIER vit côté
		   application (`createRenameDetector`) ; celui d'un DOSSIER n'a pas de
		   voie ici, ce que l'hôte Tauri ne tenait déjà que quand le système
		   envoyait la paire (`mode: "both"`). */
		onRenameDir(cb) {
			abonnesDossier.add(cb);
			return () => { abonnesDossier.delete(cb); };
		},
	};
}

/* ─────────── le contrat HostFs ─────────── */

/** Combien de fois `process` REJOUE son rappel quand l'écriture est refusée
    parce que le fichier a changé entre la lecture et l'écriture. Dix, c'est
    déjà un fichier qu'un autre programme réécrit en continu ; sans borne, une
    telle boucle ne rendrait jamais la main et rien ne le dirait. */
const REJEUX_PROCESS = 10;

export function createWindowsFs(carte: CarteRacines, index: WindowsIndex): HostFs {
	const abs = (chemin: string): string => {
		const a = carte.absolu(chemin);
		/* Un chemin hors racines ne doit pas devenir un chemin absolu
		   plausible : le principal le refuserait de toute façon, mais avec un
		   message qui parlerait du disque et non de la racine manquante. Mieux
		   vaut nommer la cause ici. */
		if (!a) throw new Error(`chemin hors des dossiers ouverts : ${chemin}`);
		return a;
	};

	/**
	 * RECALE LE MIROIR avec le `mtime` que l'écriture vient de RENDRE.
	 *
	 * Appelée après chaque écriture réussie, et c'est la promesse du contrat
	 * (`src/host/types.ts`, « LA FRAÎCHEUR APRÈS UNE ÉCRITURE ») : au retour
	 * de `write`, `process`, `writeBinary` ou `append`, `getFile` doit rendre
	 * le `mtime` NEUF. Le pont rend ce `mtime` à chaque écriture précisément
	 * pour ça (voir « LES QUATRE ÉCRITURES RENDENT LE `mtime` NEUF » dans
	 * `pont.ts`) : aucun `stat` de plus, aucune attente du surveillant.
	 *
	 * Le MÊME prédicat de catalogue que le surveillant (`horsCatalogue`) : le
	 * journal de révision (`<racine>/.neo-quiz/…`) et les résultats exportés
	 * n'ont rien à faire à l'index, et les y faire entrer par cette porte
	 * rouvrirait exactement la divergence que `horsCatalogue` a été extraite
	 * pour fermer.
	 *
	 * Un `mtime` à 0 veut dire que le `stat` du principal a échoué APRÈS une
	 * écriture réussie (`canaux.ts`, `fraicheur`) : on le SIGNALE — c'est la
	 * seule fenêtre où la promesse peut ne pas être tenue — et le surveillant
	 * recalera.
	 */
	function recaler(path: string, mtime: number): void {
		if (horsCatalogue(path)) return;
		if (!mtime) console.warn(LOG_PREFIX, "mtime inconnu après écriture:", path);
		const file = toHostFile(path, mtime);
		// `create` ou `modify` : `buildIndex.apply` les traite pareil, mais
		// le nom doit rester juste — le surveillant émettra le même plus tard.
		index.apply(index.get(path) ? { kind: "modify", file } : { kind: "create", file });
	}

	return {
		async read(path) {
			return await pont().fichiers.read(abs(path));
		},
		/* PAS de cache : le principal n'en a pas non plus (`fichiers.ts`), et
		   le contrat prévoit explicitement ce cas. */
		async readCached(path) {
			return await pont().fichiers.readCached(abs(path));
		},
		async write(path, data) {
			const { mtime } = await pont().fichiers.write(abs(path), data);
			recaler(path, mtime);
		},
		/* EN DEUX TEMPS, parce qu'un rappel ne traverse pas l'IPC (voir
		   « `process`, EN DEUX TEMPS » dans `pont.ts`) : on lit, on applique le
		   rappel, on demande une écriture CONDITIONNÉE au contenu lu. Refusée
		   (`null`) parce que le fichier a changé entre-temps, on relit et on
		   REJOUE — c'est ce que le contrat autorise (« la DERNIÈRE invocation
		   fait foi ») et ce dont `detail-io.ts` dépend déjà. La comparaison se
		   fait sur le CONTENU, côté principal. Ce n'est PAS équivalent au
		   `vault.process` d'Obsidian face à un éditeur EXTÉRIEUR, et le contrat
		   le dit ; mais c'est plus que ce que l'hôte Tauri tenait, qui lisait
		   puis écrivait sans rien comparer. */
		async process(path, mutate) {
			const p = abs(path);
			const fichiers = pont().fichiers;
			for (let essai = 0; essai < REJEUX_PROCESS; essai++) {
				const { contenu } = await fichiers.lirePourEcriture(p);
				const resultat = await fichiers.ecrireSiInchange(p, contenu, mutate(contenu));
				if (resultat) {
					recaler(path, resultat.mtime);
					return;
				}
			}
			throw new Error(`process : le fichier change sans cesse, écriture abandonnée : ${path}`);
		},
		/* La VUE arrive entière au principal : le préchargement la RECOPIE
		   (`new Uint8Array(data)`) avant l'IPC, donc un `Uint8Array` posé sur un
		   tampon plus grand que lui n'emporte que ses propres octets — c'est le
		   défaut que `fichiers.ts` documente pour `writeBinary`, et le cas
		   « n'écrit que les octets de la vue » de `check-windows-host.mjs`. */
		async writeBinary(path, data) {
			const { mtime } = await pont().fichiers.writeBinary(abs(path), data);
			recaler(path, mtime);
		},
		/* `<racine>/.trash/<chemin local>`, composé et numéroté par le PRINCIPAL
		   (`fichiers.ts`) : le rendu ne lui passe que le fichier et SA racine —
		   par `carte`, jamais à la main, c'est le SEUL endroit qui sait de quelle
		   racine relève un chemin du contrat. Le point de tête de `.trash` suffit
		   à l'exclure du catalogue (`dossierIgnore`) des deux côtés.
		   Le miroir n'est PAS touché ici : le surveillant remonte la disparition
		   (`unlink`), et c'est par lui que le scanner l'apprend. La retirer du
		   miroir avant ferait tomber la garde de `versContrat` (« un fichier que
		   le catalogue n'a jamais connu ») sur ce même événement, et le scanner
		   garderait un quiz fantôme. */
		async trash(path) {
			const racine = carte.pour(path);
			if (!racine) throw new Error(`chemin hors des dossiers ouverts : ${path}`);
			await pont().fichiers.trash(abs(path), normaliser(racine.path));
		},
		async exists(path) {
			return await pont().fichiers.exists(abs(path));
		},
		/* Le principal crée le dossier ET ses parents, et ne rejette pas s'il
		   existe déjà (`fichiers.ts`, éprouvé par `check:electron-fs`). */
		async mkdirs(path) {
			await pont().fichiers.mkdirs(abs(path));
		},
		/* Un VRAI ajout côté principal (`appendFile`), pas une lecture suivie
		   d'une réécriture : c'est l'atomicité de l'ajout qui protège le journal
		   d'une fermeture au mauvais moment. */
		async append(path, data) {
			const { mtime } = await pont().fichiers.append(abs(path), data);
			recaler(path, mtime);
		},
		/* Le pont rend des chemins ABSOLUS (normalisés en `/`) ; le contrat veut
		   des chemins du CONTRAT : `depuisAbsolu`, la seule conversion. Un
		   dossier absent rend `[]` côté principal — pas une exception. */
		async list(dir) {
			const entrees = await pont().fichiers.list(abs(dir));
			return entrees
				.map(a => carte.depuisAbsolu(a))
				.filter((c): c is string => c !== null);
		},
		async remove(path) {
			await pont().fichiers.remove(abs(path));
		},
		/* Pas d'écrasement : c'est le PRINCIPAL qui rejette si la destination
		   existe (`fichiers.ts`, « rename REJETTE si la destination existe »),
		   et la migration du journal s'appuie sur ce refus — écraser un
		   `review-log.jsonl.migrated` déjà là détruirait la sauvegarde qu'on
		   venait de créer. */
		async rename(from, to) {
			await pont().fichiers.rename(abs(from), abs(to));
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
 * Le contrat `HostWatcher`, posé sur le miroir. Il ne surveille rien
 * lui-même : l'abonnement au principal est pris par `createWindowsIndex`,
 * AVANT l'hydratation (voir l'en-tête), et le miroir tient les abonnés.
 */
export function createWindowsWatcher(miroir: MiroirDisque): HostWatcher {
	return {
		onChange: miroir.onChange,
		onRenameDir: miroir.onRenameDir,
	};
}
