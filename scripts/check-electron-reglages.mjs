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

		await cas(r, "le dossier du fond d'écran persisté est admis au démarrage, comme les dossiers de quiz", async () => {
			const donnees = join(dir, "userData-fond");
			const dossierFond = join(dir, "fond");
			await mkdir(dossierFond, { recursive: true });
			await mkdir(donnees, { recursive: true });
			await writeFile(join(donnees, "settings.json"), JSON.stringify({ fond: { dossier: dossierFond, image: "a.jpg" } }), "utf-8");
			await withSrcModule("apps/windows/electron/reglages.ts", async ({ creerReglages }) => {
				const p = await perimetreInitial({ dossierDonnees: donnees, reglages: creerReglages(join(donnees, "settings.json")) });
				r.check("le dossier du fond d'écran persisté est admis au démarrage, comme les dossiers de quiz",
					await aRejete(() => p.borner(join(dossierFond, "a.jpg"))), false);
			});
		});

		await cas(r, "discriminance : un fond avec un dossier non-chaîne ou vide n'admet rien", async () => {
			/* `p.racines()` plutôt qu'un `borner` sur un chemin quelconque : un
			   `dossier` vide résolu à la légère (`"" || "."`) admettrait le
			   dossier COURANT sans qu'aucun chemin de ce test ne tombe dedans,
			   laissant le bug passer inaperçu — c'est arrivé une fois, ici même.
			   `racines()` doit rester VIDE, un fait que seul le vrai bug ferait mentir. */
			const donnees = join(dir, "userData-fond-invalide");
			await mkdir(donnees, { recursive: true });
			await writeFile(join(donnees, "settings.json"), JSON.stringify({ fond: { dossier: "", image: "a.jpg" } }), "utf-8");
			await withSrcModule("apps/windows/electron/reglages.ts", async ({ creerReglages }) => {
				const p = await perimetreInitial({ dossierDonnees: donnees, reglages: creerReglages(join(donnees, "settings.json")) });
				r.check("discriminance : un fond avec un dossier non-chaîne ou vide n'admet rien",
					p.racines(), []);
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

/**
 * LA GARDE DE LA CLÉ `ai` (tranche 5, tâche 6, ruling R-B). La clé `ai` des
 * réglages est la première que le RENDU écrit et que le PRINCIPAL relit pour
 * élargir ce qu'il accepte : l'hôte d'`aiOllamaUrl` entre dans la liste du
 * réseau (`reseau.ts`), `aiMentionExtraFolders` désigne des dossiers lus par
 * les canaux `fichiers.*`. Sans garde, un rendu compromis écrivait
 * `{ aiOllamaUrl: "https://attaquant.example" }` et obtenait cet hôte au
 * prochain lancement — le résiduel que `reseau.ts` nommait jusqu'ici.
 *
 * Le verdict est PUR (`garde-ia.ts`, ni `electron` ni `node:*`) : il se
 * charge ici tel quel, avec un périmètre doublé par une simple liste. Le
 * dialogue natif et l'admission (`canaux.ts`) ne se chargent pas — la
 * dernière assertion, STATIQUE comme celle des canaux `fichiers.*`, vérifie
 * que `reglagesEcrire` appelle la garde AVANT `.ecrire(`.
 */
await withSrcModule("apps/windows/electron/garde-ia.ts", async ({ cheminCliPourLancement, estDossierSortieIaValide, hoteEstPrive, validerReglagesIa }) => {
	const r = makeReporter("Électron — la garde de la clé ai");

	/* ── hoteEstPrive : la boucle locale, la RFC 1918, `.local`, et rien d'autre ── */
	const prives = ["localhost", "127.0.0.1", "127.9.9.9", "::1", "[::1]", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.10", "mon-nas.local"];
	r.check("les hôtes de la boucle locale, des plages RFC 1918 et .local sont privés",
		prives.filter(h => !hoteEstPrive(h)), []);
	const publics = ["172.15.0.1", "172.32.0.1", "8.8.8.8", "11.0.0.1", "example.com", "ollama.com", "monnas.localhost.example", ""];
	r.check("un hôte public, une plage voisine de 172.16/12, ou un nom Internet ne sont pas privés",
		publics.filter(h => hoteEstPrive(h)), []);

	/* ── validerReglagesIa : les trois verdicts ──

	   DEUX prédicats, et ils ne se confondent pas. Le PÉRIMÈTRE juge les
	   dossiers que le sélecteur « @ » lira. L'EXISTENCE juge le chemin d'un
	   exécutable de CLI — lequel vit précisément HORS du périmètre (un CLI est
	   dans `Program Files`, jamais dans un dossier de quiz) : le borner serait
	   refuser d'avance tout chemin valide. Les doubles sont de simples listes,
	   comme le vrai `perimetre.contient` et le vrai `statEntree` vus d'ici. */
	const contient = async (chemin) => chemin.startsWith("D:/Quiz");
	/* « outils/claude.exe » EXISTE dans le double, exprès : sans lui, retirer
	   la garde « absolu » laisserait le refus tomber sur « ne désigne aucun
	   fichier », et le cas resterait VERT sur la mauvaise raison. */
	const fichiersReels = new Set(["c:/outils/claude.exe", "c:/outils/codex.cmd", "c:/outils/note.docx", "c:/outils/lance.ps1", "c:/outils/shim.js", "c:/outils/claude", "outils/claude.exe", "d:/quiz/cours/claude.cmd"]);
	const existe = async (chemin) => fichiersReels.has(chemin.toLowerCase());
	const valider = (v) => validerReglagesIa(v, contient, existe);
	await cas(r, "une valeur qui n'est pas un objet est refusée", async () => {
		const verdicts = await Promise.all([null, "x", 3, [1]].map(v => valider(v)));
		r.check("une valeur qui n'est pas un objet est refusée",
			verdicts.map(v => "refus" in v), [true, true, true, true]);
	});
	await cas(r, "sans aiOllamaUrl, rien à admettre", async () => {
		r.check("sans aiOllamaUrl, rien à admettre",
			await valider({ aiModel: "x" }), { ok: true, admettre: null });
	});
	await cas(r, "aiOutputFolder accepte seulement un chemin relatif sûr", async () => {
		const valides = ["Generated", "Quiz générés", "Cours/IA_2026"];
		const invalides = ["", "   ", "/Generated", "C:/Generated", "../Generated", "Generated/../Privé", "Generated\\Privé", "Generated:Privé", "Generated?", "Generated//Privé", "./Generated"];
		r.check("aiOutputFolder accepte seulement un chemin relatif sûr",
			{
				valides: valides.map(v => estDossierSortieIaValide?.(v)),
				invalides: invalides.map(v => estDossierSortieIaValide?.(v)),
			},
			{ valides: [true, true, true], invalides: Array(11).fill(false) });
	});
	await cas(r, "aiOutputFolder est gardé comme une chaîne et un chemin relatif sûr", async () => {
		const verdicts = await Promise.all([
			valider({ aiOutputFolder: "Generated/Cours" }),
			valider({ aiOutputFolder: 42 }),
			valider({ aiOutputFolder: "C:/Generated" }),
			valider({ aiOutputFolder: "Generated/../Privé" }),
			valider({ aiOutputFolder: "Generated?" }),
		]);
		r.check("aiOutputFolder est gardé comme une chaîne et un chemin relatif sûr",
			[
				verdicts[0],
				...verdicts.slice(1).map(v => "refus" in v && v.refus.includes("aiOutputFolder")),
			],
			[{ ok: true, admettre: null }, true, true, true, true]);
	});
	await cas(r, "une URL illisible, non-chaîne ou hors http(s) est refusée, nommée", async () => {
		const [pasChaine, illisible, fichier, ftp] = await Promise.all([
			valider({ aiOllamaUrl: 42 }),
			valider({ aiOllamaUrl: "pas une url" }),
			valider({ aiOllamaUrl: "file://127.0.0.1/C:/x" }),
			valider({ aiOllamaUrl: "ftp://localhost/x" }),
		]);
		r.check("une URL illisible, non-chaîne ou hors http(s) est refusée, nommée",
			[pasChaine, illisible, fichier, ftp].map(v => "refus" in v && /aiOllamaUrl/.test(v.refus)), [true, true, true, true]);
	});
	await cas(r, "un hôte de la liste ou du réseau local passe, et l'hôte est à admettre", async () => {
		r.check("un hôte de la liste ou du réseau local passe, et l'hôte est à admettre",
			await Promise.all([
				valider({ aiOllamaUrl: "http://localhost:11434" }),
				valider({ aiOllamaUrl: "HTTP://192.168.1.10:11434/" }),
				valider({ aiOllamaUrl: "https://ollama.com" }),
				valider({ aiOllamaUrl: "http://mon-nas.local:11434" }),
			]),
			[
				{ ok: true, admettre: "localhost" },
				{ ok: true, admettre: "192.168.1.10" },
				{ ok: true, admettre: "ollama.com" },
				{ ok: true, admettre: "mon-nas.local" },
			]);
	});
	await cas(r, "un hôte Internet hors liste demande confirmation, par son nom", async () => {
		r.check("un hôte Internet hors liste demande confirmation, par son nom",
			await valider({ aiOllamaUrl: "https://Attaquant.Example:8443/api" }),
			{ confirmer: "attaquant.example" });
	});
	await cas(r, "aiMentionExtraFolders : un dossier hors périmètre est refusé, nommé", async () => {
		const v = await valider({ aiMentionExtraFolders: ["D:/Quiz/Cours", "E:/Ailleurs"] });
		r.check("aiMentionExtraFolders : un dossier hors périmètre est refusé, nommé",
			"refus" in v && v.refus.includes("E:/Ailleurs"), true);
	});
	await cas(r, "aiMentionExtraFolders : tous dans le périmètre passe ; une forme autre qu'un tableau de chaînes est refusée", async () => {
		const [ok, pasTableau, pasChaines] = await Promise.all([
			valider({ aiMentionExtraFolders: ["D:/Quiz/Cours"] }),
			valider({ aiMentionExtraFolders: "D:/Quiz" }),
			valider({ aiMentionExtraFolders: [1] }),
		]);
		r.check("aiMentionExtraFolders : tous dans le périmètre passe ; une forme autre qu'un tableau de chaînes est refusée",
			[ok, "refus" in pasTableau, "refus" in pasChaines], [{ ok: true, admettre: null }, true, true]);
	});
	await cas(r, "le refus d'un dossier prime sur l'URL : rien n'est admis quand une moitié est refusée", async () => {
		const v = await valider({ aiOllamaUrl: "http://localhost:11434", aiMentionExtraFolders: ["E:/x"] });
		r.check("le refus d'un dossier prime sur l'URL : rien n'est admis quand une moitié est refusée", "refus" in v, true);
	});

	/* ── cheminClaude / cheminCodex : le champ qui fait LANCER un programme ──

	   C'est la garde la plus importante de cette clé depuis la tâche 7. Le
	   réglage désigne un exécutable que le PRINCIPAL lancera : une liste blanche
	   de NOMS d'outils ne sépare plus rien si le chemin, lui, peut être
	   n'importe quoi. Les trois conditions ne se remplacent pas —
	   — ABSOLU : un chemin relatif serait résolu contre le dossier courant du
	     processus principal, que l'utilisateur ne connaît pas ;
	   — EXISTANT : dit à l'ÉCRITURE, là où on peut encore le corriger, plutôt
	     qu'à la prochaine génération sous la forme « CLI introuvable » ;
	   — LANÇABLE : `.js`, `.ps1`, `.vbs` sont des SCRIPTS qu'un interpréteur
	     choisi par le système exécuterait — le pont refuse déjà de les OUVRIR
	     (`EXTENSIONS_EXECUTABLES`), les admettre ici rouvrirait la même porte
	     par l'autre bout ; un `.docx` ne se lance pas du tout, et produirait un
	     échec obscur très loin de l'écran où il a été saisi. */
	await cas(r, "un chemin de CLI absolu, existant et lançable est admis ; vide l'efface", async () => {
		const [exe, cmd, sansExtension, vide, absent] = await Promise.all([
			valider({ cheminClaude: "C:/Outils/claude.exe" }),
			valider({ cheminCodex: "C:/Outils/codex.cmd" }),
			// Sans extension : la forme normale d'un exécutable sous Unix.
			valider({ cheminClaude: "C:/Outils/claude" }),
			valider({ cheminClaude: "   " }),
			valider({ aiModel: "x" }),
		]);
		r.check("un chemin de CLI absolu, existant et lançable est admis ; vide l'efface",
			[exe, cmd, sansExtension, vide, absent].map(v => "ok" in v), [true, true, true, true, true]);
	});
	await cas(r, "un chemin de CLI relatif, inexistant, non-chaîne ou non lançable est refusé, nommé", async () => {
		const [relatif, inexistant, pasChaine, script, document] = await Promise.all([
			// EXISTANT et LANÇABLE : seule la règle « absolu » peut le refuser.
			valider({ cheminClaude: "outils/claude.exe" }),
			valider({ cheminClaude: "C:/Outils/absent.exe" }),
			valider({ cheminClaude: 42 }),
			valider({ cheminCodex: "C:/Outils/lance.ps1" }),
			valider({ cheminCodex: "C:/Outils/note.docx" }),
		]);
		r.check("un chemin de CLI relatif, inexistant, non-chaîne ou non lançable est refusé, nommé",
			[relatif, inexistant, pasChaine, script, document]
				.map(v => "refus" in v && /cheminC(laude|odex)/.test(v.refus)),
			[true, true, true, true, true]);
	});
	await cas(r, "un .js existant est refusé : ce n'est pas un CLI, c'est un script qu'un interpréteur exécuterait", async () => {
		/* Le cas le plus dangereux, et le seul que l'existence ne filtre PAS :
		   le fichier existe pour de bon. C'est la séquence « écris un `.js` dans
		   un dossier ouvert, puis désigne-le comme CLI » — celle que le refus
		   d'extension, et lui seul, empêche. */
		const v = await valider({ cheminClaude: "C:/Outils/shim.js" });
		r.check("un .js existant est refusé : ce n'est pas un CLI, c'est un script qu'un interpréteur exécuterait",
			"refus" in v && v.refus.includes(".js"), true);
	});
	await cas(r, "un chemin de CLI DANS le périmètre est refusé à l'écriture, nommé", async () => {
		/* LA CONDITION QUI TIENT TOUT LE RESTE (revue finale, C1). Le fichier
		   EXISTE et porte une extension lançable : seule la règle « hors du
		   périmètre » peut le refuser. Sans elle : `fichiers.write(
		   "<racine>/x.cmd")` — borné, l'extension n'est jugée qu'à l'ouverture —
		   puis ce chemin dans `cheminClaude`, et la génération suivante lance ce
		   que la fenêtre vient d'écrire, dans le processus principal. Un CLI
		   légitime n'est jamais dans un dossier de quiz. */
		const v = await valider({ cheminClaude: "D:/Quiz/Cours/claude.cmd" });
		r.check("un chemin de CLI DANS le périmètre est refusé à l'écriture, nommé",
			"refus" in v && v.refus.includes("dossier ouvert") && v.refus.includes("cheminClaude"), true);
	});
	await cas(r, "au lancement, le chemin réglé est REJUGÉ avec le périmètre du jour", async () => {
		/* Le périmètre GRANDIT après l'écriture : l'utilisateur ouvre plus tard
		   le dossier qui contient le `.cmd`. Le même chemin, admis contre un
		   périmètre qui ne le contient pas, est REFUSÉ contre celui qui le
		   contient — et alors rien n'est lancé, pas même un repli. */
		const dansQuiz = { cheminClaude: "D:/Quiz/Cours/claude.cmd" };
		const [hier, aujourdhui, valide, rien, autreOutil, disparu] = await Promise.all([
			cheminCliPourLancement(dansQuiz, "claude", existe, async () => false),
			cheminCliPourLancement(dansQuiz, "claude", existe, contient),
			cheminCliPourLancement({ cheminClaude: " C:/Outils/claude.exe " }, "claude", existe, contient),
			cheminCliPourLancement({ aiModel: "x" }, "claude", existe, contient),
			cheminCliPourLancement({ cheminClaude: "D:/Quiz/Cours/claude.cmd" }, "ollama", existe, contient),
			cheminCliPourLancement({ cheminCodex: "C:/Outils/absent.exe" }, "codex", existe, contient),
		]);
		r.check("au lancement, le chemin réglé est REJUGÉ avec le périmètre du jour",
			{
				hier,
				aujourdhui: "refus" in aujourdhui && aujourdhui.refus.includes("dossier ouvert"),
				valide,
				rien,
				autreOutil,
				disparu: "refus" in disparu && disparu.refus.includes("aucun fichier"),
			},
			{
				hier: { chemin: "D:/Quiz/Cours/claude.cmd" },
				aujourdhui: true,
				valide: { chemin: "C:/Outils/claude.exe" },
				rien: { chemin: undefined },
				autreOutil: { chemin: undefined },
				disparu: true,
			});
	});
	await cas(r, "le refus d'un chemin de CLI prime sur une URL valide", async () => {
		/* Rien n'est admis quand une moitié est refusée : sinon l'hôte d'Ollama
		   entrerait dans la liste du réseau alors que l'écriture est refusée. */
		const v = await valider({ aiOllamaUrl: "http://localhost:11434", cheminCodex: "C:/Outils/lance.ps1" });
		r.check("le refus d'un chemin de CLI prime sur une URL valide", "refus" in v, true);
	});

	/* ── STATIQUE : la garde est appelée AVANT l'écriture, dans le gestionnaire ── */
	const source = await readFile("apps/windows/electron/canaux.ts", "utf-8");
	const debut = source.indexOf("ipcMain.handle(CANAUX.reglagesEcrire,");
	let corps = null;
	if (debut >= 0) {
		let niveau = 0;
		for (let i = source.indexOf("(", debut); i < source.length; i++) {
			if (source[i] === "(") niveau++;
			else if (source[i] === ")" && --niveau === 0) { corps = source.slice(debut, i + 1); break; }
		}
	}
	const garde = corps ? corps.indexOf("garderReglagesIa(") : -1;
	const ecriture = corps ? corps.indexOf(".ecrire(") : -1;
	r.check("reglagesEcrire garde la clé ai (garderReglagesIa) AVANT d'écrire",
		{ gardee: garde >= 0, avantEcriture: garde >= 0 && ecriture > garde }, { gardee: true, avantEcriture: true });
	r.check("garderReglagesIa passe par le verdict pur validerReglagesIa, et n'écrit qu'après avoir admis l'hôte",
		// L'appel tient sur plusieurs lignes depuis qu'il porte DEUX prédicats
		// (périmètre, existence) : le motif tolère le retour à la ligne, il ne
		// tolère pas un autre premier argument que `valeur`.
		{ verdict: /validerReglagesIa\(\s*valeur\s*,/.test(source), admet: source.includes("autoriserHote(verdict.") },
		{ verdict: true, admet: true });
	r.done();
});

/**
 * LA GARDE DE LA CLÉ DU FOND D'ÉCRAN (revue finale de la tranche 8). Comme
 * `folders`, `fond.dossier` nourrit le périmètre au démarrage suivant
 * (`perimetreInitial`) : sans garde à l'écriture, un rendu compromis obtient
 * n'importe quel dossier du disque au périmètre à la session suivante.
 *
 * `canaux.ts` tire Electron et ne se charge dans aucun script (comme pour
 * `verifierDossiers`) : la preuve est donc STATIQUE, sur le module réel, et
 * NOMMÉE par discriminance (retirer la garde du gestionnaire fait rougir
 * exactement ce cas — vérifié à la main pendant l'écriture de ce contrôle).
 */
{
	const r = makeReporter("Électron — la garde de la clé du fond d'écran");
	const source = await readFile("apps/windows/electron/canaux.ts", "utf-8");
	const debut = source.indexOf("ipcMain.handle(CANAUX.reglagesEcrire,");
	let corps = null;
	if (debut >= 0) {
		let niveau = 0;
		for (let i = source.indexOf("(", debut); i < source.length; i++) {
			if (source[i] === "(") niveau++;
			else if (source[i] === ")" && --niveau === 0) { corps = source.slice(debut, i + 1); break; }
		}
	}
	const garde = corps ? corps.indexOf("verifierDossierFond(") : -1;
	const ecriture = corps ? corps.indexOf(".ecrire(") : -1;
	r.check("reglagesEcrire garde la clé du fond (verifierDossierFond) AVANT d'écrire",
		{ gardee: garde >= 0, avantEcriture: garde >= 0 && ecriture > garde }, { gardee: true, avantEcriture: true });
	r.check("verifierDossierFond rejette un dossier hors périmètre, une image absolue/traversante, accepte null (retrait)",
		{
			perimetreVerifie: source.includes("perimetre.contient(dossier)"),
			imageBornee: /image\.includes\("\/"\)/.test(source) && /image\.includes\("\.\."\)/.test(source),
			nullAccepte: /valeur === null \|\| valeur === undefined\) return;/.test(source),
		},
		{ perimetreVerifie: true, imageBornee: true, nullAccepte: true });
	r.done();
}
