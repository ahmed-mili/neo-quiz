/* ══════════════════════════════════════════════════════════
   LE FOND D'ÉCRAN — LE NOYAU PUR

   Deux fonctions sans `pont()` ni DOM, éprouvées par
   `scripts/check-fond.mjs` sur le module réel — même patron que
   `reprise.ts` (`lireDerniereVue`) et `mise-a-jour.ts` : ce qui peut être
   pur DOIT l'être, pour être éprouvé sans fenêtre ni Electron.
══════════════════════════════════════════════════════════ */

/** Les extensions qu'une image de fond peut porter, casse ignorée — les
    mêmes formats que `chromium` affiche nativement en `background-image`.
    Pas `.svg` : un SVG hostile posé dans le dossier choisi pourrait embarquer
    du script, alors qu'un fond d'écran n'a besoin d'aucune interactivité. */
export const EXTENSIONS_FOND: ReadonlySet<string> = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);

/** Vrai si `nom` porte une extension de fond reconnue. Sur le DERNIER point
    du nom, casse ignorée ; un nom vide ou sans extension n'est jamais une
    image de fond. */
export function estImageDeFond(nom: string): boolean {
	const s = String(nom ?? "");
	const point = s.lastIndexOf(".");
	if (point <= 0) return false;
	return EXTENSIONS_FOND.has(s.slice(point + 1).toLowerCase());
}

/**
 * La prochaine image dans l'ordre trié de `noms`, CYCLIQUE : après la
 * dernière revient la première. Si `courante` est absente de `noms` (l'image
 * a disparu du disque), la PREMIÈRE de la liste triée est rendue — c'est
 * aussi la règle que `fond.ts` emploie pour retomber sur une image qui
 * existe encore. `undefined` si `noms` est vide : rien à montrer.
 */
export function suivante(noms: string[], courante: string | undefined): string | undefined {
	const tries = [...noms].sort((a, b) => a.localeCompare(b));
	if (!tries.length) return undefined;
	const i = courante === undefined ? -1 : tries.indexOf(courante);
	if (i === -1) return tries[0];
	return tries[(i + 1) % tries.length];
}
