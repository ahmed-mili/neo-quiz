from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: attendu 1 bloc à remplacer, obtenu {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def append_once(path: str, marker: str, addition: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if marker in text:
        return
    p.write_text(text.rstrip() + "\n\n" + addition.strip() + "\n", encoding="utf-8")


# main.ts — fenêtre visible plus tôt + annulation possible dès l'élévation.
patch(
    "apps/windows/installer/main.ts",
    'let serveurTube: Server | null = null;\nlet installationActive = false;\nlet installationCritique = false;',
    'let serveurTube: Server | null = null;\nlet processusElevation: ReturnType<typeof spawn> | null = null;\nlet installationActive = false;',
)
patch(
    "apps/windows/installer/main.ts",
    '''function nettoyerSession(): void {
\tsocketTravailleur?.destroy();
\tsocketTravailleur = null;
\tif (serveurTube) {
\t\ttry { serveurTube.close(); } catch { /* déjà fermé */ }
\t}
\tserveurTube = null;
\tinstallationActive = false;
\tinstallationCritique = false;
}''',
    '''function nettoyerSession(): void {
\tconst elevation = processusElevation;
\tprocessusElevation = null;
\tif (elevation && !elevation.killed) {
\t\ttry { elevation.kill(); } catch { /* déjà terminé */ }
\t}
\tsocketTravailleur?.destroy();
\tsocketTravailleur = null;
\tif (serveurTube) {
\t\ttry { serveurTube.close(); } catch { /* déjà fermé */ }
\t}
\tserveurTube = null;
\tinstallationActive = false;
}''',
)
patch(
    "apps/windows/installer/main.ts",
    '''\t\tcase "installation":
\t\t\tinstallationCritique = true;
\t\t\tenvoyerEtat({ phase: "installation", pourcent: message.pourcent });''',
    '''\t\tcase "installation":
\t\t\tenvoyerEtat({ phase: "installation", pourcent: message.pourcent });''',
)
patch(
    "apps/windows/installer/main.ts",
    '''\tconst parNom = executable ? langueDepuisNom(parse(executable).base) : null;
\tif (parNom && parNom !== "en") {
\t\tlangue = parNom; langueDuSite = true;
\t\treturn;
\t}''',
    '''\tconst parNom = executable ? langueDepuisNom(parse(executable).base) : null;
\t/* Les deux liens du site distribuent désormais des NOMS distincts : le nom
\t   suffit donc immédiatement et évite une lecture ADS avant d'ouvrir la
\t   fenêtre. Zone.Identifier ne sert plus que de repli pour un fichier renommé. */
\tif (parNom) {
\t\tlangue = parNom; langueDuSite = true;
\t\treturn;
\t}''',
)
patch(
    "apps/windows/installer/main.ts",
    '''\t\tconst enfant = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
\t\t\twindowsHide: true,
\t\t\tstdio: "ignore",
\t\t\tenv: {
\t\t\t\t...process.env,
\t\t\t\tNQ_INSTALLER_EXE: executable,
\t\t\t\tNQ_INSTALLER_PIPE: nomTube,
\t\t\t\tNQ_INSTALLER_PAYLOAD: charge,
\t\t\t},
\t\t});
\t\tenfant.once("error", () => resolvePromise(-1));
\t\tenfant.once("exit", code => resolvePromise(code ?? -1));''',
    '''\t\tconst enfant = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
\t\t\twindowsHide: true,
\t\t\tstdio: "ignore",
\t\t\tenv: {
\t\t\t\t...process.env,
\t\t\t\tNQ_INSTALLER_EXE: executable,
\t\t\t\tNQ_INSTALLER_PIPE: nomTube,
\t\t\t\tNQ_INSTALLER_PAYLOAD: charge,
\t\t\t},
\t\t});
\t\tprocessusElevation = enfant;
\t\tconst terminer = (code: number): void => {
\t\t\tif (processusElevation === enfant) processusElevation = null;
\t\t\tresolvePromise(code);
\t\t};
\t\tenfant.once("error", () => terminer(-1));
\t\tenfant.once("exit", code => terminer(code ?? -1));''',
)
patch(
    "apps/windows/installer/main.ts",
    '''\tinstallationActive = true;
\tinstallationCritique = false;
\tenvoyerEtat({ phase: "elevation" });''',
    '''\tinstallationActive = true;
\tenvoyerEtat({ phase: "elevation" });''',
)
patch(
    "apps/windows/installer/main.ts",
    '''\tipcMain.handle(CANAUX_INSTALLATEUR.annuler, async () => {
\t\tif (!installationActive || installationCritique || !socketTravailleur) return;
\t\tsocketTravailleur.write(`${JSON.stringify({ type: "annuler" })}\\n`);
\t});''',
    '''\tipcMain.handle(CANAUX_INSTALLATEUR.annuler, async () => {
\t\tif (!installationActive) return;
\t\tif (socketTravailleur) {
\t\t\tsocketTravailleur.write(`${JSON.stringify({ type: "annuler" })}\\n`);
\t\t\treturn;
\t\t}
\t\t/* Avant l'authentification du travailleur, l'unique processus en attente
\t\t   est PowerShell/RunAs. Le terminer ferme cette tentative UAC sans
\t\t   laisser l'interface coincée sur un faux état d'attente. */
\t\tnettoyerSession();
\t\tenvoyerEtat({ phase: "annule" });
\t});''',
)
patch(
    "apps/windows/installer/main.ts",
    'fenetre.once("ready-to-show", () => fenetre?.show());',
    '''fenetre.webContents.once("dom-ready", () => {
\t\tif (!fenetre || fenetre.isDestroyed()) return;
\t\tfenetre.show();
\t\tfenetre.focus();
\t});''',
)

# worker.ts — une demande d'annulation reste prise en compte pendant NSIS.
patch(
    "apps/windows/installer/worker.ts",
    'import { access, mkdtemp, rm } from "node:fs/promises";',
    'import { access, mkdtemp, readdir, rm } from "node:fs/promises";',
)
patch(
    "apps/windows/installer/worker.ts",
    '''async function ouvrirTube(nom: string): Promise<Socket> {''',
    '''async function nettoyerInstallationFraiche(dossier: string, supprimerDossier: boolean): Promise<void> {
\t/* Pendant NSIS on ne tue pas brutalement le processus : une interruption au
\t   milieu d'une écriture peut laisser registre/raccourcis incohérents. La
\t   demande est mémorisée, NSIS termine sa transaction, puis une installation
\t   FRAÎCHE est désinstallée proprement avant de rendre « annulé ». Une mise
\t   à jour existante n'est jamais supprimée : mieux vaut conserver une app
\t   cohérente que détruire la version précédente en prétendant annuler. */
\tlet desinstalleur: string | null = null;
\ttry {
\t\tconst noms = await readdir(dossier);
\t\tconst nom = noms.find(item => /^uninstall.*\\.exe$/i.test(item));
\t\tif (nom) desinstalleur = join(dossier, nom);
\t} catch {
\t\t// Le dossier peut déjà avoir disparu : rien à nettoyer.
\t}
\tif (desinstalleur) {
\t\tawait new Promise<void>(resolvePromise => {
\t\t\tconst enfant = spawn(desinstalleur as string, ["/S"], { windowsHide: true, stdio: "ignore" });
\t\t\tlet fini = false;
\t\t\tconst terminer = (): void => {
\t\t\t\tif (fini) return;
\t\t\t\tfini = true;
\t\t\t\tclearTimeout(limite);
\t\t\t\tresolvePromise();
\t\t\t};
\t\t\tconst limite = setTimeout(() => {
\t\t\t\ttry { enfant.kill(); } catch { /* déjà terminé */ }
\t\t\t\tterminer();
\t\t\t}, 20_000);
\t\t\tenfant.once("error", terminer);
\t\t\tenfant.once("exit", terminer);
\t\t});
\t}
\tif (supprimerDossier) {
\t\ttry { await rm(dossier, { recursive: true, force: true }); } catch { /* meilleur effort */ }
\t}
}

async function ouvrirTube(nom: string): Promise<Socket> {''',
)
patch(
    "apps/windows/installer/worker.ts",
    '''\tconst annulation = new AbortController();
\tlet installationCommencee = false;
\tecouterCommandes(socket, commande => {
\t\tif (commande.type === "annuler" && !installationCommencee) annulation.abort();
\t});

\tconst temporaire = await mkdtemp(join(tmpdir(), "neo-quiz-installer-"));''',
    '''\tconst annulation = new AbortController();
\tlet dossierExistait = true;
\ttry { await access(charge.dossier); } catch { dossierExistait = false; }
\tlet installationExistante = true;
\ttry { await access(join(charge.dossier, "neo-quiz.exe")); } catch { installationExistante = false; }
\tecouterCommandes(socket, commande => {
\t\tif (commande.type === "annuler") annulation.abort();
\t});

\tconst temporaire = await mkdtemp(join(tmpdir(), "neo-quiz-installer-"));''',
)
patch(
    "apps/windows/installer/worker.ts",
    '''\t\tenvoyer(socket, { type: "verification" });
\t\tinstallationCommencee = true;
\t\tawait lancerNsis(cheminPaquet, charge.dossier, pourcent => {
\t\t\tenvoyer(socket, { type: "installation", pourcent });
\t\t});

\t\tconst executable = join(charge.dossier, "neo-quiz.exe");''',
    '''\t\tenvoyer(socket, { type: "verification" });
\t\tif (annulation.signal.aborted) {
\t\t\tenvoyer(socket, { type: "annule" });
\t\t\tawait terminerTube(socket);
\t\t\treturn 0;
\t\t}
\t\tawait lancerNsis(cheminPaquet, charge.dossier, pourcent => {
\t\t\tenvoyer(socket, { type: "installation", pourcent });
\t\t});
\t\tif (annulation.signal.aborted) {
\t\t\tif (!installationExistante) await nettoyerInstallationFraiche(charge.dossier, !dossierExistait);
\t\t\tenvoyer(socket, { type: "annule" });
\t\t\tawait terminerTube(socket);
\t\t\treturn 0;
\t\t}

\t\tconst executable = join(charge.dossier, "neo-quiz.exe");''',
)
patch(
    "apps/windows/installer/worker.ts",
    '''\t} catch (erreur) {
\t\tif (annulation.signal.aborted && !installationCommencee) {
\t\t\tenvoyer(socket, { type: "annule" });
\t\t\tawait terminerTube(socket);
\t\t\treturn 0;
\t\t}''',
    '''\t} catch (erreur) {
\t\tif (annulation.signal.aborted) {
\t\t\tif (!installationExistante) await nettoyerInstallationFraiche(charge.dossier, !dossierExistait);
\t\t\tenvoyer(socket, { type: "annule" });
\t\t\tawait terminerTube(socket);
\t\t\treturn 0;
\t\t}''',
)

# renderer-reference.ts — étape 1 visible, passage immédiat à l'étape 3,
# confirmation d'annulation pendant toutes les phases actives.
patch(
    "apps/windows/installer/renderer-reference.ts",
    '''let echantillonTelechargement: { recus: number; instant: number } | null = null;
let debitTelechargement: number | null = null;''',
    '''let echantillonTelechargement: { recus: number; instant: number } | null = null;
let debitTelechargement: number | null = null;
let confirmationAnnulation = false;
let annulationDemandee = false;''',
)
patch(
    "apps/windows/installer/renderer-reference.ts",
    '''function phaseVerrouilleFermeture(): boolean {
\treturn etat.phase === "elevation" || etat.phase === "telechargement" ||
\t\tetat.phase === "verification" || etat.phase === "installation" || etat.phase === "demarrage";
}''',
    '''function phaseInstallationActive(): boolean {
\treturn etat.phase === "elevation" || etat.phase === "telechargement" ||
\t\tetat.phase === "verification" || etat.phase === "installation";
}''',
)
patch(
    "apps/windows/installer/renderer-reference.ts",
    '''\tfermer.disabled = phaseVerrouilleFermeture();
\tfermer.addEventListener("click", () => window.neoInstaller.fermer());''',
    '''\tfermer.addEventListener("click", () => {
\t\tif (phaseInstallationActive()) ouvrirConfirmationAnnulation();
\t\telse window.neoInstaller.fermer();
\t});''',
)
old_progress = '''function rendreEtapeProgression(parent: HTMLElement): void {
\tconst etape = ajouter(parent, "section", "nqi-progress-stage");
\tajouter(etape, "h1", "nqi-progress-title", t("installer.title"));

\tlet pourcent = 0;
\tlet statut = t("installer.status.verifying");
\tlet detail: string | null = null;
\tif (etat.phase === "telechargement") {
\t\tpourcent = etat.total > 0 ? (etat.recus / etat.total) * 100 : 0;
\t\tstatut = t("installer.status.downloading", { percent: formatPourcent(pourcent) });
\t\tdetail = detailTelechargement(etat.recus, etat.total);
\t} else if (etat.phase === "verification") {
\t\tpourcent = 100;
\t\tstatut = t("installer.status.verifying");
\t} else if (etat.phase === "installation") {
\t\tpourcent = etat.pourcent;
\t\tstatut = t("installer.status.installingProgress", { percent: formatPourcent(pourcent) });
\t}

\tconst bloc = ajouter(etape, "div", "nqi-progress-block");
\trendreProgression(bloc, pourcent, "nqi-progress-wide");
\tajouter(bloc, "p", "nqi-progress-status", statut);
\tif (detail) ajouter(bloc, "p", "nqi-progress-detail", detail);

\trendreCommentaires(etape, "nqi-progress-feedback");
\trendreLegal(etape, "nqi-progress-legal");

\tconst actions = ajouter(etape, "div", "nqi-progress-actions");
\tconst annuler = ajouter(actions, "button", "nqi-progress-cancel", t("installer.cancel"));
\tannuler.type = "button";
\tannuler.disabled = etat.phase !== "telechargement";
\tif (!annuler.disabled) annuler.addEventListener("click", () => { void window.neoInstaller.annuler(); });
\tconst installer = ajouter(actions, "button", "nqi-progress-install", t("installer.install"));
\tinstaller.type = "button";
\tinstaller.disabled = true;
}
'''
new_progress = '''function ouvrirConfirmationAnnulation(): void {
\tif (!phaseInstallationActive() || annulationDemandee) return;
\tconfirmationAnnulation = true;
\trendre();
}

function confirmerAnnulation(): void {
\tif (!phaseInstallationActive() || annulationDemandee) return;
\tconfirmationAnnulation = false;
\tannulationDemandee = true;
\trendre();
\tvoid window.neoInstaller.annuler().catch(() => {
\t\tannulationDemandee = false;
\t\tetat = { phase: "erreur", code: "generic" };
\t\trendre();
\t});
}

function rendreConfirmationAnnulation(parent: HTMLElement): void {
\tconst voile = ajouter(parent, "div", "nqi-cancel-overlay");
\tconst dialogue = ajouter(voile, "section", "nqi-cancel-dialog");
\tdialogue.setAttribute("role", "alertdialog");
\tdialogue.setAttribute("aria-modal", "true");
\tconst titre = ajouter(dialogue, "h2", "nqi-cancel-title", t("installer.cancelDialog.title"));
\ttitre.id = "nqi-cancel-title";
\tdialogue.setAttribute("aria-labelledby", titre.id);
\tconst message = ajouter(dialogue, "p", "nqi-cancel-copy", t("installer.cancelDialog.body"));
\tmessage.id = "nqi-cancel-copy";
\tdialogue.setAttribute("aria-describedby", message.id);
\tconst actions = ajouter(dialogue, "div", "nqi-cancel-actions");
\tconst non = ajouter(actions, "button", "nqi-cancel-no", t("installer.cancelDialog.no"));
\tnon.type = "button";
\tnon.autofocus = true;
\tnon.addEventListener("click", () => {
\t\tconfirmationAnnulation = false;
\t\trendre();
\t});
\tconst oui = ajouter(actions, "button", "nqi-cancel-yes", t("installer.cancelDialog.yes"));
\toui.type = "button";
\toui.addEventListener("click", confirmerAnnulation);
}

function rendreEtapeProgression(parent: HTMLElement): void {
\tconst etape = ajouter(parent, "section", "nqi-progress-stage");
\tajouter(etape, "h1", "nqi-progress-title", t("installer.title"));

\tlet pourcent: number | null = null;
\tlet statut = t("installer.status.downloadingPending");
\tlet detail: string | null = null;
\tif (annulationDemandee) {
\t\tstatut = t("installer.status.cancelling");
\t} else if (etat.phase === "telechargement") {
\t\tpourcent = etat.total > 0 ? (etat.recus / etat.total) * 100 : 0;
\t\tstatut = t("installer.status.downloading", { percent: formatPourcent(pourcent) });
\t\tdetail = detailTelechargement(etat.recus, etat.total);
\t} else if (etat.phase === "verification") {
\t\tpourcent = 100;
\t\tstatut = t("installer.status.verifying");
\t} else if (etat.phase === "installation") {
\t\tpourcent = etat.pourcent;
\t\tstatut = t("installer.status.installingProgress", { percent: formatPourcent(pourcent) });
\t}

\tconst bloc = ajouter(etape, "div", "nqi-progress-block");
\trendreProgression(bloc, pourcent, "nqi-progress-wide");
\tajouter(bloc, "p", "nqi-progress-status", statut);
\tif (detail && !annulationDemandee) ajouter(bloc, "p", "nqi-progress-detail", detail);

\trendreCommentaires(etape, "nqi-progress-feedback");
\trendreLegal(etape, "nqi-progress-legal");

\tconst actions = ajouter(etape, "div", "nqi-progress-actions");
\tconst annuler = ajouter(actions, "button", "nqi-progress-cancel", t("installer.cancel"));
\tannuler.type = "button";
\tannuler.disabled = annulationDemandee;
\tif (!annuler.disabled) annuler.addEventListener("click", ouvrirConfirmationAnnulation);
\tconst installer = ajouter(actions, "button", "nqi-progress-install", t("installer.install"));
\tinstaller.type = "button";
\tinstaller.disabled = true;
}
'''
patch("apps/windows/installer/renderer-reference.ts", old_progress, new_progress)
patch(
    "apps/windows/installer/renderer-reference.ts",
    '''\tif (etat.phase === "telechargement" || etat.phase === "verification" || etat.phase === "installation") {
\t\trendreEtapeProgression(contenu);
\t\treturn;
\t}''',
    '''\tif (etat.phase === "elevation" || etat.phase === "telechargement" || etat.phase === "verification" || etat.phase === "installation") {
\t\trendreEtapeProgression(contenu);
\t\tif (confirmationAnnulation) rendreConfirmationAnnulation(root);
\t\treturn;
\t}''',
)
patch(
    "apps/windows/installer/renderer-reference.ts",
    '''function lancerInstallation(): void {
\tif (!infos) return;
\tetat = { phase: "elevation" };''',
    '''function lancerInstallation(): void {
\tif (!infos) return;
\tconfirmationAnnulation = false;
\tannulationDemandee = false;
\tetat = { phase: "elevation" };''',
)
patch(
    "apps/windows/installer/renderer-reference.ts",
    '''\tdebitTelechargement = null;
\trendre();''',
    '''\tdebitTelechargement = null;
\tconfirmationAnnulation = false;
\tannulationDemandee = false;
\trendre();''',
)
patch(
    "apps/windows/installer/renderer-reference.ts",
    '''window.neoInstaller.surEtat(nouvelEtat => {
\tmesurerDebit(nouvelEtat);
\tetat = nouvelEtat.phase === "annule" ? { phase: "pret" } : nouvelEtat;
\trendre();
});''',
    '''window.neoInstaller.surEtat(nouvelEtat => {
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
});''',
)

# Styles du dialogue d'annulation, proche de la référence mais dans l'identité bleue Neo Quiz.
append_once(
    "apps/windows/installer/style-details.css",
    ".nqi-cancel-overlay {",
    r'''
.nqi-cancel-overlay {
	position: absolute;
	inset: 0;
	z-index: 40;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, .42);
}

.nqi-cancel-dialog {
	width: 520px;
	padding: 32px 32px 30px;
	border-radius: 12px;
	background: #1c2230;
	box-shadow: 0 24px 70px rgba(0, 0, 0, .46);
}

.nqi-cancel-title {
	margin: 0;
	font-size: 24px;
	line-height: 1.2;
	font-weight: 500;
	letter-spacing: -.3px;
	color: #f7f9ff;
}

.nqi-cancel-copy {
	margin: 10px 0 0;
	font-size: 14px;
	line-height: 1.45;
	color: rgba(235, 240, 250, .88);
}

.nqi-cancel-actions {
	margin-top: 54px;
	display: flex;
	justify-content: flex-end;
	gap: 10px;
}

.nqi-cancel-no,
.nqi-cancel-yes {
	min-width: 108px;
	height: 44px;
	padding: 0 22px;
	border-radius: 999px;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
}

.nqi-cancel-no {
	border: 1px solid rgba(169, 188, 224, .42);
	background: transparent;
	color: #8eb5ff;
}

.nqi-cancel-yes {
	border: 0;
	background: #5b9dff;
	color: #061224;
}

.nqi-cancel-no:hover,
.nqi-cancel-no:focus-visible,
.nqi-cancel-yes:hover,
.nqi-cancel-yes:focus-visible {
	filter: brightness(1.08);
	outline: none;
}
''',
)

# i18n.
for path, after, addition in [
    (
        "src/i18n/en/installer.ts",
        '\t"installer.status.elevation": "Waiting for Windows authorization…",',
        '\t"installer.status.downloadingPending": "Downloading…",\n\t"installer.status.cancelling": "Cancelling…",',
    ),
    (
        "src/i18n/fr/installer.ts",
        '\t"installer.status.elevation": "En attente de l\'autorisation Windows…",',
        '\t"installer.status.downloadingPending": "Téléchargement…",\n\t"installer.status.cancelling": "Annulation…",',
    ),
]:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if "installer.status.downloadingPending" not in text:
        if text.count(after) != 1:
            raise SystemExit(f"{path}: ancre statut introuvable")
        text = text.replace(after, after + "\n" + addition, 1)
        p.write_text(text, encoding="utf-8")

for path, anchor, block in [
    (
        "src/i18n/en/installer.ts",
        '\t"installer.elevationDialog.body": "Neo Quiz requires administrator privileges to install. Click Cancel, then restart the installer.",',
        '''\t"installer.cancelDialog.title": "Stop installation?",
\t"installer.cancelDialog.body": "Neo Quiz will not be installed on this PC.",
\t"installer.cancelDialog.no": "No",
\t"installer.cancelDialog.yes": "Yes",''',
    ),
    (
        "src/i18n/fr/installer.ts",
        '\t"installer.elevationDialog.body": "Neo Quiz nécessite les droits administrateur pour être installé. Cliquez sur Annuler, puis relancez le programme d’installation.",',
        '''\t"installer.cancelDialog.title": "Arrêter l'installation ?",
\t"installer.cancelDialog.body": "Neo Quiz ne sera pas installé sur ce PC.",
\t"installer.cancelDialog.no": "Non",
\t"installer.cancelDialog.yes": "Oui",''',
    ),
]:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if "installer.cancelDialog.title" not in text:
        if text.count(anchor) != 1:
            raise SystemExit(f"{path}: ancre dialogue introuvable")
        text = text.replace(anchor, anchor + "\n" + block, 1)
        p.write_text(text, encoding="utf-8")

# Contrôles : publication atomique + expérience d'installation.
p = ROOT / "scripts/check-installer.mjs"
text = p.read_text(encoding="utf-8")
if 'const renduInstallateur = readFileSync' not in text:
    anchor = 'const siteFr = readFileSync(resolve(racine, "docs/fr/index.html"), "utf8");'
    block = '''const renduInstallateur = readFileSync(resolve(racine, "apps/windows/installer/renderer-reference.ts"), "utf8");
const principalInstallateur = readFileSync(resolve(racine, "apps/windows/installer/main.ts"), "utf8");
const travailleurInstallateur = readFileSync(resolve(racine, "apps/windows/installer/worker.ts"), "utf8");'''
    if text.count(anchor) != 1:
        raise SystemExit("check-installer: ancre sources introuvable")
    text = text.replace(anchor, anchor + "\n" + block, 1)

if 'publication : desktop devient latest seulement après les assets complets' not in text:
    anchor = '''\tr.check("publication : le nom français est une copie du même exe",
\t\tworkflow.includes("cp Install-NeoQuiz.exe Install-NeoQuiz-fr.exe"), true);
'''
    block = '''
\tconst debutPromotion = workflow.indexOf("- name: Verify app release assets and promote latest");
\tconst debutLatestJson = workflow.indexOf("- name: Write latest.json from the release");
\tconst blocPromotion = debutPromotion >= 0 && debutLatestJson > debutPromotion
\t\t? workflow.slice(debutPromotion, debutLatestJson)
\t\t: "";
\tr.check("publication : desktop devient latest seulement après les assets complets",
\t\t[
\t\t\tworkflow.includes('make_latest: ${{ steps.version.outputs.product == \'app\' }}'),
\t\t\tworkflow.includes('make_latest: "true"'),
\t\t\tblocPromotion.includes('"Install-NeoQuiz.exe"'),
\t\t\tblocPromotion.includes('"Install-NeoQuiz-fr.exe"'),
\t\t\tblocPromotion.includes('"neo-quiz-setup-${VERSION}.exe"'),
\t\t\tblocPromotion.includes("sha256:"),
\t\t\tblocPromotion.includes("-f make_latest=true"),
\t\t],
\t\t[false, false, true, true, true, true, true]);

\tr.check("expérience : chargement immédiat, étape 3 directe et annulation partout",
\t\t[
\t\t\tprincipalInstallateur.includes('webContents.once("dom-ready"'),
\t\t\trenduInstallateur.includes('etat.phase === "elevation" || etat.phase === "telechargement"'),
\t\t\trenduInstallateur.includes('installer.cancelDialog.title'),
\t\t\trenduInstallateur.includes('annuler.disabled = annulationDemandee'),
\t\t\tprincipalInstallateur.includes('if (socketTravailleur) {'),
\t\t\ttravailleurInstallateur.includes('if (commande.type === "annuler") annulation.abort();'),
\t\t],
\t\t[true, true, true, true, true, true]);
'''
    if text.count(anchor) != 1:
        raise SystemExit("check-installer: ancre publication introuvable")
    text = text.replace(anchor, anchor + block, 1)

p.write_text(text, encoding="utf-8")

print("Préparation installer 1.0.5 appliquée.")
