/* ══════════════════════════════════════════════════════════
   LE CONTRAT D'HÔTE

   Tout ce que le code partagé (moteur, scanner, chaîne de lecture d'un bloc)
   demande à son environnement. Obsidian, Windows et — plus tard — Android en
   fournissent chacun une implémentation ; aucun d'eux n'apparaît ici.

   C'est la généralisation d'un patron déjà éprouvé dans ce dépôt :
   `review/review-store.ts` absorbe tout ce qui est spécifique à Obsidian
   pour que l'ordonnanceur n'en voie rien. La différence est mécanique :
   `npm run check:host` refuse toute nouvelle dépendance à `obsidian` dans
   `src/`, et c'est ce contrôle — pas la discipline — qui tient la frontière.

   RÈGLE DE FORME : aucun type de ce fichier ne porte de méthode vivante ni
   d'objet propriétaire d'un hôte. Un `TFile` d'Obsidian et une entrée d'index
   Tauri doivent tous les deux se réduire à un `HostFile` sans rien inventer.
══════════════════════════════════════════════════════════ */

/** Un fichier vu par l'hôte. Volontairement plat et sérialisable. */
export interface HostFile {
	/** Chemin depuis la racine du dossier, séparateurs `/`, jamais absolu.
	    C'est la clé du journal de révision et du catalogue : elle doit être
	    identique dans les trois hôtes pour le même fichier. */
	path: string;
	/** Nom avec extension : « schema.png ». */
	name: string;
	/** Nom sans extension : « schema ». */
	basename: string;
	/** Extension sans point : « png ». Chaîne vide si aucune. */
	extension: string;
	/** Dernière modification, ms depuis l'époque. 0 si l'hôte l'ignore. */
	mtime: number;
}

/** Changement observé dans le dossier. `rename` est distinct de
    delete+create : le journal de révision suit les clés par renommage, et
    reconstituer un renommage à partir de deux évènements est impossible. */
export type HostFileEvent =
	| { kind: "create"; file: HostFile }
	| { kind: "modify"; file: HostFile }
	| { kind: "delete"; path: string }
	| { kind: "rename"; file: HostFile; oldPath: string };

