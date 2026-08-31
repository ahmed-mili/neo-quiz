/**
 * Non-régression du RENOMMAGE de mode `learn` → `lesson` (task 0 du lot mode
 * leçon, 2026-08-31).
 *
 * La règle, non négociable : on LIT les deux noms, on n'ÉCRIT plus que
 * `lesson`. Un quiz partagé écrit avec l'ancien nom (`mode: 'learn'`,
 * `learnMode: true`, `learn`/`learnHtml`/`_learnHtml`) doit continuer de
 * fonctionner indéfiniment — c'est `normalizeQuizMode`/`extractExamOptions`/
 * `pickLessonFields` (quiz-utils.ts) qui portent cette garantie, et c'est ce
 * script qui l'éprouve sur le CODE RÉEL (pas une réplique, qui finirait par
 * diverger et valider le vide).
 *
 *     npm run check:lesson
 */
import JSON5 from "json5";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/quiz-utils.ts", ({ parseQuizSource, extractExamOptions }) => {
	const r = makeReporter("Renommage lesson — mode");
	const modeOf = (source) => extractExamOptions(parseQuizSource(source)).quizMode;

	// Le mode hérité est lu et normalisé.
	r.check("mode 'learn' normalise en 'lesson'", modeOf(`[{ mode: "learn" }]`), "lesson");
	r.check("raccourci learnMode normalise en 'lesson'", modeOf(`[{ learnMode: true }]`), "lesson");

	// Le nom canonique est lu tel quel.
	r.check("mode 'lesson' lu tel quel", modeOf(`[{ mode: "lesson" }]`), "lesson");

	/* La casse est TOLÉRÉE pour tous les modes, alias comme noms canoniques
	   (ruling A, round 1 de revue 2026-08-31) : une première version de cette
	   fonction exigeait la casse exacte pour "lesson" seul, ce qui rendait
	   `mode: "Lesson"` fantôme alors que `mode: "Learn"` restait reconnu —
	   asymétrie absurde entre alias et nom canonique, corrigée. Ce cas vérifie
	   maintenant que la tolérance s'applique bien au nom canonique aussi. */
	r.check("'Lesson' (casse) reste reconnu comme 'lesson'", modeOf(`[{ mode: "Lesson" }]`), "lesson");

	r.done();
});

/* PREUVE DE CONTENU (round 1 de revue 2026-08-31) : l'audit des vaults ne
   teste que la PRÉSENCE d'un champ équivalent après l'aller-retour, jamais sa
   VALEUR (scripts/audit-vaults.mjs) — un défaut préexistant de cet outil,
   pas quelque chose à corriger ici. Ce cas-ci vérifie donc explicitement que
   le CONTENU d'un `learnHtml` hérité, pas seulement son nom, survit au
   passage par l'éditeur (convertParsedToInternal → exportAll). */
await withSrcModule(["src/editor/convert.ts", "src/editor/export.ts"], (convert, exp) => {
	const r = makeReporter("Renommage lesson — contenu");
	const contenu = "<p>Contenu hérité</p>";
	const q = convert.convertParsedToInternal({
		id: "x", title: "T", prompt: "P", options: ["a", "b"], correctIndex: 0,
		learnHtml: contenu,
	});
	const relu = JSON5.parse(exp.exportAll([q], null))[0];

	r.check("ancien nom absent de la sortie", relu.learnHtml, undefined);
	r.check("contenu herite present sous le nouveau nom", relu.lessonHtml, contenu);
	// Round 1 de revue, FINDING 2 : un `learnHtml` non riche ne doit PAS
	// produire un `lesson:` dérivé EN PLUS — un champ ajouté qu'aucun audit
	// « champs perdus » ne peut voir.
	r.check("pas de champ 'lesson' ajoute en plus du HTML herite", relu.lesson, undefined);

	r.done();
});

/**
 * Task 1 du lot mode leçon : les champs `slice`/`role` (question) et `source`
 * (configuration). Le point délicat n'est pas la déclaration de type — elle
 * ne change rien au runtime — mais `isStrictQuizModeConfig` : `slice`, `role`
 * et `source` ne doivent PAS rejoindre ses MARQUEURS, sous peine de faire
 * disparaître une vraie question de leçon (qui porte `slice`/`role` mais
 * jamais seuls : toujours avec un marqueur de question, `options`/`answer`…)
 * ou, à l'inverse, de faire d'une configuration qui référence sa source une
 * question fantôme.
 */
