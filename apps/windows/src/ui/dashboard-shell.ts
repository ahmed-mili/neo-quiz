/* ══════════════════════════════════════════════════════════
   LA COQUILLE DU TABLEAU DE BORD, CÔTÉ APPLICATION

   Sous Obsidian, `src/dashboard.ts` est un `ItemView` : il porte le cycle de
   vie d'un onglet, un `Scope` de raccourcis, l'historique des boutons de
   souris. Rien de tout cela n'est portable — et rien de tout cela n'est
   l'interface. Ce fichier fait les trois choses que `dashboard.ts` fait et
   qui comptent : monter le rail, router entre les pages, assembler le `ctx`.

   Les PAGES, elles, sont les mêmes qu'Obsidian : `src/dashboard/nav.ts`,
   `home.ts`, `quizzes.ts`. Une copie divergerait, et les deux tableaux de
   bord finiraient par compter différemment.

   Ce module n'importe AUCUN CSS — même contrainte que les modules d'hôte :
   un import de CSS y tire les fontes MathLive, pour lesquelles le harnais
   des scripts de contrôle n'a pas de chargeur. Les classes (`qbd-layout`,
   `qbd-sidebar`, `qbd-content`…) viennent de `src/assets/css/`, déjà chargé
   par `main.ts`.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../../../../src/dom";
import { createNavHandlers } from "../../../../src/dashboard/nav";
import { createHomeHandlers } from "../../../../src/dashboard/home";
import { createQuizzesHandlers } from "../../../../src/dashboard/quizzes";
import type { DashboardPageSettings, DashboardShellCtx, DashboardViewName } from "../../../../src/types/dashboard-ctx";
import type { QuizIndexEntry, Scanner } from "../../../../src/dashboard/scanner";
import type { StatsStore } from "../../../../src/dashboard/stats-store";
import type { ReviewStore } from "../../../../src/review/review-store";
import type { ModuleOverride } from "../../../../src/dashboard/quiz-modules";
import { reglagesStore } from "../host/folder";

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
	const store = await reglagesStore();
	reglagesPagesCache = {
		quizzesExpandedFolders: (await store.get<string[]>("quizzesExpandedFolders")) ?? undefined,
		quizzesGrouping: (await store.get<string>("quizzesGrouping")) ?? undefined,
		quizzesModuleOverrides: (await store.get<Record<string, ModuleOverride>>("quizzesModuleOverrides")) ?? undefined,
		quizzesModuleMapNote: (await store.get<string>("quizzesModuleMapNote")) ?? undefined,
		quizzesArchivedFolders: (await store.get<string[]>("quizzesArchivedFolders")) ?? undefined,
	};
	return reglagesPagesCache;
}

function reglagesPages(): DashboardPageSettings {
	return reglagesPagesCache;
}

async function enregistrerReglagesPages(): Promise<void> {
	const store = await reglagesStore();
	// `?? null`/`?? []` : un réglage effacé par la page (retour à « aucun »)
	// doit s'écrire comme tel, jamais laisser une ancienne valeur trainer.
	await store.set("quizzesExpandedFolders", reglagesPagesCache.quizzesExpandedFolders ?? []);
	await store.set("quizzesGrouping", reglagesPagesCache.quizzesGrouping ?? null);
	await store.set("quizzesModuleOverrides", reglagesPagesCache.quizzesModuleOverrides ?? {});
	await store.set("quizzesModuleMapNote", reglagesPagesCache.quizzesModuleMapNote ?? null);
	await store.set("quizzesArchivedFolders", reglagesPagesCache.quizzesArchivedFolders ?? []);
	await store.save();
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
 */
export function monterDashboard(root: HTMLElement, deps: MonterDashboardDeps): () => void {
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
		/* openCardMenu, openModuleMenu, pickIcon, createQuiz, createFolder,
		   renderGroupingSelect : ABSENTS À DESSEIN. Ce sont tous des menus,
		   modals ou dropdowns (tranche 2.6) qui exigent soit le `DashboardCtx`
		   complet du greffon (menus ⋯), soit `ui-select.ts` (le sélecteur
		   d'axe), qui importe encore Obsidian — la contrainte D5 du plan
		   l'exclut explicitement de cette tranche. Chaque membre est optionnel
		   côté `DashboardShellCtx` précisément pour que cette absence soit un
		   état PRÉVU (pas de « ⋯ », pas de « + Nouveau dossier », axe déjà
		   persisté mais sans sélecteur pour le changer) plutôt qu'une erreur
		   de compilation. */
	};

	const nav = createNavHandlers(ctx);
	const home = createHomeHandlers(ctx);
	const quizzes = createQuizzesHandlers(ctx);

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
			case "home":
			default:
				// Repli défensif : `naviguer` n'assigne jamais `vueCourante` à
				// "detail" ou "ai" (voir plus bas) — ce `default` ne devrait
				// donc jamais s'exécuter, mais un rendu de secours vaut mieux
				// qu'un contenu vide si un futur appelant l'atteignait quand
				// même.
				home.render(contentEl, entering);
				break;
		}
	}

	/**
	 * Route un changement de vue demandé par une page (rail, carte, bouton).
	 *
	 * Deux cas que le brief d'origine ne couvrait pas, et qui casseraient
	 * silencieusement sans ce garde-fou (erreur de plan, corrigée ici) :
	 *
	 * - `"detail"` : `home.ts` (carte de quiz, héros « Reprendre ») appelle
	 *   `ctx.navigate("detail", { quiz })` au clic sur une carte — l'ancienne
	 *   page « détail » du greffon (questions à gauche, édition à droite)
	 *   dépend du `DashboardCtx` complet (app, plugin, menus…) et n'a pas
	 *   d'équivalent ici. Le plus proche que l'application sache faire est
	 *   JOUER ce quiz, exactement ce que fait déjà son bouton lecture — sans
	 *   ce cas, le clic sur une carte serait silencieusement mort.
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
			if (data?.quiz) deps.onOpenQuiz(data.quiz);
			return;
		}
		if (!ctx.canOpen(vue)) return;
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
	const desabonner = deps.scanner.onChange(() => peindre());

	/* Le retour DÉSABONNE, et l'appelant DOIT l'invoquer avant tout
	   remontage — même contrat que `renderList`/`openQuizPage` : sans lui,
	   chaque aller-retour empilerait un abonnement de plus, et une
	   modification de note redessinerait la page courante autant de fois
	   qu'elle a été montée. */
	let demonte = false;
	return () => {
		if (demonte) return;
		demonte = true;
		desabonner();
	};
}
