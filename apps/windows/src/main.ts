import "../../../src/assets/css/index.css";
import "./theme/host-vars.css";
import "./assets/toast.css";
import "./assets/shell.css";
import { setLanguage, t } from "../../../src/i18n";
import { ajouter } from "../../../src/dom";
import { createScanner } from "../../../src/dashboard/scanner";
import type { QuizIndexEntry, Scanner } from "../../../src/dashboard/scanner";
import { currentHost, installHost } from "../../../src/host/current";
import { createWindowsHost, createWindowsIndex } from "./host";
import { poserIcone } from "./host/ui";
import { allowFolder, pickFolder, saveFolder, savedFolder } from "./host/folder";
import { renderList } from "./ui/list";
import { openQuizPage } from "./ui/quiz-page";

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
export function mount(root: HTMLElement, scanner: Scanner): void {
	demonterCourant?.();
	demonterCourant = null;
	root.textContent = "";
	demonterCourant = renderList(root, {
		scanner,
		onOpen: (entry) => { void ouvrirQuiz(root, scanner, entry); },
		onChangeFolder: () => { void changerDossier(); },
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
async function ouvrirQuiz(root: HTMLElement, scanner: Scanner, entry: QuizIndexEntry): Promise<void> {
	demonterCourant?.();
	demonterCourant = null;
	root.textContent = "";
	/* Le démontage rendu par `openQuizPage` appelle `__quizDestroy` : sans lui,
	   chaque aller-retour laisserait vivre une instance de moteur complète
	   (écouteurs document/window, ResizeObserver, timers). C'est le pendant
	   exact de l'`onunload` du MarkdownRenderChild côté greffon. */
	demonterCourant = await openQuizPage(root, entry, () => {
		mount(root, scanner);
	});
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
	await saveFolder(choix);
	await allowFolder(choix);
	location.reload();
	return true;
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

	/* Le bouton reprend la pilule du tableau de bord : deux apparences pour le
	   même geste donneraient deux produits. */
	const bouton = ajouter(ecran, "button", "qbd-btn qbd-btn--create");
	bouton.type = "button";
	poserIcone(ajouter(bouton, "span", "qbd-btn-icon"), "folder-open");
	bouton.appendChild(document.createTextNode(t("app.empty.pickFolder")));

	bouton.addEventListener("click", () => {
		void (async () => {
			bouton.disabled = true;
			try {
				// Annulation : ce n'est pas une erreur, l'écran reste tel quel.
				await changerDossier();
			} catch (e) {
				/* La cause est NOMMÉE, jamais résumée : cet écran est le seul
				   endroit où l'utilisateur peut lire pourquoi le démarrage a
				   échoué. */
				ecran.replaceChildren();
				ajouter(ecran, "p", "nq-accueil-erreur",
					t("app.error.startup", { error: e instanceof Error ? e.message : String(e) }));
			} finally {
				bouton.disabled = false;
			}
		})();
	});
}

async function demarrer(): Promise<void> {
	const root = document.getElementById("neo-quiz-root");
	if (!root) throw new Error("#neo-quiz-root introuvable");
	// « auto » : la langue de l'hôte, sinon celle du navigateur.
	setLanguage("auto");
	document.title = t("app.window.title");
	try {
		const racine = await savedFolder();
		if (!racine) return void mountSansDossier(root);
		/* Les portées natives ne survivent pas au redémarrage : les rouvrir
		   AVANT la première lecture, même sur un dossier déjà persisté. Elles
		   sont DEUX (fichiers et protocole d'asset) — voir `allow_folder` dans
		   `src-tauri/src/lib.rs`. */
		await allowFolder(racine);
		const index = await createWindowsIndex(racine);
		installHost(createWindowsHost(racine, index));
		/* Le scanner PARTAGÉ, sur l'hôte Windows : c'est lui qui décide ce
		   qu'est un quiz, sous Obsidian comme ici. `init()` branche le
		   surveillant PUIS scanne, dans cet ordre — l'inverse manquerait les
		   fichiers modifiés pendant le premier balayage. */
		const scanner = createScanner(currentHost());
		await scanner.init();
		mount(root, scanner);
	} catch (e) {
		root.textContent = t("app.error.startup", { error: e instanceof Error ? e.message : String(e) });
	}
}

void demarrer();
