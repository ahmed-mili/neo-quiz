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
function fauxHote({ reponses = {}, caches = {} } = {}) {
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
			shell: { openExternal: async () => false, revealInHost: async () => false },
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
				run: async () => { const e = new Error("pas de CLI ici"); e.name = "indisponible"; throw e; },
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

		/* ── LE CATALOGUE CLOUD VIENT DE `net.fetchJson` ──
		   Le corps rendu est du HTML (la page de recherche d'ollama.com) : le nom
		   `fetchJson` dit l'usage courant, pas une contrainte, et c'est écrit sur
		   le module. Une famille STRICTEMENT plus récente que le repli embarqué
		   entre au catalogue ; une famille déjà couverte garde son TAG EXACT
		   (les tailles `gpt-oss` ne sont pas devinables). */
		{
			const html = [
				"x-test-search-response-title>gpt-oss</span>",
				"x-test-search-response-title>zzz-nouveau</span>",
			].join("\n");
			const { journal, hote } = fauxHote({ reponses: { "ollama.com/search": { status: 200, body: html } } });
			installHost(hote);
			/* Le rejet devient une VALEUR (`[]`) : une rupture qui ferait lever
			   ici tuerait le groupe entier au lieu de rougir sur son cas. */
			const catalogue = await providers.fetchOllamaCloudCatalog().catch(() => []);
			r.check("le catalogue cloud est demandé à l'hôte, à l'URL de recherche d'ollama.com",
				journal.filter(l => l[0] === "fetchJson"), [["fetchJson", "https://ollama.com/search?c=cloud", "GET"]]);
			r.check("une famille inconnue découverte en ligne entre au catalogue, en « <famille>:cloud »",
				catalogue.some(m => m.value === "zzz-nouveau:cloud"), true);
			r.check("une famille DÉJÀ couverte garde le tag exact du repli, jamais un tag deviné",
				{ devine: catalogue.some(m => m.value === "gpt-oss:cloud"), exact: catalogue.some(m => /^gpt-oss:\d+b-cloud$/.test(m.value)) },
				{ devine: false, exact: true });
		}
		{
			/* Échec réseau : le module LÈVE (l'appelant garde son repli). Un
			   catalogue rendu silencieusement vide effacerait la liste de modèles. */
			const { hote } = fauxHote({ reponses: {} });
			installHost(hote);
			let leve = null;
			try { await providers.fetchOllamaCloudCatalog(); } catch (e) { leve = String(e.message); }
			r.check("un échec réseau sur le catalogue LÈVE, jamais un catalogue vide", leve !== null, true);
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

		r.done();
	},
);
