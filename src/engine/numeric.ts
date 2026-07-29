import type { TextQuestion } from "../types/quiz";

/* ══════════════════════════════════════════════════════════
   RÉPONSE NUMÉRIQUE — comparer des NOMBRES, pas des chaînes.

   Une question de physique attend « 9,81 ». L'élève tape « 9.81 », ou
   « 9,810 », ou « 9.81 m/s² ». Comparées comme du texte, ces trois réponses
   justes sont fausses. C'est le défaut que ce module corrige.

   Deux niveaux, volontairement distincts :

   - NORMALISATION LOCALE (toujours active, cf. terminal.ts) : « 3,14 » et
     « 3.14 » sont la même écriture à la virgule décimale près. Aucun risque,
     aucune tolérance introduite.
   - MODE NUMÉRIQUE (déclaré par l'auteur : `numeric`, `tolerance`,
     `tolerancePercent` ou `unit`) : la réponse est un NOMBRE, comparé en
     valeur, à une marge près, l'unité étant acceptée en suffixe.

   Le mode n'est jamais déduit du contenu : une référence « 007 » est une
   chaîne, pas l'entier 7, et personne ne peut trancher à la place de l'auteur.
══════════════════════════════════════════════════════════ */

/** Champs numériques d'une question texte (extension de TextQuestion). */
export interface NumericFields {
	/** Force la comparaison numérique, même sans tolérance ni unité. */
	numeric?: boolean;
	/** Marge ABSOLUE acceptée : |saisi − attendu| ≤ tolerance. */
	tolerance?: number;
	/** Marge RELATIVE en pourcentage de la valeur attendue. */
	tolerancePercent?: number;
	/** Unité attendue (« m/s », « kg ») — acceptée en suffixe, jamais exigée. */
	unit?: string;
}

export type NumericQuestion = TextQuestion & NumericFields;

/** Valeur lue dans une saisie : le nombre et ce qui le suivait. */
export interface ParsedNumeric {
	value: number;
	unit: string;
}

export function isNumericQuestion(q: TextQuestion | null | undefined): boolean {
	const n = q as NumericQuestion | null | undefined;
	if (!n) return false;
	return n.numeric === true
		|| typeof n.tolerance === "number"
		|| typeof n.tolerancePercent === "number"
		|| (typeof n.unit === "string" && n.unit.trim().length > 0);
}

/* Séparateurs de milliers à ignorer : espace ordinaire, insécable, fine
   insécable et apostrophe (convention suisse). Le POINT n'y est jamais : il
   est décimal dans la moitié du monde, et « 1.234 » doit rester 1,234. */
const GROUPING = /[\s  ']/g;

/**
 * Lit un nombre en tête de chaîne, quelle que soit sa convention d'écriture :
 * virgule ou point décimal, séparateurs de milliers, notation scientifique,
 * fraction simple (« 1/2 »), signe. Ce qui suit est rendu comme unité.
 * `null` si rien de numérique ne commence la chaîne.
 */
export function parseNumericValue(raw: unknown): ParsedNumeric | null {
	let s = String(raw ?? "").trim();
	if (!s) return null;

	// Notations mathématiques d'un même nombre, ramenées à leur forme simple.
	s = s.replace(/^[+]/, "").replace(GROUPING, "");
	s = s.replace(/−/g, "-");   // signe moins typographique
	s = s.replace(/×10\^?/gi, "e").replace(/\*10\^?/g, "e");

	// Fraction « a/b » : une réponse légitime à toute question de proportion.
	const frac = s.match(/^(-?\d+(?:[.,]\d+)?)\s*\/\s*(-?\d+(?:[.,]\d+)?)(.*)$/);
	if (frac) {
		const num = Number(frac[1].replace(",", "."));
		const den = Number(frac[2].replace(",", "."));
		if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
			return { value: num / den, unit: frac[3].trim() };
		}
		return null;
	}

	const m = s.match(/^(-?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?)(.*)$/);
	if (!m) return null;
	const value = Number(m[1].replace(",", "."));
	if (!Number.isFinite(value)) return null;
	return { value, unit: m[2].trim() };
}

/** Toute la chaîne est-elle un nombre ? (sert à normaliser « 3,14 » → « 3.14 »
    sans toucher aux textes qui contiennent une virgule.) */
export function isPurelyNumeric(raw: unknown): boolean {
	const parsed = parseNumericValue(raw);
	return parsed !== null && parsed.unit === "";
}

/** Marge acceptée autour de la valeur attendue ; 0 = égalité de valeurs. */
function toleranceFor(q: NumericQuestion, expected: number): number {
	if (typeof q.tolerance === "number" && Number.isFinite(q.tolerance)) {
		return Math.abs(q.tolerance);
	}
	if (typeof q.tolerancePercent === "number" && Number.isFinite(q.tolerancePercent)) {
		return Math.abs(expected * q.tolerancePercent / 100);
	}
	return 0;
}

/** Comparaison d'unités : casse et espaces ignorés, ainsi que les variantes
    d'exposant qu'un clavier rend malaisées (m/s2 ≡ m/s² ≡ m/s^2). */
function normalizeUnit(raw: unknown): string {
	return String(raw ?? "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "")
		.replace(/\^/g, "")
		.replace(/²/g, "2")
		.replace(/³/g, "3")
		.replace(/·/g, ".");
}

/**
 * La saisie répond-elle à la question, numériquement ?
 * L'unité n'est vérifiée que si l'élève en a écrit une : l'exiger
 * transformerait une question de calcul en question de notation.
 */
export function matchesNumericAnswer(q: NumericQuestion, accepted: string[], value: unknown): boolean {
	const student = parseNumericValue(value);
	if (!student) return false;

	const expectedUnit = normalizeUnit(q.unit);
	if (student.unit && expectedUnit && normalizeUnit(student.unit) !== expectedUnit) return false;
	// Unité écrite alors qu'aucune n'est attendue : on ne la retient pas contre
	// l'élève tant que le nombre, lui, est bon.

	return accepted.some(raw => {
		const target = parseNumericValue(raw);
		if (!target) return false;
		const margin = toleranceFor(q, target.value);
		// Le zéro machine (0.1 + 0.2 ≠ 0.3) rendrait faux un « 0,3 » exact :
		// une marge nulle garde une épaisseur d'un ULP relatif.
		const epsilon = margin > 0 ? margin : Math.abs(target.value) * 1e-9 + 1e-12;
		return Math.abs(student.value - target.value) <= epsilon;
	});
}
