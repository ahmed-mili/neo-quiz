import type { AiSettings } from "../types/dashboard-ctx";
import type { Hotkey } from "../hotkey-format";

/* ══════════════════════════════════════════════════════════
   LES RÉGLAGES IA, VUS DU CLIENT DE GÉNÉRATION

   Même patron que `StatsStoreHost` (`stats-store.ts`), et pour la même
   raison : `createAiClient` prenait un `obsidian.Plugin` entier alors qu'il
   n'en lisait QUE `settings`. C'est ce `Plugin` — un `import type` de trois
   mots — qui gardait `ai-client.ts` dans la liste des fichiers liés à Obsidian
   (`scripts/check-host.mjs`), et il obligeait l'application à fabriquer un
   faux greffon pour obtenir un client.

   `save` n'est appelée par personne AUJOURD'HUI : le client ne fait que LIRE.
   Elle est ici parce que l'hôte est la seule chose que la page « Générer » de
   l'application recevra à la tâche 6, et qu'un composant qui doit demander
   l'écriture à un second objet n'a plus d'hôte, il a deux moitiés d'hôte.
══════════════════════════════════════════════════════════ */

export interface AiSettingsHost {
	/** Les réglages IA courants. Lue À CHAQUE usage, jamais copiée : une
	    génération lit le fournisseur, le modèle et l'effort au moment où elle
	    part, pas à la construction du client. */
	get(): AiSettings;
	/** Fusionne un correctif dans les réglages et les persiste. */
	save(patch: Partial<AiSettings>): Promise<void>;
}

/**
 * LES DÉFAUTS DES RÉGLAGES IA — UNE SEULE LISTE POUR LES DEUX HÔTES.
 *
 * Le greffon les étale dans son `DEFAULT_SETTINGS` (`apps/obsidian/plugin.ts`) ;
 * l'application hydrate son cache (`apps/windows/src/main.ts`, clé
 * `CLE_REGLAGES_IA` de `neo.reglages`) avec les MÊMES. Deux listes recopiées
 * divergeraient sans une erreur : un `aiEffort` à « high » d'un côté et à
 * « medium » de l'autre changerait le coût d'une génération selon l'hôte, pour
 * le même réglage affiché.
 *
 * Une FONCTION, pas une constante : `aiUsageLog` et `aiMentionExtraFolders`
 * sont des tableaux, et un tableau partagé par tous les appelants finirait
 * muté par l'un d'eux.
 */
export function aiSettingsDefaults(): Required<Pick<AiSettings,
	"aiProvider" | "aiModel" | "aiEffort" | "aiCodexFast" | "aiOllamaUrl" | "aiOllamaCloudKey"
	| "aiOllamaModels" | "aiOllamaCatalog" | "aiUsageLog" | "aiUsageLimitsEnabled"
	| "aiMentionExtraFolders" | "aiOutputFolder">> & { hotkeyAddFiles: Hotkey; hotkeyAddNotes: Hotkey } {
	return {
		// Aucun fournisseur par défaut : le choix reste la première étape.
		aiProvider: "",
		aiModel: "",
		aiEffort: "high",
		// Mode Fast de Codex (service tier « priority », 1.5x speed) — l'éclair
		// du popover effort ChatGPT. Ignoré si le modèle ne l'expose pas.
		aiCodexFast: false,
		aiOllamaUrl: "http://localhost:11434",
		aiOllamaCloudKey: "",
		// Modèles Ollama affichés dans le menu (ordre réglable, max 7). null →
		// sélection par défaut (cf. aiProviders.resolveOllamaSelection).
		aiOllamaModels: null,
		// Cache du catalogue cloud récupéré de ollama.com. null → repli embarqué.
		aiOllamaCatalog: null,
		// Journal d'usage : purement informatif, borné à 300 entrées (ai-usage.ts).
		aiUsageLog: [],
		// Désactivé par défaut : lire les quotas du compte suppose d'ouvrir le
		// fichier de session du CLI installé — jamais sans demande explicite.
		aiUsageLimitsEnabled: false,
		// Raccourcis du composer IA (menu « + »). Ctrl+U = le raccourci de
		// claude.ai pour « Ajouter des fichiers » ; Ctrl+F reste le réflexe
		// « recherche » partout ailleurs.
		hotkeyAddFiles: { modifiers: ["Mod"], key: "u" },
		hotkeyAddNotes: { modifiers: ["Mod"], key: "e" },
		// Vide par défaut : le « @ » se limite au vault tant qu'on n'ajoute rien.
		aiMentionExtraFolders: [],
		// Donnée persistée, donc jamais traduite : les deux hôtes écrivent au même endroit.
		aiOutputFolder: "Generated",
	};
}
