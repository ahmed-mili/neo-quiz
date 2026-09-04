import type { HostFile } from "../host/types";
import type { EngineCtx } from "../types/engine-ctx";
import { t } from "../i18n";

export type ResourceOpenMode = "default-app" | "system-chooser" | "failed";

export interface ResourceHandlers {
	quizNotice(msg: unknown, timeout?: number): void;
	findFilesByExactName(fileName: string): HostFile[];
	handleQuizResourceButtonClick(fileName: string | undefined): Promise<void>;
	bindQuizResourceButtons(rootEl?: Element | null): void;
}

export function createResourceHandlers(ctx: EngineCtx): ResourceHandlers {
	const QUIZ_RESOURCE_NOTICE_MS = { defaultApp: 3400, androidSystem: 7200, fallbackOpen: 2400, warning: 3200, error: 3200 };

	function quizNotice(msg: unknown, timeout = 4000): void {
		ctx.host.ui.notice(String(msg), timeout);
	}

	function findFilesByExactName(fileName: string): HostFile[] {
		return ctx.host.fs.findByName(String(fileName ?? "").trim());
	}

	async function handleQuizResourceButtonClick(fileName: string | undefined): Promise<void> {
		try {
			const rawName = String(fileName ?? "").trim();
			if (!rawName) return void quizNotice(t("engine.resource.missingName"), QUIZ_RESOURCE_NOTICE_MS.warning);
			const matches = findFilesByExactName(rawName);
			if (matches.length === 0) return void quizNotice(t("engine.resource.notFound", { name: rawName }), QUIZ_RESOURCE_NOTICE_MS.warning);
			/* Plusieurs homonymes : on PRÉVIENT et on ouvre quand même le
			   premier. Refuser d'ouvrir laisserait l'élève sans son document
			   pour une ambiguïté qu'il n'a pas créée. */
			if (matches.length > 1) quizNotice(t("engine.resource.duplicate", { name: rawName }), QUIZ_RESOURCE_NOTICE_MS.warning);
			const file = matches[0];
			const revealed = await ctx.host.shell.revealInHost(file);
			/* Les 180 ms laissent l'explorateur d'Obsidian finir son animation
			   avant que le fichier s'ouvre par-dessus. Sur un hôte sans
			   explorateur (`revealInHost` rend false tout de suite) l'attente
			   est sans effet — c'est préférable à deux enchaînements
			   différents, qu'il faudrait garder synchrones. */
			await new Promise<void>(r => setTimeout(r, 180));
			const opened = await ctx.host.shell.openExternal(file);
			/* `openExternal` ne rend qu'un booléen ; l'ancien code distinguait
			   « ouvert avec l'appli par défaut » de « ouvert via le sélecteur
			   système » (Android) par un `mode` renvoyé par Obsidian. Cette
			   seule information venait de `app.isMobile`, donc on la
			   recalcule ici plutôt que d'élargir le contrat de l'hôte pour
			   une distinction purement cosmétique du toast. */
			const mode: ResourceOpenMode = opened ? (ctx.host.platform.isMobile ? "system-chooser" : "default-app") : "failed";
			if (mode === "default-app") return void quizNotice(t("engine.resource.openedDefaultApp", { name: file.name }), QUIZ_RESOURCE_NOTICE_MS.defaultApp);
			if (mode === "system-chooser") return void quizNotice(t("engine.resource.openedAndroid", { name: file.name }), QUIZ_RESOURCE_NOTICE_MS.androidSystem);
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
		findFilesByExactName,
		handleQuizResourceButtonClick,
		bindQuizResourceButtons
	};
}
