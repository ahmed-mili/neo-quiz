# Application Windows — tranche 2 : « l'app révise »

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — utiliser
> `superpowers:subagent-driven-development` pour exécuter ce plan tâche par
> tâche. Les étapes sont des cases à cocher (`- [ ]`).

**But :** l'application remplace Obsidian pour la révision quotidienne — le
journal de révision à son nouvel emplacement, sa migration, l'ordonnanceur
branché, la carte « À réviser », la date d'examen par module, et plusieurs
dossiers de quiz.

**Architecture :** le journal quitte le dossier du greffon pour
`<racine>/.neo-quiz/review-log.jsonl`, où les deux hôtes le partagent.
L'adaptateur qui l'écrit (`review-store.ts`) cesse d'être une pièce jetable du
tableau de bord : il passe au contrat d'hôte et déménage dans `src/review/`,
d'où il sert le greffon ET l'application. Le contrat gagne ce qui lui manquait
pour cela — l'ajout en fin de fichier, le listage, la suppression, le renommage
— et la notion de RACINE, qui permet à l'hôte Windows d'ouvrir plusieurs
dossiers sans que le code partagé ait à le savoir. Le noyau de l'ordonnanceur
(`src/scheduler/`) ne bouge pas d'une ligne : c'est la promesse qu'il a été
écrit pour tenir.

**Pile :** TypeScript strict (ESM), Tauri 2 + Vite pour l'app, esbuild pour le
greffon, Lucide pour les icônes.

