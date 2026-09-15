/**
 * L'EMPAQUETAGE — la configuration résolue d'electron-builder, et le paquet
 * s'il existe.
 *
 * Ce que ce script empêche, et qu'une relecture ne voit pas :
 *   - une version qui diverge entre le package de l'application et son
 *     lockfile (deux numéros, l'un jamais suivi) ;
 *   - un `appId` ou un `executableName` changé « par cohérence » : le premier
 *     est la clé de registre par laquelle NSIS retrouve l'installation à
 *     remplacer (le changer fait de chaque mise à jour une seconde
 *     installation), le second est le nom du binaire dans l'AppImage — et un
 *     caractère interdit dedans (`@`) a fait échouer chaque run CI Linux
 *     jusqu'au 2026-09-12 ;
 *   - `deleteAppDataOnUninstall` passé à vrai : la mise à jour désinstalle
 *     l'ancienne version, et perdrait les réglages avec elle ;
 *   - `node_modules` et les sourcemaps dans l'asar (3 659 fichiers de poids
 *     mort au 2026-09-12 : `chokidar` est bundlé par esbuild, `lucide` par Vite).
 *
 *     npm run check:package
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { makeReporter } from "./lib/load-src.mjs";

/* `signtoolOptions.publisherName` n'est pas encore posé : le CN du
   certificat ne se lit que dans le journal CI, sur le premier exe signé par
   `release-signing`. Cette constante changera dans le MÊME commit que
   `electron-builder.config.mjs` quand ce CN sera connu — une valeur qui ne
   correspond pas EXACTEMENT au certificat fait refuser chaque mise à jour. */
const PUBLISHER_ATTENDU = null;

function sha512Base64(chemin) {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha512");
		createReadStream(chemin)
			.on("data", (bloc) => hash.update(bloc))
			.on("error", reject)
			.on("end", () => resolve(hash.digest("base64")));
	});
}

const racine = fileURLToPath(new URL("..", import.meta.url));
const appWindows = `${racine}apps/windows/`;
const uninstallerNsis = readFileSync(`${appWindows}installer/uninstaller.nsh`, "utf8");

const r = makeReporter("Empaquetage — configuration résolue");

const { default: configurer } = await import(pathToFileURL(`${appWindows}electron-builder.config.mjs`).href);
const config = await configurer();
const application = JSON.parse(await readFile(`${appWindows}package.json`, "utf8"));
const lockfile = JSON.parse(await readFile(`${appWindows}package-lock.json`, "utf8"));

r.check("le lockfile suit la version de l'application",
	[lockfile.version, lockfile.packages?.[""]?.version], [application.version, application.version]);
r.check("appId est immuable", config.appId, "com.ahmed.neoquiz");
r.check("executableName est immuable et sûr pour un chemin",
	[config.executableName, /^[a-z0-9.-]+$/.test(config.executableName ?? "")], ["neo-quiz", true]);
r.check("les artefacts ont un nom sans espace",
	[config.win?.artifactName, config.linux?.artifactName],
	["neo-quiz-setup-${version}.${ext}", "neo-quiz-${version}.${ext}"]);
r.check("la fenêtre Linux est associée à son entrée .desktop",
	[config.linux?.desktop?.entry?.Name, config.linux?.desktop?.entry?.StartupWMClass],
	["Neo Quiz", "neo-quiz"]);
r.check("files exclut node_modules et les sourcemaps",
	[config.files.includes("!node_modules/**"), config.files.includes("!dist-electron/**/*.map")],
	[true, true]);
r.check("la désinstallation garde les données", config.nsis?.deleteAppDataOnUninstall, false);
r.check("désinstallation : petite fenêtre directe avec progression et pourcentage",
	[
		config.nsis?.oneClick,
		config.nsis?.perMachine,
		uninstallerNsis.includes("removeDefaultUninstallWelcomePage"),
		uninstallerNsis.includes("MUI_PAGE_CUSTOMFUNCTION_SHOW un.NeoQuizAfficherDesinstallationCompacte"),
		uninstallerNsis.includes("PBM_GETPOS"),
		uninstallerNsis.includes('"STR:$R2%"'),
	],
	[false, true, true, true, true, true]);
r.check("author.name est celui attendu par winget et SignPath", config.extraMetadata?.author?.name, "Ahmed Mili");
r.check("publisherName n'est posé qu'une fois le CN du certificat connu",
	config.win?.signtoolOptions?.publisherName ?? null, PUBLISHER_ATTENDU);
/* LA CLÉ `publish` : c'est elle qui fait générer `latest*.yml` et embarquer
   `app-update.yml` — sans elle, electron-updater n'a aucun flux à lire et
   se tait. Le dépôt est FIXE : un rendu ne choisit jamais d'où vient une
   mise à jour. */
