/**
 * MESURE CE QUE NSIS FAIT VRAIMENT, ÉTAPE PAR ÉTAPE — l'outil derrière les
 * constantes de `progressionInstallation` (`apps/windows/installer/noyau.ts`).
 *
 * Il ne vérifie rien : il MESURE, comme `npm run report:multiblock`, et sort
 * toujours en 0. Ce qu'il imprime est la seule chose qui puisse justifier les
 * paliers de la barre d'installation : la part du TEMPS que prend chaque
 * étape, et laquelle est observable.
 *
 * Il lance un VRAI NSIS de Neo Quiz, en silence, dans un dossier donné, et
 * sonde toutes les 100 ms deux choses : le dossier d'installation, et le
 * dossier temporaire PRIVÉ qu'il donne à NSIS — exactement le capteur que le
 * travailleur élevé utilise en production (`worker.ts`, `lancerNsis`).
 *
 * Le NSIS d'electron-builder demande les droits administrateur
 * (`requireAdministrator` dans son manifeste) : lancer ce script depuis une
 * console ordinaire échoue avec `EACCES`. Il faut une console ÉLEVÉE.
 *
 *     node scripts/mesurer-installation.mjs <setup.exe> <dossier> [--vider]
 *
 * `--vider` mesure une installation NEUVE (le dossier est supprimé d'abord) ;
 * sans lui, une MISE À JOUR par-dessus ce qui s'y trouve. Les deux profils
 * diffèrent beaucoup — la mise à jour ajoute la désinstallation de l'ancienne
 * version, une étape entièrement aveugle — d'où les deux barèmes du noyau.
 */
import { withSrcModule } from "./lib/load-src.mjs";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [setup, cible, ...drapeaux] = process.argv.slice(2);
const vider = drapeaux.includes("--vider");

/** Le dossier cible est CRÉÉ par ce script (`mkdir`, dans `mesurer`). Un
    chemin qui contient des espaces et qu'on a oublié de CITER ne produit donc
    pas une erreur : il crée son PREMIER MOT pour de bon. `C:\Program
    Files\Neo Quiz` non cité a ainsi laissé un `C:\Program` vide à la racine
    du disque, et Windows avertit à chaque démarrage qu'un tel nom détourne
    les chemins non cités (il cherche `C:\Program.exe` avant
    `C:\Program Files\...`). D'où la règle : après `<setup.exe>` et
    `<dossier>`, seuls les DRAPEAUX CONNUS sont acceptés, et le premier
    argument doit finir par `.exe`. Un argument de plus est le reste d'un
    chemin coupé, pas une option. */
const DRAPEAUX_CONNUS = ["--vider"];
const inconnus = drapeaux.filter(d => !DRAPEAUX_CONNUS.includes(d));
const USAGE = "Usage : node scripts/mesurer-installation.mjs <setup.exe> <dossier> [--vider]";
const CITER = "Un chemin qui contient des espaces doit être CITÉ : sans guillemets, le dossier créé serait son premier mot.";


/** La même somme récursive que `worker.ts` : une entrée qui disparaît ou se
    verrouille pendant que NSIS écrit est normale, jamais fatale. */
