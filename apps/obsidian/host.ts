/* ══════════════════════════════════════════════════════════
   L'HÔTE OBSIDIAN

   L'implémentation du contrat `src/host/types.ts` pour Obsidian. C'est ici, et
   NULLE PART AILLEURS sous `src/`, que le code partagé touche `app.vault`,
   `metadataCache`, `Notice` ou MathJax.

   Ce fichier vit sous `apps/obsidian/` par construction : il est le SEUL
   endroit du dépôt où dépendre d'`obsidian` est le but, pas une dette. C'est
   pourquoi `npm run check:host`, qui balaie `src/`, ne le voit pas.

   PLUS DE DOUBLE : quatre logiques ont MIGRÉ ici et n'existent plus ailleurs —
   la création de dossier des exports (ex-`ensureFolder` de
   `src/engine/results-save.ts`), la révélation dans l'explorateur et
   l'ouverture par l'application par défaut (ex-`revealFileInObsidianExplorer`
   et `openWithDefaultAppFromVault` de `src/engine/resources.ts`), et la
   mémoïsation de `loadMathJax` (ex-`src/engine/mathjax.ts`). Le portage s'est
   fait dans cet ordre — hôte écrit et éprouvé d'abord, appelants basculés
   ensuite, originaux supprimés en dernier — pour que le greffon ne soit à
   aucun moment cassé ; il est terminé.

   Et c'est ici, uniquement, qu'un `TFile` devient un `HostFile` (`toHostFile`
   ci-dessous). Toute autre conversion recopiée à la main est un défaut : elle
   diverge en silence le jour où `HostFile` gagne un champ.
══════════════════════════════════════════════════════════ */

import { Notice, Platform, requestUrl, setIcon, getIconIds, loadMathJax, renderMath, finishRenderMath } from "obsidian";
import type { App, DataAdapter, EventRef, TAbstractFile, TFile, View, WorkspaceLeaf } from "obsidian";
import type { CliTool, Host, HostFile, HostFileEvent, HostModalHandle, HostModalSpec, HostRoot } from "../../src/host/types";
/* La moitié PURE des jetons de pièces jointes, partagée avec le processus
   principal de l'application : aucun `fs`, donc rien qui interdise au rendu de
   l'importer, et surtout UNE seule définition du format des jetons. Deux
   copies avaient divergé en une tranche. */
import { nomDeFichierSur, substituerJetons } from "../../src/host/jetons";
import type { FichierJoint } from "../../src/host/jetons";
import { QbdModal } from "../../src/modal-base";
import { REVIEW_DIR, REVIEW_LOG_NAME } from "../../src/review/paths";

/** Shell Electron minimal (surface réellement consommée : shell.openPath). */
interface ElectronShellLike {
	openPath(path: string): Promise<string>;
}

/** L'API interne d'i18n d'Obsidian : absente d'`obsidian.d.ts`, mais c'est la
    SEULE source de la langue de l'interface (celle d'Obsidian, pas celle de
    l'OS). Même lecture que `detectObsidianLang` dans `src/i18n.ts`. */
interface I18nextLike { language?: string }

/**
 * Le seul endroit du dépôt où un `TFile` devient un `HostFile`.
 *
 * Laisser fuir un `TFile` dans le code partagé obligerait l'hôte Windows à en
 * fabriquer un faux — avec ses méthodes, son `vault` et son `parent` — pour
 * satisfaire un type dont il n'a que faire. Le `HostFile` est plat et
 * sérialisable ; l'ordre des champs suit `src/host/types.ts`.
 */
function toHostFile(f: TFile): HostFile {
	return {
		path: f.path,
		name: f.name,
		basename: f.basename,
		extension: f.extension,
		mtime: f.stat?.mtime ?? 0,
	};
}

/**
 * Discrimine un fichier d'un dossier par la PRÉSENCE d'`extension`, pas par
 * `instanceof TFile`.
 *
 * Un `TFolder` n'a pas d'`extension` : le test est exact au runtime. Et il est
 * ÉPROUVABLE — le bouchon `obsidian` des scripts de vérification ne peut pas
 * fabriquer un vrai `TFile`, donc exiger `instanceof` rendrait `getFile`,
 * `read` et `resolve` intestables, ce qui reviendrait à ne pas les contrôler.
 */
function asTFile(f: TAbstractFile | null | undefined): TFile | null {
	if (!f) return null;
	return typeof (f as TFile).extension === "string" ? (f as TFile) : null;
}

/**
 * La modale du contrat, sous Obsidian.
 *
 * `QbdModal` (`src/modal-base.ts`) porte DÉJÀ l'animation d'entrée et de
 * sortie, et la garde d'idempotence qui va avec : l'hôte s'appuie dessus
 * plutôt que de la refaire, sinon les modales du greffon s'ouvriraient
 * sèchement là où elles glissent aujourd'hui. C'est aussi ce qui garantit que
 * les modales passées par le contrat et celles qui héritent encore de
 * `QbdModal` en direct se comportent exactement pareil.
 *
 * La poignée est construite DÈS le constructeur — `modalEl`, `titleEl` et
 * `contentEl` existent dès celui de `Modal` — pour que `open()` puisse la
 * rendre à l'appelant sans attendre `onOpen()`, qu'Obsidian n'appelle qu'après
 * attachement.
 */
class HoteModal extends QbdModal {
	private readonly spec: HostModalSpec;
	readonly poignee: HostModalHandle;

	constructor(app: App, spec: HostModalSpec) {
		super(app);
		this.spec = spec;
		this.poignee = {
			panelEl: this.modalEl,
			contentEl: this.contentEl,
			close: () => this.close(),
		};
	}

	onOpen(): void {
		if (this.spec.className) this.modalEl.addClass(this.spec.className);
		if (this.spec.title) this.titleEl.setText(this.spec.title);
		this.spec.onOpen(this.poignee);
	}

	/* Obsidian n'appelle `onClose()` que depuis `Modal.close()`, APRÈS avoir
	   détaché le DOM (et `QbdModal.close()` retarde encore ce `super.close()`
	   le temps de l'animation de sortie). C'est ce que le contrat promet, et ce
	   dont `module-edit.ts` dépend : son écriture différée ne doit pas tomber
	   pendant qu'un rendu est encore à l'écran.
	   Le corps est vidé APRÈS `spec.onClose()`, pas avant : l'appelant a le
	   droit d'y relire un champ une dernière fois. */
	onClose(): void {
		this.spec.onClose?.();
		this.contentEl.empty();
	}
}

/* ══════════════════════════════════════════════════════════
   LES CLI ET LEURS FICHIERS — `HostProcess` sous Obsidian

   Tranche 5, tâche 3. Tout ce bloc vient de `src/dashboard/ai-providers.ts`,
   DÉPLACÉ et non réécrit : il y faisait dix `require("fs"|"os"|"path"|
   "child_process")`. Dans le rendu de l'application, `require` n'existe pas —
   chaque sonde y aurait répondu « non installé » en silence, sans qu'aucune
   erreur ne le nomme. Le code partagé ne demande donc plus que le CONTRAT, et
   c'est ici (et dans `apps/windows/electron/process.ts`) que Node est touché.
══════════════════════════════════════════════════════════ */

/** Les CLI que cet hôte accepte de lancer, et rien d'autre. La liste est la
    moitié « nom, jamais un chemin » du contrat (`CliTool`) : elle rend
    impossible la séquence que le périmètre des chemins ne voit pas —
    `fs.write("x.bat")` puis `process.run("x.bat")`. `CliTool` la tient déjà à
    la compilation ; ceci la tient à L'EXÉCUTION, où arrive un jour une valeur
    venue d'un réglage ou d'un quiz partagé. */
