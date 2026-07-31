import type { EngineCtx } from "../types/engine-ctx";
import type {
	QuizQuestion,
	QcmQuestion,
	MultiSelectQuestion,
	OrderingQuestion,
	MatchingQuestion,
	TextQuestion,
	ClozeQuestion,
} from "../types/quiz";
import { mathifyElement } from "./mathjax";
import { t, type TransKey } from "../i18n";

export interface CardHandlers {
	tabClass(i: number): string;
	navHtml(): string;
	modeToggleHtml(): string;
	startModeSelectorHtml(): string;
	optionClass(qi: number, oi: number): string;
	optionContentHtml(q: QcmQuestion | MultiSelectQuestion, oi: number): string;
	explanationHtml(qi: number): string;
	renderQuizPromptHtml(q: QuizQuestion): string;
	orderingCardHtml(q: OrderingQuestion, qi: number): string;
	matchingCardHtml(q: MatchingQuestion, qi: number): string;
	submitSlideHtml(): string;
	resultsSlideHtml(): string;
	refreshMetaSlides(opts?: { force?: boolean }): void;
	questionCardHtml(qi: number): string;
}

export function createCardRenderers(ctx: EngineCtx): CardHandlers {
	// Variables locales
	let __quizSubmitSlideSignature = "";
	let __quizResultsSlideSignature = "";

	/* Compteurs : deux clés (« une réponse » / « deux réponses ») choisies ici,
	   jamais un « s » concaténé — l'anglais et le français ne s'accordent pas de
	   la même façon. Le seuil `> 1` reproduit exactement l'accord français
	   d'origine (`n > 1 ? "s" : ""`) ; ces branches ne sont jamais atteintes
	   avec n = 0, où anglais et français divergeraient. */
	const plural = (count: number, one: TransKey, other: TransKey): string =>
		t(count > 1 ? other : one, { count });

	function tabClass(i: number): string {
		const cur = ctx.quizState.current;
		// slideMap[cur].questionIndex n'existe que sur la variante « question » —
		// cast pour lire l'optionnel `?.questionIndex` sans changer le runtime.
		const entry = ctx.slideMap[cur] as { questionIndex?: number } | undefined;
		const isActive = ctx.isQuestionSlideIndex(cur) && entry?.questionIndex === i;
		const active = isActive ? "active" : "";
		if (ctx.textOnly?.isTextOnlyMode?.()) {
			const rating = ctx.textOnly.getRatingMeta(ctx.quizState.textOnlyRatings?.[i]);
			if (rating) return `${active} ${rating.className}`.trim();
			if (ctx.textOnly.isChecked(i)) return `${active} checked`.trim();
			if (ctx.textOnly.hasAnyAnswer(i)) return `${active} answered`.trim();
			return active;
		}
		if (!ctx.hasAnyAnswer(i)) return active;
		if (!ctx.quizState.locked) return `${active} answered`.trim();
		return `${active} ${ctx.isCorrect(i) ? "correct" : "wrong"}`.trim();
	}

	function navHtml(): string {
		const resultsActive = (ctx.isSubmitSlideIndex(ctx.quizState.current) || ctx.isResultsSlideIndex(ctx.quizState.current)) ? "active" : "";
		return `<div class="quiz-nav">${ctx.quiz.map((_, i) => `<a class="quiz-tab ${tabClass(i)}" href="#" data-nav="${i}">Q${i + 1}</a>`).join("")}<a class="quiz-tab is-result ${resultsActive}" href="#" data-nav-results="1">${t("engine.nav.results")}</a></div>`;
	}

	function modeToggleHtml(): string {
		const mode = ctx.quizState.practiceMode === "text" ? "text" : "qcm";
		const isTextOnly = mode === "text";
		const nextMode = isTextOnly ? "qcm" : "text";
		return `<div class="quiz-mode-toggle" aria-label="${ctx.escapeHtmlAttr(t("engine.mode.toggleAria"))}">
			<span class="quiz-mode-toggle-label">${t("engine.mode.toggleLabel")}</span>
			<button class="quiz-mode-switch${isTextOnly ? " is-on" : ""}" type="button" role="switch" aria-checked="${isTextOnly ? "true" : "false"}" aria-label="${ctx.escapeHtmlAttr(t(isTextOnly ? "engine.mode.switchOff" : "engine.mode.switchOn"))}" data-quiz-mode="${nextMode}">
				<span class="quiz-mode-switch-track" aria-hidden="true"><span class="quiz-mode-switch-thumb"></span></span>
			</button>
		</div>`;
	}

	function startModeSelectorHtml(): string {
		const isTraining = ctx.quizState.practiceMode === "text";
		return `<div class="quiz-start-mode-selector" role="group" aria-label="${ctx.escapeHtmlAttr(t("engine.start.selectorAria"))}">
			<button class="quiz-start-mode-option${!isTraining ? " is-active" : ""}" type="button" data-quiz-start-mode="exam" aria-pressed="${!isTraining ? "true" : "false"}">
				<span class="quiz-start-mode-title">${t("engine.start.examTitle")}</span>
				<span class="quiz-start-mode-sub">${t("engine.start.examSub")}</span>
			</button>
			<button class="quiz-start-mode-option${isTraining ? " is-active" : ""}" type="button" data-quiz-start-mode="training" aria-pressed="${isTraining ? "true" : "false"}">
				<span class="quiz-start-mode-title">${t("engine.start.trainingTitle")}</span>
				<span class="quiz-start-mode-sub">${t("engine.start.trainingSub")}</span>
			</button>
		</div>`;
	}

	function optionClass(qi: number, oi: number): string {
		// optionClass n'est appelée que pour des questions QCM/choix multiple
		// (branche else de questionCardHtml) : cast honnête vers l'invariant réel,
		// puis TS narrow QcmQuestion/MultiSelectQuestion via `q.multiSelect`.
		const q = ctx.quiz[qi] as QcmQuestion | MultiSelectQuestion;
		const sel = ctx.quizState.selections[qi];
		if (q.multiSelect) {
			const selected = sel instanceof Set && sel.has(oi);
			if (!ctx.quizState.locked) return selected ? "selected" : "";
			const correct = Array.isArray(q.correctIndices) && q.correctIndices.includes(oi);
			if (selected && correct) return "correct";
			if (selected && !correct) return "wrong";
			if (!selected && correct) return "missed";
			return "";
		}
		const selected = sel === oi;
		if (!ctx.quizState.locked) return selected ? "selected" : "";
		const correct = oi === q.correctIndex;
		if (selected && correct) return "correct";
		if (selected && !correct) return "wrong";
		if (!selected && correct) return "missed";
		return "";
	}

	function explanationHtml(qi: number): string {
		const q = ctx.quiz[qi];
		if (!q) return "";
		const explainHtml = q.explainHtml || q._explainHtml;
		if (explainHtml) {
			return `<div class="quiz-explain ${ctx.isCorrect(qi) ? "good" : "bad"}">${ctx.sanitize.replaceObsidianEmbedsInHtml(explainHtml)}</div>`;
		}
		if (q.explain) {
			return `<div class="quiz-explain ${ctx.isCorrect(qi) ? "good" : "bad"}">${ctx.sanitize.renderTextWithEmbeds(q.explain)}</div>`;
		}
		return "";
	}

	function renderQuizPromptHtml(q: QuizQuestion): string {
		const promptHtml = q.promptHtml || q._promptHtml;
		if (promptHtml) {
			return ctx.sanitize.replaceObsidianEmbedsInHtml(promptHtml);
		}
		if (q.prompt) {
			return ctx.sanitize.renderTextWithEmbeds(q.prompt);
		}
		return "";
	}

	function optionContentHtml(q: QcmQuestion | MultiSelectQuestion, oi: number): string {
		let optionContentHtml = "";
		if (q.optionHtml?.[oi]) {
			/* Seul champ `*Html` qui ne passe pas par `replaceObsidianEmbedsInHtml`
			   (il a sa propre résolution de `src`) : il lui faut donc son propre
			   passage au filtre. Une option d'un quiz PARTAGÉ arrive avec le HTML
			   de son auteur, et finit dans le DOM par `innerHTML`. */
			optionContentHtml = ctx.sanitize.sanitizeQuizHtml(q.optionHtml[oi]);
			if (typeof ctx.app?.vault?.adapter?.getResourcePath === "function") {
				optionContentHtml = optionContentHtml.replace(/src="([^"]+)"/g, (match: string, src: string) => {
					if (src.startsWith("http") || src.startsWith("data:") || src.startsWith("app://")) {
						return match;
					}
					try {
						const resolved = ctx.app.vault.adapter.getResourcePath(src);
						return `src="${ctx.escapeHtmlAttr(resolved)}"`;
					} catch {
						return match;
					}
				});
			}
		} else {
			optionContentHtml = ctx.sanitize.renderRawHtmlWithEmbeds(q.options[oi], { wrapClass: "quiz-option-embed-wrap", imgClass: "quiz-option-embed" });
		}
		return optionContentHtml;
	}

	function orderingCardHtml(q: OrderingQuestion, qi: number): string {
		const items = ctx.getOrderingItems(q);
		// Question de classement ⇒ sélection à emplacements (indices). Le cast
		// nomme cet invariant : `Array.isArray` ne sépare plus `number[]` de
		// `string[]` depuis l'arrivée du texte à trous.
		const sel = ctx.quizState.selections[qi] as Array<number | null> | undefined;
		const slotLabels = ctx.getOrderingSlotLabels(q);
		const correctOrder = ctx.getOrderingCorrectOrder(q);
		// QCM/ordering → number[] (buildShuffleMap) ; cast erasé, runtime `|| []` intact.
		const shuffled = (ctx.quizState.shuffleMap[qi] as number[]) || [];
		const pick = ctx.quizState.orderingPick[qi];

		const slots = items.map((_, si) => {
			const oi = Array.isArray(sel) ? sel[si] : null;
			const filled = oi !== null;
			let cls = "quiz-slot";
			if (filled) cls += " filled";
			if (!ctx.quizState.locked && pick !== null) cls += " can-place";
			if (ctx.quizState.locked && filled) cls += oi === correctOrder[si] ? " correct" : " wrong";

			return `<div class="${cls}" data-order-slot="${si}" role="button" tabindex="0" ${(!ctx.quizState.locked && filled) ? `draggable="true" data-slot-item="${oi}"` : ""}>
				<div class="quiz-slot-label">${ctx.sanitize.renderInlineText(slotLabels[si] ?? String(si + 1))}</div>
				<div class="quiz-slot-value">${filled ? ctx.sanitize.renderInlineText(items[oi]) : t("engine.ordering.dropHere")}</div>
			</div>`;
		}).join("");

		const possibilities = shuffled.map(oi => {
			const used = ctx.orderingSelectionIncludes(qi, oi);
			const picked = !used && pick === oi && !ctx.quizState.locked;
			let cls = "quiz-possibility";
			if (used) cls += " used";
			if (picked) cls += " selected-pick";

			return `<div class="${cls}" data-order-item="${oi}" role="button" tabindex="0" ${(!used && !ctx.quizState.locked) ? `draggable="true"` : ""}>
				${ctx.sanitize.renderInlineText(items[oi])}
			</div>`;
		}).join("");

		return `<div class="quiz-multi-indicator">${t("engine.ordering.instructions")}</div>
		<div class="quiz-ordering">
			<div class="quiz-ordering-slots">${slots}</div>
			<div class="quiz-ordering-label">${t("engine.ordering.itemsLabel")}</div>
			<div class="quiz-ordering-possibilities">${possibilities}</div>
		</div>`;
	}

	function matchingCardHtml(q: MatchingQuestion, qi: number): string {
		const rows = ctx.getMatchRows(q);
		const choices = ctx.getMatchChoices(q);
		const correctMap = ctx.getMatchCorrectMap(q);
		// Idem orderingCardHtml : question d'association ⇒ indices.
		const sel = ctx.quizState.selections[qi] as Array<number | null> | undefined;
		// Matching → { rows, choices } (buildShuffleMap) ; cast erasé, runtime `|| {}` intact.
		const shuffleData = (ctx.quizState.shuffleMap[qi] || {}) as { rows?: number[]; choices?: number[] };
		const shuffledRows = Array.isArray(shuffleData.rows) ? shuffleData.rows : [...Array(rows.length).keys()];
		const shuffledChoices = Array.isArray(shuffleData.choices) ? shuffleData.choices : [...Array(choices.length).keys()];
		const pick = ctx.quizState.matchPick[qi];

		const slots = shuffledRows.map(rowIndex => {
			const chosen = Array.isArray(sel) ? sel[rowIndex] : null;
			const filled = chosen !== null;
			let cls = "quiz-slot";
			if (filled) cls += " filled";
			if (!ctx.quizState.locked && pick !== null) cls += " can-place";
			if (ctx.quizState.locked && filled && Array.isArray(correctMap) && correctMap.length === rows.length) {
				cls += chosen === correctMap[rowIndex] ? " correct" : " wrong";
			}

			return `<div class="${cls}" data-match-slot="${rowIndex}" role="button" tabindex="0" ${(!ctx.quizState.locked && filled) ? `draggable="true" data-slot-choice="${chosen}"` : ""}>
				<div class="quiz-slot-label">${ctx.sanitize.renderInlineText(rows[rowIndex])}</div>
				<div class="quiz-slot-value">${filled ? ctx.sanitize.renderInlineText(choices[chosen] ?? t("engine.matching.unknownChoice")) : t("engine.matching.dropHere")}</div>
			</div>`;
		}).join("");

		const possibilities = shuffledChoices.map(ci => {
			const picked = !ctx.quizState.locked && pick === ci;
			let cls = "quiz-possibility";
			if (picked) cls += " selected-pick";

			return `<div class="${cls}" data-match-choice="${ci}" role="button" tabindex="0" ${!ctx.quizState.locked ? `draggable="true"` : ""}>
				${ctx.sanitize.renderInlineText(choices[ci])}
			</div>`;
		}).join("");

		return `<div class="quiz-multi-indicator">${t("engine.matching.instructions")}</div>
		<div class="quiz-ordering">
			<div class="quiz-ordering-slots">${slots}</div>
			<div class="quiz-ordering-label">${t("engine.matching.choicesLabel")}</div>
			<div class="quiz-ordering-possibilities">${possibilities}</div>
		</div>`;
	}

	function submitSlideHtml(): string {
		const missing = ctx.getMissingIndices();
		const mc = missing.length;
		if (ctx.textOnly?.isTextOnlyMode?.()) {
			if (ctx.textOnly.isExamAnswerPhase?.()) {
				const missingAnswers = ctx.quiz
					.map((_, i) => i)
					.filter(i => !ctx.textOnly.hasAnyAnswer(i));
				const mac = missingAnswers.length;
				const intro = mac > 0
					? `<div class="quiz-warn">${plural(mac, "engine.submit.missingFreeAnswers.one", "engine.submit.missingFreeAnswers.other")}</div><div class="quiz-submit-sub">${t("engine.submit.missingList")}</div>`
					: `<div class="quiz-submit-sub">${t("engine.submit.allFreeAnswered")}</div>`;
				return `<div class="quiz-track-item" data-slide-kind="submit"><div class="quiz-submit-wrap"><div class="quiz-submit-card">${intro}<div class="quiz-chip-row">${(mac > 0 ? missingAnswers : ctx.quiz.map((_, i) => i)).map(i => `<button class="quiz-chip ${mac > 0 ? "missing" : ""}" type="button" data-jump="${i}">Q${i + 1}</button>`).join("")}</div><div class="quiz-actions"><button class="quiz-action-btn quiz-back-btn" type="button">${t("engine.submit.back")}</button><button class="quiz-action-btn success quiz-show-score-btn" type="button">${t("engine.exam.finish")}</button></div></div></div></div>`;
			}

			const intro = mc > 0
				? `<div class="quiz-warn">${plural(mc, "engine.submit.missingRatings.one", "engine.submit.missingRatings.other")}</div><div class="quiz-submit-sub">${t("engine.submit.toRateList")}</div>`
				: `<div class="quiz-submit-sub">${t("engine.submit.allRated")}</div>`;
			return `<div class="quiz-track-item" data-slide-kind="submit"><div class="quiz-submit-wrap"><div class="quiz-submit-card">${intro}<div class="quiz-chip-row">${(mc > 0 ? missing : ctx.quiz.map((_, i) => i)).map(i => `<button class="quiz-chip ${mc > 0 ? "missing" : ""}" type="button" data-jump="${i}">Q${i + 1}</button>`).join("")}</div><div class="quiz-actions"><button class="quiz-action-btn quiz-back-btn" type="button">${t("engine.submit.back")}</button><button class="quiz-action-btn success quiz-show-score-btn" type="button">${t("engine.submit.showResults")}</button></div></div></div></div>`;
		}
		return `<div class="quiz-track-item" data-slide-kind="submit"><div class="quiz-submit-wrap"><div class="quiz-submit-card">${mc > 0 ? `<div class="quiz-warn">${plural(mc, "engine.submit.missingAnswers.one", "engine.submit.missingAnswers.other")}</div><div class="quiz-submit-sub">${t("engine.submit.missingList")}</div>` : `<div class="quiz-submit-sub">${t("engine.submit.reviewList")}</div>`}<div class="quiz-chip-row">${(mc > 0 ? missing : ctx.quiz.map((_, i) => i)).map(i => `<button class="quiz-chip ${mc > 0 ? "missing" : ""}" type="button" data-jump="${i}">Q${i + 1}</button>`).join("")}</div><div class="quiz-actions"><button class="quiz-action-btn quiz-back-btn" type="button">${t("engine.submit.back")}</button><button class="quiz-action-btn success quiz-show-score-btn" type="button">${t("engine.submit.showScore")}</button></div></div></div></div>`;
	}

	function saveResultsButtonHtml(): string {
		const savedPath = ctx.quizState.savedResultsPath;
		const saved = !!savedPath;
		// Garde sur `savedPath` (et non sur `saved`, sa copie booléenne) : même
		// condition au runtime, mais TS narrow ici string|null → string, ce
		// qu'exige le typage des variables de t().
		const titleAttr = savedPath ? ` title="${ctx.escapeHtmlAttr(t("engine.result.savedIn", { path: savedPath }))}"` : "";
		return `<button class="quiz-action-btn quiz-save-results-btn${saved ? " is-saved" : ""}" type="button" data-save-results="1"${saved ? " disabled" : ""}${titleAttr}>${t(saved ? "engine.result.saved" : "engine.result.save")}</button>`;
	}

	function resultsSlideHtml(): string {
		if (ctx.textOnly?.isTextOnlyMode?.()) {
			const results = ctx.textOnly.computeResults();
			const isExamCorrection = ctx.isExamMode && ctx.examEnded;
			const title = t(isExamCorrection ? "engine.result.freeTextCorrection" : "engine.result.trainingTitle");
			const correctionHint = isExamCorrection && results.pending > 0
				? `<p class="quiz-textonly-correction-hint">${t("engine.result.correctionHint")}</p>`
				: "";
			const correctionBtn = isExamCorrection && results.pending > 0
				? `<button class="quiz-action-btn quiz-review-answers-btn" type="button">${t("engine.result.reviewAnswers")}</button>`
				: "";
			// Le compteur « rated/total » reste du code (mise en forme <strong>) :
			// seule l'étiquette est traduite.
			return `<div class="quiz-track-item" data-slide-kind="results"><section class="quiz-result quiz-textonly-result"><h2 class="quiz-result-title" style="font-weight:900;">${title}</h2><p>${t("engine.result.ratedLabel")} <strong>${results.rated}/${results.total}</strong></p>${correctionHint}<div class="quiz-textonly-result-grid"><div class="quiz-textonly-result-stat understood"><strong>${results.understood}</strong><span>${t("engine.rating.understood")}</span></div><div class="quiz-textonly-result-stat partial"><strong>${results.partial}</strong><span>${t("engine.rating.partial")}</span></div><div class="quiz-textonly-result-stat review"><strong>${results.review}</strong><span>${t("engine.rating.review")}</span></div>${results.pending > 0 ? `<div class="quiz-textonly-result-stat pending"><strong>${results.pending}</strong><span>${t(results.pending > 1 ? "engine.result.pending.other" : "engine.result.pending.one")}</span></div>` : ""}</div><div class="quiz-actions">${correctionBtn}${saveResultsButtonHtml()}<button class="quiz-action-btn success quiz-retry-btn" type="button">${t("engine.result.retry")}</button></div></section></div>`;
		}
		const { pct, correct, total } = ctx.computeScorePercent();
		// Mode learn : bouton "Passer l'examen"
		const learnExamBtn = (ctx.quizMode === "learn" && ctx.learnExamOptions)
			? `<button class="quiz-action-btn quiz-exam-btn" type="button">${t("engine.result.takeExam")}</button>`
			: "";
		// Mode examen issu du mode learn : bouton "Repasser l'examen"
		const retakeExamBtn = (ctx.quizMode === "exam" && ctx.originalQuizMode === "learn" && ctx.originalLearnExamOptions)
			? `<button class="quiz-action-btn quiz-exam-btn" type="button">${t("engine.result.retakeExam")}</button>`
			: "";
		// Le score (« 12/20 », « 60 % ») reste du code : seule l'étiquette est traduite.
		return `<div class="quiz-track-item" data-slide-kind="results"><section class="quiz-result"><h2 class="quiz-result-title" style="font-weight:900;">${t("engine.result.title")}</h2><p style="font-size:48px;font-weight:900;margin:18px 0 6px;">${pct}%</p><p>${t("engine.result.correctLabel")} <strong>${correct}/${total}</strong></p><div class="quiz-actions">${saveResultsButtonHtml()}<button class="quiz-action-btn success quiz-retry-btn" type="button">${t("engine.result.retry")}</button>${learnExamBtn}${retakeExamBtn}</div></section></div>`;
	}


	function refreshMetaSlides({ force = false }: { force?: boolean } = {}): void {
		const nextSubmitSignature = ctx.getSubmitSlideSignature();
		const nextResultsSignature = ctx.getResultsSlideSignature();
		const shouldRefreshSubmit = force || nextSubmitSignature !== __quizSubmitSlideSignature;
		const shouldRefreshResults = force || nextResultsSignature !== __quizResultsSlideSignature;
		if (!shouldRefreshSubmit && !shouldRefreshResults) return;

		const refreshMetaSlide = ({ selector, index, html, binder }: { selector: string; index: number; html: () => string; binder: (node: Element) => void }) => {
			const oldNode = ctx.container.querySelector(selector);
			if (!oldNode) return;
			ctx.viewport.unobserveTrackItemInAllSlidesResizeObserver(oldNode);
			ctx.bumpSlideGeneration(index);
			const tmp = document.createElement("div");
			tmp.innerHTML = html().trim();
			// La slide meta est toujours un div racine (HTMLElement) : cast pour mathifyElement.
			const newNode = tmp.firstElementChild as HTMLElement | null;
			if (!newNode) return;
			oldNode.replaceWith(newNode);
			// LaTeX des slides submit/results (récap des réponses).
			mathifyElement(newNode);
			ctx.viewport.observeTrackItemInAllSlidesResizeObserver(newNode);
			binder(newNode);
		};

		if (shouldRefreshSubmit) {
			refreshMetaSlide({
				selector: '.quiz-track-item[data-slide-kind="submit"]',
				index: ctx.SLIDE_SUBMIT_INDEX,
				html: submitSlideHtml,
				binder: ctx.interactions.bindSubmitSlideControls
			});
			__quizSubmitSlideSignature = nextSubmitSignature;
		}
		if (shouldRefreshResults) {
			refreshMetaSlide({
				selector: '.quiz-track-item[data-slide-kind="results"]',
				index: ctx.SLIDE_RESULTS_INDEX,
				html: resultsSlideHtml,
				binder: ctx.interactions.bindResultsSlideControls
			});
			__quizResultsSlideSignature = nextResultsSignature;
		}

		ctx.viewport.applyTrackGeometry({ refreshWidth: false });
		ctx.viewport.syncTrackViewportIsolation();
		const { track } = ctx.viewport.getTrackElements();
		if (track && (ctx.quizState.current === ctx.SLIDE_SUBMIT_INDEX || ctx.quizState.current === ctx.SLIDE_RESULTS_INDEX)) {
			track.style.transition = "none";
			ctx.track.setTrackTransformPx(ctx.track.getSlideTranslateX(ctx.quizState.current));
			ctx.viewport.__quizSlideHeightCache?.delete(ctx.quizState.current);
			ctx.viewport.scheduleViewportHeightSync({ index: ctx.quizState.current, animate: false, refresh: true });
		}
	}

	function questionCardHtml(qi: number): string {
		const q = ctx.quiz[qi];
		const isTextOnly = ctx.textOnly?.isTextOnlyMode?.();
		const isTxt = ctx.isTextQuestion(q);
		const isCloze = ctx.isClozeQuestion(q);
		const isOrd = ctx.isOrderingQuestion(q);
		const isMatch = ctx.isMatchingQuestion(q);
		// q.multiSelect n'existe que sur QCM/choix multiple : lecture uniforme via
		// cast (undefined→false pour les autres variantes, jamais lu hors branche QCM).
		const isMulti = !!(q as { multiSelect?: boolean }).multiSelect;

		let body = "";

		if (isTextOnly) {
			body = ctx.textOnly.questionCardBodyHtml(q, qi);
		}
		// Casts guidés par les prédicats isTxt/isOrd/isMatch (évalués en amont,
		// iso-fonctionnels) : la branche garantit la variante, le cast la nomme.
		else if (isCloze) {
			body = ctx.cloze.clozeCardHtml(q as ClozeQuestion, qi);
		}
		else if (isTxt) {
			body = ctx.terminal.textQuestionCardHtml(q as TextQuestion, qi);
		}
		else if (isOrd) {
			body = orderingCardHtml(q as OrderingQuestion, qi);
		}
		else if (isMatch) {
			body = matchingCardHtml(q as MatchingQuestion, qi);
		}
		else {
			const qcm = q as QcmQuestion | MultiSelectQuestion;
			const smap = (ctx.quizState.shuffleMap[qi] as number[]) || [];
			const mi = isMulti ? `<div class="quiz-multi-indicator">${t("engine.qcm.multiHint")}</div>` : "";
			const sel = ctx.quizState.selections[qi];
			const optionsHtml = smap.map((oi) => {
				const contentHtml = optionContentHtml(qcm, oi);
				// aria-pressed reflète l'état sélectionné pour les lecteurs d'écran (recalculé
				// à chaque refreshQuestionSlide). role=button + aria-pressed plutôt que radio/
				// checkbox pour ne pas capturer les flèches (réservées à la navigation).
				const isSelected = isMulti ? (sel instanceof Set && sel.has(oi)) : (sel === oi);
				return `<div class="quiz-option ${isMulti ? "multi" : ""} ${optionClass(qi, oi)}" role="button" tabindex="0" aria-pressed="${isSelected}" data-orig="${oi}">${contentHtml}</div>`;
			}).join("");
			const hasImg = /<img[\s>]/i.test(optionsHtml);
			body = mi + `<div class="quiz-options-wrap${hasImg ? " quiz-options-image-grid" : ""}">${optionsHtml}</div>`;
		}

		const hintBtn = (!isTextOnly && q.hint && String(q.hint).trim()) ? `<button class="quiz-hint-btn" type="button">${t("engine.hint.button")}</button>` : "";
		const learnSection = (!isTextOnly && ctx.quizMode === "learn" && (q.learn || q.learnHtml || q._learnHtml) && !ctx.quizState.locked)
			? (() => {
				const learnHtml = q.learnHtml || q._learnHtml;
				const learnContent = learnHtml
					? ctx.sanitize.replaceObsidianEmbedsInHtml(learnHtml)
					: ctx.sanitize.renderTextWithEmbeds(q.learn || "");
				return `<div class="quiz-learn-section"><div class="quiz-learn-label">${t("engine.learn.label")}</div><div class="quiz-learn-content">${learnContent}</div></div>`;
			})()
			: "";
		const textOnlyActions = isTextOnly ? ctx.textOnly.questionActionsHtml(qi) : "";
		const sectionIdAttr = (typeof q?.id === "string" && q.id.trim().length > 0)
			? ` id="${ctx.escapeHtmlAttr(q.id)}"`
			: "";

		// Le support de compréhension précède le titre : on lit le document AVANT
		// de savoir ce qu'on nous en demande, comme sur un sujet d'examen papier.
		const passageSection = ctx.passage.passageHtml(qi);

		return `<div class="quiz-track-item" data-slide-kind="question" data-qi="${qi}">
			<section class="quiz-card"${sectionIdAttr}>
				${passageSection}
				<h2>${ctx.sanitize.renderInlineText(q.title)}</h2>
				${ctx.sanitize.resourceButtonHtml(q)}
				<div class="quiz-question">${renderQuizPromptHtml(q)}</div>
				${body}
				${learnSection}
				${hintBtn}
				${textOnlyActions}
				${!isTextOnly && ctx.quizState.locked ? explanationHtml(qi) : ""}
			</section>
		</div>`;
	}

	return {
		tabClass,
		navHtml,
		modeToggleHtml,
		startModeSelectorHtml,
		optionClass,
		optionContentHtml,
		explanationHtml,
		renderQuizPromptHtml,
		orderingCardHtml,
		matchingCardHtml,
		submitSlideHtml,
		resultsSlideHtml,
		refreshMetaSlides,
		questionCardHtml
	};
}
