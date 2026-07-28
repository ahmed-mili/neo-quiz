import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { renderQuizCard } from "./quiz-card";
import { openQuizForPlay } from "./quiz-open";
import { buildQuizCardMenu, buildModuleCardMenu } from "./quiz-menu";
import { renderModuleCard } from "./module-card";
import { moduleForQuiz, buildModuleGroups, buildUeGroups } from "./quiz-modules";
import type { ModuleMap, ModuleGroup, UeGroup } from "./quiz-modules";
import { computeQuizState } from "./quiz-mastery";
import { buildRecentModuleGroups } from "./quiz-recent";
import type { RecentGroupKey } from "./quiz-recent";
import { moduleAccent } from "./module-color";
import { renderCollapsibleSection } from "./collapsible";
import { openIconPicker } from "./icon-picker";
import { suggestIcons } from "./icon-suggest";

/* ══════════════════════════════════════════════════════════
   QUIZZES RENDER — extrait de quizzes.ts (Task 4) pour rester
   sous le plafond de 350 lignes : TOUT ce qui peint le contenu
   de « Mes quiz » (les 4 axes + le drill-down d'un module) vit
   ici. quizzes.ts reste le contrôleur : état, réglages, header/
   recherche/filtres/sélecteur, dispatch vers ce module.
══════════════════════════════════════════════════════════ */

/* Deux axes seulement depuis la demande Excalidraw 2026-07-18 (« on ne doit
   voir que UE ou Recent ») ; « module » et « type » ont été retirés. */
export type GroupingKey = "ue" | "recent";

/** Dépendances d'ÉTAT fournies par le contrôleur (réglages, recherche,
    re-rendu) — tout ce qui n'est pas pur DOM reste côté quizzes.ts. */
export interface GridDeps {
	ctx: DashboardCtx;
	isExpanded: (key: string) => boolean;
	toggleExpanded: (key: string) => void;
	rerender: () => void;
	openModule: (folder: string) => void;
}

const RECENT_GROUP_LABEL_KEYS: Record<RecentGroupKey, TransKey> = {
	"recent:7d": "dashboard.quizzes.recentWeek",
	"recent:30d": "dashboard.quizzes.recentMonth",
	"recent:older": "dashboard.quizzes.recentOlder",
};


/** Grille plate de cartes de module (mode « module » et corps d'un groupe d'UE).
    La carte affiche toujours son sous-titre UE (demande d'Ahmed : l'UE sur la
    carte façon StudySmarter, même sous un en-tête d'UE — comme StudySmarter
    garde le sous-titre d'une carte dans une section groupée). */
function renderModuleGrid(deps: GridDeps, parent: HTMLElement, groups: ModuleGroup[], map: ModuleMap, entryDelay: () => string): void {
	const grid = parent.createDiv({ cls: "qbd-module-grid" });
	const menu = buildModuleCardMenu(deps.ctx, deps.rerender, map);
	// Raccourci « changer l'icône » depuis la pastille de la carte : picker
	// portalé au body (pas de modal ici) → override + save + rerender.
	const pickIcon = (group: ModuleGroup, anchor: HTMLElement) => {
		openIconPicker(anchor, group.icon, (name) => {
			const overrides = { ...(deps.ctx.plugin.settings.quizzesModuleOverrides || {}) };
			overrides[group.folder] = { ...(overrides[group.folder] || {}), icon: name };
			deps.ctx.plugin.settings.quizzesModuleOverrides = overrides;
			deps.ctx.plugin.saveSettings().catch(() => {});
			deps.rerender();
		}, document.body, suggestIcons(group.name, group.ue));
	};
	for (const g of groups) {
		const card = renderModuleCard(grid, g, (m) => deps.openModule(m.folder), menu, pickIcon);
		card.style.setProperty("--qbd-card-delay", entryDelay());
	}
}

/* En-tête d'UE repliable + grille de cartes de module dessous. Badge = nombre
   d'éléments DIRECTS de la section (les modules), comme le compteur des
   sections « Mes dossiers » de StudySmarter. */
function renderUeGroup(deps: GridDeps, parent: HTMLElement, ue: UeGroup, map: ModuleMap, entryDelay: () => string): void {
	const body = renderCollapsibleSection(deps, parent, ue.key, ue.ue ?? t("dashboard.quizzes.noUe"), ue.modules.length, { entryDelay });
	renderModuleGrid(deps, body, ue.modules, map, entryDelay);
}

/** Contenu de la grille pour les 4 axes (pas le drill-down) : dispatch par
    mode. `filtered` est DÉJÀ passé au tamis recherche/pilule par l'appelant. */
