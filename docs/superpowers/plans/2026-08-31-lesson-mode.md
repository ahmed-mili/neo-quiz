# Mode Lesson — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renommer le mode `learn` hérité en `lesson` (un seul mot partout, anciens noms lus en alias) et en faire une vraie boucle d'apprentissage — un chapitre découpé en tranches, chacune enchaînant pré-question, lecture, restitution de mémoire et test ciblé — et permettre à une note Quiz de rejouer les seules questions de test d'une note Lesson.

**Architecture:** Aucun mode nouveau. Le mode existe déjà sous le nom hérité `learn` et sert 10 notes réelles (108 champs `learn`/`learnHtml`) ; il est renommé `lesson`, les anciens noms restant acceptés EN LECTURE (Task 0) ; deux champs facultatifs par question (`slice`, `role`) l'enrichissent sans le remplacer. Une note `lesson` sans `slice` garde son comportement actuel. Une note Quiz porte `{ mode: "quiz", source: "[[…]]" }` et lit les questions de la note référencée.

**Tech Stack:** TypeScript strict (ESM), esbuild, Obsidian API. Pas de framework de test — les vérifications passent par les scripts `scripts/*.mjs` qui chargent le CODE RÉEL via `scripts/lib/load-src.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-31-lesson-mode-design.md`

## Global Constraints

- **Jamais de chaîne visible en dur.** Tout passe par `t("<domaine>.<clé>")`. L'anglais (`src/i18n/en/*.ts`) est le dictionnaire de RÉFÉRENCE ; le français est typé `Record<keyof typeof EN_X, string>` — une traduction oubliée est une erreur de compilation.
- **Ne jamais traduire** les clés du format (`slice`, `role`, `pre`, `recall`, `test`, `source`, `mode`) : ce sont des données persistées dans les notes.
- **`t()` est appelé AU RENDU**, jamais dans une constante top-level.
- **Aucune régression de format** : une question sans `slice` ni `role` reste une question de quiz ordinaire. Les 67 quiz / 1176 questions des vaults doivent se relire ET se réécrire sans perte.
- **Modules < ~350 lignes.** Un nouveau comportement du moteur va dans un module `src/engine/*.ts` dédié, greffé sur `ctx` par une factory `createXHandlers(ctx)`, jamais ajouté à `engine.ts`.
- **Distinction SNAPSHOT vs ACCESSOR** : les flags `__quiz*` sont copiés par valeur à l'assemblage ; tout état vivant se lit par un accessor de closure.
- **`npm run check` après chaque tâche.** `npm run check:export` dès que l'écriture d'un bloc est touchée.
- **Travail sur `main`**, commits directs, jamais de `git push`.

---

### Task 0: Renommage `learn` → `lesson`, anciens noms lus en alias

