import type { TAbstractFile, TFile } from "obsidian";
import type { EngineCtx } from "../types/engine-ctx";
import type { QuestionBase } from "../types/quiz";

/** Spec `![[lien|100x50|alt]]` décomposée (buildEmbedImgHtml, resolveObsidianEmbedFile). */
interface ParsedEmbedSpec {
	linkPath: string;
	width: number | null;
	height: number | null;
	alt: string;
}

interface EmbedClassOptions {
	wrapClass?: string;
	imgClass?: string;
}

export interface SanitizerHandlers {
	escapeHtmlAttr(value: unknown): string;
	escapeHtmlText(value: unknown): string;
	unescapeHtmlText(value: unknown): string;
	isSafeQuizUrl(value: unknown, opts?: { image?: boolean }): boolean;
	unwrapQuizHtmlElement(node: ChildNode | null | undefined): void;
	sanitizeQuizHtml(html: unknown): string;
	renderInlineQuizHtml(raw: unknown): string;
	resourceButtonHtml(q: QuestionBase | null | undefined): string;
	resolveObsidianEmbedFile(linkPath: unknown): TAbstractFile | null;
	parseObsidianEmbedSpec(spec: unknown): ParsedEmbedSpec;
	buildEmbedImgHtml(embedSpec: unknown, opts?: EmbedClassOptions): string;
	restoreAllowedInlineTags(html: unknown): string;
	renderInlineText(raw: unknown): string;
	stripInlineMarkdown(raw: unknown): string;
	renderTextWithEmbeds(raw: unknown, opts?: EmbedClassOptions): string;
	renderHintWithCodeAndEmbeds(raw: unknown): string;
	renderRawHtmlWithEmbeds(raw: unknown, opts?: EmbedClassOptions): string;
	replaceObsidianEmbedsInHtml(html: unknown, opts?: EmbedClassOptions): string;
}

/** Balise de mise à l'abri de `inlineMarkdown` (maths, code) : U+0000, un
    caractère de contrôle qu'aucun texte de quiz réel ne contient. Un
    placeholder fait de lettres finirait, lui, par apparaître dans une
    question qui en parle. Construit par code — un NUL littéral dans une
    source TypeScript ne survit pas à un outil de formatage. */
const MD_MARK = String.fromCharCode(0);

/**
 * Motif d'un délimiteur markdown apparié (`**`, `*`, `~~`), avec la règle de
 * FLANC GAUCHE : le délimiteur ouvrant ne peut suivre ni une lettre, ni un
 * chiffre, ni un antislash. C'est ce qui distingue de l'emphase deux cas très
 * courants dans un quiz technique :
 *   - `3*4*5` — une multiplication, pas de l'italique ;
 *   - `C:\Users\*\AppData\*\Cache` — un chemin Windows, où `\*` est d'ailleurs
 *     la forme markdown d'une étoile littérale.
 * Le contenu, lui, doit commencer et finir collé au délimiteur (`(?=\S)` …
 * `\S`) : « 3 * 4 * 5 », espacé, n'est pas non plus de l'emphase.
 */
function FLANK(delim: string): RegExp {
	// `\p{L}\p{N}` et non `0-9A-Za-zÀ-ÿ` : une multiplication écrite avec des
	// variables grecques, arabes ou chinoises (`α*β*γ`, `甲*乙*丙`) est une
	// multiplication elle aussi — la classe ASCII la rendait en italique.
	return new RegExp(
		"(^|[^\\p{L}\\p{N}\\\\" + delim.replace(/\\/g, "") + "])"
		+ delim + "(?=\\S)((?:(?!" + delim + ")[\\s\\S])*?\\S)" + delim,
		"gu",
	);
}