const CLI_AUTORISES: readonly CliTool[] = ["claude", "codex", "ollama"];

/** Une erreur dont le `name` est celui que le contrat nomme (`introuvable`,
    `timeout`, `annule`, `refuse`, `indisponible`) : l'appelant décide sur ce
    nom, jamais sur le texte du message, qui n'est pas traduit. */
function erreurCli(nom: string, message: string): Error {
	const e = new Error(message);
	e.name = nom;
	return e;
}

/* ── PATH étendu pour child_process ──
   Obsidian lancé depuis l'UI n'hérite pas toujours du PATH
   complet du shell (npm global, ~/.local/bin, homebrew) — et un
   installateur qui modifie le PATH du REGISTRE (Codex CLI officiel)
   n'atteint jamais un process déjà lancé : sans ces chemins en dur,
   « installé mais pas détecté » tant qu'Obsidian n'est pas redémarré
   (vécu Ahmed 2026-07-12, install.ps1 officiel sur desktop). Chemins
   vérifiés DANS les scripts d'installation d'OpenAI :
   - install.ps1 → %LOCALAPPDATA%\Programs\OpenAI\Codex\bin
   - install.sh  → ~/.local/bin (déjà couvert)
   - npm         → %APPDATA%\npm (déjà couvert)
   - CODEX_INSTALL_DIR : override honoré par les deux scripts.

   L'ENVIRONNEMENT EST UN PARAMÈTRE, même patron que `dossierPersonnel` dans
   `apps/windows/electron/process.ts` et pour la même raison : ce qu'un
   contrôle ne peut pas atteindre n'est pas contrôlé. Le cas « un exécutable
   absent rejette introuvable » vide le PATH et les variables d'installation ;
   sans cette entrée, `~/.local/bin` restait celui de la VRAIE machine (un
   `claude.exe` y vit sur celle d'Ahmed) et le cas rougissait pour une raison
   étrangère à ce qu'il éprouve. */
function buildChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const path = require("path") as typeof import("path");
	const extra: string[] = [
		path.join(dossierPersonnel(env), ".local", "bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
		env.APPDATA ? path.join(env.APPDATA, "npm") : null,
		env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin") : null,
		env.CODEX_INSTALL_DIR || null,
		// Installateur Windows d'Ollama (CLI ollama.exe au même endroit).
		env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs", "Ollama") : null
	].filter((p): p is string => Boolean(p));
	const sep = path.delimiter;
	const current = env.PATH || "";
	const merged = current + sep + extra.filter(p => !current.includes(p)).join(sep);
	return Object.assign({}, env, { PATH: merged, Path: merged });
}

/** Le dossier personnel, de l'environnement DONNÉ sinon du système.
    `os.homedir()` ne suit PAS `HOME`/`USERPROFILE` sous Windows (il lit le
    profil du système) : c'est la seule façon pour un contrôle de fabriquer un
    faux dossier personnel. Jumeau de la fonction du même nom dans
    `apps/windows/electron/process.ts`. */
function dossierPersonnel(env: NodeJS.ProcessEnv = process.env): string {
	const os = require("os") as typeof import("os");
	return env.USERPROFILE || env.HOME || os.homedir();
}

/** L'ARBRE de process, pas seulement le premier : `claude` et `codex` en
    spawnent des enfants, et un `kill` sur le seul parent laisse la génération
    tourner (et le fichier de sortie s'écrire) après un clic sur Stop.
    Recopié de `killTree` d'`ai-client.ts`, que la tâche 4 supprimera. */
function tuerArbre(child: import("child_process").ChildProcess): void {
	try {
		if (process.platform === "win32") {
			(require("child_process") as typeof import("child_process"))
				.exec("taskkill /pid " + child.pid + " /T /F", { windowsHide: true });
		} else {
			child.kill("SIGTERM");
		}
	} catch (e) { /* best effort : le poll de l'appelant constatera */ }
}

/**
 * Le premier fichier du PATH qui porte ce nom, `PATHEXT` compris sous Windows.
 * `null` = aucun, donc « vraiment introuvable ».
 *
 * Ne sert QU'à trancher, après un ENOENT de `spawn` sous Windows, entre « shim
 * `.cmd`, à relancer par `cmd.exe` » et « CLI absent ». La résolution complète
 * (le réglage « chemin » de l'utilisateur d'abord) est celle de la tâche 7,
 * côté application.
 */
function trouverExecutable(nom: string, env: NodeJS.ProcessEnv): string | null {
	const fs = require("fs") as typeof import("fs");
	const path = require("path") as typeof import("path");
	const extensions = process.platform === "win32"
		? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
		: [""];
	for (const dossier of (env.PATH || "").split(path.delimiter).filter(Boolean)) {
		for (const ext of extensions) {
			try {
				const candidat = path.join(dossier, nom + ext);
				if (fs.statSync(candidat).isFile()) return candidat;
			} catch (e) { /* dossier inexistant ou illisible : au suivant */ }
		}
	}
	return null;
}

/**
 * Un argument, cité pour la ligne de commande de `cmd.exe`. Ne sert QU'au repli
 * Windows ci-dessous — le chemin direct (`spawn`) ne traverse aucun shell et
 * n'a rien à citer.
 *
 * LA RÈGLE DE `cmd.exe`, et elle n'a rien de celle d'un shell POSIX : le
 * BACKSLASH N'ÉCHAPPE RIEN. `cmd` ne fait que basculer un état « dans des
 * guillemets / dehors » à chaque `"` qu'il rencontre, et ne traite `&`, `|`,
 * `>`, `(` comme des opérateurs que HORS de cet état. Écrire `\"` — ce que
 * faisait la première version — FERME donc le guillemet : avec l'argument
 * `a" & notepad & "b`, la ligne devenait `codex "a\" & notepad & \"b"`, cmd
 * sortait de l'état cité après `a\`, voyait un `&` nu et lançait `notepad`.
 * Le NOM de l'outil restait borné par `CLI_AUTORISES`, mais ses ARGUMENTS
 * atteignaient un interpréteur — ce que le chemin direct ne fait jamais.
 *
 * La forme correcte est le guillemet DOUBLÉ (`"` → `""`) : ferme et rouvre
 * aussitôt, donc l'état « cité » n'est jamais quitté et aucun métacaractère
 * n'est vu comme un opérateur.
 *
 * TROIS CAS QUI NE SE CITENT PAS :
 * — la chaîne VIDE doit s'écrire `""`, sinon elle n'apparaît pas du tout dans
 *   la ligne et l'enfant reçoit un argument de MOINS (les positions décalent) ;
 * — un retour à la ligne (CR ou LF) est un SÉPARATEUR DE COMMANDES pour `cmd`
 *   qu'aucune citation ne neutralise : il est REFUSÉ, avec un nom, jamais
 *   retiré en silence — un argument amputé produirait un appel faux et muet ;
 * — `%VAR%` reste développé par `cmd` même entre guillemets (verrue connue,
 *   sans échappement fiable). C'est le seul résiduel de ce repli, et l'ancien
 *   `cp.exec` l'avait déjà.
 */
