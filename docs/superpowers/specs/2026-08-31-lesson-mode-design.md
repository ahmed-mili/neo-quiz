# Mode Lesson — conception

**Date** : 2026-08-31
**Statut** : conception validée, plan d'implémentation à écrire
**Source de méthode** : `Personal/Productivité/Les meilleures méthodes d'apprentissage.md`
**Maquette jouable** : `Efrei/…/XTI101 …/Chapitre 1 - Lecture guidée (démo méthode).md`

## 1. Le problème

Un PDF de cours de 40 pages est lu en entier, et il n'en reste rien. Le plugin sait
aujourd'hui poser des questions **après** l'étude, il ne sait pas instrumenter
l'étude elle-même.

La littérature (revue de Dunlosky 2013, Szpunar/Khan/Schacter 2013) établit deux
choses. La pratique de récupération est la technique de haute utilité ; et
**découper un cours sans le tester ne produit aucun effet** — ni baisse de la
divagation d'attention, ni gain au test final. L'unité utile n'est donc pas « une
tranche de cours », c'est « une tranche **et son test** ».

Ce document conçoit le mode **Lesson** : un chapitre découpé en tranches, chaque
tranche instrumentée par la boucle en 5 temps.

## 2. Vocabulaire arrêté

| Concept | Fichier | Bouton (EN) | Bouton (FR) | Valeur persistée |
|---|---|---|---|---|
| Apprendre un chapitre | `… — Lesson.md` | Lesson | Leçon | `mode: "lesson"` |
| Se tester dessus | `… — Quiz.md` | Quiz | Quiz | `mode: "quiz"` |

**UN SEUL MOT partout** : fichier, onglet, bouton, valeur persistée, nom de
module, nom de fonction. Le mot est `lesson`.

**Pourquoi `lesson` et pas `learn`** (arbitrage définitif, 2026-08-31). Ce qu'on
nomme ici est un OBJET, pas une action : il est listé, compté, ouvert, partagé.
`lesson` est un nom, donc dénombrable — « 12 lessons », « cette leçon ». `learn`
est un verbe : « 12 learns » n'existe pas. Un nom fait très bien un libellé de
bouton ; un verbe ne peut pas faire un nom d'entité. Le nom couvre les deux
usages, le verbe un seul.

**Écarté** : `learn` (verbe, cf. ci-dessus), `Course` (faux ami — désigne le
cursus entier en anglais), `Study` (désigne en anglais courant la relecture,
précisément ce que le mode remplace), `Lecture` (c'est la technique que la
littérature classe en faible utilité).

### L'héritage `learn`, traité en alias de LECTURE

`mode: "learn"` existe déjà (`QuizMode = "quiz" | "exam" | "learn"`) et sert
**10 notes réelles** ; les champs `learn` / `learnHtml` / `_learnHtml` y sont
écrits **108 fois**. Il affiche aujourd'hui la section « Leçon » avant la question
et un bouton « Passer l'examen » (`src/engine/cards.ts:321,435`).

La règle : **on lit les deux, on n'écrit que `lesson`.**

| Ancien nom | Nouveau nom | Traitement |
|---|---|---|
| `mode: "learn"` | `mode: "lesson"` | accepté en lecture, normalisé en `lesson` |
| `learn` (champ de question) | `lesson` | idem |
| `learnHtml`, `_learnHtml` | `lessonHtml`, `_lessonHtml` | idem |
| `learnMode: true` | `mode: "lesson"` | idem |
| `learnExamOptions` (interne) | `lessonExamOptions` | renommage de code seul |

Aucune note n'est réécrite d'office : une note héritée s'ouvre inchangée, et se
convertit d'elle-même à sa première sauvegarde depuis l'éditeur. **Aucun quiz
partagé ne casse.**

**Décision** : le mode Lesson n'est pas un mode nouveau, il **enrichit** le mode
existant.

- une note en mode lesson **sans** `slice` garde exactement son comportement
  actuel — les 10 notes existantes ne bougent pas ;
- une note en mode lesson **avec** des `slice` active la boucle en 5 temps.

