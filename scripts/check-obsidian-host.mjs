/**
 * Vérification de l'HÔTE OBSIDIAN.
 *
 * L'hôte est la seule pièce que le moteur ne pourra plus contourner : une
 * méthode qui renvoie silencieusement `null` rendrait les images, le bouton
 * ressource ou la sauvegarde inertes sans un mot. On le charge donc avec le
 * bouchon `obsidian` de load-src.mjs et une fausse `App`, comme
 * check-scanner.mjs le fait déjà.
 *
 *     npm run check:obsidian-host
 */
import { readFileSync } from "node:fs";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Fausse App : la surface EXACTE que l'hôte consomme, rien de plus. */
function fausseApp(fichiers) {
	const parChemin = new Map(fichiers.map(f => [f.path, f]));
	return {
		vault: {
			getMarkdownFiles: () => fichiers.filter(f => f.extension === "md"),
			getFiles: () => fichiers,
			getAbstractFileByPath: (p) => parChemin.get(p) ?? null,
			cachedRead: async (f) => "cache:" + f.path,
			read: async (f) => "disque:" + f.path,
			getResourcePath: (f) => "app://vault/" + f.path,
			adapter: {
				read: async (p) => "disque:" + p,
				write: async () => undefined,
				exists: async (p) => parChemin.has(p),
				mkdir: async () => undefined,
				getResourcePath: (p) => "app://vault/" + p,
			},
			on: () => ({}),
			offref: () => undefined,
		},
		metadataCache: {
			getFirstLinkpathDest: (lien) => parChemin.get(lien + ".md") ?? null,
		},
		workspace: { getLeavesOfType: () => [], getLeaf: () => null },
	};
}

const fichier = (path, extension) => ({
	path,
	name: path.split("/").pop(),
	basename: path.split("/").pop().replace(/\.[^.]+$/, ""),
	extension,
	stat: { mtime: 42 },
});

await withSrcModule("apps/obsidian/host.ts", async ({ createObsidianHost }) => {
	const r = makeReporter("Hôte Obsidian");
	const fichiers = [
		fichier("Cours/ch1.md", "md"),
		fichier("Images/schema.png", "png"),
		fichier("Autre/schema.png", "png"),
	];
	/* Un seul paramètre : l'hôte ne dépend PAS du greffon. Le `plugin` du
	   brief a été retiré (décision R2) — aucun sous-contrat n'en a besoin, et
	   un paramètre inutilisé donnerait à croire le contraire. */
	const host = createObsidianHost(fausseApp(fichiers));

	/* HostFile est PLAT et sérialisable : un TFile ne doit jamais fuir dans le
	   code partagé, sinon Windows devra fabriquer un faux TFile. */
	const converti = host.fs.getFile("Cours/ch1.md");
	r.check("un TFile se réduit exactement à un HostFile",
		converti,
		{ path: "Cours/ch1.md", name: "ch1.md", basename: "ch1", extension: "md", mtime: 42 });
	r.check("aucune méthode ne survit à la conversion",
		Object.values(converti).every(v => typeof v !== "function" && typeof v !== "object"), true);

	// L'index ne rend QUE les markdown : le scanner balaie dessus.
	r.check("listMarkdown ne renvoie que les .md",
		host.fs.listMarkdown().map(f => f.path), ["Cours/ch1.md"]);

	/* findByName renvoie TOUS les homonymes : engine/resources.ts prévient
	   l'utilisateur quand il y en a plusieurs. N'en rendre qu'un ferait
	   disparaître l'avertissement sans que rien ne le signale. */
	r.check("findByName rend tous les homonymes, casse ignorée",
		host.fs.findByName("SCHEMA.PNG").map(f => f.path),
		["Images/schema.png", "Autre/schema.png"]);
	r.check("findByName sur un nom absent rend une liste vide",
		host.fs.findByName("absent.png"), []);

	// La résolution de wikilink passe par le metadataCache, pas par le chemin nu.
	r.check("resolve suit le metadataCache",
		host.links.resolve("Cours/ch1", "note.md")?.path, "Cours/ch1.md");
	r.check("resolve rend null plutôt qu'un objet vide",
		host.links.resolve("introuvable", "note.md"), null);

	/* resourceUrl rend null, JAMAIS la chaîne vide : `src=""` fait recharger
	   la page courante comme image. */
	r.check("resourceUrl d'un HostFile", host.links.resourceUrl(converti), "app://vault/Cours/ch1.md");
	r.check("resourceUrl accepte aussi un chemin", host.links.resourceUrl("Images/schema.png"), "app://vault/Images/schema.png");
	/* Ces deux cas-ci sont les SEULS à éprouver la règle « null, jamais "" » :
	   les deux précédents passent par le chemin qui réussit, où rendre `""` au
	   lieu de `null` ne se verrait pas. Un HostFile dont le fichier a disparu
	   (quiz rendu, puis note supprimée) et un chemin vide sont les deux façons
	   dont l'appelant obtient « rien ». */
	r.check("resourceUrl d'un HostFile disparu rend null, pas \"\"",
		host.links.resourceUrl(fichier("Absent/parti.png", "png")), null);
	r.check("resourceUrl d'un chemin vide rend null, pas \"\"",
		host.links.resourceUrl("   "), null);

	// readCached et read sont deux chemins distincts, pas un alias.
	r.check("readCached passe par le cache", await host.fs.readCached("Cours/ch1.md"), "cache:Cours/ch1.md");
	r.check("read passe par le disque", await host.fs.read("Cours/ch1.md"), "disque:Cours/ch1.md");

	/* Le dossier de résultats NE CHANGE PAS : les fichiers déjà écrits par les
	   versions précédentes doivent rester trouvables. */
	r.check("resultsDir reste celui du greffon", host.paths.resultsDir, ".obsidian/quiz-blocks-results");

	// Le contrat est complet : une méthode manquante rendrait un pan inerte.
	const attendu = {
		fs: ["read", "readCached", "write", "exists", "mkdirs", "listMarkdown", "findByName", "getFile"],
		links: ["resolve", "resourceUrl"],
		watcher: ["onChange"],
		ui: ["notice", "setIcon"],
		math: ["ready", "render", "flush"],
		shell: ["openExternal", "revealInHost"],
	};
	const manquantes = [];
	for (const [zone, noms] of Object.entries(attendu)) {
		for (const nom of noms) if (typeof host[zone]?.[nom] !== "function") manquantes.push(zone + "." + nom);
	}
	r.check("aucune méthode du contrat ne manque", manquantes, []);
	r.check("platform est renseigné",
		["isMobile", "isMacOS", "uiLanguage"].filter(k => !(k in host.platform)), []);

	/* La regex de cards.ts décide quelles URL sont DÉJÀ résolues. Un préfixe
	   oublié fait réécrire une URL bonne — et le défaut n'apparaîtrait que
	   dans l'app, à l'exécution. Rien d'autre ne le verrait. */
	const cards = readFileSync("src/engine/cards.ts", "utf8");
	const ligne = cards.split("\n").find(l => l.includes("data:") && l.includes("app:"));
	r.check("les préfixes déjà résolus couvrent les deux hôtes",
		["https?:", "data:", "app:", "asset:", "tauri:"].filter(p => !ligne?.includes(p)), []);

	r.done();
});
