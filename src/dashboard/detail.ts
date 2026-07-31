import { setIcon, Notice } from "obsidian";
import type { App, Plugin } from "obsidian";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { quizTypeLabel } from "./quiz-card";
import { openQuizForPlay } from "./quiz-open";
import { TypePickerModal, ConfirmModal } from "../editor/modals";
import { closeAllSelects } from "./ui-select";
import { mathifyElement } from "../engine/mathjax";
import { loadQuizDraft, saveQuizDraft, questionText, draftIsStale } from "./detail-io";
import type { QuizDraft, QuizLoadError } from "./detail-io";
import { renderQuestionView, renderQuestionEdit } from "./detail-question";
import { renderExamPanel } from "./detail-exam";
import { mountSlideHost, setSlide, slideTo, reserveTallest, growReserve, finish as finishSlide } from "./detail-slide";
import type { SlideHost } from "./detail-slide";
import { makeDefault } from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";

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

/** Ce qu'une page « quiz » a besoin de savoir de son quiz. Un quiz du vault
    et un quiz FRAÎCHEMENT GÉNÉRÉ (encore en mémoire, sans note) s'y décrivent
    de la même façon : c'est ce qui permet à la page « Générer » d'afficher la
    page de travail complète au lieu d'un éditeur à part. */
export interface QuizPageSpec {
	/** Identité de la page : changer de clé remet son état à zéro. */
	key: string;
	title: string;
	/** Ligne sous le titre (chemin de la note). Vide → ligne masquée. */
	subtitle: string;
	/** Compte ANNONCÉ, le temps du chargement (badge du header). */
	questionCount: number;
	load(): Promise<QuizDraft | QuizLoadError>;
	/** Écrit les modifications. Absent : quiz en mémoire, rien à persister. */
	save?(draft: QuizDraft): Promise<boolean>;
	/** Entrée du scanner, pour la rangée de stats. Absente : pas de rangée —
	    un quiz qui n'existe pas encore n'a ni score ni tentative. */
	stats?: QuizIndexEntry;
	/** Flèche retour : le SEUL chemin de sortie de la page. */
	onBack(): void;
	/** Bouton principal à droite. Absent → masqué. Reçoit son propre élément :
	    un menu flottant doit s'ancrer au bouton cliqué, pas à la page. */
	start?: { label: string; icon: string; onClick(el: HTMLElement): void };
	/** Actions supplémentaires, posées avant le bouton principal. */
	actions?: Array<{ label: string; icon: string; onClick(el: HTMLElement): void }>;
	/** Vrai quand la page n'est plus celle qu'on regarde (vue changée) : les
	    flèches ← → cessent alors de lui répondre. */
	isStale?(): boolean;
	/** Ouvrir d'emblée en ÉDITION. Pour un quiz qu'on vient de créer : sa
	    question est vierge, la relire n'apprendrait rien. Ne vaut qu'à la
	    PREMIÈRE ouverture de cette clé — ensuite l'utilisateur décide. */
	startEditing?: boolean;
}

/** Dépendances d'une page « quiz », indépendantes du dashboard. */
export interface QuizPageDeps {
	app: App;
	plugin: Plugin;
	statsStore?: DashboardCtx["statsStore"];
}

export interface QuizPageHandlers {
	render(container: HTMLElement, spec: QuizPageSpec): void;
	/** Écrit sur-le-champ ce qui est en attente (sortie de vue, fermeture). */
	flush(): void;
	/** Écrit, puis rend TOUT ce que la page tient au système : écoute clavier
	    posée sur le document, glissement en vol, brouillon. Sans cet appel à
	    la fermeture de la vue, le listener ne se détachait qu'au prochain
	    appui de touche — et retenait d'ici là le DOM et le brouillon. */
	dispose(): void;
}

export interface DetailHandlers {
	render(container: HTMLElement, quiz: QuizIndexEntry): void;
	/** Relayé à la page : appelé à la fermeture de la vue dashboard. */
	dispose(): void;
}

/* ── La page « quiz » du dashboard : UNE instance, sur un quiz du vault. La
   page « Générer » en crée une autre, sur son quiz en mémoire — d'où la
   séparation entre createQuizPage (le composant) et ce wrapper (la vue). ── */
