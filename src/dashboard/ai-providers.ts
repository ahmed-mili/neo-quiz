import { Platform, requestUrl } from "obsidian";
import { t, currentLang } from "../i18n";
import type { Lang } from "../i18n";
// Le forfait Claude est lu par ai-usage (trousseau du CLI) : une seule source
// pour les deux modules. ai-usage n'importe rien d'ici — pas de cycle.
import { readClaudePlan } from "./ai-usage";

/* ══════════════════════════════════════════════════════════
   AI PROVIDERS — Registry central
   Providers, logos de marque (Simple Icons, CC0), modèles
   par défaut et détections de statut. Source unique partagée
   par ai.js (dashboard), ai-client.js et plugin.js (settings).

   I18N — pourquoi des GETTERS dans les tables ci-dessous
   (PROVIDERS.sub, hint/desc/badge des modèles, sub des efforts) :
   ces constantes sont évaluées au CHARGEMENT du module. Un `t()` posé
   directement dedans figerait le libellé dans la langue du démarrage, et
   changer de langue n'aurait plus aucun effet. Un getter traduit à
   l'ACCÈS, donc au rendu — et, contrairement à une fonction, il ne
   change AUCUN appelant (`p.sub` / `m.hint` continuent de marcher tels
   quels, y compris dans plugin.ts et les spreads `{ ...m }`).
══════════════════════════════════════════════════════════ */

/* ── Types partagés ── */

export interface Provider {
	id: string;
	name: string;
	sub: string;
	logo: string;
	desktopOnly: boolean;
	defaultModel: string;
	defaultEffort: string;
}

/** Niveau d'effort (compatible avec EffortOption d'ui-select). */
export interface EffortDef {
	value: string;
	label: string;
	isDefault?: boolean;
	sub?: string;
	accent?: boolean;
}

/** Modèle Claude/Codex (compatible avec ModelOption d'ui-select). */
export interface ModelDef {
	value: string;
	label: string;
	hint?: string;
	desc?: string;
	badge?: string;
	efforts?: string[];
	defaultEffort?: string;
	fast?: boolean;
}

/** Entrée de catalogue Ollama (tag + libellé). */
export interface OllamaCatalogEntry {
	value: string;
	label: string;
}

/** Métadonnées résolues d'un modèle Ollama. */
export interface OllamaModelMeta {
	value: string;
	label: string;
	cloud: boolean;
	thinking: boolean;
}

/** Modèle local détecté par /api/tags. */
export interface OllamaDetectedModel {
	name: string;
	size?: number;
	capabilities?: string[];
}

export type ClaudeCodeStatus = { ok: true; version: string } | { ok: false; reason: string };
export type CodexStatus = ClaudeCodeStatus;
export type OllamaStatus =
	| { ok: true; models: OllamaDetectedModel[]; version?: string }
	| { ok: false; reason: string };
export interface OllamaInstalledStatus {
	installed: boolean;
}

/* ── Logos de marque (Simple Icons, viewBox 24×24, fill) ── */
const BRAND_LOGOS: Record<string, string> = {
	claude: '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>',
	ollama: '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M16.361 10.26a.894.894 0 0 0-.558.47l-.072.148.001.207c0 .193.004.217.059.353.076.193.152.312.291.448.24.238.51.3.872.205a.86.86 0 0 0 .517-.436.752.752 0 0 0 .08-.498c-.064-.453-.33-.782-.724-.897a1.06 1.06 0 0 0-.466 0zm-9.203.005c-.305.096-.533.32-.65.639a1.187 1.187 0 0 0-.06.52c.057.309.31.59.598.667.362.095.632.033.872-.205.14-.136.215-.255.291-.448.055-.136.059-.16.059-.353l.001-.207-.072-.148a.894.894 0 0 0-.565-.472 1.02 1.02 0 0 0-.474.007Zm4.184 2c-.131.071-.223.25-.195.383.031.143.157.288.353.407.105.063.112.072.117.136.004.038-.01.146-.029.243-.02.094-.036.194-.036.222.002.074.07.195.143.253.064.052.076.054.255.059.164.005.198.001.264-.03.169-.082.212-.234.15-.525-.052-.243-.042-.28.087-.355.137-.08.281-.219.324-.314a.365.365 0 0 0-.175-.48.394.394 0 0 0-.181-.033c-.126 0-.207.03-.355.124l-.085.053-.053-.032c-.219-.13-.259-.145-.391-.143a.396.396 0 0 0-.193.032zm.39-2.195c-.373.036-.475.05-.654.086-.291.06-.68.195-.951.328-.94.46-1.589 1.226-1.787 2.114-.04.176-.045.234-.045.53 0 .294.005.357.043.524.264 1.16 1.332 2.017 2.714 2.173.3.033 1.596.033 1.896 0 1.11-.125 2.064-.727 2.493-1.571.114-.226.169-.372.22-.602.039-.167.044-.23.044-.523 0-.297-.005-.355-.045-.531-.288-1.29-1.539-2.304-3.072-2.497a6.873 6.873 0 0 0-.855-.031zm.645.937a3.283 3.283 0 0 1 1.44.514c.223.148.537.458.671.662.166.251.26.508.303.82.02.143.01.251-.043.482-.08.345-.332.705-.672.957a3.115 3.115 0 0 1-.689.348c-.382.122-.632.144-1.525.138-.582-.006-.686-.01-.853-.042-.57-.107-1.022-.334-1.35-.68-.264-.28-.385-.535-.45-.946-.03-.192.025-.509.137-.776.136-.326.488-.73.836-.963.403-.269.934-.46 1.422-.512.187-.02.586-.02.773-.002zm-5.503-11a1.653 1.653 0 0 0-.683.298C5.617.74 5.173 1.666 4.985 2.819c-.07.436-.119 1.04-.119 1.503 0 .544.064 1.24.155 1.721.02.107.031.202.023.208a8.12 8.12 0 0 1-.187.152 5.324 5.324 0 0 0-.949 1.02 5.49 5.49 0 0 0-.94 2.339 6.625 6.625 0 0 0-.023 1.357c.091.78.325 1.438.727 2.04l.13.195-.037.064c-.269.452-.498 1.105-.605 1.732-.084.496-.095.629-.095 1.294 0 .67.009.803.088 1.266.095.555.288 1.143.503 1.534.071.128.243.393.264.407.007.003-.014.067-.046.141a7.405 7.405 0 0 0-.548 1.873c-.062.417-.071.552-.071.991 0 .56.031.832.148 1.279L3.42 24h1.478l-.05-.091c-.297-.552-.325-1.575-.068-2.597.117-.472.25-.819.498-1.296l.148-.29v-.177c0-.165-.003-.184-.057-.293a.915.915 0 0 0-.194-.25 1.74 1.74 0 0 1-.385-.543c-.424-.92-.506-2.286-.208-3.451.124-.486.329-.918.544-1.154a.787.787 0 0 0 .223-.531c0-.195-.07-.355-.224-.522a3.136 3.136 0 0 1-.817-1.729c-.14-.96.114-2.005.69-2.834.563-.814 1.353-1.336 2.237-1.475.199-.033.57-.028.776.01.226.04.367.028.512-.041.179-.085.268-.19.374-.431.093-.215.165-.333.36-.576.234-.29.46-.489.822-.729.413-.27.884-.467 1.352-.561.17-.035.25-.04.569-.04.319 0 .398.005.569.04a4.07 4.07 0 0 1 1.914.997c.117.109.398.457.488.602.034.057.095.177.132.267.105.241.195.346.374.43.14.068.286.082.503.045.343-.058.607-.053.943.016 1.144.23 2.14 1.173 2.581 2.437.385 1.108.276 2.267-.296 3.153-.097.15-.193.27-.333.419-.301.322-.301.722-.001 1.053.493.539.801 1.866.708 3.036-.062.772-.26 1.463-.533 1.854a2.096 2.096 0 0 1-.224.258.916.916 0 0 0-.194.25c-.054.109-.057.128-.057.293v.178l.148.29c.248.476.38.823.498 1.295.253 1.008.231 2.01-.059 2.581a.845.845 0 0 0-.044.098c0 .006.329.009.732.009h.73l.02-.074.036-.134c.019-.076.057-.3.088-.516.029-.217.029-1.016 0-1.258-.11-.875-.295-1.57-.597-2.226-.032-.074-.053-.138-.046-.141.008-.005.057-.074.108-.152.376-.569.607-1.284.724-2.228.031-.26.031-1.378 0-1.628-.083-.645-.182-1.082-.348-1.525a6.083 6.083 0 0 0-.329-.7l-.038-.064.131-.194c.402-.604.636-1.262.727-2.04a6.625 6.625 0 0 0-.024-1.358 5.512 5.512 0 0 0-.939-2.339 5.325 5.325 0 0 0-.95-1.02 8.097 8.097 0 0 1-.186-.152.692.692 0 0 1 .023-.208c.208-1.087.201-2.443-.017-3.503-.19-.924-.535-1.658-.98-2.082-.354-.338-.716-.482-1.15-.455-.996.059-1.8 1.205-2.116 3.01a6.805 6.805 0 0 0-.097.726c0 .036-.007.066-.015.066a.96.96 0 0 1-.149-.078A4.857 4.857 0 0 0 12 3.03c-.832 0-1.687.243-2.456.698a.958.958 0 0 1-.148.078c-.008 0-.015-.03-.015-.066a6.71 6.71 0 0 0-.097-.725C8.997 1.392 8.337.319 7.46.048a2.096 2.096 0 0 0-.585-.041Zm.293 1.402c.248.197.523.759.682 1.388.03.113.06.244.069.292.007.047.026.152.041.233.067.365.098.76.102 1.24l.002.475-.12.175-.118.178h-.278c-.324 0-.646.041-.954.124l-.238.06c-.033.007-.038-.003-.057-.144a8.438 8.438 0 0 1 .016-2.323c.124-.788.413-1.501.696-1.711.067-.05.079-.049.157.013zm9.825-.012c.17.126.358.46.498.888.28.854.36 2.028.212 3.145-.019.14-.024.151-.057.144l-.238-.06a3.693 3.693 0 0 0-.954-.124h-.278l-.119-.178-.119-.175.002-.474c.004-.669.066-1.19.214-1.772.157-.623.434-1.185.68-1.382.078-.062.09-.063.159-.012z"/></svg>',
	openai: '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5962 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>'
};

