import type { EventRef, Plugin, TAbstractFile } from "obsidian";
import type { QuizIndexEntry, Scanner } from "./scanner";
import {
	applyModuleOverrides, moduleForQuiz,
	type ModuleOverride,
} from "./quiz-modules";
import {
	applyRenames, DEFAULT_PARAMS, formatLine, parseLog, planToday,
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
const keyOfQuestion = (path: string, id: string): string => `${path}::${id}`;

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

/** Construit les seules données que le noyau comprend. `moduleForQuiz` reste
    l'unique règle de rattachement : l'adaptateur lui fournit la même table de
    dossiers que le dashboard, dérivée ici des overrides persistés. */
export function buildReviewCatalogue(
	quizzes: ReadonlyArray<QuizIndexEntry>,
	overrides: Record<string, ModuleOverride>
): ScheduledItem[] {
	const map = applyModuleOverrides({ byFolder: new Map(), ueOrder: [] }, overrides);
	const out: ScheduledItem[] = [];
	for (const quiz of quizzes) {
		const module = moduleForQuiz(quiz.path, map).folder;
		for (const it of quiz.items) {
			const item: ScheduledItem = {
				q: keyOfQuestion(quiz.path, it.id),
				module,
				// La tranche sépare les familles confusables d'un même chapitre
				// tant qu'aucun `topic` n'est déclaré par le contenu.
				source: typeof it.slice === "number" ? `${quiz.path}#${it.slice}` : quiz.path,
			};
			if (it.role) item.role = it.role;
			out.push(item);
		}
	}
	return out;
}

export function createReviewStore(plugin: ReviewStorePlugin, scanner: Scanner): ReviewStore {
	let lignes: LogLine[] = [];
	let enAttente: LogLine[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;
	let enCours = false;
	let detruit = false;

	/* Sans dossier de greffon, poursuivre créerait `/review-log.jsonl` à la
	   racine du vault. Échouer ici empêche cette écriture hors périmètre avant
	   même que le listener ou le timer puissent être armés. */
	const dossierPlugin = plugin.manifest.dir;
	if (!dossierPlugin) throw new Error("[quiz-blocks] dossier du greffon introuvable pour le journal de révision");
	const chemin = `${dossierPlugin}/${NOM_FICHIER}`;

	async function load(): Promise<void> {
		try {
			// `exists` distingue le premier démarrage d'une vraie erreur de
			// lecture, qui ne doit jamais remettre silencieusement le semestre à zéro.
			if (!(await plugin.app.vault.adapter.exists(chemin))) return;
			const texte = await plugin.app.vault.adapter.read(chemin);
			const { lines, ignored } = parseLog(texte);
			// Le listener est déjà actif pendant l'I/O : les lignes arrivées entre-
			// temps doivent suivre le fichier chargé, comme elles le feront sur disque.
			lignes = [...lines, ...lignes];
			if (ignored) console.warn(`[quiz-blocks] journal de révision : ${ignored} ligne(s) illisible(s), ignorée(s)`);
		} catch (e) {
			console.warn("[quiz-blocks] lecture du journal de révision impossible", e);
		}
	}

	function ecrireBientot(): void {
		if (detruit) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
	}

	async function flush(): Promise<void> {
		if (timer) { clearTimeout(timer); timer = null; }
		// Un second réveil pendant l'I/O laisse le premier lot finir. Le `finally`
		// reprogramme ce qui est arrivé entre-temps, donc deux append ne se croisent jamais.
		if (enCours || !enAttente.length) return;
		enCours = true;
		const lot = enAttente;
		enAttente = [];
		let echec = false;
		try {
			// Ajout seul : une fermeture ne peut tronquer que le dernier petit lot,
			// jamais réécrire tout l'historique déjà durable.
			await plugin.app.vault.adapter.append(chemin, lot.map(formatLine).join(""));
		} catch (e) {
			echec = true;
			// Le lot échoué repasse avant les arrivées plus récentes : l'ordre du
			// journal pilote les renommages et ne peut donc pas être inversé.
			enAttente = [...lot, ...enAttente];
			console.error("[quiz-blocks] écriture du journal de révision impossible", e);
		} finally {
			enCours = false;
			if (!enAttente.length) return;
			if (detruit) {
				// À l'unload, finir immédiatement un lot arrivé pendant une écriture
				// réussie, sans boucler si le support reste indisponible.
				if (!echec) void flush();
				return;
			}
			ecrireBientot();
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

	/** Horizons : la date d'examen saisie par module (Task 9). */
	function horizons(): Record<string, number | null> {
		const out: Record<string, number | null> = {};
		const overrides = plugin.settings.quizzesModuleOverrides || {};
		for (const [dossier, ov] of Object.entries(overrides)) {
			const brut = ov.examDate;
			if (typeof brut !== "string" || !brut) continue;
			// Minuit local : le constructeur ISO texte serait UTC et pourrait
			// déplacer l'examen d'un jour selon le fuseau de l'hôte.
			const [a, m, j] = brut.split("-").map(Number);
			if (!a || !m || !j) continue;
			const t = new Date(a, m - 1, j).getTime();
			/* `typeof NaN === "number"` et `NaN <= now` est faux : sans cette
			   frontière, une date hors domaine empoisonnerait les échéances sans
			   erreur visible. */
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
			now,
			dayStart,
			items: buildReviewCatalogue(scanner.getQuizzes(), plugin.settings.quizzesModuleOverrides || {}),
			events: lignes,
			horizons: horizons(),
			params: DEFAULT_PARAMS,
		});
	}

	/** `applyRenames` attend des préfixes exacts ; garder un slash final
	    fabriquerait `Cours//` et orphelinerait l'historique du dossier. */
	const sansSlashFinal = (path: string): string => path.endsWith("/") ? path.slice(0, -1) : path;
	const correspondAuChemin = (q: string, path: string): boolean =>
		q === path || q.startsWith(path + "/") || q.startsWith(path + "::");

	/* Une ligne de renommage n'existe que si elle déplace réellement une clé.
	   Rejouer d'abord les anciens renommages est nécessaire pour qu'un second
	   déplacement reconnaisse le chemin courant plutôt que le chemin historique. */
	const renameRef: EventRef = plugin.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
		const from = sansSlashFinal(oldPath);
		const to = sansSlashFinal(file.path);
		if (from === to || !applyRenames(lignes).some(line => correspondAuChemin(line.q, from))) return;
		const ligne: LogLine = { t: "rename", from, to, at: Date.now() };
		lignes.push(ligne);
		enAttente.push(ligne);
		ecrireBientot();
	});
	plugin.registerEvent(renameRef);

	function destroy(): void {
		if (detruit) return;
		detruit = true;
		plugin.app.vault.offref(renameRef);
		if (timer) { clearTimeout(timer); timer = null; }
		void flush();
	}

	return { load, record, plan, keyOf: keyOfQuestion, destroy };
}