await withSrcModule("src/quiz-utils.ts", ({ parseQuizSource, extractExamOptions, findQuizModeConfigIndex }) => {
	const r = makeReporter("Boucle d'apprentissage — slice/role/source");

	// Le bloc d'une Lesson porte slice/role ; parseQuizSource doit les rendre tels quels.
	const src = `[
	  { id: "a", slice: 1, role: "pre",    prompt: "P ?", type: "text", answer: "x" },
	  { id: "b", slice: 1, role: "recall", prompt: "R ?", type: "text", answer: "y", passage: "Texte." },
	  { id: "c", slice: 1, role: "test",   prompt: "T ?", options: ["1","2"], correctIndex: 0 },
	  { mode: "lesson" }
	]`;
	const { questions, quizMode } = extractExamOptions(parseQuizSource(src));
	r.check("mode 'lesson' lu", quizMode, "lesson");
	r.check("la configuration ne doit pas compter comme une question", questions.length, 3);
	r.check("role rendu tel quel", questions.map(q => q.role), ["pre", "recall", "test"]);
	r.check("slice rendu tel quel", questions.map(q => q.slice), [1, 1, 1]);

	// Une configuration qui porte `source` reste une configuration, pas une question.
	const parseeAvecSource = parseQuizSource(`[{ mode: "quiz", source: "[[Chapitre 1 — Lesson]]" }]`);
	const avecSource = extractExamOptions(parseeAvecSource);
	r.check("un bloc de reference n'a aucune question propre", avecSource.questions.length, 0);
	r.check("mode 'quiz' conserve malgre 'source'", avecSource.quizMode, "quiz");

	// Question ordinaire de remplissage, sans aucun rapport avec slice/role —
	// juste pour donner un second element neutre aux tableaux ci-dessous.
	const q = { title: "Une question", prompt: "Enonce", options: ["a", "b"], correctIndex: 0 };

	/* Concern signale a la revue de la Task 1 (progress.md) : aucun cas ne
	   verrouillait `isStrictQuizModeConfig` contre un futur ajout maladroit de
	   `slice`/`role` a sa liste de MARQUEURS — cette fonction a deja cause deux
	   regressions documentees dans ses propres commentaires (une question
	   fantome ET une vraie question avalee). Deux verrous, dans les deux sens :

	   1. Un objet de CONFIGURATION legitime (marqueur `mode` valide, aucun
	      marqueur de question, aucun `prompt`) qui porte AUSSI `slice`/`role`
	      doit rester une configuration. Ce cas echouerait si `slice`/`role`
	      rejoignaient un jour MARQUEURS : `rempli(q.slice)` deviendrait vrai
	      et ferait passer cette configuration pour une question. */
	r.check("configuration valide portant aussi slice/role reste une configuration",
		findQuizModeConfigIndex([q, { mode: "lesson", slice: 3, role: "recall" }]), 1);
	/* 2. A l'inverse, une VRAIE question de leçon — marqueurs de question
	      remplis, `prompt` compris — qui porte `slice`/`role` EN PLUS d'un
	      champ `mode` errant ne doit jamais etre prise pour la configuration
	      du bloc, quelle que soit sa position. Deja garanti par le test
	      `question reelle en dernier avec un mode` ci-dessus (sans slice/role) ;
	      ce cas verifie que l'ajout de slice/role ne change rien a ce verdict. */
	r.check("question reelle portant slice/role n'est jamais prise pour la configuration",
		findQuizModeConfigIndex([
			{ mode: "lesson", prompt: "P ?", slice: 2, role: "test", type: "text", answer: "y" },
			q
		]), -1);

	r.done();
});

/**
 * FIX round 1 de revue (2026-08-31), FINDING 2 : `source` (Task 1) n'avait
 * qu'un test de LECTURE (`extractExamOptions` ci-dessus) — rien ne verrouillait
 * l'ÉCRITURE. `source` n'est dans aucune liste `connues` (editor/convert.ts
 * `extraModeFields`) : il part donc en `_extra`, et `exportAll` (editor/export.ts)
 * le réémet dans les QUATRE branches de l'objet de mode, `mode: 'quiz'`
 * comprise. L'invariant tient aujourd'hui sans code dédié — mais rien ne
 * l'empêcherait de se rompre EN SILENCE si quelqu'un ajoutait `source` à
 * `connues` sans écrire le code de réémission correspondant : la note de
 * référence perdrait son lien vers le chapitre sans qu'aucune vérification
 * ne le remarque. Ce cas ferme ce trou par un aller-retour réel, du JSON5
 * d'entrée au JSON5 de sortie.
 */
