/* ══════════════════════════════════════════════════════════
   TROUVER ET LANCER YT-DLP — CÔTÉ PROCESSUS PRINCIPAL

   Tâche 2 des vidéos YouTube (spec
   docs/superpowers/specs/2026-09-22-videos-youtube-design.md, §3.2,
   autorité liante). Le noyau pur (`src/video/`) décide de la piste et
   compose le document ; ce module, lui, TROUVE l'exécutable et LE LANCE,
   en deux appels à arguments FIXES. Le rendu n'y accédera que par le pont
   (tâche 4) — rien ici ne reçoit de la fenêtre qu'un identifiant.

   L'EXÉCUTABLE NE VIENT JAMAIS DU RENDU, et c'est la règle qui rend le
   reste sûr : la résolution est (1) la copie gérée
   `<userData>/outils/yt-dlp.exe` (téléchargée par la tâche 3), (2) un
   `yt-dlp` du PATH étendu (`dossiersCli` + `%LOCALAPPDATA%\Microsoft\
   WinGet\Links` + les dossiers `Python3*\Scripts` de pip). Un chemin
   passé par la fenêtre serait « écris x.cmd puis lance-le » : exactement
   ce que la liste blanche de `process.ts` existe pour fermer.

   L'ENVIRONNEMENT EST UN PARAMÈTRE, comme partout dans ce dossier : c'est
   ce qui permet à `npm run check:electron-video` d'éprouver la résolution,
   les arguments et la mort de l'arbre sur un FAUX yt-dlp posé dans un
   dossier temporaire, sans rien installer ni toucher au vrai PATH.
═══════════════════════════════════════════════════════════ */

import { ID_VIDEO, choisirPiste, json3VersTexte, documentVideo, nomDocument } from "../../../src/video";
import type { InfosVideo, Json3, LibellesDocument } from "../../../src/video";
import { dossiersCli, environnementEnfant, lancer } from "./process";
import { extensionsExecutables } from "../../../src/host/cli-args";
import { fetchBorne } from "./reseau";
import type { Transport } from "./reseau";
import { PRODUCT_NAME, LOG_PREFIX } from "../../../src/branding";
import type { HostNetRequest } from "../../../src/host/types";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/** Le code d'une erreur de lecture d'une vidéo, porté vers le rendu : le
    message de chaque code est une décision de l'interface (tâche 5), pas
    de ce module — ici il n'y a que le CODE et un détail pour le journal. */
export type CodeErreurVideo = "absent" | "reseau" | "pasDeSousTitres" | "videoIndisponible" | "delai" | "inconnue";

/** L'erreur de `transcrire` : le `code` est ce que l'appelant juge (comme
    le `name` d'`erreurCli`, qui est ici redoublé en propriété — un
    appelant futur qui lit `name` lit le même mot). */
export interface ErreurVideo extends Error {
	code: CodeErreurVideo;
	detail?: string;
}

function erreurVideo(code: CodeErreurVideo, detail?: string): ErreurVideo {
	const e = new Error("video : " + code + (detail ? " — " + detail : "")) as ErreurVideo;
	e.name = code;
	e.code = code;
	if (detail) e.detail = detail;
	return e;
}

/** Ce que `transcrire` rend : le document markdown joint à la demande,
    son nom de fichier, la fiche réduite, et la miniature en `data:` URI
    (JAMAIS une URL distante donnée au rendu). */
export interface ResultatVideo {
	document: string;
	nom: string;
	titre: string;
	dureeS: number | null;
	langue: string | null;
	type: "manuel" | "auto";
	miniature: string | null;
}

/** Les coutures du contrôle : chaque paramètre est ce qu'un cas de
    `check:electron-video` injecte (le faux yt-dlp par l'environnement, un
    chemin forcé, un délai en ms, la miniature). Sans deps, la production
    est entière : le PATH du processus, 60 s par appel, `fetchBorne`. */
export interface DepsVideo {
	env?: NodeJS.ProcessEnv;
	/** Le dossier de l'application (le `userData` d'Electron) : la copie
	    gérée de yt-dlp y est cherchée d'abord. Défaut : le dossier de
	    `PRODUCT_NAME` sous APPDATA — `app.setName(PRODUCT_NAME)` est posé
	    avant `getPath("userData")` dans `main.ts`, c'est le même. */
	dossierApp?: string;
	/** L'exécutable FORCÉ, contournant la résolution (le contrôle). */
	chemin?: string;
	/** Le délai max d'UN appel yt-dlp, en ms. */
	delaiMs?: number;
	/** La miniature, injectée par le contrôle (défaut : `fetchBorne`). */
	miniature?: (url: string) => Promise<string | null>;
}

