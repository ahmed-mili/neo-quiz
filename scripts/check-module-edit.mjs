/** Vérifie le contrat de persistance du modal avec l'adaptateur de révision :
 * la valeur du champ date reste une date civile ISO et une date effacée ne
 * laisse aucune clé vide susceptible de masquer le repli durable. */
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

await withSrcModule("src/dashboard/module-edit.ts", async ({ buildModuleOverride }) => {
	const r = makeReporter("Modal module — date d'examen");
	const folder = "Reseaux";
	const renseigne = {
		[folder]: buildModuleOverride(folder, {
			name: "Réseaux",
			ue: "UE 3",
			color: "#336699",
			icon: "network",
			examDate: "2027-06-01",
		}),
	};
	r.check("la date civile ISO et les autres champs sont conservés", renseigne, {
		Reseaux: {
			name: "Réseaux",
			ue: "UE 3",
			color: "#336699",
			icon: "network",
			examDate: "2027-06-01",
		},
	});

	const efface = {
		[folder]: buildModuleOverride(folder, {
			name: "Réseaux",
			ue: "UE 3",
			color: "#336699",
			icon: "network",
			examDate: undefined,
		}),
	};
	r.check("effacer la date préserve les autres champs", efface, {
		Reseaux: {
			name: "Réseaux",
			ue: "UE 3",
			color: "#336699",
			icon: "network",
		},
	});
	r.check("une date effacée supprime entièrement la clé", "examDate" in efface[folder], false);

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
	r.done();
});
