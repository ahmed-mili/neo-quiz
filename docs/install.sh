#!/usr/bin/env bash
# Neo Quiz - one-command Obsidian plugin installer.
# Usage: curl -fsSL https://ahmed-mili.github.io/neo-quiz/install.sh | bash
# Installs the plugin into an existing vault, or creates a brand new vault
# and installs into it, then opens Obsidian on that vault.
set -euo pipefail

IS_MAC=false
if [ "$(uname)" = "Darwin" ]; then
    IS_MAC=true
    OBSIDIAN_DIR="$HOME/Library/Application Support/obsidian"
else
    OBSIDIAN_DIR="$HOME/.config/obsidian"
fi
CONFIG_PATH="$OBSIDIAN_DIR/obsidian.json"

if [ ! -d "$OBSIDIAN_DIR" ]; then
    echo "Obsidian is not installed on this machine." >&2
    echo "Get it from https://obsidian.md/download" >&2
    exit 1
fi

HAVE_PY=false
command -v python3 >/dev/null 2>&1 && HAVE_PY=true

list_vault_paths() {
    [ -f "$CONFIG_PATH" ] || return 0
    if [ "$HAVE_PY" = true ]; then
        python3 -c '
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    content = f.read().strip()
data = json.loads(content) if content else {}
for v in (data.get("vaults") or {}).values():
    p = v.get("path")
    if p:
        print(p)
' "$CONFIG_PATH"
    else
        grep -o '"path":"[^"]*"' "$CONFIG_PATH" | sed -E 's/"path":"(.*)"/\1/'
    fi
}

VAULTS=()
while IFS= read -r line; do
    [ -n "$line" ] && [ -d "$line" ] && VAULTS+=("$line")
done < <(list_vault_paths)

echo "Obsidian vaults:"
i=1
for v in "${VAULTS[@]}"; do
    echo "  [$i] $(basename "$v") ($v)"
    i=$((i + 1))
done
if [ "${#VAULTS[@]}" -gt 1 ]; then
    echo "  [A] All vaults"
fi
echo "  [N] Create a new vault"

if [ "${#VAULTS[@]}" -eq 0 ]; then
    answer="N"
else
    read -r -p "Install into which vault? (number, A, or N for a new vault) " answer
fi

# Registers a new vault in obsidian.json: 16 random hex chars as the key,
# {path, ts} as the value, so it shows up in Obsidian's vault picker.
register_vault() {
    local path="$1"
    if [ "$HAVE_PY" = true ]; then
        python3 -c '
import json, secrets, sys, time
config_path, vault_path = sys.argv[1], sys.argv[2]
try:
    with open(config_path, encoding="utf-8") as f:
        content = f.read().strip()
    data = json.loads(content) if content else {}
except FileNotFoundError:
    data = {}
data.setdefault("vaults", {})
vault_id = secrets.token_hex(8)
data["vaults"][vault_id] = {"path": vault_path, "ts": int(time.time() * 1000)}
with open(config_path, "w", encoding="utf-8", newline="") as f:
    json.dump(data, f)
' "$CONFIG_PATH" "$path"
    else
        echo "python3 not found: cannot safely register the new vault in obsidian.json." >&2
        echo "Add it manually from Obsidian: Open folder as vault -> $path" >&2
    fi
    echo "New vault registered. If Obsidian is currently running, close it first: it may overwrite obsidian.json on exit."
}

SELECTED=()
if [[ "$answer" =~ ^[Nn]$ ]]; then
    default_path="$HOME/Neo Quiz"
    read -r -p "Path for the new vault [$default_path] " input
    new_vault_path="${input:-$default_path}"
    mkdir -p "$new_vault_path/.obsidian"
    # Restricted mode ("community plugins off") in a brand new vault is
    # controlled purely by the ABSENCE of community-plugins.json -- there is
    # no separate flag in app.json. We create it further down.
    register_vault "$new_vault_path"
    SELECTED=("$new_vault_path")
elif [[ "$answer" =~ ^[Aa]$ ]] && [ "${#VAULTS[@]}" -gt 1 ]; then
    SELECTED=("${VAULTS[@]}")
else
    idx=$((answer - 1))
    if [ "$idx" -lt 0 ] || [ "$idx" -ge "${#VAULTS[@]}" ]; then
        echo "Invalid choice." >&2
        exit 1
    fi
    SELECTED=("${VAULTS[$idx]}")
fi

BASE_URL="https://github.com/ahmed-mili/neo-quiz/releases/latest/download"
FILES=(main.js manifest.json styles.css)

for vault in "${SELECTED[@]}"; do
    echo ""
    echo "Installing into: $vault"

    tmp_dir=$(mktemp -d)
    trap 'rm -rf "$tmp_dir"' EXIT

    for file in "${FILES[@]}"; do
        echo "  Downloading $file..."
        curl -fsSL "$BASE_URL/$file" -o "$tmp_dir/$file"
    done

    plugin_dir="$vault/.obsidian/plugins/quiz-blocks"
    mkdir -p "$plugin_dir"
    for file in "${FILES[@]}"; do
        cp "$tmp_dir/$file" "$plugin_dir/$file"
    done
    rm -rf "$tmp_dir"
    trap - EXIT

    # Enable the plugin in community-plugins.json (create it if the vault
    # never had community plugins turned on before).
    community_plugins="$vault/.obsidian/community-plugins.json"
    if [ "$HAVE_PY" = true ]; then
        python3 -c '
import json, sys
path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        content = f.read().strip()
    plugins = json.loads(content) if content else []
except FileNotFoundError:
    plugins = []
if "quiz-blocks" not in plugins:
    plugins.append("quiz-blocks")
with open(path, "w", encoding="utf-8", newline="") as f:
    json.dump(plugins, f)
' "$community_plugins"
    else
        # No python3 available: fall back to a plain-text edit. Only safe
        # because community-plugins.json is a flat array of id strings.
        if [ -f "$community_plugins" ] && grep -q "quiz-blocks" "$community_plugins"; then
            : # already enabled
        elif [ -f "$community_plugins" ] && [ -s "$community_plugins" ]; then
            if [ "$IS_MAC" = true ]; then
                sed -i '' 's/\]$/,"quiz-blocks"]/' "$community_plugins"
            else
                sed -i 's/\]$/,"quiz-blocks"]/' "$community_plugins"
            fi
        else
            printf '["quiz-blocks"]' > "$community_plugins"
        fi
    fi

    version=$(grep -o '"version":[^,}]*' "$plugin_dir/manifest.json" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
    echo "  Installed Neo Quiz v$version"
done

echo ""
echo "Reload plugins if the vault was already open."

for vault in "${SELECTED[@]}"; do
    vault_name=$(basename "$vault")
    # URL-encode the vault name (spaces, accents) without extra dependencies.
    if [ "$HAVE_PY" = true ]; then
        encoded=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$vault_name")
    else
        encoded=$(printf '%s' "$vault_name" | sed 's/ /%20/g')
    fi
    uri="obsidian://open?vault=$encoded"
    if [ "$IS_MAC" = true ]; then
        open "$uri" 2>/dev/null || true
    else
        xdg-open "$uri" 2>/dev/null || true
    fi
done
