/**
 * L'ATTENTE D'UNE RÉPONSE COPIÉE, côté principal (canal web, spec du
 * 2026-09-18, §4). Le noyau est PUR : le presse-papier et le temps sont des
 * ENTRÉES, ce qui permet d'éprouver ici, sans Electron, ce qui ne doit
 * jamais fuir :
 *
 * — un texte qui ne porte pas le jeton n'est JAMAIS livré, même relu cent
 *   fois : c'est la seule chose qui rend acceptable une lecture du
 *   presse-papier par l'application ;
 * — un jeton trop court est refusé : vide, il ferait reconnaître n'importe
 *   quoi ;
 * — une seule livraison, puis la sonde s'arrête ; `arreter()` et l'échéance
 *   de trente minutes l'arrêtent aussi ; une nouvelle attente remplace la
 *   précédente sans que celle-ci puisse encore livrer.
 *
 *     npm run check:electron-collage
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/* Un temps qu'on avance à la main : `tic(ms)` fait passer les échéances
   dans l'ordre, une par une. */
function fauxTemps() {
	let t = 0;
	let prochainId = 1;
	const echeances = new Map();
	return {
		horloge: {
			planifier(fn, ms) { const id = prochainId++; echeances.set(id, { a: t + ms, fn }); return id; },
			annuler(id) { echeances.delete(id); },
			maintenant() { return t; },
		},
		tic(ms) {
			const cible = t + ms;
			for (;;) {
				const due = [...echeances.entries()].filter(([, e]) => e.a <= cible).sort((x, y) => x[1].a - y[1].a)[0];
				if (!due) break;
				echeances.delete(due[0]);
				t = due[1].a;
				due[1].fn();
			}
			t = cible;
		},
		enAttente() { return echeances.size; },
	};
}

