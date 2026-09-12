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

		/* LA CLÉ VIENT DU RENDU (revue finale, M6) : `ecrire("__proto__", …)`
		   n'écrivait aucune propriété propre, il remplaçait le PROTOTYPE de la
		   table, et toute clé absente lue ensuite remontait jusqu'à sa valeur.
		   Les DEUX moitiés : le refus est une erreur NOMMÉE, et une clé
		   ordinaire lue après reste intacte — un `folders` qui remonterait au
		   prototype empoisonné passerait sinon pour un réglage. */
		await cas(r, "une clé de prototype (__proto__, constructor, prototype) est refusée et n'empoisonne pas la table", async () => {
			const d = join(dir, "sept");
			await mkdir(d);
			const reg = creerReglages(join(d, "settings.json"));
			await reg.ecrire("folders", []);
			const cause = async (fn) => { try { await fn(); return "accepté"; } catch (e) { return String(e.message).split(" : ")[0]; } };
			r.check("une clé de prototype (__proto__, constructor, prototype) est refusée et n'empoisonne pas la table",
				{
					proto: await cause(() => reg.ecrire("__proto__", { folders: [{ path: "C:/" }] })),
					constructor: await cause(() => reg.ecrire("constructor", 1)),
					prototype: await cause(() => reg.supprimer("prototype")),
					folders: await reg.lire("folders"),
					absente: await reg.lire("jamais-ecrite"),
					disque: JSON.parse(await readFile(join(d, "settings.json"), "utf-8")),
				},
				{
					proto: "clé de réglage refusée", constructor: "clé de réglage refusée", prototype: "clé de réglage refusée",
					folders: [], absente: undefined, disque: { folders: [] },
				});
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

		/* LE PROTOCOLE DES RESSOURCES, BORNÉ PAR CE MÊME PÉRIMÈTRE (Ruling 13).
		   `protocol.handle` (`electron/main.ts`) sert les images d'un quiz, et
		   c'est la SEULE autre porte du principal vers le disque avec les canaux
		   `fichiers.*`. Lui donner sa propre liste blanche, c'est la faire
		   diverger de l'autre — la porte que la tâche 3 a mis deux rondes à
		   fermer. `resoudreRessource` vit dans `electron/ressources.ts` et non
		   dans `main.ts` pour être éprouvable ici : `main.ts` importe Electron,
		   aucun contrôle ne peut le charger.
		   Les DEUX moitiés, sinon un périmètre vide ferait passer le cas : une
		   image DANS la racine est servie, la même URL hors racine est
		   REFUSÉE (`null`, que le gestionnaire traduit en 403). */
		await cas(r, "le protocole des ressources est borné par le MÊME périmètre", async () => {
			await withSrcModule("apps/windows/electron/ressources.ts", async ({ urlDeRessource, resoudreRessource }) => {
				const dedans = join(racine, "Cours", "schema.png").replace(/\\/g, "/");
				const dehors = join(ailleurs, "secret.md").replace(/\\/g, "/");
				r.check("le protocole des ressources est borné par le MÊME périmètre",
					{
						dedans: await resoudreRessource(p, urlDeRessource(dedans)),
						dehors: await resoudreRessource(p, urlDeRessource(dehors)),
						/* Un `..` ENCODÉ dans l'URL arrive ici décodé : c'est
						   `borner` qui le replie, jamais une comparaison de
						   chaîne. Concaténé et non `path.join`, qui replierait
						   déjà (le cas d'à côté a été vert pour cette raison). */
						remontee: await resoudreRessource(p, urlDeRessource(racine + "/Cours/../../ailleurs/secret.md")),
						/* Une URL d'un autre protocole n'est pas à nous. */
						etrangere: await resoudreRessource(p, "https://exemple.test/x.png"),
					},
					{ dedans, dehors: null, remontee: null, etrangere: null });
			});
		});

		/* LA PORTE D'EXÉCUTION SOUS LE PÉRIMÈTRE (revue finale, I1). Le périmètre
		   borne l'écriture et la lecture ; `systeme.ouvrir` (`shell.openPath`)
		   EXÉCUTE un `.bat` ou un `.exe` — et `write` puis `ouvrir` sont deux
		   appels bornés, chacun dans les règles. Le prédicat vit dans
		   `ressources.ts` (sans Node ni Electron) pour être éprouvé ici ;
		   `canaux.ts`, qui l'applique, importe `electron`. Les DEUX moitiés :
		   une liste vide accepterait tout et un prédicat constant refuserait
		   tout — chacune serait verte seule. La casse (`X.BAT`), le double
		   suffixe (`notes.pdf.exe`) et le chemin sans extension sont les trois
		   façons de se tromper sur « l'extension ». */
		await cas(r, "ouvrir refuse les extensions exécutables, quelle que soit la casse, et laisse passer les documents", async () => {
			await withSrcModule("apps/windows/electron/ressources.ts", async ({ extensionRefusee, EXTENSIONS_EXECUTABLES }) => {
				r.check("ouvrir refuse les extensions exécutables, quelle que soit la casse, et laisse passer les documents",
					{
						bat: extensionRefusee(join(racine, "Cours", "x.bat")),
						casse: extensionRefusee(join(racine, "Cours", "X.BAT")),
						doubleSuffixe: extensionRefusee(join(racine, "Cours", "notes.pdf.exe")),
						ps1: extensionRefusee(join(racine, "Cours", "script.ps1")),
						lnk: extensionRefusee(join(racine, "Cours", "raccourci.lnk")),
						pdf: extensionRefusee(join(racine, "Cours", "fiche.pdf")),
						md: extensionRefusee(join(racine, "Cours", "ch1.md")),
						sansExtension: extensionRefusee(join(racine, "Cours", "Makefile")),
						pointDeTete: extensionRefusee(join(racine, "Cours", ".bat")),
						/* La liste de la revue, entière : une extension retirée « par
						   simplification » rougirait ici, nommée. */
						liste: [...EXTENSIONS_EXECUTABLES].sort(),
					},
					{
						bat: true, casse: true, doubleSuffixe: true, ps1: true, lnk: true,
						pdf: false, md: false, sansExtension: false, pointDeTete: false,
						liste: ["bat", "cmd", "com", "exe", "hta", "js", "jse", "lnk", "msi", "pif", "ps1", "reg", "scr", "url", "vbe", "vbs", "wsf", "wsh"],
					});
			});
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	r.done();
});

/**
 * LA BORNE DES CANAUX `fichiers.*`, STATIQUEMENT (tranche 5, tâche 5, ruling
 * 14). `canaux.ts` tire Electron et ne se charge dans aucun script : la
 * preuve que CHAQUE canal de fichiers passe par `perimetre.borner` était donc
 * celle de personne — un canal ajouté sans sa borne (c'est arrivé trois fois
 * d'un coup à la tranche 5 : `listerDossier`, `statEntree`, `readBinary`)
 * serait un accès disque total depuis la fenêtre, et aucun contrôle ne
 * rougirait. Ici : la liste des canaux est DÉRIVÉE de `CANAUX` (`pont.ts`, sans
 * Node), jamais recopiée ; chaque `ipcMain.handle(CANAUX.<x>, …)` dont le canal
 * commence par `neo:fichiers/` doit contenir `perimetre.borner(` dans son corps
 * — délimité par les parenthèses équilibrées de l'appel, pas par une regex
 * de ligne, parce qu'un gestionnaire s'étend souvent sur dix lignes.
 */
await withSrcModule("apps/windows/electron/pont.ts", async ({ CANAUX }) => {
	const r = makeReporter("Périmètre — chaque canal fichiers.* est borné (statique)");
	const source = await readFile("apps/windows/electron/canaux.ts", "utf-8");
	const canauxFichiers = Object.entries(CANAUX)
		.filter(([, canal]) => String(canal).startsWith("neo:fichiers/"))
		.map(([nom]) => nom);

	/** Le corps d'un `ipcMain.handle(CANAUX.<nom>, …)` : du `(` de l'appel à sa
	    parenthèse fermante, en comptant les niveaux (les chaînes et
	    commentaires du gestionnaire ne contiennent pas de parenthèse
	    déséquilibrée — vérifié sur le fichier, et un déséquilibre rendrait
	    `null`, donc rouge, jamais vert par accident). */
	const corpsDe = (nom) => {
		const debut = source.indexOf(`ipcMain.handle(CANAUX.${nom},`);
		if (debut < 0) return null;
		let niveau = 0;
		for (let i = source.indexOf("(", debut); i < source.length; i++) {
			if (source[i] === "(") niveau++;
			else if (source[i] === ")" && --niveau === 0) return source.slice(debut, i + 1);
		}
		return null;
	};

	const sansGestionnaire = canauxFichiers.filter(nom => corpsDe(nom) === null);
	r.check("chaque canal fichiers.* de CANAUX a un gestionnaire dans canaux.ts", sansGestionnaire, []);
	const nonBornes = canauxFichiers.filter(nom => {
		const corps = corpsDe(nom);
		return corps !== null && !corps.includes("perimetre.borner(");
	});
	r.check("chaque gestionnaire fichiers.* appelle perimetre.borner(", nonBornes, []);
	/* La liste dérivée n'est pas vide, et elle contient les trois canaux de la
	   tranche 5 : sans ce cas, un `CANAUX` renommé (« neo:fs/… ») viderait la
	   liste et rendrait les deux cas ci-dessus verts sur rien. */
	r.check("la liste dérivée de CANAUX contient les canaux attendus",
		["read", "write", "listerDossier", "statEntree", "readBinary"].filter(n => !canauxFichiers.includes(n)), []);
	r.done();
});
