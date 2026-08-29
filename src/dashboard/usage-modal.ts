import { setIcon } from "obsidian";
import type { App } from "obsidian";
import { QbdModal } from "../modal-base";
import { t, currentLang } from "../i18n";
import { isFableOffered, getClaudeModels, claudePromoNoticesFor } from "./ai-providers";
import {
	fetchPlanUsage, readUsageLog, summarize, startOfToday, providerPublishesPlan,
	formatTokens, formatCost, formatDuration, formatCountdown, formatResetMoment, formatAge
} from "./ai-usage";
import type { AiUsage, PlanUsage, UsagePlugin, UsageRow, UsageReadError } from "./ai-usage";

/* ══════════════════════════════════════════════════════════
   MODAL D'USAGE — l'écran « Limites d'utilisation » du forfait

   Reproduit l'écran officiel de Claude Code (capture de référence Ahmed du
   2026-07-30) : titre + forfait détecté, session courante, limites
   hebdomadaires, encart Fable, pied « Dernière mise à jour » avec
   rafraîchissement manuel. Sous cet écran vient ce que claude.ai ne connaît
   pas — ce que les générations du plugin ont coûté en tokens.

   Aucun chiffre n'est estimé : une valeur que le fournisseur ne publie pas
   reste absente (cf. l'en-tête d'ai-usage.ts).
══════════════════════════════════════════════════════════ */

/** Article de référence sur les limites d'usage (hub vérifié le 2026-07-30 ;
    les identifiants d'articles isolés changent, le hub reste). */
const USAGE_LIMITS_URL = "https://support.claude.com/en/collections/18031876-usage-and-limits";

export interface UsageModalOptions {
	plugin: UsagePlugin;
	/** Fournisseur courant : lui seul décide de ce qui est lisible. */
	provider: string;
	/** Dernière génération de la session d'écran, si l'appelant en a une. */
	usage: AiUsage | null;
	/** Dernière lecture réussie que l'appelant a sous la main : l'écran s'ouvre
	    rempli, et n'appelle l'endpoint que si elle a vieilli. */
	known?: PlanUsage | null;
	/** Chaque lecture réussie est rendue à l'appelant : l'écran qui a ouvert le
	    modal peut ainsi résumer le forfait (survol du bouton) sans relire. */
	onData?: (data: PlanUsage) => void;
}

/** Au-delà, une lecture est trop vieille pour être resservie à l'ouverture.
    L'endpoint d'usage borne lui-même la fréquence des lectures (429) : rouvrir
    l'écran trois fois d'affilée ne doit pas coûter trois appels. */
const FRESH_ENOUGH_MS = 60000;

class UsageModal extends QbdModal {
	private readonly options: UsageModalOptions;
	/** Dernière lecture RÉUSSIE — une lecture ratée ne l'écrase jamais : des
	    chiffres justes datés valent mieux qu'un écran vidé. */
	private data: PlanUsage | null = null;
	private error: UsageReadError | null = null;
	private loading = false;
	/** Une lecture qui revient après la fermeture ne doit pas toucher au DOM. */
	private closed = false;

	constructor(app: App, options: UsageModalOptions) {
		super(app);
		this.options = options;
		this.modalEl.addClass("qbd-usage-modal");
		// Repart de ce que l'appelant sait déjà : l'écran s'ouvre rempli.
		if (options.known && !options.known.error) this.data = options.known;
	}

	onOpen(): void {
		this.render();
		const age = this.data ? Date.now() - this.data.fetchedAt : Infinity;
		if (age > FRESH_ENOUGH_MS) void this.refresh();
	}

	onClose(): void {
		this.closed = true;
		this.contentEl.empty();
	}

	/** Relit l'état du forfait auprès du fournisseur (à l'ouverture, puis à la
	    demande). L'écran reste affiché pendant la lecture : on ne vide jamais
	    des chiffres justes pour les remplacer par une attente. */
	private async refresh(): Promise<void> {
		if (this.loading) return;
		this.loading = true;
		this.render();
		try {
			const data = await fetchPlanUsage(this.options.plugin, this.options.provider);
			// Remontée seulement si la lecture a abouti : l'écran appelant s'en
			// servira au prochain survol, et ne doit pas hériter d'un échec.
			if (!data.error) this.options.onData?.(data);
			if (this.closed) return;
			this.error = data.error;
			// Un échec conserve la dernière lecture réussie ; sans lecture
			// antérieure, on garde quand même le nom du forfait (lu localement,
			// donc valide même quand l'appel réseau échoue).
			if (!data.error || !this.data) this.data = data;
		} catch (e) {
			console.warn("[quiz-blocks] usage du forfait illisible:", e);
			if (!this.closed) this.error = { kind: "unavailable" };
		} finally {
			this.loading = false;
			if (!this.closed) this.render();
		}
	}