function escapeHtmlText(value: unknown): string {
	return String(value ?? "")
		.replace(/\&/g, "\&amp;")
		.replace(/\</g, "\&lt;")
		.replace(/\>/g, "\&gt;")
		.replace(/"/g, "\&quot;")
		.replace(/'/g, "\&#39;");
}

function restoreAllowedInlineTags(html: unknown): string {
	return String(html ?? "")
		.replace(/\&lt;br\s*\/?\&gt;/gi, "<br>")
		.replace(/\&lt;(\/?)code\&gt;/gi, "<$1code>")
		.replace(/\&lt;(\/?)(strong|b|em|i|u|mark|kbd|samp|small|sub|sup)\&gt;/gi, "<$1$2>");
}

/* ── Markdown INLINE des champs texte ────────────────────────────────
   Un quiz écrit à la main — ou généré par un modèle — contient du
   markdown : `**gras**`, `*italique*`, `` `code` ``. Sans cette passe,
   les étoiles et les accents graves s'affichaient TELS QUELS dans les
   énoncés, les options, l'explication et surtout la leçon du mode learn
   (constat Ahmed 2026-07-31). Le champ n'a pas d'équivalent HTML
   (`learn`, `cloze`… passent en texte brut) : c'est ici, au rendu, que
   ça se joue — pas à l'export, qui doit garder la source lisible.

   Entrée : du texte DÉJÀ échappé (escapeHtmlText) où les quelques
   balises inline autorisées ont été restaurées. On n'introduit donc
   jamais de HTML venu de l'utilisateur : uniquement les balises que
   cette fonction écrit elle-même.

   Ce qui est mis à l'abri AVANT toute substitution :
   - les formules LaTeX ($…$, $$…$$) — MathJax lit la source telle
     quelle, et un `*` ou un `_` y appartient à la formule ;
   - les <code> déjà présents — leur contenu est littéral par nature. */
function inlineMarkdown(escaped: string): string {
	const stash: string[] = [];
	const keep = (html: string): string => MD_MARK + (stash.push(html) - 1) + MD_MARK;

	let out = escaped
		// `\$` ÉCHAPPÉ n'ouvre pas une formule : « Prix \$5 … \$10 » n'est
		// pas du LaTeX, et le prendre pour tel figeait tout le segment (le
		// gras au milieu restait littéral).
		.replace(/(^|[^\\])(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g, (_m, before: string, math: string) => before + keep(math))
		.replace(/<code>[\s\S]*?<\/code>/g, m => keep(m))
		// Double accent grave AVANT le simple : c'est la forme markdown
		// d'un code qui CONTIENT un accent grave (``a ` b``).
		.replace(/``([^\n]+?)``/g, (_m, code: string) => keep(`<code>${code}</code>`))
		.replace(/`([^`\n]+)`/g, (_m, code: string) => keep(`<code>${code}</code>`));

	out = out
		// Une suite de QUATRE étoiles ou plus n'est pas de l'emphase : aucune
		// combinaison de gras et d'italique ne s'écrit ainsi, et la laisser
		// passer faisait produire des balises croisées. Mise à l'abri telle
		// quelle, comme le ferait un lecteur markdown.
		.replace(/\*{4,}/g, m => keep(m))
		// Triple AVANT double avant simple : `***x***` traité en une passe,
		// sinon les balises se croisent (<strong><em>…</strong></em>).
		.replace(FLANK("\\*\\*\\*"), "$1<strong><em>$2</em></strong>")
		.replace(FLANK("\\*\\*"), "$1<strong>$2</strong>")
		.replace(FLANK("\\*"), "$1<em>$2</em>")
		.replace(FLANK("~~"), "$1<del>$2</del>");

	return out.replace(new RegExp(MD_MARK + "(\\d+)" + MD_MARK, "g"), (_m, i: string) => stash[Number(i)]);
}

/** Texte d'affichage : échappé, puis markdown inline. Le pendant de
    `escapeHtmlText` pour tout ce que l'apprenant LIT (libellés de
    classement, d'appariement, titres, réponses attendues) — mais jamais
    pour ce qu'il ÉCRIT (valeur d'un textarea) ni pour un attribut.

    EXPORTÉ pour `scripts/check-markdown.mjs` : c'est la seule logique du
    plugin assez tordue pour mériter un jeu de cas, et le script doit
    éprouver CETTE fonction — une réplique dans le script finirait par
    diverger de l'originale et validerait le vide. */
export function renderInlineText(raw: unknown): string {
	return inlineMarkdown(restoreAllowedInlineTags(escapeHtmlText(raw)));
}

/** Le même texte, mais RAMENÉ AU TEXTE NU : les marqueurs appariés tombent au
    lieu de devenir des balises. Pour les endroits où le HTML n'existe pas —
    l'attribut `placeholder` d'un champ, un `aria-label`, la vignette d'une
    liste. Sans ça, un placeholder « Réponds en **majuscules** » affichait ses
    étoiles : du markdown non rendu, exactement ce qu'on chasse ailleurs.

    Mêmes règles de flanc que `renderInlineText` — c'est volontairement la
    même grammaire, sur le même texte, avec une sortie différente.

    ⚠ La sortie est du TEXTE, pas du HTML : les entités y sont décodées, donc
    un `<img …>` que l'utilisateur a écrit littéralement en ressort tel quel.
    Elle ne doit JAMAIS être interpolée dans du HTML sans être ré-échappée —
    `escapeHtmlAttr`, `setAttribute` ou `textContent`, comme le font ses
    appelants. Pour du HTML, c'est `renderInlineText` qu'il faut. */
export function stripInlineMarkdown(raw: unknown): string {
	/* `restoreAllowedInlineTags` AUSSI ici, comme au rendu : sans lui, un
	   `<strong>x</strong>` écrit à la main restait échappé pendant le retrait
	   des balises, puis ressortait visible au décodage des entités — le
	   placeholder affichait ses chevrons là où le rendu, lui, affiche « x »
	   en gras (revue codex 2026-07-31). */
	const html = inlineMarkdown(restoreAllowedInlineTags(escapeHtmlText(raw)));
	return html
		// Un `<br>` sépare deux mots : le remplacer par RIEN les collerait.
		.replace(/<br\s*\/?>/gi, " ")
		// Toute balise restante vient de nous (produite ci-dessus ou restaurée
		// depuis la liste blanche) : ce qui venait de l'utilisateur est encore
		// échappé à ce stade, et ne sera décodé qu'après.
		.replace(/<[^>]*>/g, "")
		.replace(/\&lt;/g, "<").replace(/\&gt;/g, ">")
		.replace(/\&quot;/g, "\"").replace(/\&#39;/g, "'")
		// `&amp;` en DERNIER : le faire avant ressusciterait « &amp;lt; » en « < ».
		.replace(/\&amp;/g, "&")
		.replace(/\s+/g, " ").trim();
}

export function createSanitizer(ctx: EngineCtx): SanitizerHandlers {
	const QUIZ_HTML_ALLOWED_TAGS = new Set([
		"a", "b", "blockquote", "br", "center", "code", "details", "div", "em", "font",
		"h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "kbd", "li", "mark",
		"ol", "p", "pre", "samp", "small", "span", "strong", "sub", "summary", "sup",
		"table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"
	]);

	const QUIZ_HTML_DROP_TAGS = new Set([
		"script", "style", "iframe", "object", "embed", "link", "meta"
	]);

	const QUIZ_HTML_GLOBAL_ATTRS = new Set([
		"class", "title", "role", "aria-label", "aria-hidden", "tabindex"
	]);

	/* `style` n'est pas jeté en bloc : il est RÉDUIT. Retirer l'attribut entier
	   aurait décoloré 594 fragments des quiz d'Ahmed — mesuré sur ses deux
	   vaults, où `color:` est d'ailleurs la SEULE propriété employée, sur
	   `<span>` et `<p>`. Les autres entrées de cette liste sont ses voisines
	   évidentes, admises d'avance pour ne pas rouvrir le sujet à la première
	   mise en forme un peu riche.
	   Ce qui reste dehors est ce qui sert à ATTAQUER : `url(…)` (requête
	   sortante, donc traçage), `expression(…)` et `-moz-binding` (du code),
	   `position`/`z-index` (recouvrir l'interface d'Obsidian). */
	const QUIZ_STYLE_ALLOWED_PROPS = new Set([
		"color", "background-color", "font-weight", "font-style",
		"text-align", "text-decoration"
	]);
	/* Une valeur ne peut être qu'un mot, un nombre, un `#hex` ou une fonction
	   de couleur. Ni guillemet, ni antislash, ni parenthèse ouvrante autre que
	   celles-là — un `url(` ne peut donc pas se former. */
	const QUIZ_STYLE_SAFE_VALUE = /^(?:rgba?\(|hsla?\(|[\w %.,#-]|\))+$/i;

	/** `style` réduit à ses déclarations sûres ; chaîne vide s'il n'en reste
	    aucune — l'attribut est alors retiré. */
	function sanitizeStyleAttr(value: unknown): string {
		return String(value ?? "")
			.split(";")
			.map(decl => {
				const sep = decl.indexOf(":");
				if (sep < 0) return "";
				const prop = decl.slice(0, sep).trim().toLowerCase();
				const val = decl.slice(sep + 1).trim();
				if (!QUIZ_STYLE_ALLOWED_PROPS.has(prop)) return "";
				if (!val || !QUIZ_STYLE_SAFE_VALUE.test(val)) return "";
				return prop + ": " + val;
			})
			.filter(Boolean)
			.join("; ");
	}

	const QUIZ_HTML_TAG_ATTRS: Record<string, Set<string>> = {
		a: new Set(["href", "target", "rel"]),
		img: new Set(["src", "alt", "width", "height"]),
		td: new Set(["colspan", "rowspan"]),
		th: new Set(["colspan", "rowspan"]),
		font: new Set(["color"])
	};

	function escapeHtmlAttr(value: unknown): string {
		return String(value ?? "")
			.replace(/\&/g, "\&amp;")
			.replace(/"/g, "\&quot;")
			.replace(/'/g, "\&#39;")
			.replace(/\</g, "\&lt;")
			.replace(/\>/g, "\&gt;");
	}

	function unescapeHtmlText(value: unknown): string {
		return String(value ?? "")
			.replace(/\&lt;/g, "<")
			.replace(/\&gt;/g, ">")
			.replace(/\&quot;/g, '"')
			.replace(/\&#39;/g, "'")
			.replace(/\&amp;/g, "&");
	}

	function isSafeQuizUrl(value: unknown, { image = false }: { image?: boolean } = {}): boolean {
		const raw = String(value ?? "").trim();
		if (!raw) return false;

		if (
			raw.startsWith("#") ||
			raw.startsWith("/") ||
			raw.startsWith("./") ||
			raw.startsWith("../")
		) {
			return true;
		}

		if (/^(https?:|mailto:|tel:|obsidian:|app:|file:|blob:)/i.test(raw)) {
			return true;
		}

		if (image && /^data:image\//i.test(raw)) {
			return true;
		}

		return false;
	}

	function unwrapQuizHtmlElement(node: ChildNode | null | undefined): void {
		const parent = node?.parentNode ?? null;
		if (!parent || !node) return;

		let first: ChildNode | null;
		while ((first = node.firstChild)) {
			parent.insertBefore(first, node);
		}
		parent.removeChild(node);
	}

	function sanitizeQuizHtml(html: unknown): string {
		const tpl = document.createElement("template");
		tpl.innerHTML = String(html ?? "");

		const walk = (node: ChildNode | null | undefined): void => {
			if (!node) return;

			if (node.nodeType === Node.COMMENT_NODE) {
				node.remove();
				return;
			}

			if (node.nodeType !== Node.ELEMENT_NODE) return;

			// Narrowing sûr : nodeType === ELEMENT_NODE garantit un Element (TS ne
			// corrèle pas nodeType et le type ChildNode automatiquement).
			const el = node as Element;

			const tag = el.tagName.toLowerCase();

			if (QUIZ_HTML_DROP_TAGS.has(tag)) {
				el.remove();
				return;
			}

			if (!QUIZ_HTML_ALLOWED_TAGS.has(tag)) {
				unwrapQuizHtmlElement(el);
				return;
			}

			const allowedAttrs = QUIZ_HTML_TAG_ATTRS[tag] || new Set<string>();

			Array.from(el.attributes).forEach(attr => {
				const name = attr.name.toLowerCase();
				const value = attr.value;

				if (name.startsWith("on")) {
					el.removeAttribute(attr.name);
					return;
				}

				if (name === "style") {
					const reduit = sanitizeStyleAttr(value);
					if (reduit) el.setAttribute("style", reduit);
					else el.removeAttribute(attr.name);
					return;
				}

				if (!QUIZ_HTML_GLOBAL_ATTRS.has(name) && !allowedAttrs.has(name)) {
					el.removeAttribute(attr.name);
					return;
				}

				if (
					(name === "href" || name === "src") &&
					!isSafeQuizUrl(value, { image: name === "src" && tag === "img" })
				) {
					el.removeAttribute(attr.name);
					return;
				}

				if (
					(name === "width" || name === "height" || name === "colspan" || name === "rowspan") &&
					!/^\d{1,4}$/.test(String(value).trim())
				) {
					el.removeAttribute(attr.name);
					return;
				}

				if (name === "target" && !/^_(self|blank)$/.test(String(value).trim())) {
					el.removeAttribute(attr.name);
					return;
				}
			});

			if (tag === "a" && el.getAttribute("target") === "_blank") {
				el.setAttribute("rel", "noopener noreferrer");
			}

			Array.from(el.childNodes).forEach(walk);
		};

		Array.from(tpl.content.childNodes).forEach(walk);
		return tpl.innerHTML;
	}

	function renderInlineQuizHtml(raw: unknown): string {
		return restoreAllowedInlineTags(
			escapeHtmlText(String(raw ?? "")).replace(/\n/g, "<br>")
		);
	}

	function resourceButtonHtml(q: QuestionBase | null | undefined): string {
		const rb = q?.resourceButton;
		if (!rb || !rb.label || !rb.fileName) return "";
		return `<button class="quiz-resource-btn" type="button" data-resource-file="${escapeHtmlAttr(rb.fileName)}"><span class="quiz-resource-btn-icon" aria-hidden="true">${ctx.lucideIcons?.paperclip || "⬇" }</span><span class="quiz-resource-btn-label">${renderInlineText(rb.label)}</span></button>`;
	}

	function resolveObsidianEmbedFile(linkPath: unknown): TAbstractFile | null {
		const raw = String(linkPath ?? "").trim();
		if (!raw) return null;

		const currentFilePath = ctx.sourcePath || "";

		try {
			if (ctx.app?.metadataCache?.getFirstLinkpathDest) {
				const f = ctx.app.metadataCache.getFirstLinkpathDest(raw, currentFilePath);
				if (f) return f;
			}
		} catch (e) {
			console.warn("[Quiz] resolveObsidianEmbedFile erreur:", e);
		}

		try {
			const f2 = ctx.app?.vault?.getAbstractFileByPath?.(raw);
			if (f2) return f2;
		} catch (e) {
			console.warn("[Quiz] getAbstractFileByPath erreur:", e);
		}

		return null;
	}

	function parseObsidianEmbedSpec(spec: unknown): ParsedEmbedSpec {
		const s = String(spec ?? "").trim();
		const parts = s.split("|");
		const linkPath = (parts[0] || "").trim();
		let width: number | null = null, height: number | null = null, alt = "";
		if (parts.length >= 2) {
			const p = (parts[1] || "").trim();
			if (/^\d+$/.test(p)) width = Number(p);
			else if (/^\d+x\d+$/i.test(p)) {
				const [w, h] = p.toLowerCase().split("x").map(n => Number(n));
				if (Number.isFinite(w)) width = w;
				if (Number.isFinite(h)) height = h;
			} else alt = p;
		}
		return { linkPath, width, height, alt };
	}

	function buildEmbedImgHtml(embedSpec: unknown, { wrapClass = "quiz-question-embed-wrap", imgClass = "quiz-question-embed" }: EmbedClassOptions = {}): string {
		const parsed = parseObsidianEmbedSpec(embedSpec);
		const file = resolveObsidianEmbedFile(parsed.linkPath);
		if (file && typeof ctx.app?.vault?.getResourcePath === "function") {
			// file est un TAbstractFile (peut être un TFolder si getAbstractFileByPath
			// a résolu un dossier) : le JS original ne vérifiait jamais instanceof TFile
			// avant d'appeler getResourcePath — comportement runtime préservé tel quel.
			const src = ctx.app.vault.getResourcePath(file as TFile);
			const widthAttr = parsed.width ? ` width="${parsed.width}"` : "";
			const heightAttr = parsed.height ? ` height="${parsed.height}"` : "";
			const altAttr = escapeHtmlAttr(parsed.alt || file.name || "Image");
			return `<div class="${wrapClass}"><img class="${imgClass}" src="${src}" alt="${altAttr}" loading="eager"${widthAttr}${heightAttr}></div>`;
		}
		return `<code>${escapeHtmlText(`![[${embedSpec}]]`)}</code>`;
	}

	function renderTextWithEmbeds(raw: unknown, { wrapClass = "quiz-question-embed-wrap", imgClass = "quiz-question-embed" }: EmbedClassOptions = {}): string {
		const text = String(raw ?? "");
		const embedRe = /!\[\[([^\]]+)\]\]/g;

		let html = "";
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = embedRe.exec(text)) !== null) {
			const before = text.slice(lastIndex, match.index);

			if (before) {
				html += inlineMarkdown(restoreAllowedInlineTags(
					escapeHtmlText(before).replace(/\n/g, "<br>")
				));
			}

			html += buildEmbedImgHtml(match[1], { wrapClass, imgClass });
			lastIndex = match.index + match[0].length;
		}

		const tail = text.slice(lastIndex);

		if (tail) {
			html += inlineMarkdown(restoreAllowedInlineTags(
				escapeHtmlText(tail).replace(/\n/g, "<br>")
			));
		}

		return html;
	}

	function renderHintWithCodeAndEmbeds(raw: unknown): string {
		return renderTextWithEmbeds(raw, {
			wrapClass: "quiz-hint-embed-wrap",
			imgClass: "quiz-hint-embed"
		});
	}

	function renderRawHtmlWithEmbeds(raw: unknown, { wrapClass = "quiz-question-embed-wrap", imgClass = "quiz-question-embed" }: EmbedClassOptions = {}): string {
		return renderTextWithEmbeds(raw, { wrapClass, imgClass });
	}

	/**
	 * Le chemin d'affichage des champs `*Html` (énoncé, explication, leçon,
	 * support). C'est LE point de passage de tout HTML pré-rendu vers le DOM —
	 * d'où le passage par `sanitizeQuizHtml` ici, et non chez chacun des six
	 * appelants qui l'oubliaient tous (engine/cards.ts, passage.ts,
	 * text-only.ts).
	 *
	 * Ce HTML n'est pas forcément celui d'Ahmed : un quiz PARTAGÉ arrive avec
	 * les `explainHtml` de son auteur, et il est inséré par `innerHTML`, hors
	 * de portée du filtre d'Obsidian (le bloc est traité par ce plugin, pas par
	 * le rendu markdown). Sans cette passe, un `<img src=x onerror=…>` glissé
	 * dans une explication s'exécutait avec les droits d'Obsidian.
	 *
	 * L'ordre compte : on assainit AVANT de remplacer les `![[…]]`, pour que
	 * les `<img>` que cette fonction fabrique elle-même — les seuls en qui on
	 * ait confiance — ne repassent pas devant le filtre.
	 */
	function replaceObsidianEmbedsInHtml(html: unknown, { wrapClass = "quiz-explain-embed-wrap", imgClass = "quiz-explain-embed" }: EmbedClassOptions = {}): string {
		// NE PAS faire unescapeHtmlText ici car cela casserait l'affichage
		// des entités HTML comme &gt; qui doivent rester comme &gt; pour être
		// affichées comme > par le navigateur, pas interprétées comme des balises
		const content = sanitizeQuizHtml(html);
		return content.replace(/!\[\[([^\]]+)\]\]/g, (_: string, spec: string) => buildEmbedImgHtml(spec, { wrapClass, imgClass }));
	}

	return {
		escapeHtmlAttr,
		escapeHtmlText,
		unescapeHtmlText,
		isSafeQuizUrl,
		unwrapQuizHtmlElement,
		sanitizeQuizHtml,
		renderInlineQuizHtml,
		resourceButtonHtml,
		resolveObsidianEmbedFile,
		parseObsidianEmbedSpec,
		buildEmbedImgHtml,
		restoreAllowedInlineTags,
		renderInlineText,
		stripInlineMarkdown,
		renderTextWithEmbeds,
		renderHintWithCodeAndEmbeds,
		renderRawHtmlWithEmbeds,
		replaceObsidianEmbedsInHtml
	};
}