/* ══════════════════════════════════════════════════════════
   LA RÉSOLUTION DE L'EXÉCUTABLE — LA COPIE GÉRÉE, PUIS LE PATH
═══════════════════════════════════════════════════════════ */

const NOM_OUTIL = "yt-dlp";

/** La copie gérée se nomme yt-dlp.exe QUEL QUE SOIT l'hôte : c'est
    l'artefact binaire que la tâche 3 télécharge depuis la release
    Windows (le seul produit qu'elle met dans `<userData>/outils`). */
const NOM_COPIE_GEREE = "yt-dlp.exe";

/**
 * Les dossiers du PATH étendu, sans toucher à `dossiersCli` lui-même :
 * une liste locale (le plan le demande — la détection des CLI ne doit pas
 * changer de comportement pour autant). Un dossier absent est simplement
 * sauté : un statSync qui jette est un dossier qui n'existe pas.
 *
 * `%LOCALAPPDATA%\Microsoft\WinGet\Links` : `winget install yt-dlp` ;
 * `Python3*\Scripts` sous `%LOCALAPPDATA%\Programs\Python` (l'installeur
 * python.org) et `%APPDATA%\Python` (pip --user) — un GLOB, pas un chemin
 * fixe : la version change, le dossier de Scripts suit.
 */
function dossiersEtendus(env: NodeJS.ProcessEnv): string[] {
	const dossiers: string[] = [];
	if (env.LOCALAPPDATA) dossiers.push(join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"));
	for (const racine of [
		env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "Python") : null,
		env.APPDATA ? join(env.APPDATA, "Python") : null,
	]) {
		if (!racine) continue;
		try {
			for (const entree of readdirSync(racine)) {
				if (/^Python3/.test(entree)) dossiers.push(join(racine, entree, "Scripts"));
			}
		} catch (e) {
			/* Absent : sauté, c'est un état normal, pas une panne. */
		}
	}
	return dossiers;
}

/** Les dossiers où chercher, DANS L'ORDRE de la spec §3.2 : la copie
    gérée d'abord, puis le PATH courant, puis `dossiersCli`, puis
    l'extension WinGet/Python. PURE (l'environnement est un paramètre). */
function candidatsYtDlp(env: NodeJS.ProcessEnv, dossierApp?: string): Array<{ dossier: string; source: "app" | "systeme" }> {
	const candidats: Array<{ dossier: string; source: "app" | "systeme" }> = [];
	const copie = dossierApp ?? (env.APPDATA ? join(env.APPDATA, PRODUCT_NAME) : null);
	if (copie) candidats.push({ dossier: join(copie, "outils"), source: "app" });
	for (const dossier of [...(env.PATH ?? "").split(delimiter).filter(Boolean), ...dossiersCli(env), ...dossiersEtendus(env)]) {
		candidats.push({ dossier, source: "systeme" });
	}
	return candidats;
}

/**
 * L'exécutable yt-dlp, ou `null` quand rien ne porte ce nom — l'état
 * NORMAL d'une machine sans yt-dlp, pas une panne. JAMAIS un chemin venu
 * du rendu : la seule entrée est la copie gérée et le PATH étendu.
 *
 * L'environnement est un paramètre : c'est la seule façon pour un contrôle
 * d'éprouver la résolution sans dépendre de ce que la machine a installé.
 */
export async function executableYtDlp(env: NodeJS.ProcessEnv = process.env, dossierApp?: string): Promise<{ chemin: string; source: "app" | "systeme" } | null> {
	const extensions = extensionsExecutables(env, process.platform);
	for (const { dossier, source } of candidatsYtDlp(env, dossierApp)) {
		for (const ext of extensions) {
			try {
				const candidat = join(dossier, NOM_OUTIL + ext);
				if (statSync(candidat).isFile()) return { chemin: candidat, source };
			} catch (e) {
				/* Absent ou illisible : au suivant. */
			}
		}
	}
	return null;
}

/* ══════════════════════════════════════════════════════════
   LA TRANSCRIPTION — DEUX APPELS À ARGUMENTS FIXES
═══════════════════════════════════════════════════════════ */

/** L'URL reconstruite à partir du SEUL identifiant validé (spec §3.2) :
    l'identifiant est revalidé par `ID_VIDEO` AVANT que quoi que ce soit
    soit lancé, et cette URL-là est celle que yt-dlp reçoit. */
const URL_YOUTUBE = "https://www.youtube.com/watch?v=";

/** Le délai max d'UN appel yt-dlp : la sonde a mesuré `-J` à 2,3 s et le
    sous-titre à 1,8 s ; 60 s est une limite, pas un temps attendu. */
