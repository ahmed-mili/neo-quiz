# Générer un quiz depuis Android — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de lancer une génération de quiz depuis Obsidian Android, en faisant exécuter le CLI par un PC qui a le vault en partage.

**Architecture:** Le vault est le canal. Le téléphone dépose une demande dans `.quiz-blocks-jobs/`, Syncthing la porte, un PC désigné la traite avec le chemin de génération existant et écrit le résultat, Syncthing le ramène. Le relais est **un `AiClient` de plus, avec la même interface** que le client CLI — le composer ne change donc presque pas.

**Tech Stack:** TypeScript strict (ESM), esbuild, API Obsidian (`vault.adapter`). Pas de framework de test : les vérifications sont des `scripts/check-*.mjs` qui chargent le CODE RÉEL via `scripts/lib/load-src.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-02-mobile-generation-design.md`

## Global Constraints

- **Un fichier par message, un seul auteur par fichier.** Aucun fichier n'est jamais réécrit par l'autre côté — c'est la seule forme qui ne peut pas produire de `sync-conflict`. Le `.stignore` d'Ahmed a été écrit après une vague de treize conflits.
- **Le canal est `.quiz-blocks-jobs/` à la RACINE du vault**, jamais dans `.obsidian/`.
- **Écriture par `vault.adapter`**, jamais par `vault.create`, qui refuse les chemins commençant par un point.
- **Détection par interrogation régulière**, jamais par les événements du vault : un dossier en point n'est pas indexé par Obsidian, aucun événement ne s'y déclenche.
- **Jamais de chaîne visible en dur.** Tout par `t("<domaine>.<clé>")`. L'anglais (`src/i18n/en/*.ts`) est la RÉFÉRENCE ; le français est typé `Record<keyof typeof EN_X, string>` — une clé d'un seul côté est une erreur de compilation.
- **`t()` est appelé AU RENDU**, jamais dans une constante top-level.
- **Ne jamais traduire** les clés du protocole (`v`, `id`, `prompt`, `provider`, `model`, `language`, `ok`, `questions`, `error`) : ce sont des données écrites sur disque et lues par un autre appareil.
- **Le plugin reste mobile** : `isDesktopOnly` reste `false`. Aucun `require` de module Node hors d'un chemin gardé par `Platform.isDesktopApp`.
- **Modules < ~350 lignes.**
- **Non-régression absolue** : sur desktop, le composer doit se comporter exactement comme aujourd'hui.
- **`npm run check` après chaque tâche.**
- **Travail sur `main`**, commits directs, jamais de `git push`.
- **`src/assets/css/dashboard/dashboard-ai.css` porte une modification hors chantier : ne pas la commiter, ne pas y toucher.**

---

### Task 1: Le protocole (logique pure)

**Files:**
- Create: `src/relay/protocol.ts`
- Create: `scripts/check-relay.mjs`
- Modify: `package.json` (script `check:relay`)

**Interfaces:**
- Consumes: rien.
- Produces: `RELAY_DIR`, `RELAY_PROTOCOL_VERSION`, types `RelayRequest` / `RelayClaim` / `RelayResult`, et les fonctions pures `relayFileName`, `parseRelayFileName`, `newRequestId`, `requestIdTime`, `groupRelayFiles`, `selectRelayWork`, `isClaimStale`, `relayStatus`, `isSupportedVersion`.

**Pourquoi tout est pur ici.** Ce module ne touche ni au disque ni à Obsidian. C'est ce qui rend le protocole vérifiable sans téléphone, sans Syncthing et sans PC — et le protocole est la seule partie où une erreur se paierait des deux côtés à la fois.

- [ ] **Step 1: Écrire les cas qui échouent**

