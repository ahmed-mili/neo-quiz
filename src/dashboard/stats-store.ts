import type { Plugin } from "obsidian";
import { t } from "../i18n";
import type { StatsRecord } from "../types/quiz";
import {
	createStoredMemoryCard,
	isReviewDue,
	scheduleReview,
	type ReviewRating,
	type StoredMemoryCard,
} from "../learning/scheduler";

/* ══════════════════════════════════════════════════════════
   STATS STORE — Stockage persistant des scores et progression
   Utilise plugin.settings.quizStats pour la persistance.
   Mises à jour en mémoire synchrones, sauvegarde debouncée.
══════════════════════════════════════════════════════════ */

/**
 * Enregistrement de stats persisté par quiz (data[path] ci-dessous) —
 * sur-ensemble de `StatsRecord` (types/quiz.ts, la forme d'entrée de
 * updateRecord) avec les 2 champs de suivi propres au store.
 */
export interface QuizStatRecord extends StatsRecord {
	lastPlayed: number;
	attempts: number;
	/** Mémoire espacée par question. Optionnel pour migrer les anciennes stats. */
	reviewItems?: Record<string, QuestionReviewRecord>;
}

export interface QuestionReviewRecord {
	card: StoredMemoryCard;
	introducedAt: number;
	lastReviewedAt: number;
	lastRating: ReviewRating | null;
	title?: string;
	conceptId?: string;
	sourcePage?: number;
}

export interface QuestionReviewMeta {
	title?: string;
	conceptId?: string;
	sourcePage?: number;
}

/**
 * Plugin hôte tel que réellement passé par plugin.js (`this._statsStore =
 * createStatsStore(this)`, plugin.js:766) : un `obsidian.Plugin` plus les 2
 * membres custom de InteractiveQuizPlugin lus/écrits ici. plugin.js reste en
 * .js (hors périmètre Task 8a) : ce type n'est donc vérifié qu'ici et côté
 * consommateurs .ts du store, pas au call-site réel (non typé, checkJs off).
 */
export interface StatsStorePlugin extends Plugin {
	settings: { quizStats?: Record<string, QuizStatRecord> };
	saveSettings(): Promise<void>;
}

export interface StatsStore {
	load(): void;
	updateRecord(path: string, update: StatsRecord): QuizStatRecord;
	getRecord(path: string): QuizStatRecord | null;
	getAll(): Record<string, QuizStatRecord>;
	deleteRecord(path: string): void;
	getQuestionReview(path: string, questionKey: string): QuestionReviewRecord | null;
	markQuestionIntroduced(path: string, questionKey: string, meta?: QuestionReviewMeta): QuestionReviewRecord;
	recordQuestionReview(path: string, questionKey: string, rating: ReviewRating, meta?: QuestionReviewMeta): QuestionReviewRecord;
	getDueCount(path?: string, now?: number): number;
	formatRelativeTime(timestamp: number): string;
	destroy(): void;
}

