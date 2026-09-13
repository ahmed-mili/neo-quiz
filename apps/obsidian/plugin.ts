import { PRODUCT_NAME, PLUGIN_ID } from "../../src/branding";
import {
	MarkdownRenderChild,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import type {
	App,
	MarkdownPostProcessorContext,
} from "obsidian";

import { createObsidianHost } from "./host";
import { installHost, uninstallHost, currentHost } from "../../src/host/current";
import { parseQuizSource, renderInteractiveQuiz } from "../../src/engine";
import { findQuizModeConfigIndex } from "../../src/quiz-utils";
import { resolveQuizSourceRef } from "../../src/quiz-source-ref";
import { createStatsStore } from "../../src/dashboard/stats-store";
import type { StatsStore, QuizStatRecord } from "../../src/dashboard/stats-store";
import { createReviewStore } from "../../src/review/review-store";
import type { ReviewStore } from "../../src/review/review-store";
import { migrateReviewLog } from "../../src/review/migration";
import { t, setLanguage, langSetting } from "../../src/i18n";
import type { LangSetting } from "../../src/i18n";

const PLUGIN_NAME = PRODUCT_NAME;
const QUIZ_BLOCK_LANGUAGE = "quiz-blocks";

/** Réglages persistés du greffon LECTEUR : trois clés, rien d'autre. Les
 *  clés IA/hotkeys/« Mes quiz » d'une version antérieure restent dans
 *  `data.json` chez qui les avait — elles ne sont ni migrées ni effacées
 *  (`Object.assign` par-dessus les défauts, jamais de `delete`), comme la
 *  dictée avant elles. Ce sont désormais l'application Windows qui les lit. */
interface QuizBlocksSettings {
	/** Langue de l'INTERFACE. « auto » = celle d'Obsidian. Sans effet sur la
	 *  langue des quiz générés (le modèle suit celle de la demande). */
	language: LangSetting;
	enableCodeHighlighting: boolean;
	quizStats: Record<string, QuizStatRecord>;
}

const DEFAULT_SETTINGS: QuizBlocksSettings = {
	// Défaut « auto » : l'anglais s'applique de lui-même hors Obsidian français
	// — un utilisateur de la liste communautaire n'a rien à régler.
	language: "auto",
	enableCodeHighlighting: true,
	quizStats: {},
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

/** Onglet de réglages du LECTEUR : deux entrées, langue et coloration. Le
 *  tableau de bord, l'éditeur, l'IA, les raccourcis et « Mes quiz » vivent
 *  désormais uniquement dans l'application Windows. */
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
						// applyLanguage retraduit ce qui est déjà affiché. Puis on
						// redessine ces réglages eux-mêmes.
						this.plugin.applyLanguage(this.plugin.settings.language);
						this.display();
					});
			});

		new Setting(containerEl)
			.setName(t("settings.codeHighlighting.name"))
			.setDesc(t("settings.codeHighlighting.desc"))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableCodeHighlighting)
				.onChange(async (value) => {
					this.plugin.settings.enableCodeHighlighting = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.registerQuizBlocksCodeHighlighting();
					} else {
						this.plugin.unregisterQuizBlocksCodeHighlighting();
					}
				}));
	}
}

export default class InteractiveQuizPlugin extends Plugin {
	settings!: QuizBlocksSettings;
	log!: Logger;
	_statsStore!: StatsStore;
	/** Journal de révision par QUESTION (ordonnanceur). Le lecteur n'appelle
	    jamais `plan()` : il n'a besoin ni du catalogue (le scanner est parti
	    avec le tableau de bord) ni des horizons d'examen. Le journal reste
	    écrit au même endroit, lu par l'application. */
	_reviewStore?: ReviewStore;

