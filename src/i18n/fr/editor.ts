import type { EN_EDITOR } from "../en/editor";

/* Domaine « editor » — français. */
export const FR_EDITOR: Record<keyof typeof EN_EDITOR, string> = {
	/* ── Vue & ossature (editor.ts, editor/ui.ts) ── */
	"editor.view.title": "Éditeur de quiz",
	"editor.panel.questions": "Questions",
	"editor.panel.editor": "Éditeur",
	"editor.panel.preview": "Aperçu",
	"editor.panel.code": "Code",
	"editor.sidebar.count": "Questions ({n})",
	"editor.code.title": "JSON5 généré",

	/* ── Actions communes ── */
	"editor.action.save": "Sauvegarder",
	"editor.action.open": "Ouvrir",
	"editor.action.export": "Exporter",
	"editor.action.copy": "Copier",
	"editor.action.copied": "Copié !",
	"editor.action.add": "Ajouter",
	"editor.action.delete": "Supprimer",
	"editor.action.cancel": "Annuler",
	"editor.action.close": "Fermer",
	"editor.toggle.enable": "Activer",
	"editor.toggle.disable": "Désactiver",

	/* ── Sauvegarde (infobulles du bouton + notice) ── */
	"editor.save.nothingToSave": "Aucune modification à sauvegarder",
	"editor.save.openFileFirst": "Ouvrez un fichier pour sauvegarder",
	"editor.save.allSaved": "Toutes les modifications sont sauvegardées",
	"editor.save.clickToSave": "Cliquez pour sauvegarder les modifications",

	/* ── Support de compréhension ── */
	"editor.passage.section": "Document",
	"editor.passage.help": "Un texte à lire avant de répondre. Donnez la même clé de partage à plusieurs questions : elles afficheront toutes ce même document.",
	"editor.passage.textLabel": "Texte",
	"editor.passage.textPlaceholder": "Collez ou écrivez le texte, l'étude de cas, le scénario ou l'extrait de code…",
	"editor.passage.titleLabel": "Titre",
	"editor.passage.titlePlaceholder": "Texte : L'effet de serre",
	"editor.passage.idLabel": "Clé de partage",
	"editor.passage.idPlaceholder": "doc1",

	/* ── Mode examen ── */
	"editor.exam.title": "Mode Examen",
	"editor.exam.duration": "Durée",
	"editor.exam.minutesUnit": "min",
	"editor.exam.autoSubmit": "Soumettre auto à la fin",
	"editor.exam.showTimer": "Afficher le timer",

	/* ── Types de question (Q_TYPES, editor/utils.ts) ── */
	"editor.type.single.label": "Choix unique",
	"editor.type.single.desc": "Une seule bonne réponse",
	"editor.type.multi.label": "Choix multiple",
	"editor.type.multi.desc": "Plusieurs bonnes réponses",
	"editor.type.ordering.label": "Classement",
	"editor.type.ordering.desc": "Ordonner les éléments",
	"editor.type.matching.label": "Association",
	"editor.type.matching.desc": "Associer lignes et choix",
	"editor.type.text.label": "Texte libre",
	"editor.type.text.desc": "Textarea classique",
	"editor.type.cmd.label": "Terminal CMD",
	"editor.type.cmd.desc": "Invite de commandes Windows",
	"editor.type.powershell.label": "PowerShell",
	"editor.type.powershell.desc": "Terminal PowerShell",
	"editor.type.bash.label": "Terminal Bash",
	"editor.type.bash.desc": "Terminal Linux/Bash",

	/* ── Formulaire : sections communes ── */
	"editor.form.promptSection": "Énoncé",
	"editor.form.promptPlaceholder": "Votre question...",
	"editor.hint.label": "Indice",
	"editor.hint.placeholder": "Un indice pour aider...",
	"editor.form.explainSection": "Explication (Markdown)",
	"editor.form.explainPlaceholder": "### Rappels\n- **Terme** — Définition",

	/* ── Toolbar entités HTML (infobulles) ── */
	"editor.entity.gt": "Supérieur (>)",
	"editor.entity.lt": "Inférieur (<)",
	"editor.entity.amp": "Esperluette (&)",
	"editor.entity.nbsp": "Espace insécable",
	"editor.entity.apos": "Apostrophe",
	"editor.entity.quot": "Guillemet",
	"editor.entity.codeBlock": "Bloc de code",

	/* ── Section Ressource ── */
	"editor.form.resourceSection": "Ressource",
	"editor.form.resourceSectionWithFile": "Ressource — {file}",
	"editor.form.resourceDefaultLabel": "Activité PT",
	"editor.form.resourceLabel": "Label",
	"editor.form.resourceLabelPlaceholder": "Activité PT",
	"editor.form.resourceFileName": "Nom du fichier à ouvrir",
	"editor.form.resourceFilePlaceholder": "fichier.pka",
	"editor.form.resourceHelp": "Le fichier doit être placé dans le coffre",

	/* ── Réponses (choix unique / multiple) ── */
	"editor.answer.correct": "Bonne réponse",
	"editor.answer.wrong": "Mauvaise réponse",
	"editor.answer.placeholder": "Saisir la réponse",
	"editor.answer.add": "Ajouter une réponse",

	/* ── Classement ── */
	"editor.ordering.possibilities": "Possibilités",
	"editor.ordering.itemPlaceholder": "Élément",
	"editor.ordering.slotLabels": "Labels des slots",
	"editor.ordering.slotPlaceholder": "Slot",
	"editor.ordering.correctOrder": "Ordre correct (index → slot)",
	"editor.ordering.slotDefault": "Étape {n}",

	/* ── Association ── */
	"editor.matching.rows": "Lignes (situations)",
	"editor.matching.rowPlaceholder": "Situation",
	"editor.matching.choices": "Choix (supports)",
	"editor.matching.choicePlaceholder": "Choix",
	"editor.matching.mapping": "Associations",
	"editor.matching.rowFallback": "Ligne {n}",

	/* ── Texte libre & terminaux ── */
	"editor.text.commandPrefix": "Préfix du prompt",
	"editor.text.placeholderLabel": "Placeholder",
	"editor.text.placeholderHint": "Texte indicatif...",
	"editor.text.acceptedAnswers": "Réponses acceptées",
	"editor.text.answerPlaceholder": "Réponse",
	"editor.text.caseSensitive": "Sensible à la casse",
	"editor.text.defaultPlaceholder": "Votre réponse...",

	/* ── Panneau Aperçu ── */
	"editor.preview.titleWith": "Aperçu — {title}",
	"editor.preview.resourceFallback": "Ressource",
	"editor.preview.multiHint": "Sélectionnez une ou plusieurs réponses",
	"editor.preview.orderingHint": "Classez les éléments dans le bon ordre",
	"editor.preview.matchingHint": "Associez chaque situation à un support",

	/* ── Modale « Ajouter une question » ── */
	"editor.typeModal.title": "Ajouter une question",
	"editor.typeModal.subtitle": "Choisissez le type de question",

	/* ── Modale d'import ── */
	"editor.import.title": "Importer un quiz",
	"editor.import.placeholder": "Collez ici le contenu d'un bloc quiz-blocks ou le code JSON5 du quiz...",
	"editor.import.load": "Charger",
	"editor.import.fromNote": "Importer depuis une note",

	/* ── Sélecteurs de note (import / ouverture) ── */
	"editor.suggest.chooseNote": "Choisir une note contenant un quiz...",
	"editor.suggest.openBadge": "Ouvert",
	"editor.suggest.activeBadge": "Actif",
	"editor.open.loadingPlaceholder": "Chargement des quiz en cours...",
	"editor.open.searching": "Recherche des quiz dans le vault...",
	"editor.open.searchPlaceholder": "Rechercher un quiz...",

	/* ── Modale de suppression ── */
	"editor.delete.title": "Supprimer « {title} » ?",
	"editor.delete.message": "Cette action est irréversible. La question sera définitivement supprimée.",

	/* ── Notices ── */
	"editor.notice.noQuestionFound": "Aucune question trouvée",
	"editor.notice.noQuestionInContent": "Aucune question trouvée dans le contenu",
	"editor.notice.noValidQuestion": "Aucune question valide trouvée",
	"editor.notice.imported": "{n} question(s) importée(s)",
	"editor.notice.importedFrom": "{n} question(s) importée(s) depuis {file}",
	"editor.notice.importError": "Erreur lors de l'import : {error}",
	"editor.notice.invalidGenerated": "Erreur : le quiz généré n'est pas valide.",
	"editor.notice.blockNotFound": "Erreur : bloc quiz-blocks introuvable",
	"editor.notice.saveError": "Erreur lors de la sauvegarde : {error}",
	"editor.notice.saved": "Sauvegardé",
	"editor.notice.cannotDeleteLast": "Impossible de supprimer la dernière question",
	"editor.notice.questionDeleted": "Question « {title} » supprimée",
	"editor.notice.noBlockInNote": "Aucun bloc quiz-blocks trouvé dans cette note",
	"editor.notice.importedFromNote": "Quiz importé depuis {file}",
	"editor.notice.readNoteError": "Erreur lors de la lecture de la note",
	"editor.notice.quizOpened": "Quiz ouvert : {file}",
	"editor.notice.openError": "Erreur lors de l'ouverture",
};
