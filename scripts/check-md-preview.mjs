/**
 * L'APERÇU D'UNE NOTE — le rendu par blocs (`src/markdown-preview.ts`), pur.
 *
 * Ce que ce script tient, dans l'ordre de gravité :
 * 1. la SÉCURITÉ : une note joint le composer depuis un vault ou un fichier
 *    reçu ; son HTML ne s'exécute jamais. `<script>`, un `onerror`, un lien
 *    `javascript:` ressortent en TEXTE ou en rien ;
 * 2. la GRAMMAIRE : titres, listes imbriquées, cases à cocher, encadrés
 *    (callouts) typés, citations, tableaux, blocs de code littéraux, règles,
 *    propriétés en tête — ce qu'une note de cours d'Ahmed contient ;
 * 3. l'INLINE : il passe par `renderInlineText` (la première porte) — gras,
 *    code, LaTeX gardé pour l'hôte —, plus les liens et les wikilinks.
 *
 *     npm run check:md-preview
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/markdown-preview.ts", async ({ renderMarkdownPreview }) => {
	const r = makeReporter("Aperçu d'une note — rendu par blocs");
	const md = renderMarkdownPreview;

	/* ── Sécurité d'abord ── */
	const hostile = md("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[clic](javascript:alert(1))");
	r.check("un <script> ressort échappé, jamais exécutable", hostile.includes("&lt;script&gt;") && !hostile.includes("<script"), true);
	r.check("un <img onerror> ressort échappé", !/<img/.test(hostile), true);
	r.check("un lien javascript: ne devient PAS un lien", !/href="javascript/.test(hostile), true);
	r.check("un lien https: en devient un, en nouvel onglet, sans opener",
		md("[docs](https://docs.python.org/3/)"),
		'<p><a class="mdp-link" href="https://docs.python.org/3/" target="_blank" rel="noopener">docs</a></p>');

	/* ── Les blocs ── */
	r.check("les titres", md("# Un\n## Deux\n### Trois"), "<h1>Un</h1><h2>Deux</h2><h3>Trois</h3>");
	r.check("un paragraphe garde ses retours à la ligne, comme Obsidian",
		md("ligne 1\nligne 2\n\nautre"), "<p>ligne 1<br>ligne 2</p><p>autre</p>");
	r.check("une liste à deux niveaux",
		md("- a\n  - b\n- c"), "<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
	r.check("une liste numérotée", md("1. un\n2. deux"), "<ol><li>un</li><li>deux</li></ol>");
	r.check("les cases à cocher, faite et à faire",
		md("- [x] fait\n- [ ] à faire"),
		'<ul><li><span class="mdp-task is-done"><span class="mdp-task-box"></span>fait</span></li><li><span class="mdp-task"><span class="mdp-task-box"></span>à faire</span></li></ul>');
	r.check("un encadré typé, avec son titre et son corps rendu",
		md("> [!cours] Cours\n> - [CM1](https://x.y/cm1.pdf)"),
		'<div class="mdp-callout" data-type="cours"><div class="mdp-callout-title">Cours</div><div class="mdp-callout-body"><ul><li><a class="mdp-link" href="https://x.y/cm1.pdf" target="_blank" rel="noopener">CM1</a></li></ul></div></div>');
	r.check("un encadré sans titre prend son type, capitalisé",
		md("> [!warning]\n> Attention").includes('<div class="mdp-callout-title">Warning</div>'), true);
	r.check("une citation ordinaire", md("> une phrase"), "<blockquote><p>une phrase</p></blockquote>");
	r.check("un bloc de code est LITTÉRAL — pas d'emphase, pas de titre dedans",
		md("```py\n# pas un titre\n**pas gras**\n```"),
		'<pre class="mdp-code" data-lang="py"><code># pas un titre\n**pas gras**</code></pre>');
	r.check("un tableau", md("| a | b |\n|---|---|\n| 1 | 2 |"),
		'<table class="mdp-table"><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
	r.check("une règle", md("avant\n\n---\n\naprès"), "<p>avant</p><hr><p>après</p>");
	r.check("les propriétés en tête, clé et valeur, listes comprises",
		md("---\ntitle: XTI301\ntags:\n  - efrei\n---\n# Titre"),
		'<div class="mdp-frontmatter"><div class="mdp-prop"><span class="mdp-prop-key">title</span><span class="mdp-prop-value">XTI301</span></div><div class="mdp-prop"><span class="mdp-prop-key">tags</span><span class="mdp-prop-value"></span></div><div class="mdp-prop mdp-prop--item"><span class="mdp-prop-key"></span><span class="mdp-prop-value">efrei</span></div></div><h1>Titre</h1>');
	r.check("un `---` qui n'est PAS en tête est une règle, pas des propriétés",
		md("texte\n---\nsuite").includes("<hr>"), true);

	/* ── L'inline, par la première porte ── */
	r.check("gras, code et LaTeX gardé", md("**gras** et `code` et $x^2$"),
		"<p><strong>gras</strong> et <code>code</code> et $x^2$</p>");
	r.check("un wikilink avec alias", md("[[XTI301 - Python|le cours]]"), '<p><span class="mdp-wikilink">le cours</span></p>');
	r.check("un embed devient un jeton, jamais une image chargée", md("![[schema.png]]"), '<p><span class="mdp-embed">schema.png</span></p>');

	r.done();
});
