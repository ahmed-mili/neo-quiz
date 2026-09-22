/**
 * Les liens YouTube d'un texte : les identifiants de vidéo, validés, et
 * les autres URL http(s) — c'est-à-dire celles que le modèle ne pourra
 * jamais lire (la notice des « autres liens » vit dans la tuile, spec
 * §5.4, mais c'est ici et nulle part ailleurs qu'on les distingue).
 *
 * Un identifiant est exactement 11 caractères de [A-Za-z0-9_-] : c'est la
 * clé que la tâche 2 revalide AVANT tout lancement de yt-dlp — le rendu ne
 * peut faire passer au principal qu'un identifiant, jamais une URL.
 *
 *     npm run check:video
 */

/** Un identifiant de vidéo YouTube : exactement 11 caractères [A-Za-z0-9_-]. */
export const ID_VIDEO = /^[A-Za-z0-9_-]{11}$/;

/** Toute URL http(s) d'un texte, sans les chevrons ni guillemets qui l'entourent. */
const URL_RE = /https?:\/\/[^\s<>()"'`]+/gi;

/** La ponctuation qui ferme une phrase, collée à la fin d'un lien. */
const PONCTUATION_FINALE = /[.,;:!?»)\]'"]+$/;

/**
 * La ponctuation qui SUIT un lien dans une phrase n'est pas l'URL :
 * « résume https://youtu.be/x. » — sans ce retrait, l'identifiant porterait
 * un point final, serait rejeté par `ID_VIDEO`, et la vidéo serait ignorée
 * en silence. La ponctuation sort aussi des liens non lus (la notice du
 * §5.4 ne va pas répéter le point au lecteur).
 */
function nettoyerUrl(brut: string): string {
	return brut.replace(PONCTUATION_FINALE, "");
}

/** L'identifiant que porte une URL, YouTube seul : null pour tout autre hôte. */
function idDepuisUrl(brut: string): string | null {
	let u: URL;
	try { u = new URL(brut); } catch { return null; }
	const hote = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
	let id: string | null = null;
	if (hote === "youtu.be") id = u.pathname.split("/")[1] ?? null;
	else if (hote === "youtube.com" || hote === "youtube-nocookie.com") {
		if (u.pathname === "/watch") id = u.searchParams.get("v");
		else {
			const m = /^\/(shorts|live|embed)\/([^/]+)/.exec(u.pathname);
			id = m ? m[2] : null;
		}
	}
	return id && ID_VIDEO.test(id) ? id : null;
}

/** Les identifiants des liens YouTube du texte, uniques, ordre d'apparition. */
export function idYoutube(texte: string): string[] {
	const vus: string[] = [];
	for (const m of texte.matchAll(URL_RE)) {
		const id = idDepuisUrl(nettoyerUrl(m[0]));
		if (id && !vus.includes(id)) vus.push(id);
	}
	return vus;
}

/** Les URL http(s) du texte qui ne sont pas des vidéos YouTube. */
export function liensNonLus(texte: string): string[] {
	return [...texte.matchAll(URL_RE)].map(m => nettoyerUrl(m[0])).filter(u => !idDepuisUrl(u));
}