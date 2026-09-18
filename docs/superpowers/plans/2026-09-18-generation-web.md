# Générer par un site (claude.ai) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis la page « Générer », un clic sur « Ouvrir » avec le canal claude.ai lance le site avec la question déjà écrite ; l'utilisateur envoie, copie la réponse, et l'application crée le quiz toute seule dès que la réponse est dans le presse-papier.

**Architecture:** Le prompt part par l'adresse (`claude.ai/new?q=`) ou, au-delà d'une borne mesurée, par le presse-papier. La réponse est demandée dans un bloc de code ouvert par un jeton tiré à l'ouverture ; le processus principal Electron sonde le presse-papier pendant l'attente et ne livre au rendu que le texte qui porte ce jeton. Le rendu passe alors par le parseur de réponse existant et la même suite qu'une génération. Le collage manuel (Ctrl+V) reste un second chemin.

**Tech Stack:** TypeScript strict (ESM), Electron (principal + preload + rendu Vite), scripts de contrôle `node scripts/*.mjs` chargeant le code réel par `withSrcModule`, i18n typée `t("<domaine>.<clé>")`.

**Spec:** `docs/superpowers/specs/2026-09-18-generation-web-design.md` — lire la spec AVANT chaque tâche ; le plan argue depuis elle.

## Global Constraints

