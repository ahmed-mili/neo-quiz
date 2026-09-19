import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { t } from "../i18n";
import { createEffortTrackFx } from "./effort-canvas";
import type { EffortTrackFx } from "./effort-canvas";

/* ══════════════════════════════════════════════════════════
   UI SELECT — Dropdown custom réutilisable
   Remplace les <select> natifs (popup OS non thémable).
   Trigger bouton au look champ + menu portalé à document.body
   (position fixed), fermeture clic-dehors / Escape / scroll.
══════════════════════════════════════════════════════════ */

/** Fonction de fermeture d'un menu/popover portalé (identité dans openMenus). */
type CloseFn = () => void;

const openMenus = new Map<CloseFn, HTMLElement | null>();

/* Ferme tous les menus ouverts (appelé à chaque re-render). */
export function closeAllSelects(): void {
	for (const close of Array.from(openMenus.keys())) close();
}

/** Toggle : si un menu/popover portalé est DÉJÀ ouvert pour cette ancre (le
    bouton déclencheur), le ferme et renvoie true — l'appelant s'abstient alors
    de rouvrir. Un reclic sur le même bouton referme donc, au lieu de fermer puis
    rouvrir. L'ancre reste exemptée du dismiss clic-dehors (onDocDown), sinon le
    mousedown fermerait avant que ce toggle ne s'exécute. */
function toggleCloseForAnchor(anchorEl: HTMLElement): boolean {
	let closed = false;
	for (const [close, anchor] of Array.from(openMenus.entries())) {
		if (anchor === anchorEl) { close(); closed = true; }
	}
	return closed;
}

/** Poignée commune de tous les menus/popovers portalés ci-dessous. */
export interface MenuHandle {
	close(): void;
}

/* ── createSelect ─────────────────────────────────────────── */

/** Option minimale d'un createSelect. Les appelants peuvent en attacher
 *  d'autres champs (ex. `logo`, `sub`) lus par leurs propres
 *  renderTrigger/renderOption — d'où la généricité `T`. */
export interface SelectOption {
	value: string;
	label: string;
	hint?: string;
	/** Visible, mais pas sélectionnable : un clic appelle `onDisabledClick` (le fournisseur absent ouvre son modal d'installation). */
	disabled?: boolean;
}

export interface SelectOptions<T extends SelectOption = SelectOption> {
	value?: string;
	options?: T[];
	onChange?: (value: string) => void;
	/** Appelé à chaque ouverture du menu (rafraîchissements async). */
	onOpen?: () => void;
	/** Le clic sur une option `disabled` — le menu se ferme d'abord. */
	onDisabledClick?: (value: string) => void;
	disabled?: boolean;
	placeholder?: string;
	renderTrigger?: (labelEl: HTMLElement, current: T | null) => void;
	renderOption?: (optBtn: HTMLElement, option: T) => void;
}

export interface SelectHandle<T extends SelectOption = SelectOption> {
	el: HTMLButtonElement;
	setValue(v: string): void;
	setOptions(next: T[] | undefined, nextValue?: string): void;
	setDisabled(d: boolean): void;
	/** Redessine les options du menu s'il est ouvert (les données lues par
	 *  renderOption ont pu changer entre-temps). */
	refreshMenu(): void;
}

/*
 * createSelect(parent, {
 *   value, options: [{ value, label, hint? }],
 *   onChange(value), onOpen?, disabled?, placeholder?
 * }) → { el, setValue, setOptions, setDisabled, refreshMenu }
 * onOpen : appelé à chaque ouverture du menu (rafraîchissements async) ;
 * refreshMenu : redessine les options du menu s'il est ouvert (les données
 * lues par renderOption ont pu changer entre-temps).
 */
export function createSelect<T extends SelectOption = SelectOption>(parent: HTMLElement, opts: SelectOptions<T>): SelectHandle<T> {
	let options: T[] = opts.options || [];
	let value = opts.value;
	let disabled = !!opts.disabled;
	const placeholder = opts.placeholder || t("dashboard.select.placeholder");

	const trigger = ajouter(parent, "button", "qbd-select");
	trigger.type = "button";
	const labelEl = ajouter(trigger, "span", "qbd-select-label");
	const chevron = ajouter(trigger, "span", "qbd-select-chevron");
	currentHost().ui.setIcon(chevron, "chevron-down");

	let menuEl: HTMLDivElement | null = null;

	function currentOption(): T | undefined {
		return options.find(o => o.value === value);
	}

	function refreshLabel(): void {
		const cur = currentOption();
		if (opts.renderTrigger) {
			labelEl.replaceChildren();
			opts.renderTrigger(labelEl, cur || null);
		} else {
			labelEl.textContent = cur ? cur.label : (value || placeholder);
		}
		labelEl.classList.toggle("qbd-select-label--empty", !cur && !value);
		trigger.disabled = disabled;
		trigger.classList.toggle("qbd-select--disabled", disabled);
	}

	function closeMenu(): void {
		if (!menuEl) return;
		menuEl.remove();
		menuEl = null;
		trigger.setAttribute("aria-expanded", "false");
		openMenus.delete(closeMenu);
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", closeMenu);
	}

	function onDocDown(e: MouseEvent): void {
		const t = e.target as Node | null;
		if ((t && trigger.contains(t)) || (menuEl && t && menuEl.contains(t))) return;
		closeMenu();
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Escape") closeMenu();
	}

	function onScroll(e: Event): void {
		const t = e.target as Node | null;
		if (menuEl && t && menuEl.contains(t)) return;
		closeMenu();
	}

	/* (Re)construit les options du menu ouvert. Séparé d'openMenu pour que
	   refreshMenu puisse redessiner en place quand un statut async arrive
	   pendant que le menu est ouvert (ex. version d'un CLI re-détectée). */
	function renderMenuOptions(): void {
		if (!menuEl) return;
		menuEl.replaceChildren();
		for (const o of options) {
			const optBtn = ajouter(menuEl, "button", "qbd-select-option" + (o.value === value && !o.disabled ? " is-active" : ""));
			optBtn.type = "button";
			optBtn.setAttribute("role", "option");
			optBtn.setAttribute("aria-selected", o.value === value && !o.disabled ? "true" : "false");
			if (o.disabled) optBtn.setAttribute("aria-disabled", "true");
			const check = ajouter(optBtn, "span", "qbd-select-check");
			if (o.value === value && !o.disabled) currentHost().ui.setIcon(check, "check");
			if (opts.renderOption) {
				opts.renderOption(optBtn, o);
			} else {
				ajouter(optBtn, "span", "qbd-select-option-label", o.label);
				if (o.hint) ajouter(optBtn, "span", "qbd-select-option-hint", o.hint);
			}
			optBtn.addEventListener("click", () => {
				/* Une option désactivée n'est pas grisée (le sous-titre et la
				   pastille disent déjà l'état) mais ne prend JAMAIS la coche : le
				   menu se ferme et l'appelant décide quoi montrer. */
				if (o.disabled) {
					closeMenu();
					opts.onDisabledClick?.(o.value);
					return;
				}
				const changed = o.value !== value;
				value = o.value;
				refreshLabel();
				closeMenu();
				if (changed && opts.onChange) opts.onChange(o.value);
			});
		}
	}

	function openMenu(): void {
		if (disabled || options.length === 0 || !trigger.isConnected) return;
		closeAllSelects();
		if (opts.onOpen) opts.onOpen();

		const rect = trigger.getBoundingClientRect();
		menuEl = ajouter(document.body, "div", "qbd-select-menu");
		menuEl.setAttribute("role", "listbox");
		// Hauteur max bornée par la place du meilleur côté. Un select bas
		// sur écran mobile a peu de place en dessous → on ouvrira vers le
		// haut (openUp) plutôt que de déborder sous le pli (le menu est
		// position:fixed, la partie hors écran serait inatteignable).
		const spaceBelow = window.innerHeight - rect.bottom - 8;
		const spaceAbove = rect.top - 8;
		const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
		const maxH = Math.max(Math.min(openUp ? spaceAbove : spaceBelow, 320), 120);
		// +1 : le menu est COLLÉ au trigger (annotation StudySmarter 2026-07-18,
		// gap mesuré ~0-1px), pas détaché de 4px.
		menuEl.style.top = rect.bottom + 1 + "px";
		menuEl.style.left = rect.left + "px";
		menuEl.style.minWidth = rect.width + "px";
		menuEl.style.maxHeight = maxH + "px";

		renderMenuOptions();

		// Positionnement vertical définitif : au-dessus si le bas manque
		// de place (openUp), sinon en dessous (défaut déjà posé).
		const menuRect = menuEl.getBoundingClientRect();
		if (openUp) {
			menuEl.style.top = Math.max(8, rect.top - 1 - menuRect.height) + "px";
		}
		// Si le menu déborde à droite du viewport, le rabattre
		if (menuRect.right > window.innerWidth - 8) {
			menuEl.style.left = Math.max(8, window.innerWidth - 8 - menuRect.width) + "px";
		}

		trigger.setAttribute("aria-expanded", "true");
		openMenus.set(closeMenu, trigger);
		document.addEventListener("mousedown", onDocDown, true);
		document.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", closeMenu);
	}

	trigger.addEventListener("click", () => {
		if (menuEl) closeMenu();
		else openMenu();
	});

	refreshLabel();

	return {
		el: trigger,
		setValue(v: string) { value = v; refreshLabel(); },
		setOptions(next: T[] | undefined, nextValue?: string) {
			options = next || [];
			if (nextValue !== undefined) value = nextValue;
			refreshLabel();
		},
		setDisabled(d: boolean) { disabled = !!d; refreshLabel(); },
		refreshMenu: renderMenuOptions
	};
}

/* ── openActionMenu ───────────────────────────────────────── */

export interface ActionMenuItem {
	icon?: string;
	label: string;
	/** 2 lignes (compat) — plus utilisé par les appelants actuels. */
	sub?: string;
	hint?: string;
	disabled?: boolean;
	/** Rangée destructrice, teintée rouge (façon « Delete Study Set » de
	    StudySmarter) — à placer en dernier dans le menu. */
	danger?: boolean;
	onClick?: () => void;
}

/*
 * openActionMenu(anchorEl, items) — menu flottant d'actions
 * (même surface visuelle que le dropdown). items :
 * [{ icon, label, sub?, disabled?, onClick }]
 */
