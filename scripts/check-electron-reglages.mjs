/**
 * Non-régression des trois modules du processus principal Electron que la
 * fenêtre ne peut pas éprouver à sa place : les RÉGLAGES (`reglages.ts`), les
 * VAULTS d'Obsidian (`vaults.ts`) et le PÉRIMÈTRE (`perimetre.ts`) — tâche 3
 * de docs/superpowers/plans/2026-09-11-migration-electron.md, ronde de
 * correction 1.
 *
 * Les trois sont du Node pur, écrits pour recevoir leurs chemins en paramètre
 * : ce contrôle tourne sur un VRAI dossier temporaire (`fs.mkdtemp`), retiré
 * dans un `finally`. Aucun double.
 *
 * Ce qu'il empêche, et qui échouerait EN SILENCE :
 * — un fichier de réglages réécrit à partir d'une table VIDE parce qu'une
 *   lecture a transitoirement échoué (tous les dossiers de l'utilisateur
 *   perdus, sans message) ;
 * — un JSON corrompu ÉCRASÉ au lieu d'être mis de côté ;
 * — deux écritures concurrentes qui se renomment l'une l'autre ;
 * — un chemin du pont hors des dossiers ouverts — `..`, jonction, racine de
 *   corbeille inconnue — qui atteindrait une primitive.
 *
 * Chaque cas est isolé dans `cas()` : une exception non prévue devient un
 * échec NOMMÉ, jamais une mort du script qui cacherait les cas suivants.
 *
 *     npm run check:electron-reglages
 */
