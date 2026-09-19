# Le parcours fournisseur IA — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qu'un utilisateur qui vient d'installer un fournisseur IA arrive à
générer son premier quiz sans jamais rencontrer « pas connecté » par
surprise : le terminal dit vrai et se ferme seul, la connexion est vérifiée
avant l'envoi (Claude, Codex, et Ollama par son API), les modèles Ollama
hors plan sont marqués, l'avertissement claude.ai devient un modal.

**Architecture:** Le processus principal Electron (`process.ts`) compose les
scripts PowerShell à partir d'une liste unique de dossiers de CLI et d'un
gabarit conditionné au code de sortie. Le code partagé (`ai-providers.ts`)
gagne des fonctions PURES ou passant par le contrat d'hôte (`net.fetchJson`)
pour le compte Ollama (`/api/me`), le catalogue (`/api/tags`) et le plan
requis ; `ai.ts` les câble dans le hint existant, la carte d'attente
existante et le menu de modèles. Aucun nouveau canal IPC, aucun nouveau
droit.

**Tech Stack:** TypeScript strict ESM, Electron (processus principal), les
scripts `check-*.mjs` du dépôt (`withSrcModule` + `makeReporter`, faux hôte).
Pas de framework de test.

**Spec:** `docs/superpowers/specs/2026-09-19-parcours-fournisseur-ia-design.md`

## Global Constraints

- **Jamais de chaîne visible en dur** : tout passe par `t("ai.x")` /
  `t("app.x")`. L'anglais (`src/i18n/en/*.ts`) est la référence ; le
  français est typé `Record<keyof typeof EN_X, string>` (une clé oubliée =
  erreur de compilation). Ne jamais traduire les identifiants de canaux
  (`claude-code`, `codex`, `ollama`, `claude-web`), les clés de réglages, les
  classes CSS.
- **Commentaires en français**, denses et justifiés comme le code voisin
  (« pourquoi », pas « quoi »).
- **Le rendu n'importe jamais un module qui tire Node** (`npm run check:host`
  assertion 6). Tout ce qui touche `child_process`, `fs`, `electron` vit dans
  `apps/windows/electron/`.
- **Les modèles ne sont jamais codés en dur** : aucune liste de modèles
  gratuits/payants dans le code. Seules sources : `required_plan` des
  recommandations, et le 402 appris.
- **Le rendu n'envoie qu'un NOM d'outil** au principal (`estOutilAutorise`) ;
  la recette PowerShell vit dans `process.ts`.
- **Icônes Lucide** par `host.ui.setIcon`, jamais d'emoji.
- **Chaque tâche qui change quelque chose de visible écrit sa ligne sous
  `## [Unreleased]` de `CHANGELOG.md`** (`### Added` / `### Changed` /
  `### Fixed`), en anglais, dans son propre commit.
- **Juger un script de contrôle sur son CODE DE SORTIE**, jamais sur la fin
  de sa sortie. Les scripts posent `process.exitCode`, jamais
  `process.exit()`.
- **Discriminance** : tout cas neuf d'un `check-*.mjs` est éprouvé en
  cassant la règle, en voyant rougir, puis en restaurant. Le plan le dit à
  chaque fois.
- Après toute modification TS : `npm run check` (greffon) et
  `npm run check:app` (application, rendu + principal).
- Commits en français, message impératif court, corps qui dit le
  pourquoi. Terminer par la ligne d'attribution en vigueur dans la session.

---

## Carte des fichiers

| Fichier | Rôle dans ce plan |
|---|---|
| `apps/windows/electron/process.ts` | `dossiersCli`, gabarit des scripts, `MessagesTerminal`, `argumentsTerminal` sans `-NoExit` (T1) |
| `src/cli-install-cmd.ts` | Claude en sous-processus dans `commandeInstallationLancee` (T1) |
| `apps/windows/electron/canaux.ts` | Passe les trois messages aux scripts (T1) |
| `src/i18n/{en,fr}/app.ts` | Messages de fin et d'échec du terminal (T1) |
| `scripts/check-electron-process.mjs` | Cas des scripts (T1) |
| `src/dashboard/ai-providers.ts` | `checkOllamaCompte`, catalogue `/api/tags`, `fetchOllamaPlansRequis`, `planRequisPour`, `modeleHorsPlan`, `erreurOllamaHorsPlan`, `Canal.avertissement` (T2, T6) |
| `src/types/dashboard-ctx.ts`, `src/dashboard/ai-settings-host.ts` | Réglages `aiOllamaPlansAppris`, `aiOllamaPlanCompte`, `aiWebAvertissementMasque` (T2) |
| `scripts/check-ai-providers.mjs` | Cas `/api/me`, `/api/tags`, plans, 402 (T2) |
| `src/dashboard/ai-client.ts` | 402 → erreur « hors plan » apprise ; 401 Ollama → `besoinConnexion: "ollama"` (T3) |
| `src/dashboard/ai.ts` | Carte d'erreur « Mettre à niveau » (T3) ; sondes anticipées, hint, connexion Ollama, annulation (T4) ; badge Pro dans la liste et le trigger (T5) ; modal claude.ai (T6) |
| `src/dashboard/ai-install-modal.ts` | `onClose` reçoit « détecté ou non » (T4) |
| `src/dashboard/ui-select.ts` | `ModelOption.upgrade`, ordre coche/icône (T5) |
| `src/assets/css/components/ui-select.css` | `flex: 1`, lien « Mettre à niveau » (T5) |
| `src/assets/css/dashboard/dashboard-ai.css` | Callout claude.ai aux couleurs mesurées, modal (T6) |
| `src/i18n/{en,fr}/ai.ts` | Chaînes nouvelles et textes Codex (T3, T4, T5, T6, T7) |
| `CHANGELOG.md` | Une ligne par changement visible (T1, T3, T4, T5, T6, T7) |

---

### Task 1 : Le terminal dit vrai et se ferme seul

**Files:**
- Modify: `apps/windows/electron/process.ts` (bloc « INSTALLER UN CLI », ~l. 236-350 ; `environnementEnfant` ~l. 523-553)
- Modify: `src/cli-install-cmd.ts` (`commandeInstallationLancee`)
- Modify: `apps/windows/electron/canaux.ts` (~l. 740-786)
- Modify: `src/i18n/en/app.ts` (~l. 119-125), `src/i18n/fr/app.ts` (~l. 84-85)
- Modify: `scripts/check-electron-process.mjs` (~l. 170-275)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces (process.ts) :
  ```ts
  export function dossiersCli(env?: NodeJS.ProcessEnv): string[];
  export interface MessagesTerminal { succes: string; echec: string; echecInstallation?: string }
  export function scriptInstallation(tool: Outil, titre: string, messages: MessagesTerminal): string;
  export function scriptConnexion(tool: Outil, titre: string, messages: MessagesTerminal): string | null;
  export function argumentsTerminal(titre: string, script: string): string[]; // sans -NoExit
  ```
- Produces (cli-install-cmd.ts) : `commandeInstallationLancee("claude", true)` rend
  `powershell -ExecutionPolicy Bypass -c "irm https://claude.ai/install.ps1 | iex"`.
- Clés i18n nouvelles : `app.installCli.failed`, `app.connectCli.failed` ;
  modifiées : `app.installCli.done`, `app.connectCli.done`.

- [ ] **Step 1 : Écrire les cas qui échouent dans `check-electron-process.mjs`**

Dans le bloc `{ const claude = scriptInstallation(...) ... }` (~l. 179), REMPLACER les cas
existants sur les scripts par ceux-ci (les anciens supposent le REPL `claude`, le
message inconditionnel et `-NoExit` — trois choses que cette tâche retire). Ajouter
`dossiersCli` à la liste des imports de `withSrcModule("apps/windows/electron/process.ts", …)`.

