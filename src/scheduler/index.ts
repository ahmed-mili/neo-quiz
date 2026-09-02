/**
 * ORDONNANCEUR — point d'entrée unique.
 *
 * L'adaptateur n'importe QUE ce fichier : le découpage interne reste libre
 * de bouger sans toucher à l'hôte, et le jour où ce dossier est copié dans
 * l'application PC, c'est cette surface-là qui fait le contrat.
 */
export type {
	ReviewGrade, ReviewEvent, RenameEvent, LogLine,
	ScheduledItem, ItemState, Plan, PlanInput,
} from "./types";
export type { SchedulerParams, RatioAnchor } from "./params";
export { DEFAULT_PARAMS, JOUR, HEURE } from "./params";
export { ratioCoefficients, retentionRatio, intervalCeiling, horizonFor } from "./horizon";
export { formatLine, parseLog, applyRenames } from "./log";
export { deriveStates } from "./state";
// `signalOf` n'est PAS réexporté : aucun hôte n'en a besoin. La surface de
// ce fichier est le contrat que l'application PC héritera — elle n'expose
// que ce qui sert (ruling préflight 1, 2026-09-02).
export { planToday } from "./plan";
