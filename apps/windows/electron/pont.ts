/* ══════════════════════════════════════════════════════════
   LE PONT — LE SEUL PASSAGE ENTRE LA FENÊTRE ET LE DISQUE

   Tâche 3 de la migration Tauri → Electron
   (docs/superpowers/plans/2026-09-11-migration-electron.md). Ce module ne
   contient QUE des types et des noms de canaux : il est importé par les trois
   contextes (le processus principal, le préchargement, le rendu), et un seul
   d'entre eux a le droit de toucher Node.

   POURQUOI UN PONT ET PAS `nodeIntegration`. La fenêtre rend du HTML qui n'est
   PAS toujours celui de l'utilisateur : un quiz PARTAGÉ arrive avec les
   `explainHtml` de son auteur (voir `CLAUDE.md`, « Texte et HTML d'un quiz :
   quatre portes »). Avec `nodeIntegration`, une faille du rendu — une porte
   oubliée, une balise que la liste blanche laisse passer — donnerait un accès
   complet à la machine. Le rendu n'obtient donc QUE les méthodes ci-dessous,
   jamais `ipcRenderer` nu : exposer `ipcRenderer` rendrait atteignable
   n'importe quel canal, y compris ceux d'Electron lui-même, et annulerait
   l'isolation qu'on vient de payer.

   RÈGLE DE CHEMINS, et elle n'a qu'une exception. Le pont ne parle que de
   chemins ABSOLUS du disque. Les chemins du CONTRAT (« Efrei/Cours/ch1.md »,
   qui sont les clés du journal de révision) restent l'affaire du rendu, où
   vit `CarteRacines` (`apps/windows/src/host/roots.ts`). C'est délibéré :
   `src/host/types.ts` (`HostPaths.localPath`) avertit qu'un hôte qui
   recomposerait ces clés AILLEURS ferait diverger deux historiques sans que
   personne ne le voie. Un second vocabulaire de chemins traversant l'IPC
   serait exactement ce second endroit. L'index du processus principal
   (`index-fichiers.ts`) porte bien, lui, une convention interne à préfixe
   numérique — elle ne franchit jamais le pont, `main.ts` la retraduit en
   absolu avant d'émettre.

   TOUT EST ASYNCHRONE, sans exception : chaque appel traverse l'IPC. C'est la
   contrainte qui a décidé la forme de `liste()` et de `surveiller()` — voir
   plus bas.

   ET TOUT CHEMIN EST BORNÉ. Un chemin absolu n'est pas un droit : chaque canal
   `fichiers.*` (et `systeme.ouvrir`) REJETTE tout chemin qui ne tombe pas sous
   un dossier du PÉRIMÈTRE (`./perimetre.ts`) — les dossiers retenus dans les
   réglages, ceux que le sélecteur natif a désignés, et les vaults qu'Obsidian
   déclare. JAMAIS le dossier de données de l'application : il porte
   `settings.json`, dont la clé `folders` nourrit ce périmètre au prochain
   démarrage — l'y admettre permettrait de l'écrire en brut. C'est ce que Tauri
   faisait avec `allow_folder` et la portée vide de `plugin-fs` ; sans lui, une
   porte oubliée du sanitizer deviendrait `write("…/Startup/x.bat")`. Le rendu
   ne peut PAS élargir ce périmètre : `demarrer` filtre ses racines contre lui,
   et la clé `folders` des réglages est gardée à l'écriture.
══════════════════════════════════════════════════════════ */

/** Un vault Obsidian connu de la machine (remplace la commande Rust
    `obsidian_vaults`). */
export interface VaultConnu {
	chemin: string;
	nom: string;
}

/** Un fichier trouvé par le parcours d'une racine. `chemin` est ABSOLU. */
export interface EntreeDisque {
	chemin: string;
	/** Date de modification, ms depuis l'époque. `0` quand elle n'a pas été
	    demandée — voir `Pont.fichiers.liste`. */
	mtime: number;
}

/**
 * Un changement observé sur le DISQUE, en chemins absolus.
 *
 * Ce n'est PAS `HostFileEvent` (`src/host/types.ts`), et c'est volontaire :
 * `HostFile.path` est un chemin du CONTRAT, que le processus principal n'a pas
 * le droit de composer (voir l'en-tête). Le rendu traduit ces trois genres en
 * `HostFileEvent` avec `CarteRacines.depuisAbsolu`, comme il le fait déjà
 * aujourd'hui dans `reconcilier`.
 *
 * PAS de `rename` : l'index du processus principal n'en émet pas (chokidar
 * remonte `add`/`change`/`unlink`, jamais une paire appariée). L'appariement
 * d'un renommage vit côté rendu, dans `createRenameDetector`
 * (`src/review/rename-match.ts`), déjà branché côté application — l'inventer
 * ici en ferait une seconde règle d'appariement.
 */