**Files:**
- Modify: `src/types/quiz.ts` (`QuizMode`, champs `learn*` de `QuestionBase`)
- Modify: `src/quiz-utils.ts` (`normalizeQuizMode`, `QuizModeConfig`, `extractExamOptions` lignes 163-222)
- Modify: `src/engine/cards.ts:321,435` (lecture de `q.learn` / `q.learnHtml`, `ctx.quizMode === "learn"`)
- Modify: `src/engine/text-only.ts` (`learningHtml`)
- Modify: `src/editor/export.ts`, `src/editor/convert.ts`
- Modify: `src/i18n/en/*.ts`, `src/i18n/fr/*.ts` (libellés seulement)
- Create: `scripts/check-lesson.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `QuizMode = "quiz" | "exam" | "lesson"` ; `QuestionBase.lesson?`, `.lessonHtml?`, `._lessonHtml?` ; `ctx.lessonExamOptions`.
- Consumes: rien.

**La règle, non négociable : on LIT les deux, on n'ÉCRIT que `lesson`.** Aucune note
n'est réécrite d'office ; une note héritée s'ouvre inchangée et se convertit à sa
première sauvegarde depuis l'éditeur. Un quiz partagé écrit avec les anciens noms
doit continuer de fonctionner indéfiniment.

| Ancien | Nouveau |
|---|---|
| `mode: "learn"`, `learnMode: true` | `mode: "lesson"` |
| `learn`, `learnHtml`, `_learnHtml` | `lesson`, `lessonHtml`, `_lessonHtml` |
| `learnExamOptions` (interne) | `lessonExamOptions` |

- [ ] **Step 1: Écrire les cas qui échouent**

Créer `scripts/check-lesson.mjs` sur le modèle de `scripts/check-export.mjs` (lire
ce fichier d'abord pour reprendre exactement sa façon d'appeler `withSrcModule`) :

```js
// Le mode hérité est lu et normalisé.
assert.equal(extractExamOptions(parseQuizSource(`[{ mode: "learn" }]`)).quizMode, "lesson");
assert.equal(extractExamOptions(parseQuizSource(`[{ learnMode: true }]`)).quizMode, "lesson");
// Le nom canonique est lu tel quel.
assert.equal(extractExamOptions(parseQuizSource(`[{ mode: "lesson" }]`)).quizMode, "lesson");
// La casse ne doit pas ouvrir une porte : "Lesson" n'est pas un mode.
assert.notEqual(extractExamOptions(parseQuizSource(`[{ mode: "Lesson" }]`)).quizMode, "lesson");
```

Ajouter dans `package.json` : `"check:lesson": "node scripts/check-lesson.mjs"`.

- [ ] **Step 2: Lancer et constater l'échec**

Run: `npm run check:lesson`
Expected: FAIL — `quizMode` vaut encore `"learn"`.

- [ ] **Step 3: Normaliser le mode**

Dans `normalizeQuizMode` (`src/quiz-utils.ts`), faire de `"learn"` un alias qui
retourne `"lesson"`. Adapter `extractExamOptions` : `learnMode === true` produit
`"lesson"`, et `learnExamOptions` est renommé `lessonExamOptions`.

**Attention** : `normalizeQuizMode` sert AUSSI à reconnaître un objet comme
configuration (`isStrictQuizModeConfig`). Un `mode: "learn"` doit rester reconnu
comme configuration, sinon les 10 notes héritées gagnent une question fantôme.

- [ ] **Step 4: Renommer les champs de question, avec fallback**

Dans `src/types/quiz.ts`, ajouter `lesson?`, `lessonHtml?`, `_lessonHtml?` et
**garder** `learn?`, `learnHtml?`, `_learnHtml?` marqués en commentaire comme
alias hérités, lus en fallback.

Partout où le moteur lit ces champs (`src/engine/cards.ts:435`,
`src/engine/text-only.ts`), lire dans l'ordre : `q.lessonHtml || q._lessonHtml ||
q.learnHtml || q._learnHtml || q.lesson || q.learn`. Ne PAS dupliquer cette chaîne
de fallback à plusieurs endroits : l'écrire une fois comme fonction exportée au
niveau module et l'appeler.

- [ ] **Step 5: N'écrire que les nouveaux noms**

Dans `src/editor/export.ts` et `src/editor/convert.ts`, écrire `lesson` /
`lessonHtml` et jamais les anciens. Ajouter dans `scripts/check-export.mjs` :

```js
const written = exportAll([{ prompt: "Q", options: ["a","b"], correctIndex: 0, learnHtml: "<p>L</p>" }], { mode: "learn" });
assert.ok(written.includes("lessonHtml"), "l'ancien nom doit etre converti a l'ecriture");
assert.ok(!written.includes("learnHtml"), "l'ancien nom ne doit plus etre ecrit");
assert.ok(written.includes('mode: "lesson"'), "le mode doit etre normalise a l'ecriture");
```

- [ ] **Step 6: Renommer les libellés d'UI**

Dans les dictionnaires EN/FR, les libellés visibles disent « Lesson » / « Leçon ».
Les **clés** i18n peuvent être renommées librement (elles ne sont pas persistées),
mais les deux dictionnaires doivent bouger ensemble — le FR est typé
`Record<keyof typeof EN_X, string>`, un renommage d'un seul côté est une erreur de
compilation.

**Ne PAS renommer** les `id:` de commandes existantes : les hotkeys de
l'utilisateur y sont attachées.

- [ ] **Step 7: Vérifier**

Run: `npm run check && npm run check:lesson && npm run check:export && npm run check:md`
Expected: les quatre passent.

- [ ] **Step 8: Vérifier sur les VRAIS vaults**

Run: `node scripts/audit-vaults.mjs "C:\obsidian-vaults\Efrei" "C:\obsidian-vaults\Personal"`
Expected: aucun champ perdu. C'est le contrôle qui protège les 108 champs hérités —
un fallback oublié les fait disparaître en silence à la première sauvegarde.

- [ ] **Step 9: Vérifier dans Obsidian**

`npm run build`, puis `obsidian plugin:reload id=quiz-blocks` en PowerShell (le CLI
renvoie un exit 127 muet sur une sous-commande à deux-points depuis l'outil Bash).
Ouvrir une des 10 notes héritées : la section « Leçon » s'affiche comme avant.

- [ ] **Step 10: Commit**

```bash
git add src scripts package.json
git commit -m "refactor(lesson): renommage learn vers lesson, anciens noms lus en alias"
```

---

### Task 1: Les champs `slice` et `role` dans le format

**Files:**
- Modify: `src/types/quiz.ts` (interface `QuestionBase`, autour de la ligne 34)
- Modify: `src/quiz-utils.ts` (interface `QuizModeConfig` lignes 12-19, `isStrictQuizModeConfig` lignes 104-141)
- Modify: `scripts/check-lesson.mjs` (créé en Task 0)

**Interfaces:**
- Produces: `QuestionRole = "pre" | "recall" | "test"` exporté depuis `src/types/quiz.ts` ; `QuestionBase.slice?: number` ; `QuestionBase.role?: QuestionRole` ; `QuizModeConfig.source?: string`.
- Consumes: rien.

- [ ] **Step 1: Écrire la vérification qui échoue**

Ajouter dans `scripts/check-lesson.mjs` (créé en Task 0) :

```js
// Le bloc d'une Lesson porte slice/role ; parseQuizSource doit les rendre tels quels.
const src = `[
  { id: "a", slice: 1, role: "pre",    prompt: "P ?", type: "text", answer: "x" },
  { id: "b", slice: 1, role: "recall", prompt: "R ?", type: "text", answer: "y", passage: "Texte." },
  { id: "c", slice: 1, role: "test",   prompt: "T ?", options: ["1","2"], correctIndex: 0 },
  { mode: "lesson" }
]`;
const { parseQuizSource, extractExamOptions } = mod;
const parsed = parseQuizSource(src);
const { questions, quizMode } = extractExamOptions(parsed);
assert.equal(quizMode, "lesson");
assert.equal(questions.length, 3, "la configuration ne doit pas compter comme une question");
assert.deepEqual(questions.map(q => q.role), ["pre", "recall", "test"]);
assert.deepEqual(questions.map(q => q.slice), [1, 1, 1]);
```

- [ ] **Step 2: Lancer la vérification et constater l'échec**

Run: `npm run check:lesson`
Expected: échec — `role`/`slice` sont absents du type, et surtout `{ mode: "lesson" }` risque d'être compté comme question si la règle de reconnaissance change.

- [ ] **Step 3: Déclarer les champs**

Dans `src/types/quiz.ts`, à la suite de `passageTitle?: string;` dans `QuestionBase` :

```ts
/**
 * BOUCLE D'APPRENTISSAGE (mode "lesson") — numéro de tranche, à partir de 1.
 * Absent ⇒ question de quiz ordinaire. Un bloc où AUCUNE question ne porte
 * `slice` n'active pas la boucle : le mode lesson garde son comportement
 * historique (section « Leçon » + bouton d'examen).
 */
