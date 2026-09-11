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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { parseHTML } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Fausse App : la surface EXACTE que l'hôte consomme, rien de plus.
    `options.adapter` complète (et peut remplacer) l'adaptateur par défaut —
    c'est ce qui permet au jeu de cas des racines de brancher ses propres
    `append`/`list`/`remove`/`rename` sans dupliquer tout le mock.
    `options.vault` joue le même rôle un cran plus haut : le jeu de cas de
    l'écriture y branche `create`/`modify`/`getAbstractFileByPath`, qui doivent
    partager UN index mutable pour que « écrit » et « visible » soient deux
    choses distinctes. */
function fausseApp(fichiers, options = {}) {
	const parChemin = new Map(fichiers.map(f => [f.path, f]));
	return {
		vault: {
			// Nom de la racine (tâche 2, `paths.roots()[0].name`) : arbitraire, le
			// contrat ne le compare à rien de précis, seul son existence compte.
			getName: () => "MonVault",
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
				...(options.adapter || {}),
			},
			on: () => ({}),
			offref: () => undefined,
			...(options.vault || {}),
		},
		/* `fileManager` : la corbeille (`trashFile`) et le chemin d'une pièce
		   jointe (`getAvailablePathForAttachment`). VIDE par défaut — un groupe
		   qui n'y touche pas n'a rien à en dire, et un double posé « au cas où »
		   ferait passer pour vérifié ce que personne n'exerce. Le groupe qui les
		   éprouve branche `options.fileManager`. */
		fileManager: { ...(options.fileManager || {}) },
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
	/* Sans manifeste ici : ce groupe n'éprouve ni `legacyReviewLog` ni les
	   autres racines, réservés au groupe « fichiers et racines » plus bas. */
	const host = createObsidianHost(fausseApp(fichiers), { manifest: {} });

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
	/* « RÉSOUT puis convertit » (src/host/types.ts) : un chemin INCONNU doit
	   rendre null. L'ancienne implémentation servait
	   `adapter.getResourcePath(chemin)` sans rien vérifier et rendait donc
	   une URL parfaitement formée vers un fichier inexistant — ce qui rendait
	   morte, sous Obsidian seulement, la branche « chemin non résoluble » de
	   `src/engine/cards.ts` et faisait diverger les deux hôtes sur le même
	   appel. C'est le SEUL cas qui distingue les deux sémantiques : tous les
	   autres passent par un fichier qui existe. */
	r.check("resourceUrl d'un chemin inconnu rend null (résout, ne préfixe pas)",
		host.links.resourceUrl("Nulle/part/inexistant.png"), null);

	// readCached et read sont deux chemins distincts, pas un alias.
	r.check("readCached passe par le cache", await host.fs.readCached("Cours/ch1.md"), "cache:Cours/ch1.md");
	r.check("read passe par le disque", await host.fs.read("Cours/ch1.md"), "disque:Cours/ch1.md");

	/* Le dossier de résultats NE CHANGE PAS : les fichiers déjà écrits par les
	   versions précédentes doivent rester trouvables. `resultsDirFor` IGNORE
	   son argument côté Obsidian. */
	r.check("resultsDir reste celui du greffon", host.paths.resultsDirFor("n'importe/quoi.md"), ".obsidian/quiz-blocks-results");

	// Le contrat est complet : une méthode manquante rendrait un pan inerte.
	const attendu = {
		fs: ["read", "readCached", "write", "process", "writeBinary", "trash", "exists", "mkdirs", "append", "list", "remove", "rename", "listMarkdown", "findByName", "getFile"],
		paths: ["resultsDirFor", "attachmentPathFor", "roots", "rootOf", "localPath", "contractPath"],
		links: ["resolve", "resourceUrl"],
		watcher: ["onChange", "onRenameDir"],
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
		["isMobile", "isMacOS", "isDesktopApp", "uiLanguage"].filter(k => !(k in host.platform)), []);
	/* La VALEUR, pas seulement la clé : le bouchon `Platform` de load-src.mjs
	   décrit un Obsidian de bureau, et c'est ce que la génération IA lit pour
	   savoir si un CLI local se lance. Un `false` codé en dur, ou une lecture
	   d'un autre drapeau, laisserait la page « Générer » morte sur le bureau. */
	r.check("isDesktopApp est vrai sous un Obsidian de bureau", host.platform.isDesktopApp, true);

	/* La regex de cards.ts décide quelles URL sont DÉJÀ résolues. Un préfixe
	   oublié fait réécrire une URL bonne — et le défaut n'apparaîtrait que
	   dans l'app, à l'exécution. Rien d'autre ne le verrait. */
	const cards = readFileSync("src/engine/cards.ts", "utf8");
	const ligne = cards.split("\n").find(l => l.includes("data:") && l.includes("app:"));
	r.check("les préfixes déjà résolus couvrent les deux hôtes",
		["https?:", "data:", "app:", "asset:", "tauri:"].filter(p => !ligne?.includes(p)), []);

	r.done();
});

