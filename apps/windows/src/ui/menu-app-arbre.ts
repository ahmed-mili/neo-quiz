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

export function buildMenu(ctx: { version: string; zoom: number }): EntreeMenu[] {
	return [
		{ kind: "submenu", id: "app", label: PRODUCT_NAME, items: [
			{ kind: "version", id: "version", label: ctx.version },
			{ kind: "action", id: "check-updates", label: t("app.menu.checkUpdates") },
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
