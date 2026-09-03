# Task 9 : date d'examen par module

## Réalisation

- Ajout de `examDate` à l'état de `ModuleEditModal`, initialisé depuis `quizzesModuleOverrides[group.folder]`.
- Ajout du champ natif `<input type="date">` entre l'UE et la couleur, avec autosauvegarde par `apply()` sur `change` et flush disque inchangé dans `onClose()`.
- Extraction de `buildModuleOverride()` afin que la reconstruction complète de l'override soit vérifiable sur le code réel. La fonction conserve `name`, `ue`, `color` et `icon`, ajoute la date lorsqu'elle existe et omet entièrement la propriété lorsqu'elle est vide.
- Ajout des deux libellés anglais et français demandés, appelés par `t()` au rendu.
- Ajout du style minimal de `qbd-medit-hint`, absent du CSS existant, avec uniquement des variables natives Obsidian.
- Ajout de `scripts/check-module-edit.mjs` et de la commande `check:module-edit`. Le script charge le TypeScript réel via `withSrcModule()` et utilise `makeReporter`, qui positionne `process.exitCode` sans interrompre le nettoyage du dossier temporaire.
- Ajout de `getIconIds` au bouchon Obsidian du harnais : cette API était déjà importée par `icon-picker.ts`, dans le graphe réel de `module-edit.ts`, et empêchait le test d'atteindre le code ciblé.

## Format stocké et aller-retour vers `horizons()`

Le format persistant est la chaîne civile ISO `YYYY-MM-DD`, par exemple `2027-06-01`, sans conversion en timestamp ni passage par UTC dans le modal.

