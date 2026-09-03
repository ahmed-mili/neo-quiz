import { Notice, setIcon } from "obsidian";
import { QbdModal } from "../modal-base";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import { moduleForQuiz } from "./quiz-modules";
import type { ModuleGroup, ModuleMap, ModuleOverride } from "./quiz-modules";
import { openActionMenu } from "./ui-select";
import { openColorPicker } from "./color-picker";
import { openIconPicker, DEFAULT_MODULE_ICON } from "./icon-picker";
import { MODULE_PALETTE, hashAccent } from "./module-color";
import { suggestIcons } from "./icon-suggest";

type ModuleEditState = Required<Pick<ModuleOverride, "name" | "ue">>
	& Omit<ModuleOverride, "name" | "ue">;

// Toute extension persistée doit casser tsc tant que ce reconstructeur ne la
// traite pas explicitement, sinon une simple édition effacerait le nouveau champ.
const MODULE_EDIT_HANDLED_FIELDS = {
	name: true,
	ue: true,
	color: true,
	icon: true,
	examDate: true,
} satisfies Record<keyof ModuleOverride, true>;

/** Centralise le contrat de persistance du modal pour que la date civile reste
    identique jusqu'à l'adaptateur et que son effacement retire vraiment la clé. */
export function buildModuleOverride(folder: string, state: ModuleEditState): ModuleOverride {
	void MODULE_EDIT_HANDLED_FIELDS;
	const ov: ModuleOverride = {};
	if (state.name.trim() && state.name.trim() !== folder) ov.name = state.name.trim();
	// `null` force « Sans UE », tandis qu'`undefined` conserverait l'UE de la note.
	ov.ue = state.ue;
	if (state.color) ov.color = state.color;
	if (state.icon) ov.icon = state.icon;
	if (state.examDate) ov.examDate = state.examDate;
	return ov;
}

/* ══════════════════════════════════════════════════════════
   MODULE EDIT — modal « Modifier dossier », calqué sur celui de
   StudySmarter (capture Excalidraw 2026-07-18) : nom du dossier,
   UE (leur « Matière »), pastilles de couleur. SANS le toggle
   « Rendre ce dossier publique » (exclu explicitement par Ahmed).
   AUTO-SAVE (pas de bouton Enregistrer) : tout est local, donc chaque
   changement est appliqué à l'override EN MÉMOIRE aussitôt (apply()),
   puis persisté sur disque + grille rafraîchie une seule fois à la
   fermeture (onClose) — pas de martèlement I/O pendant le drag du
   picker, où onChange émet ~60×/s. Persistance : override réglages
   (quizzesModuleOverrides) — la note de correspondance n'est JAMAIS
   réécrite par le plugin.
══════════════════════════════════════════════════════════ */

export class ModuleEditModal extends QbdModal {
	private name: string;
	private ue: string | null;
	private color: string | undefined;
	private icon: string | undefined;
	private examDate?: string;
	/** Un changement au moins a eu lieu → onClose persiste + rafraîchit. */
	private dirty = false;

	constructor(
		private ctx: DashboardCtx,
		private group: ModuleGroup,
		private map: ModuleMap,
		private onSaved: () => void
	) {
		super(ctx.app);
		this.name = group.name || group.folder;
		this.ue = group.ue;
		this.color = group.color;
		this.icon = group.icon;
		this.examDate = ctx.plugin.settings.quizzesModuleOverrides?.[group.folder]?.examDate;
	}

	/** Auto-save : reconstruit l'override depuis l'état courant, l'écrit dans
	    les settings EN MÉMOIRE (synchrone) et rafraîchit la grille AUSSITÔT —
	    la carte du dossier se recolore à chaque clic de couleur (temps réel),
	    sans attendre la fermeture. effectiveMap() relit les overrides à chaque
	    rendu, donc onSaved() reflète le changement immédiatement. La seule
	    écriture disque est différée à onClose (pas de martèlement I/O). */
	private apply(): void {
		const overrides = { ...(this.ctx.plugin.settings.quizzesModuleOverrides || {}) };
		const ov = buildModuleOverride(this.group.folder, {
			name: this.name,
			ue: this.ue,
			color: this.color,
			icon: this.icon,
			examDate: this.examDate,
		});
		overrides[this.group.folder] = ov;
		this.ctx.plugin.settings.quizzesModuleOverrides = overrides;
		this.dirty = true;
		this.onSaved();
	}

