import JSON5 from "json5";
import type { QuizQuestion, ExamOptions } from "./types/quiz";

/** Mode d'un quiz, lu dans l'objet de configuration optionnel en fin de tableau.
    "learn" a été renommé "lesson" (task 0 du lot mode leçon, 2026-08-31) : ce
    fichier n'écrit et ne renvoie plus jamais que "lesson", mais continue de
    LIRE "learn" indéfiniment (cf. normalizeQuizMode) — un quiz partagé écrit
    avec l'ancien nom doit continuer de fonctionner. */
type QuizMode = "lesson" | "exam" | "quiz";

/**
 * Objet de configuration optionnel placé en dernier élément du tableau JSON5
 * d'un bloc quiz-blocks (mode examen/leçon) — pas une question, distingué par
 * l'absence de `prompt` et la présence d'un des champs mode (extractExamOptions).
 */
interface QuizModeConfig {
	examMode?: boolean;
	/** Raccourci historique de `mode: "learn"` (désormais "lesson") — alias lu
	    en repli, jamais écrit (aucun raccourci équivalent pour "lesson"). */
	learnMode?: boolean;
	mode?: string;
	examDurationMinutes?: number;
	examAutoSubmit?: boolean;
	examShowTimer?: boolean;
	/** Référence libre vers la note source de la leçon (ex. un lien `[[...]]`) —
	    jamais lue comme un marqueur de question par `isStrictQuizModeConfig`. */
	source?: string;
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
	/* `q.learnMode` : alias hérité de `mode: "learn"` (renommé "lesson") — lu
	   indéfiniment, jamais écrit. */
	if (q.examMode === true || q.learnMode === true) return true;
	/* FIX round 1 de revue (task 8) : un bloc écrit à la main comme
	   `[{ source: "[[...]]" }]`, SANS `mode`, n'était reconnu par aucune des
	   deux conditions ci-dessus/dessous — l'objet devenait une question
	   fantôme et `source` était ignoré en silence. `source` n'est le nom
	   d'aucun champ de question (types/quiz.ts) : sa seule présence, sur un
	   objet sans `prompt`, suffit à le désigner comme configuration. */
	if (typeof q.source === "string" && q.source.trim() !== "") return true;
	/* Les TROIS modes du plugin, pas « une chaîne quelconque ». Une question
	   légitime nommée `{ title: 'Quel mode choisir ?', mode: 'transport' }`
	   passait pour la configuration du bloc et DISPARAISSAIT à la réécriture —
	   et en dernière position, même une question complète avec ses réponses
	   (`mode: 'dark'`) y passait (revue codex 2026-07-31). C'est déjà la liste
	   que `readModeConfig` accepte : la reconnaissance et la lecture parlent
	   maintenant du même vocabulaire. */
	return normalizeQuizMode(q.mode) !== null;
}

/**
 * Le mode écrit dans un bloc, ramené à sa forme canonique — ou `null` si ce
 * n'en est pas un.
 *
 * TOLÉRANT à la casse et aux espaces, pour TOUS les modes — alias hérité
 * ("learn") comme noms canoniques ("quiz", "lesson", "exam") : un bloc écrit
 * à la main contient `mode: 'Learn'` ou `mode: 'exam '` aussi facilement que
 * la forme exacte, et exiger l'exactitude ferait pire que l'ancien code —
 * celui-ci reconnaissait au moins l'objet comme une configuration (quitte à
 * retomber sur le mode quiz), là où un refus net le transformerait en
 * question fantôme.
 *
 * Round 1 de revue (2026-08-31) : une première version de cette fonction
 * exigeait la casse EXACTE pour "lesson" mais pas pour "learn" — asymétrie
 * absurde entre l'alias et le nom canonique (`mode: 'Lesson'` fantôme,
 * `mode: 'Learn'` reconnu), corrigée ici : la casse est tolérée partout.
 *
 * "learn" reste reconnu indéfiniment : c'est l'alias hérité du mode renommé
 * "lesson" (task 0, 2026-08-31), et un quiz partagé écrit avant le
 * renommage doit continuer de s'ouvrir.
 */
