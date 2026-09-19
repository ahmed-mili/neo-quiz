/**
 * LES FOURNISSEURS IA — le catalogue, les statuts, l'instantané des CLI.
 *
 * `src/dashboard/ai-providers.ts` décide de ce que la page « Générer » propose
 * et de ce qu'elle affiche comme statut, et AUCUN script ne le chargeait : la
 * tranche 5 l'a fait passer tout entier par le contrat d'hôte (`net.fetchJson`
 * pour Ollama et le catalogue, `process.lireCache` pour les fichiers des CLI)
 * sans qu'une seule ligne de ce module soit éprouvée. Ce qui échouerait EN
 * SILENCE, et que ce script empêche :
 *
 * — le CATALOGUE CLOUD est lu de `ollama.com` par le contrat, jamais codé en
 *   dur (mémoire projet `ollama-latest-version-only`) : un module qui
 *   retomberait sur son repli embarqué sans jamais consulter l'hôte afficherait
 *   une liste périmée, indistinguable d'une liste à jour ;
 * — un « 200 qui n'est pas du JSON » (portail captif, proxy, n'importe quel
 *   service qui occupe le port 11434) doit valoir HORS LIGNE. L'ancien
 *   `resp.json()` levait et tombait dans le `catch` ; depuis que le contrat rend
 *   le corps BRUT, un `JSON.parse` oublié donnerait « Ollama joignable, 0
 *   modèle » — et l'utilisateur chercherait où sont passés ses modèles ;
 * — les deux lecteurs SYNCHRONES des fichiers de CLI (`getCodexModels`,
 *   `isFableOffered`) lisent un INSTANTANÉ que seul `refreshCliCaches` remplit.
 *   S'il ne le remplissait plus, ils rendraient le repli embarqué pour toujours,
 *   sans erreur : le menu de modèles n'afficherait jamais un modèle neuf du
 *   compte.
 *
 * Le module RÉEL, avec un faux hôte : c'est le seul moyen de voir ce qu'il
 * DEMANDE à son hôte (l'URL, la méthode) et non seulement ce qu'il en fait.
 *
 *     npm run check:ai-providers
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Le faux hôte : il JOURNALISE chaque requête et chaque lecture de cache, et
    rend ce que le cas lui a préparé. Tout le reste du contrat est là sous sa
    forme minimale — un faux hôte PARTIEL meurt sur un TypeError le jour où un
    appelant y touche, et une mort en route masque les groupes suivants. */
