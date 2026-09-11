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
import { isAbsolute, join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

async function cas(r, nom, fn) {
	try {
		await fn();
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "pas d'exception");
	}
}

await withSrcModule("apps/windows/electron/process.ts", async ({
	avecFichiers, cheminCache, dossierPersonnel, emplacementsOllama, lireCache, run,
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
		   écrire le fichier de sortie comme le ferait un CLI.

		   LE FORMAT DES JETONS EST ÉCRIT ICI À LA MAIN, comme dans
		   `check-obsidian-host.mjs` : c'est une promesse du contrat, et un
		   contrôle qui le lirait de `src/host/jetons.ts` resterait vert si le
		   format changeait des deux côtés à la fois. */
		const jeton = (m, quoi) => "{{nq-" + m + ":" + quoi + "}}";
		const MARQ = "0123456789abcdef0123456789abcdef";
		const piece = { nom: "image-1.png", base64: Buffer.from("OCTETS-IMAGE").toString("base64") };
		const specImage = {
			marqueur: MARQ,
			args: ["-i", jeton(MARQ, "fichier:1"), "-o", jeton(MARQ, "sortie"), "-C", jeton(MARQ, "home")],
			stdin: "PROMPT\n- " + jeton(MARQ, "fichier:1") + "\n",
			fichiers: [piece],
			sortieFichier: "last-message.txt",
		};
		const envMaisonSeule = { USERPROFILE: maison, HOME: maison };

		await cas(r, "le jeton de pièce jointe est remplacé dans les args ET dans stdin par un chemin qui existe", async () => {
			/* Le contenu est lu DEPUIS l'exécutant : c'est le seul moment où le
			   fichier existe encore, le dossier étant effacé au retour. Un test
			   fait après coup ne pourrait plus rien en dire. */
			let vu = null;
			await avecFichiers(specImage, async resolu => {
				vu = {
					nom: resolu.args[1].split(/[/\\]/).pop(),
					contenu: readFileSync(resolu.args[1], "utf8"),
					stdin: resolu.stdin.includes(resolu.args[1]) && !resolu.stdin.includes("{{nq-"),
				};
				return null;
			}, envMaisonSeule);
			r.check("le jeton de pièce jointe est remplacé dans les args ET dans stdin par un chemin qui existe",
				vu, { nom: "image-1.png", contenu: "OCTETS-IMAGE", stdin: true });
		});

		await cas(r, "le jeton du dossier personnel rend le dossier personnel DONNÉ, pas celui de la machine", async () => {
			/* `USERPROFILE`/`HOME` sont des paramètres exprès : `homedir()` ne
			   suit pas `HOME` sous Windows, et un cas qui ne peut pas fabriquer
			   son entrée ne compare qu'à une formule recopiée du code. */
			let vu = null;
			await avecFichiers(specImage, async resolu => {
				vu = { home: resolu.args[5], imageDansUnDossierAPart: !resolu.args[1].startsWith(maison) };
				return null;
			}, envMaisonSeule);
			r.check("le jeton du dossier personnel rend le dossier personnel DONNÉ, pas celui de la machine",
				vu, { home: maison, imageDansUnDossierAPart: true });
		});

		await cas(r, "un prompt qui cite {{home}} ou {{fichier:1}} ressort INTACT", async () => {
			/* `stdin` porte la demande de l'utilisateur ET le contenu des notes
			   qu'il a jointes. La première forme des jetons était FIXE
			   (`{{home}}`) — une note sur Handlebars, Jinja ou Mustache faisait
			   donc partir le chemin ABSOLU de la machine au modèle, libre de le
			   recopier dans le quiz ; et un `{{fichier:1}}` cité sans image
			   jointe faisait REFUSER l'appel, tuant la génération sur un
			   diagnostic interne, en français, dans une interface anglaise. Le
			   marqueur est tiré au sort par appel — pas même la FORME complète
			   avec un autre marqueur ne collisionne, ce que la 3e phrase
			   ci-dessous éprouve. */
			const citations = "Un gabarit Handlebars s'écrit {{home}}, et {{fichier:1}} aussi. "
				+ "Même avec un autre marqueur : " + jeton("ffffffffffffffffffffffffffffffff", "home") + ".";
			let vu = null;
			await avecFichiers({ ...specImage, stdin: citations }, async resolu => {
				vu = resolu.stdin;
				return null;
			}, envMaisonSeule);
			r.check("un prompt qui cite {{home}} ou {{fichier:1}} ressort INTACT", vu, citations);
		});

		await cas(r, "sans marqueur, aucun jeton n'est substitué", async () => {
			/* Le défaut SÛR : un appelant qui ne fournit pas de marqueur ne veut
			   pas de substitution, et son texte traverse tel quel. */
			let vu = null;
			await avecFichiers({ ...specImage, marqueur: undefined }, async resolu => {
				vu = { args: resolu.args[1], stdin: resolu.stdin };
				return null;
			}, envMaisonSeule);
			r.check("sans marqueur, aucun jeton n'est substitué",
				vu, { args: jeton(MARQ, "fichier:1"), stdin: specImage.stdin });
		});

		await cas(r, "sortieFichier rend le contenu écrit par l'enfant", async () => {
			const { sortie } = await avecFichiers(specImage, async resolu => {
				/* LE CHEMIN DOIT ÊTRE ABSOLU avant qu'on écrive quoi que ce soit.
				   Sous une rupture de la substitution, `args[3]` vaut le jeton
				   LITTÉRAL : un chemin RELATIF, donc un fichier écrit dans le
				   dossier courant — le dépôt. C'est arrivé une fois, en salissant
				   l'arbre de travail. Un contrôle ne doit jamais écrire hors de
				   son dossier temporaire, même quand la règle qu'il éprouve est
				   cassée : la garde fait rougir le cas, ce qui est le but. */
				if (!isAbsolute(resolu.args[3])) {
					throw new Error("chemin de sortie non absolu (jeton non substitué ?) : " + resolu.args[3]);
				}
				writeFileSync(resolu.args[3], "REPONSE FINALE");
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
			   L'exécutant JETTE, comme le fera un `spawn` annulé ou introuvable. */
			let dossierVu = "";
			let leve = "(aucun rejet)";
			try {
				await avecFichiers(specImage, async resolu => {
					dossierVu = resolu.args[1].slice(0, resolu.args[1].lastIndexOf(resolu.args[1].includes("/") ? "/" : "\\"));
					throw new Error("le CLI a échoué");
				}, envMaisonSeule);
			} catch (e) {
				leve = e.message;
			}
			r.check("le dossier temporaire est effacé même quand le CLI échoue",
				{ existeEncore: existsSync(dossierVu), dossierConnu: dossierVu.length > 0, leve },
				{ existeEncore: false, dossierConnu: true, leve: "le CLI a échoué" });
		});

		await cas(r, "un jeton qui ne désigne rien est refusé, avec son nom", async () => {
			/* Laissé passer, le jeton LITTÉRAL partirait sur la ligne de commande
			   et le CLI se plaindrait d'un chemin qui ne désigne rien ; rendu
			   VIDE, il donnerait `-o ""`, un argument vide au lieu d'un chemin.
			   Les deux produisent un appel faux et muet. */
			const nomDuRejet = async (spec) => {
				try {
					await avecFichiers(spec, async () => null, envMaisonSeule);
					return "(aucun rejet)";
				} catch (e) {
					return e.name;
				}
			};
			r.check("un jeton qui ne désigne rien est refusé, avec son nom",
				{
					indexHorsBornes: await nomDuRejet({
						marqueur: MARQ, args: ["-i", jeton(MARQ, "fichier:3")], stdin: "", fichiers: [piece],
					}),
					sortieSansFichier: await nomDuRejet({
						marqueur: MARQ, args: ["-o", jeton(MARQ, "sortie")], stdin: "",
					}),
					marqueurInvalide: await nomDuRejet({
						marqueur: "pas-hexa!", args: ["-i", "x"], stdin: "", fichiers: [piece],
					}),
				},
				{ indexHorsBornes: "refuse", sortieSansFichier: "refuse", marqueurInvalide: "refuse" });
		});

	} finally {
		rmSync(racine, { recursive: true, force: true });
	}
	r.done();
});

/**
 * LA MOITIÉ PURE DES JETONS (`src/host/jetons.ts`), éprouvée SEULE.
 *
 * Elle est partagée par les deux hôtes depuis la ronde 1 de la revue : composer
 * un jeton, le substituer, réduire un nom de fichier ne touche ni `fs`, ni
 * `os`, ni `path`. Dupliquée, elle avait DIVERGÉ en une tranche — l'une des
 * deux copies prenait son environnement en paramètre, l'autre lisait celui du
 * système. Ce groupe la tient à sa source ; les deux groupes d'hôte, eux,
 * tiennent la moitié DISQUE.
 *
 * Il vit dans ce script plutôt que dans un script neuf parce que c'est ici que
 * la moitié disque correspondante est déjà éprouvée : deux commandes pour un
 * même sujet se lancent moins souvent qu'une.
 */
await withSrcModule("src/host/jetons.ts", async ({
	jetonFichier, jetonHome, jetonSortie, nomDeFichierSur, nouveauMarqueur, substituerJetons,
}) => {
	const r = makeReporter("Jetons de pièces jointes (code partagé)");
	const MARQ = "0123456789abcdef0123456789abcdef";
	const valeurs = { marqueur: MARQ, chemins: ["/tmp/x/image-1.png"], sortie: "/tmp/x/out.txt", maison: "/home/a" };

	/* LA FORME DES JETONS est une promesse du contrat : `HostProcess.run` la
	   documente, et `check-obsidian-host.mjs` comme le groupe ci-dessus
	   l'écrivent à la main. Ce cas est le seul endroit où la SOURCE est
	   comparée à la forme écrite : s'ils divergent, c'est ici qu'on le voit. */
	r.check("les trois jetons portent le marqueur de l'appel",
		[jetonFichier(MARQ, 1), jetonFichier(MARQ, 12), jetonSortie(MARQ), jetonHome(MARQ)],
		["{{nq-" + MARQ + ":fichier:1}}", "{{nq-" + MARQ + ":fichier:12}}",
			"{{nq-" + MARQ + ":sortie}}", "{{nq-" + MARQ + ":home}}"]);

	/* Le marqueur est HEXADÉCIMAL et de longueur fixe : c'est ce qui en fait un
	   littéral sûr dans l'expression régulière composée ensuite, sans
	   échappement. Deux appels ne partagent pas le même — sinon le texte d'une
	   génération pourrait citer le jeton de la suivante. */
	const m1 = nouveauMarqueur();
	const m2 = nouveauMarqueur();
	r.check("un marqueur neuf est hexadécimal, long, et différent à chaque appel",
		{ forme: /^[0-9a-f]{32}$/.test(m1), distincts: m1 !== m2 }, { forme: true, distincts: true });

	r.check("les jetons du marqueur sont remplacés par leurs valeurs",
		substituerJetons(
			"lis " + jetonFichier(MARQ, 1) + " puis écris " + jetonSortie(MARQ) + " depuis " + jetonHome(MARQ),
			valeurs),
		"lis /tmp/x/image-1.png puis écris /tmp/x/out.txt depuis /home/a");

	/* LE TEXTE DE L'UTILISATEUR N'EST PAS UN JETON. `stdin` porte sa demande et
	   le contenu de ses notes ; la forme FIXE du premier jet (`{{home}}`)
	   collisionnait avec tout gabarit Handlebars, Jinja ou Mustache — et faisait
	   partir un chemin absolu de la machine au modèle. */
	const citations = "Handlebars écrit {{home}}, {{fichier:1}}, {{sortie}} ; "
		+ "et avec un AUTRE marqueur : " + jetonHome("ffffffffffffffffffffffffffffffff") + ".";
	r.check("un texte qui cite {{home}}, {{fichier:1}} ou le jeton d'un autre marqueur ressort INTACT",
		substituerJetons(citations, valeurs), citations);

	/* UN JETON QUI NE DÉSIGNE RIEN REFUSE — il ne s'efface pas. Rendu vide, il
	   donnerait `-o ""` au CLI : un argument vide au lieu d'un chemin, donc un
	   appel faux et MUET. */
	const nomDuJet = (fn) => { try { fn(); return "(aucun jet)"; } catch (e) { return e.name; } };
	r.check("un jeton qui ne désigne rien est refusé, avec son nom",
		{
			indexHorsBornes: nomDuJet(() => substituerJetons(jetonFichier(MARQ, 3), valeurs)),
			sortieAbsente: nomDuJet(() => substituerJetons(jetonSortie(MARQ), { ...valeurs, sortie: "" })),
			maisonAbsente: nomDuJet(() => substituerJetons(jetonHome(MARQ), { ...valeurs, maison: "" })),
			marqueurInvalide: nomDuJet(() => substituerJetons("x", { ...valeurs, marqueur: "PAS.HEXA*" })),
		},
		{ indexHorsBornes: "refuse", sortieAbsente: "refuse", maisonAbsente: "refuse", marqueurInvalide: "refuse" });

	/* REMPLACEMENT PAR FONCTION, jamais par chaîne : un chemin qui contient
	   `$&` ou `$1` serait réécrit par `String.replace`. Le dépôt a déjà payé ce
	   défaut ailleurs (cf. CLAUDE.md, `check:quiz-io`) — et un dossier
	   temporaire peut très bien contenir un `$`. */
	r.check("un chemin qui contient $& ou $1 est posé tel quel",
		substituerJetons(jetonFichier(MARQ, 1), { ...valeurs, chemins: ["C:/tmp/$&-$1-$$/image.png"] }),
		"C:/tmp/$&-$1-$$/image.png");

	/* Le rendu ne choisit pas OÙ l'hôte écrit : c'est la même règle que
	   `perimetre.borner` pour les chemins du pont. Un `..` ou un séparateur
	   sortirait du dossier temporaire, la seule chose que ce dossier promette. */
	r.check("le nom d'une pièce jointe ne sort pas du dossier temporaire",
		[
			nomDeFichierSur("../../evasion.bat", "defaut"),
			nomDeFichierSur("C:/Windows/System32/mal.exe", "defaut"),
			nomDeFichierSur("..", "defaut"),
			nomDeFichierSur("", "defaut"),
			nomDeFichierSur("image-1.png", "defaut"),
		],
		["evasion.bat", "mal.exe", "defaut", "defaut", "image-1.png"]);

	r.done();
});