export function openActionMenu(anchorEl: HTMLElement, items: ActionMenuItem[]): MenuHandle {
	if (toggleCloseForAnchor(anchorEl)) return { close() {} };
	closeAllSelects();

	const rect = anchorEl.getBoundingClientRect();
	const menuEl = ajouter(document.body, "div", "qbd-select-menu qbd-action-menu");
	menuEl.setAttribute("role", "menu");

	for (const item of items) {
		const btn = ajouter(menuEl, "button", "qbd-select-option"
			+ (item.disabled ? " qbd-select-option--disabled" : "")
			+ (item.danger ? " qbd-select-option--danger" : ""));
		btn.type = "button";
		btn.setAttribute("role", "menuitem");
		if (item.disabled) btn.disabled = true;
		const iconEl = ajouter(btn, "span", "qbd-select-check qbd-action-menu-icon");
		if (item.icon) currentHost().ui.setIcon(iconEl, item.icon);
		// Ligne simple façon claude.ai (icône + label + accessoire à droite).
		// `sub` reste supporté (2 lignes) pour compat, mais n'est plus utilisé ici.
		if (item.sub) {
			const body = ajouter(btn, "div", "qbd-action-menu-body");
			ajouter(body, "span", "qbd-select-option-label", item.label);
			ajouter(body, "span", "qbd-action-menu-sub", item.sub);
		} else {
			ajouter(btn, "span", "qbd-select-option-label", item.label);
		}
		if (item.hint) ajouter(btn, "span", "qbd-action-menu-hint", item.hint);
		btn.addEventListener("click", () => {
			closeMenu();
			if (!item.disabled && item.onClick) item.onClick();
		});
	}

	// Position : au-dessus ou en dessous de l'ancre selon la place
	menuEl.style.left = rect.left + "px";
	menuEl.style.visibility = "hidden";
	menuEl.style.top = "0px";
	const menuRect = menuEl.getBoundingClientRect();
	const below = rect.bottom + 4;
	const above = rect.top - 4 - menuRect.height;
	menuEl.style.top = (below + menuRect.height <= window.innerHeight - 8 || above < 8 ? below : above) + "px";
	if (menuRect.width + rect.left > window.innerWidth - 8) {
		menuEl.style.left = Math.max(8, window.innerWidth - 8 - menuRect.width) + "px";
	}
	menuEl.style.visibility = "";

	function closeMenu(): void {
		menuEl.remove();
		openMenus.delete(closeMenu);
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", closeMenu);
	}

	function onDocDown(e: MouseEvent): void {
		const t = e.target as Node | null;
		if ((t && anchorEl.contains(t)) || (t && menuEl.contains(t))) return;
		closeMenu();
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Escape") closeMenu();
	}

	function onScroll(e: Event): void {
		const t = e.target as Node | null;
		if (t && menuEl.contains(t)) return;
		closeMenu();
	}

	openMenus.set(closeMenu, anchorEl);
	document.addEventListener("mousedown", onDocDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", closeMenu);

	return { close: closeMenu };
}

/* ── openModelMenu ────────────────────────────────────────── */

export interface EffortOption {
	value: string;
	label: string;
	sub?: string;
	isDefault?: boolean;
	/** Niveau accent (ultracode/ultra) — carte violette. */
	accent?: boolean;
}

export interface ModelOption {
	value: string;
	label: string;
	desc?: string;
	badge?: string;
	/** Icône Lucide calée à droite (Ollama : cloud / download / rien). */
	icon?: string | null;
	/** Un lien à droite de la ligne (« Mettre à niveau » d'un modèle Ollama
	    hors plan) : il s'active sans fermer le menu ni choisir le modèle. */
	upgrade?: { label: string; onClick(): void };
}

export interface OpenModelMenuOptions {
	models: ModelOption[];
	/** Mutable : réassigné en interne au clic (cf. appendModelOption). */
	currentModel: string;
	efforts?: EffortOption[];
	/** Mutable : réassigné en interne au clic dans le flyout Effort. */
	currentEffort?: string;
	moreModels?: ModelOption[];
	/** Liste scrollable + champ "Find model…" (façon app Ollama). */
	searchable?: boolean;
	onPickModel?: (value: string) => void;
	onPickEffort?: (value: string) => void;
	onMore?: () => void;
}

/*
 * openModelMenu(anchorEl, {
 *   models: [{ value, label, desc?, badge? }],
 *   currentModel,
 *   efforts: [{ value, label }],
 *   currentEffort,
 *   onPickModel(value), onPickEffort(value), onMore?()
 * }) — dropdown modèle + effort façon claude.ai : liste des modèles
 * (label + description + badge), séparateur, ligne « Effort » qui
 * ouvre un drill-in dans le même menu, puis « Plus de modèles ».
 */
export function openModelMenu(anchorEl: HTMLElement, opts: OpenModelMenuOptions): MenuHandle {
	if (toggleCloseForAnchor(anchorEl)) return { close() {} };
	closeAllSelects();

	const menuEl = ajouter(document.body, "div", "qbd-select-menu qbd-model-menu");
	menuEl.setAttribute("role", "menu");
	let effortFlyout: HTMLDivElement | null = null;
	let effortCloseTimer = 0;
	let moreFlyout: HTMLDivElement | null = null;
	let moreCloseTimer = 0;

	function effortLabelOf(v: string | undefined): string {
		const efs = opts.efforts || [];
		const e = efs.find(x => x.value === v);
		return e ? e.label : (efs[0] ? efs[0].label : "");
	}

	function reposition(): void {
		const rect = anchorEl.getBoundingClientRect();
		menuEl.style.left = rect.left + "px";
		menuEl.style.visibility = "hidden";
		menuEl.style.top = "0px";
		const menuRect = menuEl.getBoundingClientRect();
		const below = rect.bottom + 4;
		const above = rect.top - 4 - menuRect.height;
		menuEl.style.top = (below + menuRect.height <= window.innerHeight - 8 || above < 8 ? below : above) + "px";
		let left = rect.left;
		if (menuRect.width + left > window.innerWidth - 8) {
			left = Math.max(8, window.innerWidth - 8 - menuRect.width);
		}
		menuEl.style.left = left + "px";
		menuEl.style.visibility = "";
	}

	// Construit un bouton d'option modèle (liste principale ET flyout « Plus de
	// modèles »). Ferme le menu et notifie onPickModel au clic.
	function appendModelOption(parent: HTMLElement, m: ModelOption): HTMLButtonElement {
		const active = m.value === opts.currentModel;
		const btn = ajouter(parent, "button", "qbd-select-option" + (active ? " is-active" : ""));
		btn.type = "button";
		btn.setAttribute("role", "menuitemradio");
		btn.setAttribute("aria-checked", active ? "true" : "false");
		const body = ajouter(btn, "div", "qbd-model-option-body");
		const top = ajouter(body, "div", "qbd-model-option-top");
		ajouter(top, "span", "qbd-select-option-label", m.label);
		if (m.badge) ajouter(top, "span", "qbd-model-option-badge", m.badge);
		if (m.desc) ajouter(body, "span", "qbd-model-option-desc", m.desc);
		if (m.upgrade) {
			/* Un modèle HORS PLAN ne se choisit pas (Ahmed, 2026-09-19) : toute la
			   ligne mène à la page des prix, et « Mettre à niveau » n'est qu'un
			   texte qui le dit — plus un lien à part, plus de soulignement. Le
			   modèle courant n'y perd rien : rien n'est écrit dans les réglages. */
			btn.classList.add("qbd-select-option--upgrade");
			ajouter(btn, "span", "qbd-model-option-upgrade", m.upgrade.label);
		}
		// Icône à droite (Ollama : nuage = cloud, téléchargement = local non
		// installé, rien = local installé), calée à droite comme l'app Ollama.
		if (m.icon) {
			const ic = ajouter(btn, "span", "qbd-model-option-icon");
			currentHost().ui.setIcon(ic, m.icon);
		}
		/* Dans le menu Ollama (`searchable`), pas de coche : c'est l'icône
		   nuage qui passe en bleu sur le modèle courant (Ahmed, 2026-09-19) —
		   la coche à côté du nuage faisait deux glyphes pour un seul état. */
		if (!(opts.searchable && m.icon)) {
			const check = ajouter(btn, "span", "qbd-select-check");
			if (active) currentHost().ui.setIcon(check, "check");
		}
		btn.addEventListener("click", () => {
			closeMenu();
			if (m.upgrade) { m.upgrade.onClick(); return; }
			const changed = m.value !== opts.currentModel;
			opts.currentModel = m.value;
			if (changed && opts.onPickModel) opts.onPickModel(m.value);
		});
		return btn;
	}

	function renderMain(): void {
		menuEl.replaceChildren();

		// Recherche « Find model… » + liste scrollable (façon app Ollama) quand
		// opts.searchable : la liste défile en interne (hauteur ~7 lignes),
		// l'effort reste fixe en dessous. Sinon, liste plate directe.
		if (opts.searchable) {
			menuEl.classList.add("qbd-model-menu--searchable");
			const searchWrap = ajouter(menuEl, "div", "qbd-model-menu-search");
			const searchInput = ajouter(searchWrap, "input", "qbd-model-menu-search-input");
			searchInput.type = "text";
			// L'anglais reprend la formule exacte de l'app Ollama (référence).
			searchInput.placeholder = t("dashboard.select.findModel");
			searchInput.spellcheck = false;
			const listEl = ajouter(menuEl, "div", "qbd-model-menu-list");
			const paint = (filter: string) => {
				listEl.replaceChildren();
				const f = (filter || "").trim().toLowerCase();
				const shown = opts.models.filter(m => !f
					|| (m.label || "").toLowerCase().includes(f)
					|| (m.value || "").toLowerCase().includes(f));
				if (!shown.length) ajouter(listEl, "div", "qbd-model-menu-empty", t("dashboard.select.noModel"));
				else for (const m of shown) appendModelOption(listEl, m);
			};
			paint("");
			searchInput.addEventListener("input", () => paint(searchInput.value));
			searchInput.addEventListener("keydown", (e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					if (searchInput.value) { searchInput.value = ""; paint(""); }
					else closeMenu();
				}
			});
			setTimeout(() => searchInput.focus(), 0);
		} else {
			for (const m of opts.models) appendModelOption(menuEl, m);
		}

		// Ligne « Effort » : seulement si le modèle expose des niveaux (Ollama
		// masque la ligne pour un modèle sans capability « thinking »). Au
		// survol, ouvre un flyout latéral à droite (façon claude.ai), sans clic.
		if (opts.efforts && opts.efforts.length) {
			ajouter(menuEl, "div", "qbd-model-menu-sep");

			const effortRow = ajouter(menuEl, "button", "qbd-select-option qbd-model-menu-row qbd-effort-row");
			effortRow.type = "button";
			effortRow.setAttribute("role", "menuitem");
			ajouter(effortRow, "span", "qbd-select-check");
			ajouter(effortRow, "span", "qbd-select-option-label", t("dashboard.select.effort"));
			ajouter(effortRow, "span", "qbd-model-menu-row-value", effortLabelOf(opts.currentEffort));
			const effortChev = ajouter(effortRow, "span", "qbd-model-menu-row-chevron");
			currentHost().ui.setIcon(effortChev, "chevron-right");

			effortRow.addEventListener("mouseenter", () => { cancelMoreClose(); closeMoreFlyout(); cancelEffortClose(); openEffortFlyout(effortRow); });
			effortRow.addEventListener("mouseleave", scheduleEffortClose);
		}

		// Ligne « Plus de modèles » : flyout latéral avec le reste des modèles
		// (façon claude.ai). Rendue seulement si opts.moreModels est non vide.
		if (opts.moreModels && opts.moreModels.length) {
			const moreRow = ajouter(menuEl, "button", "qbd-select-option qbd-model-menu-row qbd-more-row");
			moreRow.type = "button";
			moreRow.setAttribute("role", "menuitem");
			ajouter(moreRow, "span", "qbd-select-check");
			ajouter(moreRow, "span", "qbd-select-option-label", t("dashboard.select.moreModels"));
			const moreChev = ajouter(moreRow, "span", "qbd-model-menu-row-chevron");
			currentHost().ui.setIcon(moreChev, "chevron-right");

			moreRow.addEventListener("mouseenter", () => { cancelEffortClose(); closeEffortFlyout(); cancelMoreClose(); openMoreFlyout(moreRow); });
			moreRow.addEventListener("mouseleave", scheduleMoreClose);
		}
	}

	// ── Flyout latéral d'effort (façon claude.ai) ──
	// Ouvert au survol de la ligne « Effort », portalé au <body> (le menu a
	// overflow → un enfant absolu serait rogné). Délai de fermeture court =
	// hover-intent (le temps d'atteindre le flyout à travers le petit espace),
	// pas un contournement de bug : annulé dès qu'on entre dans le flyout.
	function cancelEffortClose(): void {
		if (effortCloseTimer) { clearTimeout(effortCloseTimer); effortCloseTimer = 0; }
	}

	function scheduleEffortClose(): void {
		cancelEffortClose();
		effortCloseTimer = window.setTimeout(closeEffortFlyout, 140);
	}

	function closeEffortFlyout(): void {
		cancelEffortClose();
		if (effortFlyout) { effortFlyout.remove(); effortFlyout = null; }
		const row = menuEl.querySelector(".qbd-effort-row");
		if (row) row.classList.remove("is-open");
	}

	function openEffortFlyout(row: HTMLElement): void {
		if (effortFlyout) return;
		row.classList.add("is-open");
		const fly = ajouter(document.body, "div", "qbd-select-menu qbd-effort-flyout");
		effortFlyout = fly;
		fly.setAttribute("role", "menu");
		ajouter(fly, "div", "qbd-effort-flyout-head", t("dashboard.select.effortFlyoutHelp"));
		for (const ef of (opts.efforts || [])) {
			const active = ef.value === opts.currentEffort;
			// Classe par niveau (--low/--medium/…/--ultracode) : porte la couleur
			// du picker /effort de Claude Code, révélée seulement à l'actif/survol.
			const b = ajouter(fly, "button", "qbd-select-option qbd-effort-option qbd-effort-option--" + ef.value
				+ (active ? " is-active" : ""));
			b.type = "button";
			b.setAttribute("role", "menuitemradio");
			b.setAttribute("aria-checked", active ? "true" : "false");
			const check = ajouter(b, "span", "qbd-select-check");
			if (active) currentHost().ui.setIcon(check, "check");
			const body = ajouter(b, "div", "qbd-effort-option-body");
			const top = ajouter(body, "div", "qbd-effort-option-top");
			ajouter(top, "span", "qbd-select-option-label", ef.label);
			if (ef.isDefault) ajouter(top, "span", "qbd-effort-badge", t("dashboard.select.effortDefault"));
			if (ef.sub) ajouter(body, "span", "qbd-effort-option-sub", ef.sub);
			b.addEventListener("click", () => {
				const changed = ef.value !== opts.currentEffort;
				opts.currentEffort = ef.value;
				closeMenu();
				if (changed && opts.onPickEffort) opts.onPickEffort(ef.value);
			});
		}

		// Position : à droite du menu (flip à gauche si pas de place). Le bas
		// du flyout s'aligne sur le bas de la ligne « Effort » → les niveaux
		// montent depuis la ligne, le plus élevé (ultracode) en bas.
		const rowR = row.getBoundingClientRect();
		const menuR = menuEl.getBoundingClientRect();
		fly.style.visibility = "hidden";
		fly.style.top = "0px";
		fly.style.left = "0px";
		const fr = fly.getBoundingClientRect();
		let left = menuR.right + 4;
		if (left + fr.width > window.innerWidth - 8) left = menuR.left - 4 - fr.width;
		left = Math.max(8, left);
		let top = rowR.bottom - fr.height;
		top = Math.min(Math.max(8, top), window.innerHeight - fr.height - 8);
		fly.style.left = left + "px";
		fly.style.top = top + "px";
		fly.style.visibility = "";

		fly.addEventListener("mouseenter", cancelEffortClose);
		fly.addEventListener("mouseleave", scheduleEffortClose);
	}

	// ── Flyout « Plus de modèles » (façon claude.ai) ──
	// Ouvert au survol de la ligne, portalé au <body>. Contient le reste des
	// modèles (opts.moreModels), chacun sélectionnable comme dans la liste.
	function cancelMoreClose(): void {
		if (moreCloseTimer) { clearTimeout(moreCloseTimer); moreCloseTimer = 0; }
	}

	function scheduleMoreClose(): void {
		cancelMoreClose();
		moreCloseTimer = window.setTimeout(closeMoreFlyout, 140);
	}

	function closeMoreFlyout(): void {
		cancelMoreClose();
		if (moreFlyout) { moreFlyout.remove(); moreFlyout = null; }
		const row = menuEl.querySelector(".qbd-more-row");
		if (row) row.classList.remove("is-open");
	}

	function openMoreFlyout(row: HTMLElement): void {
		if (moreFlyout) return;
		row.classList.add("is-open");
		const fly = ajouter(document.body, "div", "qbd-select-menu qbd-more-flyout");
		moreFlyout = fly;
		fly.setAttribute("role", "menu");
		for (const m of (opts.moreModels || [])) appendModelOption(fly, m);

		// Position : à droite du menu (flip à gauche si pas de place). Haut du
		// flyout aligné sur le haut de la ligne (la liste descend depuis la ligne).
		const rowR = row.getBoundingClientRect();
		const menuR = menuEl.getBoundingClientRect();
		fly.style.visibility = "hidden";
		fly.style.top = "0px";
		fly.style.left = "0px";
		const fr = fly.getBoundingClientRect();
		let left = menuR.right + 4;
		if (left + fr.width > window.innerWidth - 8) left = menuR.left - 4 - fr.width;
		left = Math.max(8, left);
		let top = Math.min(Math.max(8, rowR.top), window.innerHeight - fr.height - 8);
		fly.style.left = left + "px";
		fly.style.top = top + "px";
		fly.style.visibility = "";

		fly.addEventListener("mouseenter", cancelMoreClose);
		fly.addEventListener("mouseleave", scheduleMoreClose);
	}

	function closeMenu(): void {
		closeEffortFlyout();
		closeMoreFlyout();
		menuEl.remove();
		openMenus.delete(closeMenu);
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", closeMenu);
	}

	function onDocDown(e: MouseEvent): void {
		const t = e.target as Node | null;
		if (!t) return;
		if (anchorEl.contains(t) || menuEl.contains(t)
			|| (effortFlyout && effortFlyout.contains(t))
			|| (moreFlyout && moreFlyout.contains(t))) return;
		closeMenu();
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key !== "Escape") return;
		if (effortFlyout) closeEffortFlyout();
		else if (moreFlyout) closeMoreFlyout();
		else closeMenu();
	}

	function onScroll(e: Event): void {
		const t = e.target as Node | null;
		if (!t) return;
		if (menuEl.contains(t) || (effortFlyout && effortFlyout.contains(t))
			|| (moreFlyout && moreFlyout.contains(t))) return;
		closeMenu();
	}

	renderMain();
	reposition();

	openMenus.set(closeMenu, anchorEl);
	document.addEventListener("mousedown", onDocDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", closeMenu);

	return { close: closeMenu };
}