function fauxHote({ reponses = {}, caches = {}, runs = {} } = {}) {
	const journal = [];
	return {
		journal,
		hote: {
			fs: {
				read: async () => "", readCached: async () => "", write: async () => {}, process: async () => {},
				writeBinary: async () => {}, readBinary: async () => new Uint8Array(), trash: async () => {},
				exists: async () => false, mkdirs: async () => {}, append: async () => {}, list: async () => [],
				remove: async () => {}, rename: async () => {}, listMarkdown: () => [], findByName: () => [],
				getFile: () => null, listFiles: () => [], listDir: async () => [],
				externe: { list: async () => [], stat: async () => null, read: async () => "", readBinary: async () => new Uint8Array() },
			},
			links: { resolve: () => null, resourceUrl: () => null },
			watcher: { onChange: () => () => {}, onRenameDir: () => () => {} },
			ui: { notice: () => {}, setIcon: () => {}, iconNames: () => [] },
			math: { ready: async () => {}, render: () => null, flush: () => {} },
			shell: { openExternal: async () => false, revealInHost: async () => false, openUrl: async () => false },
			platform: { isMobile: false, isMacOS: false, isWindows: true, isDesktopApp: true, uiLanguage: "en" },
			paths: { resultsDirFor: () => ".results", attachmentPathFor: async (n) => n, roots: () => [], defaultRoot: () => ({ id: "", name: "", reviewLog: "", legacyReviewLog: null, vault: false }), rootOf: () => null, localPath: (p) => p, contractPath: (_r, p) => p },
			modals: { open: () => ({ panelEl: null, contentEl: null, close: () => {} }) },
			net: {
				async fetchJson(req) {
					journal.push(["fetchJson", req.url, req.method ?? "GET"]);
					/* La clé la plus SPÉCIFIQUE qui préfixe l'URL : un cas pose
					   « /api/tags » et « /api/version » séparément. */
					const cle = Object.keys(reponses).filter(k => req.url.includes(k)).sort((a, b) => b.length - a.length)[0];
					return cle === undefined ? null : reponses[cle];
				},
			},
			process: {
				/* `runs` : ce que le CLI RÉPOND, par « outil + arguments ». Sans
				   entrée, le rejet `indisponible` d'origine — l'hôte qui ne sait
				   pas lancer de CLI reste le défaut de ce faux. */
				async run(spec) {
					const cle = [spec.tool, ...(spec.args || [])].join(" ");
					journal.push(["run", cle]);
					const rep = runs[cle];
					if (rep === undefined) { const e = new Error("pas de CLI ici"); e.name = "indisponible"; throw e; }
					if (rep instanceof Error) throw rep;
					return { stdout: rep.stdout ?? "", stderr: rep.stderr ?? "", code: rep.code ?? 0 };
				},
				async lireCache(outil) {
					journal.push(["lireCache", outil]);
					return caches[outil] ?? null;
				},
				ollamaInstalle: async () => false,
				demarrerOllama: async () => false,
			},
		},
	};
}