const DELAI_APPEL_MS = 60_000;

/** Les marqueurs que yt-dlp écrit lui-même dans stderr pour une vidéo
    privée/supprimée/restreinte par âge (sonde du 2026-09-22, spec §3.2) :
    ce sont des DONNÉES portées vers le code d'erreur, jamais une phrase
    composée ici — l'interface la traduit, la tâche 5 la pose. */
const INDISPONIBLE = /Private video|Video unavailable|Sign in to confirm|age.restrict/i;

/** Les marqueurs d'une panne RÉSEAU, de même (le reste d'un échec inclassé
    vaut `inconnue`, stderr en détail pour le journal — c'est ce que la
    spec garde, pour qu'une nouvelle erreur de YouTube se voie tout de
    suite). */
const RESEAU = /Unable to download|URLError|Connection|getaddrinfo|Temporary failure|timed out/i;

/** Les 300 derniers caractères de stderr, le détail de journal que la
    spec fait porter à l'erreur. */
const detailJournal = (texte: string): string => texte.trim().slice(-300);

/**
 * Lance yt-dlp UNE fois, avec un délai max : un code de sortie non nul
 * est typé d'après stderr, et un dépassement de délai rejette `delai`
 * APRÈS la mort de l'arbre (`lancer` ne se règle qu'une fois l'enfant
 * fermé — `tuerArbre` sous Windows, le groupe ailleurs).
 */
async function lancerYtDlp(executable: string, args: string[], env: NodeJS.ProcessEnv, delaiMs: number): Promise<string> {
	let res: { stdout: string; stderr: string; code: number | null };
	try {
		res = await lancer({ executable, args, stdin: "", timeoutMs: delaiMs, env: environnementEnfant(env) });
	} catch (e) {
		const nom = (e as { name?: string })?.name;
		if (nom === "timeout") throw erreurVideo("delai");
		if (nom === "introuvable") throw erreurVideo("absent");
		throw erreurVideo("inconnue", String((e as Error)?.message ?? e).slice(-300));
	}
	if (res.code !== 0) {
		if (INDISPONIBLE.test(res.stderr)) throw erreurVideo("videoIndisponible", detailJournal(res.stderr));
		if (RESEAU.test(res.stderr)) throw erreurVideo("reseau", detailJournal(res.stderr));
		throw erreurVideo("inconnue", detailJournal(res.stderr));
	}
	return res.stdout;
}

/**
 * La miniature : `fetchBorne` (bornée à la liste d'hôtes du réseau, où
 * `i.ytimg.com` a été ajouté), rendue en `data:` URI — jamais une URL
 * distante donnée au rendu. Un échec vaut null, JAMAIS bloquant : la
 * transcription est le travail, la vignette un ornement.
 *
 * LE TRANSPORT PORTE LES OCTETS EN LATIN1 : le `text()` de `fetchBorne`
 * rend une CHAÎNE, et une lecture UTF-8 d'un JPEG la corrompt ; en
 * latin1, chaque octet est un code point, et `Buffer.from(…, "latin1")`
 * les rend exacts pour le base64.
 */
const transportOctets: Transport = async (url, init) => {
	const reponse = await globalThis.fetch(url, init);
	return { status: reponse.status, text: async () => Buffer.from(await reponse.arrayBuffer()).toString("latin1") };
};

async function miniatureParDefaut(url: string): Promise<string | null> {
	if (!url) return null;
	try {
		const reponse = await fetchBorne({ url, method: "GET" } as HostNetRequest, transportOctets);
		if (!reponse || reponse.status !== 200) return null;
		return "data:image/jpeg;base64," + Buffer.from(reponse.body, "latin1").toString("base64");
	} catch (e) {
		return null;
	}
}

/**
 * DEUX transcriptions au plus en parallèle — un compteur et une file
 * d'attente suffisent, et rien de plus (le plan le borne ; chaque
 * transcription lance deux process, en attendre une troisième derrière
 * eux est invisible de l'utilisateur, qui n'écrit pas des liens au
 * rythme des process). Relâché en `finally`, sur TOUTES les issues.
 */
const MAX_PARALLELE = 2;
let enCours = 0;
const attente: Array<() => void> = [];

async function entrer(): Promise<void> {
	while (enCours >= MAX_PARALLELE) await new Promise<void>(liberer => attente.push(liberer));
	enCours++;
}

function relacher(): void {
	enCours--;
	attente.shift()?.();
}

/** Les libellés des sections du document : le noyau ne connaît pas t()
    (document.ts), et le principal passe des chaînes fixes — le document
    est une DONNÉE jointe à la demande, pas une interface (les tâches 5 et
    6 portent tout texte d'écran). */
