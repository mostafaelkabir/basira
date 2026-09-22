#!/usr/bin/env bash
# Basira — one-command install for macOS.
#
#   ./install.sh                 deps + frontend build + background service
#   ./install.sh --no-service    everything except the launchd service
#   ./install.sh --app           also build and install the native macOS app
#   ./install.sh --port 8002     run the backend on another port
#
# Everything lives in this folder and in ~/Library/LaunchAgents. No sudo, no
# system files touched. Re-running it is safe: each step is idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PORT="${BASIRA_PORT:-8001}"
LABEL="com.basira.backend"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="/tmp/basira-backend.log"
WITH_SERVICE=1
WITH_APP=0
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-service) WITH_SERVICE=0 ;;
    --app)        WITH_APP=1 ;;
    --force)      FORCE=1 ;;
    --port)       PORT="${2:?--port needs a number}"; shift ;;
    -h|--help)    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1  (try --help)" >&2; exit 2 ;;
  esac
  shift
done

step() { printf '\n\033[1m→ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
step "checking prerequisites"
[[ "$(uname -s)" == "Darwin" ]] || warn "not macOS — the app runs, but the background service and notifications will not"

command -v python3 >/dev/null || die "python3 not found. Install it from https://python.org or with: brew install python@3.12"
python3 - <<'PY' || die "Python 3.11 or newer is required (found $(python3 -V))"
import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)
PY
ok "python $(python3 -V | cut -d' ' -f2)"

command -v node >/dev/null || die "node not found. Install Node 18+ from https://nodejs.org or with: brew install node"
NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
[[ "$NODE_MAJOR" -ge 18 ]] || die "Node 18 or newer is required (found $(node -v))"
ok "node $(node -v)"

# An older install of this project used a different label on the same port. Check
# before spending minutes on dependencies.
if [[ "$WITH_SERVICE" -eq 1 && "$(uname -s)" == "Darwin" && "$FORCE" -eq 0 ]] \
   && launchctl list 2>/dev/null | grep -q "com.sysgo.backend"; then
  die "the legacy 'com.sysgo.backend' service is loaded and would fight over port $PORT.
  Remove it first:  launchctl bootout gui/\$UID/com.sysgo.backend
  Then re-run, or pass --force to install alongside it on a different --port."
fi

# ── 2. Python environment ────────────────────────────────────────────────────
step "installing Python dependencies"
[[ -d venv ]] || python3 -m venv venv
venv/bin/python -m pip install --quiet --upgrade pip
venv/bin/pip install --quiet -r requirements.txt
ok "virtualenv ready at venv/"

# ── 3. Environment file ──────────────────────────────────────────────────────
step "checking configuration"
if [[ ! -f .env ]]; then
  cp .env.example .env
  ok "created .env — add a free Groq key to turn on the AI features"
else
  ok ".env already present"
fi

# ── 4. Frontend ──────────────────────────────────────────────────────────────
step "building the frontend"
if [[ -f frontend/package-lock.json ]]; then
  (cd frontend && npm ci --silent)
else
  (cd frontend && npm install --silent)
fi
(cd frontend && npm run build --silent)
ok "built frontend/dist"

# ── 5. Background service ────────────────────────────────────────────────────
if [[ "$WITH_SERVICE" -eq 1 && "$(uname -s)" == "Darwin" ]]; then
  step "installing the background service"

  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$ROOT/venv/bin/uvicorn</string>
    <string>app.main:app</string>
    <string>--port</string>
    <string>$PORT</string>
  </array>
  <key>WorkingDirectory</key>  <string>$ROOT</string>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>$LOG</string>
  <key>StandardErrorPath</key> <string>$LOG</string>
</dict>
</plist>
PLIST_EOF

  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$PLIST"
  ok "service installed — it starts at login and restarts if it crashes"

  step "waiting for the backend"
  for _ in $(seq 1 30); do
    if [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)" == "200" ]]; then
      ok "backend answering on port $PORT"
      HEALTHY=1; break
    fi
    sleep 1
  done
  [[ "${HEALTHY:-0}" == "1" ]] || die "the backend did not come up. Check the log:  tail -50 $LOG"
else
  step "skipping the background service"
  ok "start it yourself with:  venv/bin/uvicorn app.main:app --port $PORT"
fi

# ── 6. Native macOS app (optional) ───────────────────────────────────────────
if [[ "$WITH_APP" -eq 1 ]]; then
  step "building the macOS app"
  macos/build.sh --install
fi

printf '\n\033[1m✓ Basira is installed.\033[0m\n'
printf '  Open   http://localhost:%s\n' "$PORT"
printf '  Logs   tail -f %s\n' "$LOG"
[[ "$WITH_APP" -eq 1 ]] && printf '  App    open -a Basira\n'
printf '  Remove ./uninstall.sh\n\n'
