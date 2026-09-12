/**
 * LA RECHERCHE FLOUE PARTAGÉE — `src/text-search.ts`.
 *
 * Elle remplace `prepareFuzzySearch` d'Obsidian dans le sélecteur « @ »
 * (tranche 5, tâche 5) : les deux hôtes trient désormais par la même règle,
 * et cette règle n'est plus garantie par personne d'autre que ce script. Les
 * cas sont des ORDRES observés dans Obsidian, jamais ses valeurs de score —
 * c'est ce que le module promet, et rien de plus. Chaque cas cite le score
 * que `prepareFuzzySearch` a rendu (Obsidian 1.12.7, vault Efrei,
 * 2026-09-12) : c'est l'observation, pas une attente sur nos propres chiffres.
 *
 * Chaque cas a été éprouvé par DISCRIMINANCE (rapport de la tâche) : sans le
 * bonus de début de mot (`PLEIN_MOT = 0`), « un début de mot bat un plein
 * mot » rougit ; sans le coût de rupture (`RUPTURE = 0`), « une suite contiguë
 * bat deux morceaux » rougit ; en comparant la casse, « la casse est ignorée »
 * rougit ; avec un alignement glouton au lieu du meilleur, « deux caractères
 * contigus battent deux caractères écartés » rougit.
 *
 *     npm run check:text-search
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/text-search.ts", ({ fuzzyMatch }) => {
	const r = makeReporter("Recherche floue partagée");
	/* Le score d'un texte, ou `NaN` s'il n'est pas trouvé : une comparaison
	   avec `NaN` est fausse, donc le cas ROUGIT au lieu de mourir sur
	   `null.score` — une mort en route masquerait tous les cas suivants. */
	const score = (query, text) => fuzzyMatch(query)(text)?.score ?? NaN;

	/* Le cas de base : « cs » est une sous-séquence de « Cours » — c, puis s
	   trois caractères plus loin. Une recherche par préfixe ou par sous-chaîne
	   ne le trouverait pas. (Obsidian : -1.0412.) */
	r.check("« cs » trouve « Cours/ch1.md »",
		fuzzyMatch("cs")("Cours/ch1.md") !== null, true);

	/* Et l'absence est `null`, jamais un score très négatif : l'appelant
	   filtre sur `null` (`if (r) scored.push(...)`), un score l'afficherait.
	   (Obsidian : null.) */
	r.check("« xyz » ne trouve rien",
		fuzzyMatch("xyz")("Cours/ch1.md"), null);

	/* Le score est NÉGATIF (ou nul), plus proche de zéro = meilleur : c'est la
	   forme de `prepareFuzzySearch`, et `searchAll` trie par `b.score -
	   a.score` sans rien changer. Un score positif inverserait l'ordre. */
	r.check("le score est négatif ou nul",
		score("cs", "Cours/ch1.md") <= 0, true);

	/* OBSERVÉ : « td » place « Cours/TD3.md » (-0.0172, le morceau ouvre un
	   mot) devant « std.md » (-0.1116, le morceau commence en plein mot), bien
	   que « std.md » soit deux fois plus court. C'est le bonus de début de mot ;
	   sans lui, la longueur seule mettrait « std.md » devant. */
	r.check("un début de mot bat un plein mot",
		score("td", "Cours/TD3.md") > score("td", "std.md"), true);

	/* OBSERVÉ : « note » place « Cours/notes.md » (-0.0174, un seul morceau)
	   devant « no-te.md » (-1.0208, deux morceaux qui ouvrent chacun un mot).
	   La rupture coûte plus que tout le reste : sans elle, « no-te.md », plus
	   court et deux fois en début de mot, passerait devant. */
	r.check("une suite contiguë bat deux morceaux",
		score("note", "Cours/notes.md") > score("note", "no-te.md"), true);

	/* OBSERVÉ : « td » place « std.md » (-0.1116, contigu en plein mot) devant
	   « notes-de-cours.md » (-1.0437, éparse) — les trois échelles se
	   superposent sans se croiser. */
	r.check("un plein mot contigu bat une sous-séquence éparse",
		score("td", "std.md") > score("td", "notes-de-cours.md"), true);

	/* OBSERVÉ : « ch » place « Cours/ch1.md » (-0.0172) devant « Cache/h.md »
	   (-0.113). Le premier « c » du texte est un début de mot, mais le prendre
	   laisserait le « h » loin derrière : il faut le SECOND « c », celui de
	   « ch1 » — un glouton qui saisit la première occurrence rend l'inverse.
	   C'est le cas qui a fait passer l'alignement en programmation dynamique. */
	r.check("deux caractères contigus battent deux caractères écartés",
		score("ch", "Cours/ch1.md") > score("ch", "Cache/h.md"), true);

	/* Windows ignore la casse, et un chemin recopié à la main aussi.
	   (Obsidian : « cours » → « Cours/ch1.md » -0.0112, « COURS » →
	   « cours/x.md » -0.011.) */
	r.check("la casse est ignorée",
		fuzzyMatch("cours")("Cours/ch1.md") !== null && fuzzyMatch("COURS")("cours/x.md") !== null, true);

	/* Deux mots séparés par une espace se cherchent chacun de leur côté : la
	   requête « cours ja » n'a pas d'espace dans le chemin qu'elle vise.
	   (Obsidian : -1.0117, puis null.) */
	r.check("« cours ja » trouve « Cours/Java/TD3.md »",
		fuzzyMatch("cours ja")("Cours/Java/TD3.md") !== null, true);
	r.check("… et un mot absent fait tomber tout le chemin",
		fuzzyMatch("cours zz")("Cours/Java/TD3.md"), null);

	/* Un chemin qui contient la requête en sous-séquence n'est JAMAIS refusé,
	   quelle que soit la préférence d'alignement : dans « xa-b-a », prendre le
	   second « a » (début de mot) ne laisse plus de « b ». (Obsidian : -1.0216.) */
	r.check("un chemin qui contient la requête n'est jamais refusé",
		fuzzyMatch("ab")("xa-b-a") !== null, true);

	/* OBSERVÉ : « ch1 » place « Cours/ch1.md » (-0.0172) devant
	   « Cours/Archives 2024/ch1.md » (-0.0326) : à alignement égal, le chemin
	   le plus court gagne — le seul rôle de la pénalité par caractère. */
	r.check("à alignement égal, le chemin le plus court passe devant",
		score("ch1", "Cours/ch1.md") > score("ch1", "Cours/Archives 2024/ch1.md"), true);

	/* Une requête vide accepte tout : le sélecteur ne l'appelle pas ainsi (le
	   token vide liste la racine), mais un `null` ici viderait la liste par
	   accident le jour où un appelant le ferait. (Obsidian : 0.) */
	r.check("une requête vide accepte tout",
		fuzzyMatch("")("n'importe/quoi.md") !== null, true);

	r.done();
});
