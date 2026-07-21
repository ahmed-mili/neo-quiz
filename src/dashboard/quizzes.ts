import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { parseModuleMap, applyModuleOverrides, moduleForQuiz } from "./quiz-modules";
import { isMastered } from "./quiz-mastery";
import type { ModuleMap } from "./quiz-modules";
import { createSelect, openActionMenu } from "./ui-select";
import { isFolderArchived } from "./quiz-menu";
import { CreateFolderModal, CreateQuizModal } from "./folder-create";
import { renderQuizGrid, renderModuleDrill } from "./quizzes-render";
import type { GroupingKey } from "./quizzes-render";
import { moduleAccent } from "./module-color";
import { DEFAULT_MODULE_ICON } from "./icon-picker";

/* ══════════════════════════════════════════════════════════
   QUIZZES VIEW — Dashboard
   Contrôleur : état, réglages, header/recherche/filtres/sélecteur.
   Le PEINTRE (grille module/UE/activité/type + drill-down) vit dans
   quizzes-render.ts — extrait pour rester sous le plafond de 350
   lignes (cf. rapport Task 4).
══════════════════════════════════════════════════════════ */

export interface QuizzesHandlers {
	render(container: HTMLElement): void;
	/** Referme le drill-down d'un module (état d'interface non persisté).
	    Appelé par le dashboard quand on (re)navigue vers « Mes quiz » via le
	    rail : sans ça, entrer dans un module puis revenir par le rail rouvrirait
	    le module au lieu de la grille (le fil d'Ariane, lui, le remet déjà). */
	resetDrilldown(): void;
	/** Dossier ouvert du drill-down (null = grille) — lu par captureNav()
	    (historique boutons souris, dashboard.ts). */
	getOpenFolder(): string | null;
	/** Restauration d'historique : rouvre un dossier par le MÊME chemin de
	    code qu'un clic de carte (openModule) — le recordNav interne est
	    neutralisé par la garde isRestoringNav de la vue. */
	openFolder(folder: string): void;
}

