# Changelog

All notable changes to the Neo Quiz desktop app are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the version numbers follow [Semantic Versioning](https://semver.org/):
a **major** version breaks something you rely on (quiz format, review log,
settings location), a **minor** version adds or changes something you can
see, a **patch** version only fixes what a previous version already promised.

`git ship` reads the `[Unreleased]` section to pick the next number, and
refuses to ship when it is empty. Each GitHub release carries its section as
release notes.

## [Unreleased]

### Fixed
- In the provider menu, only the "Install" button opens the install dialog, and it lights up only when you hover it, not the whole line.
- The "Waiting for sign-in" screen is centered like the rest of the Generate page, instead of stuck to the left. Once the account is connected it says "Account connected." and no longer "Sending your request again…" when there was no request to send.

## [1.8.0] - 2026-09-19

### Changed
- In the provider menu, a provider that is not installed shows an "Install" button instead of a red dot. It opens the install dialog, where you can install automatically or follow the manual steps.

### Fixed
- Once your account is connected, Neo Quiz comes back to the front, ready to generate. While it waits for you to sign in, it no longer also shows "not connected" under the composer before noticing the sign-in.
- Installing Codex automatically no longer stops on "Start Codex now? [y/N]": the window goes straight on to signing you in.
- After "Install automatically", the dialog closes by itself once the tool is detected, and the tool you installed becomes the selected provider as soon as your account is connected. You install Claude Code, Codex or Ollama to use it: no extra click to pick it afterwards.
- On a free Ollama account, the model menu now lists only the cloud models your account includes; paid ones move to "More models", with a Pro badge and an Upgrade link. Neo Quiz finds out which is which by asking Ollama for each model, without generating anything or using your included usage.

## [1.7.0] - 2026-09-19

### Added
- Neo Quiz now checks that your account is connected as soon as you pick a provider, and again when you come back to the window, instead of waiting for your first quiz to fail. When it is not, a notice under the composer offers "Sign in": a terminal for Claude Code and Codex, your browser for Ollama (cloud models need an Ollama account; no command to type).
- On a free Ollama account, cloud models that need a paid plan carry a "Pro" badge and an "Upgrade" link in the model menu, like claude.ai does. Neo Quiz learns which ones from Ollama's own recommendations and from the models it has already been refused.

### Changed
- "The Codex CLI is not installed" reads "Codex CLI is not installed".
- The note about the red warning that claude.ai shows above a question sent from Neo Quiz now appears once, in a dialog when you pick claude.ai in the provider menu, with a "Don't show this again" box, instead of on every waiting card. It uses claude.ai's own colors so you recognize the banner there.
- While Neo Quiz waits for the answer from claude.ai, it now shows a small centered dialog instead of a full-width card: one sentence ("Send the prompt on claude.ai, then copy the answer"), a single "Reopen claude.ai" button, and waves around the icon instead of the generation shimmer, since nothing is being generated here. Closing the dialog cancels the wait; its close button turns red and says "Cancel" on hover. Your request no longer shows as a sent message bubble for a website, only for providers that generate inside Neo Quiz.

### Fixed
- The PowerShell window that installs or signs in to Claude Code or Codex now finds the tool it just installed (it looks in the same folders Neo Quiz does), only says "connected" when the sign-in actually succeeded, and closes by itself two seconds later. When something fails, the window stays open with the error instead of a false success message.
- With a free Ollama account, picking a model that needs a paid plan now says so in plain words, with an "Upgrade" button, instead of a generic HTTP 402 error. Neo Quiz remembers it and marks that model in the menu next time.
- Switching provider while "Waiting for sign-in" was shown left that card on screen, still watching the previous tool. It is dismissed now.
- Right after "Install automatically" finishes, the page waits for the sign-in that the same window is already asking for, instead of leaving you to discover it at the first quiz.
- The cloud icons in the Ollama model menu line up in one column again.

## [1.6.0] - 2026-09-18

### Added
- Generate with claude.ai, from the provider menu: the site opens with your question already typed in, you send it and copy the answer, and the quiz is created in Neo Quiz on its own. The menu now lists one line per brand (Claude, ChatGPT, Perplexity, Ollama) and lets you pick the channel, the CLI on your machine or the website, on a second level. chatgpt.com and perplexity.ai are listed but not wired up yet.

### Changed
- `NeoQuiz-X.Y.Z.exe` now installs the version its name says. Until now every installer read the latest release, so an older one you had kept would silently install the newest version. From this release on, the download page lets you pick any version from a menu on the Windows tile, and every pick gives you the same installer window; versions published before this one are not offered, because their installer would not keep its word.

## [1.5.0] - 2026-09-18

### Changed
- The install window carries the provider's logo, in its brand colour, next to the title, and says less: the sentence under the button repeated word for word what the Windows confirmation says two seconds later, and the four manual steps are down to one line each.

## [1.4.0] - 2026-09-18

### Fixed
- The "Install manually" section of the install window is readable again: its heading is back on one line (the chevron used to stretch over the label), the command no longer breaks in the middle of a word, and the copy button sits inside the code block, appearing on hover like in Obsidian, instead of overlapping its own label below the block. The collapsible heading and the copy button now show a hand cursor.

### Changed
- Neo Quiz installs for your account, in `%LOCALAPPDATA%\Programs\Neo Quiz`, instead of `Program Files`. Windows no longer asks for administrator rights: not when you install it, and above all not on every update, which now applies with a click and a restart.

**Uninstall your current version once before installing this one.** Windows picks the install mode from what it finds in the registry, so an existing "for all users" install keeps asking for elevation whatever this version does. Your settings and your open folders are kept.

## [1.3.0] - 2026-09-18

### Fixed
- Installing a CLI automatically now runs *exactly* the command the dialog shows you. For Codex the two had drifted apart, and the one the terminal ran could fail (`OSArchitecture` not found) on a machine where the printed one installed fine.

### Added
- When a generation fails because the CLI account is not signed in, the error card now offers **Sign in** instead of *Try again*: Neo Quiz opens a terminal on `codex login` (or `claude auth login`), waits while you sign in, shows you the moment it detects the account, and sends your request again by itself.

### Changed
- The installer download is 273 MB lighter: `NeoQuiz-X.Y.Z.exe` was stored uncompressed (371 MB) and is now compressed (97 MB). It self-extracts in a few seconds on first launch instead of not at all.
- Releases are Windows only from now on: the Linux job is asleep (kept commented in the workflow), and the download page's Linux tile points at 1.2.0, the last release with Linux packages.

## [1.2.4] - 2026-09-17

### Fixed
- The release packages are attached again: the upload step no longer depends on a third-party action whose floating tag broke every large upload (1.2.1, 1.2.2 and 1.2.3 shipped incomplete).

## [1.2.3] - 2026-09-17

### Fixed
- The Linux packages are attached to the release again: the release workflow listed the same AppImage twice, and the two concurrent uploads of the same file failed the job (1.2.1 and 1.2.2 shipped without their Linux packages).

## [1.2.2] - 2026-09-17

### Fixed
- The install command in the install window is syntax-coloured (command, flags, string, URL) instead of plain grey text.

## [1.2.1] - 2026-09-17

### Fixed
- The install window's "Install manually" section no longer looks like a grey folder header with a stray count.
- A provider that is no longer installed is no longer kept as the selected one: the selection goes back to "none" instead of showing a model nothing can run (settings survive a reinstall, so a previous choice used to stick).

## [1.2.0] - 2026-09-17

### Added
- Install Claude Code, the Codex CLI or Ollama from the app: a provider that is missing opens a window that explains what it is, installs it in one click (PowerShell opens with the official installer) and detects it once it is there. Manual steps stay available.

### Changed
- The hint under the composer no longer shows a raw command; it opens the same window.
- The welcome screen no longer shows a code block: it offers to generate a quiz, create an empty folder, open an existing folder or import a quiz.
- The "+" button of the composer opens the file picker directly; "Add notes" is gone (use "@" to attach a note). The shortcut is Ctrl+E.
- The note preview hides properties by default (a button shows them), keeps file links readable and renders callouts like Obsidian.

### Fixed
- The dots in the AI provider menu line up whatever the length of the status text.
- The "Add files" shortcut now works in the app.
- A PDF added with "Add files" can now be opened from its preview, like one attached with "@".
- Two destination folders with the same name (two "Generated") are told apart: each entry shows its folder icon and the root it belongs to.

## [1.1.0] - 2026-09-17

### Added
- Thirty-five built-in wallpapers, five per theme, with a picker in Settings; a folder of your own images still works.
- "Open an existing folder" when creating a folder: pick any folder you already have, an Obsidian vault folder for instance.
- A destination folder for generated quizzes, chosen in the generation options.
- A folder page lists its documents, links and notes below its quizzes; "Create with AI" from a folder attaches them for you.
- PDF attachments: their text is extracted and their first page shown on the card; a click opens a preview.
- A rendered preview of attached notes (headings, lists, callouts, tables, code).
- Folder cards show their path, and the folder can be opened or its path copied from the card menu.

### Changed
- The "Generated" folder is a staging area, not a subject: no progress panel, a sparkles icon.
- The AI provider menu shows a dot only when something is wrong (server stopped, not installed).
- Attachments in the composer are cards, like on claude.ai.
- Two play modes, Learn and Exam; "Practice" is gone.

### Fixed
- Creating a new quiz inside a nested folder failed.
- Folder cards no longer jump on hover, and their glow no longer switches off.
- Two neighbouring folder cards no longer get different widths.

## [1.0.3] - 2026-09-16

### Added
- Linux packages: AppImage (x86_64 and ARM64) and a .deb, with automatic updates for both.

### Fixed
- The installer shows real progress instead of an idle bar that jumps to 99 %.
- Running the installer over an existing installation now says "Neo Quiz is already installed" and offers to open it.
- The installer window no longer flickers while downloading.

Version 1.0.2 was withdrawn the same day; its changes are part of 1.0.3.

## [1.0.1] - 2026-09-15

### Added
- A Language setting (auto, English, French) in Settings › General.

### Changed
- The installer is redesigned after Google Play Games: one window, one button, the install location and the disk space on one line.
- The installer reads the release manifest directly and no longer depends on the GitHub API rate limit.

### Fixed
- The application window stays hidden until it is ready to be shown.

## [1.0.0] - 2026-09-13

### Added
- The Neo Quiz desktop app, independent from the Obsidian plugin: read, review, edit and generate quizzes from the folders you open, with automatic updates.
