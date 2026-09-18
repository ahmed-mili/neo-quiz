/**
 * LE CANAL WEB — ce qui part à un site, et comment une réponse copiée
 * redevient un quiz. Trois fonctions pures, chargées depuis le CODE RÉEL :
 *
 * — `composerPrompts` est l'assemblage que les CLI recevaient DANS la closure
 *   de `createAiClient` ; sorti pour que la page le réutilise, il doit produire
 *   les MÊMES chaînes (nombre, type, source) — sinon un site et un CLI ne
 *   demanderaient pas le même quiz ;
 * — `parseReponseQuiz` lit une réponse copiée : fence, prose autour, LaTeX à
 *   backslash simple, et distingue « pas un quiz » de « quiz mal formé » ;
 * — (tâche 3) `texteWeb`, `preparerOuverture`, `nouveauJeton`, `estCanalCable`.
 *
 *     npm run check:web-channel
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/host/current.ts", "src/dashboard/ai-client.ts"], async (_current, client) => {
	const r = makeReporter("Canal web — prompts et parseur");

	/* ── composerPrompts : les mêmes chaînes que le CLI ── */
	{
		const p = client.composerPrompts("Le droit constitutionnel", { count: 7, type: "Choix unique", source: "text" });
		r.check("le prompt système porte le nombre demandé", p.systemPrompt.includes("Generate exactly 7 quiz questions"), true);
		r.check("le prompt système porte le type demandé", p.systemPrompt.includes("single-choice questions (exactly one correct answer)"), true);
		/* LITTÉRAL, pas `client.PHRASE_FINALE_CLI` : une constante comparée à
		   elle-même ne rougit jamais. Le jour où la phrase finale du CLI change
		   VOLONTAIREMENT, ce littéral est l'alarme — et se met à jour avec elle. */
		const PHRASE_FINALE_CLI_ATTENDUE = "Reply ONLY with the JSON5 array, with no explanation and no formatting.";
		r.check("le prompt système se termine par la phrase finale du CLI", p.systemPrompt.trimEnd().endsWith(PHRASE_FINALE_CLI_ATTENDUE), true);
		r.check("PHRASE_FINALE_CLI vaut la phrase finale du CLI", client.PHRASE_FINALE_CLI, PHRASE_FINALE_CLI_ATTENDUE);
		r.check("une source « text » ouvre le prompt utilisateur sur le texte fourni",
			p.userPrompt.startsWith("Generate a quiz based on the following text"), true);
		r.check("la demande est dans le prompt utilisateur", p.userPrompt.includes("Le droit constitutionnel"), true);
		const d = client.composerPrompts("x", {});
		r.check("sans options : 5 questions, mixte, sujet", [
			d.systemPrompt.includes("Generate exactly 5 quiz questions"),
			d.systemPrompt.includes("a mix of single-choice, multiple-choice and free-text questions"),
			d.userPrompt.startsWith("Generate a quiz about the following topic"),
		], [true, true, true]);
	}

	/* ── parseReponseQuiz : une réponse copiée, dans tous ses états ── */
	{
		const brut = `[{ title: "Q1", prompt: "Combien font 2+2 ?", options: ["3", "4"], correctIndex: 1 }]`;
		r.check("un tableau nu", client.parseReponseQuiz(brut).length, 1);
		const fence = "Voici le quiz demandé :\n\n```json5\n// neo-quiz k7f2q9abcd\n" + brut + "\n```\n\nBon courage !";
		r.check("un tableau dans une fence, avec de la prose autour et le commentaire du jeton",
			client.parseReponseQuiz(fence).length, 1);
		const latex = `[{ title: "F", prompt: "Simplifie $\\frac{2}{4}$", type: "text", answer: "$\\frac{1}{2}$" }]`;
		/* Le modèle écrit `$\frac$` (un backslash) ; la réparation le double dans
		   le SOURCE, et JSON5 rend un seul backslash dans la VALEUR. */
		r.check("le LaTeX à backslash simple est réparé, pas détruit",
			client.parseReponseQuiz(latex)[0].answer, "$\\frac{1}{2}$");
		let e1 = null;
		try { client.parseReponseQuiz("Je ne peux pas générer de quiz sur ce sujet."); } catch (e) { e1 = e.message; }
		r.check("une phrase sans quiz : erreur « pas un quiz », avec l'aperçu", typeof e1 === "string" && e1.includes("Je ne peux pas"), true);
		let e2 = null;
		try { client.parseReponseQuiz(`[{ title: "Q", prompt: "P", options: ["a", "b"], correctIndex: 1 `); } catch (e) { e2 = e.message; }
		r.check("un quiz mal formé garde l'erreur du parseur (position), pas « pas un quiz »",
			typeof e2 === "string" && !e2.includes("title") && /\d+:\d+|JSON5/.test(e2), true);
	}

	r.done();
});
