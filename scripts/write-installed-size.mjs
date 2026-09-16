/**
 * APRÈS `npm run pack:win`, AVANT LA SIGNATURE — écrit la taille du logiciel
 * une fois installé dans `latest.yml`, sous la clé racine `installedSize`.
 *
 * C'est la SEULE source qui connaît cette taille sans la deviner : la somme
 * des fichiers du dossier `win-unpacked` qu'electron-builder vient de
 * construire. `latest.yml` n'est pas haché et electron-updater ignore toute
 * clé racine qu'il ne connaît pas : cet ajout est sans effet sur la mise à
 * jour automatique. `scripts/update-info-after-signing.mjs` ne touche que les
 * lignes `sha512:`/`size:` : il préserve cette clé sans modification.
 *
 *     node scripts/write-installed-size.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const racine = fileURLToPath(new URL("..", import.meta.url));
const distInstaller = `${racine}apps/windows/dist-installer/`;
const latestPath = `${distInstaller}latest.yml`;
const winUnpacked = `${distInstaller}win-unpacked`;

/** Somme récursive des tailles de fichiers, symétrique du sondage du
    travailleur élevé (`apps/windows/installer/worker.ts`, `tailleDossier`) :
    même définition des deux côtés, sinon le pourcentage publié ne
    convergerait jamais vers 99 avant le code de sortie 0 de NSIS. */
async function tailleDossier(dossier) {
	let total = 0;
	for (const entree of await readdir(dossier, { withFileTypes: true })) {
		const chemin = join(dossier, entree.name);
		if (entree.isDirectory()) total += await tailleDossier(chemin);
		else if (entree.isFile()) total += (await stat(chemin)).size;
	}
	return total;
}

if (!existsSync(latestPath)) {
	console.error(`latest.yml introuvable : ${latestPath}`);
	process.exitCode = 1;
} else if (!existsSync(winUnpacked)) {
	console.error(`win-unpacked introuvable : ${winUnpacked}`);
	process.exitCode = 1;
} else {
	const installedSize = await tailleDossier(winUnpacked);
	const latestBrut = readFileSync(latestPath, "utf8");
	const latestMisAJour = /^installedSize:.*$/m.test(latestBrut)
		? latestBrut.replace(/^installedSize:.*$/m, `installedSize: ${installedSize}`)
		: `${latestBrut.replace(/\n$/, "")}\ninstalledSize: ${installedSize}\n`;
	writeFileSync(latestPath, latestMisAJour, "utf8");
	console.log(`win-unpacked : ${installedSize} octets`);
	console.log(`latest.yml : installedSize écrit.`);
}
