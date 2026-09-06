/**
 * Vérification de l'INDEX et de la RÉSOLUTION DE LIENS de l'hôte Windows.
 *
 * L'index est la seule pièce de l'hôte Windows qui soit du code pur : c'est
 * lui qui rend `listMarkdown`, `findByName` et `getFile` synchrones, donc lui
 * qui doit rester juste après un renommage ou une suppression. Un index qui
 * dérive ne produit pas d'erreur : il fait disparaître des quiz du catalogue.
 *
 * Depuis la tâche 6, l'hôte est COMPOSITE : les chemins du contrat portent un
 * premier segment qui nomme la racine (`apps/windows/src/host/roots.ts`,
 * `CarteRacines`). Un groupe dédié éprouve cette carte, PURE, indépendamment
 * de tout le reste ; les groupes « liens » qui suivent la consomment comme un
 * appelant réel le ferait.
 *
 * Le reste de l'hôte (sélecteur, protocole d'asset, toasts, MathLive) n'existe
 * que dans la fenêtre : il se vérifie à la main, et la tâche dit comment. Les
 * modules chargés ici IMPORTENT Tauri au niveau module — c'est sans danger,
 * rien ne s'exécute au chargement. Une SEULE fonction Tauri est appelée, dans
 * les groupes « resourceUrl », et derrière un double de
 * `window.__TAURI_INTERNALS__` : la fabrication d'URL de `convertFileSrc`. Ces
 * groupes éprouvent la RÉSOLUTION qui la précède, pas la conversion elle-même.
 *
 *     npm run check:windows-host
 */
import { Event, parseHTML } from "linkedom";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const f = (path, extension, mtime = 1) => ({
	path,
	name: path.split("/").pop(),
	basename: path.split("/").pop().replace(/\.[^.]+$/, ""),
	extension,
	mtime,
});

await withSrcModule("apps/windows/src/host/fs.ts", async ({ buildIndex }) => {
	const r = makeReporter("Hôte Windows — index");
	const idx = buildIndex([
		f("Cours/reseau.md", "md"),
		f("Cours/Images/schema.png", "png"),
		f("Autre/schema.png", "png"),
		f("notes.txt", "txt"),
	]);

	r.check("listMarkdown ne rend que les .md",
		idx.all().filter(x => x.extension === "md").map(x => x.path), ["Cours/reseau.md"]);
	r.check("get par chemin", idx.get("Autre/schema.png")?.name, "schema.png");
	r.check("get d'un chemin inconnu rend null", idx.get("absent.md"), null);

	/* Un renommage doit RETIRER l'ancien chemin. Le garder laisserait un quiz
	   fantôme au catalogue, que plus aucun fichier ne peut mettre à jour. */
	idx.apply({ kind: "rename", file: f("Cours/reseau2.md", "md"), oldPath: "Cours/reseau.md" });
	r.check("un renommage retire l'ancien chemin", idx.get("Cours/reseau.md"), null);
	r.check("un renommage ajoute le nouveau", idx.get("Cours/reseau2.md")?.basename, "reseau2");

	idx.apply({ kind: "delete", path: "notes.txt" });
	r.check("une suppression retire l'entrée", idx.get("notes.txt"), null);

	idx.apply({ kind: "create", file: f("Cours/ch2.md", "md") });
	idx.apply({ kind: "modify", file: f("Cours/ch2.md", "md", 99) });
	r.check("une modification met la date à jour sans dupliquer",
		idx.all().filter(x => x.path === "Cours/ch2.md").map(x => x.mtime), [99]);

	r.done();
});

