import { App, Platform, TAbstractFile, TFolder, prepareFuzzySearch } from "obsidian";

/* Une entrée listable dans le picker de mentions. Le picker ne connaît que
   ce type : d'où vient l'entrée (vault, disque) ne le regarde pas. */
export interface FileEntry {
	/** Nom affiché : « TD3.md », « Cours ». */
	name: string;
	/** Vault → chemin relatif au vault. Externe → chemin relatif à la racine
	    configurée, PRÉFIXÉ par le nom de cette racine (ex.
	    « Downloads/pdf/TD3.pdf ») — symétrique du vault, jamais de chemin
	    absolu ici. `resolveExternalPath` fait l'inverse (relatif → absolu),
	    à appeler juste avant tout accès disque ou tout appel de callback. */
	path: string;
	isFolder: boolean;
	source: "vault" | "external";
}

/* Formats que le composer sait réellement attacher (cf. addComposerFiles
   dans ai.ts : images → vision, PDF → texte extrait, texte → chip).
   Tout le reste est masqué : ne jamais proposer ce qu'on refusera. */
const TEXT_EXT = ["md", "txt", "csv", "json", "yaml", "yml", "xml", "html", "css", "js", "ts"];
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"];
/* Exporté : `prompt-paths.ts` en dérive sa détection d'extensions dans le
   texte du composer. Une seule liste, sinon un format attachable ici
   resterait invisible là-bas (et l'utilisateur verrait son chemin ignoré
   sans savoir pourquoi). */
export const ATTACHABLE_EXT = new Set([...TEXT_EXT, ...IMAGE_EXT, "pdf"]);

export function isAttachable(name: string): boolean {
	const i = name.lastIndexOf(".");
	if (i < 0) return false;
	return ATTACHABLE_EXT.has(name.slice(i + 1).toLowerCase());
}

/* Tri de la référence (capture Claude Code) : fichiers et dossiers
   MÉLANGÉS, alphabétique insensible à la casse. Pas de dossiers d'abord. */
