import { TFile } from "obsidian";
import type { App, EventRef } from "obsidian";
import JSON5 from "json5";

/* ══════════════════════════════════════════════════════════
   QUIZ SCANNER — Indexeur de vault
   Scanne les fichiers markdown pour trouver les blocs quiz-blocks,
   extrait les métadonnées (titre, nombre de questions, types),
   et maintient un cache à jour via les events vault.
══════════════════════════════════════════════════════════ */

const QUIZ_FENCE_START = "```quiz-blocks";
const QUIZ_FENCE_END = "```";

/**
 * Tag de type de question détecté par le scan (parseQuizMeta ci-dessous).
 * Les branches `type === "ordering"` / `type === "matching"` ne matchent
 * jamais en pratique avec les quiz réellement exportés par l'éditeur
 * (editor/export.ts ne pose `type` que pour la variante texte, cf.
 * types/quiz.ts) — comportement de scanner.js préservé tel quel, pas « corrigé ».
 */
export type QuestionTypeTag = "single" | "multiple" | "text" | "ordering" | "matching";

/**
 * Type global d'un quiz — un TAG stable, pas un libellé.
 * Il est calculé au SCAN et gardé en cache (QuizIndexEntry) : y stocker le
 * libellé traduit l'aurait figé dans la langue du démarrage (le cache ne se
 * reconstruit qu'au rechargement du plugin), et un changement de langue aurait
 * fait diverger toutes les entrées du diff de scanFile ci-dessous. La
 * traduction se fait donc au rendu (quiz-card.ts, detail.ts) via la clé
 * « dashboard.quizType.<tag> ».
 */
export type QuizTypeTag = "mixed" | "single" | "multiple" | "text" | "ordering" | "matching";

/** Forme minimale lue sur un item brut du tableau JSON5 par le scanner (pas le
 * QuizQuestion complet de types/quiz.ts : parseQuizMeta ne lit que ces 3 champs). */
interface RawQuizItem {
	examMode?: boolean;
	learnMode?: boolean;
	mode?: string;
	prompt?: string;
	promptHtml?: string;
	multiSelect?: boolean;
	type?: string;
}

export type IndexedQuizMode = "learn" | "exam" | "quiz";

/** Métadonnées extraites d'un bloc quiz-blocks (parseQuizMeta). */
export interface QuizMeta {
	questions: number;
	types: QuestionTypeTag[];
	quizType: QuizTypeTag;
	quizMode: IndexedQuizMode;
}

/**
 * Entrée du cache du scanner (une par note contenant un bloc quiz-blocks).
 * `title` vaut toujours `file.basename` (seule valeur jamais assignée, dans
 * scanVault ET scanFile — scanFile.js d'origine omettait ce champ sur les
 * mises à jour incrémentales, un oubli de recopie qui rendait `quiz.title`
 * `undefined` après le premier `create`/`modify` ; corrigé ici en alignant
 * scanFile sur scanVault pour que le champ reste honnêtement non-optionnel).
 */
export interface QuizIndexEntry extends QuizMeta {
	path: string;
	basename: string;
	title: string;
	mtime: number;
}

/**
 * API du scanner de quiz, produite par createScanner(app) (dashboard.js
 * l'assigne à plugin._scanner, lu ensuite via DashboardView.scanner /
 * DashboardCtx.scanner).
 */
export interface Scanner {
	init(): Promise<void>;
	destroy(): void;
	scanVault(): Promise<void>;
	scanFile(file: TFile): Promise<void>;
	getQuizzes(): QuizIndexEntry[];
	getQuiz(path: string): QuizIndexEntry | null;
	getTotalQuestions(): number;
	onChange(callback: (quizzes: QuizIndexEntry[]) => void): () => void;
}

