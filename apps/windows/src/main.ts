import "../../../src/assets/css/index.css";
import "./theme/host-vars.css";
import "./assets/toast.css";
import { setLanguage, t } from "../../../src/i18n";
import { PRODUCT_NAME } from "../../../src/branding";
import { installHost } from "../../../src/host/current";
import { createWindowsHost, createWindowsIndex } from "./host";
import { allowFolder, pickFolder, saveFolder, savedFolder } from "./host/folder";

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
export function mount(root: HTMLElement, racine?: string): void {
	root.textContent = "";
	/* `document.createElement`, jamais les extensions DOM d'Obsidian
	   (`createEl`, `createDiv`, `empty`) : elles n'existent pas dans la
	   fenêtre de l'app. La mesure a montré que le moteur n'en utilise
	   qu'une seule, `container.empty()` (src/engine.ts:68) — remplacée par
	   `container.replaceChildren()` dans cette tâche. */
	const titre = root.appendChild(document.createElement("h1"));
	// PRODUCT_NAME et non une chaîne : le nom vit à un seul endroit.
	titre.textContent = PRODUCT_NAME;
	const chemin = root.appendChild(document.createElement("p"));
	// Le dossier retenu, tel quel : la LISTE des quiz est la tâche 11, et
	// afficher un chemin faux serait pire que de n'afficher que le vrai.
	chemin.textContent = racine ?? "";
}

/**
 * Le premier lancement : aucun dossier n'a encore été choisi.
 *
 * Le bouton enchaîne choix → persistance → ouverture des portées → rechargement
 * de la fenêtre. RECHARGER, et non remonter à chaud : l'hôte est un singleton
 * installé une seule fois (`src/host/current.ts`), et le rechargement est la
 * façon la plus honnête d'en obtenir un neuf — sans quoi il faudrait démonter
 * un surveillant, un index et un moteur déjà branchés.
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
				const choix = await pickFolder();
				// Annulation : ce n'est pas une erreur, l'écran reste tel quel.
				if (!choix) return;
				await saveFolder(choix);
				await allowFolder(choix);
				location.reload();
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
		mount(root, racine);
	} catch (e) {
		root.textContent = t("app.error.startup", { error: e instanceof Error ? e.message : String(e) });
	}
}

void demarrer();
