/* ══════════════════════════════════════════════════════════
   L'HÔTE OBSIDIAN

   L'implémentation du contrat `src/host/types.ts` pour Obsidian. C'est ici, et
   NULLE PART AILLEURS sous `src/`, que le code partagé touche `app.vault`,
   `metadataCache`, `Notice` ou MathJax.

   Ce fichier vit sous `apps/obsidian/` par construction : il est le SEUL
   endroit du dépôt où dépendre d'`obsidian` est le but, pas une dette. C'est
   pourquoi `npm run check:host`, qui balaie `src/`, ne le voit pas.

   PLUS DE DOUBLE : quatre logiques ont MIGRÉ ici et n'existent plus ailleurs —
   la création de dossier des exports (ex-`ensureFolder` de
   `src/engine/results-save.ts`), la révélation dans l'explorateur et
   l'ouverture par l'application par défaut (ex-`revealFileInObsidianExplorer`
   et `openWithDefaultAppFromVault` de `src/engine/resources.ts`), et la
   mémoïsation de `loadMathJax` (ex-`src/engine/mathjax.ts`). Le portage s'est
   fait dans cet ordre — hôte écrit et éprouvé d'abord, appelants basculés
   ensuite, originaux supprimés en dernier — pour que le greffon ne soit à
   aucun moment cassé ; il est terminé.

   Et c'est ici, uniquement, qu'un `TFile` devient un `HostFile` (`toHostFile`
   ci-dessous). Toute autre conversion recopiée à la main est un défaut : elle
   diverge en silence le jour où `HostFile` gagne un champ.
══════════════════════════════════════════════════════════ */

import { Notice, Platform, setIcon, loadMathJax, renderMath, finishRenderMath } from "obsidian";
import type { App, DataAdapter, EventRef, TAbstractFile, TFile, View, WorkspaceLeaf } from "obsidian";
import type { Host, HostFile, HostFileEvent, HostRoot } from "../../src/host/types";
import { REVIEW_DIR, REVIEW_LOG_NAME } from "../../src/review/paths";

/** Shell Electron minimal (surface réellement consommée : shell.openPath). */
interface ElectronShellLike {
	openPath(path: string): Promise<string>;
}

/** L'API interne d'i18n d'Obsidian : absente d'`obsidian.d.ts`, mais c'est la
    SEULE source de la langue de l'interface (celle d'Obsidian, pas celle de
    l'OS). Même lecture que `detectObsidianLang` dans `src/i18n.ts`. */
interface I18nextLike { language?: string }

/**
 * Le seul endroit du dépôt où un `TFile` devient un `HostFile`.
 *
 * Laisser fuir un `TFile` dans le code partagé obligerait l'hôte Windows à en
 * fabriquer un faux — avec ses méthodes, son `vault` et son `parent` — pour
 * satisfaire un type dont il n'a que faire. Le `HostFile` est plat et
 * sérialisable ; l'ordre des champs suit `src/host/types.ts`.
 */
function toHostFile(f: TFile): HostFile {
	return {
		path: f.path,
		name: f.name,
		basename: f.basename,
		extension: f.extension,
		mtime: f.stat?.mtime ?? 0,
	};
}

/**
 * Discrimine un fichier d'un dossier par la PRÉSENCE d'`extension`, pas par
 * `instanceof TFile`.
 *
 * Un `TFolder` n'a pas d'`extension` : le test est exact au runtime. Et il est
 * ÉPROUVABLE — le bouchon `obsidian` des scripts de vérification ne peut pas
 * fabriquer un vrai `TFile`, donc exiger `instanceof` rendrait `getFile`,
 * `read` et `resolve` intestables, ce qui reviendrait à ne pas les contrôler.
 */
function asTFile(f: TAbstractFile | null | undefined): TFile | null {
	if (!f) return null;
	return typeof (f as TFile).extension === "string" ? (f as TFile) : null;
}

