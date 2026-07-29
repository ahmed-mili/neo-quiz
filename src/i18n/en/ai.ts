/* Domaine « ai » — anglais, dictionnaire de RÉFÉRENCE.
   Toute clé ajoutée ici doit l'être aussi dans i18n/fr/ai.ts (le typage de
   FR_AI l'impose). Clés préfixées « ai. » : un domaine ne marche jamais
   sur les clés d'un autre. */
export const EN_AI = {
	/* ── Page « Générer » ── */
	"ai.page.title": "Generate a quiz",

	/* ── Composer ── */
	"ai.composer.placeholder": "What should the quiz be about ?",
	/* Au moins une pièce jointe (chip note/PDF ou vignette image) : le champ
	   devient réellement optionnel (canGenerate accepte texte OU images OU
	   notes) — la question d'origine n'a plus de sens, le sujet est déjà le
	   fichier joint. */
	"ai.composer.placeholderAttached": "Add instructions (optional)",
	"ai.composer.addContent": "Add content",
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
	   Un compteur absent n'est jamais rendu par un zéro : les clés « …Unavailable »
	   disent QUI ne publie pas la donnée, ce qui est une information, alors qu'un
	   « 0 » serait un mensonge. */
	"ai.usage.badge": "{tokens} tokens",
	"ai.usage.title": "Usage",
	"ai.usage.thisRun": "This generation",
	"ai.usage.today": "Today",
	"ai.usage.allTime": "Recorded so far",
	"ai.usage.input": "Input",
	"ai.usage.output": "Output",
	"ai.usage.cached": "of which cached",
	"ai.usage.cost": "Cost",
	"ai.usage.duration": "Duration",
	"ai.usage.generations": "{n} generations",
	"ai.usage.questions": "{n} questions",
	"ai.usage.costUnavailable": "Flat-rate plan — no per-request price",
	"ai.usage.tokensUnavailable": "This CLI does not report token counts",
	"ai.usage.plan": "Subscription",
	"ai.usage.planOff": "Turn on subscription usage in the settings to see how much of your plan is left.",
	"ai.usage.planUnavailable": "This provider does not publish plan usage",
	"ai.usage.window5h": "5 h",
	"ai.usage.window7d": "7 d",
	"ai.usage.window7dOpus": "7 d Opus",
	"ai.usage.windowHours": "{n} h",
	"ai.usage.windowDays": "{n} d",
	"ai.usage.windowPlan": "Plan",
	"ai.usage.resetInMinutes": "resets in {n} min",
	"ai.usage.resetInHours": "resets in {n} h",
	"ai.usage.resetInDays": "resets in {n} d",

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
	"ai.provider.kimiSub": "Kimi Code CLI · Kimi subscription",
	"ai.provider.ollamaSub": "Local and cloud",

	/* ── Statuts (pastille + sous-titre du menu fournisseur) ── */
	"ai.status.claudeOk": "Claude Code v{version}",
	"ai.status.claudeMissing": "Claude Code not installed",
	"ai.status.codexOk": "Codex CLI v{version}",
	"ai.status.codexMissing": "Codex CLI not installed",
	// Affiché que le compte soit connecté ou non : le CLI et sa version, comme
	// pour Claude/Codex/Ollama. C'est la PASTILLE (verte/orange) qui porte
	// l'état — inutile de le répéter en toutes lettres (demande Ahmed).
	"ai.status.kimiVersion": "Kimi Code v{version}",
	"ai.status.kimiMissing": "Kimi Code not installed",
	"ai.status.ollamaOk": "Ollama v{version}",
	"ai.status.ollamaLocalOne": "{count} local + cloud",
	"ai.status.ollamaLocalMany": "{count} local + cloud",
	"ai.status.ollamaCloudReady": "Cloud ready",
	"ai.status.serverStopped": "Server stopped",
	"ai.status.notInstalled": "Not installed",
	"ai.status.desktopOnly": "Desktop only",
	"ai.status.loginRequired": "Sign-in required",

	/* ── Hints contextuels sous le composer ── */
	"ai.hint.claudeDesktopOnly": "Generating with Claude is available on desktop only.",
	"ai.hint.claudeNotInstalled": "Claude Code is not installed. Install it, then connect your account with “/login”:",
	"ai.hint.installClaude": "Install Claude Code",
	"ai.hint.codexDesktopOnly": "Generating with ChatGPT (Codex CLI) is available on desktop only.",
	"ai.hint.codexNotInstalled": "The Codex CLI is not installed — it is OpenAI's terminal tool, different from the Codex app. Install it, then connect your ChatGPT account with “codex login”:",
	"ai.hint.installCodex": "Install Codex CLI",
	"ai.hint.kimiDesktopOnly": "Generating with Kimi (Kimi Code CLI) is available on desktop only.",
	"ai.hint.kimiNotInstalled": "The Kimi Code CLI is not installed. Install it, then connect your subscription with “/login”:",
	"ai.hint.installKimi": "Install Kimi Code",
	// Ni « installed », ni la version, ni ce qui se passera ensuite : le statut du
	// fournisseur donne déjà la version, et les modèles qui apparaissent se voient
	// (demande Ahmed). Ce message ne dit QUE ce qui manque et comment y remédier.
	"ai.hint.kimiNotLoggedIn": "No Kimi account connected. In a terminal, run “kimi” then type /login.",
	"ai.hint.kimiPlans": "See Kimi plans",
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

	/* ── Badge promo Fable (daté depuis le cache du CLI Claude Code) ── */
	"ai.badge.included": "Included",
	"ai.badge.includedUntil": "Included until {month} {day}",
	"ai.month.january": "January",
	"ai.month.february": "February",
	"ai.month.march": "March",
	"ai.month.april": "April",
	"ai.month.may": "May",
	"ai.month.june": "June",
	"ai.month.july": "July",
	"ai.month.august": "August",
	"ai.month.september": "September",
	"ai.month.october": "October",
	"ai.month.november": "November",
	"ai.month.december": "December",

	/* ── Niveaux d'effort : seuls les sous-titres sont traduits (low, medium,
	   high… sont le vocabulaire des CLI, identique dans toutes les langues). ── */
	"ai.effort.ultracodeSub": "xhigh + workflows",
	"ai.effort.ultraSub": "max + auto delegation",

	/* ── Scène : chargement, erreur, résultat ── */
	"ai.loading.title": "Creating your quiz…",
	"ai.error.title": "Generation failed",
	"ai.error.retry": "Try again",
	"ai.error.checkSettings": "Check your AI settings in the plugin settings.",
	"ai.result.count": "{count} questions generated",
	"ai.result.insert": "Insert into a note",
	"ai.result.restart": "Start over",

	/* ── Notices ── */
	"ai.notice.pdfNoText": "“{name}”: no extractable text (scanned PDF?)",
	"ai.notice.unsupportedFormat": "Unsupported format: {files} (images, PDF, .md, .txt)",
	"ai.notice.noteAlreadyAttached": "“{name}” is already attached",
	"ai.notice.noteReadFailed": "Could not read “{name}”",
	"ai.notice.blockExists": "A quiz-blocks block already exists in “{name}”. Open the editor to change it.",
	"ai.notice.quizInserted": "Quiz inserted into “{name}”",
	"ai.notice.insertFailed": "Insertion failed",

	/* ── Erreurs de génération (affichées dans l'écran d'erreur) ── */
	"ai.err.unknown": "Unknown error",
	"ai.err.notAnArray": "The AI response is not an array of questions.",
	"ai.err.invalidModelClaude": "Invalid Claude model name: {model}",
	"ai.err.claudeNotInstalled": "Claude Code is not installed. Install it from claude.com/claude-code, then sign in with /login.",
	"ai.err.claudeTimeout": "Claude did not answer within the time limit (3 min). Try again.",
	"ai.err.claudeNotLoggedIn": "Claude account not connected. In a terminal, run \"claude\" then /login with your Pro/Max/Team/Enterprise account.",
	"ai.err.claudeRateLimit": "You have reached the usage limit of your Claude subscription. Try again later.",
	"ai.err.claudeUnreadable": "Unreadable Claude Code response. Try again.",
	"ai.err.claudeEmpty": "Claude returned no response. Try again or switch model.",
	"ai.err.claudeCode": "Claude Code error: {detail}",
	"ai.err.claude": "Claude error: {detail}",
	"ai.err.invalidModelCodex": "Invalid Codex model name: {model}",
	"ai.err.codexNotInstalled": "Codex is not installed. Install it (npm i -g @openai/codex), then sign in with “codex login”.",
	"ai.err.codexTimeout": "ChatGPT (Codex) did not answer within the time limit (3 min). Try again.",
	"ai.err.codexNotLoggedIn": "ChatGPT account not connected. In a terminal, run “codex login”.",
	"ai.err.codexRateLimit": "You have reached the usage limit of your ChatGPT subscription. Try again later.",
	"ai.err.codexEmpty": "ChatGPT (Codex) returned no response. Try again or switch model.",
	"ai.err.codex": "Codex error: {detail}",
	"ai.err.invalidModelKimi": "Invalid Kimi model name: {model}",
	"ai.err.kimiNotInstalled": "Kimi Code is not installed. Install it from kimi.com/code, then sign in with /login.",
	"ai.err.kimiTimeout": "Kimi did not answer within the time limit (3 min). Try again.",
	"ai.err.kimiNotLoggedIn": "Kimi account not connected. In a terminal, run “kimi” then /login with your Kimi Code subscription.",
	"ai.err.kimiRateLimit": "You have reached the usage limit of your Kimi subscription. Try again later.",
	"ai.err.kimiEmpty": "Kimi returned no response. Try again or switch model.",
	"ai.err.kimiCode": "Kimi Code error: {detail}",
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

	/* ── Dictée (whisper.cpp local) ── */
	"ai.voice.transcribing": "Transcribing…",
	"ai.voice.recordHint": "{time} · release Space to transcribe",
	"ai.voice.micDenied": "Dictation: microphone permission denied.",
	"ai.voice.noMic": "Dictation: no microphone available.",
	"ai.voice.missingInstall": "Dictation: binary or model missing, see the Quiz Blocks settings.",
	"ai.voice.wavFailed": "Dictation: could not write the audio file.",
	"ai.voice.transcribeFailed": "Dictation: transcription failed (see console).",
	"ai.voice.noText": "Dictation: no text recognized.",
	"ai.voice.modelSmall": "Fast — small (190 MB)",
	"ai.voice.modelLarge": "Max — large-v3-turbo (574 MB)",
	"ai.voice.errUnknownBackend": "Unknown backend: {backend}",
	"ai.voice.errUnknownModel": "Unknown model: {model}",
	"ai.voice.errCliNotFound": "whisper-cli.exe not found after extraction",
} as const;
