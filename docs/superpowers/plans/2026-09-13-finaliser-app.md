# Tranche 8, finaliser l'application : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une barre de titre sur mesure dans le style de Neo Calendar (menu d'application, contrôles fenêtre, glissement), la reprise à l'endroit exact au relancement, et un fond d'écran choisi dans un dossier, avec sélecteur et « fond suivant ».

**Architecture:** Trois chantiers indépendants, chacun en deux moitiés : ce que le principal expose par le pont (`fenetre.*` pour la barre, `edition` et `zoom` pour le menu, rien de neuf pour la reprise, `choisirDossier` + `listerDossier` déjà bornés pour le fond) et ce que le rendu affiche (`apps/windows/src/ui/barre-titre.ts`, `menu-app.ts`, `reprise.ts`, `fond.ts`). Un seul point du code partagé bouge : deux membres optionnels de `QuizPageSpec` (`initialQuestion`, `onQuestionChange`).

**Tech Stack:** Electron (`frame: false`, `-webkit-app-region`, `BrowserWindow` events, `webContents` edit commands et `setZoomFactor`), Vite, scripts de contrôle Node.

**Spec:** `docs/superpowers/specs/2026-09-13-finaliser-app-design.md`

## Global Constraints

- **Aucune chaîne visible en dur** : `t("<domaine>.<clé>")`, anglais de référence `src/i18n/en/*.ts`, français typé `src/i18n/fr/*.ts`. Les clés neuves vont dans `src/i18n/en/app.ts` et `src/i18n/fr/app.ts` (domaine `app`), sauf `initialQuestion` / `onQuestionChange` qui ne portent aucun texte.
- **Commentaires en français**, le POURQUOI. Aucun artefact d'encodage. Pas d'emoji, pas d'em-dash.
- **Le rendu n'importe jamais un module qui tire Node** ; `npm run check:host` reste à **6** ; `pont.ts` reste sans Node.
- **Aucun chemin venu du rendu n'atteint le disque hors périmètre** : le dossier du fond entre par `choisirDossier` (borné) ; `listerDossier` et `urlDeRessource` sont déjà bornés. Aucun canal neuf ne prend un chemin.
- **Le greffon compile sans voir les membres neufs de `QuizPageSpec`** : optionnels, `npm run check` en 0.
- Scripts de contrôle : `process.exitCode`, `makeReporter`, discriminance ; juger sur le code de sortie.
- Pas de guess sur une API Electron : lire `apps/windows/node_modules/electron/electron.d.ts` (`BrowserWindowConstructorOptions.frame`, `webContents.undo/redo/cut/copy/paste/selectAll`, `setZoomFactor`, `setFullScreen`, `toggleDevTools`, `reload`, événements `maximize`/`unmaximize`/`focus`/`blur`).
- Icônes Lucide par `currentHost().ui.setIcon` (`chevron-down`, `minus`, `square`, `copy` pour « restaurer », `x`, `check`, `chevron-right`, `image`) ; vérifier chaque nom dans le catalogue `lucide`.
- Aucun agent ne lance l'application. Commits sur `main`, sans push par les implémenteurs.

---

### Task 1: La fenêtre sans cadre et les canaux de fenêtre (principal)

**Files:**
- Modify: `apps/windows/electron/main.ts` (`creerFenetre`, événements, menu natif retiré)
- Modify: `apps/windows/electron/pont.ts` (espace `fenetre` élargi, `edition`, `affichage`, `CANAUX`)
- Modify: `apps/windows/electron/preload.ts`
- Modify: `apps/windows/electron/canaux.ts`
- Modify: `scripts/check-windows-host.mjs` (faux `neo.fenetre`, `neo.edition`, `neo.affichage` inertes)

**Interfaces:**
- Produces (pour les Tasks 2 et 3) :

```ts
// pont.ts, espace `fenetre` (les membres existants restent)
fenetre: {
	surFermeture(rappel: () => Promise<void>): Promise<void>;
	reduire(): Promise<void>;
	agrandirOuRestaurer(): Promise<void>;
	fermer(): Promise<void>;
	pleinEcran(): Promise<void>;          // bascule
	etat(): Promise<EtatFenetre>;
	surEtat(rappel: (etat: EtatFenetre) => void): () => void;
};
export interface EtatFenetre { agrandie: boolean; focus: boolean; pleinEcran: boolean }
edition: {
	commande(nom: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll"): Promise<void>;
};
affichage: {
	zoom(facteur: number): Promise<void>;   // borné 0.8..1.5 par le principal, persisté sous `zoom`
	recharger(): Promise<void>;
	outilsDev(): Promise<void>;
};
// CANAUX
fenetreReduire: "neo:fenetre/reduire", fenetreAgrandir: "neo:fenetre/agrandir", fenetreFermer: "neo:fenetre/fermer",
fenetrePleinEcran: "neo:fenetre/plein-ecran", fenetreEtatLire: "neo:fenetre/etat-lire", fenetreEtat: "neo:fenetre/etat",
editionCommande: "neo:edition/commande", affichageZoom: "neo:affichage/zoom", affichageRecharger: "neo:affichage/recharger",
affichageOutilsDev: "neo:affichage/outils-dev",
export const CLE_REGLAGES_ZOOM = "zoom";
```

- [ ] **Step 1 : La fenêtre**