await withSrcModule("apps/windows/electron/attente-collage.ts", ({ creerAttente, ressembleAReponse, jetonValide, CADENCE_MS, ECHEANCE_MS }) => {
	const r = makeReporter("Attente d'une réponse copiée");

	r.check("un jeton de huit caractères [a-z0-9] ou plus est valide", ["k7f2q9ab", "k7f2q9abcd"].map(jetonValide), [true, true]);
	r.check("trop court, vide, majuscules, non-chaîne : refusés", ["k7f2q9a", "", "K7F2Q9ABCD", "k7f2 q9abcd", 42, null].map(jetonValide), [false, false, false, false, false, false]);

	const scene = () => {
		const temps = fauxTemps();
		let presse = "";
		const livres = [];
		const attente = creerAttente({ lire: () => presse, horloge: temps.horloge, livrer: t => livres.push(t) });
		return { temps, attente, livres, poser: t => { presse = t; } };
	};

	{
		const s = scene();
		r.check("un jeton invalide ne démarre rien", [s.attente.demarrer("court"), s.attente.enCours(), s.temps.enAttente()], [false, false, 0]);
	}
	{
		const s = scene();
		s.attente.demarrer("k7f2q9abcd");
		s.poser("mot de passe: hunter2");
		s.temps.tic(CADENCE_MS * 100);
		r.check("sans le jeton, rien n'est livré, même après cent tours", [s.livres, s.attente.enCours()], [[], true]);
	}
	{
		const s = scene();
		s.attente.demarrer("k7f2q9abcd");
		s.temps.tic(CADENCE_MS * 3);
		s.poser("```json5\n// neo-quiz k7f2q9abcd\n[{ prompt: \"x\" }]\n```");
		s.temps.tic(CADENCE_MS);
		r.check("avec le jeton : livré une fois, et l'attente s'arrête", [s.livres.length, s.attente.enCours(), s.temps.enAttente()], [1, false, 0]);
		s.temps.tic(CADENCE_MS * 10);
		r.check("elle ne relit plus, donc ne relivre pas", s.livres.length, 1);
	}
	{
		/* LE PROMPT COPIÉ PAR L'APPLICATION porte le jeton (la consigne de
		   forme le cite). Sans exclusion, la première sonde le livrait comme
		   réponse et la page disait « pas un quiz » avant tout collage — vu
		   par Ahmed le 2026-09-19 sur chaque génération avec fichiers joints,
		   où le prompt passe par le presse-papier. */
		const s = scene();
		const prompt = "You are a quiz generator… whose FIRST line is exactly the comment `// neo-quiz k7f2q9abcd`…";
		s.attente.demarrer("k7f2q9abcd", prompt);
		s.poser(prompt);
		s.temps.tic(CADENCE_MS * 5);
		r.check("le texte que l'app a elle-même copié n'est jamais livré, même s'il porte le jeton", [s.livres, s.attente.enCours()], [[], true]);
		s.poser("```json5\n// neo-quiz k7f2q9abcd\n[{ prompt: \"x\" }]\n```");
		s.temps.tic(CADENCE_MS);
		r.check("…et la vraie réponse, ensuite, l'est", [s.livres.length, s.attente.enCours()], [1, false]);
	}
	{
		const s = scene();
		s.attente.demarrer("k7f2q9abcd");
		s.attente.arreter();
		s.poser("// neo-quiz k7f2q9abcd");
		s.temps.tic(CADENCE_MS * 5);
		r.check("arreter() coupe : plus de sonde, rien de livré", [s.livres, s.attente.enCours(), s.temps.enAttente()], [[], false, 0]);
	}
	{
		const s = scene();
		s.attente.demarrer("k7f2q9abcd");
		s.temps.tic(ECHEANCE_MS + CADENCE_MS);
		s.poser("// neo-quiz k7f2q9abcd");
		s.temps.tic(CADENCE_MS * 5);
		r.check("après trente minutes, l'attente s'est arrêtée d'elle-même", [s.livres, s.attente.enCours(), s.temps.enAttente()], [[], false, 0]);
	}
	{
		const s = scene();
		s.attente.demarrer("premier1234");
		s.attente.demarrer("second12345");
		s.poser("réponse quelconque premier1234");
		s.temps.tic(CADENCE_MS * 3);
		r.check("une nouvelle attente remplace la première : son jeton ne livre plus", [s.livres, s.attente.enCours()], [[], true]);
		s.poser("// neo-quiz second12345\n[{ prompt: \"x\" }]");
		s.temps.tic(CADENCE_MS);
		r.check("et le jeton de la seconde livre", s.livres.length, 1);
	}
	{
		/* Un modèle qui RÉÉCRIT le jeton (Haiku 4.5, 2026-09-19) : la forme
		   `// neo-quiz …` suffit. Mais pas ce qui était déjà dans le
		   presse-papier au départ (la réponse d'une génération d'avant). */
		const s = scene();
		s.poser("// neo-quiz ancien12345\n[{ prompt: \"vieux\" }]");
		s.attente.demarrer("k7f2q9abcd");
		s.temps.tic(CADENCE_MS * 3);
		r.check("la réponse déjà présente au départ n'est pas livrée, même à la bonne forme", [s.livres, s.attente.enCours()], [[], true]);
		r.check("la référence est lue à 0 ms : une copie faite dans la demi-seconde qui suit compte", (() => {
			const s2 = scene();
			s2.poser("// neo-quiz ancien12345\n[{ prompt: \"vieux\" }]");
			s2.attente.demarrer("k7f2q9abcd");
			s2.temps.tic(0);
			s2.poser("[{ prompt: \"copié 200 ms après Ouvrir\" }]");
			s2.temps.tic(CADENCE_MS);
			return s2.livres.length;
		})(), 1);
		s.poser("```json5\n// neo-quiz xti301tp1_types_lists\n[{ prompt: \"x\" }]\n```");
		s.temps.tic(CADENCE_MS);
		r.check("un jeton réécrit par le modèle est livré quand même (la forme fait foi)", [s.livres.length, s.attente.enCours()], [1, false]);
		r.check("ressembleAReponse : forme reconnue, prose refusée", [
			ressembleAReponse("// neo-quiz k7f2q9abcd\n[{ prompt: 'a' }]"), ressembleAReponse("```json5\n// NEO-QUIZ abc\n[{ prompt: 'a' }]\n```"),
			/* Haiku, 2026-09-19 : ni jeton ni neo-quiz, `// title:` seul, une ligne vide, puis le tableau. */
			ressembleAReponse("// title: Python - Types\n\n[\n  {\n    title: \"T\",\n    prompt: \"Q\",\n  }\n]"),
			ressembleAReponse("[{ title: 'x', prompt: 'y' }]"),
			ressembleAReponse("Voici :\n// neo-quiz abc\n[{ prompt: 'a' }]"), ressembleAReponse("mot de passe: hunter2"), ressembleAReponse("[1, 2, 3]"),
		], [true, true, true, true, false, false, false]);
	}
	{
		const s = scene();
		s.attente.demarrer("k7f2q9abcd");
		r.check("une seule sonde à la fois", s.temps.enAttente(), 1);
	}
	{
		const s = scene();
		let tentatives = 0;
		const attenteFailing = creerAttente({
			/* Deux lectures qui lèvent, puis la référence (ce qui était là), puis la réponse. */
			lire: () => { tentatives++; if (tentatives <= 2) throw new Error("clipboard unavailable"); return tentatives === 3 ? "déjà là" : "// neo-quiz k7f2q9abcd"; },
			horloge: s.temps.horloge,
			livrer: t => s.livres.push(t),
		});
		attenteFailing.demarrer("k7f2q9abcd");
		s.temps.tic(CADENCE_MS * 4);
		r.check("un presse-papier qui lève ne tue pas l'attente : la sonde réessaie au tour suivant", [s.livres.length, attenteFailing.enCours()], [1, false]);
	}

	r.done();
});

