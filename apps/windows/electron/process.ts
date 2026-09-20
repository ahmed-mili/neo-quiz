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
import type { AncreTerminal } from "../../../src/host/types";
/* LA MOITIÉ PURE DE LA LIGNE DE COMMANDE est partagée avec l'hôte Obsidian
   (`src/host/cli-args.ts`) : citer un argument pour `cmd.exe` et lister les
   extensions du `PATH` sont les mêmes règles des deux côtés, et la citation a
   été durcie après une injection prouvée. Une seconde copie ici aurait donné
   deux règles pour un même appel du code partagé. */
import { extensionsExecutables, ligneCmd, porteSautDeLigne } from "../../../src/host/cli-args";
import { LOG_PREFIX } from "../../../src/branding";
/* LA COMMANDE D'INSTALLATION, source unique partagée avec le modal qui
   l'affiche (voir son en-tête). Pure : aucun Node, donc lisible des deux côtés. */
import { commandeInstallationLancee } from "../../../src/cli-install-cmd";

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, extname, join } from "node:path";

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
   outil ; la fenêtre montre l'installateur travailler puis la connexion, et
   se ferme seule quand tout a réussi ; elle reste ouverte sur un message
   rouge quand quelque chose a échoué.

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

/** Une chaîne littérale PowerShell entre apostrophes (la seule forme qui
    n'interpole rien) : l'apostrophe se double. */
