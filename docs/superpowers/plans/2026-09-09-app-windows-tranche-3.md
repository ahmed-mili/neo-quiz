# Tranche 3 — L'app édite

> **Pour les agents exécutants :** SOUS-SKILL OBLIGATOIRE — utiliser
> `superpowers:subagent-driven-development` pour exécuter ce plan tâche par
> tâche. Les étapes emploient la syntaxe `- [ ]` pour le suivi.

**Objectif :** rendre l'application capable de MODIFIER un quiz — la page de
quiz en mode édition, l'écriture du bloc, la création et la suppression — pour
qu'Obsidian cesse d'être nécessaire à autre chose que lire ses notes.

**Architecture :** la recette de conversion des tranches 2.5 et 2.6 s'applique à
onze fichiers. Deux choses sont neuves. D'abord quatre primitives de `HostFs`
qu'aucune tranche n'avait eu besoin d'inventer, parce qu'aucune n'écrivait
ailleurs que dans le journal : la lecture-écriture INDIVISIBLE, l'écriture
BINAIRE, la corbeille, et le chemin d'une pièce jointe. Ensuite un geste que ce
chantier n'avait encore jamais fait : deux fichiers de `src/` ne se convertissent
pas, ils DÉMÉNAGENT vers `apps/obsidian/`, parce qu'ils ne décrivent pas un quiz
mais un onglet d'Obsidian.

**Pile :** TypeScript strict ESM, Tauri 2 côté application, aucun framework de
test au-delà des scripts `check:*` du dépôt.

**Spec :** `docs/superpowers/specs/2026-09-04-app-windows-design.md` (§4 pour la
couche d'hôte, §7 pour le découpage en tranches). Passation de la tranche 2 :
`docs/superpowers/notes/2026-09-05-tranche-2-passation.md`. Journal de la
tranche 2.6 : `.superpowers/sdd/2026-09-06-app-windows-tranche-2-6/progress.md`.

## Contraintes globales

Elles s'appliquent implicitement à chaque tâche ; aucune n'est négociable.

- **`npm run check:host` doit descendre de 28 à 15, jamais monter.** Chaque
  fichier converti sort de `RESTANTS` dans `scripts/check-host.mjs` **dans le
  même commit** que sa conversion : l'assertion 2 échoue sinon.
- **`npm run check:dashboard-dom` : sa liste `LIBERES` ne peut que GRANDIR.**
  Tout fichier de `src/dashboard/` libéré ici s'y ajoute. Les fichiers de
  `src/editor/` et de `src/types/` n'y vont pas : ce contrôle ne couvre que
  `src/dashboard/`.
- **Jamais de chaîne visible en dur** : tout par `t("<domaine>.<clé>")`, appelé
  AU RENDU (jamais dans une constante de haut niveau). **Vérifier qu'une clé
  n'existe pas déjà avant d'en créer une.** Cette tranche déplace du code
  existant ; les seules clés neuves prévues sont celles de la tâche 9, et elles
  y sont nommées.
- **Ne jamais traduire** les valeurs persistées : clés du format quiz, types de
  question, `mode: "exam"`, identifiants de commande, noms de réglages, dates
  `AAAA-MM-JJ`, grades du journal.
- **`src/dom.ts` (`ajouter`) est le seul constructeur d'éléments** hors des
  fichiers qui importent encore Obsidian. Il emploie `textContent`, jamais
  `innerHTML` : c'est ce qui protège d'une note nommée `<img src=x onerror=…>.md`.
- **Le HTML d'un quiz garde ses quatre portes** (`src/engine/sanitizer.ts`, cf.
  `CLAUDE.md`). Cette tranche touche l'APERÇU (`question-preview.ts`), qui passe
  par `sanitizeQuizHtml` : ne pas contourner cette porte au motif que le contenu
  vient « de l'utilisateur ». Un quiz partagé arrive avec le HTML de son auteur.
- **Icônes Lucide via `currentHost().ui.setIcon`, jamais d'emoji.**
- **`PLUGIN_ID` et `QUIZ_BLOCK_LANGUAGE` valent `quiz-blocks` et ne changent
  pas.** `resultsDir` côté Obsidian reste `.obsidian/quiz-blocks-results`.
- **Commentaires en français, documentant le POURQUOI**, jamais le QUOI.
- **Modules visés sous ~350 lignes.** `detail.ts` (810) et `editor-form.ts` (620)
  sont des exceptions HÉRITÉES : ne pas les découper dans cette tranche, ce
  serait mêler un refactor à une conversion et rendre la revue impossible.
- **Commits directs sur `main`**, jamais de branche ni de worktree, jamais de
  push.
- **Après chaque écriture de fichier**, chercher les marqueurs de mauvais
  encodage (`Ă`, `Â`, `â€`) dans le fichier touché : le dépôt a déjà été pollué.
  Attention à la FAUSSE ALERTE : `Â` est aussi une lettre française légitime en
  capitales, et un commentaire qui écrit « CÂBLAGE » fait sonner la garde sans
  qu'il y ait quoi que ce soit à corriger. Regarde le contexte avant de
  « réparer » un mot correct.
- **Les scripts de vérification appellent `process.exitCode`, jamais
  `process.exit()`** : la pile doit se dérouler pour que `withSrcModule` retire
  son dossier temporaire.

---

## Le périmètre, et pourquoi il n'est pas celui du brief

Le brief d'ouverture annonçait douze fichiers à libérer (~3 160 lignes) plus les
menus « ⋯ » reportés de la 2.6. **La mesure du 2026-09-09 déplace cinq choses,
et il faut les connaître avant d'écrire une ligne.**

### 1. `src/modal-base.ts` NE PEUT PAS être libéré ici

Il est dans la liste des douze du brief. Il n'y a pas sa place. `QbdModal`
`extends Modal` : ce fichier ne se convertit pas, il se SUPPRIME, et seulement
quand sa dernière sous-classe est partie. Or il en reste six, dans quatre
fichiers (relevé par `grep -rn 'extends QbdModal' src/`) :

| Fichier | Sous-classes | Sort |
|---|---|---|
| `src/editor/modals.ts` | `ConfirmModal`, `TypePickerModal` | converties, tâche 5 |
| `src/dashboard/quiz-menu.ts` | `ConfirmModal`, `RenameQuizModal` | converties, tâche 9 |
| `src/dashboard/share.ts` | `ShareModal` | **reste** (point 3 ci-dessous) |
| `src/dashboard/usage-modal.ts` | `UsageModal` | **reste** — tranche 4 |

`usage-modal.ts` n'affiche que les quotas des fournisseurs IA et importe des
VALEURS d'`ai-providers.ts` et `ai-usage.ts`, qui vivent sur `requestUrl`. Le
convertir ici serait porter de la tranche 4 sans le dire — le même refus que la
2.6 lui avait déjà opposé. **`modal-base.ts` part donc avec la tranche 4.**

### 2. Deux fichiers ne se convertissent pas, ils DÉMÉNAGENT

`src/editor.ts` est un `ItemView` (`QuizBuilderView`, plus `openQuizTab`) et
`src/dashboard/quiz-open.ts` appelle `workspace.getLeaf`, `setViewState` et
`revealLeaf`. Ce n'est pas du code de quiz : c'est du code d'ONGLET, et un
onglet n'existe que dans Obsidian. Aucune couche d'hôte ne rendrait ça portable,
parce qu'il n'y a rien à porter — la fenêtre n'a pas d'espace de travail.

Leur place est `apps/obsidian/`, à côté de `plugin.ts` et `host.ts`. Ils
quittent alors `src/`, donc `RESTANTS`, sans qu'une seule ligne de leur corps
change.

**`quiz-open.ts` n'était PAS dans la liste des douze du brief, et c'est un
blocage transitif** : `detail.ts:8` l'importe EN VALEUR (`openQuizForPlay`).
`npm run check:host` ne compte que les imports DIRECTS et ne pouvait pas le
dire. C'est la forme exacte du défaut qui a fait valider trois tâches sur une
prémisse fausse en tranche 2.5, et que le ruling 4 de la 2.6 a évité de justesse.

Il y a même un CYCLE, que la mesure a mis au jour :

```
detail.ts  ──(openQuizForPlay)──▶  quiz-open.ts  ──(VIEW_TYPE)──▶  editor.ts
    ▲                                                                  │
    └───────────────────────(createQuizPage)───────────────────────────┘
```

Le déménagement le casse, et **le remplaçant existe déjà** :
`DashboardShellCtx.openQuiz` (« Joue un quiz. L'hôte décide ce que jouer veut
dire ») vaut EXACTEMENT `openQuizForPlay(this.app, quiz)` côté greffon
(`src/dashboard.ts:205`). Il n'y a donc pas de membre à inventer, seulement un
appel direct à remplacer par un appel au `ctx`.

### 3. `share.ts` reste lié à Obsidian, et la spec le dit avant la mesure

La 2.6 avait reporté `quiz-menu.ts` ET `share.ts` vers cette tranche. La spec §7
est plus nette qu'eux : « **Hors périmètre de ce chantier** : les notifications,
la distribution aux camarades, le partage de quiz entre étudiants. » Le partage
n'est pas de la tranche 3, il n'est d'aucune tranche de ce chantier.

La mesure va dans le même sens. Le brief annonçait « pas d'écriture binaire pour
le `.zip` de partage » comme s'il ne manquait que cela. En réalité `share.ts`
enregistre par `require("fs").writeFileSync` dans `~/Downloads`, révèle par
`require("electron").shell.showItemInFolder`, et active Discord par un
`child_process.execFile("powershell", …)` avec un script encodé en base64
(lignes 118-137 et 295-360, soit environ 220 lignes). Ce dernier est **le
sous-contrat de lancement de processus que le brief assigne lui-même à la
tranche 4**.

**Conséquence pour la tâche 9** : `quiz-menu.ts` se convertit, mais il ne peut
plus importer `ShareModal` en valeur. L'ouverture du partage passe par un membre
optionnel du `ctx`, comme `openCardMenu` avant elle. Une absence PRÉVUE, pas
une dégradation muette.

Le renommage subit le même sort, pour une raison différente et mesurée à la
tâche 9 : il exige un index des liens ENTRANTS que seule Obsidian tient. **Le
menu « ⋯ » de la fenêtre aura donc DEUX entrées sur quatre** (Éditer,
Supprimer) ; celui du greffon garde les quatre.

### 4. Il manque QUATRE primitives d'hôte, pas deux

Le brief annonce « pas de corbeille, pas d'écriture binaire ». Relevé réel :