- **Le moins de gestes possible** : le parcours cible est Ouvrir, Envoyer (sur le site), Copier (sur le site). Aucune confirmation dans l'application, aucun écran de plus. Tout geste ajouté doit être justifié dans le commit.
- **Jamais de chaîne visible en dur** : tout texte d'interface passe par `t("ai.<clé>")`, ajouté dans `src/i18n/en/ai.ts` (référence) ET `src/i18n/fr/ai.ts` (typé sur EN : une clé oubliée en FR est une erreur de compilation). Les prompts adressés au MODÈLE restent en anglais et en dur, comme les prompts existants.
- **Commentaires en français** dans le code, au style du dépôt (le POURQUOI, avec la date et le fait qui l'a décidé).
- **Pas d'em-dash ni d'emoji** dans le texte destiné à l'utilisateur ni dans les messages de commit.
- **Le rendu n'importe jamais un module qui tire Node** (`node:*`, `electron`, `chokidar`) : `npm run check:host` le refuse. Le principal (`apps/windows/electron/`) est le seul à toucher `electron`.
- **Le rendu ne lit jamais le presse-papier** : `clipboard-read` reste refusé à la page. Seul le principal lit, et seulement pendant une attente ouverte par l'utilisateur, avec le jeton.
- **Un script se juge sur son CODE DE SORTIE**, jamais sur la fin de sa sortie. Chaque cas nouveau d'un contrôle s'éprouve par DISCRIMINANCE : casser la règle, voir rougir, restaurer. Un cas vert quoi qu'on fasse ne prouve rien.
- **Vérification d'un changement** : `npm run check` (typecheck) après toute modification TS ; `npm run check:app` dès que le code partagé bouge ; `npm run check:host` dès qu'un import change.
- **Commits** : un par tâche, message en français, terminé par la ligne `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Ne jamais amender un commit existant.
- **Seul claude.ai est câblé** : `chatgpt-web` et `perplexity-web` gardent la notice `ai.channel.notWiredYet`.

---

### Task 0: Commiter le design validé

Le menu à deux niveaux, le contrôle « Claude · claude.ai » et le bouton « Ouvrir » sont dans le working tree, validés à l'écran le 2026-09-18, non commités.

**Files:**
- Modify (déjà modifiés, à commiter tels quels) : `src/dashboard/ai-providers.ts`, `src/dashboard/ai.ts`, `src/dashboard/ui-select.ts`, `src/assets/css/components/ui-select.css`, `src/assets/css/dashboard/dashboard-ai.css`, `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts`

- [ ] **Step 1: Vérifier que l'état est vert**

Run: `npm run check && npm run check:host && npm run check:ai-providers && npm run check:app`
Expected: chaque commande sort en 0.

- [ ] **Step 2: Commiter**

```bash
git add src/dashboard/ai-providers.ts src/dashboard/ai.ts src/dashboard/ui-select.ts src/assets/css/components/ui-select.css src/assets/css/dashboard/dashboard-ai.css src/i18n/en/ai.ts src/i18n/fr/ai.ts
git commit -m "$(cat <<'EOF'
Le menu des fournisseurs a deux niveaux : la marque, puis le canal

Quatre marques (Claude, ChatGPT, Perplexity, Ollama) ; Claude et ChatGPT
ouvrent un flyout avec leurs deux canaux (le CLI sur la machine, le site
dans le navigateur), les deux autres se choisissent d'un clic. La marque
en usage se reconnaît à son chevron passé à l'accent (une coche collée au
chevron faisait deux glyphes au même endroit, vu à l'écran le 2026-09-18) ;
une marque à canal unique garde sa coche. Sur un canal web, le contrôle du
milieu dit « Claude · claude.ai » et le bouton d'envoi devient « Ouvrir ».
Apparence seulement : le clic affiche « aperçu du design », le câblage
vient avec la spec du 2026-09-18.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1: Mesurer la borne d'URL et la poser dans `ai-web.ts`

La spec §0 : le serveur accepte 64 Ko, mais `shell.openExternal` passe l'URL au navigateur par la ligne de commande Windows (`ShellExecute`, `CreateProcess` borné à 32 767 caractères). La borne effective est le minimum, à MESURER, pas à supposer.

**Files:**
- Create: `scripts/report-url-max.ps1`
- Create: `src/dashboard/ai-web.ts` (seulement `URL_MAX` pour l'instant ; la tâche 3 y ajoute les fonctions)
- Modify: `package.json` (script `report:url-max`)

**Interfaces:**
- Produces: `export const URL_MAX: number` dans `src/dashboard/ai-web.ts`, lu par la tâche 3.

- [ ] **Step 1: Écrire le script de mesure**

`Start-Process "<url>"` est `ShellExecuteEx`, le même appel que `shell.openExternal` d'Electron sous Windows. Une URL trop longue fait LEVER `Start-Process` (nom de fichier ou extension trop long) ; une URL admise ouvre un onglet. On mesure sur `https://example.com/` pour ne pas ouvrir des onglets claude.ai à chaque essai, la longueur admise ne dépendant pas du domaine. Dichotomie entre 8 000 et 70 000, environ sept essais, dont trois ou quatre ouvrent un onglet `example.com`.

```powershell
# scripts/report-url-max.ps1
# MESURE (ne vérifie rien) : la plus longue URL que ShellExecute accepte
# de passer au navigateur par défaut. C'est le chemin de shell.openExternal
# (Electron, Windows), donc la borne de « ouvrir claude.ai avec la question
# dans l'adresse ». Voir la spec 2026-09-18-generation-web-design.md, §0.
#
#     npm run report:url-max
#
# Ouvre quelques onglets https://example.com/ (les essais admis) : c'est le
# prix de la mesure, et example.com ne fait rien de ce qu'on lui envoie.
$ErrorActionPreference = "Stop"
$base = "https://example.com/?q="
function Essai([int]$longueur) {
    $q = "a" * ($longueur - $base.Length)
    try { Start-Process ($base + $q); return $true } catch { return $false }
}
$bas = 8000; $haut = 70000
if (-not (Essai $bas)) { Write-Output "Même $bas caractères sont refusés : mesure impossible"; exit 0 }
if (Essai $haut) { Write-Output "$haut caractères passent : la borne est au-delà de la plage mesurée"; exit 0 }
while ($haut - $bas -gt 64) {
    $milieu = [int](($bas + $haut) / 2)
    if (Essai $milieu) { $bas = $milieu } else { $haut = $milieu }
    Start-Sleep -Milliseconds 300
}
Write-Output "Plus longue URL admise par ShellExecute : entre $bas et $haut caractères"
```

- [ ] **Step 2: Enregistrer le script dans `package.json`**

Dans `"scripts"`, à côté de `"report:multiblock"` :

```json
"report:url-max": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/report-url-max.ps1",
```

- [ ] **Step 3: Lancer la mesure**

Run: `npm run report:url-max`
Expected: une ligne « Plus longue URL admise par ShellExecute : entre N et M caractères ». Noter N. Attendu autour de 32 000 ; si le résultat est au-delà de 66 000, la borne serveur (65 555 octets de requête) l'emporte et `URL_MAX` vaut 64 000.

- [ ] **Step 4: Confirmer sur claude.ai, une fois, à l'œil**

Ouvrir dans le navigateur `https://claude.ai/new?q=` suivi d'un texte réaliste (des phrases, pas des « a ») d'une longueur encodée proche de N (par exemple `texte.length * 1.34` pour de l'ASCII avec espaces). Vérifier que le champ est rempli jusqu'au bout. Si le champ reste vide ou tronqué à cette taille, réduire N jusqu'à ce qu'il se remplisse, et noter la valeur.

- [ ] **Step 5: Poser la constante**

```ts
// src/dashboard/ai-web.ts
/* ══════════════════════════════════════════════════════════
   LE CANAL WEB — ce qui part à un site et comment il s'ouvre.
   Fonctions PURES : pas d'hôte, pas de DOM. Le câblage (ouvrir, copier,
   attendre) est dans ai.ts et dans le contrat d'hôte.
   Spec : docs/superpowers/specs/2026-09-18-generation-web-design.md
══════════════════════════════════════════════════════════ */

/** La plus longue URL qu'on ose passer au navigateur.
    MESURÉE le 2026-09-18 par `npm run report:url-max` : ShellExecute admet
    <N> caractères sur cette machine (le serveur de claude.ai en accepte
    65 555, la ligne de commande Windows est la borne qui compte). Posée
    avec une marge : le navigateur ajoute ses propres arguments devant
    l'URL. Au-delà, le texte part par le presse-papier (`preparerOuverture`). */
export const URL_MAX = <N arrondi à la centaine inférieure, moins 1000>;
```

Remplacer `<N>` par la valeur mesurée (dans le commentaire) et la constante par `N` arrondi à la centaine inférieure moins 1 000 de marge (par exemple, N = 32 650 donne `31600`).

- [ ] **Step 6: Typecheck et commit**

Run: `npm run check`
Expected: sortie 0.

```bash
git add scripts/report-url-max.ps1 src/dashboard/ai-web.ts package.json
git commit -m "$(cat <<'EOF'
La borne d'URL du canal web est mesurée, pas supposée

scripts/report-url-max.ps1 cherche par dichotomie la plus longue adresse
que ShellExecute (le chemin de shell.openExternal sous Windows) accepte de
passer au navigateur : <N> caractères le 2026-09-18. URL_MAX la porte avec
une marge dans src/dashboard/ai-web.ts ; au-delà, le texte partira par le
presse-papier.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Sortir l'assemblage du prompt et le parseur de réponse de la closure

Spec §2 et §5. `generateInner` (`src/dashboard/ai-client.ts`) assemble `systemPrompt` et `userPrompt` dans la closure de `createAiClient`, et `parseQuizResponse`, `parseOllamaResponse`, `repairLatexBackslashes`, `nonQuizResponseError` y vivent aussi. La page a besoin des deux premiers pour un canal web ; on les sort SANS changer un caractère de ce qu'ils produisent.

**Files:**
- Modify: `src/dashboard/ai-client.ts` (fonctions `generateInner` ~l.303-395, `repairLatexBackslashes` ~l.900, `parseOllamaResponse` ~l.923, `parseQuizResponse` ~l.954, `nonQuizResponseError` ~l.995 ; les numéros de ligne datent du 2026-09-18, chercher par nom)
- Create: `scripts/check-web-channel.mjs`
- Modify: `package.json` (script `check:web-channel`)

**Interfaces:**
- Produces (exportés de `src/dashboard/ai-client.ts`) :
  - `export const PHRASE_FINALE_CLI = "Reply ONLY with the JSON5 array, with no explanation and no formatting."`
  - `export function composerPrompts(prompt: string, options: GenerateOptions): { systemPrompt: string; userPrompt: string }`
  - `export function parseReponseQuiz(content: string): unknown[]`
- `GenerateOptions` existe déjà (`count?`, `type?`, `source?`, `images?`).

- [ ] **Step 1: Écrire le contrôle qui échoue**

```js
// scripts/check-web-channel.mjs
/**
 * LE CANAL WEB — ce qui part à un site, et comment une réponse copiée
 * redevient un quiz. Trois fonctions pures, chargées depuis le CODE RÉEL :
 *
 * — `composerPrompts` est l'assemblage que les CLI recevaient DANS la closure
 *   de `createAiClient` ; sorti pour que la page le réutilise, il doit produire
 *   les MÊMES chaînes (nombre, type, source) — sinon un site et un CLI ne
 *   demanderaient pas le même quiz ;
 * — `parseReponseQuiz` lit une réponse copiée : fence, prose autour, LaTeX à
 *   backslash simple, et distingue « pas un quiz » de « quiz mal formé » ;
 * — (tâche 3) `texteWeb`, `preparerOuverture`, `nouveauJeton`, `estCanalCable`.
 *
 *     npm run check:web-channel
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule(["src/host/current.ts", "src/dashboard/ai-client.ts"], async (_current, client) => {
	const r = makeReporter("Canal web — prompts et parseur");

	/* ── composerPrompts : les mêmes chaînes que le CLI ── */
	{
		const p = client.composerPrompts("Le droit constitutionnel", { count: 7, type: "Choix unique", source: "text" });
		r.check("le prompt système porte le nombre demandé", p.systemPrompt.includes("Generate exactly 7 quiz questions"), true);
		r.check("le prompt système porte le type demandé", p.systemPrompt.includes("single-choice questions (exactly one correct answer)"), true);
		r.check("le prompt système se termine par la phrase finale du CLI", p.systemPrompt.trimEnd().endsWith(client.PHRASE_FINALE_CLI), true);
		r.check("une source « text » ouvre le prompt utilisateur sur le texte fourni",
			p.userPrompt.startsWith("Generate a quiz based on the following text"), true);
		r.check("la demande est dans le prompt utilisateur", p.userPrompt.includes("Le droit constitutionnel"), true);
		const d = client.composerPrompts("x", {});
		r.check("sans options : 5 questions, mixte, sujet", [
			d.systemPrompt.includes("Generate exactly 5 quiz questions"),
			d.systemPrompt.includes("a mix of single-choice, multiple-choice and free-text questions"),
			d.userPrompt.startsWith("Generate a quiz about the following topic"),
		], [true, true, true]);
	}

	/* ── parseReponseQuiz : une réponse copiée, dans tous ses états ── */
	{
		const brut = `[{ title: "Q1", prompt: "Combien font 2+2 ?", options: ["3", "4"], correctIndex: 1 }]`;
		r.check("un tableau nu", client.parseReponseQuiz(brut).length, 1);
		const fence = "Voici le quiz demandé :\n\n```json5\n// neo-quiz k7f2q9abcd\n" + brut + "\n```\n\nBon courage !";
		r.check("un tableau dans une fence, avec de la prose autour et le commentaire du jeton",
			client.parseReponseQuiz(fence).length, 1);
		const latex = `[{ title: "F", prompt: "Simplifie $\\frac{2}{4}$", type: "text", answer: "$\\frac{1}{2}$" }]`;
		/* Le modèle écrit `$\frac$` (un backslash) ; la réparation le double dans
		   le SOURCE, et JSON5 rend un seul backslash dans la VALEUR. */
		r.check("le LaTeX à backslash simple est réparé, pas détruit",
			client.parseReponseQuiz(latex)[0].answer, "$\\frac{1}{2}$");
		let e1 = null;
		try { client.parseReponseQuiz("Je ne peux pas générer de quiz sur ce sujet."); } catch (e) { e1 = e.message; }
		r.check("une phrase sans quiz : erreur « pas un quiz », avec l'aperçu", typeof e1 === "string" && e1.includes("Je ne peux pas"), true);
		let e2 = null;
		try { client.parseReponseQuiz(`[{ title: "Q", prompt: "P", options: ["a", "b"], correctIndex: 1 `); } catch (e) { e2 = e.message; }
		r.check("un quiz mal formé garde l'erreur du parseur (position), pas « pas un quiz »",
			typeof e2 === "string" && !e2.includes("title") && /\d+:\d+|JSON5/.test(e2), true);
	}

	r.done();
});
```

Ajouter dans `package.json`, à côté de `"check:ai-providers"` :

```json
"check:web-channel": "node scripts/check-web-channel.mjs",
```

- [ ] **Step 2: Le lancer, le voir échouer**

Run: `npm run check:web-channel`
Expected: échec (sortie 1) : `client.composerPrompts is not a function` ou équivalent.

- [ ] **Step 3: Sortir les fonctions de la closure**

Dans `src/dashboard/ai-client.ts` :

1. Déplacer `repairLatexBackslashes`, `nonQuizResponseError`, `parseQuizResponse` (renommée `parseReponseQuiz`, exportée) et `parseOllamaResponse` **au niveau du module**, avant `export function createAiClient`. Leur corps ne change pas ; `parseOllamaResponse` appelle désormais `parseReponseQuiz` dans son `catch`. Les appels internes (`callClaudeCode`, `callCodex`, `callOllama`) restent tels quels, en changeant seulement le nom `parseQuizResponse` → `parseReponseQuiz`. Garder leurs commentaires avec eux.

2. Extraire l'assemblage : dans `generateInner`, tout ce qui va de `const typeInstruction = ...` à la fin de `const userPrompt = ...` devient :

```ts
/** La phrase qui clôt le prompt système d'un CLI. EXPORTÉE parce que le
    canal web la remplace par sa consigne de forme (`texteWeb`, ai-web.ts) :
    une copie divergerait en silence. */
export const PHRASE_FINALE_CLI = "Reply ONLY with the JSON5 array, with no explanation and no formatting.";

/**
 * Les deux prompts d'une génération, PURS : le même texte pour un CLI, pour
 * Ollama et pour un site. Sortis de `generateInner` le 2026-09-18 pour que
 * la page « Générer » les compose elle-même quand le canal est un site.
 * ANGLAIS, et INDÉPENDANTS de la langue de l'UI (voir la règle LANGUAGE dans
 * le prompt) ; `type` est la VALEUR canonique (cf. TYPE_VALUES dans ai.ts).
 */
export function composerPrompts(prompt: string, options: GenerateOptions = {}): { systemPrompt: string; userPrompt: string } {
	const { count = 5, type = "Mixte", source = "topic" } = options;
	const typeInstruction = /* ... le bloc existant, inchangé ... */;
	const systemPrompt = `/* ... le template existant, inchangé, jusqu'à : */
	Generate ${typeInstruction}. ${PHRASE_FINALE_CLI}`;
	const userPrompt = /* ... les trois branches existantes, inchangées ... */;
	return { systemPrompt, userPrompt };
}
```

et `generateInner` devient :

```ts
const { images = [] } = options;
lastRequestText = prompt;
const provider = /* ... inchangé ... */;
/* ... résolution du modèle, inchangée ... */
const { systemPrompt, userPrompt } = composerPrompts(prompt, options);
if (provider === "ollama") { /* inchangé */ }
```

Attention : la dernière ligne du template était `Generate ${typeInstruction}. Reply ONLY with the JSON5 array, with no explanation and no formatting.` ; elle devient `Generate ${typeInstruction}. ${PHRASE_FINALE_CLI}` : même texte, une source.

- [ ] **Step 4: Le lancer, le voir passer, et vérifier le reste**

Run: `npm run check:web-channel && npm run check && npm run check:ai-providers && npm run check:app`
Expected: chaque commande sort en 0. `check:web-channel` : « Canal web — prompts et parseur : 11/11 cas passent ».

- [ ] **Step 5: Discriminance**

Changer `PHRASE_FINALE_CLI` en `"Reply with the array."` : `check:web-channel` doit rougir sur « se termine par la phrase finale » ET « le prompt système porte… » reste vert (c'est le bon cas qui tombe). Restaurer. Retirer `repairLatexBackslashes(cleaned)` de `parseReponseQuiz` : le cas LaTeX doit rougir. Restaurer.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/ai-client.ts scripts/check-web-channel.mjs package.json
git commit -m "$(cat <<'EOF'
Les prompts et le parseur de réponse sortent de la closure du client IA

composerPrompts assemble les deux prompts, parseReponseQuiz lit une réponse
(fence, prose, LaTeX réparé, « pas un quiz » distingué de « mal formé ») :
deux fonctions pures et exportées, pour que la page les réutilise quand le
canal est un site. Le texte des CLI ne change pas d'un caractère ;
PHRASE_FINALE_CLI en est la preuve et la source unique. check:web-channel
les éprouve depuis le code réel.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `ai-web.ts` : le texte d'un site, le jeton, l'ouverture ; `Canal.web`

Spec §1, §2, §3.

**Files:**
- Modify: `src/dashboard/ai-web.ts` (créé en tâche 1)
- Modify: `src/dashboard/ai-providers.ts` (`Canal`, `MARQUES`, nouvel `estCanalCable`)
- Modify: `scripts/check-web-channel.mjs`

**Interfaces:**
- Consumes : `composerPrompts`, `PHRASE_FINALE_CLI` (tâche 2), `URL_MAX` (tâche 1).
- Produces (`src/dashboard/ai-web.ts`) :
  - `export interface OuvertureWeb { nouvelle: string; parametre: string }`
  - `export function nouveauJeton(): string` (dix caractères `[a-z0-9]`)
  - `export function texteWeb(prompts: { systemPrompt: string; userPrompt: string }, jeton: string): string`
  - `export type ResultatOuverture = { mode: "url"; url: string } | { mode: "presse-papier"; url: string; texte: string }`
  - `export function preparerOuverture(texte: string, web: OuvertureWeb, urlMax: number): ResultatOuverture`
- Produces (`src/dashboard/ai-providers.ts`) : `Canal.web?: OuvertureWeb` ; `export function estCanalCable(canalId: string): boolean`.

- [ ] **Step 1: Ajouter les cas au contrôle**

Dans `scripts/check-web-channel.mjs`, remplacer l'appel `withSrcModule([...], async (_current, client) => {` par un chargement à quatre modules, et ajouter un second groupe :

```js
await withSrcModule(
	["src/host/current.ts", "src/dashboard/ai-client.ts", "src/dashboard/ai-web.ts", "src/dashboard/ai-providers.ts"],
	async (_current, client, web, providers) => {
		/* ... le groupe « prompts et parseur » existant, inchangé ... */

		const r2 = makeReporter("Canal web — texte, jeton, ouverture, câblage");

		/* ── texteWeb : la consigne de forme remplace la phrase du CLI ── */
		{
			const prompts = client.composerPrompts("Sujet", { count: 3 });
			const texte = web.texteWeb(prompts, "k7f2q9abcd");
			r2.check("le texte porte le jeton en commentaire de première ligne du bloc", texte.includes("// neo-quiz k7f2q9abcd"), true);
			r2.check("il demande un bloc de code json5", texte.includes("```json5"), true);
			r2.check("la phrase finale du CLI n'y est plus", texte.includes(client.PHRASE_FINALE_CLI), false);
			r2.check("les deux prompts y sont, dans l'ordre", texte.indexOf("You are a quiz generator") < texte.indexOf("Generate a quiz about the following topic"), true);
		}

		/* ── nouveauJeton ── */
		{
			const a = web.nouveauJeton(), b = web.nouveauJeton();
			r2.check("dix caractères de [a-z0-9]", /^[a-z0-9]{10}$/.test(a), true);
			r2.check("deux tirages diffèrent", a === b, false);
		}

		/* ── preparerOuverture ── */
		{
			const site = { nouvelle: "https://claude.ai/new", parametre: "q" };
			const court = web.preparerOuverture("Bonjour à tous", site, 200);
			r2.check("sous la borne : l'adresse porte le texte encodé",
				court, { mode: "url", url: "https://claude.ai/new?q=Bonjour%20%C3%A0%20tous" });
			const long = web.preparerOuverture("x".repeat(500), site, 200);
			r2.check("au-delà : le presse-papier, l'adresse nue, le texte intact",
				[long.mode, long.url, long.texte.length], ["presse-papier", "https://claude.ai/new", 500]);
			const exact = web.preparerOuverture("abc", site, "https://claude.ai/new?q=abc".length);
			r2.check("la borne exacte passe encore par l'adresse", exact.mode, "url");
		}

		/* ── estCanalCable ── */
		r2.check("claude.ai est câblé", providers.estCanalCable("claude-web"), true);
		r2.check("chatgpt.com ne l'est pas encore", providers.estCanalCable("chatgpt-web"), false);
		r2.check("un CLI n'est pas un canal web câblé", providers.estCanalCable("claude-code"), false);

		r2.done();
	});
```

- [ ] **Step 2: Le lancer, le voir échouer**

Run: `npm run check:web-channel`
Expected: sortie 1 (les fonctions n'existent pas).

- [ ] **Step 3: Écrire `ai-web.ts`**

Compléter `src/dashboard/ai-web.ts` (sous `URL_MAX`) :

```ts
import { PHRASE_FINALE_CLI } from "./ai-client";

/** Comment un site s'ouvre avec la question déjà écrite. */
export interface OuvertureWeb {
	/** L'adresse d'une conversation neuve, sans paramètre. */
	nouvelle: string;
	/** Le paramètre qui porte la question (`q` sur claude.ai, mesuré le 2026-09-18). */
	parametre: string;
}

/** Dix caractères de [a-z0-9], tirés au hasard. Le jeton n'a qu'un rôle :
    reconnaître LA réponse attendue dans le presse-papier (le principal ne
    livre que le texte qui le porte). Un jeton neuf par ouverture. */
export function nouveauJeton(): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	const octets = new Uint8Array(10);
	crypto.getRandomValues(octets);
	let s = "";
	for (const o of octets) s += alphabet[o % alphabet.length];
	return s;
}

/* La consigne de FORME, adressée au modèle (anglais). Elle remplace la phrase
   finale du CLI : un site a un bouton Copier sur un bloc de code, pas sur du
   texte brut, et le jeton en première ligne est ce que le principal cherche. */
function consigneDeForme(jeton: string): string {
	return "Reply with ONE code block only, fenced with ```json5, whose FIRST line is exactly the comment `// neo-quiz "
		+ jeton + "` followed by the JSON5 array. No text before or after the block.";
}

/** Le texte complet qui part à un site : les deux prompts, la consigne de
    forme à la place de la phrase finale du CLI. */
export function texteWeb(prompts: { systemPrompt: string; userPrompt: string }, jeton: string): string {
	const systeme = prompts.systemPrompt.replace(PHRASE_FINALE_CLI, consigneDeForme(jeton));
	return systeme + "\n\n" + prompts.userPrompt;
}

export type ResultatOuverture =
	| { mode: "url"; url: string }
	| { mode: "presse-papier"; url: string; texte: string };

/** L'adresse si elle tient dans `urlMax`, sinon l'adresse nue et le texte à
    copier. Le seuil est inclusif : à la borne exacte, l'adresse passe. */
export function preparerOuverture(texte: string, web: OuvertureWeb, urlMax: number): ResultatOuverture {
	const url = web.nouvelle + "?" + web.parametre + "=" + encodeURIComponent(texte);
	if (url.length <= urlMax) return { mode: "url", url };
	return { mode: "presse-papier", url: web.nouvelle, texte };
}
```

`crypto.getRandomValues` existe dans Chromium (rendu) et dans Node 19+ (le contrôle) : pas d'import.

- [ ] **Step 4: `Canal.web` et `estCanalCable`**

Dans `src/dashboard/ai-providers.ts` :

```ts
import type { OuvertureWeb } from "./ai-web";

export interface Canal {
	id: string;
	label: string;
	sub: string;
	type: TypeCanal;
	/** Comment ouvrir le site avec la question déjà écrite. ABSENT : le canal
	    n'est pas câblé, le bouton le dit (« aperçu du design »). Posé quand le
	    site a été MESURÉ (claude.ai le 2026-09-18 : `/new?q=` préremplit sans
	    envoyer). */
	web?: OuvertureWeb;
}
```

Sur le canal `claude-web` de `MARQUES` : `web: { nouvelle: "https://claude.ai/new", parametre: "q" }`. Rien sur `chatgpt-web` ni `perplexity-web`. Puis, sous `estCanalWeb` :

```ts
/** Vrai quand le site sait s'ouvrir avec la question : `web` est posé. */
export function estCanalCable(canalId: string): boolean {
	return !!getCanal(canalId)?.web;
}
```

Vérifier qu'`ai-web.ts` importe `ai-client.ts` et qu'`ai-providers.ts` importe `ai-web.ts` en `import type` seulement (pas de cycle à l'exécution : `ai-client` importe `ai-providers`).

- [ ] **Step 5: Vérifier**

Run: `npm run check:web-channel && npm run check && npm run check:host && npm run check:ai-providers && npm run check:app`
Expected: tout en 0 ; « Canal web — texte, jeton, ouverture, câblage : 12/12 cas passent ».

- [ ] **Step 6: Discriminance**

Dans `preparerOuverture`, remplacer `<=` par `<` : le cas « borne exacte » rougit. Restaurer. Dans `texteWeb`, retirer le `.replace(...)` : « la phrase finale n'y est plus » rougit. Restaurer.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/ai-web.ts src/dashboard/ai-providers.ts scripts/check-web-channel.mjs
git commit -m "$(cat <<'EOF'
Le texte d'un site : bloc de code, jeton en première ligne, adresse ou presse-papier

texteWeb remplace la phrase finale du CLI par une consigne de forme (un
bloc ```json5 ouvert par « // neo-quiz <jeton> ») : sur claude.ai un bloc
de code a son bouton Copier, et le jeton est ce que l'attente reconnaîtra.
preparerOuverture choisit l'adresse tant qu'elle tient dans URL_MAX, sinon
l'adresse nue et le texte à copier. Canal.web porte l'adresse de claude.ai,
mesurée le 2026-09-18 ; chatgpt.com et perplexity.ai attendent la leur.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `HostShell.openUrl` sous les deux hôtes, et la borne de copie

Spec §3.

**Files:**
- Create: `src/host/url.ts`
- Modify: `src/host/types.ts` (interface `HostShell`, ~l.358)
- Modify: `apps/windows/src/host/index.ts` (objet `shell`, ~l.55)
- Modify: `apps/obsidian/host.ts` (objet `shell`, ~l.554)
- Modify: `apps/windows/electron/canaux.ts` (`systemeCopierTexte`, ~l.554)
- Modify: `scripts/check-windows-host.mjs`, `scripts/check-obsidian-host.mjs`, `scripts/check-ai-providers.mjs` (faux hôte : `shell`)

**Interfaces:**
- Produces : `HostShell.openUrl(url: string): Promise<boolean>` ; `export function estUrlHttps(url: string): boolean` (`src/host/url.ts`).

- [ ] **Step 1: Les cas qui échouent**

Dans `scripts/check-obsidian-host.mjs`, ligne `shell: ["openExternal", "revealInHost"],` → `shell: ["openExternal", "revealInHost", "openUrl"],`. Puis, après le cas « openExternal d'une chaîne rend false… », ajouter :

```js
	/* `openUrl` : une adresse `https:` part à `window.open` (Obsidian la remet
	   au navigateur) ; tout autre schéma est refusé AVANT, avec un `false`
	   net. Le bouchon n'a pas de `window.open` : on en pose un qui journalise. */
	{
		const appels = [];
		const ancien = globalThis.window?.open;
		globalThis.window = globalThis.window || {};
		globalThis.window.open = (url, cible, options) => { appels.push([url, cible, options]); return null; };
		const h = createObsidianHost(fausseApp(fichiers), { manifest: {} });
		r.check("openUrl ouvre une adresse https dans un nouvel onglet, sans opener",
			[await h.shell.openUrl("https://claude.ai/new?q=x"), appels],
			[true, [["https://claude.ai/new?q=x", "_blank", "noopener"]]]);
		r.check("openUrl refuse http: et file: sans appeler window.open",
			[await h.shell.openUrl("http://claude.ai/"), await h.shell.openUrl("file:///C:/x.html"), appels.length],
			[false, false, 1]);
		globalThis.window.open = ancien;
	}
```

Dans `scripts/check-windows-host.mjs`, après le groupe « openExternal d'une chaîne (statique) », ajouter :

```js
/* `openUrl` : la garde est PARTAGÉE (`src/host/url.ts`, chargeable) et
   l'appel à `window.open` est STATIQUE (index.ts ne se charge pas hors de
   la fenêtre, voir le bloc précédent). */
await withSrcModule("src/host/url.ts", ({ estUrlHttps }) => {
	const r = makeReporter("Hôte Windows — openUrl");
	r.check("https admis", estUrlHttps("https://claude.ai/new?q=a%20b"), true);
	r.check("http, file, javascript, obsidian, vide, illisible refusés",
		["http://claude.ai/", "file:///C:/x", "javascript:alert(1)", "obsidian://open", "", "pas une url"].map(estUrlHttps),
		[false, false, false, false, false, false]);
	const source = readFileSync("apps/windows/src/host/index.ts", "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
	r.check("index.ts garde par estUrlHttps puis ouvre par window.open en _blank noopener",
		/if \(!estUrlHttps\(url\)\) return false;\s*window\.open\(url, "_blank", "noopener"\);\s*return true;/.test(source), true);
	r.done();
});
```

Dans `scripts/check-ai-providers.mjs`, le faux hôte : `shell: { openExternal: async () => false, revealInHost: async () => false, openUrl: async () => false },`.

Run: `npm run check:obsidian-host; npm run check:windows-host`
Expected: les deux rougissent (méthode manquante, module `src/host/url.ts` absent).

- [ ] **Step 2: La garde partagée et le contrat**

```ts
// src/host/url.ts
/** Une adresse que l'hôte accepte d'ouvrir dans le navigateur : `https:`
    seulement. Partagée par les deux hôtes pour que la règle n'ait qu'une
    source ; le principal Electron refuserait aussi le reste, mais une garde
    ici rend un `false` net au lieu d'un avertissement dans la console. */
export function estUrlHttps(url: string): boolean {
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}
```

Dans `src/host/types.ts`, interface `HostShell`, ajouter :

```ts
	/** Ouvre une adresse `https:` dans le navigateur de l'utilisateur. `false`
	    si l'hôte a refusé (autre schéma, adresse illisible). Jamais un chemin
	    de fichier : c'est `openExternal`. Sert au canal web de la page
	    « Générer » (spec 2026-09-18). */
	openUrl(url: string): Promise<boolean>;
```

- [ ] **Step 3: Les deux implémentations**

`apps/windows/src/host/index.ts`, dans l'objet `shell`, après `openExternal` :

```ts
		/* `window.open` et non un canal IPC : le principal intercepte toute
		   fenêtre demandée par la page (`setWindowOpenHandler`, main.ts) et remet
		   au navigateur ce qui est du `https?:`, le filtre qui existe déjà pour
		   les liens d'un quiz partagé. Aucun chemin de plus vers `shell`. */
		async openUrl(url) {
			if (!estUrlHttps(url)) return false;
			window.open(url, "_blank", "noopener");
			return true;
		},
```

avec `import { estUrlHttps } from "../../../../src/host/url";` (vérifier le chemin relatif exact en regardant comment `index.ts` importe déjà `../../../../src/host/types`).

`apps/obsidian/host.ts`, dans `shell`, même corps, avec `import { estUrlHttps } from "../../src/host/url";` (même vérification du chemin).

- [ ] **Step 4: La borne de copie**

`apps/windows/electron/canaux.ts`, handler `CANAUX.systemeCopierTexte` : remplacer `8192` par `524288` et réécrire le commentaire :

```ts
	/* Le presse-papiers : du TEXTE, et rien d'autre. Une chaîne, et bornée :
	   le principal ne fait pas plus confiance au rendu ici qu'ailleurs. La
	   borne était de 8 Ko (« un chemin de fichier tient largement dedans ») ;
	   elle vaut 512 Ko depuis le canal web (2026-09-18) : quand la question
	   ne tient pas dans une adresse, c'est le prompt entier, notes jointes
	   comprises, qui part par ici. Aucune LECTURE n'est exposée AU RENDU :
	   `clipboard.readText` n'a pas de canal ; la veille du canal web lit
	   côté principal, sous jeton (voir `attente-collage.ts`). */
	ipcMain.handle(CANAUX.systemeCopierTexte, (_e, texte: unknown) => {
		if (typeof texte !== "string" || texte.length > 524288) throw new Error("copie refusée : le presse-papiers ne prend qu'un texte borné");
		clipboard.writeText(texte);
	});
```

- [ ] **Step 5: Vérifier**

Run: `npm run check && npm run check:host && npm run check:obsidian-host && npm run check:windows-host && npm run check:ai-providers && npm run check:app`
Expected: tout en 0.

- [ ] **Step 6: Discriminance**

Dans `estUrlHttps`, remplacer `=== "https:"` par `.startsWith("http")` : le cas « http… refusés » rougit sous les deux contrôles. Restaurer.

- [ ] **Step 7: Commit**

```bash
git add src/host/url.ts src/host/types.ts apps/windows/src/host/index.ts apps/obsidian/host.ts apps/windows/electron/canaux.ts scripts/check-windows-host.mjs scripts/check-obsidian-host.mjs scripts/check-ai-providers.mjs
git commit -m "$(cat <<'EOF'
HostShell.openUrl ouvre une adresse https dans le navigateur, sous les deux hôtes

Par window.open : le principal intercepte déjà toute fenêtre demandée par
la page et remet au navigateur ce qui est du https, aucun canal IPC de
plus. La garde estUrlHttps est partagée (src/host/url.ts) et éprouvée par
les deux contrôles d'hôte. La borne du canal de copie passe de 8 Ko à
512 Ko : quand la question ne tient pas dans une adresse, c'est le prompt
entier qui part par le presse-papier.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Le noyau pur de l'attente (`attente-collage.ts`)

Spec §4, les règles de la veille, sans Electron ni horloge réelle.

**Files:**
- Create: `apps/windows/electron/attente-collage.ts`
- Create: `scripts/check-electron-collage.mjs`
- Modify: `package.json` (`check:electron-collage`)

**Interfaces:**
- Produces :
  - `export const CADENCE_MS = 500`, `export const ECHEANCE_MS = 30 * 60 * 1000`
  - `export function jetonValide(jeton: unknown): jeton is string`
  - `export interface Horloge { planifier(fn: () => void, ms: number): number; annuler(id: number): void; maintenant(): number }`
  - `export function creerAttente(deps: { lire(): string; horloge: Horloge; livrer(texte: string): void }): { demarrer(jeton: string): boolean; arreter(): void; enCours(): boolean }`

- [ ] **Step 1: Le contrôle qui échoue**

```js
// scripts/check-electron-collage.mjs
/**
 * L'ATTENTE D'UNE RÉPONSE COPIÉE, côté principal (canal web, spec du
 * 2026-09-18, §4). Le noyau est PUR : le presse-papier et le temps sont des
 * ENTRÉES, ce qui permet d'éprouver ici, sans Electron, ce qui ne doit
 * jamais fuir :
 *
 * — un texte qui ne porte pas le jeton n'est JAMAIS livré, même relu cent
 *   fois : c'est la seule chose qui rend acceptable une lecture du
 *   presse-papier par l'application ;
 * — un jeton trop court est refusé : vide, il ferait reconnaître n'importe
 *   quoi ;
 * — une seule livraison, puis la sonde s'arrête ; `arreter()` et l'échéance
 *   de trente minutes l'arrêtent aussi ; une nouvelle attente remplace la
 *   précédente sans que celle-ci puisse encore livrer.
 *
 *     npm run check:electron-collage
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/* Un temps qu'on avance à la main : `tic(ms)` fait passer les échéances
   dans l'ordre, une par une. */
function fauxTemps() {
	let t = 0;
	let prochainId = 1;
	const echeances = new Map();
	return {
		horloge: {
			planifier(fn, ms) { const id = prochainId++; echeances.set(id, { a: t + ms, fn }); return id; },
			annuler(id) { echeances.delete(id); },
			maintenant() { return t; },
		},
		tic(ms) {
			const cible = t + ms;
			for (;;) {
				const due = [...echeances.entries()].filter(([, e]) => e.a <= cible).sort((x, y) => x[1].a - y[1].a)[0];
				if (!due) break;
				echeances.delete(due[0]);
				t = due[1].a;
				due[1].fn();
			}
			t = cible;
		},
		enAttente() { return echeances.size; },
	};
}

await withSrcModule("apps/windows/electron/attente-collage.ts", ({ creerAttente, jetonValide, CADENCE_MS, ECHEANCE_MS }) => {
	const r = makeReporter("Attente d'une réponse copiée");

	r.check("un jeton de huit caractères [a-z0-9] ou plus est valide", ["k7f2q9ab", "k7f2q9abcd"].map(jetonValide), [true, true]);
	r.check("trop court, vide, majuscules, non-chaîne : refusés", ["k7f2q9a", "", "K7F2Q9ABCD", "k7f2 q9abcd", 42, null].map(jetonValide), [false, false, false, false, false, false]);

	const scene = () => {
		const temps = fauxTemps();
		let presse = "";
		const livres = [];
		const attente = creerAttente({ lire: () => presse, horloge: temps.horloge, livrer: t => livres.push(t) });
		return { temps, attente, livres, poser: t => { presse = t; } };
	};

	{
		const s = scene();
		r.check("un jeton invalide ne démarre rien", [s.attente.demarrer("court"), s.attente.enCours(), s.temps.enAttente()], [false, false, 0]);
	}
	{
		const s = scene();
		s.attente.demarrer("k7f2q9abcd");
		s.poser("mot de passe: hunter2");
		s.temps.tic(CADENCE_MS * 100);
		r.check("sans le jeton, rien n'est livré, même après cent tours", [s.livres, s.attente.enCours()], [[], true]);
	}
	{
		const s = scene();
		s.attente.demarrer("k7f2q9abcd");
		s.temps.tic(CADENCE_MS * 3);
		s.poser("```json5\n// neo-quiz k7f2q9abcd\n[{ prompt: \"x\" }]\n```");
		s.temps.tic(CADENCE_MS);
		r.check("avec le jeton : livré une fois, et l'attente s'arrête", [s.livres.length, s.attente.enCours(), s.temps.enAttente()], [1, false, 0]);
		s.temps.tic(CADENCE_MS * 10);
		r.check("elle ne relit plus, donc ne relivre pas", s.livres.length, 1);
	}
	{
		const s = scene();
		s.attente.demarrer("k7f2q9abcd");
		s.attente.arreter();
		s.poser("// neo-quiz k7f2q9abcd");
		s.temps.tic(CADENCE_MS * 5);
		r.check("arreter() coupe : plus de sonde, rien de livré", [s.livres, s.attente.enCours(), s.temps.enAttente()], [[], false, 0]);
	}
	{
		const s = scene();
		s.attente.demarrer("k7f2q9abcd");
		s.temps.tic(ECHEANCE_MS + CADENCE_MS);
		s.poser("// neo-quiz k7f2q9abcd");
		s.temps.tic(CADENCE_MS * 5);
		r.check("après trente minutes, l'attente s'est arrêtée d'elle-même", [s.livres, s.attente.enCours(), s.temps.enAttente()], [[], false, 0]);
	}
	{
		const s = scene();
		s.attente.demarrer("premier1234");
		s.attente.demarrer("second12345");
		s.poser("// neo-quiz premier1234");
		s.temps.tic(CADENCE_MS * 3);
		r.check("une nouvelle attente remplace la première : son jeton ne livre plus", [s.livres, s.attente.enCours()], [[], true]);
		s.poser("// neo-quiz second12345");
		s.temps.tic(CADENCE_MS);
		r.check("et le jeton de la seconde livre", s.livres.length, 1);
	}
	{
		const s = scene();
		s.attente.demarrer("k7f2q9abcd");
		r.check("une seule sonde à la fois", s.temps.enAttente(), 1);
	}

	r.done();
});
```

Ajouter dans `package.json` : `"check:electron-collage": "node scripts/check-electron-collage.mjs",`.

Run: `npm run check:electron-collage`
Expected: sortie 1 (module absent).

- [ ] **Step 2: Le noyau**

```ts
// apps/windows/electron/attente-collage.ts
/**
 * L'ATTENTE D'UNE RÉPONSE COPIÉE — le noyau PUR de la veille du presse-papier
 * pendant une génération par un site (spec 2026-09-18, §4).
 *
 * Aucun `electron`, aucun `setTimeout` : le presse-papier (`lire`) et le temps
 * (`horloge`) sont des ENTRÉES, pour que `check:electron-collage` éprouve ce
 * qui ne doit jamais fuir. La règle qui rend cette lecture acceptable : un
 * texte n'est LIVRÉ que s'il porte le jeton de l'attente en cours ; tout le
 * reste est comparé puis oublié, sans journal. Le câblage réel (clipboard,
 * timers, webContents.send, flashFrame) est dans canaux.ts.
 */

/** Cadence de la sonde. Un demi-seconde : le geste « Copier » sur le site
    précède de bien plus le retour de l'utilisateur. */
export const CADENCE_MS = 500;
/** Au-delà, l'attente s'arrête d'elle-même : personne ne doit laisser une
    sonde tourner sans que quelqu'un attende vraiment. */
export const ECHEANCE_MS = 30 * 60 * 1000;

/** Au moins huit caractères de [a-z0-9] : un jeton vide ou court ferait
    reconnaître n'importe quel texte. La page en tire dix. */
export function jetonValide(jeton: unknown): jeton is string {
	return typeof jeton === "string" && /^[a-z0-9]{8,}$/.test(jeton);
}

export interface Horloge {
	planifier(fn: () => void, ms: number): number;
	annuler(id: number): void;
	maintenant(): number;
}

export interface Attente {
	/** `false` si le jeton est refusé. Remplace une attente en cours. */
	demarrer(jeton: string): boolean;
	arreter(): void;
	enCours(): boolean;
}

export function creerAttente(deps: { lire(): string; horloge: Horloge; livrer(texte: string): void }): Attente {
	let jeton: string | null = null;
	let debut = 0;
	let sonde: number | null = null;

	function arreter(): void {
		if (sonde !== null) { deps.horloge.annuler(sonde); sonde = null; }
		jeton = null;
	}

	function tour(): void {
		sonde = null;
		if (jeton === null) return;
		if (deps.horloge.maintenant() - debut >= ECHEANCE_MS) { arreter(); return; }
		const texte = deps.lire();
		if (texte.includes(jeton)) {
			/* Arrêter AVANT de livrer : si `livrer` relance une attente, elle ne
			   doit pas être écrasée par l'arrêt de celle-ci. */
			arreter();
			deps.livrer(texte);
			return;
		}
		sonde = deps.horloge.planifier(tour, CADENCE_MS);
	}

	return {
		demarrer(j: string): boolean {
			if (!jetonValide(j)) return false;
			arreter();
			jeton = j;
			debut = deps.horloge.maintenant();
			sonde = deps.horloge.planifier(tour, CADENCE_MS);
			return true;
		},
		arreter,
		enCours: () => jeton !== null,
	};
}
```

- [ ] **Step 3: Vérifier**

Run: `npm run check:electron-collage && npm run check:app`
Expected: « Attente d'une réponse copiée : 10/10 cas passent » ; `check:app` en 0 (c'est lui qui type `apps/windows/electron/`).

- [ ] **Step 4: Discriminance**

Remplacer `texte.includes(jeton)` par `true` : « sans le jeton, rien n'est livré » rougit. Restaurer. Retirer la ligne de l'échéance : « après trente minutes » rougit. Restaurer.

- [ ] **Step 5: Commit**

```bash
git add apps/windows/electron/attente-collage.ts scripts/check-electron-collage.mjs package.json
git commit -m "$(cat <<'EOF'
L'attente d'une réponse copiée : un noyau pur, sous jeton

Le principal sondera le presse-papier pendant une génération par un site ;
ce noyau dit à quelles conditions : un jeton d'au moins huit caractères,
une livraison seulement si le texte le porte (tout le reste est oublié sur
place), une seule livraison, un arrêt sur demande et après trente minutes,
une attente à la fois. Le presse-papier et le temps sont des entrées :
check:electron-collage l'éprouve sans Electron.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Le câblage de l'attente : principal, pont, preload, hôte du rendu, contrat

Spec §3 bis et §4.

**Files:**
- Modify: `apps/windows/electron/pont.ts` (interface `Pont` : membre `collage` ; `CANAUX` : `collageAttendre`, `collageArreter`, `collageTexte`)
- Modify: `apps/windows/electron/preload.ts` (membre `collage`, patron de `miseAJour`)
- Modify: `apps/windows/electron/canaux.ts` (les deux handlers, la livraison)
- Modify: `apps/windows/electron/main.ts` (`flashFrame(false)` au focus)
- Modify: `src/host/types.ts` (`HostCollage`, `Host.collage?`)
- Create: `apps/windows/src/host/collage.ts`
- Modify: `apps/windows/src/host/index.ts` (`collage: createWindowsCollage(pont)`)
- Modify: `scripts/check-windows-host.mjs`

**Interfaces:**
- Consumes : `creerAttente`, `jetonValide` (tâche 5).
- Produces :
  - `Pont.collage: { attendre(jeton: string): Promise<boolean>; arreter(): Promise<void>; surTexte(rappel: (texte: string) => void): () => void }`
  - `export interface HostCollage { attendre(jeton: string, surTexte: (texte: string) => void): () => void }` et `Host.collage?: HostCollage`
  - `export function createWindowsCollage(pont: () => Pont): HostCollage` (`apps/windows/src/host/collage.ts`)

- [ ] **Step 1: Le cas de l'hôte du rendu, qui échoue**

Dans `scripts/check-windows-host.mjs`, ajouter un groupe (regarder comment les autres groupes construisent un faux pont, par exemple `installerPont`, et faire de même pour `window.neo.collage`) :

```js
await withSrcModule("apps/windows/src/host/collage.ts", async ({ createWindowsCollage }) => {
	const r = makeReporter("Hôte Windows — collage (l'attente vue du rendu)");
	const journal = [];
	let rappelPont = null;
	const pont = () => ({
		collage: {
			attendre: async j => { journal.push(["attendre", j]); return true; },
			arreter: async () => { journal.push(["arreter"]); },
			surTexte: rappel => { rappelPont = rappel; return () => { rappelPont = null; journal.push(["off"]); }; },
		},
	});
	const collage = createWindowsCollage(pont);
	const recus = [];
	const arreter = collage.attendre("k7f2q9abcd", t => recus.push(t));
	r.check("attendre : s'abonne au texte PUIS demande l'attente au principal, avec le jeton",
		journal, [["attendre", "k7f2q9abcd"]]);
	rappelPont("// neo-quiz k7f2q9abcd");
	rappelPont("// neo-quiz k7f2q9abcd encore");
	r.check("le rappel du rendu n'est appelé qu'une fois, et l'abonnement est retiré", [recus, journal.includes("off") || journal.some(l => l[0] === "off")], [["// neo-quiz k7f2q9abcd"], true]);
	arreter();
	r.check("la fonction rendue arrête l'attente côté principal", journal.some(l => l[0] === "arreter"), true);
	r.done();
});
```

Run: `npm run check:windows-host`
Expected: rougit (module absent).

- [ ] **Step 2: Le contrat**

Dans `src/host/types.ts`, après `HostPdf` (ou le dernier membre optionnel), ajouter :

```ts
/**
 * L'attente d'une réponse COPIÉE, pendant une génération par un site (spec
 * 2026-09-18, §4). Le principal sonde le presse-papier et ne livre que le
 * texte qui porte le jeton ; le rendu ne lit rien lui-même. Membre OPTIONNEL :
 * absent sous le greffon, la page attend alors un collage manuel.
 */
export interface HostCollage {
	/** Démarre l'attente ; la fonction rendue l'arrête. Une nouvelle attente
	    remplace la précédente. `surTexte` est appelé AU PLUS une fois. */
	attendre(jeton: string, surTexte: (texte: string) => void): () => void;
}
```

et dans `Host` : `collage?: HostCollage;` avec un commentaire d'une ligne renvoyant à l'interface.

- [ ] **Step 3: Le pont et le preload**

`apps/windows/electron/pont.ts`, dans l'interface `Pont`, après `miseAJour` :

```ts
	/**
	 * L'ATTENTE D'UNE RÉPONSE COPIÉE (génération par un site). Le rendu
	 * donne un JETON et reçoit AU PLUS un texte : celui qui le porte. Le
	 * principal sonde le presse-papier (voir `attente-collage.ts` : un texte
	 * sans jeton est comparé puis oublié, jamais transmis) et arrête de
	 * lui-même à la première livraison, sur `arreter`, ou après trente
	 * minutes. Poussé comme `miseAJour.surEtat`.
	 */
	collage: {
		/** `false` si le jeton est refusé (trop court, mal formé). */
		attendre(jeton: string): Promise<boolean>;
		arreter(): Promise<void>;
		surTexte(rappel: (texte: string) => void): () => void;
	};
```

Dans `CANAUX` : `collageAttendre: "neo:collage/attendre"`, `collageArreter: "neo:collage/arreter"`, `collageTexte: "neo:collage/texte"` (poussé).

`apps/windows/electron/preload.ts`, dans l'objet `pont`, après `miseAJour` :

```ts
	collage: {
		attendre: jeton => ipcRenderer.invoke(CANAUX.collageAttendre, jeton),
		arreter: () => ipcRenderer.invoke(CANAUX.collageArreter),
		surTexte(rappel) {
			const ecouteur = (_e: unknown, texte: string): void => rappel(texte);
			ipcRenderer.on(CANAUX.collageTexte, ecouteur);
			return () => { ipcRenderer.off(CANAUX.collageTexte, ecouteur); };
		},
	},
```

- [ ] **Step 4: Le principal**

Dans `apps/windows/electron/canaux.ts`, repérer comment les handlers de mise à jour accèdent à la fenêtre (`fenetre.webContents.send`) et faire pareil. Ajouter, près de `systemeCopierTexte` :

```ts
import { creerAttente, jetonValide } from "./attente-collage";
// ...
	/* L'attente d'une réponse copiée (canal web). UNE attente par fenêtre ;
	   le noyau (`attente-collage.ts`) tient les règles, ici seulement les
	   branchements : le vrai presse-papier, les vrais timers, la livraison
	   par `webContents.send`, et le clignotement dans la barre des tâches
	   (`flashFrame(true)`, éteint au prochain focus dans main.ts) plutôt
	   qu'un vol de focus, que Windows refuse et que l'utilisateur qui lit
	   encore la réponse ne voudrait pas. */
	const attente = creerAttente({
		lire: () => clipboard.readText(),
		horloge: {
			planifier: (fn, ms) => setTimeout(fn, ms) as unknown as number,
			annuler: id => clearTimeout(id),
			maintenant: () => Date.now(),
		},
		livrer: texte => {
			if (fenetre.isDestroyed()) return;
			fenetre.webContents.send(CANAUX.collageTexte, texte);
			fenetre.flashFrame(true);
		},
	});
	ipcMain.handle(CANAUX.collageAttendre, (_e, jeton: unknown) => jetonValide(jeton) && attente.demarrer(jeton));
	ipcMain.handle(CANAUX.collageArreter, () => { attente.arreter(); });
```

Ajouter `clipboard` aux imports d'`electron` s'il n'y est pas (il y est déjà pour `systemeCopierTexte`). Dans `main.ts`, à côté des autres écouteurs de la fenêtre : `fenetre.on("focus", () => fenetre.flashFrame(false));` avec un commentaire d'une ligne (« le clignotement posé par l'attente d'une réponse copiée s'éteint dès qu'on revient »). Vérifier aussi que l'attente est arrêtée à la fermeture de la fenêtre : appeler `attente.arreter()` là où les autres ressources par fenêtre sont libérées (chercher `closed` ou la routine de fermeture dans `main.ts`/`canaux.ts`).

- [ ] **Step 5: L'hôte du rendu**

```ts
// apps/windows/src/host/collage.ts
import type { HostCollage } from "../../../../src/host/types";
import type { Pont } from "../../electron/pont";

/**
 * `HostCollage` sur le pont : le rendu donne le jeton et attend AU PLUS un
 * texte. S'abonner AVANT de demander l'attente : un texte déjà dans le
 * presse-papier serait livré au premier tour, avant qu'un abonnement posé
 * après ne l'entende. Le rappel se désabonne lui-même à la première
 * livraison : le contrat promet « au plus une fois ».
 */
export function createWindowsCollage(pont: () => Pont): HostCollage {
	return {
		attendre(jeton, surTexte) {
			let off: (() => void) | null = pont().collage.surTexte(texte => {
				off?.(); off = null;
				surTexte(texte);
			});
			void pont().collage.attendre(jeton);
			return () => {
				off?.(); off = null;
				void pont().collage.arreter();
			};
		},
	};
}
```

Vérifier les chemins d'import relatifs contre ceux d'un fichier voisin (`apps/windows/src/host/process.ts` importe `Pont` de la même façon). `pont.ts` est dans la liste `SANS_NODE` de `check:host` : importable du rendu. Dans `apps/windows/src/host/index.ts`, ajouter `collage: createWindowsCollage(pont),` à l'objet hôte, à côté de `process`/`pdf`, et l'import.

- [ ] **Step 6: Vérifier**

Run: `npm run check && npm run check:host && npm run check:windows-host && npm run check:obsidian-host && npm run check:app && npm run check:electron-collage`
Expected: tout en 0.

- [ ] **Step 7: Discriminance**

Dans `createWindowsCollage`, inverser l'ordre (demander l'attente PUIS s'abonner) : le cas « s'abonne PUIS demande » ne le voit pas par le journal ; retirer plutôt le `off?.()` du rappel : « n'est appelé qu'une fois » rougit. Restaurer.

- [ ] **Step 8: Commit**

```bash
git add apps/windows/electron/pont.ts apps/windows/electron/preload.ts apps/windows/electron/canaux.ts apps/windows/electron/main.ts src/host/types.ts apps/windows/src/host/collage.ts apps/windows/src/host/index.ts scripts/check-windows-host.mjs
git commit -m "$(cat <<'EOF'
Le principal veille sur le presse-papier pendant une génération par un site

Pont.collage : le rendu donne un jeton et reçoit au plus un texte, celui
qui le porte ; le principal sonde clipboard.readText toutes les 500 ms
avec le noyau d'attente-collage.ts, livre par webContents.send et fait
clignoter la fenêtre plutôt que de voler le focus. HostCollage, membre
optionnel du contrat, absent sous le greffon. Le rendu ne lit toujours
rien lui-même.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: La page « Générer » : ouvrir, attendre, recevoir

Spec §2 (images), §3, §4, §5. Tout dans `src/dashboard/ai.ts`, plus le CSS et l'i18n.

**Files:**
- Modify: `src/dashboard/ai.ts` (type `Phase` ~l.56 ; états près de `errorLogin` ~l.303 ; `render` : zones par phase ~l.624-630 et aiguillage ~l.1369 ; le bouton d'envoi ~l.1240 ; `renderError` ~l.1972 ; `startGeneration` ~l.2427 ; `dispose` ~l.2645)
- Modify: `src/assets/css/dashboard/dashboard-ai.css` (règles `.qbd-ai-stage--idle, --loading, --error` l.18-60 : ajouter `--web` ; carte)
- Modify: `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts`

**Interfaces:**
- Consumes : `composerPrompts`, `parseReponseQuiz` (tâche 2) ; `nouveauJeton`, `texteWeb`, `preparerOuverture`, `URL_MAX`, `ResultatOuverture` (tâche 3) ; `getCanal`, `getMarque`, `estCanalWeb`, `estCanalCable` (tâches 0, 3) ; `host.shell.openUrl` (tâche 4) ; `host.collage?.attendre` (tâche 6) ; `deps.copyText`.

- [ ] **Step 1: Les clés i18n**

`src/i18n/en/ai.ts`, dans le bloc « Canaux » créé en tâche 0 :

```ts
	"ai.channel.noImages": "Images can't be sent to a website. Remove them, or pick a CLI channel.",
	"ai.channel.copyFailed": "The prompt could not be copied to the clipboard.",
	"ai.channel.openFailed": "The browser could not be opened.",
	"ai.web.title": "Copy the answer from {site}",
	"ai.web.auto": "As soon as it's copied, the quiz is created here on its own.",
	"ai.web.manual": "Paste the answer here with Ctrl+V.",
	"ai.web.callout": "{site} will show this warning above your question. It appears because the question arrives through a link rather than the keyboard: {site} shows it for any prompt that comes from a link. Here the link comes from Neo Quiz and the question is yours. Send it as usual.",
	"ai.web.copied": "The prompt is in your clipboard: paste it into {site} first, then send.",
	"ai.web.reopen": "Reopen {site}",
	"ai.web.cancel": "Cancel",
```

`src/i18n/fr/ai.ts`, mêmes clés :

```ts
	"ai.channel.noImages": "Les images ne peuvent pas être envoyées à un site. Retire-les, ou choisis un canal CLI.",
	"ai.channel.copyFailed": "Le prompt n'a pas pu être copié dans le presse-papier.",
	"ai.channel.openFailed": "Le navigateur n'a pas pu être ouvert.",
	"ai.web.title": "Copie la réponse de {site}",
	"ai.web.auto": "Dès qu'elle est copiée, le quiz se crée ici tout seul.",
	"ai.web.manual": "Colle la réponse ici avec Ctrl+V.",
	"ai.web.callout": "{site} affichera cet avertissement au-dessus de ta question. Il apparaît parce que la question arrive par un lien et non par le clavier : {site} le montre pour toute invite venue d'un lien. Ici, le lien vient de Neo Quiz et la question est la tienne. Envoie comme d'habitude.",
	"ai.web.copied": "Le prompt est dans ton presse-papier : colle-le d'abord dans {site}, puis envoie.",
	"ai.web.reopen": "Rouvrir {site}",
	"ai.web.cancel": "Annuler",
```

- [ ] **Step 2: L'état**

Dans `src/dashboard/ai.ts` :

- `type Phase = "idle" | "loading" | "result" | "error" | "connexion" | "web";`
- imports : `import { composerPrompts, parseReponseQuiz } from "./ai-client";` et `import { nouveauJeton, texteWeb, preparerOuverture, URL_MAX } from "./ai-web";` et `import type { ResultatOuverture } from "./ai-web";`
- près de `let errorLogin` :

```ts
	/* L'attente d'une réponse copiée (canal web, spec 2026-09-18). Non nulle
	   en phase « web » seulement : le jeton de CETTE ouverture, ce qui a été
	   ouvert (adresse ou presse-papier), la fonction qui arrête la veille du
	   principal (null sous un hôte sans `collage`), et les écouteurs à retirer. */
	let attenteWeb: { jeton: string; ouverture: ResultatOuverture; site: string; arreter: (() => void) | null; retirer: () => void } | null = null;
	/** L'action de l'écran d'erreur : « Rouvrir <site> » quand la réponse
	    copiée n'était pas un quiz (réessayer relancerait une génération que
	    l'application n'a jamais faite). */
	let errorAction: "reopen" | null = null;
```

- [ ] **Step 3: L'ouverture, dans `startGeneration`**

Juste après `const msg = takeComposerMessage();` et `couperSondeConnexion();`, AVANT `phase = "loading"` :

```ts
		if (aiProviders.estCanalWeb(settings().aiProvider || "")) {
			await ouvrirSite(msg, container);
			return;
		}
```

Sortir le calcul de `source` et `prompt` (les lignes `const source = ...` / `const notesBlock = ...` / `const prompt = ...` du `try` de `startGeneration`) dans une fonction `composerDemande(msg: SentMessage): { source: "image" | "text" | "topic"; prompt: string }` appelée par les deux chemins, sans changer une ligne de leur contenu.

Puis :

```ts
	/**
	 * Le canal web : le site s'ouvre avec la question, l'application attend la
	 * réponse copiée. Trois gestes pour l'utilisateur (Ouvrir, Envoyer,
	 * Copier), et rien à confirmer ici : c'est la contrainte de la spec.
	 */
	async function ouvrirSite(msg: SentMessage, container: HTMLElement | null): Promise<void> {
		const canalId = settings().aiProvider || "";
		const canal = aiProviders.getCanal(canalId);
		const marque = aiProviders.getMarque(canalId);
		const site = canal ? canal.label : canalId;
		/* Non câblé (chatgpt.com, perplexity.ai tant qu'ils ne sont pas
		   mesurés) : la notice, et la demande revient au composer. */
		if (!canal || !canal.web) {
			host.ui.notice(t("ai.channel.notWiredYet"));
			restoreComposerMessage();
			return;
		}
		/* Ni une adresse ni un presse-papier texte ne transportent une image :
		   rien ne part, le composer garde tout. Même patron que le PDF refusé
		   dans l'application. */
		if (msg.images.length > 0) {
			host.ui.notice(t("ai.channel.noImages"));
			restoreComposerMessage();
			return;
		}
		const { source, prompt } = composerDemande(msg);
		const jeton = nouveauJeton();
		const texte = texteWeb(composerPrompts(prompt, { count: questionCount, type: questionType, source }), jeton);
		const ouverture = preparerOuverture(texte, canal.web, URL_MAX);
		if (ouverture.mode === "presse-papier") {
			const ok = deps.copyText ? await deps.copyText(ouverture.texte) : false;
			if (!ok) { echecOuverture(t("ai.channel.copyFailed"), container); return; }
		}
		if (!(await host.shell.openUrl(ouverture.url))) { echecOuverture(t("ai.channel.openFailed"), container); return; }
		arreterAttenteWeb();
		/* Écouteurs de la phase : Esc annule ; un collage hors du composer est
		   la réponse (le composer, lui, sert à écrire une nouvelle demande). */
		const surTouche = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.preventDefault(); annulerAttenteWeb(); } };
		const surCollage = (e: ClipboardEvent): void => {
			if (phase !== "web") return;
			const cible = e.target as HTMLElement | null;
			if (cible && cible.closest(".qbd-ai-composer")) return;
			const colle = e.clipboardData?.getData("text/plain") || "";
			if (!colle.trim()) return;
			e.preventDefault();
			void recevoirReponse(colle);
		};
		document.addEventListener("keydown", surTouche);
		document.addEventListener("paste", surCollage, true);
		attenteWeb = {
			jeton, ouverture, site,
			arreter: host.collage ? host.collage.attendre(jeton, texteRecu => void recevoirReponse(texteRecu)) : null,
			retirer: () => { document.removeEventListener("keydown", surTouche); document.removeEventListener("paste", surCollage, true); },
		};
		void marque;
		errorMessage = "";
		errorLogin = null;
		errorAction = null;
		phase = "web";
		render(container);
	}

	function echecOuverture(message: string, container: HTMLElement | null): void {
		errorMessage = message;
		errorLogin = null;
		errorAction = null;
		phase = "error";
		render(container);
	}

	/** Arrête la veille et retire les écouteurs ; ne touche pas à la phase. */
	function arreterAttenteWeb(): void {
		if (!attenteWeb) return;
		attenteWeb.arreter?.();
		attenteWeb.retirer();
		attenteWeb = null;
	}

	/** Annuler = défaire l'ouverture : la demande revient dans le composer. */
	function annulerAttenteWeb(): void {
		arreterAttenteWeb();
		restoreComposerMessage();
		phase = "idle";
		render(containerRef);
	}

	/**
	 * LE SEUL chemin par lequel une réponse copiée devient un quiz, qu'elle
	 * vienne de la veille du principal ou d'un collage manuel. Ensuite, la
	 * même suite qu'une génération : la page du quiz enregistré.
	 */
	async function recevoirReponse(texte: string): Promise<void> {
		if (phase !== "web" || disposed) return;
		arreterAttenteWeb();
		try {
			generatedQuestions = parseReponseQuiz(texte);
			if (generatedQuestions.length === 0) throw new Error(t("ai.err.notAnArray"));
		} catch (err) {
			errorMessage = (err as Error).message || t("ai.error.checkSettings");
			errorLogin = null;
			errorAction = "reopen";
			generatedQuestions = [];
			phase = "error";
			render(containerRef);
			return;
		}
		lastUsage = null;
		generationId++;
		generatedDraft = null;
		phase = "result";
		const navigated = await saveGeneratedQuiz();
		if (!navigated) render(containerRef);
	}
