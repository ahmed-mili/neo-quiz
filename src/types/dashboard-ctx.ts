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
import type { VoiceSettings } from "../dashboard/voice-install";
import type { Hotkey } from "../hotkey-format";
import type { OllamaCatalogEntry } from "../dashboard/ai-providers";
import type { AiClient } from "../dashboard/ai-client";
import type { AiUsageEntry } from "../dashboard/ai-usage";
import type { AiHandlers } from "../dashboard/ai";
import type { ModuleOverride } from "../dashboard/quiz-modules";

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
 * Réglages IA du plugin (src/plugin.js DEFAULT_SETTINGS, encore .js). Étend
 * `VoiceSettings` (dictée) avec le sous-ensemble « génération IA » réellement
 * lu par le lot IA (ai.ts / ai-client.ts) — Task 8c. Les champs non listés
 * existent au runtime, simplement pas encore déclarés ici.
 */
export interface AiSettings extends VoiceSettings {
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
   DashboardCtx — le ctx lui-même (dashboard.js:54-64)
   ════════════════════════════════════════════════════════ */

export interface DashboardCtx {
	/** Référence à la vue hôte — même objet que `this` dans QuizDashboardView (dashboard.js:55). */
	view: DashboardView;
	app: App;
	/**
	 * `plugin.settings` : `AiSettings` (Task 8c) couvre le sous-ensemble
	 * « dictée » (`VoiceSettings`) + « génération IA » (aiProvider, aiModel,
	 * aiEffort, aiOllama*, hotkey*…) réellement lu par voice-input.ts, ai.ts et
	 * ai-client.ts. La forme COMPLÈTE (quizStats…) sera étoffée par la
	 * conversion de `plugin.js` lui-même (encore `.js`). Les champs non listés
	 * existent bel et bien au runtime, simplement pas encore déclarés ici.
	 */
	plugin: Plugin & { settings: AiSettings; saveSettings(): Promise<void> };
	/** Copie de `view.scanner` au moment de la construction du ctx (dashboard.js:58). */
	scanner: Scanner;
	/** Copie de `view.statsStore` au moment de la construction du ctx (dashboard.js:59). */
	statsStore: StatsStore;
	/** Même référence DOM que `view.navEl` (dashboard.js:60) — déjà assignée à ce stade (onOpen l'a créée avant de construire ctx, dashboard.js:50). */
	navEl: HTMLElement;
	/** Même référence DOM que `view.contentEl_` (dashboard.js:61) — nommé `contentEl` dans le littéral ctx réel. */
	contentEl: HTMLElement;
	/** Délègue à `view.navigate(view, data)`. `edit: true` ouvre la page du
	    quiz directement en ÉDITION (menu ⋯ « Modifier »). */
	navigate: (view: DashboardViewName, data?: { quiz?: QuizIndexEntry; edit?: boolean }) => void;
	/** Historique boutons souris (spec 2026-07-20-mouse-nav-history) : empile
	    l'état de navigation COURANT avant un changement — appelé par quizzes.ts
	    juste avant drill in/out. Délègue à `view.recordNav()` (no-op pendant
	    une restauration, garde isRestoringNav côté vue). */
	recordNav: () => void;
	/** dashboard.js:63, `() => this.app.workspace.getActiveFile()`. */
	getActiveFile: () => TFile | null;
}
