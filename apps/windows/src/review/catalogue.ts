import type { QuizIndexEntry } from "../../../../src/dashboard/scanner";
import type { HostPaths } from "../../../../src/host/types";
import type { ScheduledItem } from "../../../../src/scheduler";
import { keyOfQuestion } from "../../../../src/review/review-store";

/* ══════════════════════════════════════════════════════════
   LE CATALOGUE VU PAR L'APPLICATION

   Le noyau attend, pour chaque question : une clé opaque, un MODULE (qui
   porte l'horizon et borne l'entrelacement) et une SOURCE (qui alterne les
   familles). Le greffon tire le module d'une note « Dashboard » du vault ;
   l'application n'a pas cette note, et n'en invente pas : le module est le
   DOSSIER PARENT du quiz, exactement le repli de `moduleForQuiz`.

   La clé de module porte l'identifiant de la RACINE, et ce n'est pas une
   précaution théorique : deux dossiers ouverts peuvent tous deux avoir
   un sous-dossier « Réseaux », et un horizon partagé par erreur
   resserrerait les révisions d'une matière dont l'examen n'a pas lieu.

   Rien de tout cela ne touche le disque : le journal ne porte que `q`,
   `at`, `grade` et `role`. Les deux hôtes peuvent donc grouper
   différemment sans que rien ne diverge — seule la granularité de
   l'horizon change, et elle se voit à l'écran.
══════════════════════════════════════════════════════════ */

const SEP = "/";

/** La clé de module d'un quiz : `<racine>/<dossier parent>`, ou `<racine>`
    pour un quiz posé à la racine du dossier. */
export function cleModule(cheminContrat: string, paths: HostPaths): string {
	const racine = paths.rootOf(cheminContrat);
	const local = paths.localPath(cheminContrat);
	const segments = local.split(SEP).filter(Boolean);
	const parent = segments.length >= 2 ? segments[segments.length - 2] : "";
	const id = racine?.id ?? "";
	return parent ? `${id}${SEP}${parent}` : id;
}

/** Ce qu'on AFFICHE d'une clé de module : le dernier segment. La clé, elle,
    reste entière — c'est elle qui indexe les dates d'examen. */
export function libelleModule(cle: string): string {
	const segments = cle.split(SEP).filter(Boolean);
	return segments[segments.length - 1] ?? cle;
}

export function construireCatalogue(
	quizzes: ReadonlyArray<QuizIndexEntry>,
	paths: HostPaths,
): ScheduledItem[] {
	const out: ScheduledItem[] = [];
	for (const quiz of quizzes) {
		const module = cleModule(quiz.path, paths);
		for (const it of quiz.items) {
			const item: ScheduledItem = {
				/* `keyOfQuestion` PARTAGÉE avec le greffon (`src/review/
				   review-store.ts`) : c'est l'unique règle d'identité, pas une
				   recomposition à la main qui divergerait le jour où le
				   séparateur change. */
				q: keyOfQuestion(quiz.path, it.id),
				module,
				/* La TRANCHE sépare les familles confusables d'un même chapitre
				   tant qu'aucun `topic` n'est déclaré par le contenu — même
				   règle que `buildReviewCatalogue` côté greffon. */
				source: typeof it.slice === "number" ? `${quiz.path}#${it.slice}` : quiz.path,
			};
			if (it.role) item.role = it.role;
			out.push(item);
		}
	}
	return out;
}