export function normalizeQuizMode(value: unknown): QuizMode | null {
	if (typeof value !== "string") return null;
	const m = value.trim().toLowerCase();
	if (m === "learn") return "lesson";
	return m === "quiz" || m === "lesson" || m === "exam" ? m : null;
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
	/* Les marqueurs VIDES ne comptent pas. C'est ce qui permet d'appliquer la
	   règle stricte PARTOUT, dernière position comprise : les deux lignes
	   héritées du bug de la question fantôme portent `options: ['', '']` et
	   `correctIndex: 0` — des coquilles sans contenu — là où une vraie question
	   a des réponses écrites. Sans cette nuance il fallait relâcher le critère
	   en fin de tableau, et une question réelle portant un champ `mode` y
	   disparaissait (revue codex 2026-07-31). */
	const rempli = (v: unknown): boolean => Array.isArray(v)
		? v.some(x => typeof x === "string" ? x.trim() !== "" : x != null)
		: typeof v === "string" ? v.trim() !== "" : v != null && v !== false;
	/* TOUS les marqueurs de question du moteur, pas seulement les plus visibles.
	   En oublier laissait passer une question historique complète —
	   `{ mode: 'learn', promptHtml: '<p>2 + 2 ?</p>', text: true, answer: '4' }`
	   était pris pour la configuration et retiré du quiz (revue codex
	   2026-07-31). */
	const MARQUEURS = ["options", "optionHtml", "cloze", "ordering", "matching",
		"promptHtml", "answer", "acceptedAnswers", "acceptableAnswers",
		"correctText", "correctAnswers", "numeric",
		// `tolerance`, `tolerancePercent` et `unit` suffisent au moteur à
		// déclarer une réponse numérique (engine/numeric.ts isNumericQuestion) :
		// les omettre faisait passer une vraie question pour la configuration.
		"tolerance", "tolerancePercent", "unit"];
	if (MARQUEURS.some(cle => rempli(q[cle]))) return false;
	/* `text` compte seulement s'il vaut EXACTEMENT `true` — c'est la règle du
	   moteur (engine.ts isTextQuestion). Un `text: { variant: 'bash' }` est une
	   forme imbriquée que le moteur ne lit QUE sur une question déjà déclarée
	   texte ; le traiter comme un marqueur transformait une configuration
	   légitime en question. */
	if (q.text === true) return false;
	/* `type` ne compte que s'il nomme un type de QUESTION. Une configuration a
	   le droit de porter une clé `type` personnalisée (« teacher-profile ») —
	   la traiter comme un marqueur en faisait une question fantôme. */
	if (typeof q.type === "string" && ["text", "single", "multiple", "multi"].includes(q.type)) return false;
	return true;
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
	/* La MÊME règle partout, y compris en dernière position. Elle y a un temps
	   été relâchée pour ne pas faire réapparaître deux lignes vides de notes
	   réelles ; excuser les marqueurs VIDES (cf. `isStrictQuizModeConfig`)
	   obtient le même résultat sans le prix — une question réelle portant un
	   champ `mode` ne disparaît plus, où qu'elle soit. */
	const dernier = items.length - 1;
	if (isStrictQuizModeConfig(items[dernier])) return dernier;
	return items.findIndex(isStrictQuizModeConfig);
}

function extractExamOptions(quizArray: QuizQuestion[]): {
	questions: QuizQuestion[];
	quizMode: QuizMode;
	examOptions: ExamOptions | null;
	lessonExamOptions: ExamOptions | null;
} {
	if (!Array.isArray(quizArray) || quizArray.length === 0) return { questions: quizArray, quizMode: "quiz", examOptions: null, lessonExamOptions: null };

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
		/* Déterminer le mode : "lesson" | "exam" | "quiz". `mode` prime sur les
		   deux booléens historiques, et passe par la même normalisation que la
		   RECONNAISSANCE — sans quoi un `mode: 'Learn'` serait admis comme
		   configuration puis lu comme un mode quiz. `lastItem.learnMode` reste
		   l'alias hérité de `mode: "learn"` (renommé "lesson"). */
		const quizMode: QuizMode = normalizeQuizMode(lastItem.mode)
			?? (lastItem.examMode === true ? "exam"
				: lastItem.learnMode === true ? "lesson"
					: "quiz");

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

		// Options d'examen pour le mode leçon (utilisé par "Passer l'examen")
		let lessonExamOptions: ExamOptions | null = null;
		if (quizMode === "lesson" && lastItem.examDurationMinutes != null) {
			lessonExamOptions = buildExamOpts();
		}

		return {
			questions: quizArray.filter((_, i) => i !== configIdx),
			quizMode,
			examOptions,
			lessonExamOptions
		};
	}

	return { questions: quizArray, quizMode: "quiz", examOptions: null, lessonExamOptions: null };
}

/** Forme structurelle minimale acceptée par `pickLessonFields` : les six
    champs "leçon" possibles d'une question, dans n'importe lequel des trois
    types réels qui les portent (`QuestionBase`, `ParsedQuizItem`,
    `DraftQuestion`) — typés `unknown` ici pour ne dépendre d'aucun des trois. */
interface LessonFieldsSource {
	lesson?: unknown;
	lessonHtml?: unknown;
	_lessonHtml?: unknown;
	learn?: unknown;
	learnHtml?: unknown;
	_learnHtml?: unknown;
}

/**
 * Contenu "Leçon" BRUT d'une question, texte et HTML chacun ramenés à UNE
 * seule chaîne de repli — nom canonique d'abord, alias hérité `learn*`
 * ensuite (mode "learn" renommé "lesson", task 0 du lot mode leçon,
 * 2026-08-31) : un quiz partagé écrit avant le renommage doit continuer de
 * s'afficher indéfiniment, on ne réécrit plus jamais que le nouveau nom.
 *
 * SEULE définition de cet ordre dans tout le plugin (round 1 de revue,
 * 2026-08-31) : `engine/sanitizer.ts` (rendu, a besoin en plus du sanitizer
 * pour choisir entre HTML pré-rendu et texte brut) et `editor/convert.ts` /
 * `editor/export.ts` (lecture / écriture du JSON5, qui n'ont pas besoin du
 * sanitizer) l'appellent tous les trois — avant cette fonction, chacun avait
 * réécrit sa propre chaîne, dans un ordre différent des deux autres, et
 * `export.ts` avait même oublié `lessonHtml` (présent seulement dans
 * `ParsedQuizItem`, pas dans `DraftQuestion`).
 */
export function pickLessonFields(q: LessonFieldsSource): { text?: string; html?: string } {
	const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
	return {
		text: str(q.lesson) ?? str(q.learn),
		html: str(q.lessonHtml) ?? str(q._lessonHtml) ?? str(q.learnHtml) ?? str(q._learnHtml),
	};
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
