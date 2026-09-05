# Application Windows — tranche 2.5 : « l'app ressemble au tableau de bord »

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — utiliser
> `superpowers:subagent-driven-development` pour exécuter ce plan tâche par
> tâche. Les étapes sont des cases à cocher (`- [ ]`).

**But :** l'application retrouve la coquille du tableau de bord du greffon — la
barre latérale, la page d'accueil complète (statistiques, héros « Reprendre »,
sections repliables) et « Mes quiz » avec ses modules et ses UE.

**Architecture :** aucune réécriture. Les sept modules d'interface du tableau de
bord (`nav`, `home`, `quizzes`, `quizzes-render`, `quiz-card`, `module-card`,
`collapsible`) n'importent d'Obsidian qu'un seul symbole, `setIcon`, déjà présent
dans le contrat d'hôte sous `host.ui.setIcon`. Ce qui coûte réellement, ce sont
les **166 extensions DOM d'Obsidian** (`createDiv`, `createEl`, `createSpan`)
qu'ils emploient et qui n'existent pas dans la fenêtre : elles passent par
`ajouter` de `src/dom.ts`. Ces modules deviennent alors du code PARTAGÉ, servant
les deux hôtes, et le cliquet de frontière descend de 41 à 33 fichiers.

Le seul morceau réellement neuf est la **coquille de vue** : sous Obsidian c'est
un `ItemView` ; l'application lui substitue son propre montage d'écran, déjà en
place depuis la tranche 1.

**Pile :** TypeScript strict (ESM), Tauri 2 + Vite pour l'app, esbuild pour le
greffon, Lucide pour les icônes.

**Spec :** `docs/superpowers/specs/2026-09-04-app-windows-design.md`, §4 — « Ce
que l'interface garde, et ce qu'elle gagne » : « L'interface actuelle est
conservée : barre latérale (Accueil / Mes quiz / Générer / Réglages), grille de
stats, sections repliables, cartes de quiz, page de quiz unique. Le contrat
visuel du 2026-07-28 continue de s'appliquer. »

**Pourquoi cette tranche existe alors qu'elle n'est pas au §7.** Le découpage en
tranches de la spec est fait par CAPACITÉ — réviser, éditer, générer — et aucune
ne porte le portage de l'interface elle-même. Le §4 le prescrit pourtant sans
ambiguïté. C'est un trou du découpage, constaté à l'écran par Ahmed le
2026-09-05 : l'app affichait une liste plate là où le greffon a un tableau de
bord. Cette tranche le comble, et s'intercale entre la 2 (« l'app révise », faite)
et la 3 (« l'app édite », non ouverte).

**Le cap, rappelé parce qu'il gouverne les arbitrages** (feuille de route §1 et
chantier 4, reconfirmé par Ahmed le 2026-09-05) : à terme **l'application est
plus complète que le greffon**, qui est réduit à un lecteur. La génération
quittera le greffon pour être **exclusive à l'application**. Quand ce plan
hésite entre « faire comme le greffon » et « faire mieux », c'est la fidélité qui
gagne ICI — le portage n'est pas le moment d'inventer — mais rien ne doit être
construit qui EMPÊCHE de faire mieux ensuite.

---

## Contraintes globales

Ces règles valent pour **toutes** les tâches. Chacune a déjà coûté un bug.

- **Commits directs sur `main`.** Jamais de branche, jamais de worktree, jamais
  de `git push`. Un commit par tâche, à la fin de la tâche.
- **Commentaires en français**, documentant le **pourquoi**, pas le quoi.
- **Aucune chaîne visible en dur.** Tout passe par `t("<domaine>.<clé>")` de
  `src/i18n.ts`, et `t()` est appelé **AU RENDU** — jamais dans une constante de
  niveau module, qui figerait la langue du démarrage.
- **AVANT de créer une clé, vérifier qu'elle n'existe pas déjà.** Les modules
  portés emploient DÉJÀ leurs clés (`dashboard.nav.*`, `dashboard.home.*`,
  `dashboard.quizzes.*`) : ce portage ne devrait en créer AUCUNE. Toute clé neuve
  est un signal qu'on est en train de réécrire au lieu de porter.
- **Ne jamais traduire** les valeurs persistées : clés du format quiz, grades du
  journal, dates `AAAA-MM-JJ`, `id:` de commandes, logs, classes CSS.
- **`PLUGIN_ID` et `QUIZ_BLOCK_LANGUAGE` valent `quiz-blocks` et NE CHANGENT
  PAS.** `resultsDir` côté Obsidian reste `.obsidian/quiz-blocks-results`.
- **`src/scheduler/` est un noyau PUR**, qu'aucune tâche de ce plan ne modifie —
  ni `src/types/quiz.ts`, qui fait partie de l'unité portable.
- **`src/dom.ts` (`ajouter`) est le SEUL constructeur d'éléments** dans tout
  fichier de `src/` qui n'importe pas Obsidian, et dans tout `apps/windows/`. Les
  extensions DOM d'Obsidian (`createEl`, `createDiv`, `createSpan`, `empty`,
  `setText`, `addClass`…) n'existent pas dans la fenêtre. Aucun `import` ne les
  trahit : c'est la quatrième assertion de `npm run check:host` qui les attrape,
  et elle ne se déclenche QUE sur un fichier qui n'importe plus Obsidian.
- **Icônes Lucide via `host.ui.setIcon`**, jamais d'emoji, jamais `setIcon`
  importé d'Obsidian. Les LOGOS de marque viennent de
  `apps/windows/src/ui/marques.ts`.
- **`dashboard/ui-select.ts` est le seul dropdown autorisé** — jamais de
  `<select>` natif. Il importe encore Obsidian : les modules portés par ce plan
  ne doivent donc pas en dépendre. Si l'un d'eux en a besoin, c'est un signal
  d'arrêt, pas un contournement (voir D5).
- **Le greffon ne doit à AUCUN moment être cassé.** Il partage tout ce code :
  chaque tâche se termine sur `npm run check` vert, `npm run build` qui déploie,
  et un passage dans Obsidian (tableau de bord ouvert, une page visitée).
- **`npm run check:host` doit DESCENDRE ou rester stable, jamais monter.** Il est
  à 41 en entrée de tranche ; il doit finir à 33.
- **Juger un script sur son CODE DE SORTIE, jamais sur la fin de sa sortie** :
  `npm run <script>; echo "EXIT=$?"`. Un groupe vert peut suivre trois groupes
  rouges.
- **Chaque cas de test doit être ÉPROUVÉ DISCRIMINANT** : retirer la règle qu'il
  garde, lancer, **voir l'assertion rougir**, restaurer, revoir vert. Sur la
  tranche 2, cette méthode a trouvé neuf défauts du plan lui-même, dont deux cas
  qui restaient verts quoi qu'on casse.
- **Double encodage :** après toute écriture, `grep -rn 'Ă\|Â\|â€' <fichiers
  touchés>` et corriger. Le dépôt a déjà été pollué.

---

## Ce que la tranche 2 a laissé, et qui commande celle-ci

1. **Le contrat d'hôte est complet pour ce portage.** `host.ui.setIcon` et
   `host.ui.notice` existent depuis la tranche 1 ; `host.fs`, `host.paths` et
   `host.watcher` depuis la tranche 2. Aucun sous-contrat neuf n'est nécessaire.
2. **`statsSink` n'est PAS branché côté application**, et c'est une décision
   assumée de la tranche 2 : la spec de l'ordonnanceur (§9.1) sépare le journal
   de révision des statistiques d'affichage, « deux systèmes distincts, à ne pas
   fusionner ». Mais **toute la page d'accueil en dépend** : le héros
   « Reprendre », les badges « En cours · 5 % », la tuile « Maîtrisés ». C'est
   donc la première tâche de ce plan, et la seule qui touche au comportement.
3. **Le cliquet est à 41** (`npm run check:host`), et la liste `RESTANTS` de
   `scripts/check-host.mjs` nomme chaque fichier avec la tranche qui le libère.