Créer `scripts/check-relay.mjs` sur le modèle de `scripts/check-lesson.mjs` (le lire d'abord : il utilise `withSrcModule` de `scripts/lib/load-src.mjs` et un helper de rapport ; ces scripts appellent `process.exitCode`, JAMAIS `process.exit()`).

```js
// L'identifiant porte SON PROPRE horodatage : l'âge d'une demande se lit
// dans son nom, sans jamais interroger le système de fichiers.
const id = m.newRequestId(Date.UTC(2026, 8, 2, 6, 7, 12), "a1b2c3");
r.check("id horodaté", id === "20260902T060712-a1b2c3", id);
r.check("relecture de l'heure", m.requestIdTime(id) === Date.UTC(2026, 8, 2, 6, 7, 12));
r.check("id inconnu → null", m.requestIdTime("n-importe-quoi") === null);

// Noms de fichiers : aller et retour.
r.check("nom", m.relayFileName(id, "request") === `${id}.request.json`);
const parsed = m.parseRelayFileName(`${id}.claim.json`);
r.check("analyse", parsed && parsed.id === id && parsed.kind === "claim");
r.check("intrus ignoré", m.parseRelayFileName("README.md") === null);

// Sélection du travail, sur les NOMS seuls.
const now = Date.UTC(2026, 8, 2, 7, 0, 0);
const noms = [
  "20260902T065900-aaa.request.json",                                    // à traiter
  "20260902T065901-bbb.request.json", "20260902T065901-bbb.result.json", // terminée
  "20260101T000000-ccc.request.json",                                    // périmée
];
const work = m.selectRelayWork(noms, now, { maxAgeMs: 24 * 3600e3 });
r.check("une seule à traiter", work.pending.length === 1 && work.pending[0] === "20260902T065900-aaa");
r.check("la périmée est à supprimer", work.expired.includes("20260101T000000-ccc"));
r.check("la terminée n'est ni l'un ni l'autre",
  !work.pending.includes("20260902T065901-bbb") && !work.expired.includes("20260902T065901-bbb"));

// Réservation abandonnée : une machine qui a réclamé puis s'est arrêtée
// ne doit pas bloquer la demande pour toujours.
r.check("réservation fraîche", m.isClaimStale({ claimedAt: now - 60e3 }, now, 15 * 60e3) === false);
r.check("réservation abandonnée", m.isClaimStale({ claimedAt: now - 3600e3 }, now, 15 * 60e3) === true);

// Statut vu du téléphone.
r.check("en attente", m.relayStatus(["X.request.json"], "X") === "pending");
r.check("prise en charge", m.relayStatus(["X.request.json", "X.claim.json"], "X") === "claimed");
r.check("terminée", m.relayStatus(["X.request.json", "X.result.json"], "X") === "done");

// Version du protocole : les deux appareils peuvent porter des versions
// DIFFÉRENTES du plugin — Syncthing synchronise le vault, pas le greffon.
r.check("version connue", m.isSupportedVersion(1) === true);
r.check("version future refusée", m.isSupportedVersion(2) === false);
r.check("version absente refusée", m.isSupportedVersion(undefined) === false);
```

Ajouter dans `package.json` : `"check:relay": "node scripts/check-relay.mjs"`.

- [ ] **Step 2: Lancer et constater l'échec**

Run: `npm run check:relay`
Expected: FAIL — le module `src/relay/protocol.ts` n'existe pas.

- [ ] **Step 3: Écrire le module**

```ts
/**
 * Protocole du relais mobile — LOGIQUE PURE, aucun accès disque.
 *
 * Le vault est le canal : le téléphone dépose une demande, un PC la traite,
 * le résultat revient. Trois fichiers, trois auteurs, aucun jamais réécrit
 * par l'autre côté — c'est la seule forme qui ne peut pas produire de
 * `sync-conflict` (le .stignore d'Ahmed a été écrit après une vague de 13).
 */
export const RELAY_DIR = ".quiz-blocks-jobs";
export const RELAY_PROTOCOL_VERSION = 1;

export type RelayFileKind = "request" | "claim" | "result";

/** Écrite par le TÉLÉPHONE, jamais relue en écriture par lui. */
export interface RelayRequest {
	v: number; id: string; createdAt: number; device: string;
	prompt: string; provider: string; model: string; language: string;
}
/** Écrite par le PC travailleur. Sert d'ÉTAT, pas d'exclusion mutuelle
    (cf. spec §6 : c'est un réglage qui désigne la machine, pas une course). */
export interface RelayClaim { v: number; id: string; claimedAt: number; device: string; }
/** Écrit par le PC travailleur. Une erreur est un résultat comme un autre :
    sans elle, le téléphone attendrait indéfiniment. */
export type RelayResult =
	| { v: number; id: string; finishedAt: number; ok: true; questions: unknown[] }
	| { v: number; id: string; finishedAt: number; ok: false; error: string };

const ID_RE = /^(\d{8})T(\d{6})-([a-z0-9]+)$/;
const FILE_RE = /^(.+)\.(request|claim|result)\.json$/;

function pad(n: number, w: number): string { return String(n).padStart(w, "0"); }

/**
 * L'identifiant PORTE son horodatage, en UTC. Deux raisons : l'âge d'une
 * demande se lit dans son nom (aucun `stat` à faire, donc une sélection
 * purement fonctionnelle), et l'ordre lexicographique est l'ordre
 * chronologique. UTC et non l'heure locale : les appareils pourraient être
 * dans des fuseaux différents, et un tri qui dépend du fuseau du lecteur
 * serait faux.
 */
export function newRequestId(nowMs: number, rand: string): string {
	const d = new Date(nowMs);
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`
		+ `T${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${pad(d.getUTCSeconds(), 2)}`
		+ `-${rand}`;
}

export function requestIdTime(id: string): number | null {
	const m = ID_RE.exec(id);
	if (!m) return null;
	const [, d, t] = m;
	return Date.UTC(
		Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)),
		Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6))
	);
}

export function relayFileName(id: string, kind: RelayFileKind): string {
	return `${id}.${kind}.json`;
}

export function parseRelayFileName(name: string): { id: string; kind: RelayFileKind } | null {
	const m = FILE_RE.exec(name);
	if (!m) return null;
	return { id: m[1], kind: m[2] as RelayFileKind };
}

export function groupRelayFiles(names: readonly string[]): Map<string, Set<RelayFileKind>> {
	const out = new Map<string, Set<RelayFileKind>>();
	for (const name of names) {
		const p = parseRelayFileName(name);
		if (!p) continue;   // un intrus dans le dossier ne casse rien
		const set = out.get(p.id) ?? new Set<RelayFileKind>();
		set.add(p.kind);
		out.set(p.id, set);
	}
	return out;
}

/**
 * Décide, sur les NOMS SEULS, ce qu'il y a à faire. La réservation n'entre
 * pas dans ce calcul : sa fraîcheur exige de lire le fichier, ce qui est le
 * travail de `isClaimStale`. Séparer les deux garde cette fonction pure et
 * testable sans disque.
 */
export function selectRelayWork(
	names: readonly string[], nowMs: number, opts: { maxAgeMs: number }
): { pending: string[]; expired: string[] } {
	const pending: string[] = [];
	const expired: string[] = [];
	for (const [id, kinds] of groupRelayFiles(names)) {
		const born = requestIdTime(id);
		if (born !== null && nowMs - born > opts.maxAgeMs) { expired.push(id); continue; }
		if (kinds.has("request") && !kinds.has("result")) pending.push(id);
	}
	pending.sort();   // l'ordre des ids EST l'ordre chronologique
	return { pending, expired };
}

/** Une machine qui a réclamé puis s'est arrêtée ne doit pas bloquer la
    demande pour toujours : passé ce délai, elle est reprise. */
export function isClaimStale(claim: { claimedAt: number }, nowMs: number, staleMs: number): boolean {
	return nowMs - claim.claimedAt > staleMs;
}

export function relayStatus(names: readonly string[], id: string): "pending" | "claimed" | "done" | "unknown" {
	const kinds = groupRelayFiles(names).get(id);
	if (!kinds) return "unknown";
	if (kinds.has("result")) return "done";
	if (kinds.has("claim")) return "claimed";
	if (kinds.has("request")) return "pending";
	return "unknown";
}