```

Retirer la ligne `void marque;` si `marque` n'est pas utilisée (elle ne l'est pas : la supprimer avec sa déclaration).

- [ ] **Step 4: Le rendu de la phase**

Dans `render`, à côté de `errorZone`/`connexionZone` :

```ts
		const webZone = phase === "web" ? ajouter(stage, "div", "qbd-ai-loading-zone") : null;
```

La bulle « envoyé » : la condition `if (sentMessage && (phase === "loading" || phase === "error" || phase === "connexion"))` gagne `|| phase === "web"`. L'aiguillage : `else if (phase === "web") renderWeb(webZone!);`. Le bouton d'envoi : en phase « web », il ne doit rien lancer ; ajouter dans la branche `estCanalWeb` du bouton (tâche 0) : `if (phase === "web") { sendBtn.disabled = true; }` n'est PAS nécessaire, `updateGenerateBtn` le masque quand le composer est vide. Retirer la notice `notWiredYet` du clic (tâche 0) et brancher `sendBtn.addEventListener("click", () => { if (canGenerate()) startGeneration(containerRef); });` comme la branche CLI : c'est `ouvrirSite` qui dit « non câblé ».

```ts
	function renderWeb(parent: HTMLElement): void {
		if (!attenteWeb) return;
		const site = attenteWeb.site;
		const carte = ajouter(parent, "div", "qbd-ai-preview-loading qbd-ai-web-card");
		const iconWrap = ajouter(carte, "div", "qbd-ai-loading-icon");
		host.ui.setIcon(iconWrap, "clipboard-copy");
		ajouter(carte, "p", "qbd-ai-loading-title", t("ai.web.title", { site }));
		/* Le presse-papier d'abord, quand la question n'a pas tenu dans
		   l'adresse : il faut coller là-bas AVANT d'envoyer. */
		if (attenteWeb.ouverture.mode === "presse-papier") ajouter(carte, "p", "qbd-ai-web-line qbd-ai-web-line--first", t("ai.web.copied", { site }));
		/* Le callout reproduit le bandeau que claude.ai affichera (fond rouge
		   sombre, icône d'alerte, texte rouge clair) : l'utilisateur le
		   reconnaît quand il le voit là-bas, et sait déjà pourquoi il est là
		   (demande d'Ahmed, 2026-09-18). */
		const callout = ajouter(carte, "div", "qbd-ai-web-callout");
		host.ui.setIcon(ajouter(callout, "span", "qbd-ai-web-callout-icon"), "triangle-alert");
		ajouter(callout, "p", "qbd-ai-web-callout-text", t("ai.web.callout", { site }));
		ajouter(carte, "p", "qbd-ai-web-line qbd-ai-web-line--strong", host.collage ? t("ai.web.auto") : t("ai.web.manual"));
		const actions = ajouter(carte, "div", "qbd-ai-web-actions");
		const reopen = ajouter(actions, "button", "qbd-btn qbd-btn--ghost", t("ai.web.reopen", { site }));
		reopen.type = "button";
		/* Rouvrir = rejouer l'ouverture, avec un jeton neuf : le même chemin
		   que « Réessayer » (restore puis startGeneration), qui repasse par
		   ouvrirSite. */
		reopen.addEventListener("click", () => { arreterAttenteWeb(); relancerApresErreur(); });
		const cancel = ajouter(actions, "button", "qbd-btn qbd-btn--ghost", t("ai.web.cancel"));
		cancel.type = "button";
		cancel.addEventListener("click", annulerAttenteWeb);
	}
