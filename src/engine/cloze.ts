import type { EngineCtx } from "../types/engine-ctx";
import type { ClozeQuestion } from "../types/quiz";
import { t } from "../i18n";

/* ══════════════════════════════════════════════════════════
   TEXTE À TROUS — la question la plus courante d'un contrôle écrit, et la
   seule forme classique que le format ne savait pas exprimer.

   Gabarit : le texte, avec chaque trou entre doubles accolades.
     cloze: "La capitale de la France est {{Paris}}, sa monnaie {{l'euro|euro}}."

   Doubles ACCOLADES et non doubles crochets : `[[…]]` est le lien interne
   d'Obsidian et `![[…]]` son embed — un gabarit écrit avec des crochets
   serait réécrit par le vault avant d'atteindre le moteur.

   Les variantes acceptées se séparent par « | ». La comparaison passe par la
   même normalisation que les réponses libres (accents, casse, écriture
   décimale) : un trou n'est pas plus sévère qu'une question texte.

   Toutes les cases ont la MÊME largeur, jamais celle de la réponse : une
   case dimensionnée sur son contenu donne la longueur du mot cherché.
══════════════════════════════════════════════════════════ */

/** Un trou du gabarit : ses réponses acceptées, dans l'ordre d'écriture. */
export interface ClozeBlank {
	answers: string[];
}

/** Gabarit découpé : du texte, des trous, dans l'ordre de lecture. */
export type ClozeSegment =
	| { type: "text"; value: string }
	| { type: "blank"; index: number };

export interface ParsedCloze {
	segments: ClozeSegment[];
	blanks: ClozeBlank[];
}

export interface ClozeHandlers {
	parseCloze(template: unknown): ParsedCloze;
	getBlanks(q: ClozeQuestion): ClozeBlank[];
	clozeCardHtml(q: ClozeQuestion, qi: number): string;
	bindClozeQuestion(trackItem: HTMLElement, qi: number): void;
	isBlankCorrect(q: ClozeQuestion, blankIndex: number, value: unknown): boolean;
	isClozeCorrect(q: ClozeQuestion, sel: unknown): boolean;
	getClozeAnswers(q: ClozeQuestion): string[];
}

/* La largeur des cases est UNIFORME et vit dans le CSS (.quiz-cloze-input),
   pas ici : une largeur en style inline ne se surcharge pas, et l'écran étroit
   d'un téléphone en demande une plus petite. Le moteur dit qu'il y a un trou,
   la feuille de style dit quelle place il prend. */

const BLANK_RE = /\{\{([^{}]*)\}\}/g;

/* Découpe du gabarit — hors de la factory : l'APERÇU d'une question (page
   d'un quiz, éditeur) doit montrer les trous, et il n'a pas de moteur sous
   la main. Une seconde lecture maison finirait par diverger de celle-ci. */
export function parseCloze(template: unknown): ParsedCloze {
	const raw = String(template ?? "");
	const segments: ClozeSegment[] = [];
	const blanks: ClozeBlank[] = [];

	let lastIndex = 0;
	let match: RegExpExecArray | null;
	BLANK_RE.lastIndex = 0;
	while ((match = BLANK_RE.exec(raw)) !== null) {
		if (match.index > lastIndex) {
			segments.push({ type: "text", value: raw.slice(lastIndex, match.index) });
		}
		const answers = String(match[1] ?? "")
			.split("|")
			.map(a => a.trim())
			.filter(a => a.length > 0);
		// Un trou sans aucune réponse ({{}}) n'est pas un trou : il ne
		// pourrait jamais être juste. Rendu comme du texte littéral.
		if (answers.length === 0) {
			segments.push({ type: "text", value: match[0] });
		} else {
			segments.push({ type: "blank", index: blanks.length });
			blanks.push({ answers });
		}
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < raw.length) segments.push({ type: "text", value: raw.slice(lastIndex) });

	return { segments, blanks };
}

