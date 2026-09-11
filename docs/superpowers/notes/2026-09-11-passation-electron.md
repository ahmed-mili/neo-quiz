# Passation — la migration Electron est LIVRÉE

Écrit le 2026-09-11 (réécrit le même jour, après la vague de correction
finale), pour la session qui reprendra le travail juste après avoir lu
`CLAUDE.md`. Ce fichier remplace la version qui disait « la migration est
décidée, ne pas commencer avant les vérifications » : ces vérifications ont été
faites, la migration a été exécutée, relue et corrigée. Le raisonnement qui a
fait choisir Electron (moteur de rendu embarqué, un seul langage, moins de
frontières) est dans la note Obsidian `Projets/Architecture multiplateforme.md`
; il n'est plus utile pour agir.

## Où en est le projet

**La migration Tauri → Electron est livrée sur `main`** : seize commits
`9604d27..73715f2`, plus `ee34d0e` (la vague de correction finale, Ruling
24) et le commit de cette note. Sept tâches (fichiers, index, pont IPC + périmètre, hôte du rendu,
renommage de dossier, fermeture qui attend l'écriture, empaquetage), chacune
close en revue — huit rondes de correction au total, aucune revue
contournée. Le ledger `.superpowers/sdd/2026-09-11-migration-electron/
progress.md` tient les **24 rulings** ; chaque rapport de tâche est à côté.
Les rulings qui engagent encore le code : 9 (le périmètre, liste blanche tenue
par le principal), 12 (`userData` hors périmètre), 13 (une seule liste blanche
pour les canaux ET le protocole des images), 17 (un renommage de dossier n'est
jamais deviné), 22 (le job AppImage reste `continue-on-error`), 23 (la version
de l'installeur vient de `src/assets/manifest.json`), 24 (cette vague).

`npm run check:host` est toujours à **15**, la cible de la tranche 3 ;
`check:windows-host` à **140** assertions (138 + 2 de cette vague) ;
`check:electron-reglages` à 18 cas, `check:electron-index` 17, `check:electron-fs`
14. **`src/` n'a pas bougé d'une ligne** pendant toute la migration : c'est ce
que le contrat d'hôte (`src/host/types.ts`) a acheté.

## L'architecture, en trois lignes

- `apps/windows/electron/` — le **processus principal** : `main.ts` (fenêtre,
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, protocole
  `app://neo-res/` des images), `canaux.ts` (un `ipcMain.handle` par méthode du
  pont, chaque chemin passe par `perimetre.borner`), `perimetre.ts` (la liste
  blanche : réglages `folders`, sélecteur natif, vaults d'Obsidian — jamais
  `userData`, jamais l'argument de `demarrer`), `preload.ts` (n'expose que le
  pont `window.neo`, recopie les `Uint8Array`), `pont.ts` (types et noms de
  canaux, rien d'autre), `fichiers.ts`, `index-fichiers.ts` (chokidar),
  `parcours.ts`, `reglages.ts`, `vaults.ts`, `catalogue.ts` et `ressources.ts`
  (les deux derniers SANS Node, importables du rendu).
- `apps/windows/src/host/` — l'hôte côté **rendu** : `fs.ts` tient un MIROIR
  de l'index (les trois lectures synchrones du contrat ne peuvent pas passer
  par l'IPC), s'abonne AVANT d'hydrater, et applique le `mtime` que chaque
  écriture du pont REND ; `roots.ts` est la seule conversion chemin du contrat
  ↔ absolu ; `links.ts` fabrique les URL `app:` ; `folder.ts`, `ui.ts`,
  `math.ts`, `modal.ts`, `pont.ts`.
- Le contrat `src/host/types.ts` et tout `src/` sont **intacts** ; le journal
  de révision (`<racine>/.neo-quiz/review-log.jsonl`) est partagé avec le
  greffon et ses clés n'ont pas changé.

## Ce qui n'a JAMAIS été exercé

- **L'installeur `apps/windows/dist-installer/Neo Quiz Setup 2.5.0-beta.exe`**
  (116 Mo, NSIS, non signé) a été CONSTRUIT deux fois et **jamais lancé par un
  agent**. Le mode `app.isPackaged` — `loadFile` sur `dist/index.html`,
  l'origine `file://` de `memeOrigine`, le préchargement lu depuis l'asar, le
  protocole `app:` depuis un paquet — n'a jamais tourné sous les yeux d'un
  agent. Le 2026-09-11 à 18:00, un `Neo Quiz.exe` installé sous
  `%LOCALAPPDATA%\Programs\Neo Quiz\` tournait sur la machine (quatre
  processus) : Ahmed l'a lancé lui-même. Il tient le verrou d'instance unique
  (`requestSingleInstanceLock`, par `userData`) : **`npm run dev` quitte
  aussitôt, en silence, tant qu'il tourne** — la vague finale a mesuré avec un
  `userData` dérivé, temporairement. Si Ahmed rapporte un défaut vu dans
  l'installeur, c'est le premier retour du mode empaqueté : ne pas le
  reproduire en `dev` avant d'avoir lu `charger()` de `main.ts`.
- **L'AppImage en CI** (`ci.yml`, job `app-linux-package`) est
  `continue-on-error: true` **tant qu'il n'a pas été vu vert sur GitHub** —
  un rouge permanent masquerait le cliquet `check:host` du job `build`. Le
  jour où il passe, retirer la ligne (Ruling 22). Il ne publie qu'un artefact
  de CI, jamais une release : pas de release Linux sans décision d'Ahmed.

## Les dettes ouvertes (revue finale, consignées, PAS corrigées)

- **Pas de CSP** (M4). La fenêtre charge `http://localhost:1421` en dev et
  `file://` empaqueté, sans `Content-Security-Policy`. Le sanitizer est la
  seule barrière contre un `explainHtml` partagé ; `sandbox: true` et
  l'absence de `nodeIntegration` bornent ce qu'un script injecté obtiendrait
  (le pont `window.neo`, borné par le périmètre — et depuis cette vague, sans
  exécution par `ouvrir`). Une CSP `default-src 'self'` demanderait de
  vérifier MathLive (styles inline) et les images `app:`/`data:` avant de la
  poser.
- **`.obsidian/plugins/*/main.js` d'un vault est DANS le périmètre
  d'écriture** (M5) : un vault ouvert est un dossier autorisé en entier, et
  le rendu peut réécrire le `main.js` d'un greffon qu'Obsidian chargera avec
  ses droits. Hérité de Tauri (`allow_folder` accordait le même dossier),
  identique en portée. Fermer ça demande d'exclure les dossiers cachés de
  l'ÉCRITURE seule (la lecture de `.obsidian/` sert aux vaults, l'écriture de
  `.neo-quiz/` au journal) — une règle à concevoir, pas une ligne.
- **La course `stat`/`unlink`** (M9) : `fraicheur()` de `canaux.ts` fait un
  `stat` après l'écriture ; un fichier supprimé dans les quelques ms entre les
  deux rend `mtime: 0`, que le rendu SIGNALE (`recaler`, « mtime inconnu après
  écriture ») et que le surveillant corrige. Autocorrigée, connue, pas fermée.
- **Copies d'une même règle restantes** : `cheminLibre` (`electron/fichiers.ts`
  et `src/host/roots.ts` — assumée, elle franchit la frontière principal/rendu),
  `toHostFile` (`electron/index-fichiers.ts` et `src/host/fs.ts`, même
  découpe du nom), `normaliser`/`nettoyer` (`src/host/fs.ts` et
  `src/host/roots.ts`, même paquet, PRÉEXISTANTE — le commentaire qui disait
  « la seule copie du rendu » a été corrigé par cette vague, la copie non).
  La deuxième copie du principal, elle, a été retirée (M3).
- **« Première racine gagne » contre « la plus longue »** : `contratDepuisAbsolu`
  (`electron/index-fichiers.ts`) rend la PREMIÈRE racine du tableau qui
  préfixe le chemin ; `depuisAbsolu` de `src/host/roots.ts:99` rend la plus
  LONGUE. Deux dossiers ouverts l'un dans l'autre (« C:/Vault » et
  « C:/Vault/Cours ») donneraient un chemin de contrat différent des deux
  côtés du pont. Le principal ne fait franchir l'IPC que des chemins ABSOLUS,
  donc la divergence ne touche aujourd'hui que le catalogue interne du
  principal (garde de `surSuppression`) — mais la règle est à ÉCRIRE sur
  place, dans les deux fonctions, avant qu'un lecteur ne les croie
  équivalentes.
- **`src/review/rename-match.ts:4-7`** attribue encore le mécanisme à
  `@tauri-apps/plugin-fs`. C'est `src/`, donc hors de toute vague Electron :
  à corriger lors d'un prochain passage dans `src/review/`, avec les contrôles
  de ce dossier.
- **`ignoreInitial: false`** (`index-fichiers.ts`) pousse un `create` par
  fichier du vault au démarrage (1676 sur `Personal`, en 0,5 s). Mesuré : la
  rafale précède la fin de l'hydratation et frappe un miroir vide sans
  abonné ; le coût réel est 1676 messages IPC et autant de `stat`, invisible.
  La déduplication de `versContrat` (`src/host/fs.ts`) n'attrape rien
  aujourd'hui et protège l'ordre inverse. Rendre l'index du principal
  indépendant de ce parcours (`ignoreInitial: true` + peuplement par
  `listerRacine`) serait la vraie économie — à mesurer avant, comme ici.
- **6,4 Go de `apps/windows/src-tauri/target/`** (cache Rust, non suivi,
  ignoré par `.gitignore` racine ligne 19) sont encore sur le disque : **à
  effacer À LA MAIN par Ahmed** (`Remove-Item -Recurse -Force`). Ne pas
  retirer la ligne d'ignore avant.
- Reprises de la tranche 3, toujours ouvertes : `_htmlToText` sans contrôle
  mécanique ; les trois fichiers du formulaire (`detail-question.ts`,
  `detail-exam.ts`, `detail-form-bridge.ts`) exécutés par aucun contrôle ;
  `EXCEPTIONS_APPS` bornée par une liste, pas un cliquet de taille ;
  `audit-vaults.mjs` qui ne couvre plus que cinq notes ; `.qb-btn-danger` qui
  ne définit que `:hover`.

## Les pièges connus, à ne pas redécouvrir

- **Un `git add` après le retrait d'une ligne d'ignore indexe ce que l'ignore
  protégeait.** La tâche 7 a retiré `src-tauri/target/` de `.gitignore` parce
  que `src-tauri/` disparaissait — mais `target/` (6,4 Go) existait encore,
  et `git add` a indexé ses 4033 fichiers. Détecté AVANT le commit ; d'où la
  règle : avant chaque commit, `git diff --cached --stat | grep -c
  src-tauri/target` doit rendre 0, et un ignore obsolète ne coûte rien.
- **Le schéma du protocole des images est contraint par `isSafeQuizUrl`**
  (`src/engine/sanitizer.ts`) : seuls `https?:`, `app:`, `file:`, `blob:`,
  `data:image/` passent pour un `src`. Un schéma inventé (« neo-res: ») fait
  RETIRER chaque image d'option, sans erreur. D'où `app://neo-res/…`, et deux
  cas de `check:windows-host` qui rougissent si le schéma change.
- **`requestSingleInstanceLock` est par `userData`** : l'installé et le `dev`
  s'excluent. Un `npm run dev` qui « ne fait rien » (electron sort en 0 sans
  fenêtre), c'est ça.