4. **La carte « À réviser » existe déjà** (`apps/windows/src/ui/review-card.ts`,
   tranche 2) et emploie les classes du tableau de bord. Elle doit se retrouver
   à sa place dans la page d'accueil portée, pas être dupliquée.
5. **`apps/windows/src/main.ts` monte un écran à la fois** par une variable
   `demonterCourant`, appelée avant chaque changement. Ce patron reste : la
   coquille portée s'y branche au lieu de le remplacer.
6. **La règle d'identité et le découpage de clé** (`chemin::id`) sont partagés :
   `keyOfQuestion` est exportée de `src/review/review-store.ts` depuis la vague
   de correction finale de la tranche 2. Le découpage inverse
   (`lastIndexOf("::")`) est encore répété à trois endroits — dette connue,
   consignée, que ce plan ne traite pas.

---

## Décisions que ce plan tranche

### D1. Les modules portés deviennent du code PARTAGÉ, pas des copies

`nav.ts`, `home.ts`, `quizzes.ts`, `quizzes-render.ts`, `quiz-card.ts`,
`module-card.ts` et `collapsible.ts` restent **où ils sont**, dans
`src/dashboard/`, et servent les DEUX hôtes après conversion. On ne les copie
pas sous `apps/windows/`.

La raison est mesurée, pas théorique : Neo Calendar, le précédent du même auteur,
a deux dépôts partageant 132 fichiers de même nom, dont **83 ont divergé**. Une
copie de `home.ts` prendrait un correctif d'un côté et pas de l'autre, et
personne ne le verrait avant que les deux tableaux de bord ne comptent
différemment.

Conséquence directe : ces sept fichiers **sortent de `RESTANTS`**, et le cliquet
passe de 41 à 34. Avec `stats-store.ts` (tâche 1), **33**.

### D2. Ce qui reste sous `apps/windows/` : la coquille, et elle seule

Sous Obsidian, `src/dashboard.ts` est un `ItemView` : il porte le cycle de vie
d'un onglet, un `Scope` de raccourcis clavier, l'historique des boutons de
souris, et il assemble le god-object `ctx`. Rien de tout cela n'est portable tel
quel — mais rien de tout cela n'est non plus l'interface.

L'application écrit donc sa propre coquille,
`apps/windows/src/ui/dashboard-shell.ts`, qui fait les trois choses que
`dashboard.ts` fait et qui comptent : **monter la barre latérale**, **router
entre les pages**, et **assembler un `ctx` réduit**. Elle ne reprend ni le
`Scope`, ni l'historique de souris, ni le `MarkdownRenderChild`.

### D3. Le `ctx` se réduit, et trois dépendances à Obsidian disparaissent

Mesuré sur les sept modules à porter, le `ctx` n'est employé que par six voies :
`ctx.plugin` (22 fois), `ctx.app` (8), `ctx.scanner` (7), `ctx.navigate` (7),
`ctx.statsStore` (4), `ctx.recordNav` (2).

`ctx.plugin` ne sert qu'à lire cinq réglages et à les enregistrer. Et `ctx.app`
ne sert qu'à **trois** choses, toutes déjà couvertes par le contrat d'hôte :

| Ce que `ctx.app` fait | Ce qui le remplace |
|---|---|
| lire la note de correspondance des modules (`metadataCache.getFirstLinkpathDest` + `vault.cachedRead`) | `currentHost().links.resolve(nom, "")` puis `currentHost().fs.readCached(chemin)` |
| jouer un quiz (`openQuizForPlay(ctx.app, quiz)`) | `ctx.openQuiz(quiz)` — sous Obsidian, ouvre la note ; dans l'app, la page de quiz |
| ouvrir les réglages d'Obsidian (`nav.ts`) | `ctx.openSettings()` — sous Obsidian, l'onglet de réglages ; dans l'app, sa page Réglages |

Le `ctx` des pages devient donc :

```ts
/** Ce dont les pages Accueil et Mes quiz ont besoin, et RIEN de plus.
    `DashboardCtx` l'étend en y ajoutant l'IA, la dictée, le détail et le
    `Plugin` lui-même. Déclarer cette intersection est ce qui empêche une
    page portée de se remettre à lire `ctx.plugin` sans que personne ne le
    voie : côté application, ce champ n'existe pas. */
export interface DashboardShellCtx {
	scanner: Scanner;
	statsStore: StatsStore;
	/** Les cinq réglages que les pages lisent, et rien d'autre. Mutés en
	    place puis persistés par `saveSettings()`, comme avant. */
	settings: DashboardPageSettings;
	saveSettings(): Promise<void>;
	navigate(view: DashboardViewName): void;
	recordNav(): void;
	/** Joue un quiz. L'hôte décide ce que « jouer » veut dire : ouvrir la
	    note sous Obsidian, monter la page de quiz dans l'application. */
	openQuiz(quiz: QuizIndexEntry): void;
	/** Ouvre les réglages de l'hôte. */
	openSettings(): void;
}

export interface DashboardPageSettings {
	quizzesExpandedFolders?: string[];
	quizzesGrouping?: string;
	quizzesModuleOverrides?: Record<string, ModuleOverride>;
	quizzesModuleMapNote?: string;
	quizzesArchivedFolders?: string[];
}
```

`DashboardCtx extends DashboardShellCtx` : le greffon continue de satisfaire les
pages sans une ligne de changement, et une page qui se remettrait à lire
`ctx.plugin` ou `ctx.app` deviendrait une erreur de compilation côté application.

**Ce n'est pas une couche d'adaptation, c'est un rétrécissement.** Les pages
lisaient déjà exactement ces cinq réglages ; on nomme ce qu'elles employaient au
lieu de leur tendre un greffon entier.

### D4. « Générer » reste dans la barre latérale, désactivé

L'entrée existe, grisée, avec une infobulle qui dit qu'elle arrive. Elle n'est
pas masquée, pour deux raisons : la génération **atterrira** dans l'application
(tranche 4) et y sera **exclusive** — le greffon la perdra au chantier 4 —, et
une barre de navigation qui change de forme entre deux versions se remarque plus
qu'une entrée visiblement à venir.

### D5. Ce que ce plan N'OUVRE PAS

- **Les modals et menus « ⋯ »** : modifier un dossier, créer un dossier,
  sélecteurs d'icône et de couleur, menu d'une carte. Périmètre choisi par Ahmed
  le 2026-09-05. Ils dépendent de `Modal`, de `getIconIds` et de `ui-select.ts`,
  qui importent tous Obsidian.
- **La page de détail partagée** (`dashboard/detail.ts`) : l'application garde la
  page de quiz simple de la tranche 1. Conséquence assumée et à écrire dans la
  note de passation : `CLAUDE.md` dit cette page UNIQUE et servant trois hôtes ;
  il y en a en réalité une quatrième variante depuis la tranche 1, et elle
  survit à cette tranche.
- **La page « Générer »** (tranche 4), **l'édition** (tranche 3), **le partage**
  (`share.ts`, qui dépend de `Platform`, `normalizePath` et `TFile`).
- **La session inter-quiz « une seule chose »** — celle qui poserait les
  questions dues de PLUSIEURS quiz à la suite. C'est ce que la spec de
  l'ordonnanceur (§9.6) nomme « la première chose que construira l'application
  PC », et c'est le premier endroit où l'application dépassera vraiment le
  greffon. Elle a besoin de cette coquille pour exister ; elle vient après.

---

## Structure des fichiers

**Créés**

| Fichier | Responsabilité |
|---|---|
| `apps/windows/src/ui/dashboard-shell.ts` | la coquille : barre latérale, routage, `ctx` réduit |
| `apps/windows/src/review/stats.ts` | le `StatsStore` de l'app, sur le magasin Tauri |
| `scripts/check-dashboard-dom.mjs` | aucun module porté n'emploie d'extension DOM d'Obsidian |

**Modifiés**

