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
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

	/* ─── Claude : les quotas de `GET /api/oauth/usage`. Fixture mesurée sur
	   un vrai compte connecté le 2026-09-21 — `limits[]` porte `percent`,
	   les champs historiques `utilization`, et `resets_at` est une chaîne
	   ISO absolue, pas un nombre de secondes. ─── */
	const REPONSE_REELLE = {
		limits: [
			{ kind: "session", group: "session", percent: 83, severity: "warning", resets_at: "2026-09-21T10:00:00.643999+00:00", scope: null, is_active: true },
			{ kind: "weekly_all", group: "weekly", percent: 66, severity: "normal", resets_at: "2026-09-22T08:00:00.644026+00:00", scope: null, is_active: false },
		],
		five_hour: { utilization: 82, resets_at: "2026-09-21T10:00:00.925975+00:00", limit_dollars: null, used_dollars: null, remaining_dollars: null, locked_reason: null },
		seven_day: { utilization: 66, resets_at: "2026-09-22T08:00:00.925996+00:00" },
	};
	r.check("limits[] rend une ligne session et une ligne weekly-all, resets_at en ms",
		m.usageClaudeDepuisReponse(REPONSE_REELLE),
		[{ kind: "session", usedPercent: 83, resetsAt: Date.parse("2026-09-21T10:00:00.643999+00:00") },
		 { kind: "weekly-all", usedPercent: 66, resetsAt: Date.parse("2026-09-22T08:00:00.644026+00:00") }]);

	r.check("le repli (five_hour/seven_day, `utilization`) rend les deux mêmes lignes sans limits[]",
		m.usageClaudeDepuisReponse({ five_hour: REPONSE_REELLE.five_hour, seven_day: REPONSE_REELLE.seven_day }),
		[{ kind: "session", usedPercent: 82, resetsAt: Date.parse("2026-09-21T10:00:00.925975+00:00") },
		 { kind: "weekly-all", usedPercent: 66, resetsAt: Date.parse("2026-09-22T08:00:00.925996+00:00") }]);

	r.check("limits[] vide fait céder la main au repli",
		m.usageClaudeDepuisReponse({ limits: [], five_hour: REPONSE_REELLE.five_hour, seven_day: REPONSE_REELLE.seven_day }),
		[{ kind: "session", usedPercent: 82, resetsAt: Date.parse("2026-09-21T10:00:00.925975+00:00") },
		 { kind: "weekly-all", usedPercent: 66, resetsAt: Date.parse("2026-09-22T08:00:00.925996+00:00") }]);

	r.check("une entrée de limits[] sans `percent` numérique est omise, pas mise à zéro",
		m.usageClaudeDepuisReponse({ limits: [{ kind: "session", resets_at: "2026-09-21T10:00:00Z" }] }),
		[]);

	r.check("un `kind` inconnu AVEC un nom de modèle rend une ligne weekly-model",
		m.usageClaudeDepuisReponse({ limits: [{ kind: "weekly_opus", percent: 12, resets_at: "2026-09-22T08:00:00Z", scope: { model: { display_name: "Opus" } } }] }),
		[{ kind: "weekly-model", modelName: "Opus", usedPercent: 12, resetsAt: Date.parse("2026-09-22T08:00:00Z") }]);

	r.check("un `kind` inconnu SANS nom de modèle est omis : on ne devine pas de qui il parle",
		m.usageClaudeDepuisReponse({ limits: [{ kind: "weekly_opus", percent: 12, resets_at: "2026-09-22T08:00:00Z" }] }),
		[]);

	r.check("un `resets_at` illisible rend resetsAt: null, sans jeter",
		m.usageClaudeDepuisReponse({ limits: [{ kind: "session", percent: 50, resets_at: "pas une date" }] }),
		[{ kind: "session", usedPercent: 50, resetsAt: null }]);

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