await withSrcModule("apps/obsidian/host.ts", async ({ createObsidianHost }) => {
	const r = makeReporter("Hôte Obsidian — fichiers et racines");

	const ecrits = [];
	const supprimes = [];
	const renommes = [];
	let existants = new Set(["journal.jsonl"]);
	const app = fausseApp([], {
		adapter: {
			append: async (p, d) => { ecrits.push([p, d]); },
			list: async (dir) => {
				if (dir === "absent") throw new Error("ENOENT");
				return { files: ["dir/a.jsonl", "dir/b.jsonl"], folders: ["dir/sous"] };
			},
			exists: async (p) => existants.has(p),
			/* Reproduit le comportement RÉEL de l'adaptateur Obsidian : `remove`
			   jette pour un chemin absent. Sans ce jet, le cas « ne lève pas »
			   restait vert même si le try/catch de l'hôte disparaissait — il ne
			   prouvait alors que la transmission du chemin, jamais la tolérance
			   annoncée (revue tâche 2, tour 1). */
			remove: async (p) => {
				if (!existants.has(p)) throw new Error("ENOENT: " + p);
				supprimes.push(p);
				existants.delete(p);
			},
			rename: async (a, b) => { renommes.push([a, b]); },
		},
	});
	const host = createObsidianHost(app, { manifest: { dir: ".obsidian/plugins/quiz-blocks" } });

	await host.fs.append("j.jsonl", "{}\n");
	r.check("append passe la donnée telle quelle", ecrits, [["j.jsonl", "{}\n"]]);

	/* Les FICHIERS seulement : rendre aussi les dossiers ferait tenter
	   l'absorption d'un dossier comme s'il était un journal de conflit. */
	r.check("list ne rend que les fichiers", await host.fs.list("dir"), ["dir/a.jsonl", "dir/b.jsonl"]);
	/* Un dossier absent est le cas NORMAL (aucun conflit Syncthing) : une
	   exception ici ferait échouer tout le chargement du journal. */
	r.check("list d'un dossier absent rend []", await host.fs.list("absent"), []);

	/* Le succès : le fichier est dans `existants`, l'adaptateur ne jette pas. */
	await host.fs.remove("journal.jsonl");
	r.check("remove d'un fichier présent le retire", supprimes, ["journal.jsonl"]);

	/* Deux fenêtres Obsidian peuvent absorber le même fichier de conflit : le
	   perdant ne doit pas lever — même si l'adaptateur SOUS-JACENT, lui, jette
	   bien pour un chemin absent (le faux `remove` ci-dessus le reproduit
	   exprès). Sans le try/catch de l'hôte, ce jet remonterait ici. */
	let removeLeve = false;
	try {
		await host.fs.remove("deja-parti.jsonl");
	} catch (e) {
		removeLeve = true;
	}
	r.check("remove d'un fichier absent ne lève pas", removeLeve, false);

	await host.fs.rename("a", "b");
	r.check("rename transmet les deux chemins", renommes, [["a", "b"]]);

	/* Garde EXPLICITE, avant même d'appeler l'adaptateur : une destination
	   déjà présente doit rejeter, sans quoi la migration du journal (tâche 3)
	   écraserait une sauvegarde `.migrated` qu'elle vient de créer. */
	existants.add("deja-la.jsonl");
	let renameRejette = false;
	try {
		await host.fs.rename("c", "deja-la.jsonl");
	} catch (e) {
		renameRejette = true;
	}
	r.check("rename rejette si la destination existe", renameRejette, true);
	r.check("rename rejette AVANT d'appeler l'adaptateur", renommes, [["a", "b"]]);

	/* UNE racine, d'identifiant VIDE, et `localPath` est l'identité : c'est
	   ce qui garantit qu'une clé de journal déjà écrite ne change pas. */
	const roots = host.paths.roots();
	r.check("une seule racine", roots.length, 1);
	r.check("son identifiant est vide", roots[0].id, "");
	r.check("le journal est à sa place fixe", roots[0].reviewLog, ".neo-quiz/review-log.jsonl");
	r.check("l'ancien journal vient du manifeste",
		roots[0].legacyReviewLog, ".obsidian/plugins/quiz-blocks/review-log.jsonl");
	r.check("localPath ne touche à rien", host.paths.localPath("Cours/reseau.md"), "Cours/reseau.md");
	r.check("contractPath ne touche à rien", host.paths.contractPath("", "Cours/reseau.md"), "Cours/reseau.md");
	/* `resultsDirFor` IGNORE son argument côté Obsidian, et doit rendre la
	   valeur historique : la changer rendrait introuvables les exports déjà
	   écrits chez l'utilisateur. */
	r.check("resultsDirFor est constant", host.paths.resultsDirFor("n'importe/quoi.md"), ".obsidian/quiz-blocks-results");

	/* Sans manifeste, il n'y a rien à migrer — et surtout pas un chemin
	   inventé, qui pointerait à côté et lirait le journal de personne. */
	const sansManifeste = createObsidianHost(app, { manifest: {} });
	r.check("sans manifeste, aucun ancien journal", sansManifeste.paths.roots()[0].legacyReviewLog, null);

	r.done();
});