function citerPourCmd(arg: string): string {
	if (/[\r\n]/.test(arg)) {
		throw erreurCli("refuse", "argument refusé : un retour à la ligne est un séparateur de commandes pour cmd.exe");
	}
	if (arg === "") return '""';
	return /[\s"&|<>^()%!,;=]/.test(arg) ? '"' + arg.replace(/"/g, '""') + '"' : arg;
}

/**
 * Lance un CLI, `stdin` écrit EN ENTIER puis fermé, `stdout` et `stderr`
 * accumulés SÉPARÉMENT et rendus à la fin avec le code de sortie.
 *
 * POURQUOI UN REPLI PAR `cmd.exe` SOUS WINDOWS. `spawn("claude")` passe par
 * `CreateProcess`, qui ne sait lancer qu'un `.exe` : une installation npm
 * (`claude.cmd`, `codex.cmd`) donne un ENOENT, donc « non installé » — alors
 * que l'ancien `cp.exec` passait TOUJOURS par `cmd.exe` et la trouvait. Le
 * chemin direct reste le premier (aucun interpréteur entre nous et le CLI) ;
 * le repli n'est tenté qu'après un ENOENT, et seulement sous Windows.
 */
function lancerCli(spec: {
	tool: CliTool;
	args: string[];
	stdin: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}, parCmd = false, envHote: NodeJS.ProcessEnv = process.env): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve, reject) => {
		const cp = require("child_process") as typeof import("child_process");
		const env = buildChildEnv(envHote);
		const options = { env, cwd: dossierPersonnel(envHote), windowsHide: true };
		/* La ligne de `cmd.exe` est composée AVANT le `try` : `citerPourCmd`
		   REJETTE un argument qui porte un retour à la ligne (`name` valant
		   `refuse`), et le faire dans le `try` transformerait ce refus nommé en
		   « introuvable » — le contraire de ce qu'il dit. Un jet ici rejette la
		   promesse avec son propre nom, ce qui est exactement le contrat. */
		const ligneCmd = parCmd ? '"' + [spec.tool, ...spec.args].map(citerPourCmd).join(" ") + '"' : "";
		let child: import("child_process").ChildProcess;
		try {
			child = parCmd
				? cp.spawn(
					envHote.ComSpec || "cmd.exe",
					["/d", "/s", "/c", ligneCmd],
					Object.assign({ windowsVerbatimArguments: true }, options),
				)
				: cp.spawn(spec.tool, spec.args, options);
		} catch (e) {
			reject(erreurCli("introuvable", "CLI introuvable : " + spec.tool));
			return;
		}
		let fini = false;
		let minuteur: ReturnType<typeof setTimeout> | null = null;
		const sortir = (fn: () => void): void => {
			if (fini) return;
			fini = true;
			if (minuteur) clearTimeout(minuteur);
			spec.signal?.removeEventListener("abort", surAbandon);
			fn();
		};
		function surAbandon(): void {
			tuerArbre(child);
			sortir(() => reject(erreurCli("annule", "CLI annulé : " + spec.tool)));
		}
		/* SÉPARÉS, et c'est le contrat : `stderr` porte le diagnostic (« not
		   logged in »), `stdout` la réponse. Les concaténer rendrait la sortie
		   JSON d'un CLI illisible dès qu'il écrit un avertissement. */
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (d: unknown) => { stdout += String(d); });
		child.stderr?.on("data", (d: unknown) => { stderr += String(d); });
		child.on("error", (e: NodeJS.ErrnoException) => {
			/* ENOENT sous Windows : `CreateProcess` ne lance qu'un `.exe`. Si un
			   fichier du PATH porte ce nom avec une extension de `PATHEXT`
			   (`claude.cmd` d'une installation npm), on retente UNE fois par
			   `cmd.exe` ; si RIEN ne porte ce nom, l'exécutable est vraiment
			   absent et le rejet est `introuvable`. Sans cette résolution, le
			   repli lancerait `cmd.exe` pour rien et rendrait son code de sortie
			   (1 ici, 9009 ailleurs, un message localisé dans les deux cas) au
			   lieu du rejet que `checkClaudeCode` attend. */
			if (!parCmd && process.platform === "win32" && e.code === "ENOENT"
				&& trouverExecutable(spec.tool, options.env)) {
				sortir(() => { resolve(lancerCli(spec, true, envHote)); });
				return;
			}
			sortir(() => reject(erreurCli(
				e.code === "ENOENT" ? "introuvable" : e.name || "erreur",
				"CLI " + spec.tool + " : " + e.message,
			)));
		});
		child.on("close", (code: number | null) => sortir(() => resolve({ stdout, stderr, code })));
		if (spec.timeoutMs) {
			minuteur = setTimeout(() => {
				tuerArbre(child);
				sortir(() => reject(erreurCli("timeout", "CLI expiré : " + spec.tool)));
			}, spec.timeoutMs);
		}
		if (spec.signal) {
			if (spec.signal.aborted) { surAbandon(); return; }
			spec.signal.addEventListener("abort", surAbandon, { once: true });
		}
		/* Le prompt COMPLET sur `stdin`, puis fermé : aucun argument à
		   échapper, et le CLI sait que l'entrée est finie. Un `stdin` resté
		   ouvert ferait attendre `claude -p` indéfiniment. */
		try {
			child.stdin?.write(spec.stdin);
			child.stdin?.end();
		} catch (e) { /* le process est déjà mort : `close` ou `error` tranche */ }
	});
}

/* ── LES PIÈCES JOINTES D'UN APPEL, ET LE DOSSIER QUI LES PORTE ──

   POURQUOI L'HÔTE ET PAS L'APPELANT. `callClaude` et `callCodex` écrivaient
   eux-mêmes les images dans un `mkdtempSync`, glissaient les chemins ABSOLUS
   obtenus dans le prompt (« First read these images… - C:\…\image-1.png ») ou
   dans les arguments (`-i "<chemin>"`, `-o "<chemin>"`), puis effaçaient le
   dossier. Le rendu de l'application n'a ni disque ni chemins : il ne peut
   NI écrire ces fichiers, NI apprendre où ils sont. Les jetons renversent la
   charge — le code partagé dit « la première pièce jointe », l'hôte dit où
   elle est.

   LA MOITIÉ PURE (composer un jeton, le substituer, réduire un nom de fichier)
   vit dans `src/host/jetons.ts`, partagée avec le processus principal de
   l'application : elle ne touche ni `fs`, ni `os`, ni `path`, et la dupliquer
   n'avait rien de forcé — les deux copies du premier jet de la tâche 4 avaient
   déjà divergé en une tranche. Ne reste ici que ce qui touche le disque.

   LE DOSSIER EST EFFACÉ EN `finally`, TOUJOURS : un CLI qui échoue, expire ou
   est annulé laissait sinon les images de l'utilisateur dans `%TEMP%`. C'est
   la propriété que le `try/finally` d'`ai-client.ts` tenait, et elle déménage
   ici entière — pas la moitié. */

/**
 * Écrit les pièces jointes, substitue les jetons, exécute, relit `sortieFichier`,
 * efface le dossier. Le dossier n'existe que s'il sert : sans pièce jointe ni
 * fichier de sortie, seul `{{…:home}}` a un sens et rien n'est créé. Sans
 * marqueur, RIEN n'est substitué — c'est le défaut sûr.
 *
 * L'ENVIRONNEMENT EST UN PARAMÈTRE, comme pour `buildChildEnv` et
 * `dossierPersonnel` : le cas qui éprouve `{{…:home}}` doit pouvoir injecter un
 * FAUX dossier personnel, sinon il lit le vrai profil de la machine et le
 * compare à une formule recopiée du code — un contrôle qui n'atteint pas sa
 * propre entrée ne contrôle rien.
 */
