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

/* ══════════════════════════════════════════════════════════
   LE RENOMMAGE D'UN DOSSIER — TÂCHE 5

   Chokidar ne remonte jamais une paire appariée : un dossier renommé produit
   un `unlinkDir` PUIS un `addDir`, sans rien qui les lie. `evenementDeRenommageDossier`
   ci-dessous est la règle d'appariement, appliquée par `index-fichiers.ts` aux
   dossiers supprimés/créés qu'il a accumulés dans UNE MÊME fenêtre de
   débounce (voir sa doc pour où vit cette fenêtre — ELLE n'est pas ici, ce qui
   suit est PUR).

   ELLE N'APPARIE JAMAIS PAR DÉFAUT (`src/host/types.ts`, `HostWatcher.onRenameDir`
   : « un hôte qui ne sait pas distinguer un dossier renommé n'appelle jamais
   le rappel ; il ne DEVINE pas »). Une fausse paire déplacerait l'historique
   de révision d'un dossier vers un AUTRE — pire que de ne rien émettre, parce
   que silencieux et faux. D'où les gardes, dans l'ordre où elles refusent :
     1. AUCUN AUTRE CANDIDAT, une fois les dossiers NON-RACINE de chaque liste
        écartés (voir `racinesDuMouvement` : renommer un dossier qui a des
        sous-dossiers fait remonter, dans la même fenêtre, un `unlinkDir`/
        `addDir` pour CHACUN d'eux — les compter comme des candidats
        concurrents ferait échouer l'appariement d'un renommage pourtant
        univoque). Il doit rester EXACTEMENT un candidat de chaque bord ; deux
        renommages simultanés (deux racines de chaque côté) n'apparient rien.
     2. MÊME PARENT : un dossier qui change de PARENT n'est pas qu'un
        renommage, c'est un déplacement — plus incertain, on ne le devine pas
        non plus ici.
     3. HORS CATALOGUE : un dossier ignoré (`.trash`, `node_modules`), à
        l'arrivée ou au départ, est traité comme les FICHIERS le sont déjà par
        `evenementDeRenommage` ci-dessus — entrer dans un dossier ignoré ou en
        sortir n'est jamais un renommage pour le catalogue.
══════════════════════════════════════════════════════════ */

/** Le chemin du contrat sans son dernier segment — le PARENT d'un dossier. */
function parentDeDossier(cheminContrat: string): string {
	const segments = cheminContrat.split("/");
	return segments.slice(0, -1).join("/");
}

/** Un chemin de DOSSIER (pas de fichier : le dernier segment compte aussi)
    qui traverse ou se réduit à un dossier ignoré. */
export function dossierHorsCatalogue(cheminContrat: string): boolean {
	return cheminContrat.split("/").slice(1).some(dossierIgnore);
}

/**
 * Ne garde, dans une liste de chemins de dossiers observés dans la même
 * fenêtre, que ceux qui ne sont descendants d'AUCUN autre de cette liste.
 *
 * C'est ce qui absorbe les sous-dossiers d'un renommage : renommer
 * « Cours » (qui contient « Cours/TD ») fait remonter un `unlinkDir` pour
 * « Cours » ET pour « Cours/TD » ; seul « Cours » est la RACINE du mouvement,
 * « Cours/TD » n'est qu'une conséquence du premier et ne doit pas compter
 * comme un second candidat.
 */
function racinesDuMouvement(chemins: string[]): string[] {
	return chemins.filter(c => !chemins.some(autre => autre !== c && c.startsWith(autre + "/")));
}

/**
 * Ce qu'un renommage de DOSSIER doit devenir pour le journal de révision, à
 * partir des dossiers supprimés et créés observés dans UNE MÊME fenêtre de
 * débounce. `null` dès que l'appariement n'est pas CERTAIN — voir l'en-tête
 * ci-dessus pour les trois gardes.
 *
 * PURE : aucun disque, aucun chokidar, aucun délai. C'est ce qui la rend
 * éprouvable sans watcher, et ce qui garantit qu'`index-fichiers.ts` (qui,
 * lui, accumule dans le temps) ne peut pas diverger de la règle qu'il
 * applique.
 */
export function evenementDeRenommageDossier(
	supprimes: string[],
	crees: string[],
): { from: string; to: string } | null {
	const candidatsSupprimes = racinesDuMouvement(supprimes);
	const candidatsCrees = racinesDuMouvement(crees);
	if (candidatsSupprimes.length !== 1 || candidatsCrees.length !== 1) return null;
	const [from] = candidatsSupprimes;
	const [to] = candidatsCrees;
	if (dossierHorsCatalogue(from) || dossierHorsCatalogue(to)) return null;
	if (parentDeDossier(from) !== parentDeDossier(to)) return null;
	return { from, to };
}
