import type { EN_REVIEW } from "../en/review";

export const FR_REVIEW: Record<keyof typeof EN_REVIEW, string> = {
	"review.settings.title": "Réglages",
	"review.settings.folders": "Dossiers de quiz",
	"review.settings.foldersHint": "Neo Quiz lit les blocs quiz-blocks de ces dossiers. Rien n'est copié, rien n'est déplacé.",
	"review.settings.addFolder": "Ajouter un dossier",
	"review.settings.removeFolder": "Retirer de la liste",
	"review.settings.removeHint": "Le dossier et son historique de révision restent sur le disque.",
	"review.settings.full": "Neo Quiz lit jusqu'à {count} dossiers.",
	"review.settings.quizCount": "{count} quiz",
	"review.settings.exams": "Dates d'examen",
	"review.settings.examsHint": "Une date resserre le retour de la matière. Laissée vide, elle est révisée pour être retenue durablement.",
	"review.settings.noModules": "Aucune matière pour l'instant — ouvrez un dossier dont les quiz sont rangés en sous-dossiers.",
	"review.card.empty": "Rien à réviser aujourd'hui. À demain.",
};
