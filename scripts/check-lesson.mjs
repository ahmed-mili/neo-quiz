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
