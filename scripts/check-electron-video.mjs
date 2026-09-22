/**
 * Vérification du LANCEMENT de yt-dlp par le processus principal
 * (apps/windows/electron/video.ts) — tâche 2 du chantier « vidéos YouTube »
 * (docs/superpowers/plans/2026-09-22-videos-youtube.md).
 *
 * CE QUE CES CAS EMPÊCHENT, et qu'aucun typecheck ne voit :
 * — un identifiant hors regex qui ferait lancer yt-dlp sur une URL composée
 *   de n'importe quoi (il est revalidé AVANT tout lancement, et l'URL est
 *   reconstruite, jamais reçue de la fenêtre) ;
 * — un chemin d'exécutable venu du rendu : la résolution est copie gérée
 *   PUIS recherche sur un PATH étendu, jamais un paramètre ;
 * — des arguments qui dériveraient de la liste figée (les arguments exacts
 *   des deux appels sont relus dans le journal du faux yt-dlp) ;
 * — un dossier temporaire qui survivrait à une transcription ;
 * — un yt-dlp qui traîne après le délai (l'ARBRE est tué, pas le seul
 *   parent — le faux dort, et le témoin est son pid) ;
 * — une miniature en échec qui ferait échouer la transcription (elle vaut
 *   null, jamais bloquant) ;
 * — plus de DEUX transcriptions en parallèle.
 *
 * SUR DE VRAIS PROCESS : le faux yt-dlp est la FIXTURE
 * scripts/fixtures/video/faux-youtube.mjs (un script qui lance Node, le
 * lanceur du nom demandé — `.cmd` sous Windows, un sh ailleurs — les deux
 * formes d'une vraie installation), écrit dans un dossier temporaire et
 * INJECTÉ par l'environnement donné — jamais installé sur la machine,
 * jamais le vrai PATH. Le faux journalise ses appels dans un fichier pour
 * que le contrôle puisse dire « aucun appel n'a eu lieu ».
 *
 *     npm run check:electron-video
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** Le délai de garde d'UN cas : de vrais process tournent, un cas figé
    masquerait tous les suivants (voir check-electron-process.mjs). */
const DELAI_CAS_MS = 60000;

async function cas(r, nom, fn) {
	let minuteur = null;
	const garde = new Promise((_, reject) => {
		minuteur = setTimeout(() => reject(new Error("DÉLAI DÉPASSÉ (" + DELAI_CAS_MS + " ms) : le cas n'a jamais rendu la main")), DELAI_CAS_MS);
	});
	try {
		await Promise.race([fn(), garde]);
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "pas d'exception");
	} finally {
		clearTimeout(minuteur);
	}
}

