/** Ancrage de la courbe de Cepeda : à cet horizon, cette fraction. */
export interface RatioAnchor { days: number; ratio: number; }

/**
 * PARAMÈTRES DE L'ORDONNANCEUR.
 *
 * Trois statuts, et il faut les distinguer :
 *   ANCRÉ      — vient d'un résultat mesuré de la littérature ;
 *   DÉRIVÉ     — conséquence d'une contrainte de la méthode ;
 *   ARBITRAIRE — choisi pour partir de quelque part, à régler à l'usage.
 *
 * Huit des onze valeurs sont ARBITRAIRES. Le journal étant rejouable,
 * changer l'une d'elles recalcule tout l'historique déjà accumulé : le
 * réglage se fera sur des données réelles, pas sur les six semaines
 * suivantes. Tableau complet, avec ce qui ferait changer chaque valeur :
 * spec §8.
 */
export interface SchedulerParams {
	/** ANCRÉ (Cepeda et al. 2008). Les deux seuls points mesurés. */
	ratioAncres: [RatioAnchor, RatioAnchor];
	/** DÉRIVÉ : l'ancrage bas EST le régime « retenir durablement ». */
	horizonDefaut: number;
	/** ARBITRAIRE : convention héritée de J1. */
	intervalleInitial: number;
	/** ARBITRAIRE. La forme de la progression n'a pas de statut privilégié
	    (Karpicke & Roediger) : c'est le PLAFOND qui fait le travail. */
	facteurSucces: number;
	/** ARBITRAIRE : un succès amorti reste un succès. */
	facteurPartiel: number;
	/** ARBITRAIRE. */
	intervalleEchec: number;
	/** DÉRIVÉ : « corriger l'erreur près de la tentative, espacer la
	    récupération suivante » interdit le re-test dans la séance. */
	intervalleMin: number;
	/** ARBITRAIRE : environ 20 min à 30 s la question. */
	budgetJour: number;
	/** ARBITRAIRE. Sans ce quota, une génération de 80 questions noierait
	    toutes les révisions le jour même : c'est le mur des mille cartes
	    vu depuis l'ordonnanceur. */
	partNeuf: number;
	/** ARBITRAIRE. Sert DEUX fois : l'anticipation du lissage, et le
	    garde-fou de double révision (state.ts). Un seul seuil à régler. */
	margeAnticipation: number;
	/** ARBITRAIRE : profondeur de la projection de charge, en jours. */
	fenetreLissage: number;
}

export const HEURE = 3600000;
export const JOUR = 86400000;

export const DEFAULT_PARAMS: SchedulerParams = {
	ratioAncres: [{ days: 7, ratio: 0.30 }, { days: 365, ratio: 0.075 }],
	horizonDefaut: 365 * JOUR,
	intervalleInitial: JOUR,
	facteurSucces: 2.0,
	facteurPartiel: 1.2,
	intervalleEchec: JOUR,
	intervalleMin: 4 * HEURE,
	budgetJour: 40,
	partNeuf: 0.25,
	margeAnticipation: 0.20,
	fenetreLissage: 14,
};
