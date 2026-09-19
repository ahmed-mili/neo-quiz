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

await withSrcModule(
	["src/host/current.ts", "src/dashboard/ai-client.ts", "src/dashboard/ai-web.ts", "src/dashboard/ai-providers.ts"],
	async (_current, client, web, providers) => {
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
		r.check("un tableau nu", client.parseReponseQuiz(brut).questions.length, 1);
		r.check("… sans titre : `titre` absent, le nom viendra de la demande", client.parseReponseQuiz(brut).titre, undefined);
		const fence = "Voici le quiz demandé :\n\n```json5\n// neo-quiz k7f2q9abcd\n" + brut + "\n```\n\nBon courage !";
		r.check("un tableau dans une fence, avec de la prose autour et le commentaire du jeton",
			client.parseReponseQuiz(fence).questions.length, 1);
		/* Le titre choisi par le modèle : `// title:` en tête du tableau, y
		   compris derrière le jeton du canal web. Il est nettoyé pour un nom
		   de fichier ; un `// title:` plus loin dans le tableau est ignoré. */
		const titre = "```json5\n// neo-quiz k7f2q9abcd\n[\n// title: Python : types, listes et exceptions.\n" + brut.slice(1) + "\n```";
		r.check("le titre en commentaire de tête, derrière le jeton, sans son point final",
			client.parseReponseQuiz(titre).titre, "Python - types, listes et exceptions");
		const titreLoin = "[\n" + brut.slice(1, -1) + ",\n// title: pas celui-là\n{ title: \"Q2\", prompt: \"P\" }]";
		r.check("un « title: » loin dans le tableau n'est pas le titre", client.parseReponseQuiz(titreLoin).titre, undefined);
		r.check("nettoyerTitre : guillemets, caractères interdits, point final",
			client.nettoyerTitre(' "Réseaux : couche 2/3 ?" '), "Réseaux - couche 2 3");
		r.check("nettoyerTitre : rien ne reste → undefined", client.nettoyerTitre(" ... "), undefined);
		/* Copié depuis le bouton du bloc de code de claude.ai : PAS de fence
		   autour, mais un bloc ```python DANS l'énoncé d'une question (vécu le
		   2026-09-19 : « pas un quiz »). */
		const python = '// neo-quiz 57da3fkubx\n[\n  // title: Programmation Python : E/S\n  { title: "print", prompt: "Que produit :\\n\\n```python\\na = 26\\nprint(a)\\n```", options: ["26", "27"], correctIndex: 0 }\n]';
		const lu = client.parseReponseQuiz(python);
		r.check("un bloc de code dans un énoncé n'est pas pris pour la fence du quiz", [lu.questions.length, lu.titre], [1, "Programmation Python - E S"]);
		const pythonFence = "```json5\n" + python + "\n```";
		r.check("… ni quand le tout est dans une fence", client.parseReponseQuiz(pythonFence).questions.length, 1);
		const latex = `[{ title: "F", prompt: "Simplifie $\\frac{2}{4}$", type: "text", answer: "$\\frac{1}{2}$" }]`;
		/* Le modèle écrit `$\frac$` (un backslash) ; la réparation le double dans
		   le SOURCE, et JSON5 rend un seul backslash dans la VALEUR. */
		r.check("le LaTeX à backslash simple est réparé, pas détruit",
			client.parseReponseQuiz(latex).questions[0].answer, "$\\frac{1}{2}$");
		let e1 = null;
		try { client.parseReponseQuiz("Je ne peux pas générer de quiz sur ce sujet."); } catch (e) { e1 = e.message; }
		r.check("une phrase sans quiz : erreur « pas un quiz », avec l'aperçu", typeof e1 === "string" && e1.includes("Je ne peux pas"), true);
		let e2 = null;
		try { client.parseReponseQuiz(`[{ title: "Q", prompt: "P", options: ["a", "b"], correctIndex: 1 `); } catch (e) { e2 = e.message; }
		r.check("un quiz mal formé garde l'erreur du parseur (position), pas « pas un quiz »",
			typeof e2 === "string" && !e2.includes("title") && /\d+:\d+|JSON5/.test(e2), true);
	}

	r.done();

	const r2 = makeReporter("Canal web — texte, jeton, ouverture, câblage");

	/* ── texteWeb : la consigne de forme remplace la phrase du CLI ── */
	{
		const prompts = client.composerPrompts("Sujet", { count: 3 });
		const texte = web.texteWeb(prompts, "k7f2q9abcd");
		r2.check("le texte porte le jeton en commentaire de première ligne du bloc", texte.includes("// neo-quiz k7f2q9abcd"), true);
		r2.check("il demande un bloc de code json5", texte.includes("```json5"), true);
		r2.check("la phrase finale du CLI n'y est plus", texte.includes(client.PHRASE_FINALE_CLI), false);
		r2.check("les deux prompts y sont, dans l'ordre", texte.indexOf("You are a quiz generator") < texte.indexOf("Generate a quiz about the following topic"), true);
		/* La phrase « Your ONLY output is the JSON5 array. » du paragraphe NO
		   TOOLS contredirait la consigne de forme (un bloc de code) — elle ne
		   doit plus être dans le texte WEB, jamais dans le texte CLI. */
		r2.check("la phrase de sortie du CLI (JSON5 array) n'est plus dans le texte web",
			texte.includes("Your ONLY output is the JSON5 array."), false);
		r2.check("le texte CLI garde cette phrase intacte (identique octet pour octet)",
			client.PHRASE_FINALE_CLI !== "" && prompts.systemPrompt.includes("Your ONLY output is the JSON5 array."), true);
	}

	/* ── nouveauJeton ── */
	{
		const a = web.nouveauJeton(), b = web.nouveauJeton();
		r2.check("dix caractères de [a-z0-9]", /^[a-z0-9]{10}$/.test(a), true);
		r2.check("deux tirages diffèrent", a === b, false);
	}

	/* ── preparerOuverture ── */
	{
		const site = { nouvelle: "https://claude.ai/new", parametre: "q" };
		const court = web.preparerOuverture("Bonjour à tous", site, 200);
		r2.check("sous la borne : l'adresse porte le texte encodé",
			court, { mode: "url", url: "https://claude.ai/new?q=Bonjour%20%C3%A0%20tous" });
		const long = web.preparerOuverture("x".repeat(500), site, 200);
		r2.check("au-delà : le presse-papier, l'adresse nue, le texte intact",
			[long.mode, long.url, long.texte.length], ["presse-papier", "https://claude.ai/new", 500]);
		const exact = web.preparerOuverture("abc", site, "https://claude.ai/new?q=abc".length);
		r2.check("la borne exacte passe encore par l'adresse", exact.mode, "url");
	}

	/* ── estCanalCable ── */
	r2.check("claude.ai est câblé", providers.estCanalCable("claude-web"), true);
	r2.check("chatgpt.com ne l'est pas encore", providers.estCanalCable("chatgpt-web"), false);
	r2.check("un CLI n'est pas un canal web câblé", providers.estCanalCable("claude-code"), false);

	r2.done();
});

