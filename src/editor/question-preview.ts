import type { App } from "obsidian";
import { t } from "../i18n";
import { md2html, _setIcon } from "./utils";
import type { DraftQuestion } from "./utils";
import { mathifyElement } from "../engine/mathjax";
import { markSlots, fillSlots } from "../engine/cloze";
import { sanitizeQuizHtml } from "../engine/sanitizer";

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
	/**
	 * Chemin de la NOTE qui porte le quiz, pour résoudre ses `![[…]]` comme le
	 * moteur le fait (`ctx.sourcePath`). Sans lui, `getFirstLinkpathDest` juge
	 * sans contexte : deux pièces jointes homonymes dans des dossiers
	 * différents donnent la mauvaise, et un lien relatif (`../images/x.png`)
	 * ne se résout pas du tout — l'aperçu montrait alors une AUTRE image que
	 * le quiz, ou aucune (revue codex 2026-07-31). Absent pour un quiz encore
	 * en mémoire, qui n'a pas de note.
	 */
	sourcePath?: string;
}

/**
 * Résout les images `![[...]]` du vault dans un HTML déjà rendu, puis passe le
 * tout par la liste blanche du moteur.
 *
 * `<template>` et non `<div>` : son document propriétaire est INERTE, donc un
 * `<img src=x onerror=…>` glissé dans le `passageHtml` d'un quiz partagé n'y
 * charge rien et n'exécute rien. Un `<div>` détaché, lui, déclenche quand
 * même le gestionnaire (standard HTML) — l'aperçu de l'éditeur exécutait donc
 * le HTML d'un quiz avant même que l'auteur ne l'ait relu.
 *
 * L'assainissement vient APRÈS la résolution, pas avant : à ce stade les `src`
 * sont des `app://…` que la liste blanche accepte, alors qu'un nom de fichier
 * nu (`schema.png`, ce que `md2html` écrit) en serait retiré — et l'aperçu
 * n'aurait plus d'images du tout.
 */
export function resolveImagesInHtml(app: App, html: string, sourcePath = ""): string {
	if (!html) return html;
	const tpl = document.createElement("template");
	tpl.innerHTML = html;
	tpl.content.querySelectorAll<HTMLImageElement>("img.qb-md-img").forEach(img => {
		const spec = img.getAttribute("src");
		if (!spec) return;
		// `![[fichier|300|légende]]` : seule la première part est un chemin.
		const lien = spec.split("|")[0].trim();
		if (!lien) return;

		/* `getFirstLinkpathDest` D'ABORD, comme le moteur (engine/sanitizer.ts
		   resolveObsidianEmbedFile) : c'est la résolution d'Obsidian lui-même,
		   qui retrouve une pièce jointe où qu'elle soit dans le vault. Le
		   calcul par `attachmentFolderPath` ci-dessous ne marche que si la
		   pièce jointe est EXACTEMENT dans le dossier configuré — d'où des
		   aperçus sans image alors que le quiz, lui, les affichait. */
		const dest = app.metadataCache?.getFirstLinkpathDest?.(lien, sourcePath);
		if (dest) {
			img.setAttribute("src", app.vault.getResourcePath(dest));
			return;
		}

		const attachFolder = (app.vault as unknown as VaultWithGetConfig).getConfig("attachmentFolderPath") || "";
		const folderPath = attachFolder.replace("${file}", "").replace(/\/$/, "") || ".";
		const filePath = folderPath === "." ? lien : `${folderPath}/${lien}`;
		if (app.vault.getAbstractFileByPath(filePath)) {
			img.setAttribute("src", app.vault.adapter.getResourcePath(filePath));
		}
	});
	return sanitizeQuizHtml(tpl.innerHTML);
}

/** Écrit un libellé COURT en rendant son markdown inline (gras, code…) —
    le moteur le fait désormais partout, l'aperçu ne doit pas afficher les
    accents graves d'une adresse IP là où le quiz montre du code. Le `<p>`
    que md2html ajoute autour d'un texte d'une ligne est retiré : ces
    libellés vivent dans une cellule, pas dans un paragraphe. */
