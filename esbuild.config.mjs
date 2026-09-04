import esbuild from "esbuild";
import fs from "fs";
import path from "path";

const production = process.argv.includes("production");
const watch = !production;

// Racine des vaults Obsidian. Le build déploie automatiquement le plugin dans
// chaque vault ayant déjà le répertoire `.obsidian/plugins/quiz-blocks`.
const VAULTS_BASE = "C:\\obsidian-vaults";

function getVaultPluginDirs() {
	const explicit = process.env.VAULT_PLUGIN_DIR;
	if (explicit) return [explicit];

	const dirs = [];
	try {
		if (fs.existsSync(VAULTS_BASE)) {
			for (const name of fs.readdirSync(VAULTS_BASE)) {
				const pluginDir = path.join(VAULTS_BASE, name, ".obsidian", "plugins", "quiz-blocks");
				if (fs.existsSync(pluginDir)) dirs.push(pluginDir);
			}
		}
	} catch (error) {
		console.error("Erreur détection vaults :", error);
	}
	// Aucun vault détecté : on ne déploie nulle part (le build reste dans dist/).
	// Surtout PAS de fallback ["."] qui écrirait les artefacts dans le repo.
	return dirs;
}

const VAULT_PLUGIN_DIRS = getVaultPluginDirs();
if (VAULT_PLUGIN_DIRS.length === 0) {
	console.log(`Aucun vault quiz-blocks détecté sous ${VAULTS_BASE} : build dans dist/ uniquement (pas de déploiement).`);
}

function deployFileToVaults(sourceFile) {
	if (VAULT_PLUGIN_DIRS.length === 0) return;
	for (const dir of VAULT_PLUGIN_DIRS) {
		fs.mkdirSync(dir, { recursive: true });
		fs.copyFileSync(path.resolve(sourceFile), path.join(dir, path.basename(sourceFile)));
	}
	console.log(`${path.basename(sourceFile)} copié dans ${VAULT_PLUGIN_DIRS.length} vault(s).`);
}

function copyManifest() {
	deployFileToVaults("src/assets/manifest.json");
}

async function bundleCSS() {
	await esbuild.build({
		entryPoints: ["src/assets/css/index.css"],
		outfile: "dist/styles.css",
		bundle: true,
		minify: false,		// Désactivé pour avoir du CSS lisible
		logLevel: "info",
		// Fonts MathLive (≈300 Ko woff2) inlinées en data-URI : le plugin
		// reste 3 fichiers (main.js/styles.css/manifest.json), pas de CDN.
		loader: { ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl" },
	});

	// Supprimer le commentaire d'entry point laissé par esbuild
	let css = fs.readFileSync("dist/styles.css", "utf8");
	css = css.replace(/\n\/\* src\/assets\/css\/index\.css \*\/\s*$/, "");
	fs.writeFileSync("dist/styles.css", css);
	deployFileToVaults("dist/styles.css");
	console.log("styles.css bundlé (tous les @import inlinés).");
	if (!production) {
		console.log("Mode dev: CSS non minifié pour faciliter le debug.");
	}
}

const ctx = await esbuild.context({
	// Le point d'entrée du GREFFON vit sous apps/obsidian/ : c'est un hôte,
	// au même titre qu'apps/windows/. `src/` ne contient que le partagé.
	entryPoints: ["apps/obsidian/main.ts"],
	outfile: "dist/main.js",
	bundle: true,
	format: "cjs",
	platform: "node",
	target: "es2020",
	sourcemap: production ? false : "inline",
	external: [
		"obsidian",
		"electron"
	],
	logLevel: "info",
});

if (watch) {
	await ctx.watch();

	copyManifest();
	await bundleCSS();

	let cssRebuildTimer = null;

	fs.watch(path.resolve("src/assets"), { recursive: true, persistent: true }, (_eventType, filename) => {
		if (!filename) return;

		if (filename === "manifest.json") {
			try {
				copyManifest();
			} catch (error) {
				console.error("Erreur copie manifest :", error);
			}
		} else if (filename.endsWith(".css")) {
			// Debounce : éviter les rebuilds multiples sur des saves rapides
			if (cssRebuildTimer) clearTimeout(cssRebuildTimer);
			cssRebuildTimer = setTimeout(async () => {
				try {
					await bundleCSS();
				} catch (error) {
					console.error("Erreur bundle CSS :", error);
				}
			}, 80);
		}
	});

	console.log("Build en mode watch démarré.");
} else {
	await ctx.rebuild();
	deployFileToVaults("dist/main.js");
	copyManifest();
	await bundleCSS();
	await ctx.dispose();
	console.log("Build terminé.");
}
