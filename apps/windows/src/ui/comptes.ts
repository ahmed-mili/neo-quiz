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
import { checkOllamaCompte, setBrandLogo } from "../../../../src/dashboard/ai-providers";
import { pont } from "../host/pont";
import { CLE_REGLAGES_IA } from "../../electron/pont";
import { LOG_PREFIX } from "../../../../src/branding";

/** L'ordre d'affichage, fixé par le cahier des charges — jamais celui que
    rendrait `etatComptes()` (qui ne connaît pas Ollama). */
const ORDRE: CliTool[] = ["claude", "codex", "agy", "ollama"];

/** Le logo de MARQUE par outil, posé par `setBrandLogo` (`ai-providers.ts`),
    même patron que le sélecteur de fournisseur de la page « Générer »
    (`ai.ts`, `buildProviderControl`) : `qbd-provider-logo qbd-provider-logo--<nom>`
    puis `setBrandLogo(el, nom)`. Ce ne sont pas des icônes Lucide — le
    catalogue Lucide n'a aucun logo de marque, et les poser à la main ici
    aurait divergé du sélecteur qui affiche déjà ces mêmes logos. */
const LOGOS: Record<CliTool, string> = {
	claude: "claude",
	codex: "openai",
	agy: "antigravity",
	ollama: "ollama",
};

/** L'adresse du serveur Ollama telle qu'enregistrée par la page « Générer »
    (mêmes réglages IA, clé `CLE_REGLAGES_IA`). `undefined` fait retomber
    `checkOllamaCompte` sur son défaut local. */
async function lireAiOllamaUrl(): Promise<string | undefined> {
	const brut = await pont().reglages.lire(CLE_REGLAGES_IA);
	const url = brut && typeof brut === "object" ? (brut as { aiOllamaUrl?: unknown }).aiOllamaUrl : undefined;
	return typeof url === "string" ? url : undefined;
}

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
    et `checkOllamaCompte()` (le serveur répond-il, connecté ?). Rend aussi
    `signinUrl` (quand le démon répond 401 avec une adresse de connexion) :
    c'est elle que le bouton « Se connecter » ouvrira, Ollama n'ayant pas de
    CLI de connexion (voir `surClicAction`). */
async function etatOllama(): Promise<{ etat: EtatCompte; signinUrl: string | null }> {
	const proc = requireHost("process");
	const [installe, compte] = await Promise.all([
		proc.ollamaInstalle(),
		lireAiOllamaUrl().then(checkOllamaCompte),
	]);
	return {
		etat: {
			outil: "ollama",
			installe,
			connecte: compte.connecte,
			// Ollama ne publie pas d'adresse de compte, seulement un forfait.
			email: null,
			plan: compte.connecte ? compte.plan : null,
		},
		signinUrl: compte.connecte ? null : compte.signinUrl,
	};
}

/** Les quatre lignes, dans l'ORDRE fixe — les deux sources partent en
    parallèle, et on attend les DEUX avant de dessiner : celle qui répond la
    première (Ollama, sous la seconde) ne doit pas faire sauter la liste
    pendant que la plus lente (`etatComptes()`, ~1 s à cause d'Antigravity)
    arrive encore. */