const dodo = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── LE FAUX YT-DLP ──
   Ses trois comportements sont clés par l'IDENTIFIANT de la vidéo
   (déduit de l'URL que `transcrire` reconstruit), comme la spec les
   décrit : « Private video » est le marqueur VERBATIM de yt-dlp pour
   une vidéo privée/supprimée/restreinte (sonde et spec §3.2) — donnée
   de test, pas une chaîne d'interface. Le sommeil est réglable par
   l'environnement : les 5 s de production doivent être éprouvables en
   millisecondes. Le source du faux vit dans la FIXTURE
   scripts/fixtures/video/faux-youtube.mjs — lisible, citable tel
   quel : le contrôle le recopie dans le dossier du faux. */
const FAUX_MJS = join("scripts", "fixtures", "video", "faux-youtube.mjs");

/** Le lanceur du nom demandé : `.cmd` sous Windows (l'extension que
    PATHEXT fait trouver), un script sh exécutable ailleurs. */
const fauxLanceur = (dossier) => process.platform === "win32"
	? { corps: '@echo off\r\n"' + process.execPath + '" "' + join(dossier, "faux.mjs") + '" %*\r\n', nom: "yt-dlp.cmd" }
	: { corps: '#!/bin/sh\nexec "' + process.execPath + '" "' + join(dossier, "faux.mjs") + '" "$@"\n', nom: "yt-dlp" };

/** Un environnement où seul `dossier` est joignable, et où rien du vrai
    disque de la machine n'entre : ni APPDATA ni LOCALAPPDATA, d'où
    `dossiersCli` et les dossiers de Python ne tirent que des chemins sous
    le dossier temporaire du contrôle (inexistants → sautés). `plus`
    rajoute ce qu'un cas veut injecter (APPDATA, LOCALAPPDATA…). */
const envDe = (dossier, maison, plus = {}) => ({
	PATH: dossier,
	SystemRoot: process.env.SystemRoot,
	ComSpec: process.env.ComSpec,
	PATHEXT: process.env.PATHEXT,
	TEMP: process.env.TEMP,
	TMP: process.env.TMP,
	USERPROFILE: maison,
	HOME: maison,
	...plus,
});

/** PATHEXT arrive en MAJUSCULES sous Windows : le chemin trouvé porte
    « .EXE » là où le fichier posé s'appelle « .exe » — même fichier,
    système insensible à la casse (voir check-electron-process.mjs). */
const bas = (p) => (typeof p === "string" ? p.toLowerCase() : p);

/** Le rejet d'une `transcrire`, réduit à ce que la spec fait porter vers
    le rendu : le CODE (jamais un message traduit) et son détail de
    journal. Une résolution est un rejet sans `code` (introuvable hors du
    module) : nommé pour qu'il ne passe jamais inaperçu. */
const nomDuRejet = async (promesse) => {
	try {
		await promesse;
		return "(aucun rejet)";
	} catch (e) {
		return e && e.code ? { code: e.code, detail: e.detail ?? null } : "EXCEPTION: " + (e && e.message ? e.message : String(e));
	}
};

await withSrcModule("apps/windows/electron/video.ts", async ({ executableYtDlp, transcrire }) => {
	const r = makeReporter("Électron — yt-dlp");
	const racine = mkdtempSync(join(tmpdir(), "quiz-video-"));
	const maison = join(racine, "maison");
	mkdirSync(maison, { recursive: true });

	/* Le FAUX yt-dlp : le script de la fixture et son lanceur du nom
	   demandé, écrits dans le dossier du faux. */
	const faux = mkdtempSync(join(racine, "faux-"));
	writeFileSync(join(faux, "faux.mjs"), readFileSync(FAUX_MJS, "utf8"));
	const nomLanceur = fauxLanceur(faux).nom;
	const lanceur = join(faux, nomLanceur);
	writeFileSync(lanceur, fauxLanceur(faux).corps, nomLanceur === "yt-dlp" ? { mode: 0o755 } : undefined);
	const journal = join(faux, "journal.txt");

	/* La FIXTURE réelle de la tâche 1 (un vrai `yt-dlp -J` réduit) : le
	   faux la sert telle quelle pour `-J` — la transcription éprouvée est
	   donc celle du noyau, pas une réplique. */
	const fixture = join(process.cwd(), "scripts", "fixtures", "video", "fr.json");
	const idBonne = "nh9e18bXpzc";
	const urlBonne = "https://www.youtube.com/watch?v=" + idBonne;
	/* Le journal et la fixture sont INJECTÉS par l'environnement : c'est
	   ainsi que le faux sait où journaliser ses appels et quoi servir à
	   `-J`, et le contrôle peut lire les arguments réels des appels. */
	const envFaux = {
		PATH: faux,
		SystemRoot: process.env.SystemRoot,
		ComSpec: process.env.ComSpec,
		PATHEXT: process.env.PATHEXT,
		TEMP: process.env.TEMP,
		TMP: process.env.TMP,
		USERPROFILE: maison,
		HOME: maison,
		NQ_VIDEO_JOURNAL: journal,
		NQ_VIDEO_FIXTURE: fixture,
	};

	/* La miniature est TOUJOURS injectée (le vrai fetch joindrait
	   i.ytimg.com — un contrôle ne doit rien lire du réseau). */
	const miniatureInjectee = "data:image/jpeg;base64,MINIATURE";
	const depsLecture = {
		env: envFaux,
		delaiMs: 20000,
		miniature: async (url) => url === "https://i.ytimg.com/vi/" + idBonne + "/maxresdefault.jpg" ? miniatureInjectee : "data:image/jpeg;base64,autre",
	};

	try {
		/* ── LA RÉSOLUTION DE L'EXÉCUTABLE ── */
		await cas(r, "executableYtDlp : la copie gérée du dossier d'app AVANT tout", async () => {
			/* Un `yt-dlp.exe` posé dans la copie gérée, ALORS QUE le fake
			   est sur le PATH injecté : la copie gérée doit gagner — un
			   yt-dlp téléchargé par la tâche 3 et un yt-dlp du PATH
			   peuvent coexister, et seul le premier est retenu. */
			const app = mkdtempSync(join(racine, "app-"));
			mkdirSync(join(app, "outils"), { recursive: true });
			writeFileSync(join(app, "outils", "yt-dlp.exe"), "un faux exécutable (jamais lancé ici)");
			const trouve = await executableYtDlp(envFaux, app);
			r.check("executableYtDlp : la copie gérée du dossier d'app est prioritaire",
				{ chemin: bas(trouve && trouve.chemin), source: trouve && trouve.source },
				{ chemin: bas(join(app, "outils", "yt-dlp.exe")), source: "app" });
			/* L'ordre réel : la copie gérée est cherchée AVANT le PATH —
			   c'est ce que ce cas et le suivant, inversés, montrent. */
			const sansCopie = await executableYtDlp(envFaux, join(racine, "vide"));
			r.check("executableYtDlp : sinon le PATH étendu",
				{ chemin: bas(sansCopie && sansCopie.chemin), source: sansCopie && sansCopie.source },
				{ chemin: bas(lanceur), source: "systeme" });
		});

		await cas(r, "executableYtDlp : un dossier des Scripts de Python est dans la recherche", async () => {
			/* pip pose yt-dlp dans `Python3*\Scripts` — un glob, pas un
			   chemin fixe (les versions changent sous un même PATH). Le
			   dossier est INJECTÉ par LOCALAPPDATA : rien du vrai disque
			   n'est lu, et un dossier absent de la liste est simplement
			   sauté par le code, ce que ce cas prouve en même temps
			   (Python311 est sans Scripts : sauté). Le PATH injecté ne
			   pointe vers RIEN : le dossier de Python doit gagner par
			   lui-même, pas parce que le fake y était déjà. */
			const vide = mkdtempSync(join(racine, "vide-"));
			const local = mkdtempSync(join(racine, "local-"));
			mkdirSync(join(local, "Programs", "Python", "Python312", "Scripts"), { recursive: true });
			mkdirSync(join(local, "Programs", "Python", "Python311"), { recursive: true });
			const nomFaux = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
			const dossierScripts = join(local, "Programs", "Python", "Python312", "Scripts");
			writeFileSync(join(dossierScripts, nomFaux), "faux");
			const trouve = await executableYtDlp(envDe(vide, maison, { LOCALAPPDATA: local }), join(racine, "vide"));
			r.check("executableYtDlp : le dossier Python3*/Scripts de LOCALAPPDATA est trouvé",
				{ chemin: bas(trouve && trouve.chemin), source: trouve && trouve.source },
				{ chemin: bas(join(dossierScripts, nomFaux)), source: "systeme" });
		});

		await cas(r, "executableYtDlp : WinGet\\Links est dans la recherche", async () => {
			const vide = mkdtempSync(join(racine, "vide-"));
			const local = mkdtempSync(join(racine, "winget-"));
			mkdirSync(join(local, "Microsoft", "WinGet", "Links"), { recursive: true });
			const nomFaux = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
			writeFileSync(join(local, "Microsoft", "WinGet", "Links", nomFaux), "faux");
			const trouve = await executableYtDlp(envDe(vide, maison, { LOCALAPPDATA: local }), join(racine, "vide"));
			r.check("executableYtDlp : WinGet\\Links est trouvé",
				{ chemin: bas(trouve && trouve.chemin), source: trouve && trouve.source },
				{ chemin: bas(join(local, "Microsoft", "WinGet", "Links", nomFaux)), source: "systeme" });
		});

		await cas(r, "executableYtDlp : rien nulle part → null", async () => {
			/* Ni copie gérée, ni PATH, ni dossiers dérivés : tout est sous
			   un dossier temporaire vide. `null` est l'état NORMAL d'une
			   machine sans yt-dlp, pas une panne. */
			const vide = mkdtempSync(join(racine, "vide-"));
			const trouve = await executableYtDlp(envDe(vide, vide), vide);
			r.check("executableYtDlp : rien nulle part → null", trouve, null);
		});

		/* ── TRANSCRIRE ── */
		await cas(r, "un identifiant hors regex est rejeté AVANT tout lancement", async () => {
			/* Le journal du faux est le SEUL témoin : une résolution qui
			   lancerait quoi que ce soit y laisserait une ligne. 5
			   caractères (court) ET 15 : les deux moitiés du regex. */
			for (const id of ["court", "bien_trop_long1"]) {
				const rejet = await nomDuRejet(transcrire(id, depsLecture));
				r.check("un identifiant hors regex est rejeté AVANT tout lancement (" + id.length + " car.)",
					{ rejet, appels: existsSync(journal) ? readFileSync(journal, "utf8") : "" },
					{ rejet: { code: "inconnue", detail: "identifiant : " + id }, appels: "" });
				rmSync(journal, { force: true });
			}
		});

		await cas(r, "sans yt-dlp, la transcription rejette « absent » sans lancer", async () => {
			/* Le journal est quand même injecté : s'il y avait eu un
			   lancement, il y serait — c'est ce qui rend l'assert
			   `appels: false` porteur, et non aveugle. */
			const vide = mkdtempSync(join(racine, "vide-"));
			const rejet = await nomDuRejet(transcrire(idBonne, { env: envDe(vide, maison, { NQ_VIDEO_JOURNAL: journal }), delaiMs: 20000, miniature: async () => null }));
			r.check("sans yt-dlp, la transcription rejette « absent » sans lancer",
				{ rejet, appels: existsSync(journal) }, { rejet: { code: "absent", detail: null }, appels: false });
		});

		await cas(r, "une transcription sert les DEUX listes d'arguments figées", async () => {
			const res = await transcrire(idBonne, depsLecture);
			const appels = readFileSync(journal, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
			/* LA LISTE FIGÉE, l'un après l'autre. Le `-o` est sous un
			   dossier temporaire que SEUL le principal connaît ; le
			   gabarit `s.%(ext)s` est celui de la liste figée. */
			r.check("les arguments du premier appel (les métadonnées -J) sont figés",
				appels[0], ["--no-warnings", "-J", "--skip-download", urlBonne]);
			r.check("les arguments du second appel (la piste auto) sont figés, -o dans le temporaire",
				{ debut: appels[1].slice(0, 8), oAbsolu: isAbsolute(appels[1][8]), fin: appels[1].slice(9), gabarit: appels[1][8].endsWith("s.%(ext)s") },
				{
					debut: ["--no-warnings", "--skip-download", "--write-auto-subs", "--sub-langs", "fr-orig", "--sub-format", "json3", "-o"],
					oAbsolu: true,
					fin: [urlBonne],
					gabarit: true,
				});
			r.check("l'URL est reconstruite, jamais reçue de l'appelant", [appels[0][3], appels[1][9]], [urlBonne, urlBonne]);
			/* LE RÉSULTAT, du document au nom de fichier (fixture réelle). */
			r.check("le résultat porte le document, son nom, titre, durée, langue, type, miniature",
				{
					document: res.document.includes("[00:00] bonjour la vidéo") && res.document.includes("## Transcription"),
					nom: res.nom, titre: res.titre, dureeS: res.dureeS, langue: res.langue, type: res.type, miniature: res.miniature,
				},
				{ document: true, nom: "Les variables en Python®.md", titre: "Les variables en Python®", dureeS: 366, langue: "fr", type: "auto", miniature: miniatureInjectee });
			/* LE DOSSIER TEMPORAIRE est supprimé en finally : il n'est
			   connu que par le `-o` que le faux a journalisé. */
			r.check("le dossier temporaire est supprimé", existsSync(dirname(appels[1][8])), false);
			rmSync(journal, { force: true });
		});

		await cas(r, "« Private video » rejette videoIndisponible après un seul appel", async () => {
			const rejet = await nomDuRejet(transcrire("privee12345", depsLecture));
			const appels = existsSync(journal) ? readFileSync(journal, "utf8").split(/\r?\n/).filter(Boolean) : [];
			/* UN seul appel : les métadonnées suffisent à savoir que la
			   vidéo est privée — on ne va pas chercher des sous-titres. */
			r.check("« Private video » rejette videoIndisponible après un seul appel",
				{
					rejetCode: rejet && rejet.code,
					detail: rejet && rejet.detail ? rejet.detail.includes("Private video") : false,
					appels: appels.length,
				},
				{ rejetCode: "videoIndisponible", detail: true, appels: 1 });
			rmSync(journal, { force: true });
		});

		await cas(r, "un yt-dlp qui traîne est tué, ARBRE compris, et rejette « delai »", async () => {
			/* Le délai est RÉDUIT par deps (les 5 s du faux seraient
			   ingérables) ; le témoin est le PID du faux, écrit au début
			   de son travail : `taskkill /T` (Windows) ou le groupe
			   (ailleurs) ne doit laisser AUCUN descendant. */
			const rejet = await nomDuRejet(transcrire("lente123456", { ...depsLecture, delaiMs: 700 }));
			const lignes = readFileSync(journal, "utf8").split(/\r?\n/).filter(Boolean);
			const debut = lignes.find((l) => l.startsWith("DEBUT "));
			const pid = debut ? Number(debut.split(" ")[1]) : null;
			/* La mort de l'arbre se voit aussi après quelques tours : un
			   process tué ne répond plus à kill(pid, 0). */
			let mort = false;
			for (let i = 0; i < 100 && !mort; i++) {
				await dodo(50);
				try { if (typeof pid === "number") { process.kill(pid, 0); } else { break; } } catch (e) { mort = true; }
			}
			r.check("un yt-dlp qui traîne rejette « delai »",
				{ rejet: rejet && rejet.code, pid: typeof pid }, { rejet: "delai", pid: "number" });
			r.check("l'arbre est mort après le rejet", mort, true);
			/* Et le faux n'a JAMAIS fini son sommeil : aucune ligne FIN. */
			r.check("le faux tué n'a jamais écrit FIN", lignes.some((l) => l.startsWith("FIN")), false);
			rmSync(journal, { force: true });
		});

		await cas(r, "une miniature en échec vaut null, jamais bloquant", async () => {
			const res = await transcrire(idBonne, { ...depsLecture, miniature: async () => { throw new Error("réseau en panne"); } });
			r.check("une miniature en échec vaut null, la transcription continue",
				{ miniature: res.miniature, document: res.document.length > 0 },
				{ miniature: null, document: true });
		});

		await cas(r, "deux transcriptions au plus en parallèle, la troisième attend", async () => {
			/* Le FAUX dort 400 ms par appel : trois appels partent
			   ENSEMBLE, la file en retient deux, et la troisième ne
			   DÉBUTE qu'après une fin — lu dans l'ORDRE du journal. */
			const envLente = envDe(faux, maison, {
				NQ_VIDEO_JOURNAL: journal,
				NQ_VIDEO_FIXTURE: fixture,
				NQ_VIDEO_SOMMEIL_MS: 400,
			});
			const trois = [
				transcrire("lente123456", { env: envLente, delaiMs: 20000, miniature: async () => null }),
				transcrire("lente123456", { env: envLente, delaiMs: 20000, miniature: async () => null }),
				transcrire("lente123456", { env: envLente, delaiMs: 20000, miniature: async () => null }),
			];
			const resultats = await Promise.all(trois);
			const lignes = readFileSync(journal, "utf8").split(/\r?\n/).filter(Boolean);
			const premierFin = lignes.findIndex((l) => l.startsWith("FIN"));
			const troisiemeDebut = lignes.map((l, i) => l.startsWith("DEBUT") ? i : -1).filter((i) => i >= 0)[2];
			r.check("deux transcriptions au plus en parallèle, les trois aboutissent",
				{
					trois: resultats.every((x) => x.titre === "Les variables en Python®"),
					ordres: premierFin >= 0 && troisiemeDebut > premierFin,
					/* Chaque transcription porte DEUX appels yt-dlp (-J puis la
					   piste) : six départs pour trois transcriptions, et le
					   troisième ne déute qu'après une libération — lu dans
					   l'ORDRE du journal. */
					appels: lignes.filter((l) => l.startsWith("DEBUT")).length,
				},
				{ trois: true, ordres: true, appels: 6 });
			rmSync(journal, { force: true });
		});
	} finally {
		/* Même règle qu'avecFichiers : Windows garde un handle quelques
		   dizaines de ms après la mort d'un process — `maxRetries`, et
		   un échec NOMMÉ plutôt que silencieux. */
		try {
			rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
		} catch (e) {
			console.warn("[neo-quiz] dossier temporaire du contrôle non effacé :", racine, e);
		}
	}

	/* ── LES HÔTES DU RÉSEAU ──
	   La miniature (i.ytimg.com) et, pour la tâche 3, l'installation
	   (github.com et les deux hôtes d'assets) : la liste est la RÈGLE du
	   pont, son extension est une décision de la spec §3.2, pas un
	   raccourci. Chargée à part : c'est le module du réseau qui la porte. */
	await withSrcModule("apps/windows/electron/reseau.ts", async ({ HOTES_AUTORISES }) => {
		const r = makeReporter("Électron — les hôtes des vidéos");
		r.check("la liste du réseau porte github, ses assets et i.ytimg.com",
			["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "i.ytimg.com"].map((h) => HOTES_AUTORISES.has(h)),
			[true, true, true, true]);
		r.done();
	});

	r.done();
});