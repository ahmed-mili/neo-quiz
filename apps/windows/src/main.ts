import "./assets/fonts.css";
import "../../../src/assets/css/index.css";
import "./theme/host-vars.css";
import "./assets/toast.css";
import "./assets/shell.css";
import { setLanguage, t } from "../../../src/i18n";
import { ajouter } from "../../../src/dom";
import { LOG_PREFIX } from "../../../src/branding";
import { createScanner } from "../../../src/dashboard/scanner";
import type { QuizIndexEntry, Scanner } from "../../../src/dashboard/scanner";
import { currentHost, installHost } from "../../../src/host/current";
import { createWindowsHost, createWindowsIndex, creerCarteRacines } from "./host";
import type { RacineOuverte } from "./host";
import { poserIcone } from "./host/ui";
import { poserLogoObsidian } from "./ui/marques";
import { addFolder, allowFolder, chargerExamDates, estVaultObsidian, obsidianVaults, pickFolder, savedFolders } from "./host/folder";
import type { ReviewStore } from "../../../src/review/review-store";
import type { StatsStore } from "../../../src/dashboard/stats-store";
import { creerJournalApp } from "./review/store";
import { creerStatsApp } from "./review/stats";
import { createRenameDetector } from "../../../src/review/rename-match";
import { chargerReglagesPages, monterDashboard } from "./ui/dashboard-shell";
import { openQuizPage } from "./ui/quiz-page";
import { renderSettings } from "./ui/settings";

/*
 * Démarrage de l'application.
 *
 * L'ordre des imports CSS compte : `host-vars.css` définit les variables
 * qu'Obsidian fournissait, il doit donc venir APRÈS l'arbre partagé pour que
 * ses valeurs gagnent à égalité de spécificité. `toast.css` vient en dernier,
 * et c'est le SEUL endroit qui l'importe : `src/host/ui.ts` ne doit importer
 * aucun CSS, sans quoi le harnais de `npm run check:windows-host` ne peut plus
 * le charger (les fontes MathLive n'y ont pas de chargeur).
 */
/**
 * Le démontage de l'écran actuellement affiché, ou `null` si rien n'est monté.
 *
 * UNE seule variable, au niveau du module : chaque montage appelle d'abord
 * celui du précédent. Sans ça, chaque aller-retour vers un quiz empilerait un
 * abonnement au scanner de plus, et une modification de note redessinerait la
 * liste autant de fois qu'elle a été ouverte. C'est le pendant du
 * `destroyQuiz()` du greffon.
 */
let demonterCourant: (() => void) | null = null;

/* `document.createElement`, jamais les extensions DOM d'Obsidian (`createEl`,
   `createDiv`, `empty`) : elles n'existent pas dans la fenêtre de l'app. */
export function mount(root: HTMLElement, scanner: Scanner, store: ReviewStore, stats: StatsStore): void {
	demonterCourant?.();
	demonterCourant = null;
	root.textContent = "";
	demonterCourant = monterDashboard(root, {
		scanner,
		statsStore: stats,
		reviewStore: store,
		onOpenQuiz: (entry) => { void ouvrirQuiz(root, scanner, store, stats, entry); },
		onOpenSettings: () => ouvrirReglages(root, scanner, store, stats),
	});
}

/**
 * La page « Réglages » : démonter la liste, monter la page ; au retour,
 * démonter la page et remonter la liste. La gestion des dossiers y vit
 * désormais tout entière — la liste n'a plus qu'un bouton pour y aller.
 */
function ouvrirReglages(root: HTMLElement, scanner: Scanner, store: ReviewStore, stats: StatsStore): void {
	demonterCourant?.();
	demonterCourant = null;
	root.textContent = "";
	demonterCourant = renderSettings(root, {
		scanner,
		onBack: () => mount(root, scanner, store, stats),
		/* RECHARGER : ajouter ou retirer un dossier change les racines de
		   l'hôte, et l'hôte est installé une seule fois. Un remontage à chaud
		   laisserait vivre l'index et le surveillant de l'ancienne liste. */
		onFoldersChanged: () => location.reload(),
		/* PAS de rechargement ici : `setExamDate` (host/folder.ts) met déjà à
		   jour `datesExamen` EN MÉMOIRE, de façon synchrone. Revenir à la liste
		   appelle `mount()`, qui la reconstruit entièrement — la carte « À
		   réviser » (tâche 11) y relit `store.plan(Date.now())`, qui appelle
		   `horizons()` (donc `examDates()`) À CHAQUE appel : rien à invalider,
		   contrairement à un changement de dossier qui change les racines de
		   l'hôte lui-même. */
		onExamDatesChanged: () => {},
	});
}