	private render(): void {
		const c = this.contentEl;
		c.empty();

		const head = c.createDiv({ cls: "qbd-usage-head" });
		head.createSpan({ cls: "qbd-usage-title", text: t("ai.usage.planTitle") });
		if (this.data?.plan) head.createSpan({ cls: "qbd-usage-plan", text: this.data.plan });

		this.renderPlan(c);
		this.renderFoot(c);
		this.renderAccounting(c);
	}

	/** Jauges du forfait, dans l'ordre de l'écran officiel : la session, puis
	    les limites hebdomadaires (globale puis par modèle). */
	private renderPlan(parent: HTMLElement): void {
		if (!this.options.plugin.settings.aiUsageLimitsEnabled) {
			parent.createDiv({ cls: "qbd-usage-note", text: t("ai.usage.planOff") });
			return;
		}

		const rows = this.data?.rows || [];
		// Les fenêtres courtes (session Claude, fenêtres Codex) en tête ; les
		// fenêtres longues sous leur propre titre.
		const short = rows.filter(r => r.kind === "session" || r.kind === "window");
		const weekly = rows.filter(r => r.kind === "weekly-all" || r.kind === "weekly-model");

		for (const row of short) this.renderRow(parent, row);

		if (weekly.length) {
			parent.createDiv({ cls: "qbd-usage-section", text: t("ai.usage.weeklyTitle") });
			this.renderFableNote(parent);
			this.renderLearnMore(parent);
			for (const row of weekly) this.renderRow(parent, row);
		} else if (short.length) {
			this.renderLearnMore(parent);
		}

		/* Rien à montrer : dire POURQUOI. Un échec de lecture n'est pas un
		   fournisseur muet — les confondre affiche une contre-vérité (« ce
		   fournisseur ne publie pas son forfait ») juste après avoir affiché
		   ses chiffres. */
		if (!rows.length && !this.loading && !this.error) {
			parent.createDiv({
				cls: "qbd-usage-note",
				text: providerPublishesPlan(this.options.provider)
					? t("ai.usage.noReading")
					: t("ai.usage.planUnavailable")
			});
		}
		if (this.error) {
			parent.createDiv({ cls: "qbd-usage-error", text: readErrorText(this.error) });
		}
	}

	/** Clé d'API de la fenêtre que cette jauge représente — c'est par elle que le
	    CLI Claude Code rattache ses notes promo (`tengu_rate_limit_promo_notices`).
	    Seules les correspondances CERTAINES sont déclarées : une ligne dont on ne
	    sait pas nommer la fenêtre n'affiche pas de note plutôt qu'une note posée
	    sur la mauvaise jauge. */
	private promoBarKey(row: UsageRow): string | null {
		if (this.options.provider !== "claude-code") return null;
		if (row.kind === "session") return "five_hour";
		if (row.kind === "weekly-all") return "seven_day";
		return null;
	}

	private renderRow(parent: HTMLElement, row: UsageRow): void {
		const el = parent.createDiv({ cls: "qbd-usage-row" });

		const info = el.createDiv({ cls: "qbd-usage-row-info" });
		info.createDiv({ cls: "qbd-usage-row-label", text: usageRowLabel(row) });
		const reset = rowReset(row);
		if (reset) info.createDiv({ cls: "qbd-usage-row-reset", text: reset });

		const bar = el.createDiv({ cls: "qbd-ai-usage-gauge-bar qbd-usage-bar" });
		const fill = bar.createDiv({ cls: "qbd-ai-usage-gauge-fill" });
		// Plafonné à 100 % : une barre qui déborde de son rail est un bug
		// visuel, pas une information de plus.
		fill.style.width = Math.max(0, Math.min(100, row.usedPercent)) + "%";
		if (row.usedPercent >= 90) fill.addClass("is-critical");
		else if (row.usedPercent >= 70) fill.addClass("is-warning");

		el.createDiv({
			cls: "qbd-usage-row-pct",
			text: t("ai.usage.usedPercent", { n: Math.round(row.usedPercent) })
		});

		/* Notes promo du CLI, sous la jauge qu'elles désignent. Texte affiché TEL
		   QUEL (anglais compris) : c'est une annonce d'Anthropic, datée par elle
		   — la traduire ou la reformuler la ferait mentir dès la prochaine
		   prolongation. */
		const promoBar = this.promoBarKey(row);
		for (const notice of promoBar ? claudePromoNoticesFor(promoBar) : []) {
			parent.createDiv({ cls: "qbd-usage-row-promo", text: notice.text });
		}
	}

