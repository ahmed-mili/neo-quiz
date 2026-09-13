# Contributing to Neo Quiz

## Branch structure

Everything happens on `main`. A release is a tag `vX.Y.Z` on `main`: the
`release.yml` workflow builds the Obsidian plugin, the Windows installer
and the Linux AppImage, and attaches them to the GitHub release. Installed
apps update themselves from there.

## Local development setup

```bash
npm ci
npm ci --prefix apps/windows
npm run check          # typecheck, then any check:* script from package.json
npm run app:dev        # the desktop app (Vite + Electron)
npm run build          # the Obsidian plugin, deployed to local vaults
```

Read `CLAUDE.md` at the root before changing anything: it explains the
shared code, the host contract, and every check script and what it guards.

## Rules

- No visible string hardcoded: everything goes through `t("<domain>.<key>")`,
  English is the reference, French is typed.
- Comments in French, explaining why.
- Never rename `quiz-blocks` (the note format), `PLUGIN_ID`, `appId` or
  `executableName`: they are persisted data.

## Code signing policy

See [install.md](guide/install.md#code-signing-policy).

## AI generation

See [ai-generation.md](guide/ai-generation.md).
