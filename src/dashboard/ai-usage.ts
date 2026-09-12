import { Platform, requestUrl } from "obsidian";
import type { Plugin } from "obsidian";
import type { AiSettings } from "../types/dashboard-ctx";
import type { AiUsage, AiUsageEntry, PlanName, PlanUsage, UsageRead, UsageReadError, UsageRow } from "./usage-format";

/* ══════════════════════════════════════════════════════════
   USAGE IA — ce qu'une génération a réellement coûté.

   Les TYPES et le FORMATAGE vivent dans `usage-format.ts` (pur) depuis la
   tâche 6 de la tranche 5 — voir son en-tête — et sont réexportés ci-dessous
   pour que les appelants du greffon ne changent pas. Ici ne reste que ce qui
   touche un hôte : le journal persisté dans les réglages du greffon, le
   trousseau du CLI Claude, les rollouts de Codex, et l'endpoint d'usage.

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

export * from "./usage-format";

/** Hôte plugin : seuls `settings` et `saveData` sont touchés. */
export type UsagePlugin = Plugin & {
	settings: AiSettings & { aiUsageLog?: AiUsageEntry[]; aiUsageLimitsEnabled?: boolean };
	saveSettings?: () => Promise<void>;
};

/** Au-delà, l'historique est tronqué : c'est un journal de consultation, pas une archive. */
const USAGE_LOG_MAX = 300;

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
/** Ligne moderne de `limits[]` : la forme que l'écran de claude.ai reproduit. */
interface ClaudeUsageLimit {
	kind?: string;
	percent?: number;
	resets_at?: string;
	scope?: { model?: { display_name?: string } | null } | null;
}
interface ClaudeUsageResponse {
	limits?: ClaudeUsageLimit[] | null;
	/* Champs historiques, conservés en repli : un compte qui ne renverrait pas
	   encore `limits` doit continuer d'afficher ses jauges. */
	five_hour?: ClaudeUsageWindow | null;
	seven_day?: ClaudeUsageWindow | null;
	seven_day_opus?: ClaudeUsageWindow | null;
}

/** Jeton + forfait du CLI Claude Code local, en UNE lecture du trousseau. */
function readClaudeCredentials(): { token: string | null; plan: PlanName | null } {
	if (!Platform.isDesktopApp) return { token: null, plan: null };
	try {
		const os = require("os") as typeof import("os");
		const path = require("path") as typeof import("path");
		const fs = require("fs") as typeof import("fs");

		const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
		if (!fs.existsSync(credPath)) return { token: null, plan: null };
		const cred = JSON.parse(fs.readFileSync(credPath, "utf8")) as {
			claudeAiOauth?: { accessToken?: string; subscriptionType?: string; rateLimitTier?: string };
		};
		const oauth = cred?.claudeAiOauth;
		return { token: oauth?.accessToken || null, plan: formatPlanName(oauth) };
	} catch (e) {
		console.warn("[quiz-blocks] trousseau Claude illisible:", e);
		return { token: null, plan: emptyPlan };
	}
}

const emptyPlan: PlanName | null = null;

/** « max » + « default_claude_max_5x » → { label: « Max (5x) », name: « Max » }. */
function formatPlanName(oauth?: { subscriptionType?: string; rateLimitTier?: string }): PlanName | null {
	const type = oauth?.subscriptionType;
	if (!type) return null;
	const name = type.charAt(0).toUpperCase() + type.slice(1);
	// Le multiplicateur ne vit que dans le palier (« …_max_5x ») : absent pour
	// les forfaits qui n'en ont pas, et on n'en invente pas un « (1x) ».
	const multiplier = /_(\d+)x\b/.exec(oauth?.rateLimitTier || "");
	return { label: multiplier ? `${name} (${multiplier[1]}x)` : name, name };
}

/** Forfait Claude détecté localement, sans aucun appel réseau. */
export function readClaudePlan(): PlanName | null {
	return readClaudeCredentials().plan;
}

/**
 * Quotas du compte Claude, lus avec le jeton du CLI Claude Code local
 * (`~/.claude/.credentials.json`). Le jeton ne quitte pas la machine autrement
 * que vers api.anthropic.com, à qui il appartient. Retourne [] dès que quoi que
 * ce soit manque — CLI absent, session expirée, réseau : une lecture de confort
 * ne fait jamais échouer quoi que ce soit.
 */
