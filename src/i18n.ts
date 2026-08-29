import { EN } from "./i18n/en";
import { FR } from "./i18n/fr";

/* ══════════════════════════════════════════════════════════
   I18N — langue de l'interface
   Anglais par défaut (plugin destiné à la liste communautaire),
   français complet, et mode « auto » calé sur la langue d'Obsidian.
   La langue des QUIZ GÉNÉRÉS ne passe PAS par ici : le modèle répond
   dans la langue du sujet fourni (cf. le prompt système d'ai-client).
══════════════════════════════════════════════════════════ */

/** Langues réellement traduites. */
export type Lang = "en" | "fr";
/** Valeur du réglage : « auto » suit Obsidian. */
export type LangSetting = "auto" | Lang;

/** Clés de traduction : le dictionnaire anglais fait référence — une clé
    absente de FR est une erreur de compilation, jamais une chaîne manquante
    à l'écran. */
export type TransKey = keyof typeof EN;

const DICTS: Record<Lang, Record<TransKey, string>> = { en: EN, fr: FR };

/* Langue effective, recalculée par setLanguage (chargement + changement du
   réglage). Jamais lue au chargement des modules : un libellé doit être
   traduit AU RENDU, sinon changer de langue n'aurait d'effet qu'au prochain
   redémarrage. */
let current: Lang = "en";
let setting: LangSetting = "auto";

/* ── Langue d'Obsidian ──
   `window.i18next` est le moteur de traduction interne de l'app : sa
   propriété `language` est la langue CHOISIE DANS OBSIDIAN (« fr »), pas
   celle de l'OS ni du navigateur — c'est donc la seule source correcte pour
   le mode auto (vérifié en direct sur Obsidian 1.12.7 : i18next.language =
   « fr », languages = ["fr", "en"]).
   Ce n'est pas une API publique (absente d'obsidian.d.ts) : repli sur
   <html lang>, qu'Obsidian tient à jour, puis sur l'anglais. */
interface I18nextLike { language?: unknown }

function detectObsidianLang(): Lang {
	try {
		const i18next = (window as unknown as { i18next?: I18nextLike }).i18next;
		const raw = i18next && typeof i18next.language === "string" ? i18next.language : "";
		const lang = raw || document.documentElement.lang || "";
		// « fr », « fr-FR », « fr_FR » → fr ; tout le reste → en (seules deux
		// langues sont traduites, inutile de deviner au-delà).
		return /^fr\b/i.test(lang.replace(/_/g, "-")) ? "fr" : "en";
	} catch (e) {
		return "en";
	}
}

/** Applique le réglage de langue. À appeler au chargement du plugin et à
    chaque changement du réglage (les vues sont redessinées par l'appelant). */
export function setLanguage(value?: LangSetting): void {
	setting = value === "en" || value === "fr" ? value : "auto";
	current = setting === "auto" ? detectObsidianLang() : setting;
}

/** Langue affichée en ce moment (« en » / « fr ») — jamais « auto ». */
export function currentLang(): Lang {
	return current;
}

/** Valeur brute du réglage (pour le SettingTab). */
export function langSetting(): LangSetting {
	return setting;
}

/** Traduit une clé. `vars` remplace les jetons {nom} du libellé :
    t("ai.status.claudeOk", { version: "2.1.251" }). */
export function t(key: TransKey, vars?: Record<string, string | number>): string {
	const dict = DICTS[current] || EN;
	// Repli sur l'anglais si une clé manque à l'exécution (dictionnaire chargé
	// d'une version antérieure) — mieux qu'une clé nue affichée à l'écran.
	const raw = dict[key] ?? EN[key] ?? String(key);
	if (!vars) return raw;
	return raw.replace(/\{(\w+)\}/g, (m, name: string) =>
		name in vars ? String(vars[name]) : m);
}
