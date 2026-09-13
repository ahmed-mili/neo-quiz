import JSON5 from "json5";
import type { EditorExamOptions } from "../types/editor-ctx";
import type { DashboardViewName } from "../types/dashboard-ctx";
import type { HostFile } from "../host/types";
import { currentHost } from "../host/current";
import { ajouter } from "../dom";
import { LOG_PREFIX } from "../branding";
import * as aiProviders from "./ai-providers";
import type { Scanner, QuizIndexEntry } from "./scanner";
import type { StatsStore } from "./stats-store";
import { aiSettingsDefaults } from "./ai-settings-host";
import type { AiSettingsHost } from "./ai-settings-host";
import { createAiClient } from "./ai-client";
import { createSelect, closeAllSelects, openActionMenu, openModelMenu, openEffortSlider, openOptionsMenu, openNotePicker } from "./ui-select";
import type { SelectHandle, SelectOption } from "./ui-select";
import { formatHotkey } from "../hotkey-format";
import { findQuizModeConfigIndex } from "../quiz-utils";
import { attachMentionPicker } from "./mention-picker";
import type { MentionPickerHandle } from "./mention-picker";
import type { AiClient, ImagePayload } from "./ai-client";
import { formatTokens, formatCost, formatDuration, totalTokens, tightestRow, usageRowLabel, providerPublishesPlan } from "./usage-format";
import type { AiUsage, AiUsageEntry, PlanUsage } from "./usage-format";
import { scanPromptPaths, MAX_PROMPT_PATHS } from "./prompt-paths";
import { createQuizPage } from "./detail";
import type { QuizPageHandlers } from "./detail";
import type { QuizDraft } from "./detail-io";
import { convertParsedToInternal, readModeConfig } from "../editor/convert";
import { exportAll, exportAllWithFence } from "../editor/export";
import { ensureFolder, freeNotePath } from "./folder-create";
import type { DraftQuestion } from "../editor/utils";
import type { ParsedQuizItem } from "../editor/modals";
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
	buildOllamaList: (detected: aiProviders.OllamaDetectedModel[] | null) => OllamaListItem[];
	force?: boolean;
}

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


/** L'écran d'usage du forfait — OPTIONNEL, et fourni par le seul greffon.
    Décision du 2026-09-12 : le modal d'usage (`usage-modal.ts`, `ai-usage.ts`)
    n'est pas porté dans l'application ; il reste lié à Obsidian, et la page ne
    l'importe plus. Absent, la page ne rend ni le bouton d'usage du composer
    ni la relecture du forfait après une génération — les compteurs de la
    génération elle-même (tokens, coût, durée) restent affichés : ils viennent
    du client, pas d'ici. */
export interface AiUsageDeps {
	/** Ouvre l'écran d'usage avec la dernière lecture connue ; `onData` retient
	    ce qu'il lit pour le survol du bouton. */
	open(opts: { provider: string; usage: AiUsage | null; known: PlanUsage | null; onData: (data: PlanUsage) => void }): Promise<void>;
	/** Journalise une génération. Ne doit jamais faire échouer la génération
	    qui, elle, a réussi. */
	record(entry: AiUsageEntry): Promise<void>;
	/** Relit le forfait du fournisseur qui vient de répondre. */
	fetchPlan(usage: AiUsage): Promise<PlanUsage>;
	/** Le forfait Claude connu localement (badge de Fable dans le menu). */
	claudePlan(): aiProviders.ClaudePlanHint;
}

/** Ce que la page « Générer » demande à son hôte, et rien de plus. Plus de
    `DashboardCtx` ni de `plugin` (tâche 6 de la tranche 5) : l'application
    construit ce littéral sans greffon (`apps/windows/src/ui/dashboard-shell.ts`),
    le greffon le construit dans `src/dashboard.ts`. */
export interface AiPageDeps {
	settings: AiSettingsHost;
	/** Pour indexer la note où le quiz vient d'être inséré, puis ouvrir sa page. */
	scanner: Scanner;
	statsStore: StatsStore;
	navigate(view: DashboardViewName, data?: { quiz?: QuizIndexEntry; edit?: boolean }): void;
	/** Les notes OUVERTES dans l'hôte (onglets Obsidian), en tête des deux
	    pickers de notes. Absent = aucune : l'application n'a pas d'onglets. */
	openFiles?(): HostFile[];
	usage?: AiUsageDeps;
	/** Rend un BLOC de code (commande d'installation d'un CLI) dans `host`.
	    Sous Obsidian, le moteur Markdown de l'app : coloration Prism, style de
	    bloc de l'utilisateur, bouton « copier » du post-processeur natif.
	    Absent, la page pose un `<pre><code>` nu — le texte est le même. */
	renderCodeBlock?(host: HTMLElement, code: string, lang: string): void;
}

/** Handlers de la vue « Générer » — retour de createAiHandlers(deps). */
export interface AiHandlers {
	render(container: HTMLElement): Promise<void>;
	openAddFiles(): void;
	openAddNotes(): void;
	/** Rend ce que la page tient au système à la fermeture de la vue :
	    observateur de taille, écoute « focus fenêtre », page du quiz généré,
	    et URL d'objet des images encore en mémoire. Sans lui, chaque
	    ouverture/fermeture du dashboard en laissait une série derrière elle. */
	dispose(): void;
}

