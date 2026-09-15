from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str, marker: str) -> None:
    p = ROOT / path
    s = p.read_text(encoding="utf-8")
    if marker in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"{path}: motif unique introuvable pour {marker!r}")
    p.write_text(s.replace(old, new, 1), encoding="utf-8")


# ── Bootstrapper : la fin d'installation a sa PROPRE fenêtre top-level. ──
replace_once(
    "apps/windows/installer/main.ts",
    'let fenetre: BrowserWindow | null = null;\nlet paquetCourant: PaquetInstallable | null = null;',
    'let fenetre: BrowserWindow | null = null;\nlet fenetreDemarrage: BrowserWindow | null = null;\nlet paquetCourant: PaquetInstallable | null = null;',
    'let fenetreDemarrage: BrowserWindow | null = null;',
)

replace_once(
    "apps/windows/installer/main.ts",
    '''/** La fenêtre de l'application est créée avec `show: false` et n'est montrée
    qu'à `ready-to-show`. Attendre une fenêtre Win32 VISIBLE revient donc à
    attendre l'initialisation que l'application juge elle-même suffisante pour
    apparaître, sans ajouter un second protocole dans le rendu. */\nasync function attendreFenetreApplication(pid: number): Promise<boolean> {''',
    '''function fermerFenetreDemarrage(): void {
\tconst attente = fenetreDemarrage;
\tfenetreDemarrage = null;
\tif (attente && !attente.isDestroyed()) attente.destroy();
}

/** Fenêtre TOP-LEVEL dédiée à la transition finale. Elle n'a ni `parent` ni
    `modal: true` : ce n'est pas un dialogue dans l'installateur, mais une
    vraie petite fenêtre centrée sur l'écran qui reste visible pendant que
    l'application initialise ses réglages, ses dossiers et son scanner. */
async function afficherFenetreDemarrage(): Promise<boolean> {
\tif (fenetreDemarrage && !fenetreDemarrage.isDestroyed()) {
\t\tfenetreDemarrage.center();
\t\tfenetreDemarrage.show();
\t\tfenetreDemarrage.focus();
\t\treturn true;
\t}
\tconst attente = new BrowserWindow({
\t\twidth: 500,
\t\theight: 300,
\t\tframe: false,
\t\tresizable: false,
\t\tminimizable: false,
\t\tmaximizable: false,
\t\tfullscreenable: false,
\t\tclosable: false,
\t\tshow: false,
\t\tbackgroundColor: "#202124",
\t\ticon: join(__dirname, "icon.png"),
\t\ttitle: PRODUCT_NAME,
\t\twebPreferences: {
\t\t\tcontextIsolation: true,
\t\t\tnodeIntegration: false,
\t\t\tsandbox: true,
\t\t},
\t});
\tfenetreDemarrage = attente;
\tattente.on("closed", () => {
\t\tif (fenetreDemarrage === attente) fenetreDemarrage = null;
\t});
\ttry {
\t\tawait attente.loadFile(join(__dirname, "index.html"), { query: { lang: langue, mode: "launch" } });
\t} catch {
\t\tfermerFenetreDemarrage();
\t\treturn false;
\t}
\tif (attente.isDestroyed()) return false;
\tattente.center();
\tattente.show();
\tattente.focus();
\treturn true;
}

/** L'application garde maintenant sa vraie fenêtre CACHÉE jusqu'au signal
    explicite `fenetre.prete()` envoyé après l'initialisation du rendu. Attendre
    une fenêtre Win32 VISIBLE revient donc exactement à attendre que Neo Quiz
    soit configuré et utilisable, pas seulement que Chromium ait peint du HTML. */
async function attendreFenetreApplication(pid: number): Promise<boolean> {''',
    'async function afficherFenetreDemarrage(): Promise<boolean> {',
)

