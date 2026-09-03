import type { Plugin, TAbstractFile } from "obsidian";
import type { Scanner } from "./scanner";
import type { ModuleOverride } from "./quiz-modules";
import {
	DEFAULT_PARAMS, formatLine, parseLog, planToday,
	type LogLine, type Plan, type ReviewEvent, type ReviewGrade, type ScheduledItem,
} from "../scheduler";
import type { QuestionRole } from "../types/quiz";

/* ══════════════════════════════════════════════════════════
   ADAPTATEUR DE L'ORDONNANCEUR — la seule partie qui connaît Obsidian.
   Le noyau (src/scheduler/) ne voit que des chaînes opaques et des
   nombres ; ce fichier lit et écrit les octets, construit le catalogue
   depuis le scanner, et suit les renommages. Il vit dans dashboard/ PARCE
   QUE c'est le dossier que le chantier 4 supprime.
══════════════════════════════════════════════════════════ */

const NOM_FICHIER = "review-log.jsonl";
const DEBOUNCE_MS = 500;

export interface ReviewStorePlugin extends Plugin {
	settings: { quizzesModuleOverrides?: Record<string, ModuleOverride> };
}

export interface ReviewStore {
	load(): Promise<void>;
	/** Journalise des réponses. Ajoute `t` et `at`, écrit en ajout différé. */
	record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void;
	/** Plan du jour, calculé à l'instant donné. */
	plan(now: number): Plan;
	/** Clé opaque d'une question : `chemin::id`. */
	keyOf(path: string, id: string): string;
	destroy(): void;
}

