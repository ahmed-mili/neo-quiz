import type { PaquetInstallable } from "./noyau";

/* ══════════════════════════════════════════════════════════
   CONTRAT DU BOOTSTRAPPER

   Même raison que `electron/pont.ts` : la fenêtre ne reçoit jamais
   `ipcRenderer` brut. Elle ne connaît que ces opérations, et le travailleur
   élevé n'échange que ces messages JSON sérialisables. Aucun type ici ne
   dépend de Node ni d'Electron pour que le rendu puisse l'importer sans ouvrir
   une porte vers le système.
══════════════════════════════════════════════════════════ */

export const CANAUX_INSTALLATEUR = {
	initialiser: "neo-installer:initialiser",
	choisirDossier: "neo-installer:choisir-dossier",
	espaceDisque: "neo-installer:espace-disque",
	installer: "neo-installer:installer",
	annuler: "neo-installer:annuler",
	reduire: "neo-installer:reduire",
	commentaires: "neo-installer:commentaires",
	fermer: "neo-installer:fermer",
	etat: "neo-installer:etat",
} as const;

export type CodeErreurInstallateur =
	| "release"
	| "network"
	| "elevation"
	| "integrity"
	| "installation"
	| "launch"
	| "generic";

export interface InfosInitialesInstallateur {
	version: string;
	tailleTelechargement: number;
	dossier: string;
	espaceDisponible: number;
}

export interface ChoixDossierInstallateur {
	dossier: string;
	espaceDisponible: number;
}

export interface InfosDisqueInstallateur {
	espaceDisponible: number;
	espaceTotal: number;
}

export type EtatInstallateur =
	| { phase: "pret" }
	| { phase: "elevation" }
	| { phase: "telechargement"; recus: number; total: number }
	| { phase: "verification" }
	| { phase: "installation" }
	| { phase: "annule" }
	| { phase: "erreur"; code: CodeErreurInstallateur };

export interface PontInstallateur {
	initialiser(): Promise<InfosInitialesInstallateur>;
	choisirDossier(courant: string): Promise<ChoixDossierInstallateur | null>;
	espaceDisque(dossier: string): Promise<InfosDisqueInstallateur>;
	installer(dossier: string): Promise<void>;
	annuler(): Promise<void>;
	reduire(): void;
	commentaires(): void;
	fermer(): void;
	surEtat(rappel: (etat: EtatInstallateur) => void): void;
}

export interface ChargeTravailleur {
	secret: string;
	dossier: string;
	paquet: PaquetInstallable;
}

export type MessageTravailleur =
	| { type: "auth"; secret: string }
	| { type: "telechargement"; recus: number; total: number }
	| { type: "verification" }
	| { type: "installation" }
	| { type: "termine"; executable: string }
	| { type: "annule" }
	| { type: "erreur"; code: CodeErreurInstallateur };

export type CommandeTravailleur = { type: "annuler" };

declare global {
	interface Window {
		readonly neoInstaller: PontInstallateur;
	}
}
