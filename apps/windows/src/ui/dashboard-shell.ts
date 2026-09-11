/* ══════════════════════════════════════════════════════════
   LA COQUILLE DU TABLEAU DE BORD, CÔTÉ APPLICATION

   Sous Obsidian, `src/dashboard.ts` est un `ItemView` : il porte le cycle de
   vie d'un onglet, un `Scope` de raccourcis, l'historique des boutons de
   souris. Rien de tout cela n'est portable — et rien de tout cela n'est
   l'interface. Ce fichier fait les trois choses que `dashboard.ts` fait et
   qui comptent : monter le rail, router entre les pages, assembler le `ctx`.

   Les PAGES, elles, sont les mêmes qu'Obsidian : `src/dashboard/nav.ts`,
   `home.ts`, `quizzes.ts`, et depuis la tranche 3 la page d'un quiz,
   `detail.ts` (questions à gauche, question courante à droite, bouton
   « Editor »). Une copie divergerait, et les deux tableaux de bord
   finiraient par compter différemment.

   La page d'un quiz est une VUE de la coquille (`vueCourante === "detail"`),
   exactement comme sous Obsidian (`dashboard.ts`, `case "detail"`), et non
   un écran que `main.ts` monterait à la place de la coquille : le retour
   doit rouvrir le DOSSIER du quiz (`quizzes.openFolderOfQuiz`), et c'est
   l'instance de `createQuizzesHandlers` restée vivante qui sait le faire.
   Seul le MOTEUR (jouer) remplace la coquille — c'est `main.ts` qui le
   monte, par `deps.onOpenQuiz`.

   Ce module n'importe AUCUN CSS — même contrainte que les modules d'hôte :
   un import de CSS y tire les fontes MathLive, pour lesquelles le harnais
   des scripts de contrôle n'a pas de chargeur. Les classes (`qbd-layout`,
   `qbd-sidebar`, `qbd-content`…) viennent de `src/assets/css/`, déjà chargé
   par `main.ts`.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../../../../src/dom";
import { t } from "../../../../src/i18n";
import { currentHost } from "../../../../src/host/current";
import { createNavHandlers } from "../../../../src/dashboard/nav";
import { createHomeHandlers } from "../../../../src/dashboard/home";
import { createQuizzesHandlers } from "../../../../src/dashboard/quizzes";
import { createDetailHandlers } from "../../../../src/dashboard/detail";
import { openIconPicker } from "../../../../src/dashboard/icon-picker";
import { openCreateFolderModal, openCreateQuizModal } from "../../../../src/dashboard/folder-create";
import { buildModuleCardMenu, buildQuizCardMenu } from "../../../../src/dashboard/quiz-menu";
import { createSelect, openActionMenu } from "../../../../src/dashboard/ui-select";
import type { DashboardPageSettings, DashboardShellCtx, DashboardViewName } from "../../../../src/types/dashboard-ctx";
import type { QuizIndexEntry, Scanner } from "../../../../src/dashboard/scanner";
import type { StatsStore } from "../../../../src/dashboard/stats-store";
import type { ReviewStore } from "../../../../src/review/review-store";
import type { ModuleOverride } from "../../../../src/dashboard/quiz-modules";
import { ecrireReglage, lireReglage } from "../host/folder";

/* ══════════════════════════════════════════════════════════
   LES RÉGLAGES DES PAGES « ACCUEIL » / « MES QUIZ »

   Mêmes CINQ clés que côté greffon (plugin.ts DEFAULT_SETTINGS), sur le
   modèle d'`examDates` (host/folder.ts) : un cache en mémoire chargé au
   démarrage, une fonction qui écrit. Les noms de clés persistées sont
   repris À L'IDENTIQUE — ce sont les mêmes que `ctx.settings` côté greffon,
   et les renommer « parce que c'est l'app » créerait deux vocabulaires pour
   la même donnée.

   `reglagesPages()` renvoie CET OBJET, pas une copie : les pages le MUTENT
   en place (dossier déplié, axe de regroupement changé) puis appellent
   `ctx.saveSettings()` — une copie romprait ce contrat, les mutations se
   perdraient sans jamais atteindre le disque.
══════════════════════════════════════════════════════════ */

let reglagesPagesCache: DashboardPageSettings = {};

/**
 * À charger UNE FOIS au démarrage (main.ts, comme `chargerExamDates`) :
 * sans cet appel, la première page de la session verrait des réglages vides
 * (aucun dossier déplié, axe par défaut) jusqu'au premier `saveSettings()`.
 */
