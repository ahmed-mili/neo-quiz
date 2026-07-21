import type { EditorCtx } from "../types/editor-ctx";
import { t } from "../i18n";
import { renderQuizPreviewCard, resolveImagesInHtml } from "./question-preview";

/** Handlers d'aperçu (rendu fidèle au quiz) et de génération du code JSON5. */
export interface PreviewHandlers {
	schedulePreview(): void;
	renderPreview(): void;
	_resolveImagesInHtml(html: string): string;
	renderCode(): void;
}

export function createPreviewHandlers(ctx: EditorCtx): PreviewHandlers {
	const { exportAllWithFence } = ctx;
	const view = ctx.view;

	function schedulePreview(): void {
		if (view._previewDebounce) clearTimeout(view._previewDebounce);
			view._previewDebounce = window.setTimeout(() => { if (view.previewBodyEl && view.previewBodyEl.isConnected) renderPreview(); }, 150);
	}

	function renderPreview(): void {
		const body = view.previewBodyEl;
		body.empty();

		const q = ctx.questions[ctx.activeIdx];
		if (!q) return;

		// « Question N » : titre de repli non localisé (motif du titre auto
		// écrit dans le .md, cf. editor/ui.ts).
		const fallbackTitle = `Question ${ctx.activeIdx + 1}`;
		view.previewTitleEl.textContent = t("editor.preview.titleWith", { title: q.title || fallbackTitle });

		// Rendu partagé avec la page d'un quiz du dashboard : un seul endroit
		// à mettre à jour quand le moteur change de markup.
		renderQuizPreviewCard(body, q, {
			app: view.app,
			fallbackTitle,
			onHint: (hint) => view._openHint(hint),
		});
	}

	/** Conservé sur l'API de la vue (appelants historiques) — délègue au module partagé. */
	function _resolveImagesInHtml(html: string): string {
		return resolveImagesInHtml(view.app, html);
	}

	function renderCode(): void {
		view.codeOutputEl.textContent = exportAllWithFence(ctx.questions, ctx.examOptions);
	}

	return {
		schedulePreview,
		renderPreview,
		_resolveImagesInHtml,
		renderCode
	};
}