function citerPs(texte: string): string {
	return "'" + texte.replace(/'/g, "''") + "'";
}

/** Les trois textes que la fenêtre peut afficher, traduits par `canaux.ts`
    sur la langue de l'application. `echecInstallation` n'a de sens que pour
    `scriptInstallation` ; `scriptConnexion` l'ignore. */
export interface MessagesTerminal {
	succes: string;
	echec: string;
	echecInstallation?: string;
}

/**
 * La ligne qui recharge `$env:Path` : le registre (utilisateur puis machine),
 * PUIS les dossiers de `dossiersCli` — les mêmes que ceux avec lesquels
 * l'application a détecté l'outil. Sans la seconde moitié, un CLI que l'app
 * voit peut rester invisible de la fenêtre (voir `dossiersCli`).
 */
function rechargerPath(env: NodeJS.ProcessEnv): string {
	const dossiers = dossiersCli(env).map(citerPs).join(",");
	return "$env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + (@(" + dossiers + ") -join ';')";
}

/** La commande qui connecte le compte d'un CLI, ou `null` pour Ollama, qui n'a
    pas de compte à connecter par un terminal (son compte passe par le
    navigateur : `/api/me` rend l'adresse, voir `ai-providers.ts`). */
function commandeConnexion(tool: Outil): string | null {
	/* `claude auth login` et non le REPL `claude` : la sous-commande rend un
	   CODE DE SORTIE, le REPL non — et c'est sur ce code que la fenêtre décide
	   d'afficher le succès ou l'échec. Jusqu'au 2026-09-19 l'installation
	   enchaînait sur le REPL et affichait « connecté » quoi qu'il arrive. */
	if (tool === "claude") return "claude auth login";
	if (tool === "codex") return "codex login";
	/* ANTIGRAVITY N'A PAS DE SOUS-COMMANDE DE CONNEXION (« Launch the CLI
	   without arguments to sign in », dit-il), et son interface interactive
	   ne rend aucun code de sortie utile. Mais son mode headless sait se
	   connecter : sans identifiant en cache, `agy -p` ÉCRIT l'URL de
	   connexion Google sur stderr et attend soixante secondes (mesuré le
	   2026-09-20, `agy` 1.2.7) — sans ouvrir le navigateur lui-même, ni dans
	   une fenêtre de console, ni ailleurs. C'est donc le SCRIPT qui l'ouvre :
	   il lit la sortie ligne à ligne et lance la première adresse
	   `accounts.google.com` qu'il voit. L'utilisateur autorise dans le
	   navigateur, le CLI reçoit le jeton, répond, et son code de sortie est
	   celui que la fenêtre juge — le même appel est le contrôle. Aucune
	   question, aucun REPL, rien à taper : éprouvé de bout en bout le jour
	   même (22 secondes, `status: SUCCESS`). Les identifiants vont au
	   gestionnaire d'identifiants Windows.

	   `Set-Location` d'abord : la fenêtre hérite du dossier courant de
	   l'application, et le CLI y chercherait un projet à charger. Chaque
	   ligne est convertie en TEXTE avant d'être affichée : relue par `2>&1`,
	   une ligne de stderr est un `ErrorRecord`, que PowerShell décorerait
	   sinon d'un « NativeCommandError » rouge. La réponse JSON, elle, n'est
	   pas affichée. */
	if (tool === "agy") return AGY_CONNEXION.join("\n");
	return null;
}

/** Les lignes de la connexion d'Antigravity, séparées pour être lisibles (et
    pour que `check:electron-process` puisse les nommer). */
const AGY_CONNEXION = [
	"Set-Location $env:USERPROFILE",
	/* `Continue` REMIS EXPRÈS : `install.ps1` de Google commence par
	   `$ErrorActionPreference = "Stop"`, et `iex` l'applique à NOTRE session.
	   Sous `Stop`, la première ligne de stderr relue par `2>&1` — celle qui
	   annonce l'URL de connexion — devient une erreur TERMINANTE : la
	   pipeline s'arrêtait avant de lire l'URL, la page Google ne s'ouvrait
	   jamais (vécu le 2026-09-20 ; la sonde de la veille avait été éprouvée
	   seule, sans installation avant). */
	"$ErrorActionPreference = 'Continue'",
	"$script:urlOuverte = $false",
	"agy -p \"ok\" --output-format json 2>&1 | ForEach-Object {",
	"  $l = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { \"$_\" }",
	"  if (-not $script:urlOuverte -and $l -match 'https://accounts\\.google\\.com/\\S+') { $script:urlOuverte = $true; Start-Process $Matches[0] }",
	"  if ($l -and -not $l.StartsWith('{')) { Write-Host $l }",
	"}",
];

/**
 * La fin commune des deux scripts : le succès n'est affiché que si la
 * connexion a rendu 0, et la fenêtre se ferme alors seule (plus de `-NoExit`
 * dans `argumentsTerminal` : le script décide). Un échec affiche son message
 * en rouge et RETIENT la fenêtre jusqu'à Entrée — c'est le seul moment où
 * l'utilisateur a quelque chose à lire.
 */
/** UN COMPTE À REBOURS VISIBLE avant que la fenêtre se ferme, et non plus deux
    secondes de silence (Ahmed, 2026-09-20 : « un compte à rebours de 3 sec
    avant que le terminal se ferme, pour toutes les installations »). Une
    fenêtre qui disparaît sans prévenir se lit comme un plantage, même quand
    elle vient d'annoncer un succès. Des CHIFFRES seuls : rien à traduire, donc
    rien qui puisse manquer dans une langue. `retrait` est l'indentation du
    bloc appelant, pour que le script reste lisible dans la transcription. */
function compteARebours(retrait: string): string[] {
	return [
		retrait + "for ($i = 3; $i -gt 0; $i--) {",
		retrait + "  Write-Host (\"  \" + $i + \"...\") -ForegroundColor DarkGray",
		retrait + "  Start-Sleep -Seconds 1",
		retrait + "}",
	];
}

function issue(messages: MessagesTerminal): string[] {
	return [
		"if ($LASTEXITCODE -eq 0) {",
		"  Write-Host " + citerPs(messages.succes) + " -ForegroundColor Green",
		...compteARebours("  "),
		"} else {",
		"  Write-Host " + citerPs(messages.echec) + " -ForegroundColor Red",
		/* Le tampon d'entrée est VIDÉ avant d'attendre Entrée : une touche
		   tapée pendant l'installation, restée dans le tampon, fermerait sinon
		   la fenêtre sur le message d'échec avant qu'on ait pu le lire. */
		"  $host.UI.RawUI.FlushInputBuffer()",
		"  Read-Host | Out-Null",
		"}",
	];
}

/** LA PREMIÈRE LIGNE DE TOUT SCRIPT DE TERMINAL, et ce qu'elle achète : une
    fenêtre qui disparaît sans rien laisser est indiagnosticable. `trap` retient
    la fenêtre sur TOUTE erreur d'exécution au lieu de la laisser se fermer, et
    la transcription garde une trace sur le disque même quand la fenêtre est
    partie — le seul cas où le `trap` lui-même ne sert à rien (une erreur
    d'ANALYSE tue le script avant sa première ligne).

    Le fichier est écrasé à chaque lancement : c'est un dernier essai, pas un
    journal. Il vit dans le dossier temporaire de l'utilisateur, celui que
    `$env:TEMP` nomme. */
const TRANSCRIPTION = "$env:TEMP\\neo-quiz-installation.txt";

function entete(titre: string): string[] {
	return [
		"$host.UI.RawUI.WindowTitle = " + citerPs(titre),
		"try { Start-Transcript -Path \"" + TRANSCRIPTION + "\" -Force | Out-Null } catch { }",
		"trap {",
		"  Write-Host $_ -ForegroundColor Red",
		"  Read-Host | Out-Null",
		"  exit 1",
		"}",
	];
}

/**
 * Le script PowerShell complet qui installe `tool` puis y connecte le
 * compte. PURE. `titre` en est la PREMIÈRE ligne (`$host.UI.RawUI.
 * WindowTitle`) : c'est la seule façon de le porter jusqu'à la fenêtre une
 * fois que `argumentsTerminal` ne le cite plus sur la ligne de commande.
 *
 * LA LIGNE D'INSTALLATION EST CELLE QUE LE MODAL AFFICHE
 * (`src/cli-install-cmd.ts`, partagé), aux deux écarts près que ce module
 * documente et que `npm run check:electron-process` fige. Un installateur qui
 * rend un code non nul arrête le script sur son message : on n'enchaîne pas
 * la connexion d'un outil qui n'est pas là.
 */
export function scriptInstallation(tool: Outil, titre: string, messages: MessagesTerminal, env: NodeJS.ProcessEnv = process.env): string {
	const lignes: string[] = [
		...entete(titre),
		/* `install.ps1` de Codex finit par « Start Codex now? [y/N] » et
		   attendait qu'on tape n puis Entrée (vu dans la VM le 2026-09-19),
		   alors que la connexion suit juste après. `CODEX_NON_INTERACTIVE`
		   est la variable que ce script lit pour répondre « non » à toutes
		   ses questions (`Prompt-YesNo`, lu dans install.ps1 le 2026-09-19).
		   Posée dans la SESSION, elle est héritée par le sous-processus
		   PowerShell qui exécute l'installateur. */
		...(tool === "codex" ? ["$env:CODEX_NON_INTERACTIVE = '1'"] : []),
		commandeInstallationLancee(tool, true),
		"if ($LASTEXITCODE -ne 0) {",
		"  Write-Host " + citerPs(messages.echecInstallation || messages.echec) + " -ForegroundColor Red",
		"  Read-Host | Out-Null",
		"  exit 1",
		"}",
	];
	const connexion = commandeConnexion(tool);
	if (connexion === null) {
		/* Ollama : pas de compte par terminal, c'est son application qui
		   démarre. Le message, le compte à rebours, et la fenêtre se ferme. */
		lignes.push("Write-Host " + citerPs(messages.succes) + " -ForegroundColor Green", ...compteARebours(""));
		return lignes.join("\n");
	}
	lignes.push(rechargerPath(env), connexion, ...issue(messages));
	return lignes.join("\n");
}

/**
 * Le script PowerShell qui CONNECTE le compte d'un outil déjà installé.
 * PURE, jumelle de `scriptInstallation` — et volontairement plus courte :
 * rien n'est téléchargé, rien n'est exécuté depuis le réseau, on lance un
 * exécutable qui est déjà là.
 *
 * `null` pour Ollama, qui n'a pas de compte par terminal : l'appelant en fait
 * « indisponible » plutôt qu'une fenêtre ouverte sur rien.
 *
 * LE PATH EST QUAND MÊME RECHARGÉ, alors qu'on n'installe rien : la fenêtre
 * hérite du `PATH` du processus Electron, figé à SON démarrage. Un CLI
 * installé pendant la session de l'application n'y figure pas.
 */
export function scriptConnexion(tool: Outil, titre: string, messages: MessagesTerminal, env: NodeJS.ProcessEnv = process.env): string | null {
	const connexion = commandeConnexion(tool);
	if (connexion === null) return null;
	return [
		...entete(titre),
		rechargerPath(env),
		connexion,
		...issue(messages),
	].join("\n");
}

/**
 * DISPOSE LES FENÊTRES POUR UNE GÉNÉRATION PAR UN SITE (Ahmed, 2026-09-19) :
 * le NAVIGATEUR occupe la moitié gauche de l'écran où vit Neo Quiz, Neo
 * Quiz la moitié droite. Deux fenêtres qu'on voit ensemble : glisser le
 * fichier depuis Neo Quiz, envoyer, copier. (Un Explorateur ouvert sur le
 * fichier a été essayé et abandonné le même jour : il se dessinait à son
 * ancienne place avant qu'on puisse le poser.)
 *
 * LE NAVIGATEUR EST POSÉ À L'INSTANT OÙ IL NAÎT : le script COMPILE d'abord
 * ses appels `user32` (le seul temps long, ~1 s), pose Neo Quiz, puis écrit
 * « pret » — et c'est SEULEMENT alors que le principal rend la main au rendu,
 * qui ouvre le site. La fenêtre du navigateur est guettée toutes les 10 ms
 * et posée dès sa première image. Un navigateur déjà ouvert existe déjà : on
 * le déplace.
 *
 * PAR PowerShell ET `user32` : Electron ne rend pas la fenêtre du navigateur.
 * Le navigateur par défaut se lit dans le registre (`UrlAssociations\https\
 * UserChoice` → `ProgId` → sa commande), et SA fenêtre est celle qui est au
 * premier plan et appartient à ce processus (jusqu'à huit secondes ; repli :
 * sa fenêtre principale). Ça vaut pour tout navigateur qui ouvre une fenêtre
 * Windows ordinaire — Chrome, Edge, Firefox, Brave. Une fenêtre Windows 11
 * porte un cadre INVISIBLE de ~7 px : `Poser` mesure l'écart avec le cadre
 * visible (DWM) et l'absorbe, sinon les fenêtres laissent un vide entre
 * elles. Best effort ; `$idProc` et non `$pid`, variable réservée.
 */
export function scriptDisposerPourSite(hwndNeo: number): string {
	return [
		"$hwndNeo = " + String(Math.floor(hwndNeo)),
		"$progId = (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice').ProgId",
		"$cmd = (Get-ItemProperty ('Registry::HKEY_CLASSES_ROOT\\' + $progId + '\\shell\\open\\command')).'(default)'",
		"$exe = if ($cmd -match '^\"([^\"]+)\"') { $Matches[1] } else { ($cmd -split ' ')[0] }",
		"$nomExe = [System.IO.Path]::GetFileNameWithoutExtension($exe)",
		"Add-Type -Name Win -Namespace NQ -MemberDefinition @'",
		"[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
		"[DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);",
		"[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int cmd);",
		"[DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);",
		"[DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr h, out RECT r);",
		"[DllImport(\"dwmapi.dll\")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int cb);",
		"[DllImport(\"user32.dll\")] public static extern bool GetWindowPlacement(IntPtr h, ref WP p);",
		"public struct RECT { public int L, T, R, B; }",
		"public struct WP { public int Length, Flags, ShowCmd, MinX, MinY, MaxX, MaxY, L, T, R, B; }",
		"'@",
		"Add-Type -AssemblyName System.Windows.Forms",
		"function Poser($h, $x, $y, $cx, $cy) {",
		"  [NQ.Win]::ShowWindow($h, 9) | Out-Null",
		"  [NQ.Win]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $cx, $cy, 0x0050) | Out-Null",
		"  $r = New-Object NQ.Win+RECT; $f = New-Object NQ.Win+RECT",
		"  [NQ.Win]::GetWindowRect($h, [ref]$r) | Out-Null",
		"  if ([NQ.Win]::DwmGetWindowAttribute($h, 9, [ref]$f, 16) -eq 0) {",
		"    $dl = $f.L - $r.L; $dt = $f.T - $r.T; $dr = $r.R - $f.R; $db = $r.B - $f.B",
		"    [NQ.Win]::SetWindowPos($h, [IntPtr]::Zero, $x - $dl, $y - $dt, $cx + $dl + $dr, $cy + $dt + $db, 0x0050) | Out-Null",
		"  }",
		"}",
		"$aire = if ($hwndNeo -ne 0) { [System.Windows.Forms.Screen]::FromHandle([IntPtr]$hwndNeo).WorkingArea } else { [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea }",
		"$moitie = [int]($aire.Width / 2)",
		"if ($hwndNeo -ne 0) { Poser ([IntPtr]$hwndNeo) ($aire.Left + $moitie) $aire.Top ($aire.Width - $moitie) $aire.Height }",
		"[Console]::Out.WriteLine('pret'); [Console]::Out.Flush()",
		"$hNav = [IntPtr]::Zero",
		"for ($i = 0; $i -lt 800; $i++) {",
		"  $h = [NQ.Win]::GetForegroundWindow(); $idProc = 0; [NQ.Win]::GetWindowThreadProcessId($h, [ref]$idProc) | Out-Null",
		"  $proc = Get-Process -Id $idProc -ErrorAction SilentlyContinue",
		"  if ($proc -and $proc.ProcessName -ieq $nomExe) { $hNav = $h; break }",
		"  Start-Sleep -Milliseconds 10",
		"}",
		"if ($hNav -eq [IntPtr]::Zero) {",
		"  $proc = Get-Process -Name $nomExe -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
		"  if ($proc) { $hNav = $proc.MainWindowHandle }",
		"}",
		/* L'EMPLACEMENT D'AVANT du navigateur, écrit sur la sortie AVANT de le
		   poser : le principal le retient et le lui rend à la fin de l'attente
		   (`restaurerNavigateur`) — agrandi ou non, et son rectangle normal. */
		"if ($hNav -ne [IntPtr]::Zero) {",
		"  $p = New-Object NQ.Win+WP; $p.Length = 44",
		"  if ([NQ.Win]::GetWindowPlacement($hNav, [ref]$p)) { [Console]::Out.WriteLine('avant ' + [int64]$hNav + ' ' + $p.ShowCmd + ' ' + $p.L + ' ' + $p.T + ' ' + $p.R + ' ' + $p.B); [Console]::Out.Flush() }",
		"  Poser $hNav $aire.Left $aire.Top $moitie $aire.Height",
		"}",
	].join("\n");
}

/**
 * DISPOSE LES FENÊTRES POUR UN TERMINAL D'INSTALLATION OU DE CONNEXION
 * (Ahmed, 2026-09-20 : « le terminal apparaît au-dessus de l'app et nous
 * empêche de voir l'app »). Même dessin que pour un site : Neo Quiz occupe la
 * moitié droite de son écran (posé par le principal, `setBounds`), le
 * TERMINAL la moitié gauche — et quand le terminal se ferme, Neo Quiz
 * retrouve sa place d'avant.
 *
 * LE TERMINAL EST TROUVÉ PAR SON TITRE, pas par son processus : sous Windows
 * 11 le terminal par défaut est Windows Terminal, et la fenêtre visible est
 * la sienne (`WindowsTerminal.exe`), pas celle de `powershell.exe` — dont
 * `GetConsoleWindow` ne rend qu'une console cachée. Le script d'installation
 * pose son titre en première ligne (`entete`), et la fenêtre qui héberge
 * l'onglet actif porte ce titre (`MainWindowTitle`). Guettée jusqu'à huit
 * secondes, le temps qu'elle apparaisse. Même `Poser` que pour le site,
 * cadre invisible absorbé.
 *
 * PUIS LE SCRIPT ATTEND QUE CETTE FENÊTRE DISPARAISSE (`IsWindow`, toutes les
 * 250 ms) et écrit « fini » : c'est ce que le principal attend pour rendre à
 * Neo Quiz sa place. Le processus lanceur (`lancerTerminal`) meurt tout de
 * suite, et personne d'autre ne sait quand la fenêtre s'en va. Une fenêtre
 * jamais trouvée écrit « absent », et le principal restaure aussitôt.
 */
/** L'ancre telle qu'elle arrive du rendu, RECOMPOSÉE champ par champ (comme
    tout ce qui traverse l'IPC) : quatre nombres finis, positifs, bornés à
    un écran plausible ; sinon `null`, et le terminal prend la place par
    défaut. Un rendu compromis ne peut au pire que déplacer un terminal
    dans la fenêtre de Neo Quiz. */
export function lireAncre(v: unknown): AncreTerminal | null {
	if (!v || typeof v !== "object") return null;
	const o = v as Record<string, unknown>;
	const n = (k: string): number | null => {
		const x = o[k];
		return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 32767 ? x : null;
	};
	const x = n("x"), y = n("y"), largeur = n("largeur"), hauteur = n("hauteur");
	if (x === null || y === null || largeur === null || hauteur === null) return null;
	return { x, y, largeur, hauteur };
}

/** Le rectangle du terminal en DIP, PUR. `contenu` est la zone de contenu de
    la fenêtre (DIP, écran), `zoom` son facteur (les pixels CSS de l'ancre
    en DIP), `ancre` la modale mesurée par le rendu. Sous l'ancre, à 12 DIP,
    même largeur, jusqu'à 24 DIP du bas de la fenêtre et 460 DIP au plus ;
    200 DIP au moins (une modale trop basse repousse plutôt que d'écraser).
    Sans ancre : la moitié basse de la fenêtre, 60 % de sa largeur, centrée. */
export function rectangleTerminal(contenu: { x: number; y: number; width: number; height: number }, zoom: number, ancre: AncreTerminal | null): { x: number; y: number; width: number; height: number } {
	const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1;
	const bas = contenu.y + contenu.height - 24;
	if (!ancre) {
		const width = Math.floor(contenu.width * 0.6);
		const y = contenu.y + Math.floor(contenu.height / 2);
		return { x: contenu.x + Math.floor((contenu.width - width) / 2), y, width, height: Math.max(200, bas - y) };
	}
	const x = Math.round(contenu.x + ancre.x * z);
	const y = Math.round(contenu.y + (ancre.y + ancre.hauteur) * z) + 12;
	const width = Math.max(320, Math.round(ancre.largeur * z));
	const height = Math.max(200, Math.min(460, bas - y));
	return { x, y, width, height };
}

export function scriptDisposerPourTerminal(hwndNeo: number, titre: string, rect: AncreTerminal): string {
	return [
		"$hwndNeo = " + String(Math.floor(hwndNeo)),
		"$titre = " + citerPs(titre),
		"Add-Type -Name Win -Namespace NQT -MemberDefinition @'",
		"[DllImport(\"user32.dll\")] public static extern bool IsWindow(IntPtr h);",
		"[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int cmd);",
		"[DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);",
		"[DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr h, out RECT r);",
		"[DllImport(\"dwmapi.dll\")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int cb);",
		"public struct RECT { public int L, T, R, B; }",
		"'@",
		"Add-Type -AssemblyName System.Windows.Forms",
		"function Poser($h, $x, $y, $cx, $cy) {",
		"  [NQT.Win]::ShowWindow($h, 9) | Out-Null",
		"  [NQT.Win]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $cx, $cy, 0x0050) | Out-Null",
		"  $r = New-Object NQT.Win+RECT; $f = New-Object NQT.Win+RECT",
		"  [NQT.Win]::GetWindowRect($h, [ref]$r) | Out-Null",
		"  if ([NQT.Win]::DwmGetWindowAttribute($h, 9, [ref]$f, 16) -eq 0) {",
		"    $dl = $f.L - $r.L; $dt = $f.T - $r.T; $dr = $r.R - $f.R; $db = $r.B - $f.B",
		"    [NQT.Win]::SetWindowPos($h, [IntPtr]::Zero, $x - $dl, $y - $dt, $cx + $dl + $dr, $cy + $dt + $db, 0x0050) | Out-Null",
		"  }",
		"}",
		/* PAR `Get-Process` ET NON `FindWindow` : depuis PowerShell, un `$null`
		   passé pour la classe arrive en chaîne VIDE, et `FindWindow('', titre)`
		   ne trouve rien (mesuré le 2026-09-20 sur une fenêtre pourtant listée
		   par `Get-Process` sous ce titre). `MainWindowTitle` vaut pour Windows
		   Terminal comme pour une console classique. Toutes les 100 ms, huit
		   secondes au plus. */
		"$hTerm = [IntPtr]::Zero",
		"for ($i = 0; $i -lt 80; $i++) {",
		"  $p = Get-Process | Where-Object { $_.MainWindowTitle -eq $titre } | Select-Object -First 1",
		"  if ($p) { $hTerm = [IntPtr]$p.MainWindowHandle; break }",
		"  Start-Sleep -Milliseconds 100",
		"}",
		"if ($hTerm -eq [IntPtr]::Zero) { [Console]::Out.WriteLine('absent'); [Console]::Out.Flush(); exit 0 }",
		"Poser $hTerm " + [rect.x, rect.y, rect.largeur, rect.hauteur].map(v => String(Math.floor(v))).join(" "),
		"[Console]::Out.WriteLine('pose'); [Console]::Out.Flush()",
		"while ([NQT.Win]::IsWindow($hTerm)) { Start-Sleep -Milliseconds 250 }",
		"[Console]::Out.WriteLine('fini'); [Console]::Out.Flush()",
	].join("\n");
}

/**
 * Lance la disposition pour un terminal et appelle `surFin` quand la fenêtre
 * du terminal a disparu — ou tout de suite si elle n'est jamais apparue. Ne
 * bloque pas : le terminal peut rester ouvert des minutes (une connexion
 * dans le navigateur), et l'appelant n'a rien à attendre. Best effort, comme
 * `disposerPourSite` : hors Windows, ou si PowerShell manque, `surFin` est
 * appelé aussitôt et Neo Quiz garde sa place.
 */
export function disposerPourTerminal(hwndNeo: number, titre: string, rect: AncreTerminal, surFin: () => void): void {
	if (process.platform !== "win32") { surFin(); return; }
	let rendu = false;
	const fin = (): void => { if (!rendu) { rendu = true; surFin(); } };
	try {
		const enfant = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoderCommande(scriptDisposerPourTerminal(hwndNeo, titre, rect))], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
		enfant.stdout.on("data", (d: Buffer) => {
			const texte = d.toString("utf8");
			if (texte.includes("fini") || texte.includes("absent")) fin();
		});
		enfant.on("error", e => { console.warn(LOG_PREFIX, "disposition du terminal impossible:", e); fin(); });
		enfant.on("exit", fin);
		enfant.unref();
	} catch (e) {
		console.warn(LOG_PREFIX, "disposition du terminal impossible:", e);
		fin();
	}
}

