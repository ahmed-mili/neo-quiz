import type { EN_APP } from "../en/app";

export const FR_APP: Record<keyof typeof EN_APP, string> = {
	"app.window.title": "Neo Quiz",
	"app.empty.noFolder": "Aucun dossier de quiz pour l'instant.",
	"app.empty.pickFolder": "Choisir un dossier",
	"app.error.startup": "Neo Quiz n'a pas pu démarrer : {error}",
};
