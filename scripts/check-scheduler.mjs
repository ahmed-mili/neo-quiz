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