old_termine = '''\t\tcase "termine": {
\t\t\tif (!isAbsolute(message.executable)) {
\t\t\t\tnettoyerSession();
\t\t\t\tenvoyerEtat({ phase: "erreur", code: "installation" });
\t\t\t\treturn;
\t\t\t}
\t\t\tenvoyerEtat({ phase: "demarrage" });
\t\t\tawait ecrireLangueApplication();
\t\t\tconst lancee = await lancerApplicationEtAttendre(message.executable);
\t\t\tif (!lancee) {
\t\t\t\tnettoyerSession();
\t\t\t\tenvoyerEtat({ phase: "erreur", code: "launch" });
\t\t\t\treturn;
\t\t\t}
\t\t\tif (fenetre && !fenetre.isDestroyed()) fenetre.hide();
\t\t\tnettoyerSession();
\t\t\tfermetureAutorisee = true;
\t\t\tapp.quit();
\t\t\treturn;
\t\t}'''
new_termine = '''\t\tcase "termine": {
\t\t\tif (!isAbsolute(message.executable)) {
\t\t\t\tnettoyerSession();
\t\t\t\tenvoyerEtat({ phase: "erreur", code: "installation" });
\t\t\t\treturn;
\t\t\t}
\t\t\t/* La grande fenêtre d'installation disparaît au profit d'une petite
\t\t\t   fenêtre INDÉPENDANTE. Elle reste jusqu'à ce que la vraie fenêtre de
\t\t\t   Neo Quiz soit visible — visibilité qui signifie désormais « rendu
\t\t\t   initialisé », pas simplement `ready-to-show`. */
\t\t\tconst attenteVisible = await afficherFenetreDemarrage();
\t\t\tif (attenteVisible && fenetre && !fenetre.isDestroyed()) fenetre.hide();
\t\t\tawait ecrireLangueApplication();
\t\t\tconst lancee = await lancerApplicationEtAttendre(message.executable);
\t\t\tif (!lancee) {
\t\t\t\tfermerFenetreDemarrage();
\t\t\t\tnettoyerSession();
\t\t\t\tif (fenetre && !fenetre.isDestroyed()) {
\t\t\t\t\tfenetre.show();
\t\t\t\t\tfenetre.focus();
\t\t\t\t}
\t\t\t\tenvoyerEtat({ phase: "erreur", code: "launch" });
\t\t\t\treturn;
\t\t\t}
\t\t\tfermerFenetreDemarrage();
\t\t\tif (fenetre && !fenetre.isDestroyed()) fenetre.hide();
\t\t\tnettoyerSession();
\t\t\tfermetureAutorisee = true;
\t\t\tapp.quit();
\t\t\treturn;
\t\t}'''
replace_once(
    "apps/windows/installer/main.ts",
    old_termine,
    new_termine,
    'const attenteVisible = await afficherFenetreDemarrage();',
)

# Le rendu "launch" reste le même bundle, mais n'initialise PAS l'installateur.
replace_once(
    "apps/windows/installer/renderer-reference.ts",
    '''function rendreDemarrage(parent: HTMLElement): void {
\tconst etape = ajouter(parent, "main", "nqi-launch-stage");
\tetape.setAttribute("role", "status");
\tetape.setAttribute("aria-label", t("installer.windowTitle"));
\tconst carte = ajouter(etape, "section", "nqi-launch-card");
\tconst marque = ajouter(carte, "div", "nqi-launch-brand");
\tconst icone = ajouter(marque, "img", "nqi-launch-icon");
\ticone.src = "./icon.png";
\ticone.alt = "";
\ticone.setAttribute("aria-hidden", "true");
\tajouter(marque, "strong", "nqi-launch-name", t("installer.windowTitle"));
}''',
    '''function rendreDemarrage(parent: HTMLElement): void {
\tconst etape = ajouter(parent, "main", "nqi-launch-stage");
\tetape.setAttribute("role", "status");
\tetape.setAttribute("aria-label", t("installer.windowTitle"));
\t/* Pas de « carte dans une fenêtre » : cette page EST la petite fenêtre. */
\tconst marque = ajouter(etape, "div", "nqi-launch-brand");
\tconst icone = ajouter(marque, "img", "nqi-launch-icon");
\ticone.src = "./icon.png";
\ticone.alt = "";
\ticone.setAttribute("aria-hidden", "true");
\tajouter(marque, "strong", "nqi-launch-name", t("installer.windowTitle"));
}''',
    '/* Pas de « carte dans une fenêtre » : cette page EST la petite fenêtre. */',
)

