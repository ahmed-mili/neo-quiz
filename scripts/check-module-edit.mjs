/** Vérifie le contrat de persistance du modal « Modifier dossier » :
 * ce que `buildModuleOverride` écrit dans `quizzesModuleOverrides`, et surtout
 * ce qu'il n'y écrit PLUS.
 *
 * LA DATE D'EXAMEN N'EST PLUS UN OVERRIDE (2026-09-17), et c'est la règle que
 * ce script tient. Les overrides sont indexés par `ModuleGroup.folder`, un NOM
 * DE SEGMENT sans l'identifiant de la racine : deux dossiers ouverts ayant
 * chacun un sous-dossier « Generated » partagent la même entrée. Pour une
 * couleur, c'est un défaut visible ; pour un HORIZON DE RÉTENTION, c'est une
 * matière dont les révisions se resserrent à cause de l'examen d'une autre.
 * La date vit désormais sous la clé de module de l'hôte
 * (`DashboardShellCtx.setExamDate`), qui porte la racine.
 *
 * Le dernier cas est le CLIQUET : il passe une date malgré tout, comme le
 * ferait un appelant qui la remettrait « pour aller vite », et exige qu'elle
 * ne soit pas persistée. Sans lui, le retour en arrière ne rougirait nulle
 * part — le champ réapparaîtrait simplement dans le JSON, sans lecteur. */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/module-edit.ts", async ({ buildModuleOverride }) => {
	const r = makeReporter("Modal module — override persisté");
	const folder = "Reseaux";

	const renseigne = buildModuleOverride(folder, {
		name: "Réseaux",
		ue: "UE 3",
		color: "#336699",
		icon: "network",
	});
	r.check("les champs renseignés sont conservés", renseigne, {
		name: "Réseaux",
		ue: "UE 3",
		color: "#336699",
		icon: "network",
	});

	const nomIdentique = buildModuleOverride(folder, {
		name: "Reseaux",
		ue: "UE 3",
	});
	r.check("un nom identique au dossier ne crée pas d'override", nomIdentique, {
		ue: "UE 3",
	});

	const sansUe = buildModuleOverride(folder, {
		name: "Réseaux",
		ue: null,
	});
	r.check("Sans UE reste un override explicite", sansUe, {
		name: "Réseaux",
		ue: null,
	});

	/* Le cliquet. `examDate` n'est plus dans le type, donc ce cas ne peut venir
	   que d'un appelant JavaScript ou d'un retour en arrière — les deux doivent
	   échouer à l'écrire. */
	const avecDate = buildModuleOverride(folder, {
		name: "Réseaux",
		ue: "UE 3",
		examDate: "2027-06-01",
	});
	r.check("une date d'examen n'entre PAS dans les overrides", "examDate" in avecDate, false);

	/* LE CHEMIN SURVIT À UNE ÉDITION (2026-09-17). Un dossier déclaré par
	   « Ouvrir un dossier existant » porte son chemin du contrat dans
	   l'override ; le modal « Modifier dossier » RECONSTRUIT l'override entier
	   à chaque frappe, et sans ce report, renommer le dossier effaçait son
	   chemin — « Nouveau quiz » y retombait sur le segment seul, et échouait. */
	const avecChemin = buildModuleOverride(folder, {
		name: "Réseaux",
		ue: "UE 3",
		path: "Efrei/B2 (2026-2027)/Reseaux",
	});
	r.check("le chemin déclaré est reporté tel quel", avecChemin.path, "Efrei/B2 (2026-2027)/Reseaux");
	r.check("et un override sans chemin n'en invente pas", "path" in renseigne, false);

	r.done();
});

/* ── Le chemin réel d'un module, là où il se DÉDUIT et là où il se PORTE ──
   `folder` est un segment ; ce qu'on écrit veut un chemin du contrat. */