/* ── openProviderMenu ─────────────────────────────────────── */

/** Un canal dans le menu : une façon de parler à la marque. */
export interface ProviderChannelOption {
	value: string;
	label: string;
	sub?: string;
	/** Visible, mais pas sélectionnable (CLI absent) → `onDisabledClick`. */
	disabled?: boolean;
	/** Pastille d'état, seulement quand ça ne va pas : "warn" | "err". */
	dot?: string | null;
}

/** Une marque dans le menu : un logo, un nom, et un ou plusieurs canaux. */
export interface ProviderBrandOption {
	value: string;
	label: string;
	logo: string;
	channels: ProviderChannelOption[];
}

export interface OpenProviderMenuOptions {
	brands: ProviderBrandOption[];
	/** L'identifiant du CANAL courant (le réglage `aiProvider`). */
	current: string;
	/** Pose le logo de marque dans un élément (l'appelant connaît ses SVG). */
	renderLogo: (el: HTMLElement, logo: string) => void;
	onPick?: (channelValue: string) => void;
	onDisabledClick?: (channelValue: string) => void;
}

/** Comme `MenuHandle`, plus de quoi redessiner sans refermer : les statuts des
    CLI arrivent en asynchrone, souvent pendant que le menu est ouvert. */
export interface ProviderMenuHandle extends MenuHandle {
	refresh(): void;
}

/*
 * openProviderMenu(anchorEl, { brands, current, renderLogo, onPick })
 * — le menu des fournisseurs à DEUX niveaux : une ligne par marque, et pour
 * une marque à plusieurs canaux un flyout latéral (même patron que la ligne
 * « Effort » du menu de modèles). Une marque à canal unique se choisit d'un
 * seul clic : un second niveau qui n'offre aucun choix serait un détour.
 */
