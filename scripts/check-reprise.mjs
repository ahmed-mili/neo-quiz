/**
 * ROUVRIR LÀ OÙ ON S'ÉTAIT ARRÊTÉ — le noyau pur qui relit une `DerniereVue`
 * depuis une valeur BRUTE lue du disque (`apps/windows/src/ui/reprise.ts`,
 * `lireDerniereVue`). Éprouvé sans Electron ni fenêtre : c'est la seule
 * fonction du module qui ne passe pas par `pont()`.
 *
 * Ce que ce script empêche : un fichier de réglages trafiqué ou antérieur
 * (vue inconnue, quiz manquant sur "detail", question négative ou non
 * entière) qui ferait planter le démarrage au lieu de faire retomber
 * proprement sur l'accueil.
 *
 *     npm run check:reprise
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/ui/reprise.ts", ({ lireDerniereVue }) => {
	const r = makeReporter("Reprise — lireDerniereVue");

	r.check("undefined : null", lireDerniereVue(undefined), null);
	r.check("une chaîne : null", lireDerniereVue("home"), null);
	r.check("detail sans quiz : null", lireDerniereVue({ vue: "detail" }), null);
	r.check("un quiz non-chaîne est ignoré hors détail",
		lireDerniereVue({ vue: "home", quiz: 3 }), { vue: "home" });
	r.check("detail avec quiz et question : reconduit tel quel",
		lireDerniereVue({ vue: "detail", quiz: "Cours/a.md", question: 2 }),
		{ vue: "detail", quiz: "Cours/a.md", question: 2 });
	r.check("question négative : absente",
		lireDerniereVue({ vue: "detail", quiz: "a.md", question: -1 }),
		{ vue: "detail", quiz: "a.md" });
	r.check("question non entière : absente",
		lireDerniereVue({ vue: "detail", quiz: "a.md", question: 1.5 }),
		{ vue: "detail", quiz: "a.md" });
	r.check("question en chaîne : absente",
		lireDerniereVue({ vue: "detail", quiz: "a.md", question: "2" }),
		{ vue: "detail", quiz: "a.md" });
	r.check("vue inconnue : null", lireDerniereVue({ vue: "reglages" }), null);

	r.done();
});
