import { Platform, requestUrl } from "obsidian";
import type { Plugin } from "obsidian";
import type { AiSettings } from "../types/dashboard-ctx";
import { t } from "../i18n";

/* ══════════════════════════════════════════════════════════
   USAGE IA — ce qu'une génération a réellement coûté.

   Trois grandeurs, de fiabilité DÉCROISSANTE, jamais confondues dans l'UI :

   1. TOKENS — mesurés, rendus par le fournisseur lui-même à chaque appel.
      Toujours vrais quand ils sont là.
   2. COÛT en dollars — seul Claude Code le renvoie (`total_cost_usd`). Ailleurs
      il reste `null` : un abonnement forfaitaire n'a pas de prix à la requête,
      et l'inventer serait un chiffre faux affiché avec assurance.
   3. % DU FORFAIT — vient d'une source EXTERNE à la génération (endpoint
      d'usage du compte, fichier de session du CLI). Optionnel, faillible,
      donc toujours présenté comme une lecture datée, jamais comme un total.

   Aucune de ces valeurs n'est estimée : ce qu'un fournisseur ne dit pas reste
   absent de l'écran.
══════════════════════════════════════════════════════════ */

/** Une limite de forfait telle que le fournisseur la publie (fenêtre + taux). */
export interface AiLimit {
	/** Libellé de la fenêtre, déjà traduit (« 5 h », « 7 j »). */
	label: string;
	usedPercent: number;
	/** Fin de la fenêtre courante, en ms epoch ; null si le fournisseur ne la donne pas. */
	resetsAt: number | null;
}

/** Consommation d'UNE génération. */
export interface AiUsage {
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	/** Tokens d'entrée servis par le cache (sous-ensemble de inputTokens selon le fournisseur). */
	cachedInputTokens: number;
	/** Coût réel en dollars — `null` dès que le fournisseur ne le publie pas. */
	costUsd: number | null;
	durationMs: number;
	/** Identifiant de session du fournisseur, quand il sert à retrouver ses quotas. */
	sessionId?: string;
}

/** Entrée persistée de l'historique (usage + horodatage + volume produit). */
export interface AiUsageEntry extends AiUsage {
	at: number;
	questionCount: number;
}

/** Hôte plugin : seuls `settings` et `saveData` sont touchés. */
export type UsagePlugin = Plugin & {
	settings: AiSettings & { aiUsageLog?: AiUsageEntry[]; aiUsageLimitsEnabled?: boolean };
	saveSettings?: () => Promise<void>;
};

/** Au-delà, l'historique est tronqué : c'est un journal de consultation, pas une archive. */
const USAGE_LOG_MAX = 300;

export const totalTokens = (u: AiUsage): number => u.inputTokens + u.outputTokens;

/** « 12,4k » — un ordre de grandeur lisible d'un coup d'œil, pas une comptabilité. */
export function formatTokens(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "0";
	if (n < 1000) return String(Math.round(n));
	if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, "") + "k";
	return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
}

/** Coût en dollars ; `null` (fournisseur muet) n'est JAMAIS rendu comme « 0 $ ». */
export function formatCost(usd: number | null): string | null {
	if (usd == null || !Number.isFinite(usd)) return null;
	if (usd < 0.01) return "<$0.01";
	return "$" + usd.toFixed(usd < 1 ? 3 : 2);
}

export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "";
	if (ms < 1000) return Math.round(ms) + " ms";
	const s = ms / 1000;
	if (s < 60) return s.toFixed(s < 10 ? 1 : 0).replace(/\.0$/, "") + " s";
	const m = Math.floor(s / 60);
	return m + " min " + Math.round(s - m * 60) + " s";
}

/** Temps restant avant réarmement d'une fenêtre de quota, formulé court. */
export function formatResetIn(resetsAt: number | null, now: number): string | null {
	if (resetsAt == null) return null;
	const ms = resetsAt - now;
	if (ms <= 0) return null;
	const minutes = Math.round(ms / 60000);
	if (minutes < 60) return t("ai.usage.resetInMinutes", { n: minutes });
	const hours = Math.round(minutes / 60);
	if (hours < 48) return t("ai.usage.resetInHours", { n: hours });
	return t("ai.usage.resetInDays", { n: Math.round(hours / 24) });
}

export function readUsageLog(plugin: UsagePlugin): AiUsageEntry[] {
	const log = plugin.settings.aiUsageLog;
	return Array.isArray(log) ? log : [];
}

