import type { UsageRow } from "../../../src/dashboard/usage-format";

/* ══════════════════════════════════════════════════════════
   COMPTES IA — la partie PURE : lire une identité sans rien en laisser fuir.

   Trois des quatre comptes ne se lisent que dans des fichiers de SECRETS. Ce
   module reçoit leur contenu déjà lu et n'en ressort QUE l'adresse et le nom
   du forfait. Il ne connaît ni disque, ni réseau, ni horloge : c'est ce qui le
   rend éprouvable (`npm run check:electron-comptes`), et c'est là que vit
   l'assertion qui compte — aucune de ces fonctions ne recopie son entrée.
══════════════════════════════════════════════════════════ */

/** Les trois outils dont le PRINCIPAL lit le compte. Ollama n'en est pas :
    son compte se sonde depuis le rendu (`checkOllamaCompte`, HTTP local). */
export type OutilCompte = "claude" | "codex" | "agy";

/** Le second segment d'un JWT, décodé. `null` dès que la forme n'y est pas :
    un jeton trafiqué ne doit produire ni exception ni adresse inventée. */
export function lireClaims(idToken: unknown): Record<string, unknown> | null {
	if (typeof idToken !== "string") return null;
	const parts = idToken.split(".");
	if (parts.length !== 3) return null;
	try {
		const json = Buffer.from(parts[1], "base64url").toString("utf8");
		const o: unknown = JSON.parse(json);
		return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
	} catch (e) {
		return null;
	}
}

/** L'adresse et le plan d'un `~/.codex/auth.json` DÉJÀ LU. Deux champs en
    sortent, jamais l'objet : c'est lui qui porte `access_token`,
    `refresh_token` et parfois une clé d'API. */
export function comptCodex(auth: unknown): { email: string | null; plan: string | null } {
	const vide = { email: null, plan: null };
	if (!auth || typeof auth !== "object") return vide;
	const tokens = (auth as { tokens?: unknown }).tokens;
	if (!tokens || typeof tokens !== "object") return vide;
	const claims = lireClaims((tokens as { id_token?: unknown }).id_token);
	if (!claims) return vide;
	const email = typeof claims.email === "string" ? claims.email : null;
	const bloc = claims["https://api.openai.com/auth"];
	const brut = bloc && typeof bloc === "object"
		? (bloc as { chatgpt_plan_type?: unknown }).chatgpt_plan_type
		: undefined;
	return { email, plan: typeof brut === "string" && brut ? majuscule(brut) : null };
}

/** « max » + « default_claude_max_5x » → « Max (5x) ». Le multiplicateur ne
    vit que dans le palier : absent pour les forfaits qui n'en ont pas, et on
    n'en invente pas un « (1x) ». */
export function planClaude(oauth: unknown): string | null {
	if (!oauth || typeof oauth !== "object") return null;
	const type = (oauth as { subscriptionType?: unknown }).subscriptionType;
	if (typeof type !== "string" || !type) return null;
	const tier = (oauth as { rateLimitTier?: unknown }).rateLimitTier;
	const mult = /_(\d+)x\b/.exec(typeof tier === "string" ? tier : "");
	return mult ? majuscule(type) + " (" + mult[1] + "x)" : majuscule(type);
}

/** La sortie de `claude auth status --json`. Une sortie qui n'est pas du JSON
    (CLI absent, message d'erreur) vaut « déconnecté » et ne jette pas. */
export function comptClaude(stdout: string): { connecte: boolean; email: string | null; plan: string | null } {
	const vide = { connecte: false, email: null, plan: null };
	let o: unknown;
	try { o = JSON.parse(stdout); } catch (e) { return vide; }
	if (!o || typeof o !== "object") return vide;
	const d = o as { loggedIn?: unknown; email?: unknown };
	if (d.loggedIn !== true) return vide;
	return {
		connecte: true,
		email: typeof d.email === "string" ? d.email : null,
		plan: planClaude(o),
	};
}

/** Le forfait d'un `.claude/.credentials.json` DÉJÀ LU. Mesuré deux fois sur
    le CLI 2.1.278 (2026-09-21, y compris dans l'environnement exact de
    l'app) : `claude auth status --json` ne publie NI adresse NI forfait — le
    forfait vit ici, dans la forme que `planClaude()` lit déjà (« Max (5x) »).
    Seuls ces deux champs sortent, jamais l'objet : le fichier porte les
    jetons. */
export function planCredentialsClaude(credentials: unknown): string | null {
	if (!credentials || typeof credentials !== "object") return null;
	const o = (credentials as { claudeAiOauth?: unknown }).claudeAiOauth;
	if (!o || typeof o !== "object") return null;
	return planClaude(o);
}

/** L'adresse du compte dans un `~/.claude.json` DÉJÀ LU. `claude auth status
    --json` ne publie pas de champ `email` sur les versions du CLI mesurées
    (2026-09-21) : c'est `oauthAccount.emailAddress` qui la porte. Seul ce
    champ sort, jamais l'objet : le fichier porte aussi des jetons. */
