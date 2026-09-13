# Tranche 6 — l'installeur

**Date** : 2026-09-13 (nuit du 12 au 13, Ahmed absent : les décisions ci-dessous
sont prises par Claude, chacune avec sa raison, pour être contestées au réveil)
**Statut** : spec, à suivre d'un plan
**Point de départ** : `main` = `d7f620a`, poussé ; la tranche 5 (génération IA
dans l'application) est livrée et validée à l'écran le 2026-09-12.

## 1. L'objectif

Un installeur qui marche, **prouvé sur une machine propre** : sans Node, sans
Ollama, sans aucun CLI. Le produit final de la tranche n'est pas un fichier
`.exe`, c'est une **liste d'épreuves à l'écran cochées par Ahmed** sur une
telle machine, plus une chaîne de publication qui produit ce fichier à chaque
tag sans qu'on y touche.

Ce qui existe déjà (tâche 7 de la tranche 4, `73715f2`) : la configuration
`apps/windows/electron-builder.config.mjs` (NSIS et AppImage, version lue du
manifeste), les scripts `pack:win` / `pack:linux`, un job CI Linux, et un
installeur `Neo Quiz Setup 2.5.0-beta.exe` construit en local le 2026-09-12
et **jamais lancé**.

Ce qui manque, constaté cette nuit :

- **Le job AppImage n'a jamais été vert.** Chaque run échoue sur
  `executableName contains characters that cannot be safely used in file
  paths: @neo-quizwindows` : electron-builder dérive le nom de l'exécutable
  du `name` de `apps/windows/package.json` (`@neo-quiz/windows`), et le `@`
  est refusé. Le `continue-on-error: true` prévu pour cette phase le masque
  depuis le 2026-09-11.
- **`release.yml` ne publie que le greffon.** Aucun installeur n'est attaché à
  une release ; la seule voie de distribution de l'application est un
  fichier construit sur le poste d'Ahmed.
- **L'application n'affiche nulle part sa version.** Pour éprouver « la mise
  à jour par-dessus une version installée », il faut pouvoir lire laquelle
  tourne.
- **Aucune machine propre n'est disponible.** Le poste d'Ahmed a Node, Ollama
  et les trois CLI ; ni Windows Sandbox ni WSL n'y sont installés.
- **L'asar embarque 3 659 fichiers de `node_modules`** et les sourcemaps du
  principal, alors que `chokidar` est bundlé par esbuild et `lucide` par
  Vite : du poids mort dans chaque installeur.

## 2. Les décisions

### 2.1 Non signé, et pourquoi

L'installeur NSIS et l'exécutable **ne sont pas signés**.

- Aucun certificat n'existe. Un certificat OV coûte 200 à 500 EUR par an avec
  vérification d'identité ; Azure Trusted Signing coûte moins mais exige un
  compte Azure et la même vérification, et sa disponibilité aux particuliers
  varie selon le pays. Un certificat auto-signé ne vaut rien : SmartScreen
  ne l'accepte pas plus qu'une absence de signature.
- Le public, fixé par la feuille de route, est **la promo de B2 d'Ahmed** :
  des gens qui installent des CLI au quotidien. L'avertissement SmartScreen
  (« Windows a protégé votre ordinateur » puis « Informations
  complémentaires » puis « Exécuter quand même ») est documenté dans le
  README ; il ne bloque personne de ce public.
- La décision est **réversible sans code** : electron-builder signe dès qu'on
  lui donne `CSC_LINK` / `CSC_KEY_PASSWORD` (certificat en fichier) ou
  `win.azureSignOptions` (Trusted Signing). Le jour où le public dépasse la
  promo, c'est une variable de CI, pas une tranche.

Ce que « non signé » coûte, honnêtement : SmartScreen à chaque première
exécution d'une nouvelle version tant que la réputation n'est pas acquise,
et certains navigateurs qui marquent le téléchargement. Rien de plus.

Sans certificat, electron-builder édite quand même les ressources de
l'exécutable (icône, version de fichier) par `rcedit` : le paquet local du
2026-09-12 le prouve.

### 2.2 La version : une source, trois lecteurs

> **Note du 2026-09-13 (soir)** : ce paragraphe décrit l'état d'AVANT la
> numérotation indépendante de l'application. Depuis, l'application a sa
> propre version dans `apps/windows/package.json` (+ lockfile synchronisé),
> tags `app-vX.Y.Z`, release GitHub « latest » ; le greffon garde
> `src/assets/manifest.json`, tags `vX.Y.Z`, `make_latest: false`. Voir
> CLAUDE.md, « Release ». Le reste de cette section décrit un schéma à une
> seule source qui n'est plus celui en vigueur — gardé pour l'historique de
> la décision de la nuit du 12 au 13.

`src/assets/manifest.json` reste **la seule source** (CLAUDE.md, « Release »).
Elle est lue :

1. par `electron-builder.config.mjs` (`extraMetadata.version`) — déjà fait ;
2. par le RENDU de l'application, qui importe le JSON (Vite l'inline au
   build) et affiche « Neo Quiz 2.5.0-beta » en bas de la page Réglages,
   sous un titre « À propos ». C'est cette ligne qu'Ahmed lit pour prouver
   qu'une mise à jour a bien remplacé l'ancienne version. Pas de canal IPC
   pour ça : `app.getVersion()` lit le `package.json` du paquet, qui porte
   `0.0.0` en développement — le JSON importé, lui, dit la même chose en
   développement et installé ;