| Primitive | Qui l'exige | Ce qu'Obsidian offre |
|---|---|---|
| lecture-écriture INDIVISIBLE | `detail-io.ts:118` (sauvegarde d'un bloc), `quiz-menu.ts:157` et `:180` (suppression) | `vault.process` |
| écriture BINAIRE | `editor-form.ts:270` et `:427` (**image collée** dans une question) | `vault.adapter.writeBinary` |
| corbeille | `quiz-menu.ts:195` | `fileManager.trashFile` |
| chemin d'une pièce jointe | `editor-form.ts:59` | `fileManager.getAvailablePathForAttachment` |

**La première est le vrai prérequis de la tranche**, et le brief ne la nomme
pas : elle porte la sauvegarde du bloc, c'est-à-dire le livrable lui-même. La
deuxième ne sert pas qu'au zip du partage, contrairement à ce que le brief
laisse croire — elle sert à coller une image dans une question, qui EST de la
tranche 3.

Un renommage qui met les LIENS à jour a été envisagé comme cinquième primitive
et écarté après mesure : voir la tâche 9, qui explique pourquoi
`fileManager.renameFile` reste dans le greffon plutôt que d'entrer au contrat.

### 5. Ce que la tranche livre donc réellement

Treize fichiers quittent le cliquet, qui passe de **28 à 15**.

| Fichier | Lignes | Extensions DOM | Ce qu'il demande d'autre | Tâche |
|---|---|---|---|---|
| `src/dashboard/detail.ts` | 810 | 54 | `setIcon`, `Notice`, `App`, `Plugin` | 8 |
| `src/editor/editor-form.ts` | 620 | 78 | `Notice`, écriture binaire, pièce jointe | 3 |
| `src/dashboard/quiz-menu.ts` | 329 | 12 | `Notice`, `TFile`, `App`, corbeille, process | 9 |
| `src/dashboard/detail-question.ts` | 309 | 21 | `App`, `Plugin` (passe-plat) | 7 |
| `src/editor/question-preview.ts` | 290 | 46 | `App` (résolution d'images) | 4 |
| `src/dashboard/detail-io.ts` | 187 | 0 | `TFile`, `App`, **`vault.process`** | 6 |
| `src/dashboard/detail-exam.ts` | 141 | 11 | `setIcon` | 7 |
| `src/editor/modals.ts` | 129 | 19 | `App`, `QbdModal` ×2 | 5 |
| `src/dashboard/detail-form-bridge.ts` | 108 | 0 | `App`, `Plugin` (passe-plat) | 7 |
| `src/types/editor-ctx.ts` | 98 | 0 | `App`, `Plugin` (types seuls) | 3 |
| `src/quiz-source-ref.ts` | 87 | 0 | `App`, `TFile` | 4 |
| `src/editor.ts` | 143 | 10 | **déménage** | 2 |
| `src/dashboard/quiz-open.ts` | 76 | 0 | **déménage** | 2 |

Comptages faits avec la MÊME expression que `scripts/check-host.mjs`
(assertion 4), commentaires retirés.

Restent 15 après la tranche : `dashboard.ts`, les cinq fichiers `ai*`,
`file-sources.ts`, `mention-picker.ts`, `prompt-paths.ts`, `share.ts`,
`usage-modal.ts`, `voice-input.ts`, `voice-install.ts`,
`types/dashboard-ctx.ts`, `hotkey-format.ts`, `modal-base.ts`.

Côté application, les quatre membres optionnels du `ctx` laissés vides par la
2.6 se remplissent : `openCardMenu`, `openModuleMenu`, `createQuiz`,
`openQuizPath`. Ahmed retrouve dans la fenêtre le menu « ⋯ » (moins
« Partager »), « Nouveau quiz », et surtout la PAGE d'un quiz avec son bouton
« Editor ».

---

## La méthode, et l'avertissement qui la justifie

Le code dicté « verbatim » par les plans de ce projet s'est révélé **fautif
vingt-quatre fois** sur les tranches 2, 2.5 et 2.6 — dix-huit d'abord, six de
plus à la 2.6 —, à chaque fois trouvé par un implémenteur ou un relecteur,
jamais par le plan lui-même. Les extraits ci-dessous sont des ARGUMENTS, pas des
autorités. **Cette tranche écrit dans les notes de l'utilisateur : c'est la
partie la plus irréversible du produit après le journal de révision.**

Quatre méthodes ont attrapé la quasi-totalité de ces défauts.

### 1. L'épreuve de DISCRIMINANCE

Pour chaque cas de test : casser la règle qu'il garde, LANCER, voir l'assertion
rougir, restaurer, revoir vert. Un cas qui reste vert quand on casse sa règle ne
garde rien.

Nuance apprise à la 2.6 : un cas peut être non discriminant **par
construction** — il n'exerce qu'une branche identique dans les deux hôtes. C'est
légitime quand on le sait et qu'on le DIT ; c'est un défaut quand personne ne
l'a vu. Sur les sept cas neufs de `fs.write`, trois rougissaient et quatre non,
et la re-revue a eu raison de le nommer plutôt que de compter sept.

### 2. Juger un script sur son CODE DE SORTIE

Lancer `npm run <x>` puis afficher `$?` sur UNE SEULE LIGNE, sans pipe. Un
`| tail` rend le statut de `tail`. Un groupe vert peut suivre trois groupes
rouges, et c'est ainsi qu'un défaut est déjà passé dans ce dépôt.

### 3. `check:app` est VERT SANS RIEN REGARDER — le piège qui a failli tout emporter

`apps/windows/tsconfig.json` ne tire de `src/` que `../../src/**/*.d.ts`. Tout
le reste n'entre dans la compilation que s'il est **importé** depuis
`apps/windows/src`. Un fichier converti que l'application n'importe pas encore
n'est donc JAMAIS compilé par `check:app`, qui reste vert quoi qu'on lui fasse
subir.

C'est le cas de tous les fichiers des tâches 3 à 9 : rien sous
`apps/windows/src` ne les importe avant la tâche 10.

**Le geste correct**, appliqué à chaque tâche de la 2.6 et qui a fait que la
dernière est passée sans une seule surprise :

1. ajouter un import TEMPORAIRE du fichier converti dans
   `apps/windows/src/main.ts`, et **RÉFÉRENCER** ce qu'on importe —
   `isolatedModules` est actif, un import inutilisé est élidé et la vérification
   devient alors vide ;
2. lancer `npm run check:app` et relever son code de sortie ;
3. **comparer le NOMBRE DE MODULES** annoncé par Vite (« ✓ N modules
   transformed ») avec et sans l'import. **Un delta nul veut dire que l'import a
   été élidé et que RIEN n'a été vérifié.** Les tâches de la 2.6 ont mesuré +2,
   +1, +1 et +9 ; le point de départ de cette tranche est **1940 modules**
   (relevé le 2026-09-09) ;
4. **retirer l'import AVANT de commiter**, et le prouver (`git diff --stat` ne
   doit pas montrer `main.ts`).

### 4. Une revue lit le DIFF FIGÉ, jamais l'arbre vivant

Un relecteur de la 2.6 a lancé `npm run check:host` sur un arbre qui avait
avancé d'un commit, en a tiré un compte contradictoire, et a accusé un rapport
d'avoir falsifié sa sortie. Il avait tort, et il a fallu deux vérifications
indépendantes pour le prouver. Le compte d'un commit se lit dans le tableau
`RESTANTS` **de ce commit**, pas dans une commande lancée aujourd'hui.

---

## La recette de conversion, une fois pour toutes

Six tâches font le même geste sur des fichiers différents. C'est la recette des
tranches 2.5 et 2.6, appliquée douze fois avec succès. **Chaque tâche qui
convertit un fichier reçoit cette section dans son brief.**

### 1. L'import d'Obsidian disparaît

```ts
import { setIcon, Notice } from "obsidian";      // AVANT
import { currentHost } from "../host/current";   // APRÈS
```

`setIcon(el, "x")` devient `currentHost().ui.setIcon(el, "x")` ; `new Notice(m)`
devient `currentHost().ui.notice(m)`.

`currentHost()` **jette** si aucun hôte n'est installé — c'est voulu, et
préférable à un `?.` qui rendrait la fonctionnalité silencieusement inerte.

Attention au chemin relatif : depuis `src/dashboard/` c'est `"../host/current"`,
depuis `src/editor/` aussi, depuis `src/` c'est `"./host/current"`. **Vérifie,
ne recopie pas.**

### 2. Les extensions DOM deviennent `ajouter`

```ts
ajouter<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement, tag: K, cls?: string, texte?: string,
): HTMLElementTagNameMap[K]
```

```ts
el.createDiv({ cls: "x" })                    →  ajouter(el, "div", "x")
el.createEl("p", { cls: "x", text: s })       →  ajouter(el, "p", "x", s)
el.createSpan({ text: s })                    →  ajouter(el, "span", undefined, s)
el.createEl("button", { type: "button" })     →  const b = ajouter(el, "button");
                                                 b.type = "button";
```

Tout ce qui n'est ni `cls` ni `text` (`type`, `value`, `title`, `href`,
`placeholder`) se pose en PROPRIÉTÉ sur l'élément rendu.

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
ne les touche pas.

### 3. Le fichier sort de `RESTANTS`

Retire son entrée de `scripts/check-host.mjs`. Le contrôle **échoue** sinon
(assertion 2). S'il est sous `src/dashboard/`, ajoute-le à `LIBERES` dans
`scripts/check-dashboard-dom.mjs` **dans le même commit**.

### 4. Le piège, et c'est celui qui compte

`npm run check:host` n'attrape les extensions DOM **que dans les fichiers qui
n'importent plus Obsidian** (assertion 4). Retirer l'import SANS convertir les
extensions fait rougir le contrôle (résultat voulu) ; convertir les extensions
sans retirer l'import ne fait rien rougir du tout, et le fichier reste
inutilisable dans la fenêtre. **Fais toujours les deux dans le même mouvement.**

---

## Structure des fichiers

**Créés :**

- `apps/obsidian/editor.ts` — `src/editor.ts` déménagé, corps inchangé (tâche 2).
- `apps/obsidian/quiz-open.ts` — `src/dashboard/quiz-open.ts` déménagé, corps
  inchangé (tâche 2).
- `scripts/check-quiz-io.mjs` — le contrôle de la sauvegarde d'un bloc, qui
  n'existe pas et dont l'absence est le plus gros trou de cette tranche
  (tâche 6).

**Modifiés :**

- `src/host/types.ts` — quatre membres de plus sur `HostFs` (tâche 1).
- `apps/obsidian/host.ts`, `apps/windows/src/host/fs.ts` — leurs deux
  implémentations (tâche 1).
- `apps/windows/src-tauri/capabilities/default.json` — la permission
  d'écriture binaire (tâche 1). **Aucun changement Rust** : la corbeille de la
  fenêtre est un déplacement vers `<racine>/.trash/`, donc un `rename` et un
  `mkdir` déjà autorisés.
- `src/types/editor-ctx.ts`, `src/editor/editor-form.ts`,
  `src/editor/question-preview.ts`, `src/editor/modals.ts`,
  `src/quiz-source-ref.ts`, `src/dashboard/detail-io.ts`,
  `src/dashboard/detail-exam.ts`, `src/dashboard/detail-form-bridge.ts`,
  `src/dashboard/detail-question.ts`, `src/dashboard/detail.ts`,
  `src/dashboard/quiz-menu.ts` — les onze conversions.
- `src/types/dashboard-ctx.ts` — un membre `shareQuiz?` (tâche 9).
- `src/dashboard.ts`, `apps/obsidian/plugin.ts` — les sites d'appel du greffon.
- `apps/windows/src/ui/dashboard-shell.ts`, `apps/windows/src/main.ts` — le
  câblage de l'application (tâche 10).
- `scripts/check-host.mjs` (une cinquième assertion, tâche 2),
  `scripts/check-dashboard-dom.mjs`, `scripts/check-obsidian-host.mjs`,
  `scripts/check-windows-host.mjs`, `package.json`.

**Non touchés, et c'est délibéré :** `src/dashboard/share.ts`,
`src/dashboard/usage-modal.ts`, `src/modal-base.ts`, tout `ai*`, `voice-*`,
`file-sources.ts`, `mention-picker.ts`, `prompt-paths.ts` (voir « Le
périmètre »).
---

## Tâche 1 — Les quatre primitives que `HostFs` n'a pas

C'est le prérequis de tout le reste, et la seule pièce vraiment neuve de la
tranche. Aucun fichier ne quitte `RESTANTS` ici : **`check:host` doit encore
annoncer 28 à la fin de cette tâche.**

**Fichiers :**
- Modifier : `src/host/types.ts`
- Modifier : `apps/obsidian/host.ts`
- Modifier : `apps/windows/src/host/fs.ts`
- Modifier : `apps/windows/src-tauri/capabilities/default.json`
- Modifier : `scripts/check-obsidian-host.mjs`, `scripts/check-windows-host.mjs`

**Interfaces :**
- Consomme : `Host` (`src/host/types.ts`), `currentHost()`,
  `reserveFreePath` (`src/unique-path.ts`).
- Produit : `HostFs.process`, `HostFs.writeBinary`, `HostFs.trash`,
  `HostPaths.attachmentPathFor`. Les tâches 3, 6 et 9 en dépendent.

- [ ] **Étape 1 : écrire le contrat dans `src/host/types.ts`**

À ajouter dans `HostFs`, à la suite de `write` (le style des commentaires suit
celui du fichier : le POURQUOI, jamais le QUOI).

```ts
	/** Lecture-modification-écriture INDIVISIBLE : le rappel reçoit le contenu
	    actuel et rend le contenu à écrire.

	    C'est la seule façon sûre d'écrire dans une note dont on ne possède
	    qu'un MORCEAU. `read` puis `write` perd toute modification faite entre
	    les deux, et le commentaire d'`ai.ts:2058` dit ce que ça coûtait : une
	    insertion écrasait le travail d'à côté en annonçant « Quiz inséré ».

	    Le rappel peut être REJOUÉ : il doit repartir de zéro à chaque
	    invocation et ne rien garder d'un essai abandonné. C'est la DERNIÈRE
	    invocation qui fait foi (`detail-io.ts` en dépend, son drapeau `ecrit`
	    est remis à faux en tête de rappel).

	    Ce que les deux hôtes NE promettent pas également : Obsidian sérialise
	    réellement les écritures de son vault ; la fenêtre est un processus
	    unique sans autre écrivain qu'elle-même, et son implémentation lit puis
	    écrit. Aucun des deux ne protège d'un éditeur de texte EXTÉRIEUR — c'est
	    pourquoi l'appelant porte son propre compare-and-swap sur le CONTENU
	    (`detail-io.ts`), qui est la seule garantie à la bonne granularité. */
	process(path: string, mutate: (content: string) => string): Promise<void>;
	/** Écrit des OCTETS, en créant ou en remplaçant, comme `write`.
	    Existe pour UNE raison : coller une image dans une question
	    (`editor/editor-form.ts`). Le texte a `write` ; un `Uint8Array` passé
	    par `write` serait converti en chaîne et l'image serait corrompue sans
	    qu'aucune erreur ne le dise. */
	writeBinary(path: string, data: Uint8Array): Promise<void>;
	/** Retire un fichier en le rendant RÉCUPÉRABLE. Ce n'est pas `remove` :
	    supprimer le quiz d'un semestre par mégarde ne doit pas être définitif.

	    Chaque hôte applique SA convention, et le contrat ne promet que le
	    résultat : le fichier n'est plus à son chemin, et l'utilisateur peut le
	    retrouver par les moyens habituels de son hôte. Obsidian suit le réglage
	    de l'utilisateur (corbeille système, `.trash` du vault, ou définitif) ;
	    l'application déplace vers `<racine>/.trash/<chemin local>`, qui est
	    l'une des trois options qu'Obsidian propose lui-même — sans dépendance
	    neuve, et portable telle quelle sur Android au chantier 3, où aucune
	    corbeille système n'est atteignable. */
	trash(path: string): Promise<void>;
```