export async function chargerReglagesPages(): Promise<DashboardPageSettings> {
	reglagesPagesCache = {
		quizzesExpandedFolders: (await lireReglage<string[]>("quizzesExpandedFolders")) ?? undefined,
		quizzesGrouping: (await lireReglage<string>("quizzesGrouping")) ?? undefined,
		quizzesModuleOverrides: (await lireReglage<Record<string, ModuleOverride>>("quizzesModuleOverrides")) ?? undefined,
		quizzesModuleMapNote: (await lireReglage<string>("quizzesModuleMapNote")) ?? undefined,
		quizzesArchivedFolders: (await lireReglage<string[]>("quizzesArchivedFolders")) ?? undefined,
	};
	return reglagesPagesCache;
}

function reglagesPages(): DashboardPageSettings {
	return reglagesPagesCache;
}

async function enregistrerReglagesPages(): Promise<void> {
	// `?? null`/`?? []` : un réglage effacé par la page (retour à « aucun »)
	// doit s'écrire comme tel, jamais laisser une ancienne valeur trainer.
	await ecrireReglage("quizzesExpandedFolders", reglagesPagesCache.quizzesExpandedFolders ?? []);
	await ecrireReglage("quizzesGrouping", reglagesPagesCache.quizzesGrouping ?? null);
	await ecrireReglage("quizzesModuleOverrides", reglagesPagesCache.quizzesModuleOverrides ?? {});
	await ecrireReglage("quizzesModuleMapNote", reglagesPagesCache.quizzesModuleMapNote ?? null);
	await ecrireReglage("quizzesArchivedFolders", reglagesPagesCache.quizzesArchivedFolders ?? []);
}

/* ══════════════════════════════════════════════════════════
   LA COQUILLE
   ══════════════════════════════════════════════════════════ */

/**
 * Vue actuellement affichée par le tableau de bord. Volontairement au niveau
 * du MODULE, et non locale à `monterDashboard` : ce module est un singleton
 * (une seule fenêtre), et c'est cette persistance qui fait qu'ouvrir un quiz
 * puis revenir remonte la coquille sur la page d'où l'on venait, plutôt que
 * de toujours repartir sur « Accueil » (`main.ts` démonte puis remonte
 * entièrement la coquille à chaque aller-retour vers un quiz ou les
 * réglages — un état local serait perdu à chaque fois). Initialisée à
 * "home" : la toute première fois que l'application démarre.
 */
let vueCourante: DashboardViewName = "home";

/**
 * Le quiz de la page « detail », et la vue d'où l'on y est entré — au niveau
 * du MODULE pour la même raison que `vueCourante` : jouer un quiz depuis sa
 * page remplace la coquille par le moteur, et le retour doit ramener SUR
 * CETTE PAGE (comme sous Obsidian, où le tableau de bord reste sur le détail
 * pendant que la note s'ouvre à côté), puis sa flèche retour au bon endroit.
 * C'est le `selectedQuiz`/`previousView` de `QuizDashboardView`.
 * `vuePrecedente` ne vaut jamais "detail" : elle n'est prise qu'en QUITTANT
 * une autre vue (le greffon, lui, la recopie sans garde et peut ainsi
 * renvoyer un détail vers lui-même).
 */
let quizSelectionne: QuizIndexEntry | null = null;
let vuePrecedente: DashboardViewName = "home";

export interface MonterDashboardDeps {
	scanner: Scanner;
	statsStore: StatsStore;
	/** Le journal de révision — l'application le fournit toujours (construit
	    par `creerJournalApp`), contrairement au greffon où `plugin._reviewStore`
	    peut manquer. Le champ reste néanmoins celui de `DashboardShellCtx`
	    (optionnel), pour ne pas inventer un second contrat. */
	reviewStore: ReviewStore;
	onOpenQuiz(entry: QuizIndexEntry): void;
	onOpenSettings(): void;
}

/**
 * Monte le rail + la page courante dans `root`, et rend le démontage.
 *
 * `root` DOIT être vide à l'appel (comme pour `renderSettings`/`openQuizPage`) :
 * c'est `main.ts` qui vide le conteneur avant chaque changement d'écran, au
 * même titre que le `demonterCourant` qu'il appelle avant tout remontage.
 *
 * Le démontage rend une PROMESSE : il démonte tout de suite (abonnement au
 * scanner, écoute clavier de la page d'un quiz), et se résout quand
 * l'écriture que cette page tenait en attente est TERMINÉE. Un changement
 * d'écran n'a pas à l'attendre ; la fermeture de la fenêtre, si — c'est
 * `main.ts` qui décide lequel des deux il est.
 */