	async onload(): Promise<void> {
		/* L'hôte s'installe en TOUT PREMIER : le moteur et le rendu
		   mathématique le lisent par `currentHost()`, qui jette si rien n'est
		   installé. Une installation tardive ne produirait pas un rendu
		   dégradé mais une exception au premier quiz. */
		installHost(createObsidianHost(this.app, this));

		await this.loadSettings();
		this.log = createLogger();

		this.log.info("plugin chargé");

		/* Le store ne connaît plus le `Plugin`, seulement deux méthodes. La
		   forme persistée ne change PAS : `settings.quizStats`, écrit par
		   `saveSettings()` comme avant — des stats déjà accumulées chez
		   l'utilisateur doivent rester lisibles. */
		this._statsStore = createStatsStore({
			getStats: () => this.settings.quizStats || {},
			saveStats: async (data) => {
				this.settings.quizStats = data;
				await this.saveSettings();
			},
		});
		this._statsStore.load();
		/* Le suivi de renommage vivait DANS `createStatsStore`, abonné
		   directement au vault tant que le store recevait un `Plugin` entier.
		   Réduit à `StatsStoreHost`, il ne peut plus s'abonner lui-même :
		   c'est ICI, seul endroit à recevoir l'évènement du vault, qu'on
		   relaie vers `renamed()` — même évènement, même logique, juste
		   déplacée d'un cran. `registerEvent` : détaché à l'unload. */
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			this._statsStore.renamed(oldPath, file.path);
		}));
		/* Le journal de révision. Le lecteur n'a ni catalogue ni horizons
		   d'examen (le scanner et « Mes quiz » sont partis avec le tableau de
		   bord) : le moteur n'appelle que `record`/`keyOf`, jamais `plan()`. */
		this._reviewStore = createReviewStore({
			fs: currentHost().fs,
			watcher: currentHost().watcher,
			paths: currentHost().paths,
			catalogue: () => [],
			horizons: () => ({}),
			now: () => Date.now(),
		});
		/* MIGRER D'ABORD, CHARGER ENSUITE : l'inverse lirait un journal neuf
		   encore vide. La migration est idempotente : la refaire à chaque
		   démarrage ne coûte qu'une lecture, et c'est ce qui permet à
		   l'application de la déclencher aussi. */
		void (async () => {
			for (const root of currentHost().paths.roots()) {
				try {
					const res = await migrateReviewLog(currentHost().fs, root.legacyReviewLog, root.reviewLog);
					if (!res.skipped) {
						this.log.info(`journal migré : ${res.absorbed} ligne(s) absorbée(s), ${res.duplicates} déjà présente(s), ${res.ignored} illisible(s), ancien ${res.renamed ? "rangé" : "conservé"}`);
					}
				} catch (e) {
					// Le démarrage ne dépend PAS de la migration : au pire
					// l'historique reste à son ancienne place, et on réessaiera.
					this.log.warn("migration du journal impossible", e);
				}
			}
			await this._reviewStore?.load();
		})();

		this.addSettingTab(new QuizBlocksSettingTab(this.app, this));

		if (this.settings.enableCodeHighlighting) {
			this.registerQuizBlocksCodeHighlighting();
			this.register(() => this.unregisterQuizBlocksCodeHighlighting());
		}

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

					/* Note Quiz qui pointe vers une note Lesson : `source` est lu sur
					   l'objet de configuration AVANT le rendu, jamais par le moteur
					   lui-même — un bloc sans `source` (l'immense majorité) ne passe
					   jamais par ce chemin et se comporte exactement comme avant. */
					const configIdx = findQuizModeConfigIndex(quiz);
					const config = configIdx >= 0 ? quiz[configIdx] as { source?: unknown } : undefined;
					const sourceRef = typeof config?.source === "string" ? config.source.trim() : "";

					let quizToRender = quiz;
					if (sourceRef) {
						const resolved = await resolveQuizSourceRef(sourceRef, mdCtx.sourcePath);
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
						container: host,
						quiz: quizToRender,
						sourcePath: mdCtx.sourcePath,
						statsSink: this._statsStore,
						reviewSink: this._reviewStore,
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
	}

	onunload(): void {
		this._statsStore?.destroy();
		this._reviewStore?.destroy();
		this.log?.info("plugin déchargé");
		/* En DERNIER : tout ce qui précède peut encore avoir besoin de l'hôte.
		   Sans ce retrait, un rechargement du greffon laisserait un hôte pointant
		   vers une `App` morte, et le suivant croirait avoir un hôte valide. */
		uninstallHost();
	}

	async loadSettings(): Promise<void> {
		// loadData() renvoie les réglages persistés (any) : cast vers la forme
		// attendue, fusionnée par-dessus les défauts. Les clés d'une version
		// antérieure (IA, hotkeys, « Mes quiz »…) restent dans l'objet chargé
		// mais hors du type : ignorées, jamais effacées.
		const data = await this.loadData() as Partial<QuizBlocksSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});

		// Langue appliquée AVANT tout rendu : la palette et l'onglet de
		// réglages lisent t() dès leur enregistrement dans onload().
		setLanguage(this.settings.language);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Applique un changement de langue. Réduit au strict lecteur : plus de
	 *  commandes à retraduire dans la palette, plus de ruban, plus de vue à
	 *  rafraîchir — seul l'onglet de réglages affiche encore du texte, et il
	 *  se redessine lui-même après cet appel. */
	applyLanguage(value: LangSetting): void {
		setLanguage(value);
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

	getCodeMirrorGlobal(): CodeMirrorGlobal | null {
		if (typeof window === "undefined") return null;
		const cm = (window as unknown as { CodeMirror?: CodeMirrorGlobal }).CodeMirror;
		if (!cm || typeof cm.defineMode !== "function" || typeof cm.getMode !== "function") {
			return null;
		}
		return cm;
	}
}

/** Sous-ensemble de l'API CodeMirror 5 exposée en global (`window.CodeMirror`)
 *  par le mode Source d'Obsidian — non typée dans l'API publique. */
interface CodeMirrorGlobal {
	defineMode(name: string, factory: (config: Record<string, unknown>) => unknown): void;
	getMode(config: unknown, spec: unknown): unknown;
}
