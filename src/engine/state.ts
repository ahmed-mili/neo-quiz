import type { EngineCtx } from "../types/engine-ctx";
import type { PracticeMode, QuizResult, StatsRecord } from "../types/quiz";

/** Sous-ensemble du store de stats (dashboard/stats-store) réellement lu ici. */
type StatsStoreLike = { updateRecord(path: string, update: StatsRecord): unknown };

export interface StateHandlers {
	hasAnyAnswer(i: number): boolean;
	isComplete(i: number): boolean;
	getMissingIndices(): number[];
	isCorrect(i: number): boolean;
	computeScorePercent(): QuizResult;
	getSubmitSlideSignature(): string;
	getResultsSlideSignature(): string;
	setPracticeMode(mode: PracticeMode): void;
	clearNavTabPressState(tab: HTMLElement | null): void;
	setNavTabPressState(tab: HTMLElement | null, on: boolean): void;
	clearAllNavTabPressStates(): void;
	buildNavTabClass(baseClass: string, tab: HTMLElement | null | undefined): string;
	playNavTabPressAndNavigate(tab: HTMLElement | null, navigateFn: () => void, opts?: { fromKeyboard?: boolean }): Promise<void>;
	setSlidingClass(on: boolean): void;
	goToSlide(index: number, opts?: { forceRender?: boolean }): Promise<void>;
	redirectSlide(next: number, opts?: { forceRender?: boolean }): Promise<void>;
	updateNavHighlight(): void;
	goToQuestion(index: number): void;
	goToSubmit(): void;
	goToResults(): void;
	resetQuiz(opts?: { preserveSliding?: boolean; resetToOriginalMode?: boolean }): void;
}

