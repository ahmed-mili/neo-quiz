import { Platform } from "obsidian";
import type { ChildProcess } from "child_process";
import type { Plugin } from "obsidian";
import type { AiSettings } from "../types/dashboard-ctx";
import {
	resolveClaudeModel,
	resolveCodexModel,
	resolveEffort,
	getCodexModels,
	getProvider,
	buildChildEnv,
	isOllamaCloudModel,
} from "./ai-providers";
import type { AiUsage } from "./ai-usage";
import { t } from "../i18n";

/* ══════════════════════════════════════════════════════════
   AI CLIENT — Claude Code + Codex + Ollama
   Claude/Codex: via le CLI de l'abonnement (aucune clé API), prompt par stdin.
   Ollama: fetch() pour lire les corps d'erreur. Multimodal pour images.
══════════════════════════════════════════════════════════ */

/* Délai avant abandon d'un CLI. 3 min ne suffisaient pas : un modèle à
   raisonnement, nourri de plusieurs notes jointes (~20 k tokens d'entrée) et
   qui doit produire des questions avec leçon et explication, dépasse
   couramment les 7 min — mesuré le 2026-07-31 sur le projet TOBEADMIN, où la
   génération partait à la poubelle alors qu'elle se serait terminée. La
   valeur est UNE constante, injectée dans le message d'erreur : le texte ne
   peut plus mentir sur la durée réellement appliquée. */
const CLI_TIMEOUT_MS = 900000;
const CLI_TIMEOUT_MIN = String(Math.round(CLI_TIMEOUT_MS / 60000));

/** Hôte plugin attendu par createAiClient (seul `settings` est lu). */
export type AiPlugin = Plugin & { settings: AiSettings };

/** Image jointe à la génération (vision). */
export interface ImagePayload {
	base64: string;
	mediaType?: string;
}

/** Options de génération (nombre, type, source, images). */
export interface GenerateOptions {
	count?: number;
	type?: string;
	source?: string;
	images?: ImagePayload[];
}

/** Client IA — retour de createAiClient(plugin). */
export interface AiClient {
	generate(prompt: string, options?: GenerateOptions): Promise<unknown[]>;
	abort(): void;
	/** Consommation de la DERNIÈRE génération réussie ; null si le fournisseur
	    n'a rien publié (cf. ai-usage.ts : on n'estime jamais un compteur absent). */
	lastUsage: AiUsage | null;
}

/** Erreur d'exécution CLI enrichie (child_process.exec). */
type ExecError = Error & {
	code?: string | number;
	stderr?: string;
	stdout?: string;
	killed?: boolean;
};

/** Erreur DÉJÀ formulée pour l'utilisateur (message traduit, affiché tel quel
    par l'écran d'erreur de la vue « Générer »). */
type UserFacingError = Error & { userFacing?: boolean };

/* Le drapeau remplace les tests sur le TEXTE du message (« Le modèle… »,
   « Mémoire insuffisante… ») que faisait callOllama pour distinguer ses
   propres erreurs des pannes réseau : une fois les messages traduits, ces
   préfixes ne correspondent plus dans une autre langue, et l'erreur précise
   serait écrasée par « Impossible de contacter Ollama ». */
function userError(message: string): UserFacingError {
	const e = new Error(message) as UserFacingError;
	e.userFacing = true;
	return e;
}