/** Les deux appareils peuvent porter des versions DIFFÉRENTES du plugin :
    Syncthing synchronise le vault, pas le greffon. Un refus explicite vaut
    mieux qu'un comportement approximatif sur un format inconnu. */
export function isSupportedVersion(v: unknown): boolean {
	return v === RELAY_PROTOCOL_VERSION;
}
```

- [ ] **Step 4: Vérifier**

Run: `npm run check:relay && npm run check`
Expected: les deux passent.

- [ ] **Step 5: Commit**

```bash
git add src/relay/protocol.ts scripts/check-relay.mjs package.json
git commit -m "feat(relay): protocole du relais mobile (logique pure)"
```

---

### Task 2: Le magasin de fichiers

**Files:**
- Create: `src/relay/store.ts`
- Modify: `scripts/check-relay.mjs`

**Interfaces:**
- Consumes: `RELAY_DIR`, `relayFileName`, `parseRelayFileName` (Task 1).
- Produces: `RelayAdapter` (interface structurelle), `RelayStore`, `createRelayStore(adapter, dir?)` avec les méthodes `ensureDir()`, `names()`, `readJson<T>(name)`, `writeJson(name, value)`, `remove(name)`.

**Pourquoi une interface structurelle.** `RelayAdapter` ne décrit que les cinq méthodes utilisées. Le `DataAdapter` d'Obsidian la satisfait sans adaptateur ni cast, et un substitut de test la satisfait aussi. Le substitut remplace alors le DISQUE, jamais la logique — c'est la distinction qui sépare un test utile d'un test qui vérifie son propre mannequin.

- [ ] **Step 1: Écrire les cas qui échouent**

Ajouter dans `scripts/check-relay.mjs` :

```js
// Substitut de disque : il répond à la place du système de fichiers,
// il ne remplace aucune logique du magasin.
function fauxDisque(initial = {}) {
	const f = new Map(Object.entries(initial));
	return {
		fichiers: f,
		exists: async (p) => p === ".quiz-blocks-jobs" || f.has(p),
		mkdir: async () => {},
		list: async (p) => ({ files: [...f.keys()].filter(k => k.startsWith(p + "/")), folders: [] }),
		read: async (p) => { if (!f.has(p)) throw new Error("ENOENT"); return f.get(p); },
		write: async (p, d) => { f.set(p, d); },
		remove: async (p) => { f.delete(p); },
	};
}

const d = fauxDisque({ ".quiz-blocks-jobs/X.request.json": '{"v":1,"id":"X"}' });
const store = m2.createRelayStore(d);
r.check("noms sans le dossier", (await store.names())[0] === "X.request.json");
r.check("lecture", (await store.readJson("X.request.json")).id === "X");

// Un fichier à moitié synchronisé ne doit JAMAIS faire tomber le relais :
// il sera complet au tour suivant.
d.fichiers.set(".quiz-blocks-jobs/Y.request.json", '{"v":1,"id":');
r.check("JSON tronqué → null, pas une exception", (await store.readJson("Y.request.json")) === null);
r.check("fichier absent → null", (await store.readJson("Z.request.json")) === null);

await store.writeJson("W.claim.json", { v: 1, id: "W" });
r.check("écriture", d.fichiers.has(".quiz-blocks-jobs/W.claim.json"));
await store.remove("W.claim.json");
r.check("suppression", !d.fichiers.has(".quiz-blocks-jobs/W.claim.json"));
```

- [ ] **Step 2: Lancer et constater l'échec**

Run: `npm run check:relay`
Expected: FAIL — `createRelayStore` n'existe pas.

- [ ] **Step 3: Écrire le module**

```ts
import { RELAY_DIR } from "./protocol";

/** Les CINQ méthodes du DataAdapter d'Obsidian que le relais utilise, et
    rien de plus. Une interface étroite : le vrai adaptateur la satisfait
    tel quel, un substitut de test aussi. */
export interface RelayAdapter {
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	list(path: string): Promise<{ files: string[] }>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
}

export interface RelayStore {
	ensureDir(): Promise<void>;
	names(): Promise<string[]>;
	readJson<T>(name: string): Promise<T | null>;
	writeJson(name: string, value: unknown): Promise<void>;
	remove(name: string): Promise<void>;
}