- **`close` de la `BrowserWindow` n'est PAS émis par `window.close()`** depuis
  le rendu — seulement par le chemin utilisateur (WM_CLOSE). Un rappel de
  fermeture éprouvé avec `window.close()` passe pour cassé alors qu'il ne l'est
  pas (`main.ts`, mesuré sur Electron 44).
- **Le `data-line` d'une case à cocher dans un callout Obsidian** (la note
  `Projets/Neo Quiz.md`, où les tâches vivent dans des callouts imbriqués
  `> > [!task]`) n'est PAS un numéro de ligne du fichier : mesuré le
  2026-09-11, c'est le décalage depuis le DÉBUT DE LA SECTION, callouts
  compris — ce qu'Obsidian emploie lui-même pour cocher. Et un callout rend
  son contenu une seconde fois dans un bloc invisible SANS `data-line` : un
  script qui compte les cases rendues en voit le double. Apparier la n-ième
  case du bloc rendu à la n-ième ligne de tâche du texte de la section, et
  vérifier le contenu de la ligne avant d'y écrire, jamais l'index seul.
- **`check:lesson` MEURT sur une exception** au lieu d'échouer proprement : une
  mort en route masque en silence tous les groupes suivants. Il doit aller
  jusqu'au bout (26 groupes).
- **Juger un script sur son CODE DE SORTIE**, jamais sur la fin de sa sortie.
  **Un rouge sans assertion rouge ne prouve rien.** **Un contrôle vert ne
  prouve rien tant qu'il n'a pas rougi** — chaque cas neuf de la migration a
  été cassé, relevé sous son libellé exact, restauré.
