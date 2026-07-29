import { FuzzySuggestModal, Notice } from "obsidian";
import { QbdModal } from "../modal-base";
import type { App, TFile, FuzzyMatch, WorkspaceLeaf } from "obsidian";
import { Q_TYPES, _setIcon, makeDefault, defaultSlots } from "./utils";
import type { QuestionTypeKey, DraftQuestion } from "./utils";
import { parseQuizSource, QUIZ_BLOCK_RE } from "../quiz-utils";
import { t } from "../i18n";
import type { EditorHostView, EditorExamOptions } from "../types/editor-ctx";
import type { ResourceButton } from "../types/quiz";

/**
 * Question brute telle que lue du JSON5 (parseQuizSource) ou d'un marqueur
 * mode-examen. Forme volontairement permissive (index signature) : l'import
 * lit des champs hétérogènes et préserve les clés inconnues (_extraFields).
 */
export interface ParsedQuizItem {
	[key: string]: unknown;
	examMode?: boolean;
	/** Raccourci du mode learn, équivalent à `mode: "learn"` (quiz-utils.ts). */
	learnMode?: boolean;
	/** Mode du bloc : « quiz » | « learn » | « exam ». Marqueur de l'objet de configuration. */
	mode?: string;
	examDurationMinutes?: number;
	examAutoSubmit?: boolean;
	examShowTimer?: boolean;
	ordering?: unknown;
	matching?: unknown;
	multiSelect?: boolean;
	type?: string;
	terminalVariant?: string;
	textVariant?: string;
	id?: string;
	title?: string;
	hint?: string;
	prompt?: string;
	promptHtml?: string;
	explain?: string;
	explainHtml?: string;
	resourceButton?: ResourceButton;
	options?: string[];
	correctIndex?: number;
	correctIndices?: number[];
	slots?: string[];
	possibilities?: string[];
	correctOrder?: number[];
	rows?: string[];
	choices?: string[];
	correctMap?: number[];
	acceptedAnswers?: string[];
	acceptableAnswers?: string[];
	correctText?: unknown;
	answer?: unknown;
	caseSensitive?: boolean;
	placeholder?: string;
	commandPrefix?: string;
}

/** Accès aux champs non déclarés sur `View` selon la vue concrète (MarkdownView.file/data, éditeur quiz sourceFile/openQuizFile). */
type ViewLike = {
	file?: TFile | null;
	data?: string;
	sourceFile?: TFile | null;
	openQuizFile?: (file: TFile, source: string) => Promise<void>;
};

/**
 * Convert HTML to plain text using the DOM, preserving inner text of
 * structural elements like <pre>, <code>, <br> instead of stripping them.
 * This avoids data loss that a regex (/<[^>]+>/g) would cause.
 */
function _htmlToText(html: string): string {
	const temp = document.createElement("div");
	temp.innerHTML = html;
	// Convert <br> to newlines before extracting text
	temp.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
	// Convert block-level boundaries to newlines for readability
	temp.querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6").forEach(el => {
		el.insertAdjacentText("beforeend", "\n");
	});
	return temp.textContent || "";
}

/* ════════════════════════════════════════════════════════
   CONFIRM MODAL
   ════════════════════════════════════════════════════════ */
export class ConfirmModal extends QbdModal {
	modalTitle: string;
	message: string;
	confirmText: string;
	cancelText: string;
	callback: (confirmed: boolean) => void;
	confirmed: boolean;

	constructor(app: App, title: string, message: string, confirmText: string, cancelText: string, callback: (confirmed: boolean) => void) {
		super(app);
		this.modalTitle = title;
		this.message = message;
		this.confirmText = confirmText;
		this.cancelText = cancelText;
		this.callback = callback;
		this.confirmed = false;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("qb-confirm-modal");

		contentEl.createEl("h2", { text: this.modalTitle, cls: "qb-confirm-title" });
		contentEl.createEl("p", { text: this.message, cls: "qb-confirm-message" });

		const btnRow = contentEl.createDiv({ cls: "qb-confirm-buttons" });

		const cancelBtn = btnRow.createEl("button", {
			cls: "qb-btn",
			text: this.cancelText
		});
		cancelBtn.addEventListener("click", () => {
			this.confirmed = false;
			this.close();
		});

		const confirmBtn = btnRow.createEl("button", {
			cls: "qb-btn qb-btn-danger",
			text: this.confirmText
		});
		confirmBtn.addEventListener("click", () => {
			this.confirmed = true;
			this.close();
		});
	}

	onClose(): void {
		this.callback(this.confirmed);
		this.contentEl.empty();
	}
}

/* ════════════════════════════════════════════════════════
   TYPE PICKER MODAL
   ════════════════════════════════════════════════════════ */
