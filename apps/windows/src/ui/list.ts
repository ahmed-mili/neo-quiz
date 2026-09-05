/* ══════════════════════════════════════════════════════════
   LA LISTE DES QUIZ DU DOSSIER

   Le scanner est PARTAGÉ (`src/dashboard/scanner.ts`) : c'est LUI qui décide ce
   qu'est un quiz, sous Obsidian comme ici. Écrire une seconde règle de détection
   ferait diverger les deux catalogues sans que personne ne le voie — le nombre
   de quiz doit être identique des deux côtés sur le même dossier.

   Les CLASSES sont celles du tableau de bord (`qbd-quiz-card`,
   `qbd-quiz-card-title`…) : `src/assets/css/dashboard/*.css` est déjà chargé par
   `main.ts`, et deux jeux de classes pour la même carte donneraient deux
   apparences à tenir synchrones. La structure DOM reprend `quiz-card.ts`, sans
   le copier : ce module-là dépend de `DashboardCtx`, que l'app n'a pas.

   Ce module n'importe AUCUN CSS — même contrainte que les modules d'hôte : un
   import de CSS y tire les fontes MathLive, pour lesquelles le harnais des
   scripts de contrôle n'a pas de chargeur.
══════════════════════════════════════════════════════════ */

import type { QuizIndexEntry, QuizTypeTag, Scanner } from "../../../../src/dashboard/scanner";
import { currentLang, t } from "../../../../src/i18n";
import type { TransKey } from "../../../../src/i18n";
import { currentHost } from "../../../../src/host/current";
import { ajouter } from "../../../../src/dom";

/* Tag de type de quiz (calculé au scan) → clé de traduction, résolue au rendu.
   Table explicite plutôt qu'une clé construite par concaténation puis castée :
   `t()` n'accepte qu'une `TransKey` littérale, donc un tag orphelin devient une
   erreur de compilation au lieu d'un libellé manquant à l'écran. Même patron
   que `src/dashboard/quiz-card.ts`. */
const CLES_TYPE: Record<QuizTypeTag, TransKey> = {
	mixed: "dashboard.quizType.mixed",
	single: "dashboard.quizType.single",
	multiple: "dashboard.quizType.multiple",
	text: "dashboard.quizType.text",
	ordering: "dashboard.quizType.ordering",
	matching: "dashboard.quizType.matching",
};


/** Une carte de quiz. AUCUN statut (`--fresh`, `--progress`, `--review`,
    `--mastered`) : ils dérivent des statistiques et du journal de révision, qui
    ne sont pas branchés en tranche 1 — un statut inventé mentirait. */
function carte(grille: HTMLElement, entry: QuizIndexEntry, onOpen: (e: QuizIndexEntry) => void): void {
	const card = ajouter(grille, "div", "qbd-quiz-card qbd-quiz-card--folder");
	card.dataset.path = entry.path;
	const body = ajouter(card, "div", "qbd-quiz-card-body");

	ajouter(body, "p", "qbd-quiz-card-title", entry.title);

	// Le DOSSIER PARENT seul, jamais le chemin complet : le préfixe commun à
	// toutes les cartes n'apprend rien. Racine du dossier → aucune ligne.
	const segments = entry.path.split("/").slice(0, -1).filter(Boolean);
	if (segments.length > 0) {
		const chemin = ajouter(body, "p", "qbd-quiz-card-path");
		ajouter(chemin, "span", undefined, segments[segments.length - 1]);
	}

	const meta = ajouter(body, "div", "qbd-quiz-card-meta");
	/* Clés du domaine `dashboard`, empruntées volontairement : le libellé existe
	   déjà (quiz-card.ts), singulier compris. En créer un second dans `app`
	   afficherait « 1 questions » et donnerait deux traductions du même texte,
	   qui divergeraient à la première retouche. */
	ajouter(meta, "span", "qbd-quiz-card-meta-item", t(
		entry.questions === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther",
		{ count: entry.questions },
	));
	ajouter(meta, "span", "qbd-quiz-card-badge", t(CLES_TYPE[entry.quizType]));

	card.addEventListener("click", () => onOpen(entry));
	// Une carte cliquable doit l'être au clavier : `div` + clic seul serait
	// inatteignable sans souris.
	card.setAttribute("role", "button");
	card.tabIndex = 0;
	card.addEventListener("keydown", (ev: KeyboardEvent) => {
		if (ev.key !== "Enter" && ev.key !== " ") return;
		ev.preventDefault();
		onOpen(entry);
	});
}

export function renderList(
	root: HTMLElement,
	deps: { scanner: Scanner; onOpen(entry: QuizIndexEntry): void; onChangeFolder(): void },
): () => void {
	const contenu = ajouter(root, "div", "qbd-content");

	// ── En-tête : titre + « Changer de dossier » ──
	// `t()` est appelé ICI, au rendu, jamais dans une constante de module : une
	// chaîne traduite au chargement serait figée à la langue du démarrage.
	const entete = ajouter(contenu, "div", "qbd-quizzes-header");
	const blocTitre = ajouter(entete, "div", "qbd-quizzes-title-block");
	ajouter(blocTitre, "h2", "qbd-quizzes-title", t("app.list.title"));
	const actions = ajouter(entete, "div", "qbd-quizzes-header-actions");
	const bouton = ajouter(actions, "button", "qbd-btn--create");
	bouton.type = "button";
	// Icône LUCIDE par l'hôte, jamais d'emoji : même silhouette que le greffon.
	currentHost().ui.setIcon(ajouter(bouton, "span", "qbd-btn-icon"), "folder");
	ajouter(bouton, "span", undefined, t("app.list.changeFolder"));
	bouton.addEventListener("click", () => deps.onChangeFolder());

	const zone = ajouter(contenu, "div", "qbd-quizzes-tree");

	function dessiner(quizzes: QuizIndexEntry[]): void {
		zone.replaceChildren();
		if (quizzes.length === 0) {
			const vide = ajouter(zone, "div", "qbd-empty-state");
			ajouter(vide, "p", undefined, t("app.list.empty"));
			return;
		}
		// Tri par titre dans la langue AFFICHÉE : « é » se classe avec « e » en
		// français, et l'ordre suit ce que l'utilisateur lit.
		const tries = [...quizzes].sort((a, b) => a.title.localeCompare(b.title, currentLang()));
		const grille = ajouter(zone, "div", "qbd-module-grid");
		for (const entry of tries) carte(grille, entry, deps.onOpen);
	}

	const desabonner = deps.scanner.onChange(dessiner);
	dessiner(deps.scanner.getQuizzes());

	/* Le retour DÉSABONNE, et l'appelant DOIT l'appeler avant tout remontage.
	   Sans lui, chaque aller-retour vers un quiz empile un abonnement de plus,
	   et une modification de note redessine la liste autant de fois qu'elle a
	   été ouverte. C'est le pendant du `destroyQuiz()` du greffon. */
	let fait = false;
	return () => {
		if (fait) return;
		fait = true;
		desabonner();
	};
}
