/* ══════════════════════════════════════════════════════════
   LE CATALOGUE — CE QUI EST UN QUIZ, CE QUI NE L'EST PAS

   Tâche 2 de la migration Tauri → Electron
   (docs/superpowers/plans/2026-09-11-migration-electron.md). Ces deux
   fonctions PURES décident si un chemin appartient au catalogue de quiz, et ce
   qu'un renommage doit y devenir. Elles n'importent NI Node NI Electron : le
   plan de la tâche 2 demandait de les déplacer dans `index-fichiers.ts`, mais
   ce module-là importe `creerFichiers()` (donc `node:fs/promises`) — or la
   tâche 4 fera importer CES DEUX fonctions par le RENDU
   (`apps/windows/src/host/fs.ts`, qui tourne avec `contextIsolation` et
   qu'esbuild/Vite bundle). Le rendu tirerait Node à travers elles. Elles
   vivent donc ici, dans un module SANS AUCUNE dépendance Node, que
   `index-fichiers.ts` (processus principal) et `src/host/fs.ts` (rendu, via
   réexportation le temps de la tâche 4) peuvent tous les deux importer.

   Reprises TELLES QUELLES depuis l'hôte Tauri actuel
   (`apps/windows/src/host/fs.ts`) : elles portent un défaut réel déjà corrigé
   — un quiz mis à la corbeille rentrait au catalogue sous son chemin de
   corbeille et y restait jusqu'au redémarrage, parce que `reconcilier`
   filtrait par `horsCatalogue` mais la branche des renommages `both` non. Ne
   pas les réécrire ; ce module ne fait que les reloger.
══════════════════════════════════════════════════════════ */

import type { HostFile, HostFileEvent } from "../../../src/host/types";

/**
 * Dossiers jamais indexés.
 *
 * Tout dossier CACHÉ (nom commençant par un point) est écarté, plus
 * `node_modules`. Ce n'est pas de la coquetterie : indexer `.git` fait grimper
 * un dossier de cours de quelques centaines d'entrées à des dizaines de
 * milliers, dont pas une seule n'est un quiz. `.obsidian` et `.neo-quiz`
 * tombent sous la même règle ; ils restent LISIBLES par chemin, ils ne sont
 * simplement pas au catalogue.
 */
export function dossierIgnore(nom: string): boolean {
	return nom.startsWith(".") || nom === "node_modules";
}

/**
 * Un chemin du CONTRAT que le catalogue ne doit pas connaître : il traverse un
 * dossier ignoré, ou il se réduit à la racine elle-même.
 *
 * Nommée et exportée pour être ÉPROUVABLE, et pour que le parcours du démarrage
 * et le surveillant ne puissent pas diverger : c'est exactement ce qui venait
 * d'arriver (voir l'en-tête). Le premier segment est l'identifiant de la
 * racine et le dernier le NOM du fichier : ni l'un ni l'autre n'est un dossier
 * traversé.
 */
export function horsCatalogue(cheminContrat: string): boolean {
	const segments = cheminContrat.split("/");
	if (segments.length < 2) return true;
	return segments.slice(1, -1).some(dossierIgnore);
}

/**
 * Ce que le CATALOGUE doit retenir d'un renommage de fichier, une fois ses deux
 * chemins résolus dans l'espace du contrat. `null` quand il n'a rien à en
 * faire.
 *
 * Un renommage qui ENTRE dans un dossier ignoré n'est pas un renommage pour le
 * catalogue, c'est une DISPARITION ; qui en SORT, une APPARITION. Diffuser un
 * `rename` dans le premier cas insérerait le chemin de corbeille à l'index ;
 * se contenter de ne rien diffuser y laisserait l'ANCIEN chemin, donc un quiz
 * que plus aucun fichier ne peut mettre à jour — les deux moitiés sont
 * nécessaires.
 *
 * PURE : c'est ce qui la rend éprouvable, le surveillant ne l'étant pas.
 */
export function evenementDeRenommage(
	avant: string,
	apres: string,
	file: HostFile,
): HostFileEvent | null {
	const avantAuCatalogue = !horsCatalogue(avant);
	const apresAuCatalogue = !horsCatalogue(apres);
	if (!apresAuCatalogue) return avantAuCatalogue ? { kind: "delete", path: avant } : null;
	return avantAuCatalogue
		? { kind: "rename", file, oldPath: avant }
		: { kind: "create", file };
}