function compareEntries(a: FileEntry, b: FileEntry): number {
	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function toVaultEntry(f: TAbstractFile): FileEntry {
	return { name: f.name, path: f.path, isFolder: f instanceof TFolder, source: "vault" };
}

/* Contenu d'un dossier du vault. folderPath vide → racine.
   Zéro I/O : l'arbre est déjà en mémoire dans Obsidian. */
export function listVaultFolder(app: App, folderPath: string): FileEntry[] {
	const folder = folderPath
		? app.vault.getAbstractFileByPath(folderPath)
		: app.vault.getRoot();
	if (!(folder instanceof TFolder)) return [];
	return folder.children
		.filter(c => c instanceof TFolder || isAttachable(c.name))
		.map(toVaultEntry)
		.sort(compareEntries);
}

/* ── Racines hors vault (desktop uniquement) ──
   fs est requis PARESSEUSEMENT, dans la fonction, derrière
   Platform.isDesktopApp : le plugin doit rester isDesktopOnly: false et se
   charger sur mobile (cf. le pattern d'ai-client.ts / ai-providers.ts). */

/** Gardes anti-explosion : un utilisateur peut pointer C:\ ou un dossier de projets. */
const MAX_DEPTH = 8;
const MAX_ENTRIES = 20000;
// .git et .obsidian ne sont PAS listés ici : déjà exclus par le test
// `d.name.startsWith(".")` qui précède systématiquement ce garde (dossiers
// cachés), l'un et l'autre commençant par un point.
const SKIP_DIRS = new Set(["node_modules"]);

interface ExternalIndex { entries: FileEntry[]; mtimeMs: number; truncated: boolean }
const externalCache = new Map<string, ExternalIndex>();

function baseName(p: string): string {
	const norm = p.replace(/[\\/]+$/, "");
	const i = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
	return i < 0 ? norm : norm.slice(i + 1);
}

/** Normalise un chemin de racine externe pour le STOCKAGE (réglage
    `aiMentionExtraFolders`) : séparateurs unifiés en « / », sans séparateur
    final. Sans ça, `C:\...\Downloads` et `C:/.../Downloads` sont vus comme
    deux racines distinctes (double parcours, chaque fichier listé deux fois),
    et une racine saisie avec un séparateur final casse la navigation
    (`dir.startsWith(r + "/")` dans mention-picker.ts ne matche jamais). */
export function normalizeExternalRoot(path: string): string {
	return path.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
}

/** Longueur du préfixe « parent de la racine » à retirer d'un chemin absolu
    pour obtenir le chemin relatif préfixé par le nom de la racine (ex.
    « Downloads/pdf/x.pdf »). */
function rootParentLen(root: string): number {
	const trimmed = root.replace(/[\\/]+$/, "");
	return trimmed.length - baseName(trimmed).length;
}

/** Chemin absolu → chemin relatif (préfixé du nom de la racine). */
function toRelPath(absPath: string, root: string): string {
	return absPath.slice(rootParentLen(root));
}

/** Inverse de `toRelPath` : chemin relatif du picker (« Downloads/pdf ») →
    chemin absolu, en retrouvant la racine configurée dont le nom de base
    préfixe ce chemin. Résolution déterministe : la PREMIÈRE racine qui
    matche (ordre du réglage) l'emporte.
    Ambiguïté connue et non résolue : deux racines de même nom de base (ex.
    « D:/Cours » et « C:/Travail/Cours ») ne sont pas distinguables depuis ce
    chemin relatif seul — la seconde racine devient alors inatteignable en
    tapant, et leurs entrées s'affichent avec un sous-titre identique dans la
    liste (cf. rapport de tâche, doute correspondant).
    Renvoie null si aucune racine ne correspond (dossier hors des racines
    configurées, ou racine retirée entre-temps). */
export function resolveExternalPath(roots: string[], relPath: string): { absPath: string; root: string } | null {
	for (const root of roots) {
		const trimmed = root.replace(/[\\/]+$/, "");
		const label = baseName(trimmed);
		if (relPath === label || relPath.startsWith(label + "/")) {
			return { absPath: trimmed.slice(0, rootParentLen(trimmed)) + relPath, root: trimmed };
		}
	}
	return null;
}

/** Les racines configurées, en entrées listables (fin de la liste initiale). */
export function listExternalRoots(roots: string[]): FileEntry[] {
	if (!Platform.isDesktopApp) return [];
	return roots.map(r => ({
		name: baseName(r), path: baseName(r), isFolder: true, source: "external" as const,
	}));
}

/** Contenu d'un dossier externe. readdir du SEUL dossier affiché : le coût
    ne dépend pas de la taille du disque. `root` = la racine configurée dont
    `dirPath` descend, nécessaire pour reconstruire un chemin relatif correct
    même en profondeur (sinon on ne verrait que le nom du dossier courant,
    pas tout le chemin depuis la racine — cf. `walk`). */
export function listExternalFolder(dirPath: string, root: string): FileEntry[] {
	if (!Platform.isDesktopApp) return [];
	const fs = require("fs") as typeof import("fs");
	let dirents: import("fs").Dirent[];
	try { dirents = fs.readdirSync(dirPath, { withFileTypes: true }); } catch (e) { return []; }
	const dirAbs = dirPath.replace(/[\\/]+$/, "");
	return dirents
		.filter(d => !d.name.startsWith("."))
		.filter(d => d.isDirectory() ? !SKIP_DIRS.has(d.name) : isAttachable(d.name))
		.map(d => ({
			name: d.name,
			path: toRelPath(dirAbs + "/" + d.name, root),
			isFolder: d.isDirectory(),
			source: "external" as const,
		}))
		.sort(compareEntries);
}

function walk(root: string): ExternalIndex {
	const fs = require("fs") as typeof import("fs");
	const entries: FileEntry[] = [];
	let truncated = false;
	const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
	// Étiquette sur le while : le `break` de la garde MAX_ENTRIES doit sortir
	// des DEUX boucles d'un coup. Un `break` nu ne quitterait que le `for`
	// interne — le `while` reprendrait alors la pile et referait un
	// `readdirSync` par dossier déjà empilé, pour re-déclencher aussitôt le
	// même garde : borné, mais du travail disque pour rien.
	outer: while (stack.length) {
		const cur = stack.pop();
		if (!cur) break;
		if (cur.depth > MAX_DEPTH) { truncated = true; continue; }
		let dirents: import("fs").Dirent[];
		try { dirents = fs.readdirSync(cur.dir, { withFileTypes: true }); } catch (e) { continue; }
		for (const d of dirents) {
			if (entries.length >= MAX_ENTRIES) { truncated = true; break outer; }
			if (d.name.startsWith(".")) continue;
			const full = cur.dir.replace(/[\\/]+$/, "") + "/" + d.name;
			if (d.isDirectory()) {
				if (SKIP_DIRS.has(d.name)) continue;
				entries.push({ name: d.name, path: toRelPath(full, root), isFolder: true, source: "external" });
				stack.push({ dir: full, depth: cur.depth + 1 });
			} else if (isAttachable(d.name)) {
				entries.push({ name: d.name, path: toRelPath(full, root), isFolder: false, source: "external" });
			}
		}
	}
	let mtimeMs = 0;
	try { mtimeMs = fs.statSync(root).mtimeMs; } catch (e) { mtimeMs = 0; }
	return { entries, mtimeMs, truncated };
}

function indexOf(root: string): ExternalIndex | null {
	if (!Platform.isDesktopApp) return null;
	const fs = require("fs") as typeof import("fs");
	let mtimeMs = 0;
	try { mtimeMs = fs.statSync(root).mtimeMs; } catch (e) { return null; }
	const hit = externalCache.get(root);
	if (hit && hit.mtimeMs === mtimeMs) return hit;
	const fresh = walk(root);
	externalCache.set(root, fresh);
	return fresh;
}

/** Préchauffe l'index (première ouverture du picker) : le vault s'affiche
    tout de suite, le disque se greffe ensuite.
    Vide le cache AVANT de relancer l'indexation. Pourquoi : `externalCache`
    est une Map de MODULE, donc persistante tant que le plugin est chargé, et
    `indexOf` ne réinvalide que si le mtime de la RACINE elle-même a changé.
    Or ajouter un fichier dans un SOUS-dossier (ex. `Downloads/cours/`) met à
    jour le mtime de ce sous-dossier, jamais celui de la racine — sur NTFS
    comme ailleurs. Sans ce clear, un fichier ajouté en profondeur resterait
    invisible à la recherche jusqu'au rechargement du plugin (la navigation,
    elle, n'est pas touchée : `listExternalFolder` fait un `readdirSync` live
    à chaque appel).
    Ne PAS remplacer ce clear par un scan récursif des mtimes de
    sous-dossiers pour décider s'il faut invalider : ce serait aussi coûteux
    que le parcours qu'on cherche à éviter. Le compromis retenu marche parce
    que (a) un parcours complet coûte quelques millisecondes sur un dossier
    réel (mesuré, Node, à chaud : Downloads — 18 entrées, 4 dossiers, < 1 ms ;
    pire cas plausible C:\Users\Ahmed — 12309 entrées, 7383 dossiers, ~158 ms)
    et (b) le contrôle de mtime dans `indexOf` garde tout son intérêt PENDANT
    la frappe : tant que le menu reste OUVERT, chaque frappe (`refresh` sans
    passer par ce prime) réutilise l'index déjà calculé, sans reclear.
    ATTENTION, ce n'est PAS « un seul clear par session de menu » : choisir un
    dossier FERME le menu (`closeMenu()` dans ui-select.ts tourne avant
    `item.onChoose()`, y compris au clic comme à Entrée/Tab) puis le rouvre
    aussitôt (`refresh` revoit `menu === null`) — donc un clear (et un
    parcours) par NIVEAU de navigation descendu, pas un seul pour toute la
    session. Le coût reste borné (mesures ci-dessus), mais ne pas décrire ce
    comportement comme « un seul clear » : ce projet s'est déjà fait piéger
    par un commentaire qui promettait moins de travail que le code n'en fait
    réellement. Ne pas retirer ce clear pour « optimiser ». */
export function primeExternalIndex(roots: string[]): void {
	if (!Platform.isDesktopApp) return;
	externalCache.clear();
	for (const r of roots) setTimeout(() => indexOf(r), 0);
}

/* Recherche fuzzy FUSIONNÉE : vault et racines externes scorés avec le
   MÊME prepareFuzzySearch(query), puis triés ENSEMBLE par score décroissant.
   Sans fusion (une simple concaténation vault puis externe), un vault de
   plusieurs milliers de fichiers remplit à lui seul la limite d'affichage
   avant que les externes soient pris en compte : un fichier de Downloads ne
   remonterait qu'avec une requête très spécifique — l'intention d'Ahmed
   (« chercher dans TOUT le vault ET TOUT Downloads ») ne serait pas tenue.
   `truncated` nomme les racines externes où une garde a coupé le parcours
   (jamais de troncature silencieuse). */
export function searchAll(app: App, roots: string[], query: string): { entries: FileEntry[]; truncated: string[] } {
	const fuzzy = prepareFuzzySearch(query);
	const scored: { entry: FileEntry; score: number }[] = [];

	// Vault : chemin complet, toujours global (décision d'Ahmed) — « Cours/ja »
	// matche « Cours/Java/TD3.md » parce que le motif tapé fait simplement
	// partie du chemin, sans notion de périmètre.
	for (const f of app.vault.getAllLoadedFiles()) {
		if (f.path === "/") continue; // la racine elle-même n'est pas une entrée
		if (!(f instanceof TFolder) && !isAttachable(f.name)) continue;
		const r = fuzzy(f.path);
		if (r) scored.push({ entry: toVaultEntry(f), score: r.score });
	}

	// Externe (desktop uniquement) : chaque racine configurée, intégralement.
	// `entry.path` (produit par `walk`) est DÉJÀ le chemin relatif préfixé du
	// nom de la racine (« Downloads/x.pdf »), symétrique du chemin relatif du
	// vault — même échelle pour `prepareFuzzySearch`, pas de biais de
	// préfixe absolu (~25 caractères de bruit de tête sinon, qui handicaperait
	// systématiquement l'externe dans le tri par score commun).
	const truncated: string[] = [];
	if (Platform.isDesktopApp) {
		for (const root of roots) {
			const idx = indexOf(root);
			if (!idx) continue;
			if (idx.truncated) truncated.push(baseName(root));
			for (const entry of idx.entries) {
				const r = fuzzy(entry.path);
				if (r) scored.push({ entry, score: r.score });
			}
		}
	}

	scored.sort((a, b) => b.score - a.score);
	return { entries: scored.map(x => x.entry), truncated };
}
