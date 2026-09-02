# Ordonnanceur de révision — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** décider, à partir de l'historique des réponses et d'un horizon de rétention, quelles questions sont dues aujourd'hui et dans quel ordre les poser — dans un module de logique pure réutilisable tel quel par les futures applications PC et Android.

**Architecture:** un noyau pur (`src/scheduler/`) qui ne connaît ni Obsidian, ni écran, ni horloge, et reçoit tout en paramètre ; un journal d'événements JSONL en ajout seul, dont l'état de planification est **dérivé à la volée** plutôt que persisté ; un adaptateur Obsidian jetable (`src/dashboard/review-store.ts`) qui lit et écrit les octets, construit le catalogue depuis le scanner, et branche le moteur.

**Tech Stack:** TypeScript strict (ESM), esbuild, `scripts/lib/load-src.mjs` pour charger le code réel dans Node. Aucun framework de test : les vérifications sont des scripts `scripts/check-*.mjs` avec `makeReporter`.

**Spec:** `docs/superpowers/specs/2026-09-02-scheduler-design.md`

## Global Constraints

- **Travail sur `main`, commits directs, jamais de `git push`.**
- **Ne pas toucher `src/assets/css/dashboard/dashboard-ai.css`** (modification personnelle hors chantier).
- **Commentaires en français, documentant le POURQUOI**, jamais la paraphrase du code.
- **Aucune chaîne visible en dur** : tout passe par `t("<domaine>.<clé>")`. L'anglais (`src/i18n/en/*.ts`) est la référence, le français est typé `Record<keyof typeof EN_X, string>`. Le noyau n'a **aucune** chaîne visible.
- **`t()` s'appelle AU RENDU**, jamais dans une constante top-level.
- **Ne jamais traduire les valeurs persistées** : `correct`, `wrong`, `understood`, `partial`, `review`, `skipped`, `seen`, `answer`, `rename`, ni les `id:` de commandes, ni les classes CSS.
- **Les scripts de vérification appellent `process.exitCode`, jamais `process.exit()`** : la pile doit se dérouler pour que `withSrcModule` retire son dossier temporaire.
- **Modules visés < ~350 lignes.**
- **Pureté de `src/scheduler/`** : aucun `from "obsidian"`, `document`, `window`, `Date.now()`, `new Date()`, `Math.random()`. Vérifié mécaniquement par la Task 1.
- **`npm run check` après chaque tâche.**

## Ordre et exécutants

| Task | Titre | Exécutant |
|---|---|---|
| 1 | Noyau : types, paramètres, horizon | Claude |
| 2 | Noyau : le journal (format et relecture) | Claude |
| 3 | Noyau : l'état dérivé | Claude |
| 4 | Noyau : le plan du jour | Claude |
| 5 | Règle d'identité partagée (`quiz-ids.ts`) | Claude (risque : `export.ts`) |
| 6 | Le scanner retient les questions | Codex |
| 7 | L'adaptateur Obsidian | Claude |
| 8 | Le moteur enregistre les réponses | Claude |
| 9 | La date d'examen par module | Codex |
| 10 | La carte « À réviser » sur l'accueil | Codex, revue Claude |
| 11 | Vérification de bout en bout | Claude |

---

### Task 1: Noyau — types, paramètres, horizon

**Files:**
- Create: `src/scheduler/types.ts`
- Create: `src/scheduler/params.ts`
- Create: `src/scheduler/horizon.ts`
- Create: `scripts/check-scheduler.mjs`
- Modify: `package.json` (ajouter `"check:scheduler"`)

**Interfaces:**
- Produces: `ReviewGrade`, `ReviewEvent`, `RenameEvent`, `LogLine`, `ScheduledItem`, `ItemState`, `Plan`, `PlanInput` (types) ; `SchedulerParams`, `DEFAULT_PARAMS` ; `ratioCoefficients(low, high)`, `retentionRatio(horizonMs, params)`, `intervalCeiling(horizonMs, params)`, `horizonFor(examAt, now, params)`.
- Consumes: `QuestionRole` de `src/types/quiz.ts`.

- [ ] **Step 1: Écrire `src/scheduler/types.ts`**

```ts
import type { QuestionRole } from "../types/quiz";
import type { SchedulerParams } from "./params";

/**
 * ORDONNANCEUR — types du domaine.
 *
 * Ce dossier est de la LOGIQUE PURE : ni Obsidian, ni DOM, ni horloge, ni
 * hasard. Le même module doit tourner à l'identique dans le greffon
 * aujourd'hui et dans les applications PC et Android demain — c'est ce qui
 * rend ce travail non jetable, et `scripts/check-scheduler.mjs` l'impose
 * mécaniquement plutôt que de s'en remettre à ce commentaire.
 *
 * Conception : docs/superpowers/specs/2026-09-02-scheduler-design.md
 */

/**
 * Verdict d'une réponse. Valeurs PERSISTÉES dans le journal : jamais
 * traduites, jamais renommées. Les trois valeurs d'auto-évaluation
 * reprennent `TextOnlyRating` (types/quiz.ts) plutôt que d'inventer un
 * second vocabulaire pour la même chose.
 */
export type ReviewGrade =
	| "correct" | "wrong"
	| "understood" | "partial" | "review"
	| "skipped"
	| "seen";

/** Une réponse. Une ligne du journal. */
export interface ReviewEvent {
	t: "answer";
	/** Clé OPAQUE de la question. Le noyau ne l'interprète jamais : le
	    chantier 2 doit rester libre de son modèle de contenu. */
	q: string;
	/** Epoch ms. */
	at: number;
	grade: ReviewGrade;
	/** Rôle AU MOMENT de la réponse. Copié, jamais relu dans la note : un
	    journal qui dépend du vault pour être interprété ne se transporte pas
	    vers une application, et ne se fusionne pas entre deux appareils. */
	role?: QuestionRole;
}

/**
 * Un renommage. Le journal reste ainsi strictement en AJOUT : réécrire un
 * fichier d'un mégaoctet au moment où l'application se ferme est
 * précisément la façon de le perdre. Appliqué par PRÉFIXE, donc un dossier
 * renommé tient en une ligne.
 */
export interface RenameEvent {
	t: "rename";
	from: string;
	to: string;
	at: number;
}

export type LogLine = ReviewEvent | RenameEvent;

/** Une question qui EXISTE aujourd'hui. Le journal peut en contenir
    d'autres (supprimées) : elles ne sont jamais planifiées. */
export interface ScheduledItem {
	q: string;
	/** Clé opaque du module : porte l'horizon, et BORNE l'entrelacement. */
	module: string;
	/** Clé opaque du quiz ou de la tranche d'origine. */
	source: string;
	/** Famille confusable, si le contenu la déclare. Rien ne la produit
	    encore : l'alternance se replie alors sur `source`. */
	topic?: string;
	role?: QuestionRole;
}

/** État de planification, DÉRIVÉ du journal à chaque appel — jamais
    persisté. C'est ce qui permet de rejouer tout l'historique quand un
    paramètre change. */
export interface ItemState {
	q: string;
	/** Succès consécutifs depuis le dernier échec. */
	streak: number;
	/** Nombre total d'échecs. */
	lapses: number;
	/** Dernier événement PORTEUR DE SIGNAL (ms), ou null si aucun. */
	lastAt: number | null;
	/** Intervalle courant (ms). 0 tant qu'aucun signal n'a été reçu. */
	interval: number;
	/** Échéance (ms), ou null pour une question jamais répondue : elle est
	    due immédiatement et entre par le quota de neufs. */
	dueAt: number | null;
	isNew: boolean;
}

export interface PlanInput {
	/** L'heure est une ENTRÉE. Un ordonnanceur qui lit l'horloge lui-même
	    est intestable et non reproductible. */
	now: number;
	/** Début de la journée locale (ms) : seul l'hôte connaît le fuseau et
	    l'heure de bascule. Le noyau ne manipule jamais de calendrier. */
	dayStart: number;
	items: ScheduledItem[];
	events: LogLine[];
	/** module → date d'examen (ms), ou null pour l'horizon par défaut. */
	horizons: Record<string, number | null>;
	params: SchedulerParams;
}

export interface Plan {
	/** À poser aujourd'hui, dans l'ordre. */
	today: string[];
	/** Dû mais reporté faute de budget, par priorité décroissante. */
	deferred: string[];
	/** Charge projetée, un entier par jour de la fenêtre de lissage. */
	forecast: number[];
	stats: { due: number; new: number; ahead: number; spentToday: number };
}
```

> `SchedulerParams` reste déclaré dans `params.ts` et n'est **pas** réexporté ici : `index.ts` (Task 4) l'expose depuis son fichier d'origine, et deux chemins d'export pour un même type finissent toujours par diverger.

- [ ] **Step 2: Écrire `src/scheduler/params.ts`**

Chaque défaut porte son STATUT. Un paramètre arbitraire est écrit comme arbitraire : c'est l'exigence explicite de la feuille de route, une spec qui les fige sans le dire serait pire qu'une absence de spec.

```ts
/** Ancrage de la courbe de Cepeda : à cet horizon, cette fraction. */
export interface RatioAnchor { days: number; ratio: number; }

/**
 * PARAMÈTRES DE L'ORDONNANCEUR.
 *
 * Trois statuts, et il faut les distinguer :
 *   ANCRÉ      — vient d'un résultat mesuré de la littérature ;
 *   DÉRIVÉ     — conséquence d'une contrainte de la méthode ;
 *   ARBITRAIRE — choisi pour partir de quelque part, à régler à l'usage.
 *
 * Huit des onze valeurs sont ARBITRAIRES. Le journal étant rejouable,
 * changer l'une d'elles recalcule tout l'historique déjà accumulé : le
 * réglage se fera sur des données réelles, pas sur les six semaines
 * suivantes. Tableau complet, avec ce qui ferait changer chaque valeur :
 * spec §8.
 */
export interface SchedulerParams {
	/** ANCRÉ (Cepeda et al. 2008). Les deux seuls points mesurés. */
	ratioAncres: [RatioAnchor, RatioAnchor];
	/** DÉRIVÉ : l'ancrage bas EST le régime « retenir durablement ». */
	horizonDefaut: number;
	/** ARBITRAIRE : convention héritée de J1. */
	intervalleInitial: number;
	/** ARBITRAIRE. La forme de la progression n'a pas de statut privilégié
	    (Karpicke & Roediger) : c'est le PLAFOND qui fait le travail. */
	facteurSucces: number;
	/** ARBITRAIRE : un succès amorti reste un succès. */
	facteurPartiel: number;
	/** ARBITRAIRE. */
	intervalleEchec: number;
	/** DÉRIVÉ : « corriger l'erreur près de la tentative, espacer la
	    récupération suivante » interdit le re-test dans la séance. */
	intervalleMin: number;
	/** ARBITRAIRE : environ 20 min à 30 s la question. */
	budgetJour: number;
	/** ARBITRAIRE. Sans ce quota, une génération de 80 questions noierait
	    toutes les révisions le jour même : c'est le mur des mille cartes
	    vu depuis l'ordonnanceur. */
	partNeuf: number;
	/** ARBITRAIRE. Sert DEUX fois : l'anticipation du lissage, et le
	    garde-fou de double révision (state.ts). Un seul seuil à régler. */
	margeAnticipation: number;
	/** ARBITRAIRE : profondeur de la projection de charge, en jours. */
	fenetreLissage: number;
}

export const HEURE = 3600000;
export const JOUR = 86400000;

export const DEFAULT_PARAMS: SchedulerParams = {
	ratioAncres: [{ days: 7, ratio: 0.30 }, { days: 365, ratio: 0.075 }],
	horizonDefaut: 365 * JOUR,
	intervalleInitial: JOUR,
	facteurSucces: 2.0,
	facteurPartiel: 1.2,
	intervalleEchec: JOUR,
	intervalleMin: 4 * HEURE,
	budgetJour: 40,
	partNeuf: 0.25,
	margeAnticipation: 0.20,
	fenetreLissage: 14,
};
```