export function openProviderMenu(anchorEl: HTMLElement, opts: OpenProviderMenuOptions): ProviderMenuHandle {
	if (toggleCloseForAnchor(anchorEl)) return { close() {}, refresh() {} };
	closeAllSelects();

	const menuEl = ajouter(document.body, "div", "qbd-select-menu qbd-provider-menu");
	menuEl.setAttribute("role", "menu");
	let flyout: HTMLDivElement | null = null;
	let flyoutBrand = "";
	let closeTimer = 0;

	/** La marque qui porte le canal courant, pour la coche et le sous-titre. */
	function brandOf(channelValue: string): ProviderBrandOption | undefined {
		return opts.brands.find(b => b.channels.some(c => c.value === channelValue));
	}

	function channelOf(b: ProviderBrandOption): ProviderChannelOption {
		return b.channels.find(c => c.value === opts.current) || b.channels[0];
	}

	function reposition(): void {
		const rect = anchorEl.getBoundingClientRect();
		menuEl.style.left = rect.left + "px";
		menuEl.style.visibility = "hidden";
		menuEl.style.top = "0px";
		const menuRect = menuEl.getBoundingClientRect();
		const below = rect.bottom + 4;
		const above = rect.top - 4 - menuRect.height;
		menuEl.style.top = (below + menuRect.height <= window.innerHeight - 8 || above < 8 ? below : above) + "px";
		let left = rect.left;
		if (menuRect.width + left > window.innerWidth - 8) {
			left = Math.max(8, window.innerWidth - 8 - menuRect.width);
		}
		menuEl.style.left = left + "px";
		menuEl.style.visibility = "";
	}

	/* Le statut à droite d'une ligne. ABSENT (`err`) : plus de pastille rouge —
	   le sous-titre « Non installé » le dit déjà (Ahmed, 2026-09-19) — mais un
	   VRAI bouton « Installer », le SEUL endroit qui ouvre le modal
	   d'installation (automatique ou manuelle) : cliquer ailleurs sur la ligne
	   ne fait rien (Ahmed, 2026-09-19 : « c'est plus logique et cohérent »).
	   La ligne d'un fournisseur absent est donc un <div> et non un <button>
	   (voir `creerLigne`) : un <button> dans un <button> n'est pas du HTML
	   valide. Serveur arrêté (`warn`) : la pastille orange reste. */
	function appendStatut(row: HTMLElement, dot: string | null | undefined, value: string): void {
		if (dot === "err") {
			const bouton = ajouter(row, "button", "qbd-provider-install");
			bouton.type = "button";
			currentHost().ui.setIcon(ajouter(bouton, "span", "qbd-provider-install-icon"), "download");
			ajouter(bouton, "span", undefined, t("dashboard.select.install"));
			bouton.addEventListener("click", (e) => {
				e.stopPropagation();
				/* L'appui se VOIT avant que le menu ne disparaisse (Ahmed,
				   2026-09-19) : fermé dans la même image, le clic n'avait aucun
				   retour. 160 ms, le temps de l'enfoncement (CSS `is-pressed`). */
				bouton.classList.add("is-pressed");
				bouton.disabled = true;
				window.setTimeout(() => { closeMenu(); opts.onDisabledClick?.(value); }, 160);
			});
		} else if (dot === "warn") {
			ajouter(row, "span", "qbd-status-dot qbd-status-dot--warn");
		}
	}

	/* Une ligne de menu : un <button> si elle se choisit, un <div> inerte si
	   c'est un fournisseur absent (son bouton « Installer » est la seule
	   action, voir `appendStatut`). */
	function creerLigne(parent: HTMLElement, cls: string, inerte: boolean): HTMLElement {
		if (inerte) {
			const div = ajouter(parent, "div", cls + " qbd-select-option--inerte");
			div.setAttribute("aria-disabled", "true");
			return div;
		}
		const btn = ajouter(parent, "button", cls);
		btn.type = "button";
		return btn;
	}

	/* Une ligne de canal, dans le flyout. Même forme que l'option de marque
	   (libellé gras + sous-titre), sans logo : le flyout appartient déjà à
	   une marque, répéter son glyphe à chaque ligne n'apprendrait rien. */
	function appendChannel(parent: HTMLElement, c: ProviderChannelOption): void {
		const active = c.value === opts.current && !c.disabled;
		const btn = creerLigne(parent, "qbd-select-option qbd-channel-option" + (active ? " is-active" : ""), !!c.disabled);
		btn.setAttribute("role", "menuitemradio");
		btn.setAttribute("aria-checked", active ? "true" : "false");
		if (c.disabled) btn.setAttribute("aria-disabled", "true");
		const check = ajouter(btn, "span", "qbd-select-check");
		if (active) currentHost().ui.setIcon(check, "check");
		const body = ajouter(btn, "div", "qbd-provider-option-body");
		ajouter(body, "span", "qbd-select-option-label", c.label);
		if (c.sub) ajouter(body, "span", "qbd-provider-option-sub", c.sub);
		appendStatut(btn, c.dot, c.value);
		if (c.disabled) return;
		btn.addEventListener("click", () => {
			closeMenu();
			if (c.value !== opts.current) opts.onPick?.(c.value);
		});
	}

	function cancelClose(): void {
		if (closeTimer) { clearTimeout(closeTimer); closeTimer = 0; }
	}

	function scheduleClose(): void {
		cancelClose();
		closeTimer = window.setTimeout(closeFlyout, 140);
	}

	function closeFlyout(): void {
		cancelClose();
		if (flyout) { flyout.remove(); flyout = null; }
		flyoutBrand = "";
		menuEl.querySelectorAll(".qbd-brand-row.is-open").forEach(el => el.classList.remove("is-open"));
	}

	function openFlyout(row: HTMLElement, b: ProviderBrandOption): void {
		if (flyout && flyoutBrand === b.value) return;
		closeFlyout();
		flyoutBrand = b.value;
		row.classList.add("is-open");
		const fly = ajouter(document.body, "div", "qbd-select-menu qbd-channel-flyout");
		flyout = fly;
		fly.setAttribute("role", "menu");
		for (const c of b.channels) appendChannel(fly, c);

		// À droite du menu, rabattu à gauche s'il n'y a pas la place. Haut du
		// flyout aligné sur le haut de sa ligne : les canaux descendent depuis
		// la marque à laquelle ils appartiennent.
		const rowR = row.getBoundingClientRect();
		const menuR = menuEl.getBoundingClientRect();
		fly.style.visibility = "hidden";
		fly.style.top = "0px";
		fly.style.left = "0px";
		const fr = fly.getBoundingClientRect();
		let left = menuR.right + 4;
		if (left + fr.width > window.innerWidth - 8) left = menuR.left - 4 - fr.width;
		left = Math.max(8, left);
		const top = Math.min(Math.max(8, rowR.top), window.innerHeight - fr.height - 8);
		fly.style.left = left + "px";
		fly.style.top = top + "px";
		fly.style.visibility = "";

		fly.addEventListener("mouseenter", cancelClose);
		fly.addEventListener("mouseleave", scheduleClose);
	}

	function renderMain(): void {
		menuEl.replaceChildren();
		const brandCourante = brandOf(opts.current);
		for (const b of opts.brands) {
			const canal = channelOf(b);
			const multiple = b.channels.length > 1;
			const active = brandCourante?.value === b.value;
			/* La marque en usage : une coche SEULEMENT si elle n'a qu'un canal.
			   Avec un second niveau, la coche se collait au chevron — deux
			   glyphes de sens différents au même endroit (vu à l'écran le
			   2026-09-18) — et c'est le chevron passé à l'accent qui la remplace
			   (CSS de `.is-active`). Dans le flyout, la coche est sur le CANAL :
			   c'est lui qui est choisi, pas la marque. */
			const absent = !multiple && !!b.channels[0]?.disabled;
			const row = creerLigne(menuEl, "qbd-select-option qbd-brand-row" + (active ? " is-active" : ""), absent);
			row.setAttribute("role", multiple ? "menuitem" : "menuitemradio");
			if (!multiple) {
				row.setAttribute("aria-checked", active ? "true" : "false");
				const check = ajouter(row, "span", "qbd-select-check");
				if (active) currentHost().ui.setIcon(check, "check");
			}
			const logo = ajouter(row, "span", "qbd-provider-logo qbd-provider-logo--" + b.logo);
			opts.renderLogo(logo, b.logo);
			const body = ajouter(row, "div", "qbd-provider-option-body");
			ajouter(body, "span", "qbd-select-option-label", b.label);
			/* Le sous-titre dit le canal EN USAGE pour cette marque, pas la
			   marque elle-même : c'est la seule chose qui change entre deux
			   lignes du même logo, et donc la seule qui vaille la place. */
			ajouter(body, "span", "qbd-provider-option-sub", canal ? (canal.sub || canal.label) : "");
			const st = canal && !multiple ? canal.dot : null;
			appendStatut(row, st, canal ? canal.value : "");
			if (multiple) {
				// Cette ligne OUVRE un sous-menu (le flyout des canaux) au lieu de
				// choisir directement : la sémantique d'accessibilité standard pour
				// un item de menu qui en révèle un second.
				row.setAttribute("aria-haspopup", "menu");
				const chev = ajouter(row, "span", "qbd-model-menu-row-chevron");
				currentHost().ui.setIcon(chev, "chevron-right");
				row.addEventListener("mouseenter", () => { cancelClose(); openFlyout(row, b); });
				row.addEventListener("mouseleave", scheduleClose);
				// Le clic ouvre aussi : au doigt et au clavier, il n'y a pas de survol.
				row.addEventListener("click", () => { cancelClose(); openFlyout(row, b); });
			} else {
				row.addEventListener("mouseenter", closeFlyout);
				if (!absent) row.addEventListener("click", () => {
					const c = b.channels[0];
					closeMenu();
					if (c.value !== opts.current) opts.onPick?.(c.value);
				});
			}
		}
	}

	function closeMenu(): void {
		closeFlyout();
		menuEl.remove();
		openMenus.delete(closeMenu);
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", closeMenu);
	}

	function onDocDown(e: MouseEvent): void {
		const t = e.target as Node | null;
		if (!t) return;
		if (anchorEl.contains(t) || menuEl.contains(t) || (flyout && flyout.contains(t))) return;
		closeMenu();
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key !== "Escape") return;
		if (flyout) closeFlyout();
		else closeMenu();
	}

	function onScroll(e: Event): void {
		const t = e.target as Node | null;
		if (!t) return;
		if (menuEl.contains(t) || (flyout && flyout.contains(t))) return;
		closeMenu();
	}

	renderMain();
	reposition();

	openMenus.set(closeMenu, anchorEl);
	document.addEventListener("mousedown", onDocDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", closeMenu);

	return {
		close: closeMenu,
		/* Un statut arrivé après l'ouverture redessine les lignes en place. Le
		   flyout ouvert est refermé : ses lignes viennent d'être détruites, le
		   garder en vie le laisserait pointer un bouton qui n'existe plus. */
		refresh() { closeFlyout(); renderMain(); reposition(); }
	};
}