await withSrcModule("apps/obsidian/host.ts", async ({ createObsidianHost }) => {
	const r = makeReporter("Hôte Obsidian — écrire et créer un dossier sans perdre l'index");

	/* DEUX états, et c'est toute la question : le DISQUE et l'INDEX du vault.
	   `vault.create` inscrit le fichier à l'index DANS L'APPEL — c'est la
	   propriété qu'on achète en passant par lui, et la seule qui permette
	   d'ouvrir une note qu'on vient d'écrire. `adapter.write` ne touche que le
	   disque : le vault ne l'apprendrait que par son surveillant, plus tard, et
	   jamais pour un dossier caché. Le double reproduit exactement ça — sans
	   cette séparation, les cas ci-dessous resteraient verts quelle que soit la
	   voie choisie. */
	const index = new Map();
	const disque = new Set();
	const journal = [];
	const inscrire = (p) => {
		index.set(p, fichier(p, p.split("/").pop().split(".").pop()));
		disque.add(p);
	};
	inscrire("Cours/ch1.md");
	// Un résultat déjà exporté : il est sur le disque, jamais à l'index.
	disque.add(".obsidian/quiz-blocks-results/latest.json");

	const app = fausseApp([], {
		adapter: {
			write: async (p, d) => { journal.push(["adapter", p, d]); disque.add(p); },
			exists: async (p) => disque.has(p),
			mkdir: async (p) => { journal.push(["mkdir", p]); disque.add(p); },
		},
		vault: {
			getAbstractFileByPath: (p) => index.get(p) ?? null,
			/* `createFolder` REJETTE une cible existante, comme `create`
			   (obsidian.d.ts : « @throws Error if folder already exists ») —
			   sans ce jet, le cas de l'idempotence resterait vert même si l'hôte
			   cessait d'avaler. Il inscrit un objet SANS `extension` : c'est à ça,
			   et non à un `instanceof`, que `asTFile` distingue un dossier d'un
			   fichier. */
			createFolder: async (p) => {
				if (disque.has(p)) throw new Error("Folder already exists: " + p);
				journal.push(["createFolder", p]);
				index.set(p, { path: p });
				disque.add(p);
			},
			/* Le vault RÉEL rejette une cible existante ; sans ce jet, le cas
			   « présent hors index » resterait vert même si l'hôte appelait
			   `create` à tort. */
			create: async (p, d) => {
				if (disque.has(p)) throw new Error("File already exists: " + p);
				journal.push(["create", p, d]);
				inscrire(p);
			},
			modify: async (f, d) => { journal.push(["modify", f.path, d]); },
		},
	});
	const host = createObsidianHost(app, { manifest: {} });

	/* LE cas de la tranche : une note neuve doit être VISIBLE de
	   `getAbstractFileByPath` dès que `write` a rendu la main. C'est ce dont
	   dépend « Nouveau quiz » (folder-create.ts), qui écrit la note puis
	   l'ouvre par son chemin. Passer par l'adaptateur fait rougir CE cas-là,
	   et lui seul le dit. */
	await host.fs.write("Cours/ch2.md", "neuf");
	r.check("une note neuve est visible de l'index aussitôt écrite",
		host.fs.getFile("Cours/ch2.md")?.path, "Cours/ch2.md");
	r.check("elle est passée par vault.create", journal, [["create", "Cours/ch2.md", "neuf"]]);

	/* Une note DÉJÀ indexée : `create` rejetterait, `write` promet de
	   remplacer. C'est `modify` qui tient la promesse. */
	await host.fs.write("Cours/ch1.md", "modifié");
	r.check("une note déjà indexée passe par vault.modify",
		journal.at(-1), ["modify", "Cours/ch1.md", "modifié"]);

	/* Les RÉSULTATS exportés vivent sous « .obsidian/ », que le vault n'indexe
	   pas : `vault.create` y échouerait, et deux ans de fichiers déjà écrits
	   deviendraient inécrivables. L'adaptateur, et lui seul. */
	await host.fs.write(".obsidian/quiz-blocks-results/2026.json", "{}");
	r.check("un chemin caché passe par l'adaptateur",
		journal.at(-1), ["adapter", ".obsidian/quiz-blocks-results/2026.json", "{}"]);
	await host.fs.write(".obsidian/quiz-blocks-results/latest.json", "{}");
	r.check("un résultat déjà là est REMPLACÉ, sans rejet",
		journal.at(-1), ["adapter", ".obsidian/quiz-blocks-results/latest.json", "{}"]);

	/* Sur le disque mais pas à l'index (écrit à l'instant hors d'Obsidian) :
	   `vault.create` rejetterait « File already exists », et `write` ne promet
	   nulle part de rejeter parce que la cible existe. */
	disque.add("Cours/externe.md");
	let aLeve = false;
	try {
		await host.fs.write("Cours/externe.md", "x");
	} catch (e) {
		aLeve = true;
	}
	r.check("un fichier présent hors index ne fait pas rejeter write", aLeve, false);
	r.check("… et il passe par l'adaptateur",
		journal.at(-1), ["adapter", "Cours/externe.md", "x"]);

	/* Un point HORS DU PREMIER segment. `estCache` teste TOUT segment, ce qui
	   n'était jusqu'ici qu'argumenté dans un commentaire — aucun cas ne
	   l'éprouvait, et un prédicat réduit à `path.startsWith(".")` serait resté
	   vert tout en envoyant ce chemin à `vault.create`, qui n'indexe rien
	   sous un dossier caché. */
	await host.fs.write("Cours/.cache/x.json", "{}");
	r.check("un point hors du premier segment prend aussi l'adaptateur",
		journal.at(-1), ["adapter", "Cours/.cache/x.json", "{}"]);

	/* ── mkdirs : le MÊME partage que write, et pour la même raison ──
	   Les deux appelants de `folder-create.ts` (import d'un zip, « Nouveau
	   quiz ») créent un dossier puis y écrivent aussitôt une note par
	   `vault.create`, qui a besoin d'un parent connu du vault. `adapter.mkdir`
	   pose le dossier sur le disque sans qu'aucun `TFolder` n'entre à
	   l'index. */
	await host.fs.mkdirs("Cours/Neuf");
	r.check("un dossier neuf est visible de l'index aussitôt créé",
		!!app.vault.getAbstractFileByPath("Cours/Neuf"), true);
	r.check("chaque segment passe par vault.createFolder",
		journal.slice(-2), [["createFolder", "Cours"], ["createFolder", "Cours/Neuf"]]);

	/* Le contrat promet l'idempotence (`mkdirs` « ne rejette pas s'il existe
	   déjà ») là où `vault.createFolder` REJETTE : c'est l'hôte qui avale, sur
	   PREUVE d'existence et non sur le texte de l'erreur. */
	let mkdirsALeve = false;
	try {
		await host.fs.mkdirs("Cours/Neuf");
	} catch (e) {
		mkdirsALeve = true;
	}
	r.check("recréer un dossier déjà là ne rejette pas", mkdirsALeve, false);

	/* Les dossiers CACHÉS restent à l'adaptateur : ni « .obsidian/
	   quiz-blocks-results » ni « .neo-quiz » ne sont indexés par le vault, et
	   `createFolder` y échouerait — les exports et le journal de révision
	   deviendraient inécrivables. */
	await host.fs.mkdirs(".obsidian/quiz-blocks-results");
	r.check("un dossier caché passe par l'adaptateur, segment par segment",
		journal.slice(-2), [["mkdir", ".obsidian"], ["mkdir", ".obsidian/quiz-blocks-results"]]);

	/* Le partage se fait sur CHAQUE PRÉFIXE, pas sur le chemin entier : dans
	   « Notes/.cache », « Notes » est un vrai dossier du vault et lui seul est
	   caché. Tester le chemin complet ferait échapper le PARENT à l'index par
	   contagion — et c'est ce cas-ci, et lui seul, qui le dirait. */
	await host.fs.mkdirs("Notes/.cache");
	r.check("le parent visible reste au vault, seul le segment caché descend à l'adaptateur",
		journal.slice(-2), [["createFolder", "Notes"], ["mkdir", "Notes/.cache"]]);

	r.done();
});