**Spec :** `docs/superpowers/specs/2026-09-04-app-windows-design.md` (autorité
liante), §5 (le journal déménage), §6 (les dossiers de quiz) et §7 (tranche 2).
Cadrée par `docs/superpowers/specs/2026-09-02-roadmap-produit.md` et
`docs/superpowers/specs/2026-09-02-scheduler-design.md` (l'ordonnanceur, déjà
conçu et implémenté). Ce plan ne couvre QUE la tranche 2. **Les tranches 3
(l'édition) et 4 (la génération) ne sont pas ouvertes** (spec §9) : rien ici ne
doit les commencer.

---

## Contraintes globales

Ces règles valent pour **toutes** les tâches. Chacune a déjà coûté un bug.

- **Commits directs sur `main`.** Jamais de branche, jamais de worktree, jamais
  de `git push`. Un commit par tâche, à la fin de la tâche.
- **Commentaires en français**, et ils documentent le **pourquoi**, pas le quoi.
- **Aucune chaîne visible en dur.** Tout passe par `t("<domaine>.<clé>")` de
  `src/i18n.ts`, et `t()` est appelé **AU RENDU** — jamais dans une constante
  de niveau module, qui figerait la langue du démarrage.
- **AVANT de créer une clé de traduction, vérifier qu'elle n'existe pas déjà**
  dans un autre domaine : `grep -rn '"dashboard.review' src/i18n/en/`. La
  tranche 1 a dû corriger deux clés en double. Emprunter une clé d'un autre
  domaine est la bonne réponse quand le libellé est le même (`app/list.ts`
  emprunte déjà `dashboard.common.questionsOne`).
- **L'anglais (`src/i18n/en/*.ts`) est le dictionnaire de référence.** Le
  français est typé `Record<keyof typeof EN_X, string>` : une clé oubliée est
  une erreur de compilation.
- **Ne jamais traduire** les clés du format quiz (`title`, `prompt`, `options`,
  `correctIndex`, `answer`, `learn`…), les types (`single`/`multiple`/`text`/
  `ordering`/`matching`), `mode: "exam"`, les **grades du journal**
  (`correct`, `wrong`, `understood`, `partial`, `review`, `skipped`, `seen`),
  les `id:` de commandes, les logs, les classes CSS. Ce sont des données
  persistées.
- **`PLUGIN_ID = "quiz-blocks"` et `QUIZ_BLOCK_LANGUAGE = "quiz-blocks"` NE
  CHANGENT PAS.** Le premier est le dossier de `.obsidian/plugins/` ; le second
  est écrit dans chaque note du vault.
- **`resultsDir` côté Obsidian reste `.obsidian/quiz-blocks-results`.** Les
  fichiers de résultats déjà écrits doivent rester trouvables.
- **`src/scheduler/` est un NOYAU PUR** : ni Obsidian, ni écran, ni horloge, ni
  calendrier, ni hasard. `now` et `dayStart` sont des ENTRÉES. Aucune tâche de
  ce plan ne modifie un fichier de `src/scheduler/` — si l'une paraît l'exiger,
  c'est l'adaptateur qu'il faut changer. `npm run check:scheduler` le vérifie
  mécaniquement.
- **Les scripts de vérification appellent `process.exitCode`, jamais
  `process.exit()`** : la pile doit se dérouler pour que `withSrcModule` retire
  son dossier temporaire.
- **Modules visés sous ~350 lignes.**
- **Icônes Lucide via `host.ui.setIcon`**, jamais d'emoji. Les LOGOS de marque
  ne viennent jamais de Lucide (`apps/windows/src/ui/marques.ts`).
  `dashboard/ui-select.ts` est le seul dropdown autorisé — jamais de `<select>`
  natif ; il importe encore Obsidian, donc **l'app ne l'utilise pas** et
  n'introduit aucun dropdown dans cette tranche.
- **`src/dom.ts` (`ajouter`) et jamais les extensions DOM d'Obsidian**
  (`createEl`, `createDiv`, `empty`, `setText`…) dans tout fichier de `src/`
  qui n'importe pas `obsidian`, ni dans `apps/windows/`. Aucun `import` ne les
  trahit : c'est la quatrième assertion de `check:host` qui les attrape.
- **Le greffon ne doit à AUCUN moment être cassé.** Chaque tâche se termine sur
  un `npm run check` vert, les contrôles concernés verts, `npm run build` qui
  déploie, et — pour les tâches qui touchent `src/` ou `apps/obsidian/` — un
  passage dans Obsidian.
- **Double encodage :** après toute écriture de fichier, exécuter
  `grep -rn 'Ă\|Â\|â€' <fichiers touchés>` et corriger toute occurrence. Le
  dépôt a déjà été pollué.
- **Chaque cas de test doit être ÉPROUVÉ DISCRIMINANT** : retirer la règle
  qu'il garde, lancer le script, **voir l'assertion rougir**, restaurer, revoir
  vert. Un cas qui reste vert quand on casse sa règle ne garde rien. Sur la
  tranche 1, cette méthode a trouvé un cas qui passait au vert quoi qu'on
  fasse — écrit dans le plan, donc jamais mis en doute avant d'être éprouvé.
- **JUGER UN SCRIPT SUR SON CODE DE SORTIE, JAMAIS SUR LA FIN DE SA SORTIE.**
  Lancer `npm run <script>; echo "EXIT=$?"`. Un groupe vert peut suivre trois
  groupes rouges : c'est ainsi qu'un défaut a survécu à une revue complète. Et
  `npm run check:lesson` MEURT sur une exception au lieu d'échouer proprement —
  une mort en route masque en silence tous les groupes suivants.

---

## Ce que la tranche 1 a laissé en place, et qui commande cette tranche

Constaté à l'écran le 2026-09-05 : l'application ouvre un dossier et joue un
quiz sans Obsidian. Ce qu'elle a appris, et qui change la tranche 2 :

1. **Le contrat d'hôte existe et est implémenté deux fois.**
   `src/host/types.ts` déclare huit sous-contrats, obtenus par `currentHost()` ;
   `apps/obsidian/host.ts` et `apps/windows/src/host/` les implémentent.
   `npm run check:host` refuse toute nouvelle dépendance à Obsidian dans `src/`
   et annonce le compte exact — **42 fichiers** au 2026-09-05.
2. **`paths.resultsDir` est DÉJÀ sensible au dossier** : dans un vault
   Obsidian, l'app écrit ses résultats dans `.obsidian/quiz-blocks-results`
   (là où le greffon les écrit) ; hors d'un vault, dans `.neo-quiz/results`.
   La détection est `estVaultObsidian()` (`apps/windows/src/host/folder.ts`).
   **D1 tranche la cohérence** entre cette règle et celle du journal.
3. **Le surveillant de fichiers a une limite mesurée** : `@tauri-apps/plugin-fs`
   remonte un renommage en `modify: { kind: "rename", mode: "from" | "to" }`,
   souvent en DEUX évènements que rien ne relie ; l'hôte Windows émet alors
   `delete` puis `create` plutôt que d'inventer un appariement faux
   (`apps/windows/src/host/fs.ts`). Or le journal SUIT SES CLÉS PAR RENOMMAGE.
   **D3 tranche.**
4. **Une clé de journal est `<chemin relatif>::<id de question>`**, séparateurs
   `/`, jamais absolue, et elle doit être **identique sous les deux hôtes** pour
   la même note. La règle d'identité des questions est unique
   (`src/quiz-ids.ts`), partagée par le scanner, l'éditeur et le moteur.
   **D4 tranche** ce qu'il advient de cette clé quand plusieurs dossiers sont
   ouverts.
5. **Le moteur a déjà ses deux puits**, tous deux optionnels et absents en
   tranche 1 : `reviewSink` et `statsSink`, passés par `RenderQuizContext`
   (`src/engine.ts`). La tranche 2 branche `reviewSink` côté app. **Ne pas les
   réinventer.** `statsSink` reste absent : les statistiques par quiz sont
   l'affichage du tableau de bord, une autre question — spec de l'ordonnanceur
   §9.1, « deux systèmes distincts, à ne pas fusionner ».
6. **Le réglage du dossier est au singulier** (`folder`), délibérément.
   **D5 tranche** son passage au pluriel.
7. **Ce qui est encore à Obsidian dans `src/`** : tout `src/dashboard/` sauf
   `scanner.ts`, et tout `src/editor/`. `src/dashboard/review-store.ts` est
   l'adaptateur Obsidian du journal. **D6 tranche** son sort.

---

## Décisions que ce plan tranche, et que la spec laissait ouvertes

### D1. Le journal vit à un seul endroit, et cet endroit ne se déduit de rien

**`<racine>/.neo-quiz/review-log.jsonl`, sous les DEUX hôtes, vault ou pas.**
Aucune condition, aucune détection.

C'est une règle différente de celle de `resultsDir`, et la différence est le
point important — deux fichiers qui voyagent ensemble ne peuvent pas suivre
deux règles pour la même raison, alors ils suivent deux règles pour deux
raisons :

| | Fichiers de résultats | Journal de révision |
|---|---|---|
| Ce que c'est | un EXPORT que l'utilisateur ouvre | l'ÉTAT de sa mémoire, lu par les deux hôtes |
| Ce qui commande l'emplacement | là où le greffon en a déjà écrit | là où les deux hôtes le trouveront, toujours |
| Une erreur d'emplacement coûte | un export à retrouver ailleurs | un semestre de révisions invisible |
| Si la détection de vault change | les anciens exports restent lisibles | **l'historique disparaît** |

La dernière ligne suffit à trancher. `estVaultObsidian()` teste la présence
d'un dossier `.obsidian/` : c'est vrai aujourd'hui, faux demain si l'utilisateur
range ses notes ailleurs ou ouvre le dossier PARENT de son vault. Un fichier de
résultats mal placé se retrouve ; un journal qui change d'emplacement fait
repartir toutes les questions à zéro, **sans un message**, et les révisions
écrites entre-temps restent dans un fichier que plus rien ne lit.

Le préfixe `.neo-quiz/` est d'ailleurs déjà posé par la tranche 1
(`paths.resultsDir` hors vault), et les deux hôtes ignorent déjà les dossiers
commençant par un point : le journal n'apparaîtra ni dans l'explorateur
d'Obsidian ni dans le catalogue de l'app (`dossierIgnore`, `fs.ts`), tout en
restant lisible par chemin.

**Une seule constante**, `src/review/paths.ts`, jamais recopiée :

```ts
export const REVIEW_DIR = ".neo-quiz";
export const REVIEW_LOG_NAME = "review-log.jsonl";
```

### D2. La migration : les DEUX hôtes la déclenchent, parce qu'elle est idempotente

La spec §5 décrit la migration comme une tâche du greffon. La tranche 1 montre
pourquoi ça ne suffit pas : **l'application peut être installée avant que le
greffon ne soit mis à jour**. Elle démarrerait alors sur un journal vide, avec
un semestre d'historique à trente centimètres de là, et rien ne le dirait.

Donc : **le greffon et l'application exécutent la même migration**, par la même
fonction (`src/review/migration.ts`), au démarrage, pour chaque racine ouverte.

Ce qui rend la double exécution inoffensive, c'est que la migration n'est pas
une COPIE mais une **absorption** — exactement celle des fichiers de conflit
Syncthing, dont elle reprend la logique et l'ordre :

1. lire l'ancien journal ; s'il n'existe pas, il n'y a rien à faire ;
2. lire le nouveau, s'il existe, et en indexer les lignes **formatées** ;
3. n'ajouter que les lignes ABSENTES (dédoublonnage par ligne exacte) ;
4. **RELIRE le nouveau et vérifier la présence de chacune** des lignes
   ajoutées ;
5. **seulement alors**, renommer l'ancien en `review-log.jsonl.migrated` —
   jamais le supprimer.

Trois conséquences, chacune voulue :

- **L'ordre des installations n'a plus d'importance.** Si l'app migre en
  premier, le greffon trouvera le travail fait et ne réécrira rien. Si le
  greffon migre en premier, l'app trouvera le fichier `.migrated` et
  n'aura rien à faire.
- **Deux exécutions simultanées sur un dossier synchronisé** ne peuvent pas
  perdre de données. Le pire cas est que les deux écrivent les mêmes lignes :
  Syncthing dépose alors un `review-log.sync-conflict-*.jsonl`, que
  l'absorption déjà écrite reprend et dédoublonne. Si les deux renomment,
  le second ne trouve plus l'ancien fichier — un non-évènement.
- **Une ligne illisible dans l'ancien journal empêche le renommage.** La
  migration se rejouera au prochain démarrage (et ne coûtera qu'une lecture,
  puisque tout est déjà dédoublonné), mais on ne déplace pas un fichier dont
  on n'a pas tout compris. Même règle que l'absorption des conflits.

L'hypothèse du dédoublonnage — deux lignes identiques au caractère près sont la
même révision — est celle que `absorberConflits` fait déjà. Elle tient parce
qu'un événement porte `q`, `at` (ms) et `grade` : deux réponses distinctes à la
même question dans la même milliseconde n'existent pas (`recorded[]` du moteur
l'interdit dans une session, et deux sessions ne se croisent pas à la ms).

**L'ancien chemin n'est pas le même des deux côtés**, et c'est normal :

- greffon : `plugin.manifest.dir + "/review-log.jsonl"` — la valeur réelle,
  jamais recomposée (l'API la donne, et elle peut différer d'un
  `.obsidian/plugins/quiz-blocks` attendu) ;
- application : `.obsidian/plugins/quiz-blocks/review-log.jsonl` sous la
  racine, le chemin conventionnel — l'app n'a pas de manifeste à interroger.
  `PLUGIN_ID` (`src/branding.ts`) le compose, il n'est pas écrit en dur.

### D3. Les renommages non appariés : apparier par PREUVE, jamais par proximité

Le surveillant Tauri ne sait pas toujours relier les deux moitiés d'un
renommage, et l'hôte a raison de ne pas inventer : il émet `delete` puis
`create`. Sans réponse, une note renommée pendant que l'app tourne perdrait
l'historique de toutes ses questions — la clé du journal contient le chemin.

**Ce n'est pas au surveillant de trancher, c'est au CATALOGUE.** Le scanner
connaît, pour chaque note, les identifiants de ses questions
(`QuizIndexEntry.items[].id`, attribués par `src/quiz-ids.ts`). Deux
observations successives du catalogue donnent la liste des chemins DISPARUS et
des chemins APPARUS ; quand un disparu et un apparu portent **exactement la
même suite d'identifiants**, ce n'est pas une ressemblance, c'est la même note.
On écrit alors une ligne `rename` dans le journal, et l'historique suit.

Trois gardes, sans lesquelles ce serait une devinette :

1. **La signature doit être FORTE** : au moins un identifiant qui n'est pas de
   la forme `q<N>`. Les identifiants de repli (`q1`, `q2`…) sont attribués par
   position et ne distinguent rien — deux quiz de cinq questions sans `id:`
   explicite auraient la même signature. La mesure du 2026-09-02 dit que 771
   des 774 questions des vaults réels portent un `id` explicite : le refus ne
   concerne qu'une poignée de notes, qui perdront leur historique au renommage
   plutôt que d'en recevoir un faux.
2. **L'appariement doit être UNIQUE** : une signature présente deux fois parmi
   les disparus, ou deux fois parmi les apparus, est refusée. Copier une note
   puis supprimer l'originale produirait sinon un appariement arbitraire.
3. **Une fenêtre courte** (5 s) : les deux moitiés d'un renommage arrivent à
   quelques centaines de millisecondes d'écart. Au-delà, une note supprimée
   et une note créée n'ont plus de raison d'être la même.

La fonction est PURE et vit dans `src/review/rename-match.ts`, donc éprouvable
(`npm run check:rename-match`). Le greffon ne s'en sert pas : Obsidian émet un
vrai `rename`, et le contrat le transmet tel quel.

### D4. Plusieurs dossiers : un hôte COMPOSITE, un chemin préfixé, une clé qui ne l'est pas

La spec §6 veut jusqu'à dix dossiers, un journal chacun, et **un plan du jour
calculé sur le catalogue réuni**. Le contrat, lui, ne connaît qu'une racine :
`fs.read(path)` n'a qu'un chemin, et ce chemin est relatif « à la racine ».

La réponse est un **hôte composite** : les chemins du contrat gagnent un
premier segment qui est l'IDENTIFIANT DU DOSSIER.

```
chemin du contrat (app)  :  Efrei/Cours/reseau.md
chemin du contrat (greffon) :     Cours/reseau.md      (une seule racine, pas de préfixe)
clé du journal, des deux côtés :  Cours/reseau.md::adressage-ip
```

**La clé du journal n'est jamais préfixée** : c'est ce qui permet au greffon et
à l'app de partager l'historique du même dossier. La conversion vit dans
l'hôte — `paths.localPath(cheminDuContrat)` retire le préfixe,
`paths.contractPath(idRacine, cheminLocal)` le remet — et **nulle part
ailleurs**. Un adaptateur qui recomposerait la clé à la main ferait diverger
les deux hôtes, et le défaut ne se verrait qu'à la première révision perdue.

L'identifiant d'un dossier est le **slug de son nom** (`Efrei`, `Personal`),
suffixé `-2`, `-3`… si deux dossiers portent le même nom. Il est **persisté**
dans les réglages au moment de l'ajout : un identifiant recalculé changerait le
jour où un dossier homonyme arrive, et tous les chemins affichés changeraient
avec lui. Le nom, lui, reste modifiable sans conséquence.

Choix du nom plutôt que d'un identifiant opaque (`f1`, `f2`) : le chemin du
contrat est AFFICHÉ (la page d'un quiz montre `entry.path`). `Efrei/Cours/
reseau.md` se lit ; `f1/Cours/reseau.md` demanderait une table de traduction à
l'affichage, donc un second endroit où le préfixe est connu.

Deux conséquences à traiter, et elles sont dans le périmètre :

- **`paths.resultsDir` devient `paths.resultsDirFor(sourcePath)`.** Avec
  plusieurs racines, une constante enverrait les résultats d'un quiz du dossier
  B dans le dossier A. Côté Obsidian, la fonction ignore son argument et rend
  la même constante qu'avant.
- **`links.resourceUrl(target, fromPath?)` prend la note citante**, et la
  résolution par nom est BORNÉE à la racine de cette note : une image du
  dossier A ne doit jamais être servie à une note du dossier B (sous Obsidian,
  un lien ne sort pas du vault). Le paramètre profite aussi au greffon, où il
  améliore la résolution d'un nom nu — ce n'est pas un artifice multi-racine.

### D5. Le réglage passe au pluriel, et l'ancien se convertit sans être perdu

`folder: string` → `folders: Array<{ id: string; path: string; name: string }>`,
dans le même magasin (`settings.json` du greffon `store` de Tauri).

À la lecture : si `folders` est absent et `folder` présent, on compose une
liste d'un élément, on l'écrit, et on **supprime `folder`**. Un seul sens de
conversion, exécuté une fois, comme les migrations de réglages du greffon
(`plugin.ts`, `loadSettings`).

Limite haute : **dix dossiers** (spec §6). Au-delà, le bouton d'ajout est
désactivé et un message le dit — pas un ajout silencieusement ignoré.

### D6. `review-store.ts` passe au contrat, et quitte `dashboard/`

La spec de l'ordonnanceur (§3) le range dans `dashboard/` « par choix : c'est
le dossier que le chantier 4 supprime », et le dit JETABLE. **Cette tranche
renverse ce choix, et il faut dire pourquoi plutôt que de le faire en
silence** : à partir du moment où l'application écrit le même journal, ce
fichier n'est plus l'adaptateur d'un hôte, c'est le format d'un fichier
partagé. Le supprimer avec le tableau de bord emporterait l'app avec lui.

Il déménage donc en `src/review/review-store.ts` et reçoit ses dépendances au
lieu de les prendre sur un `Plugin` :

```ts
createReviewStore({ fs, watcher, paths, catalogue, horizons, now })
```

Ce que ça coûte à la tranche 3, dans les deux cas :

| | Il passe au contrat (retenu) | L'app écrit le sien |
|---|---|---|
| Absorption Syncthing, écriture différée, ordre des lots, garde `charge` | écrits une fois | écrits deux fois, corrigés deux fois |
| Tranche 3 (l'app édite) | l'éditeur de l'app journalise les renommages par le même chemin que le greffon | deux chemins de renommage à tenir d'accord, sur la donnée la plus irréversible du produit |
| Tranche 4 (le greffon réduit) | `src/review/` survit, `dashboard/` part | idem, mais le code du greffon part avec la moitié éprouvée |
| Précédent mesuré | — | Neo Calendar : 132 fichiers de même nom dans deux dépôts, **83 divergés** |

Le compteur du cliquet passe donc de **42 à 41** fichiers encore liés à
Obsidian. C'est la première fois qu'il descend depuis la fin de la tranche 1, et
`npm run check:host` l'annonce.

### D7. Les modules côté app : le dossier parent, et rien d'inventé

Sous Obsidian, le module d'un quiz vient d'une note « Dashboard » du vault
(`parseModuleMap`), avec repli sur le dossier parent. Cette note est
spécifique au vault d'Ahmed ; l'app ne la lit pas.

**Côté app, le module est `<idRacine>/<dossier parent du quiz>`** — c'est
exactement le repli de `moduleForQuiz` avec une table vide, appliqué
explicitement. L'identifiant de racine est dans la clé parce que deux dossiers
peuvent avoir un module homonyme (`Efrei/Réseaux` et `Perso/Réseaux`), et
qu'un horizon partagé par erreur resserrerait les révisions d'un module dont
l'examen n'a pas lieu.

La clé de module **n'est jamais persistée dans le journal** (le journal ne
porte que `q`, `at`, `grade`, `role`) : les deux hôtes peuvent donc grouper
différemment sans que rien ne diverge sur le disque. Seule la granularité de
l'horizon diffère, et c'est visible à l'écran, pas silencieux.

Les dates d'examen de l'app vivent dans ses réglages :
`examDates: Record<string, string>` (clé de module → `AAAA-MM-JJ`), la même
forme que `ModuleOverride.examDate` du greffon, **jamais traduite**.

### D8. La carte « À réviser » s'insère en tête de la liste

L'app n'a pas encore de page d'accueil distincte : la liste des quiz EST son
accueil. La carte s'y insère au-dessus de la grille, avec les classes du
tableau de bord (`qbd-review-list`, `qbd-review-row`, `qbd-review-count`,
`qbd-review-deferred`), **qui existent déjà** dans `src/assets/css/dashboard/
dashboard-home.css` et sont déjà chargées par l'app.

Pas de nouvelle page, pas de barre de navigation : la spec §7 les met dans la
tranche où elles servent, et une session inter-quiz composée est explicitement
hors périmètre (spec de l'ordonnanceur §9.6 — « la première chose que
construira l'application PC » vient après que le journal existe).

Une seule page nouvelle, parce que deux réglages doivent bien vivre quelque
part : **la page « Réglages »** (les dossiers, les dates d'examen), atteinte
par un bouton de l'en-tête de la liste.

### D9. Ce que cette tranche N'OUVRE PAS

- L'édition d'un quiz dans l'app (tranche 3), la génération IA (tranche 4).
- La session inter-quiz composée (« une seule chose »), même si la carte
  « À réviser » en donne l'envie : elle ouvre le quiz concerné, comme le
  tableau de bord le fait.
- Le thème clair (spec §8), l'empaquetage signé et la mise à jour (spec §8).
- Les statistiques par quiz dans l'app (`statsSink`) : c'est l'affichage du
  tableau de bord, pas l'ordonnanceur.
- La compaction du journal (spec de l'ordonnanceur §11).

---

## Structure des fichiers

**Créés**

| Fichier | Responsabilité |
|---|---|
| `src/review/paths.ts` | les constantes d'emplacement du journal, et rien d'autre |
| `src/review/migration.ts` | l'absorption de l'ancien journal, pure vis-à-vis de l'hôte |
| `src/review/review-store.ts` | l'adaptateur du journal (déplacé de `dashboard/`, passé au contrat) |
| `src/review/rename-match.ts` | l'appariement des renommages par signature |
| `src/i18n/en/review.ts`, `src/i18n/fr/review.ts` | domaine `review` (carte À réviser, réglages de l'app) |
| `scripts/check-review-log.mjs` | emplacement et migration du journal |
| `scripts/check-rename-match.mjs` | l'appariement par signature |
| `apps/windows/src/host/roots.ts` | les racines de l'app : identifiants, préfixes, conversions |
| `apps/windows/src/review/catalogue.ts` | le catalogue vu par l'app : clé de question, module, tranche |
| `apps/windows/src/review/store.ts` | le journal côté app : une racine, un journal, un routage |
| `scripts/check-folders.mjs` | la conversion du réglage et l'unicité des identifiants de dossier |
| `apps/windows/src/ui/settings.ts` | la page « Réglages » (dossiers, dates d'examen) |
| `apps/windows/src/ui/review-card.ts` | la carte « À réviser » en tête de liste |

**Modifiés**

| Fichier | Nature du changement |
|---|---|
| `src/host/types.ts` | `HostFs.append/list/remove/rename` ; `HostPaths` gagne les racines et `resultsDirFor` ; `HostLinks.resourceUrl(target, fromPath?)` |
| `src/engine/results-save.ts` | `resultsDirFor(sourcePath)` au lieu de `resultsDir` |
| `src/engine/cards.ts` | passe `ctx.sourcePath` à `resourceUrl` |
| `src/dashboard/home.ts`, `src/types/dashboard-ctx.ts` | l'import de `ReviewStore` suit son déménagement |
| `apps/obsidian/host.ts` | les nouvelles méthodes du contrat |
| `apps/obsidian/plugin.ts` | construit le store sur le contrat, déclenche la migration |
| `apps/windows/src/host/fs.ts` | index et surveillant par racine, préfixes |
| `apps/windows/src/host/links.ts` | résolution bornée à la racine de la note citante |
| `apps/windows/src/host/index.ts` | assemble l'hôte composite |
| `apps/windows/src/host/folder.ts` | `folders` au pluriel, identifiants, migration de la clé |
| `apps/windows/src/main.ts` | plusieurs racines, migration, journal, page réglages |
| `apps/windows/src/ui/list.ts` | la carte « À réviser », le bouton « Réglages » |
| `apps/windows/src/ui/quiz-page.ts` | `reviewSink` branché |
| `apps/windows/src/assets/shell.css` | les quelques classes propres aux réglages |
| `scripts/check-obsidian-host.mjs`, `check-windows-host.mjs`, `check-review-store.mjs` | les cas des nouveautés |
| `package.json` | `check:review-log`, `check:folders`, `check:rename-match` |
| `apps/windows/src-tauri/capabilities/default.json` | les commandes `fs` que la tranche 1 appelait sans les avoir |
| `scripts/check-host.mjs` | `RESTANTS` perd `src/dashboard/review-store.ts` |
| `docs/superpowers/notes/controles.md`, `CLAUDE.md` | les nouveaux contrôles, le compteur du cliquet |

---
## Tâche 1 — Les permissions natives que la tranche 1 n'a jamais exercées

**Pourquoi en premier.** La capability de la fenêtre ne demande que `fs:default`,
et ce jeu-là n'accorde QUE la lecture (`allow-read-dir`, `allow-read-file`,
`allow-read-text-file`, `allow-exists`) plus `allow-mkdir`. Mesuré dans le
manifeste généré, `apps/windows/src-tauri/gen/schemas/acl-manifests.json` :

```
fs:default = create-app-specific-dirs + read-app-specific-dirs-recursive + deny-default
create-app-specific-dirs        = allow-mkdir, scope-app-index
read-app-specific-dirs-recursive = allow-read-dir, allow-read-file, allow-read-text-file,
                                   allow-read-text-file-lines(-next), allow-exists, scope-app-recursive
```

**Ni `stat`, ni `watch`, ni `write-text-file`, ni `remove`, ni `rename` n'y
sont.** La tranche 1 les appelle pourtant : `stat` pour la date des notes,
`watch` pour le surveillant, `writeTextFile` pour l'export des résultats. Les
trois échouent derrière un `catch` qui n'interrompt rien — l'index se construit
avec `mtime: 0`, le surveillant ne surveille rien, et personne ne l'a vu parce
que la liste trie par titre et que l'export n'a pas été essayé.

Toute la tranche 2 en dépend : le journal ÉCRIT, la migration RENOMME,
l'absorption des conflits LISTE et SUPPRIME, et l'appariement des renommages
n'existe que si le surveillant remonte quelque chose.

**Fichiers :**
- Modifier : `apps/windows/src-tauri/capabilities/default.json`

**Interfaces :**
- Consomme : rien.
- Produit : rien en TypeScript. Une fenêtre dont les appels `fs` aboutissent.

- [ ] **Étape 1 : constater la panne, avant de la corriger**

Lancer `npm run app:dev`, ouvrir l'inspecteur (F12), onglet Console. Modifier
une note du dossier depuis Obsidian ou le Bloc-notes.

Attendu AVANT correction : un avertissement au démarrage
(`[Neo Quiz] surveillance du dossier impossible: … fs.watch not allowed …`, le
texte exact dépend de la version) et **la liste ne bouge pas** quand une note
change.

Noter ce qu'on a vu. C'est la seule preuve que la correction sert à quelque
chose — sans elle, on ajoute des permissions « au cas où ».

- [ ] **Étape 2 : accorder les commandes réellement appelées**

`apps/windows/src-tauri/capabilities/default.json` :

```json
{
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "main-capability",
    "description": "Fenêtre principale de Neo Quiz",
    "windows": ["main"],
    "permissions": [
        "core:default",
        "window-state:default",
        "fs:default",
        "fs:allow-stat",
        "fs:allow-watch",
        "fs:allow-unwatch",
        "fs:allow-write-text-file",
        "fs:allow-remove",
        "fs:allow-rename",
        "dialog:allow-open",
        "store:default",
        "opener:default"
    ]
}
```

Chaque ligne correspond à un appel qui existe dans le code, et à aucun autre :

| Permission | Qui l'appelle | Ce qu'on perd sans elle |
|---|---|---|
| `fs:allow-stat` | `createWindowsIndex`, `reconcilier` (`host/fs.ts`) | la date des notes (`mtime: 0`), et le surveillant ne sait plus si un chemin existe |
| `fs:allow-watch` / `unwatch` | `createWindowsWatcher` | **le catalogue ne se met plus à jour**, et l'appariement des renommages (tâche 9) n'a rien à apparier |
| `fs:allow-write-text-file` | `fs.write` (résultats), `fs.append` (journal, tâche 2) | le journal ne s'écrit pas — la tranche entière |
| `fs:allow-remove` | absorption des conflits Syncthing | les fichiers de conflit s'accumulent |
| `fs:allow-rename` | migration (tâche 3) | l'ancien journal n'est jamais marqué `.migrated`, la migration se rejoue sans fin |

La PORTÉE, elle, ne change pas : elle reste ouverte à l'exécution par la
commande Rust `allow_folder`, sur le dossier choisi et lui seul. Une permission
accorde une COMMANDE ; la portée dit sur QUELS chemins. Les deux sont
nécessaires, et c'est pourquoi ouvrir la portée n'a jamais suffi.

- [ ] **Étape 3 : constater que la panne a disparu**

Relancer `npm run app:dev` (la capability est compilée dans le binaire : un
rechargement de la fenêtre ne suffit pas).

- La console ne dit plus rien au démarrage.
- Modifier une note à quiz depuis Obsidian → **la liste se met à jour seule**.
- Créer une note à quiz dans le dossier → elle apparaît.
- Supprimer une note à quiz → elle disparaît.

- [ ] **Étape 4 : éprouver que l'écriture aboutit**

Ouvrir un quiz, le terminer, et utiliser le bouton d'export des résultats
(`engine/results-save.ts`). Vérifier qu'un fichier apparaît dans
`<dossier>/.obsidian/quiz-blocks-results/` (dossier de vault) ou
`<dossier>/.neo-quiz/results/` (dossier nu).

*Cassé* : un toast nommant la cause (« not allowed »). C'est le message que la
tranche 1 a déjà rendu explicite ; il désigne alors la permission manquante.

- [ ] **Étape 5 : commit**

```bash
git add apps/windows/src-tauri/capabilities/default.json
git commit -m "fix(app): les permissions fs que la tranche 1 appelait sans les avoir"
```

---

## Tâche 2 — Le contrat s'étend : ajouter, lister, supprimer, renommer, et connaître ses racines

**Fichiers :**
- Modifier : `src/host/types.ts`
- Modifier : `apps/obsidian/host.ts`
- Modifier : `apps/windows/src/host/fs.ts`, `links.ts`, `index.ts`
- Modifier : `src/engine/results-save.ts`, `src/engine/cards.ts`
- Modifier : `scripts/check-obsidian-host.mjs`, `scripts/check-windows-host.mjs`

**Interfaces :**
- Consomme : `Host`, `HostFile`, `HostFileEvent` (tranche 1).
- Produit :
  - `HostFs.append(path, data): Promise<void>`,
    `HostFs.list(dir): Promise<string[]>`,
    `HostFs.remove(path): Promise<void>`,
    `HostFs.rename(from, to): Promise<void>` ;
  - `HostWatcher.onRenameDir(cb): () => void` ;
  - `HostLinks.resourceUrl(target, fromPath?): string | null` ;
  - `HostRoot { id, name, reviewLog, legacyReviewLog }` et
    `HostPaths { resultsDirFor(sourcePath), roots(), rootOf(path), localPath(path), contractPath(rootId, localPath) }`.
  Les tâches 3 à 11 s'appuient sur ces signatures exactes.

- [ ] **Étape 1 : étendre `HostFs`**

Dans `src/host/types.ts`, ajouter à `HostFs`, après `mkdirs` :

```ts
	/** Ajoute à la FIN du fichier, en le créant s'il n'existe pas.
	    L'ajout seul est ce qui rend le journal de révision sûr : une coupure
	    ne peut tronquer que le dernier petit lot, jamais réécrire tout
	    l'historique. Un hôte qui l'émulerait par lecture + réécriture
	    perdrait exactement la propriété pour laquelle il existe. */
	append(path: string, data: string): Promise<void>;
	/** Les FICHIERS d'un dossier (chemins du contrat), sans descendre dans
	    les sous-dossiers. Un dossier absent rend `[]` — ce n'est pas une
	    erreur : le journal cherche des fichiers de conflit qui, la plupart
	    du temps, n'existent pas. */
	list(dir: string): Promise<string[]>;
	/** Supprime un fichier. Ne rejette pas s'il est déjà absent. */
	remove(path: string): Promise<void>;
	/** Renomme (ou déplace) un fichier. Rejette si la destination existe :
	    la migration du journal s'en sert pour ne jamais écraser une
	    sauvegarde précédente. */
	rename(from: string, to: string): Promise<void>;
```

- [ ] **Étape 2 : étendre `HostWatcher` et `HostLinks`**

```ts
export interface HostWatcher {
	/** S'abonne aux changements du dossier. Renvoie le désabonnement. */
	onChange(cb: (ev: HostFileEvent) => void): () => void;
	/**
	 * Renommages de DOSSIERS, séparés des fichiers, et c'est le journal de
	 * révision qui l'exige : ses clés se déplacent par PRÉFIXE, donc un
	 * dossier renommé déplace toutes ses notes en une seule ligne. Sans ce
	 * canal, renommer « Cours » en « Cours B2 » orphelinerait d'un coup
	 * l'historique de toutes ses questions — et rien ne le signalerait.
	 *
	 * Un hôte qui ne sait pas distinguer un dossier renommé n'appelle
	 * jamais le rappel ; il ne DEVINE pas.
	 */
	onRenameDir(cb: (ev: { from: string; to: string }) => void): () => void;
}
```

Et dans `HostLinks`, `resourceUrl` gagne un second paramètre :

```ts
	/**
	 * …(commentaire existant conservé)…
	 *
	 * `fromPath` est la note CITANTE. Il sert deux fois : sous Obsidian, il
	 * permet à `getFirstLinkpathDest` de résoudre un nom nu comme la note
	 * l'entend ; dans l'application, il BORNE la recherche à la racine de
	 * cette note — une image du dossier A ne doit jamais être servie à une
	 * note du dossier B, exactement comme un lien ne sort pas d'un vault.
	 */
	resourceUrl(target: string | HostFile, fromPath?: string): string | null;
```

- [ ] **Étape 3 : remplacer `HostPaths` par les racines**

```ts
/**
 * Une RACINE : un dossier de quiz ouvert.
 *
 * Le greffon n'en a qu'une (le vault) ; l'application peut en ouvrir
 * jusqu'à dix. C'est la seule différence que le code partagé doit
 * connaître, et il la connaît par ce type — jamais par un test d'hôte.
 */
export interface HostRoot {
	/** Identifiant, et PREMIER SEGMENT des chemins du contrat qui en
	    relèvent. Chaîne VIDE quand l'hôte n'a qu'une racine : les chemins
	    du greffon restent alors exactement ce qu'ils ont toujours été. */
	id: string;
	/** Nom affichable (le dossier choisi, le vault). */
	name: string;
	/** Le journal de révision de cette racine, en chemin du CONTRAT. */
	reviewLog: string;
	/** L'ANCIEN journal (celui que le greffon écrivait à côté de lui), en
	    chemin du contrat, ou `null` quand l'hôte sait qu'il n'y en a pas.
	    C'est l'hôte qui le sait : le greffon lit `manifest.dir`,
	    l'application compose le chemin conventionnel. */
	legacyReviewLog: string | null;
}

export interface HostPaths {
	/**
	 * Dossier des exports de résultats POUR une note donnée.
	 * Une FONCTION et non une constante depuis que l'application ouvre
	 * plusieurs dossiers : une constante enverrait les résultats d'un quiz
	 * du dossier B dans le dossier A.
	 * Côté Obsidian elle ignore son argument et rend toujours
	 * « .obsidian/quiz-blocks-results », qui NE CHANGE PAS.
	 */
	resultsDirFor(sourcePath: string): string;
	/** Les racines ouvertes, dans l'ordre d'affichage. */
	roots(): HostRoot[];
	/** La racine dont relève un chemin du contrat, ou `null`. */
	rootOf(path: string): HostRoot | null;
	/**
	 * Le chemin RELATIF À SA RACINE — c'est-à-dire la CLÉ DU JOURNAL.
	 * Elle doit être identique sous les deux hôtes pour la même note :
	 * « Cours/reseau.md », jamais « Efrei/Cours/reseau.md » ni un chemin
	 * absolu. Un hôte qui recomposerait cette clé ailleurs ferait diverger
	 * les deux historiques sans que personne ne le voie.
	 */
	localPath(path: string): string;
	/** L'inverse : le chemin du contrat d'une clé locale dans une racine. */
	contractPath(rootId: string, localPath: string): string;
}
```

- [ ] **Étape 4 : implémenter côté Obsidian**

Dans `apps/obsidian/host.ts`, `createObsidianHost(app)` devient

```ts
/** Le second paramètre est réduit à ce dont l'hôte a besoin — le manifeste,
    pour retrouver l'ANCIEN journal. Typer `Plugin` entier obligerait le jeu
    de cas à en fabriquer un, alors qu'un objet littéral suffit. */
export function createObsidianHost(
	app: App,
	plugin: { manifest: { dir?: string } },
): Host {
```

Ajouter à `fs` :

```ts
		async append(path, data) {
			await adapter().append(path, data);
		},
		/* Les FICHIERS seulement : `ListedFiles` sépare déjà `files` et
		   `folders`. Un dossier absent n'est pas une erreur — `list` jette
		   dans ce cas, et le contrat demande `[]`. */
		async list(dir) {
			try {
				return (await adapter().list(dir)).files;
			} catch (e) {
				return [];
			}
		},
		/* Ne rejette pas sur un fichier déjà absent : deux fenêtres Obsidian
		   peuvent absorber le même fichier de conflit, et le perdant n'a rien
		   fait de mal. */
		async remove(path) {
			try {
				await adapter().remove(path);
			} catch (e) {
				if (await adapter().exists(path)) throw e;
			}
		},
		async rename(from, to) {
			await adapter().rename(from, to);
		},
```

`watcher.onRenameDir` : le même évènement `rename` du vault, filtré à
l'INVERSE de `onChange` (celui-ci ne garde que les `TFile`) :

```ts
	onRenameDir(cb) {
		/* `asTFile` rend null pour un DOSSIER : c'est exactement le cas que
		   `onChange` écarte, et celui dont le journal a besoin. Obsidian émet
		   le même évènement pour les deux, avec la même signature
		   (`TAbstractFile`) — d'où ce second abonnement plutôt qu'un champ
		   « isDir » que l'app ne saurait pas remplir honnêtement. */
		const ref = app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
			if (asTFile(f)) return;
			try { cb({ from: oldPath, to: f.path }); } catch (e) { console.warn("[Quiz] onRenameDir: rappel en erreur:", e); }
		});
		return () => { try { app.vault.offref(ref); } catch (e) { /* best effort */ } };
	},
```

`links.resourceUrl` prend `fromPath` et le transmet à la résolution existante :

```ts
		resourceUrl(target, fromPath) {
			try {
				const f = typeof target === "string"
					? resoudreTFile(target, fromPath || "")
					: tfile(target.path);
				return (f && app.vault.getResourcePath(f)) || null;
			} catch (e) {
				console.warn("[Quiz] resourceUrl erreur:", e);
				return null;
			}
		},
```

Et `paths` :

```ts
	/* UNE SEULE RACINE, d'identifiant VIDE : les chemins du greffon restent
	   exactement ce qu'ils ont toujours été, et `localPath` est l'identité.
	   C'est ce qui garantit que la clé du journal ne change pas d'un octet
	   pour les notes déjà journalisées. */
	const racine: HostRoot = {
		id: "",
		name: app.vault.getName(),
		reviewLog: `${REVIEW_DIR}/${REVIEW_LOG_NAME}`,
		/* L'ancien journal : `manifest.dir` tel que l'API le donne, jamais
		   recomposé. Il est optionnel (PluginManifest.dir), et son absence
		   signifie seulement qu'il n'y a rien à migrer. */
		legacyReviewLog: plugin.manifest.dir ? `${plugin.manifest.dir}/${REVIEW_LOG_NAME}` : null,
	};

	const paths: Host["paths"] = {
		/* NE CHANGE PAS, et ignore son argument : les fichiers de résultats
		   déjà écrits chez l'utilisateur vivent là. Même nature de piège que
		   `PLUGIN_ID` et `QUIZ_BLOCK_LANGUAGE`. */
		resultsDirFor() {
			return ".obsidian/quiz-blocks-results";
		},
		roots() {
			return [racine];
		},
		rootOf() {
			return racine;
		},
		localPath(path) {
			return path;
		},
		contractPath(_rootId, localPath) {
			return localPath;
		},
	};
```

`REVIEW_DIR` et `REVIEW_LOG_NAME` viennent de `src/review/paths.ts` — **écrire
ce fichier maintenant** (il ne contient que les deux constantes ; la tâche 3
lui ajoute la migration) :

```ts
/* ══════════════════════════════════════════════════════════
   OÙ VIT LE JOURNAL DE RÉVISION

   Une seule règle, INCONDITIONNELLE : `<racine>/.neo-quiz/review-log.jsonl`,
   sous les deux hôtes, que la racine soit un vault Obsidian ou un dossier nu.

   Elle diffère volontairement de celle des fichiers de RÉSULTATS
   (`paths.resultsDirFor`), qui dépend, elle, de la présence d'un `.obsidian/`.
   La raison n'est pas cosmétique : `estVaultObsidian()` est une DÉTECTION, et
   une détection peut changer d'avis (un `.obsidian` retiré, un dossier parent
   ouvert à la place du vault). Un fichier de résultats mal placé se retrouve ;
   un journal qui change d'emplacement fait repartir toutes les questions à
   zéro, sans un message, pendant que les révisions déjà écrites restent dans
   un fichier que plus rien ne lit.

   Le point de tête n'est pas un détail : les deux hôtes ignorent déjà les
   dossiers cachés (`dossierIgnore` côté app, l'explorateur d'Obsidian de
   l'autre), donc le journal ne pollue aucun catalogue tout en restant
   lisible par chemin.
══════════════════════════════════════════════════════════ */

export const REVIEW_DIR = ".neo-quiz";
export const REVIEW_LOG_NAME = "review-log.jsonl";
```

- [ ] **Étape 5 : implémenter côté Windows**

Dans `apps/windows/src/host/fs.ts`, ajouter à `createWindowsFs` :

```ts
		/* `append: true` de plugin-fs, PAS une lecture suivie d'une
		   réécriture : c'est l'atomicité de l'ajout qui protège le journal
		   d'une fermeture au mauvais moment. */
		async append(path, data) {
			await writeTextFile(abs(path), data, { append: true });
		},
		async list(dir) {
			try {
				const entrees = await readDir(abs(dir));
				return entrees
					.filter(e => e.isFile)
					.map(e => (dir ? `${normaliser(dir)}/${e.name}` : e.name));
			} catch (e) {
				// Dossier absent : le contrat demande `[]`, pas une exception.
				return [];
			}
		},
		async remove(path) {
			try {
				await removeFichier(abs(path));
			} catch (e) {
				if (await exists(abs(path))) throw e;
			}
		},
		/* Pas d'écrasement : `rename` de plugin-fs remplace la destination en
		   silence sur Windows, et la migration du journal s'appuie sur le
		   contraire — écraser un `review-log.jsonl.migrated` déjà là
		   détruirait la sauvegarde qu'on venait de créer. */
		async rename(from, to) {
			if (await exists(abs(to))) throw new Error(`${to} existe déjà`);
			await renameFichier(abs(from), abs(to));
		},
```

Les imports de `plugin-fs` sont renommés à l'import pour ne pas masquer les
méthodes du contrat :

```ts
import {
	exists, mkdir, readDir, readTextFile, remove as removeFichier,
	rename as renameFichier, stat, watch, writeTextFile,
} from "@tauri-apps/plugin-fs";
```

`createWindowsWatcher` gagne `onRenameDir` :

```ts
	const abonnesDossier = new Set<(ev: { from: string; to: string }) => void>();
```

et, dans `traiter`, la branche `mode === "both"` qui faisait `return` sur un
dossier émet désormais :

```ts
				try {
					const info = await stat(ev.paths[1]);
					if (info.isDirectory) {
						/* Un DOSSIER renommé. Le journal de révision déplace ses
						   clés par préfixe : une seule ligne suffit, et sans elle
						   toutes les notes du dossier perdraient leur historique
						   d'un coup. L'index, lui, n'a rien à faire ici — ses
						   entrées sont des fichiers, et le surveillant les
						   remontera une à une. */
						for (const cb of [...abonnesDossier]) {
							try { cb({ from: avant, to: apres }); } catch (e) { console.warn(LOG_PREFIX, "onRenameDir: rappel en erreur:", e); }
						}
						return;
					}
					mtime = info.mtime ? info.mtime.getTime() : 0;
				} catch (e) { …inchangé… }
```

et le retour expose le second canal :

```ts
	return {
		onChange(cb) { … inchangé … },
		/* Quand le système n'envoie PAS `both`, aucun rappel n'est appelé :
		   l'hôte n'invente pas d'appariement. C'est la tâche 9 qui traite ce
		   cas, au niveau du catalogue et sur une PREUVE. */
		onRenameDir(cb) {
			abonnesDossier.add(cb);
			return () => { abonnesDossier.delete(cb); };
		},
	};
```

`links.resourceUrl` accepte `fromPath` et le passe à la résolution :

```ts
		resourceUrl(target, fromPath) {
			try {
				const brut = typeof target === "string" ? target : target?.path;
				const chemin = normaliserLien(brut ?? "");
				if (!chemin) return null;
				const f = index.get(chemin) ?? resolveDansIndex(index.all(), chemin, fromPath || "");
				if (!f) return null;
				return convertFileSrc(cheminAbsolu(racine, f.path)) || null;
			} catch (e) {
				console.warn(LOG_PREFIX, "resourceUrl erreur:", e);
				return null;
			}
		},
```

`paths` de `createWindowsHost` devient (une seule racine pour l'instant — la
tâche 6 le rend composite) :

```ts
	const root: HostRoot = {
		id: "",
		name: racine.split(/[\\/]/).filter(Boolean).pop() || racine,
		reviewLog: `${REVIEW_DIR}/${REVIEW_LOG_NAME}`,
		/* L'ancien journal du GREFFON, à son emplacement conventionnel. Le
		   chemin est composé depuis `PLUGIN_ID` (src/branding.ts), jamais
		   écrit en dur : c'est le même identifiant que le dossier de
		   `.obsidian/plugins/`, et il ne change pas.
		   L'application le lit pour la même raison que le greffon : si elle
		   est installée d'abord, elle démarrerait sinon sur un journal vide
		   avec un semestre d'historique juste à côté. */
		legacyReviewLog: `.obsidian/plugins/${PLUGIN_ID}/${REVIEW_LOG_NAME}`,
	};

	const paths: Host["paths"] = {
		resultsDirFor() {
			return estVault ? ".obsidian/quiz-blocks-results" : `${REVIEW_DIR}/results`;
		},
		roots() { return [root]; },
		rootOf() { return root; },
		localPath(path) { return path; },
		contractPath(_rootId, localPath) { return localPath; },
	};
```

- [ ] **Étape 6 : basculer les deux consommateurs**

`src/engine/results-save.ts` ligne 69 :

```ts
	/* Le dossier vient de l'HÔTE, et il dépend de la NOTE : l'application peut
	   avoir plusieurs dossiers ouverts, et les résultats d'un quiz doivent
	   rester dans le sien. Sous Obsidian la valeur est constante. */
	const RESULTS_DIR = ctx.host.paths.resultsDirFor(ctx.sourcePath);
```

`src/engine/cards.ts` ligne 163 :

```ts
				/* `ctx.sourcePath` : la note CITANTE. Sans elle, un nom nu
				   (« schema.png ») se résout au hasard des homonymes du vault —
				   et, dans l'application, potentiellement dans un AUTRE dossier
				   que celui de la note. */
				const resolved = ctx.host.links.resourceUrl(src, ctx.sourcePath);
```

- [ ] **Étape 7 : les cas de l'hôte Obsidian**

Dans `scripts/check-obsidian-host.mjs`, ajouter un groupe. Le faux `app`/
`plugin` existe déjà dans ce script ; le compléter avec `append`, `list`,
`remove`, `rename` sur l'adaptateur, et un manifeste.

```js
await withSrcModule("apps/obsidian/host.ts", async ({ createObsidianHost }) => {
	const r = makeReporter("Hôte Obsidian — fichiers et racines");

	const ecrits = [];
	const supprimes = [];
	const renommes = [];
	let existants = new Set(["journal.jsonl"]);
	const app = fauxApp({
		adapter: {
			append: async (p, d) => { ecrits.push([p, d]); },
			list: async (dir) => {
				if (dir === "absent") throw new Error("ENOENT");
				return { files: ["dir/a.jsonl", "dir/b.jsonl"], folders: ["dir/sous"] };
			},
			exists: async (p) => existants.has(p),
			remove: async (p) => { supprimes.push(p); existants.delete(p); },
			rename: async (a, b) => { renommes.push([a, b]); },
		},
	});
	const host = createObsidianHost(app, { manifest: { dir: ".obsidian/plugins/quiz-blocks" } });

	await host.fs.append("j.jsonl", "{}\n");
	r.check("append passe la donnée telle quelle", ecrits, [["j.jsonl", "{}\n"]]);

	/* Les FICHIERS seulement : rendre aussi les dossiers ferait tenter
	   l'absorption d'un dossier comme s'il était un journal de conflit. */
	r.check("list ne rend que les fichiers", await host.fs.list("dir"), ["dir/a.jsonl", "dir/b.jsonl"]);
	/* Un dossier absent est le cas NORMAL (aucun conflit Syncthing) : une
	   exception ici ferait échouer tout le chargement du journal. */
	r.check("list d'un dossier absent rend []", await host.fs.list("absent"), []);

	/* Deux fenêtres Obsidian peuvent absorber le même fichier de conflit :
	   le perdant ne doit pas lever. */
	await host.fs.remove("deja-parti.jsonl");
	r.check("remove d'un fichier absent ne lève pas", supprimes, ["deja-parti.jsonl"]);

	await host.fs.rename("a", "b");
	r.check("rename transmet les deux chemins", renommes, [["a", "b"]]);

	/* UNE racine, d'identifiant VIDE, et `localPath` est l'identité : c'est
	   ce qui garantit qu'une clé de journal déjà écrite ne change pas. */
	const roots = host.paths.roots();
	r.check("une seule racine", roots.length, 1);
	r.check("son identifiant est vide", roots[0].id, "");
	r.check("le journal est à sa place fixe", roots[0].reviewLog, ".neo-quiz/review-log.jsonl");
	r.check("l'ancien journal vient du manifeste",
		roots[0].legacyReviewLog, ".obsidian/plugins/quiz-blocks/review-log.jsonl");
	r.check("localPath ne touche à rien", host.paths.localPath("Cours/reseau.md"), "Cours/reseau.md");
	r.check("contractPath ne touche à rien", host.paths.contractPath("", "Cours/reseau.md"), "Cours/reseau.md");
	/* `resultsDirFor` IGNORE son argument côté Obsidian, et doit rendre la
	   valeur historique : la changer rendrait introuvables les exports déjà
	   écrits chez l'utilisateur. */
	r.check("resultsDirFor est constant", host.paths.resultsDirFor("n'importe/quoi.md"), ".obsidian/quiz-blocks-results");

	/* Sans manifeste, il n'y a rien à migrer — et surtout pas un chemin
	   inventé, qui pointerait à côté et lirait le journal de personne. */
	const sansManifeste = createObsidianHost(app, { manifest: {} });
	r.check("sans manifeste, aucun ancien journal", sansManifeste.paths.roots()[0].legacyReviewLog, null);

	r.done();
});
```

**Éprouver chaque cas DISCRIMINANT** : remplacer `roots[0].id` par `"vault"`
dans l'hôte → le cas « son identifiant est vide » rougit ; faire rendre
`listing.files.concat(listing.folders)` → le cas « list ne rend que les
fichiers » rougit ; retirer le `try/catch` de `list` → le cas « dossier absent »
rougit. Restaurer après chaque essai.

- [ ] **Étape 8 : les cas de l'hôte Windows**

Dans `scripts/check-windows-host.mjs`, ajouter au groupe « liens » :

```ts
	/* `fromPath` BORNE la résolution : sans lui, un nom nu tombe sur
	   l'homonyme le plus proche de la RACINE, pas de la note citante. */
	r.check("resourceUrl passe la note citante à la résolution par nom",
		links.resourceUrl("schema.png", "Cours/reseau.md"), "asset://localhost/D:/Quiz/Cours/Images/schema.png");
```

- [ ] **Étape 9 : vérifier**

```bash
npm run check; echo "EXIT=$?"
npm run check:obsidian-host; echo "EXIT=$?"
npm run check:windows-host; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run build
```

Puis Obsidian : ouvrir une note à quiz, jouer une question, exporter les
résultats (ils doivent toujours atterrir dans `.obsidian/quiz-blocks-results`),
ouvrir le tableau de bord.

- [ ] **Étape 10 : commit**

```bash
git add src/host/types.ts src/review/paths.ts apps/obsidian/host.ts apps/windows/src/host src/engine/results-save.ts src/engine/cards.ts scripts/check-obsidian-host.mjs scripts/check-windows-host.mjs
git commit -m "feat(host): ajouter, lister, supprimer, renommer, et connaitre ses racines"
```

---
## Tâche 3 — La migration du journal, écrite et éprouvée avant d'être branchée

Elle est écrite AVANT son branchement (tâche 4) parce que c'est du code qu'une
relecture ne suffit pas à juger : l'ordre des opérations y est tout, et
l'erreur ne se voit qu'une fois l'historique perdu.

**Fichiers :**
- Modifier : `src/review/paths.ts` (créé en tâche 2)
- Créer : `src/review/migration.ts`
- Créer : `scripts/check-review-log.mjs`
- Modifier : `package.json` (script `check:review-log`)

**Interfaces :**
- Consomme : `formatLine`, `parseLog` (`src/scheduler`) ; `REVIEW_DIR`,
  `REVIEW_LOG_NAME` (`src/review/paths.ts`).
- Produit : `MigrationFs`, `MigrationResult`, `SUFFIXE_MIGRE`,
  `migrateReviewLog(fs, ancien, nouveau): Promise<MigrationResult>`. Les tâches
  4 et 8 l'appellent, chacune depuis son hôte.

- [ ] **Étape 1 : écrire le jeu de cas D'ABORD**

Créer `scripts/check-review-log.mjs`. Le faux système de fichiers est une
`Map` : c'est lui qui rend éprouvables les cas qu'aucun disque ne produit sur
commande (une écriture qui n'écrit pas, un renommage refusé).

```js
/**
 * LE JOURNAL DE RÉVISION — emplacement et MIGRATION.
 *
 * Ce que ce script empêche : perdre un semestre de révisions. L'ordre des
 * opérations est la seule chose qui protège l'historique — écrire, RELIRE
 * pour confirmer, et seulement alors renommer l'ancien. Une relecture
 * sautée ne se verrait pas : tout aurait l'air d'avoir marché.
 *
 *     npm run check:review-log
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Un disque en mémoire. `appendCasse` simule une écriture qui prétend
    réussir sans rien écrire : c'est exactement ce contre quoi la relecture
    existe, et rien d'autre ne sait le produire. */
function fauxFs(initial = {}, options = {}) {
	const fichiers = new Map(Object.entries(initial));
	const trace = [];
	return {
		fichiers,
		trace,
		async exists(p) { trace.push(["exists", p]); return fichiers.has(p); },
		async read(p) {
			trace.push(["read", p]);
			if (!fichiers.has(p)) throw new Error("ENOENT " + p);
			return fichiers.get(p);
		},
		async append(p, d) {
			trace.push(["append", p, d]);
			if (options.appendCasse) return;
			fichiers.set(p, (fichiers.get(p) ?? "") + d);
		},
		async mkdirs(p) { trace.push(["mkdirs", p]); },
		async rename(a, b) {
			trace.push(["rename", a, b]);
			if (options.renameCasse) throw new Error("EPERM");
			if (fichiers.has(b)) throw new Error("EEXIST " + b);
			fichiers.set(b, fichiers.get(a));
			fichiers.delete(a);
		},
	};
}

const ligne = (q, at, grade = "correct") => JSON.stringify({ t: "answer", q, at, grade }) + "\n";

const ANCIEN = ".obsidian/plugins/quiz-blocks/review-log.jsonl";
const NOUVEAU = ".neo-quiz/review-log.jsonl";

await withSrcModule("src/review/migration.ts", async ({ migrateReviewLog, SUFFIXE_MIGRE }) => {
	const r = makeReporter("Journal — migration");

	/* 1. Aucun ancien journal : le cas de l'immense majorité des démarrages.
	      Il ne doit RIEN écrire — surtout pas créer un `.neo-quiz/` vide. */
	{
		const fs = fauxFs({});
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("sans ancien journal, rien à faire", res.skipped, true);
		r.check("sans ancien journal, aucune écriture",
			fs.trace.filter(([op]) => op !== "exists"), []);
	}

	/* 2. Le cas nominal : tout part, et l'ancien est RENOMMÉ, jamais supprimé.
	      Un semestre de révisions ne se rattrape pas ; quelques kilo-octets
	      conservés ne coûtent rien. */
	{
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1) + ligne("a.md::q2", 2) });
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("les deux lignes sont absorbées", res.absorbed, 2);
		r.check("le nouveau journal les porte",
			fs.fichiers.get(NOUVEAU), ligne("a.md::q1", 1) + ligne("a.md::q2", 2));
		r.check("l'ancien est renommé", res.renamed, true);
		r.check("l'ancien EXISTE toujours, sous son nouveau nom",
			fs.fichiers.has(ANCIEN + SUFFIXE_MIGRE), true);
		r.check("l'ancien n'est plus à sa place", fs.fichiers.has(ANCIEN), false);
		/* Le dossier AVANT l'ajout : `.neo-quiz/` n'existe pas au premier
		   démarrage, et un append dans un dossier absent échoue. */
		const ordre = fs.trace.filter(([op]) => op === "mkdirs" || op === "append").map(([op]) => op);
		r.check("le dossier est créé avant l'ajout", ordre, ["mkdirs", "append"]);
	}

	/* 3. Recouvrement : les deux journaux partagent des lignes. C'est le cas
	      NORMAL quand les deux hôtes migrent (spec §5, décision D2), pas
	      l'exception. Sans dédoublonnage, `spentToday` compterait deux fois
	      les mêmes réponses et mangerait le budget du jour. */
	{
		const fs = fauxFs({
			[ANCIEN]: ligne("a.md::q1", 1) + ligne("a.md::q2", 2),
			[NOUVEAU]: ligne("a.md::q1", 1) + ligne("b.md::q9", 9),
		});
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("seule la ligne manquante est ajoutée", res.absorbed, 1);
		r.check("le doublon est compté, pas écrit", res.duplicates, 1);
		r.check("le nouveau journal a trois lignes",
			fs.fichiers.get(NOUVEAU).trim().split("\n").length, 3);
	}

	/* 4. Un journal qui ne finit PAS par un saut de ligne (édité à la main,
	      tronqué par une fermeture brutale). Sans le raccord, la dernière
	      ligne existante et la première absorbée se collent, et les DEUX
	      deviennent illisibles — on perdrait une révision qu'on prétendait
	      sauver. */
	{
		const sansSaut = ligne("b.md::q9", 9).trimEnd();
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1), [NOUVEAU]: sansSaut });
		await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		const relu = fs.fichiers.get(NOUVEAU).split("\n").filter(Boolean).map(l => JSON.parse(l).q);
		r.check("aucune ligne n'est collée à une autre", relu, ["b.md::q9", "a.md::q1"]);
	}

	/* 5. Une ligne illisible : on absorbe ce qu'on a compris, et on ne
	      DÉPLACE PAS un fichier qu'on n'a pas entièrement lu. La migration se
	      rejouera au prochain démarrage — elle est idempotente, ça ne coûte
	      qu'une lecture. */
	{
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1) + "{ceci n'est pas du JSON\n" });
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("la ligne lisible est absorbée", res.absorbed, 1);
		r.check("l'illisible est comptée", res.ignored, 1);
		r.check("l'ancien N'EST PAS renommé", res.renamed, false);
		r.check("l'ancien est toujours là", fs.fichiers.has(ANCIEN), true);
	}

	/* 6. L'écriture prétend réussir sans rien écrire. C'est LE cas pour lequel
	      la relecture existe : sans elle, l'ancien serait renommé et les
	      révisions n'existeraient plus nulle part. */
	{
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1) }, { appendCasse: true });
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("la relecture ne confirme pas", res.confirmed, false);
		r.check("rien n'est compté comme absorbé", res.absorbed, 0);
		r.check("l'ancien N'EST PAS renommé", res.renamed, false);
		r.check("l'ancien est intact", fs.fichiers.get(ANCIEN), ligne("a.md::q1", 1));
	}

	/* 7. Idempotence : deux exécutions de suite (les deux hôtes, ou deux
	      démarrages). La seconde ne trouve plus rien à faire. */
	{
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1) });
		await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		const deux = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("la seconde exécution n'a rien à faire", deux.skipped, true);
		r.check("le journal n'a pas doublé",
			fs.fichiers.get(NOUVEAU), ligne("a.md::q1", 1));
	}

	/* 8. Le renommage échoue (support en lecture seule, verrou de synchro).
	      Les données sont DÉJÀ dans le nouveau journal : l'échec du renommage
	      ne doit pas remonter comme une panne de migration, ni faire échouer
	      le démarrage. */
	{
		const fs = fauxFs({ [ANCIEN]: ligne("a.md::q1", 1) }, { renameCasse: true });
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("les données sont passées", res.absorbed, 1);
		r.check("le renommage a échoué sans lever", res.renamed, false);
	}

	/* 9. Un ancien journal VIDE (créé puis jamais écrit) : rien à absorber,
	      mais il n'y a rien à comprendre non plus — on le range, sinon la
	      passe se rejoue à chaque démarrage pour rien. */
	{
		const fs = fauxFs({ [ANCIEN]: "" });
		const res = await migrateReviewLog(fs, ANCIEN, NOUVEAU);
		r.check("un ancien vide est rangé", res.renamed, true);
		r.check("et rien n'est créé", fs.fichiers.has(NOUVEAU), false);
	}

	/* 10. Pas d'ancien chemin du tout (Obsidian sans `manifest.dir`) : la
	       fonction ne doit pas fabriquer un chemin, elle doit ne rien faire. */
	{
		const fs = fauxFs({});
		const res = await migrateReviewLog(fs, null, NOUVEAU);
		r.check("sans ancien chemin, rien à faire", res.skipped, true);
		r.check("et aucun appel disque", fs.trace, []);
	}

	r.done();
});
```

Ajouter à `package.json` :

```json
    "check:review-log": "node scripts/check-review-log.mjs",
