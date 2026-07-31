import { Notice, TFile } from "obsidian";
import { QbdModal } from "../modal-base";
import type { App } from "obsidian";
import { ShareModal, moduleShareSource, quizShareSource } from "./share";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup, ModuleMap } from "./quiz-modules";
import { ModuleEditModal } from "./module-edit";
import type { ActionMenuItem } from "./ui-select";
import { QUIZ_BLOCK_RE } from "../quiz-utils";

/* ══════════════════════════════════════════════════════════
   QUIZ MENU — contenu du menu ⋯ des cartes de « Mes quiz ».
   Dérivé de la capture StudySmarter d'Ahmed (Excalidraw, 2026-07-18) :
   Share / Edit / Rename / Archive / Delete (rouge), adaptés au plugin :
   - Share    → copie le bloc ```quiz-blocks``` dans le presse-papier ;
   - Rename   → renomme la NOTE (le titre d'un quiz EST son basename,
                cf. scanner.ts) — carte de quiz seulement, la carte de
                module renomme déjà via « Edit » ;
   - Archive  → masque le quiz partout, revient via la pilule « Archivés » ;
   - Delete   → supprime le bloc de la note (corbeille si la note ne
                contenait que lui) + ses stats, après confirmation.
   (« Pause study reminders » retiré le 2026-07-21 à la demande d'Ahmed —
   avec sa mécanique : sans entrée de menu, un quiz déjà suspendu serait
   resté hors du « À faire » sans aucun moyen de le reprendre.)
══════════════════════════════════════════════════════════ */

/* ── Liste persistée — même canal que quizzesExpandedFolders (quizzes.ts) :
   l'échec d'écriture ne casse pas l'UI. L'archivage est PAR DOSSIER (clé
   `folder` de module) — jamais de quiz archivé individuellement (décision
   Ahmed 2026-07-19). */

export function isFolderArchived(ctx: DashboardCtx, folder: string): boolean {
	return new Set(ctx.plugin.settings.quizzesArchivedFolders || []).has(folder);
}

export function setFolderArchived(ctx: DashboardCtx, folder: string, on: boolean): void {
	const set = new Set(ctx.plugin.settings.quizzesArchivedFolders || []);
	if (on) set.add(folder); else set.delete(folder);
	ctx.plugin.settings.quizzesArchivedFolders = [...set];
	ctx.plugin.saveSettings().catch(() => {});
}

/* ── Confirmations : l'ARCHIVAGE est direct dans les deux sens (demande
   Ahmed 2026-07-19), Delete confirme en rouge. ── */

interface ConfirmSpec {
	title: string;
	body: string;
	cta: string;
	/** true = bouton rouge (mod-warning) : Delete uniquement. */
	warning?: boolean;
}

class ConfirmModal extends QbdModal {
	constructor(app: App, private spec: ConfirmSpec, private onConfirm: () => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.spec.title);
		this.contentEl.createEl("p", { text: this.spec.body });
		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		const cancel = row.createEl("button", { text: t("editor.action.cancel") });
		cancel.addEventListener("click", () => this.close());
		const ok = row.createEl("button", { cls: this.spec.warning ? "mod-warning" : "mod-cta", text: this.spec.cta });
		ok.addEventListener("click", () => { this.close(); this.onConfirm(); });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/* ── Renommage d'un quiz ──
   Le titre d'un quiz EST le basename de sa note (scanner.ts) : renommer =
   renommer le fichier, via fileManager.renameFile — jamais vault.rename —
   pour qu'Obsidian réécrive les liens entrants ([[ancien nom]]) tout seul.
   Les stats suivent : stats-store écoute l'event vault "rename" (il couvre
   donc AUSSI un renommage fait à la main dans l'explorateur). */
class RenameQuizModal extends QbdModal {
	private name: string;

	constructor(private ctx: DashboardCtx, private quiz: QuizIndexEntry, private onDone: () => void) {
		super(ctx.app);
		this.name = quiz.basename;
	}

	onOpen(): void {
		this.modalEl.addClass("qbd-medit-modal");
		this.titleEl.setText(t("dashboard.quizzes.renameTitle"));
		const c = this.contentEl;
		c.createEl("p", { cls: "qbd-medit-label", text: t("dashboard.quizzes.renameLabel") });
		const input = c.createEl("input", { type: "text", cls: "qbd-medit-input", value: this.name });
		input.addEventListener("input", () => { this.name = input.value; });
		// Sélection du nom entier : le cas courant est de tout retaper.
		window.setTimeout(() => { input.focus(); input.select(); }, 0);

		const save = c.createEl("button", { cls: "qbd-medit-save", text: t("dashboard.quizzes.renameCta") });
		save.addEventListener("click", () => { void this.apply(); });
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") void this.apply(); });
	}