export function createReviewStore(plugin: ReviewStorePlugin, scanner: Scanner): ReviewStore {
	let lignes: LogLine[] = [];
	let enAttente: LogLine[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;

	/* Le journal vit à côté du greffon, PAS dans data.json : Obsidian
	   réécrit le fichier de réglages en ENTIER à chaque saveSettings(), et
	   un journal d'un mégaoctet réécrit toutes les 500 ms pendant une
	   session de révision serait mauvais. */
	const chemin = (): string => `${plugin.manifest.dir ?? ""}/${NOM_FICHIER}`;

	async function load(): Promise<void> {
		try {
			const texte = await plugin.app.vault.adapter.read(chemin());
			const { lines, ignored } = parseLog(texte);
			lignes = lines;
			// Une corruption est ANORMALE : elle doit se voir dans la console,
			// sans jamais empêcher le reste du journal de servir.
			if (ignored) console.warn(`[quiz-blocks] journal de révision : ${ignored} ligne(s) illisible(s), ignorée(s)`);
		} catch {
			lignes = []; // premier démarrage : le fichier n'existe pas encore
		}
	}

	function ecrireBientot(): void {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
	}

	async function flush(): Promise<void> {
		timer = null;
		if (!enAttente.length) return;
		const lot = enAttente;
		enAttente = [];
		try {
			// AJOUT, jamais réécriture : un ajout de quelques dizaines d'octets
			// ne court pas le risque qu'une fermeture d'Obsidian le tronque.
			await plugin.app.vault.adapter.append(chemin(), lot.map(formatLine).join(""));
		} catch (e) {
			// Remettre en file plutôt que perdre : la prochaine écriture réessaie.
			enAttente = [...lot, ...enAttente];
			console.error("[quiz-blocks] écriture du journal de révision impossible", e);
		}
	}

	function record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void {
		if (!entries.length) return;
		const at = Date.now();
		for (const e of entries) {
			const ligne: ReviewEvent = { t: "answer", q: e.q, at, grade: e.grade };
			if (e.role) ligne.role = e.role;
			lignes.push(ligne);
			enAttente.push(ligne);
		}
		ecrireBientot();
	}

	const keyOf = (path: string, id: string): string => `${path}::${id}`;

	/** Dossier parent d'une note : la clé de module de l'ordonnanceur. */
	const moduleOf = (path: string): string => {
		const i = path.lastIndexOf("/");
		return i < 0 ? "" : path.slice(0, i);
	};

	/** Catalogue : ce qui EXISTE aujourd'hui, d'après le scanner. */
	function catalogue(): ScheduledItem[] {
		const out: ScheduledItem[] = [];
		for (const quiz of scanner.getQuizzes()) {
			const mod = moduleOf(quiz.path);
			for (const it of quiz.items) {
				const item: ScheduledItem = {
					q: keyOf(quiz.path, it.id),
					module: mod,
					// La TRANCHE fait la famille quand elle existe : deux
					// questions de tranches différentes d'un même chapitre sont
					// ce qu'il y a de plus proche d'items confusables, tant
					// qu'aucun `topic` n'est déclaré par le contenu.
					source: typeof it.slice === "number" ? `${quiz.path}#${it.slice}` : quiz.path,
				};
				if (it.role) item.role = it.role;
				out.push(item);
			}
		}
		return out;
	}

	/** Horizons : la date d'examen saisie par module (Task 9). */
	function horizons(): Record<string, number | null> {
		const out: Record<string, number | null> = {};
		const overrides = plugin.settings.quizzesModuleOverrides || {};
		for (const [dossier, ov] of Object.entries(overrides)) {
			const brut = ov.examDate;
			if (typeof brut !== "string" || !brut) continue;
			// Minuit LOCAL du jour de l'examen : `new Date("2026-01-05")` serait
			// interprété en UTC et décalerait la date d'un jour selon le fuseau.
			const [a, m, j] = brut.split("-").map(Number);
			if (!a || !m || !j) continue;
			const t = new Date(a, m - 1, j).getTime();
			/* GARDE : `horizonFor` (scheduler/horizon.ts) ne se protège pas
			   contre un horizon NaN — `typeof NaN === "number"` et
			   `NaN <= now` valent tous deux faux, donc NaN traverserait
			   silencieusement et empoisonnerait tous les intervalles dérivés
			   de ce module. `!a || !m || !j` n'attrape que les composants
			   non numériques ou nuls ; une date saisie à la main peut encore
			   produire un nombre hors du domaine représentable par `Date`
			   (~±275 760, cf. ECMA-262 Date Time Limits) sans que ce filtre
			   ne le voie — c'est ICI, à la frontière avec une saisie humaine,
			   que la garde doit vivre : le noyau reçoit `number | null` et a
			   raison de ne pas se charger de la valider lui-même. */
			if (!Number.isFinite(t)) continue;
			out[dossier] = t;
		}
		return out;
	}

	function plan(now: number): Plan {
		const d = new Date(now);
		// Seul l'hôte connaît le fuseau : le noyau ne manipule aucun calendrier.
		const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
		return planToday({
			now, dayStart, items: catalogue(), events: lignes,
			horizons: horizons(), params: DEFAULT_PARAMS,
		});
	}

	/** Retire un éventuel « / » de fin. `applyRenames` (scheduler/log.ts)
	    matche par préfixe EXACT `from + "::"` ; un chemin de dossier fourni
	    avec un slash de fin produirait le préfixe « Cours// » qui ne
	    correspond plus à aucune clé existante (« Cours/note.md::q1 ») —
	    tout l'historique des questions du dossier deviendrait orphelin en
	    silence. Le noyau ne peut pas s'en protéger lui-même : il ne connaît
	    aucun format de chemin, seulement des préfixes de chaîne. */
	const sansSlashFinal = (p: string): string => p.endsWith("/") ? p.slice(0, -1) : p;

	/* Le renommage suit la note, comme dans stats-store.ts, et pour la même
	   raison : la clé contient le CHEMIN. Une LIGNE de journal plutôt qu'une
	   réécriture — le fichier reste en ajout seul, et deux appareils qui
	   fusionnent leurs journaux n'ont rien à réconcilier.
	   Branché sur l'événement du VAULT et non sur l'action de menu : les deux
	   chemins de renommage sont couverts d'un coup. Typé `TAbstractFile`
	   (pas `TFile`) : Obsidian émet ce même événement pour un DOSSIER
	   renommé, et c'est justement ce cas — la clé de module est un dossier —
	   que le préfixe de `applyRenames` sert à couvrir. */
	plugin.registerEvent(plugin.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
		const from = sansSlashFinal(oldPath);
		const to = sansSlashFinal(file.path);
		if (from === to) return;
		const ligne: LogLine = { t: "rename", from, to, at: Date.now() };
		lignes.push(ligne);
		enAttente.push(ligne);
		ecrireBientot();
	}));

	function destroy(): void {
		if (timer) { clearTimeout(timer); timer = null; }
		void flush();
	}

	return { load, record, plan, keyOf, destroy };
}