const LIBELLES: LibellesDocument = {
	chaine: "Chaîne",
	duree: "Durée",
	langue: "Langue",
	manuel: "sous-titres manuels",
	auto: "sous-titres automatiques",
	description: "Description",
	transcription: "Transcription",
};

/**
 * Lit une vidéo YouTube : les métadonnées (`-J`), la piste choisie par le
 * noyau, puis ses sous-titres en json3, et rend le document markdown avec
 * sa miniature. L'identifiant est revalidé AVANT tout lancement — un id
 * hors regex rejette sans lancer yt-dlp, et l'URL est RECONSTRUITE, jamais
 * reçue de l'appelant (le rendu ne peut faire passer qu'un identifiant).
 *
 * Le dossier temporaire du second appel est supprimé en `finally` ; le
 * fichier json3 y est trouvé par une lecture du dossier (yt-dlp insère la
 * langue entre le gabarit et l'extension — le nom n'est pas deviné).
 *
 * Rejette `{ code: CodeErreurVideo, detail? }` : `absent` (aucun
 * yt-dlp trouvé), `reseau`, `pasDeSousTitres` (la piste choisie est
 * nulle, ou le json3 attendu n'a pas été écrit), `videoIndisponible`
 * (privée, supprimée, restreinte par âge), `delai` (60 s écoulées, arbre
 * tué), `inconnue` (les 300 derniers caractères de stderr en `detail`,
 * pour le journal). Le câblage IPC est la tâche 4.
 */
export async function transcrire(id: string, deps?: DepsVideo): Promise<ResultatVideo> {
	await entrer();
	try {
		const env = deps?.env ?? process.env;
		const delaiMs = deps?.delaiMs ?? DELAI_APPEL_MS;
		/* L'identifiant est revalidé ICI, du côté du principal, AVANT tout
		   lancement (spec §3.2) : la tuile n'en fait passer que de valides,
		   et une valeur trafiquée qui atteindrait quand même le principal
		   ne lance rien du tout. */
		if (!ID_VIDEO.test(id)) throw erreurVideo("inconnue", "identifiant : " + id);
		const executable = deps?.chemin ?? (await executableYtDlp(env, deps?.dossierApp))?.chemin ?? null;
		if (!executable) throw erreurVideo("absent");
		const url = URL_YOUTUBE + id;
		const stdout = await lancerYtDlp(executable, ["--no-warnings", "-J", "--skip-download", url], env, delaiMs);
		let infos: InfosVideo;
		try {
			infos = JSON.parse(stdout) as InfosVideo;
		} catch (e) {
			throw erreurVideo("inconnue", "métadonnées illisibles : " + detailJournal(stdout));
		}
		const piste = choisirPiste(infos);
		if (!piste) throw erreurVideo("pasDeSousTitres");
		const temporaire = mkdtempSync(join(tmpdir(), "neo-quiz-video-"));
		try {
			await lancerYtDlp(
				executable,
				[
					"--no-warnings", "--skip-download", piste.type === "manuel" ? "--write-subs" : "--write-auto-subs",
					"--sub-langs", piste.cle, "--sub-format", "json3", "-o", join(temporaire, "s.%(ext)s"), url,
				],
				env, delaiMs,
			);
			const fichier = readdirSync(temporaire).find(f => f.endsWith(".json3"));
			if (!fichier) throw erreurVideo("pasDeSousTitres");
			const texte = json3VersTexte(JSON.parse(readFileSync(join(temporaire, fichier), "utf8")) as Json3);
			/* Tout échec de la miniature est avalé ici : l'ornement ne doit
			   jamais emporter le travail, et une injection du contrôle qui
			   jette passe par la même porte qu'une panne réseau. */
			let miniature: string | null = null;
			try {
				miniature = infos.thumbnail ? await (deps?.miniature ?? miniatureParDefaut)(infos.thumbnail) : null;
			} catch (e) {
				miniature = null;
			}
			return {
				document: documentVideo({ infos, piste, texte, libelles: LIBELLES }),
				nom: nomDocument(infos.title),
				titre: infos.title,
				dureeS: typeof infos.duration === "number" ? infos.duration : null,
				langue: piste.langue,
				type: piste.type,
				miniature,
			};
		} finally {
			try {
				/* `maxRetries` n'est pas du confort : un arbre tué au délai
				   laisse Windows tenir un handle quelques dizaines de ms
				   (voir `avecFichiers` dans process.ts). Un échec est DIT. */
				rmSync(temporaire, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
			} catch (e) {
				console.warn(LOG_PREFIX, "dossier temporaire de vidéo non effacé :", temporaire, e);
			}
		}
	} finally {
		relacher();
	}
}