import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { isMastered } from "./quiz-mastery";

/* ══════════════════════════════════════════════════════════
   QUIZ MODULES — regroupement des quiz par MODULE et par UE.
   Module PUR : aucune dépendance à Obsidian ni au DOM (le texte
   de la note de correspondance est lu par l'appelant et passé en
   argument). La hiérarchie UE → module → quiz vient d'une note
   « Dashboard » : des encadrés `> [!portals] <UE>` suivis de liens
   wiki vers les dossiers de module.
══════════════════════════════════════════════════════════ */

/** Un module tel que déclaré dans la note : dossier, nom affiché, UE. */
export interface ModuleInfo {
	/** Dossier de module = 1er segment sous le dossier d'année. Sert de clé. */
	folder: string;
	/** Nom affiché (alias du lien, ou le dossier faute d'alias). */
	name: string;
	/** Titre de l'UE parente, ou null si le module n'est dans aucun encadré. */
	ue: string | null;
	/** Couleur du liseré choisie dans « Modifier dossier » (override réglages) —
	    absente = liseré par état d'avancement (comportement historique). */
	color?: string;
	/** Icône Lucide choisie dans « Modifier dossier » (carré teinté de la carte)
	    — absente = icône par défaut (cf. module-card.ts). */
	icon?: string;
}

/** Override persisté par le modal « Modifier dossier » (menu ⋯ d'un module).
    Chaque champ absent = on garde la valeur de la note de correspondance.
    `ue: null` force « Sans UE » (≠ absent). */
export interface ModuleOverride {
	name?: string;
	ue?: string | null;
	color?: string;
	icon?: string;
	/** Date d'examen du module, format `AAAA-MM-JJ` (chantier ordonnanceur,
	    UI de saisie posée par la task 9). Déclaré ici dès la task 7 —
	    l'adaptateur du journal de révision (review-store.ts) le lit déjà en
	    `?.`, sans attendre l'UI qui l'écrit. */
	examDate?: string;
}

/** Applique les overrides réglages PAR-DESSUS la table issue de la note.
    Retourne une nouvelle map (l'originale, mise en cache, reste intacte). */
export function applyModuleOverrides(map: ModuleMap, overrides: Record<string, ModuleOverride>): ModuleMap {
	const byFolder = new Map(map.byFolder);
	const ueOrder = [...map.ueOrder];
	for (const [folder, ov] of Object.entries(overrides)) {
		const base = byFolder.get(folder) ?? { folder, name: folder, ue: null };
		const merged: ModuleInfo = {
			folder,
			name: ov.name?.trim() || base.name,
			ue: ov.ue !== undefined ? ov.ue : base.ue,
			color: ov.color ?? base.color,
			icon: ov.icon ?? base.icon,
		};
		byFolder.set(folder, merged);
		// Une UE inventée dans le modal doit exister dans l'axe UE.
		if (merged.ue && !ueOrder.includes(merged.ue)) ueOrder.push(merged.ue);
	}
	return { byFolder, ueOrder };
}

/** Table issue de la note : dossier → info, + ordre d'apparition des UE. */
export interface ModuleMap {
	byFolder: Map<string, ModuleInfo>;
	/** Titres d'UE dans l'ordre du document (pour l'axe « Par UE »). */
	ueOrder: string[];
}

const CALLOUT_RE = /^>\s*\[!portals\]\s*(.+?)\s*$/;
const LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/;

/* Extrait le SEGMENT de dossier de module d'un chemin de lien : le premier
   segment situé après un dossier « année » (repéré par « B1 (…) », « B2 (…) »,
   etc.). Si aucun dossier année n'est reconnu, on prend le dernier segment de
   dossier (le lien pointe soit vers le dossier, soit vers une note dedans —
   dans les deux cas le dossier de module est l'avant-dernier ou le dernier
   segment ; on retient le segment sous l'année pour être robuste aux deux). */
