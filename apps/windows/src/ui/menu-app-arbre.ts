/* ══════════════════════════════════════════════════════════
   L'ARBRE DU MENU D'APPLICATION — pur

   Relu à chaque ouverture, pour que `t()` suive la langue et que la coche
   d'échelle suive le zoom courant. Aucun DOM, aucun pont : `check:menu-app`
   l'éprouve tel quel. Le PRODUIT n'est jamais traduit (`PRODUCT_NAME`).
══════════════════════════════════════════════════════════ */
import { t } from "../../../../src/i18n";
import { PRODUCT_NAME } from "../../../../src/branding";

export type EntreeMenu =
	| { kind: "version"; id: string; label: string }
	| { kind: "action"; id: string; label: string; shortcut?: string; disabled?: boolean }
	| { kind: "check"; id: string; label: string; value: number; checked: boolean }
	| { kind: "separator"; id: string }
	| { kind: "submenu"; id: string; label: string; items: EntreeMenu[] };

/** 80 % à 150 % par pas de 10 : les bornes du principal (`canaux.ts`). */
export const PALIERS_ZOOM = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];

/** Le palier VOISIN d'une valeur, vers le haut (`1`) ou vers le bas (`-1`) :
    ce que Ctrl + molette demande (`ui/barre-titre.ts`), et la seule façon de
    le demander sans redire la liste ailleurs.

    Il travaille à la TOLÉRANCE de la coche (un millième) : le facteur rendu
    par `webContents.getZoomFactor` n'est pas toujours le nombre écrit
    (1,0999999 pour 1,1), et une comparaison stricte ferait rendre deux fois
    le même palier, donc un cran de molette sans effet.

    Une valeur HORS des bornes revient dans la liste : depuis 2, un cran vers
    le haut ne trouve aucun palier plus grand et rend le dernier (1,5). C'est
    la même borne que le principal applique de son côté (`canaux.ts`), pas une
    seconde règle. */
export function palierZoomVoisin(courant: number, sens: 1 | -1): number {
	const base = Number.isFinite(courant) ? courant : 1;
	if (sens === 1) return PALIERS_ZOOM.find(p => p > base + 0.001) ?? PALIERS_ZOOM[PALIERS_ZOOM.length - 1];
	return [...PALIERS_ZOOM].reverse().find(p => p < base - 0.001) ?? PALIERS_ZOOM[0];
}

export function buildMenu(ctx: { version: string; zoom: number }): EntreeMenu[] {
	return [
		{ kind: "submenu", id: "app", label: PRODUCT_NAME, items: [
			{ kind: "version", id: "version", label: ctx.version },
			{ kind: "action", id: "check-updates", label: t("app.menu.checkUpdates") },
			/* Le lien vers le dépôt, arrivé ici le 2026-09-17 avec la
			   suppression de la section « À propos » des Réglages : il
			   appartient au même bloc que la version, qui est déjà dans ce
			   menu. La clé est celle qu'il portait là-bas — inchangée, comme
			   son URL (`manifest.json`, `helpUrl`). */
			{ kind: "action", id: "repo", label: t("settings.about.repo") },
			{ kind: "action", id: "settings", label: t("app.menu.settings"), shortcut: "Ctrl+," },
		] },
		{ kind: "submenu", id: "edit", label: t("app.menu.edit"), items: [
			{ kind: "action", id: "undo", label: t("app.menu.undo"), shortcut: "Ctrl+Z" },
			{ kind: "action", id: "redo", label: t("app.menu.redo"), shortcut: "Ctrl+Y" },
			{ kind: "separator", id: "edit-sep" },
			{ kind: "action", id: "cut", label: t("app.menu.cut"), shortcut: "Ctrl+X" },
			{ kind: "action", id: "copy", label: t("app.menu.copy"), shortcut: "Ctrl+C" },
			{ kind: "action", id: "paste", label: t("app.menu.paste"), shortcut: "Ctrl+V" },
			{ kind: "action", id: "select-all", label: t("app.menu.selectAll"), shortcut: "Ctrl+A" },
		] },
		{ kind: "submenu", id: "view", label: t("app.menu.view"), items: [
			{ kind: "submenu", id: "scale", label: t("app.menu.scale"), items: PALIERS_ZOOM.map(p => ({
				kind: "check" as const, id: `scale-${Math.round(p * 100)}`, label: `${Math.round(p * 100)} %`, value: p,
				checked: Math.abs(p - ctx.zoom) < 0.001,
			})) },
			{ kind: "action", id: "next-wallpaper", label: t("app.menu.nextWallpaper"), shortcut: "Ctrl+Shift+B" },
			{ kind: "separator", id: "view-sep" },
			{ kind: "action", id: "reload", label: t("app.menu.reload"), shortcut: "Ctrl+R" },
			{ kind: "action", id: "fullscreen", label: t("app.menu.fullscreen"), shortcut: "F11" },
			{ kind: "action", id: "devtools", label: t("app.menu.devtools"), shortcut: "Ctrl+Alt+I" },
		] },
	];
}
