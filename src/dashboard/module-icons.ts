/* ══════════════════════════════════════════════════════════
   MODULE ICONS — données pures (aucune dépendance à Obsidian).

   Extrait d'icon-picker.ts (tour de correction 1, tâche 6) : ces deux
   constantes ne sont que des DONNÉES (une liste de noms Lucide, un
   fallback), mais icon-picker.ts importe par ailleurs `setIcon` et
   `getIconIds` d'Obsidian pour son propre rendu (le sélecteur). Les fichiers
   qui n'ont besoin QUE du fallback (module-card.ts, quizzes.ts) importaient
   donc transitivement Obsidian pour rien : Vite/Rolldown résout tous les
   imports d'un fichier avant tout tree-shaking, si bien qu'importer une
   simple constante d'un fichier par ailleurs impur suffisait à faire
   échouer le bundle de l'application (cf. task-6-report.md).
══════════════════════════════════════════════════════════ */

/** Grille CURÉE affichée par défaut (sans recherche) — un jeu lisible et beau
    pour des matières / modules ; la recherche donne accès à tout le set Lucide. */
export const MODULE_ICONS = [
	"book", "book-text", "book-marked", "notebook", "notebook-text", "library",
	"graduation-cap", "file-text", "folder", "layers", "brain", "lightbulb",
	"target", "trophy", "star", "flask-conical", "atom", "microscope",
	"calculator", "sigma", "function-square", "dna", "cpu", "circuit-board",
	"code", "code-xml", "terminal", "braces", "binary", "bug",
	"network", "wifi", "router", "share-2", "cloud", "boxes",
	"shield-check", "shield", "lock", "key-round", "database", "server",
	"server-cog", "hard-drive", "monitor-cog", "globe", "languages", "map",
	"palette", "pen-tool", "music", "film", "briefcase", "list-checks",
	"scale", "trending-up", "rocket", "sparkles",
];

/** Icône d'un module sans choix explicite (fallback carte + aperçu modal). */
export const DEFAULT_MODULE_ICON = "book";
/** L'icône du SAS des quiz générés (`ctx.generatedFolder`) : la même que le
    bouton « Générer » du rail et la carte « Créer avec l'IA » — c'est le
    même geste vu depuis l'autre bout. */
export const GENERATED_MODULE_ICON = "sparkles";


/** L'icône d'un module : la sienne, sinon celle du SAS, sinon le défaut.
    UNE SEULE RÈGLE pour les trois lecteurs (la carte, le titre d'un dossier
    ouvert, le modal « Modifier dossier ») — symétrique de `moduleAccent`.
    Le modal la recalculait à la main et ignorait le SAS : il montrait un
    livre là où la carte montrait l'étincelle, et son aperçu contredisait
    ce que l'utilisateur avait sous les yeux (Ahmed, 2026-09-17). */
export function moduleIcon(m: { icon?: string }, opts?: { generated?: boolean }): string {
	return m.icon || (opts?.generated ? GENERATED_MODULE_ICON : DEFAULT_MODULE_ICON);
}