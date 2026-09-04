import "../../../src/assets/css/index.css";
import "./theme/host-vars.css";
import "./assets/toast.css";
import { setLanguage, t } from "../../../src/i18n";
import { PRODUCT_NAME } from "../../../src/branding";
import { createScanner } from "../../../src/dashboard/scanner";
import type { Scanner } from "../../../src/dashboard/scanner";
import { currentHost, installHost } from "../../../src/host/current";
import { createWindowsHost, createWindowsIndex } from "./host";
import { allowFolder, pickFolder, saveFolder, savedFolder } from "./host/folder";
import { renderList } from "./ui/list";

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
		/* L'OUVERTURE d'un quiz est la tâche 12. Ne rien faire ici est le seul
		   choix honnête : simuler une ouverture afficherait un écran faux. */
		onOpen: () => {},
		onChangeFolder: () => { void changerDossier(); },
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
	root.textContent = "";
	const titre = root.appendChild(document.createElement("h1"));
	titre.textContent = PRODUCT_NAME;
	const vide = root.appendChild(document.createElement("p"));
	// t() AU RENDU, jamais dans une constante de module.
	vide.textContent = t("app.empty.noFolder");
	const bouton = root.appendChild(document.createElement("button"));
	bouton.type = "button";
	bouton.textContent = t("app.empty.pickFolder");
	bouton.addEventListener("click", () => {
		void (async () => {
			bouton.disabled = true;
			try {
				// Annulation : ce n'est pas une erreur, l'écran reste tel quel.
				await changerDossier();
			} catch (e) {
				root.textContent = t("app.error.startup", { error: e instanceof Error ? e.message : String(e) });
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
