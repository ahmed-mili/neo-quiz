/**
 * Ce qui reste du god-object de l'ÉDITEUR.
 *
 * L'éditeur en trois colonnes (Questions / Éditeur / Aperçu / Code) a été
 * retiré le 2026-07-31 : sa page de travail est désormais celle du dashboard
 * (dashboard/detail.ts), y compris dans l'onglet `quiz-blocks-builder`. Ce
 * fichier décrivait le `ctx` que `attachQuizEditorCore` assemblait — 17 slots,
 * ~35 méthodes aplaties, quatre panneaux redimensionnables. Tout cela est
 * parti avec lui.
 *
 * Il ne subsiste que ce dont le FORMULAIRE de questions (editor/editor-form.ts)
 * a besoin : ce formulaire, lui, a survécu — c'est le contrat qu'un pont
 * (dashboard/detail-form-bridge.ts) satisfait pour le rendre utilisable depuis
 * la page. Le garder aussi étroit qu'il l'est vraiment est ce qui a permis
 * cette réutilisation ; l'élargir « au cas où » ramènerait l'éditeur par la
 * fenêtre.
 */

import type { App, Plugin } from "obsidian";
import type { ExamOptions } from "./quiz";
import type * as EditorUtils from "../editor/utils";
import type { DraftQuestion } from "../editor/utils";

/**
 * Options d'examen côté ÉDITION. Sur-ensemble de `ExamOptions` (types/quiz.ts),
 * qui modélise les options ACTIVES telles que lues par le moteur une fois
 * l'examen construit (quiz-utils.ts extractExamOptions) : ce dernier n'a pas de
 * champ `enabled` car sa seule présence (non-null) vaut activation. Le
 * FORMULAIRE, lui, existe même quand l'examen est désactivé, et garde donc un
 * interrupteur explicite en plus des trois champs de `ExamOptions`.
 */
export interface EditorExamOptions extends ExamOptions {
	enabled: boolean;
	/**
	 * Mode du quiz, tel qu'il était écrit dans le bloc lu. Mémorisé pour être
	 * réémis à l'identique (editor/export.ts) : sans lui, un quiz importé en
	 * mode learn ressortait en mode examen, ou perdait son mode.
	 */
	mode?: "quiz" | "learn" | "exam";
	/**
	 * Clés de l'objet de mode que le plugin ne connaît pas, gardées telles
	 * quelles pour être réémises. Sans elles, un bloc écrit à la main perdait
	 * ses annotations personnelles à la première sauvegarde — même traitement
	 * que `_extraFields` sur une question.
	 */
	_extra?: Record<string, unknown>;
}

/**
 * L'hôte que le formulaire appelle quand une donnée change. Quatre crochets,
 * pas un de plus — c'est exactement ce que `createFormBridge` fournit :
 * - `renderCode` / `schedulePreview` : vestiges des panneaux disparus, appelés
 *   par le formulaire à chaque frappe. Le pont les rend inertes plutôt que de
 *   retoucher tous les points d'appel du formulaire.
 * - `scheduleSave` : persiste (débounce côté hôte).
 * - `render` : un ajout/retrait a changé la structure, repeindre le panneau.
 */
export interface EditorHostView {
	app: App;
	plugin: Plugin;
	/** Conteneur du formulaire — inutilisé par le pont, qui ne rend que les
	    champs d'un TYPE et jamais le formulaire entier. */
	editorInnerEl: HTMLElement;
	renderCode(): void;
	schedulePreview(): void;
	scheduleSave?(): void;
	render(): void;
}

/**
 * Le contexte que `createEditorFormHandlers(ctx)` consomme. Sept champs, tous
 * vérifiables d'un `grep "ctx\."` sur editor/editor-form.ts.
 */
export interface EditorCtx {
	view: EditorHostView;
	app: App;
	plugin: Plugin;
	/** Questions du quiz édité, et l'index de celle qu'on modifie. */
	questions: DraftQuestion[];
	activeIdx: number;

	Q_TYPES: typeof EditorUtils.Q_TYPES;
	_setIcon: typeof EditorUtils._setIcon;
	_iconSpan: typeof EditorUtils._iconSpan;
	md2html: typeof EditorUtils.md2html;
}