```js
/* ── LE TERMINAL DIT VRAI ET SE FERME SEUL (2026-09-19) ──

   CE QUE CES CAS EMPÊCHENT, vu dans la VM le 2026-09-18 : le script rechargeait
   le PATH du REGISTRE, alors que l'application détecte les CLI par un PATH
   ÉTENDU (`~/.local/bin`, où `install.ps1` pose `claude.exe`). Quand
   l'installateur n'écrit pas ce dossier dans le PATH utilisateur, l'app disait
   « installé » et le terminal « terme non reconnu » — puis affichait quand
   même « Claude Code est connecté », parce que le `Write-Host` suivait la
   commande sans condition. */
const msgs = { succes: "c'est fini", echec: "raté", echecInstallation: "install ratée" };
const envDossiers = { USERPROFILE: "C:\\U\\x", HOME: "C:\\U\\x", LOCALAPPDATA: "C:\\U\\x\\AppData\\Local", APPDATA: "C:\\U\\x\\AppData\\Roaming" };
{
	const dossiers = dossiersCli(envDossiers);
	r.check("dossiersCli : les dossiers des installateurs officiels y sont",
		{
			local: dossiers.includes("C:\\U\\x\\.local\\bin"),
			codex: dossiers.includes("C:\\U\\x\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin"),
			npm: dossiers.includes("C:\\U\\x\\AppData\\Roaming\\npm"),
		},
		{ local: true, codex: true, npm: true });
	for (const outil of ["claude", "codex"]) {
		const inst = scriptInstallation(outil, "Neo Quiz - " + outil, msgs);
		const cx = scriptConnexion(outil, "Neo Quiz - " + outil, msgs);
		for (const [nom, script] of [["installation", inst], ["connexion", cx]]) {
			r.check(outil + " " + nom + " : le titre de la fenêtre est la première ligne",
				script.startsWith("$host.UI.RawUI.WindowTitle = 'Neo Quiz - " + outil + "'"), true);
			r.check(outil + " " + nom + " : le PATH reçoit le registre ET chaque dossier des CLI",
				{
					registre: script.includes("GetEnvironmentVariable('Path','User')"),
					dossiers: dossiers.every(d => script.includes(d.replace(/'/g, "''"))),
				},
				{ registre: true, dossiers: true });
			const login = outil === "claude" ? "claude auth login" : "codex login";
			r.check(outil + " " + nom + " : la connexion est la sous-commande, jamais le REPL",
				{ login: script.includes("\n" + login + "\n"), repl: /\nclaude\s*\n/.test(script) }, { login: true, repl: false });
			r.check(outil + " " + nom + " : le PATH est rechargé AVANT la connexion",
				script.indexOf("GetEnvironmentVariable('Path','User')") < script.indexOf("\n" + login), true);
			/* Le message de succès n'est atteint que si la connexion a rendu 0 ;
			   l'échec est dans l'autre branche et RETIENT la fenêtre (Read-Host). */
			const iSucces = script.indexOf("Write-Host 'c''est fini'");
			const iEchec = script.indexOf("Write-Host 'raté'");
			const iIf = script.indexOf("if ($LASTEXITCODE -eq 0)");
			const iElse = script.indexOf("} else {");
			r.check(outil + " " + nom + " : le succès est conditionné au code de sortie de la connexion",
				{ ordre: iIf > 0 && iIf < iSucces && iSucces < iElse && iElse < iEchec, apresLogin: iIf > script.indexOf("\n" + login) },
				{ ordre: true, apresLogin: true });
			r.check(outil + " " + nom + " : succès → la fenêtre se ferme seule après deux secondes ; échec → elle reste",
				{ sleep: script.slice(iSucces, iElse).includes("Start-Sleep -Seconds 2"), reste: script.slice(iEchec).includes("Read-Host") },
				{ sleep: true, reste: true });
		}
		/* L'installation qui échoue n'enchaîne pas la connexion : le test de
		   son code de sortie précède la ligne de connexion. */
		const iInstall = inst.indexOf(commandeInstallationLancee(outil, true));
		const iGarde = inst.indexOf("if ($LASTEXITCODE -ne 0)");
		r.check(outil + " installation : un installateur qui échoue arrête le script avec son message, avant la connexion",
			{ ordre: iInstall > 0 && iGarde > iInstall && iGarde < inst.indexOf("\n" + (outil === "claude" ? "claude auth login" : "codex login")), message: inst.slice(iGarde).includes("Write-Host 'install ratée'") },
			{ ordre: true, message: true });
	}
	const ollama = scriptInstallation("ollama", "Neo Quiz - Ollama", msgs);
	r.check("ollama installation : ni connexion ni REPL, le message puis la fin",
		{ login: /login|\nclaude|\ncodex/.test(ollama), succes: ollama.includes("Write-Host 'c''est fini'") }, { login: false, succes: true });
	r.check("connexion ollama : null, jamais un terminal sur rien", scriptConnexion("ollama", "t", msgs), null);

	/* ── CE QUI EST MONTRÉ EST CE QUI PART, avec DEUX écarts écrits ──
	   Ollama : deux drapeaux d'accord non interactif. Claude : la ligne
	   affichée tourne dans un SOUS-PROCESSUS, parce que `install.ps1` fait
	   `exit 1` sur chaque échec et qu'un `exit` dans un `irm | iex` lancé dans
	   la session ferme la fenêtre entière, sans un mot — le code de sortie
	   n'existerait pas, et la branche « échec » du script ne serait jamais
	   atteinte. Codex l'a déjà, sous sa forme officielle. */
	for (const outil of ["claude", "codex", "ollama"]) {
		const script = scriptInstallation(outil, "t", msgs);
		const affichee = commandeInstallation(outil, true).code;
		const lancee = commandeInstallationLancee(outil, true);
		r.check(outil + " : la ligne lancée CONTIENT la ligne affichée, et le script la contient",
			{ dansLeScript: script.includes(lancee), contient: lancee.includes(affichee) }, { dansLeScript: true, contient: true });
	}
	r.check("les écarts entre affiché et lancé sont exactement les deux admis",
		{
			claude: commandeInstallationLancee("claude", true),
			codex: commandeInstallationLancee("codex", true) === commandeInstallation("codex", true).code,
			ollama: commandeInstallationLancee("ollama", true).slice(commandeInstallation("ollama", true).code.length),
		},
		{
			claude: 'powershell -ExecutionPolicy Bypass -c "irm https://claude.ai/install.ps1 | iex"',
			codex: true,
			ollama: " --accept-source-agreements --accept-package-agreements",
		});
	r.check("hors Windows, la ligne lancée de Claude reste celle affichée (bash n'a pas ce problème)",
		commandeInstallationLancee("claude", false), commandeInstallation("claude", false).code);

	const script = "Write-Host 'é | $x'";
	const b64 = encoderCommande(script);
	r.check("encoderCommande : base64 d'UTF-16LE, aller-retour exact", Buffer.from(b64, "base64").toString("utf16le"), script);
	r.check("encoderCommande : rien d'autre que du base64", /^[A-Za-z0-9+/=]+$/.test(b64), true);
	const args = argumentsTerminal("Neo Quiz", script);
	r.check("argumentsTerminal : Start-Process, -EncodedCommand, SANS -NoExit (le script décide de rester), jamais le script en clair",
		{
			debut: args.slice(0, 2),
			troisieme: args[2].includes("Start-Process powershell.exe -ArgumentList '-ExecutionPolicy','Bypass','-EncodedCommand','" + b64),
			noExit: args[2].includes("-NoExit"),
			clair: args[2].includes("Write-Host"),
		},
		{ debut: ["-NoProfile", "-Command"], troisieme: true, noExit: false, clair: false });
}
```

Supprimer les anciens cas devenus faux : « le script finit par la connexion du
compte » (REPL), « la ligne exécutée est celle que le modal affiche » avec
`commencePar`, « l'écart … est nul pour les deux CLI », l'ancien cas
`argumentsTerminal` avec `-NoExit`, et les anciens cas de `scriptConnexion`
(remplacés par la boucle ci-dessus). Garder tout le reste du script.

- [ ] **Step 2 : Lancer le contrôle, vérifier qu'il rougit**

Run: `npm run check:electron-process`
Expected: code de sortie 1 ; les cas « dossiersCli » lèvent
(`dossiersCli is not a function`), « conditionné au code de sortie » et
« SANS -NoExit » rougissent.

- [ ] **Step 3 : `dossiersCli` dans `process.ts`**

Remplacer le corps d'`environnementEnfant` (l. 523-553) par :

```ts
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
```

Garder au-dessus de `environnementEnfant` son commentaire d'origine (l. 505-522)
en retirant la phrase qui énumérait les dossiers, désormais dans `dossiersCli`.

- [ ] **Step 4 : Le gabarit des scripts**

Remplacer `RECHARGER_PATH`, `scriptInstallation` et `scriptConnexion` (l. 279-343) par :

```ts
/** Les trois textes que la fenêtre peut afficher, traduits par `canaux.ts`
    sur la langue de l'application. `echecInstallation` n'a de sens que pour
    `scriptInstallation` ; `scriptConnexion` l'ignore. */
export interface MessagesTerminal {
	succes: string;
	echec: string;
	echecInstallation?: string;
}

/** Une chaîne littérale PowerShell entre apostrophes (la seule forme qui
    n'interpole rien) : l'apostrophe se double. */
function citerPs(texte: string): string {
	return "'" + texte.replace(/'/g, "''") + "'";
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
	return null;
}

/**
 * La fin commune des deux scripts : le succès n'est affiché que si la
 * connexion a rendu 0, et la fenêtre se ferme alors seule (plus de `-NoExit`
 * dans `argumentsTerminal` : le script décide). Un échec affiche son message
 * en rouge et RETIENT la fenêtre jusqu'à Entrée — c'est le seul moment où
 * l'utilisateur a quelque chose à lire.
 */
function issue(messages: MessagesTerminal): string[] {
	return [
		"if ($LASTEXITCODE -eq 0) {",
		"  Write-Host " + citerPs(messages.succes) + " -ForegroundColor Green",
		"  Start-Sleep -Seconds 2",
		"} else {",
		"  Write-Host " + citerPs(messages.echec) + " -ForegroundColor Red",
		"  Read-Host | Out-Null",
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
		"$host.UI.RawUI.WindowTitle = " + citerPs(titre),
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
		   démarre. Le message, deux secondes, et la fenêtre se ferme. */
		lignes.push("Write-Host " + citerPs(messages.succes) + " -ForegroundColor Green", "Start-Sleep -Seconds 2");
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
		"$host.UI.RawUI.WindowTitle = " + citerPs(titre),
		rechargerPath(env),
		connexion,
		...issue(messages),
	].join("\n");
}
```

Puis dans `argumentsTerminal`, retirer `'-NoExit',` de la liste d'arguments :

```ts
	return ["-NoProfile", "-Command",
		`Start-Process powershell.exe -ArgumentList '-ExecutionPolicy','Bypass','-EncodedCommand','${encoderCommande(script)}'`];
```

et ajuster le commentaire d'en-tête du bloc (l. 236-278) : remplacer « et le
laisse ouvert pour qu'on voie l'installateur travailler puis la connexion du
compte se faire au même endroit » par « la fenêtre montre l'installateur
travailler puis la connexion, et se ferme seule quand tout a réussi ; elle
reste ouverte sur un message rouge quand quelque chose a échoué ».

- [ ] **Step 5 : Claude en sous-processus dans `cli-install-cmd.ts`**

Remplacer `commandeInstallationLancee` :

```ts
/**
 * La commande telle que le TERMINAL la lance. Identique à celle qui est
 * affichée pour Codex — c'est tout l'intérêt de ce module — et elle ne s'en
 * écarte que de deux façons, chacune écrite ici et éprouvée par
 * `npm run check:electron-process`.
 *
 * L'ÉCART D'OLLAMA. `winget` demande deux accords (source et paquet) à sa
 * PREMIÈRE utilisation, par une invite à laquelle il faut répondre. Un
 * utilisateur qui tape la commande lui-même la voit et répond ; la fenêtre que
 * le bouton ouvre, elle, resterait bloquée sur une question que personne n'a
 * demandée. Les deux drapeaux sont ajoutés ICI et pas dans le texte affiché.
 *
 * L'ÉCART DE CLAUDE (2026-09-19). `install.ps1` fait `exit 1` sur chaque
 * échec (téléchargement, somme de contrôle, `claude install`). Lancé par
 * `irm | iex` DANS la session de la fenêtre, cet `exit` ferme la fenêtre
 * entière, sans un mot — et le script de `process.ts` n'a plus de code de
 * sortie à tester, donc plus de message d'échec à montrer. Dans un
 * SOUS-PROCESSUS, l'`exit` ne tue que lui et devient `$LASTEXITCODE`. C'est
 * la forme officielle de Codex, celle qui s'est installée dans la VM d'Ahmed
 * là où la forme nue mourait. La ligne AFFICHÉE reste la ligne courte de la
 * documentation : celui qui la tape voit lui-même sa fenêtre.
 */
export function commandeInstallationLancee(outil: OutilInstallable, windows: boolean): string {
	const { code } = commandeInstallation(outil, windows);
	if (outil === "ollama" && windows) {
		return code + " --accept-source-agreements --accept-package-agreements";
	}
	if (outil === "claude" && windows) {
		return 'powershell -ExecutionPolicy Bypass -c "' + code + '"';
	}
	return code;
}
```

- [ ] **Step 6 : Les messages dans `canaux.ts` et les dictionnaires**

`src/i18n/en/app.ts`, remplacer les deux clés `done` et ajouter deux `failed` :

