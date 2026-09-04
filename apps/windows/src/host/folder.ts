/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — LE DOSSIER DE QUIZ

   Choisir un dossier, s'en souvenir d'une session à l'autre, et rouvrir les
   portées natives qui le rendent lisible. C'est la seule partie de l'hôte qui
   parle au natif autrement que par un greffon.
══════════════════════════════════════════════════════════ */

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import type { Store } from "@tauri-apps/plugin-store";
import { LOG_PREFIX } from "../../../../src/branding";

/** Fichier des réglages de l'application, dans son dossier de données. */
const FICHIER_REGLAGES = "settings.json";

/**
 * La clé est au SINGULIER, et c'est délibéré.
 *
 * La spec §6 prévoit jusqu'à dix dossiers, mais c'est la TRANCHE 2. Écrire dès
 * maintenant un tableau que personne ne remplit obligerait à en lire un partout
 * — et à traiter le cas « plusieurs racines » dans l'index, les liens et les
 * chemins du journal, sans qu'aucun de ces chemins ne soit jamais parcouru.
 * Un seul dossier, une seule clé ; la migration se fera quand elle servira.
 */
const CLE_DOSSIER = "folder";

let magasin: Store | null = null;

async function reglages(): Promise<Store> {
	if (!magasin) magasin = await load(FICHIER_REGLAGES);
	return magasin;
}

/** Ouvre le sélecteur natif. `null` si l'utilisateur annule — ce n'est pas une
    erreur, c'est la réponse « non ». */
export async function pickFolder(): Promise<string | null> {
	const choix = await open({ directory: true, multiple: false });
	return typeof choix === "string" && choix.trim() ? choix : null;
}

/** Le dossier retenu de la session précédente, ou `null` au premier lancement. */
export async function savedFolder(): Promise<string | null> {
	try {
		const valeur = await (await reglages()).get<string>(CLE_DOSSIER);
		return typeof valeur === "string" && valeur.trim() ? valeur : null;
	} catch (e) {
		// Réglages illisibles (fichier corrompu, première écriture interrompue) :
		// on repart de l'écran de choix plutôt que d'empêcher le démarrage.
		console.warn(LOG_PREFIX, "réglages illisibles:", e);
		return null;
	}
}

export async function saveFolder(chemin: string): Promise<void> {
	const store = await reglages();
	await store.set(CLE_DOSSIER, chemin);
	// `save()` explicite : l'enregistrement automatique est débouncé, et
	// l'application recharge la fenêtre juste après ce choix.
	await store.save();
}

/**
 * Ouvre les portées natives sur le dossier.
 *
 * À appeler AVANT toute lecture, y compris au redémarrage sur un dossier déjà
 * persisté : les portées vivent en mémoire et ne survivent pas à la fermeture.
 * La commande Rust en ouvre DEUX (fichiers et protocole d'asset) — la raison
 * est écrite au-dessus d'elle, dans `src-tauri/src/lib.rs`.
 */
export async function allowFolder(chemin: string): Promise<void> {
	await invoke("allow_folder", { chemin });
}