/** L'emplacement d'un navigateur avant qu'on le pose (`WINDOWPLACEMENT`). */
export interface PlacementFenetre {
	hwnd: number;
	/** `SW_SHOWMAXIMIZED` (3) si elle était agrandie, sinon `SW_SHOWNORMAL` (1). */
	showCmd: number;
	l: number; t: number; r: number; b: number;
}

/** Lit une ligne « avant <hwnd> <showCmd> <l> <t> <r> <b> » du script de
    disposition ; `null` pour tout le reste. Une fenêtre réduite (2) est
    rendue normale : on l'avait restaurée pour la poser. */
export function lirePlacement(ligne: string): PlacementFenetre | null {
	const m = ligne.trim().match(/^avant (\d+) (\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+)$/);
	if (!m) return null;
	const showCmd = Number(m[2]);
	return { hwnd: Number(m[1]), showCmd: showCmd === 3 ? 3 : 1, l: Number(m[3]), t: Number(m[4]), r: Number(m[5]), b: Number(m[6]) };
}

/** Rend au navigateur son emplacement d'avant, s'il existe encore
    (`IsWindow`). `SetWindowPlacement` remet d'un coup l'état (agrandie ou
    non) ET le rectangle normal ; `SetWindowPos` seul aurait laissé une
    fenêtre agrandie « normale » aux dimensions de l'écran. */