```

- [ ] **Étape 2 : lancer le script et le voir échouer**

```bash
npm run check:review-log; echo "EXIT=$?"
```

Attendu : une erreur de build (le module `src/review/migration.ts` n'existe
pas). C'est l'échec juste — pas des cas rouges, un module absent.

- [ ] **Étape 3 : écrire la migration**

Créer `src/review/migration.ts` :

```ts
import { formatLine, parseLog } from "../scheduler";

/* ══════════════════════════════════════════════════════════
   LA MIGRATION DU JOURNAL

   L'ancien journal vivait à côté du GREFFON
   (`.obsidian/plugins/quiz-blocks/review-log.jsonl`). Il vit désormais à
   côté des NOTES (`<racine>/.neo-quiz/review-log.jsonl`), pour que les deux
   hôtes le partagent et que la synchronisation du dossier l'emporte avec ce
   qu'il décrit.

   L'ORDRE EST TOUT, et c'est le même que celui de l'absorption des fichiers
   de conflit Syncthing : lire, écrire AILLEURS, RELIRE pour confirmer, et
   seulement alors renommer l'ancien — jamais le supprimer. On ne détruit
   pas une source avant d'avoir prouvé que la copie est lisible. Un ancien
   journal conservé coûte quelques kilo-octets ; un semestre de révisions
   perdu ne se rattrape pas.

   Et ce n'est pas une copie, c'est une ABSORPTION : les lignes déjà
   présentes sont ignorées. C'est ce qui rend l'opération idempotente, donc
   sûre à exécuter par les DEUX hôtes — l'ordre des installations n'a alors
   plus d'importance, et deux exécutions simultanées sur un dossier
   synchronisé ne peuvent rien perdre.
══════════════════════════════════════════════════════════ */

/** Le sous-ensemble de `HostFs` dont la migration a besoin. Déclaré ici, et
    pas importé du contrat, pour que le jeu de cas puisse le fournir sans
    fabriquer un hôte entier — c'est la même idée que `ReviewSink` côté
    moteur : on ne connaît que la FORME. */
