import type { App, DataAdapter, TFile, View, WorkspaceLeaf } from "obsidian";
import type { EngineCtx } from "../types/engine-ctx";
import { t } from "../i18n";

/** Shell Electron minimal (surface réellement consommée : shell.openPath). */
interface ElectronShellLike {
	openPath(path: string): Promise<string>;
}

export type ResourceOpenMode = "default-app" | "system-chooser" | "failed";

export interface ResourceHandlers {
	quizNotice(msg: unknown, timeout?: number): void;
	findVaultFilesByExactName(fileName: string): TFile[];
	revealFileInObsidianExplorer(file: TFile | null | undefined): Promise<boolean>;
	openVaultFileFallback(file: TFile): Promise<boolean>;
	openWithDefaultAppFromVault(file: TFile | null | undefined): Promise<{ ok: boolean; mode: ResourceOpenMode }>;
	handleQuizResourceButtonClick(fileName: string | undefined): Promise<void>;
	bindQuizResourceButtons(rootEl?: Element | null): void;
}

export function createResourceHandlers(ctx: EngineCtx): ResourceHandlers {
	const QUIZ_RESOURCE_NOTICE_MS = { defaultApp: 3400, androidSystem: 7200, fallbackOpen: 2400, warning: 3200, error: 3200 };

	function quizNotice(msg: unknown, timeout = 4000): void {
		ctx.host.ui.notice(String(msg), timeout);
	}

	function findVaultFilesByExactName(fileName: string): TFile[] {
		const target = String(fileName ?? "").trim().toLowerCase();
		if (!target || typeof ctx.app === "undefined" || !ctx.app?.vault?.getFiles) return [];
		return ctx.app.vault.getFiles().filter((f: any) => String(f?.name ?? "").trim().toLowerCase() === target);
	}

	async function revealFileInObsidianExplorer(file: TFile | null | undefined): Promise<boolean> {
		if (!file) return false;
		try {
			let leaf: WorkspaceLeaf | null = (ctx.app.workspace?.getLeavesOfType?.("file-explorer") || [])[0];
			if (!leaf && typeof ctx.app.workspace?.getLeftLeaf === "function") {
				leaf = ctx.app.workspace.getLeftLeaf(false);
				if (leaf && typeof leaf.setViewState === "function") await leaf.setViewState({ type: "file-explorer", active: false });
			}
			if (!leaf) return false;
			await new Promise<void>(r => setTimeout(r, 60));
			const view = leaf?.view as (View & { revealInFolder?: (file: TFile) => Promise<void> }) | undefined;
			if (view && typeof view.revealInFolder === "function") {
				await view.revealInFolder(file);
				try { ctx.app.workspace?.revealLeaf?.(leaf); } catch (_) {}
				return true;
			}
		} catch (e) {
			console.warn("[Quiz] revealInFolder a échoué:", e);
		}
		return false;
	}

	async function openVaultFileFallback(file: TFile): Promise<boolean> {
		try {
			const leaf = ctx.app.workspace?.getLeaf?.(true);
			if (leaf && typeof leaf.openFile === "function") {
				await leaf.openFile(file);
				return true;
			}
		} catch (e) {
			console.warn("[Quiz] leaf.openFile a échoué:", e);
		}
		try {
			const url = ctx.app.vault?.getResourcePath?.(file);
			if (url) {
				window.open(url, "_blank");
				return true;
			}
		} catch (e) {
			console.warn("[Quiz] getResourcePath/window.open a échoué:", e);
		}
		return false;
	}

	async function openWithDefaultAppFromVault(file: TFile | null | undefined): Promise<{ ok: boolean; mode: ResourceOpenMode }> {
		if (!file) return { ok: false, mode: "failed" };
		// app.isMobile / app.openWithDefaultApp : API non documentée dans obsidian.d.ts
		// mais bien présente au runtime (même convention de cast que dashboard/ai.ts:144).
		const isMobile = !!(ctx.app as App & { isMobile?: boolean }).isMobile;
		try {
			const appWithOpen = ctx.app as App & { openWithDefaultApp?: (path: string) => Promise<void> };
			if (typeof appWithOpen.openWithDefaultApp === "function") {
				await appWithOpen.openWithDefaultApp(file.path);
				return { ok: true, mode: isMobile ? "system-chooser" : "default-app" };
			}
		} catch (e) {
			console.warn("[Quiz] app.openWithDefaultApp a échoué:", e);
		}
		try {
			// DataAdapter.getFullPath n'est déclaré que sur les classes concrètes
			// (FileSystemAdapter/CapacitorAdapter), pas sur l'interface générique.
			const adapter = ctx.app?.vault?.adapter as (DataAdapter & { getFullPath?: (path: string) => string }) | undefined;
			const absPath = adapter?.getFullPath?.(file.path);
			const electronRequire = (window as Window & { require?: (id: string) => { shell?: ElectronShellLike } }).require;
			const shell = electronRequire?.("electron")?.shell;
			if (absPath && shell?.openPath) {
				const result = await shell.openPath(absPath);
				if (result === "") return { ok: true, mode: "default-app" };
			}
		} catch (e) {
			console.warn("[Quiz] fallback Electron openPath a échoué:", e);
		}
		return { ok: false, mode: "failed" };
	}

	async function handleQuizResourceButtonClick(fileName: string | undefined): Promise<void> {
		try {
			const rawName = String(fileName ?? "").trim();
			if (!rawName) return void quizNotice(t("engine.resource.missingName"), QUIZ_RESOURCE_NOTICE_MS.warning);
			const matches = findVaultFilesByExactName(rawName);
			if (matches.length === 0) return void quizNotice(t("engine.resource.notFound", { name: rawName }), QUIZ_RESOURCE_NOTICE_MS.warning);
			if (matches.length > 1) quizNotice(t("engine.resource.duplicate", { name: rawName }), QUIZ_RESOURCE_NOTICE_MS.warning);
			const file = matches[0];
			const revealed = await revealFileInObsidianExplorer(file);
			await new Promise<void>(r => setTimeout(r, 180));
			const openResult = await openWithDefaultAppFromVault(file);
			if (openResult.ok && openResult.mode === "default-app") return void quizNotice(t("engine.resource.openedDefaultApp", { name: file.name }), QUIZ_RESOURCE_NOTICE_MS.defaultApp);
			if (openResult.ok && openResult.mode === "system-chooser") return void quizNotice(t("engine.resource.openedAndroid", { name: file.name }), QUIZ_RESOURCE_NOTICE_MS.androidSystem);
			const openedFallback = await openVaultFileFallback(file);
			if (openedFallback) return void quizNotice(t("engine.resource.openedInternal", { name: file.name }), QUIZ_RESOURCE_NOTICE_MS.fallbackOpen);
			quizNotice(
				t(revealed ? "engine.resource.noDefaultApp" : "engine.resource.openFailed", { name: file.name }),
				QUIZ_RESOURCE_NOTICE_MS.error
			);
		} catch (e) {
			console.error("[Quiz] handleQuizResourceButtonClick erreur:", e);
			quizNotice(t("engine.resource.openError"), QUIZ_RESOURCE_NOTICE_MS.error);
		}
	}

	function bindQuizResourceButtons(rootEl: Element | null = ctx.container): void {
		if (!rootEl) return;

		rootEl.querySelectorAll<HTMLElement>(".quiz-resource-btn[data-resource-file]").forEach(btn => {
			const trigger = async (e: Event): Promise<void> => {
				e.preventDefault();
				e.stopPropagation();
				await handleQuizResourceButtonClick(btn.dataset.resourceFile);
			};

			btn.addEventListener("click", trigger);
			btn.addEventListener("keydown", e => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					trigger(e);
				}
			});
		});
	}

	return {
		quizNotice,
		findVaultFilesByExactName,
		revealFileInObsidianExplorer,
		openVaultFileFallback,
		openWithDefaultAppFromVault,
		handleQuizResourceButtonClick,
		bindQuizResourceButtons
	};
}
