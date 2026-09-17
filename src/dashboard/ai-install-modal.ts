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
import { ajouter } from "../dom";
import { currentHost, requireHost } from "../host/current";
import { t } from "../i18n";
import { renderCollapsibleSection } from "./collapsible";

export type InstallProvider = "claude-code" | "codex" | "ollama";

export interface InstallModalDeps {
	provider: InstallProvider;
	/** La sonde du fournisseur, forcée (sans TTL). */
	probe(): Promise<{ ok: true; version?: string } | { ok: false }>;
	/** Appelé une fois sur détection : la page écrit le fournisseur dans les réglages. */
	onDetected(): Promise<void>;
	/** Appelé à la fermeture, quel que soit l'état : la page rafraîchit statuts et hints. */
	onClose(): void;
	copyText?(texte: string): Promise<boolean>;
	renderCodeBlock?(host: HTMLElement, code: string, lang: string): void;
}

const NOMS: Record<InstallProvider, string> = { "claude-code": "Claude Code", codex: "Codex CLI", ollama: "Ollama" };
const OUTILS: Record<InstallProvider, "claude" | "codex" | "ollama"> = { "claude-code": "claude", codex: "codex", ollama: "ollama" };
const DOCS: Record<InstallProvider, string> = {
	"claude-code": "https://code.claude.com/docs/en/setup",
	codex: "https://learn.chatgpt.com/docs/codex/cli",
	ollama: "https://ollama.com/download",
};
const SONDE_MS = 3000;

/* Commande d'installation par fournisseur, formes officielles vérifiées le
   2026-07-14 (déménagée depuis `ai.ts` : le hint ne montre plus de commande,
   seul ce modal le fait) :
   - Claude Code : installateur natif (code.claude.com/docs/en/setup) ;
   - Codex CLI : installateur officiel (learn.chatgpt.com/docs/codex/cli) ;
   - Ollama : winget (paquet officiel Ollama.Ollama) sur Windows. */
export function installCmd(provider: InstallProvider, isWindows: boolean): { code: string; lang: string } {
	if (provider === "claude-code") {
		return isWindows
			? { code: "irm https://claude.ai/install.ps1 | iex", lang: "powershell" }
			: { code: "curl -fsSL https://claude.ai/install.sh | bash", lang: "bash" };
	}
	if (provider === "codex") {
		return isWindows
			? { code: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', lang: "powershell" }
			: { code: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", lang: "bash" };
	}
	return isWindows
		? { code: "winget install --id Ollama.Ollama -e", lang: "powershell" }
		: { code: "curl -fsSL https://ollama.com/install.sh | sh", lang: "bash" };
}

export function openInstallModal(deps: InstallModalDeps): void {
	const host = currentHost();
	const name = NOMS[deps.provider];
	const win = host.platform.isWindows;
	let sonde: number | null = null;
	const couperSonde = (): void => { if (sonde !== null) { window.clearInterval(sonde); sonde = null; } };

	requireHost("modals").open({
		className: "qbd-install-modal",
		title: t(`ai.install.title.${deps.provider}`),
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
				ajouter(auto, "span", undefined, t("ai.install.auto"));
				ajouter(c, "p", "qbd-install-auto-hint", t("ai.install.autoHint"));
				auto.addEventListener("click", async () => {
					auto.disabled = true;
					const verdict = await host.process!.installerCli(OUTILS[deps.provider]);
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
							m.panelEl.dataset.state = "detecte";
							etat.replaceChildren();
							host.ui.setIcon(ajouter(etat, "span", "qbd-install-check"), "check");
							ajouter(etat, "span", undefined, res.version
								? t("ai.install.detected", { name, version: res.version })
								: t("ai.install.detectedNoVersion", { name }));
							const continuer = ajouter(etat, "button", "qbd-btn--create qbd-install-continue", t("ai.install.continue"));
							continuer.type = "button";
							continuer.addEventListener("click", () => m.close());
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
			else ajouter(ajouter(bloc, "pre"), "code", "language-" + cmd.lang, cmd.code);
			const copier = ajouter(li2, "button", "qbd-btn qbd-install-copy");
			copier.type = "button";
			const copierIcone = ajouter(copier, "span", "qbd-btn-icon qbd-btn-icon--sm");
			host.ui.setIcon(copierIcone, "copy");
			ajouter(copier, "span", undefined, t("ai.install.copy"));
			copier.addEventListener("click", async () => {
				/* Par l'hôte dès qu'il sait copier : dans la fenêtre de l'app,
				   `navigator.clipboard` est refusé par le principal et échouerait
				   en silence — c'est pourquoi `copyText` existe. */
				const ok = deps.copyText
					? await deps.copyText(cmd.code)
					: await navigator.clipboard.writeText(cmd.code).then(() => true, () => false);
				if (!ok) return;
				copierIcone.replaceChildren();
				host.ui.setIcon(copierIcone, "check");
				window.setTimeout(() => { copierIcone.replaceChildren(); host.ui.setIcon(copierIcone, "copy"); }, 1500);
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
			deps.onClose();
		},
	});
}
