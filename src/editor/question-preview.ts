import type { App } from "obsidian";
import { t } from "../i18n";
import { md2html, _setIcon } from "./utils";
import type { DraftQuestion } from "./utils";
import { mathifyElement } from "../engine/mathjax";
import { parseCloze } from "../engine/cloze";

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

/** Écrit un libellé COURT en rendant son markdown inline (gras, code…) —
    le moteur le fait désormais partout, l'aperçu ne doit pas afficher les
    accents graves d'une adresse IP là où le quiz montre du code. Le `<p>`
    que md2html ajoute autour d'un texte d'une ligne est retiré : ces
    libellés vivent dans une cellule, pas dans un paragraphe. */
function inlineInto(el: HTMLElement, app: App, raw: string): void {
	el.innerHTML = resolveImagesInHtml(app, md2html(raw).replace(/^<p>|<\/p>$/g, ""));
}

/** Le SUPPORT de compréhension, au-dessus de la question — mêmes classes que
    le moteur (engine/passage.ts). Sans lui, une question de compréhension
    s'affichait dans l'aperçu sans le texte sur lequel elle porte : l'auteur ne
    pouvait pas la relire. Toujours déplié ici (l'aperçu n'a pas d'état) et
    sans le compte « questions 2 à 4 », qui demanderait de connaître tout le
    quiz alors que la carte ne voit qu'une question. */
function renderPassage(card: HTMLElement, q: DraftQuestion, app: App): void {
	const extras = q._extraFields || {};
	const text = typeof extras.passage === "string" ? extras.passage : "";
	const html = typeof extras.passageHtml === "string" ? extras.passageHtml : "";
	if (!text && !html) return;

	const title = typeof extras.passageTitle === "string" && extras.passageTitle.trim()
		? extras.passageTitle
		: t("editor.passage.section");

	const wrap = card.createDiv({ cls: "quiz-passage" });
	const head = wrap.createDiv({ cls: "quiz-passage-head" });
	const icon = head.createSpan({ cls: "quiz-passage-icon" });
	icon.setAttribute("aria-hidden", "true");
	_setIcon(icon, "book-open-text");
	head.createSpan({ cls: "quiz-passage-title", text: title });
	const body = wrap.createDiv({ cls: "quiz-passage-body" });
	const content = body.createDiv({ cls: "quiz-passage-content" });
	content.innerHTML = resolveImagesInHtml(app, html || md2html(text));
}

/** Construit la carte de question dans `host` et la renvoie. */
export function renderQuizPreviewCard(host: HTMLElement, q: DraftQuestion, opts: QuizPreviewOptions): HTMLElement {
	const { app, fallbackTitle } = opts;
	const type = q._type;
	const wrap = host.createDiv({ cls: "quiz-blocks-host" });
	const card = wrap.createEl("section", { cls: "quiz-card" });

	renderPassage(card, q, app);

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
			inlineInto(slot.createDiv({ cls: "quiz-slot-label" }), app, slotLabel);
			slot.createDiv({ cls: "quiz-slot-value", text: "…" });
		});
		// Pool dans l'ordre STOCKÉ (celui montré à l'élève), pas l'ordre correct.
		const pool = orderingWrap.createDiv({ cls: "quiz-ordering-pool" });
		(q.possibilities || []).forEach(p => inlineInto(pool.createSpan({ cls: "quiz-pool-item" }), app, p));
	}

	if (type === "matching") {
		card.createDiv({ cls: "quiz-multi-indicator", text: t("editor.preview.matchingHint") });
		const matchWrap = card.createDiv({ cls: "quiz-ordering" });
		const slotsWrap = matchWrap.createDiv({ cls: "quiz-ordering-slots" });
		(q.rows || []).forEach((row, ri) => {
			const slot = slotsWrap.createDiv({ cls: "quiz-slot" });
			inlineInto(slot.createDiv({ cls: "quiz-slot-label" }), app, row || t("editor.matching.rowFallback", { n: ri }));
			slot.createDiv({ cls: "quiz-slot-value", text: "…" });
		});
		const pool = matchWrap.createDiv({ cls: "quiz-ordering-pool" });
		(q.choices || []).forEach(c => inlineInto(pool.createSpan({ cls: "quiz-pool-item" }), app, c));
	}

	if (type === "cloze") {
		// Le gabarit, avec ses trous VIDES : mêmes classes que le moteur
		// (engine/cloze.ts clozeCardHtml), donc mêmes cases tiretées. Sans
		// cette branche, un texte à trous n'affichait que son énoncé — la
		// question elle-même restait invisible dans l'aperçu.
		const { segments, blanks } = parseCloze(q.cloze);
		card.createDiv({ cls: "quiz-multi-indicator", text: t("engine.cloze.instructions", { count: blanks.length }) });
		const body = card.createDiv({ cls: "quiz-cloze" });
		for (const seg of segments) {
			if (seg.type === "text") {
				const span = body.createSpan();
				span.innerHTML = resolveImagesInHtml(app, md2html(seg.value).replace(/^<p>|<\/p>$/g, ""));
				continue;
			}
			const slot = body.createSpan({ cls: "quiz-cloze-slot" });
			const input = slot.createEl("input", {
				cls: "quiz-cloze-input",
				type: "text",
				attr: { readonly: true, "aria-label": t("engine.cloze.blankAria", { n: seg.index + 1 }) },
			});
			input.value = "";
		}
	}

	if (type === "numeric") {
		// Champ nu + unité, comme le moteur : la marge de tolérance et les
		// réponses acceptées SONT la solution — elles n'ont rien à faire ici.
		const wrap = card.createDiv({ cls: "qcm-options quiz-text-wrap" });
		const ta = wrap.createEl("textarea", {
			cls: "quiz-textarea",
			attr: { readonly: true, "aria-readonly": "true", rows: "1", placeholder: q.placeholder || "" },
		});
		ta.value = "";
		if (q.unit && q.unit.trim()) wrap.createSpan({ cls: "quiz-numeric-unit", text: q.unit });
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
