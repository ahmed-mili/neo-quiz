/* ══════════════════════════════════════════════════════════
   LA LISTE DES MODÈLES EN DIRECT — CÔTÉ PROCESSUS PRINCIPAL

   Sorti de `process.ts` le 2026-09-23 : ce surveillant tire `chokidar`, et
   `process.ts` est importé par des contrôles que la CI lance sans les
   dépendances de l'application (`check:electron-video`) — l'import y cassait
   la construction. Les chemins restent ceux de `process.ts` (`cheminCache`,
   `dossierPersonnel`) : une seule définition de ce qu'on lit.
══════════════════════════════════════════════════════════ */

import { watch } from "chokidar";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { LOG_PREFIX } from "../../../src/branding";
import { cheminCache, dossierPersonnel } from "./process";
import type { OutilCache } from "./process";

/**
 * SURVEILLE les fichiers de modèles des CLI : `~/.claude.json`, le catalogue
 * que Claude Code télécharge (`~/.claude/cache/model-catalog/*-cc.json`) et
 * `models_cache.json` de Codex. `rappel(outil)` part dès que l'un d'eux est
 * réécrit, débouncé par outil (`~/.claude.json` est réécrit à chaque
 * événement d'une session Claude Code).
 *
 * POURQUOI (2026-09-23) : le catalogue du compte datait de la veille et le
 * menu montrait un modèle que le serveur avait déjà rangé à part. Le
 * catalogue ne se force pas sans consommer de quota — mesuré : `--version`,
 * `auth status`, `mcp list` ne le retéléchargent pas, seule une vraie
 * session le fait, et une requête vers une API injoignable ne le fait pas
 * non plus. Mais Claude Code le retélécharge lui-même à chaque session : la
 * liste suit donc en direct dès qu'il le fait, sans rien dépenser.
 *
 * Les DOSSIERS parents sont surveillés à profondeur 0, filtrés sur les seuls
 * fichiers visés : un fichier réécrit par renommage (écriture atomique) ou
 * créé après le démarrage est vu comme un autre. Un dossier absent au
 * démarrage n'est pas surveillé (CLI jamais lancé) : le menu reste alors relu
 * à chaque ouverture, comme avant. Rend de quoi TOUT arrêter.
 */
export function surveillerCachesCli(
	rappel: (tool: OutilCache) => void,
	env: NodeJS.ProcessEnv = process.env,
	delaiMs = 400,
): () => Promise<void> {
	const casse = (p: string): string => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
	const claudeJson = cheminCache("claude", env);
	const codexJson = cheminCache("codex", env);
	const catalogues = join(dossierPersonnel(env), ".claude", "cache", "model-catalog");
	const cibles = new Map<string, OutilCache>([[casse(claudeJson), "claude"], [casse(codexJson), "codex"]]);
	const dossierCatalogues = casse(catalogues);
	const outilDe = (p: string): OutilCache | null => {
		const c = casse(p);
		const cible = cibles.get(c);
		if (cible) return cible;
		return dirname(c) === dossierCatalogues && c.endsWith("-cc.json") ? "claude" : null;
	};
	const dossiers = [...new Set([dirname(claudeJson), dirname(codexJson), catalogues])].filter(d => existsSync(d));
	const surveilles = new Set(dossiers.map(casse));
	const minuteries = new Map<OutilCache, ReturnType<typeof setTimeout>>();
	const signaler = (p: string): void => {
		const tool = outilDe(p);
		if (!tool) return;
		clearTimeout(minuteries.get(tool));
		minuteries.set(tool, setTimeout(() => { minuteries.delete(tool); rappel(tool); }, delaiMs));
	};
	const watcher = watch(dossiers, {
		ignoreInitial: true,
		depth: 0,
		ignored: (p: string) => !surveilles.has(casse(p)) && outilDe(p) === null,
	});
	watcher.on("add", signaler).on("change", signaler).on("unlink", signaler);
	// Un surveillant en échec ne coûte que le direct : le menu reste relu à l'ouverture.
	watcher.on("error", e => console.warn(LOG_PREFIX, "surveillance des modèles des CLI:", e));
	return async () => {
		for (const m of minuteries.values()) clearTimeout(m);
		minuteries.clear();
		await watcher.close();
	};
}
