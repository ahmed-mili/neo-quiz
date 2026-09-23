/**
 * Le FORMAT Learn / Practice, lu par le module réel `src/quiz-format.ts`.
 *
 * Ce qu'il empêche : un Practice sans explication, un Learn dont une
 * tranche n'a pas sa pré-question, sa lecture ou ses rappels, un `slice` qui
 * ne pointe nulle part — tous acceptés sans un mot jusqu'ici ; et un ancien
 * bloc `mode: "exam"` pris pour un Learn. Un manque est SIGNALÉ, jamais un
 * échec : la vérification rend une liste, elle ne lève rien.
 *
 *     npm run check:quiz-format
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/quiz-format.ts", ({ modeDuBloc, verifierFormat, planDesTranches, lireBlocQuiz }) => {
	const r = makeReporter("Format Learn / Practice");
	const q = (o) => ({ title: "Q", prompt: "Énoncé ?", options: ["a", "b"], correctIndex: 0, explain: "Parce que.", ...o });

	r.check("bloc sans objet de mode = Practice", modeDuBloc([q()]), "practice");
	r.check("objet { mode: \"learn\" } = Learn", modeDuBloc([q(), { mode: "learn", objectives: ["x"] }]), "learn");
	r.check("modes hérités exam, lesson, examMode, learnMode = Practice",
		[{ mode: "exam" }, { mode: "lesson" }, { examMode: true }, { learnMode: true }].map(c => modeDuBloc([q(), c])),
		["practice", "practice", "practice", "practice"]);

	r.check("Practice complet : aucun manque", verifierFormat("practice", [q(), q({ title: "R" })]), []);
	r.check("Practice : les questions sans explication sont nommées",
		verifierFormat("practice", [q({ title: "Listes", explain: "" }), q({ title: "Tuples", explain: undefined, explainHtml: "<p>ok</p>" }), q({ title: "Sets", explain: "  " })]),
		[{ kind: "sansExplication", questions: ["Listes", "Sets"] }]);
	r.check("Practice : une tranche absente du Learn est signalée",
		verifierFormat("practice", [q({ title: "A", slice: 1 }), q({ title: "B", slice: 9 }), q({ title: "C" })], [1, 2, 3]),
		[{ kind: "trancheInconnue", questions: ["B"] }]);
	r.check("Practice sans Learn connu : slice non vérifié", verifierFormat("practice", [q({ slice: 9 })]), []);

	const tranche = (s) => [
		q({ title: `pre${s}`, slice: s, role: "pre" }),
		{ title: `Lecture ${s}`, prompt: "Passage.", slice: s, role: "read" },
		{ title: `expl${s}`, prompt: "Explique.", type: "text", answer: "Modèle.", slice: s, role: "explain" },
		q({ title: `rec${s}`, slice: s, role: "recall" }),
	];
	const config = { mode: "learn", objectives: ["Définir une liste"] };
	r.check("Learn complet : aucun manque", verifierFormat("learn", [...tranche(1), ...tranche(2), config]), []);
	r.check("Learn : tranche sans lecture ni rappel, question hors tranche, objectifs absents",
		verifierFormat("learn", [q({ title: "pre1", slice: 1, role: "pre" }), q({ title: "Orpheline" }), ...tranche(2), { mode: "learn" }]),
		[
			{ kind: "sansObjectifs" },
			{ kind: "sansTranche", questions: ["Orpheline"] },
			{ kind: "trancheIncomplete", slice: 1, rolesManquants: ["read", "recall"] },
		]);

	r.check("plan des tranches : titre de la lecture, sinon de la première question, trié",
		planDesTranches([q({ title: "pre2", slice: 2, role: "pre" }), ...tranche(1), q({ title: "x", slice: 2, role: "recall" }), config]),
		[{ slice: 1, titre: "Lecture 1" }, { slice: 2, titre: "pre2" }]);
	r.check("plan des tranches d'une entrée invalide : vide",
		[planDesTranches([]), planDesTranches([null, 3, "x"])], [[], []]);

	r.check("lireBlocQuiz lit le premier bloc",
		lireBlocQuiz("# T\n\n```quiz-blocks\n[{ title: 'A', prompt: 'B' }]\n```\n"), [{ title: "A", prompt: "B" }]);
	r.check("lireBlocQuiz : note sans bloc ou JSON5 cassé → null",
		[lireBlocQuiz("rien"), lireBlocQuiz("```quiz-blocks\n[{ title: \n```")], [null, null]);
	r.done();
});