export class TypePickerModal extends QbdModal {
	onPick: (key: QuestionTypeKey) => void;

	constructor(app: App, onPick: (key: QuestionTypeKey) => void) {
		super(app);
		this.onPick = onPick;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("qb-type-modal");
		contentEl.createEl("h2", { text: t("editor.typeModal.title") });
		contentEl.createEl("p", { text: t("editor.typeModal.subtitle"), cls: "qb-type-modal-sub" });

		const grid = contentEl.createDiv({ cls: "qb-type-grid" });
		// `qt` et non `t` : la variable de boucle masquerait la fonction t().
		// label/desc sont des getters (utils.ts) — lus ici, donc au rendu.
		for (const qt of Q_TYPES) {
			const card = grid.createDiv({ cls: "qb-type-card" });
			const cardIcon = card.createDiv({ cls: "qb-type-card-icon" }); _setIcon(cardIcon, qt.lucide);
			const text = card.createDiv();
			text.createDiv({ cls: "qb-type-card-name", text: qt.label });
			text.createDiv({ cls: "qb-type-card-desc", text: qt.desc });
			card.addEventListener("click", () => { this.onPick(qt.key); this.close(); });
		}
	}

	onClose(): void { this.contentEl.empty(); }
}

/* ════════════════════════════════════════════════════════
   IMPORT QUIZ MODAL
   ════════════════════════════════════════════════════════ */
export class ImportQuizModal extends QbdModal {
	builderView: EditorHostView;

	constructor(app: App, builderView: EditorHostView) {
		super(app);
		this.builderView = builderView;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("qb-import-modal");
		contentEl.createEl("h2", { text: t("editor.import.title") });

		const textarea = contentEl.createEl("textarea", {
			cls: "qb-import-textarea",
			placeholder: t("editor.import.placeholder")
		});

		const loadBtn = contentEl.createEl("button", { cls: "qb-import-btn", text: t("editor.import.load") });
		loadBtn.addEventListener("click", async () => {
			const text = textarea.value.trim();
			if (!text) return;

			await this.loadQuiz(text);
		});

		const fromNoteBtn = contentEl.createEl("button", { cls: "qb-import-from-note", text: t("editor.import.fromNote") });
		fromNoteBtn.addEventListener("click", () => {
			this.close();
			new ImportFromNoteModal(this.app, this.builderView).open();
		});
	}

	async loadQuiz(text: string): Promise<void> {
		try {
			let jsonText = text;
			const fenceMatch = text.match(QUIZ_BLOCK_RE);
			if (fenceMatch) {
				jsonText = fenceMatch[1];
			}

			const parsed = parseQuizSource(jsonText) as ParsedQuizItem[];
			if (!Array.isArray(parsed) || parsed.length === 0) {
				new Notice(t("editor.notice.noQuestionInContent"));
				return;
			}

			const questions: DraftQuestion[] = [];
			let examOptions: EditorExamOptions | null = null;

			for (const q of parsed) {
				if (q.examMode) {
					examOptions = {
						enabled: true,
						durationMinutes: q.examDurationMinutes || 10,
						autoSubmit: q.examAutoSubmit ?? false,
						showTimer: q.examShowTimer ?? true
					};
					continue;
				}

				const question = this.convertToInternalFormat(q);
				if (question) questions.push(question);
			}

			if (questions.length === 0) {
				new Notice(t("editor.notice.noValidQuestion"));
				return;
			}

			// Mettre à jour le tableau en place pour que ctx.questions reste synchronisé
			this.builderView.questions.length = 0;
			questions.forEach(q => this.builderView.questions.push(q));
			this.builderView.activeIdx = 0;
			if (this.builderView._ctx) this.builderView._ctx.activeIdx = 0;  // Sync ctx
			if (examOptions) {
				Object.assign(this.builderView.examOptions, examOptions);
				// Mettre à jour l'UI de l'examen si la fonction existe
				if (this.builderView.updateExamUIState) this.builderView.updateExamUIState();
			}

			this.builderView.render();
			new Notice(t("editor.notice.imported", { n: questions.length }));
			this.close();
		} catch (err) {
			console.error("Import error:", err);
			new Notice(t("editor.notice.importError", { error: (err as Error).message }));
		}
	}

	convertToInternalFormat(q: ParsedQuizItem): DraftQuestion {
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
			// Union answer/correctText comme le moteur (terminal.js) —
			// même logique que editor.js (copie à factoriser un jour).
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

	onClose(): void { this.contentEl.empty(); }
}

/* ════════════════════════════════════════════════════════
   QUIZ FILE SUGGEST MODAL
   ════════════════════════════════════════════════════════ */
export class QuizFileSuggestModal extends FuzzySuggestModal<TFile> {
	onChooseCallback: (file: TFile) => void;
	openFiles: Set<string>;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this.onChooseCallback = onChoose;
		this.setPlaceholder(t("editor.suggest.chooseNote"));
		this.openFiles = new Set();
	}

