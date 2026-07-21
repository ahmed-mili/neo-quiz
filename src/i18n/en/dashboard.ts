/* Domaine « dashboard » — anglais, dictionnaire de RÉFÉRENCE.
   Toute clé ajoutée ici doit l'être aussi dans i18n/fr/dashboard.ts (le typage de
   FR_DASHBOARD l'impose). Clés préfixées « dashboard. » : un domaine ne marche jamais
   sur les clés d'un autre. */
export const EN_DASHBOARD = {
	/* ── Commun (compteurs partagés home / carte / détail / options) ──
	   Deux clés par compteur (…One / …Other) : le code choisit selon la valeur
	   qui gouverne l'accord, jamais un « s » concaténé. */
	"dashboard.common.questionsOne": "{count} question",
	"dashboard.common.questionsOther": "{count} questions",
	"dashboard.common.questionsOfOne": "{done}/{total} question",
	"dashboard.common.questionsOfOther": "{done}/{total} questions",

	/* ── Sidebar ── */
	"dashboard.nav.home": "Home",
	"dashboard.nav.quizzes": "My quizzes",
	"dashboard.nav.generate": "Generate",
	"dashboard.nav.settings": "Settings",

	/* ── Accueil ── */
	"dashboard.home.subtitleResume": "Resume a quiz in progress, or generate a new one.",
	"dashboard.home.subtitleStart": "Pick a quiz to review, or generate a new one.",
	"dashboard.home.generate": "Generate a quiz",
	"dashboard.home.statQuizzes": "Quizzes created",
	"dashboard.home.statQuizzesSub": "in this vault",
	"dashboard.home.statQuestions": "Total questions",
	"dashboard.home.statQuestionsSub": "across all notes",
	"dashboard.home.statMastered": "Mastered",
	"dashboard.home.statMasteredSub": "score ≥ 80%",
	"dashboard.home.todo": "To do",
	"dashboard.home.seeAll": "See all",
	"dashboard.home.completed": "Completed",
	"dashboard.home.resumeLabel": "Pick up where you left off",
	"dashboard.home.resumeProgress": "{questions} · {pct}%",
	"dashboard.home.resumeBtn": "Resume",

	/* ── Onboarding (premier usage, aucun quiz) ── */
	"dashboard.onboarding.title": "Welcome to Quiz Blocks",
	"dashboard.onboarding.lead": "Turn your notes into interactive quizzes — multiple choice, fill in the blank, matching — to revise and test yourself.",
	"dashboard.onboarding.generate": "Generate my first quiz",
	"dashboard.onboarding.or": "or",
	"dashboard.onboarding.manualTitle": "Create a quiz by hand",
	"dashboard.onboarding.manualDesc": "Add a quiz-blocks code block to any note:",
	"dashboard.onboarding.copy": "Copy the block",
	/* Contenu de l'exemple de code copiable. ⚠️ Ces 2 valeurs sont injectées dans
	   des chaînes JSON5 entre apostrophes SIMPLES : jamais d'apostrophe dedans
	   (elle casserait le bloc collé par l'utilisateur). Cf. home.ts. */
	"dashboard.onboarding.sampleTitle": "My first question",
	"dashboard.onboarding.samplePrompt": "What is the capital of France?",

	/* ── Mes quiz ── */
	"dashboard.quizzes.title": "My quizzes",
	"dashboard.quizzes.new": "New folder",
	"dashboard.quizzes.newFolderTitle": "New folder",
	"dashboard.quizzes.newFolderCta": "Create",
	"dashboard.quizzes.newFolderError": "Could not create the folder",
	"dashboard.quizzes.createFolderTitle": "Create a folder",
	"dashboard.quizzes.createAiTitle": "Create with AI",
	"dashboard.quizzes.createAiDesc": "Describe a topic or drop in your notes — AI turns them into interactive quizzes",
	"dashboard.quizzes.createEmptyTitle": "Create an empty folder",
	"dashboard.quizzes.createEmptyDesc": "An empty folder to fill with your own quizzes whenever you want",
	"dashboard.quizzes.createImportTitle": "Import a shared folder",
	"dashboard.quizzes.createImportDesc": "Recreate a quiz folder someone shared with you (.zip)",
	"dashboard.quizzes.importEmpty": "Empty or unreadable archive",
	"dashboard.quizzes.importError": "Import failed",
	"dashboard.quizzes.importDone": "Imported {name} ({count} quizzes)",
	"dashboard.quizzes.newQuiz": "New quiz",
	"dashboard.quizzes.newQuizDefaultName": "New quiz",
	"dashboard.quizzes.newQuizError": "Could not create the quiz",
	"dashboard.quizzes.createQuizTitle": "Create a quiz",
	"dashboard.quizzes.createQuizEmptyTitle": "Create an empty quiz",
	"dashboard.quizzes.createQuizEmptyDesc": "A blank quiz in this folder, to build question by question in the editor",
	"dashboard.quizzes.createQuizImportTitle": "Import a shared quiz",
	"dashboard.quizzes.createQuizImportDesc": "Add a quiz someone shared with you (.md or .zip)",
	"dashboard.quizzes.importQuizDone": "Imported {name}",
	"dashboard.quizzes.importNoQuiz": "No quiz block found in this file",
	"dashboard.quizzes.empty": "No quiz found",
	"dashboard.quizzes.noFolder": "No folder",
	"dashboard.quizzes.folderMasteredOne": "{count} mastered",
	"dashboard.quizzes.folderMasteredOther": "{count} mastered",

	/* ── Regroupement (sélecteur au-dessus des pastilles de filtre) ──
	   Le SÉLECTEUR nomme l'axe (« By activity » = max(dernière partie jouée,
	   dernière modification)) — pas un jargon du type « Recent » qui
	   laisserait deviner de quoi. Les libellés de GROUPES ne le répètent
	   donc pas : sous « By activity », « Last 7 days » est déjà sans
	   ambiguïté, et les trois restent parallèles et neutres. « Inactive for
	   over a month » sonnait comme un reproche là où les deux autres étaient
	   positifs — un groupe décrit un intervalle, il ne juge pas. */
	"dashboard.quizzes.groupByUE": "UE",
	"dashboard.quizzes.noUe": "No course unit",
	"dashboard.quizzes.moduleQuizzesOne": "{count} quiz",
	"dashboard.quizzes.moduleQuizzesOther": "{count} quizzes",
	"dashboard.quizzes.backToModules": "All quizzes",
	/* ── Header d'un dossier ouvert (icône + nom + stats + panneau Progrès,
	   design claude.ai capture 2026-07-20) ── */
	"dashboard.quizzes.statQuizzes": "Quizzes",
	"dashboard.quizzes.progressTitle": "Progress",
	"dashboard.quizzes.progressCount": "{done}/{total} quiz",
	/* "Mastered"/"To review" du donut réutilisent dashboard.card.mastered/review
	   (même mot que la pastille d'état d'une carte) ; "To learn" agrège fresh
	   ET progress (rien de tel n'existe pour une carte individuelle). */
	"dashboard.quizzes.progressToLearn": "To learn",
	"dashboard.quizzes.groupByActivity": "Recent",
	"dashboard.quizzes.recentWeek": "Last 7 days",
	"dashboard.quizzes.recentMonth": "Last 30 days",
	"dashboard.quizzes.recentOlder": "Older than one month",

	/* ── Menu ⋯ des cartes — dérivé de la capture StudySmarter (Excalidraw
	   2026-07-18) : Share / Edit / Rename / Archive / Delete. « Pause study
	   reminders » retiré le 2026-07-21 (demande Ahmed). ── */
	"dashboard.quizzes.menuShare": "Share",
	"dashboard.quizzes.menuRename": "Rename",
	"dashboard.quizzes.menuArchive": "Archive",
	"dashboard.quizzes.menuUnarchive": "Unarchive",
	"dashboard.quizzes.menuDelete": "Delete quiz",
	"dashboard.quizzes.archivedSection": "Archived",
	"dashboard.quizzes.renameTitle": "Rename quiz",
	"dashboard.quizzes.renameLabel": "Quiz name",
	"dashboard.quizzes.renameCta": "Rename",
	"dashboard.quizzes.renameExists": "“{name}” already exists in this folder.",
	"dashboard.quizzes.renameError": "Could not rename this quiz",
	"dashboard.quizzes.deleted": "Quiz deleted",
	"dashboard.quizzes.deleteConfirmTitle": "Delete quiz",
	"dashboard.quizzes.deleteConfirmBody": "Remove “{title}” and its stats from the note ? This cannot be undone.",
	"dashboard.quizzes.deleteConfirmCta": "Delete",
	"dashboard.quizzes.menuDeleteModule": "Delete module quizzes",
	"dashboard.quizzes.deleteModuleConfirmBody": "Remove the {count} quizzes of “{name}” and their stats ? This cannot be undone.",
	"dashboard.quizzes.fileSaved": "Saved: {path}",
	"dashboard.quizzes.shareTitle": "Share folder",
	"dashboard.quizzes.shareQuizTitle": "Share quiz",
	"dashboard.quizzes.shareHint": "No app can attach a file automatically — pick one, it opens with the file ready to paste.",
	"dashboard.quizzes.shareSave": "Save file",
	"dashboard.quizzes.discordReady": "File copied — in Discord: pick a chat, press Ctrl+V, then Enter.",
	"dashboard.quizzes.shareCopyHint": "Files will be copied to the clipboard for sharing",
	"dashboard.quizzes.shareCopiedToast": "Copied — paste it into Discord with Ctrl+V",

	/* ── Modal « Modifier dossier » (calqué StudySmarter, sans le toggle public) ── */
	"dashboard.quizzes.moduleEditTitle": "Edit folder",
	"dashboard.quizzes.moduleEditName": "Folder name",
	"dashboard.quizzes.moduleEditUe": "Course unit",
	"dashboard.quizzes.moduleEditColor": "Color",
	"dashboard.quizzes.moduleEditIcon": "Icon",
	"dashboard.quizzes.moduleIconSearch": "Search icons…",
	"dashboard.quizzes.moduleIconSuggested": "Suggested",
	"dashboard.quizzes.moduleIconAll": "All",
	"dashboard.quizzes.moduleIconNoResult": "No icon found",
	"dashboard.quizzes.moduleEditCustomColor": "Custom color",

	/* ── Carte de quiz (état) ── */
	"dashboard.card.mastered": "Mastered",
	"dashboard.card.review": "To review",
	"dashboard.card.progress": "In progress · {pct}%",
	"dashboard.card.fresh": "Not started",
	"dashboard.card.best": "Best {score}%",
	"dashboard.card.more": "More actions",

	/* ── Type de quiz (calculé par le scanner, traduit au rendu) ── */
	"dashboard.quizType.mixed": "Mixed",
	"dashboard.quizType.single": "Single choice",
	"dashboard.quizType.multiple": "Multiple choice",
	"dashboard.quizType.text": "Free text",
	"dashboard.quizType.ordering": "Ordering",
	"dashboard.quizType.matching": "Matching",

	/* ── Temps relatif (stats-store) ── */
	"dashboard.time.justNow": "Just now",
	"dashboard.time.minutes": "{n} min ago",
	"dashboard.time.hours": "{n}h ago",
	"dashboard.time.days": "{n}d ago",
	"dashboard.time.monthsOne": "{n} month ago",
	"dashboard.time.monthsOther": "{n} months ago",
	"dashboard.time.overYear": "Over a year ago",

	/* ── Détail ── */
	"dashboard.detail.edit": "Edit",
	"dashboard.detail.play": "Start",
	"dashboard.detail.statBest": "Best score",
	"dashboard.detail.statType": "Type",
	"dashboard.detail.statLast": "Last played",
	"dashboard.detail.statAttempts": "Attempts",
	"dashboard.detail.fileNotFound": "File not found",
	"dashboard.detail.noBlock": "No quiz-blocks block found",
	"dashboard.detail.loadError": "Couldn't load the questions",
	"dashboard.detail.noBlockInNote": "No quiz-blocks block found in this note",
	"dashboard.detail.opened": "Quiz opened: {name}",
	"dashboard.detail.openError": "Couldn't open the quiz",

	/* ── Page d'un quiz (refonte 2026-07-21) : consultation + édition en
	   place, sans onglets ni panneau Code. ── */
	"dashboard.quiz.loading": "Loading…",
	"dashboard.quiz.questionsTitle": "Questions ({n})",
	"dashboard.quiz.addQuestion": "Add a question",
	"dashboard.quiz.deleteQuestion": "Delete this question",
	"dashboard.quiz.prev": "Previous question",
	"dashboard.quiz.next": "Next question",
	"dashboard.quiz.promptEmpty": "Empty question",
	"dashboard.quiz.editor": "Editor",
	"dashboard.quiz.editDone": "Done",
	"dashboard.quiz.editPrompt": "Question",
	"dashboard.quiz.editPromptPlaceholder": "Type your question…",
	"dashboard.quiz.answerPlaceholder": "Type an answer…",
	"dashboard.quiz.goodAnswer": "Correct answer",
	"dashboard.quiz.badAnswer": "Wrong answer",
	"dashboard.quiz.markGood": "Mark as correct",
	"dashboard.quiz.markBad": "Mark as wrong",
	"dashboard.quiz.deleteAnswer": "Delete this answer",
	"dashboard.quiz.addAnswer": "Add an answer",
	"dashboard.quiz.editUnsupported": "This question type is edited in the full editor.",
	"dashboard.quiz.openFullEditor": "Open the full editor",
	"dashboard.quiz.saveError": "Couldn't save the quiz",

	/* ── ui-select (dropdown, menus, slider d'effort, sélecteur de note) ── */
	"dashboard.select.placeholder": "Select…",
	"dashboard.select.findModel": "Find model…",
	"dashboard.select.noModel": "No models",
	"dashboard.select.effort": "Effort",
	"dashboard.select.effortFlyoutHelp": "Higher effort means more thorough responses, but takes longer and uses your limits faster.",
	"dashboard.select.effortDefault": "Default",
	"dashboard.select.moreModels": "More models",
	"dashboard.select.effortHelp": "Higher effort produces more complete responses, but takes longer and uses your limits faster.",
	"dashboard.select.effortFaster": "Faster",
	"dashboard.select.effortSmarter": "Smarter",
	"dashboard.select.fastAria": "Fast (1.5x speed)",
	"dashboard.select.fastSpeed": "1.5x speed",
	"dashboard.select.fastUsage": "More usage",
	"dashboard.select.usageWarning": "Consumes usage limits faster",
	"dashboard.select.optionsQuestions": "Questions",
	"dashboard.select.optionsType": "Type",
	"dashboard.select.optionsCustom": "Custom",
	"dashboard.select.noteSearch": "Search a note…",
	"dashboard.select.noteOpen": "Open notes",
	"dashboard.select.noteAll": "All notes",
	"dashboard.select.noteNotFound": "No note found",
	"dashboard.select.noteEmpty": "No note open — type to search",
} as const;