export type EvenementDisque =
	| { kind: "create"; abs: string; mtime: number }
	| { kind: "modify"; abs: string; mtime: number }
	| { kind: "delete"; abs: string };

/**
 * Ce que la fenêtre peut demander au processus principal.
 *
 * Les noms reprennent ceux de `HostFs` (`src/host/types.ts`) partout où c'est
 * la même opération, pour que l'hôte du rendu (tâche 4) soit un passe-plat
 * lisible plutôt qu'un traducteur.
 */
export interface Pont {
	/**
	 * Déclare les racines ouvertes (chemins ABSOLUS), dans l'ordre où le rendu
	 * les tient. Le processus principal y monte son index et son surveillant.
	 *
	 * À appeler AVANT `surveiller()` et `liste()`. Idempotente au sens où un
	 * second appel remplace les racines : le rendu recharge la fenêtre quand
	 * elles changent (`main.ts`, `choisirDossier`), il n'appelle donc jamais
	 * ceci deux fois dans la même vie de page.
	 *
	 * FILTRÉE, pas crue : une racine hors périmètre est IGNORÉE (et nommée dans
	 * la console du principal). Le rendu ne définit jamais ce qu'il a le droit
	 * de lire — voir l'en-tête.
	 */
	demarrer(racines: string[]): Promise<void>;

