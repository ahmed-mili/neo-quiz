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
	/** `null` pour un quiz qui n'a pas (encore) de note — le résultat d'une
	    génération vit en mémoire jusqu'à son insertion. `saveQuizDraft` le
	    refuse alors, plutôt que d'inventer un fichier. */
	file: TFile | null;
	questions: DraftQuestion[];
	examOptions: EditorExamOptions | null;
	/** `mtime` de la note au moment de la LECTURE, remis à jour à chaque
	    écriture. Sert à détecter qu'elle a changé DEHORS (édition dans
	    l'éditeur markdown, synchro) : le brouillon en mémoire serait alors
	    périmé, et la frappe suivante écraserait la modification externe. */
	mtime?: number;
}

/** La note a-t-elle changé hors de ce brouillon depuis sa lecture ? */
export function draftIsStale(draft: QuizDraft): boolean {
	if (!draft.file || draft.mtime == null) return false;
	return (draft.file.stat?.mtime ?? 0) !== draft.mtime;
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
		return { file, questions, examOptions, mtime: file.stat?.mtime ?? 0 };
	} catch {
		return "loadError";
	}
}

/** Réécrit le bloc de la note. Renvoie false si rien n'a pu être écrit. */
export async function saveQuizDraft(app: App, draft: QuizDraft): Promise<boolean> {
	if (!draft.file) return false;
	const file = draft.file;
	try {
		const content = await app.vault.read(file);
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
		if (updated !== content) await app.vault.modify(file, updated);
		// Notre propre écriture ne doit pas passer pour une modification
		// EXTERNE au prochain rendu (cf. draftIsStale).
		draft.mtime = file.stat?.mtime ?? draft.mtime;
		return true;
	} catch {
		return false;
	}
}

/** Énoncé affichable d'une question, en UNE ligne de texte nu (l'éditeur
    autorise un prompt vide). Les marqueurs markdown sont retirés : la
    vignette de la liste est du texte brut, et « **exactes** » s'y lisait
    avec ses étoiles. Le contenu, lui, n'est pas touché — seul l'affichage. */
export function questionText(q: DraftQuestion): string {
	return (q.prompt || q.title || "")
		// Seuls les marqueurs APPARIÉS tombent, avec la même règle de flanc
		// gauche que le rendu (engine/sanitizer.ts) : retirer toutes les
		// étoiles changeait « 3*4*5 » en « 345 » et « C:\*.ts » en « C:\.ts ».
		.replace(/`([^`\n]+)`/g, "$1")
		.replace(/(^|[^0-9A-Za-zÀ-ÿ\\*])\*{1,3}(?=\S)([\s\S]*?\S)\*{1,3}/g, "$1$2")
		.replace(/(^|[^0-9A-Za-zÀ-ÿ\\~])~~(?=\S)([\s\S]*?\S)~~/g, "$1$2")
		.replace(/^\s*#{1,6}\s+/gm, "")
		.replace(/\s+/g, " ")
		.trim();
}