export function createRelayStore(adapter: RelayAdapter, dir: string = RELAY_DIR): RelayStore {
	const at = (name: string): string => `${dir}/${name}`;

	return {
		async ensureDir(): Promise<void> {
			if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
		},

		async names(): Promise<string[]> {
			if (!(await adapter.exists(dir))) return [];
			const listing = await adapter.list(dir);
			/* `list` rend des chemins COMPLETS ; le protocole raisonne sur des
			   noms. On coupe ici, une fois, plutôt que chez chaque appelant. */
			return listing.files.map(p => p.slice(p.lastIndexOf("/") + 1));
		},

		/* `null` plutôt qu'une exception, et c'est le point important de ce
		   module : Syncthing peut rendre un fichier VISIBLE avant qu'il soit
		   COMPLET. Un JSON tronqué n'est pas une erreur, c'est un fichier pas
		   encore arrivé — il sera lisible au tour d'interrogation suivant.
		   Lever ici ferait tomber le relais sur un incident de transport. */
		async readJson<T>(name: string): Promise<T | null> {
			try {
				return JSON.parse(await adapter.read(at(name))) as T;
			} catch {
				return null;
			}
		},

		async writeJson(name: string, value: unknown): Promise<void> {
			await adapter.write(at(name), JSON.stringify(value, null, 2));
		},

		async remove(name: string): Promise<void> {
			try { await adapter.remove(at(name)); } catch { /* déjà parti */ }
		},
	};
}
```

- [ ] **Step 4: Vérifier**

Run: `npm run check:relay && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/relay/store.ts scripts/check-relay.mjs
git commit -m "feat(relay): magasin de fichiers du canal"
```

---

### Task 3: Le client relais (côté téléphone)

**Files:**
- Create: `src/relay/client.ts`
- Modify: `scripts/check-relay.mjs`
- Modify: `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts`

**Interfaces:**
- Consumes: `RelayStore` (Task 2), `newRequestId`, `relayFileName`, `relayStatus`, `RelayRequest`, `RelayResult`, `RELAY_PROTOCOL_VERSION`, `isSupportedVersion` (Task 1).
- Produces: `createRelayClient(deps): AiClient` où `deps = { store: RelayStore; device: string; provider: string; model: string; language: string; now(): number; rand(): string; sleep(ms): Promise<void>; onStatus?(s: "pending" | "claimed"): void }`.

**Le point de conception.** `AiClient` (`src/dashboard/ai-client.ts:51-57`) est une interface de trois membres : `generate`, `abort`, `lastUsage`. Le relais l'implémente **à l'identique**. Le composer ne saura donc pas qu'il parle à un PC distant, et `startGeneration` garde intactes sa logique de verrou, sa bulle « envoyé » et sa comptabilité d'usage.

`lastUsage` vaut toujours `null` : la consommation a lieu sur le PC, et la spec (§10) exclut de la faire voyager. Le commentaire de `ai-client.ts:54-56` dit qu'on n'estime jamais un compteur absent — `null` est donc la valeur juste, pas un raccourci.

- [ ] **Step 1: Écrire les cas qui échouent**

Ajouter dans `scripts/check-relay.mjs` :

```js
// Le client écrit la demande, puis attend le résultat.
const d2 = fauxDisque();
const store2 = m2.createRelayStore(d2);
let tours = 0;
const client = m3.createRelayClient({
	store: store2, device: "phone", provider: "claude", model: "opus", language: "fr",
	now: () => Date.UTC(2026, 8, 2, 6, 7, 12), rand: () => "a1b2c3",
	sleep: async () => {
		tours++;
		// Le PC répond au deuxième tour.
		if (tours === 2) {
			await store2.writeJson("20260902T060712-a1b2c3.result.json",
				{ v: 1, id: "20260902T060712-a1b2c3", finishedAt: 0, ok: true, questions: [{ prompt: "Q" }] });
		}
	},
});
const questions = await client.generate("fais un quiz");
r.check("la demande a été écrite", d2.fichiers.has(".quiz-blocks-jobs/20260902T060712-a1b2c3.request.json"));
r.check("le résultat est rendu", questions.length === 1 && questions[0].prompt === "Q");

// Une ERREUR côté PC doit remonter comme une erreur, jamais comme une attente
// sans fin : c'est la garantie qui empêche le téléphone de tourner à vide.
const d3 = fauxDisque();
const store3 = m2.createRelayStore(d3);
const client3 = m3.createRelayClient({
	store: store3, device: "phone", provider: "claude", model: "opus", language: "fr",
	now: () => 0, rand: () => "zzz",
	sleep: async () => { await store3.writeJson("19700101T000000-zzz.result.json",
		{ v: 1, id: "19700101T000000-zzz", finishedAt: 0, ok: false, error: "CLI absent" }); },
});
let messageRecu = "";
try { await client3.generate("x"); } catch (e) { messageRecu = e.message; }
r.check("l'erreur du PC remonte", messageRecu.includes("CLI absent"));

// L'annulation suit la convention du client CLI (ai-client.ts:145-146).
const d4 = fauxDisque();
const client4 = m3.createRelayClient({
	store: m2.createRelayStore(d4), device: "phone", provider: "c", model: "m", language: "fr",
	now: () => 0, rand: () => "yyy", sleep: async () => { client4.abort(); },
});
let marque = null;
try { await client4.generate("x"); } catch (e) { marque = e.aborted; }
r.check("erreur marquée aborted", marque === true);

// Un résultat d'une version INCONNUE est refusé explicitement.
const d5 = fauxDisque();
const store5 = m2.createRelayStore(d5);
const client5 = m3.createRelayClient({
	store: store5, device: "phone", provider: "c", model: "m", language: "fr",
	now: () => 0, rand: () => "www",
	sleep: async () => { await store5.writeJson("19700101T000000-www.result.json",
		{ v: 99, id: "19700101T000000-www", finishedAt: 0, ok: true, questions: [] }); },
});
let refus = "";
try { await client5.generate("x"); } catch (e) { refus = e.message; }
r.check("version inconnue refusée", refus.length > 0);
```

- [ ] **Step 2: Lancer et constater l'échec**

Run: `npm run check:relay`
Expected: FAIL — `createRelayClient` n'existe pas.

- [ ] **Step 3: Ajouter les clés de traduction**

Dans `src/i18n/en/ai.ts` :

```ts
"ai.relay.waiting": "Waiting for a computer to pick this up…",
"ai.relay.claimed": "{device} is generating…",
"ai.relay.aborted": "Generation cancelled",
"ai.relay.badVersion": "This computer runs a different plugin version. Update the plugin on both devices.",
"ai.relay.slow": "Still waiting. Check that Obsidian is open on the computer, that it is set as the worker, and that Syncthing is running on both devices.",
```

Dans `src/i18n/fr/ai.ts`, les mêmes clés : « En attente qu'un ordinateur la prenne… », « {device} génère… », « Génération annulée », « Cet ordinateur utilise une autre version du plugin. Mets le plugin à jour sur les deux appareils. », « Toujours en attente. Vérifie qu'Obsidian est ouvert sur l'ordinateur, qu'il est désigné comme machine travailleuse, et que Syncthing tourne des deux côtés. »

- [ ] **Step 4: Écrire le module**

```ts
import type { AiClient } from "../dashboard/ai-client";
import { t } from "../i18n";
import {
	RELAY_PROTOCOL_VERSION, isSupportedVersion, newRequestId,
	relayFileName, relayStatus, type RelayRequest, type RelayResult,
} from "./protocol";
import type { RelayStore } from "./store";