export function emailOauthClaude(claude: unknown): string | null {
	if (!claude || typeof claude !== "object") return null;
	const o = (claude as { oauthAccount?: unknown }).oauthAccount;
	if (!o || typeof o !== "object") return null;
	const email = (o as { emailAddress?: unknown }).emailAddress;
	return typeof email === "string" && email ? email : null;
}

/** Le compte actif d'un `~/.gemini/google_accounts.json` DÉJÀ LU. */
export function emailAntigravity(google: unknown): string | null {
	if (!google || typeof google !== "object") return null;
	const actif = (google as { active?: unknown }).active;
	return typeof actif === "string" && actif ? actif : null;
}

/** Les quotas d'UNE ligne de rollout Codex. `null` quand la ligne ne parle pas
    de quotas : c'est ce qui distingue « pas encore vu » de « vu, et vide ». */
export function usageCodexDepuisLigne(ligne: string): UsageRow[] | null {
	let o: unknown;
	try { o = JSON.parse(ligne); } catch (e) { return null; }
	const rl = (o as { payload?: { rate_limits?: unknown } } | null)?.payload?.rate_limits;
	if (!rl || typeof rl !== "object") return null;
	const fenetre = (w: unknown): UsageRow | null => {
		if (!w || typeof w !== "object") return null;
		const d = w as { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown };
		if (typeof d.used_percent !== "number") return null;
		return {
			kind: "window",
			windowMinutes: typeof d.window_minutes === "number" ? d.window_minutes : 0,
			usedPercent: d.used_percent,
			// `resets_at` est en SECONDES epoch dans les rollouts Codex.
			resetsAt: typeof d.resets_at === "number" ? d.resets_at * 1000 : null,
		};
	};
	const r = rl as { primary?: unknown; secondary?: unknown };
	return [fenetre(r.primary), fenetre(r.secondary)].filter((x): x is UsageRow => x !== null);
}

interface LimiteBrute {
	kind?: unknown;
	percent?: unknown;
	utilization?: unknown;
	resets_at?: unknown;
	scope?: { model?: { display_name?: unknown } } | null;
}

/** `resets_at` est une chaîne ISO 8601 ABSOLUE (« 2026-09-21T10:00:00Z… »),
    jamais une durée : `Date.parse` la convertit en ms epoch, `null` si elle
    ne se lit pas — jamais une exception ni une date inventée. */
function resetsAtDepuis(brut: unknown): number | null {
	if (typeof brut !== "string") return null;
	const ms = Date.parse(brut);
	return Number.isFinite(ms) ? ms : null;
}

function ligneDepuisLimite(l: LimiteBrute, percent: unknown): UsageRow | null {
	if (typeof percent !== "number") return null;
	const resetsAt = resetsAtDepuis(l.resets_at);
	if (l.kind === "session") return { kind: "session", usedPercent: percent, resetsAt };
	if (l.kind === "weekly_all") return { kind: "weekly-all", usedPercent: percent, resetsAt };
	const modelName = l.scope?.model?.display_name;
	if (typeof modelName === "string" && modelName) {
		return { kind: "weekly-model", modelName, usedPercent: percent, resetsAt };
	}
	return null;
}

/** La réponse (déjà décodée en JSON) de `GET /api/oauth/usage` de Claude, en
    lignes affichables. PURE : aucune horloge, `resets_at` est absolu.
 *
 * Deux formes coexistent dans la même réponse, mesurées sur un vrai compte le
 * 2026-09-21 : `limits[]` (chaque entrée porte `kind` et `percent`), lue EN
 * PREMIER, et les champs historiques `five_hour`/`seven_day`/`seven_day_opus`
 * (chacun porte `utilization`, pas `percent`) — repli seulement si `limits[]`
 * est absent, vide, ou n'a produit aucune ligne exploitable : un compte de
 * référence ne renvoie QUE ces champs historiques, et sans ce repli l'écran
 * serait vide. */
export function usageClaudeDepuisReponse(corps: unknown): UsageRow[] {
	if (!corps || typeof corps !== "object") return [];
	const d = corps as { limits?: unknown; five_hour?: LimiteBrute; seven_day?: LimiteBrute; seven_day_opus?: LimiteBrute };
	if (Array.isArray(d.limits)) {
		const rows = (d.limits as LimiteBrute[])
			.map(l => ligneDepuisLimite(l, l?.percent))
			.filter((r): r is UsageRow => r !== null);
		if (rows.length > 0) return rows;
	}
	const repli: UsageRow[] = [];
	const session = d.five_hour ? ligneDepuisLimite({ ...d.five_hour, kind: "session" }, d.five_hour.utilization) : null;
	const semaine = d.seven_day ? ligneDepuisLimite({ ...d.seven_day, kind: "weekly_all" }, d.seven_day.utilization) : null;
	const opus = d.seven_day_opus
		? ligneDepuisLimite({ resets_at: d.seven_day_opus.resets_at, scope: { model: { display_name: "Opus" } } }, d.seven_day_opus.utilization)
		: null;
	if (session) repli.push(session);
	if (semaine) repli.push(semaine);
	if (opus) repli.push(opus);
	return repli;
}

function majuscule(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
