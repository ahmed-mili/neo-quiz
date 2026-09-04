# Application Windows — tranche 1 : « l'app lit et joue »

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — utiliser
> `superpowers:subagent-driven-development` pour exécuter ce plan tâche par
> tâche. Les étapes sont des cases à cocher (`- [ ]`).

**But :** jouer un quiz de ses notes sans Obsidian — une fenêtre, un dossier, la
liste des quiz, la page d'un quiz, le moteur qui tourne.

**Architecture :** le moteur, le scanner et la chaîne de lecture d'un bloc
cessent de connaître Obsidian ; ils parlent à un contrat `src/host/` que chaque
hôte implémente (`apps/obsidian/host.ts` sur `App`/`Plugin`,
`apps/windows/src/host/` sur Tauri 2). Le code partagé n'est jamais dupliqué :
`apps/windows` l'importe par chemin relatif depuis le même `src/`. Un contrôle
mécanique à cliquet (`npm run check:host`) interdit toute nouvelle dépendance à
Obsidian dans `src/` et refuse aussi les entrées périmées de sa liste, de sorte
que la liste ne peut que rétrécir.

**Pile :** TypeScript strict (ESM), Tauri 2 + Vite pour l'app, esbuild pour le
greffon, MathLive pour le rendu mathématique côté app, Lucide pour les icônes.

**Spec :** `docs/superpowers/specs/2026-09-04-app-windows-design.md` (autorité
liante), cadrée par `docs/superpowers/specs/2026-09-02-roadmap-produit.md`.
Ce plan ne couvre QUE la tranche 1 du §7. Les tranches 2 à 4 ne sont pas
ouvertes (§9).

---

## Contraintes globales

Ces règles valent pour **toutes** les tâches. Chacune a déjà coûté un bug.

- **Commits directs sur `main`.** Jamais de branche, jamais de worktree, jamais
  de `git push`. Un commit par tâche, à la fin de la tâche.
- **Commentaires en français**, et ils documentent le **pourquoi**, pas le quoi.
- **Aucune chaîne visible en dur.** Tout passe par `t("<domaine>.<clé>")` de
  `src/i18n.ts`, et `t()` est appelé **AU RENDU** — jamais dans une constante
  de niveau module, qui figerait la langue du démarrage.
- **L'anglais (`src/i18n/en/*.ts`) est le dictionnaire de référence.** Le
  français est typé `Record<keyof typeof EN_X, string>` : une clé oubliée est
  une erreur de compilation.
- **Ne jamais traduire** les clés du format quiz (`title`, `prompt`, `options`,
  `correctIndex`, `answer`, `learn`…), les types (`single`/`multiple`/`text`/
  `ordering`/`matching`), `mode: "exam"`, les `id:` de commandes, les logs, les
  classes CSS. Ce sont des données persistées dans les notes de l'utilisateur.
- **`PLUGIN_ID = "quiz-blocks"` et `QUIZ_BLOCK_LANGUAGE = "quiz-blocks"` NE
  CHANGENT PAS.** Le premier est le dossier de `.obsidian/plugins/` où vit le
  journal de révision ; le second est écrit dans chaque note du vault. Le
  produit s'appelle « Neo Quiz » (`src/branding.ts`, `PRODUCT_NAME`), le format
  s'appelle `quiz-blocks`.
- **`RESULTS_DIR` côté Obsidian reste `.obsidian/quiz-blocks-results`.** Les
  fichiers de résultats déjà écrits doivent rester trouvables.
- **Les scripts de vérification appellent `process.exitCode`, jamais
  `process.exit()`** : la pile doit se dérouler pour que `withSrcModule` retire
  son dossier temporaire.
- **Modules visés sous ~350 lignes.**
- **Icônes Lucide uniquement**, jamais d'emoji. `dashboard/ui-select.ts` est le
  seul dropdown autorisé — jamais de `<select>` natif.
- **Le greffon ne doit à AUCUN moment être cassé.** Chaque tâche se termine sur
  un `npm run check` vert, un `npm run build` qui déploie, et — pour les tâches
  1 à 7 — un test manuel dans Obsidian (ouvrir une note à quiz, jouer une
  question, voir le tableau de bord).
- **Double encodage :** après toute écriture de fichier, exécuter
  `grep -rn 'Ă\|Â\|â€' <fichiers touchés>` et corriger toute occurrence. Le
  dépôt a déjà été pollué.
- **Chaque cas de test doit être ÉPROUVÉ DISCRIMINANT** : retirer la règle qu'il
  garde, lancer le script, voir l'assertion rougir, restaurer, revoir vert.
  Un cas qui reste vert quand on casse sa règle ne garde rien. Sur le chantier
  précédent, cette méthode a trouvé quatre défauts réels sur onze tâches, dont
  deux qui rendaient une fonctionnalité entière silencieusement inerte.

---

## Décisions que ce plan tranche, et que la spec laissait ouvertes

### D1. La forme du contrat `src/host/`

Un objet `Host` composé de huit sous-contrats (`fs`, `links`, `watcher`, `ui`,
`math`, `shell`, `platform`, `paths`), défini intégralement à la tâche 1. Les
signatures exactes y sont écrites une fois pour toutes ; les tâches suivantes ne
font que les implémenter et les consommer.

Deux voies d'accès, un seul objet :

- **`ctx.host`** pour tout ce qui est atteignable depuis une factory
  `createXHandlers(ctx)` — c'est déjà l'idiome du moteur.
- **`currentHost()`** (`src/host/current.ts`) pour les trois modules sans `ctx`
  (`engine/mathjax.ts`, `engine/math-input.ts`) — même objet, installé une seule
  fois au démarrage de chaque hôte par `installHost()`.

`ctx.host` est assigné depuis `currentHost()` à l'assemblage du `ctx` dans
`engine.ts` : une seule installation, une seule source. `currentHost()` **jette**
si aucun hôte n'est installé, plutôt que de renvoyer `undefined` et de laisser un
`?.` avaler la panne en silence.

### D2. Comment `apps/windows` consomme `src/` sans dupliquer

**Imports relatifs nus** (`../../../src/engine`), zéro alias, zéro symlink, zéro
copie, zéro étape de build intermédiaire.

Neo Calendar est la preuve par l'échec : ses deux dépôts partagent 132 fichiers
de même nom, dont **83 ont divergé**. Toute mécanique qui rend une copie
possible finit par en produire une. Un chemin relatif ne peut pas diverger : il
n'y a qu'un fichier au bout.

Le refus des alias (`@shared/*`) est délibéré : un alias se déclare deux fois
(`tsconfig.json` et `vite.config.ts`), donc à deux endroits qui peuvent
diverger, et il rend le contrôle de frontière moins lisible. La profondeur des
`../` est un coût cosmétique ; deux déclarations à tenir synchrones est un coût
réel.

Conséquences concrètes, à respecter à la tâche 8 :
- `apps/windows/vite.config.ts` doit poser `server.fs.allow: [<racine du dépôt>]`,
  sinon Vite refuse de servir un fichier hors de `apps/windows/`.
- `apps/windows/tsconfig.json` n'a **aucun** `paths` : `tsc` suit les imports
  relatifs tout seul.
- `src/assets/css/index.css` est importé tel quel par l'app : ses `@import` de
  `node_modules` (MathLive) se résolvent en remontant jusqu'au `node_modules` de
  la racine du dépôt.

### D3. Comment le greffon continue de tourner

Le contrat et son cliquet arrivent **avant** toute migration (tâche 1), avec la
liste initiale égale à l'état réel du dépôt : le contrôle passe au vert dès sa
création, sans qu'une ligne de code de production ait bougé.

Ensuite, chaque tâche 4 à 7 fait **un** échange (un sous-contrat, un groupe de
fichiers), retire les entrées correspondantes de la liste du cliquet, et se
termine par `npm run check` + `npm run build` + un passage dans Obsidian.
L'hôte Obsidian (tâche 3) est écrit et testé **avant** son premier consommateur,
si bien qu'aucune tâche ne remplace un chemin qui marche par un chemin non
éprouvé.

Le déménagement du point d'entrée sous `apps/obsidian/` (tâche 2) est fait tôt et
seul : il ne touche que des chemins d'import et l'entrée esbuild, il est
entièrement vérifié par `npm run check`, et il rend la direction des dépendances
correcte (l'hôte importe le partagé, jamais l'inverse) avant que quiconque
s'appuie dessus.

### D4. Le contrôle mécanique — un cliquet, pas une liste

`scripts/check-host.mjs`, sur le modèle de la section pureté de
`check-scheduler.mjs`, mais avec une propriété que celle-ci n'a pas besoin
d'avoir : le noyau est déjà pur, alors que `src/` ne le sera qu'à la fin du
chantier. Le contrôle porte donc **trois** assertions, pas une :

1. aucun fichier de `src/` **hors liste** n'importe `obsidian` → une nouvelle
   dépendance est refusée ;
2. tout fichier **de la liste** importe encore `obsidian` → une entrée périmée
   est refusée, ce qui **force** la liste à rétrécir au lieu de moisir ;
3. aucun fichier de `apps/windows/` n'importe `obsidian`.

C'est l'assertion 2 qui fait le cliquet. Sans elle, la liste devient un tapis
sous lequel on balaie, et la règle ne tient plus qu'à la discipline — exactement
ce que la spec §4 dit ne pas vouloir.

### D5. Écarts assumés par rapport à la spec

- **Rendu mathématique de l'app : MathLive, pas MathJax.** MathLive est déjà une
  dépendance du projet (`mathlive ^0.110.0`), déjà bundlée, fontes déjà inlinées.
  Ajouter `mathjax-full` violerait l'échelle anti-surcodage (« une dépendance
  déjà installée le fait »). La fidélité au rendu d'Obsidian n'est pas une
  contrainte hors d'Obsidian ; côté greffon, MathJax reste inchangé.
- **Accès fichiers : `@tauri-apps/plugin-fs` PLUS une commande Rust
  `allow_folder`.** La spec nomme plugin-fs ; elle ne pouvait pas savoir qu'un
  dossier choisi au sélecteur n'est pas automatiquement dans la portée de
  plugin-fs ni du protocole `asset`. Une commande Rust unique étend les deux
  portées à l'exécution ; toute la lecture/écriture reste en TypeScript.

---

## Structure des fichiers

**Créés**

| Fichier | Responsabilité |
|---|---|
| `src/host/types.ts` | le contrat : `Host` et ses huit sous-contrats |
| `src/host/current.ts` | `installHost` / `currentHost` / `uninstallHost` |
| `scripts/check-host.mjs` | le cliquet de frontière |
| `scripts/check-theme.mjs` | exhaustivité des variables CSS de l'app |
| `scripts/check-math-render.mjs` | segmentation LaTeX partagée, sur un faux `HostMath` |
| `scripts/check-windows-host.mjs` | index et résolution de liens de l'hôte Windows |
| `apps/obsidian/main.ts` | point d'entrée du greffon (déplacé) |
| `apps/obsidian/plugin.ts` | la classe `Plugin` (déplacée) |
| `apps/obsidian/host.ts` | implémentation Obsidian du contrat |
| `scripts/check-obsidian-host.mjs` | vérifie l'hôte Obsidian sur un faux `App` |
| `src/i18n/en/app.ts`, `src/i18n/fr/app.ts` | domaine `app` (fenêtre, dossier) |
| `apps/windows/package.json` | dépendances et scripts de l'app |
| `apps/windows/vite.config.ts` | build du frontend, `server.fs.allow` |
| `apps/windows/tsconfig.json` | typecheck de l'app |
| `apps/windows/index.html` | page hôte |
| `apps/windows/src/main.ts` | démarrage : installe l'hôte, monte l'app |
| `apps/windows/src/theme/host-vars.css` | les variables que fournissait Obsidian |
| `apps/windows/src/host/index.ts` | assemble le `Host` Windows |
| `apps/windows/src/host/fs.ts` | index en mémoire, lecture/écriture, watcher |
| `apps/windows/src/host/links.ts` | wikilinks et URL de ressource (`convertFileSrc`) |
| `apps/windows/src/host/ui.ts` | toasts et icônes Lucide |
| `apps/windows/src/host/math.ts` | rendu LaTeX via MathLive |
| `apps/windows/src/host/folder.ts` | choix et persistance du dossier |
| `apps/windows/src/assets/toast.css` | l'apparence des toasts, en variables du thème |
| `apps/windows/.gitignore` | `dist/`, `src-tauri/target/`, `src-tauri/gen/` |
| `apps/windows/src/ui/list.ts` | la liste des quiz |
| `apps/windows/src/ui/quiz-page.ts` | la page d'un quiz |
| `apps/windows/src-tauri/*` | projet Tauri 2 (Cargo, conf, capabilities, Rust) |

**Modifiés**

| Fichier | Nature du changement |
|---|---|
| `package.json` | scripts `check:host`, `check:theme`, `check:obsidian-host`, `check:math-render`, `check:windows-host`, `check:app`, `app:dev`, `app:build` ; `linkedom` en devDependency |
| `.gitignore` (racine) | les artefacts d'`apps/windows/` |
| `esbuild.config.mjs` | entrée `apps/obsidian/main.ts` |
| `tsconfig.json` | `include` couvre `apps/obsidian/` |
| `src/engine.ts`, `src/types/engine-ctx.ts` | `host` remplace `app`/`plugin`/`Notice` |
| `src/engine/{exam,interactions,state,resources,sanitizer,cards,results-save,math-input,mathjax}.ts` | passage au contrat |
| `src/dashboard/scanner.ts` | `createScanner(host)` |
| `src/i18n.ts` | mode `auto` via `host.platform.uiLanguage` |
| `scripts/check-scanner.mjs` | faux `host` au lieu de faux `app` |
| `scripts/lib/load-src.mjs` | bouchon obsidian complété si besoin |

---

## Tâche 1 — Le contrat d'hôte et son cliquet

**Fichiers :**
- Créer : `src/host/types.ts`
- Créer : `src/host/current.ts`
- Créer : `scripts/check-host.mjs`
- Modifier : `package.json` (scripts)

**Interfaces :**
- Consomme : rien.
- Produit : `Host`, `HostFile`, `HostFileEvent`, `HostFs`, `HostLinks`,
  `HostWatcher`, `HostUi`, `HostMath`, `HostShell`, `HostPlatform`, `HostPaths`
  (depuis `src/host/types.ts`) ; `installHost(h: Host): void`,
  `currentHost(): Host`, `hostOrNull(): Host | null`, `uninstallHost(): void`
  (depuis `src/host/current.ts`). Toutes les tâches suivantes en dépendent.

- [ ] **Étape 1 : écrire le contrat**

Créer `src/host/types.ts` :

```ts
/* ══════════════════════════════════════════════════════════
   LE CONTRAT D'HÔTE

   Tout ce que le code partagé (moteur, scanner, chaîne de lecture d'un bloc)
   demande à son environnement. Obsidian, Windows et — plus tard — Android en
   fournissent chacun une implémentation ; aucun d'eux n'apparaît ici.

   C'est la généralisation d'un patron déjà éprouvé dans ce dépôt :
   `dashboard/review-store.ts` absorbe tout ce qui est spécifique à Obsidian
   pour que l'ordonnanceur n'en voie rien. La différence est mécanique :
   `npm run check:host` refuse toute nouvelle dépendance à `obsidian` dans
   `src/`, et c'est ce contrôle — pas la discipline — qui tient la frontière.

   RÈGLE DE FORME : aucun type de ce fichier ne porte de méthode vivante ni
   d'objet propriétaire d'un hôte. Un `TFile` d'Obsidian et une entrée d'index
   Tauri doivent tous les deux se réduire à un `HostFile` sans rien inventer.
══════════════════════════════════════════════════════════ */

/** Un fichier vu par l'hôte. Volontairement plat et sérialisable. */
export interface HostFile {
	/** Chemin depuis la racine du dossier, séparateurs `/`, jamais absolu.
	    C'est la clé du journal de révision et du catalogue : elle doit être
	    identique dans les trois hôtes pour le même fichier. */
	path: string;
	/** Nom avec extension : « schema.png ». */
	name: string;
	/** Nom sans extension : « schema ». */
	basename: string;
	/** Extension sans point : « png ». Chaîne vide si aucune. */
	extension: string;
	/** Dernière modification, ms depuis l'époque. 0 si l'hôte l'ignore. */
	mtime: number;
}

/** Changement observé dans le dossier. `rename` est distinct de
    delete+create : le journal de révision suit les clés par renommage, et
    reconstituer un renommage à partir de deux évènements est impossible. */
export type HostFileEvent =
	| { kind: "create"; file: HostFile }
	| { kind: "modify"; file: HostFile }
	| { kind: "delete"; path: string }
	| { kind: "rename"; file: HostFile; oldPath: string };

export interface HostFs {
	/** Lit un fichier texte. Rejette si absent ou illisible. */
	read(path: string): Promise<string>;
	/** Lecture destinée à un balayage complet du dossier : l'hôte a le droit
	    de servir un cache. Obsidian a `cachedRead` ; un hôte sans cache peut
	    renvoyer `read`. */
	readCached(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	/** Crée le dossier ET ses parents. Ne rejette pas s'il existe déjà. */
	mkdirs(path: string): Promise<void>;
	/** Index EN MÉMOIRE des fichiers `.md`, synchrone. Obsidian tient déjà le
	    sien ; l'app le construit au démarrage et le maintient par le watcher.
	    Synchrone parce que le scanner et le sanitizer l'appellent en plein
	    rendu, où une promesse imposerait de tout rendre asynchrone. */
	listMarkdown(): HostFile[];
	/** Cherche par NOM exact (avec extension), casse ignorée. Plusieurs
	    résultats sont possibles et ce n'est pas une erreur : l'appelant
	    prévient l'utilisateur (engine/resources.ts). */
	findByName(name: string): HostFile[];
	getFile(path: string): HostFile | null;
}

export interface HostLinks {
	/** Résout un wikilink (« schema.png », « Cours/ch1 ») relativement à la
	    note `fromPath`. null si rien ne correspond. */
	resolve(linkPath: string, fromPath: string): HostFile | null;
	/** URL affichable dans un attribut `src`. null si non résoluble — jamais
	    une chaîne vide, qui ferait charger la page courante comme image. */
	resourceUrl(target: string | HostFile): string | null;
}

export interface HostWatcher {
	/** S'abonne aux changements du dossier. Renvoie le désabonnement. */
	onChange(cb: (ev: HostFileEvent) => void): () => void;
}

export interface HostUi {
	/** Message bref, non bloquant, sans interaction. */
	notice(message: string, timeoutMs?: number): void;
	/** Pose une icône LUCIDE dans l'élément, en remplaçant son contenu.
	    `name` est un identifiant Lucide (« grip-horizontal », « x »). */
	setIcon(el: HTMLElement, name: string): void;
}

export interface HostMath {
	/** Prépare le moteur de rendu. Idempotent, et un échec ne doit pas être
	    mémoïsé : une panne transitoire tuerait le rendu pour la session. */
	ready(): Promise<void>;
	/** Rend UN segment LaTeX. `display` = mode bloc ($$…$$). */
	render(latex: string, display: boolean): HTMLElement;
	/** Fin de lot. L'hôte qui a besoin d'une passe finale la fait ici ; les
	    autres n'ont rien à faire. */
	flush(): void;
}

export interface HostShell {
	/** Ouvre le fichier avec l'application par défaut du système. */
	openExternal(file: HostFile): Promise<boolean>;
	/** Révèle le fichier dans l'explorateur de l'hôte. `false` quand l'hôte
	    n'a pas d'explorateur : ce n'est PAS une erreur, l'appelant enchaîne
	    sur l'ouverture externe. */
	revealInHost(file: HostFile): Promise<boolean>;
}

export interface HostPlatform {
	isMobile: boolean;
	isMacOS: boolean;
	/** Étiquette BCP-47 de la langue de l'interface de l'HÔTE (« fr »,
	    « en-US »). C'est la source du mode « auto » de `src/i18n.ts` : sous
	    Obsidian, la langue d'Obsidian ; dans l'app, celle du système. */
	uiLanguage: string;
}

export interface HostPaths {
	/** Dossier des exports de résultats, relatif à la racine.
	    Côté Obsidian il vaut « .obsidian/quiz-blocks-results » et NE CHANGE
	    PAS : les résultats déjà écrits doivent rester trouvables. */
	resultsDir: string;
}

export interface Host {
	fs: HostFs;
	links: HostLinks;
	watcher: HostWatcher;
	ui: HostUi;
	math: HostMath;
	shell: HostShell;
	platform: HostPlatform;
	paths: HostPaths;
}
```

- [ ] **Étape 2 : écrire le point d'installation**

Créer `src/host/current.ts` :

