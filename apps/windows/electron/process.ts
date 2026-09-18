/* ══════════════════════════════════════════════════════════
   LES CLI ET LEURS FICHIERS — CÔTÉ PROCESSUS PRINCIPAL

   Tâche 3 de la génération IA dans l'application
   (docs/superpowers/plans/2026-09-11-generation-ia-app.md). C'est
   l'implémentation de `HostProcess` (`src/host/types.ts`) côté principal ; le
   rendu n'y accède que par les canaux du pont (`process.lireCache`,
   `process.ollamaInstalle`, `process.demarrerOllama` — voir `canaux.ts`).

   POURQUOI LE PRINCIPAL ET PAS LA FENÊTRE. `require` n'existe pas dans le
   rendu : `contextIsolation` et `sandbox` le lui retirent, et c'est le but.
   Le code partagé, lui, faisait dix `require("fs"|"os"|"path"|
   "child_process")` dans `src/dashboard/ai-providers.ts` — lire le cache de
   modèles de Codex, `~/.claude.json`, sonder `claude --version`, chercher
   Ollama à ses emplacements d'installation, le démarrer. Dans l'application,
   chacune de ces sondes aurait répondu « non installé » EN SILENCE. Tout ce
   qui touche Node vit donc ici.

   LES CHEMINS DE CE MODULE NE VIENNENT PAS DU RENDU, et c'est ce qui les rend
   sûrs sans passer par `perimetre.borner` : ils sont FIXES
   (`$CODEX_HOME/models_cache.json` ou `~/.codex/models_cache.json`,
   `~/.claude.json`, les emplacements d'installation d'Ollama). Le rendu
   n'envoie qu'un NOM d'outil, et `canaux.ts` refuse tout nom hors liste. Un
   chemin qui viendrait du rendu serait une porte disque de plus, hors
   périmètre — exactement ce que le pont existe pour fermer.

   `run` LANCE POUR DE BON depuis la tâche 7 : résolution de l'exécutable (le
   réglage « chemin » de l'utilisateur, sinon le `PATH` étendu), `spawn`, prompt
   complet sur `stdin`, et l'ARBRE de process tué à l'annulation. C'est la
   capacité la plus dangereuse du pont — lancer un programme — et elle est tenue
   par TROIS règles qui ne se remplacent pas l'une l'autre :
   1. la LISTE BLANCHE de noms (`OUTILS`), jugée dans `canaux.ts` avant tout, et
      re-jugée ici : c'est elle, et non le périmètre des chemins, qui sépare
      « lancer le CLI de l'utilisateur » de « lancer ce qu'on vient d'écrire sur
      son disque » ;
   2. le RÉGLAGE « chemin », lu par le PRINCIPAL dans son propre magasin, jamais
      pris de l'appel IPC — gardé à l'ÉCRITURE (`garde-ia.ts`) : absolu, d'une
      extension qu'un lanceur sait lancer, HORS DU PÉRIMÈTRE (là où la fenêtre
      peut écrire, un CLI ne vit jamais — sinon `write("<racine>/x.cmd")` puis
      ce chemin dans le réglage lançaient ce que le rendu venait d'écrire), et
      existant — et REJUGÉ AU LANCEMENT par `canaux.ts` avec le périmètre du
      jour, parce que celui-ci grandit après l'écriture ;
   3. la CITATION des arguments (`src/host/cli-args.ts`), sans laquelle le repli
      `cmd.exe` des installations npm laisse passer un `&`.

   Le DOSSIER PERSONNEL est INJECTABLE (`env`) et non lu d'un `os.homedir()`
   figé : `npm run check:electron-process` doit pouvoir éprouver le module
   RÉEL sur un faux dossier personnel, sans toucher aux vrais fichiers de la
   machine ni dépendre de ce qu'ils contiennent. `os.homedir()` ne suit PAS
   `process.env.HOME` sous Windows (il lit le profil du système), d'où une
   résolution explicite ici — et c'est la même règle que partout dans ce
   dépôt : ce qu'un contrôle ne peut pas atteindre n'est pas contrôlé.
══════════════════════════════════════════════════════════ */

import { nomDeFichierSur, substituerJetons } from "../../../src/host/jetons";
import type { FichierJoint } from "../../../src/host/jetons";
/* LA MOITIÉ PURE DE LA LIGNE DE COMMANDE est partagée avec l'hôte Obsidian
   (`src/host/cli-args.ts`) : citer un argument pour `cmd.exe` et lister les
   extensions du `PATH` sont les mêmes règles des deux côtés, et la citation a
   été durcie après une injection prouvée. Une seconde copie ici aurait donné
   deux règles pour un même appel du code partagé. */
import { extensionsExecutables, ligneCmd, porteSautDeLigne } from "../../../src/host/cli-args";
import { LOG_PREFIX } from "../../../src/branding";

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/** Ce que `lireCache` sait lire. `ollama` n'en a pas : son catalogue est
    interrogé par le réseau (`/api/tags`), pas par un fichier. */
export type OutilCache = "claude" | "codex";

/** Le contenu décodé d'un fichier de CLI, avec la date qui permet à l'appelant
    de ne pas re-parser. `null` = absent ou illisible. */
export interface CacheCli {
	mtimeMs: number;
	json: unknown;
}

/** Une erreur dont le `name` est celui que le contrat nomme. L'appelant décide
    sur ce nom, jamais sur le message — qui n'est pas traduit. */
export function erreurCli(nom: string, message: string): Error {
	const e = new Error(message);
	e.name = nom;
	return e;
}

/** Le dossier personnel, du `HOME`/`USERPROFILE` de l'environnement DONNÉ,
    sinon celui du système. PURE, et c'est la porte du contrôle : voir
    l'en-tête. */
export function dossierPersonnel(env: NodeJS.ProcessEnv = process.env): string {
	return env.USERPROFILE || env.HOME || homedir();
}

/**
 * Le chemin FIXE du fichier de cache/config d'un CLI. PURE.
 *
 * `$CODEX_HOME` est l'override que le CLI Codex honore lui-même : l'ignorer
 * ferait lire le cache d'une AUTRE installation que celle qui répond, et la
 * liste de modèles mentirait sans qu'aucune erreur ne le dise.
 */
export function cheminCache(tool: OutilCache, env: NodeJS.ProcessEnv = process.env): string {
	if (tool === "codex") {
		return join(env.CODEX_HOME || join(dossierPersonnel(env), ".codex"), "models_cache.json");
	}
	return join(dossierPersonnel(env), ".claude.json");
}