/* ─────────── L'ASSEMBLAGE, pas seulement les parseurs ───────────

   Les cas ci-dessus éprouvent `comptClaude`/`comptCodex`/`emailAntigravity`,
   des fonctions PURES — mais la fuite que ce contrôle existe pour empêcher
   se joue dans `etatComptes()` de `comptes.ts`, IMPUR, chargé par aucun
   script jusqu'ici (Ahmed, 2026-09-21). Un `...(JSON.parse(brut) as object)`
   distrait au retour d'`etatCodex` — exactement le spread que ce contrôle
   existe pour empêcher — laissait 22/22 cas verts ci-dessus tout en faisant
   fuiter `access_token`/`refresh_token` par le pont.

   Un VRAI dossier temporaire joue le rôle du dossier personnel, avec de faux
   `auth.json` (Codex), `google_accounts.json` (Antigravity) et
   `.credentials.json` (Claude), chacun porteur d'un jeton reconnaissable.

   `etatClaude` ET `etatAntigravity` COMMENCENT PAR `resoudreExecutable(...)` et
   rendent `etatVide(...)` AVANT d'avoir lu le moindre fichier — un dossier
   temporaire dont le seul environnement est `USERPROFILE`/`HOME` (comme
   c'était le cas jusqu'au 2026-09-21) ne les trouve jamais : `PATH` est vide
   et `dossiersCli` ne produit rien sans `APPDATA`/`LOCALAPPDATA`. Les deux
   retombaient donc sur `etatVide` SANS AVOIR RIEN LU, et les faux fichiers
   écrits par ce cas n'étaient jamais lus — les assertions sur
   `SECRET_CLAUDE`/`REFRESH_CLAUDE`/`SECRET_AGY`/`REFRESH_AGY` passaient
   TRIVIALEMENT. Seul Codex, qui lit `auth.json` indépendamment de la
   résolution de son exécutable, était réellement éprouvé.

   LA CORRECTION : un VRAI faux exécutable par outil, posé dans un dossier de
   `PATH` FABRIQUÉ (`poserFauxCli`, même patron que `check-electron-process.mjs`)
   — un `.cmd` sous Windows, qui lance `node` sur un script. `resoudreExecutable`
   le trouve pour de vrai, et le code va jusqu'au bout de son assemblage :
   - `claude` : le faux CLI répond à `auth status --json` avec le JSON que le
     VRAI CLI rend (`loggedIn`/`email`/`subscriptionType`), PLUS un
     `accessToken`/`refreshToken` — un `...JSON.parse(stdout)` distrait au
     retour d'`etatClaude` les ferait fuiter, exactement comme le spread
     documenté plus haut pour Codex.
   - `agy` : le faux CLI répond à `models` par une ligne non vide et un code 0
     (`connecte` en dépend) ; l'adresse est ensuite lue, comme avant, dans
     `google_accounts.json`, qui porte `access_token`/`refresh_token`.
   - `codex` : déjà exercé sans exécutable (il lit `auth.json` directement) ;
     l'exécutable posé ici ne sert plus qu'à faire répondre `login status`
     en 0, pour que `connecte` vaille `true` comme un vrai poste connecté. */
