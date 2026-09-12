/**
 * Interface du ctx (god-object) du sous-système dashboard (src/dashboard.js,
 * classe QuizDashboardView extends ItemView, méthode onOpen).
 *
 * Le littéral `ctx` construit en onOpen (dashboard.js:54-64) est PLUS PETIT
 * que celui de l'éditeur (EditorCtx) : il ne porte que l'état de base + deux
 * helpers, `this.ctx = ctx` (dashboard.js:66), puis 5 sous-modules sont
 * assignés directement sur la VUE — PAS sur ctx (dashboard.js:69-73) :
 *   this.nav = createNavHandlers(ctx)
 *   this.home = createHomeHandlers(ctx)
 *   this.quizzes = createQuizzesHandlers(ctx)
 *   this.detail = createDetailHandlers(ctx)
 *   this.ai = createAiHandlers(ctx)
 * D'où la scission en deux interfaces ci-dessous : `DashboardCtx` (fidèle au
 * littéral ctx réel) et `DashboardView` (l'hôte `this`, qui porte les 5
 * handlers + l'état propre à la vue).
 *
 * Task 8a convertit le cluster RENDU (scanner/stats-store/quiz-card/nav/
 * home/quizzes/detail/effort-canvas) : Scanner/StatsStore sont désormais les
 * vrais types importés depuis scanner.ts/stats-store.ts. `ai` (dashboard/ai.js)
 * et `AiClient` (ai-client.js) restent en placeholder `unknown`-based — hors
 * périmètre 8a (lot IA, tâche suivante).
 */

import type { App, ItemView, Plugin, TFile } from "obsidian";
import type { Scanner, QuizIndexEntry } from "../dashboard/scanner";
import type { StatsStore } from "../dashboard/stats-store";
import type { NavHandlers } from "../dashboard/nav";
import type { QuizzesHandlers } from "../dashboard/quizzes";
import type { HomeHandlers } from "../dashboard/home";
import type { DetailHandlers } from "../dashboard/detail";
import type { Hotkey } from "../hotkey-format";
import type { OllamaCatalogEntry } from "../dashboard/ai-providers";
import type { AiClient } from "../dashboard/ai-client";
import type { AiUsageEntry } from "../dashboard/ai-usage";
import type { AiHandlers } from "../dashboard/ai";
import type { ModuleOverride, ModuleGroup, ModuleMap } from "../dashboard/quiz-modules";
import type { ReviewStore } from "../review/review-store";

export type { Scanner, StatsStore, AiClient, AiHandlers };

/** Vues possibles du dashboard (dashboard.js:23 currentView, navigate, previousView). */
export type DashboardViewName = "home" | "quizzes" | "detail" | "ai";

/**
 * Client IA (src/dashboard/ai-client.ts, createAiClient(plugin)) : NE FIGURE
 * PAS dans le littéral ctx ni sur la vue — instancié à la demande, en interne,
 * par le sous-module `ai` (dashboard/ai.ts, `const client = createAiClient(
 * ctx.plugin)`). Le VRAI type est désormais importé d'ai-client.ts (Task 8c)
 * et ré-exporté ci-dessus.
 */

/**
 * Réglages IA du plugin (src/plugin.js DEFAULT_SETTINGS, encore .js). Couvre
 * le sous-ensemble « génération IA » réellement lu par le lot IA (ai.ts /
 * ai-client.ts) — Task 8c. La dictée a été retirée le 2026-09-11 ; ses
 * réglages persistés existent encore au runtime (ignorés, pas effacés) mais
 * ne sont plus typés ici. Les champs non listés existent au runtime,
 * simplement pas encore déclarés ici.
 */
