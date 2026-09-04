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
	   NI clé de TYPE de quiz, NI compte de questions ici : « dashboard.quizType.<tag> »
	   et « dashboard.common.questionsOne/Other » existent déjà, et la liste les
	   emprunte. En créer un second jeu donnerait deux traductions du même texte,
	   qui divergeraient à la première retouche. */
	"app.list.title": "My quizzes",
	"app.list.empty": "No quiz found in this folder.",
	"app.list.changeFolder": "Change folder",

	/* ── La page d'un quiz ──
	   NI clé de RETOUR, NI clé « aucun bloc dans cette note » ici :
	   « dashboard.quiz.back » et « dashboard.detail.noBlockInNote » existent déjà
	   et disent exactement la même chose, la page les emprunte. Seule la panne de
	   LECTURE est propre à l'application : sous Obsidian le fichier est déjà
	   ouvert par le coffre, ici il vient du disque et la cause doit être nommée —
	   un message qui avale la cause rend la panne indiagnosticable. */
	"app.quiz.readError": "Could not read {path}: {error}",
} as const;
