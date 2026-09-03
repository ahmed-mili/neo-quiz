/**
 * IDENTITÉ D'UNE QUESTION — une seule règle, partagée.
 *
 * L'écriture d'un bloc (editor/export.ts) et sa LECTURE par le scanner
 * doivent attribuer exactement le même identifiant. Deux règles séparées
 * divergeraient, et une question sans `id:` explicite changerait de clé à
 * sa première sauvegarde depuis l'éditeur : son historique de révision
 * serait perdu en silence.
 *
 * Mesuré le 2026-09-02 sur les vaults réels : 771 des 774 questions portent
 * déjà un `id` explicite. Le repli est rare — raison de plus pour qu'il
 * soit exact plutôt que réinventé de deux façons.
 */

/** Slug ASCII d'un titre. Le JSON5 brut peut violer le type statique : une
    valeur non textuelle doit produire le même repli `qN` qu'un titre absent,
    pas faire disparaître le quiz entier pendant son scan. */
function slug(title: unknown): string {
	const text = typeof title === "string" ? title : "";
	return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);
}

/**
 * Un `id` ne compte comme EXPLICITE que s'il reste une chaîne non vide après
 * trim — miroir exact de la règle d'`editor/convert.ts` (`typeof q.id ===
 * "string" && q.id.trim()`, qui pose `question._sourceId`). Sans cette
 * normalisation ICI, `id: '   '` était explicite pour cette fonction et
 * absent pour l'éditeur — deux règles divergentes, exactement ce que ce
 * module existe pour empêcher. `it.id` est TYPÉ `string | undefined`, mais le
 * scanner (task 6) lit du JSON5 non typé : un `id: 42` écrit à la main y
 * arrive tel quel, et sans le `typeof`, un nombre traverserait la signature
 * qui promet un `string[]`.
 */
function explicitId(it: { id?: string }): string | undefined {
	return typeof it.id === "string" && it.id.trim() ? it.id : undefined;
}

/**
 * Identifiants d'un bloc à partir de ses éléments BRUTS — avant toute
 * validation, tels qu'ils sortent du tableau JSON5. Un bloc peut contenir un
 * élément parasite (`null`, une chaîne, un objet sans `id` ni `title`) :
 * l'éditeur lui attribue quand même un `qN` pour garder l'alignement des
 * positions (scanner.ts), et le moteur doit faire pareil plutôt que planter
 * tout le rendu du bloc sur cet unique élément.
 *
 * Point de partage délibéré (fix round 1, 2026-09-02) : `assignQuestionIds`
 * seule ne suffisait pas — chaque appelant retapait `q?.id, q?.title` à sa
 * façon, et engine.ts avait fini par écrire `q.id` SANS le `?.` (élément non
 * objet ⇒ TypeError à l'assemblage du ctx, bloc qui ne rend plus du tout, là
 * où le scanner aurait simplement affiché une carte vide). Trois divergences
 * nées de cette même expression retapée dans ce seul chantier (la règle
 * d'identité elle-même, le filtrage des éléments non-objets, et maintenant ce
 * `?.` manquant) : centraliser plutôt que corriger un quatrième site un jour.
 */
export function idsForRawItems(items: ReadonlyArray<unknown>): string[] {
	return assignQuestionIds(items.map(raw => {
		const it = raw as { id?: unknown; title?: unknown } | null | undefined;
		// `explicitId`/`slug` (ci-dessus) valident déjà le TYPE de `id`/`title`
		// à l'exécution (`typeof ... === "string"`) : seule la présence de
		// l'élément lui-même (`raw` non nullish, un objet) reste à garder ici.
		return { id: it?.id as string | undefined, title: it?.title as string | undefined };
	}));
}

/**
 * Identifiants d'un bloc entier, dans l'ordre des questions.
 *
 * Deux subtilités, chacune issue d'une revue :
 *
 * 1. Un identifiant EXPLICITE a le droit de prendre SA réservation, celle-là
 *    seulement. Un slug dérivé, ou un candidat suffixé, n'appartient à
 *    personne : il doit éviter aussi les réservations à VENIR, sinon il
 *    prend la place d'une question plus bas. Avec `dup, dup, dup-2`,
 *    ignorer cette nuance donnait `dup, dup-2, dup-2-2` — la seule question
 *    qui avait un identifiant unique le perdait.
 * 2. Le suffixe s'applique MÊME à un identifiant explicite : deux questions
 *    portant le même (un copier-coller de bloc suffit) auraient la même
 *    ancre HTML, et la seconde deviendrait inatteignable.
 */
export function assignQuestionIds(items: ReadonlyArray<{ id?: string; title?: string }>): string[] {
	const reserves = new Set(items.map(explicitId).filter((v): v is string => !!v));
	const attribues = new Set<string>();
	return items.map((it, idx) => {
		const explicite = explicitId(it);
		const base = explicite || slug(it.title) || `q${idx + 1}`;
		const libre = (id: string): boolean => {
			if (attribues.has(id)) return false;
			if (explicite && id === base) return true;
			return !reserves.has(id);
		};
		let id = base;
		let n = 2;
		while (!libre(id)) id = `${base}-${n++}`;
		attribues.add(id);
		return id;
	});
}
