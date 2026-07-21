import { setIcon, type App } from "obsidian";
import { t } from "../i18n";
import type { TransKey } from "../i18n";
import type { DashboardCtx, DashboardViewName } from "../types/dashboard-ctx";

/* ══════════════════════════════════════════════════════════
   NAVIGATION SIDEBAR — Dashboard
   Sidebar avec brand et nav items stylisés.
══════════════════════════════════════════════════════════ */

/* NAV_ITEMS porte une CLÉ de traduction, pas un libellé : la liste est
   construite une seule fois (à l'ouverture de la vue), alors que le libellé
   doit suivre la langue courante à CHAQUE rendu — un `label: string` figé ici
   resterait dans la langue du démarrage après un changement de réglage. */
interface NavItem {
	key: Exclude<DashboardViewName, "detail">;
	labelKey: TransKey;
	icon: string;
}

export interface NavHandlers {
	render(container: HTMLElement): void;
	setActive(key: DashboardViewName): void;
}

export function createNavHandlers(ctx: DashboardCtx): NavHandlers {
	let activeNav: DashboardViewName = "home";
	/* Boutons du rendu COURANT. setActive bascule la classe active sur ces
	   nœuds VIVANTS au lieu de laisser la vue reconstruire le rail : sans ça
	   le bouton cliqué est un élément neuf, né déjà actif — la transition
	   fond/couleur du CSS n'a aucun état de départ à interpoler et la carte
	   claire apparaît d'un coup. */
	let buttons: { key: DashboardViewName; el: HTMLElement }[] = [];

	function paintActive(): void {
		for (const b of buttons) b.el.toggleClass("qbd-nav-item--active", b.key === activeNav);
	}

	const NAV_ITEMS: NavItem[] = [
		{ key: "home", labelKey: "dashboard.nav.home", icon: "home" },
		// Même icône « library » que le titre de la page Mes quiz (quizzes.ts) :
		// le rail et la page désignent la même chose (demande Ahmed 2026-07-20).
		{ key: "quizzes", labelKey: "dashboard.nav.quizzes", icon: "library" },
		{ key: "ai", labelKey: "dashboard.nav.generate", icon: "sparkles" }
	];

	function render(container: HTMLElement): void {
		container.empty();

		// Brand : logo NU centré, sans libellé ni séparateur (rail iconique
		// façon StudySmarter — le nom du plugin est déjà dans l'onglet).
		const brand = container.createDiv({ cls: "qbd-nav-brand" });
		const brandIcon = brand.createSpan({ cls: "qbd-nav-brand-icon" });
		setIcon(brandIcon, "graduation-cap");

		// Nav items
		const navList = container.createDiv({ cls: "qbd-nav-items" });
		buttons = [];

		for (const item of NAV_ITEMS) {
			const btn = navList.createEl("button", {
				cls: `qbd-nav-item ${activeNav === item.key ? "qbd-nav-item--active" : ""}`
			});
			buttons.push({ key: item.key, el: btn });

			const iconWrap = btn.createSpan({ cls: "qbd-nav-icon" });
			setIcon(iconWrap, item.icon);

			btn.createSpan({ cls: "qbd-nav-label", text: t(item.labelKey) });

			btn.addEventListener("click", () => {
				activeNav = item.key;
				paintActive();
				ctx.navigate(item.key);
			});
		}

		// Réglages : en PIED de rail (pattern StudySmarter), hors de la liste
		// de navigation — ouvre l'onglet du plugin dans les réglages Obsidian
		// (même API interne que openPluginSettings de dashboard/ai.ts).
		const footer = container.createDiv({ cls: "qbd-nav-footer" });
		const settingsBtn = footer.createEl("button", { cls: "qbd-nav-item" });
		const settingsIcon = settingsBtn.createSpan({ cls: "qbd-nav-icon" });
		setIcon(settingsIcon, "settings");
		settingsBtn.createSpan({ cls: "qbd-nav-label", text: t("dashboard.nav.settings") });
		settingsBtn.addEventListener("click", () => {
			const setting = (ctx.app as App & { setting: { open(): void; openTabById(id: string): void } }).setting;
			setting.open();
			setting.openTabById(ctx.plugin.manifest.id);
		});
	}

	function setActive(key: DashboardViewName): void {
		activeNav = key;
		// Navigation qui ne vient PAS d'un clic du rail (historique souris,
		// ouverture d'un détail, retour) : le rail doit suivre, en animant.
		paintActive();
	}

	return { render, setActive };
}
