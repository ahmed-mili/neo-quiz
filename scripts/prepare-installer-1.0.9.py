from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str, marker: str) -> None:
    p = ROOT / path
    s = p.read_text(encoding="utf-8")
    if marker in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"{path}: motif unique introuvable pour {marker!r}")
    p.write_text(s.replace(old, new, 1), encoding="utf-8")


def regex_once(path: str, pattern: str, new: str, marker: str) -> None:
    p = ROOT / path
    s = p.read_text(encoding="utf-8")
    if marker in s:
        return
    out, n = re.subn(pattern, new, s, count=1, flags=re.S)
    if n != 1:
        raise SystemExit(f"{path}: motif regex unique introuvable pour {marker!r}")
    p.write_text(out, encoding="utf-8")


# ── Le bootstrapper garde SA fenêtre pendant le démarrage de l'app. ──
replace_once(
    "apps/windows/installer/main.ts",
    'let fenetre: BrowserWindow | null = null;\nlet fenetreDemarrage: BrowserWindow | null = null;\n',
    'let fenetre: BrowserWindow | null = null;\n',
    'let fenetreDemarrage: BrowserWindow | null = null;',
)

old_termine = '''\t\tcase "termine": {
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
new_termine = '''\t\tcase "termine": {
\t\t\tif (!isAbsolute(message.executable)) {
\t\t\t\tnettoyerSession();
\t\t\t\tenvoyerEtat({ phase: "erreur", code: "installation" });
\t\t\t\treturn;
\t\t\t}
\t\t\t/* L'installation est finie mais le bootstrapper RESTE à l'écran : le
\t\t\t   rendu remplace la progression par un spinner pendant que Neo Quiz
\t\t\t   s'initialise caché. Il ne disparaît qu'une fois la vraie fenêtre de
\t\t\t   l'application devenue visible, donc réellement prête. */
\t\t\tenvoyerEtat({ phase: "demarrage" });
\t\t\tawait ecrireLangueApplication();
\t\t\tconst lancee = await lancerApplicationEtAttendre(message.executable);
\t\t\tif (!lancee) {
\t\t\t\tnettoyerSession();
\t\t\t\tenvoyerEtat({ phase: "erreur", code: "launch" });
\t\t\t\treturn;
\t\t\t}
\t\t\tnettoyerSession();
\t\t\tfermetureAutorisee = true;
\t\t\tfenetre?.close();
\t\t\tapp.quit();
\t\t\treturn;
\t\t}'''
replace_once(
    "apps/windows/installer/main.ts",
    old_termine,
    new_termine,
    'envoyerEtat({ phase: "demarrage" });',
)

regex_once(
    "apps/windows/installer/main.ts",
    r'\nfunction fermerFenetreDemarrage\(\): void \{.*?\n\}\n\n/\*\* L\'application garde maintenant sa vraie fenêtre CACHÉE',
    "\n/** L'application garde maintenant sa vraie fenêtre CACHÉE",
    "function fermerFenetreDemarrage(): void",
)

# ── Rendu : étape finale = spinner dans la fenêtre principale. ──
old_demarrage = '''function rendreDemarrage(parent: HTMLElement): void {
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
}'''
new_demarrage = '''function rendreDemarrage(parent: HTMLElement): void {
\tconst etape = ajouter(parent, "section", "nqi-launching-stage");
\tetape.setAttribute("role", "status");
\tetape.setAttribute("aria-live", "polite");
\tetape.setAttribute("aria-label", t("installer.status.launching"));
\tconst anneau = ajouter(etape, "div", "nqi-loading-spinner");
\tanneau.setAttribute("aria-hidden", "true");
\tajouter(etape, "p", "nqi-launching-status", t("installer.status.launching"));
}'''
replace_once(
    "apps/windows/installer/renderer-reference.ts",
    old_demarrage,
    new_demarrage,
    '"nqi-launching-stage"',
)

replace_once(
    "apps/windows/installer/renderer-reference.ts",
    '''\tif (chargement) {
\t\trendreChargement(contenu);
\t\treturn;
\t}