C'est la condition d'activation la plus économe : elle se lit dans les données
elles-mêmes, sans drapeau supplémentaire à tenir à jour.

## 3. Architecture : une source, deux notes

Décision d'Ahmed, 2026-08-31 : **deux fichiers Markdown distincts** pour
l'organisation du vault, mais **une seule source de vérité** pour le contenu.

- `Chapitre 1 — Lesson.md` porte tout : les tranches de cours et les questions.
  C'est le fichier que l'IA génère et que l'on corrige.
- `Chapitre 1 — Quiz.md` ne contient qu'un bloc de référence :

```
[{ mode: "quiz", source: "[[Chapitre 1 — Lesson]]" }]
```

Le moteur lit les questions de la note référencée et n'affiche qu'elles. Corriger
une question dans la note Lesson la corrige dans le Quiz, sans synchronisation.

**Pourquoi pas deux contenus indépendants** : la génération IA serait faite deux
fois, et une correction dans l'un ne profiterait pas à l'autre.

**Pourquoi c'est dans le format** : un objet de configuration dans le tableau
existe déjà (`{ mode: "exam" }`, `findQuizModeConfigIndex`,
`src/quiz-utils.ts:151-161`). Ce n'est pas une entorse, c'est le mécanisme prévu.

### Résolution du lien `source`

Le lien est un wikilink Obsidian résolu par le vault. Trois cas d'échec, tous à
signaler par une Notice explicite, jamais en silence :

1. note introuvable → Notice nommant le lien ;
2. note trouvée mais sans bloc `quiz-blocks` → Notice ;
3. la note référencée référence elle-même une autre note → refus (pas de chaîne).

Une note Quiz qui ne peut pas résoudre sa source affiche un bloc en erreur, avec
le lien cliquable vers la note attendue.

## 4. Le format : deux champs facultatifs par question

Le tableau reste **plat**. Chaque question gagne deux champs optionnels :

| Champ | Valeurs | Rôle |
|---|---|---|
| `slice` | entier ≥ 1 | numéro de la tranche à laquelle la question appartient |
| `role` | `"pre"` \| `"read"` \| `"recall"` \| `"test"` | place dans la boucle |

Correspondance avec la boucle en 5 temps :

| Temps | `role` | Support visible ? |
|---|---|---|
| 1 — pré-question | `pre` | **non** : le cours n'a pas encore été lu |
| 2 — lecture | `read` | **oui**, ouvert : c'est le seul moment où l'on lit |
| 3 — rappel libre | `recall` | **non** pendant la tentative, rouvert après validation |
| 4 + 5 — correction et test ciblé | `test` | rouvrable à la demande |

**CORRECTION DU 2026-09-01.** Ce tableau comprimait auparavant « lecture puis
rappel libre » sur UNE ligne, donc un seul rôle `recall`. C'était intenable :
un rôle ne peut pas être à la fois visible (pour lire) et masqué (pour
restituer). Conséquence constatée après implémentation — l'utilisateur n'avait
**aucune étape de lecture** et se voyait demander de restituer un texte qu'il
n'avait jamais vu. Le rôle `read` sépare les deux moments : une carte qui
montre le support, sans question, avec un bouton pour continuer.

Écarté : faire montrer le support par `recall` jusqu'à la première frappe —
fragile et contournable, il suffit de quitter le champ pour relire.

**Compatibilité ascendante** : une question sans `slice` ni `role` est une
question de quiz ordinaire. Tous les blocs existants du vault (67 quiz, 1176
questions) s'ouvrent inchangés. Un bloc sans aucun `slice` n'a pas de mode Lesson
disponible — le bouton n'apparaît pas.

Le texte de la tranche réutilise `passage` / `passageId` / `passageTitle`, qui
portent déjà « un document, N questions dessus » (`src/types/quiz.ts:56-72`).

## 5. Ce que le mode Lesson fait, que le bloc actuel ne fait pas

1. **Masquer le support pendant la restitution.** Aujourd'hui l'utilisateur replie
   le passage lui-même. En mode Lesson, une question `role: "recall"` masque le
   support tant que la réponse n'est pas validée, puis le rouvre pour la
   comparaison. C'est le temps 3 de la boucle, et il ne vaut rien si le texte
   reste sous les yeux.