| Fichier | Nature du changement |
|---|---|
| `src/dashboard/stats-store.ts` | `StatsStorePlugin` → un contrat de deux méthodes |
| `src/dashboard/nav.ts` | `setIcon` → `host.ui.setIcon` ; 12 extensions DOM |
| `src/dashboard/collapsible.ts` | idem ; 8 extensions DOM |
| `src/dashboard/quiz-card.ts` | idem ; 15 extensions DOM |
| `src/dashboard/module-card.ts` | idem ; 16 extensions DOM |
| `src/dashboard/home.ts` | idem ; **63 extensions DOM** |
| `src/dashboard/quizzes.ts` | idem ; 29 extensions DOM |
| `src/dashboard/quizzes-render.ts` | idem ; 23 extensions DOM |
| `src/types/dashboard-ctx.ts` | `DashboardShellCtx` extraite, `DashboardCtx` l'étend |
| `apps/obsidian/plugin.ts` | `createStatsStore` sur le nouveau contrat |
| `apps/windows/src/main.ts` | monte la coquille au lieu de la liste |
| `apps/windows/src/ui/list.ts` | absorbé par la page « Mes quiz », ou supprimé |
| `scripts/check-host.mjs` | `RESTANTS` perd huit entrées (41 → 33) |
| `package.json` | `check:dashboard-dom` |
| `CLAUDE.md`, `docs/superpowers/notes/controles.md` | le nouveau contrôle, le compte du cliquet |

---
## La recette de conversion, une fois pour toutes

Six des sept tâches font le même geste sur des fichiers différents. Voici la
règle exacte, à appliquer sans l'interpréter. **Chaque tâche qui convertit un
fichier reçoit cette section dans son brief.**

### 1. L'import d'Obsidian disparaît

```ts
import { setIcon } from "obsidian";          // AVANT
import { currentHost } from "../host/current";  // APRÈS
```

et chaque `setIcon(el, "nom")` devient `currentHost().ui.setIcon(el, "nom")`.

`currentHost()` **jette** si aucun hôte n'est installé — c'est voulu, et c'est
préférable à un `?.` qui rendrait la fonctionnalité silencieusement inerte. Les
deux hôtes installent le leur avant tout rendu.

Si le fichier importe `Notice`, l'équivalent est `currentHost().ui.notice(msg)`.
Aucun des sept fichiers de ce plan n'en importe, mais vérifie plutôt que de
supposer.

### 2. Les extensions DOM deviennent `ajouter`

`ajouter` (`src/dom.ts`) a la signature :

```ts
ajouter<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement, tag: K, cls?: string, texte?: string,
): HTMLElementTagNameMap[K]
```

Les quatre formes rencontrées, et leur traduction :

```ts
// 1. un div avec une classe — la forme la plus fréquente (454 sur 586)
el.createDiv({ cls: "qbd-home-stats" })
ajouter(el, "div", "qbd-home-stats")

// 2. un élément typé, classe et texte
el.createEl("p", { cls: "qbd-stat-label", text: card.label })
ajouter(el, "p", "qbd-stat-label", card.label)

// 3. un span sans classe, juste du texte
el.createSpan({ text: t("dashboard.home.generate") })
ajouter(el, "span", undefined, t("dashboard.home.generate"))

// 4. tout le reste (`type`, `value`, `title`, `href`, `placeholder`) se pose
//    en PROPRIÉTÉ sur l'élément rendu — c'est déjà l'idiome de l'app
el.createEl("button", { cls: "qbd-btn--create", type: "button" })
const b = ajouter(el, "button", "qbd-btn--create");
b.type = "button";
```

**`ajouter` emploie `textContent`, jamais `innerHTML`** : c'est ce qui protège
des titres de notes venus du disque. Un nom de fichier
« `<img src=x onerror=…>.md` » exécuterait son code avec les droits de la
fenêtre. Le HTML d'un quiz a ses propres portes (`src/engine/sanitizer.ts`) et ne
passe jamais par ici.

Les autres extensions, si tu en croises :

| Obsidian | Standard |
|---|---|
| `el.empty()` | `el.replaceChildren()` |
| `el.setText(s)` | `el.textContent = s` |
| `el.addClass(c)` | `el.classList.add(c)` |
| `el.removeClass(c)` | `el.classList.remove(c)` |
| `el.toggleClass(c, b)` | `el.classList.toggle(c, b)` |
| `el.detach()` | `el.remove()` |
| `el.setAttr(k, v)` | `el.setAttribute(k, v)` |

`el.setAttribute`, `el.classList.toggle` et `el.remove` sont **déjà** standard :
ne les touche pas. Seuls les noms de la colonne de gauche sont d'Obsidian.

### 3. Le fichier sort de `RESTANTS`

Retire son entrée de `scripts/check-host.mjs`. Le contrôle **échoue** sinon
(assertion 2 : une entrée qui n'importe plus rien doit être retirée, sans quoi la
liste devient un tapis sous lequel on balaie).

### 4. Le piège, et c'est celui qui compte

`npm run check:host` n'attrape les extensions DOM **que dans les fichiers qui
n'importent plus Obsidian** (assertion 4). Les deux moitiés du geste sont donc
liées : retirer l'import SANS convertir les extensions fait rougir le contrôle —
c'est le résultat voulu —, mais convertir les extensions sans retirer l'import ne
fait rien rougir du tout, et le fichier reste inutilisable dans la fenêtre.

**Fais toujours les deux dans le même mouvement, et termine par
`npm run check:host; echo "EXIT=$?"`.**

### 5. La vérification qui ne ment pas

`npm run check` (typecheck) ne voit que le greffon. C'est **`npm run check:app`**
qui compile le code partagé tel que la fenêtre le verra : c'est lui qui attrape
une extension DOM oubliée, parce que `obsidian.d.ts` n'y est pas chargé et que la
méthode n'existe alors sur aucun type.

Un fichier converti sans `check:app` vert n'est pas converti.

---

## Tâche 1 — Les statistiques par quiz, dans l'application

C'est la seule tâche qui touche au COMPORTEMENT, et elle vient en premier parce
que toute la page d'accueil en dépend : sans elle, pas de héros « Reprendre »,
pas de badge « En cours · 5 % », pas de tuile « Maîtrisés ».

**Fichiers :**
- Modifier : `src/dashboard/stats-store.ts`
- Modifier : `apps/obsidian/plugin.ts` (le seul appelant côté greffon)
- Créer : `apps/windows/src/review/stats.ts`
- Modifier : `apps/windows/src/main.ts`, `apps/windows/src/ui/quiz-page.ts`
- Modifier : `scripts/check-host.mjs` (`RESTANTS` perd `stats-store.ts`)

**Interfaces :**
- Consomme : `HostFs` et le magasin de réglages de l'app
  (`apps/windows/src/host/folder.ts`, qui expose déjà `reglages()` en interne).
- Produit : `StatsStoreHost { getStats(): Record<string, QuizStatRecord>;
  saveStats(d: Record<string, QuizStatRecord>): Promise<void> }`,
  `createStatsStore(host: StatsStoreHost): StatsStore` (signature changée),
  `creerStatsApp(): Promise<StatsStore>`. Les tâches 4 et 5 consomment
  `StatsStore` par `ctx.statsStore`.

- [ ] **Étape 1 : réduire le contrat du store**

`src/dashboard/stats-store.ts` importe aujourd'hui `type { Plugin }` d'Obsidian
et lit `plugin.settings.quizStats`. Remplace `StatsStorePlugin` par :

```ts
/**
 * Ce dont le store a besoin de son hôte, et rien de plus.
 *
 * C'était un `obsidian.Plugin` entier ; il n'en employait que deux choses.
 * Le réduire à celles-ci est ce qui permet à l'application de le servir
 * sans fabriquer un faux greffon — et rend le store éprouvable hors
 * d'Obsidian, ce qu'il n'était pas.
 */
export interface StatsStoreHost {
	/** Les stats persistées, ou un objet vide au premier démarrage. */
	getStats(): Record<string, QuizStatRecord>;
	/** Écrit la table entière. Appelée en différé (500 ms) par le store. */
	saveStats(data: Record<string, QuizStatRecord>): Promise<void>;
}
```

