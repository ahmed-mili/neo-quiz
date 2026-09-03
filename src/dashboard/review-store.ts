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
	// Vrai une fois que `load()` a rendu la main (succès ou échec). Tant que
	// c'est faux, `lignes` peut être vide alors que le fichier contient déjà
	// de l'historique : le filtre de pertinence des renommages (plus bas) ne
	// doit alors filtrer AUCUN événement, sous peine de l'ignorer pour de bon.
	let charge = false;
	// Une écriture qui échoue de façon persistante (support en lecture seule,
	// verrou de synchro, disque plein) ne doit être signalée qu'une fois, pas
	// à chaque nouvelle tentative — voir flush().
	let echecSignale = false;

	/* Sans dossier de greffon, poursuivre créerait `/review-log.jsonl` à la
	   racine du vault. Échouer ici empêche cette écriture hors périmètre avant
	   même que le listener ou le timer puissent être armés. */
	const dossierPlugin = plugin.manifest.dir;
	if (!dossierPlugin) throw new Error("[quiz-blocks] dossier du greffon introuvable pour le journal de révision");
	// À côté du greffon, PAS dans data.json : `saveSettings()` réécrit ce
	// fichier en ENTIER à chaque appel, et un journal qui grossit à chaque
	// réponse (potentiellement réécrit toutes les 500 ms pendant une session
	// de révision) y serait à la fois lent et fragile.
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
		} finally {
			charge = true;
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
			echecSignale = false;
		} catch (e) {
			echec = true;
			// Le lot échoué repasse avant les arrivées plus récentes : l'ordre du
			// journal pilote les renommages et ne peut donc pas être inversé.
			enAttente = [...lot, ...enAttente];
			if (!echecSignale) {
				console.error("[quiz-blocks] écriture du journal de révision impossible", e);
				echecSignale = true;
			}
		} finally {
			enCours = false;
			if (!enAttente.length) return;
			if (detruit) {
				// À l'unload, finir immédiatement un lot arrivé pendant une écriture
				// réussie, sans boucler si le support reste indisponible.
				if (!echec) void flush();
				return;
			}
			// Un échec ne se réarme JAMAIS tout seul : un support durablement
			// indisponible (lecture seule, verrou de synchro, disque plein)
			// bouclerait sinon toutes les 500 ms pour le reste de la session. Le
			// lot en échec reste en tête d'`enAttente` et repart avec la prochaine
			// vraie activité : `record()` et le listener de renommage arment déjà
			// `ecrireBientot()` eux-mêmes.
			if (!echec) ecrireBientot();
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
			/* GARDE : `horizonFor` (le noyau, scheduler/horizon.ts) ne se protège
			   pas contre un horizon NaN, et a raison de ne pas le faire — il ne
			   reçoit qu'un `number | null` déjà validé. Ici, la date vient d'une
			   saisie humaine : `!a || !m || !j` n'attrape que les composants nuls
			   ou non numériques, pas une date hors du domaine représentable par
			   `Date` (une année à 6 chiffres passe ce premier filtre mais produit
			   un timestamp NaN). `typeof NaN === "number"` et `NaN <= now` valent
			   tous deux faux, donc un NaN non filtré ici empoisonnerait
			   silencieusement toutes les échéances dérivées de ce module. */
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

	/* Le renommage suit la note, comme dans stats-store.ts, et pour la même
	   raison : la clé contient le CHEMIN. Typé `TAbstractFile` et non `TFile` :
	   Obsidian émet ce même événement pour un DOSSIER renommé (signature réelle
	   dans obsidian.d.ts), et c'est justement ce cas qui compte ici — un module
	   est une clé de dossier — que `correspondAuChemin` sert à couvrir.
	   Comme dans stats-store.ts, une ligne de renommage n'existe que si elle
	   déplace réellement une clé : rejouer d'abord les anciens renommages est
	   nécessaire pour qu'un second déplacement reconnaisse le chemin courant
	   plutôt que le chemin historique. */
	const renameRef: EventRef = plugin.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
		const from = sansSlashFinal(oldPath);
		const to = sansSlashFinal(file.path);
		if (from === to) return;
		// Tant que `load()` n'a pas rendu la main, `lignes` peut être vide alors
		// que le journal sur disque contient déjà la clé visée : le filtre de
		// pertinence la manquerait et perdrait le renommage pour de bon. Une
		// ligne inutile ne coûte rien ; un renommage perdu est irréversible.
		if (charge && !applyRenames(lignes).some(line => correspondAuChemin(line.q, from))) return;
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