Dans `main.ts`, `creerFenetre` : ajouter `frame: false` aux options (le commentaire : « sans cadre natif, la barre est dessinée par le rendu, style Neo Calendar ; les bords restent redimensionnables sous Windows, `thickFrame` par défaut ») ; juste avant `new BrowserWindow`, `Menu.setApplicationMenu(null)` (import `Menu` de `electron` ; commentaire : « retire aussi les accélérateurs natifs : le menu d'application du rendu les remplace, `Ctrl+R`, `F11`, `Ctrl+Alt+I` inclus »). Après `fenetre.once("ready-to-show")`, brancher :

```ts
	/* L'état de la fenêtre est POUSSÉ au rendu : agrandie ou non (l'icône du
	   bouton du milieu), focus ou non (les glyphes de la barre s'atténuent),
	   plein écran. Le rendu ne le devine jamais depuis `innerWidth`. */
	const pousserEtat = (): void => {
		if (!fenetre || fenetre.isDestroyed()) return;
		fenetre.webContents.send(CANAUX.fenetreEtat, etatFenetre());
	};
	for (const ev of ["maximize", "unmaximize", "focus", "blur", "enter-full-screen", "leave-full-screen"] as const) {
		fenetre.on(ev, pousserEtat);
	}
```

et une fonction module `etatFenetre(): EtatFenetre` qui lit `isMaximized()`, `isFocused()`, `isFullScreen()` (`{ agrandie: false, focus: false, pleinEcran: false }` sans fenêtre). Au démarrage, après `creerFenetre()`, lire le réglage `zoom` (`reglagesOuErreur().lire(CLE_REGLAGES_ZOOM)`) et, si c'est un nombre entre 0.8 et 1.5, `fenetre.webContents.setZoomFactor(n)` une fois la page chargée (`did-finish-load`).

Vérifier dans `electron.d.ts` que les six noms d'événements existent sur `BrowserWindow` (chercher `on(event: 'maximize'`, etc.).

- [ ] **Step 2 : Le pont et le préchargement**

`pont.ts` : les types et canaux de la section Interfaces, avec un commentaire sur `edition.commande` : « les six commandes passent par `webContents` du principal parce que `document.execCommand` est déprécié et que le presse-papiers sandboxé ne colle pas sans geste utilisateur ; le NOM est une union fermée, jugé par le principal ». `preload.ts` : chaque membre en `ipcRenderer.invoke`, `surEtat` sur le patron de `surveiller`.

- [ ] **Step 3 : Les gestionnaires**

`canaux.ts`, `DependancesCanaux` gagne `fenetre: { reduire(): void; agrandirOuRestaurer(): void; fermer(): void; pleinEcran(): void; etat(): EtatFenetre; commande(nom: string): void; zoom(f: number): void; recharger(): void; outilsDev(): void }` ; dans `enregistrerCanaux` :

```ts
	/* ─── LA FENÊTRE SANS CADRE ───
	   Le rendu dessine la barre ; le principal exécute. Rien ne traverse
	   qu'un ordre sans argument, ou un nom d'une union fermée, ou un nombre
	   borné ici : aucun chemin, aucune URL. */
	ipcMain.handle(CANAUX.fenetreReduire, () => deps.fenetre.reduire());
	ipcMain.handle(CANAUX.fenetreAgrandir, () => deps.fenetre.agrandirOuRestaurer());
	ipcMain.handle(CANAUX.fenetreFermer, () => deps.fenetre.fermer());
	ipcMain.handle(CANAUX.fenetrePleinEcran, () => deps.fenetre.pleinEcran());
	ipcMain.handle(CANAUX.fenetreEtatLire, () => deps.fenetre.etat());
	const COMMANDES = new Set(["undo", "redo", "cut", "copy", "paste", "selectAll"]);
	ipcMain.handle(CANAUX.editionCommande, (_e, nom: unknown) => {
		if (typeof nom !== "string" || !COMMANDES.has(nom)) throw new Error(`commande d'édition refusée : ${String(nom)}`);
		deps.fenetre.commande(nom);
	});
	ipcMain.handle(CANAUX.affichageZoom, async (_e, facteur: unknown) => {
		const f = typeof facteur === "number" && Number.isFinite(facteur) ? Math.min(1.5, Math.max(0.8, facteur)) : 1;
		deps.fenetre.zoom(f);
		await deps.reglagesOuErreur().ecrire(CLE_REGLAGES_ZOOM, f);
	});
	ipcMain.handle(CANAUX.affichageRecharger, () => deps.fenetre.recharger());
	ipcMain.handle(CANAUX.affichageOutilsDev, () => deps.fenetre.outilsDev());
