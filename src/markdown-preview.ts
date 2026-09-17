import { renderInlineText } from "./engine/sanitizer";

/* ══════════════════════════════════════════════════════════
   L'APERÇU D'UNE NOTE MARKDOWN — un rendu par BLOCS, sûr

   Demande d'Ahmed (2026-09-17) : « un vrai preview pour les md », et non le
   texte brut en `<pre>`. Ce module rend une note comme Obsidian la montre en
   lecture — titres, listes, cases à cocher, citations et encadrés (callouts),
   blocs de code, tableaux, règles, propriétés en tête — sans prétendre à la
   complétude d'un lecteur markdown : ce qu'il ne reconnaît pas reste un
   paragraphe, lisible.

   LA PORTE. Tout le texte passe par `renderInlineText` (`engine/sanitizer.ts`,
   première porte de la table du CLAUDE.md : « du texte, dans du HTML ») — il
   ÉCHAPPE d'abord, puis pose l'emphase, le code et garde le LaTeX. Les seules
   balises de ce fichier sont celles qu'il écrit lui-même ; un `<script>` dans
   la note ressort en texte. Les liens n'ouvrent que `http(s)`, `mailto:` et
   `obsidian:` ; tout autre schéma redevient du texte.

   PUR : pas de DOM, une chaîne entre, une chaîne sort. `npm run
   check:md-preview` l'éprouve, par discriminance.
══════════════════════════════════════════════════════════ */

function esc(texte: string): string {
	return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* Les liens, APRÈS le rendu inline (qui a déjà échappé le texte) : l'URL est
   relue dans le HTML échappé — un `&` y est déjà `&amp;`, ce qui convient à un
   attribut. Le texte du lien peut porter l'emphase que l'inline a posée. */
const LIEN_MD = /\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|obsidian:\/\/[^)\s]+)\)/g;
const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
const EMBED = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const IMAGE_MD = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
/* Tout lien qui n'a pas été absorbé par `LIEN_MD` ou `IMAGE_MD` ci-dessus :
   fichier relatif, chemin local, image locale. L'aperçu ne peut ouvrir aucun
   de ces cas (pas de vault, pas de disque) ; il rend le TEXTE du lien seul —
   des crochets bruts se liraient mal, et un lien mort serait un mensonge. Le
   `!` optionnel avale l'image locale AVEC sa syntaxe : `![schéma](img.png)`
   rend « schéma », jamais « !schéma ». */
const LIEN_AUTRE = /!?\[([^\]]+)\]\(([^)]+)\)/g;

function inline(texte: string): string {
	let html = renderInlineText(texte);
	html = html.replace(EMBED, (_m, cible: string) => `<span class="mdp-embed">${cible}</span>`);
	html = html.replace(IMAGE_MD, (_m, alt: string, url: string) => `<a class="mdp-link" href="${url}" target="_blank" rel="noopener">${alt || url}</a>`);
	html = html.replace(WIKILINK, (_m, cible: string, alias: string | undefined) => `<span class="mdp-wikilink">${(alias ?? cible).trim()}</span>`);
	html = html.replace(LIEN_MD, (_m, texteLien: string, url: string) => `<a class="mdp-link" href="${url}" target="_blank" rel="noopener">${texteLien}</a>`);
	html = html.replace(LIEN_AUTRE, (_m, texteLien: string) => texteLien);
	return html;
}

/** Le bloc de propriétés en tête (`---` … `---`), rendu ligne à ligne :
    `clé: valeur`, et les listes YAML (`- x`) en pastilles sous leur clé. Sans
    analyser le YAML — ce n'est pas un lecteur de configuration, c'est une
    vitrine. */