et dans `HostPaths`, à la suite de `resultsDirFor` (même famille : un chemin
calculé POUR une note donnée) :

```ts
	/**
	 * Chemin LIBRE où ranger une pièce jointe de la note `sourcePath`.
	 *
	 * L'hôte décide du DOSSIER, jamais l'appelant : sous Obsidian c'est un
	 * réglage de l'utilisateur (« dossier des pièces jointes »), qui a des
	 * modes relatifs à la note — et le calculer nous-mêmes rangerait l'image
	 * ailleurs que là où l'utilisateur l'a demandé.
	 *
	 * « LIBRE » veut dire : la cible n'existe pas au moment où elle est rendue.
	 * L'appelant reste tenu de RÉSERVER le nom (`src/unique-path.ts`) s'il en
	 * demande deux coup sur coup : mesuré sous Obsidian, deux appels
	 * rapprochés rendent le MÊME chemin tant que le fichier n'existe pas, et la
	 * seconde image écrasait la première.
	 */
	attachmentPathFor(name: string, sourcePath?: string): Promise<string>;
```

- [ ] **Étape 2 : vérifier que ça rougit AVANT d'implémenter**

Lance `npm run check` puis `npm run check:app`, chacun sur sa ligne, en
relevant le code de sortie.

Attendu : **les deux ÉCHOUENT**, parce qu'aucune des deux implémentations ne
fournit les quatre membres. C'est l'épreuve de discriminance du contrat
lui-même : si l'un des deux passe au vert, c'est que le type `Host` n'est pas
celui que les hôtes implémentent, et il faut comprendre pourquoi avant de
continuer.

- [ ] **Étape 3 : l'implémentation Obsidian**

Dans `apps/obsidian/host.ts`, dans le littéral `fs`. Les aides existent déjà :
`adapter()`, `tfile(path)` (rend le `TFile` d'un chemin, discriminé par la
présence d'`extension`) et `estCache(path)` (un segment commençant par un
point).

```ts
		/* MÊME PARTAGE QUE `write`, et pour la même raison : `vault.process`
		   exige un `TFile`, que les dossiers cachés n'ont jamais. La branche
		   adaptateur DÉGRADE en lecture-écriture — c'est ce que la fenêtre fait
		   de toute façon, et aucun appelant de cette branche ne partage sa note
		   avec un autre écrivain (résultats exportés, journal). */
		async process(path, mutate) {
			const f = estCache(path) ? null : tfile(path);
			if (f) {
				await app.vault.process(f, mutate);
				return;
			}
			await adapter().write(path, mutate(await adapter().read(path)));
		},
		/* `vault.createBinary` quand la cible est neuve et indexable, exactement
		   comme `write` passe par `vault.create` : une image écrite par le seul
		   adaptateur EXISTE sur le disque sans entrer à l'index, et
		   `getFirstLinkpathDest` ne la retrouve pas — l'aperçu de la question
		   afficherait alors une image cassée juste après le collage. C'est le
		   défaut que la tranche 2.6 a corrigé pour les notes ; il vaut à
		   l'identique pour les pièces jointes. */
		async writeBinary(path, data) {
			/* La vue, pas le tampon : `data.buffer` d'une vue partielle porte
			   plus d'octets que la vue elle-même, et l'image sortirait avec une
			   queue parasite. `share.ts` emploie encore la forme non bornée ;
			   ne pas la recopier. */
			const octets = data.buffer.slice(
				data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
			if (estCache(path)) {
				await adapter().writeBinary(path, octets);
				return;
			}
			const f = tfile(path);
			if (f) {
				await app.vault.modifyBinary(f, octets);
				return;
			}
			if (await adapter().exists(path)) {
				await adapter().writeBinary(path, octets);
				return;
			}
			await app.vault.createBinary(path, octets);
		},
		/* `fileManager.trashFile` et NON `vault.delete` : lui seul respecte le
		   réglage « Fichiers supprimés » de l'utilisateur (corbeille système,
		   `.trash` du vault, ou définitif). Choisir à sa place serait décider
		   qu'un quiz supprimé est irrécupérable chez quelqu'un qui a demandé
		   l'inverse. */
		async trash(path) {
			const f = tfile(path);
			// Déjà absent : le contrat ne promet que l'ABSENCE au chemin donné,
			// et rejeter ferait échouer une suppression que l'utilisateur voit
			// comme réussie (même raison que `remove`).
			if (!f) return;
			await app.fileManager.trashFile(f);
		},
```

et, dans le littéral `paths` :

```ts
		/* Obsidian décide, et il déduplique déjà contre ce qui existe. On ne
		   recalcule rien : le réglage a des modes RELATIFS à la note (« ./ »,
		   « ./images ») que reproduire ici ferait diverger au premier
		   changement d'Obsidian. */
		attachmentPathFor: (name, sourcePath) =>
			app.fileManager.getAvailablePathForAttachment(name, sourcePath),
```

**Les trois signatures ont été RELEVÉES**, pas supposées, dans
`node_modules/obsidian/obsidian.d.ts` le 2026-09-09 :

```
:7396  createBinary(path: string, data: ArrayBuffer, options?): Promise<TFile>
:7476  modifyBinary(file: TFile, data: ArrayBuffer, options?): Promise<void>
:2967  getAvailablePathForAttachment(filename: string, sourcePath?: string): Promise<string>
:2920  trashFile(file: TAbstractFile): Promise<void>
```

Les quatre prennent bien ce que le code ci-dessus leur passe. Si ton
`obsidian.d.ts` dit autre chose, c'est lui qui a raison et ce plan qui a vieilli.

- [ ] **Étape 4 : l'implémentation de la fenêtre**