await withSrcModule(["src/editor/convert.ts", "src/editor/export.ts"], (convert, exp) => {
	const r = makeReporter("Boucle d'apprentissage — source (ecriture)");

	const source = "[[Chapitre 1 — Lesson]]";
	const configBrut = JSON5.parse(`[{ mode: "quiz", source: "${source}" }]`)[0];
	const examOptions = convert.readModeConfig(configBrut);
	const question = { id: "x", title: "T", prompt: "P", options: ["a", "b"], correctIndex: 0 };
	const written = exp.exportAll([question], examOptions);
	const configEcrit = JSON5.parse(written).at(-1);

	r.check("source intact a l'aller-retour", configEcrit.source, source);
	r.check("mode 'quiz' toujours ecrit a cote de source", configEcrit.mode, "quiz");

	r.done();
});

/**
 * Task 3 du lot mode leçon : `buildLessonModel` (src/engine/lesson.ts), le
 * modèle PUR des tranches, dérivé des `slice`/`role` de chaque question.
 * Chargé conjointement avec `src/quiz-utils.ts` pour partir d'un vrai JSON5
 * parsé (parseQuizSource/extractExamOptions), pas d'objets construits à la
 * main qui finiraient par diverger de la forme réelle des questions.
 */
await withSrcModule(["src/quiz-utils.ts", "src/engine/lesson.ts"], ({ parseQuizSource, extractExamOptions }, { buildLessonModel }) => {
	const r = makeReporter("Boucle d'apprentissage — modele de tranches");

	// Les tranches sont derivees des questions, dans l'ordre des numeros de slice.
	const src = `[
	  { slice: 1, role: "pre",    prompt: "A", type: "text", answer: "x" },
	  { slice: 2, role: "test",   prompt: "D", options: ["1","2"], correctIndex: 0 },
	  { slice: 1, role: "recall", prompt: "B", type: "text", answer: "y" },
	  { slice: 1, role: "test",   prompt: "C", options: ["1","2"], correctIndex: 0 },
	  { mode: "lesson" }
	]`;
	const lesson = buildLessonModel(extractExamOptions(parseQuizSource(src)).questions, "lesson");
	r.check("mode lesson avec slices actif", lesson.isLesson, true);
	r.check("deux tranches distinctes", lesson.slices.length, 2);
	r.check("la tranche 1 garde l'ordre du tableau", lesson.slices[0].questionIndexes, [0, 2, 3]);
	r.check("la tranche 2 ne contient que la question D", lesson.slices[1].questionIndexes, [1]);
	r.check("la question d'index 1 appartient a la 2e tranche", lesson.sliceOf(1), 2);
	r.check("role rendu tel quel pour la question d'index 1", lesson.roleOf(1), "test");

	// Une question sans champ `role` du tout recoit le defaut "test" (pas "pre" ni undefined).
	const sansRole = buildLessonModel(
		extractExamOptions(parseQuizSource(`[{ slice: 1, prompt: "Q", options: ["1","2"], correctIndex: 0 }, { mode: "lesson" }]`)).questions,
		"lesson"
	);
	r.check("role absent retombe sur le defaut 'test'", sansRole.roleOf(0), "test");

	// Un mode lesson SANS slice garde le comportement historique : pas de boucle.
	const legacy = `[{ prompt: "Q", options: ["1","2"], correctIndex: 0, lesson: "Lecon" }, { mode: "lesson" }]`;
	r.check("mode lesson sans aucun slice n'active pas la boucle",
		buildLessonModel(extractExamOptions(parseQuizSource(legacy)).questions, "lesson").isLesson, false);

	// Un slice mal forme (0, pas un entier >= 1) est ignore, il ne cree pas de tranche fantome.
	const sale = `[{ slice: 0, prompt: "Q", options: ["1","2"], correctIndex: 0 }, { mode: "lesson" }]`;
	r.check("slice 0 est ignore, pas de tranche fantome",
		buildLessonModel(extractExamOptions(parseQuizSource(sale)).questions, "lesson").isLesson, false);

	// Un slice present mais quizMode != "lesson" ne doit jamais activer la boucle
	// (ex. mode "quiz" ordinaire qui reutiliserait par erreur un champ slice).
	const quizOrdinaire = `[{ slice: 1, prompt: "Q", options: ["1","2"], correctIndex: 0 }, { mode: "quiz" }]`;
	r.check("slice valide mais mode 'quiz' n'active pas la boucle",
		buildLessonModel(extractExamOptions(parseQuizSource(quizOrdinaire)).questions, "quiz").isLesson, false);

	// Hors mode Lesson, sliceOf renvoie toujours null (meme sur une question qui porte un slice).
	r.check("sliceOf renvoie null hors mode lesson",
		buildLessonModel(extractExamOptions(parseQuizSource(quizOrdinaire)).questions, "quiz").sliceOf(0), null);

	r.done();
});

