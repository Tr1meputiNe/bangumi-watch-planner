#!/usr/bin/env bash
set -euo pipefail

PLIST_ID="com.local.bangumi-watch-planner"
TARGET="$HOME/Library/LaunchAgents/$PLIST_ID.plist"

launchctl unload "$TARGET" >/dev/null 2>&1 || true
rm -f "$TARGET"

echo "Uninstalled $PLIST_ID"