```

`main.ts` fournit l'implémentation : `reduire` = `fenetre?.minimize()` ; `agrandirOuRestaurer` = `isMaximized() ? unmaximize() : maximize()` ; `fermer` = `fenetre?.close()` (LE MÊME chemin que la croix native : la fermeture attendue reste garantie) ; `pleinEcran` = `setFullScreen(!isFullScreen())` ; `commande(nom)` = `fenetre?.webContents[nom]()` (le nom est déjà jugé) ; `zoom` = `setZoomFactor` ; `recharger` = `webContents.reload()` ; `outilsDev` = `webContents.toggleDevTools()`.

- [ ] **Step 4 : Le faux pont**

`scripts/check-windows-host.mjs` : dans l'objet `neo`, étendre `fenetre` avec `reduire`, `agrandirOuRestaurer`, `fermer`, `pleinEcran` (async no-op), `etat: async () => ({ agrandie: false, focus: true, pleinEcran: false })`, `surEtat: () => () => {}` ; ajouter `edition: { commande: async () => {} }` et `affichage: { zoom: async () => {}, recharger: async () => {}, outilsDev: async () => {} }`.

- [ ] **Step 5 : Contrôles et commit**

`npm run check:app`, `check:host` (6), `check:windows-host`, `check:electron-reglages` : 0, codes relevés. Commit : `feat(electron): la fenetre sans cadre, ses ordres et son etat par le pont`.

**À vérifier à l'écran (Ahmed, après la Task 2, pas avant)** : sans la Task 2 la fenêtre n'a plus de barre du tout ; ne pas lancer entre les deux.

---

### Task 2: La barre de titre et le menu d'application (rendu)

**Files:**
- Create: `apps/windows/src/ui/barre-titre.ts`
- Create: `apps/windows/src/ui/menu-app.ts`
- Create: `apps/windows/src/ui/menu-app-arbre.ts` (pur : `buildMenu()`, types)
- Create: `scripts/check-menu-app.mjs` ; Modify: `package.json` (`check:menu-app`)
- Modify: `apps/windows/src/main.ts` (montage de la barre, raccourcis)
- Modify: `apps/windows/src/assets/shell.css`
- Modify: `src/i18n/en/app.ts`, `src/i18n/fr/app.ts`
- Modify: `CLAUDE.md` (ligne `check:menu-app`)

**Interfaces:**
- Consumes : `pont().fenetre.*`, `pont().edition.commande`, `pont().affichage.*`, `pont().miseAJour.verifier` (Task 1 et tranche 7).
- Produces : `monterBarreTitre(root, deps: { ouvrirReglages(): void; fondSuivant?(): void })` retourne un démontage ; `menu-app-arbre.ts` exporte `buildMenu(ctx: { version: string; zoom: number })`.

- [ ] **Step 1 : Les clés**

`src/i18n/en/app.ts` :

```ts
	/* ── Barre de titre et menu d'application (application seulement) ── */
	"app.titlebar.menu": "Application menu",
	"app.titlebar.minimize": "Minimize",
	"app.titlebar.maximize": "Maximize",
	"app.titlebar.restore": "Restore",
	"app.titlebar.close": "Close",
	"app.menu.checkUpdates": "Check for updates…",
	"app.menu.settings": "Settings…",
	"app.menu.edit": "Edit",
	"app.menu.undo": "Undo",
	"app.menu.redo": "Redo",
	"app.menu.cut": "Cut",
	"app.menu.copy": "Copy",
	"app.menu.paste": "Paste",
	"app.menu.selectAll": "Select all",
	"app.menu.view": "Display",
	"app.menu.scale": "Interface scale",
	"app.menu.reload": "Reload",
	"app.menu.fullscreen": "Toggle full screen",
	"app.menu.devtools": "Show developer tools",
	"app.menu.nextWallpaper": "Next wallpaper",
```

FR :

```ts
	/* ── Barre de titre et menu d'application (application seulement) ── */
	"app.titlebar.menu": "Menu de l'application",
	"app.titlebar.minimize": "Réduire",
	"app.titlebar.maximize": "Agrandir",
	"app.titlebar.restore": "Restaurer",
	"app.titlebar.close": "Fermer",
	"app.menu.checkUpdates": "Vérifier les mises à jour…",
	"app.menu.settings": "Réglages…",
	"app.menu.edit": "Édition",
	"app.menu.undo": "Annuler",
	"app.menu.redo": "Rétablir",
	"app.menu.cut": "Couper",
	"app.menu.copy": "Copier",
	"app.menu.paste": "Coller",
	"app.menu.selectAll": "Tout sélectionner",
	"app.menu.view": "Affichage",
	"app.menu.scale": "Échelle de l'interface",
	"app.menu.reload": "Recharger",
	"app.menu.fullscreen": "Plein écran",
	"app.menu.devtools": "Outils de développement",
	"app.menu.nextWallpaper": "Fond suivant",
```

Les raccourcis (`Ctrl+,`, `Ctrl+Z`…) ne sont PAS traduits : ce sont des noms de touches.

- [ ] **Step 2 : L'arbre pur et son contrôle, qui rougit d'abord**

`scripts/check-menu-app.mjs` :

```js
/**
 * LE MENU D'APPLICATION — l'arbre pur (`apps/windows/src/ui/menu-app-arbre.ts`).
 * Ce qu'il empêche : une entrée sans identifiant (le clic ne saurait quoi
 * faire), deux identifiants égaux, une échelle hors des bornes du principal,
 * et une coche posée sur un autre palier que le zoom courant.
 *     npm run check:menu-app
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/ui/menu-app-arbre.ts", ({ buildMenu, PALIERS_ZOOM }) => {
	const r = makeReporter("Menu d'application — arbre");
	const menu = buildMenu({ version: "2.5.2", zoom: 1 });
	r.check("trois sous-menus de premier niveau", menu.map(e => e.id), ["app", "edit", "view"]);
	const ids = [];
	const visiter = (entrees) => { for (const e of entrees) { ids.push(e.id); if (e.kind === "submenu") visiter(e.items); } };
	visiter(menu);
	r.check("aucun identifiant vide", ids.every(id => typeof id === "string" && id.length > 0), true);
	r.check("aucun identifiant en double", new Set(ids).size, ids.length);
	r.check("la version est la première ligne du sous-menu Neo Quiz",
		menu[0].items[0], { kind: "version", id: "version", label: "2.5.2" });
	r.check("les paliers d'échelle sont bornés comme le principal (0.8..1.5)",
		[Math.min(...PALIERS_ZOOM), Math.max(...PALIERS_ZOOM)], [0.8, 1.5]);
	const echelle = menu[2].items.find(e => e.id === "scale");
	r.check("la coche est sur le palier courant, et sur lui seul",
		echelle.items.filter(e => e.checked).map(e => e.value), [1]);
	r.check("un zoom hors palier ne coche rien",
		buildMenu({ version: "x", zoom: 1.05 })[2].items.find(e => e.id === "scale").items.filter(e => e.checked).length, 0);
	r.done();
});
```

`package.json` : `"check:menu-app": "node scripts/check-menu-app.mjs"`. Lancer : échec (module absent).

`apps/windows/src/ui/menu-app-arbre.ts` :

```ts
/* ══════════════════════════════════════════════════════════
   L'ARBRE DU MENU D'APPLICATION — pur

   Relu à chaque ouverture, pour que `t()` suive la langue et que la coche
   d'échelle suive le zoom courant. Aucun DOM, aucun pont : `check:menu-app`
   l'éprouve tel quel. Le PRODUIT n'est jamais traduit (`PRODUCT_NAME`).
══════════════════════════════════════════════════════════ */
import { t } from "../../../../src/i18n";
import { PRODUCT_NAME } from "../../../../src/branding";

