import { makeDefault, defaultSlots, isRichHtml } from "./utils";
import type { DraftQuestion, QuestionTypeKey } from "./utils";
import { _htmlToText } from "./modals";
import type { ParsedQuizItem } from "./modals";
import type { EditorExamOptions } from "../types/editor-ctx";
import { normalizeQuizMode } from "../quiz-utils";
import { normalizeTerminalVariantName } from "../engine/terminal";

/* ══════════════════════════════════════════════════════════
   CONVERT — item JSON5 brut → DraftQuestion (forme d'édition)

   Extrait de editor.ts (où il n'était qu'une méthode greffée sur la vue,
   donc inaccessible hors de l'éditeur) pour que la page « quiz » du
   dashboard lise EXACTEMENT le même format : deux lectures divergentes
   d'un même bloc quiz-blocks finiraient par écrire des .md incompatibles.
   Corps repris à l'identique.
══════════════════════════════════════════════════════════ */

/* L'objet de CONFIGURATION du bloc se repère par son INDEX, jamais par un test
   sur l'élément seul : le critère dépend de sa POSITION dans le tableau
   (quiz-utils.ts `findQuizModeConfigIndex`). Le prédicat par élément a vécu ici
   sous le nom `isModeConfig` ; il a été retiré pour qu'un appelant ne puisse
   plus le prendre pour la règle complète. */

/** Options du bloc lues depuis l'objet de mode. */
export function readModeConfig(q: ParsedQuizItem): EditorExamOptions {
	/* Même normalisation que le moteur (quiz-utils.ts) : un bloc écrit à la main
	   dit volontiers `mode: 'Learn'`, et la reconnaissance l'accepte — la
	   lecture ne peut pas, elle, le renvoyer au mode quiz. */
	const mode: "quiz" | "learn" | "exam" = normalizeQuizMode(q.mode)
		?? (q.examMode === true ? "exam"
			: q.learnMode === true ? "learn"
				: "quiz");
	return {
		mode,
		// Le chrono n'est « activé » que pour un vrai mode examen ; un mode
		// learn peut en porter un (« Passer l'examen »), auquel cas il annonce
		// une durée.
		enabled: mode === "exam" || (mode === "learn" && q.examDurationMinutes != null),
		/* Les défauts sont ceux du MOTEUR (quiz-utils.ts buildExamOpts), pas
		   des valeurs « raisonnables » choisies ici : la lecture réécrit le
		   bloc, et un défaut divergent transformait silencieusement
		   `{ examMode: true }` en `examAutoSubmit: false` — le comportement de
		   l'examen changeait sans que personne n'y touche. Bornes comprises :
		   une durée de 999 s'afficherait telle quelle mais durerait 180. */
		durationMinutes: Math.max(1, Math.min(180, Number(q.examDurationMinutes) || 10)),
		autoSubmit: q.examAutoSubmit !== false,
		showTimer: q.examShowTimer !== false,
		_extra: extraModeFields(q),
	};
}

/** Les clés de l'objet de mode que le plugin ne connaît pas. Même principe que
    `_extraFields` sur une question : ce qu'on ne comprend pas, on le rend. */
function extraModeFields(q: ParsedQuizItem): Record<string, unknown> | undefined {
	const connues = new Set(["mode", "examMode", "learnMode",
		"examDurationMinutes", "examAutoSubmit", "examShowTimer"]);
	const extra: Record<string, unknown> = {};
	for (const cle of Object.keys(q)) {
		if (!connues.has(cle)) extra[cle] = (q as Record<string, unknown>)[cle];
	}
	return Object.keys(extra).length ? extra : undefined;
}

/** La variante de terminal telle qu'elle est ÉCRITE dans le bloc : sa clé et sa
    valeur, dans l'ordre où le moteur les consulte (engine/terminal.ts
    getTerminalTextVariant). */
function variantSource(q: ParsedQuizItem): { cle: string | null; valeur: unknown } {
	if (q.terminalVariant != null) return { cle: "terminalVariant", valeur: q.terminalVariant };
	if (q.textVariant != null) return { cle: "textVariant", valeur: q.textVariant };
	return { cle: null, valeur: null };
}

