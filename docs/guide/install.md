# Install


### Desktop app (Windows, Linux)

The desktop app reads the same quiz folders and the same review log as the plugin, and generates quizzes with the same local AI tools.

1. Go to **[neo-quiz download page](https://ahmed-mili.github.io/neo-quiz/)** and click Download, or grab `neo-quiz-setup-<version>.exe` / `neo-quiz-<version>.AppImage` from the [releases page](https://github.com/ahmed-mili/neo-quiz/releases).
2. **Windows:** the installer is not code-signed, so SmartScreen shows "Windows protected your PC" on first run. Click **More info**, then **Run anyway**. Pick an install folder; the app is per-user and needs no admin rights.
3. **Linux:** `chmod +x neo-quiz-<version>.AppImage` and run it. Without FUSE, run it with `--appimage-extract-and-run`.

**Updating:** download the new installer and run it over the existing installation. Your folders and settings live in `%APPDATA%\Neo Quiz` and are kept; the review log lives in your quiz folder (`.neo-quiz/`) and is never touched. The version you are running is shown at the bottom of **Settings**.

**Uninstalling** removes the app only. Your quiz folders and their review log stay where they are.

### Obsidian plugin

The recommended way to install **Neo Quiz** is via **BRAT** (Beta Reviewers Auto-update Tool), which handles installation and automatic updates directly from GitHub.

1. Install the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat) from the Obsidian Community Plugins.
2. Open BRAT settings and click **Add Beta Plugin**.
3. Paste the repository URL:
   ```
   https://github.com/ahmed-mili/neo-quiz
   ```
4. Click **Add Plugin** — BRAT will install it automatically.
5. Go to **Settings → Community plugins** and enable **Neo Quiz**.

BRAT will notify you whenever a new version is available and update with one click.

### Code signing policy

The Windows installer is currently unsigned. A free certificate has been requested from [SignPath Foundation](https://signpath.org); once granted, this section will read: "Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org)".

- Committers, reviewers and approvers: [Ahmed Mili](https://github.com/ahmed-mili), the sole maintainer. Every release is built by GitHub Actions from a tagged commit of this repository and approved by him.
- Privacy: this program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. AI generation talks only to the local CLI or Ollama server you configure; the Ollama model catalogue is fetched from ollama.com when you open the model list.

---
