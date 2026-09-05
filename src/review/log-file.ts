import { formatLine, parseLog } from "../scheduler";
import type { LogLine } from "../scheduler";
import { LOG_PREFIX } from "../branding";

/* ══════════════════════════════════════════════════════════
   UN JOURNAL = UN FICHIER

   Tout ce qui concerne UN fichier de journal : le lire, absorber les
   fichiers de conflit déposés à côté, et y ajouter des lignes sans jamais
   le réécrire. Le routage entre PLUSIEURS journaux (l'application peut
   ouvrir dix dossiers) vit dans `review-store.ts` — ici, il n'y a qu'un
   fichier et il n'a pas à savoir qu'il en existe d'autres.

   Extrait de `dashboard/review-store.ts` SANS retouche de logique : chaque
   garde de ce fichier vient d'une revue, et une réécriture « au passage »
   serait la façon de les perdre.
══════════════════════════════════════════════════════════ */

const DEBOUNCE_MS = 500;

export interface LogFileFs {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	append(path: string, data: string): Promise<void>;
	list(dir: string): Promise<string[]>;
	remove(path: string): Promise<void>;
	mkdirs(path: string): Promise<void>;
}

export interface LogFile {
	load(): Promise<void>;
	/** Les lignes connues, dans l'ordre du fichier. */
	lines(): LogLine[];
	/** `load()` a-t-il rendu la main (succès ou échec) ? DÉLIBÉRÉMENT distinct
	    de `lines().length > 0` : un journal vide chargé et un journal pas
	    encore lu se distinguent PAR CET ACCESSEUR, pas par leur contenu.
	    L'appelant (`review-store.ts`, `renamed()`) s'en sert pour reproduire
	    la garde de l'ancien `dashboard/review-store.ts` : tant que ce n'est
	    pas vrai, un renommage ne doit JAMAIS être filtré par correspondance —
	    `lines()` pourrait être vide alors que le fichier contient déjà de
	    l'historique, et le filtre l'ignorerait pour de bon. */
	loaded(): boolean;
	/** Ajoute des lignes : en mémoire tout de suite, sur disque bientôt. */
	append(lines: LogLine[]): void;
	destroy(): void;
}