export function convertParsedToInternal(q: ParsedQuizItem): DraftQuestion {
	let type: QuestionTypeKey = "single";
	if (q.ordering) type = "ordering";
	else if (q.matching) type = "matching";
	// Le gabarit discrimine avant tout le reste (même règle que le moteur,
	// engine.ts isClozeQuestion) : une question qui porte un `cloze` non vide
	// est un texte à trous, quels que soient ses autres champs.
	/* `!= null` et non « non vide » : un gabarit VIDE reste une question à
	   trous, en attente d'être écrite. Exiger du contenu la reclassait en
	   choix unique, et la sauvegarde suivante remplaçait `cloze` par des
	   options fantômes (revue codex 2026-07-31). Le MOTEUR, lui, a raison
	   d'exiger du contenu : il ne peut rien afficher d'un gabarit vide. */
	else if (typeof q.cloze === "string") type = "cloze";
	/* MÊME critère que le moteur (engine/numeric.ts isNumericQuestion) : une
	   marge ou une unité suffisent à déclarer une réponse numérique. Une
	   détection plus étroite ici classerait la question en « texte », et
	   l'export perdrait `unit`/`tolerance` — ces clés ne transitent plus par
	   _extraFields depuis qu'elles ont leur propre branche. */
	else if (q.numeric === true
		|| typeof q.tolerance === "number"
		|| typeof q.tolerancePercent === "number"
		|| (typeof q.unit === "string" && q.unit.trim().length > 0)) type = "numeric";
	else if (q.multiSelect) type = "multi";
	else if (q.type === "text") {
		/* MÊME table d'alias que le moteur (engine/terminal.ts) : trois formes
		   exactes ne suffisaient pas. Les 22 questions Cisco d'Ahmed écrivent
		   `textVariant: 'command'`, que le moteur affiche en terminal `cmd` et
		   que l'éditeur prenait pour du texte ordinaire — la sauvegarde
		   suivante effaçait la variante ET son invite. */
		const variante = normalizeTerminalVariantName(variantSource(q).valeur);
		if (variante === "cmd") type = "cmd";
		else if (variante === "powershell") type = "powershell";
		// `sh`, `zsh`, `shell`… : l'éditeur n'a que trois types de terminal, et
		// bash est celui qui leur ressemble. La forme d'ORIGINE est mémorisée
		// plus bas et réémise telle quelle, donc rien ne se perd.
		else if (variante) type = "bash";
		else type = "text";
	}

	const question = makeDefault(type);
	question._id = q.id || Math.random().toString(36).slice(2, 10);
	if (typeof q.id === "string" && q.id.trim()) question._sourceId = q.id;
	question.title = q.title || "";
	// « Question N » non localisé : motif du titre auto écrit dans le .md.
	question._userModifiedTitle = !/^Question \d+$/.test(question.title);
	question.hint = q.hint || "";

	if (q.prompt) {
		question.prompt = q.prompt;
	} else if (q.promptHtml) {
		question.prompt = _htmlToText(q.promptHtml);
	}
	if (q.promptHtml) {
		question._promptHtml = q.promptHtml;
		// Si promptHtml existe, activer par défaut l'édition HTML
		question._useHtmlPrompt = true;
	}

	if (q.explain) question.explain = q.explain;
	else if (q.explainHtml && !isRichHtml(q.explainHtml)) {
		/* Uniquement si le HTML est une simple enveloppe (`<p>`, `<br>`) : le
		   remplir depuis un HTML RICHE faisait reprendre à l'export la version
		   APLATIE — corriger une faute de frappe dans le TITRE suffisait à
		   perdre un `<blockquote>` et ses emphases, sans que l'explication ait
		   été touchée (revue codex 2026-07-31). Laissé vide, c'est
		   `_explainHtml` qui fait foi des deux côtés, comme `_useHtmlPrompt`
		   le fait déjà pour l'énoncé. */
		question.explain = _htmlToText(q.explainHtml);
	}
	if (q.explainHtml) {
		question._explainHtml = q.explainHtml;
	}

	if (q.resourceButton) {
		question.resourceButton = { ...q.resourceButton };
	}

	if (type === "single" || type === "multi") {
		question.options = q.options || ["", ""];
		if (type === "single") {
			question.correctIndex = q.correctIndex ?? 0;
		} else {
			question.correctIndices = q.correctIndices || [];
		}
	}

	if (type === "ordering") {
		question.slots = q.slots || defaultSlots();
		question.possibilities = q.possibilities || ["", ""];
		question.correctOrder = q.correctOrder || [0, 1];
	}

	if (type === "matching") {
		question.rows = q.rows || ["", ""];
		question.choices = q.choices || ["", ""];
		question.correctMap = q.correctMap || [0, 0];
	}

	if (type === "cloze") {
		question.cloze = String(q.cloze ?? "");
		question.caseSensitive = q.caseSensitive || false;
	}

	if (["numeric", "text", "cmd", "powershell", "bash"].includes(type)) {
		let accepted = (q.acceptedAnswers || q.acceptableAnswers || [""]).slice();
		// `answer`/`correctText` : formats émis par la génération IA et
		// UNIONNÉS aux acceptedAnswers par le moteur (terminal.js:166-170)
		// — les fusionner pareil ici, sinon le round-trip éditeur→export
		// PERD une réponse valide (answer est dans knownKeys, donc plus
		// réémis via _extraFields). String/number seulement (le moteur
		// ignore les autres types) ; `!= null` : answer 0 est légitime.
		for (const extra of [q.correctText, q.answer]) {
			if (extra == null) continue;
			if (typeof extra !== "string" && typeof extra !== "number") continue;
			const v = String(extra);
			if (accepted.length === 1 && accepted[0] === "") {
				accepted = [v];
			} else if (!accepted.includes(v)) {
				accepted.push(v);
			}
		}
		question.acceptedAnswers = accepted;
		question.caseSensitive = q.caseSensitive || false;
		question.placeholder = q.placeholder || "";
		/* L'invite vaut pour TOUTES les variantes de terminal, bash compris
		   (engine/terminal.ts getTerminalPromptPrefix) — la restreindre à
		   cmd/powershell faisait disparaître « Town-Hall# » et consorts. */
		if (type === "cmd" || type === "powershell" || type === "bash") {
			const parDefaut = type === "cmd" ? "C:\\>" : type === "powershell" ? "PS>" : "user@hostname:~$ ";
			question.commandPrefix = q.commandPrefix || parDefaut;
		}
		/* La forme EXACTE de la variante, avec la clé qui la portait : c'est
		   elle qu'on réémettra, pas sa forme canonique. Réécrire
		   `textVariant: 'command'` en `terminalVariant: 'cmd'` changerait la
		   note sans que personne ne l'ait demandé. */
		const src = variantSource(q);
		if (src.cle) { question._variantKey = src.cle; question._variantValue = String(src.valeur); }
		if (type === "numeric") {
			question.unit = typeof q.unit === "string" ? q.unit : "";
			if (typeof q.tolerance === "number") question.tolerance = q.tolerance;
			if (typeof q.tolerancePercent === "number") question.tolerancePercent = q.tolerancePercent;
		}
	}

	const knownKeys = new Set(['id','title','prompt','promptHtml','options','correctIndex','multiSelect','correctIndices','ordering','slots','possibilities','correctOrder','matching','rows','choices','correctMap','type','terminalVariant','textVariant','commandPrefix','placeholder','caseSensitive','acceptedAnswers','acceptableAnswers','correctText','answer','hint','explain','explainHtml','resourceButton','examMode','examDurationMinutes','examAutoSubmit','examShowTimer','cloze','numeric','tolerance','tolerancePercent','unit']);
	const extraFields: Record<string, unknown> = {};
	for (const key of Object.keys(q)) {
		if (!knownKeys.has(key)) extraFields[key] = q[key];
	}
	question._extraFields = extraFields;

	return question;
}
