/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS

   L'implémentation Tauri du contrat `src/host/types.ts`. C'est ici, et NULLE
   PART AILLEURS sous `src/`, que le code partagé touche le disque, le
   sélecteur natif ou le protocole d'asset.

   Ce fichier vit sous `apps/windows/` par construction, comme
   `apps/obsidian/host.ts` : il est l'un des deux seuls endroits du dépôt où
   dépendre d'un hôte est le but, pas une dette. `npm run check:host` balaie
   `src/` (aucun import d'`obsidian`) ET `apps/windows/src/` (aucun non plus,
   assertion 3) — les deux implémentations ne peuvent pas se contaminer.

   Depuis cette tâche, l'hôte est COMPOSITE : `carte` (`./roots.ts`) porte
   TOUTES les racines ouvertes, et ce module ne fait plus que la consommer —
   il ne connaît lui-même aucun chemin absolu ni aucune conversion de préfixe.
══════════════════════════════════════════════════════════ */

import { openPath } from "@tauri-apps/plugin-opener";
import { LOG_PREFIX } from "../../../../src/branding";
import type { Host } from "../../../../src/host/types";
import { createWindowsFs, createWindowsWatcher } from "./fs";
import type { WindowsIndex } from "./fs";
import { resultsDirFor as resultsDirForRacine } from "./roots";
import type { CarteRacines } from "./roots";
import { createWindowsLinks } from "./links";
import { createWindowsMath } from "./math";
import { createWindowsModals } from "./modal";
import { createWindowsUi } from "./ui";

export { createWindowsIndex } from "./fs";
export type { WindowsIndex } from "./fs";
export { creerCarteRacines } from "./roots";
export type { CarteRacines, RacineOuverte } from "./roots";

export function createWindowsHost(carte: CarteRacines, index: WindowsIndex): Host {
	const shell: Host["shell"] = {
		/* `openPath` de plugin-opener : l'application par défaut du système,
		   exactement comme `app.openWithDefaultApp` sous Obsidian. Le contrat
		   rend un booléen ; l'appelant (`engine/resources.ts`) s'en sert pour
		   décider s'il doit prévenir l'utilisateur. */
		async openExternal(file) {
			if (!file || !index.get(file.path)) return false;
			const a = carte.absolu(file.path);
			if (!a) return false;
			try {
				await openPath(a);
				return true;
			} catch (e) {
				console.warn(LOG_PREFIX, "openPath a échoué:", e);
				return false;
			}
		},
		/* `revealInHost` rend TOUJOURS false : l'app n'a pas d'explorateur de
		   fichiers interne à faire défiler. Ce n'est PAS une erreur — le contrat
		   le dit, et `engine/resources.ts` enchaîne sur l'ouverture externe.
		   (plugin-opener sait révéler un fichier dans l'explorateur de WINDOWS,
		   mais ce n'est pas ce que le contrat demande : il parle de l'explorateur
		   de l'HÔTE, celui qu'on garde sous les yeux. Ouvrir une fenêtre du
		   système par-dessus l'application serait une autre action, décidée par
		   l'appelant, pas glissée ici sous le même nom.) */
		async revealInHost() {
			return false;
		},
	};

	const platform: Host["platform"] = {
		isMobile: false,
		isMacOS: false,
		/* La langue de l'INTERFACE DE L'HÔTE. Ici l'hôte est la fenêtre
		   elle-même : `navigator.language` rend la langue du système, que
		   WebView2 reprend de Windows. Accesseur et non valeur figée, par
		   symétrie avec l'hôte Obsidian ; c'est `src/i18n.ts` qui décide ce
		   qu'il en fait, pas l'hôte. */
		get uiLanguage(): string {
			return navigator.language || "en";
		},
	};

	const paths: Host["paths"] = {
		/* Le dossier des résultats dépend de la RACINE de la note : une
		   constante enverrait les résultats d'un quiz du dossier B dans le
		   dossier A. Dans un vault, on écrit là où le greffon écrit déjà ;
		   hors d'un vault, il n'y a pas de `.obsidian/` et en créer un serait
		   poser un dossier de configuration Obsidian fantôme.
		   Logique extraite dans `roots.ts` (PURE, donc éprouvable) : ce
		   fichier-ci importe MathLive et Tauri, qu'esbuild ne charge pas hors
		   de la fenêtre. */
		resultsDirFor(sourcePath) { return resultsDirForRacine(carte, sourcePath); },
		roots() { return carte.hostRoots(); },
		rootOf(path) {
			const r = carte.pour(path);
			if (!r) return null;
			return carte.hostRoots().find(h => h.id === r.id) ?? null;
		},
		localPath(path) { return carte.local(path); },
		contractPath(rootId, localPath) { return carte.contrat(rootId, localPath); },
	};

	return {
		fs: createWindowsFs(carte, index),
		links: createWindowsLinks(carte, index),
		watcher: createWindowsWatcher(carte, index),
		ui: createWindowsUi(),
		math: createWindowsMath(),
		modals: createWindowsModals(),
		shell,
		platform,
		paths,
	};
}
