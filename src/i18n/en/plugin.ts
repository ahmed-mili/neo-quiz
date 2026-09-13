/* Domaine « plugin » — anglais, dictionnaire de RÉFÉRENCE.
   Toute clé ajoutée ici doit l'être aussi dans i18n/fr/plugin.ts (le typage de
   FR_PLUGIN l'impose). Clés préfixées « plugin. » : un domaine ne marche jamais
   sur les clés d'un autre.

   RÉDUIT à la tâche 2 du chantier « greffon lecteur » (2026-09-13) : le
   `SettingTab` (types, exemple, commandes, tutoriels IA, raccourcis) est parti
   à la tâche 1 avec le dashboard et l'éditeur. Ne restent que les clés du
   PROCESSEUR de bloc (`apps/obsidian/plugin.ts`), le seul importeur qui
   subsiste — vérifié par `grep -rn '"plugin\.'` sur `src` et `apps`. */
export const EN_PLUGIN = {
	/* ── En-tête du SettingTab (les deux réglages restants) ── */
	"plugin.intro": "Create interactive quizzes in Obsidian from quiz-blocks code blocks.",

	/* ── Notices d'erreur de rendu d'un bloc ── */
	"plugin.block.error": "⚠️ Unable to load the quiz: {error}",
	"plugin.block.unknownError": "unknown error",
	/* ── Résolution d'une note Quiz vers sa note Lesson (source) ── */
	"plugin.sourceRef.notFound": "Quiz source not found: {link}",
	"plugin.sourceRef.noBlock": "No quiz-blocks block in {link}",
	"plugin.sourceRef.chained": "{link} points to another note — chained references are not supported",
	"plugin.sourceRef.empty": "{link} has no test question yet — add role: \"test\" questions (or leave role unset) to the lesson",
} as const;