`createStatsStore(plugin: StatsStorePlugin)` devient
`createStatsStore(host: StatsStoreHost)`, `load()` fait `data = host.getStats()`,
et le `scheduleSave` différé appelle `host.saveStats(data)`. **Le reste du
fichier ne bouge pas** : le débounce, les records, `formatRelativeTime`.

Retire l'import `type { Plugin } from "obsidian"` et l'entrée
`src/dashboard/stats-store.ts` de `RESTANTS`.

- [ ] **Étape 2 : le greffon fournit le contrat**

Dans `apps/obsidian/plugin.ts`, là où `createStatsStore(this)` est appelé :

```ts
		/* Le store ne connaît plus le `Plugin`, seulement deux méthodes. La
		   forme persistée ne change PAS : `settings.quizStats`, écrit par
		   `saveSettings()` comme avant — des stats déjà accumulées chez
		   l'utilisateur doivent rester lisibles. */
		this._statsStore = createStatsStore({
			getStats: () => this.settings.quizStats || {},
			saveStats: async (data) => {
				this.settings.quizStats = data;
				await this.saveSettings();
			},
		});
```

- [ ] **Étape 3 : l'application fournit le sien**

Créer `apps/windows/src/review/stats.ts` :

```ts
import { LOG_PREFIX } from "../../../../src/branding";
import { createStatsStore, type StatsStore, type QuizStatRecord } from "../../../../src/dashboard/stats-store";
import { reglagesStore } from "../host/folder";

/* ══════════════════════════════════════════════════════════
   LES STATISTIQUES PAR QUIZ, CÔTÉ APPLICATION

   Distinctes du JOURNAL de révision, et à ne pas fusionner avec lui : le
   journal répond à « quelles questions sont dues aujourd'hui », les stats à
   « où en suis-je sur ce quiz ». La spec de l'ordonnanceur (§9.1) le dit
   sans ambiguïté — deux systèmes, deux questions.

   Elles vivent dans les RÉGLAGES de l'application, pas dans le dossier de
   quiz, et c'est délibéré : contrairement au journal, elles ne se partagent
   pas avec le greffon. Les partager demanderait de fusionner deux tables
   écrites par deux processus sans arbitre, pour un affichage — le journal,
   lui, le mérite et paie ce prix avec son format en ajout seul.
══════════════════════════════════════════════════════════ */

const CLE_STATS = "quizStats";

export async function creerStatsApp(): Promise<StatsStore> {
	const store = await reglagesStore();
	let cache: Record<string, QuizStatRecord> = {};
	try {
		const brut = await store.get<Record<string, QuizStatRecord>>(CLE_STATS);
		if (brut && typeof brut === "object") cache = brut;
	} catch (e) {
		// Réglages illisibles : on repart de stats vides plutôt que d'empêcher
		// le démarrage. Une progression perdue se recalcule en rejouant ;
		// une fenêtre qui ne s'ouvre pas, non.
		console.warn(LOG_PREFIX, "statistiques illisibles:", e);
	}
	const stats = createStatsStore({
		getStats: () => cache,
		saveStats: async (data) => {
			cache = data;
			await store.set(CLE_STATS, data);
			await store.save();
		},
	});
	stats.load();
	return stats;
}
```

`apps/windows/src/host/folder.ts` garde son magasin dans une variable privée
`magasin` : exporte l'accesseur `reglagesStore()` (renomme la fonction interne
`reglages` si tu préfères, mais **n'en crée pas une seconde** — deux magasins
ouverts sur le même fichier se marcheraient dessus).

- [ ] **Étape 4 : brancher le puits**

Dans `apps/windows/src/main.ts`, construire le store au démarrage (à côté de
`creerJournalApp`) et le passer à `openQuizPage`, qui gagne un paramètre
`statsSink` transmis au moteur :

```ts
			/* `statsSink` ET `reviewSink` : deux puits, deux questions. Le
			   moteur ne connaît que leur FORME (`types/engine-ctx.ts`), jamais
			   leur implémentation — c'est ce qui lui permet de servir les deux
			   hôtes sans savoir lequel l'appelle. */
			statsSink: stats,
			reviewSink,
```

Et, comme pour le journal, `stats.destroy()` doit partir dans le
`beforeunload` déjà posé par la tranche 2 : il porte le même débounce de
500 ms, donc le même risque de perdre la dernière écriture.

- [ ] **Étape 5 : vérifier**

```bash
npm run check; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"      # doit annoncer 40
npm run check:app; echo "EXIT=$?"
npm run check:engine-review; echo "EXIT=$?"
npm run build
```

Puis Obsidian : ouvrir le tableau de bord, jouer un quiz jusqu'aux résultats,
vérifier que la carte affiche bien sa progression et que `data.json` porte
toujours `quizStats`. **C'est une donnée déjà accumulée chez l'utilisateur : une
régression ici efface sa progression.**

- [ ] **Étape 6 : commit**

```bash
git add src/dashboard/stats-store.ts apps/obsidian/plugin.ts apps/windows/src scripts/check-host.mjs
git commit -m "feat(app): les statistiques par quiz, sur un contrat de deux methodes"
```

---
## Tâche 2 — Le `ctx` des pages se réduit à ce qu'elles emploient

Aucune extension DOM dans cette tâche : elle prépare le terrain en coupant les
trois dépendances à Obsidian qui passent par le `ctx`. À la fin, les sept modules
n'ont plus qu'un seul lien avec Obsidian — leur `import { setIcon }` — que les
tâches 3 à 6 retireront fichier par fichier.

**Le greffon doit continuer de fonctionner à l'identique** : cette tâche ne
change aucun comportement, elle renomme des voies d'accès.

**Fichiers :**
- Modifier : `src/types/dashboard-ctx.ts`
- Modifier : `src/dashboard/home.ts`, `quizzes.ts`, `quizzes-render.ts`, `nav.ts`
- Modifier : `src/dashboard.ts` (le littéral `ctx`)
- Créer : `src/dashboard/module-map-note.ts`

**Interfaces :**
- Consomme : `Scanner`, `StatsStore` (tâche 1), `Host` (`currentHost()`).
- Produit : `DashboardShellCtx`, `DashboardPageSettings` (voir D3),
  `lireModuleMap(nomNote: string): Promise<ModuleMap>`. Les tâches 5, 6 et 7 les
  consomment.

- [ ] **Étape 1 : extraire la lecture de la note de correspondance**

Ce bloc est écrit DEUX fois, à l'identique, dans `home.ts:70-71` et
`quizzes.ts:127-128` — et le commentaire de `home.ts` explique pourquoi les deux
pages doivent lire la même chose : « sans elle, un quiz rangé dans un SOUS-dossier
de son module se voyait attribuer l'accent du sous-dossier ici, celui du module
là-bas : deux couleurs pour un même quiz selon la page ».

Créer `src/dashboard/module-map-note.ts` :

```ts
import { currentHost } from "../host/current";
import { parseModuleMap, type ModuleMap } from "./quiz-modules";

/**
 * La table des modules, lue dans la note de correspondance.
 *
 * Écrite deux fois à l'identique (accueil et « Mes quiz ») avant ce
 * fichier, et le commentaire d'origine dit pourquoi les deux pages doivent
 * lire la MÊME chose : un quiz rangé dans un sous-dossier de son module
 * recevait sinon l'accent du sous-dossier sur une page et celui du module
 * sur l'autre — deux couleurs pour un même quiz.
 *
 * Passe par l'HÔTE, plus par `app.metadataCache` : `links.resolve` comprend
 * « Dashboard » écrit sans chemin, exactement comme le faisait
 * `getFirstLinkpathDest`, et `fs.readCached` sert le cache du coffre sous
 * Obsidian comme `cachedRead` le faisait.
 *
 * Une table VIDE est un état normal — la note n'existe pas, ou le réglage
 * est vide. Les modules retombent alors sur leur dossier parent
 * (`moduleForQuiz`), ce qui est le comportement historique.
 */
export const MODULE_MAP_VIDE: ModuleMap = { byFolder: new Map(), ueOrder: [] };

export async function lireModuleMap(nomNote: string): Promise<ModuleMap> {
	const nom = String(nomNote ?? "").trim();
	if (!nom) return MODULE_MAP_VIDE;
	try {
		const fichier = currentHost().links.resolve(nom, "");
		if (!fichier) return MODULE_MAP_VIDE;
		return parseModuleMap(await currentHost().fs.readCached(fichier.path));
	} catch (e) {
		/* Note illisible : on rend une table vide plutôt que d'empêcher le
		   rendu de la page. Les modules retombent sur leur dossier parent. */
		return MODULE_MAP_VIDE;
	}
}
```