async function lireEtats(): Promise<{ etats: EtatCompte[]; ollamaSigninUrl: string | null }> {
	const [trois, ollama] = await Promise.all([
		requireHost("process").etatComptes(),
		etatOllama(),
	]);
	const parOutil = new Map(trois.map(e => [e.outil, e] as const));
	const etats = ORDRE.map(outil => {
		if (outil === "ollama") return ollama.etat;
		return parOutil.get(outil) ?? { outil, installe: false, connecte: false, email: null, plan: null };
	});
	return { etats, ollamaSigninUrl: ollama.signinUrl };
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
	/** L'adresse de connexion Ollama, retenue depuis le dernier redessin —
	    même rôle que `ollamaSigninUrl` dans `ai.ts` (`demarrerConnexion`) :
	    une carte affichée sans sonde préalable n'aurait pas cette adresse, et
	    le bouton la resonde une fois avant de renoncer (voir `surClicAction`). */
	let ollamaSigninUrl: string | null = null;

	const liste = ajouter(section, "div", "nq-comptes-liste");

	/** Le logo et le nom, communs à la ligne SQUELETTE et à la ligne finale :
	    les deux seules choses connues sans attendre aucune lecture. */
	function poserEntete(ligne: HTMLElement, outil: CliTool): void {
		const icone = ajouter(ligne, "span", "qbd-provider-logo qbd-provider-logo--" + LOGOS[outil]);
		setBrandLogo(icone, LOGOS[outil]);
		const texte = ajouter(ligne, "div", "nq-comptes-texte");
		ajouter(texte, "span", "nq-comptes-nom", nomOutil(outil));
	}

	/** Le SQUELETTE : les quatre lignes, dans l'ordre fixe, avant toute
	    lecture — logo et nom connus tout de suite, un espace réservé à la
	    place de l'adresse et un bouton désactivé à la place de l'action. MÊME
	    STRUCTURE que `poserLigne` (mêmes classes, un bouton de même taille)
	    pour que la hauteur ne saute pas quand les vraies lignes la remplacent. */
	function poserSquelette(): void {
		liste.replaceChildren();
		for (const outil of ORDRE) {
			const ligne = ajouter(liste, "div", "nq-comptes-ligne");
			ligne.dataset.outil = outil;
			poserEntete(ligne, outil);
			const texte = ligne.querySelector<HTMLElement>(".nq-comptes-texte")!;
			ajouter(texte, "span", "nq-comptes-email", t("app.comptes.loading"));
			const bouton = ajouter(ligne, "button", "nq-comptes-action", t("app.comptes.loading"));
			bouton.type = "button";
			bouton.disabled = true;
		}
	}

	/** Une ligne, reconstruite en entier à chaque redessin — quatre lignes ne
	    justifient pas un diff fin, et ça garde ce module au niveau de
	    `fond.ts`, qui fait le même choix pour sa rangée unique. */
	function poserLigne(etat: EtatCompte): void {
		const ligne = ajouter(liste, "div", "nq-comptes-ligne");
		ligne.dataset.outil = etat.outil;
		poserEntete(ligne, etat.outil);
		const texte = ligne.querySelector<HTMLElement>(".nq-comptes-texte")!;

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

	/** Redessine la section entière. NE JETTE JAMAIS : son seul appelant est
	    `void redessiner()` (montage) ou une action sans `catch` — une
	    exception non rattrapée ici deviendrait une rejection non gérée, et la
	    section resterait vide EN PERMANENCE, sans un mot. `etatComptes()` est
	    un appel IPC ; un pont qui refuse REJETTE, ce n'est pas une hypothèse
	    d'école. */
	async function redessiner(): Promise<void> {
		let resultat: { etats: EtatCompte[]; ollamaSigninUrl: string | null };
		try {
			resultat = await lireEtats();
		} catch (e) {
			console.warn(LOG_PREFIX, "lecture des comptes IA impossible:", e);
			if (detruit) return;
			liste.replaceChildren();
			ajouter(liste, "p", "nq-comptes-erreur", t("app.comptes.loadError"));
			return;
		}
		if (detruit) return;
		ollamaSigninUrl = resultat.ollamaSigninUrl;
		liste.replaceChildren();
		for (const etat of resultat.etats) poserLigne(etat);
	}

	async function deconnecter(outil: CliTool): Promise<void> {
		let verdict: "ok" | "echec" | "indisponible";
		try {
			verdict = await requireHost("process").deconnecterCli(outil);
		} catch (e) {
			console.warn(LOG_PREFIX, "déconnexion impossible:", e);
			verdict = "echec";
		}
		if (detruit) return;
		if (verdict !== "ok") {
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
			// DÉSACTIVÉ AVANT D'OUVRIR LA CONFIRMATION, comme les deux autres
			// branches : sans ça, un double-clic rapide empile deux modales de
			// confirmation. Réactivé si l'utilisateur annule — `redessiner()`
			// (donc un bouton refait à neuf) ne suit que la confirmation.
			bouton.disabled = true;
			const name = nomOutil(outil);
			openConfirmModal(
				t("app.comptes.logoutTitle", { name }),
				t("app.comptes.logoutMessage", { name }),
				t("app.comptes.logoutConfirm"),
				t("app.comptes.cancel"),
				(confirme) => {
					if (!confirme) {
						bouton.disabled = false;
						return;
					}
					void deconnecter(outil);
				},
				t("app.comptes.logoutDetail"),
				"log-out",
			);
			return;
		}
		bouton.disabled = true;
		try {
			// OLLAMA N'A PAS DE CLI DE CONNEXION : `connecterCli("ollama")` rend
			// `indisponible` par contrat (pas de compte à connecter par terminal).
			// La vraie connexion ouvre le NAVIGATEUR sur l'adresse que le démon a
			// rendue à sa dernière sonde 401 — même chemin que `demarrerConnexion`
			// dans `dashboard/ai.ts`. Même règle de repli qu'elle : une adresse
			// absente (carte affichée sans sonde préalable) se resonde une fois
			// avant de renoncer.
			if (action === "connecter" && outil === "ollama") {
				if (!ollamaSigninUrl) {
					const compte = await checkOllamaCompte(await lireAiOllamaUrl());
					if (!compte.connecte && compte.signinUrl) ollamaSigninUrl = compte.signinUrl;
				}
				const ouvert = ollamaSigninUrl !== null && await currentHost().shell.openUrl(ollamaSigninUrl);
				if (!ouvert) currentHost().ui.notice(t("app.comptes.connectFailed", { name: nomOutil(outil) }));
				return;
			}
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
		} catch (e) {
			// Un rejet du pont ou du serveur Ollama (panne réseau, IPC refusé) :
			// même message que le verdict `indisponible`, jamais une exception qui
			// remonterait jusqu'au clic et laisserait le bouton figé désactivé.
			console.warn(LOG_PREFIX, "action de compte impossible:", e);
			currentHost().ui.notice(t(
				action === "installer" ? "app.comptes.installFailed" : "app.comptes.connectFailed",
				{ name: nomOutil(outil) },
			));
		} finally {
			if (!detruit) await redessiner();
		}
	}

	poserSquelette();
	void redessiner();

	return () => { detruit = true; };
}
