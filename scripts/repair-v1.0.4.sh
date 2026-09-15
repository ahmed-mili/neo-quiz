#!/usr/bin/env bash
set -euo pipefail

# La correction de publication est validée séparément ; ce script temporaire
# ne fait qu'orchestrer le remplacement demandé de desktop-v1.0.4.
HEAD_SHA=$(git rev-parse HEAD)

# Ne supprime jamais la 1.0.4 tant que Pages n'a pas réellement rebasculé
# sur la 1.0.3 : le bouton Download doit toujours pointer vers un asset vivant.
ok=0
for tentative in $(seq 1 90); do
  contenu=$(curl -fsSL "https://ahmed-mili.github.io/neo-quiz/latest.json?repair=${GITHUB_RUN_ID}-${tentative}" || true)
  if printf '%s' "$contenu" | grep -F '"tag_name":"desktop-v1.0.3"' >/dev/null; then
    echo "Pages sert le fallback desktop-v1.0.3."
    ok=1
    break
  fi
  sleep 5
done
[ "$ok" -eq 1 ] || { echo "::error::Pages n'a pas basculé sur 1.0.3."; exit 1; }

# Suppression explicite de l'ancienne release et de son tag.
gh release delete desktop-v1.0.4 --cleanup-tag --yes
if gh api "repos/${GITHUB_REPOSITORY}/releases/tags/desktop-v1.0.4" >/dev/null 2>&1; then
  echo "::error::L'ancienne release desktop-v1.0.4 existe encore."
  exit 1
fi
if gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/desktop-v1.0.4" >/dev/null 2>&1; then
  echo "::error::L'ancien tag desktop-v1.0.4 existe encore."
  exit 1
fi
latest=$(gh api "repos/${GITHUB_REPOSITORY}/releases/latest" --jq '.tag_name')
[ "$latest" = "desktop-v1.0.3" ] || { echo "::error::Latest après suppression: $latest"; exit 1; }

# Réutilise STRICTEMENT la chaîne de publication existante.
gh workflow run release.yml --ref main -f version=1.0.4 -f product=app -f publish=true
run_id=""
for tentative in $(seq 1 45); do
  run_id=$(gh run list --workflow release.yml --event workflow_dispatch --limit 30 --json databaseId,headSha,createdAt \
    --jq ".[] | select(.headSha == \"${HEAD_SHA}\") | .databaseId" | head -n 1)
  [ -n "$run_id" ] && break
  sleep 2
done
[ -n "$run_id" ] || { echo "::error::Run release.yml introuvable."; exit 1; }
echo "Release run: $run_id"

set +e
gh run watch "$run_id" --exit-status --interval 10
code=$?
set -e
if [ "$code" -ne 0 ]; then
  echo "::group::Échec release.yml"
  gh run view "$run_id" --log-failed || true
  echo "::endgroup::"
  exit "$code"
fi
conclusion=$(gh run view "$run_id" --json conclusion --jq '.conclusion')
[ "$conclusion" = "success" ] || { echo "::error::Conclusion CI: $conclusion"; exit 1; }

# Vérifie les vrais assets, pas seulement l'état du workflow.
release_json=$(mktemp)
gh api "repos/${GITHUB_REPOSITORY}/releases/tags/desktop-v1.0.4" > "$release_json"
for requis in \
  "Install-NeoQuiz.exe" \
  "Install-NeoQuiz-fr.exe" \
  "neo-quiz-setup-1.0.4.exe" \
  "neo-quiz-setup-1.0.4.exe.blockmap" \
  "latest.yml" \
  "neo-quiz-1.0.4.AppImage" \
  "latest-linux.yml" \
  "neo-quiz.AppImage"
do
  jq -e --arg nom "$requis" '.assets[] | select(.name == $nom)' "$release_json" >/dev/null || {
    echo "::error::Asset final absent: $requis"
    exit 1
  }
done
jq -e --arg nom "neo-quiz-setup-1.0.4.exe" \
  '.assets[] | select(.name == $nom) | .digest | select(type == "string" and test("^sha256:[0-9a-fA-F]{64}$"))' \
  "$release_json" >/dev/null || { echo "::error::NSIS sans sha256 exploitable."; exit 1; }

latest=$(gh api "repos/${GITHUB_REPOSITORY}/releases/latest" --jq '.tag_name')
[ "$latest" = "desktop-v1.0.4" ] || { echo "::error::Latest GitHub: $latest"; exit 1; }

main_latest=$(gh api "repos/${GITHUB_REPOSITORY}/contents/docs/latest.json?ref=main" --jq '.content' | base64 -d)
printf '%s' "$main_latest" | grep -F '"tag_name":"desktop-v1.0.4"' >/dev/null || {
  echo "::error::docs/latest.json sur main n'est pas revenu en 1.0.4."
  exit 1
}

# Enfin, attendre le déploiement Pages réel et contrôler les deux liens Windows.
ok=0
for tentative in $(seq 1 90); do
  page=$(curl -fsSL "https://ahmed-mili.github.io/neo-quiz/latest.json?repair-final=${GITHUB_RUN_ID}-${tentative}" || true)
  if printf '%s' "$page" | grep -F '"tag_name":"desktop-v1.0.4"' >/dev/null \
    && printf '%s' "$page" | grep -F '"name":"Install-NeoQuiz.exe"' >/dev/null \
    && printf '%s' "$page" | grep -F '"name":"Install-NeoQuiz-fr.exe"' >/dev/null; then
    echo "Pages sert la nouvelle desktop-v1.0.4 complète."
    ok=1
    break
  fi
  sleep 5
done
[ "$ok" -eq 1 ] || { echo "::error::Pages ne sert pas la nouvelle 1.0.4 complète."; exit 1; }
