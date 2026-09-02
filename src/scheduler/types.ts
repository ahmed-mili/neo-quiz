import type { QuestionRole } from "../types/quiz";
import type { SchedulerParams } from "./params";

/**
 * ORDONNANCEUR — types du domaine.
 *
 * Ce dossier est de la LOGIQUE PURE : ni Obsidian, ni DOM, ni horloge, ni
 * hasard. Le même module doit tourner à l'identique dans le greffon
 * aujourd'hui et dans les applications PC et Android demain — c'est ce qui
 * rend ce travail non jetable, et `scripts/check-scheduler.mjs` l'impose
 * mécaniquement plutôt que de s'en remettre à ce commentaire.
 *
 * Conception : docs/superpowers/specs/2026-09-02-scheduler-design.md
 */

/**
 * Verdict d'une réponse. Valeurs PERSISTÉES dans le journal : jamais
 * traduites, jamais renommées. Les trois valeurs d'auto-évaluation
 * reprennent `TextOnlyRating` (types/quiz.ts) plutôt que d'inventer un
 * second vocabulaire pour la même chose.
 */
export type ReviewGrade =
	| "correct" | "wrong"
	| "understood" | "partial" | "review"
	| "skipped"
	| "seen";

/** Une réponse. Une ligne du journal. */
export interface ReviewEvent {
	t: "answer";
	/** Clé OPAQUE de la question. Le noyau ne l'interprète jamais : le
	    chantier 2 doit rester libre de son modèle de contenu. */
	q: string;
	/** Epoch ms. */
	at: number;
	grade: ReviewGrade;
	/** Rôle AU MOMENT de la réponse. Copié, jamais relu dans la note : un
	    journal qui dépend du vault pour être interprété ne se transporte pas
	    vers une application, et ne se fusionne pas entre deux appareils. */
	role?: QuestionRole;
}

/**
 * Un renommage. Le journal reste ainsi strictement en AJOUT : réécrire un
 * fichier d'un mégaoctet au moment où l'application se ferme est
 * précisément la façon de le perdre. Appliqué par PRÉFIXE, donc un dossier
 * renommé tient en une ligne.
 */
export interface RenameEvent {
	t: "rename";
	from: string;
	to: string;
	at: number;
}

export type LogLine = ReviewEvent | RenameEvent;

/** Une question qui EXISTE aujourd'hui. Le journal peut en contenir
    d'autres (supprimées) : elles ne sont jamais planifiées. */
export interface ScheduledItem {
	q: string;
	/** Clé opaque du module : porte l'horizon, et BORNE l'entrelacement. */
	module: string;
	/** Clé opaque du quiz ou de la tranche d'origine. */
	source: string;
	/** Famille confusable, si le contenu la déclare. Rien ne la produit
	    encore : l'alternance se replie alors sur `source`. */
	topic?: string;
	role?: QuestionRole;
}

/** État de planification, DÉRIVÉ du journal à chaque appel — jamais
    persisté. C'est ce qui permet de rejouer tout l'historique quand un
    paramètre change. */
export interface ItemState {
	q: string;
	/** Succès consécutifs depuis le dernier échec. */
	streak: number;
	/** Nombre total d'échecs. */
	lapses: number;
	/** Dernier événement PORTEUR DE SIGNAL (ms), ou null si aucun. */
	lastAt: number | null;
	/** Intervalle courant (ms). 0 tant qu'aucun signal n'a été reçu. */
	interval: number;
	/** Échéance (ms), ou null pour une question jamais répondue : elle est
	    due immédiatement et entre par le quota de neufs. */
	dueAt: number | null;
	isNew: boolean;
}

export interface PlanInput {
	/** L'heure est une ENTRÉE. Un ordonnanceur qui lit l'horloge lui-même
	    est intestable et non reproductible. */
	now: number;
	/** Début de la journée locale (ms) : seul l'hôte connaît le fuseau et
	    l'heure de bascule. Le noyau ne manipule jamais de calendrier. */
	dayStart: number;
	items: ScheduledItem[];
	events: LogLine[];
	/** module → date d'examen (ms), ou null pour l'horizon par défaut. */
	horizons: Record<string, number | null>;
	params: SchedulerParams;
}

export interface Plan {
	/** À poser aujourd'hui, dans l'ordre. */
	today: string[];
	/** Dû mais reporté faute de budget, par priorité décroissante. */
	deferred: string[];
	/** Charge projetée, un entier par jour de la fenêtre de lissage. */
	forecast: number[];
	stats: { due: number; new: number; ahead: number; spentToday: number };
}