await withSrcModule("apps/obsidian/host.ts", async ({ createObsidianHost }) => {
	const r = makeReporter("Hôte Obsidian — process, octets, corbeille et pièces jointes");

	/* Le CONTENU par chemin, pas un simple drapeau « écrit » : `process` ne se
	   juge pas sur l'appel mais sur « a-t-il reçu ce qui EST là, et écrit ce que
	   le rappel a rendu ». Un double qui n'enregistrerait que l'appel laisserait
	   passer un hôte qui ignore le retour du rappel — c'est précisément le
	   défaut que `vault.process` existe pour empêcher.
	   Trois états, comme le groupe précédent : l'INDEX du vault, le TEXTE et les
	   OCTETS. Sans cette séparation, les cas ci-dessous resteraient verts quelle
	   que soit la voie choisie. */
	const index = new Map();
	const contenu = new Map();
	const octets = new Map();
	const journal = [];
	const jetes = [];
	const inscrire = (p) => index.set(p, fichier(p, p.split("/").pop().split(".").pop()));
	inscrire("Cours/ch1.md");
	contenu.set("Cours/ch1.md", "avant");
	// Le journal de révision : sur le disque, JAMAIS à l'index du vault.
	contenu.set(".neo-quiz/review-log.jsonl", "{}\n");

	const app = fausseApp([], {
		adapter: {
			read: async (p) => {
				// L'adaptateur RÉEL jette sur un chemin absent : sans ce jet, un
				// `process` qui inventerait une chaîne vide passerait inaperçu.
				if (!contenu.has(p)) throw new Error("ENOENT: " + p);
				return contenu.get(p);
			},
			write: async (p, d) => { journal.push(["adapter.write", p, d]); contenu.set(p, d); },
			writeBinary: async (p, d) => {
				journal.push(["adapter.writeBinary", p, d.byteLength]);
				octets.set(p, new Uint8Array(d));
			},
			exists: async (p) => contenu.has(p) || octets.has(p),
		},
		vault: {
			getAbstractFileByPath: (p) => index.get(p) ?? null,
			process: async (f, fn) => {
				const suivant = fn(contenu.get(f.path) ?? "");
				journal.push(["vault.process", f.path, suivant]);
				contenu.set(f.path, suivant);
				return suivant;
			},
			/* Le vault RÉEL rejette une cible existante (obsidian.d.ts :
			   « @throws Error if file already exists ») ; sans ce jet, le cas de
			   la seconde écriture resterait vert même si l'hôte appelait
			   `createBinary` à tort. */
			createBinary: async (p, d) => {
				if (octets.has(p)) throw new Error("File already exists: " + p);
				journal.push(["vault.createBinary", p, d.byteLength]);
				inscrire(p);
				octets.set(p, new Uint8Array(d));
			},
			modifyBinary: async (f, d) => {
				journal.push(["vault.modifyBinary", f.path, d.byteLength]);
				octets.set(f.path, new Uint8Array(d));
			},
		},
		fileManager: {
			trashFile: async (f) => { jetes.push(f.path); index.delete(f.path); contenu.delete(f.path); },
			/* Rend une valeur RECONNAISSABLE qui porte les deux arguments : c'est
			   ce qui permet de voir que la note citante a bien été transmise. Le
			   vrai Obsidian rend un chemin du vault ; ce qui est éprouvé ici,
			   c'est que l'hôte DÉLÈGUE sans rien recalculer. */
			getAvailablePathForAttachment: async (nom, source) => `[${source ?? "aucune"}]/${nom}`,
		},
	});
	const host = createObsidianHost(app, { manifest: {} });

	/* ── process ── */

	await host.fs.process("Cours/ch1.md", (c) => c + " + ajout");
	r.check("process passe par vault.process, et le rappel voit le contenu ACTUEL",
		journal.at(-1), ["vault.process", "Cours/ch1.md", "avant + ajout"]);
	r.check("… et c'est bien ce que le rappel rend qui est écrit",
		contenu.get("Cours/ch1.md"), "avant + ajout");

	/* Un chemin caché n'a JAMAIS de `TFile` (le vault n'indexe rien sous un
	   dossier commençant par un point) : `vault.process` y échouerait, et le
	   journal de révision comme les résultats exportés deviendraient
	   inécrivables. La lecture-écriture par l'adaptateur est la dégradation
	   assumée, et le contrat la nomme.
	   CE CAS NE GARDE AUCUNE BRANCHE, et son libellé le dit désormais :
	   `process` ne teste pas `estCache`, parce que `tfile` rend DÉJÀ `null` sous
	   un segment à point — les deux voies mènent à l'adaptateur, et il n'y a
	   rien à casser qui ferait rougir ce cas. Il CONSTATE la dégradation pour
	   qu'une tranche future ne la prenne pas pour un oubli ; la garde qui, elle,
	   se casse dans les deux sens est celle de `writeBinary`, plus bas. */
	await host.fs.process(".neo-quiz/review-log.jsonl", (c) => c + "{\"a\":1}\n");
	r.check("un chemin caché est lu puis réécrit par l'adaptateur (constat, pas garde)",
		journal.at(-1), ["adapter.write", ".neo-quiz/review-log.jsonl", "{}\n{\"a\":1}\n"]);

	/* ── writeBinary ── */

	await host.fs.writeBinary("Cours/schema.png", new Uint8Array([1, 2, 3, 4]));
	r.check("une image neuve et indexable passe par vault.createBinary",
		journal.at(-1), ["vault.createBinary", "Cours/schema.png", 4]);
	/* LE défaut que cette voie évite : une image écrite par le seul adaptateur
	   existe sur le disque sans entrer à l'index, et `getFirstLinkpathDest` ne
	   la retrouve pas — l'aperçu afficherait une image cassée juste après le
	   collage. */
	r.check("… et elle est visible de l'index aussitôt écrite",
		host.fs.getFile("Cours/schema.png")?.path, "Cours/schema.png");

	await host.fs.writeBinary("Cours/schema.png", new Uint8Array([7, 7]));
	r.check("une image déjà indexée passe par vault.modifyBinary",
		journal.at(-1), ["vault.modifyBinary", "Cours/schema.png", 2]);

	/* Une vue PARTIELLE, sur un tampon plus grand qu'elle. Un cas qui
	   vérifierait seulement que `writeBinary` a été appelé resterait VERT avec
	   `data.buffer` nu : pour un `Uint8Array` construit sur un tampon exact les
	   deux formes coïncident. C'est la LONGUEUR et le CONTENU écrits qui
	   séparent les deux — sans quoi l'image sortirait avec une queue parasite,
	   et rien ne le dirait. */
	const tampon = new ArrayBuffer(12);
	new Uint8Array(tampon).set([9, 9, 9, 9, 1, 2, 3, 4, 5, 6, 7, 8]);
	await host.fs.writeBinary("Cours/vue.png", new Uint8Array(tampon, 4, 4));
	r.check("une vue partielle n'écrit que ses octets",
		journal.at(-1), ["vault.createBinary", "Cours/vue.png", 4]);
	r.check("… et ce sont les siens, pas ceux du tampon",
		[...(octets.get("Cours/vue.png") ?? [])], [1, 2, 3, 4]);

	/* Même partage que `write` : sous un dossier caché, `vault.createBinary`
	   échouerait puisque le vault n'y indexe rien. */
	await host.fs.writeBinary(".obsidian/quiz-blocks-results/apercu.png", new Uint8Array([5]));
	r.check("un chemin caché passe par l'adaptateur, jamais par vault.createBinary",
		journal.at(-1), ["adapter.writeBinary", ".obsidian/quiz-blocks-results/apercu.png", 1]);

	/* ── trash ── */

	/* `fileManager.trashFile` et NON `vault.delete` : lui seul respecte le
	   réglage « Fichiers supprimés » de l'utilisateur. Choisir à sa place serait
	   décider qu'un quiz supprimé est irrécupérable chez quelqu'un qui a demandé
	   l'inverse. */
	await host.fs.trash("Cours/ch1.md");
	r.check("trash passe par fileManager.trashFile", jetes, ["Cours/ch1.md"]);

	/* Le contrat ne promet que l'ABSENCE au chemin donné : rejeter ferait
	   échouer une suppression que l'utilisateur voit comme réussie (même raison
	   que `remove`). */
	let trashALeve = false;
	try {
		await host.fs.trash("Cours/deja-parti.md");
	} catch (e) {
		trashALeve = true;
	}
	r.check("trash d'un fichier absent ne lève pas", trashALeve, false);
	r.check("… et n'envoie rien de plus à la corbeille", jetes, ["Cours/ch1.md"]);

	/* ── attachmentPathFor ── */

	/* Obsidian DÉCIDE : le réglage « dossier des pièces jointes » a des modes
	   relatifs à la note (« ./ », « ./images ») que recalculer ici rangerait
	   l'image ailleurs que là où l'utilisateur l'a demandé. La note citante doit
	   donc arriver jusqu'à lui — sans elle, Obsidian retombe sur le fichier
	   ACTIF, qui n'est pas forcément le quiz qu'on édite.
	   Ce que ce cas NE garde PAS : la LIBERTÉ du chemin rendu. Côté Obsidian
	   c'est `getAvailablePathForAttachment` qui déduplique, pas l'hôte — il n'y
	   a ici aucune règle de notre cru à casser. C'est l'hôte Windows qui porte
	   ce cas-là (`check:windows-host`). */
	r.check("attachmentPathFor laisse Obsidian décider, et lui passe la note citante",
		await host.paths.attachmentPathFor("Pasted image 1.png", "Cours/ch1.md"),
		"[Cours/ch1.md]/Pasted image 1.png");
	/* Sans note (quiz généré, encore en mémoire) : l'argument reste optionnel et
	   n'est pas remplacé par une valeur inventée.
	   C'est ici que les deux hôtes DIVERGENT, et le contrat (`HostPaths`) le dit
	   plutôt que de promettre une conduite commune : Obsidian a un fichier ACTIF
	   sur quoi retomber, la fenêtre n'en a pas et REJETTE — l'autre moitié de
	   cette paire est « sans note d'accueil, la fenêtre rejette en nommant la
	   cause » (`check:windows-host`). Les deux cas bougent ENSEMBLE : si un hôte
	   change d'avis, c'est le contrat qu'il faut rouvrir d'abord. */
	r.check("sans note citante, rien n'est inventé à sa place",
		await host.paths.attachmentPathFor("Pasted image 2.png"),
		"[aucune]/Pasted image 2.png");

	r.done();
});

