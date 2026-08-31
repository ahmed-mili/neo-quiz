/**
 * Non-régression du RENOMMAGE de mode `learn` → `lesson` (task 0 du lot mode
 * leçon, 2026-08-31).
 *
 * La règle, non négociable : on LIT les deux noms, on n'ÉCRIT plus que
 * `lesson`. Un quiz partagé écrit avec l'ancien nom (`mode: 'learn'`,
 * `learnMode: true`) doit continuer de fonctionner indéfiniment — c'est
 * `normalizeQuizMode`/`extractExamOptions` (quiz-utils.ts) qui portent cette
 * garantie, et c'est ce script qui l'éprouve sur le CODE RÉEL (pas une
 * réplique, qui finirait par diverger et valider le vide).
 *
 *     npm run check:lesson
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/quiz-utils.ts", ({ parseQuizSource, extractExamOptions }) => {
	const r = makeReporter("Renommage lesson");
	const modeOf = (source) => extractExamOptions(parseQuizSource(source)).quizMode;

	// Le mode hérité est lu et normalisé.
	r.check("mode 'learn' normalise en 'lesson'", modeOf(`[{ mode: "learn" }]`), "lesson");
	r.check("raccourci learnMode normalise en 'lesson'", modeOf(`[{ learnMode: true }]`), "lesson");

	// Le nom canonique est lu tel quel.
	r.check("mode 'lesson' lu tel quel", modeOf(`[{ mode: "lesson" }]`), "lesson");

	// La casse ne doit pas ouvrir une porte : "Lesson" n'est pas un mode. La
	// tolérance à la casse ne vaut que pour l'ALIAS hérité ("Learn" reste
	// reconnu, cf. check-export.mjs "mode a la casse tolerante") — le nom
	// canonique, lui, doit être écrit exactement pour être reconnu.
	r.check("'Lesson' (casse) n'est pas un mode reconnu", modeOf(`[{ mode: "Lesson" }]`) !== "lesson", true);

	r.done();
});
