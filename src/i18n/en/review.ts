/* Domaine « review » : la révision vue depuis l'APPLICATION — la carte
   « À réviser », les dossiers, les dates d'examen. Le tableau de bord du
   greffon a déjà les siennes (`dashboard.review.*`, `dashboard.module.examDate`)
   et l'application les EMPRUNTE quand le libellé est le même : deux
   traductions du même texte divergeraient à la première retouche. */
export const EN_REVIEW = {
	/* ── La page Réglages ── */
	"review.settings.title": "Settings",
	"review.settings.folders": "Quiz folders",
	"review.settings.foldersHint": "Neo Quiz reads the quiz-blocks in these folders. Nothing is copied, nothing is moved.",
	"review.settings.addFolder": "Add a folder",
	"review.settings.removeFolder": "Remove from the list",
	/* Le mot compte : retirer un dossier de la liste ne touche NI aux notes,
	   NI à l'historique de révision, qui vit dans le dossier. */
	"review.settings.removeHint": "The folder and its review history stay on disk.",
	"review.settings.full": "Neo Quiz reads up to {count} folders.",

	/* ── Les dates d'examen (tâche 10) ── */
	"review.settings.exams": "Exam dates",
	"review.settings.examsHint": "A date tightens how often that subject comes back. Left empty, it is scheduled for long-term retention.",
	"review.settings.noModules": "No subject yet — open a folder that has quizzes in subfolders.",

	/* ── La carte « À réviser » (tâche 11) ── */
	"review.card.empty": "Nothing due today. Come back tomorrow.",
} as const;