/**
 * Installe le DOM que la modale d'Obsidian suppose, et rend de quoi le retirer.
 *
 * Deux emprunts au monde réel, pas des commodités :
 * — les EXTENSIONS DOM d'Obsidian (`addClass`, `setText`, `empty`) n'existent
 *   ni dans Node ni dans linkedom, mais elles existent bel et bien dans
 *   Obsidian, et `QbdModal` comme l'hôte s'en servent — les poser sur chaque
 *   élément créé est la façon la plus étroite de reproduire l'environnement ;
 * — `window.setTimeout` est CAPTURÉ au lieu d'être exécuté. C'est le filet de
 *   sécurité de `QbdModal.close()` : le retenir permet d'observer l'état
 *   PENDANT l'animation de sortie, seul moment où l'on peut prouver que
 *   `onClose` n'a pas encore été appelé. `matchMedia` rend `matches: false`
 *   pour éprouver le chemin ANIMÉ, celui qu'Obsidian prend réellement.
 */
function installerDom() {
	const precedentDocument = globalThis.document;
	const precedentWindow = globalThis.window;
	const { document } = parseHTML("<!doctype html><html><body></body></html>");
	const creerElement = document.createElement.bind(document);
	document.createElement = (tag) => {
		const el = creerElement(tag);
		el.addClass = (c) => el.classList.add(c);
		el.removeClass = (c) => el.classList.remove(c);
		el.setText = (txt) => { el.textContent = txt; };
		el.empty = () => { while (el.firstChild) el.removeChild(el.firstChild); };
		return el;
	};
	const minuteurs = [];
	globalThis.document = document;
	globalThis.window = {
		matchMedia: () => ({ matches: false }),
		setTimeout: (fn) => minuteurs.push(fn),
	};
	return {
		document,
		minuteurs,
		retirer() {
			if (precedentDocument === undefined) delete globalThis.document;
			else globalThis.document = precedentDocument;
			if (precedentWindow === undefined) delete globalThis.window;
			else globalThis.window = precedentWindow;
		},
	};
}

await withSrcModule("apps/obsidian/host.ts", async ({ createObsidianHost }) => {
	const r = makeReporter("Hôte Obsidian — modales et icônes");
	const dom = installerDom();

	try {
		const host = createObsidianHost(fausseApp([]), { manifest: {} });

		/* Le journal des moments, dans l'ORDRE : c'est lui qui distingue « appelé »
		   de « appelé au bon moment ». */
		const journal = [];
		let panneau = null;
		let attacheQuandOnCloseArrive = null;

		const poignee = host.modals.open({
			className: "qbd-medit-modal",
			title: "Modifier dossier",
			onOpen: (h) => {
				journal.push("onOpen");
				panneau = h.panelEl;
				h.contentEl.appendChild(document.createElement("p"));
			},
			onClose: () => {
				journal.push("onClose");
				attacheQuandOnCloseArrive = document.body.contains(panneau);
			},
		});

		/* La classe va sur le PANNEAU : c'est elle que cible le CSS partagé
		   (`.qbd-medit-modal { width: 475px }`). Posée ailleurs, la modale
		   s'ouvrirait à une largeur quelconque sans qu'aucune erreur ne le dise. */
		r.check("open pose la classe du spec sur le panneau",
			poignee.panelEl.classList.contains("qbd-medit-modal"), true);
		r.check("le panneau garde aussi le marqueur d'animation de QbdModal",
			poignee.panelEl.classList.contains("qbd-anim-modal"), true);
		/* Rend le cas suivant NON TRIVIAL : sans cette ligne, un panneau jamais
		   attaché ferait passer « onClose après le détachement » par accident. */
		r.check("le panneau est attaché quand onOpen construit le contenu",
			document.body.contains(poignee.panelEl), true);
		r.check("onOpen n'est appelé qu'une fois, et à l'ouverture", journal, ["onOpen"]);

		/* Échap et le clic sur le fond peuvent tomber quasi ensemble : deux
		   fermetures ne doivent produire qu'une disparition. */
		let aLeve = false;
		try {
			poignee.close();
			poignee.close();
		} catch (e) {
			aLeve = true;
		}
		r.check("fermer deux fois ne lève pas", aLeve, false);
		r.check("une seule disparition est programmée", dom.minuteurs.length, 1);
		/* PENDANT l'animation de sortie : le panneau est encore là, et l'écriture
		   différée de `module-edit.ts` ne doit pas avoir eu lieu. */
		r.check("onClose n'est pas appelé pendant l'animation de sortie", journal, ["onOpen"]);

		for (const fn of dom.minuteurs.splice(0)) fn();

		r.check("fermer deux fois n'appelle onClose qu'une fois", journal, ["onOpen", "onClose"]);
		r.check("onClose est appelé APRÈS le détachement du panneau",
			attacheQuandOnCloseArrive, false);
		/* Un corps non vidé empilerait deux contenus à la réouverture. */
		r.check("le corps est vidé à la fermeture", poignee.contentEl.childNodes.length, 0);

		/* `getIconIds()` rend « lucide-x » ; le contrat veut « x ». Le préfixe est
		   retiré par l'hôte et par personne d'autre. */
		const noms = host.ui.iconNames();
		r.check("iconNames ne laisse aucun préfixe lucide-",
			noms.filter(n => n.startsWith("lucide-")), []);
		/* Une VALEUR NOMMÉE, pas seulement « la liste n'est pas vide » : c'est le
		   seul cas qui rougirait si le préfixe restait collé. */
		r.check("iconNames contient chevron-down", noms.includes("chevron-down"), true);
	} finally {
		dom.retirer();
	}

	r.done();
});