replace_once(
    "apps/windows/installer/renderer-reference.ts",
    '''\n\tif (etat.phase === "demarrage") {
\t\trendreDemarrage(root);
\t\treturn;
\t}
''',
    '\n',
    'if (etat.phase === "demarrage") {',
)

old_bottom = '''const langueUrl = new URLSearchParams(window.location.search).get("lang");
setLanguage(langueUrl === "fr" || langueUrl === "en" ? langueUrl : "auto");
window.neoInstaller.surEtat(nouvelEtat => {
\tmesurerDebit(nouvelEtat);
\tif (nouvelEtat.phase === "annule") {
\t\tconfirmationAnnulation = false;
\t\tannulationDemandee = false;
\t\tetat = { phase: "pret" };
\t\trendre();
\t\twindow.neoInstaller.fermer();
\t\treturn;
\t}
\tif (nouvelEtat.phase === "erreur") {
\t\tconfirmationAnnulation = false;
\t\tannulationDemandee = false;
\t}
\tetat = nouvelEtat;
\trendre();
});
void initialiser();'''
new_bottom = '''const parametresUrl = new URLSearchParams(window.location.search);
const langueUrl = parametresUrl.get("lang");
const modeAffichage = parametresUrl.get("mode");
setLanguage(langueUrl === "fr" || langueUrl === "en" ? langueUrl : "auto");

if (modeAffichage === "launch") {
\tdocument.documentElement.lang = currentLang();
\tdocument.title = t("installer.windowTitle");
\tconst root = document.getElementById("app");
\tif (root) {
\t\troot.replaceChildren();
\t\trendreDemarrage(root);
\t}
} else {
\twindow.neoInstaller.surEtat(nouvelEtat => {
\t\tmesurerDebit(nouvelEtat);
\t\tif (nouvelEtat.phase === "annule") {
\t\t\tconfirmationAnnulation = false;
\t\t\tannulationDemandee = false;
\t\t\tetat = { phase: "pret" };
\t\t\trendre();
\t\t\twindow.neoInstaller.fermer();
\t\t\treturn;
\t\t}
\t\tif (nouvelEtat.phase === "erreur") {
\t\t\tconfirmationAnnulation = false;
\t\t\tannulationDemandee = false;
\t\t}
\t\tetat = nouvelEtat;
\t\trendre();
\t});
\tvoid initialiser();
}'''
replace_once(
    "apps/windows/installer/renderer-reference.ts",
    old_bottom,
    new_bottom,
    'const modeAffichage = parametresUrl.get("mode");',
)

replace_once(
    "apps/windows/installer/protocole.ts",
    '\t| { phase: "demarrage" }\n',
    '',
    'phase: "demarrage"',
)

replace_once(
    "apps/windows/installer/style-details.css",
    '''/* Étape 5 : un écran de transition, pas une nouvelle page de l'assistant. Il
   masque donc le décor et la barre de titre, et ne disparaît que quand la vraie
   fenêtre de Neo Quiz est devenue visible. */
.nqi-launch-stage {
\tposition: absolute;
\tinset: 0;
\tdisplay: flex;
\talign-items: center;
\tjustify-content: center;
\tpadding: 64px;
\tbackground: #111318;
}

.nqi-launch-card {
\twidth: min(480px, 100%);
\theight: 252px;
\tdisplay: flex;
\talign-items: center;
\tjustify-content: center;
\tborder-radius: 9px;
\tbackground: #020304;
\tbox-shadow: 0 24px 70px rgba(0, 0, 0, .38);
}
''',
    '''/* Étape 5 : cette page EST la fenêtre indépendante de lancement. Pas de
   carte intérieure ni de voile de modal : juste Neo Quiz au centre. */
.nqi-launch-stage {
\tposition: absolute;
\tinset: 0;
\tdisplay: flex;
\talign-items: center;
\tjustify-content: center;
\tbackground: #202124;
\t-webkit-app-region: drag;
}
''',
    'cette page EST la fenêtre indépendante de lancement',
)