/* Injecte le logo de marque inline dans un élément. */
export function setBrandLogo(el: HTMLElement, logoKey: string): void {
	if (BRAND_LOGOS[logoKey]) el.innerHTML = BRAND_LOGOS[logoKey];
}

/* ── Registry des providers ── */
export const PROVIDERS: Provider[] = [
	{
		id: "claude-code",
		name: "Claude",
		get sub() { return t("ai.provider.claudeSub"); },
		logo: "claude",
		desktopOnly: true,
		defaultModel: "opus",
		defaultEffort: "high"
	},
	{
		id: "codex",
		name: "ChatGPT",
		// « Codex CLI » explicite : l'application de bureau Codex ne
		// fournit PAS la commande « codex » — la confusion fait installer
		// le mauvais outil (vécu Ahmed 2026-07-12).
		get sub() { return t("ai.provider.codexSub"); },
		logo: "openai",
		desktopOnly: true,
		defaultModel: "gpt-5.6-terra",
		defaultEffort: "medium"
	},
	{
		id: "ollama",
		name: "Ollama",
		get sub() { return t("ai.provider.ollamaSub"); },
		logo: "ollama",
		desktopOnly: false,
		defaultModel: "glm-5.3:cloud",
		defaultEffort: "high"
	}
];

export function getProvider(id: string): Provider {
	return PROVIDERS.find(p => p.id === id) || PROVIDERS[0];
}

/* ── Modèles par provider ── */
/* Mêmes noms que le sélecteur /model de Claude Code ; les values sont les
   alias CLI, qui désignent « le DERNIER modèle » de leur famille (`claude
   --help` : « Provide an alias for the latest model (e.g. 'fable', 'opus',
   or 'sonnet') »). Un alias ne change donc jamais, mais le modèle derrière
   lui — et son numéro de version — change à chaque sortie : ces libellés ne
   sont qu'un DERNIER RECOURS, périmé par construction (relevé le 2026-07-30).
   Le libellé réellement affiché est appris de ce que le CLI a servi, cf.
   learnedClaudeLabels() plus bas. */
export const CLAUDE_CODE_MODELS: ModelDef[] = [
	// Pas de `badge` ici : l'accès à Fable dépend du FORFAIT (inclus sur Max,
	// crédits d'usage sur Pro) — getClaudeModels() le pose au rendu.
	{ value: "fable", label: "Fable 5", get hint() { return t("ai.modelHint.mostPowerful"); }, get desc() { return t("ai.modelDesc.fable"); } },
	{ value: "opus", label: "Opus 5", get hint() { return t("ai.modelHint.recommended"); }, get desc() { return t("ai.modelDesc.opus"); } },
	{ value: "sonnet", label: "Sonnet 5", get hint() { return t("ai.modelHint.everyday"); }, get desc() { return t("ai.modelDesc.sonnet"); } },
	{ value: "haiku", label: "Haiku 4.5", get hint() { return t("ai.modelHint.fastest"); }, get desc() { return t("ai.modelDesc.haiku"); } }
];

/* Niveaux d'effort (façon sélecteur claude.ai). Décoratif/persisté
   pour l'instant : le CLI `claude -p` n'expose pas de flag d'effort
   vérifié — voir ai-client.js. Défaut : max. */
// Niveaux d'effort de Claude Code (picker /effort), du plus faible au plus
// élevé — l'ordre du tableau = ordre d'affichage haut→bas, donc le plus
// élevé (ultracode) tout en bas. ultracode a une couleur dédiée (violet).
export const CLAUDE_EFFORTS: EffortDef[] = [
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium" },
	{ value: "high", label: "high", isDefault: true },
	{ value: "xhigh", label: "xhigh" },
	{ value: "max", label: "max" },
	{ value: "ultracode", label: "ultracode", get sub() { return t("ai.effort.ultracodeSub"); }, accent: true }
];

/* ── Modèles Codex (ChatGPT) ──
   Liste DYNAMIQUE : lue depuis ~/.codex/models_cache.json, que le CLI Codex
   rafraîchit lui-même depuis le compte OpenAI (visibility "list" = picker
   /model, priority = ordre du picker, "hide" exclut codex-auto-review).
   Le tableau ci-dessous n'est qu'un repli embarqué (cache absent/illisible,
   mobile) et la source des labels/hints/descriptions FR curés. */