/**
 * LA FRAÎCHEUR APRÈS UNE ÉCRITURE, moitié GREFFON.
 *
 * Le contrat (`src/host/types.ts`) promet que `getFile(path)` rend le `mtime`
 * NEUF dès que `write`, `process`, `writeBinary` ou `append` ont rendu la main.
 * Cette moitié-ci tenait la promesse SANS LE SAVOIR pour trois des quatre
 * voies : `getFile` refabrique son `HostFile` à chaque appel depuis un `TFile`
 * VIVANT qu'Obsidian met à jour en place. Deux choses en découlent, et ce sont
 * les deux que ce groupe garde :
 *
 * 1. la fraîcheur repose sur le fait que `getFile` ne MÉMORISE rien. Le jour où
 *    quelqu'un l'« optimiserait » par un cache, elle disparaîtrait sans qu'une
 *    seule ligne de type ne bronche ;
 * 2. `append` ne la tenait PAS. Il passait par le seul ADAPTATEUR, qui écrit
 *    sur le disque sans que le vault en sache rien — le `TFile` gardait son
 *    ancien `mtime`. Une promesse qui saute une des quatre écritures est un
 *    piège pire que pas de promesse, d'où `vault.append` pour les chemins
 *    indexés (@since 0.13.0, très en dessous du minAppVersion déclaré).
 *
 * Le double reproduit la mise à jour EN PLACE du `TFile` — c'est le
 * comportement réel d'Obsidian, celui dont l'ancien `detail-io.ts` dépendait
 * déjà (`file.stat.mtime` relu après `vault.process`). Un double qui ne
 * bougerait pas rendrait tout ce groupe vert par construction.
 */
await withSrcModule("apps/obsidian/host.ts", async ({ createObsidianHost }) => {
	const r = makeReporter("Hôte Obsidian — la fraîcheur après une écriture");

	const index = new Map();
	const disque = new Map();
	const journal = [];
	let horloge = 1000;
	/** Ce que le vault fait d'une écriture : le contenu, ET la date du `TFile`,
	    mise à jour EN PLACE sur l'objet que l'index rend déjà. */
	const toucher = (f, contenu) => {
		horloge += 5000;
		f.stat.mtime = horloge;
		disque.set(f.path, contenu);
	};
	const inscrire = (p) => {
		const nom = p.split("/").pop();
		const f = {
			path: p, name: nom,
			basename: nom.replace(/\.[^.]+$/, ""),
			extension: nom.includes(".") ? nom.split(".").pop() : "",
			stat: { mtime: 1000 },
		};
		index.set(p, f);
		disque.set(p, "avant");
		return f;
	};
	const note = inscrire("Cours/ch1.md");
	// Le journal de révision : sur le disque, JAMAIS à l'index (dossier caché).
	disque.set(".neo-quiz/review-log.jsonl", "{}\n");

	const app = fausseApp([], {
		adapter: {
			read: async (p) => disque.get(p) ?? "",
			write: async (p, d) => { journal.push(["adapter.write", p]); disque.set(p, d); },
			append: async (p, d) => { journal.push(["adapter.append", p]); disque.set(p, (disque.get(p) ?? "") + d); },
			exists: async (p) => disque.has(p),
		},
		vault: {
			getAbstractFileByPath: (p) => index.get(p) ?? null,
			read: async (f) => disque.get(f.path) ?? "",
			modify: async (f, d) => { journal.push(["vault.modify", f.path]); toucher(f, d); },
			process: async (f, mutate) => {
				journal.push(["vault.process", f.path]);
				toucher(f, mutate(disque.get(f.path) ?? ""));
			},
			modifyBinary: async (f) => { journal.push(["vault.modifyBinary", f.path]); toucher(f, "octets"); },
			append: async (f, d) => {
				journal.push(["vault.append", f.path]);
				toucher(f, (disque.get(f.path) ?? "") + d);
			},
			create: async (p, d) => { journal.push(["vault.create", p]); const f = inscrire(p); toucher(f, d); return f; },
			createBinary: async (p) => { journal.push(["vault.createBinary", p]); const f = inscrire(p); toucher(f, "octets"); return f; },
		},
	});
	const host = createObsidianHost(app, { manifest: {} });
	const mtime = (p) => host.fs.getFile(p)?.mtime ?? null;

	r.check("avant toute écriture, getFile rend la date du TFile", mtime("Cours/ch1.md"), 1000);

	/* `process` — celui dont dépend `detail-io.ts`, qui relit ce `mtime` juste
	   après pour que sa propre écriture ne passe pas pour une modification
	   EXTERNE au rendu suivant. */
	await host.fs.process("Cours/ch1.md", (c) => c + " + ajout");
	r.check("après process, getFile rend le mtime NEUF", mtime("Cours/ch1.md"), note.stat.mtime);
	r.check("… et ce n'est plus celui d'avant", mtime("Cours/ch1.md") === 1000, false);

	const avantWrite = mtime("Cours/ch1.md");
	await host.fs.write("Cours/ch1.md", "remplacé");
	r.check("après write, le mtime a avancé", mtime("Cours/ch1.md") > avantWrite, true);

	await host.fs.writeBinary("Cours/img.png", new Uint8Array([1, 2, 3]));
	r.check("après writeBinary d'un fichier neuf, il est au catalogue avec sa date",
		mtime("Cours/img.png"), index.get("Cours/img.png").stat.mtime);

	/* `append`, LA voie qui trahissait. Elle passe désormais par le vault quand
	   le chemin est indexé — sinon le `TFile` gardait son ancienne date. */
	const avantAppend = mtime("Cours/ch1.md");
	await host.fs.append("Cours/ch1.md", " et encore");
	r.check("append d'un chemin INDEXÉ passe par le vault",
		journal.at(-1), ["vault.append", "Cours/ch1.md"]);
	r.check("après append, le mtime a avancé", mtime("Cours/ch1.md") > avantAppend, true);
	r.check("… et l'ajout n'a pas remplacé le contenu",
		disque.get("Cours/ch1.md"), "remplacé et encore");

	/* Le SEUL appelant d'aujourd'hui écrit sous `.neo-quiz/`, que le vault
	   n'indexe pas : il doit rester sur l'adaptateur, dont l'ajout ATOMIQUE est
	   la propriété pour laquelle cette méthode existe. Sa conduite ne change
	   pas d'un octet. */
	await host.fs.append(".neo-quiz/review-log.jsonl", "{}\n");
	r.check("append d'un chemin CACHÉ reste sur l'adaptateur",
		journal.at(-1), ["adapter.append", ".neo-quiz/review-log.jsonl"]);
	r.check("… et il a bien AJOUTÉ, pas remplacé",
		disque.get(".neo-quiz/review-log.jsonl"), "{}\n{}\n");
	r.check("… et il n'est pas entré au catalogue",
		host.fs.getFile(".neo-quiz/review-log.jsonl"), null);

	/* La fraîcheur tient parce que `getFile` NE MÉMORISE RIEN : il relit le
	   `TFile` à chaque appel. Deux lectures encadrant une écriture faite hors
	   du contrat (comme le fait Obsidian lui-même quand l'utilisateur tape dans
	   l'éditeur markdown) doivent donc différer — c'est aussi ce qui permet à
	   `draftIsStale` de voir une modification EXTERNE. */
	const avantDehors = mtime("Cours/ch1.md");
	note.stat.mtime = 99999;
	r.check("getFile ne mémorise pas : une modification externe se voit",
		[mtime("Cours/ch1.md"), mtime("Cours/ch1.md") === avantDehors], [99999, false]);

	r.done();
});