	onOpen(): void {
		this.modalEl.addClass("qbd-medit-modal");
		this.titleEl.setText(t("dashboard.quizzes.moduleEditTitle"));
		const c = this.contentEl;
		// Accent effectif (couleur choisie sinon dérivée du nom) dès l'ouverture :
		// il teinte l'aperçu d'icône ci-dessous ; paintDots() le met à jour quand
		// la couleur change.
		c.style.setProperty("--mod-color", this.color ?? hashAccent(this.group.folder));

		// ── Icône EN HAUT (au-dessus du nom, demande Ahmed 2026-07-19) : aperçu
		// carré teinté ; clic → picker avec recherche + suggestions du module ──
		c.createEl("p", { cls: "qbd-medit-label", text: t("dashboard.quizzes.moduleEditIcon") });
		const iconBtn = c.createEl("button", { cls: "qbd-medit-icon-btn" });
		iconBtn.type = "button";
		const paintIcon = () => { iconBtn.empty(); setIcon(iconBtn, this.icon ?? DEFAULT_MODULE_ICON); };
		paintIcon();
		iconBtn.addEventListener("click", () => {
			// Portalé au modal (comme le color picker) → pas de vol de focus.
			// Suggestions d'après le nom + l'UE COURANTS.
			openIconPicker(iconBtn, this.icon, (name) => { this.icon = name; paintIcon(); this.apply(); }, this.modalEl, suggestIcons(this.name, this.ue));
		});

		// ── Nom du dossier ──
		c.createEl("p", { cls: "qbd-medit-label", text: t("dashboard.quizzes.moduleEditName") });
		const nameInput = c.createEl("input", { type: "text", cls: "qbd-medit-input" });
		nameInput.value = this.name;
		nameInput.addEventListener("input", () => { this.name = nameInput.value; this.apply(); });

		// ── UE (la « Matière » de StudySmarter) ──
		c.createEl("p", { cls: "qbd-medit-label", text: t("dashboard.quizzes.moduleEditUe") });
		const ueBtn = c.createEl("button", { cls: "qbd-select qbd-medit-select" });
		ueBtn.type = "button";
		const ueLabel = ueBtn.createSpan({ cls: "qbd-select-label" });
		const ueChev = ueBtn.createSpan({ cls: "qbd-select-chevron" });
		setIcon(ueChev, "chevron-down");
		const paintUe = () => ueLabel.setText(this.ue ?? t("dashboard.quizzes.noUe"));
		paintUe();
		ueBtn.addEventListener("click", () => {
			// UE connues (note + overrides) + « Sans UE ». Le menu est portalé au
			// body (ui-select) : il flotte par-dessus le modal sans le refermer.
			const options: Array<string | null> = [...this.map.ueOrder, null];
			openActionMenu(ueBtn, options.map(ue => ({
				icon: ue === this.ue ? "check" : undefined,
				label: ue ?? t("dashboard.quizzes.noUe"),
				onClick: () => { this.ue = ue; paintUe(); this.apply(); },
			})));
		});

		// La date d'examen pilote l'horizon de rétention de l'ordonnanceur :
		// 20 à 40 % de l'échéance pour une semaine, 5 à 10 % pour un an
		// (Cepeda 2008). Vide = horizon durable, jamais deviné ailleurs.
		const dateWrap = c.createDiv();
		const dateLabel = dateWrap.createEl("label", { cls: "qbd-medit-label", text: t("dashboard.module.examDate") });
		const dateInput = dateWrap.createEl("input", { cls: "qbd-medit-input", type: "date" });
		// Le lien explicite fournit le nom accessible et rend le libellé cliquable.
		dateInput.id = "qbd-medit-exam-date";
		dateLabel.htmlFor = dateInput.id;
		dateInput.value = this.examDate ?? "";
		dateInput.addEventListener("change", () => {
			this.examDate = dateInput.value || undefined;
			this.apply();
		});
		dateWrap.createEl("p", { cls: "qbd-medit-hint", text: t("dashboard.module.examDateHint") });

		// ── Couleur (8 pastilles ; re-cliquer la pastille active la retire →
		// retour au liseré par avancement) + pastille « couleur personnalisée »
		// (roue chromatique) qui ouvre le picker recopié de neo-calendar ──
		c.createEl("p", { cls: "qbd-medit-label", text: t("dashboard.quizzes.moduleEditColor") });
		const row = c.createDiv({ cls: "qbd-medit-colors" });
		const paintDots = () => {
			row.empty();
			for (const col of MODULE_PALETTE) {
				const dot = row.createEl("button", { cls: "qbd-medit-dot" });
				dot.type = "button";
				dot.style.background = col;
				if (col === this.color) setIcon(dot, "check");
				dot.addEventListener("click", () => {
					this.color = this.color === col ? undefined : col;
					paintDots();
					this.apply();
				});
			}
			// 9e cercle : couleur personnalisée. Roue chromatique au repos ;
			// quand une couleur HORS palette est active, il la porte + check.
			const custom = row.createEl("button", { cls: "qbd-medit-dot qbd-medit-dot--custom" });
			custom.type = "button";
			custom.setAttribute("aria-label", t("dashboard.quizzes.moduleEditCustomColor"));
			custom.title = t("dashboard.quizzes.moduleEditCustomColor");
			const isCustom = !!this.color && !MODULE_PALETTE.includes(this.color);
			if (isCustom && this.color) {
				custom.style.background = this.color;
				setIcon(custom, "check");
			}
			custom.addEventListener("click", () => {
				// Aperçu live : onChange arrive en continu pendant le drag ;
				// le repaint recrée les pastilles, le picker (fixed) reste.
				// Portalé au MODAL (this.modalEl), pas au body : sinon le focus
				// trap du modal ramène le focus de l'input hex vers le champ
				// « nom » dès qu'on clique dedans (bug de sélection).
				openColorPicker(custom, this.color ?? MODULE_PALETTE[0], (hex) => {
					this.color = hex;
					paintDots();
					this.apply();
				}, this.modalEl);
			});
			// La couleur courante teinte aussi l'aperçu d'icône (var --mod-color,
			// comme la carte). Défaut = accent quand aucune couleur n'est choisie.
			// L'aperçu d'icône montre l'accent EFFECTIF (couleur choisie sinon
			// dérivée du nom) — WYSIWYG avec la carte.
			c.style.setProperty("--mod-color", this.color ?? hashAccent(this.group.folder));
		};
		paintDots();
		// Pas de bouton « Enregistrer » : auto-save (apply() sur chaque
		// changement) + flush à onClose. Fermeture par clic-dehors / Échap.
	}