- [ ] **Step 3: Écrire les cas d'horizon dans `scripts/check-scheduler.mjs`**

```js
/**
 * Vérification de l'ORDONNANCEUR (src/scheduler/).
 *
 * Ce script existe pour la même raison que check:md et check:export : c'est
 * de la logique qu'une relecture ne suffit pas à juger. Il charge le CODE
 * RÉEL via load-src.mjs — une réplique finirait par diverger et validerait
 * le vide.
 *
 *     npm run check:scheduler
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const JOUR = 86400000;
const HEURE = 3600000;

/* ── PURETÉ ──
   Le noyau doit tourner hors d'Obsidian, sans écran et sans horloge. C'est
   la condition qui rend ce module réutilisable par les applications PC et
   Android ; sans contrôle mécanique, elle s'érode au premier appel
   « pratique » à Date.now(). */
{
	const r = makeReporter("Ordonnanceur — pureté du noyau");
	const INTERDITS = [
		[/from\s+["']obsidian["']/, "import obsidian"],
		[/\bdocument\./, "document"],
		[/\bwindow\./, "window"],
		[/\bDate\.now\s*\(/, "Date.now()"],
		[/\bnew\s+Date\s*\(/, "new Date()"],
		[/\bMath\.random\s*\(/, "Math.random()"],
	];
	const dir = "src/scheduler";
	for (const f of readdirSync(dir).filter(n => n.endsWith(".ts"))) {
		const src = readFileSync(join(dir, f), "utf8");
		for (const [re, nom] of INTERDITS) {
			r.check(`${f} sans ${nom}`, re.test(src), false);
		}
	}
	r.done();
}
```

Le script s'arrête là pour l'instant : la section « horizon » est ajoutée au Step 6, une fois le module écrit.

- [ ] **Step 4: Ajouter le script à `package.json` et le lancer pour vérifier qu'il échoue**

```json
"check:scheduler": "node scripts/check-scheduler.mjs",
```

Run: `npm run check:scheduler`
Expected: FAIL — `src/scheduler` n'existe pas (ENOENT sur readdirSync).

- [ ] **Step 5: Écrire `src/scheduler/horizon.ts`**

```ts
import type { RatioAnchor, SchedulerParams } from "./params";
import { JOUR } from "./params";

/**
 * L'HORIZON PLAFONNE L'INTERVALLE, IL NE L'ORDONNE PAS.
 *
 * Cepeda et al. (2008) ne donnent pas une règle mais une surface : environ
 * 20 à 40 % de l'horizon pour une échéance à une semaine, 5 à 10 % pour une
 * échéance à un an. On interpole logarithmiquement entre ces deux points,
 * et le résultat sert de PLAFOND — pas de progression imposée, ce que
 * Karpicke & Roediger interdisent explicitement.
 *
 * Comme l'horizon est le temps RESTANT, trois comportements tombent sans
 * qu'aucune règle soit écrite : un examen qui approche resserre les
 * révisions, un examen passé retombe sur le régime durable, et l'urgence
 * n'a pas besoin d'un terme de priorité à elle (plan.ts).
 */

/** Coefficients de ratio(H) = a - b·ln(H_jours), DÉRIVÉS des ancrages.
    Jamais écrits en dur : sinon déplacer un ancrage ne changerait rien et
    le paramètre ne serait qu'un décor. */
export function ratioCoefficients(low: RatioAnchor, high: RatioAnchor): { a: number; b: number } {
	const b = (low.ratio - high.ratio) / (Math.log(high.days) - Math.log(low.days));
	const a = low.ratio + b * Math.log(low.days);
	return { a, b };
}

/**
 * Fraction de l'horizon à laisser passer entre deux révisions.
 *
 * H est BORNÉ au domaine des deux ancrages : hors de là, on n'extrapole
 * pas. Sans ce bornage la formule devient absurde — le ratio s'annule vers
 * 1364 jours puis devient négatif, et un horizon de trois ans donnerait un
 * plafond PLUS COURT qu'un horizon d'un an.
 */
export function retentionRatio(horizonMs: number, params: SchedulerParams): number {
	const [low, high] = params.ratioAncres;
	const { a, b } = ratioCoefficients(low, high);
	const jours = Math.min(Math.max(horizonMs / JOUR, low.days), high.days);
	return a - b * Math.log(jours);
}

/** Plafond d'intervalle. Strictement croissant en H sur tout le domaine :
    sur [7, 365] sa dérivée vaut ratio(H) - b, positive puisque ratio ≥ 0,075
    et b ≈ 0,0569 ; au-delà elle est linéaire. */
export function intervalCeiling(horizonMs: number, params: SchedulerParams): number {
	return retentionRatio(horizonMs, params) * horizonMs;
}

/**
 * Horizon effectif d'un module à l'instant `now`.
 *
 * Un examen PASSÉ retombe sur l'horizon par défaut : après le partiel le
 * cours reste à retenir, et la note de méthode interdit la sortie du
 * système après une réussite. Aucune intervention de l'utilisateur n'est
 * requise le lendemain de son examen.
 */
export function horizonFor(examAt: number | null | undefined, now: number, params: SchedulerParams): number {
	if (typeof examAt !== "number" || examAt <= now) return params.horizonDefaut;
	return examAt - now;
}
```

- [ ] **Step 6: Ajouter la section horizon au script**

```js
await withSrcModule(["src/scheduler/horizon.ts", "src/scheduler/params.ts"], (h, p) => {
	const r = makeReporter("Ordonnanceur — horizon");
	const P = p.DEFAULT_PARAMS;
	const j = (n) => n * JOUR;
	const arrondi = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

	// Les deux ancrages de Cepeda sont respectés au ratio près.
	r.check("ratio à 7 j", arrondi(h.retentionRatio(j(7), P)), 0.3);
	r.check("ratio à 365 j", arrondi(h.retentionRatio(j(365), P)), 0.075);

	// Valeurs intermédiaires (spec §5.1), en jours de plafond.
	r.check("plafond à 30 j", arrondi(h.intervalCeiling(j(30), P) / JOUR, 1), 6.5);
	r.check("plafond à 90 j", arrondi(h.intervalCeiling(j(90), P) / JOUR, 1), 13.9);

	/* MONOTONIE : c'est ce que le bornage de H protège. Sans lui, le ratio
	   devient négatif vers 1364 jours et un horizon de 3 ans donnerait un
	   plafond plus court qu'un horizon d'un an. */
	let croissant = true;
	let precedent = -1;
	for (const jours of [1, 2, 5, 7, 14, 30, 90, 180, 365, 730, 1095, 3650]) {
		const v = h.intervalCeiling(j(jours), P);
		if (v <= precedent) croissant = false;
		precedent = v;
	}
	r.check("plafond strictement croissant, y compris au-delà de 365 j", croissant, true);

	// Hors du domaine mesuré, on n'extrapole pas : le ratio est borné.
	r.check("ratio à 1 j = ratio à 7 j (pas d'extrapolation)",
		arrondi(h.retentionRatio(j(1), P)), arrondi(h.retentionRatio(j(7), P)));

	// Un examen PASSÉ retombe sur l'horizon par défaut.
	const now = 1_000_000_000_000;
	r.check("examen passé → horizon par défaut", h.horizonFor(now - j(1), now, P), P.horizonDefaut);
	r.check("pas de date → horizon par défaut", h.horizonFor(null, now, P), P.horizonDefaut);
	r.check("examen dans 7 j → 7 j", h.horizonFor(now + j(7), now, P), j(7));

	r.done();
});
```

- [ ] **Step 7: Lancer le script**

Run: `npm run check:scheduler`
Expected: PASS sur les deux sections (pureté, horizon).

- [ ] **Step 8: Typecheck**

Run: `npm run check`
Expected: aucune erreur.

- [ ] **Step 9: Commit**

```bash
git add src/scheduler/types.ts src/scheduler/params.ts src/scheduler/horizon.ts scripts/check-scheduler.mjs package.json
git commit -m "feat(scheduler): l'horizon de retention plafonne l'intervalle"
```

---

### Task 2: Noyau — le journal (format et relecture)

**Files:**
- Create: `src/scheduler/log.ts`
- Modify: `scripts/check-scheduler.mjs` (section « journal »)

**Interfaces:**
- Consumes: `LogLine`, `ReviewEvent`, `RenameEvent` (Task 1).
- Produces: `formatLine(line: LogLine): string` (une ligne JSONL, saut de ligne inclus), `parseLog(text: string): { lines: LogLine[]; ignored: number }`, `applyRenames(lines: LogLine[]): ReviewEvent[]`.

- [ ] **Step 1: Écrire les cas d'abord**

```js
await withSrcModule("src/scheduler/log.ts", (log) => {
	const r = makeReporter("Ordonnanceur — journal");

	// Aller-retour.
	const e = { t: "answer", q: "note.md::q1", at: 1700000000000, grade: "correct", role: "test" };
	const relu = log.parseLog(log.formatLine(e));
	r.check("aller-retour d'un événement", relu.lines, [e]);
	r.check("rien d'ignoré", relu.ignored, 0);

	/* TOLÉRANCE : un fichier tronqué par une fermeture brutale doit perdre
	   une révision, pas un semestre. C'est la raison de préférer le JSONL à
	   un objet JSON unique. */
	const abime = log.formatLine(e) + '{"t":"answer","q":"b","at":\n' + log.formatLine({ ...e, q: "c" });
	r.check("ligne corrompue ignorée, le reste survit", abime2ids(log, abime), ["note.md::q1", "c"]);
	r.check("la corruption est comptée", log.parseLog(abime).ignored, 1);

	// Une ligne sans les champs requis n'est pas un événement.
	r.check("ligne sans grade ignorée", log.parseLog('{"t":"answer","q":"a","at":1}\n').lines.length, 0);
	r.check("ligne d'un type inconnu ignorée", log.parseLog('{"t":"autre"}\n').lines.length, 0);
	r.check("ligne vide ignorée sans compter", log.parseLog("\n\n").ignored, 0);

	// RENOMMAGE : la clé suit la note, y compris par préfixe de dossier.
	const journal = [
		log.formatLine({ t: "answer", q: "Cours/Reseaux/ch1.md::q1", at: 1, grade: "correct" }),
		log.formatLine({ t: "rename", from: "Cours/Reseaux", to: "Cours/Réseaux", at: 2 }),
		log.formatLine({ t: "answer", q: "Cours/Réseaux/ch1.md::q1", at: 3, grade: "wrong" }),
	].join("");
	const applique = log.applyRenames(log.parseLog(journal).lines);
	r.check("renommage de dossier appliqué par préfixe",
		applique.map(x => x.q), ["Cours/Réseaux/ch1.md::q1", "Cours/Réseaux/ch1.md::q1"]);
	r.check("les lignes de renommage ne restent pas des réponses",
		applique.every(x => x.t === "answer"), true);

	// Un renommage n'affecte QUE les événements qui le précèdent.
	const apres = log.applyRenames(log.parseLog([
		log.formatLine({ t: "rename", from: "a.md", to: "b.md", at: 1 }),
		log.formatLine({ t: "answer", q: "a.md::q1", at: 2, grade: "correct" }),
	].join("")).lines);
	r.check("un événement postérieur au renommage n'est pas re-déplacé",
		apres.map(x => x.q), ["a.md::q1"]);

	r.done();
});

/** Ids des événements survivants d'un journal abîmé. */
function abime2ids(log, texte) {
	return log.parseLog(texte).lines.filter(l => l.t === "answer").map(l => l.q);
}
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npm run check:scheduler`
Expected: FAIL — `src/scheduler/log.ts` introuvable (esbuild).

