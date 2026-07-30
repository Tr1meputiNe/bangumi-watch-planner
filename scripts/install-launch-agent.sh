#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_ID="com.local.bangumi-watch-planner"
TEMPLATE="$PROJECT_DIR/launchd/$PLIST_ID.plist.template"
TARGET="$HOME/Library/LaunchAgents/$PLIST_ID.plist"
NPM_BIN="$(command -v npm)"
NODE_BIN="$(command -v node)"

if [[ -z "$NPM_BIN" || -z "$NODE_BIN" ]]; then
  echo "npm and node must be available in PATH" >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR/data" "$PROJECT_DIR/logs" "$HOME/Library/LaunchAgents"

cd "$PROJECT_DIR"
npm run build

escape_xml() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  value="${value//\'/&apos;}"
  printf '%s' "$value"
}

PROJECT_DIR_XML="$(escape_xml "$PROJECT_DIR")"
NODE_BIN_XML="$(escape_xml "$NODE_BIN")"

while IFS= read -r line; do
  line="${line//__PROJECT_DIR__/$PROJECT_DIR_XML}"
  line="${line//__NODE_BIN__/$NODE_BIN_XML}"
  printf '%s\n' "$line"
done < "$TEMPLATE" > "$TARGET"

launchctl unload "$TARGET" >/dev/null 2>&1 || true
launchctl load "$TARGET"

echo "Installed $PLIST_ID"
echo "Open http://127.0.0.1:3777 after the service starts."