```ts
	"app.installCli.done": "{name} is set up. Back to Neo Quiz…",
	"app.installCli.failed": "Installing {name} failed. Close this window and try again from Neo Quiz, or follow the manual steps there.",
	"app.connectCli.done": "{name} is connected. Back to Neo Quiz…",
	"app.connectCli.failed": "Signing in to {name} failed. Close this window and try again from Neo Quiz.",
```

`src/i18n/fr/app.ts` :

```ts
	"app.installCli.done": "{name} est installé. Retour dans Neo Quiz…",
	"app.installCli.failed": "L'installation de {name} a échoué. Fermez cette fenêtre et réessayez depuis Neo Quiz, ou suivez-y les étapes manuelles.",
	"app.connectCli.done": "{name} est connecté. Retour dans Neo Quiz…",
	"app.connectCli.failed": "La connexion à {name} a échoué. Fermez cette fenêtre et réessayez depuis Neo Quiz.",
```

`app.installCli.detail` (EN) : remplacer « Close the PowerShell window when it
is finished. » par « The window closes by itself when it is done. » ; FR
équivalent : « La fenêtre se ferme d'elle-même quand c'est terminé. »

`canaux.ts`, canal `processusInstaller` (l. 763) :

```ts
		const messages = {
			succes: t("app.installCli.done", { name }),
			echec: t("app.connectCli.failed", { name }),
			echecInstallation: t("app.installCli.failed", { name }),
		};
		return lancerTerminal(titre, scriptInstallation(tool, titre, messages)) ? "lance" : "indisponible";
```

canal `processusConnecter` (l. 783) :

```ts
		const script = scriptConnexion(tool, titre, {
			succes: t("app.connectCli.done", { name }),
			echec: t("app.connectCli.failed", { name }),
		});
```

Dans le commentaire du canal de connexion, remplacer « `scriptConnexion` rend
`null` pour Ollama, qui n'a pas de compte » par « rend `null` pour Ollama,
dont le compte se connecte par le navigateur (`/api/me` rend l'adresse, voir
`ai-providers.ts`) ».

- [ ] **Step 7 : Vérifier**

Run: `npm run check:electron-process && npm run check:app && npm run check`
Expected: les trois sortent en 0.

Discriminance : dans `issue`, remplacer `-eq 0` par `-eq 1` → le cas
« conditionné au code de sortie » rougit ; restaurer. Dans `argumentsTerminal`,
remettre `'-NoExit',` → « SANS -NoExit » rougit ; restaurer.

- [ ] **Step 8 : CHANGELOG et commit**

Sous `## [Unreleased]`, créer `### Fixed` avec :

```
- The PowerShell window that installs or signs in to Claude Code or Codex now finds the tool it just installed (it looks in the same folders Neo Quiz does), only says "connected" when the sign-in actually succeeded, and closes by itself two seconds later. When something fails, the window stays open with the error instead of a false success message.
```

```bash
git add apps/windows/electron/process.ts src/cli-install-cmd.ts apps/windows/electron/canaux.ts src/i18n/en/app.ts src/i18n/fr/app.ts scripts/check-electron-process.mjs CHANGELOG.md
git commit -m "Terminal des CLI : le PATH de l'app, le succès conditionné au code de sortie, fermeture automatique"
```

---

### Task 2 : Ollama par son API — compte, catalogue, plan requis

**Files:**
- Modify: `src/dashboard/ai-providers.ts` (~l. 959-985 `fetchOllamaCloudCatalog` ; nouvelles fonctions après `checkOllama`)
- Modify: `src/types/dashboard-ctx.ts` (`AiSettings`, ~l. 35-60)
- Modify: `src/dashboard/ai-settings-host.ts` (`aiSettingsDefaults`, ~l. 43-80)
- Modify: `scripts/check-ai-providers.mjs` (~l. 100-140, le groupe catalogue ; nouveaux groupes)

**Interfaces:**
- Produces (ai-providers.ts) :
  ```ts
  export type CompteOllama =
    | { connecte: true; plan: string }
    | { connecte: false; signinUrl: string | null };
  export async function checkOllamaCompte(url?: string): Promise<CompteOllama>;   // POST /api/me
  export async function fetchOllamaCloudCatalog(): Promise<OllamaCatalogEntry[]>;  // GET https://ollama.com/api/tags
  export async function fetchOllamaPlansRequis(url?: string): Promise<Record<string, string>>; // GET /api/experimental/model-recommendations
  export function planRequisPour(tag: string, sources: { recommandations: Record<string, string>; appris: Record<string, string> }): string | null;
  export function modeleHorsPlan(planCompte: string, planRequis: string | null): boolean;
  export function erreurOllamaHorsPlan(status: number, message: string): boolean;
  export const OLLAMA_UPGRADE_URL = "https://ollama.com/upgrade";
  ```
- Réglages nouveaux (`AiSettings`) : `aiOllamaPlansAppris?: Record<string, string>` (défaut `{}`),
  `aiOllamaPlanCompte?: string` (défaut `""`), `aiWebAvertissementMasque?: string[]` (défaut `[]`).

- [ ] **Step 1 : Les cas qui échouent dans `check-ai-providers.mjs`**

Remplacer le premier groupe (« LE CATALOGUE CLOUD VIENT DE `net.fetchJson` », le
corps HTML) par :

```js
		/* ── LE CATALOGUE CLOUD VIENT DE `ollama.com/api/tags`, en JSON ──
		   Jusqu'au 2026-09-19 le module cherchait un marqueur dans le HTML de la
		   page de recherche (`x-test-search-response-title`). Ce marqueur a
		   disparu du site : la fonction n'extrayait plus AUCUNE famille et rendait
		   le repli embarqué, sans erreur, depuis une date inconnue — le défaut
		   exact que ce script existe pour voir. `/api/tags` est le catalogue
		   lui-même, structuré ; un corps qui n'est pas du JSON lève. */
		{
			const json = JSON.stringify({ models: [
				{ name: "gpt-oss:120b", modified_at: "2025-08-05T00:00:00Z", size: 1 },
				{ name: "zzz-nouveau", modified_at: "2026-09-01T00:00:00Z", size: 1 },
				{ name: "deepseek-v4-pro:0813", modified_at: "2026-08-13T00:00:00Z", size: 1 },
			] });
			const { journal, hote } = fauxHote({ reponses: { "ollama.com/api/tags": { status: 200, body: json } } });
			installHost(hote);
			const catalogue = await providers.fetchOllamaCloudCatalog().catch(() => []);
			r.check("le catalogue cloud est demandé à l'hôte, à /api/tags d'ollama.com",
				journal.filter(l => l[0] === "fetchJson"), [["fetchJson", "https://ollama.com/api/tags", "GET"]]);
			r.check("une famille inconnue découverte en ligne entre au catalogue, en « <famille>:cloud »",
				catalogue.some(m => m.value === "zzz-nouveau:cloud"), true);
			r.check("une famille DÉJÀ couverte garde le tag exact du repli, jamais un tag deviné",
				{ devine: catalogue.some(m => m.value === "gpt-oss:cloud"), exact: catalogue.some(m => /^gpt-oss:\d+b-cloud$/.test(m.value)) },
				{ devine: false, exact: true });
			r.check("le suffixe de tag d'ollama.com (« :0813 ») ne devient pas une famille à part",
				catalogue.filter(m => m.value.startsWith("deepseek-v4-pro")).length, 1);
		}
		{
			const { hote } = fauxHote({ reponses: { "ollama.com/api/tags": { status: 200, body: "<!doctype html><title>Cloud models</title>" } } });
			installHost(hote);
			const verdict = await providers.fetchOllamaCloudCatalog().then(() => "valeur", () => "leve");
			r.check("un 200 qui n'est pas du JSON LÈVE (l'appelant garde son cache) au lieu de rendre un catalogue vide", verdict, "leve");
		}
```

Ajouter, après le groupe Ollama existant (« un 200 sans JSON vaut hors ligne »),
trois groupes nouveaux :

```js
		/* ── LE COMPTE OLLAMA PAR `/api/me` ──
		   Mesuré le 2026-09-19 (Ollama 0.34.2) : 200 `{ plan, name, email… }`
		   connecté, 401 `{ error: "unauthorized", signin_url }` sinon. Seul
		   `plan` est lu ; l'adresse e-mail ne sort jamais de cette fonction. */
		{
			const { journal, hote } = fauxHote({ reponses: { "/api/me": { status: 200, body: JSON.stringify({ id: "x", email: "a@b.c", name: "A", plan: "free" }) } } });
			installHost(hote);
			const compte = await providers.checkOllamaCompte("http://localhost:11434/");
			r.check("/api/me est demandé en POST, sur l'URL réglée sans barre finale",
				journal.filter(l => l[0] === "fetchJson"), [["fetchJson", "http://localhost:11434/api/me", "POST"]]);
			r.check("200 avec plan → connecté, le plan, et RIEN d'autre", compte, { connecte: true, plan: "free" });
		}
		{
			const { hote } = fauxHote({ reponses: { "/api/me": { status: 401, body: JSON.stringify({ error: "unauthorized", signin_url: "https://ollama.com/connect?name=x&key=y" }) } } });
			installHost(hote);
			r.check("401 avec signin_url sur ollama.com → pas connecté, l'adresse à ouvrir",
				await providers.checkOllamaCompte(), { connecte: false, signinUrl: "https://ollama.com/connect?name=x&key=y" });
		}
		{
			const { hote } = fauxHote({ reponses: { "/api/me": { status: 401, body: JSON.stringify({ error: "unauthorized", signin_url: "https://attaquant.example/connect" }) } } });
			installHost(hote);
			r.check("401 avec une signin_url HORS d'ollama.com → l'adresse est refusée (on n'ouvre pas n'importe quoi)",
				await providers.checkOllamaCompte(), { connecte: false, signinUrl: null });
		}
		{
			const { hote } = fauxHote({ reponses: { "/api/me": { status: 200, body: "<html>portail</html>" } } });
			installHost(hote);
			r.check("200 sans JSON → pas connecté, sans adresse", await providers.checkOllamaCompte(), { connecte: false, signinUrl: null });
		}
		{
			const { hote } = fauxHote({ reponses: {} });
			installHost(hote);
			r.check("démon injoignable (null) → pas connecté, sans adresse", await providers.checkOllamaCompte(), { connecte: false, signinUrl: null });
		}

		/* ── LE PLAN REQUIS D'UN MODÈLE : deux sources, jamais une liste ──
		   `required_plan` des recommandations (cinq modèles, ce qu'utilise l'app
		   Ollama elle-même) et les 402 APPRIS à la génération. Aucune liste de
		   modèles gratuits n'est écrite dans le code : elle pourrirait sans
		   erreur (décision d'Ahmed, 2026-09-19). */
		{
			const recs = JSON.stringify({ recommendations: [
				{ model: "glm-5.3:cloud", required_plan: "pro" },
				{ model: "gemma4:31b-cloud", required_plan: "free" },
				{ model: "gemma4:26b" },
			] });
			const { journal, hote } = fauxHote({ reponses: { "/api/experimental/model-recommendations": { status: 200, body: recs } } });
			installHost(hote);
			const plans = await providers.fetchOllamaPlansRequis("http://localhost:11434");
			r.check("les recommandations sont lues sur le DÉMON (qui met ollama.com en cache), en GET",
				journal.filter(l => l[0] === "fetchJson"), [["fetchJson", "http://localhost:11434/api/experimental/model-recommendations", "GET"]]);
			r.check("seules les entrées qui portent required_plan sont retenues", plans, { "glm-5.3:cloud": "pro", "gemma4:31b-cloud": "free" });
		}
		{
			const { hote } = fauxHote({ reponses: {} });
			installHost(hote);
			r.check("recommandations injoignables → {} (best effort, jamais une exception)", await providers.fetchOllamaPlansRequis(), {});
		}
		{
			const sources = { recommandations: { "glm-5.3:cloud": "pro" }, appris: { "kimi-k3:cloud": "pro", "glm-5.3:cloud": "max" } };
			r.check("planRequisPour : les recommandations priment sur l'appris, l'appris couvre le reste, null sinon",
				["glm-5.3:cloud", "kimi-k3:cloud", "gpt-oss:120b-cloud"].map(t => providers.planRequisPour(t, sources)), ["pro", "pro", null]);
			r.check("modeleHorsPlan : free < pro < max < team ; null = on ne sait pas = pas hors plan",
				[
					providers.modeleHorsPlan("free", "pro"), providers.modeleHorsPlan("pro", "pro"), providers.modeleHorsPlan("max", "pro"),
					providers.modeleHorsPlan("free", "free"), providers.modeleHorsPlan("free", null), providers.modeleHorsPlan("free", "inconnu"), providers.modeleHorsPlan("pro", "inconnu"),
				],
				[true, false, false, false, false, true, false]);
			r.check("erreurOllamaHorsPlan : le 402 nu, ou le message mesuré, jamais un 403 « sign in »",
				[
					providers.erreurOllamaHorsPlan(402, ""),
					providers.erreurOllamaHorsPlan(400, "this model is not included in your free usage, add usage credits to pay as you go: https://ollama.com/settings or upgrade for included usage: https://ollama.com/upgrade"),
					providers.erreurOllamaHorsPlan(403, "please sign in"),
					providers.erreurOllamaHorsPlan(500, "boom"),
				],
				[true, true, false, false]);
		}
```

