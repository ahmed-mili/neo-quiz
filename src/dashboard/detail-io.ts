import { TFile } from "obsidian";
import type { App } from "obsidian";
import { parseQuizSource, QUIZ_BLOCK_RE } from "../quiz-utils";
import { convertParsedToInternal, isModeConfig, readModeConfig } from "../editor/convert";
import { exportAll } from "../editor/export";
import type { DraftQuestion } from "../editor/utils";
import type { ParsedQuizItem } from "../editor/modals";
import type { EditorExamOptions } from "../types/editor-ctx";

/* ══════════════════════════════════════════════════════════
   DETAIL I/O — lecture / écriture du bloc quiz-blocks d'une note

   La page « quiz » du dashboard édite les questions EN PLACE : elle lit
   par la même chaîne que l'éditeur (QUIZ_BLOCK_RE → parseQuizSource →
   convertParsedToInternal) et réécrit par la même (exportAll), pour que
   les deux surfaces d'édition produisent des .md identiques.

   Les options d'examen ne sont pas éditables ici mais sont RELUES et
   RÉÉCRITES telles quelles : sans ça, une simple correction de faute de
   frappe effacerait le mode examen du quiz.
══════════════════════════════════════════════════════════ */

export interface QuizDraft {
	file: TFile;
	questions: DraftQuestion[];
	examOptions: EditorExamOptions | null;
}

/** Erreur de chargement, portée à l'UI sous forme de clé de traduction. */
export type QuizLoadError = "fileNotFound" | "noBlock" | "loadError";

export async function loadQuizDraft(app: App, path: string): Promise<QuizDraft | QuizLoadError> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!file || !(file instanceof TFile)) return "fileNotFound";
	let content: string;
	try {
		content = await app.vault.read(file);
	} catch {
		return "loadError";
	}
	const match = content.match(QUIZ_BLOCK_RE);
	if (!match) return "noBlock";

	try {
		const parsed = parseQuizSource(match[1]) as unknown as ParsedQuizItem[];
		const questions: DraftQuestion[] = [];
		let examOptions: EditorExamOptions | null = null;
		for (const item of parsed) {
			// Objet de mode (examen OU learn) : c'est la configuration du bloc,
			// jamais une question. Le reconnaître au seul `examMode` faisait
			// entrer un `{ mode: 'learn' }` dans la liste comme une question
			// vide — et la première réécriture la matérialisait dans la note.
			if (isModeConfig(item)) {
				examOptions = readModeConfig(item);
				continue;
			}
			questions.push(convertParsedToInternal(item));
		}
		return { file, questions, examOptions };
	} catch {
		return "loadError";
	}
}

/** Réécrit le bloc de la note. Renvoie false si rien n'a pu être écrit. */
export async function saveQuizDraft(app: App, draft: QuizDraft): Promise<boolean> {
	try {
		const content = await app.vault.read(draft.file);
		const source = exportAll(draft.questions, draft.examOptions);
		// Garde-fou de l'éditeur, conservé : on ne réécrit JAMAIS un bloc dont
		// le JSON5 généré ne se relit pas — la note vaut mieux que la frappe.
		parseQuizSource(source);
		if (!QUIZ_BLOCK_RE.test(content)) return false;
		// Remplacement par FONCTION, jamais par chaîne : dans une chaîne de
		// remplacement, `$1`, `$&`, `` $` `` et `$'` sont des motifs spéciaux —
		// et un quiz de maths est plein de `$…$` (« $1$ » aurait réinjecté la
		// source entière à sa place, `$'` tout le reste de la note).
		const block = "```quiz-blocks\n" + source + "\n```";
		const updated = content.replace(QUIZ_BLOCK_RE, () => block);
		if (updated !== content) await app.vault.modify(draft.file, updated);
		return true;
	} catch {
		return false;
	}
}

/** Énoncé affichable d'une question (l'éditeur autorise un prompt vide). */
export function questionText(q: DraftQuestion): string {
	return (q.prompt || q.title || "").trim();
}
