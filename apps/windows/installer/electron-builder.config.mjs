/*
 * Le bootstrapper n'EST PAS l'application : son `appId`, sa sortie et son
 * exécutable restent distincts pour qu'il ne puisse ni remplacer l'entrée de
 * désinstallation de Neo Quiz, ni être pris pour une mise à jour par NSIS.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";

export default async function () {
	return {
		appId: "com.ahmed.neoquiz.installer",
		productName: "Neo Quiz Installer",
		executableName: "neo-quiz-installer",
		/* `store`, et c'est un choix d'EXPÉRIENCE, pas de poids (2026-09-22).
		   Le portable s'auto-extrait à CHAQUE lancement avant qu'Electron ne
		   puisse peindre quoi que ce soit. MESURÉ en local, double-clic →
		   fenêtre Electron : 3,7 s en `normal`, 0,9 s en `store`. L'exe passe
		   de ~97 à ~312 Mo ; décision d'Ahmed : « si l'installeur sur GitHub
		   doit faire 500 Mo ça ne pose aucun problème », pourvu que la fenêtre
		   soit là dès le clic. (L'ancien arbitrage inverse, pris le 2026-09-17
		   pour la demi-minute de téléchargement, est révolu : `normal` ramène
		   97 Mo pour 1 min 45 de packaging, `maximum` 3 Ko de plus.)

		   Les ~0,9 s qui restent ne sont plus vides : le conteneur peint en
		   ~70 ms `ecran-initial.bmp`, ce même premier écran, là où Electron
		   s'ouvrira (voir `portable.splashImage` ci-dessous). */
		compression: "store",
		/* LE CONTENEUR PORTABLE S'EXTRAIT À CHAQUE LANCEMENT : tout ce qu'il
		   embarque est réécrit sur le disque de l'utilisateur avant la première
		   fenêtre, et compté dans le téléchargement. Les `.pak` que Chromium
		   n'ouvrira jamais coûtent donc deux fois.

		   L'installeur ne sait dire que DEUX langues (`LangueInstallateur`,
		   `installer/noyau.ts`) : les 53 autres `.pak` traduisaient uniquement
		   les chaînes internes de Chromium (menu contextuel d'un champ de
		   texte), sous une interface déjà anglaise pour quiconque n'est ni
		   anglophone ni francophone. MESURÉ : 47 Mo extraits et 7,8 Mo
		   téléchargés en moins.

		   L'APPLICATION, elle, garde toutes les langues : elle s'installe une
		   fois et vit ensuite sur le disque — voir `../electron-builder.config.mjs`,
		   qui ne porte PAS ce réglage. */
		electronLanguages: ["en-US", "fr"],
		/* Le compilateur HLSL d'exécution (26 Mo) ne sert qu'à WebGPU et au
		   backend D3D12 d'ANGLE. Cette fenêtre est du HTML : sans ces deux
		   fichiers, elle se peint à l'identique — éprouvé en forçant chaque
		   backend (`--use-angle=d3d11|d3d9|gl|vulkan|swiftshader`) et sans GPU
		   du tout. MESURÉ : 26 Mo extraits et 6,2 Mo téléchargés en moins.

		   Ce qui RESTE, et qu'il ne faut pas retirer pour 11 Mo de plus :
		   `vk_swiftshader.dll`, `vulkan-1.dll` et `d3dcompiler_47.dll` sont les
		   replis d'une machine dont le GPU est absent ou sur liste noire —
		   exactement le poste que ce bootstrapper doit servir. Et
		   `LICENSES.chromium.html` (20 Mo) accompagne obligatoirement une
		   redistribution binaire de Chromium. */
		afterPack: async ({ appOutDir }) => {
			for (const nom of ["dxcompiler.dll", "dxil.dll"]) {
				await rm(join(appOutDir, nom), { force: true });
			}
		},
		extraMetadata: {
			main: "dist-bootstrapper/main.cjs",
			author: { name: "Ahmed Mili" },
		},
		directories: {
			/* Une sortie indépendante permet au job Windows de conserver le NSIS
			   et le bootstrapper côte à côte sans motif de fichiers ambigu. */
			output: "dist-installer-bootstrapper",
		},
		files: ["dist-bootstrapper/**/*", "package.json", "!node_modules/**"],
		win: {
			target: "portable",
			icon: "icons/icon.ico",
			/* Le nom que l'utilisateur voit dans Téléchargements, versionné comme
			   `Obsidian-1.13.7.exe`. ${version} est celle d'apps/windows/
			   package.json : une seule source, et c'est aussi ce que
			   `app.getVersion()` rend au bootstrapper pour lire le `latest.yml`
			   de SA release (`urlLatestYml`, `installer/noyau.ts`) — le nom du
			   fichier et la version installée ne peuvent pas diverger. (La copie
			   `-fr.exe` et la langue lue dans le nom sont parties le 2026-09-15 :
			   la langue est celle de Windows.) */
			artifactName: "NeoQuiz-${version}.exe",
			/* L'exe Electron EXTRAIT ne doit pas demander l'admin de lui-même :
			   seul `Start-Process -Verb RunAs`, après le clic, fait l'élévation. */
			requestedExecutionLevel: "asInvoker",
		},
		portable: {
			/* Pas l'image plein écran de BgImage que le template d'origine en
			   ferait : le template patché (`patches/app-builder-lib+*.patch`)
			   la peint dans une fenêtre sans bordure aux dimensions et à la
			   place de la fenêtre Electron, et ne la retire qu'une fois celle-ci
			   peinte par-dessus. Régénérée par `capturer-ecran-initial.mjs`. */
			splashImage: "installer/ecran-initial.bmp",
			/* C'est le manifeste du CONTENEUR portable que Windows exécute en
			   premier. Le laisser explicitement à `user` garantit l'absence
			   d'UAC avant que l'utilisateur ait cliqué sur Installer. */
			requestExecutionLevel: "user",
		},
	};
}
