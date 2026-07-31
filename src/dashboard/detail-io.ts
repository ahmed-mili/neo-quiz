import { TFile } from "obsidian";
import type { App } from "obsidian";
import { parseQuizSource, QUIZ_BLOCK_RE } from "../quiz-utils";
import { convertParsedToInternal, readModeConfig } from "../editor/convert";
import { findQuizModeConfigIndex } from "../quiz-utils";
import { stripInlineMarkdown } from "../engine/sanitizer";
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
	/** Le BLOC tel qu'il était la dernière fois qu'on l'a lu ou écrit. C'est la
	    valeur témoin du compare-and-swap : au moment d'écrire, si le bloc de la
	    note ne lui ressemble plus, quelqu'un d'autre est passé par là. Le
	    `mtime` seul ne suffit pas — il se lit AVANT `vault.process`, et deux
	    pages pouvaient le franchir toutes les deux. */
	blockSource?: string;
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
		/* Objet de mode (examen OU learn) : c'est la configuration du bloc,
		   jamais une question. Le reconnaître au seul `examMode` faisait entrer
		   un `{ mode: 'learn' }` dans la liste comme une question vide — et la
		   première réécriture la matérialisait dans la note. Repéré par son
		   INDEX : le critère dépend de la POSITION dans le bloc (quiz-utils.ts),
		   un test élément par élément ne peut pas le savoir. */
		const configIdx = findQuizModeConfigIndex(parsed);
		parsed.forEach((item, i) => {
			if (i === configIdx) {
				examOptions = readModeConfig(item);
				return;
			}
			questions.push(convertParsedToInternal(item));
		});
		return { file, questions, examOptions, mtime: file.stat?.mtime ?? 0, blockSource: match[1] };
	} catch {
		return "loadError";
	}
}

/** Réécrit le bloc de la note. Renvoie false si rien n'a pu être écrit. */
export async function saveQuizDraft(app: App, draft: QuizDraft): Promise<boolean> {
	if (!draft.file) return false;
	const file = draft.file;
	/* PAS de garde `draftIsStale` ici. Le `mtime` parle de toute la NOTE ;
	   le brouillon, lui, ne possède que son bloc. Corriger une faute de frappe
	   dans le texte AUTOUR du quiz — dans l'éditeur markdown, en même temps que
	   la page est ouverte — faisait échouer toutes les sauvegardes suivantes
	   alors que le bloc, lui, n'avait pas bougé d'un caractère : la page
	   n'écrivait plus rien jusqu'à sa réouverture (revue codex 2026-07-31).
	   La garantie vient du compare-and-swap ci-dessous, qui a la bonne
	   granularité : le BLOC. */
	try {
		const source = exportAll(draft.questions, draft.examOptions);
		// Garde-fou de l'éditeur, conservé : on ne réécrit JAMAIS un bloc dont
		// le JSON5 généré ne se relit pas — la note vaut mieux que la frappe.
		parseQuizSource(source);

		let ecrit = false;
		/* Ce qui a réellement été écrit entre les clôtures — pas `source`,
		   qui n'en est que la forme LF (cf. `eol` plus bas). */
		let temoin = source;
		/* `vault.process` et non `read` + `modify` : Obsidian garantit qu'aucune
		   modification ne s'intercale entre la lecture et l'écriture.

		   Le rappel repart de ZÉRO à chaque invocation (`ecrit` remis à faux) :
		   il peut être rejoué, et le résultat d'un essai abandonné ne doit pas
		   survivre au suivant. C'est la DERNIÈRE invocation qui fait foi. */
		await app.vault.process(file, (content) => {
			ecrit = false;
			const actuel = content.match(QUIZ_BLOCK_RE);
			if (!actuel) return content;
			/* COMPARE-AND-SWAP : on n'écrit que si le bloc est encore celui
			   qu'on a lu. Deux pages ouvertes sur la même note pouvaient
			   franchir le garde `mtime` en même temps — il se lit avant
			   `process` — puis s'écraser l'une l'autre en annonçant toutes deux
			   un succès. Ici la seconde repart bredouille, et le dit. */
			if (draft.blockSource !== undefined && actuel[1] !== draft.blockSource) return content;
			ecrit = true;
			/* Les CLÔTURES telles qu'elles sont écrites : la ligne d'ouverture
			   peut porter des attributs après le nom du langage, et la fermante
			   peut être indentée. Les réécrire en forme canonique effaçait un
			   ` ```quiz-blocks data-owner=alice ` sans que personne ne l'ait
			   demandé, et le compare-and-swap ne pouvait pas s'en apercevoir : il
			   ne compare que le JSON5 (revue codex 2026-07-31). */
			const lignes = actuel[0].split("\n");
			const ouverture = lignes[0].replace(/\r$/, "");
			const fermeture = lignes[lignes.length - 1].replace(/\r$/, "");
			/* Les FINS DE LIGNE de la note, pas celles de l'export. Une note
			   Windows (ou importée, ou synchronisée) est en CRLF ; y écrire un
			   bloc en LF la rendait mixte, et le moindre changement d'une
			   question apparaissait comme une réécriture du bloc entier dans un
			   diff ou une synchro. */
			const eol = actuel[0].includes("\r\n") ? "\r\n" : "\n";
			/* Le TÉMOIN du prochain compare-and-swap est ce qu'on écrit VRAIMENT,
			   fins de ligne comprises. Mémoriser la version LF de l'export dans
			   une note CRLF faisait échouer la sauvegarde SUIVANTE — la première
			   frappe passait, la seconde était perdue en silence (revue codex
			   2026-07-31, régression du correctif CRLF de la même nuit). */
			temoin = source.replace(/\r?\n/g, eol);
			const block = ouverture + eol + temoin + eol + fermeture;
			// Remplacement par FONCTION, jamais par chaîne : dans une chaîne de
			// remplacement, `$1`, `$&`, `` $` `` et `$'` sont des motifs
			// spéciaux — et un quiz de maths est plein de `$…$` (« $1$ » aurait
			// réinjecté la source entière à sa place, `$'` tout le reste).
			return content.replace(QUIZ_BLOCK_RE, () => block);
		});
		if (!ecrit) return false;
		// Le bloc qu'on vient d'écrire devient le témoin du prochain échange.
		draft.blockSource = temoin;
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
	/* Seuls les marqueurs APPARIÉS tombent, et c'est la grammaire du RENDU qui
	   en décide (engine/sanitizer.ts) : retirer toutes les étoiles changeait
	   « 3*4*5 » en « 345 » et « C:\*.ts » en « C:\.ts ». Cette fonction a
	   longtemps porté sa propre copie des règles de flanc — deux copies d'une
	   grammaire aussi pointue finissent par diverger, et c'est la vignette qui
	   se serait mise à mentir sur ce que la carte affiche. */
	return stripInlineMarkdown(q.prompt || q.title || "")
		// Les titres, eux, n'existent pas en INLINE : le rendu les laisse tels
		// quels dans une carte, mais une vignette d'une ligne n'en veut pas.
		.replace(/^\s*#{1,6}\s+/gm, "")
		.replace(/\s+/g, " ")
		.trim();
}
