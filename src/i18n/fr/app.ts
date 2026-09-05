import type { EN_APP } from "../en/app";

export const FR_APP: Record<keyof typeof EN_APP, string> = {
	"app.window.title": "Neo Quiz",
	"app.empty.title": "Choisissez un dossier de quiz",
	"app.empty.body": "Neo Quiz joue les blocs quiz-blocks de vos notes, là où elles sont déjà. Rien n'est copié, rien n'est déplacé.",
	"app.empty.yourVaults": "Vos vaults Obsidian",
	"app.empty.pickFolder": "Choisir un dossier",
	"app.error.startup": "Neo Quiz n'a pas pu démarrer : {error}",

	"app.quiz.readError": "Impossible de lire {path} : {error}",
};
