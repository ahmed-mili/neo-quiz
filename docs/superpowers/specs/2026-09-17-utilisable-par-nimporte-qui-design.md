# Utilisable par n'importe qui — design

**Date** : 2026-09-17 · **Statut** : validé en discussion, à planifier ·
**Périmètre** : l'application Windows (`apps/windows/`) et le code partagé
qu'elle consomme (`src/dashboard/`, `src/host/`, `src/markdown-preview.ts`).
Le greffon Obsidian n'est pas touché : il ne rend plus qu'un quiz.

## 0. D'où ça vient

Ahmed a installé `NeoQuiz-1.0.3.exe` dans une VM VMware vierge, sans Claude
Code ni vault, et a regardé l'application comme quelqu'un qui ne connaît ni
Obsidian ni un terminal. Six choses en sont sorties, plus un bug et deux
retouches vus dans la foulée sur sa machine. Elles forment une seule version,
`desktop-v1.2.0`, et cette spec les tient ensemble parce qu'elles se
touchent : le hint sous le composer, le menu des fournisseurs et le modal
d'installation sont trois vues du même état « Claude Code n'est pas là ».

Ce que « n'importe qui » veut dire ici, et qui gouverne chaque choix :
l'utilisateur ne sait pas ce qu'est un terminal, n'ouvrira pas PowerShell de
lui-même, ne collera pas une commande qu'il ne comprend pas, et ne créera
jamais un quiz dans un bloc de code. Tout ce qui suppose l'inverse est un
défaut.

## 1. L'accueil vide sans référence à `quiz-blocks`

