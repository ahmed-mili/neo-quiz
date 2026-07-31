import type { EngineCtx } from "../types/engine-ctx";
import { mathifyElement } from "./mathjax";
import { t } from "../i18n";

/* ══════════════════════════════════════════════════════════
   SUPPORT DE COMPRÉHENSION — le document qu'on lit avant de répondre.

   Un vrai sujet d'examen n'est pas qu'une suite de questions de cours : il
   comporte une partie compréhension, où UN document (texte, cas, extrait de
   code, image) porte PLUSIEURS questions. C'est ce que ce module rend.

   Partage : les questions qui déclarent le même `passageId` montrent le même
   support ; une seule porte le texte, les autres n'écrivent que l'identifiant.
   L'état replié est mémorisé PAR SUPPORT (pas par question) — replier le texte
   sur Q1 le garde replié en arrivant sur Q2, ce qu'attend un lecteur qui a fini
   de lire et veut la place pour répondre.
══════════════════════════════════════════════════════════ */

/** Support résolu pour une question donnée (partage `passageId` déjà appliqué). */
export interface ResolvedPassage {
	/** Clé d'identité et de partage — `passageId` s'il existe, sinon une clé privée à la question. */
	key: string;
	title: string;
	/** Texte brut du support (rendu avec embeds) ; vide si `html` porte le contenu. */
	text: string;
	/** HTML pré-rendu du support, prioritaire sur `text`. */
	html: string;
	/** Indices des questions qui partagent ce support, ordre du quiz. */
	sharedWith: number[];
}

export interface PassageHandlers {
	resolvePassage(qi: number): ResolvedPassage | null;
	passageHtml(qi: number): string;
	bindPassage(trackItem: HTMLElement, qi: number): void;
}

/* Icônes Lucide inline (book-open, chevron-down) : le plugin n'a pas d'autre
   canal d'icône côté moteur — `ctx.lucideIcons` est vestigial et setIcon()
   d'Obsidian ne s'applique qu'à un nœud DOM déjà monté, alors que tout le
   moteur construit des chaînes HTML. */
const ICON_BOOK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>';
const ICON_CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