await withSrcModule(
	["src/host/current.ts", "src/dashboard/ai-providers.ts"],
	async ({ installHost }, providers) => {
		const r = makeReporter("Fournisseurs IA");

		/* ── LE CATALOGUE CLOUD VIENT DE `ollama.com/api/tags`, en JSON ──
		   Jusqu'au 2026-09-19 le module cherchait un marqueur dans le HTML de la
		   page de recherche (`x-test-search-response-title`). Ce marqueur a
		   disparu du site : la fonction n'extrayait plus AUCUNE famille et rendait
		   le repli embarqué, sans erreur, depuis une date inconnue — le défaut
		   exact que ce script existe pour voir. `/api/tags` est le catalogue
		   lui-même, structuré ; un corps qui n'est pas du JSON lève. */
		{
			const json = JSON.stringify({ models: [
				{ name: "gpt-oss:120b", modified_at: "2025-08-05T00:00:00Z", size: 1 },
				{ name: "zzz-nouveau", modified_at: "2026-09-01T00:00:00Z", size: 1 },
				{ name: "deepseek-v4-pro:0813", modified_at: "2026-08-13T00:00:00Z", size: 1 },
			] });
			const { journal, hote } = fauxHote({ reponses: { "ollama.com/api/tags": { status: 200, body: json } } });
			installHost(hote);
			const catalogue = await providers.fetchOllamaCloudCatalog().catch(() => []);
			r.check("le catalogue cloud est demandé à l'hôte, à /api/tags d'ollama.com",
				journal.filter(l => l[0] === "fetchJson"), [["fetchJson", "https://ollama.com/api/tags", "GET"]]);
			r.check("une famille inconnue découverte en ligne entre au catalogue, en « <famille>:cloud »",
				catalogue.some(m => m.value === "zzz-nouveau:cloud"), true);
			r.check("une famille DÉJÀ couverte garde le tag exact du repli, jamais un tag deviné",
				{ devine: catalogue.some(m => m.value === "gpt-oss:cloud"), exact: catalogue.some(m => /^gpt-oss:\d+b-cloud$/.test(m.value)) },
				{ devine: false, exact: true });
			r.check("le suffixe de tag d'ollama.com (« :0813 ») ne devient pas une famille à part",
				catalogue.filter(m => m.value.startsWith("deepseek-v4-pro")).length, 1);
		}
		{
			const { hote } = fauxHote({ reponses: { "ollama.com/api/tags": { status: 200, body: "<!doctype html><title>Cloud models</title>" } } });
			installHost(hote);
			const verdict = await providers.fetchOllamaCloudCatalog().then(() => "valeur", () => "leve");
			r.check("un 200 qui n'est pas du JSON LÈVE (l'appelant garde son cache) au lieu de rendre un catalogue vide", verdict, "leve");
		}

		/* ── `/api/tags` ILLISIBLE (200 HTML) = HORS LIGNE ── */
		{
			const { hote } = fauxHote({
				reponses: { "/api/tags": { status: 200, body: "<html>Portail captif</html>" } },
			});
			installHost(hote);
			r.check("un 200 qui n'est pas du JSON n'est pas un serveur Ollama : hors ligne",
				await providers.checkOllama("http://localhost:11434", true), { ok: false, reason: "offline" });
		}
		{
			const { hote } = fauxHote({ reponses: { "/api/tags": { status: 500, body: "boom" } } });
			installHost(hote);
			r.check("un statut d'erreur vaut hors ligne",
				await providers.checkOllama("http://localhost:11434", true), { ok: false, reason: "offline" });
		}

		/* ── `/api/tags` VALIDE = modèles (avec leurs capabilities) + version ──
		   `capabilities` décide si la ligne « Effort » s'affiche pour un modèle
		   LOCAL ; la version vient de `/api/version`, best-effort. */
		{
			const { journal, hote } = fauxHote({
				reponses: {
					"/api/tags": { status: 200, body: JSON.stringify({ models: [{ name: "qwen3:8b", size: 12, capabilities: ["thinking"] }] }) },
					"/api/version": { status: 200, body: JSON.stringify({ version: "0.31.2" }) },
				},
			});
			installHost(hote);
			r.check("un /api/tags valide rend les modèles, leurs capabilities et la version du serveur",
				await providers.checkOllama("http://localhost:11434/", true),
				{ ok: true, models: [{ name: "qwen3:8b", size: 12, capabilities: ["thinking"] }], version: "0.31.2" });
			/* L'URL est NORMALISÉE (barre finale retirée) avant composition : sans
			   ça, « …:11434//api/tags » part sur le réseau. */
			r.check("l'URL du réglage est normalisée avant composition",
				journal.map(l => l[1]),
				["http://localhost:11434/api/tags", "http://localhost:11434/api/version"]);
		}
		{
			/* `/api/version` est BEST-EFFORT : son échec ne coûte qu'un numéro,
			   jamais le statut « joignable » ni la liste de modèles. */
			const { hote } = fauxHote({
				reponses: { "/api/tags": { status: 200, body: JSON.stringify({ models: [] }) } },
			});
			installHost(hote);
			r.check("un /api/version muet ne coûte que la version",
				await providers.checkOllama("http://localhost:11434", true), { ok: true, models: [], version: undefined });
		}

		/* ── LE COMPTE OLLAMA PAR `/api/me` ──
		   Mesuré le 2026-09-19 (Ollama 0.34.2) : 200 `{ plan, name, email… }`
		   connecté, 401 `{ error: "unauthorized", signin_url }` sinon. Seul
		   `plan` est lu ; l'adresse e-mail ne sort jamais de cette fonction. */
		{
			const { journal, hote } = fauxHote({ reponses: { "/api/me": { status: 200, body: JSON.stringify({ id: "x", email: "a@b.c", name: "A", plan: "free" }) } } });
			installHost(hote);
			const compte = await providers.checkOllamaCompte("http://localhost:11434/");
			r.check("/api/me est demandé en POST, sur l'URL réglée sans barre finale",
				journal.filter(l => l[0] === "fetchJson"), [["fetchJson", "http://localhost:11434/api/me", "POST"]]);
			r.check("200 avec plan → connecté, le plan, et RIEN d'autre", compte, { connecte: true, plan: "free" });
		}
		{
			const { hote } = fauxHote({ reponses: { "/api/me": { status: 401, body: JSON.stringify({ error: "unauthorized", signin_url: "https://ollama.com/connect?name=x&key=y" }) } } });
			installHost(hote);
			r.check("401 avec signin_url sur ollama.com → pas connecté, l'adresse à ouvrir",
				await providers.checkOllamaCompte(), { connecte: false, signinUrl: "https://ollama.com/connect?name=x&key=y" });
		}
		{
			const { hote } = fauxHote({ reponses: { "/api/me": { status: 401, body: JSON.stringify({ error: "unauthorized", signin_url: "https://attaquant.example/connect" }) } } });
			installHost(hote);
			r.check("401 avec une signin_url HORS d'ollama.com → l'adresse est refusée (on n'ouvre pas n'importe quoi)",
				await providers.checkOllamaCompte(), { connecte: false, signinUrl: null });
		}
		{
			const { hote } = fauxHote({ reponses: { "/api/me": { status: 200, body: "<html>portail</html>" } } });
			installHost(hote);
			r.check("200 sans JSON → pas connecté, sans adresse", await providers.checkOllamaCompte(), { connecte: false, signinUrl: null });
		}
		{
			const { hote } = fauxHote({ reponses: {} });
			installHost(hote);
			r.check("démon injoignable (null) → pas connecté, sans adresse", await providers.checkOllamaCompte(), { connecte: false, signinUrl: null });
		}

		/* ── LE PLAN REQUIS D'UN MODÈLE : deux sources, jamais une liste ──
		   `required_plan` des recommandations (cinq modèles, ce qu'utilise l'app
		   Ollama elle-même) et les 402 APPRIS à la génération. Aucune liste de
		   modèles gratuits n'est écrite dans le code : elle pourrirait sans
		   erreur (décision d'Ahmed, 2026-09-19). */
		{
			const recs = JSON.stringify({ recommendations: [
				{ model: "glm-5.3:cloud", required_plan: "pro" },
				{ model: "gemma4:31b-cloud", required_plan: "free" },
				{ model: "gemma4:26b" },
			] });
			const { journal, hote } = fauxHote({ reponses: { "/api/experimental/model-recommendations": { status: 200, body: recs } } });
			installHost(hote);
			const plans = await providers.fetchOllamaPlansRequis("http://localhost:11434");
			r.check("les recommandations sont lues sur le DÉMON (qui met ollama.com en cache), en GET",
				journal.filter(l => l[0] === "fetchJson"), [["fetchJson", "http://localhost:11434/api/experimental/model-recommendations", "GET"]]);
			r.check("seules les entrées qui portent required_plan sont retenues", plans, { "glm-5.3:cloud": "pro", "gemma4:31b-cloud": "free" });
		}
		{
			const { hote } = fauxHote({ reponses: {} });
			installHost(hote);
			r.check("recommandations injoignables → {} (best effort, jamais une exception)", await providers.fetchOllamaPlansRequis(), {});
		}
		{
			const sources = { recommandations: { "glm-5.3:cloud": "pro" }, appris: { "kimi-k3:cloud": "pro", "glm-5.3:cloud": "max" } };
			r.check("planRequisPour : les recommandations priment sur l'appris, l'appris couvre le reste, null sinon",
				["glm-5.3:cloud", "kimi-k3:cloud", "gpt-oss:120b-cloud"].map(t => providers.planRequisPour(t, sources)), ["pro", "pro", null]);
			r.check("modeleHorsPlan : free < pro < max < team ; null = on ne sait pas = pas hors plan",
				[
					providers.modeleHorsPlan("free", "pro"), providers.modeleHorsPlan("pro", "pro"), providers.modeleHorsPlan("max", "pro"),
					providers.modeleHorsPlan("free", "free"), providers.modeleHorsPlan("free", null), providers.modeleHorsPlan("free", "inconnu"), providers.modeleHorsPlan("pro", "inconnu"),
				],
				[true, false, false, false, false, true, false]);
			r.check("erreurOllamaHorsPlan : le 402 nu, ou le message mesuré, jamais un 403 « sign in »",
				[
					providers.erreurOllamaHorsPlan(402, ""),
					providers.erreurOllamaHorsPlan(400, "this model is not included in your free usage, add usage credits to pay as you go: https://ollama.com/settings or upgrade for included usage: https://ollama.com/upgrade"),
					providers.erreurOllamaHorsPlan(403, "please sign in"),
					providers.erreurOllamaHorsPlan(500, "boom"),
				],
				[true, true, false, false]);
		}

		/* ── `refreshCliCaches` REMPLIT L'INSTANTANÉ QUE LES LECTEURS LISENT ──
		   `getCodexModels` et `isFableOffered` sont SYNCHRONES (appelés en plein
		   rendu) : ils ne peuvent pas lire le disque eux-mêmes. Sans le
		   rafraîchissement, ils rendent le repli embarqué — et c'est exactement
		   ce que le premier cas vérifie, pour que le second ne soit pas vert par
		   construction. */
		{
			const cacheCodex = {
				mtimeMs: 111,
				json: { models: [{ slug: "gpt-5.6-terra", visibility: "list", priority: 1, display_name: "GPT-5.6 Terra" }] },
			};
			const cacheClaude = { mtimeMs: 222, json: { additionalModelOptionsCache: [{ value: "claude-fable" }] } };
			const { journal, hote } = fauxHote({ caches: { codex: cacheCodex, claude: cacheClaude } });
			installHost(hote);
			r.check("avant tout rafraîchissement, les lecteurs synchrones rendent le repli embarqué",
				{ codex: providers.getCodexModels().map(m => m.value), fable: providers.isFableOffered() },
				{ codex: providers.CODEX_FALLBACK_MODELS.map(m => m.value), fable: false });
			const change = await providers.refreshCliCaches();
			r.check("refreshCliCaches lit LES DEUX fichiers par l'hôte et signale le changement",
				{ lus: journal.filter(l => l[0] === "lireCache").map(l => l[1]).sort(), change },
				{ lus: ["claude", "codex"], change: true });
			r.check("… et c'est cet instantané que getCodexModels lit",
				providers.getCodexModels().map(m => m.value), ["gpt-5.6-terra"]);
			r.check("… et que isFableOffered lit", providers.isFableOffered(), true);
			/* Un second rafraîchissement sans changement de `mtime` rend `false` :
			   l'appelant qui a déjà dessiné sa liste ne doit pas se redessiner en
			   boucle (le rendu rappellerait `refreshCliCaches`, sans fin). */
			r.check("un instantané inchangé ne signale aucun changement", await providers.refreshCliCaches(), false);
		}

		/* Le BADGE de Fable vient du forfait PASSÉ (tranche 5, tâche 6) : le
		   module ne lit plus le trousseau lui-même — c'est ce qui l'a détaché
		   d'`ai-usage.ts`, donc d'Obsidian. Sans forfait connu (l'application),
		   Fable s'affiche SANS badge, jamais avec un badge deviné. */
		{
			const fableDe = (plan) => providers.getClaudeModels(plan).find(m => m.value === "fable");
			r.check("le badge de Fable suit le forfait PASSÉ, et reste absent quand l'appelant ne le connaît pas",
				{ max: !!fableDe({ name: "Max" })?.badge, pro: !!fableDe({ name: "Pro" })?.badge, inconnu: fableDe(undefined)?.badge, equipe: fableDe({ name: "Team" })?.badge },
				{ max: true, pro: true, inconnu: undefined, equipe: undefined });
		}

		/* ── LES SONDES DE CONNEXION (tranche « se connecter depuis l'échec ») ──

		   CE QU'ELLES EMPÊCHENT. La page « Générer » ouvre un terminal sur
		   `codex login` / `claude auth login` puis ATTEND, en boucle, que le
		   compte apparaisse. Trois façons dont cette attente échouerait sans
		   bruit, et c'est ce groupe qui les tient :

		   — `claude auth status` SORT EN 0 même déconnecté (c'est un rapport de
		     statut, pas un test) : juger sur le code de sortie relancerait la
		     génération sur un compte absent, et l'utilisateur relirait le même
		     échec sans comprendre ;
		   — une sortie qui n'est pas du JSON (bannière de mise à jour, version
		     plus ancienne du CLI) ne prouve RIEN : la prendre pour un succès
		     ferait la même chose ;
		   — un CACHE ferait attendre jusqu'à une minute devant « En attente de la
		     connexion » alors que c'est fait. Les sondes d'INSTALLATION en ont un
		     (60 s) ; celles-ci ne doivent pas. */
		{
			const { journal, hote } = fauxHote({
				runs: {
					"codex login status": { code: 0, stdout: "Logged in using ChatGPT" },
					"claude auth status": { code: 0, stdout: JSON.stringify({ loggedIn: true, email: "x@y.z" }) },
				},
			});
			installHost(hote);
			r.check("codex : `codex login status` en 0 vaut connecté",
				{ ok: await providers.checkCodexLogin(), appel: journal.filter(l => l[0] === "run").map(l => l[1]) },
				{ ok: true, appel: ["codex login status"] });
			r.check("claude : `auth status` et le drapeau `loggedIn` du JSON",
				await providers.checkClaudeLogin(), true);
			/* Deux appels de suite doivent RELANCER le CLI : c'est toute la
			   différence avec `checkCodex`, qui cache 60 s. */
			await providers.checkCodexLogin();
			r.check("aucun cache : chaque sonde relance le CLI",
				journal.filter(l => l[1] === "codex login status").length, 2);
		}
		{
			const { hote } = fauxHote({
				runs: {
					"codex login status": { code: 1, stderr: "Not logged in" },
					"claude auth status": { code: 0, stdout: JSON.stringify({ loggedIn: false }) },
				},
			});
			installHost(hote);
			r.check("un compte absent n'est pas connecté, des deux côtés",
				{ codex: await providers.checkCodexLogin(), claude: await providers.checkClaudeLogin() },
				{ codex: false, claude: false });
		}
		{
			/* Le cas qui a décidé de lire le JSON plutôt que le code de sortie. */
			const { hote } = fauxHote({ runs: { "claude auth status": { code: 0, stdout: "Checking for updates…" } } });
			installHost(hote);
			r.check("claude : une sortie qui n'est pas du JSON ne prouve pas la connexion, même en code 0",
				await providers.checkClaudeLogin(), false);
		}
		{
			/* Un outil disparu entre-temps, un hôte sans CLI : ni l'un ni l'autre
			   n'est « connecté ». Le rejet ne doit pas remonter jusqu'à la page,
			   qui repeindrait une erreur par-dessus la carte d'attente. */
			const { hote } = fauxHote({});
			installHost(hote);
			r.check("tout rejet de l'hôte vaut « pas connecté », jamais une exception",
				{ codex: await providers.checkCodexLogin(), claude: await providers.checkClaudeLogin() },
				{ codex: false, claude: false });
		}
		{
			const { journal, hote } = fauxHote({ runs: { "claude auth status": { code: 0, stdout: '{"loggedIn":true}' } } });
			installHost(hote);
			r.check("sondeConnexion(outil) rend bien la sonde de CET outil",
				{ ok: await providers.sondeConnexion("claude")(), appel: journal.filter(l => l[0] === "run").map(l => l[1]) },
				{ ok: true, appel: ["claude auth status"] });
		}

		r.done();
	},
);
