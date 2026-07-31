import { Modal, Notice, setIcon } from "obsidian";
import { QbdModal } from "../modal-base";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleMap } from "./quiz-modules";
import { NewFolderModal, commonModuleParent } from "./module-edit";
import { parseZip } from "./zip";
import { QUIZ_BLOCK_RE } from "../quiz-utils";
import { makeDefault } from "../editor/utils";
import { exportAllWithFence } from "../editor/export";
import { openQuizPathInEditor } from "./quiz-open";

/* ══════════════════════════════════════════════════════════
   CREATE FOLDER — modal « Créer un dossier » calqué sur StudySmarter
   (capture Ahmed 2026-07-19) : trois cartes-options empilées (icône
   teintée + titre + description + chevron). Créer avec l'IA → page
   Générer ; Ensemble vide → NewFolderModal ; Importer → un zip partagé
   est dézippé et recréé dans le vault. Accents de la démo (vert/bleu/
   violet) posés inline, teinte dérivée en CSS.
══════════════════════════════════════════════════════════ */

/** Une carte-option du modal de création (icône teintée + titre + description
    + chevron) — partagée par CreateFolderModal ET CreateQuizModal : même DOM,
    mêmes classes, fidélité garantie à la capture StudySmarter (2026-07-19). */
function createOptionCard(modal: Modal, parent: HTMLElement, icon: string, accent: string, title: string, desc: string, onPick: () => void): void {
	const card = parent.createEl("button", { cls: "qbd-create-option" });
	card.type = "button";
	card.style.setProperty("--accent", accent);
	const ic = card.createDiv({ cls: "qbd-create-option-icon" });
	setIcon(ic, icon);
	const txt = card.createDiv({ cls: "qbd-create-option-text" });
	txt.createDiv({ cls: "qbd-create-option-title", text: title });
	txt.createDiv({ cls: "qbd-create-option-desc", text: desc });
	const chev = card.createDiv({ cls: "qbd-create-option-chevron" });
	setIcon(chev, "chevron-right");
	card.addEventListener("click", () => { modal.close(); onPick(); });
}

export class CreateFolderModal extends QbdModal {
	constructor(
		private ctx: DashboardCtx,
		private map: ModuleMap,
		private quizzes: QuizIndexEntry[],
		private onDone: () => void
	) {
		super(ctx.app);
	}