export interface MigrationFs {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	append(path: string, data: string): Promise<void>;
	mkdirs(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

export interface MigrationResult {
	/** Lignes ajoutées ET confirmées par la relecture. */
	absorbed: number;
	/** Lignes de l'ancien déjà présentes dans le nouveau. */
	duplicates: number;
	/** Lignes illisibles de l'ancien. Non nul ⇒ on ne renomme pas. */
	ignored: number;
	/** La relecture a-t-elle retrouvé tout ce qu'on venait d'écrire ?
	    Vrai aussi quand il n'y avait rien à écrire. */
	confirmed: boolean;
	/** L'ancien a-t-il été rangé sous `.migrated` ? */
	renamed: boolean;
	/** Aucun ancien journal : il n'y avait rien à faire. */
	skipped: boolean;
}

/** Le suffixe de rangement. L'ancien fichier n'est JAMAIS supprimé. */
export const SUFFIXE_MIGRE = ".migrated";

const RIEN: MigrationResult = {
	absorbed: 0, duplicates: 0, ignored: 0, confirmed: true, renamed: false, skipped: true,
};

/** Le dossier d'un chemin, ou "" à la racine. */
function dossierDe(chemin: string): string {
	const i = chemin.lastIndexOf("/");
	return i > 0 ? chemin.slice(0, i) : "";
}

/**
 * Absorbe `ancien` dans `nouveau`, puis range `ancien`.
 *
 * Les erreurs d'entrée/sortie REMONTENT : c'est l'appelant qui décide, et il
 * décide toujours la même chose — journaliser et continuer à démarrer. Les
 * avaler ici ferait passer une migration impossible pour une migration
 * faite.
 */
export async function migrateReviewLog(
	fs: MigrationFs,
	ancien: string | null,
	nouveau: string,
): Promise<MigrationResult> {
	if (!ancien) return { ...RIEN };
	if (!(await fs.exists(ancien))) return { ...RIEN };

	const { lines, ignored } = parseLog(await fs.read(ancien));

	/* Les lignes déjà là. `finSaine` : un fichier qui ne se termine pas par un
	   saut collerait sa dernière ligne à la première absorbée, et les deux
	   deviendraient illisibles. */
	const dejaLa = new Set<string>();
	let finSaine = true;
	if (await fs.exists(nouveau)) {
		const courant = await fs.read(nouveau);
		finSaine = courant === "" || courant.endsWith("\n");
		for (const l of parseLog(courant).lines) dejaLa.add(formatLine(l));
	}

	const aAjouter: string[] = [];
	let duplicates = 0;
	for (const l of lines) {
		const cle = formatLine(l);
		if (dejaLa.has(cle)) { duplicates++; continue; }
		dejaLa.add(cle);
		aAjouter.push(cle);
	}

	let confirmed = true;
	if (aAjouter.length) {
		const dossier = dossierDe(nouveau);
		if (dossier) await fs.mkdirs(dossier);
		// `join("")` : `formatLine` termine DÉJÀ chaque ligne par un saut.
		await fs.append(nouveau, (finSaine ? "" : "\n") + aAjouter.join(""));
		/* RELIRE. On vérifie la PRÉSENCE de chaque ligne, pas un total : un
		   compte ne dit pas QUOI a été écrit. */
		const relu = new Set(parseLog(await fs.read(nouveau)).lines.map(formatLine));
		confirmed = !aAjouter.some(l => !relu.has(l));
	}

	/* Le renommage, et ses deux conditions. La relecture doit avoir confirmé,
	   et l'ancien doit avoir été entièrement COMPRIS : mieux vaut refaire une
	   passe demain (elle ne coûtera qu'une lecture, tout étant dédoublonné)
	   que ranger un fichier dont une ligne nous échappe. */
	let renamed = false;
	if (confirmed && ignored === 0) {
		try {
			await fs.rename(ancien, ancien + SUFFIXE_MIGRE);
			renamed = true;
		} catch (e) {
			/* Support en lecture seule, verrou de synchro, ou `.migrated` déjà
			   là (une migration précédente est allée jusqu'au bout). Les
			   données sont DÉJÀ dans le nouveau journal : l'échec du rangement
			   n'est pas un échec de migration, et il ne doit pas empêcher le
			   démarrage. */
		}
	}

	return {
		absorbed: confirmed ? aAjouter.length : 0,
		duplicates,
		ignored,
		confirmed,
		renamed,
		skipped: false,
	};
}
```

- [ ] **Étape 4 : voir le jeu de cas passer, puis l'éprouver DISCRIMINANT**

```bash
npm run check:review-log; echo "EXIT=$?"
```

Attendu : `10/10` (ou le total réel) et `EXIT=0`.

Puis, un par un — c'est la partie qui compte, et elle prend cinq minutes :

| Casser | Doit rougir |
|---|---|
| supprimer la relecture (`confirmed = true` en dur) | cas 6 |
| renommer même si `ignored > 0` | cas 5 |
| supprimer le dédoublonnage (`dejaLa`) | cas 3 et 7 |
| retirer le raccord `finSaine` | cas 4 |
| `fs.remove` au lieu de `fs.rename` | cas 2 (l'ancien doit exister sous son nouveau nom) |
| appeler `mkdirs` après `append` | cas 2 (l'ordre) |

Restaurer après chaque essai, et revérifier le vert.

- [ ] **Étape 5 : commit**

```bash
git add src/review/migration.ts scripts/check-review-log.mjs package.json
git commit -m "feat(review): la migration du journal, absorbee et confirmee avant tout renommage"
```

---

## Tâche 4 — L'adaptateur du journal passe au contrat et quitte le tableau de bord

**Fichiers :**
- Créer : `src/review/log-file.ts` (un journal = un fichier)
- Créer : `src/review/review-store.ts` (déplacé de `src/dashboard/review-store.ts`)
- Supprimer : `src/dashboard/review-store.ts`
- Modifier : `src/dashboard/home.ts`, `src/types/dashboard-ctx.ts` (imports)
- Modifier : `apps/obsidian/plugin.ts` (construction + migration)
- Modifier : `scripts/check-review-store.mjs` (faux `Host` au lieu de faux `Plugin`)
- Modifier : `scripts/check-host.mjs` (`RESTANTS` : une entrée de moins)

**Interfaces :**
- Consomme : `HostFs`, `HostWatcher`, `HostPaths`, `HostRoot` (tâche 2) ;
  `migrateReviewLog` (tâche 3) ; `planToday`, `parseLog`, `formatLine`,
  `applyRenames`, `DEFAULT_PARAMS` (`src/scheduler`).
- Produit :
  - `createLogFile(deps): LogFile` avec
    `{ load(): Promise<void>; lines(): LogLine[]; append(lines: LogLine[]): void; destroy(): void }` ;
  - `createReviewStore(deps: ReviewStoreDeps): ReviewStore` avec
    `{ load(): Promise<void>; record(entries): void; renamed(from, to): void; plan(now): Plan; keyOf(path, id): string; destroy(): void }` ;
  - `buildReviewCatalogue(quizzes, overrides)` (inchangé, réexporté) ;
  - `parseExamDate(brut: string): number | null`.
  Les tâches 8, 10 et 11 les consomment.

- [ ] **Étape 1 : sortir « un journal = un fichier » dans son module**

Créer `src/review/log-file.ts` avec le code déjà écrit et éprouvé de
`dashboard/review-store.ts` — chargement, absorption des conflits Syncthing,
écriture différée — en remplaçant `plugin.app.vault.adapter` par `deps.fs`.
**Rien de cette logique ne change** : elle est déjà revue, et une réécriture
« au passage » serait la façon de perdre ce qu'elle protège.

```ts
import { formatLine, parseLog } from "../scheduler";
import type { LogLine } from "../scheduler";
import { LOG_PREFIX } from "../branding";

/* ══════════════════════════════════════════════════════════
   UN JOURNAL = UN FICHIER

   Tout ce qui concerne UN fichier de journal : le lire, absorber les
   fichiers de conflit déposés à côté, et y ajouter des lignes sans jamais
   le réécrire. Le routage entre PLUSIEURS journaux (l'application peut
   ouvrir dix dossiers) vit dans `review-store.ts` — ici, il n'y a qu'un
   fichier et il n'a pas à savoir qu'il en existe d'autres.

   Extrait de `dashboard/review-store.ts` SANS retouche de logique : chaque
   garde de ce fichier vient d'une revue, et une réécriture « au passage »
   serait la façon de les perdre.
══════════════════════════════════════════════════════════ */

const DEBOUNCE_MS = 500;

export interface LogFileFs {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	append(path: string, data: string): Promise<void>;
	list(dir: string): Promise<string[]>;
	remove(path: string): Promise<void>;
	mkdirs(path: string): Promise<void>;
}

export interface LogFile {
	load(): Promise<void>;
	/** Les lignes connues, dans l'ordre du fichier. */
	lines(): LogLine[];
	/** Ajoute des lignes : en mémoire tout de suite, sur disque bientôt. */
	append(lines: LogLine[]): void;
	destroy(): void;
}

export function createLogFile(deps: { fs: LogFileFs; path: string }): LogFile {
	// Le corps vient de `src/dashboard/review-store.ts`, DÉPLACÉ, pas réécrit.
	// Voir la procédure ci-dessous.
}
```

**La procédure, et elle est mécanique — ne rien réécrire de mémoire :**

1. `git show HEAD:src/dashboard/review-store.ts > src/review/log-file.ts`
   (le fichier n'a pas encore bougé à ce stade), puis y garder **exactement**
   ces déclarations et rien d'autre : `DEBOUNCE_MS`, `lignes`, `enAttente`,
   `timer`, `enCours`, `detruit`, `charge`, `echecSignale`, `estConflit`,
   `absorberConflits`, `load`, `ecrireBientot`, `flush`.
2. Supprimer ce qui part dans `review-store.ts` : `keyOfQuestion`,
   `ReviewStorePlugin`, `buildReviewCatalogue`, `record`, `horizons`, `plan`,
   `sansSlashFinal`, `correspondAuChemin`, le `renameRef` et `destroy`.
3. Trois remplacements, et **aucun autre** :
   - `plugin.app.vault.adapter.<méthode>(…)` → `deps.fs.<méthode>(…)` ;
   - la variable `chemin` → `deps.path`, et `dossierPlugin` → le dossier du
     journal (`deps.path.slice(0, deps.path.lastIndexOf("/"))`), qui remplace
     aussi le `throw` du constructeur — il n'y a plus de `manifest.dir` à
     exiger ;
   - `"[quiz-blocks]"` écrit en dur dans les messages → `LOG_PREFIX`.
4. Ajouter `lines()` (`() => lignes`), `append(lot)` (pousse dans `lignes` et
   `enAttente` puis `ecrireBientot()`) et `destroy()` (le corps actuel, moins
   `plugin.app.vault.offref`).

**Rien de la logique conservée ne change.** Chaque garde de ce fichier vient
d'une revue — l'ordre du lot remis en tête après un échec, le non-réarmement
du minuteur, la garde `charge` qui empêche un renommage d'être filtré avant le
chargement. Les réécrire « au passage » serait la façon de les perdre, et
aucun contrôle ne le dirait avant qu'un journal soit corrompu.

Le dossier scruté pour les conflits est celui du journal
(`deps.path.slice(0, deps.path.lastIndexOf("/"))`), et non plus le dossier du
greffon. La règle de nommage ne change pas : Syncthing dépose
`review-log.sync-conflict-<date>-<appareil>.jsonl` **à côté** du fichier
d'origine, quel que soit ce dossier.

- [ ] **Étape 2 : écrire l'adaptateur, multi-racines**

Créer `src/review/review-store.ts` :

```ts
import type { HostFs, HostPaths, HostRoot, HostWatcher } from "../host/types";
import type { QuizIndexEntry } from "../dashboard/scanner";
import { applyModuleOverrides, moduleForQuiz, type ModuleOverride } from "../dashboard/quiz-modules";
import {
	applyRenames, DEFAULT_PARAMS, formatLine, parseLog, planToday,
	type LogLine, type Plan, type ReviewEvent, type ReviewGrade, type ScheduledItem, type SchedulerParams,
} from "../scheduler";
import type { QuestionRole } from "../types/quiz";
import { createLogFile, type LogFile } from "./log-file";
import { LOG_PREFIX } from "../branding";

/* ══════════════════════════════════════════════════════════
   L'ADAPTATEUR DE L'ORDONNANCEUR

   Le noyau (`src/scheduler/`) ne voit que des chaînes opaques et des
   nombres. Ce module lit et écrit les octets, construit le catalogue, suit
   les renommages — et depuis la tranche 2, ROUTE entre plusieurs journaux.

   IL A CHANGÉ DE STATUT, et il faut le dire plutôt que de le laisser
   deviner. La spec de l'ordonnanceur (§3) le rangeait dans `dashboard/`
   « par choix : c'est le dossier que le chantier 4 supprime », et le
   qualifiait de JETABLE. À partir du moment où l'application écrit le même
   journal, ce n'est plus l'adaptateur d'un hôte : c'est le format d'un
   fichier partagé. Le supprimer avec le tableau de bord emporterait
   l'application avec lui.

   LA CLÉ DU JOURNAL EST LOCALE, JAMAIS PRÉFIXÉE. Sur le disque, une clé
   vaut « Cours/reseau.md::adressage-ip » : relative à SA racine, identique
   sous les deux hôtes. En mémoire, quand l'application ouvre plusieurs
   dossiers, les clés portent le préfixe de leur racine pour ne pas se
   confondre. La conversion se fait ICI et nulle part ailleurs
   (`paths.localPath` / `paths.contractPath`) : une clé recomposée à la main
   ferait diverger les deux historiques sans que personne ne le voie.
══════════════════════════════════════════════════════════ */

const keyOfQuestion = (path: string, id: string): string => `${path}::${id}`;

/** Le chemin d'une clé de question (`chemin::id` → `chemin`). */
function cheminDeCle(q: string): string {
	const i = q.lastIndexOf("::");
	return i > 0 ? q.slice(0, i) : q;
}

export interface ReviewStoreDeps {
	fs: HostFs;
	watcher: HostWatcher;
	paths: HostPaths;
	/** Le catalogue du moment, en clés du CONTRAT. Appelé à chaque plan :
	    une question supprimée d'une note disparaît du plan le jour même. */
	catalogue(): ScheduledItem[];
	/** module → date d'examen (ms) ou null. Appelé à chaque plan. */
	horizons(): Record<string, number | null>;
	/** L'heure. INJECTÉE, pas lue : c'est ce qui rend les jeux de cas
	    reproductibles, et c'est déjà la règle du noyau. */
	now(): number;
	params?: SchedulerParams;
}

export interface ReviewStore {
	load(): Promise<void>;
	record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void;
	/** Un renommage OBSERVÉ (fichier ou dossier), en chemins du contrat. */
	renamed(from: string, to: string): void;
	plan(now: number): Plan;
	keyOf(path: string, id: string): string;
	destroy(): void;
}
```

Le corps :

```ts
export function createReviewStore(deps: ReviewStoreDeps): ReviewStore {
	const params = deps.params ?? DEFAULT_PARAMS;
	let detruit = false;

	/* UN JOURNAL PAR RACINE. Les racines sont figées à la construction : en
	   ajouter une exige de reconstruire le store, ce que l'application fait
	   déjà en rechargeant sa fenêtre (l'hôte est un singleton). */
	const journaux = new Map<string, { root: HostRoot; fichier: LogFile }>();
	for (const root of deps.paths.roots()) {
		journaux.set(root.id, { root, fichier: createLogFile({ fs: deps.fs, path: root.reviewLog }) });
	}

	/** La clé LOCALE (ce qui est écrit) d'une clé du contrat, avec sa racine. */
	function versLocal(q: string): { rootId: string; local: string } | null {
		const chemin = cheminDeCle(q);
		const root = deps.paths.rootOf(chemin);
		if (!root) return null;
		const suffixe = q.slice(chemin.length); // « ::id », ou "" pour un chemin nu
		return { rootId: root.id, local: deps.paths.localPath(chemin) + suffixe };
	}

	/** L'inverse, pour ce qui sort d'un journal. */
	function versContrat(rootId: string, q: string): string {
		const chemin = cheminDeCle(q);
		const suffixe = q.slice(chemin.length);
		return deps.paths.contractPath(rootId, chemin) + suffixe;
	}

	/* Toutes les lignes, en clés du CONTRAT. La conversion se fait AVANT la
	   concaténation, et c'est ce qui empêche un renommage d'une racine de
	   rattraper une clé d'une autre : préfixées, elles ne se ressemblent plus. */
	function toutesLesLignes(): LogLine[] {
		const out: LogLine[] = [];
		for (const [rootId, { fichier }] of journaux) {
			for (const l of fichier.lines()) {
				out.push(l.t === "rename"
					? { ...l, from: versContrat(rootId, l.from), to: versContrat(rootId, l.to) }
					: { ...l, q: versContrat(rootId, l.q) });
			}
		}
		return out;
	}

	async function load(): Promise<void> {
		/* En parallèle : dix dossiers sur un disque réseau, en série, feraient
		   attendre le premier rendu pour rien. Une racine illisible ne doit pas
		   emporter les autres — d'où le `catch` par racine. */
		await Promise.all([...journaux.values()].map(async ({ root, fichier }) => {
			try {
				await fichier.load();
			} catch (e) {
				console.warn(LOG_PREFIX, "journal illisible pour", root.name, e);
			}
		}));
	}

	function record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void {
		if (detruit || !entries.length) return;
		const at = deps.now();
		/* Regroupées par racine : une réponse est écrite dans le journal du
		   dossier auquel appartient sa question (spec §6), jamais ailleurs. */
		const parRacine = new Map<string, LogLine[]>();
		for (const e of entries) {
			const cible = versLocal(e.q);
			if (!cible) { console.warn(LOG_PREFIX, "clé hors de toute racine, ignorée:", e.q); continue; }
			const ligne: ReviewEvent = { t: "answer", q: cible.local, at, grade: e.grade };
			if (e.role) ligne.role = e.role;
			const lot = parRacine.get(cible.rootId);
			if (lot) lot.push(ligne); else parRacine.set(cible.rootId, [ligne]);
		}
		for (const [rootId, lot] of parRacine) journaux.get(rootId)?.fichier.append(lot);
	}

	/* `applyRenames` attend des préfixes exacts ; garder un slash final
	   fabriquerait « Cours// » et orphelinerait l'historique du dossier. */
	const sansSlashFinal = (path: string): string => path.endsWith("/") ? path.slice(0, -1) : path;
	const correspondAuChemin = (q: string, path: string): boolean =>
		q === path || q.startsWith(path + "/") || q.startsWith(path + "::");

	function renamed(fromBrut: string, toBrut: string): void {
		if (detruit) return;
		const from = sansSlashFinal(fromBrut);
		const to = sansSlashFinal(toBrut);
		if (from === to) return;
		const source = deps.paths.rootOf(from);
		const cible = deps.paths.rootOf(to);
		/* Un déplacement d'une racine à une AUTRE n'est pas un renommage : les
		   deux journaux sont distincts, et une ligne écrite dans l'un ne
		   déplacerait rien dans l'autre. On ne fabrique donc rien — l'historique
		   reste attaché à l'ancien dossier, ce qui est au moins vrai. */
		if (!source || !cible || source.id !== cible.id) return;

		const journal = journaux.get(source.id);
		if (!journal) return;
		/* Une ligne de renommage n'existe que si elle DÉPLACE réellement une
		   clé. Rejouer d'abord les renommages déjà journalisés est nécessaire
		   pour qu'un second déplacement reconnaisse le chemin COURANT plutôt
		   que le chemin historique. */
		const local = deps.paths.localPath(from);
		const localTo = deps.paths.localPath(to);
		if (!applyRenames(journal.fichier.lines()).some(line => correspondAuChemin(line.q, local))) return;
		journal.fichier.append([{ t: "rename", from: local, to: localTo, at: deps.now() }]);
	}

	/* Les renommages que l'HÔTE sait nommer : fichiers (`onChange`) et
	   dossiers (`onRenameDir`). Le second canal n'est pas un luxe — un dossier
	   renommé déplace toutes ses notes en une seule ligne, et sans lui
	   l'historique de tout un module deviendrait orphelin d'un coup. */
	const desabonner: Array<() => void> = [
		deps.watcher.onChange(ev => { if (ev.kind === "rename") renamed(ev.oldPath, ev.file.path); }),
		deps.watcher.onRenameDir(ev => renamed(ev.from, ev.to)),
	];

	function plan(now: number): Plan {
		const d = new Date(now);
		// Seul l'hôte connaît le fuseau : le noyau ne manipule aucun calendrier.
		const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
		return planToday({
			now, dayStart,
			items: deps.catalogue(),
			events: toutesLesLignes(),
			horizons: deps.horizons(),
			params,
		});
	}

	function destroy(): void {
		if (detruit) return;
		detruit = true;
		for (const d of desabonner) { try { d(); } catch (e) { /* best effort */ } }
		desabonner.length = 0;
		for (const { fichier } of journaux.values()) fichier.destroy();
	}

	return { load, record, renamed, plan, keyOf: keyOfQuestion, destroy };
}
```

`buildReviewCatalogue` est repris **tel quel** de l'ancien fichier, et
`parseExamDate` en est extrait (le greffon et l'application saisissent tous
deux une date, et une seconde conversion divergerait) :

```ts
/**
 * Une date d'examen saisie (`AAAA-MM-JJ`) en epoch ms, à MINUIT LOCAL.
 *
 * Le constructeur ISO texte serait UTC et pourrait déplacer l'examen d'un
 * jour selon le fuseau. Et la garde `Number.isFinite` n'est pas décorative :
 * `horizonFor` (le noyau) ne se protège pas d'un horizon NaN — il a raison,
 * il ne reçoit qu'un `number | null` déjà validé. Une année à six chiffres
 * passe le premier filtre et produit un timestamp NaN, qui empoisonnerait
 * silencieusement toutes les échéances du module.
 */
export function parseExamDate(brut: unknown): number | null {
	if (typeof brut !== "string" || !brut) return null;
	const [a, m, j] = brut.split("-").map(Number);
	if (!a || !m || !j) return null;
	const t = new Date(a, m - 1, j).getTime();
	return Number.isFinite(t) ? t : null;
}
```

- [ ] **Étape 3 : brancher le greffon**

Dans `apps/obsidian/plugin.ts` :

```ts
import { createReviewStore, parseExamDate } from "../../src/review/review-store";
import { migrateReviewLog } from "../../src/review/migration";
```

et, dans `onload`, à la place du bloc actuel :

```ts
		/* Le journal de révision. Il ne dépend plus de `manifest.dir` pour
		   VIVRE (il vit à côté des notes), seulement pour retrouver l'ANCIEN
		   emplacement — d'où la disparition du try/catch de construction. */
		this._reviewStore = createReviewStore({
			fs: currentHost().fs,
			watcher: currentHost().watcher,
			paths: currentHost().paths,
			catalogue: () => buildReviewCatalogue(
				this._scanner.getQuizzes(),
				this.settings.quizzesModuleOverrides || {},
			),
			horizons: () => {
				const out: Record<string, number | null> = {};
				for (const [dossier, ov] of Object.entries(this.settings.quizzesModuleOverrides || {})) {
					const t = parseExamDate(ov.examDate);
					if (t !== null) out[dossier] = t;
				}
				return out;
			},
			now: () => Date.now(),
		});
		/* MIGRER D'ABORD, CHARGER ENSUITE : l'inverse lirait un journal neuf
		   encore vide et le tableau de bord annoncerait « rien à réviser » à
		   quelqu'un qui a un semestre derrière lui. La migration est
		   idempotente : la refaire à chaque démarrage ne coûte qu'une lecture,
		   et c'est ce qui permet à l'application de la déclencher aussi. */
		void (async () => {
			for (const root of currentHost().paths.roots()) {
				try {
					const res = await migrateReviewLog(currentHost().fs, root.legacyReviewLog, root.reviewLog);
					if (!res.skipped) {
						this.log.info(`journal migré : ${res.absorbed} ligne(s) absorbée(s), ${res.duplicates} déjà présente(s), ${res.ignored} illisible(s), ancien ${res.renamed ? "rangé" : "conservé"}`);
					}
				} catch (e) {
					// Le démarrage ne dépend PAS de la migration : au pire
					// l'historique reste à son ancienne place, et on réessaiera.
					this.log.warn("migration du journal impossible", e);
				}
			}
			await this._reviewStore?.load();
		})();
```

`createObsidianHost(this.app)` devient `createObsidianHost(this.app, this)`
(tâche 2, il lui faut le manifeste).

- [ ] **Étape 4 : suivre le déménagement**

```bash
grep -rn "dashboard/review-store" src/ apps/ scripts/
```

Corriger chaque import (`src/dashboard/home.ts`, `src/types/dashboard-ctx.ts`),
puis supprimer l'ancien fichier :

```bash
git rm src/dashboard/review-store.ts
```

Et retirer son entrée de `RESTANTS` dans `scripts/check-host.mjs` : le
contrôle **échouerait sinon** (assertion 2, l'entrée périmée), et le compteur
qu'il affiche passe de 42 à 41.

- [ ] **Étape 5 : réécrire `check-review-store.mjs` sur un faux `Host`**

Le faux `Plugin` (avec `app.vault.adapter`, `vault.on`, `registerEvent`,
`settings`) disparaît au profit d'un faux hôte, beaucoup plus petit — c'est le
bénéfice visible du passage au contrat. Conserver **tous** les cas existants
(clé opaque, écriture différée, absorption des conflits, garde `charge`, ordre
des lots après échec, destruction) en remplaçant `fakePlugin()` par :

```js
/** Un faux hôte à DEUX racines : c'est le multi-racines qui est éprouvé ici,
    et un hôte à une seule racine laisserait passer un routage qui écrit
    toujours dans le premier journal. `withManualDebounce` (déjà dans ce
    script) reste inchangé : il pilote le délai de 500 ms. */
function fauxHote(options = {}) {
	const ecritures = [];
	const fichiers = new Map(Object.entries(options.fichiers ?? {}));
	const abonnesFichier = new Set();
	const abonnesDossier = new Set();
	const racines = [
		{ id: "A", name: "A", reviewLog: "A/.neo-quiz/review-log.jsonl", legacyReviewLog: null },
		{ id: "B", name: "B", reviewLog: "B/.neo-quiz/review-log.jsonl", legacyReviewLog: null },
	];
	const teteDe = (p) => String(p ?? "").split("/")[0];
	const host = {
		fs: {
			exists: async (p) => fichiers.has(p),
			read: async (p) => {
				if (!fichiers.has(p)) throw new Error("ENOENT " + p);
				return fichiers.get(p);
			},
			append: options.append ?? (async (p, d) => {
				ecritures.push([p, d]);
				fichiers.set(p, (fichiers.get(p) ?? "") + d);
			}),
			list: options.list ?? (async () => []),
			remove: async (p) => { fichiers.delete(p); },
			mkdirs: async () => {},
			write: async (p, d) => { fichiers.set(p, d); },
			rename: async () => {},
			listMarkdown: () => [],
			findByName: () => [],
			getFile: () => null,
			readCached: async (p) => fichiers.get(p) ?? "",
		},
		watcher: {
			onChange: (cb) => { abonnesFichier.add(cb); return () => abonnesFichier.delete(cb); },
			onRenameDir: (cb) => { abonnesDossier.add(cb); return () => abonnesDossier.delete(cb); },
		},
		paths: {
			roots: () => racines,
			rootOf: (p) => racines.find(r => r.id === teteDe(p)) ?? null,
			localPath: (p) => String(p ?? "").split("/").slice(1).join("/"),
			contractPath: (id, l) => (id ? `${id}/${l}` : l),
			resultsDirFor: () => "",
		},
	};
	return {
		host,
		ecritures,
		fichiers,
		derniereEcriture: () => ecritures[ecritures.length - 1]?.[1] ?? "",
		emettreRenameFichier: (oldPath, path) => {
			for (const cb of [...abonnesFichier]) cb({ kind: "rename", oldPath, file: { path, name: "", basename: "", extension: "md", mtime: 0 } });
		},
		emettreRenameDossier: (from, to) => {
			for (const cb of [...abonnesDossier]) cb({ from, to });
		},
	};
}
```

et **ajouter** ces cas, tous nouveaux :

```js
	const { host, ecritures, derniereEcriture, emettreRenameDossier } = fauxHote();
	const MAINTENANT = 1_700_000_000_000;
	const store = createReviewStore({
		fs: host.fs, watcher: host.watcher, paths: host.paths,
		catalogue: () => [{ q: "B/Cours/reseau.md::q1", module: "B/Cours", source: "B/Cours/reseau.md" }],
		horizons: () => ({}),
		now: () => MAINTENANT,
	});
	await store.load();
	store.record([{ q: store.keyOf("B/Cours/reseau.md", "q1"), grade: "wrong" }]);
	await tick(); // laisse le lot différé partir
	/* DEUX JOURS PLUS TARD : une réponse fausse replace la question à un jour
	   (`intervalleEchec`), donc au moment même de la réponse elle n'est PAS
	   due — un plan calculé à `MAINTENANT` serait vide, et le cas ci-dessous
	   passerait au vert pour une raison qui n'a rien à voir avec les clés. */
	const plan = store.plan(MAINTENANT + 2 * 86400000);

	/* Le ROUTAGE. Une réponse va dans le journal du dossier auquel appartient
	   sa question — jamais dans le premier venu. Sans ce cas, un store
	   multi-racines qui écrirait tout dans le premier journal passerait pour
	   sain : les réponses seraient bien là, dans le mauvais fichier, et le
	   greffon ne les retrouverait jamais. */
	r.check("une réponse est écrite dans le journal de SA racine",
		ecritures.map(([p]) => p), ["B/.neo-quiz/review-log.jsonl"]);
	/* La clé écrite est LOCALE : c'est elle que le greffon lira sur le même
	   dossier. Une clé préfixée serait invisible depuis Obsidian. */
	r.check("et la clé écrite n'a pas le préfixe de la racine",
		JSON.parse(ecritures[0][1]).q, "Cours/reseau.md::q1");
	/* La lecture fait le chemin inverse : le plan travaille sur des clés
	   préfixées, sinon deux dossiers portant « Cours/ch1.md » se
	   confondraient — et l'historique de l'un compterait pour l'autre. */
	r.check("le plan voit la clé préfixée", plan.today, ["B/Cours/reseau.md::q1"]);
	/* Un déplacement d'une racine à une autre n'écrit RIEN : deux journaux
	   distincts, et une ligne dans l'un ne déplacerait rien dans l'autre.
	   Inventer un renommage inter-racines transporterait une clé vers un
	   journal qui ne la contient pas — un mensonge, silencieux. */
	store.renamed("B/Cours/reseau.md", "A/Cours/reseau.md");
	await tick();
	r.check("un déplacement entre racines n'écrit pas de renommage", ecritures.length, 1);

	/* Un DOSSIER renommé déplace toutes ses notes en UNE ligne, par préfixe.
	   Sans le canal `onRenameDir`, tout un module perdrait son historique d'un
	   coup — et le contrat n'a ce second canal que pour ça. */
	emettreRenameDossier("B/Cours", "B/Reseaux");
	await tick();
	r.check("un dossier renommé produit une ligne de renommage",
		JSON.parse(derniereEcriture().trim()).t, "rename");
	/* La ligne écrite est LOCALE des deux côtés : « Cours » → « Reseaux »,
	   jamais « B/Cours » → « B/Reseaux ». */
	r.check("et ses deux chemins sont locaux",
		[JSON.parse(derniereEcriture().trim()).from, JSON.parse(derniereEcriture().trim()).to],
		["Cours", "Reseaux"]);
```

**Éprouver chaque cas discriminant** : faire écrire `record` dans la première
racine quelle qu'elle soit → le cas de routage rougit ; oublier
`paths.localPath` à l'écriture → le cas de la clé locale rougit ; retirer
l'abonnement `onRenameDir` → le cas du dossier renommé rougit.

- [ ] **Étape 6 : vérifier**

```bash
npm run check; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"        # doit annoncer 41 fichiers
npm run check:review-store; echo "EXIT=$?"
npm run check:review-log; echo "EXIT=$?"
npm run check:scheduler; echo "EXIT=$?"   # le noyau n'a pas bougé
npm run check:engine-review; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run build
```

**Puis Obsidian, et c'est l'épreuve qui compte** :

1. Avant de recharger, noter la taille de
   `<vault>/.obsidian/plugins/quiz-blocks/review-log.jsonl`.
2. Recharger le greffon. Ouvrir la console : la ligne « journal migré : N
   ligne(s) absorbée(s) » doit nommer un N égal au nombre de lignes de
   l'ancien fichier.
3. `<vault>/.neo-quiz/review-log.jsonl` existe et porte ces lignes.
4. `review-log.jsonl.migrated` a remplacé l'ancien — **l'ancien fichier n'a
   pas disparu**.
5. Le tableau de bord affiche « À réviser aujourd'hui » avec le même contenu
   qu'avant le rechargement. C'est la preuve que la clé n'a pas changé.
6. Jouer un quiz : une nouvelle ligne s'ajoute au NOUVEAU fichier.
7. Renommer une note à quiz, puis un DOSSIER de quiz : une ligne `rename`
   apparaît dans le journal pour chacun, et la carte « À réviser » continue de
   montrer les mêmes questions.

- [ ] **Étape 7 : commit**

```bash
git add -A src/review src/dashboard src/types/dashboard-ctx.ts apps/obsidian scripts package.json
git commit -m "feat(review): le journal demenage a cote des notes, et son adaptateur passe au contrat"
```

---
## Tâche 5 — Le réglage passe au pluriel

**Fichiers :**
- Modifier : `apps/windows/src/host/folder.ts`
- Modifier : `apps/windows/src/main.ts`
- Créer : `scripts/check-folders.mjs`
- Modifier : `package.json` (script `check:folders`)

**Interfaces :**
- Consomme : rien de nouveau.
- Produit : `DossierQuiz { id: string; path: string; name: string }`,
  `MAX_DOSSIERS = 10`, `segmentValide(nom)`, `idUnique(nom, pris)`,
  `lireDossiers(brut): DossierQuiz[]`, `savedFolders()`, `saveFolders(liste)`,
  `addFolder(chemin)`, `removeFolder(id)`. Les tâches 6, 7 et 8 les consomment.

- [ ] **Étape 1 : écrire la conversion et son unicité (fonctions PURES)**

Dans `apps/windows/src/host/folder.ts`, remplacer la constante `CLE_DOSSIER`
et ses trois fonctions par :

```ts
/** Un dossier de quiz retenu par l'application. */
export interface DossierQuiz {
	/**
	 * Identifiant, et PREMIER SEGMENT des chemins du contrat qui en relèvent
	 * (« Efrei/Cours/reseau.md »). PERSISTÉ, et jamais recalculé : un
	 * identifiant qui changerait le jour où un dossier homonyme arrive
	 * changerait avec lui tous les chemins affichés.
	 *
	 * C'est le NOM du dossier, pas un jeton opaque (« f1 ») : ces chemins
	 * sont montrés à l'écran, et « Efrei/Cours/reseau.md » se lit là où
	 * « f1/Cours/reseau.md » demanderait une table de traduction — donc un
	 * second endroit où le préfixe serait connu.
	 */
	id: string;
	/** Chemin ABSOLU sur le disque. La seule valeur qui ne soit pas du
	    contrat : elle ne sort jamais de l'hôte. */
	path: string;
	/** Nom affiché. Modifiable un jour sans conséquence — l'identité, c'est
	    `id`. */
	name: string;
}

/** La limite de la spec §6. Dix dossiers, pas onze. */
export const MAX_DOSSIERS = 10;

const CLE_DOSSIERS = "folders";
/** L'ancienne clé, au SINGULIER (tranche 1). Lue une fois, puis retirée. */
const CLE_DOSSIER_LEGACY = "folder";

/** Le dernier segment d'un chemin, quel que soit le séparateur. */
export function nomDeDossier(chemin: string): string {
	return String(chemin ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(chemin ?? "");
}

/**
 * Un nom réduit à ce qui peut tenir dans UN segment de chemin.
 *
 * Les caractères interdits par Windows (`\ / : * ? " < > |`) deviennent des
 * tirets — pas parce que l'identifiant touche le disque (il ne le touche
 * jamais : c'est un préfixe de chemin du CONTRAT), mais parce qu'un `/` dans
 * l'identifiant en ferait DEUX segments, et le premier ne désignerait plus
 * aucune racine.
 */
export function segmentValide(nom: string): string {
	const nu = String(nom ?? "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
	return nu || "dossier";
}

/** Un identifiant libre. Le suffixe est numérique et croissant : deux
    dossiers nommés « Cours » donnent « Cours » et « Cours-2 ». */
export function idUnique(nom: string, pris: ReadonlySet<string>): string {
	const base = segmentValide(nom);
	if (!pris.has(base)) return base;
	let n = 2;
	while (pris.has(`${base}-${n}`)) n++;
	return `${base}-${n}`;
}

/**
 * Les dossiers retenus, à partir de ce que le magasin contient — y compris
 * l'ANCIENNE clé au singulier.
 *
 * PURE, et c'est délibéré : la conversion d'un réglage est exactement le
 * genre de code qu'on n'ose plus toucher parce qu'on ne peut pas l'exécuter.
 * Ici, `npm run check:folders` l'exécute.
 */
export function lireDossiers(brut: { folders?: unknown; folder?: unknown }): DossierQuiz[] {
	const pris = new Set<string>();
	const out: DossierQuiz[] = [];

	if (Array.isArray(brut.folders)) {
		for (const e of brut.folders) {
			const o = e as Partial<DossierQuiz> | null;
			const path = typeof o?.path === "string" ? o.path.trim() : "";
			if (!path) continue;
			const name = typeof o?.name === "string" && o.name.trim() ? o.name.trim() : nomDeDossier(path);
			/* L'identifiant persisté est reconduit tel quel — sauf collision,
			   qu'un fichier de réglages édité à la main peut produire. Le
			   recalculer systématiquement changerait les chemins affichés à
			   chaque renommage de dossier. */
			const voulu = typeof o?.id === "string" && o.id.trim() ? segmentValide(o.id) : segmentValide(name);
			const id = idUnique(voulu, pris);
			pris.add(id);
			out.push({ id, path, name });
			if (out.length >= MAX_DOSSIERS) break;
		}
		return out;
	}

	/* MIGRATION de la clé au singulier (tranche 1). Un seul sens, exécuté une
	   fois : `savedFolders` réécrit aussitôt sous la nouvelle clé et retire
	   l'ancienne. Sans elle, la mise à jour de l'application ferait repartir
	   l'utilisateur sur l'écran « Choisissez un dossier », son dossier
	   toujours là mais oublié. */
	if (typeof brut.folder === "string" && brut.folder.trim()) {
		const path = brut.folder.trim();
		const name = nomDeDossier(path);
		return [{ id: segmentValide(name), path, name }];
	}
	return [];
}
```

- [ ] **Étape 2 : la persistance**

```ts
export async function savedFolders(): Promise<DossierQuiz[]> {
	try {
		const store = await reglages();
		const liste = lireDossiers({
			folders: await store.get(CLE_DOSSIERS),
			folder: await store.get(CLE_DOSSIER_LEGACY),
		});
		/* La conversion se paie UNE fois : dès qu'on a lu l'ancienne clé, on
		   écrit la nouvelle et on retire l'ancienne. Laisser les deux en place
		   ferait diverger le jour où l'une des deux serait modifiée. */
		if ((await store.get(CLE_DOSSIER_LEGACY)) !== undefined) {
			await store.set(CLE_DOSSIERS, liste);
			await store.delete(CLE_DOSSIER_LEGACY);
			await store.save();
		}
		return liste;
	} catch (e) {
		// Réglages illisibles : on repart de l'écran de choix plutôt que
		// d'empêcher le démarrage.
		console.warn(LOG_PREFIX, "réglages illisibles:", e);
		return [];
	}
}

export async function saveFolders(liste: DossierQuiz[]): Promise<void> {
	const store = await reglages();
	await store.set(CLE_DOSSIERS, liste);
	// `save()` explicite : l'enregistrement automatique est débouncé, et
	// l'application recharge la fenêtre juste après ce choix.
	await store.save();
}

/** Ajoute un dossier et rend la liste complète. Un chemin déjà présent n'est
    pas ajouté deux fois : il rendrait deux racines sur les mêmes fichiers,
    donc deux fois chaque quiz au catalogue. */
export async function addFolder(chemin: string): Promise<DossierQuiz[]> {
	const liste = await savedFolders();
	const normalise = chemin.replace(/[\\/]+$/, "");
	if (liste.some(d => d.path.replace(/[\\/]+$/, "").toLowerCase() === normalise.toLowerCase())) return liste;
	if (liste.length >= MAX_DOSSIERS) return liste;
	const nom = nomDeDossier(normalise);
	const suivante = [...liste, { id: idUnique(nom, new Set(liste.map(d => d.id))), path: normalise, name: nom }];
	await saveFolders(suivante);
	return suivante;
}

/** Retire un dossier. Le JOURNAL du dossier n'est pas touché : il vit dans le
    dossier, avec les notes qu'il décrit, et le rajouter plus tard doit rendre
    l'historique — c'est précisément ce que son nouvel emplacement permet. */
export async function removeFolder(id: string): Promise<DossierQuiz[]> {
	const suivante = (await savedFolders()).filter(d => d.id !== id);
	await saveFolders(suivante);
	return suivante;
}
```

`savedFolder()` (singulier) et `saveFolder()` disparaissent. `pickFolder`,
`allowFolder`, `obsidianVaults` et `estVaultObsidian` restent inchangés.

- [ ] **Étape 3 : le jeu de cas**

Créer `scripts/check-folders.mjs` — il ne charge que les fonctions pures, donc
aucun Tauri n'est appelé :

```js
/**
 * LES DOSSIERS DE QUIZ — conversion du réglage et unicité des identifiants.
 *
 * Deux défauts que ce script empêche, et qu'une relecture ne voit pas :
 * un utilisateur qui met à jour l'application et retombe sur l'écran
 * « Choisissez un dossier » alors que son dossier est toujours là ; et deux
 * dossiers homonymes dont les chemins du contrat se confondent, ce qui
 * ferait compter l'historique de l'un pour l'autre.
 *
 *     npm run check:folders
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/host/folder.ts", async ({ lireDossiers, idUnique, segmentValide, MAX_DOSSIERS }) => {
	const r = makeReporter("Dossiers — réglage et identifiants");

	r.check("aucun réglage : aucune racine", lireDossiers({}), []);

	/* La CONVERSION de la clé au singulier. Sans elle, la mise à jour perd le
	   dossier de l'utilisateur — il est là, l'application ne le sait plus. */
	r.check("la clé au singulier devient une liste d'un dossier",
		lireDossiers({ folder: "C:/obsidian-vaults/Efrei" }),
		[{ id: "Efrei", path: "C:/obsidian-vaults/Efrei", name: "Efrei" }]);
	/* `folders` GAGNE sur `folder` : une fois converti, l'ancien réglage ne
	   doit plus jamais reprendre la main. */
	r.check("folders l'emporte sur folder",
		lireDossiers({ folders: [{ id: "A", path: "D:/A", name: "A" }], folder: "C:/vieux" }).map(d => d.path),
		["D:/A"]);

	/* Deux dossiers HOMONYMES. Le second doit recevoir un identifiant
	   distinct : deux préfixes identiques feraient de « Cours/ch1.md » deux
	   notes indiscernables, et le journal de l'une compterait pour l'autre. */
	r.check("deux dossiers homonymes reçoivent des identifiants distincts",
		lireDossiers({ folders: [
			{ path: "C:/a/Cours", name: "Cours" },
			{ path: "D:/b/Cours", name: "Cours" },
		] }).map(d => d.id), ["Cours", "Cours-2"]);

	/* Un identifiant PERSISTÉ est reconduit tel quel : le recalculer ferait
	   changer tous les chemins affichés au moindre renommage. */
	r.check("un identifiant persisté est reconduit",
		lireDossiers({ folders: [{ id: "Ancien", path: "C:/x", name: "Nouveau nom" }] })[0].id, "Ancien");

	/* Un `/` dans un identifiant en ferait DEUX segments, et le premier ne
	   désignerait plus aucune racine. */
	r.check("un séparateur est neutralisé", segmentValide("a/b"), "a-b");
	r.check("un nom vide donne un identifiant utilisable", segmentValide("   "), "dossier");
	r.check("idUnique suffixe à partir de 2", idUnique("Cours", new Set(["Cours", "Cours-2"])), "Cours-3");

	/* La limite de la spec §6 est appliquée à la LECTURE aussi : un fichier
	   de réglages édité à la main ne doit pas ouvrir cinquante dossiers. */
	const onze = Array.from({ length: 11 }, (_, i) => ({ path: `C:/d${i}`, name: `d${i}` }));
	r.check("au plus dix dossiers", lireDossiers({ folders: onze }).length, MAX_DOSSIERS);

	/* Une entrée sans chemin est ignorée, pas conservée avec un chemin vide —
	   qui ouvrirait la racine du disque. */
	r.check("une entrée sans chemin est ignorée",
		lireDossiers({ folders: [{ name: "vide" }, { path: "C:/ok", name: "ok" }] }).map(d => d.path), ["C:/ok"]);

	r.done();
});
```

Ajouter à `package.json` : `"check:folders": "node scripts/check-folders.mjs",`

**Éprouver DISCRIMINANT** : retirer la branche `brut.folder` → le cas de
conversion rougit ; faire rendre `base` sans suffixe dans `idUnique` → le cas
des homonymes rougit ; retirer le `break` de la limite → le cas des dix rougit.

- [ ] **Étape 4 : adapter le démarrage (toujours une seule racine ouverte)**

Dans `apps/windows/src/main.ts`, `demarrer()` lit désormais une liste, et
n'ouvre pour l'instant que la première — l'hôte composite est la tâche 6, et
cette tâche-ci doit rester livrable :

```ts
		const dossiers = await savedFolders();
		if (!dossiers.length) return void mountSansDossier(root);
		/* Une seule racine ouverte pour l'instant : l'hôte composite est la
		   tâche suivante. La liste, elle, est déjà au pluriel et persistée —
		   la conversion du réglage ne se refera pas. */
		const dossier = dossiers[0];
		await allowFolder(dossier.path);
		const estVault = await estVaultObsidian(dossier.path);
		const index = await createWindowsIndex(dossier.path);
		installHost(createWindowsHost(dossier.path, index, estVault));
```

et `choisirDossier(chemin)` appelle `addFolder(chemin)` au lieu de
`saveFolder(chemin)`.

- [ ] **Étape 5 : vérifier**

```bash
npm run check:folders; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"
```

Puis `npm run app:dev` : l'application démarre **sur le dossier déjà choisi**,
sans repasser par l'écran de sélection. Fermer, rouvrir : idem. Vérifier dans
le magasin (`%APPDATA%/com.ahmed.neoquiz/settings.json`) que `folders` existe
et que `folder` a disparu.

- [ ] **Étape 6 : commit**

```bash
git add apps/windows/src/host/folder.ts apps/windows/src/main.ts scripts/check-folders.mjs package.json
git commit -m "feat(app): le reglage du dossier passe au pluriel, sans perdre l ancien"
```

---

## Tâche 6 — L'hôte Windows devient composite

**Fichiers :**
- Créer : `apps/windows/src/host/roots.ts`
- Modifier : `apps/windows/src/host/fs.ts`, `links.ts`, `index.ts`
- Modifier : `apps/windows/src/main.ts`
- Modifier : `scripts/check-windows-host.mjs`

**Interfaces :**
- Consomme : `DossierQuiz` (tâche 5) ; `HostRoot`, `HostPaths` (tâche 2) ;
  `REVIEW_DIR`, `REVIEW_LOG_NAME` (tâche 2).
- Produit : `RacineOuverte { id, name, path, vault }`,
  `creerCarteRacines(racines): CarteRacines` avec
  `{ racines(), pour(cheminContrat), local(cheminContrat), contrat(rootId, local), absolu(cheminContrat), depuisAbsolu(absolu) }` ;
  `createWindowsIndex(racines: RacineOuverte[]): Promise<WindowsIndex>` ;
  `createWindowsHost(carte, index): Host`.

- [ ] **Étape 1 : la carte des racines, PURE**

Créer `apps/windows/src/host/roots.ts` :

```ts
import type { HostRoot } from "../../../../src/host/types";
import { REVIEW_DIR, REVIEW_LOG_NAME } from "../../../../src/review/paths";
import { PLUGIN_ID } from "../../../../src/branding";

/* ══════════════════════════════════════════════════════════
   LES RACINES DE L'APPLICATION

   Le contrat ne connaît qu'un espace de chemins. L'application peut ouvrir
   jusqu'à dix dossiers : ses chemins du contrat portent donc un PREMIER
   SEGMENT qui nomme la racine — « Efrei/Cours/reseau.md ».

   Ce que ce préfixe ne doit JAMAIS toucher, c'est la clé du journal de
   révision : elle vaut « Cours/reseau.md::adressage-ip » des deux côtés,
   sans quoi le greffon et l'application cesseraient de partager
   l'historique du même dossier — et rien ne le signalerait avant qu'un
   semestre de révisions ait disparu de l'écran. `local()` retire le
   préfixe, `contrat()` le remet, et ces deux fonctions sont le SEUL endroit
   du dépôt où la conversion existe.

   PURE : aucun appel Tauri, aucun accès disque. C'est ce qui la rend
   éprouvable (`npm run check:windows-host`).
══════════════════════════════════════════════════════════ */

/** Un dossier ouvert. `vault` décide seulement où vont les RÉSULTATS. */
export interface RacineOuverte {
	id: string;
	name: string;
	/** Chemin absolu sur le disque. */
	path: string;
	vault: boolean;
}

export interface CarteRacines {
	toutes(): RacineOuverte[];
	hostRoots(): HostRoot[];
	/** La racine d'un chemin du contrat, ou null. */
	pour(cheminContrat: string): RacineOuverte | null;
	/** Chemin du contrat → chemin relatif à sa racine (la clé du journal). */
	local(cheminContrat: string): string;
	/** Identifiant + chemin local → chemin du contrat. */
	contrat(rootId: string, local: string): string;
	/** Chemin du contrat → chemin ABSOLU disque, ou null hors racines. */
	absolu(cheminContrat: string): string | null;
	/** Chemin absolu disque → chemin du contrat, ou null hors racines. */
	depuisAbsolu(absolu: string): string | null;
}

const nettoyer = (chemin: string): string =>
	String(chemin ?? "").replace(/\\/g, "/").replace(/\/+$/, "");

export function creerCarteRacines(racines: RacineOuverte[]): CarteRacines {
	const parId = new Map(racines.map(r => [r.id, r]));

	const decouper = (cheminContrat: string): { racine: RacineOuverte; reste: string } | null => {
		const p = nettoyer(cheminContrat).replace(/^\/+/, "");
		const coupe = p.indexOf("/");
		const tete = coupe < 0 ? p : p.slice(0, coupe);
		const racine = parId.get(tete);
		if (!racine) return null;
		return { racine, reste: coupe < 0 ? "" : p.slice(coupe + 1) };
	};

	return {
		toutes() { return [...racines]; },
		hostRoots() {
			return racines.map(r => ({
				id: r.id,
				name: r.name,
				/* Le journal, TOUJOURS au même endroit sous la racine — jamais
				   selon qu'elle est un vault ou non. La raison est écrite dans
				   `src/review/paths.ts` : une détection peut changer d'avis, un
				   historique perdu ne revient pas. */
				reviewLog: `${r.id}/${REVIEW_DIR}/${REVIEW_LOG_NAME}`,
				/* L'ancien journal du GREFFON, à son emplacement conventionnel.
				   L'application le lit pour la même raison que le greffon : si
				   elle est installée d'abord, elle démarrerait sinon sur un
				   journal vide avec un semestre d'historique juste à côté. */
				legacyReviewLog: `${r.id}/.obsidian/plugins/${PLUGIN_ID}/${REVIEW_LOG_NAME}`,
			}));
		},
		pour(cheminContrat) { return decouper(cheminContrat)?.racine ?? null; },
		local(cheminContrat) {
			const d = decouper(cheminContrat);
			/* Un chemin hors racines est rendu TEL QUEL plutôt que vidé : une
			   chaîne vide deviendrait une clé de journal « ::id », qui
			   ressemblerait à une vraie clé et polluerait l'historique. */
			return d ? d.reste : nettoyer(cheminContrat);
		},
		contrat(rootId, local) {
			const l = nettoyer(local).replace(/^\/+/, "");
			if (!rootId) return l;
			return l ? `${rootId}/${l}` : rootId;
		},
		absolu(cheminContrat) {
			const d = decouper(cheminContrat);
			if (!d) return null;
			return d.reste ? `${nettoyer(d.racine.path)}/${d.reste}` : nettoyer(d.racine.path);
		},
		depuisAbsolu(absolu) {
			const abs = nettoyer(absolu);
			const bas = abs.toLowerCase();
			/* La plus LONGUE racine gagne : un dossier ouvert à l'intérieur d'un
			   autre (« C:/Vault » et « C:/Vault/Cours ») donnerait sinon deux
			   chemins du contrat pour le même fichier, selon l'ordre de la
			   liste — et deux entrées au catalogue pour un seul quiz.
			   La comparaison ignore la casse : Windows l'ignore aussi, et un
			   surveillant qui rendrait « C:/Users… » là où la racine dit
			   « c:/users… » ferait tomber tous les évènements dans le vide. */
			let meilleure: RacineOuverte | null = null;
			for (const r of racines) {
				const base = nettoyer(r.path).toLowerCase();
				if (bas !== base && !bas.startsWith(base + "/")) continue;
				if (!meilleure || nettoyer(r.path).length > nettoyer(meilleure.path).length) meilleure = r;
			}
			if (!meilleure) return null;
			const reste = abs.slice(nettoyer(meilleure.path).length).replace(/^\/+/, "");
			return reste ? `${meilleure.id}/${reste}` : meilleure.id;
		},
	};
}
```

- [ ] **Étape 2 : l'index et le surveillant, par racine**

Dans `apps/windows/src/host/fs.ts` :

- `cheminAbsolu(racine, relatif)` et `cheminRelatif(racine, absolu)`
  **disparaissent** au profit de `carte.absolu` / `carte.depuisAbsolu` (la
  conversion vit désormais dans `roots.ts`, en un seul endroit) ;
- `createWindowsIndex(racine: string)` devient
  `createWindowsIndex(carte: CarteRacines)` et parcourt chaque racine, en
  préfixant les chemins collectés :

```ts
export async function createWindowsIndex(carte: CarteRacines): Promise<WindowsIndex> {
	const fichiers: HostFile[] = [];
	for (const racine of carte.toutes()) {
		const chemins: string[] = [];
		await parcourir(racine.path, "", chemins);
		/* Le préfixe est posé ICI, une fois : tout ce qui sort de l'index est
		   déjà un chemin du contrat, et plus rien en aval n'a à savoir qu'il y
		   a plusieurs racines. */
		for (const c of chemins) fichiers.push(toHostFile(carte.contrat(racine.id, c)));
	}
	// … la passe `stat` sur les seuls `.md`, inchangée, en passant par
	//   `carte.absolu(f.path)` au lieu de `cheminAbsolu(racine, f.path)`.
	return buildIndex(fichiers);
}
```

- `createWindowsFs(carte, index)` : `abs(chemin)` devient

```ts
	const abs = (chemin: string): string => {
		const a = carte.absolu(chemin);
		/* Un chemin hors racines ne doit pas devenir un chemin absolu
		   plausible : il sortirait de la portée native et échouerait avec un
		   message incompréhensible. Mieux vaut nommer la cause. */
		if (!a) throw new Error(`chemin hors des dossiers ouverts : ${chemin}`);
		return a;
	};
```

- `createWindowsWatcher(carte, index)` ouvre **un `watch` par racine**, et
  chaque évènement passe par `carte.depuisAbsolu` :

```ts
	for (const racine of carte.toutes()) {
		void watch(racine.path, ev => void traiter(ev), { recursive: true, delayMs: 300 })
			.catch(e => console.warn(LOG_PREFIX, "surveillance impossible:", racine.name, e));
	}
```

`reconcilier(absolu)` remplace `cheminRelatif(racine, absolu)` par
`carte.depuisAbsolu(absolu)`, et le test des dossiers ignorés porte désormais
sur les segments **après** le premier (le préfixe est un identifiant, pas un
dossier du disque) :

```ts
		const rel = carte.depuisAbsolu(absolu);
		if (rel === null) return;
		const segments = rel.split("/");
		// Le premier segment est l'identifiant de la racine, jamais un dossier.
		if (segments.length < 2) return;
		if (segments.slice(1, -1).some(dossierIgnore)) return;
```

- [ ] **Étape 3 : les liens, bornés à leur racine**

Dans `links.ts`, `createWindowsLinks(carte, index)` :

```ts
	/* La recherche est BORNÉE à la racine de la note citante : une image du
	   dossier A ne doit jamais être servie à une note du dossier B, exactement
	   comme un lien ne sort pas d'un vault. Sans cette borne, un homonyme d'un
	   autre dossier gagnerait au hasard du départage. */
	const dansLaRacineDe = (fromPath: string): HostFile[] => {
		const racine = carte.pour(fromPath);
		const tous = index.all();
		if (!racine) return tous;
		const prefixe = racine.id + "/";
		return tous.filter(f => f.path.startsWith(prefixe));
	};

	return {
		resolve(linkPath, fromPath) {
			return resolveDansIndex(dansLaRacineDe(fromPath), linkPath, fromPath);
		},
		resourceUrl(target, fromPath) {
			try {
				const brut = typeof target === "string" ? target : target?.path;
				const chemin = normaliserLien(brut ?? "");
				if (!chemin) return null;
				/* Un chemin déjà complet (donc préfixé) est cherché tel quel ;
				   un nom nu passe par la résolution, bornée à la racine de la
				   note citante — ou, à défaut de note citante, à celle du
				   chemin lui-même. */
				const f = index.get(chemin) ?? resolveDansIndex(dansLaRacineDe(fromPath || chemin), chemin, fromPath || "");
				if (!f) return null;
				const a = carte.absolu(f.path);
				return a ? convertFileSrc(a) || null : null;
			} catch (e) {
				console.warn(LOG_PREFIX, "resourceUrl erreur:", e);
				return null;
			}
		},
	};
```

- [ ] **Étape 4 : l'assemblage**

`createWindowsHost(carte, index)` (`host/index.ts`) :

```ts
	const paths: Host["paths"] = {
		/* Le dossier des résultats dépend de la RACINE de la note : une
		   constante enverrait les résultats d'un quiz du dossier B dans le
		   dossier A. Dans un vault, on écrit là où le greffon écrit déjà ;
		   hors d'un vault, il n'y a pas de `.obsidian/` et en créer un serait
		   poser un dossier de configuration Obsidian fantôme. */
		resultsDirFor(sourcePath) {
			const r = carte.pour(sourcePath);
			const sous = r?.vault ? ".obsidian/quiz-blocks-results" : `${REVIEW_DIR}/results`;
			return r ? `${r.id}/${sous}` : sous;
		},
		roots() { return carte.hostRoots(); },
		rootOf(path) {
			const r = carte.pour(path);
			if (!r) return null;
			return carte.hostRoots().find(h => h.id === r.id) ?? null;
		},
		localPath(path) { return carte.local(path); },
		contractPath(rootId, localPath) { return carte.contrat(rootId, localPath); },
	};
```

`shell.openExternal` passe par `carte.absolu(file.path)`.

- [ ] **Étape 5 : le démarrage ouvre TOUS les dossiers**

Dans `main.ts` :

```ts
		const dossiers = await savedFolders();
		if (!dossiers.length) return void mountSansDossier(root);
		/* Les portées natives ne survivent pas au redémarrage : les rouvrir
		   AVANT toute lecture, pour CHAQUE dossier. Un dossier disparu (clé USB
		   retirée, dossier supprimé) ne doit pas empêcher les autres de
		   s'ouvrir — d'où le `catch` par dossier plutôt qu'un `Promise.all`
		   qui rejetterait en bloc. */
		const ouvertes: RacineOuverte[] = [];
		for (const d of dossiers) {
			try {
				await allowFolder(d.path);
				ouvertes.push({ ...d, vault: await estVaultObsidian(d.path) });
			} catch (e) {
				console.warn(LOG_PREFIX, "dossier inaccessible, ignoré:", d.path, e);
			}
		}
		if (!ouvertes.length) return void mountSansDossier(root);
		const carte = creerCarteRacines(ouvertes);
		const index = await createWindowsIndex(carte);
		installHost(createWindowsHost(carte, index));
```

- [ ] **Étape 6 : les cas**

Dans `scripts/check-windows-host.mjs`, ajouter un groupe sur `roots.ts` :

```js
await withSrcModule("apps/windows/src/host/roots.ts", async ({ creerCarteRacines }) => {
	const r = makeReporter("Hôte Windows — racines");
	const carte = creerCarteRacines([
		{ id: "Efrei", name: "Efrei", path: "C:/obsidian-vaults/Efrei", vault: true },
		{ id: "Perso", name: "Perso", path: "D:/Notes", vault: false },
	]);

	/* LA CLÉ DU JOURNAL. C'est le cas le plus important du fichier : elle doit
	   valoir exactement ce que le greffon écrit pour la même note. */
	r.check("local() retire le préfixe de racine",
		carte.local("Efrei/Cours/reseau.md"), "Cours/reseau.md");
	r.check("contrat() le remet", carte.contrat("Efrei", "Cours/reseau.md"), "Efrei/Cours/reseau.md");
	r.check("les deux se composent en identité",
		carte.local(carte.contrat("Perso", "a/b.md")), "a/b.md");
	/* Un identifiant VIDE (l'hôte Obsidian) laisse les chemins intacts. */
	r.check("un identifiant vide ne préfixe rien", carte.contrat("", "a/b.md"), "a/b.md");

	r.check("pour() trouve la racine", carte.pour("Perso/x.md")?.name, "Perso");
	r.check("pour() d'un chemin hors racines rend null", carte.pour("Inconnu/x.md"), null);
	/* Rendu TEL QUEL, pas vidé : une chaîne vide donnerait la clé « ::id »,
	   qui ressemble à une vraie clé et polluerait l'historique. */
	r.check("local() d'un chemin hors racines le rend tel quel",
		carte.local("Inconnu/x.md"), "Inconnu/x.md");

	r.check("absolu() compose le chemin disque",
		carte.absolu("Efrei/Cours/reseau.md"), "C:/obsidian-vaults/Efrei/Cours/reseau.md");
	r.check("depuisAbsolu() fait l'inverse",
		carte.depuisAbsolu("D:/Notes/a/b.md"), "Perso/a/b.md");
	/* Windows ignore la casse : un surveillant qui rendrait « D:/NOTES/… »
	   ferait sinon tomber tous ses évènements dans le vide. */
	r.check("depuisAbsolu() ignore la casse", carte.depuisAbsolu("d:/notes/a/b.md"), "Perso/a/b.md");
	r.check("depuisAbsolu() hors racines rend null", carte.depuisAbsolu("E:/ailleurs/x.md"), null);

	/* Un dossier ouvert DANS un autre : la plus longue racine gagne, sinon le
	   même fichier aurait deux chemins du contrat selon l'ordre de la liste —
	   donc deux entrées au catalogue pour un seul quiz. */
	const imbrique = creerCarteRacines([
		{ id: "Vault", name: "Vault", path: "C:/V", vault: true },
		{ id: "Cours", name: "Cours", path: "C:/V/Cours", vault: false },
	]);
	r.check("la racine la plus longue gagne",
		imbrique.depuisAbsolu("C:/V/Cours/ch1.md"), "Cours/ch1.md");

	/* Le journal est sous la racine, au même endroit qu'elle soit un vault ou
	   non — contrairement aux résultats. */
	const hr = carte.hostRoots();
	r.check("le journal de chaque racine", hr.map(h => h.reviewLog),
		["Efrei/.neo-quiz/review-log.jsonl", "Perso/.neo-quiz/review-log.jsonl"]);
	r.check("l'ancien journal est celui du greffon", hr[0].legacyReviewLog,
		"Efrei/.obsidian/plugins/quiz-blocks/review-log.jsonl");

	r.done();
});
```

Et, dans le groupe « liens », un cas de bornage :

```js
	/* Un homonyme d'une AUTRE racine ne doit jamais gagner : sous Obsidian un
	   lien ne sort pas du vault, et ici il ne sort pas de son dossier. */
	r.check("la résolution par nom ne franchit pas les racines",
		links.resolve("schema.png", "Perso/notes.md")?.path, "Perso/img/schema.png");
```

**Éprouver DISCRIMINANT** : retirer le filtre `dansLaRacineDe` → le cas de
bornage rougit ; faire rendre `""` par `local()` hors racines → le cas
correspondant rougit ; prendre la PREMIÈRE racine correspondante dans
`depuisAbsolu` → le cas imbriqué rougit.

- [ ] **Étape 7 : vérifier**

```bash
npm run check:windows-host; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:host; echo "EXIT=$?"
npm run check:scanner; echo "EXIT=$?"
```

Puis `npm run app:dev` avec **un seul** dossier (la page réglages n'existe pas
encore) : la liste doit être identique à celle d'avant, aux chemins près — les
cartes montrent maintenant le dossier parent dans l'espace du contrat. Ouvrir
un quiz à images : elles s'affichent toujours. C'est le point qui casse en
premier si `absolu()` se trompe.

- [ ] **Étape 8 : commit**

```bash
git add apps/windows/src scripts/check-windows-host.mjs
git commit -m "feat(app): l hote Windows ouvre plusieurs dossiers, la cle du journal reste locale"
```

---

## Tâche 7 — La page « Réglages » : ajouter et retirer des dossiers

**Fichiers :**
- Créer : `apps/windows/src/ui/settings.ts`
- Créer : `src/i18n/en/review.ts`, `src/i18n/fr/review.ts`
- Modifier : `src/i18n/en.ts`, `src/i18n/fr.ts` (agrégation)
- Modifier : `apps/windows/src/ui/list.ts` (le bouton), `apps/windows/src/main.ts`
- Modifier : `apps/windows/src/assets/shell.css`

**Interfaces :**
- Consomme : `DossierQuiz`, `MAX_DOSSIERS`, `savedFolders`, `addFolder`,
  `removeFolder`, `pickFolder`, `obsidianVaults` (tâche 5).
- Produit : `renderSettings(root, deps): () => void` avec
  `deps: { onBack(): void; onFoldersChanged(): void }`. La tâche 10 lui ajoute
  les dates d'examen.

- [ ] **Étape 1 : le domaine de traduction**

Créer `src/i18n/en/review.ts`. **Vérifier d'abord qu'aucune clé n'existe
ailleurs** :

```bash
grep -rn "settings.folders\|review.due\|folders.add" src/i18n/en/
```

```ts
/* Domaine « review » : la révision vue depuis l'APPLICATION — la carte
   « À réviser », les dossiers, les dates d'examen. Le tableau de bord du
   greffon a déjà les siennes (`dashboard.review.*`, `dashboard.module.examDate`)
   et l'application les EMPRUNTE quand le libellé est le même : deux
   traductions du même texte divergeraient à la première retouche. */
export const EN_REVIEW = {
	/* ── La page Réglages ── */
	"review.settings.title": "Settings",
	"review.settings.folders": "Quiz folders",
	"review.settings.foldersHint": "Neo Quiz reads the quiz-blocks in these folders. Nothing is copied, nothing is moved.",
	"review.settings.addFolder": "Add a folder",
	"review.settings.removeFolder": "Remove from the list",
	/* Le mot compte : retirer un dossier de la liste ne touche NI aux notes,
	   NI à l'historique de révision, qui vit dans le dossier. */
	"review.settings.removeHint": "The folder and its review history stay on disk.",
	"review.settings.full": "Neo Quiz reads up to {count} folders.",
	"review.settings.quizCount": "{count} quizzes",

	/* ── Les dates d'examen (tâche 10) ── */
	"review.settings.exams": "Exam dates",
	"review.settings.examsHint": "A date tightens how often that subject comes back. Left empty, it is scheduled for long-term retention.",
	"review.settings.noModules": "No subject yet — open a folder that has quizzes in subfolders.",

	/* ── La carte « À réviser » (tâche 11) ── */
	"review.card.empty": "Nothing due today. Come back tomorrow.",
} as const;
```

Et `src/i18n/fr/review.ts` :

```ts
import type { EN_REVIEW } from "../en/review";

export const FR_REVIEW: Record<keyof typeof EN_REVIEW, string> = {
	"review.settings.title": "Réglages",
	"review.settings.folders": "Dossiers de quiz",
	"review.settings.foldersHint": "Neo Quiz lit les blocs quiz-blocks de ces dossiers. Rien n'est copié, rien n'est déplacé.",
	"review.settings.addFolder": "Ajouter un dossier",
	"review.settings.removeFolder": "Retirer de la liste",
	"review.settings.removeHint": "Le dossier et son historique de révision restent sur le disque.",
	"review.settings.full": "Neo Quiz lit jusqu'à {count} dossiers.",
	"review.settings.quizCount": "{count} quiz",
	"review.settings.exams": "Dates d'examen",
	"review.settings.examsHint": "Une date resserre le retour de la matière. Laissée vide, elle est révisée pour être retenue durablement.",
	"review.settings.noModules": "Aucune matière pour l'instant — ouvrez un dossier dont les quiz sont rangés en sous-dossiers.",
	"review.card.empty": "Rien à réviser aujourd'hui. À demain.",
};
```

Les agréger dans `src/i18n/en.ts` et `src/i18n/fr.ts` (un import et une
entrée de plus, sur le modèle du domaine `app`).

- [ ] **Étape 2 : la page**

Créer `apps/windows/src/ui/settings.ts`. Structure et classes : celles du
tableau de bord (`qbd-content`, `qbd-quizzes-header`, `qbd-quizzes-title`,
`qbd-btn--create`, `qbd-quizzes-crumb-back`), déjà chargées. Les seules classes
neuves (`nq-reglages-*`) vont dans `shell.css`.

```ts
export function renderSettings(
	root: HTMLElement,
	deps: { onBack(): void; onFoldersChanged(): void },
): () => void {
	const contenu = ajouter(root, "div", "qbd-content");

	// En-tête : retour + titre. `t()` AU RENDU, jamais dans une constante.
	const entete = ajouter(contenu, "div", "qbd-quizzes-header");
	const retour = ajouter(entete, "button", "qbd-quizzes-crumb-back");
	retour.type = "button";
	// Clé empruntée : c'est le MÊME bouton retour que la page d'un quiz.
	retour.setAttribute("aria-label", t("dashboard.quiz.back"));
	retour.title = t("dashboard.quiz.back");
	currentHost().ui.setIcon(ajouter(retour, "span", "qbd-quizzes-crumb-icon"), "arrow-left");
	retour.addEventListener("click", () => deps.onBack());
	ajouter(entete, "h2", "qbd-quizzes-title", t("review.settings.title"));

	const section = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(section, "h3", "nq-reglages-titre", t("review.settings.folders"));
	ajouter(section, "p", "nq-reglages-aide", t("review.settings.foldersHint"));
	const liste = ajouter(section, "div", "nq-reglages-liste");
	const actions = ajouter(section, "div", "nq-reglages-actions");

	async function dessiner(): Promise<void> {
		const dossiers = await savedFolders();
		liste.replaceChildren();
		for (const d of dossiers) {
			const ligne = ajouter(liste, "div", "nq-reglages-dossier");
			/* Le LOGO d'Obsidian quand c'en est un : ce que cette image
			   transporte, c'est « ceci est un vault », qu'une icône de dossier
			   ne dirait pas. La détection est asynchrone — d'où l'icône
			   générique posée d'abord, remplacée si besoin. */
			const icone = ajouter(ligne, "span", "nq-reglages-icone");
			currentHost().ui.setIcon(icone, "folder");
			void estVaultObsidian(d.path).then(v => { if (v) { icone.replaceChildren(); poserLogoObsidian(icone); } });
			const texte = ajouter(ligne, "div", "nq-reglages-texte");
			// `textContent` (via `ajouter`) : ces chaînes viennent du disque.
			ajouter(texte, "span", "nq-reglages-nom", d.name);
			ajouter(texte, "span", "nq-reglages-chemin", d.path);
			const retirer = ajouter(ligne, "button", "nq-reglages-retirer");
			retirer.type = "button";
			retirer.title = t("review.settings.removeFolder");
			retirer.setAttribute("aria-label", t("review.settings.removeFolder"));
			currentHost().ui.setIcon(retirer, "x");
			retirer.addEventListener("click", () => {
				void (async () => {
					await removeFolder(d.id);
					deps.onFoldersChanged();
				})();
			});
		}
		ajouter(liste, "p", "nq-reglages-aide", t("review.settings.removeHint"));

		actions.replaceChildren();
		const ajout = ajouter(actions, "button", "qbd-btn--create");
		ajout.type = "button";
		currentHost().ui.setIcon(ajouter(ajout, "span", "qbd-btn-icon"), "folder-plus");
		ajouter(ajout, "span", undefined, t("review.settings.addFolder"));
		/* La limite de la spec §6 est DITE, pas subie : un bouton qui ne fait
		   rien serait pris pour une panne. */
		if (dossiers.length >= MAX_DOSSIERS) {
			ajout.disabled = true;
			ajouter(actions, "p", "nq-reglages-aide", t("review.settings.full", { count: MAX_DOSSIERS }));
		}
		ajout.addEventListener("click", () => {
			void (async () => {
				const choix = await pickFolder();
				// Annulation : ce n'est pas une erreur, c'est la réponse « non ».
				if (!choix) return;
				await addFolder(choix);
				deps.onFoldersChanged();
			})();
		});
	}

	void dessiner();
	/* Rien à désabonner : la page ne s'abonne à rien. Le démontage est rendu
	   quand même, parce que TOUT écran en rend un — `main.ts` appelle
	   `demonterCourant` sans savoir de quel écran il s'agit. */
	return () => { root.replaceChildren(); };
}
```

`onFoldersChanged` recharge la fenêtre (`location.reload()` dans `main.ts`),
pour la raison déjà écrite dans `choisirDossier` : l'hôte est un singleton, et
repartir de zéro est la façon la plus honnête d'en obtenir un neuf.

- [ ] **Étape 3 : y accéder**

Dans `list.ts`, à côté de « Changer de dossier » — qui devient « Réglages », la
gestion des dossiers ayant sa page :

```ts
	const bouton = ajouter(actions, "button", "qbd-btn--create");
	bouton.type = "button";
	currentHost().ui.setIcon(ajouter(bouton, "span", "qbd-btn-icon"), "settings");
	ajouter(bouton, "span", undefined, t("review.settings.title"));
	bouton.addEventListener("click", () => deps.onSettings());
```

Les `deps` de `renderList` deviennent
`{ scanner: Scanner; onOpen(entry: QuizIndexEntry): void; onSettings(): void }`
— `onChangeFolder` disparaît, la gestion des dossiers ayant sa page. (La
tâche 11 y ajoutera `store: ReviewStore`.)
`app.list.changeFolder` n'a plus d'appelant — **la retirer des deux
dictionnaires** (une clé morte est une traduction qu'on maintient pour rien).

Dans `main.ts`, un écran de plus, monté exactement comme les autres :

```ts
function ouvrirReglages(root: HTMLElement, scanner: Scanner): void {
	demonterCourant?.();
	demonterCourant = null;
	root.textContent = "";
	demonterCourant = renderSettings(root, {
		onBack: () => mount(root, scanner),
		/* RECHARGER : ajouter ou retirer un dossier change les racines de
		   l'hôte, et l'hôte est installé une seule fois. Un remontage à chaud
		   laisserait vivre l'index et le surveillant de l'ancienne liste. */
		onFoldersChanged: () => location.reload(),
	});
}
```

- [ ] **Étape 4 : le CSS**

Dans `shell.css`, ajouter les classes `nq-reglages-*` — **n'employer que des
variables déjà définies** par `theme/host-vars.css` ou l'arbre partagé :
`--background-secondary`, `--background-modifier-border`, `--text-normal`,
`--text-muted`, `--radius-m`, `--size-4-2`. `npm run check:theme` ne balaie pas
`apps/windows/`, donc une variable inventée ici serait invisible aux deux
assertions et rendrait l'écran illisible sans un mot.

- [ ] **Étape 5 : vérifier**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:theme; echo "EXIT=$?"
```

Puis `npm run app:dev` :

1. « Réglages » ouvre la page, la flèche revient à la liste.
2. « Ajouter un dossier » → le sélecteur natif → la fenêtre recharge → **la
   liste montre les quiz des DEUX dossiers**.
3. Ouvrir un quiz du second dossier : il se joue, ses images s'affichent.
4. Retirer un dossier → la fenêtre recharge, ses quiz disparaissent, **les
   fichiers sont toujours sur le disque**.
5. Ajouter le même dossier deux fois : il n'apparaît qu'une fois.
6. Basculer Obsidian en anglais puis en français (le mode `auto` suit l'hôte,
   ici le système) et vérifier qu'aucun libellé n'est resté figé.

- [ ] **Étape 6 : commit**

```bash
git add apps/windows/src src/i18n
git commit -m "feat(app): une page de reglages, et jusqu a dix dossiers de quiz"
```

---
## Tâche 8 — L'application journalise ses réponses

**Fichiers :**
- Créer : `apps/windows/src/review/catalogue.ts`
- Créer : `apps/windows/src/review/store.ts`
- Modifier : `apps/windows/src/main.ts`, `apps/windows/src/ui/quiz-page.ts`
- Modifier : `scripts/check-windows-host.mjs` (groupe « catalogue »)

**Interfaces :**
- Consomme : `createReviewStore`, `ReviewStore`, `parseExamDate` (tâche 4) ;
  `migrateReviewLog` (tâche 3) ; `Host`, `HostPaths` (tâche 2) ; `Scanner`,
  `QuizIndexEntry` (tranche 1).
- Produit : `construireCatalogue(quizzes, paths): ScheduledItem[]`,
  `libelleModule(cle: string): string`,
  `creerJournalApp(host: Host, scanner: Scanner): Promise<ReviewStore>`.
  Les tâches 10 et 11 les
  consomment.

- [ ] **Étape 1 : le catalogue de l'application**

Créer `apps/windows/src/review/catalogue.ts` :

```ts
import type { QuizIndexEntry } from "../../../../src/dashboard/scanner";
import type { HostPaths } from "../../../../src/host/types";
import type { ScheduledItem } from "../../../../src/scheduler";

/* ══════════════════════════════════════════════════════════
   LE CATALOGUE VU PAR L'APPLICATION

   Le noyau attend, pour chaque question : une clé opaque, un MODULE (qui
   porte l'horizon et borne l'entrelacement) et une SOURCE (qui alterne les
   familles). Le greffon tire le module d'une note « Dashboard » du vault ;
   l'application n'a pas cette note, et n'en invente pas : le module est le
   DOSSIER PARENT du quiz, exactement le repli de `moduleForQuiz`.

   La clé de module porte l'identifiant de la RACINE, et ce n'est pas une
   précaution théorique : deux dossiers ouverts peuvent tous les deux avoir
   un sous-dossier « Réseaux », et un horizon partagé par erreur
   resserrerait les révisions d'une matière dont l'examen n'a pas lieu.

   Rien de tout cela ne touche le disque : le journal ne porte que `q`,
   `at`, `grade` et `role`. Les deux hôtes peuvent donc grouper
   différemment sans que rien ne diverge — seule la granularité de
   l'horizon change, et elle se voit à l'écran.
══════════════════════════════════════════════════════════ */

const SEP = "/";

/** La clé de module d'un quiz : `<racine>/<dossier parent>`, ou `<racine>`
    pour un quiz posé à la racine du dossier. */
export function cleModule(cheminContrat: string, paths: HostPaths): string {
	const racine = paths.rootOf(cheminContrat);
	const local = paths.localPath(cheminContrat);
	const segments = local.split(SEP).filter(Boolean);
	const parent = segments.length >= 2 ? segments[segments.length - 2] : "";
	const id = racine?.id ?? "";
	return parent ? `${id}${SEP}${parent}` : id;
}

/** Ce qu'on AFFICHE d'une clé de module : le dernier segment. La clé, elle,
    reste entière — c'est elle qui indexe les dates d'examen. */
export function libelleModule(cle: string): string {
	const segments = cle.split(SEP).filter(Boolean);
	return segments[segments.length - 1] ?? cle;
}

export function construireCatalogue(
	quizzes: ReadonlyArray<QuizIndexEntry>,
	paths: HostPaths,
): ScheduledItem[] {
	const out: ScheduledItem[] = [];
	for (const quiz of quizzes) {
		const module = cleModule(quiz.path, paths);
		for (const it of quiz.items) {
			const item: ScheduledItem = {
				q: `${quiz.path}::${it.id}`,
				module,
				/* La TRANCHE sépare les familles confusables d'un même chapitre
				   tant qu'aucun `topic` n'est déclaré par le contenu — même
				   règle que `buildReviewCatalogue` côté greffon. */
				source: typeof it.slice === "number" ? `${quiz.path}#${it.slice}` : quiz.path,
			};
			if (it.role) item.role = it.role;
			out.push(item);
		}
	}
	return out;
}
```

- [ ] **Étape 2 : le journal de l'application**

Créer `apps/windows/src/review/store.ts` :

```ts
import { LOG_PREFIX } from "../../../../src/branding";
import type { Host } from "../../../../src/host/types";
import type { Scanner } from "../../../../src/dashboard/scanner";
import { migrateReviewLog } from "../../../../src/review/migration";
import { createReviewStore, parseExamDate, type ReviewStore } from "../../../../src/review/review-store";
import { construireCatalogue } from "./catalogue";
import { examDates } from "../host/folder";