/** Ajoute une génération à l'historique persisté (tronqué à USAGE_LOG_MAX). */
export async function recordUsage(plugin: UsagePlugin, entry: AiUsageEntry): Promise<void> {
	const log = readUsageLog(plugin).slice();
	log.push(entry);
	plugin.settings.aiUsageLog = log.slice(-USAGE_LOG_MAX);
	try {
		await plugin.saveSettings?.();
	} catch (e) {
		// L'usage est de l'information, jamais une donnée dont la perte
		// justifierait de faire échouer une génération réussie.
		console.warn("[quiz-blocks] usage non persisté:", e);
	}
}

export interface UsageSummary {
	generations: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number | null;
	questions: number;
}

/** Cumul des entrées postérieures à `since` (epoch ms). */
export function summarize(log: AiUsageEntry[], since = 0): UsageSummary {
	const rows = log.filter(e => e && e.at >= since);
	// `costUsd` reste null tant qu'AUCUNE entrée n'a de coût : additionner des
	// zéros implicites ferait passer un forfait pour de la gratuité mesurée.
	const withCost = rows.filter(e => typeof e.costUsd === "number");
	return {
		generations: rows.length,
		inputTokens: rows.reduce((s, e) => s + (e.inputTokens || 0), 0),
		outputTokens: rows.reduce((s, e) => s + (e.outputTokens || 0), 0),
		costUsd: withCost.length ? withCost.reduce((s, e) => s + (e.costUsd || 0), 0) : null,
		questions: rows.reduce((s, e) => s + (e.questionCount || 0), 0)
	};
}

export const startOfToday = (now: number): number => {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
};

/* ══════════════════════════════════════════════════════════
   % DU FORFAIT — lecture des quotas du compte

   Ces lectures sortent du périmètre d'une génération : elles interrogent le
   CLI déjà installé et connecté sur cette machine. D'où le réglage explicite
   `aiUsageLimitsEnabled` (défaut : désactivé) — rien ne lit un fichier de
   session sans que l'utilisateur l'ait demandé.
══════════════════════════════════════════════════════════ */

/** Endpoint d'usage du compte Claude, celui que le CLI Claude Code interroge. */
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";

interface ClaudeUsageWindow { utilization?: number; resets_at?: string }
interface ClaudeUsageResponse {
	five_hour?: ClaudeUsageWindow | null;
	seven_day?: ClaudeUsageWindow | null;
	seven_day_opus?: ClaudeUsageWindow | null;
}

/**
 * Quotas du compte Claude, lus avec le jeton du CLI Claude Code local
 * (`~/.claude/.credentials.json`). Le jeton ne quitte pas la machine autrement
 * que vers api.anthropic.com, à qui il appartient. Retourne [] dès que quoi que
 * ce soit manque — CLI absent, session expirée, réseau : une lecture de confort
 * ne fait jamais échouer quoi que ce soit.
 */
export async function fetchClaudeLimits(): Promise<AiLimit[]> {
	if (!Platform.isDesktopApp) return [];
	try {
		const os = require("os") as typeof import("os");
		const path = require("path") as typeof import("path");
		const fs = require("fs") as typeof import("fs");

		const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
		if (!fs.existsSync(credPath)) return [];
		const cred = JSON.parse(fs.readFileSync(credPath, "utf8")) as {
			claudeAiOauth?: { accessToken?: string };
		};
		const token = cred?.claudeAiOauth?.accessToken;
		if (!token) return [];

		/* `requestUrl` et NON `fetch` : le renderer d'Obsidian applique la
		   politique d'origine du navigateur et un fetch vers api.anthropic.com
		   échoue en « Failed to fetch » (vérifié). requestUrl passe par le
		   processus principal, ce pour quoi Obsidian l'expose. */
		const resp = await requestUrl({
			url: CLAUDE_USAGE_URL,
			method: "GET",
			headers: {
				"Authorization": "Bearer " + token,
				"anthropic-beta": CLAUDE_OAUTH_BETA,
				"Content-Type": "application/json"
			},
			throw: false
		});
		if (resp.status < 200 || resp.status >= 300) return [];
		const data = resp.json as ClaudeUsageResponse;

		const toLimit = (w: ClaudeUsageWindow | null | undefined, label: string): AiLimit | null => {
			if (!w || typeof w.utilization !== "number") return null;
			const resets = w.resets_at ? Date.parse(w.resets_at) : NaN;
			return { label, usedPercent: w.utilization, resetsAt: Number.isFinite(resets) ? resets : null };
		};

		return [
			toLimit(data.five_hour, t("ai.usage.window5h")),
			toLimit(data.seven_day, t("ai.usage.window7d")),
			toLimit(data.seven_day_opus, t("ai.usage.window7dOpus"))
		].filter((l): l is AiLimit => l !== null);
	} catch (e) {
		console.warn("[quiz-blocks] quotas Claude illisibles:", e);
		return [];
	}
}

interface CodexRateLimitWindow { used_percent?: number; window_minutes?: number; resets_at?: number }

