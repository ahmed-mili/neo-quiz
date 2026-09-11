/**
 * Non-régression de L'INDEX ET DU SURVEILLANT DÉBOUNCÉ, côté processus
 * principal Electron (tâche 2 de
 * docs/superpowers/plans/2026-09-11-migration-electron.md).
 *
 * `apps/windows/electron/index-fichiers.ts` est du Node pur (chokidar +
 * `node:path`) : ce contrôle tourne sur un VRAI dossier temporaire
 * (`fs.mkdtemp`), retiré dans un `finally`. CHAQUE cas reçoit sa PROPRE
 * sous-racine vide : `surveiller` fait un parcours initial (`ignoreInitial:
 * false`, chokidar émet `add` pour les fichiers déjà présents), et partager un
 * même dossier entre les cas ferait ressurgir les fichiers des cas précédents
 * comme autant de faux événements — c'est exactement ce qui a fait rougir ce
 * script à sa première rédaction, pour un mauvais motif.
 *
 * Les DIX-SEPT cas des deux fonctions pures (`horsCatalogue`,
 * `evenementDeRenommage`) ne sont PAS repris ici : ils vivent déjà dans
 * `check-windows-host.mjs` (groupe « index »), qui les importe depuis
 * `apps/windows/src/host/fs.ts` — CE fichier les réexporte désormais depuis
 * `apps/windows/electron/catalogue.ts`, où ils ont été relogés (voir l'en-tête
 * de `catalogue.ts` : le brief de la tâche voulait les déplacer dans
 * `index-fichiers.ts`, ce qui aurait fait tirer Node au futur import côté
 * rendu de la tâche 4). Ce contrôle-ci éprouve les HUIT cas neufs, sur le
 * surveillant chokidar.
 *
 * Chaque cas est isolé dans son propre `try/catch` (`cas()`, même patron que
 * `check-electron-fs.mjs`) : une exception non prévue devient un échec NOMMÉ
 * au lieu de faire mourir le script et de cacher les cas suivants en silence.
 *
 *     npm run check:electron-index
 */
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const attendre = (ms) => new Promise(r => setTimeout(r, ms));

/** Exécute un cas ; une exception NON prévue devient un échec NOMMÉ au lieu de
    faire mourir le script — voir le commentaire d'en-tête. */
async function cas(r, nom, fn) {
	try {
		await fn();
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "pas d'exception");
	}
}

