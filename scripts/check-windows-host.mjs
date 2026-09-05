/**
 * Vérification de l'INDEX et de la RÉSOLUTION DE LIENS de l'hôte Windows.
 *
 * L'index est la seule pièce de l'hôte Windows qui soit du code pur : c'est
 * lui qui rend `listMarkdown`, `findByName` et `getFile` synchrones, donc lui
 * qui doit rester juste après un renommage ou une suppression. Un index qui
 * dérive ne produit pas d'erreur : il fait disparaître des quiz du catalogue.
 *
 * Le reste de l'hôte (sélecteur, protocole d'asset, toasts, MathLive) n'existe
 * que dans la fenêtre : il se vérifie à la main, et la tâche dit comment. Les
 * modules chargés ici IMPORTENT Tauri au niveau module — c'est sans danger,
 * rien ne s'exécute au chargement. Une SEULE fonction Tauri est appelée, dans
 * le dernier groupe, et derrière un double de `window.__TAURI_INTERNALS__` :
 * la fabrication d'URL de `convertFileSrc`. Le groupe éprouve la RÉSOLUTION
 * qui la précède, pas la conversion elle-même.
 *
 *     npm run check:windows-host
 */
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
		const fichiers = [
			f("Autre/schema.png", "png"),
			f("Cours/reseau.md", "md"),
			f("Cours/Images/schema.png", "png"),
		];
		const index = {
			all: () => fichiers,
			get: (p) => fichiers.find(x => x.path === p) ?? null,
			apply: () => undefined,
		};
		const links = createWindowsLinks("D:/Quiz", index);

		/* « RÉSOUT puis convertit » (src/host/types.ts) : un chemin connu de
		   l'index donne une URL d'asset sur son chemin ABSOLU. */
		r.check("resourceUrl d'un chemin connu donne l'URL d'asset absolue",
			links.resourceUrl("Autre/schema.png"), "asset://localhost/D:/Quiz/Autre/schema.png");
		/* Un HostFile passe par le même chemin : c'est la même sémantique, pas
		   une seconde. */
		r.check("resourceUrl d'un HostFile donne la même URL",
			links.resourceUrl(f("Cours/reseau.md", "md")), "asset://localhost/D:/Quiz/Cours/reseau.md");
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
			links.resourceUrl("schema.png", "Cours/reseau.md"), "asset://localhost/D:/Quiz/Cours/Images/schema.png");
	} finally {
		if (precedent === undefined) delete globalThis.window;
		else globalThis.window = precedent;
	}

	r.done();
});
