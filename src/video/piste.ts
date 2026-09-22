/**
 * LE choix de la piste de sous-titres : manuelle dans la langue de la
 * vidéo, sinon automatique `-orig`, sinon rien. JAMAIS une piste
 * automatique traduite.
 *
 * Le pourquoi tient en une ligne : YouTube met sous `automatic_captions`
 * à la fois l'originale (`fr-orig`) et des TRADUCTIONS (`en`, `de`…)
 * générées pour d'autres langues ; joindre au prompt la piste `en` d'une
 * vidéo française, c'est joindre une transcription qui n'est pas celle de
 * la vidéo. C'est ce cas — et lui seul — que le test « jamais traduite »
 * rend visible (casser la règle doit le faire rougir).
 *
 *     npm run check:video
 */

/** Ce que `yt-dlp -J` donne d'une vidéo, réduit aux champs que le noyau lit. */
export interface InfosVideo {
	id: string;
	title: string;
	channel?: string | null;
	uploader?: string | null;
	duration?: number | null;
	language?: string | null;
	description?: string | null;
	thumbnail?: string | null;
	subtitles?: Record<string, unknown[]> | null;
	automatic_captions?: Record<string, unknown[]> | null;
}

/** La piste choisie : sa clé yt-dlp, son type, et la langue d'origine visée. */
export interface Piste {
	cle: string;
	type: "manuel" | "auto";
	langue: string | null;
}

/**
 * La règle, dans l'ordre (spec §3.1) : manuel exact `L` ou de même langue
 * de base ; sinon automatique `L-orig` ; sans langue, la SEULE clé `-orig`
 * ou le SEUL jeu manuel ; sinon null. `live_chat` n'est pas des
 * sous-titres, c'est le salon du direct.
 */
export function choisirPiste(infos: InfosVideo): Piste | null {
	const manuels = Object.keys(infos.subtitles ?? {}).filter(c => c !== "live_chat");
	const autos = Object.keys(infos.automatic_captions ?? {});
	const L = infos.language?.trim() || null;
	if (L) {
		const base = L.split("-")[0].toLowerCase();
		const m = manuels.find(c => c === L) ?? manuels.find(c => c.split("-")[0].toLowerCase() === base);
		if (m) return { cle: m, type: "manuel", langue: L };
		const a = autos.find(c => c === `${L}-orig`) ?? autos.find(c => c.toLowerCase() === `${base}-orig`);
		if (a) return { cle: a, type: "auto", langue: L };
		return null;
	}
	const origs = autos.filter(c => c.endsWith("-orig"));
	if (origs.length === 1) return { cle: origs[0], type: "auto", langue: origs[0].slice(0, -5) };
	if (manuels.length === 1) return { cle: manuels[0], type: "manuel", langue: manuels[0] };
	return null;
}