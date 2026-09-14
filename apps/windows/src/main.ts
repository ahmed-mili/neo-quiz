import "../../../src/assets/css/index.css";
import "./theme/host-vars.css";
import "./assets/toast.css";
import "./assets/shell.css";
import "./assets/modal.css";
import { setLanguage, t } from "../../../src/i18n";
import { chargerLangue } from "./ui/langue";
import { LOG_PREFIX } from "../../../src/branding";
import { createScanner } from "../../../src/dashboard/scanner";
import type { QuizIndexEntry, Scanner } from "../../../src/dashboard/scanner";
import { currentHost, installHost } from "../../../src/host/current";
import { createWindowsHost, createWindowsIndex, creerCarteRacines } from "./host";
import type { RacineOuverte } from "./host";
import { pont } from "./host/pont";
import { chargerExamDates, estVaultObsidian, savedFolders } from "./host/folder";
import type { ReviewStore } from "../../../src/review/review-store";
import type { StatsStore } from "../../../src/dashboard/stats-store";
import { creerJournalApp } from "./review/store";
import { creerStatsApp } from "./review/stats";
import { createRenameDetector } from "../../../src/review/rename-match";
import { chargerReglagesPages, monterDashboard, reprendre } from "./ui/dashboard-shell";
import { chargerReprise } from "./ui/reprise";
import { aiSettingsDefaults } from "../../../src/dashboard/ai-settings-host";
import type { AiSettingsHost } from "../../../src/dashboard/ai-settings-host";
import type { AiSettings } from "../../../src/types/dashboard-ctx";
import { CLE_REGLAGES_IA } from "../electron/pont";
import { openQuizPage } from "./ui/quiz-page";
import { renderSettings } from "./ui/settings";
import { monterBarreTitre } from "./ui/barre-titre";
import { appliquerFond, fondSuivant } from "./ui/fond";

/*
 * Démarrage de l'application.
 *
 * L'ordre des imports CSS compte : `host-vars.css` définit les variables
 * qu'Obsidian fournissait, il doit donc venir APRÈS l'arbre partagé pour que
 * ses valeurs gagnent à égalité de spécificité. Les feuilles propres à
 * l'application viennent ensuite, et c'est le SEUL endroit qui les importe :
 * ni `src/host/ui.ts` (toasts) ni `src/host/modal.ts` (modales) ne doivent
 * importer de CSS, sans quoi le harnais de `npm run check:windows-host` ne
 * peut plus les charger (les fontes MathLive n'y ont pas de chargeur).
 */
/**
 * Le démontage de l'écran actuellement affiché, ou `null` si rien n'est monté.
 *
 * UNE seule variable, au niveau du module : chaque montage appelle d'abord
 * celui du précédent. Sans ça, chaque aller-retour vers un quiz empilerait un
 * abonnement au scanner de plus, et une modification de note redessinerait la
 * liste autant de fois qu'elle a été ouverte. C'est le pendant du
 * `destroyQuiz()` du greffon.
 *
 * Il peut rendre une PROMESSE (la coquille du tableau de bord, dont la page
 * d'un quiz tient peut-être une écriture en attente) : le démontage lui-même
 * est synchrone, seule l'écriture est à attendre. Un changement d'écran ne
 * l'attend pas (`demonter()`, `void`) ; la fermeture de la fenêtre, si
 * (`onCloseRequested`, plus bas).
 */
let demonterCourant: (() => void | Promise<void>) | null = null;

/**
 * L'entrée « Réglages… » du menu d'application (et `Ctrl+,`) : ouvre la page
 * Réglages une fois la coquille montée. La barre est montée UNE FOIS, avant
 * le premier écran (voir `demarrer`) : elle ne peut donc pas fermer
 * directement sur `root` / `scanner` / `store` / `stats`, qui n'existent pas
 * encore à son montage. `mount` réaffecte cette variable à chaque montage —
 * il n'y a plus qu'un seul écran de départ depuis la tranche 9 (le dossier
 * par défaut supprime l'écran « aucun dossier »).
 */
let ouvrirReglagesCourant: () => void = () => {};

