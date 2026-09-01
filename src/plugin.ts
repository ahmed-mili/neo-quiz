import {
	MarkdownRenderChild,
	MarkdownView,
	Notice,
	Platform,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
	TFile,
	TFolder,
} from "obsidian";
import type {
	App,
	ButtonComponent,
	MarkdownPostProcessorContext,
	WorkspaceLeaf,
} from "obsidian";

import { parseQuizSource, renderInteractiveQuiz } from "./engine";
import { QuizBuilderView, VIEW_TYPE } from "./editor";
import { QUIZ_BLOCK_RE, findQuizModeConfigIndex } from "./quiz-utils";
import { resolveQuizSourceRef } from "./quiz-source-ref";
import { deriveQuizNoteName, buildQuizRefBlockContent, isLessonNoteContent } from "./quiz-from-lesson";
import { QuizDashboardView, VIEW_TYPE_DASHBOARD } from "./dashboard";
import { createScanner } from "./dashboard/scanner";
import type { Scanner } from "./dashboard/scanner";
import { createStatsStore } from "./dashboard/stats-store";
import type { StatsStore, QuizStatRecord } from "./dashboard/stats-store";
import type { ModuleOverride } from "./dashboard/quiz-modules";
import * as voiceInstall from "./dashboard/voice-install";
import type { VoiceBackend, VoiceModelId, VoiceLang } from "./dashboard/voice-install";
import * as aiProviders from "./dashboard/ai-providers";
import type { OllamaCatalogEntry } from "./dashboard/ai-providers";
import type { AiUsageEntry } from "./dashboard/ai-usage";
import { formatHotkey, eventToHotkey } from "./hotkey-format";
import type { Hotkey } from "./hotkey-format";
import { closeAllSelects } from "./dashboard/ui-select";
import { normalizeExternalRoot } from "./dashboard/file-sources";
import { t, setLanguage, langSetting } from "./i18n";
import type { LangSetting } from "./i18n";

const PLUGIN_ID = "quiz-blocks";
const PLUGIN_NAME = "Quiz Blocks";
const QUIZ_BLOCK_LANGUAGE = "quiz-blocks";

/** Forme complète des réglages persistés du plugin (source unique désormais que
 *  plugin.js est converti). Le sous-ensemble « IA/dictée » est réexposé aux vues
 *  via `AiSettings` (types/dashboard-ctx.ts) ; `quizStats` via `StatsStorePlugin`. */
interface QuizBlocksSettings {
	/** Langue de l'INTERFACE. « auto » = celle d'Obsidian. Sans effet sur la
	 *  langue des quiz générés (le modèle suit celle de la demande). */
	language: LangSetting;
	enableCodeHighlighting: boolean;
	quizStats: Record<string, QuizStatRecord>;
	aiProvider: string;
	aiModel: string;
	aiEffort: string;
	aiCodexFast: boolean;
	aiOllamaUrl: string;
	aiOllamaCloudKey: string;
	// null → sélection/repli par défaut (sentinelle runtime, cf. resolveOllamaSelection / getOllamaCatalog).
	aiOllamaModels: string[] | null;
	aiOllamaCatalog: OllamaCatalogEntry[] | null;
	/** Journal des générations IA (tokens, coût, durée) — cf. dashboard/ai-usage.ts. */
	aiUsageLog: AiUsageEntry[];
	/** Lire l'usage de l'ABONNEMENT auprès du CLI/compte du fournisseur (opt-in). */
	aiUsageLimitsEnabled: boolean;
	hotkeyAddFiles: Hotkey;
	hotkeyAddNotes: Hotkey;
	/** Dossiers hors vault proposés par le picker « @ » (desktop uniquement). */
	aiMentionExtraFolders: string[];
	/** Chemins COMPLETS des groupes DÉPLIÉS dans « Mes quiz » (dossiers, et
	    clés préfixées « recent: »/« type: » pour les deux autres axes). État
	    d'interface, pas une préférence : aucune section dans l'onglet de
	    réglages. Seuls les DÉPLIÉS sont listés (replié = défaut) : à 200 quiz,
	    tout déplier d'office reproduit le mur qu'on cherche à éviter (cf.
	    défaut n°1 relevé par Ahmed à l'écran, 2026-07-17). */
	quizzesExpandedFolders: string[];
	/** Axe de regroupement de « Mes quiz ». Défaut « module » (cartes par module,
	    cf. spec). « ue »/« recent »/« type » sont les axes ajoutés. */
	quizzesGrouping: "module" | "ue" | "recent" | "type";
	/** Note de correspondance UE → module (encadrés `[!portals]`). Nom de
	    linkpath (résolu comme un lien Obsidian), défaut « Dashboard ». Absente
	    ou sans encadré → cartes au nom de dossier, sans UE (dégradation propre). */
	quizzesModuleMapNote: string;
	/** DOSSIERS (clé `folder` de module) archivés via le menu ⋯ d'une carte de
	    dossier : leurs quiz sont masqués partout, le dossier ne revient que
	    comme CARTE dans la section « Archivés » de « Mes quiz ». L'archivage
	    n'existe QU'AU niveau dossier (décision Ahmed 2026-07-19 — jamais de
	    quiz archivé individuellement). */
	quizzesArchivedFolders: string[];
	/** Overrides du modal « Modifier dossier » (nom / UE / couleur par module),
	    appliqués PAR-DESSUS la note de correspondance. Cf. quiz-modules.ts. */
	quizzesModuleOverrides: Record<string, ModuleOverride>;
	voiceEnabled: boolean;
	voiceBackend: VoiceBackend;
	voiceModel: VoiceModelId;
	voiceLang: VoiceLang;
	// ── Clés héritées supprimées à la migration (loadSettings) : déclarées
	//    optionnelles uniquement pour autoriser `in`/`delete` sur d'anciennes
	//    données persistées. Jamais lues comme valeurs. ──
	enableDebugLogs?: unknown;
	aiCompatibleUrl?: unknown;
	aiApiKey?: unknown;
	quizzesArchived?: unknown;
}

const DEFAULT_SETTINGS: QuizBlocksSettings = {
	// Défaut « auto » : l'anglais s'applique de lui-même hors Obsidian français
	// — un utilisateur de la liste communautaire n'a rien à régler.
	language: "auto",
	enableCodeHighlighting: true,
	quizStats: {},
	aiProvider: "",
	aiModel: "",
	aiEffort: "high",
	// Mode Fast de Codex (service tier « priority », 1.5x speed) — l'éclair
	// du popover effort ChatGPT. Ignoré si le modèle ne l'expose pas.
	aiCodexFast: false,
	aiOllamaUrl: "http://localhost:11434",
	aiOllamaCloudKey: "",
	// Modèles Ollama affichés dans le menu (ordre réglable, max 7) : les
	// OLLAMA_PRIMARY_COUNT premiers = liste principale, le reste = « Plus de
	// modèles ». null → sélection par défaut (cf. aiProviders.resolveOllamaSelection).
	aiOllamaModels: null,
	// Cache du catalogue cloud récupéré de ollama.com ([{value,label}]) : liste
	// des modèles récents proposés à l'ajout. null → repli embarqué.
	aiOllamaCatalog: null,
	// Journal d'usage : purement informatif, borné à 300 entrées (ai-usage.ts).
	aiUsageLog: [],
	// Désactivé par défaut : lire les quotas du compte suppose d'ouvrir le
	// fichier de session du CLI installé — jamais sans demande explicite.
	aiUsageLimitsEnabled: false,
	// ── Raccourcis du composer IA (menu « + ») — actifs quand la vue
	// dashboard a le focus, affichés en hint dans le menu, modifiables
	// dans les réglages (demande Ahmed, maquette 2026-07-11 231626).
	// Ctrl+U = le raccourci de claude.ai pour « Ajouter des fichiers »
	// (captures Ahmed 2026-07-11 2357xx) — et Ctrl+F reste le réflexe
	// « recherche » partout ailleurs.
	hotkeyAddFiles: { modifiers: ["Mod"], key: "u" },
	hotkeyAddNotes: { modifiers: ["Mod"], key: "e" },
	// Vide par défaut : le « @ » se limite au vault tant qu'Ahmed n'ajoute rien.
	aiMentionExtraFolders: [],
	// Vide : au premier usage, tout est replié — la structure reste visible
	// (2 titres, pas un mur de cartes) et un clic déplie ce qu'on veut voir.
	quizzesExpandedFolders: [],
	// « module » : le défaut prévisible — une carte par module, cf. spec.
	quizzesGrouping: "module",
	quizzesModuleMapNote: "Dashboard",
	quizzesArchivedFolders: [],
	quizzesModuleOverrides: {},
	// ── Saisie vocale (dictée locale whisper.cpp) — opt-in complet.
	// Spec : docs/superpowers/specs/2026-07-10-voice-input-design.md
	voiceEnabled: false,
	voiceBackend: "cpu",      // "cpu" | "cuda"
	voiceModel: "small-q5_1", // cf. voice-install.js MODELS
	voiceLang: "fr",          // "fr" | "auto" | "en"
};

