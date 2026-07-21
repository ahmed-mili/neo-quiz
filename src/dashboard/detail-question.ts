import { setIcon } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n";
import type { DraftQuestion } from "../editor/utils";
import { renderQuizPreviewCard } from "../editor/question-preview";

/* ══════════════════════════════════════════════════════════
   DETAIL QUESTION — panneau principal de la page « quiz »

   Deux états d'UNE même carte (contrat Excalidraw 2026-07-21) :
   - CONSULTATION : le VRAI rendu du quiz (editor/question-preview.ts,
     mêmes classes que le moteur), à son état INITIAL — la bonne réponse
     n'y est jamais distinguée (demande explicite d'Ahmed) ;
   - ÉDITION : énoncé éditable, puis une carte par réponse — VERTE pour la
     bonne, ROUGE pour les mauvaises, avec bascule et suppression.

   Les couleurs viennent des tokens --quiz-success / --quiz-danger déjà
   utilisés par le moteur : le vert/rouge de l'édition est exactement
   celui que l'apprenant verra en jouant.
══════════════════════════════════════════════════════════ */

/** Types que la page sait éditer en place — les autres renvoient à l'éditeur complet. */
export function isChoiceQuestion(q: DraftQuestion): boolean {
	return q._type === "single" || q._type === "multi";
}

/* ── Consultation ─────────────────────────────────────────── */

/** Le VRAI rendu du quiz (mêmes classes que le moteur), pas une imitation :
    demande d'Ahmed 2026-07-21 « il faut que ça ressemble au vrai rendu des
    quiz à droite ». Tout passe par editor/question-preview.ts, partagé avec
    l'aperçu de l'éditeur — un seul markup à suivre si le moteur change. */
export function renderQuestionView(parent: HTMLElement, q: DraftQuestion, app: App, index: number): void {
	renderQuizPreviewCard(parent, q, {
		app,
		fallbackTitle: `Question ${index + 1}`,
		// Pas de bouton d'indice ici : l'indice se lit en jouant, la page
		// d'un quiz sert à relire et corriger.
	});
}

/* ── Édition ──────────────────────────────────────────────── */

export interface EditCallbacks {
	/** Une donnée a changé : persister (débounce côté appelant) + rafraîchir la liste. */
	onChange(): void;
	/** Un ajout/retrait a changé la STRUCTURE : re-render du panneau. */
	onStructureChange(): void;
	/** Type non éditable ici : ouvrir l'éditeur complet. */
	onOpenFullEditor(): void;
}

export function renderQuestionEdit(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks): void {
	// ── Énoncé ──
	const promptCard = parent.createDiv({ cls: "qbd-qz-edit-card" });
	promptCard.createDiv({ cls: "qbd-qz-edit-label", text: t("dashboard.quiz.editPrompt") });
	const promptInput = promptCard.createEl("textarea", { cls: "qbd-qz-edit-textarea" });
	promptInput.value = q.prompt || "";
	promptInput.rows = 2;
	autoGrow(promptInput);
	promptInput.addEventListener("input", () => {
		q.prompt = promptInput.value;
		// L'énoncé redevient du texte : le HTML pré-rendu d'un import
		// l'écraserait au rendu suivant (et à l'export, cf. export.ts).
		q._useHtmlPrompt = false;
		delete q._promptHtml;
		autoGrow(promptInput);
		cb.onChange();
	});

	if (!isChoiceQuestion(q)) {
		const notice = parent.createDiv({ cls: "qbd-qz-edit-notice" });
		notice.createSpan({ text: t("dashboard.quiz.editUnsupported") });
		const btn = notice.createEl("button", { cls: "qbd-btn qbd-btn--ghost", text: t("dashboard.quiz.openFullEditor") });
		btn.addEventListener("click", () => cb.onOpenFullEditor());
		return;
	}

	// ── Réponses ──
	const isMulti = q._type === "multi";
	const options = q.options || (q.options = ["", ""]);
	const isCorrect = (i: number): boolean => isMulti
		? (q.correctIndices || []).includes(i)
		: (q.correctIndex ?? 0) === i;

	const answers = parent.createDiv({ cls: "qbd-qz-answers" });

	options.forEach((opt, i) => {
		const good = isCorrect(i);
		const card = answers.createDiv({ cls: "qbd-qz-answer" + (good ? " is-good" : " is-bad") });

		const head = card.createDiv({ cls: "qbd-qz-answer-head" });
		head.createSpan({ cls: "qbd-qz-answer-label", text: t(good ? "dashboard.quiz.goodAnswer" : "dashboard.quiz.badAnswer") });

		// Bascule bonne/mauvaise — en choix unique, cocher une réponse
		// décoche l'ancienne (c'est la définition du type, pas un effet de
		// bord) ; en choix multiple les états sont indépendants.
		const toggle = head.createEl("button", { cls: "qbd-qz-answer-toggle", attr: { type: "button", "aria-pressed": String(good) } });
		toggle.setAttribute("title", t(good ? "dashboard.quiz.markBad" : "dashboard.quiz.markGood"));
		const dot = toggle.createSpan({ cls: "qbd-qz-answer-toggle-dot" });
		setIcon(dot, good ? "check" : "x");
		toggle.addEventListener("click", () => {
			if (isMulti) {
				const set = new Set(q.correctIndices || []);
				if (set.has(i)) set.delete(i); else set.add(i);
				q.correctIndices = [...set].sort((a, b) => a - b);
			} else {
				if (good) return; // une question à choix unique garde une bonne réponse
				q.correctIndex = i;
			}
			cb.onChange();
			cb.onStructureChange();
		});

		// Suppression : jamais en dessous de 2 réponses (le moteur exige un choix).
		if (options.length > 2) {
			const del = head.createEl("button", { cls: "qbd-qz-answer-del", attr: { type: "button", "aria-label": t("dashboard.quiz.deleteAnswer") } });
			setIcon(del, "x");
			del.addEventListener("click", () => {
				options.splice(i, 1);
				reindexAfterDelete(q, i);
				cb.onChange();
				cb.onStructureChange();
			});
		}

		const input = card.createEl("textarea", { cls: "qbd-qz-answer-input" });
		input.value = opt;
		input.rows = 1;
		autoGrow(input);
		input.addEventListener("input", () => {
			options[i] = input.value;
			autoGrow(input);
			cb.onChange();
		});
	});

	const add = parent.createEl("button", { cls: "qbd-qz-add-answer", attr: { type: "button" } });
	const addIcon = add.createSpan({ cls: "qbd-qz-add-answer-icon" });
	setIcon(addIcon, "plus");
	add.createSpan({ text: t("dashboard.quiz.addAnswer") });
	add.addEventListener("click", () => {
		options.push("");
		cb.onChange();
		cb.onStructureChange();
	});
}

/** Recale les index de bonne(s) réponse(s) après suppression de l'option `i`. */
function reindexAfterDelete(q: DraftQuestion, i: number): void {
	if (q._type === "multi") {
		q.correctIndices = (q.correctIndices || [])
			.filter(idx => idx !== i)
			.map(idx => (idx > i ? idx - 1 : idx));
		return;
	}
	const cur = q.correctIndex ?? 0;
	// La bonne réponse supprimée : la première option reprend le rôle — une
	// question à choix unique sans bonne réponse serait injouable.
	if (cur === i) q.correctIndex = 0;
	else if (cur > i) q.correctIndex = cur - 1;
}

/** Textarea qui suit son contenu (pas d'ascenseur interne, pas de saut). */
function autoGrow(el: HTMLTextAreaElement): void {
	el.style.height = "auto";
	el.style.height = el.scrollHeight + "px";
}
