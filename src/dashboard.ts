import { ItemView, Scope } from "obsidian";
import type { WorkspaceLeaf, KeymapEventHandler } from "obsidian";

// C1 (plan) : les 5 factories des sous-modules dashboard/* sont désormais des
// EXPORTS NOMMÉS (Tasks 8a–8c). L'ancien `const createX = require("./dashboard/x")`
// consommait le module ENTIER en supposant que `module.exports` ÉTAIT la
// fonction — après conversion ESM ce require renvoyait le namespace, cassant
// l'appel au runtime (`createNavHandlers is not a function`). Les imports
// nommés ci-dessous rétablissent la parité.
import { createNavHandlers, type NavHandlers } from "./dashboard/nav";
import { createHomeHandlers, type HomeHandlers } from "./dashboard/home";
import { createQuizzesHandlers, type QuizzesHandlers } from "./dashboard/quizzes";
import { createDetailHandlers, type DetailHandlers } from "./dashboard/detail";
import { createAiHandlers, type AiHandlers } from "./dashboard/ai";

import type { DashboardCtx, DashboardView, DashboardViewName, DashboardPlugin } from "./types/dashboard-ctx";
import type { Scanner, QuizIndexEntry } from "./dashboard/scanner";
import type { StatsStore } from "./dashboard/stats-store";
import type { Hotkey } from "./hotkey-format";

/** Photo d'un état de navigation pour l'historique boutons souris (spec
    2026-07-20-mouse-nav-history) : page + dossier ouvert + quiz du détail.
    État d'interface, jamais persisté. */
interface NavSnapshot {
	view: DashboardViewName;
	/** Dossier du drill-down — pertinent seulement si view === "quizzes". */
	drillFolder: string | null;
	/** Quiz affiché — pertinent seulement si view === "detail". */
	quiz: QuizIndexEntry | null;
}

/** Plafond des piles d'historique (shift au-delà) : borne la mémoire sans
    jamais gêner un usage réel. */
const NAV_HISTORY_MAX = 50;

/* ══════════════════════════════════════════════════════════
   QUIZ DASHBOARD VIEW — ItemView Obsidian
   Layout 2 colonnes (sidebar + contenu) avec navigation
   entre Accueil, Mes quiz, Détail et Génération IA.
══════════════════════════════════════════════════════════ */

export const VIEW_TYPE_DASHBOARD = "quiz-blocks-dashboard";

export class QuizDashboardView extends ItemView implements DashboardView {
	plugin: DashboardPlugin;
	currentView: DashboardViewName = "home"; // home | quizzes | detail | ai
	selectedQuiz: QuizIndexEntry | null = null;
	previousView: DashboardViewName = "home";
	navEl: HTMLElement | null = null;
	contentEl_: HTMLElement | null = null;
	ctx?: DashboardCtx;

	// Sous-modules greffés en onOpen (dashboard.js:69-73). Définitivement
	// assignés AVANT tout render / navigate / raccourci (onOpen les pose puis
	// appelle bindComposerHotkeys/renderSidebar) : d'où le `!`.
	nav!: NavHandlers;
	home!: HomeHandlers;
	quizzes!: QuizzesHandlers;
	detail!: DetailHandlers;
	ai!: AiHandlers;

	/* Dernière vue effectivement PEINTE : distingue une ARRIVÉE (le rail
	   change de page) d'un simple re-render de la même vue (scanner, changement
	   de réglage). Seule l'arrivée joue une transition d'entrée. */
	private lastPaintedView: DashboardViewName | null = null;
	/** Défait la transition d'entrée en cours (classe + listener). */
	private _enterCleanup: (() => void) | null = null;

	private _unregisterScanner: (() => void) | null = null;
	private _unregisterLeafChange: (() => void) | null = null;
	private _hkHandlers?: KeymapEventHandler[];

	// ── Historique boutons souris (spec 2026-07-20-mouse-nav-history) ──
	private navBackStack: NavSnapshot[] = [];
	private navForwardStack: NavSnapshot[] = [];
	/* Vrai pendant l'application d'un snapshot : navigate()/recordNav() ne
	   doivent alors PAS empiler — une restauration n'est pas une navigation. */
	private isRestoringNav = false;

	private captureNav(): NavSnapshot {
		return {
			view: this.currentView,
			// Le drill n'est un état restaurable QUE vu depuis « quizzes » ; hors
			// de cette vue openModuleFolder peut rester en résidu dans quizzes.ts
			// (resetDrilldown ne le referme qu'à l'arrivée sur "quizzes") — on ne
			// doit jamais le capturer, sous peine de faux "état différent" au
			// re-clic d'une autre page du rail (finding Critical review Task 1).
			drillFolder: this.currentView === "quizzes" && this.quizzes ? this.quizzes.getOpenFolder() : null,
			quiz: this.currentView === "detail" ? this.selectedQuiz : null,
		};
	}