/**
 * Le fichier de cache d'un CLI, décodé. `null` quand il est absent, illisible
 * ou n'est pas du JSON — jamais une exception : une installation sans Codex
 * est un état NORMAL, et le code partagé retombe sur son repli embarqué.
 *
 * L'hôte LIT et DÉCODE ; le PARSING (quels modèles, quels efforts) reste dans
 * le code partagé — sans quoi deux hôtes auraient chacun leur lecture d'un
 * même fichier, et elles divergeraient.
 */
export async function lireCache(tool: OutilCache, env: NodeJS.ProcessEnv = process.env): Promise<CacheCli | null> {
	try {
		const fichier = cheminCache(tool, env);
		const mtimeMs = statSync(fichier).mtimeMs;
		return { mtimeMs, json: JSON.parse(readFileSync(fichier, "utf8")) as unknown };
	} catch (e) {
		return null;
	}
}

/**
 * Les emplacements d'installation officiels d'Ollama, par système. PURE.
 *
 * Ils servent de SECONDE sonde : un Ollama installé mais dont le binaire n'est
 * pas sur le PATH de l'application (une application de bureau démarre avec le
 * PATH du système, pas celui du terminal) répond quand même « installé », et
 * l'utilisateur voit « serveur arrêté » plutôt que « non installé ».
 */
