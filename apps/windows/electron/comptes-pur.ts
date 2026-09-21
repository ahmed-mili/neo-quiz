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

function majuscule(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