**Aujourd'hui** (`src/dashboard/home.ts`, `renderOnboarding`) : icône, titre,
lead, le CTA « Générer mon premier quiz », un séparateur « ou », puis une
carte « Créer un quiz à la main » qui montre un bloc ` ```quiz-blocks `
d'exemple avec un bouton copier.

**Demain** : les quatre premiers éléments restent (le lead perd son tiret
long ; il en a un — CLAUDE.md global). Sous le séparateur, à la place de la
carte code, **les trois cartes du modal « Créer un dossier »** rendues sur
place :

| Carte | Action | Condition |
|---|---|---|
| Créer un dossier vide | `openNewFolderModal` | toujours |
| Ouvrir un dossier existant | `ctx.openExistingFolder(onDone)` | `ctx.openExistingFolder` présent (l'app) |
| Importer un quiz reçu | `importSharedFolder` | toujours |

La carte « Créer avec l'IA » du modal n'est pas répétée : le CTA au-dessus
EST cette action. Même composant (`createOptionCard` de `folder-create.ts`,
exporté ; son paramètre `modal` devient optionnel — sur l'accueil il n'y a
rien à fermer), même DOM, même CSS `qbd-create-option` : aucune nouvelle
apparence à dessiner ni à maintenir. La grille de cartes prend la largeur de
l'ancienne carte code.

**Disparaissent** : la carte code, `CODE_SAMPLE`, le bouton copier et son
usage de `ctx.copyText` dans `home.ts` ; les clés
`dashboard.onboarding.manualTitle`, `manualDesc`, `copy`, `sampleTitle`,
`samplePrompt` (en + fr) ; le CSS `qbd-onboarding-manual*`,
`qbd-onboarding-code*`, `qbd-onboarding-copy`.

**Vérification** : `npm run check` (les clés retirées ne sont plus lues nulle
part, sinon erreur de compilation), `check:dashboard-dom` (home.ts reste hors
`RESTANTS`), à l'écran dans la VM : accueil sans aucun quiz.

## 2. Les pastilles du menu des fournisseurs alignées

**Cause** (`src/assets/css/dashboard/dashboard-ai.css`) : dans une option du
menu, la pastille (`.qbd-status-dot`) et la coche (`.qbd-select-check`) ont
toutes deux `margin-left: auto`. Deux marges automatiques sur la même ligne
flex se PARTAGENT l'espace libre : plus le sous-titre est long, plus la
pastille est poussée à droite. « Claude Code non installé » > « Codex CLI non
installé » > « Non installé » : trois abscisses.

**Correctif** : `.qbd-provider-option-body { flex: 1 1 auto; min-width: 0 }` à
la place de `margin-right: 14px`. Le corps absorbe l'espace libre, il n'en
reste rien à partager : la pastille tombe au même x sur les trois lignes,
collée à gauche de la gouttière de la coche, et le `gap` de 8 px les sépare.

**Vérification** : capture du menu ouvert avec trois fournisseurs absents (la
VM), trois pastilles sur une même verticale.

## 3. Un fournisseur non installé : le modal et l'installation en un clic

### 3a. Ce qui change dans le menu et sous le composer

`ui-select.ts` (`createSelect`) reçoit deux choses : une option peut porter
`disabled: true`, et le sélecteur un `onDisabledClick?(value)`. Une option
désactivée garde exactement son apparence (logo, nom, sous-titre « non
installé », pastille rouge) — le rouge et le libellé disent déjà l'état, la
griser dirait « indisponible pour toujours » — mais un clic n'y déplace
JAMAIS la coche ni n'appelle `onChange` : il appelle `onDisabledClick`, et la
page ouvre le modal du fournisseur. `aria-disabled="true"` sur l'option.

Dans `ai.ts`, l'option d'un fournisseur est `disabled` quand son statut est
`err` (absent) ; `warn` (Ollama installé, serveur arrêté ; ou mobile) reste
sélectionnable — le hint existant sait démarrer Ollama.

Le hint sous le composer, quand le fournisseur CHOISI est absent, devient une
phrase + un bouton « Installer Claude Code » (resp. Codex CLI, Ollama) qui
ouvre le MÊME modal. La commande brute et le lien vers claude.com quittent le
hint : `installCmd` déménage dans le module du modal, seule source des
recettes manuelles. Le hint « serveur Ollama arrêté » ne change pas.

### 3b. Le modal (`src/dashboard/ai-install-modal.ts`, code partagé)

`openInstallModal(provider, deps)` — ouvert par `requireHost("modals")`,
classe `qbd-install-modal`, centré comme les autres modales de l'app. Par
fournisseur :

1. **Titre** : « Claude Code n'est pas installé » / « Le Codex CLI n'est pas
   installé » / « Ollama n'est pas installé ».
2. **Une phrase pour un profane**, ce que c'est et ce qu'il faut :
   - Claude : l'outil en ligne de commande d'Anthropic ; Neo Quiz s'en sert
     avec un compte Claude (Pro ou Max) pour générer des quiz.
   - Codex : l'outil en ligne de commande d'OpenAI ; avec un abonnement
     ChatGPT. Ce n'est PAS l'application Codex (vécu Ahmed 2026-07-12).
   - Ollama : fait tourner des modèles gratuits sur l'ordinateur, sans compte.
3. **Bouton primaire « Installer automatiquement »** (icône `download`),
   Windows seulement (`host.platform.isWindows`). Sous le bouton, une ligne :
   « Neo Quiz ouvre PowerShell et lance l'installation officielle ; vous
   verrez tout ce qui se passe. »
4. **Section repliable « Installer manuellement »** (`renderCollapsibleSection`
   de `collapsible.ts`, fermée par défaut sous Windows, OUVERTE et seule
   ailleurs), quatre étapes numérotées :
   1. Ouvrez PowerShell : touche **Windows + X**, puis **I**. (Ou : menu
      Démarrer, tapez « PowerShell », Entrée.)
   2. Copiez cette commande, collez-la dans la fenêtre (clic droit) et
      appuyez sur Entrée : `[bloc de code + bouton copier]`
   3. Quand c'est terminé, tapez `claude` puis Entrée, et suivez les
      instructions pour connecter votre compte. (Codex : `codex login`.
      Ollama : rien, l'application démarre avec l'installeur.)
   4. Revenez dans Neo Quiz : l'installation est détectée toute seule.
5. **Lien « En savoir plus »** vers la documentation officielle
   (`code.claude.com/docs/en/setup`, `learn.chatgpt.com/docs/codex/cli`,
   `ollama.com/download`).

Le bouton copier passe par `deps.copyText` (membre OPTIONNEL neuf
d'`AiPageDeps`, même forme que `DashboardShellCtx.copyText` ; l'app passe la
même fonction, `pont().systeme.copierTexte`) avec repli sur
`navigator.clipboard` — dans la fenêtre de l'app, ce repli échoue en silence
(permission refusée par le principal), c'est POURQUOI le membre existe. Le
bloc de code passe par `deps.renderCodeBlock` s'il existe, sinon un
`<pre><code>` nu — comme le hint le faisait.

**Trois états**, portés par une classe sur le panneau :

| État | Déclencheur | Ce qu'on voit |
|---|---|---|
| `initial` | ouverture | tout ce qui précède |
| `en-cours` | `installerCli` a rendu `lance` | bouton inactif, texte « Installation en cours dans PowerShell… Neo Quiz le détectera tout seul. » avec le spinner de l'app |
| `detecte` | la sonde (3d) répond `ok` | « Claude Code v1.2.3 est installé. » et un bouton « Continuer » |

Sur `detecte`, le modal ÉCRIT `aiProvider` (et `aiModel` par défaut) dans les
réglages, et « Continuer » ferme puis re-rend la page : le fournisseur est
choisi, le contrôle Modèle apparaît. Si le modal a été ouvert depuis le hint
(fournisseur déjà choisi), l'écriture est un no-op.

Deux échecs : `annule` (l'utilisateur a refusé la confirmation native) ne
change rien, l'état reste `initial` ; `indisponible` (aucun terminal n'a pu
être lancé, ou hors Windows) déplie la section manuelle et pose une Notice
`ai.install.terminalFailed`.

### 3c. Le pont : contrat, canal, confirmation, recettes, lancement

**Contrat** (`src/host/types.ts`, `HostProcess`) — un membre neuf, requis
(une seule implémentation depuis que le greffon n'a plus `process`) :

```ts
/** Ouvre un terminal VISIBLE qui installe l'outil, puis y connecte le
    compte. `lance` : le terminal est parti — c'est la sonde de l'appelant
    (checkClaudeCode…) qui constatera le résultat ; `annule` : l'utilisateur
    a refusé la confirmation de l'hôte ; `indisponible` : l'hôte ne sait pas
    ouvrir de terminal (hors Windows, ou le lancement a échoué). */
