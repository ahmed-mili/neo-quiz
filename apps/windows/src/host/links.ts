/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — RÉSOLUTION DES LIENS ET URL DE RESSOURCE

   Obsidian tient un index de liens qui comprend « schema.png » écrit depuis
   n'importe quelle note. Un dossier nu n'en a pas : c'est ce fichier qui
   reconstitue la règle, et `resolveDansIndex` est PURE pour qu'elle soit
   éprouvable hors de la fenêtre (`npm run check:windows-host`).
══════════════════════════════════════════════════════════ */

import { convertFileSrc } from "@tauri-apps/api/core";
import { cheminAbsolu } from "./fs";
import type { WindowsIndex } from "./fs";
import { LOG_PREFIX } from "../../../../src/branding";
import type { HostFile, HostLinks } from "../../../../src/host/types";

/**
 * Extensions essayées quand le lien n'en porte pas.
 *
 * `.md` d'abord : « [[Cours/ch1]] » désigne une note dans l'écrasante
 * majorité des cas. Les images ensuite, dans l'ordre où elles apparaissent
 * dans les vaults d'Ahmed.
 */
const EXTENSIONS_IMPLICITES = ["md", "png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"];

/** Sépare avec des `/`, sans « ./ » ni « / » de tête. */
function normaliserLien(lien: string): string {
	return String(lien ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Le nombre de segments de dossier communs à deux chemins. */
function segmentsCommuns(a: string, b: string): number {
	const ga = a.split("/").slice(0, -1);
	const gb = b.split("/").slice(0, -1);
	let n = 0;
	while (n < ga.length && n < gb.length && ga[n].toLowerCase() === gb[n].toLowerCase()) n++;
	return n;
}

/**
 * Résout un wikilink dans une liste de fichiers. PURE : aucun appel Tauri,
 * aucun accès au disque.
 *
 * L'ORDRE est la règle, et il est repris de ce que fait Obsidian :
 *   1. un CHEMIN exact — le fichier explicitement désigné gagne toujours ;
 *   2. le même chemin complété d'une extension (« Cours/ch1 » → « .md ») ;
 *   3. à défaut, le NOM seul, et parmi les homonymes le PLUS PROCHE de la note
 *      qui cite le lien.
 *
 * Chercher par nom avant de chercher par chemin ferait gagner un homonyme
 * lointain contre le fichier que l'auteur a nommé en toutes lettres. Et sans
 * le départage par proximité, « schema.png » cité depuis « Cours/reseau.md »
 * ramènerait l'image d'un autre cours — au hasard de l'ordre du parcours de
 * dossier, donc différemment d'une machine à l'autre.
 *
 * La comparaison ignore la CASSE : Windows l'ignore aussi, et une note qui
 * écrit « Schema.png » désigne bien « schema.png » sur ce système.
 */
export function resolveDansIndex(fichiers: HostFile[], linkPath: string, fromPath: string): HostFile | null {
	const cible = normaliserLien(linkPath);
	if (!cible) return null;
	const liste = Array.isArray(fichiers) ? fichiers : [];

	const parChemin = (chemin: string): HostFile | null => {
		const c = chemin.toLowerCase();
		return liste.find(f => f && f.path.toLowerCase() === c) ?? null;
	};

	// 1. le chemin, tel qu'il est écrit.
	const exact = parChemin(cible);
	if (exact) return exact;

	// 2. le chemin complété d'une extension, quand le lien n'en porte pas.
	const dernier = cible.split("/").pop() || cible;
	const sansExtension = dernier.lastIndexOf(".") <= 0;
	if (sansExtension) {
		for (const ext of EXTENSIONS_IMPLICITES) {
			const f = parChemin(`${cible}.${ext}`);
			if (f) return f;
		}
	}

	// 3. le nom seul. TOUS les homonymes, puis le plus proche de la note citante.
	const nom = dernier.toLowerCase();
	const candidats = liste.filter(f => {
		if (!f) return false;
		if (f.name.toLowerCase() === nom) return true;
		return sansExtension && f.basename.toLowerCase() === nom;
	});
	if (!candidats.length) return null;

	const depuis = normaliserLien(fromPath);
	/* Tri TOTAL, pas seulement par proximité : à proximité égale, le chemin le
	   plus court puis l'ordre alphabétique tranchent. Sans ce complément, deux
	   homonymes également proches seraient départagés par l'ordre du parcours
	   de dossier — donc par le système de fichiers, donc pas du tout. */
	const trie = [...candidats].sort((a, b) => {
		const d = segmentsCommuns(b.path, depuis) - segmentsCommuns(a.path, depuis);
		if (d !== 0) return d;
		if (a.path.length !== b.path.length) return a.path.length - b.path.length;
		return a.path.localeCompare(b.path);
	});
	return trie[0] ?? null;
}

export function createWindowsLinks(racine: string, index: WindowsIndex): HostLinks {
	return {
		resolve(linkPath, fromPath) {
			return resolveDansIndex(index.all(), linkPath, fromPath);
		},
		/* `null` et JAMAIS la chaîne vide : un `src=""` fait recharger la page
		   courante comme image — requête inutile et image cassée.

		   `convertFileSrc` fabrique une URL du protocole `asset`, que le natif
		   ne servira QUE si le dossier est dans la portée du protocole d'asset.
		   C'est la seconde portée ouverte par `allow_folder` : sans elle, cette
		   URL est parfaitement formée et ne charge rien, sans erreur. */
		resourceUrl(target, fromPath) {
			try {
				const brut = typeof target === "string" ? target : target?.path;
				const chemin = normaliserLien(brut ?? "");
				if (!chemin) return null;
				// L'index fait AUTORITÉ : une URL vers un fichier qu'il ne connaît
				// pas pointerait hors du dossier autorisé.
				const f = index.get(chemin) ?? resolveDansIndex(index.all(), chemin, fromPath || "");
				if (!f) return null;
				return convertFileSrc(cheminAbsolu(racine, f.path)) || null;
			} catch (e) {
				console.warn(LOG_PREFIX, "resourceUrl erreur:", e);
				return null;
			}
		},
	};
}
