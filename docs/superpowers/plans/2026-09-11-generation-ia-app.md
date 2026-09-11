# La génération IA dans l'application — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — employer `superpowers:subagent-driven-development` pour exécuter ce plan tâche par tâche. Les étapes portent des cases `- [ ]`.

**But :** l'application Windows génère un quiz par IA avec les trois fournisseurs du greffon (Ollama, Claude Code CLI, Codex CLI), fichiers attachés par « @ » compris, sans qu'une ligne de conduite du greffon change.

**Architecture :** deux membres neufs au contrat d'hôte, `HostNet` (tout HTTP) et `HostProcess` (un CLI par son NOM, jamais un chemin), implémentés dans le PRINCIPAL Electron derrière deux canaux du pont, et par `requestUrl`/`child_process` sous Obsidian avec le code actuel. Les réglages IA passent par un `AiSettingsHost` sur le patron de `stats-store`. La dictée est supprimée d'abord.

**Pile :** TypeScript strict, Electron (`net.fetch`, `child_process.spawn`), scripts de contrôle `.mjs` par `withSrcModule`.

**Spec :** `docs/superpowers/specs/2026-09-11-generation-ia-app-design.md` — le plan argumente depuis elle ; l'exécutant lit les deux.

## Contraintes globales

- **`src/scheduler/` et `src/engine/` NE BOUGENT PAS.** `src/` bouge, c'est l'objet de la tranche, mais UNIQUEMENT les fichiers nommés par chaque tâche.
- **La conduite du greffon ne change pas** : mêmes commandes CLI (`claude -p --output-format json --model …`, `codex exec --json -m …`), même `taskkill /pid <pid> /T /F`, même cache `~/.codex/models_cache.json`, mêmes erreurs. Une divergence n'est admise que si elle est ÉCRITE au contrat avec sa raison.
- **`tool` est un nom (`"claude" | "codex"`), jamais un chemin.** Le principal résout l'exécutable et refuse tout autre nom. Décision d'Ahmed, 2026-09-11.
- **Tout HTTP part du principal** derrière une liste d'hôtes : `localhost`, `127.0.0.1`, `ollama.com`, `api.anthropic.com`, plus l'hôte d'`aiOllamaUrl` lu des réglages.
- **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`** ; le préchargement n'expose que le pont ; aucun `ipcMain.on` sans réponse.
- **`npm run check:host` : `RESTANTS` ne fait que RÉTRÉCIR**, 15 → 5, et chaque fichier sort dans le MÊME commit que sa conversion. L'assertion 6 (le rendu n'importe jamais Node) ne doit jamais rougir.
- **Aucune chaîne visible en dur** : `t("domaine.clé")`, appelé AU RENDU. Clés neuves en anglais dans `src/i18n/en/*.ts` ET en français (le type l'exige).
- **Commentaires en français, documentant le POURQUOI.** Aucun marqueur d'encodage (`Ã`, `â€` ; `Â` seul est légitime).
- **Scripts de contrôle : `process.exitCode`, jamais `process.exit()`. Juger sur le CODE DE SORTIE.**
- **Tout cas neuf s'éprouve par DISCRIMINANCE** : casser la règle, relever le LIBELLÉ EXACT de l'assertion qui rougit, restaurer.
- **Commits directs sur `main`**, jamais de push.
- **Aucun agent ne lance l'installeur.** Les vérifications à l'écran se font en `npm run app:dev`.

---

## État des lieux, mesuré le 2026-09-11

| Fichier | Lignes | Sort à la tâche |
|---|---|---|
| `src/dashboard/voice-input.ts`, `voice-install.ts` | 537 | 1 (supprimés) |
| `src/dashboard/ai-providers.ts` | 985 | 3 |
| `src/dashboard/ai-client.ts` | 899 | 4 |
| `src/dashboard/file-sources.ts`, `mention-picker.ts`, `prompt-paths.ts` | 765 | 5 |
| `src/dashboard/ai.ts`, `usage-modal.ts` | 2 467 | 6 |
| `src/dashboard/ai-usage.ts` | 517 | 8 |

Restent après : `dashboard.ts`, `share.ts`, `types/dashboard-ctx.ts`, `hotkey-format.ts`, `modal-base.ts`.

Appelants de la dictée (vérifiés par `grep -rn "voice-input\|voice-install\|VoiceSettings"`) : `src/dashboard/ai.ts:11,664` ; `src/types/dashboard-ctx.ts:32,60` ; `apps/obsidian/plugin.ts:37-38,101-104,159-163,934-~1000` ; `scripts/check-host.mjs:44-45` ; `src/i18n/{en,fr}/{ai,plugin}.ts` (clés `voice.*`).

---

## Task 1 : Supprimer la dictée

**Files:**
- Delete: `src/dashboard/voice-input.ts`, `src/dashboard/voice-install.ts`
- Modify: `src/dashboard/ai.ts:11,664`, `src/types/dashboard-ctx.ts:32,56-60,347-348`, `apps/obsidian/plugin.ts:37-38,101-104,158-163,934-~1000`, `scripts/check-host.mjs:44-45`, `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts`, `src/i18n/en/plugin.ts`, `src/i18n/fr/plugin.ts`, `CLAUDE.md` (section « Composants UI », puce « Dictée »)

**Interfaces:**
- Consomme : rien.
- Produit : `AiSettings` sans `VoiceSettings` ; `RESTANTS` à 13.

- [ ] **Étape 1 : vérifier les appelants par PLUSIEURS voies**

```bash
grep -rn "voice-input\|voice-install\|VoiceSettings\|VoiceBackend\|VoiceModelId\|VoiceLang\|voiceEnabled\|voiceBackend\|voiceModel\|voiceLang" src/ apps/ scripts/ --include=*.ts --include=*.mjs
```
Attendu : uniquement les lignes listées ci-dessus. Toute autre = à traiter aussi.

- [ ] **Étape 2 : les réglages persistés sont IGNORÉS, pas effacés**

Dans `apps/obsidian/plugin.ts`, retirer `voiceEnabled/voiceBackend/voiceModel/voiceLang` de l'interface des settings (101-104) et des défauts (159-163). Ne PAS ajouter de migration qui les supprime de `data.json` : un utilisateur qui reviendrait à une version antérieure les retrouverait. Écrire ce pourquoi en commentaire à la place des défauts retirés.

- [ ] **Étape 3 : retirer la section de l'onglet de réglages** (`plugin.ts:934` jusqu'à la section suivante), l'import `voiceInstall` (37-38), l'appel `voiceInput.attach` dans `ai.ts:664` et son import (11).

- [ ] **Étape 4 : `AiSettings` ne s'étend plus de `VoiceSettings`** (`dashboard-ctx.ts:60`) ; retirer l'import (32) et corriger les commentaires (56, 347-348).

- [ ] **Étape 5 : les clés i18n `voice.*`** disparaissent des quatre dictionnaires. `npm run check` rougit tant qu'une clé anglaise sans française subsiste : c'est le filet.

- [ ] **Étape 6 : `git rm` des deux fichiers ; retirer leurs deux lignes de `RESTANTS`.**

- [ ] **Étape 7 : contrôles** — `npm run check`, `check:host` (**13**), `check:app`, `check:dashboard-dom`, `build`, `check:lesson`. Codes de sortie relevés.

- [ ] **Étape 8 : `CLAUDE.md`** — la puce « Dictée » de « Composants UI » devient une ligne « La dictée a été retirée le 2026-09-11 ; ses réglages persistés sont ignorés, pas effacés ».

- [ ] **Étape 9 : commit** — `chore: la dictee est retiree, ses reglages persistes sont ignores`

---

## Task 2 : `HostPlatform.isDesktopApp` et `HostNet`, les deux hôtes

**Files:**
- Modify: `src/host/types.ts` (interfaces `HostPlatform`, `Host` ; ajouter `HostNet`)
- Modify: `apps/obsidian/host.ts:611-625` (platform), + un bloc `net`
- Modify: `apps/windows/src/host/index.ts:88-100,127-137`
- Create: `apps/windows/src/host/net.ts`
- Create: `apps/windows/electron/reseau.ts`
- Modify: `apps/windows/electron/pont.ts`, `preload.ts`, `canaux.ts`
- Create: `scripts/check-electron-reseau.mjs`
- Modify: `scripts/check-obsidian-host.mjs`, `scripts/check-windows-host.mjs`, `scripts/check-lesson.mjs` (son faux hôte doit rester COMPLET face au contrat, sinon il meurt en silence), `package.json`, `docs/superpowers/notes/controles.md`

**Interfaces:**
- Produit, dans `src/host/types.ts` :

```ts
export interface HostPlatform {
	isMobile: boolean;
	isMacOS: boolean;
	isDesktopApp: boolean;
	uiLanguage: string;
}

export interface HostNetRequest {
	url: string;
	method?: "GET" | "POST";
	headers?: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
}
export interface HostNetResponse { status: number; body: string; }
export interface HostNet {
	/** `null` = échec RÉSEAU (hôte refusé, injoignable, annulé). Un statut
	    HTTP d'erreur n'est PAS un échec réseau : il est rendu avec son corps —
	    Ollama y met son diagnostic, et `requestUrl` le cachait. */
	fetchJson(req: HostNetRequest): Promise<HostNetResponse | null>;
}
```
Et `Host.net: HostNet`.

- Produit, dans `pont.ts` : `reseau: { fetch(req: HostNetRequest): Promise<HostNetResponse | null> }` — `signal` ne traverse pas l'IPC : le rendu passe un `requeteId: number` et un canal `reseau.annuler(requeteId)`.

- [ ] **Étape 1 : le contrat.** Les trois interfaces ci-dessus, avec les commentaires. `npm run check` rougit : les deux hôtes et le faux hôte de `check-lesson.mjs` ne les implémentent pas. C'est attendu.

- [ ] **Étape 2 : hôte Obsidian.** `isDesktopApp: Platform.isDesktopApp`. `net.fetchJson` par `requestUrl({ url, method, headers, body, throw: false })` → `{ status: resp.status, body: resp.text }` ; `null` si `requestUrl` lève. `signal` : `requestUrl` ne l'accepte pas — l'ignorer, et l'écrire (le greffon n'annulait pas ses appels `requestUrl` non plus).

- [ ] **Étape 3 : `apps/windows/electron/reseau.ts`, pur Node/Electron**

```ts
export const HOTES_AUTORISES = new Set(["localhost", "127.0.0.1", "ollama.com", "api.anthropic.com"]);
/** L'hôte d'`aiOllamaUrl`, lu des réglages par le principal, s'ajoute ici au
    démarrage — jamais depuis le rendu. */