	/** Encart d'information sur Fable — affiché seulement quand le CLI le propose
	    ET que le forfait tranche son mode d'accès : depuis le 2026-07-20, Fable
	    fait partie du forfait sur Max mais tourne aux crédits d'usage sur Pro
	    (cf. l'en-tête de la section Fable dans ai-providers.ts). Team et
	    Enterprise dépendent du SIÈGE, que le trousseau du CLI ne dit pas : rien
	    d'affiché plutôt qu'une des deux phrases prise au hasard. */
	private renderFableNote(parent: HTMLElement): void {
		// Prose : le forfait SANS son palier (« votre forfait Max »), comme
		// l'écran officiel — le « (5x) » n'appartient qu'au titre.
		const plan = this.data?.planName;
		if (this.options.provider !== "claude-code" || !plan || !isFableOffered()) return;
		const included = plan.toLowerCase() === "max";
		const metered = plan.toLowerCase() === "pro";
		if (!included && !metered) return;
		// Le libellé exact de Fable vient de la même table que le sélecteur de
		// modèles (donc du CLI), jamais d'un « Fable 5 » réécrit ici.
		const fable = getClaudeModels().find(m => m.value === "fable");
		if (!fable) return;

		const box = parent.createDiv({ cls: "qbd-usage-info" });
		const icon = box.createSpan({ cls: "qbd-usage-info-icon" });
		setIcon(icon, "info");
		const body = box.createDiv({ cls: "qbd-usage-info-body" });
		body.createDiv({
			cls: "qbd-usage-info-title",
			text: t(included ? "ai.usage.fableIncluded" : "ai.usage.fableCredits", { model: fable.label, plan })
		});
		body.createDiv({
			cls: "qbd-usage-info-text",
			text: t(included ? "ai.usage.fableIncludedNote" : "ai.usage.fableCreditsNote")
		});
	}

	private renderLearnMore(parent: HTMLElement): void {
		if (this.options.provider !== "claude-code") return;
		parent.createEl("a", {
			cls: "qbd-usage-link",
			text: t("ai.usage.learnMore"),
			href: USAGE_LIMITS_URL,
			attr: { target: "_blank", rel: "noopener" }
		});
	}

	/** Fraîcheur de la lecture + rafraîchissement manuel (comme claude.ai :
	    l'utilisateur décide quand redemander, rien ne sonde en boucle). */
	private renderFoot(parent: HTMLElement): void {
		if (!this.options.plugin.settings.aiUsageLimitsEnabled) return;
		const foot = parent.createDiv({ cls: "qbd-usage-foot" });

		foot.createSpan({
			cls: "qbd-usage-updated",
			text: this.data
				? t("ai.usage.lastUpdated", { when: formatAge(this.data.fetchedAt, Date.now()) })
				: t("ai.usage.loading")
		});

		const btn = foot.createEl("button", {
			cls: "qbd-usage-refresh",
			attr: { type: "button", "aria-label": t("ai.usage.refresh") }
		});
		setIcon(btn, "rotate-cw");
		if (this.loading) btn.addClass("is-spinning");
		btn.disabled = this.loading;
		btn.addEventListener("click", () => void this.refresh());
	}