	getItems(): TFile[] {
		const result: TFile[] = [];
		const seenPaths = new Set<string>();

		this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
			const file = (leaf.view as ViewLike).file;
			if (leaf.view && file) {
				result.push(file);
				seenPaths.add(file.path);
				this.openFiles.add(file.path);
			}
		});

		this.app.vault.getMarkdownFiles().forEach(file => {
			if (!seenPaths.has(file.path)) {
				result.push(file);
				seenPaths.add(file.path);
			}
		});

		return result;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	renderSuggestion(fuzzyMatch: FuzzyMatch<TFile>, el: HTMLElement): void {
		const file = fuzzyMatch.item;
		el.createDiv({ cls: "qb-suggest-item" }, div => {
			const isOpen = this.openFiles.has(file.path);

			div.createDiv({ cls: "qb-suggest-main" }, main => {
				main.createEl("span", { cls: "qb-suggest-name", text: file.basename });
				if (isOpen) {
					main.createEl("span", { cls: "qb-suggest-badge", text: t("editor.suggest.openBadge") });
				}
			});

			div.createEl("span", { cls: "qb-suggest-path", text: file.path });
		});
	}

	async onChooseItem(file: TFile): Promise<void> {
		this.onChooseCallback(file);
	}
}

/* ════════════════════════════════════════════════════════
   IMPORT FROM NOTE MODAL
   ════════════════════════════════════════════════════════ */
export class ImportFromNoteModal extends QbdModal {
	builderView: EditorHostView;

	constructor(app: App, builderView: EditorHostView) {
		super(app);
		this.builderView = builderView;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		// Ne pas fermer immédiatement - ouvre une autre modal directement
		// this.close();  // SUPPRIMÉ: causait des problèmes de race condition

		new QuizFileSuggestModal(this.app, async (file) => {
			try {
				const content = await this.app.vault.read(file);
				const match = content.match(QUIZ_BLOCK_RE);
				if (!match) {
					new Notice(t("editor.notice.noBlockInNote"));
					return;
				}

				await this.builderView.importQuizSource(match[1], file.name);
				new Notice(t("editor.notice.importedFromNote", { file: file.name }));
			} catch (err) {
				console.error("Import from note error:", err);
				new Notice(t("editor.notice.readNoteError"));
			}
		}).open();
	}

	onClose(): void { this.contentEl.empty(); }
}

/* ════════════════════════════════════════════════════════
   OPEN QUIZ FROM NOTE MODAL
   ════════════════════════════════════════════════════════ */
export class OpenQuizFromNoteModal extends FuzzySuggestModal<TFile> {
	builderView: EditorHostView;
	openFiles: Set<string>;
	resultItems: TFile[];
	quizFiles: Set<string>;
	activeQuizFile: string | null;
	loading: boolean;

	constructor(app: App, builderView: EditorHostView) {
		super(app);
		this.builderView = builderView;
		this.openFiles = new Set();
		this.resultItems = [];
		this.quizFiles = new Set(); // Tracks which files have quiz-blocks
		this.activeQuizFile = null; // File currently loaded in Quiz Editor
		this.loading = true;
	}

	onOpen(): void {
		super.onOpen();

		// Verrouiller l'input pendant le chargement :
		// - readOnly bloque toute frappe (PC + Android)
		// - inputmode="none" empêche le clavier virtuel mobile
		// - blur() retire le caret et ferme le clavier s'il a eu le temps de s'ouvrir
		if (this.inputEl) {
			this.inputEl.readOnly = true;
			this.inputEl.setAttribute("inputmode", "none");
			this.inputEl.blur();
		}

		// Placeholder pour indiquer l'état de chargement
		this.setPlaceholder(t("editor.open.loadingPlaceholder"));

		// Injecter le spinner directement dans le conteneur de résultats
		// (remplace l'empty-state natif "Aucun résultat trouvé")
		if (this.resultContainerEl) {
			this.resultContainerEl.empty();
			const loader = this.resultContainerEl.createDiv({ cls: "qb-modal-loading" });
			loader.createDiv({ cls: "qb-spinner" });
			loader.createSpan({
				cls: "qb-modal-loading-text",
				text: t("editor.open.searching")
			});
		}

		// Charger les fichiers avec quiz en arrière-plan
		this.loadQuizFiles();
	}

	onClose(): void {
		// Nettoyage défensif : si la modale est fermée pendant le chargement,
		// restaurer l'état normal de l'input
		if (this.inputEl) {
			this.inputEl.readOnly = false;
			this.inputEl.removeAttribute("inputmode");
		}
		super.onClose?.();
	}

