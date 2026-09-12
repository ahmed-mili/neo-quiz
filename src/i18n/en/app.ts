/* Domaine « app » : ce qui n'existe QUE dans l'application autonome — la
   fenêtre, le choix du dossier, les états vides. Le greffon n'en charge
   aucune clé à l'écran, mais le dictionnaire reste commun : deux
   dictionnaires divergeraient. */
export const EN_APP = {
	"app.window.title": "Neo Quiz",
	/* ── Le premier écran, avant tout choix de dossier ──
	   Un écran vide est une INVITATION, pas un constat : il dit ce qu'il y a
	   à faire, et pourquoi c'est sans risque. Une application qui demande un
	   dossier doit dire ce qu'elle en fera. */
	"app.empty.title": "Choose a quiz folder",
	"app.empty.body": "Neo Quiz plays the quiz-blocks in your notes, right where they already live. Nothing is copied, nothing is moved.",
	"app.empty.yourVaults": "Your Obsidian vaults",
	"app.empty.pickFolder": "Choose a folder",
	"app.error.startup": "Neo Quiz could not start: {error}",

	/* ── La page d'un quiz ──
	   NI clé de RETOUR, NI clé « aucun bloc dans cette note » ici :
	   « dashboard.quiz.back » et « dashboard.detail.noBlockInNote » existent déjà
	   et disent exactement la même chose, la page les emprunte. Seule la panne de
	   LECTURE est propre à l'application : sous Obsidian le fichier est déjà
	   ouvert par le coffre, ici il vient du disque et la cause doit être nommée —
	   un message qui avale la cause rend la panne indiagnosticable. */
	"app.quiz.readError": "Could not read {path}: {error}",

	/* ── La confirmation NATIVE d'un hôte Ollama hors liste ──
	   Affichée par le PROCESSUS PRINCIPAL (`electron/canaux.ts`, garde de la
	   clé `ai`), jamais par la fenêtre : un rendu compromis ne doit pas
	   pouvoir rédiger la question qu'on lui pose. Le principal traduit avec
	   ce même dictionnaire, sur la langue du système (`app.getLocale()`), la
	   source que la fenêtre lit elle aussi par `navigator.language`. */
	"app.aiHost.title": "Allow this Ollama server?",
	"app.aiHost.message": "Neo Quiz will send your requests and the notes you attach to {host}.",
	"app.aiHost.detail": "This server is neither a known host nor on your local network. Allow it only if you set it up yourself.",
	"app.aiHost.allow": "Allow",
	"app.aiHost.deny": "Cancel",
} as const;
