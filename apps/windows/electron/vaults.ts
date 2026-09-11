/* ══════════════════════════════════════════════════════════
   LES VAULTS OBSIDIAN CONNUS DE LA MACHINE

   Tâche 3 de la migration Tauri → Electron. Remplace la commande Rust
   `obsidian_vaults` (`src-tauri/src/lib.rs`), dont ce module reprend la règle :
   lire la liste qu'Obsidian tient dans `%APPDATA%/obsidian/obsidian.json`,
   écarter ce qui n'est plus un vault, trier par nom. Seul le TRI diffère —
   `localeCompare` là où Rust comparait des octets minuscules : « Éco » se
   range désormais avec « Eco » plutôt qu'après « Zoo ».

   POURQUOI CE CODE VIT DANS LE PROCESSUS PRINCIPAL, alors que Node saurait le
   lire depuis n'importe où. La raison de la commande Rust ne tient plus
   telle quelle (il n'y a plus de périmètre `plugin-fs` à étendre), mais une
   autre la remplace, et c'est la même que celle du pont tout entier : le rendu
   affiche du HTML qui n'est pas toujours celui de l'utilisateur, et il n'a
   AUCUN accès au disque. Lui donner celui du dossier de configuration
   d'Obsidian pour lire un seul fichier lui donnerait bien plus que ce qu'il
   demande.

   Une liste VIDE est un état NORMAL — Obsidian n'est pas installé, ou aucun de
   ses vaults n'existe plus. L'écran d'accueil n'affiche alors que le sélecteur
   natif.
══════════════════════════════════════════════════════════ */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { VaultConnu } from "./pont";

/** Vrai si le chemin est un DOSSIER existant. */
async function estDossier(chemin: string): Promise<boolean> {
	try {
		return (await fs.stat(chemin)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Les vaults qu'Obsidian connaît, dans l'ordre alphabétique de leur nom.
 *
 * `appData` est un paramètre pour que ce module reste éprouvable sur un
 * dossier temporaire : rien ici ne dépend d'Electron ni d'une vraie
 * installation d'Obsidian.
 */
export async function vaultsObsidian(
	appData: string | undefined = process.env.APPDATA,
): Promise<VaultConnu[]> {
	if (!appData) return [];
	let json: unknown;
	try {
		json = JSON.parse(await fs.readFile(path.join(appData, "obsidian", "obsidian.json"), "utf-8"));
	} catch {
		// Fichier absent (pas d'Obsidian) ou illisible : rien à proposer.
		return [];
	}
	const vaults = (json as { vaults?: unknown } | null)?.vaults;
	if (!vaults || typeof vaults !== "object") return [];

	const trouves: VaultConnu[] = [];
	for (const entree of Object.values(vaults as Record<string, unknown>)) {
		const chemin = (entree as { path?: unknown } | null)?.path;
		if (typeof chemin !== "string" || !chemin.trim()) continue;
		/* Le dossier doit exister ET porter un `.obsidian` : un chemin encore
		   listé après un déplacement n'est plus un vault, et le proposer mènerait
		   à une liste de quiz vide sans que rien n'explique pourquoi. */
		if (!(await estDossier(path.join(chemin, ".obsidian")))) continue;
		trouves.push({ chemin, nom: path.basename(chemin) || chemin });
	}
	trouves.sort((a, b) => a.nom.toLowerCase().localeCompare(b.nom.toLowerCase()));
	return trouves;
}
