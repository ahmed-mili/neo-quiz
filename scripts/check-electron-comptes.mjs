/**
 * Les parseurs du module « comptes » du processus principal : ce qui se juge
 * SANS disque ni réseau. Aucun double, le code réel.
 *
 * Ce qu'il empêche, et qui échouerait EN SILENCE :
 * — un `id_token` trafiqué qui produirait une adresse inventée au lieu de rien ;
 * — un rollout Codex sans `rate_limits` rendu comme une ligne à zéro pour cent
 *   (« tu n'as rien consommé » est un mensonge, « je ne sais pas » ne l'est pas) ;
 * — et SURTOUT : un jeton qui traverserait le pont parce qu'un `...auth`
 *   distrait aurait recopié l'objet au lieu d'en extraire deux champs.
 *
 *     npm run check:electron-comptes
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Un id_token fabriqué : trois segments base64url, le second porte les claims. */
function idToken(claims) {
	const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
	return b64({ alg: "none" }) + "." + b64(claims) + ".SIGNATURE-BIDON";
}

await withSrcModule("apps/windows/electron/comptes-pur.ts", async (m) => {
	const r = makeReporter("Électron — comptes");

	/* ─── Claude : `claude auth status --json` ─── */
	r.check("claude connecté rend l'adresse et le forfait",
		m.comptClaude(JSON.stringify({ loggedIn: true, email: "a@b.c", subscriptionType: "pro" })),
		{ connecte: true, email: "a@b.c", plan: "Pro" });

	r.check("claude déconnecté ne rend aucune adresse",
		m.comptClaude(JSON.stringify({ loggedIn: false })),
		{ connecte: false, email: null, plan: null });

	r.check("sortie qui n'est pas du JSON vaut déconnecté, sans jeter",
		m.comptClaude("command not found"),
		{ connecte: false, email: null, plan: null });

	r.check("le multiplicateur vient du palier, et on n'invente pas un (1x)",
		[m.planClaude({ subscriptionType: "max", rateLimitTier: "default_claude_max_5x" }),
		 m.planClaude({ subscriptionType: "pro", rateLimitTier: "default_claude_ai" }),
		 m.planClaude({})],
		["Max (5x)", "Pro", null]);

	/* ─── Codex : les claims de l'id_token ─── */
	r.check("codex rend l'adresse et le plan des claims",
		m.comptCodex({ tokens: { id_token: idToken({ email: "a@b.c", "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } }) } }),
		{ email: "a@b.c", plan: "Plus" });

	r.check("un id_token à deux segments ne produit pas d'adresse",
		m.comptCodex({ tokens: { id_token: "aaa.bbb" } }),
		{ email: null, plan: null });

	r.check("un segment qui n'est pas du base64 JSON ne jette pas",
		m.comptCodex({ tokens: { id_token: "aaa.!!!pas-du-base64!!!.ccc" } }),
		{ email: null, plan: null });

	r.check("un auth.json vide ne produit rien",
		m.comptCodex({}), { email: null, plan: null });

	/* ─── Antigravity : google_accounts.json ─── */
	r.check("antigravity rend le compte actif",
		m.emailAntigravity({ active: "x@gmail.com", old: [] }), "x@gmail.com");

	r.check("sans `active`, personne n'est connecté",
		[m.emailAntigravity({ old: ["x@gmail.com"] }), m.emailAntigravity(null), m.emailAntigravity({ active: 42 })],
		[null, null, null]);

	/* ─── Codex : les quotas d'une ligne de rollout ─── */
	const ligne = JSON.stringify({ payload: { rate_limits: {
		primary: { used_percent: 4, window_minutes: 300, resets_at: 1789946420 },
		secondary: { used_percent: 1, window_minutes: 10080, resets_at: 1790533220 },
	} } });
	r.check("une ligne rate_limits rend ses deux fenêtres, resets_at en MILLIsecondes",
		m.usageCodexDepuisLigne(ligne),
		[{ kind: "window", windowMinutes: 300, usedPercent: 4, resetsAt: 1789946420000 },
		 { kind: "window", windowMinutes: 10080, usedPercent: 1, resetsAt: 1790533220000 }]);

	r.check("une ligne sans rate_limits rend null, PAS un tableau vide",
		m.usageCodexDepuisLigne(JSON.stringify({ payload: { autre: 1 } })), null);

	r.check("une ligne illisible rend null sans jeter",
		m.usageCodexDepuisLigne("{pas du json"), null);

	r.check("une fenêtre sans used_percent est omise, pas mise à zéro",
		m.usageCodexDepuisLigne(JSON.stringify({ payload: { rate_limits: { primary: { window_minutes: 300 } } } })),
		[]);

	/* ─── L'ASSERTION QUI COMPTE : aucun jeton ne sort ─── */
	const SECRET = "sk-ant-oat01-SECRET-QUI-NE-DOIT-PAS-SORTIR";
	const REFRESH = "refresh-SECRET-QUI-NE-DOIT-PAS-SORTIR";
	const sorties = JSON.stringify([
		m.comptCodex({
			OPENAI_API_KEY: SECRET,
			tokens: {
				id_token: idToken({ email: "a@b.c", "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } }),
				access_token: SECRET,
				refresh_token: REFRESH,
			},
		}),
		m.comptClaude(JSON.stringify({ loggedIn: true, email: "a@b.c", subscriptionType: "pro", accessToken: SECRET })),
		m.emailAntigravity({ active: "x@gmail.com", access_token: SECRET, refresh_token: REFRESH }),
	]);
	r.check("aucune sortie ne contient de jeton",
		[sorties.includes("SECRET-QUI-NE-DOIT-PAS-SORTIR"), sorties.includes("oat01")],
		[false, false]);

	r.done();
});
