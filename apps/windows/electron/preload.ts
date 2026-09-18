/* ══════════════════════════════════════════════════════════
   LE PRÉCHARGEMENT — LA SEULE CHOSE QUE LA FENÊTRE VOIT

   Tâche 3 de la migration Tauri → Electron. Ce fichier tourne dans le contexte
   ISOLÉ du préchargement : il a `require("electron")`, la fenêtre ne l'a pas.
   Il pose `window.neo` et RIEN D'AUTRE.

   CE QU'IL N'EXPOSE JAMAIS : `ipcRenderer`. Un `contextBridge.exposeInMainWorld
   ("ipc", ipcRenderer)` est la faute qui annule toute l'isolation qu'on vient
   de payer — le rendu pourrait alors appeler n'importe quel canal, y compris
   ceux qu'Electron enregistre pour lui-même, et `invoke` accepterait n'importe
   quel nom. La fenêtre rend du HTML qui n'est pas toujours celui de
   l'utilisateur (un quiz PARTAGÉ porte les `explainHtml` de son auteur) : la
   surface exposée est exactement la liste de `Pont`, méthode par méthode.

   `sandbox: true` oblige ce fichier à être du CommonJS : un préchargement
   sandboxé ne sait pas charger de module ES. C'est `construire.mjs` qui le
   produit sous cette forme, et c'est la raison pour laquelle le processus
   principal n'est pas compilé par `tsc` — voir l'en-tête de ce script.
══════════════════════════════════════════════════════════ */

import { contextBridge, ipcRenderer } from "electron";
import { CANAUX } from "./pont";
import type { EtatFenetre, EtatMiseAJour, EvenementDisque, Pont } from "./pont";

/* Les rappels de fermeture, et l'écouteur UNIQUE qui les sert. Un écouteur par
   appel à `surFermeture` répondrait autant de fois au principal, qui détruirait
   la fenêtre à la PREMIÈRE réponse — donc avant que les autres rappels aient
   fini d'écrire. */
const rappelsFermeture: Array<() => Promise<void>> = [];
let ecouteurFermeturePose = false;

function poserEcouteurFermeture(): void {
	if (ecouteurFermeturePose) return;
	ecouteurFermeturePose = true;
	ipcRenderer.on(CANAUX.fermeture, () => {
		void (async () => {
			/* TOUS les rappels, et une seule réponse à la fin. Un rappel qui
			   rejette ne doit pas retenir la fenêtre ouverte : on le laisse
			   tomber ici, le principal a de toute façon son délai de garde. */
			await Promise.allSettled(rappelsFermeture.map(r => r()));
			await ipcRenderer.invoke(CANAUX.fermetureTerminee);
		})();
	});
}