3. par `release.yml`, qui la RÉÉCRIT depuis le tag avant tout build (déjà
   fait pour le greffon, à faire dans chaque job de l'application).

### 2.3 L'identité du paquet est immuable

`appId: "com.ahmed.neoquiz"` rejoint `PLUGIN_ID` et `QUIZ_BLOCK_LANGUAGE`
dans la liste des valeurs qu'on ne renomme JAMAIS : c'est la clé de registre
par laquelle NSIS retrouve une installation existante pour la remplacer. La
changer ferait de chaque mise à jour une seconde installation à côté de la
première, avec deux raccourcis et deux entrées dans « Applications ».
`executableName: "neo-quiz"` (sans espace, sans `@`) est posé
explicitement, et devient immuable au même titre : sous Linux, c'est le nom
du binaire dans l'AppImage et de l'entrée `.desktop`.

### 2.4 La mise à jour garde les réglages, par construction

Les réglages de l'application vivent dans `%APPDATA%\Neo Quiz\settings.json`
(`app.getPath("userData")`, nom posé par `app.setName(PRODUCT_NAME)`), les
vaults déclarés avec eux, et le journal de révision **dans le vault**
(`<racine>/.neo-quiz/`). L'installeur NSIS d'electron-builder, sur une
installation existante, désinstalle l'ancienne version puis installe la
neuve, et ne touche à `userData` que si `deleteAppDataOnUninstall` est vrai
— il reste à sa valeur par défaut, faux, et la spec le fige. Aucun code de
migration n'est écrit : il n'y a rien à migrer. L'épreuve à l'écran le
vérifie quand même (installer, ouvrir un dossier, réinstaller par-dessus,
le dossier est toujours là).

### 2.5 Pas de mise à jour automatique

`electron-updater` n'est pas branché. Il exige une signature pour être sûr
(sans elle, un flux compromis installe n'importe quoi avec les droits de
l'utilisateur), un flux à héberger, et un cycle de test qu'aucune épreuve de
cette tranche ne couvre. La mise à jour est **manuelle** : télécharger le
nouvel installeur, le lancer par-dessus. La ligne « À propos » dit si ça a
marché. YAGNI tant que le public tient dans une promo.

### 2.6 Le paquet ne contient que les deux sorties

`files` exclut `node_modules/**` et `dist-electron/**/*.map`. Le principal
est bundlé par esbuild (`chokidar` compris, c'est même la raison 2 de
l'en-tête de `construire.mjs`), le rendu par Vite (`lucide` compris) : rien
dans le paquet n'appelle `require` vers `node_modules`. Si cette affirmation
était fausse, l'application ne démarrerait pas — et c'est précisément ce que
l'épreuve « premier lancement sur machine propre » attrape. Un contrôle
mécanique (`check:package`, §3.1) tient l'exclusion.

### 2.7 La machine propre est Windows Sandbox

Le poste d'Ahmed est sous Windows 11 Pro avec l'hyperviseur actif :
**Windows Sandbox** donne une machine jetable, sans Node, sans Ollama, sans
CLI, sans `%APPDATA%\Neo Quiz`, en une minute, à chaque essai. C'est la
définition même de « machine propre », gratuite et reproductible.

Elle demande une activation UNIQUE par Ahmed (droits administrateur puis
redémarrage) :
`Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM`.
Le dépôt fournit un fichier `.wsb` qui monte `dist-installer/` en lecture
seule et un dossier de vault d'essai en lecture-écriture (§3.4).

Pour Ollama dans le bac à sable, deux voies, au choix d'Ahmed : installer
Ollama dedans (réseau actif, un modèle à télécharger), ou pointer
`aiOllamaUrl` de l'application vers l'Ollama du POSTE par son adresse LAN
(`http://192.168.x.y:11434`, avec `OLLAMA_HOST=0.0.0.0` côté poste). La
seconde voie éprouve au passage la garde de la clé `ai` : une adresse RFC
1918 doit être admise sans confirmation.

L'AppImage se lance sous **WSL** (`wsl --install`, Ubuntu, WSLg affiche la
fenêtre). Deux pièges documentés dans les épreuves : sans FUSE, lancer avec
`--appimage-extract-and-run` ; si Chromium refuse son bac à sable SUID
(AppArmor d'Ubuntu 24.04), ajouter `--no-sandbox`.

### 2.8 Éprouver `release.yml` sans publier

Un tag `v*` publie une release sur un dépôt PUBLIC : action visible,
irréversible sans trace. Pour tester la chaîne sans ça, `release.yml` gagne
un déclencheur `workflow_dispatch` en **mode répétition** : mêmes jobs, mêmes
builds, mais les fichiers sont déposés en artefacts de workflow au lieu
d'être attachés à une release, et le manifeste prend la version d'un champ
de saisie au lieu du tag. Claude lance ce mode depuis `gh` cette nuit et lit
le résultat ; Ahmed pose le vrai tag quand les épreuves sont cochées.

### 2.9 Ce que la tranche ne fait pas

- Pas de signature (§2.1), pas de mise à jour automatique (§2.5).
- Pas de macOS, jamais (feuille de route).
- Pas de paquet `.deb` / `.rpm` / Flatpak : l'AppImage suffit à « lancé une
  fois sous Linux », et personne de la promo n'a demandé plus.
- Pas de raccourci de démarrage automatique, pas d'association de fichiers
  `.md` : l'application ouvre des DOSSIERS, pas des notes.
- Pas de traduction de l'installeur NSIS lui-même : electron-builder le sert
  dans la langue de Windows.

## 3. Ce qui est construit

### 3.1 L'empaquetage (`electron-builder.config.mjs`)

- `executableName: "neo-quiz"` au niveau racine de la configuration
  (`Configuration extends PlatformSpecificBuildOptions`, vérifié dans
  `app-builder-lib/out/configuration.d.ts`) ; `linux.desktop` avec
  `entry.Name` ou `desktopName` pour que la fenêtre soit associée à l'entrée
  `.desktop` (l'avertissement `WM_CLASS` du journal CI ; l'option exacte se
  lit dans `linuxOptions.d.ts`, jamais devinée) ; `artifactName` explicite, sans espace :
  `neo-quiz-setup-${version}.exe` et `neo-quiz-${version}.AppImage` — un
  nom qu'on peut `curl` sans guillemets.
- `files` : `dist/**/*`, `dist-electron/**/*`, `!dist-electron/**/*.map`,
  `package.json`, `!node_modules/**`.
- `nsis.deleteAppDataOnUninstall: false` écrit explicitement, avec le
  pourquoi (§2.4), pour qu'une future lecture ne le « nettoie » pas en vrai.
- Le `.blockmap` produit par NSIS n'est attaché à aucune release : il ne sert
  qu'à `electron-updater`, absent.
- **`scripts/check-package.mjs`** (`npm run check:package`) : charge la
  fonction de configuration et vérifie, sur l'objet RÉSOLU, que la version
  est celle du manifeste, que `appId` vaut exactement `com.ahmed.neoquiz`,
  que `executableName` n'a que des lettres, chiffres, tirets et points, que
  `files` exclut `node_modules` et les sourcemaps, et que
  `deleteAppDataOnUninstall` est faux. Puis, SI un `win-unpacked/` existe
  dans `dist-installer/`, que son `app.asar` ne liste aucun chemin sous
  `node_modules/` ni aucun `.map` (lecture par `@electron/asar`, présent
  dans `apps/windows/node_modules/@electron/asar` comme dépendance
  transitive d'electron-builder ; le script l'importe depuis là, sans
  l'ajouter aux dépendances). Chaque cas s'éprouve par discriminance.
  Dans la CI, après `pack:linux` et `pack:win`.

### 3.2 La version à l'écran

Page Réglages de l'application (`apps/windows/src/ui/settings.ts`) : une
section « À propos » en dernier, une ligne « Neo Quiz {version} » et le
lien du dépôt (`host.shell.openExternal`, existe). La version vient de
`import manifest from "../../../../src/assets/manifest.json"` — le rendu
importe le code partagé par chemin relatif, c'est la règle du dépôt, et un
JSON ne tire pas Node (assertion 6 de `check:host`). Clés i18n neuves EN et
FR (`settings.about.title`, `settings.about.version`, `settings.about.repo`).

### 3.3 La chaîne de publication

**`ci.yml`** :
- le job `app-linux-package` perd `continue-on-error` DANS LE COMMIT QUI LE
  RÉPARE, pas avant : la règle écrite dans le fichier dit « à retirer une
  fois observé vert » ; l'observation se fait sur le run de ce commit, et si
  ce run est rouge, le commit suivant restaure `continue-on-error` en
  attendant. Il lance `check:package` après `pack:linux` ;
- un job `app-windows-package` sur `windows-latest`, symétrique : deux
  `npm ci`, `pack:win`, `check:package`, artefact `neo-quiz-windows-setup`.
  Dépôt public, minutes gratuites ; il attrape ce que Linux ne voit pas
  (NSIS, `rcedit`, chemins Windows).

**`release.yml`**, trois jobs :
- `plugin` (l'existant, inchangé dans son contenu) crée la release et y
  attache `main.js`, `styles.css`, `manifest.json` ;
- `app-windows` (`windows-latest`) et `app-linux` (`ubuntu-latest`) :
  réécriture du manifeste depuis le tag par `node scripts/set-version.mjs
  <numéro exact>` (il existe, accepte un numéro en toutes lettres et n'écrit
  que le manifeste ; le `node -e` inline du job `plugin` est remplacé par le
  même appel, une seule façon d'écrire la version), deux `npm ci`, `pack:*`, `check:package`, puis
  `softprops/action-gh-release` avec `needs: plugin` pour attacher
  `neo-quiz-setup-X.Y.Z.exe` / `neo-quiz-X.Y.Z.AppImage` à la release déjà
  créée. Un échec de l'un n'annule pas l'autre ni le greffon.
- `workflow_dispatch` avec une entrée `version` : mode répétition (§2.8),
  chaque job dépose ses fichiers en artefact et saute l'étape release.
  `prerelease` reste calculé sur le suffixe semver du tag.

### 3.4 Le banc d'essai

- `apps/windows/sandbox/neo-quiz.wsb` : Windows Sandbox avec
  `dist-installer/` monté en lecture seule sur le bureau du bac à sable, et
  `apps/windows/sandbox/vault/` en lecture-écriture (un vault d'essai de deux
  notes quiz, prises de `demo-template.md`, commité ; `.neo-quiz/` et
  `Generated/` dedans sont ignorés par git). Réseau activé (Ollama, catalogue).
- `docs/superpowers/notes/2026-09-13-tranche-6-epreuves-ecran.md` : la liste
  d'épreuves, dans l'ordre, chacune avec ce qu'on regarde et ce qui compte
  comme échec. Elle couvre, dans cet ordre : activation du bac à sable ;
  SmartScreen ; installation dans un dossier choisi ; premier lancement
  (écran vide, aucun vault Obsidian listé, aucun CLI détecté avec la commande
  d'installation affichée, Ollama hors ligne) ; ouverture du vault d'essai ;
  une révision ; une génération Ollama (l'une des deux voies du §2.7) ;
  réinstallation de la MÊME version par-dessus (le dossier est toujours
  ouvert, « À propos » inchangé) ; installation d'une version SUPÉRIEURE
  par-dessus (manifeste bumpé en local pour l'épreuve, « À propos » change,
  réglages intacts, un seul raccourci, une seule entrée dans
  « Applications ») ; désinstallation (le vault et son `.neo-quiz/` sont
  intacts) ; l'AppImage sous WSL, lancé une fois, un dossier ouvert.

### 3.5 Le README

Une section « Desktop app (Windows, Linux) » sous « Installation » : où
télécharger (la page des releases, les deux noms de fichiers), SmartScreen
en trois clics, la mise à jour manuelle, ce que la désinstallation garde. En
anglais comme le reste du README.

## 4. Les épreuves, et qui les passe

| Épreuve | Qui | Où |
|---|---|---|
| `check:package`, `check:app`, `check:host` (6) | scripts | CI et poste |
| Job AppImage vert, job NSIS vert | CI | GitHub |
| `release.yml` en mode répétition, deux artefacts déposés | Claude par `gh` | GitHub |
| Tout le §3.4 | **Ahmed** | Windows Sandbox, WSL |

Aucun agent ne pilote l'application ni Obsidian : à chaque livraison, Ahmed
reçoit la liste de ce qu'il doit cliquer.

## 5. Contraintes reprises de CLAUDE.md

Aucune chaîne visible en dur ; commentaires en français avec le pourquoi ;
`process.exitCode` et jamais `process.exit()` dans les scripts ; juger un
script sur son code de sortie ; le rendu n'importe jamais un module qui tire
Node ; `check:host` reste à 6 ; rien ne bouge dans `src/scheduler/` ni
`src/engine/`.