slice?: number;
/**
 * Place de la question dans la boucle en 5 temps :
 *   "pre"    — posée AVANT la lecture, support masqué, la tentative est le mécanisme ;
 *   "recall" — restitution de mémoire, support masqué puis rouvert à la correction ;
 *   "test"   — question ciblée d'après lecture, support rouvrable à la demande.
 * Absent ⇒ traitée comme "test".
 */
role?: QuestionRole;
```

Et au-dessus de `QuestionBase` :

```ts
/** Rôles de la boucle d'apprentissage. Valeurs PERSISTÉES : jamais traduites. */
export type QuestionRole = "pre" | "recall" | "test";
```

Dans `src/quiz-utils.ts`, ajouter `source?: string;` à `QuizModeConfig`.

- [ ] **Step 4: Vérifier que la configuration reste reconnue**

`isStrictQuizModeConfig` (`src/quiz-utils.ts:104`) liste les MARQUEURS qui disqualifient un objet comme configuration. `slice`, `role` et `source` n'y sont pas et ne doivent PAS y être ajoutés : une configuration a le droit de porter `source`, et une question porte `slice`/`role` mais aussi toujours un vrai marqueur (`options`, `answer`…). Relire la fonction et confirmer par le cas suivant, à ajouter dans `check-lesson.mjs` :

```js
// Une configuration qui porte `source` reste une configuration, pas une question.
const q = parseQuizSource(`[{ mode: "quiz", source: "[[Chapitre 1 — Lesson]]" }]`);
const r = extractExamOptions(q);
assert.equal(r.questions.length, 0, "un bloc de référence n'a aucune question propre");
assert.equal(r.quizMode, "quiz");
```

- [ ] **Step 5: Lancer les vérifications**

Run: `npm run check && npm run check:lesson && npm run check:export`
Expected: les trois passent.

- [ ] **Step 6: Commit**

```bash
git add src/types/quiz.ts src/quiz-utils.ts scripts/check-lesson.mjs
git commit -m "feat(lesson): champs slice/role sur les questions et source sur la configuration"
```

---

### Task 2: L'export conserve `slice`, `role` et `source`

**Files:**
- Modify: `src/editor/export.ts`
- Modify: `scripts/check-export.mjs`

**Interfaces:**
- Consumes: `QuestionBase.slice`, `QuestionBase.role`, `QuizModeConfig.source` (Task 1).
- Produces: rien de nouveau — un invariant.

**Pourquoi cette tâche existe** : `exportAll` réécrit le bloc à chaque sauvegarde depuis l'éditeur. Un champ non listé y disparaît EN SILENCE. C'est exactement ce qui avait effacé les 23 invites de terminal d'un quiz Cisco (`textVariant: 'command'` non reconnu). Sans cette tâche, éditer une Lesson la transforme en quiz plat.

- [ ] **Step 1: Écrire le cas qui échoue**

Dans `scripts/check-export.mjs`, ajouter :

```js
// Un aller-retour sur une question de Lesson conserve slice et role.
const question = { id: "b", slice: 2, role: "recall", prompt: "R ?", type: "text", answer: "y" };
const written = exportAll([question], { mode: "lesson" });
assert.ok(written.includes("slice: 2"), "slice perdu à l'écriture");
assert.ok(written.includes('role: "recall"'), "role perdu à l'écriture");
```

Adapter la signature exacte de `exportAll` à ce que le fichier utilise déjà — la lire avant d'écrire le cas.

- [ ] **Step 2: Lancer et constater l'échec**

Run: `npm run check:export`
Expected: FAIL, « slice perdu à l'écriture ».

- [ ] **Step 3: Ajouter les champs à l'export**

Dans `src/editor/export.ts`, ajouter `slice` et `role` à la liste des champs écrits, à côté de `passageId`/`passageTitle`, en respectant l'ordre de sortie existant. Écrire `slice` seulement s'il est un entier ≥ 1, et `role` seulement s'il vaut `"pre"`, `"recall"` ou `"test"` — jamais une valeur inconnue recopiée telle quelle.

- [ ] **Step 4: Vérifier**

Run: `npm run check:export && npm run check`
Expected: PASS.

- [ ] **Step 5: Vérifier sur les VRAIS quiz**

Run: `node scripts/audit-vaults.mjs "C:\obsidian-vaults\Efrei" "C:\obsidian-vaults\Personal"`
Expected: aucun champ perdu, tous les blocs se relisent. Ce contrôle est le seul filet contre une perte silencieuse ; ne pas le sauter au motif que le cas ci-dessus passe.

- [ ] **Step 6: Commit**

```bash
git add src/editor/export.ts scripts/check-export.mjs
git commit -m "fix(lesson): l'export conserve slice et role"
```

---

### Task 3: Le découpage en tranches, dérivé des questions

**Files:**
- Create: `src/engine/lesson.ts`
- Modify: `src/types/engine-ctx.ts`
- Modify: `src/engine.ts` (assemblage du `ctx` : instanciation de la factory puis `Object.assign`)
- Modify: `scripts/check-lesson.mjs`

**Interfaces:**
- Consumes: `QuizQuestion[]` avec `slice`/`role` (Task 1), `ctx.quizMode`.
- Produces, greffé sur `ctx` :
  - `isLessonMode(): boolean` — accessor, vrai si `quizMode === "lesson"` ET au moins une question porte un `slice` valide.
  - `lessonSlices(): ReadonlyArray<{ index: number; questionIndexes: number[] }>` — tranches ordonnées par `slice` croissant, chacune portant les index de ses questions dans l'ordre du tableau.
  - `sliceOfQuestion(qi: number): number | null` — position 1-based de la tranche dans `lessonSlices()`, ou `null` hors mode Lesson.
  - `roleOfQuestion(qi: number): QuestionRole` — `role` de la question, `"test"` par défaut.

**Note d'architecture** : `isLessonMode` est un ACCESSOR, pas un flag `__quiz*` copié par valeur. Le mode ne change pas en cours de vie du bloc, mais la règle du projet est que tout ce qui décrit l'état se lit par closure ; un flag ici deviendrait faux le jour où un bloc se re-rend sans se reconstruire.

- [ ] **Step 1: Écrire les cas qui échouent**

Dans `scripts/check-lesson.mjs` :

```js
// Les tranches sont dérivées des questions, dans l'ordre des numéros de slice.
const src = `[
  { slice: 1, role: "pre",    prompt: "A", type: "text", answer: "x" },
  { slice: 2, role: "test",   prompt: "D", options: ["1","2"], correctIndex: 0 },
  { slice: 1, role: "recall", prompt: "B", type: "text", answer: "y" },
  { slice: 1, role: "test",   prompt: "C", options: ["1","2"], correctIndex: 0 },
  { mode: "lesson" }
]`;
const lesson = buildLessonModel(extractExamOptions(parseQuizSource(src)).questions, "lesson");
assert.equal(lesson.isLesson, true);
assert.equal(lesson.slices.length, 2);
assert.deepEqual(lesson.slices[0].questionIndexes, [0, 2, 3], "la tranche 1 garde l'ordre du tableau");
assert.deepEqual(lesson.slices[1].questionIndexes, [1]);
assert.equal(lesson.sliceOf(1), 2, "la question d'index 1 appartient à la 2e tranche");
assert.equal(lesson.roleOf(1), "test");

