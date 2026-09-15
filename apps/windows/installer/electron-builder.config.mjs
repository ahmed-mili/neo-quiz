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
		/* Le portable s'auto-extrait à chaque lancement. `store` évite la
		   décompression LZMA coûteuse : l'exe est plus gros, mais la première
		   fenêtre peut apparaître plus vite. */
		compression: "store",
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
