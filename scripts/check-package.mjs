/**
 * L'EMPAQUETAGE — la configuration résolue d'electron-builder, et le paquet
 * s'il existe.
 *
 * Ce que ce script empêche, et qu'une relecture ne voit pas :
 *   - une version qui diverge du manifeste (deux numéros, l'un jamais suivi) ;
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
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { makeReporter } from "./lib/load-src.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const appWindows = `${racine}apps/windows/`;

const r = makeReporter("Empaquetage — configuration résolue");

const { default: configurer } = await import(pathToFileURL(`${appWindows}electron-builder.config.mjs`).href);
const config = await configurer();
const manifeste = JSON.parse(await readFile(`${racine}src/assets/manifest.json`, "utf8"));

r.check("la version est celle du manifeste", config.extraMetadata?.version, manifeste.version);
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
	p.done();
} else {
	console.log("Empaquetage — contenu de app.asar : aucun paquet local (npm run pack:win), groupe sauté");
}
