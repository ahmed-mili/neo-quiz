import { formatLine, parseLog } from "../scheduler";

/* ══════════════════════════════════════════════════════════
   LA MIGRATION DU JOURNAL

   L'ancien journal vivait à côté du GREFFON
   (`.obsidian/plugins/quiz-blocks/review-log.jsonl`). Il vit désormais à
   côté des NOTES (`<racine>/.neo-quiz/review-log.jsonl`), pour que les deux
   hôtes le partagent et que la synchronisation du dossier l'emporte avec ce
   qu'il décrit.

   L'ORDRE EST TOUT, et c'est le même que celui de l'absorption des fichiers
   de conflit Syncthing : lire, écrire AILLEURS, RELIRE pour confirmer, et
   seulement alors renommer l'ancien — jamais le supprimer. On ne détruit
   pas une source avant d'avoir prouvé que la copie est lisible. Un ancien
   journal conservé coûte quelques kilo-octets ; un semestre de révisions
   perdu ne se rattrape pas.

   Et ce n'est pas une copie, c'est une ABSORPTION : les lignes déjà
   présentes sont ignorées. C'est ce qui rend l'opération idempotente, donc
   sûre à exécuter par les DEUX hôtes — l'ordre des installations n'a alors
   plus d'importance, et deux exécutions simultanées sur un dossier
   synchronisé ne peuvent rien perdre.
══════════════════════════════════════════════════════════ */

/** Le sous-ensemble de `HostFs` dont la migration a besoin. Déclaré ici, et
    pas importé du contrat, pour que le jeu de cas puisse le fournir sans
    fabriquer un hôte entier — c'est la même idée que `ReviewSink` côté
    moteur : on ne connaît que la FORME. */
export interface MigrationFs {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	append(path: string, data: string): Promise<void>;
	mkdirs(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

export interface MigrationResult {
	/** Lignes ajoutées ET confirmées par la relecture. */
	absorbed: number;
	/** Lignes de l'ancien déjà présentes dans le nouveau. */
	duplicates: number;
	/** Lignes illisibles de l'ancien. Non nul ⇒ on ne renomme pas. */
	ignored: number;
	/** La relecture a-t-elle retrouvé tout ce qu'on venait d'écrire ?
	    Vrai aussi quand il n'y avait rien à écrire. */
	confirmed: boolean;
	/** L'ancien a-t-il été rangé sous `.migrated` ? */
	renamed: boolean;
	/** Aucun ancien journal : il n'y avait rien à faire. */
	skipped: boolean;
}

/** Le suffixe de rangement. L'ancien fichier n'est JAMAIS supprimé. */
export const SUFFIXE_MIGRE = ".migrated";

const RIEN: MigrationResult = {
	absorbed: 0, duplicates: 0, ignored: 0, confirmed: true, renamed: false, skipped: true,
};

/** Le dossier d'un chemin, ou "" à la racine. */
function dossierDe(chemin: string): string {
	const i = chemin.lastIndexOf("/");
	return i > 0 ? chemin.slice(0, i) : "";
}

/**
 * Absorbe `ancien` dans `nouveau`, puis range `ancien`.
 *
 * Les erreurs d'entrée/sortie REMONTENT : c'est l'appelant qui décide, et il
 * décide toujours la même chose — journaliser et continuer à démarrer. Les
 * avaler ici ferait passer une migration impossible pour une migration
 * faite.
 */
export async function migrateReviewLog(
	fs: MigrationFs,
	ancien: string | null,
	nouveau: string,
): Promise<MigrationResult> {
	if (!ancien) return { ...RIEN };
	if (!(await fs.exists(ancien))) return { ...RIEN };

	const { lines, ignored } = parseLog(await fs.read(ancien));

	/* Les lignes déjà là. `finSaine` : un fichier qui ne se termine pas par un
	   saut collerait sa dernière ligne à la première absorbée, et les deux
	   deviendraient illisibles. */
	const dejaLa = new Set<string>();
	let finSaine = true;
	if (await fs.exists(nouveau)) {
		const courant = await fs.read(nouveau);
		finSaine = courant === "" || courant.endsWith("\n");
		for (const l of parseLog(courant).lines) dejaLa.add(formatLine(l));
	}

	const aAjouter: string[] = [];
	let duplicates = 0;
	for (const l of lines) {
		const cle = formatLine(l);
		if (dejaLa.has(cle)) { duplicates++; continue; }
		dejaLa.add(cle);
		aAjouter.push(cle);
	}

	let confirmed = true;
	if (aAjouter.length) {
		const dossier = dossierDe(nouveau);
		if (dossier) await fs.mkdirs(dossier);
		// `join("")` : `formatLine` termine DÉJÀ chaque ligne par un saut.
		await fs.append(nouveau, (finSaine ? "" : "\n") + aAjouter.join(""));
		/* RELIRE. On vérifie la PRÉSENCE de chaque ligne, pas un total : un
		   compte ne dit pas QUOI a été écrit. Si la relecture échoue même à
		   OUVRIR le fichier (un `append` qui prétend réussir sans jamais créer
		   la cible, cas du fichier qui n'existait pas encore), c'est encore
		   une confirmation manquée, pas une panne à remonter : c'est le rôle
		   même de la relecture que d'absorber ce genre d'échec silencieux. */
		try {
			const relu = new Set(parseLog(await fs.read(nouveau)).lines.map(formatLine));
			confirmed = !aAjouter.some(l => !relu.has(l));
		} catch {
			confirmed = false;
		}
	}

	/* Le renommage, et ses deux conditions. La relecture doit avoir confirmé,
	   et l'ancien doit avoir été entièrement COMPRIS : mieux vaut refaire une
	   passe demain (elle ne coûtera qu'une lecture, tout étant dédoublonné)
	   que ranger un fichier dont une ligne nous échappe. */
	let renamed = false;
	if (confirmed && ignored === 0) {
		try {
			await fs.rename(ancien, ancien + SUFFIXE_MIGRE);
			renamed = true;
		} catch (e) {
			/* Support en lecture seule, verrou de synchro, ou `.migrated` déjà
			   là (une migration précédente est allée jusqu'au bout). Les
			   données sont DÉJÀ dans le nouveau journal : l'échec du rangement
			   n'est pas un échec de migration, et il ne doit pas empêcher le
			   démarrage. */
		}
	}

	return {
		absorbed: confirmed ? aAjouter.length : 0,
		duplicates,
		ignored,
		confirmed,
		renamed,
		skipped: false,
	};
}
