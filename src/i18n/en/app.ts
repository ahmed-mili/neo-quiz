/* Domaine « app » : ce qui n'existe QUE dans l'application autonome — la
   fenêtre, le choix du dossier, les états vides. Le greffon n'en charge
   aucune clé à l'écran, mais le dictionnaire reste commun : deux
   dictionnaires divergeraient. */
export const EN_APP = {
	"app.window.title": "Neo Quiz",
	"app.empty.noFolder": "No quiz folder yet.",
	"app.empty.pickFolder": "Choose a folder",
	"app.error.startup": "Neo Quiz could not start: {error}",

	/* ── La liste des quiz du dossier ──
	   AUCUNE clé de TYPE de quiz ici : « dashboard.quizType.<tag> » existe déjà,
	   et le scanner garde un tag stable précisément pour que la traduction se
	   fasse au rendu. En créer un second jeu ferait deux libellés à tenir. */
	"app.list.title": "My quizzes",
	"app.list.empty": "No quiz found in this folder.",
	"app.list.questions": "{count} questions",
	"app.list.changeFolder": "Change folder",
} as const;