- [ ] **Step 3: Écrire `src/scheduler/log.ts`**

```ts
import type { LogLine, ReviewEvent, ReviewGrade } from "./types";

/**
 * LE FORMAT DU JOURNAL APPARTIENT AU NOYAU.
 *
 * L'adaptateur ne fait que lire et écrire des octets : tout ce qui
 * comprend le format vit ici, donc se transporte tel quel vers les
 * applications PC et Android.
 *
 * JSONL, une ligne par événement, en AJOUT SEUL. Deux conséquences
 * voulues : une ligne illisible n'emporte pas le fichier (un JSON unique
 * tronqué serait entièrement perdu), et deux appareils qui fusionnent
 * leurs journaux n'ont rien à réconcilier.
 */

const GRADES: readonly ReviewGrade[] = ["correct", "wrong", "understood", "partial", "review", "skipped", "seen"];

export function formatLine(line: LogLine): string {
	return JSON.stringify(line) + "\n";
}

/**
 * Relecture TOLÉRANTE : une ligne illisible est ignorée et comptée, jamais
 * fatale. Un fichier tronqué par une fermeture brutale perd une révision,
 * pas un semestre. Les lignes vides ne comptent pas comme des corruptions
 * (un fichier se termine par un saut de ligne).
 */
export function parseLog(text: string): { lines: LogLine[]; ignored: number } {
	const lines: LogLine[] = [];
	let ignored = 0;
	for (const brute of text.split("\n")) {
		const s = brute.trim();
		if (!s) continue;
		let o: unknown;
		try { o = JSON.parse(s); } catch { ignored++; continue; }
		const v = validate(o);
		if (v) lines.push(v); else ignored++;
	}
	return { lines, ignored };
}

function validate(o: unknown): LogLine | null {
	if (!o || typeof o !== "object") return null;
	const r = o as Record<string, unknown>;
	if (r.t === "answer") {
		if (typeof r.q !== "string" || !r.q) return null;
		if (typeof r.at !== "number" || !Number.isFinite(r.at)) return null;
		if (typeof r.grade !== "string" || !GRADES.includes(r.grade as ReviewGrade)) return null;
		const e: ReviewEvent = { t: "answer", q: r.q, at: r.at, grade: r.grade as ReviewGrade };
		if (typeof r.role === "string") e.role = r.role as ReviewEvent["role"];
		return e;
	}
	if (r.t === "rename") {
		if (typeof r.from !== "string" || !r.from) return null;
		if (typeof r.to !== "string" || !r.to) return null;
		if (typeof r.at !== "number" || !Number.isFinite(r.at)) return null;
		return { t: "rename", from: r.from, to: r.to, at: r.at };
	}
	return null;
}

/**
 * Applique les renommages EN SÉQUENCE et rend les seules réponses.
 *
 * Par PRÉFIXE : renommer un dossier déplace toutes ses notes, et
 * `stats-store.ts` traite déjà le renommage de cette façon. Un renommage
 * n'affecte que ce qui le précède dans le journal — les événements
 * postérieurs portent déjà la clé nouvelle.
 */
export function applyRenames(lines: LogLine[]): ReviewEvent[] {
	const out: ReviewEvent[] = [];
	for (const line of lines) {
		if (line.t === "rename") {
			const prefixe = line.from + "/";
			for (let i = 0; i < out.length; i++) {
				const q = out[i].q;
				if (q === line.from) out[i] = { ...out[i], q: line.to };
				else if (q.startsWith(prefixe)) out[i] = { ...out[i], q: line.to + q.slice(line.from.length) };
				else if (q.startsWith(line.from + "::")) out[i] = { ...out[i], q: line.to + q.slice(line.from.length) };
			}
			continue;
		}
		out.push(line);
	}
	return out;
}
```

- [ ] **Step 4: Lancer**

Run: `npm run check:scheduler`
Expected: PASS.

- [ ] **Step 5: Typecheck et commit**

```bash
npm run check
git add src/scheduler/log.ts scripts/check-scheduler.mjs
git commit -m "feat(scheduler): journal JSONL en ajout seul, relecture tolerante"
```

---

### Task 3: Noyau — l'état dérivé

**Files:**
- Create: `src/scheduler/state.ts`
- Modify: `scripts/check-scheduler.mjs` (section « état dérivé »)

**Interfaces:**
- Consumes: `ItemState`, `ReviewEvent`, `ScheduledItem` (Task 1) ; `intervalCeiling`, `horizonFor` (Task 1).
- Produces: `signalOf(e: ReviewEvent): "success" | "partial" | "fail" | null`, `deriveStates(input: { now: number; items: ScheduledItem[]; events: ReviewEvent[]; horizons: Record<string, number | null>; params: SchedulerParams }): Map<string, ItemState>`.

- [ ] **Step 1: Écrire les cas d'abord**

```js
await withSrcModule(["src/scheduler/state.ts", "src/scheduler/params.ts"], (st, p) => {
	const r = makeReporter("Ordonnanceur — état dérivé");
	const P = p.DEFAULT_PARAMS;
	const T0 = 1_700_000_000_000;
	const j = (n) => n * JOUR;
	const item = (q, mod = "M") => ({ q, module: mod, source: "s" });
	const rep = (q, at, grade, role) => ({ t: "answer", q, at, grade, ...(role ? { role } : {}) });
	const etat = (events, horizons = {}, now = T0 + j(100)) =>
		st.deriveStates({ now, items: [item("a")], events, horizons, params: P }).get("a");

	// Une question jamais répondue est NEUVE et due immédiatement.
	const neuf = etat([]);
	r.check("jamais répondue → isNew", neuf.isNew, true);
	r.check("jamais répondue → pas d'échéance", neuf.dueAt, null);

	// Premier succès → intervalle initial.
	r.check("premier succès → intervalleInitial",
		etat([rep("a", T0, "correct")]).interval, P.intervalleInitial);

	/* Croissance : le second succès doit avoir lieu APRÈS l'échéance, sinon
	   le garde-fou de double révision s'applique (cas suivant). */
	r.check("second succès dû → ×facteurSucces",
		etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "correct")]).interval,
		P.intervalleInitial * P.facteurSucces);

	/* GARDE-FOU : rejouer le même quiz dans l'heure ne doit PAS doubler
	   l'intervalle. Sans lui, le compteur de répétitions remplacerait
	   l'espacement, seul mécanisme que la littérature valide. */
	r.check("succès trop tôt → intervalle inchangé",
		etat([rep("a", T0, "correct"), rep("a", T0 + HEURE, "correct")]).interval,
		P.intervalleInitial);

	// Échec → intervalle court, et le compteur d'échecs monte.
	const rate = etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "correct"), rep("a", T0 + j(5), "wrong")]);
	r.check("échec → intervalleEchec", rate.interval, P.intervalleEchec);
	r.check("échec → streak remis à zéro", rate.streak, 0);
	r.check("échec compté", rate.lapses, 1);

	// L'auto-évaluation compte, et « partiel » amortit.
	r.check("understood = succès plein",
		etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "understood")]).interval,
		P.intervalleInitial * P.facteurSucces);
	r.check("partial amortit",
		etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "partial")]).interval,
		P.intervalleInitial * P.facteurPartiel);
	r.check("review = échec",
		etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "review")]).interval,
		P.intervalleEchec);

	/* Un `pre` raté ne raccourcit RIEN : chez Richland, Kornell & Kao,
	   c'est le groupe qui a essayé ET échoué qui a le mieux appris. */
	r.check("pre raté → aucun signal", etat([rep("a", T0, "wrong", "pre")]).isNew, true);
	r.check("pre réussi → aucun signal", etat([rep("a", T0, "correct", "pre")]).isNew, true);
	r.check("carte read → aucun signal", etat([rep("a", T0, "seen", "read")]).isNew, true);
	r.check("abandon explicite → aucun signal", etat([rep("a", T0, "skipped")]).isNew, true);

	/* PLAFOND : avec un partiel dans 7 jours, l'intervalle ne dépasse
	   jamais 2,1 jours, quel que soit le nombre de succès. */
	const serie = [];
	for (let k = 0; k < 10; k++) serie.push(rep("a", T0 + j(k * 3), "correct"));
	const now = T0 + j(27) + j(1);
	const plafonne = st.deriveStates({
		now, items: [item("a")], events: serie,
		horizons: { M: now + j(7) }, params: P,
	}).get("a");
	r.check("intervalle plafonné par l'horizon", plafonne.interval <= 2.11 * JOUR, true);

	/* JAMAIS DE SORTIE DU SYSTÈME : dix succès de suite laissent une
	   échéance finie. Une question qui sortirait après une réussite
	   sacrifierait exactement ce que l'espacement sert à obtenir. */
	const dix = st.deriveStates({
		now, items: [item("a")], events: serie, horizons: {}, params: P,
	}).get("a");
	r.check("dix succès → échéance toujours finie", Number.isFinite(dix.dueAt), true);
	r.check("dix succès → toujours pas neuve", dix.isNew, false);

	/* RE-BORNAGE AU PLAFOND ACTUEL : un intervalle calculé quand l'examen
	   était loin doit se resserrer quand il approche. */
	const large = [rep("a", T0, "correct"), rep("a", T0 + j(1), "correct"), rep("a", T0 + j(3), "correct")];
	const proche = st.deriveStates({
		now: T0 + j(3), items: [item("a")], events: large,
		horizons: { M: T0 + j(5) }, params: P,
	}).get("a");
	r.check("l'examen qui approche resserre l'intervalle déjà acquis",
		proche.interval <= P.intervalleInitial * P.facteurSucces, true);

	// Un événement dont la question n'existe plus n'est jamais planifié.
	const orphelin = st.deriveStates({
		now, items: [item("a")], events: [rep("disparue", T0, "correct")],
		horizons: {}, params: P,
	});
	r.check("événement orphelin ignoré", orphelin.has("disparue"), false);
	r.check("l'item existant reste neuf", orphelin.get("a").isNew, true);

	r.done();
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npm run check:scheduler`
Expected: FAIL — `src/scheduler/state.ts` introuvable.

- [ ] **Step 3: Écrire `src/scheduler/state.ts`**