/**
 * Verrou de la decision de conception : `createLessonHandlers` ne memorise
 * PAS `LessonModel` a l'assemblage — il recalcule `buildLessonModel(ctx.quiz,
 * ctx.quizMode)` a CHAQUE appel (src/engine/lesson.ts). La raison est que
 * `ctx.quizMode` est mute en cours de vie du bloc (switchToExamMode,
 * engine.ts:885 ; startTrainingMode, engine/exam.ts:157 ; resetQuiz,
 * engine/state.ts:387) : un modele fige au montage rendrait `isLessonMode()`
 * perime des le premier changement de mode. Round 1 de revue (2026-08-31),
 * FINDING important : cette justesse n'etait prouvee nulle part — seulement
 * affirmee dans le rapport et un commentaire. Ce cas instancie la factory
 * sur un contexte factice minimal (seuls `quiz`/`quizMode` sont lus) et mute
 * `quizMode` APRES l'instanciation, exactement comme le fait switchToExamMode
 * sur le vrai ctx : si quelqu'un memorisait un jour le modele a l'assemblage,
 * ce cas echouerait.
 */
await withSrcModule("src/engine/lesson.ts", ({ createLessonHandlers }) => {
	const r = makeReporter("Boucle d'apprentissage — accessor suit ctx.quizMode (pas un flag fige)");

	const ctx = {
		quiz: [
			{ slice: 1, role: "test", prompt: "A", options: ["1", "2"], correctIndex: 0 },
			{ slice: 2, role: "test", prompt: "B", options: ["1", "2"], correctIndex: 0 }
		],
		quizMode: "lesson"
	};
	const lesson = createLessonHandlers(ctx);
	r.check("isLessonMode() vrai juste apres l'instanciation, en mode lesson avec des tranches", lesson.isLessonMode(), true);

	// Mutation de ctx.quizMode APRES l'instanciation, sur le MEME ctx — comme switchToExamMode le ferait en vrai.
	ctx.quizMode = "exam";
	r.check("isLessonMode() devient faux des que ctx.quizMode bascule vers 'exam' (accessor vivant, pas un flag fige)", lesson.isLessonMode(), false);

	// Et retour a "lesson" (resetQuiz) : l'accessor doit redevenir vrai, preuve qu'il n'y a pas de cache "une fois faux, toujours faux".
	ctx.quizMode = "lesson";
	r.check("isLessonMode() redevient vrai si ctx.quizMode revient a 'lesson'", lesson.isLessonMode(), true);

	r.done();
});

/**
 * Task 4 du lot mode leçon : `passageVisibility` (src/engine/passage.ts),
 * la decision PURE qui dit si le support de comprehension d'une question se
 * rend "hidden" (rien du tout), "open" (deplie, sans repli par defaut) ou
 * "collapsible" (repliable, jamais reaffiche d'office). Cas un par ligne du
 * tableau du brief, plus quelques bords non couverts par le tableau mais
 * tranches par le "pourquoi" (verrouillage sans effet sur "pre" et "test").
 *
 * CORRECTIF Task 5 (2026-08-31) : le parametre s'appelait `locked` (lu sur
 * `quizState.locked`, GLOBAL au quiz) — renomme `checked` (lu sur l'etat PAR
 * QUESTION `textOnlyChecked[qi]`, via ctx.textOnly.isChecked). Les intitules
 * ci-dessous parlent desormais de "verifiee" (l'auto-evaluation de CETTE
 * question a ete validee), plus de "verrouille".
 */
