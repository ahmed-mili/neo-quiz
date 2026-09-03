/**
 * Vérifie que le moteur journalise correctement pour l'ordonnanceur (Task 8).
 *
 * Charge le VRAI `createStateHandlers` (engine/state.ts) et le VRAI
 * `assignQuestionIds` (quiz-ids.ts), avec un `ctx` minimal mais réel — même
 * câblage croisé que `engine.ts` (`Object.assign(ctx, { hasAnyAnswer:
 * state.hasAnyAnswer, ... })`). Aucun DOM n'est nécessaire : `goToResults`
 * n'atteint jamais `render()`/l'animation de piste tant que la slide cible
 * est déjà la slide courante (`goToSlide` retourne avant tout `await`) — les
 * tests placent donc `quizState.current` sur `SLIDE_RESULTS_INDEX` dès le
 * départ, exactement comme un second clic sur « Voir le score ».
 *
 *     node scripts/check-engine-review.mjs
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/engine/state.ts", "src/quiz-ids.ts"], async (
	{ createStateHandlers },
	{ assignQuestionIds }
) => {
	/** Construit un ctx minimal, avec le câblage croisé réel des méthodes
	    aplaties (même pattern qu'engine.ts). */
	function makeCtx({
		quiz,
		selections,
		isLessonMode = false,
		roles = [],
		lessonPreSkipped = [],
		recordedInit = [],
		sourcePath = "Cours/ch1.md",
		reviewSink: sinkOverride,
	}) {
		const appels = [];
		const sink = sinkOverride === undefined
			? { keyOf: (path, id) => `${path}::${id}`, record: (entries) => appels.push(...entries) }
			: sinkOverride;

		const ctx = {
			quiz,
			questionIds: assignQuestionIds(quiz.map(q => ({ id: q.id, title: q.title }))),
			reviewSink: sink,
			sourcePath,
			plugin: { _statsStore: { record: null, updateRecord() {} } },
			container: { querySelectorAll: () => [], querySelector: () => null },
			isExamMode: false,
			examStarted: false,
			examEnded: false,
			textOnly: undefined,
			isTextQuestion: () => false,
			isClozeQuestion: () => false,
			isOrderingQuestion: () => false,
			isMatchingQuestion: () => false,
			isLessonMode: () => isLessonMode,
			roleOfQuestion: (i) => roles[i],
			closeHintModal: () => {},
			clampSlideIndex: (i) => i,
		};
		// N questions + slide "submit" + slide "results" (engine.ts buildSlideMap).
		ctx.SLIDE_RESULTS_INDEX = quiz.length + 1;
		// isQuestionSlideIndex(current) doit valoir faux : dans tous les cas
		// testés ici, `current` EST déjà SLIDE_RESULTS_INDEX (cf. commentaire
		// d'en-tête), qui n'est jamais une slide de question.
		ctx.isQuestionSlideIndex = () => false;
		ctx.quizState = {
			selections,
			recorded: recordedInit.length ? recordedInit : quiz.map(() => false),
			lessonPreSkipped: lessonPreSkipped.length ? lessonPreSkipped : quiz.map(() => false),
			locked: false,
			isSliding: false,
			current: ctx.SLIDE_RESULTS_INDEX,
			lastQuestionIndex: 0,
			pendingResultsLock: false,
			resultsCounted: false,
		};

		const handlers = createStateHandlers(ctx);
		Object.assign(ctx, {
			hasAnyAnswer: handlers.hasAnyAnswer,
			isComplete: handlers.isComplete,
			isCorrect: handlers.isCorrect,
			computeScorePercent: handlers.computeScorePercent,
			updateNavHighlight: handlers.updateNavHighlight,
			goToSlide: handlers.goToSlide,
			recordReview: handlers.recordReview,
			goToResults: handlers.goToResults,
		});
		return { ctx, appels };
	}

	/* ────────────────────────────────────────────────────────────
	   Case A — recordReview() en isolation (point d'enregistrement de
	   l'auto-évaluation, engine/text-only.ts).
	   ──────────────────────────────────────────────────────────── */
	{
		const r = makeReporter("recordReview — garde puits/chemin absent");
		const quiz = [{ id: "q1", title: "T1" }];

		// `null`, pas `undefined` : un `reviewSink` omis déclenche le puits PAR
		// DÉFAUT de `makeCtx` (déstructuration avec valeur par défaut) — c'est
		// justement `null` qui simule un `_reviewStore` absent (Task 7, "le
		// store dégrade plutôt que de bloquer le greffon").
		const { ctx: sansPuits } = makeCtx({ quiz, selections: [null], reviewSink: null });
		sansPuits.recordReview(0, "correct");
		r.check("puits absent : rien n'est marqué journalisé", sansPuits.quizState.recorded[0], false);

		const { ctx: sansChemin, appels } = makeCtx({ quiz, selections: [null], sourcePath: "" });
		sansChemin.recordReview(0, "correct");
		r.check("sourcePath absent (aperçu éditeur) : aucun appel au puits", appels.length, 0);
		r.check("sourcePath absent : rien n'est marqué journalisé", sansChemin.quizState.recorded[0], false);
		r.done();
	}

	{
		const r = makeReporter("recordReview — dédoublonnage (une fois par session)");
		const quiz = [{ id: "q1", title: "T1" }];
		const { ctx, appels } = makeCtx({ quiz, selections: [null] });
		ctx.recordReview(0, "correct");
		ctx.recordReview(0, "correct");
		r.check("deux appels, un seul enregistrement journalisé", appels.length, 1);
		r.check("le drapeau recorded est posé", ctx.quizState.recorded[0], true);
		r.done();
	}

	{
		const r = makeReporter("recordReview — identifiant manquant (repli qN à l'assemblage)");
		// `questionIds[0]` forcé vide : simule une incohérence d'assemblage.
		// Sans id, rien à journaliser (`if (!id) return;`) et le drapeau `recorded`
		// reste FAUX — pas de perte silencieuse, une reprise ultérieure reste possible.
		const quiz = [{ id: "q1", title: "T1" }];
		const { ctx, appels } = makeCtx({ quiz, selections: [null] });
		ctx.questionIds[0] = "";
		ctx.recordReview(0, "correct");
		r.check("id vide : aucun appel au puits", appels.length, 0);
		r.check("id vide : recorded reste faux (reprise possible)", ctx.quizState.recorded[0], false);
		r.done();
	}

	{
		const r = makeReporter("recordReview — rôle inclus seulement en mode Leçon");
		const quiz = [{ id: "q1", title: "T1" }];

		const { ctx: horsLecon, appels: a1 } = makeCtx({ quiz, selections: [null], isLessonMode: false, roles: ["recall"] });
		horsLecon.recordReview(0, "understood");
		r.check("hors Leçon : pas de propriété 'role'", Object.prototype.hasOwnProperty.call(a1[0], "role"), false);

		const { ctx: enLecon, appels: a2 } = makeCtx({ quiz, selections: [null], isLessonMode: true, roles: ["recall"] });
		enLecon.recordReview(0, "understood");
		r.check("en Leçon : le rôle courant est copié", a2[0]?.role, "recall");
		r.done();
	}

	{
		/* LE ruling préflight 3 (2026-09-02) : le moteur DOIT dériver la clé par
		   `ctx.questionIds`, jamais `ctx.quiz[i].id` brut. Item 0 n'a PAS d'id
		   explicite : `assignQuestionIds` lui attribue le slug de son titre —
		   calcul À LA MAIN ci-dessous, PAS copié d'une exécution :
		     "Titre à vérifier".toLowerCase() = "titre à vérifier"
		     remplacement de [^a-z0-9]+ par "-" :
		       "titre" + "-" (pour " à ") + "v" + "-" (pour "é") + "rifier"
		       = "titre-v-rifier"  (14 caractères, sous la limite de 20)
		   Si le moteur lisait `q.id` brut, cet id serait `undefined` : le garde
		   `if (!id) return;` empêcherait tout enregistrement pour cette question. */
		const r = makeReporter("recordReview — clé dérivée par assignQuestionIds, jamais q.id brut");
		const quiz = [
			{ title: "Titre à vérifier" },
			{ id: "q-explicit", title: "Autre titre" },
		];
		const { ctx, appels } = makeCtx({ quiz, selections: [null, null] });
		r.check("id de repli calculé à la main", ctx.questionIds[0], "titre-v-rifier");
		ctx.recordReview(0, "correct");
		ctx.recordReview(1, "wrong");
		r.check("les DEUX questions sont journalisées (repli ET id explicite)", appels.length, 2);
		r.check("clé de la question sans id explicite : chemin::slug-du-titre",
			appels[0]?.q, "Cours/ch1.md::titre-v-rifier");
		r.check("clé de la question avec id explicite : chemin::id",
			appels[1]?.q, "Cours/ch1.md::q-explicit");
		r.done();
	}

	/* ────────────────────────────────────────────────────────────
	   Case B — la boucle par question de goToResults (engine/state.ts),
	   second point d'enregistrement : la soumission.
	   ──────────────────────────────────────────────────────────── */
	{
		const r = makeReporter("goToResults — verdict par question (mode Leçon, rôles mixtes)");
		const quiz = [
			{ id: "read1", title: "Support", role: "read" },
			{ id: "skip1", title: "Pré sautée", options: ["a", "b"], correctIndex: 0 },
			{ id: "ok1", title: "Juste", options: ["a", "b"], correctIndex: 0 },
			{ id: "bad1", title: "Fausse", options: ["a", "b"], correctIndex: 0 },
			{ id: "inc1", title: "Sans réponse", options: ["a", "b"], correctIndex: 0 },
			{ id: "done1", title: "Déjà notée", options: ["a", "b"], correctIndex: 0 },
		];
		const roles = ["read", "test", "test", "test", "test", "test"];
		const selections = [null, null, 0, 1, null, 0];
		const lessonPreSkipped = [false, true, false, false, false, false];
		// i5 ("done1") a déjà été journalisée par l'auto-évaluation d'une
		// question "recall" avant la soumission : la boucle doit la laisser
		// intacte (ni double appel, ni écrasement du drapeau).
		const recordedInit = [false, false, false, false, false, true];

		const { ctx, appels } = makeCtx({ quiz, selections, isLessonMode: true, roles, lessonPreSkipped, recordedInit });
		ctx.goToResults();

		const attendu = [
			{ q: "Cours/ch1.md::read1", grade: "seen", role: "read" },
			{ q: "Cours/ch1.md::skip1", grade: "skipped", role: "test" },
			{ q: "Cours/ch1.md::ok1", grade: "correct", role: "test" },
			{ q: "Cours/ch1.md::bad1", grade: "wrong", role: "test" },
		];
		r.check("carte 'read' → seen ; pré sautée → skipped ; juste/fausse → correct/wrong ; " +
			"sans réponse omise ; déjà notée non recomptée", appels, attendu);
		r.check("le drapeau recorded reflète exactement ce qui a été journalisé",
			ctx.quizState.recorded, [true, true, true, true, false, true]);
		r.check("la session n'est comptée qu'une fois (double clic)", ctx.quizState.resultsCounted, true);
		r.done();
	}

	{
		const r = makeReporter("goToResults — hors mode Leçon, verdict QCM ordinaire, pas de rôle");
		const quiz = [
			{ id: "q1", title: "Q1", options: ["a", "b"], correctIndex: 0 },
			{ id: "q2", title: "Q2", options: ["a", "b"], correctIndex: 0 },
		];
		const { ctx, appels } = makeCtx({ quiz, selections: [0, 1], isLessonMode: false });
		ctx.goToResults();
		r.check("QCM ordinaire : correct/wrong, sans propriété 'role'", appels, [
			{ q: "Cours/ch1.md::q1", grade: "correct" },
			{ q: "Cours/ch1.md::q2", grade: "wrong" },
		]);
		r.done();
	}

	{
		const r = makeReporter("goToResults — double clic (resultsCounted) ne rejournalise rien");
		const quiz = [{ id: "q1", title: "Q1", options: ["a", "b"], correctIndex: 0 }];
		const { ctx, appels } = makeCtx({ quiz, selections: [0], isLessonMode: false });
		ctx.goToResults();
		ctx.goToResults();
		r.check("un deuxième 'Voir le score' n'ajoute aucune ligne", appels.length, 1);
		r.done();
	}
});
