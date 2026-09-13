/* ══════════════════════════════════════════════════════════
   LA PAGE « RÉGLAGES » — les dossiers de quiz

   Ajouter et retirer des dossiers : c'est le SEUL endroit de l'application où
   `folder.ts` (tâche 5) est piloté depuis un écran, plutôt que consommé au
   démarrage. La tâche 10 y ajoute une seconde section (« Dates d'examen »),
   la tâche 11 une carte « À réviser » ailleurs sur cette page — d'où une
   fonction `dessiner()` qui ne redessine que SA section, et non toute la page.

   Les CLASSES de structure sont celles du tableau de bord (`qbd-content`,
   `qbd-quizzes-header`…) : `src/assets/css/` est déjà chargé par `main.ts`.
   Seules les classes neuves (`nq-reglages-*`) vivent dans `shell.css`. Ce
   module n'importe AUCUN CSS — même contrainte que les modules d'hôte : un
   import de CSS y tire les fontes MathLive, pour lesquelles le harnais des
   scripts de contrôle n'a pas de chargeur.
══════════════════════════════════════════════════════════ */

import { currentHost } from "../../../../src/host/current";
import { currentLang, t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import manifeste from "../../../../src/assets/manifest.json";
import { PRODUCT_NAME } from "../../../../src/branding";
import type { Scanner } from "../../../../src/dashboard/scanner";
import { MAX_DOSSIERS, addFolder, estVaultObsidian, examDates, pickFolder, removeFolder, savedFolders, setExamDate } from "../host/folder";
import { cleModule, libelleModule } from "../review/catalogue";
import type { AiSettingsHost } from "../../../../src/dashboard/ai-settings-host";
import { poserLogoObsidian } from "./marques";
import { monterEtatApropos } from "./mise-a-jour";
import { chargerReprise, reglerReprise } from "./reprise";

export function renderSettings(
	root: HTMLElement,
	deps: {
		scanner: Scanner;
		/** Les réglages IA de l'application — le MÊME objet que la page
		    « Générer » consomme (`main.ts`, `reglagesIa`). Les deux champs de
		    chemin de CLI n'ont aucun autre écran, et son `save` porte déjà le
		    retour arrière sur refus du principal : la garde de la clé `ai` peut
		    REFUSER un chemin (absolu, existant, lançable), et un cache laissé en
		    avance sur le disque afficherait un réglage que rien n'a enregistré. */
		aiSettings: AiSettingsHost;
		onBack(): void;
		onFoldersChanged(): void;
		onExamDatesChanged(): void;
	},
): () => void {
	const contenu = ajouter(root, "div", "qbd-content");

	// En-tête : retour + titre. `t()` AU RENDU, jamais dans une constante.
	const entete = ajouter(contenu, "div", "qbd-quizzes-header");
	const retour = ajouter(entete, "button", "qbd-quizzes-crumb-back");
	retour.type = "button";
	// Clé empruntée : c'est le MÊME bouton retour que la page d'un quiz.
	retour.setAttribute("aria-label", t("dashboard.quiz.back"));
	retour.title = t("dashboard.quiz.back");
	currentHost().ui.setIcon(ajouter(retour, "span", "qbd-quizzes-crumb-icon"), "arrow-left");
	retour.addEventListener("click", () => deps.onBack());
	ajouter(entete, "h2", "qbd-quizzes-title", t("review.settings.title"));

	const section = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(section, "h3", "nq-reglages-titre", t("review.settings.folders"));
	ajouter(section, "p", "nq-reglages-aide", t("review.settings.foldersHint"));
	const liste = ajouter(section, "div", "nq-reglages-liste");
	const actions = ajouter(section, "div", "nq-reglages-actions");

	async function dessiner(): Promise<void> {
		const dossiers = await savedFolders();
		liste.replaceChildren();
		for (const d of dossiers) {
			const ligne = ajouter(liste, "div", "nq-reglages-dossier");
			/* Le LOGO d'Obsidian quand c'en est un : ce que cette image
			   transporte, c'est « ceci est un vault », qu'une icône de dossier
			   ne dirait pas. La détection est asynchrone — d'où l'icône
			   générique posée d'abord, remplacée si besoin. */
			const icone = ajouter(ligne, "span", "nq-reglages-icone");
			currentHost().ui.setIcon(icone, "folder");
			void estVaultObsidian(d.path).then(v => { if (v) { icone.replaceChildren(); poserLogoObsidian(icone); } });
			const texte = ajouter(ligne, "div", "nq-reglages-texte");
			// `textContent` (via `ajouter`) : ces chaînes viennent du disque.
			ajouter(texte, "span", "nq-reglages-nom", d.name);
			ajouter(texte, "span", "nq-reglages-chemin", d.path);
			const retirer = ajouter(ligne, "button", "nq-reglages-retirer");
			retirer.type = "button";
			retirer.title = t("review.settings.removeFolder");
			retirer.setAttribute("aria-label", t("review.settings.removeFolder"));
			currentHost().ui.setIcon(retirer, "x");
			retirer.addEventListener("click", () => {
				void (async () => {
					await removeFolder(d.id);
					deps.onFoldersChanged();
				})();
			});
		}
		ajouter(liste, "p", "nq-reglages-aide", t("review.settings.removeHint"));

		actions.replaceChildren();
		const ajout = ajouter(actions, "button", "qbd-btn--create");
		ajout.type = "button";
		currentHost().ui.setIcon(ajouter(ajout, "span", "qbd-btn-icon"), "folder-plus");
		ajouter(ajout, "span", undefined, t("review.settings.addFolder"));
		/* La limite de la spec §6 est DITE, pas subie : un bouton qui ne fait
		   rien serait pris pour une panne. */
		if (dossiers.length >= MAX_DOSSIERS) {
			ajout.disabled = true;
			ajouter(actions, "p", "nq-reglages-aide", t("review.settings.full", { count: MAX_DOSSIERS }));
		}
		ajout.addEventListener("click", () => {
			void (async () => {
				const choix = await pickFolder();
				// Annulation : ce n'est pas une erreur, c'est la réponse « non ».
				if (!choix) return;
				await addFolder(choix);
				deps.onFoldersChanged();
			})();
		});
	}

	void dessiner();

	/* ── Les dates d'examen ──
	   Section STATIQUE (pas de fonction `dessiner` propre) : la liste des
	   modules ne peut changer qu'en ajoutant/retirant un dossier, ce qui
	   recharge toute l'application (`onFoldersChanged`) — inutile de la
	   recalculer ici. */
	/* Les modules VIENNENT DU CATALOGUE, ils ne se saisissent pas : proposer
	   une matière qui n'a aucun quiz produirait une date sans effet, et
	   l'utilisateur croirait avoir réglé quelque chose. */
	const modules = [...new Set(deps.scanner.getQuizzes().map(q => cleModule(q.path, currentHost().paths)))]
		.sort((a, b) => libelleModule(a).localeCompare(libelleModule(b), currentLang()));

	const exams = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(exams, "h3", "nq-reglages-titre", t("review.settings.exams"));
	ajouter(exams, "p", "nq-reglages-aide", t("review.settings.examsHint"));
	if (!modules.length) {
		ajouter(exams, "p", "nq-reglages-aide", t("review.settings.noModules"));
	}
	for (const module of modules) {
		const ligne = ajouter(exams, "div", "nq-reglages-module");
		const texte = ajouter(ligne, "div", "nq-reglages-texte");
		ajouter(texte, "span", "nq-reglages-nom", libelleModule(module));
		// La RACINE en second : deux dossiers peuvent avoir un module homonyme,
		// et l'utilisateur doit savoir lequel il règle.
		ajouter(texte, "span", "nq-reglages-chemin", module);
		/* `<input type="date">` NATIF, et c'est volontaire : la seule règle du
		   dépôt sur les contrôles est qu'un `<select>` natif est interdit
		   (`ui-select.ts` est le seul dropdown autorisé) — or `ui-select.ts`
		   importe encore Obsidian, donc l'application ne peut pas s'en servir.
		   Un champ de date n'est pas un dropdown, et c'est déjà celui que le
		   modal « Modifier dossier » du greffon emploie (`module-edit.ts`). */
		// Le générique de `ajouter` infère déjà `HTMLInputElement` depuis
		// `"input"` (voir `color-picker.ts`) : un cast ici serait redondant.
		const champ = ajouter(ligne, "input", "nq-reglages-date");
		champ.type = "date";
		// Valeur PERSISTÉE, jamais reformatée pour l'affichage : c'est la même
		// chaîne `AAAA-MM-JJ` que le greffon écrit dans ses réglages.
		champ.value = examDates()[module] ?? "";
		champ.addEventListener("change", () => {
			void (async () => {
				await setExamDate(module, champ.value);
				/* La carte « À réviser » se recalcule au prochain rendu : le
				   plan est DÉRIVÉ, il n'y a rien à invalider. C'est la propriété
				   qui a justifié « journal seul, état dérivé ». */
				deps.onExamDatesChanged();
			})();
		});
	}

	/* ── Général ──
	   L'interrupteur « rouvrir là où on s'était arrêté » : même patron que
	   l'automatique des mises à jour (`nq-maj-auto`, `mise-a-jour.ts`). Décoché
	   par défaut à l'affichage, le temps de la lecture (`chargerReprise`) —
	   corrigé dès qu'elle répond, sans clignoter puisque le réglage par défaut
	   est `true` et que la lecture est quasi instantanée (réglages déjà en
	   mémoire côté principal). */
	const general = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(general, "h3", "nq-reglages-titre", t("app.settings.general"));
	const repriseLigne = ajouter(general, "label", "nq-maj-auto");
	const repriseCase = ajouter(repriseLigne, "input");
	repriseCase.type = "checkbox";
	ajouter(repriseLigne, "span", undefined, t("app.reprise.label"));
	ajouter(general, "p", "nq-reglages-aide", t("app.reprise.hint"));
	repriseCase.addEventListener("change", () => { void reglerReprise(repriseCase.checked); });
	void chargerReprise().then(r => { repriseCase.checked = r.actif; });

	/* ── Les outils IA ──
	   Le dossier est une donnée persistée, donc sa valeur n'est jamais
	   traduite. La perte de focus évite de soumettre un chemin incomplet à la
	   garde du processus principal à chaque caractère. */
	const outilsIa = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(outilsIa, "h3", "nq-reglages-titre", t("settings.ai.tools.title"));
	const dossierLigne = ajouter(outilsIa, "div", "nq-reglages-module");
	const dossierTexte = ajouter(dossierLigne, "div", "nq-reglages-texte");
	ajouter(dossierTexte, "span", "nq-reglages-nom", t("settings.ai.outputFolder.name"));
	ajouter(dossierTexte, "span", "nq-reglages-chemin", t("settings.ai.outputFolder.desc"));
	const dossierChamp = ajouter(dossierLigne, "input", "nq-reglages-chemin-cli");
	dossierChamp.type = "text";
	dossierChamp.value = deps.aiSettings.get().aiOutputFolder ?? "";
	dossierChamp.addEventListener("change", () => {
		void (async () => {
			const voulu = dossierChamp.value.trim();
			try {
				await deps.aiSettings.save({ aiOutputFolder: voulu });
			} catch (e) {
				/* Le principal a déjà affiché la Notice et restauré le cache ; le
				   champ revient lui aussi à la dernière valeur réellement écrite. */
				dossierChamp.value = deps.aiSettings.get().aiOutputFolder ?? "";
			}
		})();
	});

	/* ── Les chemins des CLI d'IA ──

	   POURQUOI CES DEUX CHAMPS EXISTENT. Une application INSTALLÉE démarre avec
	   le `PATH` du SYSTÈME, pas celui du terminal où l'utilisateur a installé
	   son CLI ; et un installateur qui écrit dans le `PATH` du registre
	   n'atteint jamais un processus déjà lancé. Le principal étend déjà ce
	   `PATH` avec les emplacements connus (npm, Codex officiel, `~/.local/bin`)
	   — ces champs sont le DERNIER recours, pour l'installation qui n'est à
	   aucun d'eux. Vides, ils ne font rien : c'est l'état normal.

	   Section STATIQUE (pas de `dessiner`) : rien d'extérieur ne peut changer
	   ces deux valeurs pendant que la page est ouverte.

	   ÉCRITURE À LA PERTE DU FOCUS (`change`), jamais à chaque frappe : le
	   principal GARDE cette clé et REFUSE un chemin incomplet — écrire à chaque
	   caractère ferait donc une Notice de refus par lettre tapée. */
	const cli = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(cli, "h3", "nq-reglages-titre", t("settings.ai.cliPath.title"));
	ajouter(cli, "p", "nq-reglages-aide", t("settings.ai.cliPath.desc"));
	for (const outil of ["cheminClaude", "cheminCodex"] as const) {
		const ligne = ajouter(cli, "div", "nq-reglages-module");
		const texte = ajouter(ligne, "div", "nq-reglages-texte");
		ajouter(texte, "span", "nq-reglages-nom",
			t(outil === "cheminClaude" ? "settings.ai.cliPath.claude" : "settings.ai.cliPath.codex"));
		const champ = ajouter(ligne, "input", "nq-reglages-chemin-cli");
		champ.type = "text";
		champ.placeholder = t("settings.ai.cliPath.placeholder");
		champ.value = deps.aiSettings.get()[outil] ?? "";
		champ.addEventListener("change", () => {
			void (async () => {
				const voulu = champ.value.trim();
				try {
					await deps.aiSettings.save({ [outil]: voulu });
				} catch (e) {
					/* REFUSÉ par le principal : `save` a déjà remis le cache en
					   arrière et affiché la cause. Le champ doit suivre le cache,
					   sinon l'écran montrerait un réglage que le disque n'a pas. */
					champ.value = deps.aiSettings.get()[outil] ?? "";
				}
			})();
		});
	}

	/* ── À propos ──
	   LA VERSION VIENT DU MANIFESTE, importé en JSON et inliné par Vite : une
	   seule source (`src/assets/manifest.json`, cf. CLAUDE.md « Release »),
	   la même que l'installeur lit pour son numéro. Pas `app.getVersion()`
	   par le pont : il lit le `package.json` du paquet, qui porte `0.0.0` en
	   développement — cette ligne dirait alors deux choses selon qu'on est
	   installé ou non. C'est cette ligne qu'on lit pour prouver qu'une mise à
	   jour a remplacé l'ancienne version (épreuves de la tranche 6). */
	const apropos = ajouter(contenu, "section", "nq-reglages-section");
	ajouter(apropos, "h3", "nq-reglages-titre", t("settings.about.title"));
	ajouter(apropos, "p", "nq-reglages-aide",
		t("settings.about.version", { product: PRODUCT_NAME, version: manifeste.version }));
	const depot = ajouter(apropos, "a", "nq-reglages-lien", t("settings.about.repo"));
	depot.href = manifeste.helpUrl;
	// `_blank` : le principal remet toute ouverture `https?:` au navigateur
	// (`setWindowOpenHandler`, `main.ts`) — même geste que les liens de la
	// page « Générer ».
	depot.target = "_blank";
	depot.rel = "noopener";

	// L'état de la mise à jour automatique : la ligne, « Vérifier
	// maintenant », l'interrupteur — voir `mise-a-jour.ts`.
	const demonterMaj = monterEtatApropos(apropos);

	/* Le démontage désabonne désormais la mise à jour. Il est rendu quand
	   même parce que TOUT écran en rend un — `main.ts` appelle
	   `demonterCourant` sans savoir de quel écran il s'agit. */
	return () => { demonterMaj(); root.replaceChildren(); };
}
