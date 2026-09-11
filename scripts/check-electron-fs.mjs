/**
 * Non-régression des PRIMITIVES DE FICHIERS du processus principal Electron
 * (tâche 1 de docs/superpowers/plans/2026-09-11-migration-electron.md).
 *
 * `apps/windows/electron/fichiers.ts` est du Node pur : ce contrôle tourne
 * sur un VRAI dossier temporaire (`fs.mkdtemp`), retiré dans un `finally` —
 * pas de double, pas de faux système de fichiers à faire diverger.
 *
 * Onze cas, pas huit : le brief de la tâche cite `stat` (absent du contrat
 * `HostFs`, `src/host/types.ts`) et omet `list`, `remove`, `rename`, qui y
 * sont — voir le ruling 1 du journal de migration
 * (`.superpowers/sdd/2026-09-11-migration-electron/progress.md`). Ce
 * contrôle éprouve donc les huit cas du brief PLUS un par méthode ajoutée.
 *
 * Chaque cas est isolé dans son propre `try/catch` (`cas()` ci-dessous) : une
 * rupture (écriture non attendue, par exemple) jette parfois une exception
 * NON CAPTURÉE par une assertion — sans cette isolation, ce cas ferait
 * MOURIR le script et cacherait tous les cas suivants en silence, exactement
 * le défaut nommé pour `check:lesson` dans `CLAUDE.md`.
 *
 *     npm run check:electron-fs
 */
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/** `true` si l'appel a rejeté, `false` sinon — pour comparer contre un
    booléen attendu, dans le même style que le reste du dépôt. */
async function aRejete(fn) {
	try {
		await fn();
		return false;
	} catch {
		return true;
	}
}

/** `true` si le chemin se lit, `false` s'il est absent. */
async function existeEncore(chemin) {
	try {
		await readFile(chemin);
		return true;
	} catch {
		return false;
	}
}

/** Exécute un cas ; une exception NON prévue devient un échec NOMMÉ au lieu
    de faire mourir le script — voir le commentaire d'en-tête. */
async function cas(r, nom, fn) {
	try {
		await fn();
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "pas d'exception");
	}
}