import { mkdtemp, rm, readFile, readdir, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

async function aRejete(fn) {
	try {
		await fn();
		return false;
	} catch {
		return true;
	}
}

async function cas(r, nom, fn) {
	try {
		await fn();
	} catch (e) {
		r.check(nom, "EXCEPTION: " + (e && e.message ? e.message : String(e)), "pas d'exception");
	}
}

/* ─────────── les réglages ─────────── */

await withSrcModule("apps/windows/electron/reglages.ts", async ({ creerReglages }) => {
	const r = makeReporter("Électron — réglages");
	const dir = await mkdtemp(join(tmpdir(), "electron-reglages-"));
	try {
		await cas(r, "ecrire puis lire rend la valeur, et aucun fichier temporaire ne reste", async () => {
			const d = join(dir, "un");
			await mkdir(d);
			const reg = creerReglages(join(d, "settings.json"));
			await reg.ecrire("folders", [{ path: "C:/x" }]);
			r.check("ecrire puis lire rend la valeur, et aucun fichier temporaire ne reste",
				{ relu: await reg.lire("folders"), fichiers: await readdir(d) },
				{ relu: [{ path: "C:/x" }], fichiers: ["settings.json"] });
		});

		await cas(r, "deux ecrire CONCURRENTS sont sérialisés : les deux clés survivent", async () => {
			const d = join(dir, "deux");
			await mkdir(d);
			const reg = creerReglages(join(d, "settings.json"));
			await Promise.all([reg.ecrire("a", 1), reg.ecrire("b", 2)]);
			const disque = JSON.parse(await readFile(join(d, "settings.json"), "utf-8"));
			r.check("deux ecrire CONCURRENTS sont sérialisés : les deux clés survivent",
				{ disque, fichiers: await readdir(d) },
				{ disque: { a: 1, b: 2 }, fichiers: ["settings.json"] });
		});

		await cas(r, "un JSON illisible est MIS DE CÔTÉ, jamais écrasé", async () => {
			const d = join(dir, "trois");
			await mkdir(d);
			await writeFile(join(d, "settings.json"), "{ ceci n'est pas du JSON", "utf-8");
			const reg = creerReglages(join(d, "settings.json"));
			await reg.ecrire("a", 1);
			const fichiers = await readdir(d);
			const sauvegarde = fichiers.find(f => f.startsWith("settings.json.corrompu-"));
			r.check("un JSON illisible est MIS DE CÔTÉ, jamais écrasé",
				{
					sauvegardeContenu: sauvegarde ? await readFile(join(d, sauvegarde), "utf-8") : null,
					neuf: JSON.parse(await readFile(join(d, "settings.json"), "utf-8")),
				},
				{ sauvegardeContenu: "{ ceci n'est pas du JSON", neuf: { a: 1 } });
		});

		await cas(r, "une lecture IMPOSSIBLE (pas ENOENT) fait rejeter lire ET ecrire, sans rien écraser", async () => {
			const d = join(dir, "quatre");
			await mkdir(d);
			// Le chemin des réglages est un DOSSIER : `readFile` échoue en EISDIR,
			// l'équivalent déterministe d'un EBUSY d'antivirus.
			const chemin = join(d, "settings.json");
			await mkdir(chemin);
			await writeFile(join(chemin, "temoin"), "je suis toujours là", "utf-8");
			const reg = creerReglages(chemin);
			const lireRejette = await aRejete(() => reg.lire("folders"));
			const ecrireRejette = await aRejete(() => reg.ecrire("a", 1));
			r.check("une lecture IMPOSSIBLE (pas ENOENT) fait rejeter lire ET ecrire, sans rien écraser",
				{ lireRejette, ecrireRejette, temoin: await readFile(join(chemin, "temoin"), "utf-8") },
				{ lireRejette: true, ecrireRejette: true, temoin: "je suis toujours là" });
		});

		await cas(r, "supprimer retire la clé du fichier", async () => {
			const d = join(dir, "cinq");
			await mkdir(d);
			const reg = creerReglages(join(d, "settings.json"));
			await reg.ecrire("folder", "C:/ancien");
			await reg.ecrire("folders", []);
			await reg.supprimer("folder");
			r.check("supprimer retire la clé du fichier",
				JSON.parse(await readFile(join(d, "settings.json"), "utf-8")), { folders: [] });
		});

		await cas(r, "lire sur un fichier absent rend undefined et ne crée rien", async () => {
			const d = join(dir, "six");
			await mkdir(d);
			const reg = creerReglages(join(d, "settings.json"));
			r.check("lire sur un fichier absent rend undefined et ne crée rien",
				{ valeur: await reg.lire("folders"), fichiers: await readdir(d) },
				{ valeur: undefined, fichiers: [] });
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	r.done();
});

/* ─────────── les vaults d'Obsidian ─────────── */

await withSrcModule("apps/windows/electron/vaults.ts", async ({ vaultsObsidian }) => {
	const r = makeReporter("Électron — vaults Obsidian");
	const dir = await mkdtemp(join(tmpdir(), "electron-vaults-"));
	try {
		await cas(r, "seuls les dossiers existants portant un .obsidian sont rendus, triés par nom", async () => {
			const appData = join(dir, "appdata");
			await mkdir(join(appData, "obsidian"), { recursive: true });
			const zeta = join(dir, "Zeta");
			const alpha = join(dir, "alpha");
			const sansPoint = join(dir, "sans-obsidian");
			await mkdir(join(zeta, ".obsidian"), { recursive: true });
			await mkdir(join(alpha, ".obsidian"), { recursive: true });
			await mkdir(sansPoint, { recursive: true });
			await writeFile(join(appData, "obsidian", "obsidian.json"), JSON.stringify({
				vaults: {
					a: { path: zeta, ts: 1 },
					b: { path: join(dir, "disparu"), ts: 2 },
					c: { path: sansPoint, ts: 3 },
					d: { path: alpha, ts: 4 },
				},
			}), "utf-8");
			r.check("seuls les dossiers existants portant un .obsidian sont rendus, triés par nom",
				await vaultsObsidian(appData),
				[{ chemin: alpha, nom: "alpha" }, { chemin: zeta, nom: "Zeta" }]);
		});

		await cas(r, "sans obsidian.json, la liste est vide (pas une erreur)", async () => {
			r.check("sans obsidian.json, la liste est vide (pas une erreur)",
				await vaultsObsidian(join(dir, "nulle-part")), []);
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	r.done();
});

/* ─────────── le périmètre ─────────── */

await withSrcModule("apps/windows/electron/perimetre.ts", async ({ creerPerimetre, perimetreInitial }) => {
	const r = makeReporter("Électron — périmètre");
	const dir = await mkdtemp(join(tmpdir(), "electron-perimetre-"));
	try {
		await cas(r, "le dossier de réglages (userData) est HORS périmètre au démarrage, les dossiers qu'il liste y sont", async () => {
			/* Ruling 12. `settings.json` nourrit le périmètre (clé `folders`) au
			   démarrage suivant : si son propre dossier y entrait, `fichiers.write`
			   pourrait le réécrire en brut et y glisser `C:/`, hors de la garde de
			   `reglages.ecrire`. Le module de réglages est chargé À PART, sans
			   double : c'est lui qui écrit le fichier que `perimetreInitial` lit. */
			const donnees = join(dir, "userData");
			const vault = join(dir, "vault-demarrage");
			await mkdir(join(vault, ".obsidian"), { recursive: true });
			await mkdir(donnees, { recursive: true });
			await writeFile(join(donnees, "settings.json"), JSON.stringify({ folders: [{ id: "v", path: vault, name: "v" }] }), "utf-8");
			await withSrcModule("apps/windows/electron/reglages.ts", async ({ creerReglages }) => {
				const p = await perimetreInitial({ dossierDonnees: donnees, reglages: creerReglages(join(donnees, "settings.json")) });
				r.check("le dossier de réglages (userData) est HORS périmètre au démarrage, les dossiers qu'il liste y sont",
					{
						settings: await aRejete(() => p.borner(join(donnees, "settings.json"))),
						vault: await aRejete(() => p.borner(join(vault, "note.md"))),
					},
					{ settings: true, vault: false });
			});
		});

		const racine = join(dir, "vault");
		const ailleurs = join(dir, "ailleurs");
		await mkdir(join(racine, "Cours"), { recursive: true });
		await mkdir(ailleurs, { recursive: true });
		await writeFile(join(ailleurs, "secret.md"), "secret", "utf-8");
		const p = creerPerimetre();
		await p.autoriser(racine);

		await cas(r, "un chemin DANS une racine est accepté, normalisé", async () => {
			r.check("un chemin DANS une racine est accepté, normalisé",
				await p.borner(join(racine, "Cours", "nouveau.md")),
				join(racine, "Cours", "nouveau.md").replace(/\\/g, "/"));
		});

		await cas(r, "un chemin HORS racine est refusé", async () => {
			r.check("un chemin HORS racine est refusé",
				await aRejete(() => p.borner(join(ailleurs, "secret.md"))), true);
		});

		await cas(r, "un .. qui SORT de la racine est refusé", async () => {
			/* CONCATÉNÉ, pas `path.join` : `join` replie déjà les `..` et le cas
			   n'éprouverait alors plus rien (il a été vert quoi qu'on casse, une
			   fois, pour cette raison exacte). */
			r.check("un .. qui SORT de la racine est refusé",
				await aRejete(() => p.borner(racine + "/Cours/../../ailleurs/secret.md")), true);
		});

		await cas(r, "une jonction posée dans la racine et pointant dehors est refusée", async () => {
			await symlink(ailleurs, join(racine, "lien"), "junction");
			r.check("une jonction posée dans la racine et pointant dehors est refusée",
				await aRejete(() => p.borner(join(racine, "lien", "secret.md"))), true);
		});

		await cas(r, "estRacine : la racine oui, un sous-dossier ou un dossier étranger non", async () => {
			r.check("estRacine : la racine oui, un sous-dossier ou un dossier étranger non",
				{
					racine: await p.estRacine(racine),
					sousDossier: await p.estRacine(join(racine, "Cours")),
					etranger: await p.estRacine(ailleurs),
				},
				{ racine: true, sousDossier: false, etranger: false });
		});

		await cas(r, "un argument qui n'est pas une chaîne est refusé AVEC SA CAUSE", async () => {
			/* La CAUSE, pas seulement le rejet : sans la garde `typeof`, un objet
			   ferait jeter `path.resolve` (une TypeError sans rapport) et une
			   chaîne vide se résoudrait sur le dossier courant — deux rejets qui
			   diraient autre chose que ce qui s'est passé. */
			const cause = async (v) => { try { await p.borner(v); return "accepté"; } catch (e) { return String(e.message).split(" : ")[0]; } };
			r.check("un argument qui n'est pas une chaîne est refusé AVEC SA CAUSE",
				{ objet: await cause({ toString: () => racine }), vide: await cause("") },
				{ objet: "chemin invalide", vide: "chemin invalide" });
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	r.done();
});
