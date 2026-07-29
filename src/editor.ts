import { ItemView, Notice } from "obsidian";
import type { App, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { parseQuizSource } from "./quiz-utils";
import { t } from "./i18n";
import { Q_TYPES, loadReact, _setIcon, _iconSpan, makeDefault, md2html, escHtml, esc5 } from "./editor/utils";
import type { DraftQuestion } from "./editor/utils";
import { exportQuestion, exportAll, exportAllWithFence } from "./editor/export";
import { ConfirmModal, TypePickerModal, ImportQuizModal, QuizFileSuggestModal, ImportFromNoteModal } from "./editor/modals";
import { convertParsedToInternal } from "./editor/convert";
import type { ParsedQuizItem } from "./editor/modals";

// C1 (plan) : les 6 factories des sous-modules editor/* sont désormais des
// EXPORTS NOMMÉS (Task 6a). L'ancien `const createX = require("./editor/x")`
// consommait le module ENTIER en supposant que le `module.exports` était la
// fonction — après conversion ESM ce require renvoyait le namespace, cassant
// l'appel au runtime. Les imports nommés ci-dessous rétablissent la parité.
import { createEditorUIHandlers } from "./editor/ui";
import { createResizeHandlers } from "./editor/resize";
import { createSidebarHandlers } from "./editor/sidebar";
import { createEditorFormHandlers } from "./editor/editor-form";
import { createPreviewHandlers } from "./editor/preview";
import { createHintHandlers } from "./editor/hint";

import type { EditorCtx, EditorHostView, EditorExamOptions } from "./types/editor-ctx";

export const VIEW_TYPE = "quiz-blocks-builder";

/* ════════════════════════════════════════════════════════
   CŒUR DE L'ÉDITEUR — attachQuizEditorCore(view, host, app, plugin)
   Assemble l'état, le ctx et les handlers de l'éditeur sur `view`,
   avec le DOM monté dans `host`. Utilisé par la vue onglet
   (QuizBuilderView) ET par l'éditeur EMBARQUÉ dans la page Générer
   du dashboard (`view` y est un simple objet, sans leaf).
   ════════════════════════════════════════════════════════ */
export function attachQuizEditorCore(view: EditorHostView, host: HTMLElement, app: App, plugin: Plugin): EditorHostView {
	view.app = view.app || app;
	view.plugin = plugin;
	// Les handlers (ui.ts…) lisent view.contentEl : pour la vue onglet c'est
	// le contentEl de l'ItemView, pour l'embed c'est le host fourni.
	view.contentEl = view.contentEl || host;
	view.questions = [Object.assign(makeDefault("single"), { title: "Question 1" })];
	view.activeIdx = 0;
	view.panels = { sidebar: true, editor: true, preview: true, code: false };
	view._previewDebounce = 0;
	view.examOptions = {
		enabled: false,
		durationMinutes: 10,
		autoSubmit: true,
		showTimer: true
	};
	view.activeEditorTab = 'content';
	view.sourceFile = null; // Fichier source ouvert en mode édition directe
	view._saveDebounce = 0; // Timer pour sauvegarde automatique

	view._savedWidths = {
		sidebar: 320,
		editor: 480,
		preview: 304,
		code: 288
	};
	view._minPanelWidth = 50;
	view._hideThreshold = 10;

	// Créer le contexte partagé (ctx) pour injection de dépendances.
	// Cast unique documenté : à ce point les 6 slots de sous-modules (ui,
	// resize, sidebar, editorForm, preview, hint) ne sont pas encore greffés
	// (ils le seront via Object.assign ci-dessous, une fois les handlers
	// construits) — `as EditorCtx` scelle la forme finale attendue.
	const ctx = {
		view,
		app: view.app,
		plugin: plugin,
		container: host,

		questions: view.questions,
		activeIdx: view.activeIdx,
		panels: view.panels,
		examOptions: view.examOptions,
		activeEditorTab: view.activeEditorTab,
		_savedWidths: view._savedWidths,
		_minPanelWidth: view._minPanelWidth,
		_hideThreshold: view._hideThreshold,
		_previewDebounce: view._previewDebounce,

		get activeQuestion(): DraftQuestion { return ctx.questions[ctx.activeIdx]; },
		set activeQuestion(v: DraftQuestion) { ctx.questions[ctx.activeIdx] = v; },

		Q_TYPES,
		loadReact,
		_setIcon,
		_iconSpan,
		makeDefault,
		md2html,
		escHtml,
		esc5,
		exportQuestion,
		exportAll,
		exportAllWithFence,
		parseQuizSource,
		ConfirmModal,
		TypePickerModal,
		ImportQuizModal,
		QuizFileSuggestModal,
		ImportFromNoteModal,
		VIEW_TYPE
	} as EditorCtx;

	// Initialiser les handlers
	const ui = createEditorUIHandlers(ctx);
	const resize = createResizeHandlers(ctx);
	const sidebar = createSidebarHandlers(ctx);
	const editorForm = createEditorFormHandlers(ctx);
	const preview = createPreviewHandlers(ctx);
	const hint = createHintHandlers(ctx);

	// Attacher les modules au ctx
	Object.assign(ctx, {
		ui,
		resize,
		sidebar,
		editorForm,
		preview,
		hint
	});

	// Exposer les méthodes sur l'instance
	view.buildUI = ui.buildUI.bind(ui);
	view.syncPanels = ui.syncPanels.bind(ui);
	view.render = ui.render.bind(ui);
	view.showTypeModal = ui.showTypeModal.bind(ui);

	view._setupResizer = resize._setupResizer.bind(resize);
	view._closeLeftPanel = resize._closeLeftPanel.bind(resize);
	view._closeRightPanel = resize._closeRightPanel.bind(resize);
	view._resizePanels = resize._resizePanels.bind(resize);

	view.renderSidebar = sidebar.renderSidebar.bind(sidebar);
	view.moveQuestion = sidebar.moveQuestion.bind(sidebar);
	view.deleteQuestion = sidebar.deleteQuestion.bind(sidebar);

	view.renderEditor = editorForm.renderEditor.bind(editorForm);
	view._field = editorForm._field.bind(editorForm);
	view._resourceSection = editorForm._resourceSection.bind(editorForm);
	view._renderTypeFields = editorForm._renderTypeFields.bind(editorForm);
	view._arrayEditor = editorForm._arrayEditor.bind(editorForm);

	view.schedulePreview = preview.schedulePreview.bind(preview);
	view.renderPreview = preview.renderPreview.bind(preview);
	view._resolveImagesInHtml = preview._resolveImagesInHtml.bind(preview);
	view.renderCode = preview.renderCode.bind(preview);

	view._ensureHintOverlay = hint._ensureHintOverlay.bind(hint);
	view._applyHintTheme = hint._applyHintTheme.bind(hint);
	view._openHint = hint._openHint.bind(hint);
	view._closeHint = hint._closeHint.bind(hint);
	view._addHintEscHandler = hint._addHintEscHandler.bind(hint);
	view._removeHintEscHandler = hint._removeHintEscHandler.bind(hint);

	// Sauvegarder ctx sur l'instance
	view._ctx = ctx;

	// ── Méthodes partagées (vue onglet + éditeur embarqué) ──

	view.importQuizSource = async function (source: string, fileName: string | null = null, opts: { silent?: boolean } = {}): Promise<void> {
		try {
			const parsed = parseQuizSource(source) as ParsedQuizItem[];
			if (!Array.isArray(parsed) || parsed.length === 0) {
				new Notice(t("editor.notice.noQuestionFound"));
				return;
			}

			const questions: DraftQuestion[] = [];
			let examOptions: EditorExamOptions | null = null;

			/* Objet de CONFIGURATION du bloc, pas une question — même critère que
			   le moteur (quiz-utils.ts extractExamOptions) : aucun énoncé, et un
			   des marqueurs de mode. L'éditeur ne reconnaissait que
			   `examMode: true` et convertissait un `{ mode: "learn" }` en
			   question vide (« Question N », deux options vides). La génération
			   IA produit précisément cette forme-là. */
			const isModeConfig = (q: ParsedQuizItem): boolean =>
				!!q && typeof q === "object" && !q.prompt
				&& (q.examMode === true || q.learnMode === true || typeof q.mode === "string");

			for (const q of parsed) {
				if (isModeConfig(q)) {
					const mode: "quiz" | "learn" | "exam" =
						typeof q.mode === "string" && (q.mode === "learn" || q.mode === "exam" || q.mode === "quiz")
							? q.mode
							: q.examMode === true ? "exam"
							: q.learnMode === true ? "learn"
							: "quiz";
					examOptions = {
						mode,
						// Le chrono n'est « activé » que pour un vrai mode examen ;
						// un mode learn peut en porter un (« Passer l'examen »),
						// auquel cas il annonce une durée.
						enabled: mode === "exam" || (mode === "learn" && q.examDurationMinutes != null),
						durationMinutes: q.examDurationMinutes || 10,
						autoSubmit: q.examAutoSubmit ?? false,
						showTimer: q.examShowTimer ?? true
					};
					continue;
				}

				const question = view.convertParsedToInternal(q);
				if (question) questions.push(question);
			}

			if (questions.length === 0) {
				new Notice(t("editor.notice.noValidQuestion"));
				return;
			}

			// Stocker le nom du fichier importé
			view.importedFileName = fileName;

			// Mettre à jour le tableau en place pour que ctx.questions reste synchronisé
			view.questions.length = 0;
			questions.forEach(q => view.questions.push(q));
			view.activeIdx = 0;
			if (view._ctx) view._ctx.activeIdx = 0;  // Sync ctx.activeIdx
			if (examOptions) {
				Object.assign(view.examOptions, examOptions);
				// Mettre à jour l'UI de l'examen si la fonction existe
				if (view.updateExamUIState) view.updateExamUIState();
			}

			// Mettre à jour le nom du fichier affiché dans l'UI
			if (view._fileNameEl) {
				view._fileNameEl.textContent = fileName || "quiz-blocks";
				view._fileNameEl.classList.toggle("has-file", !!fileName);
			}

			// Rafraîchir le titre de l'onglet
			if (view.leaf && view.sourceFile) {
				// Mettre à jour getDisplayText pour retourner le nom du fichier
				view.getDisplayText = () => view.sourceFile!.basename;

				// Forcer le rafraîchissement via updateHeader (méthode interne
				// non typée dans l'API publique d'Obsidian).
				const leafWithHeader = view.leaf as WorkspaceLeaf & { updateHeader?(): void };
				if (leafWithHeader.updateHeader) {
					leafWithHeader.updateHeader();
				}

				// Déclencher un événement pour forcer le rafraîchissement
				view.app.workspace.trigger('layout-change');
			}

			view.render();
			if (!opts.silent) {
				new Notice(fileName
					? t("editor.notice.importedFrom", { n: questions.length, file: fileName })
					: t("editor.notice.imported", { n: questions.length }));
			}
		} catch (err) {
			console.error("Import error:", err);
			new Notice(t("editor.notice.importError", { error: (err as Error).message }));
		}
	};

	view.openQuizFile = async function (file: TFile, source: string): Promise<void> {
		// Stocker le fichier source pour sauvegarde automatique
		view.sourceFile = file;
		await view.importQuizSource(source, file.name);
	};

	view.saveToSourceFile = async function (): Promise<void> {
		if (!view.sourceFile) return;

		try {
			// Lire le contenu actuel du fichier
			const content = await view.app.vault.read(view.sourceFile);

			// Générer le nouveau contenu du quiz (SANS les fences)
			const newQuizJson = exportAll(view.questions, view.examOptions);

			// Valider que le JSON5 généré est correct avant de sauvegarder
			try {
				parseQuizSource(newQuizJson);
			} catch (parseErr) {
				console.error("[Quiz Blocks] JSON5 invalide généré:", parseErr);
				new Notice(t("editor.notice.invalidGenerated"));
				return;
			}

			// Reconstruire le bloc complet avec les fences
			const newQuizBlock = "```quiz-blocks\n" + newQuizJson + "\n```";

			// Remplacer le bloc quiz-blocks dans le fichier
			const quizBlockRegex = /```quiz-blocks[\s\S]*?```/;
			if (!quizBlockRegex.test(content)) {
				console.error("[Quiz Blocks] Aucun bloc quiz-blocks trouvé dans le fichier");
				new Notice(t("editor.notice.blockNotFound"));
				return;
			}

			// Remplacement par FONCTION : dans une chaîne de remplacement, `$1`,
			// `$&`, `` $` `` et `$'` sont des motifs spéciaux — un énoncé de
			// maths (« $1$ ») réinjectait sinon la source à la place du bloc.
			const updatedContent = content.replace(quizBlockRegex, () => newQuizBlock);

			// Sauvegarder si le contenu a changé
			if (updatedContent !== content) {
				await view.app.vault.modify(view.sourceFile, updatedContent);
				view.updateSaveIndicator?.(true);
			}
		} catch (err) {
			console.error("[Quiz Blocks] Save error:", err);
			new Notice(t("editor.notice.saveError", { error: (err as Error).message }));
		}
	};

	view.scheduleSave = function (): void {
		if (!view.sourceFile) return;
		if (view._saveDebounce) clearTimeout(view._saveDebounce);
		view._saveDebounce = window.setTimeout(() => view.saveToSourceFile?.(), 1000);
		// Mettre à jour l'indicateur de sauvegarde
		view.updateSaveIndicator?.(false);
	};

	// Corps déplacé dans editor/convert.ts : la page « quiz » du dashboard lit
	// le même format et doit passer par la MÊME conversion (une seconde lecture
	// maison finirait par écrire des .md incompatibles).
	view.convertParsedToInternal = convertParsedToInternal;

	return view;
}

/* ════════════════════════════════════════════════════════
   QUIZ BUILDER VIEW
   ════════════════════════════════════════════════════════ */
export class QuizBuilderView extends ItemView {
	// Membres greffés par attachQuizEditorCore et lus dans les méthodes de la
	// classe (déclarations de type pures : `declare` n'émet aucun code, la
	// valeur réelle est assignée au runtime par attachQuizEditorCore).
	declare sourceFile: EditorHostView["sourceFile"];
	declare buildUI: EditorHostView["buildUI"];
	declare render: EditorHostView["render"];
	declare _closeHint: EditorHostView["_closeHint"];
	declare _removeHintEscHandler: EditorHostView["_removeHintEscHandler"];

	constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
		super(leaf);
		// Tout l'assemblage (état, ctx, handlers, méthodes) est partagé avec
		// l'éditeur embarqué du dashboard via attachQuizEditorCore. `this` est
		// une ItemView vierge que attachQuizEditorCore MUTE en EditorHostView :
		// le cast reflète cette transformation runtime.
		attachQuizEditorCore(this as unknown as EditorHostView, this.contentEl, this.app, plugin);
	}

	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string {
		// getViewType() reste l'identifiant technique (jamais traduit) ;
		// getDisplayText() est le titre d'onglet, donc de l'UI. Appelé par
		// Obsidian à chaque rafraîchissement d'en-tête → langue courante.
		if (this.sourceFile) {
			return this.sourceFile.basename || t("editor.view.title");
		}
		return t("editor.view.title");
	}
	getIcon(): string { return "graduation-cap"; }

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("qb-root");
		this.buildUI();
		this.render();
	}

	async onClose(): Promise<void> {
		this._closeHint();
		this._removeHintEscHandler();
		const overlay = document.getElementById("qb-hint-overlay");
		if (overlay) overlay.remove();
		// Cleanup any resize overlays that might be stuck
		const resizeOverlays = document.querySelectorAll('div[style*="cursor:ew-resize"]');
		resizeOverlays.forEach(el => el.remove());
		this.contentEl.empty();
	}
}

export { QuizFileSuggestModal };
