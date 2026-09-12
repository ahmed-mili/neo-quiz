import { currentHost } from "./host/current";

/* ══════════════════════════════════════════════════════════
   HOTKEYS DU COMPOSER — format & capture partagés
   Réglages { modifiers: ["Mod"|"Ctrl"|"Alt"|"Shift"|"Meta"…],
   key: e.key minuscule } consommés par le Scope de la vue
   dashboard, affichés dans le menu « + » et édités dans les
   réglages du plugin. « Mod » suit la convention Obsidian :
   Ctrl sur Windows/Linux, ⌘ sur macOS.
   La plateforme vient du CONTRAT (`HostPlatform.isMacOS`), plus de
   `Platform` d'Obsidian (tâche 6 de la tranche 5) : la page « Générer »
   affiche ces raccourcis dans son menu « + » sous les deux hôtes.
══════════════════════════════════════════════════════════ */

type Modifier = "Mod" | "Ctrl" | "Alt" | "Shift" | "Meta";

export interface Hotkey {
	modifiers: Modifier[];
	key: string;
}

const MAC_GLYPHS: Record<Modifier, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" };
const WIN_LABELS: Record<Modifier, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Win" };

/* { modifiers, key } → « Ctrl+F » (Windows/Linux) ou « ⌘F » (macOS). */
function formatHotkey(hk: Hotkey | null | undefined): string {
	if (!hk || !hk.key) return "";
	const mac = currentHost().platform.isMacOS;
	const mods = (hk.modifiers || []).map(m => (mac ? MAC_GLYPHS[m] : WIN_LABELS[m]) || m);
	const key = hk.key.length === 1 ? hk.key.toUpperCase()
		: hk.key.charAt(0).toUpperCase() + hk.key.slice(1);
	return mac ? mods.join("") + key : [...mods, key].join("+");
}

/* KeyboardEvent → { modifiers, key }, ou null si la touche pressée est
   un modificateur seul (capture en attente de la touche finale). */
function eventToHotkey(e: KeyboardEvent): Hotkey | null {
	if (["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(e.key)) return null;
	const mac = currentHost().platform.isMacOS;
	const modifiers: Modifier[] = [];
	// « Mod » = la touche de commande usuelle de la plateforme ; l'autre
	// touche contrôle garde son nom propre (portabilité du réglage).
	if (e.ctrlKey) modifiers.push(mac ? "Ctrl" : "Mod");
	if (e.metaKey) modifiers.push(mac ? "Mod" : "Meta");
	if (e.altKey) modifiers.push("Alt");
	if (e.shiftKey) modifiers.push("Shift");
	return { modifiers, key: e.key.toLowerCase() };
}

export { formatHotkey, eventToHotkey };
