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

	/* ── À propos (application seulement) ── */
	"settings.about.repo": "Source code and releases on GitHub",
} as const;