	private sameNav(a: NavSnapshot, b: NavSnapshot): boolean {
		return a.view === b.view && a.drillFolder === b.drillFolder
			&& (a.quiz?.path ?? null) === (b.quiz?.path ?? null);
	}

	/** Empile l'état COURANT sur back et vide forward. Appelé par navigate()
	    et, via ctx.recordNav, par les transitions de drill (quizzes.ts). */
	recordNav(): void {
		if (this.isRestoringNav) return;
		const snap = this.captureNav();
		// Dédoublonnage défensif : deux enregistrements consécutifs du même
		// état (ex. drill in juste après une navigation) ne créent qu'une entrée.
		// Actuellement inatteignable en usage réel — les chemins doublons sont
		// déjà bloqués en amont par isRestoringNav et la garde de navigate() —
		// ce garde-fou protège de futurs appelants de recordNav().
		const top = this.navBackStack[this.navBackStack.length - 1];
		if (top && this.sameNav(top, snap)) return;
		this.navBackStack.push(snap);
		if (this.navBackStack.length > NAV_HISTORY_MAX) this.navBackStack.shift();
		this.navForwardStack.length = 0;
	}

	private applyNavSnapshot(s: NavSnapshot): void {
		this.isRestoringNav = true;
		try {
			this.navigate(s.view, s.quiz ? { quiz: s.quiz } : undefined);
			if (s.view === "quizzes" && s.drillFolder !== null && this.quizzes) {
				// navigate() vient de refermer le drill (resetDrilldown) : rouvrir
				// le dossier restauré — c'est une ENTRÉE, la transition rejoue.
				this.quizzes.openFolder(s.drillFolder);
			}
		} finally {
			this.isRestoringNav = false;
		}
	}

	// NAV_HISTORY_MAX n'est PAS appliqué ici : ces deux méthodes déplacent un
	// élément d'une pile à l'autre sans jamais en ajouter net (pop d'un côté,
	// push de l'autre) — le total des deux piles reste borné par le plafond
	// déjà imposé par recordNav().
	goNavBack(): void {
		const snap = this.navBackStack.pop();
		if (!snap) return;
		this.navForwardStack.push(this.captureNav());
		this.applyNavSnapshot(snap);
	}

	goNavForward(): void {
		const snap = this.navForwardStack.pop();
		if (!snap) return;
		this.navBackStack.push(this.captureNav());
		this.applyNavSnapshot(snap);
	}

	constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	static getViewType(): string { return VIEW_TYPE_DASHBOARD; }
	static getDisplayText(): string { return "Quiz Blocks"; }

	getViewType(): string { return VIEW_TYPE_DASHBOARD; }
	getDisplayText(): string { return "Quiz Blocks"; }
	getIcon(): string { return "graduation-cap"; }

	get scanner(): Scanner { return this.plugin._scanner; }
	get statsStore(): StatsStore { return this.plugin._statsStore; }

