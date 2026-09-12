# Mise à jour automatique : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'application vérifie seule, télécharge seule, et se relance sur la nouvelle version après un clic sur « Redémarrer pour mettre à jour » (ou à la prochaine fermeture), par `electron-updater` sur les releases GitHub du dépôt.

**Architecture:** Tout `electron-updater` vit dans le processus principal (`apps/windows/electron/mise-a-jour.ts`), avec un noyau pur (`mise-a-jour-etat.ts`) qui traduit les événements de l'updater en un état affichable. Le pont (`window.neo.miseAJour`) pousse cet état au rendu et reçoit trois ordres : vérifier, installer, régler. Le rendu affiche un bouton dans le rail quand une mise à jour est prête, et l'état complet dans « À propos ». L'installation réutilise le chemin de fermeture existant (vidage des écritures différées) puis `quitAndInstall(true, true)`.

**Tech Stack:** electron-updater (même majeure que electron-builder 26 ; version lue par `npm view electron-updater version`), electron-builder `publish` GitHub, esbuild (bundle du principal), scripts de contrôle Node.

**Spec:** `docs/superpowers/specs/2026-09-13-mise-a-jour-auto-design.md`

## Global Constraints

- **Aucune chaîne visible en dur** : `t("<domaine>.<clé>")`, anglais de référence `src/i18n/en/*.ts`, français typé `src/i18n/fr/*.ts`.
- **Commentaires en français**, le POURQUOI. Aucun artefact d'encodage. Pas d'emoji, pas d'em-dash.
- **Le rendu (`apps/windows/src/`) n'importe jamais un module qui tire Node** ; `electron-updater` n'est importé que par `apps/windows/electron/`. `npm run check:host` reste à **6**.
- Scripts de contrôle : `process.exitCode`, jamais `process.exit()` ; chaque cas neuf s'éprouve par DISCRIMINANCE ; juger sur le CODE DE SORTIE.
- **Immuables** : `appId: "com.ahmed.neoquiz"`, `executableName: "neo-quiz"`, `nsis.deleteAppDataOnUninstall: false`.
- **`softprops/action-gh-release` reste le seul publieur** : `pack:win` / `pack:linux` passent `--publish never`.
- **Aucun argument venu du rendu n'est un chemin ni une URL** sur les canaux `miseAJour*` : le flux est fixé par `app-update.yml` embarqué.
- **`allowPrerelease = false`** : une `-beta` n'est jamais proposée à une installation stable.
- Pas de guess sur une API : lire `apps/windows/node_modules/electron-updater/out/*.d.ts` avant d'écrire un nom d'événement ou de méthode.
- Aucun agent ne lance l'installeur ni ne pilote l'application. Commits sur `main`, sans push par les implémenteurs.

---

### Task 1: L'empaquetage publie les métadonnées de mise à jour

**Files:**
- Modify: `apps/windows/package.json` (dépendance `electron-updater`, scripts `pack:win` / `pack:linux`)
- Modify: `apps/windows/electron-builder.config.mjs` (clé `publish`)
- Modify: `.github/workflows/release.yml` (fichiers attachés par `app-windows` et `app-linux`)
- Modify: `scripts/check-package.mjs`

**Interfaces:**
- Produces : `dist-installer/latest.yml` (Windows) et `latest-linux.yml` (Linux) après `pack:*` ; `resources/app-update.yml` dans le paquet ; `electron-updater` installé dans `apps/windows/node_modules` pour la Task 2.

- [ ] **Step 1 : Étendre `check:package`, qui doit rougir**

Dans `scripts/check-package.mjs`, groupe « configuration résolue », ajouter après le cas `deleteAppDataOnUninstall` :

```js
/* LA CLÉ `publish` : c'est elle qui fait générer `latest*.yml` et embarquer
   `app-update.yml` — sans elle, electron-updater n'a aucun flux à lire et
   se tait. Le dépôt est FIXE : un rendu ne choisit jamais d'où vient une
   mise à jour. */
r.check("publish vise les releases GitHub du dépôt",
	[config.publish?.provider, config.publish?.owner, config.publish?.repo],
	["github", "ahmed-mili", "neo-quiz"]);
```

Dans le groupe « contenu de app.asar » (celui qui ne tourne que si `win-unpacked/` existe), ajouter, en lisant `node:fs` (`existsSync`, `readFileSync`) :

```js
/* Le paquet porte son flux (`app-update.yml`, écrit par electron-builder à
   côté de l'asar), et le dossier de sortie porte les métadonnées que la
   release publie. La version de `latest.yml` DOIT être celle du manifeste :
   c'est elle qu'electron-updater compare à `app.getVersion()`. */
p.check("app-update.yml est dans le paquet",
	existsSync(`${appWindows}dist-installer/win-unpacked/resources/app-update.yml`), true);
const latest = `${appWindows}dist-installer/latest.yml`;
p.check("latest.yml existe à côté de l'installeur", existsSync(latest), true);
p.check("latest.yml porte la version du manifeste",
	existsSync(latest) ? /^version:\s*(.+)$/m.exec(readFileSync(latest, "utf8"))?.[1]?.trim() : null,
	manifeste.version);
```

Run : `npm run check:package ; echo "exit=$LASTEXITCODE"` → 1, avec « publish vise les releases GitHub du dépôt » et les trois cas du paquet en rouge (le paquet local date de la tranche 6, sans `publish`).

