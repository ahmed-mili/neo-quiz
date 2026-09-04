/* ══════════════════════════════════════════════════════════
   LA PAGE D'UN QUIZ

   Elle lit la note, en extrait le PREMIER bloc `quiz-blocks` et le donne au
   moteur PARTAGÉ. Le moteur est IDENTIQUE à celui du greffon : c'est tout
   l'objet du contrat d'hôte. Rien ici ne connaît Obsidian, et rien ici ne
   réimplémente le rendu — un second rendu divergerait du premier sans que
   personne ne le voie.

   Le PREMIER bloc seulement : c'est exactement la limite du scanner
   (`extractQuizSource`, même `QUIZ_BLOCK_RE`), mesurée et connue
   (`npm run report:multiblock`), pas un oubli. Jouer ici le deuxième bloc
   d'une note ferait diverger la page du catalogue qui l'a listée.

   Les CLASSES sont celles de la page d'un quiz du tableau de bord
   (`qbd-qz-header`, `qbd-quizzes-crumb-back`…) : `src/assets/css/` est déjà
   chargé par `main.ts`, et la feuille dit elle-même « un seul bouton retour ».
   Ce module n'importe AUCUN CSS — même contrainte que les modules d'hôte : un
   import de CSS y tire les fontes MathLive, pour lesquelles le harnais des
   scripts de contrôle n'a pas de chargeur.
══════════════════════════════════════════════════════════ */

import { LOG_PREFIX } from "../../../../src/branding";
import type { QuizIndexEntry } from "../../../../src/dashboard/scanner";
import { renderInteractiveQuiz } from "../../../../src/engine";
import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { parseQuizSource, QUIZ_BLOCK_RE } from "../../../../src/quiz-utils";

/** `document.createElement`, jamais `createDiv`/`createEl` : les extensions DOM
    d'Obsidian n'existent pas dans la fenêtre de l'application. Et `textContent`,
    jamais `innerHTML` : le titre et le chemin viennent du disque de
    l'utilisateur — une note nommée « <img src=x onerror=…>.md » exécuterait son
    code avec les droits de la fenêtre. */
function creer<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	cls?: string,
	texte?: string,
): HTMLElementTagNameMap[K] {
	const el = parent.appendChild(document.createElement(tag));
	if (cls) el.className = cls;
	if (texte !== undefined) el.textContent = texte;
	return el;
}

/**
 * Ouvre la page d'un quiz dans `root` et rend son DÉMONTAGE.
 *
 * Le retour DOIT être appelé avant tout autre montage : il détruit l'instance
 * du moteur. Voir le commentaire de `__quizDestroy` plus bas.
 */
