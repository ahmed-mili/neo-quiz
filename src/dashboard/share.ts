import { Notice, Platform, TFile, normalizePath, setIcon, setTooltip } from "obsidian";
import { QbdModal } from "../modal-base";
import { t } from "../i18n";
import { reserveFreePath, releaseReservedPath } from "../unique-path";
import type { TransKey } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { ModuleGroup } from "./quiz-modules";
import type { QuizIndexEntry } from "./scanner";
import { QUIZ_BLOCK_RE } from "../quiz-utils";
import { buildZip } from "./zip";
import type { ZipEntry } from "./zip";

/* ══════════════════════════════════════════════════════════
   SHARE — modal « Partager » calqué sur StudySmarter (capture Ahmed
   2026-07-19) : une rangée d'apps. DISCORD (vrai logo Simple Icons) +
   « Enregistrer » en repli. On n'a pas de lien mais un FICHIER (zip d'un
   dossier entier, ou .md d'un quiz seul) : aucune app ne permet de joindre
   un fichier à un message par automatisation, donc le maximum faisable
   (choix Ahmed) = le COPIER dans le presse-papier (Windows) et amener
   Discord au premier plan ; l'utilisateur fait Ctrl+V + Entrée. Desktop
   Windows ; dégrade ailleurs (partage natif / enregistrement), jamais de
   blocage.
══════════════════════════════════════════════════════════ */

/** Logo Discord — Simple Icons (path unique, fill), couleur de marque blurple. */
const DISCORD_PATH = "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z";

function fillIcon(parent: HTMLElement, path: string): void {
	const NS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "currentColor");
	const p = document.createElementNS(NS, "path");
	p.setAttribute("d", path);
	svg.appendChild(p);
	parent.appendChild(svg);
}

/* ── Sources de partage : dossier (zip) ou quiz seul (.md) ── */

/** Fichier prêt à partager, nom déjà assaini. */
interface SharePayload {
	fileName: string;
	bytes: Uint8Array;
	/** MIME du partage natif mobile. */
	mime: string;
}

/** Ce que le modal doit savoir : son titre + comment produire le fichier. */
export interface ShareSource {
	titleKey: TransKey;
	build(): Promise<SharePayload | null>;
}