export interface AiSettings {
	aiProvider?: string;
	aiModel?: string;
	aiEffort?: string;
	aiCodexFast?: boolean;
	aiOllamaUrl?: string;
	aiOllamaCloudKey?: string;
	// `null` = sentinelle « défaut » réellement persistée par le plugin
	// (plugin.ts DEFAULT_SETTINGS) ; les helpers ollama la traitent comme « unset ».
	aiOllamaModels?: string[] | null;
	aiOllamaCatalog?: OllamaCatalogEntry[] | null;
	/** Journal des générations IA (dashboard/ai-usage.ts). */
	aiUsageLog?: AiUsageEntry[];
	/** Lecture opt-in de l'usage de l'abonnement du fournisseur. */
	aiUsageLimitsEnabled?: boolean;
	hotkeyAddFiles?: Hotkey | null;
	hotkeyAddNotes?: Hotkey | null;
	aiMentionExtraFolders?: string[];
	/* ── LES CHEMINS D'EXÉCUTABLE DES CLI (application seulement) ──

	   Vides/absents par défaut, et c'est l'état NORMAL : les deux hôtes
	   cherchent d'abord le CLI dans un `PATH` étendu. Ils n'existent que pour la
	   machine où cette recherche échoue — une APPLICATION INSTALLÉE démarre avec
	   le `PATH` du SYSTÈME, pas celui du terminal, et un installateur qui écrit
	   dans le `PATH` du registre n'atteint jamais un processus déjà lancé.

	   LUS PAR LE SEUL PROCESSUS PRINCIPAL DE L'APPLICATION
	   (`apps/windows/electron/canaux.ts`, dans SON magasin — jamais envoyés par
	   la fenêtre), et GARDÉS à l'écriture (`garde-ia.ts` : absolu, existant,
	   d'une extension lançable). Le greffon les ignore : sous Obsidian, le
	   `PATH` étendu de `buildChildEnv` a toujours suffi, et un réglage qu'aucun
	   écran ne montre serait un réglage mort. Déclarés ici quand même, dans la
	   seule liste des réglages IA, parce que les deux hôtes persistent le MÊME
	   objet : une clé connue d'un seul côté serait rognée par l'autre. */
	cheminClaude?: string;
	cheminCodex?: string;
	/* NB : cette interface s'appelle « AiSettings » mais elle est en réalité
	   le sous-ensemble des réglages du plugin que le DASHBOARD lit — le nom
	   ne suit plus. Le champ ci-dessous n'a rien d'IA ; le renommage est un
	   travail à part (plugin.js n'est pas encore converti), à signaler au
	   rapport plutôt qu'à faire ici. */
	quizzesExpandedFolders?: string[];
	/** Axe de regroupement de « Mes quiz » (module/ue/recent/type) — même remarque
	    que ci-dessus, aucun rapport avec l'IA. Cf. plugin.ts DEFAULT_SETTINGS. */
	quizzesGrouping?: "module" | "ue" | "recent" | "type";
	/** Note de correspondance UE → module. Cf. plugin.ts DEFAULT_SETTINGS. */
	quizzesModuleMapNote?: string;
	/** DOSSIERS archivés (clé `folder` de module) — l'archivage n'existe qu'au
	    niveau dossier. Cf. plugin.ts DEFAULT_SETTINGS. */
	quizzesArchivedFolders?: string[];
	/** Overrides « Modifier dossier » (module-edit.ts). Cf. plugin.ts. */
	quizzesModuleOverrides?: Record<string, ModuleOverride>;
}

/**
 * Le plugin hôte tel que la VUE dashboard le consomme (QuizDashboardView,
 * src/dashboard.ts) : `Plugin` d'Obsidian + les expandos réels posés par
 * plugin.js —
 *  - `_scanner` / `_statsStore` (plugin.js onload), lus par les getters
 *    `scanner` / `statsStore` de la vue (dashboard.ts, `this.plugin._scanner`) ;
 *  - `settings` (AiSettings) + `saveSettings()`, comme pour le ctx.
 * La forme COMPLÈTE des settings (quizStats, enableCodeHighlighting…) sera
 * étoffée par la conversion de `plugin.js` lui-même (encore `.js`) ; les
 * champs non listés existent au runtime, simplement pas encore déclarés.
 */
export interface DashboardPlugin extends Plugin {
	settings: AiSettings;
	saveSettings(): Promise<void>;
	_scanner: Scanner;
	_statsStore: StatsStore;
	/** Journal de révision par QUESTION (ordonnanceur). Distinct de
	    `_statsStore`, qui reste la progression par QUIZ pour l'affichage :
	    deux systèmes, deux questions différentes, à ne pas fusionner. */
	_reviewStore?: ReviewStore;
}

