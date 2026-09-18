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

await withSrcModule("apps/windows/electron/attente-collage.ts", ({ creerAttente, jetonValide, CADENCE_MS, ECHEANCE_MS }) => {
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
		s.poser("// neo-quiz premier1234");
		s.temps.tic(CADENCE_MS * 3);
		r.check("une nouvelle attente remplace la première : son jeton ne livre plus", [s.livres, s.attente.enCours()], [[], true]);
		s.poser("// neo-quiz second12345");
		s.temps.tic(CADENCE_MS);
		r.check("et le jeton de la seconde livre", s.livres.length, 1);
	}
	{
		const s = scene();
		s.attente.demarrer("k7f2q9abcd");
		r.check("une seule sonde à la fois", s.temps.enAttente(), 1);
	}

	r.done();
});