/* ── openEffortSlider ─────────────────────────────────────── */

export interface EffortSliderFast {
	on: boolean;
	onToggle?: (on: boolean) => void;
}

export interface OpenEffortSliderOptions {
	variant?: "claude" | "codex";
	efforts?: EffortOption[];
	/** Mutable : réassigné en interne à chaque niveau retenu (cf. commit()). */
	currentEffort?: string;
	fast?: EffortSliderFast | null;
	onPickEffort?: (value: string) => void;
}

/*
 * openEffortSlider(anchorEl, {
 *   variant: "claude" | "codex",
 *   efforts: [{ value, label, accent? }], currentEffort,
 *   onPickEffort(value)
 * })
 * Popover slider d'effort — réplique du contrôle natif de chaque outil :
 * — claude : carte « Effort <Niveau> » + aide (?) au survol, libellés
 *   « Plus rapide / Plus intelligent », piste à points, remplissage violet
 *   étoilé au niveau accent (ultracode) ;
 * — codex : carte « Advanced › » + éclair (tooltip « 1.5x speed / More
 *   usage » au survol, non cliquable), piste à remplissage dégradé bleu
 *   étoilé, violette au niveau accent (ultra), tooltip « Consumes usage
 *   limits faster » au survol de la piste au niveau max/ultra.
 * Le popover reste ouvert pendant l'ajustement (comme les originaux) ;
 * onPickEffort est notifié à chaque niveau retenu (relâchement/clavier).
 */