/* ════════════════════════════════════════════════════════
   DashboardView — l'hôte `this` (QuizDashboardView), qui
   porte les 5 sous-modules + l'état propre à la vue
   ════════════════════════════════════════════════════════ */

/**
 * `view` / `this` dans QuizDashboardView (dashboard.js:19-171). Porte l'état
 * de navigation, les getters `scanner`/`statsStore` (dashboard.js:39-40) et
 * les 5 sous-modules assignés en onOpen (dashboard.js:69-73) — c'est CETTE
 * interface, pas DashboardCtx, qui porte nav/home/quizzes/detail/ai.
 */
export interface DashboardView extends ItemView {
	plugin: DashboardPlugin;
	/** dashboard.js:23, valeurs réellement utilisées (switch dashboard.js:149-169). */
	currentView: DashboardViewName;
	/** Quiz sélectionné pour la vue détail (dashboard.js:24). */
	selectedQuiz: QuizIndexEntry | null;
	/** Vue précédente, pour le retour depuis "detail" (dashboard.js:25, 131-134). */
	previousView: DashboardViewName;
	/** dashboard.js:26, 50 — conteneur sidebar, assigné en onOpen. */
	navEl: HTMLElement | null;
	/** dashboard.js:27, 51 — conteneur contenu, assigné en onOpen (nommé `contentEl_` pour ne pas masquer `ItemView.contentEl`). */
	contentEl_: HTMLElement | null;
	/** Getters dashboard.js:39-40, lisent `plugin._scanner`/`plugin._statsStore`. */
	readonly scanner: Scanner;
	readonly statsStore: StatsStore;
	/** ctx sauvegardé sur la vue (dashboard.js:66, `this.ctx = ctx`). */
	ctx?: DashboardCtx;

	// ── Sous-modules assignés en onOpen (dashboard.js:69-73) — nav/home/
	//    quizzes/detail typés en Task 8a ; `ai` typé en AiHandlers (Task 8c). ──
	nav?: NavHandlers;
	home?: HomeHandlers;
	quizzes?: QuizzesHandlers;
	detail?: DetailHandlers;
	ai?: AiHandlers;

	navigate(view: DashboardViewName, data?: { quiz?: QuizIndexEntry; edit?: boolean }): void;
	renderSidebar(): void;
	renderCurrentView(): void;
	/** Historique boutons souris — cf. QuizDashboardView (dashboard.ts). */
	recordNav(): void;
	goNavBack(): void;
	goNavForward(): void;
}

/* ════════════════════════════════════════════════════════
   DashboardShellCtx — ce dont les pages PORTÉES (accueil, « Mes
   quiz ») ont besoin, et RIEN de plus (plan tranche 2.5, tâche 2,
   décision D3). `DashboardCtx` l'étend en y ajoutant `view`, `app`,
   `plugin`, `navEl`/`contentEl` et `getActiveFile` — le reste du
   greffon (IA, dictée, détail) en a encore besoin.
   ════════════════════════════════════════════════════════ */

/** Les cinq réglages que les pages accueil / « Mes quiz » lisent, et rien
    d'autre — sous-ensemble nommé de `AiSettings` (mêmes clés, cf. plus haut).
    `quizzesGrouping` reste `string` : les pages ne valident qu'un sous-axe
    (« ue » / « recent ») au lecture, la forme complète appartient au plugin. */
export interface DashboardPageSettings {
	quizzesExpandedFolders?: string[];
	quizzesGrouping?: string;
	quizzesModuleOverrides?: Record<string, ModuleOverride>;
	quizzesModuleMapNote?: string;
	quizzesArchivedFolders?: string[];
}

/**
 * Ce dont les pages Accueil et Mes quiz ont besoin, et RIEN de plus.
 * `DashboardCtx` l'étend en y ajoutant l'IA, la dictée, le détail et le
 * `Plugin` lui-même. Déclarer cette intersection est ce qui empêche une
 * page portée de se remettre à lire `ctx.plugin` sans que personne ne le
 * voie : côté application, ce champ n'existe pas.
 */