export function createLogFile(deps: { fs: LogFileFs; path: string }): LogFile {
	let lignes: LogLine[] = [];
	let enAttente: LogLine[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;
	let enCours = false;
	let detruit = false;
	// Vrai une fois que `load()` a rendu la main (succès ou échec). Tant que
	// c'est faux, `lignes` peut être vide alors que le fichier contient déjà
	// de l'historique : le filtre de pertinence des renommages (côté
	// `review-store.ts`) ne doit alors filtrer AUCUN événement, sous peine
	// de l'ignorer pour de bon.
	let charge = false;
	// Une écriture qui échoue de façon persistante (support en lecture seule,
	// verrou de synchro, disque plein) ne doit être signalée qu'une fois, pas
	// à chaque nouvelle tentative — voir flush().
	let echecSignale = false;

	/* Le dossier du journal, dérivé du chemin complet fourni par l'hôte
	   (`deps.path`) : c'est aussi le dossier scruté pour les fichiers de
	   conflit Syncthing, qui se déposent TOUJOURS à côté de l'original, quel
	   que soit ce dossier. Il n'y a plus de `manifest.dir` à exiger — le
	   journal vit désormais à côté des notes, pas à côté du greffon. */
	const dossierJournal = deps.path.slice(0, deps.path.lastIndexOf("/"));

	/* ── Fichiers de conflit Syncthing ──
	   Syncthing ne FUSIONNE pas : deux appareils qui écrivent le journal entre
	   deux synchronisations produisent `review-log.sync-conflict-<date>-<appareil>.jsonl`
	   à côté de l'original. Rien n'est perdu sur le disque, mais le lecteur
	   n'ouvre qu'un fichier : les réponses du perdant deviennent invisibles.

	   L'ajout seul est précisément le format qui se répare : on ABSORBE les
	   lignes manquantes par concaténation, puis on supprime la source. L'ordre
	   des opérations est ce qui rend l'opération sûre — écrire et RELIRE avant
	   de supprimer, jamais l'inverse — et un fichier dont une seule ligne n'a
	   pas été comprise n'est jamais supprimé. */
	const estConflit = (nom: string): boolean =>
		nom.startsWith("review-log.sync-conflict-") && nom.endsWith(".jsonl");

	async function absorberConflits(dejaLa: Set<string>): Promise<LogLine[]> {
		let fichiers: string[];
		try { fichiers = await deps.fs.list(dossierJournal); } catch { return []; }

		const gagnees: LogLine[] = [];
		const aAjouter: string[] = [];
		const aSupprimer: string[] = [];

		for (const cheminConflit of fichiers) {
			const nom = cheminConflit.slice(cheminConflit.lastIndexOf("/") + 1);
			if (!estConflit(nom)) continue;
			try {
				const { lines, ignored } = parseLog(await deps.fs.read(cheminConflit));
				for (const l of lines) {
					const cle = formatLine(l);
					// Les deux journaux partagent un préfixe commun : le
					// recouvrement est le cas NORMAL, pas l'exception. Sans ce
					// dédoublonnage, `spentToday` compterait deux fois les
					// mêmes réponses et mangerait le budget du jour.
					if (dejaLa.has(cle)) continue;
					dejaLa.add(cle);
					gagnees.push(l);
					aAjouter.push(cle);
				}
				/* On ne supprime JAMAIS ce qu'on n'a pas entièrement compris :
				   mieux vaut laisser un fichier orphelin visible qu'effacer en
				   silence des révisions illisibles. */
				if (ignored === 0) aSupprimer.push(cheminConflit);
				else console.warn(`${LOG_PREFIX} ${nom} : ${ignored} ligne(s) illisible(s), fichier conservé`);
			} catch (e) {
				console.warn(`${LOG_PREFIX} fichier de conflit illisible, conservé : ${nom}`, e);
			}
		}

		if (aAjouter.length) {
			// Ajout seul : une coupure au mauvais moment coûte une ligne, jamais
			// le fichier. Une réécriture complète, elle, pourrait tout perdre.
			// `join("")` et non `join("\n")` : `formatLine` termine DÉJÀ chaque
			// ligne par un saut. Un second séparateur insérerait une ligne vide
			// entre chaque révision absorbée.
			/* Un journal qui ne finit PAS par un saut (édité à la main, tronqué
			   par une fermeture brutale) collerait sa dernière ligne à la
			   première absorbée, et les DEUX deviendraient illisibles. On
			   recolle donc le saut manquant avant d'ajouter. */
			const finSaine = (await deps.fs.read(deps.path)).endsWith("\n");
			await deps.fs.append(deps.path, (finSaine ? "" : "\n") + aAjouter.join(""));
			// RELIRE avant de supprimer : sans cette preuve, un échec d'écriture
			// silencieux ferait disparaître les révisions qu'on prétend sauver.
			// On vérifie la PRÉSENCE de chaque ligne ajoutée, pas un total —
			// un compte ne dit pas QUOI a été écrit.
			const relu = new Set(parseLog(await deps.fs.read(deps.path)).lines.map(formatLine));
			if (aAjouter.some(l => !relu.has(l))) {
				console.warn(`${LOG_PREFIX} absorption non confirmée à la relecture, fichiers de conflit conservés`);
				return gagnees;
			}
		}

		for (const p of aSupprimer) {
			try { await deps.fs.remove(p); } catch (e) {
				console.warn(`${LOG_PREFIX} suppression du fichier de conflit impossible : ${p}`, e);
			}
		}
		if (gagnees.length || aSupprimer.length) {
			console.info(`${LOG_PREFIX} journal : ${gagnees.length} révision(s) récupérée(s), ${aSupprimer.length} fichier(s) de conflit absorbé(s)`);
		}
		return gagnees;
	}

	async function load(): Promise<void> {
		try {
			// `exists` distingue le premier démarrage d'une vraie erreur de
			// lecture, qui ne doit jamais remettre silencieusement le semestre à zéro.
			if (!(await deps.fs.exists(deps.path))) return;
			const texte = await deps.fs.read(deps.path);
			const { lines, ignored } = parseLog(texte);
			lines.push(...await absorberConflits(new Set(lines.map(formatLine))));
			// Le listener est déjà actif pendant l'I/O : les lignes arrivées entre-
			// temps doivent suivre le fichier chargé, comme elles le feront sur disque.
			/* DÉDOUBLONNAGE (exigence ajoutée à la tâche 4, pas dans le brief
			   original) : deux lignes identiques au caractère près SONT la même
			   révision. Le moteur interdit d'enregistrer deux fois la même
			   question dans une session (son tableau `recorded[]`), et deux
			   sessions ne se croisent jamais à la milliseconde — un doublon ne
			   peut donc venir que d'ailleurs : deux migrations entrelacées
			   (`src/review/migration.ts`, qui l'annonce explicitement comme
			   NON garanti) ou une absorption de conflit Syncthing qui recouvre
			   partiellement le principal. Sans ce filtre, `spentToday`
			   compterait deux fois les mêmes réponses et mangerait le budget de
			   révision du jour. Même clé que l'absorption des conflits
			   ci-dessus (`formatLine`), et ce filtre couvre du même coup tout
			   doublon futur, d'où qu'il vienne. */
			const vues = new Set<string>();
			const dedupliquees: LogLine[] = [];
			for (const l of [...lines, ...lignes]) {
				const cle = formatLine(l);
				if (vues.has(cle)) continue;
				vues.add(cle);
				dedupliquees.push(l);
			}
			lignes = dedupliquees;
			if (ignored) console.warn(`${LOG_PREFIX} journal de révision : ${ignored} ligne(s) illisible(s), ignorée(s)`);
		} catch (e) {
			console.warn(`${LOG_PREFIX} lecture du journal de révision impossible`, e);
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
			/* Le dossier du journal n'est plus garanti exister : l'ancien
			   emplacement (dossier du greffon) était créé par Obsidian
			   lui-même, le nouveau (à côté des notes) ne l'est par personne
			   tant qu'aucune migration n'y a rien écrit. `mkdirs` est
			   idempotent — il ne rejette pas si le dossier est déjà là. */
			await deps.fs.mkdirs(dossierJournal);
			// Ajout seul : une fermeture ne peut tronquer que le dernier petit lot,
			// jamais réécrire tout l'historique déjà durable.
			await deps.fs.append(deps.path, lot.map(formatLine).join(""));
			echecSignale = false;
		} catch (e) {
			echec = true;
			// Le lot échoué repasse avant les arrivées plus récentes : l'ordre du
			// journal pilote les renommages et ne peut donc pas être inversé.
			enAttente = [...lot, ...enAttente];
			if (!echecSignale) {
				console.error(`${LOG_PREFIX} écriture du journal de révision impossible`, e);
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
			// vraie activité : `append()` et le listener de renommage (côté
			// review-store.ts) arment déjà `ecrireBientot()` eux-mêmes.
			if (!echec) ecrireBientot();
		}
	}

	function append(lot: LogLine[]): void {
		if (!lot.length) return;
		lignes.push(...lot);
		enAttente.push(...lot);
		ecrireBientot();
	}

	function destroy(): void {
		if (detruit) return;
		detruit = true;
		if (timer) { clearTimeout(timer); timer = null; }
		void flush();
	}

	return { load, lines: () => lignes, loaded: () => charge, append, destroy };
}
