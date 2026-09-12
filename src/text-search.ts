/* ══════════════════════════════════════════════════════════
   LA RECHERCHE FLOUE PARTAGÉE

   Remplace `prepareFuzzySearch` d'Obsidian dans le sélecteur « @ »
   (`dashboard/file-sources.ts`, `searchAll`), qui notait chaque chemin du
   vault et des racines externes contre ce que l'utilisateur tape. L'API
   d'Obsidian n'existe pas dans l'application ; la règle vit donc ici, dans le
   code partagé, et les deux hôtes trient de la même façon.

   MÊME FORME QUE L'ORIGINAL : `fuzzyMatch(query)` rend une fonction qui note
   un texte, `null` s'il ne correspond pas, sinon un score NÉGATIF — plus
   proche de zéro = meilleur — que l'appelant trie par ordre décroissant, comme
   il le faisait déjà. Aucun chiffre n'est promis identique à celui d'Obsidian :
   ce que le contrôle (`scripts/check-text-search.mjs`) tient, ce sont les
   ORDRES observés dans Obsidian (1.12.7, `prepareFuzzySearch` appelé depuis le
   vault Efrei, 2026-09-12), pas ses valeurs.

   CE QUE LE SCORE COÛTE, par ordre de poids — trois échelles séparées d'un
   facteur dix, comme celles qu'Obsidian laisse voir dans ses scores :
   - une RUPTURE (la requête se retrouve en deux morceaux non contigus dans le
     texte) coûte 1 : « note » dans « Cours/notes.md » (un seul morceau) bat
     « no-te.md » (deux), même si chaque morceau y ouvre un mot ;
   - un morceau qui commence EN PLEIN MOT coûte 0,1 : « td » trouve
     « Cours/TD3.md » avant « std.md » ;
   - la distance sautée et la longueur du texte coûtent 0,001 par caractère :
     à égalité, le chemin le plus court passe devant.
   Un caractère qui suit IMMÉDIATEMENT le précédent ne coûte rien, et un
   morceau qui ouvre un mot (après `/`, `-`, `_`, `.`, une espace, ou une
   majuscule après une minuscule) ne coûte que sa distance.

   L'alignement retenu est le MOINS CHER de tous ceux qui existent
   (programmation dynamique) : un glouton qui prendrait le premier « c » de
   « Cours/ch1.md » ne verrait jamais que « ch » y est contigu six caractères
   plus loin — c'est le défaut qui a fait réécrire cette fonction.

   La casse est IGNORÉE — Windows l'ignore, et un chemin recopié à la main
   l'ignore souvent aussi. Un mot de la requête séparé par une espace est
   cherché INDÉPENDAMMENT (« cours ja » trouve « Cours/Java/TD3.md ») : une
   espace n'a pas à exister dans le chemin, alors qu'elle existe dans la
   requête dès qu'on tape deux mots.
══════════════════════════════════════════════════════════ */

/** Ce qu'un texte noté rend : la forme de `prepareFuzzySearch`, réduite à ce
    que l'appelant lit. */
export interface FuzzyResult {
	/** Négatif ou nul ; plus proche de zéro = meilleur. */
	score: number;
}

/** Le caractère à `i` ouvre-t-il un mot ? Début de texte, séparateur devant,
    ou majuscule après une minuscule (« camelCase »). */
function debutDeMot(texte: string, i: number): boolean {
	if (i === 0) return true;
	const avant = texte[i - 1];
	if (/[\s/\\\-_.()[\]]/.test(avant)) return true;
	const c = texte[i];
	return c !== c.toLowerCase() && avant === avant.toLowerCase();
}

/** Un morceau de plus : la requête n'est pas contiguë dans le texte. */
const RUPTURE = 1;
/** Un morceau qui commence en plein mot, là où un début de mot ne coûte rien. */
const PLEIN_MOT = 0.1;
/** Par caractère sauté avant un morceau, et par caractère du texte : ne sert
    qu'à départager deux alignements de même forme — le plus court gagne. */
const PAR_CARACTERE = 0.001;

/** Le coût d'apparier le caractère à l'index `vers`, le précédent l'ayant été
    à `depuis` (`-1` pour le premier caractère de la requête). */
function coutSaut(texte: string, depuis: number, vers: number): number {
	if (depuis >= 0 && vers === depuis + 1) return 0; // contigu
	let cout = (vers - depuis - 1) * PAR_CARACTERE;
	if (depuis >= 0) cout += RUPTURE;
	if (!debutDeMot(texte, vers)) cout += PLEIN_MOT;
	return cout;
}

/**
 * Note UN mot de la requête contre le texte, ou `null` s'il n'en est pas une
 * sous-séquence. Rend le coût du MEILLEUR alignement (positif ; l'appelant le
 * nie).
 *
 * Programmation dynamique caractère par caractère : pour chaque occurrence du
 * caractère courant dans le texte, le moins cher des alignements du
 * précédent qui tombent AVANT elle, plus le saut. Les occurrences sont
 * parcourues par index croissant, donc la carte `precedent` l'est aussi et la
 * boucle interne s'arrête dès qu'elle dépasse l'occurrence courante. Un chemin
 * fait quelques dizaines de caractères et une requête quelques-uns : le coût
 * par frappe reste négligeable devant celui du rendu de la liste.
 */
function noterMot(mot: string, texteBas: string, texte: string): number | null {
	let precedent: Map<number, number> | null = null;
	for (const c of mot) {
		const courant = new Map<number, number>();
		for (let i = texteBas.indexOf(c); i >= 0; i = texteBas.indexOf(c, i + 1)) {
			let meilleur = Infinity;
			if (precedent === null) {
				meilleur = coutSaut(texte, -1, i);
			} else {
				for (const [k, coutK] of precedent) {
					if (k >= i) break;
					meilleur = Math.min(meilleur, coutK + coutSaut(texte, k, i));
				}
			}
			if (meilleur < Infinity) courant.set(i, meilleur);
		}
		if (courant.size === 0) return null;
		precedent = courant;
	}
	if (precedent === null) return 0;
	return Math.min(...precedent.values());
}

/**
 * Prépare une requête. Rend une fonction qui note un texte : `null` si un mot
 * de la requête n'y figure pas en sous-séquence, sinon `{ score }` négatif.
 * Une requête vide accepte tout.
 */
export function fuzzyMatch(query: string): (text: string) => FuzzyResult | null {
	const mots = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
	return (text: string) => {
		const texte = String(text ?? "");
		const texteBas = texte.toLowerCase();
		let cout = 0;
		for (const mot of mots) {
			const c = noterMot(mot, texteBas, texte);
			if (c === null) return null;
			cout += c;
		}
		return { score: -(cout + texte.length * PAR_CARACTERE) };
	};
}