export interface HostFs {
	/** Lit un fichier texte. Rejette si absent ou illisible. */
	read(path: string): Promise<string>;
	/** Lecture destinée à un balayage complet du dossier : l'hôte a le droit
	    de servir un cache. Obsidian a `cachedRead` ; un hôte sans cache peut
	    renvoyer `read`. */
	readCached(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	/** Crée le dossier ET ses parents. Ne rejette pas s'il existe déjà. */
	mkdirs(path: string): Promise<void>;
	/** Ajoute à la FIN du fichier, en le créant s'il n'existe pas.
	    L'ajout seul est ce qui rend le journal de révision sûr : une coupure
	    ne peut tronquer que le dernier petit lot, jamais réécrire tout
	    l'historique. Un hôte qui l'émulerait par lecture + réécriture
	    perdrait exactement la propriété pour laquelle il existe. */
	append(path: string, data: string): Promise<void>;
	/** Les FICHIERS d'un dossier (chemins du contrat), sans descendre dans
	    les sous-dossiers. Un dossier absent rend `[]` — ce n'est pas une
	    erreur : le journal cherche des fichiers de conflit qui, la plupart
	    du temps, n'existent pas. */
	list(dir: string): Promise<string[]>;
	/** Supprime un fichier. Ne rejette pas s'il est déjà absent. */
	remove(path: string): Promise<void>;
	/** Renomme (ou déplace) un fichier. Rejette si la destination existe :
	    la migration du journal s'en sert pour ne jamais écraser une
	    sauvegarde précédente. */
	rename(from: string, to: string): Promise<void>;
	/** Index EN MÉMOIRE des fichiers `.md`, synchrone. Obsidian tient déjà le
	    sien ; l'app le construit au démarrage et le maintient par le watcher.
	    Synchrone parce que le scanner et le sanitizer l'appellent en plein
	    rendu, où une promesse imposerait de tout rendre asynchrone. */
	listMarkdown(): HostFile[];
	/** Cherche par NOM exact (avec extension), casse ignorée. Plusieurs
	    résultats sont possibles et ce n'est pas une erreur : l'appelant
	    prévient l'utilisateur (engine/resources.ts). */
	findByName(name: string): HostFile[];
	getFile(path: string): HostFile | null;
}

export interface HostLinks {
	/** Résout un wikilink (« schema.png », « Cours/ch1 ») relativement à la
	    note `fromPath`. null si rien ne correspond. */
	resolve(linkPath: string, fromPath: string): HostFile | null;
	/** URL affichable dans un attribut `src`. null si non résoluble — jamais
	    une chaîne vide, qui ferait charger la page courante comme image.

	    SÉMANTIQUE ARRÊTÉE : « RÉSOUT puis convertit ». Une CHAÎNE est d'abord
	    résolue en fichier existant par la même voie que `resolve` ; si rien
	    ne correspond, la réponse est `null`. Ce n'est PAS un simple
	    changement de préfixe sur le chemin qu'on lui donne.
	    Pourquoi cette moitié-là : l'unique appelant
	    (`src/engine/cards.ts`, images d'options) laisse le `src` d'origine
	    intact quand la réponse est `null`, en comptant sur la liste blanche
	    du sanitizer. Cette branche n'a de sens que si `null` est possible.
	    L'implémentation Obsidian rendait autrefois `getResourcePath()` sans
	    rien vérifier — donc jamais `null` pour une chaîne non vide, donc une
	    URL de fichier inexistant, et un nom nu (« schema.png ») référencé
	    depuis un sous-dossier restait cassé là où l'app l'affichait.

	    `fromPath` est la note CITANTE. Il sert deux fois : sous Obsidian, il
	    permet à `getFirstLinkpathDest` de résoudre un nom nu comme la note
	    l'entend ; dans l'application, il BORNE la recherche à la racine de
	    cette note — une image du dossier A ne doit jamais être servie à une
	    note du dossier B, exactement comme un lien ne sort pas d'un vault. */
	resourceUrl(target: string | HostFile, fromPath?: string): string | null;
}

export interface HostWatcher {
	/** S'abonne aux changements du dossier. Renvoie le désabonnement. */
	onChange(cb: (ev: HostFileEvent) => void): () => void;
	/**
	 * Renommages de DOSSIERS, séparés des fichiers, et c'est le journal de
	 * révision qui l'exige : ses clés se déplacent par PRÉFIXE, donc un
	 * dossier renommé déplace toutes ses notes en une seule ligne. Sans ce
	 * canal, renommer « Cours » en « Cours B2 » orphelinerait d'un coup
	 * l'historique de toutes ses questions — et rien ne le signalerait.
	 *
	 * Un hôte qui ne sait pas distinguer un dossier renommé n'appelle
	 * jamais le rappel ; il ne DEVINE pas.
	 */
	onRenameDir(cb: (ev: { from: string; to: string }) => void): () => void;
}

export interface HostUi {
	/** Message bref, non bloquant, sans interaction. */
	notice(message: string, timeoutMs?: number): void;
	/** Pose une icône LUCIDE dans l'élément, en remplaçant son contenu.
	    `name` est un identifiant Lucide (« grip-horizontal », « x »). */
	setIcon(el: HTMLElement, name: string): void;
	/** Tous les noms d'icônes disponibles, en KEBAB-CASE (« chevron-down »),
	    la forme que le contrat emploie partout. Le sélecteur d'icônes les
	    liste ; l'ordre n'a pas d'importance, il trie lui-même. */
	iconNames(): string[];
}

export interface HostMath {
	/** Prépare le moteur de rendu. Idempotent, et un échec ne doit pas être
	    mémoïsé : une panne transitoire tuerait le rendu pour la session. */
	ready(): Promise<void>;
	/** Rend UN segment LaTeX. `display` = mode bloc ($$…$$). */
	render(latex: string, display: boolean): HTMLElement;
	/** Fin de lot. L'hôte qui a besoin d'une passe finale la fait ici ; les
	    autres n'ont rien à faire. */
	flush(): void;
}

export interface HostShell {
	/** Ouvre le fichier avec l'application par défaut du système. */
	openExternal(file: HostFile): Promise<boolean>;
	/** Révèle le fichier dans l'explorateur de l'hôte. `false` quand l'hôte
	    n'a pas d'explorateur : ce n'est PAS une erreur, l'appelant enchaîne
	    sur l'ouverture externe. */
	revealInHost(file: HostFile): Promise<boolean>;
}

export interface HostPlatform {
	isMobile: boolean;
	isMacOS: boolean;
	/** Étiquette BCP-47 de la langue de l'interface de l'HÔTE (« fr »,
	    « en-US »). C'est la source du mode « auto » de `src/i18n.ts` : sous
	    Obsidian, la langue d'Obsidian ; dans l'app, celle du système. */
	uiLanguage: string;
}

/**
 * Une RACINE : un dossier de quiz ouvert.
 *
 * Le greffon n'en a qu'une (le vault) ; l'application peut en ouvrir
 * jusqu'à dix. C'est la seule différence que le code partagé doit
 * connaître, et il la connaît par ce type — jamais par un test d'hôte.
 */
export interface HostRoot {
	/** Identifiant, et PREMIER SEGMENT des chemins du contrat qui en
	    relèvent. Chaîne VIDE quand l'hôte n'a qu'une racine : les chemins
	    du greffon restent alors exactement ce qu'ils ont toujours été. */
	id: string;
	/** Nom affichable (le dossier choisi, le vault). */
	name: string;
	/** Le journal de révision de cette racine, en chemin du CONTRAT. */
	reviewLog: string;
	/** L'ANCIEN journal (celui que le greffon écrivait à côté de lui), en
	    chemin du contrat, ou `null` quand l'hôte sait qu'il n'y en a pas.
	    C'est l'hôte qui le sait : le greffon lit `manifest.dir`,
	    l'application compose le chemin conventionnel. */
	legacyReviewLog: string | null;
}

export interface HostPaths {
	/**
	 * Dossier des exports de résultats POUR une note donnée.
	 * Une FONCTION et non une constante depuis que l'application ouvre
	 * plusieurs dossiers : une constante enverrait les résultats d'un quiz
	 * du dossier B dans le dossier A.
	 * Côté Obsidian elle ignore son argument et rend toujours
	 * « .obsidian/quiz-blocks-results », qui NE CHANGE PAS.
	 */
	resultsDirFor(sourcePath: string): string;
	/** Les racines ouvertes, dans l'ordre d'affichage. */
	roots(): HostRoot[];
	/** La racine dont relève un chemin du contrat, ou `null`. */
	rootOf(path: string): HostRoot | null;
	/**
	 * Le chemin RELATIF À SA RACINE — c'est-à-dire la CLÉ DU JOURNAL.
	 * Elle doit être identique sous les deux hôtes pour la même note :
	 * « Cours/reseau.md », jamais « Efrei/Cours/reseau.md » ni un chemin
	 * absolu. Un hôte qui recomposerait cette clé ailleurs ferait diverger
	 * les deux historiques sans que personne ne le voie.
	 */
	localPath(path: string): string;
	/** L'inverse : le chemin du contrat d'une clé locale dans une racine. */
	contractPath(rootId: string, localPath: string): string;
}

/** Ce qu'une modale ouverte rend à son ouvreur. */
export interface HostModalHandle {
	/** LE PANNEAU. Exposé parce qu'un menu ouvert depuis une modale doit s'y
	    portaler et non au `body` : portalé au body, il passe DERRIÈRE le
	    panneau et le focus retourne au fond (module-edit.ts:118 et :202). */
	readonly panelEl: HTMLElement;
	/** Le corps, où l'appelant construit son contenu. L'hôte le vide à la
	    fermeture : aucun appelant n'a à le faire. */
	readonly contentEl: HTMLElement;
	setTitle(text: string): void;
	close(): void;
}

export interface HostModalSpec {
	/** Classe posée sur le PANNEAU (« qbd-create-modal », « qbd-medit-modal »).
	    Le CSS partagé la cible déjà ; l'hôte ne la choisit pas. */
	className?: string;
	title?: string;
	/** Construit le contenu. Appelé une fois, après attachement — un appelant
	    qui mesure un élément doit pouvoir le faire ici. */
	onOpen(handle: HostModalHandle): void;
	/** Appelé APRÈS la disparition, jamais avant : `module-edit.ts` y écrit
	    ses changements sur le disque, et le faire pendant l'animation
	    rendrait l'écriture concurrente d'un rendu. */
	onClose?(): void;
}

export interface HostModals {
	/** Ouvre une modale. Elle est modale au sens strict : Échap et un clic sur
	    le fond la ferment, et l'hôte rend le focus à ce qui l'avait. */
	open(spec: HostModalSpec): HostModalHandle;
}

export interface Host {
	fs: HostFs;
	links: HostLinks;
	watcher: HostWatcher;
	ui: HostUi;
	math: HostMath;
	shell: HostShell;
	platform: HostPlatform;
	paths: HostPaths;
	modals: HostModals;
}