	private async apply(): Promise<void> {
		// Mêmes caractères interdits que freeNotePath (folder-create.ts).
		const name = this.name.trim().replace(/[\\/:*?"<>|]/g, "-");
		if (!name || name === this.quiz.basename) { this.close(); return; }
		const file = this.ctx.app.vault.getAbstractFileByPath(this.quiz.path);
		if (!(file instanceof TFile)) {
			new Notice(t("dashboard.detail.fileNotFound"));
			this.close();
			return;
		}
		const folder = file.parent && file.parent.path !== "/" ? `${file.parent.path}/` : "";
		const target = `${folder}${name}.${file.extension}`;
		if (this.ctx.app.vault.getAbstractFileByPath(target)) {
			new Notice(t("dashboard.quizzes.renameExists", { name }));
			return; // modal laissé ouvert : l'utilisateur corrige le nom
		}
		try {
			await this.ctx.app.fileManager.renameFile(file, target);
		} catch {
			new Notice(t("dashboard.quizzes.renameError"));
			return;
		}
		this.close();
		this.onDone();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

async function deleteQuiz(ctx: DashboardCtx, quiz: QuizIndexEntry): Promise<void> {
	const file = ctx.app.vault.getAbstractFileByPath(quiz.path);
	if (!file || !(file instanceof TFile)) {
		new Notice(t("dashboard.detail.fileNotFound"));
		return;
	}
	await deleteQuizCore(ctx, quiz, file);
	new Notice(t("dashboard.quizzes.deleted"));
}

/**
 * Cœur du delete, sans Notice (partagé quiz seul / module entier).
 *
 * `vault.process` et non `read` + `modify` : entre les deux, ce que
 * l'utilisateur venait d'écrire ailleurs dans la note était écrasé — et si ce
 * qu'il avait écrit était la seule chose qui restait, la note partait À LA
 * CORBEILLE sur la foi d'une lecture périmée (revue codex 2026-07-31). La
 * décision « il ne reste rien » se prend donc sur le contenu RÉEL au moment de
 * l'écriture, et la mise à la corbeille n'a lieu qu'après.
 */
async function deleteQuizCore(ctx: DashboardCtx, quiz: QuizIndexEntry, file: TFile): Promise<void> {
	let videApresRetrait = false;
	let avaitUnBloc = false;
	await ctx.app.vault.process(file, (content) => {
		// Le rappel peut être rejoué : repartir de zéro à chaque essai.
		avaitUnBloc = QUIZ_BLOCK_RE.test(content);
		if (!avaitUnBloc) { videApresRetrait = false; return content; }
		const remaining = content.replace(QUIZ_BLOCK_RE, "");
		videApresRetrait = remaining.trim().length === 0;
		// Rien d'autre dans la note : on ne la vide pas pour la jeter juste
		// après — on la laisse telle quelle et c'est la corbeille qui l'emporte.
		return videApresRetrait ? content : remaining;
	});
	/* Aucun bloc trouvé : la note a été vidée ailleurs entre-temps. On ne
	   touche ni au fichier ni aux statistiques — supprimer l'enregistrement
	   d'un quiz qu'on n'a pas supprimé effacerait un historique de révision
	   pour rien (revue codex 2026-07-31). */
	if (!avaitUnBloc) return;
	if (videApresRetrait) {
		// La note ne contenait que le quiz : corbeille (récupérable), jamais
		// de suppression définitive.
		await ctx.app.fileManager.trashFile(file);
	}
	ctx.statsStore?.deleteRecord(quiz.path);
}

/** Delete d'un MODULE entier : chaque quiz passe par le même cœur. */
async function deleteModuleQuizzes(ctx: DashboardCtx, group: ModuleGroup): Promise<void> {
	/* Une note qui résiste n'arrête pas les autres, et ne fait pas passer la
	   suppression pour un échec total : chaque quiz est indépendant, et laisser
	   une exception remonter d'ici laissait le module A MOITIÉ supprimé avec
	   une interface qui ne se redessinait même pas (revue codex 2026-07-31). */
	let echecs = 0;
	for (const q of group.quizzes) {
		const file = ctx.app.vault.getAbstractFileByPath(q.path);
		if (!(file instanceof TFile)) continue;
		try {
			await deleteQuizCore(ctx, q, file);
		} catch (e) {
			echecs++;
			console.error("[quiz-blocks] suppression impossible :", q.path, e);
		}
	}
	new Notice(echecs
		? t("dashboard.quizzes.deletedPartial", { count: echecs })
		: t("dashboard.quizzes.deleted"));
}

/* ── Menus ── */

/** Menu ⋯ d'une carte de quiz — l'ordre et la rangée rouge suivent la
    référence StudySmarter. Bâti AU CLIC (le nom du quiz peut avoir changé).
    AUCUNE entrée d'archivage : l'archivage n'existe qu'au niveau dossier
    (Ahmed 2026-07-19). */
export function buildQuizCardMenu(ctx: DashboardCtx, rerender: () => void): (quiz: QuizIndexEntry) => ActionMenuItem[] {
	return (quiz) => {
		return [
			{
				icon: "share-2",
				label: t("dashboard.quizzes.menuShare"),
				// Même modal de partage que les dossiers (Discord / enregistrer),
				// avec le .md du quiz seul — remplace l'ancienne copie de bloc
				// texte, jugée insuffisante (demande Ahmed 2026-07-19).
				onClick: () => { new ShareModal(ctx, quizShareSource(ctx, quiz)).open(); },
			},
			{
				icon: "pencil",
				label: t("dashboard.detail.edit"),
				// La page du quiz, en ÉDITION, DANS le dashboard : ouvrir un
				// onglet à côté ferait deux surfaces pour le même quiz, alors
				// qu'un clic sur la carte mène déjà à cette page.
				onClick: () => { ctx.navigate("detail", { quiz, edit: true }); },
			},
			{
				// « text-cursor-input » et non un crayon : « Edit » (pencil) ouvre
				// déjà l'éditeur de questions — deux crayons se confondraient.
				icon: "text-cursor-input",
				label: t("dashboard.quizzes.menuRename"),
				onClick: () => { new RenameQuizModal(ctx, quiz, rerender).open(); },
			},
			{
				icon: "trash-2",
				label: t("dashboard.quizzes.menuDelete"),
				danger: true,
				onClick: () => {
					new ConfirmModal(ctx.app, {
						title: t("dashboard.quizzes.deleteConfirmTitle"),
						body: t("dashboard.quizzes.deleteConfirmBody", { title: quiz.title }),
						cta: t("dashboard.quizzes.deleteConfirmCta"),
						warning: true,
					}, () => { void deleteQuiz(ctx, quiz).then(rerender); }).open();
				},
			},
		];
	};
}

/** Menu ⋯ d'une carte de module — mêmes rangées que la carte de quiz
    (demande Excalidraw 2026-07-18), adaptées au niveau module :
    Share = zip des notes du module (envoyable sur Discord), Edit = nom /
    UE / couleur du dossier (le renommage du module vit là, d'où l'absence
    d'entrée « Rename » ici), Archive = LE DOSSIER (flag unique
    quizzesArchivedFolders — jamais par quiz), Delete = tous les quiz du
    module (confirmation avec le compte). */
export function buildModuleCardMenu(ctx: DashboardCtx, rerender: () => void, map: ModuleMap): (g: ModuleGroup) => ActionMenuItem[] {
	return (g) => {
		const archived = isFolderArchived(ctx, g.folder);
		return [
			{
				icon: "share-2",
				label: t("dashboard.quizzes.menuShare"),
				onClick: () => { new ShareModal(ctx, moduleShareSource(ctx, g)).open(); },
			},
			{
				icon: "pencil",
				label: t("dashboard.detail.edit"),
				// Modal « Modifier dossier » calqué sur StudySmarter (nom / UE /
				// couleur, sans le toggle public) — remplace l'ancienne ouverture
				// de la note de correspondance, jugée non fonctionnelle.
				onClick: () => { new ModuleEditModal(ctx, g, map, rerender).open(); },
			},
			{
				icon: "archive",
				label: t(archived ? "dashboard.quizzes.menuUnarchive" : "dashboard.quizzes.menuArchive"),
				// Direct dans les deux sens (demande Ahmed 2026-07-19 : plus
				// aucune confirmation d'archivage). Un seul flag par DOSSIER :
				// opérationnel même quand la grille ne montre aucun quiz du
				// module (l'ancien modèle par-quiz rendait « Unarchive »
				// inopérant sur un module entièrement archivé, g.quizzes filtré
				// étant vide).
				onClick: () => { setFolderArchived(ctx, g.folder, !archived); rerender(); },
			},
			{
				icon: "trash-2",
				label: t("dashboard.quizzes.menuDeleteModule"),
				danger: true,
				onClick: () => {
					new ConfirmModal(ctx.app, {
						title: t("dashboard.quizzes.deleteConfirmTitle"),
						body: t("dashboard.quizzes.deleteModuleConfirmBody", { count: g.quizzes.length, name: g.name }),
						cta: t("dashboard.quizzes.deleteConfirmCta"),
						warning: true,
					}, () => { void deleteModuleQuizzes(ctx, g).then(rerender); }).open();
				},
			},
		];
	};
}