await withSrcModule("apps/windows/src/host/links.ts", async ({ resolveDansIndex }) => {
	const r = makeReporter("Hôte Windows — liens");
	/* L'ORDRE de cette liste est porteur : l'homonyme LOINTAIN est en tête.
	   Rangé dans l'autre sens, un code qui prendrait bêtement le premier
	   homonyme tomberait juste par accident, et le cas « le plus proche de la
	   note citante » resterait VERT alors que la règle a disparu — mesuré. */
	const fichiers = [
		f("Autre/schema.png", "png"),
		f("Cours/reseau.md", "md"),
		f("Cours/Images/schema.png", "png"),
	];

	/* Un wikilink se résout d'abord comme un CHEMIN exact, puis par NOM.
	   Obsidian fait la même chose via son index de liens ; l'inverser ferait
	   gagner un homonyme lointain contre le fichier explicitement désigné. */
	r.check("un chemin exact gagne",
		resolveDansIndex(fichiers, "Autre/schema.png", "Cours/reseau.md")?.path, "Autre/schema.png");
	r.check("un chemin sans extension se complète",
		resolveDansIndex(fichiers, "Cours/reseau", "x.md")?.path, "Cours/reseau.md");
	/* À défaut de chemin, le nom seul — et le PLUS PROCHE de la note qui cite
	   le lien gagne, parce que c'est l'image du chapitre, pas son homonyme
	   d'un autre cours. */
	r.check("un nom seul prend le plus proche de la note citante",
		resolveDansIndex(fichiers, "schema.png", "Cours/reseau.md")?.path, "Cours/Images/schema.png");
	r.check("un lien introuvable rend null",
		resolveDansIndex(fichiers, "rien.png", "Cours/reseau.md"), null);
	r.check("un lien vide rend null", resolveDansIndex(fichiers, "  ", "x.md"), null);

	r.done();
});

/* Capturées hors du module chargé : la SEULE utilité de charger `roots.ts` à
   nouveau, plus bas, serait de reconstruire le même bundle pour rien — les
   fonctions déjà importées restent valides même une fois le dossier
   temporaire de `withSrcModule` effacé (le code est déjà en mémoire, Node ne
   relit rien). */
let creerCarteRacines;
let resultsDirFor;

await withSrcModule("apps/windows/src/host/roots.ts", async (mod) => {
	creerCarteRacines = mod.creerCarteRacines;
	resultsDirFor = mod.resultsDirFor;
	const r = makeReporter("Hôte Windows — racines");
	const carte = creerCarteRacines([
		{ id: "Efrei", name: "Efrei", path: "C:/obsidian-vaults/Efrei", vault: true },
		{ id: "Perso", name: "Perso", path: "D:/Notes", vault: false },
	]);

	/* LA CLÉ DU JOURNAL. C'est le cas le plus important du fichier : elle doit
	   valoir exactement ce que le greffon écrit pour la même note. */
	r.check("local() retire le préfixe de racine",
		carte.local("Efrei/Cours/reseau.md"), "Cours/reseau.md");
	r.check("contrat() le remet", carte.contrat("Efrei", "Cours/reseau.md"), "Efrei/Cours/reseau.md");
	r.check("les deux se composent en identité",
		carte.local(carte.contrat("Perso", "a/b.md")), "a/b.md");
	/* Un identifiant VIDE (l'hôte Obsidian) laisse les chemins intacts. */
	r.check("un identifiant vide ne préfixe rien", carte.contrat("", "a/b.md"), "a/b.md");

	r.check("pour() trouve la racine", carte.pour("Perso/x.md")?.name, "Perso");
	r.check("pour() d'un chemin hors racines rend null", carte.pour("Inconnu/x.md"), null);
	/* Rendu TEL QUEL, pas vidé : une chaîne vide donnerait la clé « ::id »,
	   qui ressemble à une vraie clé et polluerait l'historique. */
	r.check("local() d'un chemin hors racines le rend tel quel",
		carte.local("Inconnu/x.md"), "Inconnu/x.md");
	/* Un chemin NU réduit au seul identifiant de racine (« Efrei », sans
	   sous-chemin) désigne la racine ELLE-MÊME : `local()` en rend la chaîne
	   VIDE, symétrique de `contrat(id, "")` qui rend `id` seul. Ce n'est PAS
	   le même vide que « hors racines » ci-dessus — ici la racine EST connue,
	   simplement sans sous-chemin à en retirer. */
	r.check("local() d'un chemin nu réduit à l'identifiant de racine rend une chaîne vide",
		carte.local("Efrei"), "");

	r.check("absolu() compose le chemin disque",
		carte.absolu("Efrei/Cours/reseau.md"), "C:/obsidian-vaults/Efrei/Cours/reseau.md");
	r.check("depuisAbsolu() fait l'inverse",
		carte.depuisAbsolu("D:/Notes/a/b.md"), "Perso/a/b.md");
	/* Windows ignore la casse : un surveillant qui rendrait « D:/NOTES/… »
	   ferait sinon tomber tous ses évènements dans le vide. */
	r.check("depuisAbsolu() ignore la casse", carte.depuisAbsolu("d:/notes/a/b.md"), "Perso/a/b.md");
	r.check("depuisAbsolu() hors racines rend null", carte.depuisAbsolu("E:/ailleurs/x.md"), null);

	/* Un dossier ouvert DANS un autre : la plus longue racine gagne, sinon le
	   même fichier aurait deux chemins du contrat selon l'ordre de la liste —
	   donc deux entrées au catalogue pour un seul quiz. */
	const imbrique = creerCarteRacines([
		{ id: "Vault", name: "Vault", path: "C:/V", vault: true },
		{ id: "Cours", name: "Cours", path: "C:/V/Cours", vault: false },
	]);
	r.check("la racine la plus longue gagne",
		imbrique.depuisAbsolu("C:/V/Cours/ch1.md"), "Cours/ch1.md");

	/* Le journal est sous la racine, au même endroit qu'elle soit un vault ou
	   non — contrairement aux résultats. */
	const hr = carte.hostRoots();
	r.check("le journal de chaque racine", hr.map(h => h.reviewLog),
		["Efrei/.neo-quiz/review-log.jsonl", "Perso/.neo-quiz/review-log.jsonl"]);
	r.check("l'ancien journal est celui du greffon", hr[0].legacyReviewLog,
		"Efrei/.obsidian/plugins/quiz-blocks/review-log.jsonl");

	/* RÈGLE SANS FILET (revue 1) : aucun cas n'éprouvait `resultsDirFor` —
	   une erreur y écrirait les résultats d'un quiz du dossier B dans le
	   dossier A, ou dans un `.obsidian/` fantôme hors d'un vault. Réutilise
	   `carte` (Efrei = vault, Perso = pas un vault). */
	r.check("resultsDirFor dans un vault écrit où le greffon écrit déjà",
		resultsDirFor(carte, "Efrei/Cours/x.md"), "Efrei/.obsidian/quiz-blocks-results");
	r.check("resultsDirFor hors vault écrit sous .neo-quiz",
		resultsDirFor(carte, "Perso/Cours/x.md"), "Perso/.neo-quiz/results");
	/* Une racine INCONNUE (chemin hors de toute racine ouverte) ne doit pas
	   fabriquer un dossier préfixé n'importe comment : elle retombe sur le
	   sous-chemin nu, sans préfixe — jamais `undefined/…`. */
	r.check("resultsDirFor d'une racine inconnue retombe sur le sous-chemin nu",
		resultsDirFor(carte, "Inconnu/x.md"), ".neo-quiz/results");

	r.done();
});

