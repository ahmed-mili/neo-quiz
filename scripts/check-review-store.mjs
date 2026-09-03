/**
 * Vérification de l'ADAPTATEUR OBSIDIAN de l'ordonnanceur
 * (src/dashboard/review-store.ts).
 *
 * Contrairement à check-scheduler.mjs, ce module a le DROIT de toucher
 * Obsidian, Date et setTimeout — ce script ne vérifie donc pas la pureté,
 * mais le CÂBLAGE, et les deux garde-fous propres à l'adaptateur (portés
 * par la revue de la task 7, absents du noyau par conception) :
 *   1. une date d'examen qui produit un horizon NaN ne doit JAMAIS
 *      atteindre le noyau ;
 *   2. un chemin de renommage à slash de fin ne doit jamais être écrit
 *      tel quel dans le journal.
 *
 *     node scripts/check-review-store.mjs
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const JOUR = 86400000;

/** Plugin hôte minimal : seuls les membres réellement lus par review-store
    sont fournis, dans l'esprit duck-typing des autres scripts check-*. */
function fakePlugin() {
	const appended = [];
	let renameHandler = null;
	const plugin = {
		manifest: { dir: "vault/.obsidian/plugins/quiz-blocks" },
		app: {
			vault: {
				adapter: {
					read: async () => { throw new Error("ENOENT"); }, // premier démarrage
					append: async (_path, texte) => { appended.push(texte); },
				},
				on: (nom, cb) => { if (nom === "rename") renameHandler = cb; return {}; },
			},
		},
		registerEvent: () => {},
		settings: { quizzesModuleOverrides: {} },
	};
	return { plugin, appended, getRenameHandler: () => renameHandler };
}

const fakeScanner = (quizzes) => ({ getQuizzes: () => quizzes });

/** `destroy()` déclenche `flush()` immédiatement (sans attendre les 500 ms
    du débounce) mais sans l'attendre lui-même (`void flush()`) : une
    micro-pause suffit à laisser sa promesse (I/O simulée, sans délai réel)
    se résoudre. */
const tick = () => new Promise(res => setTimeout(res, 20));

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — clé opaque");
	const { plugin } = fakePlugin();
	const store = createReviewStore(plugin, fakeScanner([]));
	r.check("keyOf assemble chemin et id par ::", store.keyOf("Cours/ch1.md", "q1"), "Cours/ch1.md::q1");
	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — catalogue depuis le scanner");
	const quizzes = [
		{
			path: "Cours/Reseaux/ch1.md",
			items: [
				{ id: "q1", role: "test", slice: 2 },
				{ id: "q2" }, // ni role ni tranche
			],
		},
		{ path: "notes-racine.md", items: [{ id: "q1", role: "recall" }] },
	];
	const { plugin } = fakePlugin();
	const store = createReviewStore(plugin, fakeScanner(quizzes));
	const plan = store.plan(1_700_000_000_000);
	// Les 3 questions du catalogue (2 + 1) doivent toutes être vues comme
	// neuves par le noyau : la preuve que catalogue() les a bien émises
	// (une erreur d'agrégation — item manquant, ou dupliqué par un bug de
	// clé — changerait immédiatement ce compte).
	r.check("les 3 questions du catalogue sont comptées comme neuves", plan.stats.new, 3);
	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — horizon (garde NaN, decision 2)");

	const item = { path: "Cours/Reseaux/ch1.md", items: [{ id: "q1" }] };
	const now = Date.now();

	/** Enregistre une réponse "correct" puis renvoie le plan 2 jours plus
	    tard, sous l'override d'examDate donné (ou aucun). Un item répondu
	    quitte l'état "neuf" et passe par le calcul d'intervalle/échéance —
	    c'est ce chemin, pas le chemin "neuf", que l'horizon influence. */
	async function planApres(overrides) {
		const { plugin } = fakePlugin();
		plugin.settings.quizzesModuleOverrides = overrides;
		const store = createReviewStore(plugin, fakeScanner([item]));
		await store.load();
		store.record([{ q: store.keyOf(item.path, "q1"), grade: "correct" }]);
		return store.plan(now + 2 * JOUR);
	}

	/* PREUVE PAR ÉQUIVALENCE, PAS PAR ABSENCE DE PLANTAGE : un `horizonFor`
	   nourri de NaN ne lève jamais — il propage NaN dans `interval`/`dueAt`,
	   et les comparaisons `dueAt <= now` etc. valent alors toutes FAUX
	   (sémantique NaN de JS), donc l'item sort silencieusement de `dus`,
	   `futurs` ET du forecast : il ne réapparaît plus jamais nulle part,
	   sans qu'aucun champ du Plan ne contienne de NaN visible. La seule
	   preuve directe est donc de comparer :
	     A. aucun override du tout (repli normal sur l'horizon par défaut) ;
	     B. un override dont l'année (275761) dépasse le domaine
	        représentable par `Date` (~275 760, ECMA-262 Time Range) — ses
	        3 composants sont pourtant des nombres non nuls, donc le premier
	        filtre (`!a||!m||!j`) le LAISSE PASSER ; seul `Number.isFinite(t)`
	        l'arrête.
	   Avec la garde (code actuel) : l'override B est rejeté puis IGNORÉ
	   exactement comme A (repli sur l'horizon par défaut) → plans
	   identiques. Sans elle, `horizons["Cours/Reseaux"]` vaudrait NaN en B
	   (`?? null` dans state.ts ne remplace que null/undefined, jamais NaN),
	   l'item y disparaîtrait de la planification tout en restant présent en
	   A → les deux plans DIVERGERAIENT. */
	const A = await planApres({});
	const B = await planApres({ "Cours/Reseaux": { examDate: "275761-01-01" } });
	r.check("un horizon hors du domaine Date retombe sur le même plan qu'aucun override", B, A);

	r.done();
});

await withSrcModule("src/dashboard/review-store.ts", async ({ createReviewStore }) => {
	const r = makeReporter("Adaptateur — renommage (garde slash de fin, decision 3)");

	{
		const { plugin, appended, getRenameHandler } = fakePlugin();
		const store = createReviewStore(plugin, fakeScanner([]));
		await store.load();
		const handler = getRenameHandler();
		r.check("un handler de rename a bien été enregistré sur le vault", typeof handler, "function");

		// Simule un renommage de DOSSIER dont les deux chemins arrivent
		// avec un slash de fin.
		handler({ path: "Cours/Réseaux/" }, "Cours/Reseaux/");
		store.destroy();
		await tick();

		r.check("une ligne a bien été écrite", appended.length, 1);
		const ligne = JSON.parse(appended[0].trim());
		r.check("type 'rename'", ligne.t, "rename");
		/* Si review-store écrivait `oldPath`/`file.path` bruts (sans
		   sansSlashFinal), ces deux valeurs porteraient un "/" de fin —
		   c'est EXACTEMENT ce que ce couple de vérifications distingue. */
		r.check("'from' sans slash de fin", ligne.from, "Cours/Reseaux");
		r.check("'to' sans slash de fin", ligne.to, "Cours/Réseaux");
	}

	{
		// Deux chemins identiques une fois normalisés (ne différant que par
		// un slash de fin) : un renommage no-op ne doit rien écrire.
		const { plugin, appended, getRenameHandler } = fakePlugin();
		const store = createReviewStore(plugin, fakeScanner([]));
		await store.load();
		getRenameHandler()({ path: "Cours" }, "Cours/");
		store.destroy();
		await tick();
		r.check("un renommage no-op (slash de fin près) n'écrit rien", appended.length, 0);
	}

	r.done();
});
