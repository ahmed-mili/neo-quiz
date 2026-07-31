/**
 * Non-régression du rendu markdown des champs texte du moteur.
 *
 * Le projet n'a pas de framework de test, et n'en veut pas. Cette logique-ci
 * fait exception : elle décide, sur du texte écrit par un modèle ou à la main,
 * ce qui devient du gras et ce qui reste une multiplication. Elle s'est déjà
 * trompée sur `3*4*5`, sur un chemin Windows, sur un prix en dollars et sur
 * une multiplication en lettres grecques — des cas qu'aucune relecture
 * n'attrape à l'œil.
 *
 * La VRAIE fonction est chargée (scripts/lib/load-src.mjs) plutôt que
 * recopiée : une réplique finirait par diverger de l'originale.
 *
 *     npm run check:md
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const BS = "\\";      // un antislash littéral
const DOL = "\\$";    // un dollar échappé en markdown

/** [nom, entrée, sortie attendue] */
const CAS = [
	["gras", "Le **DNS** traduit un nom", "Le <strong>DNS</strong> traduit un nom"],
	["italique", "(*Time To Live*) est un compteur", "(<em>Time To Live</em>) est un compteur"],
	["code", "le domaine nu `efrei.fr` pointe", "le domaine nu <code>efrei.fr</code> pointe"],
	["gras + italique", "**MX** (*Mail eXchanger*)", "<strong>MX</strong> (<em>Mail eXchanger</em>)"],
	["gras italique (triple)", "un ***point capital*** ici", "un <strong><em>point capital</em></strong> ici"],
	["barré", "le port ~~25~~ 587", "le port <del>25</del> 587"],

	// Ce qui ne doit PAS être interprété.
	["formule LaTeX intacte", "on compte : $128 - TTL_{reçu}$.", "on compte : $128 - TTL_{reçu}$."],
	["étoile dans une formule", "aire $a*b*c$ finale", "aire $a*b*c$ finale"],
	["multiplication espacée", "calcule 3 * 4 * 5 ici", "calcule 3 * 4 * 5 ici"],
	["multiplication collée", "calcule 3*4*5 ici", "calcule 3*4*5 ici"],
	["chemin Windows à jokers",
		"ouvre C:" + BS + "Users" + BS + "*" + BS + "AppData" + BS + "*" + BS + "Cache",
		"ouvre C:" + BS + "Users" + BS + "*" + BS + "AppData" + BS + "*" + BS + "Cache"],
	["dollars échappés (prix)",
		"Prix " + DOL + "5 et **promo** à " + DOL + "10",
		"Prix " + DOL + "5 et <strong>promo</strong> à " + DOL + "10"],
	["gras à l'intérieur d'un code", "tape `a**b**c` pour voir", "tape <code>a**b**c</code> pour voir"],
	["étoile isolée", "note * importante", "note * importante"],

	// Échappement HTML : rien de ce que l'utilisateur écrit ne devient une balise.
	["chevrons échappés", "si a < b alors <script>", "si a &lt; b alors &lt;script&gt;"],
	["apostrophe", "d'où mon contournement", "d&#39;où mon contournement"],
	["préfixe PowerShell", "tape PS> echo $env:PATH ici", "tape PS&gt; echo $env:PATH ici"],

	// Formes limites.
	["code à double accent grave", "tape ``a ` b`` ici", "tape <code>a ` b</code> ici"],
	["deux gras dans la phrase", "**A** puis **B**", "<strong>A</strong> puis <strong>B</strong>"],
	["gras en début de chaîne", "**Attention** ici", "<strong>Attention</strong> ici"],
	["italique après parenthèse", "(*ainsi*)", "(<em>ainsi</em>)"],
	["gras multi-mots avec ponctuation",
		"**séparer les services d'un même domaine** (le A)",
		"<strong>séparer les services d&#39;un même domaine</strong> (le A)"],
	["flèche unicode", "*nom → adresse IPv4*", "<em>nom → adresse IPv4</em>"],
	["chaîne vide", "", ""],

	// Constats de la revue codex du 2026-07-31.
	["multiplication en lettres grecques", "on calcule α*β*γ ici", "on calcule α*β*γ ici"],
	["multiplication en ideogrammes", "produit 甲*乙*丙 final", "produit 甲*乙*丙 final"],
	["multiplication en arabe", "resultat س*ص*ع voila", "resultat س*ص*ع voila"],
	["quatre etoiles ne sont pas de l emphase", "voir ****ceci**** ici", "voir ****ceci**** ici"],
	["emphase imbriquee", "**fort *italique* ici**", "<strong>fort <em>italique</em> ici</strong>"],
];

await withSrcModule("src/engine/sanitizer.ts", ({ renderInlineText }) => {
	const r = makeReporter("Markdown");
	for (const [nom, entree, attendu] of CAS) r.check(nom, renderInlineText(entree), attendu);
	r.done();
});

/* Texte à trous : une paire markdown qui ENJAMBE un trou doit rester une
   paire. Rendre chaque segment séparément laissait « `git ` » et « ` -b` »
   avec un accent grave chacun, tous deux affichés bruts. */
await withSrcModule("src/engine/cloze.ts", ({ markSlots, fillSlots }) => {
	const r = makeReporter("Trous");

	const rendu = (gabarit) => {
		const { marked, blanks } = markSlots(gabarit);
		// Le vrai rendu passe par le sanitizer ; ici on vérifie seulement que
		// le marquage laisse le gabarit d'un seul tenant et que les jetons se
		// remplacent tous.
		return { marked, n: blanks.length, rempli: fillSlots(marked, (i) => "[" + i + "]") };
	};

	r.check("un trou", rendu("La capitale est {{Paris}}.").rempli, "La capitale est [0].");
	r.check("deux trous", rendu("{{a}} puis {{b}}").rempli, "[0] puis [1]");
	r.check("trou vide non compté", rendu("rien {{}} ici").n, 0);
	r.check("trou vide laissé littéral", rendu("rien {{}} ici").rempli, "rien {{}} ici");
	r.check("variantes comptées une fois", rendu("{{l'euro|euro}}").n, 1);
	r.check("code enjambant un trou — gabarit d'un seul tenant",
		rendu("tape `git {{checkout}} -b` ici").marked.includes("`git "), true);
	r.check("code enjambant un trou — un seul segment",
		rendu("tape `git {{checkout}} -b` ici").rempli, "tape `git [0] -b` ici");
	r.check("gras enjambant un trou",
		rendu("**avant {{x}} apres**").rempli, "**avant [0] apres**");

	/* Le jeton doit survivre a un aller-retour `innerHTML` : l apercu passe par
	   le DOM (resolveImagesInHtml), et un marqueur fait de caracteres NULS y
	   etait remplace — « CLOZE0 » s affichait alors en toutes lettres. */
	const { marked } = markSlots("ping {{8.8.8.8}} -t");
	r.check("jeton hors du plan de base (zone privee)",
		[...marked].some(c => c.charCodeAt(0) >= 0xE000 && c.charCodeAt(0) <= 0xE001), true);
	r.check("jeton sans caractere NUL",
		marked.includes(String.fromCharCode(0)), false);
	r.check("jeton sans lettres lisibles",
		/CLOZE/.test(marked), false);

	r.done();
});
