import JSON5 from "json5";
import type { QuizQuestion, ExamOptions } from "./types/quiz";

/** Mode d'un quiz, lu dans l'objet de configuration optionnel en fin de tableau. */
type QuizMode = "learn" | "exam" | "quiz";

/**
 * Objet de configuration optionnel placé en dernier élément du tableau JSON5
 * d'un bloc quiz-blocks (mode examen/learn) — pas une question, distingué par
 * l'absence de `prompt` et la présence d'un des champs mode (extractExamOptions).
 */
interface QuizModeConfig {
	examMode?: boolean;
	learnMode?: boolean;
	mode?: string;
	examDurationMinutes?: number;
	examAutoSubmit?: boolean;
	examShowTimer?: boolean;
}

function parseQuizSource(source?: string | null): QuizQuestion[] {
	const raw = String(source ?? "").trim();

	if (raw.length === 0) return [];

	let parsed: unknown;
	try {
		parsed = JSON5.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// Log détaillé pour déboguer
		console.error("[Quiz Blocks] JSON5 parse error:", message);
		if (message && message.includes("position")) {
			const match = message.match(/position (\d+)/);
			if (match) {
				const pos = parseInt(match[1]);
				console.error("[Quiz Blocks] Caractère à la position", pos + ":", raw.charAt(pos));
				console.error("[Quiz Blocks] Contexte:", raw.substring(Math.max(0, pos - 30), pos + 30));
			}
		}
		throw new Error("Le bloc ```quiz-blocks doit contenir un tableau JSON5 valide.");
	}

	if (!Array.isArray(parsed)) {
		throw new Error("Le contenu du bloc quiz-blocks doit être un tableau.");
	}

	return parsed as QuizQuestion[];
}

/**
 * Cet élément est-il l'objet de CONFIGURATION du bloc plutôt qu'une question ?
 * Aucun énoncé, et l'un des marqueurs de mode.
 *
 * INTERNE. Le point d'entrée est `findQuizModeConfigIndex` : ce prédicat seul
 * ne suffit pas à décider, il dépend de la position (cf. plus bas). Il a
 * longtemps été exporté sous le nom `isModeConfig`, et chaque lecteur du bloc
 * l'appelait élément par élément — c'est cette forme-là qui laissait la
 * question fantôme entrer, chaque lecteur comptant les siennes.
 */
function isQuizModeConfig(item: unknown): boolean {
	const q = item as (QuizQuestion & QuizModeConfig) | null | undefined;
	if (!q || typeof q !== "object" || Array.isArray(q) || q.prompt) return false;
	if (q.examMode === true || q.learnMode === true) return true;
	/* Les TROIS modes du plugin, pas « une chaîne quelconque ». Une question
	   légitime nommée `{ title: 'Quel mode choisir ?', mode: 'transport' }`
	   passait pour la configuration du bloc et DISPARAISSAIT à la réécriture —
	   et en dernière position, même une question complète avec ses réponses
	   (`mode: 'dark'`) y passait (revue codex 2026-07-31). C'est déjà la liste
	   que `readModeConfig` accepte : la reconnaissance et la lecture parlent
	   maintenant du même vocabulaire. */
	return q.mode === "quiz" || q.mode === "learn" || q.mode === "exam";
}

/**
 * Le même élément, mais SANS le moindre signe de question. Utilisé pour
 * reconnaître une configuration ailleurs qu'en dernière position, où l'on n'a
 * pas le droit de se tromper : mal juger le dernier élément ne coûte qu'un
 * mode, mal juger un élément du milieu ferait DISPARAÎTRE une question.
 *
 * Mesuré sur les deux vaults avant d'écrire ceci : 1194 éléments, dont 240 sans
 * énoncé, et exactement 2 qui satisfont `isQuizModeConfig` — deux lignes vides
 * héritées du bug de la question fantôme, toutes deux en DERNIÈRE position, et
 * qui portent le vrai mode de leur quiz. Les exclure les ferait réapparaître
 * comme des questions vides dans deux notes réelles ; c'est pourquoi la règle
 * stricte ne s'applique qu'ailleurs qu'à la fin.
 */
function isStrictQuizModeConfig(item: unknown): boolean {
	if (!isQuizModeConfig(item)) return false;
	const q = item as Record<string, unknown>;
	return !q.options && !q.cloze && !q.ordering && !q.matching && !q.type
		&& q.correctIndex == null && q.correctIndices == null;
}