\tif (etat.phase === "elevation" || etat.phase === "telechargement" || etat.phase === "verification" || etat.phase === "installation") {''',
    '''\tif (chargement) {
\t\trendreChargement(contenu);
\t\treturn;
\t}

\tif (etat.phase === "demarrage") {
\t\trendreDemarrage(contenu);
\t\treturn;
\t}

\tif (etat.phase === "elevation" || etat.phase === "telechargement" || etat.phase === "verification" || etat.phase === "installation") {''',
    'if (etat.phase === "demarrage") {',
)

replace_once(
    "apps/windows/installer/renderer-reference.ts",
    '''\tfermer.title = t("installer.close");
\tfermer.setAttribute("aria-label", t("installer.close"));
\tfermer.addEventListener("click", () => {''',
    '''\tfermer.title = t("installer.close");
\tfermer.setAttribute("aria-label", t("installer.close"));
\t/* Une fois installé, l'app est déjà en train de démarrer : fermer à cet
\t   instant créerait un faux bouton d'annulation alors qu'il n'y a plus rien
\t   à annuler. La réduction reste disponible. */
\tfermer.disabled = etat.phase === "demarrage";
\tfermer.addEventListener("click", () => {''',
    'fermer.disabled = etat.phase === "demarrage";',
)

old_bottom = '''const parametresUrl = new URLSearchParams(window.location.search);
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
new_bottom = '''const langueUrl = new URLSearchParams(window.location.search).get("lang");
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
replace_once(
    "apps/windows/installer/renderer-reference.ts",
    old_bottom,
    new_bottom,
    'const modeAffichage = parametresUrl.get("mode");',
)

replace_once(
    "apps/windows/installer/protocole.ts",
    '\t| { phase: "installation"; pourcent: number }\n\t| { phase: "annule" }',
    '\t| { phase: "installation"; pourcent: number }\n\t| { phase: "demarrage" }\n\t| { phase: "annule" }',
    'phase: "demarrage"',
)

regex_once(
    "apps/windows/installer/style-details.css",
    r'/\* Étape 5 : cette page EST la fenêtre indépendante de lancement\..*?\.nqi-launch-name \{.*?\n\}\n',
    '''/* Étape 5 : l'installation est terminée ; la fenêtre principale reste
   affichée avec un simple anneau pendant que la vraie application finit son
   initialisation cachée. Elle se ferme dès que Neo Quiz devient visible. */
.nqi-launching-stage {
\tposition: absolute;
\tinset: 48px 0 0;
\tz-index: 1;
\tdisplay: flex;
\tflex-direction: column;
\talign-items: center;
\tjustify-content: center;
\tgap: 16px;
}

.nqi-launching-status {
\tmargin: 0;
\tfont-size: 13px;
\tline-height: 1.3;
\tfont-weight: 600;
\tcolor: rgba(245, 248, 255, .91);
}
''',
    ".nqi-launching-stage {",
)

# ── Libellé de l'étape finale. ──
replace_once(
    "src/i18n/en/installer.ts",
    '\t"installer.status.installingProgress": "Installing… {percent}%",\n',
    '\t"installer.status.installingProgress": "Installing… {percent}%",\n\t"installer.status.launching": "Opening Neo Quiz…",\n',
    '"installer.status.launching"',
)
replace_once(
    "src/i18n/fr/installer.ts",
    '\t"installer.status.installingProgress": "Installation… {percent} %",\n',
    '\t"installer.status.installingProgress": "Installation… {percent} %",\n\t"installer.status.launching": "Ouverture de Neo Quiz…",\n',
    '"installer.status.launching"',
)

# ── Contrôle permanent : pas de seconde fenêtre, spinner dans l'installeur. ──
old_check = '''\tr.check("fin installation : fenêtre de lancement séparée et centrée, jamais un modal",
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
\t\t[true, true, true, true, true, true, false, false, true]);'''
new_check = '''\tr.check("fin installation : spinner dans l'installeur jusqu'à ce que l'app soit prête",
\t\t[
\t\t\tprincipalInstallateur.includes('envoyerEtat({ phase: "demarrage" });'),
\t\t\tprotocoleInstallateur.includes('phase: "demarrage"'),
\t\t\trenduInstallateur.includes('if (etat.phase === "demarrage")'),
\t\t\trenduInstallateur.includes('rendreDemarrage(contenu);'),
\t\t\trenduInstallateur.includes('installer.status.launching'),
\t\t\tstyleInstallateur.includes(".nqi-launching-stage"),
\t\t\trenduInstallateur.includes('fermer.disabled = etat.phase === "demarrage";'),
\t\t\tprincipalInstallateur.includes("let fenetreDemarrage: BrowserWindow | null = null;"),
\t\t\tprincipalInstallateur.includes('mode: "launch"'),
\t\t\trenduInstallateur.includes('modeAffichage === "launch"'),
\t\t],
\t\t[true, true, true, true, true, true, true, false, false, false]);'''
replace_once(
    "scripts/check-installer.mjs",
    old_check,
    new_check,
    "fin installation : spinner dans l'installeur jusqu'à ce que l'app soit prête",
)
