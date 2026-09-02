import type { ItemState, ReviewEvent, ScheduledItem } from "./types";
import type { SchedulerParams } from "./params";
import { horizonFor, intervalCeiling } from "./horizon";

/**
 * L'ÉTAT EST DÉRIVÉ, JAMAIS PERSISTÉ.
 *
 * Le journal fait foi ; l'échéance de chaque question est recalculée à
 * chaque appel. C'est ce qui permet de changer un paramètre et de rejouer
 * tout l'historique déjà accumulé — le réglage se fera sur des données
 * réelles plutôt que sur les six semaines suivantes. Un état résumé mis à
 * jour au fil de l'eau aurait été plus compact, et irréversible.
 */

export type Signal = "success" | "partial" | "fail" | null;

/**
 * Ce que vaut une réponse pour la mémoire.
 *
 * Un événement de rôle `pre` ne vaut RIEN, quel que soit son verdict : chez
 * Richland, Kornell & Kao (2009), c'est le groupe qui a essayé de répondre
 * et échoué qui a le mieux appris. L'échec y est le mécanisme, pas le
 * symptôme d'un oubli — le compter ferait revenir en boucle les questions
 * que la méthode fait délibérément rater.
 */
export function signalOf(e: ReviewEvent): Signal {
	if (e.role === "pre") return null;
	switch (e.grade) {
		case "correct": case "understood": return "success";
		case "partial": return "partial";
		case "wrong": case "review": return "fail";
		default: return null; // seen (carte de lecture), skipped (abandon explicite)
	}
}

export function deriveStates(input: {
	now: number;
	items: ScheduledItem[];
	events: ReviewEvent[];
	horizons: Record<string, number | null>;
	params: SchedulerParams;
}): Map<string, ItemState> {
	const { now, items, events, horizons, params } = input;

	const parQ = new Map<string, ReviewEvent[]>();
	for (const e of events) {
		const l = parQ.get(e.q);
		if (l) l.push(e); else parQ.set(e.q, [e]);
	}

	const out = new Map<string, ItemState>();
	for (const item of items) {
		const evts = (parQ.get(item.q) ?? []).slice().sort((a, b) => a.at - b.at);
		const examAt = horizons[item.module] ?? null;
		let interval = 0;
		let lastAt: number | null = null;
		let streak = 0;
		let lapses = 0;

		for (const e of evts) {
			const s = signalOf(e);
			if (!s) continue;

			/* Plafond AU MOMENT de l'événement : la trajectoire reste fidèle
			   à ce qui s'est réellement passé, plutôt que réécrite avec
			   l'horizon d'aujourd'hui. */
			const plafond = intervalCeiling(horizonFor(examAt, e.at, params), params);

			if (lastAt === null) {
				interval = s === "fail" ? params.intervalleEchec : params.intervalleInitial;
			} else if (s === "fail") {
				interval = params.intervalleEchec;
			} else {
				/* GARDE-FOU DE DOUBLE RÉVISION. Un succès ne fait croître
				   l'intervalle que si l'item était dû, à la marge
				   d'anticipation près. Sans cette règle, rejouer deux fois le
				   même quiz dans l'heure doublerait deux fois l'intervalle
				   pour cinq minutes d'espacement réel : le compteur de
				   répétitions remplacerait l'espacement, qui est le seul
				   mécanisme que la littérature valide. */
				const etaitDu = e.at >= lastAt + interval - params.margeAnticipation * interval;
				if (etaitDu) interval *= s === "partial" ? params.facteurPartiel : params.facteurSucces;
			}

			if (s === "fail") { lapses++; streak = 0; } else { streak++; }
			/* Le plancher gagne sur le plafond : un examen dans deux heures
			   ne doit pas produire un intervalle nul, donc une boucle. */
			interval = Math.min(Math.max(interval, params.intervalleMin), Math.max(plafond, params.intervalleMin));
			lastAt = e.at;
		}

		let dueAt: number | null = null;
		if (lastAt !== null) {
			/* Re-bornage au plafond ACTUEL : un intervalle acquis quand
			   l'examen était loin serait trop long maintenant qu'il approche. */
			const plafondNow = intervalCeiling(horizonFor(examAt, now, params), params);
			interval = Math.min(interval, Math.max(plafondNow, params.intervalleMin));
			dueAt = lastAt + interval;
		}

		out.set(item.q, { q: item.q, streak, lapses, lastAt, interval, dueAt, isNew: lastAt === null });
	}
	return out;
}
