#!/usr/bin/env bash
# Basira — remove the background service and the native app.
#
# Your data is never touched: sysgo.db, uploads/ and .env stay where they are.
# Delete this folder yourself when you want them gone.
set -euo pipefail

LABEL="com.basira.backend"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }

printf '\n\033[1m→ removing the background service\033[0m\n'
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
if [[ -f "$PLIST" ]]; then rm -f "$PLIST"; ok "removed $PLIST"; else ok "no service installed"; fi

printf '\n\033[1m→ removing the macOS app\033[0m\n'
if [[ -d /Applications/Basira.app ]]; then
  rm -rf /Applications/Basira.app
  ok "removed /Applications/Basira.app"
else
  ok "no app installed"
fi

printf '\n\033[1m✓ Done.\033[0m Your database, uploads and .env were left untouched.\n\n'
