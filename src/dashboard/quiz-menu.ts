import { currentHost, requireHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { DashboardShellCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup, ModuleMap } from "./quiz-modules";
import { openModuleEditModal } from "./module-edit";
import { openActionMenu, type ActionMenuItem } from "./ui-select";
import { QUIZ_BLOCK_RE } from "../quiz-utils";
import { isFolderArchived, setFolderArchived } from "./folder-archive";

/* ══════════════════════════════════════════════════════════
   QUIZ MENU — contenu du menu ⋯ des cartes de « Mes quiz ».
   Dérivé de la capture StudySmarter d'Ahmed (Excalidraw, 2026-07-18) :
   Share / Edit / Rename / Archive / Delete (rouge), adaptés au plugin :
   - Share    → copie le bloc ```quiz-blocks``` dans le presse-papier ;
   - Rename   → renomme la NOTE (le titre d'un quiz EST son basename,
                cf. scanner.ts) — carte de quiz seulement, la carte de
                module renomme déjà via « Edit » ;
   - Archive  → masque le quiz partout, revient via la pilule « Archivés » ;
   - Delete   → supprime le bloc de la note (corbeille si la note ne
                contenait que lui) + ses stats, après confirmation.
   (« Pause study reminders » retiré le 2026-07-21 à la demande d'Ahmed —
   avec sa mécanique : sans entrée de menu, un quiz déjà suspendu serait
   resté hors du « À faire » sans aucun moyen de le reprendre.)

   Tranche 3 (tâche 9) : ce module ne connaît plus Obsidian. La suppression
   passe par `HostFs` (`process`, `trash`), les deux modales par
   `HostModals`. Partager et Renommer, eux, ne sont PAS des opérations du
   contrat : elles restent des membres OPTIONNELS du ctx (`shareQuiz?`,
   `renameQuiz?`), remplis par le greffon et absents de l'application — voir
   leur justification dans `types/dashboard-ctx.ts`. Le menu de la fenêtre
   a donc DEUX entrées sur quatre (Éditer, Supprimer), et pas une ligne
   grise de plus : une entrée absente se lit comme un hôte qui fait autre
   chose, une entrée désactivée comme une panne.
══════════════════════════════════════════════════════════ */

/* `isFolderArchived`/`setFolderArchived` ont déménagé dans `folder-archive.ts`
   (tour de correction 1, tâche 6) : ces deux fonctions ne lisaient déjà QUE
   les cinq réglages de `DashboardShellCtx` (tâche 5), sans rien d'Obsidian —
   les garder ici forçait home.ts et quizzes.ts (qui n'en ont besoin QUE pour
   ça) à importer transitivement `Notice`/`TFile` via ce fichier. Ce module ne
   les utilise plus qu'en INTERNE (import ci-dessus, `buildModuleCardMenu`) ;
   home.ts et quizzes.ts importent désormais `folder-archive.ts` directement. */

/* ── Confirmations : l'ARCHIVAGE est direct dans les deux sens (demande
   Ahmed 2026-07-19), Delete confirme en rouge. ── */

interface ConfirmSpec {
	title: string;
	body: string;
	cta: string;
	/** true = bouton rouge (`qb-btn-danger`) : Delete uniquement. */
	warning?: boolean;
}

/**
 * `onConfirm` est appelé AU CLIC, juste après avoir demandé la fermeture —
 * comme le faisait la classe d'avant, et à la différence d'`openConfirmModal`
 * (`editor/modals.ts`, qui attend la disparition). La différence ne se voit
 * pas ici : ce que `onConfirm` lance est une écriture ASYNCHRONE, et le
 * repeint n'arrive qu'à son terme, bien après les 240 ms de l'animation.
 *
 * Les classes sont celles d'`openConfirmModal` (`qb-confirm-buttons`,
 * `qb-btn`, `qb-btn-danger`), qui vivent dans le CSS PARTAGÉ
 * (`src/assets/css/editor/`) chargé par les deux hôtes — et non les classes
 * natives d'Obsidian (`modal-button-container`, `mod-cta`, `mod-warning`) que
 * la tâche 9 avait gardées : la fenêtre n'a aucun CSS pour celles-ci, et
 * « Supprimer » et « Annuler » y étaient deux `<button>` bruts
 * INDISCERNABLES. Deux surfaces qui confirment une suppression ne peuvent
 * pas avoir chacune leur habillage.
 */
function openConfirm(spec: ConfirmSpec, onConfirm: () => void): void {
	requireHost("modals").open({
		title: spec.title,
		onOpen: (m) => {
			const c = m.contentEl;
			ajouter(c, "p", "qb-confirm-message", spec.body);
			const row = ajouter(c, "div", "qb-confirm-buttons");
			const cancel = ajouter(row, "button", "qb-btn", t("editor.action.cancel"));
			cancel.addEventListener("click", () => m.close());
			const ok = ajouter(row, "button", spec.warning ? "qb-btn qb-btn-danger" : "qb-btn", spec.cta);
			ok.addEventListener("click", () => { m.close(); onConfirm(); });
		},
		/* Pas de `contentEl.empty()` : l'hôte vide le corps lui-même après la
		   disparition (contrat de `HostModalHandle`). */
	});
}

/* ── Renommage d'un quiz ──
   Le titre d'un quiz EST le basename de sa note (scanner.ts) : renommer =
   renommer le fichier, via `ctx.renameQuiz` — que le greffon remplit avec
   `fileManager.renameFile`, jamais `vault.rename`, pour qu'Obsidian réécrive
   les liens entrants ([[ancien nom]]) tout seul. `HostFs.rename` ne convient
   pas (il déplace des octets sans rien réécrire), d'où le membre optionnel du
   ctx plutôt qu'un appel au contrat : voir `types/dashboard-ctx.ts`.
   Les stats suivent : stats-store écoute l'évènement de renommage du
   surveillant (il couvre donc AUSSI un renommage fait à la main dans
   l'explorateur).

   RÉPARTITION DES GARDES. La modale ne fait que ce que les deux hôtes savent
   faire pareil : assainir le nom, ignorer un nom vide ou inchangé, vérifier
   que la note existe encore (`fs.getFile`). La collision avec un fichier
   déjà présent, le renommage lui-même et l'AFFICHAGE de la cause d'un échec
   (Notice « existe déjà », « impossible ») appartiennent à l'hôte, dans
   `renameQuiz` : lui seul sait comment son index voit la cible. Le rappel
   rend `true` si renommé, `false` sinon — la modale se ferme sur `true`,
   RESTE OUVERTE sur `false` pour que l'utilisateur corrige le nom au lieu
   de le retaper. */
function openRenameQuizModal(
	quiz: QuizIndexEntry,
	renameQuiz: (quiz: QuizIndexEntry, nom: string) => Promise<boolean>,
	onDone: () => void,
): void {
	let name = quiz.basename;
	requireHost("modals").open({
		className: "qbd-medit-modal",
		// t() AU RENDU (à l'ouverture), jamais dans une constante de haut niveau.
		title: t("dashboard.quizzes.renameTitle"),
		onOpen: (m) => {
			const c = m.contentEl;
			ajouter(c, "p", "qbd-medit-label", t("dashboard.quizzes.renameLabel"));
			const input = ajouter(c, "input", "qbd-medit-input");
			input.type = "text";
			input.value = name;
			input.addEventListener("input", () => { name = input.value; });
			// Sélection du nom entier : le cas courant est de tout retaper.
			window.setTimeout(() => { input.focus(); input.select(); }, 0);

			const apply = async (): Promise<void> => {
				// Mêmes caractères interdits que freeNotePath (folder-create.ts).
				const nom = name.trim().replace(/[\\/:*?"<>|]/g, "-");
				if (!nom || nom === quiz.basename) { m.close(); return; }
				// La note a disparu entre l'ouverture du menu et le clic : rien à
				// corriger dans le nom, la modale se ferme (conduite d'avant).
				if (!currentHost().fs.getFile(quiz.path)) {
					currentHost().ui.notice(t("dashboard.detail.fileNotFound"));
					m.close();
					return;
				}
				// `false` : l'hôte a déjà dit pourquoi ; le nom saisi reste à
				// l'écran pour être corrigé.
				if (!await renameQuiz(quiz, nom)) return;
				m.close();
				onDone();
			};
			const save = ajouter(c, "button", "qbd-medit-save", t("dashboard.quizzes.renameCta"));
			save.addEventListener("click", () => { void apply(); });
			input.addEventListener("keydown", (e) => { if (e.key === "Enter") void apply(); });
		},
	});
}

async function deleteQuiz(ctx: DashboardShellCtx, quiz: QuizIndexEntry): Promise<void> {
	// `getFile` rend null pour un dossier comme pour un absent : la garde
	// reste nécessaire, seule sa forme a changé (`instanceof TFile` avant).
	if (!currentHost().fs.getFile(quiz.path)) {
		currentHost().ui.notice(t("dashboard.detail.fileNotFound"));
		return;
	}
	// La note peut ne plus contenir de bloc (supprimé ailleurs entre-temps) :
	// annoncer « Quiz supprimé » serait alors faux.
	if (await deleteQuizCore(ctx, quiz)) currentHost().ui.notice(t("dashboard.quizzes.deleted"));
	else currentHost().ui.notice(t("dashboard.detail.noBlockInNote"));
}

/**
 * Cœur du delete, sans Notice (partagé quiz seul / module entier). L'appelant
 * a déjà vérifié que la note est au catalogue (`fs.getFile`).
 *
 * `fs.process` et non `read` + `write` : entre les deux, ce que
 * l'utilisateur venait d'écrire ailleurs dans la note était écrasé — et si ce
 * qu'il avait écrit était la seule chose qui restait, la note partait À LA
 * CORBEILLE sur la foi d'une lecture périmée (revue codex 2026-07-31). La
 * décision « il ne reste rien » se prend donc sur le contenu RÉEL au moment de
 * l'écriture, et la mise à la corbeille n'a lieu qu'après.
 */
async function deleteQuizCore(ctx: DashboardShellCtx, quiz: QuizIndexEntry): Promise<boolean> {
	const fs = currentHost().fs;
	let videApresRetrait = false;
	let avaitUnBloc = false;
	/** Le contenu vu par le dernier passage du rappel — le témoin d'un
	    éventuel `trash`. */
	let vu = "";
	await fs.process(quiz.path, (content) => {
		// Le rappel peut être rejoué : repartir de zéro à chaque essai.
		vu = content;
		avaitUnBloc = QUIZ_BLOCK_RE.test(content);
		if (!avaitUnBloc) { videApresRetrait = false; return content; }
		const remaining = content.replace(QUIZ_BLOCK_RE, "");
		videApresRetrait = remaining.trim().length === 0;
		// Rien d'autre dans la note : on ne la vide pas pour la jeter juste
		// après — on la laisse telle quelle et c'est la corbeille qui l'emporte.
		return videApresRetrait ? content : remaining;
	});
	/* Aucun bloc trouvé : la note a été vidée ailleurs entre-temps. On ne
	   touche ni au fichier ni aux statistiques — supprimer l'enregistrement
	   d'un quiz qu'on n'a pas supprimé effacerait un historique de révision
	   pour rien (revue codex 2026-07-31). */
	if (!avaitUnBloc) return false;
	if (videApresRetrait) {
		/* COMPARE-AND-SWAP avant la corbeille : entre le rappel et ici,
		   quelqu'un a pu ajouter du texte à la note. La jeter emporterait ce
		   texte (revue codex 2026-07-31). Si elle a changé, on se rabat sur le
		   retrait du seul bloc — la note reste, avec ce qui vient d'y être
		   écrit. */
		let jetee = false;
		await fs.process(quiz.path, (content) => {
			if (content !== vu) {
				jetee = false;
				return content.replace(QUIZ_BLOCK_RE, "");
			}
			jetee = true;
			return content;
		});
		/* La note ne contenait que le quiz : corbeille (RÉCUPÉRABLE), jamais de
		   suppression définitive — c'est ce que `fs.trash` promet, chaque hôte
		   avec sa propre convention.
		   Fenêtre résiduelle assumée : une écriture arrivée entre ce
		   compare-and-swap et `trash` partira quand même à la corbeille.
		   Aucun hôte n'expose de « jeter si inchangé », et c'est précisément
		   parce qu'on ne peut pas la fermer que la corbeille est le seul geste
		   admis ici — l'utilisateur récupère sa note en un clic. */
		if (jetee) await fs.trash(quiz.path);
	}
	ctx.statsStore?.deleteRecord(quiz.path);
	return true;
}

/** Delete d'un MODULE entier : chaque quiz passe par le même cœur. */
async function deleteModuleQuizzes(ctx: DashboardShellCtx, group: ModuleGroup): Promise<void> {
	/* Une note qui résiste n'arrête pas les autres, et ne fait pas passer la
	   suppression pour un échec total : chaque quiz est indépendant, et laisser
	   une exception remonter d'ici laissait le module A MOITIÉ supprimé avec
	   une interface qui ne se redessinait même pas (revue codex 2026-07-31). */
	let echecs = 0;
	for (const q of group.quizzes) {
		// Fichier introuvable (ou dossier à ce chemin — `getFile` rend null
		// dans les deux cas) : c'est un échec comme un autre, pas un silence.
		// Le compter est la seule façon pour l'utilisateur de savoir que le
		// module n'a pas été entièrement supprimé.
		if (!currentHost().fs.getFile(q.path)) { echecs++; continue; }
		try {
			// Un `false` — aucun bloc trouvé — est un échec comme un autre :
			// l'annoncer comme un succès faisait croire le module entièrement
			// supprimé (revue codex 2026-07-31).
			if (!await deleteQuizCore(ctx, q)) echecs++;
		} catch (e) {
			echecs++;
			console.error("[quiz-blocks] suppression impossible :", q.path, e);
		}
	}
	currentHost().ui.notice(echecs
		? t("dashboard.quizzes.deletedPartial", { count: echecs })
		: t("dashboard.quizzes.deleted"));
}

/* ── Menus ── */

/** Menu ⋯ d'une carte de quiz — l'ordre et la rangée rouge suivent la
    référence StudySmarter. Bâti AU CLIC (le nom du quiz peut avoir changé).
    AUCUNE entrée d'archivage : l'archivage n'existe qu'au niveau dossier
    (Ahmed 2026-07-19). */
export function buildQuizCardMenu(ctx: DashboardShellCtx, rerender: () => void): (quiz: QuizIndexEntry) => ActionMenuItem[] {
	return (quiz) => {
		/* Capturés dans des constantes : le rétrécissement de type d'un `if`
		   sur `ctx.shareQuiz` ne survivrait pas jusqu'au `onClick`. */
		const { shareQuiz, renameQuiz } = ctx;
		const items: ActionMenuItem[] = [];
		// Poussée seulement si l'hôte sait partager : une entrée grise se lit
		// comme une panne, une entrée absente comme un hôte qui fait autre
		// chose (même geste que `onMenu?` sur les cartes, tranche 2.5).
		if (shareQuiz) items.push({
			icon: "share-2",
			label: t("dashboard.quizzes.menuShare"),
			// Même modal de partage que les dossiers (Discord / enregistrer),
			// avec le .md du quiz seul — remplace l'ancienne copie de bloc
			// texte, jugée insuffisante (demande Ahmed 2026-07-19).
			onClick: () => { shareQuiz({ quiz }); },
		});
		items.push({
			icon: "pencil",
			label: t("dashboard.detail.edit"),
			// La page du quiz, en ÉDITION, DANS le dashboard : ouvrir un
			// onglet à côté ferait deux surfaces pour le même quiz, alors
			// qu'un clic sur la carte mène déjà à cette page.
			onClick: () => { ctx.navigate("detail", { quiz, edit: true }); },
		});
		// Même règle que Partager : sans `renameQuiz`, pas d'entrée. Rendre
		// « Renommer » sur `HostFs.rename` casserait les liens entrants en
		// silence — une entrée qui n'existe pas vaut mieux qu'une qui ment.
		if (renameQuiz) items.push({
			// « text-cursor-input » et non un crayon : « Edit » (pencil) ouvre
			// déjà l'éditeur de questions — deux crayons se confondraient.
			icon: "text-cursor-input",
			label: t("dashboard.quizzes.menuRename"),
			onClick: () => { openRenameQuizModal(quiz, renameQuiz, rerender); },
		});
		/* « Copier le chemin » — le chemin ABSOLU, comme le Ctrl+Maj+C de
		   l'explorateur (Ahmed, 2026-09-17). Sans `absolutePath`, pas d'entrée :
		   même règle que Partager et Renommer, une entrée qui ne peut pas tenir
		   sa promesse ne s'affiche pas. L'échec de la copie se DIT — le
		   presse-papiers peut être refusé, et un menu qui se ferme sans rien
		   faire laisserait croire que c'est copié. */
		if (ctx.absolutePath && ctx.copyText) items.push({
			icon: "copy",
			label: t("dashboard.quizzes.menuCopyPath"),
			onClick: () => {
				const absolu = ctx.absolutePath?.(quiz.path);
				if (!absolu) { currentHost().ui.notice(t("dashboard.quizzes.pathCopyFailed")); return; }
				void ctx.copyText?.(absolu).then(ok => {
					currentHost().ui.notice(t(ok ? "dashboard.quizzes.pathCopied" : "dashboard.quizzes.pathCopyFailed"));
				});
			},
		});
		items.push({
			icon: "trash-2",
			label: t("dashboard.quizzes.menuDelete"),
			danger: true,
			onClick: () => {
				openConfirm({
					title: t("dashboard.quizzes.deleteConfirmTitle"),
					body: t("dashboard.quizzes.deleteConfirmBody", { title: quiz.title }),
					cta: t("dashboard.quizzes.deleteConfirmCta"),
					warning: true,
				}, () => { void deleteQuiz(ctx, quiz).then(rerender); });
			},
		});
		return items;
	};
}

/** Menu ⋯ d'une carte de module — mêmes rangées que la carte de quiz
    (demande Excalidraw 2026-07-18), adaptées au niveau module :
    Share = zip des notes du module (envoyable sur Discord), Edit = nom /
    UE / couleur du dossier (le renommage du module vit là, d'où l'absence
    d'entrée « Rename » ici), Archive = LE DOSSIER (flag unique
    quizzesArchivedFolders — jamais par quiz), Delete = tous les quiz du
    module (confirmation avec le compte). */
/** Déplace le dossier `g.folder` vers la racine `toRoot`, sous le même nom
    de dossier, puis transpose l'historique de révision qui lui appartient
    (§2.3 de la spec) — voir `moveModuleTo` plus bas pour le détail. Séparée
    de `buildModuleCardMenu` pour rester testable sans DOM. */
async function moveModuleTo(ctx: DashboardShellCtx, g: ModuleGroup, toRootId: string): Promise<boolean> {
	const host = currentHost();
	const localFrom = host.paths.localPath(g.folder);
	// Dernier segment du chemin local : « B1/Cours/Reseaux » → « Reseaux ».
	// Le dossier arrive à la racine cible SOUS LE MÊME NOM (spec §2.3), pas
	// sous son chemin complet — un module d'un vault n'a pas à recréer toute
	// l'arborescence de son ancien vault dans le dossier par défaut.
	const nomDossier = localFrom.split("/").pop() ?? localFrom;
	const to = host.paths.contractPath(toRootId, nomDossier);
	try {
		await host.fs.rename(g.folder, to);
	} catch {
		// Le contrat de `rename` refuse d'écraser : un homonyme existe déjà
		// à la cible, rien n'a bougé.
		host.ui.notice(t("dashboard.quizzes.moveExists"));
		return false;
	}
	await ctx.reviewStore?.moved(g.folder, to);
	return true;
}

export function buildModuleCardMenu(ctx: DashboardShellCtx, rerender: () => void, map: ModuleMap): (g: ModuleGroup, anchorEl?: HTMLElement) => ActionMenuItem[] {
	return (g, anchorEl) => {
		const archived = isFolderArchived(ctx, g.folder);
		const { shareQuiz } = ctx;
		const host = currentHost();
		const items: ActionMenuItem[] = [];
		// Absente, jamais grise : voir `buildQuizCardMenu`.
		if (shareQuiz) items.push({
			icon: "share-2",
			label: t("dashboard.quizzes.menuShare"),
			onClick: () => { shareQuiz({ group: g }); },
		});
		items.push({
			icon: "pencil",
			label: t("dashboard.detail.edit"),
			// Modal « Modifier dossier » calqué sur StudySmarter (nom / UE /
			// couleur, sans le toggle public) — remplace l'ancienne ouverture
			// de la note de correspondance, jugée non fonctionnelle.
			onClick: () => { openModuleEditModal(ctx, g, map, rerender); },
		});
		items.push({
			icon: "archive",
			label: t(archived ? "dashboard.quizzes.menuUnarchive" : "dashboard.quizzes.menuArchive"),
			// Direct dans les deux sens (demande Ahmed 2026-07-19 : plus
			// aucune confirmation d'archivage). Un seul flag par DOSSIER :
			// opérationnel même quand la grille ne montre aucun quiz du
			// module (l'ancien modèle par-quiz rendait « Unarchive »
			// inopérant sur un module entièrement archivé, g.quizzes filtré
			// étant vide).
			onClick: () => { setFolderArchived(ctx, g.folder, !archived); rerender(); },
		});
		// Une seule racine (le vault, sous Obsidian) : rien où déplacer.
		// `anchorEl` manquant (appelant qui n'aurait pas encore été mis à jour) :
		// même chose, plutôt que d'ouvrir un sous-menu sans rien à y ancrer.
		const roots = host.paths.roots();
		if (anchorEl && roots.length > 1) {
			items.push({
				icon: "folder-input",
				label: t("dashboard.quizzes.menuMove"),
				onClick: () => {
					const rootDeG = host.paths.rootOf(g.folder);
					const cibles = roots.filter(root => root.id !== rootDeG?.id);
					openActionMenu(anchorEl, cibles.map(root => ({
						label: root.name,
						onClick: () => {
							openConfirm({
								title: t("dashboard.quizzes.moveConfirmTitle"),
								body: t("dashboard.quizzes.moveConfirmBody", { name: g.name, target: root.name }),
								cta: t("dashboard.quizzes.moveConfirmCta"),
							}, () => {
								void moveModuleTo(ctx, g, root.id).then(ok => {
									if (ok) {
										host.ui.notice(t("dashboard.quizzes.moved", { target: root.name }));
										rerender();
									}
								});
							});
						},
					})));
				},
			});
		}
		items.push({
			icon: "trash-2",
			label: t("dashboard.quizzes.menuDeleteModule"),
			danger: true,
			onClick: () => {
				openConfirm({
					title: t("dashboard.quizzes.deleteConfirmTitle"),
					body: t("dashboard.quizzes.deleteModuleConfirmBody", { count: g.quizzes.length, name: g.name }),
					cta: t("dashboard.quizzes.deleteConfirmCta"),
					warning: true,
				}, () => { void deleteModuleQuizzes(ctx, g).then(rerender); });
			},
		});
		return items;
	};
}