/* `efforts`/`defaultEffort` = supported_reasoning_levels/default_reasoning_level
   du cache Codex (répliqués ici pour que le repli hors-ligne ait le même
   comportement de clamp que la liste dynamique). `fast` = le modèle expose le
   service tier « priority » (Fast, 1.5x speed) — tous sauf gpt-5.4-mini. */
export const CODEX_FALLBACK_MODELS: ModelDef[] = [
	{ value: "gpt-5.6-sol", label: "GPT-5.6 Sol", get hint() { return t("ai.modelHint.mostPowerful"); }, get desc() { return t("ai.modelDesc.codexSol"); }, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "low", fast: true },
	{ value: "gpt-5.6-terra", label: "GPT-5.6 Terra", get hint() { return t("ai.modelHint.recommended"); }, get desc() { return t("ai.modelDesc.codexTerra"); }, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], defaultEffort: "medium", fast: true },
	{ value: "gpt-5.6-luna", label: "GPT-5.6 Luna", get hint() { return t("ai.modelHint.fast"); }, get desc() { return t("ai.modelDesc.codexLuna"); }, efforts: ["low", "medium", "high", "xhigh", "max"], defaultEffort: "medium", fast: true },
	{ value: "gpt-5.5", label: "GPT-5.5", get hint() { return t("ai.modelHint.frontier"); }, get desc() { return t("ai.modelDesc.codex55"); }, efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "medium", fast: true },
	{ value: "gpt-5.4", label: "GPT-5.4", get hint() { return t("ai.modelHint.solid"); }, get desc() { return t("ai.modelDesc.codex54"); }, efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "medium", fast: true },
	{ value: "gpt-5.4-mini", label: "GPT-5.4 Mini", get hint() { return t("ai.modelHint.light"); }, get desc() { return t("ai.modelDesc.codex54mini"); }, efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "medium", fast: false }
];

/* Traductions FR des descriptions du cache Codex. Le cache est ANGLAIS : en
   anglais on affiche donc la description d'origine telle quelle (aucune table
   à consulter), et cette table ne sert qu'à la langue française. Un nouveau
   modèle dont la description est inconnue garde sa description d'origine. */
const CODEX_DESC_FR: Record<string, string> = {
	"Latest frontier agentic coding model.": "Dernier modèle frontière pour le code agentique",
	"Balanced agentic coding model for everyday work.": "Équilibré pour le travail quotidien",
	"Fast and affordable agentic coding model.": "Rapide et économique",
	"Frontier model for complex coding, research, and real-world work.": "Pour le code complexe et la recherche",
	"Strong model for everyday coding.": "Solide pour le code au quotidien",
	"Small, fast, and cost-efficient model for simpler coding tasks.": "Léger et rapide pour les tâches simples"
};

/* Forme (partielle) d'une entrée de ~/.codex/models_cache.json. */
interface CodexCacheModel {
	slug?: string;
	visibility?: string;
	priority?: number;
	display_name?: string;
	description?: string;
	supported_reasoning_levels?: Array<{ effort?: string } | null>;
	default_reasoning_level?: string;
	additional_speed_tiers?: string[];
	service_tiers?: Array<{ id?: string } | null>;
}
interface CodexCacheFile {
	models?: CodexCacheModel[];
}

/* Modèles Codex réels : ~/.codex/models_cache.json (ou $CODEX_HOME), relu
   uniquement quand le fichier change (mtime) — donc toujours à jour après un
   « codex update » ou l'arrivée d'un nouveau modèle, sans re-parse inutile.
   Les slugs connus gardent leur entrée FR curée ; les inconnus reçoivent un
   label dérivé du display_name (« GPT-5.7-Nova » → « GPT-5.7 Nova ») et la
   description du cache (traduite si connue). Ordre = priority du cache. */
/* Le cache porte la LANGUE en plus du mtime : les libellés sont recopiés en
   dur dans `models` (Object.assign fige la valeur des getters), donc un
   changement de langue doit invalider le cache — sans ça, la liste Codex
   resterait dans la langue du dernier parse. */
let codexModelsCache: { mtimeMs: number; lang: Lang; models: ModelDef[] } | null = null;

export function getCodexModels(): ModelDef[] {
	const lang = currentLang();
	try {
		const fs = require("fs") as typeof import("fs");
		const os = require("os") as typeof import("os");
		const path = require("path") as typeof import("path");
		const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "models_cache.json");
		const mtimeMs = fs.statSync(file).mtimeMs;
		if (codexModelsCache && codexModelsCache.mtimeMs === mtimeMs && codexModelsCache.lang === lang) {
			return codexModelsCache.models;
		}
		const data = JSON.parse(fs.readFileSync(file, "utf8")) as CodexCacheFile;
		const models: ModelDef[] = (data.models || [])
			.filter(m => m && m.slug && m.visibility === "list")
			.sort((a, b) => (a.priority || 0) - (b.priority || 0))
			.map((m): ModelDef => {
				const curated = CODEX_FALLBACK_MODELS.find(f => f.value === m.slug);
				const base: ModelDef = curated || {
					value: m.slug as string,
					label: String(m.display_name || m.slug).replace(/(\d)-(?=[A-Za-z])/g, "$1 "),
					// Le cache Codex est en anglais : en anglais, la description
					// d'origine est déjà la bonne — la table FR ne sert qu'au français.
					desc: (lang === "fr" ? CODEX_DESC_FR[m.description || ""] : "") || m.description || ""
				};
				// Efforts supportés + effort par défaut + tier Fast : toujours ceux
				// du cache (source de vérité, prime sur le repli curé — un modèle
				// peut gagner/perdre un niveau côté OpenAI sans mise à jour du plugin).
				const efforts = (m.supported_reasoning_levels || [])
					.map(l => l && l.effort)
					.filter((e): e is string => !!e);
				const fast = (m.additional_speed_tiers || []).includes("fast")
					|| (m.service_tiers || []).some(t => t !== null && t !== undefined && t.id === "priority");
				return Object.assign({}, base,
					efforts.length ? { efforts } : {},
					m.default_reasoning_level ? { defaultEffort: m.default_reasoning_level } : {},
					{ fast }) as ModelDef;
			});
		if (!models.length) return CODEX_FALLBACK_MODELS;
		codexModelsCache = { mtimeMs, lang, models };
		return models;
	} catch (e) {
		// mobile (pas de fs), cache absent ou JSON invalide → repli embarqué
		return CODEX_FALLBACK_MODELS;
	}
}

/* Modèle Codex effectif : si le modèle persisté n'existe plus dans le cache
   (slug retiré, bascule de provider), retombe sur le défaut du provider,
   sinon sur le premier modèle du picker (priority 1). */
export function resolveCodexModel(value?: string): string {
	const models = getCodexModels();
	if (models.some(m => m.value === value)) return value as string;
	const def = getProvider("codex").defaultModel;
	return models.some(m => m.value === def) ? def : models[0].value;
}

/* Niveaux de reasoning effort de Codex (`model_reasoning_effort`), du plus
   faible au plus élevé — xhigh tout en bas. Contrairement à Claude Code, cet
   effort est RÉEL : passé au CLI via `-c model_reasoning_effort=…`. Défaut
   Codex : medium. */
