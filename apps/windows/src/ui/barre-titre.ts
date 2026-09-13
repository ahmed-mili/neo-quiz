/* ══════════════════════════════════════════════════════════
   LA BARRE DE TITRE — style Neo Calendar

   Tâche 1 a posé `frame: false` : plus de barre native, plus de menu natif
   (`Menu.setApplicationMenu(null)`). Sans ce module la fenêtre n'a ni barre
   ni boutons — c'est lui qui les redessine, entièrement dans le rendu, et
   qui ouvre la cascade du menu d'application (`menu-app.ts`).

   Montée UNE SEULE FOIS au démarrage (`main.ts`), avant le premier écran :
   elle survit aux changements d'écran (coquille, réglages, écran vide),
   contrairement à eux qui se démontent et se remontent.
══════════════════════════════════════════════════════════ */
import { ajouter } from "../../../../src/dom";
import { t } from "../../../../src/i18n";
import { pont } from "../host/pont";
import { poserIcone } from "../host/ui";
import { ouvrirMenuApp } from "./menu-app";
import { CLE_REGLAGES_ZOOM } from "../../electron/pont";
import type { EtatFenetre } from "../../electron/pont";
import manifeste from "../../../../src/assets/manifest.json";

/** Table id de menu → nom de commande d'édition (`pont().edition.commande`) :
    les six ids de `menu-app-arbre.ts` correspondent un à un aux six noms du
    contrat, mais la table reste EXPLICITE plutôt qu'un cast — un septième id
    ajouté un jour sans entrée ici doit rester silencieusement sans effet, pas
    planter le rendu. */
const COMMANDES_EDITION: Record<string, "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll"> = {
	undo: "undo",
	redo: "redo",
	cut: "cut",
	copy: "copy",
	paste: "paste",
	"select-all": "selectAll",
};

/**
 * Construit la barre, l'ajoute en tout premier enfant de `root` (donc AVANT
 * `#neo-quiz-root`, son frère), et la câble au pont. Rend le démontage —
 * jamais appelé en pratique (la barre vit toute la vie de la fenêtre), posé
 * par cohérence avec le reste du code partagé (`abonner` de `mise-a-jour.ts`).
 */