export function createScanner(app: App): Scanner {
	const cache = new Map<string, QuizIndexEntry>(); // path → entrée
	const listeners: Array<(quizzes: QuizIndexEntry[]) => void> = [];
	const vaultEventRefs: EventRef[] = []; // EventRef des app.vault.on(...) pour les retirer au destroy
	let scanning = false;

	/* ── Parse un bloc quiz-blocks pour extraire les métadonnées ── */
	function parseQuizMeta(source: string): QuizMeta | null {
		try {
			const parsed: unknown = JSON5.parse(source);
			if (!Array.isArray(parsed)) return null;

			// Ignorer toutes les formes de configuration finales. L'ancien filtre
			// ne connaissait que examMode et comptait { mode: "learn" } comme une
			// question supplémentaire dans le dashboard.
			const isModeConfig = (q: unknown): q is RawQuizItem => {
				if (!q || typeof q !== "object") return false;
				const item = q as RawQuizItem;
				return !item.prompt && !item.promptHtml
					&& (item.examMode === true || item.learnMode === true || typeof item.mode === "string");
			};
			let config: RawQuizItem | undefined;
			for (let i = parsed.length - 1; i >= 0; i--) {
				if (isModeConfig(parsed[i])) { config = parsed[i]; break; }
			}
			const questions = parsed.filter((q): q is RawQuizItem => {
				if (!q || typeof q !== "object") return false;
				return !isModeConfig(q);
			});

			if (questions.length === 0) return null;

			// Détecter les types de questions
			const typeSet = new Set<QuestionTypeTag>();
			for (const q of questions) {
				if (q.multiSelect) typeSet.add("multiple");
				else if (q.type === "text") typeSet.add("text");
				else if (q.type === "ordering") typeSet.add("ordering");
				else if (q.type === "matching") typeSet.add("matching");
				else typeSet.add("single");
			}

			// Déterminer le type global du quiz (tag stable — traduit au rendu)
			let quizType: QuizTypeTag;
			if (typeSet.size > 1) quizType = "mixed";
			else if (typeSet.has("single")) quizType = "single";
			else if (typeSet.has("multiple")) quizType = "multiple";
			else if (typeSet.has("text")) quizType = "text";
			else if (typeSet.has("ordering")) quizType = "ordering";
			else if (typeSet.has("matching")) quizType = "matching";
			else quizType = "mixed";

			// Le titre affiché vient du nom de la note (défini au niveau du cache),
			// pas de la 1re question (qui vaut souvent « Question 1 »).
			return {
				questions: questions.length,
				types: Array.from(typeSet),
				quizType,
				quizMode: config?.mode === "learn" || config?.learnMode === true
					? "learn"
					: config?.mode === "exam" || config?.examMode === true
					? "exam"
					: "quiz",
			};
		} catch {
			return null;
		}
	}

	/* ── Extrait le premier bloc quiz-blocks d'un contenu markdown ── */
	function extractQuizSource(content: string): string | null {
		const startIdx = content.indexOf(QUIZ_FENCE_START);
		if (startIdx === -1) return null;

		const afterStart = startIdx + QUIZ_FENCE_START.length;
		// Le contenu commence après le saut de ligne suivant
		const contentStart = content.indexOf('\n', afterStart);
		if (contentStart === -1) return null;

		// Trouver la fermeture
		const closingFence = content.indexOf('\n' + QUIZ_FENCE_END, contentStart + 1);
		if (closingFence === -1) return null;

		return content.substring(contentStart + 1, closingFence).trim();
	}

	/* ── Scan complet du vault ── */
	async function scanVault(): Promise<void> {
		scanning = true;
		cache.clear();

		const markdownFiles = app.vault.getMarkdownFiles();

		for (const file of markdownFiles) {
			try {
				const content = await app.vault.cachedRead(file);
				const quizSource = extractQuizSource(content);
				if (!quizSource) continue;

				const meta = parseQuizMeta(quizSource);
				if (!meta) continue;

				cache.set(file.path, {
					path: file.path,
					basename: file.basename,
					title: file.basename,
					...meta,
					mtime: file.stat?.mtime || 0
				});
			} catch {
				// Ignorer les erreurs de lecture
			}
		}

		scanning = false;
		notifyListeners();
	}

	/* ── Scan incrémental d'un seul fichier ── */
	async function scanFile(file: TFile): Promise<void> {
		try {
			const content = await app.vault.cachedRead(file);
			const quizSource = extractQuizSource(content);

			if (!quizSource) {
				const removed = cache.delete(file.path);
				if (removed) notifyListeners();
				return;
			}

			const meta = parseQuizMeta(quizSource);
			if (!meta) {
				const removed = cache.delete(file.path);
				if (removed) notifyListeners();
				return;
			}

			const entry: QuizIndexEntry = {
				path: file.path,
				basename: file.basename,
				title: file.basename,
				...meta,
				mtime: file.stat?.mtime || 0
			};
			// L'autosave d'Obsidian déclenche `modify` toutes les ~2 s
			// pendant la frappe : ne notifier (→ re-render sidebar + vue)
			// que si les données AFFICHÉES ont changé — mtime exclu.
			const prev = cache.get(file.path);
			cache.set(file.path, entry);
			const changed = !prev || JSON.stringify({ ...prev, mtime: 0 }) !== JSON.stringify({ ...entry, mtime: 0 });
			if (changed) notifyListeners();
		} catch {
			// Fichier inaccessible, on l'enlève du cache
			const removed = cache.delete(file.path);
			if (removed) notifyListeners();
		}
	}

	/* ── Récupérer les quiz indexés ── */
	function getQuizzes(): QuizIndexEntry[] {
		return Array.from(cache.values());
	}

	/* ── Récupérer un quiz par chemin ── */
	function getQuiz(path: string): QuizIndexEntry | null {
		return cache.get(path) || null;
	}

	/* ── Récupérer le nombre total de questions ── */
	function getTotalQuestions(): number {
		let total = 0;
		for (const quiz of cache.values()) {
			total += quiz.questions;
		}
		return total;
	}

	/* ── Écouteurs de changements ── */
	function onChange(callback: (quizzes: QuizIndexEntry[]) => void): () => void {
		listeners.push(callback);
		return () => {
			const idx = listeners.indexOf(callback);
			if (idx >= 0) listeners.splice(idx, 1);
		};
	}

	function notifyListeners(): void {
		for (const cb of listeners) {
			try { cb(getQuizzes()); } catch { /* ignore */ }
		}
	}

	/* ── Setup des events vault ── */
	function setupVaultListeners(): void {
		vaultEventRefs.push(app.vault.on("create", (file) => {
			if (file instanceof TFile && file.extension === "md" && !scanning) {
				scanFile(file);
			}
		}));

		vaultEventRefs.push(app.vault.on("modify", (file) => {
			if (file instanceof TFile && file.extension === "md" && !scanning) {
				scanFile(file);
			}
		}));

		vaultEventRefs.push(app.vault.on("delete", (file) => {
			if (cache.has(file.path)) {
				cache.delete(file.path);
				notifyListeners();
			}
		}));

		vaultEventRefs.push(app.vault.on("rename", (file, oldPath) => {
			if (cache.has(oldPath)) {
				cache.delete(oldPath);
				if (file instanceof TFile) scanFile(file);
			} else if (file instanceof TFile && file.extension === "md" && !scanning) {
				scanFile(file);
			}
		}));
	}

	/* ── Initialisation ── */
	async function init(): Promise<void> {
		setupVaultListeners();
		await scanVault();
	}

	function destroy(): void {
		for (const ref of vaultEventRefs) {
			try { app.vault.offref(ref); } catch (_) { /* ignore */ }
		}
		vaultEventRefs.length = 0;
		listeners.length = 0;
		cache.clear();
	}

	return {
		init,
		destroy,
		scanVault,
		scanFile,
		getQuizzes,
		getQuiz,
		getTotalQuestions,
		onChange
	};
}
