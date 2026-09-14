/**
 * BOOTSTRAPPER D'INSTALLATION — les invariants qui évitent de télécharger ou
 * lancer le mauvais exécutable.
 *
 * Ce script charge `apps/windows/installer/noyau.ts` par le même harnais que
 * les autres contrôles : aucune réplique de la sélection de release ni des
 * arguments NSIS ne vit ici.
 *
 *     npm run check:installer
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

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

	r.done();
});