```ts
import type { Host } from "./types";

/* ══════════════════════════════════════════════════════════
   L'HÔTE COURANT

   Le moteur reçoit son hôte par `ctx.host` — c'est la voie normale, et elle
   reste explicite. Trois modules n'ont pas de `ctx` (`engine/mathjax.ts`,
   `engine/math-input.ts`) : ils lisent `currentHost()`. C'est le MÊME objet,
   assigné une seule fois au démarrage de chaque hôte ; `engine.ts` remplit
   `ctx.host` depuis `currentHost()`, il n'y a donc qu'une source.

   Un singleton se justifie ici parce qu'il n'y a jamais deux hôtes dans un
   processus : un greffon dans Obsidian, une app dans sa fenêtre. C'est le
   même choix que `src/i18n.ts`, pour la même raison.
══════════════════════════════════════════════════════════ */

let installed: Host | null = null;

/** Appelé UNE fois par l'hôte, avant tout rendu. */
export function installHost(host: Host): void {
	installed = host;
}

/** Retire l'hôte (déchargement du greffon, jeux de cas). Sans ça, un
    rechargement du greffon laisserait un hôte pointant vers une `App` morte. */
export function uninstallHost(): void {
	installed = null;
}

/**
 * L'hôte courant. JETTE si aucun n'est installé, au lieu de renvoyer
 * `undefined` : un `?.` avalerait la panne et la fonctionnalité serait
 * silencieusement inerte — précisément le défaut que la relecture ne voit pas.
 */
export function currentHost(): Host {
	if (!installed) {
		throw new Error("Aucun hôte installé : installHost() doit être appelé au démarrage.");
	}
	return installed;
}

/** Pour le seul cas où l'absence d'hôte est normale : `src/i18n.ts` peut être
    sollicité avant l'installation (chargement des modules). */
export function hostOrNull(): Host | null {
	return installed;
}
```

- [ ] **Étape 3 : écrire le cliquet**

Créer `scripts/check-host.mjs` :

```js
/**
 * FRONTIÈRE D'HÔTE — aucun fichier de `src/` n'importe Obsidian.
 *
 * Même rôle que la section pureté de check-scheduler.mjs, avec une propriété
 * de plus : le noyau de l'ordonnanceur est DÉJÀ pur, alors que `src/` ne le
 * sera qu'à la fin du chantier. La liste RESTANTS nomme ce qui n'est pas
 * encore migré — et l'assertion 2 ci-dessous interdit qu'elle moisisse.
 *
 *     npm run check:host
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, posix, sep } from "node:path";

const IMPORTE_OBSIDIAN = /(?:from\s*|require\s*\(\s*)["']obsidian["']/;

/**
 * Fichiers de `src/` qui importent ENCORE Obsidian, avec la tranche qui les
 * libère. Cette liste ne peut que RÉTRÉCIR : un fichier qui y figure sans
 * importer Obsidian fait échouer le contrôle (assertion 2), ce qui force à
 * l'en retirer au lieu de le laisser couvrir une régression future.
 */
const RESTANTS = [
	// Tableau de bord — tranches 2 et 3.
	"src/dashboard.ts",
	"src/dashboard/ai-client.ts",
	"src/dashboard/ai-providers.ts",
	"src/dashboard/ai-usage.ts",
	"src/dashboard/ai.ts",
	"src/dashboard/collapsible.ts",
	"src/dashboard/detail-exam.ts",
	"src/dashboard/detail-form-bridge.ts",
	"src/dashboard/detail-io.ts",
	"src/dashboard/detail-question.ts",
	"src/dashboard/detail.ts",
	"src/dashboard/file-sources.ts",
	"src/dashboard/folder-create.ts",
	"src/dashboard/home.ts",
	"src/dashboard/icon-picker.ts",
	"src/dashboard/mention-picker.ts",
	"src/dashboard/module-card.ts",
	"src/dashboard/module-edit.ts",
	"src/dashboard/nav.ts",
	"src/dashboard/prompt-paths.ts",
	"src/dashboard/quiz-card.ts",
	"src/dashboard/quiz-menu.ts",
	"src/dashboard/quiz-open.ts",
	"src/dashboard/quizzes-render.ts",
	"src/dashboard/quizzes.ts",
	"src/dashboard/review-store.ts",
	"src/dashboard/scanner.ts",
	"src/dashboard/share.ts",
	"src/dashboard/stats-store.ts",
	"src/dashboard/ui-select.ts",
	"src/dashboard/usage-modal.ts",
	"src/dashboard/voice-input.ts",
	"src/dashboard/voice-install.ts",
	"src/types/dashboard-ctx.ts",
	// Éditeur — tranche 3.
	"src/editor.ts",
	"src/editor/editor-form.ts",
	"src/editor/modals.ts",
	"src/editor/question-preview.ts",
	"src/editor/utils.ts",
	"src/types/editor-ctx.ts",
	// Moteur — tranche 1, tâches 4 à 6.
	"src/engine.ts",
	"src/engine/math-input.ts",
	"src/engine/mathjax.ts",
	"src/engine/resources.ts",
	"src/engine/results-save.ts",
	"src/engine/sanitizer.ts",
	"src/types/engine-ctx.ts",
	// Divers du greffon — tranche 4.
	"src/hotkey-format.ts",
	"src/main.ts",
	"src/modal-base.ts",
	"src/plugin.ts",
	"src/quiz-source-ref.ts",
];

function fichiersTs(racine) {
	const trouves = [];
	if (!existsSync(racine)) return trouves;
	for (const nom of readdirSync(racine)) {
		const chemin = join(racine, nom);
		if (statSync(chemin).isDirectory()) trouves.push(...fichiersTs(chemin));
		else if (nom.endsWith(".ts") || nom.endsWith(".tsx")) trouves.push(chemin.split(sep).join(posix.sep));
	}
	return trouves;
}

const attendus = new Set(RESTANTS);
let echecs = 0;
const rate = (msg) => { console.error("ÉCHEC  " + msg); echecs++; };

// 1. Aucune NOUVELLE dépendance dans la zone partagée.
const importeurs = new Set();
for (const f of fichiersTs("src")) {
	if (IMPORTE_OBSIDIAN.test(readFileSync(f, "utf8"))) importeurs.add(f);
}
for (const f of importeurs) {
	if (!attendus.has(f)) rate(`${f} importe « obsidian » : le code partagé passe par src/host/.`);
}

// 2. LE CLIQUET : une entrée qui n'importe plus rien doit être retirée, sinon
//    la liste devient un tapis sous lequel on balaie.
for (const f of attendus) {
	if (!existsSync(f)) rate(`RESTANTS contient ${f}, qui n'existe pas : retirez l'entrée.`);
	else if (!importeurs.has(f)) rate(`${f} n'importe plus « obsidian » : retirez-le de RESTANTS.`);
}

// 3. L'app Windows n'a jamais rien à faire d'Obsidian.
for (const f of fichiersTs("apps/windows/src")) {
	if (IMPORTE_OBSIDIAN.test(readFileSync(f, "utf8"))) rate(`${f} importe « obsidian » : ce n'est pas son hôte.`);
}

if (echecs) {
	console.error(`\nFrontière d'hôte : ${echecs} problème(s)`);
	// exitCode, jamais exit() — cohérent avec les autres scripts du dépôt.
	process.exitCode = 1;
} else {
	console.log(`Frontière d'hôte : ${importeurs.size} fichier(s) encore lié(s) à Obsidian, tous déclarés.`);
}
```

- [ ] **Étape 4 : brancher le script et le voir passer**

Ajouter à `package.json`, dans `scripts`, après `"check:scheduler"` :

```json
"check:host": "node scripts/check-host.mjs",
```

Lancer `npm run check:host`.
Attendu : `Frontière d'hôte : 51 fichier(s) encore lié(s) à Obsidian, tous déclarés.`

