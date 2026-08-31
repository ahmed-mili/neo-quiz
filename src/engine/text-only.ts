import type { EngineCtx } from "../types/engine-ctx";
import type {
	QuizQuestion,
	TextQuestion,
	QcmQuestion,
	MultiSelectQuestion,
	TextOnlyRating,
} from "../types/quiz";
import { renderLessonHtml } from "./sanitizer";
import { t } from "../i18n";

export interface TextOnlyResults {
	understood: number;
	partial: number;
	review: number;
	pending: number;
	total: number;
	rated: number;
}

export interface RatingMeta {
	label: string;
	className: string;
}

export interface TextOnlyHandlers {
	RATINGS: Record<TextOnlyRating, RatingMeta>;
	isTextOnlyMode(): boolean;
	isTextOnlyFor(qi: number): boolean;
	isExamAnswerPhase(): boolean;
	isExamReviewPhase(): boolean;
	normalizeRating(value: TextOnlyRating | null | undefined): TextOnlyRating | null;
	getRatingMeta(value: TextOnlyRating | null | undefined): RatingMeta | null;
	hasAnyAnswer(qi: number): boolean;
	isChecked(qi: number): boolean;
	isRated(qi: number): boolean;
	computeResults(): TextOnlyResults;
	getCorrectOptionIndices(q: QuizQuestion): number[];
	expectedAnswerHtml(q: QuizQuestion): string;
	learningHtml(q: QuizQuestion): string;
	comparisonOptionsHtml(q: QuizQuestion, qi: number): string;
	ratingButtonsHtml(qi: number): string;
	questionCardBodyHtml(q: QuizQuestion, qi: number): string;
	questionActionsHtml(qi: number): string;
	bindTextOnlyQuestion(trackItem: HTMLElement, qi: number): void;
}