```ts
import type { ItemState, ReviewEvent, ScheduledItem } from "./types";
import type { SchedulerParams } from "./params";
import { horizonFor, intervalCeiling } from "./horizon";

/**
 * L'ÉTAT EST DÉRIVÉ, JAMAIS PERSISTÉ.
 *
 * Le journal fait foi ; l'échéance de chaque question est recalculée à
 * chaque appel. C'est ce qui permet de changer un paramètre et de rejouer
 * tout l'historique déjà accumulé — le réglage se fera sur des données
 * réelles plutôt que sur les six semaines suivantes. Un état résumé mis à
 * jour au fil de l'eau aurait été plus compact, et irréversible.
 */

export type Signal = "success" | "partial" | "fail" | null;

/**
 * Ce que vaut une réponse pour la mémoire.
 *
 * Un événement de rôle `pre` ne vaut RIEN, quel que soit son verdict : chez
 * Richland, Kornell & Kao (2009), c'est le groupe qui a essayé de répondre
 * et échoué qui a le mieux appris. L'échec y est le mécanisme, pas le
 * symptôme d'un oubli — le compter ferait revenir en boucle les questions
 * que la méthode fait délibérément rater.
 */
export function signalOf(e: ReviewEvent): Signal {
	if (e.role === "pre") return null;
	switch (e.grade) {
		case "correct": case "understood": return "success";
		case "partial": return "partial";
		case "wrong": case "review": return "fail";
		default: return null; // seen (carte de lecture), skipped (abandon explicite)
	}
}

export function deriveStates(input: {
	now: number;
	items: ScheduledItem[];
	events: ReviewEvent[];
	horizons: Record<string, number | null>;
	params: SchedulerParams;
}): Map<string, ItemState> {
	const { now, items, events, horizons, params } = input;

	const parQ = new Map<string, ReviewEvent[]>();
	for (const e of events) {
		const l = parQ.get(e.q);
		if (l) l.push(e); else parQ.set(e.q, [e]);
	}

	const out = new Map<string, ItemState>();
	for (const item of items) {
		const evts = (parQ.get(item.q) ?? []).slice().sort((a, b) => a.at - b.at);
		const examAt = horizons[item.module] ?? null;
		let interval = 0;
		let lastAt: number | null = null;
		let streak = 0;
		let lapses = 0;

		for (const e of evts) {
			const s = signalOf(e);
			if (!s) continue;

			/* Plafond AU MOMENT de l'événement : la trajectoire reste fidèle
			   à ce qui s'est réellement passé, plutôt que réécrite avec
			   l'horizon d'aujourd'hui. */
			const plafond = intervalCeiling(horizonFor(examAt, e.at, params), params);

			if (lastAt === null) {
				interval = s === "fail" ? params.intervalleEchec : params.intervalleInitial;
			} else if (s === "fail") {
				interval = params.intervalleEchec;
			} else {
				/* GARDE-FOU DE DOUBLE RÉVISION. Un succès ne fait croître
				   l'intervalle que si l'item était dû, à la marge
				   d'anticipation près. Sans cette règle, rejouer deux fois le
				   même quiz dans l'heure doublerait deux fois l'intervalle
				   pour cinq minutes d'espacement réel : le compteur de
				   répétitions remplacerait l'espacement, qui est le seul
				   mécanisme que la littérature valide. */
				const etaitDu = e.at >= lastAt + interval - params.margeAnticipation * interval;
				if (etaitDu) interval *= s === "partial" ? params.facteurPartiel : params.facteurSucces;
			}

			if (s === "fail") { lapses++; streak = 0; } else { streak++; }
			/* Le plancher gagne sur le plafond : un examen dans deux heures
			   ne doit pas produire un intervalle nul, donc une boucle. */
			interval = Math.min(Math.max(interval, params.intervalleMin), Math.max(plafond, params.intervalleMin));
			lastAt = e.at;
		}

		let dueAt: number | null = null;
		if (lastAt !== null) {
			/* Re-bornage au plafond ACTUEL : un intervalle acquis quand
			   l'examen était loin serait trop long maintenant qu'il approche. */
			const plafondNow = intervalCeiling(horizonFor(examAt, now, params), params);
			interval = Math.min(interval, Math.max(plafondNow, params.intervalleMin));
			dueAt = lastAt + interval;
		}

		out.set(item.q, { q: item.q, streak, lapses, lastAt, interval, dueAt, isNew: lastAt === null });
	}
	return out;
}
```

- [ ] **Step 4: Lancer**

Run: `npm run check:scheduler`
Expected: PASS.

- [ ] **Step 5: Typecheck et commit**

```bash
npm run check
git add src/scheduler/state.ts scripts/check-scheduler.mjs
git commit -m "feat(scheduler): etat de planification derive du journal"
```

---

### Task 4: Noyau — le plan du jour

**Files:**
- Create: `src/scheduler/plan.ts`
- Create: `src/scheduler/index.ts`
- Modify: `scripts/check-scheduler.mjs` (section « plan »)

**Interfaces:**
- Consumes: `deriveStates`, `signalOf` (Task 3) ; `applyRenames` (Task 2) ; tous les types (Task 1).
- Produces: `planToday(input: PlanInput): Plan`. `src/scheduler/index.ts` réexporte `planToday`, `deriveStates`, `formatLine`, `parseLog`, `applyRenames`, `DEFAULT_PARAMS`, `JOUR`, `HEURE` et tous les types (**pas** `signalOf` : rien hors du noyau ne le consomme). **C'est le seul point d'entrée que l'adaptateur importe.**

- [ ] **Step 1: Écrire les cas d'abord**

```js
await withSrcModule(["src/scheduler/index.ts"], (S) => {
	const r = makeReporter("Ordonnanceur — plan du jour");
	const P = S.DEFAULT_PARAMS;
	const T0 = 1_700_000_000_000;
	const j = (n) => n * JOUR;
	const rep = (q, at, grade) => ({ t: "answer", q, at, grade });
	const base = (over = {}) => ({
		now: T0, dayStart: T0 - HEURE, horizons: {}, params: P,
		items: [], events: [], ...over,
	});

	// Déterminisme : deux appels identiques donnent le même plan.
	const neufs = [];
	for (let k = 0; k < 40; k++) neufs.push({ q: "q" + k, module: "M", source: "s" + (k % 3) });
	const a = S.planToday(base({ items: neufs }));
	const b = S.planToday(base({ items: neufs }));
	r.check("deux appels identiques donnent le même plan", a.today, b.today);

	/* QUOTA DE NEUFS : sans lui, une génération de 80 questions noierait
	   toutes les révisions le jour même. */
	r.check("le quota borne les questions jamais vues",
		a.today.length, Math.round(P.budgetJour * P.partNeuf));
	r.check("les neufs sont comptés", a.stats.new, 40);

	// Le budget est respecté, et le surplus reporté.
	const dus = [];
	const evts = [];
	for (let k = 0; k < 60; k++) {
		dus.push({ q: "d" + String(k).padStart(2, "0"), module: "M", source: "s" });
		evts.push(rep("d" + String(k).padStart(2, "0"), T0 - j(10), "correct"));
	}
	const charge = S.planToday(base({ items: dus, events: evts }));
	r.check("budget respecté", charge.today.length, P.budgetJour);
	r.check("le surplus est reporté, pas perdu",
		charge.today.length + charge.deferred.length, 60);
	r.check("tout est dû", charge.stats.due, 60);

	/* BUDGET DÉJÀ CONSOMMÉ : le noyau ne persiste rien, il COMPTE ce qui a
	   été fait depuis dayStart. Rouvrir le tableau de bord après quarante
	   questions ne doit pas en redonner quarante. */
	const dejaFait = dus.map(it => rep(it.q, T0 - HEURE / 2, "correct"));
	const apres = S.planToday(base({ items: dus, events: [...evts, ...dejaFait] }));
	r.check("ce qui a déjà été fait aujourd'hui est décompté", apres.stats.spentToday, 60);
	r.check("budget épuisé → rien de plus aujourd'hui", apres.today.length, 0);

	/* ANTICIPATION : quand le budget n'est pas atteint, on tire vers
	   aujourd'hui ce qui tombe plus tard, JAMAIS au-delà de la marge. */
	const futur = [{ q: "f1", module: "M", source: "s" }];
	// Deux succès espacés d'un jour → intervalle 2 j, échéance à T0 + 0,2 j.
	const proche = [rep("f1", T0 - j(2.8), "correct"), rep("f1", T0 - j(1.8), "correct")];
	r.check("ce qui tombe dans la marge est avancé",
		S.planToday(base({ items: futur, events: proche })).stats.ahead, 1);
	// Échéance à T0 + 1,5 j sur un intervalle de 2 j : hors marge (0,4 j).
	const loin = [rep("f1", T0 - j(1.5), "correct"), rep("f1", T0 - j(0.5), "correct")];
	r.check("ce qui tombe hors marge n'est jamais avancé",
		S.planToday(base({ items: futur, events: loin })).stats.ahead, 0);

	/* ENTRELACEMENT : deux modules ne s'entremêlent pas — ils ne se
	   confondent pas, les mélanger ne coûterait que du changement de
	   contexte. À l'intérieur d'un module, les familles alternent. */
	const deuxModules = [];
	const evts2 = [];
	for (let k = 0; k < 4; k++) {
		deuxModules.push({ q: "A" + k, module: "A", source: "sA" + (k % 2) });
		deuxModules.push({ q: "B" + k, module: "B", source: "sB" + (k % 2) });
		evts2.push(rep("A" + k, T0 - j(10), "correct"), rep("B" + k, T0 - j(10), "correct"));
	}
	const ordre = S.planToday(base({ items: deuxModules, events: evts2 })).today;
	const modules = ordre.map(q => q[0]);
	const bascules = modules.filter((m, i) => i > 0 && m !== modules[i - 1]).length;
	r.check("les modules ne s'entremêlent pas (une seule bascule)", bascules, 1);

	const premier = ordre.filter(q => q[0] === modules[0]);
	const familles = premier.map(q => Number(q.slice(1)) % 2);
	r.check("les familles d'un même module alternent",
		familles.every((f, i) => i === 0 || f !== familles[i - 1]), true);

	/* Les neufs sont RÉPARTIS, pas relégués : une session écourtée doit
	   progresser sur les deux fronts, sinon la couverture stagne et crée
	   des angles morts permanents. */
	const mixte = [{ q: "n1", module: "M", source: "s" }];
	const evts3 = [];
	for (let k = 0; k < 6; k++) {
		mixte.push({ q: "r" + k, module: "M", source: "s" });
		evts3.push(rep("r" + k, T0 - j(10), "correct"));
	}
	const repartis = S.planToday(base({ items: mixte, events: evts3 })).today;
	r.check("le neuf n'est pas relégué en dernier", repartis[repartis.length - 1], "r5");
	r.check("le neuf n'est pas non plus en premier", repartis[0] === "n1", false);
	r.check("le neuf est bien présent", repartis.includes("n1"), true);

	/* REJOUABILITÉ : changer un paramètre et rejouer le MÊME journal change
	   le plan. C'est la preuve que rien n'est figé dans un état persistant. */
	const serre = S.planToday(base({ items: dus, events: evts, params: { ...P, budgetJour: 5 } }));
	r.check("un paramètre modifié change le plan sur le même journal",
		serre.today.length, 5);

	// Une question absente du catalogue n'apparaît jamais.
	r.check("question absente du catalogue jamais planifiée",
		S.planToday(base({ events: [rep("x", T0 - j(10), "correct")] })).today, []);

	// Le renommage est appliqué AVANT la planification.
	const renomme = S.planToday(base({
		items: [{ q: "b.md::q1", module: "M", source: "s" }],
		events: [
			rep("a.md::q1", T0 - j(10), "correct"),
			{ t: "rename", from: "a.md", to: "b.md", at: T0 - j(9) },
		],
	}));
	r.check("l'historique suit la note renommée", renomme.stats.new, 0);

	r.done();
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `npm run check:scheduler`
Expected: FAIL — `src/scheduler/index.ts` introuvable.

- [ ] **Step 3: Écrire `src/scheduler/plan.ts`**

```ts
import type { ItemState, Plan, PlanInput, ScheduledItem } from "./types";
import { JOUR } from "./params";
import { deriveStates } from "./state";
import { applyRenames } from "./log";