export function createStatsStore(plugin: StatsStorePlugin): StatsStore {
	const DEBOUNCE_MS = 500;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let data: Record<string, QuizStatRecord> = {}; // path → { bestScore, questionsDone, totalQuestions, lastPlayed, attempts }

	/* ── Charger les stats depuis les settings ── */
	function load(): void {
		data = plugin.settings.quizStats || {};
	}

	/* ── Debounced save ── */
	function scheduleSave(): void {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			plugin.settings.quizStats = data;
			plugin.saveSettings().catch(() => {});
			saveTimer = null;
		}, DEBOUNCE_MS);
	}

	/* ── Mettre à jour un enregistrement ── */
	function updateRecord(path: string, update: StatsRecord): QuizStatRecord {
		const existing: QuizStatRecord = data[path] || {
			bestScore: 0,
			questionsDone: 0,
			totalQuestions: 0,
			lastPlayed: 0,
			attempts: 0
		};

		data[path] = {
			bestScore: Math.max(existing.bestScore, update.bestScore || 0),
			questionsDone: Math.max(existing.questionsDone, update.questionsDone || 0),
			totalQuestions: update.totalQuestions || existing.totalQuestions,
			lastPlayed: Date.now(),
			attempts: existing.attempts + 1,
			// Une tentative classique ne doit jamais effacer l'historique FSRS.
			reviewItems: existing.reviewItems || {},
		};

		scheduleSave();
		return data[path];
	}

	/* ── Récupérer les stats d'un quiz ── */
	function getRecord(path: string): QuizStatRecord | null {
		return data[path] || null;
	}

	/* ── Récupérer toutes les stats ── */
	function getAll(): Record<string, QuizStatRecord> {
		return { ...data };
	}

	/* ── Supprimer les stats d'un quiz ── */
	function deleteRecord(path: string): void {
		if (data[path]) {
			delete data[path];
			scheduleSave();
		}
	}

	function ensureQuizRecord(path: string): QuizStatRecord {
		return data[path] ||= {
			bestScore: 0,
			questionsDone: 0,
			totalQuestions: 0,
			lastPlayed: 0,
			attempts: 0,
			reviewItems: {},
		};
	}

	function getQuestionReview(path: string, questionKey: string): QuestionReviewRecord | null {
		return data[path]?.reviewItems?.[questionKey] || null;
	}

	function markQuestionIntroduced(path: string, questionKey: string, meta: QuestionReviewMeta = {}): QuestionReviewRecord {
		const quiz = ensureQuizRecord(path);
		quiz.reviewItems ||= {};
		const existing = quiz.reviewItems[questionKey];
		if (existing) return existing;
		const now = Date.now();
		const record: QuestionReviewRecord = {
			card: createStoredMemoryCard(new Date(now)),
			introducedAt: now,
			lastReviewedAt: 0,
			lastRating: null,
			...meta,
		};
		quiz.reviewItems[questionKey] = record;
		scheduleSave();
		return record;
	}

	function recordQuestionReview(
		path: string,
		questionKey: string,
		rating: ReviewRating,
		meta: QuestionReviewMeta = {},
	): QuestionReviewRecord {
		const quiz = ensureQuizRecord(path);
		quiz.reviewItems ||= {};
		const now = Date.now();
		const existing = quiz.reviewItems[questionKey];
		const scheduled = scheduleReview(existing?.card, rating, new Date(now));
		const record: QuestionReviewRecord = {
			...existing,
			...meta,
			card: scheduled.card,
			introducedAt: existing?.introducedAt || now,
			lastReviewedAt: now,
			lastRating: rating,
		};
		quiz.reviewItems[questionKey] = record;
		quiz.lastPlayed = now;
		scheduleSave();
		return record;
	}

	function getDueCount(path?: string, now = Date.now()): number {
		const quizzes = path ? [data[path]].filter(Boolean) : Object.values(data);
		let count = 0;
		for (const quiz of quizzes) {
			for (const item of Object.values(quiz.reviewItems || {})) {
				if (item.lastReviewedAt > 0 && isReviewDue(item.card, now)) count++;
			}
		}
		return count;
	}

	/* ── Formater un timestamp en temps relatif ──
	   Appelée AU RENDU par les vues : les libellés suivent donc la langue
	   courante sans que le store ait à être reconstruit. */
	function formatRelativeTime(timestamp: number): string {
		if (!timestamp) return "—"; // tiret cadratin : pas de texte à traduire
		const diff = Date.now() - timestamp;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return t("dashboard.time.justNow");
		if (minutes < 60) return t("dashboard.time.minutes", { n: minutes });
		if (hours < 24) return t("dashboard.time.hours", { n: hours });
		if (days < 30) return t("dashboard.time.days", { n: days });
		if (days < 365) {
			// 1..12 mois → l'anglais accorde (« 1 month ago »), pas le français.
			const months = Math.floor(days / 30);
			return t(months === 1 ? "dashboard.time.monthsOne" : "dashboard.time.monthsOther", { n: months });
		}
		return t("dashboard.time.overYear");
	}

	/* ── Renommage : les stats suivent la note ──
	   Le store indexe par CHEMIN. Sans cette migration, renommer un quiz
	   (menu ⋯ « Rename », ou l'explorateur d'Obsidian) remettait sa
	   progression à zéro en apparence, et l'ancienne clé restait orpheline
	   dans data.json. Branché sur l'event du VAULT, pas sur l'action du menu :
	   les deux chemins de renommage sont couverts d'un coup. Un DOSSIER
	   renommé déplace aussi toutes les notes qu'il contient — d'où le préfixe.
	   registerEvent : le plugin détache l'écouteur à son unload. */
	plugin.registerEvent(plugin.app.vault.on("rename", (file, oldPath) => {
		const prefix = oldPath + "/";
		let moved = false;
		for (const key of Object.keys(data)) {
			if (key !== oldPath && !key.startsWith(prefix)) continue;
			const rec = data[key];
			delete data[key];
			data[key === oldPath ? file.path : file.path + key.slice(oldPath.length)] = rec;
			moved = true;
		}
		if (moved) scheduleSave();
	}));

	function destroy(): void {
		if (saveTimer) {
			clearTimeout(saveTimer);
			// Sauvegarde immédiate des données en attente
			plugin.settings.quizStats = data;
			plugin.saveSettings().catch(() => {});
		}
	}

	return {
		load,
		updateRecord,
		getRecord,
		getAll,
		deleteRecord,
		getQuestionReview,
		markQuestionIntroduced,
		recordQuestionReview,
		getDueCount,
		formatRelativeTime,
		destroy
	};
}
