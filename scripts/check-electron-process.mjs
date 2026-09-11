/**
 * Non-régression des CLI ET DE LEURS FICHIERS dans le processus principal
 * Electron (`apps/windows/electron/process.ts`) — tâche 3 de la génération IA
 * dans l'application (docs/superpowers/plans/2026-09-11-generation-ia-app.md).
 *
 * CE QU'IL EMPÊCHE. La liste de modèles de Codex et tout ce que le greffon
 * sait de Claude Code viennent de DEUX fichiers, à des chemins que seul le
 * processus principal connaît (`$CODEX_HOME/models_cache.json` ou
 * `~/.codex/models_cache.json`, `~/.claude.json`). Une clé décalée, un
 * `$CODEX_HOME` ignoré, un fichier absent qui LÈVE au lieu de rendre `null` :
 * dans les trois cas, la page « Générer » affiche le repli embarqué du code
 * partagé — une liste de modèles PLAUSIBLE mais périmée, sans un seul message
 * d'erreur. Un modèle du repli retiré du compte donne un 404 au CLI, et on
 * cherche le défaut du côté du CLI.
 *
 * Et `run` n'est pas encore implémenté (tâche 7) : son rejet doit être NOMMÉ
 * (`indisponible`). Un `stdout` vide passerait pour une génération qui a
 * tourné pour rien.
 *
 * Sur le module RÉEL, par `withSrcModule`, avec un faux DOSSIER PERSONNEL
 * (l'environnement est un paramètre de `lireCache` et de `cheminCache`
 * exprès) : aucun des vrais fichiers de la machine n'est lu, et le contrôle
 * ne dépend pas de ce qu'ils contiennent.
 *
 * La tâche 7 étend ce script avec les cas à VRAIS process (stdin écrit puis
 * fermé, flux séparés, arbre tué à l'annulation, un `run` par outil).
 *
 *     npm run check:electron-process
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

async function cas(r, nom, fn) {
	try {
		await fn();
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "pas d'exception");
	}
}

await withSrcModule("apps/windows/electron/process.ts", async ({
	cheminCache, dossierPersonnel, emplacementsOllama, lireCache, run,
}) => {
	const r = makeReporter("Électron — les CLI");
	const racine = mkdtempSync(join(tmpdir(), "quiz-process-"));
	/* Un faux dossier personnel : `~/.claude.json` et `~/.codex/` y vivent,
	   plus un `$CODEX_HOME` SÉPARÉ, pour que « honore CODEX_HOME » ne puisse
	   pas passer par hasard — les deux fichiers ont un contenu DIFFÉRENT. */
	const maison = join(racine, "maison");
	const codexHome = join(racine, "ailleurs");
	mkdirSync(join(maison, ".codex"), { recursive: true });
	mkdirSync(codexHome, { recursive: true });
	writeFileSync(join(maison, ".codex", "models_cache.json"), '{"models":[{"slug":"du-dossier-personnel"}]}');
	writeFileSync(join(codexHome, "models_cache.json"), '{"models":[{"slug":"de-codex-home"}]}');
	writeFileSync(join(maison, ".claude.json"), '{"additionalModelOptionsCache":["fable"]}');

	const envMaison = { USERPROFILE: maison, HOME: maison };
	const envCodexHome = { USERPROFILE: maison, HOME: maison, CODEX_HOME: codexHome };

	try {
		await cas(r, "lireCache(\"codex\") lit le cache du dossier personnel", async () => {
			const cache = await lireCache("codex", envMaison);
			r.check("lireCache(\"codex\") lit le cache du dossier personnel",
				{ json: cache && cache.json, date: !!(cache && typeof cache.mtimeMs === "number") },
				{ json: { models: [{ slug: "du-dossier-personnel" }] }, date: true });
		});

		await cas(r, "lireCache(\"codex\") honore CODEX_HOME", async () => {
			/* `$CODEX_HOME` est l'override que le CLI Codex honore LUI-MÊME :
			   l'ignorer ferait lire le cache d'une AUTRE installation que celle
			   qui répond, et la liste de modèles mentirait sans une erreur. Les
			   deux fichiers existent, donc seul le bon chemin distingue. */
			const cache = await lireCache("codex", envCodexHome);
			r.check("lireCache(\"codex\") honore CODEX_HOME",
				{ json: cache && cache.json, chemin: cheminCache("codex", envCodexHome) },
				{ json: { models: [{ slug: "de-codex-home" }] }, chemin: join(codexHome, "models_cache.json") });
		});

		await cas(r, "lireCache(\"claude\") lit ~/.claude.json", async () => {
			/* Le dossier personnel est INJECTABLE (`USERPROFILE`/`HOME`) parce
			   que `os.homedir()` ne suit PAS `HOME` sous Windows : sans cette
			   entrée, ce cas ne pourrait lire que le vrai `~/.claude.json` de la
			   machine — dont le contenu varie, et qu'un contrôle n'a pas à lire. */
			const cache = await lireCache("claude", envMaison);
			r.check("lireCache(\"claude\") lit ~/.claude.json",
				{ json: cache && cache.json, chemin: cheminCache("claude", envMaison) },
				{ json: { additionalModelOptionsCache: ["fable"] }, chemin: join(maison, ".claude.json") });
		});

		await cas(r, "un cache absent rend null, sans lever", async () => {
			/* Une machine sans Codex est un état NORMAL, pas une panne : le code
			   partagé retombe sur son repli embarqué. Un jet ici remonterait
			   jusqu'au canal et ferait échouer l'affichage entier. */
			const vide = join(racine, "personne");
			mkdirSync(vide, { recursive: true });
			r.check("un cache absent rend null, sans lever",
				await lireCache("codex", { USERPROFILE: vide, HOME: vide }), null);
		});

		await cas(r, "un cache illisible rend null, sans lever", async () => {
			// Même règle pour du JSON invalide : « pas de cache », pas une panne.
			const casse = join(racine, "casse");
			mkdirSync(join(casse, ".codex"), { recursive: true });
			writeFileSync(join(casse, ".codex", "models_cache.json"), "{ ceci n'est pas du JSON");
			r.check("un cache illisible rend null, sans lever",
				await lireCache("codex", { USERPROFILE: casse, HOME: casse }), null);
		});

		await cas(r, "le dossier personnel vient de l'environnement donné, sinon du système", async () => {
			r.check("le dossier personnel vient de l'environnement donné, sinon du système",
				{ donne: dossierPersonnel(envMaison), systeme: typeof dossierPersonnel({}) },
				{ donne: maison, systeme: "string" });
		});

		await cas(r, "les emplacements d'Ollama sont ceux de chaque système", async () => {
			/* Ils servent de SECONDE sonde : un Ollama installé mais absent du
			   PATH d'une application de bureau doit quand même être vu. Une
			   entrée perdue ici, et l'utilisateur lit « non installé » alors que
			   le serveur n'est qu'arrêté. */
			r.check("les emplacements d'Ollama sont ceux de chaque système",
				{
					win: emplacementsOllama("win32", { LOCALAPPDATA: "C:/Local" }),
					mac: emplacementsOllama("darwin", {}),
					linux: emplacementsOllama("linux", {}),
				},
				{
					win: [join("C:/Local", "Programs", "Ollama", "ollama app.exe")],
					mac: ["/Applications/Ollama.app", "/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"],
					linux: ["/usr/local/bin/ollama", "/usr/bin/ollama"],
				});
		});

		await cas(r, "run rejette « indisponible », et le nomme", async () => {
			let nom = "(aucun rejet)";
			try {
				await run({ tool: "claude", args: ["--version"], stdin: "" });
			} catch (e) {
				nom = e.name;
			}
			r.check("run rejette « indisponible », et le nomme", nom, "indisponible");
		});
	} finally {
		rmSync(racine, { recursive: true, force: true });
	}
	r.done();
});