await withSrcModule("src/engine/passage.ts", ({ passageVisibility }) => {
	const r = makeReporter("Boucle d'apprentissage — visibilite du support par role");

	// Tableau du brief, une ligne par cas.
	r.check("pre, non verifiee, mode Lecon -> hidden",
		passageVisibility({ role: "pre", checked: false, isLesson: true }), "hidden");
	r.check("recall, non verifiee, mode Lecon -> hidden",
		passageVisibility({ role: "recall", checked: false, isLesson: true }), "hidden");
	r.check("recall, verifiee, mode Lecon -> open",
		passageVisibility({ role: "recall", checked: true, isLesson: true }), "open");
	r.check("test, non verifiee, mode Lecon -> collapsible",
		passageVisibility({ role: "test", checked: false, isLesson: true }), "collapsible");
	r.check("recall, non verifiee, HORS mode Lecon -> collapsible (comportement d'aujourd'hui)",
		passageVisibility({ role: "recall", checked: false, isLesson: false }), "collapsible");

	// Bords non ecrits dans le tableau, mais qu'implique le "pourquoi" du brief.
	r.check("pre reste hidden meme verifiee (le mecanisme ne se leve jamais a posteriori)",
		passageVisibility({ role: "pre", checked: true, isLesson: true }), "hidden");
	r.check("test reste collapsible meme verifiee (jamais reaffiche d'office)",
		passageVisibility({ role: "test", checked: true, isLesson: true }), "collapsible");
	r.check("pre HORS mode Lecon -> collapsible (le role n'a aucun effet hors Lecon)",
		passageVisibility({ role: "pre", checked: false, isLesson: false }), "collapsible");

	r.done();
});

/**
 * FIX round de revue de la Task 5 (2026-08-31) sur le brief lui-meme :
 * celui-ci posait que le support d'une question "recall" se rouvre "des lors
 * que la question est verrouillee" (`quizState.locked`). Or `locked` est
 * GLOBAL et ne se pose qu'a l'arrivee sur l'ecran de resultats
 * (engine/track.ts) — avec ce cablage, la comparaison support/rappel
 * n'arriverait qu'a la toute fin du quiz, jamais juste apres la tentative de
 * CETTE question. Ce cas cable le VRAI `createPassageHandlers` sur un ctx
 * factice ou `quizState.locked` reste `false` en permanence, et prouve que
 * `passageVisibilityFor` s'ouvre quand meme des que `textOnlyChecked[qi]`
 * (le seul etat PAR QUESTION disponible) passe a `true` pour CETTE question
 * seulement — une question "recall" voisine, non verifiee, reste cachee.
 */
await withSrcModule("src/engine/passage.ts", ({ createPassageHandlers }) => {
	const r = makeReporter("Boucle d'apprentissage — reouverture du support suit textOnlyChecked, pas le verrou global");

	const textOnlyChecked = { 0: false, 1: false };
	const ctx = {
		quiz: [{ role: "recall" }, { role: "recall" }],
		quizMode: "lesson",
		isLessonMode: () => true,
		roleOfQuestion: qi => ctx.quiz[qi].role,
		// Verrou GLOBAL delibere-ment jamais pose : si passageVisibilityFor
		// devait encore le lire, ce cas resterait bloque sur "hidden".
		quizState: { locked: false },
		textOnly: { isChecked: qi => !!textOnlyChecked[qi] }
	};
	const { passageVisibilityFor } = createPassageHandlers(ctx);

	r.check("recall non verifiee reste cachee malgre quizState.locked=false (comportement attendu avant reponse)",
		passageVisibilityFor(0), "hidden");

	textOnlyChecked[0] = true;
	r.check("recall verifiee s'ouvre SANS que quizState.locked passe jamais a true",
		passageVisibilityFor(0), "open");
	r.check("une autre question recall, elle, non verifiee, reste cachee (etat PAR QUESTION, pas globalise)",
		passageVisibilityFor(1), "hidden");

	r.done();
});