function moduleFolderFromLinkPath(linkPath: string): string {
	const segs = linkPath.split("/").filter(Boolean);
	const yearIdx = segs.findIndex(s => /\bB\d+\s*\(/.test(s));
	if (yearIdx >= 0 && yearIdx + 1 < segs.length) return segs[yearIdx + 1];
	// Repli : avant-dernier segment si le lien finit par une note homonyme,
	// sinon le dernier. On ne peut pas distinguer note/dossier depuis le texte ;
	// le 1er segment sous l'année couvre le vault réel d'Ahmed.
	return segs.length >= 2 ? segs[segs.length - 2] : segs[segs.length - 1] || "";
}

/** Parse le texte de la note de correspondance. Tolérant : lignes hors
    encadré ignorées ; note sans encadré → map vide (dégradation propre). */
export function parseModuleMap(noteText: string): ModuleMap {
	const byFolder = new Map<string, ModuleInfo>();
	const ueOrder: string[] = [];
	let currentUe: string | null = null;
	for (const raw of noteText.split(/\r?\n/)) {
		const co = raw.match(CALLOUT_RE);
		if (co) {
			currentUe = co[1];
			if (!ueOrder.includes(currentUe)) ueOrder.push(currentUe);
			continue;
		}
		// Une ligne de lien n'appartient à une UE que sous un encadré ; une
		// ligne « > » vide ou du texte libre ne remet pas currentUe à null
		// (les encadrés Obsidian sont des blocs de lignes « > … » contiguës,
		// mais une ligne blanche entre deux encadrés suffit à séparer —
		// gérée par le fait qu'un nouvel encadré réassigne currentUe).
		const lk = raw.match(LINK_RE);
		if (!lk || currentUe === null) continue;
		const folder = moduleFolderFromLinkPath(lk[1]);
		if (!folder) continue;
		const name = (lk[2] || folder).trim();
		if (!byFolder.has(folder)) byFolder.set(folder, { folder, name, ue: currentUe });
	}
	return { byFolder, ueOrder };
}

/** Module d'un quiz : plus proche dossier ANCÊTRE reconnu dans la table.
    Fallback : dossier parent immédiat, UE null (jamais de disparition). */
export function moduleForQuiz(quizPath: string, map: ModuleMap): ModuleInfo {
	const segs = quizPath.split("/").filter(Boolean);
	// segs sans le fichier : on remonte du plus profond vers la racine.
	for (let i = segs.length - 2; i >= 0; i--) {
		const hit = map.byFolder.get(segs[i]);
		if (hit) return hit;
	}
	const parent = segs.length >= 2 ? segs[segs.length - 2] : "";
	return { folder: parent, name: parent, ue: null };
}

/** Un module affiché : ses quiz + agrégats. */
export interface ModuleGroup {
	folder: string;
	name: string;
	ue: string | null;
	/** Couleur de liseré override (cf. ModuleInfo.color). */
	color?: string;
	/** Icône Lucide override (cf. ModuleInfo.icon). */
	icon?: string;
	quizzes: QuizIndexEntry[];
	total: number;
	mastered: number;
}

/** Regroupe les quiz DÉJÀ FILTRÉS par module. Un module sans quiz n'existe
    pas. Tri alphabétique par nom (jamais par nombre). */
export function buildModuleGroups(
	quizzes: QuizIndexEntry[],
	stats: Record<string, QuizStatRecord>,
	map: ModuleMap,
	/** Dossiers à afficher MÊME sans quiz (créés/édités via les modals —
	    sans ça, un « Nouveau dossier » vide n'apparaîtrait jamais). */
	alwaysInclude: string[] = []
): ModuleGroup[] {
	const acc = new Map<string, ModuleGroup>();
	for (const folder of alwaysInclude) {
		const info = map.byFolder.get(folder) ?? { folder, name: folder, ue: null };
		acc.set(folder, { folder, name: info.name, ue: info.ue, color: info.color, icon: info.icon, quizzes: [], total: 0, mastered: 0 });
	}
	for (const q of quizzes) {
		const m = moduleForQuiz(q.path, map);
		let g = acc.get(m.folder);
		if (!g) { g = { folder: m.folder, name: m.name, ue: m.ue, color: m.color, icon: m.icon, quizzes: [], total: 0, mastered: 0 }; acc.set(m.folder, g); }
		g.quizzes.push(q);
	}
	const groups = [...acc.values()];
	for (const g of groups) {
		g.total = g.quizzes.length;
		g.mastered = g.quizzes.filter(q => isMastered(q, stats)).length;
	}
	groups.sort((a, b) => a.name.localeCompare(b.name));
	return groups;
}

/** Un groupe d'UE : ses modules + agrégats. */
export interface UeGroup {
	/** Titre d'UE, ou null pour les modules sans UE. */
	ue: string | null;
	/** Clé de repli stable : « ue:<titre> » (le « : » est interdit dans un
	    chemin Obsidian → aucune collision avec une vraie clé de dossier). */
	key: string;
	modules: ModuleGroup[];
	total: number;
	mastered: number;
}

/** Regroupe des modules par UE. UE dans l'ordre du document (map.ueOrder) ;
    « Sans UE » (modules non résolus) toujours en DERNIER. */
export function buildUeGroups(modules: ModuleGroup[], map: ModuleMap): UeGroup[] {
	const byUe = new Map<string, ModuleGroup[]>();
	for (const m of modules) {
		const k = m.ue ?? "";
		if (!byUe.has(k)) byUe.set(k, []);
		byUe.get(k)!.push(m);
	}
	const groups: UeGroup[] = [];
	const push = (ue: string | null) => {
		const list = byUe.get(ue ?? "");
		if (!list || !list.length) return;
		groups.push({
			ue,
			key: ue === null ? "ue:__none__" : "ue:" + ue,
			modules: list,
			total: list.reduce((s, m) => s + m.total, 0),
			mastered: list.reduce((s, m) => s + m.mastered, 0),
		});
	};
	for (const ue of map.ueOrder) push(ue);
	push(null); // « Sans UE » en dernier
	return groups;
}