/* Exécute les fonctions réelles de la closure pour les refus d'ouverture.
   Les dépendances DOM/CLI ne sont pas appelées sur ces chemins. */
const { readFileSync } = await import("node:fs");
const { runInNewContext } = await import("node:vm");
const { transform } = await import("esbuild");
const sourcePage = readFileSync("src/dashboard/ai.ts", "utf8");
const noms = ["startGeneration", "ouvrirSite", "arreterAttenteWeb", "takeComposerMessage", "dropSentMessage", "restoreComposerMessage", "composerIsEmpty"];
const fonctions = noms.map(nom => {
	const debut = sourcePage.search(new RegExp(`\\t(?:async )?function ${nom}\\(`));
	const fin = sourcePage.indexOf("\n\t}", debut);
	if (debut < 0 || fin < 0) throw new Error(`Fonction introuvable : ${nom}`);
	return sourcePage.slice(debut, fin + 3);
});
const codePage = (await transform(fonctions.join("\n"), { loader: "ts" })).code;
const refus = makeReporter("Canal web : refus pendant une attente");
for (const avecImage of [false, true]) {
	const contexte = {
		phase: "web", demarrage: false, composerText: "Nouvelle demande", composerCaret: null,
		noteAttachments: [], images: avecImage ? [{ url: "blob:test" }] : [],
		sentMessage: { text: "Demande précédente", images: [], notes: [] }, sentAnimPending: false,
		arrets: 0, retraits: 0, rendus: [],
		attachPromptPaths: async () => {}, couperSondeConnexion: () => {},
		settings: () => ({ aiProvider: avecImage ? "claude-web" : "chatgpt-web" }),
		aiProviders: { estCanalWeb: () => true, getCanal: () => ({ label: "site", web: avecImage ? {} : undefined }) },
		host: { ui: { notice: () => {} } }, t: cle => cle,
	};
	contexte.attenteWeb = { arreter: () => contexte.arrets++, retirer: () => contexte.retraits++ };
	contexte.render = () => contexte.rendus.push(contexte.phase);
	await runInNewContext(codePage + "; startGeneration({})", contexte);
	refus.check(`${avecImage ? "image refusée" : "site non câblé"} : attente arrêtée, demande restaurée et écran idle`,
		[contexte.phase, contexte.attenteWeb, contexte.composerText, contexte.images.length, contexte.arrets, contexte.retraits, contexte.rendus],
		["idle", null, "Nouvelle demande", avecImage ? 1 : 0, 1, 1, ["idle"]]);
}
refus.done();