export function createAiHandlers(deps: AiPageDeps): AiHandlers {
	const host = currentHost();
	/* Lus À CHAQUE usage, jamais copiés : une génération lit le fournisseur,
	   le modèle et l'effort au moment où elle part. */
	const settings = () => deps.settings.get();
	const saveSettings = (patch: Parameters<AiSettingsHost["save"]>[0]) => deps.settings.save(patch);
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
	/** Sondage « le serveur Ollama a-t-il démarré ? ». Retenu ici pour être
	    annulable : sans ça il continuait de tourner (et de redessiner la page)
	    après la fermeture de la vue. */
	let ollamaPoll: number | null = null;
	/** La vue a été fermée : plus rien ne doit repeindre ni démarrer. Un
	    `abort()` posé pendant l'encodage des images n'a encore aucun processus
	    à tuer — c'est ce drapeau qui arrête la génération à l'étape suivante. */
	let disposed = false;
	// ResizeObserver de la carte composer (mesure du text-indent des chips) :
	// déconnecté et recréé à chaque render (composer recréé) — cf. layoutChipsRow.
	let composerResizeObserver: ResizeObserver | null = null;
	let phase: Phase = "idle"; // idle | loading | result | error
	/* Le SIGNAL de génération en cours, pour le rail (demande d'Ahmed du
	   2026-09-13 : l'icône « Générer » s'anime tant que le modèle travaille,
	   même depuis une autre page). Une classe sur la racine du document,
	   posée et retirée ICI, au seul endroit qui connaît la phase ; le rail
	   ne fait qu'y réagir en CSS (`dashboard-nav.css`, `qbd-generating`).
	   Retirée aussi au démontage : une génération annulée par la fermeture
	   de la vue ne doit pas laisser l'étincelle tourner. */
	function signalerGeneration(enCours: boolean): void {
		document.documentElement.classList.toggle("qbd-generating", enCours);
	}
	/* Demande PARTIE (bulle façon claude.ai). Non nulle dès l'envoi, remise à
	   null quand la demande retourne dans le composer (annulation) ou qu'on
	   recommence à zéro. */
	let sentMessage: SentMessage | null = null;
	/** L'entrée de la bulle reste à jouer (posée à l'envoi, consommée au rendu). */
	let sentAnimPending = false;
	// Client IA de la génération en cours — permet au bouton stop (et à
	// la touche Esc) d'annuler réellement (kill du CLI / abort du fetch).
	let activeClient: AiClient | null = null;
	/* Page « quiz » de la zone résultat — la MÊME que celle d'un quiz du
	   vault. Créée à la première génération, réutilisée ensuite : elle garde
	   son état (question courante, mode) tant que la clé ne change pas.
	   generationId invalide le brouillon à chaque nouvelle génération. */
	let resultPage: QuizPageHandlers | null = null;
	/** Brouillon éditable du quiz généré, lié à SA génération. */
	let generatedDraft: { genId: number; draft: QuizDraft } | null = null;
	let generationId = 0;
	let generatedQuestions: unknown[] = [];
	let errorMessage = "";
	let containerRef: HTMLElement | null = null;
	/* Ce que la DERNIÈRE génération a consommé — null quand le fournisseur ne
	   publie aucun compteur, auquel cas l'écran le dit. */
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
		const providerId = settings().aiProvider || "";
		if (!providerId) return false;
		// Un fournisseur desktop-only (Claude Code CLI) est inutilisable sur
		// mobile : on bloque l'envoi à la source (le bouton d'envoi lit
		// canGenerate) plutôt que de laisser l'utilisateur envoyer un prompt
		// qui échouera — sinon composer « cassé ». Le hint « desktop
		// uniquement » explique déjà pourquoi.
		const provider = aiProviders.getProvider(providerId);
		if (provider && provider.desktopOnly && host.platform.isMobile) return false;
		return !!(composerText.trim() || images.length > 0 || noteAttachments.length > 0);
	}

	async function render(container: HTMLElement | null): Promise<void> {
		if (!container) return;
		containerRef = container;
		closeAllSelects();
		// Tooltips portalés au <body> (stop, effort) : un re-render détruit
		// leur ancre sans mouseleave → purge pour éviter les orphelins.
		document.querySelectorAll(".qbd-hover-tip").forEach(t => t.remove());
		// Le composer (et son ResizeObserver) est détruit par container.replaceChildren() :
		// déconnecter AVANT, sinon l'ancien observer continue de viser un élément
		// détaché (fuite silencieuse, un de plus à chaque render).
		if (composerResizeObserver) { composerResizeObserver.disconnect(); composerResizeObserver = null; }
		container.replaceChildren();

		// ── Scène unique (le layout 2 colonnes est supprimé — maquette
		// validée 2026-07-10) : idle/loading/error → titre + composer
		// CENTRÉS dans la page (référence claude.ai, plus de zone
		// « Aperçu » vide) ; result → l'ÉDITEUR embarqué pleine page et
		// le composer EN BAS (variante B « chat »). `formCol` reste le
		// nom du parent du composer pour ne pas réécrire tout le bloc.
		const stage = ajouter(container, "div", "qbd-ai-stage qbd-ai-stage--" + phase);
		// Zone résultat créée AVANT le composer : l'ordre DOM le met en bas.
		const resultZone = phase === "result" ? ajouter(stage, "div", "qbd-ai-result-zone") : null;
		const formCol = stage;

		// ── Page header ──
		// Absent en résultat (la page du quiz porte son propre titre) et dès
		// qu'une demande est partie : sur claude.ai le hero d'accueil cède la
		// place à la conversation à la seconde où l'on envoie. Le garder
		// au-dessus de la bulle donnerait l'impression de n'être jamais parti.
		if (phase !== "result" && !sentMessage) {
			const titleRow = ajouter(formCol, "div", "qbd-ai-title-row");
			const titleIcon = ajouter(titleRow, "span", "qbd-ai-title-icon");
			// Glyphe de marque NU à côté du titre serif, comme l'astérisque de
			// claude.ai — « sparkles » retenu sur planche comparative (2026-07-16).
			host.ui.setIcon(titleIcon, "sparkles");
			ajouter(titleRow, "h2", "qbd-ai-title", t("ai.page.title"));
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
		const loadingZone = phase === "loading" ? ajouter(stage, "div", "qbd-ai-loading-zone") : null;
		/* L'erreur se lit SOUS la demande, au-dessus du composer — comme la
		   réponse qu'elle remplace. Rendue en dernier, elle passait sous le
		   composer : on lisait la demande, puis un champ vide, puis seulement
		   l'échec. */
		const errorZone = phase === "error" ? ajouter(stage, "div", "qbd-ai-loading-zone") : null;

		// ── Fournisseur : bouton LOGO SEUL dans le pied du composer (la
		// carte « Modèle IA » est supprimée) — le menu garde logos, statut
		// et sous-titre ; le tooltip au survol porte nom + statut.
		// Aucun fournisseur par défaut : le choix reste la première étape,
		// le contrôle Modèle n'apparaît qu'une fois le fournisseur choisi.
		const provider = settings().aiProvider || "";
		const currentModel = provider
			? (settings().aiModel || aiProviders.getProvider(provider).defaultModel)
			: "";

		let providerSelect: SelectHandle<ProviderSelectOption> | null = null;
		const buildProviderControl = (parent: HTMLElement): void => {
			const sel = createSelect<ProviderSelectOption>(parent, {
				value: provider || undefined,
				options: aiProviders.PROVIDERS.map(p => ({ value: p.id, label: p.name, logo: p.logo, sub: p.sub })),
				renderTrigger: (el, o) => {
					if (!o) {
						// Aucun fournisseur : slot vide, le tooltip guide.
						const ic = ajouter(el, "span", "qbd-provider-logo");
						host.ui.setIcon(ic, "circle-dashed");
						return;
					}
					const logo = ajouter(el, "span", "qbd-provider-logo qbd-provider-logo--" + o.logo);
					aiProviders.setBrandLogo(logo, o.logo);
				},
				renderOption: (el, o) => {
					const logo = ajouter(el, "span", "qbd-provider-logo qbd-provider-logo--" + o.logo);
					aiProviders.setBrandLogo(logo, o.logo);
					const body = ajouter(el, "div", "qbd-provider-option-body");
					ajouter(body, "span", "qbd-select-option-label", o.label);
					const st = providerStatus[o.value];
					ajouter(body, "span", "qbd-provider-option-sub", st ? st.text : o.sub);
					ajouter(el, "span", "qbd-status-dot qbd-status-dot--" + (st ? st.dot : "checking"));
				},
				onChange: async (id) => {
					await saveSettings({ aiProvider: id, aiModel: aiProviders.getProvider(id).defaultModel });
					render(container);
				},
				// Re-vérifie les CLI à CHAQUE ouverture du menu (force = sans TTL) :
				// après un « claude/codex update », la version affichée se met à
				// jour toute seule, le menu ouvert est redessiné à l'arrivée des
				// résultats (setStatus → refreshMenu).
				onOpen: () => refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true })
			});
			providerSelect = sel;
			sel.el.classList.add("qbd-provider-trigger-logo");
			// Tooltip : nom + statut, relus à chaque survol (les détections
			// async peuvent arriver après le rendu).
			let tip: HTMLElement | null = null;
			const hide = () => { if (tip) { tip.remove(); tip = null; } };
			sel.el.addEventListener("mouseenter", () => {
				if (tip) return;
				tip = ajouter(document.body, "div", "qbd-hover-tip");
				const p = aiProviders.PROVIDERS.find(x => x.id === (settings().aiProvider || ""));
				ajouter(tip, "div", "qbd-hover-tip-title", p ? p.name : t("ai.provider.choose"));
				const st = p && providerStatus[p.id];
				if (st) ajouter(tip, "div", "qbd-hover-tip-body", st.text);
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
			const catalog = settings().aiOllamaCatalog;
			const list = aiProviders.resolveOllamaSelection(settings().aiOllamaModels, catalog).map(decorate);
			// Modèles locaux installés hors sélection → ajoutés en fin de liste.
			(detected || []).forEach(m => {
				const norm = m.name.replace(/:latest$/, "");
				if (list.some(o => o.value === m.name || o.value.replace(/:latest$/, "") === norm)) return;
				list.push({ value: m.name, label: m.name.replace(":latest", ""), cloud: false,
					installed: true, thinking: (m.capabilities || []).includes("thinking"), icon: null });
			});
			// Modèle courant hors liste → placé en tête.
			const cur = settings().aiModel || currentModel;
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
			const getModels = (): aiProviders.ModelDef[] => isClaude ? aiProviders.getClaudeModels(deps.usage?.claudePlan()) : aiProviders.getDefaultModels("codex");
			const resolveMv = (v?: string): string => isClaude ? aiProviders.resolveClaudeModel(v) : aiProviders.resolveCodexModel(v);
			// Modèle et effort = DEUX boutons séparés (référence claude.ai /
			// ChatGPT). Le modèle ouvre le menu de modèles (sans ligne Effort) ;
			// l'effort ouvre le popover slider (openEffortSlider), variante
			// claude ou codex. Les efforts Codex dépendent du modèle courant
			// (supported_reasoning_levels) → tout est relu à chaque usage.
			buildModelControl = (parent: HTMLElement): void => {
				const currentMv = () => resolveMv(settings().aiModel || currentModel);
				const currentEfforts = () => aiProviders.getEfforts(provider, currentMv());
				const currentEv = () => aiProviders.resolveEffort(provider, settings().aiEffort, currentMv());

				// Référence Claude Code : « Opus 4.8  Max » — libellés nus,
				// SANS chevrons, rapprochés (l'effort en Capitalisé).
				const trigger = ajouter(parent, "button", "qbd-select qbd-model-trigger qbd-composer-plain");
				trigger.type = "button";
				const trigLabel = ajouter(trigger, "span", "qbd-select-label");

				const effortBtn = ajouter(parent, "button", "qbd-select qbd-effort-trigger qbd-composer-plain");
				effortBtn.type = "button";
				const effortLabel = ajouter(effortBtn, "span", "qbd-select-label qbd-effort-trigger-label");

				const EFFORT_DISPLAY: Record<string, string> = {
					low: "Low", medium: "Medium", high: "High",
					xhigh: "Extra", max: "Max", ultracode: "Ultracode", ultra: "Ultra"
				};

				const refreshTriggers = () => {
					trigLabel.replaceChildren();
					const models = getModels();
					const cur = models.find(m => m.value === currentMv()) || models[0];
					// Fast actif (codex) → éclair à gauche du nom du modèle,
					// comme la pill du composer ChatGPT.
					if (!isClaude && settings().aiCodexFast && cur.fast) {
						const z = ajouter(trigLabel, "span", "qbd-model-trigger-zap");
						host.ui.setIcon(z, "zap");
					}
					ajouter(trigLabel, "span", "qbd-model-trigger-name", cur.label);
					const ev = currentEv();
					const ef = currentEfforts().find(e => e.value === ev);
					effortLabel.textContent = (EFFORT_DISPLAY[ev] || (ef ? ef.label : ev));
					effortBtn.classList.toggle("is-ultra", !!(ef && ef.accent));
				};
				refreshTriggers();
				/* L'INSTANTANÉ des fichiers de CLI (tranche 5, tâche 3) :
				   `getModels()` est synchrone et lit un instantané de module que
				   seul `refreshCliCaches` remplit. L'étiquette vient d'être
				   dessinée avec ce qu'on avait ; on la redessine UNE fois si
				   l'instantané a changé — `refreshTriggers` et non un re-rendu du
				   composer, qui effacerait le message en cours de frappe. */
				void aiProviders.refreshCliCaches().then(change => {
					if (change && trigger.isConnected) refreshTriggers();
				});

				/* RELU À L'OUVERTURE, comme avant : la liste suivait
				   `~/.codex/models_cache.json` à chaque clic (un modèle neuf du
				   compte y apparaissait sans mise à jour du plugin). La lecture
				   est devenue asynchrone, l'attente aussi — quelques
				   millisecondes avant que le menu ne s'ouvre. */
				trigger.addEventListener("click", async () => {
					await aiProviders.refreshCliCaches();
					if (!trigger.isConnected) return;
					openModelMenu(trigger, {
						models: getModels(),
						currentModel: currentMv(),
						// L'effort a son propre bouton → pas de ligne Effort ici.
						efforts: [],
						onPickModel: async (v) => {
							await saveSettings({ aiModel: v });
							refreshTriggers();
						}
					});
				});

				effortBtn.addEventListener("click", () => {
					// Éclair Fast (codex) : seulement si CE modèle expose le tier
					// « priority » (models_cache) — toggle persisté aiCodexFast.
					const curModel = getModels().find(m => m.value === currentMv());
					const fast = (!isClaude && curModel && curModel.fast) ? {
						on: !!settings().aiCodexFast,
						onToggle: async (v: boolean) => {
							await saveSettings({ aiCodexFast: v });
							refreshTriggers(); // éclair du bouton modèle
						}
					} : null;
					openEffortSlider(effortBtn, {
						variant: isClaude ? "claude" : "codex",
						efforts: currentEfforts(),
						currentEffort: currentEv(),
						fast,
						onPickEffort: async (v) => {
							await saveSettings({ aiEffort: v });
							refreshTriggers();
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
				const trigger = ajouter(parent, "button", "qbd-select qbd-model-trigger");
				trigger.type = "button";
				const trigLabel = ajouter(trigger, "span", "qbd-select-label");
				const trigChev = ajouter(trigger, "span", "qbd-select-chevron");
				host.ui.setIcon(trigChev, "chevron-down");
				const curOpt = (): OllamaListItem | undefined => {
					const mv = settings().aiModel || currentModel;
					return ctl.options.find(o => o.value === mv) || ctl.options[0];
				};
				const refreshTrigger = () => {
					trigLabel.replaceChildren();
					const cur = curOpt();
					const mv = settings().aiModel || currentModel;
					ajouter(trigLabel, "span", "qbd-model-trigger-name", cur ? cur.label : (mv || "").replace(":latest", ""));
					if (cur && cur.thinking) {
						ajouter(trigLabel, "span", "qbd-model-trigger-effort", aiProviders.getEffortLabel(aiProviders.resolveEffort(provider, settings().aiEffort), provider));
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
						currentModel: settings().aiModel || currentModel,
						efforts: (cur && cur.thinking) ? efforts : [],
						currentEffort: aiProviders.resolveEffort(provider, settings().aiEffort),
						onPickModel: async (v) => {
							await saveSettings({ aiModel: v });
							refreshTrigger();
						},
						onPickEffort: async (v) => {
							await saveSettings({ aiEffort: v });
							refreshTrigger();
						}
					});
				});
			};
		}


		// ── Composer (champ unique + bouton « + » d'attachements) ──
		let generateBtnRef: HTMLButtonElement | null = null;

		const composer = ajouter(formCol, "div", "qbd-ai-composer");

		// Vignettes d'images : rangée à PART, au-dessus du champ — ~40px de
		// haut, les mêler à une ligne de texte de 13,5px les déformerait.
		// Seules les chips « notes » passent en superposition sur la 1ʳᵉ
		// ligne du texte (cf. textZone ci-dessous).
		if (images.length > 0) {
			const imagesRow = ajouter(composer, "div", "qbd-ai-composer-attachments");
			for (let i = 0; i < images.length; i++) {
				const thumb = ajouter(imagesRow, "div", "qbd-ai-image-thumb");
				const imgEl = ajouter(thumb, "img", "qbd-ai-image-thumb-img");
				imgEl.src = images[i].url;
				const removeBtn = ajouter(thumb, "button", "qbd-ai-image-remove");
				host.ui.setIcon(removeBtn, "x");
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
		const textZone = ajouter(composer, "div", "qbd-ai-composer-textzone");
		let chipsRow: HTMLElement | null = null;
		if (noteAttachments.length > 0) {
			chipsRow = ajouter(textZone, "div", "qbd-ai-composer-chips");
			for (let i = 0; i < noteAttachments.length; i++) {
				const note = noteAttachments[i];
				const chip = ajouter(chipsRow, "div", "qbd-ai-note-chip");
				const chipIcon = ajouter(chip, "span", "qbd-ai-note-chip-icon");
				host.ui.setIcon(chipIcon, "file-text");
				const chipName = ajouter(chip, "span", "qbd-ai-note-chip-name", (note.expanded && note.path) ? note.path : note.name);
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
					chip.classList.add("qbd-ai-note-chip--toggle");
					chip.addEventListener("click", (e) => {
						if ((e.target as HTMLElement).closest(".qbd-ai-note-chip-remove")) return;
						note.expanded = !note.expanded;
						render(containerRef);
					});
				}
				const chipRemove = ajouter(chip, "button", "qbd-ai-note-chip-remove");
				host.ui.setIcon(chipRemove, "x");
				const idx = i;
				chipRemove.addEventListener("click", (e) => {
					e.stopPropagation(); // ne déclenche pas le basculement du chip
					noteAttachments.splice(idx, 1);
					render(containerRef);
				});
			}
		}

		const composerInput = ajouter(textZone, "textarea", "qbd-ai-composer-input");
		let mentions: MentionPickerHandle | null = null;
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

		mentions = attachMentionPicker(composerInput, composer, {
			onPickVaultFile: (path) => { void attachVaultPath(path); },
			onPickExternalFile: (path) => { void attachExternalPath(path); },
			onTextReplaced: (value) => {
				composerText = value;
				composerCaret = composerInput.selectionStart;
				autoGrow();
				updateGenerateBtn(generateBtnRef);
			},
			// Lu au rendu (le réglage peut changer sans rouvrir la vue).
			getExtraRoots: () => settings().aiMentionExtraFolders || [],
		});

		// Rangée du bas : bouton « + » (gauche), puis à droite le modèle +
		// effort (façon claude.ai) et le bouton d'envoi.
		const composerBottom = ajouter(composer, "div", "qbd-ai-composer-bottom");
		const addBtn = ajouter(composerBottom, "button", "qbd-ai-composer-add");
		addBtn.type = "button";
		addBtn.setAttribute("aria-label", t("ai.composer.addContent"));
		host.ui.setIcon(addBtn, "plus");

		// Bouton Options (questions + type) : JUSTE à droite du « + » (façon
		// pills gauche de claude.ai, demande 2026-07-16) — popover à la
		// demande, tooltip d'état.
		const optsBtn = ajouter(composerBottom, "button", "qbd-ai-composer-opts");
		optsBtn.type = "button";
		host.ui.setIcon(optsBtn, "sliders-horizontal");
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
			ajouter(tip, "div", "qbd-hover-tip-title", t("ai.options.tooltip", { count: questionCount, type: typeLabel(questionType) }));
		});

		/* Consultation du forfait, à sa place de contrôle : dans le composer,
		   avec le « + » et les options (référence Ahmed 2026-07-30). Savoir ce
		   qu'il reste n'a d'intérêt que si on peut le demander SANS dépenser,
		   d'où un bouton toujours accessible plutôt qu'un badge d'après-coup.
		   Réservé aux fournisseurs qui publient réellement un forfait — et aux
		   hôtes qui savent le lire (`deps.usage`, le greffon seul). */
		const usage = deps.usage;
		if (usage && host.platform.isDesktopApp && providerPublishesPlan(settings().aiProvider || "")) {
			const usageBtn = ajouter(composerBottom, "button", "qbd-ai-composer-usage");
			usageBtn.type = "button";
			host.ui.setIcon(usageBtn, "gauge");
			labelIconButton(usageBtn, t("ai.usage.title"));
			attachHoverTip(usageBtn, (tip) => {
				ajouter(tip, "div", "qbd-hover-tip-title", t("ai.usage.title"));
				const tightest = tightestRow(lastPlan?.rows || []);
				if (tightest) {
					ajouter(tip, "div", "qbd-hover-tip-body", `${usageRowLabel(tightest)} · ${t("ai.usage.usedPercent", { n: Math.round(tightest.usedPercent) })}`);
				}
			});
			usageBtn.addEventListener("click", () => void openUsage(usage));
		}

		// Groupe droite : logo fournisseur, sélecteur modèle + effort, puis
		// bouton d'envoi.
		const composerTools = ajouter(composerBottom, "div", "qbd-ai-composer-tools");
		buildProviderControl(composerTools);
		if (buildModelControl) buildModelControl(composerTools);

		// Bouton générer dans le composer (façon bouton d'envoi claude.ai) :
		// caché tant que le champ est vide, flèche ↑ blanche sur fond accent.
		// Pendant la génération il devient le bouton STOP (carré + tooltip
		// « Arrêter Esc ») qui annule réellement la génération.
		const sendBtn = ajouter(composerTools, "button", "qbd-ai-composer-send");
		sendBtn.type = "button";
		const sendIcon = ajouter(sendBtn, "span", "qbd-ai-composer-send-icon");
		if (phase === "loading") {
			sendBtn.classList.add("is-stop");
			// Pas d'aria-label ici : Obsidian en fait un tooltip natif,
			// redondant avec le tooltip custom « Arrêter Esc ».
			// Carré dessiné en CSS (l'icône Lucide est trop fine/petite).
			ajouter(sendIcon, "div", "qbd-ai-stop-square");
			attachStopTip(sendBtn);
			sendBtn.addEventListener("click", () => { if (activeClient) activeClient.abort(); });
		} else {
			sendBtn.setAttribute("aria-label", t("ai.composer.generate"));
			host.ui.setIcon(sendIcon, "arrow-up");
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
		const fileInput = ajouter(composer, "input", "qbd-ai-file-input");
		fileInput.type = "file";
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
					hint: formatHotkey(settings().hotkeyAddFiles),
					onClick: () => fileInput.click()
				},
				{
					icon: "file-text",
					label: t("ai.add.notes"),
					hint: formatHotkey(settings().hotkeyAddNotes),
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
		if (provider) hintZone = ajouter(formCol, "div", "qbd-ai-model-hint");

		// Détections async (statut fournisseur + modèles réels) : APRÈS la
		// création de hintZone — l'appel fige ses arguments, et un hintZone
		// encore null rendait renderHint muet : « ChatGPT sélectionné, CLI
		// absent, aucun message » (vécu Ahmed, Codex CLI). Aussi après le
		// contrôle modèle (modelSelect existe). ollamaCtl et buildOllamaList
		// sont locaux à render → passés en paramètres (les référencer depuis
		// la fonction sœur lançait un ReferenceError, statut Ollama gelé).
		refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList });

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
			refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force: true });
		};
		window.addEventListener("focus", __focusRecheck);

		// (Les options Questions/Type vivent dans le popover du bouton
		// sliders du composer — l'ancienne carte « Options » est supprimée.)

		// ── État de la scène : loader AU-DESSUS du composer, erreur sous
		// le composer, ou l'éditeur embarqué dans la zone résultat. ──
		if (phase === "loading") renderLoading(loadingZone!);
		else if (phase === "error") renderError(errorZone!);
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
			providerSelect.setValue((settings().aiProvider || undefined) as string);
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
	     PowerShell, l'exe d'installation étant la voie mise en avant. */
	function installCmd(provider: "claude-code" | "codex" | "ollama"): { code: string; lang: string } {
		const win = host.platform.isWindows;
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
		zone.replaceChildren();
		if (!opts) return;
		const hint = ajouter(zone, "div", "qbd-ai-hint qbd-ai-hint--" + (opts.type || "info")
				+ (opts.code ? " qbd-ai-hint--has-code" : ""));
		const icon = ajouter(hint, "span", "qbd-ai-hint-icon");
		host.ui.setIcon(icon, opts.icon || (opts.type === "err" ? "alert-circle" : "info"));
		const body = ajouter(hint, "div", "qbd-ai-hint-body");
		ajouter(body, "span", "qbd-ai-hint-text", opts.text);
		if (opts.action) {
			const btn = ajouter(hint, "button", "qbd-ai-hint-action");
			btn.type = "button";
			if (opts.action.icon) {
				const aIcon = ajouter(btn, "span", "qbd-ai-hint-action-icon");
				host.ui.setIcon(aIcon, opts.action.icon);
			}
			ajouter(btn, "span", undefined, opts.action.label);
			btn.addEventListener("click", opts.action.onClick);
		}
		if (opts.code) renderHintCode(hint, opts.code, opts.lang || "bash");
	}

	/* Bloc commande = un BLOC, pas un énoncé : c'est l'hôte qui sait le rendre
	   en vrai bloc de code (sous Obsidian, le moteur Markdown de l'app —
	   coloration Prism, style de bloc de l'utilisateur, d'où markdown-rendered
	   ET markdown-preview-view, les deux racines que ces CSS ciblent, et le
	   bouton « copier » du post-processeur natif). Sans `renderCodeBlock`, un
	   `<pre><code>` nu porte le même texte — `textContent`, jamais du HTML. */
	function renderHintCode(hint: HTMLElement, code: string, lang: string): void {
		const box = ajouter(hint, "div", "qbd-ai-hint-code markdown-rendered markdown-preview-view");
		if (deps.renderCodeBlock) { deps.renderCodeBlock(box, code, lang); return; }
		ajouter(ajouter(box, "pre"), "code", "language-" + lang, code);
	}

	/* Détections async : statut de chaque provider (trigger + menu du
	   sélecteur), et pour le provider actif, hint contextuel + liste
	   réelle de modèles. */
	function refreshProviderStatuses({ providerSelect, hintZone, provider, currentModel, modelSelect, ollamaCtl, buildOllamaList, force }: RefreshArgs): void {
		const ollamaUrl = settings().aiOllamaUrl;

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

		aiProviders.checkOllama(ollamaUrl, force).then(async (res) => {
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
								// ASYNCHRONE depuis la tranche 5 (dans l'application,
								// le démarrage traverse l'IPC) : rien à attendre ici,
								// c'est le poll ci-dessous qui constate le résultat.
								void aiProviders.startOllamaApp();
								// Poll : vert automatique dès que le
								// serveur répond (10 s max).
								let tries = 0;
								if (ollamaPoll) window.clearInterval(ollamaPoll);
								ollamaPoll = window.setInterval(() => {
									tries++;
									// force : le serveur vient de démarrer, le cache
									// de détection dirait encore « injoignable ».
									aiProviders.checkOllama(ollamaUrl, true).then(r2 => {
										if (!r2.ok && tries < 10) return;
										if (ollamaPoll) { window.clearInterval(ollamaPoll); ollamaPoll = null; }
										if (r2.ok) render(containerRef);
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
				/* Le texte d'un PDF vient de l'HÔTE (`host.pdf`, membre OPTIONNEL) :
				   l'application n'en a pas, et le dit plutôt que de joindre un
				   PDF vide en silence — voir `HostPdf` dans le contrat. */
				if (!host.pdf) { host.ui.notice(t("ai.error.pdfUnsupportedInApp")); continue; }
				try {
					const content = await host.pdf.extractText(new Uint8Array(await file.arrayBuffer()));
					if (!content.trim()) {
						host.ui.notice(t("ai.notice.pdfNoText", { name: file.name }));
					} else {
						const key = attachmentKey({ source, path: origin?.path, name: file.name });
						if (noteAttachments.some(n => attachmentKey(n) === key)) {
							host.ui.notice(t("ai.notice.noteAlreadyAttached", { name: file.name }));
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
						host.ui.notice(t("ai.notice.noteAlreadyAttached", { name: file.name }));
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
			host.ui.notice(t("ai.notice.unsupportedFormat", { files: rejected.join(", ") }));
		}
	}

	/* Attache une note du vault comme source du quiz (menu « Ajouter des
	   notes » et raccourci — remplace l'ancienne « note active »). */
	async function attachNoteVaultFile(file: HostFile): Promise<void> {
		// Dédoublonnage par attachmentKey (source « vault » + path), PAS par
		// name seul : sinon un « AGENTS.md » du vault percute à tort un
		// « AGENTS.md » externe/déposé de contenu différent (régression
		// corrigée ici — cf. rapport de tâche).
		const key = attachmentKey({ source: "vault", path: file.path, name: file.name });
		if (noteAttachments.some(n => attachmentKey(n) === key)) {
			host.ui.notice(t("ai.notice.noteAlreadyAttached", { name: file.basename }));
			return;
		}
		try {
			const content = await host.fs.read(file.path);
			// file.name (PAS file.basename) : la chip affiche le nom complet
			// AVEC son extension, comme les fichiers .md/.txt/PDF attachés via
			// addComposerFiles (déjà sur file.name).
			noteAttachments.push({ name: file.name, content, path: file.path, source: "vault" });
			render(containerRef);
		} catch (e) {
			host.ui.notice(t("ai.notice.noteReadFailed", { name: file.basename }));
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
		const f = host.fs.getFile(path);
		if (!f) return;
		const ext = f.extension.toLowerCase();
		if (ext === "md" || ext === "txt") { await attachNoteVaultFile(f); return; }
		try {
			const octets = await host.fs.readBinary(f.path);
			// `slice()` : un `Uint8Array` sur un tampon partagé n'est pas un `BlobPart`.
			const file = new File([octets.slice()], f.name, { type: mimeForName(f.name) });
			await addComposerFiles([file], { source: "vault", path: f.path });
		} catch (e) {
			host.ui.notice(t("ai.notice.noteReadFailed", { name: f.name }));
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
	   pas de lecture pour un doublon détecté à l'avance. */
	async function attachExternalPath(path: string): Promise<void> {
		if (!host.platform.isDesktopApp) return;
		const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
		const key = attachmentKey({ source: "external", path, name });
		if (noteAttachments.some(n => attachmentKey(n) === key)) {
			host.ui.notice(t("ai.notice.noteAlreadyAttached", { name }));
			return;
		}
		try {
			/* Par le contrat (`externe.readBinary`, chemin ABSOLU) : dans
			   l'application, c'est un canal BORNÉ au périmètre, pas un `fs`. */
			const octets = await host.fs.externe.readBinary(path);
			// mimeForName : addComposerFiles teste file.type EN PREMIER pour les
			// images, un File sans type finirait en chip texte au lieu d'une vignette.
			const file = new File([octets.slice()], name, { type: mimeForName(name) });
			await addComposerFiles([file], { source: "external", path });
		} catch (e) {
			host.ui.notice(t("ai.notice.noteReadFailed", { name }));
		}
	}

	/* Cibles des raccourcis du composer (Scope de la vue dashboard) et du
	   menu « + ». Actifs seulement si le composer est rendu (vue Générer). */
	function openAddFiles(): void {
		if (fileInputRef && fileInputRef.isConnected) fileInputRef.click();
	}

	function openAddNotes(): void {
		if (!addBtnRef || !addBtnRef.isConnected) return;
		openNotePicker(addBtnRef, {
			openFiles: deps.openFiles?.() ?? [],
			allFiles: host.fs.listMarkdown(),
			onPick: (file) => attachNoteVaultFile(file)
		});
	}

	/* ── Bulle de la demande envoyée (référence claude.ai) ──
	   Lecture seule, alignée à droite : une fois partie, la demande ne se
	   remodifie plus et ne se renvoie plus depuis là (retour Ahmed
	   2026-07-31 — le composer qui gardait le texte donnait l'impression
	   que rien n'était parti). Pour la reprendre : annuler la génération,
	   elle retourne alors dans le composer. */
	function renderSentMessage(parent: HTMLElement): void {
		const msg = sentMessage;
		if (!msg) return;
		const bubble = ajouter(parent, "div", "qbd-ai-sent");
		// L'entrée ne joue qu'au PREMIER rendu qui suit l'envoi : pendant la
		// génération, la page se re-rend (statuts de fournisseur, quotas) et
		// une bulle qui rebondit à chaque fois ferait clignoter la scène.
		if (sentAnimPending) {
			sentAnimPending = false;
			bubble.classList.add("qbd-ai-sent--in");
		}

		if (msg.images.length > 0) {
			const row = ajouter(bubble, "div", "qbd-ai-sent-images");
			for (const img of msg.images) {
				const thumb = ajouter(row, "div", "qbd-ai-image-thumb");
				ajouter(thumb, "img", "qbd-ai-image-thumb-img").src = img.url;
			}
		}

		if (msg.notes.length > 0) {
			const chips = ajouter(bubble, "div", "qbd-ai-sent-chips");
			for (const note of msg.notes) {
				const chip = ajouter(chips, "div", "qbd-ai-note-chip");
				host.ui.setIcon(ajouter(chip, "span", "qbd-ai-note-chip-icon"), "file-text");
				const name = ajouter(chip, "span", "qbd-ai-note-chip-name", note.name);
				name.title = note.path || note.name;
			}
		}

		if (msg.text.trim()) ajouter(bubble, "div", "qbd-ai-sent-text", msg.text.trim());
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

	/** Le composer est-il resté vierge depuis l'envoi ? */
	function composerIsEmpty(): boolean {
		return !composerText.trim() && noteAttachments.length === 0 && images.length === 0;
	}

	/** Remet la demande partie dans le composer (annulation, réessai) et
	    referme la bulle — le contraire exact de takeComposerMessage.

	    Le composer reste utilisable pendant la génération : si une NOUVELLE
	    demande y a été saisie entre-temps, elle prime. Rendre l'ancienne
	    l'effacerait purement et simplement (et abandonnerait ses images sans
	    les révoquer) ; l'ancienne est alors abandonnée, elle. */
	function restoreComposerMessage(): void {
		if (!sentMessage) return;
		if (!composerIsEmpty()) { dropSentMessage(); return; }
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
	function renderLoading(parent: HTMLElement): void {
		const loader = ajouter(parent, "div", "qbd-ai-preview-loading");
		const iconWrap = ajouter(loader, "div", "qbd-ai-loading-icon");
		host.ui.setIcon(iconWrap, "sparkles");
		ajouter(loader, "p", "qbd-ai-loading-title", t("ai.loading.title"));

		const dots = ajouter(loader, "div", "qbd-ai-loading-dots");
		for (let i = 0; i < 3; i++) {
			ajouter(dots, "div", "qbd-ai-loading-dot");
		}
	}

	function renderError(parent: HTMLElement): void {
		const errorEl = ajouter(parent, "div", "qbd-ai-preview-error");
		const errorIcon = ajouter(errorEl, "div", "qbd-ai-error-icon");
		host.ui.setIcon(errorIcon, "alert-triangle");
		ajouter(errorEl, "p", "qbd-ai-error-title", t("ai.error.title"));
		ajouter(errorEl, "p", "qbd-ai-error-msg", errorMessage);

		const retryBtn = ajouter(errorEl, "button", "qbd-btn qbd-btn--ghost qbd-ai-error-retry", t("ai.error.retry"));
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
	async function openUsage(usage: AiUsageDeps): Promise<void> {
		/* L'écran d'usage lit lui aussi l'instantané de `~/.claude.json` (Fable
		   proposé ?, notes promo en cours) par `ai-providers`. Une entrée
		   d'affichage de plus, donc un `await` de plus — le seul du fichier avec
		   le menu de modèles. */
		await aiProviders.refreshCliCaches();
		await usage.open({
			provider: settings().aiProvider || "",
			usage: lastUsage,
			known: lastPlan,
			onData: (data) => { lastPlan = data; }
		});
	}

	/* Zone résultat (pleine page, composer en bas) : barre compacte +
	   l'ÉDITEUR DE QUIZ COMPLET embarqué — exigence explicite, pas une
	   liste simplifiée. */
	function renderResult(container: HTMLElement): void {
		// La MÊME page qu'un quiz du vault (dashboard/detail.ts) : liste des
		// questions à gauche, question courante à droite, bouton « Editor »
		// qui bascule le mode. L'éditeur en trois colonnes qui vivait ici
		// n'était pas assez simple (retour Ahmed 2026-07-31) — et il n'avait
		// aucune raison d'être un écran différent de celui d'un quiz existant.
		/* `page` et non `host` : `host` est l'HÔTE de ce module (`currentHost()`),
		   et le masquer ici rendrait illisible tout ajout futur à cette fonction. */
		const page = ajouter(container, "div", "qbd-ai-quiz-page");
		if (!resultPage) resultPage = createQuizPage({ statsStore: deps.statsStore });

		resultPage.render(page, {
			// La clé change à chaque génération : la page repart alors de la
			// question 1, en consultation. Un re-render de la scène (statut de
			// fournisseur, quota) garde la même clé, donc l'édition en cours.
			key: "generated:" + generationId,
			title: generatedTitle(),
			// Ligne discrète du header : ce que la génération a coûté, là où
			// un quiz du vault affiche son chemin.
			subtitle: usageLine(),
			// Compté sur le BROUILLON, pas sur la réponse brute : celle-ci
			// contient aussi l'objet de mode, qui n'est pas une question.
			questionCount: loadGeneratedDraft().questions.length,
			load: () => Promise.resolve(loadGeneratedDraft()),
			// Cette page ne reste visible que si l'enregistrement automatique a
			// échoué. Le brouillon édité permet alors de réessayer sans perte.
			onBack: () => restartGeneration(),
			start: {
				label: t("ai.result.save"),
				icon: "save",
				onClick: () => { void saveGeneratedQuiz(); },
			},
			actions: [{
				label: t("ai.result.insert"),
				icon: "plus",
				// Ancré sur le bouton : le picker se positionne sur son rectangle.
				onClick: (btn) => openInsertPicker(btn),
			}],
			isStale: () => phase !== "result",
		});
	}

	/** Enregistre le quiz puis ouvre sa page détail, qui porte déjà le bouton
	    principal « Lancer ». Toujours la racine PAR DÉFAUT de l'hôte (demande
	    d'Ahmed du 2026-09-13) : le dossier « Generated » doit rester dans
	    C:\Neo Quiz, quelle que soit la note jointe par « @ ». */
	async function saveGeneratedQuiz(): Promise<boolean> {
		const root = host.paths.defaultRoot();

		try {
			const draft = loadGeneratedDraft();
			if (!draft.questions.length) return false;
			const localFolder = settings().aiOutputFolder || aiSettingsDefaults().aiOutputFolder;
			const folder = host.paths.contractPath(root.id, localFolder);
			await ensureFolder(folder);
			// Le même titre que la page affiche, sans les points de suspension
			// qu'il ajoute à une demande coupée : ils n'ont rien à faire dans
			// un nom de fichier.
			const title = generatedTitle().replace(/…$/, "");
			const name = title !== t("ai.result.untitled")
				? title
				: t("dashboard.quizzes.newQuizDefaultName");
			const path = await freeNotePath(folder, name);
			await host.fs.write(path, exportAllWithFence(draft.questions, draft.examOptions) + "\n");

			const file = host.fs.getFile(path);
			if (file) await deps.scanner.scanFile(file);
			const entry = deps.scanner.getQuiz(path);
			if (entry) {
				resetGeneration();
				deps.navigate("detail", { quiz: entry });
				return true;
			}
		} catch (err) {
			// La cause reste interne ; la Notice traduite évite l'échec silencieux.
		}
		host.ui.notice(t("ai.notice.saveFailed"));
		return false;
	}

	/** Titre de la page d'un quiz fraîchement généré : la DEMANDE, abrégée.
	    Elle dit de quoi parle le quiz mieux que « Nouveau quiz », et c'est ce
	    que l'utilisateur vient d'écrire — il le reconnaît. */
	function generatedTitle(): string {
		const raw = (sentMessage?.text || "").trim().split("\n")[0].trim();
		if (!raw) return t("ai.result.untitled");
		if (raw.length <= 60) return raw;
		// Couper au dernier MOT entier : « …sur le modele OSI : un texte a t… »
		// se lit mal. Repli sur la coupe brute si le premier mot est immense.
		const cut = raw.slice(0, 60);
		const space = cut.lastIndexOf(" ");
		return (space > 30 ? cut.slice(0, space) : cut).replace(/[\s:,;–—-]+$/, "") + "…";
	}

	/** « 6 questions · 54k tokens · $0.73 · 2 min 33 s » — la ligne du header,
	    à la place du chemin de note qu'un quiz du vault y affiche. */
	function usageLine(): string {
		const parts = [t("ai.result.count", { count: loadGeneratedDraft().questions.length })];
		if (lastUsage) {
			parts.push(t("ai.usage.badge", { tokens: formatTokens(totalTokens(lastUsage)) }));
			const cost = formatCost(lastUsage.costUsd);
			if (cost) parts.push(cost);
			const dur = formatDuration(lastUsage.durationMs);
			if (dur) parts.push(dur);
		}
		return parts.join("  ·  ");
	}

	/** Brouillon éditable à partir des questions générées. Passe par la MÊME
	    conversion que la lecture d'une note (editor/convert.ts) : un quiz
	    généré et un quiz relu d'un .md doivent être le même objet. */
	function loadGeneratedDraft(): QuizDraft {
		if (generatedDraft && generatedDraft.genId === generationId) return generatedDraft.draft;
		const questions: DraftQuestion[] = [];
		let examOptions: EditorExamOptions | null = null;
		// Par son INDEX : le critère dépend de la POSITION dans le bloc
		// (quiz-utils.ts), un test élément par élément ne peut pas le savoir.
		const configIdx = findQuizModeConfigIndex(generatedQuestions as ParsedQuizItem[]);
		(generatedQuestions as ParsedQuizItem[]).forEach((raw, i) => {
			if (i === configIdx) { examOptions = readModeConfig(raw); return; }
			questions.push(convertParsedToInternal(raw));
		});
		// `file: null` : ce quiz n'a pas de note. C'est ce qui distingue un
		// brouillon généré d'un brouillon lu — et pourquoi la page n'a pas
		// de `save`.
		const draft: QuizDraft = { file: null, questions, examOptions };
		generatedDraft = { genId: generationId, draft };
		return draft;
	}

	/** Picker d'insertion : notes OUVERTES en tête + recherche dans tout le vault. */
	function openInsertPicker(anchor: HTMLElement): void {
		openNotePicker(anchor, {
			openFiles: deps.openFiles?.() ?? [],
			allFiles: host.fs.listMarkdown(),
			onPick: (file) => insertIntoNote(file)
		});
	}

	/** « Recommencer » — désormais la FLÈCHE RETOUR de la page (demande Ahmed
	    2026-07-31) : sortir du quiz généré, c'est revenir au composer vide. */
	function restartGeneration(): void {
		resetGeneration();
		render(containerRef);
	}

	/** Remet la page « Générer » à neuf SANS la redessiner — pour l'appelant
	    qui va de toute façon quitter la vue (insertion dans une note). */
	function resetGeneration(): void {
		phase = "idle";
		signalerGeneration(false);
		generatedQuestions = [];
		generatedDraft = null;
		dropSentMessage();
		composerText = "";
		noteAttachments = [];
		// Les vignettes préparées dans le composer pendant la génération
		// disparaissent avec lui : leurs URL d'objet se libèrent ici, sinon
		// elles resteraient allouées jusqu'à la fermeture d'Obsidian.
		for (const img of images) URL.revokeObjectURL(img.url);
		images = [];
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
		ajouter(btn, "span", "qbd-sr-only", label);
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
			tip = ajouter(document.body, "div", "qbd-hover-tip");
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
			const row = ajouter(tip, "div", "qbd-hover-tip-row");
			ajouter(row, "span", "qbd-hover-tip-title", t("ai.composer.stop"));
			ajouter(row, "span", "qbd-hover-tip-esc", "Esc");
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
		const roots = settings().aiMentionExtraFolders || [];
		const { refs, unresolved, ambiguous, truncated } = await scanPromptPaths(roots, text);

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
			host.ui.notice(t("ai.notice.pathsAttached", {
				files: fresh.map(r => r.name).join(", ")
			}));
		}
		if (truncated) {
			host.ui.notice(t("ai.notice.pathsTooMany", { max: String(MAX_PROMPT_PATHS) }));
		}
		for (const a of ambiguous) {
			host.ui.notice(t("ai.notice.pathsAmbiguous", { file: a.text, count: String(a.count) }));
		}
		if (unresolved.length) {
			host.ui.notice(t("ai.notice.pathsUnresolved", { files: unresolved.join(", ") }));
		}
	}

	/** Une génération est-elle DÉJÀ partie ? Posé avant le moindre `await`. */
	let demarrage = false;

	async function startGeneration(container: HTMLElement | null): Promise<void> {
		/* VERROU d'abord, et de façon synchrone : `phase = "loading"` n'était
		   posé qu'après l'attente ci-dessous, et Entrée ou un second clic
		   pendant ce temps lançait une DEUXIÈME génération — qui capturait un
		   composer déjà vidé et écrasait `activeClient`, donc la première ne
		   pouvait même plus être annulée (revue codex 2026-07-31). C'est le
		   contraire de « le message est parti ». */
		if (demarrage || phase === "loading") return;
		demarrage = true;
		try {
			/* Les chemins écrits dans le prompt deviennent des pièces jointes
			   AVANT la capture : elles doivent partir avec la demande, et
			   apparaître dans la bulle « envoyé » — c'est là que l'utilisateur
			   voit désormais ce qui est parti, le composer étant vidé juste
			   après. */
			await attachPromptPaths();
		} finally {
			/* Rendu dès que la phase prend le relais : le verrou ne couvre que
			   la fenêtre entre le clic et `phase = "loading"`. */
			demarrage = false;
		}

		// Le composer se vide MAINTENANT, avant le premier rendu de la phase
		// « loading » : la demande passe en bulle et le champ redevient neuf.
		// Tout ce qui suit lit `msg`, jamais l'état du composer — qui n'est
		// plus la demande en vol dès cette ligne.
		const msg = takeComposerMessage();
		phase = "loading";
		signalerGeneration(true);
		errorMessage = "";
		render(container);

		/* Le client lit les réglages par le MÊME hôte que la page : celui qui
		   possède les réglages (le greffon, ou le cache de l'application). */
		const client = createAiClient(deps.settings);
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

			// La vue a-t-elle été fermée pendant l'encodage des images ? Lancer le
			// CLI maintenant ferait tourner un processus que plus personne
			// n'écoute, et sa réponse repeindrait un conteneur détaché.
			if (disposed) {
				document.removeEventListener("keydown", onEsc);
				activeClient = null;
				return;
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
			if (lastUsage && deps.usage) {
				try {
					await deps.usage.record({
						...lastUsage,
						at: Date.now(),
						questionCount: generatedQuestions.length
					});
					// La génération vient de consommer du forfait : relire tout de
					// suite garde le survol du bouton d'usage juste, sans attendre
					// que l'écran soit ouvert.
					lastPlan = await deps.usage.fetchPlan(lastUsage);
				} catch (e) {
					console.warn(LOG_PREFIX, "usage non enregistré:", e);
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
				signalerGeneration(false);
				render(container);
				return;
			}
			errorMessage = e.message || t("ai.error.checkSettings");
			generatedQuestions = [];
		}

		document.removeEventListener("keydown", onEsc);
		activeClient = null;
		signalerGeneration(false);
		let navigated = false;
		if (generatedQuestions.length > 0) {
			// Nouvelle génération → l'éditeur embarqué repart des questions
			// fraîches (renderResult le monte pleine page).
			generationId++;
			generatedDraft = null;
			phase = "result";
			// Le succès visible est directement la page de la note enregistrée :
			// elle affiche déjà « Lancer », sans clic intermédiaire sur Enregistrer.
			navigated = await saveGeneratedQuiz();
		} else {
			phase = "error";
		}
		if (!navigated) render(container);
	}

	/* Insère le quiz dans la note choisie via le picker (« Insérer dans une
	   note »). L'état ÉDITÉ de l'éditeur embarqué prime sur les questions
	   générées brutes (les retouches faites dans l'éditeur sont insérées). */
	async function insertIntoNote(file: HostFile): Promise<void> {
		if (!file) return;
		let quizJson: string;
		// L'état ÉDITÉ prime sur les questions générées brutes : les retouches
		// faites dans la page (réponses, ordre, mode) sont ce qu'on insère.
		const draft = generatedDraft && generatedDraft.genId === generationId ? generatedDraft.draft : null;
		if (draft && draft.questions.length) {
			quizJson = exportAll(draft.questions, draft.examOptions);
		} else if (generatedQuestions.length) {
			quizJson = JSON5.stringify(generatedQuestions, null, 2);
		} else {
			return;
		}

		try {
			const quizBlock = "```quiz-blocks\n" + quizJson + "\n```";
			/* `fs.process` et non `read` + `write` : entre les deux, une
			   modification faite ailleurs (éditeur markdown, synchro) était
			   écrasée — et l'insertion annonçait quand même « Quiz inséré ».
			   Ici la lecture et l'écriture sont indivisibles (voir le contrat),
			   et le contenu ajouté l'est à ce qui EST dans le fichier, pas à ce
			   qu'on avait lu. La détection d'un bloc existant se fait dans le même
			   passage : la tester avant laissait la place à un bloc arrivé
			   entre-temps. */
			let dejaUnBloc = false;
			await host.fs.process(file.path, (content) => {
				// Le rappel peut être rejoué : repartir de zéro à chaque essai.
				dejaUnBloc = content.includes("```quiz-blocks");
				if (dejaUnBloc) return content;
				return content + "\n\n" + quizBlock;
			});
			if (dejaUnBloc) {
				host.ui.notice(t("ai.notice.blockExists", { name: file.basename }));
				return;
			}
			host.ui.notice(t("ai.notice.quizInserted", { name: file.basename }));

			/* Le quiz a maintenant une NOTE : on va sur sa page, celle qui écrit
			   dans le fichier. Rester sur la page « Générer » laisserait deux
			   copies du même quiz — une en mémoire qui ne se sauvegarde nulle
			   part, une sur le disque — et la première retouche irait dans le
			   vide. Le scan du seul fichier suffit à obtenir son entrée : le
			   scan de vault complet arriverait trop tard. */
			const hostFile = host.fs.getFile(file.path);
			if (hostFile) await deps.scanner.scanFile(hostFile);
			const entry = deps.scanner.getQuiz(file.path);
			if (entry) {
				resetGeneration();
				deps.navigate("detail", { quiz: entry });
			}
		} catch (err) {
			host.ui.notice(t("ai.notice.insertFailed"));
		}
	}

	function dispose(): void {
		// Une génération en vol survivrait à la vue : son CLI continuerait de
		// tourner, son écoute Escape resterait posée sur le document, et sa
		// complétion irait repeindre un conteneur détaché.
		disposed = true;
		activeClient?.abort();
		activeClient = null;
		if (ollamaPoll) { window.clearInterval(ollamaPoll); ollamaPoll = null; }
		closeAllSelects();
		if (composerResizeObserver) { composerResizeObserver.disconnect(); composerResizeObserver = null; }
		if (__focusRecheck) { window.removeEventListener("focus", __focusRecheck); __focusRecheck = null; }
		// `void` : après un échec d'écriture, ce brouillon n'a toujours pas de
		// note à autosauvegarder ; la promesse rendue est déjà résolue.
		signalerGeneration(false);
		void resultPage?.dispose();
		resultPage = null;
		generatedDraft = null;
		dropSentMessage();
		for (const img of images) URL.revokeObjectURL(img.url);
		images = [];
		containerRef = null;
	}

	return { render, openAddFiles, openAddNotes, dispose };
}
