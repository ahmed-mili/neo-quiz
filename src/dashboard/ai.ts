import { setIcon, Notice, loadPdfJs, Platform, MarkdownRenderer, TFile } from "obsidian";
import type { App, View } from "obsidian";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { EditorHostView } from "../types/editor-ctx";
import * as aiProviders from "./ai-providers";
import { createSelect, closeAllSelects, openActionMenu, openModelMenu, openEffortSlider, openOptionsMenu, openNotePicker } from "./ui-select";
import type { SelectHandle, SelectOption } from "./ui-select";
import { formatHotkey } from "../hotkey-format";
import * as voiceInput from "./voice-input";
import { attachMentionPicker } from "./mention-picker";
import type { MentionPickerHandle } from "./mention-picker";
import type { AiClient, ImagePayload } from "./ai-client";
import {
	recordUsage, readUsageLog, fetchPlanUsageFor, providerPublishesPlan,
	formatTokens, formatCost, formatDuration, totalTokens
} from "./ai-usage";
import type { AiUsage, PlanUsage, UsagePlugin } from "./ai-usage";
import { openUsageModal, tightestRow, usageRowLabel } from "./usage-modal";
import { t } from "../i18n";
import type { TransKey } from "../i18n";

/* ══════════════════════════════════════════════════════════
   AI VIEW — Dashboard
   Formulaire de génération IA (onglets Sujet/Image/Texte)
   + preview (idle / loading / result / error).
   Providers, logos et modèles : voir ai-providers.ts.
══════════════════════════════════════════════════════════ */

type Phase = "idle" | "loading" | "result" | "error";

/** Origine d'une pièce jointe texte : note/fichier du VAULT (chemin relatif
    connu), fichier hors vault résolu via le picker « @ » (chemin absolu
    connu), ou fichier choisi/déposé SANS origine connue (menu « + »,
    glisser-déposer — on ne sait dire que son nom). Sert de dédoublonnage
    (cf. attachmentKey) : deux fichiers de même NOM mais d'origine ou de
    chemin différents (« AGENTS.md » du vault vs déposé, deux
    « Styling Coiffure.pdf » de deux dossiers) restent deux pièces jointes
    distinctes. */
type AttachmentSource = "vault" | "external" | "file";

/** Clé d'identité d'une pièce jointe : origine + chemin quand il existe, nom
    sinon. Calculée en UN SEUL endroit et réutilisée à tous les points
    d'ajout (addComposerFiles, attachNoteVaultFile, attachExternalPath) —
    la régression corrigée ici venait précisément d'un dédoublonnage recopié
    à la main à chaque appelant, divergent entre `path` et `name`. */
function attachmentKey(a: { source: AttachmentSource; path?: string; name: string }): string {
	return a.source + ":" + (a.path || a.name);
}

/** Source texte attachée (note du vault ou fichier .md/.txt/PDF). */
interface NoteAttachment {
	name: string;
	content: string;
	/** Vault → chemin relatif au vault. Externe → chemin ABSOLU (résolu par
	    le picker « @ » juste avant l'attachement). Absent seulement pour un
	    fichier choisi/déposé sans origine connue. */
	path?: string;
	source: AttachmentSource;
	/** Chip dépliée (chemin complet) ou repliée (nom+extension) — bascule
	    au clic ; ignoré si `path` est absent (fichier déposé sans origine
	    connue : ni vault ni racine externe, rien de plus à montrer). */
	expanded?: boolean;
}

/** Image jointe (vignette + objet fichier). */
interface ComposerImage {
	file: File;
	url: string;
}

/** Éditeur embarqué + marqueur de génération (invalidation entre générations). */
type EmbedEditor = EditorHostView & { _genId?: number };

/** Message PARTI — ce que le composer contenait au moment de l'envoi.
    Le composer se vide à l'envoi (référence claude.ai) : sans cette copie,
    la demande serait perdue de vue pendant la génération, et une annulation
    n'aurait rien à rendre à l'utilisateur. */
interface SentMessage {
	text: string;
	notes: NoteAttachment[];
	images: ComposerImage[];
}

/** Option du sélecteur de fournisseur (logo + sous-titre). */
interface ProviderSelectOption extends SelectOption {
	logo: string;
	sub: string;
}

/** Élément de la liste Ollama (décorée pour le menu). */
interface OllamaListItem {
	value: string;
	label: string;
	cloud: boolean;
	thinking: boolean;
	installed: boolean;
	icon: string | null;
}

/** État partagé du contrôle Ollama (liste + refresh). */
interface OllamaCtl {
	options: OllamaListItem[];
	detected: aiProviders.OllamaDetectedModel[] | null;
	refreshTrigger: (() => void) | null;
}

/** État partagé du contrôle Kimi : la liste de modèles n'existe qu'après la
    détection async (checkKimi) → le trigger doit pouvoir se redessiner. */
interface KimiCtl {
	refreshTrigger: (() => void) | null;
}

interface ProviderStatusEntry {
	dot: string;
	text: string;
}

/** Arguments (fixés par le render) de refreshProviderStatuses. */
interface RefreshArgs {
	providerSelect: SelectHandle<ProviderSelectOption> | null;
	hintZone: HTMLElement | null;
	provider: string;
	currentModel: string;
	modelSelect: unknown;
	ollamaCtl: OllamaCtl | null;
	kimiCtl: KimiCtl | null;
	buildOllamaList: (detected: aiProviders.OllamaDetectedModel[] | null) => OllamaListItem[];
	force?: boolean;
}

/** Surface (minimale) du pdf.js embarqué d'Obsidian (loadPdfJs). */
interface PdfTextItem { str: string; }
interface PdfPage { getTextContent(): Promise<{ items: PdfTextItem[] }>; }
interface PdfDocument { numPages: number; getPage(n: number): Promise<PdfPage>; }
interface PdfJsLib { getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDocument> }; }

/** Action optionnelle d'un hint contextuel. */
interface HintAction {
	label: string;
	icon?: string;
	onClick: () => void;
}
/** Options du hint contextuel (renderHint). */
interface HintOptions {
	type?: string;
	icon?: string;
	text: string;
	code?: string;
	/** Langage Prism du bloc code (« powershell », « bash »…). */
	lang?: string;
	action?: HintAction;
}


/** Handlers de la vue « Générer » — retour de createAiHandlers(ctx). */
export interface AiHandlers {
	render(container: HTMLElement): Promise<void>;
	openAddFiles(): void;
	openAddNotes(): void;
}

