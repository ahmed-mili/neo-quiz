# La génération IA dans l'application — conception

Écrit le 2026-09-11, à la clôture de la migration Electron (`9604d27..e16b7e3`).
Tranche 5 de la feuille de route. Trois décisions prises par Ahmed le même
jour, et reprises telles quelles : **liste blanche d'exécutables tenue par le
processus principal ; Ollama d'abord ; la dictée supprimée dans cette
tranche.**

**Critère de sortie, fixé par Ahmed :** l'application génère un quiz par IA
avec les trois fournisseurs. Une tranche qui s'arrête avant n'est pas finie.

## 1. Le périmètre

### But

L'application Windows génère des quiz comme le greffon : trois fournisseurs
(Claude Code CLI, Codex CLI, Ollama local et cloud), le sélecteur « @ » qui
attache des fichiers au prompt, le suivi d'usage. **La conduite du greffon ne
change pas** : mêmes commandes, même `taskkill /T`, même cache de modèles,
mêmes erreurs. Une divergence côté application n'est admise que si elle est
écrite au contrat avec sa raison.

### Ce qui sort du cliquet

`scripts/check-host.mjs`, constante `RESTANTS`, compte 15 fichiers. Huit de la
génération en sortent, chacun dans le commit de sa conversion ; deux de la
dictée sont supprimés. Cible : **5** (`dashboard.ts`, `share.ts`,
`types/dashboard-ctx.ts`, `hotkey-format.ts`, `modal-base.ts`).

| Fichier | Lignes | Ce qu'il tire d'Obsidian, mesuré |
|---|---|---|
| `ai-client.ts` | 899 | `Platform` (2), `requestUrl` (1), `require("child_process"/"os"/"path"/"fs")` (8), `plugin.settings` (10) |
| `ai-providers.ts` | 985 | `Platform` (8), `requestUrl` (3) |
| `ai-usage.ts` | 517 | `Platform` (2), `requestUrl` (4), `plugin.settings` (3) |
| `usage-modal.ts` | 351 | `setIcon` (3), `plugin.settings` (2) |
| `ai.ts` | 2 116 | `setIcon` (19), `Notice` (16), `loadPdfJs` (4), `MarkdownRenderer` (2), `Platform` (3), `app.vault` (6), `app.workspace` (2), `plugin.settings` (32), `TFile` (8) |
| `file-sources.ts` | 281 | `Platform` (6), `prepareFuzzySearch` (4), `app.vault` (3), `TFolder`/`TAbstractFile` (6) |
| `mention-picker.ts` | 262 | `Notice` (1), `app.vault` (1), `TFolder` (2) |
| `prompt-paths.ts` | 222 | `Platform` (1), `app.vault` (2), `TFile` (2) |
| `voice-input.ts` | 312 | supprimé |
| `voice-install.ts` | 225 | supprimé |

### Ce que le code dit, contre les notes antérieures

Les notes de conception de cette tranche avaient été écrites pour Tauri. Quatre
faits mesurés les corrigent :

1. **Ollama ne passe pas par `requestUrl` mais par `fetch()` direct** depuis le
   rendu (`ai-client.ts:597,666`, vers `localhost:11434`). Sous Electron, un
   `fetch` du rendu vers `localhost` est refusé par la politique d'origine
   (`file://` en paquet, `localhost:1421` en développement). **Tout le HTTP
   part donc du processus principal** : Ollama local, `ollama.com`,
   `api.anthropic.com`.
2. **`Platform.isDesktopApp` apparaît quatorze fois** dans ces fichiers ;
   `HostPlatform` ne le porte pas. Un champ à ajouter.
3. **`ai.ts` tire `ctx.plugin.settings.*` trente-deux fois** et
   `ctx.plugin.saveSettings` six fois. Le code déjà porté n'a jamais de
   `plugin` : `stats-store.ts` reçoit un `StatsStoreHost { getStats,
   saveStats }`. Le même patron s'applique aux réglages IA.
4. **La dictée a trois appelants**, pas zéro : `ai.ts:11`,
   `types/dashboard-ctx.ts:32` (`AiSettings extends VoiceSettings`),
   `apps/obsidian/plugin.ts:37,159-162` (défauts et onglet de réglages). Sa
   suppression est une tâche avec migration de réglages persistés.

### Ce qui ne se porte pas

- **Le partage** (`share.ts`) reste au greffon, décision antérieure.
- **Les PDF joints au prompt** (`loadPdfJs`, 4 appels dans `ai.ts`) : Obsidian
  embarque pdf.js, l'application non. À trancher à la tâche 6 : soit un
  `HostPdf.extractText(file)` implémenté par les deux hôtes, soit les PDF
  refusés dans l'application avec une Notice claire. Le plan retient la
  seconde voie si la première coûte plus qu'une tâche.

## 2. L'architecture

### Deux membres neufs au contrat, et un champ

