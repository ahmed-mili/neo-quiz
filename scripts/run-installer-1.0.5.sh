#!/usr/bin/env bash
set -euo pipefail

npm ci
npm ci --prefix apps/windows
python scripts/prepare-installer-1.0.5.py

# Le préparateur ajoute une assertion contenant l'expression GitHub avec 'app'.
# Corriger ses guillemets avant d'exécuter le contrôle JS : le premier essai a
# prouvé que l'assertion elle-même ne pouvait pas être parsée.
python - <<'PY'
from pathlib import Path
p = Path('scripts/check-installer.mjs')
s = p.read_text(encoding='utf-8')
bad = "workflow.includes('make_latest: ${{ steps.version.outputs.product == 'app' }}'),"
good = 'workflow.includes("make_latest: ${{ steps.version.outputs.product == \'app\' }}"),'
if bad in s:
    s = s.replace(bad, good, 1)
elif good not in s:
    raise SystemExit('assertion make_latest à corriger introuvable')
p.write_text(s, encoding='utf-8')
PY

actuelle=$(node -p "require('./apps/windows/package.json').version")
if [ "$actuelle" != "1.0.5" ]; then
  node scripts/set-version.mjs 1.0.5
fi
test "$(node -p "require('./apps/windows/package.json').version")" = "1.0.5"
test "$(node -p "require('./apps/windows/package-lock.json').version")" = "1.0.5"
test "$(node -p "require('./apps/windows/package-lock.json').packages[''].version")" = "1.0.5"

ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release.yml", aliases: true); puts "release.yml YAML OK"'

cp .github/workflows/release.yml /tmp/release.yml.good
python - <<'PY'
from pathlib import Path
p = Path('.github/workflows/release.yml')
s = p.read_text(encoding='utf-8')
if s.count('-f make_latest=true') != 1:
    raise SystemExit('promotion finale unique introuvable')
p.write_text(s.replace('-f make_latest=true', '-f make_latest=false', 1), encoding='utf-8')
PY
set +e
npm run check:installer > /tmp/discriminance-publication.log 2>&1
code=$?
set -e
cat /tmp/discriminance-publication.log
test "$code" -ne 0
grep -F 'ÉCHEC  publication : desktop devient latest seulement après les assets complets' /tmp/discriminance-publication.log
cp /tmp/release.yml.good .github/workflows/release.yml

cp apps/windows/installer/renderer-reference.ts /tmp/renderer-reference.ts.good
python - <<'PY'
from pathlib import Path
p = Path('apps/windows/installer/renderer-reference.ts')
s = p.read_text(encoding='utf-8')
old = 'annuler.disabled = annulationDemandee'
if s.count(old) != 1:
    raise SystemExit('garde annulation unique introuvable')
p.write_text(s.replace(old, 'annuler.disabled = true', 1), encoding='utf-8')
PY
set +e
npm run check:installer > /tmp/discriminance-ux.log 2>&1
code=$?
set -e
cat /tmp/discriminance-ux.log
test "$code" -ne 0
grep -F 'ÉCHEC  expérience : chargement immédiat, étape 3 directe et annulation partout' /tmp/discriminance-ux.log
cp /tmp/renderer-reference.ts.good apps/windows/installer/renderer-reference.ts

npm run check:installer
npm run check:package
npm run check:updater
npm run check
npm --prefix apps/windows run typecheck:installer
npm --prefix apps/windows run build:installer

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add \
  apps/windows/installer/main.ts \
  apps/windows/installer/worker.ts \
  apps/windows/installer/renderer-reference.ts \
  apps/windows/installer/style-details.css \
  src/i18n/en/installer.ts \
  src/i18n/fr/installer.ts \
  scripts/check-installer.mjs \
  apps/windows/package.json \
  apps/windows/package-lock.json

git diff --cached --quiet && { echo "::error::Aucun changement installer/version à committer."; exit 1; }
git commit -m "feat(installer): polish install flow for 1.0.5"
git push origin main
RELEASE_SHA=$(git rev-parse HEAD)
echo "Release SHA: $RELEASE_SHA"

gh workflow run release.yml --ref main -f version=1.0.5 -f product=app -f publish=true
run_id=""
for tentative in $(seq 1 40); do
  run_id=$(gh run list --workflow release.yml --event workflow_dispatch --limit 40 --json databaseId,headSha,createdAt \
    --jq ".[] | select(.headSha == \"${RELEASE_SHA}\") | .databaseId" | head -n 1)
  [ -n "$run_id" ] && break
  sleep 3
done
[ -n "$run_id" ] || { echo "::error::Run release.yml introuvable."; exit 1; }
echo "Release run: $run_id"

set +e
gh run watch "$run_id" --exit-status --interval 10
code=$?
set -e
if [ "$code" -ne 0 ]; then
  gh run view "$run_id" --log-failed || true
  exit "$code"
fi
conclusion=$(gh run view "$run_id" --json conclusion --jq '.conclusion')
test "$conclusion" = "success"

release_json=$(mktemp)
gh api "repos/${GITHUB_REPOSITORY}/releases/tags/desktop-v1.0.5" > "$release_json"
for requis in \
  "Install-NeoQuiz.exe" \
  "Install-NeoQuiz-fr.exe" \
  "neo-quiz-setup-1.0.5.exe" \
  "neo-quiz-setup-1.0.5.exe.blockmap" \
  "latest.yml" \
  "neo-quiz-1.0.5.AppImage" \
  "latest-linux.yml" \
  "neo-quiz.AppImage"
do
  jq -e --arg nom "$requis" '.assets[] | select(.name == $nom and .state == "uploaded" and .size > 0)' "$release_json" >/dev/null || {
    echo "::error::Asset final absent ou vide: $requis"
    exit 1
  }
done
jq -e --arg nom "neo-quiz-setup-1.0.5.exe" '.assets[] | select(.name == $nom) | .digest | select(type == "string" and test("^sha256:[0-9a-fA-F]{64}$"))' "$release_json" >/dev/null
test "$(gh api "repos/${GITHUB_REPOSITORY}/releases/latest" --jq '.tag_name')" = "desktop-v1.0.5"
version_main=$(gh api "repos/${GITHUB_REPOSITORY}/contents/apps/windows/package.json?ref=main" --jq '.content' | base64 -d | jq -r '.version')
test "$version_main" = "1.0.5"
latest_main=$(gh api "repos/${GITHUB_REPOSITORY}/contents/docs/latest.json?ref=main" --jq '.content' | base64 -d)
printf '%s' "$latest_main" | grep -F '"tag_name":"desktop-v1.0.5"'
printf '%s' "$latest_main" | grep -F '"name":"Install-NeoQuiz.exe"'
printf '%s' "$latest_main" | grep -F '"name":"Install-NeoQuiz-fr.exe"'

ok=0
for tentative in $(seq 1 60); do
  contenu=$(curl -fsSL "https://ahmed-mili.github.io/neo-quiz/latest.json?installer-105=${GITHUB_RUN_ID}-${tentative}" || true)
  if printf '%s' "$contenu" | grep -F '"tag_name":"desktop-v1.0.5"' >/dev/null \
    && printf '%s' "$contenu" | grep -F '"name":"Install-NeoQuiz.exe"' >/dev/null \
    && printf '%s' "$contenu" | grep -F '"name":"Install-NeoQuiz-fr.exe"' >/dev/null; then
    ok=1
    break
  fi
  sleep 5
done
[ "$ok" -eq 1 ] || { echo "::error::GitHub Pages ne sert pas la 1.0.5 complète."; exit 1; }

echo "INSTALLER_1_0_5_READY"