// Un mode lesson SANS slice garde le comportement historique : pas de boucle.
const legacy = `[{ prompt: "Q", options: ["1","2"], correctIndex: 0, lesson: "Leçon" }, { mode: "lesson" }]`;
assert.equal(buildLessonModel(extractExamOptions(parseQuizSource(legacy)).questions, "lesson").isLesson, false);

// Un slice mal formé est ignoré, il ne crée pas de tranche fantôme.
const sale = `[{ slice: 0, prompt: "Q", options: ["1","2"], correctIndex: 0 }, { mode: "lesson" }]`;
assert.equal(buildLessonModel(extractExamOptions(parseQuizSource(sale)).questions, "lesson").isLesson, false);
```

- [ ] **Step 2: Lancer et constater l'échec**

Run: `npm run check:lesson`
Expected: FAIL — `buildLessonModel` n'existe pas.

- [ ] **Step 3: Écrire le module**

Créer `src/engine/lesson.ts` avec une fonction PURE exportée au niveau du module (testable sans `ctx`) et la factory qui l'enveloppe :

```ts
import type { QuizQuestion, QuestionRole } from "../types/quiz";

export interface LessonSlice { index: number; questionIndexes: number[] }
export interface LessonModel {
	isLesson: boolean;
	slices: LessonSlice[];
	sliceOf(qi: number): number | null;
	roleOf(qi: number): QuestionRole;
}

