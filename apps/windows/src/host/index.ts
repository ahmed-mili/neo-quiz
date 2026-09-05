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
══════════════════════════════════════════════════════════ */

import { openPath } from "@tauri-apps/plugin-opener";
import { LOG_PREFIX } from "../../../../src/branding";
import type { Host } from "../../../../src/host/types";
import { cheminAbsolu, createWindowsFs, createWindowsWatcher } from "./fs";
import type { WindowsIndex } from "./fs";
import { createWindowsLinks } from "./links";
import { createWindowsMath } from "./math";
import { createWindowsUi } from "./ui";

export { createWindowsIndex } from "./fs";
export type { WindowsIndex } from "./fs";

export function createWindowsHost(racine: string, index: WindowsIndex, estVault = false): Host {
	const shell: Host["shell"] = {
		/* `openPath` de plugin-opener : l'application par défaut du système,
		   exactement comme `app.openWithDefaultApp` sous Obsidian. Le contrat
		   rend un booléen ; l'appelant (`engine/resources.ts`) s'en sert pour
		   décider s'il doit prévenir l'utilisateur. */
		async openExternal(file) {
			if (!file || !index.get(file.path)) return false;
			try {
				await openPath(cheminAbsolu(racine, file.path));
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
		/* OÙ VONT LES RÉSULTATS — la réponse dépend du dossier, pas de l'hôte.
		   Dans un VAULT, le greffon écrit déjà dans
		   `.obsidian/quiz-blocks-results` ; l'application doit y écrire AUSSI,
		   sinon les deux hôtes tiennent chacun leur moitié de l'historique sur
		   le même corpus, et rien ne le signale — c'est exactement le défaut que
		   la spec §5 décrit pour le journal de révision.
		   Hors d'un vault il n'y a pas de `.obsidian/`, et en créer un serait
		   poser un dossier de configuration Obsidian fantôme dans un dossier
		   que l'utilisateur n'a jamais ouvert avec Obsidian. C'est aussi le
		   préfixe où la TRANCHE 2 mettra le journal — posé ici, pas migré. */
		resultsDir: estVault ? ".obsidian/quiz-blocks-results" : ".neo-quiz/results",
	};

	return {
		fs: createWindowsFs(racine, index),
		links: createWindowsLinks(racine, index),
		watcher: createWindowsWatcher(racine, index),
		ui: createWindowsUi(),
		math: createWindowsMath(),
		shell,
		platform,
		paths,
	};
}