function proprietes(lignes: string[]): string {
	const rangees: { cle: string; valeur: string; items: string[] }[] = [];
	for (const l of lignes) {
		const kv = l.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (kv) { rangees.push({ cle: kv[1], valeur: kv[2], items: [] }); continue; }
		const item = l.match(/^\s+-\s+(.*)$/);
		if (item && rangees.length) rangees[rangees.length - 1].items.push(item[1]);
	}
	const html = rangees.map(r => {
		const valeur = r.items.length
			? r.items.map(i => `<span class="mdp-pill">${esc(i)}</span>`).join("")
			: esc(r.valeur);
		return `<div class="mdp-prop"><span class="mdp-prop-key">${esc(r.cle)}</span><span class="mdp-prop-value">${valeur}</span></div>`;
	}).join("");
	// MASQUÉES par défaut (demande Ahmed 2026-09-17) : la page pose un bouton
	// qui retire `hidden`.
	return `<div class="mdp-frontmatter" hidden>${html}</div>`;
}

/* Les icônes d'Obsidian par type (docs « Callouts › Supported types »). Un
   type inconnu prend `pencil`, comme là-bas. */
const ICONES_CALLOUT: Record<string, string> = {
	note: "pencil", abstract: "clipboard-list", summary: "clipboard-list", tldr: "clipboard-list",
	info: "info", todo: "check-circle-2", tip: "flame", hint: "flame", important: "flame",
	success: "check", check: "check", done: "check", question: "help-circle", help: "help-circle", faq: "help-circle",
	warning: "alert-triangle", caution: "alert-triangle", attention: "alert-triangle",
	failure: "x", fail: "x", missing: "x", danger: "zap", error: "zap", bug: "bug", example: "list", quote: "quote", cite: "quote",
};

/** Un encadré (callout), au DOM d'Obsidian : `.callout[data-callout]`, sa
    barre de titre avec icône, son contenu — repris tel quel pour que le style
    de l'app reproduise fidèlement celui d'un callout Obsidian. */
function callout(type: string, titre: string, corpsHtml: string): string {
	const t = type.toLowerCase();
	// `Object.hasOwn` n'existe qu'en ES2022 (cible ES2020 ici) : même garde que
	// `text-only.ts`, via `hasOwnProperty.call` — un type nommé comme un membre
	// hérité (`constructor`, `toString`) ne doit jamais retourner ce membre.
	const icone = Object.prototype.hasOwnProperty.call(ICONES_CALLOUT, t) ? ICONES_CALLOUT[t] : "pencil";
	return `<div class="callout" data-callout="${esc(t)}"><div class="callout-title"><div class="callout-icon" data-icon="${icone}"></div><div class="callout-title-inner">${titre}</div></div><div class="callout-content">${corpsHtml}</div></div>`;
}

interface Item { indent: number; ordered: boolean; html: string }

/** Une liste (à un ou plusieurs niveaux, par l'indentation) en `<ul>`/`<ol>`. */
function liste(items: Item[]): string {
	let html = "";
	const pile: { indent: number; ordered: boolean }[] = [];
	const fermer = (jusquA: number) => {
		while (pile.length > jusquA) { html += pile.pop()!.ordered ? "</li></ol>" : "</li></ul>"; }
	};
	for (const it of items) {
		while (pile.length > 0 && it.indent < pile[pile.length - 1].indent) fermer(pile.length - 1);
		if (pile.length === 0 || it.indent > pile[pile.length - 1].indent) {
			html += it.ordered ? "<ol>" : "<ul>";
			pile.push({ indent: it.indent, ordered: it.ordered });
		} else {
			html += "</li>";
		}
		html += `<li>${it.html}`;
	}
	fermer(0);
	return html;
}

function tableau(lignes: string[]): string {
	const cellules = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => inline(c.trim()));
	const tete = cellules(lignes[0]);
	const corps = lignes.slice(2).map(l => `<tr>${cellules(l).map(c => `<td>${c}</td>`).join("")}</tr>`).join("");
	return `<table class="mdp-table"><thead><tr>${tete.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${corps}</tbody></table>`;
}

