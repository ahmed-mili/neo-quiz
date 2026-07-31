import { setIcon } from "obsidian";
import { t } from "../i18n";
import { createSelect } from "./ui-select";
import type { EditorExamOptions } from "../types/editor-ctx";

/* ══════════════════════════════════════════════════════════
   MODE DU QUIZ — bloc réglages de la page « quiz »

   Le mode (quiz / apprentissage / examen) et le chrono vivaient dans la
   barre latérale de l'éditeur, et le mode LUI-MÊME n'y était même pas
   réglable : il fallait ouvrir le panneau « Code » et écrire
   `mode: 'learn'` à la main. Retirer l'éditeur sans ce sélecteur aurait
   donc retiré une capacité — c'est le seul point où la page ne se contente
   pas de reprendre l'existant.

   Visible en mode ÉDITION seulement : en consultation, le mode se lit dans
   le quiz lui-même.
══════════════════════════════════════════════════════════ */

export interface ExamPanelOptions {
	/** Options du bloc — `null` quand la note n'en porte aucune. */
	get(): EditorExamOptions | null;
	/** Remplace les options (null = plus d'objet de mode dans le bloc). */
	set(value: EditorExamOptions | null): void;
	/** Persiste (débounce côté appelant). */
	onChange(): void;
	/** Re-rend le bloc : le jeu de champs dépend du mode choisi. */
	onStructureChange(): void;
}

type QuizMode = "quiz" | "learn" | "exam";

/** Options par défaut d'un bloc qui n'en avait pas encore. */
function defaults(mode: QuizMode): EditorExamOptions {
	return {
		mode,
		enabled: mode === "exam",
		durationMinutes: 10,
		// Défauts du MOTEUR (quiz-utils.ts) : un examen soumet à la fin du
		// temps et montre son chrono, sauf mention contraire.
		autoSubmit: true,
		showTimer: true,
	};
}

export function renderExamPanel(parent: HTMLElement, opts: ExamPanelOptions): void {
	const current = opts.get();
	const mode: QuizMode = current?.mode || (current?.enabled ? "exam" : "quiz");

	const box = parent.createDiv({ cls: "qbd-qz-exam" });
	const head = box.createDiv({ cls: "qbd-qz-exam-head" });
	setIcon(head.createSpan({ cls: "qbd-qz-exam-icon" }), "graduation-cap");
	head.createSpan({ cls: "qbd-qz-exam-title", text: t("dashboard.quiz.modeTitle") });

	createSelect(box, {
		value: mode,
		options: [
			{ value: "quiz", label: t("dashboard.quiz.modeQuiz") },
			{ value: "learn", label: t("dashboard.quiz.modeLearn") },
			{ value: "exam", label: t("dashboard.quiz.modeExam") },
		],
		onChange: (value) => {
			const next = value as QuizMode;
			// Le mode « quiz » est le défaut du moteur : il n'a pas besoin
			// d'objet de configuration dans le bloc, et en écrire un vide
			// ajouterait du bruit à la note.
			if (next === "quiz") {
				opts.set(null);
			} else {
				const base = opts.get() || defaults(next);
				base.mode = next;
				// Le chrono n'a de sens qu'en examen ; un mode learn le porte
				// seulement si l'auteur l'active explicitement ci-dessous.
				base.enabled = next === "exam";
				opts.set(base);
			}
			opts.onChange();
			opts.onStructureChange();
		},
	});

	box.createDiv({
		cls: "qbd-qz-exam-help",
		text: t(mode === "learn" ? "dashboard.quiz.modeLearnHelp"
			: mode === "exam" ? "dashboard.quiz.modeExamHelp"
			: "dashboard.quiz.modeQuizHelp"),
	});

	// Le chrono : toujours pour l'examen, en option pour l'apprentissage
	// (bouton « Passer l'examen »). Rien à régler en mode quiz.
	if (mode === "quiz") return;
	const cfg = opts.get();
	if (!cfg) return;

	if (mode === "learn") {
		checkbox(box, t("dashboard.quiz.learnExam"), cfg.enabled, (on) => {
			cfg.enabled = on;
			opts.onChange();
			opts.onStructureChange();
		});
		if (!cfg.enabled) return;
	}

	const durWrap = box.createDiv({ cls: "qbd-qz-exam-field" });
	durWrap.createDiv({ cls: "qbd-qz-field-label", text: t("dashboard.quiz.duration") });
	const dur = durWrap.createEl("input", { cls: "qbd-qz-field-input qbd-qz-field-input--single", type: "number" });
	dur.value = String(cfg.durationMinutes);
	dur.min = "1";
	dur.max = "180";
	dur.addEventListener("input", () => {
		// Bornes du MOTEUR (quiz-utils.ts, 1 à 180 minutes) : au-delà, la page
		// afficherait 999 pendant que l'examen en durerait 180.
		cfg.durationMinutes = Math.max(1, Math.min(180, Math.round(Number(dur.value) || 0)));
		opts.onChange();
	});
	dur.addEventListener("blur", () => { dur.value = String(cfg.durationMinutes); });

	checkbox(box, t("dashboard.quiz.autoSubmit"), cfg.autoSubmit, (on) => {
		cfg.autoSubmit = on;
		opts.onChange();
	});
	checkbox(box, t("dashboard.quiz.showTimer"), cfg.showTimer, (on) => {
		cfg.showTimer = on;
		opts.onChange();
	});
}

function checkbox(parent: HTMLElement, label: string, checked: boolean, onToggle: (on: boolean) => void): void {
	const row = parent.createEl("label", { cls: "qbd-qz-exam-check" });
	const input = row.createEl("input", { type: "checkbox" });
	input.checked = checked;
	row.createSpan({ text: label });
	input.addEventListener("change", () => onToggle(input.checked));
}
