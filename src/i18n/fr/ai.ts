import type { EN_AI } from "../en/ai";

/* Domaine « ai » — français. */
export const FR_AI: Record<keyof typeof EN_AI, string> = {
	/* ── Page « Générer » ── */
	"ai.page.title": "Générer un quiz",

	/* ── Composer ── */
	"ai.composer.placeholder": "Sur quoi portera le quiz ?",
	"ai.composer.addContent": "Ajouter du contenu",
	"ai.preview.size": "{kb} Ko",
	"ai.preview.linesOne": "{n} ligne",
	"ai.preview.linesOther": "{n} lignes",
	"ai.preview.pagesOne": "{n} page",
	"ai.preview.pagesOther": "{n} pages",
	"ai.preview.pageAlt": "Page {n}",
	"ai.preview.rendering": "Rendu des pages…",
	"ai.preview.renderFailed": "Ce PDF n'a pas pu être dessiné",
	"ai.preview.open": "Ouvrir",
	"ai.preview.openFailed": "Impossible d'ouvrir {name}",
	"ai.composer.quizOptions": "Options du quiz",
	"ai.composer.generate": "Générer le quiz",
	"ai.composer.stop": "Arrêter",
	"ai.add.files": "Ajouter des fichiers ou des images",
	"ai.add.notes": "Ajouter des notes",
	"ai.mention.noMatch": "Aucun fichier correspondant",
	"ai.mention.truncated": "Trop de fichiers dans {roots} — la recherche peut être incomplète",
	"ai.mention.externalRootGone": "Impossible d'attacher « {name} » : son dossier hors coffre a été retiré des réglages",

	/* ── Usage IA (ce qu'une génération a coûté) ──
	   RÉDUIT à la tâche 2 du chantier « greffon lecteur » (2026-09-13) :
	   l'écran « Limites d'utilisation » est parti à la tâche 1 avec le reste
	   du tableau de bord. Ne restent que les clés du badge et de l'infobulle
	   de la page « Générer » (`dashboard/usage-format.ts`), consommées par
	   l'APPLICATION. */
	"ai.usage.badge": "{tokens} tokens",
	"ai.usage.title": "Usage",
	"ai.usage.sessionCurrent": "Session actuelle",
	"ai.usage.allModels": "Tous les modèles",
	"ai.usage.usedPercent": "{n} % utilisés",
	"ai.usage.durationHoursMinutes": "{h} h {m} min",
	"ai.usage.durationMinutes": "{m} min",
	"ai.usage.durationDays": "{n} j",
	"ai.usage.justNow": "à l'instant",
	"ai.usage.minutesAgo": "il y a {n} min",
	"ai.usage.hoursAgo": "il y a {n} h",
	"ai.usage.windowHours": "{n} h",
	"ai.usage.windowDays": "{n} j",
	"ai.usage.windowPlan": "Forfait",

	/* ── Options de génération ── */
	"ai.options.tooltip": "{count} questions · {type}",
	"ai.type.mixed": "Mixte",
	"ai.type.single": "Choix unique",
	"ai.type.multiple": "Choix multiple",
	"ai.type.text": "Texte libre",
	"ai.type.comprehension": "Compréhension",

	/* ── Fournisseurs (sous-titres du menu) ── */
	"ai.provider.choose": "Choisir un fournisseur",
	"ai.provider.claudeSub": "Compte Pro / Max",
	"ai.provider.codexSub": "Codex CLI · Abonnement ChatGPT",
	"ai.provider.ollamaSub": "Local et cloud",

	/* ── Statuts (pastille + sous-titre du menu fournisseur) ── */
	"ai.status.claudeOk": "Claude Code v{version}",
	"ai.status.claudeMissing": "Claude Code non installé",
	"ai.status.codexOk": "Codex CLI v{version}",
	"ai.status.codexMissing": "Codex CLI non installé",
	"ai.status.ollamaOk": "Ollama v{version}",
	"ai.status.ollamaLocalOne": "{count} local + cloud",
	"ai.status.ollamaLocalMany": "{count} locaux + cloud",
	"ai.status.ollamaCloudReady": "Cloud prêt",
	"ai.status.serverStopped": "Serveur arrêté",
	"ai.status.notInstalled": "Non installé",
	"ai.status.desktopOnly": "Desktop uniquement",

	/* ── Hints contextuels sous le composer ── */
	"ai.hint.claudeDesktopOnly": "La génération via Claude est disponible sur desktop uniquement.",
	"ai.hint.claudeNotInstalled": "Claude Code n'est pas installé. Installez-le puis connectez votre compte avec « /login » :",
	"ai.hint.installClaude": "Installer Claude Code",
	"ai.hint.codexDesktopOnly": "La génération via ChatGPT (Codex CLI) est disponible sur desktop uniquement.",
	"ai.hint.codexNotInstalled": "Le Codex CLI n'est pas installé — c'est l'outil de terminal d'OpenAI, différent de l'application Codex. Installez-le puis connectez votre compte ChatGPT avec « codex login » :",
	"ai.hint.installCodex": "Installer Codex CLI",
	"ai.hint.ollamaServerOff": "Ollama est installé mais son serveur ne tourne pas.",
	"ai.hint.startOllama": "Démarrer Ollama",
	"ai.hint.ollamaNotInstalled": "Ollama n'est pas installé. Installez-le, lancez-le, et le plugin le détectera automatiquement :",
	"ai.hint.downloadOllama": "Télécharger Ollama",

	/* ── Modèles : accroche courte (à droite du nom) et description ── */
	"ai.modelHint.mostPowerful": "le plus puissant",
	"ai.modelHint.recommended": "recommandé",
	"ai.modelHint.everyday": "efficace au quotidien",
	"ai.modelHint.fastest": "le plus rapide",
	"ai.modelHint.fast": "rapide",
	"ai.modelHint.frontier": "frontier",
	"ai.modelHint.solid": "solide",
	"ai.modelHint.light": "léger",
	"ai.modelDesc.fable": "Pour vos défis les plus difficiles",
	"ai.modelDesc.opus": "Pour les tâches complexes",
	"ai.modelDesc.sonnet": "Le plus efficace pour les tâches quotidiennes",
	"ai.modelDesc.haiku": "Le plus rapide pour des réponses rapides",
	"ai.modelDesc.codexSol": "Dernier modèle frontière pour le code agentique",
	"ai.modelDesc.codexTerra": "Équilibré pour le travail quotidien",
	"ai.modelDesc.codexLuna": "Rapide et économique",
	"ai.modelDesc.codex55": "Pour le code complexe et la recherche",
	"ai.modelDesc.codex54": "Solide pour le code au quotidien",
	"ai.modelDesc.codex54mini": "Léger et rapide pour les tâches simples",

	/* ── Badge d'accès à Fable (déduit du forfait lu dans le trousseau du CLI) ── */
	"ai.badge.included": "Inclus",
	"ai.badge.usageCredits": "Crédits d'utilisation",

	/* ── Niveaux d'effort (sous-titres seulement) ── */
	"ai.effort.ultracodeSub": "xhigh + workflows",
	"ai.effort.ultraSub": "max + délégation auto",

	/* ── Scène : chargement, erreur, résultat ── */
	"ai.loading.title": "Quiz en cours de création…",
	"ai.error.title": "Échec de la génération",
	"ai.error.retry": "Réessayer",
	"ai.error.checkSettings": "Vérifiez vos paramètres IA dans les paramètres du plugin.",
	"ai.error.pdfUnsupportedInApp": "Les PDF joints ne sont pas encore pris en charge dans l'application Neo Quiz. Joignez le texte ou une image à la place.",
	"ai.error.providerUnavailable": "Ce fournisseur n'est pas encore disponible ici. Choisissez Ollama, ou générez le quiz depuis le greffon Obsidian.",
	"ai.result.count": "{count} questions générées",
	"ai.result.untitled": "Quiz généré",
	"ai.result.save": "Enregistrer",
	"ai.result.insert": "Insérer dans une note",

	/* ── Notices ── */
	"ai.notice.pdfNoText": "« {name} » : aucun texte extractible (PDF scanné ?)",
	"ai.notice.unsupportedFormat": "Format non pris en charge : {files} (images, PDF, .md, .txt)",
	"ai.notice.noteAlreadyAttached": "« {name} » est déjà attachée",
	"ai.notice.noteReadFailed": "Impossible de lire « {name} »",
	"ai.notice.pathsAttached": "Joint depuis votre demande : {files}",
	"ai.notice.pathsUnresolved": "Introuvable dans le vault ou les dossiers configurés : {files}",
	"ai.notice.pathsAmbiguous": "{count} fichiers correspondent à « {file} » — précisez un chemin plus long.",
	"ai.notice.pathsTooMany": "Seuls les {max} premiers fichiers cités dans votre demande ont été joints.",
	"ai.notice.blockExists": "Un bloc quiz-blocks existe déjà dans « {name} ». Ouvrez l'éditeur pour le modifier.",
	"ai.notice.quizInserted": "Quiz inséré dans « {name} »",
	"ai.notice.insertFailed": "Erreur lors de l'insertion",
	"ai.notice.saveFailed": "Impossible d’enregistrer le quiz généré.",

	/* ── Erreurs de génération (affichées dans l'écran d'erreur) ── */
	"ai.err.unknown": "Erreur inconnue",
	"ai.err.notAnArray": "La réponse IA n'est pas un tableau de questions.",
	"ai.err.noFileAccess": "Le générateur de quiz n'a pas accès à vos fichiers — il ne voit que le contenu du composer. Les chemins écrits dans votre demande sont joints automatiquement quand ils sont trouvés ; sinon, joignez les notes ou documents avec « + » ou « @ », ou collez leur contenu.",
	"ai.err.notQuiz": "Le modèle a répondu par du texte au lieu d'un quiz : « {preview}… »",
	"ai.err.invalidModelClaude": "Nom de modèle Claude invalide : {model}",
	"ai.err.claudeNotInstalled": "Claude Code n'est pas installé. Installez-le depuis claude.com/claude-code puis connectez-vous avec /login.",
	"ai.err.claudeTimeout": "Claude n'a pas répondu dans le délai imparti ({minutes} min). Réessayez.",
	"ai.err.claudeNotLoggedIn": "Compte Claude non connecté. Dans un terminal, lancez \"claude\" puis /login avec votre compte Pro/Max/Team/Enterprise.",
	"ai.err.claudeRateLimit": "Limite d'utilisation de votre abonnement Claude atteinte. Réessayez plus tard.",
	"ai.err.claudeUnreadable": "Réponse Claude Code illisible. Réessayez.",
	"ai.err.claudeEmpty": "Claude n'a retourné aucune réponse. Réessayez ou changez de modèle.",
	"ai.err.claudeCode": "Erreur Claude Code : {detail}",
	"ai.err.claude": "Erreur Claude : {detail}",
	"ai.err.invalidModelCodex": "Nom de modèle Codex invalide : {model}",
	"ai.err.codexNotInstalled": "Codex n'est pas installé. Installez-le (npm i -g @openai/codex) puis connectez-vous avec « codex login ».",
	"ai.err.codexTimeout": "ChatGPT (Codex) n'a pas répondu dans le délai imparti ({minutes} min). Réessayez.",
	"ai.err.codexNotLoggedIn": "Compte ChatGPT non connecté. Dans un terminal, lancez « codex login ».",
	"ai.err.codexRateLimit": "Limite d'utilisation de votre abonnement ChatGPT atteinte. Réessayez plus tard.",
	"ai.err.codexEmpty": "ChatGPT (Codex) n'a retourné aucune réponse. Réessayez ou changez de modèle.",
	"ai.err.codex": "Erreur Codex : {detail}",
	"ai.err.none": "aucun",
	"ai.err.httpStatus": "Erreur {status}",
	"ai.err.ollamaModelMissing": "Le modèle \"{model}\" n'est pas installé.\nExécutez dans un terminal : ollama pull {model}\nModèles disponibles : {models}",
	"ai.err.ollamaModelNotFound": "Le modèle \"{model}\" n'est pas installé.\nExécutez : ollama pull {model}",
	"ai.err.ollamaUnreachable": "Impossible de contacter Ollama sur {url}.\nVérifiez que le serveur est démarré (ollama serve).",
	"ai.err.ollamaUnreachableShort": "Impossible de contacter Ollama sur {url}. Vérifiez que le serveur est démarré.",
	"ai.err.ollamaOutOfMemory": "Mémoire insuffisante pour ce modèle{detail}.\nChoisissez un modèle plus petit dans la liste.",
	"ai.err.ollamaSubscription": "Ce modèle nécessite un abonnement Ollama : https://ollama.com/upgrade",
	"ai.err.ollamaSignin": "Modèle cloud Ollama : le daemon n'est pas connecté à votre compte.\nDans un terminal : ollama signin",
	"ai.err.ollamaHttp": "Erreur Ollama ({status}) : {detail}",
	"ai.err.ollama": "Erreur Ollama : {detail}",
	"ai.err.ollamaEmpty": "Ollama n'a retourné aucune réponse. Vérifiez que le modèle est installé.",

};