- [ ] **Step 2 : La dépendance et les scripts**

Dans `apps/windows/` : `npm view electron-updater version` (noter le numéro), puis `npm install electron-updater@<numéro>` (dépendance de production, PAS `--save-dev` : c'est du code du principal). Vérifier que `apps/windows/package.json` et `package-lock.json` ont bougé.

Dans `apps/windows/package.json`, les deux scripts :

```json
    "pack:win": "npm run build && electron-builder --win nsis --publish never --config electron-builder.config.mjs",
    "pack:linux": "npm run build && electron-builder --linux AppImage --publish never --config electron-builder.config.mjs"
```

- [ ] **Step 3 : La clé `publish`**

Dans `electron-builder.config.mjs`, après `directories`, ajouter :

```js
		/* LE FLUX DES MISES À JOUR : la dernière release GitHub de ce dépôt.
		   Cette clé fait deux choses à l'empaquetage : écrire `latest.yml` /
		   `latest-linux.yml` (version + sha512 des paquets) dans
		   `dist-installer/`, et embarquer `resources/app-update.yml` dans le
		   paquet — c'est ce fichier que lit electron-updater, jamais une URL
		   venue du rendu. Elle ne PUBLIE rien : les scripts `pack:*` passent
		   `--publish never`, parce que sous un tag et avec `GH_TOKEN`,
		   electron-builder créerait lui-même une release brouillon à côté de
		   celle de `release.yml`. */
		publish: { provider: "github", owner: "ahmed-mili", repo: "neo-quiz" },
```

- [ ] **Step 4 : `release.yml` attache les métadonnées**

Dans le job `app-windows`, step « Attach installer to release », `files:` devient :

```yaml
          files: |
            apps/windows/dist-installer/*.exe
            apps/windows/dist-installer/*.exe.blockmap
            apps/windows/dist-installer/latest.yml
```

et le step « Upload installer (répétition) » prend le même `path:` en trois lignes. Dans `app-linux`, idem avec `*.AppImage` et `latest-linux.yml` (une AppImage n'a pas de `.blockmap`). Retirer le commentaire « Le `.blockmap` n'est PAS attaché » et le remplacer par :

```yaml
      # `latest.yml` et le `.blockmap` sont ce qu'electron-updater lit : la
      # version à comparer, le sha512 à vérifier, et les blocs à ne pas
      # retélécharger (spec de la mise à jour automatique, §3.1).
```

- [ ] **Step 5 : Reconstruire, relancer le contrôle**

Run : `npm --prefix apps/windows run pack:win ; echo "exit=$LASTEXITCODE"` → 0 (timeout 600000 ms). Vérifier à l'œil : `apps/windows/dist-installer/latest.yml` existe, `win-unpacked/resources/app-update.yml` existe et contient `provider: github`.
Run : `npm run check:package ; echo "exit=$LASTEXITCODE"` → 0.
Run : `npm run check:app ; echo "exit=$LASTEXITCODE"` → 0.

- [ ] **Step 6 : Discriminance**

Mettre `publish` à `null` dans la config, `check:package` rougit sur « publish vise… » (relever le libellé), restaurer. Renommer temporairement `latest.yml` en `latest.bak`, rougit sur « latest.yml existe… », restaurer.

- [ ] **Step 7 : Commit**

```bash
git add apps/windows/package.json apps/windows/package-lock.json apps/windows/electron-builder.config.mjs .github/workflows/release.yml scripts/check-package.mjs
git commit -m "feat(app): l'empaquetage publie latest.yml, electron-updater installe, --publish never"
```

---

### Task 2: Le processus principal et le pont

**Files:**
- Create: `apps/windows/electron/mise-a-jour-etat.ts` (pur)
- Create: `apps/windows/electron/mise-a-jour.ts` (câblage electron-updater)
- Create: `scripts/check-updater.mjs` ; Modify: `package.json` racine (`"check:updater"`)
- Modify: `apps/windows/electron/pont.ts` (type `EtatMiseAJour`, espace `miseAJour`, `CANAUX`)
- Modify: `apps/windows/electron/preload.ts`
- Modify: `apps/windows/electron/canaux.ts` (cinq gestionnaires)
- Modify: `apps/windows/electron/main.ts` (démarrage, focus, `window-all-closed`)
- Modify: `scripts/check-windows-host.mjs` (faux `neo.miseAJour`, inerte)
- Modify: `CLAUDE.md` (ligne `check:updater`)

**Interfaces:**
- Produces (pour la Task 3) :

```ts
// pont.ts
export type PhaseMiseAJour = "inactif" | "verification" | "a-jour" | "telechargement" | "prete" | "erreur";
export interface EtatMiseAJour {
	phase: PhaseMiseAJour;
	/** La version proposée, dès `update-available`. */
	version?: string;
	/** 0..100 pendant `telechargement`. */
	pourcent?: number;
	/** Le message d'erreur brut, phase `erreur` seulement. */
	message?: string;
	/** Le réglage, tel que le principal l'applique. */
	auto: boolean;
}
miseAJour: {
	etat(): Promise<EtatMiseAJour>;
	surEtat(rappel: (etat: EtatMiseAJour) => void): () => void;
	verifier(): Promise<void>;
	installer(): Promise<void>;
	reglerAuto(auto: boolean): Promise<void>;
};
// CANAUX
miseAJourEtatLire: "neo:mise-a-jour/etat-lire",
miseAJourEtat: "neo:mise-a-jour/etat",
miseAJourVerifier: "neo:mise-a-jour/verifier",
miseAJourInstaller: "neo:mise-a-jour/installer",
miseAJourReglage: "neo:mise-a-jour/reglage",
```

- [ ] **Step 1 : Le noyau pur et son contrôle, qui doit rougir**

Créer `scripts/check-updater.mjs` :

```js
/**
 * LA MISE À JOUR AUTOMATIQUE — le noyau pur qui traduit les événements
 * d'electron-updater en un état affichable (`apps/windows/electron/
 * mise-a-jour-etat.ts`). Éprouvé sans Electron ni réseau.
 *
 * Ce que ce script empêche : un état « prête » qui ne retomberait jamais
 * (le bouton du rail resterait après une erreur), un pourcentage qui
 * survivrait au téléchargement fini, et un réglage coupé qui laisserait
 * une vérification en cours afficher « téléchargement ».
 *
 *     npm run check:updater
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/electron/mise-a-jour-etat.ts", ({ ETAT_INITIAL, transition }) => {
	const r = makeReporter("Mise à jour — transitions d'état");
	const auto = { ...ETAT_INITIAL, auto: true };

	r.check("initial : inactif, auto vrai", ETAT_INITIAL, { phase: "inactif", auto: true });
	r.check("checking-for-update : vérification",
		transition(auto, { type: "checking-for-update" }), { phase: "verification", auto: true });
	r.check("update-available : téléchargement à 0 %, version connue",
		transition({ phase: "verification", auto: true }, { type: "update-available", version: "2.5.2" }),
		{ phase: "telechargement", version: "2.5.2", pourcent: 0, auto: true });
	r.check("download-progress : le pourcentage est arrondi et borné",
		transition({ phase: "telechargement", version: "2.5.2", pourcent: 0, auto: true }, { type: "download-progress", percent: 43.7 }),
		{ phase: "telechargement", version: "2.5.2", pourcent: 44, auto: true });
	r.check("update-downloaded : prête, sans pourcentage",
		transition({ phase: "telechargement", version: "2.5.2", pourcent: 99, auto: true }, { type: "update-downloaded", version: "2.5.2" }),
		{ phase: "prete", version: "2.5.2", auto: true });
	r.check("update-not-available : à jour, sans version",
		transition({ phase: "verification", auto: true }, { type: "update-not-available" }),
		{ phase: "a-jour", auto: true });
	r.check("error : erreur avec message, version et pourcentage oubliés",
		transition({ phase: "telechargement", version: "2.5.2", pourcent: 10, auto: true }, { type: "error", message: "net::ERR_INTERNET_DISCONNECTED" }),
		{ phase: "erreur", message: "net::ERR_INTERNET_DISCONNECTED", auto: true });
	r.check("une erreur APRÈS prête ne retire pas la mise à jour téléchargée",
		transition({ phase: "prete", version: "2.5.2", auto: true }, { type: "error", message: "x" }),
		{ phase: "prete", version: "2.5.2", auto: true });
	r.check("reglage false : inactif, tout oublié sauf une mise à jour prête",
		[transition({ phase: "telechargement", version: "2.5.2", pourcent: 10, auto: true }, { type: "reglage", auto: false }),
		 transition({ phase: "prete", version: "2.5.2", auto: true }, { type: "reglage", auto: false })],
		[{ phase: "inactif", auto: false }, { phase: "prete", version: "2.5.2", auto: false }]);
	r.check("reglage true depuis inactif : inactif (la vérification est un événement à part)",
		transition({ phase: "inactif", auto: false }, { type: "reglage", auto: true }), { phase: "inactif", auto: true });
	r.check("checking-for-update quand auto est faux : ignoré (vérification manuelle exceptée par l'appelant)",
		transition({ phase: "inactif", auto: false }, { type: "checking-for-update" }), { phase: "verification", auto: false });
	r.done();
});
```

Ajouter `"check:updater": "node scripts/check-updater.mjs",` dans `package.json` racine, après `check:package`.

Run : `npm run check:updater ; echo "exit=$LASTEXITCODE"` → échec (module absent).

- [ ] **Step 2 : Le noyau**

Créer `apps/windows/electron/mise-a-jour-etat.ts` :

```ts
/* ══════════════════════════════════════════════════════════
   L'ÉTAT DE LA MISE À JOUR — un noyau PUR

   electron-updater parle par événements (`checking-for-update`,
   `update-available`, `download-progress`, `update-downloaded`,
   `update-not-available`, `error`). Le rendu, lui, veut UN objet à afficher :
   une phase, une version, un pourcentage. Cette traduction est la seule
   logique du mécanisme, et elle vit ici, sans Electron ni réseau, pour être
   éprouvée par `npm run check:updater` — la même règle que `garde-ia.ts`.

   Deux décisions qui ne se voient pas dans les types :
   - une ERREUR après « prête » ne retire pas la mise à jour déjà
     téléchargée : le paquet est sur le disque, vérifié, et un échec de
     re-vérification réseau n'y change rien ;
   - couper le réglage OUBLIE une vérification ou un téléchargement en
     cours, mais garde « prête » : le fichier est là, l'utilisateur peut
     encore vouloir cliquer.
══════════════════════════════════════════════════════════ */

export type PhaseMiseAJour = "inactif" | "verification" | "a-jour" | "telechargement" | "prete" | "erreur";

export interface EtatMiseAJour {
	phase: PhaseMiseAJour;
	version?: string;
	pourcent?: number;
	message?: string;
	auto: boolean;
}

export type EvenementMiseAJour =
	| { type: "checking-for-update" }
	| { type: "update-available"; version: string }
	| { type: "update-not-available" }
	| { type: "download-progress"; percent: number }
	| { type: "update-downloaded"; version: string }
	| { type: "error"; message: string }
	| { type: "reglage"; auto: boolean };

export const ETAT_INITIAL: EtatMiseAJour = { phase: "inactif", auto: true };

export function transition(etat: EtatMiseAJour, ev: EvenementMiseAJour): EtatMiseAJour {
	switch (ev.type) {
		case "checking-for-update":
			return { phase: "verification", auto: etat.auto };
		case "update-available":
			return { phase: "telechargement", version: ev.version, pourcent: 0, auto: etat.auto };
		case "download-progress":
			return { ...etat, pourcent: Math.max(0, Math.min(100, Math.round(ev.percent))) };
		case "update-downloaded":
			return { phase: "prete", version: ev.version, auto: etat.auto };
		case "update-not-available":
			return { phase: "a-jour", auto: etat.auto };
		case "error":
			if (etat.phase === "prete") return etat;
			return { phase: "erreur", message: ev.message, auto: etat.auto };
		case "reglage":
			if (etat.phase === "prete") return { ...etat, auto: ev.auto };
			return ev.auto ? { ...etat, auto: true } : { phase: "inactif", auto: false };
	}
}
```

Run : `npm run check:updater ; echo "exit=$LASTEXITCODE"` → 0, 11/11. Ajuster le cas « reglage true depuis inactif » du script si la sortie diffère de l'attendu écrit ci-dessus : l'attendu est `{ phase: "inactif", auto: true }` et le code le rend ; vérifier plutôt que d'adapter.

- [ ] **Step 3 : Le pont (types et canaux)**

Dans `pont.ts` : `export type { EtatMiseAJour, PhaseMiseAJour } from "./mise-a-jour-etat";` (type seulement : `pont.ts` est dans `SANS_NODE`, importable du rendu, et un `export type` s'efface). Ajouter l'espace `miseAJour` à l'interface `Pont` (après `fenetre`), avec ce commentaire :

```ts
	/**
	 * LA MISE À JOUR AUTOMATIQUE, vue du rendu. Le rendu ne choisit RIEN de
	 * ce qui traverse : ni URL, ni chemin, ni version — le flux est
	 * `app-update.yml`, embarqué au paquet, et c'est le principal qui
	 * télécharge, vérifie le sha512 et installe. Le rendu reçoit un état
	 * (poussé, comme les événements disque) et donne trois ordres : vérifier
	 * maintenant, installer ce qui est prêt, couper ou rétablir l'automatique.
	 */
	miseAJour: {
		etat(): Promise<EtatMiseAJour>;
		surEtat(rappel: (etat: EtatMiseAJour) => void): () => void;
		verifier(): Promise<void>;
		installer(): Promise<void>;
		reglerAuto(auto: boolean): Promise<void>;
	};
```

Ajouter les cinq canaux à `CANAUX` (valeurs de la section Interfaces). Ajouter `export const CLE_REGLAGES_MAJ = "updates";` à côté de `CLE_REGLAGES_IA` avec un commentaire : la clé `{ auto: boolean }`, lue par le principal au démarrage et écrite par lui seul (le rendu passe par `reglerAuto`, jamais par `reglages.ecrire`, pour que le principal applique le changement à l'instant).

- [ ] **Step 4 : Le préchargement**

Dans `preload.ts`, sur le modèle de `surveiller` :

```ts
	miseAJour: {
		etat: () => ipcRenderer.invoke(CANAUX.miseAJourEtatLire),
		surEtat(rappel) {
			const ecouteur = (_e: unknown, etat: EtatMiseAJour): void => rappel(etat);
			ipcRenderer.on(CANAUX.miseAJourEtat, ecouteur);
			return () => { ipcRenderer.off(CANAUX.miseAJourEtat, ecouteur); };
		},
		verifier: () => ipcRenderer.invoke(CANAUX.miseAJourVerifier),
		installer: () => ipcRenderer.invoke(CANAUX.miseAJourInstaller),
		reglerAuto: auto => ipcRenderer.invoke(CANAUX.miseAJourReglage, auto),
	},
```

- [ ] **Step 5 : Le câblage electron-updater**

Lire `apps/windows/node_modules/electron-updater/out/AppUpdater.d.ts` (noms exacts : `autoDownload`, `autoInstallOnAppQuit`, `allowPrerelease`, `logger`, `checkForUpdates`, `quitAndInstall(isSilent?, isForceRunAfter?)`, les événements typés) avant d'écrire. Créer `apps/windows/electron/mise-a-jour.ts` :

```ts
/* ══════════════════════════════════════════════════════════
   LA MISE À JOUR AUTOMATIQUE — le câblage d'electron-updater

   Tout vit ici, dans le PRINCIPAL : le rendu ne voit qu'un état poussé par
   le pont (`CANAUX.miseAJourEtat`) et donne trois ordres. Le flux est
   `resources/app-update.yml`, écrit par electron-builder (clé `publish` de
   la config) : les releases GitHub du dépôt, et rien d'autre.

   QUAND ON VÉRIFIE : au démarrage (après la fenêtre, jamais avant : une
   erreur réseau au boot ne doit rien retarder), au retour du focus avec un
   garde de quinze minutes, et toutes les quatre heures. Hors ligne est un
   état NORMAL : l'erreur est journalisée, jamais affichée en Notice.

   COMMENT ON INSTALLE : par le chemin de FERMETURE existant. `installer()`
   arme un drapeau puis ferme la fenêtre ; `main.ts` fait vider les
   écritures différées du rendu comme pour une croix, et quand tout est
   fermé, c'est `quitAndInstall(true, true)` — silencieux, relance forcée —
   qui remplace `app.quit()`. Une frappe en attente ne se perd pas dans une
   mise à jour. Sans clic, `autoInstallOnAppQuit` installe à la prochaine
   fermeture (sans relance).

   EN DÉVELOPPEMENT (`app.isPackaged === false`) : rien, dit une fois.
   electron-updater n'a pas d'`app-update.yml` à lire hors d'un paquet.
══════════════════════════════════════════════════════════ */

import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { LOG_PREFIX } from "../../../src/branding";
import { ETAT_INITIAL, transition } from "./mise-a-jour-etat";
import type { EtatMiseAJour, EvenementMiseAJour } from "./mise-a-jour-etat";
import type { Reglages } from "./reglages";
import { CLE_REGLAGES_MAJ } from "./pont";

const GARDE_FOCUS_MS = 15 * 60 * 1000;
const PERIODE_MS = 4 * 60 * 60 * 1000;

export interface MiseAJour {
	etat(): EtatMiseAJour;
	/** Au démarrage, APRÈS la fenêtre : pose le réglage lu du disque sans le
	    réécrire, arme le minuteur, et lance la première vérification si le
	    réglage est vrai. */
	initialiser(auto: boolean): void;
	verifier(): Promise<void>;
	/** Vrai si une mise à jour prête a été armée pour l'installation : c'est
	    à l'appelant de fermer la fenêtre, puis d'appeler `installerArmee()`
	    quand tout est fermé. */
	armerInstallation(): boolean;
	installationArmee(): boolean;
	/** `quitAndInstall` : ne revient pas si tout va bien. */
	installerArmee(): void;
	reglerAuto(auto: boolean): Promise<void>;
	surFocus(): void;
	arreter(): void;
}

export function creerMiseAJour(deps: {
	reglages: Reglages;
	envoyer(etat: EtatMiseAJour): void;
}): MiseAJour {
	let etat: EtatMiseAJour = ETAT_INITIAL;
	let armee = false;
	let derniereVerification = 0;
	let minuteur: NodeJS.Timeout | null = null;

	const appliquer = (ev: EvenementMiseAJour): void => {
		etat = transition(etat, ev);
		deps.envoyer(etat);
	};

	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.allowPrerelease = false;
	autoUpdater.logger = {
		info: (m: unknown) => console.log(LOG_PREFIX, "mise à jour:", m),
		warn: (m: unknown) => console.warn(LOG_PREFIX, "mise à jour:", m),
		error: (m: unknown) => console.error(LOG_PREFIX, "mise à jour:", m),
		debug: () => {},
	};
	autoUpdater.on("checking-for-update", () => appliquer({ type: "checking-for-update" }));
	autoUpdater.on("update-available", info => appliquer({ type: "update-available", version: info.version }));
	autoUpdater.on("update-not-available", () => appliquer({ type: "update-not-available" }));
	autoUpdater.on("download-progress", p => appliquer({ type: "download-progress", percent: p.percent }));
	autoUpdater.on("update-downloaded", info => appliquer({ type: "update-downloaded", version: info.version }));
	autoUpdater.on("error", e => appliquer({ type: "error", message: e?.message ?? String(e) }));

	async function verifier(): Promise<void> {
		if (!app.isPackaged) {
			console.log(LOG_PREFIX, "mise à jour: ignorée hors d'un paquet (app.isPackaged faux)");
			return;
		}
		derniereVerification = Date.now();
		try {
			await autoUpdater.checkForUpdates();
		} catch (e) {
			// Déjà traduit en état par l'événement `error` ; ici seulement pour
			// qu'une promesse rejetée ne remonte pas en « unhandled ».
			console.warn(LOG_PREFIX, "mise à jour: vérification impossible:", e);
		}
	}

	function armerMinuteur(): void {
		if (minuteur) clearInterval(minuteur);
		minuteur = etat.auto ? setInterval(() => { void verifier(); }, PERIODE_MS) : null;
	}

	return {
		etat: () => etat,
		initialiser(auto) {
			etat = { ...etat, auto };
			armerMinuteur();
			if (auto) void verifier();
		},
		verifier,
		armerInstallation() {
			if (etat.phase !== "prete") return false;
			armee = true;
			return true;
		},
		installationArmee: () => armee,
		installerArmee() {
			autoUpdater.quitAndInstall(true, true);
		},
		async reglerAuto(auto) {
			await deps.reglages.ecrire(CLE_REGLAGES_MAJ, { auto });
			appliquer({ type: "reglage", auto });
			armerMinuteur();
			if (auto) void verifier();
		},
		surFocus() {
			if (!etat.auto || Date.now() - derniereVerification < GARDE_FOCUS_MS) return;
			void verifier();
		},
		arreter() {
			if (minuteur) clearInterval(minuteur);
			minuteur = null;
		},
	};
}

/** Le réglage persisté, ou vrai : la mise à jour automatique est le défaut. */
export async function lireReglageAuto(reglages: Reglages): Promise<boolean> {
	const v = await reglages.lire(CLE_REGLAGES_MAJ);
	return !(v && typeof v === "object" && (v as { auto?: unknown }).auto === false);
}
```

Ajuster les noms d'événements et de champs (`info.version`, `p.percent`) à ce que les `.d.ts` disent. Le module est bundlé par esbuild avec le reste du principal (`construire.mjs`, `external: ["electron"]`) : vérifier que `npm run check:app` passe et que `dist-electron/main.cjs` contient bien `electron-updater` (`grep -c "electron-updater" apps/windows/dist-electron/main.cjs` > 0).

- [ ] **Step 6 : Les canaux et `main.ts`**

Dans `canaux.ts`, `DependancesCanaux` gagne `miseAJour: MiseAJour` et `fermerPourInstaller(): void` ; dans `enregistrerCanaux`, après les canaux de fermeture :

```ts
	/* ─── LA MISE À JOUR ───
	   Rien de ce qui traverse n'est un chemin ni une URL : le rendu demande,
	   le principal décide avec son `app-update.yml`. `installer` ferme la
	   fenêtre par le chemin de la croix (écritures différées vidées) ; c'est
	   `main.ts` qui, tout fermé, lance `quitAndInstall`. */
	ipcMain.handle(CANAUX.miseAJourEtatLire, () => deps.miseAJour.etat());
	ipcMain.handle(CANAUX.miseAJourVerifier, () => deps.miseAJour.verifier());
	ipcMain.handle(CANAUX.miseAJourInstaller, () => {
		if (deps.miseAJour.armerInstallation()) deps.fermerPourInstaller();
	});
	ipcMain.handle(CANAUX.miseAJourReglage, (_e, auto: unknown) => deps.miseAJour.reglerAuto(auto === true));
```

Dans `main.ts` :
- après `reglages = creerReglages(...)` et avant `enregistrerCanaux`, créer `miseAJour = creerMiseAJour({ reglages: reglagesOuErreur(), envoyer: etat => { if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send(CANAUX.miseAJourEtat, etat); } })` ; APRÈS `creerFenetre()`, `miseAJour.initialiser(await lireReglageAuto(reglagesOuErreur()))` (pas `reglerAuto` : il réécrirait le réglage qu'on vient de lire) ;
- passer `miseAJour` et `fermerPourInstaller: () => fenetre?.close()` à `enregistrerCanaux` ;
- `app.on("browser-window-focus", () => miseAJour?.surFocus())` ;
- `app.on("window-all-closed", ...)` devient : si `miseAJour?.installationArmee()` alors `miseAJour.installerArmee()` sinon `app.quit()` — avec le commentaire : « quand une installation est armée, c'est `quitAndInstall` qui quitte, après avoir lancé l'installeur silencieux ; l'application se relance seule ».

- [ ] **Step 7 : Le faux pont du contrôle**

Dans `scripts/check-windows-host.mjs`, objet `neo` (ligne ~607), ajouter un espace inerte :

```js
		/* La mise à jour automatique : le rendu ne fait que s'y abonner ; le
		   contrôle n'a rien à éprouver ici, mais un membre absent ferait
		   mourir le montage de la coquille avant les cas qui comptent. */
		miseAJour: {
			etat: async () => ({ phase: "inactif", auto: true }),
			surEtat: () => () => {},
			verifier: async () => {},
			installer: async () => {},
			reglerAuto: async () => {},
		},
```

- [ ] **Step 8 : Contrôles**

`npm run check:updater` (11/11), `npm run check:app`, `npm run check:host` (6), `npm run check:windows-host`, `npm run check:electron-reglages`, `npm run check:package` (0 attendu partout, codes relevés). Discriminance sur `check:updater` : inverser la garde `if (etat.phase === "prete") return etat;` du cas `error`, voir rougir « une erreur APRÈS prête… », restaurer.

CLAUDE.md, « Commandes », après `check:package` :

```
- `npm run check:updater` — le noyau pur de la mise à jour automatique
  (`apps/windows/electron/mise-a-jour-etat.ts`) : une erreur après « prête »
  ne retire pas le paquet téléchargé, couper le réglage oublie une
  vérification en cours mais garde « prête ». Le câblage electron-updater
  (`mise-a-jour.ts`) ne s'éprouve qu'installé, sur deux releases.
```

- [ ] **Step 9 : Commit**

```bash
git add apps/windows/electron scripts/check-updater.mjs scripts/check-windows-host.mjs package.json CLAUDE.md
git commit -m "feat(app): la mise a jour automatique dans le principal, poussee au rendu par le pont"
```

---

### Task 3: Le rendu

**Files:**
- Create: `apps/windows/src/ui/mise-a-jour.ts`
- Modify: `apps/windows/src/ui/dashboard-shell.ts` (après `nav.render(...)`)
- Modify: `apps/windows/src/ui/settings.ts` (section « À propos »)
- Modify: `apps/windows/src/assets/shell.css`
- Modify: `src/i18n/en/app.ts`, `src/i18n/fr/app.ts`

**Interfaces:**
- Consumes : `pont().miseAJour` et `EtatMiseAJour` (Task 2, `import type { EtatMiseAJour } from "../../electron/pont"`).

- [ ] **Step 1 : Les clés**

`src/i18n/en/app.ts`, après les `app.empty.*` :

```ts
	/* ── Mise à jour automatique (application seulement) ── */
	"app.update.restart": "Restart to update",
	"app.update.auto": "Automatic updates",
	"app.update.autoHint": "Neo Quiz checks GitHub for a newer version, downloads it in the background, and installs it when you click Restart or when you close the app.",
	"app.update.checkNow": "Check now",
	"app.update.state.inactif": "Automatic updates are off.",
	"app.update.state.verification": "Checking for updates…",
	"app.update.state.aJour": "You have the latest version.",
	"app.update.state.telechargement": "Downloading {version}: {pourcent}%",
	"app.update.state.prete": "Version {version} is ready to install.",
	"app.update.state.erreur": "Could not check for updates.",
```

`src/i18n/fr/app.ts` :

```ts
	/* ── Mise à jour automatique (application seulement) ── */
	"app.update.restart": "Redémarrer pour mettre à jour",
	"app.update.auto": "Mises à jour automatiques",
	"app.update.autoHint": "Neo Quiz cherche une version plus récente sur GitHub, la télécharge en arrière-plan, et l'installe quand vous cliquez sur Redémarrer ou quand vous fermez l'application.",
	"app.update.checkNow": "Vérifier maintenant",
	"app.update.state.inactif": "Les mises à jour automatiques sont coupées.",
	"app.update.state.verification": "Recherche d'une mise à jour…",
	"app.update.state.aJour": "Vous avez la dernière version.",
	"app.update.state.telechargement": "Téléchargement de {version} : {pourcent} %",
	"app.update.state.prete": "La version {version} est prête à être installée.",
	"app.update.state.erreur": "Impossible de vérifier les mises à jour.",
```

Preuve du typage : commenter une clé FR, `npm run check` rougit, restaurer, le dire.

- [ ] **Step 2 : Le module**

Créer `apps/windows/src/ui/mise-a-jour.ts` :

```ts
/* ══════════════════════════════════════════════════════════
   LA MISE À JOUR, VUE DU RENDU

   Un seul abonnement au pont, un état courant, et deux endroits qui le
   montrent : le rail (un bouton, seulement quand il y a quelque chose à
   cliquer) et la section « À propos » des Réglages (l'état complet, le
   bouton « Vérifier maintenant », l'interrupteur). Deux surfaces, une
   source : chacune redessine depuis le MÊME état, elles ne peuvent pas se
   contredire.

   Ce module n'importe rien qui tire Node : `EtatMiseAJour` est un type,
   `pont()` lit `window.neo` à l'appel.
══════════════════════════════════════════════════════════ */

import type { EtatMiseAJour } from "../../electron/pont";
import { pont } from "../host/pont";
import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";

let etat: EtatMiseAJour = { phase: "inactif", auto: true };
const abonnes = new Set<(etat: EtatMiseAJour) => void>();
let desabonnerPont: (() => void) | null = null;

/** Un seul abonnement au pont pour toute la fenêtre, posé au premier appel. */
function garantirAbonnement(): void {
	if (desabonnerPont) return;
	desabonnerPont = pont().miseAJour.surEtat(e => {
		etat = e;
		for (const a of abonnes) a(etat);
	});
	void pont().miseAJour.etat().then(e => {
		etat = e;
		for (const a of abonnes) a(etat);
	});
}

function abonner(rappel: (etat: EtatMiseAJour) => void): () => void {
	garantirAbonnement();
	abonnes.add(rappel);
	rappel(etat);
	return () => { abonnes.delete(rappel); };
}

/** Le bouton du rail : n'existe que lorsque la mise à jour est PRÊTE. Un
    badge pendant le téléchargement n'aurait rien à cliquer. */
export function monterBoutonRail(navEl: HTMLElement): () => void {
	const footer = navEl.querySelector<HTMLElement>(".qbd-nav-footer");
	if (!footer) return () => {};
	let bouton: HTMLButtonElement | null = null;
	return abonner(e => {
		if (e.phase === "prete" && !bouton) {
			bouton = document.createElement("button");
			bouton.type = "button";
			bouton.className = "qbd-nav-item nq-maj-bouton";
			currentHost().ui.setIcon(ajouter(bouton, "span", "qbd-nav-icon"), "refresh-cw");
			ajouter(bouton, "span", "qbd-nav-label", t("app.update.restart"));
			bouton.addEventListener("click", () => { void pont().miseAJour.installer(); });
			footer.prepend(bouton);
		} else if (e.phase !== "prete" && bouton) {
			bouton.remove();
			bouton = null;
		}
	});
}

function ligneEtat(e: EtatMiseAJour): string {
	switch (e.phase) {
		case "inactif": return t("app.update.state.inactif");
		case "verification": return t("app.update.state.verification");
		case "a-jour": return t("app.update.state.aJour");
		case "telechargement": return t("app.update.state.telechargement", { version: e.version ?? "", pourcent: e.pourcent ?? 0 });
		case "prete": return t("app.update.state.prete", { version: e.version ?? "" });
		case "erreur": return t("app.update.state.erreur");
	}
}

/** L'état complet dans « À propos » : la ligne, le bouton d'installation
    quand elle est prête, « Vérifier maintenant », l'interrupteur. */
export function monterEtatApropos(section: HTMLElement): () => void {
	const bloc = ajouter(section, "div", "nq-maj-bloc");
	const ligne = ajouter(bloc, "p", "nq-reglages-aide");
	const actions = ajouter(bloc, "div", "nq-reglages-actions");
	const installer = ajouter(actions, "button", "nq-maj-installer", t("app.update.restart"));
	installer.type = "button";
	installer.addEventListener("click", () => { void pont().miseAJour.installer(); });
	const verifier = ajouter(actions, "button", "nq-maj-verifier", t("app.update.checkNow"));
	verifier.type = "button";
	verifier.addEventListener("click", () => { void pont().miseAJour.verifier(); });
	const ligneAuto = ajouter(bloc, "label", "nq-maj-auto");
	const auto = ajouter(ligneAuto, "input");
	auto.type = "checkbox";
	ajouter(ligneAuto, "span", undefined, t("app.update.auto"));
	ajouter(bloc, "p", "nq-reglages-aide", t("app.update.autoHint"));
	auto.addEventListener("change", () => { void pont().miseAJour.reglerAuto(auto.checked); });
	return abonner(e => {
		ligne.textContent = ligneEtat(e);
		installer.hidden = e.phase !== "prete";
		verifier.disabled = e.phase === "verification" || e.phase === "telechargement";
		auto.checked = e.auto;
	});
}
```

Vérifier la signature d'`ajouter` (4e argument texte, 3e classe optionnelle : passer `undefined` pour la classe si la fonction l'accepte, sinon `""`). Icône `refresh-cw` : vérifier qu'elle existe dans le catalogue `lucide` (`apps/windows/src/host/ui.ts` lit `icons` de `lucide` : `RefreshCw`).

- [ ] **Step 3 : Le montage**

`dashboard-shell.ts` : après l'appel qui peuple le rail (`nav.render(navEl)` ou équivalent, le lire), `const demonterMaj = monterBoutonRail(navEl);` et l'appeler dans le démontage rendu. `settings.ts`, section « À propos » (tranche 6) : après le lien du dépôt, `const demonterMaj = monterEtatApropos(apropos);` et l'appeler dans le `return () => { ... }` final.

`shell.css`, à côté des `nq-reglages-*` :

```css
.nq-maj-bouton { color: var(--text-accent); }
.nq-maj-bloc { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.nq-maj-auto { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.nq-maj-installer, .nq-maj-verifier { align-self: flex-start; }
```

Vérifier que `--text-accent` est dans `host-vars.css` (elle l'est depuis la tranche 6) ; `npm run check:theme` le dira.

- [ ] **Step 4 : Contrôles**

`npm run check`, `npm run check:app`, `npm run check:host` (6), `npm run check:theme`, `npm run check:windows-host`, `npm run check:dashboard-dom` : tous 0, codes relevés.

- [ ] **Step 5 : Commit**

```bash
git add apps/windows/src src/i18n/en/app.ts src/i18n/fr/app.ts
git commit -m "feat(app): le bouton Redemarrer pour mettre a jour, l'etat dans A propos"
```

**À vérifier à l'écran par Ahmed (livré avec la tâche)** : `npm run app:dev`, Réglages, « À propos » : la ligne « Les mises à jour automatiques sont coupées » ou « Vous avez la dernière version » n'apparaît PAS en dev (le principal dit « ignorée hors d'un paquet » dans la console) ; l'interrupteur se coche et se décoche ; aucun bouton dans le rail.

---

### Task 4: Les épreuves et les deux releases (contrôleur)

- [ ] Écrire `docs/superpowers/notes/2026-09-13-mise-a-jour-epreuves-ecran.md` (le §3.5 de la spec, en cases à cocher), commit.
- [ ] `node scripts/set-version.mjs 2.5.1`, commit « Version 2.5.1 », `git tag v2.5.1`, `git push --atomic origin main v2.5.1` ; attendre le run ; vérifier que la release porte `latest.yml`, `latest-linux.yml`, `.exe`, `.exe.blockmap`, `.AppImage`.
- [ ] `node scripts/set-version.mjs 2.5.2`, commit « Version 2.5.2 », tag, push atomique ; attendre le run.
- [ ] Remettre à Ahmed : installer `neo-quiz-setup-2.5.1.exe` depuis la release `v2.5.1` (PAS la dernière), lancer, « À propos » passe seul en « Téléchargement de 2.5.2 » puis « prête », le bouton apparaît dans le rail, clic, l'application se ferme, se relance, « Neo Quiz 2.5.2 », dossiers intacts.
