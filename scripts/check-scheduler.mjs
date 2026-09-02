/**
 * Vérification de l'ORDONNANCEUR (src/scheduler/).
 *
 * Ce script existe pour la même raison que check:md et check:export : c'est
 * de la logique qu'une relecture ne suffit pas à juger. Il charge le CODE
 * RÉEL via load-src.mjs — une réplique finirait par diverger de l'originale
 * et validerait le vide.
 *
 *     npm run check:scheduler
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const JOUR = 86400000;
const HEURE = 3600000;

/* ── PURETÉ ──
   Le noyau doit tourner hors d'Obsidian, sans écran et sans horloge. C'est
   la condition qui rend ce module réutilisable par les applications PC et
   Android ; sans contrôle mécanique, elle s'érode au premier appel
   « pratique » à Date.now(). */
{
	const r = makeReporter("Ordonnanceur — pureté du noyau");
	const INTERDITS = [
		[/from\s+["']obsidian["']/, "import obsidian"],
		[/\bdocument\./, "document"],
		[/\bwindow\./, "window"],
		[/\bDate\.now\s*\(/, "Date.now()"],
		[/\bnew\s+Date\s*\(/, "new Date()"],
		[/\bMath\.random\s*\(/, "Math.random()"],
	];
	const dir = "src/scheduler";
	for (const f of readdirSync(dir).filter(n => n.endsWith(".ts"))) {
		const src = readFileSync(join(dir, f), "utf8");
		for (const [re, nom] of INTERDITS) {
			r.check(`${f} sans ${nom}`, re.test(src), false);
		}
	}
	r.done();
}

await withSrcModule(["src/scheduler/horizon.ts", "src/scheduler/params.ts"], (h, p) => {
	const r = makeReporter("Ordonnanceur — horizon");
	const P = p.DEFAULT_PARAMS;
	const j = (n) => n * JOUR;
	const arrondi = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

	// Les deux ancrages de Cepeda sont respectés au ratio près.
	r.check("ratio à 7 j", arrondi(h.retentionRatio(j(7), P)), 0.3);
	r.check("ratio à 365 j", arrondi(h.retentionRatio(j(365), P)), 0.075);

	// Valeurs intermédiaires (spec §5.1), en jours de plafond.
	r.check("plafond à 30 j", arrondi(h.intervalCeiling(j(30), P) / JOUR, 1), 6.5);
	r.check("plafond à 90 j", arrondi(h.intervalCeiling(j(90), P) / JOUR, 1), 13.9);

	/* MONOTONIE : c'est ce que le bornage de H protège. Sans lui, le ratio
	   devient négatif vers 1364 jours et un horizon de 3 ans donnerait un
	   plafond plus court qu'un horizon d'un an. */
	let croissant = true;
	let precedent = -1;
	for (const jours of [1, 2, 5, 7, 14, 30, 90, 180, 365, 730, 1095, 3650]) {
		const v = h.intervalCeiling(j(jours), P);
		if (v <= precedent) croissant = false;
		precedent = v;
	}
	r.check("plafond strictement croissant, y compris au-delà de 365 j", croissant, true);

	// Hors du domaine mesuré, on n'extrapole pas : le ratio est borné.
	r.check("ratio à 1 j = ratio à 7 j (pas d'extrapolation)",
		arrondi(h.retentionRatio(j(1), P)), arrondi(h.retentionRatio(j(7), P)));

	// Un examen PASSÉ retombe sur l'horizon par défaut.
	const now = 1_000_000_000_000;
	r.check("examen passé → horizon par défaut", h.horizonFor(now - j(1), now, P), P.horizonDefaut);
	r.check("pas de date → horizon par défaut", h.horizonFor(null, now, P), P.horizonDefaut);
	r.check("examen dans 7 j → 7 j", h.horizonFor(now + j(7), now, P), j(7));

	r.done();
});

await withSrcModule("src/scheduler/log.ts", (log) => {
	const r = makeReporter("Ordonnanceur — journal");

	// Aller-retour.
	const e = { t: "answer", q: "note.md::q1", at: 1700000000000, grade: "correct", role: "test" };
	const relu = log.parseLog(log.formatLine(e));
	r.check("aller-retour d'un événement", relu.lines, [e]);
	r.check("rien d'ignoré", relu.ignored, 0);

	/* TOLÉRANCE : un fichier tronqué par une fermeture brutale doit perdre
	   une révision, pas un semestre. C'est la raison de préférer le JSONL à
	   un objet JSON unique. */
	const abime = log.formatLine(e) + '{"t":"answer","q":"b","at":\n' + log.formatLine({ ...e, q: "c" });
	r.check("ligne corrompue ignorée, le reste survit", abime2ids(log, abime), ["note.md::q1", "c"]);
	r.check("la corruption est comptée", log.parseLog(abime).ignored, 1);

	// Une ligne sans les champs requis n'est pas un événement.
	r.check("ligne sans grade ignorée", log.parseLog('{"t":"answer","q":"a","at":1}\n').lines.length, 0);
	r.check("ligne d'un type inconnu ignorée", log.parseLog('{"t":"autre"}\n').lines.length, 0);
	r.check("ligne vide ignorée sans compter", log.parseLog("\n\n").ignored, 0);

	// RENOMMAGE : la clé suit la note, y compris par préfixe de dossier.
	const journal = [
		log.formatLine({ t: "answer", q: "Cours/Reseaux/ch1.md::q1", at: 1, grade: "correct" }),
		log.formatLine({ t: "rename", from: "Cours/Reseaux", to: "Cours/Réseaux", at: 2 }),
		log.formatLine({ t: "answer", q: "Cours/Réseaux/ch1.md::q1", at: 3, grade: "wrong" }),
	].join("");
	const applique = log.applyRenames(log.parseLog(journal).lines);
	r.check("renommage de dossier appliqué par préfixe",
		applique.map(x => x.q), ["Cours/Réseaux/ch1.md::q1", "Cours/Réseaux/ch1.md::q1"]);
	r.check("les lignes de renommage ne restent pas des réponses",
		applique.every(x => x.t === "answer"), true);

	// Un renommage n'affecte QUE les événements qui le précèdent.
	const apres = log.applyRenames(log.parseLog([
		log.formatLine({ t: "rename", from: "a.md", to: "b.md", at: 1 }),
		log.formatLine({ t: "answer", q: "a.md::q1", at: 2, grade: "correct" }),
	].join("")).lines);
	r.check("un événement postérieur au renommage n'est pas re-déplacé",
		apres.map(x => x.q), ["a.md::q1"]);

	// VALIDATION DU ROLE : asymétrie volontaire.
	const avecRole = { t: "answer", q: "x", at: 1, grade: "correct", role: "pre" };
	const relectRole = log.parseLog(log.formatLine(avecRole));
	r.check("role valide conservé après aller-retour", relectRole.lines[0].role, "pre");

	const avecRoleInconnu = log.parseLog(log.formatLine({ t: "answer", q: "y", at: 2, grade: "correct", role: "inconnu" }));
	r.check("role inconnu : ligne présente sans role, ignored=0",
		{ present: avecRoleInconnu.lines.length > 0, hasRole: !!avecRoleInconnu.lines[0]?.role, ignored: avecRoleInconnu.ignored },
		{ present: true, hasRole: false, ignored: 0 });

	r.done();
});

/** Ids des événements survivants d'un journal abîmé. */
function abime2ids(log, texte) {
	return log.parseLog(texte).lines.filter(l => l.t === "answer").map(l => l.q);
}

await withSrcModule(["src/scheduler/state.ts", "src/scheduler/params.ts"], (st, p) => {
	const r = makeReporter("Ordonnanceur — état dérivé");
	const P = p.DEFAULT_PARAMS;
	const T0 = 1_700_000_000_000;
	const j = (n) => n * JOUR;
	const item = (q, mod = "M") => ({ q, module: mod, source: "s" });
	const rep = (q, at, grade, role) => ({ t: "answer", q, at, grade, ...(role ? { role } : {}) });
	const etat = (events, horizons = {}, now = T0 + j(100)) =>
		st.deriveStates({ now, items: [item("a")], events, horizons, params: P }).get("a");

	// Une question jamais répondue est NEUVE et due immédiatement.
	const neuf = etat([]);
	r.check("jamais répondue → isNew", neuf.isNew, true);
	r.check("jamais répondue → pas d'échéance", neuf.dueAt, null);

	// Premier succès → intervalle initial.
	r.check("premier succès → intervalleInitial",
		etat([rep("a", T0, "correct")]).interval, P.intervalleInitial);

	/* Croissance : le second succès doit avoir lieu APRÈS l'échéance, sinon
	   le garde-fou de double révision s'applique (cas suivant). */
	r.check("second succès dû → ×facteurSucces",
		etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "correct")]).interval,
		P.intervalleInitial * P.facteurSucces);

	/* GARDE-FOU : rejouer le même quiz dans l'heure ne doit PAS doubler
	   l'intervalle. Sans lui, le compteur de répétitions remplacerait
	   l'espacement, seul mécanisme que la littérature valide. */
	r.check("succès trop tôt → intervalle inchangé",
		etat([rep("a", T0, "correct"), rep("a", T0 + HEURE, "correct")]).interval,
		P.intervalleInitial);

	// Échec → intervalle court, et le compteur d'échecs monte.
	const rate = etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "correct"), rep("a", T0 + j(5), "wrong")]);
	r.check("échec → intervalleEchec", rate.interval, P.intervalleEchec);
	r.check("échec → streak remis à zéro", rate.streak, 0);
	r.check("échec compté", rate.lapses, 1);

	// L'auto-évaluation compte, et « partiel » amortit.
	r.check("understood = succès plein",
		etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "understood")]).interval,
		P.intervalleInitial * P.facteurSucces);
	r.check("partial amortit",
		etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "partial")]).interval,
		P.intervalleInitial * P.facteurPartiel);
	r.check("review = échec",
		etat([rep("a", T0, "correct"), rep("a", T0 + j(1), "review")]).interval,
		P.intervalleEchec);

	/* Un `pre` raté ne raccourcit RIEN : chez Richland, Kornell & Kao,
	   c'est le groupe qui a essayé ET échoué qui a le mieux appris. */
	r.check("pre raté → aucun signal", etat([rep("a", T0, "wrong", "pre")]).isNew, true);
	r.check("pre réussi → aucun signal", etat([rep("a", T0, "correct", "pre")]).isNew, true);
	r.check("carte read → aucun signal", etat([rep("a", T0, "seen", "read")]).isNew, true);
	r.check("abandon explicite → aucun signal", etat([rep("a", T0, "skipped")]).isNew, true);

	/* PLAFOND : avec un partiel dans 7 jours, l'intervalle ne dépasse
	   jamais 2,1 jours, quel que soit le nombre de succès. */
	const serie = [];
	for (let k = 0; k < 10; k++) serie.push(rep("a", T0 + j(k * 3), "correct"));
	const now = T0 + j(27) + j(1);
	const plafonne = st.deriveStates({
		now, items: [item("a")], events: serie,
		horizons: { M: now + j(7) }, params: P,
	}).get("a");
	r.check("intervalle plafonné par l'horizon", plafonne.interval <= 2.11 * JOUR, true);

	/* JAMAIS DE SORTIE DU SYSTÈME : dix succès de suite laissent une
	   échéance finie. Une question qui sortirait après une réussite
	   sacrifierait exactement ce que l'espacement sert à obtenir. */
	const dix = st.deriveStates({
		now, items: [item("a")], events: serie, horizons: {}, params: P,
	}).get("a");
	r.check("dix succès → échéance toujours finie", Number.isFinite(dix.dueAt), true);
	r.check("dix succès → toujours pas neuve", dix.isNew, false);

	/* RE-BORNAGE AU PLAFOND ACTUEL : un intervalle calculé quand l'examen
	   était loin doit se resserrer quand il approche. */
	const large = [rep("a", T0, "correct"), rep("a", T0 + j(1), "correct"), rep("a", T0 + j(3), "correct")];
	const proche = st.deriveStates({
		now: T0 + j(3), items: [item("a")], events: large,
		horizons: { M: T0 + j(5) }, params: P,
	}).get("a");
	r.check("l'examen qui approche resserre l'intervalle déjà acquis",
		proche.interval <= P.intervalleInitial * P.facteurSucces, true);

	// Un événement dont la question n'existe plus n'est jamais planifié.
	const orphelin = st.deriveStates({
		now, items: [item("a")], events: [rep("disparue", T0, "correct")],
		horizons: {}, params: P,
	});
	r.check("événement orphelin ignoré", orphelin.has("disparue"), false);
	r.check("l'item existant reste neuf", orphelin.get("a").isNew, true);

	r.done();
});
