import "../../../src/assets/css/index.css";
import "./theme/host-vars.css";
import { setLanguage, t } from "../../../src/i18n";
import { PRODUCT_NAME } from "../../../src/branding";

/*
 * Démarrage de l'application. Il n'installe PAS encore d'hôte : le mode
 * « auto » de la langue retombe sur `navigator.language` tant qu'aucun hôte
 * n'est là (src/i18n.ts, detectHostLang), ce qui suffit pour cette tâche.
 * L'hôte Windows arrive à la tâche 10.
 *
 * L'ordre des deux imports CSS compte : `host-vars.css` définit les variables
 * qu'Obsidian fournissait, il doit donc venir APRÈS l'arbre partagé pour que
 * ses valeurs gagnent à égalité de spécificité.
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
	const vide = root.appendChild(document.createElement("p"));
	// t() AU RENDU, jamais dans une constante de module.
	vide.textContent = t("app.empty.noFolder");
}

function demarrer(): void {
	const root = document.getElementById("neo-quiz-root");
	if (!root) throw new Error("#neo-quiz-root introuvable");
	// « auto » : la langue de l'hôte, sinon celle du navigateur.
	setLanguage("auto");
	document.title = t("app.window.title");
	try {
		mount(root);
	} catch (e) {
		root.textContent = t("app.error.startup", { error: e instanceof Error ? e.message : String(e) });
	}
}

demarrer();