Si le compte diffère, c'est que `RESTANTS` ne reflète pas le dépôt : régénérer
la liste avec le MÊME motif que le script (`from "obsidian"` OU
`require("obsidian")` — `src/engine/mathjax.ts` n'a que le second) et la
recopier, sans jamais retirer une entrée qui importe réellement.
`src/main.ts` n'y figure PAS : il ne contient qu'un `export { default } from
"./plugin"` et n'importe rien d'Obsidian. L'y mettre ferait échouer l'assertion
2 en permanence.

- [ ] **Étape 5 : ÉPROUVER les trois assertions (chacune doit rougir)**

Assertion 1 — nouvelle dépendance refusée :
```bash
printf 'import { Notice } from "obsidian";\nexport const x = Notice;\n' > src/host/_essai.ts
npm run check:host
```
Attendu : `ÉCHEC  src/host/_essai.ts importe « obsidian » …` et code de sortie 1.
Puis : `rm src/host/_essai.ts && npm run check:host` → vert.

Assertion 2 — le cliquet :
```bash
sed -i 's|^\timport { Notice } from "obsidian";||' /dev/null   # (rien à faire)
```
Retirer temporairement l'import d'Obsidian de `src/hotkey-format.ts` (commenter
la ligne `import … from "obsidian"` et ce qui l'utilise, ou plus simplement
ajouter `"src/quiz-utils.ts"` — qui n'importe rien — à `RESTANTS`) puis lancer
`npm run check:host`.
Attendu : `ÉCHEC  src/quiz-utils.ts n'importe plus « obsidian » : retirez-le de RESTANTS.`
Restaurer, relancer, revoir vert.

Assertion 3 — l'app :
```bash
mkdir -p apps/windows/src && printf 'import { Notice } from "obsidian";\nexport const x = Notice;\n' > apps/windows/src/_essai.ts
npm run check:host
```
Attendu : `ÉCHEC  apps/windows/src/_essai.ts importe « obsidian » …`.
Puis : `rm -rf apps/windows && npm run check:host` → vert.

- [ ] **Étape 6 : typecheck et double encodage**

```bash
npm run check
grep -rn 'Ă\|Â\|â€' src/host/ scripts/check-host.mjs
```
Attendu : `tsc` sans erreur, `grep` sans résultat.

- [ ] **Étape 7 : commit**

```bash
git add src/host/ scripts/check-host.mjs package.json
git commit -m "$(cat <<'EOF'
feat(host): poser le contrat d'hote et son cliquet de frontiere

Le contrat generalise le patron de review-store : un objet Host que chaque
hote implemente, pour que le code partage cesse de connaitre Obsidian.

check:host porte trois assertions, pas une. La deuxieme — toute entree de
RESTANTS doit encore importer obsidian — est celle qui fait le cliquet :
sans elle la liste devient un tapis sous lequel on balaie, et la frontiere
ne tient plus qu'a la discipline.

Aucun code de production ne change : la liste initiale est l'etat reel.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 2 — Le greffon déménage sous `apps/obsidian/`

**But :** rendre la direction des dépendances correcte (l'hôte importe le
partagé, jamais l'inverse) avant que quoi que ce soit s'appuie dessus. Aucun
changement de comportement : uniquement des chemins d'import et l'entrée du
build.

**Fichiers :**
- Déplacer : `src/main.ts` → `apps/obsidian/main.ts`
- Déplacer : `src/plugin.ts` → `apps/obsidian/plugin.ts`
- Modifier : `esbuild.config.mjs` (entrée)
- Modifier : `tsconfig.json` (`include`)
- Modifier : `scripts/check-host.mjs` (`RESTANTS` : `src/plugin.ts` devient un
  chemin `apps/`, donc **sort** de la liste)

**Interfaces :**
- Consomme : `check:host` de la tâche 1.
- Produit : `apps/obsidian/plugin.ts` exporte toujours `default` la classe
  `InteractiveQuizPlugin` ; `apps/obsidian/main.ts` fait
  `export { default } from "./plugin";`. La tâche 3 y ajoute l'installation de
  l'hôte.

- [ ] **Étape 1 : déplacer les deux fichiers**

```bash
mkdir -p apps/obsidian
git mv src/main.ts apps/obsidian/main.ts
git mv src/plugin.ts apps/obsidian/plugin.ts
```

- [ ] **Étape 2 : réécrire les imports de `plugin.ts`**

Tous les imports relatifs de `apps/obsidian/plugin.ts` qui commencent par `./`
visent désormais `../../src/`. Les remplacer :

```bash
sed -i 's|from "\./|from "../../src/|g' apps/obsidian/plugin.ts
```

Attention : cette commande touche AUSSI `from "./dashboard/scanner"` →
`from "../../src/dashboard/scanner"`, ce qui est correct, mais elle ne doit
**pas** toucher `from "obsidian"` (pas de `./`) ni `from "json5"`. Vérifier :

```bash
grep -n 'from "' apps/obsidian/plugin.ts | grep -v '"\.\./\.\./src/' | grep -v '"obsidian"'
```
Attendu : aucune ligne, ou seulement des paquets npm.

`apps/obsidian/main.ts` garde `export { default } from "./plugin";` — les deux
fichiers ont bougé ensemble, le chemin relatif reste juste.

- [ ] **Étape 3 : mettre à jour l'entrée du build**

Dans `esbuild.config.mjs`, remplacer :

```js
	entryPoints: ["src/main.ts"],
```
par :
```js
	// Le point d'entrée du GREFFON vit sous apps/obsidian/ : c'est un hôte,
	// au même titre qu'apps/windows/. `src/` ne contient que le partagé.
	entryPoints: ["apps/obsidian/main.ts"],
```

- [ ] **Étape 4 : mettre à jour `tsconfig.json`**

Remplacer la ligne `include` par :

```json
  "include": ["src/**/*.ts", "src/**/*.d.ts", "apps/obsidian/**/*.ts"]
```

- [ ] **Étape 5 : mettre à jour le cliquet**

Dans `scripts/check-host.mjs`, retirer de `RESTANTS` la ligne
`"src/plugin.ts",` (`src/main.ts` n'y a jamais figuré : il n'importe rien
d'Obsidian). Elle n'est plus dans `src/` ; le
contrôle ne balaie que `src/` et `apps/windows/src/`, donc `apps/obsidian/` est
hors zone par construction — c'est exactement ce que la spec §4 demande.

- [ ] **Étape 6 : vérifier**

```bash
npm run check
npm run check:host
npm run build
```
Attendu : `tsc` sans erreur ; `Frontière d'hôte : 50 fichier(s) …` ;
`Build terminé.` avec `main.js copié dans N vault(s).`

Puis **test manuel dans Obsidian** : redémarrer Obsidian, ouvrir une note
contenant un bloc `quiz-blocks`, jouer une question, ouvrir le tableau de bord.
Tout doit se comporter exactement comme avant.

- [ ] **Étape 7 : ÉPROUVER que le build pointe bien au bon endroit**

```bash
mv apps/obsidian/main.ts apps/obsidian/main.ts.bak && npm run build
```
Attendu : esbuild échoue avec `Could not resolve "apps/obsidian/main.ts"`.
Si le build RÉUSSIT, c'est qu'il compile encore autre chose — l'entrée n'a pas
été prise en compte.
Restaurer : `mv apps/obsidian/main.ts.bak apps/obsidian/main.ts && npm run build`.

- [ ] **Étape 8 : double encodage et commit**

```bash
grep -rn 'Ă\|Â\|â€' apps/obsidian/ esbuild.config.mjs tsconfig.json
git add -A apps/obsidian src esbuild.config.mjs tsconfig.json scripts/check-host.mjs
git commit -m "$(cat <<'EOF'
refactor(obsidian): deplacer le point d'entree du greffon sous apps/obsidian/

Un hote importe le code partage ; le partage n'importe jamais un hote. Tant
que plugin.ts vivait dans src/, la dependance allait dans le mauvais sens et
apps/obsidian/host.ts aurait ete importe depuis src/.

Seuls des chemins d'import et l'entree esbuild changent : aucun comportement.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 3 — L'hôte Obsidian

**But :** l'implémentation Obsidian du contrat, écrite et **testée avant son
premier consommateur**. Aucune tâche ne remplacera donc un chemin qui marche
par un chemin non éprouvé.

**Fichiers :**
- Créer : `apps/obsidian/host.ts`
- Créer : `scripts/check-obsidian-host.mjs`
- Modifier : `apps/obsidian/plugin.ts` (installation dans `onload`, retrait dans
  `onunload`)
- Modifier : `package.json` (script `check:obsidian-host`)
- Modifier : `scripts/lib/load-src.mjs` (compléter le bouchon)

**Interfaces :**
- Consomme : `Host` et ses sous-contrats (tâche 1) ; `installHost`,
  `uninstallHost` (tâche 1).
- Produit : `createObsidianHost(app: App, plugin: Plugin): Host`, exporté par
  `apps/obsidian/host.ts`. Consommé par `plugin.ts` seulement.

- [ ] **Étape 1 : écrire le jeu de cas d'abord**

Créer `scripts/check-obsidian-host.mjs` :

```js
/**
 * Vérification de l'HÔTE OBSIDIAN.
 *
 * L'hôte est la seule pièce que le moteur ne pourra plus contourner : une
 * méthode qui renvoie silencieusement `null` rendrait les images, le bouton
 * ressource ou la sauvegarde inertes sans un mot. On le charge donc avec le
 * bouchon `obsidian` de load-src.mjs et une fausse `App`, comme
 * check-scanner.mjs le fait déjà.
 *
 *     npm run check:obsidian-host
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Fausse App : la surface EXACTE que l'hôte consomme, rien de plus. */
function fausseApp(fichiers) {
	const parChemin = new Map(fichiers.map(f => [f.path, f]));
	return {
		vault: {
			getMarkdownFiles: () => fichiers.filter(f => f.extension === "md"),
			getFiles: () => fichiers,
			getAbstractFileByPath: (p) => parChemin.get(p) ?? null,
			cachedRead: async (f) => "cache:" + f.path,
			read: async (f) => "disque:" + f.path,
			getResourcePath: (f) => "app://vault/" + f.path,
			adapter: {
				read: async (p) => "disque:" + p,
				write: async () => undefined,
				exists: async (p) => parChemin.has(p),
				mkdir: async () => undefined,
				getResourcePath: (p) => "app://vault/" + p,
			},
			on: () => ({}),
			offref: () => undefined,
		},
		metadataCache: {
			getFirstLinkpathDest: (lien) => parChemin.get(lien + ".md") ?? null,
		},
		workspace: { getLeavesOfType: () => [], getLeaf: () => null },
	};
}

const fichier = (path, extension) => ({
	path,
	name: path.split("/").pop(),
	basename: path.split("/").pop().replace(/\.[^.]+$/, ""),
	extension,
	stat: { mtime: 42 },
});

await withSrcModule("apps/obsidian/host.ts", async ({ createObsidianHost }) => {
	const r = makeReporter("Hôte Obsidian");
	const fichiers = [
		fichier("Cours/ch1.md", "md"),
		fichier("Images/schema.png", "png"),
		fichier("Autre/schema.png", "png"),
	];
	const host = createObsidianHost(fausseApp(fichiers), { register: () => undefined });

	/* HostFile est PLAT et sérialisable : un TFile ne doit jamais fuir dans le
	   code partagé, sinon Windows devra fabriquer un faux TFile. */
	const converti = host.fs.getFile("Cours/ch1.md");
	r.check("un TFile se réduit exactement à un HostFile",
		converti,
		{ path: "Cours/ch1.md", name: "ch1.md", basename: "ch1", extension: "md", mtime: 42 });
	r.check("aucune méthode ne survit à la conversion",
		Object.values(converti).every(v => typeof v !== "function" && typeof v !== "object"), true);

	// L'index ne rend QUE les markdown : le scanner balaie dessus.
	r.check("listMarkdown ne renvoie que les .md",
		host.fs.listMarkdown().map(f => f.path), ["Cours/ch1.md"]);

	/* findByName renvoie TOUS les homonymes : engine/resources.ts prévient
	   l'utilisateur quand il y en a plusieurs. N'en rendre qu'un ferait
	   disparaître l'avertissement sans que rien ne le signale. */
	r.check("findByName rend tous les homonymes, casse ignorée",
		host.fs.findByName("SCHEMA.PNG").map(f => f.path),
		["Images/schema.png", "Autre/schema.png"]);
	r.check("findByName sur un nom absent rend une liste vide",
		host.fs.findByName("absent.png"), []);

	// La résolution de wikilink passe par le metadataCache, pas par le chemin nu.
	r.check("resolve suit le metadataCache",
		host.links.resolve("Cours/ch1", "note.md")?.path, "Cours/ch1.md");
	r.check("resolve rend null plutôt qu'un objet vide",
		host.links.resolve("introuvable", "note.md"), null);

	/* resourceUrl rend null, JAMAIS la chaîne vide : `src=""` fait recharger
	   la page courante comme image. */
	r.check("resourceUrl d'un HostFile", host.links.resourceUrl(converti), "app://vault/Cours/ch1.md");
	r.check("resourceUrl accepte aussi un chemin", host.links.resourceUrl("Images/schema.png"), "app://vault/Images/schema.png");

	// readCached et read sont deux chemins distincts, pas un alias.
	r.check("readCached passe par le cache", await host.fs.readCached("Cours/ch1.md"), "cache:Cours/ch1.md");
	r.check("read passe par le disque", await host.fs.read("Cours/ch1.md"), "disque:Cours/ch1.md");

	/* Le dossier de résultats NE CHANGE PAS : les fichiers déjà écrits par les
	   versions précédentes doivent rester trouvables. */
	r.check("resultsDir reste celui du greffon", host.paths.resultsDir, ".obsidian/quiz-blocks-results");

	// Le contrat est complet : une méthode manquante rendrait un pan inerte.
	const attendu = {
		fs: ["read", "readCached", "write", "exists", "mkdirs", "listMarkdown", "findByName", "getFile"],
		links: ["resolve", "resourceUrl"],
		watcher: ["onChange"],
		ui: ["notice", "setIcon"],
		math: ["ready", "render", "flush"],
		shell: ["openExternal", "revealInHost"],
	};
	const manquantes = [];
	for (const [zone, noms] of Object.entries(attendu)) {
		for (const nom of noms) if (typeof host[zone]?.[nom] !== "function") manquantes.push(zone + "." + nom);
	}
	r.check("aucune méthode du contrat ne manque", manquantes, []);
	r.check("platform est renseigné",
		["isMobile", "isMacOS", "uiLanguage"].filter(k => !(k in host.platform)), []);

	r.done();
});
```

- [ ] **Étape 2 : lancer le jeu de cas et le voir échouer**

```bash
node scripts/check-obsidian-host.mjs
```
Attendu : ÉCHEC — `Could not resolve "apps/obsidian/host.ts"`.

- [ ] **Étape 3 : écrire l'hôte Obsidian**

Créer `apps/obsidian/host.ts`. Points imposés :

- La signature : `export function createObsidianHost(app: App, plugin: Plugin): Host`.
- Un helper privé `toHostFile(f: TFile): HostFile` — **le seul endroit** du
  dépôt où un `TFile` devient un `HostFile`. Commentaire expliquant que laisser
  fuir un `TFile` obligerait Windows à en fabriquer un faux.
- `fs.listMarkdown()` : `app.vault.getMarkdownFiles().map(toHostFile)`.
- `fs.findByName(name)` : filtre `app.vault.getFiles()` sur `f.name` en
  minuscules — **tous** les homonymes, casse ignorée.
- `fs.getFile(path)` : `app.vault.getAbstractFileByPath(path)`, converti
  seulement si `instanceof TFile`.
- `fs.read` / `readCached` : passent par `app.vault.read` / `cachedRead` quand
  le chemin est un `TFile` connu, sinon par `app.vault.adapter.read`.
- `fs.write` / `exists` / `mkdirs` : `app.vault.adapter`. `mkdirs` reprend
  telle quelle la boucle `ensureFolder` de `engine/results-save.ts` (segment par
  segment, `exists` puis `mkdir`) — elle déménage ici, elle ne se duplique pas.
- `links.resolve(linkPath, fromPath)` : `metadataCache.getFirstLinkpathDest`
  puis repli sur `vault.getAbstractFileByPath` — même ordre et mêmes
  `try/catch` que `engine/sanitizer.ts:428-450` aujourd'hui.
- `links.resourceUrl(target)` : `vault.getResourcePath` pour un `HostFile`
  reconverti, `vault.adapter.getResourcePath` pour un chemin nu ; **`null`** si
  rien ne sort, jamais `""`.
- `watcher.onChange(cb)` : quatre `app.vault.on("create"/"modify"/"delete"/
  "rename")`, chacun traduit en `HostFileEvent` ; le retour désabonne via
  `app.vault.offref`. Ne remonter que les `TFile`.
- `ui.notice(msg, ms)` : `new Notice(msg, ms)`, enveloppé d'un `try/catch` qui
  retombe sur `console.log` — comportement actuel de `quizNotice`.
- `ui.setIcon(el, name)` : `setIcon` d'Obsidian.
- `math` : `loadMathJax` / `renderMath` / `finishRenderMath`, avec la
  mémoïsation NON mémoïsée à l'échec, reprise telle quelle de
  `engine/mathjax.ts:16-27`.
- `shell.openExternal(file)` : reprend `openWithDefaultAppFromVault`
  (`engine/resources.ts:78-107`), y compris le repli Electron `shell.openPath`.
- `shell.revealInHost(file)` : reprend `revealFileInObsidianExplorer`
  (`engine/resources.ts:35-54`).
- `platform` : `{ isMobile: Platform.isMobile, isMacOS: Platform.isMacOS,
  uiLanguage: <langue d'Obsidian> }`. La langue se lit sur
  `window.i18next.language`, avec repli sur `document.documentElement.lang`
  puis `"en"` — c'est exactement ce que fait `detectObsidianLang` dans
  `src/i18n.ts`, qui l'appellera à la tâche 8 ; le commentaire doit dire que
  ce n'est pas une API publique (absente d'`obsidian.d.ts`).
- `paths.resultsDir` : `".obsidian/quiz-blocks-results"`, avec le commentaire
  disant que la valeur NE CHANGE PAS.

Si le fichier dépasse ~350 lignes, le scinder en `apps/obsidian/host/fs.ts`,
`host/ui.ts`, `host/shell.ts` agrégés par `apps/obsidian/host.ts` — et adapter
l'entrée de `withSrcModule` en conséquence.

- [ ] **Étape 4 : compléter le bouchon obsidian si nécessaire**

`scripts/lib/load-src.mjs` remplace `obsidian` par un bouchon. L'hôte utilise
`Platform`, `TFile`, `Notice`, `setIcon`, `loadMathJax`, `renderMath`,
`finishRenderMath`. Ajouter au `OBSIDIAN_STUB` ce qui manque :

```js
	"export const renderMath = () => nope('renderMath');",
	"export const finishRenderMath = () => nope('finishRenderMath');",
```

`Platform` y est déjà un objet vide (`isMacOS` vaudra `undefined`, ce qui est
correct : le jeu de cas ne vérifie que la présence des clés). `TFile` est une
classe vide, donc `instanceof TFile` est faux pour nos faux fichiers — le jeu
de cas ci-dessus n'appelle jamais `getFile` sur un chemin qui exigerait le test
`instanceof`… **sauf** `getFile("Cours/ch1.md")`. Faire donc que `getFile`
n'exige pas `instanceof TFile` mais la présence de `extension` (un `TFolder`
n'en a pas) ; documenter ce choix : le bouchon ne peut pas fabriquer de vrai
`TFile`, et exiger `instanceof` rendrait ce contrôle intestable.

- [ ] **Étape 5 : lancer le jeu de cas jusqu'au vert**

```bash
node scripts/check-obsidian-host.mjs
```
Attendu : `Hôte Obsidian : 14/14 cas passent`.

- [ ] **Étape 6 : ÉPROUVER trois cas (chacun doit rougir)**

1. Dans `host.ts`, faire renvoyer à `findByName` seulement le premier
   homonyme (`.slice(0, 1)`). Relancer.
   Attendu : `ÉCHEC  findByName rend tous les homonymes, casse ignorée`.
   Restaurer.
2. Faire renvoyer `""` au lieu de `null` à `links.resourceUrl` quand rien ne
   sort, et à `links.resolve` un objet vide au lieu de `null`. Relancer.
   Attendu : `ÉCHEC  resolve rend null plutôt qu'un objet vide`. Restaurer.
3. Supprimer la méthode `fs.mkdirs`. Relancer.
   Attendu : `ÉCHEC  aucune méthode du contrat ne manque` avec
   `["fs.mkdirs"]`. Restaurer.

Si l'un des trois reste vert, le cas ne garde rien : le corriger avant de
poursuivre.

- [ ] **Étape 7 : installer l'hôte dans le greffon**

Dans `apps/obsidian/plugin.ts` :

```ts
import { createObsidianHost } from "./host";
import { installHost, uninstallHost } from "../../src/host/current";
```

Dans `onload()`, **avant** toute création de vue ou de scanner :

```ts
		/* L'hôte s'installe en TOUT PREMIER : le moteur, le scanner et le
		   rendu mathématique le lisent par `currentHost()`, qui jette si rien
		   n'est installé. Une installation tardive ne produirait pas un rendu
		   dégradé mais une exception au premier quiz. */
		installHost(createObsidianHost(this.app, this));
```

Dans `onunload()`, en dernier :

```ts
		/* Sans ça, un rechargement du greffon laisserait un hôte pointant vers
		   une `App` morte, et le suivant croirait avoir un hôte valide. */
		uninstallHost();
```

- [ ] **Étape 8 : brancher le script, vérifier, tester dans Obsidian**

Ajouter à `package.json` :
```json
"check:obsidian-host": "node scripts/check-obsidian-host.mjs",
```

```bash
npm run check && npm run check:host && npm run check:obsidian-host && npm run build
grep -rn 'Ă\|Â\|â€' apps/obsidian/ scripts/check-obsidian-host.mjs
```
Attendu : tout vert, `grep` vide. `check:host` annonce toujours 50 fichiers —
rien n'a encore migré, c'est normal.

**Test manuel dans Obsidian** : redémarrer, jouer un quiz, ouvrir le tableau de
bord. Rien ne doit avoir changé ; l'hôte est construit mais encore inutilisé.

- [ ] **Étape 9 : commit**

```bash
git add apps/obsidian/host.ts apps/obsidian/plugin.ts scripts/check-obsidian-host.mjs scripts/lib/load-src.mjs package.json
git commit -m "$(cat <<'EOF'
feat(host): implementer le contrat cote Obsidian

Ecrit et eprouve AVANT son premier consommateur : aucune tache suivante ne
remplacera un chemin qui marche par un chemin non eprouve.

toHostFile est le seul endroit du depot ou un TFile devient un HostFile.
Laisser fuir un TFile obligerait l'hote Windows a en fabriquer un faux.

resourceUrl rend null et jamais "" : src="" recharge la page comme image.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---


## Tâche 4 — Le moteur : toasts, icônes, plateforme

**But :** retirer du moteur `ctx.Notice`, `setIcon` et `Platform`. Trois
symboles, dix appels, aucune logique touchée : c'est l'échange le plus simple,
et il ouvre la voie aux deux suivants.

**Fichiers :**
- Modifier : `src/types/engine-ctx.ts` (ajouter `host`, retirer `Notice`)
- Modifier : `src/engine.ts:26,47-54,58-66,168` (le contexte d'appel)
- Modifier : `src/engine/exam.ts:208-209,223-224`
- Modifier : `src/engine/interactions.ts:440-441,449-450`
- Modifier : `src/engine/state.ts:290,509`
- Modifier : `src/engine/resources.ts:25-27` (`quizNotice`)
- Modifier : `src/engine/math-input.ts:12,173,227,232`
- Modifier : `apps/obsidian/plugin.ts:1167-1174` (l'appel du moteur)
- Modifier : `scripts/check-host.mjs` (retirer `src/engine/math-input.ts`)

**Interfaces :**
- Consomme : `Host`, `currentHost()` (tâche 1) ; `createObsidianHost` installé
  par `plugin.ts` (tâche 3).
- Produit : `EngineCtx.host: Host` — lu par les tâches 5 et 6.
  `RenderQuizContext` devient
  `{ container: HTMLElement; quiz: QuizQuestion[]; sourcePath: string; statsSink?; reviewSink? }` :
  plus de `app`, plus de `plugin`, plus de `Notice`. La tâche 11 appelle
  `renderInteractiveQuiz` avec exactement cette forme.

- [ ] **Étape 1 : ajouter `host` au `ctx`, retirer `Notice`**

Dans `src/types/engine-ctx.ts`, remplacer le bloc `app` / `plugin` / `Notice`
(lignes 101-107) par :

```ts
	/**
	 * L'HÔTE. Tout ce que le moteur demandait à Obsidian passe par là :
	 * fichiers, liens, toasts, icônes, mathématiques, ouverture externe.
	 * Assigné à l'assemblage depuis `currentHost()` — une seule installation,
	 * une seule source (src/host/current.ts).
	 */
	host: Host;
	container: HTMLElement;
	sourcePath: string;
```

Remplacer l'import `import type { App, Plugin } from "obsidian";` (ligne 41) par
`import type { Host } from "../host/types";`.

Ajouter, à côté de `reviewSink` :

```ts
	/**
	 * Puits des statistiques du tableau de bord. Même principe que
	 * `reviewSink` : le moteur ne connaît que la FORME. Il lisait
	 * `plugin._statsStore`, ce qui le liait au greffon pour une seule
	 * fonction ; l'app n'a pas de `Plugin`.
	 */
	statsSink?: { updateRecord(path: string, update: StatsRecord): unknown };
```

`StatsRecord` est déjà exporté par `src/types/quiz.ts` — l'importer.

- [ ] **Étape 2 : changer le contexte d'appel du moteur**

Dans `src/engine.ts`, remplacer l'import ligne 26 par
`import { currentHost } from "./host/current";` et l'interface
`RenderQuizContext` (lignes 47-54) par :

```ts
/**
 * Contexte d'appel du moteur, construit par l'hôte (le processeur de bloc du
 * greffon, ou la page de quiz de l'app). Ce n'est PAS le
 * MarkdownPostProcessorContext d'Obsidian. Nommé `context` (jamais `ctx`)
 * pour ne pas se confondre avec le god-object assemblé plus bas.
 *
 * Il ne porte plus `app`, `plugin` ni `Notice` : l'hôte est LU (currentHost),
 * pas TRANSMIS. Un hôte passé en paramètre laisserait deux hôtes coexister le
 * jour où un appelant oublierait de le passer.
 */
interface RenderQuizContext {
	container: HTMLElement;
	quiz: QuizQuestion[];
	sourcePath: string;
	/** Absent = jouer ce quiz ne compte simplement pas de statistiques.
	    Ce n'est pas une erreur : la page « Générer » n'en a pas. */
	statsSink?: EngineCtx["statsSink"];
	/** Absent = les réponses ne sont pas journalisées. Même raison. */
	reviewSink?: EngineCtx["reviewSink"];
}
```

Dans le corps : la déstructuration (lignes 58-66) perd `app`, `plugin` et
`Notice` et gagne `statsSink`, `reviewSink`. L'assemblage du `ctx` remplace
`app`/`plugin`/`Notice` par `host: currentHost()`, et le **getter**
`get reviewSink() { return (plugin as …)._reviewStore; }` (ligne 168) devient un
champ simple `reviewSink`. Commentaire à poser :

```ts
	/* `reviewSink` était un accessor parce qu'il lisait `plugin._reviewStore`,
	   assigné après le chargement du greffon. Il arrive maintenant par le
	   contexte d'appel, donc déjà résolu : un accessor n'aurait plus rien à
	   différer. Les flags `__quiz*` restent copiés par VALEUR et l'état vivant
	   reste lu par accessors de closure — cette distinction-là ne bouge pas. */
```

- [ ] **Étape 3 : remplacer les dix appels**

| Fichier:ligne | Avant | Après |
|---|---|---|
| `engine/exam.ts:208` | garde + `new ctx.Notice(t(…), 6000)` | `ctx.host.ui.notice(t("engine.exam.timeUpManual"), 6000);` |
| `engine/exam.ts:223` | garde + `new ctx.Notice(t(…), 5000)` | `ctx.host.ui.notice(t("engine.exam.timeUpLocked"), 5000);` |
| `engine/interactions.ts:440` | garde + `new ctx.Notice(…, 5000)` | `ctx.host.ui.notice(t("engine.result.savedNotice", { path: saved.path }), 5000);` |
| `engine/interactions.ts:449` | garde + `new ctx.Notice(…)` | `ctx.host.ui.notice(t("engine.result.saveError", { … }));` |
| `engine/state.ts:290` | garde + `new ctx.Notice(t(…))` | `ctx.host.ui.notice(t("engine.lesson.skipBlocked"));` |
| `engine/state.ts:509` | `(ctx.plugin as { _statsStore?: … })._statsStore` | `ctx.statsSink` |
| `engine/resources.ts:25-27` | corps de `quizNotice` | `ctx.host.ui.notice(String(msg), timeout);` |
| `engine/math-input.ts:173` | `Platform.isMacOS` | `currentHost().platform.isMacOS` |
| `engine/math-input.ts:227` | `setIcon(grip, "grip-horizontal")` | `currentHost().ui.setIcon(grip, "grip-horizontal")` |
| `engine/math-input.ts:232` | `setIcon(close, "x")` | `currentHost().ui.setIcon(close, "x")` |

Les gardes `if (typeof ctx.Notice === "function")` **disparaissent** :
`host.ui.notice` est obligatoire dans le contrat, et le `try/catch` qui retombe
sur `console.log` vit désormais dans l'hôte. Une garde conservée ici masquerait
un hôte incomplet au lieu de le signaler.

Dans `engine/state.ts:509`, la garde `if (statsStore && ctx.sourcePath)` reste
telle quelle avec `ctx.statsSink` : le puits est légitimement optionnel. Le
commentaire existant sur `resultsCounted` et l'indépendance des deux effets de
bord (statistiques et journal) reste **inchangé**.

Dans `engine/math-input.ts`, supprimer
`import { Platform, setIcon } from "obsidian";`, ajouter
`import { currentHost } from "../host/current";` et poser au-dessus :

```ts
/* Ce module n'a pas de `ctx` : il expose des fonctions directes appelées par
   engine/terminal.ts et editor/question-preview.ts. Il lit donc l'hôte par
   `currentHost()` — le MÊME objet que `ctx.host`, installé une seule fois. */
```

- [ ] **Étape 4 : adapter l'appel du greffon**

Dans `apps/obsidian/plugin.ts`, remplacer l'appel (lignes 1167-1174) par :

```ts
					await renderInteractiveQuiz({
						container: host,
						quiz: quizToRender,
						sourcePath: mdCtx.sourcePath,
						statsSink: this._statsStore,
						reviewSink: this._reviewStore,
					});
```

- [ ] **Étape 5 : typecheck, et laisser le compilateur énumérer les oublis**

```bash
npm run check
```
Attendu : d'abord une erreur par site oublié
(`Property 'Notice' does not exist on type 'EngineCtx'`), puis zéro.
`strict` + le retrait du champ du type font que le compilateur les liste : ne
pas les chercher à la main.

- [ ] **Étape 6 : le cliquet doit rétrécir**

```bash
npm run check:host
```
Attendu : `ÉCHEC  src/engine/math-input.ts n'importe plus « obsidian » : retirez-le de RESTANTS.`

C'est le cliquet qui fonctionne. Retirer la ligne `"src/engine/math-input.ts",`
de `RESTANTS`, relancer.
Attendu : `Frontière d'hôte : 49 fichier(s) …`

- [ ] **Étape 7 : ÉPROUVER que la garde retirée ne peut pas revenir**

Dans `src/engine/exam.ts`, remettre temporairement
`if (typeof (ctx as { Notice?: unknown }).Notice === "function")` autour de
l'appel, puis :

```bash
npm run check && npm run build
```
Attendu : `tsc` **passe** (le cast le permet). Puis, dans Obsidian, lancer un
examen d'une minute et laisser le temps expirer : **aucun toast**. C'est
exactement le défaut silencieux que la relecture laisse passer.
Restaurer, rebuild, rejouer : le toast revient.

C'est l'épreuve la plus importante de cette tâche. Deux des quatre défauts du
chantier précédent avaient cette forme : une fonctionnalité rendue inerte sans
qu'aucune vérification ne rougisse.

- [ ] **Étape 8 : jeux de cas existants, build, Obsidian**

```bash
npm run check && npm run check:host && npm run check:obsidian-host \
  && npm run check:md && npm run check:export && npm run check:engine-review \
  && npm run check:lesson && npm run build
grep -rn 'Ă\|Â\|â€' src/engine src/engine.ts src/types/engine-ctx.ts apps/obsidian/plugin.ts
```

`check:lesson` **doit aller jusqu'au bout** : il MEURT sur une exception au lieu
d'échouer proprement, et une mort en cours de route masque en silence tous les
groupes qui suivent (c'est arrivé, onze groupes cachés). Compter les groupes
affichés et vérifier qu'aucun ne manque par rapport à une exécution d'avant la
tâche.

**Test manuel dans Obsidian** : jouer un quiz jusqu'aux résultats (toast de
sauvegarde), lancer un examen court et laisser le temps expirer (toast), ouvrir
une question mathématique (le clavier virtuel affiche ses deux icônes, poignée
et croix), sauter une carte en mode leçon (toast de blocage).

- [ ] **Étape 9 : commit**

```bash
git add src/engine src/engine.ts src/types/engine-ctx.ts apps/obsidian/plugin.ts scripts/check-host.mjs
git commit -m "$(cat <<'EOF'
refactor(engine): toasts, icones et plateforme passent par l'hote

Les gardes `if (typeof ctx.Notice === "function")` disparaissent : notice est
obligatoire dans le contrat, et le try/catch de repli vit dans l'hote. Une
garde conservee ici masquerait un hote incomplet au lieu de le signaler —
c'est exactement la forme des deux defauts silencieux du chantier precedent.

statsSink remplace la lecture de plugin._statsStore : le moteur ne connait
plus que la FORME, comme il le fait deja pour reviewSink.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 5 — Le moteur : fichiers, liens, ressources

**But :** retirer du moteur les quatre derniers accès à Obsidian —
`metadataCache`, `vault.getResourcePath`, `vault.adapter`, `vault.getFiles`.
Après cette tâche, `src/engine.ts` et tout `src/engine/` sauf `mathjax.ts` sont
hors de la liste du cliquet.

**Fichiers :**
- Modifier : `src/engine/sanitizer.ts:1,28,428-450,470-483`
- Modifier : `src/engine/cards.ts:153-163`
- Modifier : `src/engine/resources.ts` (entier : il maigrit de ~70 lignes)
- Modifier : `src/engine/results-save.ts:1,66,420-437,440-447,451,478-483`
- Modifier : `src/types/engine-ctx.ts` (signature de `resolveEmbedFile`)
- Modifier : `scripts/check-obsidian-host.mjs` (un cas de plus)
- Modifier : `scripts/check-host.mjs`

**Interfaces :**
- Consomme : `ctx.host` (tâche 4) ; `HostFs`, `HostLinks`, `HostShell`,
  `HostPaths`, `HostFile` (tâche 1) ; l'hôte Obsidian (tâche 3).
- Produit : `ResourceHandlers` change de forme —
  `findFilesByExactName(fileName: string): HostFile[]`,
  `handleQuizResourceButtonClick(fileName: string | undefined): Promise<void>`,
  `bindQuizResourceButtons(rootEl?: Element | null): void`,
  `quizNotice(msg: unknown, timeout?: number): void`.
  `revealFileInObsidianExplorer`, `openVaultFileFallback` et
  `openWithDefaultAppFromVault` **disparaissent** de la surface publique.
  Le sanitizer expose `resolveEmbedFile(linkPath: unknown): HostFile | null`
  (ex-`resolveObsidianEmbedFile`). `SavedResults` perd `absolutePath` et vaut
  désormais `{ path: string }`.

- [ ] **Étape 1 : le sanitizer — résolution des `![[…]]`**

Dans `src/engine/sanitizer.ts` :

- Supprimer `import type { TAbstractFile, TFile } from "obsidian";`, ajouter
  `import type { HostFile } from "../host/types";`.
- Ligne 28 : `resolveObsidianEmbedFile(linkPath: unknown): TAbstractFile | null;`
  devient `resolveEmbedFile(linkPath: unknown): HostFile | null;`.
- Corps (lignes 428-450) : les deux `try/catch` fusionnent en un appel, parce
  que l'ordre — index des liens, puis chemin nu — a déménagé dans l'hôte :

```ts
	/**
	 * Résolution d'un `![[lien]]`. L'ordre (index des liens d'abord, chemin nu
	 * ensuite) et ses `try/catch` vivent désormais dans l'hôte : c'est
	 * précisément ce qui diffère entre Obsidian, qui tient un index de liens,
	 * et un dossier nu, qui doit chercher par nom.
	 */
	function resolveEmbedFile(linkPath: unknown): HostFile | null {
		const raw = String(linkPath ?? "").trim();
		if (!raw) return null;
		return ctx.host.links.resolve(raw, ctx.sourcePath || "");
	}
```

- Corps de `buildEmbedImgHtml` (lignes 470-483) :

```ts
		const file = resolveEmbedFile(parsed.linkPath);
		/* La garde porte sur l'URL, pas sur le fichier : `resourceUrl` rend
		   `null` quand rien ne sort, et c'est pour ça qu'il ne rend JAMAIS "".
		   Un `src=""` fait recharger la page courante comme image ; tester
		   seulement `file` produirait `src="null"` au lieu du `<code>` lisible
		   qui dit à l'élève quel lien est mort. */
		const src = file ? ctx.host.links.resourceUrl(file) : null;
		if (src) {
			const widthAttr = parsed.width ? ` width="${parsed.width}"` : "";
			const heightAttr = parsed.height ? ` height="${parsed.height}"` : "";
			const altAttr = escapeHtmlAttr(parsed.alt || file.name || "Image");
			return `<div class="${wrapClass}"><img class="${imgClass}" src="${src}" alt="${altAttr}" loading="eager"${widthAttr}${heightAttr}></div>`;
		}
		return `<code>${escapeHtmlText(`![[${embedSpec}]]`)}</code>`;
```

Le commentaire existant sur `getAbstractFileByPath` pouvant rendre un `TFolder`
disparaît avec lui : `HostFile` ne décrit que des fichiers.

- [ ] **Étape 2 : les images d'un `optionHtml`**

Dans `src/engine/cards.ts`, lignes 155-162 :

```ts
			/* Préfixes DÉJÀ résolus : `app:` sous Obsidian, `asset:` et
			   `http://asset.localhost` sous Tauri. Sans `asset:`, l'app
			   réécrirait une URL déjà bonne au second passage — un défaut qui
			   n'apparaîtrait qu'à l'exécution, dans l'app seulement. Un cas de
			   check-obsidian-host garde cette liste. */
			tpl.content.querySelectorAll("img[src]").forEach(img => {
				const src = img.getAttribute("src") || "";
				if (/^(https?:|data:|app:|asset:|tauri:)/i.test(src)) return;
				const resolved = ctx.host.links.resourceUrl(src);
				// Chemin non résoluble : laissé tel quel, la liste blanche tranchera.
				if (resolved) img.setAttribute("src", resolved);
			});
```

Les commentaires existants sur l'ordre RÉSOUDRE puis ASSAINIR, sur la
résolution par le DOM et non par substitution de chaîne, et sur le `<template>`
inerte restent **strictement inchangés** : ces trois règles ont chacune coûté
un bug.

- [ ] **Étape 3 : le bouton ressource**

`src/engine/resources.ts` maigrit : `revealFileInObsidianExplorer`,
`openVaultFileFallback` et `openWithDefaultAppFromVault` (~70 lignes d'API
Obsidian et de repli Electron) ont déménagé dans l'hôte à la tâche 3. Il reste
l'orchestration :

```ts
import type { HostFile } from "../host/types";
import type { EngineCtx } from "../types/engine-ctx";
import { t } from "../i18n";

export type ResourceOpenMode = "default-app" | "system-chooser" | "failed";

export interface ResourceHandlers {
	quizNotice(msg: unknown, timeout?: number): void;
	findFilesByExactName(fileName: string): HostFile[];
	handleQuizResourceButtonClick(fileName: string | undefined): Promise<void>;
	bindQuizResourceButtons(rootEl?: Element | null): void;
}

export function createResourceHandlers(ctx: EngineCtx): ResourceHandlers {
	const QUIZ_RESOURCE_NOTICE_MS = { defaultApp: 3400, androidSystem: 7200, fallbackOpen: 2400, warning: 3200, error: 3200 };

	function quizNotice(msg: unknown, timeout = 4000): void {
		ctx.host.ui.notice(String(msg), timeout);
	}

	function findFilesByExactName(fileName: string): HostFile[] {
		return ctx.host.fs.findByName(String(fileName ?? "").trim());
	}

	async function handleQuizResourceButtonClick(fileName: string | undefined): Promise<void> {
		try {
			const rawName = String(fileName ?? "").trim();
			if (!rawName) return void quizNotice(t("engine.resource.missingName"), QUIZ_RESOURCE_NOTICE_MS.warning);
			const matches = findFilesByExactName(rawName);
			if (matches.length === 0) return void quizNotice(t("engine.resource.notFound", { name: rawName }), QUIZ_RESOURCE_NOTICE_MS.warning);
			/* Plusieurs homonymes : on PRÉVIENT et on ouvre quand même le
			   premier. Refuser d'ouvrir laisserait l'élève sans son document
			   pour une ambiguïté qu'il n'a pas créée. */
			if (matches.length > 1) quizNotice(t("engine.resource.duplicate", { name: rawName }), QUIZ_RESOURCE_NOTICE_MS.warning);
			const file = matches[0];
			await ctx.host.shell.revealInHost(file);
			/* Les 180 ms laissent l'explorateur d'Obsidian finir son animation
			   avant que le fichier s'ouvre par-dessus. Sur un hôte sans
			   explorateur (`revealInHost` rend false tout de suite) l'attente
			   est sans effet — c'est préférable à deux enchaînements
			   différents, qu'il faudrait garder synchrones. */
			await new Promise<void>(r => setTimeout(r, 180));
			const openResult = await ctx.host.shell.openExternal(file);
			// … suite inchangée : messages selon openResult, mode et plateforme.
		} catch (e) { /* … inchangé … */ }
	}

	// … bindQuizResourceButtons : inchangé.
}
```

`ctx.host.shell.openExternal` rend un `boolean`, alors que
`openWithDefaultAppFromVault` rendait `{ ok, mode }`. Le `mode` distinguait
`system-chooser` (Android) de `default-app` : il se recalcule ici à partir de
`ctx.host.platform.isMobile`, qui est la seule information dont il dépendait.
Le documenter.

- [ ] **Étape 4 : l'écriture des résultats**

Dans `src/engine/results-save.ts` :

- Supprimer `import type { DataAdapter } from "obsidian";`.
- Ligne 66 : `const RESULTS_DIR = ctx.host.paths.resultsDir;`, avec :

```ts
	/* Le dossier vient de l'HÔTE : sous Obsidian il vaut toujours
	   « .obsidian/quiz-blocks-results » et NE CHANGE PAS (les résultats déjà
	   écrits doivent rester trouvables) ; un dossier de quiz nu n'a pas de
	   `.obsidian/`. */
```

- `ensureFolder(adapter, folderPath)` (lignes 420-428) **disparaît** : sa boucle
  segment-par-segment a déménagé dans `host.fs.mkdirs`. La remplacer par
  `await ctx.host.fs.mkdirs(RESULTS_DIR);`.
- `uniquePath(adapter, basePath, ext)` devient `uniquePath(basePath, ext)` et
  passe `(chemin) => ctx.host.fs.exists(chemin)`. **Garder intégralement** les
  deux commentaires sur le suffixe TIRÉ AU SORT et sur `reserveFreePath` : deux
  fenêtres sauvegardant le même quiz dans la même seconde choisissaient le même
  `-2`, et la seconde écrasait la première.
- `saveCurrentResults` : supprimer la garde
  `if (!adapter || typeof adapter.write !== "function")` — `write` est
  obligatoire dans le contrat, et une garde ici masquerait un hôte incomplet.
  La clé `engine.result.storageUnavailable` reste utilisée, mais dans le
  `catch` de l'écriture réelle.
- `absolutePath` (lignes 478-483) **disparaît** de `SavedResults` :

```ts
		/* `absolutePath` est supprimé, pas rendu optionnel : il n'existait que
		   sur le FileSystemAdapter d'Obsidian (desktop), absent du contrat.
		   Le laisser optionnel garderait un appelant qui croit lire un chemin
		   absolu et en affiche un relatif. Le toast de confirmation
		   (interactions.ts) montre le chemin relatif, aussi lisible. */
```

`npm run check` énumère les lecteurs à corriger.

- [ ] **Étape 5 : garder la liste des préfixes déjà résolus**

Ajouter à `scripts/check-obsidian-host.mjs`, avant `r.done()` :

```js
	/* La regex de cards.ts décide quelles URL sont DÉJÀ résolues. Un préfixe
	   oublié fait réécrire une URL bonne — et le défaut n'apparaîtrait que
	   dans l'app, à l'exécution. Rien d'autre ne le verrait. */
	const cards = readFileSync("src/engine/cards.ts", "utf8");
	const ligne = cards.split("\n").find(l => l.includes("data:") && l.includes("app:"));
	r.check("les préfixes déjà résolus couvrent les deux hôtes",
		["https?:", "data:", "app:", "asset:", "tauri:"].filter(p => !ligne?.includes(p)), []);
```

avec `import { readFileSync } from "node:fs";` en tête du script.

- [ ] **Étape 6 : typecheck, cliquet, jeux de cas**

```bash
npm run check
npm run check:host
```
Attendu : des ÉCHECS « n'importe plus obsidian » pour `src/engine.ts`,
`src/engine/resources.ts`, `src/engine/results-save.ts`,
`src/engine/sanitizer.ts` et `src/types/engine-ctx.ts`. Les retirer de
`RESTANTS`, relancer.
Attendu : `Frontière d'hôte : 44 fichier(s) …`. `src/engine/mathjax.ts` reste —
c'est la tâche 6.

```bash
npm run check:obsidian-host && npm run check:md && npm run check:markers
```
`check:markers` passe chaque champ texte des vaults réels par la vraie fonction
de rendu (8 570 champs au 2026-07-31, zéro fuite). Attendu : zéro fuite.
**Il éprouve la GRAMMAIRE, pas le CÂBLAGE** : un champ que le moteur affiche
sans appeler le rendu du tout y passe pour sain — c'est ce qui était arrivé au
libellé d'emplacement d'un classement. Le seul filet contre ça est de lire le
DOM rendu dans Obsidian (étape 8).

- [ ] **Étape 7 : ÉPROUVER trois cas**

1. **`resourceUrl` qui rend `""`** — dans `apps/obsidian/host.ts`, rendre `""`
   au lieu de `null`. `npm run check:obsidian-host`.
   Attendu : `ÉCHEC  resourceUrl …`. Restaurer.
2. **La garde `if (src)` remplacée par `if (file)`** — dans `sanitizer.ts`,
   écrire `if (file)` et interpoler `src` tel quel. `npm run check` **passe**,
   `check:markers` **passe**. Puis dans Obsidian, ouvrir un quiz dont un
   `![[…]]` pointe vers un fichier absent : au lieu du `<code>![[…]]</code>`
   lisible, un `<img src="null">` cassé. Restaurer.
   C'est le second exemple de défaut que seule la lecture du DOM rendu attrape.
3. **Le préfixe `asset:` oublié** — le retirer de la regex de `cards.ts`, puis
   `npm run check:obsidian-host`.
   Attendu : `ÉCHEC  les préfixes déjà résolus couvrent les deux hôtes` avec
   `["asset:"]`. Restaurer. Si le cas ne rougit pas, il ne garde rien.

- [ ] **Étape 8 : build, Obsidian, double encodage**

```bash
npm run build
grep -rn 'Ă\|Â\|â€' src/engine src/types/engine-ctx.ts scripts/check-obsidian-host.mjs
```

**Test manuel dans Obsidian**, en lisant le DOM rendu (inspecteur ouvert) :
- un `![[image.png]]` dans un énoncé → l'image s'affiche ;
- une image dans un `optionHtml` → elle s'affiche, `src` commence par `app://` ;
- un `![[fichier-inexistant.png]]` → un `<code>` lisible, pas d'`<img>` ;
- un bouton ressource → l'explorateur se déplace, puis le fichier s'ouvre ;
- un bouton ressource dont le nom est porté par deux fichiers → l'avertissement
  s'affiche **et** le premier s'ouvre ;
- terminer un quiz → le fichier est écrit dans
  `.obsidian/quiz-blocks-results/`, le toast donne le chemin relatif.

- [ ] **Étape 9 : commit**

```bash
git add src/engine src/types/engine-ctx.ts scripts/check-host.mjs scripts/check-obsidian-host.mjs
git commit -m "$(cat <<'EOF'
refactor(engine): fichiers, liens et ressources passent par l'hote

La garde de buildEmbedImgHtml porte sur l'URL et non sur le fichier :
resourceUrl rend null et jamais "", donc tester `file` seul produirait
<img src="null"> au lieu du <code>![[...]]</code> qui dit quel lien est mort.

La liste des prefixes deja resolus couvre asset: et tauri: en plus d'app: :
sans ca l'app reecrirait une URL deja bonne, et le defaut n'apparaitrait
qu'a l'execution. Un cas de check-obsidian-host la garde.

absolutePath est SUPPRIME et non rendu optionnel : il n'existait que sur le
FileSystemAdapter d'Obsidian, et un champ optionnel garderait un appelant qui
croit lire un absolu.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 6 — Le rendu mathématique

**But :** `src/engine/mathjax.ts` cesse de faire `require("obsidian")`. La
segmentation `$…$` / `$$…$$` et le parcours du DOM restent partagés ; seules
les trois primitives de rendu passent par l'hôte.

**Fichiers :**
- Modifier : `src/engine/mathjax.ts:11-27,77,92,103`
- Créer : `scripts/check-math-render.mjs`
- Modifier : `package.json` (script + `linkedom` en devDependency)
- Modifier : `scripts/check-host.mjs`

**Interfaces :**
- Consomme : `HostMath`, `currentHost()` (tâche 1) ; l'hôte Obsidian (tâche 3).
- Produit : `mathifyElement(el: HTMLElement): Promise<void>` et
  `hasMath(text: unknown): boolean` gardent **exactement** leur signature
  actuelle — `dashboard/detail.ts`, `editor/question-preview.ts`,
  `engine/cards.ts`, `engine/hint.ts`, `engine/passage.ts` et
  `engine/math-input.ts` les appellent sans changement.

- [ ] **Étape 1 : installer le DOM de test**

```bash
npm i -D linkedom
```

Node n'a pas de DOM et `mathifyElement` parcourt de vrais nœuds. Une seule
dépendance de développement, utilisée par un seul script : c'est moins que
d'écrire une réplique du parcours, et une réplique validerait le vide.

- [ ] **Étape 2 : écrire le jeu de cas d'abord**

Créer `scripts/check-math-render.mjs` :

```js
/**
 * Vérification du RENDU MATHÉMATIQUE partagé.
 *
 * La segmentation ($$…$$ testé avant $…$, avec l'heuristique qui épargne
 * « 5$ et 3$ ») est du code qu'aucun hôte ne réécrira : c'est elle qui décide
 * ce qui EST une formule. Ce script l'éprouve avec un faux HostMath, ce qui
 * prouve du même coup que plus rien n'appelle Obsidian — le bouchon de
 * load-src.mjs jetterait bruyamment.
 *
 *     npm run check:math-render
 */
import { parseHTML } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const { document } = parseHTML("<html><body></body></html>");
globalThis.document = document;

await withSrcModule(["src/engine/mathjax.ts", "src/host/current.ts"], async (mj, hc) => {
	const r = makeReporter("Rendu mathématique");
	const rendus = [];
	let flushs = 0;
	let prets = 0;

	hc.installHost({
		math: {
			ready: async () => { prets++; },
			render: (latex, display) => {
				rendus.push({ latex, display });
				const el = document.createElement("span");
				el.className = display ? "faux-bloc" : "faux-inline";
				el.textContent = latex;
				return el;
			},
			flush: () => { flushs++; },
		},
	});

	const el = document.createElement("div");
	el.innerHTML = "<p>Soit $x^2$ et $$\\int_0^1 f$$ pour 5$ et 3$.</p>";
	await mj.mathifyElement(el);

	/* Le BLOC doit être reconnu avant l'inline : sinon « $$ » se lit comme
	   deux « $ » vides et la formule est découpée en morceaux. */
	r.check("les deux segments passent par l'hôte, bloc reconnu comme bloc",
		rendus, [{ latex: "\\int_0^1 f", display: true }, { latex: "x^2", display: false }]);
	/* « 5$ et 3$ » n'est PAS une formule : le $ ouvrant doit être collé au
	   contenu. Sans l'heuristique, tout prix d'un énoncé devient du LaTeX. */
	r.check("les vrais dollars sont épargnés", rendus.length, 2);
	r.check("une seule passe finale pour tout l'élément", flushs, 1);
	r.check("l'hôte est préparé avant de rendre", prets >= 1, true);
	r.check("le DOM porte bien les éléments rendus par l'hôte",
		el.querySelectorAll(".faux-bloc, .faux-inline").length, 2);

	// hasMath ne touche pas l'hôte : c'est une reconnaissance, pas un rendu.
	r.check("hasMath reconnaît une formule", mj.hasMath("valeur $x$"), true);
	r.check("hasMath ignore un prix", mj.hasMath("5$ et 3$"), false);
	r.check("hasMath ignore un texte sans dollar", mj.hasMath("rien"), false);

	r.done();
});
```

- [ ] **Étape 3 : lancer et voir échouer**

```bash
node scripts/check-math-render.mjs
```
Attendu : ÉCHEC — `obsidian.loadMathJax n'existe pas hors d'Obsidian`. Le
bouchon jette bruyamment plutôt que de rendre un objet vide : c'est exactement
le comportement voulu.

- [ ] **Étape 4 : brancher `mathjax.ts` sur l'hôte**

Remplacer les lignes 11-27 (`__mathJaxReady` et `ensureMathJax`) par :

```ts
/* Le moteur de rendu vient de l'HÔTE : MathJax sous Obsidian (apparence
   strictement identique aux notes du vault), MathLive dans l'app — déjà une
   dépendance du projet, fontes déjà inlinées.

   La segmentation ci-dessous, elle, reste PARTAGÉE : c'est elle qui décide ce
   qui est une formule, et deux hôtes ne peuvent pas en avoir chacun sa
   version. La mémoïsation de `ready()` — et la règle qu'un échec transitoire
   ne se mémoïse pas — a déménagé dans l'hôte, qui seul sait ce qu'il charge. */
import { currentHost } from "../host/current";
```

- dans `mathifyElement`, remplacer `await ensureMathJax();` par
  `await currentHost().math.ready();` ;
- ligne 77 : `const math = currentHost().math;` remplace la déstructuration de
  `require("obsidian")` ;
- ligne 92 : `frag.appendChild(math.render(display ? m[1] : m[2], display));` ;
- ligne 103 : `math.flush();`.

Supprimer les deux `require("obsidian")` et la variable `__mathJaxReady`.

- [ ] **Étape 5 : vert, puis cliquet**

```bash
node scripts/check-math-render.mjs
```
Attendu : `Rendu mathématique : 8/8 cas passent`.

Ajouter à `package.json` :
```json
"check:math-render": "node scripts/check-math-render.mjs",
```

```bash
npm run check:host
```
Attendu : `ÉCHEC  src/engine/mathjax.ts n'importe plus « obsidian » …`.
Retirer l'entrée, relancer.
Attendu : `Frontière d'hôte : 43 fichier(s) …` — **plus aucun fichier de
`src/engine/` ni `src/engine.ts`**.

- [ ] **Étape 6 : ÉPROUVER deux cas**

1. **L'ordre des segments** — dans `MATH_SEGMENT`, mettre la branche `$…$`
   avant `$$…$$`. Relancer.
   Attendu : `ÉCHEC  les deux segments passent par l'hôte, bloc reconnu comme
   bloc`. Restaurer.
2. **L'heuristique des vrais dollars** — retirer le `(?!\s)` de la branche
   inline. Relancer.
   Attendu : `ÉCHEC  les vrais dollars sont épargnés`, 3 rendus au lieu de 2.
   Restaurer.

Si l'un des deux reste vert, la segmentation n'est pas gardée : corriger le cas
avant de poursuivre.

- [ ] **Étape 7 : vérifier, tester, commiter**

```bash
npm run check && npm run check:host && npm run check:obsidian-host \
  && npm run check:math-render && npm run check:md && npm run build
grep -rn 'Ă\|Â\|â€' src/engine/mathjax.ts scripts/check-math-render.mjs
```

**Test manuel dans Obsidian** : ouvrir un quiz de mathématiques ; formules
inline et bloc rendues à l'identique d'avant (comparer avec le rendu d'une note
normale, qui passe par le MathJax d'Obsidian sans notre code). Une question
`type: math` doit toujours ouvrir son champ MathLive et son clavier virtuel.

```bash
git add src/engine/mathjax.ts scripts/check-math-render.mjs scripts/check-host.mjs package.json package-lock.json
git commit -m "$(cat <<'EOF'
refactor(engine): le rendu mathematique passe par l'hote

La segmentation ($$ avant $, heuristique qui epargne « 5$ et 3$ ») reste
partagee : c'est elle qui decide ce qui EST une formule, et deux hotes ne
peuvent pas en avoir chacun sa version. Seules les trois primitives de rendu
changent — MathJax sous Obsidian, MathLive dans l'app.

check:math-render eprouve la segmentation avec un faux HostMath, ce qui
prouve du meme coup que plus rien n'appelle Obsidian : le bouchon jetterait.

src/engine/ sort entierement de la liste du cliquet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 7 — Le scanner

**But :** `createScanner` cesse de prendre une `App` et prend un `Host`. C'est
la dernière pièce partagée dont la tranche 1 a besoin : sans elle, l'app ne peut
pas lister les quiz d'un dossier.

**Fichiers :**
- Modifier : `src/dashboard/scanner.ts:1-2,91-104,177,206,281-310,313-317`
- Modifier : `apps/obsidian/plugin.ts:1069`
- Modifier : `scripts/check-scanner.mjs` (faux `host` au lieu de faux `app`)
- Modifier : `scripts/check-host.mjs`

**Interfaces :**
- Consomme : `Host`, `HostFile`, `HostFileEvent` (tâche 1) ; `currentHost()`
  (tâche 1) ; l'hôte Obsidian installé par `plugin.ts` (tâche 3).
- Produit : `createScanner(host: Host): Scanner` ;
  `Scanner.scanFile(file: HostFile): Promise<void>`. Le reste de `Scanner`
  (`init`, `destroy`, `scanVault`, `getQuizzes`, `getQuiz`,
  `getTotalQuestions`, `onChange`) et le type `QuizIndexEntry`
  (`path`, `basename`, `title`, `questions`, `items`, `types`, `quizType`,
  `mtime`) sont **inchangés** : la tâche 10 et le tableau de bord en dépendent.

- [ ] **Étape 1 : adapter le jeu de cas d'abord**

Dans `scripts/check-scanner.mjs`, remplacer le faux `app` par un faux `host` :

```js
	const fichierHote = {
		path: "Cours/reseau.md",
		name: "reseau.md",
		basename: "reseau",
		extension: "md",
		mtime: 1,
	};
	let abonne = null;
	const host = {
		fs: {
			listMarkdown: () => [fichierHote],
			readCached: async () => content,
			read: async () => content,
			getFile: (p) => (p === fichierHote.path ? fichierHote : null),
		},
		watcher: {
			/* Le scanner doit RENDRE son désabonnement et l'appeler au
			   destroy : sans ça, un rechargement du greffon laisse un écouteur
			   sur un scanner mort, qui rescanne dans le vide à chaque frappe. */
			onChange: (cb) => { abonne = cb; return () => { abonne = null; }; },
		},
	};
	const scanner = createScanner(host);
```

Remplacer les `scanner.scanFile(file)` par `scanner.scanFile(fichierHote)`.

Ajouter trois cas neufs avant `r.done()` :

```js
	/* RENOMMAGE d'une note INDEXÉE : l'ancienne clé disparaît, la nouvelle
	   entre. Une clé qui survivrait laisserait un quiz fantôme au catalogue. */
	const neuf = { ...fichierHote, path: "Cours/reseau2.md", basename: "reseau2", name: "reseau2.md" };
	await scanner.scanFile(fichierHote);
	abonne({ kind: "rename", file: neuf, oldPath: fichierHote.path });
	await new Promise(r2 => setTimeout(r2, 0));
	r.check("un renommage retire l'ancienne clé", scanner.getQuiz("Cours/reseau.md"), null);

	/* RENOMMAGE vers un .md JAMAIS indexé : le fichier doit quand même être
	   scanné. Le comportement d'origine le faisait ; le perdre rendrait
	   invisible tout quiz créé par un renommage. */
	abonne({ kind: "rename", file: neuf, oldPath: "Autre/pas-indexe.md" });
	await new Promise(r2 => setTimeout(r2, 0));
	r.check("un renommage depuis un chemin inconnu scanne quand même",
		!!scanner.getQuiz("Cours/reseau2.md"), true);

	/* DÉSABONNEMENT : un scanner détruit ne doit plus rien écouter. Seule
	   protection contre le rechargement du greffon, où deux scanners
	   coexistent une fraction de seconde. */
	scanner.destroy();
	r.check("destroy retire l'abonnement au watcher", abonne, null);
```

- [ ] **Étape 2 : lancer et voir échouer**

```bash
npm run check:scanner
```
Attendu : ÉCHEC — `Cannot read properties of undefined (reading 'getMarkdownFiles')`.

- [ ] **Étape 3 : réécrire le scanner sur le contrat**

Dans `src/dashboard/scanner.ts` :

- Supprimer `import { TFile } from "obsidian";` et
  `import type { App, EventRef } from "obsidian";`. Ajouter
  `import type { Host, HostFile } from "../host/types";`.
- `Scanner.scanFile(file: TFile)` → `scanFile(file: HostFile)`.
- `createScanner(app: App)` → `createScanner(host: Host)`.
- `scanVault()` : `app.vault.getMarkdownFiles()` → `host.fs.listMarkdown()` ;
  `app.vault.cachedRead(file)` → `host.fs.readCached(file.path)` ;
  `file.stat?.mtime || 0` → `file.mtime` (le contrat garantit déjà le 0 par
  défaut, la coalescence devient du bruit).
- `scanFile(file)` : mêmes substitutions.
- `vaultEventRefs: EventRef[]` → `let desabonner: (() => void) | null = null;`.
- `setupVaultListeners()` devient `setupWatcher()` : **un seul** abonnement au
  lieu de quatre, aiguillé sur `ev.kind`.

```ts
	/* Un SEUL abonnement, aiguillé sur `ev.kind` : le contrat unifie les
	   quatre évènements d'Obsidian. `rename` reste un évènement DISTINCT de
	   delete+create parce que le journal de révision suit ses clés par
	   renommage — le reconstituer à partir de deux évènements est impossible.
	   Le garde `scanning` remonte ici : il était répété trois fois. */
	function setupWatcher(): void {
		desabonner = host.watcher.onChange(ev => {
			if (scanning) return;
			if (ev.kind === "create" || ev.kind === "modify") {
				if (ev.file.extension === "md") void scanFile(ev.file);
				return;
			}
			if (ev.kind === "delete") {
				if (cache.delete(ev.path)) notifyListeners();
				return;
			}
			/* rename : l'ancienne clé sort du cache, et la nouvelle est
			   rescannée — y compris quand l'ancien chemin n'était PAS indexé,
			   sinon un quiz créé par renommage resterait invisible. */
			const avait = cache.delete(ev.oldPath);
			if (ev.file.extension === "md") void scanFile(ev.file);
			else if (avait) notifyListeners();
		});
	}
```

- `destroy()` : `desabonner?.(); desabonner = null;` remplace la boucle
  `offref`. Le reste (`listeners.length = 0`, `cache.clear()`) est inchangé.
- `init()` : `setupWatcher(); await scanVault();`.
- Le commentaire sur l'autosave d'Obsidian toutes les ~2 s et la comparaison
  `JSON.stringify({ ...prev, mtime: 0 })` reste **strictement inchangé** :
  c'est ce qui empêche un re-render de la barre latérale à chaque frappe.
- Les commentaires sur `idsForRawItems`, sur la conservation des positions du
  tableau brut, et sur `QuizTypeTag` traduit au rendu et non au scan, restent
  inchangés.

- [ ] **Étape 4 : adapter l'appelant**

Dans `apps/obsidian/plugin.ts`, ligne 1069 :

```ts
		/* Le MÊME hôte que celui installé au début d'onload : en construire un
		   second donnerait deux index et deux abonnements au vault. */
		this._scanner = createScanner(currentHost());
```

Ajouter `currentHost` à l'import de `../../src/host/current`.

- [ ] **Étape 5 : vert, cliquet, jeux de cas voisins**

```bash
npm run check:scanner
```
Attendu : tous les cas passent, y compris les trois neufs.

```bash
npm run check && npm run check:host
```
Attendu : `ÉCHEC  src/dashboard/scanner.ts n'importe plus « obsidian » …`.
Retirer l'entrée, relancer.
Attendu : `Frontière d'hôte : 42 fichier(s) …`

```bash
npm run check:review-store && npm run check:engine-review && npm run check:module-edit
npm run report:multiblock
```
`report:multiblock` ne vérifie rien : il MESURE deux limites connues (le scanner
n'indexe que le PREMIER bloc d'une note ; une note quiz `source:` journalise sous
son propre chemin, absent du catalogue). Ses chiffres doivent être **identiques**
à ceux d'avant la tâche — un écart signifierait que le scanner a changé de
comportement, pas seulement d'hôte. Les relever avant, les comparer après.

- [ ] **Étape 6 : ÉPROUVER trois cas**

1. **Le désabonnement** — supprimer `desabonner?.()` de `destroy()`.
   Attendu : `ÉCHEC  destroy retire l'abonnement au watcher`. Restaurer.
2. **L'alignement des identifiants** — dans `parseQuizMeta`, remplacer
   `idsForRawItems(sansConfig)` par `sansConfig.map((q, i) => q?.id ?? "q" + i)`.
   Attendu : `ÉCHEC  identités, rôles et tranches sont retenus dans l'ordre`.
   C'est le cas qui protège l'historique de révision : une clé décalée rend une
   question éternellement neuve, revenant tous les jours sans jamais sortir de
   « À réviser ». Restaurer.
3. **Le renommage depuis un chemin inconnu** — dans l'aiguillage, remplacer la
   dernière branche par `if (avait && ev.file.extension === "md") void scanFile(ev.file);`.
   Attendu : `ÉCHEC  un renommage depuis un chemin inconnu scanne quand même`.
   Restaurer.

- [ ] **Étape 7 : build, Obsidian, commit**

```bash
npm run build
grep -rn 'Ă\|Â\|â€' src/dashboard/scanner.ts scripts/check-scanner.mjs apps/obsidian/plugin.ts
```

**Test manuel dans Obsidian** : ouvrir le tableau de bord — la liste des quiz
est complète et le compte total de questions est celui d'avant. Créer une note
avec un bloc `quiz-blocks` (elle apparaît), la modifier (le compte suit), la
renommer (elle suit son nouveau nom **et** son historique de révision est
conservé — vérifier sur la carte « À réviser »), la supprimer (elle disparaît).
Taper dans une note pendant dix secondes : la barre latérale ne doit **pas**
clignoter.

```bash
git add src/dashboard/scanner.ts apps/obsidian/plugin.ts scripts/check-scanner.mjs scripts/check-host.mjs
git commit -m "$(cat <<'EOF'
refactor(scanner): le catalogue passe par l'hote

Un seul abonnement aiguille sur ev.kind au lieu de quatre ecouteurs vault.
rename reste un evenement DISTINCT de delete+create : le journal de revision
suit ses cles par renommage, et le reconstituer a partir de deux evenements
est impossible.

Le scanner rend son desabonnement et l'appelle au destroy — sans ca, un
rechargement du greffon laisse un ecouteur sur un scanner mort qui rescanne
dans le vide a chaque frappe.

createScanner prend le MEME hote que celui installe par plugin.ts : en
construire un second donnerait deux index et deux abonnements.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 8 — La coquille Tauri

**But :** une fenêtre Neo Quiz qui s'ouvre, mémorise sa taille et sa position,
et affiche une phrase traduite. Elle importe le CSS partagé par chemin relatif :
la preuve, dès la première tâche de l'app, que le monorepo tient sans copier un
fichier.

**Fichiers :**
- Créer : `apps/windows/package.json`, `vite.config.ts`, `tsconfig.json`,
  `index.html`, `.gitignore`
- Créer : `apps/windows/src/main.ts`
- Créer : `apps/windows/src-tauri/{Cargo.toml,build.rs,tauri.conf.json}`
- Créer : `apps/windows/src-tauri/src/{main.rs,lib.rs}`
- Créer : `apps/windows/src-tauri/capabilities/default.json`
- Créer : `apps/windows/src-tauri/icons/` (généré)
- Créer : `src/i18n/en/app.ts`, `src/i18n/fr/app.ts`
- Modifier : `src/i18n/en.ts`, `src/i18n/fr.ts` (un import de plus)
- Modifier : `src/i18n.ts` (le mode `auto` passe par l'hôte)
- Modifier : `package.json` (racine) — scripts `app:dev`, `app:build`
- Modifier : `.gitignore` (racine) — `target/`, `dist/`

**Interfaces :**
- Consomme : `hostOrNull()` (tâche 1) ; `t()` et `setLanguage()` de
  `src/i18n.ts` ; `PRODUCT_NAME` de `src/branding.ts`.
- Produit : `npm run app:dev` ouvre la fenêtre ; `apps/windows/src/main.ts`
  exporte `mount(root: HTMLElement): void`, point d'accroche des tâches 11 et 12.
  Clés i18n du domaine `app` : `app.window.title`, `app.empty.noFolder`,
  `app.empty.pickFolder`, `app.error.startup`.

- [ ] **Étape 1 : le mode `auto` de la langue passe par l'hôte**

Dans `src/i18n.ts`, remplacer `detectObsidianLang()` par :

```ts
/* ── Langue de l'HÔTE ──
   Sous Obsidian, `window.i18next.language` donne la langue CHOISIE DANS
   OBSIDIAN (« fr »), pas celle de l'OS ni du navigateur — c'est la seule
   source correcte pour le mode auto. Ce n'est pas une API publique (absente
   d'obsidian.d.ts), et c'est pourquoi elle est lue par l'HÔTE, qui assume ce
   genre de chose, et exposée ici comme une simple étiquette BCP-47.

   `hostOrNull` et non `currentHost` : ce module peut être sollicité avant
   l'installation de l'hôte (chargement des modules). Les replis —
   `navigator.language` puis `<html lang>` puis l'anglais — couvrent ce cas
   ET la fenêtre de l'app avant son premier rendu. */
function detectHostLang(): Lang {
	try {
		const depuisHote = hostOrNull()?.platform.uiLanguage;
		const lang = depuisHote || navigator.language || document.documentElement.lang || "";
		// « fr », « fr-FR », « fr_FR » → fr ; tout le reste → en (seules deux
		// langues sont traduites, inutile de deviner au-delà).
		return /^fr\b/i.test(lang.replace(/_/g, "-")) ? "fr" : "en";
	} catch (e) {
		return "en";
	}
}
```

et `setLanguage` appelle `detectHostLang()` au lieu de `detectObsidianLang()`.
Ajouter `import { hostOrNull } from "./host/current";`.

`src/i18n.ts` n'importait pas `obsidian` : il ne change donc rien au cliquet.
Mais **il reste appelé AU RENDU** : ne pas mémoïser le résultat.

- [ ] **Étape 2 : le domaine i18n `app`**

Créer `src/i18n/en/app.ts` :

```ts
/* Domaine « app » : ce qui n'existe QUE dans l'application autonome — la
   fenêtre, le choix du dossier, les états vides. Le greffon n'en charge
   aucune clé à l'écran, mais le dictionnaire reste commun : deux
   dictionnaires divergeraient. */
export const EN_APP = {
	"app.window.title": "Neo Quiz",
	"app.empty.noFolder": "No quiz folder yet.",
	"app.empty.pickFolder": "Choose a folder",
	"app.error.startup": "Neo Quiz could not start: {error}",
} as const;
```

Créer `src/i18n/fr/app.ts` :

```ts
import type { EN_APP } from "../en/app";

export const FR_APP: Record<keyof typeof EN_APP, string> = {
	"app.window.title": "Neo Quiz",
	"app.empty.noFolder": "Aucun dossier de quiz pour l'instant.",
	"app.empty.pickFolder": "Choisir un dossier",
	"app.error.startup": "Neo Quiz n'a pas pu démarrer : {error}",
};
```

`app.window.title` vaut `PRODUCT_NAME` dans les deux langues : un nom de
produit ne se traduit pas. La clé existe quand même pour que le titre soit posé
AU RENDU comme tout le reste, et pour que la phrase qui le cite puisse être
traduite plus tard sans changer d'endroit.

Ajouter l'import et l'étalement dans `src/i18n/en.ts` et `src/i18n/fr.ts`.

- [ ] **Étape 3 : le paquet de l'app**

Créer `apps/windows/package.json` :

```json
{
  "name": "@neo-quiz/windows",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 1421",
    "build": "tsc --noEmit && vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.11.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.11.4",
    "typescript": "^7.0.2",
    "vite": "^8.2.0"
  }
}
```

Le port 1421 et non 1420 : Neo Calendar occupe 1420 sur cette machine, et deux
apps en développement en même temps est le cas normal.

Créer `apps/windows/.gitignore` :

```
dist/
node_modules/
src-tauri/target/
src-tauri/gen/
```

- [ ] **Étape 4 : la configuration Vite**

Créer `apps/windows/vite.config.ts` :

```ts
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

/*
 * L'app importe le code partagé par CHEMIN RELATIF (../../../src/…), sans
 * alias, sans symlink, sans copie. C'est la décision D2 du plan : Neo Calendar
 * a 132 fichiers de même nom entre ses deux dépôts, dont 83 ont divergé. Une
 * mécanique qui rend la copie possible finit par en produire une ; un chemin
 * relatif ne peut pas diverger, il n'y a qu'un fichier au bout.
 *
 * `server.fs.allow` est la contrepartie obligatoire : par défaut Vite refuse
 * de SERVIR un fichier hors de son propre dossier, et sans cette ligne le
 * serveur de développement renverrait 403 sur chaque import de `src/`.
 * Le build de production, lui, n'en a pas besoin — d'où un échec qui
 * n'apparaît qu'en `dev`.
 */
const racineDepot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
	clearScreen: false,
	server: {
		port: 1421,
		strictPort: true,
		fs: { allow: [racineDepot] },
		watch: { ignored: ["**/src-tauri/**"] },
	},
	envPrefix: ["VITE_", "TAURI_"],
	build: {
		target: "es2021",
		outDir: "dist",
		sourcemap: true,
	},
});
```

- [ ] **Étape 5 : le typecheck de l'app**

Créer `apps/windows/tsconfig.json` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "vite.config.ts", "../../src/**/*.d.ts"]
}
```

