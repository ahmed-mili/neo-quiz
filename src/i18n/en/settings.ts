/* Réglages du plugin (SettingTab) — anglais, dictionnaire de RÉFÉRENCE.
   Toute clé ajoutée ici doit l'être aussi dans i18n/fr/settings.ts, sinon le
   typecheck échoue (Record<TransKey, string>). */
export const EN_SETTINGS = {
	"settings.language.name": "Language",
	"settings.language.desc": "Interface language. Automatic follows your Obsidian language. This does not affect the language of generated quizzes, which always follows the language of your prompt.",
	"settings.language.auto": "Automatic (follow Obsidian)",
	"settings.language.en": "English",
	"settings.language.fr": "Français",
	"settings.codeHighlighting.name": "Code block highlighting",
	"settings.codeHighlighting.desc": "Syntax-highlight quiz-blocks code blocks in Source mode.",
	"settings.ai.tools.title": "AI tools",
	"settings.ai.outputFolder.name": "Generated quiz folder",
	"settings.ai.outputFolder.desc": "Relative folder where AI-generated quizzes are saved automatically.",
	"settings.ai.cliPath.title": "AI command-line tools",
	"settings.ai.cliPath.desc": "Leave empty unless Neo Quiz says the CLI is not installed while it works in your terminal: an installed application starts with the system PATH, not the one of your terminal. Give the full path to the executable.",
	"settings.ai.cliPath.claude": "Path to claude",
	"settings.ai.cliPath.codex": "Path to codex",
	"settings.ai.cliPath.placeholder": "Full path to the executable",

	/* ── À propos (application seulement) ── */
	"settings.about.title": "About",
	"settings.about.version": "{product} {version}",
	"settings.about.repo": "Source code and releases on GitHub",
} as const;