Le contrôle natif produit exactement cette représentation et le handler conserve sa valeur textuelle telle quelle dans [module-edit.ts](../../../src/dashboard/module-edit.ts#L146-L149). L'adaptateur relit la même propriété dans [review-store.ts](../../../src/dashboard/review-store.ts#L176-L182), la découpe par `split("-").map(Number)` puis construit un `Date` à minuit local. Il n'y a donc aucune divergence de format et aucun décalage UTC entre écriture et lecture.

L'effacement convertit `dateInput.value === ""` en `undefined`, puis `buildModuleOverride()` n'ajoute pas la propriété. L'override est indexé par `group.folder`, qui est le segment de dossier unique attendu par `quizzesModuleOverrides` et par `horizons()`.

## Valeurs attendues calculées à la main

Cas renseigné, à partir du dossier `Reseaux` et des cinq valeurs saisies :

```json
{
  "Reseaux": {
    "name": "Réseaux",
    "ue": "UE 3",
    "color": "#336699",
    "icon": "network",
    "examDate": "2027-06-01"
  }
}
```

Cas effacé : les quatre valeurs historiques restent identiques et `examDate` est absente, pas vide ni présente avec `undefined`.

```json
{
  "Reseaux": {
    "name": "Réseaux",
    "ue": "UE 3",
    "color": "#336699",
    "icon": "network"
  }
}
```

Le troisième attendu est le booléen littéral `false` pour `"examDate" in efface.Reseaux`.

## Preuves de discrimination par mutation

### 1. Suppression de l'écriture de la date renseignée

La ligne `if (state.examDate) ov.examDate = state.examDate;` a été supprimée temporairement. Le premier cas est devenu rouge tandis que les deux cas d'effacement sont restés verts :

```text
ÉCHEC  la date civile ISO et les autres champs sont conservés
       attendu : {"Reseaux":{"name":"Réseaux","ue":"UE 3","color":"#336699","icon":"network","examDate":"2027-06-01"}}
       obtenu  : {"Reseaux":{"name":"Réseaux","ue":"UE 3","color":"#336699","icon":"network"}}

Modal module — date d'examen : 1/3 cas en échec
```

Ce cas échoue donc si la date n'est plus écrite verbatim.

### 2. Suppression de la garde d'effacement

La garde a été remplacée temporairement par l'affectation inconditionnelle `ov.examDate = state.examDate;`. La comparaison JSON ne voit volontairement pas une propriété à `undefined`, mais le contrôle structurel la détecte :

```text
ÉCHEC  une date effacée supprime entièrement la clé
       attendu : false
       obtenu  : true

Modal module — date d'examen : 1/3 cas en échec
```

Ce cas échoue donc si une date effacée laisse encore une clé présente.

### 3. Suppression des copies des champs historiques

Les quatre règles qui copient `name`, `ue`, `color` et `icon` ont été supprimées ensemble, puis restaurées. Les deux objets complets sont devenus rouges :

```text
ÉCHEC  la date civile ISO et les autres champs sont conservés
       attendu : {"Reseaux":{"name":"Réseaux","ue":"UE 3","color":"#336699","icon":"network","examDate":"2027-06-01"}}
       obtenu  : {"Reseaux":{"examDate":"2027-06-01"}}
ÉCHEC  effacer la date préserve les autres champs
       attendu : {"Reseaux":{"name":"Réseaux","ue":"UE 3","color":"#336699","icon":"network"}}
       obtenu  : {"Reseaux":{}}

Modal module — date d'examen : 2/3 cas en échec
```

Ces cas échouent donc si la reconstruction complète perd les champs historiques pendant l'écriture ou l'effacement de la date.

Après restauration exacte des trois règles, le contrôle repasse à `3/3`.

## CSS, desktop et Android

Le champ réutilise `qbd-medit-input`, déjà défini à `width: 100%`, et le modal reste borné par `max-width: calc(100vw - 32px)`. Le hint n'ajoute ni largeur fixe, ni `nowrap`, ni enfant flex non réductible. Aucun media query n'a été ajouté ; les adaptations mobiles existantes restent pilotées par `.is-mobile`.

Après build, déploiement dans quatre vaults et rechargement de `quiz-blocks` dans le vault `Efrei`, le modal a été ouvert dans l'application réelle :

- un unique `.qbd-medit-field` est rendu ;
- son contrôle a bien `type === "date"` ;
- champ et parent mesurent chacun `441 px` ;
- le modal mesure `473 px` en `scrollWidth` et `473 px` en `clientWidth`, donc aucun débordement horizontal ;
- la capture réelle montre le champ entre UE et couleur et le texte d'aide correctement replié.

`dev:mobile on` recharge l'instance Obsidian ; le modal a donc été fermé avant que les mesures puissent être répétées sous `.is-mobile`, et le plugin n'était pas encore disponible lors du premier `eval`. Je ne transforme pas cet échec d'observation en faux résultat positif. La couverture Android repose ici sur la structure CSS commune réellement mesurée, l'absence de nouvelle contrainte horizontale et l'usage exclusif de la classe `.is-mobile` existante. L'émulation a été remise sur `off`.

## Ambiguïtés du brief

- La liste initiale des fichiers ne mentionnait pas le CSS, alors que `qbd-medit-hint` n'existait pas et que le brief autorisait explicitement sa création dans ce cas. Résolution : ajout d'une seule règle minimale dans `dashboard-components.css`, sans nouvelle géométrie du formulaire.
- Le brief demandait seulement `npm run check`, tandis que les exigences globales imposaient une preuve comportementale et le contrôleur a ensuite demandé l'enregistrement de `check:module-edit`. Résolution : ajout du script dédié et de son entrée `package.json`.
- `npm run check:export` et `npm run check:md` n'ont pas été lancés : aucun fichier du chemin de lecture ou d'écriture des quiz n'a été touché.

## Vérifications

### Build et déploiement local

```text
> quiz-blocks@1.0.0 build
> node esbuild.config.mjs production

main.js copié dans 4 vault(s).
manifest.json copié dans 4 vault(s).

  dist\styles.css  651.4kb

Done in 55ms
styles.css copié dans 4 vault(s).
styles.css bundlé (tous les @import inlinés).
Build terminé.
```

Le CLI a confirmé `Efrei`, rechargé `quiz-blocks` et retourné `No errors captured.`. `dev:console level=error` n'a pas pu être consulté car le debugger n'était pas attaché.

### `npm run check`

```text
> quiz-blocks@1.0.0 check
> tsc --noEmit
```

Sortie TypeScript silencieuse, code de sortie `0`.

### `npm run check:module-edit`

```text
> quiz-blocks@1.0.0 check:module-edit
> node scripts/check-module-edit.mjs

Modal module — date d'examen : 3/3 cas passent
```

Code de sortie `0`.

### `npm run check:review-store`

```text
> quiz-blocks@1.0.0 check:review-store
> node scripts/check-review-store.mjs

Adaptateur — clé opaque : 1/1 cas passent
Adaptateur — catalogue depuis le scanner : 2/2 cas passent
Adaptateur — chargement concurrent : 1/1 cas passent
Adaptateur — renommage pendant load() : 3/3 cas passent
Adaptateur — erreurs de lecture : 2/2 cas passent
Adaptateur — chemin du journal : 1/1 cas passent
Adaptateur — écritures sérialisées : 3/3 cas passent
Adaptateur — échec d'écriture ne boucle pas : 6/6 cas passent
Adaptateur — renommages pertinents : 7/7 cas passent
Adaptateur — destruction : 4/4 cas passent
Adaptateur — horizon (garde NaN, decision 2) : 1/1 cas passent
```

Code de sortie `0`.

### `npm run check:scheduler`

```text
> quiz-blocks@1.0.0 check:scheduler
> node scripts/check-scheduler.mjs

Ordonnanceur — pureté du noyau : 42/42 cas passent
Ordonnanceur — horizon : 9/9 cas passent
Ordonnanceur — journal : 12/12 cas passent
Ordonnanceur — état dérivé : 24/24 cas passent
Ordonnanceur — plan du jour : 28/28 cas passent
```

Code de sortie `0`.

### `npm run check:scanner`

```text
> quiz-blocks@1.0.0 check:scanner
> node scripts/check-scanner.mjs

Scanner — références des questions : 15/15 cas passent
```

Code de sortie `0`.

### `npm run check:engine-review`

```text
> quiz-blocks@1.0.0 check:engine-review
> node scripts/check-engine-review.mjs

recordReview — garde puits/chemin absent : 3/3 cas passent
recordReview — dédoublonnage (une fois par session) : 2/2 cas passent
recordReview — identifiant manquant (repli qN à l'assemblage) : 2/2 cas passent
recordReview — rôle inclus dès que le bloc est d'origine Leçon (fix 2) : 3/3 cas passent
recordReview — clé dérivée par idsForRawItems, jamais q.id brut : 4/4 cas passent
quiz-ids — idsForRawItems tolère un élément parasite (fix 1) : 2/2 cas passent
goToResults — verdict par question (mode Leçon, rôles mixtes) : 3/3 cas passent
goToResults — le rôle survit à une bascule Leçon → Examen (fix 2) : 2/2 cas passent
goToResults — hors mode Leçon, verdict QCM ordinaire, pas de rôle : 1/1 cas passent
goToResults — double clic (resultsCounted) ne rejournalise rien : 1/1 cas passent
goToResults — le journal ne dépend pas du statsStore (minor) : 2/2 cas passent
goToResults / recordReview — un puits qui lève ne casse rien (minor) : 4/4 cas passent
text-only.ts — le clic sur une note appelle recordReview (fix minor : couverture) : 4/4 cas passent
```

Code de sortie `0`.

### `npm run check:lesson`

```text
> quiz-blocks@1.0.0 check:lesson
> node scripts/check-lesson.mjs

Renommage lesson — mode : 4/4 cas passent
Renommage lesson — contenu : 3/3 cas passent
Boucle d'apprentissage — slice/role/source : 8/8 cas passent
Boucle d'apprentissage — source (ecriture) : 2/2 cas passent
Boucle d'apprentissage — modele de tranches : 11/11 cas passent
Boucle d'apprentissage — accessor suit ctx.quizMode (pas un flag fige) : 3/3 cas passent
Boucle d'apprentissage — visibilite du support par role : 11/11 cas passent
Boucle d'apprentissage — reouverture du support suit textOnlyChecked, pas le verrou global : 3/3 cas passent
Boucle d'apprentissage — resetQuiz remet a zero le repli du support : 5/5 cas passent
Boucle d'apprentissage — l'auto-evaluation suit le role recall, pas un mode global : 6/6 cas passent
Boucle d'apprentissage — isTextOnlyForAny/All (score et ecran de resultats) : 10/10 cas passent
Boucle d'apprentissage — computeResults exclut 'read', comme une auto-evaluation qui n'a rien a evaluer : 4/4 cas passent
Boucle d'apprentissage — en-tete de carte compte en tranches : 21/21 cas passent
Boucle d'apprentissage — role 'read' (aller-retour editeur) : 3/3 cas passent
Boucle d'apprentissage — role 'read' exclu du score et de la completude : 8/8 cas passent
Boucle d'apprentissage — goToResults : questionsDone et totalQuestions comptent le meme ensemble : 2/2 cas passent
Boucle d'apprentissage — payload de resultats : answered et total comptent le meme ensemble : 2/2 cas passent
Boucle d'apprentissage — la pre-question bloque la navigation avant (Task 7) : 19/19 cas passent
Boucle d'apprentissage — goToResults/goToSubmit refusent AVANT tout effet de bord (Task 7, Finding 1) : 12/12 cas passent
Boucle d'apprentissage — markLessonPreSkipped (Task 7, Finding 5) : 7/7 cas passent
Note Quiz vers Lesson (source) — sélection pure : 1/1 cas passent
Note Quiz vers Lesson (source) — toLinkpath : 7/7 cas passent
Note Quiz vers Lesson (source) — resolveQuizSourceRef : 4/4 cas passent
Boucle d'apprentissage — carte 'read' sourcee (round 2, FINDING) : 2/2 cas passent
[Quiz Blocks] JSON5 parse error: JSON5: invalid end of input at 1:17
Créer la note quiz depuis la leçon : 24/24 cas passent
isLessonNoteContentExact — jamais de collision de cache sur le chemin d'exécution : 3/3 cas passent
```

Code de sortie `0`. Le dernier groupe `isLessonNoteContentExact` a bien été exécuté jusqu'à `3/3`.

### Encodage et propreté du diff

`git diff --check` retourne le code `0` sans sortie. Le grep final des trois motifs de double encodage demandés a été exécuté sur tous les fichiers touchés, rapport inclus. Résultat réel : `U+0102`, `U+00C2` et la séquence `U+00E2 U+20AC` retournent chacun le code `1`, sans aucune ligne de sortie, donc aucun match.