/**
 * LE RÉSEAU sous Obsidian : `HostNet.fetchJson` passe par `requestUrl`, et le
 * bouchon de load-src.mjs délègue à `globalThis.__obsidianRequestUrl` le temps
 * du groupe. Ce qui est éprouvé, c'est la TRADUCTION — l'URL, la méthode, les
 * en-têtes et le corps arrivent intacts, `throw: false` est posé — et la
 * promesse du contrat que `requestUrl` ne tient pas par défaut : un statut
 * d'erreur est RENDU avec son corps (Ollama y met son diagnostic), et seul un
 * rejet vaut `null`.
 */
await withSrcModule("apps/obsidian/host.ts", async ({ createObsidianHost }) => {
	const r = makeReporter("Hôte Obsidian — réseau");
	const host = createObsidianHost(fausseApp([]), { manifest: {} });
	const recus = [];
	globalThis.__obsidianRequestUrl = async (params) => {
		recus.push(params);
		if (params.url.endsWith("/erreur")) return { status: 500, text: '{"error":"model not found"}' };
		if (params.url.endsWith("/panne")) throw new Error("net::ERR_CONNECTION_REFUSED");
		return { status: 200, text: "ok" };
	};
	try {
		const reponse = await host.net.fetchJson({
			url: "http://localhost:11434/api/generate",
			method: "POST",
			headers: { "content-type": "application/json" },
			body: '{"model":"llama3"}',
		});
		/* `throw: false` est LA ligne qui compte : sans elle, `requestUrl` jette
		   sur un 4xx/5xx et le corps — le diagnostic — est perdu. Le double ne
		   jette pas lui-même sur un statut d'erreur, donc c'est le PARAMÈTRE
		   qu'on lit, pas la conduite. */
		r.check("fetchJson traverse requestUrl avec l'URL, la méthode, les en-têtes et le corps intacts, et throw:false",
			recus[0],
			{
				url: "http://localhost:11434/api/generate",
				method: "POST",
				headers: { "content-type": "application/json" },
				body: '{"model":"llama3"}',
				throw: false,
			});
		r.check("la réponse est rendue { status, body } à partir de resp.text", reponse, { status: 200, body: "ok" });
		r.check("un statut 500 est RENDU avec son corps, jamais null",
			await host.net.fetchJson({ url: "http://localhost:11434/erreur" }),
			{ status: 500, body: '{"error":"model not found"}' });
		/* Un rejet de `requestUrl` (hôte injoignable) vaut `null`, jamais une
		   exception qui remonterait dans la page « Générer ». Le `warn` est
		   avalé : il fait partie de la conduite, pas du rapport. */
		const avertir = console.warn;
		console.warn = () => {};
		let panne;
		try {
			panne = await host.net.fetchJson({ url: "http://localhost:11434/panne" });
		} catch (e) {
			panne = "EXCEPTION: " + e.message;
		} finally {
			console.warn = avertir;
		}
		r.check("un rejet de requestUrl rend null sans lever", panne, null);
		/* La méthode par défaut est GET, écrite en toutes lettres : `requestUrl`
		   la déduit sinon, et le contrat ne veut rien devoir à une déduction. */
		await host.net.fetchJson({ url: "http://localhost:11434/api/tags" });
		r.check("sans méthode, GET est posé explicitement", recus[recus.length - 1].method, "GET");
	} finally {
		delete globalThis.__obsidianRequestUrl;
	}
	r.done();
});

/**
 * LES CLI sous Obsidian : `HostProcess`, où vit désormais tout ce que
 * `src/dashboard/ai-providers.ts` faisait en `require("fs"|"os"|"path"|
 * "child_process")`. Deux choses sont éprouvées, et elles ont chacune coûté
 * un défaut ailleurs :
 *
 * — `lireCache("codex")` honore `$CODEX_HOME`. C'est l'override que le CLI
 *   Codex honore lui-même : l'ignorer ferait lire le cache d'une AUTRE
 *   installation que celle qui répond, et la liste de modèles mentirait sans
 *   qu'aucune erreur ne le dise ;
 * — `run` écrit le stdin COMPLET puis le FERME (un CLI dont l'entrée reste
 *   ouverte attend indéfiniment), rend `stdout` et `stderr` SÉPARÉS (les
 *   concaténer rendrait illisible la sortie JSON d'un CLI qui avertit), et
 *   rejette `introuvable` sur un exécutable absent — ce que
 *   `checkClaudeCode` traduit en « non installé ».
 *
 * Le CLI éprouvé est `process.execPath` (Node lui-même) : le seul exécutable
 * dont on soit sûr qu'il existe sur la machine qui lance ce contrôle. Comme
 * `run` n'accepte qu'un NOM de sa liste blanche, le test passe par un
 * `PATH` bricolé — voir `avecFauxCli`.
 */
