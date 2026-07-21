import { setIcon, Notice } from "obsidian";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { quizTypeLabel } from "./quiz-card";
import { openQuizForPlay, openQuizInEditor } from "./quiz-open";
import { loadQuizDraft, saveQuizDraft, questionText } from "./detail-io";
import type { QuizDraft } from "./detail-io";
import { renderQuestionView, renderQuestionEdit } from "./detail-question";
import { makeDefault } from "../editor/utils";

/* ══════════════════════════════════════════════════════════
   QUIZ PAGE — ce qu'on voit en cliquant un quiz (refonte 2026-07-21,
   contrat Excalidraw d'Ahmed).

   L'ancienne page « détail » (colonne de cartes de stats + aperçu mort
   des 5 premières questions) est remplacée par la page de travail de la
   référence : le quiz LUI-MÊME, questions à gauche, question courante à
   droite, stats compactées en haut à côté du nom.

   Un seul écran, deux modes — consultation (défaut) et édition — au lieu
   d'un aller-retour vers un éditeur en onglet. Pas de barre d'onglets,
   pas de panneau « Code » : demande explicite d'Ahmed.

   L'édition écrit dans la note (debounce) via detail-io, qui partage la
   chaîne de lecture/écriture de l'éditeur complet.
══════════════════════════════════════════════════════════ */

const SAVE_DEBOUNCE_MS = 600;

export interface DetailHandlers {
	render(container: HTMLElement, quiz: QuizIndexEntry): void;
}

