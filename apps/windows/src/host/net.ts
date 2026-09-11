/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — LE RÉSEAU, UN PASSE-PLAT VERS LE PRINCIPAL

   Tâche 2 de la génération IA dans l'application. `HostNet`
   (`src/host/types.ts`) côté RENDU : ce module ne fait aucune requête
   lui-même — il n'en a pas le droit, et il n'en a pas les moyens (un `fetch`
   vers `localhost:11434` est refusé par la politique d'origine de Chromium).
   Il traduit l'appel en un canal du pont, `reseau.fetch`, et c'est le
   PRINCIPAL qui juge l'hôte et fait la requête (`apps/windows/electron/
   reseau.ts`).

   LA SEULE CHOSE QUI EST À NOUS ICI, c'est l'ANNULATION. Un `AbortSignal` ne
   traverse pas l'IPC (il ne se clone pas) : chaque requête reçoit un
   identifiant, et l'abandon du signal est relayé par `reseau.annuler(id)`.
   L'identifiant est un compteur de ce module — il n'a besoin d'être unique
   que pendant la vie de la page, et le principal retire l'entrée dès que la
   requête finit (`canaux.ts`).
══════════════════════════════════════════════════════════ */

import type { HostNet } from "../../../../src/host/types";
import { pont } from "./pont";

/** Le prochain identifiant de requête. Un compteur et non un aléa : deux
    requêtes en vol ne peuvent pas se confondre, et un identifiant réutilisé
    après la fin d'une requête ne désigne plus rien côté principal. */
let prochainId = 1;

export function createWindowsNet(): HostNet {
	return {
		async fetchJson(req) {
			const id = prochainId++;
			/* `signal` RETIRÉ de ce qui traverse : le clonage structuré de l'IPC
			   rejetterait un `AbortSignal`, et `invoke` échouerait avant même que
			   le principal ne voie la requête. Le reste est recopié champ par
			   champ — `RequeteReseau` (`pont.ts`) dit exactement ce qui passe. */
			const { signal, url, method, headers, body } = req;
			/* Déjà annulé avant l'envoi : rien à demander. Le contrat rend `null`
			   pour une annulation, et le principal n'a pas à voir passer une
			   requête que personne n'attend plus. */
			if (signal?.aborted) return null;
			const relayer = (): void => {
				void pont().reseau.annuler(id);
			};
			signal?.addEventListener("abort", relayer, { once: true });
			try {
				return await pont().reseau.fetch({ url, method, headers, body }, id);
			} finally {
				signal?.removeEventListener("abort", relayer);
			}
		},
	};
}
