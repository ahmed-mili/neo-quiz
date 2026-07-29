import type { EngineCtx } from "../types/engine-ctx";
import type { OrderingQuestion, MatchingQuestion } from "../types/quiz";
import { firstArray } from "./utils";

export interface QuestionHandlers {
	getOrderingItems(q: OrderingQuestion): string[];
	getOrderingCorrectOrder(q: OrderingQuestion): number[];
	getOrderingSlotLabels(q: OrderingQuestion): string[];
	getMatchRows(q: MatchingQuestion): string[];
	getMatchChoices(q: MatchingQuestion): string[];
	getMatchCorrectMap(q: MatchingQuestion): number[];
	orderingSelectionIncludes(qi: number, origIdx: number): boolean;
	removeOrderingItemFromSlot(qi: number, slotIndex: number): void;
	placeOrderingItemInSlot(qi: number, slotIndex: number, origIdx: number): void;
	matchingSelectionIncludes(qi: number, choiceIdx: number): boolean;
}

export function createQuestionHandlers(ctx: EngineCtx): QuestionHandlers {
	/* Sélection d'une question à EMPLACEMENTS (classement, association) : un
	   tableau d'indices, jamais de chaînes. Le texte à trous a élargi
	   `QuestionSelection` avec `string[]`, que `Array.isArray` ne distingue pas
	   de celui-ci — mais toutes les fonctions de ce module sont appelées sous
	   garde `isOrderingQuestion`/`isMatchingQuestion`. Ce helper nomme cet
	   invariant une fois plutôt que de le caster à chaque accès. */
	function slotSelection(qi: number): Array<number | null> | null {
		const sel = ctx.quizState.selections[qi];
		return Array.isArray(sel) ? (sel as Array<number | null>) : null;
	}

	function getOrderingItems(q: OrderingQuestion): string[] {
		const nestedItems = q.ordering !== true ? q.ordering.items : undefined;
		return firstArray(q.possibilities, q.orderingItems, nestedItems, q.options);
	}

	function getOrderingCorrectOrder(q: OrderingQuestion): number[] {
		const nestedOrder = q.ordering !== true ? q.ordering.correctOrder : undefined;
		return firstArray(q.correctOrder, nestedOrder, [...Array(getOrderingItems(q).length).keys()]);
	}

	function getOrderingSlotLabels(q: OrderingQuestion): string[] {
		const nestedLabels = q.ordering !== true ? q.ordering.slotLabels : undefined;
		return firstArray(q.slots, q.slotLabels, nestedLabels, getOrderingItems(q).map((_, i) => String(i + 1)));
	}

	function getMatchRows(q: MatchingQuestion): string[] {
		const nestedRows = q.matching !== true ? q.matching.rows : undefined;
		return firstArray(q.rows, nestedRows);
	}

	function getMatchChoices(q: MatchingQuestion): string[] {
		const nestedChoices = q.matching !== true ? q.matching.choices : undefined;
		return firstArray(q.choices, nestedChoices);
	}

	function getMatchCorrectMap(q: MatchingQuestion): number[] {
		const nestedMap = q.matching !== true ? q.matching.correctMap : undefined;
		return firstArray(q.correctMap, nestedMap);
	}

	const orderingSelectionIncludes = (qi: number, origIdx: number): boolean => {
		const sel = slotSelection(qi);
		return sel ? sel.includes(origIdx) : false;
	};

	function removeOrderingItemFromSlot(qi: number, slotIndex: number): void {
		const sel = slotSelection(qi);
		if (sel && slotIndex >= 0 && slotIndex < sel.length) sel[slotIndex] = null;
	}

	function placeOrderingItemInSlot(qi: number, slotIndex: number, origIdx: number): void {
		const sel = slotSelection(qi);
		if (!sel || slotIndex < 0 || slotIndex >= sel.length) return;
		const existingSlot = sel.indexOf(origIdx);
		const currentAtTarget = sel[slotIndex];
		if (existingSlot === slotIndex) return;
		if (existingSlot !== -1) sel[existingSlot] = null;
		if (currentAtTarget !== null && existingSlot !== -1) sel[existingSlot] = currentAtTarget;
		sel[slotIndex] = origIdx;
	}

	const matchingSelectionIncludes = (qi: number, choiceIdx: number): boolean => {
		const sel = slotSelection(qi);
		return sel ? sel.includes(choiceIdx) : false;
	};

	return {
		getOrderingItems,
		getOrderingCorrectOrder,
		getOrderingSlotLabels,
		getMatchRows,
		getMatchChoices,
		getMatchCorrectMap,
		orderingSelectionIncludes,
		removeOrderingItemFromSlot,
		placeOrderingItemInSlot,
		matchingSelectionIncludes
	};
}