export function createDetailHandlers(ctx: DashboardCtx): DetailHandlers {
	/* État de la page, gardé ENTRE deux rendus du même quiz : le dashboard
	   re-rend la vue sur des événements externes (changement de réglage), et
	   repartir à la question 1 en mode consultation à chaque fois rendrait
	   l'édition inutilisable. Remis à zéro quand on ouvre un AUTRE quiz. */
	let currentPath: string | null = null;
	let draft: QuizDraft | null = null;
	let activeIdx = 0;
	let editing = false;
	let saveTimer: number | null = null;

	function scheduleSave(): void {
		if (!draft) return;
		if (saveTimer) window.clearTimeout(saveTimer);
		saveTimer = window.setTimeout(() => {
			saveTimer = null;
			if (!draft) return;
			void saveQuizDraft(ctx.app, draft).then(ok => {
				if (!ok) new Notice(t("dashboard.quiz.saveError"));
			});
		}, SAVE_DEBOUNCE_MS);
	}

	function render(container: HTMLElement, quiz: QuizIndexEntry): void {
		container.empty();
		if (quiz.path !== currentPath) {
			currentPath = quiz.path;
			draft = null;
			activeIdx = 0;
			editing = false;
		}

		const page = container.createDiv({ cls: "qbd-qz" });
		renderHeader(page, quiz);
		renderStats(page, quiz);

		const body = page.createDiv({ cls: "qbd-qz-body" });
		const listCol = body.createDiv({ cls: "qbd-qz-list" });
		// La navigation ‹ › vit SOUS le panneau, pas dedans (référence) : la
		// carte de question garde ainsi une surface pleine, sans réserver un
		// couloir en bas.
		const main = body.createDiv({ cls: "qbd-qz-main" });
		const panel = main.createDiv({ cls: "qbd-qz-panel" });
		const nav = main.createDiv({ cls: "qbd-qz-nav" });

		if (draft) {
			paint(listCol, panel, nav, quiz);
			return;
		}

		panel.createDiv({ cls: "qbd-qz-loading", text: t("dashboard.quiz.loading") });
		void loadQuizDraft(ctx.app, quiz.path).then(result => {
			// La page a pu être quittée (ou un autre quiz ouvert) pendant la
			// lecture du fichier : ne peindre que si le DOM est encore vivant.
			if (!panel.isConnected || quiz.path !== currentPath) return;
			panel.empty();
			if (typeof result === "string") {
				// Clés énumérées, pas concaténées : t() est typé sur l'union des
				// clés du dictionnaire (une clé calculée ne compilerait pas, et
				// c'est précisément le garde-fou qui empêche les clés mortes).
				const msg = result === "fileNotFound" ? t("dashboard.detail.fileNotFound")
					: result === "noBlock" ? t("dashboard.detail.noBlock")
					: t("dashboard.detail.loadError");
				panel.createDiv({ cls: "qbd-qz-error", text: msg });
				return;
			}
			draft = result;
			activeIdx = Math.min(activeIdx, Math.max(0, draft.questions.length - 1));
			paint(listCol, panel, nav, quiz);
		});
	}

	/* ── Header : retour, nom + chemin, Modifier / Start ── */
	function renderHeader(page: HTMLElement, quiz: QuizIndexEntry): void {
		const header = page.createDiv({ cls: "qbd-qz-header" });

		const back = header.createEl("button", { cls: "qbd-btn qbd-btn--subtle qbd-qz-back" });
		setIcon(back.createSpan({ cls: "qbd-btn-icon" }), "arrow-left");
		back.addEventListener("click", () => {
			flushSave();
			ctx.navigate(ctx.view.previousView || "home");
		});

		const info = header.createDiv({ cls: "qbd-qz-headline" });
		const titleRow = info.createDiv({ cls: "qbd-qz-title-row" });
		titleRow.createEl("h2", { cls: "qbd-qz-title", text: quiz.title });
		const count = draft ? draft.questions.length : quiz.questions;
		titleRow.createSpan({ cls: "qbd-qz-count", text: String(count) });
		info.createEl("p", { cls: "qbd-qz-path", text: quiz.path });

		const actions = header.createDiv({ cls: "qbd-qz-actions" });

		// Modifier ↔ Terminé : la MÊME page bascule (référence : « Éditeur »
		// n'ouvre pas un autre écran, il change le contenu de la carte).
		const edit = actions.createEl("button", { cls: "qbd-btn qbd-btn--ghost qbd-qz-edit-btn" + (editing ? " is-on" : "") });
		setIcon(edit.createSpan({ cls: "qbd-btn-icon" }), editing ? "check" : "square-pen");
		edit.createSpan({ text: t(editing ? "dashboard.quiz.editDone" : "dashboard.detail.edit") });
		edit.addEventListener("click", () => {
			editing = !editing;
			if (!editing) flushSave();
			ctx.view.renderCurrentView();
		});

		// Pilule INVERSÉE (blanche sur thème sombre) : le même bouton que
		// « Nouveau dossier » — demande d'Ahmed « mets Start en blanc comme
		// nos autres boutons ». Jamais l'accent bleu.
		const start = actions.createEl("button", { cls: "qbd-btn--create qbd-qz-start" });
		setIcon(start.createSpan({ cls: "qbd-btn-icon" }), "play");
		start.createSpan({ text: t("dashboard.detail.play") });
		start.addEventListener("click", () => {
			flushSave();
			void openQuizForPlay(ctx.app, quiz);
		});
	}

	/* ── Stats : la colonne de cartes d'avant, compactée en une rangée ── */
	function renderStats(page: HTMLElement, quiz: QuizIndexEntry): void {
		const rec = ctx.statsStore ? ctx.statsStore.getRecord(quiz.path) : null;
		const stat: QuizStatRecord = rec || { bestScore: 0, questionsDone: 0, totalQuestions: quiz.questions, lastPlayed: 0, attempts: 0 };
		const total = stat.totalQuestions || quiz.questions;
		const pct = total > 0 ? Math.round(stat.questionsDone / total * 100) : 0;

		const row = page.createDiv({ cls: "qbd-qz-stats" });

		const prog = row.createDiv({ cls: "qbd-qz-stat qbd-qz-stat--progress" });
		prog.appendChild(createRingSVG(pct, "var(--interactive-accent)", 40, 4));
		const progText = prog.createDiv({ cls: "qbd-qz-stat-body" });
		progText.createSpan({ cls: "qbd-qz-stat-value qbd-qz-stat-pct", text: `${pct}%` });
		progText.createSpan({
			cls: "qbd-qz-stat-label",
			text: t(total === 1 ? "dashboard.common.questionsOfOne" : "dashboard.common.questionsOfOther", { done: stat.questionsDone, total }),
		});

		const cells: Array<{ label: string; value: string; accent?: string }> = [
			{
				label: t("dashboard.detail.statBest"),
				value: stat.bestScore > 0 ? `${stat.bestScore}%` : "—",
				accent: stat.bestScore >= 80 ? "var(--color-green)" : stat.bestScore >= 60 ? "var(--color-yellow)" : undefined,
			},
			{ label: t("dashboard.detail.statType"), value: quizTypeLabel(quiz.quizType) },
			{ label: t("dashboard.detail.statLast"), value: ctx.statsStore ? ctx.statsStore.formatRelativeTime(stat.lastPlayed) : "—" },
			{ label: t("dashboard.detail.statAttempts"), value: String(stat.attempts) },
		];
		for (const c of cells) {
			const cell = row.createDiv({ cls: "qbd-qz-stat" });
			const body = cell.createDiv({ cls: "qbd-qz-stat-body" });
			const v = body.createSpan({ cls: "qbd-qz-stat-value", text: c.value });
			if (c.accent) v.style.color = c.accent;
			body.createSpan({ cls: "qbd-qz-stat-label", text: c.label });
		}
	}

	/* ── Corps : liste des questions + question courante ── */
	function paint(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, quiz: QuizIndexEntry): void {
		if (!draft) return;
		paintList(listCol, panel, nav, quiz);
		paintPanel(listCol, panel, nav, quiz);
	}

	function paintList(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, quiz: QuizIndexEntry): void {
		if (!draft) return;
		listCol.empty();

		const head = listCol.createDiv({ cls: "qbd-qz-list-head" });
		head.createSpan({ cls: "qbd-qz-list-title", text: t("dashboard.quiz.questionsTitle", { n: draft.questions.length }) });
		if (editing) {
			const add = head.createEl("button", { cls: "qbd-qz-list-add", attr: { type: "button", "aria-label": t("dashboard.quiz.addQuestion") } });
			setIcon(add, "plus");
			add.addEventListener("click", () => {
				if (!draft) return;
				const q = makeDefault("single");
				// « Question N » non traduit : motif du titre auto écrit dans
				// le .md et relu par l'éditeur (cf. editor/ui.ts).
				q.title = `Question ${draft.questions.length + 1}`;
				draft.questions.push(q);
				activeIdx = draft.questions.length - 1;
				scheduleSave();
				paint(listCol, panel, nav, quiz);
			});
		}

		const items = listCol.createDiv({ cls: "qbd-qz-list-items" });
		draft.questions.forEach((q, i) => {
			const card = items.createDiv({ cls: "qbd-qz-card" + (i === activeIdx ? " is-active" : "") });
			const num = card.createSpan({ cls: "qbd-qz-card-num", text: String(i + 1) });
			num.setAttribute("aria-hidden", "true");
			const text = questionText(q);
			card.createSpan({ cls: "qbd-qz-card-text" + (text ? "" : " is-empty"), text: text || t("dashboard.quiz.promptEmpty") });
			card.addEventListener("click", () => {
				activeIdx = i;
				paint(listCol, panel, nav, quiz);
			});

			// Suppression : en édition seulement, et jamais la dernière (un
			// bloc quiz-blocks vide ne se relit pas).
			if (editing && draft && draft.questions.length > 1) {
				const del = card.createEl("button", { cls: "qbd-qz-card-del", attr: { type: "button", "aria-label": t("dashboard.quiz.deleteQuestion") } });
				setIcon(del, "trash-2");
				del.addEventListener("click", (e) => {
					e.stopPropagation();
					if (!draft) return;
					draft.questions.splice(i, 1);
					if (activeIdx >= draft.questions.length) activeIdx = draft.questions.length - 1;
					scheduleSave();
					paint(listCol, panel, nav, quiz);
				});
			}
		});
	}

	function paintPanel(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, quiz: QuizIndexEntry): void {
		if (!draft) return;
		panel.empty();
		const q = draft.questions[activeIdx];
		if (!q) {
			panel.createDiv({ cls: "qbd-qz-error", text: t("dashboard.detail.noBlock") });
			return;
		}

		const head = panel.createDiv({ cls: "qbd-qz-panel-head" });
		head.createSpan({ cls: "qbd-qz-panel-step", text: t("dashboard.quiz.questionOf", { i: activeIdx + 1, n: draft.questions.length }) });

		const content = panel.createDiv({ cls: "qbd-qz-panel-body" });
		if (editing) {
			renderQuestionEdit(content, q, {
				onChange: () => {
					scheduleSave();
					paintList(listCol, panel, nav, quiz);
				},
				// Re-peindre le PANNEAU seul : la liste vient d'être refaite par
				// onChange, et re-rendre tout volerait le focus de la frappe.
				onStructureChange: () => paintPanel(listCol, panel, nav, quiz),
				onOpenFullEditor: () => {
					flushSave();
					void openQuizInEditor(ctx.app, quiz);
				},
			});
		} else {
			renderQuestionView(content, q);
		}

		// Navigation ‹ › (référence) — masquée s'il n'y a qu'une question.
		nav.empty();
		if (draft.questions.length > 1) {
			const prev = nav.createEl("button", { cls: "qbd-qz-nav-btn", attr: { type: "button", "aria-label": t("dashboard.quiz.prev") } });
			setIcon(prev, "chevron-left");
			prev.disabled = activeIdx === 0;
			prev.addEventListener("click", () => { activeIdx--; paint(listCol, panel, nav, quiz); });

			const next = nav.createEl("button", { cls: "qbd-qz-nav-btn", attr: { type: "button", "aria-label": t("dashboard.quiz.next") } });
			setIcon(next, "chevron-right");
			next.disabled = activeIdx >= draft.questions.length - 1;
			next.addEventListener("click", () => { activeIdx++; paint(listCol, panel, nav, quiz); });
		}
	}

	/** Écrit MAINTENANT ce qui est en attente (sortie de page, lancement). */
	function flushSave(): void {
		if (!saveTimer || !draft) return;
		window.clearTimeout(saveTimer);
		saveTimer = null;
		void saveQuizDraft(ctx.app, draft);
	}

	function createRingSVG(pct: number, color: string, size: number, sw: number): SVGSVGElement {
		const r = (size - sw * 2) / 2;
		const circ = 2 * Math.PI * r;
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("width", String(size));
		svg.setAttribute("height", String(size));
		svg.style.transform = "rotate(-90deg)";
		svg.style.flexShrink = "0";

		const mk = (stroke: string, dash?: string, offset?: string): SVGCircleElement => {
			const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			c.setAttribute("cx", String(size / 2));
			c.setAttribute("cy", String(size / 2));
			c.setAttribute("r", String(r));
			c.setAttribute("fill", "none");
			c.setAttribute("stroke", stroke);
			c.setAttribute("stroke-width", String(sw));
			if (dash) c.setAttribute("stroke-dasharray", dash);
			if (offset) { c.setAttribute("stroke-dashoffset", offset); c.setAttribute("stroke-linecap", "round"); }
			return c;
		};
		svg.appendChild(mk("var(--background-modifier-border)"));
		svg.appendChild(mk(color, String(circ), String(circ * (1 - pct / 100))));
		return svg;
	}

	return { render };
}
