import type { Host } from "./types";

/* ══════════════════════════════════════════════════════════
   L'HÔTE COURANT

   Le moteur reçoit son hôte par `ctx.host` — c'est la voie normale, et elle
   reste explicite. Trois modules n'ont pas de `ctx` (`engine/mathjax.ts`,
   `engine/math-input.ts`) : ils lisent `currentHost()`. C'est le MÊME objet,
   assigné une seule fois au démarrage de chaque hôte ; `engine.ts` remplit
   `ctx.host` depuis `currentHost()`, il n'y a donc qu'une source.

   Un singleton se justifie ici parce qu'il n'y a jamais deux hôtes dans un
   processus : un greffon dans Obsidian, une app dans sa fenêtre. C'est le
   même choix que `src/i18n.ts`, pour la même raison.
══════════════════════════════════════════════════════════ */

let installed: Host | null = null;

/** Appelé UNE fois par l'hôte, avant tout rendu. */
export function installHost(host: Host): void {
	installed = host;
}

/** Retire l'hôte (déchargement du greffon, jeux de cas). Sans ça, un
    rechargement du greffon laisserait un hôte pointant vers une `App` morte. */
export function uninstallHost(): void {
	installed = null;
}

/**
 * L'hôte courant. JETTE si aucun n'est installé, au lieu de renvoyer
 * `undefined` : un `?.` avalerait la panne et la fonctionnalité serait
 * silencieusement inerte — précisément le défaut que la relecture ne voit pas.
 */
export function currentHost(): Host {
	if (!installed) {
		throw new Error("Aucun hôte installé : installHost() doit être appelé au démarrage.");
	}
	return installed;
}

/** Pour le seul cas où l'absence d'hôte est normale : `src/i18n.ts` peut être
    sollicité avant l'installation (chargement des modules). */
export function hostOrNull(): Host | null {
	return installed;
}

/** Un membre OPTIONNEL du contrat, exigé : le greffon lecteur ne fournit
    ni `process`, ni `net`, ni `modals` ; une page qui les demande est une
    page que le greffon n'a plus. L'erreur nomme le membre. */
export function requireHost<K extends "modals" | "net" | "process" | "pdf">(k: K): NonNullable<Host[K]> {
	const v = currentHost()[k];
	if (!v) throw new Error(`host.${k} absent sur cet hôte`);
	return v;
}
