/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — LES CLI, UN PASSE-PLAT VERS LE PRINCIPAL

   Tâche 3 de la génération IA dans l'application. `HostProcess`
   (`src/host/types.ts`) côté RENDU : ce module ne touche AUCUN fichier et ne
   lance AUCUN process — il n'en a ni le droit ni les moyens (`require`
   n'existe pas ici, `contextIsolation` et `sandbox` le retirent). Il traduit
   chaque appel en un canal du pont, et c'est le PRINCIPAL qui lit le disque
   (`apps/windows/electron/process.ts`).

   `run` REJETTE ICI, sans traverser quoi que ce soit : il n'a pas encore de
   canal (tâche 7). Le rejet est NOMMÉ (`indisponible`) parce que c'est ce que
   le contrat promet et ce que le code partagé sait traduire — un `stdout`
   vide passerait pour une génération qui a tourné pour rien, et un `invoke`
   vers un canal inexistant donnerait « No handler registered », une phrase
   qui ne désigne rien pour l'utilisateur.

   LE NOM DE L'OUTIL TRAVERSE, JAMAIS UN CHEMIN : les chemins des fichiers de
   CLI sont fixes et connus du seul principal, et `canaux.ts` refuse tout nom
   hors liste. C'est la même règle que le périmètre pour les chemins et la
   liste d'hôtes pour les URL.
══════════════════════════════════════════════════════════ */

import type { HostProcess } from "../../../../src/host/types";
import { pont } from "./pont";

export function createWindowsProcess(): HostProcess {
	return {
		async run(spec) {
			const e = new Error("lancer un CLI n'est pas encore implémenté dans l'application : " + spec.tool);
			e.name = "indisponible";
			throw e;
		},
		/* Le NOM, et rien d'autre. Un rejet du principal (outil hors liste)
		   remonte tel quel : l'appelant (`ai-providers.ts`) le rattrape et
		   retombe sur son repli embarqué. */
		lireCache(tool) {
			return pont().processus.lireCache(tool);
		},
		ollamaInstalle() {
			return pont().processus.ollamaInstalle();
		},
		demarrerOllama() {
			return pont().processus.demarrerOllama();
		},
	};
}
