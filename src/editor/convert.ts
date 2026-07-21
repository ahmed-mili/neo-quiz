import { makeDefault, defaultSlots } from "./utils";
import type { DraftQuestion, QuestionTypeKey } from "./utils";
import { _htmlToText } from "./modals";
import type { ParsedQuizItem } from "./modals";

/* ══════════════════════════════════════════════════════════
   CONVERT — item JSON5 brut → DraftQuestion (forme d'édition)

   Extrait de editor.ts (où il n'était qu'une méthode greffée sur la vue,
   donc inaccessible hors de l'éditeur) pour que la page « quiz » du
   dashboard lise EXACTEMENT le même format : deux lectures divergentes
   d'un même bloc quiz-blocks finiraient par écrire des .md incompatibles.
   Corps repris à l'identique.
══════════════════════════════════════════════════════════ */

export function convertParsedToInternal(q: ParsedQuizItem): DraftQuestion {
	let type: QuestionTypeKey = "single";
	if (q.ordering) type = "ordering";
	else if (q.matching) type = "matching";
	else if (q.multiSelect) type = "multi";
	else if (q.type === "text") {
		if (q.terminalVariant === "cmd") type = "cmd";
		else if (q.textVariant === "powershell") type = "powershell";
		else if (q.textVariant === "bash") type = "bash";
		else type = "text";
	}

	const question = makeDefault(type);
	question._id = q.id || Math.random().toString(36).slice(2, 10);
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
	else if (q.explainHtml) {
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

	if (["text", "cmd", "powershell", "bash"].includes(type)) {
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
		if (type === "cmd" || type === "powershell") {
			question.commandPrefix = q.commandPrefix || (type === "cmd" ? "C:\\>" : "PS>");
		}
	}

	const knownKeys = new Set(['id','title','prompt','promptHtml','options','correctIndex','multiSelect','correctIndices','ordering','slots','possibilities','correctOrder','matching','rows','choices','correctMap','type','terminalVariant','textVariant','commandPrefix','placeholder','caseSensitive','acceptedAnswers','acceptableAnswers','correctText','answer','hint','explain','explainHtml','resourceButton','examMode','examDurationMinutes','examAutoSubmit','examShowTimer']);
	const extraFields: Record<string, unknown> = {};
	for (const key of Object.keys(q)) {
		if (!knownKeys.has(key)) extraFields[key] = q[key];
	}
	question._extraFields = extraFields;

	return question;
}
