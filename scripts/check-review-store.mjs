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
	return { plugin, appended, emitRename, renameListenerCount: () => renameRefs.size };
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
	const r = makeReporter("Adaptateur — nouvelle tentative d'écriture");
	await withManualDebounce(async clock => {
		const appels = [];
		const { plugin } = fakePlugin({
			append: async (_path, texte) => {
				appels.push(texte);
				if (appels.length === 1) throw new Error("disque verrouillé");
			},
		});
		const originalError = console.error;
		console.error = (...args) => {
			if (!String(args[0]).startsWith("[quiz-blocks]")) originalError(...args);
		};
		try {
			const store = createReviewStore(plugin, fakeScanner([]));
			store.record([{ q: "Cours/a.md::q1", grade: "correct" }]);
			clock.runNext();
			await settle();
			await settle();
			r.check("un échec arme seul une nouvelle tentative", clock.count(), 1);
			clock.runNext();
			await settle();
			r.check("le même lot est retenté sans nouvelle réponse", appels.length, 2);
			r.check("le contenu retenté est identique", appels[1], appels[0]);
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
		const { plugin, emitRename, renameListenerCount } = fakePlugin({
			exists: async () => true,
			read: async () => historique,
		});
		const store = createReviewStore(plugin, fakeScanner([]));
		await store.load();
		r.check("le listener existe avant destroy", renameListenerCount(), 1);
		store.destroy();
		r.check("destroy détache son EventRef", renameListenerCount(), 0);
		emitRename({ path: "Cours/b.md" }, "Cours/a.md");
		r.check("un rename après destroy ne réarme aucun timer", clock.count(), 0);
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