export function emplacementsOllama(
	plateforme: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	if (plateforme === "win32") {
		return [join(env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama app.exe")];
	}
	if (plateforme === "darwin") {
		return ["/Applications/Ollama.app", "/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"];
	}
	return ["/usr/local/bin/ollama", "/usr/bin/ollama"];
}

/**
 * Ollama est-il INSTALLÉ, même serveur arrêté ?
 *
 * Deux sondes, dans l'ordre de l'hôte Obsidian (`apps/obsidian/host.ts`) :
 * le binaire répond à `--version` (il couvre npm, brew, un PATH personnalisé),
 * sinon un emplacement d'installation officiel existe. Une seule des deux ne
 * suffit pas : un Ollama installé par brew n'est à aucun emplacement de la
 * liste, et un Ollama installé par le paquet officiel n'est pas toujours sur
 * le PATH d'une application de bureau (elle démarre avec le PATH du système,
 * pas celui du terminal).
 *
 * `--version` est lancé SANS `stdin`, sans annulation et sans sortie à lire :
 * ce n'est pas `run` (tâche 7), c'est une question fermée à laquelle seul le
 * code de sortie répond.
 */
export async function ollamaInstalle(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
	if (await repondAVersion("ollama", env)) return true;
	return emplacementsOllama(process.platform, env).some(p => {
		try {
			return existsSync(p);
		} catch (e) {
			return false;
		}
	});
}

/** `<outil> --version` sort-il en 0 ? Toute autre issue (introuvable, code non
    nul, plus de 4 s) vaut « non » : la question n'a que deux réponses, et une
    exception ici ferait échouer une DÉTECTION.

    PAR `resoudreExecutable` ET `lancer`, comme `run` (revue finale, I2) : donc
    dans le `PATH` ÉTENDU (`environnementEnfant`), avec le repli `cmd.exe` pour
    un shim. La première écriture faisait un `spawn("ollama")` nu, sur le `PATH`
    du système — un Ollama installé par npm ou à un emplacement personnalisé
    répondait « non installé » DANS L'APPLICATION SEULEMENT, là où le greffon
    (qui passe par `lancerCli` et `buildChildEnv`) le voyait. */
async function repondAVersion(outil: Outil, env: NodeJS.ProcessEnv): Promise<boolean> {
	const executable = resoudreExecutable(outil, env);
	if (!executable) return false;
	try {
		const res = await lancer({
			executable, args: ["--version"], stdin: "", timeoutMs: 4000,
			env: environnementEnfant(env), cwd: dossierPersonnel(env),
		});
		return res.code === 0;
	} catch (e) {
		return false;
	}
}

/**
 * Démarre Ollama — DÉTACHÉ, et best effort.
 *
 * L'application de bureau sous Windows/macOS (le serveur démarre avec elle),
 * `ollama serve` sous Linux (pas d'application). Les erreurs asynchrones (exe
 * absent) sont AVALÉES : le booléen dit seulement que quelque chose a été
 * lancé. C'est le poll de l'appelant, qui interroge le serveur, qui constate
 * le résultat — et lui seul peut le faire honnêtement.
 */
export async function demarrerOllama(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
	try {
		/* Le `PATH` ÉTENDU ici aussi (revue finale, I2) : `spawn` cherche
		   l'exécutable dans le `PATH` de l'environnement DONNÉ, et `ollama serve`
		   d'une installation npm n'est pas sur celui du système. */
		const options = { detached: true, stdio: "ignore" as const, env: environnementEnfant(env) };
		let enfant;
		if (process.platform === "win32") {
			const exe = join(env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama app.exe");
			enfant = existsSync(exe)
				? spawn(exe, [], options)
				: spawn(resoudreExecutable("ollama", env) || "ollama", ["serve"], options);
		} else if (process.platform === "darwin") {
			enfant = spawn("open", ["-a", "Ollama"], options);
		} else {
			enfant = spawn(resoudreExecutable("ollama", env) || "ollama", ["serve"], options);
		}
		enfant.on("error", () => { /* constaté par le poll de l'appelant */ });
		enfant.unref();
		return true;
	} catch (e) {
		return false;
	}
}

/* ══════════════════════════════════════════════════════════
   INSTALLER UN CLI — UN TERMINAL VISIBLE, UNE RECETTE FIXE

   « Utilisable par n'importe qui » (spec du 2026-09-17, § 3c) : l'utilisateur
   ne sait pas ce qu'est PowerShell et ne collera pas une commande. L'app
   ouvre donc le terminal ELLE-MÊME, avec la recette OFFICIELLE de chaque
   outil, et le laisse ouvert pour qu'on voie l'installateur travailler puis
   la connexion du compte se faire au même endroit.

   LA RECETTE VIT ICI, jamais dans le rendu : `canaux.ts` ne reçoit qu'un nom
   d'outil, jugé par `estOutilAutorise` avant tout. `-EncodedCommand` porte
   le script en base64 (UTF-16LE, ce que PowerShell attend) : le base64 ne
   contient que `[A-Za-z0-9+/=]`, donc il ne peut refermer ni l'apostrophe de
   `-ArgumentList` ni le guillemet de `-Command` (`argumentsTerminal`) —
   aucune apostrophe, aucun `|`, aucun `$` du script n'atteint jamais la
   ligne de commande en clair.

   PAR SHELLEXECUTE (`Start-Process`), ET NON `cmd /c start` : une sonde sur
   la machine réelle (tâche 3, spec § 3c) a mesuré le `MainWindowHandle` de
   l'hôte de console créé par six variantes — `cmd /c start` lancé par
   `spawn` n'ouvre JAMAIS de fenêtre visible (un `conhost` au handle nul),
   qu'il soit détaché, masqué ou non ; `Start-Process` depuis un parent lancé
   normalement en ouvre une VRAIE, hébergée par le terminal par défaut de
   l'utilisateur (Windows Terminal compris). Le TITRE passe donc par le
   SCRIPT (`$host.UI.RawUI.WindowTitle`), pas par la ligne de commande : il
   n'a plus à être cité dans `argumentsTerminal`.

   NI `detached` NI `windowsHide` sur ce qui lance PowerShell : la même sonde
   a montré qu'un lanceur détaché ou masqué redonne un `conhost` sans
   fenêtre. Le process lanceur meurt tout de suite ; c'est la fenêtre ouverte
   par `Start-Process` qui reste.

   LE PATH DE LA SESSION EST RECHARGÉ avant de lancer `claude`/`codex` :
   `claude install` écrit le PATH utilisateur dans le registre, et la session
   PowerShell déjà ouverte ne le voit pas (lu dans install.ps1).
══════════════════════════════════════════════════════════ */

const RECHARGER_PATH = "$env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')";

/** Une chaîne littérale PowerShell entre apostrophes (la seule forme qui
    n'interpole rien) : l'apostrophe se double. */
function citerPs(texte: string): string {
	return "'" + texte.replace(/'/g, "''") + "'";
}

/**
 * Le script PowerShell complet qui installe `tool` puis y connecte le
 * compte. PURE. `titre` en est la PREMIÈRE ligne (`$host.UI.RawUI.
 * WindowTitle`) : c'est la seule façon de le porter jusqu'à la fenêtre une
 * fois que `argumentsTerminal` ne le cite plus sur la ligne de commande.
 */
export function scriptInstallation(tool: Outil, titre: string, messageFin: string): string {
	const lignes: string[] = ["$host.UI.RawUI.WindowTitle = " + citerPs(titre)];
	if (tool === "claude") {
		lignes.push("irm https://claude.ai/install.ps1 | iex", RECHARGER_PATH, "Write-Host " + citerPs(messageFin), "claude");
	} else if (tool === "codex") {
		lignes.push("irm https://chatgpt.com/codex/install.ps1 | iex", RECHARGER_PATH, "Write-Host " + citerPs(messageFin), "codex login");
	} else {
		lignes.push("winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements", "Write-Host " + citerPs(messageFin));
	}
	return lignes.join("\n");
}

/**
 * Le script PowerShell qui CONNECTE le compte d'un outil déjà installé.
 * PURE, jumelle de `scriptInstallation` — et volontairement plus courte :
 * rien n'est téléchargé, rien n'est exécuté depuis le réseau, on lance un
 * exécutable qui est déjà là.
 *
 * `null` pour Ollama, qui n'a pas de compte : l'appelant en fait
 * « indisponible » plutôt qu'une fenêtre ouverte sur rien.
 *
 * LE PATH EST QUAND MÊME RECHARGÉ, alors qu'on n'installe rien : la fenêtre
 * hérite du `PATH` du processus Electron, figé à SON démarrage. Un CLI
 * installé pendant la session de l'application (par le bouton d'installation,
 * juste avant) n'y figure donc pas, et le terminal se serait ouvert sur un
 * « terme non reconnu » alors que l'outil existe.
 */
export function scriptConnexion(tool: Outil, titre: string, messageFin: string): string | null {
	if (tool === "ollama") return null;
	return [
		"$host.UI.RawUI.WindowTitle = " + citerPs(titre),
		RECHARGER_PATH,
		/* `claude auth login` et non `claude` puis `/login` : la recette
		   d'installation passe par le REPL parce qu'elle y enchaîne après
		   l'installation, mais pour une connexion seule la sous-commande fait
		   le travail sans que l'utilisateur ait à taper quoi que ce soit. */
		tool === "claude" ? "claude auth login" : "codex login",
		"Write-Host " + citerPs(messageFin),
	].join("\n");
}

export function encoderCommande(script: string): string {
	return Buffer.from(script, "utf16le").toString("base64");
}

/** `titre` n'est PLUS cité ici (voir l'en-tête) : gardé en paramètre pour que
    `lancerTerminal` ait un seul point d'appel, il ne sert plus qu'à composer
    le script — pas cette ligne de commande. */
export function argumentsTerminal(titre: string, script: string): string[] {
	/* ShellExecute (`Start-Process`) et non `cmd /c start` : c'est la seule
	   forme qui a ouvert une VRAIE fenêtre à la sonde du 2026-09-17 (mesurée au
	   `MainWindowHandle` de l'hôte de console), et elle honore le terminal par
	   défaut de l'utilisateur, Windows Terminal compris. Le titre passe par le
	   SCRIPT (`$host.UI.RawUI.WindowTitle`), pas par la ligne de commande : il
	   n'a donc pas à être cité ici. Le base64 ne contient que [A-Za-z0-9+/=],
	   donc aucune apostrophe ne peut refermer la liste d'arguments. */
	return ["-NoProfile", "-Command",
		`Start-Process powershell.exe -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-EncodedCommand','${encoderCommande(script)}'`];
}

export function lancerTerminal(titre: string, script: string): boolean {
	if (process.platform !== "win32") return false;
	try {
		/* NI `detached` NI `windowsHide` sur ce qui ouvre la fenêtre : la sonde
		   a montré qu'un lanceur détaché ou masqué redonne un `conhost` sans
		   fenêtre. Le processus lanceur meurt tout de suite ; c'est la fenêtre
		   ouverte par ShellExecute qui reste. */
		const enfant = spawn("powershell.exe", argumentsTerminal(titre, script), { stdio: "ignore" });
		enfant.on("error", e => { console.warn(LOG_PREFIX, "terminal d'installation non lancé:", e); });
		enfant.unref();
		return true;
	} catch (e) {
		console.warn(LOG_PREFIX, "terminal d'installation non lancé:", e);
		return false;
	}
}

/* ══════════════════════════════════════════════════════════
   LES PIÈCES JOINTES D'UN APPEL, ET LE DOSSIER QUI LES PORTE

   Jumeau de `avecFichiers` dans `apps/obsidian/host.ts` pour sa moitié DISQUE
   seulement, et pour la même raison que `dossierPersonnel` l'est : chaque hôte
   tient la promesse du contrat avec ses primitives, et rien ne peut être
   partagé entre `apps/` (le rendu n'importerait pas ce module sans tirer Node
   avec lui, `check:host` assertion 6). Le reste ne l'est PLUS — voir plus bas.

   POURQUOI CE CODE EST ÉCRIT MAINTENANT, alors que `run` rejette encore.
   `callClaude` et `callCodex` écrivaient eux-mêmes les images dans un
   `mkdtempSync`, glissaient les chemins ABSOLUS obtenus dans le prompt
   (« First read these images… ») ou dans les arguments (`-i`, `-o`), puis
   effaçaient le dossier. Le rendu n'a ni disque ni chemins : il ne peut NI
   écrire ces fichiers, NI apprendre où ils sont. La tâche 7 n'a donc plus qu'à
   poser le `spawn` au milieu — la moitié FICHIERS est déjà là, éprouvée
   (`npm run check:electron-process`), au lieu d'être réinventée sous la
   pression du reste.

   LE DOSSIER EST EFFACÉ EN `finally`, TOUJOURS : un CLI qui échoue, expire ou
   est annulé laisserait sinon les images de l'utilisateur dans `%TEMP%`.

   LA MOITIÉ PURE (composer un jeton, le substituer, réduire un nom de fichier)
   vit dans `src/host/jetons.ts`, partagée avec l'hôte Obsidian : elle ne touche
   ni `fs`, ni `os`, ni `path`, et la dupliquer ici n'avait rien de forcé — les
   deux copies du premier jet de la tâche 4 avaient déjà divergé en une tranche.
   `src/` est importable depuis le processus principal, comme `canaux.ts`
   importe déjà `LOG_PREFIX` ; et comme ce module-là ne tire aucun Node, le
   RENDU pourrait l'importer aussi sans faire rougir `check:host`. Ne reste ici
   que ce qui touche le disque.
══════════════════════════════════════════════════════════ */

/**
 * Écrit les pièces jointes, substitue les jetons, exécute, relit `sortieFichier`,
 * efface le dossier. Le dossier n'existe que s'il sert : sans pièce jointe ni
 * fichier de sortie, seul `{{…:home}}` a un sens et rien n'est créé. Sans
 * marqueur, RIEN n'est substitué — c'est le défaut sûr.
 */
export async function avecFichiers<T>(
	spec: {
		args: string[];
		stdin: string;
		marqueur?: string;
		fichiers?: FichierJoint[];
		sortieFichier?: string;
	},
	executer: (resolu: { args: string[]; stdin: string }) => Promise<T>,
	env: NodeJS.ProcessEnv = process.env,
): Promise<{ resultat: T; sortie?: string }> {
	const fichiers = spec.fichiers || [];
	const dossier = (fichiers.length > 0 || spec.sortieFichier)
		? mkdtempSync(join(tmpdir(), "neo-quiz-cli-"))
		: "";
	try {
		const chemins = fichiers.map((f, i) => {
			const cible = join(dossier, nomDeFichierSur(f.nom, "piece-" + (i + 1)));
			writeFileSync(cible, Buffer.from(f.base64, "base64"));
			return cible;
		});
		const cheminSortie = spec.sortieFichier
			? join(dossier, nomDeFichierSur(spec.sortieFichier, "sortie.txt"))
			: "";
		const marqueur = spec.marqueur;
		const remplacer = (s: string): string => marqueur === undefined
			? s
			: substituerJetons(s, { marqueur, chemins, sortie: cheminSortie, maison: dossierPersonnel(env) });
		const resultat = await executer({ args: spec.args.map(remplacer), stdin: remplacer(spec.stdin) });
		let sortie: string | undefined;
		if (cheminSortie) {
			// Absent = le CLI ne l'a pas écrit : `undefined`, et l'appelant retombe
			// sur ce qu'il sait reconstituer. Jamais une exception.
			try {
				sortie = readFileSync(cheminSortie, "utf8");
			} catch (e) {
				sortie = undefined;
			}
		}
		return { resultat, sortie };
	} finally {
		if (dossier) {
			/* `maxRetries` N'EST PAS DU CONFORT : ce `finally` s'exécutera juste
			   après un `taskkill /T /F` (tâche 7), et Windows garde un handle
			   ouvert quelques dizaines de millisecondes après la mort d'un
			   process — `rmSync` rend alors EBUSY/EPERM. Et l'échec est DIT :
			   avalé en silence, le dossier d'images survivait dans `%TEMP%` à
			   chaque annulation, ce que ce `finally` existe pour empêcher. */
			try {
				rmSync(dossier, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
			} catch (e) {
				console.warn("[neo-quiz] dossier temporaire de CLI non effacé :", dossier, e);
			}
		}
	}
}

/* ══════════════════════════════════════════════════════════
   LANCER UN CLI — LA CAPACITÉ LA PLUS DANGEREUSE DU PONT
══════════════════════════════════════════════════════════ */

/**
 * Les CLI que ce processus accepte de lancer, et rien d'autre.
 *
 * LA MÊME LISTE QUE L'HÔTE OBSIDIAN (`CLI_AUTORISES`, `apps/obsidian/host.ts`),
 * `ollama` compris : le MÊME code partagé appelle les deux hôtes, et un outil
 * accepté d'un côté et refusé de l'autre ferait dépendre le sort d'un appel de
 * l'hôte qui l'exécute. Le rendu n'envoie qu'un NOM — jamais un chemin — et ce
 * nom est jugé par `canaux.ts` AVANT tout, puis ici : `process.run("x.bat")`
 * est ce que cette liste rend impossible, et c'est elle, et non le périmètre
 * des chemins, qui sépare « lancer le CLI de l'utilisateur » de « lancer ce
 * qu'on vient d'écrire sur son disque ».
 */
export const OUTILS = ["claude", "codex", "ollama"] as const;

export type Outil = (typeof OUTILS)[number];

/** Le nom vient du RENDU : jugé à l'EXÉCUTION, pas seulement à la compilation.
    PURE, et exportée pour que `canaux.ts` juge avec la même règle que `run` —
    deux listes recopiées divergeraient sans une erreur. */
export function estOutilAutorise(tool: unknown): tool is Outil {
	return typeof tool === "string" && (OUTILS as readonly string[]).includes(tool);
}

/**
 * Le `PATH` étendu des processus enfants. PURE (l'environnement est un
 * paramètre). JUMEAU de `buildChildEnv` (`apps/obsidian/host.ts`), et pour la
 * même raison que `dossierPersonnel` l'est : il touche `path`, donc il ne peut
 * pas vivre dans `src/` (le rendu n'importe jamais Node), et un hôte n'importe
 * pas l'autre.
 *
 * POURQUOI CES CHEMINS EN DUR. Une application de bureau démarre avec le `PATH`
 * du SYSTÈME, pas celui du terminal ; et un installateur qui modifie le `PATH`
 * du REGISTRE (Codex CLI officiel) n'atteint jamais un processus déjà lancé.
 * Sans ces entrées, « installé mais pas détecté » tant que l'application n'est
 * pas redémarrée (vécu Ahmed 2026-07-12 sous Obsidian, même cause ici).
 * Chemins vérifiés DANS les scripts d'installation d'OpenAI :
 * `install.ps1` → `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` ; `install.sh` →
 * `~/.local/bin` ; npm → `%APPDATA%\npm` ; `CODEX_INSTALL_DIR` est l'override
 * que les deux honorent.
 *
 * C'est la sonde automatique ; le réglage « chemin de l'exécutable » est le
 * dernier recours, pour la machine dont l'installation n'est à aucun de ces
 * endroits.
 */
export function environnementEnfant(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const home = dossierPersonnel(env);
	const extra: string[] = [
		join(home, ".local", "bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
		env.APPDATA ? join(env.APPDATA, "npm") : null,
		env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin") : null,
		env.CODEX_INSTALL_DIR || null,
		// Installateur Windows d'Ollama (CLI `ollama.exe` au même endroit).
		env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "Ollama") : null,
		/* ── LES GESTIONNAIRES QUE LES DEUX CLI EMPRUNTENT AUSSI ──
		   Ajoutés le 2026-09-17, quand les deux champs « chemin de
		   l'exécutable » des Réglages ont été retirés : la sonde devait
		   couvrir ce que ces champs rattrapaient à la main.
		   `~/.claude/local` est l'installation LOCALE de Claude Code
		   (`claude migrate-installer`, qui sort le CLI de npm global) ; les
		   autres sont les dossiers de binaires des gestionnaires de paquets
		   qui servent à installer ces mêmes CLI. Un dossier absent ne coûte
		   rien : la résolution le saute sans erreur. */
		join(home, ".claude", "local"),
		join(home, ".bun", "bin"),
		join(home, ".yarn", "bin"),
		join(home, ".volta", "bin"),
		join(home, "scoop", "shims"),
		env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "pnpm") : null,
	].filter((p): p is string => Boolean(p));
	const courant = env.PATH || "";
	const fusion = courant + delimiter + extra.filter(p => !courant.includes(p)).join(delimiter);
	return Object.assign({}, env, { PATH: fusion, Path: fusion });
}

/* ══════════════════════════════════════════════════════════
   LE `PATH` DU REGISTRE — la cause réelle des « CLI introuvable »

   Sous Windows, le `PATH` d'un processus est FIGÉ à son lancement. Tout
   installateur de CLI (npm global, Codex, bun, scoop…) écrit son dossier dans
   le `PATH` du REGISTRE et diffuse `WM_SETTINGCHANGE` ; les processus déjà
   lancés, eux, gardent l'ancien — et une application lancée depuis le menu
   Démarrer hérite du `PATH` de l'explorateur, pris lui-même à l'ouverture de
   la session. « Installé dans le terminal, invisible dans l'application » vient
   de là, pas d'un chemin exotique.

   C'est ce que les deux champs « chemin de l'exécutable » des Réglages
   rattrapaient à la main. Ils ont été retirés le 2026-09-17 ; les lire ICI,
   dans le registre, fait le même travail sans rien demander — et sans jamais
   accepter un chemin venu de la fenêtre, ce que ces champs, eux, faisaient.

   LU UNE FOIS, EN CACHE. `reg.exe` est un processus : le faire tourner à
   chaque résolution paierait deux `spawn` pour chaque lancement de CLI. La
   lecture est lancée au démarrage du principal (`chargerPathRegistre`) et son
   résultat FUSIONNÉ dans `process.env.PATH`, d'où tout le reste le voit —
   `environnementEnfant`, `resoudreExecutable`, `ollamaInstalle`.

   BEST EFFORT, TOUJOURS : pas de Windows, `reg.exe` absent, clé illisible,
   sortie inattendue — on garde le `PATH` du processus et rien ne change. Cette
   fonction ne doit jamais faire échouer un démarrage pour un confort de
   détection.
══════════════════════════════════════════════════════════ */

/** Les deux clés où Windows garde le `PATH` : celle de l'utilisateur, puis
    celle de la machine. L'ordre est celui que Windows lui-même applique en
    composant l'environnement d'une session. */
const CLES_PATH: ReadonlyArray<readonly [string, string]> = [
	["HKCU\\Environment", "Path"],
	["HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "Path"],
];

/** Remplace les `%VAR%` d'une valeur `REG_EXPAND_SZ` — `reg.exe` les rend
    telles quelles, et un `%USERPROFILE%\.bunin` non expansé ne désigne aucun
    dossier. Une variable inconnue est laissée en place : le dossier n'existera
    pas, la résolution le sautera. */
function expanser(valeur: string, env: NodeJS.ProcessEnv): string {
	return valeur.replace(/%([^%]+)%/g, (tout, nom: string) => {
		const v = env[nom] ?? env[nom.toUpperCase()];
		return typeof v === "string" ? v : tout;
	});
}

/** La valeur d'une clé de registre, ou `null`. `reg.exe` est appelé par
    `spawn` avec un TABLEAU d'arguments — jamais une ligne composée. */
function lireCleRegistre(cle: string, nom: string): Promise<string | null> {
	return new Promise(resoudre => {
		let sortie = "";
		let fini = false;
		const terminer = (v: string | null): void => { if (!fini) { fini = true; resoudre(v); } };
		try {
			const p = spawn("reg.exe", ["query", cle, "/v", nom], { windowsHide: true });
			/* UN DÉLAI DE GARDE : `reg.exe` sur une ruche montée en réseau peut
			   ne jamais répondre, et ce démarrage l'attendrait indéfiniment. */
			const garde = setTimeout(() => { try { p.kill(); } catch (e) { /* déjà mort */ } terminer(null); }, 4000);
			p.stdout?.on("data", (d: Buffer) => { sortie += d.toString(); });
			p.on("error", () => { clearTimeout(garde); terminer(null); });
			p.on("close", () => {
				clearTimeout(garde);
				/* La ligne est « <nom>    REG_EXPAND_SZ    <valeur> » ; la valeur
				   contient des espaces (« C:/Program Files/… »), d'où la capture
				   du reste de la ligne plutôt qu'un découpage sur l'espace. */
				const m = /^\s*\S+\s+REG_(?:EXPAND_)?SZ\s+(.*)$/m.exec(sortie);
				terminer(m ? m[1].trim() : null);
			});
		} catch (e) {
			terminer(null);
		}
	});
}

/**
 * Fusionne le `PATH` du registre dans celui du processus. À appeler UNE FOIS,
 * au démarrage du principal. Rend le nombre de dossiers ajoutés (zéro hors
 * Windows, ou quand le processus avait déjà tout).
 */
export async function chargerPathRegistre(
	env: NodeJS.ProcessEnv = process.env,
	plateforme: string = process.platform,
): Promise<number> {
	if (plateforme !== "win32") return 0;
	const courant = (env.PATH || "").split(delimiter).filter(Boolean);
	const deja = new Set(courant.map(d => d.toLowerCase().replace(/[\\/]+$/, "")));
	const ajouts: string[] = [];
	for (const [cle, nom] of CLES_PATH) {
		const brut = await lireCleRegistre(cle, nom);
		if (!brut) continue;
		for (const dossier of expanser(brut, env).split(delimiter).map(d => d.trim()).filter(Boolean)) {
			const norme = dossier.toLowerCase().replace(/[\\/]+$/, "");
			if (deja.has(norme)) continue;
			deja.add(norme);
			ajouts.push(dossier);
		}
	}
	if (!ajouts.length) return 0;
	const fusion = [...courant, ...ajouts].join(delimiter);
	env.PATH = fusion;
	// Windows lit `Path` autant que `PATH` : les deux doivent rester d'accord.
	if (env.Path !== undefined) env.Path = fusion;
	return ajouts.length;
}

/**
 * L'exécutable à lancer pour cet outil, ou `null` quand rien ne porte ce nom.
 *
 * UNE SEULE SOURCE : le premier fichier du `PATH` étendu qui porte ce nom,
 * `PATHEXT` compris sous Windows (`claude.cmd` d'une installation npm). Il en a
 * eu deux jusqu'au 2026-09-17, le réglage « chemin de l'exécutable » passant
 * devant ; ce réglage a été retiré, et c'est le `PATH` lui-même qui a été
 * élargi pour couvrir ce qu'il rattrapait (registre Windows, dossiers de
 * binaires des gestionnaires de paquets).
 *
 * L'ENVIRONNEMENT EST UN PARAMÈTRE : c'est la seule façon pour un contrôle
 * d'éprouver la résolution sans dépendre de ce que la machine a d'installé.
 */
export function resoudreExecutable(
	tool: Outil,
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	const etendu = environnementEnfant(env);
	const extensions = extensionsExecutables(etendu, process.platform);
	for (const dossier of (etendu.PATH || "").split(delimiter).filter(Boolean)) {
		for (const ext of extensions) {
			try {
				const candidat = join(dossier, tool + ext);
				if (statSync(candidat).isFile()) return candidat;
			} catch (e) { /* dossier inexistant ou illisible : au suivant */ }
		}
	}
	return null;
}

/**
 * Tue l'ARBRE de process, pas seulement le premier.
 *
 * `claude` et `codex` spawnent des enfants : un `kill` sur le seul parent laisse
 * la génération tourner — et le fichier de sortie s'écrire — après un clic sur
 * Stop, avec un process orphelin dans le Gestionnaire des tâches. Sous Windows
 * c'est `taskkill /T /F` (par `spawn` et un TABLEAU d'arguments, jamais une
 * ligne composée : le PID est un nombre, mais une ligne de commande est une
 * habitude qui finit par recevoir autre chose) ; ailleurs c'est le GROUPE
 * (`-pid`), ce qui suppose `detached: true` au lancement — les deux moitiés
 * sont inséparables, et c'est pourquoi elles sont écrites l'une en face de
 * l'autre (voir `lancer`).
 *
 * ATTENDABLE : la promesse se règle quand `taskkill` a FINI (son propre `close`),
 * ou aussitôt hors Windows (`kill` est synchrone). `lancer` ne s'en sert pas
 * pour se régler — c'est le `close` de l'ENFANT qui fait foi, voir ruling 15 —
 * mais un appelant qui veut savoir peut l'attendre. Best effort, comme l'hôte
 * Obsidian : une erreur ici ne doit pas remplacer le rejet `annule` que
 * l'appelant attend, elle se règle donc toujours.
 */
export function tuerArbre(pid: number | undefined): Promise<void> {
	if (typeof pid !== "number" || !Number.isFinite(pid)) return Promise.resolve();
	return new Promise(resolve => {
		try {
			if (process.platform === "win32") {
				const tueur = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
				tueur.on("error", () => resolve());
				tueur.on("close", () => resolve());
			} else {
				process.kill(-pid, "SIGTERM");
				resolve();
			}
		} catch (e) {
			resolve(); // best effort : le filet de `lancer` constatera
		}
	});
}

/** Le filet de sécurité de `lancer` : combien de temps attendre le `close` de
    l'enfant après avoir demandé sa mort, avant de rejeter QUAND MÊME. Un
    `taskkill` qui échoue ou un zombie ne doit jamais faire pendre un `run` —
    et un `run` qui pend fige le bouton Stop. Un PARAMÈTRE de `lancer`, pour
    que le contrôle puisse l'éprouver sans attendre cinq secondes. */
export const DELAI_GARDE_MS = 5000;

/**
 * Lance un exécutable, `stdin` écrit EN ENTIER puis fermé, `stdout` et `stderr`
 * accumulés SÉPARÉMENT et rendus à la fin avec le code de sortie.
 *
 * POURQUOI UN REPLI PAR `cmd.exe` SOUS WINDOWS. `CreateProcess` ne sait lancer
 * qu'un `.exe` : une installation npm (`claude.cmd`, `codex.cmd`) échoue — et
 * depuis Node 20, `spawn` d'un `.cmd`/`.bat` par son chemin JETTE
 * SYNCHRONEMENT (`EINVAL`, durcissement CVE-2024-27980) au lieu d'émettre
 * `error`. Les deux issues sont rattrapées, et le repli n'est tenté que si
 * l'exécutable EXISTE : sinon `cmd.exe` se lancerait pour rien et rendrait son
 * propre code de sortie (9009, message localisé) au lieu du rejet
 * `introuvable` que `checkClaudeCode` attend.
 *
 * Le chemin direct reste le PREMIER : aucun interpréteur entre nous et le CLI.
 */
export function lancer(spec: {
	executable: string;
	args: string[];
	stdin: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	/* DEUX COUTURES DE CONTRÔLE, comme `env` : ce qu'un contrôle ne peut pas
	   atteindre n'est pas contrôlé. `tuer` est `tuerArbre` par défaut ; un
	   contrôle y pose un espion (qui voit le PID) ou un no-op (pour éprouver le
	   filet). `delaiGardeMs` est `DELAI_GARDE_MS` par défaut. */
	tuer?: (pid: number | undefined) => Promise<void>;
	delaiGardeMs?: number;
}, parCmd = false): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve, reject) => {
		const tuer = spec.tuer || tuerArbre;
		const delaiGardeMs = spec.delaiGardeMs ?? DELAI_GARDE_MS;
		/* DÉJÀ ABANDONNÉ : on ne lance RIEN. Jugé avant le `spawn` et non après,
		   parce qu'un process lancé puis tué a le temps d'agir — mesuré :
		   l'enfant écrivait son fichier avant que `taskkill` n'arrive. Le rendu
		   court-circuite déjà de son côté (il ne traverse pas le pont) ; ceci
		   ferme le même trou côté principal, où arrive aussi l'annulation
		   relayée à la microseconde près. Même garde, même place, dans
		   `lancerCli` de l'hôte Obsidian. */
		if (spec.signal?.aborted) {
			reject(erreurCli("annule", "CLI annulé avant son lancement : " + spec.executable));
			return;
		}
		const options = {
			env: spec.env,
			cwd: spec.cwd,
			windowsHide: true,
			/* DÉTACHÉ HORS WINDOWS, et uniquement pour `tuerArbre` : c'est ce qui
			   fait de l'enfant le chef de son GROUPE, donc ce qui rend
			   `process.kill(-pid)` capable de tuer ses descendants. Sous Windows
			   `taskkill /T` s'en charge sans détachement — et détacher y ouvrirait
			   une console. */
			detached: process.platform !== "win32",
		};
		/* La ligne de `cmd.exe` est composée AVANT le `try` : `citerPourCmd`
		   REJETTE un argument qui porte un retour à la ligne (`name` valant
		   `refuse`), et le faire dans le `try` transformerait ce refus nommé en
		   « introuvable » — le contraire de ce qu'il dit. */
		const ligne = parCmd ? ligneCmd(spec.executable, spec.args) : "";
		const peutReessayer = !parCmd && process.platform === "win32" && existsSync(spec.executable);
		let enfant: ChildProcess;
		try {
			enfant = parCmd
				? spawn(
					(spec.env && spec.env.ComSpec) || "cmd.exe",
					["/d", "/s", "/c", ligne],
					Object.assign({ windowsVerbatimArguments: true }, options),
				)
				: spawn(spec.executable, spec.args, options);
		} catch (e) {
			// `EINVAL` synchrone d'un `.cmd`/`.bat` : c'est ICI que passe une
			// installation npm sous Node ≥ 20, pas par l'événement `error`.
			if (peutReessayer) {
				resolve(lancer(spec, true));
				return;
			}
			reject(erreurCli("introuvable", "CLI introuvable : " + spec.executable));
			return;
		}
		let fini = false;
		let minuteur: ReturnType<typeof setTimeout> | null = null;
		let filet: ReturnType<typeof setTimeout> | null = null;
		const sortir = (fn: () => void): void => {
			if (fini) return;
			fini = true;
			if (minuteur) clearTimeout(minuteur);
			if (filet) clearTimeout(filet);
			spec.signal?.removeEventListener("abort", surAbandon);
			fn();
		};
		/* LE MOTIF, ET NON LE RÈGLEMENT (ruling 15). Un abandon ou un délai
		   dépassé ne règlent PLUS la promesse eux-mêmes : ils notent POURQUOI,
		   demandent la mort de l'arbre, et c'est le `close` de l'ENFANT — qui ne
		   vient qu'une fois l'enfant mort et ses flux fermés, l'arbre avec lui
		   sous `/T /F` — qui rejette avec ce motif au lieu de résoudre. Sans ça,
		   `run` se réglait AVANT que le système ait tué quoi que ce soit : le
		   `finally` de `run` relâchait le verrou de l'outil et celui
		   d'`avecFichiers` effaçait le dossier temporaire pendant qu'un
		   petit-enfant lisait encore les pièces jointes, et un second `run` du
		   même outil pouvait partir pendant que l'arbre précédent écrivait
		   encore. Le témoin du contrôle ne le voyait pas : il regardait 2,5 s
		   plus tard, quand tout était fini.
		   LE FILET : si `close` n'arrive pas dans `delaiGardeMs` après la demande
		   de mort (un `taskkill` qui échoue, un zombie), on rejette QUAND MÊME
		   avec le motif, et on le DIT — un `run` ne doit jamais pendre, ce
		   serait un bouton Stop qui ne rend jamais la main. */
		let motif: "annule" | "timeout" | null = null;
		const demanderLaMort = (cause: "annule" | "timeout"): void => {
			if (fini || motif) return;
			motif = cause;
			void tuer(enfant.pid);
			filet = setTimeout(() => {
				console.warn(LOG_PREFIX, "CLI", spec.executable, ": l'enfant n'a pas fermé", delaiGardeMs, "ms après", cause, "— rejeté quand même (pid", enfant.pid, ")");
				sortir(() => reject(erreurCli(cause, "CLI " + (cause === "annule" ? "annulé" : "expiré") + ", sans confirmation de sa mort : " + spec.executable)));
			}, delaiGardeMs);
		};
		function surAbandon(): void {
			demanderLaMort("annule");
		}
		/* SÉPARÉS, et c'est le contrat : `stderr` porte le diagnostic (« not
		   logged in »), `stdout` la réponse. Les concaténer rendrait la sortie
		   JSON d'un CLI illisible dès qu'il écrit un avertissement. */
		let stdout = "";
		let stderr = "";
		enfant.stdout?.on("data", (d: unknown) => { stdout += String(d); });
		enfant.stderr?.on("data", (d: unknown) => { stderr += String(d); });
		enfant.on("error", (e: NodeJS.ErrnoException) => {
			if (peutReessayer && (e.code === "ENOENT" || e.code === "EINVAL")) {
				sortir(() => { resolve(lancer(spec, true)); });
				return;
			}
			sortir(() => reject(erreurCli(
				e.code === "ENOENT" ? "introuvable" : e.name || "erreur",
				"CLI " + spec.executable + " : " + e.message,
			)));
		});
		enfant.on("close", (code: number | null) => sortir(() => {
			if (motif) {
				reject(erreurCli(motif, "CLI " + (motif === "annule" ? "annulé" : "expiré") + " : " + spec.executable));
				return;
			}
			resolve({ stdout, stderr, code });
		}));
		if (spec.timeoutMs) {
			minuteur = setTimeout(() => demanderLaMort("timeout"), spec.timeoutMs);
		}
		/* Le cas « déjà abandonné » est traité tout en haut, avant le `spawn` :
		   il ne reste ici que l'abandon qui SURVIENDRA. */
		spec.signal?.addEventListener("abort", surAbandon, { once: true });
		/* Le prompt COMPLET sur `stdin`, puis FERMÉ : aucun argument à échapper,
		   et le CLI sait que l'entrée est finie. Un `stdin` resté ouvert ferait
		   attendre `claude -p` indéfiniment. */
		/* UN ÉCOUTEUR D'ERREUR SUR `stdin`, AVANT D'ÉCRIRE (revue finale, I1). Un
		   CLI qui sort AUSSITÔT sans lire son entrée (mauvaise authentification)
		   ferme le tuyau pendant qu'on y écrit encore un prompt de plusieurs
		   centaines de Ko : l'`EPIPE` arrive de façon ASYNCHRONE, sur le flux —
		   pas dans le `try` ci-dessous — et un flux Node sans écouteur `error`
		   lève une exception NON RATTRAPÉE, qui tue le PROCESSUS PRINCIPAL
		   entier, la fenêtre avec. Ce qui compte est déjà tenu par `close` et
		   `error` de l'enfant ; cette erreur-là n'apporte rien de plus. */
		enfant.stdin?.on("error", () => { /* `close` de l'enfant tranche */ });
		try {
			enfant.stdin?.write(spec.stdin);
			enfant.stdin?.end();
		} catch (e) { /* le process est déjà mort : `close` ou `error` tranche */ }
	});
}

/**
 * UN SEUL `run` PAR OUTIL À LA FOIS.
 *
 * Le verrou vit ICI, dans le principal, et non dans le rendu : c'est le
 * principal qui lance, et deux fenêtres (ou une page rechargée pendant une
 * génération) ne partagent aucun état du rendu. Un second appel rejette
 * `occupe` — un nom, pas un silence : le code partagé peut le dire à
 * l'utilisateur au lieu de laisser deux CLI écrire dans le même terminal.
 *
 * ET IL EST RELÂCHÉ SUR TOUTES LES ISSUES (`finally`) : une fuite rendrait le
 * fournisseur DÉFINITIVEMENT inutilisable jusqu'au redémarrage de
 * l'application, sans qu'aucun message ne dise pourquoi.
 */
const verrous = new Set<string>();

/**
 * Lance un CLI, pièces jointes comprises. C'est `HostProcess.run`
 * (`src/host/types.ts`) vu du processus principal.
 *
 * L'EXÉCUTABLE EST TOUJOURS RÉSOLU SUR LE `PATH`, à partir du seul NOM de
 * l'outil. Il a existé un réglage « chemin de l'exécutable » que `canaux.ts`
 * lisait dans le magasin du principal et passait ici ; il a été retiré le
 * 2026-09-17, et avec lui la seule façon dont un chemin de programme pouvait
 * venir de la fenêtre. Ce qui rattrape aujourd'hui les installations que le
 * `PATH` du processus ne voit pas, c'est la fusion du `PATH` du REGISTRE au
 * démarrage (`chargerPathRegistre`), plus les emplacements connus
 * d'`environnementEnfant`.
 */
export async function run(spec: {
	tool: string;
	args: string[];
	stdin: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	marqueur?: string;
	fichiers?: FichierJoint[];
	sortieFichier?: string;
}, options: {
	env?: NodeJS.ProcessEnv;
	/** Les deux coutures de `lancer`, transmises telles quelles. */
	tuer?: (pid: number | undefined) => Promise<void>;
	delaiGardeMs?: number;
} = {}): Promise<{
	stdout: string; stderr: string; code: number | null; sortie?: string;
}> {
	const env = options.env || process.env;
	/* Le NOM est jugé avant tout, et une seconde fois après `canaux.ts` : cette
	   fonction est exportée, et un appelant futur du principal ne passera pas
	   forcément par le canal. */
	if (!estOutilAutorise(spec.tool)) {
		throw erreurCli("refuse", "CLI hors liste : " + String(spec.tool));
	}
	/* DES FICHIERS SANS MARQUEUR SONT REFUSÉS. Sans marqueur, `avecFichiers` ne
	   substitue RIEN (son défaut sûr) : les pièces jointes seraient bel et bien
	   écrites, mais AUCUN jeton ne pourrait les désigner, le CLI partirait sans
	   savoir qu'elles existent, et l'appel RÉUSSIRAIT — une génération qui
	   ignore l'image jointe, sans un mot. Même chose pour `sortieFichier` : le
	   fichier serait créé, jamais nommé au CLI, et `sortie` reviendrait toujours
	   `undefined`. Jugé AVANT `avecFichiers`, qui écrirait sinon un dossier
	   temporaire pour rien. Même règle, même refus, dans l'hôte Obsidian. */
	if (spec.marqueur === undefined && ((spec.fichiers && spec.fichiers.length > 0) || spec.sortieFichier)) {
		throw erreurCli("refuse", "pièces jointes ou fichier de sortie sans marqueur : aucun jeton ne pourrait les désigner");
	}
	if (verrous.has(spec.tool)) {
		throw erreurCli("occupe", "une génération " + spec.tool + " est déjà en cours");
	}
	verrous.add(spec.tool);
	try {
		const executable = resoudreExecutable(spec.tool, env);
		/* Rejeté AVANT d'écrire quoi que ce soit : un dossier temporaire créé
		   pour être aussitôt effacé ne prouverait rien, et l'utilisateur doit
		   voir « CLI introuvable », pas « le modèle n'a rien répondu ». */
		if (!executable) {
			throw erreurCli("introuvable", "CLI introuvable : " + spec.tool);
		}
		const { resultat, sortie } = await avecFichiers(spec, async resolu => {
			/* ET AUCUN ARGUMENT NE PORTE DE SAUT DE LIGNE, sur TOUS les systèmes —
			   voir `porteSautDeLigne` (`src/host/cli-args.ts`). Jugé APRÈS
			   substitution : un jeton se remplace par un chemin, et c'est ce qui
			   part sur la ligne de commande qu'il faut juger. */
			if (resolu.args.some(porteSautDeLigne)) {
				throw erreurCli("refuse", "argument refusé : un saut de ligne ne peut pas être cité");
			}
			return lancer({
				executable,
				args: resolu.args,
				stdin: resolu.stdin,
				signal: spec.signal,
				timeoutMs: spec.timeoutMs,
				env: environnementEnfant(env),
				cwd: dossierPersonnel(env),
				tuer: options.tuer,
				delaiGardeMs: options.delaiGardeMs,
			});
		}, env);
		return Object.assign({}, resultat, { sortie });
	} finally {
		verrous.delete(spec.tool);
	}
}
