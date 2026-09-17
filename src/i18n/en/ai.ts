/* Domaine « ai » — anglais, dictionnaire de RÉFÉRENCE.
   Toute clé ajoutée ici doit l'être aussi dans i18n/fr/ai.ts (le typage de
   FR_AI l'impose). Clés préfixées « ai. » : un domaine ne marche jamais
   sur les clés d'un autre. */
export const EN_AI = {
	/* ── Page « Générer » ── */
	"ai.page.title": "Generate a quiz",

	/* ── Composer ── */
	"ai.composer.placeholder": "What should the quiz be about?",
	"ai.composer.addContent": "Add content",
	/* ── L'aperçu d'une pièce jointe (clic sur sa carte) ── */
	"ai.preview.size": "{kb} KB",
	"ai.preview.linesOne": "{n} line",
	"ai.preview.linesOther": "{n} lines",
	"ai.preview.pagesOne": "{n} page",
	"ai.preview.pagesOther": "{n} pages",
	"ai.preview.pageAlt": "Page {n}",
	"ai.preview.rendering": "Rendering pages…",
	"ai.preview.renderFailed": "This PDF could not be drawn",
	"ai.preview.open": "Open",
	"ai.preview.openFailed": "Could not open {name}",
	"ai.composer.quizOptions": "Quiz options",
	"ai.composer.generate": "Generate quiz",
	"ai.composer.stop": "Stop",
	"ai.add.files": "Add files or images",
	"ai.add.notes": "Add notes",
	/* Picker « @ » : aucune entrée pour le token tapé. */
	"ai.mention.noMatch": "No matching file",
	/* Pied du menu : une garde anti-explosion a coupé l'indexation d'une ou
	   plusieurs racines externes — on ne tronque jamais en silence. */
	"ai.mention.truncated": "Too many files in {roots} — search may be incomplete",
	/* resolveExternalPath a renvoyé null (racine retirée des réglages pendant
	   que le menu était ouvert) : le token a déjà été effacé, rien n'est
	   attaché — jamais un échec silencieux. */
	"ai.mention.externalRootGone": "Couldn't attach “{name}”: its external folder was removed from settings",

	/* ── Usage IA (ce qu'une génération a coûté) ──
	   RÉDUIT à la tâche 2 du chantier « greffon lecteur » (2026-09-13) :
	   l'ÉCRAN « Limites d'utilisation » (`dashboard/ai-usage.ts`,
	   `usage-modal.ts`) est parti à la tâche 1 avec le reste du tableau de
	   bord — ce n'était plus « l'écran d'usage reste au greffon », il n'y a
	   plus de greffon-dashboard du tout. Ne restent que les clés que
	   `dashboard/usage-format.ts` compose encore pour le badge et l'infobulle
	   de la page « Générer » elle-même, consommées par l'APPLICATION. */
	"ai.usage.badge": "{tokens} tokens",
	"ai.usage.title": "Usage",
	"ai.usage.sessionCurrent": "Current session",
	"ai.usage.allModels": "All models",
	// Sans espace avant le %, contrairement au français : c'est la typographie
	// de chaque langue, pas une incohérence.
	"ai.usage.usedPercent": "{n}% used",
	"ai.usage.durationHoursMinutes": "{h} h {m} min",
	"ai.usage.durationMinutes": "{m} min",
	"ai.usage.durationDays": "{n} d",
	"ai.usage.justNow": "just now",
	"ai.usage.minutesAgo": "{n} min ago",
	"ai.usage.hoursAgo": "{n} h ago",
	"ai.usage.windowHours": "{n} h",
	"ai.usage.windowDays": "{n} d",
	"ai.usage.windowPlan": "Plan",

	/* ── Options de génération ── */
	"ai.options.tooltip": "{count} questions · {type}",
	/* Libellés des types de questions. La VALEUR envoyée au modèle reste
	   canonique (cf. TYPE_VALUES dans dashboard/ai.ts) : ces libellés ne
	   servent qu'à l'affichage. */
	"ai.type.mixed": "Mixed",
	"ai.type.single": "Single choice",
	"ai.type.multiple": "Multiple choice",
	"ai.type.text": "Free text",
	"ai.type.comprehension": "Comprehension",

	/* ── Fournisseurs (sous-titres du menu) ── */
	"ai.provider.choose": "Choose a provider",
	"ai.provider.claudeSub": "Pro / Max account",
	"ai.provider.codexSub": "Codex CLI · ChatGPT subscription",
	"ai.provider.ollamaSub": "Local and cloud",

	/* ── Statuts (pastille + sous-titre du menu fournisseur) ── */
	"ai.status.claudeOk": "Claude Code v{version}",
	"ai.status.claudeMissing": "Claude Code not installed",
	"ai.status.codexOk": "Codex CLI v{version}",
	"ai.status.codexMissing": "Codex CLI not installed",
	// Affiché que le compte soit connecté ou non : le CLI et sa version, comme
	// pour Claude/Codex/Ollama. C'est la PASTILLE (verte/orange) qui porte
	// l'état — inutile de le répéter en toutes lettres (demande Ahmed).
	"ai.status.ollamaOk": "Ollama v{version}",
	"ai.status.ollamaLocalOne": "{count} local + cloud",
	"ai.status.ollamaLocalMany": "{count} local + cloud",
	"ai.status.ollamaCloudReady": "Cloud ready",
	"ai.status.serverStopped": "Server stopped",
	"ai.status.notInstalled": "Not installed",
	"ai.status.desktopOnly": "Desktop only",

	/* ── Hints contextuels sous le composer ── */
	"ai.hint.claudeDesktopOnly": "Generating with Claude is available on desktop only.",
	"ai.hint.claudeNotInstalled": "Claude Code is not installed. Install it, then connect your account with “/login”:",
	"ai.hint.installClaude": "Install Claude Code",
	"ai.hint.codexDesktopOnly": "Generating with ChatGPT (Codex CLI) is available on desktop only.",
	"ai.hint.codexNotInstalled": "The Codex CLI is not installed — it is OpenAI's terminal tool, different from the Codex app. Install it, then connect your ChatGPT account with “codex login”:",
	"ai.hint.installCodex": "Install Codex CLI",
	// Ni « installed », ni la version, ni ce qui se passera ensuite : le statut du
	// fournisseur donne déjà la version, et les modèles qui apparaissent se voient
	// (demande Ahmed). Ce message ne dit QUE ce qui manque et comment y remédier.
	"ai.hint.ollamaServerOff": "Ollama is installed but its server is not running.",
	"ai.hint.startOllama": "Start Ollama",
	"ai.hint.ollamaNotInstalled": "Ollama is not installed. Install it, start it, and the plugin will detect it automatically:",
	"ai.hint.downloadOllama": "Download Ollama",

	/* ── Modèles : accroche courte (à droite du nom) et description ── */
	"ai.modelHint.mostPowerful": "most powerful",
	"ai.modelHint.recommended": "recommended",
	"ai.modelHint.everyday": "efficient day to day",
	"ai.modelHint.fastest": "fastest",
	"ai.modelHint.fast": "fast",
	"ai.modelHint.frontier": "frontier",
	"ai.modelHint.solid": "solid",
	"ai.modelHint.light": "light",
	"ai.modelDesc.fable": "For your toughest challenges",
	"ai.modelDesc.opus": "For complex tasks",
	"ai.modelDesc.sonnet": "Most efficient for everyday tasks",
	"ai.modelDesc.haiku": "Fastest for quick answers",
	"ai.modelDesc.codexSol": "Latest frontier model for agentic coding",
	"ai.modelDesc.codexTerra": "Balanced for everyday work",
	"ai.modelDesc.codexLuna": "Fast and affordable",
	"ai.modelDesc.codex55": "For complex coding and research",
	"ai.modelDesc.codex54": "Solid for everyday coding",
	"ai.modelDesc.codex54mini": "Light and fast for simple tasks",

	/* ── Badge d'accès à Fable (déduit du forfait lu dans le trousseau du CLI) ── */
	"ai.badge.included": "Included",
	"ai.badge.usageCredits": "Usage credits",

	/* ── Niveaux d'effort : seuls les sous-titres sont traduits (low, medium,
	   high… sont le vocabulaire des CLI, identique dans toutes les langues). ── */
	"ai.effort.ultracodeSub": "xhigh + workflows",
	"ai.effort.ultraSub": "max + auto delegation",

	/* ── Scène : chargement, erreur, résultat ── */
	"ai.loading.title": "Creating your quiz…",
	"ai.error.title": "Generation failed",
	"ai.error.retry": "Try again",
	"ai.error.checkSettings": "Check your AI settings in the plugin settings.",
	/* L'hôte ne sait pas lancer de CLI (rejet `indisponible` de
	   `host.process.run`). Ce n'est ni une panne ni une absence d'installation :
	   le dire autrement enverrait l'utilisateur réinstaller un CLI qu'il a déjà. */
	/* L'application n'embarque pas de moteur PDF (`HostPdf`, membre optionnel
	   du contrat, absent côté app) : le PDF est refusé, jamais joint vide. */
	"ai.error.pdfUnsupportedInApp": "PDF attachments are not supported in the Neo Quiz app yet. Attach the text or an image instead.",
	"ai.error.providerUnavailable": "This provider is not available here yet. Pick Ollama, or generate the quiz from the Obsidian plugin.",
	"ai.result.count": "{count} questions generated",
	"ai.result.untitled": "Generated quiz",
	"ai.result.save": "Save",
	"ai.result.insert": "Insert into a note",

	/* ── Notices ── */
	"ai.notice.pdfNoText": "“{name}”: no extractable text (scanned PDF?)",
	"ai.notice.unsupportedFormat": "Unsupported format: {files} (images, PDF, .md, .txt)",
	"ai.notice.noteAlreadyAttached": "“{name}” is already attached",
	"ai.notice.noteReadFailed": "Could not read “{name}”",
	/* Chemins cités dans le prompt et attachés automatiquement (prompt-paths.ts). */
	"ai.notice.pathsAttached": "Attached from your request: {files}",
	"ai.notice.pathsUnresolved": "Not found in your vault or configured folders: {files}",
	"ai.notice.pathsAmbiguous": "{count} files match “{file}” — write a longer path to pick one.",
	"ai.notice.pathsTooMany": "Only the first {max} files named in your request were attached.",
	"ai.notice.blockExists": "A quiz-blocks block already exists in “{name}”. Open the editor to change it.",
	"ai.notice.quizInserted": "Quiz inserted into “{name}”",
	"ai.notice.insertFailed": "Insertion failed",
	"ai.notice.saveFailed": "The generated quiz could not be saved.",

	/* ── Erreurs de génération (affichées dans l'écran d'erreur) ── */
	"ai.err.unknown": "Unknown error",
	"ai.err.notAnArray": "The AI response is not an array of questions.",
	/* Le modèle a répondu autre chose qu'un quiz. Ces deux messages remplacent
	   l'erreur brute du parseur JSON5, incompréhensible sur de la prose. */
	"ai.err.noFileAccess": "The quiz generator has no access to your files — it only sees what is in the composer. Paths written in your request are attached automatically when they can be found; when they cannot, attach the notes or documents with “+” or “@”, or paste their content.",
	"ai.err.notQuiz": "The model replied with text instead of a quiz: “{preview}…”",
	"ai.err.invalidModelClaude": "Invalid Claude model name: {model}",
	"ai.err.claudeNotInstalled": "Claude Code is not installed. Install it from claude.com/claude-code, then sign in with /login.",
	"ai.err.claudeTimeout": "Claude did not answer within the time limit ({minutes} min). Try again.",
	"ai.err.claudeNotLoggedIn": "Claude account not connected. In a terminal, run \"claude\" then /login with your Pro/Max/Team/Enterprise account.",
	"ai.err.claudeRateLimit": "You have reached the usage limit of your Claude subscription. Try again later.",
	"ai.err.claudeUnreadable": "Unreadable Claude Code response. Try again.",
	"ai.err.claudeEmpty": "Claude returned no response. Try again or switch model.",
	"ai.err.claudeCode": "Claude Code error: {detail}",
	"ai.err.claude": "Claude error: {detail}",
	"ai.err.invalidModelCodex": "Invalid Codex model name: {model}",
	"ai.err.codexNotInstalled": "Codex is not installed. Install it (npm i -g @openai/codex), then sign in with “codex login”.",
	"ai.err.codexTimeout": "ChatGPT (Codex) did not answer within the time limit ({minutes} min). Try again.",
	"ai.err.codexNotLoggedIn": "ChatGPT account not connected. In a terminal, run “codex login”.",
	"ai.err.codexRateLimit": "You have reached the usage limit of your ChatGPT subscription. Try again later.",
	"ai.err.codexEmpty": "ChatGPT (Codex) returned no response. Try again or switch model.",
	"ai.err.codex": "Codex error: {detail}",
	"ai.err.none": "none",
	"ai.err.httpStatus": "Error {status}",
	"ai.err.ollamaModelMissing": "Model \"{model}\" is not installed.\nRun in a terminal: ollama pull {model}\nAvailable models: {models}",
	"ai.err.ollamaModelNotFound": "Model \"{model}\" is not installed.\nRun: ollama pull {model}",
	"ai.err.ollamaUnreachable": "Cannot reach Ollama at {url}.\nMake sure the server is running (ollama serve).",
	"ai.err.ollamaUnreachableShort": "Cannot reach Ollama at {url}. Make sure the server is running.",
	"ai.err.ollamaOutOfMemory": "Not enough memory for this model{detail}.\nPick a smaller model from the list.",
	"ai.err.ollamaSubscription": "This model requires an Ollama subscription: https://ollama.com/upgrade",
	"ai.err.ollamaSignin": "Ollama cloud model: the daemon is not connected to your account.\nIn a terminal: ollama signin",
	"ai.err.ollamaHttp": "Ollama error ({status}): {detail}",
	"ai.err.ollama": "Ollama error: {detail}",
	"ai.err.ollamaEmpty": "Ollama returned no response. Make sure the model is installed.",

} as const;
