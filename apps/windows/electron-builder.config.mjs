// Config d'empaquetage (tache 7 de la migration Tauri -> Electron).
//
// Deux sorties existent deja avant electron-builder : `dist/` (le rendu,
// construit par Vite) et `dist-electron/` (le processus principal et le
// preload, construits par `electron/construire.mjs`, cf. sa note d'en-tete).
// Ce fichier ne fait que les EMPAQUETER dans un installeur ; il ne recompile
// rien lui-meme, d'ou `"build"` qui enchaine les deux avant `electron-builder`
// dans `apps/windows/package.json`.
//
// FORMAT JS ET NON YAML (Ruling 23, ronde de correction 1) : depuis le
// 2026-09-13, l'application a sa propre version, independante du plugin
// Obsidian (`src/assets/manifest.json`, qui garde la sienne). Elle vit dans
// `apps/windows/package.json` (voir `scripts/set-version.mjs` et CLAUDE.md) ;
// electron-builder la lit LUI-MEME depuis ce fichier, sans qu'aucune cle de
// cette config ait besoin de la lui injecter — c'est pourquoi `extraMetadata`
// ne porte plus que `author`, jamais `version`.
//
// PIEGE VERIFIE : electron-builder n'AUTO-DETECTE que les configs
// `electron-builder.{yml,yaml,json,json5,toml}` ou le champ `build` de
// `package.json` — un `.mjs` a cote n'est jamais charge tout seul (verifie
// une fois : un premier essai sans `--config` a ignore ce fichier en
// silence, empaquete avec le nom et la version par defaut de package.json,
// ET ecrit dans `dist/` au lieu de `dist-installer/`, melangeant le paquet
// avec la sortie Vite). Les scripts `pack:win` / `pack:linux` de
// `package.json` passent donc `--config electron-builder.config.mjs`
// explicitement ; ne jamais lancer `electron-builder` nu sans ce flag.
export default async function () {
	return {
		/* IMMUABLE, comme `PLUGIN_ID` : c'est la clé de registre par laquelle
		   l'installeur NSIS retrouve une installation existante pour la
		   remplacer. Changé, chaque mise à jour deviendrait une seconde
		   installation à côté de la première — deux raccourcis, deux entrées
		   dans « Applications ». `npm run check:package` le fige. */
		appId: "com.ahmed.neoquiz",
		productName: "Neo Quiz",
		/* IMMUABLE aussi. Sans lui, electron-builder dérive le nom du binaire
		   du `name` de package.json (`@neo-quiz/windows`) et REFUSE le `@` :
		   c'est ce qui a fait échouer chaque run CI Linux jusqu'au
		   2026-09-12. Sous Linux, c'est le nom du binaire dans l'AppImage et
		   de l'entrée `.desktop`. */
		executableName: "neo-quiz",
		extraMetadata: {
			/* `Publisher` dans la clé de désinstallation (winget y corrèle le
			   paquet) et `CompanyName` dans les métadonnées de l'exe — exigée
			   par SignPath comme métadonnée sur l'installeur signé. */
			author: { name: "Ahmed Mili" },
		},
		directories: {
			// `output` evite que l'installeur atterrisse dans `dist/`, deja pris
			// par le rendu Vite : electron-builder l'ecraserait sinon a chaque
			// paquet.
			output: "dist-installer",
		},
		/* LE FLUX DES MISES À JOUR : la dernière release GitHub de ce dépôt.
		   Cette clé fait deux choses à l'empaquetage : écrire `latest.yml` /
		   `latest-linux.yml` (version + sha512 des paquets) dans
		   `dist-installer/`, et embarquer `resources/app-update.yml` dans le
		   paquet — c'est ce fichier que lit electron-updater, jamais une URL
		   venue du rendu. Elle ne PUBLIE rien : les scripts `pack:*` passent
		   `--publish never`, parce que sous un tag et avec `GH_TOKEN`,
		   electron-builder créerait lui-même une release brouillon à côté de
		   celle de `release.yml`. Sans `allowPrerelease`, ce fournisseur lit
		   `/releases/latest` puis le `latest.yml` de CETTE release : la
		   release de l'application est donc publiée comme « latest »
		   (`make_latest: true`), tandis que celles du greffon sont publiées
		   avec `make_latest: false` — c'est ce qui permet à un seul
		   fournisseur github de coexister avec deux familles de tags
		   (`desktop-vX.Y.Z` et `vX.Y.Z`) sans qu'electron-updater ne confonde
		   jamais une release de greffon avec une mise à jour de l'app. */
		publish: { provider: "github", owner: "ahmed-mili", repo: "neo-quiz" },
		/* Les DEUX sorties et rien d'autre. Le principal est bundlé par esbuild
		   (`chokidar` compris — raison 2 de l'en-tête de `construire.mjs`), le
		   rendu par Vite (`lucide` compris) : rien dans le paquet n'appelle
		   `require` vers `node_modules`. Sans l'exclusion, electron-builder y
		   copiait 3 659 fichiers de dépendances de production, et les
		   sourcemaps du principal avec. Si cette affirmation devenait fausse,
		   l'application ne démarrerait pas : l'épreuve « premier lancement sur
		   machine propre » l'attraperait. */
		files: ["dist/**/*", "dist-electron/**/*", "!dist-electron/**/*.map", "!dist/**/*.map", "package.json", "!node_modules/**"],
		win: {
			target: "nsis",
			icon: "icons/icon.ico",
			// Sans espace : un nom qu'on `curl` sans guillemets depuis la release.
			artifactName: "neo-quiz-setup-${version}.${ext}",
			/* `signtoolOptions.publisherName` (lu par electron-updater dans
			   `resources/app-update.yml`, clé `publisherName`) sera posé ici une
			   fois le CN du certificat connu — lu dans le journal CI de l'étape
			   « Verify the signature » sur le premier exe signé par
			   `release-signing` (voir release.yml). Tant qu'elle est absente,
			   `scripts/check-package.mjs` l'attend à `null` (`PUBLISHER_ATTENDU`) :
			   une valeur qui ne correspond pas EXACTEMENT au CN du certificat fait
			   refuser CHAQUE mise à jour par electron-updater, silencieusement. */
		},
		linux: {
			/* LES TROIS SORTIES LINUX, relevées sur obsidian.md/download le
			   2026-09-16 : AppImage x86_64, AppImage ARM64, .deb amd64. Obsidian
			   propose en plus Snap et Flatpak, mais ce sont des MAGASINS à
			   alimenter à chaque version (compte Snapcraft, pull request chez
			   Flathub) et non des cibles de build — leur Flatpak est d'ailleurs
			   « community maintained ». Pas de .rpm : eux non plus.
			   L'arm64 se construit sur le runner x64 : electron-builder
			   télécharge l'Electron arm64, rien n'est compilé nativement ici.
			   La mise à jour suit le format toute seule : electron-builder pose
			   un fichier `resources/package-type` dans le .deb, qu'electron-updater
			   lit pour choisir `DebUpdater` (installation par `dpkg -i`, avec une
			   demande de mot de passe) au lieu d'`AppImageUpdater`. */
			target: [
				{ target: "AppImage", arch: ["x64", "arm64"] },
				{ target: "deb", arch: ["x64"] },
			],
			icon: "icons/icon.png",
			category: "Education",
			/* `${arch}` est OBLIGATOIRE depuis qu'il y a deux architectures, et
			   il l'est jusque sur la x64 : electron-builder n'omet l'architecture
			   par défaut que si AUCUN `artifactName` n'est imposé
			   (`platformPackager.js`, `expandArtifactNamePattern` : le saut est
			   conditionné à `!isUserForced`). Sans lui, les deux AppImage
			   porteraient le même nom. D'où `neo-quiz-1.0.6-x64.AppImage` là où
			   Obsidian, qui ne force pas le nom, a `Obsidian-1.13.7.AppImage`.
			   Le lien permanent du site ne change pas pour autant : il vise
			   l'alias `neo-quiz.AppImage`, que la CI copie depuis la x64. */
			artifactName: "neo-quiz-${version}-${arch}.${ext}",
			/* `StartupWMClass` = `executableName` : c'est ainsi qu'un bureau
			   Linux relie la fenêtre à son entrée `.desktop` (avertissement
			   `WM_CLASS` du journal CI). */
			desktop: { entry: { Name: "Neo Quiz", StartupWMClass: "neo-quiz" } },
		},
		nsis: {
			/* Le bootstrapper installe toujours dans Program Files avec /allusers.
			   L'expliciter ici évite au désinstalleur une page de choix de portée :
			   il arrive directement sur sa petite fenêtre de progression. */
			oneClick: false,
			perMachine: true,
			allowToChangeInstallationDirectory: true,
			/* L'installation garde le wizard NSIS parce que le bootstrapper le
			   lance en silence ; seul le désinstalleur visible doit être compact. */
			include: "installer/uninstaller.nsh",
			/* La valeur par défaut, ÉCRITE pour qu'une lecture future ne la
			   « nettoie » pas : la mise à jour désinstalle l'ancienne version
			   avant d'installer la neuve, et `userData`
			   (`%APPDATA%\Neo Quiz\settings.json`, les dossiers ouverts) ne
			   survit que parce que ceci est faux. */
			deleteAppDataOnUninstall: false,
		},
	};
}