async function avecFichiers<T>(
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
	const fs = require("fs") as typeof import("fs");
	const os = require("os") as typeof import("os");
	const path = require("path") as typeof import("path");
	const fichiers = spec.fichiers || [];
	const dossier = (fichiers.length > 0 || spec.sortieFichier)
		? fs.mkdtempSync(path.join(os.tmpdir(), "quiz-blocks-"))
		: "";
	try {
		const chemins = fichiers.map((f, i) => {
			const cible = path.join(dossier, nomDeFichierSur(f.nom, "piece-" + (i + 1)));
			fs.writeFileSync(cible, Buffer.from(f.base64, "base64"));
			return cible;
		});
		const cheminSortie = spec.sortieFichier
			? path.join(dossier, nomDeFichierSur(spec.sortieFichier, "sortie.txt"))
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
			try { sortie = fs.readFileSync(cheminSortie, "utf8"); } catch (e) { sortie = undefined; }
		}
		return { resultat, sortie };
	} finally {
		if (dossier) {
			/* `maxRetries` N'EST PAS DU CONFORT : ce `finally` s'exécute juste
			   après un `taskkill /T /F`, et Windows garde un handle ouvert
			   quelques dizaines de millisecondes après la mort d'un process —
			   `rmSync` rend alors EBUSY/EPERM. Et l'échec est DIT : avalé en
			   silence, le dossier d'images survivait dans `%TEMP%` à chaque
			   annulation, ce que ce `finally` existe précisément pour empêcher. */
			try {
				fs.rmSync(dossier, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
			} catch (e) {
				console.warn("[Quiz] dossier temporaire de CLI non effacé :", dossier, e);
			}
		}
	}
}

/**
 * L'URL désigne-t-elle CETTE machine ? PURE, et jugée sur le NOM D'HÔTE analysé
 * par `URL`, jamais sur une sous-chaîne : `https://localhost.evil.com/` contient
 * « localhost » et n'est pas la boucle locale. Une URL illisible n'est pas
 * locale — le doute va vers `requestUrl`, la voie qui ne suppose rien.
 */
function estBoucleLocale(url: string): boolean {
	let hote: string;
	try {
		hote = new URL(url).hostname.toLowerCase();
	} catch (e) {
		return false;
	}
	// `URL` rend « [::1] » sans crochets sur certains moteurs : les deux formes.
	return hote === "localhost" || hote === "127.0.0.1" || hote === "::1" || hote === "[::1]";
}

/** Le second paramètre est réduit à ce dont l'hôte a besoin — le manifeste,
    pour retrouver l'ANCIEN journal. Typer `Plugin` entier obligerait le jeu
    de cas à en fabriquer un, alors qu'un objet littéral suffit.

    LE TROISIÈME PARAMÈTRE EST LA COUTURE D'ENVIRONNEMENT (ruling 9). Par
    défaut `process.env`, donc rien ne change pour le greffon. Sans elle,
    `buildChildEnv`/`trouverExecutable`/`lancerCli`/`dossierPersonnel` lisaient
    `process.env` en dur : un contrôle qui mute `process.env.PATH` pour poser
    un faux CLI en tête de liste ne l'empêche pas de retomber sur un VRAI CLI
    installé plus loin sur le PATH (Codex officiel dans
    `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`, atteint par le repli
    `cmd.exe`) — le cas répond alors avec la vraie sortie du vrai CLI au lieu
    de celle du faux. Capturé UNE fois ici et transmis à tout ce qui compose
    une ligne de commande ou résout un chemin d'exécutable, pour que le
    contrôle puisse fabriquer un environnement où RIEN d'autre que le faux CLI
    n'est joignable, quel que soit ce que la machine a d'installé. */