/**
 * Le journal de l'application : un fichier par dossier, un plan unique.
 *
 * MIGRER D'ABORD, CHARGER ENSUITE. L'inverse lirait un journal neuf encore
 * vide, et la carte « À réviser » annoncerait « rien à réviser » à quelqu'un
 * qui a un semestre derrière lui — le pire message possible, parce qu'il a
 * l'air normal.
 */
export async function creerJournalApp(host: Host, scanner: Scanner): Promise<ReviewStore> {
	for (const root of host.paths.roots()) {
		try {
			const res = await migrateReviewLog(host.fs, root.legacyReviewLog, root.reviewLog);
			if (!res.skipped) {
				console.info(LOG_PREFIX, `journal migré (${root.name}) : ${res.absorbed} absorbée(s), ${res.duplicates} déjà présente(s), ${res.ignored} illisible(s), ancien ${res.renamed ? "rangé" : "conservé"}`);
			}
		} catch (e) {
			/* Le démarrage NE DÉPEND PAS de la migration : au pire l'historique
			   reste à son ancienne place, et on réessaiera au prochain
			   lancement. Une exception ici laisserait la fenêtre vide. */
			console.warn(LOG_PREFIX, "migration du journal impossible:", root.name, e);
		}
	}

	const store = createReviewStore({
		fs: host.fs,
		watcher: host.watcher,
		paths: host.paths,
		catalogue: () => construireCatalogue(scanner.getQuizzes(), host.paths),
		horizons: examDatesEnMs,
		now: () => Date.now(),
	});
	await store.load();
	return store;
}