/**
 * LE PLAN NE PORTE QUE SUR AUJOURD'HUI.
 *
 * La projection de charge sert à décider quoi AVANCER, elle n'est jamais
 * persistée : demain, tout est recalculé depuis le journal. Aucun planning
 * à invalider, donc aucune désynchronisation possible.
 *
 * L'ordre est TOTAL et DÉTERMINISTE — les égalités se départagent par la
 * clé. Sans cela, rien de tout ceci ne serait vérifiable.
 */
export function planToday(input: PlanInput): Plan {
	const { now, dayStart, items, horizons, params } = input;
	const events = applyRenames(input.events);
	const states = deriveStates({ now, items, events, horizons, params });
	const parQ = new Map(items.map(i => [i.q, i]));

	/* Le noyau ne RETIENT pas ce qui a été fait aujourd'hui : il le COMPTE.
	   Toutes les réponses comptent dans la charge, y compris celles sans
	   signal de mémoire — une carte de lecture prend du temps aussi. */
	const spentToday = events.filter(e => e.at >= dayStart && e.at <= now).length;
	const budget = Math.max(0, params.budgetJour - spentToday);

	const priorite = (s: ItemState): number =>
		s.dueAt === null || s.interval <= 0 ? 0 : (now - s.dueAt) / s.interval;

	const dus: ItemState[] = [];
	const neufs: ItemState[] = [];
	const futurs: ItemState[] = [];
	for (const item of items) {
		const s = states.get(item.q);
		if (!s) continue;
		if (s.isNew) neufs.push(s);
		else if (s.dueAt !== null && s.dueAt <= now) dus.push(s);
		else futurs.push(s);
	}

	const parCle = (a: ItemState, b: ItemState) => (a.q < b.q ? -1 : a.q > b.q ? 1 : 0);
	dus.sort((a, b) => priorite(b) - priorite(a) || parCle(a, b));
	neufs.sort(parCle);

	/* PROJECTION DE CHARGE sur la fenêtre de lissage. Le jour 0 porte ce qui
	   est déjà dû, retard compris. */
	const forecast = new Array<number>(Math.max(1, params.fenetreLissage)).fill(0);
	forecast[0] = dus.length;
	for (const s of futurs) {
		if (s.dueAt === null) continue;
		const jour = Math.floor((s.dueAt - now) / JOUR);
		if (jour >= 0 && jour < forecast.length) forecast[jour]++;
	}

	const quotaNeuf = Math.min(neufs.length, Math.round(params.budgetJour * params.partNeuf), budget);
	const retenusNeufs = neufs.slice(0, quotaNeuf);
	const retenusRev = dus.slice(0, Math.max(0, budget - quotaNeuf));
	const reportes = dus.slice(retenusRev.length);

	/* ANTICIPATION. S'il reste de la place, on tire vers aujourd'hui ce qui
	   tombe sur les jours les plus chargés — jamais au-delà de la marge.
	   La crête de Cepeda est plate autour de l'optimum : la marge s'y tient. */
	let libre = budget - retenusRev.length - retenusNeufs.length;
	const avances: ItemState[] = [];
	if (libre > 0) {
		const jourDe = (s: ItemState) => Math.floor(((s.dueAt as number) - now) / JOUR);
		const candidats = futurs
			.filter(s => s.dueAt !== null && s.dueAt - now <= params.margeAnticipation * s.interval)
			.sort((a, b) => {
				const ca = forecast[jourDe(a)] ?? 0;
				const cb = forecast[jourDe(b)] ?? 0;
				return cb - ca || (a.dueAt as number) - (b.dueAt as number) || parCle(a, b);
			});
		for (const s of candidats) {
			if (libre <= 0) break;
			avances.push(s);
			libre--;
		}
	}

	return {
		today: ordonner([...retenusRev, ...avances], retenusNeufs, parQ, priorite),
		deferred: reportes.map(s => s.q),
		forecast,
		stats: { due: dus.length, new: neufs.length, ahead: avances.length, spentToday },
	};
}

/**
 * L'ORDRE : l'entrelacement, et rien d'autre.
 *
 * Les modules ne s'entremêlent PAS. Deux modules ne se confondent pas :
 * les mélanger ne produirait aucune discrimination (Brunmair & Richter :
 * le modérateur est la similarité, et sur du matériel dissemblable
 * l'entrelacement est défavorable) et ne coûterait que du changement de
 * contexte. À l'intérieur d'un module, les familles alternent en
 * tourniquet — par `topic` s'il est déclaré, sinon par `source`, ce qui
 * entrelace les tranches d'un même chapitre.
 */