# ── Application : la vraie fenêtre ne devient visible qu'après demarrer(). ──
replace_once(
    "apps/windows/electron/pont.ts",
    '''\tfenetre: {
\t\t/**
\t\t * Le rappel à exécuter AVANT que la fenêtre ne se ferme,''',
    '''\tfenetre: {
\t\t/** Signale que le rendu a fini son initialisation et peut être montré. */
\t\tprete(): Promise<void>;
\t\t/**
\t\t * Le rappel à exécuter AVANT que la fenêtre ne se ferme,''',
    'prete(): Promise<void>;',
)

replace_once(
    "apps/windows/electron/pont.ts",
    '\tevenement: "neo:evenement",\n\tarmerFermeture: "neo:fenetre/armer-fermeture",',
    '\tevenement: "neo:evenement",\n\tfenetrePrete: "neo:fenetre/prete",\n\tarmerFermeture: "neo:fenetre/armer-fermeture",',
    'fenetrePrete: "neo:fenetre/prete"',
)

replace_once(
    "apps/windows/electron/preload.ts",
    '''\tfenetre: {
\t\tasync surFermeture(rappel) {''',
    '''\tfenetre: {
\t\tprete: () => ipcRenderer.invoke(CANAUX.fenetrePrete),
\t\tasync surFermeture(rappel) {''',
    'prete: () => ipcRenderer.invoke(CANAUX.fenetrePrete)',
)

replace_once(
    "apps/windows/electron/canaux.ts",
    '''\tfenetre: {
\t\treduire(): void;''',
    '''\tfenetre: {
\t\tprete(): void;
\t\treduire(): void;''',
    'prete(): void;',
)

replace_once(
    "apps/windows/electron/canaux.ts",
    '''\t/* ─── LA FENÊTRE SANS CADRE ───
\t   Le rendu dessine la barre ; le principal exécute. Rien ne traverse
\t   qu'un ordre sans argument, ou un nom d'une union fermée, ou un nombre
\t   borné ici : aucun chemin, aucune URL. */
\tipcMain.handle(CANAUX.fenetreReduire, () => deps.fenetre.reduire());''',
    '''\t/* ─── LA FENÊTRE SANS CADRE ───
\t   Le rendu dessine la barre ; le principal exécute. Rien ne traverse
\t   qu'un ordre sans argument, ou un nom d'une union fermée, ou un nombre
\t   borné ici : aucun chemin, aucune URL. */
\tipcMain.handle(CANAUX.fenetrePrete, () => deps.fenetre.prete());
\tipcMain.handle(CANAUX.fenetreReduire, () => deps.fenetre.reduire());''',
    'ipcMain.handle(CANAUX.fenetrePrete, () => deps.fenetre.prete());',
)

replace_once(
    "apps/windows/electron/main.ts",
    '\tfenetre.once("ready-to-show", () => fenetre?.show());\n',
    '''\t/* `ready-to-show` ne signifie que « Chromium a peint ». La fenêtre reste
\t   volontairement cachée jusqu'au signal explicite du rendu, APRÈS lecture
\t   des réglages, scan initial et montage de l'écran utilisable. */
''',
    'La fenêtre reste\n\t   volontairement cachée jusqu\'au signal explicite du rendu',
)

replace_once(
    "apps/windows/electron/main.ts",
    '''\t\t\tfenetre: {
\t\t\t\treduire: () => fenetre?.minimize(),''',
    '''\t\t\tfenetre: {
\t\t\t\tprete: () => {
\t\t\t\t\tif (!fenetre || fenetre.isDestroyed() || fenetre.isVisible()) return;
\t\t\t\t\tfenetre.show();
\t\t\t\t\tfenetre.focus();
\t\t\t\t},
\t\t\t\treduire: () => fenetre?.minimize(),''',
    'if (!fenetre || fenetre.isDestroyed() || fenetre.isVisible()) return;',
)