	/** Ce que les générations DU PLUGIN ont coûté : hors périmètre de l'écran
	    officiel (qui ignore ce vault), donc nettement séparé de lui. */
	private renderAccounting(parent: HTMLElement): void {
		const log = readUsageLog(this.options.plugin);
		const usage = this.options.usage;
		if (!usage && log.length === 0) return;

		const wrap = parent.createDiv({ cls: "qbd-usage-accounting" });
		const row = (host: HTMLElement, label: string, value: string): void => {
			const r = host.createDiv({ cls: "qbd-ai-usage-row" });
			r.createSpan({ cls: "qbd-ai-usage-label", text: label });
			r.createSpan({ cls: "qbd-ai-usage-value", text: value });
		};

		if (usage) {
			const box = wrap.createDiv({ cls: "qbd-ai-usage-box" });
			box.createDiv({ cls: "qbd-ai-usage-box-title", text: t("ai.usage.thisRun") });
			box.createDiv({ cls: "qbd-ai-usage-model", text: usage.model || usage.provider });
			row(box, t("ai.usage.input"), formatTokens(usage.inputTokens)
				+ (usage.cachedInputTokens > 0 ? ` (${t("ai.usage.cached")} ${formatTokens(usage.cachedInputTokens)})` : ""));
			row(box, t("ai.usage.output"), formatTokens(usage.outputTokens));
			row(box, t("ai.usage.cost"), formatCost(usage.costUsd) ?? t("ai.usage.costUnavailable"));
			row(box, t("ai.usage.duration"), formatDuration(usage.durationMs));
		}

		if (log.length === 0) return;
		const now = Date.now();
		const today = summarize(log, startOfToday(now));
		const all = summarize(log);
		const box = wrap.createDiv({ cls: "qbd-ai-usage-box" });
		box.createDiv({ cls: "qbd-ai-usage-box-title", text: t("ai.usage.today") });
		row(box, t("ai.usage.generations", { n: today.generations }), formatTokens(today.inputTokens + today.outputTokens));
		if (today.costUsd != null) row(box, t("ai.usage.cost"), formatCost(today.costUsd) ?? "");
		box.createDiv({ cls: "qbd-ai-usage-box-title", text: t("ai.usage.allTime") });
		row(box, t("ai.usage.generations", { n: all.generations }), formatTokens(all.inputTokens + all.outputTokens));
		row(box, t("ai.usage.questions", { n: all.questions }), all.costUsd != null ? (formatCost(all.costUsd) ?? "") : "");
	}
}

/** Libellé d'une ligne, traduit AU RENDU (le modèle, lui, vient de l'API). */
export function usageRowLabel(row: UsageRow): string {
	if (row.kind === "session") return t("ai.usage.sessionCurrent");
	if (row.kind === "weekly-all") return t("ai.usage.allModels");
	if (row.kind === "weekly-model") return row.modelName || t("ai.usage.allModels");
	const mins = row.windowMinutes || 0;
	if (mins >= 1440) return t("ai.usage.windowDays", { n: Math.round(mins / 1440) });
	if (mins > 0) return t("ai.usage.windowHours", { n: Math.max(1, Math.round(mins / 60)) });
	return t("ai.usage.windowPlan");
}

/** Réarmement : en COMPTE À REBOURS pour une fenêtre courte (ce qui compte est
    le temps qui reste), en MOMENT ABSOLU pour une fenêtre longue (« dans 5 j »
    ne dit pas quand on est débloqué). */
function rowReset(row: UsageRow): string | null {
	if (row.kind === "weekly-all" || row.kind === "weekly-model") {
		const moment = formatResetMoment(row.resetsAt, currentLang());
		return moment ? t("ai.usage.resetsAt", { when: moment }) : null;
	}
	const countdown = formatCountdown(row.resetsAt, Date.now());
	return countdown ? t("ai.usage.resetsIn", { duration: countdown }) : null;
}

/** Ce qui s'est passé, en une phrase honnête. Le quota de LECTURE (429) est un
    délai, pas une panne : on dit combien de temps, puisque l'endpoint le dit. */
function readErrorText(error: UsageReadError): string {
	if (error.kind === "unauthenticated") return t("ai.usage.readUnauthenticated");
	if (error.kind === "unavailable") return t("ai.usage.readUnavailable");
	const seconds = error.retryAfterSec;
	if (seconds == null) return t("ai.usage.readRateLimited");
	const duration = seconds < 60
		? t("ai.usage.durationSeconds", { n: seconds })
		: t("ai.usage.durationMinutes", { m: Math.ceil(seconds / 60) });
	return t("ai.usage.readRateLimitedIn", { duration });
}

/** Résumé d'un coup d'œil pour le survol du bouton : la jauge la plus
    contrainte, celle qui décide s'il reste de la marge. */
export function tightestRow(rows: UsageRow[]): UsageRow | null {
	return rows.slice().sort((a, b) => b.usedPercent - a.usedPercent)[0] || null;
}

export function openUsageModal(app: App, options: UsageModalOptions): void {
	new UsageModal(app, options).open();
}
