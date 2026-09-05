/**
 * LES DOSSIERS DE QUIZ — conversion du réglage et unicité des identifiants.
 *
 * Deux défauts que ce script empêche, et qu'une relecture ne voit pas :
 * un utilisateur qui met à jour l'application et retombe sur l'écran
 * « Choisissez un dossier » alors que son dossier est toujours là ; et deux
 * dossiers homonymes dont les chemins du contrat se confondent, ce qui
 * ferait compter l'historique de l'un pour l'autre.
 *
 *     npm run check:folders
 */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("apps/windows/src/host/folder.ts", async ({ lireDossiers, idUnique, segmentValide, MAX_DOSSIERS, appliquerExamDate }) => {
	const r = makeReporter("Dossiers — réglage et identifiants");

	r.check("aucun réglage : aucune racine", lireDossiers({}), []);

	/* La CONVERSION de la clé au singulier. Sans elle, la mise à jour perd le
	   dossier de l'utilisateur — il est là, l'application ne le sait plus. */
	r.check("la clé au singulier devient une liste d'un dossier",
		lireDossiers({ folder: "C:/obsidian-vaults/Efrei" }),
		[{ id: "Efrei", path: "C:/obsidian-vaults/Efrei", name: "Efrei" }]);
	/* `folders` GAGNE sur `folder` : une fois converti, l'ancien réglage ne
	   doit plus jamais reprendre la main. */
	r.check("folders l'emporte sur folder",
		lireDossiers({ folders: [{ id: "A", path: "D:/A", name: "A" }], folder: "C:/vieux" }).map(d => d.path),
		["D:/A"]);

	/* Deux dossiers HOMONYMES. Le second doit recevoir un identifiant
	   distinct : deux préfixes identiques feraient de « Cours/ch1.md » deux
	   notes indiscernables, et le journal de l'une compterait pour l'autre. */
	r.check("deux dossiers homonymes reçoivent des identifiants distincts",
		lireDossiers({ folders: [
			{ path: "C:/a/Cours", name: "Cours" },
			{ path: "D:/b/Cours", name: "Cours" },
		] }).map(d => d.id), ["Cours", "Cours-2"]);

	/* Un identifiant PERSISTÉ est reconduit tel quel : le recalculer ferait
	   changer tous les chemins affichés au moindre renommage. */
	r.check("un identifiant persisté est reconduit",
		lireDossiers({ folders: [{ id: "Ancien", path: "C:/x", name: "Nouveau nom" }] })[0].id, "Ancien");

	/* Un `/` dans un identifiant en ferait DEUX segments, et le premier ne
	   désignerait plus aucune racine. */
	r.check("un séparateur est neutralisé", segmentValide("a/b"), "a-b");
	r.check("un nom vide donne un identifiant utilisable", segmentValide("   "), "dossier");
	r.check("idUnique suffixe à partir de 2", idUnique("Cours", new Set(["Cours", "Cours-2"])), "Cours-3");

	/* La limite de la spec §6 est appliquée à la LECTURE aussi : un fichier
	   de réglages édité à la main ne doit pas ouvrir cinquante dossiers. */
	const onze = Array.from({ length: 11 }, (_, i) => ({ path: `C:/d${i}`, name: `d${i}` }));
	r.check("au plus dix dossiers", lireDossiers({ folders: onze }).length, MAX_DOSSIERS);

	/* Une entrée sans chemin est ignorée, pas conservée avec un chemin vide —
	   qui ouvrirait la racine du disque. */
	r.check("une entrée sans chemin est ignorée",
		lireDossiers({ folders: [{ name: "vide" }, { path: "C:/ok", name: "ok" }] }).map(d => d.path), ["C:/ok"]);

	/* LES DATES D'EXAMEN (tâche 10, mineur reporté de la tâche 8). Régler une
	   date ajoute la clé, l'effacer la RETIRE — elle n'est pas gardée vide.
	   Sans cette règle, le réglage accumulerait des entrées mortes qu'on
	   n'oserait plus nettoyer (`setExamDate` impure n'a que ce filet-ci,
	   `appliquerExamDate` étant la partie pure qu'il appelle). */
	r.check("régler une date ajoute la clé",
		appliquerExamDate({}, "Efrei/Reseaux", "2027-06-01"),
		{ "Efrei/Reseaux": "2027-06-01" });
	r.check("effacer une date RETIRE la clé, elle n'est pas gardée vide",
		appliquerExamDate({ "Efrei/Reseaux": "2027-06-01" }, "Efrei/Reseaux", ""),
		{});
	r.check("effacer la date d'un module laisse les autres matières intactes",
		appliquerExamDate(
			{ "Efrei/Reseaux": "2027-06-01", "Efrei/BDD": "2027-05-01" },
			"Efrei/Reseaux", ""),
		{ "Efrei/BDD": "2027-05-01" });

	r.done();
});
