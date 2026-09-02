import type { LogLine, ReviewEvent, ReviewGrade } from "./types";
import { QUESTION_ROLES } from "../types/quiz";

/**
 * LE FORMAT DU JOURNAL APPARTIENT AU NOYAU.
 *
 * L'adaptateur ne fait que lire et écrire des octets : tout ce qui
 * comprend le format vit ici, donc se transporte tel quel vers les
 * applications PC et Android.
 *
 * JSONL, une ligne par événement, en AJOUT SEUL. Deux conséquences
 * voulues : une ligne illisible n'emporte pas le fichier (un JSON unique
 * tronqué serait entièrement perdu), et deux appareils qui fusionnent
 * leurs journaux n'ont rien à réconcilier.
 */

const GRADES: readonly ReviewGrade[] = ["correct", "wrong", "understood", "partial", "review", "skipped", "seen"];

export function formatLine(line: LogLine): string {
	return JSON.stringify(line) + "\n";
}

/**
 * Relecture TOLÉRANTE : une ligne illisible est ignorée et comptée, jamais
 * fatale. Un fichier tronqué par une fermeture brutale perd une révision,
 * pas un semestre. Les lignes vides ne comptent pas comme des corruptions
 * (un fichier se termine par un saut de ligne).
 */
export function parseLog(text: string): { lines: LogLine[]; ignored: number } {
	const lines: LogLine[] = [];
	let ignored = 0;
	for (const brute of text.split("\n")) {
		const s = brute.trim();
		if (!s) continue;
		let o: unknown;
		try { o = JSON.parse(s); } catch { ignored++; continue; }
		const v = validate(o);
		if (v) lines.push(v); else ignored++;
	}
	return { lines, ignored };
}

function validate(o: unknown): LogLine | null {
	if (!o || typeof o !== "object") return null;
	const r = o as Record<string, unknown>;
	if (r.t === "answer") {
		if (typeof r.q !== "string" || !r.q) return null;
		if (typeof r.at !== "number" || !Number.isFinite(r.at)) return null;
		if (typeof r.grade !== "string" || !GRADES.includes(r.grade as ReviewGrade)) return null;
		const e: ReviewEvent = { t: "answer", q: r.q, at: r.at, grade: r.grade as ReviewGrade };
		/* ASYMÉTRIE VOLONTAIRE : un grade inconnu rejette la ligne (sans verdict, pas
		   d'événement). Un role inconnu est tolérĂ© et simplement omis (métadonnée
		   optionnelle, fusion de journaux entre versions compatibles du noyau). */
		if (typeof r.role === "string" && QUESTION_ROLES.includes(r.role as never)) {
			e.role = r.role as ReviewEvent["role"];
		}
		return e;
	}
	if (r.t === "rename") {
		if (typeof r.from !== "string" || !r.from) return null;
		if (typeof r.to !== "string" || !r.to) return null;
		if (typeof r.at !== "number" || !Number.isFinite(r.at)) return null;
		return { t: "rename", from: r.from, to: r.to, at: r.at };
	}
	return null;
}

/**
 * Applique les renommages EN SÉQUENCE et rend les seules réponses.
 *
 * Par PRÉFIXE : renommer un dossier déplace toutes ses notes, et
 * `stats-store.ts` traite déjà le renommage de cette façon. Un renommage
 * n'affecte que ce qui le précède dans le journal — les événements
 * postérieurs portent déjà la clé nouvelle.
 */
export function applyRenames(lines: LogLine[]): ReviewEvent[] {
	const out: ReviewEvent[] = [];
	for (const line of lines) {
		if (line.t === "rename") {
			const prefixe = line.from + "/";
			for (let i = 0; i < out.length; i++) {
				const q = out[i].q;
				if (q === line.from) out[i] = { ...out[i], q: line.to };
				else if (q.startsWith(prefixe)) out[i] = { ...out[i], q: line.to + q.slice(line.from.length) };
				else if (q.startsWith(line.from + "::")) out[i] = { ...out[i], q: line.to + q.slice(line.from.length) };
			}
			continue;
		}
		out.push(line);
	}
	return out;
}