export function renderQuizGrid(
	deps: GridDeps,
	treeEl: HTMLElement,
	mode: GroupingKey,
	filtered: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	map: ModuleMap,
	/** Quiz des DOSSIERS archivés — rendus en CARTES DE DOSSIER dans une
	    section repliable en pied de grille (jamais de cartes de quiz :
	    l'archivage n'existe qu'au niveau dossier, Ahmed 2026-07-19). */
	archivedQuizzes: QuizIndexEntry[] = []
): void {
	treeEl.empty();
	// Cascade d'ENTRÉE globale : un seul compteur traverse toutes les
	// sections (en-têtes ET cartes de dossier) — même formule que les cartes
	// du drill (quiz-card.ts). Les délais sont posés à chaque rendu mais
	// restent inertes hors .qbd-quizzes-enter (aucune animation à consommer).
	let entryIndex = 0;
	const entryDelay = (): string => `${100 + entryIndex++ * 45}ms`;
	const archivedFolders = deps.ctx.plugin.settings.quizzesArchivedFolders || [];
	if (filtered.length === 0 && archivedQuizzes.length === 0 && archivedFolders.length === 0) {
		treeEl.createDiv({ cls: "qbd-empty-state" }, el => { el.createEl("p", { text: t("dashboard.quizzes.empty") }); });
		return;
	}

	// Les deux axes affichent des cartes de MODULE (règle Ahmed 2026-07-18 :
	// « Recent » ne montre que les dossiers, jamais des quiz). Les dossiers
	// déclarés par le modal Nouveau dossier / Modifier dossier existent même
	// sans quiz (alwaysInclude) — SAUF archivés : leur carte vit uniquement
	// dans la section « Archivés » (sinon elle resterait en grille à 0 quiz).
	const alwaysInclude = Object.keys(deps.ctx.plugin.settings.quizzesModuleOverrides || {})
		.filter(f => !archivedFolders.includes(f));
	const modules = buildModuleGroups(filtered, stats, map, alwaysInclude);

	if (mode === "recent") {
		for (const g of buildRecentModuleGroups(modules, stats)) {
			const body = renderCollapsibleSection(deps, treeEl, g.key, t(RECENT_GROUP_LABEL_KEYS[g.key]), g.modules.length, { entryDelay });
			renderModuleGrid(deps, body, g.modules, map, entryDelay);
		}
	} else {
		// Axe UE (défaut) : en-tête d'UE repliable, cartes de module dessous ;
		// « Sans UE » (modules non résolus) en dernier (garanti par buildUeGroups).
		for (const ue of buildUeGroups(modules, map)) renderUeGroup(deps, treeEl, ue, map, entryDelay);
	}

	// ── Section « Archivés » en pied de grille (tous les axes) — repliée par
	// défaut, CARTES DE DOSSIER (menu ⋯ complet : Unarchive direct, drill au
	// clic). Les dossiers archivés sans quiz restent listés (alwaysInclude =
	// tous les dossiers du flag). Clé « archived: » : « : » est interdit dans
	// un chemin Obsidian, aucune collision possible.
	if (archivedQuizzes.length > 0 || archivedFolders.length > 0) {
		const archivedModules = buildModuleGroups(archivedQuizzes, stats, map, archivedFolders);
		const body = renderCollapsibleSection(deps, treeEl, "archived:", t("dashboard.quizzes.archivedSection"), archivedModules.length, { entryDelay, defaultOpen: false });
		renderModuleGrid(deps, body, archivedModules, map, entryDelay);
	}
}

/** Drill-down d'un module ouvert : grille de ses quiz + panneau « Progrès »
    (design claude.ai, capture 2026-07-20). Le fil d'Ariane et le titre vivent
    désormais dans quizzes.ts (le header EST le titre du dossier) ; `inModule`
    arrive déjà filtré par module — mêmes quiz que les stats du header
    (calculés UNE fois par render(), cf. quizzes.ts). */
