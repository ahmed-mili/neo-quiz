import { ItemView, Notice, TFile } from "obsidian";
import type { Plugin, WorkspaceLeaf } from "obsidian";
import { t } from "./i18n";
import { createQuizPage } from "./dashboard/detail";
import type { QuizPageHandlers } from "./dashboard/detail";
import { loadQuizDraft, saveQuizDraft } from "./dashboard/detail-io";

export const VIEW_TYPE = "quiz-blocks-builder";

/* ════════════════════════════════════════════════════════
   VUE ONGLET D'UN QUIZ

   L'éditeur en TROIS COLONNES (Questions / Éditeur / Aperçu / Code) a
   disparu le 2026-07-31 : « c'était pas une interface assez intuitive et
   simple à utiliser ». Cet onglet héberge désormais la MÊME page que le
   dashboard — questions à gauche, question courante à droite, bouton
   « Editor » qui bascule le mode — pour qu'il n'existe qu'UNE façon de
   travailler un quiz, où qu'on l'ouvre.

   Le type de vue, lui, est conservé : c'est l'identifiant que portent les
   dispositions de travail déjà enregistrées et les raccourcis de
   l'utilisateur. Le supprimer afficherait « No view of type
   quiz-blocks-builder » dans les onglets déjà ouverts.
   ════════════════════════════════════════════════════════ */
export class QuizBuilderView extends ItemView {
	private plugin: Plugin;
	private page: QuizPageHandlers | null = null;
	/** Note dont le bloc quiz-blocks est ouvert ici (null : rien encore). */
	sourceFile: TFile | null = null;
	/** Ouvrir en édition (quiz qu'on vient de créer). */
	private startEditing = false;

	constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE; }

	getDisplayText(): string {
		// getViewType() reste l'identifiant technique (jamais traduit) ;
		// getDisplayText() est le titre d'onglet, donc de l'UI. Appelé par
		// Obsidian à chaque rafraîchissement d'en-tête → langue courante.
		return this.sourceFile?.basename || t("editor.view.title");
	}

	getIcon(): string { return "graduation-cap"; }

	async onOpen(): Promise<void> {
		this.contentEl.addClass("qbd-root");
		this.contentEl.addClass("qb-tab-page");
		this.renderPage();
	}

	async onClose(): Promise<void> {
		// Écriture en attente ET écoute clavier du document : l'onglet se
		// ferme, plus personne ne les videra.
		this.page?.dispose();
		this.page = null;
		// Obsidian réutilise le contentEl entre deux vues : les classes posées
		// à l'ouverture se retirent ici, pas dans onunload.
		this.contentEl.removeClass("qbd-root");
		this.contentEl.removeClass("qb-tab-page");
		this.contentEl.empty();
	}

	/** Ouvre le quiz d'une note dans cet onglet. Le second paramètre (la
	    source du bloc) n'est plus lu — la page relit la note elle-même, par
	    la même chaîne que le dashboard — mais reste accepté : c'est la
	    signature qu'appellent le plugin et le dashboard. */
	async openQuizFile(file: TFile, _source?: string, opts: { edit?: boolean } = {}): Promise<void> {
		this.sourceFile = file;
		this.startEditing = !!opts.edit;
		this.renderPage();
		// Rafraîchit le titre de l'onglet (API interne, absente d'obsidian.d.ts).
		const leaf = this.leaf as WorkspaceLeaf & { updateHeader?(): void };
		leaf.updateHeader?.();
		this.app.workspace.trigger("layout-change");
	}

	private renderPage(): void {
		const host = this.contentEl;
		host.empty();

		const file = this.sourceFile;
		if (!file) {
			// Onglet ouvert sans quiz (commande « Ouvrir l'éditeur », ou
			// disposition restaurée) : on dit quoi faire plutôt que de montrer
			// un quiz vide qui n'irait nulle part.
			const empty = host.createDiv({ cls: "qb-tab-empty" });
			empty.createEl("h2", { text: t("editor.view.title") });
			empty.createEl("p", { text: t("editor.empty.hint") });
			return;
		}

		if (!this.page) {
			this.page = createQuizPage({ app: this.app, plugin: this.plugin });
		}
		this.page.render(host, {
			key: file.path,
			title: file.basename,
			subtitle: file.path,
			// Compte réel connu seulement après lecture ; la page l'actualise.
			questionCount: 0,
			load: () => loadQuizDraft(this.app, file.path),
			save: (draft) => saveQuizDraft(this.app, draft),
			startEditing: this.startEditing,
			// Retour = refermer l'onglet : il n'a pas d'écran parent.
			onBack: () => this.leaf.detach(),
			start: {
				label: t("dashboard.detail.play"),
				icon: "play",
				onClick: () => { void this.leaf.openFile(file); },
			},
		});
	}
}

/** Ouvre (ou révèle) l'onglet d'un quiz sur la note donnée. */
export async function openQuizTab(plugin: Plugin, file: TFile): Promise<boolean> {
	const app = plugin.app;
	const existing = app.workspace.getLeavesOfType(VIEW_TYPE);
	let leaf: WorkspaceLeaf;
	if (existing.length > 0) {
		leaf = existing[0];
	} else {
		leaf = app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE, active: true });
	}
	app.workspace.revealLeaf(leaf);
	const view = leaf.view;
	if (!(view instanceof QuizBuilderView)) {
		new Notice(t("dashboard.detail.openError"));
		return false;
	}
	await view.openQuizFile(file);
	return true;
}