export async function openQuizPage(
	root: HTMLElement,
	entry: QuizIndexEntry,
	onBack: () => void,
): Promise<() => void> {
	root.replaceChildren();
	const contenu = creer(root, "div", "qbd-content qbd-qz");

	// ── En-tête : retour · titre · chemin ──
	// `t()` est appelé ICI, au rendu, jamais dans une constante de module : une
	// chaîne traduite au chargement serait figée à la langue du démarrage.
	const entete = creer(contenu, "div", "qbd-qz-header");
	const retour = creer(entete, "button", "qbd-quizzes-crumb-back qbd-qz-back");
	retour.type = "button";
	/* Clé du domaine `dashboard`, empruntée volontairement : « dashboard.quiz.back »
	   est le libellé du MÊME bouton retour côté greffon (et la feuille de style dit
	   « un seul bouton retour »). En créer un second dans `app` donnerait deux
	   traductions du même mot, qui divergeraient à la première retouche. */
	retour.setAttribute("aria-label", t("dashboard.quiz.back"));
	retour.title = t("dashboard.quiz.back");
	// Icône LUCIDE par l'hôte, jamais d'emoji : même silhouette que le greffon.
	currentHost().ui.setIcon(creer(retour, "span", "qbd-quizzes-crumb-icon"), "arrow-left");
	retour.addEventListener("click", () => onBack());

	const titrage = creer(entete, "div", "qbd-qz-headline");
	const ligneTitre = creer(titrage, "div", "qbd-qz-title-row");
	// `title` et non `basename` : c'est le champ que `QuizIndexEntry` prévoit
	// pour l'affichage (les deux sont égaux aujourd'hui, pas forcément demain).
	creer(ligneTitre, "h2", "qbd-qz-title", entry.title);
	creer(ligneTitre, "span", "qbd-qz-count", String(entry.questions));
	creer(titrage, "p", "qbd-qz-path", entry.path);

	/* Le conteneur donné au moteur, et LUI SEUL : c'est sur lui que le moteur
	   posera `__quizDestroy`, et c'est lui que le démontage doit viser. Le
	   greffon fait exactement pareil (`el.createDiv({ cls: "quiz-blocks-host" })`
	   dans le processeur de bloc). */
	const hote = creer(contenu, "div", "quiz-blocks-host");

	/** Démontage d'un écran qui n'a PAS atteint le moteur (erreur de lecture,
	    note sans bloc) : il n'y a pas d'instance à détruire. */
	const demonterSansMoteur = (): void => { root.replaceChildren(); };

	let source: string;
	try {
		source = await currentHost().fs.read(entry.path);
	} catch (e) {
		// Le message nomme le FICHIER et la CAUSE : un catch qui avale la cause
		// rend une panne (permission, disque, portée native perdue) indiagnosticable.
		hote.textContent = t("app.quiz.readError", {
			path: entry.path,
			error: e instanceof Error ? e.message : String(e),
		});
		return demonterSansMoteur;
	}

	const bloc = source.match(QUIZ_BLOCK_RE);
	if (!bloc) {
		// Clé du domaine `dashboard`, empruntée : c'est le message que le tableau
		// de bord donne déjà pour une note sans bloc. (`app.list.empty` parle du
		// DOSSIER, il mentirait ici.)
		hote.textContent = t("dashboard.detail.noBlockInNote");
		return demonterSansMoteur;
	}

	try {
		await renderInteractiveQuiz({
			container: hote,
			// `parseQuizSource` JETTE sur un JSON5 invalide — d'où le try : un bloc
			// à moitié écrit doit dire pourquoi, pas laisser un écran vide.
			quiz: parseQuizSource(bloc[1]),
			/* `sourcePath` vaut `entry.path`, le chemin RELATIF à la racine du
			   dossier. C'est la clé que le journal de révision utilisera en
			   tranche 2, et elle doit être IDENTIQUE à celle qu'Obsidian écrit
			   pour la même note. Un chemin absolu fonctionnerait à l'identique en
			   apparence (`C:/obsidian-vaults/Efrei/Cours/ch1.md::q1` au lieu de
			   `Cours/ch1.md::q1`) : les deux hôtes cesseraient de partager
			   l'historique, et personne ne le verrait avant la tranche 2. */
			sourcePath: entry.path,
			/* Ni `statsSink` ni `reviewSink` : les statistiques et le journal de
			   révision sont la TRANCHE 2. Le moteur les traite comme absents sans
			   se plaindre — c'est pourquoi ils sont optionnels. Inventer un puits
			   ici écrirait un historique dans un format qu'on n'a pas encore arrêté. */
		});
	} catch (e) {
		hote.replaceChildren();
		hote.textContent = t("app.quiz.readError", {
			path: entry.path,
			error: e instanceof Error ? e.message : String(e),
		});
		return demonterSansMoteur;
	}

	/* Le cycle de vie est porté par `__quizDestroy`, que le moteur pose sur le
	   conteneur qu'on lui a donné (déclaré dans `src/global.d.ts`). L'appeler ici
	   est l'équivalent EXACT de l'`onunload` du `MarkdownRenderChild` côté
	   greffon : sans lui, chaque quiz ouvert laisse ses écouteurs
	   `document`/`window`, ses `ResizeObserver` et ses timers. Dix allers-retours
	   vers la liste = dix instances vivantes qui réagissent toutes au
	   redimensionnement de la fenêtre.

	   Idempotent (`fait`) et tolérant : un démontage appelé deux fois, ou après
	   une destruction déjà faite par le moteur, ne doit pas casser la navigation. */
	let fait = false;
	return () => {
		if (fait) return;
		fait = true;
		try {
			hote.__quizDestroy?.();
		} catch (e) {
			// Déjà détruit, ou détruit à moitié : rien à sauver, et l'écran suivant
			// doit s'afficher quand même.
			// Le préfixe vient de `branding.ts`, jamais recopié — et un log ne se
			// traduit pas (il s'adresse au développeur, pas à l'apprenant).
			console.warn(LOG_PREFIX + " destruction du quiz incomplète", e);
		}
		root.replaceChildren();
	};
}