```ts
// src/host/types.ts

export interface HostPlatform {
	// … existant …
	/** Vrai dans un hôte de bureau (greffon Obsidian desktop, application
	    Electron), faux sur mobile. Remplace les quatorze `Platform.isDesktopApp`
	    de la génération. */
	isDesktopApp: boolean;
}

/** Tout HTTP de la génération. Sous Obsidian : `requestUrl` (qui contourne
    CORS). Dans l'application : le processus principal, derrière une LISTE
    D'HÔTES autorisés — un `explainHtml` hostile ne fait pas du rendu un proxy
    vers n'importe où. Rend `null` sur tout échec réseau ; l'appelant a son
    repli embarqué. Un statut HTTP d'erreur n'est PAS un échec réseau : il est
    rendu, avec son corps (Ollama met son diagnostic dans le corps). */
export interface HostNet {
	fetchJson(req: {
		url: string;
		method?: "GET" | "POST";
		headers?: Record<string, string>;
		body?: string;
		signal?: AbortSignal;
	}): Promise<{ status: number; body: string } | null>;
}

/** Un CLI lancé SANS RIEN D'INTERACTIF : le prompt complet sur stdin, stdin
    fermé, stdout et stderr rendus SÉPARÉS et À LA FIN, le code de sortie.
    `tool` est un NOM, jamais un chemin : c'est l'hôte qui résout l'exécutable
    (réglage « chemin » s'il est rempli, sinon le PATH du processus), et il
    refuse tout nom hors de sa liste. L'annulation tue L'ARBRE de process
    (`taskkill /pid /T /F` sous Windows, groupe de process ailleurs) : `claude`
    et `codex` spawnent des enfants. `run` rejette alors avec une erreur dont
    `name === "annule"`. */
export interface HostProcess {
	run(spec: {
		tool: "claude" | "codex";
		args: string[];
		stdin: string;
		signal?: AbortSignal;
	}): Promise<{ stdout: string; stderr: string; code: number | null }>;
}

export interface Host {
	// … existant …
	net: HostNet;
	process: HostProcess;
}
```

**Pourquoi `tool` est un nom.** C'est la liste blanche demandée par Ahmed, et
c'est ce qui rend impossible la séquence que la migration a dû fermer sur
`ouvrir` : `fichiers.write("x.bat")` puis `process.run("x.bat")`. Un nouvel
outil est une ligne de plus dans le principal, pas une capacité de plus pour
le rendu.

**Pourquoi `HostNet` sert aussi Ollama local.** Sous Tauri, un `fetch` vers
`localhost:11434` passait. Sous Electron, il ne passe plus (politique
d'origine). Une seule porte réseau, dans le principal, avec ses hôtes
autorisés : `localhost`/`127.0.0.1` (Ollama), `ollama.com` (catalogue),
`api.anthropic.com` (usage). L'URL Ollama est un RÉGLAGE (`aiOllamaUrl`) : son
hôte est ajouté à la liste au chargement des réglages, par le principal, comme
`folders` l'est au périmètre.

### Les réglages, par le patron de `stats-store`

```ts
// src/dashboard/ai-settings-host.ts
export interface AiSettingsHost {
	get(): AiSettings;
	save(patch: Partial<AiSettings>): Promise<void>;
}
```

`ai.ts`, `ai-client.ts`, `ai-usage.ts` et `usage-modal.ts` reçoivent cet
objet au lieu de `ctx.plugin`. Sous Obsidian : `plugin.settings` /
`plugin.saveSettings()`. Dans l'application : `neo.reglages` sous la clé `ai`,
avec les mêmes champs. `DashboardCtx.plugin` disparaît du contrat de la
génération (il reste pour `share.ts`, hors tranche).

### La dictée

`VoiceSettings` sort d'`AiSettings`. Les clés `voice*` persistées sont
**ignorées à la lecture, jamais effacées** : un utilisateur qui reviendrait à
une version antérieure les retrouverait. L'onglet de réglages du greffon perd
sa section ; `apps/obsidian/plugin.ts` perd ses défauts `voice*`.

### Où vit chaque chose dans l'application

| Côté | Fichier | Rôle |
|---|---|---|
| principal | `apps/windows/electron/reseau.ts` | `HostNet` : `net.fetch` d'Electron, liste d'hôtes, corps rendu même en erreur |
| principal | `apps/windows/electron/process.ts` | `HostProcess` : résolution de l'exécutable, `spawn`, stdin, arbre tué, un process à la fois par outil |
| principal | `canaux.ts`, `pont.ts`, `preload.ts` | deux canaux de plus, `net.fetch` et `process.run`/`process.abort` |
| rendu | `apps/windows/src/host/net.ts`, `process.ts` | passe-plats vers le pont |
| rendu | `apps/windows/src/ui/dashboard-shell.ts` | `canOpen("ai")` devient vrai ; la page « Générer » se monte |
| partagé | `src/dashboard/ai-settings-host.ts` | le contrat des réglages |
| partagé | `src/text-search.ts` | la recherche floue pure qui remplace `prepareFuzzySearch` |

## 3. L'ordre des tâches, et pourquoi

| # | Tâche | `RESTANTS` après | Pourquoi ici |
|---|---|---|---|
| 1 | Supprimer la dictée (trois appelants, réglages ignorés à la lecture) | 13 | `ai.ts` l'importe : la porter avant de la supprimer serait du travail jeté |
| 2 | `HostPlatform.isDesktopApp`, `HostNet` — les deux hôtes, contrôle par discriminance, `reseau.ts` dans le principal avec sa liste d'hôtes | 13 | le socle ; rien ne sort encore, mais tout ce qui suit s'y appuie |
| 3 | `ai-providers.ts` sur `HostNet` (catalogue `ollama.com`) et `HostFs` (cache Codex) | 12 | aucun process ; premier fichier libéré, le plus simple |
| 4 | `ai-client.ts`, **Ollama seul** sur `HostNet` ; Claude et Codex derrière `HostProcess`, que l'application implémente par un REJET nommé (« fournisseur indisponible ») | 11 | **la première génération marche dans l'application** ; le contrat existe, son implémentation lourde attend |
| 5 | `file-sources.ts`, `mention-picker.ts`, `prompt-paths.ts` sur `HostFs`/`HostLinks` ; `prepareFuzzySearch` remplacé par `src/text-search.ts` | 8 | le sélecteur « @ », dont `ai.ts` dépend |
| 6 | `ai.ts` + `usage-modal.ts` : `AiSettingsHost`, `host.ui.setIcon`, `host.ui.notice`, rendu markdown partagé, PDF tranchés ; la coquille ouvre « Générer » | 6 | la page elle-même ; tout ce qu'elle appelle existe déjà |
| 7 | `HostProcess` dans le principal : `process.ts`, liste blanche, réglage « chemin de l'exécutable » par outil, arbre tué, contrôle sur un vrai process | 6 | **Claude et Codex marchent** ; en dernier parce que c'est la capacité la plus dangereuse du pont |
| 8 | `ai-usage.ts` : jeton OAuth lu par `HostFs`, `api.anthropic.com` par `HostNet` | 5 | en dernier parce qu'il touche un secret ; ne bloque aucune génération |

**Réécritures, à relire autrement qu'un portage** : la tâche 4 (le `fetch`
change de processus), la tâche 5 (la recherche floue est réécrite), la
tâche 7 (entièrement neuve).