	updateSuggestions(): void {
		// No-op tant que le scan est en cours : on ne veut pas qu'un rafraîchissement
		// interne d'Obsidian efface notre spinner
		if (this.loading) return;
		// @ts-expect-error API interne Obsidian non typée (SuggestModal.updateSuggestions)
		return super.updateSuggestions?.();
	}

	async loadQuizFiles(): Promise<void> {
		const result: TFile[] = [];
		const seenPaths = new Set<string>();

		// Vérifier quel fichier est actuellement chargé dans le Quiz Editor
		const quizEditorLeaves = this.app.workspace.getLeavesOfType("quiz-blocks-builder");
		if (quizEditorLeaves.length > 0) {
			const quizEditorView = quizEditorLeaves[0].view as ViewLike;
			if (quizEditorView && quizEditorView.sourceFile) {
				this.activeQuizFile = quizEditorView.sourceFile.path;
			}
		}

		// D'abord les fichiers ouverts (priorité 1)
		this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
			const view = leaf.view as ViewLike;
			if (leaf.view && view.file) {
				this.openFiles.add(view.file.path);
				// Vérifier si le fichier contient un quiz
				const content = view.data || "";
				if (content.includes("```quiz-blocks")) {
					this.quizFiles.add(view.file.path);
					result.push(view.file);
					seenPaths.add(view.file.path);
				}
			}
		});

		// Ensuite scanner les autres fichiers markdown pour trouver ceux avec quiz
		const allMarkdownFiles = this.app.vault.getMarkdownFiles();
		for (const file of allMarkdownFiles) {
			if (seenPaths.has(file.path)) continue;

			try {
				const content = await this.app.vault.read(file);
				if (content.includes("```quiz-blocks")) {
					this.quizFiles.add(file.path);
					result.push(file);
					seenPaths.add(file.path);
				}
			} catch (e) {
				// Ignorer les erreurs de lecture
			}
		}

		// Trier : fichier actif en premier, puis par date de modification
		result.sort((a, b) => {
			const aIsActive = this.activeQuizFile === a.path;
			const bIsActive = this.activeQuizFile === b.path;

			if (aIsActive && !bIsActive) return -1;
			if (!aIsActive && bIsActive) return 1;
			return (b.stat?.mtime || 0) - (a.stat?.mtime || 0);
		});

		this.resultItems = result;
		this.loading = false;

		// Déverrouiller l'input et rendre le focus (l'utilisateur peut maintenant taper)
		if (this.inputEl) {
			this.inputEl.readOnly = false;
			this.inputEl.removeAttribute("inputmode");
			this.inputEl.focus();
		}

		// Restaurer le placeholder par défaut
		this.setPlaceholder(t("editor.open.searchPlaceholder"));

		// Forcer le rafraîchissement de la modale (passe maintenant au super
		// puisque this.loading === false)
		this.updateSuggestions();
	}

	getItems(): TFile[] {
		return this.loading ? [] : this.resultItems;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	renderSuggestion(fuzzyMatch: FuzzyMatch<TFile>, el: HTMLElement): void {
		const file = fuzzyMatch.item;
		const filePath = file?.path || "";
		const fileName = file?.basename || "";
		const isActive = this.activeQuizFile === filePath;

		el.createDiv({ cls: "qb-suggest-item" }, div => {
			div.createDiv({ cls: "qb-suggest-main" }, main => {
				main.createEl("span", { cls: "qb-suggest-name", text: fileName });
				if (isActive) {
					main.createEl("span", { cls: "qb-suggest-badge qb-active-badge", text: t("editor.suggest.activeBadge") });
				}
			});
			div.createEl("span", { cls: "qb-suggest-path", text: filePath });
		});
	}

	async onChooseItem(file: TFile): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			const match = content.match(QUIZ_BLOCK_RE);
			if (!match) {
				new Notice(t("editor.notice.noBlockInNote"));
				return;
			}

			// Ouvrir ou révéler le Quiz Editor
			const existing = this.app.workspace.getLeavesOfType("quiz-blocks-builder");
			let leaf: WorkspaceLeaf;
			if (existing.length > 0) {
				leaf = existing[0];
				this.app.workspace.revealLeaf(leaf);
			} else {
				leaf = this.app.workspace.getLeaf("tab");
				await leaf.setViewState({ type: "quiz-blocks-builder", active: true });
				this.app.workspace.revealLeaf(leaf);
			}

			// Ouvrir le quiz pour édition
			const view = leaf.view as ViewLike;
			if (view && view.openQuizFile) {
				await view.openQuizFile(file, match[1]);
				new Notice(t("editor.notice.quizOpened", { file: file.name }));
			}
		} catch (err) {
			console.error("Open quiz error:", err);
			new Notice(t("editor.notice.openError"));
		}
	}
}

export { _htmlToText };