export function autoriserHote(hote: string): void;
export function hoteAutorise(url: string): boolean;   // pur, éprouvable
export async function fetchBorne(req: HostNetRequest & { signal?: AbortSignal }): Promise<HostNetResponse | null>;
```
`fetchBorne` : `hoteAutorise` sinon `console.warn(LOG_PREFIX, "requête refusée, hôte hors liste:", url)` et `null` ; puis `net.fetch` d'Electron ; un statut non-2xx est RENDU avec son corps ; une exception réseau → `null`.

- [ ] **Étape 4 : le pont.** Canaux `reseau.fetch` et `reseau.annuler` dans `canaux.ts` (une `Map<number, AbortController>`), exposés par `preload.ts`, typés dans `pont.ts`. `apps/windows/src/host/net.ts` fabrique le `requeteId`, relaie `signal.abort` vers `reseau.annuler`.

- [ ] **Étape 5 : `scripts/check-electron-reseau.mjs`**, sur le module réel par `withSrcModule("apps/windows/electron/reseau.ts")`, avec un petit serveur `http` local sur un port libre :

| Cas | Rupture |
|---|---|
| un hôte hors liste rend `null` ET un `console.warn` | retirer la garde |
| `localhost` est accepté | vider la liste |
| `autoriserHote("mon-nas")` l'accepte ensuite | `autoriserHote` ne fait rien |
| un statut 500 est RENDU avec son corps (pas `null`) | traiter non-2xx comme échec |
| une annulation rend `null` sans lever | ne pas relayer le signal |

- [ ] **Étape 6 : les deux contrôles d'hôte** ajoutent `isDesktopApp` (vrai sous le faux Obsidian desktop, vrai dans l'app) et un cas `net` (le faux `window.neo` a un `reseau.fetch` qui journalise ; « un `fetchJson` traverse le pont avec l'URL intacte »). `check-lesson.mjs` : son faux hôte reçoit `net` et `isDesktopApp`, sinon il MEURT.

- [ ] **Étape 7 : contrôles** — `check`, `check:host` (13), `check:app`, `check:obsidian-host`, `check:windows-host`, `check:electron-reseau`, `check:lesson` (jusqu'au bout), `build`. `controles.md` : une entrée pour `check:electron-reseau` par le DÉFAUT (un rendu compromis fait de l'app un proxy).

- [ ] **Étape 8 : commit** — `feat(host): HostNet et isDesktopApp, tout HTTP part du principal`

---

## Task 3 : `ai-providers.ts` sur le contrat

**Files:**
- Modify: `src/dashboard/ai-providers.ts:1,225-260,730-760` (et les 8 `Platform.`)
- Modify: `scripts/check-host.mjs:33-46` (retirer la ligne)

**Interfaces:**
- Consomme : `currentHost().net.fetchJson`, `currentHost().platform.isDesktopApp`, `currentHost().fs.read` (cache Codex).
- Produit : les mêmes exports qu'aujourd'hui, signatures inchangées.

- [ ] **Étape 1 : mesurer.** `grep -n "Platform\.\|requestUrl\|require(" src/dashboard/ai-providers.ts` — chaque ligne est un appel à convertir. Les appelants des exports : `grep -rn "from \"./ai-providers\"" src/`.

- [ ] **Étape 2 : `fetchOllamaCloudCatalog`** (~736) : `requestUrl({url, throw:false})` → `host.net.fetchJson({ url: "https://ollama.com/search?c=cloud" })` ; `null` ou `status !== 200` → `throw` comme avant (le repli embarqué prend).

- [ ] **Étape 3 : le cache Codex** (`getCodexModels`, ~230) lit `~/.codex/models_cache.json` par `fs`/`os`/`path` de Node. Ce chemin est HORS des racines : `HostFs` ne l'atteint pas, et le rendu Electron n'a pas Node. **Décision** : la lecture d'un cache de CLI est une responsabilité de `HostProcess`, dont la signature s'ajoute au contrat DANS CETTE TÂCHE (l'implémentation de `run` attend la tâche 7) :

```ts
export interface HostProcess {
	run(spec: { tool: "claude" | "codex"; args: string[]; stdin: string; signal?: AbortSignal })
		: Promise<{ stdout: string; stderr: string; code: number | null }>;
	/** Les modèles que le CLI connaît, lus de SON cache (Codex :
	    `~/.codex/models_cache.json` ou `$CODEX_HOME`). `null` = pas de cache. */
	modeles(tool: "claude" | "codex"): Promise<string[] | null>;
}
```
L'hôte Obsidian implémente `modeles` avec le code actuel de `ai-providers.ts` (déplacé, pas réécrit) et `run` par un rejet provisoire (remplacé à la tâche 4). L'app implémente `modeles` dans le principal (Node, chemin FIXE hors périmètre : c'est du principal, pas du rendu) et `run` par un REJET `name === "indisponible"` jusqu'à la tâche 7. Le faux hôte de `check-lesson.mjs` reçoit les deux. `getCodexModels` appelle `host.process.modeles("codex")` et rend le repli embarqué sur `null`.

- [ ] **Étape 4 : les 8 `Platform.`** → `host.platform.isDesktopApp` / `isMacOS`.

- [ ] **Étape 5 : contrôles** — `check`, `check:host` (**12**), `check:app`, `check:obsidian-host`, `check:windows-host`, `check:lesson`, `build`. Puis à l'écran sous Obsidian : les réglages IA listent toujours les modèles Codex et le catalogue Ollama cloud.

- [ ] **Étape 6 : commit** — `refactor(ai): les fournisseurs lisent leurs modeles par le contrat`

---

## Task 4 : `ai-client.ts`, Ollama par `HostNet`, les CLI par `HostProcess`

**Files:**
- Modify: `src/dashboard/ai-client.ts` (entier), `src/dashboard/ai.ts:1923` (un argument)
- Create: `src/dashboard/ai-settings-host.ts`
- Modify: `apps/obsidian/host.ts` (`process.run` reçoit le code de `callClaude`/`callCodex` : spawn, stdin, taskkill), `apps/windows/src/host/index.ts` (`process` = rejet nommé), `scripts/check-host.mjs`, `scripts/check-obsidian-host.mjs`

**Interfaces:**
- Produit : `createAiClient(settings: AiSettingsHost): AiClient` avec

```ts
export interface AiSettingsHost {
	get(): AiSettings;
	save(patch: Partial<AiSettings>): Promise<void>;
}
```
Sous Obsidian : `{ get: () => plugin.settings, save: async p => { Object.assign(plugin.settings, p); await plugin.saveSettings(); } }`.

- [ ] **Étape 1 : `AiSettingsHost`** dans son fichier ; `ai.ts:1923` passe l'adaptateur Obsidian (temporaire, `ai.ts` est encore lié).

- [ ] **Étape 2 : Ollama.** Les deux `fetch(` (~597, ~666) → `host.net.fetchJson`. Le corps d'erreur est rendu : la logique `userError` de ~648 se garde telle quelle sur `resp.body`. `null` → l'erreur « Impossible de contacter Ollama » existante.

- [ ] **Étape 3 : Claude et Codex.** `callClaude` (~276-350) et `callCodex` (~429-500) ne gardent que la CONSTRUCTION des `args` et le PARSING de la sortie ; le spawn, le `stdin.write/end`, la lecture de stdout/stderr et le `taskkill` déménagent dans `apps/obsidian/host.ts` sous `process.run`, ligne pour ligne. `abort()` : `AbortController` dont le `signal` passe à `run`.

- [ ] **Étape 4 : l'app.** `apps/windows/src/host/index.ts` : `process: { run: () => Promise.reject(Object.assign(new Error("indisponible"), { name: "indisponible" })), modeles: pont().process.modeles }`. `ai-client.ts` traduit `name === "indisponible"` en `userError(t("ai.error.providerUnavailable"))` — clé neuve, EN + FR.

- [ ] **Étape 5 : `check-obsidian-host.mjs`**, groupe neuf « process » avec un faux `child_process` : « `run` écrit le stdin complet puis le ferme » ; « stdout et stderr sont rendus SÉPARÉS » ; « `abort` lance `taskkill /pid <pid> /T /F` sous Windows » (rupture : `/T` retiré) ; « un rejet `annule` après abort ». `check-windows-host.mjs` : « `run` rejette `indisponible` ».

- [ ] **Étape 6 : contrôles** — `check`, `check:host` (**11**), `check:app`, les deux hôtes, `check:lesson`, `build`. À L'ÉCRAN, SOUS OBSIDIAN : les trois fournisseurs génèrent comme avant (c'est la non-régression, et le greffon est le seul hôte qui a déjà une page « Générer »). L'Ollama dans l'app se prouve à la tâche 6, quand la page existe.

- [ ] **Étape 7 : commit** — `refactor(ai): le client parle a Ollama par HostNet et aux CLI par HostProcess`

---

## Task 5 : le sélecteur « @ » sur le contrat

**Files:**
- Modify: `src/dashboard/file-sources.ts`, `mention-picker.ts`, `prompt-paths.ts`
- Create: `src/text-search.ts`, `scripts/check-text-search.mjs`
- Modify: `scripts/check-host.mjs`, `package.json`, `controles.md`

**Interfaces:**
- Consomme : `host.fs.listMarkdown/findByName/getFile/read`, `host.links.resolve`, `host.platform.isDesktopApp`, `host.ui.notice`.
- Produit : `fuzzyMatch(query: string): (text: string) => { score: number } | null` dans `src/text-search.ts`, mêmes exports qu'aujourd'hui dans les trois fichiers.

- [ ] **Étape 1 : `src/text-search.ts`.** Sous-séquence avec bonus de début de mot et de contiguïté, score négatif croissant comme `prepareFuzzySearch` (plus proche de 0 = meilleur). Cas de `check-text-search.mjs` tirés d'observations d'Obsidian : « `cs` trouve `Cours/ch1.md` » ; « `xyz` ne trouve rien » ; « un début de mot bat une sous-séquence éparse » ; « la casse est ignorée ». Ruptures : retirer le bonus de début de mot ; comparer en sensible à la casse.

- [ ] **Étape 2 : `file-sources.ts:247`** `prepareFuzzySearch(query)` → `fuzzyMatch(query)`. Les `app.vault.getMarkdownFiles()` → `host.fs.listMarkdown()` ; `TFolder`/`TAbstractFile` → `HostFile` et `host.paths`. Les 6 `Platform.isDesktopApp` → `host.platform`.

- [ ] **Étape 3 : `mention-picker.ts`, `prompt-paths.ts`** : `Notice` → `host.ui.notice`, `app.vault` → `host.fs`, `TFile` → `HostFile`.

- [ ] **Étape 4 : contrôles** — `check`, `check:host` (**8**), `check:text-search`, `check:app`, `check:dashboard-dom` (les trois fichiers y ENTRENT : leurs extensions DOM d'Obsidian deviennent interdites), `build`. À l'écran sous Obsidian : « @ » liste et attache un fichier ; un chemin tapé dans le composer est résolu ; un chemin introuvable donne une Notice.

- [ ] **Étape 5 : commit** — `refactor(ai): le selecteur @ passe par le contrat, recherche floue partagee`

---

## Task 6 : la page « Générer »

**Files:**
- Modify: `src/dashboard/ai.ts` (entier), `src/dashboard/usage-modal.ts`
- Modify: `apps/windows/src/ui/dashboard-shell.ts:183,300-330`, `apps/windows/src/main.ts` (fabrique l'`AiSettingsHost` sur `neo.reglages` clé `ai`)
- Modify: `apps/obsidian/plugin.ts` (fabrique l'`AiSettingsHost`), `src/dashboard.ts`, `src/types/dashboard-ctx.ts` (`plugin` sort du contrat de `createAiHandlers`)
- Modify: `scripts/check-host.mjs`, `scripts/check-dashboard-dom.mjs`

**Interfaces:**
- Consomme : tout ce qui précède, plus `host.ui.setIcon`, `host.ui.notice`, le rendu markdown partagé (`src/engine/sanitizer.ts`, `renderInlineText`).
- Produit : `createAiHandlers(deps: { settings: AiSettingsHost; host: Host; navigate; openQuiz; … })`.

- [ ] **Étape 1 : mesurer les 32 `ctx.plugin.settings.*` et 6 `saveSettings`** ; chaque lecture → `deps.settings.get().x`, chaque écriture → `deps.settings.save({ x })`.

- [ ] **Étape 2 : `setIcon` (19)** → `host.ui.setIcon` ; **`Notice` (16)** → `host.ui.notice` ; **`MarkdownRenderer` (2)** → `renderInlineText` du sanitizer (les deux appels rendent un énoncé court ; vérifier qu'aucun ne rend un bloc) ; **`app.vault`/`app.workspace`** → `host.fs`/le `navigate` de `deps` ; **`TFile`** → `HostFile`.

- [ ] **Étape 3 : les PDF (`loadPdfJs`, 4 appels).** TRANCHÉ : l'application REFUSE un PDF attaché avec la Notice `t("ai.error.pdfUnsupportedInApp")` (clé neuve) ; le greffon garde `loadPdfJs` derrière un membre `HostPdf?: { extractText(file: HostFile): Promise<string> }` OPTIONNEL du contrat, absent dans l'app. Un membre optionnel est une divergence ÉCRITE. Une tranche future peut l'implémenter côté app avec pdf.js sans toucher `ai.ts`.

- [ ] **Étape 4 : la coquille.** `dashboard-shell.ts:183` `canOpen: () => true` ; le routeur monte `createAiHandlers` sur `"ai"`. `apps/windows/src/main.ts` construit `settings: { get: () => cache, save: async p => { Object.assign(cache, p); await pont().reglages.ecrire("ai", cache); } }`, `cache` hydraté par `reglages.lire("ai")` au démarrage.

- [ ] **Étape 5 : `usage-modal.ts`** : `setIcon` → `host.ui.setIcon`, `plugin.settings` → `deps.settings`.

- [ ] **Étape 6 : contrôles** — `check`, `check:host` (**6**), `check:app`, `check:dashboard-dom` (`ai.ts` et `usage-modal.ts` y entrent), `check:md`, `check:markers`, `check:lesson`, `build`, `app:build`. **À L'ÉCRAN, dans l'app** : la page « Générer » s'ouvre depuis le rail et l'accueil ; **une génération Ollama aboutit**, avec un fichier attaché par « @ » ; le quiz s'enregistre dans le dossier choisi et se relit ; Claude et Codex affichent « fournisseur indisponible » proprement. Sous Obsidian : les trois fournisseurs comme avant.

- [ ] **Étape 7 : commit** — `feat(app): la page Generer, Ollama genere dans l'application`

---

## Task 7 : `HostProcess` dans le principal

**Files:**
- Create: `apps/windows/electron/process.ts`, `scripts/check-electron-process.mjs`
- Modify: `apps/windows/electron/{pont,preload,canaux,reglages}.ts`, `apps/windows/src/host/index.ts` (le rejet devient le passe-plat), `apps/windows/src/host/process.ts` (créé), `apps/windows/src/ui/settings.ts` (deux champs « chemin de l'exécutable »), `package.json`, `controles.md`, `scripts/check-windows-host.mjs`

**Interfaces:**
- Produit : `process.run` et `process.modeles` réels dans l'app. Réglages `ai.cheminClaude`, `ai.cheminCodex` (chaînes, vides par défaut).

- [ ] **Étape 1 : `process.ts`, pur Node**

```ts
export const OUTILS = { claude: "claude", codex: "codex" } as const;
export function resoudreExecutable(tool: keyof typeof OUTILS, cheminRegle: string | undefined, env: NodeJS.ProcessEnv): string | null;  // pur : réglage rempli → lui ; sinon recherche dans env.PATH (+ PATHEXT sous Windows) ; null sinon
export function lancer(spec: { executable: string; args: string[]; stdin: string; signal?: AbortSignal }): Promise<{ stdout: string; stderr: string; code: number | null }>;
export function tuerArbre(pid: number): void;  // Windows : taskkill /pid <pid> /T /F ; sinon process.kill(-pid) avec detached: true
export async function modeles(tool, env): Promise<string[] | null>;  // Codex : ~/.codex/models_cache.json ou $CODEX_HOME — code déplacé de l'ancien ai-client
```
`lancer` : `spawn(executable, args, { windowsHide: true, detached: process.platform !== "win32" })`, `stdin.write(spec.stdin); stdin.end()`, stdout/stderr accumulés, résolution à `close`. `signal.abort` → `tuerArbre` puis rejet `name === "annule"`. Un seul `run` par outil à la fois : le second rejette `name === "occupe"`.

- [ ] **Étape 2 : les canaux.** `process.run(spec)` avec `requeteId` et `process.annuler(requeteId)` (le `signal` ne traverse pas l'IPC, comme au réseau) ; `process.modeles(tool)`. Le canal REFUSE tout `tool` hors de `OUTILS` (`name === "refuse"`, loggé). `resoudreExecutable` reçoit `reglages.lire("ai")?.cheminClaude|cheminCodex`.

- [ ] **Étape 3 : `check-electron-process.mjs`**, sur le module réel, avec de VRAIS process :

| Cas | Rupture |
|---|---|
| un nom hors liste est refusé (par `resoudreExecutable(null)`) | accepter tout nom |
| le réglage « chemin » l'emporte sur le PATH | inverser l'ordre |
| stdin est écrit en entier puis fermé (`cmd /c more` ou `node -e` qui relit stdin) | ne pas fermer stdin |
| stdout et stderr sont séparés (`node -e "console.log(1);console.error(2)"`) | les concaténer |
| le code de sortie est rendu (`node -e "process.exit(3)"`) | rendre 0 |
| **l'annulation tue l'arbre** : `node -e` qui `spawn` un enfant écrivant un fichier après 2 s ; abort à 200 ms ; le fichier n'existe pas à 3 s | `tuerArbre` sans `/T` |
| deux `run` simultanés du même outil → `occupe` | retirer le verrou |

- [ ] **Étape 4 : les réglages de l'app.** Deux champs texte « Chemin de `claude` » / « Chemin de `codex` » dans `settings.ts`, clés `ai.cheminClaude`/`ai.cheminCodex`, avec le texte d'aide `t("settings.ai.cliPath.desc")` (clé neuve : « une application installée démarre avec le PATH système, pas celui de votre terminal »).

- [ ] **Étape 5 : contrôles** — `check`, `check:host` (6, inchangé), `check:app`, `check:electron-process`, `check:windows-host` (« `run` traverse le pont avec le nom, jamais un chemin »), `build`, `app:build`. **À L'ÉCRAN, dans l'app** : une génération Claude Code et une Codex aboutissent ; l'annulation en cours laisse le Gestionnaire des tâches SANS process `claude`/`codex`/`node` orphelin ; un nom d'exécutable faux dans le réglage donne la Notice « CLI introuvable ».

- [ ] **Étape 6 : commit** — `feat(electron): les CLI par nom, l'arbre tue a l'annulation`

---

## Task 8 : `ai-usage.ts`

**Files:**
- Modify: `src/dashboard/ai-usage.ts:1-2,318-330` (+ les 2 `Platform.`, 3 `plugin.settings`)
- Modify: `scripts/check-host.mjs`

**Interfaces:**
- Consomme : `host.net.fetchJson` (`api.anthropic.com`).
- Produit : `HostProcess.jeton(tool: "claude"): Promise<string | null>`. Le jeton OAuth du CLI est lu sur disque (`~/.claude/…`), HORS périmètre, comme le cache Codex : même voie, `HostProcess`, implémentée par les deux hôtes avec le code actuel déplacé. **Le jeton NE TRAVERSE JAMAIS le pont** : le rendu envoie `headers.Authorization = "@jeton:claude"`, un marqueur que le principal remplace lui-même dans `fetchBorne`. Un rendu compromis ne lit jamais le secret.

- [ ] **Étape 1 :** `HostProcess.jeton` au contrat ; hôte Obsidian avec le code actuel de lecture ; principal Electron idem ; le marqueur `@jeton:claude` remplacé dans `fetchBorne` de `reseau.ts`, et REFUSÉ si l'hôte n'est pas `api.anthropic.com` (cas de contrôle dans `check-electron-reseau.mjs` : « le marqueur de jeton n'est remplacé que vers api.anthropic.com »).

- [ ] **Étape 2 :** `requestUrl` (4) → `host.net.fetchJson`, `Platform` → `host.platform`, `plugin.settings` → `deps.settings`.

- [ ] **Étape 3 : contrôles** — `check`, `check:host` (**5**), `check:app`, `check:electron-reseau`, les deux hôtes, `build`. À l'écran, dans l'app : la modale d'usage affiche les compteurs Claude.

- [ ] **Étape 4 : commit** — `refactor(ai): le suivi d'usage par le contrat, le jeton ne traverse jamais le pont`

---

## Ce que ce plan ne fait pas, volontairement

- Il ne signe pas l'installeur, ne touche pas à la CI Linux.
- Il ne porte pas le partage (`share.ts`).
- Il n'implémente pas les PDF dans l'app (membre optionnel `HostPdf`, absent).
- Il n'ajoute aucun fournisseur.
- Il ne fait pas de streaming.

## Vérification finale, à l'écran, par Ahmed

Une génération par fournisseur depuis la page « Générer » de l'application, avec un fichier attaché par « @ » : le quiz apparaît, s'enregistre, se relit. Une annulation ne laisse aucun process orphelin. Sous Obsidian, rien n'a changé.