interface Logger {
	debug(...args: unknown[]): void;
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

function createLogger(): Logger {
	return {
		debug(...args: unknown[]): void {
			console.debug(`[${PLUGIN_ID}]`, ...args);
		},
		info(...args: unknown[]): void {
			console.log(`[${PLUGIN_ID}]`, ...args);
		},
		warn(...args: unknown[]): void {
			console.warn(`[${PLUGIN_ID}]`, ...args);
		},
		error(...args: unknown[]): void {
			console.error(`[${PLUGIN_ID}]`, ...args);
		}
	};
}

/** API interne non publique d'Obsidian (`app.setting`) : ouvre la fenêtre de
 *  réglages et navigue vers l'onglet « Raccourcis ». */
interface HotkeysSettingTab {
	searchComponent?: { setValue(value: string): void };
	updateHotkeyVisibility?: () => void;
}
interface AppSettingApi {
	open(): void;
	openTabById(id: string): void;
	activeTab: HotkeysSettingTab | null;
}

/** Vue dashboard exposant le re-bind des raccourcis du composer (méthode custom
 *  de QuizDashboardView, absente de l'API publique `View`). */
interface DashboardHotkeyRebindable {
	bindComposerHotkeys?: () => void;
}

/** Vue dashboard exposant son re-rendu (utilisé au changement de langue). */
interface DashboardRefreshable {
	renderSidebar?: () => void;
	renderCurrentView?: () => void;
}

/** Éditeur exposant l'ouverture d'un fichier quiz (méthode custom greffée sur
 *  QuizBuilderView, absente de l'API publique `View`). */
interface QuizFileOpenable {
	openQuizFile?: (file: TFile, source: string) => Promise<void>;
}

/** Sous-ensemble de l'API CodeMirror 5 exposée en global (`window.CodeMirror`)
 *  par le mode Source d'Obsidian — non typée dans l'API publique. */
interface CodeMirrorGlobal {
	defineMode(name: string, factory: (config: Record<string, unknown>) => unknown): void;
	getMode(config: unknown, spec: unknown): unknown;
}

interface TutorialLink {
	label: string;
	url: string;
}
interface TutorialSection {
	heading: string;
	text: string;
	link: TutorialLink | null;
}
interface TutorialDef {
	title: string;
	sections: TutorialSection[];
	warning?: string;
	docsLink?: TutorialLink;
	tips?: string[];
}

/** Tutoriels par fournisseur. FONCTION, jamais constante : les libellés sont
 *  résolus par t() À L'APPEL (depuis display()). Une constante top-level serait
 *  évaluée au chargement du module et figerait la langue du démarrage —
 *  changer de langue n'aurait alors aucun effet sur ce bloc.
 *  Commandes shell et URL restent en dur : ce ne sont pas des libellés. */
function buildTutorials(): Record<string, TutorialDef> {
	return {
		"claude-code": {
			title: t("plugin.tutorial.claude.title"),
			sections: [
				{
					heading: t("plugin.tutorial.claude.s1.heading"),
					text: t("plugin.tutorial.claude.s1.text"),
					link: { label: t("plugin.tutorial.claude.s1.link"), url: "https://claude.com/claude-code" }
				},
				{
					heading: t("plugin.tutorial.claude.s2.heading"),
					text: t("plugin.tutorial.claude.s2.text"),
					link: null
				},
				{
					heading: t("plugin.tutorial.claude.s3.heading"),
					text: t("plugin.tutorial.claude.s3.text"),
					link: null
				}
			],
			warning: t("plugin.tutorial.claude.warning"),
			docsLink: { label: t("plugin.tutorial.claude.docs"), url: "https://code.claude.com/docs" }
		},
		codex: {
			title: t("plugin.tutorial.codex.title"),
			sections: [
				{
					heading: t("plugin.tutorial.codex.s1.heading"),
					text: t("plugin.tutorial.codex.s1.text"),
					link: { label: t("plugin.tutorial.codex.s1.link"), url: "https://learn.chatgpt.com/docs/codex/cli#getting-started" }
				},
				{
					heading: t("plugin.tutorial.codex.s2.heading"),
					text: t("plugin.tutorial.codex.s2.text"),
					link: null
				},
				{
					heading: t("plugin.tutorial.codex.s3.heading"),
					text: t("plugin.tutorial.codex.s3.text"),
					link: null
				}
			],
			warning: t("plugin.tutorial.codex.warning"),
			docsLink: { label: t("plugin.tutorial.codex.docs"), url: "https://learn.chatgpt.com/docs/codex/cli" }
		},
		ollama: {
			title: t("plugin.tutorial.ollama.title"),
			sections: [
				{
					heading: t("plugin.tutorial.ollama.s1.heading"),
					text: t("plugin.tutorial.ollama.s1.text"),
					link: { label: t("plugin.tutorial.ollama.s1.link"), url: "https://ollama.com/download" }
				},
				{
					heading: t("plugin.tutorial.ollama.s2a.heading"),
					text: t("plugin.tutorial.ollama.s2a.text"),
					link: { label: t("plugin.tutorial.ollama.s2a.link"), url: "https://ollama.com/search?c=cloud" }
				},
				{
					heading: t("plugin.tutorial.ollama.s2b.heading"),
					text: t("plugin.tutorial.ollama.s2b.text"),
					link: { label: t("plugin.tutorial.ollama.s2b.link"), url: "https://ollama.com/search" }
				},
				{
					heading: t("plugin.tutorial.ollama.s3.heading"),
					text: t("plugin.tutorial.ollama.s3.text"),
					link: null
				}
			],
			warning: t("plugin.tutorial.ollama.warning"),
			docsLink: { label: t("plugin.tutorial.ollama.docs"), url: "https://github.com/ollama/ollama" },
			tips: [
				t("plugin.tutorial.ollama.tip1"),
				t("plugin.tutorial.ollama.tip2"),
				t("plugin.tutorial.ollama.tip3")
			]
		}
	};
}

class QuizBlocksSettingTab extends PluginSettingTab {
	plugin: InteractiveQuizPlugin;

	constructor(app: App, plugin: InteractiveQuizPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: PLUGIN_NAME });

		containerEl.createEl("p", {
			text: t("plugin.intro"),
			cls: "setting-item-description"
		});

		// Langue de l'interface — en tête : c'est le réglage qui change tout ce
		// qui est affiché en dessous.
		new Setting(containerEl)
			.setName(t("settings.language.name"))
			.setDesc(t("settings.language.desc"))
			.addDropdown(dropdown => {
				dropdown.addOption("auto", t("settings.language.auto"));
				dropdown.addOption("en", t("settings.language.en"));
				dropdown.addOption("fr", t("settings.language.fr"));
				dropdown.setValue(langSetting())
					.onChange(async (value) => {
						this.plugin.settings.language = value as LangSetting;
						await this.plugin.saveSettings();
						// applyLanguage retraduit TOUT ce qui est déjà affiché :
						// commandes de la palette, tooltip du ribbon et vues
						// ouvertes. Puis on redessine ces réglages eux-mêmes.
						this.plugin.applyLanguage(this.plugin.settings.language);
						this.display();
					});
			});

