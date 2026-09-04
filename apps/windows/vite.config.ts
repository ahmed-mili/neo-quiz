import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

/*
 * L'app importe le code partagé par CHEMIN RELATIF (../../../src/…), sans
 * alias, sans symlink, sans copie. C'est la décision D2 du plan : Neo Calendar
 * a 132 fichiers de même nom entre ses deux dépôts, dont 83 ont divergé. Une
 * mécanique qui rend la copie possible finit par en produire une ; un chemin
 * relatif ne peut pas diverger, il n'y a qu'un fichier au bout.
 *
 * `server.fs.allow` est la contrepartie obligatoire : par défaut Vite refuse
 * de SERVIR un fichier hors de son propre dossier, et sans cette ligne le
 * serveur de développement renverrait 403 sur chaque import de `src/`.
 * Le build de production, lui, n'en a pas besoin — d'où un échec qui
 * n'apparaît qu'en `dev`.
 */
const racineDepot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
	clearScreen: false,
	server: {
		port: 1421,
		strictPort: true,
		fs: { allow: [racineDepot] },
		watch: { ignored: ["**/src-tauri/**"] },
	},
	envPrefix: ["VITE_", "TAURI_"],
	build: {
		target: "es2021",
		outDir: "dist",
		sourcemap: true,
	},
});