await withSrcModule("apps/windows/src/host/links.ts", async ({ createWindowsLinks }) => {
	const r = makeReporter("Hôte Windows — resourceUrl");

	/* SEUL endroit du script qui touche Tauri, et par un DOUBLE : la
	   fabrication d'URL de `convertFileSrc` lit `window.__TAURI_INTERNALS__`,
	   absent hors de la fenêtre. Sans ce double, chaque appel jetterait et
	   `resourceUrl` rendrait `null` partout — le cas passerait au vert quelle
	   que soit la logique, donc ne prouverait rien. Ce qui est ÉPROUVÉ ici,
	   c'est la RÉSOLUTION qui précède la conversion, pas la conversion. */
	const precedent = globalThis.window;
	globalThis.window = {
		__TAURI_INTERNALS__: {
			convertFileSrc: (chemin, protocole) => `${protocole}://localhost/${chemin}`,
		},
	};

	try {
		/* Une seule racine, « Quiz » : les chemins du contrat portent quand
		   même son préfixe (l'hôte Windows préfixe TOUJOURS, même à un seul
		   dossier — seul le greffon a un identifiant vide). L'INDEX contient
		   toujours des chemins PRÉFIXÉS (c'est ce que produit réellement
		   `createWindowsIndex`) ; les LIENS passés à `resourceUrl`/`resolve`,
		   eux, imitent ce qu'une note écrit — jamais préfixés. Confondre les
		   deux dans un même test masquerait la régression ci-dessous. */
		const fichiers = [
			f("Quiz/Autre/schema.png", "png"),
			f("Quiz/Cours/reseau.md", "md"),
			f("Quiz/Cours/Images/schema.png", "png"),
			f("Quiz/Autre/ch1.md", "md"),
			f("Quiz/Cours/ch1.md", "md"),
		];
		const index = {
			all: () => fichiers,
			get: (p) => fichiers.find(x => x.path === p) ?? null,
			apply: () => undefined,
		};
		const carte = creerCarteRacines([{ id: "Quiz", name: "Quiz", path: "D:/Quiz", vault: false }]);
		const links = createWindowsLinks(carte, index);

		/* « RÉSOUT puis convertit » (src/host/types.ts) : un chemin DÉJÀ connu
		   de l'index — le `.path` d'un `HostFile` déjà résolu, JAMAIS ce qu'une
		   note écrit elle-même — donne une URL d'asset sur son chemin ABSOLU,
		   par le chemin RAPIDE (`index.get`), sans passer par la résolution. */
		r.check("resourceUrl d'un HostFile (déjà un chemin du contrat) donne l'URL d'asset absolue",
			links.resourceUrl(f("Quiz/Cours/reseau.md", "md")), "asset://localhost/D:/Quiz/Cours/reseau.md");

		/* RÉGRESSION DU PREMIER TOUR DE REVUE, ici rétablie : le tour précédent
		   avait remplacé ce cas par un lien DÉJÀ PRÉFIXÉ (« Quiz/Autre/
		   schema.png »), qui ne passe JAMAIS par la résolution (il matche
		   `index.get` directement) — masquant que l'étape 1 de
		   `resolveDansIndex` (chemin exact) ne matche plus JAMAIS un lien
		   ÉCRIT COMME DANS UNE NOTE (sans préfixe), une fois l'index préfixé.
		   Sans la conversion vers l'espace du contrat (`versContrat`, dans
		   `links.ts`), ce cas retombait sur la recherche par NOM et rendait
		   l'homonyme « Cours/Images/schema.png » — plus proche par PROXIMITÉ
		   de dossier de la note citante que le fichier réellement désigné,
		   perdant la règle n°1 : « le fichier explicitement désigné gagne
		   toujours ». */
		r.check("un chemin exact écrit SANS préfixe (comme dans une note) gagne sur un homonyme plus proche",
			links.resourceUrl("Autre/schema.png", "Quiz/Cours/reseau.md"), "asset://localhost/D:/Quiz/Autre/schema.png");
		/* Même régression, à l'étape 2 (extension implicite) : sans la
		   conversion, « Autre/ch1 » complète son extension en espace NU
		   (« Autre/ch1.md », absent d'un index préfixé), échoue, et retombe
		   sur l'homonyme « Cours/ch1.md », plus proche par proximité. */
		r.check("une extension implicite se complète dans l'espace du contrat (lien sans préfixe)",
			links.resourceUrl("Autre/ch1", "Quiz/Cours/reseau.md"), "asset://localhost/D:/Quiz/Autre/ch1.md");

		/* Un NOM NU passe par la résolution par nom, comme `resolve` : c'est ce
		   qui distingue « résout puis convertit » d'un simple changement de
		   préfixe, et c'est la moitié que l'hôte Obsidian a dû rejoindre. */
		r.check("resourceUrl d'un nom nu passe par la résolution par nom",
			links.resourceUrl("reseau.md"), "asset://localhost/D:/Quiz/Cours/reseau.md");
		/* `null`, JAMAIS la chaîne vide : un `src=""` fait recharger la page
		   courante comme image. L'index fait AUTORITÉ — une URL vers un fichier
		   qu'il ne connaît pas pointerait hors du dossier autorisé. */
		r.check("resourceUrl d'un chemin inconnu rend null",
			links.resourceUrl("Nulle/part/inexistant.png"), null);
		r.check("resourceUrl d'un chemin vide rend null, pas \"\"",
			links.resourceUrl("   "), null);
		/* `fromPath` BORNE la résolution : sans lui, un nom nu tombe sur
		   l'homonyme le plus proche de la RACINE, pas de la note citante. */
		r.check("resourceUrl passe la note citante à la résolution par nom",
			links.resourceUrl("schema.png", "Quiz/Cours/reseau.md"), "asset://localhost/D:/Quiz/Cours/Images/schema.png");
	} finally {
		if (precedent === undefined) delete globalThis.window;
		else globalThis.window = precedent;
	}

	r.done();
});

