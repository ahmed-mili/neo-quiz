import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { QuizIndexEntry, QuizTypeTag } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { computeQuizState } from "./quiz-mastery";
import { openActionMenu } from "./ui-select";
import type { ActionMenuItem } from "./ui-select";

/* Tag de type de quiz (calculé au scan) → clé de traduction, résolue au rendu.
   Table explicite plutôt qu'une clé construite par concaténation : `t()` n'accepte
   qu'une TransKey littérale, donc un tag orphelin est une erreur de compilation. */
const QUIZ_TYPE_KEYS: Record<QuizTypeTag, TransKey> = {
	mixed: "dashboard.quizType.mixed",
	single: "dashboard.quizType.single",
	multiple: "dashboard.quizType.multiple",
	text: "dashboard.quizType.text",
	ordering: "dashboard.quizType.ordering",
	matching: "dashboard.quizType.matching"
};

/** Libellé traduit du type d'un quiz (partagé par la carte et la vue Détail). */
export function quizTypeLabel(tag: QuizTypeTag): string {
	return t(QUIZ_TYPE_KEYS[tag]);
}

/* ══════════════════════════════════════════════════════════
   QUIZ CARD — composant carte partagé (home + quizzes)
   État lisible (pastille couleur + icône), accent coloré par état,
   progression affichée seulement en cours.
   `onOpen(quiz)` est appelé au clic sur la carte (navigation laissée
   à l'appelant). En haut à droite : chevron `chevron-right` ornemental
   par défaut (comportement historique) ; SI `opts.onPlay` est fourni,
   un bouton lecture rond le remplace et lance le quiz directement au
   clic (stoppe la propagation — ne doit PAS aussi déclencher `onOpen`).
   Opt-in par appelant (périmètre Ahmed 2026-07-17 : seul « Mes quiz »
   passe `onPlay` ; l'accueil garde le chevron pour l'instant) — même
   patron que `showPath` juste en dessous. */