export function createAiClient(plugin: AiPlugin): AiClient {
	// ── Annulation (bouton stop / Esc) ──
	// Chaque appel CLI/HTTP enregistre sa fonction d'arrêt ici ; abort()
	// l'invoque. L'erreur qui en résulte (process tué, fetch avorté) est
	// traduite en erreur marquée `aborted` que l'UI traite comme un retour
	// à l'état initial, pas comme une erreur.
	let abortCurrent: (() => void) | null = null;
	let aborted = false;

	/* ── Compteurs de la génération en cours ──
	   Chaque `callX` dépose ici ce que SON fournisseur a publié ; generate()
	   complète avec ce qu'il est seul à savoir (fournisseur, modèle, durée) et
	   scelle le tout dans `lastUsage`. Ce qu'un fournisseur ne publie pas reste
	   à 0 / null — jamais estimé (cf. ai-usage.ts). */
	let pendingUsage: Partial<AiUsage> | null = null;
	let lastUsage: AiUsage | null = null;

	/* Demande en cours, retenue POUR LE SEUL diagnostic d'un échec de parsing
	   (cf. nonQuizResponseError) : le parseur ne voit que la réponse, or la
	   cause d'une réponse hors-sujet se lit souvent dans la question. */
	let lastRequestText = "";

	/* Lecture par FONCTION, jamais directement : `pendingUsage` est rempli
	   depuis une closure appelée derrière un `await`, ce que l'analyse de flux
	   de TypeScript ne voit pas — un `if (pendingUsage)` posé après l'await
	   narrowerait la variable à `never` sur la foi du `= null` initial. */
	const takePendingUsage = (): Partial<AiUsage> | null => pendingUsage;

	function killTree(child: ChildProcess): void {
		// Windows : taskkill /T /F sur le PID précis tue tout l'arbre
		// (codex/claude spawnent des enfants) ; ailleurs SIGTERM suffit.
		try {
			if (process.platform === "win32") {
				(require("child_process") as typeof import("child_process")).exec("taskkill /pid " + child.pid + " /T /F", { windowsHide: true });
			} else {
				child.kill("SIGTERM");
			}
		} catch (e) { /* best effort */ }
	}

	async function generate(prompt: string, options: GenerateOptions = {}): Promise<unknown[]> {
		aborted = false;
		pendingUsage = null;
		lastUsage = null;
		const startedAt = Date.now();
		try {
			const questions = await generateInner(prompt, options);
			const u = takePendingUsage();
			if (u) {
				lastUsage = {
					provider: u.provider || plugin.settings.aiProvider || "",
					model: u.model || plugin.settings.aiModel || "",
					inputTokens: u.inputTokens || 0,
					outputTokens: u.outputTokens || 0,
					cachedInputTokens: u.cachedInputTokens || 0,
					costUsd: u.costUsd ?? null,
					durationMs: Date.now() - startedAt,
					sessionId: u.sessionId
				};
			}
			return questions;
		} catch (err) {
			if (aborted) {
				const e = new Error("Génération annulée") as Error & { aborted?: boolean };
				e.aborted = true;
				throw e;
			}
			throw err;
		} finally {
			abortCurrent = null;
		}
	}

	async function generateInner(prompt: string, options: GenerateOptions = {}): Promise<unknown[]> {
		const { count = 5, type = "Mixte", source = "topic", images = [] } = options;
		lastRequestText = prompt;
		const provider = plugin.settings.aiProvider || "claude-code";
		// Le défaut vient du registry, JAMAIS d'une copie locale : une seconde
		// table avait divergé (« sonnet » ici, « opus » dans PROVIDERS), donc le
		// composer annonçait un modèle et la génération en lançait un autre.
		let model = plugin.settings.aiModel || getProvider(provider).defaultModel;
		// Fable 5 masqué si la promo n'est plus proposée → retombe sur le défaut Claude
		if (provider === "claude-code") {
			model = resolveClaudeModel(model);
		}
		// Codex : si le modèle persisté n'est pas dans la liste réelle du
		// compte (~/.codex/models_cache.json — ex. bascule récente de
		// provider, slug retiré), retombe sur le défaut Codex.
		if (provider === "codex") {
			model = resolveCodexModel(model);
		}

		// ── Prompts : ANGLAIS, et INDÉPENDANTS de la langue de l'UI ──
		// Le prompt ne dicte PAS la langue du quiz : il impose au modèle de
		// suivre celle de la DEMANDE (règle LANGUAGE ci-dessous). Un prompt
		// français produisait des quiz français même pour un sujet demandé en
		// anglais ou en arabe. Les libellés du composer (« Mixte »…) ne sont pas
		// traduits ici non plus : `type` est la VALEUR canonique (cf. TYPE_VALUES
		// dans ai.ts), pas le libellé affiché.
		const typeInstruction = type === "Mixte"
			? "a mix of single-choice, multiple-choice and free-text questions"
			: type === "Choix unique"
			? "single-choice questions (exactly one correct answer)"
			: type === "Choix multiple"
			? "multiple-choice questions (several correct answers)"
			: type === "Compréhension"
			// Le type qui manquait : un vrai sujet d'examen a une partie
			// compréhension, où UN document porte plusieurs questions. Le
			// contrat est explicite (un seul groupe, id partagé, aucune
			// question hors document) parce que les modèles produisent sinon
			// un support par question — ce qui n'est plus de la compréhension.
			? `COMPREHENSION questions, ALL of them based on ONE source document that you write yourself.
	Write a substantial passage (250-450 words: an article extract, a case study, a scenario, a piece of code — whatever suits the topic) and put it in the "passage" field of the FIRST question, together with "passageId": "doc1" and a "passageTitle" naming the document.
	EVERY other question repeats ONLY "passageId": "doc1" (no "passage", no "passageTitle" — the engine shares the document automatically).
	The questions must be ANSWERABLE FROM THE DOCUMENT ALONE and test understanding — main idea, inference, meaning in context, cause and effect, the author's intent, what can or cannot be concluded — NOT recall of outside knowledge. Mix single-choice, multiple-choice and free-text among them`
			: "free-text questions";

		const systemPrompt = `You are a quiz generator. Generate exactly ${count} quiz questions as a JSON5 array. Each question must have:
	- title: short question title
	- prompt: full question text
	- options: array of options (for single/multiple choice, 3-5 options)
	- correctIndex: index of the correct answer (single choice)
	- correctIndices: array of indices of the correct answers (multiple choice)
	- multiSelect: true for multiple choice
	- type: "text" for free text, omitted otherwise
	- answer: expected answer (free text)
	- mathInput: true for a text question whose answer is a mathematical expression (the learner answers in a visual EQUATION EDITOR)
	- answerTemplate: a LaTeX template pre-filled in the answer field of a mathInput question, with \\\\placeholder{} for each blank to fill (e.g. 'x = \\\\placeholder{}' ; two solutions: 'x_1 = \\\\placeholder{},\\\\; x_2 = \\\\placeholder{}'). RULES for mathInput: the question text NEVER gives answer-format instructions (no "as a fraction", "comma-separated", "e.g. 1/2") — the equation editor makes all of that pointless; prefer an answerTemplate that guides instead; acceptedAnswers are the COMPLETE content of the field once the template is filled, in LaTeX (e.g. 'x_1 = \\\\frac{1}{2},\\\\; x_2 = 3'), and add variants where relevant (solutions in reverse order)
	- lesson: a short lesson paragraph teaching the concept before the question (optional but recommended for educational quizzes)
	- cloze: a FILL-IN-THE-BLANK text. Put the whole sentence or paragraph in this field and wrap each blank in DOUBLE BRACES, with accepted variants separated by "|": "The capital of France is {{Paris}} and its currency is {{the euro|euro}}." Use double BRACES, never double brackets — double brackets are Obsidian's internal-link syntax and would be rewritten before the quiz is read. Keep "prompt" as the instruction ("Complete the text below"). 2 to 5 blanks per question, each on a key term, never on a word the sentence already gives away
	- numeric / tolerance / tolerancePercent / unit: for a free-text question whose answer is a NUMBER. Set "numeric": true and the answer is compared as a value, not as a string, so "3.14", "3,14" and "3.140" all pass. Add "tolerance" (absolute margin) or "tolerancePercent" (relative margin) whenever the expected answer is a measurement or a rounded result, and "unit" (e.g. "m/s") when one is expected — the learner may write it or omit it. ALWAYS prefer this over a plain text answer for any question that asks "how much", "how many" or a computed value
	- ordering / slots / possibilities / correctOrder: a question where the learner puts items in the RIGHT ORDER. Set "ordering": true, "slots" naming each position (e.g. ['1st','2nd','3rd','4th']), "possibilities" listing the items in a DELIBERATELY WRONG order, and "correctOrder" giving, for each slot in turn, the INDEX of the item of "possibilities" that belongs there. Use it for a chronology, a protocol exchange, the steps of a procedure or a calculation
	- matching / rows / choices / correctMap: a question where the learner PAIRS two columns. Set "matching": true, "rows" (the left column: terms, devices, codes…), "choices" (the right column: definitions, roles…, listed in a different order from the rows) and "correctMap" giving, for each row in turn, the INDEX of its matching entry in "choices". Use it to oppose notions that are easily confused
	- passage / passageId / passageTitle: a SOURCE DOCUMENT to read before answering (comprehension). "passage" holds the full text, "passageTitle" names it, and "passageId" is a shared key: every question carrying the SAME passageId shows the SAME document, so write the text ONCE on the first question of the group and give the others only their passageId. Use this whenever several questions probe one text, case, scenario or code sample

	LANGUAGE — THIS IS A HARD RULE: write ALL the content you produce (title, prompt, options, answer, lesson, explain) in THE SAME LANGUAGE AS THE USER REQUEST BELOW. If the request is in French, write the quiz in French; in Arabic, in Arabic; in English, in English. When the request provides source material (a text, a note, images), follow the language of that material. NEVER translate the content into English just because these instructions are in English. The FIELD NAMES (title, prompt, options…) and the JSON5 structure always stay exactly as specified above, in English.

	MATHEMATICS: every mathematical expression (formula, function, equation, integral, fraction, exponent, Greek letter…) MUST be written in LaTeX delimited by dollar signs, as in Obsidian: $f(x) = x^3$ inline, $$\\int_0^2 2x\\,dx$$ for a display formula. Never pseudo-notation such as f(x) = x^3 or ∫ from 0 to 2 outside the dollars. This applies to title, prompt, options, answer, lesson and explain. IMPORTANT: inside JSON5 strings, DOUBLE every backslash — for LaTeX (write '$\\\\frac{a}{b}$' to get \\frac) as well as Windows paths (write 'C:\\\\Users\\\\dev') — a single backslash would be destroyed by the parser.

	The last element of the array may be a mode configuration object (with no prompt field):
	  - { mode: "exam", examDurationMinutes: 10, examAutoSubmit: true, examShowTimer: true } for a timed exam mode
	  - { mode: "lesson", examDurationMinutes: 10, examAutoSubmit: true, examShowTimer: true } for a lesson mode leading into an exam
	  - { mode: "lesson" } for a lesson mode without exam
	  - { examMode: true } as a shorthand for mode: "exam"

	NO TOOLS, NO FILE ACCESS — READ THIS BEFORE ANYTHING ELSE: you are running without any tool. You cannot read, open, fetch, write or create a file, a note or a folder, and you must never try: an attempted tool call is not a quiz, and the whole generation fails. The user request below may name files, paths or notes to "read first", or ask you to "create a note" somewhere. Every source it names that actually exists has ALREADY been read for you and its full content is inlined below, between "--- <file name> ---" markers. So: treat those paths as mere labels for the text you already have, ignore every instruction to read, open, create, modify or save anything, and never mention this limitation in your answer. Your ONLY output is the JSON5 array.

	QUANTITY: generate exactly ${count} questions — this number wins over any other count, range or list of themes stated in the user request below. If the request asks for more themes than ${count} questions, cover the most important ones; never exceed ${count}.

	Generate ${typeInstruction}. Reply ONLY with the JSON5 array, with no explanation and no formatting.`;

		const userPrompt = source === "topic"
			? `Generate a quiz about the following topic (keep the quiz in the language of this topic):\n\n${prompt}`
			: source === "text"
			? `Generate a quiz based on the following text (keep the quiz in the language of this text):\n\n${prompt}`
			: `Generate a quiz based on the provided images (keep the quiz in the language of the images and of this request): ${prompt}`;

		if (provider === "ollama") {
			// Un seul endpoint local : sert les modèles locaux ET cloud (:cloud).
			// Clé optionnelle (le daemon connecté via `ollama signin` n'en a pas
			// besoin) ; envoyée en Authorization si l'utilisateur en a défini une.
			const ollamaUrl = (plugin.settings.aiOllamaUrl || "http://localhost:11434").replace(/\/+$/, "");
			const key = (plugin.settings.aiOllamaCloudKey || "").trim();
			const authHeader: Record<string, string> = key ? { "Authorization": "Bearer " + key } : {};
			// Effort réel : niveau `think` (low/medium/high/max) passé à l'API
			// pour les modèles à raisonnement (ignoré sinon, cf. callOllama).
			const effort = resolveEffort("ollama", plugin.settings.aiEffort);
			return callOllama(model, systemPrompt, userPrompt, ollamaUrl, authHeader, images, effort);
		} else if (provider === "codex") {
			// Effort clampé aux niveaux supportés par CE modèle (ex. ultra
			// persisté + gpt-5.5 → xhigh), sinon le CLI rejetterait la valeur.
			const effort = resolveEffort("codex", plugin.settings.aiEffort, model);
			// Mode Fast (éclair du popover effort) : service tier « priority »,
			// seulement si CE modèle l'expose (cf. models_cache service_tiers).
			const m = getCodexModels().find(x => x.value === model);
			const fast = !!plugin.settings.aiCodexFast && !!(m && m.fast);
			return callCodex(model, systemPrompt, userPrompt, images, effort, fast);
		} else {
			return callClaudeCode(model, systemPrompt, userPrompt, images);
		}
	}

	/* ── Claude via le CLI Claude Code (compte par abonnement) ──
	   Aucune clé API : réutilise la session du CLI connecté au
	   compte Pro/Max/Team/Enterprise. Prompt complet par stdin
	   (aucun échappement d'argument), sortie --output-format json. */
	async function callClaudeCode(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = []): Promise<unknown[]> {
		if (!Platform.isDesktopApp) {
			throw new Error(t("ai.hint.claudeDesktopOnly"));
		}
		if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
			throw new Error(t("ai.err.invalidModelClaude", { model }));
		}

		const cp = require("child_process") as typeof import("child_process");
		const os = require("os") as typeof import("os");
		const path = require("path") as typeof import("path");
		const fs = require("fs") as typeof import("fs");

		// Images : écrites en fichiers temporaires que Claude lit
		// avec le tool Read (multimodal, read-only)
		let tools = '""';
		let imageNote = "";
		let tmpDir: string | null = null;
		if (images.length > 0) {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-blocks-"));
			const paths = images.map((img, i) => {
				const ext = ((img.mediaType || "image/png").split("/")[1] || "png").replace("jpeg", "jpg");
				const p = path.join(tmpDir as string, "image-" + (i + 1) + "." + ext);
				fs.writeFileSync(p, Buffer.from(img.base64, "base64"));
				return p;
			});
			tools = '"Read"';
			// Instruction au MODÈLE (pas de l'UI) → anglais, comme le prompt
			// système ; la langue du quiz reste celle de la demande.
			imageNote = "\n\nFirst read these images with the Read tool, then base the quiz on their content:\n" +
				paths.map(p => "- " + p).join("\n");
		}

		const fullPrompt = systemPrompt + "\n\n" + userPrompt + imageNote;
		const cmd = "claude -p --output-format json --model " + model +
			" --tools " + tools + " --no-session-persistence --setting-sources \"\"";

		let stdout: string;
		try {
			stdout = await new Promise<string>((resolve, reject) => {
				const child = cp.exec(cmd, {
					cwd: os.homedir(),
					env: buildChildEnv(),
					timeout: CLI_TIMEOUT_MS,
					maxBuffer: 16 * 1024 * 1024,
					windowsHide: true
				}, (err, out, stderr) => {
					if (err) {
						const e = err as ExecError;
						e.stderr = stderr;
						e.stdout = out;
						reject(e);
					} else {
						resolve(out);
					}
				});
				abortCurrent = () => { aborted = true; killTree(child); };
				child.stdin!.write(fullPrompt);
				child.stdin!.end();
			});
		} catch (err) {
			/* Une ANNULATION n'est pas une erreur. `killTree` fait sortir le
			   processus en echec — souvent avec `killed`, que la branche
			   ci-dessous prendrait pour un depassement de delai — et le journal
			   se remplissait d'erreurs a chaque clic sur Stop. `generate()`
			   traduit ensuite ce rejet en erreur `aborted`, que l'UI traite
			   comme un retour a l'etat initial. */
			if (aborted) throw err;
			const e = err as ExecError;
			console.error("[quiz-blocks] Claude Code error:", e.message, e.stderr || "");
			const detail = ((e.stderr || "") + " " + (e.stdout || "") + " " + e.message).toLowerCase();
			if (e.code === "ENOENT" || e.code === 127 || detail.includes("not recognized") || detail.includes("introuvable") || detail.includes("command not found")) {
				throw new Error(t("ai.err.claudeNotInstalled"));
			}
			if (e.killed || detail.includes("etimedout")) {
				throw new Error(t("ai.err.claudeTimeout", { minutes: CLI_TIMEOUT_MIN }));
			}
			if (detail.includes("login") || detail.includes("api key") || detail.includes("authentication") || detail.includes("credential")) {
				throw new Error(t("ai.err.claudeNotLoggedIn"));
			}
			throw new Error(t("ai.err.claudeCode", { detail: (e.stderr || e.message).trim().slice(0, 300) }));
		} finally {
			if (tmpDir) {
				try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
			}
		}

		/* `--output-format json` publie l'usage RÉEL de l'appel : tokens (dont
		   ceux servis par le cache) et coût en dollars — Claude Code est le seul
		   des quatre à chiffrer la requête. */
		interface ClaudeResult {
			is_error?: boolean;
			result?: string;
			session_id?: string;
			total_cost_usd?: number;
			usage?: {
				input_tokens?: number;
				output_tokens?: number;
				cache_read_input_tokens?: number;
				cache_creation_input_tokens?: number;
			};
		}
		let data: ClaudeResult;
		try {
			data = JSON.parse(stdout);
		} catch (e) {
			throw new Error(t("ai.err.claudeUnreadable"));
		}

		const u = data.usage;
		if (u) {
			// L'entrée facturée = tokens frais + écriture de cache + lecture de
			// cache : les trois traversent le modèle, les trois se paient.
			const cacheRead = u.cache_read_input_tokens || 0;
			pendingUsage = {
				provider: "claude-code",
				model,
				inputTokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + cacheRead,
				outputTokens: u.output_tokens || 0,
				cachedInputTokens: cacheRead,
				costUsd: typeof data.total_cost_usd === "number" ? data.total_cost_usd : null,
				sessionId: data.session_id
			};
		}

		if (data.is_error) {
			const msg = String(data.result || t("ai.err.unknown"));
			const msgLower = msg.toLowerCase();
			if (msgLower.includes("login") || msgLower.includes("api key") || msgLower.includes("credential")) {
				throw new Error(t("ai.err.claudeNotLoggedIn"));
			}
			if (msgLower.includes("rate limit") || msgLower.includes("usage limit")) {
				throw new Error(t("ai.err.claudeRateLimit"));
			}
			throw new Error(t("ai.err.claude", { detail: msg.slice(0, 300) }));
		}

		const content = data.result || "";
		if (!content.trim()) {
			throw new Error(t("ai.err.claudeEmpty"));
		}

		console.log("[quiz-blocks] Claude Code success - response length:", content.length);
		return parseQuizResponse(content);
	}

	/* ── ChatGPT via le CLI Codex (abonnement ChatGPT) ──
	   `codex exec` en non-interactif : prompt par stdin, modèle via -m,
	   effort de raisonnement via -c model_reasoning_effort=…, réponse finale
	   écrite dans un fichier (-o) pour un parsing propre. Sandbox read-only et
	   --ignore-user-config isolent la génération (pas de MCP/hooks perso). */
	async function callCodex(model: string, systemPrompt: string, userPrompt: string, images: ImagePayload[] = [], effort = "medium", fast = false): Promise<unknown[]> {
		if (!Platform.isDesktopApp) {
			// Même libellé que le hint du composer (« Codex CLI » explicite).
			throw new Error(t("ai.hint.codexDesktopOnly"));
		}
		if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
			throw new Error(t("ai.err.invalidModelCodex", { model }));
		}
		const effortVal = /^[a-z]+$/.test(effort) ? effort : "medium";

		const cp = require("child_process") as typeof import("child_process");
		const os = require("os") as typeof import("os");
		const path = require("path") as typeof import("path");
		const fs = require("fs") as typeof import("fs");

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-blocks-codex-"));
		const outFile = path.join(tmpDir, "last-message.txt");

		// Images : fichiers temporaires attachés au prompt initial via -i
		let imageArgs = "";
		if (images.length > 0) {
			const paths = images.map((img, i) => {
				const ext = ((img.mediaType || "image/png").split("/")[1] || "png").replace("jpeg", "jpg");
				const p = path.join(tmpDir, "image-" + (i + 1) + "." + ext);
				fs.writeFileSync(p, Buffer.from(img.base64, "base64"));
				return p;
			});
			imageArgs = paths.map(p => ' -i "' + p + '"').join("");
		}

		const fullPrompt = systemPrompt + "\n\n" + userPrompt;
		// `--json` : stdout devient un flux d'events JSONL, seul endroit où le CLI
		// publie les tokens consommés (`turn.completed.usage`) et l'identifiant de
		// thread qui mène à ses quotas. La réponse finale, elle, continue d'être
		// lue dans le fichier -o.
		const cmd = "codex exec --json -m " + model +
			" -c model_reasoning_effort=" + effortVal +
			// Fast (1.5x speed, more usage) : service tier « priority » — la
			// valeur vient de models_cache.json (service_tiers[].id).
			(fast ? " -c service_tier=priority" : "") +
			" -s read-only --skip-git-repo-check --ignore-user-config" +
			" -C \"" + os.homedir() + "\"" +
			" -o \"" + outFile + "\"" + imageArgs;

		let raw: string;
		try {
			const stdout = await new Promise<string>((resolve, reject) => {
				const child = cp.exec(cmd, {
					cwd: os.homedir(),
					env: buildChildEnv(),
					timeout: CLI_TIMEOUT_MS,
					maxBuffer: 16 * 1024 * 1024,
					windowsHide: true
				}, (err, out, stderr) => {
					if (err) {
						const e = err as ExecError;
						e.stderr = stderr;
						e.stdout = out;
						reject(e);
					} else {
						resolve(out);
					}
				});
				abortCurrent = () => { aborted = true; killTree(child); };
				child.stdin!.write(fullPrompt);
				child.stdin!.end();
			});
			readCodexEvents(stdout, model);
			// Le fichier -o contient la réponse finale nette ; à défaut, elle se
			// reconstitue depuis les events (stdout est du JSONL depuis --json,
			// et le donner brut au parseur JSON5 serait illisible).
			raw = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : extractCodexText(stdout);
		} catch (err) {
			/* Une ANNULATION n'est pas une erreur. `killTree` fait sortir le
			   processus en echec — souvent avec `killed`, que la branche
			   ci-dessous prendrait pour un depassement de delai — et le journal
			   se remplissait d'erreurs a chaque clic sur Stop. `generate()`
			   traduit ensuite ce rejet en erreur `aborted`, que l'UI traite
			   comme un retour a l'etat initial. */
			if (aborted) throw err;
			const e = err as ExecError;
			console.error("[quiz-blocks] Codex error:", e.message, e.stderr || "");
			const detail = ((e.stderr || "") + " " + (e.stdout || "") + " " + e.message).toLowerCase();
			if (e.code === "ENOENT" || e.code === 127 || detail.includes("not recognized") || detail.includes("introuvable") || detail.includes("command not found")) {
				throw new Error(t("ai.err.codexNotInstalled"));
			}
			if (e.killed || detail.includes("etimedout")) {
				throw new Error(t("ai.err.codexTimeout", { minutes: CLI_TIMEOUT_MIN }));
			}
			if (detail.includes("not logged in") || detail.includes("login") || detail.includes("unauthorized") || detail.includes("401") || detail.includes("credential") || detail.includes("authenticat")) {
				throw new Error(t("ai.err.codexNotLoggedIn"));
			}
			if (detail.includes("usage limit") || detail.includes("rate limit") || detail.includes("quota")) {
				throw new Error(t("ai.err.codexRateLimit"));
			}
			throw new Error(t("ai.err.codex", { detail: (e.stderr || e.message).trim().slice(0, 300) }));
		} finally {
			try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
		}

		if (!raw || !raw.trim()) {
			throw new Error(t("ai.err.codexEmpty"));
		}
		console.log("[quiz-blocks] Codex success - response length:", raw.length);
		return parseQuizResponse(raw);
	}

	/* Events `codex exec --json` : une ligne = un objet. Deux seulement nous
	   intéressent — `thread.started` (l'identifiant qui mène au fichier de
	   session, donc aux quotas du compte) et `turn.completed` (les tokens). */
	interface CodexTurnUsage {
		input_tokens?: number;
		cached_input_tokens?: number;
		output_tokens?: number;
		reasoning_output_tokens?: number;
	}

	function readCodexEvents(stdout: string, model: string): void {
		let threadId = "";
		let usage: CodexTurnUsage | null = null;

		for (const line of String(stdout || "").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("{")) continue;
			let evt: { type?: string; thread_id?: string; usage?: CodexTurnUsage };
			try { evt = JSON.parse(trimmed); } catch (e) { continue; }
			if (evt.type === "thread.started" && typeof evt.thread_id === "string") threadId = evt.thread_id;
			if (evt.type === "turn.completed" && evt.usage) usage = evt.usage;
		}
		if (!usage) return;

		pendingUsage = {
			provider: "codex",
			model,
			// `input_tokens` inclut déjà les tokens servis par le cache.
			inputTokens: usage.input_tokens || 0,
			// Le raisonnement est facturé en sortie : l'omettre sous-estimerait
			// d'autant un modèle à effort élevé.
			outputTokens: (usage.output_tokens || 0) + (usage.reasoning_output_tokens || 0),
			cachedInputTokens: usage.cached_input_tokens || 0,
			// Abonnement ChatGPT : aucun prix par requête n'est publié.
			costUsd: null,
			sessionId: threadId
		};
	}

	/** Réponse finale reconstituée depuis les events (secours si le fichier -o manque). */
	function extractCodexText(stdout: string): string {
		const parts: string[] = [];
		for (const line of String(stdout || "").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("{")) continue;
			try {
				const evt = JSON.parse(trimmed) as { type?: string; item?: { type?: string; text?: unknown } };
				if (evt.type !== "item.completed" || evt.item?.type !== "agent_message") continue;
				if (typeof evt.item.text === "string") parts.push(evt.item.text);
			} catch (e) { /* ligne non-JSON → ignorée */ }
		}
		return parts.join("\n");
	}

	async function callOllama(model: string, systemPrompt: string, userPrompt: string, ollamaUrl?: string, authHeaders?: Record<string, string>, images: ImagePayload[] = [], effort: string | null = null): Promise<unknown[]> {
		if (!ollamaUrl) {
			ollamaUrl = (plugin.settings.aiOllamaUrl || "http://localhost:11434").replace(/\/+$/, "");
		}
		authHeaders = authHeaders || {};

		// Annulation : un AbortController couvre les fetch de ce call.
		const ac = new AbortController();
		abortCurrent = () => { aborted = true; try { ac.abort(); } catch (e) { /* déjà avorté */ } };

		// ── Step 1 : serveur joignable ? Un modèle cloud (:cloud) tourne à la
		// demande via le daemon connecté (absent de /api/tags) → on ne vérifie
		// PAS qu'il est installé ; un modèle local, si. ──
		const isCloud = isOllamaCloudModel(model);
		let installedModels: string[] = [];
		let tagModels: Array<{ name: string; capabilities?: string[] }> = [];
		try {
			const tagsResp = await fetch(`${ollamaUrl}/api/tags`, { method: "GET", headers: authHeaders, signal: ac.signal });
			if (!tagsResp.ok) {
				throw new Error("ollama_unreachable");
			}
			const tagsData = await tagsResp.json() as { models?: Array<{ name: string; capabilities?: string[] }> };
			tagModels = tagsData?.models || [];
			installedModels = tagModels.map(m => m.name);
			console.log("[quiz-blocks] Ollama installed models:", installedModels.join(", "));

			if (!isCloud) {
				// Check if model is installed — Ollama model names may include :latest
				const modelBase = model.replace(/:latest$/, "");
				const isInstalled = installedModels.some(m => {
					const mBase = m.replace(/:latest$/, "");
					return mBase === modelBase || mBase.startsWith(modelBase + ":");
				});

				if (!isInstalled) {
					throw userError(t("ai.err.ollamaModelMissing", {
						model,
						models: installedModels.length > 0 ? installedModels.join(", ") : t("ai.err.none")
					}));
				}
			}
		} catch (err) {
			// Seule l'erreur « modèle absent » ci-dessus est déjà formulée pour
			// l'utilisateur ; tout le reste (sentinelle ollama_unreachable, JSON
			// illisible, réseau) devient le diagnostic serveur.
			const e = err as UserFacingError;
			if (e.userFacing) throw err;
			throw userError(t("ai.err.ollamaUnreachable", { url: ollamaUrl }));
		}

		// Le modèle expose-t-il un raisonnement (`think`) ? Cloud → oui (le param
		// est ignoré sans erreur si le modèle ne raisonne pas, vérifié) ; local →
		// capability « thinking » lue de /api/tags. Statut prix jamais figé ici.
		let supportsThinking: boolean;
		if (isCloud) {
			supportsThinking = true;
		} else {
			const norm = model.replace(/:latest$/, "");
			const found = tagModels.find(m => {
				const mb = m.name.replace(/:latest$/, "");
				return mb === norm || mb.startsWith(norm + ":");
			});
			supportsThinking = !!(found && (found.capabilities || []).includes("thinking"));
		}
		const thinkLevel = (supportsThinking && effort) ? effort : null;
		if (thinkLevel) console.log("[quiz-blocks] Ollama think level:", thinkLevel);

		// ── Step 2: Call /api/chat for better instruction following ──
		// Use fetch() to read error response bodies (requestUrl hides them)
		// Build user message with images for multimodal support
		const userMessage = {
			role: "user",
			content: userPrompt,
			...(images.length > 0 ? { images: images.map(img => img.base64) } : {})
		};

		let data: {
			error?: unknown;
			message?: { content?: string };
			/* Compteurs Ollama : tokens du prompt évalués et tokens générés.
			   Aucun coût — le modèle tourne en local (ou sur le forfait cloud,
			   qui ne chiffre pas la requête). */
			prompt_eval_count?: number;
			eval_count?: number;
		};
		try {
			const resp = await fetch(`${ollamaUrl}/api/chat`, {
				method: "POST",
				signal: ac.signal,
				headers: { "Content-Type": "application/json", ...authHeaders },
				body: JSON.stringify({
					model,
					messages: [
						{ role: "system", content: systemPrompt },
						userMessage
					],
					stream: false,
					...(thinkLevel ? { think: thinkLevel } : {}),
					format: {
						type: "object",
						properties: {
							questions: {
								type: "array",
								items: {
									type: "object",
									properties: {
										title: { type: "string" },
										prompt: { type: "string" },
										options: { type: "array", items: { type: "string" } },
										correctIndex: { type: "number" },
										correctIndices: { type: "array", items: { type: "number" } },
										multiSelect: { type: "boolean" },
										type: { type: "string" },
										answer: { type: "string" },
										lesson: { type: "string" },
										passage: { type: "string" },
										passageId: { type: "string" },
										passageTitle: { type: "string" }
									},
									required: ["title", "prompt"]
								}
							}
						},
						required: ["questions"]
					}
				})
			});

			data = await resp.json();

			if (!resp.ok) {
				const rawErr: unknown = data?.error;
				const errMsg: unknown = typeof rawErr === "string" ? rawErr : (rawErr || t("ai.err.httpStatus", { status: resp.status }));
				console.error("[quiz-blocks] Ollama error:", resp.status, errMsg);

				// Erreurs connues → message clair, déjà traduit (userError).
				const errLower = typeof errMsg === "string" ? errMsg.toLowerCase() : "";
				if (errLower.includes("more system memory") || errLower.includes("not enough memory") || errLower.includes("out of memory")) {
					const memMatch = typeof errMsg === "string" ? errMsg.match(/(\d+[\.,]?\d*)\s*GiB/g) : null;
					const detail = memMatch ? " (" + memMatch.join(" / ") + ")" : "";
					throw userError(t("ai.err.ollamaOutOfMemory", { detail }));
				}
				if (errLower.includes("not found") || errLower.includes("model not found")) {
					throw userError(t("ai.err.ollamaModelNotFound", { model }));
				}
				// Modèle cloud réservé à un abonnement (Ollama Pro/Max) : 403
				// « requires a subscription ». Distinct d'un défaut de connexion.
				if (errLower.includes("subscription") || errLower.includes("upgrade for access")) {
					throw userError(t("ai.err.ollamaSubscription"));
				}
				if (isCloud && (resp.status === 401 || resp.status === 403 || errLower.includes("sign in") || errLower.includes("signin") || errLower.includes("unauthorized") || errLower.includes("authenticat") || errLower.includes("api key"))) {
					throw userError(t("ai.err.ollamaSignin"));
				}
				throw userError(t("ai.err.ollamaHttp", { status: resp.status, detail: String(errMsg) }));
			}
		} catch (err) {
			// Les erreurs ci-dessus sont déjà formulées → re-jetées telles quelles.
			const e = err as UserFacingError;
			if (e.userFacing) throw err;
			throw userError(t("ai.err.ollamaUnreachableShort", { url: ollamaUrl }));
		}

		if (data.error) {
			const errMsg = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
			throw new Error(t("ai.err.ollama", { detail: errMsg }));
		}

		const content = data?.message?.content || "";
		if (!content.trim()) {
			throw new Error(t("ai.err.ollamaEmpty"));
		}

		if (typeof data.prompt_eval_count === "number" || typeof data.eval_count === "number") {
			pendingUsage = {
				provider: "ollama",
				model,
				inputTokens: data.prompt_eval_count || 0,
				outputTokens: data.eval_count || 0,
				cachedInputTokens: 0,
				costUsd: null
			};
		}

		console.log("[quiz-blocks] Ollama response length:", content.length);
		return parseOllamaResponse(content);
	}

	/* Les modèles écrivent le LaTeX avec des backslashes SIMPLES dans les
	   chaînes JSON5 ($\frac$, $\int$) — or JSON5 transforme \f en form
	   feed, \t en tab, AVALE le backslash des séquences inconnues
	   (\int → int) et JETTE une SyntaxError sur \x/\u non-hex ($\xi$,
	   \underline) : LaTeX détruit AVANT le parse, irréparable après
	   (baselines gemma4 + review multi-angles 2026-07-11). Réparation
	   SCOPÉE AUX SEGMENTS MATH de la chaîne brute : dans $...$ / $$...$$
	   TOUT backslash simple est du LaTeX (aucun échappement JSON n'y est
	   légitime) → doublé, paires déjà correctes préservées ; hors
	   segments, RIEN n'est touché (\n, \t, \" restent des échappements
	   voulus — un placeholder « col1\tcol2 » garde sa tabulation, et
	   \right/\neq/\xi ne peuvent plus être corrompus puisqu'ils vivent
	   dans les dollars). */
	function repairLatexBackslashes(source: string): string {
		// Segments : $$...$$ d'abord (sauts de ligne possibles), puis
		// $...$ inline (mêmes gardes anti-dollar-monétaire que le rendu :
		// collé au contenu des deux côtés, pas de \n).
		const mathFixed = source.replace(/\$\$[^$]+?\$\$|\$(?!\s)[^$\n]*?[^$\s]\$/g, (seg: string) =>
			// L'alternative (\\\\) consomme les paires correctes en
			// premier — sans elle le 2e backslash de « \\frac » (modèle
			// qui échappe bien) produirait « \\\frac » → form feed.
			seg.replace(/(\\\\)|\\([a-zA-Z,;! ])/g,
				(m: string, pair: string | undefined, ch: string | undefined) => pair ? pair : "\\\\" + ch));
		// Hors math : SEULS les \x/\u NON suivis d'hexa valide sont
		// doublés — un \xGG/\uGGGG invalide fait JETER JSON5.parse
		// (SyntaxError), donc ce doublement ne peut jamais casser un
		// échappement légitime. Sauve les chemins Windows des quiz cmd
		// (« cd C:\utils », « C:\x64 ») : sans ça, génération perdue.
		// (\t/\n dans « C:\temp\new » restent indécidables — le prompt
		// système exige désormais les backslashes doublés partout.)
		return mathFixed
			.replace(/(\\\\)|\\x(?![0-9a-fA-F]{2})/g, (m: string, pair: string | undefined) => pair ? pair : "\\\\x")
			.replace(/(\\\\)|\\u(?![0-9a-fA-F]{4})/g, (m: string, pair: string | undefined) => pair ? pair : "\\\\u");
	}

	function parseOllamaResponse(content: string): unknown[] {
		let cleaned = content.trim();

		// Try to extract JSON from markdown code blocks
		const jsonMatch = cleaned.match(/```(?:json5?|json)?\s*\n?([\s\S]*?)\n?```/);
		if (jsonMatch) {
			cleaned = jsonMatch[1].trim();
		}
		cleaned = repairLatexBackslashes(cleaned);

		// Ollama with format: structured JSON wraps the array in an object
		// e.g. { "questions": [...] }
		try {
			const JSON5 = require("json5") as typeof import("json5");
			const parsed: unknown = JSON5.parse(cleaned);

			// If it's an object with a "questions" key, extract the array
			if (parsed && !Array.isArray(parsed) && Array.isArray((parsed as { questions?: unknown }).questions)) {
				return (parsed as { questions: unknown[] }).questions;
			}

			if (Array.isArray(parsed)) {
				return parsed;
			}

			throw new Error("Format inattendu");
		} catch (err) {
			// Try the generic parser as fallback
			return parseQuizResponse(content);
		}
	}

	function parseQuizResponse(content: string): unknown[] {
		let cleaned = content.trim();

		const jsonMatch = cleaned.match(/```(?:json5?|json)?\s*\n?([\s\S]*?)\n?```/);
		if (jsonMatch) {
			cleaned = jsonMatch[1].trim();
		}
		cleaned = repairLatexBackslashes(cleaned);

		const JSON5 = require("json5") as typeof import("json5");
		let parsed: unknown;
		try {
			parsed = JSON5.parse(cleaned);
		} catch (err) {
			/* Un quiz MAL FORMÉ garde l'erreur du parseur : elle situe le défaut
			   (ligne, colonne), ce qu'aucune paraphrase ne ferait mieux. Une
			   réponse qui n'est pas un quiz du tout, elle, mérite qu'on dise ce
			   qu'elle est — sinon l'utilisateur reçoit « invalid character '\'
			   at 1:2 » pour une phrase en français (vécu le 2026-07-30). Le
			   discriminant est la présence de champs de question, pas le premier
			   caractère : de la prose peut commencer par « [ » (lien markdown,
			   ponctuation échappée). */
			const looksLikeQuiz = /["']?(prompt|title|options|correctIndex|answer)["']?\s*:/.test(cleaned);
			if (looksLikeQuiz) throw err;
			throw nonQuizResponseError(content);
		}

		if (!Array.isArray(parsed)) {
			throw new Error(t("ai.err.notAnArray"));
		}

		return parsed;
	}

	/* Le modèle a répondu autre chose qu'un quiz : nommer QUOI, et surtout
	   pourquoi, quand la cause est structurelle.
	   Cas vécu (2026-07-30) : une demande qui suppose l'accès aux fichiers
	   (« lis ce PDF », « d'après cette note ») — le CLI est lancé SANS aucun
	   outil, le modèle tente quand même un appel, et sa tentative ressort
	   sérialisée en texte. Rien n'est réparable côté parseur : ce qu'il faut
	   dire, c'est que le générateur ne voit que le composer, et que les sources
	   se JOIGNENT (le plugin sait lire notes, .md, .txt et PDF). */
	function nonQuizResponseError(content: string): Error {
		const text = content.trim();
		/* SEULE la tentative d'outil sérialisée dans la RÉPONSE prouve le mur
		   de l'accès fichiers. La seconde signature d'origine — « la DEMANDE
		   cite des chemins » — a été retirée le 2026-07-31 : depuis que
		   prompt-paths.ts joint automatiquement les chemins cités, un chemin
		   dans la demande n'implique plus rien, et cette heuristique
		   REBAPTISAIT en « pas d'accès aux fichiers » tout échec de parsing
		   (sources pourtant jointes, chips à l'écran), en masquant la seule
		   chose utile au diagnostic : ce que le modèle a réellement répondu.
		   Faute de preuve, on montre donc la réponse. */
		if (/application\/vnd\.ant\.toolu|\btool_use\b/i.test(text)) {
			return new Error(t("ai.err.noFileAccess"));
		}
		console.warn("[quiz-blocks] réponse non-quiz (" + text.length + " car.) :", text.slice(0, 2000));
		return new Error(t("ai.err.notQuiz", { preview: text.replace(/\s+/g, " ").slice(0, 160) }));
	}

	return {
		generate,
		abort: () => { if (abortCurrent) abortCurrent(); },
		get lastUsage() { return lastUsage; }
	};
}