/* Le câblage réel importe Electron : on isole son bloc, sans le recopier.
   La lecture différée expose l'annulation en vol et entre microtâches. */
const { readFileSync } = await import("node:fs");
const { runInNewContext } = await import("node:vm");
const { transform } = await import("esbuild");
const sourcePont = readFileSync("apps/windows/electron/canaux.ts", "utf8");
const debutPont = sourcePont.indexOf('let dernierTexteCopie = "";');
const finPont = sourcePont.indexOf("ipcMain.handle(CANAUX.collageAttendre", debutPont);
if (debutPont < 0 || finPont < 0) throw new Error("Bloc de veille introuvable");
const codePont = (await transform(sourcePont.slice(debutPont, finPont), { loader: "ts" })).code;
await withSrcModule("apps/windows/electron/attente-collage.ts", async ({ creerAttente }) => {
	const r = makeReporter("Pont collage asynchrone");
	function scene() {
		const temps = fauxTemps();
		const lectures = [];
		const livres = [];
		return runInNewContext(codePont + `;({ attente, temps, lectures, livres, cacheVide: () => dernierTexteCopie === "" })`, {
			creerAttente, temps, lectures, livres,
			setTimeout: temps.horloge.planifier, clearTimeout: temps.horloge.annuler,
			Date: { now: temps.horloge.maintenant },
			clipboard: { readText: () => new Promise((resolve, reject) => lectures.push({ resolve, reject })) },
			deps: { envoyer: (_canal, texte) => livres.push(texte), fenetreCourante: () => null },
			CANAUX: { collageTexte: "texte" },
		});
	}
	const viderMicrotaches = () => new Promise(resolve => setImmediate(resolve));
	for (const entreMicrotaches of [false, true]) {
		const s = scene();
		s.attente.demarrer("premier1234");
		s.temps.tic(0);
		if (!entreMicrotaches) s.attente.arreter();
		s.lectures[0].resolve("texte privé sans jeton");
		if (entreMicrotaches) { await Promise.resolve(); s.attente.arreter(); }
		await viderMicrotaches();
		r.check(`annulation ${entreMicrotaches ? "entre microtâches" : "pendant readText"} : rien retenu ni relancé`,
			[s.cacheVide(), s.temps.enAttente(), s.livres.length], [true, 0, 0]);
	}
	{
		const s = scene();
		s.attente.demarrer("premier1234"); s.temps.tic(0);
		s.attente.demarrer("second12345"); s.temps.tic(0);
		s.lectures[1].resolve("ce qui était déjà là"); // la référence de la seconde
		await viderMicrotaches();
		s.temps.tic(500);
		s.lectures[2].resolve("// neo-quiz second12345\n[{ prompt: \"x\" }]");
		await viderMicrotaches();
		s.lectures[0].resolve("texte privé de l'ancienne lecture");
		await viderMicrotaches();
		r.check("ancienne lecture résolue après livraison : cache vide, une seule livraison",
			[s.cacheVide(), s.temps.enAttente(), s.livres.length], [true, 0, 1]);
	}
	{
		const s = scene();
		s.attente.demarrer("premier1234"); s.temps.tic(0);
		s.lectures[0].reject(new Error("indisponible"));
		await viderMicrotaches();
		r.check("lecture refusée : une seule nouvelle sonde et aucun cache", [s.temps.enAttente(), s.cacheVide()], [1, true]);
		s.temps.tic(500); s.lectures[1].resolve("// neo-quiz premier1234\n[{ prompt: \"x\" }]");
		await viderMicrotaches();
		r.check("lecture suivante valide : livrée puis oubliée", [s.livres.length, s.cacheVide(), s.temps.enAttente()], [1, true, 0]);
	}
	r.done();
});
