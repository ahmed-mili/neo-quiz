# Tranche 2.6 — Les primitives d'interface partagées

> **Pour les agents exécutants :** SOUS-SKILL OBLIGATOIRE — utiliser
> `superpowers:subagent-driven-development` pour exécuter ce plan tâche par
> tâche. Les étapes emploient la syntaxe `- [ ]` pour le suivi.

**Objectif :** donner à l'application les trois primitives d'interface dont les
tranches 3 et 4 dépendent toutes les deux (le dropdown, la modale, le sélecteur
d'icônes), et lui rendre au passage la création de dossier et l'import d'une
archive de quiz.

**Architecture :** la recette de conversion de la tranche 2.5 s'applique telle
quelle à cinq fichiers. Une seule chose est neuve : un sous-contrat `HostModal`
dans `src/host/types.ts`, parce qu'une boîte de dialogue est la dernière
capacité d'Obsidian que le code partagé emploie sans passer par l'hôte.

**Pile :** TypeScript strict ESM, Tauri 2 côté application, aucun framework de
test au-delà des scripts `check:*` du dépôt.

**Spec :** `docs/superpowers/specs/2026-09-04-app-windows-design.md` (§4 pour la
couche d'hôte, §7 pour le découpage en tranches).

---

## Le périmètre, et pourquoi il n'est pas celui qu'on croyait

Le brief d'ouverture de cette tranche annonçait quatre choses : convertir
`ui-select.ts`, créer `HostModal` pour quatre modales (`folder-create.ts`,
`module-edit.ts`, `usage-modal.ts`, `modal-base.ts`), convertir
`icon-picker.ts`, et remplir les six membres optionnels du `ctx`. Il promettait
en prime les menus « ⋯ » et « + Nouveau dossier ».

**La mesure déplace deux de ces morceaux, et il faut le savoir avant d'écrire
une ligne.**

### Les menus « ⋯ » sont de la tranche 3, pas de celle-ci

`src/dashboard/quiz-menu.ts` n'est pas un problème de dropdown. Ses quatre
entrées, dans les deux menus (`buildQuizCardMenu`, `buildModuleCardMenu`) :

| Entrée | Ce qu'elle fait vraiment |
|---|---|
| Partager | `ctx.app.vault.adapter.writeBinary` — écriture BINAIRE d'un `.zip` (`share.ts`) |
| Éditer | ouvre la page de détail en mode édition — c'est le livrable de la tranche 3 |
| Renommer / Archiver | `ctx.app.fileManager.renameFile` (renommage qui met les liens à jour) |
| Supprimer | `ctx.app.vault.process` (lecture-écriture INDIVISIBLE) puis `fileManager.trashFile` |

Trois de ces quatre lignes exigent des primitives que `HostFs` **n'a pas** :
pas de `process`, pas de `trash`, pas d'écriture binaire. Les ajouter ici les
ferait concevoir deux fois, ou une fois mal, alors que la tranche 3 les conçoit
de toute façon — la note de passation avertit que cette tranche touche « la
partie la plus irréversible du produit après le journal ».

Et la spec §7 le range déjà là : « Tranche 3 — L'app édite : la page de quiz en
mode édition, l'écriture des blocs, **la création et la suppression de quiz** ».

**Donc `quiz-menu.ts` et `share.ts` sortent de cette tranche.** Les membres
`openCardMenu?` et `openModuleMenu?` du `ctx` restent absents côté application
après la 2.6, et c'est délibéré.

### `usage-modal.ts` est de la tranche 4

Consommateur unique, vérifié : `src/dashboard/ai.ts:20` et `ai.ts:1622`. Il
n'affiche que les quotas des fournisseurs IA. Rien dans la 2.6 ne l'atteint ;
le convertir maintenant serait porter de la tranche 4 sans le dire.

### Ce que la tranche livre donc réellement

Cinq fichiers quittent le cliquet, qui passe de **33 à 28**.

| Fichier | Extensions DOM | Ce qu'il demande d'autre |
|---|---|---|
| `src/dashboard/ui-select.ts` | 127 | `setIcon` ×15, `TFile` (type seul) |
| `src/dashboard/module-edit.ts` | 28 | `Notice`, `setIcon` |
| `src/dashboard/folder-create.ts` | 12 | `Modal`, `Notice`, `setIcon` |
| `src/dashboard/icon-picker.ts` | 11 | `getIconIds`, `setIcon` |
| `src/editor/utils.ts` | 1 | `setIcon` (deux lignes) |

Comptés avec la MÊME expression que `scripts/check-host.mjs` (assertion 4),
commentaires retirés. Le total de 127 pour `ui-select.ts` est confirmé.

`src/modal-base.ts` NE sort PAS : cinq sous-classes de `QbdModal` restent hors
périmètre (voir tâche 5). Il part avec les tranches 3 et 4.

### Deux blocages transitifs, trouvés en mesurant et non en lisant le brief

`folder-create.ts` n'importe Obsidian que par `Modal`, `Notice` et `setIcon` —
mais il en tire **deux fois plus par ses voisins**, et `npm run check:host` ne
peut pas le dire : il ne compte que les imports DIRECTS. C'est exactement le
défaut qui a fait valider trois tâches sur une prémisse fausse en tranche 2.5.

| Ligne | Import | Conséquence |
|---|---|---|
| `folder-create.ts:10` | `makeDefault` de `../editor/utils` | `editor/utils.ts` importe `setIcon` → Obsidian entre dans le bundle de la fenêtre |
| `folder-create.ts:12` | `openQuizPathInEditor` de `./quiz-open` | `quiz-open.ts` emploie `WorkspaceLeaf` : ouvrir un onglet n'a aucun sens dans la fenêtre |

Le premier se lève à bas prix — `editor/utils.ts` compte **1** extension DOM et
**2** lignes qui appellent `setIcon` (45-46, les helpers `_setIcon`/`_iconSpan`).
D'où la tâche 4, qui n'existait pas au brief.

Le second ne se lève pas : `quiz-open.ts` reste du greffon. Il passe donc par le
`ctx`, comme les six membres optionnels déjà en place (tâche 5, étape 3).

**Si l'un de ces deux blocages n'était pas traité, la tâche qui convertit
`folder-create.ts` passerait au VERT et c'est la dernière tâche — celle qui
importe le module depuis l'application — qui exploserait.** C'est la forme
exacte du dix-septième défaut de la tranche 2.5.

Côté application, trois membres optionnels du `ctx` se remplissent :
`renderGroupingSelect`, `pickIcon`, `createFolder`. Ahmed retrouve
« + Nouveau dossier », **l'import d'une archive `.zip`** (le quiz d'un
camarade), l'édition d'un module (nom, icône, couleur, UE) et le sélecteur de
regroupement au-dessus de « Mes quiz ».

Il ne retrouve PAS le « ⋯ » des cartes, ni la création d'un quiz vierge : les
deux attendent l'éditeur de la tranche 3. Le détail et la raison de chacun sont
dans le tableau de la tâche 6.

---

## Contraintes globales

Elles s'appliquent implicitement à chaque tâche ; aucune n'est négociable.

- **`npm run check:host` doit descendre à 28, jamais monter.** Chaque fichier
  converti sort de `RESTANTS` dans `scripts/check-host.mjs` **dans le même
  commit** que sa conversion : l'assertion 2 échoue sinon.
- **`npm run check:dashboard-dom` : sa liste `LIBERES` ne peut que GRANDIR.**
  Les fichiers de `src/dashboard/` libérés ici (`ui-select.ts`,
  `icon-picker.ts`, `folder-create.ts`, `module-edit.ts`) s'y ajoutent.
  `src/modal-base.ts` n'y va pas : ce contrôle ne couvre que `src/dashboard/`.
- **Jamais de chaîne visible en dur** : tout par `t("<domaine>.<clé>")`, appelé
  AU RENDU (jamais dans une constante de haut niveau). **Vérifier qu'une clé
  n'existe pas déjà avant d'en créer une.** Cette tranche ne devrait avoir
  besoin d'AUCUNE clé neuve — elle déplace du code existant, elle n'invente pas
  d'écran. Si tu crois en avoir besoin, c'est probablement que tu as changé un
  comportement.
- **Ne jamais traduire** les valeurs persistées : clés du format quiz, types de
  question, `mode: "exam"`, identifiants de commande, noms de réglages, dates
  `AAAA-MM-JJ`, grades du journal.
- **`src/dom.ts` (`ajouter`) est le seul constructeur d'éléments** hors des
  fichiers qui importent encore Obsidian.
- **Icônes Lucide via `host.ui.setIcon`, jamais d'emoji.**
- **`PLUGIN_ID` et `QUIZ_BLOCK_LANGUAGE` valent `quiz-blocks` et ne changent
  pas.** `resultsDir` côté Obsidian reste `.obsidian/quiz-blocks-results`.
- **Commentaires en français, documentant le POURQUOI**, jamais le QUOI.
- **Modules visés sous ~350 lignes.** `ui-select.ts` (1571) est une exception
  déjà assumée par `CLAUDE.md` : ne pas le découper dans cette tranche, ce
  serait mêler un refactor à une conversion et rendre la revue impossible.
- **Commits directs sur `main`**, jamais de branche ni de worktree, jamais de
  push.
- **Après chaque écriture de fichier**, `grep -n 'Ă\|Â\|â€' <fichier>` : le
  dépôt a déjà été pollué par un mauvais encodage.
- **Les scripts de vérification appellent `process.exitCode`, jamais
  `process.exit()`** : la pile doit se dérouler.

## La méthode, et l'avertissement qui la justifie

Le code dicté « verbatim » par les plans de ce projet s'est révélé **fautif
dix-huit fois** sur les tranches 2 et 2.5. Les extraits ci-dessous sont des
ARGUMENTS, pas des autorités. Trois méthodes ont attrapé la quasi-totalité de
ces défauts :

1. **L'épreuve de DISCRIMINANCE.** Pour chaque cas de test : casser la règle
   qu'il garde, LANCER, voir l'assertion rougir, restaurer, revoir vert. Un cas
   qui reste vert quand on casse sa règle ne garde rien. Deux cas écrits dans
   le plan de la tranche 2 étaient exactement ça.
2. **Juger un script sur son CODE DE SORTIE.** `npm run <x>; echo "EXIT=$?"` sur
   UNE SEULE LIGNE, sans pipe. Un `| tail` rend le statut de `tail`, pas celui
   du script. Un groupe vert peut suivre trois groupes rouges.
3. **`npm run check:app` pour tout code de `src/` destiné à l'application.**
   `npm run check` (typecheck) ne voit QUE le greffon, avec `obsidian.d.ts`
   chargé : une extension DOM oubliée y compile sans un mot. `check:app`
   compile le code partagé tel que la fenêtre le verra. **Un fichier converti
   sans `check:app` vert n'est pas converti.**

---

## La recette de conversion, une fois pour toutes

Trois des cinq tâches font le même geste sur des fichiers différents. C'est
la recette de la tranche 2.5, appliquée sept fois avec succès. **Chaque tâche
qui convertit un fichier reçoit cette section dans son brief.**

### 1. L'import d'Obsidian disparaît

```ts
import { setIcon } from "obsidian";             // AVANT
import { currentHost } from "../host/current";  // APRÈS
```

et chaque `setIcon(el, "nom")` devient `currentHost().ui.setIcon(el, "nom")`.

`currentHost()` **jette** si aucun hôte n'est installé — c'est voulu, et
préférable à un `?.` qui rendrait la fonctionnalité silencieusement inerte.

Si le fichier importe `Notice`, l'équivalent est `currentHost().ui.notice(msg)`.
**`folder-create.ts` et `module-edit.ts` en importent** ; `ui-select.ts` et
`icon-picker.ts` non. Vérifie plutôt que de supposer.

Attention au chemin relatif : depuis `src/dashboard/`, c'est
`"../host/current"` ; depuis `src/` (pour `modal-base.ts`), c'est
`"./host/current"`.

### 2. Les extensions DOM deviennent `ajouter`

`ajouter` (`src/dom.ts`) a la signature :

```ts
ajouter<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement, tag: K, cls?: string, texte?: string,
): HTMLElementTagNameMap[K]
```

Les quatre formes rencontrées, et leur traduction :

```ts
// 1. un div avec une classe — la forme la plus fréquente (51 sur 127 dans ui-select)
el.createDiv({ cls: "qbd-select-menu" })
ajouter(el, "div", "qbd-select-menu")

// 2. un élément typé, classe et texte
el.createEl("p", { cls: "qbd-stat-label", text: card.label })
ajouter(el, "p", "qbd-stat-label", card.label)

// 3. un span sans classe, juste du texte (46 sur 127 dans ui-select)
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
fenêtre — une fenêtre d'application de bureau, pas un onglet. Le HTML d'un quiz
a ses propres portes (`src/engine/sanitizer.ts`) et ne passe jamais par ici.

Les autres extensions :

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
(assertion 2 : une entrée qui n'importe plus rien doit être retirée, sans quoi
la liste devient un tapis sous lequel on balaie).

Si le fichier est sous `src/dashboard/`, ajoute-le à `LIBERES` dans
`scripts/check-dashboard-dom.mjs` **dans le même commit**.

### 4. Le piège, et c'est celui qui compte

`npm run check:host` n'attrape les extensions DOM **que dans les fichiers qui
n'importent plus Obsidian** (assertion 4). Les deux moitiés du geste sont donc
liées : retirer l'import SANS convertir les extensions fait rougir le contrôle
(résultat voulu), mais convertir les extensions sans retirer l'import ne fait
rien rougir du tout, et le fichier reste inutilisable dans la fenêtre.

**Fais toujours les deux dans le même mouvement, et termine par
`npm run check:host; echo "EXIT=$?"`.**

---

## Structure des fichiers

**Créés :**

- `apps/windows/src/host/modal.ts` — l'implémentation `HostModals` de la
  fenêtre : le panneau, le fond, la fermeture par Échap et par clic dehors.
- `apps/windows/src/assets/modal.css` — ce qu'Obsidian donnait gratuitement et
  que le CSS partagé n'a jamais défini (voir tâche 1, le point le plus risqué
  de la tranche).

**Modifiés :**

- `src/host/types.ts` — sous-contrat `HostModals`, plus `iconNames()` sur
  `HostUi`.
- `apps/obsidian/host.ts` — l'implémentation Obsidian des deux ajouts.
- `apps/windows/src/host/index.ts` et `ui.ts` — câblage.
- `src/dashboard/ui-select.ts`, `src/dashboard/icon-picker.ts`,
  `src/editor/utils.ts`, `src/dashboard/folder-create.ts`,
  `src/dashboard/module-edit.ts` — les conversions.
- `src/types/dashboard-ctx.ts` — un septième membre optionnel,
  `openQuizPath?` (tâche 5).
- `src/dashboard.ts` — le greffon passe par le contrat comme l'application.
- `apps/windows/src/ui/dashboard-shell.ts` — les trois membres du `ctx` que
  l'application peut honorer.
- `scripts/check-host.mjs`, `scripts/check-dashboard-dom.mjs`,
  `scripts/check-obsidian-host.mjs`, `scripts/check-windows-host.mjs`.

**Non touchés, et c'est délibéré :** `src/dashboard/quiz-menu.ts`,
`src/dashboard/share.ts`, `src/dashboard/usage-modal.ts` (voir « Le périmètre »
ci-dessus).

---

## Tâche 1 — Le sous-contrat `HostModal`

C'est la seule pièce neuve de la tranche, et celle qui porte le risque le plus
sournois : **un panneau sans style ne produit aucune erreur**, seulement une
boîte illisible au milieu de l'écran. Aucun script ne peut le dire.

**Fichiers :**
- Modifier : `src/host/types.ts`
- Modifier : `apps/obsidian/host.ts`
- Créer : `apps/windows/src/host/modal.ts`
- Créer : `apps/windows/src/assets/modal.css`
- Modifier : `apps/windows/src/host/index.ts`, `apps/windows/src/main.ts`
  (import du CSS), `apps/windows/src/host/ui.ts` (`iconNames`)
- Modifier : `scripts/check-obsidian-host.mjs`, `scripts/check-windows-host.mjs`

**Interfaces :**
- Consomme : `Host` (`src/host/types.ts`), `currentHost()`.
- Produit : `HostModals.open(spec) => HostModalHandle`, et
  `HostUi.iconNames(): string[]`. Les tâches 2 à 4 en dépendent.

### La surface à couvrir, mesurée et non supposée

Les huit sous-classes de `QbdModal` du dépôt n'emploient de `Modal` d'Obsidian
que **six choses**, toujours les mêmes :

```
this.modalEl.addClass("qbd-xxx-modal")   // une classe sur le panneau
this.titleEl.setText(...)                // un titre
this.contentEl                           // le corps
onOpen() / onClose()                     // le cycle de vie
.open() / .close()                       // le pilotage
constructor(app)                         // l'ancrage
```

Vérifié sur `folder-create.ts:50-93`, `module-edit.ts:99-297`,
`usage-modal.ts:61-105`, `share.ts:367-424`. **Une septième chose existe et il
ne faut pas la manquer** : `module-edit.ts:118` et `:202` passent
`this.modalEl` comme PARENT DE PORTAIL à `openIconPicker` et à un dropdown —
le commentaire sur place explique pourquoi (« Portalé au MODAL, pas au body :
sinon le focus… »). Le panneau doit donc être exposé.

- [ ] **Étape 1 : écrire le contrat dans `src/host/types.ts`**

À ajouter avant `export interface Host`. Le style des commentaires suit celui
du fichier (le POURQUOI, jamais le QUOI).

```ts
/** Ce qu'une modale ouverte rend à son ouvreur. */
export interface HostModalHandle {
	/** LE PANNEAU. Exposé parce qu'un menu ouvert depuis une modale doit s'y
	    portaler et non au `body` : portalé au body, il passe DERRIÈRE le
	    panneau et le focus retourne au fond (module-edit.ts:118 et :202). */
	readonly panelEl: HTMLElement;
	/** Le corps, où l'appelant construit son contenu. L'hôte le vide à la
	    fermeture : aucun appelant n'a à le faire. */
	readonly contentEl: HTMLElement;
	setTitle(text: string): void;
	close(): void;
}

export interface HostModalSpec {
	/** Classe posée sur le PANNEAU (« qbd-create-modal », « qbd-medit-modal »).
	    Le CSS partagé la cible déjà ; l'hôte ne la choisit pas. */
	className?: string;
	title?: string;
	/** Construit le contenu. Appelé une fois, après attachement — un appelant
	    qui mesure un élément doit pouvoir le faire ici. */
	onOpen(handle: HostModalHandle): void;
	/** Appelé APRÈS la disparition, jamais avant : `module-edit.ts` y écrit
	    ses changements sur le disque, et le faire pendant l'animation
	    rendrait l'écriture concurrente d'un rendu. */
	onClose?(): void;
}

export interface HostModals {
	/** Ouvre une modale. Elle est modale au sens strict : Échap et un clic sur
	    le fond la ferment, et l'hôte rend le focus à ce qui l'avait. */
	open(spec: HostModalSpec): HostModalHandle;
}
```

puis, dans `HostUi`, à la suite de `setIcon` :

```ts
	/** Tous les noms d'icônes disponibles, en KEBAB-CASE (« chevron-down »),
	    la forme que le contrat emploie partout. Le sélecteur d'icônes les
	    liste ; l'ordre n'a pas d'importance, il trie lui-même. */
	iconNames(): string[];
```

et enfin, dans `export interface Host`, une ligne : `modals: HostModals;`

- [ ] **Étape 2 : vérifier que ça rougit AVANT d'implémenter**

`npm run check; echo "EXIT=$?"` puis `npm run check:app; echo "EXIT=$?"`.

Attendu : **les deux ÉCHOUENT**, parce que les deux implémentations d'hôte ne
fournissent ni `modals` ni `iconNames`. C'est l'épreuve de discriminance du
contrat lui-même : si l'un des deux passe au vert, c'est que le type `Host`
n'est pas celui que les hôtes implémentent, et il faut comprendre pourquoi
avant de continuer.

- [ ] **Étape 3 : l'implémentation Obsidian**

Dans `apps/obsidian/host.ts`. Elle a le droit d'importer Obsidian, et elle doit
réutiliser `QbdModal` (`src/modal-base.ts`) pour garder l'animation
d'entrée/sortie que le greffon a aujourd'hui — la perdre serait une régression
visible.

```ts
// `QbdModal` porte déjà l'animation d'entrée et de sortie (src/modal-base.ts) :
// l'hôte s'appuie dessus plutôt que de la refaire, sinon les modales du
// greffon s'ouvriraient sèchement là où elles glissent aujourd'hui.
class HoteModal extends QbdModal {
	constructor(app: App, private spec: HostModalSpec) { super(app); }
	onOpen(): void {
		if (this.spec.className) this.modalEl.addClass(this.spec.className);
		if (this.spec.title) this.titleEl.setText(this.spec.title);
		this.spec.onOpen({
			panelEl: this.modalEl,
			contentEl: this.contentEl,
			setTitle: (s) => this.titleEl.setText(s),
			close: () => this.close(),
		});
	}
	onClose(): void {
		this.spec.onClose?.();
		this.contentEl.empty();
	}
}
```

**À vérifier plutôt qu'à croire** : `QbdModal.close()` joue l'animation PUIS
appelle `super.close()`, qui détache le DOM ET appelle `onClose()`. Confirme en
lisant `src/modal-base.ts` que `onClose` n'est donc appelé qu'APRÈS la
disparition — c'est ce que le contrat promet, et `module-edit.ts` en dépend
pour son écriture différée.

- [ ] **Étape 4 : `iconNames` côté Obsidian**

```ts
// getIconIds() rend « lucide-x » ; le contrat veut « x ». Le préfixe est retiré
// ICI et nulle part ailleurs, pour que le code partagé n'ait jamais à savoir
// quel hôte le lui a donné (icon-picker.ts:36 le faisait lui-même avant).
iconNames: () => getIconIds().map(id => id.replace(/^lucide-/, "")),
```

- [ ] **Étape 5 : l'implémentation de la fenêtre — `apps/windows/src/host/modal.ts`**

Elle doit reproduire la STRUCTURE DOM d'Obsidian, parce que le CSS partagé la
cible par ses noms de classes (`modal-anim.css` cible
`.modal.qbd-anim-modal`, et `.modal-container:has(> .modal…) .modal-bg`).

Structure exigée, du dehors vers le dedans :

```
div.modal-container            (posé sur document.body)
  div.modal-bg                 (le fond ; clic = fermeture)
  div.modal.qbd-anim-modal     (le panneau ; + spec.className)
    div.modal-close-button     (la croix)
    div.modal-title            (le titre)
    div.modal-content          (le corps → contentEl)
```

Points de conduite, chacun pour une raison :

- `qbd-anim-modal` sur le panneau et `qbd-closing` sur le panneau ET le
  conteneur à la fermeture, avec un `animationend` doublé d'un `setTimeout(240)`
  de sécurité : c'est exactement ce que fait `src/modal-base.ts`, pour la même
  raison (une animation coupée ou un onglet masqué ne déclenche pas
  `animationend`, et la modale ne se détacherait jamais).
- Respecter `prefers-reduced-motion: reduce` : détachement immédiat, sans
  animation. `src/modal-base.ts:31` le fait déjà, ne le perds pas.
- Fermeture **idempotente** : Échap et le clic sur le fond peuvent tomber
  quasi ensemble (le commentaire de `modal-base.ts` le dit).
- Le `keydown` d'Échap s'écoute sur `document` et **se retire au
  détachement**, sinon chaque modale ouverte laisse un écouteur derrière elle.
- Rendre le focus à `document.activeElement` mémorisé à l'ouverture.

- [ ] **Étape 6 : `apps/windows/src/assets/modal.css` — LE point risqué**

Le CSS partagé (`src/assets/css/components/modal-anim.css`) n'anime que le
panneau. Il ne le DESSINE pas : `.modal`, `.modal-bg`, `.modal-container`,
`.modal-content`, `.modal-title` et `.modal-close-button` sont des classes
**d'Obsidian**, que le greffon héritait gratuitement et qu'aucun fichier du
dépôt ne définit. Grep pour t'en convaincre :

```bash
grep -rn '^\.modal\b\|^\.modal-bg\|^\.modal-container' src/assets/css/; echo "EXIT=$?"
```

Il faut donc les écrire : centrage du conteneur, fond semi-opaque, panneau avec
sa largeur maximale, son fond, son rayon et son ombre, corps défilant quand il
déborde, titre, croix. **Employer les variables du thème**
(`apps/windows/src/theme/host-vars.css`), jamais des couleurs en dur : c'est ce
que `npm run check:theme` garde, et une couleur en dur y échapperait tout en
cassant le jour où le thème clair arrivera.

Importer le fichier dans `apps/windows/src/main.ts`. **L'ordre compte** — le
commentaire de `main.ts:29` l'explique : `host-vars.css` doit précéder, et les
feuilles propres à l'application viennent après le CSS partagé.

- [ ] **Étape 7 : les deux contrôles d'hôte**

Ajouter dans `scripts/check-obsidian-host.mjs` et
`scripts/check-windows-host.mjs` les cas suivants. **Chacun s'éprouve par
DISCRIMINANCE** : casse la règle, lance, vois rougir, restaure, revois vert.

| Cas | Règle gardée | Comment la casser pour l'éprouver |
|---|---|---|
| `open` rend un handle dont `panelEl` porte `spec.className` | le CSS partagé cible cette classe | ne pas poser la classe |
| `close()` deux fois de suite ne jette pas et ne détache qu'une fois | Échap + clic simultanés | retirer la garde d'idempotence |
| `onClose` est appelé APRÈS le détachement du panneau | l'écriture différée de `module-edit.ts` | l'appeler avant |
| `contentEl` est vidé à la fermeture | une réouverture empilerait deux corps | ne pas vider |
| `iconNames()` rend des noms SANS préfixe `lucide-` | `icon-picker.ts` compare des noms nus | laisser le préfixe |
| `iconNames()` contient « chevron-down » | une conversion de casse ratée rendrait une liste non vide mais fausse | rendre `Object.keys(icons)` sans conversion |

Le dernier mérite un mot : `Object.keys(icons)` du paquet `lucide` rend du
PascalCase (« ChevronDown »). Un cas qui vérifie seulement que la liste n'est
pas vide resterait VERT avec la mauvaise casse — c'est précisément le genre de
cas qui ne garde rien. Vérifie une valeur nommée.

- [ ] **Étape 8 : les contrôles, un par ligne, sur leur code de sortie**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:obsidian-host; echo "EXIT=$?"
npm run check:windows-host; echo "EXIT=$?"
npm run check:theme; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"
```

Attendu : `EXIT=0` partout. `check:host` annonce toujours **33** — aucun
fichier n'a encore été converti par cette tâche.

- [ ] **Étape 9 : commit**

```bash
git add src/host/types.ts apps/obsidian/host.ts apps/windows/src/host/modal.ts apps/windows/src/host/index.ts apps/windows/src/host/ui.ts apps/windows/src/assets/modal.css apps/windows/src/main.ts scripts/check-obsidian-host.mjs scripts/check-windows-host.mjs
git commit -m "feat(host): un sous-contrat HostModal et la liste des icones"
```

---

## Tâche 2 — `ui-select.ts` : la conversion

Le plus gros morceau de la tranche, seul dans sa tâche parce qu'une revue de
127 remplacements mêlés à autre chose ne serait pas une revue.

**Fichiers :**
- Modifier : `src/dashboard/ui-select.ts` (127 extensions DOM, 15 `setIcon`)
- Modifier : `scripts/check-host.mjs` (`RESTANTS` perd l'entrée)
- Modifier : `scripts/check-dashboard-dom.mjs` (`LIBERES` la gagne)

**Interfaces :**
- Consomme : `currentHost()`, `ajouter` (`src/dom.ts`).
- Produit : **toutes les signatures exportées restent identiques**, sauf
  `OpenNotePickerOptions` (voir ci-dessous). `createSelect`, `openActionMenu`,
  `openModelMenu`, `openEffortSlider`, `openOptionsMenu`, `openMentionMenu`,
  `closeAllSelects` ne changent pas. `ai.ts` (tranche 4) les appelle et ne doit
  rien avoir à changer.

### Le seul changement de signature, et pourquoi il est nécessaire

`ui-select.ts` importe `TFile` **uniquement** pour `openNotePicker`
(lignes 1295-1352). Le remplacer par `HostFile` casserait `ai.ts:1486` et
`:1760`, qui lui passent de vrais `TFile` venus de
`ctx.app.vault.getMarkdownFiles()` — et `ai.ts` ne peut pas les convertir :
`CLAUDE.md` réserve la conversion `TFile → HostFile` à `apps/obsidian/host.ts`,
« le seul endroit du dépôt » où elle a le droit d'exister.

La sortie est de rendre le picker GÉNÉRIQUE. Il n'a besoin que de deux champs,
vérifié en lisant les lignes 1333-1356 : `basename` (l'étiquette) et `path`
(la recherche, la déduplication et le dossier affiché).

```ts
/** Ce que le picker demande d'un fichier, et rien de plus. Générique plutôt
    que `HostFile` : `onPick` rend à l'appelant l'objet QU'IL a fourni, donc
    `ai.ts` continue de recevoir ses `TFile` et de les passer à
    `vault.process`. Convertir ici violerait la règle du dépôt — seul
    `apps/obsidian/host.ts` change un `TFile` en `HostFile`. */
export interface PickableFile { path: string; basename: string; }

export interface OpenNotePickerOptions<F extends PickableFile = PickableFile> {
	openFiles?: F[];
	allFiles?: F[];
	onPick?: (file: F) => void;
}

export function openNotePicker<F extends PickableFile>(
	anchorEl: HTMLElement, opts: OpenNotePickerOptions<F>,
): MenuHandle { /* … */ }
```

Un troisième champ est employé à la ligne ~1334 : `file.parent.path`, pour le
sous-titre de dossier. `HostFile` n'a pas de `parent`. Le dériver du chemin
donne le même résultat des deux côtés :

```ts
// Dérivé du chemin plutôt que lu sur `parent` : un HostFile n'a pas de parent,
// et à la racine `TFile.parent.path` vaut "/", que l'ancien code excluait déjà
// — la chaîne vide produit exactement le même affichage.
const i = file.path.lastIndexOf("/");
const folder = i > 0 ? file.path.slice(0, i) : "";
```

**Vérifie cette équivalence dans le code réel avant de la croire** : lis les
lignes autour de 1334 et confirme que `parent.path === "/"` était bien le seul
cas exclu. Une ligne de plan a déjà été fausse sur exactement ce genre de
détail.

- [ ] **Étape 1 : convertir les 15 `setIcon`**

Remplace l'import `import { setIcon } from "obsidian";` par
`import { currentHost } from "../host/current";`, et chaque appel par
`currentHost().ui.setIcon(...)`.

Lignes concernées, à confirmer par grep plutôt qu'à recopier : 94, 157, 276,
429, 439, 501, 516, 566, 853, 1137, 1167, 1225, 1331, 1482.

```bash
grep -n 'setIcon' src/dashboard/ui-select.ts; echo "EXIT=$?"
```

Attendu après conversion : aucune occurrence de `setIcon(` non préfixée par
`currentHost().ui.`.

- [ ] **Étape 2 : rendre `openNotePicker` générique**

Applique le bloc ci-dessus, et retire `import type { TFile } from "obsidian";`.

- [ ] **Étape 3 : convertir les 127 extensions DOM**

Applique la recette. Après la conversion, compte :

```bash
node -e "const s=require('fs').readFileSync('src/dashboard/ui-select.ts','utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');console.log((s.match(/\.(createEl|createDiv|createSpan|empty|setText|addClass|removeClass|toggleClass|detach|appendText|setAttr)\s*\(/g)||[]).length)"
```

Attendu : `0`.

- [ ] **Étape 4 : retirer le fichier de `RESTANTS`, l'ajouter à `LIBERES`**

`scripts/check-host.mjs` : supprimer la ligne `"src/dashboard/ui-select.ts",`.
`scripts/check-dashboard-dom.mjs` : ajouter `"src/dashboard/ui-select.ts",` à
`LIBERES`.

- [ ] **Étape 5 : les contrôles**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"
npm run check:dashboard-dom; echo "EXIT=$?"
```

`check:host` doit maintenant annoncer **32**. `check:app` est celui qui compte :
il compile sans `obsidian.d.ts`, donc une extension DOM oubliée y devient une
erreur de type. **Un `EXIT=0` sur `check` seul ne prouve rien ici.**

- [ ] **Étape 6 : l'épreuve de discriminance du contrôle lui-même**

Réintroduis volontairement UNE extension DOM (par exemple
`el.createDiv({cls:"x"})`) dans `ui-select.ts`, lance
`npm run check:host; echo "EXIT=$?"`, **vois-le rougir**, puis restaure et
revois vert. Si le contrôle reste vert avec l'extension réintroduite, c'est que
le fichier n'est pas sorti de `RESTANTS` et que rien n'est gardé.

- [ ] **Étape 7 : commit**

```bash
git add src/dashboard/ui-select.ts scripts/check-host.mjs scripts/check-dashboard-dom.mjs
git commit -m "refactor(ui-select): le dropdown passe par le contrat d'hote"
```

---

## Tâche 3 — `icon-picker.ts`

**Fichiers :**
- Modifier : `src/dashboard/icon-picker.ts` (11 extensions DOM, `getIconIds`,
  `setIcon`)
- Modifier : `scripts/check-host.mjs`, `scripts/check-dashboard-dom.mjs`

**Interfaces :**
- Consomme : `currentHost().ui.iconNames()` et `.setIcon()` (tâche 1).
- Produit : `openIconPicker(anchorEl, current, onChange, container?, suggestions?)
  => IconPickerHandle` — **signature inchangée**. `src/dashboard.ts:237` et
  `module-edit.ts:118` l'appellent ainsi.

- [ ] **Étape 1 : remplacer `getIconIds`**

Ligne 36 aujourd'hui :

```ts
for (const id of getIconIds()) seen.add(id.replace(/^lucide-/, ""));
```

devient :

```ts
// Le retrait du préfixe « lucide- » a déménagé dans l'hôte Obsidian : le
// contrat promet des noms nus, et l'application n'a jamais eu de préfixe à
// retirer.
for (const id of currentHost().ui.iconNames()) seen.add(id);
```

- [ ] **Étape 2 : les `setIcon` et les 11 extensions DOM**

Applique la recette.

- [ ] **Étape 3 : les listes**

Retirer de `RESTANTS`, ajouter à `LIBERES`.

- [ ] **Étape 4 : les contrôles**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"
npm run check:dashboard-dom; echo "EXIT=$?"
```

`check:host` annonce **31**.

- [ ] **Étape 5 : commit**

```bash
git add src/dashboard/icon-picker.ts scripts/check-host.mjs scripts/check-dashboard-dom.mjs
git commit -m "refactor(icon-picker): les noms d'icones viennent du contrat"
```

---

## Tâche 4 — `editor/utils.ts`, pour lever le premier blocage

Petite tâche, et c'est voulu : elle vaut par ce qu'elle DÉBLOQUE, pas par sa
taille. Sans elle, la tâche 5 convertit `folder-create.ts` en apparence et
l'application refuse de se construire à la tâche 6.

**Fichiers :**
- Modifier : `src/editor/utils.ts` (1 extension DOM, 2 lignes `setIcon`)
- Modifier : `scripts/check-host.mjs` (`RESTANTS` perd l'entrée)

`scripts/check-dashboard-dom.mjs` ne le concerne PAS : sa liste `LIBERES` ne
couvre que `src/dashboard/`. Ne l'y ajoute pas.

**Interfaces :**
- Consomme : `currentHost().ui.setIcon`, `ajouter`.
- Produit : `_setIcon`, `_iconSpan`, `makeDefault`, `Q_TYPES`, `defaultSlots`,
  `md2html`, `escHtml`, `esc5`, `loadReact` — **exportés inchangés**
  (ligne 221). Cinq fichiers les importent, dont quatre restent liés à Obsidian
  (`editor-form.ts`, `editor/modals.ts`, `question-preview.ts`,
  `detail-form-bridge.ts`) : c'est sans danger, un fichier lié a le droit
  d'importer un fichier libre. L'inverse serait le problème.

- [ ] **Étape 1 : les deux lignes**

Lignes 45-46 aujourd'hui :

```ts
function _setIcon(el: HTMLElement, name: string): void { try { setIcon(el, name); } catch (_) { /* noop */ } }
function _iconSpan(parent: HTMLElement, name: string, cls?: string): HTMLSpanElement { const s = parent.createSpan({ cls: cls || "qb-icon" }); _setIcon(s, name); return s; }
```

deviennent :

```ts
function _setIcon(el: HTMLElement, name: string): void { try { currentHost().ui.setIcon(el, name); } catch (_) { /* noop */ } }
function _iconSpan(parent: HTMLElement, name: string, cls?: string): HTMLSpanElement { const s = ajouter(parent, "span", cls || "qb-icon"); _setIcon(s, name); return s; }
```

**Le `try/catch` reste.** Il ne protège plus de la même chose (`currentHost()`
jette quand aucun hôte n'est installé, là où `setIcon` jetait sur un nom
inconnu), mais le retirer changerait le comportement de six appelants dans une
tâche qui n'est pas là pour ça.

Remplace l'import `import { setIcon } from "obsidian";` par les deux imports
`currentHost` (`"../host/current"`) et `ajouter` (`"../dom"`). **Vérifie les
chemins relatifs depuis `src/editor/`** plutôt que de les recopier.

- [ ] **Étape 2 : retirer de `RESTANTS`, puis contrôler**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"
npm run check:export; echo "EXIT=$?"
npm run check:md; echo "EXIT=$?"
```

`check:host` annonce **30**. `check:export` et `check:md` chargent le CODE RÉEL
de la chaîne d'écriture et de rendu, qui passe par `makeDefault` et `md2html` :
ce sont eux qui diraient qu'une conversion a changé un comportement.

- [ ] **Étape 3 : commit**

```bash
git add src/editor/utils.ts scripts/check-host.mjs
git commit -m "refactor(editor): les helpers d'icone passent par le contrat"
```

---

## Tâche 5 — Les deux modales de création passent par `HostModal`

**Fichiers :**
- Modifier : `src/dashboard/folder-create.ts` (12 extensions, `Modal`,
  `Notice`, `setIcon`)
- Modifier : `src/dashboard/module-edit.ts` (28 extensions, `Notice`,
  `setIcon`)
- Modifier : `src/types/dashboard-ctx.ts` (le membre `openQuizPath?`)
- Modifier : `src/dashboard.ts` (les sites d'appel)
- Modifier : `scripts/check-host.mjs`, `scripts/check-dashboard-dom.mjs`

`src/modal-base.ts` n'est PAS modifié et ne quitte PAS `RESTANTS`.

**Interfaces :**
- Consomme : `currentHost().modals.open(spec)` (tâche 1),
  `openIconPicker` (tâche 3), `createSelect` (tâche 2).
- Produit : quatre fonctions d'ouverture, en remplacement des quatre classes.
  La tâche 5 les appelle depuis l'application.

```ts
export function openCreateFolderModal(ctx: DashboardShellCtx, map: ModuleMap, quizzes: QuizIndexEntry[], onDone: () => void): void
export function openCreateQuizModal(ctx: DashboardShellCtx, folder: string, onDone: () => void): void
export function openModuleEditModal(ctx: DashboardShellCtx, group: ModuleGroup, map: ModuleMap, onDone: () => void): void
export function openNewFolderModal(ctx: DashboardShellCtx, map: ModuleMap, quizzes: QuizIndexEntry[], onDone: () => void): void
```

**Vérifie les paramètres réels avant d'écrire ces signatures** : lis les quatre
constructeurs (`folder-create.ts:40`, `:71`, `module-edit.ts:55`, `:247`) et
recopie leurs paramètres exacts. Les noms ci-dessus sont un ARGUMENT sur la
forme, pas une mesure de leur contenu.

### Trois points qui ne sont pas évidents

**1. `src/modal-base.ts` ne quitte pas `RESTANTS`**, et il ne faut pas essayer
de l'y forcer. Cinq sous-classes de `QbdModal` restent hors périmètre :
`quiz-menu.ts` (`ConfirmModal`, `RenameQuizModal`), `share.ts` (`ShareModal`),
`usage-modal.ts` (`UsageModal`), `editor/modals.ts` (`ConfirmModal`,
`TypePickerModal`). `QbdModal` doit continuer d'exister pour elles jusqu'aux
tranches 3 et 4. Les deux mondes coexistent sans danger : l'hôte Obsidian de
`HostModals` s'appuie lui-même sur `QbdModal` (tâche 1, étape 3), donc les
modales converties et les non converties s'animent exactement pareil.

**2. Le `ctx` s'élargit de `DashboardCtx` à `DashboardShellCtx`, et c'est ce
qui force le vrai travail.** Retirer les imports `Modal`/`Notice`/`setIcon`
suffit à faire taire `check:host` — mais les deux fichiers atteignent encore
Obsidian par `ctx.app.vault.*`, dont le TYPE vient de `DashboardCtx`. Le fichier
sortirait de `RESTANTS`, aurait l'air propre, et planterait dans la fenêtre où
`ctx.app` n'existe pas.

Élargir le paramètre à `DashboardShellCtx` (qui n'a pas de `app`) rend ces
appels impossibles à compiler, donc visibles. La traduction :

| Aujourd'hui | Demain | Attention |
|---|---|---|
| `ctx.app.vault.create(p, c)` | `currentHost().fs.write(p, c)` | déjà `await` |
| `ctx.app.vault.createFolder(p)` | `currentHost().fs.mkdirs(p)` | `mkdirs` ne rejette PAS si le dossier existe : le test d'existence qui le précède (ligne 175) devient inutile, supprime-le |
| `ctx.app.vault.getAbstractFileByPath(p)` sur une NOTE (lignes 169) | `currentHost().fs.getFile(p)` | **synchrone**, index `.md` en mémoire — c'est ce qui permet à `freeNotePath` de rester synchrone, et donc à ses trois appelants (184, 204, 211) de ne pas changer |
| `ctx.app.vault.getAbstractFileByPath(p)` sur un DOSSIER (lignes 134, 175) | `await currentHost().fs.exists(p)` | **asynchrone** : `getFile` ne voit que les `.md`, un dossier n'y est pas. Les deux sites sont déjà dans des fonctions `async` |

**Cette distinction note/dossier est le piège de la tâche.** Employer `getFile`
sur un chemin de dossier rendrait toujours `null`, donc « le dossier n'existe
pas », donc une boucle de dédoublonnage qui ne dédoublonne rien (ligne 134) —
et deux dossiers du même nom, en silence. **Vérifie chaque site sur le code réel
avant de choisir**, ce tableau est un argument, pas un relevé exhaustif.

**3. `folder-create.ts:186` ouvre l'éditeur, et l'application n'en a pas.**
`openQuizPathInEditor` vient de `quiz-open.ts`, qui emploie `WorkspaceLeaf` et
reste du greffon. Il passe donc par le `ctx`, comme les six membres optionnels
déjà en place. À ajouter dans `src/types/dashboard-ctx.ts`, à la suite des
autres :

```ts
	/** Ouvre la note d'un quiz, éventuellement en édition. Optionnel et ABSENT
	    côté application jusqu'à la tranche 3 : ouvrir un quiz vierge qu'on ne
	    peut pas éditer n'est pas une fonctionnalité, c'est une impasse.
	    L'appelant garde donc son appel optionnel (`?.`) plutôt que de tester
	    l'hôte. */
	openQuizPath?: (path: string, opts?: { edit?: boolean }) => Promise<void>;
```

et la ligne 186 devient `await ctx.openQuizPath?.(path, { edit: true });`.

- [ ] **Étape 1 : `folder-create.ts` — de la classe à la fonction**

Le patron, pour `CreateFolderModal` (lignes 40-68). Lis-le en entier avant de
le transposer.

```ts
export function openCreateFolderModal(
	ctx: DashboardShellCtx, map: ModuleMap, quizzes: QuizIndexEntry[], onDone: () => void,
): void {
	currentHost().modals.open({
		className: "qbd-create-modal",
		// t() AU RENDU, jamais dans une constante de haut niveau : une chaîne
		// figée à l'assemblage ignorerait un changement de langue.
		title: t("dashboard.quizzes.createFolderTitle"),
		onOpen: (m) => {
			const c = m.contentEl;
			/* … le corps d'onOpen(), avec `this.close()` devenu `m.close()`
			   et les extensions DOM converties … */
		},
	});
}
```

- [ ] **Étape 2 : `module-edit.ts` — même geste, plus le portail**

`ModuleEditModal` (55-245) et `NewFolderModal` (247-299). **Deux pièges
nommés :**

1. Lignes 118 et 202, `this.modalEl` est passé en parent de portail à
   `openIconPicker` et à un dropdown. Il devient `m.panelEl`. Le passer au
   `body` ferait passer le menu derrière le panneau : le commentaire sur place
   le dit, ne le perds pas en convertissant.
2. `onClose()` (215-221) persiste les changements sur le disque, différés
   exprès (« pas de martèlement I/O pendant le drag »). Il devient
   `onClose: () => { … }` dans le spec. **`m.contentEl.empty()` disparaît** :
   l'hôte vide le corps lui-même (tâche 1, contrat).

- [ ] **Étape 3 : `src/dashboard.ts` — les sites d'appel du greffon**

Lignes 240 et 243 aujourd'hui :

```ts
createQuiz: (folder, done) => { new CreateQuizModal(this.ctx as DashboardCtx, folder, done).open(); },
createFolder: (map, quizzes, done) => { new CreateFolderModal(this.ctx as DashboardCtx, map, quizzes, done).open(); },
```

deviennent des appels aux quatre fonctions, sans `as DashboardCtx` si le
paramètre est bien élargi à `DashboardShellCtx`. **Le greffon passe par le
contrat comme l'application** : deux chemins différents pour la même modale
divergeraient en silence.

Le greffon remplit en plus le nouveau membre, avec le comportement qu'il a
aujourd'hui :

```ts
openQuizPath: (path, opts) => openQuizPathInEditor(this.app, path, opts ?? {}),
```

**Vérifie la signature réelle de `openQuizPathInEditor`** (`quiz-open.ts:44`)
avant de recopier cette ligne.

- [ ] **Étape 4 : les listes et les contrôles**

`folder-create.ts` et `module-edit.ts` sortent de `RESTANTS` et entrent dans
`LIBERES`. `modal-base.ts` reste dans `RESTANTS`.

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"
npm run check:dashboard-dom; echo "EXIT=$?"
npm run check:module-edit; echo "EXIT=$?"
npm run check:folders; echo "EXIT=$?"
```

`check:host` annonce **28**. `check:folders` garde la conversion
`folder` → `folders` et **l'unicité des identifiants de dossier** : c'est le
contrôle le plus proche du piège note/dossier décrit plus haut.

`check:module-edit` existe déjà et garde le comportement d'édition d'un module :
c'est lui qui dira si la conversion a changé quelque chose. **S'il passe au
vert sans que tu aies rien fait pour, éprouve-le** : casse une règle qu'il
prétend garder et vois-le rougir.

- [ ] **Étape 5 : commit**

```bash
git add src/dashboard/folder-create.ts src/dashboard/module-edit.ts src/types/dashboard-ctx.ts src/dashboard.ts scripts/check-host.mjs scripts/check-dashboard-dom.mjs
git commit -m "refactor(modals): la creation de dossier et de quiz passe par HostModal"
```

---

## Tâche 6 — L'application remplit ses membres du `ctx`

**Fichiers :**
- Modifier : `apps/windows/src/ui/dashboard-shell.ts`
- Modifier : `apps/windows/src/main.ts` si le câblage l'exige

**Interfaces :**
- Consomme : tout ce que les tâches 1 à 5 produisent.
- Produit : rien que d'autres tâches consomment. C'est la tâche qui rend le
  travail visible.

Ces membres sont **déjà déclarés** dans `src/types/dashboard-ctx.ts`
(lignes 255-277) et attendent depuis la tranche 2.5. Ne pas inventer un autre
patron : l'hôte fournit, la page consomme sans savoir qui.

Signatures exactes, recopiées du type :

```ts
pickIcon?: (anchor: HTMLElement, courante: string | undefined, onPick: (nom: string) => void, suggestions?: string[]) => void;
createFolder?: (map: ModuleMap, quizzes: QuizIndexEntry[], done: () => void) => void;
renderGroupingSelect?: (
	container: HTMLElement,
	opts: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void },
) => { el: HTMLElement };
```

Le modèle à suivre est `src/dashboard.ts:226-246`, où le greffon les remplit.

- [ ] **Étape 1 : les trois membres que l'application peut honorer**

```ts
pickIcon: (anchor, courante, onPick, suggestions) => {
	openIconPicker(anchor, courante, onPick, document.body, suggestions ?? []);
},
createFolder: (map, quizzes, done) => openCreateFolderModal(ctx, map, quizzes, done),
renderGroupingSelect: (container, opts) => createSelect(container, opts),
```

**Quatre membres restent absents, chacun pour une raison mesurée** — c'est le
périmètre, pas un oubli :

| Membre | Pourquoi absent |
|---|---|
| `openCardMenu`, `openModuleMenu` | trois de leurs quatre entrées écrivent sur le disque ou ouvrent l'éditeur — tranche 3 |
| `createQuiz` | il crée un quiz vierge dont le seul intérêt est d'être édité aussitôt ; sans éditeur, il produit une note à une question vide et n'ouvre rien |
| `openQuizPath` | l'application n'a pas d'éditeur à ouvrir avant la tranche 3 |

`createFolder`, lui, EST utile dès maintenant : il crée un dossier et **importe
une archive `.zip`**, c'est-à-dire le quiz d'un camarade. Aucun éditeur requis.

- [ ] **Étape 2 : la vérification qui ne ment pas**

```bash
npm run check:app; echo "EXIT=$?"
```

C'est ici que se verrait un import transitif d'Obsidian resté dans le bundle de
la fenêtre. C'est exactement le défaut qui a fait valider trois tâches sur une
prémisse fausse en tranche 2.5 : les cartes tiraient Obsidian transitivement
par `ui-select.ts`, et `check:host`, qui ne compte que les imports DIRECTS, ne
pouvait pas le dire.

- [ ] **Étape 3 : la suite complète des contrôles**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"
npm run check:dashboard-dom; echo "EXIT=$?"
npm run check:theme; echo "EXIT=$?"
npm run check:obsidian-host; echo "EXIT=$?"
npm run check:windows-host; echo "EXIT=$?"
npm run check:module-edit; echo "EXIT=$?"
npm run build; echo "EXIT=$?"
```

**Un par ligne, sans pipe.** Un groupe vert peut suivre trois groupes rouges,
et c'est ainsi qu'un défaut est déjà passé dans ce dépôt.

- [ ] **Étape 4 : l'encodage**

```bash
grep -rn 'Ă\|Â\|â€' src/dashboard/ui-select.ts src/dashboard/icon-picker.ts src/dashboard/folder-create.ts src/dashboard/module-edit.ts src/editor/utils.ts src/types/dashboard-ctx.ts src/host/types.ts apps/windows/src/host/modal.ts apps/windows/src/assets/modal.css apps/windows/src/ui/dashboard-shell.ts; echo "EXIT=$?"
```

Attendu : aucune correspondance.

- [ ] **Étape 5 : commit**

```bash
git add apps/windows/src/ui/dashboard-shell.ts
git commit -m "feat(app): le dropdown, le choix d'icone et la creation de dossier"
```

---

## Ce qu'aucun script ne peut prouver

Comme en tranche 2.5, **aucun agent n'a d'affichage**. Ces épreuves se font à
l'écran, `npm run app:dev` d'un côté et Obsidian de l'autre, sur le MÊME
dossier. Par ordre de risque décroissant.

1. **La modale de la fenêtre a une forme.** C'est le point le plus risqué de la
   tranche : `.modal`, `.modal-bg` et `.modal-content` sont des classes
   d'Obsidian que le CSS partagé n'a jamais définies, et une feuille oubliée ne
   produit AUCUNE erreur.
   *Bon* : un panneau centré, fond assombri derrière, largeur bornée, titre
   lisible, corps qui défile s'il déborde, croix en haut à droite.
   *Cassé* : un bloc de texte collé en haut à gauche sur le fond de la fenêtre,
   ou un panneau qui occupe tout l'écran.
2. **Elle s'ouvre et se ferme en glissant**, comme dans le greffon. Échap la
   ferme, un clic sur le fond aussi, un clic DANS le panneau non.
   *Cassé* : apparition sèche (l'animation ne joue pas), ou fermeture
   instantanée sans transition de sortie.
3. **Le dropdown de regroupement au-dessus de « Mes quiz ».** Il change l'axe,
   le choix survit à un redémarrage (réglage `quizzesGrouping`), et le menu
   s'affiche AU-DESSUS du contenu, pas derrière.
4. **« + Nouveau dossier »** produit bien un dossier sur le disque, visible
   ensuite dans Obsidian ouvert sur le même chemin. **Et l'import d'un `.zip`**
   y dépose les notes qu'il contient, avec leur contenu — c'est le chemin qui
   sert à recevoir le quiz d'un camarade, et le seul de la tranche qui ÉCRIVE
   des fichiers. Vérifier qu'un nom déjà pris ne produit pas deux dossiers du
   même nom, mais bien un « (2) » : c'est le piège note/dossier de la tâche 5.
   *Cassé* : deux dossiers homonymes côte à côte, ou une note écrasée en
   silence.
5. **Le sélecteur d'icônes** liste des icônes (pas une grille vide), la
   recherche filtre, la section « Suggérées » apparaît, et l'icône choisie se
   pose sur le module. Ouvert DEPUIS la modale d'édition de module, le menu
   doit s'afficher au-dessus du panneau et non derrière.
6. **Le greffon, inchangé.** Cette tranche touche `src/dashboard.ts`,
   `ui-select.ts` et les deux modales, que tout le tableau de bord d'Obsidian
   emploie. Vérifier : les menus « ⋯ » (non convertis, mais leurs modales
   partagent `QbdModal`), la page « Générer » (elle appelle `createSelect`,
   `openModelMenu`, `openNotePicker` — les trois sont dans le fichier converti),
   et l'édition d'un module.
7. **Les cartes n'ont toujours pas de « ⋯ » dans l'application.** C'est ATTENDU
   après cette tranche. Vérifier seulement que leur absence ne laisse pas un
   trou qui ait l'air d'un bouton manquant.

---

## Ce que cette tranche laisse ouvert

- **`src/modal-base.ts` reste dans `RESTANTS`** (cinq sous-classes hors
  périmètre). Il part avec la tranche 3, une fois `quiz-menu.ts`, `share.ts` et
  `editor/modals.ts` convertis — et avec la tranche 4 pour `usage-modal.ts`.
- **`openCardMenu` / `openModuleMenu` restent absents côté application.** Ils
  demandent trois primitives que `HostFs` n'a pas : `process` (lecture-écriture
  indivisible), une corbeille, et l'écriture binaire pour le `.zip` de partage.
  La tranche 3 les conçoit.
- **`createQuiz` et `openQuizPath` restent absents côté application**, et se
  remplissent tous les deux en tranche 3, le jour où il y a un éditeur à ouvrir.
  Le code partagé, lui, est déjà prêt : `folder-create.ts` appelle
  `ctx.openQuizPath?.()` sans savoir qui le fournit.
- **`HostFs` n'a toujours pas d'équivalent de `vault.process`.** C'est le
  prérequis de toute écriture sûre, et le commentaire de `ai.ts:2058` dit
  pourquoi : avec `read` puis `write`, une modification faite ailleurs entre
  les deux était écrasée, et l'insertion annonçait quand même « Quiz inséré ».
- **Le thème clair** et **l'empaquetage signé** restent hors périmètre, comme
  depuis la tranche 2.
- **`apps/obsidian/host.ts` (457 lignes) et `apps/windows/src/host/fs.ts`
  (466)** dépassent la cible de ~350 et grossissent encore ici. La tranche 3
  écrit des blocs, donc rouvrira `fs.ts` : c'est le moment d'envisager un
  découpage plutôt qu'une cinquième responsabilité.
