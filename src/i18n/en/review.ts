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
	"review.settings.removeFolder": "Remove — the folder and its review history stay on disk, and it is not reopened",
	/* Le mot compte : retirer un dossier de la liste ne touche NI aux notes,
	   NI à l'historique de révision, qui vit dans le dossier. C'est
	   l'INFOBULLE qui le porte depuis le 2026-09-17 — la phrase vivait sous la
	   liste, loin du bouton qu'elle expliquait. */
	"review.settings.full": "Neo Quiz reads up to {count} folders.",

} as const;