- [ ] **Step 2 : Lancer, vérifier que ça rougit**

Run: `npm run check:ai-providers`
Expected: code 1 ; le groupe catalogue demande encore `/search?c=cloud`, les
nouvelles fonctions n'existent pas.

- [ ] **Step 3 : Le catalogue par `/api/tags`**

Dans `ai-providers.ts`, remplacer le début de `fetchOllamaCloudCatalog` (l. 959-965) :

```ts
export async function fetchOllamaCloudCatalog(): Promise<OllamaCatalogEntry[]> {
	/* `https://ollama.com/api/tags` : le catalogue des modèles cloud, en JSON
	   (`{ models: [{ name, modified_at, size }] }`, vingt entrées le
	   2026-09-19). Jusqu'à cette date le module lisait le HTML de la page de
	   recherche et y cherchait `x-test-search-response-title` ; ce marqueur a
	   disparu du site, et la fonction rendait le repli embarqué sans un mot.
	   Un corps qui n'est pas du JSON, ou sans `models`, LÈVE : l'appelant garde
	   son cache ou son repli, mais ne prend pas un catalogue vide pour vrai. */
	const resp = await requireHost("net").fetchJson({ url: "https://ollama.com/api/tags" });
	if (!resp || resp.status !== 200 || !resp.body) throw new Error("catalog fetch " + (resp && resp.status));
	const data = corpsJson(resp.body) as { models?: Array<{ name?: unknown }> } | null;
	if (!data || !Array.isArray(data.models)) throw new Error("catalog body is not the Ollama tags JSON");
	/* La FAMILLE seule (« deepseek-v4-pro:0813 » → « deepseek-v4-pro ») : le
	   tag exact d'ollama.com n'est pas celui du cloud (« :cloud » / « -cloud »),
	   et la suite de la fonction compose « <famille>:cloud » pour les familles
	   neuves — comme avant, à partir du nom de la fiche. */
	const families = [...new Set(data.models
		.map(m => typeof m.name === "string" ? m.name.split(":")[0].toLowerCase() : "")
		.filter(f => /^[a-z0-9.\-]+$/.test(f)))];
```

Le reste de la fonction (`bundledMax`, boucle, `dedupeOllamaLatest`) ne change
pas. `corpsJson` est défini plus bas dans le fichier (l. 1136) : le déplacer
au-dessus de `fetchOllamaCloudCatalog` ou laisser (déclaration de fonction,
hoistée) — laisser.

- [ ] **Step 4 : Le compte, les plans, les prédicats**

Ajouter après `checkOllama` (l. ~1131), avant `corpsJson` :

```ts
/* ── LE COMPTE OLLAMA, PAR LE DÉMON ──
   Mesuré le 2026-09-19 (Ollama 0.34.2, `WhoamiHandler` de server/routes.go) :
   `POST /api/me` répond 200 `{ plan, name, email, … }` quand le démon est
   connecté à un compte ollama.com, et 401 `{ error: "unauthorized",
   signin_url }` sinon. L'adresse porte la clé publique du démon : l'ouvrir
   dans le navigateur et approuver connecte le démon — c'est ce que fait
   `ollama signin`, sans le terminal. Les modèles cloud (toute la sélection par
   défaut) en ont besoin ; jusqu'ici l'utilisateur ne l'apprenait qu'au premier
   envoi, par une erreur qui lui disait de taper une commande.

   SEUL `plan` EST LU. `email`, `name`, `avatarurl` ne sont ni conservés, ni
   journalisés, ni rendus : même règle que `checkClaudeLogin`.

   `signin_url` N'EST ADMISE QUE SUR `https://ollama.com` : c'est une adresse
   que la page va OUVRIR dans le navigateur, et un démon usurpé (un service
   qui occupe le port 11434) ne doit pas pouvoir y mettre n'importe quoi. */
export type CompteOllama =
	| { connecte: true; plan: string }
	| { connecte: false; signinUrl: string | null };

