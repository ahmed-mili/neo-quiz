import { QbdModal } from "../modal-base";
import type { App } from "obsidian";
import { Q_TYPES, _setIcon } from "./utils";
import type { QuestionTypeKey } from "./utils";
import { t } from "../i18n";
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
	/** Gabarit du texte à trous (engine/cloze.ts). */
	cloze?: string;
	/** Réponse numérique et ses marges (engine/numeric.ts). */
	numeric?: boolean;
	tolerance?: number;
	tolerancePercent?: number;
	unit?: string;
	acceptedAnswers?: string[];
	acceptableAnswers?: string[];
	correctText?: unknown;
	answer?: unknown;
	caseSensitive?: boolean;
	placeholder?: string;
	commandPrefix?: string;
}

/**
 * Convert HTML to plain text using the DOM, preserving inner text of
 * structural elements like <pre>, <code>, <br> instead of stripping them.
 * This avoids data loss that a regex (/<[^>]+>/g) would cause.
 */
function _htmlToText(html: string): string {
	/* `<template>` et non `<div>` : son document propriétaire est INERTE. Un
	   `<img src=x onerror=…>` venu du HTML d'un quiz partagé se chargeait dans
	   un `<div>` détaché — et déclenchait son gestionnaire — alors qu'on ne
	   voulait qu'en extraire du texte. */
	const temp = document.createElement("template");
	temp.innerHTML = html;
	const racine = temp.content;
	// Convert <br> to newlines before extracting text
	racine.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
	// Convert block-level boundaries to newlines for readability
	racine.querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6").forEach(el => {
		el.insertAdjacentText("beforeend", "\n");
	});
	return racine.textContent || "";
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

export { _htmlToText };