function inlineInto(el: HTMLElement, app: App, raw: string, sourcePath?: string): void {
	el.innerHTML = resolveImagesInHtml(app, md2html(raw).replace(/^<p>|<\/p>$/g, ""), sourcePath);
}

/** Le SUPPORT de compréhension, au-dessus de la question — mêmes classes que
    le moteur (engine/passage.ts). Sans lui, une question de compréhension
    s'affichait dans l'aperçu sans le texte sur lequel elle porte : l'auteur ne
    pouvait pas la relire. Toujours déplié ici (l'aperçu n'a pas d'état) et
    sans le compte « questions 2 à 4 », qui demanderait de connaître tout le
    quiz alors que la carte ne voit qu'une question. */
function renderPassage(card: HTMLElement, q: DraftQuestion, app: App, sourcePath?: string): void {
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
	// `inlineInto` et non `text:` — le titre d'un document cite volontiers une
	// commande entre accents graves, et le moteur, lui, la rend.
	inlineInto(head.createSpan({ cls: "quiz-passage-title" }), app, title, sourcePath);
	const body = wrap.createDiv({ cls: "quiz-passage-body" });
	const content = body.createDiv({ cls: "quiz-passage-content" });
	content.innerHTML = resolveImagesInHtml(app, html || md2html(text), sourcePath);
}