replace_once(
    "apps/windows/src/main.ts",
    'void demarrer();',
    '''void demarrer().finally(() => {
\t/* C'est CE signal, et non `ready-to-show`, qui autorise la vraie fenêtre à
\t   apparaître. En installation, le bootstrapper garde sa petite fenêtre
\t   d'attente jusqu'à cet instant. Sur une erreur de démarrage, `demarrer`
\t   a déjà posé le message dans le rendu : on montre donc aussi cette erreur. */
\tvoid pont().fenetre.prete().catch(e => console.error(LOG_PREFIX, "signal prêt impossible:", e));
});''',
    'signal prêt impossible:',
)

# ── Contrôles nommés : séparation de fenêtre + vrai signal de disponibilité. ──
replace_once(
    "scripts/check-installer.mjs",
    'const configBootstrapper = readFileSync(resolve(racine, "apps/windows/installer/electron-builder.config.mjs"), "utf8");',
    '''const configBootstrapper = readFileSync(resolve(racine, "apps/windows/installer/electron-builder.config.mjs"), "utf8");
const protocoleInstallateur = readFileSync(resolve(racine, "apps/windows/installer/protocole.ts"), "utf8");
const styleInstallateur = readFileSync(resolve(racine, "apps/windows/installer/style-details.css"), "utf8");
const principalApplication = readFileSync(resolve(racine, "apps/windows/electron/main.ts"), "utf8");
const pontApplication = readFileSync(resolve(racine, "apps/windows/electron/pont.ts"), "utf8");
const preloadApplication = readFileSync(resolve(racine, "apps/windows/electron/preload.ts"), "utf8");
const canauxApplication = readFileSync(resolve(racine, "apps/windows/electron/canaux.ts"), "utf8");
const renduApplication = readFileSync(resolve(racine, "apps/windows/src/main.ts"), "utf8");''',
    'const protocoleInstallateur = readFileSync',
)

checks = '''\tr.check("fin installation : fenêtre de lancement séparée et centrée, jamais un modal",
\t\t[
\t\t\tprincipalInstallateur.includes("let fenetreDemarrage: BrowserWindow | null = null;"),
\t\t\tprincipalInstallateur.includes("const attente = new BrowserWindow({"),
\t\t\tprincipalInstallateur.includes("attente.center();"),
\t\t\tprincipalInstallateur.includes('query: { lang: langue, mode: "launch" }'),
\t\t\tprincipalInstallateur.includes("if (attenteVisible && fenetre && !fenetre.isDestroyed()) fenetre.hide();"),
\t\t\trenduInstallateur.includes('modeAffichage === "launch"'),
\t\t\trenduInstallateur.includes('const carte = ajouter(etape, "section", "nqi-launch-card")'),
\t\t\tprotocoleInstallateur.includes('phase: "demarrage"'),
\t\t\tstyleInstallateur.includes("cette page EST la fenêtre indépendante de lancement"),
\t\t],
\t\t[true, true, true, true, true, true, false, false, true]);

\tr.check("fin installation : la vraie app devient visible seulement quand elle est prête",
\t\t[
\t\t\tprincipalApplication.includes('fenetre.once("ready-to-show", () => fenetre?.show())'),
\t\t\tpontApplication.includes("prete(): Promise<void>;"),
\t\t\tpontApplication.includes('fenetrePrete: "neo:fenetre/prete"'),
\t\t\tpreloadApplication.includes("prete: () => ipcRenderer.invoke(CANAUX.fenetrePrete)"),
\t\t\tcanauxApplication.includes("ipcMain.handle(CANAUX.fenetrePrete, () => deps.fenetre.prete());"),
\t\t\tprincipalApplication.includes("if (!fenetre || fenetre.isDestroyed() || fenetre.isVisible()) return;"),
\t\t\trenduApplication.includes("void demarrer().finally(() =>"),
\t\t\trenduApplication.includes("pont().fenetre.prete()"),
\t\t\tprincipalInstallateur.includes("attendreFenetreApplication(pid)"),
\t\t],
\t\t[false, true, true, true, true, true, true, true, true]);

'''
replace_once(
    "scripts/check-installer.mjs",
    '\tr.check("démarrage : le bootstrapper évite les deux extractions coûteuses",\n',
    checks + '\tr.check("démarrage : le bootstrapper évite les deux extractions coûteuses",\n',
    'fin installation : fenêtre de lancement séparée et centrée, jamais un modal',
)