Dans `apps/windows/src/host/fs.ts`. `abs(path)` existe déjà et jette hors des
racines ; `carte` expose `pour`, `local` et `contrat` (voir `roots.ts:33-46`) —
**c'est le SEUL endroit qui convertit entre chemin du contrat et chemin local,
et il ne faut jamais en recomposer un à la main** (passation de la tranche 2 :
c'est le défaut qui a coûté la régression de résolution de liens de la tâche 6).

`writeFile` s'importe depuis `@tauri-apps/plugin-fs`, à ajouter à la liste
d'imports en tête de fichier.

```ts
		/* Lecture puis écriture, et le contrat le dit : un processus unique
		   sans autre écrivain que lui-même. Ce n'est PAS équivalent au
		   `vault.process` d'Obsidian, et c'est pourquoi le contrat ne promet
		   l'indivisibilité qu'à l'intérieur de la fenêtre. */
		async process(path, mutate) {
			const p = abs(path);
			await writeTextFile(p, mutate(await readTextFile(p)));
		},
		async writeBinary(path, data) {
			await writeFile(abs(path), data);
		},
		/* `<racine>/.trash/<chemin local>` : le point de tête suffit à
		   l'exclure du parcours du catalogue (`dossierIgnore`) comme du côté
		   Obsidian (`estCache`), donc un quiz mis à la corbeille disparaît du
		   tableau de bord sans qu'aucun filtre neuf n'ait à le savoir. */
		async trash(path) {
			const racine = carte.pour(path);
			if (!racine) throw new Error(`chemin hors des dossiers ouverts : ${path}`);
			const local = carte.local(path);
			const vise = carte.contrat(racine.id, `.trash/${local}`);
			const point = vise.lastIndexOf(".");
			/* Un nom LIBRE : supprimer deux fois une note du même nom (recréée
			   entre les deux) écraserait la première dans la corbeille, et la
			   corbeille est justement l'endroit où rien ne doit disparaître. */
			const cible = await reserveFreePath(
				point > 0 ? vise.slice(0, point) : vise,
				point > 0 ? vise.slice(point) : "",
				(c) => this.exists(c),
			);
			const dossier = cible.slice(0, cible.lastIndexOf("/"));
			if (dossier) await this.mkdirs(dossier);
			await renameFichier(abs(path), abs(cible));
		},
```

**`this` n'existe pas dans un littéral rendu par une fonction fabrique.** Le
code ci-dessus est un ARGUMENT sur la forme : lis comment `mkdirs` est déclaré
(une `function` nommée, hors du littéral, précisément pour être appelable) et
suis le même patron pour `exists` et `mkdirs` si tu en as besoin ici. Une des
manières est de nommer les deux fonctions au-dessus du `return` et de les
référencer par leur nom.

Côté `HostPaths` (dans le module qui construit `paths`, pas dans `fs.ts` — lis
`apps/windows/src/host/index.ts` pour savoir lequel) :

```ts
	/* MÊME DOSSIER QUE LA NOTE. L'application n'a pas de réglage « dossier des
	   pièces jointes » et n'en invente pas un : à côté de la note est le seul
	   endroit qui survive au déplacement du dossier de quiz, et c'est aussi
	   l'un des modes qu'Obsidian propose. Le lien écrit dans le bloc porte le
	   NOM seul, donc la résolution le retrouvera là. */
	async attachmentPathFor(name, sourcePath) {
		const dossier = sourcePath && sourcePath.includes("/")
			? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
			: "";
		const vise = dossier ? `${dossier}/${name}` : name;
		const point = vise.lastIndexOf(".");
		return await reserveFreePath(
			point > 0 ? vise.slice(0, point) : vise,
			point > 0 ? vise.slice(point) : "",
			(c) => fs.exists(c),
		);
	},
```

- [ ] **Étape 5 : la permission Tauri**

`apps/windows/src-tauri/capabilities/default.json` porte `fs:allow-write-text-file`
mais pas son équivalent binaire. Ajoute **`fs:allow-write-file`**.

Le nom exact a été RELEVÉ dans
`apps/windows/src-tauri/gen/schemas/desktop-schema.json` le 2026-09-09 :
`fs:allow-write-file` y figure, aux côtés de `fs:allow-write-text-file` déjà
employée. Cette vérification-là est donc faite.

**Ce qui reste dû, et qu'aucun script ne peut faire** : éprouver que la
permission SERT. La retirer doit faire échouer le collage d'une image AU
RUNTIME, jamais à la compilation — c'est une entrée de « Ce qu'aucun script ne
peut prouver ». La tranche 2 a laissé une permission parfaitement bien nommée
et totalement INERTE (`fs:allow-unwatch`) pendant un chantier entier : le nom
juste ne prouve rien sur l'usage.

`trash` n'ajoute AUCUNE permission : c'est un `rename` et un `mkdir`, déjà
autorisés.

- [ ] **Étape 6 : les cas des deux contrôles d'hôte**

Ajoute dans `scripts/check-obsidian-host.mjs` et
`scripts/check-windows-host.mjs`. **Chacun s'éprouve par DISCRIMINANCE** :
casse la règle, lance, vois rougir, restaure, revois vert. Et **dis, pour
chaque cas, s'il discrimine dans UN hôte ou dans les DEUX** — un cas qui
n'exerce qu'une branche identique des deux côtés est légitime, à condition
d'être nommé comme tel (leçon de la 2.6).

| Cas | Règle gardée | Comment la casser |
|---|---|---|
| `process` donne au rappel le contenu ACTUEL et écrit ce qu'il rend | la sauvegarde d'un bloc | ignorer le retour du rappel |
| `process` sur un chemin caché (`.neo-quiz/x.json`) passe par l'adaptateur | le journal et les résultats gardent leur conduite | router le chemin caché vers `vault.process` |
| `writeBinary` d'une cible NEUVE indexable passe par `vault.createBinary` | l'image collée est retrouvable par `getFirstLinkpathDest` | poser `adapter().writeBinary` partout |
| `writeBinary` d'une vue PARTIELLE n'écrit que ses octets | une image tronquée ou allongée en silence | passer `data.buffer` nu |
| `trash` d'un fichier ABSENT ne jette pas | une suppression que l'utilisateur voit comme réussie | retirer la garde |
| `trash` laisse le fichier retrouvable (`.trash/…` côté app) | un semestre supprimé sans retour | appeler `remove` à la place |
| `trash` d'un homonyme déjà en corbeille ne l'écrase pas | la corbeille est l'endroit où rien ne disparaît | retirer `reserveFreePath` |
| `attachmentPathFor` rend un chemin LIBRE | deux collages coup sur coup, la première image perdue | rendre le chemin sans tester l'existence |

Le quatrième mérite un mot : un cas qui vérifie seulement que `writeBinary` a
été appelé resterait VERT avec `data.buffer` nu, puisque pour un `Uint8Array`
construit sur un tampon exact les deux formes coïncident. **Construis la vue sur
un tampon plus grand** (`new Uint8Array(buffer, 4, 8)`) et compare la LONGUEUR
écrite : sans ça, le cas ne garde rien.

- [ ] **Étape 7 : les contrôles**

Chacun sur sa ligne, sans pipe, en relevant le code de sortie : `npm run check`,
`check:app`, `check:obsidian-host`, `check:windows-host`, `check:host`,
`check:review-log`, `check:scanner`.

`check:host` annonce toujours **28** — aucun fichier n'a été converti ici.
`check:review-log` et `check:scanner` sont là parce qu'ils font tourner de vrais
faux hôtes : le ruling 3 de la tranche 2 avertit qu'un faux hôte PARTIEL meurt
sur un `TypeError` quand le contrat grandit. **Complète les faux hôtes AVANT de
voir l'échec, pas après.** Les candidats connus sont
`scripts/check-scanner.mjs`, `check-math-render.mjs` et `check-lesson.mjs`.

- [ ] **Étape 8 : commit**

```bash
git add src/host/types.ts apps/obsidian/host.ts apps/windows/src/host apps/windows/src-tauri/capabilities/default.json scripts/check-obsidian-host.mjs scripts/check-windows-host.mjs
git commit -m "feat(host): process, writeBinary, trash et le chemin d'une piece jointe"
```

---

## Tâche 2 — Le déménagement, qui casse le cycle

Petite tâche par la taille, décisive par ce qu'elle débloque : sans elle, la
tâche 8 convertit `detail.ts` en apparence et l'application refuse de se
construire à la tâche 10. **Aucune ligne du CORPS des deux fichiers ne change.**

**Fichiers :**
- Créer : `apps/obsidian/editor.ts` (contenu de `src/editor.ts`)
- Créer : `apps/obsidian/quiz-open.ts` (contenu de `src/dashboard/quiz-open.ts`)
- Supprimer : `src/editor.ts`, `src/dashboard/quiz-open.ts`
- Modifier : `src/dashboard/detail.ts` (l'appel qui crée le cycle), `src/dashboard.ts`,
  `apps/obsidian/plugin.ts`
- Modifier : `scripts/check-host.mjs` (deux entrées de `RESTANTS` en moins, plus
  une CINQUIÈME assertion)

**Interfaces :**
- Consomme : `DashboardShellCtx.openQuiz` (existe déjà,
  `src/types/dashboard-ctx.ts`).
- Produit : `apps/obsidian/editor.ts` exporte `VIEW_TYPE`, `QuizBuilderView`,
  `openQuizTab` — **inchangés** ; `apps/obsidian/quiz-open.ts` exporte
  `openQuizForPlay`, `openQuizInEditor`, `openQuizPathInEditor` — **inchangés**.
  La tâche 8 compte sur le fait que `detail.ts` n'importe plus rien d'eux.

- [ ] **Étape 1 : déplacer les deux fichiers**

```bash
git mv src/editor.ts apps/obsidian/editor.ts
git mv src/dashboard/quiz-open.ts apps/obsidian/quiz-open.ts
```

`git mv` et non une copie : l'historique de ces deux fichiers est ce qui
explique pourquoi ils ressemblent à ce qu'ils sont.

Corrige ensuite leurs chemins relatifs **vers le haut** (ils descendaient d'un
cran) : depuis `apps/obsidian/`, `"./i18n"` devient `"../../src/i18n"`,
`"./dashboard/detail"` devient `"../../src/dashboard/detail"`, etc. `plugin.ts`
et `host.ts` sont le modèle à recopier, ils vivent au même endroit.

- [ ] **Étape 2 : casser le cycle dans `detail.ts`**

`detail.ts:8` est le seul lien de `src/` vers `quiz-open.ts` :

```ts
import { openQuizForPlay } from "./quiz-open";
```

Son unique usage est le bouton principal de `createDetailHandlers`
(vers la ligne 122) :

```ts
					onClick: () => void openQuizForPlay(ctx.app, quiz),
```

Il devient :

```ts
					// `ctx.openQuiz` et non un appel direct : c'est L'HÔTE qui
					// décide ce que « jouer » veut dire. Sous Obsidian il vaut
					// exactement l'ancien appel (`src/dashboard.ts:205`) ; dans
					// la fenêtre il monte la page du moteur. Le fichier qui
					// portait cet appel est parti dans `apps/obsidian/` : il ne
					// parlait que d'onglets.
					onClick: () => ctx.openQuiz(quiz),
```

Retire l'import. **`detail.ts` reste dans `RESTANTS`** : il importe encore
`setIcon` et `Notice` (c'est la tâche 8 qui l'en sort).

- [ ] **Étape 3 : les deux sites d'appel du greffon**

`src/dashboard.ts` importe les deux fichiers déplacés (ligne 4) et
`apps/obsidian/plugin.ts` importe `QuizBuilderView` / `VIEW_TYPE`. Corrige les
chemins.

`src/dashboard.ts` va donc importer depuis `apps/obsidian/`. **C'est une
direction neuve et il faut la borner**, sinon elle deviendra la porte de sortie
facile de toutes les tranches suivantes. `src/dashboard.ts` est lui-même du code
d'onglet (`ItemView`, `Scope`), déjà dans `RESTANTS`, et il partira au
chantier 4 : l'exception lui est acceptable, à personne d'autre.

- [ ] **Étape 4 : la cinquième assertion de `check-host.mjs`**

Rendre l'exception MÉCANIQUE plutôt que disciplinaire, dans le même esprit que
les quatre assertions existantes :

```js
/* 5. LE SENS DES DÉPENDANCES. `src/` est le code partagé : il ne connaît pas
      ses hôtes. La tranche 3 a déplacé `editor.ts` et `quiz-open.ts` vers
      `apps/obsidian/` parce qu'ils ne décrivaient qu'un onglet — et
      `src/dashboard.ts`, qui est lui-même un `ItemView` en instance de départ,
      les importe désormais de là. C'est la SEULE exception, et elle est
      nommée : sans cette assertion, « juste un import depuis apps/ » serait la
      façon la plus rapide de contourner tout le reste du contrôle, sans
      qu'aucune des quatre assertions précédentes ne s'en aperçoive. */
const IMPORTE_APPS = /(?:from\s*|require\s*\(\s*|(?<![.\w$])import\s*\(\s*)["'][^"']*\bapps\//;
const EXCEPTIONS_APPS = new Set(["src/dashboard.ts"]);
for (const f of fichiersTs("src")) {
	if (EXCEPTIONS_APPS.has(f)) continue;
	if (IMPORTE_APPS.test(codeNu(readFileSync(f, "utf8")))) {
		rate(`${f} importe depuis apps/ : le code partagé ne connaît pas ses hôtes.`);
	}
}
```

**Éprouve-la deux fois** : ajoute un import d'`apps/obsidian/host` dans un
fichier quelconque de `src/` hors exception (vois rougir, restaure), puis retire
`src/dashboard.ts` de `EXCEPTIONS_APPS` (vois rougir, restaure). Le second est
le plus important : sans lui, tu ne sais pas si l'assertion regarde vraiment
`dashboard.ts`.

**Vérifie que `codeNu` est bien défini AVANT ce bloc** dans le fichier : il l'est
aujourd'hui juste au-dessus de l'assertion 4. Si l'ordre ne convient pas,
déplace la déclaration plutôt que d'en faire une seconde copie.

- [ ] **Étape 5 : les listes et les contrôles**

Retire `"src/editor.ts"` et `"src/dashboard/quiz-open.ts"` de `RESTANTS`. Ils ne
vont dans AUCUNE autre liste : `check:dashboard-dom` ne couvre que
`src/dashboard/`, et ces fichiers ne sont plus sous `src/` du tout.

Contrôles, un par ligne, code de sortie relevé : `npm run check`,
`npm run check:app`, `npm run check:host`, `npm run check:dashboard-dom`,
`npm run build`.

`check:host` annonce **26**. `npm run build` est ici obligatoire et pas
décoratif : c'est lui qui construit le greffon avec ses nouveaux chemins, et une
résolution ratée n'apparaîtrait pas autrement.

- [ ] **Étape 6 : commit**

```bash
git add -A src apps/obsidian scripts/check-host.mjs
git commit -m "refactor(obsidian): editor et quiz-open rejoignent leur hote"
```

---

## Tâche 3 — `editor-ctx.ts` et `editor-form.ts` : le formulaire et l'image collée

Le plus gros morceau de la tranche (620 lignes, 78 extensions DOM), et le seul
qui exerce `writeBinary` et `attachmentPathFor`. `editor-ctx.ts` part avec lui
parce qu'il ne décrit QUE ce formulaire : les séparer ferait deux revues d'un
seul changement.

**Fichiers :**
- Modifier : `src/types/editor-ctx.ts` (98 lignes, `type App`, `type Plugin`)
- Modifier : `src/editor/editor-form.ts` (620 lignes, 78 extensions, `Notice`)
- Modifier : `scripts/check-host.mjs`

**Interfaces :**
- Consomme : `currentHost().fs.writeBinary`, `currentHost().paths.attachmentPathFor`,
  `currentHost().ui.notice` (tâche 1) ; `ajouter` (`src/dom.ts`) ;
  `reserveFreePath`/`releaseReservedPath` (`src/unique-path.ts`).
- Produit : `EditorCtx` **sans `app` ni `plugin`**, `EditorHostView` **sans `app`
  ni `plugin`**. Les tâches 4 et 7 en dépendent : c'est ce retrait qui libère
  `detail-form-bridge.ts` et `detail-question.ts` de leur passe-plat.

### Ce qui rend cette tâche différente d'une conversion ordinaire

`CLAUDE.md` dit de `types/editor-ctx.ts` : « ne pas l'élargir, c'est cette
étroitesse qui rend le formulaire réutilisable ». Cette tâche le RÉTRÉCIT
encore : `app` et `plugin` disparaissent des deux interfaces. Vérifié par
`grep -n '\bplugin\b' src/editor/editor-form.ts` : leurs deux seuls usages
(lignes 266 et 422) sont `ctx.plugin.app`, c'est-à-dire un porteur d'`App` et
rien d'autre. Il n'y a donc rien à remplacer, seulement à supprimer.

- [ ] **Étape 1 : le chemin de l'image collée**

`cheminImageCollee` (vers la ligne 40-70) fait trois choses qui passent toutes
par l'hôte :

```ts
	const propose = await app.fileManager.getAvailablePathForAttachment(
		`Pasted image ${ts}.${ext}`, sourcePath);
	const point = propose.lastIndexOf(".");
	const filePath = await reserveFreePath(
		point > 0 ? propose.slice(0, point) : propose,
		point > 0 ? propose.slice(point) : "",
		(c) => app.vault.adapter.exists(c));
```

devient :

```ts
	const propose = await currentHost().paths.attachmentPathFor(
		`Pasted image ${ts}.${ext}`, sourcePath);
	const point = propose.lastIndexOf(".");
	const filePath = await reserveFreePath(
		point > 0 ? propose.slice(0, point) : propose,
		point > 0 ? propose.slice(point) : "",
		(c) => currentHost().fs.exists(c));
```

**La RÉSERVATION reste, et ce n'est pas une redondance.** Le commentaire sur
place l'explique : `attachmentPathFor` déduplique contre ce qui EXISTE, la
réservation décide du nom quand deux collages se suivent avant que le premier
fichier soit écrit. Les deux hôtes ont le même trou, et c'est le même filet.

- [ ] **Étape 2 : les deux écritures binaires**

Lignes 270 et 427 aujourd'hui :

```ts
								await app.vault.adapter.writeBinary(filePath, new Uint8Array(buffer));
```

devient :

```ts
								await currentHost().fs.writeBinary(filePath, new Uint8Array(buffer));
```

Le `try`/`catch` autour, avec son `releaseReservedPath(filePath)`, **reste tel
quel** : le commentaire dit qu'un rejet dans un gestionnaire `async` ne remonte
nulle part, et que sans lui le collage ne faisait simplement rien.

Le type local `EditorApp` et les casts `ctx.plugin.app as unknown as EditorApp`
disparaissent avec leur dernier usage. **Vérifie qu'aucun autre site ne les
emploie** avant de supprimer le type.

- [ ] **Étape 3 : les `Notice` et les 78 extensions DOM**

Applique la recette. Le fichier est long : convertis-le d'un bout à l'autre en
une seule passe, sans sauter de section, puis compte.

```bash
node -e "const s=require('fs').readFileSync('src/editor/editor-form.ts','utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');console.log((s.match(/\.(createEl|createDiv|createSpan|empty|setText|addClass|removeClass|toggleClass|detach|appendText|setAttr)\s*\(/g)||[]).length)"
```

Attendu : `0`.

- [ ] **Étape 4 : `editor-ctx.ts`**

Retire `import type { App, Plugin } from "obsidian";` et les quatre champs
(`app` et `plugin` sur `EditorHostView`, `app` et `plugin` sur `EditorCtx`).

Le commentaire d'en-tête du fichier explique pourquoi il est étroit ; **ajoute
une phrase disant pourquoi il l'est devenu davantage**, dans le même ton : les
deux champs ne portaient qu'une capacité d'écriture que l'hôte fournit
maintenant, et les garder aurait obligé la fenêtre à fabriquer une fausse `App`.

`sourcePath` reste, et son commentaire aussi : il ne parle pas d'Obsidian mais
de la note éditée, et `attachmentPathFor` en dépend exactement pour la même
raison.

- [ ] **Étape 5 : la vérification qui ne ment pas**

Les deux fichiers sortent de `RESTANTS`. Puis, dans l'ordre :

1. import TEMPORAIRE d'`editor-form.ts` dans `apps/windows/src/main.ts`, avec
   une RÉFÉRENCE à ce qui est importé ;
2. `npm run check:app`, code de sortie relevé ;
3. **compare le nombre de modules** avec et sans (base : 1940). Un delta nul
   signifie que rien n'a été vérifié ;
4. retire l'import, et prouve-le par `git diff --stat`.

Puis : `npm run check`, `npm run check:host`, `npm run check:md`,
`npm run check:export`. `check:host` annonce **24**.

`check:md` et `check:export` chargent le CODE RÉEL de la chaîne de rendu et
d'écriture, qui passe par `md2html` et `makeDefault` : ce sont eux qui diraient
qu'une conversion a changé un comportement.

- [ ] **Étape 6 : commit**

```bash
git add src/types/editor-ctx.ts src/editor/editor-form.ts scripts/check-host.mjs
git commit -m "refactor(editor-form): le formulaire et l'image collee passent par le contrat"
```

---

## Tâche 4 — `question-preview.ts` et `quiz-source-ref.ts` : résoudre un lien

Les deux fichiers qui transforment un lien de note en fichier. Ensemble parce
qu'ils font le même geste par deux chemins différents, et que les unifier sur
`HostLinks` est l'essentiel du travail.

**Fichiers :**
- Modifier : `src/editor/question-preview.ts` (290 lignes, 46 extensions, `type App`)
- Modifier : `src/quiz-source-ref.ts` (87 lignes, `type App`, `type TFile`)
- Modifier : `apps/obsidian/plugin.ts` (unique appelant de `resolveQuizSourceRef`)
- Modifier : `scripts/check-host.mjs`

**Interfaces :**
- Consomme : `currentHost().links.resolve`, `.links.resourceUrl`,
  `currentHost().fs.readCached`, `ajouter`.
- Produit : `renderQuestionView(parent, q, index, sourcePath?)` — **le paramètre
  `app` DISPARAÎT de la signature**. La tâche 7 en dépend directement :
  `detail-question.ts` cesse alors d'avoir besoin d'`App`.
  `resolveQuizSourceRef` perd de même son paramètre `app` ; vérifie sa signature
  réelle avant de la réécrire.

### Le gain caché, à ne pas rater

`question-preview.ts` résout ses images en TROIS temps aujourd'hui
(lignes 85-96) : `getFirstLinkpathDest`, puis un calcul manuel à partir du
réglage `attachmentFolderPath`, puis `getResourcePath`. Le commentaire sur place
dit que le deuxième temps « ne marche que si la pièce jointe est EXACTEMENT dans
le dossier configuré — d'où des aperçus sans image alors que le quiz, lui, les
affichait ».

`HostLinks` fait déjà exactement le bon geste, et son contrat l'écrit :
`resourceUrl` « RÉSOUT puis convertit », par la même voie que `resolve`, et rend
`null` quand rien ne correspond. Le remplacement n'est donc pas une conversion à
iso-comportement : **c'est l'aperçu qui rejoint la résolution du MOTEUR**, celle
que `engine/sanitizer.ts` emploie déjà. Les trois temps deviennent un.

**Dis dans ton rapport si un cas se perd.** Le calcul manuel couvrait la
situation « la pièce jointe est dans le dossier configuré mais le
`metadataCache` ne l'a pas indexée ». Si tu ne trouves pas de raison pour
laquelle `HostLinks` la couvre aussi, écris-le plutôt que de le supposer : une
régression annoncée vaut mieux qu'une régression découverte par Ahmed.

- [ ] **Étape 1 : la résolution d'image de `question-preview.ts`**

Le bloc des lignes 80-97 se réduit à :

```ts
		/* `links.resourceUrl` fait les DEUX temps d'un coup, et par la même
		   voie que le moteur (`engine/sanitizer.ts`) : il résout le lien comme
		   la note l'entend, puis en fait une URL affichable. Rendre `null` est
		   un cas PRÉVU (le contrat l'exige) : on laisse alors le `src` d'origine
		   intact plutôt que d'écrire une chaîne vide, qui ferait recharger la
		   page courante comme image. */
		const url = currentHost().links.resourceUrl(lien, sourcePath);
		if (url) img.setAttribute("src", url);
```

Le type local `VaultWithGetConfig` disparaît avec son dernier usage.

- [ ] **Étape 2 : les 46 extensions DOM et le paramètre `app`**

Applique la recette. Retire `app: App` de `renderQuestionView`, de
`inlineInto` et de toute autre fonction du fichier qui ne le passait qu'en
transit — **compte-les d'abord** (`grep -n 'app' src/editor/question-preview.ts`),
puis retire-les toutes dans le même mouvement : en laisser une rendrait le
fichier incohérent avec sa propre signature publique.

`tpl.innerHTML = html` et `sanitizeQuizHtml(tpl.innerHTML)` **ne changent pas** :
c'est la porte du sanitizer, et le `<template>` est ce qui rend le HTML inerte
pendant la lecture (`CLAUDE.md`, « pour lire du HTML sans l'exécuter,
`<template>`, jamais un `<div>` détaché »).

- [ ] **Étape 3 : `quiz-source-ref.ts`**

Deux appels seulement (lignes 62 et 65) :

```ts
	const file: TFile | null = app.metadataCache.getFirstLinkpathDest(linkpath, fromPath);
	// …
	const content = await app.vault.cachedRead(file);
```

deviennent :

```ts
	const file = currentHost().links.resolve(linkpath, fromPath);
	// …
	const content = await currentHost().fs.readCached(file.path);
```

`readCached` et non `read` : c'est le chemin du balayage, et le contrat dit
qu'un hôte a le droit d'y servir son cache. Conserver la même méthode conserve
la même conduite sous Obsidian.

Le fichier perd son paramètre `app` ; `apps/obsidian/plugin.ts:26` est son
UNIQUE appelant (vérifié par grep sur tout le dépôt), l'ajustement y tient en
une ligne.

- [ ] **Étape 4 : les listes et les contrôles**

Les deux fichiers sortent de `RESTANTS`. Aucun des deux n'est sous
`src/dashboard/` : ne les ajoute pas à `LIBERES`.

Import temporaire depuis `main.ts`, `npm run check:app`, delta de modules,
retrait de l'import. Puis `npm run check`, `npm run check:host`,
`npm run check:md`, `npm run check:markers`. `check:host` annonce **22**.

`check:markers` passe chaque champ texte des vrais vaults par la fonction de
rendu : c'est lui qui verrait une grammaire abîmée par la conversion. Attention,
il éprouve la GRAMMAIRE et pas le CÂBLAGE — un champ affiché sans appeler le
rendu du tout y passe pour sain.

- [ ] **Étape 5 : commit**

```bash
git add src/editor/question-preview.ts src/quiz-source-ref.ts apps/obsidian/plugin.ts scripts/check-host.mjs
git commit -m "refactor(preview): la resolution d'un lien passe par HostLinks"
```

---

## Tâche 5 — `editor/modals.ts` : deux classes deviennent deux fonctions

**Fichiers :**
- Modifier : `src/editor/modals.ts` (129 lignes, 19 extensions, `type App`,
  deux sous-classes de `QbdModal`)
- Modifier : ses appelants — `src/dashboard/detail.ts`,
  `src/dashboard/detail-question.ts`, `src/dashboard/detail-io.ts` (celui-ci
  n'en importe qu'un TYPE, `ParsedQuizItem` : vérifie avant de le toucher)
- Modifier : `scripts/check-host.mjs`

**Interfaces :**
- Consomme : `currentHost().modals.open(spec)` (tranche 2.6), `ajouter`.
- Produit : deux fonctions d'ouverture en remplacement des deux classes.
  **Lis les deux constructeurs (`modals.ts:41` et `:97`) et recopie leurs
  paramètres exacts** — les noms ci-dessous sont un argument sur la forme, pas
  une mesure de leur contenu :

```ts
export function openConfirmModal(opts: { … }, onConfirm: () => void): void
export function openTypePickerModal(opts: { … }, onPick: (type: string) => void): void
```

### Ce qui n'est pas évident

**`src/modal-base.ts` ne quitte PAS `RESTANTS`, et il ne faut pas essayer de
l'y forcer.** Quatre sous-classes de `QbdModal` restent après cette tâche :
`quiz-menu.ts` en a deux (converties en tâche 9), `share.ts` et
`usage-modal.ts` une chacune, toutes deux hors périmètre. `QbdModal` doit
continuer d'exister pour elles.

Les deux mondes coexistent sans danger : l'hôte Obsidian de `HostModals`
s'appuie LUI-MÊME sur `QbdModal` (`apps/obsidian/host.ts`), donc les modales
converties et les non converties s'animent exactement pareil. C'est ce qui rend
la conversion invisible à l'écran, et c'est aussi ce qui fait qu'aucun script ne
peut la juger : voir la liste finale.

**Ces deux modales n'ont AUCUNE classe de panneau** (vérifié : ni `modals.ts:41`
ni `:97` ne posent de `className`). C'est pour elles que
`apps/windows/src/assets/modal.css` porte son plancher `min-width: min(420px,
calc(100vw - 32px))` — sans lui, elles se réduiraient à la largeur de leur
texte. Ne pose pas de `className` « pour faire propre » : tu changerais leur
largeur sans le vouloir.

- [ ] **Étape 1 : le patron**

```ts
export function openConfirmModal(/* les paramètres réels */): void {
	currentHost().modals.open({
		// t() AU RENDU, jamais dans une constante de haut niveau : une chaîne
		// figée à l'assemblage ignorerait un changement de langue.
		title: /* … */,
		onOpen: (m) => {
			const c = m.contentEl;
			/* … le corps d'onOpen(), avec `this.close()` devenu `m.close()`
			   et les extensions DOM converties … */
		},
	});
}
```

**`m.contentEl.empty()` disparaît là où `onClose` le faisait** : l'hôte vide le
corps lui-même, le contrat de la tranche 2.6 le promet. Le laisser ne casserait
rien mais ferait croire à un besoin qui n'existe plus.

- [ ] **Étape 2 : les appelants**

`new ConfirmModal(app, opts, onConfirm).open()` devient
`openConfirmModal(opts, onConfirm)`. Le paramètre `app` disparaît de la liste
d'arguments — **c'est ce retrait qui fait tomber `App` de plusieurs appelants**,
et il faut le suivre jusqu'au bout dans chacun d'eux plutôt que de laisser un
`ctx.app` inutilisé derrière.

- [ ] **Étape 3 : les listes et les contrôles**

`editor/modals.ts` sort de `RESTANTS`, ne va pas dans `LIBERES` (il n'est pas
sous `src/dashboard/`). `modal-base.ts` reste dans `RESTANTS`.

Import temporaire, `npm run check:app`, delta de modules, retrait. Puis
`npm run check`, `npm run check:host`, `npm run check:export`. `check:host`
annonce **21**.

`check:export` parce que `ParsedQuizItem` et `_htmlToText` vivent dans ce
fichier et que le script les charge pour de vrai (voir son bouchon `document`
en tête) : s'il passe au vert sans que tu aies rien fait pour, **éprouve-le** —
casse une règle qu'il prétend garder et vois-le rougir.

- [ ] **Étape 4 : commit**

```bash
git add src/editor/modals.ts src/dashboard scripts/check-host.mjs
git commit -m "refactor(modals): la confirmation et le choix de type passent par HostModal"
```
---

## Tâche 6 — `detail-io.ts` : l'écriture du bloc, et le contrôle qui lui manque

**La tâche la plus irréversible de la tranche.** Ce fichier est le seul chemin
par lequel la page réécrit une note de l'utilisateur. Il ne compte AUCUNE
extension DOM : tout le travail est dans la sémantique.

**Fichiers :**
- Modifier : `src/dashboard/detail-io.ts` (187 lignes, `TFile`, `type App`)
- Créer : `scripts/check-quiz-io.mjs`
- Modifier : `package.json` (le script `check:quiz-io`)
- Modifier : `docs/superpowers/notes/controles.md` (une entrée de plus)
- Modifier : ses appelants — `src/dashboard/detail.ts`,
  `apps/obsidian/editor.ts`
- Modifier : `scripts/check-host.mjs`, `scripts/check-dashboard-dom.mjs`

**Interfaces :**
- Consomme : `currentHost().fs.process`, `.fs.read`, `.fs.getFile` (tâche 1).
- Produit : `QuizDraft.file` devient `HostFile | null` ;
  `loadQuizDraft(path)` et `saveQuizDraft(draft)` **perdent leur paramètre
  `app`**. Les tâches 8 et 10 en dépendent.

### Pourquoi un contrôle neuf, et pas seulement une conversion

`check:export` garde `exportAll` (la FORME du bloc produit) et
`audit-vaults.mjs` garde l'aller-retour sur de vrais vaults. **Entre les deux,
le CÂBLAGE de l'écriture n'a rien** : ni le compare-and-swap sur le bloc, ni la
préservation des fins de ligne, ni celle des clôtures. Les trois sont pourtant
documentés dans le fichier comme des correctifs de bugs réels (revue codex du
2026-07-31), et deux d'entre eux ont régressé la même nuit où ils ont été
écrits.

Convertir ce fichier sans lui donner un contrôle reviendrait à confier la
non-régression de la sauvegarde à une relecture. **Le contrôle s'écrit AVANT la
conversion**, sur le code actuel : c'est la seule façon de savoir qu'il ne fait
pas que refléter le code converti.

- [ ] **Étape 1 : écrire `scripts/check-quiz-io.mjs` sur le code ACTUEL**

Le harnais est celui des autres contrôles : `withSrcModule` et `makeReporter`
de `scripts/lib/load-src.mjs`, qui chargent le CODE RÉEL par esbuild et
fournissent un bouchon `obsidian`. Lis `scripts/check-export.mjs` en entier
avant d'écrire : il montre le bouchon `document` dont `_htmlToText` a besoin,
et tu auras le même problème.

Huit cas, chacun éprouvé par DISCRIMINANCE :

| Cas | Règle gardée | Comment la casser |
|---|---|---|
| un bloc lu puis réécrit sans modification produit un bloc qui SE RELIT | la sauvegarde refusée en silence | faire écrire `exportAll` sans repasser par `parseQuizSource` |
| une note en CRLF reste en CRLF | un diff entier à chaque frappe, une synchro qui rejoue tout | écrire `source` au lieu de `source.replace(/\r?\n/g, eol)` |
| le témoin mémorisé est ce qui a été VRAIMENT écrit | la SECONDE sauvegarde perdue en silence dans une note CRLF | mémoriser `source` au lieu de `temoin` |
| la ligne d'ouverture avec attributs est préservée | ` ```quiz-blocks data-owner=alice ` effacé sans demande | réécrire une clôture canonique |
| la fermante INDENTÉE est préservée | idem, dans un bloc en liste | idem |
| un bloc modifié dehors depuis la lecture n'est PAS écrasé, et `saveQuizDraft` rend `false` | deux pages qui s'écrasent en annonçant toutes deux un succès | retirer la comparaison `actuel[1] !== draft.blockSource` |
| un quiz contenant `$1$` ou une apostrophe inversée ne réinjecte pas la source | un quiz de maths détruit par les motifs de remplacement | remplacer par CHAÎNE au lieu de par FONCTION |
| `loadQuizDraft` rend `"noBlock"` sur une note sans bloc et `"fileNotFound"` sur un chemin absent | une page vide sans message | rendre un brouillon vide |

L'avant-dernier mérite un mot : c'est le seul de la liste dont la casse ne
produit PAS d'erreur visible, seulement une note silencieusement corrompue.
Écris-le avec une vraie question contenant `$1$` **et** une apostrophe inversée,
et compare le bloc écrit CARACTÈRE PAR CARACTÈRE, pas par une expression
régulière qui pourrait matcher les deux formes.

Le faux hôte du script fournit `fs.process`, `fs.read` et `fs.getFile` sur une
carte en mémoire. **`process` doit y REJOUER son rappel au moins une fois dans
un des cas** : le contrat le permet, `detail-io.ts` s'en protège par son drapeau
`ecrit` remis à faux en tête, et aucun cas ne le vérifie aujourd'hui.

Ajoute la ligne dans `package.json` :

```json
    "check:quiz-io": "node scripts/check-quiz-io.mjs",
```

et l'entrée correspondante dans `docs/superpowers/notes/controles.md`, en disant
LE DÉFAUT que le contrôle empêche — c'est la règle du fichier, pas la
description du script.

- [ ] **Étape 2 : le voir passer sur le code actuel, puis convertir**

Lance `npm run check:quiz-io` sur le code AVANT conversion : les huit cas
doivent être verts. Un cas rouge ici est un cas mal écrit, pas un bug trouvé —
tu n'as encore rien changé.

Puis la conversion. `QuizDraft.file` passe de `TFile | null` à
`HostFile | null` ; `HostFile` porte `path` et `mtime` (plat), donc
`draft.file.stat?.mtime ?? 0` devient `draft.file.mtime`.

```ts
export async function loadQuizDraft(path: string): Promise<QuizDraft | QuizLoadError> {
	const file = currentHost().fs.getFile(path);
	if (!file) return "fileNotFound";
	let content: string;
	try {
		content = await currentHost().fs.read(path);
	} catch {
		return "loadError";
	}
	// … la suite ne change pas …
	return { file, questions, examOptions, mtime: file.mtime, blockSource: match[1] };
}
```

et dans `saveQuizDraft`, `await app.vault.process(file, (content) => {…})`
devient `await currentHost().fs.process(file.path, (content) => {…})`. **Le
corps du rappel ne change pas d'une ligne** : c'est lui qui porte les quatre
comportements que le contrôle garde.

**Le piège de la dernière ligne** : `draft.mtime = file.stat?.mtime ?? draft.mtime`
lisait le `mtime` RAFRAÎCHI du `TFile` après l'écriture, parce qu'Obsidian met
son objet à jour en place. Un `HostFile` est plat et FIGÉ : le relire ne
donnerait rien de neuf. Il faut donc redemander le fichier à l'hôte :

```ts
			// Relire l'INDEX plutôt que le HostFile en main : ce dernier est un
			// instantané figé (`src/host/types.ts`, « volontairement plat »),
			// là où le `TFile` d'Obsidian se mettait à jour tout seul. Sans
			// cette relecture, notre propre écriture passerait pour une
			// modification EXTERNE au rendu suivant (cf. `draftIsStale`).
			draft.mtime = currentHost().fs.getFile(file.path)?.mtime ?? draft.mtime;
```

**Vérifie que cette relecture donne bien un `mtime` frais dans les DEUX hôtes**
avant de la croire : sous Obsidian l'index est à jour dans l'appel, mais
l'application n'apprend le changement que par un surveillant DÉBOUNCÉ de 300 ms
(`apps/windows/src/host/fs.ts`) — le contrat de `write` le dit en toutes
lettres. Si le `mtime` de la fenêtre est périmé ici, la conséquence est un
`draftIsStale` qui se déclenche à tort, donc une Notice « modifié dehors »
après CHAQUE sauvegarde. Si c'est le cas, dis-le et propose la sortie plutôt
que de la choisir seul : ce n'est pas un détail d'implémentation, c'est une
Notice qui ment à l'utilisateur toutes les 600 ms.

- [ ] **Étape 3 : les appelants**

`loadQuizDraft(ctx.app, quiz.path)` devient `loadQuizDraft(quiz.path)` et
`saveQuizDraft(ctx.app, draft)` devient `saveQuizDraft(draft)`, dans
`src/dashboard/detail.ts` (deux sites, vers les lignes 118-119) et dans
`apps/obsidian/editor.ts`.

- [ ] **Étape 4 : les listes et les contrôles**

`detail-io.ts` sort de `RESTANTS` et entre dans `LIBERES`.

Import temporaire, `npm run check:app`, delta de modules, retrait. Puis
`npm run check`, `check:host` (**20**), `check:dashboard-dom`, `check:quiz-io`,
`check:export`, `check:scanner`.

- [ ] **Étape 5 : l'audit sur de vrais vaults, qui n'est pas optionnel**

```bash
node scripts/audit-vaults.mjs "C:/obsidian-vaults/Personal" "C:/obsidian-vaults/Efrei"
```

`CLAUDE.md` l'impose à chaque retouche de `convertParsedToInternal` ou
d'`exportAll`. Cette tâche ne les modifie pas, mais elle modifie **le seul
appelant qui les enchaîne sur une vraie note**. Aucun fichier n'est modifié par
l'audit. Le passif de ces deux fonctions est écrit dans `controles.md` :
`textVariant: 'command'` a déjà effacé 23 invites de terminal d'un quiz Cisco.

- [ ] **Étape 6 : commit**

```bash
git add src/dashboard/detail-io.ts src/dashboard/detail.ts apps/obsidian/editor.ts scripts package.json docs/superpowers/notes/controles.md
git commit -m "refactor(detail-io): l'ecriture d'un bloc passe par le contrat, et gagne son controle"
```

---

## Tâche 7 — Les trois satellites de la page

Trois fichiers ensemble parce que deux d'entre eux ne font que TRANSMETTRE
`app` et `plugin`, et que ce passe-plat disparaît d'un seul geste une fois les
tâches 3 et 4 faites.

**Fichiers :**
- Modifier : `src/dashboard/detail-exam.ts` (141 lignes, 11 extensions, `setIcon`)
- Modifier : `src/dashboard/detail-form-bridge.ts` (108 lignes, 0 extension,
  `type App`, `type Plugin`)
- Modifier : `src/dashboard/detail-question.ts` (309 lignes, 21 extensions,
  `type App`, `type Plugin`)
- Modifier : `src/dashboard/detail.ts` (les sites d'appel seulement)
- Modifier : `scripts/check-host.mjs`, `scripts/check-dashboard-dom.mjs`

**Interfaces :**
- Consomme : `renderQuestionView` sans `app` (tâche 4), `EditorCtx` sans `app`
  ni `plugin` (tâche 3), `openTypePickerModal` (tâche 5).
- Produit : `renderQuestionView` / `renderQuestionEdit` / `renderExamPanel` /
  `createFormBridge` **sans `app` ni `plugin`**. La tâche 8 en dépend.

### L'ordre est contraint, et il ne se négocie pas

`detail-question.ts` n'emploie `app` que pour le passer à `renderQuestionView`
(lignes 35 et 58, vérifié par `grep -n '\bapp\b'`). `detail-form-bridge.ts`
n'emploie `plugin` que pour le poser dans l'`EditorHostView` (lignes 69 et 91).
**Les deux champs n'ont donc plus de destinataire dès que les tâches 3 et 4
sont faites** : il n'y a rien à convertir, seulement à supprimer.

Si l'une des deux n'est pas faite, cette tâche ne compile pas. C'est voulu :
c'est le signal, pas un obstacle.

- [ ] **Étape 1 : `detail-exam.ts`**

Le plus simple des trois : `setIcon` et onze extensions DOM, rien d'autre.
Applique la recette.

- [ ] **Étape 2 : `detail-form-bridge.ts`**

Retire `import type { App, Plugin } from "obsidian";` et les champs `app` /
`plugin` de ses options comme de l'`EditorHostView` qu'il fabrique. Zéro
extension DOM : le fichier ne construit rien, il assemble un contrat.

**Le commentaire d'en-tête d'`editor-ctx.ts` explique que ce pont existe pour
garder le formulaire réutilisable.** Si le retrait des deux champs rend le pont
plus étroit, écris-le là-bas plutôt qu'ici : c'est le fichier que la tranche
suivante lira.

- [ ] **Étape 3 : `detail-question.ts`**

Vingt et une extensions DOM, plus le retrait d'`app` et `plugin` de ses
options et de ses deux appels à `renderQuestionView`.

Attention au commentaire de la ligne ~282 (« … peuvent pas transitionner, cf.
obsidian:plugin-dev §6 ter ») : il parle d'une contrainte de RENDU, pas
d'Obsidian l'API. Ne le supprime pas en croyant nettoyer une référence à
l'hôte.

- [ ] **Étape 4 : les sites d'appel dans `detail.ts`**

`detail.ts` construit ses appels avec `ctx.app` / `ctx.plugin` (lignes ~102 et
~616). Retire les arguments devenus inutiles. **`detail.ts` reste dans
`RESTANTS`** : il importe encore `setIcon` et `Notice`, et c'est la tâche 8 qui
l'en sort. Ne le convertis pas ici — ce serait fondre deux revues en une.

- [ ] **Étape 5 : les listes et les contrôles**

Les trois fichiers sortent de `RESTANTS` et entrent dans `LIBERES` (ils sont
tous sous `src/dashboard/`).

Import temporaire, `npm run check:app`, delta de modules, retrait. Puis
`npm run check`, `check:host` (**17**), `check:dashboard-dom`, `check:md`,
`check:quiz-io`.

- [ ] **Étape 6 : commit**

```bash
git add src/dashboard/detail-exam.ts src/dashboard/detail-form-bridge.ts src/dashboard/detail-question.ts src/dashboard/detail.ts scripts/check-host.mjs scripts/check-dashboard-dom.mjs
git commit -m "refactor(detail): les trois satellites de la page passent par le contrat"
```

---

## Tâche 8 — `detail.ts` : la page de quiz elle-même

Le livrable visible de la tranche. 810 lignes, 54 extensions DOM, et c'est le
fichier que `CLAUDE.md` décrit comme servant **trois hôtes** (la vue détail du
tableau de bord, la page « Générer », l'onglet `quiz-blocks-builder`).

**Fichiers :**
- Modifier : `src/dashboard/detail.ts`
- Modifier : `scripts/check-host.mjs`, `scripts/check-dashboard-dom.mjs`

**Interfaces :**
- Consomme : tout ce que les tâches 2 à 7 produisent.
- Produit : `createQuizPage(ctx: QuizPageDeps)` avec un `QuizPageDeps` **réduit
  à `{ statsStore?: … }`** ; `createDetailHandlers(ctx: DashboardShellCtx)`.
  `QuizPageSpec` et `QuizPageHandlers` **ne changent pas d'un champ** : c'est ce
  qui permet à la tâche 10 de monter la page sans rien inventer.

### Ce qui rend ce fichier facile, et il faut le savoir avant de s'en méfier

`QuizPageSpec` porte déjà `load()` et `save?()` en CLÔTURES fournies par
l'hôte. La page ne sait donc pas lire ni écrire : elle appelle ce qu'on lui
donne. **Tout le découplage était déjà fait** — par la refonte du 2026-07-21,
pour permettre à la page « Générer » d'afficher un quiz encore en mémoire.

Il ne reste donc que trois choses :

1. `setIcon` et `Notice` (recette) ;
2. les 54 extensions DOM (recette) ;
3. `QuizPageDeps` perd `app` et `plugin`, qui n'étaient là que pour les
   satellites de la tâche 7 ;
4. `createDetailHandlers` s'élargit de `DashboardCtx` à `DashboardShellCtx`.

Le quatrième point est celui qui FORCE le vrai travail, exactement comme
l'élargissement de la tâche 5 de la tranche 2.6. Retirer les imports suffirait à
faire taire `check:host`, mais le fichier atteindrait encore Obsidian par
`ctx.app`, dont le TYPE vient de `DashboardCtx`. Il sortirait de `RESTANTS`,
aurait l'air propre, et planterait dans la fenêtre où `ctx.app` n'existe pas.
**Élargis le paramètre AVANT de convertir** : les appels impossibles deviennent
alors des erreurs de compilation, donc visibles.

- [ ] **Étape 1 : élargir le `ctx` et voir ce qui casse**

Remplace `DashboardCtx` par `DashboardShellCtx` dans la signature de
`createDetailHandlers`, puis lance `npm run check` et **lis la liste des
erreurs** : c'est l'inventaire exact de ce qui reste à traiter. Note-la dans
ton rapport avant de la traiter, elle vaut mieux qu'un résumé.

Les membres attendus dans cette liste (mesure du 2026-09-09) : `ctx.app` passé à
`loadQuizDraft`/`saveQuizDraft` (déjà traité en tâche 6),
`ctx.app`/`ctx.plugin` passés à `createQuizPage` (traité ici),
`ctx.view.previousView`, `ctx.view.quizzes?.openFolderOfQuiz`,
`ctx.view.currentView`. **Les trois derniers sont le vrai sujet.**

`ctx.view` n'existe QUE sur `DashboardCtx` (c'est la vue Obsidian). Deux sorties
possibles, et il faut choisir en le disant :

- déplacer ces trois usages dans le `spec` que l'HÔTE construit (`onBack`,
  `isStale`), ce que la forme de `QuizPageSpec` invite déjà à faire — `onBack`
  et `isStale` y sont précisément des clôtures de l'hôte ;
- ou ajouter un membre au `DashboardShellCtx`.

**La première est la bonne**, et pour une raison qui se vérifie : `onBack` et
`isStale` sont DÉJÀ des champs de `QuizPageSpec`, et c'est `createDetailHandlers`
qui les remplit. Il suffit que la partie « qui dépend de la vue » remonte d'un
cran, chez l'appelant qui, lui, connaît son hôte. Si tu constates que ça ne
suffit pas, dis-le et propose la seconde plutôt que de mélanger les deux.

- [ ] **Étape 2 : la conversion**

`setIcon`, `Notice`, les 54 extensions. Applique la recette d'un bout à
l'autre, puis compte :

```bash
node -e "const s=require('fs').readFileSync('src/dashboard/detail.ts','utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');console.log((s.match(/\.(createEl|createDiv|createSpan|empty|setText|addClass|removeClass|toggleClass|detach|appendText|setAttr)\s*\(/g)||[]).length)"
```

Attendu : `0`.

`closeAllSelects`, `mathifyElement` et `mountSlideHost` sont importés de
fichiers DÉJÀ libres : ne les touche pas.

- [ ] **Étape 3 : les listes et les contrôles**

`detail.ts` sort de `RESTANTS`, entre dans `LIBERES`.

Import temporaire, `npm run check:app`, delta de modules (attends-toi au plus
gros de la tranche : ce fichier en tire beaucoup), retrait. Puis
`npm run check`, `check:host` (**16**), `check:dashboard-dom`, `check:quiz-io`,
`check:md`, `check:markers`, `npm run build`.

- [ ] **Étape 4 : commit**

```bash
git add src/dashboard/detail.ts scripts/check-host.mjs scripts/check-dashboard-dom.mjs
git commit -m "refactor(detail): la page d'un quiz ne connait plus son hote"
```

---

## Tâche 9 — `quiz-menu.ts` : renommer et supprimer

La dernière conversion, et celle qui exerce `trash` et `process`.

**Fichiers :**
- Modifier : `src/dashboard/quiz-menu.ts` (329 lignes, 12 extensions, `Notice`,
  `TFile`, `type App`, deux sous-classes de `QbdModal`)
- Modifier : `src/types/dashboard-ctx.ts` (un membre `shareQuiz?`)
- Modifier : `src/dashboard.ts` (le greffon remplit le nouveau membre)
- Modifier : `scripts/check-host.mjs`, `scripts/check-dashboard-dom.mjs`
- Modifier : `src/i18n/en/dashboard.ts`, `src/i18n/fr/dashboard.ts` si une clé
  manque (voir l'étape 4)

**Interfaces :**
- Consomme : `currentHost().fs.process`, `.fs.trash`, `.fs.getFile`,
  `currentHost().modals.open` (tâche 1 et tranche 2.6).
- Produit : `buildQuizCardMenu(ctx, rerender)` et
  `buildModuleCardMenu(ctx, rerender, map)` typés `DashboardShellCtx`.
  La tâche 10 les appelle depuis l'application.

### Les quatre entrées, et ce que chacune devient

| Entrée | Aujourd'hui | Demain |
|---|---|---|
| Partager | `new ShareModal(ctx, …).open()` | `ctx.shareQuiz?.(…)` — **absent côté app** |
| Éditer | `ctx.navigate("detail", { quiz, edit: true })` | inchangé |
| Renommer | `fileManager.renameFile` | `ctx.renameQuiz?.(…)` — voir plus bas |
| Supprimer | `vault.process` puis `fileManager.trashFile` | `fs.process` puis `fs.trash` |

### Pourquoi le renommage passe par le `ctx` et non par `HostFs`

`HostFs.rename` existe déjà, et il ne fait PAS la même chose : le commentaire de
`quiz-menu.ts:71` dit « via fileManager.renameFile — jamais vault.rename », et
la raison est qu'Obsidian met à jour **les wikilinks des autres notes** qui
pointent vers celle qu'on renomme. `fs.rename` déplace des octets ; il ne
réécrit rien ailleurs.

Trois sorties étaient possibles. **Élargir `HostFs.rename` est la mauvaise** :
la migration du journal s'appuie sur sa sémantique actuelle (rejeter si la
destination existe), et lui ajouter une réécriture de liens changerait le
comportement sous les pieds d'un appelant qui n'en veut pas. **Ajouter un
`renameWithLinks` au contrat est la mauvaise aussi, aujourd'hui** : la fenêtre
n'a aucune façon honnête de l'implémenter — réécrire les liens d'un dossier
demande un index des liens ENTRANTS que l'application ne tient pas, et le
bricoler ici donnerait deux implémentations dont une fausse.

**La sortie retenue** : un membre optionnel `renameQuiz?` du `ctx`, rempli par
le greffon, absent de l'application, exactement comme `shareQuiz?`. L'entrée
« Renommer » disparaît alors du menu de la fenêtre. Le jour où l'application
tient un index des liens entrants, le membre devient un vrai membre de contrat.

**Le menu de l'application aura donc DEUX entrées sur quatre** (Éditer,
Supprimer), et non trois comme la section « Le périmètre » l'annonçait avant
cette mesure. Corrige-la si tu constates autre chose.

