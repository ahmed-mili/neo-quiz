/* Réglages du plugin (SettingTab) — anglais, dictionnaire de RÉFÉRENCE.
   Toute clé ajoutée ici doit l'être aussi dans i18n/fr/settings.ts, sinon le
   typecheck échoue (Record<TransKey, string>). */
export const EN_SETTINGS = {
	"settings.language.name": "Language",
	"settings.language.desc": "Interface language. Automatic follows your Obsidian language. This does not affect the language of generated quizzes, which always follows the language of your prompt.",
	"settings.language.auto": "Automatic (follow Obsidian)",
	"settings.language.en": "English",
	"settings.language.fr": "Français",
	"settings.ai.mentionFolders.name": "Folders outside the vault",
	"settings.ai.mentionFolders.desc": "Folders the “@” picker also searches, on top of your vault. Press Enter to add. Desktop only.",
	"settings.ai.mentionFolders.remove": "Remove this folder",
	"settings.ai.mentionFolders.invalid": "Not a folder: {dir}",
	"settings.ai.mentionFolders.placeholder": "Folder path",
	"settings.ai.mentionFolders.vaultCollision": "Your vault already has a top-level folder named “{name}”. In the “@” picker, browsing into “{name}/” will always open the vault one — this folder stays findable by typing a search, just not by browsing.",
	"settings.ai.cliPath.title": "AI command-line tools",
	"settings.ai.cliPath.desc": "Leave empty unless Neo Quiz says the CLI is not installed while it works in your terminal: an installed application starts with the system PATH, not the one of your terminal. Give the full path to the executable.",
	"settings.ai.cliPath.claude": "Path to claude",
	"settings.ai.cliPath.codex": "Path to codex",
	"settings.ai.cliPath.placeholder": "Full path to the executable",
} as const;
