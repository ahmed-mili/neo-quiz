/**
 * Vérification du catalogue léger produit par le scanner.
 *
 * Le scheduler dépend de clés strictement identiques à celles de l'éditeur :
 * un test d'intégration du vrai scanner protège le câblage, là où tester
 * assignQuestionIds une seconde fois ne prouverait pas que le scanner l'appelle.
 *
 *     node scripts/check-scanner.mjs
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/scanner.ts", async ({ createScanner }) => {
	const r = makeReporter("Scanner — références des questions");
	const file = {
		path: "Cours/reseau.md",
		basename: "reseau",
		extension: "md",
		stat: { mtime: 1 },
	};
	let content = [
		"Avant le quiz",
		"```quiz-blocks fold",
		"[",
		"  { mode: 'lesson', source: '[[Cours]]' },",
		"  { id: 'dup', title: 'Premiere', prompt: 'Q1', role: 'pre', slice: 1 },",
		"  { id: 'dup', title: 'Deuxieme', prompt: 'Q2', role: 23, slice: '2' },",
		"  { id: 'dup-2', title: 'Troisieme', prompt: 'Q3', role: 'read', slice: 2 },",
		"  { id: '   ', title: 'Fallback Title', prompt: 'Q4', role: 'custom', slice: 0 },",
		"  { id: 42, title: 'Numeric Id', prompt: 'Q5', role: null, slice: -1 },",
		"]",
		"  ```",
		"Apres le quiz",
	].join("\r\n");
	const app = {
		vault: {
			getMarkdownFiles: () => [file],
			cachedRead: async () => content,
			on: () => ({}),
			offref: () => undefined,
		},
	};
	const scanner = createScanner(app);

	await scanner.scanVault();
	const entry = scanner.getQuiz(file.path);

	/* La configuration n'est pas une question : les cinq références ci-dessous
	   correspondent donc directement aux cinq objets qui la suivent. */
	r.check("une fence CRLF indentée est indexée sans compter la configuration",
		entry?.questions, 5);
	/* Calcul manuel : dup prend sa clé ; le second dup évite dup déjà attribué
	   ET dup-2 réservé plus bas, donc devient dup-3 ; dup-2 garde ensuite sa
	   propre réservation. Les deux identifiants malformés retombent sur les
	   slugs ASCII de leurs titres. */
	r.check("identités, rôles et tranches sont retenus dans l'ordre",
		entry?.items, [
			{ id: "dup", role: "pre", slice: 1 },
			{ id: "dup-3" },
			{ id: "dup-2", role: "read", slice: 2 },
			{ id: "fallback-title", role: "custom", slice: 0 },
			{ id: "numeric-id", slice: -1 },
		]);
	r.check("un rôle non textuel n'est pas matérialisé par une propriété vide",
		Object.prototype.hasOwnProperty.call(entry?.items?.[1] ?? {}, "role"), false);
	r.check("une tranche non numérique n'est pas matérialisée par une propriété vide",
		Object.prototype.hasOwnProperty.call(entry?.items?.[1] ?? {}, "slice"), false);

	const notifications = [];
	scanner.onChange(quizzes => notifications.push(quizzes));
	// Seules les données du catalogue changent : le nombre et le type restent identiques.
	content = content.replace("role: 'pre', slice: 1", "role: 'recall', slice: 9");
	await scanner.scanFile(file);

	r.check("un changement de référence déclenche onChange", notifications.length, 1);
	r.check("onChange expose immédiatement les nouvelles données",
		notifications[0]?.[0]?.items?.[0], { id: "dup", role: "recall", slice: 9 });

	r.done();
});