await withSrcModule("apps/windows/src/host/links.ts", async ({ createWindowsLinks }) => {
	const r = makeReporter("Hôte Windows — liens bornés aux racines");

	/* DEUX racines, chacune avec un fichier NOMMÉ PAREIL. La borne
	   (`dansLaRacineDe`, dans links.ts) doit empêcher un homonyme de l'une de
	   répondre pour une note de l'autre — exactement comme un wikilink
	   Obsidian ne sort pas du vault. */
	const fichiers = [
		f("Quiz/schema.png", "png"),
		f("Quiz/ailleurs.png", "png"),
		f("Perso/notes.md", "md"),
		f("Perso/img/schema.png", "png"),
	];
	const index = {
		all: () => fichiers,
		get: (p) => fichiers.find(x => x.path === p) ?? null,
		apply: () => undefined,
	};
	const carte = creerCarteRacines([
		{ id: "Quiz", name: "Quiz", path: "D:/Quiz", vault: false },
		{ id: "Perso", name: "Perso", path: "D:/Notes", vault: false },
	]);
	const links = createWindowsLinks(carte, index);

	/* Un homonyme d'une AUTRE racine ne doit jamais gagner : sous Obsidian un
	   lien ne sort pas du vault, et ici il ne sort pas de son dossier. */
	r.check("la résolution par nom ne franchit pas les racines",
		links.resolve("schema.png", "Perso/notes.md")?.path, "Perso/img/schema.png");

	/* LE CAS RÉELLEMENT DISCRIMINANT pour la borne : « schema.png » existe
	   dans les DEUX racines, et le tri par proximité de `resolveDansIndex`
	   fait déjà gagner le fichier de la bonne racine tout seul (son premier
	   segment de chemin, l'identifiant de racine, est commun avec celui de la
	   note citante — un homonyme d'ailleurs ne partage jamais ce segment).
	   Le cas ci-dessus resterait donc VERT même sans `dansLaRacineDe`. Ici,
	   « ailleurs.png » n'existe QUE dans « Quiz » : sans la borne,
	   `resolveDansIndex` chercherait dans TOUT l'index, le trouverait, et le
	   rendrait pour une note de « Perso » qui n'a rien de ce nom — exactement
	   la fuite que la borne existe pour empêcher. */
	r.check("un homonyme d'une autre racine ne comble pas une absence dans la racine de la note",
		links.resolve("ailleurs.png", "Perso/notes.md"), null);

	r.done();
});