export function monterBarreTitre(root: HTMLElement, deps: {
	ouvrirReglages(): void;
	fondSuivant(): void;
}): () => void {
	const barre = document.createElement("div");
	barre.className = "nq-barre";
	root.prepend(barre);

	const gauche = ajouter(barre, "div", "nq-barre-gauche");
	const boutonMenu = document.createElement("button");
	boutonMenu.type = "button";
	boutonMenu.className = "nq-barre-menu";
	boutonMenu.setAttribute("aria-label", t("app.titlebar.menu"));
	poserIcone(boutonMenu, "chevron-down");
	gauche.appendChild(boutonMenu);

	const glisse = ajouter(barre, "div", "nq-barre-glisse");

	const controles = ajouter(barre, "div", "nq-barre-controles");
	const boutonReduire = document.createElement("button");
	boutonReduire.type = "button";
	boutonReduire.className = "nq-barre-controle";
	boutonReduire.setAttribute("aria-label", t("app.titlebar.minimize"));
	boutonReduire.title = t("app.titlebar.minimize");
	poserIcone(boutonReduire, "minus");
	boutonReduire.dataset.icone = "minus";

	const boutonAgrandir = document.createElement("button");
	boutonAgrandir.type = "button";
	boutonAgrandir.className = "nq-barre-controle";

	const boutonFermer = document.createElement("button");
	boutonFermer.type = "button";
	boutonFermer.className = "nq-barre-controle";
	boutonFermer.setAttribute("aria-label", t("app.titlebar.close"));
	boutonFermer.title = t("app.titlebar.close");
	poserIcone(boutonFermer, "x");
	boutonFermer.dataset.icone = "x";

	controles.append(boutonReduire, boutonAgrandir, boutonFermer);

	/** Icône et libellés du bouton du milieu, selon l'état courant. */
	function poserAgrandirOuRestaurer(agrandie: boolean): void {
		const cle = agrandie ? "app.titlebar.restore" : "app.titlebar.maximize";
		boutonAgrandir.setAttribute("aria-label", t(cle));
		boutonAgrandir.title = t(cle);
		poserIcone(boutonAgrandir, agrandie ? "copy" : "square");
		// La taille du glyphe dépend de l'icône (voir `shell.css`, `data-icone`).
		boutonAgrandir.dataset.icone = agrandie ? "copy" : "square";
	}
	poserAgrandirOuRestaurer(false);

	boutonReduire.addEventListener("click", () => { void pont().fenetre.reduire(); });
	boutonAgrandir.addEventListener("click", () => { void pont().fenetre.agrandirOuRestaurer(); });
	boutonFermer.addEventListener("click", () => { void pont().fenetre.fermer(); });

	function surDoubleClic(e: MouseEvent): void {
		if (e.target instanceof HTMLElement && e.target.closest("button")) return;
		void pont().fenetre.agrandirOuRestaurer();
	}
	glisse.addEventListener("dblclick", surDoubleClic);
	gauche.addEventListener("dblclick", surDoubleClic);

	/* ─── L'ÉTAT DE LA FENÊTRE : même patron que `mise-a-jour.ts`, la garde
	   `pousse` contre la course entre la lecture initiale (`etat()`) et un
	   événement déjà poussé par `surEtat` pendant l'aller-retour. ─── */
	let pousse = false;
	function appliquerEtat(e: EtatFenetre): void {
		barre.dataset.focused = String(e.focus);
		barre.dataset.maximized = String(e.agrandie);
		poserAgrandirOuRestaurer(e.agrandie);
	}
	const desabonnerFenetre = pont().fenetre.surEtat(e => {
		pousse = true;
		appliquerEtat(e);
	});
	void pont().fenetre.etat().then(e => {
		if (!pousse) appliquerEtat(e);
	});

	/* ─── LE ZOOM COURANT : lu une fois au montage, pour que la coche du
	   sous-menu Affichage > Échelle soit juste dès la première ouverture.
	   Le principal l'applique déjà à `did-finish-load` (voir `pont.ts`) ;
	   cette lecture ne sert qu'à la COCHE, pas à appliquer le zoom. ─── */
	let zoomCourant = 1;
	void pont().reglages.lire(CLE_REGLAGES_ZOOM).then(v => {
		if (typeof v === "number") zoomCourant = v;
	});

	let fermerMenu: (() => void) | null = null;
	boutonMenu.addEventListener("click", () => {
		if (fermerMenu) { fermerMenu(); fermerMenu = null; return; }
		fermerMenu = ouvrirMenuApp(boutonMenu, {
			version: manifeste.version,
			zoom: () => zoomCourant,
			executer(id, value) {
				if (id === "check-updates") {
					void pont().miseAJour.verifier();
					deps.ouvrirReglages();
				} else if (id === "settings") {
					deps.ouvrirReglages();
				} else if (id in COMMANDES_EDITION) {
					void pont().edition.commande(COMMANDES_EDITION[id]);
				} else if (id.startsWith("scale-") && typeof value === "number") {
					void pont().affichage.zoom(value);
					zoomCourant = value;
				} else if (id === "next-wallpaper") {
					deps.fondSuivant();
				} else if (id === "reload") {
					void pont().affichage.recharger();
				} else if (id === "fullscreen") {
					void pont().fenetre.pleinEcran();
				} else if (id === "devtools") {
					void pont().affichage.outilsDev();
				}
			},
		});
	});
	// Le menu se ferme lui-même (clic dehors, Échap, action) sans repasser par
	// ce bouton : `fermerMenu` resterait alors une fonction déjà consommée.
	// `ouvrirMenuApp` pose et retire `data-open` sur l'ancre ; on s'en sert
	// pour savoir si un second clic doit fermer ou rouvrir.
	function surFermetureMenu(): void {
		if (!boutonMenu.hasAttribute("data-open")) fermerMenu = null;
	}
	const observateurMenu = new MutationObserver(surFermetureMenu);
	observateurMenu.observe(boutonMenu, { attributes: true, attributeFilter: ["data-open"] });

	/* ─── LES RACCOURCIS SANS MENU NATIF ───
	   `Ctrl+,` et `Ctrl+Shift+B` seulement HORS champ (ce sont des raccourcis
	   d'application, pas d'édition) ; `F11`, `Ctrl+R`, `Ctrl+Alt+I` PARTOUT,
	   comme le ferait un accélérateur de menu natif — ils ne touchent aucun
	   champ. Les raccourcis d'ÉDITION (Ctrl+Z, Ctrl+C…) ne sont PAS interceptés
	   ici : natifs dans les champs, c'est `Édition >` qui les porte pour la
	   souris. */
	function surClavier(e: KeyboardEvent): void {
		const cible = e.target;
		const dansChamp = cible instanceof HTMLElement
			&& (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.isContentEditable);

		if (!dansChamp && e.ctrlKey && !e.shiftKey && !e.altKey && e.key === ",") {
			e.preventDefault();
			deps.ouvrirReglages();
			return;
		}
		if (!dansChamp && e.ctrlKey && e.shiftKey && !e.altKey && e.key.toUpperCase() === "B") {
			e.preventDefault();
			deps.fondSuivant();
			return;
		}
		if (e.key === "F11") {
			e.preventDefault();
			void pont().fenetre.pleinEcran();
		} else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r") {
			e.preventDefault();
			void pont().affichage.recharger();
		} else if (e.ctrlKey && !e.shiftKey && e.altKey && e.key.toLowerCase() === "i") {
			e.preventDefault();
			void pont().affichage.outilsDev();
		}
	}
	document.addEventListener("keydown", surClavier, true);

	return () => {
		desabonnerFenetre();
		observateurMenu.disconnect();
		document.removeEventListener("keydown", surClavier, true);
		fermerMenu?.();
		barre.remove();
	};
}
