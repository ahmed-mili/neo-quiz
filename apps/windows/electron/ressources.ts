/* ══════════════════════════════════════════════════════════
   LES RESSOURCES — L'URL D'UNE IMAGE, ET LE CHEMIN QU'ELLE DÉSIGNE

   Tâche 4 de la migration Tauri → Electron
   (docs/superpowers/plans/2026-09-11-migration-electron.md). Sous Tauri,
   `convertFileSrc` fabriquait pour `HostLinks.resourceUrl` une URL que la
   WebView servait elle-même (`http://asset.localhost/<chemin>`), bornée par la
   portée du protocole d'asset. Electron n'a pas d'équivalent : le processus
   principal enregistre un protocole (`protocol.handle`, `main.ts`) et c'est CE
   module qui dit, des deux côtés, à quoi ressemble l'URL et ce qu'elle désigne.

   Il vit dans `electron/` mais n'importe NI Node NI Electron, comme
   `catalogue.ts` : le rendu (`apps/windows/src/host/links.ts`) fabrique l'URL,
   le principal la lit, et une règle recopiée de part et d'autre aurait
   divergé — deux copies d'une même règle l'ont déjà fait une fois dans ce
   dépôt. `Perimetre` n'est importé qu'en TYPE : `perimetre.ts` tire
   `node:fs`, qui n'a rien à faire dans le paquet du rendu.

   LE SCHÉMA EST `app:`, ET CE N'EST PAS UN CHOIX LIBRE. La liste blanche du
   sanitizer (`src/engine/sanitizer.ts`, `isSafeQuizUrl`) n'admet pour un
   `src` d'image que `https?:`, `app:`, `file:`, `blob:` et `data:image/` — et
   `src/` ne bouge pas à cette tranche. Un schéma inventé (« neo-res: »)
   aurait fait RETIRER par le sanitizer chaque image d'option
   (`src/engine/cards.ts` résout puis assainit), sans erreur : des quiz sans
   images. `app:` est le schéma qu'Obsidian donne à ses propres ressources, et
   c'est exactement ce qu'il désigne ici aussi : « une ressource servie par
   l'application ». `file:` aurait passé la liste blanche aussi, mais une page
   chargée en `http://localhost` (le serveur de développement) n'a pas le droit
   de charger `file://`, et rien ne l'aurait borné.

   L'URL PORTE LE CHEMIN ABSOLU, et le principal le BORNE. Le pont ne parle
   que de chemins absolus (voir l'en-tête de `pont.ts`) : les chemins du
   contrat sont les clés du journal de révision et ne franchissent pas l'IPC,
   et la convention interne de l'index (« 0/Cours/ch1.md ») ne la franchit pas
   non plus — `absoluDepuisContrat` (`index-fichiers.ts`) ne comprend QUE
   cette convention, jamais « Efrei/Cours/ch1.md ». Une URL qui porterait un
   indice de racine dépendrait en plus de l'ORDRE que `demarrer` a retenu
   après filtrage : une racine refusée décalerait tous les indices suivants
   et ferait servir l'image d'un autre dossier. Le chemin absolu n'a pas ce
   problème, et il passe par `perimetre.borner` exactement comme chaque canal
   `fichiers.*` : MÊME liste blanche, jamais une seconde (Ruling 13 — c'est la
   porte que la tâche 3 a mis deux rondes à fermer).
══════════════════════════════════════════════════════════ */

import type { Perimetre } from "./perimetre";

/** Le schéma — voir l'en-tête pour pourquoi ce n'est pas un nom inventé. */
export const SCHEMA_RESSOURCES = "app";
/** L'hôte de l'URL : ce qui distingue nos ressources de tout autre `app://`. */
export const HOTE_RESSOURCES = "neo-res";

/**
 * L'URL affichable d'un fichier du disque (chemin ABSOLU, séparateurs `/`).
 *
 * Chaque segment est encodé (espaces, `#`, `?`, accents), SAUF le `:` du
 * lecteur : `D%3A` serait valide mais illisible dans un `src`, et c'est une
 * URL qu'on relit dans l'inspecteur quand une image ne s'affiche pas.
 */
export function urlDeRessource(absolu: string): string {
	const segments = String(absolu ?? "").replace(/\\/g, "/").split("/")
		.map(s => encodeURIComponent(s).replace(/%3A/gi, ":"));
	return `${SCHEMA_RESSOURCES}://${HOTE_RESSOURCES}/${segments.join("/")}`;
}

/**
 * Le chemin absolu qu'une URL de ressource désigne, AVANT tout bornage — ou
 * `null` si ce n'est pas une URL de ce protocole (autre schéma, autre hôte,
 * URL illisible). `null` n'est pas une erreur : le gestionnaire répond 404.
 */
export function cheminDeRessource(url: string): string | null {
	let u: URL;
	try {
		u = new URL(String(url ?? ""));
	} catch {
		return null;
	}
	if (u.protocol !== `${SCHEMA_RESSOURCES}:` || u.host !== HOTE_RESSOURCES) return null;
	let chemin: string;
	try {
		chemin = decodeURIComponent(u.pathname);
	} catch {
		return null; // un `%` orphelin : pas un chemin.
	}
	chemin = chemin.replace(/^\/+/, "");
	return chemin || null;
}

/**
 * Le chemin que le protocole a le droit de servir pour cette URL, ou `null`
 * s'il doit REFUSER : URL étrangère au protocole, ou chemin hors du périmètre.
 *
 * C'est la fonction que le gestionnaire de `main.ts` appelle, et elle est ici
 * plutôt que là-bas pour être ÉPROUVÉE sur le module réel
 * (`scripts/check-electron-reglages.mjs`) — `main.ts` importe Electron, aucun
 * script de contrôle ne peut le charger. Le bornage est celui de `borner`,
 * qui replie `..`, suit les jonctions et compare au chemin RÉSOLU : une URL
 * qui encoderait `%2E%2E` pour sortir d'une racine arrive ici décodée, puis
 * repliée, puis refusée.
 */
export async function resoudreRessource(perimetre: Perimetre, url: string): Promise<string | null> {
	const chemin = cheminDeRessource(url);
	if (!chemin) return null;
	try {
		return await perimetre.borner(chemin);
	} catch {
		return null;
	}
}