/**
 * Round 1 de revue de la Task 4, correctif `a17080c` : `collapsed` et
 * `defaultFoldSeeded` (les deux Set de la closure de `createPassageCollapseState`,
 * src/engine/passage.ts) n'etaient jamais vides — un « recommencer », ou un
 * aller-retour Lecon -> Examen -> Lecon, retrouvait un support deja seme qui
 * ne se repliait plus par defaut, et un support replie a la main le restait
 * pour toujours. `resetPassageState()` (passage.ts) corrige ca ; `resetQuiz`
 * (src/engine/state.ts) l'appelle a cote des autres videages d'etat de session.
 *
 * Ce cas cable les DEUX fichiers reels ensemble, comme `createLessonHandlers`
 * plus haut instancie sa factory sur un contexte factice minimal : seules les
 * entrees que `resetQuiz()` lit reellement sont fournies a `ctx`, et
 * `ctx.passage.resetPassageState` delegue au VRAI `reset()` de
 * `createPassageCollapseState` (jamais un espion qui se contenterait de
 * verifier qu'il a ete appele) — sinon un `reset()` qui ne viderait qu'un
 * SEUL des deux Set passerait inapercu, exactement le critere qui a coute le
 * bug.
 */
await withSrcModule(["src/engine/passage.ts", "src/engine/state.ts"], (passage, state) => {
	const r = makeReporter("Boucle d'apprentissage — resetQuiz remet a zero le repli du support");

	const collapseState = passage.createPassageCollapseState();

	// Contexte factice minimal : uniquement ce que `resetQuiz()` lit ou ecrit.
	const ctx = {
		closeHintModal() {},
		track: { clearTrackTransitionFallback() {} },
		viewport: {
			destroyActiveSlideResizeObserver() {},
			destroyAllSlidesResizeObserver() {},
			destroyViewportResizeObserver() {}
		},
		clearBackgroundWarmIdleHandle() {},
		cancelEnsureTrackVisibleRaf() {},
		quizState: {},
		initSelections: () => [],
		initTextOnlyAnswers: () => [],
		initTextOnlyChecked: () => [],
		initTextOnlyRatings: () => [],
		buildShuffleMap: () => ({}),
		initOrderingPicks: () => ({}),
		initMatchPicks: () => ({}),
		setSlidingClass() {},
		// Le cablage sous verrou : resetQuiz doit appeler CECI, qui delegue au
		// vrai reset() de passage.ts.
		passage: { resetPassageState: () => collapseState.reset() },
		stopExamTimer() {},
		isExamMode: false,
		render() {}
	};
	const { resetQuiz } = state.createStateHandlers(ctx);

	// q0 : repli MANUEL (toggle direct, jamais passe par seedCollapsedOnce —
	// le cas d'un support hors mode Lecon replie a la main par l'utilisateur).
	collapseState.toggle("q0");
	// q1 : repli PAR DEFAUT deja seme (role "test" en mode Lecon, premiere
	// apparition de la session).
	collapseState.seedCollapsedOnce("q1");
	r.check("etat initial : repli manuel actif", collapseState.isCollapsed("q0"), true);
	r.check("etat initial : repli par defaut deja applique", collapseState.isCollapsed("q1"), true);

	resetQuiz();

	r.check("apres resetQuiz : le repli manuel ne survit pas a la session", collapseState.isCollapsed("q0"), false);
	r.check("apres resetQuiz : le repli par defaut deja applique est efface", collapseState.isCollapsed("q1"), false);

	/* Le point qui distingue un `reset()` correct (les DEUX Set vides) d'un
	   `reset()` qui n'aurait vide que `collapsed` : si `defaultFoldSeeded`
	   gardait "q1", ce second `seedCollapsedOnce` serait un no-op (deja seme)
	   et q1 resterait deplie a tort — la nouvelle session n'aurait plus jamais
	   son repli par defaut. */
	collapseState.seedCollapsedOnce("q1");
	r.check("apres resetQuiz : le repli par defaut peut se re-appliquer a la session suivante (defaultFoldSeeded vide, pas seulement collapsed)",
		collapseState.isCollapsed("q1"), true);

	r.done();
});