export interface RelayClientDeps {
	store: RelayStore;
	device: string;
	provider: string;
	model: string;
	language: string;
	now(): number;
	rand(): string;
	sleep(ms: number): Promise<void>;
	onStatus?(status: "pending" | "claimed"): void;
}

const POLL_MS = 3000;

/**
 * Un `AiClient` de plus, avec la MÊME interface que le client CLI — c'est ce
 * qui permet au composer de ne rien savoir du relais et de garder intacts son
 * verrou, sa bulle « envoyé » et sa comptabilité.
 */
export function createRelayClient(deps: RelayClientDeps): AiClient {
	let aborted = false;

	return {
		lastUsage: null,   // la consommation a lieu sur le PC ; on n'estime jamais un compteur absent

		abort(): void { aborted = true; },

		async generate(prompt: string): Promise<unknown[]> {
			aborted = false;
			await deps.store.ensureDir();

			const id = newRequestId(deps.now(), deps.rand());
			const request: RelayRequest = {
				v: RELAY_PROTOCOL_VERSION, id, createdAt: deps.now(), device: deps.device,
				prompt, provider: deps.provider, model: deps.model, language: deps.language,
			};
			await deps.store.writeJson(relayFileName(id, "request"), request);

			let dernierStatut: "pending" | "claimed" | null = null;

			for (;;) {
				if (aborted) {
					/* MÊME convention que le client CLI (ai-client.ts:145-146) :
					   l'UI traite une erreur marquée `aborted` comme un retour à
					   l'état initial, pas comme un échec à afficher. */
					const e = new Error(t("ai.relay.aborted")) as Error & { aborted?: boolean };
					e.aborted = true;
					throw e;
				}

				const names = await deps.store.names();
				const statut = relayStatus(names, id);

				if (statut === "done") {
					const result = await deps.store.readJson<RelayResult>(relayFileName(id, "result"));
					/* `null` = fichier pas encore complet (cf. store.readJson) :
					   on ne conclut pas, on repasse au tour suivant. */
					if (result) {
						if (!isSupportedVersion(result.v)) throw new Error(t("ai.relay.badVersion"));
						if (!result.ok) throw new Error(result.error);
						return result.questions;
					}
				} else if (statut !== dernierStatut && (statut === "pending" || statut === "claimed")) {
					dernierStatut = statut;
					deps.onStatus?.(statut);
				}

				await deps.sleep(POLL_MS);
			}
		},
	};
}
```

- [ ] **Step 5: Vérifier**

Run: `npm run check:relay && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/relay/client.ts scripts/check-relay.mjs src/i18n
git commit -m "feat(relay): client relais cote telephone"
```

---

### Task 4: Le travailleur (côté PC)

**Files:**
- Create: `src/relay/worker.ts`
- Modify: `scripts/check-relay.mjs`

**Interfaces:**
- Consumes: `RelayStore` (Task 2), `selectRelayWork`, `isClaimStale`, `relayFileName`, `isSupportedVersion`, `RELAY_PROTOCOL_VERSION`, types (Task 1).
- Produces: `createRelayWorker(deps): { start(): void; stop(): void; tick(): Promise<void> }` où `deps = { store; device: string; now(): number; generate(req: RelayRequest): Promise<unknown[]>; setInterval(fn, ms): number; clearInterval(h: number): void }`.

**Pourquoi `tick()` est exposé.** La boucle d'horloge n'est pas testable ; un tour l'est entièrement. `start()` ne fait qu'appeler `tick()` immédiatement — c'est le balayage au démarrage exigé par la spec §9 — puis le programmer à intervalle.

- [ ] **Step 1: Écrire les cas qui échouent**

Ajouter dans `scripts/check-relay.mjs` :

```js
// Un tour : la demande est réservée, générée, et le résultat écrit.
const d6 = fauxDisque({
	".quiz-blocks-jobs/20260902T060712-aaa.request.json":
		JSON.stringify({ v: 1, id: "20260902T060712-aaa", createdAt: 0, device: "phone",
		                 prompt: "fais un quiz", provider: "claude", model: "opus", language: "fr" }),
});
const store6 = m2.createRelayStore(d6);
let promptVu = "";
const worker = m4.createRelayWorker({
	store: store6, device: "desktop", now: () => Date.UTC(2026, 8, 2, 6, 10, 0),
	generate: async (req) => { promptVu = req.prompt; return [{ prompt: "Q" }]; },
	setInterval: () => 0, clearInterval: () => {},
});
await worker.tick();
r.check("le prompt du téléphone est parvenu au générateur", promptVu === "fais un quiz");
r.check("réservation posée", d6.fichiers.has(".quiz-blocks-jobs/20260902T060712-aaa.claim.json"));
const res = JSON.parse(d6.fichiers.get(".quiz-blocks-jobs/20260902T060712-aaa.result.json"));
r.check("résultat écrit et réussi", res.ok === true && res.questions.length === 1);

// Un ÉCHEC de génération doit produire un résultat d'erreur, jamais rien :
// sans lui, le téléphone attendrait pour toujours.
const d7 = fauxDisque({
	".quiz-blocks-jobs/20260902T060712-bbb.request.json":
		JSON.stringify({ v: 1, id: "20260902T060712-bbb", createdAt: 0, device: "phone",
		                 prompt: "x", provider: "claude", model: "opus", language: "fr" }),
});
const worker7 = m4.createRelayWorker({
	store: m2.createRelayStore(d7), device: "desktop", now: () => Date.UTC(2026, 8, 2, 6, 10, 0),
	generate: async () => { throw new Error("CLI introuvable"); },
	setInterval: () => 0, clearInterval: () => {},
});
await worker7.tick();
const res7 = JSON.parse(d7.fichiers.get(".quiz-blocks-jobs/20260902T060712-bbb.result.json"));
r.check("l'échec devient un résultat d'erreur", res7.ok === false && res7.error.includes("CLI introuvable"));