installerCli(tool: CliTool): Promise<"lance" | "annule" | "indisponible">;
```

**Canal** `CANAUX.processusInstaller` (`pont.ts`, `preload.ts`,
`apps/windows/src/host/process.ts`). Dans `canaux.ts`, les trois règles de
`processusRun` s'appliquent telles quelles :

1. **Le nom est jugé avant tout** : `estOutilAutorise(tool)` sur la liste
   blanche `OUTILS` de `process.ts`, sinon `throw erreurCli("refuse", …)`
   nommé dans la console. Rien d'autre ne traverse l'IPC : ni commande, ni
   chemin, ni URL.
2. **Confirmation native**, rédigée et traduite dans le PRINCIPAL sur la
   langue posée par `main.ts` (comme `app.aiHost.*` pour l'hôte Ollama) :
   `dialog.showMessageBox(fenetre, { type: "question", title: t("app.installCli.title", { name }), message: t("app.installCli.message", { name }), detail: t("app.installCli.detail", { url }), buttons: [t("app.installCli.run"), t("app.installCli.cancel")], defaultId: 1, cancelId: 1 })`.
   Textes : « Installer Claude Code ? » / « Neo Quiz va ouvrir PowerShell et
   y exécuter le script d'installation officiel d'Anthropic. » / « Source :
   claude.ai/install.ps1. Fermez la fenêtre PowerShell quand l'installation
   est terminée. » / [Ouvrir PowerShell et installer] [Annuler]. Fermer la
   boîte = refus → `annule`.
3. **Les recettes sont fixes dans `process.ts`**, jamais composées depuis le
   rendu. `scriptInstallation(tool): string` est PURE et rend le script
   PowerShell complet :

   | Outil | Script |
   |---|---|
   | `claude` | `irm https://claude.ai/install.ps1 \| iex` ; puis `$env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')` ; puis `claude` |
   | `codex` | `irm https://chatgpt.com/codex/install.ps1 \| iex` ; PATH idem ; `codex login` |
   | `ollama` | `winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements` |

   Le rechargement du PATH est nécessaire : `claude install` écrit le PATH
   utilisateur dans le registre, la session PowerShell ouverte ne le voit
   pas (vérifié en lisant `install.ps1` le 2026-09-17). Une ligne finale
   `Write-Host` dit, dans la langue de l'app, « Vous pouvez fermer cette
   fenêtre et revenir dans Neo Quiz. » — le script prend la langue en
   paramètre, deux chaînes `app.installCli.done*`.

**Lancement** (`lancerTerminal(script)`, `process.ts`) :

```
cmd.exe /c start "Neo Quiz — <nom>" powershell.exe -NoExit -ExecutionPolicy Bypass -EncodedCommand <base64 UTF-16LE du script>
```

`spawn("cmd.exe", …, { windowsVerbatimArguments: true, windowsHide: true, stdio: "ignore" })`, `unref()`.
`-EncodedCommand` supprime toute question de citation (le script contient
des `|`, des `'` et des `$`) ; `encoderCommande(script)` est pure
(`Buffer.from(script, "utf16le").toString("base64")`). `start` garantit une
NOUVELLE fenêtre console visible — Windows Terminal l'accueille s'il est le
terminal par défaut du système, sinon la console classique — quel que soit
l'état du parent. `detached: true` est EXCLU : libuv y pose
`DETACHED_PROCESS`, donc pas de console du tout, et PowerShell interactif
tournerait invisible. `-NoExit` garde la fenêtre ouverte : l'utilisateur
voit l'installateur travailler, puis `claude` lui demande de se connecter.

