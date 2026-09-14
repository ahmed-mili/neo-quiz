import { readFileSync } from "node:fs";
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
const siteEn = readFileSync(resolve(racine, "docs/index.html"), "utf8");
const siteFr = readFileSync(resolve(racine, "docs/fr/index.html"), "utf8");

await withSrcModule("apps/windows/installer/noyau.ts", ({ resoudrePaquet, argumentsNsis, langueDepuisNom, langueDepuisZone }) => {
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
	   publié ; dès que `latest.json` porte `Install-NeoQuiz.exe`, le JS le
	   remplace par l'asset exact. Ce repli évite un 404 pendant la transition. */
	r.check("publication : release construit le bootstrapper",
		workflow.includes("npm run pack:installer"), true);
	r.check("publication : release attache le bootstrapper",
		workflow.includes("apps/windows/dist-installer-bootstrapper/Install-NeoQuiz.exe"), true);
	r.check("publication : l'alias NSIS public a disparu",
		workflow.includes("neo-quiz-setup.exe\n"), false);

	r.check("publication : release attache aussi le bootstrapper français",
		workflow.includes("apps/windows/dist-installer-bootstrapper/Install-NeoQuiz-fr.exe"), true);
	r.check("publication : le nom français est une copie du même exe",
		workflow.includes("cp Install-NeoQuiz.exe Install-NeoQuiz-fr.exe"), true);

	/* La langue voyage AVEC le fichier : par son nom d'abord, par le flux
	   `Zone.Identifier` du navigateur ensuite. Un nom sans rapport ou un
	   référent d'un autre site ne valent JAMAIS « en » par défaut : c'est
	   l'appelant qui retombe sur la locale, et lui seul. */
	r.check("langue : le nom anglais", langueDepuisNom("Install-NeoQuiz.exe"), "en");
	r.check("langue : le nom français", langueDepuisNom("Install-NeoQuiz-fr.exe"), "fr");
	r.check("langue : la casse du nom est indifférente", langueDepuisNom("install-neoquiz-FR.exe"), "fr");
	r.check("langue : le suffixe du navigateur « (1) » est ignoré", langueDepuisNom("Install-NeoQuiz-fr (2).exe"), "fr");
	r.check("langue : un code inconnu ne vaut rien", langueDepuisNom("Install-NeoQuiz-xx.exe"), null);
	r.check("langue : un autre nom ne vaut rien", langueDepuisNom("neo-quiz-setup-1.0.2.exe"), null);
	r.check("langue : référent de la page française",
		langueDepuisZone("[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://ahmed-mili.github.io/neo-quiz/fr/\r\nHostUrl=https://objects.githubusercontent.com/x\r\n"), "fr");
	r.check("langue : référent de la racine du site",
		langueDepuisZone("[ZoneTransfer]\nZoneId=3\nReferrerUrl=https://ahmed-mili.github.io/neo-quiz/\n"), "en");
	r.check("langue : référent de la page anglaise explicite",
		langueDepuisZone("[ZoneTransfer]\nReferrerUrl=https://ahmed-mili.github.io/neo-quiz/en/\n"), "en");
	r.check("langue : référent d'un autre site ne vaut rien",
		langueDepuisZone("[ZoneTransfer]\nZoneId=3\nReferrerUrl=https://github.com/ahmed-mili/neo-quiz/releases\n"), null);
	r.check("langue : le même chemin sur un autre hôte ne vaut rien",
		langueDepuisZone("[ZoneTransfer]\nReferrerUrl=https://exemple.test/neo-quiz/fr/\n"), null);
	r.check("langue : flux sans URL ne vaut rien", langueDepuisZone("[ZoneTransfer]\nZoneId=3\n"), null);
	r.check("langue : HostUrl seul suffit",
		langueDepuisZone("[ZoneTransfer]\nHostUrl=https://ahmed-mili.github.io/neo-quiz/fr/index.html\n"), "fr");

	for (const [langue, site] of [["EN", siteEn], ["FR", siteFr]]) {
		r.check(`site ${langue} : Windows ne pointe plus sur l'ancien NSIS`,
			site.includes("releases/latest/download/neo-quiz-setup.exe"), false);
		r.check(`site ${langue} : Windows cible le bootstrapper exact`,
			site.includes('trouverActif(donnees.assets, "Install-NeoQuiz.exe")'), true);
		// La page française distribue le nom FRANÇAIS ; l'anglaise ne doit pas.
		r.check(`site ${langue} : le nom français ${langue === "FR" ? "est" : "n'est pas"} distribué`,
			site.includes('trouverActif(donnees.assets, "Install-NeoQuiz-fr.exe")'), langue === "FR");
		r.check(`site ${langue} : Windows n'offre pas un faux choix de versions`,
			site.includes('activerSelecteurVersion("windows"'), false);
	}

	r.done();
});