export const CODEX_EFFORTS: EffortDef[] = [
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium", isDefault: true },
	{ value: "high", label: "high" },
	{ value: "xhigh", label: "xhigh" },
	{ value: "max", label: "max" },
	{ value: "ultra", label: "ultra", get sub() { return t("ai.effort.ultraSub"); }, accent: true }
];

/* Niveaux d'effort d'Ollama. Effort RÉEL : passé à l'API /api/chat via le
   champ `think`, qui accepte exactement ces 4 niveaux (doc API Ollama : « Can
   be a boolean or a thinking level "low"/"medium"/"high"/"max" »). Ne
   s'applique qu'aux modèles à capability « thinking » (sinon la ligne Effort
   est masquée). Défaut : medium. */
export const OLLAMA_EFFORTS: EffortDef[] = [
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium" },
	{ value: "high", label: "high", isDefault: true },
	{ value: "max", label: "max" }
];

/* Tableau d'efforts d'un provider (Claude Code, Codex ou Ollama).
   Codex : si `modelValue` est fourni, filtré aux niveaux réellement supportés
   par CE modèle (supported_reasoning_levels du cache — gpt-5.5 s'arrête à
   xhigh, luna à max, sol/terra vont jusqu'à ultra). */
export function getEfforts(providerId: string, modelValue?: string): EffortDef[] {
	if (providerId === "codex") {
		if (modelValue) {
			const m = getCodexModels().find(x => x.value === modelValue);
			if (m && Array.isArray(m.efforts) && m.efforts.length) {
				const allowed = m.efforts;
				const filtered = CODEX_EFFORTS.filter(e => allowed.includes(e.value));
				if (filtered.length) return filtered;
			}
		}
		return CODEX_EFFORTS;
	}
	if (providerId === "ollama") return OLLAMA_EFFORTS;
	return CLAUDE_EFFORTS;
}

/* Effort par défaut d'un provider (celui marqué isDefault, sinon le premier).
   Codex + modèle : le default_reasoning_level du cache prime (sol → low). */
export function getDefaultEffort(providerId: string, modelValue?: string): string {
	const efforts = getEfforts(providerId, modelValue);
	if (providerId === "codex" && modelValue) {
		const m = getCodexModels().find(x => x.value === modelValue);
		if (m && m.defaultEffort && efforts.some(e => e.value === m.defaultEffort)) return m.defaultEffort;
	}
	const def = efforts.find(e => e.isDefault);
	return (def || efforts[0])?.value ?? "";
}

/* Renvoie value si c'est un effort valide pour le provider (et le modèle le
   cas échéant). Sinon : niveau connu du provider mais pas de CE modèle
   (ex. ultra sur gpt-5.5) → clamp au niveau supporté le plus proche EN
   DESSOUS — le réglage persisté n'est pas réécrit, revenir à un modèle qui
   le supporte le restaure. Valeur inconnue → défaut. */
export function resolveEffort(providerId: string, value?: string, modelValue?: string): string {
	const efforts = getEfforts(providerId, modelValue);
	if (efforts.some(e => e.value === value)) return value as string;
	const all = getEfforts(providerId);
	const idx = all.findIndex(e => e.value === value);
	for (let i = idx - 1; i >= 0; i--) {
		if (efforts.some(e => e.value === all[i].value)) return all[i].value;
	}
	return getDefaultEffort(providerId, modelValue);
}

export function getEffortLabel(value: string | undefined, providerId: string): string {
	const efforts = getEfforts(providerId);
	const e = efforts.find(x => x.value === value);
	if (e) return e.label;
	const def = efforts.find(x => x.isDefault) || efforts[0];
	return def ? def.label : "";
}

/* ── Fable 5 : disponibilité et MODE D'ACCÈS, lus des sources qui les tiennent ──
   Fable 5 n'est PLUS une promo datée. Vérifié le 2026-08-29 sur
   support.claude.com/en/articles/15424964 (« Claude Fable 5 on your plan »,
   modifié le 2026-07-20) : depuis le 2026-07-20, Fable 5 fait partie STANDARD
   des forfaits Max et des sièges premium Team/Enterprise (il puise dans les
   limites hebdomadaires, plus vite que les autres modèles) ; sur Pro et les
   sièges standard, il tourne aux CRÉDITS D'USAGE dès le premier message.
   Le plugin ne date donc plus rien : il lit (1) si le CLI propose Fable
   (`additionalModelOptionsCache`, ex. { value: "claude-fable-5[1m]", … }),
   (2) le forfait local (cf. fableAccessBadge), et en déduit le libellé.

   CE QUI A ÉTÉ RETIRÉ, ET POURQUOI : la date de fin de promo était extraite de
   `cachedGrowthBookFeatures.tengu_startup_announcements` (« Extended through
   July 19 »). Le CLI ne publie plus cette annonce — la promo est devenue
   permanente — donc le badge retombait en silence sur un « Inclus » nu, faux
   pour un forfait Pro. Les promos VIVANTES du CLI vivent maintenant dans
   `tengu_rate_limit_promo_notices` ([{ bar, text, variant }], ex. « +50% weekly
   limits promo through Aug 31 ») : elles ne parlent pas de Fable mais des
   limites hebdomadaires, et sont affichées TELLES QUELLES sur la jauge qu'elles
   désignent (cf. usage-modal) — datées par leur émetteur, jamais par nous.

   Lecture desktop-only (fs), cache TTL pour ne pas relire ~/.claude.json à
   chaque ouverture de menu. Fallback prudent si illisible/absent : Fable masqué,
   aucune note promo. */

/** Note promo publiée par le CLI Claude Code, rattachée à UNE jauge d'usage.
    `bar` est la clé d'API de la fenêtre (« five_hour », « seven_day »…), pas
    un libellé. Le texte est affiché tel quel, jamais traduit ni reformulé :
    c'est une annonce commerciale qui porte sa propre date de péremption. */
export interface ClaudePromoNotice { bar: string; text: string }

/** Ce que ~/.claude.json apprend en UNE lecture : Fable proposé ?, le nom des
    modèles réellement servis, et les notes promo en cours. Même fichier, même
    TTL — une seule lecture pour les trois usages. */
type ClaudeCliInfo = {
	fableOffered: boolean;
	labels: Record<string, string>;
	promos: ClaudePromoNotice[];
};
let claudeCliCache: { at: number; info: ClaudeCliInfo } | null = null;
const CLAUDE_CLI_CACHE_TTL = 60000;

/* Repli neuf à chaque appel : l'objet est stocké dans le cache TTL et rendu
   aux appelants, une constante partagée serait modifiable de l'extérieur. */
function emptyCliInfo(): ClaudeCliInfo {
	return { fableOffered: false, labels: {}, promos: [] };
}

/* Une entrée `additionalModelOptionsCache` désigne-t-elle Fable ? */
function cacheEntryIsFable(entry: unknown): boolean {
	if (!entry || typeof entry !== "object") return false;
	const value = (entry as { value?: unknown }).value;
	return typeof value === "string" && value.toLowerCase().includes("fable");
}

/* Notes promo du CLI → on ne garde que ce qu'on affiche (la jauge visée et le
   texte), et seulement si les deux sont des chaînes utiles. Forme inattendue :
   aucune note, jamais d'exception. */
function promoNoticesFrom(raw: unknown): ClaudePromoNotice[] {
	if (!Array.isArray(raw)) return [];
	const out: ClaudePromoNotice[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const { bar, text } = entry as { bar?: unknown; text?: unknown };
		if (typeof bar === "string" && bar && typeof text === "string" && text.trim()) {
			out.push({ bar, text: text.trim() });
		}
	}
	return out;
}

