/* ══════════════════════════════════════════════════════════
   LA COMMANDE D'INSTALLATION D'UN CLI — UNE SEULE SOURCE

   Ce module est PUR : ni DOM, ni Node, ni Obsidian, ni traduction. C'est ce
   qui lui permet d'être lu par les DEUX endroits qui, jusqu'au 2026-09-18,
   portaient chacun leur version de la même commande :

   — `dashboard/ai-install-modal.ts` l'AFFICHE, dans la voie manuelle du modal
     (colorée par jetons, copiable) ;
   — `apps/windows/electron/process.ts` l'EXÉCUTE, dans le terminal que le
     bouton « Installer automatiquement » ouvre.

   POURQUOI CE MODULE EXISTE, et ce que la divergence a coûté. Les deux textes
   étaient VOISINS mais pas identiques : pour Codex, le modal montrait
   `powershell -ExecutionPolicy ByPass -c "irm … | iex"` — la forme officielle,
   un sous-processus — quand le terminal, lui, lançait `irm … | iex` NU dans sa
   propre session. Deux recettes pour une seule chose, donc deux comportements
   possibles : dans la VM de test d'Ahmed, la commande affichée s'installait
   très bien pendant que celle du terminal mourait sur
   « La propriété "OSArchitecture" est introuvable » (2026-09-18). Un défaut
   qu'aucun contrôle ne pouvait voir, puisque les deux textes étaient justes
   chacun de son côté. Maintenant, ce qui est montré est littéralement ce qui
   part.

   CE MODULE NE DONNE AUCUN DROIT AU RENDU. La règle de sécurité du pont est
   inchangée : le rendu n'envoie qu'un NOM d'outil, jugé par `estOutilAutorise`
   dans le processus principal, qui compose ensuite sa ligne LUI-MÊME en
   appelant ces fonctions. À aucun moment une commande ne traverse l'IPC — la
   faire voyager, c'est rendre le pont exécutable depuis la fenêtre.
══════════════════════════════════════════════════════════ */

/** Les trois outils qu'on sait installer. Volontairement ce type et non
    `CliTool` du contrat d'hôte : ce module ne dépend de rien. */
export type OutilInstallable = "claude" | "codex" | "ollama";

/** La commande AFFICHÉE dans la voie manuelle du modal, et celle que le
    terminal exécute. `lang` sert à la coloration du bloc de code.

    Formes officielles, vérifiées le 2026-07-14 (Claude :
    code.claude.com/docs/en/setup ; Codex : learn.chatgpt.com/docs/codex/cli ;
    Ollama : paquet winget officiel). */
export function commandeInstallation(outil: OutilInstallable, windows: boolean): { code: string; lang: string } {
	if (outil === "claude") {
		return windows
			? { code: "irm https://claude.ai/install.ps1 | iex", lang: "powershell" }
			: { code: "curl -fsSL https://claude.ai/install.sh | bash", lang: "bash" };
	}
	if (outil === "codex") {
		return windows
			? { code: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', lang: "powershell" }
			: { code: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", lang: "bash" };
	}
	return windows
		? { code: "winget install --id Ollama.Ollama -e", lang: "powershell" }
		: { code: "curl -fsSL https://ollama.com/install.sh | sh", lang: "bash" };
}

/**
 * La commande telle que le TERMINAL la lance. Identique à celle qui est
 * affichée pour Codex — c'est tout l'intérêt de ce module — et elle ne s'en
 * écarte que de deux façons, chacune écrite ici et éprouvée par
 * `npm run check:electron-process`.
 *
 * L'ÉCART D'OLLAMA. `winget` demande deux accords (source et paquet) à sa
 * PREMIÈRE utilisation, par une invite à laquelle il faut répondre. Un
 * utilisateur qui tape la commande lui-même la voit et répond ; la fenêtre que
 * le bouton ouvre, elle, resterait bloquée sur une question que personne n'a
 * demandée. Les deux drapeaux sont ajoutés ICI et pas dans le texte affiché.
 *
 * L'ÉCART DE CLAUDE (2026-09-19). `install.ps1` fait `exit 1` sur chaque
 * échec (téléchargement, somme de contrôle, `claude install`). Lancé par
 * `irm | iex` DANS la session de la fenêtre, cet `exit` ferme la fenêtre
 * entière, sans un mot — et le script de `process.ts` n'a plus de code de
 * sortie à tester, donc plus de message d'échec à montrer. Dans un
 * SOUS-PROCESSUS, l'`exit` ne tue que lui et devient `$LASTEXITCODE`. C'est
 * la forme officielle de Codex, celle qui s'est installée dans la VM d'Ahmed
 * là où la forme nue mourait. La ligne AFFICHÉE reste la ligne courte de la
 * documentation : celui qui la tape voit lui-même sa fenêtre.
 */
export function commandeInstallationLancee(outil: OutilInstallable, windows: boolean): string {
	const { code } = commandeInstallation(outil, windows);
	if (outil === "ollama" && windows) {
		return code + " --accept-source-agreements --accept-package-agreements";
	}
	if (outil === "claude" && windows) {
		return 'powershell -ExecutionPolicy Bypass -c "' + code + '"';
	}
	return code;
}