export function createQuizzesHandlers(ctx: DashboardCtx): QuizzesHandlers {
	/* L'accès réel aux réglages est `ctx.plugin.settings.<clé>` (même patron
	   qu'ai.ts). Lu à CHAQUE rendu : le réglage peut changer sous nos pieds
	   (autre appareil, rechargement). Le réglage liste les groupes DÉPLIÉS
	   (replié = défaut) : à 200 quiz, tout déplier d'office reproduit le mur
	   qu'on cherche à éviter — cf. défaut n°1, Ahmed 2026-07-17. */
	function expandedSet(): Set<string> {
		return new Set(ctx.plugin.settings.quizzesExpandedFolders || []);
	}

	function toggleExpanded(path: string): void {
		const set = expandedSet();
		if (set.has(path)) set.delete(path); else set.add(path);
		ctx.plugin.settings.quizzesExpandedFolders = [...set];
		// Même canal que quizStats (stats-store.ts) ; l'échec d'écriture ne
		// doit pas casser le rendu.
		ctx.plugin.saveSettings().catch(() => {});
	}

	/* Axe de regroupement : DEUX axes seulement (demande Excalidraw
	   2026-07-18) — « UE » (défaut : en-têtes d'UE, cartes de module dessous)
	   et « Récent » (activité). Toute valeur historique (« module », « type »,
	   « folder »…) migre vers « ue ». */
	function currentGrouping(): GroupingKey {
		const g = ctx.plugin.settings.quizzesGrouping;
		return g === "recent" ? g : "ue";
	}

	function setGrouping(g: GroupingKey): void {
		ctx.plugin.settings.quizzesGrouping = g;
		// La bascule d'axe reconstruit toute la grille : la cascade d'entrée
		// accompagne le changement (décision Ahmed, spec 2026-07-20).
		lastPaintedView = null;
		ctx.plugin.saveSettings().catch(() => {});
	}

	/* Le conteneur du dernier rendu : sans cette référence, un clic (chevron,
	   carte, retour) ne pourrait pas re-rendre depuis un callback capturé
	   dans quizzes-render.ts. Même patron qu'ai.ts:179/215. Réassigné à
	   chaque rendu — ne JAMAIS capturer un nœud DOM d'un rendu précédent,
	   `render` fait `container.empty()`. */
	let containerRef: HTMLElement | null = null;

	/* Table module lue depuis la note de correspondance, mise en cache : la
	   lecture est ASYNC (vault.cachedRead) alors que render() est synchrone.
	   null tant que non chargée → dégradation (moduleForQuiz retombe sur le
	   dossier parent, sans UE). loadModuleMap() la peuple à l'ouverture de la
	   vue puis re-rend. */
	let moduleMap: ModuleMap | null = null;
	let moduleMapLoaded = false;
	/* Module ouvert (drill-down) : null = grille ; sinon on affiche les quiz de
	   ce module + un fil d'Ariane. État d'interface, non persisté. */
	let openModuleFolder: string | null = null;

	/* Dernière vue PEINTE ("root" ou chemin du dossier ouvert) : render() la
	   compare à la vue courante pour distinguer une ENTRÉE (navigation, drill
	   in/out, bascule d'axe — la transition d'entrée joue) d'un re-render
	   interne (renommage, archivage, icône — aucun replay). null = la
	   prochaine peinture est une entrée. */
	let lastPaintedView: string | null = null;

	async function loadModuleMap(): Promise<void> {
		moduleMapLoaded = true;
		// Cède TOUJOURS avant de poursuivre : sans ce yield, quand la note de
		// correspondance est absente, getFirstLinkpathDest renvoie null et la
		// branche « map vide » ci-dessous ne traverse alors AUCUN await réel —
		// la fonction (jusqu'à son `if (containerRef) render(...)` final)
		// s'exécute donc de façon SYNCHRONE et RÉENTRANTE, depuis l'intérieur
		// du render() qui vient de l'appeler (juste après `void loadModuleMap()`
		// ligne ~175), avant que CE render() ait fini de construire header/
		// recherche/sélecteur/filtres/contenu. Le render() imbriqué peint une
		// copie complète ; le render() externe reprend ensuite et peint une
		// SECONDE copie par-dessus, sans container.empty() entre les deux →
		// header/recherche/sélecteur/groupe/arbre dupliqués dans le DOM. Ce
		// yield garantit que le render() déclencheur s'est entièrement déroulé
		// avant toute réentrée, quelle que soit la branche empruntée plus bas.
		await Promise.resolve();
		try {
			const name = ctx.plugin.settings.quizzesModuleMapNote || "Dashboard";
			const file = ctx.app.metadataCache.getFirstLinkpathDest(name, "");
			moduleMap = file ? parseModuleMap(await ctx.app.vault.cachedRead(file)) : { byFolder: new Map(), ueOrder: [] };
		} catch {
			moduleMap = { byFolder: new Map(), ueOrder: [] };
		}
		// Le premier rendu (map absente) est repeint ici quelques ms plus
		// tard : sans ré-armement, ce second rendu couperait net la transition
		// d'entrée à peine commencée (cartes soudain opaques).
		lastPaintedView = null;
		if (containerRef) render(containerRef);
	}

	/** Map effective au rendu : la note si chargée (sinon map vide), TOUJOURS
	    recouverte par les overrides du modal « Modifier dossier » (réglages) —
	    relus à chaque rendu, ils peuvent changer sous nos pieds. */
	function effectiveMap(): ModuleMap {
		const base = moduleMap ?? { byFolder: new Map(), ueOrder: [] };
		return applyModuleOverrides(base, ctx.plugin.settings.quizzesModuleOverrides || {});
	}

	function openModule(folder: string): void {
		// Historique boutons souris : l'état quitté (grille ou autre dossier)
		// doit rester restaurable (spec 2026-07-20-mouse-nav-history).
		ctx.recordNav();
		openModuleFolder = folder;
		if (containerRef) render(containerRef);
	}

	/** Filtre de la GRILLE : exclut les quiz des DOSSIERS archivés (l'archivage
	    n'existe qu'au niveau dossier). Recherche et pilules d'état ont été
	    RETIRÉES (demande Ahmed 2026-07-18). */
	function applyFilters(quizzes: QuizIndexEntry[]): QuizIndexEntry[] {
		const map = effectiveMap();
		return quizzes.filter(q => !isFolderArchived(ctx, moduleForQuiz(q.path, map).folder));
	}

	/* Bascule entre la grille et le drill-down d'un module ouvert. `inModule`
	   (déjà filtré, PAS d'applyFilters au drill : on entre aussi dans un
	   dossier ARCHIVÉ depuis sa carte de la section « Archivés » et on y voit
	   son contenu) est calculé UNE fois par render() — mêmes quiz que les
	   stats du header. */
	function renderContent(treeEl: HTMLElement, quizzes: QuizIndexEntry[], inModule: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
		if (openModuleFolder !== null) {
			renderModuleDrill(treeEl, ctx, inModule, stats, effectiveMap(), openModuleFolder, () => { if (containerRef) render(containerRef); });
		} else {
			const map = effectiveMap();
			const archivedQuizzes = quizzes.filter(q => isFolderArchived(ctx, moduleForQuiz(q.path, map).folder));
			renderQuizGrid({
				ctx,
				isExpanded: (key) => expandedSet().has(key),
				toggleExpanded,
				rerender: () => { if (containerRef) render(containerRef); },
				openModule,
			}, treeEl, currentGrouping(), applyFilters(quizzes), stats, map, archivedQuizzes);
		}
	}

	// Ordre FIXE : « UE » (défaut) puis « Récent » — libellés SANS « By/Par »
	// (demande Excalidraw 2026-07-18 : « on ne doit voir que UE ou Recent »).
	const GROUPING_ORDER: GroupingKey[] = ["ue", "recent"];
	const GROUPING_LABEL_KEYS: Record<GroupingKey, TransKey> = {
		ue: "dashboard.quizzes.groupByUE",
		recent: "dashboard.quizzes.groupByActivity"
	};

	function render(container: HTMLElement): void {
		containerRef = container;
		container.empty();

		// Transition d'entrée (spec 2026-07-20) : classe posée SEULEMENT quand
		// la vue change. toggle(force) la retire sur un re-render interne —
		// jamais de replay, jamais de classe résiduelle.
		const viewKey = openModuleFolder ?? "root";
		const entering = viewKey !== lastPaintedView;
		lastPaintedView = viewKey;
		container.classList.toggle("qbd-quizzes-enter", entering);
		// La classe DOIT tomber une fois l'entrée jouée : une CSSAnimation en
		// fill both dont un keyframe contient `transform` reste propriétaire de
		// la propriété même finie → les transitions de transform (hover-lift des
		// cartes) ne se déclenchent plus et la surélévation saute sans animation.
		if (entering) {
			const onEnd = (ev: AnimationEvent): void => {
				if (!ev.animationName.startsWith("qbd-")) return;
				const stillRunning = container.getAnimations({ subtree: true })
					.some(a => a instanceof CSSAnimation && a.playState === "running");
				if (stillRunning) return;
				container.classList.remove("qbd-quizzes-enter");
				container.removeEventListener("animationend", onEnd);
			};
			container.addEventListener("animationend", onEnd);
		}

		const quizzes: QuizIndexEntry[] = ctx.scanner ? ctx.scanner.getQuizzes() : [];
		const stats: Record<string, QuizStatRecord> = ctx.statsStore ? ctx.statsStore.getAll() : {};

		// Chargement paresseux, UNE fois : la note de correspondance est lue en
		// async (vault.cachedRead) alors que render() est synchrone — le premier
		// rendu se fait donc sans UE/noms résolus, puis loadModuleMap() re-rend.
		if (!moduleMapLoaded) { void loadModuleMap(); }

		const map = effectiveMap();
		// Quiz du dossier ouvert : calculé UNE fois, réutilisé par les stats du
		// header ET le panneau Progrès (renderModuleDrill) — les deux comptent
		// alors exactement les mêmes quiz, jamais deux totaux qui divergent.
		const inModule: QuizIndexEntry[] = openModuleFolder !== null
			? quizzes.filter(q => moduleForQuiz(q.path, map).folder === openModuleFolder)
			: [];
		const openModuleInfo = openModuleFolder !== null ? map.byFolder.get(openModuleFolder) : undefined;
		const openModuleAccent = openModuleFolder !== null
			? moduleAccent(openModuleInfo ?? { folder: openModuleFolder })
			: null;

		// Le dossier ouvert possède sa propre bannière : le halo doit rester
		// derrière le breadcrumb et le header, sans affecter la vue racine.
		let headerParent = container;
		if (openModuleAccent !== null) {
			const hero = container.createDiv({ cls: "qbd-quizzes-folder-hero" });
			hero.style.setProperty("--accent", openModuleAccent);
			hero.createDiv({ cls: "qbd-quizzes-folder-halo" });
			headerParent = hero.createDiv({ cls: "qbd-quizzes-folder-hero-inner" });
		}

		// ── Fil d'Ariane (drill-down uniquement) — remonté AU-DESSUS du header
		// (design claude.ai, capture 2026-07-20) : « ← All quizzes » en petit,
		// le header devient le vrai titre du dossier. ──
		if (openModuleFolder !== null) {
			const crumb = headerParent.createDiv({ cls: "qbd-quizzes-breadcrumb" });
			// Flèche SEULE, sans libellé (unification des retours du dashboard,
			// demande Ahmed 2026-07-21) : le libellé nommait la destination, la
			// flèche suffit — un seul geste de retour dans toute l'app.
			const back = crumb.createEl("button", {
				cls: "qbd-quizzes-crumb-back",
				attr: { type: "button", "aria-label": t("dashboard.quizzes.backToModules") },
			});
			const backIcon = back.createSpan({ cls: "qbd-quizzes-crumb-icon" });
			setIcon(backIcon, "arrow-left");
			back.addEventListener("click", () => {
				ctx.recordNav();
				openModuleFolder = null;
				if (containerRef) render(containerRef);
			});
		}

		// ── Header ──
		// Racine : AUCUN header — le titre vit dans le rail et la pilule
		// « + New folder » sur la ligne du regroupement (demande Ahmed
		// 2026-07-20), même ligne que le chip UE/Recent.
		if (openModuleFolder !== null) {
			const header = headerParent.createDiv({ cls: "qbd-quizzes-header" });
			// Dans un dossier : le header EST le titre du dossier — icône + nom du
			// module, teinte à l'accent du dossier (comme sa carte). Le nom n'est
			// donc plus répété dans le fil d'Ariane (cf. quizzes-render.ts).
			// Colonne texte + soulignement dégradé (référence claude.ai) sous le nom.
			const titleBlock = header.createDiv({ cls: "qbd-quizzes-title-block" });
			const titleEl = titleBlock.createEl("h2", { cls: "qbd-quizzes-title" });
			const titleIcon = titleEl.createSpan({ cls: "qbd-quizzes-title-icon" });
			setIcon(titleIcon, openModuleInfo?.icon || DEFAULT_MODULE_ICON);
			titleEl.createSpan({ cls: "qbd-quizzes-title-text", text: openModuleInfo?.name || openModuleFolder });
			titleBlock.createDiv({ cls: "qbd-quizzes-title-underline" });

			// ── Actions du header : stats + pilule « Nouveau quiz » ── (groupées
			// pour rester alignées à droite, comme la référence).
			const headerActions = header.createDiv({ cls: "qbd-quizzes-header-actions" });
			const masteredCount = inModule.filter(q => isMastered(q, stats)).length;
			const statsWrap = headerActions.createDiv({ cls: "qbd-quizzes-header-stats" });
			const addStat = (n: number, key: TransKey, modifier?: string): void => {
				const item = statsWrap.createDiv({ cls: "qbd-quizzes-header-stat" });
				if (modifier) item.addClass(modifier);
				item.createDiv({ cls: "qbd-quizzes-header-stat-num", text: String(n) });
				item.createDiv({ cls: "qbd-quizzes-header-stat-label", text: t(key) });
			};
			addStat(inModule.length, "dashboard.quizzes.statQuizzes");
			statsWrap.createDiv({ cls: "qbd-quizzes-header-divider" });
			addStat(masteredCount, "dashboard.card.mastered", "qbd-quizzes-header-stat--mastered");

			// Drill-down : créer un dossier ICI n'a pas de sens (demande Ahmed
			// 2026-07-19) → une seule pilule « Nouveau quiz », qui ouvre le MÊME
			// modal à trois options que « Nouveau dossier » (IA / vierge /
			// import), décliné pour le dossier OUVERT — homogénéité demandée.
			const folder = openModuleFolder;
			const newQuizBtn = headerActions.createEl("button", { cls: "qbd-btn--create" });
			const newQuizIcon = newQuizBtn.createSpan({ cls: "qbd-btn-icon" });
			setIcon(newQuizIcon, "plus");
			newQuizBtn.createSpan({ text: t("dashboard.quizzes.newQuiz") });
			newQuizBtn.addEventListener("click", () => {
				new CreateQuizModal(ctx, folder, () => { if (containerRef) render(containerRef); }).open();
			});
		}

		// ── Regroupement (UE / Récent) ──
		// Masqué en drill-down : l'axe de regroupement n'a pas de sens à
		// l'intérieur d'un module (spec Task 4). Le déclencheur affiche
		// TOUJOURS le mode courant en toutes lettres, jamais une icône seule :
		// sans ça, un utilisateur qui revient après plusieurs jours en mode
		// « Par activité » croirait à un bug plutôt qu'à un mode qu'il a choisi
		// (retour Ahmed 2026-07-17 — StudySmarter est l'inspiration, pas le contrat).
		if (openModuleFolder === null) {
			// Vrai SELECT (createSelect), pas un menu d'actions : options
			// exclusives dont une active → menu d'OPTIONS à la largeur du
			// trigger, check accent à droite, bordure accent à l'ouverture
			// (aria-expanded) — l'état « après clic » StudySmarter
			// (annotation Ahmed 2026-07-18). openActionMenu imposait son
			// min-width 248px, son icône à gauche et aucun état ouvert.
			const groupWrap = container.createDiv({ cls: "qbd-quizzes-group" });
			const groupSelect = createSelect(groupWrap, {
				value: currentGrouping(),
				options: GROUPING_ORDER.map(g => ({ value: g, label: t(GROUPING_LABEL_KEYS[g]) })),
				onChange: (v) => { setGrouping(v as GroupingKey); render(container); }
			});
			groupSelect.el.classList.add("qbd-quizzes-group-select");

			// « Nouveau dossier » sur la MÊME ligne que le chip UE/Recent, calé à
			// droite, même pilule que « Nouveau quiz » du drill (demande Ahmed
			// 2026-07-20 — le header racine a disparu avec lui).
			const newBtn = groupWrap.createEl("button", { cls: "qbd-btn--create" });
			const newIcon = newBtn.createSpan({ cls: "qbd-btn-icon" });
			setIcon(newIcon, "plus");
			newBtn.createSpan({ text: t("dashboard.quizzes.new") });
			newBtn.addEventListener("click", () => {
				new CreateFolderModal(ctx, effectiveMap(), quizzes, () => { if (containerRef) render(containerRef); }).open();
			});
		}

		// ── Contenu : grille (UE/Récent) ou drill-down d'un module ──
		const treeEl = container.createDiv({ cls: "qbd-quizzes-tree" });
		renderContent(treeEl, quizzes, inModule, stats);
	}

	return {
		render,
		resetDrilldown() { openModuleFolder = null; lastPaintedView = null; },
		getOpenFolder() { return openModuleFolder; },
		openFolder(folder: string) { openModule(folder); },
	};
}