**Aucun `paths`** : `tsc` suit les imports relatifs tout seul, et une
déclaration d'alias serait une seconde source à tenir synchrone avec Vite.
`../../src/**/*.d.ts` est inclus explicitement parce que `src/global.d.ts`
augmente `HTMLElement` (`__quizDestroy`, `__quizTargetX`…) et n'est importé par
personne : sans cette ligne, le moteur ne compilerait pas côté app.

- [ ] **Étape 6 : la page hôte et le démarrage**

Créer `apps/windows/index.html` :

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Neo Quiz</title>
	</head>
	<body>
		<div id="neo-quiz-root" class="qbd-root"></div>
		<script type="module" src="/src/main.ts"></script>
	</body>
</html>
```

`class="qbd-root"` : les tokens de verre du projet (`--qbd-glass-*`) sont
définis sur `.qbd-root` et sur `.qbd-select-menu`. Sans cette classe, ils
résoudraient au vide et toutes les surfaces seraient transparentes.

Créer `apps/windows/src/main.ts` :

```ts
import "../../../src/assets/css/index.css";
import "./theme/host-vars.css";
import { setLanguage, t } from "../../../src/i18n";
import { PRODUCT_NAME } from "../../../src/branding";

/*
 * Démarrage de l'application. Il n'installe PAS encore d'hôte : le mode
 * « auto » de la langue retombe sur `navigator.language` tant qu'aucun hôte
 * n'est là (src/i18n.ts, detectHostLang), ce qui suffit pour cette tâche.
 * L'hôte Windows arrive à la tâche 10.
 *
 * L'ordre des deux imports CSS compte : `host-vars.css` définit les variables
 * qu'Obsidian fournissait, il doit donc venir APRÈS l'arbre partagé pour que
 * ses valeurs gagnent à égalité de spécificité.
 */