```

Dans `renderError`, avant le bouton « Réessayer » :

```ts
		if (errorAction === "reopen" && attenteWebSite) {
			const reopenBtn = ajouter(errorEl, "button", "qbd-btn qbd-btn--ghost qbd-ai-error-retry", t("ai.web.reopen", { site: attenteWebSite }));
			reopenBtn.addEventListener("click", () => { relancerApresErreur(); });
			return;
		}
```

`attenteWebSite` : comme `attenteWeb` est remis à null par `arreterAttenteWeb` avant l'erreur, garder le nom du site dans une variable `let attenteWebSite = "";` posée dans `ouvrirSite` (`attenteWebSite = site;`) et effacée dans `resetGeneration`. `relancerApresErreur` fait `restoreComposerMessage()` puis `startGeneration`, qui repasse par `ouvrirSite` puisque le canal est toujours web : c'est bien « rouvrir avec un jeton neuf ».

Dans `dispose` : `arreterAttenteWeb();` après `couperSondeConnexion();`. Dans `resetGeneration` : `arreterAttenteWeb(); errorAction = null; attenteWebSite = "";`.

- [ ] **Step 5: Le CSS**

Dans `src/assets/css/dashboard/dashboard-ai.css`, ajouter `.qbd-ai-stage--web` à chacune des quatre listes de sélecteurs qui énumèrent `--idle, --loading, --error` (lignes ~18, ~31, ~38, ~59, ~67 : vérifier avec `grep -n "qbd-ai-stage--error"`). Puis, après `.qbd-ai-preview-loading` (chercher sa règle) :

```css
/* ── La carte d'attente du canal web ──
   Même surface que le loader (elle vit au même endroit, au-dessus du
   composer) : un titre, deux ou trois lignes, deux boutons fantômes. La
   ligne forte est celle qui dit ce qui va se passer (« le quiz se crée ici
   tout seul »). */