/* Badge d'accès à Fable, déduit du FORFAIT local (~/.claude/.credentials.json,
   déjà lu par ai-usage — on ne rouvre pas une seconde source). Max → inclus ;
   Pro → crédits d'usage. Team/Enterprise dépendent du SIÈGE (premium ou
   standard), que le trousseau ne dit pas : aucun badge plutôt qu'un badge faux. */
function fableAccessBadge(): string | undefined {
	const plan = readClaudePlan()?.name.toLowerCase();
	if (plan === "max") return t("ai.badge.included");
	if (plan === "pro") return t("ai.badge.usageCredits");
	return undefined;
}

/* ── Libellés de modèles APPRIS (« Opus 5 », pas « Opus 4.8 ») ──
   Un alias (`opus`) pointe toujours vers le dernier modèle de sa famille : le
   NUMÉRO affiché à côté périme donc tout seul, sans que rien ne change dans le
   plugin (vécu le 2026-07-30 : Opus 5 sorti, menu bloqué sur « Opus 4.8 »).
   Le CLI, lui, enregistre dans ~/.claude.json ce qu'il a RÉELLEMENT consommé
   (`projects[*].lastModelUsage`, clés « claude-opus-5 », « claude-haiku-4-5-
   20251001 »…). On en déduit, par famille, la version la plus haute déjà vue —
   une donnée mesurée, jamais devinée. Un modèle jamais utilisé garde le
   libellé de repli, qui reste le seul endroit à corriger à la main. */

/** Version d'un identifiant de modèle, en segments comparables :
    « claude-opus-4-7 » → [4, 7] ; « claude-haiku-4-5-20251001 » → [4, 5]
    (le suffixe de date, 8 chiffres, n'est pas un numéro de version). */
function modelVersionParts(segments: string[]): number[] {
	return segments
		.filter(s => /^\d+$/.test(s) && s.length < 8)
		.map(s => parseInt(s, 10));
}

/** a est-il une version STRICTEMENT plus récente que b ? ([5] > [4, 7]). */
function isNewerVersion(a: number[], b: number[]): boolean {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0, y = b[i] ?? 0;
		if (x !== y) return x > y;
	}
	return false;
}

/** « claude-opus-5[1m] » → { family: "opus", version: [5] }. null pour tout ce
    qui n'est pas un modèle Claude first-party (Ollama, alias inconnus). */
function parseClaudeModelId(id: string): { family: string; version: number[] } | null {
	// Le suffixe de contexte étendu ([1m]) qualifie la fenêtre, pas le modèle.
	const bare = id.replace(/\[[^\]]*\]\s*$/, "").trim().toLowerCase();
	const segments = bare.split("-");
	if (segments.shift() !== "claude") return null;
	const family = segments.shift();
	if (!family || !/^[a-z]+$/.test(family)) return null;
	const version = modelVersionParts(segments);
	return version.length ? { family, version } : null;
}

/** Libellés par famille, déduits des modèles que le CLI a effectivement servis
    (« opus » → « Opus 5 »). Table vide si le fichier ne dit rien : on n'invente
    aucun numéro. */
function labelsFromModelUsage(projects: unknown): Record<string, string> {
	if (!projects || typeof projects !== "object") return {};
	const best = new Map<string, number[]>();
	for (const project of Object.values(projects as Record<string, unknown>)) {
		const usage = (project as { lastModelUsage?: unknown } | null)?.lastModelUsage;
		if (!usage || typeof usage !== "object") continue;
		for (const id of Object.keys(usage as Record<string, unknown>)) {
			const parsed = parseClaudeModelId(id);
			if (!parsed) continue;
			const known = best.get(parsed.family);
			if (!known || isNewerVersion(parsed.version, known)) best.set(parsed.family, parsed.version);
		}
	}
	const labels: Record<string, string> = {};
	for (const [family, version] of best) {
		labels[family] = family.charAt(0).toUpperCase() + family.slice(1) + " " + version.join(".");
	}
	return labels;
}

/* Lit ~/.claude.json (cache TTL, desktop) : Fable proposé ? + libellés de
   modèles appris + notes promo en cours. UNE lecture pour les trois usages. */
function readClaudeCliInfo(): ClaudeCliInfo {
	if (!Platform.isDesktopApp) return emptyCliInfo();
	if (claudeCliCache && Date.now() - claudeCliCache.at < CLAUDE_CLI_CACHE_TTL) {
		return claudeCliCache.info;
	}
	let info = emptyCliInfo();
	try {
		const fs = require("fs") as typeof import("fs");
		const os = require("os") as typeof import("os");
		const path = require("path") as typeof import("path");
		const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8")) as {
			additionalModelOptionsCache?: unknown;
			cachedGrowthBookFeatures?: { tengu_rate_limit_promo_notices?: unknown };
			projects?: unknown;
		};
		const cache = cfg.additionalModelOptionsCache;
		info = {
			fableOffered: Array.isArray(cache) ? cache.some(cacheEntryIsFable) : cacheEntryIsFable(cache),
			labels: labelsFromModelUsage(cfg.projects),
			promos: promoNoticesFrom(cfg.cachedGrowthBookFeatures?.tengu_rate_limit_promo_notices)
		};
	} catch {
		info = emptyCliInfo(); // absent/illisible → repli
	}
	claudeCliCache = { at: Date.now(), info };
	return info;
}

/* Fable est-il actuellement proposé par le CLI Claude Code ? */
export function isFableOffered(): boolean {
	return readClaudeCliInfo().fableOffered;
}

/** Notes promo que le CLI rattache à la jauge d'usage `bar` (clé d'API de la
    fenêtre : « five_hour », « seven_day »…). Vide si le CLI n'en publie pas. */
export function claudePromoNoticesFor(bar: string): ClaudePromoNotice[] {
	return readClaudeCliInfo().promos.filter(n => n.bar === bar);
}

/* Liste des modèles Claude visibles maintenant : libellés à jour de ce que le
   CLI a servi, et Fable inclus seulement s'il est proposé, avec le badge qui
   correspond au forfait détecté (« Inclus » sur Max, « Crédits d'usage » sur
   Pro, aucun quand le forfait ne tranche pas). */
export function getClaudeModels(): ModelDef[] {
	const { fableOffered, labels } = readClaudeCliInfo();
	const models = fableOffered
		? CLAUDE_CODE_MODELS.map(m => m.value === "fable" ? { ...m, badge: fableAccessBadge() } : m)
		: CLAUDE_CODE_MODELS.filter(m => m.value !== "fable");
	// L'alias EST le nom de famille (« opus ») : un libellé appris le remplace.
	return models.map(m => labels[m.value] ? { ...m, label: labels[m.value] } : m);
}

/* Modèle Claude effectif : si le modèle choisi n'est plus visible
   (ex. Fable une fois la promo terminée), retombe sur le modèle par défaut. */
export function resolveClaudeModel(value?: string): string {
	const models = getClaudeModels();
	if (models.some(m => m.value === value)) return value as string;
	return getProvider("claude-code").defaultModel;
}