	onOpen(): void {
		this.modalEl.addClass("qbd-create-modal");
		this.titleEl.setText(t("dashboard.quizzes.createFolderTitle"));
		const c = this.contentEl;
		createOptionCard(this, c, "sparkles", "#3ddc84", t("dashboard.quizzes.createAiTitle"), t("dashboard.quizzes.createAiDesc"),
			() => this.ctx.navigate("ai"));
		createOptionCard(this, c, "folder-plus", "#4573ff", t("dashboard.quizzes.createEmptyTitle"), t("dashboard.quizzes.createEmptyDesc"),
			() => new NewFolderModal(this.ctx, this.map, this.quizzes, this.onDone).open());
		createOptionCard(this, c, "download", "#a78bfa", t("dashboard.quizzes.createImportTitle"), t("dashboard.quizzes.createImportDesc"),
			() => void importSharedFolder(this.ctx, this.map, this.quizzes, this.onDone));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** « Nouveau quiz » (drill-down d'un dossier) — MÊME modal à trois options que
    « Créer un dossier » (demande d'homogénéité Ahmed, capture 2026-07-19),
    décliné au niveau quiz : IA / quiz vierge dans CE dossier / import d'un
    quiz reçu dans CE dossier. */
export class CreateQuizModal extends QbdModal {
	constructor(
		private ctx: DashboardCtx,
		private folder: string,
		private onDone: () => void
	) {
		super(ctx.app);
	}

	onOpen(): void {
		this.modalEl.addClass("qbd-create-modal");
		this.titleEl.setText(t("dashboard.quizzes.createQuizTitle"));
		const c = this.contentEl;
		createOptionCard(this, c, "sparkles", "#3ddc84", t("dashboard.quizzes.createAiTitle"), t("dashboard.quizzes.createAiDesc"),
			() => this.ctx.navigate("ai"));
		createOptionCard(this, c, "file-plus", "#4573ff", t("dashboard.quizzes.createQuizEmptyTitle"), t("dashboard.quizzes.createQuizEmptyDesc"),
			() => void createQuizInFolder(this.ctx, this.folder));
		createOptionCard(this, c, "download", "#a78bfa", t("dashboard.quizzes.createQuizImportTitle"), t("dashboard.quizzes.createQuizImportDesc"),
			() => void importQuizIntoFolder(this.ctx, this.folder, this.onDone));
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/* ── Import d'un dossier partagé (.zip) : sélection cross-platform via un
   <input type=file> (desktop ET mobile, pas de dépendance Node), parseZip
   (store), puis recréation du dossier + de ses notes dans le vault. ── */

function pickFile(accept: string): Promise<{ name: string; bytes: Uint8Array } | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = accept;
		input.addEventListener("change", async () => {
			const file = input.files?.[0];
			if (!file) { resolve(null); return; }
			resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
		});
		input.click();
	});
}

export async function importSharedFolder(
	ctx: DashboardCtx,
	map: ModuleMap,
	quizzes: QuizIndexEntry[],
	onDone: () => void
): Promise<void> {
	const picked = await pickFile(".zip,application/zip");
	if (!picked) return;
	const entries = parseZip(picked.bytes);
	if (entries.length === 0) {
		new Notice(t("dashboard.quizzes.importEmpty"));
		return;
	}
	// Dossier cible : base du zip, assainie, sous le parent commun des modules ;
	// suffixe (2), (3)… si un dossier du même nom existe déjà.
	const base = picked.name.replace(/\.zip$/i, "").replace(/[\\/:*?"<>|]/g, "-").trim() || "Import";
	const parent = commonModuleParent(quizzes, map);
	const root = parent ? `${parent}/${base}` : base;
	let folderPath = root;
	for (let n = 2; ctx.app.vault.getAbstractFileByPath(folderPath); n++) folderPath = `${root} (${n})`;

	try {
		await ctx.app.vault.createFolder(folderPath);
		for (const e of entries) {
			// Aplatir : on n'écrit que le nom de note (pas de sous-chemins d'archive).
			const noteName = (e.name.split("/").pop() || e.name).replace(/[\\/:*?"<>|]/g, "-");
			if (!noteName) continue;
			await ctx.app.vault.create(`${folderPath}/${noteName}`, e.content);
		}
	} catch {
		new Notice(t("dashboard.quizzes.importError"));
		return;
	}

	// Déclaré en override : la carte du module apparaît tout de suite.
	const folderKey = folderPath.split("/").pop() as string;
	const overrides = { ...(ctx.plugin.settings.quizzesModuleOverrides || {}) };
	if (!overrides[folderKey]) overrides[folderKey] = { name: base };
	ctx.plugin.settings.quizzesModuleOverrides = overrides;
	ctx.plugin.saveSettings().catch(() => {});
	new Notice(t("dashboard.quizzes.importDone", { name: base, count: entries.length }));
	onDone();
}

/* ── Drill-down d'un dossier : créer un quiz dedans / y importer un quiz reçu.
   (Le header y remplace « New folder », qui n'a pas de sens dans un dossier —
   demande Ahmed 2026-07-19.) ── */

/** Chemin de note libre dans `folder` : « nom.md », sinon « nom (2).md »…
    `folder` vide = racine du vault (module « racine », légitime). */
function freeNotePath(ctx: DashboardCtx, folder: string, name: string): string {
	const base = name.replace(/[\\/:*?"<>|]/g, "-").trim() || "quiz";
	const prefix = folder ? `${folder}/` : "";
	let path = `${prefix}${base}.md`;
	for (let n = 2; ctx.app.vault.getAbstractFileByPath(path); n++) path = `${prefix}${base} (${n}).md`;
	return path;
}

/** Le dossier physique peut manquer (module déclaré par simple override). */
async function ensureFolder(ctx: DashboardCtx, folder: string): Promise<void> {
	if (folder && !ctx.app.vault.getAbstractFileByPath(folder)) await ctx.app.vault.createFolder(folder);
}

/** « New quiz » : note pré-remplie d'une question vierge (le même défaut que
    l'éditeur), puis ouverture directe dans l'éditeur visuel. */
export async function createQuizInFolder(ctx: DashboardCtx, folder: string): Promise<void> {
	try {
		await ensureFolder(ctx, folder);
		const path = freeNotePath(ctx, folder, t("dashboard.quizzes.newQuizDefaultName"));
		await ctx.app.vault.create(path, exportAllWithFence([makeDefault("single")]) + "\n");
		// En ÉDITION d'emblée : la question qu'on vient de créer est vierge.
		await openQuizPathInEditor(ctx.app, path, { edit: true });
	} catch {
		new Notice(t("dashboard.quizzes.newQuizError"));
	}
}

/** « Import » : un .md partagé (quiz seul) ou un .zip (plusieurs notes) est
    recréé DANS le dossier ouvert — le pendant réception de quizShareSource. */
export async function importQuizIntoFolder(ctx: DashboardCtx, folder: string, onDone: () => void): Promise<void> {
	const picked = await pickFile(".md,.zip,text/markdown,application/zip");
	if (!picked) return;
	try {
		await ensureFolder(ctx, folder);
		if (/\.zip$/i.test(picked.name)) {
			const entries = parseZip(picked.bytes).filter(e => QUIZ_BLOCK_RE.test(e.content));
			if (entries.length === 0) { new Notice(t("dashboard.quizzes.importEmpty")); return; }
			for (const e of entries) {
				const noteName = (e.name.split("/").pop() || e.name).replace(/\.md$/i, "");
				await ctx.app.vault.create(freeNotePath(ctx, folder, noteName), e.content);
			}
			new Notice(t("dashboard.quizzes.importDone", { name: folder.split("/").pop() || folder, count: entries.length }));
		} else {
			const content = new TextDecoder().decode(picked.bytes);
			if (!QUIZ_BLOCK_RE.test(content)) { new Notice(t("dashboard.quizzes.importNoQuiz")); return; }
			const name = picked.name.replace(/\.md$/i, "");
			await ctx.app.vault.create(freeNotePath(ctx, folder, name), content);
			new Notice(t("dashboard.quizzes.importQuizDone", { name }));
		}
	} catch {
		new Notice(t("dashboard.quizzes.importError"));
		return;
	}
	onDone();
}