Dans `home.ts` et `quizzes.ts`, remplacer les deux blocs par
`moduleMap = await lireModuleMap(ctx.settings.quizzesModuleMapNote || "");`
en **gardant intacts** les drapeaux `moduleMapLoaded` / `lastEntering` et le
repeint qui suit : leur commentaire dit qu'un rendu interrompu doit rejouer son
entrée, « sinon la cascade se coupe net à peine commencée ».

- [ ] **Étape 2 : déclarer le ctx réduit**

Dans `src/types/dashboard-ctx.ts`, ajouter `DashboardPageSettings` et
`DashboardShellCtx` (le code exact est en D3, section « Décisions »), puis faire
`export interface DashboardCtx extends DashboardShellCtx { … }` en **retirant de
`DashboardCtx` les membres désormais hérités** (`scanner`, `statsStore`,
`navigate`, `recordNav`). `plugin` et `app` restent sur `DashboardCtx` : le
greffon en a besoin pour l'IA, la dictée et le détail.

- [ ] **Étape 3 : basculer les cinq lectures de réglages**

Dans les quatre fichiers, remplacer mécaniquement :

| Avant | Après |
|---|---|
| `ctx.plugin.settings.quizzesExpandedFolders` | `ctx.settings.quizzesExpandedFolders` |
| `ctx.plugin.settings.quizzesGrouping` | `ctx.settings.quizzesGrouping` |
| `ctx.plugin.settings.quizzesModuleOverrides` | `ctx.settings.quizzesModuleOverrides` |
| `ctx.plugin.settings.quizzesModuleMapNote` | `ctx.settings.quizzesModuleMapNote` |
| `ctx.plugin.settings.quizzesArchivedFolders` | `ctx.settings.quizzesArchivedFolders` |
| `ctx.plugin.saveSettings()` | `ctx.saveSettings()` |

**Ne change pas la sémantique** : ces réglages sont lus À CHAQUE RENDU, et le
commentaire de `quizzes.ts` dit pourquoi — « le réglage peut changer sous nos
pieds (autre appareil, rechargement) ». Une valeur capturée une fois au montage
serait un défaut.

- [ ] **Étape 4 : basculer les trois usages de `ctx.app`**

- `home.ts:299` et `home.ts:474`, `quizzes-render.ts:175` :
  `openQuizForPlay(ctx.app, quiz)` → `ctx.openQuiz(quiz)`.
- `nav.ts:87` : le bloc qui ouvre l'onglet de réglages d'Obsidian →
  `ctx.openSettings()`.

`src/dashboard/quiz-open.ts` n'est alors plus appelé par les pages portées ; il
reste employé ailleurs dans le greffon, donc **ne le supprime pas** et laisse-le
dans `RESTANTS`.

- [ ] **Étape 5 : le greffon fournit les nouveaux membres**

Dans le littéral `ctx` de `src/dashboard.ts` :

```ts
			/* Le ctx porte désormais ce que les PAGES emploient, nommé
			   explicitement. `plugin` et `app` restent pour l'IA, la dictée et
			   le détail — mais les pages d'accueil et « Mes quiz » ne les
			   lisent plus, et l'application peut donc les servir sans greffon. */
			settings: this.plugin.settings,
			saveSettings: () => this.plugin.saveSettings(),
			openQuiz: (quiz) => openQuizForPlay(this.app, quiz),
			openSettings: () => { /* le bloc retiré de nav.ts, déplacé ici */ },
```

- [ ] **Étape 6 : vérifier**

```bash
npm run check; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"      # toujours 40 : aucun import retiré ici
npm run check:app; echo "EXIT=$?"
npm run build
```

**Puis Obsidian, et c'est l'épreuve de cette tâche** : ouvrir le tableau de bord,
visiter Accueil et Mes quiz, replier/déplier une section, entrer dans un module,
changer de groupement (UE / récents), cliquer une carte pour jouer un quiz, et
ouvrir les réglages depuis le rail. **Tout doit se comporter exactement comme
avant** : cette tâche ne devait rien changer.

- [ ] **Étape 7 : commit**

```bash
git add src/types/dashboard-ctx.ts src/dashboard src/dashboard.ts
git commit -m "refactor(dashboard): les pages ne lisent plus le greffon, mais ce qu elles emploient"
```

---

## Tâche 3 — Les trois modules d'affichage : sections repliables et cartes

Premier lot de conversion, et le plus petit : 39 extensions DOM sur trois
fichiers sans état. **Applique la recette de conversion** (section ci-dessus,
fournie dans ton brief).

**Fichiers :**
- Modifier : `src/dashboard/collapsible.ts` (8 extensions)
- Modifier : `src/dashboard/quiz-card.ts` (15)
- Modifier : `src/dashboard/module-card.ts` (16)
- Modifier : `scripts/check-host.mjs` (`RESTANTS` perd les trois)

**Interfaces :**
- Consomme : `currentHost()` (`src/host/current.ts`), `ajouter` (`src/dom.ts`).
- Produit : les signatures ne changent pas — `wireCollapseToggle(deps, nodeEl,
  head, chev, key, defaultOpen?)`, `renderQuizCard(...)`, `renderModuleCard(...)`,
  `quizTypeLabel(tag)`. Les tâches 5 et 6 les appellent inchangées.

- [ ] **Étape 1 : convertir les trois fichiers**

Recette appliquée telle quelle. Deux points d'attention propres à ces fichiers :

- `collapsible.ts` emploie déjà `nodeEl.classList.toggle(...)` et
  `head.setAttribute(...)` — **du DOM standard, à ne pas toucher**. Seuls
  `createDiv`/`createEl`/`createSpan` et `setIcon` changent.
- `nav.ts` (tâche 4) emploie `b.el.toggleClass(...)`, qui est d'Obsidian ; ces
  trois fichiers-ci, non. Vérifie plutôt que de supposer :
  `grep -nE '\.(toggleClass|addClass|removeClass|empty|setText|detach|setAttr)\(' src/dashboard/{collapsible,quiz-card,module-card}.ts`

- [ ] **Étape 2 : retirer les trois entrées de `RESTANTS`**

