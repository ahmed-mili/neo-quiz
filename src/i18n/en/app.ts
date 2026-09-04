/* Domaine « app » : ce qui n'existe QUE dans l'application autonome — la
   fenêtre, le choix du dossier, les états vides. Le greffon n'en charge
   aucune clé à l'écran, mais le dictionnaire reste commun : deux
   dictionnaires divergeraient. */
export const EN_APP = {
	"app.window.title": "Neo Quiz",
	"app.empty.noFolder": "No quiz folder yet.",
	"app.empty.pickFolder": "Choose a folder",
	"app.error.startup": "Neo Quiz could not start: {error}",
} as const;
