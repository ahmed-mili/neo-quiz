import type { AiSettings } from "../types/dashboard-ctx";

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