.qbd-ai-web-card {
	gap: 8px;
}

.qbd-ai-web-line {
	margin: 0;
	font-size: 12.5px;
	line-height: 1.5;
	color: var(--text-muted);
	text-align: center;
	max-width: 46ch;
}

.qbd-ai-web-line--strong {
	color: var(--text-normal);
	font-weight: 500;
}

.qbd-ai-web-line--first {
	color: var(--text-normal);
}

.qbd-ai-web-actions {
	display: flex;
	gap: 10px;
	margin-top: 6px;
}

/* Le callout au style du bandeau de claude.ai (relevé à l'écran le
   2026-09-18) : fond rouge sombre translucide, bordure rouge, icône
   d'alerte à gauche, texte rouge clair. Les couleurs viennent de
   --color-red pour suivre le thème, pas du rouge exact de claude.ai. */
.qbd-ai-web-callout {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	max-width: 52ch;
	padding: 11px 14px;
	border-radius: 8px;
	background: color-mix(in srgb, var(--color-red) 12%, transparent);
	border: 1px solid color-mix(in srgb, var(--color-red) 40%, transparent);
	text-align: left;
}

.qbd-ai-web-callout-icon {
	display: inline-flex;
	flex-shrink: 0;
	margin-top: 2px;
	color: var(--color-red);
}