/* ── Modèles Ollama (un seul endpoint local, cloud + local) ──
   Ollama sert local ET cloud sur localhost:11434. Les tags cloud portent le
   suffixe « :cloud » OU « …-cloud » : LES DEUX FORMES existent (ex.
   gpt-oss:120b-cloud vs glm-5.3:cloud) et le suffixe NE dit RIEN du prix.
   Gratuit vs payant est décidé par Ollama PAR MODÈLE, évolue dans le temps, et
   n'est fiable qu'à la génération (403 « requires a subscription »). On ne fige
   donc AUCUN statut de prix. Le catalogue ne garde que les modèles récents
   (dernière version par famille) et est rafraîchi dynamiquement depuis
   ollama.com (cf. fetchOllamaCloudCatalog) ; le tableau ci-dessous n'est qu'un
   repli embarqué (si hors-ligne) et la source des tags exacts connus. */
/* Tags relevés un par un sur ollama.com/library/<modèle>/tags le 2026-08-29.
   Les relever plutôt que les deviner N'EST PAS DU ZÈLE : « <famille>:cloud »
   n'existe pas pour tout le monde (mistral-large-3 n'a que « :675b-cloud »,
   nemotron-3-nano que « :30b-cloud »), et un tag inventé donne un 404 à la
   génération. gemini-3-flash-preview a perdu son tag cloud et sort d'ici. */
export const OLLAMA_FALLBACK_CATALOG: OllamaCatalogEntry[] = [
	{ value: "gpt-oss:120b-cloud", label: "GPT-OSS 120B" },
	{ value: "gpt-oss:20b-cloud", label: "GPT-OSS 20B" },
	{ value: "minimax-m3:cloud", label: "MiniMax M3" },
	{ value: "nemotron-3-ultra:cloud", label: "Nemotron 3 Ultra" },
	{ value: "nemotron-3-super:cloud", label: "Nemotron 3 Super" },
	{ value: "nemotron-3-nano:30b-cloud", label: "Nemotron 3 Nano" },
	{ value: "glm-5.3:cloud", label: "GLM-5.3" },
	{ value: "glm-5.3-flash:cloud", label: "GLM-5.3 Flash" },
	{ value: "kimi-k3:cloud", label: "Kimi K3" },
	{ value: "qwen3.5:cloud", label: "Qwen 3.5" },
	{ value: "deepseek-v4-pro:cloud", label: "DeepSeek V4 Pro" },
	{ value: "deepseek-v4-flash:cloud", label: "DeepSeek V4 Flash" },
	{ value: "mistral-large-3:675b-cloud", label: "Mistral Large 3" },
	{ value: "gemma4:cloud", label: "Gemma 4" }
];

// Le menu affiche UNE liste scrollable (façon app Ollama) : jusqu'à 20 modèles,
// hauteur calée sur ~7 lignes visibles (OLLAMA_VISIBLE_COUNT), scroll interne +
// recherche « Find model… ». Les réglages ne servent qu'à ordonner/compléter.
export const OLLAMA_MAX_MODELS = 20;
export const OLLAMA_VISIBLE_COUNT = 7;

// Sélection par défaut : les 7 MEILLEURS modèles cloud, le meilleur en tête.
// L'ordre = qualité, indépendamment du prix (un modèle payant → 403 explicite à
// la génération, jamais figé ici). L'utilisateur réordonne à volonté.
export const DEFAULT_OLLAMA_SELECTION: string[] = [
	"glm-5.3:cloud", "kimi-k3:cloud", "deepseek-v4-pro:cloud", "qwen3.5:cloud",
	"minimax-m3:cloud", "gpt-oss:120b-cloud", "nemotron-3-ultra:cloud"
];

/* Un modèle Ollama est-il cloud ? (suffixe :cloud ou …-cloud — les deux formes) */
export function isOllamaCloudModel(value?: string): boolean {
	return /(?::cloud|-cloud)$/.test(value || "");
}

/* Libellé lisible depuis un tag (« gpt-oss:120b-cloud » → « GPT-OSS 120B »).
   Cosmétique ; sert aux modèles hors repli (fetch dynamique / ajout manuel). */
export function prettyOllamaLabel(value?: string): string {
	const core = String(value || "").replace(/(?::|-)cloud$/, "").replace(/:latest$/, "").replace(/:/g, " ");
	const ACR: Record<string, string> = { gpt: "GPT", oss: "OSS", glm: "GLM", ai: "AI", llm: "LLM" };
	return core.split(/\s+/).map(seg =>
		seg.split("-").map(w => ACR[w.toLowerCase()] || (w && /[a-z]/i.test(w[0]) ? w[0].toUpperCase() + w.slice(1) : w)).join("-")
	).join(" ");
}

/* Catalogue effectif : cache dynamique (settings.aiOllamaCatalog) sinon repli.
   TOUJOURS filtré par dedupeOllamaLatest → garantit qu'une seule version par
   modèle survit, quelle que soit la source (règle absolue, cf. dedupeOllamaLatest). */
export function getOllamaCatalog(cached?: OllamaCatalogEntry[] | null): OllamaCatalogEntry[] {
	const base = Array.isArray(cached) && cached.length ? cached : OLLAMA_FALLBACK_CATALOG;
	return dedupeOllamaLatest(base);
}

/* Métadonnées d'un modèle : label depuis le catalogue fourni (ou repli, ou
   prettify), cloud d'après le suffixe. On ne fige NI le prix NI thinking : un
   modèle cloud propose l'effort (le param `think` est ignoré sans erreur s'il
   n'est pas supporté — vérifié). Le local raffine thinking via ses capabilities. */
export function getOllamaModelMeta(value: string, catalog?: OllamaCatalogEntry[] | null): OllamaModelMeta {
	// Le label curé du repli prime (ex. « Mistral Large 3 » plutôt que le
	// « Mistral-Large-3:675b » dérivé par prettyOllamaLabel dans un cache) ; sinon le
	// cache dynamique, sinon prettify.
	const cat = getOllamaCatalog(catalog);
	const m = OLLAMA_FALLBACK_CATALOG.find(x => x.value === value) || cat.find(x => x.value === value);
	const cloud = isOllamaCloudModel(value);
	return {
		value,
		label: m ? m.label : (cloud ? prettyOllamaLabel(value) : String(value || "").replace(/:latest$/, "")),
		cloud,
		thinking: true
	};
}

/* Résout une sélection (liste ordonnée, ex. settings.aiOllamaModels) en options
   complètes, dédupliquée et plafonnée à OLLAMA_MAX_MODELS. Retombe sur la
   sélection par défaut si vide. `catalog` = cache dynamique optionnel. */
export function resolveOllamaSelection(values?: string[] | null, catalog?: OllamaCatalogEntry[] | null): OllamaModelMeta[] {
	let list = Array.isArray(values) ? values.filter(v => typeof v === "string" && v) : [];
	if (!list.length) list = DEFAULT_OLLAMA_SELECTION.slice();
	const seen = new Set<string>();
	const decorated: OllamaModelMeta[] = [];
	for (const v of list) {
		if (seen.has(v)) continue;
		seen.add(v);
		decorated.push(getOllamaModelMeta(v, catalog));
	}
	// Règle absolue : une seule version par modèle dans la liste, puis plafond.
	return dedupeOllamaLatest(decorated).slice(0, OLLAMA_MAX_MODELS);
}

