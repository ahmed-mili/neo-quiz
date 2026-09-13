# Neo Quiz [![release](https://img.shields.io/github/v/release/ahmed-mili/neo-quiz?include_prereleases&label=release&display_name=tag&color=7c5cff)](https://github.com/ahmed-mili/neo-quiz/releases) [![Obsidian plugin](https://img.shields.io/badge/Obsidian-plugin-7c5cff?logo=obsidian&logoColor=white)](https://github.com/ahmed-mili/neo-quiz) ![platforms](https://img.shields.io/badge/apps-Windows%20%C2%B7%20Linux-2a2b3b)

Render ` ```quiz-blocks ` code blocks into fully interactive quizzes, in Obsidian or as a standalone desktop app.

---

### [Download Neo Quiz](https://ahmed-mili.github.io/neo-quiz/)

**Desktop app (Windows, Linux):** go to the [download page](https://ahmed-mili.github.io/neo-quiz/) above, or grab the installer from the [releases page](https://github.com/ahmed-mili/neo-quiz/releases). See [Install](#install) for SmartScreen and AppImage notes.

**Obsidian plugin:** install [BRAT](https://obsidian.md/plugins?id=obsidian42-brat), click **Add Beta Plugin**, paste `https://github.com/ahmed-mili/neo-quiz`, then enable **Neo Quiz** in Community plugins. Details in [Install](#install).