/* ═══ LES RÉGLAGES IA — l'`AiSettingsHost` de l'application ═══

   La page « Générer » (`src/dashboard/ai.ts`) et le client de génération
   lisent leurs réglages par ce seul objet, sous les deux hôtes. Ici : un cache
   en mémoire, hydraté UNE FOIS au démarrage (`chargerReglagesIa`) sur la clé
   `CLE_REGLAGES_IA` de `neo.reglages` — la MÊME clé que le principal relit
   pour admettre l'hôte d'Ollama (`electron/main.ts`), d'où l'import depuis
   `pont.ts` plutôt qu'un littéral « ai » recopié. Les défauts sont ceux du
   greffon (`aiSettingsDefaults`, une seule liste pour les deux hôtes).

   `save` FUSIONNE dans le cache PUIS écrit l'objet entier : le principal GARDE
   cette clé (`garderReglagesIa`, `canaux.ts`) et peut REFUSER l'écriture (URL
   illisible, hôte refusé par l'utilisateur). Le refus rejette ici, et le cache
   est alors REMIS à ce qu'il était : sans ça, la page afficherait un réglage
   que le disque n'a pas — et qu'un redémarrage ferait disparaître sans un mot.
   `get` rend l'objet lui-même, jamais une copie : le client lit le fournisseur
   au moment où la génération part. */
let reglagesIaCache: AiSettings = aiSettingsDefaults();

async function chargerReglagesIa(): Promise<void> {
	const lu = await pont().reglages.lire(CLE_REGLAGES_IA);
	const persiste = lu && typeof lu === "object" && !Array.isArray(lu) ? (lu as Partial<AiSettings>) : {};
	reglagesIaCache = { ...aiSettingsDefaults(), ...persiste };
}

const reglagesIa: AiSettingsHost = {
	get: () => reglagesIaCache,
	save: async (patch) => {
		const avant: AiSettings = { ...reglagesIaCache };
		Object.assign(reglagesIaCache, patch);
		try {
			await pont().reglages.ecrire(CLE_REGLAGES_IA, reglagesIaCache);
		} catch (e) {
			reglagesIaCache = avant;
			currentHost().ui.notice(t("app.aiSettings.refused", { error: e instanceof Error ? e.message : String(e) }));
			throw e;
		}
	},
};

/** Démonte l'écran courant et rend ce qu'il reste à attendre (l'écriture en
    attente de la page d'un quiz), ou rien. `demonterCourant` est remis à
    `null` AVANT de rendre : un second appel pendant l'attente ne démonte pas
    deux fois. */
function demonter(): Promise<void> | void {
	const d = demonterCourant;
	demonterCourant = null;
	return d?.();
}

/* `document.createElement`, jamais les extensions DOM d'Obsidian (`createEl`,
   `createDiv`, `empty`) : elles n'existent pas dans la fenêtre de l'app. */