await withSrcModule("apps/windows/src/review/catalogue.ts", async ({ construireCatalogue, cleModule, libelleModule }) => {
	const r = makeReporter("App — catalogue de révision");
	/* Un faux `paths` : deux racines, préfixe = premier segment. C'est le
	   contrat, pas l'implémentation Windows, qui est éprouvé ici. */
	const paths = {
		rootOf: (p) => ({ id: p.split("/")[0], name: p.split("/")[0], reviewLog: "", legacyReviewLog: null }),
		localPath: (p) => p.split("/").slice(1).join("/"),
		contractPath: (id, l) => (id ? `${id}/${l}` : l),
		resultsDirFor: () => "",
		roots: () => [],
	};

	/* La clé de module porte la RACINE : sans elle, « Réseaux » de deux
	   dossiers différents partageraient une date d'examen, et l'ordonnanceur
	   resserrerait les révisions d'une matière dont l'examen n'a pas lieu. */
	r.check("le module porte la racine", cleModule("Efrei/Reseaux/ch1.md", paths), "Efrei/Reseaux");
	r.check("deux racines ne partagent pas un module homonyme",
		cleModule("Perso/Reseaux/ch1.md", paths) === cleModule("Efrei/Reseaux/ch1.md", paths), false);
	/* Un quiz posé à la racine du dossier : le module est la racine, pas une
	   clé qui se termine par un séparateur. */
	r.check("un quiz sans sous-dossier", cleModule("Efrei/ch1.md", paths), "Efrei");
	r.check("le libellé est le dernier segment", libelleModule("Efrei/Reseaux"), "Reseaux");

	const items = construireCatalogue([
		{ path: "Efrei/Reseaux/ch1.md", items: [{ id: "ip" }, { id: "masque", slice: 2 }] },
	], paths);
	/* La clé de question est le chemin du CONTRAT + « ::id ». C'est
	   l'adaptateur qui la localise avant écriture — ici, elle est globale. */
	r.check("les clés de question", items.map(i => i.q),
		["Efrei/Reseaux/ch1.md::ip", "Efrei/Reseaux/ch1.md::masque"]);
	/* La TRANCHE devient la source : sans elle, deux tranches d'un même
	   chapitre ne s'entrelaceraient pas. */
	r.check("la tranche sépare les familles", items.map(i => i.source),
		["Efrei/Reseaux/ch1.md", "Efrei/Reseaux/ch1.md#2"]);

	/* SANS FILET dans le brief : le `role` (pre/read/recall/test) décide de
	   l'entrelacement des rôles pédagogiques (spec de l'ordonnanceur). Un
	   item sans rôle ne doit pas en fabriquer un (`undefined`, pas une chaîne
	   vide) — sinon le noyau daterait une question comme si son rôle était
	   connu. */
	const avecRole = construireCatalogue([
		{ path: "Efrei/Reseaux/ch1.md", items: [{ id: "ip", role: "recall" }, { id: "masque" }] },
	], paths);
	r.check("le rôle est reporté quand présent, absent sinon",
		avecRole.map(i => i.role ?? null), ["recall", null]);

	r.done();
});