export function mount(root: HTMLElement): void {
	root.textContent = "";
	/* `document.createElement`, jamais les extensions DOM d'Obsidian
	   (`createEl`, `createDiv`, `empty`) : elles n'existent pas dans la
	   fenêtre de l'app. La mesure a montré que le moteur n'en utilise
	   qu'une seule, `container.empty()` (src/engine.ts:68) — remplacée par
	   `container.replaceChildren()` dans cette tâche. */
	const titre = root.appendChild(document.createElement("h1"));
	// PRODUCT_NAME et non une chaîne : le nom vit à un seul endroit.
	titre.textContent = PRODUCT_NAME;
	const vide = root.appendChild(document.createElement("p"));
	// t() AU RENDU, jamais dans une constante de module.
	vide.textContent = t("app.empty.noFolder");
}

function demarrer(): void {
	const root = document.getElementById("neo-quiz-root");
	if (!root) throw new Error("#neo-quiz-root introuvable");
	// « auto » : la langue de l'hôte, sinon celle du navigateur.
	setLanguage("auto");
	document.title = t("app.window.title");
	try {
		mount(root);
	} catch (e) {
		root.textContent = t("app.error.startup", { error: e instanceof Error ? e.message : String(e) });
	}
}

demarrer();
```

Remplacer aussi `container.empty()` par `container.replaceChildren()` dans
`src/engine.ts:68` : c'est le SEUL appel à une extension DOM d'Obsidian dans
tout le moteur (mesuré le 2026-09-04). `empty()` n'existe pas hors d'Obsidian,
et le moteur planterait à sa première ligne dans l'app. Une ligne, et
`npm run check` confirme qu'il n'y en a pas d'autre.

- [ ] **Étape 7 : le projet Rust**

Créer `apps/windows/src-tauri/Cargo.toml` :

```toml
[package]
name = "neo-quiz-windows"
version = "0.0.0"
edition = "2021"