/** Le second paramètre est réduit à ce dont l'hôte a besoin — le manifeste,
    pour retrouver l'ANCIEN journal. Typer `Plugin` entier obligerait le jeu
    de cas à en fabriquer un, alors qu'un objet littéral suffit. */
export function createObsidianHost(
	app: App,
	plugin: { manifest: { dir?: string } },
): Host {
	const adapter = (): DataAdapter => app.vault.adapter;

	/** Le `TFile` d'un chemin, ou null (dossier, absent). */
	const tfile = (path: string): TFile | null => asTFile(app.vault.getAbstractFileByPath(path));

	/* ─── fs ─── */

	/** Reprise telle quelle de la boucle `ensureFolder` de
	    `engine/results-save.ts` : segment par segment, `exists` puis `mkdir`.
	    L'adaptateur n'a pas de création récursive, et créer « a/b/c » d'un coup
	    échoue si « a » manque. */
	async function mkdirs(path: string): Promise<void> {
		const parts = path.split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!(await adapter().exists(current))) {
				await adapter().mkdir(current);
			}
		}
	}

	const fs: Host["fs"] = {
		// `vault.read` quand le chemin est un fichier connu du vault, sinon
		// l'adaptateur : lui seul atteint les fichiers hors index (.obsidian/…),
		// où vivent justement les résultats exportés.
		async read(path) {
			const f = tfile(path);
			return f ? await app.vault.read(f) : await adapter().read(path);
		},
		// `cachedRead` est le chemin du BALAYAGE complet du vault : Obsidian sert
		// son cache au lieu de relire le disque. Ce n'est pas un alias de `read`.
		async readCached(path) {
			const f = tfile(path);
			return f ? await app.vault.cachedRead(f) : await adapter().read(path);
		},
		async write(path, data) {
			await adapter().write(path, data);
		},
		async exists(path) {
			return await adapter().exists(path);
		},
		mkdirs,
		async append(path, data) {
			await adapter().append(path, data);
		},
		/* Les FICHIERS seulement : `ListedFiles` sépare déjà `files` et
		   `folders`. Un dossier absent n'est pas une erreur — `list` jette
		   dans ce cas, et le contrat demande `[]`. */
		async list(dir) {
			try {
				return (await adapter().list(dir)).files;
			} catch (e) {
				return [];
			}
		},
		/* Ne rejette pas sur un fichier déjà absent : deux fenêtres Obsidian
		   peuvent absorber le même fichier de conflit, et le perdant n'a rien
		   fait de mal. */
		async remove(path) {
			try {
				await adapter().remove(path);
			} catch (e) {
				if (await adapter().exists(path)) throw e;
			}
		},
		/* Garde EXPLICITE, pas une confiance en `adapter().rename` : la
		   migration du journal (tâche 3) s'appuie sur ce rejet pour ne jamais
		   écraser une sauvegarde `.migrated` déjà posée — un `rename` qui
		   écraserait la destination en silence détruirait la sauvegarde que
		   la migration vient de créer. */
		async rename(from, to) {
			if (await adapter().exists(to)) throw new Error(`${to} existe déjà`);
			await adapter().rename(from, to);
		},
		listMarkdown() {
			return app.vault.getMarkdownFiles().map(toHostFile);
		},
		// TOUS les homonymes, casse ignorée : l'appelant prévient l'utilisateur
		// quand il y en a plusieurs. N'en rendre qu'un ferait disparaître
		// l'avertissement sans que rien ne le signale.
		findByName(name) {
			const cible = String(name ?? "").trim().toLowerCase();
			if (!cible) return [];
			return app.vault.getFiles()
				.filter(f => String(f?.name ?? "").trim().toLowerCase() === cible)
				.map(toHostFile);
		},
		getFile(path) {
			const f = tfile(path);
			return f ? toHostFile(f) : null;
		},
	};

	/* ─── links ─── */

	/* Ordre repris tel quel de `engine/sanitizer.ts` : le `metadataCache`
	   d'abord (lui seul comprend « schema.png » écrit depuis n'importe quelle
	   note), le chemin nu ensuite. Les deux appels sont gardés séparément :
	   une API interne qui jette ne doit pas emporter le repli avec elle.

	   Sorti de l'objet `links` pour être partagé par `resolve` ET
	   `resourceUrl` : le contrat impose à `resourceUrl` de RÉSOUDRE avant de
	   convertir, et deux résolutions écrites séparément divergent. Rend le
	   `TFile`, pas un `HostFile` : `getResourcePath` en a besoin. */
	function resoudreTFile(linkPath: string, fromPath: string): TFile | null {
		const raw = String(linkPath ?? "").trim();
		if (!raw) return null;

		try {
			if (app.metadataCache?.getFirstLinkpathDest) {
				const f = app.metadataCache.getFirstLinkpathDest(raw, fromPath || "");
				if (f) return f;
			}
		} catch (e) {
			console.warn("[Quiz] resolve (metadataCache) erreur:", e);
		}

		try {
			const f2 = asTFile(app.vault?.getAbstractFileByPath?.(raw));
			if (f2) return f2;
		} catch (e) {
			console.warn("[Quiz] resolve (getAbstractFileByPath) erreur:", e);
		}

		return null;
	}

	const links: Host["links"] = {
		resolve(linkPath, fromPath) {
			const f = resoudreTFile(linkPath, fromPath);
			return f ? toHostFile(f) : null;
		},
		/* « RÉSOUT puis convertit » (src/host/types.ts) : une chaîne passe par
		   `resoudreTFile` et rend `null` si rien ne correspond. L'ancien code
		   servait `adapter().getResourcePath(chemin)` sans rien vérifier — il
		   ne rendait donc JAMAIS `null` pour une chaîne non vide, ce qui
		   rendait morte la branche « chemin non résoluble » de son unique
		   appelant (`src/engine/cards.ts`) et laissait cassé un nom nu
		   (« schema.png ») référencé depuis un sous-dossier.

		   `null` et JAMAIS la chaîne vide : un `src=""` fait recharger la page
		   courante comme image — requête inutile et image cassée. */
		resourceUrl(target, fromPath) {
			try {
				const f = typeof target === "string"
					? resoudreTFile(target, fromPath || "")
					: tfile(target.path);
				return (f && app.vault.getResourcePath(f)) || null;
			} catch (e) {
				console.warn("[Quiz] resourceUrl erreur:", e);
				return null;
			}
		},
	};

	/* ─── watcher ─── */

	const watcher: Host["watcher"] = {
		/* Les quatre évènements du vault, traduits en `HostFileEvent`. `rename`
		   reste distinct de delete+create : le journal de révision suit ses clés
		   par renommage, et deux évènements ne se recollent pas.
		   Seuls les fichiers remontent — un dossier créé ne concerne personne. */
		onChange(cb) {
			const refs: EventRef[] = [];
			const emettre = (ev: HostFileEvent): void => {
				try { cb(ev); } catch (e) { console.warn("[Quiz] watcher: rappel en erreur:", e); }
			};

			refs.push(app.vault.on("create", (f: TAbstractFile) => {
				const file = asTFile(f);
				if (file) emettre({ kind: "create", file: toHostFile(file) });
			}));
			refs.push(app.vault.on("modify", (f: TAbstractFile) => {
				const file = asTFile(f);
				if (file) emettre({ kind: "modify", file: toHostFile(file) });
			}));
			// `delete` ne porte que le chemin : le fichier n'existe plus, rien à
			// convertir, et le contrat le dit ainsi.
			refs.push(app.vault.on("delete", (f: TAbstractFile) => {
				if (asTFile(f)) emettre({ kind: "delete", path: f.path });
			}));
			refs.push(app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
				const file = asTFile(f);
				if (file) emettre({ kind: "rename", file: toHostFile(file), oldPath });
			}));

			return () => {
				for (const ref of refs) {
					try { app.vault.offref(ref); } catch (e) { /* best effort */ }
				}
				refs.length = 0;
			};
		},
		/* `asTFile` rend null pour un DOSSIER : c'est exactement le cas que
		   `onChange` écarte, et celui dont le journal a besoin. Obsidian émet
		   le même évènement pour les deux, avec la même signature
		   (`TAbstractFile`) — d'où ce second abonnement plutôt qu'un champ
		   « isDir » que l'app ne saurait pas remplir honnêtement. */
		onRenameDir(cb) {
			const ref = app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
				if (asTFile(f)) return;
				try { cb({ from: oldPath, to: f.path }); } catch (e) { console.warn("[Quiz] onRenameDir: rappel en erreur:", e); }
			});
			return () => { try { app.vault.offref(ref); } catch (e) { /* best effort */ } };
		},
	};

	/* ─── ui ─── */

	const ui: Host["ui"] = {
		/* Le message arrive DÉJÀ TRADUIT par son appelant : l'hôte n'a aucune
		   chaîne de son cru. Le `try/catch` est le comportement actuel de
		   `quizNotice` — hors fenêtre Obsidian, `new Notice` jette, et une
		   notification perdue ne doit pas emporter le rendu avec elle. */
		notice(message, timeoutMs = 4000) {
			try { new Notice(String(message), timeoutMs); } catch (_) { console.log("[Quiz]", message); }
		},
		setIcon(el, name) {
			setIcon(el, name);
		},
	};

	/* ─── math ─── */

	/* Mémoïsation reprise de `engine/mathjax.ts` : MathJax n'est chargé qu'une
	   fois par session. Un ÉCHEC, lui, n'est pas mémoïsé — sinon une panne
	   transitoire (appel très tôt, environnement dégradé) tuerait le rendu
	   mathématique pour TOUTE la session, sans plus jamais retenter. */
	let mathReady: Promise<void> | null = null;

	const math: Host["math"] = {
		ready() {
			if (!mathReady) {
				mathReady = loadMathJax();
				mathReady.catch(() => { mathReady = null; });
			}
			return mathReady;
		},
		render(latex, display) {
			return renderMath(latex, display);
		},
		// Obsidian a besoin d'une passe finale après un lot de `renderMath`.
		// Sa promesse n'intéresse personne : le DOM est déjà en place.
		flush() {
			void finishRenderMath();
		},
	};

	/* ─── shell ─── */

	const shell: Host["shell"] = {
		/* Repris de `openWithDefaultAppFromVault` (engine/resources.ts).
		   Le contrat rend un booléen : la distinction « sélecteur système »
		   (Android) / « application par défaut » se redéduit chez l'appelant
		   depuis `platform.isMobile`, elle n'a pas à voyager ici. */
		async openExternal(file) {
			const f = file && tfile(file.path);
			if (!f) return false;
			try {
				// app.openWithDefaultApp : API non documentée dans obsidian.d.ts mais
				// bien présente au runtime (même convention de cast que dashboard/ai.ts).
				const appWithOpen = app as App & { openWithDefaultApp?: (path: string) => Promise<void> };
				if (typeof appWithOpen.openWithDefaultApp === "function") {
					await appWithOpen.openWithDefaultApp(f.path);
					return true;
				}
			} catch (e) {
				console.warn("[Quiz] app.openWithDefaultApp a échoué:", e);
			}
			try {
				// DataAdapter.getFullPath n'est déclaré que sur les classes concrètes
				// (FileSystemAdapter/CapacitorAdapter), pas sur l'interface générique.
				const ad = adapter() as DataAdapter & { getFullPath?: (path: string) => string };
				const absPath = ad?.getFullPath?.(f.path);
				const electronRequire = (window as Window & { require?: (id: string) => { shell?: ElectronShellLike } }).require;
				const electronShell = electronRequire?.("electron")?.shell;
				if (absPath && electronShell?.openPath) {
					// openPath rend la chaîne vide en cas de SUCCÈS, un message sinon.
					const result = await electronShell.openPath(absPath);
					if (result === "") return true;
				}
			} catch (e) {
				console.warn("[Quiz] fallback Electron openPath a échoué:", e);
			}
			return false;
		},
		/* Repris de `revealFileInObsidianExplorer` (engine/resources.ts). Rendre
		   `false` n'est pas une erreur : l'appelant enchaîne sur l'ouverture. */
		async revealInHost(file) {
			const f = file && tfile(file.path);
			if (!f) return false;
			try {
				let leaf: WorkspaceLeaf | null = (app.workspace?.getLeavesOfType?.("file-explorer") || [])[0];
				if (!leaf && typeof app.workspace?.getLeftLeaf === "function") {
					leaf = app.workspace.getLeftLeaf(false);
					if (leaf && typeof leaf.setViewState === "function") await leaf.setViewState({ type: "file-explorer", active: false });
				}
				if (!leaf) return false;
				// L'explorateur vient peut-être d'être ouvert : sa vue n'est montée
				// qu'au tick suivant, `revealInFolder` n'existerait pas encore.
				await new Promise<void>(r => setTimeout(r, 60));
				const view = leaf?.view as (View & { revealInFolder?: (file: TFile) => Promise<void> }) | undefined;
				if (view && typeof view.revealInFolder === "function") {
					await view.revealInFolder(f);
					try { app.workspace?.revealLeaf?.(leaf); } catch (_) {}
					return true;
				}
			} catch (e) {
				console.warn("[Quiz] revealInFolder a échoué:", e);
			}
			return false;
		},
	};

	/* ─── platform ─── */

	const platform: Host["platform"] = {
		isMobile: Platform.isMobile,
		isMacOS: Platform.isMacOS,
		/* Accesseur et non valeur figée : la langue d'Obsidian change sans
		   recharger le greffon, et une constante lue à l'installation resterait
		   celle du démarrage.
		   L'étiquette est rendue BRUTE (« fr », « fr-FR ») : c'est `src/i18n.ts`
		   qui décide ce qu'il en fait, pas l'hôte. `window.i18next` n'est PAS une
		   API publique (absente d'obsidian.d.ts) — d'où le repli sur
		   `<html lang>` puis l'anglais. */
		get uiLanguage(): string {
			try {
				const i18next = (window as unknown as { i18next?: I18nextLike }).i18next;
				const raw = i18next && typeof i18next.language === "string" ? i18next.language : "";
				return raw || document.documentElement.lang || "en";
			} catch (e) {
				return "en";
			}
		},
	};

	/* ─── paths ─── */

	/* UNE SEULE RACINE, d'identifiant VIDE : les chemins du greffon restent
	   exactement ce qu'ils ont toujours été, et `localPath` est l'identité.
	   C'est ce qui garantit que la clé du journal ne change pas d'un octet
	   pour les notes déjà journalisées. */
	const racine: HostRoot = {
		id: "",
		name: app.vault.getName(),
		reviewLog: `${REVIEW_DIR}/${REVIEW_LOG_NAME}`,
		/* L'ancien journal : `manifest.dir` tel que l'API le donne, jamais
		   recomposé. Il est optionnel (PluginManifest.dir), et son absence
		   signifie seulement qu'il n'y a rien à migrer. */
		legacyReviewLog: plugin.manifest.dir ? `${plugin.manifest.dir}/${REVIEW_LOG_NAME}` : null,
	};

	const paths: Host["paths"] = {
		/* NE CHANGE PAS, et ignore son argument : les fichiers de résultats
		   déjà écrits chez l'utilisateur vivent là. Même nature de piège que
		   `PLUGIN_ID` et `QUIZ_BLOCK_LANGUAGE`. */
		resultsDirFor() {
			return ".obsidian/quiz-blocks-results";
		},
		roots() {
			return [racine];
		},
		rootOf() {
			return racine;
		},
		localPath(path) {
			return path;
		},
		contractPath(_rootId, localPath) {
			return localPath;
		},
	};

	return { fs, links, watcher, ui, math, shell, platform, paths };
}
