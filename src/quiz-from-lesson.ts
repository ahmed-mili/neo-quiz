/**
 * Génération de la note Quiz depuis une note Lesson ouverte (task 9 du lot
 * mode leçon, 2026-08-31). Trois fonctions PURES, vérifiables sans Obsidian
 * (`scripts/check-lesson.mjs`) : le nom de la note à créer, le contenu du
 * bloc de référence qu'elle porte, et la détection « cette note est une
 * Lesson ». La partie BRANCHÉE (lecture de l'éditeur actif, écriture ou
 * ouverture du fichier) reste dans `plugin.ts`, réduite au strict enregistrement
 * de la commande (règle du brief).
 */
import { QUIZ_BLOCK_RE, parseQuizSource, findQuizModeConfigIndex, normalizeQuizMode } from "./quiz-utils";

const LESSON_SUFFIX = " — Lesson";
const QUIZ_SUFFIX = " — Quiz";

/**
 * Nom (sans extension) de la note Quiz à créer à partir du nom de la note
 * Lesson (sans extension). `Chapitre 1 — Lesson` devient `Chapitre 1 — Quiz` ;
 * un nom qui ne porte pas ce suffixe (la Lesson peut s'appeler n'importe quoi,
 * brief point 6) reçoit simplement le suffixe en plus — le résultat reste
 * prévisible et lisible dans les deux cas. Aucun caractère interdit par le
 * système de fichiers n'est introduit : seul le suffixe change, et il n'en
 * contient pas.
 */
export function deriveQuizNoteName(lessonBaseName: string): string {
	if (lessonBaseName.endsWith(LESSON_SUFFIX)) {
		return lessonBaseName.slice(0, -LESSON_SUFFIX.length) + QUIZ_SUFFIX;
	}
	return lessonBaseName + QUIZ_SUFFIX;
}

/**
 * Contenu complet de la note Quiz : un unique bloc `quiz-blocks` référençant
 * la Lesson par un lien wikilink, résolu par `resolveQuizSourceRef` comme
 * n'importe quel lien Obsidian. `mode` et `source` sont des clés de DONNÉES
 * persistées dans le bloc — jamais traduites (règle du projet), relisibles
 * telles quelles par `parseQuizSource`/`extractExamOptions`.
 */
export function buildQuizRefBlockContent(lessonBaseName: string): string {
	return "```quiz-blocks\n" + `[{ mode: "quiz", source: "[[${lessonBaseName}]]" }]` + "\n```\n";
}

/**
 * Le premier bloc quiz-blocks de `content` est-il en `mode: "lesson"` ?
 * Sert à n'afficher la commande que si elle a un sens (brief point 4).
 * Lecture du contenu de l'ÉDITEUR actif, pas du disque : `checkCallback`
 * d'Obsidian est synchrone, alors que `vault.cachedRead` ne l'est pas — on
 * évite ainsi de rendre la commande indisponible pendant une lecture, ou de
 * juger un contenu déjà périmé par une frappe non sauvegardée.
 */
export function isLessonNoteContent(content: string): boolean {
	const match = QUIZ_BLOCK_RE.exec(content);
	if (!match) return false;
	let parsed: unknown[];
	try {
		parsed = parseQuizSource(match[1]);
	} catch {
		return false;
	}
	const idx = findQuizModeConfigIndex(parsed);
	if (idx < 0) return false;
	const config = parsed[idx] as { mode?: unknown };
	return normalizeQuizMode(config.mode) === "lesson";
}