		containerEl.createEl("h3", { text: t("plugin.types.heading") });

		const typesEl = containerEl.createEl("ul");
		typesEl.createEl("li", { text: t("plugin.types.single") });
		typesEl.createEl("li", { text: t("plugin.types.multiple") });
		typesEl.createEl("li", { text: t("plugin.types.text") });
		typesEl.createEl("li", { text: t("plugin.types.ordering") });
		typesEl.createEl("li", { text: t("plugin.types.matching") });

		containerEl.createEl("h3", { text: t("plugin.example.heading") });

		// Exemple de FORMAT de données : jamais traduit, c'est ce que
		// l'utilisateur colle tel quel dans sa note.
		const exampleCode = `[
  {
    title: "Question 1",
    prompt: "What is 2 + 2?",
    options: ["3", "4", "5"],
    correctIndex: 1
  }
]`;

		const codeWrap = containerEl.createDiv({
			cls: "quiz-blocks-settings-code-block markdown-rendered"
		});

		const codeHeader = codeWrap.createDiv({
			cls: "quiz-blocks-settings-code-header"
		});

		codeHeader.createSpan({
			text: "quiz-blocks",
			cls: "quiz-blocks-settings-code-lang"
		});

		const copyBtn = codeHeader.createEl("button", {
			cls: "clickable-icon extra-setting-button quiz-blocks-settings-copy-btn"
		});

		copyBtn.setAttr("type", "button");
		copyBtn.setAttr("aria-label", t("plugin.example.copy"));
		copyBtn.setAttr("title", t("plugin.example.copy"));

		setIcon(copyBtn, "copy");

		const pre = codeWrap.createEl("pre", {
			cls: "quiz-blocks-settings-code-pre"
		});

		pre.createEl("code", {
			text: exampleCode,
			cls: "language-quiz-blocks"
		});

		copyBtn.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(
					"```quiz-blocks\n" + exampleCode + "\n```"
				);

				setIcon(copyBtn, "check");

