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
import { parseHTML } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Fausse App : la surface EXACTE que l'hôte consomme, rien de plus.
    `options.adapter` complète (et peut remplacer) l'adaptateur par défaut —
    c'est ce qui permet au jeu de cas des racines de brancher ses propres
    `append`/`list`/`remove`/`rename` sans dupliquer tout le mock. */
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
		fs: ["read", "readCached", "write", "exists", "mkdirs", "append", "list", "remove", "rename", "listMarkdown", "findByName", "getFile"],
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
