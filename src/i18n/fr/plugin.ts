import type { EN_PLUGIN } from "../en/plugin";

/* Domaine « plugin » — français. */
export const FR_PLUGIN: Record<keyof typeof EN_PLUGIN, string> = {
	/* ── En-tête du SettingTab (les deux réglages restants) ── */
	"plugin.intro": "Créez des quiz interactifs dans Obsidian à partir de blocs de code quiz-blocks.",

	/* ── Notices d'erreur de rendu d'un bloc ── */
	"plugin.block.error": "⚠️ Impossible de charger le quiz : {error}",
	"plugin.block.unknownError": "erreur inconnue",
	/* ── Résolution d'une note Quiz vers sa note Lesson (source) ── */
	"plugin.sourceRef.notFound": "Note source du quiz introuvable : {link}",
	"plugin.sourceRef.noBlock": "Aucun bloc quiz-blocks dans {link}",
	"plugin.sourceRef.chained": "{link} pointe vers une autre note — les références chaînées ne sont pas prises en charge",
	"plugin.sourceRef.empty": "{link} ne contient encore aucune question de test — ajoute des questions role: \"test\" (ou sans role) dans la leçon",
};
