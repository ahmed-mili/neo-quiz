import type { RatioAnchor, SchedulerParams } from "./params";
import { JOUR } from "./params";

/**
 * L'HORIZON PLAFONNE L'INTERVALLE, IL NE L'ORDONNE PAS.
 *
 * Cepeda et al. (2008) ne donnent pas une règle mais une surface : environ
 * 20 à 40 % de l'horizon pour une échéance à une semaine, 5 à 10 % pour une
 * échéance à un an. On interpole logarithmiquement entre ces deux points,
 * et le résultat sert de PLAFOND — pas de progression imposée, ce que
 * Karpicke & Roediger interdisent explicitement.
 *
 * Comme l'horizon est le temps RESTANT, trois comportements tombent sans
 * qu'aucune règle soit écrite : un examen qui approche resserre les
 * révisions, un examen passé retombe sur le régime durable, et l'urgence
 * n'a pas besoin d'un terme de priorité à elle (plan.ts).
 */

/** Coefficients de ratio(H) = a - b·ln(H_jours), DÉRIVÉS des ancrages.
    Jamais écrits en dur : sinon déplacer un ancrage ne changerait rien et
    le paramètre ne serait qu'un décor. */
export function ratioCoefficients(low: RatioAnchor, high: RatioAnchor): { a: number; b: number } {
	const b = (low.ratio - high.ratio) / (Math.log(high.days) - Math.log(low.days));
	const a = low.ratio + b * Math.log(low.days);
	return { a, b };
}

/**
 * Fraction de l'horizon à laisser passer entre deux révisions.
 *
 * H est BORNÉ au domaine des deux ancrages : hors de là, on n'extrapole
 * pas. Sans ce bornage la formule devient absurde — le ratio s'annule vers
 * 1364 jours puis devient négatif, et un horizon de trois ans donnerait un
 * plafond PLUS COURT qu'un horizon d'un an.
 */
export function retentionRatio(horizonMs: number, params: SchedulerParams): number {
	const [low, high] = params.ratioAncres;
	const { a, b } = ratioCoefficients(low, high);
	const jours = Math.min(Math.max(horizonMs / JOUR, low.days), high.days);
	return a - b * Math.log(jours);
}

/** Plafond d'intervalle. Strictement croissant en H sur tout le domaine :
    sur [7, 365] sa dérivée vaut ratio(H) - b, positive puisque ratio ≥ 0,075
    et b ≈ 0,0569 ; au-delà elle est linéaire. */
export function intervalCeiling(horizonMs: number, params: SchedulerParams): number {
	return retentionRatio(horizonMs, params) * horizonMs;
}

/**
 * Horizon effectif d'un module à l'instant `now`.
 *
 * Un examen PASSÉ retombe sur l'horizon par défaut : après le partiel le
 * cours reste à retenir, et la note de méthode interdit la sortie du
 * système après une réussite. Aucune intervention de l'utilisateur n'est
 * requise le lendemain de son examen.
 */
export function horizonFor(examAt: number | null | undefined, now: number, params: SchedulerParams): number {
	if (typeof examAt !== "number" || examAt <= now) return params.horizonDefaut;
	return examAt - now;
}
