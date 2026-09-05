/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — LE DOSSIER DE QUIZ

   Choisir un dossier, s'en souvenir d'une session à l'autre, et rouvrir les
   portées natives qui le rendent lisible. C'est la seule partie de l'hôte qui
   parle au natif autrement que par un greffon.
══════════════════════════════════════════════════════════ */

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { load } from "@tauri-apps/plugin-store";
import type { Store } from "@tauri-apps/plugin-store";
import { LOG_PREFIX } from "../../../../src/branding";

/** Fichier des réglages de l'application, dans son dossier de données. */
const FICHIER_REGLAGES = "settings.json";

/** Un dossier de quiz retenu par l'application. */
export interface DossierQuiz {
	/**
	 * Identifiant, et PREMIER SEGMENT des chemins du contrat qui en relèvent
	 * (« Efrei/Cours/reseau.md »). PERSISTÉ, et jamais recalculé : un
	 * identifiant qui changerait le jour où un dossier homonyme arrive
	 * changerait avec lui tous les chemins affichés.
	 *
	 * C'est le NOM du dossier, pas un jeton opaque (« f1 ») : ces chemins
	 * sont montrés à l'écran, et « Efrei/Cours/reseau.md » se lit là où
	 * « f1/Cours/reseau.md » demanderait une table de traduction — donc un
	 * second endroit où le préfixe serait connu.
	 */
	id: string;
	/** Chemin ABSOLU sur le disque. La seule valeur qui ne soit pas du
	    contrat : elle ne sort jamais de l'hôte. */
	path: string;
	/** Nom affiché. Modifiable un jour sans conséquence — l'identité, c'est
	    `id`. */
	name: string;
}

/** La limite de la spec §6. Dix dossiers, pas onze. */
export const MAX_DOSSIERS = 10;

const CLE_DOSSIERS = "folders";
/** L'ancienne clé, au SINGULIER (tranche 1). Lue une fois, puis retirée. */
const CLE_DOSSIER_LEGACY = "folder";

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