				window.setTimeout(() => {
					setIcon(copyBtn, "copy");
				}, 1200);
			} catch (error) {
				console.error("[quiz-blocks] copy failed", error);
				new Notice(t("plugin.example.copyFailed"));
			}
		});

		containerEl.createEl("h3", { text: t("plugin.notes.heading") });

		const notesEl = containerEl.createEl("ul");
		notesEl.createEl("li", { text: t("plugin.notes.json5") });
		notesEl.createEl("li", { text: t("plugin.notes.features") });
		notesEl.createEl("li", { text: t("plugin.notes.rendering") });

		// ─── Available Commands Section ───
		containerEl.createEl("h3", { text: t("plugin.commands.heading") });

		// `id` = identifiant technique de la commande (persisté dans les hotkeys
		// de l'utilisateur) : jamais traduit. Les raccourcis affichés sont les
		// défauts déclarés dans onload().
		const commandsInfo = [
			{
				id: "open-quiz-builder",
				name: t("plugin.command.openEditor.name"),
				hotkey: "Ctrl+Shift+E",
				desc: t("plugin.command.openEditor.desc")
			},
			{
				id: "open-quiz-from-active-note",
				name: t("plugin.command.openFromNote.name"),
				hotkey: "Ctrl+Shift+Q",
				desc: t("plugin.command.openFromNote.desc")
			}
		];

		// Tableau des commandes
		const commandsTable = containerEl.createDiv({ cls: "qb-commands-table" });
		commandsTable.style.cssText = "margin: 1em 0; border: 1px solid var(--background-modifier-border); border-radius: 8px; overflow: hidden;";

		for (const cmd of commandsInfo) {
			const row = commandsTable.createDiv({ cls: "qb-command-row" });
			row.style.cssText = "display: flex; align-items: center; padding: 0.75em 1em; border-bottom: 1px solid var(--background-modifier-border); background: var(--background-secondary);";

			const infoDiv = row.createDiv({ cls: "qb-command-info" });
			infoDiv.style.cssText = "flex: 1; min-width: 0;";
			infoDiv.createDiv({ cls: "qb-command-name", text: cmd.name }).style.cssText = "font-weight: 600; color: var(--text-normal); margin-bottom: 0.25em;";
			infoDiv.createDiv({ cls: "qb-command-desc", text: cmd.desc }).style.cssText = "font-size: 0.85em; color: var(--text-muted);";

			const hotkeyDiv = row.createDiv({ cls: "qb-command-hotkey" });
			hotkeyDiv.style.cssText = "display: flex; align-items: center; gap: 0.5em; margin-left: 1em;";

			// Afficher le raccourci par défaut
			const hotkeyBadge = hotkeyDiv.createSpan({ cls: "qb-hotkey-badge", text: cmd.hotkey });
			hotkeyBadge.style.cssText = "font-family: var(--font-monospace); font-size: 0.75em; padding: 0.25em 0.5em; background: var(--interactive-accent); color: var(--text-on-accent); border-radius: 4px; white-space: nowrap;";
		}

		// Supprimer la dernière bordure
		const rows = commandsTable.querySelectorAll<HTMLElement>('.qb-command-row');
		if (rows.length > 0) {
			rows[rows.length - 1].style.borderBottom = 'none';
		}

		// Bouton unique en bas
		const buttonContainer = containerEl.createDiv({ cls: "qb-config-button-container" });
		buttonContainer.style.cssText = "margin-top: 1.5em; text-align: center;";

		const configButton = buttonContainer.createEl("button", { cls: "mod-cta" });
		configButton.textContent = t("plugin.commands.configure");
		configButton.style.cssText = "padding: 0.75em 1.5em; font-size: 1em;";
		configButton.addEventListener("click", () => {
			const settingApi = (this.app as unknown as { setting: AppSettingApi }).setting;
			settingApi.open();
			settingApi.openTabById('hotkeys');
			const tab = settingApi.activeTab;
			if (tab && tab.searchComponent) {
				tab.searchComponent.setValue('quiz blocks');
				if (tab.updateHotkeyVisibility) {
					tab.updateHotkeyVisibility();
				}
			}
		});

		// Note explicative
		const noteEl = containerEl.createEl("p", { cls: "setting-item-description" });
		noteEl.textContent = t("plugin.commands.configureNote");
		noteEl.style.cssText = "text-align: center; margin-top: 0.75em; font-style: italic;";

		// ─── AI Settings ───
		containerEl.createEl("h3", { text: t("plugin.ai.heading") });

		containerEl.createEl("p", {
			text: t("plugin.ai.intro"),
			cls: "setting-item-description"
		});

		const TUTORIALS = buildTutorials();

		/* Usage de l'ABONNEMENT — opt-in explicite.
		   Les tokens d'une génération sont toujours comptés (le fournisseur les
		   renvoie avec sa réponse) ; ce réglage-ci n'ouvre QUE la lecture des
		   quotas du compte, qui suppose d'aller chercher la session du CLI
		   installé. Desktop uniquement : sans accès fichier, rien à lire. */
		if (Platform.isDesktopApp) {
			new Setting(containerEl)
				.setName(t("plugin.ai.usageLimits.name"))
				.setDesc(t("plugin.ai.usageLimits.desc"))
				.addToggle(toggle => toggle
					.setValue(!!this.plugin.settings.aiUsageLimitsEnabled)
					.onChange(async (value) => {
						this.plugin.settings.aiUsageLimitsEnabled = value;
						await this.plugin.saveSettings();
					}));
		}

		// Provider dropdown
		new Setting(containerEl)
			.setName(t("plugin.ai.provider.name"))
			.setDesc(t("plugin.ai.provider.desc"))
			.addDropdown(dropdown => {
				dropdown.addOption("", t("plugin.ai.provider.none"));
				for (const p of aiProviders.PROVIDERS) {
					dropdown.addOption(p.id, p.name + (p.sub ? " — " + p.sub : ""));
				}
				dropdown.setValue(this.plugin.settings.aiProvider || "")
					.onChange(async (value) => {
						this.plugin.settings.aiProvider = value;
						// Reset model + effort to the new provider's defaults
						const prov = aiProviders.getProvider(value);
						this.plugin.settings.aiModel = value ? prov.defaultModel : "";
						if (value) this.plugin.settings.aiEffort = aiProviders.getDefaultEffort(value);
						await this.plugin.saveSettings();
						// Re-render settings but preserve scroll position
						const scrollTop = containerEl.closest(".modal-content")?.scrollTop ?? 0;
						this.display();
						requestAnimationFrame(() => {
							const modal = containerEl.closest(".modal-content");
							if (modal) modal.scrollTop = scrollTop;
						});
					});
			});

		const currentProvider = this.plugin.settings.aiProvider || "";

		// Model dropdown (provider-specific) — masqué tant qu'aucun
		// fournisseur n'est choisi
		if (currentProvider) {
			const models = currentProvider === "claude-code" ? aiProviders.getClaudeModels() : aiProviders.getDefaultModels(currentProvider);

			const currentModel = currentProvider === "claude-code"
				? aiProviders.resolveClaudeModel(this.plugin.settings.aiModel || models[0].value)
				: (this.plugin.settings.aiModel || models[0].value);

			new Setting(containerEl)
				.setName(t("plugin.ai.model.name"))
				.setDesc(currentProvider === "ollama"
					? t("plugin.ai.model.descOllama")
					: currentProvider === "codex"
					? t("plugin.ai.model.descCodex")
					: t("plugin.ai.model.descClaude"))
				.addDropdown(dropdown => {
					for (const m of models) {
						dropdown.addOption(m.value, m.label + (m.hint ? " (" + m.hint + ")" : ""));
					}
					// If current model is not in the list, add it as custom
					if (!models.find(m => m.value === currentModel)) {
						dropdown.addOption(currentModel, t("plugin.ai.model.custom", { model: currentModel }));
					}
					dropdown.setValue(currentModel);
					dropdown.onChange(async (value) => {
						this.plugin.settings.aiModel = value;
						await this.plugin.saveSettings();
					});
				});
		}

		// Ollama URL (local only)
		if (currentProvider === "ollama") {
			new Setting(containerEl)
				.setName(t("plugin.ollama.url.name"))
				.setDesc(t("plugin.ollama.url.desc"))
				.addText(text => text
					.setPlaceholder("http://localhost:11434")
					.setValue(this.plugin.settings.aiOllamaUrl || "http://localhost:11434")
					.onChange(async (value) => {
						this.plugin.settings.aiOllamaUrl = value;
						await this.plugin.saveSettings();
					}));

			// Modèles affichés dans le menu (sélection + ordre réglable, façon
			// claude.ai) : les N premiers = liste principale, le reste = flyout
			// « Plus de modèles ». Glisser-déposer pour réordonner.
			const MAX = aiProviders.OLLAMA_MAX_MODELS;
			const VISIBLE = aiProviders.OLLAMA_VISIBLE_COUNT;
			const getCatalog = () => aiProviders.getOllamaCatalog(this.plugin.settings.aiOllamaCatalog);
			const getSel = () => aiProviders.resolveOllamaSelection(this.plugin.settings.aiOllamaModels, getCatalog()).map(m => m.value);
			const saveSel = async (arr: string[]) => {
				this.plugin.settings.aiOllamaModels = arr.slice(0, MAX);
				await this.plugin.saveSettings();
			};

			const setting = new Setting(containerEl)
				.setName(t("plugin.ollama.models.name"))
				.setDesc(t("plugin.ollama.models.desc", { visible: VISIBLE, max: MAX }));
			setting.settingEl.style.display = "block";
			// Bouton « rafraîchir » : récupère le catalogue récent depuis ollama.com.
			setting.addExtraButton(b => b
				.setIcon("refresh-cw")
				.setTooltip(t("plugin.ollama.models.refresh"))
				.onClick(async () => {
					b.setDisabled(true);
					try {
						const cat = await aiProviders.fetchOllamaCloudCatalog();
						this.plugin.settings.aiOllamaCatalog = cat;
						await this.plugin.saveSettings();
						new Notice(t("plugin.ollama.models.refreshed", { count: cat.length }));
					} catch (e) {
						new Notice(t("plugin.ollama.models.refreshFailed"));
					}
					b.setDisabled(false);
					render();
				}));
			const listEl = setting.controlEl.createDiv({ cls: "qbd-model-manager" });
			setting.controlEl.style.width = "100%";

			const render = () => {
				listEl.empty();
				const catalog = getCatalog();
				const sel = getSel();
				sel.forEach((val, idx) => {
					const meta = aiProviders.getOllamaModelMeta(val, catalog);
					if (idx === VISIBLE) listEl.createDiv({ cls: "qbd-model-manager-sep", text: t("plugin.ollama.models.scrollSep") });
					const row = listEl.createDiv({ cls: "qbd-model-manager-row" });
					row.setAttribute("draggable", "true");
					const handle = row.createSpan({ cls: "qbd-model-manager-handle" });
					setIcon(handle, "grip-vertical");
					const icon = row.createSpan({ cls: "qbd-model-manager-icon" });
					setIcon(icon, meta.cloud ? "cloud" : "hard-drive");
					row.createSpan({ cls: "qbd-model-manager-label", text: meta.label });
					const rm = row.createEl("button", { cls: "qbd-model-manager-remove" });
					setIcon(rm, "x");
					rm.setAttribute("aria-label", t("plugin.ollama.models.remove"));
					rm.addEventListener("click", async () => {
						const a = getSel(); a.splice(idx, 1); await saveSel(a); render();
					});
					row.addEventListener("dragstart", (e) => {
						e.dataTransfer!.setData("text/plain", String(idx));
						e.dataTransfer!.effectAllowed = "move";
						row.classList.add("is-dragging");
					});
					row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
					row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("is-drop-target"); });
					row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
					row.addEventListener("drop", async (e) => {
						e.preventDefault(); row.classList.remove("is-drop-target");
						const from = parseInt(e.dataTransfer!.getData("text/plain"), 10);
						if (isNaN(from) || from === idx) return;
						const a = getSel();
						const [moved] = a.splice(from, 1);
						a.splice(idx, 0, moved);
						await saveSel(a); render();
					});
				});
				if (sel.length >= MAX) {
					listEl.createDiv({ cls: "qbd-model-manager-note", text: t("plugin.ollama.models.maxNote", { max: MAX }) });
				} else {
					const avail = catalog.filter(m => !sel.includes(m.value));
					if (avail.length) {
						const addWrap = listEl.createDiv({ cls: "qbd-model-manager-add" });
						addWrap.createSpan({ cls: "qbd-model-manager-add-label", text: t("plugin.ollama.models.addLabel") });
						avail.forEach(m => {
							const chip = addWrap.createEl("button", { cls: "qbd-model-manager-chip" });
							const ci = chip.createSpan({ cls: "qbd-model-manager-chip-icon" });
							setIcon(ci, "plus");
							chip.createSpan({ text: m.label });
							chip.addEventListener("click", async () => {
								const a = getSel();
								if (a.length < MAX) { a.push(m.value); await saveSel(a); render(); }
							});
						});
					}
					// Ajout manuel : n'importe quel tag de modèle (futur-proof).
					const manualWrap = listEl.createDiv({ cls: "qbd-model-manager-manual" });
					const input = manualWrap.createEl("input", { cls: "qbd-model-manager-input", attr: { type: "text", placeholder: t("plugin.ollama.models.manualPlaceholder") } });
					const addManual = async () => {
						const v = (input.value || "").trim();
						if (!v) return;
						const a = getSel();
						if (!a.includes(v) && a.length < MAX) { a.push(v); await saveSel(a); render(); }
					};
					const addBtn = manualWrap.createEl("button", { cls: "qbd-model-manager-manual-btn", text: t("plugin.ollama.models.addButton") });
					addBtn.addEventListener("click", addManual);
					input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } });
				}
			};
			render();

			// Rafraîchit le catalogue en tâche de fond à l'ouverture (best-effort).
			aiProviders.fetchOllamaCloudCatalog().then(cat => {
				this.plugin.settings.aiOllamaCatalog = cat;
				return this.plugin.saveSettings();
			}).then(() => render()).catch(() => { /* hors-ligne → repli */ });
		}

		// Dossiers hors vault pour le picker « @ » (fs → desktop uniquement ;
		// le plugin reste isDesktopOnly: false, la section disparaît juste).
		if (Platform.isDesktopApp) {
			new Setting(containerEl)
				.setName(t("settings.ai.mentionFolders.name"))
				.setDesc(t("settings.ai.mentionFolders.desc"));
			const list = containerEl.createDiv({ cls: "qbd-settings-folder-list" });
			const paint = () => {
				list.empty();
				for (const [i, dir] of this.plugin.settings.aiMentionExtraFolders.entries()) {
					new Setting(list)
						.setName(dir)
						.addExtraButton(b => b
							.setIcon("trash-2")
							.setTooltip(t("settings.ai.mentionFolders.remove"))
							.onClick(async () => {
								this.plugin.settings.aiMentionExtraFolders.splice(i, 1);
								await this.plugin.saveSettings();
								paint();
							}));
				}
			};
			paint();
			new Setting(containerEl)
				.addText(txt => {
					txt.setPlaceholder(t("settings.ai.mentionFolders.placeholder"));
					txt.inputEl.addEventListener("keydown", async (e) => {
						if (e.key !== "Enter") return;
						const raw = txt.getValue().trim();
						if (!raw) return;
						// Séparateurs unifiés, sans séparateur final : sinon
						// « C:\...\Downloads » et « C:/.../Downloads » sont vus
						// comme deux racines distinctes (double parcours, chaque
						// fichier listé deux fois), et un séparateur final casse
						// la navigation (mention-picker.ts teste
						// `dir.startsWith(r + "/")`, jamais vrai avec une racine
						// du genre « .../Downloads/ »).
						const dir = normalizeExternalRoot(raw);
						const fs = require("fs") as typeof import("fs");
						let ok = false;
						try { ok = fs.statSync(dir).isDirectory(); } catch (err) { ok = false; }
						if (!ok) { new Notice(t("settings.ai.mentionFolders.invalid", { dir })); return; }
						if (this.plugin.settings.aiMentionExtraFolders.includes(dir)) { txt.setValue(""); return; }
						this.plugin.settings.aiMentionExtraFolders.push(dir);
						await this.plugin.saveSettings();
						txt.setValue("");
						paint();
						// « Le vault gagne » (cf. mention-picker.ts, entriesFor) : un
						// dossier du VAULT de même nom de base l'emportera TOUJOURS
						// sur cette racine externe dans le picker « @ » — elle devient
						// alors innavigable par ce chemin (mais reste trouvable par
						// recherche). Signalé ICI, au moment où l'utilisateur choisit
						// d'ajouter la racine, plutôt que de le laisser découvrir en
						// silence un dossier qui ne répond pas.
						const label = dir.split("/").pop() || dir;
						if (this.app.vault.getAbstractFileByPath(label) instanceof TFolder) {
							new Notice(t("settings.ai.mentionFolders.vaultCollision", { name: label }));
						}
					});
				});
		}

		// ─── Contextual Tutorial ───
		const tutorial = TUTORIALS[currentProvider];
		if (tutorial) {
			const tutorialEl = containerEl.createDiv({ cls: "qb-ai-tutorial" });
			tutorialEl.style.cssText = "margin-top: 1.5em; padding: 1.2em; background: var(--background-secondary); border-radius: 10px; border: 1px solid var(--background-modifier-border);";

			const tutorialHeader = tutorialEl.createDiv({ cls: "qb-ai-tutorial-header" });
			tutorialHeader.style.cssText = "display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.8em;";
			const headerIcon = tutorialHeader.createSpan({ cls: "qb-ai-tutorial-icon" });
			setIcon(headerIcon, currentProvider === "ollama" ? "cpu" : "sparkles");
			headerIcon.style.cssText = "display: flex; align-items: center; color: var(--interactive-accent);";
			tutorialHeader.createEl("h4", {
				text: tutorial.title,
				cls: "qb-ai-tutorial-title"
			}).style.cssText = "margin: 0; font-size: 1.05em; color: var(--text-normal);";

			for (const section of tutorial.sections) {
				const sectionEl = tutorialEl.createDiv({ cls: "qb-ai-tutorial-section" });
				sectionEl.style.cssText = "margin-bottom: 0.7em;";

				const headingEl = sectionEl.createEl("strong", { text: section.heading });
				headingEl.style.cssText = "display: block; font-size: 0.92em; margin-bottom: 0.15em; color: var(--text-normal);";
				sectionEl.createEl("span", {
					text: section.text,
					cls: "qb-ai-tutorial-desc"
				}).style.cssText = "display: block; font-size: 0.88em; color: var(--text-muted); line-height: 1.4;";

				if (section.link) {
					const linkEl = sectionEl.createEl("a", {
						text: section.link.label,
						href: section.link.url,
						cls: "qb-ai-tutorial-link"
					});
					linkEl.style.cssText = "display: inline-block; margin-top: 0.2em; font-size: 0.85em; color: var(--interactive-accent); text-decoration: underline;";
					linkEl.target = "_blank";
					linkEl.rel = "noopener noreferrer";
				}
			}

			if (tutorial.warning) {
				const warnEl = tutorialEl.createDiv({ cls: "qb-ai-tutorial-warning" });
				warnEl.style.cssText = "margin-top: 0.8em; padding: 0.6em 0.8em; background: var(--background-primary); border-radius: 6px; border-left: 3px solid var(--color-yellow); font-size: 0.88em; color: var(--text-muted);";
				const warnIcon = warnEl.createSpan();
				setIcon(warnIcon, "alert-triangle");
				warnIcon.style.cssText = "display: inline-flex; vertical-align: middle; margin-right: 0.4em; color: var(--color-yellow);";
				warnEl.createSpan({ text: " " + tutorial.warning });
			}

			if (tutorial.tips) {
				for (const tip of tutorial.tips) {
					const tipEl = tutorialEl.createDiv({ cls: "qb-ai-tutorial-tip" });
					tipEl.style.cssText = "margin-top: 0.3em; font-size: 0.88em; color: var(--text-muted); line-height: 1.4;";
					tipEl.textContent = tip;
				}
			}

			if (tutorial.docsLink) {
				const docsEl = tutorialEl.createDiv({ cls: "qb-ai-tutorial-docs" });
				docsEl.style.cssText = "margin-top: 0.8em; padding-top: 0.6em; border-top: 1px solid var(--background-modifier-border);";
				const docsIcon = docsEl.createSpan();
				setIcon(docsIcon, "external-link");
				docsIcon.style.cssText = "display: inline-flex; vertical-align: middle; margin-right: 0.4em; color: var(--text-muted);";
				const docsLink = docsEl.createEl("a", {
					text: tutorial.docsLink.label,
					href: tutorial.docsLink.url,
					cls: "qb-ai-tutorial-docs-link"
				});
				docsLink.style.cssText = "font-size: 0.88em; color: var(--interactive-accent); text-decoration: underline;";
				docsLink.target = "_blank";
				docsLink.rel = "noopener noreferrer";
			}
		}

		// ─── Raccourcis du composer IA ───
		// Capture au clavier : clic sur le bouton → « Appuyez sur une
		// combinaison… » → le prochain keydown non-modificateur devient le
		// raccourci (un modificateur est exigé : une lettre nue taperait
		// le raccourci en écrivant dans le composer). Les vues dashboard
		// ouvertes re-bindent leur Scope immédiatement.
		containerEl.createEl("h3", { text: t("plugin.hotkey.heading") });
		const rebindDashboards = () => {
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
				const view = leaf.view as unknown as DashboardHotkeyRebindable;
				if (view && view.bindComposerHotkeys) view.bindComposerHotkeys();
			}
		};
		const addHotkeySetting = (name: string, desc: string, key: "hotkeyAddFiles" | "hotkeyAddNotes") => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addButton((btn) => {
					btn.buttonEl.addClass("quiz-blocks-hotkey-btn");
					const paint = () => btn.setButtonText(formatHotkey(this.plugin.settings[key]) || t("plugin.hotkey.none"));
					paint();
					btn.onClick(() => {
						btn.setButtonText(t("plugin.hotkey.press"));
						const onKey = async (e: KeyboardEvent) => {
							e.preventDefault();
							e.stopPropagation();
							if (e.key === "Escape") { cleanup(); paint(); return; }
							const hk = eventToHotkey(e);
							if (!hk) return; // modificateur seul : on attend la touche
							if (!hk.modifiers.length) {
								new Notice(t("plugin.hotkey.needModifier"));
								return;
							}
							cleanup();
							this.plugin.settings[key] = hk;
							await this.plugin.saveSettings();
							rebindDashboards();
							paint();
						};
						const cleanup = () => {
							btn.buttonEl.removeEventListener("keydown", onKey, true);
							btn.buttonEl.removeEventListener("blur", onBlur);
						};
						const onBlur = () => { cleanup(); paint(); };
						btn.buttonEl.addEventListener("keydown", onKey, true);
						btn.buttonEl.addEventListener("blur", onBlur);
						btn.buttonEl.focus();
					});
				})
				.addExtraButton((b) => b
					.setIcon("rotate-ccw")
					.setTooltip(t("plugin.hotkey.reset"))
					.onClick(async () => {
						this.plugin.settings[key] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[key])) as Hotkey;
						await this.plugin.saveSettings();
						rebindDashboards();
						this.display();
					}));
		};
		addHotkeySetting(t("plugin.hotkey.addFiles.name"), t("plugin.hotkey.addFiles.desc"), "hotkeyAddFiles");
		addHotkeySetting(t("plugin.hotkey.addNotes.name"), t("plugin.hotkey.addNotes.desc"), "hotkeyAddNotes");

		// ─── Saisie vocale (dictée) ───
		containerEl.createEl("h3", { text: t("plugin.voice.heading") });
		if (!voiceInstall.isSupported()) {
			containerEl.createEl("p", {
				text: t("plugin.voice.windowsOnly"),
				cls: "setting-item-description",
			});
		} else {
			new Setting(containerEl)
				.setName(t("plugin.voice.enable.name"))
				.setDesc(t("plugin.voice.enable.desc"))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.voiceEnabled)
					.onChange(async (v) => {
						this.plugin.settings.voiceEnabled = v;
						await this.plugin.saveSettings();
						this.display();
					}));

			if (this.plugin.settings.voiceEnabled) {
				new Setting(containerEl)
					.setName(t("plugin.voice.backend.name"))
					.setDesc(t("plugin.voice.backend.desc"))
					.addDropdown(d => d
						.addOption("cpu", t("plugin.voice.backend.cpu"))
						.addOption("cuda", t("plugin.voice.backend.cuda"))
						.setValue(this.plugin.settings.voiceBackend)
						.onChange(async (v) => {
							this.plugin.settings.voiceBackend = v as VoiceBackend;
							await this.plugin.saveSettings();
							this.display();
						}));

				new Setting(containerEl)
					.setName(t("plugin.voice.model.name"))
					.setDesc(t("plugin.voice.model.desc"))
					.addDropdown(d => {
						for (const [id, m] of Object.entries(voiceInstall.MODELS)) d.addOption(id, m.label);
						d.setValue(this.plugin.settings.voiceModel)
							.onChange(async (v) => {
								this.plugin.settings.voiceModel = v as VoiceModelId;
								await this.plugin.saveSettings();
								this.display();
							});
					});

				new Setting(containerEl)
					.setName(t("plugin.voice.lang.name"))
					.addDropdown(d => d
						.addOption("fr", t("plugin.voice.lang.fr"))
						.addOption("auto", t("plugin.voice.lang.auto"))
						.addOption("en", t("plugin.voice.lang.en"))
						.setValue(this.plugin.settings.voiceLang)
						.onChange(async (v) => {
							this.plugin.settings.voiceLang = v as VoiceLang;
							await this.plugin.saveSettings();
						}));

				// État d'installation + téléchargements (rien sans clic explicite).
				const st = voiceInstall.getStatus(this.plugin.settings);
				// Paramètres nommés done/total (et non d/t) : un paramètre « t »
				// masquerait la fonction de traduction importée.
				const fmtPct = (done: number, total: number): string => (total
					? Math.round((done / total) * 100) + " %"
					: t("plugin.voice.megabytes", { n: Math.round(done / 1e6) }));
			// onProgress arrive à CHAQUE chunk (~16 Ko) : sur le zip CUDA
			// (~678 Mo) ça ferait des dizaines de milliers de setButtonText.
			// Ne toucher au DOM que quand le libellé change réellement.
			const throttledProgress = (btn: ButtonComponent) => {
				let last = "";
				return (done: number, total: number): void => {
					const label = fmtPct(done, total);
					if (label !== last) { last = label; btn.setButtonText(label); }
				};
			};

				const binRow = new Setting(containerEl)
					.setName(t("plugin.voice.binary.name", { backend: this.plugin.settings.voiceBackend }))
					.setDesc(st.cliPath ? t("plugin.voice.installed", { path: st.cliPath }) : t("plugin.voice.notInstalled"));
				if (!st.cliPath) binRow.addButton(b => b
					.setButtonText(t("plugin.voice.download"))
					.setCta()
					.onClick(async () => {
						b.setDisabled(true);
						try {
							await voiceInstall.installBinary(this.plugin.settings.voiceBackend,
								throttledProgress(b));
							new Notice(t("plugin.voice.binaryInstalled"));
						} catch (e) {
							console.error("[quiz-blocks] install binaire:", e);
							new Notice(t("plugin.voice.downloadFailed", { error: e instanceof Error ? e.message : String(e) }));
						}
						this.display();
					}));

				const mdlRow = new Setting(containerEl)
					.setName(t("plugin.voice.model.rowName", { label: voiceInstall.MODELS[this.plugin.settings.voiceModel]?.label || this.plugin.settings.voiceModel }))
					.setDesc(st.modelFile ? t("plugin.voice.installed", { path: st.modelFile }) : t("plugin.voice.notInstalled"));
				if (!st.modelFile) mdlRow.addButton(b => b
					.setButtonText(t("plugin.voice.download"))
					.setCta()
					.onClick(async () => {
						b.setDisabled(true);
						try {
							await voiceInstall.installModel(this.plugin.settings.voiceModel,
								throttledProgress(b));
							new Notice(t("plugin.voice.modelInstalled"));
						} catch (e) {
							console.error("[quiz-blocks] install modèle:", e);
							new Notice(t("plugin.voice.downloadFailed", { error: e instanceof Error ? e.message : String(e) }));
						}
						this.display();
					}));
			}
		}
	}
}