// Une demande DÉJÀ terminée n'est pas régénérée.
const d8 = fauxDisque({
	".quiz-blocks-jobs/20260902T060712-ccc.request.json": JSON.stringify({ v: 1, id: "20260902T060712-ccc", prompt: "x" }),
	".quiz-blocks-jobs/20260902T060712-ccc.result.json": JSON.stringify({ v: 1, id: "20260902T060712-ccc", ok: true, questions: [] }),
});
let appels = 0;
await m4.createRelayWorker({
	store: m2.createRelayStore(d8), device: "desktop", now: () => Date.UTC(2026, 8, 2, 6, 10, 0),
	generate: async () => { appels++; return []; }, setInterval: () => 0, clearInterval: () => {},
}).tick();
r.check("aucune régénération", appels === 0);

// Une demande d'une version INCONNUE reçoit une erreur explicite, pas un silence.
const d9 = fauxDisque({
	".quiz-blocks-jobs/20260902T060712-ddd.request.json": JSON.stringify({ v: 99, id: "20260902T060712-ddd", prompt: "x" }),
});
await m4.createRelayWorker({
	store: m2.createRelayStore(d9), device: "desktop", now: () => Date.UTC(2026, 8, 2, 6, 10, 0),
	generate: async () => [], setInterval: () => 0, clearInterval: () => {},
}).tick();
const res9 = JSON.parse(d9.fichiers.get(".quiz-blocks-jobs/20260902T060712-ddd.result.json"));
r.check("version inconnue → erreur explicite", res9.ok === false);

// Les demandes périmées sont nettoyées, avec TOUS leurs fichiers.
const d10 = fauxDisque({
	".quiz-blocks-jobs/20200101T000000-old.request.json": "{}",
	".quiz-blocks-jobs/20200101T000000-old.result.json": "{}",
});
await m4.createRelayWorker({
	store: m2.createRelayStore(d10), device: "desktop", now: () => Date.UTC(2026, 8, 2, 6, 10, 0),
	generate: async () => [], setInterval: () => 0, clearInterval: () => {},
}).tick();
r.check("nettoyage complet", d10.fichiers.size === 0);
```

- [ ] **Step 2: Lancer et constater l'échec**

Run: `npm run check:relay`
Expected: FAIL — `createRelayWorker` n'existe pas.

- [ ] **Step 3: Écrire le module**

```ts
import {
	RELAY_PROTOCOL_VERSION, isClaimStale, isSupportedVersion, relayFileName,
	selectRelayWork, type RelayClaim, type RelayRequest, type RelayResult,
} from "./protocol";
import type { RelayStore } from "./store";

export interface RelayWorkerDeps {
	store: RelayStore;
	device: string;
	now(): number;
	generate(request: RelayRequest): Promise<unknown[]>;
	setInterval(fn: () => void, ms: number): number;
	clearInterval(handle: number): void;
}

const TICK_MS = 5000;
const MAX_AGE_MS = 24 * 3600 * 1000;
const STALE_CLAIM_MS = 15 * 60 * 1000;

export function createRelayWorker(deps: RelayWorkerDeps) {
	let handle: number | null = null;
	let enCours = false;

	async function traiter(id: string, names: readonly string[]): Promise<void> {
		/* Réservation abandonnée : une machine qui a réclamé puis s'est
		   arrêtée (Obsidian fermé en pleine génération) ne doit pas bloquer
		   la demande pour toujours. */
		if (names.includes(relayFileName(id, "claim"))) {
			const claim = await deps.store.readJson<RelayClaim>(relayFileName(id, "claim"));
			if (claim && !isClaimStale(claim, deps.now(), STALE_CLAIM_MS)) return;
		}

		const request = await deps.store.readJson<RelayRequest>(relayFileName(id, "request"));
		/* `null` = fichier pas encore complet (Syncthing) : on repassera. */
		if (!request) return;

		const claim: RelayClaim = { v: RELAY_PROTOCOL_VERSION, id, claimedAt: deps.now(), device: deps.device };
		await deps.store.writeJson(relayFileName(id, "claim"), claim);

		/* Une ERREUR est un résultat comme un autre. Sans cette écriture, le
		   téléphone attendrait indéfiniment un fichier qui ne viendrait
		   jamais — c'est la garantie centrale du relais. */
		let result: RelayResult;
		try {
			if (!isSupportedVersion(request.v)) {
				throw new Error(`Protocol version ${String(request.v)} unsupported (this device speaks ${RELAY_PROTOCOL_VERSION})`);
			}
			result = { v: RELAY_PROTOCOL_VERSION, id, finishedAt: deps.now(), ok: true, questions: await deps.generate(request) };
		} catch (e) {
			result = { v: RELAY_PROTOCOL_VERSION, id, finishedAt: deps.now(), ok: false, error: e instanceof Error ? e.message : String(e) };
		}
		await deps.store.writeJson(relayFileName(id, "result"), result);
	}

	async function tick(): Promise<void> {
		/* Un tour à la fois : une génération dure plus longtemps qu'un
		   intervalle, et deux tours concurrents réserveraient deux fois. */
		if (enCours) return;
		enCours = true;
		try {
			const names = await deps.store.names();
			const { pending, expired } = selectRelayWork(names, deps.now(), { maxAgeMs: MAX_AGE_MS });

			for (const id of expired) {
				for (const kind of ["request", "claim", "result"] as const) {
					if (names.includes(relayFileName(id, kind))) await deps.store.remove(relayFileName(id, kind));
				}
			}
			for (const id of pending) await traiter(id, names);
		} finally {
			enCours = false;
		}
	}

	return {
		tick,
		/* Le balayage IMMÉDIAT est la réponse à « Obsidian était fermé quand
		   j'ai lancé la demande » : elle attend sur disque et part à
		   l'ouverture (spec §9). */
		start(): void {
			void tick();
			handle = deps.setInterval(() => { void tick(); }, TICK_MS);
		},
		stop(): void {
			if (handle !== null) { deps.clearInterval(handle); handle = null; }
		},
	};
}
```

- [ ] **Step 4: Vérifier**

Run: `npm run check:relay && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/relay/worker.ts scripts/check-relay.mjs
git commit -m "feat(relay): travailleur cote PC"
```

---

### Task 5: Le réglage et le branchement du travailleur

**Files:**
- Modify: `src/plugin.ts` (interface `QuizBlocksSettings` ligne 50, valeurs par défaut, onglet de réglages, `onload`, `onunload`)
- Modify: `src/i18n/en/settings.ts`, `src/i18n/fr/settings.ts`

**Interfaces:**
- Consumes: `createRelayWorker` (Task 4), `createRelayStore` (Task 2).
- Produces: le réglage `relayWorker: boolean` (défaut `false`) ; un travailleur démarré au chargement et arrêté au déchargement.

**Pourquoi le défaut est `false`.** Trois appareils partagent ce vault (spec §6). Un défaut à `true` ferait que laptop ET desktop se disputeraient les demandes dès l'installation, et consommeraient du quota en double. Le choix de la machine travailleuse est une décision de l'utilisateur — les CLI ne sont pas forcément installés ni authentifiés partout.

- [ ] **Step 1: Ajouter le réglage**

Dans `QuizBlocksSettings` (`src/plugin.ts:50`), à la suite des réglages IA :

```ts
	/** Cette machine traite les demandes de génération venues du téléphone.
	    FAUX par défaut : le vault est partagé par trois appareils, et deux
	    travailleurs actifs généreraient deux fois la même demande. */
	relayWorker: boolean;