export function scriptRestaurerNavigateur(p: PlacementFenetre): string {
	return [
		"Add-Type -Name Win -Namespace NQ -MemberDefinition @'",
		"[DllImport(\"user32.dll\")] public static extern bool IsWindow(IntPtr h);",
		"[DllImport(\"user32.dll\")] public static extern bool SetWindowPlacement(IntPtr h, ref WP p);",
		"public struct WP { public int Length, Flags, ShowCmd, MinX, MinY, MaxX, MaxY, L, T, R, B; }",
		"'@",
		"$h = [IntPtr]" + String(Math.floor(p.hwnd)),
		"if ([NQ.Win]::IsWindow($h)) {",
		"  $p = New-Object NQ.Win+WP; $p.Length = 44; $p.ShowCmd = " + String(p.showCmd) + "; $p.MinX = -1; $p.MinY = -1; $p.MaxX = -1; $p.MaxY = -1",
		"  $p.L = " + String(p.l) + "; $p.T = " + String(p.t) + "; $p.R = " + String(p.r) + "; $p.B = " + String(p.b),
		"  [NQ.Win]::SetWindowPlacement($h, [ref]$p) | Out-Null",
		"}",
	].join("\n");
}

/* Le placement du navigateur de la DERNIÈRE disposition, à lui rendre à la
   fin (Ahmed, 2026-09-19 : « il faut que la fenêtre du navigateur se remette
   comme elle l'était avant qu'on la déplace »). */