await withSrcModule("src/dashboard/quiz-modules.ts", async ({ moduleForQuiz, applyModuleOverrides, buildModuleGroups }) => {
	const r = makeReporter("Modules — le chemin réel d'un dossier");
	const vide = { byFolder: new Map(), ueOrder: [] };

	r.check("sans table, le module est le parent immédiat, ET son chemin complet",
		moduleForQuiz("Neo Quiz/Generated/langage C.md", vide),
		{ folder: "Generated", name: "Generated", ue: null, path: "Neo Quiz/Generated" });
	r.check("un quiz à la racine d'un dossier ouvert : le segment est déjà le chemin",
		moduleForQuiz("Neo Quiz/x.md", vide).path, "Neo Quiz");

	const table = { byFolder: new Map([["XTI301", { folder: "XTI301", name: "Python", ue: "S3" }]]), ueOrder: ["S3"] };
	r.check("un module reconnu plus haut dans le chemin rend le chemin JUSQU'À lui",
		moduleForQuiz("Efrei/B2 (2026-2027)/XTI301/TP/quiz.md", table).path,
		"Efrei/B2 (2026-2027)/XTI301");

	const declare = applyModuleOverrides(vide, { XTI301: { name: "Python", path: "Efrei/B2 (2026-2027)/XTI301" } });
	r.check("un override porte son chemin dans la table",
		declare.byFolder.get("XTI301")?.path, "Efrei/B2 (2026-2027)/XTI301");
	r.check("et ce chemin DÉCLARÉ l'emporte sur celui déduit d'un quiz",
		moduleForQuiz("Autre/XTI301/quiz.md", declare).path, "Efrei/B2 (2026-2027)/XTI301");

	const groupes = buildModuleGroups(
		[{ path: "Neo Quiz/Generated/a.md", title: "a", questionCount: 1 }],
		{}, declare, ["XTI301"]);
	const parDossier = new Map(groupes.map(g => [g.folder, g.path]));
	r.check("un dossier déclaré SANS quiz a le chemin de sa déclaration",
		parDossier.get("XTI301"), "Efrei/B2 (2026-2027)/XTI301");
	r.check("un dossier jamais déclaré a le chemin déduit de son premier quiz",
		parDossier.get("Generated"), "Neo Quiz/Generated");

	r.done();
});


/* CE QUE LE MODAL MONTRE, et non plus seulement ce qu'il écrit. Il résolvait
   lui-même l'icône et la teinte (`DEFAULT_MODULE_ICON`, `hashAccent`) : sur le
   SAS des quiz générés, son aperçu affichait un livre violet quand la carte,
   elle, montrait l'étincelle bleue (Ahmed, 2026-09-17). Les deux règles sont
   désormais des fonctions PURES, partagées par les trois lecteurs — c'est
   elles que ce bloc éprouve, puisque le modal n'en a plus d'autre. */
await withSrcModule("src/dashboard/module-icons.ts", async ({ moduleIcon }) => {
	const r = makeReporter("Module — l'icône affichée");
	r.check("un module sans icône prend le défaut", moduleIcon({}), "book");
	r.check("le SAS sans icône prend celle de l'IA", moduleIcon({}, { generated: true }), "sparkles");
	r.check("une icône choisie l'emporte, même sur le SAS",
		moduleIcon({ icon: "network" }, { generated: true }), "network");
	/* Une chaîne vide vient d'un champ effacé, pas d'un choix : elle doit
	   retomber sur le défaut comme une absence, sinon la pastille se vide. */
	r.check("une icône vide vaut une absence", moduleIcon({ icon: "" }, { generated: true }), "sparkles");
	r.done();
});

await withSrcModule("src/dashboard/quiz-modules.ts", async ({ estLeSas, emplacementDeModule }) => {
	const r = makeReporter("Module — reconnaître le SAS");
	const sas = "Neo Quiz/Generated";
	r.check("le dossier dont le CHEMIN est celui du sas", estLeSas({ folder: "Generated", path: sas }, sas), true);
	/* Le piège que le chemin évite : un dossier qui porte le même NOM ailleurs
	   dans le vault n'est pas le sas. */
	r.check("un homonyme ailleurs n'est pas le sas",
		estLeSas({ folder: "Generated", path: "Autre/Generated" }, sas), false);
	r.check("sans sas déclaré (le greffon), aucun dossier ne l'est",
		estLeSas({ folder: "Generated", path: sas }, undefined), false);
	r.check("un groupe sans chemin n'est jamais le sas", estLeSas({ folder: "Generated" }, sas), false);

	/* CE QUE LA CARTE MONTRE DU CHEMIN : sa racine et son parent, jamais le
	   chemin entier — son dernier segment est le nom du dossier, déjà en
	   titre. Une carte fait 350 px, et l'ellipsis du CSS coupe par la FIN :
	   sans la réduction du milieu, ce serait le parent immédiat qui sauterait,
	   c'est-à-dire le seul segment qui situe (Ahmed, 2026-09-17). */
	r.check("un dossier à la racine rend la racine seule",
		emplacementDeModule("Personal", "Templates"), "Personal");
	r.check("un seul parent est nommé en entier",
		emplacementDeModule("Efrei", "Cours/XTI301"), "Efrei / Cours");
	r.check("au-delà, le milieu se réduit et le parent reste",
		emplacementDeModule("Efrei", "Bachelor/B2 (2026-2027)/XTI301"), "Efrei / … / B2 (2026-2027)");
	r.check("un chemin plus profond n'allonge pas le résultat",
		emplacementDeModule("Efrei", "a/b/c/d/XTI301"), "Efrei / … / d");
	/* Un chemin qui traîne un séparateur ne doit pas rendre « racine / … / »
	   avec une moitié vide. */
	r.check("les segments vides ne comptent pas",
		emplacementDeModule("Personal", "/Templates/"), "Personal");
	r.done();
});