export function createDetailHandlers(ctx: DashboardCtx): DetailHandlers {
	const page = createQuizPage({ app: ctx.app, plugin: ctx.plugin, statsStore: ctx.statsStore });

	return {
		render(container: HTMLElement, quiz: QuizIndexEntry): void {
			// La cible du retour est fixée à l'ARRIVÉE sur la page : lue au clic,
			// elle aurait déjà été écrasée par une navigation intermédiaire.
			const target = ctx.view.previousView || "home";
			page.render(container, {
				key: quiz.path,
				title: quiz.title,
				subtitle: quiz.path,
				questionCount: quiz.questions,
				stats: quiz,
				load: () => loadQuizDraft(ctx.app, quiz.path),
				save: (draft) => saveQuizDraft(ctx.app, draft),
				onBack: () => {
					ctx.navigate(target);
					// Retour vers « Mes quiz » : on rouvre le DOSSIER du quiz, pas
					// la grille racine — sortir d'un quiz doit rendre à son
					// contexte (demande Ahmed 2026-07-21). navigate() vient de
					// refermer le drill (resetDrilldown), d'où la réouverture.
					if (target === "quizzes") ctx.view.quizzes?.openFolderOfQuiz(quiz.path);
				},
				start: {
					label: t("dashboard.detail.play"),
					icon: "play",
					onClick: () => void openQuizForPlay(ctx.app, quiz),
				},
				isStale: () => ctx.view.currentView !== "detail",
			});
		},
		dispose: () => page.dispose(),
	};
}