	async onOpen(): Promise<void> {
		this.containerEl.classList.add("qbd-root-container");
		this.contentEl.empty();
		this.contentEl.addClass("qbd-root");

		// Layout principal : sidebar + contenu
		const layout = this.contentEl.createDiv({ cls: "qbd-layout" });

		const navEl = layout.createDiv({ cls: "qbd-sidebar" });
		const contentEl = layout.createDiv({ cls: "qbd-content" });
		this.navEl = navEl;
		this.contentEl_ = contentEl;

		// Contexte partagé pour les sous-modules. Le littéral est COMPLET (les 5
		// sous-modules ne vivent pas sur le ctx mais sur `this`) : l'annotation
		// `: DashboardCtx` suffit, sans cast intermédiaire.
		const ctx: DashboardCtx = {
			view: this,
			app: this.app,
			plugin: this.plugin,
			scanner: this.scanner,
			statsStore: this.statsStore,
			navEl,
			contentEl,
			navigate: (view, data) => this.navigate(view, data),
			recordNav: () => this.recordNav(),
			getActiveFile: () => this.app.workspace.getActiveFile()
		};

		this.ctx = ctx;

		// Initialiser les modules
		this.nav = createNavHandlers(ctx);
		this.home = createHomeHandlers(ctx);
		this.quizzes = createQuizzesHandlers(ctx);
		this.detail = createDetailHandlers(ctx);
		this.ai = createAiHandlers(ctx);

		// ── Boutons latéraux souris (3 = précédent, 4 = suivant) : historique
		// interne du dashboard (spec 2026-07-20-mouse-nav-history). En CAPTURE
		// et sur les DEUX phases : la navigation d'onglet native d'Obsidian
		// écoute aussi ces boutons — on la neutralise DANS le dashboard,
		// l'action ne part que du mouseup. Pile vide = clic consommé sans
		// effet (comportement d'app, on ne sort jamais de la vue). Mobile :
		// aucun bouton 3/4 n'existe, listeners inertes. registerDomEvent
		// détache au unload de la vue.
		const swallowNavButtons = (e: MouseEvent, act: boolean): void => {
			if (e.button !== 3 && e.button !== 4) return;
			e.preventDefault();
			e.stopPropagation();
			if (!act) return;
			if (e.button === 3) this.goNavBack(); else this.goNavForward();
		};
		this.registerDomEvent(this.contentEl, "mousedown", (e: MouseEvent) => swallowNavButtons(e, false), { capture: true });
		this.registerDomEvent(this.contentEl, "mouseup", (e: MouseEvent) => swallowNavButtons(e, true), { capture: true });

		// Raccourcis du composer (menu « + ») : Scope de vue Obsidian —
		// actif quand la vue est focalisée, même caret dans le textarea.
		this.bindComposerHotkeys();

		// Écouter les changements du scanner. Le RAIL n'est plus re-rendu :
		// depuis le retrait du badge compteur (2026-07-21) il n'affiche rien
		// du scan, et le reconstruire couperait la transition de sa carte
		// active. Deux vues sont exclues du re-render car elles portent un
		// état d'édition LOCAL qu'un rendu détruirait : « Générer » (popover
		// d'options, dictée en cours) et la page d'un quiz — qui écrit
		// elle-même dans la note, donc réveille le scanner et se ferait
		// re-rendre sous les doigts à chaque frappe.
		if (this.scanner) {
			this._unregisterScanner = this.scanner.onChange(() => {
				if (this.currentView !== "ai" && this.currentView !== "detail") this.renderCurrentView();
			});
		}

		// Rendu initial
		this.renderSidebar();
		this.renderCurrentView();
	}

	/* (Re)bind les raccourcis du composer depuis les réglages — appelé à
	   l'ouverture ET par la SettingTab quand l'utilisateur les change (le
	   Scope existant est conservé, seuls ses handlers sont remplacés :
	   remplacer this.scope à chaud laisserait l'ancien scope poussé sur
	   le keymap tant que la vue reste active). Les touches sont CLAIMÉES
	   même hors de la vue « Générer » : dans une ItemView custom,
	   Ctrl+F/Ctrl+E natifs ne font rien — les laisser fuir déclencherait
	   un comportement Obsidian sans rapport (piège hotkey connu). */
	bindComposerHotkeys(): void {
		const scope: Scope = this.scope ?? (this.scope = new Scope(this.app.scope));
		if (this._hkHandlers) for (const h of this._hkHandlers) scope.unregister(h);
		const handlers: KeymapEventHandler[] = [];
		this._hkHandlers = handlers;
		const s = this.plugin.settings;
		const bind = (hk: Hotkey | null | undefined, action: () => void): void => {
			if (!hk || !hk.key) return;
			handlers.push(scope.register(hk.modifiers || [], hk.key, (e: KeyboardEvent) => {
				e.preventDefault();
				if (this.currentView === "ai") action();
				return false;
			}));
		};
		// `this.ai` (et ses méthodes openAddFiles/openAddNotes, requises par
		// AiHandlers) sont toujours définis quand un raccourci se déclenche :
		// bindComposerHotkeys ne tourne que sur une vue déjà passée par onOpen,
		// et le callback n'est armé que tant que la vue est focalisée. Le garde
		// défensif `if (this.ai && this.ai.openAddFiles)` d'origine était donc
		// mort — l'appel direct est iso-fonctionnel.
		bind(s.hotkeyAddFiles, () => this.ai.openAddFiles());
		bind(s.hotkeyAddNotes, () => this.ai.openAddNotes());
	}

	async onClose(): Promise<void> {
		if (this._unregisterScanner) this._unregisterScanner();
		// La page d'un quiz tient une écoute clavier posée sur le DOCUMENT et,
		// peut-être, une écriture en attente : sans cet appel elles survivaient
		// à la fermeture de la vue.
		this.detail?.dispose();
		this.ai?.dispose();
	}

