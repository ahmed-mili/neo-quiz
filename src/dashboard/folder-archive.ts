import type { DashboardShellCtx } from "../types/dashboard-ctx";

/* ══════════════════════════════════════════════════════════
   FOLDER ARCHIVE — état d'archivage d'un dossier de « Mes quiz ».

   Extrait de quiz-menu.ts (tour de correction 1, tâche 6) : ces deux
   fonctions ne lisent que `ctx.settings.quizzesArchivedFolders` et
   `ctx.saveSettings()` — les cinq réglages de `DashboardShellCtx` depuis la
   tâche 5 — et n'ont donc aucune raison de vivre dans un fichier qui
   importe `Notice`/`TFile` pour ses modals. Les y laisser poisonnait tout
   appelant (home.ts, quizzes.ts) d'une dépendance TRANSITIVE à Obsidian :
   importer la seule fonction pure `isFolderArchived` suffisait à faire
   échouer le bundle de l'application (Vite/Rolldown résout tous les imports
   d'un fichier avant tout tree-shaking, cf. task-6-report.md).

   L'archivage est PAR DOSSIER (clé `folder` de module) — jamais de quiz
   archivé individuellement (décision Ahmed 2026-07-19).
══════════════════════════════════════════════════════════ */

export function isFolderArchived(ctx: DashboardShellCtx, folder: string): boolean {
	return new Set(ctx.settings.quizzesArchivedFolders || []).has(folder);
}

export function setFolderArchived(ctx: DashboardShellCtx, folder: string, on: boolean): void {
	const set = new Set(ctx.settings.quizzesArchivedFolders || []);
	if (on) set.add(folder); else set.delete(folder);
	ctx.settings.quizzesArchivedFolders = [...set];
	ctx.saveSettings().catch(() => {});
}