/**
 * Task 5 du lot mode leçon (2026-08-31) : le bouton global « Practice mode »
 * disparait de l'interface, sa mecanique (reponse libre + auto-evaluation)
 * est ABSORBEE par le role "recall" du mode Lecon — `isTextOnlyFor(qi)`
 * (src/engine/text-only.ts) decide desormais QUESTION PAR QUESTION, jamais
 * pour le quiz entier. Verrou du risque principal de la tache : un quiz
 * ORDINAIRE (hors Lecon, sans role) doit se comporter EXACTEMENT comme avant
 * — d'ou le premier cas, qui reproduit un tel quiz.
 */
await withSrcModule("src/engine/text-only.ts", ({ createTextOnlyHandlers }) => {
	const r = makeReporter("Boucle d'apprentissage — l'auto-evaluation suit le role recall, pas un mode global");

	// ctx factice minimal : seuls les champs lus par isTextOnlyMode/isTextOnlyFor.
	const makeCtx = ({ isLesson, role, practiceMode }) => ({
		quizState: { practiceMode },
		isLessonMode: () => isLesson,
		roleOfQuestion: () => role
	});

	// Quiz ORDINAIRE : ni Lecon, ni mode texte historique — comportement AVANT
	// cette tache (le bouton disparu ne changeait jamais cette valeur ici,
	// puisque le controle retire ne faisait qu'ecrire practiceMode="qcm"/"text").
	const ordinaire = createTextOnlyHandlers(makeCtx({ isLesson: false, role: "test", practiceMode: "qcm" }));
	r.check("quiz ordinaire (hors Lecon, mode qcm) : isTextOnlyFor reste faux, aucune regression",
		ordinaire.isTextOnlyFor(0), false);

	// Mode Lecon : seul le role "recall" bascule, ses voisins "pre"/"test" non.
	const recall = createTextOnlyHandlers(makeCtx({ isLesson: true, role: "recall", practiceMode: "qcm" }));
	r.check("Lecon, role recall, mode qcm : isTextOnlyFor vrai (l'essentiel de la tache)",
		recall.isTextOnlyFor(0), true);

	const test = createTextOnlyHandlers(makeCtx({ isLesson: true, role: "test", practiceMode: "qcm" }));
	r.check("Lecon, role test : isTextOnlyFor reste faux (QCM habituel, pas de contamination entre roles)",
		test.isTextOnlyFor(0), false);

	const pre = createTextOnlyHandlers(makeCtx({ isLesson: true, role: "pre", practiceMode: "qcm" }));
	r.check("Lecon, role pre : isTextOnlyFor reste faux",
		pre.isTextOnlyFor(0), false);

	// Chemin historique conserve : un bloc HORS Lecon qui active encore
	// practiceMode="text" par sa configuration (demarrage Entrainement d'un
	// examen) continue de tout afficher en reponse libre.
	const entrainement = createTextOnlyHandlers(makeCtx({ isLesson: false, role: "test", practiceMode: "text" }));
	r.check("hors Lecon, practiceMode 'text' (chemin historique) : isTextOnlyFor vrai",
		entrainement.isTextOnlyFor(0), true);
	r.check("isTextOnlyMode() (decision GLOBALE, ecran de soumission/resultats) reste vraie dans ce meme cas",
		entrainement.isTextOnlyMode(), true);

	r.done();
});

/**
 * FIX round 1 de revue de la Task 5 (2026-08-31), FINDINGS 1 et 2 sur le
 * brief lui-meme : `isTextOnlyMode()` (globale, `practiceMode` seul) reste
 * FAUSSE en mode Lecon des que le mix contient ne serait-ce qu'UNE question
 * "recall" (practiceMode y reste "qcm") — deux endroits du moteur la
 * lisaient encore directement et se trompaient donc dans ce cas precis :
 *
 * - FINDING 1 (`goToResults`, src/engine/state.ts) : decidait d'ecrire un
 *   vrai `bestScore` au tableau de bord des qu'`isTextOnlyMode()` etait
 *   fausse — alors que `isCorrect(i)` compte deja une auto-evaluation
 *   "recall" comme une reponse juste, polluant les statistiques reelles.
 *   `isTextOnlyForAny()` (VRAIE des qu'UNE SEULE question est auto-evaluee)
 *   corrige ca.
 * - FINDING 2 (`resultsSlideHtml`, src/engine/cards.ts) : affichait le
 *   pourcentage QCM des qu'`isTextOnlyMode()` etait fausse — alors qu'une
 *   tranche ENTIEREMENT "recall" n'a produit aucune vraie correction et doit
 *   voir la grille compris/partiel/a revoir. `isTextOnlyForAll()` (VRAIE
 *   seulement si TOUTES les questions sont auto-evaluees) corrige ca.
 *
 * Ce bloc verifie les deux fonctions dérivées elles-mêmes (pas les deux
 * fonctions appelantes, qui exigeraient de simuler tout `render()`).
 */