/** Construit la carte de question dans `host` et la renvoie. */
export function renderQuizPreviewCard(host: HTMLElement, q: DraftQuestion, opts: QuizPreviewOptions): HTMLElement {
	const { app, fallbackTitle } = opts;
	const type = q._type;
	const wrap = host.createDiv({ cls: "quiz-blocks-host" });
	const card = wrap.createEl("section", { cls: "quiz-card" });

	renderPassage(card, q, app, opts.sourcePath);

	// Le TITRE aussi rend son markdown : le moteur le fait (engine/cards.ts),
	// et un titre de question technique cite volontiers une commande entre
	// accents graves — ils s'affichaient bruts dans l'aperçu.
	inlineInto(card.createEl("h2"), app, q.title || fallbackTitle, opts.sourcePath);

	if (q.resourceButton) {
		const rbtn = card.createEl("button", { cls: "quiz-resource-btn" });
		const icon = rbtn.createSpan({ cls: "quiz-resource-btn-icon" });
		_setIcon(icon, "paperclip");
		// Même raison : le moteur rend ce libellé (sanitizer.ts resourceButtonHtml).
		inlineInto(rbtn.createSpan({ cls: "quiz-resource-btn-label" }), app,
			q.resourceButton.label || t("editor.preview.resourceFallback"), opts.sourcePath);
	}

	if (q._promptHtml || q.prompt) {
		const promptEl = card.createDiv({ cls: "quiz-question" });
		const raw = q._promptHtml
			? q._promptHtml.replace(/!\[\[([^\]]+)\]\]/g, '<img src="$1" class="qb-md-img" />')
			: md2html(q.prompt);
		promptEl.innerHTML = resolveImagesInHtml(app, raw, opts.sourcePath);
	}

	if (type === "single" || type === "multi") {
		const isMulti = type === "multi";
		if (isMulti) card.createDiv({ cls: "quiz-multi-indicator", text: t("editor.preview.multiHint") });
		// .quiz-options-wrap : le conteneur du moteur (colonne flex) — sans lui
		// les options perdent leur rythme vertical.
		const list = card.createDiv({ cls: "quiz-options-wrap" });
		(q.options || []).forEach((o) => {
			const opt = list.createDiv({ cls: `quiz-option ${isMulti ? "multi" : ""}`.trim(), attr: { role: "button", tabindex: "0" } });
			opt.innerHTML = resolveImagesInHtml(app, md2html(o || "..."), opts.sourcePath);
		});
	}

	if (type === "ordering") {
		card.createDiv({ cls: "quiz-multi-indicator", text: t("editor.preview.orderingHint") });
		const orderingWrap = card.createDiv({ cls: "quiz-ordering" });
		const slotsWrap = orderingWrap.createDiv({ cls: "quiz-ordering-slots" });
		(q.slots || []).forEach((slotLabel) => {
			const slot = slotsWrap.createDiv({ cls: "quiz-slot" });
			inlineInto(slot.createDiv({ cls: "quiz-slot-label" }), app, slotLabel, opts.sourcePath);
			slot.createDiv({ cls: "quiz-slot-value", text: "…" });
		});
		// Pool dans l'ordre STOCKÉ (celui montré à l'élève), pas l'ordre correct.
		const pool = orderingWrap.createDiv({ cls: "quiz-ordering-pool" });
		(q.possibilities || []).forEach(p => inlineInto(pool.createSpan({ cls: "quiz-pool-item" }), app, p, opts.sourcePath));
	}

	if (type === "matching") {
		card.createDiv({ cls: "quiz-multi-indicator", text: t("editor.preview.matchingHint") });
		const matchWrap = card.createDiv({ cls: "quiz-ordering" });
		const slotsWrap = matchWrap.createDiv({ cls: "quiz-ordering-slots" });
		(q.rows || []).forEach((row, ri) => {
			const slot = slotsWrap.createDiv({ cls: "quiz-slot" });
			inlineInto(slot.createDiv({ cls: "quiz-slot-label" }), app, row || t("editor.matching.rowFallback", { n: ri }), opts.sourcePath);
			slot.createDiv({ cls: "quiz-slot-value", text: "…" });
		});
		const pool = matchWrap.createDiv({ cls: "quiz-ordering-pool" });
		(q.choices || []).forEach(c => inlineInto(pool.createSpan({ cls: "quiz-pool-item" }), app, c, opts.sourcePath));
	}

	if (type === "cloze") {
		/* Le gabarit, avec ses trous VIDES : mêmes classes que le moteur
		   (engine/cloze.ts clozeCardHtml), donc mêmes cases tiretées. Sans
		   cette branche, un texte à trous n'affichait que son énoncé.

		   Le gabarit ENTIER passe par md2html, trous marqués — comme dans le
		   moteur : rendre chaque segment séparément couperait les paires
		   markdown qui enjambent un trou (`` `git {{checkout}} -b` ``). */
		const { marked, blanks } = markSlots(q.cloze);
		card.createDiv({ cls: "quiz-multi-indicator", text: t("engine.cloze.instructions", { count: blanks.length }) });
		const body = card.createDiv({ cls: "quiz-cloze" });
		body.innerHTML = fillSlots(
			resolveImagesInHtml(app, md2html(marked).replace(/^<p>|<\/p>$/g, ""), opts.sourcePath),
			(index) => `<span class="quiz-cloze-slot"><input class="quiz-cloze-input" type="text" readonly `
				+ `aria-label="${t("engine.cloze.blankAria", { n: index + 1 }).replace(/"/g, "&quot;")}"></span>`,
		);
	}

	if (type === "numeric") {
		/* Un champ nu, comme le moteur — et RIEN d'autre. L'unité n'est pas un
		   décor : c'est un suffixe ACCEPTÉ à la correction (engine/numeric.ts),
		   au même titre que la marge de tolérance et les réponses. L'afficher
		   ici montrerait à l'auteur un élément que l'apprenant ne voit pas, et
		   soufflerait la forme attendue de la réponse. */
		const wrap = card.createDiv({ cls: "qcm-options quiz-text-wrap" });
		const ta = wrap.createEl("textarea", {
			cls: "quiz-textarea",
			attr: { readonly: true, "aria-readonly": "true", rows: "1", placeholder: q.placeholder || "" },
		});
		ta.value = "";
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