	fichiers: {
		read(abs: string): Promise<string>;
		/** Pas de cache : le processus principal n'en a pas — voir
		    `fichiers.ts`. Présente pour que l'hôte du rendu ait la méthode que
		    le contrat nomme, sans inventer d'alias. */
		readCached(abs: string): Promise<string>;

		/* ─── LES QUATRE ÉCRITURES RENDENT LE `mtime` NEUF ───

		   `Promise<{ mtime }>` et jamais `Promise<void>` : c'est la seule façon
		   de tenir « LA FRAÎCHEUR APRÈS UNE ÉCRITURE » (`src/host/types.ts`) à
		   travers l'IPC. Le contrat promet qu'au retour de `write`, `process`,
		   `writeBinary` ou `append`, `getFile(path)` rend le `mtime` que
		   l'écriture vient de produire. Or `getFile` est SYNCHRONE et lit le
		   MIROIR du rendu (voir `liste` ci-dessous) : attendre que le
		   surveillant — débouncé de 300 ms — apprenne le changement au rendu
		   rendrait un `mtime` PÉRIMÉ pendant toute cette fenêtre. C'est
		   exactement le défaut mesuré le 2026-09-10 (6000 d'un côté, 1000 de
		   l'autre) qui faisait afficher une Notice « note modifiée dehors »
		   MENSONGÈRE après chaque sauvegarde. Le rendu applique donc ce `mtime`
		   à son miroir AVANT de résoudre l'écriture. */

		write(abs: string, contenu: string): Promise<{ mtime: number }>;
		writeBinary(abs: string, data: Uint8Array): Promise<{ mtime: number }>;
		append(abs: string, contenu: string): Promise<{ mtime: number }>;

		/* ─── `process`, EN DEUX TEMPS ───

		   Le plan de migration décrivait `process(abs, rappelId)`. C'est
		   impossible, et la note qui suivait ce type dans le plan le disait
		   elle-même : LE RAPPEL NE TRAVERSE PAS L'IPC. Il vit dans le rendu (il
		   ferme sur l'état de la page) ; la lecture et l'écriture vivent dans
		   le principal. Un identifiant de rappel ne changerait rien à cela —
		   il faudrait que le principal rappelle le rendu au milieu de son
		   propre appel, et attende sa réponse : une inversion de sens qui
		   rendrait le verrou du principal dépendant d'un rendu qui peut être
		   occupé, figé, ou déjà parti.

		   D'où les deux moitiés ci-dessous. Le rendu lit, applique son rappel,
		   puis demande une écriture CONDITIONNÉE au contenu qu'il a lu. Si le
		   fichier a changé entre les deux, l'écriture est REFUSÉE (`null`) et
		   le rendu REJOUE son rappel sur le contenu neuf. C'est précisément ce
		   que le contrat autorise : « Le rappel peut être REJOUÉ : il doit
		   repartir de zéro à chaque invocation… C'est la DERNIÈRE invocation
		   qui fait foi » (`src/host/types.ts`, `HostFs.process`) — et
		   `detail-io.ts`, son appelant le plus exigeant, en dépend déjà (son
		   drapeau `ecrit` est remis à faux en tête de rappel).

		   La comparaison porte sur le CONTENU et non sur le `mtime` : la
		   granularité d'un `mtime` peut valoir plusieurs millisecondes selon le
		   système de fichiers, et deux écritures rapprochées y seraient
		   indistinguables. */

		/** Le contenu ACTUEL, à passer tel quel à `ecrireSiInchange`. Rejette
		    si le fichier est absent — comme `HostFs.process`. */
		lirePourEcriture(abs: string): Promise<{ contenu: string; mtime: number }>;
		/** Écrit SI le fichier contient toujours `contenuLu`. Rend `null` quand
		    il a changé : l'appelant doit relire et rejouer son rappel. */
		ecrireSiInchange(
			abs: string,
			contenuLu: string,
			contenu: string,
		): Promise<{ mtime: number } | null>;

		exists(abs: string): Promise<boolean>;
		mkdirs(abs: string): Promise<void>;
		/** Déplace vers `<racine>/.trash/…`. `racine` est explicite : le
		    principal ne connaît pas la notion de racines multiples, elle vit
		    dans `CarteRacines` côté rendu. Elle doit ÊTRE une racine du
		    périmètre (pas seulement y tomber), et `abs` doit être sous elle :
		    sinon `path.relative` fabriquerait un `../../…` et le déplacement
		    irait n'importe où. */
		trash(abs: string, racine: string): Promise<void>;
		/** Les FICHIERS d'un dossier, sans descendre. Un dossier absent rend
		    `[]`. */
		list(dossier: string): Promise<string[]>;
		remove(abs: string): Promise<void>;
		/** REJETTE si la destination existe : la migration du journal de
		    révision s'en sert pour ne jamais écraser une sauvegarde. */
		rename(de: string, vers: string): Promise<void>;
		/** Date de modification, ou `null` si absent ou si c'est un dossier.
		    N'est PAS une méthode du contrat `HostFs` — elle sert au rendu à
		    recaler son miroir sur un chemin précis. */
		stat(abs: string): Promise<{ mtime: number } | null>;

		/**
		 * TOUS les fichiers d'une racine, récursivement, pour HYDRATER le
		 * miroir du rendu au démarrage.
		 *
		 * C'EST LE TROU QUE LE PLAN NE VOYAIT PAS. `HostFs.listMarkdown()`,
		 * `findByName()` et `getFile()` sont SYNCHRONES, et le contrat écrit
		 * pourquoi : « le scanner et le sanitizer les appellent en plein rendu,
		 * où une promesse imposerait de tout rendre asynchrone »
		 * (`src/host/types.ts`). AUCUNE méthode de ce pont ne peut les servir —
		 * l'IPC est asynchrone par construction. La conception retenue :
		 *
		 *   - le processus PRINCIPAL garde l'index d'AUTORITÉ (c'est lui qui a
		 *     le surveillant et qui fait les écritures) ;
		 *   - le RENDU tient un MIROIR en mémoire, hydraté une fois par cette
		 *     méthode, puis tenu à jour par les événements que le principal
		 *     POUSSE (`surveiller`) et par le `mtime` que chaque écriture rend ;
		 *   - les trois méthodes synchrones du contrat lisent ce miroir.
		 *
		 * Ce n'est pas une invention : `buildIndex` et `apply` vivent DÉJÀ côté
		 * rendu dans l'hôte Tauri (`apps/windows/src/host/fs.ts`). La frontière
		 * se déplace, pas l'architecture.
		 *
		 * Un PARCOURS DU DISQUE et non une lecture de l'index du principal :
		 * celui-ci se peuple au fil du parcours initial de chokidar, donc il
		 * est INCOMPLET tant que ce parcours n'est pas fini, et rien n'en
		 * signale la fin. Le rendu montrerait alors un catalogue vide au
		 * démarrage, qui se remplirait sous les yeux de l'utilisateur.
		 *
		 * Les dossiers ignorés (cachés, `node_modules`) ne sont pas parcourus,
		 * et `mtime` n'est relevé que pour les `.md` — un `stat` par fichier
		 * coûterait un aller-retour disque pour chaque image d'un dossier de
		 * cours, alors que seul le catalogue de quiz s'en sert (tri
		 * « récents »). Les autres gardent `mtime: 0`, ce que `HostFile`
		 * autorise explicitement.
		 */
		liste(racine: string): Promise<EntreeDisque[]>;
	};

	/**
	 * S'abonne aux changements de TOUTES les racines déclarées par `demarrer`.
	 * Rend le désabonnement.
	 *
	 * S'ABONNER AVANT D'HYDRATER (`liste`), jamais l'inverse : un événement
	 * arrivé entre les deux est alors soit déjà reflété par le parcours, soit
	 * reçu par l'abonné — dans les deux cas le miroir reste juste. L'ordre
	 * inverse ouvre une fenêtre où un changement est perdu jusqu'au prochain.
	 */
	surveiller(onEvenement: (ev: EvenementDisque) => void): Promise<() => void>;

	dialogue: {
		/** Le sélecteur natif. `null` si l'utilisateur annule — ce n'est pas une
		    erreur, c'est la réponse « non ». */
		choisirDossier(): Promise<string | null>;
	};