export function monterDashboard(root: HTMLElement, deps: MonterDashboardDeps): () => Promise<void> {
	const layout = ajouter(root, "div", "qbd-layout");
	// `qbd-sidebar` et non `qbd-nav` : c'est la classe que `src/assets/css/
	// dashboard/dashboard-base.css` habille (largeur, fond transparent) — le
	// rail est PEUPLÉ de nœuds `qbd-nav-*` (brand, items, footer) par
	// `nav.render()`, mais son propre conteneur porte `qbd-sidebar`, exactement
	// comme sous Obsidian (`dashboard.ts`, `onOpen`). Un conteneur `qbd-nav`
	// nu n'a AUCUNE règle : le rail se serait retrouvé sans largeur ni fond.
	const navEl = ajouter(layout, "div", "qbd-sidebar");
	const contentEl = ajouter(layout, "div", "qbd-content");

	/* Dernière vue effectivement PEINTE dans CE montage — jamais persistée
	   au niveau du module, à l'inverse de `vueCourante` : le DOM est neuf à
	   chaque montage (root vidé par main.ts), donc le tout premier rendu
	   doit toujours jouer son entrée, y compris au retour d'un quiz. */
	let dernierePeinte: DashboardViewName | null = null;

	const ctx: DashboardShellCtx = {
		scanner: deps.scanner,
		statsStore: deps.statsStore,
		settings: reglagesPages(),
		saveSettings: () => enregistrerReglagesPages(),
		navigate: (vue, data) => naviguer(vue, data),
		/* PAS d'historique de boutons de souris dans l'application : c'est un
		   confort d'onglet Obsidian, et `recordNav` n'a donc rien à empiler.
		   Le no-op est explicite plutôt qu'absent — les pages l'appellent, et
		   un membre manquant serait une erreur de compilation qui inviterait à
		   retirer l'appel côté page, donc à faire diverger les deux hôtes. */
		recordNav: () => {},
		openQuiz: (quiz) => deps.onOpenQuiz(quiz),
		openSettings: () => deps.onOpenSettings(),
		canOpen: (vue) => vue !== "ai",
		reviewStore: deps.reviewStore,
		pickIcon: (anchor, courante, onPick, suggestions) => {
			openIconPicker(anchor, courante, onPick, document.body, suggestions ?? []);
		},
		createFolder: (map, quizzes, done) => openCreateFolderModal(ctx, map, quizzes, done),
		renderGroupingSelect: (container, opts) => createSelect(container, opts),
		/* Les MÊMES bâtisseurs que le greffon (`src/dashboard.ts`), sur le
		   même `ctx` : le menu « ⋯ » ne demande que `DashboardShellCtx` depuis
		   la tranche 3 (tâche 9), et c'est l'hôte qui l'OUVRE (`openActionMenu`,
		   portalé au `<body>`) avec le `rerender` de la page qui l'affiche. */
		openCardMenu: (quiz, anchor, rerender) => {
			openActionMenu(anchor, buildQuizCardMenu(ctx, rerender)(quiz));
		},
		openModuleMenu: (group, anchor, rerender, map) => {
			openActionMenu(anchor, buildModuleCardMenu(ctx, rerender, map)(group));
		},
		// « Nouveau quiz » : une note vierge, puis sa page en ÉDITION par
		// `openQuizPath` ci-dessous — l'éditeur existe désormais dans la fenêtre.
		createQuiz: (folder, done) => openCreateQuizModal(ctx, folder, done),
		/* La page d'un quiz PAR CHEMIN, pour une note que le catalogue n'a pas
		   forcément encore. Son seul appelant (`createQuizInFolder`,
		   folder-create.ts) l'appelle juste après `fs.write`, AVANT que le
		   surveillant (débouncé de 300 ms, `host/fs.ts`) n'ait fait indexer la
		   note par le scanner : passer par `scanner.getQuiz(path)` ici rendait
		   `null` une fois sur une. La page, elle, pourrait s'ouvrir aussitôt
		   (`loadQuizDraft` lit l'hôte, dont l'index est recalé à l'écriture —
		   « LA FRAÎCHEUR APRÈS UNE ÉCRITURE », `src/host/types.ts`) ; mais son
		   bouton « Start » et sa rangée de stats exigent une `QuizIndexEntry`.
		   Plutôt que de l'attendre du surveillant ou de la FABRIQUER depuis le
		   brouillon (une seconde façon de calculer `questions`/`quizType`/`items`,
		   qui divergerait du scanner), on demande au scanner d'indexer CE
		   fichier maintenant : `scanFile` est son chemin incrémental normal,
		   celui que le surveillant emprunte, et le `HostFile` frais vient de
		   `getFile`. L'évènement `create` qui arrivera ensuite retrouvera une
		   entrée identique et ne notifiera rien (comparaison hors `mtime`).
		   Mêmes Notices que le greffon (`openQuizPathInEditor`). */
		openQuizPath: async (path, opts) => {
			const file = currentHost().fs.getFile(path);
			if (!file) { currentHost().ui.notice(t("dashboard.detail.fileNotFound")); return; }
			await deps.scanner.scanFile(file);
			const entry = deps.scanner.getQuiz(path);
			if (!entry) { currentHost().ui.notice(t("dashboard.detail.noBlockInNote")); return; }
			naviguer("detail", { quiz: entry, edit: opts?.edit });
		},
		/* shareQuiz, renameQuiz : ABSENTS À DESSEIN, et le menu « ⋯ » de la
		   fenêtre a donc DEUX entrées (Éditer, Supprimer) là où le greffon en
		   a quatre. `share.ts` livre par `child_process`/`electron.shell`, hors
		   du contrat (spec §7 : hors chantier). `renameQuiz` exige de réécrire
		   les wikilinks ENTRANTS ([[ancien nom]]), ce que seul l'index de liens
		   d'Obsidian sait faire (`fileManager.renameFile`) ; le poser sur
		   `HostFs.rename` déplacerait la note et casserait ces liens EN
		   SILENCE — une entrée absente vaut mieux qu'une entrée qui ment
		   (`types/dashboard-ctx.ts`). Les deux restent optionnels côté
		   `DashboardShellCtx` pour que cette absence soit un état PRÉVU, pas
		   une erreur de compilation. */
	};

	const nav = createNavHandlers(ctx);
	const home = createHomeHandlers(ctx);
	const quizzes = createQuizzesHandlers(ctx);
	const detail = createDetailHandlers(ctx);

	/** Demande « ouvrir en édition » posée par `naviguer("detail", { edit })`
	    et consommée par le prochain `peindre()` — une seule fois, le mode
	    appartient ensuite à l'utilisateur (`pendingEdit` du greffon). Locale
	    au montage : elle est toujours consommée dans le même tour. */
	let editionEnAttente = false;

	/** Redessine la page COURANTE. Appelée à la navigation (entrée réelle) et
	    par le scanner (simple rafraîchissement) — dans les deux cas le calcul
	    d'`entering` est le même : vrai seulement si la vue diffère de la
	    dernière peinte. */
	function peindre(): void {
		contentEl.replaceChildren();
		const entering = vueCourante !== dernierePeinte;
		dernierePeinte = vueCourante;
		switch (vueCourante) {
			case "quizzes":
				// Pas de paramètre `entering` : `quizzes.ts` gère sa propre
				// transition d'entrée, calée sur son état de drill-down interne
				// (voir `createQuizzesHandlers`), pas sur celui de la coquille.
				quizzes.render(contentEl);
				break;
			case "detail": {
				const quiz = quizSelectionne;
				if (!quiz) {
					// Vue persistée sans quiz (ne devrait pas arriver : `naviguer`
					// les pose ensemble) : l'accueil plutôt qu'un contenu vide.
					vueCourante = "home";
					nav.setActive("home");
					home.render(contentEl, entering);
					break;
				}
				const edit = editionEnAttente;
				editionEnAttente = false;
				/* La cible du retour est FIXÉE à l'arrivée sur la page, comme
				   sous Obsidian (`dashboard.ts`, `case "detail"`) : lue au clic,
				   elle aurait pu être écrasée entre-temps. */
				const cible = vuePrecedente;
				detail.render(contentEl, quiz, {
					startEditing: edit,
					onBack: () => {
						naviguer(cible);
						// Retour vers « Mes quiz » : le DOSSIER du quiz, pas la
						// grille racine — `naviguer` vient de refermer le drill
						// (`resetDrilldown`), d'où la réouverture, sur l'instance
						// de `quizzes` restée vivante (même geste que le greffon).
						if (cible === "quizzes") quizzes.openFolderOfQuiz(quiz.path);
					},
					isStale: () => vueCourante !== "detail",
				});
				break;
			}
			case "home":
			default:
				// Repli défensif : `naviguer` n'assigne jamais `vueCourante` à
				// "ai" (voir plus bas) — ce `default` ne devrait donc jamais
				// s'exécuter, mais un rendu de secours vaut mieux qu'un contenu
				// vide si un futur appelant l'atteignait quand même.
				home.render(contentEl, entering);
				break;
		}
	}

	/**
	 * Route un changement de vue demandé par une page (rail, carte, bouton).
	 *
	 * - `"detail"` : la page d'un quiz (`detail.ts`, la même que sous Obsidian),
	 *   demandée par une carte (`home.ts`, `quizzes-render.ts`), l'entrée
	 *   « Éditer » du menu « ⋯ » (`edit: true`) ou `openQuizPath` après
	 *   « Nouveau quiz ». Avant la tranche 3 ce cas court-circuitait vers
	 *   `deps.onOpenQuiz` (jouer), faute d'éditeur portable ; JOUER est
	 *   désormais le bouton « Start » de cette page, par `ctx.openQuiz`.
	 *   Sans quiz dans `data`, rien ne se passe — il n'y a pas de page à
	 *   montrer, et le greffon garde alors son `selectedQuiz` précédent, ce qui
	 *   afficherait ICI un quiz que l'utilisateur n'a pas demandé.
	 * - `"ai"` : le bouton « Générer » de l'accueil (CTA d'en-tête ET
	 *   onboarding) appelle `ctx.navigate("ai")` SANS jamais consulter
	 *   `ctx.canOpen` — `canOpen` ne gouverne que l'état du rail (grisé,
	 *   inatteignable au clic natif d'un `<button disabled>`), pas les CTA
	 *   internes des pages. La génération est la tranche 4 : tant qu'aucune
	 *   page « ai » n'existe, la coquille doit refuser elle-même la
	 *   navigation plutôt que de peindre un contenu vide ou un mauvais repli.
	 *   Réutiliser `ctx.canOpen` ici plutôt qu'une liste séparée garde une
	 *   SEULE source de vérité entre le rail et le routeur.
	 */
	function naviguer(vue: DashboardViewName, data?: { quiz?: QuizIndexEntry; edit?: boolean }): void {
		if (vue === "detail") {
			if (!data?.quiz) return;
			quizSelectionne = data.quiz;
			editionEnAttente = !!data.edit;
			if (vueCourante !== "detail") vuePrecedente = vueCourante;
			vueCourante = "detail";
			// Aucun bouton du rail ne porte "detail" : `setActive` éteint donc
			// la carte active, comme sous Obsidian.
			nav.setActive("detail");
			peindre();
			return;
		}
		if (!ctx.canOpen(vue)) return;
		// Même refermeture qu'au greffon (dashboard.ts, navigate()) : entrer
		// dans un module puis revenir par le rail doit rouvrir la GRILLE, pas
		// le module laissé ouvert.
		if (vue === "quizzes") quizzes.resetDrilldown();
		vueCourante = vue;
		nav.setActive(vue);
		peindre();
	}

	nav.render(navEl);
	// Synchronise le rail sur la vue persistée (retour d'un quiz sur « Mes
	// quiz », par exemple) : `createNavHandlers` démarre chaque fois avec son
	// propre `activeNav` interne à "home".
	nav.setActive(vueCourante);
	peindre();

	// Redessine la page courante à chaque changement du catalogue — `entering:
	// false` via `peindre()` (dernierePeinte déjà à jour) : un re-render du
	// scanner ne doit pas rejouer la transition d'entrée, sinon la page
	// clignote à chaque sauvegarde de note.
	// SAUF la page d'un quiz (même exclusion que le greffon) : elle ÉCRIT dans
	// la note, donc réveille le scanner, et se ferait repeindre sous les
	// doigts à chaque frappe — brouillon et mode d'édition perdus.
	const desabonner = deps.scanner.onChange(() => { if (vueCourante !== "detail") peindre(); });

	/* Le retour DÉSABONNE, et l'appelant DOIT l'invoquer avant tout
	   remontage — même contrat que `renderSettings`/`openQuizPage` : sans lui,
	   chaque aller-retour empilerait un abonnement de plus, et une
	   modification de note redessinerait la page courante autant de fois
	   qu'elle a été montée.
	   Il DÉMONTE aussi la page d'un quiz (`detail.dispose()`) : elle tient une
	   écoute clavier sur le `document` et, peut-être, une écriture en attente
	   — l'oublier fuyait une instance par ouverture. Le démontage est fait
	   avant le premier `await` ; seule l'écriture est attendue. Idempotent :
	   un second appel rend une promesse déjà résolue. */
	let demonte: Promise<void> | null = null;
	return () => {
		if (demonte) return demonte;
		desabonner();
		demonte = detail.dispose();
		return demonte;
	};
}