[lib]
name = "neo_quiz_windows_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[[bin]]
name = "neo-quiz"
path = "src/main.rs"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = [] }
```

Créer `apps/windows/src-tauri/build.rs` :

```rust
fn main() {
    tauri_build::build();
}
```

Créer `apps/windows/src-tauri/src/main.rs` :

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    neo_quiz_windows_lib::run();
}
```

Créer `apps/windows/src-tauri/src/lib.rs` :

```rust
/// Point d'entrée de l'application.
///
/// Volontairement vide pour l'instant : la tranche 1 fait tout depuis le
/// frontend. Les seules commandes natives prévues (extension des portées de
/// fichiers, tache 10) arrivent quand un dossier peut être choisi.
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
```

Créer `apps/windows/src-tauri/capabilities/default.json` :

```json
{
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "main-capability",
    "description": "Fenêtre principale de Neo Quiz",
    "windows": ["main"],
    "permissions": ["core:default"]
}
```

Créer `apps/windows/src-tauri/tauri.conf.json` :

```json
{
    "$schema": "https://schema.tauri.app/config/2",
    "productName": "Neo Quiz",
    "version": "0.0.0",
    "identifier": "com.ahmed.neoquiz",
    "build": {
        "beforeDevCommand": "npm run dev",
        "devUrl": "http://localhost:1421",
        "beforeBuildCommand": "npm run build",
        "frontendDist": "../dist"
    },
    "app": {
        "windows": [
            {
                "label": "main",
                "title": "Neo Quiz",
                "width": 1280,
                "height": 840,
                "minWidth": 900,
                "minHeight": 600
            }
        ],
        "security": { "csp": null }
    },
    "bundle": {
        "active": true,
        "targets": ["nsis"],
        "publisher": "Ahmed",
        "icon": [
            "icons/32x32.png",
            "icons/128x128.png",
            "icons/128x128@2x.png",
            "icons/icon.ico"
        ]
    }
}
```

`identifier` est **définitif** : il nomme le dossier de données de
l'application sous `%APPDATA%`, où vivront les réglages. Le changer plus tard
perdrait le dossier choisi par l'utilisateur — même nature de piège que
`PLUGIN_ID`.

Générer les icônes :
```bash
cd apps/windows && npx @tauri-apps/cli@^2 icon <chemin-vers-un-png-1024>
```
S'il n'existe pas encore de logo Neo Quiz, utiliser un carré uni provisoire et
noter la dette dans le commit. Lucide fournit `graduation-cap`, l'icône déjà
utilisée par le ruban du greffon.

- [ ] **Étape 8 : la mémoire de la fenêtre**

Tauri 2 fournit `@tauri-apps/plugin-window-state` pour la taille et la position.
L'ajouter :

```bash
cd apps/windows && npm i @tauri-apps/plugin-window-state
cd src-tauri && cargo add tauri-plugin-window-state
```

Puis, dans `lib.rs` :

```rust
        .plugin(tauri_plugin_window_state::Builder::default().build())
```
avant `.run(...)`, et `"window-state:default"` dans les `permissions` de
`capabilities/default.json`.

Écrire soi-même la mémorisation (lire la taille, la stocker, la réappliquer)
serait le contraire de l'échelle anti-surcodage : une dépendance officielle du
même écosystème le fait déjà.

- [ ] **Étape 9 : brancher depuis la racine**

Ajouter à `package.json` (racine) :

```json
"app:dev": "npm --prefix apps/windows run tauri -- dev",
"app:build": "npm --prefix apps/windows run tauri -- build",
"check:app": "npm --prefix apps/windows run build",
```

Ajouter à `.gitignore` (racine) si absent :
```
apps/windows/dist/
apps/windows/node_modules/
apps/windows/src-tauri/target/
apps/windows/src-tauri/gen/
```

- [ ] **Étape 10 : installer et lancer**

```bash
npm --prefix apps/windows install
npm run app:dev
```

Attendu : la première compilation Rust prend plusieurs minutes, puis une fenêtre
Neo Quiz s'ouvre, titre « Neo Quiz », affichant « Aucun dossier de quiz pour
l'instant. » en français (si Windows est en français). Le fond est encore
transparent ou blanc : le thème est la tâche 9.

Redimensionner la fenêtre, la déplacer, la fermer, relancer : elle doit revenir
à sa taille et à sa position.

- [ ] **Étape 11 : ÉPROUVER trois cas**

1. **`server.fs.allow`** — le retirer de `vite.config.ts`, relancer
   `npm run app:dev`.
   Attendu : la console du navigateur montre un 403 sur
   `/@fs/…/src/assets/css/index.css` et la page reste nue. C'est l'échec qui
   n'apparaît **qu'en développement** — le build de production, lui, passerait.
   Restaurer.
2. **La langue** — dans `src/i18n.ts`, faire renvoyer `"en"` par
   `detectHostLang`. Recharger la fenêtre.
   Attendu : « No quiz folder yet. ». Restaurer → la phrase française revient.
   Puis vérifier dans **Obsidian** que la langue suit toujours celle
   d'Obsidian et non celle de Windows : basculer Obsidian en anglais, le
   tableau de bord passe en anglais. C'est le cas qui prouve que le repli
   `navigator.language` n'a pas écrasé la source correcte.
3. **`t()` figé** — sortir `t("app.empty.noFolder")` de `mount` et en faire une
   constante de module. Recharger avec la langue changée.
   Attendu : la phrase reste dans l'ancienne langue. C'est le piège documenté
   par `CLAUDE.md` ; restaurer.

- [ ] **Étape 12 : le greffon n'a pas bougé**

```bash
npm run check && npm run check:host && npm run check:obsidian-host && npm run build
grep -rn 'Ă\|Â\|â€' apps/windows/src src/i18n src/i18n.ts
```
Attendu : tout vert, `Frontière d'hôte : 42 fichier(s) …` (inchangé),
`grep` sans résultat.

**Test manuel dans Obsidian** : le tableau de bord s'ouvre, la langue est
correcte, un quiz se joue.

- [ ] **Étape 13 : commit**

```bash
git add apps/windows src/i18n src/i18n.ts src/engine.ts package.json .gitignore
git commit -m "$(cat <<'EOF'
feat(app): la coquille Tauri, une fenetre qui s'ouvre

L'app importe le code partage par chemin relatif, sans alias ni copie. La
contrepartie obligatoire est server.fs.allow : sans lui Vite renvoie 403 sur
chaque import de src/, et l'echec n'apparait QU'EN developpement.

Le mode « auto » de la langue passe par host.platform.uiLanguage : sous
Obsidian c'est la langue d'Obsidian, dans l'app celle du systeme. Le repli
navigator.language ne doit jamais ecraser la premiere.

L'identifiant com.ahmed.neoquiz est definitif : il nomme le dossier de
donnees sous %APPDATA%, ou vivront les reglages.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 9 — Le thème

**But :** l'app définit elle-même les variables CSS qu'Obsidian fournissait
gratuitement, et un contrôle mécanique garantit qu'il n'en manque **aucune**.
Une variable oubliée ne casse rien : elle rend un texte invisible sur un fond de
la même couleur. C'est précisément le genre de défaut qu'on ne trouve qu'en
plissant les yeux sur un écran sombre.

**Fichiers :**
- Créer : `apps/windows/src/theme/host-vars.css`
- Créer : `scripts/check-theme.mjs`
- Modifier : `package.json` (script `check:theme`)

**Interfaces :**
- Consomme : `src/assets/css/**` (l'arbre partagé, inchangé).
- Produit : rien de programmatique. `npm run check:theme` doit passer et le
  reste du plan l'ajoute à ses commandes de vérification.

- [ ] **Étape 1 : écrire l'extracteur, et le lancer AVANT d'écrire le thème**

Créer `scripts/check-theme.mjs` :

```js
/**
 * EXHAUSTIVITÉ DU THÈME de l'application.
 *
 * Le greffon hérite des variables CSS d'Obsidian (--background-primary,
 * --text-normal…) ; l'app doit les définir elle-même. Une variable oubliée ne
 * produit AUCUNE erreur : elle rend un texte invisible sur un fond de la même
 * couleur, ou fait disparaître une bordure. On ne le voit qu'en plissant les
 * yeux sur un écran sombre — donc on le mesure.
 *
 * Le contrôle est symétrique, comme le cliquet de check-host : une variable
 * définie dans le thème mais plus référencée nulle part doit être retirée,
 * sinon le fichier accumule du mort qu'on n'ose plus toucher.
 *
 *     npm run check:theme
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep, posix } from "node:path";

const THEME = "apps/windows/src/theme/host-vars.css";

/** Les `.ts` de `src/`, pour y trouver les variables posées à l'exécution. */
function fichiersTs(racine) {
	const trouves = [];
	for (const nom of readdirSync(racine)) {
		const chemin = join(racine, nom);
		if (statSync(chemin).isDirectory()) trouves.push(...fichiersTs(chemin));
		else if (nom.endsWith(".ts")) trouves.push(chemin.split(sep).join(posix.sep));
	}
	return trouves;
}

function fichiersCss(racine) {
	const trouves = [];
	for (const nom of readdirSync(racine)) {
		const chemin = join(racine, nom);
		if (statSync(chemin).isDirectory()) trouves.push(...fichiersCss(chemin));
		else if (nom.endsWith(".css")) trouves.push(chemin.split(sep).join(posix.sep));
	}
	return trouves;
}

const referencees = new Set();
const definies = new Set();
for (const f of fichiersCss("src/assets/css")) {
	const css = readFileSync(f, "utf8");
	for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) referencees.add(m[1]);
	for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) definies.add(m[1]);
}

/* TROIS catégories, pas deux. Une variable référencée sans être définie dans
   l'arbre CSS n'est pas forcément héritée d'Obsidian : certaines sont posées
   À L'EXÉCUTION par le JavaScript, sur un élément précis
   (`el.style.setProperty("--mod-color", …)`). Exiger du thème qu'il les
   définisse serait FAUX — leur valeur est propre à chaque élément, et une
   valeur globale les figerait toutes à la même.
   Mesuré le 2026-09-04 : six sont dans ce cas (`--mod-color`, `--qbd-p`,
   `--qbd-drift`, `--qbd-card-delay`, `--qbd-donut-mastered-end`,
   `--qbd-donut-review-end`). On les détecte, on ne les code pas en dur : une
   septième apparaîtra un jour. */
