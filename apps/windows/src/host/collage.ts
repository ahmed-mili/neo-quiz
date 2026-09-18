import type { HostCollage } from "../../../../src/host/types";
import type { Pont } from "../../electron/pont";
import { LOG_PREFIX } from "../../../../src/branding";

/**
 * `HostCollage` sur le pont : le rendu donne le jeton et attend AU PLUS un
 * texte. S'abonner AVANT de demander l'attente : un texte déjà dans le
 * presse-papier serait livré au premier tour, avant qu'un abonnement posé
 * après ne l'entende. Le rappel se désabonne lui-même à la première
 * livraison : le contrat promet « au plus une fois ».
 */
export function createWindowsCollage(pont: () => Pont): HostCollage {
	return {
		attendre(jeton, surTexte) {
			let off: (() => void) | null = pont().collage.surTexte(texte => {
				off?.(); off = null;
				surTexte(texte);
			});
			/* `false` = le jeton a été refusé côté principal (`jetonValide`) :
			   ça ne devrait jamais arriver (la page en tire dix caractères
			   conformes), donc un silence ici masquerait un vrai bug plutôt
			   qu'un cas normal. */
			void pont().collage.attendre(jeton).then(ok => {
				if (!ok) console.warn(LOG_PREFIX, "attente refusée par le principal:", jeton);
			});
			return () => {
				off?.(); off = null;
				void pont().collage.arreter();
			};
		},
	};
}
