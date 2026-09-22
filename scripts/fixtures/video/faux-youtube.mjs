/**
 * Le FAUX yt-dlp des contrôles du principal (scripts/
 * check-electron-video.mjs) : ses trois comportements sont clés par
 * l'identifiant de la vidéo, déduit de l'URL que `transcrire`
 * reconstruit. Le test INJECTE ce script dans un dossier temporaire,
 * derrière un lanceur du nom demandé (`yt-dlp.cmd` sous Windows, un
 * script sh ailleurs) — jamais le vrai PATH de la machine.
 *
 * - `privee12345` : sort en 1 en écrivant « Private video » sur stderr —
 *   le marqueur VERBATIM de yt-dlp pour une vidéo privée, supprimée ou
 *   restreinte par âge (sonde et spec §3.2) ;
 * - `lente123456` : journalise son pid et DORT — `NQ_VIDEO_SOMMEIL_MS`
 *   règle la durée (les 5 s de production doivent être éprouvables en
 *   millisecondes), PUIS sert la fixture des métadonnées. L'appel des
 *   sous-titres, lui, ne dort pas : le test de concurrence a besoin des
 *   deux, l'un après l'autre ;
 * - tout autre identifiant : `-J` sert la fixture telle quelle ; sinon
 *   le json3 de la piste demandée, écrit dans le dossier du `-o`.
 *
 * Le journal (`NQ_VIDEO_JOURNAL`) porte les arguments de CHAQUE appel :
 * c'est le témoin qui permet au contrôle d'affirmer qu'aucun
 * lancement n'a eu lieu.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const journal = process.env.NQ_VIDEO_JOURNAL;
if (journal) appendFileSync(journal, JSON.stringify(args) + "\n");

const prefixe = "https://www.youtube.com/watch?v=";
const url = args.find((a) => a.startsWith(prefixe));
const id = url ? url.slice(prefixe.length) : "";

if (id === "privee12345") {
	process.stderr.write("ERROR: [youtube] privee12345: Private video. Sign in if you've been granted access to this video.\n");
	process.exit(1);
}

if (id === "lente123456") {
	const sommeil = Number(process.env.NQ_VIDEO_SOMMEIL_MS || 5000);
	if (journal) appendFileSync(journal, "DEBUT " + process.pid + " " + Date.now() + "\n");
	if (args.includes("-J")) {
		setTimeout(() => {
			if (journal) appendFileSync(journal, "FIN " + process.pid + "\n");
			process.stdout.write(readFileSync(process.env.NQ_VIDEO_FIXTURE, "utf8"));
			process.exit(0);
		}, sommeil);
	} else {
		const i = args.indexOf("-o");
		const j = args.indexOf("--sub-langs");
		if (i >= 0 && j >= 0) {
			const cle = args[j + 1];
			const dossierSortie = dirname(args[i + 1]);
			const cible = join(dossierSortie, "s." + cle + ".json3");
			const contenu = JSON.stringify({
				events: [
					{ tStartMs: 0, segs: [{ utf8: "bonjour la vidéo" }] },
					{ tStartMs: 3000, segs: [{ utf8: "et encore" }] },
				],
			});
			writeFileSync(cible, contenu);
		}
		process.exit(0);
	}
} else if (args.includes("-J")) {
	process.stdout.write(readFileSync(process.env.NQ_VIDEO_FIXTURE, "utf8"));
	process.exit(0);
} else {
	const i = args.indexOf("-o");
	const j = args.indexOf("--sub-langs");
	if (i >= 0 && j >= 0) {
		const cle = args[j + 1];
		const dossierSortie = dirname(args[i + 1]);
		const cible = join(dossierSortie, "s." + cle + ".json3");
		const contenu = JSON.stringify({
			events: [
				{ tStartMs: 0, segs: [{ utf8: "bonjour la vidéo" }] },
				{ tStartMs: 3000, segs: [{ utf8: "et encore" }] },
			],
		});
		writeFileSync(cible, contenu);
	}
	process.exit(0);
}