export function createAiHandlers(ctx: DashboardCtx): AiHandlers {
	let composerText = "";
	/* Caret du composer, préservé à travers les render() : render détruit et
	   recrée le textarea, et sans ça tout attachement (chip, image, mention)
	   renvoie le curseur en fin de texte. */
	let composerCaret: number | null = null;
	// Sources texte attachées (PLUSIEURS — maquette 2026-07-11 231626) :
	// notes du vault (path) et fichiers texte du disque (.md/.txt).
	let noteAttachments: NoteAttachment[] = []; // [{ name, content, path? }]
	let questionCount = 5;
	let questionType = "Mixte";
	let images: ComposerImage[] = [];
	// Refs du dernier render : cibles des raccourcis du composer
	// (dashboard.bindComposerHotkeys → openAddFiles/openAddNotes).
	let addBtnRef: HTMLButtonElement | null = null;
	let fileInputRef: HTMLInputElement | null = null;
	// Listener « focus fenêtre » du re-check des statuts CLI (remplacé à
	// chaque render, retiré quand la zone de hint disparaît).
	let __focusRecheck: (() => void) | null = null;
	// ResizeObserver de la carte composer (mesure du text-indent des chips) :
	// déconnecté et recréé à chaque render (composer recréé) — cf. layoutChipsRow.
	let composerResizeObserver: ResizeObserver | null = null;
	let phase: Phase = "idle"; // idle | loading | result | error
	/* Demande PARTIE (bulle façon claude.ai). Non nulle dès l'envoi, remise à
	   null quand la demande retourne dans le composer (annulation) ou qu'on
	   recommence à zéro. */
	let sentMessage: SentMessage | null = null;
	/** L'entrée de la bulle reste à jouer (posée à l'envoi, consommée au rendu). */
	let sentAnimPending = false;
	// Client IA de la génération en cours — permet au bouton stop (et à
	// la touche Esc) d'annuler réellement (kill du CLI / abort du fetch).
	let activeClient: AiClient | null = null;
	// Éditeur de quiz EMBARQUÉ pleine page après génération (référence :
	// l'éditeur complet, pas de nouvel onglet ; composer en bas).
	// generationId invalide l'instance à chaque nouvelle génération.
	let embedEditor: EmbedEditor | null = null;
	let generationId = 0;
	let generatedQuestions: unknown[] = [];
	let errorMessage = "";
	let containerRef: HTMLElement | null = null;
	/* Ce que la DERNIÈRE génération a consommé — null quand le fournisseur ne
	   publie aucun compteur (Kimi Code), auquel cas l'écran le dit. */
	let lastUsage: AiUsage | null = null;
	/* Dernier état de forfait CONNU — sert au seul survol du bouton d'usage :
	   passer la souris ne déclenche jamais de lecture réseau, c'est le modal
	   qui va chercher des chiffres frais quand on l'ouvre. */
	let lastPlan: PlanUsage | null = null;

	// Le type de questions a DEUX faces, à ne jamais confondre : une VALEUR
	// canonique, envoyée telle quelle au modèle (ai-client la compare à
	// « Mixte »/« Choix unique »… pour construire le prompt), et un LIBELLÉ
	// traduit, seul affiché. Traduire la valeur casserait la génération dès que
	// l'UI passe en anglais. Les deux listes restent parallèles (même ordre).
	const TYPE_VALUES = ["Mixte", "Choix unique", "Choix multiple", "Texte libre", "Compréhension"];
	const TYPE_KEYS: TransKey[] = ["ai.type.mixed", "ai.type.single", "ai.type.multiple", "ai.type.text", "ai.type.comprehension"];
	// Libellés recalculés à chaque usage (menu, tooltip) : jamais figés dans la
	// langue du chargement.
	const typeLabels = (): string[] => TYPE_KEYS.map(k => t(k));
	const typeLabel = (value: string): string => {
		const i = TYPE_VALUES.indexOf(value);
		return i < 0 ? value : t(TYPE_KEYS[i]);
	};
	const typeValue = (label: string): string => {
		const i = typeLabels().indexOf(label);
		return i < 0 ? TYPE_VALUES[0] : TYPE_VALUES[i];
	};

	function canGenerate(): boolean {
		const providerId = ctx.plugin.settings.aiProvider || "";
		if (!providerId) return false;
		// Un fournisseur desktop-only (Claude Code CLI) est inutilisable sur
		// mobile : on bloque l'envoi à la source (le bouton d'envoi lit
		// canGenerate) plutôt que de laisser l'utilisateur envoyer un prompt
		// qui échouera — sinon composer « cassé ». Le hint « desktop
		// uniquement » explique déjà pourquoi.
		const provider = aiProviders.getProvider(providerId);
		if (provider && provider.desktopOnly && (ctx.app as App & { isMobile?: boolean }).isMobile) return false;
		return !!(composerText.trim() || images.length > 0 || noteAttachments.length > 0);
	}

	async function render(container: HTMLElement | null): Promise<void> {
		if (!container) return;
		containerRef = container;
		closeAllSelects();
		// Tooltips portalés au <body> (stop, effort) : un re-render détruit
		// leur ancre sans mouseleave → purge pour éviter les orphelins.
		document.querySelectorAll(".qbd-hover-tip").forEach(t => t.remove());
		// Le composer (et son ResizeObserver) est détruit par container.empty() :
		// déconnecter AVANT, sinon l'ancien observer continue de viser un élément
		// détaché (fuite silencieuse, un de plus à chaque render).
		if (composerResizeObserver) { composerResizeObserver.disconnect(); composerResizeObserver = null; }
		container.empty();

		// ── Scène unique (le layout 2 colonnes est supprimé — maquette
		// validée 2026-07-10) : idle/loading/error → titre + composer
		// CENTRÉS dans la page (référence claude.ai, plus de zone
		// « Aperçu » vide) ; result → l'ÉDITEUR embarqué pleine page et
		// le composer EN BAS (variante B « chat »). `formCol` reste le
		// nom du parent du composer pour ne pas réécrire tout le bloc.
		const stage = container.createDiv({ cls: "qbd-ai-stage qbd-ai-stage--" + phase });
		// Zone résultat créée AVANT le composer : l'ordre DOM le met en bas.
		const resultZone = phase === "result" ? stage.createDiv({ cls: "qbd-ai-result-zone" }) : null;
		const formCol = stage;

		// ── Page header (absent en résultat : la barre du quiz suffit) ──
		if (phase !== "result") {
			const titleRow = formCol.createDiv({ cls: "qbd-ai-title-row" });
			const titleIcon = titleRow.createSpan({ cls: "qbd-ai-title-icon" });
			// Glyphe de marque NU à côté du titre serif, comme l'astérisque de
			// claude.ai — « sparkles » retenu sur planche comparative (2026-07-16).
			setIcon(titleIcon, "sparkles");
			titleRow.createEl("h2", { cls: "qbd-ai-title", text: t("ai.page.title") });
		}

		// ── La demande PARTIE, en bulle (référence claude.ai) ──
		// Elle n'apparaît que si le composer s'est vidé : c'est ce couple
		// (bulle qui monte / champ vide) qui fait « sentir » l'envoi. En
		// résultat, la page du quiz occupe l'écran et porte son propre
		// en-tête — une bulle de plus n'y ajouterait que du bruit.
		if (sentMessage && (phase === "loading" || phase === "error")) renderSentMessage(stage);

		// Zone du loader de génération : AU-DESSUS du composer (demande
		// 2026-07-10 — le loader préfigure le résultat, qui vit en haut).
		// display: contents en CSS → la carte reste un enfant flex direct.
		const loadingZone = phase === "loading" ? stage.createDiv({ cls: "qbd-ai-loading-zone" }) : null;

		// ── Fournisseur : bouton LOGO SEUL dans le pied du composer (la
		// carte « Modèle IA » est supprimée) — le menu garde logos, statut
		// et sous-titre ; le tooltip au survol porte nom + statut.
		// Aucun fournisseur par défaut : le choix reste la première étape,
		// le contrôle Modèle n'apparaît qu'une fois le fournisseur choisi.
		const provider = ctx.plugin.settings.aiProvider || "";
		const currentModel = provider
			? (ctx.plugin.settings.aiModel || aiProviders.getProvider(provider).defaultModel)
			: "";

		let providerSelect: SelectHandle<ProviderSelectOption> | null = null;
		const buildProviderControl = (parent: HTMLElement): void => {
			const sel = createSelect<ProviderSelectOption>(parent, {
				value: provider || undefined,
				options: aiProviders.PROVIDERS.map(p => ({ value: p.id, label: p.name, logo: p.logo, sub: p.sub })),
				renderTrigger: (el, o) => {
					if (!o) {
						// Aucun fournisseur : slot vide, le tooltip guide.
						const ic = el.createSpan({ cls: "qbd-provider-logo" });
						setIcon(ic, "circle-dashed");
						return;
					}
					const logo = el.createSpan({ cls: "qbd-provider-logo qbd-provider-logo--" + o.logo });
					aiProviders.setBrandLogo(logo, o.logo);
				},
				renderOption: (el, o) => {
					const logo = el.createSpan({ cls: "qbd-provider-logo qbd-provider-logo--" + o.logo });
					aiProviders.setBrandLogo(logo, o.logo);
					const body = el.createDiv({ cls: "qbd-provider-option-body" });
					body.createSpan({ cls: "qbd-select-option-label", text: o.label });
					const st = providerStatus[o.value];
					body.createSpan({ cls: "qbd-provider-option-sub", text: st ? st.text : o.sub });
					el.createSpan({ cls: "qbd-status-dot qbd-status-dot--" + (st ? st.dot : "checking") });
				},
				onChange: async (id) => {
					ctx.plugin.settings.aiProvider = id;
					ctx.plugin.settings.aiModel = aiProviders.getProvider(id).defaultModel;
					await ctx.plugin.saveSettings();
					render(container);
				},
				// Re-vérifie les CLI à CHAQUE ouverture du menu (force = sans TTL) :
				// après un « claude/codex update », la version affichée se met à
				// jour toute seule, le menu ouvert est redessiné à l'arrivée des
				// résultats (setStatus → refreshMenu).
				onOpen: () => refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, kimiCtl, buildOllamaList, force: true })
			});
			providerSelect = sel;
			sel.el.addClass("qbd-provider-trigger-logo");
			// Tooltip : nom + statut, relus à chaque survol (les détections
			// async peuvent arriver après le rendu).
			let tip: HTMLElement | null = null;
			const hide = () => { if (tip) { tip.remove(); tip = null; } };
			sel.el.addEventListener("mouseenter", () => {
				if (tip) return;
				tip = document.body.createDiv({ cls: "qbd-hover-tip" });
				const p = aiProviders.PROVIDERS.find(x => x.id === (ctx.plugin.settings.aiProvider || ""));
				tip.createDiv({ cls: "qbd-hover-tip-title", text: p ? p.name : t("ai.provider.choose") });
				const st = p && providerStatus[p.id];
				if (st) tip.createDiv({ cls: "qbd-hover-tip-body", text: st.text });
				const r = sel.el.getBoundingClientRect();
				tip.style.visibility = "hidden";
				const tr = tip.getBoundingClientRect();
				const left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8);
				let top = r.top - tr.height - 8;
				if (top < 8) top = r.bottom + 8;
				tip.style.left = left + "px";
				tip.style.top = top + "px";
				tip.style.visibility = "";
			});
			sel.el.addEventListener("mouseleave", hide);
			sel.el.addEventListener("click", hide);
		};

		// Le contrôle Modèle + effort vit désormais dans le pied du composer
		// (façon claude.ai) : on prépare ici sa fabrique, appelée plus bas.
		// La zone de hint reste sous le sélecteur de fournisseur.
		let hintZone: HTMLElement | null = null;
		let buildModelControl: ((parent: HTMLElement) => void) | null = null;
		// modelSelect : vestige de l'ancien contrôle, jamais assigné — conservé
		// pour la signature de refreshProviderStatuses.
		const modelSelect: unknown = null;
		// État partagé du contrôle Ollama : options mutables, derniers modèles
		// locaux détectés et rafraîchissement du libellé. La liste est reconstruite
		// à CHAQUE ouverture du menu (et sur détection async) → reflète toujours la
		// sélection courante des réglages, même éditée après le rendu de la vue.
		let ollamaCtl: OllamaCtl | null = null;
		// Idem pour Kimi : la liste vient du CLI (checkKimi), pas d'un fichier
		// lisible en sync → le trigger se redessine à l'arrivée de la détection.
		let kimiCtl: KimiCtl | null = null;

		// Construit les options Ollama depuis la sélection de l'utilisateur
		// (settings.aiOllamaModels, ordre réglable) + les locaux installés hors
		// sélection. `detected` = res.models de checkOllama ([{name,capabilities}])
		// ou null. Renvoie un tableau plat = UNE liste scrollable (façon app
		// Ollama), jusqu'à OLLAMA_MAX_MODELS.
		const buildOllamaList = (detected: aiProviders.OllamaDetectedModel[] | null): OllamaListItem[] => {
			const byNorm = new Map<string, aiProviders.OllamaDetectedModel>();
			(detected || []).forEach(m => byNorm.set(m.name.replace(/:latest$/, ""), m));
			const isInstalled = (v: string) => byNorm.has(v.replace(/:latest$/, ""));
			const iconFor = (cloud: boolean, installed: boolean): string | null => cloud ? "cloud" : (installed ? null : "download");
			const decorate = (meta: aiProviders.OllamaModelMeta): OllamaListItem => {
				const installed = meta.cloud ? true : isInstalled(meta.value);
				return { value: meta.value, label: meta.label, cloud: meta.cloud,
					thinking: meta.thinking !== false, installed, icon: iconFor(meta.cloud, installed) };
			};
			const catalog = ctx.plugin.settings.aiOllamaCatalog;
			const list = aiProviders.resolveOllamaSelection(ctx.plugin.settings.aiOllamaModels, catalog).map(decorate);
			// Modèles locaux installés hors sélection → ajoutés en fin de liste.
			(detected || []).forEach(m => {
				const norm = m.name.replace(/:latest$/, "");
				if (list.some(o => o.value === m.name || o.value.replace(/:latest$/, "") === norm)) return;
				list.push({ value: m.name, label: m.name.replace(":latest", ""), cloud: false,
					installed: true, thinking: (m.capabilities || []).includes("thinking"), icon: null });
			});
			// Modèle courant hors liste → placé en tête.
			const cur = ctx.plugin.settings.aiModel || currentModel;
			if (cur && !list.some(o => o.value === cur)) {
				list.unshift(decorate(aiProviders.getOllamaModelMeta(cur, catalog)));
			}
			return list;
		};
		// Claude Code et Codex (ChatGPT) partagent le même contrôle modèle+effort
		// (menu façon claude.ai). Seules changent la liste de modèles, la liste
		// d'efforts et la résolution du modèle (Fable expire côté Claude).
		if (provider === "claude-code" || provider === "codex") {
			const isClaude = provider === "claude-code";
			// Liste relue à CHAQUE usage (trigger + ouverture du menu) : côté
			// Claude, Fable expire à date ; côté Codex, la liste suit
			// ~/.codex/models_cache.json (nouveau modèle du compte → présent au
			// prochain clic, sans mise à jour manuelle du plugin).
			const getModels = (): aiProviders.ModelDef[] => isClaude ? aiProviders.getClaudeModels() : aiProviders.getDefaultModels("codex");
			const resolveMv = (v?: string): string => isClaude ? aiProviders.resolveClaudeModel(v) : aiProviders.resolveCodexModel(v);
			// Modèle et effort = DEUX boutons séparés (référence claude.ai /
			// ChatGPT). Le modèle ouvre le menu de modèles (sans ligne Effort) ;
			// l'effort ouvre le popover slider (openEffortSlider), variante
			// claude ou codex. Les efforts Codex dépendent du modèle courant
			// (supported_reasoning_levels) → tout est relu à chaque usage.
			buildModelControl = (parent: HTMLElement): void => {
				const currentMv = () => resolveMv(ctx.plugin.settings.aiModel || currentModel);
				const currentEfforts = () => aiProviders.getEfforts(provider, currentMv());
				const currentEv = () => aiProviders.resolveEffort(provider, ctx.plugin.settings.aiEffort, currentMv());

				// Référence Claude Code : « Opus 4.8  Max » — libellés nus,
				// SANS chevrons, rapprochés (l'effort en Capitalisé).
				const trigger = parent.createEl("button", { cls: "qbd-select qbd-model-trigger qbd-composer-plain" });
				trigger.type = "button";
				const trigLabel = trigger.createSpan({ cls: "qbd-select-label" });

				const effortBtn = parent.createEl("button", { cls: "qbd-select qbd-effort-trigger qbd-composer-plain" });
				effortBtn.type = "button";
				const effortLabel = effortBtn.createSpan({ cls: "qbd-select-label qbd-effort-trigger-label" });

				const EFFORT_DISPLAY: Record<string, string> = {
					low: "Low", medium: "Medium", high: "High",
					xhigh: "Extra", max: "Max", ultracode: "Ultracode", ultra: "Ultra"
				};

				const refreshTriggers = () => {
					trigLabel.empty();
					const models = getModels();
					const cur = models.find(m => m.value === currentMv()) || models[0];
					// Fast actif (codex) → éclair à gauche du nom du modèle,
					// comme la pill du composer ChatGPT.
					if (!isClaude && ctx.plugin.settings.aiCodexFast && cur.fast) {
						const z = trigLabel.createSpan({ cls: "qbd-model-trigger-zap" });
						setIcon(z, "zap");
					}
					trigLabel.createSpan({ cls: "qbd-model-trigger-name", text: cur.label });
					const ev = currentEv();
					const ef = currentEfforts().find(e => e.value === ev);
					effortLabel.setText(EFFORT_DISPLAY[ev] || (ef ? ef.label : ev));
					effortBtn.classList.toggle("is-ultra", !!(ef && ef.accent));
				};
				refreshTriggers();

				trigger.addEventListener("click", () => {
					openModelMenu(trigger, {
						models: getModels(),
						currentModel: currentMv(),
						// L'effort a son propre bouton → pas de ligne Effort ici.
						efforts: [],
						onPickModel: async (v) => {
							ctx.plugin.settings.aiModel = v;
							await ctx.plugin.saveSettings();
							refreshTriggers();
						}
					});
				});

				effortBtn.addEventListener("click", () => {
					// Éclair Fast (codex) : seulement si CE modèle expose le tier
					// « priority » (models_cache) — toggle persisté aiCodexFast.
					const curModel = getModels().find(m => m.value === currentMv());
					const fast = (!isClaude && curModel && curModel.fast) ? {
						on: !!ctx.plugin.settings.aiCodexFast,
						onToggle: async (v: boolean) => {
							ctx.plugin.settings.aiCodexFast = v;
							await ctx.plugin.saveSettings();
							refreshTriggers(); // éclair du bouton modèle
						}
					} : null;
					openEffortSlider(effortBtn, {
						variant: isClaude ? "claude" : "codex",
						efforts: currentEfforts(),
						currentEffort: currentEv(),
						fast,
						onPickEffort: async (v) => {
							ctx.plugin.settings.aiEffort = v;
							await ctx.plugin.saveSettings();
							refreshTriggers();
						}
					});
				});
			};
		} else if (provider === "kimi-code") {
			// Kimi : modèle SEUL (pas de bouton effort — `kimi -p` n'expose
			// aucun flag d'effort, cf. getEfforts). La liste vient du CLI et
			// n'existe qu'une fois le compte connecté : tant qu'elle est vide,
			// le trigger affiche « Connexion requise » et n'ouvre pas de menu
			// vide — le hint sous le composer explique quoi faire.
			kimiCtl = { refreshTrigger: null };
			const ctl = kimiCtl;
			buildModelControl = (parent: HTMLElement): void => {
				const trigger = parent.createEl("button", { cls: "qbd-select qbd-model-trigger qbd-composer-plain" });
				trigger.type = "button";
				const trigLabel = trigger.createSpan({ cls: "qbd-select-label" });
				const currentMv = () => aiProviders.resolveKimiModel(ctx.plugin.settings.aiModel || currentModel);
				const refreshTrigger = () => {
					trigLabel.empty();
					const models = aiProviders.getKimiModels();
					const cur = models.find(m => m.value === currentMv()) || models[0];
					trigLabel.createSpan({
						cls: "qbd-model-trigger-name",
						text: cur ? cur.label : t("ai.status.loginRequired")
					});
					trigger.disabled = !models.length;
				};
				refreshTrigger();
				ctl.refreshTrigger = refreshTrigger;
				trigger.addEventListener("click", () => {
					const models = aiProviders.getKimiModels();
					if (!models.length) return;
					openModelMenu(trigger, {
						models,
						currentModel: currentMv(),
						efforts: [],
						onPickModel: async (v) => {
							ctx.plugin.settings.aiModel = v;
							await ctx.plugin.saveSettings();
							refreshTrigger();
						}
					});
				});
			};
		} else if (provider) {
			// Ollama partage le MÊME contrôle modèle+effort que Claude/Codex
			// (openModelMenu). L'effort est réel : câblé sur le param `think` de
			// l'API Ollama (low/medium/high/max). La ligne Effort n'apparaît que
			// pour un modèle à raisonnement (thinking). Les icônes nuage/
			// téléchargement/rien reproduisent l'app Ollama.
			const efforts = aiProviders.getEfforts(provider);
			// `detected` = derniers modèles locaux vus par checkOllama (pour les
			// ré-annexer à la reconstruction). La liste est reconstruite à CHAQUE
			// ouverture du menu → reflète toujours la sélection courante des réglages.
			ollamaCtl = { options: buildOllamaList(null), detected: null, refreshTrigger: null };
			const ctl = ollamaCtl;
			buildModelControl = (parent: HTMLElement): void => {
				const trigger = parent.createEl("button", { cls: "qbd-select qbd-model-trigger" });
				trigger.type = "button";
				const trigLabel = trigger.createSpan({ cls: "qbd-select-label" });
				const trigChev = trigger.createSpan({ cls: "qbd-select-chevron" });
				setIcon(trigChev, "chevron-down");
				const curOpt = (): OllamaListItem | undefined => {
					const mv = ctx.plugin.settings.aiModel || currentModel;
					return ctl.options.find(o => o.value === mv) || ctl.options[0];
				};
				const refreshTrigger = () => {
					trigLabel.empty();
					const cur = curOpt();
					const mv = ctx.plugin.settings.aiModel || currentModel;
					trigLabel.createSpan({ cls: "qbd-model-trigger-name", text: cur ? cur.label : (mv || "").replace(":latest", "") });
					if (cur && cur.thinking) {
						trigLabel.createSpan({ cls: "qbd-model-trigger-effort", text: aiProviders.getEffortLabel(aiProviders.resolveEffort(provider, ctx.plugin.settings.aiEffort), provider) });
					}
				};
				refreshTrigger();
				ctl.refreshTrigger = refreshTrigger;
				trigger.addEventListener("click", () => {
					// Reconstruit à l'ouverture → la liste suit la sélection des
					// réglages (settings.aiOllamaModels) même modifiée après le rendu.
					ctl.options = buildOllamaList(ctl.detected);
					refreshTrigger();
					const cur = curOpt();
					openModelMenu(trigger, {
						models: ctl.options,
						searchable: true,
						currentModel: ctx.plugin.settings.aiModel || currentModel,
						efforts: (cur && cur.thinking) ? efforts : [],
						currentEffort: aiProviders.resolveEffort(provider, ctx.plugin.settings.aiEffort),
						onPickModel: async (v) => {
							ctx.plugin.settings.aiModel = v;
							await ctx.plugin.saveSettings();
							refreshTrigger();
						},
						onPickEffort: async (v) => {
							ctx.plugin.settings.aiEffort = v;
							await ctx.plugin.saveSettings();
							refreshTrigger();
						}
					});
				});
			};
		}


		// ── Composer (champ unique + bouton « + » d'attachements) ──
		let generateBtnRef: HTMLButtonElement | null = null;

		const composer = formCol.createDiv({ cls: "qbd-ai-composer" });

		// Vignettes d'images : rangée à PART, au-dessus du champ — ~40px de
		// haut, les mêler à une ligne de texte de 13,5px les déformerait.
		// Seules les chips « notes » passent en superposition sur la 1ʳᵉ
		// ligne du texte (cf. textZone ci-dessous).
		if (images.length > 0) {
			const imagesRow = composer.createDiv({ cls: "qbd-ai-composer-attachments" });
			for (let i = 0; i < images.length; i++) {
				const thumb = imagesRow.createDiv({ cls: "qbd-ai-image-thumb" });
				const imgEl = thumb.createEl("img", { cls: "qbd-ai-image-thumb-img" });
				imgEl.src = images[i].url;
				const removeBtn = thumb.createEl("button", { cls: "qbd-ai-image-remove" });
				setIcon(removeBtn, "x");
				const idx = i;
				removeBtn.addEventListener("click", () => {
					URL.revokeObjectURL(images[idx].url);
					images.splice(idx, 1);
					render(containerRef);
				});
			}
		}

		// Zone de texte : le textarea et la rangée de chips « notes »
		// partagent ce conteneur (position relative). La rangée se
		// superpose en absolu sur la PREMIÈRE ligne du texte — un
		// <textarea> ne pouvant contenir aucun élément, c'est la seule
		// façon de les mettre « sur la ligne » sans passer en
		// contenteditable (interdit : casserait dictée/caret/auto-grow/
		// collage). `layoutChipsRow` (posé après la création du textarea)
		// mesure la largeur réelle de la rangée et pose `text-indent` en
		// conséquence — ou bascule en repli (rangée au-dessus, en flux
		// normal) si elle est trop large pour laisser de la place au texte.
		const textZone = composer.createDiv({ cls: "qbd-ai-composer-textzone" });
		let chipsRow: HTMLElement | null = null;
		if (noteAttachments.length > 0) {
			chipsRow = textZone.createDiv({ cls: "qbd-ai-composer-chips" });
			for (let i = 0; i < noteAttachments.length; i++) {
				const note = noteAttachments[i];
				const chip = chipsRow.createDiv({ cls: "qbd-ai-note-chip" });
				const chipIcon = chip.createSpan({ cls: "qbd-ai-note-chip-icon" });
				setIcon(chipIcon, "file-text");
				const chipName = chip.createSpan({
					cls: "qbd-ai-note-chip-name",
					text: (note.expanded && note.path) ? note.path : note.name
				});
				// Tooltip natif = le chemin ENTIER, toujours, y compris replié :
				// `max-width` + ellipsis peuvent tronquer même le chemin déplié
				// (mesuré : scrollWidth > clientWidth dès un chemin un peu long),
				// et déplier sert précisément à le lire.
				chipName.title = note.path || note.name;
				// Bascule nom+extension ⇄ chemin complet — seulement si un
				// chemin est connu (un fichier déposé/choisi SANS origine
				// connue — ni vault ni racine externe — n'en a pas : alors rien
				// à déplier, la chip ne réagit pas au clic).
				if (note.path) {
					chip.addClass("qbd-ai-note-chip--toggle");
					chip.addEventListener("click", (e) => {
						if ((e.target as HTMLElement).closest(".qbd-ai-note-chip-remove")) return;
						note.expanded = !note.expanded;
						render(containerRef);
					});
				}
				const chipRemove = chip.createEl("button", { cls: "qbd-ai-note-chip-remove" });
				setIcon(chipRemove, "x");
				const idx = i;
				chipRemove.addEventListener("click", (e) => {
					e.stopPropagation(); // ne déclenche pas le basculement du chip
					noteAttachments.splice(idx, 1);
					render(containerRef);
				});
			}
		}

		const composerInput = textZone.createEl("textarea", { cls: "qbd-ai-composer-input" });
		// Picker « @ » : déclaré avant la dictée pour que celle-ci puisse
		// interroger son état (les deux écoutent le même textarea).
		let mentions: MentionPickerHandle | null = null;
		// Dictée vocale push-to-talk (opt-in — réglages « Saisie vocale »).
		voiceInput.attach(ctx, composerInput, { isBlocked: () => !!mentions && mentions.isOpen() });
		// Au moins une pièce jointe (chip note/PDF ou vignette image) : la
		// question d'origine n'a plus de sens (le fichier EST le sujet) — le
		// placeholder invite alors à des instructions facultatives. Recalculé
		// à chaque render (composerInput est recréé à chaque fois) : repasse
		// à la question dès la dernière pièce retirée (×, Backspace au
		// caret 0, ou remove d'image), même chemin de rendu.
		composerInput.placeholder = (images.length > 0 || noteAttachments.length > 0)
			? t("ai.composer.placeholderAttached")
			: t("ai.composer.placeholder");
		composerInput.value = composerText;
		composerInput.rows = 2;
		const autoGrow = () => {
			composerInput.style.height = "auto";
			composerInput.style.height = Math.min(composerInput.scrollHeight, 220) + "px";
		};
		// Fait suivre la rangée de chips au défilement interne du textarea
		// (max-height: 220px, overflow-y: auto) : sans ça, la rangée reste
		// ancrée au CADRE (top: 0 de .qbd-ai-composer-textzone) pendant que
		// le texte défile dessous, et une chip au fond opaque vient amputer
		// le début des lignes qui défilent sous elle. En appliquant le MÊME
		// décalage que le scroll interne, la rangée se comporte comme si elle
		// faisait partie de la ligne 0 : elle défile et disparaît avec elle.
		// `overflow: hidden` sur .qbd-ai-composer-textzone (CSS) l'empêche de
		// déborder du cadre une fois remontée. Rien à faire en mode --stacked
		// (flux normal, ne chevauche jamais le texte) : transform vidé.
		const syncChipsScroll = () => {
			if (!chipsRow) return;
			const stacked = chipsRow.classList.contains("qbd-ai-composer-chips--stacked");
			chipsRow.style.transform = stacked ? "" : "translateY(-" + composerInput.scrollTop + "px)";
		};
		composerInput.addEventListener("scroll", syncChipsScroll);
		// Mesure la rangée de chips (superposée à la 1ʳᵉ ligne) et pose le
		// text-indent en conséquence — RECALCULÉ à chaque appel (jamais codé
		// en dur : police, contenu et nombre de chips varient). Au-delà de
		// ~55 % de la largeur du composer, la rangée ne tient plus à côté du
		// texte : repli en flux normal au-dessus (classe --stacked), sans
		// text-indent. Ça arrive avec PLUSIEURS chips (chaque chip est
		// plafonnée à 240px de large) — JAMAIS avec une seule, même dépliée
		// sur son chemin complet : à 240px de max-width, une chip seule ne
		// peut pas dépasser 0,55 × largeur usuelle du composer (~732px) =
		// ~402px. (Ce commentaire promettait l'inverse — corrigé : ce projet
		// s'est déjà fait piéger deux fois par un commentaire qui annonce
		// autre chose que ce que fait le code.)
		const layoutChipsRow = () => {
			if (!chipsRow || !chipsRow.isConnected) return;
			const composerWidth = composer.getBoundingClientRect().width;
			// Largeur NATURELLE de la rangée = somme des chips + gaps, jamais
			// chipsRow.getBoundingClientRect().width directement : une fois en
			// --stacked (position: static, flex-wrap: wrap), la rangée est un
			// conteneur flex de niveau bloc SANS largeur déclarée → elle
			// s'étire à la largeur de son PARENT (textZone, quasi la carte
			// entière), pas à celle de son contenu. Mesurer cette largeur
			// gonflée aurait empêché tout retour en mode non-replié une fois
			// basculé (hystérésis : rétrécir puis ragrandir le composer
			// restait bloqué en --stacked — trouvé en testant le
			// ResizeObserver ci-dessous, qui rend ce recalcul répété au lieu
			// d'unique). Les chips elles-mêmes gardent leur taille propre
			// quel que soit le mode de la rangée : les additionner est fiable
			// dans les deux sens.
			const chips = Array.from(chipsRow.children) as HTMLElement[];
			const gap = parseFloat(getComputedStyle(chipsRow).columnGap) || 0;
			const chipsWidth = chips.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0)
				+ gap * Math.max(0, chips.length - 1);
			const GUTTER = 10;
			const fits = composerWidth > 0 && chipsWidth <= composerWidth * 0.55;
			chipsRow.classList.toggle("qbd-ai-composer-chips--stacked", !fits);
			composerInput.style.textIndent = fits ? (chipsWidth + GUTTER) + "px" : "";
			// Le passage en --stacked change immédiatement la transform (sinon
			// elle resterait décalée d'un ancien scroll jusqu'au prochain
			// événement "scroll", qui peut ne jamais venir en mode replié).
			syncChipsScroll();
		};
		// Re-mesure quand la carte change de largeur (pane redimensionné, zoom
		// Obsidian) : sans ça, la valeur de text-indent posée au premier
		// render reste périmée — pattern repris de engine/viewport.ts
		// (bindViewportResizeObserver) : ResizeObserver + comparaison de
		// largeur pour ignorer les callbacks qui ne changent rien (un
		// changement de HAUTEUR de la carte, ex. bascule --stacked, redéclenche
		// l'observer sans que la largeur ait bougé). Déconnecté au prochain
		// render (cf. le début de render()) — jamais réutilisé tel quel : ce
		// n'est pas le MÊME domaine (pas de piste de slides ici), seulement la
		// même technique.
		if (chipsRow && typeof ResizeObserver !== "undefined") {
			let lastComposerWidth = Math.round(composer.getBoundingClientRect().width || 0);
			composerResizeObserver = new ResizeObserver((entries) => {
				const entry = entries[0];
				if (!entry) return;
				const width = Math.round(entry.contentRect.width || composer.getBoundingClientRect().width || 0);
				if (width === lastComposerWidth) return;
				lastComposerWidth = width;
				layoutChipsRow();
			});
			composerResizeObserver.observe(composer);
		}
		composerInput.addEventListener("input", (e) => {
			const ta = e.target as HTMLTextAreaElement;
			composerText = ta.value;
			composerCaret = ta.selectionStart;
			autoGrow();
			updateGenerateBtn(generateBtnRef);
		});
		// Un simple déplacement du caret (clic souris, flèches) ne déclenche
		// PAS d'événement "input" (la valeur ne change pas) : sans ce filet,
		// repositionner le curseur puis attacher via le menu « + » ou un
		// glisser-déposer (aucune frappe entre les deux) le renvoyait quand
		// même en fin de texte, composerCaret restant figé sur la dernière
		// frappe.
		const captureCaret = () => { composerCaret = composerInput.selectionStart; };
		composerInput.addEventListener("keyup", captureCaret);
		composerInput.addEventListener("click", captureCaret);
		// Coller une image directement dans le champ
		composerInput.addEventListener("paste", (e) => {
			const files = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith("image/"));
			if (files.length > 0) {
				e.preventDefault();
				addImageFiles(files);
			}
		});
		// Enter = générer, Shift+Enter = saut de ligne (référence claude.ai).
		// Enter nu n'insère JAMAIS de retour (même champ vide / pendant une
		// génération) ; isComposing protège la saisie IME.
		composerInput.addEventListener("keydown", (e) => {
			// Le menu « @ » a le clavier tant qu'il est ouvert (recherche) :
			// ni Entrée (le picker gère sa propre sélection) ni Backspace
			// (sinon effacer une lettre de sa recherche supprimerait une
			// pièce jointe) ne doivent lui être volés.
			if (mentions && mentions.isOpen()) return;
			// Backspace en tout début de champ (rien à gauche du caret,
			// aucune sélection) : retire la DERNIÈRE pièce jointe —
			// convention chips (Gmail, Slack). Un Backspace avec du texte à
			// gauche du caret garde son comportement normal.
			if (e.key === "Backspace" && composerInput.selectionStart === 0 && composerInput.selectionEnd === 0
				&& (noteAttachments.length > 0 || images.length > 0)) {
				e.preventDefault();
				removeLastAttachment();
				return;
			}
			if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
			e.preventDefault();
			if (phase !== "loading" && canGenerate()) startGeneration(containerRef);
		});
		requestAnimationFrame(() => { autoGrow(); layoutChipsRow(); });

		mentions = attachMentionPicker(ctx.app, composerInput, composer, {
			onPickVaultFile: (path) => { void attachVaultPath(path); },
			onPickExternalFile: (path) => { void attachExternalPath(path); },
			onTextReplaced: (value) => {
				composerText = value;
				composerCaret = composerInput.selectionStart;
				autoGrow();
				updateGenerateBtn(generateBtnRef);
			},
			// Lu au rendu (le réglage peut changer sans rouvrir la vue).
			// Accesseur vérifié le 2026-07-16 : ai.ts lit « ctx.plugin.settings.<clé> »
			// (cf. ligne 171 par ex.), il n'existe PAS de ctx.settings() dans ce module.
			getExtraRoots: () => ctx.plugin.settings.aiMentionExtraFolders || [],
		});

		// Rangée du bas : bouton « + » (gauche), puis à droite le modèle +
		// effort (façon claude.ai) et le bouton d'envoi.
		const composerBottom = composer.createDiv({ cls: "qbd-ai-composer-bottom" });
		const addBtn = composerBottom.createEl("button", { cls: "qbd-ai-composer-add" });
		addBtn.type = "button";
		addBtn.setAttribute("aria-label", t("ai.composer.addContent"));
		setIcon(addBtn, "plus");

		// Bouton Options (questions + type) : JUSTE à droite du « + » (façon
		// pills gauche de claude.ai, demande 2026-07-16) — popover à la
		// demande, tooltip d'état.
		const optsBtn = composerBottom.createEl("button", { cls: "qbd-ai-composer-opts" });
		optsBtn.type = "button";
		setIcon(optsBtn, "sliders-horizontal");
		labelIconButton(optsBtn, t("ai.composer.quizOptions"));
		optsBtn.addEventListener("click", () => {
			// Le menu ne connaît que des libellés : on traduit à l'aller et on
			// retraduit la sélection en valeur canonique au retour.
			openOptionsMenu(optsBtn, {
				count: questionCount,
				type: typeLabel(questionType), types: typeLabels(),
				onCount: (n) => { questionCount = n; },
				onType: (label) => { questionType = typeValue(label); }
			});
		});
		// Tooltip au survol : l'état courant (« 5 questions · Mixte »),
		// relu à chaque hover — pattern attachHoverTip.
		attachHoverTip(optsBtn, (tip) => {
			tip.createDiv({ cls: "qbd-hover-tip-title", text: t("ai.options.tooltip", { count: questionCount, type: typeLabel(questionType) }) });
		});

		/* Consultation du forfait, à sa place de contrôle : dans le composer,
		   avec le « + » et les options (référence Ahmed 2026-07-30). Savoir ce
		   qu'il reste n'a d'intérêt que si on peut le demander SANS dépenser,
		   d'où un bouton toujours accessible plutôt qu'un badge d'après-coup.
		   Réservé aux fournisseurs qui publient réellement un forfait. */
		if (Platform.isDesktopApp && providerPublishesPlan(ctx.plugin.settings.aiProvider || "")) {
			const usageBtn = composerBottom.createEl("button", { cls: "qbd-ai-composer-usage" });
			usageBtn.type = "button";
			setIcon(usageBtn, "gauge");
			labelIconButton(usageBtn, t("ai.usage.title"));
			attachHoverTip(usageBtn, (tip) => {
				tip.createDiv({ cls: "qbd-hover-tip-title", text: t("ai.usage.title") });
				const tightest = tightestRow(lastPlan?.rows || []);
				if (tightest) {
					tip.createDiv({
						cls: "qbd-hover-tip-body",
						text: `${usageRowLabel(tightest)} · ${t("ai.usage.usedPercent", { n: Math.round(tightest.usedPercent) })}`
					});
				}
			});
			usageBtn.addEventListener("click", () => openUsage());
		}

		// Groupe droite : logo fournisseur, sélecteur modèle + effort, puis
		// bouton d'envoi.
		const composerTools = composerBottom.createDiv({ cls: "qbd-ai-composer-tools" });
		buildProviderControl(composerTools);
		if (buildModelControl) buildModelControl(composerTools);

		// Bouton générer dans le composer (façon bouton d'envoi claude.ai) :
		// caché tant que le champ est vide, flèche ↑ blanche sur fond accent.
		// Pendant la génération il devient le bouton STOP (carré + tooltip
		// « Arrêter Esc ») qui annule réellement la génération.
		const sendBtn = composerTools.createEl("button", { cls: "qbd-ai-composer-send" });
		sendBtn.type = "button";
		const sendIcon = sendBtn.createSpan({ cls: "qbd-ai-composer-send-icon" });
		if (phase === "loading") {
			sendBtn.addClass("is-stop");
			// Pas d'aria-label ici : Obsidian en fait un tooltip natif,
			// redondant avec le tooltip custom « Arrêter Esc ».
			// Carré dessiné en CSS (l'icône Lucide est trop fine/petite).
			sendIcon.createDiv({ cls: "qbd-ai-stop-square" });
			attachStopTip(sendBtn);
			sendBtn.addEventListener("click", () => { if (activeClient) activeClient.abort(); });
		} else {
			sendBtn.setAttribute("aria-label", t("ai.composer.generate"));
			setIcon(sendIcon, "arrow-up");
			sendBtn.addEventListener("click", () => {
				if (canGenerate()) startGeneration(containerRef);
			});
		}
		generateBtnRef = sendBtn;
		updateGenerateBtn(generateBtnRef);

		// PAS d'attribut accept : le dialogue Windows affiche alors « Tous
		// les fichiers (*.*) » (référence claude.ai, capture Ahmed) au lieu
		// d'une liste d'extensions illisible — la validation par type se
		// fait dans addComposerFiles, avec explication en cas de refus.
		const fileInput = composer.createEl("input", { type: "file", cls: "qbd-ai-file-input" });
		fileInput.multiple = true;
		fileInput.addEventListener("change", (e) => {
			const target = e.target as HTMLInputElement;
			if (target.files?.length) addComposerFiles(Array.from(target.files));
			// Re-choisir le même fichier doit re-déclencher `change`.
			target.value = "";
		});
		fileInputRef = fileInput;
		addBtnRef = addBtn;

		// Menu « + » (maquette Ahmed 2026-07-11 231626) : deux actions,
		// raccourci configurable affiché à droite (réglages du plugin).
		addBtn.addEventListener("click", () => {
			openActionMenu(addBtn, [
				{
					icon: "paperclip",
					label: t("ai.add.files"),
					hint: formatHotkey(ctx.plugin.settings.hotkeyAddFiles),
					onClick: () => fileInput.click()
				},
				{
					icon: "file-text",
					label: t("ai.add.notes"),
					hint: formatHotkey(ctx.plugin.settings.hotkeyAddNotes),
					onClick: () => openAddNotes()
				}
			]);
		});

		// Toute la carte est cliquable pour écrire (demande 2026-07-10) :
		// un clic hors des contrôles focus le champ, caret en fin de texte.
		// mousedown natif du textarea préservé (positionnement du caret).
		composer.addEventListener("mousedown", (e) => {
			if ((e.target as HTMLElement).closest("button, textarea, .qbd-select, .qbd-ai-note-chip, .qbd-ai-image-thumb")) return;
			e.preventDefault(); // pas de blur/re-focus visible
			const len = composerInput.value.length;
			composerInput.focus();
			composerInput.setSelectionRange(len, len);
			composerCaret = len;
		});

		// Glisser-déposer de fichiers (images, .md, .txt) sur tout le composer
		composer.addEventListener("dragover", (e) => {
			e.preventDefault();
			composer.classList.add("qbd-ai-composer--dragover");
		});
		composer.addEventListener("dragleave", () => composer.classList.remove("qbd-ai-composer--dragover"));
		composer.addEventListener("drop", (e) => {
			e.preventDefault();
			composer.classList.remove("qbd-ai-composer--dragover");
			if (e.dataTransfer?.files?.length) addComposerFiles(Array.from(e.dataTransfer.files));
		});

		// Hint contextuel du fournisseur (CLI absent, serveur offline…) :
		// sous le composer depuis la suppression de la carte « Modèle IA ».
		// :empty → masqué ; rempli par refreshProviderStatuses/renderHint.
		if (provider) hintZone = formCol.createDiv({ cls: "qbd-ai-model-hint" });

		// Détections async (statut fournisseur + modèles réels) : APRÈS la
		// création de hintZone — l'appel fige ses arguments, et un hintZone
		// encore null rendait renderHint muet : « ChatGPT sélectionné, CLI
		// absent, aucun message » (vécu Ahmed, Codex CLI). Aussi après le
		// contrôle modèle (modelSelect existe). ollamaCtl et buildOllamaList
		// sont locaux à render → passés en paramètres (les référencer depuis
		// la fonction sœur lançait un ReferenceError, statut Ollama gelé).
		refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, kimiCtl, buildOllamaList });

		// Retour de focus fenêtre = l'utilisateur revient du terminal où il
		// vient d'installer/connecter un CLI : re-vérifier automatiquement
		// tant qu'un problème est affiché — sinon le hint d'erreur reste
		// figé et « l'installation n'est pas détectée » (vécu Codex CLI).
		if (__focusRecheck) window.removeEventListener("focus", __focusRecheck);
		__focusRecheck = () => {
			if (!hintZone || !hintZone.isConnected) {
				if (__focusRecheck) window.removeEventListener("focus", __focusRecheck);
				__focusRecheck = null;
				return;
			}
			if (!hintZone.querySelector(".qbd-ai-hint--err, .qbd-ai-hint--warn")) return;
			refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, kimiCtl, buildOllamaList, force: true });
		};
		window.addEventListener("focus", __focusRecheck);

		// (Les options Questions/Type vivent dans le popover du bouton
		// sliders du composer — l'ancienne carte « Options » est supprimée.)

		// ── État de la scène : loader AU-DESSUS du composer, erreur sous
		// le composer, ou l'éditeur embarqué dans la zone résultat. ──
		if (phase === "loading") renderLoading(loadingZone!);
		else if (phase === "error") renderError(stage);
		else if (phase === "result") renderResult(resultZone!);

		// Onglet ouvert → saisie immédiate sans clic (demande 2026-07-10).
		// Pas en phase résultat : le focus serait volé à l'éditeur embarqué
		// à chaque re-render.
		if (phase === "idle" || phase === "error") {
			requestAnimationFrame(() => {
				if (composerInput.isConnected) {
					composerInput.focus({ preventScroll: true });
					if (composerCaret !== null) {
						const p = Math.min(composerCaret, composerInput.value.length);
						composerInput.setSelectionRange(p, p);
					}
				}
			});
		}
	}

	/* Ajoute le modèle courant à la liste s'il n'y figure pas
	   (modèle personnalisé saisi ailleurs). */
	function withCurrentOption(models: aiProviders.ModelDef[], current?: string): aiProviders.ModelDef[] {
		if (!current || models.some(m => m.value === current)) return models;
		return [...models, { value: current, label: current, hint: "personnalisé" }];
	}

	/* Derniers statuts connus par provider : { dot, text }.
	   Lus par le sélecteur de fournisseur (trigger + options). */
	const providerStatus: Record<string, ProviderStatusEntry> = {};

	/* Dernier hint connu par provider (null = rien à signaler). Le sélecteur
	   affiche déjà le statut de CHAQUE fournisseur : le hint correspondant est
	   donc calculé pour tous, pas seulement pour l'actif, et ré-affiché
	   instantanément au changement de fournisseur — plus d'attente de la
	   détection avant de voir « Ollama n'est pas installé ». La détection
	   continue de tourner derrière et corrige l'affichage si l'état a changé. */
	const providerHint: Record<string, HintOptions | null> = {};

	function setHint(id: string, zone: HTMLElement | null, active: string, opts: HintOptions | null): void {
		providerHint[id] = opts;
		if (id === active) renderHint(zone, opts);
	}

	function setStatus(id: string, providerSelect: SelectHandle<ProviderSelectOption> | null, dot: string, text: string): void {
		providerStatus[id] = { dot, text };
		// Redessine le trigger (dot de statut du fournisseur choisi) et les
		// options du menu s'il est ouvert (versions re-détectées à l'ouverture).
		if (providerSelect && providerSelect.el.isConnected) {
			providerSelect.setValue((ctx.plugin.settings.aiProvider || undefined) as string);
			if (providerSelect.refreshMenu) providerSelect.refreshMenu();
		}
	}

	/* Commande d'installation par fournisseur — CHAQUE fournisseur absent en
	   propose une, dans un bloc code prêt à coller (demande Ahmed). Formes
	   officielles vérifiées le 2026-07-14 :
	   - Claude Code : installateur natif, « Native Install (Recommended) »
	     (code.claude.com/docs/en/setup) ;
	   - Codex CLI : installateur officiel de la plateforme
	     (learn.chatgpt.com/docs/codex/cli) ;
	   - Ollama : winget (paquet officiel Ollama.Ollama) sur Windows, le
	     script officiel ailleurs — docs.ollama.com ne publie pas de one-liner
	     PowerShell, l'exe d'installation étant la voie mise en avant ;
	   - Kimi Code : installateurs officiels de code.kimi.com (scripts lus le
	     2026-07-16 ; install.sh refuse explicitement Windows → install.ps1). */
	function installCmd(provider: "claude-code" | "codex" | "kimi-code" | "ollama"): { code: string; lang: string } {
		const win = Platform.isWin;
		if (provider === "claude-code") {
			return win
				? { code: "irm https://claude.ai/install.ps1 | iex", lang: "powershell" }
				: { code: "curl -fsSL https://claude.ai/install.sh | bash", lang: "bash" };
		}
		if (provider === "codex") {
			return win
				? { code: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', lang: "powershell" }
				: { code: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", lang: "bash" };
		}
		if (provider === "kimi-code") {
			return win
				? { code: "irm https://code.kimi.com/kimi-code/install.ps1 | iex", lang: "powershell" }
				: { code: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash", lang: "bash" };
		}
		return win
			? { code: "winget install --id Ollama.Ollama -e", lang: "powershell" }
			: { code: "curl -fsSL https://ollama.com/install.sh | sh", lang: "bash" };
	}

	/* Hint contextuel sous la rangée modèle : icône + texte
	   + action optionnelle (lien externe, réglages, commande).
	   Grille : [icône | texte | action] et, s'il y a une commande, un
	   bloc code sur sa PROPRE ligne (pleine largeur sous le texte et le
	   bouton) — une commande d'installation ne doit jamais se casser en
	   deux morceaux dans une colonne étroite. */
	function renderHint(zone: HTMLElement | null, opts: HintOptions | null): void {
		if (!zone || !zone.isConnected) return;
		zone.empty();
		if (!opts) return;
		const hint = zone.createDiv({
			cls: "qbd-ai-hint qbd-ai-hint--" + (opts.type || "info")
				+ (opts.code ? " qbd-ai-hint--has-code" : "")
		});
		const icon = hint.createSpan({ cls: "qbd-ai-hint-icon" });
		setIcon(icon, opts.icon || (opts.type === "err" ? "alert-circle" : "info"));
		const body = hint.createDiv({ cls: "qbd-ai-hint-body" });
		body.createSpan({ cls: "qbd-ai-hint-text", text: opts.text });
		if (opts.action) {
			const btn = hint.createEl("button", { cls: "qbd-ai-hint-action" });
			btn.type = "button";
			if (opts.action.icon) {
				const aIcon = btn.createSpan({ cls: "qbd-ai-hint-action-icon" });
				setIcon(aIcon, opts.action.icon);
			}
			btn.createSpan({ text: opts.action.label });
			btn.addEventListener("click", opts.action.onClick);
		}
		if (opts.code) renderHintCode(hint, opts.code, opts.lang || "bash");
	}

	/* Bloc commande = VRAI bloc code Obsidian, rendu par le moteur Markdown de
	   l'app plutôt qu'imité. On hérite ainsi de la coloration Prism, du style
	   de bloc code de l'utilisateur (thème + snippets — d'où markdown-rendered
	   ET markdown-preview-view, les deux racines que ces CSS ciblent) et du
	   bouton « copier » posé par le post-processeur natif. */
	function renderHintCode(hint: HTMLElement, code: string, lang: string): void {
		const box = hint.createDiv({
			cls: "qbd-ai-hint-code markdown-rendered markdown-preview-view"
		});
		// Component = la vue (pas le plugin) : le rendu est libéré quand
		// l'onglet se ferme, pas seulement au déchargement du plugin.
		void MarkdownRenderer.render(
			ctx.app, "```" + lang + "\n" + code + "\n```", box, "", ctx.view
		);
	}

	function openPluginSettings(): void {
		const setting = (ctx.app as App & { setting: { open(): void; openTabById(id: string): void } }).setting;
		setting.open();
		setting.openTabById(ctx.plugin.manifest.id);
	}

	/* Détections async : statut de chaque provider (trigger + menu du
	   sélecteur), et pour le provider actif, hint contextuel + liste
	   réelle de modèles. */
	function refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, kimiCtl, buildOllamaList, force }: RefreshArgs): void {
		const settings = ctx.plugin.settings;

		// Affichage IMMÉDIAT du dernier hint connu pour ce fournisseur : les
		// détections ci-dessous ne font que le confirmer ou le corriger.
		if (provider in providerHint) renderHint(hintZone, providerHint[provider]);

		aiProviders.checkClaudeCode(force).then(res => {
			if (res.ok) {
				setStatus("claude-code", providerSelect, "ok", t("ai.status.claudeOk", { version: res.version }));
			} else if (res.reason === "mobile") {
				setStatus("claude-code", providerSelect, "warn", t("ai.status.desktopOnly"));
			} else {
				setStatus("claude-code", providerSelect, "err", t("ai.status.claudeMissing"));
			}
			if (res.ok) {
				setHint("claude-code", hintZone, provider, null);
			} else if (res.reason === "mobile") {
				setHint("claude-code", hintZone, provider, {
					type: "warn", icon: "monitor",
					text: t("ai.hint.claudeDesktopOnly")
				});
			} else {
				setHint("claude-code", hintZone, provider, {
					type: "err", icon: "download",
					text: t("ai.hint.claudeNotInstalled"),
					...installCmd("claude-code"),
					action: {
						label: t("ai.hint.installClaude"), icon: "arrow-up-right",
						onClick: () => window.open("https://claude.com/claude-code", "_blank")
					}
				});
			}
		});

		aiProviders.checkCodex(force).then(res => {
			if (res.ok) {
				setStatus("codex", providerSelect, "ok", t("ai.status.codexOk", { version: res.version }));
			} else if (res.reason === "mobile") {
				setStatus("codex", providerSelect, "warn", t("ai.status.desktopOnly"));
			} else {
				setStatus("codex", providerSelect, "err", t("ai.status.codexMissing"));
			}
			if (res.ok) {
				setHint("codex", hintZone, provider, null);
			} else if (res.reason === "mobile") {
				setHint("codex", hintZone, provider, {
					type: "warn", icon: "monitor",
					text: t("ai.hint.codexDesktopOnly")
				});
			} else {
				// « Codex CLI », jamais « Codex » nu : l'APPLICATION Codex
				// (bureau) n'installe pas la commande « codex » — l'installer
				// ne détecte rien (vécu Ahmed 2026-07-12). Commande = celle
				// de l'installateur OFFICIEL de la plateforme
				// (learn.chatgpt.com, « la meilleure méthode » — choix
				// Ahmed) ; npm reste détecté aussi.
				setHint("codex", hintZone, provider, {
					type: "err", icon: "download",
					text: t("ai.hint.codexNotInstalled"),
					...installCmd("codex"),
					action: {
						label: t("ai.hint.installCodex"), icon: "arrow-up-right",
						onClick: () => window.open("https://learn.chatgpt.com/docs/codex/cli#getting-started", "_blank")
					}
				});
			}
		});

		aiProviders.checkKimi(force).then(res => {
			if (!res.ok) {
				setStatus("kimi-code", providerSelect, res.reason === "mobile" ? "warn" : "err",
					res.reason === "mobile" ? t("ai.status.desktopOnly") : t("ai.status.kimiMissing"));
				setHint("kimi-code", hintZone, provider, res.reason === "mobile"
					? {
						type: "warn", icon: "monitor",
						text: t("ai.hint.kimiDesktopOnly")
					}
					: {
						type: "err", icon: "download",
						text: t("ai.hint.kimiNotInstalled"),
						...installCmd("kimi-code"),
						action: {
							label: t("ai.hint.installKimi"), icon: "arrow-up-right",
							onClick: () => window.open("https://www.kimi.com/code", "_blank")
						}
					});
				return;
			}
			// Statut = le CLI et sa version, connecté ou non (comme Claude/Codex/
			// Ollama) : c'est la PASTILLE qui dit l'état — verte si des modèles
			// sont là, orange s'il faut encore /login (demande Ahmed). Le détail
			// et la marche à suivre vivent dans le hint, pas dans le sous-titre.
			setStatus("kimi-code", providerSelect,
				res.models.length ? "ok" : "warn",
				t("ai.status.kimiVersion", { version: res.version }));

			// CLI présent mais aucun modèle : le compte n'est pas connecté (tant
			// que /login n'a rien peuplé, `provider list` est vide). État distinct
			// d'un CLI absent → warn + marche à suivre, pas une erreur rouge.
			if (!res.models.length) {
				setHint("kimi-code", hintZone, provider, {
					type: "warn", icon: "log-in",
					text: t("ai.hint.kimiNotLoggedIn"),
					action: {
						label: t("ai.hint.kimiPlans"), icon: "arrow-up-right",
						// Page d'abonnement, PAS kimi.com/code : les cartes (Moderato,
						// Allegretto… avec « Kimi Code available » et le bouton
						// Subscribe) y sont visibles d'emblée, alors que sur /code il
						// faut chercher les offres plus bas (choix Ahmed, vérifié au
						// rendu le 2026-07-16). URL NUE volontairement : les « ?from=…
						// &track_id=… » vus dans le navigateur sont le tracking du site
						// (provenance du clic + id de visite), qu'il régénère seul —
						// les recopier ferait passer le plugin pour sa propre topbar.
						// À ne pas « corriger » en scrollant la page : une page tierce
						// ouverte par window.open est cross-origin, donc impilotable.
						onClick: () => window.open("https://www.kimi.com/membership/pricing", "_blank")
					}
				});
			} else {
				setHint("kimi-code", hintZone, provider, null);
			}
			// Modèles arrivés (ou disparus) → le trigger du composer se redessine.
			if (provider === "kimi-code" && kimiCtl && kimiCtl.refreshTrigger) kimiCtl.refreshTrigger();
		});

		aiProviders.checkOllama(settings.aiOllamaUrl, force).then(async (res) => {
			if (res.ok) {
				// Affiche la version d'Ollama installée (comme Claude/Codex), ex.
				// « Ollama v0.31.2 ». Repli sur l'état du cache si version absente.
				const n = res.models.length;
				// Deux clés plutôt qu'un pluriel calculé : « local » ne s'accorde
				// qu'en français, et c'est à chaque langue de le décider.
				const fallback = n > 0
					? t(n > 1 ? "ai.status.ollamaLocalMany" : "ai.status.ollamaLocalOne", { count: n })
					: t("ai.status.ollamaCloudReady");
				setStatus("ollama", providerSelect, "ok", res.version ? t("ai.status.ollamaOk", { version: res.version }) : fallback);
				setHint("ollama", hintZone, provider, null);
				if (provider !== "ollama") return;
				// Reconstruit les options (sélection + locaux réellement installés,
				// avec capability thinking) et rafraîchit le libellé du contrôle.
				if (ollamaCtl) {
					ollamaCtl.detected = res.models;
					ollamaCtl.options = buildOllamaList(res.models);
					if (ollamaCtl.refreshTrigger) ollamaCtl.refreshTrigger();
				}
			} else {
				// Le plugin DIAGNOSTIQUE lui-même (demande Ahmed : jamais
				// de « Serveur non détecté » sec ni de « si Ollama n'est
				// pas installé » laissé à l'utilisateur) — le diagnostic
				// sert le STATUT du menu fournisseur ET le hint :
				// installé mais arrêté → « Démarrer Ollama » (le plugin
				// lance l'app et re-render dès que le serveur répond) ;
				// absent → « Télécharger Ollama ».
				const inst = await aiProviders.checkOllamaInstalled(force);
				setStatus("ollama", providerSelect,
					inst.installed ? "warn" : "err",
					inst.installed ? t("ai.status.serverStopped") : t("ai.status.notInstalled"));
				if (inst.installed) {
					setHint("ollama", hintZone, provider, {
						type: "warn", icon: "server-off",
						text: t("ai.hint.ollamaServerOff"),
						action: {
							label: t("ai.hint.startOllama"), icon: "circle-play",
							onClick: () => {
								aiProviders.startOllamaApp();
								// Poll : vert automatique dès que le
								// serveur répond (10 s max).
								let tries = 0;
								const poll = window.setInterval(() => {
									tries++;
									// force : le serveur vient de démarrer, le cache
									// de détection dirait encore « injoignable ».
									aiProviders.checkOllama(settings.aiOllamaUrl, true).then(r2 => {
										if (r2.ok || tries >= 10) {
											window.clearInterval(poll);
											if (r2.ok) render(containerRef);
										}
									});
								}, 1000);
							}
						}
					});
				} else {
					setHint("ollama", hintZone, provider, {
						type: "err", icon: "download",
						text: t("ai.hint.ollamaNotInstalled"),
						...installCmd("ollama"),
						action: {
							label: t("ai.hint.downloadOllama"), icon: "arrow-up-right",
							onClick: () => window.open("https://ollama.com/download", "_blank")
						}
					});
				}
			}
		});
	}

	function addImageFiles(files: File[]): void {
		for (const file of files) {
			if (!file.type.startsWith("image/")) continue;
			images.push({ file, url: URL.createObjectURL(file) });
		}
		render(containerRef);
	}

	/* Retire la dernière pièce jointe (bonus Backspace, cf. keydown du
	   composer). Priorité à la dernière NOTE : c'est elle qui vit
	   visuellement contre le caret (chip superposée à la 1ʳᵉ ligne, ou
	   repliée juste au-dessus) ; à défaut, la dernière image. */
	function removeLastAttachment(): void {
		if (noteAttachments.length > 0) {
			noteAttachments.pop();
		} else if (images.length > 0) {
			const removed = images.pop();
			if (removed) URL.revokeObjectURL(removed.url);
		} else {
			return;
		}
		render(containerRef);
	}

	/* Route les fichiers du picker/drop : images → vignettes (vision),
	   texte (.md/.txt) et PDF (texte extrait localement) → sources texte
	   (mêmes chips que les notes). Autres formats : refusés avec
	   explication.
	   `origin` : connu SEULEMENT quand l'appelant sait d'où vient le fichier
	   (attachVaultPath / attachExternalPath, toujours UN seul fichier à la
	   fois) — sinon (menu « + », glisser-déposer, plusieurs fichiers
	   possibles) la pièce est de source « file », dédoublonnée par nom
	   seul faute de chemin connu. Dédoublonnage centralisé via
	   attachmentKey : un doublon ignoré produit une Notice EXACTE (jamais
	   un skip silencieux — régression corrigée ici). */
	async function addComposerFiles(
		files: File[],
		origin?: { source: "vault" | "external"; path: string }
	): Promise<void> {
		const imgs: File[] = [];
		const rejected: string[] = [];
		const source: AttachmentSource = origin?.source ?? "file";
		for (const file of files) {
			if (file.type.startsWith("image/")) {
				imgs.push(file);
			} else if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
				try {
					const content = await extractPdfText(file);
					if (!content.trim()) {
						new Notice(t("ai.notice.pdfNoText", { name: file.name }));
					} else {
						const key = attachmentKey({ source, path: origin?.path, name: file.name });
						if (noteAttachments.some(n => attachmentKey(n) === key)) {
							new Notice(t("ai.notice.noteAlreadyAttached", { name: file.name }));
						} else {
							noteAttachments.push({ name: file.name, content, path: origin?.path, source });
						}
					}
				} catch (e) {
					rejected.push(file.name);
				}
			} else if (/\.(md|txt)$/i.test(file.name) || file.type.startsWith("text/")) {
				try {
					const content = await file.text();
					const key = attachmentKey({ source, path: origin?.path, name: file.name });
					if (noteAttachments.some(n => attachmentKey(n) === key)) {
						new Notice(t("ai.notice.noteAlreadyAttached", { name: file.name }));
					} else {
						noteAttachments.push({ name: file.name, content, path: origin?.path, source });
					}
				} catch (e) {
					rejected.push(file.name);
				}
			} else {
				rejected.push(file.name);
			}
		}
		if (imgs.length) {
			addImageFiles(imgs); // render inclus
		} else {
			render(containerRef);
		}
		if (rejected.length) {
			new Notice(t("ai.notice.unsupportedFormat", { files: rejected.join(", ") }));
		}
	}

	/* Texte d'un PDF via le pdf.js EMBARQUÉ d'Obsidian (loadPdfJs, API
	   officielle — worker configuré par l'app, aucune dépendance
	   ajoutée). Une section par page. Les PDF scannés (images) n'ont pas
	   de couche texte → chaîne vide, signalée à l'appelant. */
	async function extractPdfText(file: File): Promise<string> {
		const pdfjs = await loadPdfJs() as PdfJsLib;
		const buf = await file.arrayBuffer();
		const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
		const pages: string[] = [];
		for (let i = 1; i <= pdf.numPages; i++) {
			const page = await pdf.getPage(i);
			const content = await page.getTextContent();
			pages.push(content.items.map(it => it.str).join(" "));
		}
		return pages.join("\n\n");
	}

	/* Attache une note du vault comme source du quiz (menu « Ajouter des
	   notes » et raccourci — remplace l'ancienne « note active »). */
	async function attachNoteVaultFile(file: TFile): Promise<void> {
		// Dédoublonnage par attachmentKey (source « vault » + path), PAS par
		// name seul : sinon un « AGENTS.md » du vault percute à tort un
		// « AGENTS.md » externe/déposé de contenu différent (régression
		// corrigée ici — cf. rapport de tâche).
		const key = attachmentKey({ source: "vault", path: file.path, name: file.name });
		if (noteAttachments.some(n => attachmentKey(n) === key)) {
			new Notice(t("ai.notice.noteAlreadyAttached", { name: file.basename }));
			return;
		}
		try {
			const content = await ctx.app.vault.read(file);
			// file.name (PAS file.basename) : la chip affiche le nom complet
			// AVEC son extension, comme les fichiers .md/.txt/PDF attachés via
			// addComposerFiles (déjà sur file.name).
			noteAttachments.push({ name: file.name, content, path: file.path, source: "vault" });
			render(containerRef);
		} catch (e) {
			new Notice(t("ai.notice.noteReadFailed", { name: file.basename }));
		}
	}

	/* MIME d'après l'extension. Nécessaire quand on fabrique un File depuis
	   le disque ou le vault : addComposerFiles teste file.type EN PREMIER
	   pour les images, et un File sans type finirait en chip texte. */
	function mimeForName(name: string): string {
		const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
		if (ext === "pdf") return "application/pdf";
		if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(ext)) {
			return "image/" + (ext === "jpg" ? "jpeg" : ext);
		}
		return "text/plain";
	}

	/* Attache un fichier du VAULT choisi via « @ ». Les notes passent par
	   attachNoteVaultFile (qui dédoublonne par attachmentKey et garde le
	   lien vers la note) ; les PDF et images passent par addComposerFiles,
	   seule à savoir extraire un PDF et router une image vers la vision —
	   origin: { source: "vault", path } transmis pour que CE fichier
	   partage le même dédoublonnage cohérent (source « vault » + chemin),
	   pas un dédoublonnage par nom seul qui le confondrait avec un fichier
	   externe homonyme. */
	async function attachVaultPath(path: string): Promise<void> {
		const f = ctx.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return;
		const ext = f.extension.toLowerCase();
		if (ext === "md" || ext === "txt") { await attachNoteVaultFile(f); return; }
		try {
			const buf = await ctx.app.vault.readBinary(f);
			const file = new File([new Uint8Array(buf)], f.name, { type: mimeForName(f.name) });
			await addComposerFiles([file], { source: "vault", path: f.path });
		} catch (e) {
			new Notice(t("ai.notice.noteReadFailed", { name: f.name }));
		}
	}

	/* Attache un fichier hors vault (picker « @ »). On fabrique un File à
	   partir du disque pour réutiliser addComposerFiles tel quel : images,
	   PDF et texte y sont déjà routés. Desktop uniquement (fs).
	   Dédoublonnage par attachmentKey (source « external » + chemin ABSOLU),
	   PAS par nom seul : deux fichiers homonymes de dossiers différents
	   (ex. deux « Styling Coiffure.pdf ») restent deux pièces jointes
	   distinctes, joignables ENSEMBLE — c'était impossible avant (régression
	   corrigée ici, cf. rapport de tâche). Vérifié AVANT la lecture disque :
	   pas de fs.readFileSync pour un doublon détecté à l'avance. */
	async function attachExternalPath(path: string): Promise<void> {
		if (!Platform.isDesktopApp) return;
		const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
		const key = attachmentKey({ source: "external", path, name });
		if (noteAttachments.some(n => attachmentKey(n) === key)) {
			new Notice(t("ai.notice.noteAlreadyAttached", { name }));
			return;
		}
		try {
			const fs = require("fs") as typeof import("fs");
			const buf = fs.readFileSync(path);
			// mimeForName vient de la Task 2 : addComposerFiles teste file.type
			// EN PREMIER pour les images, un File sans type finirait en chip
			// texte au lieu d'une vignette.
			const file = new File([new Uint8Array(buf)], name, { type: mimeForName(name) });
			await addComposerFiles([file], { source: "external", path });
		} catch (e) {
			new Notice(t("ai.notice.noteReadFailed", { name }));
		}
	}

	/* Cibles des raccourcis du composer (Scope de la vue dashboard) et du
	   menu « + ». Actifs seulement si le composer est rendu (vue Générer). */
	function openAddFiles(): void {
		if (fileInputRef && fileInputRef.isConnected) fileInputRef.click();
	}

	function openAddNotes(): void {
		if (!addBtnRef || !addBtnRef.isConnected) return;
		const seen = new Set<string>();
		const openFiles: TFile[] = [];
		for (const leaf of ctx.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view as View & { file?: TFile | null };
			const f = view && view.file;
			if (f && !seen.has(f.path)) { seen.add(f.path); openFiles.push(f); }
		}
		openNotePicker(addBtnRef, {
			openFiles,
			allFiles: ctx.app.vault.getMarkdownFiles(),
			onPick: (file) => attachNoteVaultFile(file)
		});
	}

	/* ── Bulle de la demande envoyée (référence claude.ai) ──
	   Lecture seule, alignée à droite : une fois partie, la demande ne se
	   remodifie plus et ne se renvoie plus depuis là (retour Ahmed
	   2026-07-31 — le composer qui gardait le texte donnait l'impression
	   que rien n'était parti). Pour la reprendre : annuler la génération,
	   elle retourne alors dans le composer. */
	function renderSentMessage(host: HTMLElement): void {
		const msg = sentMessage;
		if (!msg) return;
		const bubble = host.createDiv({ cls: "qbd-ai-sent" });
		// L'entrée ne joue qu'au PREMIER rendu qui suit l'envoi : pendant la
		// génération, la page se re-rend (statuts de fournisseur, quotas) et
		// une bulle qui rebondit à chaque fois ferait clignoter la scène.
		if (sentAnimPending) {
			sentAnimPending = false;
			bubble.addClass("qbd-ai-sent--in");
		}

		if (msg.images.length > 0) {
			const row = bubble.createDiv({ cls: "qbd-ai-sent-images" });
			for (const img of msg.images) {
				const thumb = row.createDiv({ cls: "qbd-ai-image-thumb" });
				thumb.createEl("img", { cls: "qbd-ai-image-thumb-img" }).src = img.url;
			}
		}

		if (msg.notes.length > 0) {
			const chips = bubble.createDiv({ cls: "qbd-ai-sent-chips" });
			for (const note of msg.notes) {
				const chip = chips.createDiv({ cls: "qbd-ai-note-chip" });
				setIcon(chip.createSpan({ cls: "qbd-ai-note-chip-icon" }), "file-text");
				const name = chip.createSpan({ cls: "qbd-ai-note-chip-name", text: note.name });
				name.title = note.path || note.name;
			}
		}

		if (msg.text.trim()) bubble.createDiv({ cls: "qbd-ai-sent-text", text: msg.text.trim() });
	}

	/** Vide le composer au profit de la bulle « envoyé ». Les URL d'objet des
	    images NE sont PAS révoquées : la bulle les affiche encore. */
	function takeComposerMessage(): SentMessage {
		// Une demande précédente encore affichée (erreur non réessayée) cède la
		// place : ses vignettes ne seront plus jamais rendues, leurs URL d'objet
		// se libèrent ici — sinon chaque envoi en fuiterait une de plus.
		dropSentMessage();
		const msg: SentMessage = { text: composerText, notes: noteAttachments, images };
		composerText = "";
		composerCaret = null;
		noteAttachments = [];
		images = [];
		sentMessage = msg;
		sentAnimPending = true;
		return msg;
	}

	/** Remet la demande partie dans le composer (annulation, réessai) et
	    referme la bulle — le contraire exact de takeComposerMessage. */
	function restoreComposerMessage(): void {
		if (!sentMessage) return;
		composerText = sentMessage.text;
		noteAttachments = sentMessage.notes;
		images = sentMessage.images;
		sentMessage = null;
		sentAnimPending = false;
	}

	/** Abandonne la demande partie : c'est le seul endroit où les URL d'objet
	    des images envoyées se révoquent (plus personne ne les affichera). */
	function dropSentMessage(): void {
		if (!sentMessage) return;
		for (const img of sentMessage.images) URL.revokeObjectURL(img.url);
		sentMessage = null;
		sentAnimPending = false;
	}

	/* Loader de génération — l'ANIMATION VALIDÉE (balayage qbd-glide,
	   icône sparkles, dots pulsants) est reprise à l'identique : mêmes
	   classes, mêmes keyframes. Seul le conteneur change (carte centrée
	   sous le composer, plus de colonne d'aperçu). */
	function renderLoading(host: HTMLElement): void {
		const loader = host.createDiv({ cls: "qbd-ai-preview-loading" });
		const iconWrap = loader.createDiv({ cls: "qbd-ai-loading-icon" });
		setIcon(iconWrap, "sparkles");
		loader.createEl("p", { cls: "qbd-ai-loading-title", text: t("ai.loading.title") });

		const dots = loader.createDiv({ cls: "qbd-ai-loading-dots" });
		for (let i = 0; i < 3; i++) {
			dots.createDiv({ cls: "qbd-ai-loading-dot" });
		}
	}

	function renderError(host: HTMLElement): void {
		const errorEl = host.createDiv({ cls: "qbd-ai-preview-error" });
		const errorIcon = errorEl.createDiv({ cls: "qbd-ai-error-icon" });
		setIcon(errorIcon, "alert-triangle");
		errorEl.createEl("p", { cls: "qbd-ai-error-title", text: t("ai.error.title") });
		errorEl.createEl("p", { cls: "qbd-ai-error-msg", text: errorMessage });

		const retryBtn = errorEl.createEl("button", {
			cls: "qbd-btn qbd-btn--ghost qbd-ai-error-retry",
			text: t("ai.error.retry")
		});
		// Réessayer = RENVOYER la même demande (référence claude.ai), pas la
		// rendre au composer : le passage par restore/take garde un seul
		// chemin d'envoi (startGeneration reprend le message tel quel).
		retryBtn.addEventListener("click", () => {
			if (!sentMessage) { phase = "idle"; render(containerRef); return; }
			restoreComposerMessage();
			void startGeneration(containerRef);
		});
	}

	/** Ouvre l'écran d'usage en lui passant la dernière lecture connue (il ne
	    rappellera l'endpoint que si elle a vieilli) et retient ce qu'il lit,
	    pour que le survol du bouton puisse le résumer sans relire. */
	function openUsage(): void {
		const plugin = ctx.plugin as unknown as UsagePlugin;
		openUsageModal(ctx.app, {
			plugin,
			provider: ctx.plugin.settings.aiProvider || "",
			usage: lastUsage,
			known: lastPlan,
			onData: (data) => { lastPlan = data; }
		});
	}

	/* ── Ce que la génération a coûté ──
	   Badge compact dans la barre de résultat ; le détail complet vit dans
	   l'écran d'usage. Un fournisseur qui ne publie pas ses compteurs le DIT
	   (il n'affiche pas « 0 ») : c'est la seule façon de distinguer « rien
	   consommé » de « rien mesuré ». */
	function renderUsageBadge(host: HTMLElement): void {
		if (!lastUsage) {
			host.createSpan({ cls: "qbd-ai-usage-badge is-muted", text: t("ai.usage.tokensUnavailable") });
			return;
		}
		const usage = lastUsage;

		const badge = host.createEl("button", {
			cls: "qbd-ai-usage-badge",
			attr: { type: "button" }
		});
		const gaugeIcon = badge.createSpan({ cls: "qbd-ai-usage-icon" });
		setIcon(gaugeIcon, "gauge");
		badge.createSpan({ text: t("ai.usage.badge", { tokens: formatTokens(totalTokens(usage)) }) });

		const cost = formatCost(usage.costUsd);
		if (cost) badge.createSpan({ cls: "qbd-ai-usage-sep", text: cost });
		const dur = formatDuration(usage.durationMs);
		if (dur) badge.createSpan({ cls: "qbd-ai-usage-sep", text: dur });

		badge.addEventListener("click", () => openUsage());
	}

	/* Zone résultat (pleine page, composer en bas) : barre compacte +
	   l'ÉDITEUR DE QUIZ COMPLET embarqué — exigence explicite, pas une
	   liste simplifiée. */
	function renderResult(container: HTMLElement): void {
		// ── Barre compacte : compte + Insérer dans une note + Recommencer ──
		const bar = container.createDiv({ cls: "qbd-ai-embed-bar" });
		const countWrap = bar.createDiv({ cls: "qbd-ai-result-count-wrap" });
		const checkIcon = countWrap.createSpan({ cls: "qbd-ai-result-check" });
		setIcon(checkIcon, "check-circle");
		countWrap.createSpan({ cls: "qbd-ai-result-count", text: t("ai.result.count", { count: generatedQuestions.length }) });

		renderUsageBadge(countWrap);

		const insertBtn = bar.createEl("button", {
			cls: "qbd-btn qbd-btn--primary",
			text: t("ai.result.insert")
		});
		const insertIcon = insertBtn.createSpan({ cls: "qbd-btn-icon" });
		setIcon(insertIcon, "plus");
		insertBtn.prepend(insertIcon);
		// Picker : notes OUVERTES en tête + recherche dans tout le vault.
		insertBtn.addEventListener("click", () => {
			const seen = new Set<string>();
			const openFiles: TFile[] = [];
			for (const leaf of ctx.app.workspace.getLeavesOfType("markdown")) {
				const view = leaf.view as View & { file?: TFile | null };
				const f = view && view.file;
				if (f && !seen.has(f.path)) { seen.add(f.path); openFiles.push(f); }
			}
			openNotePicker(insertBtn, {
				openFiles,
				allFiles: ctx.app.vault.getMarkdownFiles(),
				onPick: (file) => insertIntoNote(file)
			});
		});

		const restartBtn = bar.createEl("button", { cls: "qbd-btn qbd-btn--ghost" });
		const restartIcon = restartBtn.createSpan({ cls: "qbd-btn-icon" });
		setIcon(restartIcon, "rotate-ccw");
		restartBtn.createSpan({ text: t("ai.result.restart") });
		restartBtn.addEventListener("click", () => {
			phase = "idle";
			generatedQuestions = [];
			embedEditor = null;
			dropSentMessage();
			composerText = "";
			noteAttachments = [];
			images = [];
			render(containerRef);
		});

		// ── L'ÉDITEUR COMPLET, embarqué pleine page (composer en bas) ──
		const host = container.createDiv({ cls: "qbd-ai-editor-embed qb-root" });
		mountEmbedEditor(host);
	}

	/* Monte l'éditeur de quiz complet dans `host` (zone résultat pleine
	   page). L'instance survit aux re-renders de la page : les questions en
	   cours d'édition sont reprises tant que la génération n'a pas changé. */
	function mountEmbedEditor(host: HTMLElement): void {
		const { attachQuizEditorCore } = require("../editor") as typeof import("../editor");
		const prev = embedEditor;
		const inst = attachQuizEditorCore({} as unknown as EditorHostView, host, ctx.app, ctx.plugin) as EmbedEditor;
		// Panneau Éditeur FERMÉ par défaut après génération (demande
		// 2026-07-11) : ouvert, il révèle immédiatement les réponses.
		// Questions + Aperçu suffisent pour relire le quiz ; un re-render
		// conserve les choix de panneaux de l'utilisateur.
		inst.panels.editor = prev && prev._genId === generationId
			? prev.panels.editor : false;
		if (prev && prev._genId === generationId) {
			inst.panels.sidebar = prev.panels.sidebar;
			inst.panels.preview = prev.panels.preview;
			inst.panels.code = prev.panels.code;
		}
		inst.buildUI();
		if (prev && prev._genId === generationId) {
			// Re-render de la page → reprendre l'édition en cours, en place.
			inst.questions.length = 0;
			prev.questions.forEach(q => inst.questions.push(q));
			Object.assign(inst.examOptions, prev.examOptions);
			inst.render();
		} else {
			inst.render();
			const JSON5 = require("json5") as typeof import("json5");
			// silent : pas de Notice d'import à chaque montage. Pas de
			// sourceFile → aucune sauvegarde automatique vers une note.
			inst.importQuizSource(JSON5.stringify(generatedQuestions, null, 2), null, { silent: true });
		}
		inst._genId = generationId;
		embedEditor = inst;
	}

	function updateGenerateBtn(btn: HTMLButtonElement | null): void {
		if (!btn) return;
		// Le bouton d'envoi n'apparaît qu'avec du contenu (texte/image/note),
		// et reste désactivé tant que la génération n'est pas possible
		// (aucun fournisseur configuré). Pendant la génération il devient le
		// bouton stop → toujours visible et cliquable.
		const loading = phase === "loading";
		const hasContent = !!(composerText.trim() || images.length > 0 || noteAttachments.length > 0);
		const canGen = canGenerate();
		btn.classList.toggle("is-visible", hasContent || loading);
		btn.disabled = loading ? false : !canGen;
		btn.classList.toggle("qbd-ai-composer-send--disabled", !loading && !canGen);
	}

	/* Nomme un bouton-icône SANS déclencher de seconde bulle. `aria-label` (et
	   `title`) fait afficher à Obsidian sa PROPRE infobulle : sur un bouton qui
	   porte déjà une bulle maison, les deux s'empilent et répètent le même mot
	   (constaté 2026-07-30 sur le bouton d'usage). Le nom accessible passe donc
	   par un texte hors écran, lu par les lecteurs d'écran, invisible à la
	   souris. À appeler APRÈS setIcon, qui réécrit le contenu du bouton. */
	function labelIconButton(btn: HTMLElement, label: string): void {
		btn.createSpan({ cls: "qbd-sr-only", text: label });
	}

	/* Bulle au survol d'un bouton du composer. Le CONTENU est reconstruit à
	   chaque survol (`fill`), jamais mémorisé : ces bulles affichent un état
	   vivant (options courantes, usage du forfait) qu'un texte figé à la
	   construction ferait mentir. Portalée au <body> — le composer clippe. */
	function attachHoverTip(btn: HTMLElement, fill: (tip: HTMLElement) => void): void {
		let tip: HTMLElement | null = null;
		const hide = () => { if (tip) { tip.remove(); tip = null; } };
		btn.addEventListener("mouseenter", () => {
			if (tip) return;
			tip = document.body.createDiv({ cls: "qbd-hover-tip" });
			fill(tip);
			const r = btn.getBoundingClientRect();
			tip.style.visibility = "hidden";
			const tr = tip.getBoundingClientRect();
			const left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8);
			let top = r.top - tr.height - 8;
			if (top < 8) top = r.bottom + 8;
			tip.style.left = left + "px";
			tip.style.top = top + "px";
			tip.style.visibility = "";
		});
		btn.addEventListener("mouseleave", hide);
		btn.addEventListener("click", hide);
	}

	/* Tooltip du bouton stop (référence Claude Code : « Arrêter  Esc »). */
	function attachStopTip(btn: HTMLElement): void {
		attachHoverTip(btn, (tip) => {
			const row = tip.createDiv({ cls: "qbd-hover-tip-row" });
			row.createSpan({ cls: "qbd-hover-tip-title", text: t("ai.composer.stop") });
			row.createSpan({ cls: "qbd-hover-tip-esc", text: "Esc" });
		});
	}

	/* Les chemins écrits dans le prompt sont attachés AVANT l'envoi : le
	   modèle n'a aucun accès disque, mais le plugin sait lire ces fichiers
	   (mêmes fonctions que le picker « @ » → mêmes formats, même
	   dédoublonnage, mêmes chips). Sans ça, « d'après Cours/TD3.md »
	   partait sans sa source et revenait en ai.err.noFileAccess. */
	async function attachPromptPaths(): Promise<void> {
		const text = composerText.trim();
		if (!text) return;
		const { scanPromptPaths, MAX_PROMPT_PATHS } = require("./prompt-paths") as typeof import("./prompt-paths");
		const roots = ctx.plugin.settings.aiMentionExtraFolders || [];
		const { refs, unresolved, ambiguous, truncated } = scanPromptPaths(ctx.app, roots, text);

		// Déjà joint (via « @ » ou « + ») : on ne le redit pas. Le passer à
		// attach*Path afficherait « déjà attachée » pour un doublon que
		// l'utilisateur n'a jamais demandé deux fois.
		const fresh = refs.filter(r => {
			const key = attachmentKey({ source: r.kind, path: r.path, name: r.name });
			return !noteAttachments.some(n => attachmentKey(n) === key)
				&& !images.some(i => i.file.name === r.name);
		});
		for (const r of fresh) {
			if (r.kind === "vault") await attachVaultPath(r.path);
			else await attachExternalPath(r.path);
		}
		if (fresh.length) {
			new Notice(t("ai.notice.pathsAttached", {
				files: fresh.map(r => r.name).join(", ")
			}));
		}
		if (truncated) {
			new Notice(t("ai.notice.pathsTooMany", { max: String(MAX_PROMPT_PATHS) }));
		}
		for (const a of ambiguous) {
			new Notice(t("ai.notice.pathsAmbiguous", { file: a.text, count: String(a.count) }));
		}
		if (unresolved.length) {
			new Notice(t("ai.notice.pathsUnresolved", { files: unresolved.join(", ") }));
		}
	}

	async function startGeneration(container: HTMLElement | null): Promise<void> {
		/* Les chemins écrits dans le prompt deviennent des pièces jointes AVANT
		   la capture : elles doivent partir avec la demande, et apparaître dans
		   la bulle « envoyé » — c'est là que l'utilisateur voit désormais ce
		   qui est parti, le composer étant vidé juste après. */
		await attachPromptPaths();

		// Le composer se vide MAINTENANT, avant le premier rendu de la phase
		// « loading » : la demande passe en bulle et le champ redevient neuf.
		// Tout ce qui suit lit `msg`, jamais l'état du composer — qui n'est
		// plus la demande en vol dès cette ligne.
		const msg = takeComposerMessage();
		phase = "loading";
		errorMessage = "";
		render(container);

		const { createAiClient } = require("./ai-client") as typeof import("./ai-client");
		const client = createAiClient(ctx.plugin);
		activeClient = client;
		// Esc annule la génération (référence : tooltip « Arrêter  Esc »)
		const onEsc = (e: KeyboardEvent) => {
			if (e.key === "Escape") { e.preventDefault(); client.abort(); }
		};
		document.addEventListener("keydown", onEsc);

		try {

			// Source déduite du contenu du composer :
			// images → vision ; notes/fichiers attachés → texte source ;
			// sinon sujet. Chaque source texte est délimitée par son nom
			// (l'IA distingue les documents d'un envoi multi-notes).
			const source = msg.images.length > 0 ? "image" : msg.notes.length > 0 ? "text" : "topic";
			const notesBlock = msg.notes
				.map(n => (msg.notes.length > 1 ? "--- " + n.name + " ---\n" : "") + n.content)
				.join("\n\n");
			// Repli quand des images sont envoyées SANS consigne : instruction au
			// modèle (pas de l'UI) → anglais, et surtout « dans leur langue »,
			// sinon des images françaises donneraient un quiz anglais.
			const prompt = source === "image"
				? (msg.text.trim() || "Analyze the provided images and build the quiz in their language")
				: source === "text"
				? (msg.text.trim() ? msg.text.trim() + "\n\n" : "") + notesBlock
				: msg.text.trim();

			// Convert image files to base64 for vision API
			let imageData: ImagePayload[] = [];
			if (msg.images.length > 0) {
				imageData = await Promise.all(msg.images.map(async (img) => {
					const buffer = await img.file.arrayBuffer();
					const bytes = new Uint8Array(buffer);
					let binary = "";
					for (let i = 0; i < bytes.length; i++) {
						binary += String.fromCharCode(bytes[i]);
					}
					const base64 = btoa(binary);
					return { base64, mediaType: img.file.type || "image/png" };
				}));
			}

			generatedQuestions = await client.generate(prompt, {
				count: questionCount,
				type: questionType,
				source,
				images: imageData
			});

			/* Coût de CE qui vient d'être produit. Le journal et la lecture des
			   quotas sont accessoires : ils ne doivent jamais faire échouer une
			   génération qui, elle, a réussi. */
			lastUsage = client.lastUsage;
			lastPlan = null;
			if (lastUsage) {
				const usagePlugin = ctx.plugin as unknown as UsagePlugin;
				try {
					await recordUsage(usagePlugin, {
						...lastUsage,
						at: Date.now(),
						questionCount: generatedQuestions.length
					});
					// La génération vient de consommer du forfait : relire tout de
					// suite garde le survol du bouton d'usage juste, sans attendre
					// que l'écran soit ouvert.
					lastPlan = await fetchPlanUsageFor(usagePlugin, lastUsage);
				} catch (e) {
					console.warn("[quiz-blocks] usage non enregistré:", e);
				}
			}
		} catch (err) {
			const e = err as Error & { aborted?: boolean };
			if (e && e.aborted) {
				// Annulation volontaire (bouton stop / Esc) → retour à l'état
				// initial, sans écran d'erreur. La demande RETOURNE dans le
				// composer : annuler, c'est défaire l'envoi — sinon le texte
				// (et les pièces jointes) seraient perdus.
				document.removeEventListener("keydown", onEsc);
				activeClient = null;
				generatedQuestions = [];
				restoreComposerMessage();
				phase = "idle";
				render(container);
				return;
			}
			errorMessage = e.message || t("ai.error.checkSettings");
			generatedQuestions = [];
		}

		document.removeEventListener("keydown", onEsc);
		activeClient = null;
		if (generatedQuestions.length > 0) {
			// Nouvelle génération → l'éditeur embarqué repart des questions
			// fraîches (renderResult le monte pleine page).
			generationId++;
			embedEditor = null;
			phase = "result";
		} else {
			phase = "error";
		}
		render(container);
	}

	/* Insère le quiz dans la note choisie via le picker (« Insérer dans une
	   note »). L'état ÉDITÉ de l'éditeur embarqué prime sur les questions
	   générées brutes (les retouches faites dans l'éditeur sont insérées). */
	async function insertIntoNote(file: TFile): Promise<void> {
		if (!file) return;
		let quizJson: string;
		if (embedEditor && embedEditor.questions.length) {
			const { exportAll } = require("../editor/export") as typeof import("../editor/export");
			quizJson = exportAll(embedEditor.questions, embedEditor.examOptions);
		} else if (generatedQuestions.length) {
			quizJson = (require("json5") as typeof import("json5")).stringify(generatedQuestions, null, 2);
		} else {
			return;
		}

		try {
			let content = await ctx.app.vault.read(file);

			const quizBlock = "```quiz-blocks\n" + quizJson + "\n```";

			// Vérifier s'il y a déjà un bloc quiz-blocks
			if (content.includes("```quiz-blocks")) {
				new Notice(t("ai.notice.blockExists", { name: file.basename }));
				return;
			}

			content += "\n\n" + quizBlock;
			await ctx.app.vault.modify(file, content);
			new Notice(t("ai.notice.quizInserted", { name: file.basename }));
		} catch (err) {
			new Notice(t("ai.notice.insertFailed"));
		}
	}

	return { render, openAddFiles, openAddNotes };
}