2. **Afficher la progression par tranche** — « tranche 2 sur 4 » — et non par
   question. C'est l'unité de la méthode.
3. **Interdire de sauter la pré-question.** Une question `role: "pre"` doit
   recevoir une tentative (même vide et explicitement abandonnée) avant de donner
   accès à la lecture. Chez Richland (2009), c'est la tentative, pas la lecture de
   la question, qui produit l'effet.
4. **Auto-évaluation sur les restitutions** (voir §6).

## 6. Suppression de la bascule « Practice mode »

La bascule globale QCM ⇄ Texte (`practiceMode`, `src/engine/text-only.ts`,
`src/engine/interactions.ts:446`) est **retirée de l'UI du quiz** : elle ferait
doublon avec Lesson / Quiz et porte à confusion.

**Sa mécanique est absorbée, pas supprimée.** Le mode texte est aujourd'hui le
seul endroit du plugin où une réponse libre est jugée par l'utilisateur
(« compris / partiel / à revoir ») et non par comparaison de chaînes. C'est
exactement ce que réclame le temps 3. Après ce lot :

- une question `role: "recall"` s'affiche en réponse libre et se termine par
  l'auto-évaluation, **par conséquence de son rôle**, sans réglage utilisateur ;
- le réglage devient une propriété de la question, plus un état global du quiz.

**Risque à couvrir dans le plan** : `practiceMode` est lu par `results-save.ts`
(nom du fichier de résultats), `state.ts` et `exam.ts`. La valeur doit continuer
d'exister en interne ; c'est le **contrôle** qui disparaît, pas le champ.

## 7. Hors périmètre de ce lot

Explicitement remis à plus tard, pour que ce lot reste livrable :

- l'ordonnanceur de révision (file par question, intervalles, horizon de
  rétention) ;
- la session « une seule chose » du dashboard ;
- le type de question « étape manquante » natif pour le contenu procédural (il est
  aujourd'hui simulé avec `lessonHtml` + un énoncé à trous, ce qui suffit pour
  juger la méthode) ;
- la génération IA d'une note Lesson à partir d'un PDF ;
- le renommage du plugin.

## 8. Décisions prises

- **Le Quiz ne reprend que les questions `role: "test"`** et les questions sans
  rôle. Une restitution privée de son cours n'a plus de référence à laquelle se
  comparer ; une pré-question sans lecture à suivre n'a pas d'objet.
- **Pas de bascule Lesson/Quiz dans le bloc** : le choix est porté par le fichier
  ouvert, conformément à la décision « deux fichiers » d'Ahmed.
- **Une commande crée la note Quiz depuis une note Lesson ouverte**, sinon le bloc de
  référence est écrit à la main à chaque chapitre.

## 9. Reste ouvert (à régler à l'usage, pas par la recherche)

Ce sont les trois paramètres que la littérature ne tranche pas, cf. la note de
méthode :

- la **taille de tranche** (1 à 2 pages est un point de départ ; découper sur les
  frontières sémantiques) ;
- le **nombre de questions par tranche** (3 ou 4, plafonné) ;
- le **seuil** entre exemple résolu et problème autonome pour le contenu
  procédural.

Aucun de ces trois ne bloque l'implémentation : ils sont écrits dans le contenu
des notes, pas dans le code.

## 10. Vérification

- `npm run check` après chaque tâche.
- `npm run check:export` : l'écriture d'un bloc doit conserver `slice`, `role` et
  `source` — un champ perdu rend la Lesson muette.
- `node scripts/audit-vaults.mjs` sur les vrais vaults **avant de clore le lot** :
  c'est le seul filet contre une perte de champ à l'aller-retour, et c'est lui qui
  avait trouvé les 109 champs perdus de la refonte précédente.
- Test manuel dans Obsidian sur `Chapitre 1 — Lesson.md` : la maquette existante
  sert de cas de référence, elle doit se rejouer en mode Lesson sans réécriture de
  son contenu.
