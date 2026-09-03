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

/** Slug ASCII d'un titre. Un titre en grec, en arabe ou fait de
    ponctuation le vide entièrement : l'appelant se replie alors sur `qN`. */
function slug(title: string | undefined): string {
	return (title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);
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
	const reserves = new Set(items.map(i => i.id).filter((v): v is string => !!v));
	const attribues = new Set<string>();
	return items.map((it, idx) => {
		const explicite = it.id;
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
