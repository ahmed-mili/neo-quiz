import type { DataAdapter } from "obsidian";
import type { EngineCtx, QuizMode } from "../types/engine-ctx";
import type {
	QuizQuestion,
	QcmQuestion,
	MultiSelectQuestion,
	TextQuestion,
	ClozeQuestion,
	OrderingQuestion,
	MatchingQuestion,
} from "../types/quiz";
import { t } from "../i18n";
import { reserveFreePath } from "../unique-path";

export interface OptionEntry {
	index: number;
	text: string;
}

export interface QuestionResult {
	index: number;
	id: string | null;
	title: string;
	kind: string;
	promptText: string;
	answer: unknown;
	learnText: string;
	explanationText: string;
}

export interface ResultsPayload {
	schemaVersion: number;
	plugin: string;
	savedAt: string;
	sourcePath: string | null;
	quizMode: QuizMode;
	practiceMode: string;
	quizTitle: string;
	exam: {
		enabled: boolean;
		started: boolean;
		ended: boolean;
		durationMinutes: number | null;
		elapsedSeconds: number | null;
		remainingSeconds: number | null;
	};
	summary: Record<string, unknown>;
	questions: QuestionResult[];
}

export interface SavedResults {
	path: string;
	absolutePath: string;
}

export interface ResultsSaverHandlers {
	RESULTS_DIR: string;
	buildPayload(): ResultsPayload;
	saveCurrentResults(): Promise<SavedResults>;
}

