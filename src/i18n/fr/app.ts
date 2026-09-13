import type { EN_APP } from "../en/app";

export const FR_APP: Record<keyof typeof EN_APP, string> = {
	"app.window.title": "Neo Quiz",
	"app.empty.title": "Choisissez un dossier de quiz",
	"app.empty.body": "Neo Quiz joue les blocs quiz-blocks de vos notes, là où elles sont déjà. Rien n'est copié, rien n'est déplacé.",
	"app.empty.yourVaults": "Vos vaults Obsidian",
	"app.empty.pickFolder": "Choisir un dossier",
	"app.error.startup": "Neo Quiz n'a pas pu démarrer : {error}",

	"app.quiz.readError": "Impossible de lire {path} : {error}",

	"app.aiSettings.refused": "Impossible d'enregistrer les réglages IA : {error}",
	"app.aiHost.title": "Autoriser ce serveur Ollama ?",
	"app.aiHost.message": "Neo Quiz enverra vos demandes et les notes que vous joignez à {host}.",
	"app.aiHost.detail": "Ce serveur n'est ni un hôte connu ni sur votre réseau local. Ne l'autorisez que si vous l'avez configuré vous-même.",
	"app.aiHost.allow": "Autoriser",
	"app.aiHost.deny": "Annuler",

	/* ── Mise à jour automatique (application seulement) ── */
	"app.update.restart": "Redémarrer pour mettre à jour",
	"app.update.auto": "Mises à jour automatiques",
	"app.update.autoHint": "Neo Quiz cherche une version plus récente sur GitHub, la télécharge en arrière-plan, et l'installe quand vous cliquez sur Redémarrer ou quand vous fermez l'application.",
	"app.update.checkNow": "Vérifier maintenant",
	"app.update.state.inactif": "Les mises à jour automatiques sont coupées.",
	"app.update.state.verification": "Recherche d'une mise à jour…",
	"app.update.state.aJour": "Vous avez la dernière version.",
	"app.update.state.telechargement": "Téléchargement de {version} : {pourcent} %",
	"app.update.state.prete": "La version {version} est prête à être installée.",
	"app.update.state.erreur": "Impossible de vérifier les mises à jour.",

	/* ── Barre de titre et menu d'application (application seulement) ── */
	"app.titlebar.menu": "Menu de l'application",
	"app.titlebar.minimize": "Réduire",
	"app.titlebar.maximize": "Agrandir",
	"app.titlebar.restore": "Restaurer",
	"app.titlebar.close": "Fermer",
	"app.menu.checkUpdates": "Vérifier les mises à jour…",
	"app.menu.settings": "Réglages…",
	"app.menu.edit": "Édition",
	"app.menu.undo": "Annuler",
	"app.menu.redo": "Rétablir",
	"app.menu.cut": "Couper",
	"app.menu.copy": "Copier",
	"app.menu.paste": "Coller",
	"app.menu.selectAll": "Tout sélectionner",
	"app.menu.view": "Affichage",
	"app.menu.scale": "Échelle de l'interface",
	"app.menu.reload": "Recharger",
	"app.menu.fullscreen": "Plein écran",
	"app.menu.devtools": "Outils de développement",
	"app.menu.nextWallpaper": "Fond suivant",

	/* ── Réglages « Général » (application seulement) ── */
	"app.settings.general": "Général",
	"app.reprise.label": "Rouvrir là où on s'était arrêté",
	"app.reprise.hint": "Au lancement, Neo Quiz rouvre le dernier quiz et la dernière question consultés.",

	/* ── Fond d'écran (application seulement) ── */
	"app.settings.wallpaper": "Fond d'écran",
	"app.fond.none": "Aucun dossier choisi : le fond embarqué est utilisé.",
	"app.fond.choose": "Choisir un dossier",
	"app.fond.remove": "Retirer",
	"app.fond.next": "Fond suivant",
	"app.fond.disparue": "L'image du fond a disparu ; la première du dossier est utilisée.",
	"app.fond.dossierVide": "Aucune image dans ce dossier ; le fond embarqué est utilisé.",
};
