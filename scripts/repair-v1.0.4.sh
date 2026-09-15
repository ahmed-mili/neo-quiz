#!/usr/bin/env bash
set -euo pipefail

npm ci
npm ci --prefix apps/windows

python <<'PY'
from pathlib import Path

def expr(body: str) -> str:
    return "$" + "{{ " + body + " }}"

p = Path('.github/workflows/release.yml')
s = p.read_text(encoding='utf-8')
old_dynamic = "make_latest: " + expr("steps.version.outputs.product == 'app'")
if s.count(old_dynamic) != 1:
    raise SystemExit(f"ancien make_latest prepare inattendu: {s.count(old_dynamic)}")
s = s.replace(old_dynamic, 'make_latest: "false"', 1)
if s.count('make_latest: "true"') != 2:
    raise SystemExit(f"promotions assets inattendues: {s.count('make_latest: ' + chr(34) + 'true' + chr(34))}")
s = s.replace('make_latest: "true"', 'make_latest: "false"')

old_prepare = '''  # Résout version / tag / produit une seule fois, et crée la release AVANT
  # les builds : c'est ainsi que les jobs `plugin` / `app-windows` /
  # `app-linux` peuvent y attacher leurs fichiers sans se disputer la
  # création (un Windows et un Linux qui créeraient chacun la release en
  # feraient deux, en double).'''
new_prepare = '''  # Résout version / tag / produit une seule fois et crée la release AVANT
  # les builds, mais JAMAIS comme `latest`. Les jobs peuvent ainsi y attacher
  # leurs fichiers sans exposer une version incomplète au bootstrapper.
  # Le job `site` promeut l'application uniquement après succès Windows + Linux
  # et validation des assets indispensables.'''
if old_prepare not in s:
    raise SystemExit('commentaire prepare introuvable')
s = s.replace(old_prepare, new_prepare, 1)

old_create = '''      # Sur tag, ou sur dispatch explicitement publiant, la release existe avant
      # que les jobs de build y attachent leurs fichiers. `make_latest`
      # distingue les deux produits : l'application devient la release
      # « latest » du dépôt, le greffon ne la touche jamais.'''
new_create = '''      # Sur tag, ou sur dispatch explicitement publiant, la release existe avant
      # que les jobs de build y attachent leurs fichiers, mais reste NON latest.
      # `/releases/latest` est consommé par le bootstrapper : il ne doit jamais
      # pointer vers une release dont le NSIS n'est pas encore prêt.'''
if old_create not in s:
    raise SystemExit('commentaire Create Release introuvable')
s = s.replace(old_create, new_create, 1)

old_attach = '''          # Répété comme dans le job `plugin` : le PATCH de l'action ne doit
          # jamais retirer à l'application son statut « latest ».
          make_latest: "false"'''
new_attach = '''          # L'attachement ne promeut JAMAIS une release incomplète. Le job
          # `site` la rendra latest seulement après succès Windows + Linux et
          # validation des assets indispensables.
          make_latest: "false"'''
if s.count(old_attach) != 2:
    raise SystemExit(f"commentaires attach inattendus: {s.count(old_attach)}")
s = s.replace(old_attach, new_attach)

token = expr('github.token')
tag = expr('needs.prepare.outputs.tag')
version = expr('needs.prepare.outputs.version')
anchor = "      - name: Write latest.json from the release\n        env:\n          GH_TOKEN: " + token
if s.count(anchor) != 1:
    raise SystemExit(f"ancre site inattendue: {s.count(anchor)}")
step = '''      - name: Verify app release assets and promote latest
        if: needs.prepare.outputs.product == 'app'
        env:
          GH_TOKEN: __TOKEN__
          TAG: __TAG__
          VERSION: __VERSION__
        shell: bash
        run: |
          set -euo pipefail
          release_json=$(mktemp)
          gh api "repos/${GITHUB_REPOSITORY}/releases/tags/${TAG}" > "$release_json"
          jq -e '.draft == false and .prerelease == false' "$release_json" >/dev/null || {
            echo "::error::Release draft ou prerelease avant promotion."
            exit 1
          }
          for requis in \
            "Install-NeoQuiz.exe" \
            "Install-NeoQuiz-fr.exe" \
            "neo-quiz-setup-${VERSION}.exe" \
            "neo-quiz-setup-${VERSION}.exe.blockmap" \
            "latest.yml" \
            "neo-quiz-${VERSION}.AppImage" \
            "latest-linux.yml" \
            "neo-quiz.AppImage"
          do
            jq -e --arg nom "$requis" '.assets[] | select(.name == $nom)' "$release_json" >/dev/null || {
              echo "::error::Asset obligatoire absent avant promotion latest : $requis"
              exit 1
            }
          done
          nsis="neo-quiz-setup-${VERSION}.exe"
          jq -e --arg nom "$nsis" '.assets[] | select(.name == $nom) | .digest | select(type == "string" and test("^sha256:[0-9a-fA-F]{64}$"))' "$release_json" >/dev/null || {
            echo "::error::Le NSIS n'a pas d'empreinte sha256 exploitable par le bootstrapper."
            exit 1
          }
          release_id=$(jq -er '.id' "$release_json")
          gh api --method PATCH "repos/${GITHUB_REPOSITORY}/releases/${release_id}" -f make_latest=true >/dev/null
          latest=$(gh api "repos/${GITHUB_REPOSITORY}/releases/latest" --jq '.tag_name')
          [ "$latest" = "$TAG" ] || { echo "::error::Promotion latest échouée: $latest"; exit 1; }

'''.replace('__TOKEN__', token).replace('__TAG__', tag).replace('__VERSION__', version)
s = s.replace(anchor, step + anchor, 1)
p.write_text(s, encoding='utf-8')

