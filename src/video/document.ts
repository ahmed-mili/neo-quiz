/**
 * Le document markdown joint à la demande : la fiche de la vidéo, sa
 * description et sa transcription dans la langue d'origine.
 *
 * Le noyau ne connaît pas t() : les libellés de section et le type de
 * piste (« sous-titres manuels » / « sous-titres automatiques ») arrivent
 * en paramètre — aucune chaîne visible n'est codée en dur ici.
 *
 *     npm run check:video
 */
import type { InfosVideo, Piste } from "./piste";

/** Les libellés que l'hôte traduit, dans sa langue d'interface. */
export interface LibellesDocument {
	chaine: string;
	duree: string;
	langue: string;
	manuel: string;
	auto: string;
	description: string;
	transcription: string;
}

/** Les caractères que Windows refuse dans un nom de fichier. */
const INTERDITS = /[/\\:*?"<>|]/g;

/**
 * `<titre nettoyé>.md` : interdits Windows retirés, trim, 80 car. avant
 * l'extension. Un titre entièrement interdit ou vide retombe sur « video » :
 * un nom « .md » nu serait un fichier caché chez Windows.
 */
export function nomDocument(titre: string): string {
	const nettoye = titre.replace(INTERDITS, "").trim().slice(0, 80);
	return (nettoye || "video") + ".md";
}

/** La durée que yt-dlp donne en secondes : "6:06", "1:02:03" au-delà d'une heure. */
function formaterDuree(secondes: number): string {
	const s = Math.round(secondes);
	const h = Math.floor(s / 3600);
	const mn = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const deux = (n: number) => String(n).padStart(2, "0");
	return h > 0 ? `${h}:${deux(mn)}:${deux(sec)}` : `${mn}:${deux(sec)}`;
}

/**
 * Le document : titre, chaîne, durée, langue et type de piste, le lien
 * court `youtu.be` (que tout lecteur ouvre, contrairement aux paramètres
 * de `watch`) écrit en LIEN markdown, pour que l'aperçu le rende
 * cliquable (il s'ouvre alors dans le navigateur), puis les deux sections. La transcription est reprise telle
 * quelle : le texte propre est déjà le travail de json3VersTexte.
 */
export function documentVideo(a: {
	infos: InfosVideo;
	piste: Piste;
	texte: string;
	libelles: LibellesDocument;
}): string {
	const { infos, piste, texte, libelles } = a;
	const type = piste.type === "manuel" ? libelles.manuel : libelles.auto;
	const lignes: string[] = [`# ${infos.title}`, ""];
	const chaine = infos.channel ?? infos.uploader;
	if (chaine) lignes.push(`${libelles.chaine} : ${chaine}`);
	if (typeof infos.duration === "number") lignes.push(`${libelles.duree} : ${formaterDuree(infos.duration)}`);
	lignes.push(infos.language ? `${libelles.langue} : ${infos.language} (${type})` : `${libelles.langue} : ${type}`);
	lignes.push("", `[https://youtu.be/${infos.id}](https://youtu.be/${infos.id})`, "", `## ${libelles.description}`, "", (infos.description ?? "").trim());
	lignes.push("", `## ${libelles.transcription}`, "", texte);
	return lignes.join("\n");
}