const posesParJs = new Set();
for (const f of fichiersTs("src")) {
	for (const m of readFileSync(f, "utf8").matchAll(/setProperty\(\s*["'`](--[a-z0-9-]+)/gi)) {
		posesParJs.add(m[1]);
	}
}

/* Ce qu'Obsidian fournissait : référencé par l'arbre partagé, défini nulle
   part dedans, et pas posé par le JS. Une variable AVEC valeur de repli
   compte quand même — un repli est un dernier recours, pas une couleur
   choisie. */
const attendues = [...referencees]
	.filter(v => !definies.has(v) && !posesParJs.has(v))
	.sort();

const theme = readFileSync(THEME, "utf8");
const fournies = new Set([...theme.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map(m => m[1]));

const manquantes = attendues.filter(v => !fournies.has(v));
const inutiles = [...fournies].filter(v => !attendues.includes(v)).sort();

let echecs = 0;
if (manquantes.length) {
	console.error("ÉCHEC  variables héritées d'Obsidian non définies par le thème de l'app :");
	for (const v of manquantes) console.error("       " + v);
	echecs++;
}
if (inutiles.length) {
	console.error("ÉCHEC  variables définies par le thème mais référencées nulle part :");
	for (const v of inutiles) console.error("       " + v);
	echecs++;
}

if (echecs) {
	// exitCode, jamais exit() — cohérent avec les autres scripts du dépôt.
	process.exitCode = 1;
} else {
	console.log(`Thème de l'app : ${attendues.length}/${attendues.length} variables héritées définies.`);
}
```

Ajouter à `package.json` :
```json
"check:theme": "node scripts/check-theme.mjs",
```

Lancer une première fois — le fichier de thème n'existe pas encore, donc créer
un `apps/windows/src/theme/host-vars.css` vide puis :

```bash
npm run check:theme
```
Attendu : la liste EXACTE des variables à définir — **34** d'après la mesure
du contrôleur le 2026-09-04 (40 référencées non définies, moins les 6 posées par
le JS) : `--background-primary`, `--background-primary-alt`,
`--background-secondary`, `--background-modifier-border`,
`--background-modifier-border-hover`, `--background-modifier-form-field`,
`--background-modifier-form-field-hover`, `--background-modifier-hover`,
`--background-modifier-success-rgb`, `--text-normal`, `--text-muted`,
`--text-faint`, `--text-accent`, `--text-error`, `--text-success`,
`--text-warning`, `--text-on-accent`, `--interactive-accent`,
`--interactive-accent-hover`, `--interactive-accent-rgb`,
`--interactive-normal`, `--code-background`, `--code-border`, `--color-green`,
`--color-orange`, `--color-red`, `--color-yellow`, `--font-interface`,
`--font-monospace`, `--scrollbar-thumb-bg`, `--icon-bg`, `--accent`).
**Prendre la liste que le script imprime, pas celle-ci** : c'est le script qui
mesure le dépôt tel qu'il est le jour de l'exécution.

- [ ] **Étape 2 : relever les VRAIES valeurs dans Obsidian**

Ne pas inventer les couleurs : les lire sur le thème qu'Ahmed utilise
réellement. Dans Obsidian, ouvrir la console de développement
(Ctrl+Shift+I) et exécuter :

```js
copy(["--background-primary","--background-primary-alt","--background-secondary",
"--background-modifier-border","--background-modifier-border-hover",
"--background-modifier-form-field","--background-modifier-form-field-hover",
"--background-modifier-hover","--background-modifier-success-rgb",
"--text-normal","--text-muted","--text-faint","--text-accent","--text-error",
"--text-success","--text-warning","--text-on-accent","--interactive-accent",
"--interactive-accent-hover","--interactive-accent-rgb","--interactive-normal",
"--code-background","--code-border","--color-green","--color-orange",
"--color-red","--color-yellow","--font-interface","--font-monospace",
"--scrollbar-thumb-bg","--icon-bg","--accent"]
  .map(v => "\t" + v + ": " + getComputedStyle(document.body).getPropertyValue(v).trim() + ";")
  .join("\n"))
```

La liste passée à ce `copy()` doit être **celle imprimée par le script**, pas
celle recopiée ci-dessus. Le résultat est dans le presse-papier.

Une variable qui revient vide n'est pas fournie par le thème d'Obsidian mais
par un extrait CSS ou par le thème communautaire : lui donner une valeur
choisie et le **noter en commentaire**, plutôt que de laisser une chaîne vide,
qui se comporte comme une variable absente.

- [ ] **Étape 3 : écrire le thème**

Créer `apps/windows/src/theme/host-vars.css` :

```css
/* =========================================================
   LES VARIABLES QU'OBSIDIAN FOURNISSAIT

   Le greffon hérite du thème d'Obsidian ; l'application n'a personne au-dessus
   d'elle. Ces valeurs sont RELEVÉES sur le thème sombre qu'Ahmed utilise
   réellement (console d'Obsidian, getComputedStyle), pas inventées : le
   contrat visuel du 2026-07-28 continue de s'appliquer, et deux jeux de
   couleurs qui divergent donneraient deux produits.

   La première version n'a que le thème SOMBRE (spec §8) : le greffon suit le
   thème d'Obsidian, l'app n'en propose qu'un.

   `npm run check:theme` interdit d'en oublier une ET d'en garder une qui ne
   sert plus. Une variable manquante ne casse rien : elle rend un texte
   invisible sur un fond de la même couleur.
   ========================================================= */

:root {
	--background-primary: #1e1e2e;
	/* … la liste complète, dans l'ordre imprimé par check:theme … */
}
```

Les valeurs `*-rgb` (`--interactive-accent-rgb`,
`--background-modifier-success-rgb`) sont des **triplets sans `rgb()`**
(`137, 180, 250`) : elles servent dans des `rgba(var(--x), .2)`. Copier la
forme exacte relevée, pas une couleur hexadécimale.

- [ ] **Étape 4 : vert, puis ÉPROUVER trois cas**

```bash
npm run check:theme
```
Attendu : `Thème de l'app : 33/33 variables héritées définies.`

1. **Une variable manquante** — commenter `--text-normal` dans le thème.
   Attendu : `ÉCHEC  variables héritées … --text-normal`. Restaurer.
   Puis, sans le script : relancer l'app et regarder — le texte devient noir sur
   fond sombre, illisible, **sans aucune erreur en console**. C'est exactement
   le défaut que ce contrôle existe pour attraper.
2. **Une variable morte** — ajouter `--inexistante: red;` au thème.
   Attendu : `ÉCHEC  variables définies par le thème mais référencées nulle
   part … --inexistante`. Restaurer.
3. **Une nouvelle référence dans le CSS partagé** — ajouter
   `color: var(--tout-nouveau);` à `src/assets/css/base.css`.
   Attendu : `ÉCHEC  … --tout-nouveau`. C'est le cas qui garde l'avenir : une
   variable ajoutée au CSS partagé par une tranche ultérieure ne pourra pas
   passer inaperçue. Restaurer.

- [ ] **Étape 5 : voir le résultat**

```bash
npm run app:dev
```
Attendu : la fenêtre a le fond sombre du tableau de bord d'Obsidian, le texte
est lisible, la police d'interface est la bonne.

Comparer côte à côte avec le tableau de bord ouvert dans Obsidian : les deux
fonds doivent être identiques à l'œil. Un écart signifie que la valeur a été
relevée sur le mauvais thème.

- [ ] **Étape 6 : vérifier et commiter**

```bash
npm run check && npm run check:host && npm run check:theme && npm run check:app && npm run build
grep -rn 'Ă\|Â\|â€' apps/windows/src/theme scripts/check-theme.mjs
```

```bash
git add apps/windows/src/theme scripts/check-theme.mjs package.json
git commit -m "$(cat <<'EOF'
feat(app): definir les variables CSS qu'Obsidian fournissait

Les valeurs sont RELEVEES sur le theme sombre reellement utilise, pas
inventees : deux jeux de couleurs qui divergent donneraient deux produits.

check:theme est symetrique comme le cliquet de check:host — il refuse une
variable oubliee ET une variable devenue morte. Une variable oubliee ne
casse rien : elle rend un texte invisible sur un fond de la meme couleur,
sans aucune erreur en console.

Premiere version : theme sombre seulement (spec §8).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 10 — L'hôte Windows

**But :** l'implémentation Tauri du contrat. Un dossier choisi au sélecteur
natif, persisté, indexé en mémoire, surveillé. C'est la tâche qui rend possibles
les deux dernières.

**Fichiers :**
- Créer : `apps/windows/src/host/index.ts` (assemble le `Host`)
- Créer : `apps/windows/src/host/fs.ts` (index, lecture, écriture, watcher)
- Créer : `apps/windows/src/host/links.ts` (wikilinks, URL de ressource)
- Créer : `apps/windows/src/host/ui.ts` (toasts, icônes Lucide)
- Créer : `apps/windows/src/host/math.ts` (LaTeX via MathLive)
- Créer : `apps/windows/src/host/folder.ts` (choix et persistance du dossier)
- Créer : `apps/windows/src/assets/toast.css`
- Créer : `scripts/check-windows-host.mjs`
- Modifier : `apps/windows/src-tauri/src/lib.rs` (commande `allow_folder`)
- Modifier : `apps/windows/src-tauri/Cargo.toml`, `capabilities/default.json`
- Modifier : `apps/windows/package.json` (plugins fs, dialog, store, opener)
- Modifier : `apps/windows/src/main.ts` (installe l'hôte)
- Modifier : `package.json` (script `check:windows-host`)

**Interfaces :**
- Consomme : `Host` et ses huit sous-contrats (tâche 1) ; `installHost`
  (tâche 1) ; `t()` du domaine `app`.
- Produit :
  `createWindowsHost(racine: string, index: WindowsIndex): Host` — exporté par
  `apps/windows/src/host/index.ts`.
  `createWindowsIndex(racine: string): Promise<WindowsIndex>` — exporté par
  `apps/windows/src/host/fs.ts`, avec
  `WindowsIndex = { all(): HostFile[]; get(path: string): HostFile | null; apply(ev: HostFileEvent): void }`.
  `pickFolder(): Promise<string | null>`, `savedFolder(): Promise<string | null>`,
  `saveFolder(chemin: string): Promise<void>` — depuis `folder.ts`.
  Consommés par les tâches 11 et 12.

- [ ] **Étape 1 : les dépendances**

```bash
cd apps/windows
npm i @tauri-apps/plugin-fs @tauri-apps/plugin-dialog @tauri-apps/plugin-store @tauri-apps/plugin-opener lucide
cd src-tauri
cargo add tauri-plugin-fs tauri-plugin-dialog tauri-plugin-store tauri-plugin-opener
```

`lucide` (et non `lucide-react` : l'app n'a pas React) fournit les icônes en
données SVG. C'est la même bibliothèque que celle derrière `setIcon` d'Obsidian,
donc la même silhouette dans les deux hôtes.

MathLive est déjà une dépendance de la racine : ne pas la réinstaller ici, elle
se résout en remontant.

- [ ] **Étape 2 : la commande Rust qui ouvre les portées**

Un dossier choisi au sélecteur n'est **pas** automatiquement lisible : Tauri 2
tient deux portées distinctes, celle du greffon `fs` et celle du protocole
`asset` (qui sert les images). Les deux s'étendent à l'exécution, depuis Rust.
C'est le seul code natif de la tranche.

Dans `apps/windows/src-tauri/src/lib.rs` :

```rust
use tauri::Manager;
use tauri_plugin_fs::FsExt;

/// Autorise l'application à lire un dossier choisi par l'utilisateur.
///
/// Tauri tient DEUX portées séparées, et il faut les ouvrir toutes les deux :
/// celle du greffon `fs` (lecture et écriture des notes) et celle du protocole
/// `asset` (les images des quiz, servies par convertFileSrc). N'en ouvrir
/// qu'une donne une application qui lit les notes mais n'affiche aucune image,
/// sans le moindre message d'erreur.
///
/// Les portées ne survivent pas au redémarrage : le frontend rappelle cette
/// commande à chaque lancement, avec le dossier qu'il a persisté.
#[tauri::command]
fn allow_folder(app: tauri::AppHandle, chemin: String) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(&chemin, true)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&chemin, true)
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![allow_folder])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
```

Dans `capabilities/default.json`, ajouter aux `permissions` :
`"fs:default"`, `"dialog:allow-open"`, `"store:default"`, `"opener:default"`,
et l'activation du protocole d'asset dans `tauri.conf.json` :

```json
        "security": {
            "csp": null,
            "assetProtocol": { "enable": true, "scope": [] }
        }
```

La portée est **vide** à la compilation : elle est remplie à l'exécution par
`allow_folder`. Y écrire un chemin en dur figerait l'application sur un seul
dossier.

- [ ] **Étape 3 : écrire le jeu de cas d'abord**

Créer `scripts/check-windows-host.mjs`. Il ne peut pas lancer Tauri ; il éprouve
ce qui est éprouvable hors de la fenêtre — l'**index**, qui est du code pur, et
la conversion des évènements. Le reste (dialogues, protocole d'asset) se vérifie
dans l'app à l'étape 8.

```js
/**
 * Vérification de l'INDEX de l'hôte Windows.
 *
 * L'index est la seule pièce de l'hôte Windows qui soit du code pur : c'est
 * lui qui rend `listMarkdown`, `findByName` et `getFile` synchrones, donc lui
 * qui doit rester juste après un renommage ou une suppression. Un index qui
 * dérive ne produit pas d'erreur : il fait disparaître des quiz du catalogue.
 *
 * Le reste de l'hôte (sélecteur, protocole d'asset) n'existe que dans la
 * fenêtre : il se vérifie à la main, et la tâche dit comment.
 *
 *     npm run check:windows-host
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const f = (path, extension, mtime = 1) => ({
	path,
	name: path.split("/").pop(),
	basename: path.split("/").pop().replace(/\.[^.]+$/, ""),
	extension,
	mtime,
});

await withSrcModule("apps/windows/src/host/fs.ts", async ({ buildIndex }) => {
	const r = makeReporter("Hôte Windows — index");
	const idx = buildIndex([
		f("Cours/reseau.md", "md"),
		f("Cours/Images/schema.png", "png"),
		f("Autre/schema.png", "png"),
		f("notes.txt", "txt"),
	]);

	r.check("listMarkdown ne rend que les .md",
		idx.all().filter(x => x.extension === "md").map(x => x.path), ["Cours/reseau.md"]);
	r.check("get par chemin", idx.get("Autre/schema.png")?.name, "schema.png");
	r.check("get d'un chemin inconnu rend null", idx.get("absent.md"), null);

	/* Un renommage doit RETIRER l'ancien chemin. Le garder laisserait un quiz
	   fantôme au catalogue, que plus aucun fichier ne peut mettre à jour. */
	idx.apply({ kind: "rename", file: f("Cours/reseau2.md", "md"), oldPath: "Cours/reseau.md" });
	r.check("un renommage retire l'ancien chemin", idx.get("Cours/reseau.md"), null);
	r.check("un renommage ajoute le nouveau", idx.get("Cours/reseau2.md")?.basename, "reseau2");

	idx.apply({ kind: "delete", path: "notes.txt" });
	r.check("une suppression retire l'entrée", idx.get("notes.txt"), null);

	idx.apply({ kind: "create", file: f("Cours/ch2.md", "md") });
	idx.apply({ kind: "modify", file: f("Cours/ch2.md", "md", 99) });
	r.check("une modification met la date à jour sans dupliquer",
		idx.all().filter(x => x.path === "Cours/ch2.md").map(x => x.mtime), [99]);

	r.done();
});

await withSrcModule("apps/windows/src/host/links.ts", async ({ resolveDansIndex }) => {
	const r = makeReporter("Hôte Windows — liens");
	const fichiers = [
		f("Cours/reseau.md", "md"),
		f("Cours/Images/schema.png", "png"),
		f("Autre/schema.png", "png"),
	];

	/* Un wikilink se résout d'abord comme un CHEMIN exact, puis par NOM.
	   Obsidian fait la même chose via son index de liens ; l'inverser ferait
	   gagner un homonyme lointain contre le fichier explicitement désigné. */
	r.check("un chemin exact gagne",
		resolveDansIndex(fichiers, "Autre/schema.png", "Cours/reseau.md")?.path, "Autre/schema.png");
	r.check("un chemin sans extension se complète",
		resolveDansIndex(fichiers, "Cours/reseau", "x.md")?.path, "Cours/reseau.md");
	/* À défaut de chemin, le nom seul — et le PLUS PROCHE de la note qui cite
	   le lien gagne, parce que c'est l'image du chapitre, pas son homonyme
	   d'un autre cours. */
	r.check("un nom seul prend le plus proche de la note citante",
		resolveDansIndex(fichiers, "schema.png", "Cours/reseau.md")?.path, "Cours/Images/schema.png");
	r.check("un lien introuvable rend null",
		resolveDansIndex(fichiers, "rien.png", "Cours/reseau.md"), null);
	r.check("un lien vide rend null", resolveDansIndex(fichiers, "  ", "x.md"), null);

	r.done();
});
```

Ajouter à `package.json` :
```json
"check:windows-host": "node scripts/check-windows-host.mjs",
```

- [ ] **Étape 4 : lancer et voir échouer**

```bash
npm run check:windows-host
```
Attendu : ÉCHEC — `Could not resolve "apps/windows/src/host/fs.ts"`.

- [ ] **Étape 5 : écrire l'index et le système de fichiers**

Créer `apps/windows/src/host/fs.ts`. Points imposés :

- `export function buildIndex(fichiers: HostFile[]): WindowsIndex` — **pur**,
  sans aucun import Tauri, sinon le jeu de cas ne pourrait pas le charger.
  Une `Map<string, HostFile>` interne ; `apply(ev)` aiguille sur `ev.kind`.
- `export async function createWindowsIndex(racine: string): Promise<WindowsIndex>` :
  parcourt la racine avec `readDir` de `@tauri-apps/plugin-fs`
  (`{ baseDir }` non utilisé — chemin absolu), en profondeur, en **excluant**
  les dossiers cachés (`.obsidian`, `.git`, `.neo-quiz`, `node_modules`). Un
  commentaire doit dire pourquoi : indexer `.git` fait grimper un dossier de
  cours à des dizaines de milliers d'entrées pour rien.
- `export function createWindowsFs(racine: string, index: WindowsIndex): HostFs`.
  Chaque chemin du contrat est **relatif à la racine** : la conversion
  relatif ↔ absolu vit ici et nulle part ailleurs. Un commentaire doit dire que
  laisser fuir un chemin absolu casserait les clés du journal de révision, qui
  doivent être identiques sous les trois hôtes.
- `readCached` : pas de cache réel — renvoyer `read`. Le documenter plutôt que
  d'inventer un cache dont personne n'a mesuré le besoin.
- `mkdirs` : `mkdir(chemin, { recursive: true })` de plugin-fs.
- `findByName` : filtre l'index sur `name` en minuscules — **tous** les
  homonymes.
- `export function createWindowsWatcher(racine, index): HostWatcher` : un
  `watchImmediate` de plugin-fs, en récursif, qui met l'index à jour **avant**
  de prévenir les abonnés. L'ordre compte : un abonné qui interroge l'index
  pendant sa notification doit y voir le changement.
  plugin-fs ne distingue pas toujours un renommage : quand il ne rend qu'un
  `remove` suivi d'un `create`, les émettre tels quels. Le noter en commentaire
  comme une **limite mesurée**, pas un oubli — le journal de révision perdra la
  clé dans ce cas, et c'est la tranche 2 qui décidera quoi en faire.

- [ ] **Étape 6 : écrire les liens, l'interface, les mathématiques**

`apps/windows/src/host/links.ts` :
- `export function resolveDansIndex(fichiers: HostFile[], linkPath: string, fromPath: string): HostFile | null`
  — **pure**, testable, l'ordre exact du jeu de cas : chemin exact, chemin sans
  extension (`.md` puis les extensions d'image), puis nom seul avec la
  proximité au `fromPath` comme départage (nombre de segments de préfixe
  communs, décroissant).
- `export function createWindowsLinks(racine, index): HostLinks` :
  `resolve` délègue à `resolveDansIndex(index.all(), …)` ; `resourceUrl`
  appelle `convertFileSrc` de `@tauri-apps/api/core` sur le chemin absolu et
  rend **`null`** si le fichier n'est pas dans l'index — jamais `""`.

`apps/windows/src/host/ui.ts` :
- `notice(message, timeoutMs = 4000)` : une pile de toasts dans un conteneur
  `<div class="nq-toasts">` ajouté au `<body>`, `textContent` (jamais
  `innerHTML` : le message peut venir d'un quiz partagé), retrait par
  `setTimeout`. Styles dans `apps/windows/src/assets/toast.css`, en variables du
  thème — pas de couleur en dur.
- `setIcon(el, name)` : `import { icons } from "lucide"` puis construction du
  SVG. **Jamais d'emoji.** Un nom inconnu vide l'élément et écrit un
  `console.warn` : silencieusement ne rien faire cacherait une icône manquante.

`apps/windows/src/host/math.ts` :
- `ready()` : résout immédiatement (MathLive est déjà chargé), mais pose
  `MathfieldElement.fontsDirectory = null` **une fois** — les fontes viennent
  du CSS partagé, déjà inlinées ; sans ça MathLive va les chercher sur un
  chemin qui n'existe pas et rend des glyphes de substitution.
- `render(latex, display)` : `convertLatexToMarkup` de `mathlive`, injecté dans
  un `<span>` via `innerHTML`. Commentaire obligatoire : la sortie vient de
  MathLive, pas de l'utilisateur — c'est le **seul** endroit de l'app où un
  `innerHTML` n'est pas assaini, et la raison doit être écrite noir sur blanc.
- `flush()` : rien à faire, avec le commentaire disant pourquoi (MathLive rend
  de façon synchrone, il n'y a pas de passe finale comme `finishRenderMath`).

`apps/windows/src/host/folder.ts` :
- `pickFolder()` : `open({ directory: true, multiple: false })` de
  plugin-dialog ; rend `null` si l'utilisateur annule.
- `savedFolder()` / `saveFolder(chemin)` : un `Store` de plugin-store, fichier
  `settings.json`, clé `folder`. **Un seul dossier** en tranche 1 ; la spec §6
  en prévoit dix, mais c'est la tranche 2 — écrire la clé au singulier
  maintenant et le noter, plutôt que de préparer un tableau que personne ne
  remplit.
- `allowFolder(chemin)` : `invoke("allow_folder", { chemin })`, à appeler
  **avant** toute lecture, y compris au redémarrage sur un dossier déjà
  persisté (les portées ne survivent pas à la fermeture).

`apps/windows/src/host/index.ts` assemble le tout :
`export function createWindowsHost(racine: string, index: WindowsIndex): Host`,
avec `platform: { isMobile: false, isMacOS: false, uiLanguage: navigator.language }`,
`paths: { resultsDir: ".neo-quiz/results" }` et
`shell: { openExternal: … openPath de plugin-opener …, revealInHost: async () => false }`.

```ts
	/* `revealInHost` rend toujours false : l'app n'a pas d'explorateur de
	   fichiers interne à faire défiler. Ce n'est PAS une erreur — le contrat
	   le dit, et `engine/resources.ts` enchaîne sur l'ouverture externe. */
```

```ts
	/* `.neo-quiz/results` et non `.obsidian/…` : un dossier de quiz n'est pas
	   forcément un vault. C'est aussi l'emplacement où la TRANCHE 2 mettra le
	   journal de révision (spec §5) — le préfixe est posé ici, la migration
	   ne l'est pas. */
```

- [ ] **Étape 7 : brancher dans le démarrage**

Dans `apps/windows/src/main.ts`, remplacer `demarrer()` :

```ts
async function demarrer(): Promise<void> {
	const root = document.getElementById("neo-quiz-root");
	if (!root) throw new Error("#neo-quiz-root introuvable");
	setLanguage("auto");
	document.title = t("app.window.title");
	try {
		const racine = await savedFolder();
		if (!racine) return void mountSansDossier(root);
		/* Les portées ne survivent pas au redémarrage : les rouvrir AVANT la
		   première lecture, même sur un dossier déjà persisté. */
		await allowFolder(racine);
		const index = await createWindowsIndex(racine);
		installHost(createWindowsHost(racine, index));
		mount(root, racine);
	} catch (e) {
		root.textContent = t("app.error.startup", { error: e instanceof Error ? e.message : String(e) });
	}
}
```

`mountSansDossier` affiche `t("app.empty.noFolder")` et un bouton
`t("app.empty.pickFolder")` qui enchaîne `pickFolder` → `saveFolder` →
`allowFolder` → recharge (`location.reload()`). Recharger plutôt que remonter à
chaud : l'hôte est un singleton installé une fois, et le rechargement est la
façon la plus honnête d'en obtenir un neuf.

- [ ] **Étape 8 : vert, puis ÉPROUVER quatre cas**

```bash
npm run check:windows-host
```
Attendu : `Hôte Windows — index : 7/7` et `Hôte Windows — liens : 5/5`.

1. **Le renommage dans l'index** — dans `apply`, traiter `rename` sans
   supprimer `oldPath`.
   Attendu : `ÉCHEC  un renommage retire l'ancien chemin`. Restaurer.
2. **La priorité du chemin exact** — dans `resolveDansIndex`, chercher par nom
   avant de chercher par chemin.
   Attendu : `ÉCHEC  un chemin exact gagne`. Restaurer.
3. **La proximité** — retirer le départage par préfixe commun et prendre le
   premier homonyme.
   Attendu : `ÉCHEC  un nom seul prend le plus proche de la note citante`.
   Restaurer.