export function createTextOnlyHandlers(ctx: EngineCtx): TextOnlyHandlers {
	/* `label` en GETTER, pas en chaîne figée : RATINGS est construit une fois par
	   instance de quiz (createTextOnlyHandlers), un libellé évalué ici resterait
	   dans la langue en vigueur à l'assemblage. Le getter fait de `label` un
	   accessor : la traduction est lue au moment où le HTML est construit.
	   `className` reste une constante — c'est un identifiant CSS, jamais traduit. */
	const RATINGS: Record<TextOnlyRating, RatingMeta> = {
		understood: { get label() { return t("engine.rating.understood"); }, className: "understood" },
		partial: { get label() { return t("engine.rating.partial"); }, className: "partial" },
		review: { get label() { return t("engine.rating.review"); }, className: "review" }
	};

	/* Décision GLOBALE, historique : tout le quiz en réponse libre + auto-
	   évaluation. Ne dépend plus d'un bouton dans l'UI (retiré 2026-08-31) mais
	   reste posée par la configuration du bloc (démarrage « Entraînement » d'un
	   examen, cf. startModeSelectorHtml/exam.ts:startTrainingMode) — un chemin
	   hors Leçon, conservé tel quel. Les décisions qui portent sur le quiz
	   ENTIER (écran de soumission, résultats, navigation flèche/onglet
	   Résultats) restent branchées ici : un mélange de rôles en Leçon n'a pas
	   d'écran de soumission unique à styliser, ce n'est pas le sujet de cette
	   fonction. */
	function isTextOnlyMode(): boolean {
		return ctx.quizState?.practiceMode === "text";
	}

	/* Décision PAR QUESTION : absorbe la mécanique de l'ancien bouton « Practice
	   mode » dans le rôle "recall" du mode Leçon (Task 5, 2026-08-31) — une
	   question de restitution s'affiche toujours en réponse libre + auto-
	   évaluation, sans réglage utilisateur, alors que ses voisines "pre"/"test"
	   du même quiz restent en QCM. Le chemin historique (`practiceMode ===
	   "text"`) reste une clause OU : un bloc hors Leçon qui active encore ce
	   mode par sa configuration (démarrage « Entraînement ») continue de tout
	   afficher en réponse libre, question par question. */
	function isTextOnlyFor(qi: number): boolean {
		return isTextOnlyMode() || (ctx.isLessonMode() && ctx.roleOfQuestion(qi) === "recall");
	}

	function isExamAnswerPhase(): boolean {
		return isTextOnlyMode() && !!ctx.isExamMode && !!ctx.examStarted && !ctx.examEnded;
	}

	function isExamReviewPhase(): boolean {
		return isTextOnlyMode() && !!ctx.isExamMode && !!ctx.examEnded;
	}

	function normalizeRating(value: TextOnlyRating | null | undefined): TextOnlyRating | null {
		// Iso-fonctionnel avec `hasOwnProperty.call(RATINGS, value) ? value : null` :
		// pour value null/undefined, hasOwnProperty renvoie false → null. Le garde
		// `value != null` reproduit ce résultat exact tout en narrowing value en
		// clé valide (PropertyKey) pour hasOwnProperty.
		return value != null && Object.prototype.hasOwnProperty.call(RATINGS, value) ? value : null;
	}

	function getRatingMeta(value: TextOnlyRating | null | undefined): RatingMeta | null {
		const normalized = normalizeRating(value);
		return normalized ? RATINGS[normalized] : null;
	}

	function hasAnyAnswer(qi: number): boolean {
		const answer = ctx.quizState.textOnlyAnswers?.[qi];
		return typeof answer === "string" && answer.trim().length > 0;
	}

	function isChecked(qi: number): boolean {
		return !!ctx.quizState.textOnlyChecked?.[qi] || isExamReviewPhase();
	}

	function isRated(qi: number): boolean {
		return !!normalizeRating(ctx.quizState.textOnlyRatings?.[qi]);
	}

	function computeResults(): TextOnlyResults {
		const counts = { understood: 0, partial: 0, review: 0, pending: 0 };
		for (let i = 0; i < ctx.quiz.length; i++) {
			const rating = normalizeRating(ctx.quizState.textOnlyRatings?.[i]);
			if (rating) counts[rating]++;
			else counts.pending++;
		}
		return { ...counts, total: ctx.quiz.length, rated: ctx.quiz.length - counts.pending };
	}

	function getCorrectOptionIndices(q: QuizQuestion): number[] {
		if (!q) return [];
		// Lecture uniforme des champs QCM (options/correctIndices/correctIndex) —
		// pour les variantes non-QCM ces champs sont absents ⇒ retour [].
		const qc = q as QcmQuestion | MultiSelectQuestion;
		if (qc.multiSelect && Array.isArray(qc.correctIndices)) {
			return qc.correctIndices
				.map(Number)
				.filter(i => Number.isInteger(i) && i >= 0 && i < (qc.options || []).length);
		}
		const correctIndex = Number((qc as QcmQuestion).correctIndex);
		if (Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < (qc.options || []).length) {
			return [correctIndex];
		}
		return [];
	}

	function expectedAnswerHtml(q: QuizQuestion): string {
		const indices = getCorrectOptionIndices(q);
		if (indices.length > 0) {
			const items = indices.map(oi => {
				// Invariant : indices non vides ⇒ question QCM.
				const content = ctx.cards.optionContentHtml(q as QcmQuestion | MultiSelectQuestion, oi);
				return `<div class="quiz-textonly-expected-item">${content}</div>`;
			}).join("");
			return `<div class="quiz-textonly-expected-list">${items}</div>`;
		}

		// getTextAcceptedAnswers est tolérant (champs texte optionnels) : pour une
		// variante non-texte il renvoie [] — cast documenté.
		const accepted = ctx.terminal?.getTextAcceptedAnswers?.(q as TextQuestion) || [];
		if (accepted.length > 0) {
			return `<div class="quiz-textonly-expected-item">${ctx.sanitize.renderInlineText(accepted[0])}</div>`;
		}

		if (ctx.isOrderingQuestion(q)) {
			const items = ctx.getOrderingItems(q);
			const order = ctx.getOrderingCorrectOrder(q);
			const answer = order.map(i => items[i]).filter(v => v !== undefined).join(" -> ");
			if (answer) return `<div class="quiz-textonly-expected-item">${ctx.sanitize.renderInlineText(answer)}</div>`;
		}

		if (ctx.isMatchingQuestion(q)) {
			const rows = ctx.getMatchRows(q);
			const choices = ctx.getMatchChoices(q);
			const map = ctx.getMatchCorrectMap(q);
			if (Array.isArray(map) && map.length === rows.length) {
				const rowsHtml = rows.map((row, i) => {
					const choice = choices[map[i]] ?? "";
					return `<div class="quiz-textonly-expected-pair"><strong>${ctx.sanitize.renderInlineText(row)}</strong><span>${ctx.sanitize.renderInlineText(choice)}</span></div>`;
				}).join("");
				return `<div class="quiz-textonly-expected-list">${rowsHtml}</div>`;
			}
		}

		return `<div class="quiz-textonly-expected-item">${t("engine.textOnly.noExpectedAnswer")}</div>`;
	}

	function learningHtml(q: QuizQuestion): string {
		const chunks: string[] = [];
		const lessonContent = renderLessonHtml(q, ctx.sanitize);
		if (lessonContent) {
			chunks.push(`<div class="quiz-textonly-explain-block"><div class="quiz-textonly-label">${t("engine.lesson.label")}</div><div class="quiz-textonly-explain-content">${lessonContent}</div></div>`);
		}

		const explainHtml = q.explainHtml || q._explainHtml;
		if (explainHtml || q.explain) {
			const content = explainHtml
				? ctx.sanitize.replaceObsidianEmbedsInHtml(explainHtml)
				: ctx.sanitize.renderTextWithEmbeds(q.explain || "");
			chunks.push(`<div class="quiz-textonly-explain-block"><div class="quiz-textonly-label">${t("engine.textOnly.explanationLabel")}</div><div class="quiz-textonly-explain-content">${content}</div></div>`);
		}

		return chunks.join("");
	}

	function comparisonOptionsHtml(q: QuizQuestion, qi: number): string {
		const qOptions = (q as { options?: string[] }).options;
		if (!Array.isArray(qOptions) || qOptions.length === 0) return "";
		const correct = new Set(getCorrectOptionIndices(q));
		const shuf = ctx.quizState.shuffleMap?.[qi];
		const order: number[] = Array.isArray(shuf) ? shuf : [...Array(qOptions.length).keys()];

		const options = order.map(oi => {
			const cls = correct.has(oi) ? "correct" : "";
			return `<div class="quiz-option quiz-textonly-option ${cls}" data-textonly-orig="${oi}">${ctx.cards.optionContentHtml(q as QcmQuestion | MultiSelectQuestion, oi)}</div>`;
		}).join("");

		const hasImg = /<img[\s>]/i.test(options);
		return `<div class="quiz-textonly-comparison">
			<div class="quiz-textonly-label">${t("engine.textOnly.optionsLabel")}</div>
			<div class="quiz-options-wrap${hasImg ? " quiz-options-image-grid" : ""}">${options}</div>
		</div>`;
	}

	function ratingButtonsHtml(qi: number): string {
		const current = normalizeRating(ctx.quizState.textOnlyRatings?.[qi]);
		return `<div class="quiz-textonly-self">
			<div class="quiz-textonly-label">${t("engine.textOnly.selfRating")}</div>
			<div class="quiz-textonly-rating-row">
				${(Object.entries(RATINGS) as Array<[TextOnlyRating, RatingMeta]>).map(([value, meta]) => {
					const selected = current === value ? " selected" : "";
					return `<button class="quiz-action-btn quiz-textonly-rating-btn ${meta.className}${selected}" type="button" data-textonly-rating="${value}" aria-pressed="${current === value ? "true" : "false"}">${meta.label}</button>`;
				}).join("")}
			</div>
		</div>`;
	}

	function questionCardBodyHtml(q: QuizQuestion, qi: number): string {
		const checked = isChecked(qi);
		const examAnswerPhase = isExamAnswerPhase();
		const revealed = checked && !examAnswerPhase;
		const value = typeof ctx.quizState.textOnlyAnswers?.[qi] === "string" ? ctx.quizState.textOnlyAnswers[qi] : "";
		const textareaName = ctx.escapeHtmlAttr(q?.id || `q${qi + 1}`);
		const readOnlyAttr = revealed ? `readonly aria-readonly="true"` : "";

		const reviewHtml = revealed ? `<div class="quiz-textonly-review">
			${ratingButtonsHtml(qi)}
			${comparisonOptionsHtml(q, qi)}
			${learningHtml(q)}
		</div>` : "";

		return `<div class="quiz-textonly">
			<div class="quiz-textonly-answer">
				<label class="quiz-textonly-label" for="quizTextOnly_${ctx.QUIZ_INSTANCE_ID}_${qi}">${t("engine.textOnly.answerLabel")}</label>
				<textarea
					id="quizTextOnly_${ctx.QUIZ_INSTANCE_ID}_${qi}"
					class="quiz-textarea quiz-textonly-textarea"
					data-textonly-answer="1"
					name="${textareaName}"
					placeholder="${ctx.escapeHtmlAttr(t("engine.textOnly.answerPlaceholder"))}"
					spellcheck="true"
					autocapitalize="off"
					autocomplete="off"
					autocorrect="off"
					${readOnlyAttr}
				>${ctx.escapeHtmlText(value)}</textarea>
				${(!revealed && !examAnswerPhase) ? `<div class="quiz-actions quiz-textonly-check-actions"><button class="quiz-action-btn success quiz-textonly-check-btn" type="button">${t("engine.textOnly.check")}</button></div>` : ""}
			</div>
			${reviewHtml}
		</div>`;
	}

	function questionActionsHtml(qi: number): string {
		const isFirst = qi <= 0;
		const isLast = qi >= ctx.quiz.length - 1;
		const lastLabel = t(isExamAnswerPhase() ? "engine.exam.finish" : "engine.nav.results");
		return `<div class="quiz-actions quiz-textonly-nav-actions">
			<button class="quiz-action-btn quiz-prev-btn" type="button"${isFirst ? " disabled" : ""}>${t("engine.nav.prevQuestion")}</button>
			${isLast
				? `<button class="quiz-action-btn success quiz-results-btn" type="button">${lastLabel}</button>`
				: `<button class="quiz-action-btn quiz-next-btn" type="button">${t("engine.nav.nextQuestion")}</button>`}
		</div>`;
	}

	function syncTextAreaHeight(textarea: HTMLTextAreaElement): void {
		if (ctx.terminal?.syncTextAreaHeight) {
			ctx.terminal.syncTextAreaHeight(textarea);
			return;
		}
		textarea.style.height = "auto";
		textarea.style.height = `${Math.max(220, textarea.scrollHeight)}px`;
	}

	function bindTextOnlyQuestion(trackItem: HTMLElement, qi: number): void {
		const textarea = trackItem.querySelector<HTMLTextAreaElement>(".quiz-textonly-textarea[data-textonly-answer]");
		if (textarea) {
			const syncLayout = () => {
				syncTextAreaHeight(textarea);
				const slideIdx = ctx.getSlideIndexForQuestion(qi);
				if (slideIdx >= 0) ctx.viewport.__quizSlideHeightCache?.delete(slideIdx);
				if (slideIdx === ctx.quizState.current) {
					ctx.viewport.scheduleViewportHeightSync({ index: slideIdx, animate: false, refresh: true });
				}
			};

			const persistAnswer = () => {
				if (isChecked(qi)) return;
				ctx.invalidateSavedResults?.();
				ctx.quizState.textOnlyAnswers[qi] = String(textarea.value ?? "");
			};

			const commitAnswer = () => {
				if (isChecked(qi)) return;
				// Persister l'état même pendant un slide (sinon la frappe de fin est perdue) ;
				// le re-render (nav + meta) n'est fait qu'hors slide pour ne pas casser l'animation.
				persistAnswer();
				if (ctx.quizState.isSliding) return;
				ctx.updateNavHighlight();
				ctx.cards.refreshMetaSlides();
				syncLayout();
			};

			textarea.addEventListener("input", commitAnswer);
			textarea.addEventListener("paste", () => requestAnimationFrame(commitAnswer));
			textarea.addEventListener("focus", syncLayout);
			textarea.addEventListener("blur", () => { persistAnswer(); syncLayout(); });
			textarea.addEventListener("keydown", e => {
				if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
					e.preventDefault();
					const checkBtn = trackItem.querySelector<HTMLButtonElement>(".quiz-textonly-check-btn");
					if (checkBtn) checkBtn.click();
				}
			});
			syncLayout();
		}

		const checkBtn = trackItem.querySelector<HTMLButtonElement>(".quiz-textonly-check-btn");
		if (checkBtn) {
			checkBtn.addEventListener("click", e => {
				e.preventDefault();
				if (ctx.quizState.isSliding) return;
				const liveTextarea = trackItem.querySelector<HTMLTextAreaElement>(".quiz-textonly-textarea[data-textonly-answer]");
				ctx.invalidateSavedResults?.();
				ctx.quizState.textOnlyAnswers[qi] = String(liveTextarea?.value ?? ctx.quizState.textOnlyAnswers[qi] ?? "");
				ctx.quizState.textOnlyChecked[qi] = true;
				ctx.commitQuestionInteraction(qi, { syncHeight: true });
			});
		}

		trackItem.querySelectorAll<HTMLElement>(".quiz-textonly-rating-btn[data-textonly-rating]").forEach(btn => {
			btn.addEventListener("click", e => {
				e.preventDefault();
				if (ctx.quizState.isSliding) return;
				const rating = normalizeRating(btn.dataset.textonlyRating as TextOnlyRating | undefined);
				if (!rating) return;
				ctx.quizState.textOnlyRatings[qi] = rating;
				ctx.commitQuestionInteraction(qi, { syncHeight: true });
			});
		});
	}

	return {
		RATINGS,
		isTextOnlyMode,
		isTextOnlyFor,
		isExamAnswerPhase,
		isExamReviewPhase,
		normalizeRating,
		getRatingMeta,
		hasAnyAnswer,
		isChecked,
		isRated,
		computeResults,
		getCorrectOptionIndices,
		expectedAnswerHtml,
		learningHtml,
		comparisonOptionsHtml,
		ratingButtonsHtml,
		questionCardBodyHtml,
		questionActionsHtml,
		bindTextOnlyQuestion
	};
}