export async function fetchClaudeUsage(): Promise<UsageRead> {
	const { token } = readClaudeCredentials();
	if (!token) return { rows: [], error: { kind: "unauthenticated" } };
	try {
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
		if (resp.status < 200 || resp.status >= 300) {
			return { rows: [], error: readErrorFromStatus(resp.status, resp.headers) };
		}
		const data = resp.json as ClaudeUsageResponse;

		const at = (iso?: string): number | null => {
			const ms = iso ? Date.parse(iso) : NaN;
			return Number.isFinite(ms) ? ms : null;
		};

		/* `limits[]` d'abord : c'est la source de l'écran officiel, elle nomme
		   elle-même ses lignes (session, hebdo global, hebdo par modèle). */
		const rows: UsageRow[] = [];
		for (const limit of data.limits || []) {
			if (!limit || typeof limit.percent !== "number") continue;
			const resetsAt = at(limit.resets_at);
			if (limit.kind === "session") {
				rows.push({ kind: "session", usedPercent: limit.percent, resetsAt });
			} else if (limit.kind === "weekly_all") {
				rows.push({ kind: "weekly-all", usedPercent: limit.percent, resetsAt });
			} else {
				// Toute autre limite portée par un modèle (weekly_scoped
				// aujourd'hui, d'autres demain) reste affichable tant qu'elle
				// dit de QUI elle parle ; sans nom, on ne devine pas.
				const modelName = limit.scope?.model?.display_name;
				if (modelName) rows.push({ kind: "weekly-model", modelName, usedPercent: limit.percent, resetsAt });
			}
		}
		if (rows.length) return { rows, error: null };

		// Repli sur les champs historiques.
		const legacy = (w: ClaudeUsageWindow | null | undefined, row: Omit<UsageRow, "usedPercent" | "resetsAt">): UsageRow | null =>
			!w || typeof w.utilization !== "number"
				? null
				: { ...row, usedPercent: w.utilization, resetsAt: at(w.resets_at) };

		return {
			rows: [
				legacy(data.five_hour, { kind: "session" }),
				legacy(data.seven_day, { kind: "weekly-all" }),
				legacy(data.seven_day_opus, { kind: "weekly-model", modelName: "Opus" })
			].filter((r): r is UsageRow => r !== null),
			error: null
		};
	} catch (e) {
		console.warn("[quiz-blocks] quotas Claude illisibles:", e);
		return { rows: [], error: { kind: "unavailable" } };
	}
}

/** Traduit un statut HTTP en raison affichable. Le 429 vient de l'endpoint
    lui-même, qui borne la fréquence des lectures : c'est une attente, pas une
    panne, et son en-tête `Retry-After` dit combien de temps. */
function readErrorFromStatus(status: number, headers?: Record<string, string>): UsageReadError {
	if (status === 429) {
		const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
		const seconds = raw ? parseInt(raw, 10) : NaN;
		return { kind: "rate-limited", retryAfterSec: Number.isFinite(seconds) ? seconds : null };
	}
	if (status === 401 || status === 403) return { kind: "unauthenticated" };
	return { kind: "unavailable" };
}

interface CodexRateLimitWindow { used_percent?: number; window_minutes?: number; resets_at?: number }

/**
 * Quotas ChatGPT, lus dans le fichier de session que le CLI Codex vient
 * d'écrire (`~/.codex/sessions/**\/rollout-*-<threadId>.jsonl`, event
 * `token_count` → `rate_limits`). C'est le CLI lui-même qui les enregistre :
 * aucune requête n'est émise ici.
 */
export function readCodexUsage(threadId: string): UsageRow[] {
	if (!Platform.isDesktopApp) return [];
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

		/* Sans identifiant de session (consultation hors génération), le rollout
		   le PLUS RÉCENT fait l'affaire : les quotas sont ceux du compte, pas
		   d'une conversation. */
		let found: string | null = null;
		for (const dayDir of candidateDayDirs(root, newestDir)) {
			const files = fs.readdirSync(dayDir).filter((f: string) => f.endsWith(".jsonl"));
			const hit = threadId
				? files.find((f: string) => f.includes(threadId))
				: files.sort().pop();
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

			const toRow = (w: CodexRateLimitWindow | undefined): UsageRow | null => {
				if (!w || typeof w.used_percent !== "number") return null;
				// La ligne est nommée par la FENÊTRE annoncée par le CLI, jamais
				// par un nom de plan supposé : « 10080 min » se dira « 7 j ».
				const windowMinutes = typeof w.window_minutes === "number" ? w.window_minutes : 0;
				// `resets_at` est en SECONDES epoch dans les rollouts Codex.
				const resets = typeof w.resets_at === "number" ? w.resets_at * 1000 : null;
				return { kind: "window", windowMinutes, usedPercent: w.used_percent, resetsAt: resets };
			};

			return [toRow(rl.primary), toRow(rl.secondary)].filter((r): r is UsageRow => r !== null);
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

/**
 * État du forfait d'un fournisseur ; `rows` vide s'il n'en publie pas.
 * `sessionId` cible la session qui vient de tourner ; sans lui, la lecture
 * porte sur l'état le plus récent du compte — ce qu'on veut quand on consulte
 * son forfait AVANT de lancer une génération.
 */
export async function fetchPlanUsage(plugin: UsagePlugin, provider: string, sessionId = ""): Promise<PlanUsage> {
	const empty: PlanUsage = { plan: null, planName: null, rows: [], fetchedAt: Date.now(), error: null };
	if (!plugin.settings.aiUsageLimitsEnabled) return empty;
	if (provider === "claude-code") {
		const plan = readClaudePlan();
		const read = await fetchClaudeUsage();
		return {
			plan: plan?.label ?? null,
			planName: plan?.name ?? null,
			rows: read.rows,
			fetchedAt: Date.now(),
			error: read.error
		};
	}
	if (provider === "codex") {
		// Le forfait ChatGPT n'est écrit nulle part dans les rollouts : pas de
		// nom affiché plutôt qu'un « Plus » supposé.
		return { ...empty, rows: readCodexUsage(sessionId), fetchedAt: Date.now() };
	}
	// Ollama (local ou cloud) ne publie aucun quota lisible
	// localement — l'écran le dit plutôt que d'afficher un zéro trompeur.
	return empty;
}

/** État du forfait du fournisseur qui vient de répondre. */
export const fetchPlanUsageFor = (plugin: UsagePlugin, usage: AiUsage): Promise<PlanUsage> =>
	fetchPlanUsage(plugin, usage.provider, usage.sessionId || "");