function ordonner(
	revisions: ItemState[],
	neufs: ItemState[],
	parQ: Map<string, ScheduledItem>,
	priorite: (s: ItemState) => number,
): string[] {
	const parModule = new Map<string, { rev: ItemState[]; neuf: ItemState[]; max: number }>();
	const bucket = (q: string) => {
		const mod = parQ.get(q)?.module ?? "";
		let b = parModule.get(mod);
		if (!b) { b = { rev: [], neuf: [], max: -Infinity }; parModule.set(mod, b); }
		return b;
	};
	for (const s of revisions) { const b = bucket(s.q); b.rev.push(s); b.max = Math.max(b.max, priorite(s)); }
	for (const s of neufs) { const b = bucket(s.q); b.neuf.push(s); }

	const modules = [...parModule.entries()]
		.sort((a, b) => b[1].max - a[1].max || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

	const out: string[] = [];
	for (const [, b] of modules) {
		const familles = new Map<string, ItemState[]>();
		for (const s of b.rev) {
			const it = parQ.get(s.q);
			const f = it?.topic || it?.source || "";
			const l = familles.get(f);
			if (l) l.push(s); else familles.set(f, [s]);
		}
		// Tourniquet : une famille après l'autre, en tournant.
		const files = [...familles.keys()].sort().map(k => familles.get(k) as ItemState[]);
		const rev: string[] = [];
		while (files.some(f => f.length)) {
			for (const f of files) { const s = f.shift(); if (s) rev.push(s.q); }
		}

		/* Les neufs sont RÉPARTIS dans la série, pas relégués à la fin : une
		   session écourtée doit progresser sur les deux fronts, sinon la
		   couverture stagne et crée des angles morts permanents. */
		const neuf = b.neuf.map(s => s.q);
		const total = rev.length + neuf.length;
		let i = 0, k = 0;
		for (let n = 0; n < total; n++) {
			if (k < neuf.length && k * total < n * neuf.length) out.push(neuf[k++]);
			else if (i < rev.length) out.push(rev[i++]);
			else out.push(neuf[k++]);
		}
	}
	return out;
}
```

- [ ] **Step 4: Écrire `src/scheduler/index.ts`**

```ts
/**
 * ORDONNANCEUR — point d'entrée unique.
 *
 * L'adaptateur n'importe QUE ce fichier : le découpage interne reste libre
 * de bouger sans toucher à l'hôte, et le jour où ce dossier est copié dans
 * l'application PC, c'est cette surface-là qui fait le contrat.
 */
export type {
	ReviewGrade, ReviewEvent, RenameEvent, LogLine,
	ScheduledItem, ItemState, Plan, PlanInput,
} from "./types";
export type { SchedulerParams, RatioAnchor } from "./params";
export { DEFAULT_PARAMS, JOUR, HEURE } from "./params";
export { ratioCoefficients, retentionRatio, intervalCeiling, horizonFor } from "./horizon";
export { formatLine, parseLog, applyRenames } from "./log";
export { deriveStates } from "./state";
// `signalOf` n'est PAS réexporté : aucun hôte n'en a besoin. La surface de
// ce fichier est le contrat que l'application PC héritera — elle n'expose
// que ce qui sert (ruling préflight 1, 2026-09-02).
export { planToday } from "./plan";
```

- [ ] **Step 5: Lancer**

Run: `npm run check:scheduler`
Expected: PASS sur les quatre sections.

- [ ] **Step 6: Typecheck et commit**

```bash
npm run check
git add src/scheduler/plan.ts src/scheduler/index.ts scripts/check-scheduler.mjs
git commit -m "feat(scheduler): plan du jour, lissage de charge et entrelacement"
```

---

### Task 5: Règle d'identité partagée (`quiz-ids.ts`)

**Risque** : cette tâche touche `src/editor/export.ts`, l'un des deux modules que le projet couvre par des scripts parce qu'il a déjà régressé en silence. Les vérifications de fin de tâche ne sont pas optionnelles.

**Files:**
- Create: `src/quiz-ids.ts`
- Modify: `src/editor/export.ts` (remplacer `questionId`/`IdContext` par un appel)
- Modify: `scripts/check-export.mjs` (deux cas de non-régression)

**Interfaces:**
- Produces: `assignQuestionIds(items: ReadonlyArray<{ id?: string; title?: string }>): string[]`.
- Consumed by: Task 6 (scanner), Task 7 (adaptateur).

- [ ] **Step 1: Écrire `src/quiz-ids.ts`**

L'algorithme est repris **à l'identique** de `export.ts:348-382` — y compris ses deux subtilités, qui ont chacune coûté une revue.

```ts
/**
 * IDENTITÉ D'UNE QUESTION — une seule règle, partagée.
 *
 * L'écriture d'un bloc (editor/export.ts) et sa LECTURE par le scanner
 * doivent attribuer exactement le même identifiant. Deux règles séparées
 * divergeraient, et une question sans `id:` explicite changerait de clé à
 * sa première sauvegarde depuis l'éditeur : son historique de révision
 * serait perdu en silence.
 *
 * Mesuré le 2026-09-02 sur les vaults réels : 771 des 774 questions portent
 * déjà un `id` explicite. Le repli est rare — raison de plus pour qu'il
 * soit exact plutôt que réinventé de deux façons.
 */

/** Slug ASCII d'un titre. Un titre en grec, en arabe ou fait de
    ponctuation le vide entièrement : l'appelant se replie alors sur `qN`. */
function slug(title: string | undefined): string {
	return (title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);
}

/**
 * Identifiants d'un bloc entier, dans l'ordre des questions.
 *
 * Deux subtilités, chacune issue d'une revue :
 *
 * 1. Un identifiant EXPLICITE a le droit de prendre SA réservation, celle-là
 *    seulement. Un slug dérivé, ou un candidat suffixé, n'appartient à
 *    personne : il doit éviter aussi les réservations à VENIR, sinon il
 *    prend la place d'une question plus bas. Avec `dup, dup, dup-2`,
 *    ignorer cette nuance donnait `dup, dup-2, dup-2-2` — la seule question
 *    qui avait un identifiant unique le perdait.
 * 2. Le suffixe s'applique MÊME à un identifiant explicite : deux questions
 *    portant le même (un copier-coller de bloc suffit) auraient la même
 *    ancre HTML, et la seconde deviendrait inatteignable.
 */
export function assignQuestionIds(items: ReadonlyArray<{ id?: string; title?: string }>): string[] {
	const reserves = new Set(items.map(i => i.id).filter((v): v is string => !!v));
	const attribues = new Set<string>();
	return items.map((it, idx) => {
		const explicite = it.id;
		const base = explicite || slug(it.title) || `q${idx + 1}`;
		const libre = (id: string): boolean => {
			if (attribues.has(id)) return false;
			if (explicite && id === base) return true;
			return !reserves.has(id);
		};
		let id = base;
		let n = 2;
		while (!libre(id)) id = `${base}-${n++}`;
		attribues.add(id);
		return id;
	});
}
```

- [ ] **Step 2: Ajouter les cas de non-régression à `scripts/check-export.mjs`**

```js
/* Task 5 (2026-09-02) : la règle d'identité a été extraite dans
   src/quiz-ids.ts pour être partagée avec le SCANNER — l'ordonnanceur a
   besoin de la même clé en lecture et en écriture. Ces cas figent le
   comportement que l'extraction ne doit pas avoir changé. */
await withSrcModule("src/quiz-ids.ts", ({ assignQuestionIds }) => {
	const r = makeReporter("Identité de question");

	r.check("un id explicite est conservé",
		assignQuestionIds([{ id: "abc" }]), ["abc"]);
	r.check("sans id, le titre donne un slug",
		assignQuestionIds([{ title: "Le protocole TCP" }]), ["le-protocole-tcp"]);
	r.check("un titre non latin se replie sur qN",
		assignQuestionIds([{ title: "Λορεμ ;;;" }]), ["q1"]);
	r.check("deux titres identiques sont départagés",
		assignQuestionIds([{ title: "Même" }, { title: "Même" }]), ["m-me", "m-me-2"]);

	/* Le cas de la revue codex 2026-07-31 : un slug dérivé ne doit pas
	   prendre la réservation d'une question qui vient PLUS BAS. */
	r.check("un slug évite les réservations à venir",
		assignQuestionIds([{ id: "dup" }, { title: "dup" }, { id: "dup-2" }]),
		["dup", "dup-3", "dup-2"]);

	// Deux ids explicites identiques : la seconde est suffixée.
	r.check("un id explicite dupliqué est suffixé",
		assignQuestionIds([{ id: "x" }, { id: "x" }]), ["x", "x-2"]);

	r.done();
});
```

- [ ] **Step 3: Lancer, vérifier l'échec**

Run: `npm run check:export`
Expected: FAIL — `src/quiz-ids.ts` introuvable, puis les cas passent une fois le Step 1 fait. Si un cas échoue, **c'est l'attendu du cas qu'il faut corriger d'après le comportement actuel de `export.ts`, pas l'inverse** : cette tâche ne change aucun comportement.

- [ ] **Step 4: Brancher `export.ts` sur la fonction partagée**

Dans `exportAll`, remplacer la construction de `attribution` par :

```ts
const ids = assignQuestionIds(questions.map(q => ({ id: q._sourceId, title: q.title })));
const parts = questions.map((q, i) => exportQuestion(q, i, ids[i]));
```

`exportQuestion(q, idx, id)` prend désormais l'identifiant tout fait. Supprimer `interface IdContext` et la fonction `questionId`, et **conserver l'effet de bord** qui leur était attaché, avec son commentaire d'origine :

```ts
/* L'identifiant RETENU devient celui de la question. Sans ça, un slug
   dérivé du titre était écrit dans la note mais oublié en mémoire : la
   retouche suivante du titre le recalculait, et l'ancre HTML comme les
   résultats déjà sauvegardés pointaient dans le vide (revue codex
   2026-07-31). */
q._sourceId = id;
```

- [ ] **Step 5: Vérifier que rien n'a bougé**

Run: `npm run check && npm run check:export && npm run check:md`
Expected: PASS partout.

Run: `node scripts/audit-vaults.mjs "C:/obsidian-vaults/Personal" "C:/obsidian-vaults/Efrei"`
Expected: aucun champ perdu, aucun bloc illisible. **C'est le seul filet contre une perte silencieuse à l'aller-retour ; s'il signale quoi que ce soit, la tâche n'est pas finie.**

- [ ] **Step 6: Commit**

```bash
git add src/quiz-ids.ts src/editor/export.ts scripts/check-export.mjs
git commit -m "refactor(ids): une seule regle d'identite, partagee lecture/ecriture"
```

---

### Task 6: Le scanner retient les questions

**Exécutant : Codex.** Tâche mécanique, cadrée par des types.

**Files:**
- Modify: `src/dashboard/scanner.ts` (`RawQuizItem`, `QuizMeta`, `parseQuizMeta`)

**Interfaces:**
- Consumes: `assignQuestionIds` (Task 5), `QuestionRole` (`src/types/quiz.ts`).
- Produces: `QuizMeta.items: QuizItemRef[]` où `interface QuizItemRef { id: string; role?: QuestionRole; slice?: number }`, disponible sur chaque `QuizIndexEntry`.

- [ ] **Step 1: Étendre `RawQuizItem`**

Ajouter les trois champs que le catalogue de l'ordonnanceur consomme :

```ts
	title?: string;
	role?: string;
	slice?: number;
```

- [ ] **Step 2: Déclarer `QuizItemRef` et l'ajouter à `QuizMeta`**

```ts
/**
 * Référence légère d'une question, pour l'ORDONNANCEUR.
 *
 * Le scanner parse déjà chaque bloc mais n'en retenait que le NOMBRE de
 * questions. Relire les notes à chaque calcul de plan referait un travail
 * déjà fait ; le coût de ces entrées est d'environ 70 Ko pour les 774
 * questions des vaults réels.
 */
export interface QuizItemRef {
	/** Identifiant attribué par la MÊME règle qu'à l'écriture (quiz-ids.ts) :
	    une clé de lecture qui divergerait ferait perdre l'historique à la
	    première sauvegarde depuis l'éditeur. */
	id: string;
	role?: QuestionRole;
	slice?: number;
}
```

et dans `QuizMeta` : `items: QuizItemRef[];`

- [ ] **Step 3: Remplir `items` dans `parseQuizMeta`**

Juste après le calcul de `questions` (le tableau filtré, avant le `return`) :

```ts
	// Les identifiants sont attribués sur le bloc ENTIER, en une passe : la
	// déduplication dépend de l'ensemble, pas de chaque question isolée.
	const ids = assignQuestionIds(questions.map(q => ({ id: q.id, title: q.title })));
	const items: QuizItemRef[] = questions.map((q, i) => ({
		id: ids[i],
		...(typeof q.role === "string" ? { role: q.role as QuestionRole } : {}),
		...(typeof q.slice === "number" ? { slice: q.slice } : {}),
	}));
```

et ajouter `items` à l'objet retourné, à côté de `questions: questions.length`.

- [ ] **Step 4: Vérifier**

Run: `npm run check`
Expected: aucune erreur. Le champ étant non optionnel sur `QuizMeta`, toute construction oubliée d'un `QuizIndexEntry` échoue à la compilation — c'est voulu.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/scanner.ts
git commit -m "feat(scanner): retenir les questions d'un bloc, pas seulement leur nombre"
```

---

### Task 7: L'adaptateur Obsidian

**Files:**
- Create: `src/dashboard/review-store.ts`
- Modify: `src/plugin.ts` (instanciation, `_reviewStore`, `onunload`)

**Interfaces:**
- Consumes: tout `src/scheduler/index.ts` (Task 4), `Scanner`/`QuizIndexEntry`/`QuizItemRef` (Task 6), `ModuleOverride.examDate` (Task 9 — écrire le code qui le lit dès maintenant, avec `?.` : le champ arrive en Task 9 et le typage l'accepte optionnel).
- Produces:
```ts
export interface ReviewStore {
	load(): Promise<void>;
	/** Journalise des réponses. Ajoute `t` et `at`, écrit en ajout différé. */
	record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void;
	/** Plan du jour, calculé à l'instant donné. */
	plan(now: number): Plan;
	/** Clé opaque d'une question : `chemin::id`. */
	keyOf(path: string, id: string): string;
	destroy(): void;
}
export function createReviewStore(plugin: ReviewStorePlugin, scanner: Scanner): ReviewStore
```

- [ ] **Step 1: Écrire `src/dashboard/review-store.ts`**

```ts
import type { Plugin, TFile } from "obsidian";
import type { Scanner } from "./scanner";
import type { ModuleOverride } from "./quiz-modules";
import {
	DEFAULT_PARAMS, formatLine, parseLog, planToday,
	type LogLine, type Plan, type ReviewEvent, type ReviewGrade, type ScheduledItem,
} from "../scheduler";
import type { QuestionRole } from "../types/quiz";

/* ══════════════════════════════════════════════════════════
   ADAPTATEUR DE L'ORDONNANCEUR — la seule partie qui connaît Obsidian.
   Le noyau (src/scheduler/) ne voit que des chaînes opaques et des
   nombres ; ce fichier lit et écrit les octets, construit le catalogue
   depuis le scanner, et suit les renommages. Il vit dans dashboard/ PARCE
   QUE c'est le dossier que le chantier 4 supprime.
══════════════════════════════════════════════════════════ */

const NOM_FICHIER = "review-log.jsonl";
const DEBOUNCE_MS = 500;

export interface ReviewStorePlugin extends Plugin {
	settings: { quizzesModuleOverrides?: Record<string, ModuleOverride> };
}

export interface ReviewStore {
	load(): Promise<void>;
	record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void;
	plan(now: number): Plan;
	keyOf(path: string, id: string): string;
	destroy(): void;
}

export function createReviewStore(plugin: ReviewStorePlugin, scanner: Scanner): ReviewStore {
	let lignes: LogLine[] = [];
	let enAttente: LogLine[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;

	/* Le journal vit à côté du greffon, PAS dans data.json : Obsidian
	   réécrit le fichier de réglages en ENTIER à chaque saveSettings(), et
	   un journal d'un mégaoctet réécrit toutes les 500 ms pendant une
	   session de révision serait mauvais. */
	const chemin = (): string => `${plugin.manifest.dir ?? ""}/${NOM_FICHIER}`;

	async function load(): Promise<void> {
		try {
			const texte = await plugin.app.vault.adapter.read(chemin());
			const { lines, ignored } = parseLog(texte);
			lignes = lines;
			// Une corruption est ANORMALE : elle doit se voir dans la console,
			// sans jamais empêcher le reste du journal de servir.
			if (ignored) console.warn(`[quiz-blocks] journal de révision : ${ignored} ligne(s) illisible(s), ignorée(s)`);
		} catch {
			lignes = []; // premier démarrage : le fichier n'existe pas encore
		}
	}

	function ecrireBientot(): void {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
	}

	async function flush(): Promise<void> {
		timer = null;
		if (!enAttente.length) return;
		const lot = enAttente;
		enAttente = [];
		try {
			// AJOUT, jamais réécriture : un ajout de quelques dizaines d'octets
			// ne court pas le risque qu'une fermeture d'Obsidian le tronque.
			await plugin.app.vault.adapter.append(chemin(), lot.map(formatLine).join(""));
		} catch (e) {
			// Remettre en file plutôt que perdre : la prochaine écriture réessaie.
			enAttente = [...lot, ...enAttente];
			console.error("[quiz-blocks] écriture du journal de révision impossible", e);
		}
	}

	function record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void {
		if (!entries.length) return;
		const at = Date.now();
		for (const e of entries) {
			const ligne: ReviewEvent = { t: "answer", q: e.q, at, grade: e.grade };
			if (e.role) ligne.role = e.role;
			lignes.push(ligne);
			enAttente.push(ligne);
		}
		ecrireBientot();
	}

	const keyOf = (path: string, id: string): string => `${path}::${id}`;

	/** Dossier parent d'une note : la clé de module de l'ordonnanceur. */
	const moduleOf = (path: string): string => {
		const i = path.lastIndexOf("/");
		return i < 0 ? "" : path.slice(0, i);
	};

	/** Catalogue : ce qui EXISTE aujourd'hui, d'après le scanner. */
	function catalogue(): ScheduledItem[] {
		const out: ScheduledItem[] = [];
		for (const quiz of scanner.getQuizzes()) {
			const mod = moduleOf(quiz.path);
			for (const it of quiz.items) {
				const item: ScheduledItem = {
					q: keyOf(quiz.path, it.id),
					module: mod,
					// La TRANCHE fait la famille quand elle existe : deux
					// questions de tranches différentes d'un même chapitre sont
					// ce qu'il y a de plus proche d'items confusables, tant
					// qu'aucun `topic` n'est déclaré par le contenu.
					source: typeof it.slice === "number" ? `${quiz.path}#${it.slice}` : quiz.path,
				};
				if (it.role) item.role = it.role;
				out.push(item);
			}
		}
		return out;
	}

	/** Horizons : la date d'examen saisie par module (Task 9). */
	function horizons(): Record<string, number | null> {
		const out: Record<string, number | null> = {};
		const overrides = plugin.settings.quizzesModuleOverrides || {};
		for (const [dossier, ov] of Object.entries(overrides)) {
			const brut = ov.examDate;
			if (typeof brut !== "string" || !brut) continue;
			// Minuit LOCAL du jour de l'examen : `new Date("2026-01-05")` serait
			// interprété en UTC et décalerait la date d'un jour selon le fuseau.
			const [a, m, j] = brut.split("-").map(Number);
			if (!a || !m || !j) continue;
			const ts = new Date(a, m - 1, j).getTime();
			/* Une date invalide vaut NaN, et NaN traverse `horizonFor` en
			   silence (`typeof NaN === "number"`, et `NaN <= now` est faux) :
			   tout le module se retrouverait planifié sur des échéances NaN.
			   La garde est ICI, pas dans le noyau : c'est l'adaptateur qui
			   touche des données saisies (revue task 1, 2026-09-02). */
			if (!Number.isFinite(ts)) continue;
			out[dossier] = ts;
		}
		return out;
	}

	function plan(now: number): Plan {
		const d = new Date(now);
		// Seul l'hôte connaît le fuseau : le noyau ne manipule aucun calendrier.
		const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
		return planToday({
			now, dayStart, items: catalogue(), events: lignes,
			horizons: horizons(), params: DEFAULT_PARAMS,
		});
	}

	/* Le renommage suit la note, comme dans stats-store.ts, et pour la même
	   raison : la clé contient le CHEMIN. Une LIGNE de journal plutôt qu'une
	   réécriture — le fichier reste en ajout seul, et deux appareils qui
	   fusionnent leurs journaux n'ont rien à réconcilier.
	   Branché sur l'événement du VAULT et non sur l'action de menu : les deux
	   chemins de renommage sont couverts d'un coup. */
	plugin.registerEvent(plugin.app.vault.on("rename", (file: TFile, oldPath: string) => {
		if (oldPath === file.path) return;
		const ligne: LogLine = { t: "rename", from: oldPath, to: file.path, at: Date.now() };
		lignes.push(ligne);
		enAttente.push(ligne);
		ecrireBientot();
	}));

	function destroy(): void {
		if (timer) { clearTimeout(timer); timer = null; }
		void flush();
	}

	return { load, record, plan, keyOf, destroy };
}
```

- [ ] **Step 2: Instancier dans `src/plugin.ts`**

À côté de `_statsStore` (chercher `createStatsStore`), après la création du scanner :

```ts
this._reviewStore = createReviewStore(this, this._scanner);
void this._reviewStore.load();
```

et dans `onunload` : `this._reviewStore?.destroy();`

Déclarer le champ **à deux endroits** : sur la classe `InteractiveQuizPlugin`, et sur l'interface `DashboardPlugin` (`src/types/dashboard-ctx.ts:106`) à côté de `_scanner` et `_statsStore` — sans quoi la Task 10 ne peut pas lire `ctx.plugin._reviewStore`. Le moteur, lui, garde la lecture par cast qu'il utilise déjà pour `_statsStore` : `EngineCtx.plugin` reste un `Plugin` nu.

Avec le commentaire qui dit pourquoi il est distinct de `_statsStore` :

```ts
	/** Journal de révision par QUESTION (ordonnanceur). Distinct de
	    `_statsStore`, qui reste la progression par QUIZ pour l'affichage :
	    deux systèmes, deux questions différentes, à ne pas fusionner. */
	_reviewStore?: ReviewStore;
