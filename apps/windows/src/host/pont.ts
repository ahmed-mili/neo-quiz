/* ══════════════════════════════════════════════════════════
   L'ACCÈS AU PONT, ÉCRIT UNE FOIS

   Tâche 4 de la migration Tauri → Electron. Tout ce que la fenêtre peut
   demander au disque passe par `window.neo` (le type vit dans
   `apps/windows/electron/pont.ts`, posé par le préchargement). Quatre modules
   du rendu en ont besoin — l'index, les dossiers, l'hôte, le démarrage — et
   une lecture recopiée quatre fois est exactement le genre de détail qui
   diverge en silence.

   LU À L'APPEL, JAMAIS CAPTURÉ AU CHARGEMENT DU MODULE. Le préchargement pose
   `neo` avant tout script de la page, donc une capture à l'import
   fonctionnerait dans la fenêtre — mais `npm run check:windows-host` charge
   ces modules hors de toute fenêtre et installe un FAUX `window.neo` APRÈS
   l'import : une capture verrait `undefined` et le contrôle n'éprouverait
   rien.

   ET L'ABSENCE EST NOMMÉE. Un rendu chargé sans préchargement (le `index.html`
   ouvert dans un navigateur ordinaire, un `vite preview`) doit le DIRE : sans
   cette garde, la première lecture mourrait sur « cannot read properties of
   undefined (reading 'liste') », une phrase qui ne désigne rien.

   `globalThis.window` et non `window` nu : ce module est chargé tel quel par
   les scripts de contrôle, où `window` n'existe pas au moment de l'import.

   Ce fichier n'importe RIEN d'exécutable — `Pont` est un type, effacé à la
   compilation : il ne peut donc pas faire entrer Node dans le paquet du rendu.
══════════════════════════════════════════════════════════ */

import type { Pont } from "../../electron/pont";

export function pont(): Pont {
	const neo = (globalThis as { window?: { neo?: Pont } }).window?.neo;
	if (!neo) throw new Error("window.neo absent : le préchargement Electron n'est pas chargé");
	return neo;
}