/* ── Regroupement par MODÈLE et « dernière version seulement » ──
   Règle produit ABSOLUE (mémoire projet : ollama-latest-version-only) : la liste
   ne contient QUE la version la plus récente de chaque modèle. « kimi-k2.6 »
   disparaît dès que « kimi-k3 » est là ; « glm-5.2 » dès qu'il y a « glm-5.3 ».

   Base = préfixe alphabétique AVANT le premier chiffre, sur le nom SANS le tag
   (« :cloud »). C'est ce qui fait qu'un suffixe de variante (« -code ») ne scinde
   PAS le modèle : « kimi-k2.6 » et « kimi-k2.7-code » → base « kimi-k » (même
   modèle). Les tiers de MÊME version (« nemotron-3-super »/« -ultra » → base
   « nemotron », version [3] pour les deux) restent tous les deux : on ne coupe
   que sur la version, pas sur la variante. */
function ollamaFamilyBase(name: string): string {
	const fam = String(name).split(":")[0];
	return (fam.match(/^[^0-9]*/)?.[0] || fam).replace(/[-.\s]+$/, "") || fam;
}
/* Version = suite de nombres du nom, tag ignoré (pour ne pas lire une taille
   « 120b » comme une version). [0] si aucun chiffre. */
function ollamaFamilyVersion(name: string): number[] {
	const fam = String(name).split(":")[0];
	const nums = (fam.match(/\d+/g) || []).map(Number);
	return nums.length ? nums : [0];
}
function cmpOllamaVersion(a: number[], b: number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] || 0, y = b[i] || 0;
		if (x !== y) return x - y;
	}
	return 0;
}

/* Ne garde qu'une entrée par modèle = sa version max. Les variantes de MÊME
   version (tiers super/ultra, tailles 120b/20b) sont toutes conservées ; seules
   les versions périmées d'un même modèle sont retirées. Préserve l'ordre. */
export function dedupeOllamaLatest<T extends { value: string }>(list: T[]): T[] {
	const maxByFam = new Map<string, number[]>();
	for (const m of list) {
		const base = ollamaFamilyBase(m.value), v = ollamaFamilyVersion(m.value);
		if (!maxByFam.has(base) || cmpOllamaVersion(v, maxByFam.get(base)!) > 0) maxByFam.set(base, v);
	}
	const seen = new Set<string>();
	const out: T[] = [];
	for (const m of list) {
		if (seen.has(m.value)) continue;
		if (cmpOllamaVersion(ollamaFamilyVersion(m.value), maxByFam.get(ollamaFamilyBase(m.value))!) !== 0) continue;
		seen.add(m.value);
		out.push(m);
	}
	return out;
}

/* Récupère les modèles cloud récents depuis ollama.com (best-effort, via
   requestUrl → pas de CORS). Repli embarqué (tags exacts, dont les tailles
   gpt-oss) + familles découvertes STRICTEMENT plus récentes (tag deviné
   « <famille>:cloud »), dernière version par famille. Le prix n'est PAS
   récupéré (détecté au 403). Lève en cas d'échec réseau. Renvoie [{value,label}]. */
export async function fetchOllamaCloudCatalog(): Promise<OllamaCatalogEntry[]> {
	const resp = await requestUrl({ url: "https://ollama.com/search?c=cloud", throw: false });
	if (!resp || resp.status !== 200 || !resp.text) throw new Error("catalog fetch " + (resp && resp.status));
	const families = [...new Set([...resp.text.matchAll(/x-test-search-response-title>([a-z0-9.\-]+)/gi)].map(m => m[1]))];
	// Version max du repli par modèle → les familles déjà couvertes gardent leur
	// TAG EXACT embarqué (dont les tailles gpt-oss 120b/20b, non devinables) ; on
	// n'ajoute une famille découverte que si elle est STRICTEMENT plus récente
	// (ou inconnue). Le tag deviné « <famille>:cloud » reprend le nom exact de la
	// fiche ollama.com (donc « kimi-k2.7-code:cloud » et pas « kimi:cloud »).
	const bundledMax = new Map<string, number[]>();
	for (const m of OLLAMA_FALLBACK_CATALOG) {
		const base = ollamaFamilyBase(m.value), v = ollamaFamilyVersion(m.value);
		if (!bundledMax.has(base) || cmpOllamaVersion(v, bundledMax.get(base)!) > 0) bundledMax.set(base, v);
	}
	const out = OLLAMA_FALLBACK_CATALOG.slice();
	for (const fam of families) {
		const base = ollamaFamilyBase(fam), v = ollamaFamilyVersion(fam);
		if (bundledMax.has(base) && cmpOllamaVersion(v, bundledMax.get(base)!) <= 0) continue;
		out.push({ value: fam + ":cloud", label: prettyOllamaLabel(fam + ":cloud") });
	}
	// Règle absolue : une seule version par modèle (retire un repli périmé dès
	// qu'une version plus récente est découverte en ligne).
	return dedupeOllamaLatest(out);
}

export function getDefaultModels(providerId: string): ModelDef[] {
	if (providerId === "claude-code") return CLAUDE_CODE_MODELS;
	if (providerId === "codex") return getCodexModels();
	// OllamaCatalogEntry[] est structurellement assignable à ModelDef[].
	return dedupeOllamaLatest(OLLAMA_FALLBACK_CATALOG);
}

/* ── PATH étendu pour child_process ──
   Obsidian lancé depuis l'UI n'hérite pas toujours du PATH
   complet du shell (npm global, ~/.local/bin, homebrew) — et un
   installateur qui modifie le PATH du REGISTRE (Codex CLI officiel)
   n'atteint jamais un process déjà lancé : sans ces chemins en dur,
   « installé mais pas détecté » tant qu'Obsidian n'est pas redémarré
   (vécu Ahmed 2026-07-12, install.ps1 officiel sur desktop). Chemins
   vérifiés DANS les scripts d'installation d'OpenAI :
   - install.ps1 → %LOCALAPPDATA%\Programs\OpenAI\Codex\bin
   - install.sh  → ~/.local/bin (déjà couvert)
   - npm         → %APPDATA%\npm (déjà couvert)
   - CODEX_INSTALL_DIR : override honoré par les deux scripts. */