export function createPassageHandlers(ctx: EngineCtx): PassageHandlers {
	/* Replis mémorisés par CLÉ de support, pas par question — c'est ce qui fait
	   qu'un document replié le reste d'une question à l'autre. */
	const collapsed = new Set<string>();

	/** Champ support d'une question, forme texte ou HTML pré-rendu. */
	const rawText = (qi: number): string => String(ctx.quiz[qi]?.passage ?? "").trim();
	const rawHtml = (qi: number): string => {
		const q = ctx.quiz[qi];
		return String(q?.passageHtml || q?._passageHtml || "").trim();
	};
	const hasContent = (qi: number): boolean => rawText(qi).length > 0 || rawHtml(qi).length > 0;

	function resolvePassage(qi: number): ResolvedPassage | null {
		const q = ctx.quiz[qi];
		if (!q) return null;

		const sharedId = String(q.passageId ?? "").trim();

		// Sans identifiant de partage, le support doit être porté par la question
		// elle-même — sinon il n'y a rien à afficher.
		if (!sharedId) {
			if (!hasContent(qi)) return null;
			return {
				key: `q${qi}`,
				title: String(q.passageTitle ?? "").trim() || t("engine.passage.defaultTitle"),
				text: rawText(qi),
				html: rawHtml(qi),
				sharedWith: [qi]
			};
		}

		// Avec identifiant : le contenu vient de la PREMIÈRE question du quiz qui
		// porte cet identifiant ET du contenu (les suivantes n'écrivent que l'id).
		const sharedWith: number[] = [];
		let source = -1;
		for (let i = 0; i < ctx.quiz.length; i++) {
			if (String(ctx.quiz[i]?.passageId ?? "").trim() !== sharedId) continue;
			sharedWith.push(i);
			if (source === -1 && hasContent(i)) source = i;
		}
		if (source === -1) return null;

		const src = ctx.quiz[source];
		return {
			key: sharedId,
			// Le titre peut être posé sur n'importe quelle question du groupe :
			// celui de la question courante prime, sinon celui de la source.
			title: String(q.passageTitle ?? "").trim() || String(src?.passageTitle ?? "").trim() || t("engine.passage.defaultTitle"),
			text: rawText(source),
			html: rawHtml(source),
			sharedWith
		};
	}

	/** « Q2 · questions 2 à 4 » — dit au lecteur combien de questions portent sur ce document. */
	function scopeLabel(p: ResolvedPassage): string {
		if (p.sharedWith.length < 2) return "";
		const first = p.sharedWith[0] + 1;
		const last = p.sharedWith[p.sharedWith.length - 1] + 1;
		// Groupe contigu ⇒ « questions 2 à 4 » ; groupe éclaté ⇒ le compte seul.
		const contiguous = p.sharedWith.every((qi, k) => qi === p.sharedWith[0] + k);
		return contiguous
			? t("engine.passage.scopeRange", { first, last })
			: t("engine.passage.scopeCount", { count: p.sharedWith.length });
	}

	function passageHtml(qi: number): string {
		const p = resolvePassage(qi);
		if (!p) return "";

		const contentHtml = p.html
			? ctx.sanitize.replaceObsidianEmbedsInHtml(p.html, { wrapClass: "quiz-passage-embed-wrap", imgClass: "quiz-passage-embed" })
			: ctx.sanitize.renderTextWithEmbeds(p.text, { wrapClass: "quiz-passage-embed-wrap", imgClass: "quiz-passage-embed" });

		const isCollapsed = collapsed.has(p.key);
		const scope = scopeLabel(p);
		const toggleLabel = t(isCollapsed ? "engine.passage.expand" : "engine.passage.collapse");

		return `<div class="quiz-passage${isCollapsed ? " is-collapsed" : ""}" data-passage-key="${ctx.escapeHtmlAttr(p.key)}">
			<div class="quiz-passage-head">
				<span class="quiz-passage-icon" aria-hidden="true">${ICON_BOOK}</span>
				<span class="quiz-passage-title">${ctx.sanitize.renderInlineText(p.title)}</span>
				${scope ? `<span class="quiz-passage-scope">${ctx.sanitize.renderInlineText(scope)}</span>` : ""}
				<button class="quiz-passage-toggle" type="button" data-passage-toggle="1" aria-expanded="${isCollapsed ? "false" : "true"}" aria-label="${ctx.escapeHtmlAttr(toggleLabel)}" title="${ctx.escapeHtmlAttr(toggleLabel)}">${ICON_CHEVRON}</button>
			</div>
			<div class="quiz-passage-body"><div class="quiz-passage-content">${contentHtml}</div></div>
		</div>`;
	}

	function bindPassage(trackItem: HTMLElement, qi: number): void {
		const root = trackItem.querySelector<HTMLElement>(".quiz-passage");
		if (!root) return;

		// LaTeX du support : la carte question est mathifiée par le moteur, mais
		// une slide reconstruite hors de ce chemin (refresh partiel) doit l'être ici.
		mathifyElement(root);

		const toggle = root.querySelector<HTMLButtonElement>("[data-passage-toggle]");
		if (!toggle) return;

		toggle.addEventListener("click", e => {
			e.preventDefault();
			e.stopPropagation();
			const key = root.dataset.passageKey || "";
			const nowCollapsed = !collapsed.has(key);
			if (nowCollapsed) collapsed.add(key); else collapsed.delete(key);
			const label = t(nowCollapsed ? "engine.passage.expand" : "engine.passage.collapse");

			/* Toutes les slides existent DÉJÀ dans le DOM (piste préconstruite) :
			   mémoriser l'état dans `collapsed` ne suffit pas, il n'est relu qu'à
			   la construction du HTML. Le repli doit donc être appliqué ICI à
			   chaque copie du MÊME document — sinon replier sur Q1 laisse le texte
			   déplié en arrivant sur Q2, et le partage n'en est plus un. */
			const twins = ctx.container.querySelectorAll<HTMLElement>(
				`.quiz-passage[data-passage-key="${CSS.escape(key)}"]`
			);
			twins.forEach(el => {
				el.classList.toggle("is-collapsed", nowCollapsed);
				const btn = el.querySelector<HTMLButtonElement>("[data-passage-toggle]");
				if (!btn) return;
				btn.setAttribute("aria-expanded", nowCollapsed ? "false" : "true");
				btn.setAttribute("aria-label", label);
				btn.setAttribute("title", label);
			});

			/* Chaque carte touchée change de hauteur : leurs entrées de cache sont
			   périmées. Pas d'animation de repli — un collapse animé laisse des
			   pixels fantômes du compositeur sur la piste translatée. */
			const p = resolvePassage(qi);
			for (const twinQi of (p ? p.sharedWith : [qi])) {
				const slideIdx = ctx.getSlideIndexForQuestion(twinQi);
				if (slideIdx < 0) continue;
				ctx.viewport.__quizSlideHeightCache?.delete(slideIdx);
				if (slideIdx === ctx.quizState.current) {
					ctx.viewport.scheduleViewportHeightSync({ index: slideIdx, animate: false, refresh: true });
				}
			}
		});
	}

	return { resolvePassage, passageHtml, bindPassage };
}