export function createQuizPage(ctx: QuizPageDeps): QuizPageHandlers {
	/* Spécification et conteneur du DERNIER rendu : la page se repeint
	   elle-même (bascule du mode édition) sans passer par son hôte — c'est
	   ce qui rend la transition possible et ce qui la rend réutilisable. */
	let currentSpec: QuizPageSpec | null = null;
	let currentContainer: HTMLElement | null = null;
	/* État de la page, gardé ENTRE deux rendus du même quiz : le dashboard
	   re-rend la vue sur des événements externes (changement de réglage), et
	   repartir à la question 1 en mode consultation à chaque fois rendrait
	   l'édition inutilisable. Remis à zéro quand on ouvre un AUTRE quiz. */
	let currentPath: string | null = null;
	let draft: QuizDraft | null = null;
	let activeIdx = 0;
	let editing = false;
	let saveTimer: number | null = null;
	/** Brouillon FIGÉ dont l'écriture est en attente, et sa fonction d'écriture
	    — pour que le débounce n'aille pas viser le quiz suivant. */
	let pendingSave: { draft: QuizDraft; save: (d: QuizDraft) => Promise<boolean> } | null = null;
	/** Piste du carrousel du panneau — recréée à chaque paintPanel. */
	let slideHost: SlideHost | null = null;
	/** Badge du header : le compte ANNONCÉ (spec) devient le compte RÉEL dès
	    que le brouillon est lu — un onglet qui ne connaît pas son quiz à
	    l'avance affichait « 0 » jusqu'au premier repaint. */
	let countEl: HTMLElement | null = null;
	/** Détache l'écoute clavier de la page précédente. */
	let keyCleanup: (() => void) | null = null;

	function scheduleSave(): void {
		// Pas de `save` : le quiz n'existe qu'en mémoire (résultat d'une
		// génération). Ses retouches vivent dans le brouillon jusqu'à
		// l'insertion dans une note — il n'y a rien à écrire d'ici là.
		if (!draft || !currentSpec?.save) return;
		if (saveTimer) window.clearTimeout(saveTimer);
		/* Le brouillon et son écrivain sont FIGÉS ici, pas relus à l'échéance :
		   ouvrir un autre quiz pendant les 600 ms remplaçait `draft` et
		   `currentSpec`, et la frappe du premier partait alors dans le second —
		   ou nulle part. */
		const pending = draft;
		const save = currentSpec.save;
		saveTimer = window.setTimeout(() => {
			saveTimer = null;
			pendingSave = null;
			void save(pending).then(ok => {
				if (!ok) new Notice(t("dashboard.quiz.saveError"));
			});
		}, SAVE_DEBOUNCE_MS);
		pendingSave = { draft: pending, save };
	}

	/** Repeint la page telle qu'elle est — sans repasser par l'hôte, qui
	    reconstruirait toute la vue (et, sur la page « Générer », le composer). */
	function repaint(): void {
		if (currentContainer && currentSpec) render(currentContainer, currentSpec);
	}

	function render(container: HTMLElement, spec: QuizPageSpec): void {
		// Un glissement encore en vol vise des nœuds que container.empty() va
		// détruire : le terminer d'abord évite un timer orphelin qui écrirait
		// dans un DOM mort.
		if (slideHost) { finishSlide(slideHost); slideHost = null; }
		// Un menu portalé au <body> survivrait à la destruction de son ancre :
		// il resterait ouvert au-dessus d'une page qui n'existe plus.
		closeAllSelects();
		container.empty();
		currentContainer = container;
		currentSpec = spec;
		if (spec.key !== currentPath) {
			// Le quiz précédent part MAINTENANT : sans ça, ouvrir un autre quiz
			// dans les 600 ms du débounce perdait la dernière frappe.
			flushSave();
			currentPath = spec.key;
			draft = null;
			activeIdx = 0;
			editing = !!spec.startEditing;
		} else if (draft && draftIsStale(draft)) {
			// La note a changé DEHORS (éditeur markdown, synchro) pendant que la
			// page gardait son brouillon : le relire, sinon la frappe suivante
			// réécrirait par-dessus la modification externe.
			flushSave();
			draft = null;
		}

		const page = container.createDiv({ cls: "qbd-qz" });
		renderHeader(page, spec);
		renderStats(page, spec);

		const body = page.createDiv({ cls: "qbd-qz-body" });
		const listCol = body.createDiv({ cls: "qbd-qz-list" });
		// La navigation ‹ › vit SOUS le panneau, pas dedans (référence) : la
		// carte de question garde ainsi une surface pleine, sans réserver un
		// couloir en bas.
		const main = body.createDiv({ cls: "qbd-qz-main" });
		const panel = main.createDiv({ cls: "qbd-qz-panel" });
		const nav = main.createDiv({ cls: "qbd-qz-nav" });

		bindArrowKeys(page, listCol, panel, nav, spec);

		if (draft) {
			paint(listCol, panel, nav, spec);
			return;
		}

		panel.createDiv({ cls: "qbd-qz-loading", text: t("dashboard.quiz.loading") });
		void spec.load().then(result => {
			// La page a pu être quittée (ou un autre quiz ouvert) pendant la
			// lecture du fichier : ne peindre que si le DOM est encore vivant.
			if (!panel.isConnected || spec.key !== currentPath) return;
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
			if (countEl) countEl.textContent = String(draft.questions.length);
			paint(listCol, panel, nav, spec);
		});
	}

	/* ── Header : fil d'Ariane, nom + chemin, Editor / Start ── */
	function renderHeader(page: HTMLElement, spec: QuizPageSpec): void {
		const header = page.createDiv({ cls: "qbd-qz-header" });

		// Flèche SUR LA LIGNE du titre, à sa gauche (capture StudySmarter
		// 2026-07-21) — pas au-dessus. Mêmes classes que le retour du
		// drill-down : un seul bouton retour dans tout le dashboard.
		const back = header.createEl("button", {
			cls: "qbd-quizzes-crumb-back qbd-qz-back",
			attr: { type: "button", "aria-label": t("dashboard.quiz.back") },
		});
		const backIcon = back.createSpan({ cls: "qbd-quizzes-crumb-icon" });
		setIcon(backIcon, "arrow-left");
		back.addEventListener("click", () => {
			flushSave();
			spec.onBack();
		});

		const info = header.createDiv({ cls: "qbd-qz-headline" });
		const titleRow = info.createDiv({ cls: "qbd-qz-title-row" });
		titleRow.createEl("h2", { cls: "qbd-qz-title", text: spec.title });
		const count = draft ? draft.questions.length : spec.questionCount;
		countEl = titleRow.createSpan({ cls: "qbd-qz-count", text: String(count) });
		if (spec.subtitle) info.createEl("p", { cls: "qbd-qz-path", text: spec.subtitle });

		const actions = header.createDiv({ cls: "qbd-qz-actions" });

		// Modifier ↔ Terminé : la MÊME page bascule (référence : « Éditeur »
		// n'ouvre pas un autre écran, il change le contenu de la carte).
		const edit = actions.createEl("button", { cls: "qbd-btn qbd-btn--ghost qbd-qz-edit-btn" + (editing ? " is-on" : "") });
		setIcon(edit.createSpan({ cls: "qbd-btn-icon" }), editing ? "check" : "square-pen");
		// « Editor » (et non « Edit ») : le bouton ouvre un MODE, il ne
		// déclenche pas une action — demande d'Ahmed 2026-07-21.
		edit.createSpan({ text: t(editing ? "dashboard.quiz.editDone" : "dashboard.quiz.editor") });
		edit.addEventListener("click", () => toggleEditing(page));

		for (const action of spec.actions || []) {
			const btn = actions.createEl("button", { cls: "qbd-btn qbd-btn--ghost" });
			setIcon(btn.createSpan({ cls: "qbd-btn-icon" }), action.icon);
			btn.createSpan({ text: action.label });
			btn.addEventListener("click", () => {
				flushSave();
				action.onClick(btn);
			});
		}

		// Pilule INVERSÉE (blanche sur thème sombre) : le même bouton que
		// « Nouveau dossier » — demande d'Ahmed « mets Start en blanc comme
		// nos autres boutons ». Jamais l'accent bleu.
		const startSpec = spec.start;
		if (startSpec) {
			const start = actions.createEl("button", { cls: "qbd-btn--create qbd-qz-start" });
			setIcon(start.createSpan({ cls: "qbd-btn-icon" }), startSpec.icon);
			start.createSpan({ text: startSpec.label });
			start.addEventListener("click", () => {
				flushSave();
				startSpec.onClick(start);
			});
		}
	}

	/** Bascule consultation ⇄ édition AVEC transition : le corps s'estompe et
	    glisse légèrement, puis la page se repeint dans l'autre mode et entre.
	    Sans ce délai, la bascule est un saut sec — et c'est le bouton sur
	    lequel on revient le plus souvent. */
	function toggleEditing(page: HTMLElement): void {
		editing = !editing;
		if (!editing) flushSave();

		const body = page.querySelector(".qbd-qz-body");
		if (!body || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
			repaint();
			return;
		}

		body.classList.add("qbd-qz-body--leaving");
		// La sortie est plus courte que l'entrée : la page repeinte doit
		// arriver, pas se faire attendre.
		const target = currentSpec;
		window.setTimeout(() => {
			// La page a pu être quittée pendant ces 130 ms : le conteneur est
			// PARTAGÉ par toutes les vues du dashboard, et repeindre ici
			// écraserait la destination avec l'ancien quiz.
			if (!page.isConnected || currentSpec !== target) return;
			repaint();
			currentContainer?.querySelector(".qbd-qz-body")?.classList.add("qbd-qz-body--entering");
		}, 130);
	}

	/* ── Stats : la colonne de cartes d'avant, compactée en une rangée ──
	   Absente pour un quiz qui n'existe pas encore (résultat d'une
	   génération) : ni score, ni tentative, ni date — quatre cases vides. */
	function renderStats(page: HTMLElement, spec: QuizPageSpec): void {
		const quiz = spec.stats;
		if (!quiz) return;
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

		// Jamais joué : « Best score » et « Last played » n'auraient qu'un tiret
		// à montrer — deux cases vides qui n'apprennent rien (demande d'Ahmed
		// 2026-07-21). Elles apparaissent à la première tentative, avec le
		// compteur de tentatives qui, lui, n'a de sens qu'à partir de 1.
		const played = stat.attempts > 0;
		const cells: Array<{ label: string; value: string; accent?: string }> = [
			{ label: t("dashboard.detail.statType"), value: quizTypeLabel(quiz.quizType) },
		];
		if (played) {
			cells.unshift({
				label: t("dashboard.detail.statBest"),
				value: stat.bestScore > 0 ? `${stat.bestScore}%` : "—",
				accent: stat.bestScore >= 80 ? "var(--color-green)" : stat.bestScore >= 60 ? "var(--color-yellow)" : undefined,
			});
			cells.push(
				{ label: t("dashboard.detail.statLast"), value: ctx.statsStore ? ctx.statsStore.formatRelativeTime(stat.lastPlayed) : "—" },
				{ label: t("dashboard.detail.statAttempts"), value: String(stat.attempts) },
			);
		}
		for (const c of cells) {
			const cell = row.createDiv({ cls: "qbd-qz-stat" });
			const body = cell.createDiv({ cls: "qbd-qz-stat-body" });
			const v = body.createSpan({ cls: "qbd-qz-stat-value", text: c.value });
			if (c.accent) v.style.color = c.accent;
			body.createSpan({ cls: "qbd-qz-stat-label", text: c.label });
		}
	}

	/* ── Corps : liste des questions + question courante ── */
	function paint(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		if (!draft) return;
		paintList(listCol, panel, nav, spec);
		paintPanel(listCol, panel, nav, spec);
	}

	/** Change de question EN GLISSANT (carrousel du moteur), puis repeint la
	    liste et la navigation. `activeIdx` bouge ici et nulle part ailleurs :
	    la direction du glissement se déduit de l'écart. */
	function goToQuestion(target: number, listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		if (!draft || !slideHost) return;
		const clamped = Math.max(0, Math.min(target, draft.questions.length - 1));
		if (clamped === activeIdx) return;
		const dir: 1 | -1 = clamped > activeIdx ? 1 : -1;
		const hops = Math.abs(clamped - activeIdx);
		activeIdx = clamped;
		const q = draft.questions[activeIdx];
		slideTo(slideHost, (slide) => fillSlide(slide, q, activeIdx, listCol, panel, nav, spec), dir, hops);
		paintList(listCol, panel, nav, spec);
		paintNav(listCol, panel, nav, spec);
	}

	function paintList(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		if (!draft) return;
		listCol.empty();

		const head = listCol.createDiv({ cls: "qbd-qz-list-head" });
		head.createSpan({ cls: "qbd-qz-list-title", text: t("dashboard.quiz.questionsTitle", { n: draft.questions.length }) });
		if (editing) {
			const add = head.createEl("button", { cls: "qbd-qz-list-add", attr: { type: "button", "aria-label": t("dashboard.quiz.addQuestion") } });
			setIcon(add, "plus");
			// Le TYPE se choisit à la création, comme dans l'éditeur : une
			// question ajoutée d'office en « choix unique » puis reconvertie
			// perdrait ses réponses au passage.
			add.addEventListener("click", () => {
				new TypePickerModal(ctx.app, (key) => {
					if (!draft) return;
					const q = makeDefault(key);
					// « Question N » non traduit : motif du titre auto écrit dans
					// le .md et relu par l'éditeur (cf. editor/ui.ts).
					q.title = `Question ${draft.questions.length + 1}`;
					draft.questions.push(q);
					activeIdx = draft.questions.length - 1;
					// Le mode ÉDITION s'ouvre avec la question : on vient de la
					// créer vide, la relire n'apprendrait rien.
					editing = true;
					scheduleSave();
					repaint();
				}).open();
			});
		}

		const items = listCol.createDiv({ cls: "qbd-qz-list-items" });
		draft.questions.forEach((q, i) => {
			const card = items.createDiv({ cls: "qbd-qz-card" + (i === activeIdx ? " is-active" : "") });
			const num = card.createSpan({ cls: "qbd-qz-card-num", text: String(i + 1) });
			num.setAttribute("aria-hidden", "true");
			const text = questionText(q);
			const label = card.createSpan({ cls: "qbd-qz-card-text" + (text ? "" : " is-empty"), text: text || t("dashboard.quiz.promptEmpty") });
			// LaTeX $…$ de la vignette : rendu comme dans la liste de l'éditeur
			// (qui le faisait déjà). Sans ça, une question de maths s'y lisait
			// avec ses dollars bruts.
			if (text.includes("$")) void mathifyElement(label);
			card.addEventListener("click", () => goToQuestion(i, listCol, panel, nav, spec));

			if (!editing || !draft) return;

			const acts = card.createDiv({ cls: "qbd-qz-card-acts" });

			// Réordonnancement : l'ordre des questions EST le déroulé du quiz.
			// Les flèches restent visibles (grisées) aux extrémités plutôt que
			// de disparaître — une rangée d'actions qui change de largeur d'une
			// carte à l'autre fait sautiller la liste.
			const move = (dir: -1 | 1, icon: string, aria: string): void => {
				const btn = acts.createEl("button", { cls: "qbd-qz-card-act", attr: { type: "button", "aria-label": aria } });
				setIcon(btn, icon);
				const target = i + dir;
				btn.disabled = target < 0 || target >= draft!.questions.length;
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					if (!draft || btn.disabled) return;
					const qs = draft.questions;
					[qs[i], qs[target]] = [qs[target], qs[i]];
					renumberAuto(qs);
					if (activeIdx === i) activeIdx = target;
					else if (activeIdx === target) activeIdx = i;
					scheduleSave();
					paint(listCol, panel, nav, spec);
				});
			};
			move(-1, "chevron-up", t("dashboard.quiz.moveUp"));
			move(1, "chevron-down", t("dashboard.quiz.moveDown"));

			// Suppression : jamais la dernière (un bloc quiz-blocks vide ne se
			// relit pas).
			if (draft.questions.length > 1) {
				const del = acts.createEl("button", { cls: "qbd-qz-card-act qbd-qz-card-del", attr: { type: "button", "aria-label": t("dashboard.quiz.deleteQuestion") } });
				setIcon(del, "trash-2");
				del.addEventListener("click", (e) => {
					e.stopPropagation();
					if (!draft) return;
					const title = q.title || `Question ${i + 1}`;
					// Confirmation, comme dans l'éditeur : la croix est révélée au
					// survol, l'écriture dans la note est immédiate, et rien ne
					// rattrape une question supprimée par erreur.
					new ConfirmModal(ctx.app,
						t("editor.delete.title", { title }),
						t("editor.delete.message"),
						t("editor.action.delete"),
						t("editor.action.cancel"),
						(confirmed) => {
							if (!confirmed || !draft) return;
							draft.questions.splice(i, 1);
							// L'index actif suit la LISTE : supprimer une question
							// AVANT la courante la faisait sauter à la suivante.
							if (activeIdx > i) activeIdx--;
							else if (activeIdx === i) activeIdx = Math.min(i, draft.questions.length - 1);
							renumberAuto(draft.questions);
							scheduleSave();
							paint(listCol, panel, nav, spec);
						},
					).open();
				});
			}
		});

		// ── Mode du quiz (édition seulement) ──
		if (!editing) return;
		renderExamPanel(listCol, {
			get: () => draft?.examOptions ?? null,
			set: (value) => { if (draft) draft.examOptions = value; },
			onChange: () => scheduleSave(),
			onStructureChange: () => paintList(listCol, panel, nav, spec),
		});
	}

	/** Met à jour le texte des vignettes sans toucher au reste de la colonne. */
	function refreshListLabels(listCol: HTMLElement): void {
		if (!draft) return;
		const labels = listCol.querySelectorAll<HTMLElement>(".qbd-qz-card-text");
		draft.questions.forEach((q, i) => {
			const el = labels[i];
			if (!el) return;
			const text = questionText(q);
			el.textContent = text || t("dashboard.quiz.promptEmpty");
			el.classList.toggle("is-empty", !text);
			if (text.includes("$")) void mathifyElement(el);
		});
	}

	/** Contenu d'UNE slide : la question, en consultation ou en édition.
	    `index` est celui de la question rendue (pas forcément la courante :
	    la passe de mesure les rend toutes). */
	function fillSlide(slide: HTMLElement, q: DraftQuestion, index: number, listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		// Pas de bandeau « Question i / n » : le rendu réel affiche déjà le
		// TITRE de la question (h2 du moteur) — deux titres l'un sur l'autre.
		const content = slide.createDiv({ cls: "qbd-qz-panel-body" });
		if (editing) {
			renderQuestionEdit(content, q, {
				app: ctx.app,
				plugin: ctx.plugin,
				onChange: () => {
					scheduleSave();
					// Rafraîchir les LIBELLÉS, pas reconstruire la liste : à chaque
					// frappe on détruisait sinon les cartes (et le bloc « Mode du
					// quiz », son sélecteur compris) sous le curseur de
					// l'utilisateur, pour n'en changer qu'une ligne de texte.
					refreshListLabels(listCol);
					// Une réponse plus longue peut dépasser la réserve : on
					// l'étend, jamais on ne la réduit (les chevrons ne doivent
					// pas remonter pendant la frappe).
					if (slideHost) growReserve(slideHost, availableHeight(panel));
				},
				// Re-peindre le PANNEAU seul : la liste vient d'être refaite par
				// onChange, et re-rendre tout volerait le focus de la frappe.
				onStructureChange: () => paintPanel(listCol, panel, nav, spec),
			});
		} else {
			renderQuestionView(content, q, ctx.app, index);
		}
	}

	/* ── Flèches ← / → : passer d'une question à l'autre ──
	   Écoute posée sur le DOCUMENT (une page sans focus ne reçoit aucune
	   touche), mais strictement gardée : seulement sur la page d'un quiz,
	   jamais quand la frappe va dans un champ (l'édition d'une réponse a
	   besoin de ses propres flèches), et jamais avec un modificateur (les
	   raccourcis d'Obsidian gardent la priorité). Le premier événement reçu
	   après la mort du DOM se détache tout seul : la page n'a pas de hook de
	   démontage à qui confier ce nettoyage. */
	function bindArrowKeys(page: HTMLElement, listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		if (keyCleanup) keyCleanup();
		const doc = page.ownerDocument;
		const onKey = (e: KeyboardEvent): void => {
			if (!page.isConnected) { detach(); return; }
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
			if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
			// Page HORS ÉCRAN (onglet en arrière-plan, autre vue du dashboard) :
			// son DOM existe encore et son écoute est toujours posée sur le
			// document. Sans ce garde, une flèche pressée ailleurs faisait aussi
			// naviguer les pages invisibles — trois hôtes, trois écoutes.
			if (!page.offsetParent && page.style.display !== "contents") return;
			/* Deux pages VISIBLES à la fois (vue partagée) avancent ensemble.
			   Le garde évident — n'accepter que le leaf `mod-active` — a été
			   essayé puis retiré : Obsidian ne pose cette classe qu'au leaf
			   FOCALISÉ, et regarder une page sans y avoir cliqué (on vient de
			   l'explorateur de fichiers) suffisait à ce que les flèches ne
			   répondent plus du tout. Casser le cas courant pour réparer le cas
			   rare n'en vaut pas la peine. */
			if (spec.isStale?.()) return;
			// `instanceof Element` et non un cast : la cible d'un keydown remonté
			// au document peut être le Document lui-même, qui n'a pas closest().
			const target = e.target;
			if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
			e.preventDefault();
			goToQuestion(activeIdx + (e.key === "ArrowRight" ? 1 : -1), listCol, panel, nav, spec);
		};
		const detach = (): void => {
			doc.removeEventListener("keydown", onKey);
			if (keyCleanup === detach) keyCleanup = null;
		};
		doc.addEventListener("keydown", onKey);
		keyCleanup = detach;
	}

	/** Place réellement disponible pour la question, chevrons compris : la
	    réserve ne doit jamais les pousser hors de l'écran. */
	function availableHeight(panel: HTMLElement): number {
		const main = panel.parentElement;
		if (!main) return 0;
		// 40px de chevrons + 10px de gouttière + 8px de padding du panneau.
		return Math.max(0, main.clientHeight - 58);
	}

	function paintPanel(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		if (!draft) return;
		// Un glissement en vol tient un timer et un listener `transitionend` sur
		// une piste que `panel.empty()` va détacher : le conclure d'abord, sinon
		// ils survivent jusqu'à leur échéance en visant un DOM mort.
		if (slideHost) finishSlide(slideHost);
		panel.empty();
		slideHost = null;
		const q = draft.questions[activeIdx];
		if (!q) {
			panel.createDiv({ cls: "qbd-qz-error", text: t("dashboard.detail.noBlock") });
			return;
		}

		// Le panneau est une piste de carrousel : le changement de question y
		// glisse comme dans le quiz (detail-slide.ts).
		slideHost = mountSlideHost(panel);
		setSlide(slideHost, (slide) => fillSlide(slide, q, activeIdx, listCol, panel, nav, spec));
		paintNav(listCol, panel, nav, spec);

		/* Les chevrons se posent à la hauteur de la question la PLUS HAUTE du
		   quiz, une fois pour toutes : ils ne bougent plus d'une question à
		   l'autre. Mesuré ici (pas à chaque navigation).

		   En ÉDITION, non : la mesure rendrait le FORMULAIRE COMPLET de chaque
		   question du quiz — trente formulaires pour en afficher un. Et la
		   réserve n'y sert à rien, le panneau ayant son propre ascenseur. */
		if (editing) return;
		const questions = draft.questions;
		reserveTallest(
			slideHost,
			questions.map((qq, i) => (slide: HTMLElement) => fillSlide(slide, qq, i, listCol, panel, nav, spec)),
			availableHeight(panel),
		);
	}

	/** Navigation ‹ › — deux cercles nus, comme StudySmarter : aucun compteur
	    entre eux (la position se lit dans la liste de gauche). Repeinte seule
	    à chaque glissement, pour que l'état désactivé suive sans reconstruire
	    la question. */
	function paintNav(listCol: HTMLElement, panel: HTMLElement, nav: HTMLElement, spec: QuizPageSpec): void {
		nav.empty();
		if (!draft || draft.questions.length <= 1) return;

		const prev = nav.createEl("button", { cls: "qbd-qz-nav-btn", attr: { type: "button", "aria-label": t("dashboard.quiz.prev") } });
		setIcon(prev, "chevron-left");
		prev.disabled = activeIdx === 0;
		prev.addEventListener("click", () => goToQuestion(activeIdx - 1, listCol, panel, nav, spec));

		const next = nav.createEl("button", { cls: "qbd-qz-nav-btn", attr: { type: "button", "aria-label": t("dashboard.quiz.next") } });
		setIcon(next, "chevron-right");
		next.disabled = activeIdx >= draft.questions.length - 1;
		next.addEventListener("click", () => goToQuestion(activeIdx + 1, listCol, panel, nav, spec));
	}

	/** Écrit MAINTENANT ce qui est en attente (sortie de page, lancement,
	    ouverture d'un autre quiz). Vise le brouillon FIGÉ au moment de la
	    frappe, jamais celui affiché à cet instant. */
	function flushSave(): void {
		if (!saveTimer || !pendingSave) return;
		window.clearTimeout(saveTimer);
		saveTimer = null;
		const { draft: pending, save } = pendingSave;
		pendingSave = null;
		// Même alerte que le chemin débouncé : une écriture ratée au moment où
		// l'on QUITTE la page est précisément celle qu'il faut signaler.
		void save(pending).then(ok => {
			if (!ok) new Notice(t("dashboard.quiz.saveError"));
		});
	}

	/** Les titres AUTOMATIQUES suivent l'ordre de la liste ; ceux que l'auteur
	    a écrits ne bougent jamais (même règle que l'éditeur). Appelé après
	    tout déplacement ET toute suppression — sans quoi supprimer « Question
	    2 » laissait « Question 1, Question 3… » dans la note. */
	function renumberAuto(questions: DraftQuestion[]): void {
		questions.forEach((qq, idx) => {
			if (!qq._userModifiedTitle && /^Question \d+$/.test(qq.title || "")) qq.title = `Question ${idx + 1}`;
		});
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

	function dispose(): void {
		flushSave();
		// Un menu portalé au <body> n'est pas dans le conteneur de la page : sans
		// ça il resterait affiché par-dessus Obsidian, écoutes comprises.
		closeAllSelects();
		if (keyCleanup) keyCleanup();
		if (slideHost) { finishSlide(slideHost); slideHost = null; }
		draft = null;
		currentSpec = null;
		currentContainer = null;
		currentPath = null;
		countEl = null;
	}

	return { render, flush: flushSave, dispose };
}