- [ ] **Étape 3 : vérifier**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"     # C'EST LUI qui attrape une extension oubliée
npm run check:host; echo "EXIT=$?"    # doit annoncer 37
npm run build
```

- [ ] **Étape 4 : éprouver la discriminance du cliquet**

Le contrôle qui garde cette tâche n'est pas un jeu de cas, c'est
`check:host`. Éprouve-le sur l'un des trois fichiers : remets un
`el.createDiv({ cls: "x" })` quelque part dans `quiz-card.ts`, lance
`npm run check:host` — il doit **rougir** en nommant `createDiv` — puis restaure
et revois vert. Sans cette épreuve, tu ne sais pas si le contrôle regarde
vraiment ce fichier.

- [ ] **Étape 5 : Obsidian**

Ouvrir le tableau de bord : les cartes de quiz et de module s'affichent avec
leur icône, leur badge de type et leur liseré de couleur ; les sections se
replient et se déplient avec leur chevron animé.

- [ ] **Étape 6 : commit**

```bash
git add src/dashboard/collapsible.ts src/dashboard/quiz-card.ts src/dashboard/module-card.ts scripts/check-host.mjs
git commit -m "refactor(dashboard): sections repliables et cartes, en DOM standard"
```

---

## Tâche 4 — La barre latérale

**Fichiers :**
- Modifier : `src/dashboard/nav.ts` (12 extensions)
- Modifier : `scripts/check-host.mjs`

**Interfaces :**
- Consomme : `DashboardShellCtx` (tâche 2), `currentHost()`, `ajouter`.
- Produit : `createNavHandlers(ctx: DashboardShellCtx): NavHandlers` avec
  `NavHandlers { render(container), setActive(key) }` — inchangé, mais le type du
  paramètre se rétrécit. La tâche 7 l'appelle.

- [ ] **Étape 1 : convertir**

Recette appliquée. Trois points propres à ce fichier :

- `b.el.toggleClass("qbd-nav-item--active", …)` → `b.el.classList.toggle(...)`.
  Son commentaire dit pourquoi la bascule porte sur des nœuds VIVANTS plutôt que
  sur un rail reconstruit : « le bouton cliqué est un élément neuf, né déjà
  actif — la transition du CSS n'a aucun état de départ à interpoler et la carte
  claire apparaît d'un coup ». Ne change pas ce mécanisme.
- `container.empty()` → `container.replaceChildren()`.
- Le paramètre de `createNavHandlers` passe de `DashboardCtx` à
  `DashboardShellCtx` : c'est ce rétrécissement qui rend le rail utilisable par
  l'application.

- [ ] **Étape 2 : « Générer » désactivé, pas masqué**

L'entrée `{ key: "ai", labelKey: "dashboard.nav.generate", icon: "sparkles" }`
reste dans `NAV_ITEMS`. Le rail doit pouvoir la rendre **inerte** quand l'hôte ne
sait pas générer. Ajoute à `DashboardShellCtx` (déclaré en tâche 2) :

```ts
	/** Pages que cet hôte sait ouvrir. Une entrée du rail absente d'ici est
	    rendue DÉSACTIVÉE, pas masquée : la génération atterrira dans
	    l'application (tranche 4) et y sera exclusive — le greffon la perdra.
	    Une barre de navigation qui change de forme entre deux versions se
	    remarque plus qu'une entrée visiblement à venir. */
	canOpen(view: DashboardViewName): boolean;
```

et, dans `render`, pour une entrée refusée : `btn.disabled = true`, la classe
`qbd-nav-item--disabled`, et `btn.title = t("dashboard.nav.soon")`.

**Vérifie d'abord si `dashboard.nav.soon` existe** (`grep -rn '"dashboard.nav' src/i18n/en/`).
Si non, c'est la SEULE clé que ce plan crée — ajoute-la aux deux dictionnaires,
en anglais d'abord (`"Coming soon"` / `"Bientôt disponible"`).

Le CSS : ajoute `.qbd-nav-item--disabled` dans le fichier où vivent déjà les
autres règles `.qbd-nav-*` (cherche-le : `grep -rln 'qbd-nav-item' src/assets/css/`),
avec les variables déjà définies (`--text-faint` pour la couleur, `cursor:
not-allowed`). N'invente aucune variable : `npm run check:theme` ne balaie pas
`apps/windows/`, mais celui-ci est dans `src/assets/css/` et y est soumis.

- [ ] **Étape 3 : vérifier**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:theme; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"    # doit annoncer 36
npm run build
```

- [ ] **Étape 4 : Obsidian**

Le rail s'affiche, les trois entrées sont actives (le greffon sait tout faire),
le bouton de réglages ouvre l'onglet du greffon, et la bascule d'entrée active
garde son animation.

- [ ] **Étape 5 : commit**

```bash
git add src/dashboard/nav.ts src/types/dashboard-ctx.ts src/assets/css scripts/check-host.mjs src/i18n
git commit -m "refactor(dashboard): la barre laterale, en DOM standard"
```

---
## Tâche 5 — La page d'accueil

Le plus gros fichier de la tranche : 63 extensions DOM sur 481 lignes. Il porte
le héros « Reprendre », la grille de statistiques, la carte « À réviser » et les
sections « À faire » / « Complétés ».

**Fichiers :**
- Modifier : `src/dashboard/home.ts` (63 extensions)
- Modifier : `scripts/check-host.mjs`

**Interfaces :**
- Consomme : `DashboardShellCtx` (tâche 2), `lireModuleMap` (tâche 2),
  `wireCollapseToggle`, `renderQuizCard` (tâche 3), `currentHost()`, `ajouter`.
- Produit : `createHomeHandlers(ctx: DashboardShellCtx): HomeHandlers` avec
  `HomeHandlers { render(container, entering?) }` — inchangé. La tâche 7
  l'appelle.

- [ ] **Étape 1 : convertir**

Recette appliquée. Ce fichier est le seul où le volume rend une relecture
indispensable : **convertis par section** (en-tête, statistiques, héros,
« À réviser », « À faire », « Complétés ») et relis chaque section convertie
avant de passer à la suivante, plutôt que de tout enchaîner.

Deux pièges propres à ce fichier :

- **Les classes conditionnelles.** `createDiv({ cls: \`qbd-stat-card${card.highlight ? " qbd-stat-card--highlight" : ""}\` })`
  devient `ajouter(el, "div", \`qbd-stat-card${…}\`)` : la chaîne se construit
  pareil, elle passe juste en troisième argument.
- **La carte « À réviser » existe DÉJÀ dans ce fichier** (`home.ts:277-312`,
  section `plan.today`) et l'application en a une copie autonome
  (`apps/windows/src/ui/review-card.ts`, tranche 2). **Ne touche à aucune des
  deux ici** : c'est la tâche 7 qui décide laquelle survit, une fois la coquille
  en place. Les laisser coexister le temps de deux tâches est délibéré.

- [ ] **Étape 2 : retirer l'entrée de `RESTANTS`**

- [ ] **Étape 3 : vérifier**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"    # doit annoncer 35
npm run build
```

- [ ] **Étape 4 : Obsidian, section par section**

C'est la page la plus dense du produit ; vérifie-la dans l'ordre où elle se lit :

1. le titre, le sous-titre et le bouton « Générer un quiz » ;
2. le héros « Reprendre là où vous en étiez », avec sa barre de progression et
   sa teinte, qui vient de l'accent du DOSSIER du quiz ;
3. les trois tuiles : quiz créés, questions au total, maîtrisés ;
4. « À réviser aujourd'hui », avec son compte et ses lignes cliquables ;
5. « À faire », plafonnée à deux rangées de trois, avec son « Voir tout » ;
6. « Complétés », repliée par défaut.

*Cassé* : une section vide alors qu'elle ne devrait pas l'être, une carte sans
son liseré de couleur, un chevron qui ne tourne plus.

- [ ] **Étape 5 : commit**

```bash
git add src/dashboard/home.ts scripts/check-host.mjs
git commit -m "refactor(dashboard): la page d accueil, en DOM standard"
```

---

## Tâche 6 — La page « Mes quiz »

**Fichiers :**
- Modifier : `src/dashboard/quizzes.ts` (29 extensions)
- Modifier : `src/dashboard/quizzes-render.ts` (23 extensions)
- Modifier : `scripts/check-host.mjs`

**Interfaces :**
- Consomme : `DashboardShellCtx`, `lireModuleMap` (tâche 2),
  `wireCollapseToggle`, `renderQuizCard`, `renderModuleCard` (tâche 3),
  `currentHost()`, `ajouter`.
- Produit : `createQuizzesHandlers(ctx: DashboardShellCtx): QuizzesHandlers` avec
  `QuizzesHandlers { render(container), resetDrilldown(), getOpenFolder(),
  openFolder(folder), openFolderOfQuiz(quizPath) }` — inchangé.
  `renderQuizGrid(...)`, `renderModuleDrill(...)`, `GridDeps`,
  `GroupingKey = "ue" | "recent"` inchangés. La tâche 7 les appelle.

- [ ] **Étape 1 : convertir les deux fichiers**

Recette appliquée. Le point d'attention est le **drill-down** : entrer dans un
module remplace la grille par le contenu du module, et quatre méthodes de
`QuizzesHandlers` existent uniquement pour que l'historique de navigation puisse
le restaurer. Leur commentaire dit ce que chacune évite — par exemple
`resetDrilldown` : « sans ça, entrer dans un module puis revenir par le rail
rouvrirait le module au lieu de la grille ». **Ne touche à aucune de ces
mécaniques**, seulement à la construction des éléments.

- [ ] **Étape 2 : retirer les deux entrées de `RESTANTS`**

- [ ] **Étape 3 : vérifier**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"    # doit annoncer 33
npm run build
```