export function renderQuizCard(
	container: HTMLElement,
	quiz: QuizIndexEntry,
	stats: QuizStatRecord | null | undefined,
	onOpen?: (quiz: QuizIndexEntry) => void,
	/* showPath (défaut true) : sous-titre dossier parent affiché sur TOUTE
	   carte, y compris quand l'appelant affiche déjà le dossier au-dessus
	   (arbre de « Mes quiz ») — répétition assumée, comme StudySmarter
	   (référence Ahmed, 2026-07-17). Option conservée pour un appelant futur
	   qui voudrait la masquer, mais aucun ne le fait plus aujourd'hui.
	   onPlay : callback de lancement direct, construite par l'appelant à
	   partir de SON `ctx.app` (renderQuizCard n'a pas accès à `app` — même
	   patron que `onOpen`, pas de nouveau paramètre positionnel). */
	/* menu (opt-in, même patron que onPlay) : items du menu ⋯ façon
	   StudySmarter, bâtis par l'appelant AU CLIC (les stats peuvent avoir
	   changé depuis le rendu de la carte). Non fourni = pas de bouton ⋯. */
	/* accent : couleur du DOSSIER PARENT. `entryIndex` pilote la cascade
	   d'entrée (la vue qui l'anime pose `.qbd-quizzes-enter`). */
	opts?: {
		showPath?: boolean;
		onPlay?: (quiz: QuizIndexEntry) => void;
		menu?: (quiz: QuizIndexEntry) => ActionMenuItem[];
		accent?: string;
		entryIndex?: number;
	}
): HTMLDivElement {
	/* Anatomie UNIQUE depuis le contrat visuel du 2026-07-28 : l'accueil et
	   « Mes quiz » rendent la même carte (handoff 7a). `--folder` reste le nom
	   du hook CSS — historique, il désignait la variante du dossier ouvert
	   quand l'accueil en avait une autre ; renommer toucherait ~40 règles pour
	   zéro pixel de différence. */
	const card = container.createDiv({ cls: "qbd-quiz-card qbd-quiz-card--folder" });
	card.dataset.path = quiz.path;
	if (opts?.accent) { card.style.setProperty("--accent", opts.accent); card.addClass("qbd-quiz-card--tinted"); }
	card.style.setProperty("--qbd-card-delay", `${100 + (opts?.entryIndex ?? 0) * 45}ms`);

	// ── État du quiz (calcul partagé quiz-mastery.ts) ──
	// `state` reste un identifiant (suffixe de classe CSS) ; seul `stateLabel`
	// est traduit — et il l'est ici, à chaque rendu de carte.
	const computed = computeQuizState(quiz, stats);
	const dueNow = Object.values(stats?.reviewItems || {}).some(item =>
		item.lastReviewedAt > 0 && Date.parse(item.card.due) <= Date.now());
	// Une échéance FSRS est plus pertinente que l'ancien classement par score.
	const state = dueNow ? "review" : computed.state;
	const pct = computed.pct;
	const best = stats ? stats.bestScore : 0;
	let stateLabel: string, stateIcon: string;
	switch (state) {
		case "mastered": stateLabel = t("dashboard.card.mastered"); stateIcon = "circle-check"; break;
		case "review": stateLabel = t("dashboard.card.review"); stateIcon = "rotate-ccw"; break;
		case "progress": stateLabel = t("dashboard.card.progress", { pct }); stateIcon = "rotate-cw"; break;
		default: stateLabel = t("dashboard.card.fresh"); stateIcon = "circle-play";
	}

	const body = card.createDiv({ cls: "qbd-quiz-card-body" });

	// En-tête : pastille d'état + bouton lecture
	const head = body.createDiv({ cls: "qbd-quiz-card-head" });
	const pill = head.createDiv({ cls: `qbd-quiz-card-status qbd-quiz-card-status--${state}` });
	const sIcon = pill.createSpan({ cls: "qbd-quiz-card-status-icon" });
	setIcon(sIcon, stateIcon);
	pill.createSpan({ text: stateLabel });
	if (opts?.onPlay) {
		const onPlay = opts.onPlay;
		// Bouton lecture rond — lance le quiz directement, sans passer par la
		// fiche. Pas d'aria-label (Obsidian en ferait une infobulle native
		// flottante, cf. ai.ts) : un `title` traduit suffit, le bouton n'a pas
		// de texte visible pour porter un nom accessible implicite.
		const playBtn = head.createEl("button", { cls: "qbd-quiz-card-play" });
		playBtn.type = "button";
		playBtn.title = t("dashboard.detail.play");
		setIcon(playBtn, "circle-play");
		playBtn.addEventListener("click", (e) => {
			// Empêche le clic de remonter à la carte : sinon on lancerait le
			// quiz ET on ouvrirait la fiche (deux actions pour un seul clic).
			e.stopPropagation();
			onPlay(quiz);
		});
	}

	// Titre
	body.createEl("p", { cls: "qbd-quiz-card-title", text: quiz.title });

	// Chemin — omis (pas masqué en CSS) quand l'appelant l'affiche déjà.
	// N'affiche que le DOSSIER PARENT (dernier segment), jamais le chemin
	// complet ni l'extension : le nom de fichier est déjà le titre juste
	// au-dessus, et le préfixe de dossiers commun à toutes les cartes
	// n'apprend rien — seul le dernier dossier identifie « d'où ça sort »
	// (défaut relevé par Ahmed à l'écran, 2026-07-17 : 3 lignes de
	// monospace, préfixe répété sur chaque carte). Racine du vault → aucun
	// dossier parent, donc aucune ligne (pas de texte vide, pas de placeholder).
	if (opts?.showPath !== false) {
		const segs = quiz.path.split("/").slice(0, -1).filter(Boolean);
		const parentFolder = segs.length > 0 ? segs[segs.length - 1] : null;
		if (parentFolder) {
			const pathEl = body.createEl("p", { cls: "qbd-quiz-card-path" });
			pathEl.createSpan({ text: parentFolder });
		}
	}

	// Aucune barre de progression : la pastille d'état porte déjà le
	// pourcentage (« In progress · 20% »), et la carte du handoff n'en a pas.

	// Meta : nombre de questions + type
	const meta = body.createDiv({ cls: "qbd-quiz-card-meta" });
	meta.createEl("span", {
		cls: "qbd-quiz-card-meta-item",
		text: t(quiz.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: quiz.questions })
	});
	const badge = meta.createEl("span", { cls: "qbd-quiz-card-badge" });
	badge.textContent = quizTypeLabel(quiz.quizType);

	// Bouton ⋯ en bout de ligne meta (position StudySmarter : coin bas droit).
	// stopPropagation : ouvrir le menu ne doit PAS aussi ouvrir la fiche.
	if (opts?.menu) {
		const menu = opts.menu;
		const moreBtn = meta.createEl("button", { cls: "qbd-card-more" });
		moreBtn.type = "button";
		moreBtn.title = t("dashboard.card.more");
		setIcon(moreBtn, "ellipsis");
		moreBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			openActionMenu(moreBtn, menu(quiz));
		});
	}

	// Ouverture (navigation laissée à l'appelant)
	card.addEventListener("click", () => {
		if (typeof onOpen === "function") onOpen(quiz);
	});

	return card;
}