const pont: Pont = {
	async demarrer(racines) {
		await ipcRenderer.invoke(CANAUX.demarrer, racines);
	},

	fichiers: {
		read: abs => ipcRenderer.invoke(CANAUX.read, abs),
		readCached: abs => ipcRenderer.invoke(CANAUX.readCached, abs),
		write: (abs, contenu) => ipcRenderer.invoke(CANAUX.write, abs, contenu),
		lirePourEcriture: abs => ipcRenderer.invoke(CANAUX.lirePourEcriture, abs),
		ecrireSiInchange: (abs, lu, contenu) =>
			ipcRenderer.invoke(CANAUX.ecrireSiInchange, abs, lu, contenu),
		/* RECOPIÉE (`new Uint8Array(data)`) avant l'envoi : la conservation
		   d'une VUE PARTIELLE au passage du `contextBridge` n'est pas
		   documentée, et une vue qui redeviendrait tout son tampon écrirait
		   l'image collée avec tout ce qui l'entoure en mémoire. La copie coûte
		   la taille de l'image, une fois ; elle rend la question sans objet. */
		writeBinary: (abs, data) => ipcRenderer.invoke(CANAUX.writeBinary, abs, new Uint8Array(data)),
		append: (abs, contenu) => ipcRenderer.invoke(CANAUX.append, abs, contenu),
		exists: abs => ipcRenderer.invoke(CANAUX.exists, abs),
		mkdirs: abs => ipcRenderer.invoke(CANAUX.mkdirs, abs),
		trash: (abs, racine) => ipcRenderer.invoke(CANAUX.trash, abs, racine),
		list: dossier => ipcRenderer.invoke(CANAUX.list, dossier),
		remove: abs => ipcRenderer.invoke(CANAUX.remove, abs),
		rename: (de, vers) => ipcRenderer.invoke(CANAUX.rename, de, vers),
		stat: abs => ipcRenderer.invoke(CANAUX.stat, abs),
		statEntree: abs => ipcRenderer.invoke(CANAUX.statEntree, abs),
		listerDossier: dossier => ipcRenderer.invoke(CANAUX.listerDossier, dossier),
		readBinary: abs => ipcRenderer.invoke(CANAUX.readBinary, abs),
		liste: racine => ipcRenderer.invoke(CANAUX.liste, racine),
	},

	async surveiller(onEvenement) {
		/* DEMANDER LA SURVEILLANCE D'ABORD, s'abonner ensuite : `invoke` est
		   attendu, donc au retour le principal a bien monté son surveillant. */
		await ipcRenderer.invoke(CANAUX.surveiller);
		const ecouteur = (_e: unknown, ev: EvenementDisque): void => onEvenement(ev);
		ipcRenderer.on(CANAUX.evenement, ecouteur);
		/* Le désabonnement retire l'ÉCOUTEUR, il n'arrête pas le surveillant du
		   principal : celui-ci tient l'index d'autorité, et l'arrêter le
		   laisserait périmé pour le prochain abonné. */
		return () => {
			ipcRenderer.off(CANAUX.evenement, ecouteur);
		};
	},

	dialogue: {
		choisirDossier: () => ipcRenderer.invoke(CANAUX.choisirDossier),
	},

	reglages: {
		lire: cle => ipcRenderer.invoke(CANAUX.reglagesLire, cle),
		ecrire: (cle, valeur) => ipcRenderer.invoke(CANAUX.reglagesEcrire, cle, valeur),
		supprimer: cle => ipcRenderer.invoke(CANAUX.reglagesSupprimer, cle),
	},

	systeme: {
		ouvrir: abs => ipcRenderer.invoke(CANAUX.ouvrir, abs),
		copierTexte: texte => ipcRenderer.invoke(CANAUX.systemeCopierTexte, texte),
		vaultsObsidian: () => ipcRenderer.invoke(CANAUX.vaultsObsidian),
		dossierDefaut: () => ipcRenderer.invoke(CANAUX.systemeDossierDefaut),
		relancer: () => ipcRenderer.invoke(CANAUX.systemeRelancer),
		choisirDossierDefaut: () => ipcRenderer.invoke(CANAUX.systemeChoisirDossierDefaut),
		choisirFichiers: kind => ipcRenderer.invoke(CANAUX.systemeChoisirFichiers, kind),
	},

	reseau: {
		fetch: (req, requeteId) => ipcRenderer.invoke(CANAUX.reseauFetch, req, requeteId),
		annuler: requeteId => ipcRenderer.invoke(CANAUX.reseauAnnuler, requeteId),
	},

	processus: {
		run: (spec, requeteId) => ipcRenderer.invoke(CANAUX.processusRun, spec, requeteId),
		annuler: requeteId => ipcRenderer.invoke(CANAUX.processusAnnuler, requeteId),
		lireCache: tool => ipcRenderer.invoke(CANAUX.processusLireCache, tool),
		ollamaInstalle: () => ipcRenderer.invoke(CANAUX.processusOllamaInstalle),
		demarrerOllama: () => ipcRenderer.invoke(CANAUX.processusDemarrerOllama),
		installer: tool => ipcRenderer.invoke(CANAUX.processusInstaller, tool),
		connecter: tool => ipcRenderer.invoke(CANAUX.processusConnecter, tool),
	},

	fenetre: {
		prete: () => ipcRenderer.invoke(CANAUX.fenetrePrete),
		async surFermeture(rappel) {
			rappelsFermeture.push(rappel);
			poserEcouteurFermeture();
			// ARMER, et l'attendre : une fermeture survenue avant que le principal
			// ne sache qu'un rappel existe n'attendrait rien.
			await ipcRenderer.invoke(CANAUX.armerFermeture);
		},
		reduire: () => ipcRenderer.invoke(CANAUX.fenetreReduire),
		agrandirOuRestaurer: () => ipcRenderer.invoke(CANAUX.fenetreAgrandir),
		fermer: () => ipcRenderer.invoke(CANAUX.fenetreFermer),
		pleinEcran: () => ipcRenderer.invoke(CANAUX.fenetrePleinEcran),
		etat: () => ipcRenderer.invoke(CANAUX.fenetreEtatLire),
		surEtat(rappel) {
			const ecouteur = (_e: unknown, etat: EtatFenetre): void => rappel(etat);
			ipcRenderer.on(CANAUX.fenetreEtat, ecouteur);
			return () => { ipcRenderer.off(CANAUX.fenetreEtat, ecouteur); };
		},
	},

	edition: {
		commande: nom => ipcRenderer.invoke(CANAUX.editionCommande, nom),
	},

	affichage: {
		zoom: facteur => ipcRenderer.invoke(CANAUX.affichageZoom, facteur),
		recharger: () => ipcRenderer.invoke(CANAUX.affichageRecharger),
		outilsDev: () => ipcRenderer.invoke(CANAUX.affichageOutilsDev),
	},

	miseAJour: {
		etat: () => ipcRenderer.invoke(CANAUX.miseAJourEtatLire),
		surEtat(rappel) {
			const ecouteur = (_e: unknown, etat: EtatMiseAJour): void => rappel(etat);
			ipcRenderer.on(CANAUX.miseAJourEtat, ecouteur);
			return () => { ipcRenderer.off(CANAUX.miseAJourEtat, ecouteur); };
		},
		verifier: () => ipcRenderer.invoke(CANAUX.miseAJourVerifier),
		installer: () => ipcRenderer.invoke(CANAUX.miseAJourInstaller),
	},
};

contextBridge.exposeInMainWorld("neo", pont);