/** Le dernier segment d'un chemin, quel que soit le séparateur. */
export function nomDeDossier(chemin: string): string {
	return String(chemin ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(chemin ?? "");
}

/**
 * Un nom réduit à ce qui peut tenir dans UN segment de chemin.
 *
 * Les caractères interdits par Windows (`\ / : * ? " < > |`) deviennent des
 * tirets — pas parce que l'identifiant touche le disque (il ne le touche
 * jamais : c'est un préfixe de chemin du CONTRAT), mais parce qu'un `/` dans
 * l'identifiant en ferait DEUX segments, et le premier ne désignerait plus
 * aucune racine.
 */
export function segmentValide(nom: string): string {
	const nu = String(nom ?? "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
	return nu || "dossier";
}

/** Un identifiant libre. Le suffixe est numérique et croissant : deux
    dossiers nommés « Cours » donnent « Cours » et « Cours-2 ». */
export function idUnique(nom: string, pris: ReadonlySet<string>): string {
	const base = segmentValide(nom);
	if (!pris.has(base)) return base;
	let n = 2;
	while (pris.has(`${base}-${n}`)) n++;
	return `${base}-${n}`;
}

/**
 * Les dossiers retenus, à partir de ce que le magasin contient — y compris
 * l'ANCIENNE clé au singulier.
 *
 * PURE, et c'est délibéré : la conversion d'un réglage est exactement le
 * genre de code qu'on n'ose plus toucher parce qu'on ne peut pas l'exécuter.
 * Ici, `npm run check:folders` l'exécute.
 */
export function lireDossiers(brut: { folders?: unknown; folder?: unknown }): DossierQuiz[] {
	const pris = new Set<string>();
	const out: DossierQuiz[] = [];

	if (Array.isArray(brut.folders)) {
		for (const e of brut.folders) {
			const o = e as Partial<DossierQuiz> | null;
			const path = typeof o?.path === "string" ? o.path.trim() : "";
			if (!path) continue;
			const name = typeof o?.name === "string" && o.name.trim() ? o.name.trim() : nomDeDossier(path);
			/* L'identifiant persisté est reconduit tel quel — sauf collision,
			   qu'un fichier de réglages édité à la main peut produire. Le
			   recalculer systématiquement changerait les chemins affichés à
			   chaque renommage de dossier. */
			const voulu = typeof o?.id === "string" && o.id.trim() ? segmentValide(o.id) : segmentValide(name);
			const id = idUnique(voulu, pris);
			pris.add(id);
			out.push({ id, path, name });
			if (out.length >= MAX_DOSSIERS) break;
		}
		return out;
	}

	/* MIGRATION de la clé au singulier (tranche 1). Un seul sens, exécuté une
	   fois : `savedFolders` réécrit aussitôt sous la nouvelle clé et retire
	   l'ancienne. Sans elle, la mise à jour de l'application ferait repartir
	   l'utilisateur sur l'écran « Choisissez un dossier », son dossier
	   toujours là mais oublié. */
	if (typeof brut.folder === "string" && brut.folder.trim()) {
		const path = brut.folder.trim();
		const name = nomDeDossier(path);
		return [{ id: segmentValide(name), path, name }];
	}
	return [];
}

/**
 * Les dossiers retenus de la session précédente, ou `[]` au premier
 * lancement.
 */
export async function savedFolders(): Promise<DossierQuiz[]> {
	try {
		const store = await reglages();
		const liste = lireDossiers({
			folders: await store.get(CLE_DOSSIERS),
			folder: await store.get(CLE_DOSSIER_LEGACY),
		});
		/* La conversion se paie UNE fois : dès qu'on a lu l'ancienne clé, on
		   écrit la nouvelle et on retire l'ancienne. Laisser les deux en place
		   ferait diverger le jour où l'une des deux serait modifiée. */
		if ((await store.get(CLE_DOSSIER_LEGACY)) !== undefined) {
			await store.set(CLE_DOSSIERS, liste);
			await store.delete(CLE_DOSSIER_LEGACY);
			await store.save();
		}
		return liste;
	} catch (e) {
		// Réglages illisibles : on repart de l'écran de choix plutôt que
		// d'empêcher le démarrage.
		console.warn(LOG_PREFIX, "réglages illisibles:", e);
		return [];
	}
}

export async function saveFolders(liste: DossierQuiz[]): Promise<void> {
	const store = await reglages();
	await store.set(CLE_DOSSIERS, liste);
	// `save()` explicite : l'enregistrement automatique est débouncé, et
	// l'application recharge la fenêtre juste après ce choix.
	await store.save();
}

/** Ajoute un dossier et rend la liste complète. Un chemin déjà présent n'est
    pas ajouté deux fois : il rendrait deux racines sur les mêmes fichiers,
    donc deux fois chaque quiz au catalogue. */
export async function addFolder(chemin: string): Promise<DossierQuiz[]> {
	const liste = await savedFolders();
	const normalise = chemin.replace(/[\\/]+$/, "");
	if (liste.some(d => d.path.replace(/[\\/]+$/, "").toLowerCase() === normalise.toLowerCase())) return liste;
	if (liste.length >= MAX_DOSSIERS) return liste;
	const nom = nomDeDossier(normalise);
	const suivante = [...liste, { id: idUnique(nom, new Set(liste.map(d => d.id))), path: normalise, name: nom }];
	await saveFolders(suivante);
	return suivante;
}

/** Retire un dossier. Le JOURNAL du dossier n'est pas touché : il vit dans le
    dossier, avec les notes qu'il décrit, et le rajouter plus tard doit rendre
    l'historique — c'est précisément ce que son nouvel emplacement permet. */
export async function removeFolder(id: string): Promise<DossierQuiz[]> {
	const suivante = (await savedFolders()).filter(d => d.id !== id);
	await saveFolders(suivante);
	return suivante;
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

/** Un vault Obsidian connu de la machine. */
export interface VaultConnu {
	chemin: string;
	nom: string;
}

/**
 * Les vaults qu'Obsidian connaît sur cette machine, pour les proposer d'un
 * clic plutôt que de faire naviguer l'utilisateur dans le sélecteur natif.
 *
 * La lecture se fait EN RUST (`obsidian_vaults`) : le fichier vit dans le
 * dossier de configuration d'Obsidian, hors de la portée du greffon `fs`, et
 * l'y étendre donnerait à la fenêtre bien plus de droits que nécessaire.
 *
 * Une liste vide est un état NORMAL — Obsidian n'est pas installé, ou aucun
 * de ses vaults n'existe plus. L'écran n'affiche alors que le sélecteur.
 */
export async function obsidianVaults(): Promise<VaultConnu[]> {
	try {
		return await invoke<VaultConnu[]>("obsidian_vaults");
	} catch (e) {
		console.warn(LOG_PREFIX, "liste des vaults Obsidian illisible:", e);
		return [];
	}
}

/**
 * Le dossier est-il un vault Obsidian ?
 *
 * La question n'est pas cosmétique : elle décide OÙ vont les résultats de quiz.
 * Dans un vault, le greffon écrit déjà dans `.obsidian/quiz-blocks-results` ;
 * l'application doit y écrire aussi, sinon les deux hôtes tiennent chacun leur
 * moitié de l'historique sur le même corpus. Hors d'un vault, il n'y a pas de
 * `.obsidian/` et les résultats vont dans `.neo-quiz/`.
 *
 * À appeler APRÈS `allowFolder` : sans la portée, `exists` échoue.
 */
export async function estVaultObsidian(racine: string): Promise<boolean> {
	try {
		return await exists(`${racine.replace(/[\/]+$/, "")}/.obsidian`);
	} catch (e) {
		// Dossier illisible : on le traite comme un dossier ordinaire plutôt
		// que d'empêcher son ouverture.
		console.warn(LOG_PREFIX, "détection du vault impossible:", e);
		return false;
	}
}

/* ══════════════════════════════════════════════════════════
   LES DATES D'EXAMEN

   Indexées par la CLÉ DE MODULE (`review/catalogue.ts`, qui porte
   l'identifiant de racine) : une date saisie pour « Efrei/Reseaux » ne doit
   jamais resserrer les révisions de « Perso/Reseaux ». Valeur PERSISTÉE,
   au format AAAA-MM-JJ tel que saisi — jamais traduite, jamais reformatée.

   `examDates()` lit le réglage EN MÉMOIRE plutôt que le magasin à chaque
   appel : le plan de l'ordonnanceur est recalculé souvent (chaque réponse
   jouée), et un aller-retour disque à chaque calcul serait payé pour rien.
   D'où `chargerExamDates()`, appelé une fois au démarrage.
══════════════════════════════════════════════════════════ */

const CLE_EXAM_DATES = "examDates";

/** Les dates d'examen par module, telles que saisies (`AAAA-MM-JJ`).
    Valeur PERSISTÉE : jamais traduite, jamais reformatée. */
let datesExamen: Record<string, string> = {};

export function examDates(): Record<string, string> {
	return datesExamen;
}

export async function chargerExamDates(): Promise<Record<string, string>> {
	try {
		const brut = await (await reglages()).get<Record<string, string>>(CLE_EXAM_DATES);
		datesExamen = brut && typeof brut === "object" ? brut : {};
	} catch (e) {
		console.warn(LOG_PREFIX, "dates d'examen illisibles:", e);
		datesExamen = {};
	}
	return datesExamen;
}

/**
 * La table des dates d'examen une fois celle d'un module réglée (ou effacée).
 *
 * PURE, et c'est délibéré : `setExamDate` est impure (elle écrit dans le
 * magasin Tauri), donc c'est cette règle-ci que `npm run check:folders`
 * exécute. Une date effacée RETIRE la clé, elle n'est pas gardée vide :
 * `horizonFor` retomberait de toute façon sur l'horizon par défaut, mais le
 * réglage accumulerait des entrées mortes qu'on n'oserait plus nettoyer.
 */
export function appliquerExamDate(
	courant: Record<string, string>,
	module: string,
	date: string,
): Record<string, string> {
	const suivant = { ...courant };
	if (date) suivant[module] = date; else delete suivant[module];
	return suivant;
}

export async function setExamDate(module: string, date: string): Promise<void> {
	const suivant = appliquerExamDate(datesExamen, module, date);
	datesExamen = suivant;
	const store = await reglages();
	await store.set(CLE_EXAM_DATES, suivant);
	await store.save();
}