/**
 * Installe le DOM que la modale de la fenêtre construit, et rend de quoi le
 * retirer.
 *
 * `window.setTimeout` est CAPTURÉ au lieu d'être exécuté : c'est le filet de
 * sécurité de la disparition, et le retenir permet d'observer l'état PENDANT
 * l'animation de sortie — seul moment où l'on peut prouver que `onClose` n'a
 * pas encore été appelé. `matchMedia` rend `matches: false` pour éprouver le
 * chemin ANIMÉ ; le chemin `prefers-reduced-motion` détache immédiatement et
 * ne dirait rien de cet ordre-là.
 */
function installerDom() {
	const precedentDocument = globalThis.document;
	const precedentWindow = globalThis.window;
	const { document } = parseHTML("<!doctype html><html><body></body></html>");
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

await withSrcModule("apps/windows/src/host/modal.ts", async ({ createWindowsModals }) => {
	const r = makeReporter("Hôte Windows — modales");
	const dom = installerDom();

	try {
		const modals = createWindowsModals();

		/* Le journal des moments, dans l'ORDRE : c'est lui qui distingue
		   « appelé » de « appelé au bon moment ». */
		const journal = [];
		let panneau = null;
		let attacheQuandOnCloseArrive = null;

		const poignee = modals.open({
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

		/* LA STRUCTURE D'OBSIDIAN, nom de classe par nom de classe. Le CSS
		   PARTAGÉ la cible : `modal-anim.css` anime `.modal.qbd-anim-modal` et
		   `.modal-container:has(> .modal.qbd-anim-modal) .modal-bg` — le fond
		   doit donc être un FRÈRE du panneau, tous deux enfants DIRECTS du
		   conteneur. Une structure qui dérive ne produit aucune erreur : une
		   boîte illisible au milieu de l'écran, que rien d'autre ne dirait. */
		const conteneur = dom.document.querySelector(".modal-container");
		r.check("le conteneur est posé sur le body", !!conteneur, true);
		r.check("le fond et le panneau sont enfants directs du conteneur",
			[...(conteneur?.children ?? [])].map(e => e.className),
			["modal-bg", "modal qbd-anim-modal qbd-medit-modal"]);
		r.check("le panneau porte la croix, le titre et le corps",
			[...poignee.panelEl.children].map(e => e.className),
			["modal-close-button", "modal-title", "modal-content"]);

		/* La classe va sur le PANNEAU : c'est elle que cible le CSS partagé
		   (`.qbd-medit-modal { width: 475px }`). Posée ailleurs, la modale
		   s'ouvrirait à une largeur quelconque sans qu'aucune erreur ne le dise. */
		r.check("open pose la classe du spec sur le panneau",
			poignee.panelEl.classList.contains("qbd-medit-modal"), true);
		/* Rend le cas « onClose après le détachement » NON TRIVIAL : sans cette
		   ligne, un panneau jamais attaché le ferait passer par accident. */
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
		r.check("le panneau porte le marqueur de sortie pendant l'animation",
			poignee.panelEl.classList.contains("qbd-closing"), true);
		/* Le fond suit le panneau, sinon il resterait opaque le temps que le
		   panneau disparaisse (`.modal-container.qbd-closing .modal-bg`). */
		r.check("le conteneur aussi, pour que le fond se fonde",
			conteneur.classList.contains("qbd-closing"), true);

		/* LA DOUBLE DÉTENTE, jouée dans l'ordre réel : `animationend` arrive
		   vers 160 ms et détache, puis le filet de sécurité de 240 ms arrive
		   QUAND MÊME. Les deux se produisent à chaque fermeture normale — sans
		   garde d'idempotence sur le détachement, `onClose` serait appelé deux
		   fois, donc « Modifier dossier » écrirait deux fois sur le disque. */
		poignee.panelEl.dispatchEvent(new Event("animationend"));
		r.check("animationend détache le conteneur",
			dom.document.querySelector(".modal-container"), null);
		r.check("deux fermetures et une animation n'appellent onClose qu'une fois",
			journal, ["onOpen", "onClose"]);
		r.check("onClose est appelé APRÈS le détachement du panneau",
			attacheQuandOnCloseArrive, false);
		/* Un corps non vidé empilerait deux contenus à la réouverture. */
		r.check("le corps est vidé à la fermeture", poignee.contentEl.childNodes.length, 0);

		for (const fn of dom.minuteurs.splice(0)) fn();
		r.check("le filet de sécurité qui suit ne rappelle pas onClose",
			journal, ["onOpen", "onClose"]);
	} finally {
		dom.retirer();
	}

	r.done();
});

await withSrcModule("apps/windows/src/host/ui.ts", async ({ createWindowsUi }) => {
	const r = makeReporter("Hôte Windows — catalogue d'icônes");
	/* `try/finally` comme le groupe des modales, et pour la raison que
	   `CLAUDE.md` note à propos de `check:lesson` : un groupe qui MEURT sur une
	   exception au lieu d'échouer proprement emporte en silence tous ceux qui
	   le suivent — et laisserait ici `globalThis.document` et `window`
	   remplacés pour eux. */
	const dom = installerDom();
	try {
		const ui = createWindowsUi();
		const noms = ui.iconNames();

		/* Le contrat parle KEBAB-CASE, comme Obsidian ; le paquet `lucide` expose
		   ses clés en PascalCase. Une liste non vide ne prouve donc rien —
		   `Object.keys(icons)` en rendrait une, pleine de noms qu'aucun `setIcon`
		   ne sait rendre. D'où une VALEUR NOMMÉE. */
		r.check("iconNames contient chevron-down", noms.includes("chevron-down"), true);
		/* Le préfixe « lucide- » est une affaire d'Obsidian : la fenêtre n'a
		   aucune raison d'en fabriquer un. */
		r.check("iconNames ne laisse aucun préfixe lucide-",
			noms.filter(n => n.startsWith("lucide-")), []);
		/* Aucune majuscule ne survit : une seule suffirait à faire échouer la
		   recherche du sélecteur, qui compare en minuscules. */
		r.check("aucun nom ne garde de majuscule", noms.filter(n => /[A-Z]/.test(n)), []);

		/* LA règle que les trois cas ci-dessus ne gardent pas : un nom listé doit
		   être un nom que `setIcon` sait RENDRE. La conversion inverse et celle de
		   `setIcon` doivent donc se composer en identité — ce que le `toKebabCase`
		   de Lucide (`/([a-z0-9])([A-Z])/`) ne fait PAS : il rendrait « xcircle »
		   pour `XCircle`, un nom que `versCleLucide` ne retrouve plus. Vérifié sur
		   TOUT le catalogue plutôt que sur un nom cité, qui disparaîtrait le jour
		   où Lucide retire son alias. Un nom irrésolu VIDE l'élément (ui.ts). */
		const irresolus = [];
		/* `poserIcone` avertit en console sur un nom inconnu — c'est voulu dans
		   l'application, mais ici cela noierait le rapport sous 2000 lignes. Le
		   résultat, lui, se lit sur l'élément resté vide. */
		const avertir = console.warn;
		console.warn = () => {};
		try {
			for (const nom of noms) {
				const el = dom.document.createElement("span");
				ui.setIcon(el, nom);
				if (!el.firstChild) irresolus.push(nom);
			}
		} finally {
			console.warn = avertir;
		}
		r.check("chaque nom listé est un nom que setIcon sait rendre", irresolus, []);
	} finally {
		dom.retirer();
	}

	r.done();
});