r.check("publish vise les releases GitHub du dépôt",
	[config.publish?.provider, config.publish?.owner, config.publish?.repo],
	["github", "ahmed-mili", "neo-quiz"]);
r.done();

/* LE PAQUET, s'il a été construit (`npm run pack:win` laisse `win-unpacked/`).
   `@electron/asar` est une dépendance transitive d'electron-builder : on la
   résout depuis `apps/windows`, sans l'ajouter aux dépendances. */
const asar = `${appWindows}dist-installer/win-unpacked/resources/app.asar`;
if (existsSync(asar)) {
	const p = makeReporter("Empaquetage — contenu de app.asar");
	const require = createRequire(`${appWindows}package.json`);
	const { listPackage } = require("@electron/asar");
	const chemins = listPackage(asar).map(c => c.replace(/\\/g, "/"));
	p.check("aucun node_modules dans l'asar", chemins.filter(c => c.includes("/node_modules/")).length, 0);
	p.check("aucune sourcemap dans l'asar", chemins.filter(c => c.endsWith(".map")).length, 0);
	p.check("les deux sorties sont là",
		[chemins.includes("/dist-electron/main.cjs"), chemins.includes("/dist-electron/preload.cjs"), chemins.includes("/dist/index.html")],
		[true, true, true]);
	/* Le paquet porte son flux (`app-update.yml`, écrit par electron-builder à
	   côté de l'asar), et le dossier de sortie porte les métadonnées que la
	   release publie. La version de `latest.yml` DOIT être celle du manifeste :
	   c'est elle qu'electron-updater compare à `app.getVersion()`. */
	const updatePath = `${appWindows}dist-installer/win-unpacked/resources/app-update.yml`;
	p.check("app-update.yml est dans le paquet", existsSync(updatePath), true);
	/* `app-update.yml` est ce qu'electron-updater lit au démarrage installé
	   pour savoir où chercher une mise à jour : provider github, dépôt fixe —
	   sans quoi il ne saurait pas qu'il doit lire /releases/latest. */
	const updateBrut = existsSync(updatePath) ? readFileSync(updatePath, "utf8") : "";
	p.check("app-update.yml vise les releases GitHub du dépôt",
		[/^provider:\s*(.+)$/m.exec(updateBrut)?.[1]?.trim(),
			/^owner:\s*(.+)$/m.exec(updateBrut)?.[1]?.trim(),
			/^repo:\s*(.+)$/m.exec(updateBrut)?.[1]?.trim()],
		["github", "ahmed-mili", "neo-quiz"]);
	const latest = `${appWindows}dist-installer/latest.yml`;
	p.check("latest.yml existe à côté de l'installeur", existsSync(latest), true);
	p.check("latest.yml porte la version de l'application",
		existsSync(latest) ? /^version:\s*(.+)$/m.exec(readFileSync(latest, "utf8"))?.[1]?.trim() : null,
		application.version);
	/* Le contrôle qui rougit si l'exe a été remplacé (par ex. par sa version
	   signée) sans repasser par `scripts/update-info-after-signing.mjs` :
	   `latest.yml` et le blockmap décriraient alors un fichier qui n'existe
	   plus, et electron-updater rejetterait la mise à jour chez chaque
	   utilisateur. */
	const latestBrut = existsSync(latest) ? readFileSync(latest, "utf8") : "";
	const nomExe = /^path:\s*(.+)$/m.exec(latestBrut)?.[1]?.trim();
	const cheminExe = nomExe ? `${appWindows}dist-installer/${nomExe}` : null;
	p.check("latest.yml nomme un exe présent dans dist-installer",
		cheminExe ? existsSync(cheminExe) : false, true);
	if (cheminExe && existsSync(cheminExe)) {
		const attenduSha512 = /^\s*sha512:\s*(.+)$/m.exec(latestBrut)?.[1]?.trim();
		const attenduTaille = /^\s*size:\s*(.+)$/m.exec(latestBrut)?.[1]?.trim();
		const obtenuSha512 = await sha512Base64(cheminExe);
		const obtenuTaille = String((await readFile(cheminExe)).length);
		p.check("le sha512 de l'exe correspond à latest.yml", obtenuSha512, attenduSha512);
		p.check("la taille de l'exe correspond à latest.yml", obtenuTaille, attenduTaille);
		p.check("le blockmap de l'exe existe", existsSync(`${cheminExe}.blockmap`), true);
	}
	p.done();
} else {
	console.log("Empaquetage — contenu de app.asar : aucun paquet local (npm run pack:win), groupe sauté");
}
