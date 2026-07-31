/* Domaine « editor » — anglais, dictionnaire de RÉFÉRENCE.
   Toute clé ajoutée ici doit l'être aussi dans i18n/fr/editor.ts (le typage de
   FR_EDITOR l'impose). Clés préfixées « editor. » : un domaine ne marche jamais
   sur les clés d'un autre. */
export const EN_EDITOR = {
	/* ── Vue & ossature (editor.ts, editor/ui.ts) ── */
	"editor.empty.hint": "Open a note that contains a quiz-blocks block, then run « Open quiz from the current note ».",
	"editor.view.title": "Quiz Editor",
	"editor.panel.questions": "Questions",
	"editor.panel.editor": "Editor",
	"editor.panel.preview": "Preview",
	"editor.panel.code": "Code",
	"editor.sidebar.count": "Questions ({n})",
	"editor.code.title": "Generated JSON5",

	/* ── Actions communes ── */
	"editor.action.save": "Save",
	"editor.action.open": "Open",
	"editor.action.export": "Export",
	"editor.action.copy": "Copy",
	"editor.action.copied": "Copied!",
	"editor.action.add": "Add",
	"editor.action.delete": "Delete",
	"editor.action.cancel": "Cancel",
	"editor.action.close": "Close",
	"editor.toggle.enable": "Enable",
	"editor.toggle.disable": "Disable",

	/* ── Sauvegarde (infobulles du bouton + notice) ── */
	"editor.save.nothingToSave": "No changes to save",
	"editor.save.openFileFirst": "Open a file to save",
	"editor.save.allSaved": "All changes are saved",
	"editor.save.clickToSave": "Click to save your changes",

	/* ── Texte à trous ── */
	"editor.type.cloze.label": "Fill in the blanks",
	"editor.type.cloze.desc": "Complete a text",
	"editor.cloze.help": "Write the whole text and wrap each blank in double braces. Separate accepted variants with a pipe: {{Paris}}, {{the euro|euro}}.",
	"editor.cloze.templateLabel": "Text with blanks",
	"editor.cloze.templatePlaceholder": "The capital of France is {{Paris}}.",
	"editor.cloze.defaultTemplate": "The capital of France is {{Paris}}.",
	"editor.cloze.blankCount": "{n} blanks detected",
	"editor.cloze.noBlank": "No blank yet — wrap a word in double braces, like {{this}}",

	/* ── Réponse numérique ── */
	"editor.type.numeric.label": "Numeric",
	"editor.type.numeric.desc": "A value, with a tolerance",
	"editor.numeric.help": "The answer is compared as a NUMBER: 3.14, 3,14 and 3.140 all pass. Add a margin when the expected value is a measurement or a rounded result.",
	"editor.numeric.answers": "Expected value",
	"editor.numeric.answerPlaceholder": "9.81",
	"editor.numeric.unit": "Unit (optional)",
	"editor.numeric.unitPlaceholder": "m/s²",
	"editor.numeric.tolerance": "Absolute margin",
	"editor.numeric.tolerancePercent": "Relative margin (%)",

	/* ── Support de compréhension ── */
	"editor.passage.section": "Document",
	"editor.passage.help": "A text to read before answering. Give the same sharing key to several questions and they all show this one document.",
	"editor.passage.textLabel": "Text",
	"editor.passage.textPlaceholder": "Paste or write the passage, case study, scenario or code sample…",
	"editor.passage.titleLabel": "Title",
	"editor.passage.titlePlaceholder": "Text: The greenhouse effect",
	"editor.passage.idLabel": "Sharing key",
	"editor.passage.idPlaceholder": "doc1",

	/* ── Mode examen ── */
	"editor.exam.title": "Exam mode",
	"editor.exam.duration": "Duration",
	"editor.exam.minutesUnit": "min",
	"editor.exam.autoSubmit": "Auto-submit when time is up",
	"editor.exam.showTimer": "Show timer",

	/* ── Types de question (Q_TYPES, editor/utils.ts) ── */
	"editor.type.single.label": "Single choice",
	"editor.type.single.desc": "One correct answer",
	"editor.type.multi.label": "Multiple choice",
	"editor.type.multi.desc": "Several correct answers",
	"editor.type.ordering.label": "Ordering",
	"editor.type.ordering.desc": "Put the items in order",
	"editor.type.matching.label": "Matching",
	"editor.type.matching.desc": "Match rows with choices",
	"editor.type.text.label": "Free text",
	"editor.type.text.desc": "Plain text area",
	"editor.type.cmd.label": "CMD terminal",
	"editor.type.cmd.desc": "Windows command prompt",
	"editor.type.powershell.label": "PowerShell",
	"editor.type.powershell.desc": "PowerShell terminal",
	"editor.type.bash.label": "Bash terminal",
	"editor.type.bash.desc": "Linux/Bash terminal",

	/* ── Formulaire : sections communes ── */
	"editor.form.promptSection": "Prompt",
	"editor.form.promptPlaceholder": "Your question...",
	"editor.hint.label": "Hint",
	"editor.hint.placeholder": "A hint to help...",
	"editor.form.explainSection": "Explanation (Markdown)",
	"editor.form.explainPlaceholder": "### Key points\n- **Term** — Definition",

	/* ── Toolbar entités HTML (infobulles) ── */
	"editor.entity.gt": "Greater than (>)",
	"editor.entity.lt": "Less than (<)",
	"editor.entity.amp": "Ampersand (&)",
	"editor.entity.nbsp": "Non-breaking space",
	"editor.entity.apos": "Apostrophe",
	"editor.entity.quot": "Quotation mark",
	"editor.entity.codeBlock": "Code block",

	/* ── Section Ressource ── */
	"editor.form.resourceSection": "Resource",
	"editor.form.resourceSectionWithFile": "Resource — {file}",
	"editor.form.resourceDefaultLabel": "PT activity",
	"editor.form.resourceLabel": "Label",
	"editor.form.resourceLabelPlaceholder": "PT activity",
	"editor.form.resourceFileName": "Name of the file to open",
	"editor.form.resourceFilePlaceholder": "file.pka",
	"editor.form.resourceHelp": "The file must be stored in your vault",

	/* ── Réponses (choix unique / multiple) ── */
	"editor.answer.correct": "Correct answer",
	"editor.answer.wrong": "Wrong answer",
	"editor.answer.placeholder": "Enter the answer",
	"editor.answer.add": "Add an answer",

	/* ── Classement ── */
	"editor.ordering.possibilities": "Items",
	"editor.ordering.itemPlaceholder": "Item",
	"editor.ordering.slotLabels": "Slot labels",
	"editor.ordering.slotPlaceholder": "Slot",
	"editor.ordering.correctOrder": "Correct order (index → slot)",
	"editor.ordering.slotDefault": "Step {n}",

	/* ── Association ── */
	"editor.matching.rows": "Rows (situations)",
	"editor.matching.rowPlaceholder": "Situation",
	"editor.matching.choices": "Choices (media)",
	"editor.matching.choicePlaceholder": "Choice",
	"editor.matching.mapping": "Matches",
	"editor.matching.rowFallback": "Row {n}",

	/* ── Texte libre & terminaux ── */
	"editor.text.commandPrefix": "Prompt prefix",
	"editor.text.placeholderLabel": "Placeholder",
	"editor.text.placeholderHint": "Hint text...",
	"editor.text.acceptedAnswers": "Accepted answers",
	"editor.text.answerPlaceholder": "Answer",
	"editor.text.caseSensitive": "Case-sensitive",
	"editor.text.defaultPlaceholder": "Your answer...",

	/* ── Panneau Aperçu ── */
	"editor.preview.titleWith": "Preview — {title}",
	"editor.preview.resourceFallback": "Resource",
	"editor.preview.multiHint": "Select one or more answers",
	"editor.preview.orderingHint": "Put the items in the right order",
	"editor.preview.matchingHint": "Match each situation with a medium",

	/* ── Modale « Ajouter une question » ── */
	"editor.typeModal.title": "Add a question",
	"editor.typeModal.subtitle": "Choose the question type",

	/* ── Modale d'import ── */
	"editor.import.title": "Import a quiz",
	"editor.import.placeholder": "Paste the contents of a quiz-blocks block, or the quiz JSON5, here...",
	"editor.import.load": "Load",
	"editor.import.fromNote": "Import from a note",

	/* ── Sélecteurs de note (import / ouverture) ── */
	"editor.suggest.chooseNote": "Choose a note containing a quiz...",
	"editor.suggest.openBadge": "Open",
	"editor.suggest.activeBadge": "Active",
	"editor.open.loadingPlaceholder": "Loading quizzes...",
	"editor.open.searching": "Searching the vault for quizzes...",
	"editor.open.searchPlaceholder": "Search for a quiz...",

	/* ── Modale de suppression ── */
	"editor.delete.title": "Delete \"{title}\"?",
	"editor.delete.message": "This cannot be undone. The question will be permanently deleted.",

	/* ── Notices ── */
	"editor.notice.noQuestionFound": "No question found",
	"editor.notice.noQuestionInContent": "No question found in the content",
	"editor.notice.noValidQuestion": "No valid question found",
	"editor.notice.imported": "{n} question(s) imported",
	"editor.notice.importedFrom": "{n} question(s) imported from {file}",
	"editor.notice.importError": "Import failed: {error}",
	"editor.notice.invalidGenerated": "Error: the generated quiz is not valid.",
	"editor.notice.blockNotFound": "Error: quiz-blocks block not found",
	"editor.notice.saveError": "Save failed: {error}",
	"editor.notice.saved": "Saved",
	"editor.notice.cannotDeleteLast": "You cannot delete the last question",
	"editor.notice.questionDeleted": "Question \"{title}\" deleted",
	"editor.notice.noBlockInNote": "No quiz-blocks block found in this note",
	"editor.notice.importedFromNote": "Quiz imported from {file}",
	"editor.notice.readNoteError": "Could not read the note",
	"editor.notice.quizOpened": "Quiz opened: {file}",
	"editor.notice.openError": "Could not open the quiz",
} as const;