export async function checkOllamaCompte(url?: string): Promise<CompteOllama> {
	const base = (url || "http://localhost:11434").replace(/\/+$/, "");
	const resp = await requireHost("net").fetchJson({ url: base + "/api/me", method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
	const absent: CompteOllama = { connecte: false, signinUrl: null };
	if (!resp) return absent;
	const data = corpsJson(resp.body) as { plan?: unknown; signin_url?: unknown } | null;
	if (resp.status === 200 && data && typeof data.plan === "string") return { connecte: true, plan: data.plan };
	if (resp.status === 401 && data && typeof data.signin_url === "string") {
		try {
			const u = new URL(data.signin_url);
			if (u.protocol === "https:" && u.hostname === "ollama.com") return { connecte: false, signinUrl: data.signin_url };
		} catch (e) { /* illisible : sans adresse */ }
	}
	return absent;
}

/* ── LE PLAN REQUIS D'UN MODÈLE CLOUD : DEUX SOURCES, JAMAIS UNE LISTE ──
   Ollama ne publie pas la liste des modèles compris dans le plan gratuit (la
   page de prix dit « starter models » sans les nommer ; la page des réglages
   les liste, derrière la connexion). Ce qui existe : `required_plan` dans les
   recommandations (cinq modèles, ce que l'application Ollama elle-même
   affiche), et le 402 qu'un modèle hors plan rend à la génération. La page
   combine les deux et n'écrit AUCUN modèle en dur — une liste embarquée
   pourrirait sans qu'une erreur le dise (décision d'Ahmed, 2026-09-19). */

export const OLLAMA_UPGRADE_URL = "https://ollama.com/upgrade";

/** `required_plan` par tag, lu sur le DÉMON (`/api/experimental/
    model-recommendations`, qui met en cache celui d'ollama.com). Best effort :
    tout échec vaut `{}`. */
export async function fetchOllamaPlansRequis(url?: string): Promise<Record<string, string>> {
	const base = (url || "http://localhost:11434").replace(/\/+$/, "");
	const resp = await requireHost("net").fetchJson({ url: base + "/api/experimental/model-recommendations" }).catch(() => null);
	if (!resp || resp.status !== 200) return {};
	const data = corpsJson(resp.body) as { recommendations?: Array<{ model?: unknown; required_plan?: unknown }> } | null;
	const plans: Record<string, string> = {};
	for (const rec of (data && Array.isArray(data.recommendations)) ? data.recommendations : []) {
		if (typeof rec.model === "string" && typeof rec.required_plan === "string" && rec.required_plan) plans[rec.model] = rec.required_plan;
	}
	return plans;
}

/** Le plan requis d'un modèle, ou `null` si aucune source ne le sait. Les
    recommandations priment : elles viennent d'Ollama, l'appris d'une réponse
    d'erreur interprétée. */
export function planRequisPour(tag: string, sources: { recommandations: Record<string, string>; appris: Record<string, string> }): string | null {
	return sources.recommandations[tag] || sources.appris[tag] || null;
}

const ORDRE_PLANS = ["free", "pro", "max", "team"];

/** Le modèle est-il AU-DESSUS du plan du compte ? `null` (on ne sait pas) n'est
    pas hors plan : le badge informe, le 402 tranche. Un plan requis INCONNU
    vaut « au-dessus de free » : un compte gratuit le voit, un compte payant
    non — c'est le sens le plus probable d'un nom de plan qu'on ne connaît pas. */
export function modeleHorsPlan(planCompte: string, planRequis: string | null): boolean {
	if (planRequis === null) return false;
	const requis = ORDRE_PLANS.indexOf(planRequis);
	const compte = ORDRE_PLANS.indexOf(planCompte);
	if (requis < 0) return compte <= 0;
	if (compte < 0) return true;
	return requis > compte;
}

/** Un modèle hors plan : le 402 (mesuré le 2026-09-19 : « this model is not
    included in your free usage, add usage credits … or upgrade for included
    usage »), ou son message si le statut a changé. Distinct d'un défaut de
    connexion (401/403 « sign in »). */
export function erreurOllamaHorsPlan(status: number, message: string): boolean {
	if (status === 402) return true;
	const m = message.toLowerCase();
	return m.includes("not included in your") || m.includes("upgrade for included usage");
}
```

- [ ] **Step 5 : Les réglages**

`src/types/dashboard-ctx.ts`, dans `AiSettings` après `aiOllamaCatalog` :

```ts
	/** Plan requis APPRIS par un 402 à la génération, par tag de modèle cloud
	    (« kimi-k3:cloud » → « pro »). Vidé quand le plan du compte change. */
	aiOllamaPlansAppris?: Record<string, string>;
	/** Le dernier plan vu par `/api/me` (« free », « pro »…) ; "" = inconnu. */
	aiOllamaPlanCompte?: string;
	/** Les canaux web dont l'utilisateur a coché « Ne plus afficher » sur le
	    modal d'avertissement (« claude-web »). Un tableau : chaque site aura
	    peut-être le sien. */
	aiWebAvertissementMasque?: string[];
```

`src/dashboard/ai-settings-host.ts` : ajouter les trois clés au `Pick<…>` du type
de retour d'`aiSettingsDefaults` et dans l'objet :

```ts
		// Rien d'appris tant qu'aucun 402 n'est arrivé ; plan inconnu.
		aiOllamaPlansAppris: {},
		aiOllamaPlanCompte: "",
		// Le modal d'avertissement d'un site s'affiche tant qu'on ne l'a pas masqué.
		aiWebAvertissementMasque: [],
```

(`aiOllamaPlansAppris` et `aiWebAvertissementMasque` sont des objets : la
fonction en rend un neuf à chaque appel, c'est pourquoi `aiSettingsDefaults`
est une fonction.)

- [ ] **Step 6 : Vérifier**

Run: `npm run check:ai-providers && npm run check && npm run check:app`
Expected: 0.

Discriminance : dans `checkOllamaCompte`, retirer la condition
`u.hostname === "ollama.com"` → « HORS d'ollama.com » rougit ; restaurer. Dans
`erreurOllamaHorsPlan`, retirer `if (status === 402) return true;` → le cas
402 rougit ; restaurer.

- [ ] **Step 7 : Commit**

```bash
git add src/dashboard/ai-providers.ts src/types/dashboard-ctx.ts src/dashboard/ai-settings-host.ts scripts/check-ai-providers.mjs
git commit -m "Ollama par son API : le compte et le plan par /api/me, le catalogue par /api/tags, le plan requis sans liste"
```

---

### Task 3 : Le 402 reconnu et appris, la carte d'erreur « Mettre à niveau »

**Files:**
- Modify: `src/dashboard/ai-client.ts` (~l. 156-170 types d'erreur ; ~l. 985-1004 bloc d'erreur Ollama)
- Modify: `src/dashboard/ai.ts` (~l. 306, 318 états ; ~l. 1994-2035 `renderError` ; ~l. 2646 capture)
- Modify: `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces (ai-client.ts) :
  ```ts
  export type LoginRequiredError = Error & { besoinConnexion?: "claude" | "codex" | "ollama" };
  export type UpgradeRequiredError = Error & { besoinPlan?: true };
  ```
- Consumes (T2) : `erreurOllamaHorsPlan`, `OLLAMA_UPGRADE_URL`, réglage `aiOllamaPlansAppris`.
- ai.ts : `errorLogin: "claude" | "codex" | "ollama" | null`, `errorAction: "reopen" | "upgrade" | null`.
- Clés i18n nouvelles : `ai.err.ollamaPlan`, `ai.login.reason.ollama`, `ai.upgrade.button`.

- [ ] **Step 1 : Les types d'erreur et le bloc Ollama dans `ai-client.ts`**

L. 159, élargir le type :

```ts
export type LoginRequiredError = Error & { besoinConnexion?: "claude" | "codex" | "ollama" };
/** Une erreur dont la CAUSE est un plan insuffisant (Ollama 402) : la carte
    d'erreur remplace « Réessayer » par « Mettre à niveau », parce que
    réessayer rendrait le même 402. */
export type UpgradeRequiredError = Error & { besoinPlan?: true };
```

Adapter `erreurConnexion(tool: "claude" | "codex" | "ollama", message)` (l. 166)
au type élargi, et ajouter :

```ts
function erreurPlan(message: string): UpgradeRequiredError & UserFacingError {
	const e = new Error(message) as UpgradeRequiredError & UserFacingError;
	e.besoinPlan = true;
	e.userFacing = true;
	return e;
}
```

Dans le bloc d'erreur Ollama (l. ~995-1003), AVANT le test « subscription » :

```ts
				/* Un modèle hors plan : 402 « this model is not included in your
				   free usage … upgrade for included usage » (mesuré 2026-09-19).
				   Jusqu'ici il tombait dans `ollamaHttp` générique. Le plan requis
				   est APPRIS : la prochaine ouverture du menu marque ce modèle
				   « Pro » avant même de cliquer (voir ai-providers.ts,
				   planRequisPour). */
				if (erreurOllamaHorsPlan(resp.status, errLower)) {
					const appris = { ...(settings.get().aiOllamaPlansAppris || {}) };
					if (appris[model] !== "pro") {
						appris[model] = "pro";
						await settings.save({ aiOllamaPlansAppris: appris });
					}
					throw erreurPlan(t("ai.err.ollamaPlan", { model }));
				}
```

et remplacer le `throw userError(t("ai.err.ollamaSignin"))` du test
`isCloud && (401 || 403 || …)` par
`throw erreurConnexion("ollama", t("ai.err.ollamaSignin"));` — un compte non
connecté chez Ollama devient la même chose que chez Claude : une erreur qui
nomme l'outil, et la carte propose « Se connecter » (T4 câble le bouton pour
`ollama`). Importer `erreurOllamaHorsPlan` depuis `./ai-providers`.

- [ ] **Step 2 : Les chaînes**

`src/i18n/en/ai.ts` :

```ts
	"ai.err.ollamaPlan": "{model} is not included in your free Ollama account. Add usage credits or upgrade your plan, or pick a free model.",
	"ai.err.ollamaSignin": "Ollama is not connected to your account yet; cloud models need it.",
	"ai.login.reason.ollama": "Ollama is not connected to your account yet; cloud models need it.",
	"ai.upgrade.button": "Upgrade",
```

`src/i18n/fr/ai.ts` :

```ts
	"ai.err.ollamaPlan": "{model} n'est pas compris dans votre compte Ollama gratuit. Ajoutez des crédits ou passez à un plan supérieur, ou choisissez un modèle gratuit.",
	"ai.err.ollamaSignin": "Ollama n'est pas encore connecté à votre compte ; les modèles cloud en ont besoin.",
	"ai.login.reason.ollama": "Ollama n'est pas encore connecté à votre compte ; les modèles cloud en ont besoin.",
	"ai.upgrade.button": "Mettre à niveau",
```

(`ai.err.ollamaSignin` perd « Dans un terminal : ollama signin » : la carte
propose le bouton. Le greffon ne génère plus, la phrase n'y manque à personne.)

- [ ] **Step 3 : La carte d'erreur dans `ai.ts`**

L. 306 : `let errorLogin: "claude" | "codex" | "ollama" | null = null;`
L. 318 : `let errorAction: "reopen" | "upgrade" | null = null;`

Dans la capture (l. ~2646), après `errorLogin = …` :

```ts
			errorAction = (e as UpgradeRequiredError).besoinPlan ? "upgrade" : null;
```

(importer le type depuis `./ai-client`). Vérifier que les remises à `null`
d'`errorAction` (l. 2375, 2744, 2752) restent — elles y sont.

Dans `renderError`, remplacer la ligne qui pose le message (l. 2008-2009) :

```ts
		ajouter(errorEl, "p", "qbd-ai-error-msg",
			offreConnexion ? t(`ai.login.reason.${tool}`) : errorMessage);
```

(le type de `tool` couvre désormais `ollama`, la clé existe). Puis AVANT le bloc
`if (errorAction === "reopen" …)` :

```ts
		/* Hors plan : réessayer rendrait le même 402. La seule action qui a du
		   sens est d'aller changer de plan — ou de choisir un autre modèle dans
		   le menu, qui reste ouvert au-dessus. */
		if (errorAction === "upgrade") {
			const upBtn = ajouter(errorEl, "button", "qbd-btn qbd-btn--ghost qbd-ai-error-retry", t("ai.upgrade.button"));
			upBtn.type = "button";
			upBtn.addEventListener("click", () => { void host.shell.openUrl(aiProviders.OLLAMA_UPGRADE_URL); });
			return;
		}
```

`offreConnexion` (l. 2001) : `const offreConnexion = !!tool && (tool === "ollama" || !!host.process);`
— Ollama se connecte par le navigateur, l'hôte n'a pas besoin de `process`.
Le bouton « Se connecter » appelle `demarrerConnexion(tool, loginBtn)` : sa
signature s'élargit en T4 ; ici, pour compiler, élargir le paramètre
`tool: "claude" | "codex" | "ollama"` et, dans le corps, pour `ollama`, poser
provisoirement `verdict = "indisponible"` avant l'appel à `connecterCli`
(T4 remplace ce provisoire par l'ouverture du navigateur). Écrire ce
provisoire avec un commentaire `/* T4 : ouverture par le navigateur */`.

- [ ] **Step 4 : Vérifier**

Run: `npm run check && npm run check:app && npm run check:ai-providers`
Expected: 0.

- [ ] **Step 5 : CHANGELOG et commit**

Sous `### Fixed` :

```
- With a free Ollama account, picking a model that needs a paid plan now says so in plain words, with an "Upgrade" button, instead of a generic HTTP 402 error. Neo Quiz remembers it and marks that model in the menu next time.
```

```bash
git add src/dashboard/ai-client.ts src/dashboard/ai.ts src/i18n/en/ai.ts src/i18n/fr/ai.ts CHANGELOG.md
git commit -m "Ollama : le 402 hors plan devient un message clair, appris pour le menu, avec « Mettre à niveau »"
```

---

### Task 4 : La connexion anticipée (Claude, Codex, Ollama)

**Files:**
- Modify: `src/dashboard/ai.ts` (états ~l. 300-340 ; `onPick` ~l. 688 ; `ouvrirModalInstallation` ~l. 1495-1510 ; `refreshProviderStatuses` ~l. 1530-1680 ; `demarrerConnexion` / `renderConnexion` ~l. 2050-2130)
- Modify: `src/dashboard/ai-install-modal.ts` (~l. 85-100, `onClose`)
- Modify: `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts` (hint Ollama)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes (T2) : `checkOllamaCompte`, `sondeConnexion`, `isOllamaCloudModel`.
- Produces (ai.ts, internes) :
  ```ts
  type OutilCompte = "claude" | "codex" | "ollama";
  let connexionOrigine: "erreur" | "hint" = "erreur";
  let ollamaSigninUrl: string | null = null;
  async function demarrerConnexion(tool: OutilCompte, bouton: HTMLButtonElement | null, origine: "erreur" | "hint"): Promise<void>;
  function annulerConnexion(): void;
  function verifierCompte(tool: OutilCompte, hintZone, provider, force?: boolean): void;
  ```
- `InstallModalDeps.onClose(detecte: boolean)`.
- Clé i18n nouvelle : `ai.login.hintBrowser` (« Finish signing in in your browser. Neo Quiz detects it by itself. »).

- [ ] **Step 1 : Les états et l'annulation**

Près des autres `let` (~l. 323-336) :

```ts
	/** D'où la carte d'attente a été ouverte : depuis la carte d'ERREUR (retour
	    à `error` si on annule) ou depuis le HINT sous le composer (retour à
	    `idle` : il n'y a pas d'erreur à remontrer, la demande n'est jamais
	    partie). */
	let connexionOrigine: "erreur" | "hint" = "erreur";
	/** L'adresse de connexion rendue par `/api/me` d'Ollama (401), à ouvrir
	    dans le navigateur au clic sur « Se connecter ». `null` = inconnue. */
	let ollamaSigninUrl: string | null = null;
```

Remplacer l'écouteur d'« Annuler » de `renderConnexion` (l. ~2121-2125) et
ajouter la fonction :

```ts
	/** Annule l'attente : coupe la sonde, puis revient d'où l'on venait. Depuis
	    la carte d'erreur, la demande envoyée est toujours là (`sentMessage`) et
	    l'erreur se remontre ; depuis le hint, rien n'était parti. */
	function annulerConnexion(): void {
		couperSondeConnexion();
		if (phase !== "connexion") return;
		phase = connexionOrigine === "erreur" && sentMessage ? "error" : "idle";
		render(containerRef);
	}
```

```ts
		annuler.addEventListener("click", annulerConnexion);
```

Dans `onPick` du menu des marques (l. ~688) et dans `onDetected` du modal
(l. ~1502), appeler `annulerConnexion()` EN PREMIER :

```ts
					onPick: (id) => {
						/* Changer de fournisseur pendant « En attente de la connexion »
						   laissait la sonde tourner sur l'ancien outil et la carte à
						   l'écran (vu le 2026-09-18). L'attente est celle d'un
						   fournisseur : on la quitte avec lui. */
						annulerConnexion();
						void saveSettings({ aiProvider: id, aiModel: aiProviders.getProvider(id).defaultModel })
							.then(() => render(container));
					},
```

- [ ] **Step 2 : `demarrerConnexion` pour trois outils**

Remplacer la fonction (l. ~2053-2105) :

```ts
	/**
	 * Le clic sur « Se connecter », depuis la carte d'erreur ou depuis le hint :
	 * Claude et Codex → l'hôte ouvre un terminal sur la recette de connexion ;
	 * Ollama → le navigateur s'ouvre sur l'adresse que `/api/me` a rendue
	 * (c'est `ollama signin` sans le terminal). Puis la page attend que la
	 * sonde voie le compte.
	 *
	 * Les trois verdicts de l'hôte sont traités, y compris le rejet du pont
	 * (outil hors liste blanche, panne d'IPC) : sans ça, un bouton désactivé
	 * restait muet, exactement le défaut corrigé dans le modal d'installation.
	 */
	async function demarrerConnexion(tool: OutilCompte, bouton: HTMLButtonElement | null, origine: "erreur" | "hint"): Promise<void> {
		if (bouton) bouton.disabled = true;
		let verdict: "lance" | "annule" | "indisponible";
		if (tool === "ollama") {
			verdict = ollamaSigninUrl && await host.shell.openUrl(ollamaSigninUrl) ? "lance" : "indisponible";
		} else {
			try {
				verdict = await requireHost("process").connecterCli(tool);
			} catch (e) {
				console.warn(LOG_PREFIX, "connexion impossible:", e);
				verdict = "indisponible";
			}
		}
		if (verdict !== "lance") {
			if (bouton) bouton.disabled = false;
			// `annule` = l'utilisateur a dit non : rien de plus à dire.
			if (verdict === "indisponible") host.ui.notice(t("ai.login.terminalFailed"));
			return;
		}
		attendreCompte(tool, origine);
	}

	/** La carte d'attente et sa sonde, jusqu'à ce que le compte soit vu. Séparée
	    de `demarrerConnexion` parce qu'après une installation automatique le
	    terminal est DÉJÀ ouvert sur la connexion : on attend sans rien lancer. */
	function attendreCompte(tool: OutilCompte, origine: "erreur" | "hint"): void {
		couperSondeConnexion();
		connexionVue = false;
		connexionOrigine = origine;
		phase = "connexion";
		render(containerRef);
		const sonde = tool === "ollama"
			? () => aiProviders.checkOllamaCompte(settings().aiOllamaUrl).then(c => c.connecte)
			: aiProviders.sondeConnexion(tool);
		loginPoll = window.setInterval(() => {
			void sonde().then(connecte => {
				if (!connecte || loginPoll === null || disposed) return;
				couperSondeConnexion();
				connexionVue = true;
				providerHint[settings().aiProvider || ""] = null;
				render(containerRef);
				/* La seconde d'attente est ce qui rend la détection LISIBLE :
				   sans elle, la coche et ce qui suit se remplaceraient dans la
				   même image. */
				loginTimer = window.setTimeout(() => {
					loginTimer = null;
					if (disposed) return;
					if (connexionOrigine === "erreur" && sentMessage) relancerApresErreur();
					else { phase = "idle"; render(containerRef); }
				}, 1000);
			});
		}, SONDE_CONNEXION_MS);
	}
```

Poser `type OutilCompte = "claude" | "codex" | "ollama";` près de `Phase`
(l. 59). Dans `renderError`, l'appel devient
`demarrerConnexion(tool, loginBtn, "erreur")`. Dans `renderConnexion`, le
texte d'aide dépend de l'outil : garder `ai.login.hint` pour Claude et Codex
et poser `ai.login.hintBrowser` pour Ollama — la page connaît l'outil par
`settings().aiProvider` (`"ollama"`) :

```ts
		ajouter(el, "p", "qbd-ai-login-hint", settings().aiProvider === "ollama" ? t("ai.login.hintBrowser") : t("ai.login.hint"));
```

Chaînes : EN `"ai.login.hintBrowser": "Finish signing in in the browser tab that just opened. Neo Quiz detects it by itself."`,
FR `"ai.login.hintBrowser": "Terminez la connexion dans l'onglet du navigateur qui vient de s'ouvrir. Neo Quiz la détecte tout seul."`.

- [ ] **Step 3 : La sonde au choix du fournisseur et au focus : `verifierCompte`**

Ajouter près de `setHint` (l. ~1462) :

```ts
	/**
	 * Le compte est-il connecté ? Appelée pour le fournisseur ACTIF seulement,
	 * au rendu, au choix du fournisseur et au retour de focus (l'utilisateur
	 * revient du navigateur ou du terminal). Pas connecté → le hint `warn` et
	 * son bouton « Se connecter » ; connecté → rien. Le bouton Envoyer reste
	 * actif : la sonde peut se tromper (CLI d'une version qui ne répond pas au
	 * statut), et la carte d'erreur reste le filet. Le hint PRÉVIENT avant.
	 *
	 * Un hint d'ERREUR déjà posé (outil absent, serveur arrêté) prime : on ne
	 * demande pas de se connecter à un outil qui n'est pas là.
	 */
	function verifierCompte(tool: OutilCompte, hintZone: HTMLElement | null, provider: string): void {
		const id = tool === "claude" ? "claude-code" : tool;
		if (provider !== id) return;
		if (tool === "ollama" && !aiProviders.isOllamaCloudModel(settings().aiModel || "")) {
			/* Un modèle local n'a pas besoin de compte : si le hint affiché est
			   celui du compte, il tombe. */
			if (providerHint[id]?.icon === "log-in") setHint(id, hintZone, provider, null);
			return;
		}
		const sonde = tool === "ollama"
			? aiProviders.checkOllamaCompte(settings().aiOllamaUrl).then(c => { ollamaSigninUrl = c.connecte ? null : c.signinUrl; return c.connecte; })
			: aiProviders.sondeConnexion(tool)();
		void sonde.then(connecte => {
			if (disposed || (settings().aiProvider || "") !== id) return;
			const courant = providerHint[id];
			if (courant && courant.type === "err") return;
			if (connecte) {
				if (courant?.icon === "log-in") setHint(id, hintZone, provider, null);
				return;
			}
			setHint(id, hintZone, provider, {
				type: "warn", icon: "log-in",
				text: t(`ai.login.reason.${tool}`),
				action: {
					label: t("ai.login.button"), icon: "log-in",
					onClick: () => { void demarrerConnexion(tool, null, "hint"); },
				},
			});
		});
	}
```

L'appeler dans `refreshProviderStatuses` : à la fin de la branche `res.ok` de
Claude (`verifierCompte("claude", hintZone, provider)`), de Codex
(`verifierCompte("codex", …)`), et d'Ollama (`verifierCompte("ollama", …)`,
après la reconstruction d'`ollamaCtl`). Le `__focusRecheck` (l. ~1371) ne
relance aujourd'hui que si un hint `err`/`warn` est affiché : ajouter le cas
« aucun hint, mais fournisseur à compte » pour que le retour du navigateur
soit vu même après un hint tombé — remplacer la garde par :

```ts
			const aCompte = ["claude-code", "codex", "ollama"].includes(settings().aiProvider || "");
			if (!aCompte && !hintZone.querySelector(".qbd-ai-hint--err, .qbd-ai-hint--warn")) return;
```

Dans `checkOllama(...).then` (l. ~1612) la branche `res.ok` fait
`setHint("ollama", …, null)` : elle effacerait le hint du compte à chaque
re-détection. La conditionner : `if (providerHint["ollama"]?.icon !== "log-in") setHint("ollama", hintZone, provider, null);`.

Le plan du compte est stocké au passage : dans la sonde Ollama de
`verifierCompte`, quand `c.connecte`, si `c.plan !== settings().aiOllamaPlanCompte`,
`void saveSettings({ aiOllamaPlanCompte: c.plan, aiOllamaPlansAppris: {} })`
(un plan qui change efface l'appris — spec §4.2). T5 le lira.

- [ ] **Step 4 : Après l'installation automatique**

`ai-install-modal.ts` : `onClose?(detecte: boolean): void` dans
`InstallModalDeps` ; dans `openInstallModal`, retenir `let detecte = false;`
posé à `true` au moment de `couperSonde(); await deps.onDetected();`, et le
`onClose` du `requireHost("modals").open` appelle `deps.onClose?.(detecte)`.

`ai.ts`, `ouvrirModalInstallation` :

```ts
			onClose: (detecte) => {
				rafraichir();
				render(containerRef);
				/* Après une installation AUTOMATIQUE, le terminal enchaîne déjà sur
				   la connexion (process.ts) : la page passe directement en
				   « En attente de la connexion », sans un clic de plus. Sauf pour
				   Ollama, dont le compte passe par le navigateur : là, c'est le
				   hint qui le propose (on n'ouvre pas un site sans un clic). */
				if (!detecte || id === "ollama") return;
				const tool: OutilCompte = id === "claude-code" ? "claude" : "codex";
				void aiProviders.sondeConnexion(tool)().then(connecte => {
					if (!connecte && !disposed && (settings().aiProvider || "") === id) attendreCompte(tool, "hint");
				});
			},
```

- [ ] **Step 5 : Vérifier**

Run: `npm run check && npm run check:app`
Expected: 0. Puis `npm run app:dev` et, à l'écran : choisir Ollama avec un
modèle cloud, démon déconnecté (`ollama signout`) → hint « pas connecté » +
« Se connecter » → l'onglet ollama.com s'ouvre → approuver → la carte passe à
la coche puis au composer ; refaire `ollama signout`, cliquer dans la fenêtre
→ le hint revient au focus. Changer de fournisseur pendant l'attente → la
carte disparaît.

- [ ] **Step 6 : CHANGELOG et commit**

Sous `### Added` (créer la sous-section) :

```
- Neo Quiz now checks that your account is connected as soon as you pick a provider, and again when you come back to the window, instead of waiting for your first quiz to fail. When it is not, a notice under the composer offers "Sign in": a terminal for Claude Code and Codex, your browser for Ollama (cloud models need an Ollama account; no command to type).
```

Sous `### Fixed` :

```
- Switching provider while "Waiting for sign-in" was shown left that card on screen, still watching the previous tool. It is dismissed now.
- Right after "Install automatically" finishes, the page waits for the sign-in that the same window is already asking for, instead of leaving you to discover it at the first quiz.
```

```bash
git add src/dashboard/ai.ts src/dashboard/ai-install-modal.ts src/i18n/en/ai.ts src/i18n/fr/ai.ts CHANGELOG.md
git commit -m "Connexion anticipée : sonde au choix du fournisseur et au focus, hint « Se connecter », Ollama par le navigateur"
```

---

### Task 5 : Le menu Ollama — badge Pro, « Mettre à niveau », icônes alignées

**Files:**
- Modify: `src/dashboard/ui-select.ts` (`ModelOption` ~l. 360 ; `appendModelOption` ~l. 431-455)
- Modify: `src/dashboard/ai.ts` (`OllamaListItem` ~l. 130 ; `buildOllamaList` ~l. 754-790 ; `refreshTrigger` Ollama ~l. 926-935 ; `checkOllama.then` ~l. 1612)
- Modify: `src/assets/css/components/ui-select.css` (~l. 306-330)
- Modify: `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes (T2) : `fetchOllamaPlansRequis`, `planRequisPour`, `modeleHorsPlan`, `OLLAMA_UPGRADE_URL` ; réglages `aiOllamaPlanCompte`, `aiOllamaPlansAppris`.
- Produces (ui-select.ts) : `ModelOption.upgrade?: { label: string; onClick(): void }`.
- Clé i18n nouvelle : `ai.badge.pro` (« Pro »).

- [ ] **Step 1 : `ModelOption.upgrade` et l'ordre coche/icône**

`ui-select.ts`, `ModelOption` :

```ts
	/** Un lien à droite de la ligne (« Mettre à niveau » d'un modèle Ollama
	    hors plan) : il s'active sans fermer le menu ni choisir le modèle. */
	upgrade?: { label: string; onClick(): void };
```

`appendModelOption` : déplacer la création de `check` APRÈS `body`, `upgrade` et
`icon`, pour que la colonne des icônes soit la même sur toutes les lignes,
coche ou pas :

```ts
		const body = ajouter(btn, "div", "qbd-model-option-body");
		const top = ajouter(body, "div", "qbd-model-option-top");
		ajouter(top, "span", "qbd-select-option-label", m.label);
		if (m.badge) ajouter(top, "span", "qbd-model-option-badge", m.badge);
		if (m.desc) ajouter(body, "span", "qbd-model-option-desc", m.desc);
		if (m.upgrade) {
			/* Un <span role=link> et non un <button> : un bouton dans un bouton
			   n'est pas du HTML valide. Le clic est arrêté avant la ligne. */
			const up = ajouter(btn, "span", "qbd-model-option-upgrade", m.upgrade.label);
			up.setAttribute("role", "link");
			up.tabIndex = 0;
			const agir = (ev: Event): void => { ev.stopPropagation(); ev.preventDefault(); m.upgrade!.onClick(); };
			up.addEventListener("click", agir);
			up.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") agir(ev); });
		}
		// Icône à droite (Ollama : nuage = cloud, téléchargement = local non
		// installé, rien = local installé), calée à droite comme l'app Ollama.
		if (m.icon) {
			const ic = ajouter(btn, "span", "qbd-model-option-icon");
			currentHost().ui.setIcon(ic, m.icon);
		}
		const check = ajouter(btn, "span", "qbd-select-check");
		if (active) currentHost().ui.setIcon(check, "check");
```

Vérifier dans `ui-select.css` que `.qbd-select-check` n'a pas d'`order` ni de
`margin-right` qui supposait la première position ; s'il a `margin-right`,
le passer en `margin-left`.

- [ ] **Step 2 : Le CSS**

`ui-select.css`, `.qbd-model-option-body` : ajouter `flex: 1;` (sans lui, le
corps ne remplit pas la ligne et `margin-left: auto` de l'icône ne cale rien —
capture 4 du 2026-09-18). Puis :

```css
/* « Mettre à niveau » d'un modèle Ollama hors plan : un lien discret à droite
   de la ligne, avant l'icône. La ligne reste sélectionnable — le badge
   informe, le 402 tranche. */
.qbd-model-option-upgrade {
	flex-shrink: 0;
	margin-left: 12px;
	font-size: 11px;
	font-weight: 500;
	color: var(--interactive-accent);
	white-space: nowrap;
}
.qbd-model-option-upgrade:hover,
.qbd-model-option-upgrade:focus-visible {
	text-decoration: underline;
	outline: none;
}
.qbd-model-option-icon {
	/* `margin-left: auto` reste dans dashboard-ai.css ; sans `flex: 1` sur le
	   corps il n'avait aucun espace à prendre. */
}
```

(Ne pas garder la règle vide `.qbd-model-option-icon {}` : c'est une note pour
l'implémenteur, pas du CSS. Retirer `padding-left: 14px` de
`.qbd-model-option-icon` dans `dashboard-ai.css` l. 296 si les icônes ne sont
toujours pas à la même abscisse à l'écran ; sinon le laisser.)

- [ ] **Step 3 : Le plan requis dans la liste et le trigger (`ai.ts`)**

`OllamaListItem` : ajouter `horsPlan: boolean;`. Dans le `render`, avant
`buildOllamaList`, un cache des recommandations rafraîchi avec les statuts :

```ts
		/* `required_plan` des recommandations du démon, lu avec les statuts
		   (force = à l'ouverture du menu). `{}` tant que rien n'a répondu. */
		let plansRecommandes: Record<string, string> = {};
```

Dans `buildOllamaList`, `decorate` :

```ts
			const planCompte = settings().aiOllamaPlanCompte || "";
			const horsPlan = (meta: aiProviders.OllamaModelMeta): boolean => meta.cloud && !!planCompte && aiProviders.modeleHorsPlan(
				planCompte, aiProviders.planRequisPour(meta.value, { recommandations: plansRecommandes, appris: settings().aiOllamaPlansAppris || {} }));
			const decorate = (meta: aiProviders.OllamaModelMeta): OllamaListItem => {
				const installed = meta.cloud ? true : isInstalled(meta.value);
				return { value: meta.value, label: meta.label, cloud: meta.cloud,
					thinking: meta.thinking !== false, installed, icon: iconFor(meta.cloud, installed), horsPlan: horsPlan(meta) };
			};
```

(les modèles locaux ajoutés plus bas reçoivent `horsPlan: false`). À l'appel
d'`openModelMenu` (l. ~944), `models` devient :

```ts
						models: ctl.options.map(o => ({
							...o,
							badge: o.horsPlan ? t("ai.badge.pro") : undefined,
							upgrade: o.horsPlan ? { label: t("ai.upgrade.button"), onClick: () => { void host.shell.openUrl(aiProviders.OLLAMA_UPGRADE_URL); } } : undefined,
						})),
```

Dans `refreshTrigger` (l. ~926), après le nom :
`if (cur && cur.horsPlan) ajouter(trigLabel, "span", "qbd-model-option-badge", t("ai.badge.pro"));`

Dans `checkOllama(...).then`, branche `res.ok` et `provider === "ollama"`, avant
de reconstruire `ollamaCtl.options` :

```ts
				plansRecommandes = await aiProviders.fetchOllamaPlansRequis(ollamaUrl);
```

(la fonction `then` est déjà `async`).

Chaînes : EN `"ai.badge.pro": "Pro"`, FR `"ai.badge.pro": "Pro"`.

- [ ] **Step 4 : Vérifier**

Run: `npm run check && npm run check:app`
Expected: 0. À l'écran (`npm run app:dev`, compte Ollama gratuit) : les nuages
sur une même colonne, coche ou pas ; `glm-5.3` porte « Pro » + « Mettre à
niveau » (recommandations) ; générer avec `kimi-k3` → 402 → rouvrir le menu :
« Pro » sur Kimi ; cliquer « Mettre à niveau » ouvre ollama.com/upgrade sans
fermer le menu.

- [ ] **Step 5 : CHANGELOG et commit**

Sous `### Added` :

```
- On a free Ollama account, cloud models that need a paid plan carry a "Pro" badge and an "Upgrade" link in the model menu, like claude.ai does. Neo Quiz learns which ones from Ollama's own recommendations and from the models it has already been refused.
```

Sous `### Fixed` :

```
- The cloud icons in the Ollama model menu line up in one column again.
```

```bash
git add src/dashboard/ui-select.ts src/dashboard/ai.ts src/assets/css/components/ui-select.css src/i18n/en/ai.ts src/i18n/fr/ai.ts CHANGELOG.md
git commit -m "Menu Ollama : badge Pro et « Mettre à niveau » sur un compte gratuit, icônes cloud alignées"
```

---

### Task 6 : L'avertissement claude.ai en modal, plus dans la carte

**Files:**
- Modify: `src/dashboard/ai-providers.ts` (`Canal` ~l. 212-223, `MARQUES` l. 240)
- Modify: `src/dashboard/ai.ts` (`onPick` ~l. 688 ; `renderWeb` ~l. 2140-2160 ; nouvelle fonction `ouvrirAvertissementWeb`)
- Modify: `src/assets/css/dashboard/dashboard-ai.css` (~l. 2257-2286)
- Modify: `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces : `Canal.avertissement?: true` ; réglage `aiWebAvertissementMasque` (T2) lu et écrit ici.
- Clés i18n nouvelles : `ai.web.warnTitle`, `ai.web.warnDismiss`, `ai.web.warnOk`.

- [ ] **Step 1 : Le canal qui avertit**

`Canal` :

```ts
	/** Le site affiche un bandeau d'avertissement au-dessus d'une question
	    arrivée par l'adresse (claude.ai, mesuré le 2026-09-18). La page ouvre
	    alors un modal qui le montre et l'explique au CHOIX du canal, une fois,
	    tant que l'utilisateur ne l'a pas masqué. */
	avertissement?: true;
```

et sur le canal `claude-web` de `MARQUES` : `avertissement: true,`.

- [ ] **Step 2 : Le modal**

`ai.ts`, nouvelle fonction près d'`ouvrirModalInstallation` :

```ts
	/**
	 * Le modal qui montre le bandeau que le site affichera, aux couleurs du
	 * site, et dit pourquoi il est là. Ouvert au CHOIX du canal (demande
	 * d'Ahmed, 2026-09-18 : « à la place [du callout dans la carte], on ne
	 * devrait le voir que lorsque l'on sélectionne claude.ai »), et plus dans
	 * la carte d'attente. « Ne plus afficher » est un tableau de canaux dans
	 * les réglages : chaque site aura peut-être le sien.
	 */
	function ouvrirAvertissementWeb(canalId: string): void {
		const canal = aiProviders.getCanal(canalId);
		if (!canal || !canal.avertissement) return;
		if ((settings().aiWebAvertissementMasque || []).includes(canalId)) return;
		const site = canal.label;
		let masquer = false;
		requireHost("modals").open({
			className: "qbd-web-warn-modal",
			title: t("ai.web.warnTitle", { site }),
			onOpen: (m) => {
				const c = m.contentEl;
				const callout = ajouter(c, "div", "qbd-web-warn-callout");
				host.ui.setIcon(ajouter(callout, "span", "qbd-web-warn-callout-icon"), "triangle-alert");
				ajouter(callout, "p", "qbd-web-warn-callout-text", t("ai.web.callout", { site }));
				const row = ajouter(c, "label", "qbd-web-warn-dismiss");
				const box = ajouter(row, "input") as HTMLInputElement;
				box.type = "checkbox";
				box.addEventListener("change", () => { masquer = box.checked; });
				ajouter(row, "span", undefined, t("ai.web.warnDismiss"));
				const actions = ajouter(c, "div", "qbd-web-warn-actions");
				const ok = ajouter(actions, "button", "qbd-btn--create", t("ai.web.warnOk"));
				ok.type = "button";
				ok.addEventListener("click", () => m.close());
			},
			onClose: () => {
				if (!masquer) return;
				const liste = [...(settings().aiWebAvertissementMasque || [])];
				if (!liste.includes(canalId)) liste.push(canalId);
				void saveSettings({ aiWebAvertissementMasque: liste });
			},
		});
	}
```

`onPick` du menu des marques : après le `saveSettings(...).then(() => render(container))`,
enchaîner `.then(() => ouvrirAvertissementWeb(id))` — le réglage est sauvé et
la page redessinée AVANT que le modal informe (spec §5).

`renderWeb` : retirer les six lignes du callout (de `const callout = …` à
`ajouter(callout, "p", "qbd-ai-web-callout-text", …)`) et le commentaire qui
les précède.

- [ ] **Step 3 : Le CSS aux couleurs mesurées**

`dashboard-ai.css` : remplacer les trois règles `.qbd-ai-web-callout*`
(l. 2257-2286) par :

```css
/* ── Le modal d'avertissement d'un site (claude.ai) ──
   Les couleurs sont CELLES DU BANDEAU DE CLAUDE.AI, mesurées au pixel sur la
   capture du 2026-09-18 (Pièces jointes/Pasted image 20260918225705.png) :
   fond #3c0e0e, bordure #641919 sur 1 px, texte #d97272, icône #ec7e7e. Ce
   n'est PAS le rouge du thème, et c'est voulu : l'utilisateur doit RECONNAÎTRE
   le bandeau quand il le verra là-bas. Variables locales à ce bloc — elles ne
   servent nulle part ailleurs et n'entrent pas dans le thème de l'app. */
.qbd-web-warn-modal {
	--qbd-web-warn-bg: #3c0e0e;
	--qbd-web-warn-border: #641919;
	--qbd-web-warn-text: #d97272;
	--qbd-web-warn-icon: #ec7e7e;
	max-width: 480px;
}

.qbd-web-warn-callout {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 12px 16px;
	border-radius: 8px;
	background: var(--qbd-web-warn-bg);
	border: 1px solid var(--qbd-web-warn-border);
	text-align: left;
}

.qbd-web-warn-callout-icon {
	display: inline-flex;
	flex-shrink: 0;
	margin-top: 2px;
	color: var(--qbd-web-warn-icon);
}

.qbd-web-warn-callout-icon svg {
	width: 16px;
	height: 16px;
}

.qbd-web-warn-callout-text {
	margin: 0;
	font-size: 13px;
	line-height: 1.5;
	color: var(--qbd-web-warn-text);
}

.qbd-web-warn-dismiss {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 14px;
	font-size: 12.5px;
	color: var(--text-muted);
	cursor: pointer;
}

.qbd-web-warn-actions {
	display: flex;
	justify-content: flex-end;
	margin-top: 16px;
}
```

Vérifier que la carte d'attente (`.qbd-ai-web-card`) garde un espacement
correct sans le callout (`gap` du conteneur) ; ajuster `margin` de
`.qbd-ai-web-line--strong` si un trou apparaît.

- [ ] **Step 4 : Les chaînes**

EN :

```ts
	"ai.web.warnTitle": "Before opening {site}",
	"ai.web.warnDismiss": "Don't show this again",
	"ai.web.warnOk": "Got it",
```

FR :

```ts
	"ai.web.warnTitle": "Avant d'ouvrir {site}",
	"ai.web.warnDismiss": "Ne plus afficher",
	"ai.web.warnOk": "Compris",
```

- [ ] **Step 5 : Vérifier**

Run: `npm run check && npm run check:app && npm run check:theme`
Expected: 0 (les variables sont DÉFINIES dans l'arbre partagé, `check:theme`
ne les réclame pas au thème). À l'écran : choisir Claude → claude.ai → le
modal, le callout aux couleurs de claude.ai (comparer côte à côte avec la
capture) ; cocher, « Compris », rechoisir claude.ai → plus de modal ; la carte
d'attente n'a plus de callout.

- [ ] **Step 6 : CHANGELOG et commit**

Sous `### Changed` :

```
- The note about the red warning that claude.ai shows above a question sent from Neo Quiz now appears once, in a dialog when you pick claude.ai in the provider menu, with a "Don't show this again" box, instead of on every waiting card. It uses claude.ai's own colors so you recognize the banner there.
```

```bash
git add src/dashboard/ai-providers.ts src/dashboard/ai.ts src/assets/css/dashboard/dashboard-ai.css src/i18n/en/ai.ts src/i18n/fr/ai.ts CHANGELOG.md
git commit -m "claude.ai : l'avertissement devient un modal au choix du canal, aux couleurs du site, masquable"
```

---

### Task 7 : Textes, spec, note

**Files:**
- Modify: `src/i18n/en/ai.ts` (l. 117, 129), `src/i18n/fr/ai.ts` (l. 99, 108)
- Modify: `docs/superpowers/specs/2026-09-19-parcours-fournisseur-ia-design.md` (§9 Journal)
- Modify: `CHANGELOG.md`

- [ ] **Step 1 : « Codex CLI » sans article**

EN : `"ai.hint.codexNotInstalled": "Codex CLI is not installed."`,
`"ai.install.title.codex": "Codex CLI is not installed"`.
FR : `"ai.hint.codexNotInstalled": "Codex CLI n'est pas installé."`,
`"ai.install.title.codex": "Codex CLI n'est pas installé"`.

Run: `npm run check` → 0.

- [ ] **Step 2 : CHANGELOG, journal de la spec, commit**

Sous `### Changed` : `- "The Codex CLI is not installed" reads "Codex CLI is not installed".`

Spec §9 : ajouter `- <date> : plan exécuté (T1-T7), SHA de chaque tâche.`
avec les SHA des six commits précédents.

```bash
git add src/i18n/en/ai.ts src/i18n/fr/ai.ts CHANGELOG.md docs/superpowers/specs/2026-09-19-parcours-fournisseur-ia-design.md
git commit -m "Textes : « Codex CLI » sans article ; journal de la spec"
```

- [ ] **Step 3 : L'épreuve à l'écran, par Ahmed, dans la VM**

Ne se code pas : la liste de la spec §8 (terminal qui se ferme seul ; échec
qui laisse la fenêtre ; hint au choix du fournisseur ; Ollama par le
navigateur ; badge Pro après un 402 ; modal claude.ai). C'est cette épreuve,
pas les contrôles, qui décide de `git ship`.

---

## Self-review (fait à l'écriture)

- **Couverture de la spec** : §2 → T1 ; §3.1-3.3 → T4 ; §3.4 → T2 + T4 ;
  §3.5 → T4 ; §4.1 → T2 ; §4.2 → T2 + T5 ; §4.3 → T3 ; §4.4 → T5 ; §5 → T6 ;
  §6 → T1 (messages du terminal) + T7 ; §8 → chaque tâche.
- **Types** : `MessagesTerminal` (T1) est ce que `canaux.ts` passe ;
  `CompteOllama` (T2) est ce que T4 lit (`c.connecte`, `c.signinUrl`,
  `c.plan`) ; `OutilCompte` (T4) est ce que `demarrerConnexion` et
  `verifierCompte` prennent ; `ModelOption.upgrade` (T5) est ce que
  `appendModelOption` rend ; `Canal.avertissement` (T6) est ce que
  `ouvrirAvertissementWeb` lit.
- **Ordre** : T3 dépend de T2 (`erreurOllamaHorsPlan`) ; T4 de T2 et T3
  (`besoinConnexion: "ollama"`, `OutilCompte`) ; T5 de T2 et T4
  (`aiOllamaPlanCompte` écrit par `verifierCompte`) ; T6 de T2 (réglage).
  T1 et T7 sont indépendants.
