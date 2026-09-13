import type { LogLine } from "../scheduler";

/* ══════════════════════════════════════════════════════════
   TRANSPOSER DES LIGNES DE JOURNAL D'UN DOSSIER VERS UN AUTRE

   Pur : ni horloge, ni disque, ni hôte. Utilisé par `review-store.ts`
   (`moved`) quand un module change de RACINE — un déplacement entre deux
   journaux distincts, pas un renommage (qui reste dans le même journal et
   passe par `renamed`).

   Le préfixe se compare avec un « / » final explicite : « Cours2/ » ne
   commence pas par « Cours/ », donc un dossier « Cours2 » n'est jamais
   confondu avec « Cours ». Une ligne qui ne concerne pas `fromDir` est
   IGNORÉE (absente du résultat) : le journal cible ne doit recevoir que ce
   qui appartenait au dossier déplacé, jamais tout l'historique de la racine
   source.
══════════════════════════════════════════════════════════ */

/** Remplace le préfixe `fromDir` d'un chemin par `toDir`, ou `null` si le
    chemin n'est pas sous `fromDir`. */
function remplacerPrefixe(chemin: string, fromDir: string, toDir: string): string | null {
	const prefixe = fromDir + "/";
	if (!chemin.startsWith(prefixe)) return null;
	return toDir + "/" + chemin.slice(prefixe.length);
}

export function transposerLignes(lignes: LogLine[], fromDir: string, toDir: string): LogLine[] {
	const out: LogLine[] = [];
	for (const l of lignes) {
		if (l.t === "answer") {
			const i = l.q.lastIndexOf("::");
			const chemin = i > 0 ? l.q.slice(0, i) : l.q;
			const suffixe = i > 0 ? l.q.slice(i) : "";
			const nouveauChemin = remplacerPrefixe(chemin, fromDir, toDir);
			if (nouveauChemin === null) continue;
			out.push({ ...l, q: nouveauChemin + suffixe });
		} else {
			const nouveauFrom = remplacerPrefixe(l.from, fromDir, toDir);
			const nouveauTo = remplacerPrefixe(l.to, fromDir, toDir);
			// Ni l'un ni l'autre ne concerne le dossier déplacé : ligne ignorée.
			if (nouveauFrom === null && nouveauTo === null) continue;
			out.push({ ...l, from: nouveauFrom ?? l.from, to: nouveauTo ?? l.to });
		}
	}
	return out;
}