export type EntreeMenu =
	| { kind: "version"; id: string; label: string }
	| { kind: "action"; id: string; label: string; shortcut?: string; disabled?: boolean }
	| { kind: "check"; id: string; label: string; value: number; checked: boolean }
	| { kind: "separator"; id: string }
	| { kind: "submenu"; id: string; label: string; items: EntreeMenu[] };

/** 80 % à 150 % par pas de 10 : les bornes du principal (`canaux.ts`). */
export const PALIERS_ZOOM = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5];

export function buildMenu(ctx: { version: string; zoom: number }): EntreeMenu[] {
	return [
		{ kind: "submenu", id: "app", label: PRODUCT_NAME, items: [
			{ kind: "version", id: "version", label: ctx.version },
			{ kind: "action", id: "check-updates", label: t("app.menu.checkUpdates") },
			{ kind: "action", id: "settings", label: t("app.menu.settings"), shortcut: "Ctrl+," },
		] },
		{ kind: "submenu", id: "edit", label: t("app.menu.edit"), items: [
			{ kind: "action", id: "undo", label: t("app.menu.undo"), shortcut: "Ctrl+Z" },
			{ kind: "action", id: "redo", label: t("app.menu.redo"), shortcut: "Ctrl+Y" },
			{ kind: "separator", id: "edit-sep" },
			{ kind: "action", id: "cut", label: t("app.menu.cut"), shortcut: "Ctrl+X" },
			{ kind: "action", id: "copy", label: t("app.menu.copy"), shortcut: "Ctrl+C" },
			{ kind: "action", id: "paste", label: t("app.menu.paste"), shortcut: "Ctrl+V" },
			{ kind: "action", id: "select-all", label: t("app.menu.selectAll"), shortcut: "Ctrl+A" },
		] },
		{ kind: "submenu", id: "view", label: t("app.menu.view"), items: [
			{ kind: "submenu", id: "scale", label: t("app.menu.scale"), items: PALIERS_ZOOM.map(p => ({
				kind: "check" as const, id: `scale-${Math.round(p * 100)}`, label: `${Math.round(p * 100)} %`, value: p,
				checked: Math.abs(p - ctx.zoom) < 0.001,
			})) },
			{ kind: "action", id: "next-wallpaper", label: t("app.menu.nextWallpaper"), shortcut: "Ctrl+Shift+B" },
			{ kind: "separator", id: "view-sep" },
			{ kind: "action", id: "reload", label: t("app.menu.reload"), shortcut: "Ctrl+R" },
			{ kind: "action", id: "fullscreen", label: t("app.menu.fullscreen"), shortcut: "F11" },
			{ kind: "action", id: "devtools", label: t("app.menu.devtools"), shortcut: "Ctrl+Alt+I" },
		] },
	];
}
```

Lancer `check:menu-app` : 7/7. Discriminance : dupliquer l'id `undo`, rougit sur « aucun identifiant en double », restaurer.

- [ ] **Step 3 : Le menu (cascade)**

`apps/windows/src/ui/menu-app.ts` : `ouvrirMenuApp(ancre: HTMLElement, deps: ActionsMenu): () => void` où `ActionsMenu = { version: string; zoom(): number; executer(id: string, value?: number): void }`. Une couche `div.nq-menu-couche` (fixed, plein écran, z-index 10002, portalée au `body`) ; un panneau par niveau (`div.nq-menu-panneau`, `position: fixed`), le premier sous l'ancre (`getBoundingClientRect().bottom + 4`), chaque sous-menu à droite de sa ligne (`rect.right - 4`, `rect.top - 12`, rabattu dans la fenêtre s'il déborde). Lignes : `button.nq-menu-ligne` avec `span.nq-menu-coche` (28 px, icône `check` si `checked`), `span.nq-menu-libelle`, `span.nq-menu-raccourci`, `span.nq-menu-chevron` (icône `chevron-right`) pour un sous-menu ; `div.nq-menu-version` inerte ; `div.nq-menu-separateur`. Survol d'un sous-menu l'ouvre (et ferme les frères) ; clic sur une action : `executer(id, value)` puis fermeture. Clavier : flèches Haut/Bas dans le panneau courant, Droite ouvre, Gauche ferme le niveau, Entrée active, Échap ferme tout. Clic sur la couche hors panneau : fermeture. `window` `blur` : fermeture. Retourne la fonction de fermeture ; l'ancre reçoit `data-open` tant que c'est ouvert.

- [ ] **Step 4 : La barre**

`apps/windows/src/ui/barre-titre.ts` :

```ts
export function monterBarreTitre(root: HTMLElement, deps: {
	ouvrirReglages(): void;
	fondSuivant(): void;
}): () => void
```

Construit `div.nq-barre` (prepend dans `root`, avant `#neo-quiz-root` ou autour : lire `apps/windows/index.html` et `main.ts` pour savoir quel élément est la racine de page ; la barre est un frère AVANT `#neo-quiz-root`, dans `body`). Contenu : `div.nq-barre-gauche` (largeur du rail, `--nq-rail-largeur: 220px` à poser si absente ; lire la largeur réelle de `.qbd-sidebar` dans `src/assets/css/dashboard/dashboard-base.css` et reprendre la même valeur) avec `button.nq-barre-menu` (icône `chevron-down`, `aria-label` `t("app.titlebar.menu")`) ; `div.nq-barre-glisse` (flex 1) ; `div.nq-barre-controles` avec trois `button.nq-barre-controle` (`minus`, `square` ou `copy` selon `agrandie`, `x` ; `aria-label` et `title` traduits). `dblclick` sur `nq-barre-glisse` et `nq-barre-gauche` (hors bouton) : `pont().fenetre.agrandirOuRestaurer()`. Abonnement `pont().fenetre.surEtat` + `etat()` initial (avec la garde `pousse` de `mise-a-jour.ts`, même motif) : pose `data-focused` et `data-maximized` sur `nq-barre`, bascule l'icône du milieu. Le menu : clic sur `nq-barre-menu` → `ouvrirMenuApp(bouton, { version: manifeste.version, zoom: () => zoomCourant, executer })` où `executer` fait : `check-updates` → `pont().miseAJour.verifier()` puis `deps.ouvrirReglages()` ; `settings` → `deps.ouvrirReglages()` ; `undo`…`select-all` → `pont().edition.commande(nom)` (table id → nom) ; `scale-*` → `pont().affichage.zoom(value)` et `zoomCourant = value` ; `next-wallpaper` → `deps.fondSuivant()` ; `reload` → `pont().affichage.recharger()` ; `fullscreen` → `pont().fenetre.pleinEcran()` ; `devtools` → `pont().affichage.outilsDev()`. `zoomCourant` initial : lu par `pont().reglages.lire(CLE_REGLAGES_ZOOM)` (nombre ou 1).

