/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — LA PLATEFORME

   `HostPlatform` (`src/host/types.ts`) pour l'application. Extrait de
   `./index.ts` à la tâche 2 de la génération IA, et pour la raison que ce
   fichier-là donne déjà à `roots.ts` : `index.ts` importe MathLive, qu'esbuild
   ne charge pas hors de la fenêtre, donc rien de ce qu'il contient n'est
   éprouvable par `npm run check:windows-host`. Or `isDesktopApp` est LA
   valeur que la génération IA lit pour décider si la page « Générer » a un
   sens ; un `false` glissé là par mégarde la rendrait morte dans l'app, sans
   qu'aucun contrôle ne le dise.
══════════════════════════════════════════════════════════ */

import type { HostPlatform } from "../../../../src/host/types";

export function createWindowsPlatform(): HostPlatform {
	return {
		isMobile: false,
		isMacOS: false,
		/* L'application EST un bureau : un CLI local se lance, un réseau est
		   atteignable (par le principal). C'est la question que la génération
		   IA pose, et la seule ; elle ne demande jamais « Electron ou
		   Obsidian ? ». */
		isDesktopApp: true,
		/* La langue de l'INTERFACE DE L'HÔTE. Ici l'hôte est la fenêtre
		   elle-même : `navigator.language` rend la langue du système, que
		   Chromium reprend de Windows. Accesseur et non valeur figée, par
		   symétrie avec l'hôte Obsidian ; c'est `src/i18n.ts` qui décide ce
		   qu'il en fait, pas l'hôte. `globalThis.navigator` et non `navigator`
		   nu : ce module est chargé par le contrôle hors de toute fenêtre. */
		get uiLanguage(): string {
			return globalThis.navigator?.language || "en";
		},
	};
}
