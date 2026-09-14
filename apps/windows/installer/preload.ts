/* Le préchargement n'expose que le contrat nommé du bootstrapper. Le rendu ne
   reçoit ni `ipcRenderer`, ni Electron, ni Node : une future injection HTML
   dans la fenêtre d'installation ne devient donc pas une primitive système. */
import { contextBridge, ipcRenderer } from "electron";
import {
	CANAUX_INSTALLATEUR,
	type ChoixDossierInstallateur,
	type EtatInstallateur,
	type InfosInitialesInstallateur,
	type PontInstallateur,
} from "./protocole";

const pont: PontInstallateur = {
	initialiser: () => ipcRenderer.invoke(CANAUX_INSTALLATEUR.initialiser) as Promise<InfosInitialesInstallateur>,
	choisirDossier: (courant: string) =>
		ipcRenderer.invoke(CANAUX_INSTALLATEUR.choisirDossier, courant) as Promise<ChoixDossierInstallateur | null>,
	installer: (dossier: string) => ipcRenderer.invoke(CANAUX_INSTALLATEUR.installer, dossier) as Promise<void>,
	annuler: () => ipcRenderer.invoke(CANAUX_INSTALLATEUR.annuler) as Promise<void>,
	fermer: () => ipcRenderer.send(CANAUX_INSTALLATEUR.fermer),
	surEtat(rappel: (etat: EtatInstallateur) => void) {
		ipcRenderer.on(CANAUX_INSTALLATEUR.etat, (_event, etat: EtatInstallateur) => rappel(etat));
	},
};

contextBridge.exposeInMainWorld("neoInstaller", pont);