Raccourcis, `keydown` sur `document` (capture), hors `input, textarea, [contenteditable]` pour `Ctrl+,` (→ réglages), `Ctrl+Shift+B` (fond suivant) ; `F11` et `Ctrl+R`, `Ctrl+Alt+I` partout (le menu natif qui les portait a disparu avec `Menu.setApplicationMenu(null)`). Les raccourcis d'édition ne sont PAS interceptés : natifs dans les champs.

CSS (`shell.css`) : reprendre les mesures de Neo Calendar (`DesktopTitlebar.css`, `DesktopWindowShell.css`, `DesktopAppMenu.css`) avec les tokens de CE thème (`--background-secondary`, `--text-muted`, `--text-normal`, `--background-modifier-border`, `--background-modifier-hover` ; vérifier chacune dans `host-vars.css`, `check:theme` le dira) :

```css
/* ── LA BARRE DE TITRE (style Neo Calendar) ── */
:root { --nq-barre-hauteur: 45px; --nq-rail-largeur: 220px; }
.nq-barre {
	position: fixed; top: 0; left: 0; right: 0; height: var(--nq-barre-hauteur);
	display: flex; align-items: center; z-index: 5;
	/* Deux teintes : celle du rail à gauche, celle de la coquille ailleurs. */
	background: linear-gradient(to right,
		color-mix(in srgb, var(--background-secondary) 54%, transparent) 0 var(--nq-rail-largeur),
		color-mix(in srgb, var(--background-primary) 40%, transparent) var(--nq-rail-largeur) 100%);
	-webkit-app-region: drag;
}
.nq-barre button { -webkit-app-region: no-drag; }
.nq-barre-gauche { display: flex; align-items: center; flex: none; width: var(--nq-rail-largeur); height: 100%; padding-left: 10px; box-sizing: border-box; border-right: 1px solid var(--background-modifier-border); }
.nq-barre-glisse { flex: 1 1 auto; align-self: stretch; }
.nq-barre-controles { display: flex; align-items: center; gap: 15.5px; padding-right: 24px; }
.nq-barre-menu, .nq-barre-controle { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer; }
.nq-barre-menu:hover, .nq-barre-menu[data-open], .nq-barre-controle:hover { background: color-mix(in srgb, var(--text-normal) 10%, transparent); color: var(--text-normal); }
.nq-barre-menu svg, .nq-barre-controle svg { width: 16px; height: 16px; }
.nq-barre[data-focused="false"] .nq-barre-menu svg, .nq-barre[data-focused="false"] .nq-barre-controle svg { opacity: 0.3; }
#neo-quiz-root { padding-top: var(--nq-barre-hauteur); box-sizing: border-box; }
/* ── LE MENU D'APPLICATION ── */
.nq-menu-couche { position: fixed; inset: 0; z-index: 10002; }
.nq-menu-panneau { position: fixed; min-width: 143px; padding: 12px 0; border: 1px solid var(--background-modifier-border); border-radius: 8px; background: var(--background-primary); color: var(--text-normal); box-shadow: 0 18px 36px -8px rgba(0,0,0,.45), 0 3px 8px -2px rgba(0,0,0,.24); display: flex; flex-direction: column; }
.nq-menu-ligne { display: flex; align-items: center; width: 100%; height: 28px; padding: 0 10px 0 0; border: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; text-align: left; white-space: nowrap; cursor: pointer; }
.nq-menu-coche { display: flex; align-items: center; justify-content: center; width: 28px; height: 100%; color: var(--text-muted); }
.nq-menu-coche svg { width: 14px; height: 14px; }
.nq-menu-libelle { flex: 1 1 auto; }
.nq-menu-raccourci { flex: none; margin-left: 24px; color: var(--text-faint, var(--text-muted)); font-size: 12px; }
.nq-menu-chevron { display: flex; flex: none; margin-left: 24px; color: var(--text-muted); }
.nq-menu-chevron svg { width: 14px; height: 14px; }
.nq-menu-ligne:hover, .nq-menu-ligne:focus, .nq-menu-ligne[aria-expanded="true"] { background: var(--background-modifier-hover); outline: none; }
.nq-menu-separateur { height: 1px; margin: 6px 0; background: var(--background-modifier-border); }
.nq-menu-version { display: flex; align-items: center; height: 28px; padding: 0 10px 0 28px; color: var(--text-faint, var(--text-muted)); font-size: 13px; cursor: default; }
```

Si `--text-faint` n'est pas dans le thème, la retirer et garder `--text-muted` (ne pas ajouter de variable).

- [ ] **Step 5 : Le montage**