	onClose(): void {
		// La grille a déjà été rafraîchie en direct par apply() ; il ne reste
		// qu'à flusher les settings sur disque UNE fois (pas 60×/s pendant le
		// drag du picker). saveSettings ne s'appelle que si un changement a eu
		// lieu.
		if (this.dirty) this.ctx.plugin.saveSettings().catch(() => {});
		this.contentEl.empty();
	}
}

/* ── « New folder » — le bouton pilule du header (l'équivalent de « Create
   Study Set » chez StudySmarter, libellé adapté). Crée un VRAI dossier du
   vault sous le parent commun des modules existants, et le déclare dans les
   overrides pour que sa carte (vide) apparaisse immédiatement. ── */

/** Parent le plus fréquent des dossiers de module (déduit des chemins de
    quiz) ; "" = racine du vault si rien n'est déductible. */
export function commonModuleParent(quizzes: QuizIndexEntry[], map: ModuleMap): string {
	const counts = new Map<string, number>();
	for (const q of quizzes) {
		const folder = moduleForQuiz(q.path, map).folder;
		const segs = q.path.split("/").filter(Boolean);
		const idx = segs.indexOf(folder);
		if (idx < 0) continue;
		const prefix = segs.slice(0, idx).join("/");
		counts.set(prefix, (counts.get(prefix) || 0) + 1);
	}
	let best = "", bestN = 0;
	for (const [prefix, n] of counts) if (n > bestN) { best = prefix; bestN = n; }
	return best;
}

export class NewFolderModal extends QbdModal {
	private name = "";

	constructor(
		private ctx: DashboardCtx,
		private map: ModuleMap,
		private quizzes: QuizIndexEntry[],
		private onCreated: () => void
	) {
		super(ctx.app);
	}

	onOpen(): void {
		this.modalEl.addClass("qbd-medit-modal");
		this.titleEl.setText(t("dashboard.quizzes.newFolderTitle"));
		const c = this.contentEl;
		c.createEl("p", { cls: "qbd-medit-label", text: t("dashboard.quizzes.moduleEditName") });
		const input = c.createEl("input", { type: "text", cls: "qbd-medit-input" });
		input.addEventListener("input", () => { this.name = input.value; });
		window.setTimeout(() => input.focus(), 0);

		const save = c.createEl("button", { cls: "qbd-medit-save", text: t("dashboard.quizzes.newFolderCta") });
		save.addEventListener("click", () => { void this.create(); });
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") void this.create(); });
	}

	private async create(): Promise<void> {
		const name = this.name.trim().replace(/[\\/:*?"<>|]/g, "-");
		if (!name) return;
		const parent = commonModuleParent(this.quizzes, this.map);
		const path = parent ? `${parent}/${name}` : name;
		try {
			if (!this.ctx.app.vault.getAbstractFileByPath(path)) {
				await this.ctx.app.vault.createFolder(path);
			}
		} catch {
			new Notice(t("dashboard.quizzes.newFolderError"));
			return;
		}
		// Déclaré en override : la carte du dossier (0 quiz) apparaît tout de
		// suite, sans attendre qu'un premier quiz y soit créé.
		const overrides = { ...(this.ctx.plugin.settings.quizzesModuleOverrides || {}) };
		if (!overrides[name]) overrides[name] = { name };
		this.ctx.plugin.settings.quizzesModuleOverrides = overrides;
		this.ctx.plugin.saveSettings().catch(() => {});
		this.close();
		this.onCreated();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