.qbd-ai-web-callout-icon svg {
	width: 16px;
	height: 16px;
}

.qbd-ai-web-callout-text {
	margin: 0;
	font-size: 12.5px;
	line-height: 1.5;
	color: color-mix(in srgb, var(--color-red) 80%, var(--text-normal));
}
```

Regarder `.qbd-ai-preview-loading` pour savoir s'il est en `display: flex; flex-direction: column; align-items: center` (sinon le poser sur `.qbd-ai-web-card`).

- [ ] **Step 6: Vérifier**

Run: `npm run check && npm run check:host && npm run check:app && npm run check:web-channel && npm run check:dashboard-dom && npm run check:view-enter`
Expected: tout en 0.

- [ ] **Step 7: Le test manuel, dans l'application**

Run: `npm run app:dev` (ou laisser tourner celui qui l'est). Dans « Générer », canal Claude · claude.ai :

1. Une demande courte (« Crée un quiz de 3 questions sur la Révolution française ») → « Ouvrir » : claude.ai s'ouvre avec le texte entier dans le champ, le bandeau rouge, la carte d'attente dans l'app avec le callout rouge (même allure que le bandeau de claude.ai) et « le quiz se crée ici tout seul ». Envoyer sur claude.ai. Quand la réponse arrive, cliquer « Copier » sur le bloc de code. Attendu : la fenêtre clignote dans la barre des tâches ; en revenant, la page du quiz enregistré est ouverte, sans aucun clic.
2. Une demande avec deux notes jointes lourdes (au-delà d'`URL_MAX` une fois encodées) → la carte dit d'abord « colle-le dans claude.ai » ; claude.ai s'ouvre nu ; Ctrl+V dans son champ ; le reste comme en 1.
3. Pendant l'attente, copier un texte quelconque (une phrase) : rien ne se passe dans l'app. Puis coller cette phrase dans la page (clic hors du composer, Ctrl+V) : l'écran d'erreur « pas un quiz » avec le bouton « Rouvrir claude.ai » ; le cliquer rouvre le site avec la question.
4. Pendant l'attente, Esc : la demande revient dans le composer, pièces jointes comprises.
5. Une demande avec une image jointe : la notice « Les images ne peuvent pas être envoyées à un site », rien ne part, le composer garde tout.
6. Canal ChatGPT · chatgpt.com : la notice « aperçu du design », la demande revient.
7. Canal Claude · Claude Code CLI : une génération normale, inchangée.

Noter dans le commit ce qui a été vu.

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/ai.ts src/assets/css/dashboard/dashboard-ai.css src/i18n/en/ai.ts src/i18n/fr/ai.ts
git commit -m "$(cat <<'EOF'
Générer par claude.ai : le site s'ouvre avec la question, la réponse copiée devient le quiz

Sur le canal claude.ai, « Ouvrir » compose le même prompt qu'un CLI, y
ajoute la consigne de forme et le jeton, et ouvre claude.ai/new?q= (le
presse-papier au-delà de la borne). La page passe en phase « web » : la
veille du principal ne livre que la réponse qui porte le jeton, et
recevoirReponse la lit par le parseur existant puis enregistre le quiz,
sans confirmation. Trois gestes : Ouvrir, Envoyer, Copier. Esc annule ;
un collage hors du composer reste un second chemin ; « pas un quiz »
propose de rouvrir le site, pas de réessayer. Les images sont refusées.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Le changelog et la note du vault

**Files:**
- Modify: `CHANGELOG.md` (section `## [Unreleased]`)
- Modify (par un agent haiku, jamais la session principale) : `C:\obsidian-vaults\Personal\Projets\Neo Quiz\Objectifs & Idées.md`, callout `[!goal] 8.`

