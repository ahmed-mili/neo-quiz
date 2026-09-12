import type { EN_SETTINGS } from "../en/settings";

/* Réglages du plugin — français. Le type force l'exhaustivité : une clé
   ajoutée à l'anglais et oubliée ici casse `npm run check`. */
export const FR_SETTINGS: Record<keyof typeof EN_SETTINGS, string> = {
	"settings.language.name": "Langue",
	"settings.language.desc": "Langue de l'interface. « Automatique » suit la langue d'Obsidian. Sans effet sur la langue des quiz générés, qui suit toujours celle de votre demande.",
	"settings.language.auto": "Automatique (suivre Obsidian)",
	"settings.language.en": "English",
	"settings.language.fr": "Français",
	"settings.ai.mentionFolders.name": "Dossiers hors du coffre",
	"settings.ai.mentionFolders.desc": "Dossiers que le picker « @ » cherche en plus de votre coffre. Entrée pour ajouter. Ordinateur uniquement.",
	"settings.ai.mentionFolders.remove": "Retirer ce dossier",
	"settings.ai.mentionFolders.invalid": "Ce n'est pas un dossier : {dir}",
	"settings.ai.mentionFolders.placeholder": "Chemin du dossier",
	"settings.ai.mentionFolders.vaultCollision": "Votre coffre a déjà un dossier de premier niveau nommé « {name} ». Dans le picker « @ », descendre dans « {name}/ » ouvrira toujours celui du coffre — ce dossier reste trouvable en tapant une recherche, pas en descendant dedans.",
	"settings.ai.tools.title": "Outils IA",
	"settings.ai.outputFolder.name": "Dossier des quiz générés",
	"settings.ai.outputFolder.desc": "Dossier relatif où les quiz générés par IA sont enregistrés automatiquement.",
	"settings.ai.cliPath.title": "Outils IA en ligne de commande",
	"settings.ai.cliPath.desc": "À laisser vide, sauf si Neo Quiz annonce le CLI comme non installé alors qu'il répond dans votre terminal : une application installée démarre avec le PATH du système, pas celui de votre terminal. Indiquez le chemin complet de l'exécutable.",
	"settings.ai.cliPath.claude": "Chemin de claude",
	"settings.ai.cliPath.codex": "Chemin de codex",
	"settings.ai.cliPath.placeholder": "Chemin complet de l'exécutable",

	/* ── À propos (application seulement) ── */
	"settings.about.title": "À propos",
	"settings.about.version": "{product} {version}",
	"settings.about.repo": "Code source et versions sur GitHub",
};
