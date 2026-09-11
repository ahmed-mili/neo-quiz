# Migration Tauri vers Electron — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — employer `superpowers:subagent-driven-development` pour exécuter ce plan tâche par tâche. Les étapes portent des cases `- [ ]`.

**But :** remplacer la coquille Tauri 2 de l'application Windows par Electron, sans qu'une seule ligne de `src/` bouge.

**Architecture :** le travail système descend dans le **processus principal** Electron (Node complet), une **préparation** (`preload`) expose un pont typé et étroit, et l'hôte du rendu appelle ce pont. `contextIsolation` reste ACTIVÉ — voir la contrainte de sécurité ci-dessous. Les quatre fichiers d'hôte qui ne touchent pas Tauri (`math.ts`, `modal.ts`, `roots.ts`, `ui.ts`, 413 lignes) ne bougent pas.

**Pile :** Electron, electron-builder, chokidar, TypeScript strict, Vite.

**Décision :** `docs/superpowers/notes/2026-09-11-passation-electron.md` — pourquoi Electron, ce qu'on perd, l'ordre à respecter.

## Contraintes globales

- **`src/` NE BOUGE PAS.** 24 239 lignes. Si une tâche oblige à y toucher, c'est le signe d'une erreur de conception : s'arrêter et le dire.
- **`contextIsolation: true` et `nodeIntegration: false`, sans exception.** Neo Quiz rend du HTML qui n'est PAS toujours celui de l'utilisateur : un quiz partagé arrive avec les `explainHtml` de son auteur (`CLAUDE.md`, « Texte et HTML d'un quiz »). Avec `nodeIntegration`, une faille dans ce HTML donnerait un accès complet à la machine. Le rendu ne doit jamais voir Node.
- **Le contrat `src/host/types.ts` est la référence.** L'hôte Electron implémente EXACTEMENT les mêmes promesses, y compris **« LA FRAÎCHEUR APRÈS UNE ÉCRITURE »** : après `write`, `process`, `writeBinary` ou `append` rendus sans rejet, `getFile(path)` rend le `mtime` neuf.
- **Le cliquet `npm run check:host` doit rester à 15**, jamais monter. Son assertion 2 refuse tout import d'Obsidian sous `apps/windows/`.
- **Commentaires en français, documentant le POURQUOI**, jamais le QUOI.
- **Aucune chaîne visible en dur** : tout par `t("domaine.clé")`, appelé AU RENDU.
- **Les scripts de contrôle appellent `process.exitCode`, jamais `process.exit()`** : la pile doit se dérouler pour que `withSrcModule` retire son dossier temporaire.
- **Juger un script sur son CODE DE SORTIE**, jamais sur la fin de sa sortie.
- **Tout cas neuf s'éprouve par DISCRIMINANCE** : casser la règle, voir rougir une assertion NOMMÉE, restaurer. Un rouge sans assertion rouge ne prouve rien.
- **Commits directs sur `main`**, jamais de branche ni de push automatique.
- Après chaque écriture, chercher les marqueurs d'encodage (`Ă`, `Â`, `â€`). Fausse alerte connue : « CÂBLAGE » est correct.

---

## L'état des lieux, mesuré le 2026-09-11

Ce qui dépend de Tauri, et rien d'autre :

| Fichier | Lignes | Ce qu'il emprunte à Tauri |
|---|---|---|
| `apps/windows/src/host/fs.ts` | 411 | `plugin-fs` : lecture, écriture, `watch` |
| `apps/windows/src/host/folder.ts` | 187 | `plugin-dialog`, `plugin-store`, `invoke("allow_folder")` |
| `apps/windows/src/host/links.ts` | 119 | `convertFileSrc` de `api/core` |
| `apps/windows/src/host/index.ts` | 108 | `plugin-opener` |
| `apps/windows/src/main.ts` | — | `getCurrentWindow` pour `onCloseRequested` |
| `apps/windows/src-tauri/` | 71 (Rust) | `allow_folder`, `obsidian_vaults` |
| **Total à réécrire** | **825 + 71** | |

Ce qui **ne bouge pas** : `math.ts` (50), `modal.ts` (127), `roots.ts` (136), `ui.ts` (100) — **413 lignes**, aucun import Tauri.

Le contrôle `scripts/check-windows-host.mjs` compte 788 lignes de code en dix groupes. **Trois seulement dépendent de Tauri** : `resourceUrl` (76), `process, octets et corbeille` (189), `l'index recalé après écriture` (59) — **324 lignes**. Les 464 autres éprouvent des fonctions pures et ne bougent pas.

**Surface réelle de la migration : environ 1 220 lignes**, pas 2 100.

---

## Structure des fichiers

```
apps/windows/
├── electron/                      NOUVEAU — le processus principal (Node)
│   ├── main.ts                    fenêtre, cycle de vie, fermeture
│   ├── preload.ts                 contextBridge : le pont typé
│   ├── pont.ts                    le TYPE du pont, partagé main/preload/rendu
│   ├── fichiers.ts                les primitives de fichiers, Node pur
│   ├── index-fichiers.ts          l'index en mémoire + le surveillant
│   ├── reglages.ts                persistance des réglages (remplace plugin-store)
│   └── vaults.ts                  détection des vaults Obsidian (remplace le Rust)
├── src/host/
│   ├── fs.ts                      RÉÉCRIT — appelle le pont
│   ├── folder.ts                  RÉÉCRIT — appelle le pont
│   ├── links.ts                   RÉÉCRIT — protocole personnalisé
│   ├── index.ts                   RÉÉCRIT — assemblage
│   ├── math.ts, modal.ts, roots.ts, ui.ts   INCHANGÉS
│   └── …
├── src-tauri/                     SUPPRIMÉ à la tâche 6
└── electron-builder.yml           NOUVEAU

scripts/
├── check-electron-fs.mjs          NOUVEAU — les primitives, sur un vrai dossier
├── check-electron-index.mjs       NOUVEAU — l'index et le surveillant
└── check-windows-host.mjs         3 groupes sur 10 réécrits
```

**Pourquoi `electron/` et non `src-electron/`** : `src/` de l'application est le code du RENDU, compilé par Vite. Le processus principal est compilé séparément et ne doit jamais finir dans le paquet du rendu. Un dossier frère rend la frontière visible.

**Pourquoi `pont.ts` est un fichier à part** : son type est lu par les trois côtés — le principal qui l'implémente, la préparation qui l'expose, le rendu qui l'appelle. Un type dupliqué diverge en silence.

---

## Task 1 : Les primitives de fichiers en Node, et leur contrôle

**Files:**
- Create: `apps/windows/electron/fichiers.ts`
- Create: `scripts/check-electron-fs.mjs`
- Modify: `package.json` (script `check:electron-fs`)
- Modify: `docs/superpowers/notes/controles.md` (une entrée)

**Interfaces:**
- Consomme : rien. Node pur (`node:fs/promises`, `node:path`).
- Produit : `creerFichiers(): PrimitivesFichiers`, dont les méthodes portent les mêmes noms et la même sémantique que `HostFs` de `src/host/types.ts` : `read`, `write`, `process`, `writeBinary`, `append`, `exists`, `mkdirs`, `trash`, `readCached`, `stat`. **Les chemins reçus sont des chemins ABSOLUS du disque** — la conversion depuis les chemins du contrat reste côté rendu, dans `roots.ts`, qui ne bouge pas.

**Pourquoi cette tâche d'abord :** elle ne demande ni Electron ni fenêtre. Son contrôle tourne sur un **vrai dossier temporaire**, donc sans aucun double. C'est précisément ce que la migration achète, et la première tâche le prouve.

- [ ] **Étape 1 : écrire le contrôle, sur le comportement attendu**

Lire d'abord `scripts/check-quiz-io.mjs` pour le style, et `scripts/lib/load-src.mjs` pour `makeReporter`. Le contrôle crée un dossier temporaire par `fs.mkdtemp`, y travaille, et le retire dans un `finally`.

Huit cas, chacun avec sa rupture :

| Cas | Règle gardée | Comment la casser |
|---|---|---|
| `write` puis `read` rend le même texte | l'aller-retour de base | écrire sans `await` |
| `process` reçoit le contenu ACTUEL et écrit ce que le rappel rend | le compare-and-swap de `detail-io.ts` en dépend | passer l'ancien contenu au rappel |
| `process` sur un fichier absent rejette | une note supprimée ne doit pas se recréer vide | créer le fichier au lieu de rejeter |
| `writeBinary` écrit les octets exacts d'une vue partielle | une image collée ne doit pas emporter tout le tampon | écrire `data.buffer` au lieu de la vue |
| `append` ajoute sans relire tout le fichier | l'atomicité protège le journal de révision | lire puis réécrire |
| `mkdirs` sur un dossier existant ne rejette pas | une course entre deux exports ferait échouer l'un | retirer `recursive: true` |
| `trash` DÉPLACE vers `<racine>/.trash/`, il ne supprime pas | la corbeille est l'endroit où rien ne disparaît | appeler `rm` |
| un homonyme déjà en corbeille n'est pas écrasé | deux suppressions du même nom | écraser au lieu de numéroter |

- [ ] **Étape 2 : lancer le contrôle, vérifier qu'il ÉCHOUE**

```bash
node scripts/check-electron-fs.mjs
```
Attendu : échec sur module introuvable. Relever le code de sortie.

- [ ] **Étape 3 : écrire `apps/windows/electron/fichiers.ts`**

Reprendre la SÉMANTIQUE de `apps/windows/src/host/fs.ts` (lire les commentaires, ils portent les défauts corrigés), en remplaçant les appels `plugin-fs` par `node:fs/promises`. Points à ne pas perdre :

- `process(chemin, rappel)` : lire, appliquer le rappel, écrire — et **le rappel peut être rejoué**, `detail-io.ts` s'en protège par son drapeau `ecrit` remis à faux en tête ;
- `trash` : `rename` vers `<racine>/.trash/<chemin local>`, avec un nom LIBRE si l'homonyme existe (voir `cheminLibre` dans `roots.ts`, qui ne bouge pas et ne réserve rien) ;
- `append` : `fs.appendFile`, jamais lire-puis-réécrire ;
- `writeBinary` : écrire la VUE (`data`), jamais `data.buffer`.

- [ ] **Étape 4 : lancer le contrôle, vérifier qu'il PASSE**

```bash
node scripts/check-electron-fs.mjs
```
Attendu : `8/8 cas passent`, sortie 0.

- [ ] **Étape 5 : éprouver les huit ruptures**

Pour chacune : casser comme le tableau l'indique, lancer, **relever le LIBELLÉ de l'assertion qui rougit**, restaurer, relancer et vérifier le vert. Un cas qui ne rougit pas est un cas mal écrit : le réécrire.

- [ ] **Étape 6 : déclarer le contrôle**

```json
"check:electron-fs": "node scripts/check-electron-fs.mjs",
```

Et une entrée dans `docs/superpowers/notes/controles.md` qui dit **LE DÉFAUT que le contrôle empêche**, pas ce que le script fait.

- [ ] **Étape 7 : commit**

```bash
git add apps/windows/electron/fichiers.ts scripts/check-electron-fs.mjs package.json docs/superpowers/notes/controles.md
git commit -m "feat(electron): les primitives de fichiers, en Node, avec leur controle"
```

---

## Task 2 : L'index et le surveillant débouncé

**Files:**
- Create: `apps/windows/electron/index-fichiers.ts`
- Create: `scripts/check-electron-index.mjs`
- Modify: `apps/windows/package.json` (dépendance `chokidar`)
- Modify: `package.json` (script `check:electron-index`)

**Interfaces:**
- Consomme : `creerFichiers()` de la tâche 1.
- Produit : `creerIndex(racines: string[]): Index` avec `get(chemin)`, `all()`, `apply(evenement)`, et `surveiller(onEvenement, delayMs)`. Les événements portent la même forme que `HostFileEvent` du contrat : `{ kind: "create" | "modify" | "delete" | "rename", … }`.

**Pourquoi chokidar :** `fs.watch` récursif est notoirement inégal sous Windows (doublons, événements manquants). Chokidar est la bibliothèque que l'écosystème emploie pour ça depuis dix ans.

- [ ] **Étape 1 : reprendre les règles déjà éprouvées**

`apps/windows/src/host/fs.ts` porte deux fonctions PURES, écrites exprès pour être éprouvables, et **leurs dix-sept cas existent déjà** dans `check-windows-host.mjs`, groupe « index » :

- `horsCatalogue(cheminContrat)` — un chemin qui traverse un dossier ignoré, ou qui se réduit à la racine ;
- `evenementDeRenommage(avant, apres, file)` — un renommage vers un dossier ignoré est une SUPPRESSION, qui en sort est une CRÉATION, entre deux dossiers indexés un vrai renommage, et à l'intérieur d'un dossier ignoré : rien.

**Les déplacer telles quelles** dans `index-fichiers.ts`. Ne pas les réécrire : elles portent un défaut réel — un quiz mis à la corbeille rentrait au catalogue sous son chemin de corbeille et restait dans « Mes quiz » jusqu'au redémarrage.

- [ ] **Étape 2 : écrire le contrôle, huit cas neufs**

Les dix-sept cas des deux fonctions pures se reprennent tels quels. Les huit neufs portent sur le surveillant, sur un vrai dossier temporaire :

| Cas | Règle gardée | Rupture |
|---|---|---|
| créer un fichier émet `create` | le catalogue voit les notes neuves | ne pas écouter `add` |
| modifier émet `modify` avec le `mtime` neuf | une note éditée dehors doit se voir | garder l'ancien `mtime` |
| supprimer émet `delete` | un quiz supprimé sort du catalogue | ignorer `unlink` |
| deux écritures rapprochées n'émettent qu'UN événement | sans débounce, chaque frappe repeint | mettre `delayMs` à 0 |
| un fichier sous `.trash/` n'émet RIEN | c'est le défaut réparé à la tranche 3 | retirer `horsCatalogue` |
| un `.md` hors racine n'émet rien | le surveillant est borné aux racines | surveiller le parent |
| **après une écriture par `fichiers.write`, `get()` rend le mtime NEUF sans attendre le surveillant** | **la promesse de fraîcheur du contrat** | retirer le recalage |
| `surveiller` rend une fonction qui arrête vraiment l'écoute | sinon chaque remontage fuit un observateur | rendre une fonction vide |

L'avant-dernier est le plus important : c'est la promesse écrite dans `src/host/types.ts`, et c'est elle qui empêche une Notice « modifié dehors » mensongère après chaque sauvegarde.

- [ ] **Étape 3 : lancer, vérifier l'échec, relever le code de sortie**

- [ ] **Étape 4 : écrire `index-fichiers.ts`**

Le recalage après écriture est le point délicat : `fichiers.ts` ne connaît pas l'index. Deux voies, **choisir la première** : l'index enveloppe les écritures (`index.write = async (p, c) => { await fichiers.write(p, c); await recaler(p); }`). Écrire POURQUOI sur place.

- [ ] **Étape 5 : lancer, vérifier le vert**

- [ ] **Étape 6 : éprouver les huit ruptures, libellé par libellé**

- [ ] **Étape 7 : déclarer et commiter**

```bash
git add apps/windows/electron/index-fichiers.ts scripts/check-electron-index.mjs apps/windows/package.json package.json
git commit -m "feat(electron): l'index et le surveillant debounce, avec leur controle"
```

---

## Task 3 : La coquille Electron et le pont typé

**Files:**
- Create: `apps/windows/electron/pont.ts`
- Create: `apps/windows/electron/main.ts`
- Create: `apps/windows/electron/preload.ts`
- Create: `apps/windows/electron/reglages.ts`
- Create: `apps/windows/electron/vaults.ts`
- Modify: `apps/windows/package.json` (electron, scripts `dev` et `build`)
- Modify: `apps/windows/vite.config.ts`
- Modify: `apps/windows/tsconfig.json`

**Interfaces:**
- Consomme : `creerFichiers()` (tâche 1), `creerIndex()` (tâche 2).
- Produit : `window.neo`, du type `Pont` défini dans `pont.ts`. Toute méthode est **asynchrone** — elle traverse l'IPC. Les noms reprennent ceux du contrat pour que l'hôte du rendu soit un passe-plat lisible.

**Le type du pont, à écrire en entier dans `pont.ts` :**

```ts
export interface Pont {
	fichiers: {
		read(abs: string): Promise<string>;
		write(abs: string, contenu: string): Promise<void>;
		process(abs: string, rappelId: number): Promise<void>;
		writeBinary(abs: string, data: Uint8Array): Promise<void>;
		append(abs: string, contenu: string): Promise<void>;
		exists(abs: string): Promise<boolean>;
		mkdirs(abs: string): Promise<void>;
		trash(abs: string, racine: string): Promise<void>;
		stat(abs: string): Promise<{ mtime: number } | null>;
		liste(racine: string): Promise<{ chemin: string; mtime: number }[]>;
	};
	surveiller(onEvenement: (e: unknown) => void): Promise<() => void>;
	dialogue: { choisirDossier(): Promise<string | null> };
	reglages: { lire(cle: string): Promise<unknown>; ecrire(cle: string, v: unknown): Promise<void> };
	systeme: { ouvrir(abs: string): Promise<void>; vaultsObsidian(): Promise<VaultConnu[]> };
	fenetre: { surFermeture(rappel: () => Promise<void>): void };
}
```

> **`process` et son rappel** : le rappel vit dans le RENDU, la lecture-écriture dans le principal. Un rappel ne traverse pas l'IPC. La voie retenue : le principal **lit** et renvoie le contenu, le rendu applique le rappel, le principal **écrit** — avec une comparaison du contenu lu pour refuser l'écriture si le fichier a changé entre les deux. Écrire ce raisonnement sur place ; c'est la même garantie que `vault.process` d'Obsidian donne.

- [ ] **Étape 1 : installer Electron et câbler les scripts**

```bash
cd apps/windows && npm install --save-dev electron electron-builder concurrently
```

Scripts : `dev` lance Vite puis Electron sur `http://localhost:5173` ; `build` compile le rendu par Vite et le principal par `tsc`.

- [ ] **Étape 2 : écrire `pont.ts`, le type seul**

- [ ] **Étape 3 : écrire `main.ts`**

`BrowserWindow` avec **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`**, et le `preload` déclaré. Enregistrer les gestionnaires `ipcMain.handle` pour chaque méthode du pont. **Aucun `ipcMain.on` sans réponse** : tout doit pouvoir être attendu.

- [ ] **Étape 4 : écrire `preload.ts`**

`contextBridge.exposeInMainWorld("neo", …)`. **N'exposer QUE les méthodes du pont**, jamais `ipcRenderer` nu : exposer `ipcRenderer` reviendrait à annuler l'isolation.

- [ ] **Étape 5 : `reglages.ts` et `vaults.ts`**

`reglages.ts` remplace `plugin-store` : un JSON dans `app.getPath("userData")`, écrit par `write` atomique (fichier temporaire puis `rename`). `vaults.ts` remplace la commande Rust `obsidian_vaults` : lire `%APPDATA%/obsidian/obsidian.json`. La commande `allow_folder` **disparaît sans remplacement** — elle n'existait que pour étendre le périmètre de `plugin-fs`, que Node n'a pas.

- [ ] **Étape 6 : l'application démarre**

```bash
cd apps/windows && npm run dev
```
Attendu : la fenêtre s'ouvre sur l'interface. L'hôte est encore celui de Tauri, donc **l'application ne fonctionne pas encore** — c'est attendu, la tâche 4 la rebranche.

- [ ] **Étape 7 : commit**

```bash
git add apps/windows/electron apps/windows/package.json apps/windows/vite.config.ts apps/windows/tsconfig.json
git commit -m "feat(electron): la coquille, le pont type et les reglages"
```

---

## Task 4 : L'hôte du rendu passe sur le pont

**Files:**
- Modify: `apps/windows/src/host/fs.ts`
- Modify: `apps/windows/src/host/folder.ts`
- Modify: `apps/windows/src/host/links.ts`
- Modify: `apps/windows/src/host/index.ts`
- Modify: `scripts/check-windows-host.mjs` (trois groupes sur dix)

**Interfaces:**
- Consomme : `window.neo` (tâche 3).
- Produit : un `Host` conforme à `src/host/types.ts`. **Aucune signature du contrat ne change.**

**Ce qui NE bouge pas :** `math.ts`, `modal.ts`, `roots.ts`, `ui.ts` — 413 lignes sans Tauri. Et dans `check-windows-host.mjs`, sept groupes sur dix (464 lignes) éprouvent des fonctions pures et restent intacts.

- [ ] **Étape 1 : `links.ts` et le protocole des ressources**

`convertFileSrc` de Tauri fabriquait une URL lisible par la WebView. Electron n'a pas d'équivalent : enregistrer un protocole personnalisé dans `main.ts` (`protocol.handle("neo-res", …)`) qui sert un fichier **borné aux racines ouvertes**. Une URL qui sortirait des racines doit être refusée — c'est la même règle que le groupe « liens bornés aux racines » éprouve déjà.

- [ ] **Étape 2 : `fs.ts` devient un passe-plat**

Les fonctions pures (`horsCatalogue`, `evenementDeRenommage`) sont parties en tâche 2 : `fs.ts` **les réimporte depuis `electron/index-fichiers.ts`** plutôt que d'en garder une copie. Deux copies d'une même règle ont déjà divergé une fois dans ce dépôt.

- [ ] **Étape 3 : `folder.ts`**

`pickFolder` → `neo.dialogue.choisirDossier`. `reglagesStore` → `neo.reglages`. `obsidianVaults` → `neo.systeme.vaultsObsidian`. **`allowFolder` disparaît** : sans périmètre à étendre, elle n'a plus d'objet. Vérifier ses appelants et les retirer aussi.

- [ ] **Étape 4 : `index.ts`**

`openPath` de `plugin-opener` → `neo.systeme.ouvrir`. Le reste est de l'assemblage.

- [ ] **Étape 5 : les trois groupes du contrôle**

Réécrire `resourceUrl` (76 lignes), `process, octets et corbeille` (189) et `l'index recalé après écriture` (59). **Le double de la frontière IPC de Tauri disparaît** : ces groupes éprouvent désormais soit des fonctions pures, soit un faux `window.neo` — bien plus simple qu'un faux `invoke`.

**Les 110 assertions ne doivent pas BOUGER.** Si l'une doit changer pour passer, c'est un signal, pas un ajustement : le dire.

- [ ] **Étape 6 : la suite complète des contrôles**

Un par ligne, sans pipe, code de sortie relevé : `check`, `check:host` (**15**), `check:app`, `check:dashboard-dom`, `check:electron-fs`, `check:electron-index`, `check:windows-host`, `check:obsidian-host`, `check:quiz-io`, `check:md`, `check:export`, `check:markers`, `check:lesson`, `check:theme`, `build`.

- [ ] **Étape 7 : commit**

```bash
git add apps/windows/src/host scripts/check-windows-host.mjs
git commit -m "refactor(host): l'hote de la fenetre passe de Tauri au pont Electron"
```

---

## Task 5 : La fermeture qui attend l'écriture

**Files:**
- Modify: `apps/windows/electron/main.ts`
- Modify: `apps/windows/src/main.ts`

**Interfaces:**
- Consomme : `neo.fenetre.surFermeture` (tâche 3), `demonterCourant` (existant).
- Produit : rien qu'une autre tâche consomme.

**Le défaut à ne pas réintroduire :** `flushSave()` et `QuizPageHandlers.dispose()` rendent une `Promise<void>` qui se résout quand l'écriture est TERMINÉE. Sous Tauri, `onCloseRequested` l'attendait avant de détruire la fenêtre. **Sans l'équivalent Electron, fermer juste après une frappe la perd.**

- [ ] **Étape 1 : le chemin de fermeture**

Dans `main.ts` du principal : intercepter `close` de la fenêtre, `event.preventDefault()`, demander au rendu de se démonter, **attendre sa réponse**, puis `destroy()`. Un drapeau évite la boucle au second passage.

- [ ] **Étape 2 : le rendu répond**

`neo.fenetre.surFermeture(async () => { await demonterCourant?.(); store.destroy(); stats.destroy(); })`.

- [ ] **Étape 3 : borner l'attente**

Une écriture qui ne rend jamais la main bloquerait la fermeture pour toujours. Poser un délai de garde de deux secondes au-delà duquel on ferme quand même, et **écrire pourquoi** : mieux vaut perdre la dernière frappe que refuser de fermer.

- [ ] **Étape 4 : vérifier à l'écran**

Aucun script ne peut le faire. Taper dans une question, fermer AUSSITÔT par la croix, rouvrir : la frappe doit être dans la note. Puis vérifier que la croix ferme bien la fenêtre, y compris quand rien n'est en attente.

- [ ] **Étape 5 : commit**

```bash
git add apps/windows/electron/main.ts apps/windows/src/main.ts
git commit -m "feat(electron): la fermeture attend l'ecriture en cours"
```

---

## Task 6 : L'empaquetage, et le retrait de Tauri

**Files:**
- Create: `apps/windows/electron-builder.yml`
- Modify: `apps/windows/package.json`
- Modify: `.github/workflows/` (le paquet Linux)
- Delete: `apps/windows/src-tauri/`
- Modify: `CLAUDE.md`, `docs/superpowers/notes/controles.md`

- [ ] **Étape 1 : `electron-builder.yml`**

Cibles : **NSIS** pour Windows, **AppImage** pour Linux. Le paquet Linux se construit sur un runner Ubuntu en CI — `jpackage` n'est pas en cause ici, mais AppImage exige Linux.

- [ ] **Étape 2 : construire et installer**

```bash
cd apps/windows && npm run build && npx electron-builder --win nsis
```
**Ne pas lancer l'installeur sans prévenir Ahmed** : il ferme la fenêtre ouverte.

- [ ] **Étape 3 : retirer Tauri**

Supprimer `apps/windows/src-tauri/`, et les cinq dépendances `@tauri-apps/*` de `apps/windows/package.json`. Vérifier qu'aucun `@tauri-apps` ne subsiste :

```bash
grep -rn "@tauri-apps\|__TAURI__" apps/ scripts/ --include=*.ts --include=*.mjs --include=*.json
```
Attendu : aucun résultat hors historique git.

- [ ] **Étape 4 : mettre la documentation à jour**

`CLAUDE.md` décrit l'application comme « Tauri 2 + Vite » à deux endroits, et `controles.md` décrit le double IPC. Les deux doivent dire vrai — c'est ce qu'une session fraîche lit en premier.

- [ ] **Étape 5 : la suite complète des contrôles, une dernière fois**

Tous, code de sortie relevé. Puis `npm run build` du greffon, qui ne doit pas avoir bougé d'un octet.

- [ ] **Étape 6 : commit**

```bash
git add -A apps/windows scripts CLAUDE.md docs
git commit -m "chore(electron): empaquetage NSIS et AppImage, Tauri retire"
```

---

## Ce que ce plan ne fait pas, volontairement

- **Il ne touche pas `src/`.** Si une tâche paraît l'exiger, c'est une erreur de conception : s'arrêter.
- **Il ne migre pas le greffon Obsidian.** `apps/obsidian/` n'a aucun rapport avec la coquille.
- **Il n'ajoute pas la génération IA.** C'est la tranche suivante, et elle devient simple une fois ce plan exécuté : `child_process` et `taskkill /T` sans commande Rust ni permission.
- **Il ne signe pas l'installeur.** SmartScreen continuera d'avertir. Signer coûte un certificat annuel ; à décider à part.