cp = Path('scripts/check-installer.mjs')
c = cp.read_text(encoding='utf-8')
check_anchor = '''\tr.check("publication : le nom français est une copie du même exe",
\t\tworkflow.includes("cp Install-NeoQuiz.exe Install-NeoQuiz-fr.exe"), true);

\t/* La langue voyage AVEC le fichier : par son nom d'abord, par le flux'''
if c.count(check_anchor) != 1:
    raise SystemExit(f"ancre check-installer inattendue: {c.count(check_anchor)}")
addition = '''\tr.check("publication : le nom français est une copie du même exe",
\t\tworkflow.includes("cp Install-NeoQuiz.exe Install-NeoQuiz-fr.exe"), true);

\tconst debutPromotion = workflow.indexOf("- name: Verify app release assets and promote latest");
\tconst debutLatestJson = workflow.indexOf("- name: Write latest.json from the release");
\tconst blocPromotion = debutPromotion >= 0 && debutLatestJson > debutPromotion
\t\t? workflow.slice(debutPromotion, debutLatestJson)
\t\t: "";
\tr.check("publication : la release est créée sans devenir latest avant les assets",
\t\tworkflow.includes("__OLD_DYNAMIC__"), false);
\tr.check("publication : les jobs d'assets ne rendent jamais la release latest",
\t\tworkflow.includes('make_latest: "true"'), false);
\tr.check("publication : la promotion finale exige les deux bootstrappers, le NSIS et son sha256",
\t\t[
\t\t\tblocPromotion.includes('"Install-NeoQuiz.exe"'),
\t\t\tblocPromotion.includes('"Install-NeoQuiz-fr.exe"'),
\t\t\tblocPromotion.includes('"neo-quiz-setup-${VERSION}.exe"'),
\t\t\tblocPromotion.includes("sha256:"),
\t\t],
\t\t[true, true, true, true]);
\tr.check("publication : latest est promue seulement après validation des assets et avant latest.json",
\t\tdebutPromotion >= 0 && blocPromotion.includes("-f make_latest=true") && debutLatestJson > debutPromotion,
\t\ttrue);

\t/* La langue voyage AVEC le fichier : par son nom d'abord, par le flux'''
addition = addition.replace('__OLD_DYNAMIC__', old_dynamic)
c = c.replace(check_anchor, addition, 1)
cp.write_text(c, encoding='utf-8')
PY

gh api "repos/${GITHUB_REPOSITORY}/releases/tags/desktop-v1.0.3" \
  --jq '{tag_name, published_at, assets: [.assets[] | {name, size, browser_download_url}]}' \
  > docs/latest.json

ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release.yml", aliases: true); puts "release.yml YAML OK"'

cp .github/workflows/release.yml /tmp/release.yml.good
python <<'PY'
from pathlib import Path
p = Path('.github/workflows/release.yml')
s = p.read_text(encoding='utf-8')
if s.count('-f make_latest=true') != 1:
    raise SystemExit('promotion finale unique introuvable avant discriminance')
p.write_text(s.replace('-f make_latest=true', '-f make_latest=false', 1), encoding='utf-8')
PY
set +e
npm run check:installer > /tmp/discriminance.log 2>&1
code=$?
set -e
cat /tmp/discriminance.log
[ "$code" -ne 0 ] || { echo "::error::Contrôle resté vert après rupture volontaire."; exit 1; }
grep -F 'ÉCHEC  publication : latest est promue seulement après validation des assets et avant latest.json' /tmp/discriminance.log >/dev/null || {
  echo "::error::Assertion nommée attendue absente."
  exit 1
}
cp /tmp/release.yml.good .github/workflows/release.yml
npm run check:installer
npm run check:package
npm run check:updater
npm --prefix apps/windows run typecheck:installer
npm test

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add .github/workflows/release.yml scripts/check-installer.mjs docs/latest.json
git diff --cached --quiet && { echo "::error::Aucune correction à committer."; exit 1; }
git commit -m "fix(release): promote desktop only after assets"
git push origin main