export function createStateHandlers(ctx: EngineCtx): StateHandlers {
	// Constantes
	const NAV_TAB_PRESS_MS = 130;
	const NAV_TAB_FALLBACK_CLEAR_MS = 320;

	function hasAnyAnswer(i: number): boolean {
		// isTextOnlyFor(i), pas isTextOnlyMode() : une question "recall" de Leçon
		// stocke sa réponse dans textOnlyAnswers/textOnlyRatings, jamais dans
		// `selections` — sans cette bascule PAR QUESTION, une tranche mélangeant
		// "test" et "recall" verrait ses questions de restitution comptées
		// "sans réponse" quel que soit ce que l'utilisateur a écrit et évalué.
		if (ctx.textOnly?.isTextOnlyFor?.(i)) {
			return ctx.textOnly.hasAnyAnswer(i) || ctx.textOnly.isChecked(i) || ctx.textOnly.isRated(i);
		}

		const q = ctx.quiz[i], sel = ctx.quizState.selections[i];

		if (ctx.isTextQuestion(q)) {
			return typeof sel === "string" && sel.trim().length > 0;
		}

		// Texte à trous : un seul trou rempli suffit à dire que l'élève a
		// commencé (à distinguer d'`isComplete`, qui les exige tous).
		if (ctx.isClozeQuestion(q)) {
			return Array.isArray(sel) && sel.some(v => String(v ?? "").trim().length > 0);
		}

		if (ctx.isOrderingQuestion(q) || ctx.isMatchingQuestion(q)) {
			return Array.isArray(sel) && sel.some(v => v !== null);
		}

		if (q.multiSelect) return sel instanceof Set && sel.size > 0;
		return sel !== null;
	}

	function isComplete(i: number): boolean {
		// Une carte "read" (task 6b) n'a rien à répondre : elle est toujours
		// considérée complète, pour ne jamais apparaître dans getMissingIndices
		// (donc ne bloquer ni la navigation, ni l'écran de soumission).
		if (ctx.isLessonMode() && ctx.roleOfQuestion(i) === "read") return true;

		// Même bascule PAR QUESTION que hasAnyAnswer ci-dessus.
		if (ctx.textOnly?.isTextOnlyFor?.(i)) {
			return ctx.textOnly.isRated(i);
		}

		const q = ctx.quiz[i], sel = ctx.quizState.selections[i];

		if (ctx.isTextQuestion(q)) {
			return typeof sel === "string" && sel.trim().length > 0;
		}

		if (ctx.isClozeQuestion(q)) {
			return Array.isArray(sel) && sel.length > 0 && sel.every(v => String(v ?? "").trim().length > 0);
		}

		if (ctx.isOrderingQuestion(q) || ctx.isMatchingQuestion(q)) {
			return Array.isArray(sel) && sel.length > 0 && sel.every(v => v !== null);
		}

		if (q.multiSelect) return sel instanceof Set && sel.size > 0;
		return sel !== null;
	}

	function getMissingIndices(): number[] {
		const missing: number[] = [];
		for (let i = 0; i < ctx.quiz.length; i++) if (!isComplete(i)) missing.push(i);
		return missing;
	}

	function isCorrect(i: number): boolean {
		// Même bascule PAR QUESTION : le score d'une tranche mixte doit compter
		// une "recall" auto-évaluée "compris" comme juste, indépendamment du
		// mode global (qui reste "qcm" en Leçon, cf. Task 5).
		if (ctx.textOnly?.isTextOnlyFor?.(i)) {
			return ctx.quizState.textOnlyRatings?.[i] === "understood";
		}

		const q = ctx.quiz[i], sel = ctx.quizState.selections[i];

		if (ctx.isTextQuestion(q)) {
			return ctx.terminal.isTextAnswerCorrect(q, sel);
		}

		// Tout ou rien : un texte à trous n'est juste que si TOUS ses trous
		// le sont — un barème partiel serait une autre décision, à prendre
		// explicitement plutôt qu'à hériter par défaut.
		if (ctx.isClozeQuestion(q)) {
			return ctx.cloze.isClozeCorrect(q, sel);
		}

		if (ctx.isOrderingQuestion(q)) {
			const co = ctx.getOrderingCorrectOrder(q);
			if (!Array.isArray(sel) || sel.length !== co.length) return false;
			return co.every((v, k) => sel[k] === v);
		}

		if (ctx.isMatchingQuestion(q)) {
			const rows = ctx.getMatchRows(q), cm = ctx.getMatchCorrectMap(q);
			if (!Array.isArray(sel) || sel.length !== rows.length || !Array.isArray(cm) || cm.length !== rows.length) return false;
			return cm.every((v, k) => sel[k] === v);
		}

		if (q.multiSelect) {
			if (!(sel instanceof Set) || !Array.isArray(q.correctIndices) || sel.size !== q.correctIndices.length) return false;
			return q.correctIndices.every(ci => sel.has(ci));
		}

		return sel !== null && sel === q.correctIndex;
	}

	function computeScorePercent(): QuizResult {
		// Une carte "read" (task 6b) n'est ni juste ni fausse : elle sort du
		// dénominateur ET du numérateur, sinon elle abaisserait mécaniquement
		// le pourcentage final d'un quiz Leçon (une carte jamais "correcte").
		let correct = 0, total = 0;
		for (let i = 0; i < ctx.quiz.length; i++) {
			if (ctx.isLessonMode() && ctx.roleOfQuestion(i) === "read") continue;
			total++;
			if (isCorrect(i)) correct++;
		}
		/* FIX round 1 de revue task 6b (2026-09-01), FINDING 4 : un quiz VRAIMENT
		   vide (`ctx.quiz.length === 0`, aucune carte du tout) valait `NaN` AVANT
		   cette tâche (0/0 * 100) — ce chemin n'a rien à voir avec "read" et ne
		   doit STRICTEMENT rien changer ("hors mode leçon, rien ne change").
		   Le `pct: 100` n'est un choix assumé que pour une tranche qui existe
		   mais est ENTIÈREMENT "read" (`ctx.quiz.length > 0`, `total === 0`) :
		   distinction nécessaire pour ne pas faire déborder le cas générique
		   sur un quiz ordinaire vide, qui n'a jamais eu de rôle "read". */
		const pct = total > 0 ? Math.round((correct / total) * 100) : (ctx.quiz.length > 0 ? 100 : Math.round((correct / total) * 100));
		return { pct, correct, total };
	}

	const getSubmitSlideSignature = (): string => JSON.stringify({
		mode: ctx.quizState.practiceMode,
		examAnswerPhase: !!ctx.textOnly?.isExamAnswerPhase?.(),
		missingAnswers: ctx.textOnly?.isExamAnswerPhase?.()
			? ctx.quiz.map((_, i) => i).filter(i => !ctx.textOnly.hasAnyAnswer(i))
			: null,
		missing: getMissingIndices(),
		lastQuestionIndex: ctx.quizState.lastQuestionIndex
	});
	const getResultsSlideSignature = (): string => {
		if (ctx.textOnly?.isTextOnlyMode?.()) {
			return JSON.stringify({
				mode: ctx.quizState.practiceMode,
				results: ctx.textOnly.computeResults(),
				savedResultsPath: ctx.quizState.savedResultsPath || null
			});
		}
		const { pct, correct, total } = computeScorePercent();
		return JSON.stringify({ mode: ctx.quizState.practiceMode, locked: ctx.quizState.locked, pct, correct, total, savedResultsPath: ctx.quizState.savedResultsPath || null });
	};

	function clearNavTabPressState(tab: HTMLElement | null): void {
		if (!tab) return;
		if (tab.__quizPressClearTimer) {
			clearTimeout(tab.__quizPressClearTimer);
			tab.__quizPressClearTimer = 0;
		}
		delete tab.dataset.quizPressing;
		tab.classList.remove("is-pressing");
	}

	function setNavTabPressState(tab: HTMLElement | null, on: boolean): void {
		if (!tab) return;
		if (on) {
			if (tab.__quizPressClearTimer) {
				clearTimeout(tab.__quizPressClearTimer);
				tab.__quizPressClearTimer = 0;
			}
			tab.dataset.quizPressing = "1";
			tab.classList.add("is-pressing");
			tab.__quizPressClearTimer = window.setTimeout(() => clearNavTabPressState(tab), NAV_TAB_FALLBACK_CLEAR_MS);
			return;
		}
		clearNavTabPressState(tab);
	}

	const clearAllNavTabPressStates = (): void => {
		ctx.container.querySelectorAll<HTMLElement>(".quiz-tab").forEach(tab => clearNavTabPressState(tab));
	};
	const buildNavTabClass = (baseClass: string, tab: HTMLElement | null | undefined): string => `${baseClass}${tab?.dataset?.quizPressing === "1" ? " is-pressing" : ""}`.trim();

	async function playNavTabPressAndNavigate(tab: HTMLElement | null, navigateFn: () => void, { fromKeyboard = false }: { fromKeyboard?: boolean } = {}): Promise<void> {
		if (!tab || typeof navigateFn !== "function") return;

		if (fromKeyboard || tab.dataset.quizPressing !== "1") {
			clearAllNavTabPressStates();
			setNavTabPressState(tab, true);
		}

		navigateFn();

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				clearNavTabPressState(tab);
			});
		});
	}

	async function goToSlide(index: number, { forceRender = false }: { forceRender?: boolean } = {}): Promise<void> {
		ctx.closeHintModal();
		const next = ctx.clampSlideIndex(index);
		if (next === ctx.quizState.current && !ctx.quizState.isSliding) return;
		if (ctx.quizState.isSliding) return ctx.redirectSlide(next, { forceRender });
		++ctx.quizState.slideToken;
		const token = ctx.quizState.slideToken;
		ctx.quizState.prevCurrent = ctx.quizState.current;
		ctx.quizState.current = next;
		// isQuestionSlideIndex garantit la variante « question » de slideMap[next].
		if (ctx.isQuestionSlideIndex(next)) ctx.quizState.lastQuestionIndex = (ctx.slideMap[next] as { questionIndex: number }).questionIndex;
		updateNavHighlight();
		ctx.quizState.isSliding = true;
		ctx.setSlidingClass(true);
		if (forceRender) ctx.render();
		await Promise.allSettled([
			ctx.warmSlideForAccurateHeight(ctx.quizState.prevCurrent),
			ctx.warmSlideForAccurateHeight(ctx.quizState.current)
		]);
		if (token !== ctx.quizState.slideToken) return;
		ctx.track.animateTrackToIndex(ctx.quizState.current, {
			fromX: ctx.track.getSlideTranslateX(ctx.quizState.prevCurrent),
			fromHeight: Math.max(
				ctx.viewport.getSlideStableHeight(ctx.quizState.prevCurrent, { refresh: true }) || 0,
				Math.ceil(ctx.viewport.getTrackElements().viewport?.getBoundingClientRect?.().height || 0),
				Math.ceil(ctx.viewport.getTrackElements().viewport?.clientHeight || 0)
			),
			refreshTargetHeight: true
		});
	}

	async function redirectSlide(next: number, { forceRender = false }: { forceRender?: boolean } = {}): Promise<void> {
		const targetIndex = ctx.clampSlideIndex(next);
		if (targetIndex === ctx.quizState.current) return;
		const snapshot = ctx.track.cancelRunningTrackAnimation();
		++ctx.quizState.slideToken;
		const token = ctx.quizState.slideToken;
		ctx.quizState.prevCurrent = ctx.quizState.current;
		ctx.quizState.current = targetIndex;
		if (ctx.isQuestionSlideIndex(targetIndex)) ctx.quizState.lastQuestionIndex = (ctx.slideMap[targetIndex] as { questionIndex: number }).questionIndex;
		updateNavHighlight();
		ctx.quizState.isSliding = true;
		ctx.setSlidingClass(true);
		if (forceRender) ctx.render();
		await ctx.warmSlideForAccurateHeight(ctx.quizState.current).catch(() => {});
		if (token !== ctx.quizState.slideToken) return;
		ctx.track.animateTrackToIndex(ctx.quizState.current, { fromX: snapshot.x, fromHeight: snapshot.height, refreshTargetHeight: true });
	}

	function setSlidingClass(on: boolean): void {
		ctx.container?.classList?.toggle("quiz-is-sliding", !!on);
	}

	function updateNavHighlight(): void {
		ctx.container.querySelectorAll<HTMLElement>("[data-nav]").forEach(tab => {
			const i = Number(tab.dataset.nav);
			tab.className = buildNavTabClass(`quiz-tab ${ctx.cards.tabClass(i)}`.trim(), tab);
		});
		const resultsTab = ctx.container.querySelector<HTMLElement>("[data-nav-results]");
		if (resultsTab) {
			const active = (ctx.isSubmitSlideIndex(ctx.quizState.current) || ctx.isResultsSlideIndex(ctx.quizState.current)) ? "active" : "";
			resultsTab.className = buildNavTabClass(`quiz-tab is-result ${active}`.trim(), resultsTab);
		}
	}

	function setPracticeMode(mode: PracticeMode): void {
		const nextMode: PracticeMode = mode === "text" ? "text" : "qcm";
		if (ctx.quizState.practiceMode === nextMode) return;

		ctx.closeHintModal();
		ctx.quizState.practiceMode = nextMode;
		ctx.quizState.pendingResultsLock = false;
		// Recommencer, c'est une NOUVELLE session : elle a le droit d'être
		// comptée à son tour.
		ctx.quizState.resultsCounted = false;
		ctx.quizState.savedResultsPath = null;
		if (nextMode === "text") ctx.stopExamTimer?.();

		if (ctx.isSubmitSlideIndex(ctx.quizState.current) || ctx.isResultsSlideIndex(ctx.quizState.current)) {
			const fallbackQi = Math.max(0, Math.min(ctx.quizState.lastQuestionIndex || 0, ctx.quiz.length - 1));
			const slideIdx = ctx.getSlideIndexForQuestion(fallbackQi);
			ctx.quizState.current = slideIdx >= 0 ? slideIdx : 0;
			ctx.quizState.prevCurrent = ctx.quizState.current;
		}

		ctx.quizState.slideToken++;
		ctx.quizState.isSliding = false;
		ctx.container?.classList?.toggle("quiz-is-locked", ctx.quizState.locked && nextMode !== "text");
		ctx.render();
	}

	const goToQuestion = (index: number): void => {
		ctx.quizState.pendingResultsLock = false;
		const slideIdx = ctx.getSlideIndexForQuestion(index);
		if (slideIdx >= 0) goToSlide(slideIdx, { forceRender: false });
	};

	function goToSubmit(): void {
		if (ctx.isQuestionSlideIndex(ctx.quizState.current)) ctx.quizState.lastQuestionIndex = (ctx.slideMap[ctx.quizState.current] as { questionIndex: number }).questionIndex;
		ctx.quizState.pendingResultsLock = false;
		goToSlide(ctx.SLIDE_SUBMIT_INDEX, { forceRender: false });
	}

	function goToResults(): void {
		if (ctx.isQuestionSlideIndex(ctx.quizState.current)) ctx.quizState.lastQuestionIndex = (ctx.slideMap[ctx.quizState.current] as { questionIndex: number }).questionIndex;
		ctx.quizState.pendingResultsLock = !ctx.textOnly?.isTextOnlyMode?.();

		if (ctx.isExamMode && ctx.examStarted && !ctx.examEnded) {
			ctx.examEnded = true;
			ctx.stopExamTimer();
			ctx.updateExamTimerDisplay();
		}

		/* Stats du dashboard. Le mode TEXTE compte lui aussi : travailler tous
		   les jours en mode leçon ne mettait a jour ni progression, ni derniere
		   activite, ni nombre de tentatives — le dashboard restait muet sur
		   l'essentiel du travail (revue codex 2026-07-31).
		   Son score, lui, n'est pas enregistre : en mode texte, la correction
		   est une AUTO-EVALUATION, et la ranger a cote des scores d'un QCM les
		   rendrait incomparables. `updateRecord` prend le maximum, donc un 0 ne
		   peut pas abaisser un score existant.
		   FINDING 1 (round 1 de revue Task 5, 2026-08-31) : `isTextOnlyMode()`
		   seule valait FAUX en mode Lecon (practiceMode y reste "qcm"), y compris
		   quand une ou plusieurs questions "recall" du mix sont jugees par
		   auto-evaluation — `isCorrect(i)` (plus haut dans ce fichier) y compte
		   deja ces auto-evaluations comme des reponses justes. Sans correction,
		   une session de Lecon aurait ecrit un `bestScore` reel qui melangeait
		   scoring QCM et auto-evaluation, exactement ce que le paragraphe
		   ci-dessus interdit. `isTextOnlyForAny()` (engine/text-only.ts) est
		   VRAIE des qu'UNE SEULE question du quiz est actuellement auto-evaluee,
		   pas seulement quand elles le sont toutes.
		   `resultsCounted` : `goToResults` n'etait pas protege contre un double
		   clic, et « Voir le score » comptait alors deux tentatives pour une
		   seule session. */
		const statsStore = (ctx.plugin as { _statsStore?: StatsStoreLike })._statsStore;
		if (!ctx.quizState.resultsCounted && statsStore && ctx.sourcePath) {
			ctx.quizState.resultsCounted = true;
			const modeTexte = !!ctx.textOnly?.isTextOnlyForAny?.();
			const { pct, total } = computeScorePercent();
			/* FIX round 1 de revue task 6b (2026-09-01) : `questionsDone` comptait
			   TOUTES les cartes (0..ctx.quiz.length), alors que `total` ci-dessus
			   EXCLUT deja les cartes "read" (elles n'ont pas de reponse) —
			   une tranche read+test produisait "2/1", une progression au-dessus
			   de 100% au tableau de bord. Les deux compteurs doivent porter sur
			   le MEME ensemble : on saute une carte "read" ici aussi, exactement
			   comme `computeScorePercent` le fait pour `total`. */
			let questionsDone = 0;
			for (let i = 0; i < ctx.quiz.length; i++) {
				if (ctx.isLessonMode() && ctx.roleOfQuestion(i) === "read") continue;
				if (isComplete(i)) questionsDone++;
			}
			statsStore.updateRecord(ctx.sourcePath, {
				bestScore: modeTexte ? 0 : pct,
				questionsDone,
				totalQuestions: total || ctx.quiz.length
			});
		}

		updateNavHighlight();
		goToSlide(ctx.SLIDE_RESULTS_INDEX, { forceRender: false });
	}

	function resetQuiz({ preserveSliding = false, resetToOriginalMode = false }: { preserveSliding?: boolean; resetToOriginalMode?: boolean } = {}): void {
		ctx.closeHintModal();
		ctx.track.clearTrackTransitionFallback();
		ctx.viewport.destroyActiveSlideResizeObserver();
		ctx.viewport.destroyAllSlidesResizeObserver();
		ctx.viewport.destroyViewportResizeObserver();
		ctx.clearBackgroundWarmIdleHandle();
		ctx.cancelEnsureTrackVisibleRaf();

		ctx.__quizBackgroundWarmStarted = false;

		ctx.quizState.selections = ctx.initSelections();
		ctx.quizState.textOnlyAnswers = ctx.initTextOnlyAnswers();
		ctx.quizState.textOnlyChecked = ctx.initTextOnlyChecked();
		ctx.quizState.textOnlyRatings = ctx.initTextOnlyRatings();
		ctx.quizState.current = 0;
		ctx.quizState.prevCurrent = 0;
		ctx.quizState.lastQuestionIndex = 0;
		ctx.quizState.locked = false;
		ctx.container?.classList?.remove("quiz-is-locked");
		ctx.quizState.pendingResultsLock = false;
		ctx.quizState.savedResultsPath = null;
		ctx.quizState.shuffleMap = ctx.buildShuffleMap();
		ctx.quizState.orderingPick = ctx.initOrderingPicks();
		ctx.quizState.matchPick = ctx.initMatchPicks();
		ctx.quizState.slideToken++;

		if (!preserveSliding) ctx.quizState.isSliding = false;
		ctx.setSlidingClass(false);

		ctx.__quizSlideHeightCache?.clear();
		ctx.__quizWarmSlidePromises?.clear();
		// Repli/repli-par-défaut du support de compréhension (Task 4, mode Leçon) :
		// à côté des autres .clear() de session, pour qu'un futur ajout d'état de
		// session pense à en faire autant — round 1 de revue, sans ça un
		// « recommencer » retrouvait un support déjà semé de la session précédente.
		ctx.passage.resetPassageState();

		ctx.examStarted = false;
		ctx.examEnded = false;
		ctx.examStartTime = 0;
		ctx.stopExamTimer();

		// Réinitialiser au mode d'origine si demandé
		if (resetToOriginalMode && ctx.originalQuizMode === "lesson") {
			ctx.trainingSession = false;
			ctx.quizMode = "lesson";
			ctx.isExamMode = false;
			ctx.examOptions = null;
			ctx.examDurationMs = 0;
			ctx.lessonExamOptions = ctx.originalLessonExamOptions;
			ctx.examTimeRemaining = 0;
		} else {
			ctx.examTimeRemaining = ctx.isExamMode ? ctx.examDurationMs : 0;
		}

		ctx.render();
	}

	return {
		hasAnyAnswer,
		isComplete,
		getMissingIndices,
		isCorrect,
		computeScorePercent,
		getSubmitSlideSignature,
		getResultsSlideSignature,
		setPracticeMode,
		clearNavTabPressState,
		setNavTabPressState,
		clearAllNavTabPressStates,
		buildNavTabClass,
		playNavTabPressAndNavigate,
		setSlidingClass,
		goToSlide,
		redirectSlide,
		updateNavHighlight,
		goToQuestion,
		goToSubmit,
		goToResults,
		resetQuiz
	};
}
