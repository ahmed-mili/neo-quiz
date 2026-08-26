import { createEmptyCard, fsrs, Rating, type Card, type CardInput, type Grade } from "ts-fsrs";

/** Les quatre réponses proposées après une tentative de rappel actif. */
export type ReviewRating = "again" | "hard" | "good" | "easy";

/** Forme JSON du modèle de mémoire FSRS (les Date sont stockées en ISO). */
export interface StoredMemoryCard {
	due: string;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	scheduled_days: number;
	learning_steps: number;
	reps: number;
	lapses: number;
	state: number;
	last_review?: string;
}

export interface ReviewScheduleResult {
	card: StoredMemoryCard;
	nextReviewAt: number;
	retrievability: number;
}

/* Rétention cible de 90 %, avec étapes courtes pour qu'une carte oubliée
   revienne pendant la séance avant d'être espacée. */
const scheduler = fsrs({
	request_retention: 0.9,
	maximum_interval: 36500,
	enable_fuzz: true,
	enable_short_term: true,
	learning_steps: ["1m", "10m"],
	relearning_steps: ["10m"],
});

const RATINGS: Record<ReviewRating, Grade> = {
	again: Rating.Again,
	hard: Rating.Hard,
	good: Rating.Good,
	easy: Rating.Easy,
};

function serializeCard(card: Card): StoredMemoryCard {
	return {
		due: card.due.toISOString(),
		stability: card.stability,
		difficulty: card.difficulty,
		elapsed_days: card.elapsed_days,
		scheduled_days: card.scheduled_days,
		learning_steps: card.learning_steps,
		reps: card.reps,
		lapses: card.lapses,
		state: card.state,
		...(card.last_review ? { last_review: card.last_review.toISOString() } : {}),
	};
}

function deserializeCard(card: StoredMemoryCard): CardInput {
	return {
		...card,
		due: card.due,
		last_review: card.last_review || null,
	};
}

export function createStoredMemoryCard(now = new Date()): StoredMemoryCard {
	return serializeCard(createEmptyCard(now));
}

/** Applique une réponse utilisateur au modèle FSRS et renvoie la prochaine échéance. */
export function scheduleReview(
	stored: StoredMemoryCard | null | undefined,
	rating: ReviewRating,
	now = new Date(),
): ReviewScheduleResult {
	const current = stored ? deserializeCard(stored) : createEmptyCard(now);
	const next = scheduler.next(current, now, RATINGS[rating]).card;
	return {
		card: serializeCard(next),
		nextReviewAt: next.due.getTime(),
		retrievability: scheduler.get_retrievability(next, now, false),
	};
}

export function isReviewDue(card: StoredMemoryCard | null | undefined, now = Date.now()): boolean {
	if (!card) return true;
	const due = Date.parse(card.due);
	return !Number.isFinite(due) || due <= now;
}

/** Identité déterministe de secours pour les anciens quiz sans `id`. */
export function stableQuestionKey(question: {
	id?: string;
	conceptId?: string;
	title?: string;
	prompt?: string;
	answer?: string;
	correctIndex?: number;
	correctIndices?: number[];
}, index: number): string {
	const explicit = String(question.id || question.conceptId || "").trim();
	if (explicit) return explicit;
	const raw = JSON.stringify([
		question.title || "",
		question.prompt || "",
		question.answer || "",
		question.correctIndex ?? null,
		question.correctIndices || null,
	]);
	let hash = 2166136261;
	for (let i = 0; i < raw.length; i++) {
		hash ^= raw.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	// Ne pas incorporer la position dans la clé : une session de révision peut
	// masquer les cartes non dues et donc changer les indices affichés.
	return raw === '["","","",null,null]'
		? `q${index + 1}`
		: `q-${(hash >>> 0).toString(36)}`;
}
