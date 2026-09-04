/** Vérifie les frontières Obsidian où review-store pourrait perdre ou
 * fabriquer silencieusement des événements. Ce script a donc le droit de
 * toucher Obsidian, Date et setTimeout, contrairement au noyau pur. */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const JOUR = 86400000;
const DEBOUNCE_MS = 500;

/** Plugin hôte minimal : le faux émetteur conserve les EventRef afin que
    `destroy()` soit éprouvé comme dans Obsidian, pas seulement par inspection. */
function fakePlugin(options = {}) {
	const appended = [];
	const removed = [];
	const renameRefs = new Set();
	const append = options.append ?? (async (_path, texte) => { appended.push(texte); });
	const plugin = {
		manifest: options.dir === undefined ? { dir: "vault/.obsidian/plugins/quiz-blocks" } : options.dir === null ? {} : { dir: options.dir },
		app: {
			vault: {
				adapter: {
					exists: options.exists ?? (async () => false),
					read: options.read ?? (async () => { throw new Error("ENOENT"); }),
					append,
					// Fichiers de conflit Syncthing : `list` les expose, `remove`
					// note ce que le store a jugé sûr de supprimer.
					list: options.list ?? (async () => ({ files: [], folders: [] })),
					remove: options.remove ?? (async (p) => { removed.push(p); }),
				},
				on: (nom, cb) => {
					const ref = { nom, cb };
					if (nom === "rename") renameRefs.add(ref);
					return ref;
				},
				offref: (ref) => { renameRefs.delete(ref); },
			},
		},
		registerEvent: () => {},
		settings: { quizzesModuleOverrides: {} },
	};
	const emitRename = (file, oldPath) => {
		for (const ref of [...renameRefs]) ref.cb(file, oldPath);
	};
	// Callback brut, capturé indépendamment du Set : contourne le retrait
	// simulé par `offref` pour isoler la garde `detruit` interne au module
	// (voir le test « destruction »), plutôt que de re-tester `offref` deux fois.
	const renameCallback = () => [...renameRefs][0]?.cb ?? null;
	return { plugin, appended, removed, emitRename, renameCallback, renameListenerCount: () => renameRefs.size };
}

const fakeScanner = (quizzes) => ({ getQuizzes: () => quizzes });
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** Pilote uniquement le délai de 500 ms du store. Les autres timers Node
    restent réels, afin que les promesses puissent continuer à se vider. */
