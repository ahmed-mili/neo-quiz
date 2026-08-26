import { escHtml, esc5, md2html } from "./utils";
import type { DraftQuestion } from "./utils";
import type { EditorExamOptions } from "../types/editor-ctx";

function exportQuestion(q: DraftQuestion, idx: number): string {
	// Conserver l'id importé : il sert désormais de clé stable à la mémoire
	// espacée. Un changement de titre ne doit pas remettre la carte à zéro.
	const id = q._id || (q.title ? q.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) : `q${idx + 1}`);
	const e = esc5;
	const L: string[] = [];
	L.push("\t{");
	L.push(`\t\tid: '${e(id)}',`);
	L.push(`\t\ttitle: '${e(q.title || `Question ${idx + 1}`)}',`);
	if (q.resourceButton) L.push(`\t\tresourceButton: {\n\t\t\tlabel: '${e(q.resourceButton.label)}',\n\t\t\tfileName: '${e(q.resourceButton.fileName)}'\n\t\t},`);
	// Priorité au prompt modifié par l'utilisateur, _promptHtml est fallback
	if (q._useHtmlPrompt && q._promptHtml) {
		// Si l'utilisateur édite en mode HTML, utiliser directement _promptHtml
		L.push(`\t\tpromptHtml: '${e(q._promptHtml)}',`);
	} else if (q.prompt) {
		const hasMd = q.prompt && (/[*#`>\-]/.test(q.prompt) || q.prompt.includes("\n"));
		if (hasMd) L.push(`\t\tpromptHtml: '${e(md2html(q.prompt))}',`);
		else L.push(`\t\tprompt: '${e(q.prompt)}',`);
	} else if (q._promptHtml) {
		L.push(`\t\tpromptHtml: '${e(q._promptHtml)}',`);
	}
	const t = q._type;
	if (t === "single") {
		L.push(`\t\toptions: [\n${(q.options || []).map(o => `\t\t\t'${e(o)}',`).join("\n")}\n\t\t],`);
		L.push(`\t\tcorrectIndex: ${q.correctIndex ?? 0},`);
	}
	if (t === "multi") {
		L.push(`\t\toptions: [\n${(q.options || []).map(o => `\t\t\t'${e(o)}',`).join("\n")}\n\t\t],`);
		L.push("\t\tmultiSelect: true,");
		L.push(`\t\tcorrectIndices: [${(q.correctIndices || []).join(", ")}],`);
	}
	if (t === "ordering") {
		L.push("\t\tordering: true,");
		L.push(`\t\tslots: [${(q.slots || []).map(s => `'${e(s)}'`).join(", ")}],`);
		L.push(`\t\tpossibilities: [\n${(q.possibilities || []).map(p => `\t\t\t'${e(p)}',`).join("\n")}\n\t\t],`);
		L.push(`\t\tcorrectOrder: [${(q.correctOrder || []).join(", ")}],`);
	}
	if (t === "matching") {
		L.push("\t\tmatching: true,");
		L.push(`\t\trows: [\n${(q.rows || []).map(r => `\t\t\t'${e(r)}',`).join("\n")}\n\t\t],`);
		L.push(`\t\tchoices: [\n${(q.choices || []).map(c => `\t\t\t'${e(c)}',`).join("\n")}\n\t\t],`);
		L.push(`\t\tcorrectMap: [${(q.correctMap || []).join(", ")}],`);
	}
	if (t === "cloze") {
		// Le gabarit porte à lui seul l'énoncé ET les réponses : rien d'autre
		// à écrire, et `type` reste absent (le moteur discrimine sur `cloze`).
		L.push(`\t\tcloze: '${e(q.cloze || "")}',`);
		if (q.caseSensitive) L.push("\t\tcaseSensitive: true,");
	}
	if (["numeric", "text", "cmd", "powershell", "bash"].includes(t)) {
		L.push("\t\ttype: 'text',");
		if (t === "cmd") L.push("\t\tterminalVariant: 'cmd',");
		if (t === "powershell") L.push("\t\ttextVariant: 'powershell',");
		if (t === "bash") L.push("\t\ttextVariant: 'bash',");
		if (q.commandPrefix && (t === "cmd" || t === "powershell")) L.push(`\t\tcommandPrefix: '${e(q.commandPrefix)}',`);
		if (q.placeholder) L.push(`\t\tplaceholder: '${e(q.placeholder)}',`);
		if (q.caseSensitive) L.push("\t\tcaseSensitive: true,");
		if (t === "numeric") {
			L.push("\t\tnumeric: true,");
			if (q.unit && q.unit.trim()) L.push(`\t\tunit: '${e(q.unit)}',`);
			// Marges mutuellement exclusives (cf. formulaire) : au plus une des
			// deux est définie, jamais les deux.
			if (typeof q.tolerance === "number") L.push(`\t\ttolerance: ${q.tolerance},`);
			if (typeof q.tolerancePercent === "number") L.push(`\t\ttolerancePercent: ${q.tolerancePercent},`);
		}
		L.push(`\t\tacceptedAnswers: [\n${(q.acceptedAnswers || []).filter(Boolean).map(a => `\t\t\t'${e(a)}',`).join("\n")}\n\t\t],`);
	}
	/* Virgule SYSTÉMATIQUE, y compris sur le dernier champ écrit : JSON5
	   autorise la virgule traînante, et la conditionner à « y a-t-il un champ
	   après ? » n'a jamais tenu. `hint` et `explainHtml` se croyaient derniers
	   et s'écrivaient sans virgule — mais `_extraFields` en écrit d'autres
	   ensuite (learn, passage, mathInput, numeric…). Une question portant une
	   explication ET un de ces champs produisait un bloc JSON5 INVALIDE, que le
	   moteur refusait de parser (« invalid character 'p' »). */
	if (q.hint) {
		L.push(`\t\thint: '${e(q.hint)}',`);
	}
	// Priorité à explain modifié par l'utilisateur
	if (q.explain) {
		L.push(`\t\texplainHtml: '${e(md2html(q.explain))}',`);
	} else if (q._explainHtml) {
		L.push(`\t\texplainHtml: '${e(q._explainHtml)}',`);
	}

	if (q._extraFields && Object.keys(q._extraFields).length > 0) {
		// Track keys already exported to avoid duplicates
		const exportedKeys = new Set([
			'id', 'title', 'prompt', 'promptHtml', 'options', 'correctIndex',
			'multiSelect', 'correctIndices', 'ordering', 'slots', 'possibilities',
			'correctOrder', 'matching', 'rows', 'choices', 'correctMap', 'type',
			'terminalVariant', 'textVariant', 'commandPrefix', 'placeholder',
			'caseSensitive', 'acceptedAnswers', 'hint', 'explainHtml',
			'resourceButton', 'cloze', 'numeric', 'tolerance', 'tolerancePercent', 'unit'
		]);
		for (const [key, val] of Object.entries(q._extraFields)) {
			if (exportedKeys.has(key)) continue; // Skip already exported keys
			if (typeof val === 'string') {
				L.push(`\t\t${key}: '${e(val)}',`);
			} else if (typeof val === 'number') {
				L.push(`\t\t${key}: ${val},`);
			} else if (typeof val === 'boolean') {
				L.push(`\t\t${key}: ${val},`);
			} else if (Array.isArray(val) || (val && typeof val === 'object')) {
				// JSON est un sous-ensemble de JSON5 et préserve aussi les tableaux
				// d'objets tels que sourceRefs (l'ancien join écrivait [object Object]).
				L.push(`\t\t${key}: ${JSON.stringify(val)},`);
			}
		}
	}

	L.push("\t}");
	return L.join("\n");
}

function exportAll(questions: DraftQuestion[], examOptions: EditorExamOptions | null = null): string {
	const parts = questions.map((q, i) => exportQuestion(q, i));

	/* L'objet de mode est réémis SOUS SA FORME D'ORIGINE. Un quiz importé en
	   mode learn ressortait en mode examen (ou perdait son mode), parce que
	   l'export ne savait écrire que `examMode: true`. */
	const mode = examOptions?.mode;
	const timing = examOptions
		? `\t\texamDurationMinutes: ${examOptions.durationMinutes},\n\t\texamAutoSubmit: ${examOptions.autoSubmit},\n\t\texamShowTimer: ${examOptions.showTimer},\n`
		: "";
	if (mode === "learn") {
		// Mode learn AVEC examen (« Passer l'examen ») ou sans, selon le chrono.
		parts.push(`\t// Mode learn\n\t{\n\t\tmode: 'learn',\n${examOptions?.enabled ? timing : ""}\t}`);
	} else if (examOptions && examOptions.enabled) {
		parts.push(`\t// Options mode examen\n\t{\n\t\texamMode: true,\n${timing}\t}`);
	}
	return "[\n" + parts.join(",\n\n") + "\n]";
}
function exportAllWithFence(questions: DraftQuestion[], examOptions: EditorExamOptions | null = null): string {
	return "```quiz-blocks\n" + exportAll(questions, examOptions) + "\n```";
}

export { exportQuestion, exportAll, exportAllWithFence };