- [ ] **Étape 1 : les deux membres du `ctx`**

Dans `src/types/dashboard-ctx.ts`, à la suite des autres membres optionnels :

```ts
	/** Ouvre le partage d'un quiz ou d'un module (zip, Discord, enregistrer).
	    Optionnel et ABSENT côté application : `dashboard/share.ts` livre par
	    `child_process` et `electron.shell`, c'est-à-dire par le sous-contrat de
	    lancement de processus de la tranche 4 — et la spec §7 range de toute
	    façon « la distribution aux camarades » hors de ce chantier. L'entrée
	    « Partager » du menu « ⋯ » n'est simplement pas rendue dans la fenêtre. */
	shareQuiz?: (cible: { quiz?: QuizIndexEntry; group?: ModuleGroup }) => void;
	/** Renomme la note d'un quiz EN METTANT LES LIENS À JOUR. Optionnel et
	    absent côté application : seul Obsidian tient l'index des liens
	    ENTRANTS que cette opération exige (`fileManager.renameFile`).
	    `HostFs.rename` ne convient pas — il déplace des octets sans rien
	    réécrire ailleurs, et la migration du journal dépend de sa sémantique
	    actuelle. */
	renameQuiz?: (quiz: QuizIndexEntry, nom: string) => Promise<void>;
```