await withSrcModule("apps/windows/electron/index-fichiers.ts", async ({ creerIndex }) => {
	const r = makeReporter("Électron — index et surveillant");
	const base = await mkdtemp(join(tmpdir(), "electron-index-check-"));
	let n = 0;
	/** Une sous-racine VIDE, dédiée à un seul cas. */
	async function racineNeuve() {
		const d = join(base, `cas-${n++}`);
		await mkdir(d, { recursive: true });
		return d;
	}

	try {
		await cas(r, "créer un fichier émet create", async () => {
			const racine = await racineNeuve();
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(200); // laisse le parcours initial (dossier vide) se stabiliser
				await writeFile(join(racine, "a.md"), "un");
				await attendre(500);
				r.check("créer un fichier émet create", evs.some(e => e.kind === "create"), true);
			} finally {
				arreter();
			}
		});

		await cas(r, "modifier émet modify avec le mtime neuf", async () => {
			const racine = await racineNeuve();
			const p = join(racine, "b.md");
			await writeFile(p, "un"); // déjà présent AVANT que le surveillant démarre
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				// Le parcours initial doit peupler l'index (event `create` pour b.md
				// déjà là) avant qu'on ne le modifie.
				await attendre(400);
				const avant = index.get("0/b.md");
				const marque = evs.length;
				await attendre(30);
				await writeFile(p, "un-deux-trois-quatre");
				await attendre(600);
				const modif = evs.slice(marque).find(e => e.kind === "modify");
				r.check("modifier émet modify avec le mtime neuf",
					Boolean(modif) && avant !== null && modif.file.mtime > avant.mtime, true);
			} finally {
				arreter();
			}
		});

		await cas(r, "supprimer émet delete", async () => {
			const racine = await racineNeuve();
			const p = join(racine, "c.md");
			await writeFile(p, "un"); // déjà présent AVANT que le surveillant démarre
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(400); // parcours initial : c.md entre au catalogue
				const marque = evs.length;
				await unlink(p);
				await attendre(500);
				r.check("supprimer émet delete", evs.slice(marque).some(e => e.kind === "delete"), true);
			} finally {
				arreter();
			}
		});

		await cas(r, "deux écritures rapprochées n'émettent qu'UN événement", async () => {
			const racine = await racineNeuve(); // vide : rien à découvrir au parcours initial
			const p = join(racine, "d.md");
			const index = creerIndex([racine]);
			const evs = [];
			// `delayMs` élevé : les deux écritures, à quelques millisecondes
			// d'écart, doivent se fondre en un seul événement grâce au débounce
			// (`awaitWriteFinish`) de chokidar.
			const arreter = index.surveiller(ev => evs.push(ev), 400);
			try {
				await attendre(150); // le watcher doit être prêt avant la première écriture
				await writeFile(p, "un");
				await attendre(30);
				await writeFile(p, "un-deux");
				await attendre(900);
				r.check("deux écritures rapprochées n'émettent qu'UN événement",
					evs.filter(e => e.kind === "create" || e.kind === "modify").length, 1);
			} finally {
				arreter();
			}
		});

		await cas(r, "un fichier sous .trash/ n'émet RIEN", async () => {
			const racine = await racineNeuve();
			await mkdir(join(racine, ".trash"), { recursive: true });
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(200);
				await writeFile(join(racine, ".trash", "e.md"), "corbeille");
				await attendre(500);
				r.check("un fichier sous .trash/ n'émet RIEN", evs.length, 0);
			} finally {
				arreter();
			}
		});

		await cas(r, "un .md hors racine n'émet rien", async () => {
			const parent = await racineNeuve();
			const racine = join(parent, "surveillee");
			const dehors = join(parent, "pas-surveillee");
			await mkdir(racine, { recursive: true });
			await mkdir(dehors, { recursive: true });
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			try {
				await attendre(200);
				await writeFile(join(dehors, "f.md"), "hors racine");
				await attendre(500);
				r.check("un .md hors racine n'émet rien", evs.length, 0);
			} finally {
				arreter();
			}
		});

		await cas(r, "après une écriture par index.write, get() rend le mtime NEUF sans attendre le surveillant", async () => {
			const racine = await racineNeuve();
			const index = creerIndex([racine]);
			// AUCUN `surveiller()` démarré : la fraîcheur doit tenir sans lui.
			await index.write("0/g.md", "contenu neuf");
			const file = index.get("0/g.md");
			r.check("après une écriture par index.write, get() rend le mtime NEUF sans attendre le surveillant",
				file !== null && typeof file.mtime === "number" && file.mtime > 0, true);
		});

		await cas(r, "surveiller rend une fonction qui arrête vraiment l'écoute", async () => {
			const racine = await racineNeuve();
			const index = creerIndex([racine]);
			const evs = [];
			const arreter = index.surveiller(ev => evs.push(ev), 50);
			await attendre(200); // laisse le parcours initial (dossier vide) se stabiliser
			arreter();
			await writeFile(join(racine, "h.md"), "après arrêt");
			await attendre(400);
			r.check("surveiller rend une fonction qui arrête vraiment l'écoute", evs.length, 0);
		});
	} finally {
		// `finally` : le dossier temporaire doit disparaître même si un cas a
		// jeté une erreur inattendue, pas seulement un échec d'assertion.
		await rm(base, { recursive: true, force: true });
	}

	r.done();
});