export interface DashboardShellCtx {
	scanner: Scanner;
	statsStore: StatsStore;
	/** Les cinq réglages ci-dessus. Mutés en place puis persistés par
	    `saveSettings()`, comme avant (même objet que `plugin.settings` côté
	    greffon — jamais une copie, sinon un autre onglet ou un rechargement
	    écrirait dans le vide). */
	settings: DashboardPageSettings;
	saveSettings(): Promise<void>;
	/* Le plan (D3) déclarait `navigate(view: DashboardViewName): void`, sans
	   second paramètre — mais `home.ts` (typé, lui, en `DashboardShellCtx`)
	   et quiz-menu.ts (passé à `DashboardShellCtx` en tranche 3, tâche 9),
	   ai.ts (toujours typé en `DashboardCtx`, il importe encore Obsidian)
	   appellent TOUS `ctx.navigate("detail", { quiz, edit? })`.
	   `detail.ts` est passé à `DashboardShellCtx` en tranche 3 (tâche 8) : ses
	   trois lectures de `ctx.view` sont remontées chez l'appelant, dans la
	   `DetailHostSpec` que `src/dashboard.ts` construit.
	   Perdre ce paramètre ici cassait leur compilation : signature restaurée
	   à l'identique de l'ancienne `DashboardCtx.navigate` (bug du plan,
	   corrigé — cf. rapport de tâche).
	   `folder-create.ts`, lui, est passé à `DashboardShellCtx` en tranche 2.6
	   (il n'appelle que `navigate("ai")`, à un seul argument). */
	navigate(view: DashboardViewName, data?: { quiz?: QuizIndexEntry; edit?: boolean }): void;
	/** Historique boutons souris (spec 2026-07-20-mouse-nav-history) : empile
	    l'état de navigation COURANT avant un changement — appelé par quizzes.ts
	    juste avant drill in/out. */
	recordNav(): void;
	/** Joue un quiz. L'hôte décide ce que « jouer » veut dire : ouvrir la
	    note sous Obsidian, monter la page de quiz dans l'application. */
	openQuiz(quiz: QuizIndexEntry): void;
	/** Ouvre les réglages de l'hôte (l'onglet du plugin sous Obsidian). */
	openSettings(): void;
	/** Pages que cet hôte sait ouvrir. Une entrée du rail absente d'ici est
	    rendue DÉSACTIVÉE, pas masquée : la génération atterrira dans
	    l'application (tranche 4) et y sera exclusive — le greffon la perdra.
	    Une barre de navigation qui change de forme entre deux versions se
	    remarque plus qu'une entrée visiblement à venir. */
	canOpen(view: DashboardViewName): boolean;
	/** Le journal de révision, pour la carte « À réviser aujourd'hui ».
	    Absent = la section ne s'affiche pas. Le greffon le fournit depuis
	    `plugin._reviewStore` ; l'application depuis `creerJournalApp`. */
	reviewStore?: ReviewStore;
	/** OUVRE le menu « ⋯ » d'une carte de quiz sur `anchor` (le bouton « ⋯ »),
	    appelée par la page avec SON propre `rerender` — le menu doit pouvoir
	    repeindre la page qui l'affiche. Absente = pas de bouton « ⋯ », ce que
	    `renderQuizCard` prévoit déjà par son `onMenu?` opt-in.
	    Tour de correction 1 (tâche 6) : la carte ne compose plus le menu et
	    ne l'ouvre plus elle-même (`renderQuizCard`/`renderModuleCard`
	    importaient `openActionMenu` d'`ui-select.ts`, donc Obsidian, de façon
	    INCONDITIONNELLE — même quand aucun menu n'était fourni au runtime,
	    ce qui rendait TOUTE carte, et tout ce qui la consomme, irrémédiablement
	    liée à Obsidian). L'ouverture appartient maintenant à l'hôte : c'est
	    lui qui importe `ui-select.ts` (le greffon le fait déjà, `dashboard.ts`
	    reste dans RESTANTS) et compose les items AU CLIC.
	    L'application ne la fournit pas : les menus et les modals sont la
	    tranche 2.6, et une carte sans « ⋯ » est un état prévu, pas dégradé. */
	openCardMenu?: (quiz: QuizIndexEntry, anchor: HTMLElement, rerender: () => void) => void;
	/** Même rôle qu'`openCardMenu`, pour le menu « ⋯ » d'une carte de MODULE
	    (« Mes quiz », tâche 6) : partage, « Modifier dossier », suppression —
	    autant de modals que l'application n'a pas encore. Absente = pas de
	    bouton « ⋯ », ce que `renderModuleCard` prévoit déjà par son `onMenu?`
	    opt-in — l'application ne la fournit pas (menus et modals = tranche
	    2.6, D5). */
	openModuleMenu?: (group: ModuleGroup, anchor: HTMLElement, rerender: () => void, map: ModuleMap) => void;
	/** Sélecteur d'icône d'un module (clic sur la pastille de la carte).
	    Absent = la pastille n'est pas cliquable — `renderModuleCard` prévoit
	    déjà `onPickIcon?` en opt-in. `suggestions` (calculées par la PAGE
	    depuis le nom/l'UE du module, pur — icon-suggest.ts) est simplement
	    transmis ; c'est l'HÔTE qui appelle `openIconPicker` et lui donne son
	    conteneur de portail (les deux passent `document.body` aujourd'hui).
	    `icon-picker.ts` ne tire plus Obsidian depuis la tranche 2.6 — les noms
	    d'icônes viennent d'`HostUi.iconNames()` —, et l'application fournit
	    donc réellement ce membre. */
	pickIcon?: (anchor: HTMLElement, courante: string | undefined, onPick: (nom: string) => void, suggestions?: string[]) => void;
	/** Création d'un quiz dans le dossier OUVERT (drill-down de « Mes
	    quiz »). Absente = le bouton « Nouveau quiz » du header n'est pas
	    rendu. Les modals ne sont plus la raison de cette absence (elles sont
	    dans le contrat depuis la tranche 2.6) : c'est que « Nouveau quiz »
	    écrit une note VIERGE puis l'ouvre en édition, et que l'application
	    n'a pas d'éditeur avant la tranche 3 — un quiz vide qu'on ne peut pas
	    remplir est une impasse, pas une fonctionnalité
	    (apps/windows/src/ui/dashboard-shell.ts). */
	createQuiz?: (folder: string, done: () => void) => void;
	/** Création d'un dossier (racine de « Mes quiz »). Absente = le bouton
	    « Nouveau dossier » n'est pas rendu. `map`/`quizzes` : mêmes données
	    que `openCreateFolderModal` (l'import d'un .zip partagé cherche le parent
	    commun des modules déjà résolus — folder-create.ts). */
	createFolder?: (map: ModuleMap, quizzes: QuizIndexEntry[], done: () => void) => void;
	/** Sélecteur d'axe de regroupement (UE / Récent, ligne au-dessus de la
	    grille). `createSelect` (ui-select.ts) a été libéré d'Obsidian en
	    tranche 2.6 et les DEUX hôtes consomment désormais le MÊME dropdown
	    partagé — l'application n'en a pas porté un second, ce qui aurait
	    donné deux composants à faire évoluer ensemble. Le membre reste
	    optionnel parce qu'un hôte a le droit de ne pas offrir de bouton :
	    l'axe déjà persisté (réglage `quizzesGrouping`) resterait actif.
	    Renvoie l'élément du déclencheur pour que l'appelant y ajoute sa
	    propre classe, comme `createSelect`. */
	renderGroupingSelect?: (
		container: HTMLElement,
		opts: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void },
	) => { el: HTMLElement };
	/** Ouvre la note d'un quiz, éventuellement en édition. Optionnel et ABSENT
	    côté application jusqu'à la tranche 3 : ouvrir un quiz vierge qu'on ne
	    peut pas éditer n'est pas une fonctionnalité, c'est une impasse.
	    L'appelant garde donc son appel optionnel (`?.`) plutôt que de tester
	    l'hôte. */
	openQuizPath?: (path: string, opts?: { edit?: boolean }) => Promise<void>;
	/** Ouvre le partage d'un quiz ou d'un module (zip, Discord, enregistrer).
	    Optionnel et ABSENT côté application : `dashboard/share.ts` livre par
	    `child_process` et `electron.shell`, c'est-à-dire par le sous-contrat de
	    lancement de processus de la tranche 4 — et la spec §7 range de toute
	    façon « la distribution aux camarades » hors de ce chantier. L'entrée
	    « Partager » du menu « ⋯ » n'est simplement pas rendue dans la fenêtre
	    (quiz-menu.ts). Union et non deux champs optionnels : une cible sans
	    quiz ni module ne se construit pas. */
	shareQuiz?: (cible: { quiz: QuizIndexEntry } | { group: ModuleGroup }) => void;
	/** Renomme la note d'un quiz EN METTANT LES LIENS À JOUR. Optionnel et
	    absent côté application : seul Obsidian tient l'index des liens
	    ENTRANTS que cette opération exige (`fileManager.renameFile`).
	    `HostFs.rename` ne convient pas — il déplace des octets sans rien
	    réécrire ailleurs, et la migration du journal dépend de sa sémantique
	    actuelle. Sans ce membre, l'entrée « Renommer » n'est pas rendue.

	    `nom` est le futur basename, déjà ASSAINI par la modale (sans
	    extension ni dossier) ; l'hôte compose la cible dans le dossier de la
	    note, avec son extension.

	    RÉSULTAT : `true` si la note est renommée, `false` sinon — et jamais un
	    rejet. Un `Promise<void>` ne suffisait pas : la modale partagée reste
	    OUVERTE sur un échec, pour que l'utilisateur corrige le nom au lieu de
	    le retaper, et se ferme seulement sur succès ; il lui faut distinguer
	    les deux. C'est l'HÔTE qui affiche la cause (Notice « existe déjà »,
	    « impossible », « introuvable ») : lui seul la connaît.

	    LA GARDE DE COLLISION est donc à l'hôte, et sa force dépend de son index.
	    Le greffon regarde `vault.getAbstractFileByPath(cible)`, qui voit un
	    DOSSIER au chemin cible comme une collision. Un hôte qui n'aurait que
	    `HostFs.getFile` (l'application, le jour où elle tiendra un index des
	    liens entrants) ne verrait que les FICHIERS catalogués : un dossier au
	    nom cible ne déclencherait pas « existe déjà », et l'opération irait
	    jusqu'au renommage pour échouer autrement (« impossible »). Aucun
	    écrasement possible, un message moins précis — limite connue, laissée
	    telle quelle : la corriger serait un membre de contrat de plus. */
	renameQuiz?: (quiz: QuizIndexEntry, nom: string) => Promise<boolean>;
}