let placementNavigateur: PlacementFenetre | null = null;

/** NE REND LA MAIN QU'UNE FOIS LE NAVIGATEUR REMIS (trois secondes au plus) :
    une fenêtre rendue agrandie prend le premier plan, et Neo Quiz doit le
    reprendre APRÈS, pas avant (Ahmed, 2026-09-19 : « ensuite, Neo Quiz au
    premier plan avec le focus »). */
export function restaurerNavigateur(): Promise<void> {
	const p = placementNavigateur;
	placementNavigateur = null;
	if (!p || process.platform !== "win32") return Promise.resolve();
	return new Promise(resolve => {
		let rendu = false;
		const fin = (): void => { if (!rendu) { rendu = true; resolve(); } };
		try {
			const enfant = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoderCommande(scriptRestaurerNavigateur(p))], { stdio: "ignore", windowsHide: true });
			enfant.on("error", e => { console.warn(LOG_PREFIX, "restauration du navigateur impossible:", e); fin(); });
			enfant.on("exit", fin);
		} catch (e) {
			console.warn(LOG_PREFIX, "restauration du navigateur impossible:", e);
			fin();
		}
		setTimeout(fin, 3000);
	});
}

/**
 * Lance la disposition et NE REND LA MAIN QU'AU SIGNAL « pret » du script
 * (trois secondes au plus) : c'est ce qui permet au rendu d'ouvrir le site
 * APRÈS que le guet de la fenêtre a commencé. Sans terminal, sans fenêtre.
 */