**Vérifie les types réels de `QuizIndexEntry` et `ModuleGroup`** et leurs
imports dans ce fichier avant d'écrire ces signatures.

- [ ] **Étape 2 : les deux modales**

`ConfirmModal` (ligne 49) et `RenameQuizModal` (ligne 75) deviennent des
fonctions, sur le patron de la tâche 5. `RenameQuizModal` appelle désormais
`ctx.renameQuiz?.()` au lieu de `fileManager.renameFile`, et sa garde
« le nom existe déjà » passe par `currentHost().fs.getFile(target)`.

- [ ] **Étape 3 : la suppression**

Les deux `ctx.app.vault.process(file, …)` (lignes 157 et 180) deviennent
`currentHost().fs.process(file.path, …)`, et
`ctx.app.fileManager.trashFile(file)` (ligne 195) devient
`currentHost().fs.trash(file.path)`.

`ctx.app.vault.getAbstractFileByPath(path)` + `instanceof TFile` devient
`currentHost().fs.getFile(path)`, qui rend `null` pour un dossier comme pour un
absent — **la garde reste nécessaire**, seule sa forme change.

`deleteModuleQuizzes` (vers la ligne 209) boucle sur les quiz d'un module :
vérifie que son comptage d'échecs se comporte pareil quand `getFile` rend
`null`, et que la Notice finale dit toujours la même chose.