`apps/windows/src/main.ts`, au démarrage, avant `mount(root, …)` (et aussi sur l'écran sans dossier, `mountSansDossier`) : `monterBarreTitre(document.body, { ouvrirReglages: () => ouvrirReglages(root, scanner, store, stats), fondSuivant: () => {} })` une seule fois (module-level, pas par écran ; `fondSuivant` sera branché par la Task 4 : laisser un no-op commenté « branché par le fond d'écran »). Sur l'écran sans dossier, `ouvrirReglages` n'a pas de scanner : passer un no-op qui `notice`… NON : passer `ouvrirReglages` seulement quand la coquille est montée ; sur l'écran vide, l'entrée « Réglages… » ouvre le sélecteur de dossier (`pickFolder` de `host/folder.ts`), c'est ce que l'écran propose déjà. Lire `mountSansDossier` pour brancher la même fonction.

- [ ] **Step 6 : Contrôles, CLAUDE.md, commit**

`npm run check` (le greffon ne bouge pas, mais les clés i18n oui), `check:app`, `check:host` (6), `check:theme`, `check:windows-host`, `check:menu-app` : 0. CLAUDE.md, « Commandes », après `check:updater` : « `npm run check:menu-app` — l'arbre pur du menu d'application (identifiants uniques, paliers d'échelle bornés comme le principal, coche sur le zoom courant). » Commit : `feat(app): la barre de titre et le menu d'application, style Neo Calendar`.

**À vérifier à l'écran (Ahmed)** : `npm run app:dev`. Plus de barre native ; une barre de 45 px en verre, plus sombre à gauche sur la largeur du rail ; glisser la fenêtre par la surface vide ; double clic agrandit et restaure ; les trois boutons ; redimensionner par les huit bords et coins ; cliquer ailleurs (autre fenêtre) atténue les glyphes ; le chevron ouvre « Neo Quiz / Édition / Affichage » ; « Neo Quiz > » montre la version, « Vérifier les mises à jour… » ouvre les Réglages, « Réglages… » aussi, `Ctrl+,` aussi ; « Édition > Coller » colle dans un champ de l'éditeur ; « Affichage > Échelle » 120 % agrandit tout, la coche suit, et le zoom survit au relancement ; `Ctrl+R` recharge ; `F11` plein écran et retour ; Échap et clic dehors ferment le menu.

---

### Task 3: Rouvrir là où on s'était arrêté

**Files:**
- Modify: `src/dashboard/detail.ts` (`QuizPageSpec.initialQuestion?`, `onQuestionChange?` ; `goToQuestion` ; premier rendu de la clé)
- Modify: `src/dashboard/detail.ts` `DetailHostSpec` (ajouter les deux membres au `Pick`)
- Create: `apps/windows/src/ui/reprise.ts`
- Modify: `apps/windows/src/ui/dashboard-shell.ts` (`naviguer` et `case "detail"`), `apps/windows/src/main.ts` (au démarrage), `apps/windows/src/ui/settings.ts` (interrupteur), `apps/windows/electron/pont.ts` (`CLE_REGLAGES_REPRISE = "reprise"`, `CLE_DERNIERE_VUE = "derniereVue"`)
- Modify: `src/i18n/en/app.ts`, `src/i18n/fr/app.ts`
- Create: `scripts/check-reprise.mjs` ; Modify: `package.json`, `CLAUDE.md`

**Interfaces:**
- Consumes : `pont().reglages.lire/ecrire`, `scanner.getQuiz(path)`.
- Produces : `reprise.ts` exporte `lireDerniereVue(brut: unknown): DerniereVue | null` (pur), `noterVue(vue: DerniereVue): void` (débouncé 500 ms), `chargerReprise(): Promise<{ actif: boolean; vue: DerniereVue | null }>`, `reglerReprise(actif: boolean): Promise<void>`. `DerniereVue = { vue: "home" | "quizzes" | "ai" | "detail"; quiz?: string; question?: number }`.

- [ ] **Step 1 : Le contrôle du pur, qui rougit**

`scripts/check-reprise.mjs` sur `apps/windows/src/ui/reprise.ts` (`lireDerniereVue`) : `null` sur `undefined`, sur une chaîne, sur `{ vue: "detail" }` sans `quiz` ; `{ vue: "home" }` sur `{ vue: "home", quiz: 3 }` (un quiz non-chaîne est ignoré hors détail) ; `{ vue: "detail", quiz: "Cours/a.md", question: 2 }` reconduit tel quel ; `question: -1` ou `1.5` ou `"2"` → `question` absent ; `vue: "reglages"` (inconnue) → `null`. `npm run check:reprise` : échec (module absent).

- [ ] **Step 2 : `reprise.ts`**

Module pur pour `lireDerniereVue`, plus trois fonctions qui passent par `pont()` (lu à l'appel, comme `mise-a-jour.ts`) : `chargerReprise` lit `reprise` (défaut `true` : `!== false`) et `derniereVue` (par `lireDerniereVue`) ; `noterVue` écrit `derniereVue` avec un `setTimeout` de 500 ms remplacé à chaque appel (commentaire : « la question courante change à chaque flèche ; écrire à chaque coup ferait une écriture disque par touche ») ; `reglerReprise` écrit `reprise`. Ajouter `CLE_REGLAGES_REPRISE` et `CLE_DERNIERE_VUE` à `pont.ts` avec un commentaire (« écrites par le rendu seul, jamais gardées : ni chemin résolu ni URL, un chemin du contrat que le scanner valide avant usage »).

- [ ] **Step 3 : Le code partagé**

`src/dashboard/detail.ts`, `QuizPageSpec` :

```ts
	/** La question à afficher AU PREMIER RENDU de cette clé (bornée). Pour
	    l'hôte qui rouvre là où on s'était arrêté ; le greffon ne la passe
	    pas. Ne vaut qu'à la première ouverture de la clé, comme `startEditing`. */
	initialQuestion?: number;
	/** Appelée à chaque changement de question courante, par `goToQuestion`
	    et nulle part ailleurs — c'est le seul endroit où `activeIdx` bouge. */
	onQuestionChange?(index: number): void;
```

Dans `render`, bloc `if (spec.key !== currentPath)` : après `activeIdx = 0;`, `if (typeof spec.initialQuestion === "number") activeIdx = Math.max(0, Math.floor(spec.initialQuestion));` (borné ensuite par la ligne existante `activeIdx = Math.min(activeIdx, …)` une fois le brouillon chargé ; vérifier qu'elle s'exécute bien après le `load()` pour cette clé). Dans `goToQuestion`, après `activeIdx = clamped;` : `spec.onQuestionChange?.(activeIdx);`. `DetailHostSpec` : `Pick<QuizPageSpec, "onBack" | "isStale" | "startEditing" | "initialQuestion" | "onQuestionChange">` et `createDetailHandlers` les relaie (`initialQuestion: host.initialQuestion, onQuestionChange: host.onQuestionChange`).

- [ ] **Step 4 : La coquille et le démarrage**

`dashboard-shell.ts` : `naviguer` appelle `noterVue({ vue, quiz: data?.quiz?.path })` (pour `detail`, `quiz` obligatoire) ; `case "detail"` passe `initialQuestion: questionInitiale` (variable module posée par le démarrage, consommée au premier rendu : remise à `undefined` après) et `onQuestionChange: (i) => noterVue({ vue: "detail", quiz: quiz.path, question: i })`. Exporter `reprendre(vue: DerniereVue, scanner: Scanner): boolean` qui, si `vue.vue === "detail"` et `scanner.getQuiz(vue.quiz)` existe, pose `quizSelectionne`, `vuePrecedente = "quizzes"`, `vueCourante = "detail"`, `questionInitiale = vue.question` et rend `true` ; sinon pose `vueCourante = vue.vue` (si `canOpen`) et rend `true` ; `false` si le quiz a disparu (l'accueil, sans message : une note supprimée n'est pas une erreur).

`main.ts`, au démarrage, après la création du scanner et AVANT `mount(root, …)` : `const r = await chargerReprise(); if (r.actif && r.vue) reprendre(r.vue, scanner);`.

`settings.ts`, section « À propos » ou une section « Général » avant « Outils IA » (choisir « Général », clé `app.settings.general` = « General » / « Général ») : un interrupteur « Rouvrir là où on s'était arrêté » (`app.reprise.label`, aide `app.reprise.hint` : « At launch, Neo Quiz opens the last quiz and question you were on. » / « Au lancement, Neo Quiz rouvre le dernier quiz et la dernière question consultés. ») → `reglerReprise(checked)`.

- [ ] **Step 5 : Contrôles et commit**

`check` (le greffon compile avec les membres optionnels), `check:app`, `check:host` (6), `check:reprise`, `check:windows-host`, `check:dashboard-dom`, `check:review-store` (touche `detail.ts` ? non, mais `check:module-edit` et `check:engine-review` passent par le dashboard : les lancer). Discriminance sur `check:reprise` : faire accepter `vue: "reglages"`, rougit, restaurer. CLAUDE.md : ligne `check:reprise`. Commit : `feat(app): rouvrir la ou on s'etait arrete`.

**À vérifier à l'écran (Ahmed)** : ouvrir un quiz, aller à la question 3, fermer par la croix, relancer : même quiz, question 3 ; revenir à « Mes quiz », fermer, relancer : « Mes quiz » ; décocher le réglage, fermer, relancer : accueil ; supprimer la note du quiz, relancer : accueil sans erreur.

---

### Task 4: Le fond d'écran

**Files:**
- Create: `apps/windows/src/ui/fond.ts` ; Create: `apps/windows/src/ui/fond-pur.ts` (extensions, choix du suivant)
- Modify: `apps/windows/src/ui/settings.ts` (section « Fond d'écran »), `apps/windows/src/main.ts` (branchement `fondSuivant` de la barre, pose du fond au démarrage), `apps/windows/src/assets/shell.css`, `apps/windows/electron/pont.ts` (`CLE_REGLAGES_FOND = "fond"`), `apps/windows/electron/canaux.ts` (le dossier du fond ADMIS au périmètre au démarrage : lire `perimetreInitial` dans `perimetre.ts` et la manière dont les dossiers de quiz y entrent ; le dossier du fond y entre de la même façon, en LECTURE seulement s'il existe une distinction, sinon comme les autres)
- Modify: `src/i18n/en/app.ts`, `src/i18n/fr/app.ts`
- Create: `scripts/check-fond.mjs` ; Modify: `package.json`, `CLAUDE.md`

**Interfaces:**
- Consumes : `pont().dialogue.choisirDossier()` (rend un chemin absolu déjà admis au périmètre, ou `null` ; lire `canaux.ts` pour confirmer qu'il admet le dossier choisi), `pont().fichiers.listerDossier(abs)`, `urlDeRessource(abs)` (`electron/ressources.ts`, sans Node).
- Produces : `fond-pur.ts` : `EXTENSIONS_FOND`, `estImageDeFond(nom: string): boolean`, `suivante(noms: string[], courante: string | undefined): string | undefined` (la suivante dans l'ordre trié, cyclique ; la première si la courante est absente ; `undefined` si vide) ; `fond.ts` : `appliquerFond(): Promise<void>` (lit le réglage, liste, pose `document.body.style.backgroundImage`, Notice si l'image a disparu), `fondSuivant(): Promise<void>`, `choisirDossierFond(): Promise<void>`, `retirerFond(): Promise<void>`, `monterReglagesFond(section: HTMLElement): () => void`.

- [ ] **Step 1 : Le contrôle du pur, qui rougit**

`scripts/check-fond.mjs` sur `fond-pur.ts` : `estImageDeFond` vrai pour `a.jpg`, `B.JPEG`, `c.png`, `d.webp`, `e.avif`, `f.gif` ; faux pour `g.svg`, `h.txt`, `i`, `.jpg` (nom vide) ; `suivante(["b.png","a.jpg","c.webp"], "a.jpg")` = `"b.png"` (ordre trié) ; `suivante([...], "c.webp")` = `"a.jpg"` (cyclique) ; `suivante([...], "zz.jpg")` = `"a.jpg"` (disparue → première) ; `suivante([], undefined)` = `undefined`. `npm run check:fond` : échec.

- [ ] **Step 2 : `fond-pur.ts` puis `fond.ts`**

Le pur d'abord (7/7). Puis `fond.ts` : le réglage `{ dossier: string; image: string }` lu par `pont().reglages.lire(CLE_REGLAGES_FOND)` et validé (deux chaînes non vides, sinon `null`). `appliquerFond` : sans réglage → `document.body.style.backgroundImage = ""` (le CSS reprend `wallpaper.jpg`) ; avec : `listerDossier(dossier)` filtré par `estImageDeFond`, trié ; si `image` absente de la liste → `suivante(liste, undefined)`, réécrire le réglage, Notice `t("app.fond.disparue")` ; si liste vide → réglage effacé, Notice `t("app.fond.dossierVide")`, CSS par défaut ; sinon poser `url("${urlDeRessource(dossier + "/" + image)}")` (composer le chemin avec le séparateur que `listerDossier` attend : lire `apps/windows/src/host/fs.ts` pour la convention `/`). Le voile sombre du CSS reste : ne poser QUE l'image, pas le dégradé (mettre l'image en `--nq-fond-image` et réécrire la règle `body { background: linear-gradient(...), var(--background-primary) var(--nq-fond-image, url("/wallpaper.jpg")) center / cover no-repeat fixed }` : une variable, pas un `style.background` complet).

`monterReglagesFond(section)` : le chemin du dossier ou « Aucun dossier » ; boutons « Choisir un dossier » (`choisirDossierFond` : `choisirDossier()` puis écrire `{ dossier, image: suivante(liste, undefined) }` puis `appliquerFond()` ; si aucune image dedans, Notice et ne rien écrire), « Retirer » ; une grille `div.nq-fond-grille` de vignettes `button.nq-fond-vignette` (`background-image` par `urlDeRessource`, 96 px, `data-active` sur la courante ; clic → écrire `image`, `appliquerFond()`, redessiner) ; « Fond suivant ».

- [ ] **Step 3 : Le périmètre**

Le dossier du fond doit être SERVABLE par `app:` au lancement suivant : lire `perimetreInitial` (`perimetre.ts`) et `canaux.ts` (`choisirDossier` admet le dossier choisi pour la session). Ajouter au démarrage (`main.ts` du principal, à côté d'`admettreHoteOllama`) l'admission du `fond.dossier` persisté s'il existe sur le disque (vérifier avec `perimetre.ts` s'il y a une fonction d'admission d'un dossier ; l'appeler avec le même geste que pour les dossiers de quiz persistés). Un cas dans `scripts/check-electron-reglages.mjs` : un réglage `fond` avec un `dossier` non-chaîne ou vide n'admet rien (discriminance).

- [ ] **Step 4 : Clés, CSS, montage**

EN : `"app.settings.wallpaper": "Wallpaper"`, `"app.fond.none": "No folder chosen: the built-in wallpaper is used."`, `"app.fond.choose": "Choose a folder"`, `"app.fond.remove": "Remove"`, `"app.fond.next": "Next wallpaper"`, `"app.fond.disparue": "The wallpaper image is gone; the first image of the folder is used."`, `"app.fond.dossierVide": "No image in that folder; the built-in wallpaper is used."`. FR : « Fond d'écran », « Aucun dossier choisi : le fond embarqué est utilisé. », « Choisir un dossier », « Retirer », « Fond suivant », « L'image du fond a disparu ; la première du dossier est utilisée. », « Aucune image dans ce dossier ; le fond embarqué est utilisé. ».

CSS : `.nq-fond-grille { display: grid; grid-template-columns: repeat(auto-fill, 96px); gap: 8px; }`, `.nq-fond-vignette { width: 96px; height: 60px; border: 2px solid transparent; border-radius: 6px; background: center / cover no-repeat; cursor: pointer; }`, `.nq-fond-vignette[data-active] { border-color: var(--text-accent); }`.

`settings.ts` : section « Fond d'écran » après « Général ». `main.ts` : `await appliquerFond()` au démarrage (après le périmètre : le rendu n'a pas à attendre, le principal a déjà admis) ; la barre reçoit `fondSuivant: () => { void fondSuivant(); }`.

- [ ] **Step 5 : Contrôles et commit**

`check:app`, `check:host` (6), `check:fond`, `check:theme`, `check:windows-host`, `check:electron-reglages`, `check:menu-app`. CLAUDE.md : ligne `check:fond`. Commit : `feat(app): un fond d'ecran choisi dans un dossier, suivant, image disparue signalee`.

**À vérifier à l'écran (Ahmed)** : Réglages > Fond d'écran > Choisir un dossier avec des images : la grille se remplit, le fond change ; cliquer une vignette ; « Fond suivant » (menu, bouton, `Ctrl+Shift+B`) ; relancer : le fond est là ; supprimer l'image courante sur le disque, relancer : Notice et première image ; « Retirer » : fond embarqué.

---

### Task 5: Les épreuves (contrôleur)

- [ ] Écrire `docs/superpowers/notes/2026-09-13-tranche-8-epreuves-ecran.md` en regroupant les quatre listes « À vérifier à l'écran » ci-dessus, en cases à cocher ; commit ; push.
