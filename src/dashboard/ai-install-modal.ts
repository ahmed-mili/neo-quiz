/* ══════════════════════════════════════════════════════════
   LE MODAL D'UN FOURNISSEUR ABSENT — ET L'INSTALLATION EN UN CLIC

   Spec « utilisable par n'importe qui » (2026-09-17, § 3b). L'utilisateur ne
   sait pas ce qu'est un terminal : le modal dit ce qu'est l'outil en une
   phrase, propose de l'installer AUTOMATIQUEMENT (l'hôte ouvre PowerShell
   avec la recette officielle, `HostProcess.installerCli`), et garde, repliée,
   la voie manuelle en quatre étapes pour qui la préfère — ou pour un hôte
   qui ne sait pas ouvrir de terminal.

   Trois états : `initial`, `en-cours` (le terminal est parti, la sonde du
   fournisseur tourne toutes les 3 s), `detecte` (la page a écrit le
   fournisseur dans les réglages, « Continuer » ferme). La sonde est coupée
   à la fermeture ET à la détection : jamais un minuteur orphelin.
══════════════════════════════════════════════════════════ */
import { LOG_PREFIX } from "../branding";
import { getProvider, setBrandLogo } from "./ai-providers";
import { commandeInstallation } from "../cli-install-cmd";
import { ajouter } from "../dom";
import { currentHost, requireHost } from "../host/current";
import { t } from "../i18n";
import { renderCollapsibleSection } from "./collapsible";

export type InstallProvider = "claude-code" | "codex" | "ollama" | "antigravity-cli";

export interface InstallModalDeps {
	provider: InstallProvider;
	/** La sonde du fournisseur, forcée (sans TTL). */
	probe(): Promise<{ ok: true; version?: string } | { ok: false }>;
	/** Appelé une fois sur détection : la page écrit le fournisseur dans les réglages. */
	onDetected(): Promise<void>;
	/** Appelé à la fermeture, quel que soit l'état : la page rafraîchit statuts et
	    hints. `detecte` dit si la fermeture suit une DÉTECTION (le terminal a
	    fini) plutôt qu'un abandon — la page s'en sert pour enchaîner sur la
	    connexion sans attendre un clic de plus. */
	onClose(detecte: boolean): void;
	copyText?(texte: string): Promise<boolean>;
	renderCodeBlock?(host: HTMLElement, code: string, lang: string): void;
}

const NOMS: Record<InstallProvider, string> = { "claude-code": "Claude Code", codex: "Codex CLI", ollama: "Ollama", "antigravity-cli": "Antigravity CLI" };
const OUTILS: Record<InstallProvider, "claude" | "codex" | "ollama" | "agy"> = { "claude-code": "claude", codex: "codex", ollama: "ollama", "antigravity-cli": "agy" };
const DOCS: Record<InstallProvider, string> = {
	"claude-code": "https://code.claude.com/docs/en/setup",
	codex: "https://learn.chatgpt.com/docs/codex/cli",
	ollama: "https://ollama.com/download",
	"antigravity-cli": "https://antigravity.google/docs/cli/install/",
};
const SONDE_MS = 3000;

/* La commande elle-même vit dans `src/cli-install-cmd.ts`, PARTAGÉE avec le
   processus principal qui l'exécute : ce qui est montré ici est littéralement
   ce que le bouton « Installer automatiquement » lance. Voir l'en-tête de ce
   module pour ce que la divergence d'avant a coûté. */
/* Coloration d'une ligne de shell SANS colorateur embarqué : les commandes
   du modal sont trois lignes connues (irm, curl, winget), pas du code
   arbitraire — une grammaire à quatre jetons suffit (chaîne "…", drapeau
   -x/--xx, tube |, le reste étant la commande en tête de segment). Chaque
   jeton est un span, le texte passe par textContent : rien n'est interprété. */
export function colorerCommande(code: HTMLElement, ligne: string): void {
	const re = /"[^"]*"|\|| +|[^\s"|]+/g;
	let debutSegment = true;
	for (const m of ligne.match(re) || []) {
		let cls: string | undefined;
		if (m.startsWith('"')) cls = "qbd-tok-string";
		else if (m === "|") { cls = "qbd-tok-pipe"; debutSegment = true; }
		else if (m.trim() === "") cls = undefined;
		else if (m.startsWith("-")) cls = "qbd-tok-flag";
		else if (debutSegment) { cls = "qbd-tok-cmd"; debutSegment = false; }
		else if (/^https?:\/\//.test(m)) cls = "qbd-tok-url";
		if (cls) ajouter(code, "span", cls, m);
		else code.appendChild(document.createTextNode(m));
		if (m.startsWith('"')) {
			// Une chaîne contient elle-même une commande (irm … | iex) : on
			// la colore à son tour, mais dans un span de chaîne.
			const inner = code.lastElementChild as HTMLElement;
			inner.textContent = "";
			inner.appendChild(document.createTextNode('"'));
			colorerCommande(inner, m.slice(1, -1));
			inner.appendChild(document.createTextNode('"'));
		}
	}
}