**SONDÉ LE 2026-09-17 (tâche 3 du plan), et le résultat CORRIGE ce qui
précède.** Six variantes lancées sur la machine d'Ahmed, en relevant le
`MainWindowHandle` de l'hôte de console créé (`conhost` ou
`WindowsTerminal`), parce qu'un titre de fenêtre vide ne prouve rien : sous
Windows Terminal, la fenêtre appartient à `WindowsTerminal.exe`, pas à
`powershell.exe`.

- `cmd /c start "…" powershell -NoExit -EncodedCommand` depuis un `spawn`
  de Node : un `conhost` naît à chaque fois, **`MainWindowHandle = 0`**,
  aucune fenêtre. Avec ou sans `windowsHide`, avec ou sans lanceur détaché.
- `Start-Process powershell -ArgumentList …` (donc **ShellExecute**), depuis
  un PowerShell lancé normalement : un **`WindowsTerminal` avec un handle
  réel**. C'est la seule variante qui a ouvert une vraie fenêtre, et elle
  honore le « terminal par défaut » de l'utilisateur (le relais vers Windows
  Terminal se fait tout seul).
- La même ShellExecute, sous un lanceur Node `detached`, redonne un
  `conhost` sans fenêtre.

Ce que ça dit, et ce que ça ne dit pas : la sonde tourne sous l'arbre de
processus de l'agent, dont les consoles sont masquées, et cet arbre ne sait
produire aucune fenêtre visible — l'échec des variantes `detached` ne
condamne donc pas la technique. Ce qu'elle établit, c'est que **ShellExecute
est la seule primitive qui a ouvert une fenêtre ici**, et que `cmd /c start`
n'y est jamais parvenu. `lancerTerminal` emploie donc ShellExecute :

```
powershell.exe -NoProfile -Command
  "Start-Process powershell.exe -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-EncodedCommand','<b64>'"
```

sans `detached` et sans `windowsHide` sur le processus qui ouvre la fenêtre
(le base64 ne contient que `[A-Za-z0-9+/=]`, donc les apostrophes de la liste
d'arguments PowerShell ne peuvent pas être refermées par le script). La
preuve qui manque — une fenêtre visible depuis le processus PRINCIPAL
d'Electron, qui est un vrai processus interactif — ne peut se faire qu'à
l'écran, dans l'application : c'est la vérification manuelle de la tâche 4.
Et `installerCli` ne prétend pas savoir : il rend `lance` dès que le
lancement n'a pas échoué, la DÉTECTION du CLI est ce qui confirme, et la
section manuelle du modal reste la porte de sortie.

**Hors Windows** : `installerCli` rend `indisponible` sans rien lancer. Le
modal l'a déjà prévu (section manuelle seule, commandes bash de
`installCmd`). Ouvrir « le » terminal sous Linux/macOS n'a pas de réponse
unique ; ce n'est pas le cas d'usage d'Ahmed.

### 3d. La détection après l'installation

Tant que le modal est en `en-cours`, il appelle la sonde du fournisseur
toutes les 3 s avec `force` : `aiProviders.checkClaudeCode(true)`,
`checkCodex(true)`, `checkOllama(url, true)`. Côté principal,
`resoudreExecutable` relit le PATH du registre (`chargerPathRegistre`) : une
installation fraîche se voit sans relancer l'application. Le minuteur est
coupé dans `onClose` du modal et sur `detecte` — jamais de sonde orpheline.
À la fermeture du modal, quel que soit l'état, la page appelle
`refreshProviderStatuses` pour que menu et hint reflètent le nouvel état.

### 3e. Ce qui est éprouvé

- `check:electron-process` s'étend aux fonctions PURES : pour chaque outil,
  `scriptInstallation` contient l'URL officielle et, pour Claude et Codex,
  l'étape de connexion ; `encoderCommande` produit un base64 qui, décodé en
  UTF-16LE, redonne le script. Discriminance : changer l'URL dans le script
  fait rougir le cas.
- `check:windows-host` : `process.installerCli` est une fonction de l'hôte
  de l'app (cliquet : le membre DOIT exister).
- `check:host` : `ai-install-modal.ts` n'importe rien d'Obsidian ni de Node.
- `check:app`, `check:theme` (si variable neuve).
- **À l'écran, dans la VM** : fournisseur par fournisseur, clic sur l'option
  → modal → « Installer automatiquement » → confirmation → PowerShell →
  détection → « Continuer » → le contrôle Modèle apparaît. Puis le chemin
  manuel : copier, coller, Entrée.