	navigate(view: DashboardViewName, data?: { quiz?: QuizIndexEntry }): void {
		// Historique boutons souris : empiler l'état QUITTÉ — sauf restauration
		// (goNavBack/Forward gèrent leurs piles) et sauf navigation immobile
		// (re-clic du rail sur la page courante : rien à restaurer).
		const arriving: NavSnapshot = {
			view,
			// Jamais de drill à l'arrivée : soit resetDrilldown le referme (view
			// "quizzes"), soit il n'est pas pertinent pour la vue cible — et
			// captureNav() ne le capture de toute façon que depuis "quizzes".
			drillFolder: null,
			quiz: view === "detail" ? (data?.quiz ?? this.selectedQuiz) : null,
		};
		if (!this.isRestoringNav && !this.sameNav(this.captureNav(), arriving)) {
			this.recordNav();
		}
		if (data) {
			if (data.quiz) this.selectedQuiz = data.quiz;
		}
		// Track previous view for back navigation from detail
		if (view === "detail") {
			this.previousView = this.currentView;
		}
		// Naviguer VERS « Mes quiz » (rail, retour depuis le détail…) referme
		// tout drill-down de module : la grille est le point d'entrée attendu.
		// C'est une navigation ENTRANTE, pas un re-render interne (filtre,
		// recherche, drill) qui, lui, passe par le render() capturé du handler
		// et doit conserver le module ouvert.
		if (view === "quizzes" && this.quizzes) {
			this.quizzes.resetDrilldown();
		}
		this.currentView = view;
		// PAS de renderSidebar ici : reconstruire le rail à chaque navigation
		// remplacerait les boutons par des nœuds neufs, et la transition
		// fond/couleur de la carte active n'aurait rien à interpoler.
		// setActive bascule la classe sur les boutons existants → ça anime.
		this.nav.setActive(view);
		this.renderCurrentView();
	}

	renderSidebar(): void {
		if (!this.navEl) return;
		this.navEl.empty();
		this.nav.render(this.navEl);
	}

	renderCurrentView(): void {
		const contentEl = this.contentEl_;
		if (!contentEl) return;
		contentEl.empty();

		// Les classes d'entrée ne doivent pas survivre sur une autre page
		// (le contentEl est partagé par toutes les vues) ; le cleanup retire
		// aussi le listener d'une entrée encore en vol.
		contentEl.removeClass("qbd-quizzes-enter");
		contentEl.removeClass("qbd-home-enter");
		if (this._enterCleanup) this._enterCleanup();

		const entering = this.currentView !== this.lastPaintedView;
		this.lastPaintedView = this.currentView;

		switch (this.currentView) {
			case "home":
				this.home.render(contentEl, entering);
				break;
			case "quizzes":
				this.quizzes.render(contentEl);
				break;
			case "detail":
				if (this.selectedQuiz) {
					this.detail.render(contentEl, this.selectedQuiz);
				} else {
					this.currentView = "home";
					this.home.render(contentEl, entering);
				}
				break;
			case "ai":
				// Classe posée AVANT le render : les enfants naissent déjà
				// animés (une pose après coup manquerait la première frame).
				if (entering) this.playEnter(contentEl, "qbd-ai-enter", "qbd-ai-in");
				this.ai.render(contentEl);
				break;
			default:
				this.home.render(contentEl, entering);
		}
	}

	/* Joue une transition d'entrée puis RETIRE la classe : une CSSAnimation en
	   fill both reste propriétaire des propriétés qu'elle anime même terminée
	   (les transitions de hover ne partiraient plus), et un re-render interne
	   ultérieur ne doit pas rejouer l'entrée. Même contrat que quizzes.ts.
	   On n'attend QUE les animations d'entrée (`animName`) : la page peut
	   porter des animations INFINIES (dots du loader, glide) — les compter
	   laisserait la classe collée à vie. */
	private playEnter(el: HTMLElement, cls: string, animName: string): void {
		if (this._enterCleanup) this._enterCleanup();
		el.addClass(cls);
		const onEnd = (ev: AnimationEvent): void => {
			if (ev.animationName !== animName) return;
			const stillRunning = el.getAnimations({ subtree: true })
				.some(a => a instanceof CSSAnimation && a.animationName === animName && a.playState === "running");
			if (stillRunning) return;
			cleanup();
		};
		const cleanup = (): void => {
			el.removeClass(cls);
			el.removeEventListener("animationend", onEnd);
			this._enterCleanup = null;
		};
		this._enterCleanup = cleanup;
		el.addEventListener("animationend", onEnd);
	}
}
