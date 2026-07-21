import type { App } from "obsidian";
import { t } from "../i18n";
import { md2html, _setIcon } from "./utils";
import type { DraftQuestion } from "./utils";
import { mathifyElement } from "../engine/mathjax";

/* ══════════════════════════════════════════════════════════
   QUESTION PREVIEW — la question telle que l'apprenant la verra

   Reproduit le DOM du moteur (engine/cards.ts questionCardHtml) :
   `section.quiz-card > h2 + .quiz-question + .quiz-options-wrap`, avec
   les MÊMES classes — donc le même CSS, la même pastille d'option, la
   même typo. C'est la seule façon d'être fidèle au quiz : réécrire un
   rendu « qui ressemble » diverge dès la première retouche du moteur.

   ÉTAT INITIAL uniquement, jamais l'état corrigé : aucune option verte,
   aucun slot pré-rempli, aucune explication, aucune réponse de terminal.
   Les acceptedAnswers / correctOrder / correctMap SONT la solution.

   Partagé par l'aperçu de l'éditeur (editor/preview.ts) et par la page
   d'un quiz du dashboard (dashboard/detail-question.ts).
══════════════════════════════════════════════════════════ */

/** API interne non publique d'Obsidian : lecture d'un réglage du vault (attachmentFolderPath). */
type VaultWithGetConfig = { getConfig(key: string): string | null };

/** Sous-ensemble typé du module moteur engine/math-input.ts. */
interface MathInputModule {
	isMathQuestion(q: unknown): boolean;
	createMathField(host: HTMLElement, opts?: { readOnly?: boolean; template?: unknown }): unknown;
}

export interface QuizPreviewOptions {
	app: App;
	/** Titre de repli quand la question n'en porte pas (« Question 3 »). */
	fallbackTitle: string;
	/** Bouton indice : rendu seulement si un handler est fourni. */
	onHint?: (hint: string) => void;
}

/** Résout les images `![[...]]` du vault dans un HTML déjà rendu. */
export function resolveImagesInHtml(app: App, html: string): string {
	if (!html) return html;
	const temp = document.createElement("div");
	temp.innerHTML = html;
	temp.querySelectorAll<HTMLImageElement>("img.qb-md-img").forEach(img => {
		const fileName = img.getAttribute("src");
		if (!fileName) return;
		const attachFolder = (app.vault as unknown as VaultWithGetConfig).getConfig("attachmentFolderPath") || "";
		const folderPath = attachFolder.replace("${file}", "").replace(/\/$/, "") || ".";
		const filePath = folderPath === "." ? fileName : `${folderPath}/${fileName}`;
		if (app.vault.getAbstractFileByPath(filePath)) {
			img.src = app.vault.adapter.getResourcePath(filePath);
		}
	});
	return temp.innerHTML;
}

