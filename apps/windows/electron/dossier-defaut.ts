/* ══════════════════════════════════════════════════════════
   LE DOSSIER DE QUIZ PAR DÉFAUT — `C:\Neo Quiz`

   Tranche 9 (docs/superpowers/specs/2026-09-13-dossier-par-defaut-design.md,
   §1 points 1 à 3, §2.1). Avant cette tranche, le premier lancement demandait
   un dossier (sélecteur natif ou vault Obsidian) : personne n'a Obsidian, et
   rien ne justifiait de choisir pour commencer. Ce module ne fait qu'UNE
   chose, pure : dire OÙ est ce dossier, pour que `main.ts` (le créer,
   `fs.mkdir`) et `perimetre.ts` (l'autoriser) restent éprouvables sans
   Electron.

   FIXE SUR WINDOWS, DÉRIVÉ AILLEURS. `C:/Neo Quiz` ne dépend pas du dossier
   personnel de l'utilisateur : c'est un emplacement stable, à la racine du
   disque système, que tout le monde retrouve au même endroit — y compris
   d'une session Windows à l'autre si le compte change. Sous Linux (l'AppImage
   doit pouvoir démarrer, et il n'y a pas de `C:`), le seul emplacement
   garanti inscriptible sans élévation est le dossier personnel : `~/Neo Quiz`.
══════════════════════════════════════════════════════════ */

/** Le nom du dossier, sur les deux systèmes — c'est aussi le nom affiché
    dans les Réglages (sans traduction : un nom de dossier n'est pas une
    chaîne d'interface, il est écrit sur le disque de l'utilisateur). */
export const DOSSIER_DEFAUT_NOM = "Neo Quiz";

/**
 * Le chemin absolu du dossier par défaut, séparateurs `/` comme partout où le
 * pont pose des chemins (`parcours.ts`).
 *
 * `plateforme` et `home` sont des ENTRÉES, jamais lus ici (`process.platform`,
 * `os.homedir()`) : c'est ce qui permet à `scripts/check-electron-reglages.mjs`
 * d'éprouver les deux systèmes depuis la même machine.
 */
export function cheminDossierDefaut(plateforme: string, home: string): string {
	if (plateforme === "win32") return `C:/${DOSSIER_DEFAUT_NOM}`;
	const normalise = home.replace(/\\/g, "/").replace(/\/+$/, "");
	return `${normalise}/${DOSSIER_DEFAUT_NOM}`;
}
