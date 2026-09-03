import type { ItemState, Plan, PlanInput, ScheduledItem } from "./types";
import { JOUR } from "./params";
import { deriveStates } from "./state";
import { applyRenames } from "./log";

/**
 * LE PLAN NE PORTE QUE SUR AUJOURD'HUI.
 *
 * La projection de charge sert à décider quoi AVANCER, elle n'est jamais
 * persistée : demain, tout est recalculé depuis le journal. Aucun planning
 * à invalider, donc aucune désynchronisation possible.
 *
 * L'ordre est TOTAL et DÉTERMINISTE — les égalités se départagent par la
 * clé. Sans cela, rien de tout ceci ne serait vérifiable.
 */
export function planToday(input: PlanInput): Plan {
	const { now, dayStart, items, horizons, params } = input;
	const events = applyRenames(input.events);
	const states = deriveStates({ now, items, events, horizons, params });
	const parQ = new Map(items.map(i => [i.q, i]));

	/* Le noyau ne RETIENT pas ce qui a été fait aujourd'hui : il le COMPTE.
	   Toutes les réponses comptent dans la charge, y compris celles sans
	   signal de mémoire — une carte de lecture prend du temps aussi. */
	const spentToday = events.filter(e => e.at >= dayStart && e.at <= now).length;
	const budget = Math.max(0, params.budgetJour - spentToday);

	const priorite = (s: ItemState): number =>
		s.dueAt === null || s.interval <= 0 ? 0 : (now - s.dueAt) / s.interval;

	const dus: ItemState[] = [];
	const neufs: ItemState[] = [];
	const futurs: ItemState[] = [];
	for (const item of items) {
		const s = states.get(item.q);
		if (!s) continue;
		if (s.isNew) neufs.push(s);
		else if (s.dueAt !== null && s.dueAt <= now) dus.push(s);
		else futurs.push(s);
	}

	const parCle = (a: ItemState, b: ItemState) => (a.q < b.q ? -1 : a.q > b.q ? 1 : 0);
	dus.sort((a, b) => priorite(b) - priorite(a) || parCle(a, b));
	neufs.sort(parCle);

	/* PROJECTION DE CHARGE sur la fenêtre de lissage. Le jour 0 porte ce qui
	   est déjà dû, retard compris. */
	const forecast = new Array<number>(Math.max(1, params.fenetreLissage)).fill(0);
	forecast[0] = dus.length;
	for (const s of futurs) {
		if (s.dueAt === null) continue;
		const jour = Math.floor((s.dueAt - now) / JOUR);
		if (jour >= 0 && jour < forecast.length) forecast[jour]++;
	}

	/* FIX revue round 1, finding 1 : le quota porte sur le budget RESTANT
	   (`budget`), pas sur le budget nominal (`params.budgetJour`). Sur le
	   budget nominal, dès que le budget est déjà entamé, les neufs
	   prennent jusqu'à 100 % de ce qui reste et aucune révision ne
	   passe — l'inverse du but du quota (spec §7.2, `partNeuf` DU
	   BUDGET, trois lignes après le §7.1 qui explique que le budget se
	   consomme au fil du jour). */
	const quotaNeuf = Math.min(neufs.length, Math.round(budget * params.partNeuf), budget);
	const retenusNeufs = neufs.slice(0, quotaNeuf);
	const retenusRev = dus.slice(0, Math.max(0, budget - quotaNeuf));
	const reportes = dus.slice(retenusRev.length);

	/* ANTICIPATION. S'il reste de la place, on tire vers aujourd'hui ce qui
	   tombe sur les jours les plus chargés — jamais au-delà de la marge.
	   La crête de Cepeda est plate autour de l'optimum : la marge s'y tient. */
	let libre = budget - retenusRev.length - retenusNeufs.length;
	const avances: ItemState[] = [];
	if (libre > 0) {
		const jourDe = (s: ItemState) => Math.floor(((s.dueAt as number) - now) / JOUR);
		const candidats = futurs
			.filter(s => s.dueAt !== null && s.dueAt - now <= params.margeAnticipation * s.interval)
			.sort((a, b) => {
				const ca = forecast[jourDe(a)] ?? 0;
				const cb = forecast[jourDe(b)] ?? 0;
				return cb - ca || (a.dueAt as number) - (b.dueAt as number) || parCle(a, b);
			});
		for (const s of candidats) {
			if (libre <= 0) break;
			avances.push(s);
			libre--;
		}
	}

	return {
		today: ordonner([...retenusRev, ...avances], retenusNeufs, parQ, priorite),
		deferred: reportes.map(s => s.q),
		forecast,
		stats: { due: dus.length, new: neufs.length, ahead: avances.length, spentToday },
	};
}

/**
 * L'ORDRE : l'entrelacement, et rien d'autre.
 *
 * Les modules ne s'entremêlent PAS. Deux modules ne se confondent pas :
 * les mélanger ne produirait aucune discrimination (Brunmair & Richter :
 * le modérateur est la similarité, et sur du matériel dissemblable
 * l'entrelacement est défavorable) et ne coûterait que du changement de
 * contexte. À l'intérieur d'un module, les familles alternent en
 * tourniquet — par `topic` s'il est déclaré, sinon par `source`, ce qui
 * entrelace les tranches d'un même chapitre.
 */
function ordonner(
	revisions: ItemState[],
	neufs: ItemState[],
	parQ: Map<string, ScheduledItem>,
	priorite: (s: ItemState) => number,
): string[] {
	const parModule = new Map<string, { rev: ItemState[]; neuf: ItemState[]; max: number }>();
	const bucket = (q: string) => {
		const mod = parQ.get(q)?.module ?? "";
		let b = parModule.get(mod);
		if (!b) { b = { rev: [], neuf: [], max: -Infinity }; parModule.set(mod, b); }
		return b;
	};
	for (const s of revisions) { const b = bucket(s.q); b.rev.push(s); b.max = Math.max(b.max, priorite(s)); }
	for (const s of neufs) { const b = bucket(s.q); b.neuf.push(s); }

	const modules = [...parModule.entries()]
		.sort((a, b) => b[1].max - a[1].max || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

	const out: string[] = [];
	for (const [, b] of modules) {
		const familles = new Map<string, ItemState[]>();
		for (const s of b.rev) {
			const it = parQ.get(s.q);
			const f = it?.topic || it?.source || "";
			const l = familles.get(f);
			if (l) l.push(s); else familles.set(f, [s]);
		}
		// Tourniquet : une famille après l'autre, en tournant.
		const files = [...familles.keys()].sort().map(k => familles.get(k) as ItemState[]);
		const rev: string[] = [];
		while (files.some(f => f.length)) {
			for (const f of files) { const s = f.shift(); if (s) rev.push(s.q); }
		}

		/* Les neufs sont RÉPARTIS dans la série, pas relégués à la fin : une
		   session écourtée doit progresser sur les deux fronts, sinon la
		   couverture stagne et crée des angles morts permanents. */
		const neuf = b.neuf.map(s => s.q);
		const total = rev.length + neuf.length;
		let i = 0, k = 0;
		for (let n = 0; n < total; n++) {
			if (k < neuf.length && k * total < n * neuf.length) out.push(neuf[k++]);
			else if (i < rev.length) out.push(rev[i++]);
			else out.push(neuf[k++]);
		}
	}
	return out;
}