export function disposerPourSite(hwndNeo: number): Promise<void> {
	if (process.platform !== "win32") return Promise.resolve();
	return new Promise(resolve => {
		let rendu = false;
		const fin = (): void => { if (!rendu) { rendu = true; resolve(); } };
		try {
			placementNavigateur = null;
			const enfant = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoderCommande(scriptDisposerPourSite(hwndNeo))], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
			enfant.stdout.on("data", (d: Buffer) => {
				const texte = d.toString("utf8");
				if (texte.includes("pret")) fin();
				/* La ligne « avant … » arrive APRÈS « pret », quand le navigateur
				   est apparu : la sortie reste écoutée jusqu'à la fin du script. */
				for (const ligne of texte.split(/\r?\n/)) { const p = lirePlacement(ligne); if (p) placementNavigateur = p; }
			});
			enfant.on("error", e => { console.warn(LOG_PREFIX, "disposition des fenêtres impossible:", e); fin(); });
			enfant.on("exit", fin);
			enfant.unref();
		} catch (e) {
			console.warn(LOG_PREFIX, "disposition des fenêtres impossible:", e);
			fin();
		}
		setTimeout(fin, 3000);
	});
}

/**
 * L'ICÔNE DE TYPE DE FICHIER DE WINDOWS, telle que l'Explorateur la montre
 * sous le curseur quand on glisse un fichier (Ahmed, 2026-09-19 : « que ce
 * soit pareil, avec l'icône que Windows a mise par défaut »). 256 px, fond
 * TRANSPARENT, écrite en PNG dans `sortie`.
 *
 * `app.getFileIcon` d'Electron plafonne à 48 px, et l'Explorateur, lui,
 * glisse la grande icône du shell. On demande donc au shell lui-même, par
 * `IShellItemImageFactory::GetImage` avec SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK
 * (0x04 | 0x01 — PAS 0x80, qui est SIIGBF_ICONBACKGROUND et pose le fond bleu
 * de la sélection). Le HBITMAP rendu est une section DIB 32 bits
 * PRÉMULTIPLIÉE et de bas en haut : `Bitmap.FromHbitmap` en perd l'alpha,
 * d'où la lecture des bits par `GetObject` et le retournement vertical.
 * ~300 ms, à faire AVANT le glisser (le `dragstart` n'attend pas) — voir
 * `iconeDeType`, qui met en cache par extension.
 */
