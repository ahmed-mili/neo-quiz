/**
 * Le texte propre d'une piste de sous-titres au format json3 de yt-dlp :
 * les segments `utf8` de chaque événement concaténés, les répétitions
 * consécutives supprimées (YouTube repose la même phrase d'un événement à
 * l'autre), des paragraphes d'environ une minute préfixés de l'horodatage
 * de leur ouverture.
 *
 * Pur : le json3 est une ENTRÉE, jamais l'horloge — le noyau se relit
 * pareil dans un an.
 *
 *     npm run check:video
 */

/** Un événement json3 : son début en ms et ses segments de texte. */
export interface EventJson3 {
	tStartMs?: number;
	segs?: Array<{ utf8?: string }>;
}

/** Un json3 tel qu'écrit par `yt-dlp --sub-format json3`. */
export interface Json3 {
	events?: EventJson3[];
}

/** Un paragraphe dure environ une minute, pas exactement : c'est un repère. */
const PARAGRAPHE_MS = 60_000;

/** L'horodatage d'un instant en ms : "[03:07]", "[1:02:03]" au-delà d'une heure. */
export function horodatage(ms: number): string {
	const s = Math.floor(ms / 1000);
	const h = Math.floor(s / 3600);
	const mn = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const deux = (n: number) => String(n).padStart(2, "0");
	return h > 0 ? `[${h}:${deux(mn)}:${deux(sec)}]` : `[${deux(mn)}:${deux(sec)}]`;
}

/**
 * Les phrases de la piste, sans ses répétitions : un événement sans
 * segments ou identique au précédent est ignoré ; un événement plus tard
 * d'une minute que le début du paragraphe courant en ouvre un neuf, préfixé
 * de son horodatage ; les paragraphes sont séparés d'une ligne vide.
 */
export function json3VersTexte(json3: Json3): string {
	const paragraphes: string[] = [];
	let courant = "";
	let debut = 0;
	let precedente = "";
	for (const event of json3.events ?? []) {
		const phrase = (event.segs ?? [])
			.map(s => s.utf8 ?? "")
			.join("")
			.replace(/\n/g, " ")
			.trim();
		if (!phrase || phrase === precedente) continue;
		precedente = phrase;
		const t = typeof event.tStartMs === "number" ? event.tStartMs : null;
		if (courant && t !== null && t > debut + PARAGRAPHE_MS) {
			paragraphes.push(courant);
			courant = "";
		}
		if (!courant) {
			debut = t ?? debut;
			courant = horodatage(debut);
		}
		courant += " " + phrase;
	}
	if (courant) paragraphes.push(courant);
	return paragraphes.join("\n\n");
}