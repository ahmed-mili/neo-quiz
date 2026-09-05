import { LOG_PREFIX } from "../../../../src/branding";
import { createStatsStore, type StatsStore, type QuizStatRecord } from "../../../../src/dashboard/stats-store";
import { reglagesStore } from "../host/folder";

/* ══════════════════════════════════════════════════════════
   LES STATISTIQUES PAR QUIZ, CÔTÉ APPLICATION

   Distinctes du JOURNAL de révision, et à ne pas fusionner avec lui : le
   journal répond à « quelles questions sont dues aujourd'hui », les stats à
   « où en suis-je sur ce quiz ». La spec de l'ordonnanceur (§9.1) le dit
   sans ambiguïté — deux systèmes, deux questions.

   Elles vivent dans les RÉGLAGES de l'application, pas dans le dossier de
   quiz, et c'est délibéré : contrairement au journal, elles ne se partagent
   pas avec le greffon. Les partager demanderait de fusionner deux tables
   écrites par deux processus sans arbitre, pour un affichage — le journal,
   lui, le mérite et paie ce prix avec son format en ajout seul.
══════════════════════════════════════════════════════════ */

const CLE_STATS = "quizStats";

export async function creerStatsApp(): Promise<StatsStore> {
	const store = await reglagesStore();
	let cache: Record<string, QuizStatRecord> = {};
	try {
		const brut = await store.get<Record<string, QuizStatRecord>>(CLE_STATS);
		if (brut && typeof brut === "object") cache = brut;
	} catch (e) {
		// Réglages illisibles : on repart de stats vides plutôt que d'empêcher
		// le démarrage. Une progression perdue se recalcule en rejouant ;
		// une fenêtre qui ne s'ouvre pas, non.
		console.warn(LOG_PREFIX, "statistiques illisibles:", e);
	}
	const stats = createStatsStore({
		getStats: () => cache,
		saveStats: async (data) => {
			cache = data;
			await store.set(CLE_STATS, data);
			await store.save();
		},
	});
	stats.load();
	return stats;
}