async function tailleDossier(dossier) {
	let total = 0;
	let entrees;
	try {
		entrees = await readdir(dossier, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entree of entrees) {
		const chemin = join(dossier, entree.name);
		try {
			if (entree.isDirectory()) total += await tailleDossier(chemin);
			else if (entree.isFile()) total += (await stat(chemin)).size;
		} catch {
			// Entrée disparue ou verrouillée pendant l'écriture NSIS : ignorée.
		}
	}
	return total;
}

/** Le seuil qui distingue l'archive du bruit des plugins, comme dans le noyau. */
const SEUIL_EXTRACTION = 4 * 1024 * 1024;

/** Le poids du NSIS, tel que `latest.yml` le publie sous `size`. */
async function taillePaquet(fichier) {
	return (await stat(fichier)).size;
}

/** Le poids du logiciel installé, tel que la CI le publie sous `installedSize` :
    ici, la somme du dossier une fois NSIS terminé. */
async function tailleInstallee(dossier) {
	const total = await tailleDossier(dossier);
	return total > 0 ? total : null;
}

async function mesurer({ suivre, suiviInitial }) {
	if (vider) await rm(cible, { recursive: true, force: true }).catch(() => {});
	await mkdir(cible, { recursive: true }).catch(() => {});
	const tempNsis = await mkdtemp(join(tmpdir(), "neo-quiz-mesure-"));
	const initial = await tailleDossier(cible);

	const echantillons = [];
	const depart = Date.now();
	const enfant = spawn(setup, ["/allusers", "/S", `/D=${cible}`], {
		windowsHide: true,
		stdio: "ignore",
		env: { ...process.env, TEMP: tempNsis, TMP: tempNsis },
	});

	let fini = false;
	let code = null;
	let erreur = null;
	enfant.once("exit", valeur => { fini = true; code = valeur; });
	enfant.once("error", valeur => { fini = true; erreur = valeur; });

	let enCours = false;
	const minuterie = setInterval(() => {
		if (enCours) return;
		enCours = true;
		void (async () => {
			const [dossier, temporaire] = await Promise.all([tailleDossier(cible), tailleDossier(tempNsis)]);
			echantillons.push({ ms: Date.now() - depart, dossier, temporaire });
			enCours = false;
		})();
	}, 100);

	while (!fini) await new Promise(resoudre => setTimeout(resoudre, 50));
	await new Promise(resoudre => setTimeout(resoudre, 600));
	clearInterval(minuterie);
	const duree = Date.now() - depart;
	await rm(tempNsis, { recursive: true, force: true }).catch(() => {});

	if (erreur) {
		console.error(`Le NSIS n'a pas pu être lancé : ${erreur.message}`);
		console.error(erreur.code === "EACCES"
			? "Il exige les droits administrateur : relance depuis une console élevée."
			: "");
		return;
	}

	const creux = echantillons.reduce((bas, e) => Math.min(bas, e.dossier), initial);
	const jalon = predicat => echantillons.find(predicat)?.ms ?? null;
	const extraction = jalon(e => e.temporaire >= SEUIL_EXTRACTION);
	const placement = jalon(e => e.dossier > creux);
	const pleins = echantillons.filter(e => e.dossier > creux);
	const placementFini = pleins.length > 0 ? pleins.at(-1).ms : null;

	const part = ms => (ms === null ? "—" : `${((ms / duree) * 100).toFixed(0)} %`);
	const seconde = ms => (ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`);

	console.log(`\n${vider ? "INSTALLATION NEUVE" : "MISE À JOUR"} — ${seconde(duree)}, code de sortie ${code}`);
	console.log(`  dossier avant : ${initial} octets, creux : ${creux} octets`);
	console.log("");
	console.log(`  aveugle (démarrage${initial > 0 ? " + désinstallation" : ""})  0 → ${seconde(extraction)}   ${part(extraction)}`);
	console.log(`  extraction (dossier temporaire)      ${seconde(extraction)} → ${seconde(placement)}   ${part(placement === null || extraction === null ? null : placement - extraction)}`);
	console.log(`  mise en place (dossier installé)     ${seconde(placement)} → ${seconde(placementFini)}   ${part(placementFini === null || placement === null ? null : placementFini - placement)}`);
	console.log(`  finitions (registre, raccourcis)     ${seconde(placementFini)} → ${seconde(duree)}   ${part(placementFini === null ? null : duree - placementFini)}`);
	/* Le pourcentage REJOUÉ sur les échantillons, par le noyau lui-même et avec
	   le même état roulant que `lancerNsis` tient : creux, maximum du
	   temporaire, et dernière valeur publiée. */
	const bareme = { paquet: await taillePaquet(setup), installe: await tailleInstallee(cible), initial };
	let suivi = suiviInitial(bareme);
	let recule = 0;
	let fige = 0;
	let precedentMs = 0;
	let plusLongueImmobilite = 0;
	const barres = [];
	for (const e of echantillons) {
		const avant = suivi.dernier;
		suivi = suivre(bareme, suivi, { ecoule: e.ms, dossier: e.dossier, temporaire: e.temporaire });
		const apres = suivi.dernier;
		if (avant !== null && apres !== null && apres < avant) recule += 1;
		if (avant !== null && apres !== null && apres === avant) {
			fige += e.ms - precedentMs;
			plusLongueImmobilite = Math.max(plusLongueImmobilite, fige);
		} else {
			fige = 0;
		}
		precedentMs = e.ms;
		barres.push(apres);
	}
	console.log("");
	console.log(`  barre : ${recule} recul(s), plus longue immobilité ${(plusLongueImmobilite / 1000).toFixed(1)} s`);
	console.log("");
	console.log("  ms;dossier;temporaire;barre");
	for (const [index, e] of echantillons.entries()) {
		const barre = barres[index];
		console.log(`  ${e.ms};${e.dossier};${e.temporaire};${barre === null ? "—" : barre.toFixed(1)}`);
	}
}

if (!setup || !cible) {
	console.error(USAGE);
	process.exitCode = 1;
} else if (inconnus.length > 0) {
	console.error(`Argument inattendu : ${inconnus.join(" ")}`);
	console.error(CITER);
	console.error(USAGE);
	process.exitCode = 1;
} else if (!setup.toLowerCase().endsWith(".exe")) {
	console.error(`Ce n'est pas un installeur : ${setup}`);
	console.error(CITER);
	console.error(USAGE);
	process.exitCode = 1;
} else {
	/* Le CODE RÉEL du noyau, jamais une réplique : la colonne « barre » de la
	   sortie est exactement ce que le bootstrapper publierait. C'est elle qui
	   dit si la barre est progressive, sans avoir à regarder une fenêtre. */
	await withSrcModule("apps/windows/installer/noyau.ts", ({ suivre, suiviInitial }) =>
		mesurer({ suivre, suiviInitial }));
}
