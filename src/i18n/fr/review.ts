import type { EN_REVIEW } from "../en/review";

export const FR_REVIEW: Record<keyof typeof EN_REVIEW, string> = {
	"review.settings.title": "Réglages",
	"review.settings.folders": "Dossiers de quiz",
	"review.settings.foldersHint": "Neo Quiz lit les blocs quiz-blocks de ces dossiers. Rien n'est copié, rien n'est déplacé.",
	"review.settings.addFolder": "Ajouter un dossier",
	"review.settings.removeFolder": "Retirer — le dossier et son historique de révision restent sur le disque, et il n'est plus rouvert",
	"review.settings.full": "Neo Quiz lit jusqu'à {count} dossiers.",
};