export function scriptIconeDeType(fichier: string, sortie: string): string {
	return [
		"$fichier = " + citerPs(fichier),
		"$sortie = " + citerPs(sortie),
		"Add-Type -AssemblyName System.Drawing",
		"Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'",
		"using System; using System.Runtime.InteropServices; using System.Drawing; using System.Drawing.Imaging;",
		"public static class NQIcone {",
		"  [ComImport, Guid(\"bcc18b79-ba16-442f-80c4-8a59c30c463b\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]",
		"  interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }",
		"  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx; public int cy; public SIZE(int x, int y) { cx = x; cy = y; } }",
		"  [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public ushort bmPlanes, bmBitsPixel; public IntPtr bmBits; }",
		"  [DllImport(\"shell32.dll\", CharSet = CharSet.Unicode, PreserveSig = false)] static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, out IShellItemImageFactory ppv);",
		"  [DllImport(\"gdi32.dll\")] static extern bool DeleteObject(IntPtr h);",
		"  [DllImport(\"gdi32.dll\")] static extern int GetObject(IntPtr h, int c, out BITMAP b);",
		"  public static void Sauver(string chemin, string sortie, int taille) {",
		"    Guid g = new Guid(\"bcc18b79-ba16-442f-80c4-8a59c30c463b\"); IShellItemImageFactory f; SHCreateItemFromParsingName(chemin, IntPtr.Zero, ref g, out f);",
		"    IntPtr hbm; int hr = f.GetImage(new SIZE(taille, taille), 0x04 | 0x01, out hbm); if (hr != 0) throw new Exception(\"GetImage \" + hr);",
		"    BITMAP bm; GetObject(hbm, Marshal.SizeOf(typeof(BITMAP)), out bm);",
		"    using (Bitmap c = new Bitmap(bm.bmWidth, bm.bmHeight, bm.bmWidthBytes, PixelFormat.Format32bppPArgb, bm.bmBits)) { c.RotateFlip(RotateFlipType.RotateNoneFlipY); using (Bitmap d = new Bitmap(c)) { d.Save(sortie, ImageFormat.Png); } }",
		"    DeleteObject(hbm);",
		"  }",
		"}",
		"'@",
		"[NQIcone]::Sauver($fichier, $sortie, 256)",
	].join("\n");
}