- [ ] **Étape 4 : Obsidian**

1. « Mes quiz » affiche les modules groupés par UE ;
2. basculer le groupement sur « Récents » et revenir ;
3. entrer dans un module (drill-down), puis revenir par le fil d'Ariane ;
4. entrer dans un module, puis revenir par le RAIL : la grille doit s'afficher,
   pas le module — c'est ce que `resetDrilldown` garde ;
5. replier et déplier un groupe d'UE, fermer et rouvrir le tableau de bord : le
   repli est persisté.

- [ ] **Étape 5 : commit**

```bash
git add src/dashboard/quizzes.ts src/dashboard/quizzes-render.ts scripts/check-host.mjs
git commit -m "refactor(dashboard): la page Mes quiz, en DOM standard"
```

---

## Tâche 7 — La coquille de l'application

Tout le code d'interface est désormais partagé. Cette tâche écrit ce qui reste :
la coquille qui monte le rail, route entre les pages et assemble le `ctx`.

**Fichiers :**
- Créer : `apps/windows/src/ui/dashboard-shell.ts`
- Modifier : `apps/windows/src/main.ts`
- Supprimer : `apps/windows/src/ui/list.ts` (remplacé par la page « Mes quiz »)
- Décider : `apps/windows/src/ui/review-card.ts` (voir étape 4)

**Interfaces :**
- Consomme : `createNavHandlers` (tâche 4), `createHomeHandlers` (tâche 5),
  `createQuizzesHandlers` (tâche 6), `DashboardShellCtx` (tâche 2),
  `createScanner`, `creerStatsApp` (tâche 1), `creerJournalApp` (tranche 2),
  `renderSettings` (tranche 2), `openQuizPage` (tranche 1).
- Produit : `monterDashboard(root, deps): () => void`.

- [ ] **Étape 1 : écrire la coquille**

```ts
/* ══════════════════════════════════════════════════════════
   LA COQUILLE DU TABLEAU DE BORD, CÔTÉ APPLICATION

   Sous Obsidian, `src/dashboard.ts` est un `ItemView` : il porte le cycle de
   vie d'un onglet, un `Scope` de raccourcis, l'historique des boutons de
   souris. Rien de tout cela n'est portable — et rien de tout cela n'est
   l'interface. Ce fichier fait les trois choses que `dashboard.ts` fait et
   qui comptent : monter le rail, router entre les pages, assembler le `ctx`.

   Les PAGES, elles, sont les mêmes qu'Obsidian : `src/dashboard/nav.ts`,
   `home.ts`, `quizzes.ts`. Une copie divergerait, et les deux tableaux de
   bord finiraient par compter différemment.
══════════════════════════════════════════════════════════ */
```

Elle porte :

- l'état `vueCourante: DashboardViewName`, initialisé à `"home"` ;
- le montage : un conteneur pour le rail (`qbd-nav`), un pour le contenu
  (`qbd-content`), aux mêmes classes que le greffon — la feuille de style est
  déjà chargée ;
- `naviguer(vue)` : `nav.setActive(vue)` puis le rendu de la page, avec
  `entering` VRAI seulement si la vue change réellement (compare à la dernière
  vue peinte). Le commentaire de `HomeHandlers.render` dit pourquoi : « un
  re-render déclenché par le scanner du vault passe `false` — sinon la page
  clignote à chaque sauvegarde de note » ;
- l'abonnement au scanner, qui redessine la page courante avec `entering:
  false`, et son désabonnement dans le démontage rendu ;
- le `ctx`, assemblé une fois :

```ts
	const ctx: DashboardShellCtx = {
		scanner: deps.scanner,
		statsStore: deps.stats,
		settings: reglagesPages(),
		saveSettings: () => enregistrerReglagesPages(),
		navigate: (vue) => naviguer(vue),
		/* PAS d'historique de boutons de souris dans l'application : c'est un
		   confort d'onglet Obsidian, et `recordNav` n'a donc rien à empiler.
		   Le no-op est explicite plutôt qu'absent — les pages l'appellent, et
		   un membre manquant serait une erreur de compilation qui inviterait à
		   retirer l'appel côté page, donc à faire diverger les deux hôtes. */
		recordNav: () => {},
		openQuiz: (quiz) => deps.onOpenQuiz(quiz),
		openSettings: () => deps.onOpenSettings(),
		canOpen: (vue) => vue !== "ai",
	};
```

Les cinq réglages de page vivent dans le magasin Tauri, sur le modèle de
`examDates` (tranche 2) : un cache en mémoire chargé au démarrage,
`enregistrerReglagesPages()` qui écrit. **Les clés persistées gardent leurs noms
exacts** (`quizzesExpandedFolders`, `quizzesGrouping`, `quizzesModuleOverrides`,
`quizzesModuleMapNote`, `quizzesArchivedFolders`) : ce sont les mêmes que côté
greffon, et les renommer « parce que c'est l'app » créerait deux vocabulaires
pour la même chose.

- [ ] **Étape 2 : brancher dans `main.ts`**

`mount()` monte désormais la coquille au lieu de `renderList`. `ouvrirQuiz` et
`ouvrirReglages` deviennent les deux callbacks `onOpenQuiz` / `onOpenSettings`,
et le retour d'un quiz remonte la coquille sur la vue d'où l'on venait.

- [ ] **Étape 3 : supprimer `list.ts`**

La page « Mes quiz » le remplace intégralement. `git rm apps/windows/src/ui/list.ts`,
puis vérifier qu'aucun import ne subsiste :
`grep -rn "ui/list" apps/windows/src`.

Sa clé `app.list.title` (« Mes quiz ») devient orpheline : **la retirer des deux
dictionnaires**, `dashboard.quizzes.title` la remplaçant. `app.list.empty` aussi
si plus rien ne l'appelle — vérifie avant de retirer.

- [ ] **Étape 4 : trancher le sort de `review-card.ts`**

`home.ts` rend déjà la carte « À réviser » (section `plan.today`). L'application
en a une copie autonome depuis la tranche 2. **Les deux ne doivent pas
coexister** : c'est le doublon exact que D1 interdit.

La copie de l'app disparaît, à une condition à VÉRIFIER : que `home.ts` lise le
plan par une voie que l'application peut fournir. Regarde comment il l'obtient
(`ctx.plugin._reviewStore?.plan(...)` côté greffon) et ajoute `reviewStore?:
ReviewStore` à `DashboardShellCtx` si ce n'est pas déjà fait — l'application
passe alors le sien, construit par `creerJournalApp`.

Si tu découvres que `home.ts` en dépend d'une façon qui ne se réduit pas
proprement, **arrête-toi et signale-le** plutôt que de garder deux cartes : c'est
une décision de conception, pas un détail d'implémentation.

- [ ] **Étape 5 : vérifier**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"    # toujours 33
npm run check:theme; echo "EXIT=$?"
npm run build
```

- [ ] **Étape 6 : commit**

```bash
git add apps/windows/src src/types/dashboard-ctx.ts src/i18n
git commit -m "feat(app): la coquille du tableau de bord, rail et pages partagees"
```

---

## Tâche 8 — Le contrôle qui garde la frontière DOM, et ce que le dépôt dit de lui-même