export function installCmd(provider: InstallProvider, isWindows: boolean): { code: string; lang: string } {
	return commandeInstallation(OUTILS[provider], isWindows);
}

export function openInstallModal(deps: InstallModalDeps): void {
	const host = currentHost();
	const name = NOMS[deps.provider];
	const win = host.platform.isWindows;
	let sonde: number | null = null;
	const couperSonde = (): void => { if (sonde !== null) { window.clearInterval(sonde); sonde = null; } };
	// Posé à `true` UNIQUEMENT à la détection réelle (pas à une fermeture
	// prématurée par la croix) : c'est ce que `onClose` transmet à la page.
	let detecte = false;

	/* Le LOGO DE MARQUE dans la ligne du titre (2026-09-18) : coloré, sans
	   pastille ni contour. Le fournisseur et sa couleur viennent du catalogue
	   partagé (`ai-providers.ts`), le même que celui du menu — une seconde
	   table aurait fini par en diverger. */
	const marque = getProvider(deps.provider);
	requireHost("modals").open({
		className: "qbd-install-modal",
		title: t(`ai.install.title.${deps.provider}`),
		titleIcon: (el) => {
			setBrandLogo(el, marque.logo);
			el.style.color = marque.couleur;
		},
		onOpen: (m) => {
			const c = m.contentEl;
			m.panelEl.dataset.state = "initial";
			ajouter(c, "p", "qbd-install-what", t(`ai.install.what.${deps.provider}`));

			/* L'état « en cours » / « détecté » vit dans cette zone ; le bouton
			   automatique n'existe que là où l'hôte sait ouvrir un terminal. */
			const etat = ajouter(c, "div", "qbd-install-state");
			let manuelOuvert: (() => void) | null = null;

			if (win && host.process) {
				const auto = ajouter(c, "button", "qbd-btn--create qbd-install-auto");
				auto.type = "button";
				host.ui.setIcon(ajouter(auto, "span", "qbd-btn-icon"), "download");
				/* PLUS de phrase sous le bouton (2026-09-18) : la confirmation
				   NATIVE que l'hôte ouvre juste après disait déjà les deux
				   mêmes choses — « Neo Quiz va ouvrir PowerShell et y lancer
				   l'installation officielle de X » et « vous verrez tout ce que
				   fait l'installateur » (`app.installCli.message` et
				   `.detail`). La lire deux fois à deux secondes d'intervalle ne
				   rassurait pas, ça encombrait. */
				ajouter(auto, "span", undefined, t("ai.install.auto"));
				auto.addEventListener("click", async () => {
					auto.disabled = true;
					/* Un rejet du pont (outil hors liste blanche, panne de l'IPC) laissait
					   jusqu'ici le bouton inactif sans un mot : on le traite comme le
					   verdict « indisponible ». */
					let verdict: "lance" | "annule" | "indisponible";
					try {
						verdict = await host.process!.installerCli(OUTILS[deps.provider]);
					} catch (e) {
						console.warn(LOG_PREFIX, "installation impossible:", e);
						auto.disabled = false;
						host.ui.notice(t("ai.install.terminalFailed"));
						manuelOuvert?.();
						return;
					}
					if (verdict === "annule") { auto.disabled = false; return; }
					if (verdict === "indisponible") {
						auto.disabled = false;
						host.ui.notice(t("ai.install.terminalFailed"));
						manuelOuvert?.();
						return;
					}
					m.panelEl.dataset.state = "en-cours";
					etat.replaceChildren();
					ajouter(etat, "span", "qbd-install-spinner");
					ajouter(etat, "span", undefined, t("ai.install.running"));
					sonde = window.setInterval(() => {
						void deps.probe().then(async (res) => {
							if (!res.ok || sonde === null) return;
							couperSonde();
							await deps.onDetected();
							detecte = true;
							/* LE TERMINAL N'A PAS FINI quand le binaire apparaît : il
							   enchaîne la CONNEXION du compte (navigateur, contrôle,
							   compte à rebours). Le modal le dit et attend sa fin — un
							   modal qui disparaissait pendant la connexion laissait
							   croire qu'elle n'avait pas eu lieu (Ahmed, 2026-09-20 :
							   « il s'est fermé trop vite »). Un hôte sans ce membre (le
							   greffon) passe directement à la coche. */
							if (host.process?.attendreFinTerminal) {
								m.panelEl.dataset.state = "connexion";
								etat.replaceChildren();
								ajouter(etat, "span", "qbd-install-spinner");
								ajouter(etat, "span", undefined, t("ai.install.connecting", { name }));
								await host.process.attendreFinTerminal().catch(() => { /* la coche quand même */ });
								if (!m.panelEl.isConnected) return;
							}
							m.panelEl.dataset.state = "detecte";
							etat.replaceChildren();
							host.ui.setIcon(ajouter(etat, "span", "qbd-install-check"), "check");
							ajouter(etat, "span", undefined, res.version
								? t("ai.install.detected", { name, version: res.version })
								: t("ai.install.detectedNoVersion", { name }));
							/* Le modal se ferme SEUL, une seconde et demie après la coche
							   (demande d'Ahmed, 2026-09-19) : l'utilisateur l'a ouvert
							   pour UTILISER cet outil, pas pour cliquer « Continuer ».
							   La page reprend aussitôt — fournisseur choisi, compte déjà
							   connecté par le terminal. */
							window.setTimeout(() => m.close(), 1500);
						});
					}, SONDE_MS);
				});
			}

			/* La voie manuelle : repliée sous Windows (le bouton fait le travail),
			   ouverte et seule ailleurs. `renderCollapsibleSection` veut un état de
			   repli ; ici il est local au modal, jamais persisté.

			   `defaultOpen: false` — jamais `ouvert` : `wireCollapseToggle` calcule
			   `collapsed = defaultOpen ? isExpanded(key) : !isExpanded(key)`.
			   Avec `isExpanded: () => ouvert` (true = ouvert), passer `ouvert` ici
			   inverserait la lecture ; `false` donne `collapsed = !ouvert`, ce
			   qu'on veut. */
			let ouvert = !(win && host.process);
			const corps = renderCollapsibleSection(
				{ isExpanded: () => ouvert, toggleExpanded: () => { ouvert = !ouvert; } },
				c, "install-manual", t("ai.install.manual"), 4, { defaultOpen: false, rowClass: "qbd-install-manual-row" },
			);
			manuelOuvert = () => {
				if (ouvert) return;
				(c.querySelector(".qbd-install-manual-row .qbd-quizzes-node-head") as HTMLButtonElement | null)?.click();
			};
			const etapes = ajouter(corps, "ol", "qbd-install-steps");
			ajouter(etapes, "li", undefined, t(win ? "ai.install.step1" : "ai.install.step1Unix"));
			const li2 = ajouter(etapes, "li", undefined, t("ai.install.step2"));
			const cmd = installCmd(deps.provider, win);
			const bloc = ajouter(li2, "div", "qbd-install-code markdown-rendered markdown-preview-view");
			if (deps.renderCodeBlock) deps.renderCodeBlock(bloc, cmd.code, cmd.lang);
			else colorerCommande(ajouter(ajouter(bloc, "pre"), "code", "language-" + cmd.lang), cmd.code);
			/* DANS le bloc, en haut à droite, et révélé au survol : le geste
			   d'Obsidian et de tous les blocs de code qu'on connaît. Sous le
			   bloc, il chevauchait son icône et son libellé débordait — une
			   largeur d'`inline-block` trop courte pour son contenu. Ici il est
			   positionné, donc sa taille ne contraint plus rien. */
			const copier = ajouter(bloc, "button", "qbd-btn qbd-install-copy");
			copier.type = "button";
			const copierIcone = ajouter(copier, "span", "qbd-btn-icon qbd-btn-icon--sm");
			host.ui.setIcon(copierIcone, "copy");
			/* L ICONE SEULE : le mot doublait un pictogramme que tout le monde
			   connaît, dans un coin où la place est comptée. Le libellé survit HORS
			   ECRAN — un bouton sans nom accessible est muet pour un lecteur
			   d écran — et c est lui qui dit « Copié » après le clic. */
			const copierTexte = ajouter(copier, "span", "qbd-sr-only", t("ai.install.copy"));
			copier.addEventListener("click", async () => {
				/* Par l'hôte dès qu'il sait copier : dans la fenêtre de l'app,
				   `navigator.clipboard` est refusé par le principal et échouerait
				   en silence — c'est pourquoi `copyText` existe. */
				const ok = deps.copyText
					? await deps.copyText(cmd.code)
					: await navigator.clipboard.writeText(cmd.code).then(() => true, () => false);
				if (!ok) return;
				/* La confirmation porte sur les DEUX : l'icône seule changeait
				   pendant que le mot « Copier » restait, ce qui se lit comme une
				   invitation à recliquer. Le bouton reste visible tant qu'elle
				   dure (`data-copie`), même si la souris a quitté le bloc. */
				copierIcone.replaceChildren();
				host.ui.setIcon(copierIcone, "check");
				copierTexte.textContent = t("ai.install.copied");
				copier.dataset.copie = "1";
				window.setTimeout(() => {
					copierIcone.replaceChildren();
					host.ui.setIcon(copierIcone, "copy");
					copierTexte.textContent = t("ai.install.copy");
					delete copier.dataset.copie;
				}, 1500);
			});
			ajouter(etapes, "li", undefined, t(`ai.install.step3.${deps.provider}`));
			ajouter(etapes, "li", undefined, t("ai.install.step4"));

			const lien = ajouter(c, "a", "qbd-install-learn", t("ai.install.learnMore"));
			lien.href = DOCS[deps.provider];
			lien.target = "_blank";
			lien.rel = "noopener";
		},
		onClose: () => {
			couperSonde();
			deps.onClose(detecte);
		},
	});
}
