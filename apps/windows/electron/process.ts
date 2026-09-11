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

   `run` REJETTE `indisponible` jusqu'à la tâche 7, qui étend ce fichier avec
   la résolution de l'exécutable, le `spawn`, le stdin et l'arbre tué à
   l'annulation. Un rejet NOMMÉ, et non un `stdout` vide : le code partagé
   traduit ce nom en « fournisseur indisponible », là où une réponse vide
   passerait pour une génération ratée sans raison.

   Le DOSSIER PERSONNEL est INJECTABLE (`env`) et non lu d'un `os.homedir()`
   figé : `npm run check:electron-process` doit pouvoir éprouver le module
   RÉEL sur un faux dossier personnel, sans toucher aux vrais fichiers de la
   machine ni dépendre de ce qu'ils contiennent. `os.homedir()` ne suit PAS
   `process.env.HOME` sous Windows (il lit le profil du système), d'où une
   résolution explicite ici — et c'est la même règle que partout dans ce
   dépôt : ce qu'un contrôle ne peut pas atteindre n'est pas contrôlé.
══════════════════════════════════════════════════════════ */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
export async function ollamaInstalle(): Promise<boolean> {
	if (await repondAVersion("ollama")) return true;
	return emplacementsOllama().some(p => {
		try {
			return existsSync(p);
		} catch (e) {
			return false;
		}
	});
}

/** `<exe> --version` sort-il en 0 ? Toute autre issue (introuvable, code non
    nul, plus de 4 s) vaut « non » : la question n'a que deux réponses, et une
    exception ici ferait échouer une DÉTECTION. */
function repondAVersion(exe: string): Promise<boolean> {
	return new Promise(resolve => {
		let tranche = false;
		const fini = (valeur: boolean): void => {
			if (tranche) return;
			tranche = true;
			resolve(valeur);
		};
		try {
			const enfant = spawn(exe, ["--version"], { windowsHide: true, stdio: "ignore" });
			const minuteur = setTimeout(() => { enfant.kill(); fini(false); }, 4000);
			enfant.on("error", () => { clearTimeout(minuteur); fini(false); });
			enfant.on("close", code => { clearTimeout(minuteur); fini(code === 0); });
		} catch (e) {
			fini(false);
		}
	});
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
export async function demarrerOllama(): Promise<boolean> {
	try {
		const env = process.env;
		let enfant;
		if (process.platform === "win32") {
			const exe = join(env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama app.exe");
			enfant = existsSync(exe)
				? spawn(exe, [], { detached: true, stdio: "ignore" })
				: spawn("ollama", ["serve"], { detached: true, stdio: "ignore" });
		} else if (process.platform === "darwin") {
			enfant = spawn("open", ["-a", "Ollama"], { detached: true, stdio: "ignore" });
		} else {
			enfant = spawn("ollama", ["serve"], { detached: true, stdio: "ignore" });
		}
		enfant.on("error", () => { /* constaté par le poll de l'appelant */ });
		enfant.unref();
		return true;
	} catch (e) {
		return false;
	}
}

/**
 * Lancer un CLI — PAS ENCORE, et le rejet est NOMMÉ.
 *
 * La tâche 7 remplace ce corps par la vraie exécution (résolution de
 * l'exécutable par le PATH ou le réglage « chemin », `spawn`, prompt complet
 * sur `stdin`, arbre de process tué à l'annulation). D'ici là, `indisponible`
 * est la réponse honnête : le code partagé la traduit en « fournisseur
 * indisponible », là où un `stdout` vide ferait croire à une génération qui a
 * tourné pour rien.
 */
export async function run(_spec: {
	tool: string;
	args: string[];
	stdin: string;
	timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; code: number | null }> {
	throw erreurCli("indisponible", "lancer un CLI n'est pas encore implémenté dans l'application");
}
