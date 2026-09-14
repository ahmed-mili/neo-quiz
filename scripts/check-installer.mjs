import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const siteEn = readFileSync(resolve(racine, "docs/index.html"), "utf8");
const siteFr = readFileSync(resolve(racine, "docs/fr/index.html"), "utf8");

await withSrcModule("apps/windows/installer/noyau.ts", ({ resoudrePaquet, argumentsNsis }) => {
	const r = makeReporter("Installateur — bootstrapper");
	const version = "1.2.3";
	const nom = `neo-quiz-setup-${version}.exe`;
	const sha = "a".repeat(64);
	const release = {
		tag_name: `desktop-v${version}`,
		draft: false,
		prerelease: false,
		assets: [
			{
				name: "neo-quiz-setup.exe",
				browser_download_url: `https://github.com/ahmed-mili/neo-quiz/releases/download/desktop-v${version}/neo-quiz-setup.exe`,
				size: 101,
				digest: `sha256:${"b".repeat(64)}`,
			},
			{
				name: nom,
				browser_download_url: `https://github.com/ahmed-mili/neo-quiz/releases/download/desktop-v${version}/${nom}`,
				size: 123456,
				digest: `sha256:${sha}`,
			},
		],
	};

	r.check("release : le paquet VERSIONNÉ est choisi, jamais le nom fixe",
		resoudrePaquet(release), {
			version,
			nom,
			url: release.assets[1].browser_download_url,
			taille: 123456,
			sha256: sha,
		});
	r.check("release : sans empreinte sha256, rien n'est installable",
		resoudrePaquet({ ...release, assets: [{ ...release.assets[1], digest: null }] }), null);
	r.check("release : une URL hors du dépôt GitHub est refusée",
		resoudrePaquet({
			...release,
			assets: [{ ...release.assets[1], browser_download_url: `https://example.test/${nom}` }],
		}), null);

	const dossier = "C:\\Program Files\\Neo Quiz";
	const args = argumentsNsis(dossier);
	r.check("NSIS : le mode machine est explicite", args[0], "/allusers");
	r.check("NSIS : le mode silencieux est explicite", args.includes("/S"), true);
	r.check("NSIS : /D reste le dernier argument", args.at(-1), `/D=${dossier}`);

	/* Le site ne doit jamais retomber sur le NSIS visible. Le lien statique
	   mène à la release tant que le premier bootstrapper n'est pas encore
	   publié ; dès que `latest.json` porte `neo-quiz-installer.exe`, le JS le
	   remplace par l'asset exact. Ce repli évite un 404 pendant la transition. */
	r.check("publication : release construit le bootstrapper",
		workflow.includes("npm run pack:installer"), true);
	r.check("publication : release attache le bootstrapper",
		workflow.includes("apps/windows/dist-installer-bootstrapper/neo-quiz-installer.exe"), true);
	r.check("publication : l'alias NSIS public a disparu",
		workflow.includes("neo-quiz-setup.exe\n"), false);

	for (const [langue, site] of [["EN", siteEn], ["FR", siteFr]]) {
		r.check(`site ${langue} : Windows ne pointe plus sur l'ancien NSIS`,
			site.includes("releases/latest/download/neo-quiz-setup.exe"), false);
		r.check(`site ${langue} : Windows cible le bootstrapper exact`,
			site.includes('trouverActif(donnees.assets, "neo-quiz-installer.exe")'), true);
		r.check(`site ${langue} : Windows n'offre pas un faux choix de versions`,
			site.includes('activerSelecteurVersion("windows"'), false);
	}

	r.done();
});
