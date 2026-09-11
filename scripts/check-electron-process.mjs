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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	avecFichiers, cheminCache, dossierPersonnel, emplacementsOllama, lireCache,
	nomDeFichierSur, run,
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

		/* ── LES PIÈCES JOINTES, ET LE DOSSIER QUI LES PORTE ──

		   CE QU'ILS EMPÊCHENT. `callClaude` et `callCodex` écrivaient eux-mêmes
		   les images dans un `mkdtempSync` et glissaient les chemins ABSOLUS
		   obtenus dans le prompt ou dans les arguments (`-i`, `-o`), puis
		   effaçaient le dossier. Le rendu n'a ni disque ni chemins : depuis la
		   tâche 4, il n'envoie que des JETONS que l'hôte remplace. Cette moitié
		   est écrite MAINTENANT, alors que `run` rejette encore, pour que la
		   tâche 7 n'ait plus qu'à poser le `spawn` au milieu — et surtout pour
		   qu'elle ne la réinvente pas autrement que l'hôte Obsidian, auquel cas
		   la même génération produirait deux prompts différents selon l'hôte.

		   L'EXÉCUTANT EST UN FAUX : `avecFichiers` ne lance rien lui-même, il
		   enveloppe. Le faux tient donc exactement le rôle du `spawn` de la
		   tâche 7 — il reçoit les arguments et le `stdin` SUBSTITUÉS, et peut
		   écrire le fichier de sortie comme le ferait un CLI. */
		const piece = { nom: "image-1.png", base64: Buffer.from("OCTETS-IMAGE").toString("base64") };
		const specImage = {
			args: ["-i", "{{fichier:1}}", "--dossier", "{{dossier}}", "-o", "{{sortie}}", "-C", "{{home}}"],
			stdin: "PROMPT\n- {{fichier:1}}\n",
			fichiers: [piece],
			sortieFichier: "last-message.txt",
		};
		const envMaisonSeule = { USERPROFILE: maison, HOME: maison };

		await cas(r, "{{fichier:1}} est remplacé dans les args ET dans stdin par un chemin qui existe", async () => {
			/* Le contenu est lu DEPUIS l'exécutant : c'est le seul moment où le
			   fichier existe encore, le dossier étant effacé au retour. Un test
			   fait après coup ne pourrait plus rien en dire. */
			let vu = null;
			await avecFichiers(specImage, async resolu => {
				vu = {
					nom: resolu.args[1].split(/[/\\]/).pop(),
					contenu: readFileSync(resolu.args[1], "utf8"),
					stdin: resolu.stdin.includes(resolu.args[1]) && !resolu.stdin.includes("{{fichier:1}}"),
				};
				return null;
			}, envMaisonSeule);
			r.check("{{fichier:1}} est remplacé dans les args ET dans stdin par un chemin qui existe",
				vu, { nom: "image-1.png", contenu: "OCTETS-IMAGE", stdin: true });
		});

		await cas(r, "{{dossier}} et {{home}} sont remplacés par le dossier temporaire et le dossier personnel", async () => {
			let vu = null;
			await avecFichiers(specImage, async resolu => {
				vu = {
					imageDansLeDossier: resolu.args[1].startsWith(resolu.args[3]),
					home: resolu.args[7],
				};
				return null;
			}, envMaisonSeule);
			r.check("{{dossier}} et {{home}} sont remplacés par le dossier temporaire et le dossier personnel",
				vu, { imageDansLeDossier: true, home: maison });
		});

		await cas(r, "sortieFichier rend le contenu écrit par l'enfant", async () => {
			const { sortie } = await avecFichiers(specImage, async resolu => {
				writeFileSync(resolu.args[5], "REPONSE FINALE");
				return null;
			}, envMaisonSeule);
			r.check("sortieFichier rend le contenu écrit par l'enfant", sortie, "REPONSE FINALE");
		});

		await cas(r, "sortieFichier absent rend undefined", async () => {
			/* `undefined` et non `""` : l'appelant distingue « le CLI n'a rien
			   écrit » (il reconstitue la réponse depuis les events JSONL) de
			   « il a écrit une réponse vide » (« ChatGPT n'a rien répondu »).
			   Une chaîne vide confondrait les deux. */
			const res = await avecFichiers(specImage, async () => "fini", envMaisonSeule);
			r.check("sortieFichier absent rend undefined",
				{ sortie: res.sortie, resultat: res.resultat }, { sortie: undefined, resultat: "fini" });
		});

		await cas(r, "le dossier temporaire est effacé même quand le CLI échoue", async () => {
			/* Un dossier qui SURVIT laisse les images de l'utilisateur dans
			   %TEMP% à chaque génération — un défaut qu'aucun écran ne montre.
			   Les deux issues qui ne sont pas un succès : un exécutant qui JETTE
			   (l'exécutable manque, l'appel est annulé) et un qui rend un échec. */
			let dossierVu = "";
			let leve = "(aucun rejet)";
			try {
				await avecFichiers(specImage, async resolu => {
					dossierVu = resolu.args[3];
					throw new Error("le CLI a échoué");
				}, envMaisonSeule);
			} catch (e) {
				leve = e.message;
			}
			r.check("le dossier temporaire est effacé même quand le CLI échoue",
				{ existeEncore: existsSync(dossierVu), dossierConnu: dossierVu.length > 0, leve },
				{ existeEncore: false, dossierConnu: true, leve: "le CLI a échoué" });
		});

		await cas(r, "un jeton {{fichier:N}} sans pièce jointe est refusé, avec son nom", async () => {
			/* Laissé passer, le jeton LITTÉRAL partirait sur la ligne de commande
			   et le CLI se plaindrait d'un chemin « {{fichier:3}} » qui ne
			   désigne rien. Refusé, le défaut se lit d'un coup d'œil. */
			let nom = "(aucun rejet)";
			try {
				await avecFichiers({ args: ["-i", "{{fichier:3}}"], stdin: "", fichiers: [piece] },
					async () => null, envMaisonSeule);
			} catch (e) {
				nom = e.name;
			}
			r.check("un jeton {{fichier:N}} sans pièce jointe est refusé, avec son nom", nom, "refuse");
		});

		await cas(r, "le nom d'une pièce jointe ne sort pas du dossier temporaire", async () => {
			/* Le rendu ne choisit pas OÙ le principal écrit : c'est la même règle
			   que `perimetre.borner` pour les chemins du pont. Un `..` ou un
			   séparateur dans le nom écrirait hors du dossier — la seule chose
			   que ce dossier promette. PURE, donc éprouvée seule. */
			r.check("le nom d'une pièce jointe ne sort pas du dossier temporaire",
				[
					nomDeFichierSur("../../evasion.bat", "defaut"),
					nomDeFichierSur("C:/Windows/System32/mal.exe", "defaut"),
					nomDeFichierSur("..", "defaut"),
					nomDeFichierSur("", "defaut"),
					nomDeFichierSur("image-1.png", "defaut"),
				],
				["evasion.bat", "mal.exe", "defaut", "defaut", "image-1.png"]);
		});
	} finally {
		rmSync(racine, { recursive: true, force: true });
	}
	r.done();
});
