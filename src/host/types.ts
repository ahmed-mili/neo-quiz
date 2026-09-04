/* ══════════════════════════════════════════════════════════
   LE CONTRAT D'HÔTE

   Tout ce que le code partagé (moteur, scanner, chaîne de lecture d'un bloc)
   demande à son environnement. Obsidian, Windows et — plus tard — Android en
   fournissent chacun une implémentation ; aucun d'eux n'apparaît ici.

   C'est la généralisation d'un patron déjà éprouvé dans ce dépôt :
   `dashboard/review-store.ts` absorbe tout ce qui est spécifique à Obsidian
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
	    depuis un sous-dossier restait cassé là où l'app l'affichait. */
	resourceUrl(target: string | HostFile): string | null;
}

export interface HostWatcher {
	/** S'abonne aux changements du dossier. Renvoie le désabonnement. */
	onChange(cb: (ev: HostFileEvent) => void): () => void;
}

export interface HostUi {
	/** Message bref, non bloquant, sans interaction. */
	notice(message: string, timeoutMs?: number): void;
	/** Pose une icône LUCIDE dans l'élément, en remplaçant son contenu.
	    `name` est un identifiant Lucide (« grip-horizontal », « x »). */
	setIcon(el: HTMLElement, name: string): void;
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

export interface HostPaths {
	/** Dossier des exports de résultats, relatif à la racine.
	    Côté Obsidian il vaut « .obsidian/quiz-blocks-results » et NE CHANGE
	    PAS : les résultats déjà écrits doivent rester trouvables. */
	resultsDir: string;
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
}