```

- [ ] **Step 3: Vérifier**

Run: `npm run check`
Expected: aucune erreur. `ModuleOverride.examDate` n'existe pas encore (Task 9) : le déclarer **maintenant** dans `quiz-modules.ts` (`examDate?: string;`) plutôt que de contourner par un `as`.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/review-store.ts src/dashboard/quiz-modules.ts src/types/dashboard-ctx.ts src/plugin.ts
git commit -m "feat(review): adaptateur Obsidian du journal de revision"
```

---

### Task 8: Le moteur enregistre les réponses

**Files:**
- Modify: `src/types/quiz.ts` (`QuizState.recorded`)
- Modify: `src/types/engine-ctx.ts` (`reviewSink`)
- Modify: `src/engine.ts` (init de `recorded`, injection du sink, calcul de `questionIds`)
- Modify: `src/engine/state.ts` (`goToResults`, `resetQuiz`)
- Modify: `src/engine/text-only.ts` (bouton d'auto-évaluation)

**Interfaces:**
- Consumes: `ReviewStore.record` et `ReviewStore.keyOf` (Task 7).
- Produces: rien pour les tâches suivantes.

**Rappel de conception** : `quizState.locked` est **global au quiz**. Une question de QCM n'est jamais verrouillée seule, donc son verdict n'existe qu'à la soumission. En mode texte, au contraire, l'auto-évaluation donne un verdict par question. D'où deux points d'enregistrement, et un seul drapeau pour éviter le double comptage.

- [ ] **Step 1: Ajouter `recorded` à `QuizState`**

```ts
	/**
	 * Questions DÉJÀ journalisées pour l'ordonnanceur pendant cette session.
	 *
	 * Une auto-évaluation journalise immédiatement (le verdict existe) ;
	 * la soumission journalise tout le reste. Sans ce drapeau, une question
	 * notée à la main serait comptée deux fois, et sa seconde entrée
	 * ferait croître son intervalle à quelques secondes d'intervalle.
	 * Remis à zéro par `resetQuiz`, comme `resultsCounted`.
	 */
	recorded: boolean[];
```

L'initialiser dans le littéral `quizState` d'`engine.ts` (`recorded: []`) et dans `resetQuiz` (`ctx.quizState.recorded = ctx.quiz.map(() => false);`), au même endroit que les autres tableaux par question.

- [ ] **Step 2: Déclarer le puits dans `types/engine-ctx.ts`**

```ts
	/**
	 * Puits du journal de révision. Le moteur ne connaît que cette FORME,
	 * jamais l'implémentation — exactement comme `StatsStoreLike`. C'est ce
	 * qui permettra au moteur de servir tel quel dans les applications PC et
	 * Android, où le journal ne sera pas un fichier du vault.
	 */
	reviewSink?: {
		record(entries: Array<{ q: string; grade: ReviewGrade; role?: QuestionRole }>): void;
		keyOf(path: string, id: string): string;
	};
```

Injecté dans `engine.ts` au moment de l'assemblage du `ctx`, par la même lecture indirecte que `_statsStore` (`engine/state.ts:6`) — le moteur ne dépend d'aucun type du tableau de bord :

```ts
	reviewSink: (plugin as { _reviewStore?: EngineCtx["reviewSink"] })._reviewStore,
```

- [ ] **Step 3: Enregistrer à l'auto-évaluation (`engine/text-only.ts`)**

Dans le gestionnaire de clic des boutons de note, après `ctx.quizState.textOnlyRatings[qi] = rating;` :

```ts
				// Le verdict existe MAINTENANT : c'est ici, et pas à l'écran de
				// résultats, qu'une restitution devient un signal de mémoire.
				ctx.recordReview?.(qi, rating);
```

où `recordReview(i, grade)` est une fonction ajoutée à `engine/state.ts` (exposée sur `ctx`) :

```ts
	/**
	 * Journalise UNE question pour l'ordonnanceur, une seule fois par
	 * session. `sourcePath` absent (aperçu de l'éditeur, quiz en mémoire non
	 * encore enregistré) : rien à journaliser, la question n'a pas de clé
	 * stable.
	 */
	function recordReview(i: number, grade: ReviewGrade): void {
		if (!ctx.reviewSink || !ctx.sourcePath) return;
		if (ctx.quizState.recorded[i]) return;
		const id = ctx.questionIds[i];
		if (!id) return;
		ctx.quizState.recorded[i] = true;
		const role = ctx.isLessonMode() ? ctx.roleOfQuestion(i) : undefined;
		ctx.reviewSink.record([{ q: ctx.reviewSink.keyOf(ctx.sourcePath, id), grade, ...(role ? { role } : {}) }]);
	}
```

**`ctx.questionIds`, et surtout PAS `ctx.quiz[i].id`** (ruling préflight 3, 2026-09-02). Les trois questions des vaults qui n'ont pas d'`id` explicite en reçoivent un du scanner (`q3`, dérivé du titre) : si le moteur lisait l'`id` brut, il ne journaliserait rien pour elles, alors qu'elles figureraient au catalogue. Éternellement neuves, elles reviendraient dans « à réviser » tous les jours sans jamais pouvoir en sortir.

Le moteur dérive donc les identifiants du bloc **par la même règle que l'écriture**, à l'assemblage du `ctx` dans `engine.ts` :

```ts
	/* Identité des questions pour l'ordonnanceur. La MÊME règle qu'à
	   l'écriture (editor/export.ts) et qu'à la lecture par le scanner :
	   trois règles séparées divergeraient, et une question changerait de
	   clé selon qui la regarde. `quiz-ids.ts` est un module pur — aucune
	   dépendance ajoutée au moteur. */
	questionIds: assignQuestionIds(quiz.map(q => ({ id: q.id, title: q.title }))),
```

et le déclare dans `types/engine-ctx.ts` : `questionIds: string[];`

- [ ] **Step 4: Enregistrer le reste à la soumission (`engine/state.ts`, dans `goToResults`)**

Juste après le bloc `statsStore.updateRecord(...)`, à l'intérieur de la même garde `resultsCounted` :

```ts
			/* L'ordonnanceur, lui, compte PAR QUESTION. Une carte "read" n'est
			   ni juste ni fausse (`seen`), une pré-question abandonnée non plus
			   (`skipped`) : ces deux-là sont journalisées pour que l'historique
			   soit complet, mais elles ne produisent aucun signal de mémoire
			   (scheduler/state.ts signalOf). */
			for (let i = 0; i < ctx.quiz.length; i++) {
				if (ctx.quizState.recorded[i]) continue;
				const role = ctx.isLessonMode() ? ctx.roleOfQuestion(i) : undefined;
				let grade: ReviewGrade;
				if (role === "read") grade = "seen";
				else if (ctx.quizState.lessonPreSkipped[i]) grade = "skipped";
				else if (!isComplete(i)) continue; // sans réponse : rien ne s'est passé
				else grade = isCorrect(i) ? "correct" : "wrong";
				recordReview(i, grade);
			}
```

- [ ] **Step 5: Vérifier**

Run: `npm run check`
Expected: aucune erreur.

Run: `npm run build`, puis dans Obsidian : ouvrir un quiz, répondre, soumettre. Vérifier que `.obsidian/plugins/quiz-blocks/review-log.jsonl` existe et contient une ligne par question.

```bash
cat "C:/obsidian-vaults/Efrei/.obsidian/plugins/quiz-blocks/review-log.jsonl" | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/types/quiz.ts src/types/engine-ctx.ts src/engine.ts src/engine/state.ts src/engine/text-only.ts
git commit -m "feat(engine): journaliser chaque reponse pour l'ordonnanceur"
```

---

### Task 9: La date d'examen par module

**Exécutant : Codex.** Un champ dans un modal existant, deux clés de traduction.

**Files:**
- Modify: `src/dashboard/module-edit.ts` (un champ dans `ModuleEditModal`)
- Modify: `src/i18n/en/dashboard.ts`, `src/i18n/fr/dashboard.ts`
- (`ModuleOverride.examDate` a déjà été déclaré en Task 7.)

- [ ] **Step 1: Ajouter les deux clés de traduction**

`src/i18n/en/dashboard.ts` :

```ts
	/* ── Date d'examen (ordonnanceur) ── */
	"dashboard.module.examDate": "Exam date",
	"dashboard.module.examDateHint": "Sets how tightly this module is reviewed. Left empty, it is scheduled for long-term retention.",
```

`src/i18n/fr/dashboard.ts` :

```ts
	/* ── Date d'examen (ordonnanceur) ── */
	"dashboard.module.examDate": "Date d'examen",
	"dashboard.module.examDateHint": "Détermine le resserrement des révisions. Laissée vide, la matière est révisée pour être retenue durablement.",
```

- [ ] **Step 2: Ajouter le champ au modal**

Dans `ModuleEditModal.onOpen`, après le champ « UE » et avant le sélecteur de couleur, un `<input type="date">` natif (Obsidian n'a pas de contrôle de date, et la règle « jamais de `<select>` natif » ne concerne que les listes déroulantes) :

```ts
		// La date d'examen pilote l'horizon de rétention de l'ordonnanceur :
		// 20 à 40 % de l'échéance pour une semaine, 5 à 10 % pour un an
		// (Cepeda 2008). Vide = horizon durable, jamais deviné ailleurs.
		const dateWrap = content.createDiv({ cls: "qbd-medit-field" });
		dateWrap.createEl("label", { cls: "qbd-medit-label", text: t("dashboard.module.examDate") });
		const dateInput = dateWrap.createEl("input", { cls: "qbd-medit-input", type: "date" });
		dateInput.value = this.examDate ?? "";
		dateInput.addEventListener("change", () => {
			this.examDate = dateInput.value || undefined;
			this.apply();
		});
		dateWrap.createEl("p", { cls: "qbd-medit-hint", text: t("dashboard.module.examDateHint") });
```

Déclarer `private examDate?: string;`, l'initialiser depuis l'override existant dans le constructeur ou `onOpen`, et l'écrire dans `apply()` à côté de `name`, `ue`, `color`, `icon` — **en supprimant la clé quand la valeur est vide**, pour ne pas laisser `examDate: ""` traîner dans les réglages.

Réutiliser les classes CSS des champs existants du modal ; n'en créer une nouvelle que si `qbd-medit-hint` n'existe pas déjà.

- [ ] **Step 3: Vérifier**

Run: `npm run check`
Expected: aucune erreur. Une clé oubliée dans le dictionnaire français est une **erreur de compilation**, pas un texte anglais dans l'interface française.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/module-edit.ts src/i18n/en/dashboard.ts src/i18n/fr/dashboard.ts
git commit -m "feat(dashboard): date d'examen par module, horizon de l'ordonnanceur"
```

---

### Task 10: La carte « À réviser » sur l'accueil

**Exécutant : Codex, revue par Claude.** Le contrat visuel du tableau de bord est strict, la revue porte sur lui.

**Files:**
- Modify: `src/dashboard/home.ts`
- Modify: `src/i18n/en/dashboard.ts`, `src/i18n/fr/dashboard.ts`
- Modify: `src/assets/css/dashboard/dashboard-home.css` (ou le fichier de l'accueil existant — **jamais `dashboard-ai.css`**)

**Contraintes de contrat visuel** (mémoire projet, à ne pas enfreindre) :
- une seule anatomie de carte, une seule pilule claire par page ;
- **aucune barre de progression** sur une carte de dossier ni une tuile de stats ;
- pas de fond propre sur `.qbd-content` ;
- toute surface verre passe par les tokens `--qbd-glass-*`, jamais de `rgba` en dur ;
- icônes Lucide via `setIcon()`.

- [ ] **Step 1: Ajouter les clés de traduction**

`src/i18n/en/dashboard.ts` :

```ts
	/* ── À réviser aujourd'hui (ordonnanceur) ── */
	"dashboard.review.title": "Due today",
	"dashboard.review.emptyTitle": "Nothing due today",
	"dashboard.review.emptyBody": "Play a quiz and it will come back at the right time.",
	"dashboard.review.countOne": "{count} question due",
	"dashboard.review.countOther": "{count} questions due",
	"dashboard.review.deferredOne": "{count} more, held back for tomorrow",
	"dashboard.review.deferredOther": "{count} more, held back for tomorrow",
```

`src/i18n/fr/dashboard.ts` :

```ts
	/* ── À réviser aujourd'hui (ordonnanceur) ── */
	"dashboard.review.title": "À réviser aujourd'hui",
	"dashboard.review.emptyTitle": "Rien à réviser aujourd'hui",
	"dashboard.review.emptyBody": "Jouez un quiz : il reviendra au bon moment.",
	"dashboard.review.countOne": "{count} question due",
	"dashboard.review.countOther": "{count} questions dues",
	"dashboard.review.deferredOne": "{count} de plus, gardée pour demain",
	"dashboard.review.deferredOther": "{count} de plus, gardées pour demain",
```

- [ ] **Step 2: Rendre la section dans `home.ts`**

Entre la grille de stats et les sections de quiz, une section qui suit **exactement** l'anatomie des sections existantes (`qbd-home-section`, en-tête à rangée de 52 px, chevron, libellé 16 px, badge compteur) :

```ts
		/* ── À réviser aujourd'hui ──
		   L'ordonnanceur rend des CLÉS de question (`chemin::id`) ; l'accueil
		   les regroupe par note pour rester actionnable — le seul geste
		   possible aujourd'hui est d'ouvrir un quiz. La session composée de
		   questions venant de plusieurs notes est le chantier suivant. */
		const plan = ctx.plugin._reviewStore?.plan(Date.now());
		if (plan && plan.today.length) {
			const parNote = new Map<string, number>();
			for (const cle of plan.today) {
				const path = cle.slice(0, cle.lastIndexOf("::"));
				parNote.set(path, (parNote.get(path) ?? 0) + 1);
			}

			const section = container.createDiv({ cls: "qbd-home-section" });
			const head = section.createDiv({ cls: "qbd-home-node-row" });
			const titre = head.createSpan({ cls: "qbd-home-node-label" });
			titre.setText(t("dashboard.review.title"));
			const badge = head.createSpan({ cls: "qbd-home-node-badge" });
			badge.setText(t(
				plan.today.length === 1 ? "dashboard.review.countOne" : "dashboard.review.countOther",
				{ count: plan.today.length },
			));

			const body = section.createDiv({ cls: "qbd-review-list" });
			// Nombre décroissant, puis titre : ordre total, donc stable d'un
			// rendu à l'autre — l'ordre de `plan.today` sert la SESSION, pas
			// l'affichage.
			const lignes = [...parNote.entries()].sort(
				(a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
			);
			for (const [path, n] of lignes) {
				const quiz = ctx.scanner?.getQuiz(path);
				if (!quiz) continue; // note disparue entre le scan et le rendu
				const row = body.createDiv({ cls: "qbd-review-row" });
				const icone = row.createSpan({ cls: "qbd-review-icon" });
				setIcon(icone, "rotate-ccw");
				row.createSpan({ cls: "qbd-review-title", text: quiz.title });
				row.createSpan({
					cls: "qbd-review-count",
					text: t(n === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: n }),
				});
				row.addEventListener("click", () => openQuizForPlay(ctx.app, quiz));
			}

			/* Le report est une INFORMATION, pas un reproche : il dit que le
			   budget a tenu, pas que l'utilisateur est en retard. */
			if (plan.deferred.length) {
				body.createEl("p", {
					cls: "qbd-review-deferred",
					text: t(
						plan.deferred.length === 1 ? "dashboard.review.deferredOne" : "dashboard.review.deferredOther",
						{ count: plan.deferred.length },
					),
				});
			}
		}
```

Les classes `qbd-home-section`, `qbd-home-node-row`, `qbd-home-node-label` et `qbd-home-node-badge` existent déjà pour les sections de quiz : les **réutiliser telles quelles**, ne pas en créer de variantes. Seules `qbd-review-list`, `qbd-review-row`, `qbd-review-icon`, `qbd-review-title`, `qbd-review-count` et `qbd-review-deferred` sont à écrire, en reprenant les tokens de l'accueil.

`dashboard.review.emptyTitle` et `dashboard.review.emptyBody` ne sont **pas** consommées par ce bloc : quand rien n'est dû, la section n'apparaît pas du tout. Les deux clés servent au cas où l'accueil est **vide par ailleurs** (aucun quiz encore joué) ; si l'accueil a déjà un état d'accueil pour ce cas, **supprimer ces deux clés** plutôt que de laisser du vocabulaire mort dans les dictionnaires.

Le compteur utilise les deux clés `…One` / `…Other`, jamais un « s » concaténé.

- [ ] **Step 3: Vérifier**

Run: `npm run check && npm run build`

Puis dans Obsidian : recharger le greffon, ouvrir le tableau de bord, vérifier que la section apparaît après avoir joué un quiz, et qu'elle disparaît proprement quand rien n'est dû.

```powershell
obsidian plugin:reload id=quiz-blocks
```

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/home.ts src/i18n/en/dashboard.ts src/i18n/fr/dashboard.ts src/assets/css/dashboard/
git commit -m "feat(dashboard): section « a reviser aujourd'hui » sur l'accueil"
```

---

### Task 11: Vérification de bout en bout

**Files:** aucun (sauf correctifs).

- [ ] **Step 1: Toute la batterie**

```bash
npm run check
npm run check:md
npm run check:export
npm run check:lesson
npm run check:scheduler
node scripts/audit-vaults.mjs "C:/obsidian-vaults/Personal" "C:/obsidian-vaults/Efrei"
```

Expected: tout passe. `audit-vaults` ne doit signaler **aucun** champ perdu : Task 5 a touché `export.ts`.

- [ ] **Step 2: Vérifier la pureté une dernière fois, sur le bundle**

Le contrôle de la Task 1 lit les fichiers source. Confirmer que le noyau n'a acquis aucune dépendance par transitivité :

```bash
npx esbuild src/scheduler/index.ts --bundle --format=esm --platform=neutral --outfile=/dev/null --log-level=warning
```

Expected: aucune erreur, aucun avertissement de résolution — le noyau se bundle **sans le stub `obsidian`**, preuve qu'il n'en dépend par aucun chemin.

- [ ] **Step 3: Build et rechargement**

```bash
npm run build
```

```powershell
obsidian plugin:reload id=quiz-blocks
```

- [ ] **Step 4: Parcours manuel dans Obsidian**

1. Jouer un quiz jusqu'aux résultats → le journal contient une ligne par question.
2. Rouvrir le tableau de bord → la section « À réviser » n'affiche **rien** pour ce quiz (il vient d'être révisé, son échéance est dans un jour).
3. Poser une date d'examen à trois jours sur le module → rouvrir : les échéances se resserrent.
4. Renommer la note → le journal reçoit une ligne `rename`, et l'historique suit.
5. Jouer une Leçon avec auto-évaluation → une ligne par restitution, au moment de la note et non à la fin.

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "chore(scheduler): verification de bout en bout du chantier 1"
```