async function withManualDebounce(run) {
	const realSetTimeout = globalThis.setTimeout;
	const realClearTimeout = globalThis.clearTimeout;
	let nextId = 1;
	const timers = new Map();
	globalThis.setTimeout = (callback, delay = 0, ...args) => {
		if (delay !== DEBOUNCE_MS) return realSetTimeout(callback, delay, ...args);
		const id = nextId++;
		timers.set(id, () => callback(...args));
		return id;
	};
	globalThis.clearTimeout = (id) => {
		if (timers.delete(id)) return;
		realClearTimeout(id);
	};
	try {
		await run({
			count: () => timers.size,
			runNext: () => {
				const first = timers.entries().next();
				if (first.done) return false;
				const [id, callback] = first.value;
				timers.delete(id);
				callback();
				return true;
			},
		});
	} finally {
		globalThis.setTimeout = realSetTimeout;
		globalThis.clearTimeout = realClearTimeout;
	}
}

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — clé opaque");
	const { plugin } = fakePlugin();
	const store = createReviewStore(plugin, fakeScanner([]));
	r.check("keyOf assemble chemin et id par ::", store.keyOf("Cours/ch1.md", "q1"), "Cours/ch1.md::q1");
	store.destroy();
	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ buildReviewCatalogue }) => {
	const r = makeReporter("Adaptateur — catalogue depuis le scanner");
	const quizzes = [
		{
			path: "B1 (2025-2026)/Reseaux/ch1.md",
			items: [
				{ id: "q1", role: "test", slice: 2 },
				{ id: "q2" },
			],
		},
		{ path: "notes-racine.md", items: [{ id: "q1", role: "recall" }] },
	];
	const attendu = [
		{ q: "B1 (2025-2026)/Reseaux/ch1.md::q1", module: "Reseaux", source: "B1 (2025-2026)/Reseaux/ch1.md#2", role: "test" },
		{ q: "B1 (2025-2026)/Reseaux/ch1.md::q2", module: "Reseaux", source: "B1 (2025-2026)/Reseaux/ch1.md" },
		{ q: "notes-racine.md::q1", module: "", source: "notes-racine.md", role: "recall" },
	];
	r.check("le constructeur de catalogue est exporté", typeof buildReviewCatalogue, "function");
	if (typeof buildReviewCatalogue === "function") {
		const obtenu = buildReviewCatalogue(quizzes, { Reseaux: { examDate: "2027-06-01" } });
		r.check("q, module et source restent les valeurs opaques attendues", obtenu, attendu);
	}
	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — chargement concurrent");
	let resolveRead;
	const lecture = new Promise(resolve => { resolveRead = resolve; });
	const { plugin } = fakePlugin({ exists: async () => true, read: async () => lecture });
	const quiz = { path: "B1 (2025-2026)/Reseaux/ch1.md", items: [{ id: "q1" }] };
	const store = createReviewStore(plugin, fakeScanner([quiz]));
	const loading = store.load();
	store.record([{ q: store.keyOf(quiz.path, "q1"), grade: "correct" }]);
	resolveRead("");
	await loading;
	const plan = store.plan(Date.now() + 2 * JOUR);
	// La réponse arrivée pendant l'I/O reste une réponse : sans fusion, le
	// remplacement par le fichier vide fabriquerait une question neuve.
	r.check("une réponse arrivée pendant load n'est pas effacée", plan.stats.new, 0);
	store.destroy();
	await tick();
	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	// Régression 2 : le listener de renommage est armé de façon SYNCHRONE,
	// avant que `load()` (asynchrone) n'ait fini de lire le disque. Pendant
	// cette fenêtre, `lignes` est encore vide, donc le filtre de pertinence
	// ne peut reconnaître AUCUN chemin — sans garde, l'événement serait
	// perdu et la clé resterait orpheline pour toujours dans le journal fusionné.
	const r = makeReporter("Adaptateur — renommage pendant load()");
	let resolveRead;
	const lecture = new Promise(resolve => { resolveRead = resolve; });
	const { plugin, appended, emitRename } = fakePlugin({ exists: async () => true, read: async () => lecture });
	const store = createReviewStore(plugin, fakeScanner([]));
	const loading = store.load();
	// `lignes` est encore vide ici : `load()` n'a pas rendu la main.
	emitRename({ path: "Cours/Réseaux" }, "Cours/Reseaux");
	resolveRead("");
	await loading;
	store.destroy();
	await tick();
	r.check("un renommage survenu pendant la lecture est quand même écrit", appended.length, 1);
	const ligne = appended[0] ? JSON.parse(appended[0].trim()) : null;
	r.check("c'est bien la ligne de renommage, pas une ligne perdue", ligne?.t, "rename");
	r.check("'from' correct malgré un journal encore vide au moment de l'événement", ligne?.from, "Cours/Reseaux");
	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — erreurs de lecture");
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => { warnings.push(args); };
	try {
		{
			const { plugin } = fakePlugin({ exists: async () => false });
			const store = createReviewStore(plugin, fakeScanner([]));
			await store.load();
			store.destroy();
			r.check("l'absence normale du journal n'avertit pas", warnings.length, 0);
		}
		{
			const { plugin } = fakePlugin({
				exists: async () => true,
				read: async () => { throw new Error("EACCES"); },
			});
			const store = createReviewStore(plugin, fakeScanner([]));
			await store.load();
			store.destroy();
			r.check("une lecture refusée est signalée", warnings.length, 1);
		}
	} finally {
		console.warn = originalWarn;
	}
	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — chemin du journal");
	const { plugin } = fakePlugin({ dir: null });
	let erreur = null;
	try { createReviewStore(plugin, fakeScanner([])); } catch (e) { erreur = e; }
	r.check("un manifest.dir absent fait échouer la création", erreur instanceof Error, true);
	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — écritures sérialisées");
	await withManualDebounce(async clock => {
		const appels = [];
		let libererPremier;
		const premier = new Promise(resolve => { libererPremier = resolve; });
		const { plugin } = fakePlugin({
			append: async (_path, texte) => {
				appels.push(texte);
				if (appels.length === 1) await premier;
			},
		});
		const store = createReviewStore(plugin, fakeScanner([]));
		store.record([{ q: "Cours/a.md::q1", grade: "correct" }]);
		clock.runNext();
		await settle();
		store.record([{ q: "Cours/b.md::q1", grade: "wrong" }]);
		clock.runNext();
		await settle();
		r.check("un seul append est en vol", appels.length, 1);
		libererPremier();
		await settle();
		await settle();
		r.check("le lot suivant est reprogrammé après le premier", clock.count(), 1);
		clock.runNext();
		await settle();
		const questions = appels.map(texte => JSON.parse(texte.trim()).q);
		r.check("les lots atteignent append dans l'ordre de record", questions, ["Cours/a.md::q1", "Cours/b.md::q1"]);
		store.destroy();
	});
	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	// Un échec d'écriture ne doit plus se réarmer tout seul (régression 3) : le
	// lot échoué reste en file et repart avec la prochaine vraie activité
	// (record()/rename), jamais sur une boucle de 500 ms autonome. La console
	// ne doit signaler qu'UNE fois un échec persistant, pas à chaque tentative.
	const r = makeReporter("Adaptateur — échec d'écriture ne boucle pas");
	await withManualDebounce(async clock => {
		const appels = [];
		// Échoue deux fois de suite (deux lots distincts, sans succès entre les
		// deux) avant de réussir : seule une deuxième défaillance CONSÉCUTIVE
		// distingue « log une fois » de « log à chaque tentative ».
		const { plugin } = fakePlugin({
			append: async (_path, texte) => {
				appels.push(texte);
				if (appels.length < 3) throw new Error("disque verrouillé");
			},
		});
		const erreurs = [];
		const originalError = console.error;
		console.error = (...args) => { erreurs.push(args); };
		try {
			const store = createReviewStore(plugin, fakeScanner([]));
			store.record([{ q: "Cours/a.md::q1", grade: "correct" }]);
			clock.runNext();
			await settle();
			await settle();
			r.check("un échec n'arme plus de nouvelle tentative tout seul", clock.count(), 0);
			r.check("l'échec est signalé une fois", erreurs.length, 1);

			// Sans nouvel événement, rien ne doit jamais retenter tout seul : le
			// lot en échec reste en attente indéfiniment, ce qui prouve l'absence
			// de boucle plutôt qu'un simple délai plus long.
			store.record([{ q: "Cours/b.md::q1", grade: "wrong" }]);
			clock.runNext();
			await settle();
			await settle();
			r.check("un deuxième échec consécutif n'arme rien non plus", clock.count(), 0);
			r.check("un échec persistant ne re-signale pas à chaque tentative", erreurs.length, 1);

			store.record([{ q: "Cours/c.md::q1", grade: "correct" }]);
			clock.runNext();
			await settle();
			r.check("le troisième essai (qui réussit) porte les trois lots en attente", appels.length, 3);
			const questions = appels[2].trim().split("\n").map(l => JSON.parse(l).q);
			r.check("le lot en échec repart avec chaque nouvelle activité, dans l'ordre", questions,
				["Cours/a.md::q1", "Cours/b.md::q1", "Cours/c.md::q1"]);
			store.destroy();
		} finally {
			console.error = originalError;
		}
	});
	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — renommages pertinents");
	const historique = JSON.stringify({
		t: "answer", q: "Cours/Reseaux/ch1.md::q1", at: 1_700_000_000_000, grade: "correct",
	}) + "\n";

	await withManualDebounce(async clock => {
		const { plugin, emitRename } = fakePlugin({ exists: async () => true, read: async () => historique });
		const store = createReviewStore(plugin, fakeScanner([]));
		await store.load();
		emitRename({ path: "Images/logo-2.png" }, "Images/logo.png");
		r.check("un fichier sans question ne gonfle pas le journal", clock.count(), 0);
		store.destroy();
	});

	await withManualDebounce(async () => {
		const { plugin, appended, emitRename } = fakePlugin({ exists: async () => true, read: async () => historique });
		const store = createReviewStore(plugin, fakeScanner([]));
		await store.load();
		emitRename({ path: "Cours/Réseaux/" }, "Cours/Reseaux/");
		store.destroy();
		await settle();
		r.check("une ligne pertinente a bien été écrite", appended.length, 1);
		const ligne = JSON.parse(appended[0].trim());
		r.check("type 'rename'", ligne.t, "rename");
		r.check("'from' sans slash de fin", ligne.from, "Cours/Reseaux");
		r.check("'to' sans slash de fin", ligne.to, "Cours/Réseaux");
	});

	await withManualDebounce(async () => {
		const { plugin, appended, emitRename } = fakePlugin({ exists: async () => true, read: async () => historique });
		const store = createReviewStore(plugin, fakeScanner([]));
		await store.load();
		emitRename({ path: "Cours/Réseaux" }, "Cours/Reseaux");
		emitRename({ path: "Cours/Networks" }, "Cours/Réseaux");
		store.destroy();
		await settle();
		const lignes = appended.flatMap(texte => texte.trim().split("\n").map(JSON.parse));
		r.check("deux renommages successifs suivent la clé courante", lignes.map(l => [l.from, l.to]), [
			["Cours/Reseaux", "Cours/Réseaux"],
			["Cours/Réseaux", "Cours/Networks"],
		]);
	});

	{
		const { plugin, appended, emitRename } = fakePlugin({ exists: async () => true, read: async () => historique });
		const store = createReviewStore(plugin, fakeScanner([]));
		await store.load();
		emitRename({ path: "Cours" }, "Cours/");
		store.destroy();
		await tick();
		r.check("un renommage no-op après normalisation n'écrit rien", appended.length, 0);
	}

	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — destruction");
	await withManualDebounce(async clock => {
		const historique = JSON.stringify({
			t: "answer", q: "Cours/a.md::q1", at: 1_700_000_000_000, grade: "correct",
		}) + "\n";
		const { plugin, emitRename, renameCallback, renameListenerCount } = fakePlugin({
			exists: async () => true,
			read: async () => historique,
		});
		const store = createReviewStore(plugin, fakeScanner([]));
		await store.load();
		r.check("le listener existe avant destroy", renameListenerCount(), 1);
		// Capturé AVANT destroy() : appeler ce callback brut après coup contourne
		// le retrait simulé par `offref` et isole la garde interne `detruit` de
		// `ecrireBientot()` — sans elle, ce test resterait vert même si `offref`
		// était le seul rempart (ce qu'il était avant cette correction : deux
		// gardes indépendantes rendaient l'assertion increvable).
		const cb = renameCallback();
		store.destroy();
		r.check("destroy détache son EventRef", renameListenerCount(), 0);
		emitRename({ path: "Cours/b.md" }, "Cours/a.md");
		r.check("un rename après destroy (par le vault) ne réarme aucun timer", clock.count(), 0);
		cb({ path: "Cours/c.md" }, "Cours/a.md");
		r.check("le callback brut après destroy, hors offref, n'arme rien non plus", clock.count(), 0);
	});
	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — horizon (garde NaN, decision 2)");
	const item = { path: "B1 (2025-2026)/Reseaux/ch1.md", items: [{ id: "q1" }] };
	const now = Date.now();

	async function planApres(overrides) {
		const { plugin } = fakePlugin();
		plugin.settings.quizzesModuleOverrides = overrides;
		const store = createReviewStore(plugin, fakeScanner([item]));
		await store.load();
		store.record([{ q: store.keyOf(item.path, "q1"), grade: "correct" }]);
		const plan = store.plan(now + 2 * JOUR);
		store.destroy();
		return plan;
	}

	// 275761 dépasse la plage Date mais ses trois composants non nuls passent
	// le premier filtre. La garde doit donc produire le même repli que l'absence
	// totale d'override, une valeur calculée indépendamment du chemin NaN.
	const A = await planApres({});
	const B = await planApres({ Reseaux: { examDate: "275761-01-01" } });
	r.check("un horizon hors du domaine Date retombe sur le même plan qu'aucun override", B, A);
	r.done();
});