**Try it:** copy the [demo template](https://github.com/ahmed-mili/neo-quiz/blob/main/demo-template.md) into a new note to test every question type at once.

---

## How it works

You describe a quiz using a JSON5 code block. The plugin transforms it into a rich interactive form with multiple question types, a visual quiz page you can edit in place, exam mode, and more. There is a **Check** button that highlights right, wrong, and missed answers, with optional `hint` and `explanation` commentary. Great for self-education, certification prep, and learning notes.

---

## Features

- **Single Choice** — one correct answer
- **Multiple Choice** — several correct answers
- **Text Input** — free text with validation
- **Command Line** — terminal simulation (CMD, PowerShell, or Bash)
- **Ordering** — drag & drop to arrange items
- **Matching** — pair items from two columns
- **Fill in the Blanks** — complete a text, each blank checked on its own
- **Numeric** — a value compared with a tolerance, units and fractions understood
- **Comprehension** — one document shared by several questions
- **Exam Mode** — timed sessions with a countdown timer and auto-submit
- **The quiz page** — question list on one side, current question on the other, with an in-place editor
- **AI Quiz Generation** — describe a topic, paste text, or attach notes/images, using AI tools you already have installed locally (no API key)
- **Spaced review** — the quiz page tracks what you've reviewed and schedules what's due
- **Automatic updates** — the desktop app checks for new versions on its own; the Obsidian plugin updates through BRAT

See [Question types](#question-types) below for JSON5 examples, and [AI generation](#ai-generation) for details on the providers.

---

## Question types

<details>
<summary><strong>Single Choice — one correct answer</strong></summary>

<img src=".github/demo-single-choice.png" width="430" alt="Single choice demo" />
</details>

<details>
<summary><strong>Multiple Choice — several correct answers</strong></summary>

<img src=".github/demo-multiple-choice.png" width="430" alt="Multiple choice demo" />
</details>

<details>
<summary><strong>Text Input — free text with validation</strong></summary>

<img src=".github/demo-text-input.png" width="430" alt="Text input demo" />
</details>

<details>
<summary><strong>Command Line — terminal simulation</strong></summary>

Three variants available: **CMD**, **PowerShell**, and **Bash**.

<img src=".github/demo-cmd.png" width="430" alt="CMD demo" />
<img src=".github/demo-powershell.png" width="430" alt="PowerShell demo" />
<img src=".github/demo-bash.png" width="430" alt="Bash demo" />
</details>

<details>
<summary><strong>Ordering — drag & drop to arrange items</strong></summary>

<img src=".github/demo-ordering.png" width="430" alt="Ordering demo" />
</details>

<details>
<summary><strong>Matching — pair items from two columns</strong></summary>

<img src=".github/demo-matching.png" width="430" alt="Matching demo" />
</details>

<details>
<summary><strong>Fill in the Blanks — complete a text</strong></summary>

Write the whole sentence in `cloze` and wrap each blank in double braces.
Separate accepted variants with `|`:

```json5
{
  title: 'Networking',
  prompt: 'Complete the text below.',
  cloze: 'The {{DHCP}} protocol assigns an IP address, while {{DNS}} resolves names on port {{53}}.',
}
```

Every blank has the same width — a box sized to its answer would give away
the length of the word. Each blank is marked right or wrong on its own, and
the expected answer appears next to the ones that were missed.
</details>

<details>
<summary><strong>Numeric — a value, with a tolerance</strong></summary>

`3.14`, `3,14` and `3.140` are the same number, and a measurement is rarely
exact. Declare `numeric` and the answer is compared as a value:

```json5
{
  title: 'Physics',
  prompt: 'What is the acceleration due to gravity at the surface of the Earth?',
  type: 'text',
  numeric: true,
  tolerance: 0.05,     // or tolerancePercent: 2
  unit: 'm/s²',        // accepted as a suffix, never required
  answer: '9.81',
}
```

Fractions (`1/2`), thousands separators, scientific notation and the typographic
minus sign are all understood.
</details>

<details>
<summary><strong>Comprehension — one document, several questions</strong></summary>

A real exam is not only recall questions: it has a reading part, where one
document carries several questions. Give the questions the same `passageId`
and they all show the same document — only the first one carries the text:

```json5
[
  {
    passageId: 'doc1',
    passageTitle: 'Text: the greenhouse effect',
    passage: 'Long text to read before answering…',
    title: 'Main idea',
    prompt: 'What is the author arguing?',
    options: ['…', '…'],
    correctIndex: 0,
  },
  {
    passageId: 'doc1',        // same document, no need to repeat it
    title: 'Inference',
    prompt: 'What can be concluded from the third paragraph?',
    options: ['…', '…'],
    correctIndex: 1,
  },
]
```

The document sits at the top of the card, above the question title, and can be
folded away once read — folding it on one question folds it on all the others.
</details>

<details>
<summary><strong>Exam Mode</strong></summary>

<img src=".github/demo-exam-mode.png" width="430" alt="Exam mode demo" />

Add an exam configuration object anywhere in your quiz array to enable timed sessions with a countdown timer and auto-submit.
</details>

<details>
<summary><strong>The quiz page</strong></summary>

<img src=".github/demo-editor.png" width="430" alt="The quiz page, with the question list on the left and the current question on the right" />

Click a quiz in the Dashboard — or press `Ctrl+Shift+E` on a note that contains one — and you get its **page**: the question list on the left, the current question on the right, exactly as a learner will see it.

The **Editor** button turns that same page into an edit view, in place. No second screen, no panels to arrange.

- Add a question, choosing its type
- Edit every type: choices, ordering, matching, fill-in-the-blanks, numeric, terminal
- Attach a document, a resource, a hint, an explanation
- Reorder questions
- Set the quiz mode — quiz, learn or exam — and its timer
- Saves straight to your note as you type
</details>

---

## AI generation

Press `Ctrl+Shift+D` to open the **Dashboard**, then go to **Generate**: describe a topic, paste a text, attach notes or images, and get a ready-to-edit quiz.

Generation runs through the **AI tools you already have installed locally**: the plugin never asks for an API key and never stores one. Your requests go through your own CLI session and count against your own subscription.

| Provider | Requires | Notes |
|---|---|---|
| **Claude** | [Claude Code](https://claude.com/claude-code) CLI, `/login` | Pro / Max / Team / Enterprise account |
| **ChatGPT** | [Codex CLI](https://learn.chatgpt.com/docs/codex/cli), `codex login` | The Codex *CLI*, not the Codex desktop app |
| **Kimi** | [Kimi Code](https://www.kimi.com/code) CLI, `/login` | Paid Kimi Code plan |
| **Ollama** | [Ollama](https://ollama.com/download) | Local models, and cloud models via `ollama signin` |

The model list of each provider is read from the CLI itself, so new models show up on their own, without a plugin update. The plugin detects each tool and tells you what is missing (not installed, server stopped, not signed in) with the exact command to fix it.

Quizzes are generated **in the language of your prompt**: ask in French, get a French quiz; ask in Arabic, get an Arabic one. This is independent of the plugin's interface language.

**What a generation costs you:** every generation reports what it consumed, tokens in and out, and the price in dollars when the provider publishes one. Claude Code returns a real cost per request; the others run on a flat-rate plan and have no per-request price, so the panel says so instead of showing a misleading `$0.00`. Kimi Code reports no token counts at all, and the panel says that too. Nothing is ever estimated.

Turn on **Show subscription usage** in the settings and the panel also reads how much of your plan is left, from the CLI already installed on your machine: the 5-hour and 7-day windows for Claude, the plan window for Codex. It is off by default, and reachable from the Generate page before you start, so you can check what is left without spending anything to find out.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+E` | Open the quiz of the current note |
| `Ctrl+Shift+Q` | Open quiz from active note |
| `↑` / `↓` | Navigate between questions |
| `Space` / `Enter` | Select highlighted answer |

---

## Install

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

## Language

The interface follows **your Obsidian language** by default (English, or French where translated). You can force it in **Settings → Neo Quiz → Language**: `Automatic`, `English`, or `Français`.

---

## Notes & limitations

Bugs are possible. Feel free to [open an issue](https://github.com/ahmed-mili/neo-quiz/issues/new) and share feedback.

- Answers are not persisted between sessions
- The `esbuild.config.mjs` build path is configured for a local Obsidian vault — adjust it for your setup

---

## Contributing / License

[Ahmed Mili](https://github.com/ahmed-mili) is the sole maintainer. Issues and feedback are welcome on the [issue tracker](https://github.com/ahmed-mili/neo-quiz/issues). Licensed under the [MIT License](LICENSE).

If you find this plugin useful, please consider starring the repository.

<br>
<br>
