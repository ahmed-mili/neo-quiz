/**
 * APRÈS LA SIGNATURE — recalcule ce que la signature Authenticode a rendu
 * faux.
 *
 * SignPath renvoie l'installeur avec des octets différents (la signature
 * est ajoutée dans le fichier). `latest.yml` et `<exe>.blockmap`, calculés
 * par electron-builder sur l'exe NON signé, portent alors un sha512 (et une
 * taille) qui ne correspondent plus au fichier sur disque : electron-updater
 * rejetterait la mise à jour chez CHAQUE utilisateur (« sha512 mismatch »),
 * en silence.
 *
 * Deux fenêtres dans le pipeline : AVANT signature (electron-builder écrit
 * `latest.yml` et le blockmap pour l'exe non signé, normal), APRÈS
 * signature (ce script remplace l'exe non signé par le signé dans
 * `dist-installer/`, PUIS ce script doit tourner pour resynchroniser
 * `latest.yml` et le blockmap sur le fichier réellement présent).
 *
 * Usage : node scripts/update-info-after-signing.mjs [chemin de l'exe]
 * Sans argument, l'exe est celui que nomme `path:` dans
 * `apps/windows/dist-installer/latest.yml`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const distInstaller = `${racine}apps/windows/dist-installer/`;
const latestPath = `${distInstaller}latest.yml`;

if (!existsSync(latestPath)) {
	console.error(`latest.yml introuvable : ${latestPath}`);
	process.exitCode = 1;
} else {
	const latestBrut = readFileSync(latestPath, "utf8");
	const nomExeDansLatest = /^path:\s*(.+)$/m.exec(latestBrut)?.[1]?.trim();

	const cheminExe = process.argv[2]
		? fileURLToPath(pathToFileURL(process.argv[2]).href)
		: `${distInstaller}${nomExeDansLatest ?? ""}`;

	if (!nomExeDansLatest) {
		console.error(`latest.yml ne porte aucune clé "path:" : ${latestPath}`);
		process.exitCode = 1;
	} else if (!existsSync(cheminExe)) {
		console.error(`Exe introuvable : ${cheminExe}`);
		process.exitCode = 1;
	} else if (process.argv[2] && !cheminExe.replace(/\\/g, "/").endsWith(nomExeDansLatest)) {
		console.error(`L'exe donné (${cheminExe}) ne correspond pas au "path:" de latest.yml (${nomExeDansLatest})`);
		process.exitCode = 1;
	} else {
		// `app-builder-lib` est une dépendance transitive d'electron-builder :
		// on la résout depuis apps/windows, sans l'ajouter aux dépendances.
		const require = createRequire(`${racine}apps/windows/package.json`);
		const { buildBlockMap } = require("app-builder-lib/out/targets/blockmap/blockmap.js");

		const ancienSha512 = /^(?:\s*sha512:\s*)(.+)$/m.exec(latestBrut)?.[1]?.trim();
		const ancienneTaille = /^(?:\s*size:\s*)(.+)$/m.exec(latestBrut)?.[1]?.trim();

		const cheminBlockmap = `${cheminExe}.blockmap`;
		// "gzip" + un chemin de sortie explicite : buildBlockMap ÉCRIT le
		// fichier donné plutôt que d'ajouter le blockmap à la fin de l'exe
		// (mode "deflate" sans chemin de sortie, à ne jamais utiliser ici — il
		// modifierait l'exe déjà signé).
		const { size, sha512 } = await buildBlockMap(cheminExe, "gzip", cheminBlockmap);

		// Remplace chaque `sha512:` et `size:` en gardant le format
		// d'electron-builder à l'identique (indentation, ordre des clés) :
		// une regex par ligne, jamais une réécriture complète du YAML.
		const latestMisAJour = latestBrut
			.replace(/^(\s*sha512:\s*).+$/gm, `$1${sha512}`)
			.replace(/^(\s*size:\s*).+$/gm, `$1${size}`);
		writeFileSync(latestPath, latestMisAJour, "utf8");

		console.log(`Exe : ${cheminExe}`);
		console.log(`sha512 avant : ${ancienSha512 ?? "(absent)"}`);
		console.log(`sha512 après : ${sha512}`);
		console.log(`taille avant : ${ancienneTaille ?? "(absent)"}`);
		console.log(`taille après : ${size}`);
		console.log(`latest.yml et ${cheminBlockmap} mis à jour.`);
	}
}