export function renderModuleDrill(
	treeEl: HTMLElement,
	ctx: DashboardCtx,
	inModule: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	map: ModuleMap,
	openModuleFolder: string,
	/* Re-rendu SANS refermer le drill-down (reset de stats depuis le menu ⋯). */
	rerender: () => void
): void {
	treeEl.empty();

	if (inModule.length === 0) {
		treeEl.createDiv({ cls: "qbd-empty-state" }, el => { el.createEl("p", { text: t("dashboard.quizzes.empty") }); });
		return;
	}

	// Module ouvert : sert à l'accent des cartes (le nom est déjà porté par le
	// titre du header, quizzes.ts).
	const info = map.byFolder.get(openModuleFolder);
	const accent = moduleAccent(info ?? { folder: openModuleFolder });

	// ── Layout 2 colonnes : grille de cartes + panneau « Progrès » (repli 1
	// colonne sous une largeur seuil, cf. dashboard-quizzes.css). ──
	const layout = treeEl.createDiv({ cls: "qbd-quizzes-drill-layout" });
	layout.style.setProperty("--accent", accent);
	const grid = layout.createDiv({ cls: "qbd-home-grid qbd-quizzes-drill-grid" });
	for (const [index, quiz] of inModule.entries()) {
		renderQuizCard(grid, quiz, stats[quiz.path], (q) => ctx.navigate("detail", { quiz: q }), {
			onPlay: (q) => openQuizForPlay(ctx.app, q),
			menu: buildQuizCardMenu(ctx, rerender),
			accent,
			entryIndex: index,
		});
	}

	renderProgressPanel(layout, inModule, stats);
}

/** Donut structurel du handoff 7a : un anneau conique de 150 px et un disque
    central opaque. Le centre fait partie du donut, le pourcentage ne peut donc
    plus dériver hors du trou selon les métriques de police. */
function renderDonut(container: HTMLElement, mastered: number, review: number, total: number, centerPct: number): void {
	const masteredEnd = total > 0 ? mastered / total * 100 : 0;
	const reviewEnd = total > 0 ? (mastered + review) / total * 100 : 0;
	const donut = container.createDiv({ cls: "qbd-progress-donut" });
	donut.style.setProperty("--qbd-donut-mastered-end", `${masteredEnd}%`);
	donut.style.setProperty("--qbd-donut-review-end", `${reviewEnd}%`);
	donut.setAttribute("role", "img");
	donut.setAttribute("aria-label", `${centerPct}%`);

	const centerLabel = donut.createDiv({ cls: "qbd-progress-donut-center" });
	centerLabel.createEl("b", { cls: "qbd-progress-donut-pct", text: String(centerPct) });
	centerLabel.createSpan({ cls: "qbd-progress-donut-pct-sign", text: "%" });
}

/** Panneau « Progrès » : donut (mastered/review/à-apprendre) + légende, à
    côté de la grille du module ouvert. `inModule` = TOUS les quiz du dossier
    (pas juste ceux filtrés par une recherche) : c'est un statut du dossier
    entier. Regroupement des 4 états de computeQuizState en 3 catégories —
    "review" (quiz raté, seuil déjà atteint) reste seul (correspondance
    directe avec « à réviser ») ; "progress" (en cours, pas fini) ET "fresh"
    (jamais commencé) fusionnent dans « à apprendre » : aucun des deux n'est
    encore acquis, et le triplé de la référence ne laisse pas de 4e case. */
function renderProgressPanel(parent: HTMLElement, inModule: QuizIndexEntry[], stats: Record<string, QuizStatRecord>): void {
	const total = inModule.length;
	let masteredN = 0, reviewN = 0, learnN = 0;
	for (const quiz of inModule) {
		const { state } = computeQuizState(quiz, stats[quiz.path]);
		if (state === "mastered") masteredN++;
		else if (state === "review") reviewN++;
		else learnN++;
	}
	const pctOf = (n: number): number => total > 0 ? Math.round(n / total * 100) : 0;

	const panel = parent.createDiv({ cls: "qbd-progress-panel" });
	const head = panel.createDiv({ cls: "qbd-progress-panel-head" });
	head.createDiv({ cls: "qbd-progress-panel-title", text: t("dashboard.quizzes.progressTitle") });
	head.createDiv({ cls: "qbd-progress-panel-count", text: t("dashboard.quizzes.progressCount", { done: masteredN, total }) });

	const donutWrap = panel.createDiv({ cls: "qbd-progress-donut-wrap" });
	renderDonut(donutWrap, masteredN, reviewN, total, pctOf(masteredN));

	const legend = panel.createDiv({ cls: "qbd-progress-legend" });
	const addRow = (dotMod: string, label: string, n: number): void => {
		const row = legend.createDiv({ cls: "qbd-progress-legend-row" });
		row.createDiv({ cls: `qbd-progress-legend-dot qbd-progress-legend-dot--${dotMod}` });
		row.createDiv({ cls: "qbd-progress-legend-label", text: label });
		row.createDiv({ cls: "qbd-progress-legend-pct", text: `${pctOf(n)}%` });
	};
	addRow("mastered", t("dashboard.card.mastered"), masteredN);
	addRow("review", t("dashboard.card.review"), reviewN);
	addRow("learn", t("dashboard.quizzes.progressToLearn"), learnN);
}
