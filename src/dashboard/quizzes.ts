import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { applyModuleOverrides, moduleForQuiz } from "./quiz-modules";
import { isMastered } from "./quiz-mastery";
import type { ModuleMap } from "./quiz-modules";
import { isFolderArchived } from "./folder-archive";
import { renderQuizGrid, renderModuleDrill } from "./quizzes-render";
import type { GroupingKey } from "./quizzes-render";
import { moduleAccent } from "./module-color";
import { lireModuleMap } from "./module-map-note";
import { markViewEnter } from "./view-enter";
import { DEFAULT_MODULE_ICON } from "./module-icons";

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
	/** Ouvre le dossier CONTENANT ce quiz. Sortir d'un quiz doit ramener dans
	    son dossier, pas à la racine de « Mes quiz » (demande Ahmed
	    2026-07-21) — et la correspondance chemin → dossier de module vit ici,
	    avec la note de correspondance et les overrides. */
	openFolderOfQuiz(quizPath: string): void;
}

export function createQuizzesHandlers(ctx: DashboardShellCtx): QuizzesHandlers {
	/* L'accès réel aux réglages est `ctx.settings.<clé>` (même objet que
	   `plugin.settings`, nommé — tâche 2). Lu à CHAQUE rendu : le réglage
	   peut changer sous nos pieds (autre appareil, rechargement). Le
	   réglage liste les groupes DÉPLIÉS
	   (replié = défaut) : à 200 quiz, tout déplier d'office reproduit le mur
	   qu'on cherche à éviter — cf. défaut n°1, Ahmed 2026-07-17. */
	function expandedSet(): Set<string> {
		return new Set(ctx.settings.quizzesExpandedFolders || []);
	}

	function toggleExpanded(path: string): void {
		const set = expandedSet();
		if (set.has(path)) set.delete(path); else set.add(path);
		ctx.settings.quizzesExpandedFolders = [...set];
		// Même canal que quizStats (stats-store.ts) ; l'échec d'écriture ne
		// doit pas casser le rendu.
		ctx.saveSettings().catch(() => {});
	}

	/* Axe de regroupement : DEUX axes seulement (demande Excalidraw
	   2026-07-18) — « UE » (défaut : en-têtes d'UE, cartes de module dessous)
	   et « Récent » (activité). Toute valeur historique (« module », « type »,
	   « folder »…) migre vers « ue ». */
	function currentGrouping(): GroupingKey {
		const g = ctx.settings.quizzesGrouping;
		return g === "recent" ? g : "ue";
	}

	function setGrouping(g: GroupingKey): void {
		ctx.settings.quizzesGrouping = g;
		// La bascule d'axe reconstruit toute la grille : la cascade d'entrée
		// accompagne le changement (décision Ahmed, spec 2026-07-20).
		lastPaintedView = null;
		ctx.saveSettings().catch(() => {});
	}

	/* Le conteneur du dernier rendu : sans cette référence, un clic (chevron,
	   carte, retour) ne pourrait pas re-rendre depuis un callback capturé
	   dans quizzes-render.ts. Même patron qu'ai.ts:179/215. Réassigné à
	   chaque rendu — ne JAMAIS capturer un nœud DOM d'un rendu précédent,
	   `render` fait `container.replaceChildren()`. */
	let containerRef: HTMLElement | null = null;

	/* Table module lue depuis la note de correspondance, mise en cache : la
	   lecture est ASYNC (lireModuleMap) alors que render() est synchrone.
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
		// correspondance est absente, lireModuleMap renvoie MODULE_MAP_VIDE sans
		// jamais attendre, et la branche « map vide » ci-dessous ne traverse
		// alors AUCUN await réel —
		// la fonction (jusqu'à son `if (containerRef) render(...)` final)
		// s'exécute donc de façon SYNCHRONE et RÉENTRANTE, depuis l'intérieur
		// du render() qui vient de l'appeler (juste après `void loadModuleMap()`
		// ligne ~175), avant que CE render() ait fini de construire header/
		// recherche/sélecteur/filtres/contenu. Le render() imbriqué peint une
		// copie complète ; le render() externe reprend ensuite et peint une
		// SECONDE copie par-dessus, sans container.replaceChildren() entre les
		// deux → header/recherche/sélecteur/groupe/arbre dupliqués dans le DOM.
		// Ce yield garantit que le render() déclencheur s'est entièrement
		// déroulé avant toute réentrée, quelle que soit la branche empruntée
		// plus bas.
		await Promise.resolve();
		// Le brief demandait `|| ""` : passer une chaîne vide aurait fait
		// perdre le repli sur la note « Dashboard » (DEFAULT_SETTINGS,
		// plugin.ts) que l'ancien bloc appliquait — un comportement différent
		// si le réglage est vide ou pas encore migré. `"Dashboard"` restaure
		// exactement l'ancien fallback (bug du plan, corrigé — même correctif
		// que home.ts).
		moduleMap = await lireModuleMap(ctx.settings.quizzesModuleMapNote || "Dashboard");
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
		return applyModuleOverrides(base, ctx.settings.quizzesModuleOverrides || {});
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
		container.replaceChildren();

		// Transition d'entrée (spec 2026-07-20) : classe posée SEULEMENT quand la
		// vue change — mécanisme partagé avec l'accueil (view-enter.ts).
		const viewKey = openModuleFolder ?? "root";
		const entering = viewKey !== lastPaintedView;
		lastPaintedView = viewKey;
		markViewEnter(container, entering, "qbd-quizzes-enter");

		const quizzes: QuizIndexEntry[] = ctx.scanner ? ctx.scanner.getQuizzes() : [];
		const stats: Record<string, QuizStatRecord> = ctx.statsStore ? ctx.statsStore.getAll() : {};

		// Chargement paresseux, UNE fois : la note de correspondance est lue en
		// async (lireModuleMap) alors que render() est synchrone — le premier
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
			const hero = ajouter(container, "div", "qbd-quizzes-folder-hero");
			hero.style.setProperty("--accent", openModuleAccent);
			ajouter(hero, "div", "qbd-quizzes-folder-halo");
			headerParent = ajouter(hero, "div", "qbd-quizzes-folder-hero-inner");
		}

		// ── Header ──
		// Racine : AUCUN header — le titre vit dans le rail et la pilule
		// « + New folder » sur la ligne du regroupement (demande Ahmed
		// 2026-07-20), même ligne que le chip UE/Recent.
		if (openModuleFolder !== null) {
			const header = ajouter(headerParent, "div", "qbd-quizzes-header");

			// Retour SUR LA LIGNE du titre, à sa gauche (comme la page d'un
			// quiz) : une flèche seule au-dessus du titre faisait un étage de
			// plus pour rien. Un seul bouton retour dans tout le dashboard.
			const back = ajouter(header, "button", "qbd-quizzes-crumb-back qbd-quizzes-header-back");
			back.type = "button";
			back.setAttribute("aria-label", t("dashboard.quizzes.backToModules"));
			const backIcon = ajouter(back, "span", "qbd-quizzes-crumb-icon");
			currentHost().ui.setIcon(backIcon, "arrow-left");
			back.addEventListener("click", () => {
				ctx.recordNav();
				openModuleFolder = null;
				if (containerRef) render(containerRef);
			});
			// Dans un dossier : le header EST le titre du dossier — icône + nom du
			// module, teinte à l'accent du dossier (comme sa carte). Le nom n'est
			// donc plus répété dans le fil d'Ariane (cf. quizzes-render.ts).
			// Colonne texte + soulignement dégradé (référence claude.ai) sous le nom.
			const titleBlock = ajouter(header, "div", "qbd-quizzes-title-block");
			const titleEl = ajouter(titleBlock, "h2", "qbd-quizzes-title");
			const titleIcon = ajouter(titleEl, "span", "qbd-quizzes-title-icon");
			currentHost().ui.setIcon(titleIcon, openModuleInfo?.icon || DEFAULT_MODULE_ICON);
			ajouter(titleEl, "span", "qbd-quizzes-title-text", openModuleInfo?.name || openModuleFolder);
			ajouter(titleBlock, "div", "qbd-quizzes-title-underline");

			// ── Actions du header : stats + pilule « Nouveau quiz » ── (groupées
			// pour rester alignées à droite, comme la référence).
			const headerActions = ajouter(header, "div", "qbd-quizzes-header-actions");
			const masteredCount = inModule.filter(q => isMastered(q, stats)).length;
			const statsWrap = ajouter(headerActions, "div", "qbd-quizzes-header-stats");
			const addStat = (n: number, key: TransKey, modifier?: string): void => {
				const item = ajouter(statsWrap, "div", "qbd-quizzes-header-stat");
				if (modifier) item.classList.add(modifier);
				ajouter(item, "div", "qbd-quizzes-header-stat-num", String(n));
				ajouter(item, "div", "qbd-quizzes-header-stat-label", t(key));
			};
			addStat(inModule.length, "dashboard.quizzes.statQuizzes");
			ajouter(statsWrap, "div", "qbd-quizzes-header-divider");
			addStat(masteredCount, "dashboard.card.mastered", "qbd-quizzes-header-stat--mastered");

			// Drill-down : créer un dossier ICI n'a pas de sens (demande Ahmed
			// 2026-07-19) → une seule pilule « Nouveau quiz », qui ouvre le MÊME
			// modal à trois options que « Nouveau dossier » (IA / vierge /
			// import), décliné pour le dossier OUVERT — homogénéité demandée.
			// Absente côté application (modals = tranche 2.6, D5) : le bouton
			// est alors MASQUÉ, pas grisé (Ruling 7 — un bouton d'action absent
			// ne déroute personne, contrairement au rail de navigation).
			if (ctx.createQuiz) {
				const folder = openModuleFolder;
				const newQuizBtn = ajouter(headerActions, "button", "qbd-btn--create");
				const newQuizIcon = ajouter(newQuizBtn, "span", "qbd-btn-icon");
				currentHost().ui.setIcon(newQuizIcon, "plus");
				ajouter(newQuizBtn, "span", undefined, t("dashboard.quizzes.newQuiz"));
				newQuizBtn.addEventListener("click", () => {
					ctx.createQuiz!(folder, () => { if (containerRef) render(containerRef); });
				});
			}
		}

		// ── Regroupement (UE / Récent) ──
		// Masqué en drill-down : l'axe de regroupement n'a pas de sens à
		// l'intérieur d'un module (spec Task 4). Le déclencheur affiche
		// TOUJOURS le mode courant en toutes lettres, jamais une icône seule :
		// sans ça, un utilisateur qui revient après plusieurs jours en mode
		// « Par activité » croirait à un bug plutôt qu'à un mode qu'il a choisi
		// (retour Ahmed 2026-07-17 — StudySmarter est l'inspiration, pas le contrat).
		// `&& (...)` : le conteneur n'est créé QUE s'il aura un enfant — côté
		// application (D5) ni renderGroupingSelect ni createFolder n'existent,
		// et une coquille vide hériterait quand même du margin-top 61px de
		// `.qbd-quizzes-group` (dashboard-quizzes.css), poussant la grille pour rien.
		if (openModuleFolder === null && (ctx.renderGroupingSelect || ctx.createFolder)) {
			const groupWrap = ajouter(container, "div", "qbd-quizzes-group");
			// Vrai SELECT (createSelect, ui-select.ts), pas un menu d'actions :
			// options exclusives dont une active → menu d'OPTIONS à la largeur
			// du trigger, check accent à droite, bordure accent à l'ouverture
			// (aria-expanded) — l'état « après clic » StudySmarter (annotation
			// Ahmed 2026-07-18). openActionMenu imposait son min-width 248px,
			// son icône à gauche et aucun état ouvert.
			// `createSelect` (ui-select.ts) importe encore Obsidian (D5, cf.
			// plan tranche 2.5 « ce que la tranche laisse ouvert ») : le
			// rendu passe donc par `ctx.renderGroupingSelect`, optionnel.
			// Absent côté application : l'axe déjà persisté reste actif, sans
			// bouton pour le changer (bouton MASQUÉ, Ruling 7).
			const groupSelect = ctx.renderGroupingSelect?.(groupWrap, {
				value: currentGrouping(),
				options: GROUPING_ORDER.map(g => ({ value: g, label: t(GROUPING_LABEL_KEYS[g]) })),
				onChange: (v) => { setGrouping(v as GroupingKey); render(container); }
			});
			groupSelect?.el.classList.add("qbd-quizzes-group-select");

			// « Nouveau dossier » sur la MÊME ligne que le chip UE/Recent, calé à
			// droite, même pilule que « Nouveau quiz » du drill (demande Ahmed
			// 2026-07-20 — le header racine a disparu avec lui). Absent côté
			// application (modals hors périmètre, D5) : bouton MASQUÉ (Ruling 7).
			if (ctx.createFolder) {
				const newBtn = ajouter(groupWrap, "button", "qbd-btn--create");
				const newIcon = ajouter(newBtn, "span", "qbd-btn-icon");
				currentHost().ui.setIcon(newIcon, "plus");
				ajouter(newBtn, "span", undefined, t("dashboard.quizzes.new"));
				newBtn.addEventListener("click", () => {
					ctx.createFolder!(effectiveMap(), quizzes, () => { if (containerRef) render(containerRef); });
				});
			}
		}

		// ── Contenu : grille (UE/Récent) ou drill-down d'un module ──
		const treeEl = ajouter(container, "div", "qbd-quizzes-tree");
		renderContent(treeEl, quizzes, inModule, stats);
	}

	return {
		render,
		resetDrilldown() { openModuleFolder = null; lastPaintedView = null; },
		getOpenFolder() { return openModuleFolder; },
		openFolder(folder: string) { openModule(folder); },
		openFolderOfQuiz(quizPath: string) {
			// Dossier inconnu (quiz à la racine du vault) → on reste sur la
			// grille plutôt que d'ouvrir un dossier fantôme.
			const folder = moduleForQuiz(quizPath, effectiveMap()).folder;
			if (folder) openModule(folder);
		},
	};
}
