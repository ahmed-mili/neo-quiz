/**
 * LA LANGUE DE L'INTERFACE — le noyau pur qui relit le réglage `language`
 * depuis une valeur BRUTE (`apps/windows/src/ui/langue.ts`, `lireLangue`).
 * Cette valeur peut avoir été écrite par la page Réglages, par le
 * BOOTSTRAPPER d'installation (`apps/windows/installer/main.ts`,
 * `ecrireLangueApplication`) ou à la main : tout ce qui n'est pas l'une des
 * trois valeurs vaut « auto », jamais une erreur au démarrage.
 *
 *     npm run check:langue
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/ui/langue.ts", ({ lireLangue }) => {
	const r = makeReporter("Langue — lireLangue");
	r.check("undefined : auto", lireLangue(undefined), "auto");
	r.check("null : auto", lireLangue(null), "auto");
	r.check("« fr » (écrit par le bootstrapper) : fr", lireLangue("fr"), "fr");
	r.check("« en » : en", lireLangue("en"), "en");
	r.check("« auto » : auto", lireLangue("auto"), "auto");
	r.check("une langue inconnue : auto", lireLangue("de"), "auto");
	r.check("un objet : auto", lireLangue({ language: "fr" }), "auto");
	r.check("la casse compte (« FR » n'est pas une valeur) : auto", lireLangue("FR"), "auto");
	r.done();
});