- `docs/superpowers/notes/controles.md` reçoit une entrée pour le canal.

## 4. « Ouvrir » sur l'aperçu d'un fichier joint par « Add files »

**Le bug** (vu le 2026-09-17) : un PDF joint par « Add files » ouvre un
aperçu SANS bouton « Ouvrir » ; le même PDF joint par « @ » l'a.

**Cause** : « Add files » passe par un `<input type="file">` du navigateur
(`ai.ts:1159`), et un `File` du rendu n'a AUCUN chemin. `poserApercuPdf`
(`ai.ts:451`) ne pose « Ouvrir » que pour `note.source === "vault"` et un
`host.fs.getFile(path)` non nul, parce que `shell.openExternal` prend un
`HostFile` et que le principal borne `systeme.ouvrir` au périmètre. Un fichier
sans origine n'a pas de bouton, par décision écrite : « proposer une action
qui échouerait vaudrait moins que rien ». La décision était juste ; c'est
l'origine qu'il faut donner au fichier.

**Correctif** : dans l'app, « Add files » passe par le **dialogue natif du
principal**, et un fichier choisi ainsi est ADMIS au périmètre pour la
session, en lecture et en ouverture — jamais en écriture.

- **Contrat** : `HostFs.external.pickFiles?(options: { accept: string[] }): Promise<string[]>`
  — OPTIONNEL (le greffon n'a pas de dialogue natif ; la page garde
  l'`<input type="file">` quand le membre manque). Rend des chemins
  ABSOLUS, comme le reste d'`external`.
- **Canal** `CANAUX.systemeChoisirFichiers` : `dialog.showOpenDialog(fenetre, { properties: ["openFile", "multiSelections"], filters })`
  — les filtres sont composés dans le PRINCIPAL depuis une union fermée
  (`"documents" | "images"`), jamais depuis une liste reçue. Chaque chemin
  choisi passe par `perimetre.autoriserFichier(abs)`.
- **Périmètre** (`perimetre.ts`) : une seconde liste, `fichiersLecture`,
  distincte des `racines`. `autoriserFichier` résout le chemin (`realpath`)
  et exige un FICHIER existant. `borner(chemin)` accepte un chemin des
  `racines` OU un fichier de `fichiersLecture` ; **`bornerEcriture(chemin)`**
  n'accepte que les `racines`. Les canaux `write`, `append`, `process`,
  `writeBinary`, `mkdirs`, `remove`, `trash`, `rename`, `copier` passent à
  `bornerEcriture` ; `read`, `readCached`, `readBinary`, `stat`,
  `statEntree`, `exists`, `ouvrir` restent sur `borner`. Le refus
  d'extension exécutable de `ouvrir` s'applique toujours (un `.bat` choisi
  dans le dialogue n'est pas ouvert — il serait EXÉCUTÉ, et c'est la
  frontière que `EXTENSIONS_EXECUTABLES` tient).
- **Page** : `openAddFiles` appelle `pickFiles` quand il existe ; pour chaque
  chemin, `attachExternalPath` (le chemin qu'emprunte déjà le picker « @ »
  pour une racine externe : `external.readBinary`, extraction PDF, vignette)
  avec `source: "external"` et `path` absolu. `poserApercuPdf` pose alors
  « Ouvrir » pour `source === "external"` aussi : **`HostShell.openExternal`
  accepte désormais `HostFile | string`**, un `string` étant un chemin
  ABSOLU ; l'hôte de l'app l'envoie tel quel à `systeme.ouvrir`, qui le
  borne (le fichier admis passe, tout autre chemin absolu est refusé comme
  avant). L'hôte du greffon garde la forme `HostFile` seule : il n'a pas de
  racine externe, et `check:obsidian-host` le fige.
- Les images déposées ou choisies (`ComposerImage`, un `File` et une
  `data:` URL) ne changent pas : elles n'ont pas d'aperçu à ouvrir.

**Vérification** : `check:electron-reglages` (les prédicats du périmètre :
un fichier admis se lit, ne s'écrit pas, ne se supprime pas ; un dossier
admis fait les deux ; un fichier hors liste ne se lit pas — discriminance
sur `bornerEcriture`), `check:windows-host` (`external.pickFiles` présent),
`check:app`. À l'écran : Add files → PDF de `Téléchargements` → aperçu →
« Ouvrir » → le lecteur PDF du système s'ouvre.

## 5. Le bouton « Add notes » retiré, Ctrl+U devient Ctrl+E

Le menu « + » du composer a deux entrées, « Add files » (Ctrl+U) et « Add
notes » (Ctrl+E). La seconde ne sert à rien : le picker « @ » fait la même
chose, mieux. Et **aucun des deux raccourcis ne fonctionne dans l'app** : le
câblage (`bindComposerHotkeys`) vivait dans la vue Obsidian, partie à la
tâche 1 du greffon lecteur ; le menu affiche un raccourci mort.

- **« Add notes » disparaît** : l'entrée du menu, `openAddNotes` et
  `addBtnRef` (qui ne servait qu'à ancrer ce picker), la clé `ai.add.notes`,
  et le réglage `hotkeyAddNotes` — IGNORÉ s'il est persisté, jamais effacé
  (même règle que les réglages de la dictée, 2026-09-11).
- **Le « + » ouvre directement le sélecteur de fichiers** : un menu à une
  seule entrée est un détour. Son infobulle : « Ajouter des fichiers
  (Ctrl+E) ».
- **`hotkeyAddFiles` a pour défaut `Mod+E`** (`aiSettingsDefaults`, la seule
  liste de défauts). Le commentaire qui justifiait Ctrl+U (claude.ai) est
  remplacé : Ctrl+E est plus facile à atteindre (demande Ahmed 2026-09-17).
- **Le raccourci FONCTIONNE** : la page « Générer » pose UN `keydown` sur son
  conteneur (pas sur `document` : deux pages ne se disputent jamais la
  touche), compare avec `eventToHotkey` de `hotkey-format.ts`, et appelle
  `openAddFiles`. Retiré dans `dispose`.

**Vérification** : `check` (la clé retirée n'a plus de lecteur), à l'écran :
Ctrl+E ouvre le dialogue, le « + » aussi, aucun « Add notes » nulle part.

## 6. L'aperçu d'une note `.md` : les styles de son vault, et plus propre

**Aujourd'hui** (`src/markdown-preview.ts`, modal `qbd-ai-preview-modal`) :
un rendu par blocs, sûr, avec les callouts colorés par le CSS de l'app ; les
propriétés en tête rendues en tableau ; une ligne « poids · lignes · chemin »
qui déborde ; un lien `[TP1 — …](TP1.pdf)` laissé brut.

### 6a. Les styles du vault d'où vient la note

Une note qui appartient à un **vault Obsidian déclaré** (les racines dont
`HostRoot.vault` est vrai, ou une note d'une racine externe située DANS un
tel vault — le principal le sait par `vaultsObsidian`) est rendue avec les
**snippets CSS activés de ce vault**, le temps du modal.

- **Ce qui est lu, et où** : `<vault>/.obsidian/appearance.json` →
  `enabledCssSnippets` ; pour chaque nom, `<vault>/.obsidian/snippets/<nom>.css`.
  C'est le PRINCIPAL qui compose ces chemins, jamais le rendu : canal
  `CANAUX.vaultStyles(cheminNote)` → `{ css: string } | null`. Le rendu
  n'envoie qu'un chemin de note, borné ; le principal relit la liste des
  vaults déclarés (`vaultsObsidian`, `vaults.ts`), cherche celui qui
  contient la note (préfixe de chemin réel, comme `contratDepuisAbsolu`),
  lit les fichiers nommés ci-dessus et rien d'autre. `null` quand aucun
  vault ne contient la note, ou que `appearance.json` manque.
- **Le THÈME n'est pas chargé** (AnuPpuccin dans les vaults d'Ahmed). Il
  restyle tout l'espace de travail d'Obsidian, pose ses variables sur
  `body.theme-dark`, et pèse des milliers de règles. L'app garde son thème,
  qui définit déjà les variables d'Obsidian dont les snippets se servent
  (`check:theme` le tient). Décision à revoir si un vault s'appuie sur son
  thème pour ses callouts.
- **Portée** : chaque snippet est enveloppé dans `@scope (.qbd-ai-preview-md) { … }`
  (Chromium ≥ 118 ; l'Electron du dépôt est bien au-delà). Le conteneur de
  l'aperçu porte les classes `markdown-preview-view markdown-rendered theme-dark`
  — les préfixes qu'un snippet pose devant ses sélecteurs — de sorte que
  `.theme-dark .callout[data-callout="…"]` ou `.markdown-preview-view h1`
  matchent avec la racine de la portée. Les sélecteurs `body`, `html` et
  `:root` en tête de règle sont réécrits en `:scope` par
  `porterSnippet(css)` (pure, `src/vault-styles.ts`), et rien d'autre n'est
  réécrit : ce qui ne matche pas ne s'applique pas, sans casser le reste.
- **Les ressources relatives** (`url("Tungsten-Black.woff2")` dans un
  snippet) se résolvent par rapport au dossier `snippets/` : `porterSnippet`
  réécrit les `url()` relatives en URL du protocole de ressources
  (`urlDeRessource`, `app://neo-res/<chemin absolu>`), servi par le
  principal à travers le MÊME périmètre que les canaux `fichiers.*` — le
  vault y est admis dès que l'application a listé ses vaults
  (`CANAUX.vaultsObsidian`), ce que `ouvrirVaultsDetectes` (`host/folder.ts`)
  fait au démarrage.
  Une police qui ne charge pas retombe sur la suivante de la pile : jamais
  une erreur.
- **Injection** : un `<style data-nq-vault-styles>` ajouté au `panelEl` du
  modal à l'ouverture, retiré par l'hôte avec le contenu à la fermeture. Pas
  de cache : l'utilisateur modifie ses snippets dans Obsidian et rouvre
  l'aperçu.
- Une note HORS vault (dossier simple) est rendue comme aujourd'hui.

### 6b. Plus propre

- **Métadonnées masquées par défaut**, un bouton « Propriétés » (icône
  `list`) dans l'en-tête du modal les affiche ; l'état n'est pas persisté
  (c'est un aperçu). Rendues comme Obsidian les montre : une liste
  `clé : valeur` compacte (`qbd-md-props`), les listes YAML en puces sur une
  ligne, plus de tableau à cellules vides.
- **La ligne poids · lignes · chemin** ne déborde plus : le chemin prend le
  reste de la ligne avec `text-overflow: ellipsis` par le DÉBUT
  (`direction: rtl` sur ce seul span, `unicode-bidi: plaintext`) pour garder
  le nom du fichier visible, et le chemin complet en `title`.
- **Un lien que l'aperçu ne peut pas ouvrir** (`[texte](TP1.pdf)`,
  `[[Note]]`, `[[Note|alias]]`) rend son TEXTE seul, sans style de lien :
  un lien qui ne répond pas serait un mensonge, et des crochets bruts sont
  une régression de lisibilité. `http(s)`, `mailto:` et `obsidian:` restent
  des liens. Ajouté à `check:md-preview` (discriminance : un `[[…]]` qui
  ressort avec ses crochets fait rougir).

**Vérification** : `check:md-preview` (liens, propriétés), `check:vault-styles`
neuf (pure : `porterSnippet` réécrit `body`/`:root`, laisse `.theme-dark`,
résout les `url()` relatives, ignore les absolues et les `data:`),
`check:electron-reglages` ou un cas dédié pour « quel vault contient cette
note » (un chemin hors de tout vault rend `null`), `check:app`. À l'écran :
`TP1.md` du vault Efrei — callouts « Sujet original » et « Mode d'emploi »
avec le gabarit d'Ahmed, propriétés masquées puis affichées, chemin lisible.

## 7. Le système de versions : SemVer strict, et des notes par version

**Demande** (Ahmed, 2026-09-17, en lisant les callouts de la note) : « un
vrai système propre et strict, le même que les apps les plus populaires ».
Obsidian (1.13.7), VS Code, Electron : MAJOR.MINOR.PATCH où le numéro dit ce
que la version contient, et des notes publiées à chaque release. Jusqu'ici
le niveau était TAPÉ à la main (`git ship minor`) et la note disait « le
numéro est indicatif ». Ce n'est plus vrai après cette section.

### 7a. La règle

| Niveau | Quand | Qui décide |
|---|---|---|
| **MAJOR** | une rupture pour l'utilisateur : format `quiz-blocks`, journal de révision, emplacement des réglages, OS minimum | une décision écrite sous `### Breaking`, jamais automatique |
| **MINOR** | toute nouveauté visible ou changement de comportement voulu (fonctionnalité, refonte, nouveau réglage) | au moins une entrée sous `### Added` ou `### Changed` |
| **PATCH** | uniquement des corrections de ce qu'une version précédente promettait déjà ; rien de neuf | seulement des entrées sous `### Fixed` |

### 7b. Ce qui l'impose : `CHANGELOG.md` et `git ship` qui le lit

- **`CHANGELOG.md` à la racine du dépôt, en anglais seul** (décision Ahmed :
  « c'est plus simple »), format Keep a Changelog. En tête, une section
  `## Unreleased` avec, dans cet ordre et seulement ceux qui ont une
  entrée : `### Breaking`, `### Added`, `### Changed`, `### Fixed`. Une
  entrée = une ligne, orientée utilisateur (« Folders now show their path »),
  jamais un nom de fichier ni un SHA. Puis une section par version publiée,
  `## 1.1.0 — 2026-09-17`, de la plus récente à la plus ancienne. Le fichier
  ne concerne que l'APPLICATION (`desktop-v*`) ; le greffon, rarement
  livré, garde `git ship --plugin <niveau>` tel quel — l'étendre est une
  tranche à part, si le besoin vient.
- **Rétroactif** : quatre sections écrites depuis la note du vault, courtes,
  pour `1.0.0` (2026-09-13), `1.0.1` (2026-09-15), `1.0.3` (2026-09-16 ;
  `1.0.2` est nommée comme retirée, sans section) et `1.1.0` (2026-09-17).
- **`git ship` ne prend plus de niveau pour l'application.** Il lit
  `## Unreleased`, DÉDUIT le niveau (`Breaking` → major ; sinon `Added` ou
  `Changed` → minor ; sinon `Fixed` → patch), et REFUSE de livrer si la
  section est vide ou absente (« Rien dans Unreleased : écris ce que cette
  version change avant de la livrer »). Une version explicite `X.Y.Z` reste
  admise mais doit être AU MOINS le niveau déduit (livrer `1.1.1` avec une
  entrée `Added` est refusé : c'est exactement le mensonge que le système
  interdit). `major`/`minor`/`patch` tapés à la main pour l'app → erreur
  qui renvoie au CHANGELOG. Dans le même commit « Version X.Y.Z » que le
  bump, `## Unreleased` devient `## X.Y.Z — <date ISO>` et une nouvelle
  section `## Unreleased` vide est ouverte au-dessus.
- **Les fonctions sont PURES et éprouvées** : `scripts/changelog.mjs` —
  `lireUnreleased(texte)`, `deduireNiveau(sections)`, `figer(texte, version, date)`,
  `extraire(texte, version)` — et `check:changelog` (discriminance : une
  entrée `Added` avec `1.1.1` demandé fait rougir ; une section vide fait
  rougir ; `figer` conserve le reste du fichier octet pour octet). `ship.mjs`
  ne fait que les appeler ; `checksToRun` ajoute `check:changelog`.
- **La release GitHub porte les notes** : dans `release.yml`, le job
  `prepare` (produit `app`) écrit `node scripts/changelog.mjs extract <version> > RELEASE_NOTES.md`
  et passe `body_path: RELEASE_NOTES.md` à `softprops/action-gh-release`.
  Version absente du CHANGELOG → le job échoue AVANT de créer la release :
  une release sans notes est ce que le système interdit. L'affichage de ces
  notes dans l'app avant la mise à jour (electron-updater les lit dans la
  release) est une tranche suivante, pas celle-ci.
- **La note du vault** garde son rôle : le récit détaillé, une version par
  callout. `CHANGELOG.md` est court et public ; les deux ne se remplacent pas.
- `CLAUDE.md` (section « Release ») et `scripts/ship.mjs` (en-tête) sont
  réécrits pour dire la nouvelle règle ; la mémoire `note-versions-callouts`
  est complétée.

### 7c. Ce que ça change pour cette version

`desktop-v1.2.0` sera la première livrée par ce système : les six points de
cette spec s'écrivent sous `Added`/`Changed`/`Fixed` au fil des tâches, et
`git ship "…"` en déduira `minor` tout seul. Le point 7 se construit donc
EN PREMIER dans le plan, avec la sonde du terminal.

## 8. Ce qui ne bouge pas

- Le greffon Obsidian : aucun fichier d'`apps/obsidian/`.
- La liste blanche `OUTILS`, le périmètre des DOSSIERS, la garde `garde-ia.ts`.
- `installCmd` garde ses trois formes officielles (vérifiées le 2026-07-14),
  il change seulement de fichier.
- Les réglages persistés `hotkeyAddNotes` et `hotkeyAddFiles: Ctrl+U` d'une
  installation existante : le premier est ignoré, le second reste honoré
  s'il a été personnalisé (le défaut ne remplace pas une valeur écrite).

## 9. Ordre de livraison

Une seule version, `desktop-v1.2.0`. Dans le plan, le système de versions
(7) et la sonde du terminal (3c) viennent en premier — le premier parce que
tout ce qui suit s'y inscrit, la seconde parce qu'elle seule peut invalider
une partie du design ; les points 1, 2 et 5 sont indépendants et courts ; le
4 et le 6 touchent le périmètre et le pont, chacun avec ses contrôles ; le 3
s'assemble en dernier sur la sonde. Test final dans la VM VMware,
fournisseur par fournisseur, puis `git ship "…"` — le niveau se déduit.