const iconesEnCours = new Map<string, Promise<string | null>>();

/**
 * Le PNG de l'icône de type d'un fichier, mis en cache PAR EXTENSION dans le
 * dossier temporaire de l'application (une icône de type ne dépend que de
 * l'extension et du gestionnaire associé). `null` si le shell n'a rien rendu.
 * Les demandes simultanées d'une même extension partagent la même promesse.
 */
export function iconeDeType(fichier: string, dossierTemp: string): Promise<string | null> {
	if (process.platform !== "win32") return Promise.resolve(null);
	const ext = extname(fichier).toLowerCase().replace(/[^a-z0-9.]/g, "") || ".sans";
	const sortie = join(dossierTemp, "neo-quiz", "icone-" + ext.slice(1) + ".png");
	if (existsSync(sortie)) return Promise.resolve(sortie);
	const enCours = iconesEnCours.get(ext);
	if (enCours) return enCours;
	const promesse = new Promise<string | null>(resolve => {
		try {
			mkdirSync(dirname(sortie), { recursive: true });
			const enfant = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoderCommande(scriptIconeDeType(fichier, sortie))], { stdio: "ignore", windowsHide: true });
			enfant.on("error", () => resolve(null));
			enfant.on("exit", () => resolve(existsSync(sortie) ? sortie : null));
			setTimeout(() => resolve(existsSync(sortie) ? sortie : null), 5000);
		} catch {
			resolve(null);
		}
	}).finally(() => { iconesEnCours.delete(ext); });
	iconesEnCours.set(ext, promesse);
	return promesse;
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
	   donc aucune apostrophe ne peut refermer la liste d'arguments. SANS
	   `-NoExit` : jusqu'au 2026-09-19 la fenêtre restait toujours ouverte,
	   « installé » ou pas — c'est maintenant le script lui-même qui décide de
	   se fermer (succès) ou de rester (échec, `Read-Host` dans `issue`). */
	return ["-NoProfile", "-Command",
		`Start-Process powershell.exe -ArgumentList '-ExecutionPolicy','Bypass','-EncodedCommand','${encoderCommande(script)}'`];
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
export const OUTILS = ["claude", "codex", "ollama", "agy"] as const;

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
 *
 * C'est la sonde automatique ; le réglage « chemin de l'exécutable » est le
 * dernier recours, pour la machine dont l'installation n'est à aucun de ces
 * endroits.
 */

/**
 * LES DOSSIERS OÙ LES CLI S'INSTALLENT — une seule liste, PURE.
 *
 * Elle sert deux fois, et c'est tout l'intérêt : `environnementEnfant` l'ajoute
 * au PATH avec lequel l'application SONDE et LANCE les CLI, et les scripts du
 * terminal (`scriptInstallation`, `scriptConnexion`) l'ajoutent au PATH de la
 * fenêtre PowerShell. Jusqu'au 2026-09-19 le terminal ne rechargeait que le
 * PATH du REGISTRE : quand `install.ps1` de Claude n'y écrivait pas
 * `~/.local/bin` (VM d'Ahmed, 2026-09-18), l'application disait « installé »
 * et la fenêtre « terme non reconnu ». Deux lectures du même disque qui
 * divergeaient sans qu'aucun contrôle ne le voie ; maintenant c'est une.
 *
 * `~/.local/bin` : `install.ps1` de Claude Code et `install.sh` de Codex ;
 * `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` : `install.ps1` de Codex ;
 * `%APPDATA%\npm` : les installations npm ; `CODEX_INSTALL_DIR` : l'override
 * que Codex honore ; `Programs\Ollama` : l'installateur Windows d'Ollama (CLI
 * `ollama.exe` au même endroit) ; puis les gestionnaires que les deux CLI
 * empruntent aussi (ajoutés le 2026-09-17, quand les champs « chemin de
 * l'exécutable » des Réglages ont été retirés). Un dossier absent ne coûte
 * rien : la résolution le saute sans erreur.
 */
export function dossiersCli(env: NodeJS.ProcessEnv = process.env): string[] {
	const home = dossierPersonnel(env);
	return [
		join(home, ".local", "bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
		env.APPDATA ? join(env.APPDATA, "npm") : null,
		env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin") : null,
		env.CODEX_INSTALL_DIR || null,
		env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "Ollama") : null,
		/* Antigravity CLI : `install.ps1` pose `agy.exe` ici et l'annonce en
		   toutes lettres (« binary placed successfully at … agy\bin »), sans
		   toucher au PATH de la session courante. `~/.local/bin`, plus haut,
		   est son emplacement sur macOS et Linux. */
		env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "agy", "bin") : null,
		join(home, ".claude", "local"),
		join(home, ".bun", "bin"),
		join(home, ".yarn", "bin"),
		join(home, ".volta", "bin"),
		join(home, "scoop", "shims"),
		env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "pnpm") : null,
	].filter((p): p is string => Boolean(p));
}

export function environnementEnfant(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const courant = env.PATH || "";
	const fusion = courant + delimiter + dossiersCli(env).filter(p => !courant.includes(p)).join(delimiter);
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
