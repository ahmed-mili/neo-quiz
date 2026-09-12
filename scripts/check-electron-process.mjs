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
	OUTILS, avecFichiers, cheminCache, dossierPersonnel, emplacementsOllama, estOutilAutorise, lireCache,
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

		await cas(r, "la liste blanche est celle de l'hôte Obsidian, et elle est jugée à l'exécution", async () => {
			/* Le NOM vient du RENDU. `CliTool` le borne à la COMPILATION ; ceci le
			   borne à l'EXÉCUTION, où arrive un jour une valeur venue d'un
			   réglage, d'un quiz partagé ou d'une fenêtre compromise. La liste
			   doit être EXACTEMENT celle de `CLI_AUTORISES` (`apps/obsidian/
			   host.ts`) : le même code partagé appelle les deux hôtes, et un outil
			   accepté d'un côté et refusé de l'autre ferait dépendre le sort d'un
			   appel de l'hôte qui l'exécute. */
			r.check("la liste blanche est celle de l'hôte Obsidian, et elle est jugée à l'exécution",
				{
					liste: [...OUTILS],
					juge: ["claude", "codex", "ollama", "notepad", "x.bat", "", null, 3].map(estOutilAutorise),
				},
				{
					liste: ["claude", "codex", "ollama"],
					juge: [true, true, true, false, false, false, false, false],
				});
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
			   pas de substitution, et son texte traverse tel quel.

			   SANS PIÈCE JOINTE, et c'est une correction : ce cas en passait,
			   c'est-à-dire qu'il DÉCRIVAIT la combinaison que `run` refuse
			   désormais (des fichiers écrits qu'aucun jeton ne peut désigner).
			   Il resterait vert sur cette combinaison alors qu'elle est un défaut,
			   ce qui affaiblirait le cas qui la refuse un peu plus bas. Ce qu'il
			   éprouve — « pas de marqueur, pas de substitution » — n'a besoin
			   d'aucune pièce jointe pour être vu. */
			const sansFichiers = {
				args: ["-i", jeton(MARQ, "fichier:1"), "-C", jeton(MARQ, "home")],
				stdin: "PROMPT " + jeton(MARQ, "home"),
			};
			let vu = null;
			await avecFichiers(sansFichiers, async resolu => {
				vu = { args: resolu.args, stdin: resolu.stdin };
				return null;
			}, envMaisonSeule);
			r.check("sans marqueur, aucun jeton n'est substitué",
				vu, { args: sansFichiers.args, stdin: sansFichiers.stdin });
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

/**
 * LANCER UN CLI — SUR DE VRAIS PROCESS (tâche 7).
 *
 * CE QUE CE GROUPE EMPÊCHE, et c'est la capacité la plus dangereuse du pont :
 * lancer un programme. Cinq propriétés, dont aucune ne se voit à l'écran quand
 * elle casse :
 * — la LISTE BLANCHE de noms et le REFUS d'un `tool` hors liste ; sans elle,
 *   « écris `x.bat` dans un dossier ouvert » + « lance-le » composent une
 *   exécution que le périmètre des chemins ne voit pas ;
 * — l'ORDRE des deux sources de l'exécutable (le réglage de l'utilisateur, puis
 *   le `PATH` étendu) : inversé, le réglage ne servirait à rien, et une machine
 *   avec deux installations lancerait l'autre ;
 * — la CITATION des arguments sur le repli `cmd.exe` (installations npm) : la
 *   première version citait `\"`, qui FERME le guillemet, et `a" & echo … & "b`
 *   exécutait la charge. Le témoin sur disque est ce qui distingue « bien cité »
 *   de « cmd a exécuté la charge » ;
 * — l'ARBRE tué à l'annulation : `claude` et `codex` spawnent des enfants, et
 *   un `kill` sur le seul parent laisse la génération tourner APRÈS le clic sur
 *   Stop, avec un process orphelin dans le Gestionnaire des tâches ;
 * — le VERROU par outil, relâché sur TOUTES les issues : une fuite rend le
 *   fournisseur définitivement inutilisable jusqu'au redémarrage.
 *
 * SUR LE MODULE RÉEL, avec de VRAIS enfants — `process.execPath` (Node
 * lui-même, le seul exécutable dont on soit sûr qu'il existe) lancé soit
 * DIRECTEMENT par le réglage « chemin », soit par un faux `codex.cmd` posé sur
 * un `PATH` bricolé, qui force le repli `cmd.exe`.
 *
 * L'ENVIRONNEMENT EST DÉDIÉ, jamais `process.env` : `APPDATA`, `LOCALAPPDATA`
 * et `CODEX_INSTALL_DIR` en sont ABSENTS. `environnementEnfant` les lit pour
 * ajouter des chemins en dur au `PATH` — et c'est précisément `LOCALAPPDATA`
 * qui, sur la machine d'Ahmed, pointe vers le VRAI Codex officiel. Un `PATH`
 * scopé ne sert à rien si ces trois variables réintroduisent un dossier réel
 * juste après : le cas recevrait la réponse du vrai CLI au lieu de celle du
 * faux (défaut vécu, `check:obsidian-host`, ronde 2 de la tâche 4).
 */
await withSrcModule("apps/windows/electron/process.ts", async ({ resoudreExecutable, run }) => {
	const r = makeReporter("Électron — lancer un CLI");
	const racine = mkdtempSync(join(tmpdir(), "quiz-lancer-"));
	const maison = join(racine, "maison");
	const vide = join(racine, "vide");
	mkdirSync(maison, { recursive: true });
	mkdirSync(vide, { recursive: true });

	/** Un environnement où RIEN d'autre que ce dossier n'est joignable. */
	const envDe = (dossier) => ({
		PATH: dossier,
		// Ce qu'il faut à `cmd.exe` pour se lancer lui-même.
		SystemRoot: process.env.SystemRoot,
		ComSpec: process.env.ComSpec,
		PATHEXT: process.env.PATHEXT,
		TEMP: process.env.TEMP,
		TMP: process.env.TMP,
		// Le dossier personnel : c'est le `cwd` des enfants, il doit exister.
		USERPROFILE: maison,
		HOME: maison,
	});

	/** Un faux CLI : un script Node, plus un lanceur du nom demandé.
	    `codex.cmd` sous Windows — même là où un `.exe` marcherait : c'est le
	    lanceur d'une installation npm réelle, et c'est délibérément le repli
	    `cmd.exe` (le chemin durci contre l'injection) qui doit être exercé. */
	const poserFauxCli = (nom, corps) => {
		const dossier = mkdtempSync(join(racine, "cli-"));
		const script = join(dossier, "faux.js");
		writeFileSync(script, corps);
		const lanceur = join(dossier, process.platform === "win32" ? nom + ".cmd" : nom);
		if (process.platform === "win32") {
			writeFileSync(lanceur, '@echo off\r\n"' + process.execPath + '" "' + script + '" %*\r\n');
		} else {
			writeFileSync(lanceur, '#!/bin/sh\nexec "' + process.execPath + '" "' + script + '" "$@"\n', { mode: 0o755 });
		}
		return { dossier, lanceur };
	};

	const nomDuRejet = async (promesse) => {
		try {
			await promesse;
			return "(aucun rejet)";
		} catch (e) {
			return e && e.name ? e.name : String(e);
		}
	};
	const dodo = (ms) => new Promise(resolve => setTimeout(resolve, ms));

	try {
		/* ── L'ORDRE DES DEUX SOURCES ── */
		const surPath = poserFauxCli("codex", "process.stdout.write('DU-PATH');");
		const ailleurs = poserFauxCli("autre", "process.stdout.write('DU-REGLAGE');");
		const env = envDe(surPath.dossier);

		await cas(r, "resoudreExecutable : le réglage l'emporte sur le PATH, sinon le PATH, sinon null", async () => {
			/* Le réglage EN PREMIER, sinon il ne servirait à rien : on ne le
			   remplit QUE parce que la recherche automatique échoue ou trouve la
			   mauvaise installation. Comparaison en minuscules : sous Windows
			   `PATHEXT` est écrit en MAJUSCULES, donc le chemin trouvé porte
			   « .CMD » là où le fichier posé s'appelle « .cmd » — même fichier,
			   système insensible à la casse, et rien de ce qui suit n'en dépend. */
			const bas = (p) => (typeof p === "string" ? p.toLowerCase() : p);
			r.check("resoudreExecutable : le réglage l'emporte sur le PATH, sinon le PATH, sinon null",
				{
					regle: bas(resoudreExecutable("codex", ailleurs.lanceur, env)),
					parLePath: bas(resoudreExecutable("codex", undefined, env)),
					videIgnore: bas(resoudreExecutable("codex", "   ", env)),
					aucun: resoudreExecutable("claude", undefined, env),
				},
				{
					regle: bas(ailleurs.lanceur),
					parLePath: bas(surPath.lanceur),
					videIgnore: bas(surPath.lanceur),
					aucun: null,
				});
		});

		await cas(r, "run lance l'exécutable du réglage, et celui du PATH quand il n'y en a pas", async () => {
			/* LA MOITIÉ QUI MANQUERAIT à la vérification ci-dessus : `resoudre`
			   peut rendre le bon chemin et `run` en lancer un autre. Les deux
			   appels passent par le repli `cmd.exe` sous Windows (le lanceur est
			   un `.cmd`), donc ce cas éprouve AUSSI que ce repli aboutit. */
			const parReglage = await run({ tool: "codex", args: [], stdin: "" }, { cheminRegle: ailleurs.lanceur, env });
			const parPath = await run({ tool: "codex", args: [], stdin: "" }, { env });
			r.check("run lance l'exécutable du réglage, et celui du PATH quand il n'y en a pas",
				{ parReglage: parReglage.stdout, parPath: parPath.stdout, code: parPath.code },
				{ parReglage: "DU-REGLAGE", parPath: "DU-PATH", code: 0 });
		});

		/* ── LE STDIN, LES FLUX, LE CODE DE SORTIE ──
		   Lancés par `process.execPath` DIRECTEMENT (le réglage « chemin ») :
		   c'est le chemin `spawn` sans interpréteur, l'autre moitié du repli
		   `cmd.exe` éprouvé juste au-dessus. */
		const rapporteur = join(racine, "rapporteur.js");
		writeFileSync(rapporteur, [
			"let entree = '';",
			"process.stdin.on('data', d => { entree += d; });",
			"process.stdin.on('end', () => {",
			"  process.stdout.write('OUT:' + entree.length + ':' + process.argv.slice(2).join(','));",
			"  process.stderr.write('ERR:diagnostic');",
			"  process.exit(7);",
			"});",
		].join("\n"));

		await cas(r, "run écrit le stdin complet puis le ferme, et passe les arguments", async () => {
			/* Le stdin COMPLET, puis FERMÉ : sans le `end()`, le faux CLI
			   n'atteindrait jamais son `'end'` et `run` n'aboutirait pas — le cas
			   expirerait au lieu de rougir, mais il rougirait aussi sur la
			   LONGUEUR si une partie du prompt était perdue. */
			const res = await run(
				{ tool: "codex", args: [rapporteur, "-p", "--model", "opus"], stdin: "x".repeat(5000) },
				{ cheminRegle: process.execPath, env },
			);
			r.check("run écrit le stdin complet puis le ferme, et passe les arguments",
				res.stdout, "OUT:5000:-p,--model,opus");
			r.check("stdout et stderr sont rendus séparés, avec le code de sortie",
				{ stderr: res.stderr, code: res.code }, { stderr: "ERR:diagnostic", code: 7 });
		});

		/* ── LES ARGUMENTS N'ATTEIGNENT PAS UN INTERPRÉTEUR ──
		   Le témoin sur disque est ce qui distingue « bien cité » de « cmd a
		   exécuté la charge » : l'`argv` seul ne le dirait pas. */
		await cas(r, "un argument à guillemets et métacaractères arrive intact, sans rien exécuter", async () => {
			const echo = poserFauxCli("codex", "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
			const temoin = join(racine, "pwn.txt");
			const charge = 'a" & echo PWN > ' + temoin.split("\\").join("/") + ' & "b';
			const argsCites = ["--model", charge, "", "espace et suite"];
			let recus = "(pas de sortie)";
			try {
				recus = (await run({ tool: "codex", args: argsCites, stdin: "" }, { env: envDe(echo.dossier) })).stdout;
			} catch (e) {
				recus = "EXCEPTION: " + (e && e.message ? e.message : String(e));
			}
			r.check("un argument à guillemets et métacaractères arrive intact, sans rien exécuter",
				{ argv: recus, temoin: existsSync(temoin) },
				{ argv: JSON.stringify(argsCites), temoin: false });
		});

		await cas(r, "les refus sont jugés avant tout lancement, et nommés", async () => {
			/* Les quatre refus que `run` prononce SANS rien lancer ni rien écrire.
			   « fichiers sans marqueur » est le mineur laissé ouvert par la revue
			   de la tâche 4 : sans marqueur rien n'est substitué, donc les pièces
			   jointes seraient écrites, aucun jeton ne pourrait les désigner, le
			   CLI partirait sans savoir qu'elles existent — et l'appel
			   RÉUSSIRAIT, en ignorant l'image, sans un mot. */
			const piece = { nom: "image-1.png", base64: Buffer.from("X").toString("base64") };
			r.check("les refus sont jugés avant tout lancement, et nommés",
				{
					horsListe: await nomDuRejet(run({ tool: "notepad", args: [], stdin: "" }, { env })),
					sautDeLigne: await nomDuRejet(run(
						{ tool: "codex", args: [rapporteur, "a\nb"], stdin: "" },
						{ cheminRegle: process.execPath, env },
					)),
					fichiersSansMarqueur: await nomDuRejet(run(
						{ tool: "codex", args: [rapporteur], stdin: "", fichiers: [piece] },
						{ cheminRegle: process.execPath, env },
					)),
					sortieSansMarqueur: await nomDuRejet(run(
						{ tool: "codex", args: [rapporteur], stdin: "", sortieFichier: "out.txt" },
						{ cheminRegle: process.execPath, env },
					)),
				},
				{ horsListe: "refuse", sautDeLigne: "refuse", fichiersSansMarqueur: "refuse", sortieSansMarqueur: "refuse" });
		});

		await cas(r, "un exécutable absent rejette « introuvable », que le chemin vienne du PATH ou du réglage", async () => {
			/* C'est le rejet que le code partagé traduit en « CLI non installé »,
			   et un rejet ANONYME ferait chercher une panne ailleurs. Le réglage
			   est rendu TEL QUEL par `resoudreExecutable`, sans repli sur le
			   `PATH` : un repli lancerait une AUTRE installation que celle que
			   l'utilisateur a désignée, en silence. */
			r.check("un exécutable absent rejette « introuvable », que le chemin vienne du PATH ou du réglage",
				{
					pathVide: await nomDuRejet(run({ tool: "claude", args: [], stdin: "" }, { env: envDe(vide) })),
					regleFausse: await nomDuRejet(run(
						{ tool: "claude", args: [], stdin: "" },
						{ cheminRegle: join(racine, "n-existe-pas.exe"), env },
					)),
				},
				{ pathVide: "introuvable", regleFausse: "introuvable" });
		});

		await cas(r, "un timeout tue le process et rejette « timeout »", async () => {
			const dormeur = join(racine, "dormeur.js");
			writeFileSync(dormeur, "setTimeout(() => { process.stdout.write('TROP TARD'); }, 5000);");
			r.check("un timeout tue le process et rejette « timeout »",
				await nomDuRejet(run(
					{ tool: "codex", args: [dormeur], stdin: "", timeoutMs: 300 },
					{ cheminRegle: process.execPath, env },
				)),
				"timeout");
		});

		/* ── UN SEUL `run` PAR OUTIL, ET LE VERROU EST RELÂCHÉ ── */
		await cas(r, "un second run du même outil rejette « occupe » ; un autre outil passe", async () => {
			const lent = join(racine, "lent.js");
			writeFileSync(lent, "setTimeout(() => { process.stdout.write('FINI'); }, 500);");
			const premier = run({ tool: "codex", args: [lent], stdin: "" }, { cheminRegle: process.execPath, env });
			const second = await nomDuRejet(run({ tool: "codex", args: [lent], stdin: "" }, { cheminRegle: process.execPath, env }));
			/* Le verrou est par OUTIL : bloquer Codex pendant que Claude tourne
			   serait une limite inventée, et l'utilisateur ne peut de toute façon
			   lancer qu'une génération à la fois par fournisseur. */
			const autre = await run({ tool: "claude", args: [lent], stdin: "" }, { cheminRegle: process.execPath, env });
			r.check("un second run du même outil rejette « occupe » ; un autre outil passe",
				{ second, autre: autre.stdout, premier: (await premier).stdout },
				{ second: "occupe", autre: "FINI", premier: "FINI" });
		});

		await cas(r, "le verrou est relâché sur TOUTES les issues, y compris un échec", async () => {
			/* UNE FUITE DU VERROU REND LE FOURNISSEUR INUTILISABLE jusqu'au
			   redémarrage de l'application, sans qu'aucun message ne dise
			   pourquoi. Les deux issues non-heureuses passent d'abord (un rejet
			   après acquisition du verrou, un CLI qui sort NON NUL), puis un appel
			   normal : s'il rend « occupe », le verrou a fui. */
			const echoue = join(racine, "echoue.js");
			writeFileSync(echoue, "process.exit(3);");
			const apresIntrouvable = await nomDuRejet(run(
				{ tool: "codex", args: [], stdin: "" },
				{ cheminRegle: join(racine, "n-existe-pas.exe"), env },
			));
			const apresEchec = await run({ tool: "codex", args: [echoue], stdin: "" }, { cheminRegle: process.execPath, env });
			const ensuite = await run({ tool: "codex", args: [rapporteur], stdin: "ok" }, { cheminRegle: process.execPath, env });
			r.check("le verrou est relâché sur TOUTES les issues, y compris un échec",
				{ apresIntrouvable, codeEchec: apresEchec.code, ensuite: ensuite.stdout },
				{ apresIntrouvable: "introuvable", codeEchec: 3, ensuite: "OUT:2:" });
		});

		/* ── L'ANNULATION TUE L'ARBRE ── */
		await cas(r, "l'annulation tue l'ARBRE : le petit-enfant n'écrit jamais", async () => {
			/* `claude` et `codex` spawnent des enfants. Un `kill` sur le seul
			   premier process laisse la génération tourner APRÈS le clic sur
			   Stop : le fichier de sortie s'écrit, un process orphelin reste dans
			   le Gestionnaire des tâches, et la fenêtre, elle, est déjà revenue à
			   l'état repos. Le TÉMOIN est le seul moyen de le voir — un
			   petit-enfant qui écrit un fichier 1,5 s après son démarrage.

			   PAR LE FAUX `codex.cmd`, DONC PAR LE REPLI `cmd.exe`, et c'est
			   MESURÉ, pas supposé. Avec un enfant lancé DIRECTEMENT (Node par son
			   chemin), le `/T` ne se voit pas : libuv place un enfant non détaché
			   dans un Job Object qui meurt avec son parent, donc le petit-enfant
			   disparaît même sans `/T`, et le cas resterait VERT quoi qu'on casse.
			   `cmd.exe`, lui, lance son enfant sans job — c'est la forme d'une
			   installation npm sous Windows, le chemin PAR DÉFAUT pour
			   `claude.cmd`/`codex.cmd`, et celle où `killTree` est né. Mesuré sur
			   cette machine : sans `/T`, le témoin est écrit ; avec, jamais.

			   L'annulation part dès que le petit-enfant a confirmé être NÉ
			   (deux fichiers de rendez-vous), jamais après un délai fixe : un
			   délai trop court annulerait avant le `spawn`, et le cas passerait
			   pour une raison étrangère à ce qu'il éprouve. */
			const petit = join(racine, "petit.js");
			const temoin = join(racine, "petit-enfant.txt");
			const pret = join(racine, "pret.txt");
			writeFileSync(petit, [
				"const fs = require('fs');",
				"fs.writeFileSync(process.argv[2] + '.ne', 'ne');",
				"setTimeout(() => { fs.writeFileSync(process.argv[2], 'VIVANT'); }, 1500);",
			].join("\n"));
			const arbre = poserFauxCli("codex", [
				"const cp = require('child_process');",
				"const fs = require('fs');",
				"const a = process.argv.slice(2);",
				"cp.spawn(process.execPath, [a[0], a[1]], { stdio: 'ignore' });",
				"fs.writeFileSync(a[2], 'ok');",
				"setTimeout(() => { process.stdout.write('SURVIVANT'); }, 10000);",
			].join("\n"));

			const controleur = new AbortController();
			const promesse = run(
				{ tool: "codex", args: [petit, temoin, pret], stdin: "", signal: controleur.signal },
				{ env: envDe(arbre.dossier) },
			);
			const debut = Date.now();
			while (!existsSync(pret) && Date.now() - debut < 8000) await dodo(25);
			const debut2 = Date.now();
			while (!existsSync(temoin + ".ne") && Date.now() - debut2 < 8000) await dodo(25);
			const petitEnfantNe = existsSync(temoin + ".ne");
			controleur.abort();
			const rejet = await nomDuRejet(promesse);
			// Bien APRÈS l'instant où le petit-enfant aurait écrit.
			await dodo(2500);
			r.check("l'annulation tue l'ARBRE : le petit-enfant n'écrit jamais",
				{ petitEnfantNe, rejet, aEcrit: existsSync(temoin) },
				{ petitEnfantNe: true, rejet: "annule", aEcrit: false });
		});

		await cas(r, "un signal déjà abandonné rejette « annule » sans rien lancer", async () => {
			const c = new AbortController();
			c.abort();
			const marqueurDeVie = join(racine, "jamais.txt");
			const ecrivain = join(racine, "ecrivain.js");
			writeFileSync(ecrivain, "require('fs').writeFileSync(process.argv[2], 'LANCE');");
			const nom = await nomDuRejet(run(
				{ tool: "codex", args: [ecrivain, marqueurDeVie], stdin: "", signal: c.signal },
				{ cheminRegle: process.execPath, env },
			));
			await dodo(150);
			r.check("un signal déjà abandonné rejette « annule » sans rien lancer",
				{ nom, lance: existsSync(marqueurDeVie) }, { nom: "annule", lance: false });
		});
	} finally {
		rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
	}
	r.done();
});

/**
 * STATIQUE — LE CANAL `process.run` JUGE LE NOM AVANT TOUT.
 *
 * `canaux.ts` importe `electron` : aucun harnais ne peut le charger, et c'est
 * pourquoi cette assertion lit sa SOURCE, comme celle des canaux `fichiers.*`
 * et celle de la garde de la clé `ai` (`check:electron-reglages`).
 *
 * Ce qu'elle empêche : que la liste blanche glisse APRÈS le lancement, et
 * surtout que le CHEMIN de l'exécutable vienne un jour de l'appel IPC plutôt
 * que du magasin du principal — auquel cas la liste de noms ne séparerait plus
 * rien, le rendu envoyant le chemin qu'il veut.
 */
{
	const r = makeReporter("Électron — le canal process.run (statique)");
	const source = readFileSync("apps/windows/electron/canaux.ts", "utf-8");
	const debut = source.indexOf("ipcMain.handle(CANAUX.processusRun,");
	let corps = null;
	if (debut >= 0) {
		let niveau = 0;
		for (let i = source.indexOf("(", debut); i < source.length; i++) {
			if (source[i] === "(") niveau++;
			else if (source[i] === ")" && --niveau === 0) { corps = source.slice(debut, i + 1); break; }
		}
	}
	const garde = corps ? corps.indexOf("estOutilAutorise(") : -1;
	const lancement = corps ? corps.indexOf("await run(") : -1;
	r.check("le canal process.run juge le NOM (estOutilAutorise) AVANT de lancer",
		{ trouve: corps !== null, garde: garde >= 0, avantLancement: garde >= 0 && lancement > garde },
		{ trouve: true, garde: true, avantLancement: true });
	r.check("le chemin de l'exécutable est lu dans le magasin du PRINCIPAL, jamais reçu du rendu",
		{
			duMagasin: corps !== null && corps.includes("cheminCliRegle(reglagesOuErreur()"),
			pasDeCheminRecu: corps !== null && !/s\.chemin/.test(corps),
		},
		{ duMagasin: true, pasDeCheminRecu: true });
	r.done();
}