/* ════════════════════════════════════════════════════════
   DashboardCtx — le ctx lui-même (dashboard.js:54-64)
   ════════════════════════════════════════════════════════ */

export interface DashboardCtx extends DashboardShellCtx {
	/** Référence à la vue hôte — même objet que `this` dans QuizDashboardView (dashboard.js:55). */
	view: DashboardView;
	app: App;
	/**
	 * `plugin.settings` : `AiSettings` (Task 8c) couvre le sous-ensemble
	 * « génération IA » (aiProvider, aiModel, aiEffort, aiOllama*, hotkey*…)
	 * réellement lu par ai.ts et ai-client.ts. La forme COMPLÈTE (quizStats…)
	 * sera étoffée par la
	 * conversion de `plugin.js` lui-même (encore `.js`). Les champs non listés
	 * existent bel et bien au runtime, simplement pas encore déclarés ici.
	 */
	/* `_reviewStore` est déclaré ICI en plus de `DashboardPlugin` parce que ce
	   `plugin` est l'intersection étroite ci-dessus, pas `DashboardPlugin` :
	   l'accueil lit le puits par `ctx.plugin._reviewStore`. Optionnel à
	   dessein — la task 7 le fait DÉGRADER plutôt que bloquer le greffon,
	   donc il peut réellement manquer au runtime. */
	plugin: Plugin & {
		settings: AiSettings;
		saveSettings(): Promise<void>;
		_reviewStore?: ReviewStore;
	};
	/** Même référence DOM que `view.navEl` (dashboard.js:60) — déjà assignée à ce stade (onOpen l'a créée avant de construire ctx, dashboard.js:50). */
	navEl: HTMLElement;
	/** Même référence DOM que `view.contentEl_` (dashboard.js:61) — nommé `contentEl` dans le littéral ctx réel. */
	contentEl: HTMLElement;
	/** dashboard.js:63, `() => this.app.workspace.getActiveFile()`. */
	getActiveFile: () => TFile | null;
}