4. **Les deux portées** (dans l'app, pas dans le script) — retirer la ligne
   `asset_protocol_scope` de `allow_folder`, rebâtir, relancer.
   Attendu : les notes se lisent, la liste s'affiche… **et aucune image de
   quiz ne s'affiche, sans un seul message d'erreur**. C'est le défaut exact
   que le commentaire de la commande décrit. Restaurer.

Le cas 4 ne peut pas être automatisé dans cette tranche : le noter en
commentaire au-dessus de la commande Rust, pour que personne ne « simplifie »
en n'ouvrant qu'une portée.

- [ ] **Étape 9 : vérifier, essayer, commiter**

```bash
npm run check && npm run check:host && npm run check:theme \
  && npm run check:windows-host && npm run check:app && npm run build
grep -rn 'Ă\|Â\|â€' apps/windows/src scripts/check-windows-host.mjs
```

`check:host` doit toujours dire 42 fichiers, et surtout **ne rien signaler sous
`apps/windows/`** : l'assertion 3 le garde.

**Essai dans l'app** (`npm run app:dev`) : au premier lancement, l'écran vide
et son bouton ; choisir un vrai vault (`C:\obsidian-vaults\Efrei`) ; la fenêtre
recharge et ne montre plus l'écran vide. Fermer, relancer : le dossier est
retenu, aucun sélecteur ne réapparaît.

```bash
git add apps/windows scripts/check-windows-host.mjs package.json
git commit -m "$(cat <<'EOF'
feat(app): l'hote Windows — index, liens, toasts, mathematiques

allow_folder ouvre DEUX portees, celle de fs et celle du protocole asset.
N'en ouvrir qu'une donne une app qui lit les notes et n'affiche aucune image,
sans le moindre message d'erreur. Les portees ne survivent pas au
redemarrage : le frontend rappelle la commande a chaque lancement.

buildIndex et resolveDansIndex sont PURS et sans import Tauri : c'est ce qui
les rend eprouvables hors de la fenetre. Un index qui derive ne produit pas
d'erreur, il fait disparaitre des quiz du catalogue.

Les chemins du contrat sont relatifs a la racine : un chemin absolu qui
fuirait casserait les cles du journal de revision, qui doivent etre
identiques sous les trois hotes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 11 — La liste des quiz

**But :** le scanner partagé, branché sur l'hôte Windows, produit la liste des
quiz du dossier ; l'app l'affiche avec les cartes du contrat visuel existant.

**Fichiers :**
- Créer : `apps/windows/src/ui/list.ts`
- Modifier : `apps/windows/src/main.ts` (`mount` affiche la liste)
- Modifier : `src/i18n/en/app.ts`, `src/i18n/fr/app.ts` (clés de la liste)

**Interfaces :**
- Consomme : `createScanner(host)` et `QuizIndexEntry` (tâche 7) ;
  `createWindowsHost`, `createWindowsIndex` (tâche 10) ; `currentHost()` ;
  `t()`.
- Produit : `renderList(root: HTMLElement, deps: { scanner: Scanner; onOpen(entry: QuizIndexEntry): void }): () => void`
  — le retour désabonne. Consommé par la tâche 12.
  Clés i18n : `app.list.title`, `app.list.empty`, `app.list.questions`,
  `app.list.changeFolder`.

- [ ] **Étape 1 : les clés**

Ajouter à `src/i18n/en/app.ts` :

```ts
	"app.list.title": "My quizzes",
	"app.list.empty": "No quiz found in this folder.",
	"app.list.questions": "{count} questions",
	"app.list.changeFolder": "Change folder",
```

et les traductions dans `src/i18n/fr/app.ts` (« Mes quiz », « Aucun quiz trouvé
dans ce dossier. », « {count} questions », « Changer de dossier »).

`{count}` est un jeton de `t()`, pas une interpolation de gabarit : il est
remplacé par `t("app.list.questions", { count: entry.questions })`.

- [ ] **Étape 2 : écrire la liste**

Créer `apps/windows/src/ui/list.ts` (viser moins de 150 lignes) :

```ts
import type { QuizIndexEntry, Scanner } from "../../../../src/dashboard/scanner";
import { t } from "../../../../src/i18n";
import { currentHost } from "../../../../src/host/current";

/*
 * La liste des quiz. Elle réutilise les CLASSES du tableau de bord
 * (`qbd-quiz-card`, `qbd-quiz-card-title`…) plutôt que d'en inventer :
 * `src/assets/css/dashboard/dashboard-quizzes.css` est déjà chargé par l'app,
 * et deux jeux de classes pour la même carte donneraient deux apparences à
 * tenir synchrones.
 *
 * Le scanner est PARTAGÉ (src/dashboard/scanner.ts) : c'est lui qui décide ce
 * qu'est un quiz, sous Obsidian comme ici. Une seconde règle de détection
 * ferait diverger les deux catalogues.
 */
export function renderList(
	root: HTMLElement,
	deps: { scanner: Scanner; onOpen(entry: QuizIndexEntry): void; onChangeFolder(): void },
): () => void {
	// … construction du DOM, puis :
	const desabonner = deps.scanner.onChange(dessiner);
	dessiner(deps.scanner.getQuizzes());
	/* Le retour désabonne. Sans lui, ouvrir puis fermer un quiz plusieurs fois
	   empile les abonnements, et chaque modification de note redessine la liste
	   autant de fois qu'elle a été ouverte. */
	return desabonner;
}
```

Règles à respecter dans le corps :
- **Aucune chaîne en dur** : tous les libellés par `t()`, appelé dans
  `dessiner`, jamais au niveau du module.
- Les titres viennent de `entry.title` (le nom de la note) et sont posés par
  `textContent`, **jamais** `innerHTML` : ce sont des noms de fichiers de
  l'utilisateur.
- Le type de quiz s'affiche par `t("dashboard.quizType." + entry.quizType)` —
  la clé existe déjà, et c'est exactement pourquoi le scanner garde un **tag**
  et non un libellé traduit.
- Tri par `title`, `localeCompare` avec la langue courante.
- Un bouton « Changer de dossier » avec l'icône Lucide `folder`, posée par
  `currentHost().ui.setIcon` — jamais d'emoji.

- [ ] **Étape 3 : brancher**

Dans `apps/windows/src/main.ts`, `mount(root, racine)` crée le scanner et
appelle `renderList` :

```ts
	const scanner = createScanner(currentHost());
	await scanner.init();
	demonter = renderList(root, {
		scanner,
		onOpen: entry => ouvrirQuiz(root, scanner, entry),   // tâche 12
		onChangeFolder: async () => { … pickFolder → saveFolder → location.reload() },
	});
```

Garder `demonter` au niveau du module et l'appeler avant tout remontage : c'est
le pendant du `destroyQuiz()` du greffon, et l'oublier fuit un abonnement par
navigation.

- [ ] **Étape 4 : essayer, et ÉPROUVER trois cas**

```bash
npm run check:app && npm run app:dev
```

Attendu : la liste des quiz du vault choisi, avec le **même nombre** que le
tableau de bord d'Obsidian sur le même vault. Les compter des deux côtés :
c'est la meilleure preuve que le scanner partagé se comporte identiquement.

1. **Le désabonnement** — retirer le `return desabonner` (rendre `() => {}`).
   Ouvrir et fermer un quiz cinq fois (tâche 12 requise ; sinon, remonter la
   liste cinq fois à la main depuis la console), puis modifier une note dans
   Obsidian : la liste se redessine cinq fois. L'observer avec un
   `console.count` temporaire dans `dessiner`. Restaurer.
2. **Le tag de type traduit au scan** — dans `scanner.ts`, remplacer
   `quizType` par un libellé français en dur. Relancer l'app en anglais.
   Attendu : le libellé reste français. C'est le piège que le commentaire de
   `QuizTypeTag` documente ; restaurer.
3. **`innerHTML` sur un titre** — renommer une note en
   `<img src=x onerror=alert(1)>.md`, puis remplacer `textContent` par
   `innerHTML` dans la carte. Recharger.
   Attendu : le code s'exécute. Restaurer et vérifier que le nom s'affiche
   littéralement. Supprimer la note d'essai.

- [ ] **Étape 5 : vérifier, commiter**

```bash
npm run check && npm run check:host && npm run check:app && npm run check:scanner && npm run build
grep -rn 'Ă\|Â\|â€' apps/windows/src src/i18n
```

```bash
git add apps/windows/src src/i18n
git commit -m "$(cat <<'EOF'
feat(app): la liste des quiz du dossier

Le scanner PARTAGE decide ce qu'est un quiz, sous Obsidian comme ici : une
seconde regle de detection ferait diverger les deux catalogues. Le compte de
quiz doit etre identique des deux cotes sur le meme vault.

La liste reutilise les classes du tableau de bord plutot que d'en inventer :
le CSS est deja charge, et deux jeux de classes pour la meme carte donneraient
deux apparences a tenir synchrones.

renderList rend son desabonnement : sans lui, chaque aller-retour vers un
quiz empile un abonnement de plus.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tâche 12 — La page d'un quiz

**But :** le livrable de la tranche. `renderInteractiveQuiz` tourne dans la
fenêtre de l'app, sur un quiz lu dans une note du dossier. On peut jouer un quiz
de ses notes sans Obsidian.

**Fichiers :**
- Créer : `apps/windows/src/ui/quiz-page.ts`
- Modifier : `apps/windows/src/main.ts`
- Modifier : `src/i18n/en/app.ts`, `src/i18n/fr/app.ts`

**Interfaces :**
- Consomme : `renderInteractiveQuiz` et son `RenderQuizContext`
  `{ container, quiz, sourcePath, statsSink?, reviewSink? }` (tâche 4) ;
  `parseQuizSource` de `src/quiz-utils.ts` ; `currentHost()` ;
  `QuizIndexEntry` (tâche 7) ; `renderList` (tâche 11).
- Produit : `openQuizPage(root, entry, onBack): Promise<() => void>` — le
  retour détruit l'instance. Rien ne consomme cette tâche : c'est la dernière.
  Clés i18n : `app.quiz.back`, `app.quiz.readError`.

- [ ] **Étape 1 : les clés**

`src/i18n/en/app.ts` : `"app.quiz.back": "Back to quizzes"`,
`"app.quiz.readError": "Could not read {path}: {error}"`.
`src/i18n/fr/app.ts` : « Retour aux quiz », « Impossible de lire {path} : {error} ».

- [ ] **Étape 2 : écrire la page**

Créer `apps/windows/src/ui/quiz-page.ts` :

```ts
import { parseQuizSource, QUIZ_BLOCK_RE } from "../../../../src/quiz-utils";
import { renderInteractiveQuiz } from "../../../../src/engine";
import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import type { QuizIndexEntry } from "../../../../src/dashboard/scanner";

/*
 * La page d'un quiz. Elle lit la note, en extrait le PREMIER bloc
 * `quiz-blocks` — la même limite que le scanner, mesurée et connue
 * (`npm run report:multiblock`), pas un oubli — et le donne au moteur partagé.
 *
 * Le moteur est IDENTIQUE à celui du greffon : c'est tout l'objet du contrat
 * d'hôte. Rien ici ne connaît Obsidian, et rien ici ne réimplémente le rendu.
 */
export async function openQuizPage(
	root: HTMLElement,
	entry: QuizIndexEntry,
	onBack: () => void,
): Promise<() => void> {
	root.replaceChildren();

	const barre = root.appendChild(document.createElement("div"));
	barre.className = "qbd-detail-header";
	const retour = barre.appendChild(document.createElement("button"));
	retour.type = "button";
	retour.className = "qbd-btn";
	// t() AU RENDU, et l'icône par l'hôte — jamais d'emoji.
	const icone = retour.appendChild(document.createElement("span"));
	currentHost().ui.setIcon(icone, "arrow-left");
	retour.appendChild(document.createTextNode(t("app.quiz.back")));
	retour.addEventListener("click", onBack);

	const hote = root.appendChild(document.createElement("div"));
	hote.className = "quiz-blocks-host";

	let contenu: string;
	try {
		contenu = await currentHost().fs.read(entry.path);
	} catch (e) {
		hote.textContent = t("app.quiz.readError", {
			path: entry.path,
			error: e instanceof Error ? e.message : String(e),
		});
		return () => root.replaceChildren();
	}

	const bloc = contenu.match(QUIZ_BLOCK_RE);
	if (!bloc) {
		hote.textContent = t("app.list.empty");
		return () => root.replaceChildren();
	}

	await renderInteractiveQuiz({
		container: hote,
		quiz: parseQuizSource(bloc[1].trim()),
		sourcePath: entry.path,
		/* Ni `statsSink` ni `reviewSink` en tranche 1 : les statistiques et le
		   journal de révision sont la TRANCHE 2. Le moteur les traite comme
		   absents sans se plaindre — c'est pourquoi ils sont optionnels. */
	});

	/* Le cycle de vie est porté par `__quizDestroy`, posé sur le conteneur par
	   le moteur. C'est l'équivalent exact de l'`onunload` du
	   MarkdownRenderChild côté greffon : sans cet appel, chaque quiz ouvert
	   laisse ses écouteurs document/window, ses ResizeObserver et ses timers. */
	return () => {
		try { hote.__quizDestroy?.(); } catch (_) { /* déjà détruit */ }
		root.replaceChildren();
	};
}
```

`sourcePath` vaut `entry.path`, **le chemin relatif à la racine du dossier** :
c'est la clé que le journal de révision utilisera en tranche 2, et elle doit
être identique à celle qu'Obsidian écrit pour la même note.

- [ ] **Étape 3 : brancher la navigation**

Dans `apps/windows/src/main.ts`, `ouvrirQuiz` démonte la liste, ouvre la page,
et au retour démonte la page et remonte la liste. Une seule variable
`demonterCourant: (() => void) | null` au niveau du module, appelée **avant**
chaque changement d'écran.

- [ ] **Étape 4 : essayer — c'est le livrable**

```bash
npm run app:dev
```

Jouer un quiz **entier** dans l'app, sans Obsidian ouvert :
- les transitions de slide fonctionnent, la hauteur suit ;
- une question à choix unique, une à choix multiples, une texte, une
  d'ordonnancement, une d'appariement ;
- un quiz avec `![[image.png]]` → l'image s'affiche (les deux portées sont
  ouvertes) ;
- un quiz avec des mathématiques `$…$` → MathLive rend les formules ;
- une question `type: math` → le champ MathLive s'ouvre, son clavier virtuel
  affiche ses deux icônes Lucide ;
- un quiz en mode examen → le chronomètre tourne, le toast de fin de temps
  s'affiche ;
- un quiz en mode leçon → les rôles `read`/`recall`/`test` s'enchaînent ;
- retour à la liste, réouverture du même quiz : il repart de zéro.

- [ ] **Étape 5 : ÉPROUVER trois cas**

1. **La destruction** — retirer l'appel à `__quizDestroy` du retour. Ouvrir et
   fermer un quiz dix fois, puis redimensionner la fenêtre.
   Attendu : dix instances réagissent (à observer par un `console.count` dans le
   `ResizeObserver` du moteur, ou par le gonflement de la mémoire dans
   l'inspecteur). Restaurer et refaire : une seule.
   C'est la fuite exacte que le `MarkdownRenderChild` évite côté greffon.
2. **Le `sourcePath`** — le remplacer par un chemin absolu
   (`racine + "/" + entry.path`). L'app fonctionne à l'identique **en
   apparence**. Mais la clé écrite serait
   `C:/obsidian-vaults/Efrei/Cours/ch1.md::q1` là où Obsidian écrit
   `Cours/ch1.md::q1` : les deux hôtes cesseraient de partager l'historique,
   et personne ne le verrait avant la tranche 2. Restaurer, et laisser le
   commentaire qui l'explique.
3. **Le premier bloc seulement** — ouvrir une note à DEUX blocs `quiz-blocks`.
   Attendu : seul le premier est joué, exactement comme dans le tableau de bord
   d'Obsidian. Vérifier que `npm run report:multiblock` mesure toujours le même
   nombre de notes concernées : c'est une limite connue, pas une régression.

- [ ] **Étape 6 : la vérification complète de la tranche**

```bash
npm run check \
  && npm run check:host && npm run check:obsidian-host && npm run check:windows-host \
  && npm run check:theme && npm run check:math-render \
  && npm run check:md && npm run check:export && npm run check:scanner \
  && npm run check:review-store && npm run check:engine-review && npm run check:module-edit \
  && npm run check:lesson && npm run check:markers \
  && npm run check:app && npm run build
npm run report:multiblock
node scripts/audit-vaults.mjs "C:/obsidian-vaults/Personal" "C:/obsidian-vaults/Efrei"
grep -rn 'Ă\|Â\|â€' apps src docs/superpowers/plans
```

`audit-vaults.mjs` fait l'aller-retour lecture → écriture → lecture sur tous les
quiz de vrais vaults. La tranche 1 ne touche ni `convertParsedToInternal` ni
`exportAll`, donc il doit passer **à l'identique** ; un écart signalerait une
régression là où on ne l'attendait pas.

`check:lesson` doit aller jusqu'au bout : compter ses groupes.

**Test manuel dans Obsidian**, une dernière fois : jouer un quiz, l'éditer,
ouvrir le tableau de bord, générer un quiz par l'IA. Le greffon doit être
exactement dans l'état où il était avant la tranche.

- [ ] **Étape 7 : commit**

```bash
git add apps/windows/src src/i18n
git commit -m "$(cat <<'EOF'
feat(app): jouer un quiz de ses notes sans Obsidian

Le moteur est IDENTIQUE a celui du greffon : c'est tout l'objet du contrat
d'hote. Rien dans l'app ne connait Obsidian et rien n'y reimplemente le rendu.

sourcePath est le chemin RELATIF a la racine du dossier : c'est la cle que le
journal de revision utilisera en tranche 2, et elle doit etre identique a
celle qu'Obsidian ecrit pour la meme note. Un chemin absolu fonctionnerait a
l'identique en apparence et ferait diverger les deux historiques, sans que
personne ne le voie avant la tranche 2.

Le retour de openQuizPage appelle __quizDestroy : c'est l'equivalent exact de
l'onunload du MarkdownRenderChild. Sans lui, chaque quiz ouvert laisse ses
ecouteurs, ses ResizeObserver et ses timers.

Livrable de la tranche 1 atteint.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Ce que la tranche 1 laisse ouvert (et qui appartient aux suivantes)

À relire avant d'écrire le plan de la tranche 2 — ce sont les choses que la
tranche 1 aura apprises, exactement ce que la spec §9 annonçait.

- **Le journal de révision** n'est pas branché : `reviewSink` et `statsSink` ne
  sont pas fournis par l'app. Son déménagement vers `<dossier>/.neo-quiz/` et sa
  migration sont la tranche 2 (spec §5). Le préfixe `.neo-quiz/` est déjà posé
  par `paths.resultsDir`.
- **Un seul dossier**, clé `folder` au singulier dans les réglages. La spec §6
  en prévoit dix, avec un journal chacun : tranche 2.
- **Les renommages que plugin-fs ne distingue pas** d'un `remove` + `create`
  feront perdre la clé de révision. Limite mesurée, notée dans `fs.ts`, à
  trancher quand le journal arrivera.
- **Le thème clair** n'existe pas (spec §8, décision assumée).
- **`prepareFuzzySearch` et `loadPdfJs`**, utilisés une fois chacun dans le
  tableau de bord, ne sont pas rencontrés par cette tranche (spec §8).
- **L'empaquetage et la mise à jour** : `npm run app:build` produit un
  installeur NSIS, sans signature ni `AppUpdater`. Spec §8, à trancher.
- **42 fichiers restent dans la liste du cliquet** — tout le tableau de bord,
  tout l'éditeur, et cinq modules du greffon. C'est le programme des tranches 2
  à 4, et `npm run check:host` en donne l'état exact à tout moment.

---

## Auto-revue

**Couverture de la spec (§7, tranche 1 — « une fenêtre, un dossier, la liste
des quiz, la page d'un quiz, le moteur qui tourne, la couche d'hôte
minimale ») :**

| Exigence | Tâche |
|---|---|
| Une fenêtre (barre de titre, taille et position mémorisées) | 8 |
| Le thème, qu'Obsidian fournissait | 9 |
| Un dossier, choisi au sélecteur natif et persisté | 10 |
| La couche d'hôte : fichiers | 1, 3, 5, 10 |
| La couche d'hôte : icônes | 1, 3, 4, 10 |
| La couche d'hôte : toasts | 1, 3, 4, 10 |
| La couche d'hôte : ressources | 1, 3, 5, 10 |
| La liste des quiz | 11 |
| La page d'un quiz, le moteur qui tourne | 12 |
| Pile Tauri 2 calquée sur Neo Calendar (§3) | 8 |
| Structure `src/` + `apps/{obsidian,windows}` (§3) | 2, 8 |
| Aucun `from "obsidian"` hors `apps/`, vérifié mécaniquement (§4) | 1, puis chaque tâche |
| Le greffon tourne sans interruption (§3) | contrainte globale, vérifiée aux tâches 2 à 7 |

**Hors périmètre, conformément à la spec** : le journal de révision et sa
migration (§5, tranche 2), les dix dossiers (§6, tranche 2), l'édition
(tranche 3), la génération IA (tranche 4), les notifications, la distribution,
le partage entre étudiants (§7, hors chantier).

**Cohérence des types** — vérifiée d'un bout à l'autre :
`Host` / `HostFile` / `HostFileEvent` (tâche 1) sont employés sous ces noms
exacts aux tâches 3, 5, 7, 10 ; `createObsidianHost(app, plugin): Host`
(tâche 3) ; `createScanner(host: Host): Scanner` et
`scanFile(file: HostFile)` (tâche 7) ; `createWindowsHost(racine, index): Host`
et `buildIndex(fichiers): WindowsIndex` (tâche 10) ;
`RenderQuizContext { container, quiz, sourcePath, statsSink?, reviewSink? }`
défini en tâche 4 et consommé tel quel en tâche 12 ; `QuizIndexEntry` inchangé
de la tâche 7 à la tâche 12 ; `resourceUrl` rend `string | null` partout, jamais
`""`.
