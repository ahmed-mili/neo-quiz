/**
 * L'ATTENTE D'UNE RÉPONSE COPIÉE — le noyau PUR de la veille du presse-papier
 * pendant une génération par un site (spec 2026-09-18, §4).
 *
 * Aucun `electron`, aucun `setTimeout` : le presse-papier (`lire`) et le temps
 * (`horloge`) sont des ENTRÉES, pour que `check:electron-collage` éprouve ce
 * qui ne doit jamais fuir. La règle qui rend cette lecture acceptable : un
 * texte n'est LIVRÉ que s'il porte le jeton de l'attente en cours ; tout le
 * reste est comparé puis oublié, sans journal. Le câblage réel (clipboard,
 * timers, webContents.send, flashFrame) est dans canaux.ts.
 */

/** Cadence de la sonde. Un demi-seconde : le geste « Copier » sur le site
    précède de bien plus le retour de l'utilisateur. */
export const CADENCE_MS = 500;
/** Au-delà, l'attente s'arrête d'elle-même : personne ne doit laisser une
    sonde tourner sans que quelqu'un attende vraiment. */
export const ECHEANCE_MS = 30 * 60 * 1000;

/** Au moins huit caractères de [a-z0-9] : un jeton vide ou court ferait
    reconnaître n'importe quel texte. La page en tire dix. */
export function jetonValide(jeton: unknown): jeton is string {
	return typeof jeton === "string" && /^[a-z0-9]{8,}$/.test(jeton);
}

export interface Horloge {
	planifier(fn: () => void, ms: number): number;
	annuler(id: number): void;
	maintenant(): number;
}

export interface Attente {
	/** `false` si le jeton est refusé. Remplace une attente en cours. */
	demarrer(jeton: string): boolean;
	arreter(): void;
	enCours(): boolean;
}

export function creerAttente(deps: { lire(): string; horloge: Horloge; livrer(texte: string): void }): Attente {
	let jeton: string | null = null;
	let debut = 0;
	let sonde: number | null = null;

	function arreter(): void {
		if (sonde !== null) { deps.horloge.annuler(sonde); sonde = null; }
		jeton = null;
	}

	function tour(): void {
		sonde = null;
		if (jeton === null) return;
		if (deps.horloge.maintenant() - debut >= ECHEANCE_MS) { arreter(); return; }
		let texte: string;
		try { texte = deps.lire(); } catch {
			/* Le presse-papier peut être indisponible sur certaines plates-formes.
			   L'exception ne tue pas l'attente : la sonde réessaie au tour suivant. */
			sonde = deps.horloge.planifier(tour, CADENCE_MS);
			return;
		}
		if (texte.includes(jeton)) {
			/* Arrêter AVANT de livrer : si `livrer` relance une attente, elle ne
			   doit pas être écrasée par l'arrêt de celle-ci. */
			arreter();
			deps.livrer(texte);
			return;
		}
		sonde = deps.horloge.planifier(tour, CADENCE_MS);
	}

	return {
		demarrer(j: string): boolean {
			if (!jetonValide(j)) return false;
			arreter();
			jeton = j;
			debut = deps.horloge.maintenant();
			sonde = deps.horloge.planifier(tour, CADENCE_MS);
			return true;
		},
		arreter,
		enCours: () => jeton !== null,
	};
}
