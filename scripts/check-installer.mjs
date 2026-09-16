import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/**
 * BOOTSTRAPPER D'INSTALLATION — les invariants qui évitent de télécharger ou
 * lancer le mauvais exécutable.
 *
 * Ce script charge `apps/windows/installer/noyau.ts` par le même harnais que
 * les autres contrôles : aucune réplique de la sélection de release ni des
 * arguments NSIS ne vit ici. Il lit aussi les VRAIS fichiers de publication :
 * le bootstrapper n'est utile que si la release et le site le distribuent.
 *
 *     npm run check:installer
 */
const racine = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflow = readFileSync(resolve(racine, ".github/workflows/release.yml"), "utf8");
const ci = readFileSync(resolve(racine, ".github/workflows/ci.yml"), "utf8");
const autoRelease = readFileSync(resolve(racine, ".github/workflows/auto-release-desktop.yml"), "utf8");
const siteEn = readFileSync(resolve(racine, "docs/index.html"), "utf8");
const siteFr = readFileSync(resolve(racine, "docs/fr/index.html"), "utf8");
const renduInstallateur = readFileSync(resolve(racine, "apps/windows/installer/renderer-reference.ts"), "utf8");
const principalInstallateur = readFileSync(resolve(racine, "apps/windows/installer/main.ts"), "utf8");
const principalUi = readFileSync(resolve(racine, "apps/windows/installer/main-ui.ts"), "utf8");
const preloadInstallateur = readFileSync(resolve(racine, "apps/windows/installer/preload.ts"), "utf8");
const travailleurInstallateur = readFileSync(resolve(racine, "apps/windows/installer/worker.ts"), "utf8");
const configBootstrapper = readFileSync(resolve(racine, "apps/windows/installer/electron-builder.config.mjs"), "utf8");
const protocoleInstallateur = readFileSync(resolve(racine, "apps/windows/installer/protocole.ts"), "utf8");
const styleInstallateur = readFileSync(resolve(racine, "apps/windows/installer/style-details.css"), "utf8");
const principalApplication = readFileSync(resolve(racine, "apps/windows/electron/main.ts"), "utf8");
const pontApplication = readFileSync(resolve(racine, "apps/windows/electron/pont.ts"), "utf8");
const preloadApplication = readFileSync(resolve(racine, "apps/windows/electron/preload.ts"), "utf8");
const canauxApplication = readFileSync(resolve(racine, "apps/windows/electron/canaux.ts"), "utf8");
const renduApplication = readFileSync(resolve(racine, "apps/windows/src/main.ts"), "utf8");

const noyauInstallateur = readFileSync(resolve(racine, "apps/windows/installer/noyau.ts"), "utf8");