/** Les dates saisies, converties une fois par plan. `parseExamDate` est
    PARTAGÉE avec le greffon : deux conversions divergeraient, et une date
    mal lue déplace un examen d'un jour sans le dire. */
function examDatesEnMs(): Record<string, number | null> {
	const out: Record<string, number | null> = {};
	for (const [module, brut] of Object.entries(examDates())) {
		const t = parseExamDate(brut);
		if (t !== null) out[module] = t;
	}
	return out;
}
```

`examDates()` (`host/folder.ts`) lit le réglage en mémoire, chargé au
démarrage — le plan est recalculé souvent, et un aller-retour vers le magasin à
chaque calcul serait payé pour rien :

```ts
/** Les dates d'examen par module, telles que saisies (`AAAA-MM-JJ`).
    Valeur PERSISTÉE : jamais traduite, jamais reformatée. */
let datesExamen: Record<string, string> = {};

export function examDates(): Record<string, string> {
	return datesExamen;
}

export async function chargerExamDates(): Promise<Record<string, string>> {
	try {
		const brut = await (await reglages()).get<Record<string, string>>(CLE_EXAM_DATES);
		datesExamen = brut && typeof brut === "object" ? brut : {};
	} catch (e) {
		console.warn(LOG_PREFIX, "dates d'examen illisibles:", e);
		datesExamen = {};
	}
	return datesExamen;
}