export function buildChildEnv(): NodeJS.ProcessEnv {
	const os = require("os") as typeof import("os");
	const path = require("path") as typeof import("path");
	const extra: string[] = [
		path.join(os.homedir(), ".local", "bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
		process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null,
		process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin") : null,
		process.env.CODEX_INSTALL_DIR || null,
		// Installateur Windows d'Ollama (CLI ollama.exe au même endroit).
		process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Ollama") : null
	].filter((p): p is string => Boolean(p));
	const sep = path.delimiter;
	const current = process.env.PATH || "";
	const merged = current + sep + extra.filter(p => !current.includes(p)).join(sep);
	return Object.assign({}, process.env, { PATH: merged, Path: merged });
}

/* ── Détections de statut ── */

let claudeCodeCache: { at: number; result: ClaudeCodeStatus } | null = null;
const CLAUDE_CODE_TTL = 60000;

/* Claude Code CLI installé ? → { ok, version?, reason? }
   `force` ignore le TTL (relance le CLI) — sert à re-vérifier la version
   à l'ouverture du menu fournisseur, après un éventuel update. */
export async function checkClaudeCode(force?: boolean): Promise<ClaudeCodeStatus> {
	if (!Platform.isDesktopApp) {
		return { ok: false, reason: "mobile" };
	}
	if (!force && claudeCodeCache && Date.now() - claudeCodeCache.at < CLAUDE_CODE_TTL) {
		return claudeCodeCache.result;
	}
	const result = await new Promise<ClaudeCodeStatus>((resolve) => {
		try {
			const cp = require("child_process") as typeof import("child_process");
			cp.exec("claude --version", {
				env: buildChildEnv(),
				timeout: 10000,
				windowsHide: true
			}, (err, stdout) => {
				if (err) {
					resolve({ ok: false, reason: "not-installed" });
				} else {
					const version = (stdout || "").trim().split(/\s+/)[0] || "";
					resolve({ ok: true, version });
				}
			});
		} catch (e) {
			resolve({ ok: false, reason: "not-installed" });
		}
	});
	claudeCodeCache = { at: Date.now(), result };
	return result;
}

let codexCache: { at: number; result: CodexStatus } | null = null;

/* Codex CLI (ChatGPT) installé ? → { ok, version?, reason? }
   `codex --version` sort « codex-cli 0.139.0 » → on garde le dernier token.
   `force` ignore le TTL (même logique que checkClaudeCode). */
export async function checkCodex(force?: boolean): Promise<CodexStatus> {
	if (!Platform.isDesktopApp) {
		return { ok: false, reason: "mobile" };
	}
	if (!force && codexCache && Date.now() - codexCache.at < CLAUDE_CODE_TTL) {
		return codexCache.result;
	}
	const result = await new Promise<CodexStatus>((resolve) => {
		try {
			const cp = require("child_process") as typeof import("child_process");
			cp.exec("codex --version", {
				env: buildChildEnv(),
				timeout: 10000,
				windowsHide: true
			}, (err, stdout) => {
				if (err) {
					resolve({ ok: false, reason: "not-installed" });
				} else {
					const parts = (stdout || "").trim().split(/\s+/);
					const version = parts[parts.length - 1] || "";
					resolve({ ok: true, version });
				}
			});
		} catch (e) {
			resolve({ ok: false, reason: "not-installed" });
		}
	});
	codexCache = { at: Date.now(), result };
	return result;
}

let ollamaCache: { at: number; url: string; result: OllamaStatus } | null = null;

/* Serveur Ollama joignable ? → { ok, models?, reason? }
   Un serveur joignable suffit (ok), même sans modèle local installé : les
   modèles cloud (:cloud) tournent à la demande sans figurer dans /api/tags.
   Caché comme Claude/Codex (même TTL) : sans ça, chaque re-render du composer
   refaisait la détection, et le hint du fournisseur n'apparaissait qu'après
   ce round-trip — alors que son statut était déjà affiché dans le menu. */
export async function checkOllama(url?: string, force?: boolean): Promise<OllamaStatus> {
	const base = (url || "http://localhost:11434").replace(/\/+$/, "");
	if (!force && ollamaCache && ollamaCache.url === base && Date.now() - ollamaCache.at < CLAUDE_CODE_TTL) {
		return ollamaCache.result;
	}
	const result = await checkOllamaLive(base);
	ollamaCache = { at: Date.now(), url: base, result };
	return result;
}

async function checkOllamaLive(base: string): Promise<OllamaStatus> {
	try {
		const resp = await fetch(base + "/api/tags", { method: "GET" });
		if (!resp.ok) return { ok: false, reason: "offline" };
		const data = await resp.json() as { models?: Array<{ name: string; size?: number; capabilities?: string[] }> };
		// capabilities (dont « thinking ») exposées par /api/tags depuis Ollama
		// 0.31 → sert à savoir si un modèle local montre la ligne Effort.
		const models: OllamaDetectedModel[] = (data?.models || []).map(m => ({
			name: m.name, size: m.size, capabilities: m.capabilities || []
		}));
		// Version du serveur = version d'Ollama installée (GET /api/version →
		// { "version": "0.31.2" }). Best-effort : undefined si l'endpoint échoue.
		let version: string | undefined;
		try {
			const vr = await fetch(base + "/api/version", { method: "GET" });
			if (vr.ok) version = (await vr.json() as { version?: string })?.version;
		} catch (e) { /* version optionnelle */ }
		return { ok: true, models, version };
	} catch (e) {
		return { ok: false, reason: "offline" };
	}
}

let ollamaInstalledCache: { at: number; result: OllamaInstalledStatus } | null = null;

/* Ollama est-il INSTALLÉ, même serveur arrêté ? Le plugin diagnostique
   lui-même (demande Ahmed : jamais un « si Ollama n'est pas installé »
   laissé à l'utilisateur) : binaire qui répond à --version (PATH
   étendu, couvre npm/brew/PATH custom), sinon emplacements
   d'installation officiels. Caché (même TTL) : un `ollama --version` qui
   échoue coûte un spawn de shell, à ne pas repayer à chaque re-render. */
export async function checkOllamaInstalled(force?: boolean): Promise<OllamaInstalledStatus> {
	if (!Platform.isDesktopApp) return { installed: false };
	if (!force && ollamaInstalledCache && Date.now() - ollamaInstalledCache.at < CLAUDE_CODE_TTL) {
		return ollamaInstalledCache.result;
	}
	const result = await checkOllamaInstalledLive();
	ollamaInstalledCache = { at: Date.now(), result };
	return result;
}

async function checkOllamaInstalledLive(): Promise<OllamaInstalledStatus> {
	const execOk = await new Promise<boolean>((resolve) => {
		try {
			const cp = require("child_process") as typeof import("child_process");
			cp.exec("ollama --version", {
				env: buildChildEnv(),
				timeout: 4000,
				windowsHide: true
			}, (err) => resolve(!err));
		} catch (e) {
			resolve(false);
		}
	});
	if (execOk) return { installed: true };
	try {
		const fs = require("fs") as typeof import("fs");
		const path = require("path") as typeof import("path");
		const candidates = Platform.isWin
			? [path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama app.exe")]
			: Platform.isMacOS
				? ["/Applications/Ollama.app", "/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"]
				: ["/usr/local/bin/ollama", "/usr/bin/ollama"];
		return { installed: candidates.some(p => fs.existsSync(p)) };
	} catch (e) {
		return { installed: false };
	}
}

/* Démarre Ollama (le serveur démarre avec l'application) — détaché,
   best effort : l'app de bureau sur Windows/macOS, « ollama serve »
   sur Linux (pas d'app). Les erreurs asynchrones (exe absent) sont
   avalées : le poll de l'appelant constatera simplement l'échec. */
export function startOllamaApp(): boolean {
	const cp = require("child_process") as typeof import("child_process");
	const path = require("path") as typeof import("path");
	try {
		let child;
		if (Platform.isWin) {
			const fs = require("fs") as typeof import("fs");
			const exe = path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama app.exe");
			child = fs.existsSync(exe)
				? cp.spawn(exe, [], { detached: true, stdio: "ignore" })
				: cp.spawn("ollama", ["serve"], { detached: true, stdio: "ignore", env: buildChildEnv() });
		} else if (Platform.isMacOS) {
			child = cp.spawn("open", ["-a", "Ollama"], { detached: true, stdio: "ignore" });
		} else {
			child = cp.spawn("ollama", ["serve"], { detached: true, stdio: "ignore", env: buildChildEnv() });
		}
		child.on("error", () => { /* constaté par le poll de l'appelant */ });
		child.unref();
		return true;
	} catch (e) {
		return false;
	}
}