/* ── Fichiers de conflit Syncthing ──
   Syncthing ne fusionne pas : deux appareils qui écrivent le journal entre
   deux synchronisations produisent un `.sync-conflict-…jsonl` à côté. Le
   store doit ABSORBER ses lignes manquantes puis le supprimer — et ne jamais
   supprimer ce qu'il n'a pas entièrement compris. */
await withSrcModule("src/dashboard/review-store.ts", async (mod) => {
	const r = makeReporter("Adaptateur — absorption des conflits Syncthing");
	const DIR = "vault/.obsidian/plugins/quiz-blocks";
	const T0 = 1750000000000;
	const ligne = (q, at) => JSON.stringify({ t: "answer", q, at, grade: "correct" }) + "\n";

	// Le principal porte a et b ; le conflit porte b (recouvrement, cas NORMAL)
	// et c (la révision que l'autre appareil est seul à connaître).
	// `formatLine` termine chaque ligne par un saut : un vrai journal finit
	// donc TOUJOURS par un saut. Le fixture doit refleter la realite.
	const principal = [ligne("n.md::a", T0), ligne("n.md::b", T0 + 1)].join("");
	const conflit = [ligne("n.md::b", T0 + 1), ligne("n.md::c", T0 + 2)].join("");

	const monter = async (opts = {}) => {
		let disque = opts.principal ?? principal;
		const f = fakePlugin({
			exists: async () => true,
			read: async (p) => {
				if (p.endsWith("review-log.jsonl")) return disque;
				if (p in (opts.conflits ?? {})) return opts.conflits[p];
				throw new Error("ENOENT " + p);
			},
			append: async (_p, texte) => { disque += texte; },
			list: async () => ({ files: [`${DIR}/review-log.jsonl`, ...Object.keys(opts.conflits ?? {})], folders: [] }),
		});
		const store = mod.createReviewStore(f.plugin, fakeScanner([]));
		await store.load();
		return { store, f, disque: () => disque };
	};

	const cheminC = `${DIR}/review-log.sync-conflict-20260904-071500-ABCDEFG.jsonl`;
	const m = await monter({ conflits: { [cheminC]: conflit } });
	const ecrit = m.disque().trim().split("\n");
	// 3 lignes et non 4 : `b` est présent des deux côtés et ne doit être écrit
	// qu'une fois, sinon `spentToday` compterait deux fois la même révision.
	r.check("la révision connue du seul autre appareil est absorbée", ecrit.length, 3);
	r.check("le recouvrement n'est PAS dupliqué", ecrit.filter(l => l.includes("n.md::b")).length, 1);
	r.check("le fichier de conflit est supprimé après absorption", m.f.removed, [cheminC]);

	// Une ligne illisible : on absorbe le reste, on garde le fichier.
	const cheminD = `${DIR}/review-log.sync-conflict-20260904-081500-HIJKLMN.jsonl`;
	const abime = ligne("n.md::d", T0 + 3) + "{ pas du json\n";
	const m2 = await monter({ conflits: { [cheminD]: abime } });
	r.check("la ligne lisible d'un fichier abîmé est quand même absorbée",
		m2.disque().includes("n.md::d"), true);
	r.check("un fichier dont une ligne échappe n'est JAMAIS supprimé", m2.f.removed, []);

	/* Journal sans saut final (édité à la main, tronqué par une fermeture
	   brutale) : sans la recolle, la dernière ligne du principal et la
	   première absorbée fusionneraient et deviendraient TOUTES DEUX
	   illisibles — une perte causée par le code censé empêcher les pertes. */
	const m3 = await monter({ principal: principal.trimEnd(), conflits: { [cheminC]: conflit } });
	const lu3 = m3.disque().trim().split(String.fromCharCode(10));
	r.check("un journal sans saut final n'est pas corrompu par l'absorption", lu3.length, 3);
	r.check("la ligne qui precedait la recolle reste lisible",
		lu3.filter(l => l.includes("n.md::b")).length, 1);
	r.done();
});
