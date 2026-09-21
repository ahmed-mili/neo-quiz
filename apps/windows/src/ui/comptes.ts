/* ══════════════════════════════════════════════════════════
   LA SECTION « COMPTES » DES RÉGLAGES

   Quatre lignes, `claude`, `codex`, `agy`, `ollama`, dans cet ordre fixe.
   L'état vient de DEUX sources assemblées : `host.process.etatComptes()` pour
   les trois premières (un seul appel, groupé côté principal), et
   `checkOllamaCompte()` (`src/dashboard/ai-providers.ts`) pour la quatrième —
   Ollama n'a pas de fichier de jetons que le principal pourrait lire comme les
   trois autres, seul son serveur local sait répondre. `ollamaInstalle()` du
   même contrat dit si le binaire existe, séparément de la connexion : sans
   lui la ligne Ollama ne pourrait jamais proposer « Installer ».

   MÊME PATRON QUE `fond.ts` (`monterReglagesFond`) : une fonction qui monte
   la section, dessine un premier état (ici : un squelette), puis redessine
   après chaque lecture ou action. Aucun abonnement au pont : rien ne pousse
   de changement depuis le principal, une action redessine elle-même après
   avoir agi.
══════════════════════════════════════════════════════════ */

import type { CliTool, EtatCompte } from "../../../../src/host/types";
import { currentHost, requireHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { openConfirmModal } from "../../../../src/editor/modals";
import { checkOllamaCompte } from "../../../../src/dashboard/ai-providers";
import { pont } from "../host/pont";
import { CLE_REGLAGES_IA } from "../../electron/pont";

/** L'ordre d'affichage, fixé par le cahier des charges — jamais celui que
    rendrait `etatComptes()` (qui ne connaît pas Ollama). */
const ORDRE: CliTool[] = ["claude", "codex", "agy", "ollama"];

/** Icône Lucide par outil : purement décoratif, aucune de ces marques n'a
    d'icône dédiée dans le catalogue Lucide — `bot` les distingue toutes de
    la même façon qu'un pictogramme générique « assistant », `server` pour
    Ollama qui est un serveur local et non un compte cloud. */
const ICONES: Record<CliTool, string> = {
	claude: "bot",
	codex: "bot",
	agy: "bot",
	ollama: "server",
};

/** Le nom affiché, traduit — jamais le nom brut de `PROVIDERS`
    (`ai-providers.ts`), qui dit « Claude » quand cette ligne doit dire
    « Claude Code » : c'est le compte du CLI, pas celui du fournisseur. */
function nomOutil(outil: CliTool): string {
	switch (outil) {
		case "claude": return t("app.comptes.claude");
		case "codex": return t("app.comptes.codex");
		case "agy": return t("app.comptes.agy");
		case "ollama": return t("app.comptes.ollama");
	}
}

/** L'état de la ligne Ollama, assemblé depuis deux appels que `EtatCompte`
    ne distingue pas ailleurs : `ollamaInstalle()` (le binaire existe-t-il ?)
    et `checkOllamaCompte()` (le serveur répond-il, connecté ?). L'adresse du
    serveur vient des réglages IA de l'application (`CLE_REGLAGES_IA`), la
    même clé que lit `AiSettingsHost` — ce module n'en a pas d'autre à sa
    disposition, la page « Générer » n'étant pas montée ici. */
async function etatOllama(): Promise<EtatCompte> {
	const proc = requireHost("process");
	const brut = await pont().reglages.lire(CLE_REGLAGES_IA);
	const url = brut && typeof brut === "object" ? (brut as { aiOllamaUrl?: unknown }).aiOllamaUrl : undefined;
	const [installe, compte] = await Promise.all([
		proc.ollamaInstalle(),
		checkOllamaCompte(typeof url === "string" ? url : undefined),
	]);
	return {
		outil: "ollama",
		installe,
		connecte: compte.connecte,
		// Ollama ne publie pas d'adresse de compte, seulement un forfait.
		email: null,
		plan: compte.connecte ? compte.plan : null,
	};
}

/** Les quatre lignes, dans l'ORDRE fixe — les deux sources partent en
    parallèle, et on attend les DEUX avant de dessiner : celle qui répond la
    première (Ollama, sous la seconde) ne doit pas faire sauter la liste
    pendant que la plus lente (`etatComptes()`, ~1 s à cause d'Antigravity)
    arrive encore. */
async function lireEtats(): Promise<EtatCompte[]> {
	const [trois, ollama] = await Promise.all([
		requireHost("process").etatComptes(),
		etatOllama(),
	]);
	const parOutil = new Map(trois.map(e => [e.outil, e] as const));
	return ORDRE.map(outil => {
		if (outil === "ollama") return ollama;
		return parOutil.get(outil) ?? { outil, installe: false, connecte: false, email: null, plan: null };
	});
}

/** L'action que le bouton d'une ligne déclenche : c'est `installe` qui
    tranche la première branche, jamais `connecte` seul — un outil absent de
    la machine et un outil présent mais déconnecté ne peuvent pas partager le
    même bouton. */
function actionDe(etat: EtatCompte): "installer" | "connecter" | "deconnecter" {
	if (!etat.installe) return "installer";
	return etat.connecte ? "deconnecter" : "connecter";
}

export function monterReglagesComptes(section: HTMLElement): () => void {
	let detruit = false;

	const liste = ajouter(section, "div", "nq-comptes-liste");

	/** Une ligne, reconstruite en entier à chaque redessin — quatre lignes ne
	    justifient pas un diff fin, et ça garde ce module au niveau de
	    `fond.ts`, qui fait le même choix pour sa rangée unique. */
	function poserLigne(etat: EtatCompte): void {
		const ligne = ajouter(liste, "div", "nq-comptes-ligne");
		ligne.dataset.outil = etat.outil;

		const icone = ajouter(ligne, "div", "nq-comptes-icone");
		currentHost().ui.setIcon(icone, ICONES[etat.outil]);

		const texte = ajouter(ligne, "div", "nq-comptes-texte");
		ajouter(texte, "span", "nq-comptes-nom", nomOutil(etat.outil));
		const etatTexte = !etat.installe
			? t("app.comptes.notInstalled")
			: !etat.connecte
				? t("app.comptes.notConnected")
				: (etat.email ?? t("app.comptes.connectedNoEmail"));
		ajouter(texte, "span", "nq-comptes-email", etatTexte);

		// Antigravity ne publie aucun forfait (décision du chantier) : la
		// colonne reste vide plutôt que d'inventer une valeur.
		if (etat.plan) ajouter(ligne, "span", "nq-comptes-plan", etat.plan);

		const action = actionDe(etat);
		const bouton = ajouter(ligne, "button", "nq-comptes-action", t(
			action === "installer" ? "app.comptes.install"
				: action === "connecter" ? "app.comptes.connect"
					: "app.comptes.disconnect",
		));
		bouton.type = "button";
		bouton.addEventListener("click", () => {
			void surClicAction(etat.outil, action, bouton);
		});
	}

	async function redessiner(): Promise<void> {
		const etats = await lireEtats();
		if (detruit) return;
		liste.replaceChildren();
		for (const etat of etats) poserLigne(etat);
	}

	async function deconnecter(outil: CliTool): Promise<void> {
		const verdict = await requireHost("process").deconnecterCli(outil);
		if (detruit) return;
		if (verdict === "echec" || verdict === "indisponible") {
			currentHost().ui.notice(t("app.comptes.logoutFailed", { name: nomOutil(outil) }));
			return;
		}
		// `"ok"` : la ligne est RE-SONDÉE, jamais supposée déconnectée.
		await redessiner();
	}

	async function surClicAction(
		outil: CliTool,
		action: "installer" | "connecter" | "deconnecter",
		bouton: HTMLButtonElement,
	): Promise<void> {
		if (action === "deconnecter") {
			const name = nomOutil(outil);
			openConfirmModal(
				t("app.comptes.logoutTitle", { name }),
				t("app.comptes.logoutMessage", { name }),
				t("app.comptes.logoutConfirm"),
				t("app.comptes.cancel"),
				(confirme) => {
					if (!confirme) return;
					void deconnecter(outil);
				},
				t("app.comptes.logoutDetail"),
				"log-out",
			);
			return;
		}
		bouton.disabled = true;
		try {
			const proc = requireHost("process");
			const verdict = action === "installer" ? await proc.installerCli(outil) : await proc.connecterCli(outil);
			if (verdict === "indisponible") {
				currentHost().ui.notice(t(
					action === "installer" ? "app.comptes.installFailed" : "app.comptes.connectFailed",
					{ name: nomOutil(outil) },
				));
			}
			// `"lance"` ou `"annule"` : rien à dire de plus ici, le terminal (s'il
			// est parti) fait le reste — la ligne se redessine, au pire inchangée.
		} finally {
			if (!detruit) await redessiner();
		}
	}

	void redessiner();

	return () => { detruit = true; };
}