export function createObsidianHost(
	app: App,
	plugin: { manifest: { dir?: string } },
	envHote: NodeJS.ProcessEnv = process.env,
): Host {
	const adapter = (): DataAdapter => app.vault.adapter;

	/** Le `TFile` d'un chemin, ou null (dossier, absent). */
	const tfile = (path: string): TFile | null => asTFile(app.vault.getAbstractFileByPath(path));

	/* ─── fs ─── */

	/**
	 * Un chemin qu'Obsidian n'INDEXE PAS : un segment commençant par un point
	 * (« .obsidian/quiz-blocks-results/… », « .neo-quiz/… »). Le vault ignore
	 * ces dossiers de bout en bout — `vault.create` y échoue, et
	 * `getAbstractFileByPath` n'y trouvera jamais rien.
	 *
	 * La FORME du chemin, et pas un test d'existence : `write` doit choisir sa
	 * voie AVANT que le fichier existe, quand il n'y a rien d'autre à regarder.
	 * Même convention que le parcours de l'hôte Windows (`dossierIgnore`).
	 */
	const estCache = (path: string): boolean =>
		path.split("/").some(segment => segment.startsWith("."));

	/** Segment par segment — ni le vault ni l'adaptateur n'ont de création
	    récursive, et créer « a/b/c » d'un coup échoue si « a » manque.
	    (Boucle héritée d'`ensureFolder` de `engine/results-save.ts`.)

	    MÊME PARTAGE QUE `write`, et pour la même raison : `adapter().mkdir`
	    pose le dossier sur le disque sans qu'aucun `TFolder` n'entre à
	    l'index, alors que `vault.createFolder` en rend un. Or les deux appels
	    de `dashboard/folder-create.ts` (import d'un zip, « Nouveau quiz »)
	    enchaînent aussitôt sur un `fs.write` qui, lui, passe désormais par
	    `vault.create` : le parent doit être connu du vault à cet instant
	    précis. (`module-edit.ts` est le dernier à créer un dossier VISIBLE ;
	    il n'écrit rien derrière, mais son dossier n'en mérite pas moins
	    d'exister à l'index. Tous les autres appelants de `mkdirs` — journal
	    de révision, résultats exportés, migration — visent un dossier caché
	    et gardent donc exactement la conduite d'avant.)

	    Le partage se fait sur CHAQUE PRÉFIXE et non sur le chemin entier :
	    pour « Cours/.cache », « Cours » est un vrai dossier du vault et lui
	    seul est caché. Tester le chemin complet ferait échapper le parent à
	    l'index par contagion. */
	async function mkdirs(path: string): Promise<void> {
		const parts = path.split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (estCache(current)) {
				if (!(await adapter().exists(current))) await adapter().mkdir(current);
				continue;
			}
			try {
				await app.vault.createFolder(current);
			} catch (e) {
				/* `createFolder` REJETTE un dossier déjà là, et le contrat promet
				   l'idempotence. On avale sur PREUVE d'existence plutôt que sur le
				   message de l'erreur : ce texte n'est ni documenté ni traduit
				   stablement, et le comparer rendrait le contrôle dépendant d'une
				   chaîne d'Obsidian. Tout autre échec (droits, nom invalide)
				   remonte, comme avant. */
				if (!(await adapter().exists(current))) throw e;
			}
		}
	}

	const fs: Host["fs"] = {
		// `vault.read` quand le chemin est un fichier connu du vault, sinon
		// l'adaptateur : lui seul atteint les fichiers hors index (.obsidian/…),
		// où vivent justement les résultats exportés.
		async read(path) {
			const f = tfile(path);
			return f ? await app.vault.read(f) : await adapter().read(path);
		},
		// `cachedRead` est le chemin du BALAYAGE complet du vault : Obsidian sert
		// son cache au lieu de relire le disque. Ce n'est pas un alias de `read`.
		async readCached(path) {
			const f = tfile(path);
			return f ? await app.vault.cachedRead(f) : await adapter().read(path);
		},
		/* « Créer ou remplacer » — mais en gardant l'INDEX du vault juste.
		   `adapter().write` seul écrit sur le disque sans que le vault en sache
		   rien : la note existe, et `getAbstractFileByPath` la cherche pourtant
		   en vain jusqu'au passage du surveillant. C'est exactement ce qui
		   faisait échouer l'ouverture d'un quiz qu'on venait de créer
		   (`dashboard/folder-create.ts`, bouton « Nouveau quiz »). Le vault, lui,
		   indexe dans l'appel ; l'adaptateur ne reste que pour ce que le vault
		   n'indexe pas. */
		async write(path, data) {
			if (estCache(path)) {
				await adapter().write(path, data);
				return;
			}
			// `create` REJETTE une cible existante : c'est `modify` qui remplace.
			const f = tfile(path);
			if (f) {
				await app.vault.modify(f, data);
				return;
			}
			/* Sur le disque mais pas encore à l'index (écrit à l'instant hors
			   d'Obsidian, ou dossier que le vault n'a pas fini de parcourir) :
			   `vault.create` rejetterait, et `write` promet de REMPLACER, jamais
			   de rejeter parce que la cible est là. */
			if (await adapter().exists(path)) {
				await adapter().write(path, data);
				return;
			}
			await app.vault.create(path, data);
		},
		/* Même PARTAGE que `write`, mais SANS son test `estCache`, et c'est
		   voulu : `vault.process` exige un `TFile`, qu'un chemin caché n'a
		   jamais (« `getAbstractFileByPath` n'y trouvera jamais rien », plus
		   haut) — le test serait donc une branche que rien ne peut atteindre,
		   ni en fonctionnement ni dans un jeu de cas honnête. `write` en a
		   besoin, lui, parce que son dernier recours est `vault.create` ; ici
		   le dernier recours est déjà l'adaptateur.

		   La branche adaptateur DÉGRADE en lecture-écriture — c'est ce que la
		   fenêtre fait de toute façon, et aucun appelant de cette branche ne
		   partage sa note avec un autre écrivain (résultats exportés, journal).
		   `adapter().process` existerait (obsidian.d.ts) mais seulement depuis
		   1.7.2, au-dessus du `minAppVersion` déclaré du greffon (1.5.0) : s'en
		   servir casserait un utilisateur que le manifeste dit soutenir. */
		async process(path, mutate) {
			const f = tfile(path);
			if (f) {
				await app.vault.process(f, mutate);
				return;
			}
			await adapter().write(path, mutate(await adapter().read(path)));
		},
		/* `vault.createBinary` quand la cible est neuve et indexable, exactement
		   comme `write` passe par `vault.create` : une image écrite par le seul
		   adaptateur EXISTE sur le disque sans entrer à l'index, et
		   `getFirstLinkpathDest` ne la retrouve pas — l'aperçu de la question
		   afficherait alors une image cassée juste après le collage. C'est le
		   défaut que la tranche 2.6 a corrigé pour les notes ; il vaut à
		   l'identique pour les pièces jointes. */
		async writeBinary(path, data) {
			/* La vue, pas le tampon : `data.buffer` d'une vue partielle porte
			   plus d'octets que la vue elle-même, et l'image sortirait avec une
			   queue parasite. `share.ts` emploie encore la forme non bornée ;
			   ne pas la recopier. */
			const octets = data.buffer.slice(
				data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
			if (estCache(path)) {
				await adapter().writeBinary(path, octets);
				return;
			}
			const f = tfile(path);
			if (f) {
				await app.vault.modifyBinary(f, octets);
				return;
			}
			if (await adapter().exists(path)) {
				await adapter().writeBinary(path, octets);
				return;
			}
			await app.vault.createBinary(path, octets);
		},
		/* `fileManager.trashFile` et NON `vault.delete` : lui seul respecte le
		   réglage « Fichiers supprimés » de l'utilisateur (corbeille système,
		   `.trash` du vault, ou définitif). Choisir à sa place serait décider
		   qu'un quiz supprimé est irrécupérable chez quelqu'un qui a demandé
		   l'inverse.

		   PAS de branche adaptateur, contrairement à `write` et `process` : un
		   chemin caché n'a jamais de `TFile`, et la seule suppression
		   RÉCUPÉRABLE de l'adaptateur (`trashLocal`) date de 1.7.2, au-dessus du
		   `minAppVersion` du greffon. Aucun appelant ne jette un chemin caché —
		   le journal s'ajoute, les résultats ne se suppriment pas — et rendre la
		   main vaut mieux que détruire définitivement ce qu'on a promis de
		   rendre récupérable. */
		async trash(path) {
			const f = tfile(path);
			// Déjà absent (ou hors index) : le contrat ne promet que l'ABSENCE au
			// chemin donné, et rejeter ferait échouer une suppression que
			// l'utilisateur voit comme réussie (même raison que `remove`).
			if (!f) return;
			await app.fileManager.trashFile(f);
		},
		async exists(path) {
			return await adapter().exists(path);
		},
		mkdirs,
		/* MÊME PARTAGE que `write`, et il est venu pour la FRAÎCHEUR
		   (`src/host/types.ts`, « LA FRAÎCHEUR APRÈS UNE ÉCRITURE »).
		   `adapter().append` seul écrit sur le disque sans que le vault en
		   sache rien : le `TFile` gardait son ancien `mtime`, et `getFile`
		   rendait donc une date PÉRIMÉE après un ajout — la seule des quatre
		   voies d'écriture à trahir la promesse. `vault.append` existe depuis
		   0.13.0, très en dessous du `minAppVersion` déclaré (1.5.0).

		   L'ajout reste ATOMIQUE des deux côtés : c'est la propriété pour
		   laquelle cette méthode existe, et le journal de révision en dépend.
		   Le journal, justement, écrit sous `.neo-quiz/` — jamais indexé, donc
		   toujours la branche adaptateur : sa conduite ne change pas d'un
		   octet. */
		async append(path, data) {
			const f = tfile(path);
			if (f) {
				await app.vault.append(f, data);
				return;
			}
			await adapter().append(path, data);
		},
		/* Les FICHIERS seulement : `ListedFiles` sépare déjà `files` et
		   `folders`. Un dossier absent n'est pas une erreur — `list` jette
		   dans ce cas, et le contrat demande `[]`. */
		async list(dir) {
			try {
				return (await adapter().list(dir)).files;
			} catch (e) {
				return [];
			}
		},
		/* Ne rejette pas sur un fichier déjà absent : deux fenêtres Obsidian
		   peuvent absorber le même fichier de conflit, et le perdant n'a rien
		   fait de mal. */
		async remove(path) {
			try {
				await adapter().remove(path);
			} catch (e) {
				if (await adapter().exists(path)) throw e;
			}
		},
		/* Garde EXPLICITE, pas une confiance en `adapter().rename` : la
		   migration du journal (tâche 3) s'appuie sur ce rejet pour ne jamais
		   écraser une sauvegarde `.migrated` déjà posée — un `rename` qui
		   écraserait la destination en silence détruirait la sauvegarde que
		   la migration vient de créer. */
		async rename(from, to) {
			if (await adapter().exists(to)) throw new Error(`${to} existe déjà`);
			await adapter().rename(from, to);
		},
		listMarkdown() {
			return app.vault.getMarkdownFiles().map(toHostFile);
		},
		// TOUS les homonymes, casse ignorée : l'appelant prévient l'utilisateur
		// quand il y en a plusieurs. N'en rendre qu'un ferait disparaître
		// l'avertissement sans que rien ne le signale.
		findByName(name) {
			const cible = String(name ?? "").trim().toLowerCase();
			if (!cible) return [];
			return app.vault.getFiles()
				.filter(f => String(f?.name ?? "").trim().toLowerCase() === cible)
				.map(toHostFile);
		},
		getFile(path) {
			const f = tfile(path);
			return f ? toHostFile(f) : null;
		},
	};

	/* ─── links ─── */

	/* Ordre repris tel quel de `engine/sanitizer.ts` : le `metadataCache`
	   d'abord (lui seul comprend « schema.png » écrit depuis n'importe quelle
	   note), le chemin nu ensuite. Les deux appels sont gardés séparément :
	   une API interne qui jette ne doit pas emporter le repli avec elle.

	   Sorti de l'objet `links` pour être partagé par `resolve` ET
	   `resourceUrl` : le contrat impose à `resourceUrl` de RÉSOUDRE avant de
	   convertir, et deux résolutions écrites séparément divergent. Rend le
	   `TFile`, pas un `HostFile` : `getResourcePath` en a besoin. */
	function resoudreTFile(linkPath: string, fromPath: string): TFile | null {
		const raw = String(linkPath ?? "").trim();
		if (!raw) return null;

		try {
			if (app.metadataCache?.getFirstLinkpathDest) {
				const f = app.metadataCache.getFirstLinkpathDest(raw, fromPath || "");
				if (f) return f;
			}
		} catch (e) {
			console.warn("[Quiz] resolve (metadataCache) erreur:", e);
		}

		try {
			const f2 = asTFile(app.vault?.getAbstractFileByPath?.(raw));
			if (f2) return f2;
		} catch (e) {
			console.warn("[Quiz] resolve (getAbstractFileByPath) erreur:", e);
		}

		return null;
	}

	const links: Host["links"] = {
		resolve(linkPath, fromPath) {
			const f = resoudreTFile(linkPath, fromPath);
			return f ? toHostFile(f) : null;
		},
		/* « RÉSOUT puis convertit » (src/host/types.ts) : une chaîne passe par
		   `resoudreTFile` et rend `null` si rien ne correspond. L'ancien code
		   servait `adapter().getResourcePath(chemin)` sans rien vérifier — il
		   ne rendait donc JAMAIS `null` pour une chaîne non vide, ce qui
		   rendait morte la branche « chemin non résoluble » de son unique
		   appelant (`src/engine/cards.ts`) et laissait cassé un nom nu
		   (« schema.png ») référencé depuis un sous-dossier.

		   `null` et JAMAIS la chaîne vide : un `src=""` fait recharger la page
		   courante comme image — requête inutile et image cassée. */
		resourceUrl(target, fromPath) {
			try {
				const f = typeof target === "string"
					? resoudreTFile(target, fromPath || "")
					: tfile(target.path);
				return (f && app.vault.getResourcePath(f)) || null;
			} catch (e) {
				console.warn("[Quiz] resourceUrl erreur:", e);
				return null;
			}
		},
	};

	/* ─── watcher ─── */

	const watcher: Host["watcher"] = {
		/* Les quatre évènements du vault, traduits en `HostFileEvent`. `rename`
		   reste distinct de delete+create : le journal de révision suit ses clés
		   par renommage, et deux évènements ne se recollent pas.
		   Seuls les fichiers remontent — un dossier créé ne concerne personne. */
		onChange(cb) {
			const refs: EventRef[] = [];
			const emettre = (ev: HostFileEvent): void => {
				try { cb(ev); } catch (e) { console.warn("[Quiz] watcher: rappel en erreur:", e); }
			};

			refs.push(app.vault.on("create", (f: TAbstractFile) => {
				const file = asTFile(f);
				if (file) emettre({ kind: "create", file: toHostFile(file) });
			}));
			refs.push(app.vault.on("modify", (f: TAbstractFile) => {
				const file = asTFile(f);
				if (file) emettre({ kind: "modify", file: toHostFile(file) });
			}));
			// `delete` ne porte que le chemin : le fichier n'existe plus, rien à
			// convertir, et le contrat le dit ainsi.
			refs.push(app.vault.on("delete", (f: TAbstractFile) => {
				if (asTFile(f)) emettre({ kind: "delete", path: f.path });
			}));
			refs.push(app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
				const file = asTFile(f);
				if (file) emettre({ kind: "rename", file: toHostFile(file), oldPath });
			}));

			return () => {
				for (const ref of refs) {
					try { app.vault.offref(ref); } catch (e) { /* best effort */ }
				}
				refs.length = 0;
			};
		},
		/* `asTFile` rend null pour un DOSSIER : c'est exactement le cas que
		   `onChange` écarte, et celui dont le journal a besoin. Obsidian émet
		   le même évènement pour les deux, avec la même signature
		   (`TAbstractFile`) — d'où ce second abonnement plutôt qu'un champ
		   « isDir » que l'app ne saurait pas remplir honnêtement. */
		onRenameDir(cb) {
			const ref = app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
				if (asTFile(f)) return;
				try { cb({ from: oldPath, to: f.path }); } catch (e) { console.warn("[Quiz] onRenameDir: rappel en erreur:", e); }
			});
			return () => { try { app.vault.offref(ref); } catch (e) { /* best effort */ } };
		},
	};

	/* ─── ui ─── */

	const ui: Host["ui"] = {
		/* Le message arrive DÉJÀ TRADUIT par son appelant : l'hôte n'a aucune
		   chaîne de son cru. Le `try/catch` est le comportement actuel de
		   `quizNotice` — hors fenêtre Obsidian, `new Notice` jette, et une
		   notification perdue ne doit pas emporter le rendu avec elle. */
		notice(message, timeoutMs = 4000) {
			try { new Notice(String(message), timeoutMs); } catch (_) { console.log("[Quiz]", message); }
		},
		setIcon(el, name) {
			setIcon(el, name);
		},
		/* `getIconIds()` rend « lucide-x » ; le contrat veut « x ». Le préfixe
		   est retiré ICI et nulle part ailleurs, pour que le code partagé n'ait
		   jamais à savoir quel hôte le lui a donné (`icon-picker.ts` le faisait
		   lui-même, donc sous Obsidian seulement). */
		iconNames() {
			return getIconIds().map(id => id.replace(/^lucide-/, ""));
		},
	};

	/* ─── math ─── */

	/* Mémoïsation reprise de `engine/mathjax.ts` : MathJax n'est chargé qu'une
	   fois par session. Un ÉCHEC, lui, n'est pas mémoïsé — sinon une panne
	   transitoire (appel très tôt, environnement dégradé) tuerait le rendu
	   mathématique pour TOUTE la session, sans plus jamais retenter. */
	let mathReady: Promise<void> | null = null;

	const math: Host["math"] = {
		ready() {
			if (!mathReady) {
				mathReady = loadMathJax();
				mathReady.catch(() => { mathReady = null; });
			}
			return mathReady;
		},
		render(latex, display) {
			return renderMath(latex, display);
		},
		// Obsidian a besoin d'une passe finale après un lot de `renderMath`.
		// Sa promesse n'intéresse personne : le DOM est déjà en place.
		flush() {
			void finishRenderMath();
		},
	};

	/* ─── shell ─── */

	const shell: Host["shell"] = {
		/* Repris de `openWithDefaultAppFromVault` (engine/resources.ts).
		   Le contrat rend un booléen : la distinction « sélecteur système »
		   (Android) / « application par défaut » se redéduit chez l'appelant
		   depuis `platform.isMobile`, elle n'a pas à voyager ici. */
		async openExternal(file) {
			const f = file && tfile(file.path);
			if (!f) return false;
			try {
				// app.openWithDefaultApp : API non documentée dans obsidian.d.ts mais
				// bien présente au runtime (même convention de cast que dashboard/ai.ts).
				const appWithOpen = app as App & { openWithDefaultApp?: (path: string) => Promise<void> };
				if (typeof appWithOpen.openWithDefaultApp === "function") {
					await appWithOpen.openWithDefaultApp(f.path);
					return true;
				}
			} catch (e) {
				console.warn("[Quiz] app.openWithDefaultApp a échoué:", e);
			}
			try {
				// DataAdapter.getFullPath n'est déclaré que sur les classes concrètes
				// (FileSystemAdapter/CapacitorAdapter), pas sur l'interface générique.
				const ad = adapter() as DataAdapter & { getFullPath?: (path: string) => string };
				const absPath = ad?.getFullPath?.(f.path);
				const electronRequire = (window as Window & { require?: (id: string) => { shell?: ElectronShellLike } }).require;
				const electronShell = electronRequire?.("electron")?.shell;
				if (absPath && electronShell?.openPath) {
					// openPath rend la chaîne vide en cas de SUCCÈS, un message sinon.
					const result = await electronShell.openPath(absPath);
					if (result === "") return true;
				}
			} catch (e) {
				console.warn("[Quiz] fallback Electron openPath a échoué:", e);
			}
			return false;
		},
		/* Repris de `revealFileInObsidianExplorer` (engine/resources.ts). Rendre
		   `false` n'est pas une erreur : l'appelant enchaîne sur l'ouverture. */
		async revealInHost(file) {
			const f = file && tfile(file.path);
			if (!f) return false;
			try {
				let leaf: WorkspaceLeaf | null = (app.workspace?.getLeavesOfType?.("file-explorer") || [])[0];
				if (!leaf && typeof app.workspace?.getLeftLeaf === "function") {
					leaf = app.workspace.getLeftLeaf(false);
					if (leaf && typeof leaf.setViewState === "function") await leaf.setViewState({ type: "file-explorer", active: false });
				}
				if (!leaf) return false;
				// L'explorateur vient peut-être d'être ouvert : sa vue n'est montée
				// qu'au tick suivant, `revealInFolder` n'existerait pas encore.
				await new Promise<void>(r => setTimeout(r, 60));
				const view = leaf?.view as (View & { revealInFolder?: (file: TFile) => Promise<void> }) | undefined;
				if (view && typeof view.revealInFolder === "function") {
					await view.revealInFolder(f);
					try { app.workspace?.revealLeaf?.(leaf); } catch (_) {}
					return true;
				}
			} catch (e) {
				console.warn("[Quiz] revealInFolder a échoué:", e);
			}
			return false;
		},
	};

	/* ─── platform ─── */

	const platform: Host["platform"] = {
		isMobile: Platform.isMobile,
		isMacOS: Platform.isMacOS,
		/* La même source qu'`isMobile` : c'est Obsidian qui sait s'il tourne
		   dans son enveloppe Electron de bureau ou dans l'application mobile,
		   et c'est la seule question que la génération IA a le droit de poser
		   (un CLI local, un réseau atteignable). */
		isDesktopApp: Platform.isDesktopApp,
		/* Accesseur et non valeur figée : la langue d'Obsidian change sans
		   recharger le greffon, et une constante lue à l'installation resterait
		   celle du démarrage.
		   L'étiquette est rendue BRUTE (« fr », « fr-FR ») : c'est `src/i18n.ts`
		   qui décide ce qu'il en fait, pas l'hôte. `window.i18next` n'est PAS une
		   API publique (absente d'obsidian.d.ts) — d'où le repli sur
		   `<html lang>` puis l'anglais. */
		get uiLanguage(): string {
			try {
				const i18next = (window as unknown as { i18next?: I18nextLike }).i18next;
				const raw = i18next && typeof i18next.language === "string" ? i18next.language : "";
				return raw || document.documentElement.lang || "en";
			} catch (e) {
				return "en";
			}
		},
	};

	/* ─── paths ─── */

	/* UNE SEULE RACINE, d'identifiant VIDE : les chemins du greffon restent
	   exactement ce qu'ils ont toujours été, et `localPath` est l'identité.
	   C'est ce qui garantit que la clé du journal ne change pas d'un octet
	   pour les notes déjà journalisées. */
	const racine: HostRoot = {
		id: "",
		name: app.vault.getName(),
		reviewLog: `${REVIEW_DIR}/${REVIEW_LOG_NAME}`,
		/* L'ancien journal : `manifest.dir` tel que l'API le donne, jamais
		   recomposé. Il est optionnel (PluginManifest.dir), et son absence
		   signifie seulement qu'il n'y a rien à migrer. */
		legacyReviewLog: plugin.manifest.dir ? `${plugin.manifest.dir}/${REVIEW_LOG_NAME}` : null,
	};

	const paths: Host["paths"] = {
		/* NE CHANGE PAS, et ignore son argument : les fichiers de résultats
		   déjà écrits chez l'utilisateur vivent là. Même nature de piège que
		   `PLUGIN_ID` et `QUIZ_BLOCK_LANGUAGE`. */
		resultsDirFor() {
			return ".obsidian/quiz-blocks-results";
		},
		/* Obsidian décide, et il déduplique déjà contre ce qui existe. On ne
		   recalcule rien : le réglage a des modes RELATIFS à la note (« ./ »,
		   « ./images ») que reproduire ici ferait diverger au premier
		   changement d'Obsidian. */
		attachmentPathFor: (name, sourcePath) =>
			app.fileManager.getAvailablePathForAttachment(name, sourcePath),
		roots() {
			return [racine];
		},
		rootOf() {
			return racine;
		},
		localPath(path) {
			return path;
		},
		contractPath(_rootId, localPath) {
			return localPath;
		},
	};

	/* ─── modals ─── */

	const modals: Host["modals"] = {
		open(spec) {
			const modale = new HoteModal(app, spec);
			modale.open();
			return modale.poignee;
		},
	};

	/* ─── net ─── */

	const net: Host["net"] = {
		/**
		 * DEUX VOIES, ET C'EST L'HÔTE DE L'URL QUI TRANCHE — jamais l'appelant.
		 *
		 * — BOUCLE LOCALE (`localhost`, `127.0.0.1`, `[::1]`) : `fetch`. C'est
		 *   exactement ce que `ai-client.ts` faisait avant cette tranche, et pour
		 *   deux raisons qui tiennent toujours. La politique d'origine n'a jamais
		 *   gêné ici (Ollama répond avec les en-têtes qu'il faut), et surtout
		 *   `fetch` accepte un `signal` : un clic sur Stop FERME la connexion, et
		 *   Ollama arrête d'inférer. `requestUrl` n'accepte aucun signal — passer
		 *   par lui laissait le modèle tourner après l'annulation, jusqu'à faire
		 *   tourner DEUX inférences concurrentes sur le même modèle local si
		 *   l'utilisateur relançait aussitôt.
		 * — TOUT LE RESTE : `requestUrl`, la voie d'Obsidian qui contourne CORS.
		 *   Un `fetch` vers `api.anthropic.com` depuis le rendu échoue en
		 *   « Failed to fetch » (vérifié, cf. `ai-usage.ts`), et `ollama.com` —
		 *   le catalogue cloud — est dans le même cas. Le `signal` y est IGNORÉ,
		 *   et c'est écrit plutôt que passé sous silence.
		 *
		 * LES DEUX VOIES TIENNENT LE MÊME CONTRAT, au caractère près : `{status,
		 * body}` avec le CORPS d'un statut d'erreur (c'est là qu'Ollama met son
		 * diagnostic — d'où `throw: false`, sans lequel `requestUrl` jette et le
		 * perd), et `null` pour le SEUL échec réseau, abandon compris.
		 */
		async fetchJson(req) {
			try {
				if (estBoucleLocale(req.url)) {
					const resp = await fetch(req.url, {
						method: req.method ?? "GET",
						headers: req.headers,
						body: req.body,
						signal: req.signal,
					});
					return { status: resp.status, body: await resp.text() };
				}
				const resp = await requestUrl({
					url: req.url,
					method: req.method ?? "GET",
					headers: req.headers,
					body: req.body,
					throw: false,
				});
				return { status: resp.status, body: resp.text };
			} catch (e) {
				console.warn("[Quiz] requête réseau échouée:", req.url, e);
				return null;
			}
		},
	};

	/* ─── process ─── */

	const processus: Host["process"] = {
		async run(spec) {
			/* Le NOM est jugé avant tout : la liste blanche est la seule chose
			   qui sépare « lancer le CLI de l'utilisateur » de « lancer ce
			   qu'on lui a écrit sur le disque ». */
			if (!CLI_AUTORISES.includes(spec.tool)) {
				throw erreurCli("refuse", "CLI hors liste : " + String(spec.tool));
			}
			/* Mobile : pas de `require`, donc pas de CLI. NOMMÉ (`indisponible`)
			   plutôt que rendu comme un échec de lancement — ce n'est pas une
			   panne, c'est une plateforme sans processus enfants. Jugé AVANT
			   `avecFichiers`, qui écrirait sinon un dossier temporaire pour rien. */
			if (!Platform.isDesktopApp) {
				throw erreurCli("indisponible", "aucun CLI sur mobile");
			}
			const { resultat, sortie } = await avecFichiers(spec, async resolu => {
				/* ET AUCUN ARGUMENT NE PORTE DE SAUT DE LIGNE, sur TOUS les systèmes.
				   Il n'est dangereux que sur le chemin `cmd.exe` (un séparateur de
				   commandes qu'aucun guillemet ne neutralise — `citerPourCmd` le
				   refuse aussi, à son niveau), mais le laisser passer ailleurs ferait
				   dépendre le sort d'un argument du SYSTÈME et de la façon dont le CLI
				   a été installé : la même génération marcherait sous Linux et
				   échouerait sous un Windows à shim npm. Un refus net, partout, se
				   diagnostique ; une différence silencieuse, non.
				   Jugé APRÈS substitution : un jeton se remplace par un chemin, et
				   c'est ce qui part sur la ligne de commande qu'il faut juger. */
				const fautif = resolu.args.find(a => /[\r\n]/.test(a));
				if (fautif !== undefined) {
					throw erreurCli("refuse", "argument refusé : un saut de ligne ne peut pas être cité");
				}
				return lancerCli({
					tool: spec.tool,
					args: resolu.args,
					stdin: resolu.stdin,
					signal: spec.signal,
					timeoutMs: spec.timeoutMs,
				}, false, envHote);
			}, envHote);
			return Object.assign({}, resultat, { sortie });
		},

		/* Le fichier de cache du CLI, à son chemin FIXE — hors de toute racine,
		   c'est pourquoi `HostFs` ne l'atteint pas. L'hôte LIT et DÉCODE ; le
		   parsing (quels modèles, quels efforts) reste dans le code partagé.
		   Le `mtime` est rendu pour que l'appelant ne re-parse que ce qui a
		   changé. `null` = absent, illisible, ou mobile (pas de `require`). */
		async lireCache(tool) {
			if (!Platform.isDesktopApp) return null;
			try {
				const fs = require("fs") as typeof import("fs");
				const path = require("path") as typeof import("path");
				/* `dossierPersonnel` et non `os.homedir()` : même raison que pour
				   `buildChildEnv` — c'est ce qui rend ces deux chemins atteignables
				   par un contrôle. Les deux valent la même chose en production
				   (`os.homedir()` lit `USERPROFILE` sous Windows, `HOME` ailleurs). */
				const maison = dossierPersonnel(envHote);
				const file = tool === "codex"
					? path.join(envHote.CODEX_HOME || path.join(maison, ".codex"), "models_cache.json")
					: path.join(maison, ".claude.json");
				const mtimeMs = fs.statSync(file).mtimeMs;
				return { mtimeMs, json: JSON.parse(fs.readFileSync(file, "utf8")) as unknown };
			} catch (e) {
				return null; // absent, illisible ou JSON invalide → « pas de cache »
			}
		},

		/* Ollama INSTALLÉ, même serveur arrêté : le binaire répond à `--version`
		   (PATH étendu, couvre npm/brew/PATH custom), sinon les emplacements
		   d'installation officiels. Le plugin diagnostique lui-même (demande
		   Ahmed : jamais un « si Ollama n'est pas installé » laissé à
		   l'utilisateur). */
		async ollamaInstalle() {
			if (!Platform.isDesktopApp) return false;
			const repond = await lancerCli({ tool: "ollama", args: ["--version"], stdin: "", timeoutMs: 4000 }, false, envHote)
				.then(res => res.code === 0)
				.catch(() => false);
			if (repond) return true;
			try {
				const fs = require("fs") as typeof import("fs");
				const path = require("path") as typeof import("path");
				const candidates = Platform.isWin
					? [path.join(envHote.LOCALAPPDATA || "", "Programs", "Ollama", "ollama app.exe")]
					: Platform.isMacOS
						? ["/Applications/Ollama.app", "/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"]
						: ["/usr/local/bin/ollama", "/usr/bin/ollama"];
				return candidates.some(p => fs.existsSync(p));
			} catch (e) {
				return false;
			}
		},

		/* Démarre Ollama (le serveur démarre avec l'application) — détaché,
		   best effort : l'app de bureau sur Windows/macOS, « ollama serve » sur
		   Linux (pas d'app). Les erreurs asynchrones (exe absent) sont avalées :
		   le poll de l'appelant constatera simplement l'échec. */
		async demarrerOllama() {
			if (!Platform.isDesktopApp) return false;
			try {
				const cp = require("child_process") as typeof import("child_process");
				const path = require("path") as typeof import("path");
				let child;
				if (Platform.isWin) {
					const fs = require("fs") as typeof import("fs");
					const exe = path.join(envHote.LOCALAPPDATA || "", "Programs", "Ollama", "ollama app.exe");
					child = fs.existsSync(exe)
						? cp.spawn(exe, [], { detached: true, stdio: "ignore" })
						: cp.spawn("ollama", ["serve"], { detached: true, stdio: "ignore", env: buildChildEnv(envHote) });
				} else if (Platform.isMacOS) {
					child = cp.spawn("open", ["-a", "Ollama"], { detached: true, stdio: "ignore" });
				} else {
					child = cp.spawn("ollama", ["serve"], { detached: true, stdio: "ignore", env: buildChildEnv(envHote) });
				}
				child.on("error", () => { /* constaté par le poll de l'appelant */ });
				child.unref();
				return true;
			} catch (e) {
				return false;
			}
		},
	};

	return { fs, links, watcher, ui, math, shell, platform, paths, modals, net, process: processus };
}