await withSrcModule("apps/windows/electron/fichiers.ts", async ({ creerFichiers }) => {
	const r = makeReporter("Primitives de fichiers Electron");
	const dir = await mkdtemp(join(tmpdir(), "electron-fs-check-"));

	try {
		const fichiers = creerFichiers();

		await cas(r, "write puis read rend le même texte", async () => {
			const p = join(dir, "a.txt");
			await fichiers.write(p, "bonjour");
			r.check("write puis read rend le même texte", await fichiers.read(p), "bonjour");
		});

		await cas(r, "process reçoit le contenu ACTUEL et écrit ce que le rappel rend", async () => {
			const p = join(dir, "b.txt");
			await fichiers.write(p, "un");
			await fichiers.process(p, (contenu) => contenu + "-deux");
			r.check("process reçoit le contenu ACTUEL et écrit ce que le rappel rend",
				await fichiers.read(p), "un-deux");
		});

		await cas(r, "process sur un fichier absent rejette", async () => {
			const p = join(dir, "absent.txt");
			r.check("process sur un fichier absent rejette",
				await aRejete(() => fichiers.process(p, (c) => c + "x")), true);
		});

		await cas(r, "writeBinary écrit les octets exacts d'une vue partielle", async () => {
			const p = join(dir, "c.bin");
			const tampon = new Uint8Array([1, 2, 3, 4, 5, 6]);
			// Une vue PARTIELLE sur un tampon plus grand : seuls ses propres
			// octets doivent atterrir sur le disque, jamais tout le tampon.
			const vue = tampon.subarray(2, 4);
			await fichiers.writeBinary(p, vue);
			const relu = await readFile(p);
			r.check("writeBinary écrit les octets exacts d'une vue partielle", [...relu], [3, 4]);
		});

		await cas(r, "append ajoute sans relire tout le fichier", async () => {
			const p = join(dir, "d.txt");
			await fichiers.write(p, "1");
			// DEUX appels CONCURRENTS (`Promise.all`, pas l'un après l'autre) :
			// c'est l'atomicité de l'ajout, pas la valeur finale d'une séquence
			// déjà ordonnée, que ce cas éprouve. Un `append` qui relit puis
			// réécrit fait chacun des deux partir du même contenu lu, et l'un des
			// deux ajouts se perd — c'est exactement le défaut que le journal de
			// révision ne doit jamais subir.
			await Promise.all([fichiers.append(p, "2"), fichiers.append(p, "3")]);
			const relu = await fichiers.read(p);
			// L'ORDRE des deux ajouts concurrents n'est pas garanti — seule leur
			// PRÉSENCE l'est : les deux caractères doivent survivre, dans un ordre
			// ou dans l'autre.
			r.check("append ajoute sans relire tout le fichier",
				[...relu].sort().join(""), ["1", "2", "3"].sort().join(""));
		});

		await cas(r, "mkdirs sur un dossier existant ne rejette pas", async () => {
			// Un chemin à DEUX niveaux (parent inexistant au départ) : sans
			// `recursive: true`, la création réussirait la première fois par
			// chance sur un dossier à un seul niveau, et masquerait la rupture.
			const p = join(dir, "e-parent", "e-dossier");
			await fichiers.mkdirs(p);
			r.check("mkdirs sur un dossier existant ne rejette pas",
				await aRejete(() => fichiers.mkdirs(p)), false);
		});

		await cas(r, "trash DÉPLACE (source disparue) et ne supprime pas (contenu retrouvé)", async () => {
			const p = join(dir, "f.txt");
			await fichiers.write(p, "corbeille");
			await fichiers.trash(p, dir);
			const encore = await existeEncore(p);
			const cible = join(dir, ".trash", "f.txt");
			r.check("trash DÉPLACE (source disparue) et ne supprime pas (contenu retrouvé)",
				[encore, await fichiers.read(cible)], [false, "corbeille"]);
		});

		await cas(r, "un homonyme déjà en corbeille n'est pas écrasé (numéroté à côté)", async () => {
			const p1 = join(dir, "g.txt");
			await fichiers.write(p1, "premier");
			await fichiers.trash(p1, dir);
			const p2 = join(dir, "g.txt");
			await fichiers.write(p2, "second");
			await fichiers.trash(p2, dir);
			r.check("un homonyme déjà en corbeille n'est pas écrasé (numéroté à côté)",
				[
					await fichiers.read(join(dir, ".trash", "g.txt")),
					await fichiers.read(join(dir, ".trash", "g-2.txt")),
				],
				["premier", "second"]);
		});

		/* VENU DE `check:windows-host` À LA TÂCHE 4 : la numérotation d'un
		   homonyme vivait côté rendu sous Tauri, elle vit ici depuis que le pont
		   la porte. Un fichier SANS extension mis deux fois à la corbeille :
		   `.trash` porte un point, et couper au dernier point du chemin ENTIER
		   numéroterait le DOSSIER (« <racine>/-2.trash/README ») au lieu du
		   fichier — les deux versions finiraient dans deux dossiers différents
		   au lieu d'être côte à côte. */
		await cas(r, "un fichier sans extension est numéroté sur son NOM, pas sur .trash", async () => {
			const p = join(dir, "README");
			await fichiers.write(p, "premier");
			await fichiers.trash(p, dir);
			await fichiers.write(p, "second");
			await fichiers.trash(p, dir);
			r.check("un fichier sans extension est numéroté sur son NOM, pas sur .trash",
				[
					await fichiers.read(join(dir, ".trash", "README")),
					await fichiers.read(join(dir, ".trash", "README-2")),
				],
				["premier", "second"]);
		});

		await cas(r, "list d'un dossier absent rend []", async () => {
			const abs = join(dir, "n-existe-pas");
			r.check("list d'un dossier absent rend []", await fichiers.list(abs), []);
		});

		await cas(r, "remove ne rejette pas si le fichier est déjà absent", async () => {
			const p = join(dir, "h-absent.txt");
			r.check("remove ne rejette pas si le fichier est déjà absent",
				await aRejete(() => fichiers.remove(p)), false);
		});

		await cas(r, "rename REJETTE si la destination existe (source intacte)", async () => {
			const de = join(dir, "i-source.txt");
			const vers = join(dir, "i-dest.txt");
			await fichiers.write(de, "source");
			await fichiers.write(vers, "déjà là");
			const rejette = await aRejete(() => fichiers.rename(de, vers));
			// La source ne doit pas avoir bougé : un rejet doit être franc, pas
			// partiel — sinon un renommage refusé perdrait quand même le fichier.
			r.check("rename REJETTE si la destination existe (source intacte)",
				[rejette, await fichiers.read(de)], [true, "source"]);
		});
	} finally {
		// `finally` : le dossier temporaire doit disparaître même si un cas a
		// jeté une erreur inattendue, pas seulement un échec d'assertion.
		await rm(dir, { recursive: true, force: true });
	}

	r.done();
});