- [ ] **Étape 4 : les entrées absentes ne laissent pas de trou**

`buildQuizCardMenu` et `buildModuleCardMenu` construisent des tableaux d'items.
Une entrée dont le membre du `ctx` est absent **ne doit pas être poussée dans le
tableau**, et surtout pas être poussée puis désactivée : un menu de quatre
lignes dont deux sont grises se lit comme une panne.

```ts
		const items: ActionMenuItem[] = [];
		// Poussée seulement si l'hôte sait partager : une entrée grise se lit
		// comme une panne, une entrée absente comme un hôte qui fait autre
		// chose (même geste que `onMenu?` sur les cartes, tranche 2.5).
		if (ctx.shareQuiz) items.push({ icon: "share-2", … });
```

Aucune clé i18n neuve n'est nécessaire pour ça. **Si tu crois en avoir besoin,
c'est probablement que tu as changé un comportement** — vérifie d'abord que la
clé n'existe pas déjà (`grep -rn '"menuShare"' src/i18n/`).

- [ ] **Étape 5 : le greffon remplit les deux membres**

Dans `src/dashboard.ts`, à côté d'`openCardMenu` (ligne 226) :

```ts
			shareQuiz: (cible) => { /* ShareModal, comme aujourd'hui */ },
			renameQuiz: (quiz, nom) => { /* fileManager.renameFile, comme aujourd'hui */ },
```