export function mount(root: HTMLElement, scanner: Scanner, store: ReviewStore, stats: StatsStore): void {
	void demonter();
	root.textContent = "";
	ouvrirReglagesCourant = () => ouvrirReglages(root, scanner, store, stats);
	demonterCourant = monterDashboard(root, {
		scanner,
		statsStore: stats,
		reviewStore: store,
		aiSettings: reglagesIa,
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
	void demonter();
	root.textContent = "";
	demonterCourant = renderSettings(root, {
		scanner,
		aiSettings: reglagesIa,
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
 * JOUER un quiz (le moteur) : démonter la coquille, monter la page du moteur ;
 * au retour, démonter le moteur et remonter la coquille — qui revient sur la
 * vue d'où l'on est parti, la page du quiz comprise (`dashboard-shell.ts`,
 * `vueCourante`/`quizSelectionne`). TOUJOURS par `demonterCourant`, appelé
 * AVANT chaque changement d'écran. La page d'un quiz (consultation, édition),
 * elle, n'est PAS un écran de `main.ts` : c'est une vue de la coquille.
 *
 * L'affectation de `demonterCourant` se fait APRÈS l'`await` — `openQuizPage`
 * lit le fichier avant de rendre — mais le démontage de la liste, lui, a lieu
 * AVANT : entre les deux, `demonterCourant` vaut `null`, et un second clic ne
 * démonterait rien deux fois. C'est aussi pourquoi la page fait elle-même son
 * `root.replaceChildren()` en entrée.
 */
async function ouvrirQuiz(root: HTMLElement, scanner: Scanner, store: ReviewStore, stats: StatsStore, entry: QuizIndexEntry): Promise<void> {
	void demonter();
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

async function demarrer(): Promise<void> {
	const root = document.getElementById("neo-quiz-root");
	if (!root) throw new Error("#neo-quiz-root introuvable");
	/* Le réglage `language` : « auto » (la langue de l'hôte, sinon celle du
	   navigateur), ou la langue choisie — dans la page Réglages, ou par le
	   bootstrapper d'installation d'après la page du site d'où l'exe a été
	   téléchargé. Lu AVANT le premier `t()`. */
	setLanguage(await chargerLangue());
	document.title = t("app.window.title");
	/* Montée UNE FOIS, avant le premier écran : elle survit à tous les
	   changements d'écran qui suivent (coquille, réglages), qui eux se
	   démontent et se remontent par `demonterCourant`. */
	monterBarreTitre(document.body, {
		ouvrirReglages: () => ouvrirReglagesCourant(),
		fondSuivant: () => { void fondSuivant(); },
	});
	/* Le dossier du fond est DÉJÀ admis au périmètre par le principal
	   (`perimetreInitial`, avant l'ouverture de la fenêtre) : le rendu n'a
	   qu'à poser l'image, sans attendre les dossiers de quiz ci-dessous. */
	await appliquerFond();
	try {
		const dossiers = await savedFolders();
		/* `dossiers` contient TOUJOURS au moins le dossier par défaut
		   (tranche 9) : `savedFolders()` le pose devant à chaque lecture. Il
		   n'y a donc plus d'écran « aucun dossier » à monter ici. */
		/* Les dossiers persistés sont DÉJÀ au périmètre du processus principal,
		   qui a lu la clé `folders` avant d'ouvrir la fenêtre — il n'y a plus
		   rien à « ouvrir » d'ici. Reste la détection de vault, qui décide où
		   vont les résultats de CE dossier : dans un vault, à l'endroit où le
		   greffon les écrit déjà, pour que les deux hôtes n'aient pas chacun
		   leur moitié. Un dossier disparu (clé USB retirée, dossier supprimé)
		   ne doit pas empêcher les autres de s'ouvrir — d'où le `catch` par
		   dossier plutôt qu'un `Promise.all` qui rejetterait en bloc. */
		const ouvertes: RacineOuverte[] = [];
		for (const d of dossiers) {
			try {
				ouvertes.push({ ...d, vault: await estVaultObsidian(d.path) });
			} catch (e) {
				console.warn(LOG_PREFIX, "dossier inaccessible, ignoré:", d.path, e);
			}
		}
		/* Plus d'écran de repli ici (`mountSansDossier` a disparu, tranche 9) :
		   le dossier par défaut est créé par le principal AVANT l'ouverture de
		   la fenêtre, `estVaultObsidian` ne jette jamais (elle rend `false`
		   sur une erreur — voir son propre `catch`), donc `ouvertes` ne peut
		   être vide qu'un instant entre la suppression du disque du dossier
		   par défaut et son prochain démarrage, un cas qu'aucun écran ne
		   protège mieux qu'une coquille simplement vide. */
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
		/* Idem pour les réglages IA : la page « Générer » lit le fournisseur et
		   le modèle de la session précédente dès son premier rendu. */
		await chargerReglagesIa();
		const store = await creerJournalApp(currentHost(), scanner);
		/* Les STATISTIQUES par quiz : à côté du journal, mais un système
		   distinct (spec de l'ordonnanceur §9.1 — voir `review/stats.ts`).
		   Construit ici et non dans `creerJournalApp` : les deux stores
		   n'ont rien en commun, mélanger leur construction les lierait pour
		   rien. */
		const stats = await creerStatsApp();
		/* VIDER LES TAMPONS D'ÉCRITURE AVANT DE PARTIR. Trois écrivains différés
		   vivent ici : `store` (journal de révision, 500 ms, `log-file.ts`),
		   `stats` (même débounce, `dashboard/stats-store.ts`) et la page d'un
		   quiz (600 ms, `dashboard/detail.ts`), tenue par l'écran courant.
		   Deux sorties, deux mécanismes, parce qu'aucun ne couvre les deux :

		   1. FERMETURE DE LA FENÊTRE (croix, Alt+F4, barre des tâches) :
		      `neo.fenetre.surFermeture`. Le processus principal intercepte le
		      `close` de la `BrowserWindow`, POUSSE l'appel vers le rendu et
		      attend sa réponse avant de détruire la fenêtre (`electron/main.ts`),
		      avec un délai de garde — sans lui, un rendu figé rendrait la
		      fenêtre INFERMABLE, le piège exact rencontré côté Tauri. L'ARMEMENT
		      lui-même est attendu (`await`) : une fermeture survenue avant que le
		      principal ne sache qu'un rappel existe n'attendrait rien. C'est le
		      seul chemin qui sache ATTENDRE une écriture : la page d'un quiz rend
		      une promesse résolue quand la note est écrite, et sans cette attente
		      fermer juste après une frappe perdait la frappe, sans message.
		      Ce qu'il NE couvre PAS : un `location.reload()`, la fin du
		      processus par le système, et les deux stores, dont `destroy()`
		      LANCE l'écriture sans rendre de promesse (limite antérieure à cette
		      tranche, notée au rapport de la tâche 10 de la TRANCHE 3, celle
		      qui a écrit ce chemin sous Tauri). La valeur définitive du délai de
		      garde a été fixée sur mesure par la tâche 6 de la migration
		      Electron (`DELAI_GARDE_FERMETURE_MS`, `electron/main.ts` — elle
		      était la 5 avant que le renommage d'un dossier ne devienne la
		      tâche 5, Ruling 16).
		   2. RECHARGEMENT (`location.reload()` dans `choisirDossier` /
		      `onFoldersChanged`, depuis la page Réglages) : `beforeunload`, qui
		      ne peut rien attendre — on ne fait que LANCER les écritures au plus
		      tôt. Tolérable ici : ces deux chemins partent de la page Réglages,
		      où la page d'un quiz n'est plus montée (son démontage a déjà lancé
		      son écriture, bien avant que l'utilisateur ait choisi un dossier).
		      Une version synchrone serait pire : elle bloquerait l'interface
		      pour une garantie que le navigateur ne peut pas tenir.

		   Les deux `destroy()` sont idempotents (`detruit`, minuterie annulée) :
		   les appeler des deux côtés ne double aucune écriture. C'est le pendant
		   du `this._reviewStore?.destroy()` de l'`onunload` du greffon. */
		window.addEventListener("beforeunload", () => { store.destroy(); stats.destroy(); });
		await pont().fenetre.surFermeture(async () => {
			try {
				await demonter();
			} catch (e) {
				// Un démontage qui échoue ne doit pas retenir la fenêtre ouverte :
				// on le dit, puis on laisse `destroy()` suivre.
				console.warn(LOG_PREFIX, "démontage incomplet à la fermeture:", e);
			}
			store.destroy();
			stats.destroy();
		});
		/* L'appariement des renommages que le surveillant n'a pas su nommer.
		   BRANCHÉ CÔTÉ APPLICATION SEULEMENT : Obsidian émet un vrai `rename`, que
		   le contrat transmet tel quel — le greffon n'a rien à deviner. */
		const detecteur = createRenameDetector({
			onRename: (from, to) => store.renamed(from, to),
			now: () => Date.now(),
		});
		scanner.onChange(quizzes => detecteur.observer(quizzes));
		/* ROUVRIR LÀ OÙ ON S'ÉTAIT ARRÊTÉ : posé sur la coquille AVANT son
		   premier montage — `reprendre` échoue silencieusement (quiz supprimé
		   entre deux lancements) et laisse alors la coquille sur son défaut
		   ("home"), sans Notice : une note disparue n'est pas une erreur. */
		const reprise = await chargerReprise();
		if (reprise.actif && reprise.vue) reprendre(reprise.vue, scanner);
		mount(root, scanner, store, stats);
	} catch (e) {
		root.textContent = t("app.error.startup", { error: e instanceof Error ? e.message : String(e) });
	}
}

void demarrer();