export async function setExamDate(module: string, date: string): Promise<void> {
	const suivant = { ...datesExamen };
	// Une date effacée est RETIRÉE, pas gardée vide : `horizonFor` retomberait
	// de toute façon sur l'horizon par défaut, mais le réglage accumulerait
	// des entrées mortes qu'on n'oserait plus nettoyer.
	if (date) suivant[module] = date; else delete suivant[module];
	datesExamen = suivant;
	const store = await reglages();
	await store.set(CLE_EXAM_DATES, suivant);
	await store.save();
}
```

avec `const CLE_EXAM_DATES = "examDates";`.

- [ ] **Étape 3 : brancher le puits sur la page d'un quiz**

Dans `quiz-page.ts`, `openQuizPage` prend le store en dépendance et le passe au
moteur :

```ts
// Types en `import type` seulement : ils viennent du noyau et de `types/quiz`,
// et ce fichier ne doit tirer aucune implémentation de plus.
import type { ReviewGrade } from "../../../../src/scheduler";
import type { QuestionRole } from "../../../../src/types/quiz";

export async function openQuizPage(
	root: HTMLElement,
	entry: QuizIndexEntry,
	onBack: () => void,
	/* La FORME du puits, pas le `ReviewStore` : cette page n'a besoin ni de
	   `plan()` ni de `load()`, et c'est exactement le type que le moteur
	   attend (`types/engine-ctx.ts`). */
	reviewSink?: {
		record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void;
		keyOf(path: string, id: string): string;
	},
): Promise<() => void> {
```

et, dans l'appel au moteur, à la place du commentaire « Ni `statsSink` ni
`reviewSink` » :

```ts
			sourcePath: entry.path,
			/* Le JOURNAL. `keyOf(sourcePath, id)` compose une clé du CONTRAT
			   (préfixée par la racine quand il y en a plusieurs) ; c'est
			   l'adaptateur qui la ramène à sa forme LOCALE avant de l'écrire,
			   pour que le greffon lise exactement la même clé sur le même
			   dossier. Le moteur, lui, ne sait rien de tout ça : il ne connaît
			   que la FORME du puits.
			   `statsSink` reste absent : les statistiques par quiz sont
			   l'affichage du tableau de bord, une autre question — spec de
			   l'ordonnanceur §9.1, « deux systèmes distincts, à ne pas
			   fusionner ». */
			reviewSink,
```

Dans `main.ts`, le store est créé une fois après le scanner et passé à
`ouvrirQuiz` ; `demarrer()` appelle aussi `chargerExamDates()` avant de monter.

- [ ] **Étape 4 : les cas du catalogue**

Dans `scripts/check-windows-host.mjs` :

```js
await withSrcModule("apps/windows/src/review/catalogue.ts", async ({ construireCatalogue, cleModule, libelleModule }) => {
	const r = makeReporter("App — catalogue de révision");
	/* Un faux `paths` : deux racines, préfixe = premier segment. C'est le
	   contrat, pas l'implémentation Windows, qui est éprouvé ici. */
	const paths = {
		rootOf: (p) => ({ id: p.split("/")[0], name: p.split("/")[0], reviewLog: "", legacyReviewLog: null }),
		localPath: (p) => p.split("/").slice(1).join("/"),
		contractPath: (id, l) => (id ? `${id}/${l}` : l),
		resultsDirFor: () => "",
		roots: () => [],
	};

	/* La clé de module porte la RACINE : sans elle, « Réseaux » de deux
	   dossiers différents partageraient une date d'examen, et l'ordonnanceur
	   resserrerait les révisions d'une matière dont l'examen n'a pas lieu. */
	r.check("le module porte la racine", cleModule("Efrei/Reseaux/ch1.md", paths), "Efrei/Reseaux");
	r.check("deux racines ne partagent pas un module homonyme",
		cleModule("Perso/Reseaux/ch1.md", paths) === cleModule("Efrei/Reseaux/ch1.md", paths), false);
	/* Un quiz posé à la racine du dossier : le module est la racine, pas une
	   clé qui se termine par un séparateur. */
	r.check("un quiz sans sous-dossier", cleModule("Efrei/ch1.md", paths), "Efrei");
	r.check("le libellé est le dernier segment", libelleModule("Efrei/Reseaux"), "Reseaux");

	const items = construireCatalogue([
		{ path: "Efrei/Reseaux/ch1.md", items: [{ id: "ip" }, { id: "masque", slice: 2 }] },
	], paths);
	/* La clé de question est le chemin du CONTRAT + « ::id ». C'est
	   l'adaptateur qui la localise avant écriture — ici, elle est globale. */
	r.check("les clés de question", items.map(i => i.q),
		["Efrei/Reseaux/ch1.md::ip", "Efrei/Reseaux/ch1.md::masque"]);
	/* La TRANCHE devient la source : sans elle, deux tranches d'un même
	   chapitre ne s'entrelaceraient pas. */
	r.check("la tranche sépare les familles", items.map(i => i.source),
		["Efrei/Reseaux/ch1.md", "Efrei/Reseaux/ch1.md#2"]);

	r.done();
});
```

**Éprouver DISCRIMINANT** : retirer l'identifiant de racine de `cleModule` → le
cas « deux racines » rougit ; ignorer `slice` → le cas de la tranche rougit.

- [ ] **Étape 5 : vérifier, et l'épreuve qui compte**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:windows-host; echo "EXIT=$?"
npm run check:review-store; echo "EXIT=$?"
```

Puis, **avec un vrai vault Obsidian ouvert des deux côtés** — c'est l'épreuve
de la tranche entière :

1. Dans l'app, jouer un quiz jusqu'aux résultats.
2. Ouvrir `<vault>/.neo-quiz/review-log.jsonl` : de nouvelles lignes, et leur
   `q` vaut `Cours/reseau.md::ip` — **sans le préfixe du dossier**. Une clé
   préfixée ici serait le défaut le plus coûteux de la tranche : tout aurait
   l'air de marcher, et le greffon ne verrait jamais ces révisions.
3. Ouvrir le tableau de bord d'Obsidian : la carte « À réviser aujourd'hui »
   doit **avoir bougé** — les questions jouées dans l'app en sont sorties.
4. Faire l'inverse : jouer dans Obsidian, relancer l'app.
5. Avec DEUX dossiers ouverts, jouer un quiz de chacun : deux fichiers
   `.neo-quiz/review-log.jsonl` distincts, chacun ne contenant que ses notes.

- [ ] **Étape 6 : commit**

```bash
git add apps/windows/src scripts/check-windows-host.mjs
git commit -m "feat(app): les reponses jouees dans l app comptent dans le meme journal"
```

---

## Tâche 9 — Les renommages que le surveillant ne sait pas apparier

**Fichiers :**
- Créer : `src/review/rename-match.ts`
- Créer : `scripts/check-rename-match.mjs`
- Modifier : `package.json`, `apps/windows/src/main.ts`

**Interfaces :**
- Consomme : `QuizIndexEntry` (scanner).
- Produit : `SignatureNote { path: string; ids: string[] }`,
  `signatureForte(ids): boolean`,
  `apparierRenommages(disparus, apparus): Array<{ from: string; to: string }>`,
  `createRenameDetector(deps): { observer(quizzes): void }`.

- [ ] **Étape 1 : le jeu de cas**

Créer `scripts/check-rename-match.mjs`, et ajouter
`"check:rename-match": "node scripts/check-rename-match.mjs",` à
`package.json`.

```js
/**
 * APPARIER LES RENOMMAGES QUE LE SURVEILLANT NE NOMME PAS.
 *
 * Ce que ce script empêche : qu'une note renommée pendant que
 * l'application tourne reparte à zéro (l'historique reste accroché à
 * l'ancien chemin), ET qu'un appariement INVENTÉ transporte l'historique
 * d'une note vers une autre. Le second défaut est pire que le premier :
 * il est faux et invisible.
 *
 *     npm run check:rename-match
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const n = (path, ids) => ({ path, ids });

await withSrcModule("src/review/rename-match.ts", async ({ apparierRenommages, signatureForte, createRenameDetector }) => {
	const r = makeReporter("Renommages — appariement par signature");

	/* Le cas nominal : une note disparaît, une autre apparaît, MÊMES
	   identifiants de questions. Ce n'est pas une ressemblance, c'est la même
	   note — les identifiants sont des slugs des énoncés (src/quiz-ids.ts). */
	r.check("mêmes identifiants ⇒ renommage",
		apparierRenommages([n("Cours/ch1.md", ["ip", "masque"])], [n("Cours/reseau.md", ["ip", "masque"])]),
		[{ from: "Cours/ch1.md", to: "Cours/reseau.md" }]);

	/* Des identifiants DIFFÉRENTS : deux évènements sans rapport. */
	r.check("identifiants différents ⇒ rien",
		apparierRenommages([n("a.md", ["ip"])], [n("b.md", ["dns"])]), []);

	/* Une signature FAIBLE (que des replis `qN`, attribués par POSITION) ne
	   distingue rien : deux quiz de deux questions sans `id:` explicite
	   auraient la même. On refuse d'inventer — la note perdra son historique,
	   ce qui est au moins vrai. */
	r.check("une signature de replis est faible", signatureForte(["q1", "q2"]), false);
	r.check("un seul identifiant explicite suffit", signatureForte(["q1", "adressage"]), true);
	r.check("signature faible ⇒ aucun appariement",
		apparierRenommages([n("a.md", ["q1", "q2"])], [n("b.md", ["q1", "q2"])]), []);

	/* AMBIGUÏTÉ : la même signature deux fois. Copier une note puis supprimer
	   l'originale produirait sinon un appariement arbitraire. */
	r.check("deux apparus de même signature ⇒ rien",
		apparierRenommages([n("a.md", ["ip"])], [n("b.md", ["ip"]), n("c.md", ["ip"])]), []);
	r.check("deux disparus de même signature ⇒ rien",
		apparierRenommages([n("a.md", ["ip"]), n("b.md", ["ip"])], [n("c.md", ["ip"])]), []);

	/* L'ORDRE des identifiants compte : deux quiz peuvent poser les mêmes
	   questions dans un ordre différent et rester deux quiz. */
	r.check("l'ordre fait partie de la signature",
		apparierRenommages([n("a.md", ["ip", "dns"])], [n("b.md", ["dns", "ip"])]), []);

	r.done();
});

await withSrcModule("src/review/rename-match.ts", async ({ createRenameDetector }) => {
	const r = makeReporter("Renommages — détecteur");
	const vus = [];
	let horloge = 1000;
	const det = createRenameDetector({
		onRename: (from, to) => vus.push([from, to]),
		now: () => horloge,
		fenetreMs: 5000,
	});

	const quiz = (path, ids) => ({ path, items: ids.map(id => ({ id })) });

	// Première observation : rien à apparier, on mémorise seulement.
	det.observer([quiz("Cours/ch1.md", ["ip", "masque"])]);
	r.check("la première observation n'apparie rien", vus.length, 0);

	/* Le surveillant a émis `delete` puis `create` : le scanner voit d'abord
	   la disparition, puis l'apparition. C'est EXACTEMENT le cas que
	   plugin-fs produit quand il ne relie pas les deux moitiés. */
	det.observer([]);
	r.check("une disparition seule n'apparie rien", vus.length, 0);
	horloge += 300;
	det.observer([quiz("Cours/reseau.md", ["ip", "masque"])]);
	r.check("l'apparition qui suit est appariée", vus, [["Cours/ch1.md", "Cours/reseau.md"]]);

	/* Hors de la fenêtre : une note supprimée il y a une heure et une note
	   créée aujourd'hui n'ont plus de raison d'être la même. */
	det.observer([]);
	horloge += 60000;
	det.observer([quiz("Autre/reseau.md", ["ip", "masque"])]);
	r.check("hors fenêtre, aucun appariement", vus.length, 1);

	r.done();
});
```

- [ ] **Étape 2 : écrire le module**

Créer `src/review/rename-match.ts` :

```ts
/* ══════════════════════════════════════════════════════════
   APPARIER UN RENOMMAGE QUE L'HÔTE N'A PAS SU NOMMER

   `@tauri-apps/plugin-fs` remonte un renommage en deux évènements que rien
   ne relie (`modify: { kind: "rename", mode: "from" | "to" }`). L'hôte
   Windows émet alors `delete` puis `create` — il refuse d'inventer un
   appariement, et il a raison.

   Mais le journal de révision SUIT SES CLÉS PAR RENOMMAGE : sans réponse,
   une note renommée pendant que l'application tourne repart à zéro, et son
   historique reste accroché à un chemin qui n'existe plus.

   La réponse ne vient pas du surveillant, elle vient du CATALOGUE. Le
   scanner connaît les identifiants des questions de chaque note
   (`src/quiz-ids.ts`, la même règle qu'à l'écriture). Quand une note
   disparaît et qu'une autre apparaît avec EXACTEMENT la même suite
   d'identifiants, ce n'est pas une ressemblance : c'est la même note.

   Trois gardes, et sans elles ce serait une devinette :
   1. la signature doit être FORTE — au moins un identifiant qui ne soit pas
      un repli `qN` (attribué par position, donc partagé par tous les quiz
      de même taille sans `id:` explicite) ;
   2. l'appariement doit être UNIQUE des deux côtés ;
   3. les deux moitiés doivent être proches dans le temps.

   Un appariement manqué coûte l'historique d'une note. Un appariement FAUX
   transporte l'historique d'une note vers une autre, et c'est invisible :
   c'est pourquoi les gardes penchent toutes du même côté.
══════════════════════════════════════════════════════════ */

export interface SignatureNote {
	path: string;
	/** Les identifiants des questions, DANS L'ORDRE. */
	ids: string[];
}

/** Un identifiant de repli, attribué par position faute de `id:` et de
    titre exploitable (`src/quiz-ids.ts`). */
const REPLI = /^q\d+$/;

/**
 * Une signature distingue-t-elle vraiment cette note ?
 *
 * Mesuré le 2026-09-02 sur les vaults réels : 771 des 774 questions portent
 * un `id` explicite. Le refus ne concerne donc qu'une poignée de notes.
 */
export function signatureForte(ids: ReadonlyArray<string>): boolean {
	return ids.length > 0 && ids.some(id => !REPLI.test(id));
}

const cle = (ids: ReadonlyArray<string>): string => ids.join(" ");

export function apparierRenommages(
	disparus: ReadonlyArray<SignatureNote>,
	apparus: ReadonlyArray<SignatureNote>,
): Array<{ from: string; to: string }> {
	const index = new Map<string, SignatureNote[]>();
	for (const d of disparus) {
		if (!signatureForte(d.ids)) continue;
		const k = cle(d.ids);
		const l = index.get(k);
		if (l) l.push(d); else index.set(k, [d]);
	}
	const parApparu = new Map<string, SignatureNote[]>();
	for (const a of apparus) {
		if (!signatureForte(a.ids)) continue;
		const k = cle(a.ids);
		const l = parApparu.get(k);
		if (l) l.push(a); else parApparu.set(k, [a]);
	}

	const out: Array<{ from: string; to: string }> = [];
	for (const [k, listeApparus] of parApparu) {
		const listeDisparus = index.get(k);
		// UNIQUE des deux côtés, sinon on ne sait pas qui va avec qui.
		if (!listeDisparus || listeDisparus.length !== 1 || listeApparus.length !== 1) continue;
		out.push({ from: listeDisparus[0].path, to: listeApparus[0].path });
	}
	// Ordre total : deux exécutions sur les mêmes entrées donnent le même
	// résultat, sans quoi rien de ceci ne serait vérifiable.
	out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
	return out;
}

interface QuizObserve {
	path: string;
	items: ReadonlyArray<{ id: string }>;
}

export interface RenameDetector {
	/** À brancher sur `scanner.onChange`. */
	observer(quizzes: ReadonlyArray<QuizObserve>): void;
}

/**
 * Le registre temporel. Il garde les notes DISPARUES pendant une courte
 * fenêtre, le temps que leur moitié « create » arrive.
 *
 * `now` est injectée — pas par purisme, mais parce qu'un détecteur qui lit
 * l'horloge n'est pas éprouvable : la fenêtre ne se teste qu'en la faisant
 * avancer.
 */
export function createRenameDetector(deps: {
	onRename(from: string, to: string): void;
	now(): number;
	fenetreMs?: number;
}): RenameDetector {
	const fenetre = deps.fenetreMs ?? 5000;
	let precedent = new Map<string, string[]>();
	let enAttente: Array<{ note: SignatureNote; at: number }> = [];

	return {
		observer(quizzes) {
			const courant = new Map<string, string[]>();
			for (const q of quizzes) courant.set(q.path, q.items.map(i => i.id));
			const maintenant = deps.now();

			const apparus: SignatureNote[] = [];
			for (const [path, ids] of courant) {
				if (!precedent.has(path)) apparus.push({ path, ids });
			}
			for (const [path, ids] of precedent) {
				if (!courant.has(path)) enAttente.push({ note: { path, ids }, at: maintenant });
			}

			// Purge AVANT l'appariement : une disparition d'il y a une heure
			// n'a plus rien à voir avec une création d'aujourd'hui.
			enAttente = enAttente.filter(e => maintenant - e.at <= fenetre);

			if (apparus.length) {
				const paires = apparierRenommages(enAttente.map(e => e.note), apparus);
				for (const p of paires) {
					deps.onRename(p.from, p.to);
					enAttente = enAttente.filter(e => e.note.path !== p.from);
				}
			}
			precedent = courant;
		},
	};
}
```

- [ ] **Étape 3 : brancher côté application seulement**

Dans `main.ts`, après la création du store :

```ts
	/* L'appariement des renommages que le surveillant n'a pas su nommer.
	   BRANCHÉ CÔTÉ APPLICATION SEULEMENT : Obsidian émet un vrai `rename`, que
	   le contrat transmet tel quel — le greffon n'a rien à deviner. */
	const detecteur = createRenameDetector({
		onRename: (from, to) => store.renamed(from, to),
		now: () => Date.now(),
	});
	scanner.onChange(quizzes => detecteur.observer(quizzes));
```

**Ordre** : `scanner.onChange` est enregistré APRÈS `scanner.init()`, donc la
première observation porte le catalogue complet — c'est bien ce que le
détecteur attend (il n'apparie rien à la première).

- [ ] **Étape 4 : vérifier**

```bash
npm run check:rename-match; echo "EXIT=$?"
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
```

**Éprouver DISCRIMINANT** : retirer la garde `signatureForte` → le cas
« signature faible » rougit ; accepter plusieurs candidats → les deux cas
d'ambiguïté rougissent ; retirer la purge → le cas « hors fenêtre » rougit.

Puis, dans l'application (`npm run app:dev`) :

1. Jouer quelques questions d'un quiz, noter lesquelles.
2. **Renommer la note depuis l'Explorateur Windows** (pas depuis Obsidian :
   c'est le cas que le surveillant ne sait pas nommer).
3. Le journal reçoit une ligne `{"t":"rename",…}`.
4. La carte « À réviser » (tâche 11) montre le même compte qu'avant — les
   questions n'ont pas repris à zéro.
5. Renommer une note SANS `id:` explicite (en fabriquer une) : **aucune** ligne
   `rename`, et c'est le comportement voulu.

- [ ] **Étape 5 : commit**

```bash
git add src/review/rename-match.ts scripts/check-rename-match.mjs package.json apps/windows/src/main.ts
git commit -m "feat(review): apparier un renommage sur une preuve, jamais sur une ressemblance"
```

---

## Tâche 10 — La date d'examen par module, dans l'application

**Fichiers :**
- Modifier : `apps/windows/src/ui/settings.ts`
- Modifier : `apps/windows/src/host/folder.ts` (déjà préparé en tâche 8)
- Modifier : `apps/windows/src/assets/shell.css`

**Interfaces :**
- Consomme : `cleModule`, `libelleModule` (tâche 8) ; `examDates`,
  `setExamDate`, `chargerExamDates` (tâche 8) ; `Scanner`.
- Produit : la section « Dates d'examen » de la page réglages. Aucun nouveau
  symbole exporté, mais `renderSettings` change de signature — ses `deps`
  passent de `{ onBack, onFoldersChanged }` (tâche 7) à
  `{ scanner: Scanner; onBack(): void; onFoldersChanged(): void; onExamDatesChanged(): void }`.
  `main.ts` est le seul appelant, et il a déjà le scanner sous la main.

- [ ] **Étape 1 : lister les modules**

`renderSettings` prend le scanner en dépendance et compose la liste des modules
présents, triée par libellé dans la langue affichée :

```ts
	/* Les modules VIENNENT DU CATALOGUE, ils ne se saisissent pas : proposer
	   une matière qui n'a aucun quiz produirait une date sans effet, et
	   l'utilisateur croirait avoir réglé quelque chose. */
	const modules = [...new Set(deps.scanner.getQuizzes().map(q => cleModule(q.path, currentHost().paths)))]
		.sort((a, b) => libelleModule(a).localeCompare(libelleModule(b), currentLang()));
```

- [ ] **Étape 2 : la section**

```ts
	const exams = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(exams, "h3", "nq-reglages-titre", t("review.settings.exams"));
	ajouter(exams, "p", "nq-reglages-aide", t("review.settings.examsHint"));
	if (!modules.length) {
		ajouter(exams, "p", "nq-reglages-aide", t("review.settings.noModules"));
	}
	for (const module of modules) {
		const ligne = ajouter(exams, "div", "nq-reglages-module");
		const texte = ajouter(ligne, "div", "nq-reglages-texte");
		ajouter(texte, "span", "nq-reglages-nom", libelleModule(module));
		// La RACINE en second : deux dossiers peuvent avoir un module homonyme,
		// et l'utilisateur doit savoir lequel il règle.
		ajouter(texte, "span", "nq-reglages-chemin", module);
		/* `<input type="date">` NATIF, et c'est volontaire : la seule règle du
		   dépôt sur les contrôles est qu'un `<select>` natif est interdit
		   (`ui-select.ts` est le seul dropdown autorisé) — or `ui-select.ts`
		   importe encore Obsidian, donc l'application ne peut pas s'en servir.
		   Un champ de date n'est pas un dropdown, et c'est déjà celui que le
		   modal « Modifier dossier » du greffon emploie (`module-edit.ts`). */
		const champ = ajouter(ligne, "input", "nq-reglages-date") as HTMLInputElement;
		champ.type = "date";
		// Valeur PERSISTÉE, jamais reformatée pour l'affichage : c'est la même
		// chaîne `AAAA-MM-JJ` que le greffon écrit dans ses réglages.
		champ.value = examDates()[module] ?? "";
		champ.addEventListener("change", () => {
			void (async () => {
				await setExamDate(module, champ.value);
				/* La carte « À réviser » se recalcule au prochain rendu : le
				   plan est DÉRIVÉ, il n'y a rien à invalider. C'est la propriété
				   qui a justifié « journal seul, état dérivé ». */
				deps.onExamDatesChanged();
			})();
		});
	}
```

`deps.onExamDatesChanged` redessine la liste au retour (dans `main.ts`, il
suffit de marquer un drapeau relu par `mount`).

- [ ] **Étape 3 : vérifier à l'écran**

Il n'y a **rien de mécanique à vérifier ici** : `parseExamDate` est déjà
éprouvée (tâche 4, via `check:review-store`), `cleModule` aussi (tâche 8), et
le reste est du rendu. Le dire plutôt que d'ajouter un jeu de cas qui
n'éprouverait que `document.createElement`.

`npm run app:dev` :

1. Régler une date d'examen **à trois jours** sur un module qui a des
   questions déjà révisées.
2. Revenir à la liste : la carte « À réviser » (tâche 11) doit montrer **plus**
   de questions de ce module qu'avant — l'horizon plafonne les intervalles, et
   à trois jours le plafond tombe sous la journée.
3. Effacer la date : le compte revient à ce qu'il était. C'est la preuve que
   rien n'est figé — le plan est recalculé depuis le journal, avec le nouveau
   paramètre.
4. Une date PASSÉE : le module retombe sur l'horizon par défaut (spec de
   l'ordonnanceur §5.3), sans aucune intervention.

- [ ] **Étape 4 : commit**

```bash
git add apps/windows/src
git commit -m "feat(app): la date d examen par module resserre ses revisions"
```

---

## Tâche 11 — La carte « À réviser »

**Fichiers :**
- Créer : `apps/windows/src/ui/review-card.ts`
- Modifier : `apps/windows/src/ui/list.ts`

**Interfaces :**
- Consomme : `ReviewStore` (tâche 4), `Scanner`, `QuizIndexEntry`.
- Produit : `renderReviewCard(parent, deps): void` avec
  `deps: { store: ReviewStore; scanner: Scanner; onOpen(entry: QuizIndexEntry): void }`.
  Les `deps` de `renderList` (tâche 7) gagnent `store: ReviewStore`, que
  `main.ts` a déjà sous la main depuis la tâche 8.

- [ ] **Étape 1 : la carte**

Créer `apps/windows/src/ui/review-card.ts`. Les classes sont celles du tableau
de bord (`qbd-review-list`, `qbd-review-row`, `qbd-review-icon`,
`qbd-review-title`, `qbd-review-count`, `qbd-review-deferred`), **définies dans
`src/assets/css/dashboard/dashboard-home.css`, déjà chargé par l'app** : deux
jeux de classes pour la même carte donneraient deux apparences à tenir
synchrones.

```ts
export function renderReviewCard(
	parent: HTMLElement,
	deps: { store: ReviewStore; scanner: Scanner; onOpen(entry: QuizIndexEntry): void },
): void {
	const plan = deps.store.plan(Date.now());

	/* Une question est due, pas un quiz : on regroupe par NOTE pour pouvoir
	   ouvrir quelque chose. `plan.today` est ordonné pour la SESSION (il
	   entrelace les familles) ; l'affichage, lui, veut un ordre stable — d'où
	   le tri par nombre puis par chemin, qui est total. */
	const parNote = new Map<string, number>();
	for (const cle of plan.today) {
		const sep = cle.lastIndexOf("::");
		// Une clé sans séparateur ne désigne aucune note : on la laisse tomber
		// plutôt que de fabriquer un chemin vide.
		if (sep <= 0) continue;
		const path = cle.slice(0, sep);
		parNote.set(path, (parNote.get(path) ?? 0) + 1);
	}

	const lignes = [...parNote.entries()]
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
		.map(([path, n]) => ({ quiz: deps.scanner.getQuiz(path), n }))
		// Note disparue entre le scan et le rendu : rien à ouvrir.
		.filter((l): l is { quiz: QuizIndexEntry; n: number } => !!l.quiz);

	const section = ajouter(parent, "section", "qbd-home-section");
	// `t()` AU RENDU. Clé EMPRUNTÉE au tableau de bord : c'est le même titre,
	// et deux traductions du même texte divergeraient.
	ajouter(section, "h3", "qbd-quizzes-title", t("dashboard.review.title"));

	const liste = ajouter(section, "div", "qbd-review-list");
	if (!lignes.length) {
		/* Un jour sans révision n'est PAS un vide à cacher : c'est le
		   fonctionnement normal de l'espacement, et le dire évite de faire
		   croire à une panne. */
		ajouter(liste, "p", "qbd-review-deferred", t("review.card.empty"));
		return;
	}

	for (const { quiz, n } of lignes) {
		const row = ajouter(liste, "button", "qbd-review-row");
		row.type = "button";
		currentHost().ui.setIcon(ajouter(row, "span", "qbd-review-icon"), "rotate-ccw");
		ajouter(row, "span", "qbd-review-title", quiz.title);
		ajouter(row, "span", "qbd-review-count", t(
			n === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther",
			{ count: n },
		));
		row.addEventListener("click", () => deps.onOpen(quiz));
	}

	/* Le report est une INFORMATION, pas un reproche : il dit que le budget du
	   jour a tenu, pas que l'utilisateur est en retard. */
	if (plan.deferred.length) {
		ajouter(liste, "p", "qbd-review-deferred", t(
			plan.deferred.length === 1 ? "dashboard.review.deferredOne" : "dashboard.review.deferredOther",
			{ count: plan.deferred.length },
		));
	}
}
```

- [ ] **Étape 2 : l'insérer en tête de la liste**

Dans `list.ts`, `renderList` reçoit le store et appelle la carte **avant** la
grille, dans `dessiner()` — pour qu'elle se recalcule quand une note change :

```ts
	function dessiner(quizzes: QuizIndexEntry[]): void {
		zone.replaceChildren();
		/* La carte AVANT la grille, et REDESSINÉE à chaque changement du
		   catalogue : le plan est dérivé du journal, donc jouer un quiz change
		   ce qui est dû — sans rien à invalider. */
		renderReviewCard(zone, { store: deps.store, scanner: deps.scanner, onOpen: deps.onOpen });
		if (quizzes.length === 0) { … inchangé … }
		…
	}
```

**Redessiner au RETOUR d'un quiz** est le point qui se voit : `main.ts` remonte
déjà la liste (`mount`) après un retour, ce qui rappelle `dessiner`. Rien à
ajouter — mais le vérifier à l'écran (étape 4, point 2).

- [ ] **Étape 3 : vérifier**

```bash
npm run check; echo "EXIT=$?"
npm run check:app; echo "EXIT=$?"
npm run check:theme; echo "EXIT=$?"
```

- [ ] **Étape 4 : l'épreuve à l'écran — c'est le livrable de la tranche**

1. Démarrer sur un vault dont le journal a de l'historique : la carte liste les
   notes dues, avec le nombre de questions de chacune.
2. Ouvrir une note depuis la carte, répondre à ses questions, revenir :
   **la carte a diminué**. C'est la boucle complète — moteur, journal,
   ordonnanceur, affichage.
3. Comparer avec le tableau de bord d'Obsidian, sur le même vault, au même
   moment : **les mêmes notes, les mêmes comptes**. Un écart signifie que les
   clés divergent, et c'est le seul défaut de cette tranche qui puisse rester
   invisible longtemps.
4. Un dossier sans historique : « Rien à réviser aujourd'hui » — pas une carte
   vide, pas une absence de carte.
5. Avec deux dossiers ouverts, la carte mélange bien les deux.

- [ ] **Étape 5 : commit**

```bash
git add apps/windows/src
git commit -m "feat(app): la carte A reviser, en tete de la liste"
```

---

## Tâche 12 — Ce que le dépôt doit dire de lui-même

**Fichiers :**
- Modifier : `docs/superpowers/notes/controles.md`
- Modifier : `CLAUDE.md`
- Créer : `docs/superpowers/notes/<date du jour>-tranche-2-epreuves-ecran.md`
  (format `AAAA-MM-JJ`, la date à laquelle cette tâche est exécutée — comme
  `2026-09-05-tranche-1-epreuves-ecran.md`)

- [ ] **Étape 1 : les contrôles**

Ajouter à `docs/superpowers/notes/controles.md`, dans le style des entrées
existantes — **le défaut réel que chaque contrôle empêche**, pas la description
du script :

- `check:review-log` — l'emplacement et la MIGRATION du journal. Il éprouve ce
  qu'aucun disque ne produit sur commande : une écriture qui prétend réussir
  sans rien écrire. Sans la relecture qu'il garde, l'ancien journal serait
  rangé et les révisions n'existeraient plus nulle part.
- `check:folders` — la conversion du réglage `folder` → `folders` et l'unicité
  des identifiants de dossier. Sans la première, une mise à jour renvoie
  l'utilisateur à l'écran « Choisissez un dossier » ; sans la seconde, deux
  dossiers homonymes confondent leurs chemins et l'historique de l'un compte
  pour l'autre.
- `check:rename-match` — l'appariement des renommages que le surveillant ne
  sait pas nommer. Les deux défauts qu'il empêche ne sont pas symétriques :
  un appariement manqué coûte l'historique d'une note, un appariement FAUX
  transporte l'historique d'une note vers une autre — et ne se voit pas.
- `check:review-store` — mis à jour : il porte désormais sur un faux **hôte**,
  et couvre le ROUTAGE entre plusieurs journaux. Le cas qui compte : la clé
  écrite sur disque est LOCALE (`Cours/ch1.md::q1`), jamais préfixée par le
  dossier. Une clé préfixée passerait tous les autres contrôles et rendrait
  l'historique de l'application invisible depuis Obsidian.
- `check:windows-host` — étendu aux RACINES : `local()` et `contrat()` doivent
  se composer en identité, et la résolution par nom ne doit pas franchir les
  racines.

Mettre à jour l'entrée `check:host` : **41** fichiers encore liés à Obsidian.

- [ ] **Étape 2 : `CLAUDE.md`**

Trois retouches, sans dépasser les 200 lignes cibles (couper ailleurs si
besoin) :

- la liste des commandes gagne `check:review-log`, `check:folders`,
  `check:rename-match` — **une ligne chacune**, le détail vivant dans
  `controles.md` ;
- `check:host` annonce **41** ;
- la section « Structure du dépôt » gagne une phrase : `src/review/` est le
  journal de révision **partagé par les deux hôtes** — il n'est plus l'
  adaptateur jetable du tableau de bord, et le chantier 4 ne l'emporte pas.

- [ ] **Étape 3 : la note d'épreuves à l'écran**

Créer `docs/superpowers/notes/<date du jour>-tranche-2-epreuves-ecran.md` sur le
modèle de celle de la tranche 1 : ce qu'aucun script ne verra jamais, par ordre
de priorité, avec pour chaque point ce qui est *bon* et ce qui est *cassé*.

Au minimum :

1. **Le partage de l'historique** : jouer dans l'app, voir la carte du tableau
   de bord d'Obsidian bouger, et l'inverse. *Cassé* : les deux hôtes tiennent
   chacun leur moitié — regarder la clé écrite dans le journal.
2. **La migration sur un vrai vault** : le compte de lignes annoncé, le
   `.migrated`, l'ancien fichier toujours là.
3. **Deux dossiers** : les quiz des deux, les images des deux, deux journaux
   distincts.
4. **Un renommage depuis l'Explorateur**, note puis dossier.
5. **Une date d'examen à trois jours**, puis effacée.
6. **Le greffon, une dernière fois** : jouer, éditer, tableau de bord,
   génération IA — exactement l'état d'avant.
7. **Un dossier retiré puis rajouté** : l'historique revient, puisqu'il vit
   dans le dossier.
8. **Un dossier sur une clé USB retirée** : les autres s'ouvrent quand même.

- [ ] **Étape 4 : commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: les controles de la tranche 2, et ce qui reste a eprouver a l ecran"
```

---

## Ce que la tranche 2 laisse ouvert (et qui appartient aux suivantes)

À relire avant d'écrire le plan de la tranche 3.

- **`statsSink` n'est toujours pas branché côté app** : les cartes de quiz
  n'ont donc aucun état (`--fresh`, `--progress`, `--mastered`). C'est la
  progression par QUIZ, un autre système que le journal ; elle viendra avec la
  page de détail, en tranche 3.
- **Le module d'un quiz est son dossier parent** dans l'app, alors que le
  greffon lit une note « Dashboard ». Les horizons peuvent donc être plus fins
  d'un côté que de l'autre. Rien ne diverge sur le disque (le journal ne porte
  pas le module) ; la question se rouvrira si l'app doit grouper par UE.
- **Un déplacement d'une racine à une autre perd l'historique** : deux
  journaux distincts, et fusionner reviendrait à réécrire un fichier en ajout
  seul. Limite assumée, écrite dans `review-store.ts`.
- **Une note renommée sans `id:` explicite perd son historique** dans l'app
  (signature faible, tâche 9). Trois questions sur 774 dans les vaults réels.
- **Le journal n'est toujours pas compacté** (spec de l'ordonnanceur §11) : ≈ 1
  Mo par année d'usage quotidien, et la rejouabilité complète est ce qu'on
  perdrait en le compactant.
- **Les deux limites mesurées du catalogue** ne bougent pas :
  `npm run report:multiblock` les montre toujours — le scanner n'indexe que le
  PREMIER bloc d'une note, et une note quiz `source:` journalise sous son
  propre chemin.
- **Le thème clair**, **l'empaquetage signé et la mise à jour** (spec §8).
- **41 fichiers restent dans la liste du cliquet** : tout le tableau de bord
  sauf le scanner, tout l'éditeur, et cinq modules du greffon. C'est le
  programme des tranches 3 et 4.

---

## Auto-revue

**Couverture de la spec (§7, tranche 2 — « le journal à son nouvel
emplacement, la migration, l'ordonnanceur branché, la carte À réviser, la date
d'examen par module, plusieurs dossiers ») :**

| Exigence | Tâche |
|---|---|
| Le journal à son nouvel emplacement (§5) | 2 (constantes, contrat), 4 (le greffon y bascule), 6 (les racines de l'app) |
| La migration, et son ordre (§5) | 3 (écrite et éprouvée), 4 (greffon), 8 (application) |
| L'absorption des conflits Syncthing suit le journal (§5) | 4 (`log-file.ts`, dossier du journal) |
| L'ordonnanceur branché côté app | 8 (`reviewSink`, catalogue, horizons) |
| La carte « À réviser » | 11 |
| La date d'examen par module | 10 (application) ; le greffon l'avait déjà |
| Plusieurs dossiers, jusqu'à dix (§6) | 5 (réglage), 6 (hôte composite), 7 (page réglages) |
| Un journal par dossier, un plan du jour unique (§6) | 4 (routage), 8 (catalogue réuni) |
| Une réponse va dans le journal de son dossier (§6) | 4 (`record`, `versLocal`) |
| La liste des dossiers vit dans les réglages de l'app, pas dans un dossier (§6) | 5 |
| Le greffon tourne sans interruption (§3) | contrainte globale, vérifiée aux tâches 2, 4 |
| Aucun `from "obsidian"` de plus dans `src/` (§4) | 4 (le cliquet descend à 41) |

**Ce que la spec laissait ouvert, et qui est tranché** : D1 (emplacement du
journal et sa cohérence avec `resultsDir`), D2 (qui migre, et la concurrence),
D3 (les renommages non appariés), D4 (un journal par dossier composé en un plan
unique), D6 (le sort de `review-store.ts`, et son coût pour la tranche 3).

**Hors périmètre, conformément à la spec §9** : l'édition (tranche 3), la
génération IA (tranche 4), les notifications, la distribution, le partage entre
étudiants, la session inter-quiz composée.

**Cohérence des types** — vérifiée d'un bout à l'autre :
`HostFs.append/list/remove/rename`, `HostWatcher.onRenameDir`,
`HostLinks.resourceUrl(target, fromPath?)`, `HostRoot`, `HostPaths` (tâche 2)
sont employés sous ces noms exacts aux tâches 4, 6 et 8 ;
`migrateReviewLog(fs, ancien, nouveau)` et `MigrationResult` (tâche 3) sont
appelés tels quels aux tâches 4 et 8 ; `createLogFile({ fs, path })` et
`createReviewStore(deps)` avec `ReviewStoreDeps { fs, watcher, paths,
catalogue, horizons, now, params? }` (tâche 4) sont construits aux tâches 4 et
8 ; `ReviewStore { load, record, renamed, plan, keyOf, destroy }` est consommé
aux tâches 8, 9 et 11 ; `DossierQuiz { id, path, name }` et `MAX_DOSSIERS`
(tâche 5) aux tâches 6 et 7 ; `RacineOuverte { id, name, path, vault }` et
`creerCarteRacines` (tâche 6) aux tâches 6 et 8 ; `cleModule` /
`libelleModule` / `construireCatalogue` (tâche 8) à la tâche 10 ;
`apparierRenommages` / `createRenameDetector` (tâche 9) branchés à la tâche 9
elle-même ; `parseExamDate` (tâche 4) employé par le greffon (tâche 4) et par
l'application (tâche 8). La clé de journal reste `<chemin local>::<id>`
partout, et le préfixe de racine ne franchit jamais `paths.localPath`.
