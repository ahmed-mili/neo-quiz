/* ══════════════════════════════════════════════════════════
   LE LaTeX DONNÉ À MATHLIVE — module PUR

   Le greffon rend les formules avec MathJax, l'application avec MathLive
   (`./math.ts`). Les quiz sont écrits pour le premier : une commande amsmath
   que MathJax connaît et que MathLive ignore s'affiche dans l'application en
   ERREUR, en rouge, au milieu de l'énoncé (test du 2026-09-23 : `\dots` dans
   un quiz de suites généré). On ne réécrit pas la note — elle reste juste pour
   Obsidian — : on traduit au moment du rendu, vers l'équivalent que MathLive
   connaît. Audit des quiz des vaults au 2026-09-23 (476 formules) : `\dots`
   est la seule commande refusée.
══════════════════════════════════════════════════════════ */

/** Les points de suspension d'amsmath : `\dots` (et `\dotsc`, `\dotso`)
    sont des points en bas, `\dotsb`, `\dotsm`, `\dotsi` des points centrés
    (entre opérateurs binaires, produits, intégrales). */
const POINTS: Record<string, string> = {
	dots: "\\ldots",
	dotsc: "\\ldots",
	dotso: "\\ldots",
	dotsb: "\\cdots",
	dotsm: "\\cdots",
	dotsi: "\\cdots",
};

export function latexPourMathLive(latex: string): string {
	return latex.replace(/\\(dots[bcimo]?)(?![a-zA-Z])/g, (tout, nom: string) => POINTS[nom] ?? tout);
}