export function createClozeHandlers(ctx: EngineCtx): ClozeHandlers {

	const getBlanks = (q: ClozeQuestion): ClozeBlank[] => parseCloze(q?.cloze).blanks;

	/** Les réponses attendues, une chaîne par trou (première variante) — sert au
	    récapitulatif de correction et à l'export des résultats. */
	const getClozeAnswers = (q: ClozeQuestion): string[] =>
		getBlanks(q).map(b => b.answers[0] ?? "");

	function isBlankCorrect(q: ClozeQuestion, blankIndex: number, value: unknown): boolean {
		const blank = getBlanks(q)[blankIndex];
		if (!blank) return false;
		const opts = { caseSensitive: !!q.caseSensitive };
		const given = ctx.terminal.normalizeTextAnswer(value, opts);
		if (!given) return false;
		return blank.answers.some(a => ctx.terminal.normalizeTextAnswer(a, opts) === given);
	}

	function isClozeCorrect(q: ClozeQuestion, sel: unknown): boolean {
		const blanks = getBlanks(q);
		if (blanks.length === 0) return false;
		if (!Array.isArray(sel) || sel.length !== blanks.length) return false;
		return blanks.every((_, i) => isBlankCorrect(q, i, sel[i]));
	}

	function clozeCardHtml(q: ClozeQuestion, qi: number): string {
		const { segments, blanks } = parseCloze(q.cloze);
		const sel = ctx.quizState.selections[qi];
		const values: unknown[] = Array.isArray(sel) ? sel : [];
		const locked = ctx.quizState.locked;

		const body = segments.map(seg => {
			if (seg.type === "text") {
				return ctx.sanitize.renderTextWithEmbeds(seg.value, {
					wrapClass: "quiz-cloze-embed-wrap",
					imgClass: "quiz-cloze-embed"
				});
			}

			const value = String(values[seg.index] ?? "");
			// Un trou REMPLI se distingue des trous encore vides sans attendre
			// la correction (demande Ahmed 2026-07-31) : la classe porte cet
			// état, le CSS lui donne son fond et sa bordure pleine.
			let cls = "quiz-cloze-input" + (value.trim() ? " is-filled" : "");
			let expected = "";
			if (locked) {
				const ok = isBlankCorrect(q, seg.index, value);
				cls += ok ? " correct" : " wrong";
				// La bonne réponse ne s'affiche qu'à côté d'un trou raté : la
				// rappeler partout noierait la correction.
				if (!ok) {
					const answer = blanks[seg.index]?.answers[0] ?? "";
					expected = `<span class="quiz-cloze-expected">${ctx.sanitize.renderInlineText(answer)}</span>`;
				}
			}

			return `<span class="quiz-cloze-slot"><input class="${cls}" type="text" `
				+ `data-cloze="${seg.index}" value="${ctx.escapeHtmlAttr(value)}" `
				+ `autocomplete="off" autocapitalize="off" spellcheck="false" `
				+ `aria-label="${ctx.escapeHtmlAttr(t("engine.cloze.blankAria", { n: seg.index + 1 }))}"`
				+ `${locked ? " disabled" : ""}>${expected}</span>`;
		}).join("");

		return `<div class="quiz-multi-indicator">${t("engine.cloze.instructions", { count: blanks.length })}</div>
		<div class="quiz-cloze">${body}</div>`;
	}

	/** Bascule l'état « rempli » d'un trou, et n'anime QUE la transition
	    vide → rempli : rejouer le pop à chaque frappe ferait sautiller la
	    case pendant qu'on tape. Le retrait/reflow/ajout relance l'animation
	    quand un trou est vidé puis re-rempli (une classe déjà posée ne
	    redéclenche rien). */
	function markFilled(input: HTMLInputElement): void {
		const filled = input.value.trim().length > 0;
		if (filled === input.classList.contains("is-filled")) return;
		input.classList.toggle("is-filled", filled);
		if (!filled) return;
		input.classList.remove("quiz-cloze-pop");
		void input.offsetWidth;
		input.classList.add("quiz-cloze-pop");
	}

	function bindClozeQuestion(trackItem: HTMLElement, qi: number): void {
		const q = ctx.quiz[qi] as ClozeQuestion;
		const blanks = getBlanks(q);

		// La sélection doit avoir exactement une case par trou : un gabarit
		// modifié entre deux rendus laisserait sinon un tableau désaligné.
		const sel = ctx.quizState.selections[qi];
		if (!Array.isArray(sel) || sel.length !== blanks.length) {
			ctx.quizState.selections[qi] = new Array<string>(blanks.length).fill("");
		}

		const inputs = trackItem.querySelectorAll<HTMLInputElement>(".quiz-cloze-input[data-cloze]");
		inputs.forEach(input => {
			const bi = Number(input.dataset.cloze);
			if (!Number.isFinite(bi)) return;

			input.addEventListener("input", () => {
				if (ctx.quizState.locked) return;
				const current = ctx.quizState.selections[qi];
				if (!Array.isArray(current)) return;
				ctx.invalidateSavedResults?.();
				(current as unknown as string[])[bi] = input.value;
				markFilled(input);
				ctx.updateNavHighlight();
				ctx.refreshMetaSlides();
			});

			/* Entrée passe au trou suivant, et au dernier ne soumet rien : la
			   frappe d'un texte à trous est continue, une validation
			   accidentelle en plein milieu coûterait la question. */
			input.addEventListener("keydown", e => {
				if (e.key !== "Enter") return;
				e.preventDefault();
				const next = inputs[bi + 1];
				if (next) next.focus();
				else input.blur();
			});
		});
	}

	return {
		parseCloze,
		getBlanks,
		clozeCardHtml,
		bindClozeQuestion,
		isBlankCorrect,
		isClozeCorrect,
		getClozeAnswers
	};
}