/** Entier ≥ 1, et rien d'autre : « 2 » (chaîne) ou 0 ne font pas une tranche. */
function normalizeSlice(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

const ROLES: readonly QuestionRole[] = ["pre", "recall", "test"];

export function buildLessonModel(questions: readonly QuizQuestion[], quizMode: string): LessonModel {
	const numbers = new Map<number, number[]>();
	questions.forEach((q, qi) => {
		const s = normalizeSlice((q as { slice?: unknown }).slice);
		if (s === null) return;
		const bucket = numbers.get(s);
		if (bucket) bucket.push(qi); else numbers.set(s, [qi]);
	});

	const slices: LessonSlice[] = [...numbers.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([, questionIndexes], i) => ({ index: i + 1, questionIndexes }));

	const isLesson = quizMode === "lesson" && slices.length > 0;

	const positionOf = new Map<number, number>();
	slices.forEach(s => s.questionIndexes.forEach(qi => positionOf.set(qi, s.index)));

	return {
		isLesson,
		slices,
		sliceOf: qi => (isLesson ? positionOf.get(qi) ?? null : null),
		roleOf: qi => {
			const r = (questions[qi] as { role?: unknown } | undefined)?.role;
			return typeof r === "string" && (ROLES as readonly string[]).includes(r) ? r as QuestionRole : "test";
		}
	};
}
```

Puis `createLessonHandlers(ctx)` qui construit le modèle une fois et expose `isLessonMode()`, `lessonSlices()`, `sliceOfQuestion(qi)`, `roleOfQuestion(qi)` — tous en closures lisant le modèle.

- [ ] **Step 4: Greffer sur le ctx**

Déclarer les quatre méthodes dans `src/types/engine-ctx.ts` (avec le commentaire de plage de lignes, comme les autres blocs du fichier), instancier la factory dans `src/engine.ts` au même endroit que les 17 autres et l'inclure dans l'`Object.assign` d'aplatissement.

- [ ] **Step 5: Vérifier**

Run: `npm run check && npm run check:lesson`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/lesson.ts src/types/engine-ctx.ts src/engine.ts scripts/check-lesson.mjs
git commit -m "feat(lesson): modele de tranches derive des questions"
```

---

### Task 4: Le support suit le rôle de la question

**Files:**
- Modify: `src/engine/passage.ts`
- Modify: `src/engine/cards.ts` (rendu de la carte, autour de la ligne 435)
- Modify: `scripts/check-lesson.mjs`

**Interfaces:**
- Consumes: `ctx.isLessonMode()`, `ctx.roleOfQuestion(qi)` (Task 3).
- Produces: `ctx.passageVisibilityFor(qi): "hidden" | "open" | "collapsible"` — décision unique, lue par le rendu.

**La règle** :

| `role` | Visibilité | Pourquoi |
|---|---|---|
| `pre` | `hidden` — le support n'est pas rendu du tout | la question est posée AVANT la lecture ; l'afficher détruit le mécanisme (Richland 2009) |
| `recall` | `hidden` tant que la question n'est pas verrouillée, `open` ensuite | le temps 3 ne vaut rien si le texte reste sous les yeux ; il se rouvre pour la comparaison |
| `test` | `collapsible`, replié par défaut | rouvrable à la demande, jamais réaffiché d'office |

Hors mode Lesson, la visibilité est celle d'aujourd'hui — ne pas modifier le comportement existant.

- [ ] **Step 1: Écrire les cas qui échouent**

Ajouter dans `scripts/check-lesson.mjs` un cas par ligne du tableau, en appelant la fonction pure sous-jacente (l'extraire du module `passage.ts` au niveau module si elle a besoin d'être testée sans DOM) :

```js
assert.equal(passageVisibility({ role: "pre",    locked: false, isLesson: true }), "hidden");
assert.equal(passageVisibility({ role: "recall", locked: false, isLesson: true }), "hidden");
assert.equal(passageVisibility({ role: "recall", locked: true,  isLesson: true }), "open");
assert.equal(passageVisibility({ role: "test",   locked: false, isLesson: true }), "collapsible");
assert.equal(passageVisibility({ role: "recall", locked: false, isLesson: false }), "collapsible");
```

- [ ] **Step 2: Lancer et constater l'échec**

Run: `npm run check:lesson`
Expected: FAIL — `passageVisibility` n'existe pas.

- [ ] **Step 3: Implémenter**

Écrire `passageVisibility` comme fonction pure au niveau module dans `src/engine/passage.ts`, l'exposer sur `ctx` via `passageVisibilityFor(qi)`, et brancher le rendu de la carte dessus. Le cas `hidden` ne doit PAS rendre le HTML du support puis le cacher en CSS : ne rien rendre du tout, sinon le texte est lisible dans l'inspecteur et par la sélection au clavier.

- [ ] **Step 4: Vérifier**

Run: `npm run check && npm run check:lesson && npm run check:markers`
Expected: PASS. `check:markers` est requis ici : le support est un champ TEXTE, et un changement de chemin de rendu est exactement le genre de modification qui fait passer un champ à côté de la fonction de rendu.

- [ ] **Step 5: Vérifier dans Obsidian**

Run: `npm run build` puis `obsidian plugin:reload id=quiz-blocks` (en PowerShell — le CLI Obsidian renvoie un exit 127 muet sur une sous-commande à deux-points depuis l'outil Bash).
Ouvrir la note de démo, vérifier de visu qu'une question `pre` n'affiche aucun support et qu'une `recall` le fait apparaître après validation.

- [ ] **Step 6: Commit**

```bash
git add src/engine/passage.ts src/engine/cards.ts scripts/check-lesson.mjs
git commit -m "feat(lesson): visibilite du support selon le role de la question"
```

---

### Task 5: La restitution s'auto-évalue, sans bascule globale

**Files:**
- Modify: `src/engine/text-only.ts`
- Modify: `src/engine/cards.ts` (`modeToggleHtml`, lignes 68-80)
- Modify: `src/engine/interactions.ts` (`bindModeToggleControls`, lignes 441-462)
- Modify: `src/i18n/en/engine.ts`, `src/i18n/fr/engine.ts`

**Interfaces:**
- Consumes: `ctx.roleOfQuestion(qi)`, `ctx.isLessonMode()`.
- Produces: rien de nouveau sur `ctx` ; un changement de condition d'affichage.

**Ce qui change** : le rendu en réponse libre + auto-évaluation (« compris / partiel / à revoir ») ne dépend plus de `quizState.practiceMode` mais du rôle de la question. Une question `recall` s'y affiche toujours ; les autres jamais.

**Ce qui ne change PAS** : le champ `quizState.practiceMode` reste, avec sa valeur. Il est lu par `results-save.ts` (nom du fichier de résultats), `state.ts` et `exam.ts`. Seul le CONTRÔLE disparaît.

- [ ] **Step 1: Retirer le contrôle**

Supprimer le bouton produit par `modeToggleHtml()` (`src/engine/cards.ts:68`) et l'appel qui l'insère. Laisser `bindModeToggleControls` en place : il ne trouvera plus de `[data-quiz-mode]` et ne fera rien, ce qui évite de casser `bindStartModeControls` qui partage le même chemin.

- [ ] **Step 2: Brancher l'auto-évaluation sur le rôle**

Dans `src/engine/text-only.ts`, remplacer `isTextOnlyMode()` — qui lit `ctx.quizState?.practiceMode === "text"` — par une décision par question : vrai si `ctx.isLessonMode() && ctx.roleOfQuestion(qi) === "recall"`, OU si `practiceMode === "text"` (chemin historique conservé pour les blocs hors Lesson qui l'activent par leur configuration).

Attention : `isTextOnlyMode()` est appelé sans `qi` à plusieurs endroits. Introduire `isTextOnlyFor(qi: number)` et ne remplacer que les appels qui ont un `qi` sous la main ; laisser `isTextOnlyMode()` pour les décisions globales (mode examen).

- [ ] **Step 3: Vérifier la compilation et les chemins qui lisent practiceMode**

Run: `npm run check`
Puis relire les trois consommateurs et confirmer qu'aucun ne dépend du bouton retiré :
`grep -n "practiceMode" src/engine/results-save.ts src/engine/state.ts src/engine/exam.ts`

- [ ] **Step 4: Nettoyer les traductions devenues mortes**

Retirer `engine.mode.switchOn` / `engine.mode.switchOff` des dictionnaires EN et FR **seulement si** aucun autre appel ne les utilise (`grep -rn "mode.switch" src/`). Le typage FR étant `Record<keyof typeof EN_X, string>`, retirer la clé d'un seul côté est une erreur de compilation — les deux ou aucun.

- [ ] **Step 5: Vérifier dans Obsidian**

`npm run build`, rechargement, puis ouvrir un quiz ORDINAIRE (hors Lesson) : la bascule a disparu et le quiz fonctionne. Ouvrir la note de démo : la restitution propose la saisie libre et les trois boutons d'auto-évaluation.

- [ ] **Step 6: Commit**

```bash
git add src/engine/text-only.ts src/engine/cards.ts src/engine/interactions.ts src/i18n
git commit -m "feat(lesson): l'auto-evaluation suit le role recall, retrait de la bascule Practice mode"
```

---

### Task 6: La progression se compte en tranches

**Files:**
- Modify: `src/engine/cards.ts` (en-tête de carte)
- Modify: `src/i18n/en/engine.ts`, `src/i18n/fr/engine.ts`

**Interfaces:**
- Consumes: `ctx.isLessonMode()`, `ctx.sliceOfQuestion(qi)`, `ctx.lessonSlices()`.

- [ ] **Step 1: Ajouter les clés de traduction**

Dans `src/i18n/en/engine.ts` :

```ts
lesson: {
	sliceProgress: "Slice {current} of {total}",
	rolePre: "Before reading",
	roleRecall: "From memory",
	roleTest: "Check"
}
```

Dans `src/i18n/fr/engine.ts`, les mêmes clés : « Tranche {current} sur {total} », « Avant la lecture », « De mémoire », « Vérification ».

- [ ] **Step 2: Afficher la progression**

En mode Lesson, l'en-tête de carte affiche la tranche courante et son total à la place du compteur de questions. Le libellé du rôle apparaît en second, comme sous-titre. Hors mode Lesson, l'en-tête ne change pas.

Appeler `t()` AU RENDU, dans la fonction qui construit le HTML — jamais dans une constante de module.

- [ ] **Step 3: Vérifier**

Run: `npm run check`
Puis `npm run build`, rechargement, et vérifier de visu sur la note de démo que la première tranche affiche « Tranche 1 sur 4 » et non « Question 1 sur 16 ».

- [ ] **Step 4: Commit**

```bash
git add src/engine/cards.ts src/i18n
git commit -m "feat(lesson): progression comptee en tranches"
```

---

### Task 7: La pré-question ne peut pas être sautée

**Files:**
- Modify: `src/engine/interactions.ts` (navigation)
- Modify: `src/i18n/en/engine.ts`, `src/i18n/fr/engine.ts`

**Interfaces:**
- Consumes: `ctx.isLessonMode()`, `ctx.roleOfQuestion(qi)`.

**La règle** : en mode Lesson, la navigation vers la question suivante est refusée tant qu'une question `role: "pre"` n'a pas reçu de tentative. Une tentative VIDE compte, à condition d'être explicite : un second bouton « Je ne sais pas » verrouille la question et laisse passer. C'est la seule concession — chez Richland, c'est la tentative qui produit l'effet, mais forcer un texte non vide ferait taper n'importe quoi.

- [ ] **Step 1: Ajouter les clés**

EN : `lesson.skipBlocked: "Answer first — getting it wrong is the point."`, `lesson.dontKnow: "I don't know"`.
FR : « Réponds d'abord — se tromper fait partie de la méthode. », « Je ne sais pas ».

- [ ] **Step 2: Bloquer la navigation**

Dans le gestionnaire de navigation « suivant », si `ctx.isLessonMode()` et `ctx.roleOfQuestion(qi) === "pre"` et que la question n'est pas verrouillée, ne pas naviguer et afficher une Notice avec `t("engine.lesson.skipBlocked")`.

Ne bloquer QUE la navigation avant ; le retour en arrière reste libre.

- [ ] **Step 3: Ajouter le bouton « Je ne sais pas »**

Rendu uniquement sur une question `role: "pre"` en mode Lesson. Il verrouille la question comme une validation ordinaire, avec une réponse vide.

- [ ] **Step 4: Vérifier**

Run: `npm run check`, puis build + rechargement. Sur la note de démo : tenter de passer la tranche 1 sans répondre → refus + Notice ; cliquer « Je ne sais pas » → la lecture s'ouvre.

- [ ] **Step 5: Commit**

```bash
git add src/engine/interactions.ts src/engine/cards.ts src/i18n
git commit -m "feat(lesson): la pre-question exige une tentative"
```

---

### Task 8: Une note Quiz qui pointe vers une Lesson

**Files:**
- Modify: `src/plugin.ts` (processeur de bloc, lignes 1086-1121)
- Create: `src/quiz-source-ref.ts`
- Modify: `src/i18n/en/plugin.ts`, `src/i18n/fr/plugin.ts`
- Modify: `scripts/check-lesson.mjs`

**Interfaces:**
- Consumes: `QuizModeConfig.source` (Task 1), `QUIZ_BLOCK_RE` (`src/quiz-utils.ts`), `QuestionBase.role`.
- Produces: `resolveQuizSourceRef(app, ref, fromPath): Promise<{ questions: QuizQuestion[] } | { error: "not-found" | "no-block" | "chained"; link: string }>`.

**Règles non négociables** :
- La lecture du bloc de la note cible passe par `QUIZ_BLOCK_RE`, **jamais** par un regex écrit sur place — les regex `\n` stricts ratent les notes CRLF, et c'est un piège déjà payé une fois.
- Une note Quiz ne reprend que les questions dont `role` vaut `"test"` **ou est absent**. Une `pre` sans lecture à suivre n'a pas d'objet ; une `recall` sans son cours n'a plus de référence.
- Pas de chaîne : si la note cible porte elle-même un `source`, refuser avec `error: "chained"`.
- Tout échec produit une Notice nommant le lien, jamais un bloc vide silencieux.

- [ ] **Step 1: Écrire les cas qui échouent**

Dans `scripts/check-lesson.mjs`, tester la fonction PURE de filtrage (celle qui n'a pas besoin de l'app Obsidian) :

```js
const source = [
  { slice: 1, role: "pre",    prompt: "A", type: "text", answer: "x" },
  { slice: 1, role: "recall", prompt: "B", type: "text", answer: "y" },
  { slice: 1, role: "test",   prompt: "C", options: ["1","2"], correctIndex: 0 },
  { prompt: "D", options: ["1","2"], correctIndex: 0 }
];
assert.deepEqual(selectQuizQuestions(source).map(q => q.prompt), ["C", "D"]);
```

- [ ] **Step 2: Lancer et constater l'échec**

Run: `npm run check:lesson`
Expected: FAIL — `selectQuizQuestions` n'existe pas.

- [ ] **Step 3: Écrire le module**

`src/quiz-source-ref.ts` contient `selectQuizQuestions` (pure) et `resolveQuizSourceRef` (asynchrone, prend l'`app`). La résolution du wikilink utilise `app.metadataCache.getFirstLinkpathDest(linkpath, fromPath)` après avoir retiré les crochets et un éventuel alias `|`.

- [ ] **Step 4: Brancher le processeur**

Dans `src/plugin.ts`, après `parseQuizSource(source)` : si la configuration porte un `source`, résoudre, puis passer les questions obtenues à `renderInteractiveQuiz`. En cas d'erreur, afficher dans le bloc un message avec le lien, en plus de la Notice.

- [ ] **Step 5: Ajouter les traductions**

EN : `plugin.sourceRef.notFound: "Quiz source not found: {link}"`, `.noBlock: "No quiz-blocks block in {link}"`, `.chained: "{link} points to another note — chained references are not supported"`.
FR : les équivalents.

- [ ] **Step 6: Vérifier**

Run: `npm run check && npm run check:lesson`, puis build + rechargement. Créer à la main `Chapitre 1 — Quiz.md` avec le bloc de référence et vérifier qu'il affiche les seules questions de test. Renommer temporairement la cible pour vérifier la Notice d'erreur.

- [ ] **Step 7: Commit**

```bash
git add src/quiz-source-ref.ts src/plugin.ts src/i18n scripts/check-lesson.mjs
git commit -m "feat(lesson): une note Quiz rejoue les questions de test d'une Lesson"
```

---

### Task 9: La commande qui crée la note Quiz

**Files:**
- Modify: `src/plugin.ts` (enregistrement des commandes)
- Modify: `src/i18n/en/plugin.ts`, `src/i18n/fr/plugin.ts`

**Interfaces:**
- Consumes: `QUIZ_BLOCK_RE`, `extractExamOptions`.

**Comportement** : depuis une note dont le bloc porte `mode: "lesson"`, la commande crée à côté une note nommée d'après la Lesson, avec le suffixe remplacé (`— Lesson` devient `— Quiz`, sinon `<nom> — Quiz`), contenant le seul bloc de référence. Si la note existe déjà, l'ouvrir au lieu de l'écraser.

**L'`id` de la commande ne change jamais** une fois publié : les hotkeys de l'utilisateur y sont attachées.

- [ ] **Step 1: Enregistrer la commande**

`id: "create-quiz-from-lesson"`, nom traduit. `checkCallback` qui n'expose la commande que si la note active contient un bloc `quiz-blocks` en `mode: "lesson"`.

- [ ] **Step 2: Écrire la note**

Utiliser `app.vault.create`. Contenu :

````
```quiz-blocks
[{ mode: "quiz", source: "[[<nom de la Lesson>]]" }]
```
````

- [ ] **Step 3: Traductions**

EN : `plugin.command.createQuizFromLesson: "Create quiz note from this lesson"`. FR : « Créer la note quiz depuis cette leçon ».

- [ ] **Step 4: Vérifier**

`npm run check`, build, rechargement. Lancer la commande depuis la note de démo, vérifier la création puis le contenu, relancer pour vérifier qu'elle ouvre au lieu d'écraser.

- [ ] **Step 5: Commit**

```bash
git add src/plugin.ts src/i18n
git commit -m "feat(lesson): commande de creation de la note quiz"
```

---

### Task 10: La note de démo devient une vraie Lesson, et audit final

**Files:**
- Modify: `C:\obsidian-vaults\Efrei\…\XTI101 …\Chapitre 1 - Lecture guidée (démo méthode).md`
- Modify: `docs/superpowers/specs/2026-08-31-lesson-mode-design.md` (statut)

- [ ] **Step 1: Ajouter `slice` et `role` aux questions de la démo**

Tranche 1 = `t1-*`, tranche 2 = `t2-*`, etc. Rôles : `pre` sur les `*-pre`, `recall` sur les `*-rappel`, `test` sur les `*-q1`/`*-q2`. Ajouter `{ mode: "lesson" }` en fin de tableau. Le bloc procédural reste un quiz ordinaire (il n'a pas de tranches).

Retirer du texte de la note le callout « Limites assumées de cette maquette » : masquage, progression et auto-évaluation ne sont plus des limites.

- [ ] **Step 2: Vérifier que le bloc se relit**

Run: `node -e` avec `JSON5.parse` sur les deux blocs extraits, comme au premier jet.
Expected: les deux blocs parsent.

- [ ] **Step 3: Rejouer la démo en entier dans Obsidian**

Les quatre tranches, du début à la fin. Vérifier : support absent sur les `pre`, masqué puis rouvert sur les `recall`, repliable sur les `test` ; progression en tranches ; blocage de la navigation ; auto-évaluation sur les restitutions.

- [ ] **Step 4: Audit des vrais vaults**

Run: `node scripts/audit-vaults.mjs "C:\obsidian-vaults\Efrei" "C:\obsidian-vaults\Personal"`
Expected: aucun champ perdu, aucun bloc illisible. **C'est la porte de sortie du lot** : les 10 notes en `mode: "lesson"` doivent s'y comporter comme avant.

- [ ] **Step 5: Build final et commit**

```bash
npm run check && npm run check:md && npm run check:export && npm run check:lesson && npm run check:markers && npm run build
git add docs/superpowers/specs/2026-08-31-lesson-mode-design.md
git commit -m "docs(lesson): mode Lesson implemente, spec close"
```

---

## Auto-revue du plan

**Couverture de la spec** : §2 vocabulaire → Tasks 1 et 6 (l'UI dit Lesson/Lesson) ; §3 deux notes une source → Task 8 ; §4 format → Tasks 1 et 2 ; §5.1 masquage → Task 4 ; §5.2 progression → Task 6 ; §5.3 pré-question → Task 7 ; §5.4 et §6 auto-évaluation → Task 5 ; §8 commande → Task 9 ; §10 vérification → Tasks 2, 4 et 10.

**Point non couvert, assumé** : la spec §3 prévoit un bloc « en erreur avec lien cliquable ». La Task 8 rend un message texte avec le lien, pas un lien cliquable — le rendu d'un wikilink dans un bloc de code demande `MarkdownRenderer.render`, ce qui alourdirait la tâche sans bénéfice réel. À revoir si l'erreur se produit souvent à l'usage.

**Cohérence des noms** : `slice` / `role` / `source` partout ; `buildLessonModel`, `passageVisibility`, `selectQuizQuestions`, `resolveQuizSourceRef` sont chacun définis dans une tâche avant d'être consommés dans la suivante.
