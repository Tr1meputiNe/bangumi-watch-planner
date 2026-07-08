#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_ID="com.local.bangumi-watch-planner"
TEMPLATE="$PROJECT_DIR/launchd/$PLIST_ID.plist.template"
TARGET="$HOME/Library/LaunchAgents/$PLIST_ID.plist"
NPM_BIN="$(command -v npm)"

if [[ -z "$NPM_BIN" ]]; then
  echo "npm was not found in PATH" >&2
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
NPM_BIN_XML="$(escape_xml "$NPM_BIN")"

while IFS= read -r line; do
  line="${line//__PROJECT_DIR__/$PROJECT_DIR_XML}"
  line="${line//__NPM_BIN__/$NPM_BIN_XML}"
  printf '%s\n' "$line"
done < "$TEMPLATE" > "$TARGET"

launchctl unload "$TARGET" >/dev/null 2>&1 || true
launchctl load "$TARGET"

echo "Installed $PLIST_ID"
echo "Open http://127.0.0.1:3777 after the service starts."