export function openEffortSlider(anchorEl: HTMLElement, opts: OpenEffortSliderOptions): MenuHandle | null {
	if (toggleCloseForAnchor(anchorEl)) return { close() {} };
	closeAllSelects();

	const efforts = opts.efforts || [];
	if (!efforts.length) return null;
	const variant = opts.variant === "codex" ? "codex" : "claude";
	const n = efforts.length;
	let idx = Math.max(0, efforts.findIndex(e => e.value === opts.currentEffort));
	let committed = efforts[idx].value;

	const menuEl = ajouter(document.body, "div", "qbd-select-menu qbd-effort-pop qbd-effort-pop--" + variant);
	menuEl.setAttribute("role", "menu");

	// ── Tooltips au survol (aide, éclair, piste) ──
	// Portalés au <body> ; suivis dans `tips` pour être retirés à la fermeture
	// du popover (l'ancre disparaît sans mouseleave). pointer-events: none →
	// jamais cliquables, conformes à la référence (« juste on le survole »).
	const tips = new Set<HTMLDivElement>();
	function attachTip(anchor: HTMLElement, build: (tip: HTMLDivElement) => void, shouldShow?: () => boolean): () => void {
		let tip: HTMLDivElement | null = null;
		const hide = () => { if (tip) { tip.remove(); tips.delete(tip); tip = null; } };
		anchor.addEventListener("mouseenter", () => {
			if (tip || (shouldShow && !shouldShow())) return;
			tip = ajouter(document.body, "div", "qbd-hover-tip");
			tips.add(tip);
			build(tip);
			const r = anchor.getBoundingClientRect();
			tip.style.visibility = "hidden";
			const tr = tip.getBoundingClientRect();
			let left = r.left + r.width / 2 - tr.width / 2;
			left = Math.min(Math.max(8, left), window.innerWidth - tr.width - 8);
			let top = r.top - tr.height - 8;
			if (top < 8) top = r.bottom + 8;
			tip.style.left = left + "px";
			tip.style.top = top + "px";
			tip.style.visibility = "";
		});
		anchor.addEventListener("mouseleave", hide);
		return hide;
	}

	// ── En-tête + échelle (claude uniquement — codex a sa propre rangée
	// d'en-tête réduite à l'éclair Fast, sans titre « Advanced ») ──
	let valueEl: HTMLSpanElement | null = null;
	if (variant === "claude") {
		const head = ajouter(menuEl, "div", "qbd-effort-pop-head");
		const title = ajouter(head, "span", "qbd-effort-pop-title");
		ajouter(title, "span", undefined, t("dashboard.select.effort")); // gap 5px via CSS (handoff)
		valueEl = ajouter(title, "span", "qbd-effort-pop-value");
		// Aide « ? » : cercle custom du handoff (15×15, bordure #56565c),
		// PAS une icône Lucide — imposé par la référence validée.
		const help = ajouter(head, "span", "qbd-effort-pop-icon qbd-effort-pop-help");
		help.setAttribute("aria-hidden", "true");
		help.textContent = "?";
		attachTip(help, (tip) => {
			tip.classList.add("qbd-hover-tip--card");
			ajouter(tip, "div", "qbd-hover-tip-title", t("dashboard.select.effort"));
			ajouter(tip, "div", "qbd-hover-tip-body", t("dashboard.select.effortHelp"));
		});
		const scale = ajouter(menuEl, "div", "qbd-effort-pop-scale");
		ajouter(scale, "span", undefined, t("dashboard.select.effortFaster"));
		ajouter(scale, "span", undefined, t("dashboard.select.effortSmarter"));
	}

	// ── Slider discret (codex : l'éclair Fast vit dans une rangée
	// d'en-tête AU-DESSUS, aligné à droite — référence 2026-07-10 —,
	// le slider occupe seul sa ligne, pleine largeur) ──
	const zapRow = (variant === "codex" && opts.fast)
		? ajouter(menuEl, "div", "qbd-effort-pop-zaprow")
		: null;
	const slider = ajouter(menuEl, "div", "qbd-effort-slider");
	slider.tabIndex = 0;
	slider.setAttribute("role", "slider");
	slider.setAttribute("aria-label", t("dashboard.select.effort"));
	slider.setAttribute("aria-valuemin", "0");
	slider.setAttribute("aria-valuemax", String(n - 1));
	const track = ajouter(slider, "div", "qbd-effort-track");
	const fill = ajouter(track, "div", "qbd-effort-fill");
	// Overlay violet (codex) : opacité pilotée par --qbd-p → le fill vire
	// progressivement du bleu au violet, comme la source ChatGPT.
	if (variant === "codex") ajouter(fill, "div", "qbd-effort-fill-ultra");
	const rail = ajouter(track, "div", "qbd-effort-rail");
	const dots: HTMLDivElement[] = [];
	for (let i = 0; i < n; i++) {
		// Le point du niveau accent (ultracode) est TOUJOURS violet dans la
		// carte Claude Code (notchUltracode), même au repos.
		const dot = ajouter(rail, "div", "qbd-effort-dot" + (efforts[i].accent ? " qbd-effort-dot--ultra" : ""));
		dot.style.left = (n > 1 ? (i / (n - 1)) * 100 : 0) + "%";
		dots.push(dot);
	}
	// Pouce claude : dans la PISTE (pas le rail) — piloté en transform par
	// effort-canvas.js (formule du handoff : 1 + v·(W−thumbW−2)) ; codex :
	// rail + left % (inchangé).
	const thumb = ajouter(variant === "claude" ? track : rail, "div", "qbd-effort-thumb");
	// Piste claude : mosaïque de pixels animés en canvas (handoff validé
	// « design_handoff_effort_slider ») — visible au niveau ultracode.
	const trackFx: EffortTrackFx | null = variant === "claude"
		? createEffortTrackFx(track, thumb, {
			accent: "#a78bfa", // accent validé du handoff
			speed: 0.3,        // vitesse validée
			value: n > 1 ? idx / (n - 1) : 1
		})
		: null;

	// ── Éclair Fast (codex) : VRAI toggle du service tier « priority »
	// (1.5x speed, more usage), persisté via opts.fast.onToggle. Le tooltip
	// reste au survol ; absent si le modèle n'expose pas le tier Fast. ──
	let stopDrift: (() => void) | null = null;
	if (zapRow && opts.fast) {
		// Alias local : narrowing stable dans les closures ci-dessous
		// (TS ne retient pas `opts.fast` non-null à travers des fonctions
		// imbriquées définies ici mais appelées plus tard).
		const fast = opts.fast;
		const zap = ajouter(zapRow, "button", "qbd-effort-fast qbd-effort-pop-zap");
		zap.type = "button";
		zap.setAttribute("aria-label", t("dashboard.select.fastAria"));
		currentHost().ui.setIcon(zap, "zap");
		// Drift des étoiles Fast piloté en rAF via --qbd-drift : des keyframes
		// CSS ne savent ni décélérer ni accélérer. Ici la VITESSE tend vers sa
		// cible par lissage exponentiel (~0.45s) pendant que l'opacité fond en
		// CSS (.3s) → les points ralentissent et s'effacent ENSEMBLE, et
		// repartent en fondu déjà en mouvement. La couche ::after suit à
		// 0.65x via calc() (parallaxe préservée).
		const DRIFT_SPEED = 86;  // px/s — 2x la version keyframes (56px/1.3s)
		const DRIFT_TAU = 0.15;  // s — ~95 % de l'arrêt/du départ en 0.45s
		const DRIFT_WRAP = 1120; // 20 tuiles de 56px ; 0.65x retombe sur 728
		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let driftX = 0;
		let driftV = fast.on ? DRIFT_SPEED : 0; // ouverture : déjà en croisière
		let driftRaf = 0;
		let driftLast = 0;
		const driftStep = (ts: number) => {
			const dt = Math.min(0.05, Math.max(0, (ts - driftLast) / 1000));
			driftLast = ts;
			const target = fast.on ? DRIFT_SPEED : 0;
			driftV += (target - driftV) * (1 - Math.exp(-dt / DRIFT_TAU));
			driftX = (driftX - driftV * dt) % DRIFT_WRAP;
			fill.style.setProperty("--qbd-drift", driftX.toFixed(2) + "px");
			if (!target && driftV < 0.5) { driftRaf = 0; return; } // arrêté → veille
			driftRaf = requestAnimationFrame(driftStep);
		};
		const driftWake = () => {
			// Boucle déjà active : elle lit la nouvelle cible toute seule.
			if (reduceMotion || driftRaf) return;
			driftLast = performance.now();
			driftRaf = requestAnimationFrame(driftStep);
		};
		stopDrift = () => cancelAnimationFrame(driftRaf);
		const refreshZap = () => {
			zap.classList.toggle("is-on", !!fast.on);
			zap.setAttribute("aria-pressed", fast.on ? "true" : "false");
			// Fast ON → étoiles animées sur le fill bleu (référence ChatGPT).
			menuEl.classList.toggle("is-fast", !!fast.on);
		};
		refreshZap();
		if (fast.on) driftWake();
		zap.addEventListener("click", () => {
			fast.on = !fast.on;
			refreshZap();
			driftWake();
			if (fast.onToggle) fast.onToggle(fast.on);
		});
		// L'anglais reprend mot pour mot les libellés de la référence ChatGPT
		// (« 1.5x speed » / « More usage ») ; le français les traduit.
		attachTip(zap, (tip) => {
			ajouter(tip, "div", "qbd-hover-tip-title", t("dashboard.select.fastSpeed"));
			ajouter(tip, "div", "qbd-hover-tip-body", t("dashboard.select.fastUsage"));
		});
	}

	// Aux niveaux qui consomment le plus (max/ultra), Codex prévient au survol
	// de la piste (référence : tooltip au-dessus du slider en état ultra).
	if (variant === "codex") {
		attachTip(slider, (tip) => {
			ajouter(tip, "div", "qbd-hover-tip-title", t("dashboard.select.usageWarning"));
		}, () => idx >= n - 1 || ["max", "ultra"].includes(efforts[idx].value));
	}

	const capitalize = (s: string): string => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

	// En-tête de la carte Claude Code : niveaux en ANGLAIS (demande
	// explicite). Un niveau inconnu retombe sur son label capitalisé.
	// HORS i18n volontairement : ces noms restent en anglais DANS LES DEUX
	// langues (ils reproduisent le picker /effort de Claude Code) — les passer
	// par t() les traduirait en français, contre la demande.
	const CLAUDE_EFFORT_EN: Record<string, string> = {
		low: "Low", medium: "Medium", high: "High",
		xhigh: "Extra", max: "Max", ultracode: "Ultracode"
	};

	// Transition « ticker » du niveau : l'ancien texte glisse vers le HAUT
	// en fondant, le nouveau monte depuis le BAS. Le sortant passe en
	// absolute pour ne pas fausser la largeur ; nettoyage par animationend
	// + minuterie de secours (reduced-motion ne déclenche pas animationend).
	function rollValue(label: string): void {
		if (!valueEl) return; // uniquement appelée quand variant === "claude"
		const cur = valueEl.querySelector<HTMLElement>(".qbd-effort-pop-value-text:not(.is-out)");
		if (cur && cur.textContent === label) return;
		if (cur) {
			// Changements rapides : un seul sortant à la fois (les précédents
			// sont purgés) → une tache floue douce, pas un empilement lisible.
			valueEl.querySelectorAll(".qbd-effort-pop-value-text.is-out").forEach(e => e.remove());
			cur.classList.remove("is-in");
			cur.classList.add("is-out");
			const drop = () => cur.remove();
			cur.addEventListener("animationend", drop, { once: true });
			setTimeout(drop, 350);
			const next = ajouter(valueEl, "span", "qbd-effort-pop-value-text is-in", label);
			next.addEventListener("animationend", () => next.classList.remove("is-in"), { once: true });
		} else {
			ajouter(valueEl, "span", "qbd-effort-pop-value-text", label);
		}
	}

	// Squish du pouce à chaque changement de niveau (source ChatGPT :
	// scale [1,.93,1,1], times [0,.1309,.6354,1], .3s linear) — la classe
	// est retirée puis reposée pour rejouer l'animation CSS.
	let lastIdx: number | null = null;
	function squishThumb(): void {
		thumb.classList.remove("is-squish");
		void thumb.offsetWidth; // reflow → l'animation peut se rejouer
		thumb.classList.add("is-squish");
	}

	function update(): void {
		const ef = efforts[idx];
		// Squish : signature ChatGPT (codex) uniquement — le handoff claude
		// n'en a pas, et son pouce est piloté en transform (conflit).
		if (variant === "codex" && lastIdx !== null && idx !== lastIdx) squishThumb();
		const animate = lastIdx !== null; // 1er rendu : pouce posé sans tween
		lastIdx = idx;
		slider.style.setProperty("--qbd-p", String(n > 1 ? idx / (n - 1) : 1));
		slider.setAttribute("aria-valuenow", String(idx));
		slider.setAttribute("aria-valuetext", ef.label);
		// Rungs de la zone remplie (source ChatGPT : blancs/30 si i <= idx,
		// les « étoiles » de la référence).
		dots.forEach((d, i) => d.classList.toggle("is-filled", i <= idx));
		// Niveau accent (ultracode / ultra) → état violet.
		menuEl.classList.toggle("is-ultra", !!ef.accent);
		if (trackFx) {
			trackFx.setValue(n > 1 ? idx / (n - 1) : 1, animate);
			// (Ré)entrer en ultracode rejoue le chargement droite→gauche.
			trackFx.setUltra(!!ef.accent);
		}
		if (valueEl) {
			rollValue(CLAUDE_EFFORT_EN[ef.value] || capitalize(ef.label));
			valueEl.classList.toggle("is-ultra", !!ef.accent);
		}
	}

	function commit(): void {
		const v = efforts[idx].value;
		if (v === committed) return;
		committed = v;
		opts.currentEffort = v;
		if (opts.onPickEffort) opts.onPickEffort(v);
	}

	function idxFromPointer(e: PointerEvent): number {
		const r = rail.getBoundingClientRect();
		const p = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
		return Math.round(p * (n - 1));
	}

	let dragging = false;
	slider.addEventListener("pointerdown", (e) => {
		e.preventDefault();
		slider.focus();
		// capture best-effort : un pointerId déjà relâché (stylet, synthèse)
		// jette InvalidPointerId — le drag suit alors les pointermove simples.
		try { slider.setPointerCapture(e.pointerId); } catch (err) { /* best effort */ }
		dragging = true;
		slider.classList.add("is-dragging"); // press : scale(.94) du pouce (codex)
		idx = idxFromPointer(e);
		update();
	});
	slider.addEventListener("pointermove", (e) => {
		if (!dragging) return;
		const next = idxFromPointer(e);
		if (next !== idx) { idx = next; update(); }
	});
	slider.addEventListener("pointerup", (e) => {
		if (!dragging) return;
		dragging = false;
		slider.classList.remove("is-dragging");
		try { slider.releasePointerCapture(e.pointerId); } catch (err) { /* best effort */ }
		commit();
	});
	slider.addEventListener("pointercancel", () => { dragging = false; slider.classList.remove("is-dragging"); });
	slider.addEventListener("keydown", (e) => {
		let next = idx;
		if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(n - 1, idx + 1);
		else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, idx - 1);
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = n - 1;
		else return;
		e.preventDefault();
		if (next !== idx) { idx = next; update(); commit(); }
	});

	update();

	// ── Position (au-dessus de l'ancre si le bas manque de place) ──
	const rect = anchorEl.getBoundingClientRect();
	menuEl.style.visibility = "hidden";
	menuEl.style.top = "0px";
	menuEl.style.left = "0px";
	const mr = menuEl.getBoundingClientRect();
	let left = Math.min(Math.max(8, rect.left), window.innerWidth - mr.width - 8);
	const below = rect.bottom + 4;
	const top = (below + mr.height <= window.innerHeight - 8 || rect.top - 4 - mr.height < 8)
		? below : rect.top - 4 - mr.height;
	menuEl.style.left = left + "px";
	menuEl.style.top = top + "px";
	menuEl.style.visibility = "";

	function closeMenu(): void {
		if (trackFx) trackFx.destroy(); // stoppe la boucle rAF du canvas
		if (stopDrift) stopDrift();     // stoppe la boucle rAF du drift Fast
		for (const t of tips) t.remove();
		tips.clear();
		menuEl.remove();
		openMenus.delete(closeMenu);
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", closeMenu);
	}

	function onDocDown(e: MouseEvent): void {
		const t = e.target as Node | null;
		if ((t && anchorEl.contains(t)) || (t && menuEl.contains(t))) return;
		closeMenu();
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Escape") closeMenu();
	}

	function onScroll(e: Event): void {
		const t = e.target as Node | null;
		if (t && menuEl.contains(t)) return;
		closeMenu();
	}

	openMenus.set(closeMenu, anchorEl);
	document.addEventListener("mousedown", onDocDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", closeMenu);
	setTimeout(() => slider.focus(), 0);

	return { close: closeMenu };
}

/* ── openOptionsMenu ──────────────────────────────────────── */

export interface OpenOptionsMenuOptions {
	count: number;
	type: string;
	types: string[];
	onCount?: (n: number) => void;
	onType?: (t: string) => void;
	/**
	 * DESTINATION du quiz généré : les dossiers proposés, le premier étant le
	 * défaut. Absente ou vide = pas de section Destination, et c'est le cas du
	 * GREFFON — il écrit dans le vault ouvert, il n'y a pas de choix à faire.
	 *
	 * Un DROPDOWN local et non une liste à coche comme le Type : les types
	 * sont cinq pour toujours, les dossiers peuvent être trente.
	 */
	folders?: { value: string; label: string; icon?: string; color?: string; sub?: string }[];
	/** Dossier courant (une `value` de `folders`). */
	folder?: string;
	onFolder?: (value: string) => void;
}

/*
 * openOptionsMenu(anchorEl, {
 *   count, minCount, maxCount,   // slider Questions
 *   type, types: string[],       // choix du Type
 *   onCount(n), onType(t)
 * })
 * Popover des options de génération (remplace la carte « Options » du
 * formulaire). Reste ouvert pendant les réglages — fermeture clic-dehors,
 * Esc, scroll. Le Type est une liste à coche directe, PAS un dropdown
 * imbriqué : l'ouverture d'un createSelect appelle closeAllSelects(),
 * qui fermerait ce popover.
 */