- [ ] **Step 1: Le changelog**

Sous `## [Unreleased]`, ajouter une section `### Added` (avant `### Changed`) :

```markdown
### Added
- Generate with claude.ai, from the provider menu: the site opens with your question already typed in, you send it and copy the answer, and the quiz is created in Neo Quiz on its own. The menu now lists one line per brand (Claude, ChatGPT, Perplexity, Ollama) and lets you pick the channel, the CLI on your machine or the website, on a second level. chatgpt.com and perplexity.ai are listed but not wired up yet.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
CHANGELOG : générer par claude.ai

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: La note du vault, par un agent haiku**

Dispatcher un agent haiku avec ce texte exact à ajouter dans le callout `> [!goal] <span class="num">8.</span> \`desktop-v1.2.3\` — version future`, après la tranche « Les CLI : installer et connecter sans terminal » (chaque ligne préfixée par `> `) :

```
> <span class="tranche">**Générer par un site (claude.ai)**</span> (`docs/superpowers/plans/2026-09-18-generation-web.md`, neuf tâches T0 à T8 ; `[/]` = en cours, `[x]` = revue close)
> - [x] <span class="num">T0.</span> **Le menu des fournisseurs a deux niveaux** : la marque, puis le canal (CLI ou site) ; chevron accent sur la marque en usage, coche sur le canal (SHA)
> - [x] <span class="num">T1.</span> **La borne d'URL est mesurée** par `report:url-max`, posée dans `URL_MAX` (SHA)
> - [x] <span class="num">T2.</span> **Les prompts et le parseur sortent de la closure** du client IA, `check:web-channel` (SHA)
> - [x] <span class="num">T3.</span> **Le texte d'un site** : bloc de code, jeton, adresse ou presse-papier ; `Canal.web` sur claude.ai (SHA)
> - [x] <span class="num">T4.</span> **`HostShell.openUrl`** sous les deux hôtes, borne de copie à 512 Ko (SHA)
> - [x] <span class="num">T5.</span> **Le noyau pur de l'attente** sous jeton, `check:electron-collage` (SHA)
> - [x] <span class="num">T6.</span> **La veille du principal** : pont, preload, canaux, `HostCollage` (SHA)
> - [x] <span class="num">T7.</span> **La page** : ouvrir, attendre, recevoir ; trois gestes, aucune confirmation (SHA)
> - [x] <span class="num">T8.</span> CHANGELOG et cette tranche (SHA)
> - [ ] <span class="num">T9.</span> **À câbler après leur mesure** : chatgpt.com et perplexity.ai (préremplissage par l'adresse, envoi automatique ou non, borne), en posant leur `Canal.web`
```