- **Le contrat promet la fraîcheur après une écriture** : le pont REND le
  `mtime` neuf à chaque écriture (Ruling 8) et le rendu recale son miroir
  AVANT de résoudre. Une écriture qui rendrait `void` ferait revenir la Notice
  « modifié dehors » mensongère.
- **`flushSave()` et `dispose()` rendent une promesse**, et la fermeture
  l'attend (délai de garde 1500 ms, fixé sur mesure : 72 à 116 ms mesurés).
  Un second clic sur la croix abandonne l'écriture — voulu, écrit sur place.
- **Les plans de ce projet se sont révélés fautifs 31 fois avant la migration,
  et la migration a ajouté ses écarts** (lignes sous-évaluées, `HostFs` sans
  `stat`, `allow_folder` pris pour un confort alors que c'était une barrière).
  Traiter tout extrait comme un ARGUMENT, jamais comme une autorité.

## La prochaine tranche : la génération IA dans le PRINCIPAL

C'est ce pour quoi Electron a été choisi. `src/dashboard/ai-client.ts` spawne
aujourd'hui les CLIs (Claude Code, Codex, Ollama) par `child_process` depuis
le greffon ; les huit fichiers de la génération sont les huit derniers de
`RESTANTS` avec un vrai contenu. Dans l'application :

- le `spawn` vit dans le **processus principal**, derrière **un canal dédié
  et borné comme les autres** (`canaux.ts`) : commande prise dans une liste
  fermée (jamais une chaîne du rendu), arguments et prompt en stdin, sortie
  en flux poussée par `webContents.send`, annulation par `taskkill /T /F`
  sous Windows ;
- le rendu ne reçoit qu'un identifiant de génération et des morceaux de
  sortie — jamais un descripteur de processus ;
- les sources attachées au prompt (`prompt-paths.ts`) passent par
  `perimetre.borner` comme toute lecture : un chemin hors des dossiers
  ouverts n'atteint jamais la CLI ;
- les modèles restent lus dynamiquement (mémoires `codex-models-dynamic`,
  `ollama-latest-version-only`), et c'est le principal qui lit les caches
  des CLIs.

L'ordre reste celui du dépôt : brainstorming, plan écrit tâche par tâche,
exécution par sous-agents avec revue, un cas de contrôle par règle, éprouvé
par discriminance.