	/**
	 * Les réglages de l'application (remplace `@tauri-apps/plugin-store`).
	 *
	 * PAS de `save()` : chaque écriture touche le disque immédiatement. Le
	 * magasin Tauri était débouncé et demandait un `save()` explicite qu'on
	 * pouvait oublier — un réglage perdu sans le moindre message.
	 */
	reglages: {
		lire(cle: string): Promise<unknown>;
		ecrire(cle: string, valeur: unknown): Promise<void>;
		/** RETIRE la clé. Nécessaire, et pas par symétrie : la conversion de
		    l'ancienne clé `folder` au singulier (`host/folder.ts`) l'efface
		    après l'avoir lue — sans quoi elle serait relue à chaque démarrage
		    et les deux clés finiraient par diverger. Écrire `undefined` ne
		    suffirait pas : JSON ne le sérialise pas. */
		supprimer(cle: string): Promise<void>;
	};

	systeme: {
		/** Ouvre le fichier avec l'application par défaut du système. Rend
		    `false` si le système a refusé : `HostShell.openExternal` rend un
		    booléen dont `engine/resources.ts` se sert pour prévenir
		    l'utilisateur, et un `void` obligerait l'hôte à inventer un `true`
		    qui mentirait. */
		ouvrir(abs: string): Promise<boolean>;
		/** Les vaults qu'Obsidian connaît. Une liste vide est un état NORMAL
		    (Obsidian absent de la machine), pas une erreur. */
		vaultsObsidian(): Promise<VaultConnu[]>;
	};

	fenetre: {
		/**
		 * Le rappel à exécuter AVANT que la fenêtre ne se ferme, et que la
		 * fermeture ATTEND. C'est le seul chemin qui sache attendre une
		 * écriture différée (journal de révision, statistiques, page d'un quiz
		 * — trois écrivains débouncés, voir `apps/windows/src/main.ts`).
		 *
		 * `Promise<void>` et non `void` : l'ARMEMENT lui-même traverse l'IPC,
		 * et une fermeture qui surviendrait avant que le principal ne sache
		 * qu'un rappel existe n'attendrait rien. On peut donc attendre d'être
		 * réellement armé. (Le plan écrivait `void` ; c'est la même règle que
		 * « aucun `ipcMain.on` sans réponse » appliquée au sens principal →
		 * rendu.)
		 */
		surFermeture(rappel: () => Promise<void>): Promise<void>;
	};
}

/**
 * Les noms de canaux, ÉCRITS UNE FOIS.
 *
 * Le principal les enregistre, le préchargement les appelle : un nom recopié
 * de travers ne produit aucune erreur de compilation, seulement un `invoke`
 * qui rejette à l'exécution avec « No handler registered ». Une seule source
 * rend la faute impossible.
 */
export const CANAUX = {
	demarrer: "neo:demarrer",
	read: "neo:fichiers/read",
	readCached: "neo:fichiers/read-cached",
	write: "neo:fichiers/write",
	lirePourEcriture: "neo:fichiers/lire-pour-ecriture",
	ecrireSiInchange: "neo:fichiers/ecrire-si-inchange",
	writeBinary: "neo:fichiers/write-binary",
	append: "neo:fichiers/append",
	exists: "neo:fichiers/exists",
	mkdirs: "neo:fichiers/mkdirs",
	trash: "neo:fichiers/trash",
	list: "neo:fichiers/list",
	remove: "neo:fichiers/remove",
	rename: "neo:fichiers/rename",
	stat: "neo:fichiers/stat",
	liste: "neo:fichiers/liste",
	surveiller: "neo:surveiller",
	/** POUSSÉ par le principal vers la fenêtre (`webContents.send`). C'est le
	    SEUL sens principal → rendu du pont, et il est indispensable : un rendu
	    qui interrogerait le disque en boucle pour voir ce qui a changé serait
	    l'inverse d'un surveillant. */
	evenement: "neo:evenement",
	armerFermeture: "neo:fenetre/armer-fermeture",
	fermeture: "neo:fenetre/fermeture",
	fermetureTerminee: "neo:fenetre/fermeture-terminee",
	choisirDossier: "neo:dialogue/choisir-dossier",
	reglagesLire: "neo:reglages/lire",
	reglagesEcrire: "neo:reglages/ecrire",
	reglagesSupprimer: "neo:reglages/supprimer",
	ouvrir: "neo:systeme/ouvrir",
	vaultsObsidian: "neo:systeme/vaults-obsidian",
} as const;

declare global {
	interface Window {
		/** Posé par le préchargement (`contextBridge.exposeInMainWorld`). Le
		    rendu n'a AUCUN autre accès au disque. */
		readonly neo: Pont;
	}
}