function sanitizeBase(name: string, fallback: string): string {
	return (name || fallback).replace(/[\\/:*?"<>|]/g, "-").trim() || fallback;
}

/** Dossier entier → zip de ses notes (null si aucun quiz lisible). */
export function moduleShareSource(ctx: DashboardCtx, group: ModuleGroup): ShareSource {
	return {
		titleKey: "dashboard.quizzes.shareTitle",
		async build() {
			const entries: ZipEntry[] = [];
			for (const q of group.quizzes) {
				const file = ctx.app.vault.getAbstractFileByPath(q.path);
				if (file instanceof TFile) entries.push({ name: file.name, content: await ctx.app.vault.read(file) });
			}
			if (entries.length === 0) { new Notice(t("dashboard.detail.fileNotFound")); return null; }
			return { fileName: `${sanitizeBase(group.name, "quizzes")}.zip`, bytes: buildZip(entries), mime: "application/zip" };
		},
	};
}

/** Quiz seul → note .md réduite à son bloc ```quiz-blocks``` (importable telle
    quelle : le destinataire la dépose dans son vault ou passe par « Import »). */
export function quizShareSource(ctx: DashboardCtx, quiz: QuizIndexEntry): ShareSource {
	return {
		titleKey: "dashboard.quizzes.shareQuizTitle",
		async build() {
			const file = ctx.app.vault.getAbstractFileByPath(quiz.path);
			if (!file || !(file instanceof TFile)) { new Notice(t("dashboard.detail.fileNotFound")); return null; }
			const content = await ctx.app.vault.read(file);
			const match = content.match(QUIZ_BLOCK_RE);
			if (!match) { new Notice(t("dashboard.detail.noBlockInNote")); return null; }
			const md = match[0].replace(/\r\n/g, "\n") + "\n";
			return { fileName: `${sanitizeBase(quiz.title, "quiz")}.md`, bytes: new TextEncoder().encode(md), mime: "text/markdown" };
		},
	};
}

/* ── « Enregistrer » : Téléchargements (desktop, révélé) / racine (mobile). ── */

async function saveShared(ctx: DashboardCtx, source: ShareSource): Promise<void> {
	try {
		await saveSharedInner(ctx, source);
	} catch (e) {
		/* Appelé en `void` depuis un gestionnaire de clic : un rejet n'y remonte
		   NULLE PART, et l'utilisateur voyait la fenêtre se fermer sans fichier
		   ni message. */
		console.error("[quiz-blocks] enregistrement du partage impossible :", e);
		new Notice(t("dashboard.quizzes.shareSaveError"));
	}
}

async function saveSharedInner(ctx: DashboardCtx, source: ShareSource): Promise<void> {
	const payload = await source.build();
	if (!payload) return;
	/* Un fichier du MÊME nom ne se fait pas écraser : sur mobile la
	   destination est la RACINE DU VAULT, et un quiz partagé pouvait y
	   remplacer une note de l'utilisateur sans un mot (revue codex
	   2026-07-31). On suffixe jusqu'à trouver un nom libre, comme le fait
	   n'importe quel téléchargement. */
	const pointExt = payload.fileName.lastIndexOf(".");
	const base = pointExt > 0 ? payload.fileName.slice(0, pointExt) : payload.fileName;
	const ext = pointExt > 0 ? payload.fileName.slice(pointExt) : "";

	if (Platform.isDesktopApp) {
		const fs = require("fs") as typeof import("fs");
		const path = require("path") as typeof import("path");
		const os = require("os") as typeof import("os");
		const dossier = path.join(os.homedir(), "Downloads");
		const dest = await reserveFreePath(path.join(dossier, base), ext,
			async (c) => fs.existsSync(c), (n) => ` (${n})`);
		try {
			fs.writeFileSync(dest, payload.bytes);
		} catch (e) { releaseReservedPath(dest); throw e; }
		(require("electron") as { shell: { showItemInFolder(p: string): void } }).shell.showItemInFolder(dest);
		new Notice(t("dashboard.quizzes.fileSaved", { path: dest }));
	} else {
		const dest = await reserveFreePath(normalizePath(base), ext,
			(c) => ctx.app.vault.adapter.exists(c), (n) => ` (${n})`);
		try {
			await ctx.app.vault.adapter.writeBinary(dest, payload.bytes.buffer as ArrayBuffer);
		} catch (e) { releaseReservedPath(dest); throw e; }
		new Notice(t("dashboard.quizzes.fileSaved", { path: dest }));
	}
}

/* ── Activation de Discord (Windows) — architecture à 3 couches, chacune
   MESURÉE le 2026-07-19 (GetForegroundWindow + luminance PrintWindow) :
   1. SIGNAL single-instance (raccourci Start Menu, sinon Update.exe) : quand
      Discord TOURNE, c'est la seule voie qui lui fait faire son propre
      raise + focus + REPAINT. Sans elle, une activation externe met la
      fenêtre au premier plan mais NOIRE (renderer suspendu, luma=0 mesuré) —
      le symptôme « fenêtre noire » d'Ahmed. AllowSetForegroundWindow lui
      transfère au préalable notre droit de focus (hérité d'Obsidian, le
      process au premier plan au moment du clic) pour que son focus() interne
      soit accepté.
   2. RESTAURATION externe (SW_RESTORE/SW_SHOW) : uniquement si la fenêtre
      est cachée (tray) ou iconique — mesuré : le signal seul ne ré-affiche
      PAS une fenêtre cachée dans le tray. Jamais de SW_RESTORE sur une
      fenêtre visible (ça dé-maximiserait).
   3. ESCALADE de focus en FILET (direct → Alt simulé → AttachThreadInput →
      SwitchToThisWindow) : ne sert que si, après le signal, Discord n'est
      toujours pas au premier plan (restriction de focus).
   Discord FERMÉ → le signal le lance (comme un clic sur le raccourci), la
   boucle d'attente attrape la fenêtre principale au démarrage en filtrant le
   SPLASH « Discord Updater » (même classe Chrome_WidgetWin_1, ~300 px). Tout
   le Win32 vit en C# compilé (Add-Type, fiable PowerShell 5.1 et 7), script
   passé en -EncodedCommand : aucun escaping shell. */

function buildDiscordScript(dest: string): string {
	const destPs = dest.replace(/'/g, "''");
	return `$ErrorActionPreference = 'SilentlyContinue'
Set-Clipboard -LiteralPath '${destPs}'
$lnk = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Discord Inc\\Discord.lnk'
$up = Join-Path $env:LOCALAPPDATA 'Discord\\Update.exe'
function Send-DiscordSignal {
	if (Test-Path $lnk) { Invoke-Item $lnk }
	elseif (Test-Path $up) { Start-Process $up -ArgumentList '--processStart','Discord.exe' }
	else { try { Start-Process 'discord://' } catch { Start-Process 'https://discord.com/channels/@me' } }
}
$wasRunning = [bool](Get-Process Discord -ErrorAction SilentlyContinue)
if (-not $wasRunning) { Send-DiscordSignal }
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
namespace QuizBlocks {
	public static class DiscordFocus {
		delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
		[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
		[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
		[DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
		[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
		[DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
		[DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
		[DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
		[DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
		[DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool alt);
		[DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
		[DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
		[DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
		[DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(uint pid);
		[DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
		[StructLayout(LayoutKind.Sequential)] struct RECT { public int L; public int T; public int R; public int B; }
		[DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
		public static IntPtr FindMain() {
			var pids = new System.Collections.Generic.HashSet<int>();
			foreach (var p in Process.GetProcessesByName("Discord")) pids.Add(p.Id);
			if (pids.Count == 0) return IntPtr.Zero;
			IntPtr found = IntPtr.Zero;
			EnumWindows(delegate(IntPtr h, IntPtr l) {
				uint pid; GetWindowThreadProcessId(h, out pid);
				if (!pids.Contains((int)pid)) return true;
				var c = new StringBuilder(64); GetClassName(h, c, 64);
				if (c.ToString() != "Chrome_WidgetWin_1") return true;
				if (!IsIconic(h)) {
					RECT r; GetWindowRect(h, out r);
					if (r.R - r.L < 500) return true;
				}
				found = h; return false;
			}, IntPtr.Zero);
			return found;
		}
		public static void AllowFor(IntPtr h) {
			uint pid; GetWindowThreadProcessId(h, out pid);
			if (pid != 0) AllowSetForegroundWindow(pid);
		}
		public static void RestoreIfHidden(IntPtr h) {
			if (IsIconic(h)) ShowWindow(h, 9);
			else if (!IsWindowVisible(h)) ShowWindow(h, 5);
		}
		public static void EnsureFront(IntPtr h) {
			if (Try(h)) return;
			keybd_event(0x12, 0, 0, UIntPtr.Zero);
			keybd_event(0x12, 0, 2, UIntPtr.Zero);
			if (Try(h)) return;
			IntPtr fg = GetForegroundWindow();
			if (fg != IntPtr.Zero) {
				uint pid; uint fgT = GetWindowThreadProcessId(fg, out pid);
				uint curT = GetCurrentThreadId();
				if (fgT != 0 && fgT != curT) {
					AttachThreadInput(curT, fgT, true);
					BringWindowToTop(h);
					SetForegroundWindow(h);
					AttachThreadInput(curT, fgT, false);
					System.Threading.Thread.Sleep(60);
					if (GetForegroundWindow() == h) return;
				}
			}
			SwitchToThisWindow(h, true);
		}
		static bool Try(IntPtr h) {
			SetForegroundWindow(h);
			System.Threading.Thread.Sleep(60);
			return GetForegroundWindow() == h;
		}
	}
}
'@
$deadline = (Get-Date).AddSeconds(20)
$h = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
	$h = [QuizBlocks.DiscordFocus]::FindMain()
	if ($h -ne [IntPtr]::Zero) { break }
	Start-Sleep -Milliseconds 150
}
if ($h -ne [IntPtr]::Zero) {
	[QuizBlocks.DiscordFocus]::AllowFor($h)
	[QuizBlocks.DiscordFocus]::RestoreIfHidden($h)
	if ($wasRunning) { Send-DiscordSignal; Start-Sleep -Milliseconds 1200 }
	[QuizBlocks.DiscordFocus]::EnsureFront($h)
}
`;
}

/* ── Partage. PRIORITÉ au partage NATIF du système (`navigator.share` avec
   fichier) : sur mobile il ouvre la feuille « Partager avec » → l'utilisateur
   choisit Discord. Cette API est ABSENTE d'Obsidian desktop (Electron ne
   l'expose pas, vérifié) → repli desktop = presse-papier + Discord au premier
   plan (Ctrl+V + Entrée). Dernier repli : enregistrer le fichier. ── */

async function shareViaDiscord(ctx: DashboardCtx, source: ShareSource): Promise<boolean> {
	try {
		// `false` quand RIEN n'a été envoyé (quiz introuvable, construction
		// abandonnée) : la fenêtre ne doit pas afficher « Copié » pour ça.
		return await shareViaDiscordInner(ctx, source);
	} catch (e) {
		// Appelé en `void` depuis un gestionnaire de clic : sans ce filet, un
		// échec fermait la fenêtre sans rien envoyer ni rien dire.
		console.error("[quiz-blocks] partage Discord impossible :", e);
		new Notice(t("dashboard.quizzes.shareSaveError"));
		return false;
	}
}

async function shareViaDiscordInner(ctx: DashboardCtx, source: ShareSource): Promise<boolean> {
	const payload = await source.build();
	if (!payload) return false;

	// 1. Partage natif du système (mobile) — l'expérience « Partager avec ».
	const file = new File([payload.bytes as BlobPart], payload.fileName, { type: payload.mime });
	const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean; share?: (d: unknown) => Promise<void> };
	if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
		try { await nav.share({ files: [file], title: payload.fileName }); } catch { /* annulé par l'utilisateur */ }
		// Le partage natif dit lui-même ce qu'il a fait : pas de « Copié » du
		// plugin par-dessus.
		return false;
	}

	// 2. Desktop : fichier → presse-papier + Discord au premier plan (script
	//    asynchrone, fenêtre cachée — la Notice part tout de suite).
	if (Platform.isDesktopApp) {
		const fs = require("fs") as typeof import("fs");
		const path = require("path") as typeof import("path");
		const os = require("os") as typeof import("os");
		const cp = require("child_process") as typeof import("child_process");
		/* Un nom LIBRE, même dans le dossier temporaire : partager deux quiz
		   homonymes coup sur coup écrasait le fichier que le presse-papiers du
		   PREMIER référence encore, et Discord envoyait alors deux fois le
		   second (revue codex 2026-07-31). */
		const pointExtTmp = payload.fileName.lastIndexOf(".");
		const baseTmp = pointExtTmp > 0 ? payload.fileName.slice(0, pointExtTmp) : payload.fileName;
		const extTmp = pointExtTmp > 0 ? payload.fileName.slice(pointExtTmp) : "";
		/* Suffixe TIRÉ AU SORT et non incrémenté : le fichier temporaire n'est
		   jamais nettoyé (Discord le lit après coup), donc une session qui
		   partage cinquante fois le même quiz épuisait la suite « (2)…(50) »
		   et finissait par lever. Le hasard, lui, ne s'épuise pas. */
		const dest = await reserveFreePath(path.join(os.tmpdir(), baseTmp), extTmp,
			async (c) => fs.existsSync(c), () => `-${Math.random().toString(36).slice(2, 7)}`);
		try {
			fs.writeFileSync(dest, payload.bytes);
		} catch (e) { releaseReservedPath(dest); throw e; }
		try {
			const encoded = Buffer.from(buildDiscordScript(dest), "utf16le").toString("base64");
			cp.execFile("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], { windowsHide: true }, () => { /* fire-and-forget */ });
		} catch { /* pas Windows / PowerShell indispo */ }
		new Notice(t("dashboard.quizzes.discordReady"));
		return true;
	}

	// 3. Repli ultime : enregistrer le fichier — qui affiche sa propre Notice.
	await saveShared(ctx, source);
	return false;
}

export class ShareModal extends QbdModal {
	constructor(private ctx: DashboardCtx, private source: ShareSource) {
		super(ctx.app);
	}

	onOpen(): void {
		this.modalEl.addClass("qbd-share-modal");
		this.titleEl.setText(t(this.source.titleKey));
		const c = this.contentEl;
		c.createEl("p", { cls: "qbd-share-hint", text: t("dashboard.quizzes.shareHint") });
		const row = c.createDiv({ cls: "qbd-share-apps" });
		// Ligne de feedback (vide au repos), remplie au clic Discord (desktop).
		const feedback = c.createDiv({ cls: "qbd-share-feedback" });

		// ── Discord ──
		const discord = row.createEl("button", { cls: "qbd-share-app qbd-share-app--discord" });
		discord.type = "button";
		const dIcon = discord.createDiv({ cls: "qbd-share-app-icon" });
		fillIcon(dIcon, DISCORD_PATH);
		// Desktop = presse-papier (Discord ne prend pas le fichier directement,
		// exactement comme la feuille Windows) : badge « copie » + infobulle au
		// survol pour l'annoncer, comme StudySmarter/Windows mais thémé.
		if (Platform.isDesktopApp) {
			const badge = dIcon.createDiv({ cls: "qbd-share-app-badge" });
			setIcon(badge, "copy");
			setTooltip(discord, t("dashboard.quizzes.shareCopyHint"));
		}
		discord.createSpan({ cls: "qbd-share-app-label", text: "Discord" });
		discord.addEventListener("click", () => {
			/* La confirmation ATTEND le résultat : l'afficher avant faisait
			   cohabiter un « Copié » vert et le message d'échec qui suivait
			   (revue codex 2026-07-31). `shareViaDiscord` attrape déjà tout et
			   prévient lui-même — ici on ne fête que ce qui a marché. */
			void shareViaDiscord(this.ctx, this.source).then((ok) => {
			if (ok === false) return;
			if (Platform.isDesktopApp) {
				// Confirmation « copié » : le badge passe au vert (is-copied) + une
				// ligne message sous les apps, puis fermeture douce.
				discord.addClass("is-copied");
				setIcon(dIcon.querySelector(".qbd-share-app-badge") as HTMLElement, "check");
				feedback.empty();
				const fi = feedback.createSpan({ cls: "qbd-share-feedback-icon" });
				setIcon(fi, "check");
				feedback.createSpan({ text: t("dashboard.quizzes.shareCopiedToast") });
				feedback.addClass("is-visible");
				window.setTimeout(() => this.close(), 2600);
			} else {
				this.close();
			}
			});
		});

		// ── Enregistrer le fichier ──
		const save = row.createEl("button", { cls: "qbd-share-app" });
		save.type = "button";
		const sIcon = save.createDiv({ cls: "qbd-share-app-icon" });
		setIcon(sIcon, "download");
		save.createSpan({ cls: "qbd-share-app-label", text: t("dashboard.quizzes.shareSave") });
		save.addEventListener("click", () => { this.close(); void saveShared(this.ctx, this.source); });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