/**
 * La page d'un quiz : démonter la liste, monter la page ; au retour, démonter
 * la page et remonter la liste. TOUJOURS par `demonterCourant`, appelé AVANT
 * chaque changement d'écran.
 *
 * L'affectation de `demonterCourant` se fait APRÈS l'`await` — `openQuizPage`
 * lit le fichier avant de rendre — mais le démontage de la liste, lui, a lieu
 * AVANT : entre les deux, `demonterCourant` vaut `null`, et un second clic ne
 * démonterait rien deux fois. C'est aussi pourquoi la page fait elle-même son
 * `root.replaceChildren()` en entrée.
 */
async function ouvrirQuiz(root: HTMLElement, scanner: Scanner, store: ReviewStore, stats: StatsStore, entry: QuizIndexEntry): Promise<void> {
	demonterCourant?.();
	demonterCourant = null;
	root.textContent = "";
	/* Le démontage rendu par `openQuizPage` appelle `__quizDestroy` : sans lui,
	   chaque aller-retour laisserait vivre une instance de moteur complète
	   (écouteurs document/window, ResizeObserver, timers). C'est le pendant
	   exact de l'`onunload` du MarkdownRenderChild côté greffon.
	   `store` ET `stats` PASSÉS TELS QUELS comme puits : `ReviewStore` et
	   `StatsStore` portent déjà exactement la FORME que `openQuizPage`
	   attend — les envelopper dans un objet littéral n'ajouterait rien. */
	demonterCourant = await openQuizPage(root, entry, () => {
		mount(root, scanner, store, stats);
	}, store, stats);
}

/**
 * Choix d'un dossier : sélecteur natif → persistance → portées → rechargement.
 *
 * RECHARGER, et non remonter à chaud : l'hôte est un singleton installé une
 * seule fois (`src/host/current.ts`), et le rechargement est la façon la plus
 * honnête d'en obtenir un neuf — sans quoi il faudrait démonter un surveillant,
 * un index et un scanner déjà branchés. Rend `false` si l'utilisateur annule :
 * ce n'est pas une erreur, c'est la réponse « non ».
 */
async function changerDossier(): Promise<boolean> {
	const choix = await pickFolder();
	if (!choix) return false;
	await choisirDossier(choix);
	return true;
}

/**
 * Retient un dossier et repart dessus.
 *
 * Le rechargement plutôt qu'un remontage à chaud : l'hôte est un singleton
 * installé une seule fois, et repartir de zéro est la façon la plus honnête
 * d'en obtenir un neuf. Un second `installHost` laisserait le premier index et
 * son surveillant vivants, sur l'ancien dossier.
 */
async function choisirDossier(chemin: string): Promise<void> {
	await addFolder(chemin);
	await allowFolder(chemin);
	location.reload();
}

/**
 * Le premier lancement : aucun dossier n'a encore été choisi. Le bouton passe
 * par `changerDossier`, comme celui de la liste — un seul enchaînement.
 */