export function openOptionsMenu(anchorEl: HTMLElement, opts: OpenOptionsMenuOptions): MenuHandle {
	if (toggleCloseForAnchor(anchorEl)) return { close() {} };
	closeAllSelects();

	const menuEl = ajouter(document.body, "div", "qbd-select-menu qbd-options-pop");
	menuEl.setAttribute("role", "menu");

	// ── Questions : DROPDOWN à presets + « Personnalisé » (référence
	// sélecteur de durée d'Ahmed, 2026-07-11) — Personnalisé révèle un
	// champ nombre à côté (« Custom | 5 m : 00 s »). Dropdown LOCAL au
	// popover : createSelect appellerait closeAllSelects() et fermerait
	// le popover parent. ──
	const PRESETS = [5, 10, 15, 20, 30];
	let count = Math.min(100, Math.max(1, Math.round(Number(opts.count) || 5)));
	let isCustom = !PRESETS.includes(count);

	ajouter(menuEl, "div", "qbd-options-pop-title", t("dashboard.select.optionsQuestions"));
	const countRow = ajouter(menuEl, "div", "qbd-options-pop-row");
	const ddWrap = ajouter(countRow, "div", "qbd-opts-dd-wrap");
	const trigger = ajouter(ddWrap, "button", "qbd-opts-dd");
	trigger.type = "button";
	const trigLabel = ajouter(trigger, "span", "qbd-opts-dd-label");
	const trigChev = ajouter(trigger, "span", "qbd-select-chevron");
	currentHost().ui.setIcon(trigChev, "chevron-down");
	const ddMenu = ajouter(ddWrap, "div", "qbd-opts-dd-menu is-hidden");
	const field = ajouter(countRow, "input", "qbd-opts-count");
	field.type = "number";
	field.min = "1";
	field.max = "100";
	field.inputMode = "numeric";

	const commitCount = (n: unknown) => {
		count = Math.min(100, Math.max(1, Math.round(Number(n) || count)));
		field.value = String(count);
		if (opts.onCount) opts.onCount(count);
	};

	// « N questions » : accord porté par le dictionnaire (les presets sont tous
	// > 1, mais la règle vaut aussi pour un preset futur à 1).
	const countLabel = (n: number): string =>
		t(n === 1 ? "dashboard.common.questionsOne" : "dashboard.common.questionsOther", { count: n });

	const refreshCountUI = () => {
		trigLabel.textContent = isCustom ? t("dashboard.select.optionsCustom") : countLabel(count);
		field.classList.toggle("is-hidden", !isCustom);
		trigger.setAttribute("aria-expanded", ddMenu.classList.contains("is-hidden") ? "false" : "true");
		for (const b of Array.from(ddMenu.querySelectorAll<HTMLButtonElement>(".qbd-opts-dd-item"))) {
			const active = b.dataset.preset === "custom"
				? isCustom
				: (!isCustom && Number(b.dataset.preset) === count);
			b.classList.toggle("is-active", active);
			const check = b.querySelector(".qbd-select-check");
			if (!check) continue;
			check.replaceChildren();
			if (active) currentHost().ui.setIcon(check as HTMLElement, "check");
		}
	};

	const closeDd = () => { ddMenu.classList.add("is-hidden"); refreshCountUI(); };

	for (const p of [...PRESETS.map(String), "custom"]) {
		const item = ajouter(ddMenu, "button", "qbd-opts-dd-item");
		item.type = "button";
		item.dataset.preset = p;
		ajouter(item, "span", "qbd-select-check");
		ajouter(item, "span", undefined, p === "custom" ? t("dashboard.select.optionsCustom") : countLabel(Number(p)));
		item.addEventListener("click", () => {
			if (p === "custom") {
				isCustom = true;
				closeDd();
				field.focus();
			} else {
				isCustom = false;
				commitCount(Number(p));
				closeDd();
			}
		});
	}

	trigger.addEventListener("click", () => {
		ddMenu.classList.toggle("is-hidden");
		refreshCountUI();
	});

	// Champ nombre : sélection au focus, commit Enter/blur, Échap annule.
	field.addEventListener("focus", () => field.select());
	field.addEventListener("change", () => commitCount(field.value));
	field.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			commitCount(field.value);
			field.blur();
		} else if (e.key === "Escape") {
			e.stopPropagation();
			field.value = String(count);
			field.blur();
		}
	});

	commitCount(count);
	refreshCountUI();

	// ── Type : items à coche (même anatomie que les options de select) ──
	ajouter(menuEl, "div", "qbd-options-pop-title", t("dashboard.select.optionsType"));
	const items: Array<{ t: string; btn: HTMLButtonElement; check: HTMLElement }> = [];
	let current = opts.type;
	function refreshItems(): void {
		for (const it of items) {
			const active = it.t === current;
			it.btn.classList.toggle("is-active", active);
			it.btn.setAttribute("aria-checked", active ? "true" : "false");
			it.check.replaceChildren();
			if (active) currentHost().ui.setIcon(it.check, "check");
		}
	}
	for (const t of opts.types) {
		const btn = ajouter(menuEl, "button", "qbd-select-option");
		btn.type = "button";
		btn.setAttribute("role", "menuitemradio");
		const check = ajouter(btn, "span", "qbd-select-check");
		ajouter(btn, "span", "qbd-select-option-label", t);
		btn.addEventListener("click", () => {
			current = t;
			refreshItems();
			if (opts.onType) opts.onType(t);
		});
		items.push({ t, btn, check });
	}
	refreshItems();

	/* ── Destination : le dossier qui recevra le quiz généré ──
	   Même anatomie que le dropdown des questions (trigger + menu local), et
	   pour la même raison : un `createSelect` appellerait `closeAllSelects()`,
	   qui fermerait le popover qui le contient. */
	const folders = opts.folders ?? [];
	if (folders.length > 0) {
		let folder = folders.some(f => f.value === opts.folder) ? String(opts.folder) : folders[0].value;
		ajouter(menuEl, "div", "qbd-options-pop-title", t("dashboard.select.optionsDestination"));
		const destRow = ajouter(menuEl, "div", "qbd-options-pop-row");
		const destWrap = ajouter(destRow, "div", "qbd-opts-dd-wrap");
		const destTrigger = ajouter(destWrap, "button", "qbd-opts-dd");
		destTrigger.type = "button";
		const destLabel = ajouter(destTrigger, "span", "qbd-opts-dd-label");
		const destChev = ajouter(destTrigger, "span", "qbd-select-chevron");
		currentHost().ui.setIcon(destChev, "chevron-down");
		const destMenu = ajouter(destWrap, "div", "qbd-opts-dd-menu is-hidden");

		const refreshDest = () => {
			const choisi = folders.find(f => f.value === folder) ?? folders[0];
			// `textContent` (via `ajouter`) : ces libellés viennent du disque.
			destLabel.replaceChildren();
			if (choisi.icon) {
				const ic = ajouter(destLabel, "span", "qbd-opts-dd-icon");
				if (choisi.color) ic.style.setProperty("--accent", choisi.color);
				currentHost().ui.setIcon(ic, choisi.icon);
			}
			ajouter(destLabel, "span", undefined, choisi.label);
			destTrigger.setAttribute("aria-expanded", destMenu.classList.contains("is-hidden") ? "false" : "true");
			for (const b of Array.from(destMenu.querySelectorAll<HTMLButtonElement>(".qbd-opts-dd-item"))) {
				const active = b.dataset.folder === folder;
				b.classList.toggle("is-active", active);
				const check = b.querySelector(".qbd-select-check");
				if (!check) continue;
				check.replaceChildren();
				if (active) currentHost().ui.setIcon(check as HTMLElement, "check");
			}
		};

		for (const f of folders) {
			const item = ajouter(destMenu, "button", "qbd-opts-dd-item");
			item.type = "button";
			item.dataset.folder = f.value;
			ajouter(item, "span", "qbd-select-check");
			if (f.icon) {
				const ic = ajouter(item, "span", "qbd-opts-dd-icon");
				if (f.color) ic.style.setProperty("--accent", f.color);
				currentHost().ui.setIcon(ic, f.icon);
			}
			const body = ajouter(item, "span", "qbd-opts-dd-body");
			ajouter(body, "span", "qbd-opts-dd-name", f.label);
			// La RACINE en sous-titre : c'est elle qui distingue deux dossiers
			// homonymes (« Generated » de Neo Quiz et de Personal).
			if (f.sub) ajouter(body, "span", "qbd-opts-dd-sub", f.sub);
			item.addEventListener("click", () => {
				folder = f.value;
				destMenu.classList.add("is-hidden");
				refreshDest();
				if (opts.onFolder) opts.onFolder(folder);
			});
		}

		destTrigger.addEventListener("click", () => {
			destMenu.classList.toggle("is-hidden");
			refreshDest();
		});
		refreshDest();
	}

	// ── Position (pattern openEffortSlider : sous l'ancre, sinon dessus) ──
	const rect = anchorEl.getBoundingClientRect();
	menuEl.style.visibility = "hidden";
	menuEl.style.top = "0px";
	menuEl.style.left = "0px";
	const mr = menuEl.getBoundingClientRect();
	const left = Math.min(Math.max(8, rect.left), window.innerWidth - mr.width - 8);
	const below = rect.bottom + 4;
	const top = (below + mr.height <= window.innerHeight - 8 || rect.top - 4 - mr.height < 8)
		? below : rect.top - 4 - mr.height;
	menuEl.style.left = left + "px";
	menuEl.style.top = top + "px";
	menuEl.style.visibility = "";

	function closeMenu(): void {
		menuEl.remove();
		openMenus.delete(closeMenu);
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", closeMenu);
	}

	function onDocDown(e: MouseEvent): void {
		const t = e.target as Node | null;
		if ((t && anchorEl.contains(t)) || (t && menuEl.contains(t))) return;
		closeMenu();
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Escape") closeMenu();
	}

	function onScroll(e: Event): void {
		const t = e.target as Node | null;
		if (t && menuEl.contains(t)) return;
		closeMenu();
	}

	openMenus.set(closeMenu, anchorEl);
	document.addEventListener("mousedown", onDocDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", closeMenu);

	return { close: closeMenu };
}

/* ── openNotePicker ───────────────────────────────────────── */

/** Ce que le picker demande d'un fichier, et rien de plus. Générique plutôt
    que `HostFile` : `onPick` rend à l'appelant l'objet QU'IL a fourni, donc
    `ai.ts` continue de recevoir ses `TFile` et de les passer à
    `vault.process`. Convertir ici violerait la règle du dépôt — seul
    `apps/obsidian/host.ts` change un `TFile` en `HostFile`. */
export interface PickableFile { path: string; basename: string; }

