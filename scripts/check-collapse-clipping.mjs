import { readFileSync } from "node:fs";

/* Le mécanisme a été EXTRAIT vers collapsible.ts le 2026-07-28 (« Mes quiz »
   et l'accueil partagent la même section repliable). Ce script lisait encore
   quizzes-render.ts et échouait donc en silence depuis : trois de ses sept
   garanties ne gardaient plus rien. */
const render = readFileSync("src/dashboard/collapsible.ts", "utf8");
const css = readFileSync("src/assets/css/dashboard/dashboard-quizzes.css", "utf8");

const checks = [
	[
		"renderCollapsibleSection crée et retourne le wrapper de clipping",
		/const body = nodeEl\.createDiv\(\{ cls: "qbd-quizzes-node-body" \}\);\s*return body\.createDiv\(\{ cls: "qbd-quizzes-node-clip" \}\);/s,
		render,
	],
	[
		"le wrapper peut se comprimer sous sa hauteur intrinsèque",
		/\.qbd-quizzes-node-clip\s*\{[^}]*min-height:\s*0;/s,
		css,
	],
	[
		"le wrapper clippe la peinture pendant l'animation et le repli",
		/\.qbd-quizzes-node\.is-collapsed \.qbd-quizzes-node-clip,\s*\.qbd-quizzes-node\.is-animating \.qbd-quizzes-node-clip\s*\{[^}]*overflow:\s*clip;/s,
		css,
	],
	[
		"l'animation promeut le contenu sur son propre layer compositeur",
		/\.qbd-quizzes-node\.is-animating \.qbd-quizzes-node-clip\s*\{[^}]*will-change:\s*transform;/s,
		css,
	],
	[
		"l'état replié STABLE ne peint rien (visibility hidden hors animation)",
		/\.qbd-quizzes-node\.is-collapsed:not\(\.is-animating\) \.qbd-quizzes-node-clip\s*\{[^}]*visibility:\s*hidden;/s,
		css,
	],
	[
		"chaque clic purge le filet et le listener du cycle précédent",
		/window\.clearTimeout\(animTimer\);\s*offEnd\?\.\(\);/s,
		render,
	],
	[
		"le transitionend écouté est celui du corps lui-même (pas un descendant)",
		/te\.target !== body \|\| te\.propertyName !== "grid-template-rows"/s,
		render,
	],
];

const failed = checks.filter(([, pattern, source]) => !pattern.test(source));
if (failed.length) {
	for (const [label] of failed) console.error(`FAIL: ${label}`);
	process.exit(1);
}
console.log("PASS: contrat de clipping du repli");
