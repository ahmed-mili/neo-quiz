/* ══════════════════════════════════════════════════════════
   L'ÉTAT DE LA MISE À JOUR — un noyau PUR

   electron-updater parle par événements (`checking-for-update`,
   `update-available`, `download-progress`, `update-downloaded`,
   `update-not-available`, `error`). Le rendu, lui, veut UN objet à afficher :
   une phase, une version, un pourcentage. Cette traduction est la seule
   logique du mécanisme, et elle vit ici, sans Electron ni réseau, pour être
   éprouvée par `npm run check:updater` — la même règle que `garde-ia.ts`.

   Deux décisions qui ne se voient pas dans les types :
   - une ERREUR après « prête » ne retire pas la mise à jour déjà
     téléchargée : le paquet est sur le disque, vérifié, et un échec de
     re-vérification réseau n'y change rien ;
   - couper le réglage OUBLIE une vérification ou un téléchargement en
     cours, mais garde « prête » : le fichier est là, l'utilisateur peut
     encore vouloir cliquer.
══════════════════════════════════════════════════════════ */

export type PhaseMiseAJour = "inactif" | "verification" | "a-jour" | "telechargement" | "prete" | "erreur";

export interface EtatMiseAJour {
	phase: PhaseMiseAJour;
	version?: string;
	pourcent?: number;
	message?: string;
	auto: boolean;
}

export type EvenementMiseAJour =
	| { type: "checking-for-update" }
	| { type: "update-available"; version: string }
	| { type: "update-not-available" }
	| { type: "download-progress"; percent: number }
	| { type: "update-downloaded"; version: string }
	| { type: "error"; message: string }
	| { type: "reglage"; auto: boolean };

export const ETAT_INITIAL: EtatMiseAJour = { phase: "inactif", auto: true };

export function transition(etat: EtatMiseAJour, ev: EvenementMiseAJour): EtatMiseAJour {
	switch (ev.type) {
		case "checking-for-update":
			return { phase: "verification", auto: etat.auto };
		case "update-available":
			return { phase: "telechargement", version: ev.version, pourcent: 0, auto: etat.auto };
		case "download-progress":
			return { ...etat, pourcent: Math.max(0, Math.min(100, Math.round(ev.percent))) };
		case "update-downloaded":
			return { phase: "prete", version: ev.version, auto: etat.auto };
		case "update-not-available":
			return { phase: "a-jour", auto: etat.auto };
		case "error":
			if (etat.phase === "prete") return etat;
			return { phase: "erreur", message: ev.message, auto: etat.auto };
		case "reglage":
			if (etat.phase === "prete") return { ...etat, auto: ev.auto };
			return ev.auto ? { ...etat, auto: true } : { phase: "inactif", auto: false };
	}
}