function mountSansDossier(root: HTMLElement): void {
	demonterCourant?.();
	demonterCourant = null;
	root.textContent = "";

	const ecran = ajouter(root, "div", "nq-accueil");

	/* La TOQUE, seule image de l'écran : c'est la marque de l'icône de
	   l'application. La fenêtre et la vignette de la barre des tâches doivent
	   se reconnaître comme un seul produit.
	   `poserIcone` et NON `currentHost().ui.setIcon` : cet écran s'affiche
	   AVANT qu'un hôte soit installé, et `currentHost()` jette tant qu'il n'y
	   en a pas — ce serait une exception au démarrage, pas une icône. */
	poserIcone(ajouter(ecran, "div", "nq-accueil-marque"), "graduation-cap");

	// t() AU RENDU, jamais dans une constante de module : sinon la langue est
	// figée à celle du démarrage.
	ajouter(ecran, "h1", "nq-accueil-titre", t("app.empty.title"));
	ajouter(ecran, "p", "nq-accueil-texte", t("app.empty.body"));

	/* Les vaults d'Obsidian, s'il y en a : les proposer d'un clic évite de
	   faire naviguer l'utilisateur jusqu'à un dossier qu'il ouvre tous les
	   jours. La liste arrive de façon asynchrone et s'insère AVANT le bouton —
	   l'écran reste utilisable pendant ce temps, le sélecteur natif étant déjà
	   là. Une liste vide est un état NORMAL (pas d'Obsidian sur la machine). */
	const listeVaults = ajouter(ecran, "div", "nq-accueil-vaults");

	const bouton = ajouter(ecran, "button", "qbd-btn qbd-btn--create");
	bouton.type = "button";
	poserIcone(ajouter(bouton, "span", "qbd-btn-icon"), "folder-open");
	bouton.appendChild(document.createTextNode(t("app.empty.pickFolder")));

	function echouer(e: unknown): void {
		/* La cause est NOMMÉE, jamais résumée : cet écran est le seul endroit
		   où l'utilisateur peut lire pourquoi le démarrage a échoué. */
		ecran.replaceChildren();
		ajouter(ecran, "p", "nq-accueil-erreur",
			t("app.error.startup", { error: e instanceof Error ? e.message : String(e) }));
	}

	bouton.addEventListener("click", () => {
		void (async () => {
			bouton.disabled = true;
			try {
				// Annulation : ce n'est pas une erreur, l'écran reste tel quel.
				await changerDossier();
			} catch (e) {
				echouer(e);
			} finally {
				bouton.disabled = false;
			}
		})();
	});

	void (async () => {
		const vaults = await obsidianVaults();
		if (vaults.length === 0) return;
		ajouter(listeVaults, "p", "nq-accueil-vaults-titre", t("app.empty.yourVaults"));
		for (const v of vaults) {
			const ligne = ajouter(listeVaults, "button", "nq-vault");
			ligne.type = "button";
			/* Le LOGO d'Obsidian, pas une icône Lucide : ce que cette image
			   transporte, c'est « ceci est un vault Obsidian » — une icône de
			   dossier dirait seulement « ceci est un dossier ». */
			poserLogoObsidian(ajouter(ligne, "span", "nq-vault-icone"));
			const texte = ajouter(ligne, "span", "nq-vault-texte");
			// `textContent` : un nom de dossier vient du disque de l'utilisateur.
			ajouter(texte, "span", "nq-vault-nom", v.nom);
			ajouter(texte, "span", "nq-vault-chemin", v.chemin);
			ligne.addEventListener("click", () => {
				void (async () => {
					try {
						await choisirDossier(v.chemin);
					} catch (e) {
						echouer(e);
					}
				})();
			});
		}
	})();
}