await withSrcModule("apps/windows/electron/comptes.ts", async ({ etatComptes }) => {
	const r = makeReporter("Électron — comptes (assemblage)");
	const racine = await mkdtemp(join(tmpdir(), "electron-comptes-"));
	const dir = join(racine, "maison");
	const bin = join(racine, "bin");
	await mkdir(dir, { recursive: true });
	await mkdir(bin, { recursive: true });
	try {
		const SECRET_CODEX = "sk-codex-SECRET-QUI-NE-DOIT-PAS-SORTIR";
		const REFRESH_CODEX = "refresh-codex-SECRET-QUI-NE-DOIT-PAS-SORTIR";
		const SECRET_AGY = "sk-agy-SECRET-QUI-NE-DOIT-PAS-SORTIR";
		const REFRESH_AGY = "refresh-agy-SECRET-QUI-NE-DOIT-PAS-SORTIR";
		const SECRET_CLAUDE = "sk-ant-oat01-SECRET-QUI-NE-DOIT-PAS-SORTIR";
		const REFRESH_CLAUDE = "refresh-claude-SECRET-QUI-NE-DOIT-PAS-SORTIR";

		await mkdir(join(dir, ".codex"), { recursive: true });
		await writeFile(join(dir, ".codex", "auth.json"), JSON.stringify({
			tokens: {
				id_token: idToken({ email: "a@b.c", "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } }),
				access_token: SECRET_CODEX,
				refresh_token: REFRESH_CODEX,
			},
		}));
		await mkdir(join(dir, ".gemini"), { recursive: true });
		await writeFile(join(dir, ".gemini", "google_accounts.json"), JSON.stringify({
			active: "x@gmail.com", access_token: SECRET_AGY, refresh_token: REFRESH_AGY,
		}));
		await mkdir(join(dir, ".claude"), { recursive: true });
		await writeFile(join(dir, ".claude", ".credentials.json"), JSON.stringify({
			claudeAiOauth: { accessToken: SECRET_CLAUDE, refreshToken: REFRESH_CLAUDE },
		}));

		/** Un faux CLI : un script Node, plus un lanceur du nom demandé — même
		    patron que `poserFauxCli` de `check-electron-process.mjs` (un `.cmd`
		    sous Windows, le repli npm réel, qui exécute le script par
		    `process.execPath`). `corps` est le contenu JS du script. */
		async function poserFauxCli(nom, corps) {
			const script = join(bin, nom + ".js");
			await writeFile(script, corps);
			const lanceur = join(bin, process.platform === "win32" ? nom + ".cmd" : nom);
			if (process.platform === "win32") {
				await writeFile(lanceur, '@echo off\r\n"' + process.execPath + '" "' + script + '" %*\r\n');
			} else {
				await writeFile(lanceur, '#!/bin/sh\nexec "' + process.execPath + '" "' + script + '" "$@"\n', { mode: 0o755 });
			}
		}

		await Promise.all([
			/* `auth status --json` : le JSON que le VRAI CLI rend, PLUS
			   `accessToken`/`refreshToken` — un spread distrait au retour
			   d'`etatClaude` les ferait fuiter. */
			poserFauxCli("claude", "process.stdout.write(" + JSON.stringify(JSON.stringify({
				loggedIn: true, email: "a@b.c", subscriptionType: "pro",
				accessToken: SECRET_CLAUDE, refreshToken: REFRESH_CLAUDE,
			})) + ");"),
			/* `login status` : seul le CODE DE SORTIE compte pour `connecte`. */
			poserFauxCli("codex", "process.exit(0);"),
			/* `models` : `connecte` exige un code 0 et une sortie non vide ;
			   l'adresse, elle, est relue ensuite dans `google_accounts.json`. */
			poserFauxCli("agy", "process.stdout.write('modele-a\\n');"),
		]);

		/* AUCUN autre dossier de `PATH` : `PATH` porte EXACTEMENT le dossier
		   des faux CLI, jamais le `PATH` réel du poste. `dossiersCli` reste
		   sans effet, faute d'`APPDATA`/`LOCALAPPDATA` dans cet environnement,
		   sauf pour `.local/bin` et `.claude/local`, sous `dir`, qui restent
		   vides — le seul exécutable trouvable est celui posé ici. */
		const env = {
			USERPROFILE: dir, HOME: dir,
			PATH: bin, Path: bin,
			SystemRoot: process.env.SystemRoot,
			ComSpec: process.env.ComSpec,
			PATHEXT: process.env.PATHEXT,
			TEMP: process.env.TEMP,
			TMP: process.env.TMP,
		};
		const etats = await etatComptes(env);
		const serialise = JSON.stringify(etats);

		r.check("etatComptes() rend bien les trois outils lus",
			etats.map(e => e.outil).sort(),
			["agy", "claude", "codex"]);

		r.check("etatComptes() lit l'adresse Codex depuis le vrai fichier",
			etats.find(e => e.outil === "codex")?.email, "a@b.c");

		r.check("etatComptes() lit le vrai faux exécutable claude (installe, connecte, email)",
			etats.find(e => e.outil === "claude"),
			{ outil: "claude", installe: true, connecte: true, email: "a@b.c", plan: "Pro" });

		r.check("etatComptes() lit le vrai faux exécutable agy (connecte) puis l'adresse du fichier",
			etats.find(e => e.outil === "agy"),
			{ outil: "agy", installe: true, connecte: true, email: "x@gmail.com", plan: null });

		r.check("la réponse sérialisée d'etatComptes() ne contient aucun des six jetons",
			[SECRET_CODEX, REFRESH_CODEX, SECRET_AGY, REFRESH_AGY, SECRET_CLAUDE, REFRESH_CLAUDE]
				.map(jeton => serialise.includes(jeton)),
			[false, false, false, false, false, false]);
	} finally {
		await rm(racine, { recursive: true, force: true });
	}
	r.done();
});