export default class InteractiveQuizPlugin extends Plugin {
	settings!: QuizBlocksSettings;
	log!: Logger;
	_scanner!: Scanner;
	_statsStore!: StatsStore;
	/** Icône du ribbon : conservée pour retraduire son tooltip (applyLanguage). */
	_ribbonEl: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.log = createLogger();

		this.log.info("plugin chargé");

		/* ─── Scanner & Stats Store ─── */
		this._scanner = createScanner(this.app);
		this._statsStore = createStatsStore(this);
		this._statsStore.load();

		/* ─── Quiz Dashboard View ─── */
		this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new QuizDashboardView(leaf, this));

		this.addSettingTab(new QuizBlocksSettingTab(this.app, this));

		if (this.settings.enableCodeHighlighting) {
			this.registerQuizBlocksCodeHighlighting();
			this.register(() => this.unregisterQuizBlocksCodeHighlighting());
		}

		/* ─── Quiz Builder View ─── */
		this.registerView(VIEW_TYPE, (leaf) => new QuizBuilderView(leaf, this));

		this.registerCommands();

		/* ─── Ribbon Icon ─── */
		// Élément conservé : son aria-label (le tooltip) est retraduit à chaud
		// par applyLanguage() — un second addRibbonIcon ajouterait une icône.
		this._ribbonEl = this.addRibbonIcon("graduation-cap", t("plugin.command.openDashboard.name"), () => {
			void this.openDashboard();
		});

		/* ─── Code Block Processor ─── */
		this.registerMarkdownCodeBlockProcessor(
			QUIZ_BLOCK_LANGUAGE,
			async (source: string, el: HTMLElement, mdCtx: MarkdownPostProcessorContext) => {
				const host = el.createDiv({ cls: "quiz-blocks-host" });

				// Lie la destruction de l'instance au cycle de vie du bloc : à chaque
				// re-render/unload, Obsidian appelle onunload → destroyQuiz, ce qui retire
				// les listeners document/window, ResizeObservers et timers. Sans ça, chaque
				// re-render (édition de note, toggle mode) fuit une instance complète.
				const renderChild = new MarkdownRenderChild(host);
				renderChild.onunload = () => { try { host.__quizDestroy?.(); } catch (_) {} };
				mdCtx.addChild(renderChild);

				try {
					const quiz = parseQuizSource(source);

					/* Note Quiz qui pointe vers une note Lesson (task 8, lot mode
					   leçon) : `source` est lu sur l'objet de configuration AVANT le
					   rendu, jamais par le moteur lui-même — un bloc sans `source`
					   (l'immense majorité) ne passe jamais par ce chemin et se
					   comporte exactement comme avant. */
					const configIdx = findQuizModeConfigIndex(quiz);
					const config = configIdx >= 0 ? quiz[configIdx] as { source?: unknown } : undefined;
					const sourceRef = typeof config?.source === "string" ? config.source.trim() : "";

					let quizToRender = quiz;
					if (sourceRef) {
						const resolved = await resolveQuizSourceRef(this.app, sourceRef, mdCtx.sourcePath);
						if ("error" in resolved) {
							const key = resolved.error === "not-found" ? "plugin.sourceRef.notFound"
								: resolved.error === "no-block" ? "plugin.sourceRef.noBlock"
									: "plugin.sourceRef.chained";
							const message = t(key, { link: resolved.link });
							new Notice(message);
							host.empty();
							host.createEl("p", { text: message });
							return;
						}
						/* FIX round 1 de revue (Finding 4) : une leçon en cours de
						   rédaction, sans aucune question `role: "test"`, résolvait
						   SANS erreur vers un tableau vide — transmis tel quel au
						   moteur, ça affiche le message générique
						   `engine.error.noQuestions`, qui ne nomme ni le lien ni la
						   cause. Cas très probable pendant la rédaction d'un chapitre :
						   message dédié, explicite, avant même d'atteindre le moteur. */
						if (resolved.questions.length === 0) {
							const message = t("plugin.sourceRef.empty", { link: sourceRef });
							new Notice(message);
							host.empty();
							host.createEl("p", { text: message });
							return;
						}

						/* On conserve l'objet de configuration d'origine (mode, options
						   d'examen…) : seules les QUESTIONS viennent de la note Lesson. */
						quizToRender = configIdx >= 0
							? [...resolved.questions, quiz[configIdx]]
							: resolved.questions;
					}

					await renderInteractiveQuiz({
						app: this.app,
						plugin: this,
						container: host,
						quiz: quizToRender,
						sourcePath: mdCtx.sourcePath,
						Notice: Notice
					});
				} catch (error) {
					this.log.error("erreur pendant le rendu du bloc", error);

					host.empty();
					host.createEl("p", {
						text: t("plugin.block.error", {
							error: error instanceof Error ? error.message : t("plugin.block.unknownError")
						})
					});
				}
			}
		);

		/* ─── Scanner init (async, non-blocking) ─── */
		this._scanner.init().catch((err: unknown) => this.log.warn("Scanner init error:", err));
	}

	onunload(): void {
		this._scanner?.destroy();
		this._statsStore?.destroy();
		// Menus/popovers portalés au <body> (ui-select) : sans fermeture ici,
		// un menu ouvert au moment d'un unload (update/reload du plugin)
		// resterait orphelin dans le DOM avec ses closures mortes.
		try { closeAllSelects(); } catch (e) { /* best effort */ }
		this.log?.info("plugin déchargé");
	}

	async loadSettings(): Promise<void> {
		// loadData() renvoie les réglages persistés (any) : cast vers la forme
		// attendue, fusionnée par-dessus les défauts.
		const data = await this.loadData() as Partial<QuizBlocksSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});

		// Langue appliquée AVANT tout rendu : les vues, commandes et menus lisent
		// t() dès leur enregistrement dans onload().
		setLanguage(this.settings.language);

		if ("enableDebugLogs" in this.settings) {
			delete this.settings.enableDebugLogs;
			await this.saveSettings();
		}

		if ("aiCompatibleUrl" in this.settings) {
			delete this.settings.aiCompatibleUrl;
			await this.saveSettings();
		}

		// Migration : le provider Anthropic (clé API) est remplacé par
		// Claude via Claude Code (abonnement). Le choix du fournisseur
		// redevient explicite : aucun présélectionné.
		if (this.settings.aiProvider === "anthropic" || "aiApiKey" in this.settings) {
			if (this.settings.aiProvider === "anthropic") {
				this.settings.aiProvider = "";
				this.settings.aiModel = "";
			}
			delete this.settings.aiApiKey;
			await this.saveSettings();
		}

		// Migration 2026-08-29 : le fournisseur Kimi Code est retiré. Un réglage
		// qui le nommait encore laisserait le composer sur un fournisseur absent
		// du menu — donc un bouton qui n'ouvre rien. Le choix redevient explicite
		// (aucun présélectionné), comme pour la migration Anthropic ci-dessus.
		if (this.settings.aiProvider === "kimi-code") {
			this.settings.aiProvider = "";
			this.settings.aiModel = "";
			this.settings.aiEffort = "";
			await this.saveSettings();
		}

		// Migration 2026-07-12 : le défaut « Ajouter des fichiers » passe
		// de Ctrl+F à Ctrl+U (référence claude.ai). Un Ctrl+F stocké ne
		// peut être que l'ancien défaut resauvé tel quel, pas un choix.
		const hf = this.settings.hotkeyAddFiles;
		if (hf && hf.key === "f" && Array.isArray(hf.modifiers)
			&& hf.modifiers.length === 1 && hf.modifiers[0] === "Mod") {
			this.settings.hotkeyAddFiles = { modifiers: ["Mod"], key: "u" };
			await this.saveSettings();
		}

		// Migration 2026-07-19 : l'archivage PAR QUIZ (quizzesArchived, chemins
		// de notes) disparaît au profit de l'archivage PAR DOSSIER
		// (quizzesArchivedFolders). L'ancien état est simplement abandonné
		// (feature d'un jour, jamais publiée) : rien n'est converti.
		if ("quizzesArchived" in this.settings) {
			delete this.settings.quizzesArchived;
			await this.saveSettings();
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Ouvre (ou révèle) le dashboard. Partagé par la commande et le ribbon. */
	async openDashboard(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
		this.app.workspace.revealLeaf(leaf);
	}

	/** Enregistre les commandes. MÉTHODE, pas un bloc d'onload : elle est
	 *  rejouée au changement de langue pour retraduire les noms affichés dans la
	 *  palette. Réenregistrer un même `id` remplace l'entrée existante (aucun
	 *  doublon) et ne touche pas aux raccourcis personnalisés, qui vivent dans
	 *  le hotkey manager, pas dans la commande.
	 *  Les `id` sont des identifiants techniques persistés dans les hotkeys de
	 *  l'utilisateur : jamais traduits, les changer casserait ses raccourcis.
	 *  Seul `name` l'est. */
	registerCommands(): void {
		this.addCommand({
			id: "open-quiz-dashboard",
			name: t("plugin.command.openDashboard.name"),
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "d" }],
			callback: () => { void this.openDashboard(); },
		});

		/* L'ancien « Ouvrir le Quiz Editor » ouvrait un onglet VIDE — l'éditeur
		   autonome qui n'existe plus depuis le 2026-07-31. La commande garde
		   son `id` (les raccourcis de l'utilisateur y sont attachés) mais mène
		   désormais là où il y a quelque chose à faire : le quiz de la note
		   courante s'il y en a un, la liste des quiz sinon. */
		this.addCommand({
			id: "open-quiz-builder",
			name: t("plugin.command.openEditor.name"),
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "e" }],
			callback: async () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.path.endsWith(".md")) {
					try {
						// `cachedRead` : on ne fait que TESTER la présence d'un bloc,
						// et la note sera relue par l'ouverture. Une lecture qui
						// échoue ne doit pas faire échouer la commande — on retombe
						// simplement sur le dashboard.
						const content = await this.app.vault.cachedRead(activeFile);
						if (QUIZ_BLOCK_RE.test(content)) {
							const { openQuizPathInEditor } = require("./dashboard/quiz-open") as typeof import("./dashboard/quiz-open");
							await openQuizPathInEditor(this.app, activeFile.path);
							return;
						}
					} catch {
						// Lecture impossible : la suite mène au dashboard.
					}
				}
				// Un onglet déjà ouvert sur un quiz vaut mieux que le dashboard :
				// c'est probablement celui qu'on cherchait.
				const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)
					.filter(l => (l.view as { sourceFile?: unknown }).sourceFile);
				if (existing.length > 0) {
					this.app.workspace.revealLeaf(existing[0]);
					return;
				}
				await this.openDashboard();
			},
		});

		this.addCommand({
			id: "open-quiz-from-active-note",
			name: t("plugin.command.openFromNote.name"),
			hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "q" }],
			callback: async () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile || !activeFile.path.endsWith(".md")) {
					new Notice(t("plugin.notice.noActiveNote"));
					return;
				}
				try {
					const content = await this.app.vault.read(activeFile);
					// Premier bloc quiz-blocks de la note.
					const match = content.match(QUIZ_BLOCK_RE);
					if (!match) {
						new Notice(t("plugin.notice.noQuizBlock"));
						return;
					}
					const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
					let leaf: WorkspaceLeaf;
					if (existing.length > 0) {
						leaf = existing[0];
						this.app.workspace.revealLeaf(leaf);
					} else {
						leaf = this.app.workspace.getLeaf("tab");
						await leaf.setViewState({ type: VIEW_TYPE, active: true });
						this.app.workspace.revealLeaf(leaf);
					}
					const view = leaf.view as unknown as QuizFileOpenable;
					if (view && view.openQuizFile) {
						await view.openQuizFile(activeFile, match[1]);
						new Notice(t("plugin.notice.quizOpened", { name: activeFile.name }));
					}
				} catch (err) {
					console.error("Open error:", err);
					new Notice(t("plugin.notice.openError"));
				}
			},
		});

		/* N'apparaît dans la palette que depuis une note Lesson (brief point 4) :
		   une commande visible qui échoue est pire qu'une commande absente. Le
		   contenu testé est celui de l'ÉDITEUR actif (synchrone), pas celui du
		   disque — `checkCallback` ne peut pas attendre une lecture async. */
		this.addCommand({
			id: "create-quiz-from-lesson",
			name: t("plugin.command.createQuizFromLesson.name"),
			checkCallback: (checking: boolean) => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!activeView) return false;
				const content = activeView.editor.getValue();
				if (!isLessonNoteContent(content)) return false;
				if (checking) return true;

				void (async () => {
					const lessonFile = activeView.file;
					if (!lessonFile) return;
					const quizName = deriveQuizNoteName(lessonFile.basename);
					const quizPath = lessonFile.parent
						? `${lessonFile.parent.path}/${quizName}.md`
						: `${quizName}.md`;

					// Ne JAMAIS écraser une note quiz déjà présente : on l'ouvre.
					const existing = this.app.vault.getAbstractFileByPath(quizPath);
					if (existing instanceof TFile) {
						await this.app.workspace.getLeaf("tab").openFile(existing);
						return;
					}

					try {
						const created = await this.app.vault.create(quizPath, buildQuizRefBlockContent(lessonFile.basename));
						await this.app.workspace.getLeaf("tab").openFile(created);
					} catch (err) {
						console.error("Create quiz from lesson error:", err);
						new Notice(t("plugin.notice.createQuizFailed"));
					}
				})();
				return true;
			},
		});
	}

	/** Applique une langue à TOUT ce qui est déjà affiché. Sans ça, un
	 *  changement de langue ne toucherait que les réglages : les vues ouvertes,
	 *  les noms de commandes de la palette et le tooltip du ribbon resteraient
	 *  dans l'ancienne langue jusqu'au prochain démarrage d'Obsidian. */
	applyLanguage(value: LangSetting): void {
		setLanguage(value);
		this.registerCommands();
		if (this._ribbonEl) {
			this._ribbonEl.setAttribute("aria-label", t("plugin.command.openDashboard.name"));
		}
		this.refreshOpenViews();
	}

	/** Redessine les vues ouvertes (dashboard, éditeur) après un changement de
	 *  langue. Les libellés sont lus via t() AU RENDU : un simple re-render
	 *  suffit, aucun rechargement du plugin n'est nécessaire.
	 *  L'éditeur est remonté via setViewState (son UI est bâtie à onOpen). */
	refreshOpenViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)) {
			const view = leaf.view as unknown as DashboardRefreshable;
			if (view && view.renderSidebar && view.renderCurrentView) {
				view.renderSidebar();
				view.renderCurrentView();
			}
		}
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const state = leaf.getViewState();
			void leaf.setViewState({ type: "empty" }).then(() => leaf.setViewState(state));
		}
	}

	getCodeMirrorGlobal(): CodeMirrorGlobal | null {
		if (typeof window === "undefined") return null;
		const cm = (window as unknown as { CodeMirror?: CodeMirrorGlobal }).CodeMirror;
		if (!cm || typeof cm.defineMode !== "function" || typeof cm.getMode !== "function") {
			return null;
		}
		return cm;
	}

	registerQuizBlocksCodeHighlighting(): void {
		const cm = this.getCodeMirrorGlobal();

		if (!cm) {
			this.log.warn("CodeMirror global introuvable : coloration désactivée.");
			return;
		}

		try {
			cm.defineMode(QUIZ_BLOCK_LANGUAGE, config => {
				return cm.getMode(
					{
						...config,
						json: true
					},
					"javascript"
				);
			});

			this.log.debug("mode de coloration enregistré pour quiz-blocks");
		} catch (error) {
			this.log.error("impossible d'enregistrer la coloration", error);
		}
	}

	unregisterQuizBlocksCodeHighlighting(): void {
		const cm = this.getCodeMirrorGlobal();
		if (!cm) return;

		try {
			cm.defineMode(QUIZ_BLOCK_LANGUAGE, config => cm.getMode(config, "null"));
			this.log.debug("mode de coloration désactivé");
		} catch (error) {
			this.log.error("impossible de retirer la coloration", error);
		}
	}
}
