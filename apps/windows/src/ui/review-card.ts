/* ══════════════════════════════════════════════════════════
   LA CARTE « À RÉVISER AUJOURD'HUI »

   Le LIVRABLE VISIBLE de la tranche 2 : moteur → journal → ordonnanceur →
   écran. `ReviewStore.plan(now)` (tâche 4) rend des clés `chemin::id`
   ORDONNÉES POUR LA SESSION (elles entrelacent les familles de questions) —
   ce n'est PAS un ordre d'affichage. Cette carte regroupe donc par NOTE
   (seul geste possible aujourd'hui : ouvrir un quiz), et trie par nombre
   décroissant puis par chemin — un ordre TOTAL, donc stable d'un rendu à
   l'autre, même quand plusieurs dossiers ouverts se mélangent.

   MÊMES DONNÉES QUE LE TABLEAU DE BORD DU GREFFON (`src/dashboard/home.ts`,
   section « home:review ») : même clé de traduction, même regroupement par
   note, pour que les deux écrans annoncent exactement les mêmes notes sur
   le même vault au même moment — un écart entre les deux serait le signe
   que les clés de question divergent. Seule la PRÉSENTATION diffère : le
   greffon replie la section dans un en-tête repliable (chevron, état
   persisté) ; ici, plus simple, une carte fixe — l'application n'a pas
   encore de réglage de repli par section.

   Les CLASSES DE RANGÉE sont celles du tableau de bord (`qbd-review-list`,
   `qbd-review-row`, `qbd-review-icon`, `qbd-review-title`, `qbd-review-
   count`, `qbd-review-deferred`), définies dans `dashboard-home.css`, déjà
   chargé par `main.ts` : deux jeux de classes pour la même carte donneraient
   deux apparences à tenir synchrones.

   LE TITRE DE SECTION, en revanche, N'EST PAS `qbd-quizzes-title` : cette
   classe (28px, serif Constantia) n'habille QUE le titre d'une PAGE entière
   — les trois autres appels du dépôt sont tous des `h2` (« Mes quiz »,
   « Réglages »), jamais un sous-titre. La reprendre ici aurait empilé deux
   titres géants identiques sous « Mes quiz ». `home.ts` rend ce MÊME
   libellé (`dashboard.review.title`) avec `qbd-quizzes-node-label`
   (16px/500) — le style générique de ses en-têtes de section repliables —
   et c'est cette classe qui est reprise ici.

   Le RENDU SE RECALCULE, IL NE SE MET PAS EN CACHE : `plan()` est DÉRIVÉ du
   journal à chaque appel (voir `review-store.ts`), donc rejouer un quiz ou
   modifier une date d'examen change ce qui est dû, sans rien à invalider —
   c'est la propriété qui a justifié « journal seul, état dérivé ». Mémoriser
   un plan ici la casserait.

   Ce module n'importe AUCUN CSS — même contrainte que les modules d'hôte :
   un import de CSS y tire les fontes MathLive, pour lesquelles le harnais
   des scripts de contrôle n'a pas de chargeur.
══════════════════════════════════════════════════════════ */

import type { QuizIndexEntry, Scanner } from "../../../../src/dashboard/scanner";
import type { ReviewStore } from "../../../../src/review/review-store";
import { t } from "../../../../src/i18n";
import { currentHost } from "../../../../src/host/current";
import { ajouter } from "../../../../src/dom";

export function renderReviewCard(
	parent: HTMLElement,
	deps: { store: ReviewStore; scanner: Scanner; onOpen(entry: QuizIndexEntry): void },
): void {
	const plan = deps.store.plan(Date.now());

	/* Une question est due, pas un quiz : on regroupe par NOTE pour pouvoir
	   ouvrir quelque chose. `plan.today` est ordonné pour la SESSION (il
	   entrelace les familles) ; l'affichage, lui, veut un ordre stable — d'où
	   le tri par nombre puis par chemin, qui est total. */
	const parNote = new Map<string, number>();
	for (const cle of plan.today) {
		const sep = cle.lastIndexOf("::");
		// Une clé sans séparateur ne désigne aucune note : on la laisse tomber
		// plutôt que de fabriquer un chemin vide.
		if (sep <= 0) continue;
		const path = cle.slice(0, sep);
		parNote.set(path, (parNote.get(path) ?? 0) + 1);
	}

	const lignes = [...parNote.entries()]
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
		.map(([path, n]) => ({ quiz: deps.scanner.getQuiz(path), n }))
		// Note disparue entre le scan et le rendu : rien à ouvrir.
		.filter((l): l is { quiz: QuizIndexEntry; n: number } => !!l.quiz);

	const section = ajouter(parent, "section", "qbd-home-section");
	// `t()` AU RENDU. Clé EMPRUNTÉE au tableau de bord : c'est le même titre,
	// et deux traductions du même texte divergeraient. La CLASSE corrige
	// celle du brief d'origine (voir l'en-tête du module) : `qbd-quizzes-
	// node-label`, jamais `qbd-quizzes-title`, réservée aux titres de page.
	ajouter(section, "h3", "qbd-quizzes-node-label", t("dashboard.review.title"));

	const liste = ajouter(section, "div", "qbd-review-list");
	if (!lignes.length) {
		/* Un jour sans révision n'est PAS un vide à cacher : c'est le
		   fonctionnement normal de l'espacement, et le dire évite de faire
		   croire à une panne. */
		ajouter(liste, "p", "qbd-review-deferred", t("review.card.empty"));
		return;
	}

	for (const { quiz, n } of lignes) {
		const row = ajouter(liste, "button", "qbd-review-row");
		row.type = "button";
		currentHost().ui.setIcon(ajouter(row, "span", "qbd-review-icon"), "rotate-ccw");
		ajouter(row, "span", "qbd-review-title", quiz.title);
		ajouter(row, "span", "qbd-review-count", t(
			n === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther",
			{ count: n },
		));
		row.addEventListener("click", () => deps.onOpen(quiz));
	}

	/* Le report est une INFORMATION, pas un reproche : il dit que le budget du
	   jour a tenu, pas que l'utilisateur est en retard. */
	if (plan.deferred.length) {
		ajouter(liste, "p", "qbd-review-deferred", t(
			plan.deferred.length === 1 ? "dashboard.review.deferredOne" : "dashboard.review.deferredOther",
			{ count: plan.deferred.length },
		));
	}
}
