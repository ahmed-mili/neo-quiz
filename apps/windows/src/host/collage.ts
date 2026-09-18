import type { HostCollage } from "../../../../src/host/types";
import type { Pont } from "../../electron/pont";

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
			void pont().collage.attendre(jeton);
			return () => {
				off?.(); off = null;
				void pont().collage.arreter();
			};
		},
	};
}
