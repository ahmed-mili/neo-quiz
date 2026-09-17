import type { EN_SETTINGS } from "../en/settings";

/* Réglages du plugin — français. Le type force l'exhaustivité : une clé
   ajoutée à l'anglais et oubliée ici casse `npm run check`. */
export const FR_SETTINGS: Record<keyof typeof EN_SETTINGS, string> = {
	"settings.language.name": "Langue",
	"settings.language.desc": "Langue de l'interface. « Automatique » suit la langue d'Obsidian. Sans effet sur la langue des quiz générés, qui suit toujours celle de votre demande.",
	"settings.language.auto": "Automatique (suivre Obsidian)",
	"settings.language.en": "English",
	"settings.language.fr": "Français",
	"settings.codeHighlighting.name": "Coloration des blocs de code",
	"settings.codeHighlighting.desc": "Colore la syntaxe des blocs de code quiz-blocks en mode Source.",

	/* ── À propos (application seulement) ── */
	"settings.about.repo": "Code source et versions sur GitHub",
};