en remplaçant chaque `(SHA)` par le SHA court du commit de la tâche (`git log --oneline -12`). L'agent lit d'abord la note pour respecter la forme des lignes voisines.

---

## Self-review

- **Couverture de la spec** : §0 gestes → contrainte globale et tâche 7 ; §1 `Canal.web`, `estCanalCable` → tâche 3 ; §2 `composerPrompts`, `texteWeb`, jeton, images → tâches 2, 3, 7 ; §3 `preparerOuverture`, `URL_MAX`, `openUrl`, borne de copie, `copyFailed` → tâches 1, 3, 4, 7 ; §3 bis `HostCollage` → tâche 6 ; §4 phase web, veille, règles, clignotement, collage manuel, Esc → tâches 5, 6, 7 ; §5 `parseReponseQuiz`, `recevoirReponse`, `errorAction` → tâches 2, 7 ; §7 → tâches 4, 5, 6 ; §8 contrôles → tâches 2, 3, 4, 5, 6 ; §9 i18n, CHANGELOG, note → tâches 7, 8 ; §10 hors périmètre → contrainte « seul claude.ai ».
- **Placeholders** : `<N>` en tâche 1 est une valeur MESURÉE par la tâche elle-même, pas un TBD : l'étape 5 dit comment la calculer.
- **Types** : `ResultatOuverture` (tâche 3) est ce que `attenteWeb.ouverture` porte (tâche 7) ; `HostCollage.attendre` rend `() => void` (tâche 6), stocké dans `attenteWeb.arreter` (tâche 7) ; `composerPrompts(prompt, { count, type, source })` (tâche 2) reçoit les mêmes champs que `client.generate` recevait (tâche 7) ; `PHRASE_FINALE_CLI` est exportée de `ai-client.ts` et importée par `ai-web.ts` (tâches 2, 3).