/** Le HTML d'une note. `lignes` de texte brut → blocs. */
export function renderMarkdownPreview(texte: string): string {
	const lignes = String(texte ?? "").replace(/\r\n?/g, "\n").split("\n");
	const out: string[] = [];
	let i = 0;

	// Les propriétés, seulement en TÊTE de note.
	if (lignes[0]?.trim() === "---") {
		const fin = lignes.indexOf("---", 1);
		if (fin > 0) { out.push(proprietes(lignes.slice(1, fin))); i = fin + 1; }
	}

	let paragraphe: string[] = [];
	const viderParagraphe = () => {
		if (paragraphe.length === 0) return;
		out.push(`<p>${paragraphe.map(inline).join("<br>")}</p>`);
		paragraphe = [];
	};

	while (i < lignes.length) {
		const l = lignes[i];
		const nu = l.trim();

		if (nu === "") { viderParagraphe(); i++; continue; }

		// Bloc de code : littéral jusqu'à la clôture (ou la fin de la note).
		const fence = nu.match(/^(```|~~~)\s*([\w+-]*)/);
		if (fence) {
			viderParagraphe();
			const code: string[] = [];
			i++;
			while (i < lignes.length && !lignes[i].trim().startsWith(fence[1])) { code.push(lignes[i]); i++; }
			i++;
			const lang = fence[2] ? ` data-lang="${esc(fence[2])}"` : "";
			out.push(`<pre class="mdp-code"${lang}><code>${esc(code.join("\n"))}</code></pre>`);
			continue;
		}

		const titre = nu.match(/^(#{1,6})\s+(.*)$/);
		if (titre) { viderParagraphe(); out.push(`<h${titre[1].length}>${inline(titre[2])}</h${titre[1].length}>`); i++; continue; }

		if (/^(-{3,}|\*{3,}|_{3,})$/.test(nu)) { viderParagraphe(); out.push("<hr>"); i++; continue; }

		// Citation ou encadré (callout) : les lignes `>` contiguës, rendues
		// récursivement — un encadré contient des listes, des titres.
		if (nu.startsWith(">")) {
			viderParagraphe();
			const corps: string[] = [];
			while (i < lignes.length && lignes[i].trim().startsWith(">")) { corps.push(lignes[i].trim().replace(/^>\s?/, "")); i++; }
			const matchCallout = corps[0]?.match(/^\[!([\w-]+)\]([+-]?)\s*(.*)$/);
			if (matchCallout) {
				const type = matchCallout[1].toLowerCase();
				const titreHtml = matchCallout[3] ? inline(matchCallout[3]) : esc(type.charAt(0).toUpperCase() + type.slice(1));
				out.push(callout(type, titreHtml, renderMarkdownPreview(corps.slice(1).join("\n"))));
			} else {
				out.push(`<blockquote>${renderMarkdownPreview(corps.join("\n"))}</blockquote>`);
			}
			continue;
		}

		// Tableau : une ligne de cellules suivie d'une ligne de séparation.
		if (nu.startsWith("|") && i + 1 < lignes.length && /^\|?\s*:?-{2,}/.test(lignes[i + 1].trim())) {
			viderParagraphe();
			const rangs: string[] = [];
			while (i < lignes.length && lignes[i].trim().startsWith("|")) { rangs.push(lignes[i]); i++; }
			out.push(tableau(rangs));
			continue;
		}

		// Liste : puces, numéros, cases à cocher ; l'indentation fait le niveau.
		const item = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
		if (item) {
			viderParagraphe();
			const items: Item[] = [];
			while (i < lignes.length) {
				const m = lignes[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
				if (!m) break;
				let contenu = m[3];
				const tache = contenu.match(/^\[([ xX])\]\s+(.*)$/);
				const html = tache
					? `<span class="mdp-task${tache[1] === " " ? "" : " is-done"}"><span class="mdp-task-box"></span>${inline(tache[2])}</span>`
					: inline(contenu);
				items.push({ indent: m[1].replace(/\t/g, "  ").length, ordered: /\d/.test(m[2]), html });
				i++;
			}
			out.push(liste(items));
			continue;
		}

		paragraphe.push(l);
		i++;
	}
	viderParagraphe();
	return out.join("");
}