/**
 * Quotas ChatGPT, lus dans le fichier de session que le CLI Codex vient
 * d'écrire (`~/.codex/sessions/**\/rollout-*-<threadId>.jsonl`, event
 * `token_count` → `rate_limits`). C'est le CLI lui-même qui les enregistre :
 * aucune requête n'est émise ici.
 */
export function readCodexLimits(threadId: string): AiLimit[] {
	if (!Platform.isDesktopApp || !threadId) return [];
	try {
		const os = require("os") as typeof import("os");
		const path = require("path") as typeof import("path");
		const fs = require("fs") as typeof import("fs");

		const root = path.join(os.homedir(), ".codex", "sessions");
		if (!fs.existsSync(root)) return [];

		// Les rollouts sont rangés par année/mois/jour ; on descend vers le plus
		// récent plutôt que de balayer toute l'arborescence.
		const newestDir = (dir: string): string | null => {
			const entries = fs.readdirSync(dir, { withFileTypes: true })
				.filter(d => d.isDirectory())
				.map(d => d.name)
				.sort();
			const last = entries[entries.length - 1];
			return last ? path.join(dir, last) : null;
		};

		let found: string | null = null;
		// Profondeur exacte de l'arborescence : année / mois / jour.
		for (const dayDir of candidateDayDirs(root, newestDir)) {
			const hit = fs.readdirSync(dayDir).find((f: string) => f.includes(threadId) && f.endsWith(".jsonl"));
			if (hit) { found = path.join(dayDir, hit); break; }
		}
		if (!found) return [];

		// Le dernier `rate_limits` du fichier est l'état le plus frais.
		const lines = fs.readFileSync(found, "utf8").split("\n");
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i];
			if (!line.includes("rate_limits")) continue;
			let parsed: { payload?: { rate_limits?: { primary?: CodexRateLimitWindow; secondary?: CodexRateLimitWindow } } };
			try { parsed = JSON.parse(line); } catch { continue; }
			const rl = parsed?.payload?.rate_limits;
			if (!rl) continue;

			const toLimit = (w: CodexRateLimitWindow | undefined): AiLimit | null => {
				if (!w || typeof w.used_percent !== "number") return null;
				const mins = typeof w.window_minutes === "number" ? w.window_minutes : 0;
				// Le libellé vient de la FENÊTRE annoncée par le CLI, jamais d'un
				// nom de plan supposé : « 10080 min » se dit « 7 j ».
				const label = mins >= 1440
					? t("ai.usage.windowDays", { n: Math.round(mins / 1440) })
					: mins > 0
					? t("ai.usage.windowHours", { n: Math.max(1, Math.round(mins / 60)) })
					: t("ai.usage.windowPlan");
				// `resets_at` est en SECONDES epoch dans les rollouts Codex.
				const resets = typeof w.resets_at === "number" ? w.resets_at * 1000 : null;
				return { label, usedPercent: w.used_percent, resetsAt: resets };
			};

			return [toLimit(rl.primary), toLimit(rl.secondary)].filter((l): l is AiLimit => l !== null);
		}
		return [];
	} catch (e) {
		console.warn("[quiz-blocks] quotas Codex illisibles:", e);
		return [];
	}
}

/** Dossiers-jour candidats, du plus récent au plus ancien (2 jours suffisent : on
    cherche la session qui vient de tourner). */
function candidateDayDirs(root: string, newestDir: (dir: string) => string | null): string[] {
	const path = require("path") as typeof import("path");
	const fs = require("fs") as typeof import("fs");
	const out: string[] = [];
	const year = newestDir(root);
	if (!year) return out;
	const months = fs.readdirSync(year, { withFileTypes: true })
		.filter(d => d.isDirectory()).map(d => d.name).sort().reverse();
	for (const m of months.slice(0, 2)) {
		const monthDir = path.join(year, m);
		const days = fs.readdirSync(monthDir, { withFileTypes: true })
			.filter(d => d.isDirectory()).map(d => d.name).sort().reverse();
		for (const d of days.slice(0, 3)) out.push(path.join(monthDir, d));
		if (out.length >= 3) break;
	}
	return out;
}

/** Quotas du fournisseur qui vient de répondre ; [] si ce fournisseur n'en publie pas. */
export async function fetchLimits(plugin: UsagePlugin, usage: AiUsage): Promise<AiLimit[]> {
	if (!plugin.settings.aiUsageLimitsEnabled) return [];
	if (usage.provider === "claude-code") return fetchClaudeLimits();
	if (usage.provider === "codex") return readCodexLimits(usage.sessionId || "");
	// Ollama (local ou cloud) et Kimi Code ne publient aucun quota lisible
	// localement — l'écran le dit plutôt que d'afficher un zéro trompeur.
	return [];
}
