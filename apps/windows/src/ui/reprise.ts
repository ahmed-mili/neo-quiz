/* ══════════════════════════════════════════════════════════
   ROUVRIR LÀ OÙ ON S'ÉTAIT ARRÊTÉ

   `lireDerniereVue` est PURE (aucun `pont()`, aucun DOM) : c'est elle que
   `scripts/check-reprise.mjs` éprouve, sur une valeur BRUTE lue du disque —
   qui peut avoir été écrite par une version antérieure, ou être n'importe
   quoi si le fichier de réglages a été trafiqué à la main. Les trois autres
   fonctions passent par `pont()`, lu à l'APPEL et jamais capturé au
   chargement du module — même règle que `mise-a-jour.ts`, pour que
   `npm run check:windows-host` (qui installe un faux `window.neo` APRÈS
   l'import) puisse les éprouver.
══════════════════════════════════════════════════════════ */

import { pont } from "../host/pont";
import { CLE_DERNIERE_VUE, CLE_REGLAGES_REPRISE } from "../../electron/pont";
import type { DashboardViewName } from "../../../../src/types/dashboard-ctx";

export interface DerniereVue {
	vue: DashboardViewName;
	/** Chemin du quiz — présent seulement pour `vue: "detail"`, et pas
	    davantage validé ici : c'est au scanner de dire si la note existe
	    encore (`Scanner.getQuiz`), pas à ce module de le deviner. */
	quiz?: string;
	/** Index de la question courante, borné par la page elle-même
	    (`detail.ts`) à la relecture du brouillon. */
	question?: number;
}

const VUES: readonly DashboardViewName[] = ["home", "quizzes", "ai", "detail"];

/** Relit une `DerniereVue` depuis une valeur BRUTE (JSON de `neo.reglages`),
    sans jamais faire confiance à sa forme : un fichier de réglages plus
    ancien, ou modifié à la main, ne doit pas faire planter le démarrage.
    `null` si la valeur ne décrit rien d'exploitable. */
export function lireDerniereVue(brut: unknown): DerniereVue | null {
	if (typeof brut !== "object" || brut === null) return null;
	const objet = brut as Record<string, unknown>;
	const vue = objet.vue;
	if (typeof vue !== "string" || !VUES.includes(vue as DashboardViewName)) return null;
	if (vue === "detail" && typeof objet.quiz !== "string") return null;

	const resultat: DerniereVue = { vue: vue as DashboardViewName };
	// Un quiz non-chaîne est IGNORÉ hors détail (il ne sert à rien ailleurs),
	// mais une vue "detail" sans quiz est déjà rejetée ci-dessus.
	if (typeof objet.quiz === "string") resultat.quiz = objet.quiz;
	const question = objet.question;
	if (typeof question === "number" && Number.isInteger(question) && question >= 0) {
		resultat.question = question;
	}
	return resultat;
}

/** Lit le réglage au démarrage : l'interrupteur (défaut `true` — reprendre
    est le comportement attendu, seul l'`!== false` explicite d'un fichier
    déjà écrit le désactive) et la dernière vue connue. */
export async function chargerReprise(): Promise<{ actif: boolean; vue: DerniereVue | null }> {
	const [actifBrut, vueBrute] = await Promise.all([
		pont().reglages.lire(CLE_REGLAGES_REPRISE),
		pont().reglages.lire(CLE_DERNIERE_VUE),
	]);
	return { actif: actifBrut !== false, vue: lireDerniereVue(vueBrute) };
}

/** Écrit l'interrupteur : appelé une seule fois, au changement, jamais à
    chaque frappe — même geste que `reglerAuto` de la mise à jour. */
export async function reglerReprise(actif: boolean): Promise<void> {
	await pont().reglages.ecrire(CLE_REGLAGES_REPRISE, actif);
}

let minuterie: number | null = null;

/** Note la vue courante, DÉBOUNCÉE de 500 ms : la question courante change
    à chaque flèche, et écrire à chaque coup ferait une écriture disque par
    touche. La minuterie est remplacée à chaque appel, jamais empilée. */
export function noterVue(vue: DerniereVue): void {
	if (minuterie !== null) window.clearTimeout(minuterie);
	minuterie = window.setTimeout(() => {
		minuterie = null;
		void pont().reglages.ecrire(CLE_DERNIERE_VUE, vue);
	}, 500);
}
