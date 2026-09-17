import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import type { QuizIndexEntry } from "./scanner";
import type { ModuleGroup } from "./quiz-modules";
import { moduleIcon } from "./module-icons";
import { poserLogoObsidian } from "./brand-icons";
import { moduleAccent } from "./module-color";

/* ══════════════════════════════════════════════════════════
   MODULE CARD — une carte = un MODULE (dossier de quiz). Design
   « folder card 6a » (handoff claude design validé Ahmed 2026-07-18) :
   halo radial coloré dans l'angle HAUT-GAUCHE (dans le fond), carré
   d'icône + titre colorés de l'accent du dossier, stats, ligne
   séparatrice, bouton ••• en pied ; hover = élévation + lueur colorée.
   L'accent (var --accent, posé inline) vient du modal ou du hash du nom
   (module-color.ts) ; tout le reste se dérive en CSS via color-mix.
   Cliquer entre dans le module.
══════════════════════════════════════════════════════════ */

export function renderModuleCard(
	container: HTMLElement,
	group: ModuleGroup,
	onOpen: (group: ModuleGroup) => void,
	/* onMenu (opt-in) : la carte ne compose plus le menu et ne l'ouvre plus —
	   elle signale un clic sur « ⋯ » et rend son ancre. L'ouverture appartient
	   à l'hôte (ctx.openModuleMenu) : c'est ce qui évite à ce fichier
	   d'importer `ui-select.ts`, donc Obsidian, donc de rendre TOUTE la carte
	   (et tout ce qui la consomme) inutilisable dans la fenêtre de
	   l'application — l'import était inconditionnel là où le menu, lui,
	   était déjà optionnel (tour de correction 1, tâche 6). */
	onMenu?: (group: ModuleGroup, anchor: HTMLElement) => void,
	/* onPickIcon (opt-in) : clic sur la pastille d'icône → change l'icône
	   directement (raccourci, sans ouvrir « Modifier dossier »). L'appelant
	   fournit le comportement (picker + persistance) car la carte n'a pas
	   accès aux settings. */
	onPickIcon?: (group: ModuleGroup, anchor: HTMLElement) => void,
	/* generated (opt-in) : ce dossier est le SAS des quiz générés
	   (`ctx.generatedFolder`). Icône de l'IA à défaut d'une icône choisie, et
	   pas de « maîtrisés » : on n'y progresse pas, on y passe. */
	opts?: { generated?: boolean }
): HTMLDivElement {
	const card = ajouter(container, "div", "qbd-module-card");
	if (opts?.generated) card.classList.add("qbd-module-card--generated");
	// Accent du dossier (couleur choisie, sinon dérivée du nom) → toute la
	// teinte de la carte se dérive de --accent en CSS.
	card.style.setProperty("--accent", moduleAccent(group, { generated: !!opts?.generated }));

	// ── En-tête : pastille d'icône + titre coloré / sous-titre UE ──
	const header = ajouter(card, "div", "qbd-module-card__header");
	const iconBox = ajouter(header, "div", "qbd-module-card__icon");
	currentHost().ui.setIcon(iconBox, moduleIcon(group, { generated: !!opts?.generated }));
	if (onPickIcon) {
		// La pastille devient un raccourci « changer l'icône » ; le clic ne doit
		// PAS aussi entrer dans le module.
		// Pas de `title` : Obsidian en ferait une infobulle native flottante
		// parasite (cf. plugin-dev §0 bis) ; le highlight au survol suffit d'indice.
		iconBox.classList.add("qbd-module-card__icon--editable");
		iconBox.addEventListener("click", (e) => {
			e.stopPropagation();
			onPickIcon(group, iconBox);
		});
	}
	const titles = ajouter(header, "div", "qbd-module-card__titles");
	// Titre = nom du module. Fallback : un quiz sans ancêtre reconnu donne un
	// nom vide (moduleForQuiz) — jamais de titre blanc.
	ajouter(titles, "div", "qbd-module-card__title", group.name || t("dashboard.quizzes.noFolder"));
	// Sous-titre = UE, omis si non résolu (l'en-tête garde son alignement haut).
	if (group.ue) ajouter(titles, "div", "qbd-module-card__subtitle", group.ue);

	// ── Stats : « N quiz • N maîtrisés » (nombres en gras, séparateur discret) ──
	const stats = ajouter(card, "div", "qbd-module-card__stats");
	const addStat = (n: number, key: "dashboard.quizzes.moduleQuizzesOne" | "dashboard.quizzes.moduleQuizzesOther" | "dashboard.quizzes.folderMasteredOne" | "dashboard.quizzes.folderMasteredOther") => {
		const span = ajouter(stats, "span");
		ajouter(span, "strong", undefined, String(n));
		// La clé produit « {count} quizzes » : on retire le chiffre de tête (déjà
		// en gras) — seul le libellé traduit reste. `appendText` (Obsidian) devient
		// `Element.append` (DOM standard) : une chaîne y est déjà posée comme
		// nœud TEXTE, jamais interprétée comme du HTML — même garantie.
		span.append(" " + t(key, { count: n }).replace(/^\s*\d+\s*/, ""));
	};
	addStat(group.total, group.total === 1 ? "dashboard.quizzes.moduleQuizzesOne" : "dashboard.quizzes.moduleQuizzesOther");
	if (!opts?.generated) {
		ajouter(stats, "span", "sep", "•");
		addStat(group.mastered, group.mastered === 1 ? "dashboard.quizzes.folderMasteredOne" : "dashboard.quizzes.folderMasteredOther");
	}

	// ── Spacer + ligne séparatrice + pied (bouton ••• = menu existant) ──
	ajouter(card, "div", "qbd-module-card__spacer");
	ajouter(card, "div", "qbd-module-card__divider");
	const footer = ajouter(card, "div", "qbd-module-card__footer");
	/* LE CHEMIN, ENTIER (Ahmed, 2026-09-17). Plus de milieu réduit : la carte
	   le montre en entier dans une piste de largeur bornée, qui DÉFILE de
	   droite à gauche en boucle quand il déborde, et qu'un clic rend libre
	   pour le parcourir à la main.
	   LA BOUCLE EST SANS COUTURE PARCE QUE LE TEXTE EST EN DEUX EXEMPLAIRES :
	   le rail glisse de la largeur d'un exemplaire, et à l'instant où il
	   revient à zéro le second occupe exactement la place que le premier
	   vient de quitter. Un exemplaire unique qui repart de la droite montre
	   une piste vide à chaque tour — c'est le saut qu'on voit dans les
	   marquees bâclés. L'écart entre les deux est un `padding` PORTÉ PAR
	   CHAQUE exemplaire, et non un `gap` du rail : le `gap` ne compte qu'une
	   fois entre les deux, la boucle se décalerait de la moitié à chaque tour.
	   La mesure est faite au rendu (`scrollWidth` contre `clientWidth`) : le
	   CSS seul ne sait pas de combien un texte déborde, et sans elle les
	   chemins courts défileraient aussi, pour rien.
	   La VITESSE est constante (30 px par seconde), pas la durée : à durée
	   fixe, « Personal/Cours » filerait pendant que le chemin d'un module
	   d'école ramperait. */
	const racine = group.path ? currentHost().paths.rootOf(group.path) : null;
	if (group.path && racine) {
		const chemin = ajouter(footer, "div", "qbd-module-card__path");
		/* La pastille du vault, AVANT la piste et hors d'elle : elle dit d'où
		   vient le dossier, elle ne fait pas partie du chemin — la voir
		   défiler puis disparaître serait perdre l'information au moment où
		   on lit le chemin. */
		if (racine.vault) {
			const marque = ajouter(chemin, "span", "qbd-module-card__path-vault");
			poserLogoObsidian(marque, t("dashboard.quizzes.obsidianVault"));
		}
		const piste = ajouter(chemin, "div", "qbd-module-card__path-piste");
		const rail = ajouter(piste, "div", "qbd-module-card__path-rail");
		const libelle = `${racine.name}/${currentHost().paths.localPath(group.path)}`;
		const texte = ajouter(rail, "span", "qbd-module-card__path-texte", libelle);
		/* Un clic LIBÈRE la piste : le second exemplaire s'en va — il ferait
		   lire le chemin deux fois à qui le parcourt à la main —, l'animation
		   s'arrête et le défilement natif prend la main. `stopPropagation`
		   parce que le reste de la carte ouvre le dossier, et lire un chemin
		   n'est pas l'ouvrir. */
		piste.addEventListener("click", (e) => {
			e.stopPropagation();
			rail.querySelector(".qbd-module-card__path-texte--echo")?.remove();
			piste.classList.add("is-libre");
		});
		/* Après la peinture : dans la même image, `scrollWidth` vaut encore
		   `clientWidth` et aucune carte ne défilerait jamais.
		   L'ÉCART VAUT LA LARGEUR DE LA PISTE, et non un nombre fixe : c'est
		   la seule valeur qui garantisse qu'on ne voie jamais les deux
		   exemplaires à la fois. Avec 72 px et une carte élargie — un zoom,
		   une fenêtre agrandie —, la fin du chemin et sa reprise tenaient
		   ensemble à l'écran, séparées par un trou : on lisait « …Python
		   Efrei/Bachelor… » comme une seule ligne (Ahmed, 2026-09-17).
		   Recalibré à chaque changement de largeur : le zoom de l'interface ne
		   redessine pas les cartes, et l'écart serait resté celui d'avant. */
		const calibrer = (): void => {
			piste.classList.remove("is-defilant");
			piste.style.removeProperty("--nq-ecart");
			if (piste.scrollWidth - piste.clientWidth <= 2) {
				rail.querySelector(".qbd-module-card__path-texte--echo")?.remove();
				return;
			}
			piste.style.setProperty("--nq-ecart", `${Math.round(piste.clientWidth)}px`);
			if (!rail.querySelector(".qbd-module-card__path-texte--echo")) {
				const echo = ajouter(rail, "span", "qbd-module-card__path-texte qbd-module-card__path-texte--echo", libelle);
				/* L'écho est un doublon VISUEL : une aide technique qui le lirait
				   annoncerait le chemin deux fois de suite. */
				echo.setAttribute("aria-hidden", "true");
			}
			const pas = texte.getBoundingClientRect().width;
			piste.style.setProperty("--nq-duree", `${Math.max(6, Math.round(pas / 30))}s`);
			piste.classList.add("is-defilant");
		};
		requestAnimationFrame(calibrer);
		/* L'observateur se DÉBRANCHE dès que la piste quitte le document : une
		   grille se redessine à chaque navigation, et autant d'observateurs
		   restés derrière retiendraient autant de cartes mortes. */
		const observateur = new ResizeObserver(() => {
			if (!piste.isConnected) { observateur.disconnect(); return; }
			if (!piste.classList.contains("is-libre")) calibrer();
		});
		observateur.observe(piste);
	}
	if (onMenu) {
		const moreBtn = ajouter(footer, "button", "qbd-card-more qbd-module-card__menu");
		moreBtn.type = "button";
		moreBtn.title = t("dashboard.card.more");
		currentHost().ui.setIcon(moreBtn, "ellipsis");
		moreBtn.addEventListener("click", (e) => {
			// Ouvrir le menu ne doit PAS aussi entrer dans le module.
			e.stopPropagation();
			onMenu(group, moreBtn);
		});
	}

	card.addEventListener("click", () => onOpen(group));
	return card;
}

// Réexport pour lisibilité côté appelant.
export type { QuizIndexEntry };