export function createResultsSaver(ctx: EngineCtx): ResultsSaverHandlers {
	const RESULTS_DIR = ".obsidian/quiz-blocks-results";

	function normalizeSpace(value: unknown): string {
		return String(value ?? "").replace(/\s+/g, " ").trim();
	}

	/* Le HTML d'un quiz n'est pas forcément le nôtre : un quiz PARTAGÉ arrive
	   avec les `explainHtml` de son auteur. `div.innerHTML = …` construisait un
	   arbre VIVANT dans le document courant — un `<img src=x onerror=…>` s'y
	   charge et déclenche son gestionnaire, même hors de l'arbre affiché
	   (standard HTML). `<template>` a un « document propriétaire inerte » :
	   les ressources n'y sont pas chargées, les scripts pas exécutés. On n'y
	   lit que du texte, ce qui est tout ce qu'on voulait. */
	function htmlToText(html: unknown): string {
		if (!html) return "";
		if (typeof document !== "undefined" && document.createElement) {
			const tpl = document.createElement("template");
			tpl.innerHTML = String(html);
			return normalizeSpace(tpl.content.textContent || "");
		}
		return normalizeSpace(String(html).replace(/<[^>]*>/g, " "));
	}

	function markdownLikeToText(value: unknown): string {
		return normalizeSpace(String(value ?? "")
			.replace(/!\[\[([^\]]+)\]\]/g, "$1")
			.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m: string, page: string, label: string) => label || page)
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
			.replace(/[`*_>#-]+/g, " "));
	}

	function firstText(...values: unknown[]): string {
		for (const value of values) {
			if (value === null || value === undefined) continue;
			const text = typeof value === "string" && /<[^>]+>/.test(value)
				? htmlToText(value)
				: markdownLikeToText(value);
			if (text) return text;
		}
		return "";
	}

	function slugify(value: unknown): string {
		const slug = String(value ?? "quiz")
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80);
		return slug || "quiz";
	}

	function pad(n: number): string {
		return String(n).padStart(2, "0");
	}

	function formatLocalTimestamp(date: Date = new Date()): string {
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
	}

	function sourceBaseName(): string {
		const sourcePath = String(ctx.sourcePath || "quiz");
		const fileName = sourcePath.split(/[\\/]/).pop() || sourcePath;
		return fileName.replace(/\.[^.]+$/, "") || "quiz";
	}

	function getQuestionKind(q: QuizQuestion): string {
		if (ctx.isClozeQuestion(q)) return "cloze";
		if (ctx.isTextQuestion(q)) return "text";
		if (ctx.isOrderingQuestion(q)) return "ordering";
		if (ctx.isMatchingQuestion(q)) return "matching";
		if ((q as { multiSelect?: boolean }).multiSelect) return "multiple-choice";
		return "single-choice";
	}

	function getQuestionPromptText(q: QuizQuestion): string {
		return firstText(q?.prompt, q?.promptHtml, q?._promptHtml);
	}

	function getLearnText(q: QuizQuestion): string {
		return firstText(q?.learn, q?.learnHtml, q?._learnHtml);
	}

	function getExplanationText(q: QuizQuestion): string {
		return firstText(q?.explain, q?.explainHtml, q?._explainHtml);
	}

	function optionEntry(q: QcmQuestion | MultiSelectQuestion, index: number): OptionEntry {
		const options = Array.isArray(q?.options) ? q.options : [];
		const optionHtml = Array.isArray(q?.optionHtml) ? q.optionHtml[index] : null;
		const text = firstText(options[index], optionHtml);
		return {
			index,
			text: text || `Option ${index + 1}`
		};
	}

	function optionEntries(q: QcmQuestion | MultiSelectQuestion, indices: number[]): OptionEntry[] {
		return indices
			.filter(index => Number.isInteger(index) && index >= 0)
			.map(index => optionEntry(q, index));
	}

	function getCorrectOptionIndices(q: QcmQuestion | MultiSelectQuestion): number[] {
		if (ctx.textOnly?.getCorrectOptionIndices) return ctx.textOnly.getCorrectOptionIndices(q);
		if (q?.multiSelect && Array.isArray(q.correctIndices)) return q.correctIndices.map(Number).filter(Number.isInteger);
		const index = Number((q as QcmQuestion).correctIndex);
		return Number.isInteger(index) ? [index] : [];
	}

	function buildTextQuestionResult(q: TextQuestion, qi: number) {
		const sel = ctx.quizState.selections?.[qi];
		const userAnswer = typeof sel === "string" ? sel : "";
		const acceptedAnswers = ctx.terminal?.getTextAcceptedAnswers?.(q) || [];
		return {
			userAnswer,
			acceptedAnswers,
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	/* Texte à trous : la correction est trou par trou — un « faux » global ne
	   dit pas lequel a manqué, ce que l'élève relit d'abord. */
	function buildClozeResult(q: ClozeQuestion, qi: number) {
		const selRaw = ctx.quizState.selections?.[qi];
		const selected = Array.isArray(selRaw) ? selRaw : [];
		const blanks = ctx.cloze.getBlanks(q);
		return {
			blanks: blanks.map((blank, index) => ({
				index,
				userAnswer: String(selected[index] ?? ""),
				acceptedAnswers: blank.answers,
				isCorrect: ctx.cloze.isBlankCorrect(q, index, selected[index])
			})),
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	function buildOrderingResult(q: OrderingQuestion, qi: number) {
		const items = ctx.getOrderingItems(q);
		// Variante garantie par l'appelant (buildQcmAnswer) ⇒ sélection à
		// emplacements : des indices, jamais les chaînes du texte à trous.
		const selRaw = ctx.quizState.selections?.[qi];
		const selected: Array<number | null> = Array.isArray(selRaw) ? (selRaw as Array<number | null>) : [];
		const correctOrder = ctx.getOrderingCorrectOrder(q);
		return {
			userOrder: selected.map(index => ({
				index,
				// index est un entier valide dans cette branche (garde Number.isInteger).
				text: index !== null && Number.isInteger(index) && index >= 0 ? String(items[index] ?? "") : null
			})),
			correctOrder: correctOrder.map(index => ({
				index,
				text: Number.isInteger(index) && index >= 0 ? String(items[index] ?? "") : null
			})),
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	function buildMatchingResult(q: MatchingQuestion, qi: number) {
		const rows = ctx.getMatchRows(q);
		const choices = ctx.getMatchChoices(q);
		// Idem buildOrderingResult : indices d'emplacements.
		const selRaw = ctx.quizState.selections?.[qi];
		const selected: Array<number | null> = Array.isArray(selRaw) ? (selRaw as Array<number | null>) : [];
		const correctMap = ctx.getMatchCorrectMap(q);
		return {
			userMatches: rows.map((row, i) => {
				const choiceIndex = selected[i];
				return {
					row,
					choiceIndex,
					choice: choiceIndex !== null && choiceIndex !== undefined && Number.isInteger(choiceIndex) && choiceIndex >= 0 ? String(choices[choiceIndex] ?? "") : null
				};
			}),
			correctMatches: rows.map((row, i) => {
				const choiceIndex: number | null = Array.isArray(correctMap) ? correctMap[i] : null;
				return {
					row,
					choiceIndex,
					choice: choiceIndex !== null && Number.isInteger(choiceIndex) && choiceIndex >= 0 ? String(choices[choiceIndex] ?? "") : null
				};
			}),
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	function buildChoiceResult(q: QcmQuestion | MultiSelectQuestion, qi: number) {
		const selected = ctx.quizState.selections?.[qi];
		const correctIndices = getCorrectOptionIndices(q);
		if (q?.multiSelect) {
			const selectedIndices = selected instanceof Set ? Array.from(selected) : [];
			return {
				selectedAnswers: optionEntries(q, selectedIndices),
				correctAnswers: optionEntries(q, correctIndices),
				isCorrect: !!ctx.isCorrect?.(qi)
			};
		}

		const selectedIndex = typeof selected === "number" && Number.isInteger(selected) ? selected : null;
		return {
			selectedAnswer: selectedIndex === null ? null : optionEntry(q, selectedIndex),
			correctAnswer: correctIndices.length ? optionEntry(q, correctIndices[0]) : null,
			isCorrect: !!ctx.isCorrect?.(qi)
		};
	}

	function buildQcmAnswer(q: QuizQuestion, qi: number) {
		if (ctx.isClozeQuestion(q)) return buildClozeResult(q, qi);
		if (ctx.isTextQuestion(q)) return buildTextQuestionResult(q, qi);
		if (ctx.isOrderingQuestion(q)) return buildOrderingResult(q, qi);
		if (ctx.isMatchingQuestion(q)) return buildMatchingResult(q, qi);
		return buildChoiceResult(q, qi);
	}

	function buildTextOnlyAnswer(q: QuizQuestion, qi: number) {
		const rating = ctx.textOnly?.normalizeRating?.(ctx.quizState.textOnlyRatings?.[qi]) || null;
		const ratingMeta = ctx.textOnly?.getRatingMeta?.(rating);
		return {
			freeTextAnswer: String(ctx.quizState.textOnlyAnswers?.[qi] ?? ""),
			checked: !!ctx.textOnly?.isChecked?.(qi),
			selfEvaluation: rating ? {
				value: rating,
				label: ratingMeta?.label || rating
			} : null,
			expectedAnswers: buildExpectedAnswers(q)
		};
	}

	function buildExpectedAnswers(q: QuizQuestion): unknown {
		if (ctx.isClozeQuestion(q)) {
			// Une entrée par TROU, dans l'ordre du gabarit : une correction de
			// texte à trous se lit trou par trou, pas comme une réponse unique.
			return ctx.cloze.getClozeAnswers(q).map((text, index) => ({ index, text }));
		}

		if (ctx.isTextQuestion(q)) {
			const acceptedAnswers = ctx.terminal?.getTextAcceptedAnswers?.(q) || [];
			return acceptedAnswers.map((text, index) => ({ index, text: String(text) }));
		}

		if (ctx.isOrderingQuestion(q)) {
			const items = ctx.getOrderingItems(q);
			return ctx.getOrderingCorrectOrder(q).map((index, orderIndex) => ({
				orderIndex,
				index,
				text: String(items[index] ?? "")
			}));
		}

		if (ctx.isMatchingQuestion(q)) {
			const rows = ctx.getMatchRows(q);
			const choices = ctx.getMatchChoices(q);
			const correctMap = ctx.getMatchCorrectMap(q);
			return rows.map((row, index) => {
				const choiceIndex: number | null = Array.isArray(correctMap) ? correctMap[index] : null;
				return {
					row,
					choiceIndex,
					text: choiceIndex !== null && Number.isInteger(choiceIndex) && choiceIndex >= 0 ? String(choices[choiceIndex] ?? "") : null
				};
			});
		}

		return optionEntries(q, getCorrectOptionIndices(q));
	}

	function buildQuestionResult(q: QuizQuestion, qi: number, mode: string): QuestionResult {
		return {
			index: qi + 1,
			id: q?.id || null,
			title: q?.title || `Question ${qi + 1}`,
			kind: getQuestionKind(q),
			promptText: getQuestionPromptText(q),
			answer: mode === "training" ? buildTextOnlyAnswer(q, qi) : buildQcmAnswer(q, qi),
			learnText: getLearnText(q),
			explanationText: getExplanationText(q)
		};
	}

	function buildSummary(mode: string): Record<string, unknown> {
		if (mode === "training") {
			return {
				mode,
				...ctx.textOnly.computeResults()
			};
		}

		const score = ctx.computeScorePercent();
		let answered = 0;
		for (let i = 0; i < ctx.quiz.length; i++) {
			if (ctx.hasAnyAnswer(i)) answered++;
		}
		return {
			mode,
			...score,
			answered
		};
	}

	/* Le payload est un ARTEFACT DE DONNÉES (JSON versionné par schemaVersion,
	   écrit dans RESULTS_DIR), pas de l'UI : ses clés, ses `kind` (« text »,
	   « ordering »…) et ses libellés de repli (« Option 3 », « Question 2 ») ne
	   passent PAS par le dictionnaire — les traduire rendrait deux exports de la
	   même session illisibles côté outillage. Seul `selfEvaluation.label` suit la
	   langue de l'UI : c'est le doublon lisible de `selfEvaluation.value`, qui
	   reste la clé stable (« understood » / « partial » / « review »). */
	function buildPayload(): ResultsPayload {
		const mode = ctx.textOnly?.isTextOnlyMode?.() ? "training" : "qcm";
		const now = new Date();
		const elapsedMs = ctx.examStartTime ? Math.max(0, Date.now() - ctx.examStartTime) : null;

		return {
			schemaVersion: 1,
			plugin: "quiz-blocks",
			savedAt: now.toISOString(),
			sourcePath: ctx.sourcePath || null,
			quizMode: ctx.quizMode,
			practiceMode: mode,
			quizTitle: sourceBaseName(),
			exam: {
				enabled: !!ctx.isExamMode,
				started: !!ctx.examStarted,
				ended: !!ctx.examEnded,
				durationMinutes: ctx.examOptions?.durationMinutes ?? null,
				elapsedSeconds: elapsedMs === null ? null : Math.round(elapsedMs / 1000),
				remainingSeconds: Number.isFinite(ctx.examTimeRemaining) ? Math.round(ctx.examTimeRemaining / 1000) : null
			},
			summary: buildSummary(mode),
			questions: ctx.quiz.map((q, i) => buildQuestionResult(q, i, mode))
		};
	}

	async function ensureFolder(adapter: DataAdapter, folderPath: string): Promise<void> {
		const parts = folderPath.split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!(await adapter.exists(current))) {
				await adapter.mkdir(current);
			}
		}
	}

	/**
	 * Chemin libre pour un fichier de résultats.
	 *
	 * Le suffixe est TIRÉ AU SORT, pas incrémenté : `exists` puis `write` n'est
	 * pas atomique, et deux fenêtres d'Obsidian sauvegardant le même quiz dans
	 * la même seconde choisissaient exactement le même `-2` — la seconde
	 * écrasait la première (revue codex 2026-07-31). Un compteur les fait
	 * converger ; le hasard les sépare.
	 */
	async function uniquePath(adapter: DataAdapter, basePath: string, ext: string): Promise<string> {
		/* `reserveFreePath` (src/unique-path.ts) : le nom est RÉSERVÉ en mémoire
		   en plus d'être testé sur le disque, et l'échec est bruyant. Un
		   `exists` puis `write` laissait deux sauvegardes du même quiz choisir
		   le même fichier, et la seconde écrasait la première. */
		return reserveFreePath(basePath, `.${ext}`,
			(chemin) => adapter.exists(chemin),
			() => `-${Math.random().toString(36).slice(2, 7)}`);
	}

	async function saveCurrentResults(): Promise<SavedResults> {
		const adapter = ctx.app?.vault?.adapter;
		if (!adapter || typeof adapter.write !== "function") {
			// Message affiché tel quel à l'élève (Notice « Erreur sauvegarde
			// résultats : … » dans interactions.ts) → traduit.
			throw new Error(t("engine.result.storageUnavailable"));
		}

		await ensureFolder(adapter, RESULTS_DIR);

		const payload = buildPayload();
		const timestamp = formatLocalTimestamp(new Date());
		const fileBase = `${RESULTS_DIR}/${timestamp}_${slugify(sourceBaseName())}_${payload.practiceMode}`;
		const path = await uniquePath(adapter, fileBase, "json");
		const json = `${JSON.stringify(payload, null, 2)}\n`;

		await adapter.write(path, json);
		try {
			await adapter.write(`${RESULTS_DIR}/latest.json`, `${JSON.stringify({ ...payload, savedResultPath: path }, null, 2)}\n`);
		} catch (_) { /* le fichier latest.json est un miroir best-effort */ }

		// `basePath` n'existe que sur FileSystemAdapter (desktop), absent du type DataAdapter.
		const basePath = (adapter as { basePath?: string }).basePath;
		return {
			path,
			absolutePath: basePath ? `${basePath}\\${path.replace(/\//g, "\\")}` : path
		};
	}

	return {
		RESULTS_DIR,
		buildPayload,
		saveCurrentResults
	};
}