await withSrcModule("apps/windows/installer/noyau.ts", ({ resoudrePaquet, paquetInstallable, progressionInstallation, argumentsNsis, langueDepuisLocale, urlLegale, URL_LATEST_YML }) => {
	const r = makeReporter("Installateur — bootstrapper");
	/* Un PNG peut avoir un en-tête valide tout en affichant des pixels abîmés.
	   Décompresser les IDAT vérifie aussi leur somme de contrôle zlib. */
	let erreurBouclier = null;
	try {
		const png = readFileSync(resolve(racine, "apps/windows/installer/uac-shield.png"));
		if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("signature PNG invalide");
		const blocs = [];
		for (let position = 8; position < png.length;) {
			if (position + 12 > png.length) throw new Error("bloc PNG tronqué");
			const taille = png.readUInt32BE(position);
			const fin = position + 12 + taille;
			if (fin > png.length) throw new Error("données PNG tronquées");
			if (png.toString("ascii", position + 4, position + 8) === "IDAT") {
				blocs.push(png.subarray(position + 8, fin - 4));
			}
			position = fin;
		}
		if (!inflateSync(Buffer.concat(blocs)).length) throw new Error("pixels PNG absents");
	} catch (erreur) {
		erreurBouclier = erreur.message;
	}
	r.check("bouclier : les pixels du PNG se décompressent sans corruption", erreurBouclier, null);
	/* La SOURCE de la release. L'API REST de GitHub, sans jeton, refuse au-delà
	   de 60 appels par heure et par adresse IP : le bootstrapper 1.0.16 la
	   lisait et s'ouvrait sur « n'a pas pu être préparée » chez quiconque
	   partageait son IP avec 60 lancements dans l'heure — Ahmed le premier, le
	   soir des douze releases. La redirection `releases/latest/download/` de
	   github.com n'a pas ce plafond, et `latest.yml` est le fichier
	   qu'electron-updater lit déjà. Casser l'un des trois fichiers → rouge. */
	r.check("source : le bootstrapper lit latest.yml par la redirection releases/latest",
		URL_LATEST_YML, "https://github.com/ahmed-mili/neo-quiz/releases/latest/download/latest.yml");
	// Un LITTÉRAL d'URL, pas le mot dans un commentaire qui explique l'interdit.
	r.check("source : aucun fichier du bootstrapper n'interroge api.github.com (60 req/h/IP)",
		[noyauInstallateur, principalInstallateur, travailleurInstallateur].map(f => /["'`]https:\/\/api\.github\.com/.test(f)),
		[false, false, false]);
	r.check("source : le principal charge bien URL_LATEST_YML",
		principalInstallateur.includes("await fetch(URL_LATEST_YML"), true);

	/* Le `latest.yml` d'electron-builder, tel que publié pour desktop-v1.0.16
	   (le vrai fichier, empreinte comprise) : le sous-ensemble YAML que le
	   noyau doit lire, ni plus ni moins. */
	const version = "1.0.16";
	const nom = `neo-quiz-setup-${version}.exe`;
	const sha512 = "VvB5vz58mqpsBD0AlFZhc5AqaJPxeEAHfdBDj4iu8j/sf41vbGKdVLeC6dr16Q9I1CuNc4tuOJzNcebd67ggvw==";
	const taille = 113062631;
	const latestYml = [
		`version: ${version}`,
		"files:",
		`  - url: ${nom}`,
		`    sha512: ${sha512}`,
		`    size: ${taille}`,
		`path: ${nom}`,
		`sha512: ${sha512}`,
		"releaseDate: '2026-09-15T19:41:31.633Z'",
		"",
	].join("\n");
	const attendu = {
		version,
		nom,
		url: `https://github.com/ahmed-mili/neo-quiz/releases/download/desktop-v${version}/${nom}`,
		taille,
		sha512,
		tailleInstallee: null,
	};

	r.check("release : latest.yml donne le NSIS versionné, sa taille et son sha512",
		resoudrePaquet(latestYml), attendu);
	r.check("release : les fins de ligne Windows ne changent rien",
		resoudrePaquet(latestYml.replace(/\n/g, "\r\n")), attendu);
	r.check("release : le nom fixe `neo-quiz-setup.exe` n'est jamais installable",
		resoudrePaquet(latestYml.replace(new RegExp(nom, "g"), "neo-quiz-setup.exe")), null);
	r.check("release : sans empreinte sha512, rien n'est installable",
		resoudrePaquet(latestYml.replace(/^sha512: .*$/m, "")), null);
	r.check("release : une empreinte racine différente de l'entrée files est refusée",
		resoudrePaquet(latestYml.replace(/^sha512: .*$/m, `sha512: ${"A".repeat(86)}==`)), null);
	r.check("release : sans taille, rien n'est installable (progression et intégrité en dépendent)",
		resoudrePaquet(latestYml.replace(/^ {4}size: .*$/m, "")), null);
	r.check("release : une pré-version n'est jamais installée par le bootstrapper",
		resoudrePaquet(latestYml.replace(new RegExp(version, "g"), `${version}-beta.1`)), null);
	r.check("release : un texte sans rapport (page d'erreur HTML) ne vaut rien",
		resoudrePaquet("<!DOCTYPE html><html><body>Not Found</body></html>"), null);
	/* Le travailleur élevé reconstruit le paquet depuis les champs reçus : une
	   URL qui n'est pas celle que la version implique ne doit jamais passer. */
	r.check("travailleur : l'URL est déduite de la version, jamais lue",
		paquetInstallable({ version, nom, taille, sha512 })?.url, attendu.url);
	r.check("travailleur : un nom qui ne suit pas la version est refusé",
		paquetInstallable({ version, nom: "neo-quiz-setup-9.9.9.exe", taille, sha512 }), null);
	r.check("travailleur : une taille non entière ou nulle est refusée",
		[paquetInstallable({ version, nom, taille: 0, sha512 }), paquetInstallable({ version, nom, taille: 1.5, sha512 })],
		[null, null]);

	/* Le pourcentage d'installation compte les octets écrits contre
	   `installedSize`, publié par la CI sous une clé racine facultative de
	   `latest.yml`. Absente, non entière, nulle, négative, ou plus petite que
	   le setup lui-même → `tailleInstallee: null`, jamais une valeur devinée. */
	const tailleInstallee = 400_000_000;
	const latestYmlAvecTailleInstallee = `${latestYml}installedSize: ${tailleInstallee}\n`;
	r.check("installedSize : lue et validée quand elle est publiée",
		resoudrePaquet(latestYmlAvecTailleInstallee)?.tailleInstallee, tailleInstallee);
	r.check("installedSize : absente sur les releases qui ne la publient pas encore (1.0.0, 1.0.1)",
		resoudrePaquet(latestYml)?.tailleInstallee, null);
	r.check("installedSize : non entière, nulle, négative ou plus petite que le setup → null",
		[
			paquetInstallable({ version, nom, taille, sha512, tailleInstallee: 12.5 })?.tailleInstallee,
			paquetInstallable({ version, nom, taille, sha512, tailleInstallee: 0 })?.tailleInstallee,
			paquetInstallable({ version, nom, taille, sha512, tailleInstallee: -1 })?.tailleInstallee,
			paquetInstallable({ version, nom, taille, sha512, tailleInstallee: taille })?.tailleInstallee,
			paquetInstallable({ version, nom, taille, sha512, tailleInstallee: taille - 1 })?.tailleInstallee,
		],
		[null, null, null, null, null]);
	r.check("installedSize : un logiciel installé plus gros que son setup est accepté",
		paquetInstallable({ version, nom, taille, sha512, tailleInstallee: taille + 1 })?.tailleInstallee,
		taille + 1);

	/* `progressionInstallation` (noyau pur) : le calcul qui remplace la
	   minuterie exponentielle. Chaque cas est DISCRIMINANT — casser la règle
	   qu'il éprouve doit le faire rougir. */
	const total = 1_000_000_000;
	r.check("progression : sans total publié, toujours indéterminée",
		progressionInstallation({ courant: 999_999_999, minimum: 0, total: null, dernier: 50 }), null);
	r.check("progression : avant que la croissance dépasse le seuil, indéterminée",
		progressionInstallation({ courant: 1_000_000, minimum: 0, total, dernier: null }), null);
	r.check("progression : une fois le seuil dépassé, le ratio depuis le minimum",
		progressionInstallation({ courant: 100_000_000, minimum: 0, total, dernier: null }), 10);
	r.check("progression : plafonnée à 99, jamais republiée à 100 avant le code de sortie 0",
		progressionInstallation({ courant: 999_999_999, minimum: 0, total, dernier: 90 }), 99);
	r.check("progression : une mise à jour qui rétrécit d'abord ne publie rien tant que la croissance n'a pas repris",
		[
			progressionInstallation({ courant: 500_000_000, minimum: 500_000_000, total, dernier: null }),
			progressionInstallation({ courant: 495_000_000, minimum: 495_000_000, total, dernier: null }),
			progressionInstallation({ courant: 500_000_000, minimum: 495_000_000, total, dernier: null }),
		],
		[null, null, null]);
	r.check("progression : la croissance qui reprend franchement après un minimum sort de l'indéterminé",
		progressionInstallation({ courant: 495_000_000 + 9 * 1024 * 1024, minimum: 495_000_000, total, dernier: null }) !== null,
		true);
	r.check("progression : jamais de valeur republiée en dessous de la précédente",
		progressionInstallation({ courant: 100_000_000, minimum: 0, total, dernier: 42 }), 42);

	const dossier = "C:\\Program Files\\Neo Quiz";
	const args = argumentsNsis(dossier);
	r.check("NSIS : le mode machine est explicite", args[0], "/allusers");
	r.check("NSIS : le mode silencieux est explicite", args.includes("/S"), true);
	r.check("NSIS : /D reste le dernier argument", args.at(-1), `/D=${dossier}`);

	/* Le site ne doit jamais retomber sur le NSIS visible. Le lien statique
	   mène à la release tant qu'aucun bootstrapper n'est publié ; dès que
	   `latest.json` porte un `NeoQuiz-X.Y.Z.exe`, le JS le remplace par
	   l'asset exact. Ce repli évite un 404 pendant la transition. */
	r.check("publication : release construit le bootstrapper",
		workflow.includes("npm run pack:installer"), true);
	r.check("publication : release attache le bootstrapper par son motif versionné",
		workflow.includes("apps/windows/dist-installer-bootstrapper/NeoQuiz-*.exe"), true);
	r.check("publication : l'alias NSIS public a disparu",
		workflow.includes("neo-quiz-setup.exe\n"), false);

	/* UN SEUL fichier public, nommé par `artifactName` comme `Obsidian-1.13.7.exe`.
	   La copie `-fr.exe` et l'ancien nom fixe ont disparu avec la langue « dans
	   le fichier » : la langue de l'installeur est celle de Windows. */
	r.check("publication : le nom public est versionné, via artifactName",
		configBootstrapper.includes('artifactName: "NeoQuiz-${version}.exe"'), true);
	r.check("publication : plus de copie française ni d'ancien nom fixe",
		[workflow.includes("-fr.exe"), workflow.includes("Install-NeoQuiz"), ci.includes("Install-NeoQuiz"),
			siteEn.includes("Install-NeoQuiz"), siteFr.includes("Install-NeoQuiz")],
		[false, false, false, false, false]);
	r.check("publication : la CI archive le bootstrapper par son motif",
		ci.includes("apps/windows/dist-installer-bootstrapper/NeoQuiz-*.exe"), true);

	const debutPromotion = workflow.indexOf("- name: Verify app release assets and promote latest");
	const debutLatestJson = workflow.indexOf("- name: Write latest.json from the release");
	const blocPromotion = debutPromotion >= 0 && debutLatestJson > debutPromotion
		? workflow.slice(debutPromotion, debutLatestJson)
		: "";
	/* `latest.yml` figure parmi les assets exigés AVANT la promotion : c'est
	   désormais le fichier que le bootstrapper lit par `releases/latest`, en
	   plus d'electron-updater. Promue sans lui, la release afficherait « n'a
	   pas pu être préparée » à tous les nouveaux venus. */
	r.check("publication : desktop devient latest seulement après les assets complets",
		[
			workflow.includes("make_latest: ${{ steps.version.outputs.product == 'app' }}"),
			workflow.includes('make_latest: "true"'),
			blocPromotion.includes('"NeoQuiz-${VERSION}.exe"'),
			blocPromotion.includes('"neo-quiz-setup-${VERSION}.exe"'),
			blocPromotion.includes('"latest.yml"'),
			blocPromotion.includes("-f make_latest=true"),
		],
		[false, false, true, true, true, true]);

	/* Deux portes vers release.yml (un bump poussé depuis chatgpt.com, et le
	   tag que `git ship` pousse d'un seul `--atomic` avec le commit) : la
	   seconde ne doit pas relancer un build que la première a déjà lancé. */
	r.check("publication : auto-release s'abstient dès que le tag existe sur origin",
		autoRelease.includes('git ls-remote --tags origin "refs/tags/$TAG"'), true);

	r.check("expérience : chargement immédiat, étape 3 directe et annulation partout",
		[
			principalInstallateur.includes('webContents.once("dom-ready"'),
			renduInstallateur.includes('etat.phase === "elevation" || etat.phase === "telechargement"'),
			renduInstallateur.includes('installer.cancelDialog.title'),
			renduInstallateur.includes('annuler.disabled = annulationDemandee'),
			principalInstallateur.includes('if (socketTravailleur) {'),
			travailleurInstallateur.includes('if (commande.type === "annuler") annulation.abort();'),
		],
		[true, true, true, true, true, true]);

	const debutProgression = renduInstallateur.indexOf("function rendreEtapeProgression");
	const debutDemarrage = renduInstallateur.indexOf("function rendreDemarrage", debutProgression);
	const blocProgression = debutProgression >= 0 && debutDemarrage > debutProgression
		? renduInstallateur.slice(debutProgression, debutDemarrage)
		: "";
	r.check("expérience : mentions légales absentes à partir de l'étape 3",
		[blocProgression.includes("rendreLegal("), renduInstallateur.includes("rendreLegal(panneau);")],
		[false, true]);

	r.check("fin installation : spinner dans l'installeur jusqu'à ce que l'app soit prête",
		[
			principalInstallateur.includes('envoyerEtat({ phase: "demarrage" });'),
			protocoleInstallateur.includes('phase: "demarrage"'),
			renduInstallateur.includes('if (etat.phase === "demarrage")'),
			renduInstallateur.includes('rendreDemarrage(contenu);'),
			renduInstallateur.includes('installer.status.launching'),
			styleInstallateur.includes(".nqi-launching-stage"),
			renduInstallateur.includes('fermer.disabled = etat.phase === "demarrage";'),
			principalInstallateur.includes("let fenetreDemarrage: BrowserWindow | null = null;"),
			principalInstallateur.includes('mode: "launch"'),
			renduInstallateur.includes('modeAffichage === "launch"'),
		],
		[true, true, true, true, true, true, true, false, false, false]);

	r.check("fin installation : la vraie app devient visible seulement quand elle est prête",
		[
			principalApplication.includes('fenetre.once("ready-to-show", () => fenetre?.show())'),
			pontApplication.includes("prete(): Promise<void>;"),
			pontApplication.includes('fenetrePrete: "neo:fenetre/prete"'),
			preloadApplication.includes("prete: () => ipcRenderer.invoke(CANAUX.fenetrePrete)"),
			canauxApplication.includes("ipcMain.handle(CANAUX.fenetrePrete, () => deps.fenetre.prete());"),
			principalApplication.includes("if (!fenetre || fenetre.isDestroyed() || fenetre.isVisible()) return;"),
			renduApplication.includes("void demarrer().finally(() =>"),
			renduApplication.includes("pont().fenetre.prete()"),
			principalInstallateur.includes("attendreFenetreApplication(pid)"),
		],
		[false, true, true, true, true, true, true, true, true]);

	r.check("démarrage : le bootstrapper évite les deux extractions coûteuses",
		[
			configBootstrapper.includes('compression: "store"'),
			principalInstallateur.includes('const executable = process.execPath;'),
			// Le code, pas le commentaire qui explique pourquoi on ne le relit plus.
			principalInstallateur.includes("process.env.PORTABLE_EXECUTABLE_FILE"),
		],
		[true, true, false]);

	/* La langue de l'installeur est celle de WINDOWS (`app.getLocale()`), la
	   même déduction que l'application en mode « auto ». Plus de langue « dans
	   le fichier » (nom `-fr.exe`, flux `Zone.Identifier`), plus d'écriture de
	   `language` dans les réglages de l'app : moins fiable que le système, et
	   deux assets pour un seul exe. */
	r.check("langue : la locale française, sous ses trois formes, vaut « fr »",
		["fr", "fr-FR", "fr_CA"].map(langueDepuisLocale), ["fr", "fr", "fr"]);
	r.check("langue : toute autre locale vaut « en » (l'interface n'a que deux langues)",
		["en-US", "de-DE", "", "frites"].map(langueDepuisLocale), ["en", "en", "en", "en"]);
	r.check("langue : le principal lit Windows et n'écrit plus les réglages de l'application",
		[
			principalInstallateur.includes("langue = langueDepuisLocale(app.getLocale());"),
			principalInstallateur.includes("Zone.Identifier"),
			principalInstallateur.includes("settings.json"),
			noyauInstallateur.includes("langueDepuisNom"),
		],
		[true, false, false, false]);

	/* Les deux liens du texte légal étaient des <span> sans cible jusqu'à la
	   1.0.16. Ils ouvrent maintenant les pages du site, dans la langue de
	   l'installeur, par un canal qui ne reçoit qu'un NOM de page : l'URL est
	   composée par le noyau, et les quatre fichiers doivent exister. */
	r.check("légal : l'URL est composée depuis deux constantes, dans la langue voulue",
		[urlLegale("terms", "en"), urlLegale("privacy", "en"), urlLegale("terms", "fr"), urlLegale("privacy", "fr")],
		[
			"https://ahmed-mili.github.io/neo-quiz/terms.html",
			"https://ahmed-mili.github.io/neo-quiz/privacy.html",
			"https://ahmed-mili.github.io/neo-quiz/fr/terms.html",
			"https://ahmed-mili.github.io/neo-quiz/fr/privacy.html",
		]);
	r.check("légal : les quatre pages existent dans docs/",
		["docs/terms.html", "docs/privacy.html", "docs/fr/terms.html", "docs/fr/privacy.html"]
			.map(f => existsSync(resolve(racine, f))),
		[true, true, true, true]);
	/* Le bouton de langue porte la langue COURANTE de la page (« Français »
	   sur une page française), comme la page de téléchargement, jamais la
	   langue cible : Ahmed l'a repris le 2026-09-15 sur ces pages mêmes. */
	r.check("légal : le bouton de langue affiche la langue de la page, pas la cible",
		[["docs/terms.html", "English"], ["docs/privacy.html", "English"],
			["docs/fr/terms.html", "Français"], ["docs/fr/privacy.html", "Français"]]
			.map(([f, langue]) => {
				const m = /<a class="langue-bouton"[^>]*>\s*([^<\s][^<]*?)\s*</.exec(readFileSync(resolve(racine, f), "utf8"));
				return m ? m[1] : null;
			}),
		["English", "English", "Français", "Français"]);
	r.check("légal : les liens de l'installeur sont cliquables et passent par le canal nommé",
		[
			renduInstallateur.includes('lienLegal(ligne, "terms", t("installer.legal.terms"));'),
			renduInstallateur.includes('lienLegal(ligne, "privacy", t("installer.legal.privacy"));'),
			renduInstallateur.includes("window.neoInstaller.ouvrirLien(page);"),
			preloadInstallateur.includes("ipcRenderer.send(CANAUX_INSTALLATEUR.ouvrirLien, page)"),
			principalUi.includes('if (page !== "terms" && page !== "privacy") return;'),
			principalUi.includes("shell.openExternal(urlLegale(page, langueInstallateur()))"),
			renduInstallateur.includes('"span", "nqi-legal-link"'),
		],
		[true, true, true, true, true, true, false]);

	for (const [langue, site] of [["EN", siteEn], ["FR", siteFr]]) {
		r.check(`site ${langue} : Windows ne pointe plus sur l'ancien NSIS`,
			site.includes("releases/latest/download/neo-quiz-setup.exe"), false);
		// Un seul installeur, retrouvé par MOTIF : la page ne porte aucune version.
		r.check(`site ${langue} : Windows cible le bootstrapper versionné par son motif`,
			[
				site.includes("var MOTIF_INSTALLEUR_WINDOWS = /^NeoQuiz-\\d+\\.\\d+\\.\\d+\\.exe$/i;"),
				site.includes("trouverActif(donnees.assets, MOTIF_INSTALLEUR_WINDOWS)"),
				site.includes('afficherVersion("windows", donnees, MOTIF_INSTALLEUR_WINDOWS, null)'),
			],
			[true, true, true]);
		r.check(`site ${langue} : Windows n'offre pas un faux choix de versions`,
			site.includes('activerSelecteurVersion("windows"'), false);
		r.check(`site ${langue} : le pied de page mène aux deux pages légales`,
			[site.includes('href="terms.html"'), site.includes('href="privacy.html"')], [true, true]);
		r.check(`site ${langue} : un clic sur une langue est mémorisé comme un CHOIX`,
			site.includes('localStorage.setItem("nq-langue", lien.getAttribute("data-langue"))'), true);
	}
	/* Seule la racine (anglais par défaut) devine la langue, depuis celle du
	   NAVIGATEUR (jamais un pays par IP) et seulement sans choix mémorisé ; la
	   page française, elle, ne renvoie personne : un lien `/fr/` partagé s'ouvre. */
	r.check("site : la racine suit la langue du navigateur, sauf choix mémorisé",
		[
			siteEn.includes('var choix = localStorage.getItem("nq-langue");'),
			siteEn.includes("navigator.languages && navigator.languages[0]"),
			siteEn.includes('if (cible === "fr") location.replace("fr/");'),
			siteFr.includes("location.replace("),
		],
		[true, true, true, false]);

	r.done();
});