/** Construit la carte de question dans `host` et la renvoie. */
export function renderQuizPreviewCard(host: HTMLElement, q: DraftQuestion, opts: QuizPreviewOptions): HTMLElement {
	const { app, fallbackTitle } = opts;
	const type = q._type;
	const wrap = host.createDiv({ cls: "quiz-blocks-host" });
	const card = wrap.createEl("section", { cls: "quiz-card" });

	card.createEl("h2", { text: q.title || fallbackTitle });

	if (q.resourceButton) {
		const rbtn = card.createEl("button", { cls: "quiz-resource-btn" });
		const icon = rbtn.createSpan({ cls: "quiz-resource-btn-icon" });
		_setIcon(icon, "paperclip");
		rbtn.createSpan({ cls: "quiz-resource-btn-label", text: q.resourceButton.label || t("editor.preview.resourceFallback") });
	}

	if (q._promptHtml || q.prompt) {
		const promptEl = card.createDiv({ cls: "quiz-question" });
		const raw = q._promptHtml
			? q._promptHtml.replace(/!\[\[([^\]]+)\]\]/g, '<img src="$1" class="qb-md-img" />')
			: md2html(q.prompt);
		promptEl.innerHTML = resolveImagesInHtml(app, raw);
	}

	if (type === "single" || type === "multi") {
		const isMulti = type === "multi";
		if (isMulti) card.createDiv({ cls: "quiz-multi-indicator", text: t("editor.preview.multiHint") });
		// .quiz-options-wrap : le conteneur du moteur (colonne flex) — sans lui
		// les options perdent leur rythme vertical.
		const list = card.createDiv({ cls: "quiz-options-wrap" });
		(q.options || []).forEach((o) => {
			const opt = list.createDiv({ cls: `quiz-option ${isMulti ? "multi" : ""}`.trim(), attr: { role: "button", tabindex: "0" } });
			opt.innerHTML = resolveImagesInHtml(app, md2html(o || "..."));
		});
	}

	if (type === "ordering") {
		card.createDiv({ cls: "quiz-multi-indicator", text: t("editor.preview.orderingHint") });
		const orderingWrap = card.createDiv({ cls: "quiz-ordering" });
		const slotsWrap = orderingWrap.createDiv({ cls: "quiz-ordering-slots" });
		(q.slots || []).forEach((slotLabel) => {
			const slot = slotsWrap.createDiv({ cls: "quiz-slot" });
			slot.createDiv({ cls: "quiz-slot-label", text: slotLabel });
			slot.createDiv({ cls: "quiz-slot-value", text: "…" });
		});
		// Pool dans l'ordre STOCKÉ (celui montré à l'élève), pas l'ordre correct.
		const pool = orderingWrap.createDiv({ cls: "quiz-ordering-pool" });
		(q.possibilities || []).forEach(p => pool.createSpan({ cls: "quiz-pool-item", text: p }));
	}

	if (type === "matching") {
		card.createDiv({ cls: "quiz-multi-indicator", text: t("editor.preview.matchingHint") });
		const matchWrap = card.createDiv({ cls: "quiz-ordering" });
		const slotsWrap = matchWrap.createDiv({ cls: "quiz-ordering-slots" });
		(q.rows || []).forEach((row, ri) => {
			const slot = slotsWrap.createDiv({ cls: "quiz-slot" });
			slot.createDiv({ cls: "quiz-slot-label", text: row || t("editor.matching.rowFallback", { n: ri }) });
			slot.createDiv({ cls: "quiz-slot-value", text: "…" });
		});
		const pool = matchWrap.createDiv({ cls: "quiz-ordering-pool" });
		(q.choices || []).forEach(c => pool.createSpan({ cls: "quiz-pool-item", text: c }));
	}

	if (type === "text") {
		const mathInput = require("../engine/math-input") as MathInputModule;
		if (mathInput.isMathQuestion(q)) {
			// Question math : le même éditeur d'équations que le quiz, en
			// lecture seule, gabarit affiché s'il existe.
			const mathWrap = card.createDiv({ cls: "qcm-options quiz-text-wrap quiz-math-wrap" });
			mathInput.createMathField(mathWrap, {
				readOnly: true,
				template: (q._extraFields && q._extraFields.answerTemplate) || q.answerTemplate || "",
			});
		} else {
			const textWrap = card.createDiv({ cls: "qcm-options quiz-text-wrap" });
			const ta = textWrap.createEl("textarea", {
				cls: "quiz-textarea",
				attr: { readonly: true, "aria-readonly": "true", placeholder: q.placeholder || t("editor.text.defaultPlaceholder") },
			});
			ta.value = "";
		}
	}

	if (type === "cmd" || type === "powershell" || type === "bash") {
		const shellWrap = card.createDiv({ cls: "qcm-options quiz-text-wrap quiz-text-wrap-command" });
		const shell = shellWrap.createDiv({ cls: "quiz-command-shell quiz-terminal-variant-" + type });
		if (type === "bash") {
			const prefixSpan = shell.createSpan({ cls: "quiz-command-prefix quiz-command-prefix-bash" });
			prefixSpan.innerHTML = '<span class="quiz-bash-prefix-userhost">user@hostname</span><span class="quiz-bash-prefix-colon">:</span><span class="quiz-bash-prefix-path">~</span><span class="quiz-bash-prefix-dollar">$ </span>';
		} else {
			shell.createSpan({ cls: "quiz-command-prefix", text: q.commandPrefix || (type === "cmd" ? "C:\\>" : "PS>") });
		}
		const inputWrap = shell.createDiv({ cls: "quiz-command-input-wrap" });
		inputWrap.createEl("textarea", {
			cls: "quiz-textarea quiz-textarea-command",
			attr: { readonly: true, rows: "1", wrap: "off" },
		});
	}

	if (opts.onHint && q.hint && q.hint.trim()) {
		const hint = q.hint;
		const hintBtn = card.createEl("button", { cls: "quiz-hint-btn", text: t("editor.hint.label"), type: "button" });
		hintBtn.addEventListener("click", () => opts.onHint?.(hint));
	}

	// Pas d'explication : elle contient la réponse (le quiz réel ne la montre
	// qu'après validation).

	// LaTeX $...$ / $$...$$ : même rendu MathJax natif que le moteur.
	void mathifyElement(card);
	return card;
}