await withSrcModule("src/engine/text-only.ts", ({ createTextOnlyHandlers }) => {
	const r = makeReporter("Boucle d'apprentissage — isTextOnlyForAny/All (score et ecran de resultats)");

	// ctx factice : un role PAR QUESTION (tableau), pas un seul role global —
	// c'est precisement le melange qui manquait au ctx du bloc precedent.
	const makeCtx = ({ isLesson, practiceMode, roles }) => ({
		quiz: roles.map(() => ({})),
		quizState: { practiceMode },
		isLessonMode: () => isLesson,
		roleOfQuestion: qi => roles[qi]
	});

	// --- isTextOnlyForAny (Finding 1) ---
	const ordinaire = createTextOnlyHandlers(makeCtx({ isLesson: false, practiceMode: "qcm", roles: ["test", "test"] }));
	r.check("quiz ordinaire : isTextOnlyForAny faux, aucune regression sur les stats", ordinaire.isTextOnlyForAny(), false);

	const legacyTexte = createTextOnlyHandlers(makeCtx({ isLesson: false, practiceMode: "text", roles: ["test", "test"] }));
	r.check("mode texte historique (hors Lecon) : isTextOnlyForAny vrai (comportement d'avant, inchange)", legacyTexte.isTextOnlyForAny(), true);

	const leconMixte = createTextOnlyHandlers(makeCtx({ isLesson: true, practiceMode: "qcm", roles: ["test", "recall", "test"] }));
	r.check("Lecon MIXTE (une seule question recall) : isTextOnlyForAny vrai -> le score ne doit PAS etre enregistre (Finding 1)",
		leconMixte.isTextOnlyForAny(), true);

	const leconToutTest = createTextOnlyHandlers(makeCtx({ isLesson: true, practiceMode: "qcm", roles: ["test", "test"] }));
	r.check("Lecon SANS aucun recall : isTextOnlyForAny faux, le score QCM reel reste enregistrable",
		leconToutTest.isTextOnlyForAny(), false);

	// --- isTextOnlyForAll (Finding 2) ---
	const leconToutRecall = createTextOnlyHandlers(makeCtx({ isLesson: true, practiceMode: "qcm", roles: ["recall", "recall"] }));
	r.check("Lecon ENTIEREMENT recall : isTextOnlyForAll vrai -> grille compris/partiel/a revoir (Finding 2, cas exact du bug)",
		leconToutRecall.isTextOnlyForAll(), true);

	r.check("la meme Lecon entierement recall reste isTextOnlyForAny vraie (les deux se recoupent, sans s'exclure)",
		leconToutRecall.isTextOnlyForAny(), true);

	const leconMixte2 = createTextOnlyHandlers(makeCtx({ isLesson: true, practiceMode: "qcm", roles: ["test", "recall"] }));
	r.check("Lecon MIXTE (pas tout recall) : isTextOnlyForAll faux -> garde le pourcentage QCM (hors perimetre de cette tache)",
		leconMixte2.isTextOnlyForAll(), false);

	const legacyTexte2 = createTextOnlyHandlers(makeCtx({ isLesson: false, practiceMode: "text", roles: ["test", "test"] }));
	r.check("mode texte historique (hors Lecon) : isTextOnlyForAll vrai (comportement d'avant, inchange)", legacyTexte2.isTextOnlyForAll(), true);

	const ordinaire2 = createTextOnlyHandlers(makeCtx({ isLesson: false, practiceMode: "qcm", roles: ["test", "test"] }));
	r.check("quiz ordinaire : isTextOnlyForAll faux", ordinaire2.isTextOnlyForAll(), false);

	const quizVide = createTextOnlyHandlers(makeCtx({ isLesson: false, practiceMode: "text", roles: [] }));
	r.check("quiz VIDE (0 question) : isTextOnlyForAll reste faux malgre Array.every trivialement vrai sur []",
		quizVide.isTextOnlyForAll(), false);

	r.done();
});
