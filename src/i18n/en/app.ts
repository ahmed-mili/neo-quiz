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
	/* L'écriture des réglages IA a été REFUSÉE par le processus principal
	   (URL illisible, hôte refusé). La page le dit : un réglage qu'on croit
	   enregistré et qui disparaît au redémarrage est pire qu'un refus. */
	"app.aiSettings.refused": "Could not save the AI settings: {error}",
	"app.aiHost.title": "Allow this Ollama server?",
	"app.aiHost.message": "Neo Quiz will send your requests and the notes you attach to {host}.",
	"app.aiHost.detail": "This server is neither a known host nor on your local network. Allow it only if you set it up yourself.",
	"app.aiHost.allow": "Allow",
	"app.aiHost.deny": "Cancel",

	/* ── Mise à jour automatique (application seulement) ── */
	"app.update.restart": "Restart to update",
	"app.update.auto": "Automatic updates",
	"app.update.autoHint": "Neo Quiz checks GitHub for a newer version, downloads it in the background, and installs it when you click Restart or when you close the app.",
	"app.update.checkNow": "Check now",
	"app.update.state.inactif": "Automatic updates are off.",
	"app.update.state.verification": "Checking for updates…",
	"app.update.state.aJour": "You have the latest version.",
	"app.update.state.telechargement": "Downloading {version}: {pourcent}%",
	"app.update.state.prete": "Version {version} is ready to install.",
	"app.update.state.erreur": "Could not check for updates.",

	/* ── Barre de titre et menu d'application (application seulement) ── */
	"app.titlebar.menu": "Application menu",
	"app.titlebar.minimize": "Minimize",
	"app.titlebar.maximize": "Maximize",
	"app.titlebar.restore": "Restore",
	"app.titlebar.close": "Close",
	"app.menu.checkUpdates": "Check for updates…",
	"app.menu.settings": "Settings…",
	"app.menu.edit": "Edit",
	"app.menu.undo": "Undo",
	"app.menu.redo": "Redo",
	"app.menu.cut": "Cut",
	"app.menu.copy": "Copy",
	"app.menu.paste": "Paste",
	"app.menu.selectAll": "Select all",
	"app.menu.view": "Display",
	"app.menu.scale": "Interface scale",
	"app.menu.reload": "Reload",
	"app.menu.fullscreen": "Toggle full screen",
	"app.menu.devtools": "Show developer tools",
	"app.menu.nextWallpaper": "Next wallpaper",

	/* ── Le dossier de quiz par défaut, et les emplacements supplémentaires
	   (tranche 9) — Réglages, application seulement : le greffon n'a rien à
	   choisir, il lit le vault qui le contient. ── */
	"app.settings.defaultFolder": "Quiz folder",
	"app.settings.defaultFolderHint": "Neo Quiz creates its quizzes here. This folder cannot be removed.",
	"app.settings.extraFolders": "Additional locations",
	"app.settings.extraFoldersHint": "Obsidian vaults and other folders you have opened.",

	/* ── Réglages « Général » (application seulement) ── */
	"app.settings.general": "General",
	"app.reprise.label": "Reopen where you left off",
	"app.reprise.hint": "At launch, Neo Quiz opens the last quiz and question you were on.",

	/* ── Fond d'écran (application seulement) ── */
	"app.settings.wallpaper": "Wallpaper",
	"app.fond.none": "No folder chosen: the built-in wallpaper is used.",
	"app.fond.choose": "Choose a folder",
	"app.fond.remove": "Remove",
	"app.fond.next": "Next wallpaper",
	"app.fond.disparue": "The wallpaper image is gone; the first image of the folder is used.",
	"app.fond.dossierVide": "No image in that folder; the built-in wallpaper is used.",
} as const;
