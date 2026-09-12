/* ══════════════════════════════════════════════════════════
   LA GARDE DE LA CLÉ `ai` DES RÉGLAGES — LA PARTIE PURE

   Tâche 6 de la génération IA dans l'application. La clé `ai` (`CLE_REGLAGES_IA`,
   `pont.ts`) est la première clé des réglages que le RENDU écrit et que le
   PRINCIPAL relit pour décider de ce qu'il a le droit de faire : l'hôte
   d'`aiOllamaUrl` entre dans la liste du réseau (`reseau.ts`), et
   `aiMentionExtraFolders` désigne des dossiers hors des racines que le
   sélecteur « @ » lit par les canaux `fichiers.*`.

   Sans garde, un rendu compromis écrirait `{ aiOllamaUrl: "https://attaquant
   .example" }` et obtiendrait cet hôte au prochain lancement — c'est le
   résiduel que `reseau.ts` a nommé jusqu'ici. La règle, ici, est la même que
   pour la clé `folders` (`verifierDossiers`, `canaux.ts`) : une valeur qui
   élargit ce que le principal accepte doit être vérifiée AVANT d'être écrite,
   et jamais par celui qui l'écrit.

   POURQUOI UN MODULE À PART, SANS `electron` NI `node:*` : le verdict est une
   fonction pure de la valeur et de deux prédicats, et c'est ce qui le rend
   éprouvable par `npm run check:electron-reglages` sur le CODE RÉEL —
   `canaux.ts`, lui, tire `electron` et ne se charge dans aucun script. Le
   dialogue natif (`dialog.showMessageBox`) et l'admission (`autoriserHote`)
   restent dans `canaux.ts` : ce module ne fait que DIRE ce qu'il faut faire.
══════════════════════════════════════════════════════════ */

import { HOTES_AUTORISES } from "./reseau";

/** Le verdict sur une valeur de la clé `ai`. Trois issues, jamais confondues :
    - `ok` : à écrire ; `admettre` est l'hôte d'`aiOllamaUrl` à faire entrer
      dans la liste du réseau AUSSITÔT (pas au prochain lancement), `null`
      quand le réglage ne porte pas d'URL ;
    - `refus` : ne rien écrire, et la cause est NOMMÉE — une écriture refusée
      en silence laisserait l'utilisateur croire son réglage enregistré ;
    - `confirmer` : l'hôte n'est ni dans la liste ni sur le réseau local, et
      seul l'UTILISATEUR peut l'admettre — par une porte NATIVE, que le rendu
      ne peut pas dessiner à sa place. */
export type VerdictReglagesIa =
	| { ok: true; admettre: string | null }
	| { refus: string }
	| { confirmer: string };

/**
 * Un hôte du RÉSEAU LOCAL, celui qu'on admet sans rien demander : la boucle
 * locale, les trois plages privées de la RFC 1918, et `.local` (mDNS, le nom
 * d'un NAS chez soi). Un Ollama sur ces hôtes est l'usage que le plan nomme ;
 * tout le reste est Internet, et Internet se confirme.
 *
 * `hostname` tel que `new URL().hostname` le rend : déjà en minuscules, et une
 * adresse IPv6 entre crochets (`[::1]`).
 */
export function hoteEstPrive(hostname: string): boolean {
	const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
	if (!h) return false;
	if (h === "localhost" || h === "::1" || h.endsWith(".local")) return true;
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
	if (!m) return false;
	const [a, b] = [Number(m[1]), Number(m[2])];
	if (a === 127 || a === 10) return true;
	if (a === 192 && b === 168) return true;
	return a === 172 && b >= 16 && b <= 31;
}

/**
 * Le verdict sur la valeur que le rendu veut écrire sous la clé `ai`.
 *
 * `aiOllamaUrl`, s'il est présent, doit être une URL `http(s)` lisible : son
 * hôte est admis d'office s'il est dans la liste du réseau ou sur le réseau
 * local, et demandé à l'utilisateur sinon. `aiMentionExtraFolders`, s'il est
 * présent, doit être un tableau de chaînes dont CHACUNE est déjà dans le
 * périmètre (`perimetreContient`) — la même règle que `folders`, et pour la
 * même raison : un dossier hors périmètre inscrit là serait lu par le
 * sélecteur « @ » au prochain lancement. L'application n'a aucune interface
 * pour remplir cette clé aujourd'hui ; la garde existe avant l'interface.
 *
 * Les autres champs (modèle, effort, journal d'usage) ne donnent aucun droit
 * au principal : ils passent tels quels.
 */
export async function validerReglagesIa(
	valeur: unknown,
	perimetreContient: (chemin: string) => Promise<boolean>,
): Promise<VerdictReglagesIa> {
	if (!valeur || typeof valeur !== "object" || Array.isArray(valeur)) {
		return { refus: "réglages IA refusés : la valeur n'est pas un objet" };
	}
	const { aiOllamaUrl, aiMentionExtraFolders } = valeur as { aiOllamaUrl?: unknown; aiMentionExtraFolders?: unknown };

	if (aiMentionExtraFolders !== undefined) {
		if (!Array.isArray(aiMentionExtraFolders) || aiMentionExtraFolders.some(d => typeof d !== "string")) {
			return { refus: "réglages IA refusés : aiMentionExtraFolders doit être un tableau de chaînes" };
		}
		for (const dossier of aiMentionExtraFolders as string[]) {
			if (!(await perimetreContient(dossier))) {
				return { refus: "dossier hors périmètre, refusé dans les réglages IA : " + dossier };
			}
		}
	}

	if (aiOllamaUrl === undefined) return { ok: true, admettre: null };
	if (typeof aiOllamaUrl !== "string") {
		return { refus: "réglages IA refusés : aiOllamaUrl doit être une chaîne" };
	}
	let url: URL;
	try {
		url = new URL(aiOllamaUrl);
	} catch {
		return { refus: "réglages IA refusés : aiOllamaUrl illisible : " + aiOllamaUrl };
	}
	/* Le protocole, pas seulement l'hôte — la même moitié que `hoteAutorise`
	   (`reseau.ts`) : `file://127.0.0.1/C:/x` porte un hôte de la liste. */
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { refus: "réglages IA refusés : aiOllamaUrl doit être en http(s) : " + aiOllamaUrl };
	}
	const hote = url.hostname.toLowerCase();
	if (HOTES_AUTORISES.has(hote) || hoteEstPrive(hote)) return { ok: true, admettre: hote };
	return { confirmer: hote };
}
