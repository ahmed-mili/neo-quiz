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
