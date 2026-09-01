/**
 * Résolution d'une note Quiz qui pointe vers une note Lesson via
 * `source: "[[Chapitre 1 — Lesson]]"` (task 8 du lot mode leçon,
 * 2026-08-31). La note quiz ne porte plus aucune question : elle ne fait
 * que rejouer les questions de rôle "test" (ou sans rôle) de la note
 * référencée, une seule source de vérité pour le contenu.
 *
 * Séparation PUR / BRANCHÉ (règle du brief) : `selectQuizQuestions` ne
 * dépend d'aucune API Obsidian et se vérifie sans DOM ni `app`
 * (`scripts/check-lesson.mjs`) ; `resolveQuizSourceRef` fait le travail
 * asynchrone (lecture du vault, résolution du lien) par-dessus.
 */
import type { App, TFile } from "obsidian";
import type { QuizQuestion } from "./types/quiz";
import { QUIZ_BLOCK_RE, parseQuizSource, extractExamOptions, findQuizModeConfigIndex } from "./quiz-utils";

/** Les trois façons dont une résolution peut échouer — jamais un bloc vide
    silencieux (règle du brief), le lien est toujours reporté au caller pour
    nommer la Notice et le message affiché dans le bloc. */
export type QuizSourceRefError = { error: "not-found" | "no-block" | "chained"; link: string };

export type QuizSourceRefResult = { questions: QuizQuestion[] } | QuizSourceRefError;

/**
 * Sélection PURE des questions rejouées par une note Quiz : seul le rôle
 * "test" (ou son absence, cas des quiz ordinaires sans mode leçon) a un sens
 * hors du contexte de sa tranche — une `pre` sans lecture à suivre n'a pas
 * d'objet, une `recall` sans son cours n'a plus de référence à laquelle se
 * comparer, une `read` n'est pas une question.
 */
export function selectQuizQuestions(questions: readonly QuizQuestion[]): QuizQuestion[] {
	return questions.filter(q => {
		const role = (q as { role?: unknown }).role;
		return role === undefined || role === "test";
	});
}

/** Retire les crochets `[[...]]` et un éventuel alias `|...` d'un wikilink,
    pour ne garder que le linkpath attendu par `getFirstLinkpathDest`. */
function toLinkpath(ref: string): string {
	const sansCrochets = ref.trim().replace(/^\[\[/, "").replace(/\]\]$/, "");
	const pipeIdx = sansCrochets.indexOf("|");
	return (pipeIdx >= 0 ? sansCrochets.slice(0, pipeIdx) : sansCrochets).trim();
}

/**
 * Résolution asynchrone d'un `source` de note Quiz vers les questions de sa
 * note Lesson. `fromPath` est le chemin de la note QUI PORTE le `source`
 * (celle affichée), passé à `getFirstLinkpathDest` pour résoudre les liens
 * relatifs comme le fait le moteur (cf. `engine/sanitizer.ts`).
 */
export async function resolveQuizSourceRef(app: App, ref: string, fromPath: string): Promise<QuizSourceRefResult> {
	const linkpath = toLinkpath(ref);
	const file: TFile | null = app.metadataCache.getFirstLinkpathDest(linkpath, fromPath);
	if (!file) return { error: "not-found", link: ref };

	const content = await app.vault.cachedRead(file);
	const match = QUIZ_BLOCK_RE.exec(content);
	if (!match) return { error: "no-block", link: ref };

	const parsed = parseQuizSource(match[1]);

	/* Pas de chaîne de références : une note Lesson qui porterait elle-même
	   un `source` serait résolue une seconde fois par le moteur, avec un
	   risque de boucle et une note quiz qui n'affiche plus rien de local à
	   elle-même. `findQuizModeConfigIndex` retrouve l'objet de configuration
	   AVANT qu'`extractExamOptions` ne le retire du tableau. */
	const configIdx = findQuizModeConfigIndex(parsed);
	if (configIdx >= 0) {
		const config = parsed[configIdx] as { source?: unknown };
		if (typeof config.source === "string" && config.source.trim() !== "") {
			return { error: "chained", link: ref };
		}
	}

	const { questions } = extractExamOptions(parsed);
	return { questions: selectQuizQuestions(questions) };
}