await withSrcModule("apps/obsidian/host.ts", async ({ createObsidianHost }) => {
	const r = makeReporter("Hôte Obsidian — les CLI");
	const host = createObsidianHost(fausseApp([]), { manifest: {} });

	/* Un dossier temporaire qui contient un faux `codex` : un script Node,
	   plus un lanceur du nom que la liste blanche autorise. `buildChildEnv`
	   AJOUTE au PATH du processus sans le remplacer, donc poser le dossier en
	   tête de `process.env.PATH` suffit à ce que le lancement tombe sur le
	   nôtre.

	   POURQUOI `codex` ET PAS `claude` : sur la machine qui écrit ce contrôle,
	   `claude.exe` existe pour de bon dans `~/.local/bin`, que `buildChildEnv`
	   ajoute au PATH — le premier jet de ce cas a donc lancé le VRAI Claude
	   Code, et attendu sa réponse. Le nom éprouvé doit être celui que RIEN
	   d'autre que nous ne résout. */
	function avecFauxCli(corps, executer) {
		const dossier = mkdtempSync(join(tmpdir(), "quiz-cli-"));
		const script = join(dossier, "faux.js");
		writeFileSync(script, corps);
		/* Sous Windows, `spawn` ne lance qu'un `.exe` : un `.cmd` est le seul
		   lanceur qu'on puisse poser à la main — et c'est EXACTEMENT le cas
		   que le repli par `cmd.exe` de l'hôte existe pour servir (une
		   installation npm de `codex` est un `codex.cmd`). Ailleurs, un script
		   shell exécutable, lancé par le chemin DIRECT : les deux chemins de
		   `lancerCli` sont donc éprouvés, un par système. */
		if (process.platform === "win32") {
			writeFileSync(join(dossier, "codex.cmd"),
				'@echo off\r\n"' + process.execPath + '" "' + script + '" %*\r\n');
		} else {
			writeFileSync(join(dossier, "codex"),
				'#!/bin/sh\nexec "' + process.execPath + '" "' + script + '" "$@"\n', { mode: 0o755 });
		}
		const avant = process.env.PATH;
		process.env.PATH = dossier + delimiter + avant;
		return (async () => {
			try {
				return await executer();
			} finally {
				process.env.PATH = avant;
				rmSync(dossier, { recursive: true, force: true });
			}
		})();
	}

	/* ── lireCache ── */
	const maison = mkdtempSync(join(tmpdir(), "quiz-codex-"));
	mkdirSync(join(maison, "cache"), { recursive: true });
	writeFileSync(join(maison, "cache", "models_cache.json"), '{"models":[{"slug":"gpt-test"}]}');
	const codexHomeAvant = process.env.CODEX_HOME;
	process.env.CODEX_HOME = join(maison, "cache");
	try {
		/* `lire` ATTRAPE : sans ça, un `lireCache` qui laisserait remonter son
		   exception (la rupture « pas de catch ») tuerait le script au lieu de
		   rougir sous son nom — et une mort en route masque tous les cas
		   suivants, ce que ce dépôt a déjà payé une fois. */
		const lire = async (outil) => {
			try {
				return await host.process.lireCache(outil);
			} catch (e) {
				return "EXCEPTION: " + (e && e.message ? e.message : String(e));
			}
		};
		const cache = await lire("codex");
		r.check("lireCache(\"codex\") lit $CODEX_HOME/models_cache.json",
			{ json: cache && cache.json, date: !!(cache && typeof cache.mtimeMs === "number") },
			{ json: { models: [{ slug: "gpt-test" }] }, date: true });
		/* Un fichier absent n'est PAS une erreur : une machine sans Codex est
		   un état normal, et le code partagé retombe sur son repli embarqué. */
		process.env.CODEX_HOME = join(maison, "vide");
		r.check("un cache absent rend null, sans lever", await lire("codex"), null);
	} finally {
		if (codexHomeAvant === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = codexHomeAvant;
		rmSync(maison, { recursive: true, force: true });
	}

	/* ── run ── */
	await avecFauxCli(
		[
			"let entree = '';",
			"process.stdin.on('data', d => { entree += d; });",
			"process.stdin.on('end', () => {",
			"  process.stdout.write('OUT:' + entree.length + ':' + process.argv.slice(2).join(','));",
			"  process.stderr.write('ERR:diagnostic');",
			"  process.exit(7);",
			"});",
		].join("\n"),
		async () => {
			const prompt = "x".repeat(5000);
			const res = await host.process.run({ tool: "codex", args: ["-p", "--model", "opus"], stdin: prompt });
			/* Le stdin COMPLET, puis FERMÉ : sans le `end()`, le faux CLI
			   n'atteindrait jamais son `'end'` et `run` n'aboutirait pas —
			   le cas expirerait au lieu de rougir, mais il rougirait aussi
			   sur la longueur si une partie du prompt était perdue. */
			r.check("run écrit le stdin complet puis le ferme, et passe les arguments",
				res.stdout, "OUT:5000:-p,--model,opus");
			r.check("stdout et stderr sont rendus séparés, avec le code de sortie",
				{ stderr: res.stderr, code: res.code }, { stderr: "ERR:diagnostic", code: 7 });
		},
	);

	/* Un exécutable ABSENT : c'est le rejet que `checkClaudeCode` traduit en
	   « non installé », et un rejet ANONYME ferait chercher une panne. Le PATH
	   est vidé le temps du cas, et les variables dont `buildChildEnv` compose
	   ses chemins en dur pointent vers un dossier vide.
	   RÉSIDUEL, écrit plutôt que découvert : `buildChildEnv` ajoute AUSSI
	   `~/.local/bin`, `/opt/homebrew/bin` et `/usr/local/bin`, que rien ici ne
	   peut détourner (`os.homedir()` ignore `HOME` sous Windows). Une machine
	   qui aurait `codex` dans l'un de ces trois-là verrait ce cas rouge — un
	   faux rouge, bruyant et expliqué ici, jamais un faux vert. */
	const vide = mkdtempSync(join(tmpdir(), "quiz-vide-"));
	const envAvant = {
		PATH: process.env.PATH,
		APPDATA: process.env.APPDATA,
		LOCALAPPDATA: process.env.LOCALAPPDATA,
		CODEX_INSTALL_DIR: process.env.CODEX_INSTALL_DIR,
	};
	let nom = "(aucun rejet)";
	try {
		process.env.PATH = vide;
		process.env.APPDATA = vide;
		process.env.LOCALAPPDATA = vide;
		process.env.CODEX_INSTALL_DIR = vide;
		await host.process.run({ tool: "codex", args: ["--version"], stdin: "" });
	} catch (e) {
		nom = e.name;
	} finally {
		for (const [cle, valeur] of Object.entries(envAvant)) {
			if (valeur === undefined) delete process.env[cle];
			else process.env[cle] = valeur;
		}
		rmSync(vide, { recursive: true, force: true });
	}
	r.check("un exécutable absent rejette « introuvable »", nom, "introuvable");

	/* La liste blanche est jugée AVANT tout lancement : c'est elle, et non le
	   périmètre des chemins, qui sépare « lancer le CLI de l'utilisateur » de
	   « lancer ce qu'on vient d'écrire sur son disque ». */
	let hors = "(aucun rejet)";
	try {
		await host.process.run({ tool: "notepad", args: [], stdin: "" });
	} catch (e) {
		hors = e.name;
	}
	r.check("un outil hors liste blanche est refusé, sans rien lancer", hors, "refuse");

	r.done();
});