async function demarrer(): Promise<void> {
	const root = document.getElementById("neo-quiz-root");
	if (!root) throw new Error("#neo-quiz-root introuvable");
	// « auto » : la langue de l'hôte, sinon celle du navigateur.
	setLanguage("auto");
	document.title = t("app.window.title");
	try {
		const dossiers = await savedFolders();
		if (!dossiers.length) return void mountSansDossier(root);
		/* Les portées natives ne survivent pas au redémarrage : les rouvrir
		   AVANT toute lecture, pour CHAQUE dossier. Un dossier disparu (clé USB
		   retirée, dossier supprimé) ne doit pas empêcher les autres de
		   s'ouvrir — d'où le `catch` par dossier plutôt qu'un `Promise.all`
		   qui rejetterait en bloc. */
		const ouvertes: RacineOuverte[] = [];
		for (const d of dossiers) {
			try {
				await allowFolder(d.path);
				/* APRÈS `allowFolder` : sans la portée, la détection échoue. Elle
				   décide où vont les résultats de CE dossier — dans un vault, à
				   l'endroit où le greffon les écrit déjà, pour que les deux hôtes
				   n'aient pas chacun leur moitié. */
				ouvertes.push({ ...d, vault: await estVaultObsidian(d.path) });
			} catch (e) {
				console.warn(LOG_PREFIX, "dossier inaccessible, ignoré:", d.path, e);
			}
		}
		if (!ouvertes.length) return void mountSansDossier(root);
		const carte = creerCarteRacines(ouvertes);
		const index = await createWindowsIndex(carte);
		installHost(createWindowsHost(carte, index));
		/* Le scanner PARTAGÉ, sur l'hôte Windows : c'est lui qui décide ce
		   qu'est un quiz, sous Obsidian comme ici. `init()` branche le
		   surveillant PUIS scanne, dans cet ordre — l'inverse manquerait les
		   fichiers modifiés pendant le premier balayage. */
		const scanner = createScanner(currentHost());
		await scanner.init();
		/* MIGRER D'ABORD, CHARGER ENSUITE (voir `review/store.ts`) : les dates
		   d'examen, elles, n'ont pas cet ordre à respecter — mais les charger
		   avant de monter évite un premier plan calculé sans l'horizon d'une
		   matière déjà saisie lors d'une session précédente. */
		await chargerExamDates();
		/* Même raison que `chargerExamDates` ci-dessus : sans ce chargement,
		   le tout premier montage de la coquille (plus bas) verrait des
		   réglages de page vides (aucun dossier déplié, axe par défaut) au
		   lieu de ceux de la session précédente. */
		await chargerReglagesPages();
		const store = await creerJournalApp(currentHost(), scanner);
		/* Les STATISTIQUES par quiz : à côté du journal, mais un système
		   distinct (spec de l'ordonnanceur §9.1 — voir `review/stats.ts`).
		   Construit ici et non dans `creerJournalApp` : les deux stores
		   n'ont rien en commun, mélanger leur construction les lierait pour
		   rien. */
		const stats = await creerStatsApp();
		/* VIDER LE TAMPON D'ÉCRITURE AVANT DE PARTIR. `store` écrit en différé
		   (500 ms, voir `log-file.ts`) ; sans ce vidage, fermer la fenêtre ou
		   déclencher un `location.reload()` (changement de dossier, dans
		   `choisirDossier` / `onFoldersChanged`) dans les 500 ms qui suivent une
		   réponse perdrait cette réponse — le pendant exact du
		   `this._reviewStore?.destroy()` de l'`onunload` du greffon
		   (`apps/obsidian/plugin.ts`). `beforeunload` couvre LES DEUX sorties à
		   la fois (fermeture ET rechargement) sans dépendance Tauri neuve ;
		   `getCurrentWindow().onCloseRequested` ne couvrirait que la première.
		   LIMITE HONNÊTE, à ne pas dépasser : `destroy()` déclenche un `flush()`
		   asynchrone qu'un gestionnaire `beforeunload` ne peut pas attendre — on
		   ne fait que LANCER l'écriture au plus tôt, jamais garantir qu'elle se
		   termine avant que la page parte réellement. Écrire une version
		   synchrone serait pire : elle bloquerait l'interface pour une garantie
		   que le navigateur ne peut de toute façon pas tenir.
		   `stats` porte le MÊME débounce de 500 ms que `store` (voir
		   `dashboard/stats-store.ts`) : le même risque de perdre la dernière
		   écriture s'il n'était pas vidé ici aussi. */
		window.addEventListener("beforeunload", () => { store.destroy(); stats.destroy(); });
		/* L'appariement des renommages que le surveillant n'a pas su nommer.
		   BRANCHÉ CÔTÉ APPLICATION SEULEMENT : Obsidian émet un vrai `rename`, que
		   le contrat transmet tel quel — le greffon n'a rien à deviner. */
		const detecteur = createRenameDetector({
			onRename: (from, to) => store.renamed(from, to),
			now: () => Date.now(),
		});
		scanner.onChange(quizzes => detecteur.observer(quizzes));
		mount(root, scanner, store, stats);
	} catch (e) {
		root.textContent = t("app.error.startup", { error: e instanceof Error ? e.message : String(e) });
	}
}

void demarrer();