```

L'ajouter aux valeurs par défaut avec `false`, en suivant exactement la façon dont les autres réglages y sont déclarés.

- [ ] **Step 2: Ajouter les clés de traduction**

Dans `src/i18n/en/settings.ts` :

```ts
"settings.relay.name": "Handle generation requests from mobile",
"settings.relay.desc": "When Obsidian is open on this computer, generate quizzes requested from your phone. Enable this on ONE computer only — the vault is shared, and two workers would generate the same request twice.",
```

Dans `src/i18n/fr/settings.ts`, les mêmes clés : « Traiter les demandes de génération du mobile » et « Quand Obsidian est ouvert sur cet ordinateur, génère les quiz demandés depuis le téléphone. À n'activer que sur UN SEUL ordinateur : le vault est partagé, et deux machines généreraient deux fois la même demande. »

- [ ] **Step 3: Afficher le réglage**

Dans le `SettingTab` de `src/plugin.ts`, ajouter une bascule à côté des réglages IA existants, en suivant leur forme exacte (`new Setting(...).setName(t("settings.relay.name")).setDesc(t("settings.relay.desc")).addToggle(...)`). `t()` est appelé DANS la fonction d'affichage, jamais dans une constante de module.

Au changement de valeur, démarrer ou arrêter le travailleur immédiatement — l'utilisateur ne doit pas avoir à redémarrer Obsidian pour que son choix prenne effet.

- [ ] **Step 4: Brancher le cycle de vie**

Dans `onload`, après le chargement des réglages : si `Platform.isDesktopApp && this.settings.relayWorker`, créer le magasin sur `this.app.vault.adapter`, créer le travailleur et le démarrer. La fonction `generate` passée au travailleur construit un `AiClient` par `createAiClient(this)` et appelle son `generate` — **le chemin de génération existant, inchangé**.

Dans `onunload`, l'arrêter. Sans quoi son intervalle survivrait au déchargement du plugin, comme le rappelle le commentaire de cycle de vie de `plugin.ts`.

Le garde `Platform.isDesktopApp` est indispensable : le travailleur n'a de sens que là où les CLI existent, et le plugin doit rester utilisable sur mobile (`isDesktopOnly` reste `false`).

- [ ] **Step 5: Vérifier**

Run: `npm run check && npm run check:relay && npm run check:md && npm run check:export`
Expected: tous passent.

- [ ] **Step 6: Commit**

```bash
git add src/plugin.ts src/i18n
git commit -m "feat(relay): reglage de la machine travailleuse et cycle de vie"
```

---

### Task 6: La bifurcation dans le composer

**Files:**
- Modify: `src/dashboard/ai.ts` (autour de la ligne 1921, là où `createAiClient` est appelé)
- Modify: `src/i18n/en/ai.ts`, `src/i18n/fr/ai.ts` si un libellé manque

**Interfaces:**
- Consumes: `createRelayClient` (Task 3), `createRelayStore` (Task 2).
- Produces: rien de nouveau — un choix de client.

**La contrainte qui domine cette tâche.** Sur desktop, le composer doit se comporter EXACTEMENT comme aujourd'hui. C'est la régression la plus coûteuse possible : elle toucherait l'usage quotidien pour servir un cas d'appoint.

- [ ] **Step 1: Choisir le client selon la plateforme**

Dans `startGeneration`, là où le code fait aujourd'hui :

```ts
const { createAiClient } = require("./ai-client") as typeof import("./ai-client");
const client = createAiClient(ctx.plugin);
```

remplacer la seule construction du client par un choix :

```ts
/* Sur mobile il n'y a pas de child_process : la génération part au PC par le
   vault. Le client relais implémente la MÊME interface `AiClient`, si bien
   que tout ce qui suit — verrou, bulle « envoyé », comptabilité, annulation —
   reste inchangé et ne sait pas à qui il parle. */
const client = Platform.isDesktopApp
	? (require("./ai-client") as typeof import("./ai-client")).createAiClient(ctx.plugin)
	: createRelayClient({
		store: createRelayStore(ctx.plugin.app.vault.adapter),
		device: navigator.userAgent.includes("Android") ? "Android" : "mobile",
		provider: ctx.plugin.settings.aiProvider || "",
		model: /* le modèle déjà choisi par le composer à cet endroit */ "",
		language: /* la langue déjà résolue à cet endroit */ "",
		now: () => Date.now(),
		rand: () => Math.random().toString(36).slice(2, 8),
		sleep: (ms) => new Promise((r) => window.setTimeout(r, ms)),
		onStatus: (s) => { /* met à jour le libellé d'attente de la phase loading */ },
	});