**Fichiers :**
- Créer : `scripts/check-dashboard-dom.mjs`
- Modifier : `package.json`
- Modifier : `CLAUDE.md`, `docs/superpowers/notes/controles.md`
- Créer : `docs/superpowers/notes/<date du jour>-tranche-2-5-epreuves-ecran.md`

- [ ] **Étape 1 : le contrôle**

`check:host` attrape les extensions DOM, mais **seulement dans les fichiers qui
n'importent plus Obsidian**. Les sept fichiers portés en sont sortis : ils sont
donc couverts aujourd'hui. Ce qui ne l'est pas, c'est le **retour en arrière** —
quelqu'un qui, en tranche 3, remettrait `import { setIcon } from "obsidian"` dans
`home.ts` pour aller vite le ferait rentrer dans `RESTANTS`, et ses extensions
DOM redeviendraient invisibles.

Créer `scripts/check-dashboard-dom.mjs` : une liste nommée des fichiers d'interface
DÉFINITIVEMENT libérés, qui échoue si l'un d'eux réimporte Obsidian OU emploie une
extension DOM. Contrairement à `RESTANTS`, cette liste ne peut que GRANDIR.

```js
/**
 * LES PAGES DU TABLEAU DE BORD NE REVIENNENT PAS EN ARRIÈRE.
 *
 * `check:host` couvre déjà ces fichiers — mais seulement TANT QU'ILS restent
 * hors de `RESTANTS`. Un `import { setIcon } from "obsidian"` remis « pour
 * aller vite » les y ferait rentrer, et leurs extensions DOM redeviendraient
 * invisibles au contrôle. Cette liste-ci ne peut que grandir : elle nomme ce
 * qui est libéré POUR DE BON.
 *
 *     npm run check:dashboard-dom
 */
const LIBERES = [
	"src/dashboard/collapsible.ts",
	"src/dashboard/quiz-card.ts",
	"src/dashboard/module-card.ts",
	"src/dashboard/nav.ts",
	"src/dashboard/home.ts",
	"src/dashboard/quizzes.ts",
	"src/dashboard/quizzes-render.ts",
	"src/dashboard/stats-store.ts",
	"src/dashboard/module-map-note.ts",
];
```

Il vérifie deux choses par fichier : aucun `from "obsidian"` (les trois formes,
comme `check-host.mjs`), et aucune extension DOM (le même motif, sur du code
débarrassé de ses commentaires). `process.exitCode`, jamais `process.exit()`.

**Éprouve sa discriminance** : remets un `setIcon` importé dans l'un des neuf,
lance, vois rougir ; remets un `createDiv`, vois rougir ; restaure.

- [ ] **Étape 2 : `controles.md` et `CLAUDE.md`**

Une entrée pour `check:dashboard-dom` dans `controles.md`, dans le ton des
autres — **le défaut réel qu'il empêche**, pas ce que le script fait. Une ligne
dans `CLAUDE.md`, et le cliquet passe à **33**.

Ajoute aussi à `CLAUDE.md`, section « Structure du dépôt », que
`src/dashboard/` n'est plus entièrement à supprimer au chantier 4 : ses sept
modules d'interface, `stats-store.ts`, `scanner.ts` et `module-map-note.ts` sont
partagés et survivent. C'est un changement de statut qui contredit la spec de
l'ordonnanceur (§3, « l'adaptateur vit dans `dashboard/` par choix : c'est le
dossier que le chantier 4 supprime ») — dis-le explicitement plutôt que de
laisser les deux affirmations coexister.

- [ ] **Étape 3 : la note d'épreuves à l'écran**

Sur le modèle de `2026-09-05-tranche-2-epreuves-ecran.md`. Aucune tâche de ce
plan n'a été vue à l'écran côté APPLICATION (les épreuves Obsidian, elles, ont
été faites tâche par tâche). Au minimum, par ordre de priorité :

1. **Le tableau de bord de l'app ressemble à celui du greffon.** Les deux côte à
   côte sur le même vault : mêmes tuiles, mêmes comptes, mêmes cartes, mêmes
   couleurs de module. *Cassé* : un écart de compte signifie que les deux hôtes
   ne lisent pas le même catalogue.
2. **Les statistiques se remplissent** : jouer un quiz dans l'app, revenir à
   l'accueil, voir le badge « En cours · x % » et le héros « Reprendre ».
3. **La navigation** : rail, drill-down d'un module, retour par le fil d'Ariane
   et par le rail.
4. **« Générer » est visiblement désactivé**, avec son infobulle.
5. **Le repli des sections est persisté** entre deux lancements.
6. **Le greffon, une dernière fois** : tableau de bord, accueil, Mes quiz,
   génération IA — exactement l'état d'avant.

- [ ] **Étape 4 : commit**

```bash
git add scripts/check-dashboard-dom.mjs package.json CLAUDE.md docs
git commit -m "docs: le controle de la frontiere DOM, et ce qui reste a eprouver"
```

---

## Ce que la tranche 2.5 laisse ouvert

- **Les modals et menus « ⋯ »** : modifier un dossier (nom, UE, couleur, icône,
  date d'examen), créer un dossier, les sélecteurs d'icône et de couleur, le menu
  d'une carte. Ils dépendent de `Modal`, `getIconIds` et `ui-select.ts`. C'est le
  candidat naturel d'une tranche 2.6, et le contrat d'hôte gagnerait un
  sous-contrat `HostModal`.
- **La page de détail partagée** (`dashboard/detail.ts`) : l'application garde sa
  page de quiz simple. `CLAUDE.md` dit cette page UNIQUE et servant trois hôtes ;
  il y en a une quatrième variante depuis la tranche 1, et elle survit.
- **La session inter-quiz « une seule chose »** — poser les questions dues de
  PLUSIEURS quiz à la suite. C'est ce que la spec de l'ordonnanceur (§9.6) nomme
  « la première chose que construira l'application PC », et le premier endroit où
  l'application dépassera vraiment le greffon. Elle a maintenant sa coquille.
- **Le partage** (`share.ts`), **l'édition** (tranche 3), **la génération**
  (tranche 4, et exclusive à l'application).
- **33 fichiers restent dans `RESTANTS`** : l'éditeur, les modals, l'IA, la
  dictée, et cinq modules du greffon.

---

## Auto-revue

**Couverture de la spec (§4 — « L'interface actuelle est conservée : barre
latérale, grille de stats, sections repliables, cartes de quiz ») :**

| Exigence | Tâche |
|---|---|
| Barre latérale (Accueil / Mes quiz / Générer / Réglages) | 4, 7 |
| Grille de stats | 1 (la donnée), 5 (le rendu) |
| Sections repliables | 3 |
| Cartes de quiz et de module | 3 |
| Page d'accueil complète | 5 |
| Page « Mes quiz », modules et UE | 6 |
| Le contrat visuel du 2026-07-28 | tenu par construction : le CSS et le DOM sont les mêmes |
| Aucun `from "obsidian"` de plus dans `src/` | 3, 4, 5, 6 (le cliquet descend à 33) |
| Le greffon tourne sans interruption | contrainte globale, vérifiée à chaque tâche |

**Hors périmètre, conformément à D5** : les modals « ⋯ », la page de détail
partagée, la page « Générer », l'édition, le partage, la session inter-quiz.

**Cohérence des types** — vérifiée d'un bout à l'autre :
`StatsStoreHost` et `createStatsStore(host)` (tâche 1) sont consommés tâche 7 ;
`DashboardShellCtx`, `DashboardPageSettings` et `lireModuleMap` (tâche 2) le sont
aux tâches 4, 5, 6 et 7 ; `wireCollapseToggle`, `renderQuizCard`,
`renderModuleCard` (tâche 3) aux tâches 5 et 6 ; `NavHandlers`, `HomeHandlers`,
`QuizzesHandlers` gardent leurs signatures exactes, seul le TYPE de leur
paramètre `ctx` se rétrécit ; `canOpen(view)` est déclaré tâche 4 et fourni
tâche 7. Les cinq clés de réglages gardent leurs noms persistés des deux côtés.
