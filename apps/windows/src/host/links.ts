/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — RÉSOLUTION DES LIENS ET URL DE RESSOURCE

   Obsidian tient un index de liens qui comprend « schema.png » écrit depuis
   n'importe quelle note. Un dossier nu n'en a pas : c'est ce fichier qui
   reconstitue la règle, et `resolveDansIndex` est PURE pour qu'elle soit
   éprouvable hors de la fenêtre (`npm run check:windows-host`).
══════════════════════════════════════════════════════════ */

import { convertFileSrc } from "@tauri-apps/api/core";
import type { WindowsIndex } from "./fs";
import type { CarteRacines } from "./roots";
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

export function createWindowsLinks(carte: CarteRacines, index: WindowsIndex): HostLinks {
	/* La recherche est BORNÉE à la racine de la note citante : une image du
	   dossier A ne doit jamais être servie à une note du dossier B, exactement
	   comme un lien ne sort pas d'un vault. Sans cette borne, un homonyme d'un
	   autre dossier gagnerait au hasard du départage — ou, pire, serait le SEUL
	   résultat trouvé quand la racine de la note citante n'a elle-même aucun
	   fichier de ce nom, ce qui devrait rendre `null`, pas un fichier d'ailleurs.
	   L'appartenance à une racine se lit via `carte.pour`, jamais par un
	   préfixe recomposé à la main : c'est la carte qui sait ce qu'est un
	   chemin du contrat, pas cette fonction. */
	const dansLaRacineDe = (fromPath: string): HostFile[] => {
		const racine = carte.pour(fromPath);
		const tous = index.all();
		if (!racine) return tous;
		return tous.filter(f => carte.pour(f.path)?.id === racine.id);
	};

	/* RÉGRESSION du premier tour de revue, corrigée ici : un lien ÉCRIT DANS
	   UNE NOTE (« Autre/schema.png ») n'est JAMAIS préfixé — c'est la forme
	   que l'utilisateur tape en Markdown. L'index, lui, ne contient plus que
	   des chemins du CONTRAT (« Quiz/Autre/schema.png »). Sans cette
	   conversion, les étapes 1 (chemin exact) et 2 (extension implicite) de
	   `resolveDansIndex` comparent un lien nu à un index préfixé et ne
	   matchent donc plus JAMAIS : tout retombe sur la recherche par NOM, qui
	   perd la règle n°1 de `resolveDansIndex` — « le fichier explicitement
	   désigné gagne toujours » — dès qu'un homonyme existe ailleurs, plus
	   proche par la seule proximité de dossier.
	   `carte.contrat` est le SEUL endroit qui pose ce préfixe ; une racine
	   introuvable pour `fromPath` (chaîne vide) laisse le lien inchangé,
	   exactement comme sous l'hôte Obsidian (identifiant de racine vide). */
	const versContrat = (chemin: string, fromPath: string): string =>
		carte.contrat(carte.pour(fromPath)?.id ?? "", chemin);

	return {
		resolve(linkPath, fromPath) {
			return resolveDansIndex(dansLaRacineDe(fromPath), versContrat(linkPath, fromPath), fromPath);
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
				/* Un chemin déjà complet (donc préfixé — le `.path` d'un
				   `HostFile` déjà résolu) est cherché tel quel, par le chemin
				   RAPIDE (`index.get`) ; un lien écrit dans une note passe par
				   la même conversion que `resolve`, bornée à la racine de la
				   note citante — ou, à défaut de note citante, à celle du
				   chemin lui-même. */
				const depuis = fromPath || chemin;
				const f = index.get(chemin) ?? resolveDansIndex(dansLaRacineDe(depuis), versContrat(chemin, depuis), depuis);
				if (!f) return null;
				const a = carte.absolu(f.path);
				return a ? convertFileSrc(a) || null : null;
			} catch (e) {
				console.warn(LOG_PREFIX, "resourceUrl erreur:", e);
				return null;
			}
		},
	};
}
