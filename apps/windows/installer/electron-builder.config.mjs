/*
 * Le bootstrapper n'EST PAS l'application : son `appId`, sa sortie et son
 * exécutable restent distincts pour qu'il ne puisse ni remplacer l'entrée de
 * désinstallation de Neo Quiz, ni être pris pour une mise à jour par NSIS.
 */
export default async function () {
	return {
		appId: "com.ahmed.neoquiz.installer",
		productName: "Neo Quiz Installer",
		executableName: "neo-quiz-installer",
		/* Le portable s'auto-extrait à chaque lancement, et `store` rendait
		   cette extraction gratuite au prix d'un exe de 371 Mo — presque trois
		   fois l'installeur de 132 Mo qu'il ne fait que TÉLÉCHARGER. MESURÉ sur
		   le runner (2026-09-17, deux répétitions `workflow_dispatch`) :
		   `normal` le ramène à 97 Mo, pour 1 min 45 de packaging au lieu de
		   14 s ; `maximum` ne gagne que 3 Ko de plus et coûte 23 s — inutile de
		   le réessayer. Les 273 Mo économisés valent une demi-minute de
		   téléchargement en moins à CHAQUE installation, contre quelques
		   secondes d'extraction une seule fois, et autant à la CI, où l'envoi
		   des paquets domine tout le reste. */
		compression: "normal",
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
			   `Obsidian-1.13.7.exe`. La release l'attache aussi sous
			   `NeoQuiz-X.Y.Z-fr.exe` pour la page française (la langue voyage dans
			   le nom, `installer/noyau.ts`, `langueDepuisNom`). ${version} est
			   celle d'apps/windows/package.json : une seule source. */
			artifactName: "NeoQuiz-${version}.exe",
			/* L'exe Electron EXTRAIT ne doit pas demander l'admin de lui-même :
			   seul `Start-Process -Verb RunAs`, après le clic, fait l'élévation. */
			requestedExecutionLevel: "asInvoker",
		},
		portable: {
			/* C'est le manifeste du CONTENEUR portable que Windows exécute en
			   premier. Le laisser explicitement à `user` garantit l'absence
			   d'UAC avant que l'utilisateur ait cliqué sur Installer. */
			requestExecutionLevel: "user",
		},
	};
}