export interface OpenNotePickerOptions<F extends PickableFile = PickableFile> {
	/** Notes actuellement ouvertes (ordre des onglets). */
	openFiles?: F[];
	/** Toutes les notes du vault (pour la recherche). */
	allFiles?: F[];
	onPick?: (file: F) => void;
}

/*
 * openNotePicker(anchorEl, {
 *   openFiles: F[],   // notes actuellement ouvertes (ordre des onglets)
 *   allFiles: F[],    // toutes les notes du vault (pour la recherche)
 *   onPick(file)
 * })
 * Sélecteur de note (« Insérer dans une note ») : les notes OUVERTES en
 * tête, et une recherche qui fouille tout le vault en dessous.
 */
export function openNotePicker<F extends PickableFile>(anchorEl: HTMLElement, opts: OpenNotePickerOptions<F>): MenuHandle {
	if (toggleCloseForAnchor(anchorEl)) return { close() {} };
	closeAllSelects();

	const menuEl = ajouter(document.body, "div", "qbd-select-menu qbd-model-menu qbd-model-menu--searchable qbd-note-picker");
	menuEl.setAttribute("role", "listbox");

	const searchWrap = ajouter(menuEl, "div", "qbd-model-menu-search");
	const input = ajouter(searchWrap, "input", "qbd-model-menu-search-input");
	input.type = "text";
	input.placeholder = t("dashboard.select.noteSearch");
	input.spellcheck = false;
	const listEl = ajouter(menuEl, "div", "qbd-model-menu-list");

	function addFile(file: F): void {
		const b = ajouter(listEl, "button", "qbd-select-option qbd-note-picker-item");
		b.type = "button";
		b.setAttribute("role", "option");
		const ic = ajouter(b, "span", "qbd-action-menu-icon");
		currentHost().ui.setIcon(ic, "file-text");
		const body = ajouter(b, "div", "qbd-action-menu-body");
		ajouter(body, "span", "qbd-select-option-label", file.basename);
		// Dérivé du chemin plutôt que lu sur `parent` : `PickableFile` n'a pas de
		// `parent`, et à la racine `TFile.parent.path` vaut "/" (confirmé dans
		// obsidian.d.ts), que l'ancien code excluait déjà — la chaîne vide
		// produit exactement le même affichage.
		const i = file.path.lastIndexOf("/");
		const folder = i > 0 ? file.path.slice(0, i) : "";
		if (folder) ajouter(body, "span", "qbd-action-menu-sub", folder);
		b.addEventListener("click", () => {
			closeMenu();
			if (opts.onPick) opts.onPick(file);
		});
	}

	function paint(query: string): void {
		listEl.replaceChildren();
		const f = (query || "").trim().toLowerCase();
		const match = (file: F) => !f
			|| file.basename.toLowerCase().includes(f)
			|| file.path.toLowerCase().includes(f);
		const open = (opts.openFiles || []).filter(match);
		// La recherche fouille TOUT le vault ; sans requête, seules les
		// notes ouvertes sont proposées (référence : « uniquement celles
		// ouvertes, et on peut surtout chercher »).
		let rest: F[] = [];
		if (f) {
			const openPaths = new Set(open.map(x => x.path));
			rest = (opts.allFiles || []).filter(x => !openPaths.has(x.path) && match(x)).slice(0, 30);
		}
		if (open.length) {
			ajouter(listEl, "div", "qbd-note-picker-section", t("dashboard.select.noteOpen"));
			open.forEach(addFile);
		}
		if (rest.length) {
			ajouter(listEl, "div", "qbd-note-picker-section", t("dashboard.select.noteAll"));
			rest.forEach(addFile);
		}
		if (!open.length && !rest.length) {
			ajouter(listEl, "div", "qbd-model-menu-empty", f ? t("dashboard.select.noteNotFound") : t("dashboard.select.noteEmpty"));
		}
	}

	paint("");
	input.addEventListener("input", () => paint(input.value));
	input.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			if (input.value) { input.value = ""; paint(""); }
			else closeMenu();
		}
	});
	setTimeout(() => input.focus(), 0);

	// ── Position (au-dessus de l'ancre si le bas manque de place) ──
	const rect = anchorEl.getBoundingClientRect();
	menuEl.style.visibility = "hidden";
	menuEl.style.top = "0px";
	menuEl.style.left = "0px";
	const mr = menuEl.getBoundingClientRect();
	const left = Math.min(Math.max(8, rect.left), window.innerWidth - mr.width - 8);
	const below = rect.bottom + 4;
	const top = (below + mr.height <= window.innerHeight - 8 || rect.top - 4 - mr.height < 8)
		? below : rect.top - 4 - mr.height;
	menuEl.style.left = left + "px";
	menuEl.style.top = top + "px";
	menuEl.style.visibility = "";

	function closeMenu(): void {
		menuEl.remove();
		openMenus.delete(closeMenu);
		document.removeEventListener("mousedown", onDocDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", closeMenu);
	}

	function onDocDown(e: MouseEvent): void {
		const t = e.target as Node | null;
		if ((t && anchorEl.contains(t)) || (t && menuEl.contains(t))) return;
		closeMenu();
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Escape") closeMenu();
	}

	function onScroll(e: Event): void {
		const t = e.target as Node | null;
		if (t && menuEl.contains(t)) return;
		closeMenu();
	}

	openMenus.set(closeMenu, anchorEl);
	document.addEventListener("mousedown", onDocDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", closeMenu);

	return { close: closeMenu };
}

/* ── openMentionMenu ──────────────────────────────────────── */

export interface MentionMenuItem {
	label: string;
	/** Sous-titre discret : dossier parent, ou racine externe. */
	sub?: string;
	/** Nom d'icône Lucide (setIcon). */
	icon: string;
	/** Trait de séparation AVANT cette entrée (vault → racines hors vault). */
	separatorBefore?: boolean;
	onChoose: () => void;
}

export interface MentionMenuHandle extends MenuHandle {
	setItems(items: MentionMenuItem[], footer?: string): void;
	moveSelection(delta: number): void;
	/** Valide l'entrée sélectionnée. false si la liste est vide. */
	confirm(): boolean;
}

/*
 * openMentionMenu(anchorEl, onClose)
 * Menu du picker « @ ». Contrairement à openNotePicker, il n'a PAS de champ
 * de recherche et ne prend JAMAIS le focus : la frappe reste dans le
 * textarea, qui pilote le menu via setItems(). Ancré sur le composer (et
 * non sur le caret), conformément à la référence Claude Code où la liste
 * s'affiche au-dessus du prompt.
 */
export function openMentionMenu(anchorEl: HTMLElement, onClose?: () => void): MentionMenuHandle {
	closeAllSelects();

	const menuEl = ajouter(document.body, "div", "qbd-select-menu qbd-model-menu qbd-note-picker qbd-mention-menu");
	menuEl.setAttribute("role", "listbox");
	const listEl = ajouter(menuEl, "div", "qbd-model-menu-list");
	let footerEl: HTMLElement | null = null;

	let items: MentionMenuItem[] = [];
	let sel = 0;

	function paint(): void {
		listEl.replaceChildren();
		items.forEach((item, i) => {
			if (item.separatorBefore) ajouter(listEl, "div", "qbd-mention-sep");
			const b = ajouter(listEl, "button", "qbd-select-option qbd-note-picker-item");
			b.type = "button";
			b.setAttribute("role", "option");
			if (i === sel) b.classList.add("is-selected");
			const ic = ajouter(b, "span", "qbd-action-menu-icon");
			currentHost().ui.setIcon(ic, item.icon);
			const body = ajouter(b, "div", "qbd-action-menu-body");
			ajouter(body, "span", "qbd-select-option-label", item.label);
			if (item.sub) ajouter(body, "span", "qbd-action-menu-sub", item.sub);
			// mousedown, pas click : le textarea ne doit jamais perdre le focus.
			b.addEventListener("mousedown", (e) => {
				e.preventDefault();
				closeMenu();
				item.onChoose();
			});
			b.addEventListener("mouseenter", () => { sel = i; paintSelection(); });
		});
		if (!items.length) {
			ajouter(listEl, "div", "qbd-model-menu-empty", t("ai.mention.noMatch"));
		}
	}

	function paintSelection(): void {
		const opts = Array.from(listEl.querySelectorAll(".qbd-select-option"));
		opts.forEach((el, i) => el.classList.toggle("is-selected", i === sel));
		const cur = opts[sel] as HTMLElement | undefined;
		if (cur) cur.scrollIntoView({ block: "nearest" });
	}

	function position(): void {
		const rect = anchorEl.getBoundingClientRect();
		menuEl.style.visibility = "hidden";
		menuEl.style.top = "0px";
		menuEl.style.left = "0px";
		const mr = menuEl.getBoundingClientRect();
		const left = Math.min(Math.max(8, rect.left), window.innerWidth - mr.width - 8);
		// Référence : la liste s'affiche AU-DESSUS du prompt. On ne bascule
		// en dessous que si le haut manque de place.
		const above = rect.top - 4 - mr.height;
		const top = above >= 8 ? above : rect.bottom + 4;
		menuEl.style.left = left + "px";
		menuEl.style.top = top + "px";
		menuEl.style.visibility = "";
	}

	function closeMenu(): void {
		menuEl.remove();
		openMenus.delete(closeMenu);
		document.removeEventListener("mousedown", onDocDown, true);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", closeMenu);
		if (onClose) onClose();
	}

	function onDocDown(e: MouseEvent): void {
		const n = e.target as Node | null;
		if ((n && anchorEl.contains(n)) || (n && menuEl.contains(n))) return;
		closeMenu();
	}

	function onScroll(e: Event): void {
		const n = e.target as Node | null;
		if (n && menuEl.contains(n)) return;
		closeMenu();
	}

	openMenus.set(closeMenu, anchorEl);
	document.addEventListener("mousedown", onDocDown, true);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", closeMenu);

	return {
		close: closeMenu,
		setItems(next: MentionMenuItem[], footer?: string) {
			items = next;
			sel = 0;
			paint();
			if (footerEl) { footerEl.remove(); footerEl = null; }
			if (footer) footerEl = ajouter(menuEl, "div", "qbd-mention-footer", footer);
			position();
		},
		moveSelection(delta: number) {
			if (!items.length) return;
			sel = (sel + delta + items.length) % items.length;
			paintSelection();
		},
		confirm(): boolean {
			const item = items[sel];
			if (!item) return false;
			closeMenu();
			item.onChoose();
			return true;
		},
	};
}