**Recopie le corps réel depuis `quiz-menu.ts` avant la conversion**, y compris
ses gardes et ses Notice : le greffon ne doit RIEN perdre de ce qu'il fait
aujourd'hui.

- [ ] **Étape 6 : les listes et les contrôles**

`quiz-menu.ts` sort de `RESTANTS`, entre dans `LIBERES`. `share.ts` et
`modal-base.ts` **restent** dans `RESTANTS`.

Import temporaire, `npm run check:app`, delta de modules, retrait. Puis
`npm run check`, `check:host` (**15**), `check:dashboard-dom`,
`check:obsidian-host`, `check:windows-host`, `npm run build`.

- [ ] **Étape 7 : commit**

```bash
git add src/dashboard/quiz-menu.ts src/types/dashboard-ctx.ts src/dashboard.ts scripts/check-host.mjs scripts/check-dashboard-dom.mjs
git commit -m "refactor(quiz-menu): renommer et supprimer passent par le contrat"
```

---

## Tâche 10 — L'application édite

La tâche qui rend tout le reste visible. C'est le moment de vérité :
`check:app` cesse d'être creux et devient le contrôle qui décide.

**Fichiers :**
- Modifier : `apps/windows/src/ui/dashboard-shell.ts`
- Modifier : `apps/windows/src/main.ts`
- Créer si nécessaire : `apps/windows/src/ui/detail-page.ts` (voir l'étape 2)

**Interfaces :**
- Consomme : tout ce que les tâches 1 à 9 produisent.
- Produit : rien qu'une autre tâche consomme.

- [ ] **Étape 1 : les membres du `ctx` que l'application peut désormais honorer**

Dans `dashboard-shell.ts`, à la suite de `pickIcon`, `createFolder` et
`renderGroupingSelect` :

```ts
		openCardMenu: (quiz, anchor, rerender) => {
			openActionMenu(anchor, buildQuizCardMenu(ctx, rerender)(quiz));
		},
		openModuleMenu: (group, anchor, rerender, map) => {
			openActionMenu(anchor, buildModuleCardMenu(ctx, rerender, map)(group));
		},
		createQuiz: (folder, done) => openCreateQuizModal(ctx, folder, done),
		openQuizPath: async (path, opts) => { /* étape 2 */ },
```

**Vérifie la signature réelle d'`openActionMenu`** (`src/dashboard/ui-select.ts`)
avant de recopier ces deux lignes : le modèle est `src/dashboard.ts:226-243`, où
le greffon les remplit déjà.

`shareQuiz` et `renameQuiz` **restent absents**, et le commentaire du bloc doit
le dire avec leur raison — sur le modèle de celui que la tranche 2.6 a laissé
aux lignes 159-169, qu'il faut réécrire puisque trois de ses quatre affirmations
deviennent fausses.

- [ ] **Étape 2 : la page de quiz, dans la fenêtre**

C'est le livrable. `naviguer("detail")` court-circuite aujourd'hui vers
`deps.onOpenQuiz` (jouer), faute de page de détail — le commentaire des
lignes 209-215 le dit. Il doit maintenant monter la vraie page :

```ts
	function naviguer(vue, data) {
		if (vue === "detail") {
			if (data?.quiz) deps.onOpenDetail(data.quiz, data.edit);
			return;
		}
		// … le reste ne change pas …
	}
```

et `main.ts` monte `createQuizPage({ statsStore })` avec un `QuizPageSpec` dont
`load` et `save` sont `loadQuizDraft(path)` et `saveQuizDraft(draft)`, `onBack`
remonte le tableau de bord, et `start` appelle `openQuizPage` (le moteur).
**Le modèle exact est `createDetailHandlers` dans `src/dashboard/detail.ts`** :
lis-le et transpose, ne réinvente pas un second assemblage — deux specs
construites séparément divergeraient sans un mot.

`main.ts` gère déjà un écran à la fois par `demonterCourant` : la page de détail
suit le même protocole que `openQuizPage` et `renderSettings` (le conteneur est
vidé avant, le démontage est rendu et DOIT être appelé). `QuizPageHandlers.dispose()`
est ce démontage — il retire l'écoute clavier posée sur le `document` et écrit
ce qui est en attente. **L'oublier fuit une instance par ouverture.**

`openQuizPath?` se remplit alors trivialement : c'est la même navigation, par
chemin plutôt que par entrée du catalogue.

- [ ] **Étape 3 : la vérification qui ne ment plus**

```bash
npm run check:app
```

C'est ici que se verrait un import transitif d'Obsidian resté dans le bundle de
la fenêtre. C'est exactement le défaut qui a fait valider trois tâches sur une
prémisse fausse en tranche 2.5. Relève le nombre de modules : il doit avoir
franchement grandi par rapport aux 1940 du départ.

- [ ] **Étape 4 : la suite complète des contrôles**

Un par ligne, sans pipe, code de sortie relevé : `check`, `check:app`,
`check:host` (**15**), `check:dashboard-dom`, `check:theme`,
`check:obsidian-host`, `check:windows-host`, `check:quiz-io`, `check:export`,
`check:md`, `check:markers`, `check:module-edit`, `check:folders`,
`check:review-store`, `check:scanner`, `check:lesson`, `build`.

`check:lesson` est dans la liste pour une raison précise : **il MEURT sur une
exception au lieu d'échouer proprement**, et une mort en route masque en silence
tous les groupes suivants (onze cachés, une fois). Son faux hôte est partiel :
si le contrat a grandi sous lui, il faut le compléter.

- [ ] **Étape 5 : l'encodage, puis le build de l'application**

Cherche les marqueurs `Ă`, `Â`, `â€` dans tous les fichiers touchés par la
tranche. Puis :

```bash
npm run app:build
```

et réinstalle par l'installeur NSIS
(`apps/windows/src-tauri/target/release/bundle/nsis/`) avec `/S`. **Prévenir
Ahmed avant** : l'installeur ferme la fenêtre ouverte pour remplacer
l'exécutable.

- [ ] **Étape 6 : commit**

```bash
git add apps/windows/src
git commit -m "feat(app): la page d'un quiz, son edition, les menus et la suppression"
```

---

## Ce qu'aucun script ne peut prouver

Comme aux tranches 2.5 et 2.6, **aucun agent n'a d'affichage**. Ces épreuves se
font à l'écran, l'application d'un côté et Obsidian de l'autre, sur le MÊME
dossier. Par ordre de risque décroissant.

1. **Une modification faite dans l'application arrive dans la note.** Ouvre un
   quiz, bascule en « Editor », change un énoncé, attends la sauvegarde (600 ms),
   puis ouvre la note dans Obsidian. *Cassé* : le texte n'y est pas, ou le bloc
   a perdu ses attributs d'ouverture, ou la note entière apparaît modifiée dans
   un diff alors qu'un seul mot a changé (fins de ligne).
2. **La même note, éditée des DEUX côtés.** Ouvre-la dans l'application ET dans
   Obsidian, modifie dans Obsidian pendant que la page est ouverte, puis tape
   dans l'application. *Bon* : la seconde écriture repart bredouille et le dit.
   *Cassé* : l'une écrase l'autre en annonçant un succès. C'est le
   compare-and-swap, et c'est le seul comportement de la tranche qu'on ne peut
   pas juger sans deux fenêtres.
3. **Coller une image dans une question** (Ctrl+V depuis une capture). Elle doit
   s'écrire à côté de la note, apparaître dans l'aperçu SANS rechargement, et
   rester visible après un redémarrage. *Cassé* : image manquante dans l'aperçu
   (l'écriture n'a pas indexé), ou fichier corrompu (les octets de la vue).
   C'est aussi la seule épreuve de la permission `fs:allow-write-file` : sans
   elle, l'écriture échoue AU RUNTIME et aucun contrôle ne l'aurait dit.
4. **Supprimer un quiz, et le retrouver.** Le menu « ⋯ » puis « Supprimer ».
   *Bon* : le quiz disparaît du catalogue, et le fichier est dans
   `<racine>/.trash/`. *Cassé* : le fichier a disparu pour de bon, ou il est
   encore dans le catalogue.
5. **Supprimer deux fois un quiz du même nom** (recréé entre les deux). La
   corbeille doit contenir les DEUX, le second suffixé. C'est l'endroit où une
   perte serait définitive.
6. **Créer un quiz vierge** (« Nouveau quiz » dans un dossier ouvert) : il doit
   s'ouvrir AUSSITÔT en édition. C'est la raison pour laquelle `createQuiz`
   était absent jusqu'ici.
7. **Le menu « ⋯ » de la fenêtre a deux entrées**, pas quatre grises. Vérifier
   aussi que celui du GREFFON en a toujours quatre, « Partager » comprise.
8. **Le greffon, inchangé.** Cette tranche touche `detail.ts`, `dashboard.ts`,
   l'éditeur et les modales, que tout le tableau de bord d'Obsidian emploie.
   Vérifier : la page d'un quiz, l'onglet `quiz-blocks-builder`, la page
   « Générer » (elle monte la MÊME page de quiz sur un quiz en mémoire), le
   renommage et la suppression depuis les cartes.
9. **L'aperçu d'une question à images**, dans les deux hôtes. La tâche 4 change
   la résolution : une image que l'ancien calcul manquait doit maintenant
   s'afficher, et aucune de celles qui s'affichaient ne doit disparaître.

---

## Ce que cette tranche laisse ouvert

- **`src/modal-base.ts` reste dans `RESTANTS`** avec deux sous-classes
  (`share.ts`, `usage-modal.ts`). Il part avec la tranche 4.
- **`shareQuiz` et `renameQuiz` restent absents côté application.** Le premier
  attend le sous-contrat de lancement de processus (tranche 4) et une décision
  de produit que la spec §7 range hors chantier ; le second attend un index des
  liens ENTRANTS que l'application ne tient pas.
- **Le journal de révision d'un quiz supprimé n'est pas nettoyé.** Le format est
  en ajout seul, et la clé d'une note disparue devient simplement orpheline.
  C'est cohérent avec le reste (rien n'est compacté), mais personne ne l'a
  décidé explicitement jusqu'ici.
- **Un quiz mis à la corbeille par l'application ne l'est pas de la même façon
  que par le greffon.** Obsidian suit le réglage de l'utilisateur, la fenêtre
  écrit dans `<racine>/.trash/`. Les deux sont récupérables ; ce ne sont pas les
  mêmes endroits, et l'utilisateur qui cherche doit le savoir.
- **`apps/obsidian/host.ts` et `apps/windows/src/host/fs.ts` grossissent
  encore** (457 et 466 lignes avant cette tranche, cible ~350). La tranche 3
  leur ajoute quatre membres. Le découpage n'est toujours pas fait, et il est
  maintenant clairement dû.
- **Le thème clair** et **l'empaquetage signé** restent hors périmètre, comme
  depuis la tranche 2.
- **`report:multiblock` mesure toujours les deux mêmes limites** : le scanner
  n'indexe que le premier bloc d'une note, et une note quiz `source:` journalise
  sous son propre chemin. Éditer une note à plusieurs blocs depuis
  l'application n'y change rien : la page n'ouvre que le premier, comme le
  catalogue.
