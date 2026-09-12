/**
 * LA MISE À JOUR AUTOMATIQUE — le noyau pur qui traduit les événements
 * d'electron-updater en un état affichable (`apps/windows/electron/
 * mise-a-jour-etat.ts`). Éprouvé sans Electron ni réseau.
 *
 * Ce que ce script empêche : un état « prête » qui ne retomberait jamais
 * (le bouton du rail resterait après une erreur), un pourcentage qui
 * survivrait au téléchargement fini, et un réglage coupé qui laisserait
 * une vérification en cours afficher « téléchargement ».
 *
 *     npm run check:updater
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/electron/mise-a-jour-etat.ts", ({ ETAT_INITIAL, transition }) => {
	const r = makeReporter("Mise à jour — transitions d'état");
	const auto = { ...ETAT_INITIAL, auto: true };

	r.check("initial : inactif, auto vrai", ETAT_INITIAL, { phase: "inactif", auto: true });
	r.check("checking-for-update : vérification",
		transition(auto, { type: "checking-for-update" }), { phase: "verification", auto: true });
	r.check("update-available : téléchargement à 0 %, version connue",
		transition({ phase: "verification", auto: true }, { type: "update-available", version: "2.5.2" }),
		{ phase: "telechargement", version: "2.5.2", pourcent: 0, auto: true });
	r.check("download-progress : le pourcentage est arrondi et borné",
		transition({ phase: "telechargement", version: "2.5.2", pourcent: 0, auto: true }, { type: "download-progress", percent: 43.7 }),
		{ phase: "telechargement", version: "2.5.2", pourcent: 44, auto: true });
	r.check("update-downloaded : prête, sans pourcentage",
		transition({ phase: "telechargement", version: "2.5.2", pourcent: 99, auto: true }, { type: "update-downloaded", version: "2.5.2" }),
		{ phase: "prete", version: "2.5.2", auto: true });
	r.check("update-not-available : à jour, sans version",
		transition({ phase: "verification", auto: true }, { type: "update-not-available" }),
		{ phase: "a-jour", auto: true });
	r.check("error : erreur avec message, version et pourcentage oubliés",
		transition({ phase: "telechargement", version: "2.5.2", pourcent: 10, auto: true }, { type: "error", message: "net::ERR_INTERNET_DISCONNECTED" }),
		{ phase: "erreur", message: "net::ERR_INTERNET_DISCONNECTED", auto: true });
	r.check("une erreur APRÈS prête ne retire pas la mise à jour téléchargée",
		transition({ phase: "prete", version: "2.5.2", auto: true }, { type: "error", message: "x" }),
		{ phase: "prete", version: "2.5.2", auto: true });
	r.check("reglage false : inactif, tout oublié sauf une mise à jour prête",
		[transition({ phase: "telechargement", version: "2.5.2", pourcent: 10, auto: true }, { type: "reglage", auto: false }),
		 transition({ phase: "prete", version: "2.5.2", auto: true }, { type: "reglage", auto: false })],
		[{ phase: "inactif", auto: false }, { phase: "prete", version: "2.5.2", auto: false }]);
	r.check("reglage true depuis inactif : inactif (la vérification est un événement à part)",
		transition({ phase: "inactif", auto: false }, { type: "reglage", auto: true }), { phase: "inactif", auto: true });
	r.check("checking-for-update quand auto est faux : ignoré (vérification manuelle exceptée par l'appelant)",
		transition({ phase: "inactif", auto: false }, { type: "checking-for-update" }), { phase: "verification", auto: false });
	r.done();
});