```

Les deux valeurs marquées en commentaire — modèle et langue — existent déjà dans la portée de `startGeneration` : les lire là plutôt que de les recalculer. **Ne pas inventer de nouvelle source pour elles.**

- [ ] **Step 2: Afficher l'attente**

La phase `loading` existe déjà et affiche un indicateur. Sur mobile, y afficher en plus le libellé rendu par `onStatus` : `t("ai.relay.waiting")` puis `t("ai.relay.claimed", { device })`. Après trois minutes sans résultat, afficher `t("ai.relay.slow")` — qui nomme les trois causes probables : Obsidian fermé, machine non désignée, Syncthing arrêté.

Ce message est le seul recours face à un `.stignore` divergent (spec §11) : rien dans le plugin ne peut détecter à coup sûr qu'un dossier est exclu de la synchronisation chez l'autre appareil.

- [ ] **Step 3: Vérifier la non-régression desktop**

Run: `npm run check && npm run check:relay && npm run check:markers`
Puis `npm run build`, recharger le plugin, et lancer une génération NORMALE sur le PC : elle doit se comporter exactement comme avant, sans passer par le relais.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/ai.ts src/i18n
git commit -m "feat(relay): le composer mobile passe par le relais"
```

---

### Task 7: Essai réel et documentation

**Files:**
- Modify: `CLAUDE.md` (une entrée dans la section des conventions)
- Modify: `docs/superpowers/specs/2026-09-02-mobile-generation-design.md` (statut)

- [ ] **Step 1: Vérifications complètes**

Run: `npm run check && npm run check:relay && npm run check:md && npm run check:export && npm run check:lesson && npm run check:markers`
Puis `node scripts/audit-vaults.mjs "C:\obsidian-vaults\Efrei" "C:\obsidian-vaults\Personal"`.
Expected: tous verts, aucun champ perdu — le canal ne doit toucher aucun quiz.

- [ ] **Step 2: Déployer**

Run: `npm run build`, puis `obsidian plugin:reload id=quiz-blocks` en PowerShell (le CLI Obsidian renvoie un exit 127 muet sur une sous-commande à deux-points depuis l'outil Bash).

- [ ] **Step 3: Documenter le canal**

Ajouter dans `CLAUDE.md`, à la suite des conventions, un paragraphe court : l'emplacement du canal, la règle « un fichier par message, un seul auteur », la raison (les conflits Syncthing), et le fait que la détection se fait par interrogation et non par les événements du vault — parce que c'est exactement le genre de décision qu'un lecteur futur défera sans le savoir.

- [ ] **Step 4: Essai de bout en bout — À FAIRE PAR AHMED**

Aucun script ne peut prouver qu'un fichier a franchi Syncthing. La séquence :

1. activer le réglage sur le PC, laisser Obsidian ouvert ;
2. sur le téléphone, ouvrir le tableau de bord, page « Générer », écrire une demande, l'envoyer ;
3. observer : « en attente », puis « le PC génère », puis le quiz ;
4. mesurer le délai réel — c'est le seul chiffre qui dise si le plancher Syncthing est acceptable ;
5. vérifier qu'aucun `.sync-conflict-` n'est apparu dans `.quiz-blocks-jobs/`.

Puis les cas de bord, dans cet ordre : Obsidian fermé sur le PC au moment de l'envoi (la demande doit partir à l'ouverture) ; réglage désactivé (le message d'attente prolongée doit apparaître et nommer la cause) ; téléphone fermé pendant la génération (le résultat doit être là à la réouverture).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-02-mobile-generation-design.md
git commit -m "docs(relay): canal du relais mobile documente"
```

---

## Auto-revue du plan

**Couverture de la spec.** §5 emplacement et forme → Tasks 1 et 2. §5.3 interrogation régulière → Tasks 3 et 4 (aucun usage de `vault.on`). §6 réglage de la machine travailleuse → Task 5. §7 flux → Tasks 3, 4 et 6. §8 réutilisation → Task 6 (le client CLI est appelé tel quel par le travailleur). §9 échecs : Obsidian fermé → Task 4 step 3 (`start()` balaie immédiatement) ; aucune machine désignée → Task 6 step 2 (message d'attente prolongée) ; génération échouée → Task 4 (résultat d'erreur, deux cas de vérification) ; téléphone éteint → conséquence du protocole, le résultat reste sur disque ; nettoyage → Task 4 (cas de vérification) ; Syncthing arrêté → aucun code, le protocole y survit par construction. §10 hors périmètre → aucune tâche, volontairement. §11 latence et `.stignore` → Task 6 step 2 et Task 7 step 4. §12 vérification → Task 7.

**Cohérence des noms.** `RELAY_DIR`, `relayFileName`, `parseRelayFileName`, `newRequestId`, `requestIdTime`, `groupRelayFiles`, `selectRelayWork`, `isClaimStale`, `relayStatus`, `isSupportedVersion`, `createRelayStore`, `createRelayClient`, `createRelayWorker` — chacun est défini dans une tâche avant d'être consommé dans la suivante.

**Deux points laissés ouverts, et assumés.** Task 6 marque deux valeurs — le modèle et la langue — à lire dans la portée existante de `startGeneration` plutôt qu'à recalculer ; je ne les fige pas ici parce que les figer d'après une lecture partielle du composer serait plus risqué que de demander à l'implémenteur de les lire sur place. Et le libellé d'attente de la phase `loading` dépend de la structure de cette phase, que Task 6 step 2 décrit sans en imposer la forme.

**Ce que les vérifications NE prouvent pas.** Aucun cas ne traverse Syncthing, aucun ne touche un vrai `vault.adapter`, et aucun ne s'exécute sur Android. Le protocole, le magasin, le client et le travailleur sont éprouvés ; leur rencontre avec le monde réel est l'objet de Task 7 step 4, et elle appartient à Ahmed.