/**
 * INDEX de l'objet de configuration dans un bloc, ou -1. C'est la seule façon
 * correcte de le repérer : le critère dépend de la POSITION (cf.
 * `isStrictQuizModeConfig`), et un test élément par élément ne peut pas le
 * savoir. Toutes les lectures du bloc passent par ici — le moteur
 * (`extractExamOptions`), la page « quiz », le scanner et la génération IA —
 * pour qu'aucune ne compte ses questions autrement que les autres.
 */
export function findQuizModeConfigIndex(items: readonly unknown[]): number {
	if (!Array.isArray(items) || items.length === 0) return -1;
	const dernier = items.length - 1;
	if (isQuizModeConfig(items[dernier])) return dernier;
	return items.findIndex(isStrictQuizModeConfig);
}

function extractExamOptions(quizArray: QuizQuestion[]): {
	questions: QuizQuestion[];
	quizMode: QuizMode;
	examOptions: ExamOptions | null;
	learnExamOptions: ExamOptions | null;
} {
	if (!Array.isArray(quizArray) || quizArray.length === 0) return { questions: quizArray, quizMode: "quiz", examOptions: null, learnExamOptions: null };

	/* N'IMPORTE OÙ dans le tableau, pas seulement en dernier. L'export écrit
	   toujours la configuration à la fin, mais un quiz écrit à la main — ou
	   par un modèle — la place volontiers en tête. Le moteur affichait alors
	   une première carte VIDE et comptait une question de plus, là où la page
	   « quiz » et le scanner, eux, la reconnaissaient déjà partout : « 0/11 »
	   pour un quiz de dix questions.

	   La DERNIÈRE position garde le critère large (c'est là que l'export écrit,
	   et deux notes réelles y ont une ligne vide qui porte leur mode) ; partout
	   ailleurs, le critère STRICT — ailleurs qu'à la fin, se tromper ne coûte
	   pas un mode mais une question. */
	const configIdx = findQuizModeConfigIndex(quizArray);
	const lastItem = configIdx >= 0 ? quizArray[configIdx] as QuizQuestion & QuizModeConfig : undefined;

	if (lastItem) {
		// Déterminer le mode : "learn" | "exam" | "quiz"
		let mode = typeof lastItem.mode === "string" ? lastItem.mode : "";
		if (!mode) {
			if (lastItem.examMode === true) mode = "exam";
			else if (lastItem.learnMode === true) mode = "learn";
			else mode = "quiz";
		}
		const quizMode: QuizMode = (mode === "learn" || mode === "exam" || mode === "quiz") ? mode : "quiz";

		// Construction des options d'examen
		const buildExamOpts = (): ExamOptions => ({
			durationMinutes: Math.max(1, Math.min(180, Number(lastItem.examDurationMinutes) || 10)),
			autoSubmit: lastItem.examAutoSubmit !== false,
			showTimer: lastItem.examShowTimer !== false
		});

		// Options d'examen (mode exam actif)
		let examOptions: ExamOptions | null = null;
		if (quizMode === "exam") {
			examOptions = buildExamOpts();
		}

		// Options d'examen pour le mode learn (utilisé par "Passer l'examen")
		let learnExamOptions: ExamOptions | null = null;
		if (quizMode === "learn" && lastItem.examDurationMinutes != null) {
			learnExamOptions = buildExamOpts();
		}

		return {
			questions: quizArray.filter((_, i) => i !== configIdx),
			quizMode,
			examOptions,
			learnExamOptions
		};
	}

	return { questions: quizArray, quizMode: "quiz", examOptions: null, learnExamOptions: null };
}

function renderParagraph(container: HTMLElement, text?: string | null): HTMLParagraphElement {
	return container.createEl("p", {
		text: String(text ?? "")
	});
}

/* Premier bloc ```quiz-blocks``` d'une note — groupe 1 = la source JSON5.
   TOLÉRANT aux fins de ligne CRLF (notes Windows/importées), aux attributs
   après le nom du langage et à l'indentation de la fence fermante : le
   scanner (indexOf, scanner.ts) accepte tout ça, et un regex strict `\n`
   faisait diverger l'index et les actions — le quiz apparaissait dans
   « Mes quiz » mais Share/Edit/Delete répondaient « bloc introuvable ». */
const QUIZ_BLOCK_RE = /```quiz-blocks[^\n]*\n([\s\S]*?)\r?\n[ \t]*```/;

export { parseQuizSource, extractExamOptions, renderParagraph, QUIZ_BLOCK_RE };