**Ce qui est un portage** : les tâches 3, 6, 8 — le même code passe par le
contrat.

## 4. Erreurs et contrôles

### Erreurs

- Un CLI absent du PATH et sans réglage : `run` rejette avec `name ===
  "introuvable"` et le nom de l'outil ; la page affiche la Notice existante
  du greffon (« CLI introuvable »), qui pointe vers le réglage « chemin ».
- Un hôte réseau hors liste : `fetchJson` rend `null` ET le principal logge le
  refus avec l'URL. Jamais silencieux.
- Une annulation : `run` rejette `annule` ; l'arbre est tué AVANT que la
  promesse se résolve (le contrat le promet ; le contrôle le prouve par un
  process enfant qui écrit dans un fichier après un délai, et qui ne doit
  rien écrire).
- Deux générations simultanées avec le même outil : refusées par le principal
  (`name === "occupe"`). Le greffon n'a jamais eu ce cas ; c'est écrit au
  contrat comme divergence admise.

### Contrôles

Le modèle des tranches précédentes, sans exception : un script `.mjs` par
comportement, code RÉEL par `withSrcModule`, `process.exitCode`, discriminance
libellée.

- `check:obsidian-host`, `check:windows-host` : `isDesktopApp`, `net`,
  `process` s'y ajoutent.
- `check:electron-reseau` (neuf) : la liste d'hôtes (refus, acceptation, hôte
  d'`aiOllamaUrl` ajouté), le corps rendu sur un statut d'erreur, `null` sur
  échec réseau.
- `check:electron-process` (neuf) : nom hors liste refusé ; exécutable résolu
  par le réglage avant le PATH ; stdin écrit et fermé ; stdout/stderr séparés ;
  code de sortie ; **l'annulation tue l'arbre** (un `cmd /c` qui lance un
  enfant différé) ; deux `run` simultanés du même outil → `occupe`.
- `check:text-search` (neuf) : la recherche floue, contre des cas tirés de
  `prepareFuzzySearch` observés dans Obsidian (le comportement, pas le code).
- `check:host` : `RESTANTS` décroît de 15 à 5 en huit commits ; la liste ne
  remonte jamais.
- `check:markers`, `check:md` : inchangés, relancés à la tâche 6.

### Vérification à l'écran, à la fin

Une génération par fournisseur, depuis la page « Générer » de l'application,
avec un fichier attaché par « @ » : le quiz apparaît, s'enregistre dans le
dossier choisi, se relit. L'annulation en cours de génération laisse le
gestionnaire des tâches SANS process `claude`/`codex`/`node` orphelin.

## 5. Ce que cette conception ne fait pas

- Elle ne touche pas à `src/scheduler/` ni à `src/engine/`.
- Elle ne signe pas l'installeur et ne touche pas à la CI Linux.
- Elle ne porte pas le partage.
- Elle n'ajoute pas de fournisseur : les trois du greffon, pas un de plus.
- Elle ne fait pas de streaming : aucun appelant ne lit au fil de l'eau.