python <<'PY'
from pathlib import Path
p = Path('.github/workflows/ci.yml')
s = p.read_text(encoding='utf-8')
start = s.index('  # BEGIN TEMP REPAIR V1.0.4\n')
end_marker = '  # END TEMP REPAIR V1.0.4\n'
end = s.index(end_marker, start) + len(end_marker)
p.write_text(s[:start].rstrip() + '\n', encoding='utf-8')
PY
rm -f .github/repair-v1.0.4.trigger
rm -f scripts/repair-v1.0.4.sh
git rm -f .github/workflows/publish-desktop-1.0.4-once.yml
git rm -f .github/workflows/repair-v1.0.4.yml
git add .github/workflows/ci.yml .github/repair-v1.0.4.trigger scripts/repair-v1.0.4.sh
git commit -m "chore: remove temporary desktop repair machinery"
git push origin main
CLEAN_MAIN_SHA=$(git rev-parse HEAD)

ok=0
for tentative in $(seq 1 60); do
  contenu=$(curl -fsSL "https://ahmed-mili.github.io/neo-quiz/latest.json?repair=${GITHUB_RUN_ID}-${tentative}" || true)
  if printf '%s' "$contenu" | grep -F '"tag_name":"desktop-v1.0.3"' >/dev/null; then ok=1; break; fi
  sleep 5
done
[ "$ok" -eq 1 ] || { echo "::error::Pages n'a pas basculé sur 1.0.3."; exit 1; }

gh release delete desktop-v1.0.4 --cleanup-tag --yes
if gh api "repos/${GITHUB_REPOSITORY}/releases/tags/desktop-v1.0.4" >/dev/null 2>&1; then exit 1; fi
if gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/desktop-v1.0.4" >/dev/null 2>&1; then exit 1; fi
latest=$(gh api "repos/${GITHUB_REPOSITORY}/releases/latest" --jq '.tag_name')
[ "$latest" = "desktop-v1.0.3" ] || { echo "::error::Latest après suppression: $latest"; exit 1; }

gh workflow run release.yml --ref main -f version=1.0.4 -f product=app -f publish=true
run_id=""
for tentative in $(seq 1 30); do
  run_id=$(gh run list --workflow release.yml --event workflow_dispatch --limit 30 --json databaseId,headSha \
    --jq ".[] | select(.headSha == \"${CLEAN_MAIN_SHA}\") | .databaseId" | head -n 1)
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
  gh run view "$run_id" --log-failed || true
  exit "$code"
fi
conclusion=$(gh run view "$run_id" --json conclusion --jq '.conclusion')
[ "$conclusion" = "success" ] || { echo "::error::Conclusion: $conclusion"; exit 1; }

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
  jq -e --arg nom "$requis" '.assets[] | select(.name == $nom)' "$release_json" >/dev/null || { echo "::error::Asset final absent: $requis"; exit 1; }
done
jq -e --arg nom "neo-quiz-setup-1.0.4.exe" '.assets[] | select(.name == $nom) | .digest | select(type == "string" and test("^sha256:[0-9a-fA-F]{64}$"))' "$release_json" >/dev/null || exit 1
latest=$(gh api "repos/${GITHUB_REPOSITORY}/releases/latest" --jq '.tag_name')
[ "$latest" = "desktop-v1.0.4" ] || { echo "::error::Latest GitHub: $latest"; exit 1; }
main_latest=$(gh api "repos/${GITHUB_REPOSITORY}/contents/docs/latest.json?ref=main" --jq '.content' | base64 -d)
printf '%s' "$main_latest" | grep -F '"tag_name":"desktop-v1.0.4"' >/dev/null || exit 1

ok=0
for tentative in $(seq 1 60); do
  page=$(curl -fsSL "https://ahmed-mili.github.io/neo-quiz/latest.json?repair-final=${GITHUB_RUN_ID}-${tentative}" || true)
  if printf '%s' "$page" | grep -F '"tag_name":"desktop-v1.0.4"' >/dev/null \
    && printf '%s' "$page" | grep -F '"name":"Install-NeoQuiz.exe"' >/dev/null \
    && printf '%s' "$page" | grep -F '"name":"Install-NeoQuiz-fr.exe"' >/dev/null; then ok=1; break; fi
  sleep 5
done
[ "$ok" -eq 1 ] || { echo "::error::Pages ne sert pas la nouvelle 1.0.4 complète."; exit 1; }
